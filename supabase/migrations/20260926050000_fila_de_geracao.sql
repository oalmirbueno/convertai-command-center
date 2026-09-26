-- G-01: fila de geração do Estúdio no servidor (frente G, 26/09)
--
-- Bug do dono: "estou gerando para um cliente, abro outro cliente e, quando
-- volto, ele parou". A fila vivia no navegador (laço em AbaEstudio.tsx):
-- tela cheia, abrir outro card ou trocar de cliente remontava a tela e o
-- andamento sumia; a recarga do painel (versão nova publicada) matava o laço;
-- e 3 lâminas em paralelo no mesmo worker estouravam a memória da função
-- (shutdown reason=Memory em 25/09 19:28-19:29, função estudio-arte).
--
-- Agora cada lâmina pedida vira uma linha aqui. A função estudio-arte aceita
-- o pedido (acao enfileirar), responde na hora e processa em segundo plano,
-- um passo por invocação (fundo, gerar, conferir, corrigir). Ao terminar um
-- passo, ela mesma chama o próximo com o login de quem pediu (o acesso ao
-- cliente é conferido em todo passo, como hoje). Se a corrente quebrar (queda
-- do worker, login vencido), o painel aberto de quem pediu, em qualquer tela,
-- retoma a fila a cada 30 s (vigia global). Sem cron: um cron não tem o login
-- de ninguém e precisaria pular a conferência de acesso.
--
-- Travas: um passo só roda com trava_token + trava_ate (7 min). A pegada é
-- serializada por advisory lock e respeita o teto global (3 rodando) e o
-- teto por trabalho (2; 1 no carrossel contínuo). Queda do worker: a trava
-- vence, a linha é retomada com tentativas + 1; com tentativas esgotadas
-- (3), vira erro. Nada repete sem teto e sem espera.
--
-- Idempotente. RLS: equipe lê (is_staff + can_access_client); só service_role escreve.

CREATE TABLE IF NOT EXISTS public.estudio_fila (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  trabalho_id uuid NOT NULL REFERENCES public.estudio_trabalhos(id) ON DELETE CASCADE,
  ordem integer NOT NULL CHECK (ordem BETWEEN 1 AND 60),
  lote_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'fila' CHECK (status IN ('fila', 'rodando', 'feito', 'erro', 'cancelado')),
  etapa text NOT NULL DEFAULT 'gerar' CHECK (etapa IN ('fundo', 'gerar', 'conferir', 'corrigir')),
  paralelo smallint NOT NULL DEFAULT 2 CHECK (paralelo BETWEEN 1 AND 3),
  corrigir_sozinho boolean NOT NULL DEFAULT false,
  rodadas smallint NOT NULL DEFAULT 0 CHECK (rodadas >= 0),
  tentativas smallint NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  max_tentativas smallint NOT NULL DEFAULT 3 CHECK (max_tentativas BETWEEN 1 AND 5),
  passos smallint NOT NULL DEFAULT 0 CHECK (passos >= 0),
  versoes_antes integer,
  trava_token uuid,
  trava_ate timestamptz,
  proxima_em timestamptz NOT NULL DEFAULT now(),
  custo_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (custo_usd >= 0),
  erro_codigo text,
  erro_mensagem text,
  aviso text,
  marca_id uuid,
  pedido_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  iniciado_em timestamptz,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  concluido_em timestamptz
);

COMMENT ON TABLE public.estudio_fila IS
  'Fila de geração do Estúdio (uma linha por lâmina pedida). Processada pela função estudio-arte em segundo plano; a tela só lê. Frente G, 26/09.';

-- Uma lâmina não entra duas vezes na fila enquanto está ativa.
CREATE UNIQUE INDEX IF NOT EXISTS estudio_fila_ativa_unica
  ON public.estudio_fila (trabalho_id, ordem) WHERE status IN ('fila', 'rodando');
CREATE INDEX IF NOT EXISTS estudio_fila_pendentes
  ON public.estudio_fila (pedido_por, proxima_em, criado_em) WHERE status IN ('fila', 'rodando');
CREATE INDEX IF NOT EXISTS estudio_fila_do_trabalho
  ON public.estudio_fila (trabalho_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS estudio_fila_do_cliente
  ON public.estudio_fila (client_id, criado_em DESC);

ALTER TABLE public.estudio_fila ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS estudio_fila_equipe_le ON public.estudio_fila;
CREATE POLICY estudio_fila_equipe_le ON public.estudio_fila
  FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid())) AND public.can_access_client(client_id));

REVOKE ALL ON public.estudio_fila FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.estudio_fila FROM authenticated;
GRANT SELECT ON public.estudio_fila TO authenticated;
GRANT ALL ON public.estudio_fila TO service_role;

-- ---------------------------------------------------------------------------
-- Pegar o próximo passo de quem pediu (só service_role; a função chama com o
-- id do usuário do JWT conferido). Uma pegada por vez (advisory lock): o teto
-- global e o por trabalho valem de verdade, sem corrida.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.estudio_fila_pegar(uuid, integer, integer);
CREATE OR REPLACE FUNCTION public.estudio_fila_pegar(_token uuid, _pedido_por uuid, _global integer DEFAULT 3, _trava_segundos integer DEFAULT 420)
RETURNS SETOF public.estudio_fila
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r public.estudio_fila;
  _rodando integer;
BEGIN
  IF _token IS NULL OR _pedido_por IS NULL THEN
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('estudio_fila_pegar'));

  -- Queda do worker com as tentativas no fim: vira erro (sem laço).
  UPDATE public.estudio_fila
     SET status = 'erro',
         erro_codigo = 'tentativas_esgotadas',
         erro_mensagem = 'A geração desta lâmina parou várias vezes no servidor. Gere de novo.',
         trava_token = NULL, trava_ate = NULL,
         concluido_em = now(), atualizado_em = now()
   WHERE status = 'rodando' AND trava_ate < now() AND tentativas + 1 >= max_tentativas;

  -- Pedido esquecido na fila por mais de 12 h sai dela.
  UPDATE public.estudio_fila
     SET status = 'cancelado', erro_codigo = 'expirou',
         erro_mensagem = 'O pedido ficou na fila tempo demais e saiu dela. Gere de novo.',
         concluido_em = now(), atualizado_em = now()
   WHERE status = 'fila' AND criado_em < now() - interval '12 hours';

  SELECT count(*) INTO _rodando FROM public.estudio_fila WHERE status = 'rodando' AND trava_ate >= now();
  IF _rodando >= GREATEST(_global, 1) THEN
    RETURN;
  END IF;

  SELECT f.* INTO _r
    FROM public.estudio_fila f
   WHERE f.pedido_por = _pedido_por
     AND ((f.status = 'fila' AND f.proxima_em <= now()) OR (f.status = 'rodando' AND f.trava_ate < now()))
     AND (SELECT count(*) FROM public.estudio_fila a
           WHERE a.trabalho_id = f.trabalho_id AND a.status = 'rodando' AND a.trava_ate >= now()) < f.paralelo
   ORDER BY f.proxima_em, f.criado_em, f.ordem
   LIMIT 1
   FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.estudio_fila
     SET status = 'rodando',
         tentativas = CASE WHEN _r.status = 'rodando' THEN _r.tentativas + 1 ELSE _r.tentativas END,
         trava_token = _token,
         trava_ate = now() + make_interval(secs => GREATEST(_trava_segundos, 60)),
         iniciado_em = COALESCE(iniciado_em, now()),
         atualizado_em = now()
   WHERE id = _r.id
   RETURNING * INTO _r;
  RETURN NEXT _r;
END;
$$;

REVOKE ALL ON FUNCTION public.estudio_fila_pegar(uuid, uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.estudio_fila_pegar(uuid, uuid, integer, integer) TO service_role;
