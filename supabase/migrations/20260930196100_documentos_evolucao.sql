-- Frente BRF2 (30/09/2026): documento de entrega mais completo.
--
-- 1. documentos_entrega ganha o modelo (mensal, projeto, campanha, site, identidade), o rascunho que a
--    equipe edita antes do PDF (texto de cada seção, provas escolhidas e na ordem, números com fonte,
--    próximos passos, capa com a identidade do cliente), quem e quando mexeu no rascunho, a origem
--    (equipe ou agenda) e a mensagem do envio.
-- 2. documentos_agenda: a agenda dos documentos mensais automáticos por cliente (e marca). No dia
--    marcado, o cron chama a função documentos (acao 'agenda_cron', com x-cron-secret), que monta o
--    RASCUNHO do mês anterior só com o que aconteceu (sem IA, sem custo) e avisa a equipe. Gerar o PDF
--    e mandar ao cliente continuam com Confirmar na tela.
--
-- RLS: a equipe lê (is_staff + can_access_client); só a service_role escreve (tudo passa pela
-- função documentos). Só amplia, idempotente. Apagar = arquivar (a agenda desliga, não some).

-- ---------------------------------------------------------------------------
-- 1. documentos_entrega: colunas novas
-- ---------------------------------------------------------------------------
ALTER TABLE public.documentos_entrega ADD COLUMN IF NOT EXISTS modelo text;
ALTER TABLE public.documentos_entrega ADD COLUMN IF NOT EXISTS rascunho jsonb;
ALTER TABLE public.documentos_entrega ADD COLUMN IF NOT EXISTS rascunho_em timestamptz;
ALTER TABLE public.documentos_entrega ADD COLUMN IF NOT EXISTS rascunho_por uuid;
ALTER TABLE public.documentos_entrega ADD COLUMN IF NOT EXISTS origem_rascunho text;
ALTER TABLE public.documentos_entrega ADD COLUMN IF NOT EXISTS mensagem_envio text;

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documentos_entrega_modelo_check') THEN
    ALTER TABLE public.documentos_entrega ADD CONSTRAINT documentos_entrega_modelo_check
      CHECK (modelo IS NULL OR modelo IN ('mensal', 'projeto', 'campanha', 'site', 'identidade'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documentos_entrega_rascunho_objeto') THEN
    ALTER TABLE public.documentos_entrega ADD CONSTRAINT documentos_entrega_rascunho_objeto
      CHECK (rascunho IS NULL OR jsonb_typeof(rascunho) = 'object');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documentos_entrega_origem_rascunho_check') THEN
    ALTER TABLE public.documentos_entrega ADD CONSTRAINT documentos_entrega_origem_rascunho_check
      CHECK (origem_rascunho IS NULL OR origem_rascunho IN ('equipe', 'agenda'));
  END IF;
END
$migration$;

-- ---------------------------------------------------------------------------
-- 2. documentos_agenda
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.documentos_agenda (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  marca_id uuid,
  ligada boolean NOT NULL DEFAULT false,
  dia smallint NOT NULL DEFAULT 3 CHECK (dia BETWEEN 1 AND 28),
  modelo text NOT NULL DEFAULT 'mensal' CHECK (modelo IN ('mensal', 'projeto', 'campanha', 'site', 'identidade')),
  ultimo_mes text CHECK (ultimo_mes IS NULL OR ultimo_mes ~ '^\d{4}-\d{2}$'),
  ultima_execucao_em timestamptz,
  ultimo_erro text,
  ligada_por uuid,
  ligada_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS documentos_agenda_uma_por_marca
  ON public.documentos_agenda (client_id, COALESCE(marca_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS documentos_agenda_ligadas ON public.documentos_agenda (dia) WHERE ligada;

ALTER TABLE public.documentos_agenda ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS documentos_agenda_equipe_le ON public.documentos_agenda;
CREATE POLICY documentos_agenda_equipe_le ON public.documentos_agenda
  FOR SELECT TO authenticated
  USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

REVOKE ALL ON public.documentos_agenda FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.documentos_agenda TO authenticated;
GRANT ALL ON public.documentos_agenda TO service_role;

COMMENT ON TABLE public.documentos_agenda IS
  'Frente BRF2 (30/09/2026): agenda do documento mensal automático por cliente/marca. O cron só monta o rascunho (sem IA) e avisa a equipe.';

-- Cron diário às 11h15 UTC (8h15 em São Paulo): a função decide quem está no dia.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'documentos-agenda-mensal';
    PERFORM cron.schedule('documentos-agenda-mensal', '15 11 * * *', $job$
      select net.http_post(
        url := 'https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/documentos',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key'),
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        body := jsonb_build_object('acao', 'agenda_cron'),
        timeout_milliseconds := 300000
      );
    $job$);
  END IF;
END
$cron$;

-- Conferência (só leitura, depois de aplicar):
--   select column_name from information_schema.columns where table_name = 'documentos_entrega' and column_name in ('modelo','rascunho','mensagem_envio');
--   select has_table_privilege('authenticated', 'public.documentos_agenda', 'INSERT');  -- false
--   select schedule from cron.job where jobname = 'documentos-agenda-mensal';           -- 15 11 * * *
-- Voltar atrás: select cron.unschedule(jobid) from cron.job where jobname = 'documentos-agenda-mensal';
--               update public.documentos_agenda set ligada = false;
