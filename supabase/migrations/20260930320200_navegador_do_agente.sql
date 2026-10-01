-- Frente MOD (30/09/2026): navegador do agente (computer use pela API), só leitura e coleta.
--
-- Amplia a fila do computador do agente (20260926031100_mesa_videos.sql, tabela agente_computador_tarefas,
-- que continua DESLIGADA para aplicativos de desktop) com tarefas de navegador que rodam num Chromium
-- isolado do worker da agência (workers/computador). Desenho: docs/motores/COMPUTADOR-DO-AGENTE.md, seção 8.
--
-- Travas no banco (as mesmas regras estão em _shared/computador-do-agente.ts, na função
-- computador-do-agente e no worker):
-- * a tarefa nasce 'aguardando_dono'; o worker só pega 'aprovada' COM aprovado_por e aprovado_em;
-- * lista de domínios (1 a 10) e URL inicial obrigatórias nas tarefas de navegador;
-- * teto de passos (1 a 60) e de custo (0 a 5 dólares); o passo que passa do teto faz o worker parar;
-- * Parar = estado 'cancelada' a qualquer momento (a função confere quem pode); o worker vê no próximo passo
--   e não consegue mais gravar 'feita' por cima (tudo com o token da trava);
-- * RLS igual à de antes: a equipe lê o que é do cliente (is_staff + can_access_client) e só a service_role
--   escreve (a função e o worker, este com a chave numa variável de ambiente da máquina).
--
-- Idempotente e só amplia. Nada é apagado.

-- ─── 1) Colunas das tarefas de navegador ────────────────────────────────────────────
ALTER TABLE public.agente_computador_tarefas
  ADD COLUMN IF NOT EXISTS caso text,
  ADD COLUMN IF NOT EXISTS url_inicial text,
  ADD COLUMN IF NOT EXISTS dominios text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS objetivo text,
  ADD COLUMN IF NOT EXISTS origem text,
  ADD COLUMN IF NOT EXISTS teto_passos integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS teto_custo_usd numeric(10, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS passos_feitos integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS custo_usd numeric(10, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS modelo_id text,
  ADD COLUMN IF NOT EXISTS resultado jsonb,
  ADD COLUMN IF NOT EXISTS executor text,
  ADD COLUMN IF NOT EXISTS trava_token uuid,
  ADD COLUMN IF NOT EXISTS trava_ate timestamptz,
  ADD COLUMN IF NOT EXISTS iniciado_em timestamptz,
  ADD COLUMN IF NOT EXISTS terminado_em timestamptz,
  ADD COLUMN IF NOT EXISTS parado_por uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agente_computador_tarefas_caso_check') THEN
    ALTER TABLE public.agente_computador_tarefas
      ADD CONSTRAINT agente_computador_tarefas_caso_check
      CHECK (caso IS NULL OR caso IN ('captura_site', 'conferir_post', 'coleta_publica'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agente_computador_tarefas_navegador_check') THEN
    ALTER TABLE public.agente_computador_tarefas
      ADD CONSTRAINT agente_computador_tarefas_navegador_check
      CHECK (
        caso IS NULL
        OR (
          url_inicial ~ '^https?://'
          AND char_length(url_inicial) <= 2000
          AND cardinality(dominios) BETWEEN 1 AND 10
          AND (objetivo IS NULL OR char_length(objetivo) <= 500)
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agente_computador_tarefas_tetos_check') THEN
    ALTER TABLE public.agente_computador_tarefas
      ADD CONSTRAINT agente_computador_tarefas_tetos_check
      CHECK (teto_passos BETWEEN 1 AND 60 AND teto_custo_usd >= 0 AND teto_custo_usd <= 5 AND passos_feitos >= 0 AND custo_usd >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agente_computador_tarefas_resultado_check') THEN
    ALTER TABLE public.agente_computador_tarefas
      ADD CONSTRAINT agente_computador_tarefas_resultado_check
      CHECK (resultado IS NULL OR (jsonb_typeof(resultado) = 'object' AND pg_column_size(resultado) <= 200000));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS agente_computador_tarefas_caso_idx
  ON public.agente_computador_tarefas (estado, criado_em)
  WHERE caso IS NOT NULL;

-- ─── 2) Executores vistos (a tela mostra se há um worker ligado) ─────────────────────
CREATE TABLE IF NOT EXISTS public.computador_executores (
  nome text PRIMARY KEY CHECK (char_length(nome) BETWEEN 1 AND 80),
  visto_em timestamptz NOT NULL DEFAULT now(),
  versao text,
  casos text[] NOT NULL DEFAULT '{}'::text[]
);
ALTER TABLE public.computador_executores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS computador_executores_equipe_le ON public.computador_executores;
CREATE POLICY computador_executores_equipe_le ON public.computador_executores
  FOR SELECT TO authenticated USING (public.is_staff((select auth.uid())));
REVOKE INSERT, UPDATE, DELETE ON public.computador_executores FROM anon, authenticated;
GRANT SELECT ON public.computador_executores TO authenticated;
GRANT ALL ON public.computador_executores TO service_role;

-- ─── 3) RPCs do worker (só service_role) ─────────────────────────────────────────────

-- Pega UMA tarefa de navegador aprovada pelo dono, dos casos que o worker sabe fazer.
CREATE OR REPLACE FUNCTION public.computador_tarefa_pegar(_token uuid, _executor text, _casos text[], _versao text DEFAULT NULL)
RETURNS SETOF public.agente_computador_tarefas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r public.agente_computador_tarefas;
BEGIN
  IF _token IS NULL OR _executor IS NULL OR char_length(_executor) NOT BETWEEN 1 AND 80 THEN
    RETURN;
  END IF;

  INSERT INTO public.computador_executores (nome, visto_em, versao, casos)
  VALUES (_executor, now(), left(_versao, 40), COALESCE(_casos, '{}'::text[]))
  ON CONFLICT (nome) DO UPDATE
    SET visto_em = now(), versao = COALESCE(left(EXCLUDED.versao, 40), public.computador_executores.versao), casos = EXCLUDED.casos;

  -- Trava vencida (worker caiu no meio): falha com motivo, sem repetir sozinha.
  UPDATE public.agente_computador_tarefas
     SET estado = 'falhou', motivo = 'O navegador do agente parou no meio (máquina desligada?). Peça de novo.',
         trava_token = NULL, trava_ate = NULL, terminado_em = now(), atualizado_em = now()
   WHERE estado = 'executando' AND caso IS NOT NULL AND trava_ate < now();

  -- Aprovada e esquecida por mais de 24 h sai da fila.
  UPDATE public.agente_computador_tarefas
     SET estado = 'cancelada', motivo = 'Ficou aprovada mais de um dia sem executor ligado. Peça de novo.',
         terminado_em = now(), atualizado_em = now()
   WHERE estado = 'aprovada' AND caso IS NOT NULL AND aprovado_em < now() - interval '24 hours';

  SELECT t.* INTO _r
    FROM public.agente_computador_tarefas AS t
   WHERE t.estado = 'aprovada'
     AND t.caso IS NOT NULL
     AND t.caso = ANY (COALESCE(_casos, '{}'::text[]))
     AND t.aprovado_por IS NOT NULL
     AND t.aprovado_em IS NOT NULL
   ORDER BY t.aprovado_em
   LIMIT 1
   FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.agente_computador_tarefas
     SET estado = 'executando', executor = _executor, trava_token = _token,
         trava_ate = now() + interval '10 minutes', iniciado_em = now(), atualizado_em = now()
   WHERE id = _r.id
  RETURNING * INTO _r;
  RETURN NEXT _r;
END;
$$;

-- Registra um passo (prova e custo) e diz ao worker se segue: 'seguir', 'parar' (Parar do dono ou trava
-- perdida) ou 'teto' (passos ou custo no limite; o worker fecha a tarefa com o que já tem).
CREATE OR REPLACE FUNCTION public.computador_tarefa_passo(_id uuid, _token uuid, _prova jsonb, _custo_usd numeric DEFAULT 0)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _t public.agente_computador_tarefas;
BEGIN
  SELECT * INTO _t FROM public.agente_computador_tarefas WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR _t.estado <> 'executando' OR _t.trava_token IS DISTINCT FROM _token THEN
    RETURN 'parar';
  END IF;

  UPDATE public.agente_computador_tarefas
     SET provas = CASE WHEN _prova IS NOT NULL AND jsonb_typeof(_prova) = 'object' THEN provas || jsonb_build_array(_prova) ELSE provas END,
         passos_feitos = passos_feitos + 1,
         custo_usd = custo_usd + GREATEST(COALESCE(_custo_usd, 0), 0),
         trava_ate = now() + interval '10 minutes',
         atualizado_em = now()
   WHERE id = _id
  RETURNING * INTO _t;

  IF _t.passos_feitos >= _t.teto_passos OR _t.custo_usd > _t.teto_custo_usd THEN
    RETURN 'teto';
  END IF;
  RETURN 'seguir';
END;
$$;

-- Fecha a tarefa ('feita' ou 'falhou') só se ela ainda for deste token e estiver rodando: o Parar do dono
-- (cancelada) não é sobrescrito.
CREATE OR REPLACE FUNCTION public.computador_tarefa_concluir(_id uuid, _token uuid, _estado text, _resultado jsonb, _motivo text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _estado NOT IN ('feita', 'falhou') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COMPUTADOR_ESTADO_INVALIDO';
  END IF;
  UPDATE public.agente_computador_tarefas
     SET estado = _estado,
         resultado = CASE WHEN _resultado IS NOT NULL AND jsonb_typeof(_resultado) = 'object' THEN _resultado ELSE resultado END,
         motivo = left(_motivo, 600),
         trava_token = NULL, trava_ate = NULL, terminado_em = now(), atualizado_em = now()
   WHERE id = _id AND estado = 'executando' AND trava_token = _token;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.computador_tarefa_pegar(uuid, text, text[], text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.computador_tarefa_passo(uuid, uuid, jsonb, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.computador_tarefa_concluir(uuid, uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.computador_tarefa_pegar(uuid, text, text[], text) TO service_role;
GRANT EXECUTE ON FUNCTION public.computador_tarefa_passo(uuid, uuid, jsonb, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.computador_tarefa_concluir(uuid, uuid, text, jsonb, text) TO service_role;

-- ─── 4) ia_usos aceita 'computador' (custo do computer use na carteira) ─────
DO $$
DECLARE
  _alvo record;
  _def text;
  _valores text[];
BEGIN
  FOR _alvo IN
    SELECT *
    FROM (VALUES
      ('ia_usos', 'tarefa', 'ia_usos_tarefa_check'),
      ('ia_usos', 'agente', 'ia_usos_agente_check')
    ) AS t(tabela, coluna, restricao)
  LOOP
    IF to_regclass('public.' || _alvo.tabela) IS NULL THEN
      CONTINUE;
    END IF;
    SELECT pg_get_constraintdef(oid) INTO _def FROM pg_constraint
     WHERE conrelid = ('public.' || _alvo.tabela)::regclass AND conname = _alvo.restricao;
    -- Já aceita (nas duas formas que o Postgres mostra: ARRAY['a'::text] e '{a,b}'::text[]): não mexe.
    IF _def IS NULL OR _def ~ '(''|\{|,)computador(''|\}|,)' THEN
      CONTINUE;
    END IF;
    -- Lê as duas formas; sem isso, rodar de novo depois de um ADD CONSTRAINT %L::text[] estreitaria a lista.
    SELECT array_agg(DISTINCT v) INTO _valores FROM (
      SELECT m[1] AS v FROM regexp_matches(_def, '''([a-z_]+)''', 'g') AS m
      UNION
      SELECT btrim(x, ' "') FROM unnest(string_to_array(substring(_def FROM '\{([^}]*)\}'), ',')) AS x
    ) s WHERE v ~ '^[a-z_]+$';
    IF COALESCE(cardinality(_valores), 0) = 0 THEN
      CONTINUE;
    END IF;
    _valores := ARRAY(SELECT DISTINCT unnest(COALESCE(_valores, '{}'::text[]) || ARRAY['computador']));
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', _alvo.tabela, _alvo.restricao);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%I = ANY (%L::text[]))', _alvo.tabela, _alvo.restricao, _alvo.coluna, _valores);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- Conferência (só leitura):
-- select column_name from information_schema.columns where table_name = 'agente_computador_tarefas' order by 1;
-- select pg_get_constraintdef(oid) from pg_constraint where conname in ('ia_usos_tarefa_check', 'ia_usos_agente_check');
