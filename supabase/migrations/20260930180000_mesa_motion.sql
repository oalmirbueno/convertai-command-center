-- Frente MOT (30/09/2026): Mesa Motion (/mesa-motion). Apresentação de empresa
-- em motion e filme cinematográfico da marca, por cliente e marca (marca_id).
--
-- 1) mesa_cliente_escolhas: a Mesa Motion ganha o seu valor ('motion');
-- 2) motion_filmes: um filme por linha com o que cada etapa decidiu
--    (insumos, entrevista, BRAND.md e beat sheet, 3 storyboards, cenas,
--    renders, crítica, som, montagem e entrega);
-- 3) render_pedidos (frente EDT) amplia: tipos 'cena_hf' (cena HyperFrames:
--    still, amostra de 5 s ou final com alfa) e 'batidas' (mapa de batidas da
--    trilha), ligados ao filme por motion_id (versao_id fica opcional só
--    para esses dois tipos); um ativo por filme, tipo e chave (cena, modo,
--    formato); a pegada põe as cenas curtas na frente do vídeo inteiro;
-- 4) video_arquivos: tipos 'cena' (clipe com alfa) e 'still';
-- 5) portfolio_itens: o portfólio da agência, só com autorização do cliente
--    registrada (quem, quando e como).
--
-- Só amplia, idempotente. RLS: a equipe com acesso ao cliente lê; escrita só
-- pela service_role (tudo passa pela função mesa-motion e pelo worker).
-- Apagar = arquivar.

-- ─── 1) Seletor de clientes ─────────────────────────────────────────────────

DO $$
DECLARE
  _def text;
  _valores text[];
BEGIN
  IF to_regclass('public.mesa_cliente_escolhas') IS NULL THEN
    RETURN;
  END IF;
  SELECT pg_get_constraintdef(oid) INTO _def FROM pg_constraint
  WHERE conrelid = 'public.mesa_cliente_escolhas'::regclass AND conname = 'mesa_cliente_escolhas_mesa_check';
  SELECT array_agg(DISTINCT m[1]) INTO _valores FROM regexp_matches(coalesce(_def, ''), '''([a-z_]+)''', 'g') AS m;
  _valores := coalesce(_valores, '{}'::text[]) || coalesce((SELECT array_agg(DISTINCT btrim(v)) FROM regexp_matches(coalesce(_def, ''), '\{([^}]*)\}', 'g') AS mm, unnest(string_to_array(mm[1], ',')) AS v), '{}'::text[]);
  _valores := ARRAY(SELECT DISTINCT unnest(_valores || ARRAY['organica', 'ads', 'foto', 'publicidade', 'videos', 'roteiros', 'edicao', 'identidade', 'proposta', 'site', 'motion']));
  EXECUTE 'ALTER TABLE public.mesa_cliente_escolhas DROP CONSTRAINT IF EXISTS mesa_cliente_escolhas_mesa_check';
  EXECUTE format('ALTER TABLE public.mesa_cliente_escolhas ADD CONSTRAINT mesa_cliente_escolhas_mesa_check CHECK (mesa = ANY (%L::text[]))', _valores);
END $$;

-- ─── 2) Filmes ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.motion_filmes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  marca_id uuid,
  nome text NOT NULL CHECK (char_length(nome) BETWEEN 1 AND 120),
  tipo text NOT NULL DEFAULT 'apresentacao' CHECK (tipo IN ('apresentacao', 'filme_marca')),
  etapa text NOT NULL DEFAULT 'insumos' CHECK (etapa IN ('insumos', 'entrevista', 'brand', 'storyboards', 'stills', 'construcao', 'critica', 'som', 'render')),
  formatos text[] NOT NULL DEFAULT ARRAY['9:16']::text[] CHECK (formatos <@ ARRAY['9:16', '1:1', '4:5', '16:9']::text[] AND cardinality(formatos) BETWEEN 1 AND 4),
  insumos jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(insumos) = 'object'),
  entrevista jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(entrevista) = 'object'),
  brand jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(brand) = 'object'),
  storyboards jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(storyboards) = 'array'),
  storyboard_escolhido smallint CHECK (storyboard_escolhido IS NULL OR storyboard_escolhido BETWEEN 0 AND 2),
  cenas jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(cenas) = 'array'),
  renders jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(renders) = 'array'),
  critica jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(critica) = 'object'),
  som jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(som) = 'object'),
  montagem jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(montagem) = 'object'),
  entrega jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(entrega) = 'object'),
  modelo text,
  custo_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (custo_usd >= 0),
  arquivado_em timestamptz,
  arquivado_por uuid,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT motion_filmes_tamanho CHECK (pg_column_size(cenas) + pg_column_size(storyboards) + pg_column_size(renders) <= 1500000)
);

COMMENT ON TABLE public.motion_filmes IS
  'Frente MOT (30/09): Mesa Motion. Um filme (apresentação em motion ou filme da marca) por linha; cenas HyperFrames renderizadas pela fila render_pedidos (tipo cena_hf).';

CREATE INDEX IF NOT EXISTS motion_filmes_cliente_idx ON public.motion_filmes (client_id, atualizado_em DESC);

CREATE OR REPLACE FUNCTION public.motion_filmes_tocar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS motion_filmes_tocar ON public.motion_filmes;
CREATE TRIGGER motion_filmes_tocar
  BEFORE UPDATE ON public.motion_filmes
  FOR EACH ROW EXECUTE FUNCTION public.motion_filmes_tocar();

ALTER TABLE public.motion_filmes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS motion_filmes_equipe_le ON public.motion_filmes;
CREATE POLICY motion_filmes_equipe_le ON public.motion_filmes
  FOR SELECT TO authenticated USING (public.is_staff((SELECT auth.uid())) AND public.can_access_client(client_id));

REVOKE ALL ON public.motion_filmes FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.motion_filmes FROM authenticated;
GRANT SELECT ON public.motion_filmes TO authenticated;
GRANT ALL ON public.motion_filmes TO service_role;

-- ─── 3) Fila de render: cenas HyperFrames e batidas ──────────────────────────

DO $$
BEGIN
  IF to_regclass('public.render_pedidos') IS NULL THEN
    RAISE NOTICE 'render_pedidos ainda não existe (SQL 20260930080000 da frente EDT): aplique antes deste.';
    RETURN;
  END IF;
  ALTER TABLE public.render_pedidos ADD COLUMN IF NOT EXISTS motion_id uuid REFERENCES public.motion_filmes(id) ON DELETE CASCADE;
  ALTER TABLE public.render_pedidos ALTER COLUMN versao_id DROP NOT NULL;
  ALTER TABLE public.render_pedidos DROP CONSTRAINT IF EXISTS render_pedidos_tipo_check;
  ALTER TABLE public.render_pedidos ADD CONSTRAINT render_pedidos_tipo_check CHECK (tipo IN ('render_final', 'amostra', 'onda', 'cena_hf', 'batidas'));
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.render_pedidos'::regclass AND conname = 'render_pedidos_alvo_check') THEN
    -- Cena e batidas pertencem a um filme; o resto continua pertencendo a uma versão (como era).
    ALTER TABLE public.render_pedidos ADD CONSTRAINT render_pedidos_alvo_check CHECK (
      (tipo IN ('cena_hf', 'batidas') AND motion_id IS NOT NULL) OR (tipo NOT IN ('cena_hf', 'batidas') AND versao_id IS NOT NULL)
    );
  END IF;
END $$;

-- Um ativo por filme, tipo e chave (cena:modo:formato ou o caminho da trilha): pedir de novo devolve o mesmo.
CREATE UNIQUE INDEX IF NOT EXISTS render_pedidos_motion_ativo_unico
  ON public.render_pedidos (motion_id, tipo, (entrada->>'chave')) WHERE motion_id IS NOT NULL AND estado IN ('fila', 'rodando');
CREATE INDEX IF NOT EXISTS render_pedidos_do_filme
  ON public.render_pedidos (motion_id, criado_em DESC) WHERE motion_id IS NOT NULL;

-- Pegar: mesma regra da frente EDT; as batidas e as cenas curtas (still e amostra) passam na frente.
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

  UPDATE public.render_pedidos
     SET estado = 'erro', erro_codigo = 'tentativas_esgotadas',
         erro_mensagem = 'O render parou várias vezes na máquina da agência. Peça de novo.',
         trava_token = NULL, trava_ate = NULL, concluido_em = now(), atualizado_em = now()
   WHERE estado = 'rodando' AND trava_ate < now() AND tentativas + 1 >= max_tentativas;

  UPDATE public.render_pedidos
     SET estado = 'cancelado', erro_codigo = 'expirou',
         erro_mensagem = 'O pedido ficou na fila mais de um dia (máquina desligada?). Peça de novo.',
         concluido_em = now(), atualizado_em = now()
   WHERE estado = 'fila' AND criado_em < now() - interval '24 hours';

  SELECT p.* INTO _r
    FROM public.render_pedidos p
   WHERE p.estado = 'fila' OR (p.estado = 'rodando' AND p.trava_ate < now())
   ORDER BY CASE
              WHEN p.tipo IN ('onda', 'batidas') THEN 0
              WHEN p.tipo = 'amostra' THEN 1
              WHEN p.tipo = 'cena_hf' AND coalesce(p.entrada->>'modo', '') IN ('still', 'amostra') THEN 1
              WHEN p.tipo = 'cena_hf' THEN 2
              ELSE 3
            END,
            p.criado_em
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

REVOKE ALL ON FUNCTION public.render_pedidos_pegar(uuid, text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.render_pedidos_pegar(uuid, text, integer, text) TO service_role;

-- ─── 4) Arquivos: cena com alfa e still ───────────────────────────────────────

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
    _valores := ARRAY['bruto', 'take', 'gerado', 'audio', 'entrega', 'angulo', 'quadro', 'render', 'amostra', 'elemento'];
  ELSE
    SELECT array_agg(DISTINCT v) INTO _valores FROM (
      SELECT m[1] AS v FROM regexp_matches(_def, '''([a-z_]+)''', 'g') AS m
      UNION
      SELECT btrim(x, ' "') FROM unnest(string_to_array(substring(_def FROM '\{([^}]*)\}'), ',')) AS x
    ) s WHERE v ~ '^[a-z_]+$';
  END IF;
  _valores := ARRAY(SELECT DISTINCT unnest(coalesce(_valores, '{}'::text[]) || ARRAY['bruto', 'take', 'gerado', 'audio', 'entrega', 'angulo', 'quadro', 'render', 'amostra', 'elemento', 'cena', 'still']));
  EXECUTE 'ALTER TABLE public.video_arquivos DROP CONSTRAINT IF EXISTS video_arquivos_tipo_check';
  EXECUTE format('ALTER TABLE public.video_arquivos ADD CONSTRAINT video_arquivos_tipo_check CHECK (tipo = ANY (%L::text[]))', _valores);
END $$;

-- ─── 5) Portfólio da agência (só com autorização do cliente) ─────────────────

CREATE TABLE IF NOT EXISTS public.portfolio_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  origem text NOT NULL CHECK (origem IN ('motion_filme')),
  origem_id uuid NOT NULL,
  titulo text NOT NULL CHECK (char_length(titulo) BETWEEN 1 AND 160),
  descricao text CHECK (descricao IS NULL OR char_length(descricao) <= 1200),
  arquivos jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(arquivos) = 'array'),
  miniatura_path text,
  -- Autorização do cliente: quem autorizou, quando e como (e-mail, grupo, contrato). Sem ela, não entra.
  autorizacao jsonb NOT NULL CHECK (
    jsonb_typeof(autorizacao) = 'object'
    AND char_length(coalesce(autorizacao->>'quem', '')) BETWEEN 2 AND 120
    AND char_length(coalesce(autorizacao->>'como', '')) BETWEEN 3 AND 300
    AND (autorizacao->>'em') IS NOT NULL
  ),
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  arquivado_em timestamptz,
  UNIQUE (origem, origem_id)
);

CREATE INDEX IF NOT EXISTS portfolio_itens_cliente_idx ON public.portfolio_itens (client_id, criado_em DESC);

ALTER TABLE public.portfolio_itens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS portfolio_itens_equipe_le ON public.portfolio_itens;
CREATE POLICY portfolio_itens_equipe_le ON public.portfolio_itens
  FOR SELECT TO authenticated USING (public.is_staff((SELECT auth.uid())) AND public.can_access_client(client_id));

REVOKE ALL ON public.portfolio_itens FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.portfolio_itens FROM authenticated;
GRANT SELECT ON public.portfolio_itens TO authenticated;
GRANT ALL ON public.portfolio_itens TO service_role;

NOTIFY pgrst, 'reload schema';

-- Conferir depois de aplicar (só leitura):
-- select pg_get_constraintdef(oid) from pg_constraint where conname in ('render_pedidos_tipo_check', 'render_pedidos_alvo_check', 'video_arquivos_tipo_check', 'mesa_cliente_escolhas_mesa_check');
-- select count(*) from public.motion_filmes;
-- select policyname, tablename from pg_policies where tablename in ('motion_filmes', 'portfolio_itens');
