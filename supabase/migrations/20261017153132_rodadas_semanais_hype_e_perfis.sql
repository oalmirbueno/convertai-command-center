-- 17/10/2026: as duas rodadas semanais do Mês (dono: "nunca ser cego, buscar a fundo"; "hype sem clique").
--
-- 1. perfis-instagram-semanal: o monitoramento que estava escrito e desligado em
--    20260926050400_perfis_instagram.sql, agora também com as referências (capturar,
--    ler as imagens e refazer o resumo). Segunda, 9h17 a 14h17 UTC (6h17 a 11h17 em
--    São Paulo), uma chamada por hora, até 4 perfis por chamada, cada perfil no
--    máximo 1 vez por semana, teto de US$ 0,30 por perfil.
-- 2. agente-calendario-hypes-semanal: a busca de hype e de em alta no nicho para
--    cada cliente ativo (proposta nos últimos 45 dias) com pelo menos US$ 1 na
--    carteira de IA e ainda sem a busca da semana. Segunda, 10h47 a 13h47 UTC, uma
--    chamada por hora (cerca de US$ 0,25 por cliente, uma vez por semana).
--
-- Mesmos segredos do cofre das outras rotinas. Para desligar:
--   select cron.unschedule(jobid) from cron.job where jobname in ('perfis-instagram-semanal', 'agente-calendario-hypes-semanal');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('perfis-instagram-semanal', 'agente-calendario-hypes-semanal');

    PERFORM cron.schedule('perfis-instagram-semanal', '17 9-14 * * 1', $cron$
      select net.http_post(
        url := 'https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/perfis-instagram',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key'),
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        body := jsonb_build_object('acao', 'rodada_semanal'),
        timeout_milliseconds := 150000
      );
    $cron$);

    PERFORM cron.schedule('agente-calendario-hypes-semanal', '47 10-13 * * 1', $cron$
      select net.http_post(
        url := 'https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/agente-calendario',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key'),
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        body := jsonb_build_object('acao', 'hypes_da_semana_interno'),
        timeout_milliseconds := 300000
      );
    $cron$);
  END IF;
END $$;
