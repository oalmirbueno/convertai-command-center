-- Frente MTR (30/09/2026): Estado dos motores.
--
-- Diagnóstico com dados de produção (30/09, 19:30 UTC):
-- * render_workers e motor_executores VAZIAS: nenhum worker (render nem motor de
--   código) jamais bateu ponto. Os 5 pedidos de cena da Mesa Motion (cena_hf) e o
--   trabalho do site ficaram "na fila" porque não havia máquina puxando a fila.
-- * O worker de render só aparecia ao olhar a fila: no meio de um render longo o
--   "visto_em" envelhecia e a tela dizia "máquina desligada".
--
-- Esta migration só AMPLIA render_workers com o que o worker novo informa a cada
-- 30 s (workers/render/batida.ts): o que a máquina tem (capacidades), o pedido em
-- curso e quando o worker subiu. O Estado dos motores (Configurações, função
-- motores-estado) lê isso para dizer o que falta ("HyperFrames não instalado").
--
-- Idempotente. RLS inalterada: a equipe lê (is_staff); só a service_role escreve
-- (o worker, com a chave numa variável de ambiente da máquina, nunca em arquivo).
-- Sem esta migration o worker novo grava só a linha mínima (nome, visto_em, versão).
--
-- Também troca a pegada do motor de código (motor_pegar_trabalho, MESMA assinatura,
-- security definer, só service_role): solta o trabalho órfão (máquina caiu no meio)
-- e cancela o que ficou mais de 48 h na fila, com o evento "fim" para a tela.

ALTER TABLE public.render_workers ADD COLUMN IF NOT EXISTS capacidades jsonb;
ALTER TABLE public.render_workers ADD COLUMN IF NOT EXISTS pedido_id uuid;
ALTER TABLE public.render_workers ADD COLUMN IF NOT EXISTS iniciado_em timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.render_workers'::regclass AND conname = 'render_workers_capacidades_check'
  ) THEN
    ALTER TABLE public.render_workers
      ADD CONSTRAINT render_workers_capacidades_check
      CHECK (capacidades IS NULL OR (jsonb_typeof(capacidades) = 'object' AND pg_column_size(capacidades) <= 4000));
  END IF;
END $$;

COMMENT ON COLUMN public.render_workers.capacidades IS
  'Frente MTR: o que a máquina do worker tem (node, ffmpeg, ffprobe, hyperframes, gsap, chrome, faltas). Só o worker escreve.';
COMMENT ON COLUMN public.render_workers.pedido_id IS
  'Frente MTR: pedido de render em curso na última batida (null = olhando a fila).';
COMMENT ON COLUMN public.render_workers.iniciado_em IS
  'Frente MTR: quando o worker subiu (a batida de 30 s mantém visto_em fresco durante o render).';

-- As permissões seguem as da frente EDT (repetidas aqui para a migration valer sozinha).
REVOKE ALL ON public.render_workers FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.render_workers FROM authenticated;
GRANT SELECT ON public.render_workers TO authenticated;
GRANT ALL ON public.render_workers TO service_role;

-- ─── Motor de código: trabalho órfão e fila esquecida (frente MTR) ─────────────
-- Antes: se a máquina caísse no meio, o trabalho ficava "executando" para sempre,
-- travava o projeto (um trabalho por projeto) e prendia o teto na carteira do
-- cliente; um pedido feito com o motor desligado ficava "na fila" sem prazo.
-- Agora, a cada pegada do worker (mesmo desenho da fila de render):
-- * executando/parando há mais de 10 min sem a batida do executor com ESTE
--   trabalho nos últimos 3 min vira falhou/parado, com o motivo e o evento "fim";
-- * na fila há mais de 48 h vira cancelado (solta a reserva), com o evento "fim".
-- O worker bate a cada 30 s com o trabalho em curso (workers/motor-codigo/worker.ts),
-- então trabalho vivo nunca cai aqui.
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

  WITH orfaos AS (
    UPDATE public.motor_trabalhos t
       SET estado = CASE WHEN t.estado = 'parando' THEN 'parado' ELSE 'falhou' END,
           erro = COALESCE(t.erro, 'O motor parou no meio deste trabalho (máquina desligada ou reiniciada). Peça de novo.'),
           terminado_em = now()
     WHERE t.estado IN ('executando', 'parando')
       AND COALESCE(t.pego_em, t.criado_em) < now() - interval '10 minutes'
       AND NOT EXISTS (
         SELECT 1 FROM public.motor_executores e
          WHERE e.nome = t.executor AND e.trabalho_id = t.id AND e.visto_em > now() - interval '3 minutes'
       )
    RETURNING t.id, t.client_id, t.estado, t.custo_usd
  )
  INSERT INTO public.motor_eventos (trabalho_id, client_id, tipo, resumo, dados)
  SELECT o.id, o.client_id, 'fim',
         CASE WHEN o.estado = 'parado' THEN 'Parado: o motor caiu enquanto parava.' ELSE 'Não deu certo: o motor parou no meio (máquina desligada ou reiniciada).' END,
         jsonb_build_object('estado', o.estado, 'custo_usd', o.custo_usd, 'motivo', 'motor_caiu')
    FROM orfaos o;

  WITH esquecidos AS (
    UPDATE public.motor_trabalhos t
       SET estado = 'cancelado',
           erro = 'Ficou mais de 2 dias na fila com o motor desligado. Peça de novo.',
           terminado_em = now()
     WHERE t.estado = 'na_fila' AND t.criado_em < now() - interval '48 hours'
    RETURNING t.id, t.client_id
  )
  INSERT INTO public.motor_eventos (trabalho_id, client_id, tipo, resumo, dados)
  SELECT e.id, e.client_id, 'fim', 'Cancelado: ficou mais de 2 dias na fila com o motor desligado.', jsonb_build_object('estado', 'cancelado', 'custo_usd', 0, 'motivo', 'expirou_na_fila')
    FROM esquecidos e;

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

NOTIFY pgrst, 'reload schema';

-- Conferência (só leitura):
-- select nome, visto_em, versao, capacidades, pedido_id, iniciado_em from public.render_workers order by visto_em desc;
-- select prosrc like '%motor_caiu%' as com_orfaos from pg_proc where proname = 'motor_pegar_trabalho';
