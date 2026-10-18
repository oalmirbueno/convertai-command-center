-- 17/10/2026 (rodada 3): a base passou de 11 para 15 agentes (Publicidade, Identidade, Site e Proposta). A
-- pesquisa de terça faz 2 agentes por chamada, uma por hora: 9h23 a 16h23 UTC (8 chamadas, até 16 agentes).
-- A primeira chamada do dia também atualiza o resultado das fichas, cria as fichas dos vencedores (do cliente,
-- dos concorrentes e das referências) e manda o aviso da semana ao admin e ao gestor.
-- Para desligar: select cron.unschedule(jobid) from cron.job where jobname = 'base-dos-agentes-pesquisa-semanal';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'base-dos-agentes-pesquisa-semanal';
    PERFORM cron.schedule('base-dos-agentes-pesquisa-semanal', '23 9-16 * * 2', $cron$
      select net.http_post(
        url := 'https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/base-dos-agentes',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key'),
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        body := jsonb_build_object('acao', 'pesquisa_semanal'),
        timeout_milliseconds := 300000
      );
    $cron$);
  END IF;
END $$;
