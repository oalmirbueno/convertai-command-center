-- Frente BRF2 (30/09/2026): briefing mais completo.
--
-- 1. briefings ganha o controle do lembrete (quantos, o último enviado pela equipe e o último aviso
--    automático), o registro do "Preencher com IA" (para o Desfazer) e o da exportação para o contexto
--    (para o Desfazer). As perguntas extras do projeto ficam na cópia do modelo do link
--    (briefings.modelo_conteudo, bloco "extras"), sem coluna nova.
-- 2. briefing_transcricoes: cada resposta por áudio no link público (duração, custo, estado). O áudio
--    não é guardado: só o texto volta para o campo. Tetos por briefing contra abuso (a função
--    briefing-publico reserva pela RPC briefing_transcricao_reservar, com a linha do briefing travada).
-- 3. briefing_lembretes_do_dia(): aviso diário para a equipe dos links parados ou vencendo (a mensagem
--    pronta está na tela; o painel não manda nada ao cliente). Cron 'briefing-lembretes-diarios' às
--    12h UTC (9h em São Paulo), direto no banco (sem função e sem segredo).
--
-- Segurança: nada abre para anon. Transcrições só a service_role escreve; a equipe lê pelo RLS de
-- sempre (is_staff + can_access_client). Só amplia e é idempotente. Apagar = arquivar.

-- ---------------------------------------------------------------------------
-- 1. briefings: colunas novas
-- ---------------------------------------------------------------------------
ALTER TABLE public.briefings ADD COLUMN IF NOT EXISTS lembretes integer NOT NULL DEFAULT 0;
ALTER TABLE public.briefings ADD COLUMN IF NOT EXISTS ultimo_lembrete_em timestamptz;
ALTER TABLE public.briefings ADD COLUMN IF NOT EXISTS lembrete_avisado_em timestamptz;
ALTER TABLE public.briefings ADD COLUMN IF NOT EXISTS preenchido_ia jsonb;
ALTER TABLE public.briefings ADD COLUMN IF NOT EXISTS exportado jsonb;

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'briefings_lembretes_check') THEN
    ALTER TABLE public.briefings ADD CONSTRAINT briefings_lembretes_check CHECK (lembretes >= 0 AND lembretes <= 50);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'briefings_preenchido_ia_objeto') THEN
    ALTER TABLE public.briefings ADD CONSTRAINT briefings_preenchido_ia_objeto CHECK (preenchido_ia IS NULL OR jsonb_typeof(preenchido_ia) = 'object');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'briefings_exportado_objeto') THEN
    ALTER TABLE public.briefings ADD CONSTRAINT briefings_exportado_objeto CHECK (exportado IS NULL OR jsonb_typeof(exportado) = 'object');
  END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS briefings_abertos_idx ON public.briefings (expira_em) WHERE submitted IS NOT TRUE AND arquivado_em IS NULL;

-- ---------------------------------------------------------------------------
-- 2. briefing_transcricoes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.briefing_transcricoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  briefing_id uuid NOT NULL REFERENCES public.briefings (id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  campo text CHECK (campo IS NULL OR campo ~ '^[A-Za-z][A-Za-z0-9_]{0,48}$'),
  segundos numeric(8, 2) NOT NULL CHECK (segundos > 0 AND segundos <= 300),
  status text NOT NULL DEFAULT 'reservada' CHECK (status IN ('reservada', 'pronta', 'falhou')),
  caracteres integer,
  custo_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (custo_usd >= 0),
  erro text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  concluido_em timestamptz
);

CREATE INDEX IF NOT EXISTS briefing_transcricoes_briefing_idx ON public.briefing_transcricoes (briefing_id, criado_em);
CREATE INDEX IF NOT EXISTS briefing_transcricoes_cliente_idx ON public.briefing_transcricoes (client_id);

ALTER TABLE public.briefing_transcricoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.briefing_transcricoes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.briefing_transcricoes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.briefing_transcricoes TO service_role;

DROP POLICY IF EXISTS briefing_transcricoes_equipe_le ON public.briefing_transcricoes;
CREATE POLICY briefing_transcricoes_equipe_le ON public.briefing_transcricoes
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) AND public.can_access_client(client_id));

-- Reserva a transcrição (só a função briefing-publico, com a chave de serviço): trava a linha do
-- briefing, confere o estado (aberto, com cliente) e os tetos (40 por briefing, 45 minutos no total,
-- 6 por minuto). Reserva presa há mais de 10 minutos não conta.
CREATE OR REPLACE FUNCTION public.briefing_transcricao_reservar(_token text, _campo text, _segundos numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b public.briefings%ROWTYPE;
  _qtd integer;
  _total numeric;
  _ultimo_minuto integer;
  _id uuid;
BEGIN
  IF _token IS NULL OR length(_token) < 20 OR length(_token) > 80 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'inexistente');
  END IF;
  IF _segundos IS NULL OR _segundos <= 0 OR _segundos > 300 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'longo');
  END IF;
  IF _campo IS NOT NULL AND _campo !~ '^[A-Za-z][A-Za-z0-9_]{0,48}$' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'campo_invalido');
  END IF;

  SELECT * INTO b FROM public.briefings WHERE token = _token AND arquivado_em IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'inexistente');
  END IF;
  IF b.submitted IS TRUE THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'enviado');
  END IF;
  IF b.expira_em IS NOT NULL AND b.expira_em <= now() THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'expirado');
  END IF;
  IF b.client_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sem_cliente');
  END IF;

  SELECT count(*), COALESCE(sum(t.segundos), 0), count(*) FILTER (WHERE t.criado_em > now() - interval '1 minute')
    INTO _qtd, _total, _ultimo_minuto
    FROM public.briefing_transcricoes t
   WHERE t.briefing_id = b.id
     AND (t.status = 'pronta' OR (t.status = 'reservada' AND t.criado_em > now() - interval '10 minutes'));

  IF _qtd >= 40 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'muitas');
  END IF;
  IF _total + _segundos > 2700 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'cota');
  END IF;
  IF _ultimo_minuto >= 6 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'devagar');
  END IF;

  INSERT INTO public.briefing_transcricoes (briefing_id, client_id, campo, segundos, status)
  VALUES (b.id, b.client_id, _campo, round(_segundos, 2), 'reservada')
  RETURNING id INTO _id;

  RETURN jsonb_build_object('ok', true, 'transcricao_id', _id, 'briefing_id', b.id, 'client_id', b.client_id);
END;
$$;

REVOKE ALL ON FUNCTION public.briefing_transcricao_reservar(text, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.briefing_transcricao_reservar(text, text, numeric) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Aviso diário de lembrete (a mesma régua de precisaDeLembrete em briefing-editor.ts)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.briefing_lembretes_do_dia()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  _n integer := 0;
  _dias integer;
BEGIN
  FOR r IN
    SELECT b.id, b.client_id, b.created_at, b.expira_em, b.modelo, b.modelo_conteudo,
           COALESCE(NULLIF(p.company_name, ''), p.full_name, 'cliente') AS nome
      FROM public.briefings b
      LEFT JOIN public.profiles p ON p.id = b.client_id
     WHERE b.submitted IS NOT TRUE
       AND b.arquivado_em IS NULL
       AND b.client_id IS NOT NULL
       AND (b.expira_em IS NULL OR b.expira_em > now())
       AND COALESCE(b.lembretes, 0) < 3
       AND (b.lembrete_avisado_em IS NULL OR b.lembrete_avisado_em < now() - interval '3 days')
       AND (b.ultimo_lembrete_em IS NULL OR b.ultimo_lembrete_em < now() - interval '3 days')
       AND (
         (b.created_at < now() - interval '3 days' AND (b.rascunho_salvo_em IS NULL OR b.rascunho_salvo_em < now() - interval '2 days'))
         OR (b.expira_em IS NOT NULL AND b.expira_em <= now() + interval '3 days')
       )
     ORDER BY b.expira_em NULLS LAST
     LIMIT 200
  LOOP
    _dias := GREATEST(0, date_part('day', now() - r.created_at)::integer);
    BEGIN
      PERFORM public.avisar_equipe_do_cliente(
        r.client_id,
        format('Lembrete: o briefing de %s (%s) está aberto há %s dias. A mensagem pronta está no painel.', r.nome, public.briefing_nome_do_modelo(r.modelo, r.modelo_conteudo), _dias),
        'request',
        '/briefings?briefing=' || r.id::text || '&lembrete=1'
      );
      UPDATE public.briefings SET lembrete_avisado_em = now() WHERE id = r.id;
      _n := _n + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'briefing_lembretes_do_dia: aviso do briefing % falhou: %', r.id, SQLERRM;
    END;
  END LOOP;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.briefing_lembretes_do_dia() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.briefing_lembretes_do_dia() TO service_role;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'briefing-lembretes-diarios';
    PERFORM cron.schedule('briefing-lembretes-diarios', '0 12 * * *', 'select public.briefing_lembretes_do_dia();');
  END IF;
END
$cron$;

-- Conferência (só leitura, depois de aplicar):
--   select column_name from information_schema.columns where table_name = 'briefings' and column_name in ('lembretes','preenchido_ia','exportado');
--   select has_table_privilege('anon', 'public.briefing_transcricoes', 'select');   -- false
--   select has_function_privilege('anon', 'public.briefing_transcricao_reservar(text,text,numeric)', 'execute'); -- false
--   select schedule from cron.job where jobname = 'briefing-lembretes-diarios';     -- 0 12 * * *
-- Voltar atrás: select cron.unschedule(jobid) from cron.job where jobname = 'briefing-lembretes-diarios';
