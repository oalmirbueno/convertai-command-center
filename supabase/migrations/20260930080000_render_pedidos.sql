-- Frente EDT (30/09): render de verdade pela fila (Mesa Edição).
--
-- A tela pede (função editor-video, ação render_pedir) e o WORKER da máquina da
-- agência (workers/render) puxa a fila: baixa as mídias do Storage, roda o
-- Remotion com a ComposicaoDoProjeto, acerta o volume (-14 LUFS), sobe o MP4 em
-- partes e grava em video_arquivos. Também mede a onda do áudio (corte de verdade).
--
-- Idempotente e só amplia. RLS: a equipe lê o que é do cliente (is_staff +
-- can_access_client); só a service_role escreve (a função e o worker, este com a
-- chave numa variável de ambiente da máquina, nunca em arquivo).
--
-- Travas:
-- * um pedido por clique (client_id, uid) e no máximo UM ativo por versão e tipo;
-- * a pegada é FOR UPDATE SKIP LOCKED com trava_token + trava_ate (10 min por
--   padrão, o worker renova a cada progresso); queda do worker: a trava vence e
--   o pedido volta com tentativas + 1; esgotou (3): vira erro. Nada repete sem teto;
-- * progresso, conclusão e falha só valem com o token da trava (worker velho não
--   sobrescreve); pedido cancelado faz o progresso devolver false (o worker para).
--
-- Sem este SQL: o botão Renderizar avisa "falta ativar a fila no banco" e o ZIP
-- continua funcionando.

-- ─── 1) Arquivos: tipos novos (render, amostra, elemento) ────────────────────────────
DO $$
DECLARE
  _def text;
  _valores text[];
BEGIN
  IF to_regclass('public.video_arquivos') IS NULL THEN
    RETURN;
  END IF;
  SELECT pg_get_constraintdef(oid) INTO _def FROM pg_constraint
  WHERE conrelid = 'public.video_arquivos'::regclass AND conname = 'video_arquivos_tipo_check';
  IF _def IS NULL THEN
    _valores := ARRAY['bruto', 'take', 'gerado', 'audio', 'entrega', 'angulo', 'quadro'];
  ELSE
    -- Lê as duas formas que o Postgres mostra: ARRAY['a'::text, ...] e '{a,b}'::text[] (a segunda é a que
    -- sobra depois de um ADD CONSTRAINT ... %L::text[]; só com o padrão de aspas ela se perdia).
    SELECT array_agg(DISTINCT v) INTO _valores FROM (
      SELECT m[1] AS v FROM regexp_matches(_def, '''([a-z_]+)''', 'g') AS m
      UNION
      SELECT btrim(x, ' "') FROM unnest(string_to_array(substring(_def FROM '\{([^}]*)\}'), ',')) AS x
    ) s WHERE v ~ '^[a-z_]+$';
  END IF;
  _valores := ARRAY(SELECT DISTINCT unnest(_valores || ARRAY['bruto', 'take', 'gerado', 'audio', 'entrega', 'angulo', 'quadro', 'render', 'amostra', 'elemento']));
  EXECUTE 'ALTER TABLE public.video_arquivos DROP CONSTRAINT IF EXISTS video_arquivos_tipo_check';
  EXECUTE format('ALTER TABLE public.video_arquivos ADD CONSTRAINT video_arquivos_tipo_check CHECK (tipo = ANY (%L::text[]))', _valores);
END $$;

-- ─── 2) Fila de render ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.render_pedidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  versao_id uuid NOT NULL REFERENCES public.video_versoes(id) ON DELETE CASCADE,
  tipo text NOT NULL DEFAULT 'render_final' CHECK (tipo IN ('render_final', 'amostra', 'onda')),
  uid text NOT NULL CHECK (char_length(uid) BETWEEN 8 AND 80),
  -- Projeto como estava no clique (o render sai igual ao que a pessoa viu).
  projeto jsonb CHECK (projeto IS NULL OR (jsonb_typeof(projeto) = 'object' AND pg_column_size(projeto) <= 1500000)),
  revisao integer,
  entrada jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(entrada) = 'object'),
  estado text NOT NULL DEFAULT 'fila' CHECK (estado IN ('fila', 'rodando', 'pronto', 'erro', 'cancelado')),
  etapa text CHECK (etapa IS NULL OR etapa IN ('baixando', 'medindo', 'montando', 'renderizando', 'mixando', 'subindo')),
  progresso numeric(5, 4) NOT NULL DEFAULT 0 CHECK (progresso >= 0 AND progresso <= 1),
  saida_path text,
  arquivo_id uuid REFERENCES public.video_arquivos(id) ON DELETE SET NULL,
  resultado jsonb CHECK (resultado IS NULL OR jsonb_typeof(resultado) = 'object'),
  custo_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (custo_usd >= 0),
  worker text,
  trava_token uuid,
  trava_ate timestamptz,
  tentativas smallint NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  max_tentativas smallint NOT NULL DEFAULT 3 CHECK (max_tentativas BETWEEN 1 AND 5),
  erro_codigo text,
  erro_mensagem text CHECK (erro_mensagem IS NULL OR char_length(erro_mensagem) <= 600),
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  iniciado_em timestamptz,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  concluido_em timestamptz,
  UNIQUE (client_id, uid)
);

COMMENT ON TABLE public.render_pedidos IS
  'Frente EDT (30/09): fila de render da Mesa Edição (vídeo inteiro, amostra de 8 a 15 s, onda do áudio). Worker local puxa pela RPC render_pedidos_pegar; a tela só lê.';

-- Um ativo por versão e tipo (pedir de novo devolve o mesmo).
CREATE UNIQUE INDEX IF NOT EXISTS render_pedidos_ativo_unico
  ON public.render_pedidos (versao_id, tipo) WHERE estado IN ('fila', 'rodando');
CREATE INDEX IF NOT EXISTS render_pedidos_pendentes
  ON public.render_pedidos (criado_em) WHERE estado IN ('fila', 'rodando');
CREATE INDEX IF NOT EXISTS render_pedidos_da_versao
  ON public.render_pedidos (versao_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS render_pedidos_do_cliente
  ON public.render_pedidos (client_id, criado_em DESC);

ALTER TABLE public.render_pedidos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS render_pedidos_equipe_le ON public.render_pedidos;
CREATE POLICY render_pedidos_equipe_le ON public.render_pedidos
  FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid())) AND public.can_access_client(client_id));

REVOKE ALL ON public.render_pedidos FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.render_pedidos FROM authenticated;
GRANT SELECT ON public.render_pedidos TO authenticated;
GRANT ALL ON public.render_pedidos TO service_role;

-- ─── 3) Workers vistos (a tela diz "a máquina parece desligada") ──────────────────────
CREATE TABLE IF NOT EXISTS public.render_workers (
  nome text PRIMARY KEY CHECK (char_length(nome) BETWEEN 1 AND 80),
  visto_em timestamptz NOT NULL DEFAULT now(),
  versao text CHECK (versao IS NULL OR char_length(versao) <= 40)
);

ALTER TABLE public.render_workers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS render_workers_equipe_le ON public.render_workers;
CREATE POLICY render_workers_equipe_le ON public.render_workers
  FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid())));
REVOKE ALL ON public.render_workers FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.render_workers FROM authenticated;
GRANT SELECT ON public.render_workers TO authenticated;
GRANT ALL ON public.render_workers TO service_role;

-- ─── 4) Pegar o próximo pedido (só service_role: o worker) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.render_pedidos_pegar(_token uuid, _worker text, _trava_segundos integer DEFAULT 600, _versao text DEFAULT NULL)
RETURNS SETOF public.render_pedidos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r public.render_pedidos;
BEGIN
  IF _token IS NULL OR _worker IS NULL OR char_length(_worker) NOT BETWEEN 1 AND 80 THEN
    RETURN;
  END IF;

  INSERT INTO public.render_workers (nome, visto_em, versao)
  VALUES (_worker, now(), left(_versao, 40))
  ON CONFLICT (nome) DO UPDATE SET visto_em = now(), versao = COALESCE(left(EXCLUDED.versao, 40), public.render_workers.versao);

  -- Trava vencida com as tentativas no fim: vira erro (sem laço).
  UPDATE public.render_pedidos
     SET estado = 'erro', erro_codigo = 'tentativas_esgotadas',
         erro_mensagem = 'O render parou várias vezes na máquina da agência. Peça de novo.',
         trava_token = NULL, trava_ate = NULL, concluido_em = now(), atualizado_em = now()
   WHERE estado = 'rodando' AND trava_ate < now() AND tentativas + 1 >= max_tentativas;

  -- Pedido esquecido na fila por mais de 24 h sai dela.
  UPDATE public.render_pedidos
     SET estado = 'cancelado', erro_codigo = 'expirou',
         erro_mensagem = 'O pedido ficou na fila mais de um dia (máquina desligada?). Peça de novo.',
         concluido_em = now(), atualizado_em = now()
   WHERE estado = 'fila' AND criado_em < now() - interval '24 hours';

  SELECT p.* INTO _r
    FROM public.render_pedidos p
   WHERE p.estado = 'fila' OR (p.estado = 'rodando' AND p.trava_ate < now())
   -- A onda e a amostra passam na frente do vídeo inteiro (são curtas e destravam a conversa).
   ORDER BY CASE p.tipo WHEN 'onda' THEN 0 WHEN 'amostra' THEN 1 ELSE 2 END, p.criado_em
   LIMIT 1
   FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.render_pedidos
     SET estado = 'rodando',
         tentativas = CASE WHEN _r.estado = 'rodando' THEN _r.tentativas + 1 ELSE _r.tentativas END,
         trava_token = _token,
         trava_ate = now() + make_interval(secs => GREATEST(_trava_segundos, 60)),
         worker = _worker,
         etapa = 'baixando',
         iniciado_em = COALESCE(iniciado_em, now()),
         atualizado_em = now()
   WHERE id = _r.id
   RETURNING * INTO _r;
  RETURN NEXT _r;
END;
$$;

-- Progresso: renova a trava. Devolve false quando o pedido não é mais deste token (cancelado,
-- vencido e pego por outro): o worker para.
CREATE OR REPLACE FUNCTION public.render_pedidos_progresso(_id uuid, _token uuid, _etapa text, _progresso numeric, _trava_segundos integer DEFAULT 600)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _n integer;
BEGIN
  UPDATE public.render_pedidos
     SET etapa = _etapa,
         progresso = LEAST(1, GREATEST(0, COALESCE(_progresso, 0))),
         trava_ate = now() + make_interval(secs => GREATEST(_trava_segundos, 60)),
         atualizado_em = now()
   WHERE id = _id AND trava_token = _token AND estado = 'rodando';
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.render_pedidos_concluir(_id uuid, _token uuid, _saida_path text, _arquivo_id uuid, _resultado jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _n integer;
BEGIN
  UPDATE public.render_pedidos
     SET estado = 'pronto', etapa = NULL, progresso = 1,
         saida_path = _saida_path, arquivo_id = _arquivo_id,
         resultado = CASE WHEN _resultado IS NULL OR jsonb_typeof(_resultado) <> 'object' THEN '{}'::jsonb ELSE _resultado END,
         trava_token = NULL, trava_ate = NULL,
         concluido_em = now(), atualizado_em = now()
   WHERE id = _id AND trava_token = _token AND estado = 'rodando';
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.render_pedidos_falhar(_id uuid, _token uuid, _codigo text, _mensagem text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _n integer;
BEGIN
  UPDATE public.render_pedidos
     SET estado = 'erro', etapa = NULL,
         erro_codigo = left(COALESCE(_codigo, 'erro'), 60),
         erro_mensagem = left(COALESCE(_mensagem, 'O render falhou.'), 600),
         trava_token = NULL, trava_ate = NULL,
         concluido_em = now(), atualizado_em = now()
   WHERE id = _id AND trava_token = _token AND estado = 'rodando';
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.render_pedidos_pegar(uuid, text, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.render_pedidos_progresso(uuid, uuid, text, numeric, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.render_pedidos_concluir(uuid, uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.render_pedidos_falhar(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.render_pedidos_pegar(uuid, text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.render_pedidos_progresso(uuid, uuid, text, numeric, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.render_pedidos_concluir(uuid, uuid, text, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.render_pedidos_falhar(uuid, uuid, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';

-- Conferência (só leitura):
-- select pg_get_constraintdef(oid) from pg_constraint where conname = 'video_arquivos_tipo_check';
-- select estado, tipo, count(*) from public.render_pedidos group by 1, 2;
-- select nome, visto_em from public.render_workers order by visto_em desc;
