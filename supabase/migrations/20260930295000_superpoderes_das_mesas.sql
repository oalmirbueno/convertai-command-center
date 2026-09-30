-- Superpoderes das mesas (frente SPP, 30/09/2026).
--
-- O método da casa (adaptado de obra/superpowers v6.4.2, licença MIT,
-- Copyright (c) 2025 Jesse Vincent; docs/licencas/superpowers-MIT.txt) entra em
-- todos os agentes pelo catálogo supabase/functions/_shared/superpoderes-catalogo.ts.
-- Esta migration guarda só o que muda sem deploy e o registro de uso:
--
-- 1. superpoderes_das_mesas: a chave de liga e desliga de cada método por mesa.
--    Sem linha = ligado (o padrão mora no código). A linha '*' vale para todas
--    as mesas; a linha da mesa vence a '*'. A prova nunca desliga (CHECK).
--    A equipe lê; só o admin grava (INSERT e UPDATE). Sem DELETE: desligar é
--    ligado = false.
-- 2. ia_usos ganha metodos, metodo_fonte, metodo_prova, metodo_agente e
--    metodo_versao (todas podem ser nulas; a leitura continua a que existe).
-- 3. ia_uso_marcar_metodo: a escrita dessas colunas, só pelo servidor
--    (service_role), com os valores conferidos.
-- 4. superpoderes_usos_sem_ia e superpoderes_registrar_sem_uso: o método das
--    chamadas que não geram linha em ia_usos (a cadeia antiga do ai-provider:
--    Workspace, Assistente geral, coach e radar; e a reserva da Central e dos
--    rituais). Só se lê pela RPC de resumo; grava o servidor ou a equipe, e
--    a equipe só para cliente a que tem acesso.
-- 5. superpoderes_resumo(p_dias): a auditoria do método (adaptação de
--    diagnosing-superpowers): por agente e método, quantas vezes entrou, por
--    quem foi escolhido e quantas provas faltaram, somando ia_usos e o
--    registro sem uso. Só a equipe; cada pessoa vê só os clientes a que tem
--    acesso.
--
-- Idempotente e só amplia. Não aplicar fora da integração.

-- ---------------------------------------------------------------------------
-- 1. Liga e desliga por mesa
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.superpoderes_das_mesas (
  mesa text NOT NULL CONSTRAINT superpoderes_das_mesas_mesa_check CHECK (mesa ~ '^[a-z_*]{1,40}$'),
  metodo text NOT NULL CONSTRAINT superpoderes_das_mesas_metodo_check
    CHECK (metodo IN ('entender', 'plano', 'prova', 'causa', 'receber', 'revisor', 'aceite', 'frentes')),
  ligado boolean NOT NULL DEFAULT true,
  atualizado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mesa, metodo),
  CONSTRAINT superpoderes_prova_sempre CHECK (NOT (metodo = 'prova' AND ligado = false))
);

COMMENT ON TABLE public.superpoderes_das_mesas IS
  'Frente SPP: liga e desliga dos métodos da casa (superpoderes) por mesa. Sem linha = ligado; mesa ''*'' vale para todas; a prova nunca desliga.';

-- Quem mexeu e quando: pelo servidor, não pela tela.
CREATE OR REPLACE FUNCTION public.superpoderes_das_mesas_carimbo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  NEW.atualizado_em := now();
  NEW.atualizado_por := auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS superpoderes_das_mesas_carimbo ON public.superpoderes_das_mesas;
CREATE TRIGGER superpoderes_das_mesas_carimbo
BEFORE INSERT OR UPDATE ON public.superpoderes_das_mesas
FOR EACH ROW EXECUTE FUNCTION public.superpoderes_das_mesas_carimbo();

ALTER TABLE public.superpoderes_das_mesas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.superpoderes_das_mesas FROM PUBLIC, anon;
REVOKE DELETE, TRUNCATE ON TABLE public.superpoderes_das_mesas FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.superpoderes_das_mesas TO authenticated;
GRANT ALL ON TABLE public.superpoderes_das_mesas TO service_role;

DROP POLICY IF EXISTS superpoderes_das_mesas_equipe_le ON public.superpoderes_das_mesas;
CREATE POLICY superpoderes_das_mesas_equipe_le
ON public.superpoderes_das_mesas
FOR SELECT TO authenticated
USING (COALESCE(public.is_staff((select auth.uid())), false));

DROP POLICY IF EXISTS superpoderes_das_mesas_admin_insere ON public.superpoderes_das_mesas;
CREATE POLICY superpoderes_das_mesas_admin_insere
ON public.superpoderes_das_mesas
FOR INSERT TO authenticated
WITH CHECK (public.has_role((select auth.uid()), 'admin'::public.app_role));

DROP POLICY IF EXISTS superpoderes_das_mesas_admin_altera ON public.superpoderes_das_mesas;
CREATE POLICY superpoderes_das_mesas_admin_altera
ON public.superpoderes_das_mesas
FOR UPDATE TO authenticated
USING (public.has_role((select auth.uid()), 'admin'::public.app_role))
WITH CHECK (public.has_role((select auth.uid()), 'admin'::public.app_role));

-- ---------------------------------------------------------------------------
-- 2. ia_usos: o método que foi junto em cada chamada
-- ---------------------------------------------------------------------------
ALTER TABLE public.ia_usos ADD COLUMN IF NOT EXISTS metodos text[];
ALTER TABLE public.ia_usos ADD COLUMN IF NOT EXISTS metodo_fonte text;
ALTER TABLE public.ia_usos ADD COLUMN IF NOT EXISTS metodo_prova text;
ALTER TABLE public.ia_usos ADD COLUMN IF NOT EXISTS metodo_agente text;
ALTER TABLE public.ia_usos ADD COLUMN IF NOT EXISTS metodo_versao text;

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ia_usos_metodo_fonte_check') THEN
    ALTER TABLE public.ia_usos
      ADD CONSTRAINT ia_usos_metodo_fonte_check CHECK (metodo_fonte IS NULL OR metodo_fonte IN ('codigo', 'jev', 'regra'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ia_usos_metodo_prova_check') THEN
    ALTER TABLE public.ia_usos
      ADD CONSTRAINT ia_usos_metodo_prova_check CHECK (metodo_prova IS NULL OR metodo_prova IN ('ok', 'faltou', 'nao_se_aplica'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ia_usos_metodos_check') THEN
    ALTER TABLE public.ia_usos
      ADD CONSTRAINT ia_usos_metodos_check CHECK (
        metodos IS NULL
        OR metodos <@ ARRAY['entender', 'plano', 'prova', 'causa', 'receber', 'revisor', 'aceite', 'frentes']::text[]
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ia_usos_metodo_agente_check') THEN
    ALTER TABLE public.ia_usos
      ADD CONSTRAINT ia_usos_metodo_agente_check CHECK (metodo_agente IS NULL OR metodo_agente ~ '^[a-z_.]{1,60}$');
  END IF;
END
$migration$;

-- Auditoria dos últimos dias sem varrer a tabela inteira.
CREATE INDEX IF NOT EXISTS ia_usos_metodo_criado_idx
  ON public.ia_usos (criado_em DESC)
  WHERE metodos IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Escrita das colunas do método: só o servidor
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ia_uso_marcar_metodo(
  _uso_id uuid,
  _metodos text[] DEFAULT NULL,
  _fonte text DEFAULT NULL,
  _prova text DEFAULT NULL,
  _agente text DEFAULT NULL,
  _versao text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF _uso_id IS NULL THEN
    RETURN;
  END IF;
  IF _fonte IS NOT NULL AND _fonte NOT IN ('codigo', 'jev', 'regra') THEN
    RAISE EXCEPTION 'Fonte do método inválida.' USING ERRCODE = '22023';
  END IF;
  IF _prova IS NOT NULL AND _prova NOT IN ('ok', 'faltou', 'nao_se_aplica') THEN
    RAISE EXCEPTION 'Prova do método inválida.' USING ERRCODE = '22023';
  END IF;
  -- Nada é apagado: o que vem nulo fica como estava.
  UPDATE public.ia_usos AS u
     SET metodos = COALESCE(_metodos, u.metodos),
         metodo_fonte = COALESCE(_fonte, u.metodo_fonte),
         metodo_prova = COALESCE(_prova, u.metodo_prova),
         metodo_agente = COALESCE(left(_agente, 60), u.metodo_agente),
         metodo_versao = COALESCE(left(_versao, 80), u.metodo_versao)
   WHERE u.id = _uso_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ia_uso_marcar_metodo(uuid, text[], text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ia_uso_marcar_metodo(uuid, text[], text, text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. O método das chamadas sem linha em ia_usos (cadeia antiga e reserva)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.superpoderes_usos_sem_ia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  criado_em timestamptz NOT NULL DEFAULT now(),
  -- Sem vínculo: a auditoria fica mesmo se o cliente sair (o acesso é conferido na leitura).
  client_id uuid,
  agente text NOT NULL CONSTRAINT superpoderes_usos_sem_ia_agente_check CHECK (agente ~ '^[a-z_.]{1,60}$'),
  metodos text[] NOT NULL CONSTRAINT superpoderes_usos_sem_ia_metodos_check CHECK (
    cardinality(metodos) BETWEEN 1 AND 8
    AND metodos <@ ARRAY['entender', 'plano', 'prova', 'causa', 'receber', 'revisor', 'aceite', 'frentes']::text[]
  ),
  metodo_fonte text CONSTRAINT superpoderes_usos_sem_ia_fonte_check CHECK (metodo_fonte IS NULL OR metodo_fonte IN ('codigo', 'jev', 'regra')),
  metodo_prova text CONSTRAINT superpoderes_usos_sem_ia_prova_check CHECK (metodo_prova IS NULL OR metodo_prova IN ('ok', 'faltou', 'nao_se_aplica')),
  metodo_versao text CONSTRAINT superpoderes_usos_sem_ia_versao_check CHECK (metodo_versao IS NULL OR length(metodo_versao) <= 80)
);

COMMENT ON TABLE public.superpoderes_usos_sem_ia IS
  'Frente SPP: o método da casa nas chamadas que não geram linha em ia_usos (cadeia antiga do ai-provider e reserva da Central e dos rituais). Lido só pela RPC superpoderes_resumo.';

CREATE INDEX IF NOT EXISTS superpoderes_usos_sem_ia_criado_idx
  ON public.superpoderes_usos_sem_ia (criado_em DESC);

-- Nenhuma política: ninguém lê nem grava direto pela API. A escrita é pela RPC abaixo e a leitura pelo resumo.
ALTER TABLE public.superpoderes_usos_sem_ia ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.superpoderes_usos_sem_ia FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.superpoderes_usos_sem_ia TO service_role;

CREATE OR REPLACE FUNCTION public.superpoderes_registrar_sem_uso(
  _agente text,
  _metodos text[],
  _fonte text DEFAULT NULL,
  _prova text DEFAULT NULL,
  _versao text DEFAULT NULL,
  _client_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  -- O servidor grava sempre. Com a chave de quem pediu (coach e radar), só a
  -- equipe, e só para cliente a que tem acesso.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR NOT COALESCE(public.is_staff(auth.uid()), false) THEN
      RAISE EXCEPTION 'Sem permissão para registrar o método.' USING ERRCODE = '42501';
    END IF;
    IF _client_id IS NOT NULL AND NOT public.can_access_client(_client_id) THEN
      RAISE EXCEPTION 'Sem acesso a este cliente.' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF _agente IS NULL OR _agente !~ '^[a-z_.]{1,60}$' THEN
    RAISE EXCEPTION 'Agente do método inválido.' USING ERRCODE = '22023';
  END IF;
  IF _metodos IS NULL OR cardinality(_metodos) NOT BETWEEN 1 AND 8
     OR NOT (_metodos <@ ARRAY['entender', 'plano', 'prova', 'causa', 'receber', 'revisor', 'aceite', 'frentes']::text[]) THEN
    RAISE EXCEPTION 'Métodos inválidos.' USING ERRCODE = '22023';
  END IF;
  IF _fonte IS NOT NULL AND _fonte NOT IN ('codigo', 'jev', 'regra') THEN
    RAISE EXCEPTION 'Fonte do método inválida.' USING ERRCODE = '22023';
  END IF;
  IF _prova IS NOT NULL AND _prova NOT IN ('ok', 'faltou', 'nao_se_aplica') THEN
    RAISE EXCEPTION 'Prova do método inválida.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.superpoderes_usos_sem_ia (client_id, agente, metodos, metodo_fonte, metodo_prova, metodo_versao)
  VALUES (_client_id, _agente, _metodos, _fonte, _prova, left(_versao, 80));
END;
$$;

REVOKE ALL ON FUNCTION public.superpoderes_registrar_sem_uso(text, text[], text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.superpoderes_registrar_sem_uso(text, text[], text, text, text, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Auditoria do método (Configurações, Superpoderes)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.superpoderes_resumo(p_dias integer DEFAULT 30)
RETURNS TABLE (
  agente text,
  metodo text,
  vezes bigint,
  pelo_jev bigint,
  pela_regra bigint,
  pelo_codigo bigint,
  provas_ok bigint,
  provas_faltaram bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _dias integer := LEAST(GREATEST(COALESCE(p_dias, 30), 1), 90);
  _admin boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.is_staff(auth.uid()), false) THEN
    RAISE EXCEPTION 'Sem permissão para ver o uso do método.' USING ERRCODE = '42501';
  END IF;
  _admin := public.has_role(auth.uid(), 'admin'::public.app_role);

  -- ia_usos (motor) e o registro sem uso (cadeia antiga e reserva), somados.
  RETURN QUERY
  WITH usos AS (
    SELECT COALESCE(u.metodo_agente, u.agente) AS quem, u.metodos AS lista, u.metodo_fonte AS fonte, u.metodo_prova AS prova_do_uso, u.client_id AS cliente
      FROM public.ia_usos AS u
     WHERE u.metodos IS NOT NULL
       AND u.criado_em >= now() - make_interval(days => _dias)
    UNION ALL
    SELECT s.agente, s.metodos, s.metodo_fonte, s.metodo_prova, s.client_id
      FROM public.superpoderes_usos_sem_ia AS s
     WHERE s.criado_em >= now() - make_interval(days => _dias)
  )
  SELECT
    x.quem,
    m.metodo,
    count(*),
    count(*) FILTER (WHERE x.fonte = 'jev'),
    count(*) FILTER (WHERE x.fonte = 'regra'),
    count(*) FILTER (WHERE x.fonte = 'codigo'),
    count(*) FILTER (WHERE m.metodo = 'prova' AND x.prova_do_uso = 'ok'),
    count(*) FILTER (WHERE m.metodo = 'prova' AND x.prova_do_uso = 'faltou')
  FROM usos AS x
  CROSS JOIN LATERAL unnest(x.lista) AS m(metodo)
  -- Sem cliente (Workspace e Assistente geral fora de um cliente): só o admin vê.
  WHERE (_admin OR (x.cliente IS NOT NULL AND public.can_access_client(x.cliente)))
  GROUP BY 1, 2
  ORDER BY 1, 2;
END;
$$;

REVOKE ALL ON FUNCTION public.superpoderes_resumo(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.superpoderes_resumo(integer) TO authenticated, service_role;
