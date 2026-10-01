-- Frente TCN (rodada 3, parte 1, 01/10/2026): "Trocar o cenário com a pessoa fixa", na Mesa Edição.
--
-- O que entra:
--   1) video_cenarios: um pedido de troca por linha (vídeo de origem e trecho,
--      cenário escrito ou da galeria, qualidade Rápido/Cinema/Aleph, saída em
--      1, 2 ou 3 faixas, amostras baratas, a final em passos e o resultado).
--      Só a equipe com acesso ao cliente LÊ; escrita só pela função (service_role).
--   2) render_pedidos ganha o tipo 'cenario' (preparar o trecho e compor a
--      final no worker da agência), ligado à troca por cenario_id. Só worker
--      com a versão "tcn-" pega esse tipo (worker antigo não sabe fazer).
--   3) O cron de 1 min da coleta (video-pedidos-coletar, SQL 20260930321000)
--      também acorda quando há troca em andamento; a função coleta as duas.
--
-- Idempotente e só amplia: IF NOT EXISTS, constraints recriadas com a lista
-- antiga + o tipo novo, função de pegar com a MESMA assinatura. Nada muda em
-- quem lê o quê nas tabelas que já existiam.

-- ─── 1) Trocas de cenário ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.video_cenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Versão da edição onde o resultado entra (nula quando veio do acervo sem editor aberto).
  versao_id uuid REFERENCES public.video_versoes(id) ON DELETE SET NULL,
  -- Vídeo de origem (acervo) e o caminho no bucket mesa (sempre na pasta do cliente).
  arquivo_id uuid REFERENCES public.video_arquivos(id) ON DELETE SET NULL,
  fonte_bucket text NOT NULL DEFAULT 'mesa' CHECK (fonte_bucket = 'mesa'),
  fonte_path text NOT NULL CHECK (char_length(fonte_path) BETWEEN 3 AND 500),
  -- Clipe da edição de onde veio (para entrar logo depois dele).
  clipe_ref text CHECK (clipe_ref IS NULL OR char_length(clipe_ref) <= 80),
  entrada_s numeric(10, 3) NOT NULL CHECK (entrada_s >= 0),
  saida_s numeric(10, 3) NOT NULL,
  cenario text NOT NULL CHECK (char_length(cenario) BETWEEN 3 AND 600),
  galeria text CHECK (galeria IS NULL OR char_length(galeria) <= 40),
  qualidade text NOT NULL DEFAULT 'rapido' CHECK (qualidade IN ('rapido', 'cinema', 'aleph')),
  layout text NOT NULL DEFAULT 'cheio' CHECK (layout IN ('cheio', 'duas_faixas', 'tres_faixas')),
  formato text CHECK (formato IS NULL OR formato IN ('9:16', '4:5', '1:1', '16:9')),
  estado text NOT NULL DEFAULT 'amostrando' CHECK (estado IN ('amostrando', 'amostra', 'preparando', 'gerando', 'compondo', 'pronto', 'erro', 'descartado')),
  -- Quadro de onde as amostras saíram e as amostras: [{ n, path, custo_usd, uso_id, modelo }].
  quadro_path text CHECK (quadro_path IS NULL OR char_length(quadro_path) <= 500),
  amostras jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(amostras) = 'array'),
  escolha smallint CHECK (escolha IS NULL OR escolha BETWEEN 1 AND 3),
  -- preparo, envios ao provedor, composição e fundo limpo (formato em modulos/troca-de-cenario.ts).
  passos jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(passos) = 'object'),
  custo_estimado jsonb CHECK (custo_estimado IS NULL OR jsonb_typeof(custo_estimado) = 'object'),
  custo_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (custo_usd >= 0),
  resultado_arquivo_id uuid REFERENCES public.video_arquivos(id) ON DELETE SET NULL,
  erro text CHECK (erro IS NULL OR char_length(erro) <= 600),
  -- Termo de imagem: quem confirmou que a pessoa do vídeo autorizou, e quando (sem ele não gera).
  autorizacao jsonb NOT NULL CHECK (
    jsonb_typeof(autorizacao) = 'object'
    AND (autorizacao->>'confirmada') = 'true'
    AND (autorizacao->>'em') IS NOT NULL
  ),
  chave text NOT NULL CHECK (char_length(chave) BETWEEN 8 AND 120),
  inserido_em timestamptz,
  consultado_em timestamptz,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (saida_s > entrada_s),
  UNIQUE (client_id, chave)
);

COMMENT ON TABLE public.video_cenarios IS
  'Frente TCN (01/10): trocar o cenário com a pessoa fixa (Mesa Edição). Amostra barata, final em passos (preparar no worker, provedor, compor no worker). Escrita só pela função mesa-videos.';

CREATE INDEX IF NOT EXISTS video_cenarios_do_cliente ON public.video_cenarios (client_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS video_cenarios_da_versao ON public.video_cenarios (versao_id, criado_em DESC) WHERE versao_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS video_cenarios_em_andamento ON public.video_cenarios (consultado_em NULLS FIRST) WHERE estado IN ('preparando', 'gerando', 'compondo');

ALTER TABLE public.video_cenarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS video_cenarios_equipe_le ON public.video_cenarios;
CREATE POLICY video_cenarios_equipe_le ON public.video_cenarios
  FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid())) AND public.can_access_client(client_id));

REVOKE ALL ON public.video_cenarios FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.video_cenarios FROM authenticated;
GRANT SELECT ON public.video_cenarios TO authenticated;
GRANT ALL ON public.video_cenarios TO service_role;

-- ─── 2) Fila de render: o tipo 'cenario' ───────────────────────────────────────

DO $$
BEGIN
  IF to_regclass('public.render_pedidos') IS NULL THEN
    RAISE NOTICE 'render_pedidos ainda não existe (SQL 20260930080000 da frente EDT): aplique antes deste.';
    RETURN;
  END IF;
  ALTER TABLE public.render_pedidos ADD COLUMN IF NOT EXISTS cenario_id uuid REFERENCES public.video_cenarios(id) ON DELETE CASCADE;
  ALTER TABLE public.render_pedidos DROP CONSTRAINT IF EXISTS render_pedidos_tipo_check;
  ALTER TABLE public.render_pedidos ADD CONSTRAINT render_pedidos_tipo_check CHECK (tipo IN ('render_final', 'amostra', 'onda', 'cena_hf', 'batidas', 'cenario'));
  ALTER TABLE public.render_pedidos DROP CONSTRAINT IF EXISTS render_pedidos_alvo_check;
  -- Cena e batidas pertencem a um filme; a troca de cenário, à troca; o resto, a uma versão (como era).
  ALTER TABLE public.render_pedidos ADD CONSTRAINT render_pedidos_alvo_check CHECK (
    (tipo IN ('cena_hf', 'batidas') AND motion_id IS NOT NULL)
    OR (tipo = 'cenario' AND cenario_id IS NOT NULL)
    OR (tipo NOT IN ('cena_hf', 'batidas', 'cenario') AND versao_id IS NOT NULL)
  );
END $$;

-- Um ativo por troca e fase (preparar ou compor): pedir de novo devolve o mesmo.
CREATE UNIQUE INDEX IF NOT EXISTS render_pedidos_cenario_ativo_unico
  ON public.render_pedidos (cenario_id, (entrada->>'fase')) WHERE cenario_id IS NOT NULL AND estado IN ('fila', 'rodando');
CREATE INDEX IF NOT EXISTS render_pedidos_da_troca
  ON public.render_pedidos (cenario_id, criado_em DESC) WHERE cenario_id IS NOT NULL;

-- Pegar: a mesma regra da 20260930180000 (frente MOT); o preparo da troca (curto) passa na frente
-- do vídeo inteiro, e só o worker que sabe fazer ('tcn-' na versão) pega o tipo 'cenario'.
CREATE OR REPLACE FUNCTION public.render_pedidos_pegar(_token uuid, _worker text, _trava_segundos integer DEFAULT 600, _versao text DEFAULT NULL)
RETURNS SETOF public.render_pedidos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r public.render_pedidos;
  _sabe_cenario boolean := coalesce(_versao, '') LIKE '%tcn-%';
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
   ORDER BY CASE
              WHEN p.tipo IN ('onda', 'batidas') THEN 0
              WHEN p.tipo = 'amostra' THEN 1
              WHEN p.tipo = 'cena_hf' AND coalesce(p.entrada->>'modo', '') IN ('still', 'amostra') THEN 1
              WHEN p.tipo = 'cenario' AND coalesce(p.entrada->>'fase', '') = 'preparar' THEN 1
              WHEN p.tipo IN ('cena_hf', 'cenario') THEN 2
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

-- ─── 3) Cron da coleta: também com troca em andamento ─────────────────────────

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
      );
    $job$);
  END IF;
END
$cron$;

NOTIFY pgrst, 'reload schema';

-- Conferência (só leitura, depois de aplicar):
--   select pg_get_constraintdef(oid) from pg_constraint where conname in ('render_pedidos_tipo_check', 'render_pedidos_alvo_check');
--   select command ilike '%video_cenarios%' as olha_trocas from cron.job where jobname = 'video-pedidos-coletar';
--   select estado, count(*) from public.video_cenarios group by 1;
-- Voltar atrás (sem perder dado): o cron volta ao texto da 20260930321000; a tabela pode ficar.
