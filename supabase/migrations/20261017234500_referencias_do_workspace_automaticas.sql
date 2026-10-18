-- 17/10/2026: as referências de design do Workspace entram sozinhas (dono: "a pasta referências de design no
-- Workspace: tudo que entrar lá já entra como aprendizado para o design e ele já usa sem eu precisar pedir").
--
-- A cada 30 minutos o estudio-arte (ação referencias_automaticas_interno, só com o x-cron-secret e a chave de
-- serviço) liga as imagens novas das pastas "Refer..." de todos os clientes (pasta que cita outra marca do
-- cliente liga àquela marca) e lê a técnica de até 12 que ainda não foram lidas, na carteira de cada cliente
-- (pula quem tem menos de US$ 0,30). Na direção, o Jev escolhe entre as lidas as que servem ao pedido.
-- Para desligar: select cron.unschedule(jobid) from cron.job where jobname = 'estudio-referencias-automaticas';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'estudio-referencias-automaticas';
    PERFORM cron.schedule('estudio-referencias-automaticas', '7,37 * * * *', $cron$
      select net.http_post(
        url := 'https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/estudio-arte',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key'),
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        body := jsonb_build_object('acao', 'referencias_automaticas_interno'),
        timeout_milliseconds := 300000
      );
    $cron$);
  END IF;
END $$;
