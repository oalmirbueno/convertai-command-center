-- Render na nuvem pela Modal (02/10/2026).
--
-- O PC da agência é fraco para render. A Modal liga uma máquina forte só
-- quando há pedido, renderiza com o mesmo worker (nome "nuvem-render") e
-- desliga sozinha. Regras:
-- - public.render_nuvem (uma linha) diz se a nuvem está ligada e para onde
--   avisar; só o servidor lê e escreve (RLS sem política);
-- - o segredo do aviso nasce aqui dentro, no Vault (render_nuvem_segredo),
--   e ninguém o digita nem o vê; a Modal recebe o mesmo valor pela RPC
--   render_nuvem_segredo (só service_role);
-- - pedido novo avisa a Modal na hora (pg_net, assíncrono: o pedido nunca
--   falha por causa do aviso);
-- - com a nuvem ligada, o PC só pega pedido com mais de 75 s na fila (ou um
--   render parado): se a nuvem cair, o PC assume sozinho.
-- Só acrescenta; a assinatura de render_pedidos_pegar não muda. Idempotente.

CREATE TABLE IF NOT EXISTS public.render_nuvem (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  ligada boolean NOT NULL DEFAULT false,
  url_acordar text CHECK (url_acordar IS NULL OR url_acordar ~ '^https://[a-z0-9.-]+\.modal\.run(/.*)?$'),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.render_nuvem ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.render_nuvem FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.render_nuvem TO service_role;
INSERT INTO public.render_nuvem (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

DO $segredo$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'render_nuvem_segredo') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'render_nuvem_segredo', 'Aviso do banco para o render na nuvem (Modal)');
  END IF;
END;
$segredo$;

CREATE OR REPLACE FUNCTION public.render_nuvem_segredo()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'render_nuvem_segredo' LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.render_nuvem_segredo() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.render_nuvem_segredo() TO service_role;

-- Aviso à Modal quando entra pedido (uma vez por comando de INSERT).
CREATE OR REPLACE FUNCTION public.render_nuvem_acordar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _url text;
BEGIN
  SELECT url_acordar INTO _url FROM public.render_nuvem WHERE id AND ligada;
  IF _url IS NOT NULL THEN
    BEGIN
      PERFORM net.http_post(
        url := _url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-aceleriq-segredo', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'render_nuvem_segredo' LIMIT 1)
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 10000
      );
    EXCEPTION WHEN OTHERS THEN
      -- O aviso é ajuda; o pedido entra na fila de qualquer jeito (a Modal também olha a fila a cada minuto).
      NULL;
    END;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.render_nuvem_acordar() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS render_pedidos_acordar_nuvem ON public.render_pedidos;
CREATE TRIGGER render_pedidos_acordar_nuvem
  AFTER INSERT ON public.render_pedidos
  FOR EACH STATEMENT EXECUTE FUNCTION public.render_nuvem_acordar();

-- A fila: igual à da troca de cenário (20260930327000), mais a reserva da nuvem.
CREATE OR REPLACE FUNCTION public.render_pedidos_pegar(_token uuid, _worker text, _trava_segundos integer DEFAULT 600, _versao text DEFAULT NULL)
RETURNS SETOF public.render_pedidos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r public.render_pedidos;
  _sabe_cenario boolean := coalesce(_versao, '') LIKE '%tcn-%';
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
     AND (NOT _reservar OR p.estado = 'rodando' OR p.criado_em < now() - interval '75 seconds')
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
