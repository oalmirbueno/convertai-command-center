-- Rotina diária dos contratos (frente CON2, 30/09/2026): às 8h17 de Brasília,
-- a função contratos (acao rotina_vencimentos, com x-cron-secret) olha os
-- contratos assinados que vencem dentro do aviso do dono (padrão 30 dias):
-- prepara o rascunho de renovação (uma vez por contrato), grava o aviso na
-- trilha e avisa os admins no sino. Também avisa os admins das assinaturas
-- pendentes há mais dias que o lembrete do dono (padrão 3), com o link para a
-- mensagem pronta. Nada é enviado ao cliente: a pessoa usa o lembrete pronto.
-- Idempotente (desagenda antes de agendar).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'contratos-vencimentos-diario';
    PERFORM cron.schedule('contratos-vencimentos-diario', '17 11 * * *', $cron$
      select net.http_post(
        url := 'https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/contratos',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key'),
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        body := jsonb_build_object('acao', 'rotina_vencimentos'),
        timeout_milliseconds := 120000
      );
    $cron$);
  END IF;
END $$;

-- Conferência (só leitura, depois de aplicar e publicar a função):
-- select schedule, active from cron.job where jobname = 'contratos-vencimentos-diario';
-- Voltar atrás: select cron.unschedule(jobid) from cron.job where jobname = 'contratos-vencimentos-diario';
