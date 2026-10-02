-- Mesa Edição (02/10/2026): tratar vídeo (tirar a legenda gravada e melhorar a qualidade).
--
-- O que entra:
--   1) video_tratamentos: um tratamento por linha (vídeo de origem, ação, motor,
--      faixa da legenda ou nível da melhora, AMOSTRA e depois o VÍDEO INTEIRO,
--      cada fase em passos: preparar no worker, provedor, montar no worker).
--      Só a equipe com acesso ao cliente LÊ; escrita só pela função (service_role).
--   2) render_pedidos ganha o tipo 'tratamento' (preparar as partes e montar com
--      o áudio original no worker da agência), ligado ao tratamento por
--      tratamento_id. Só worker com "trt-" na versão pega esse tipo.
--   3) O cron de 1 min da coleta (video-pedidos-coletar) também acorda quando há
--      tratamento em andamento; a função anda os três (pedidos, trocas e tratamentos).
--
-- O organizador da Entrada, o espelho no Workspace e o gerador de legenda NÃO
-- precisam de tabela nova (usam video_arquivos.grupo/origem, video_acoes e
-- workspace_nodes como já existem).
--
-- Idempotente e só amplia: IF NOT EXISTS, constraints recriadas com a lista
-- antiga + o tipo novo, função de pegar com a MESMA assinatura e a mesma regra
-- da 20261002100000 (render na nuvem). Nada muda em quem lê o quê.

-- ─── 1) Tratamentos de vídeo ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.video_tratamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Vídeo de origem (acervo) e o caminho no bucket mesa (sempre na pasta do cliente).
  arquivo_id uuid REFERENCES public.video_arquivos(id) ON DELETE SET NULL,
  fonte_bucket text NOT NULL DEFAULT 'mesa' CHECK (fonte_bucket = 'mesa'),
  fonte_path text NOT NULL CHECK (char_length(fonte_path) BETWEEN 3 AND 500),
  nome_do_antes text NOT NULL DEFAULT 'Vídeo' CHECK (char_length(nome_do_antes) BETWEEN 1 AND 200),
  acao text NOT NULL CHECK (acao IN ('tirar_legenda', 'melhorar')),
  motor text NOT NULL CHECK (char_length(motor) BETWEEN 2 AND 60),
  -- Faixa da legenda (fração do quadro), nível e fator da melhora, medidas do vídeo.
  parametros jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(parametros) = 'object'),
  estado text NOT NULL DEFAULT 'preparando' CHECK (estado IN ('preparando', 'gerando', 'compondo', 'amostra', 'pronto', 'erro', 'descartado')),
  fase text NOT NULL DEFAULT 'amostra' CHECK (fase IN ('amostra', 'final')),
  -- Passos de cada fase (formato em supabase/functions/mesa-videos/modulos/tratamento-de-video.ts).
  amostra jsonb CHECK (amostra IS NULL OR jsonb_typeof(amostra) = 'object'),
  final jsonb CHECK (final IS NULL OR jsonb_typeof(final) = 'object'),
  custo_estimado jsonb CHECK (custo_estimado IS NULL OR jsonb_typeof(custo_estimado) = 'object'),
  custo_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (custo_usd >= 0),
  resultado_arquivo_id uuid REFERENCES public.video_arquivos(id) ON DELETE SET NULL,
  erro text CHECK (erro IS NULL OR char_length(erro) <= 600),
  chave text NOT NULL CHECK (char_length(chave) BETWEEN 8 AND 120),
  consultado_em timestamptz,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, chave)
);

COMMENT ON TABLE public.video_tratamentos IS
  'Mesa Edição (02/10): tirar a legenda gravada e melhorar a qualidade do vídeo. Amostra com custo antes, depois o vídeo inteiro; preparar e montar no worker com o áudio original. Escrita só pela função mesa-videos.';

CREATE INDEX IF NOT EXISTS video_tratamentos_do_cliente ON public.video_tratamentos (client_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS video_tratamentos_do_arquivo ON public.video_tratamentos (arquivo_id, criado_em DESC) WHERE arquivo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS video_tratamentos_em_andamento ON public.video_tratamentos (consultado_em NULLS FIRST) WHERE estado IN ('preparando', 'gerando', 'compondo');

ALTER TABLE public.video_tratamentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS video_tratamentos_equipe_le ON public.video_tratamentos;
CREATE POLICY video_tratamentos_equipe_le ON public.video_tratamentos
  FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid())) AND public.can_access_client(client_id));

REVOKE ALL ON public.video_tratamentos FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.video_tratamentos FROM authenticated;
GRANT SELECT ON public.video_tratamentos TO authenticated;
GRANT ALL ON public.video_tratamentos TO service_role;

-- ─── 2) Fila de render: o tipo 'tratamento' ───────────────────────────────────

DO $$
BEGIN
  IF to_regclass('public.render_pedidos') IS NULL THEN
    RAISE NOTICE 'render_pedidos ainda não existe (SQL 20260930080000 da frente EDT): aplique antes deste.';
    RETURN;
  END IF;
  ALTER TABLE public.render_pedidos ADD COLUMN IF NOT EXISTS tratamento_id uuid REFERENCES public.video_tratamentos(id) ON DELETE CASCADE;
  ALTER TABLE public.render_pedidos DROP CONSTRAINT IF EXISTS render_pedidos_tipo_check;
  ALTER TABLE public.render_pedidos ADD CONSTRAINT render_pedidos_tipo_check CHECK (tipo IN ('render_final', 'amostra', 'onda', 'cena_hf', 'batidas', 'cenario', 'tratamento'));
  ALTER TABLE public.render_pedidos DROP CONSTRAINT IF EXISTS render_pedidos_alvo_check;
  -- Cena e batidas pertencem a um filme; a troca de cenário, à troca; o tratamento, ao tratamento; o resto, a uma versão.
  ALTER TABLE public.render_pedidos ADD CONSTRAINT render_pedidos_alvo_check CHECK (
    (tipo IN ('cena_hf', 'batidas') AND motion_id IS NOT NULL)
    OR (tipo = 'cenario' AND cenario_id IS NOT NULL)
    OR (tipo = 'tratamento' AND tratamento_id IS NOT NULL)
    OR (tipo NOT IN ('cena_hf', 'batidas', 'cenario', 'tratamento') AND versao_id IS NOT NULL)
  );
END $$;

-- Um ativo por tratamento, fase do worker (preparar ou compor) e etapa (amostra ou final).
CREATE UNIQUE INDEX IF NOT EXISTS render_pedidos_tratamento_ativo_unico
  ON public.render_pedidos (tratamento_id, (entrada->>'fase'), (entrada->>'etapa')) WHERE tratamento_id IS NOT NULL AND estado IN ('fila', 'rodando');
CREATE INDEX IF NOT EXISTS render_pedidos_do_tratamento
  ON public.render_pedidos (tratamento_id, criado_em DESC) WHERE tratamento_id IS NOT NULL;

-- Pegar: a mesma regra da 20261002100000 (render na nuvem); o preparo do tratamento
-- (curto) passa na frente do vídeo inteiro, e só o worker que sabe fazer ('trt-' na
-- versão) pega o tipo 'tratamento'.
CREATE OR REPLACE FUNCTION public.render_pedidos_pegar(_token uuid, _worker text, _trava_segundos integer DEFAULT 600, _versao text DEFAULT NULL)
RETURNS SETOF public.render_pedidos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r public.render_pedidos;
  _sabe_cenario boolean := coalesce(_versao, '') LIKE '%tcn-%';
  _sabe_tratamento boolean := coalesce(_versao, '') LIKE '%trt-%';
  -- Nuvem ligada: quem não é da nuvem deixa os pedidos novos para ela por 75 s.
  _reservar boolean := coalesce(_worker, '') NOT LIKE 'nuvem-%' AND EXISTS (SELECT 1 FROM public.render_nuvem WHERE id AND ligada);
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
   WHERE (p.estado = 'fila' OR (p.estado = 'rodando' AND p.trava_ate < now()))
     AND (p.tipo <> 'cenario' OR _sabe_cenario)
     AND (p.tipo <> 'tratamento' OR _sabe_tratamento)
     AND (NOT _reservar OR p.estado = 'rodando' OR p.criado_em < now() - interval '75 seconds')
   ORDER BY CASE
              WHEN p.tipo IN ('onda', 'batidas') THEN 0
              WHEN p.tipo = 'amostra' THEN 1
              WHEN p.tipo = 'cena_hf' AND coalesce(p.entrada->>'modo', '') IN ('still', 'amostra') THEN 1
              WHEN p.tipo = 'cenario' AND coalesce(p.entrada->>'fase', '') = 'preparar' THEN 1
              WHEN p.tipo = 'tratamento' AND (coalesce(p.entrada->>'fase', '') = 'preparar' OR coalesce(p.entrada->>'etapa', '') = 'amostra') THEN 1
              WHEN p.tipo IN ('cena_hf', 'cenario', 'tratamento') THEN 2
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

-- ─── 3) Cron da coleta: também com tratamento em andamento ────────────────────

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'video-pedidos-coletar';
    PERFORM cron.schedule('video-pedidos-coletar', '* * * * *', $job$
      select net.http_post(
        url := 'https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/mesa-videos',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key'),
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        body := jsonb_build_object('acao', 'gerar_coletar', 'limite', 8),
        timeout_milliseconds := 120000
      ) as request_id
      where exists (
        select 1 from public.video_pedidos
        where estado in ('enviado', 'gerando', 'baixando')
      ) or exists (
        select 1 from public.video_cenarios
        where estado in ('preparando', 'gerando', 'compondo')
      ) or exists (
        select 1 from public.video_tratamentos
        where estado in ('preparando', 'gerando', 'compondo')
      );
    $job$);
  END IF;
END
$cron$;

NOTIFY pgrst, 'reload schema';

-- Conferência (só leitura, depois de aplicar):
--   select pg_get_constraintdef(oid) from pg_constraint where conname in ('render_pedidos_tipo_check', 'render_pedidos_alvo_check');
--   select command ilike '%video_tratamentos%' as olha_tratamentos from cron.job where jobname = 'video-pedidos-coletar';
--   select estado, count(*) from public.video_tratamentos group by 1;
-- Voltar atrás (sem perder dado): o cron e a função de pegar voltam ao texto da
-- 20261002100000; a tabela e a coluna podem ficar.
