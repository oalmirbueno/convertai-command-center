-- Frente VGN (30/09/2026): coleta dos vídeos gerados sem depender da tela aberta.
--
-- Diagnóstico com dados reais (só leitura, 30/09):
--   * video_pedidos tinha UM pedido de geração na vida (ângulo, 28/09, cliente
--     com US$ 10 na carteira). O fal aceitou (request_id), a tela consultou uma
--     vez 38 s depois e nunca mais; 10 min depois o prazo encerrou o pedido SEM
--     perguntar ao provedor. O resultado pronto no fal nunca foi buscado e
--     nada foi cobrado.
--   * A consulta só acontecia com a etapa Resultados aberta ou no botão Conferir.
--
-- Agora o pg_cron acorda a mesa-videos a cada minuto, mas SÓ quando existe
-- pedido em andamento (mesmo desenho do mcp-files-worker-drain, 20260930292000):
-- sem pedido, o select não devolve linha e nada é chamado. A função só aceita
-- do cron as ações motores_sincronizar e gerar_coletar (x-cron-secret).
-- A coleta consulta cada pedido UMA vez por rodada (trava por consultado_em,
-- a mesma da tela, que vai a agora + 3 min e cobre a rodada inteira; a cobrança
-- de cada variação é gravada antes do download), guarda o que ficou pronto no
-- acervo do cliente (criado_por = quem pediu) e cobra só a variação pronta, uma
-- vez. Rodada de até 45 s. Erro do provedor não é tentado de novo.
--
-- Idempotente: desagenda pelo nome e agenda de novo. Índice novo só amplia.
-- Nada muda em tabela, RLS, CHECK ou função.

CREATE INDEX IF NOT EXISTS video_pedidos_em_andamento_idx
  ON public.video_pedidos (consultado_em NULLS FIRST)
  WHERE estado IN ('enviado', 'gerando', 'baixando');

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'video-pedidos-coletar';
    PERFORM cron.schedule('video-pedidos-coletar', '* * * * *', $job$
      select net.http_post(
        url := 'https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/mesa-videos',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key'),
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        body := jsonb_build_object('acao', 'gerar_coletar', 'limite', 8),
        timeout_milliseconds := 120000
      ) as request_id
      where exists (
        select 1 from public.video_pedidos
        where estado in ('enviado', 'gerando', 'baixando')
      );
    $job$);
  END IF;
END
$cron$;

-- Conferência (só leitura, depois de aplicar):
--   select schedule, active, command ilike '%where exists%' as so_com_trabalho from cron.job where jobname = 'video-pedidos-coletar';
--   -- '* * * * *', true, true
--   select estado, count(*) from public.video_pedidos group by 1;
--   select status, count(*) from cron.job_run_details d join cron.job j using (jobid)
--    where j.jobname = 'video-pedidos-coletar' and d.start_time > now() - interval '1 hour' group by 1;
-- Voltar atrás: select cron.unschedule(jobid) from cron.job where jobname = 'video-pedidos-coletar';
