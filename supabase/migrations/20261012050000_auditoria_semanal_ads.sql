-- 12/10/2026 (claude-ads, /ads audit semanal): o robô audita as contas de anúncios toda segunda de
-- manhã. A função mesa-ads (auditoria_cron, só com x-cron-secret) pega até 2 clientes por chamada,
-- com conta ativa e sem auditoria nos últimos 6 dias; 7 chamadas (6h às 12h, horário do servidor)
-- cobrem as contas de hoje. Código puro: sem IA, sem custo, sem tocar na conta.
-- Os segredos vêm do vault no momento da chamada (nada fica escrito aqui).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'mesa-ads-auditoria-semanal';
    PERFORM cron.schedule('mesa-ads-auditoria-semanal', '17 6-12 * * 1', $cron$
      select net.http_post(
        url := 'https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/mesa-ads',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key'),
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        body := jsonb_build_object('acao', 'auditoria_cron'),
        timeout_milliseconds := 300000
      );
    $cron$);
  END IF;
END $$;

-- Conferência (só leitura): select jobname, schedule from cron.job where jobname = 'mesa-ads-auditoria-semanal';
-- Desligar: select cron.unschedule(jobid) from cron.job where jobname = 'mesa-ads-auditoria-semanal';
