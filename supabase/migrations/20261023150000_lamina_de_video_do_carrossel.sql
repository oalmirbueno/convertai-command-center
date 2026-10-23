-- Lâmina de vídeo do carrossel estilo post do X (22/10/2026).
--
-- O Template do Estúdio guarda a lâmina em PNG (moldura desenhada por código, com o quadro do
-- vídeo no bloco). Quando o bloco é um vídeo, a estudio-arte põe um pedido 'lamina_video' na
-- fila de render: o worker (versão com 'lam-') baixa o PNG e o vídeo, monta o MP4 com o vídeo
-- inteiro no retângulo do bloco (ffmpeg, workers/render/laminaVideo.ts) e sobe para
-- <cliente>/estudio/template/videos/. O pedido pertence ao trabalho do Estúdio (estudio_trabalho_id).
--
-- NÃO APLICADA nesta entrega. Aplicar com `supabase db query --linked -f <este arquivo>` e conferir
-- pelas consultas do fim. Sem ela, o pedido do vídeo volta "banco_sem_fila" e a lâmina fica em PNG.

DO $$
BEGIN
  IF to_regclass('public.render_pedidos') IS NULL THEN
    RAISE NOTICE 'render_pedidos ainda não existe (SQL 20260930080000 da frente EDT): aplique antes deste.';
    RETURN;
  END IF;
  ALTER TABLE public.render_pedidos ADD COLUMN IF NOT EXISTS estudio_trabalho_id uuid REFERENCES public.estudio_trabalhos(id) ON DELETE CASCADE;
  ALTER TABLE public.render_pedidos DROP CONSTRAINT IF EXISTS render_pedidos_tipo_check;
  ALTER TABLE public.render_pedidos ADD CONSTRAINT render_pedidos_tipo_check CHECK (tipo IN ('render_final', 'amostra', 'onda', 'cena_hf', 'batidas', 'cenario', 'tratamento', 'lamina_video'));
  ALTER TABLE public.render_pedidos DROP CONSTRAINT IF EXISTS render_pedidos_alvo_check;
  ALTER TABLE public.render_pedidos ADD CONSTRAINT render_pedidos_alvo_check CHECK (
    (tipo IN ('cena_hf', 'batidas') AND motion_id IS NOT NULL)
    OR (tipo = 'cenario' AND cenario_id IS NOT NULL)
    OR (tipo = 'tratamento' AND tratamento_id IS NOT NULL)
    OR (tipo = 'lamina_video' AND estudio_trabalho_id IS NOT NULL)
    OR (tipo NOT IN ('cena_hf', 'batidas', 'cenario', 'tratamento', 'lamina_video') AND versao_id IS NOT NULL)
  );
END $$;

-- Um ativo por lâmina e versão do PNG (pedir de novo devolve o mesmo).
CREATE UNIQUE INDEX IF NOT EXISTS render_pedidos_lamina_ativa_unica
  ON public.render_pedidos (estudio_trabalho_id, (entrada->>'ordem'), (entrada->>'versao'))
  WHERE estudio_trabalho_id IS NOT NULL AND estado IN ('fila', 'rodando');
CREATE INDEX IF NOT EXISTS render_pedidos_do_estudio
  ON public.render_pedidos (estudio_trabalho_id, criado_em DESC) WHERE estudio_trabalho_id IS NOT NULL;

-- Pegar: o texto da 20261002160000 (tratamento) + a lâmina de vídeo, só para o worker com 'lam-'.
-- A lâmina é curta (até 60 s, um ffmpeg): passa na frente do vídeo inteiro.
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
  _sabe_lamina boolean := coalesce(_versao, '') LIKE '%lam-%';
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
     AND (p.tipo <> 'lamina_video' OR _sabe_lamina)
     AND (NOT _reservar OR p.estado = 'rodando' OR p.criado_em < now() - interval '75 seconds')
   ORDER BY CASE
              WHEN p.tipo IN ('onda', 'batidas') THEN 0
              WHEN p.tipo IN ('amostra', 'lamina_video') THEN 1
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

NOTIFY pgrst, 'reload schema';

-- Conferência (só leitura, depois de aplicar):
--   select pg_get_constraintdef(oid) from pg_constraint where conname in ('render_pedidos_tipo_check', 'render_pedidos_alvo_check');
--   select prosrc ilike '%lam-%' as sabe_lamina from pg_proc where proname = 'render_pedidos_pegar';
-- Voltar atrás (sem perder dado): a função de pegar volta ao texto da 20261002160000; a coluna pode ficar.
