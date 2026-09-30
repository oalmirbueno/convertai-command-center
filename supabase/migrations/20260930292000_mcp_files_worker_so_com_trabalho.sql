-- FN-11 (30/09/2026): o cron mcp-files-worker-drain só chama a função quando há trabalho na fila.
--
-- Antes: o pg_cron acordava a mcp-files-worker a cada minuto sem olhar a fila
-- (1.363 chamadas por pg_net em 24 h, p50 de 301 ms). Em 48 h entraram só 2
-- jobs em file_processing_jobs, e os dois vieram por chamada direta. Cada
-- chamada vazia sobe uma instância da função e consulta o banco.
--
-- Agora o comando só faz o net.http_post quando existe job que o worker
-- pegaria (a mesma condição de claimNext em supabase/functions/mcp-files-worker/index.ts:
-- status pending ou failed com attempts abaixo de MAX_ATTEMPTS). O cron
-- continua rodando a cada minuto; sem job elegível o select não devolve linha
-- e nada é chamado. A chamada direta (kickWorker, job_id, file_id) não muda.
--
-- O 3 da condição é o MAX_ATTEMPTS da função (MCP_FILE_MAX_ATTEMPTS, padrão 3).
-- Se esse segredo for criado com outro valor, esta condição muda junto.
--
-- O job existia só no banco; agora mora aqui, com os mesmos cabeçalhos lidos
-- do cofre (email_queue_service_role_key e cron_secret, os nomes que o comando
-- atual usa). Idempotente: desagenda pelo nome e agenda de novo. Nada muda em
-- tabela, RLS ou função.

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'mcp-files-worker-drain';
    PERFORM cron.schedule('mcp-files-worker-drain', '* * * * *', $job$
      select net.http_post(
        url := 'https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/mcp-files-worker',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key'),
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        body := '{}'::jsonb
      ) as request_id
      where exists (
        select 1 from public.file_processing_jobs
        where status in ('pending', 'failed') and attempts < 3
      );
    $job$);
  END IF;
END
$cron$;

-- Conferência (só leitura, depois de aplicar):
--   select schedule, command ilike '%where exists%' as so_com_trabalho from cron.job where jobname = 'mcp-files-worker-drain';
--   -- '* * * * *', true
--   select status, count(*) from cron.job_run_details d join cron.job j using (jobid)
--    where j.jobname = 'mcp-files-worker-drain' and d.start_time > now() - interval '1 hour' group by 1;
--   -- só succeeded; com a fila vazia, nenhuma chamada nova em net._http_response para a mcp-files-worker.
-- Voltar atrás: agendar de novo o mesmo comando sem o "where exists (...)".
