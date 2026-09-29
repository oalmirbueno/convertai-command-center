-- Frente SIT (30/09/2026): motor de código (piloto na máquina da agência).
-- Desenho: plano/p4-motores.md §10 e supabase/functions/_shared/motor-codigo.ts.
--
-- O painel nunca roda o agente. A função motor-codigo valida o acesso, estima,
-- reserva na carteira (o teto do trabalho fica preso enquanto ele está aberto)
-- e grava o pedido aqui. O worker (workers/motor-codigo/, service_role) pega o
-- trabalho, grava eventos resumidos (no máximo 1 por segundo), o commit, a
-- prévia, o zip e o custo real (ia_registrar_uso).
--
-- Só amplia, idempotente. RLS: a equipe com acesso ao cliente lê; escrita de
-- estado só pela service_role (função e worker). Nada é apagado: trabalho
-- parado ou cancelado fica com o estado.

-- ─── 1) Trabalhos ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.motor_trabalhos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  marca_id uuid,
  mesa text NOT NULL DEFAULT 'site' CHECK (mesa IN ('site', 'motion', 'apresentacao')),
  projeto text NOT NULL CHECK (projeto ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  referencia_tipo text,
  referencia_id uuid,
  tipo text NOT NULL CHECK (tipo IN ('construir', 'ajustar', 'desfazer', 'revisar', 'publicar', 'zip')),
  estado text NOT NULL DEFAULT 'na_fila' CHECK (estado IN ('na_fila', 'executando', 'parando', 'feito', 'falhou', 'parado', 'cancelado')),
  modelo text,
  instrucao text NOT NULL DEFAULT '' CHECK (char_length(instrucao) <= 4000),
  pedido jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(pedido) = 'object'),
  teto_usd numeric NOT NULL DEFAULT 0 CHECK (teto_usd >= 0 AND teto_usd <= 20),
  estimativa_usd numeric CHECK (estimativa_usd IS NULL OR estimativa_usd >= 0),
  custo_usd numeric NOT NULL DEFAULT 0 CHECK (custo_usd >= 0),
  custo_fonte text,
  uso_id uuid,
  preview_url text,
  preview_expira_em timestamptz,
  commit text,
  commit_anterior text,
  zip_path text,
  resultado jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(resultado) = 'object'),
  erro text,
  executor text,
  pego_em timestamptz,
  terminado_em timestamptz,
  parar_pedido_em timestamptz,
  parar_pedido_por uuid,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS motor_trabalhos_fila_idx ON public.motor_trabalhos (estado, criado_em) WHERE estado IN ('na_fila', 'executando', 'parando');
CREATE INDEX IF NOT EXISTS motor_trabalhos_cliente_idx ON public.motor_trabalhos (client_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS motor_trabalhos_referencia_idx ON public.motor_trabalhos (referencia_id, criado_em DESC) WHERE referencia_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.motor_trabalhos_tocar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $body$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$body$;

DROP TRIGGER IF EXISTS motor_trabalhos_tocar ON public.motor_trabalhos;
CREATE TRIGGER motor_trabalhos_tocar
  BEFORE UPDATE ON public.motor_trabalhos
  FOR EACH ROW EXECUTE FUNCTION public.motor_trabalhos_tocar();

-- ─── 2) Eventos resumidos (passo, arquivo, comando, custo, prévia, commit) ──

CREATE TABLE IF NOT EXISTS public.motor_eventos (
  id bigserial PRIMARY KEY,
  trabalho_id uuid NOT NULL REFERENCES public.motor_trabalhos(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('estado', 'passo', 'arquivo', 'comando', 'custo', 'previa', 'commit', 'aviso', 'erro', 'fim')),
  resumo text NOT NULL CHECK (char_length(resumo) BETWEEN 1 AND 300),
  dados jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(dados) = 'object'),
  em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS motor_eventos_trabalho_idx ON public.motor_eventos (trabalho_id, id);

-- ─── 3) Executores (batida do worker: a tela diz se o motor está ligado) ─────

CREATE TABLE IF NOT EXISTS public.motor_executores (
  nome text PRIMARY KEY CHECK (char_length(nome) BETWEEN 1 AND 80),
  visto_em timestamptz NOT NULL DEFAULT now(),
  versao text,
  capacidades jsonb NOT NULL DEFAULT '{}'::jsonb,
  trabalho_id uuid
);

-- ─── 4) RLS: equipe com acesso ao cliente lê; só service_role escreve ────────

ALTER TABLE public.motor_trabalhos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.motor_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.motor_executores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS motor_trabalhos_staff_read ON public.motor_trabalhos;
CREATE POLICY motor_trabalhos_staff_read ON public.motor_trabalhos
  FOR SELECT TO authenticated USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

DROP POLICY IF EXISTS motor_eventos_staff_read ON public.motor_eventos;
CREATE POLICY motor_eventos_staff_read ON public.motor_eventos
  FOR SELECT TO authenticated USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

DROP POLICY IF EXISTS motor_executores_staff_read ON public.motor_executores;
CREATE POLICY motor_executores_staff_read ON public.motor_executores
  FOR SELECT TO authenticated USING (public.is_staff((select auth.uid())));

REVOKE INSERT, UPDATE, DELETE ON public.motor_trabalhos, public.motor_eventos, public.motor_executores FROM anon, authenticated;
REVOKE ALL ON public.motor_trabalhos, public.motor_eventos, public.motor_executores FROM anon;
GRANT SELECT ON public.motor_trabalhos, public.motor_eventos, public.motor_executores TO authenticated;
GRANT ALL ON public.motor_trabalhos, public.motor_eventos, public.motor_executores TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.motor_eventos_id_seq TO service_role;

-- ─── 5) Reserva e fila (só backend) ─────────────────────────────────────────

-- Quanto da carteira do cliente está preso pelos trabalhos abertos (teto menos o gasto).
CREATE OR REPLACE FUNCTION public.motor_reservado_usd(_client_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $body$
  SELECT COALESCE(SUM(GREATEST(t.teto_usd - t.custo_usd, 0)), 0)
  FROM public.motor_trabalhos t
  WHERE t.client_id = _client_id AND t.estado IN ('na_fila', 'executando', 'parando');
$body$;

REVOKE ALL ON FUNCTION public.motor_reservado_usd(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.motor_reservado_usd(uuid) TO service_role;

-- O worker pega o trabalho mais antigo da fila, um por projeto de cada vez
-- (dois trabalhos no mesmo diretório se atropelariam). FOR UPDATE SKIP LOCKED:
-- dois workers nunca pegam o mesmo.
CREATE OR REPLACE FUNCTION public.motor_pegar_trabalho(_executor text, _mesas text[] DEFAULT ARRAY['site'])
RETURNS SETOF public.motor_trabalhos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _id uuid;
BEGIN
  IF NOT app_private.rpc_trusted_backend() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MOTOR_SO_BACKEND';
  END IF;
  -- Um pegar de cada vez: dois workers não levam dois trabalhos do mesmo projeto.
  PERFORM pg_advisory_xact_lock(hashtext('motor_pegar_trabalho'));
  SELECT t.id INTO _id
  FROM public.motor_trabalhos t
  WHERE t.estado = 'na_fila'
    AND t.mesa = ANY (COALESCE(_mesas, ARRAY['site']))
    AND NOT EXISTS (
      SELECT 1 FROM public.motor_trabalhos o
      WHERE o.projeto = t.projeto AND o.estado IN ('executando', 'parando')
    )
  ORDER BY t.criado_em
  FOR UPDATE SKIP LOCKED
  LIMIT 1;
  IF _id IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  UPDATE public.motor_trabalhos
     SET estado = 'executando', executor = left(COALESCE(_executor, 'worker'), 80), pego_em = now()
   WHERE id = _id
  RETURNING *;
END;
$body$;

REVOKE ALL ON FUNCTION public.motor_pegar_trabalho(text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.motor_pegar_trabalho(text, text[]) TO service_role;

-- ─── 6) Ao vivo: a tela escuta os eventos e o estado (RLS de quem escuta) ────

DO $rt$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'motor_eventos') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.motor_eventos;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'motor_trabalhos') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.motor_trabalhos;
    END IF;
  END IF;
END
$rt$;

NOTIFY pgrst, 'reload schema';

-- Conferir depois de aplicar (só leitura):
-- select table_name from information_schema.tables where table_name in ('motor_trabalhos','motor_eventos','motor_executores');
-- select policyname from pg_policies where tablename like 'motor_%';
-- select proname, prosecdef from pg_proc where proname in ('motor_pegar_trabalho','motor_reservado_usd');
-- select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'motor_%';
