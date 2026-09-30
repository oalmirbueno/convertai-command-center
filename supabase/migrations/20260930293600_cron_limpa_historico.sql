-- Frente PERF-banco (30/09/2026), achado B11: o histórico do pg_cron para de
-- crescer sem fim.
--
-- O problema: cron.job_run_details não tinha limpeza. Em 30/09: 97.991
-- linhas, 33 MB (a maior tabela do banco, ~16% dos ~209 MB), 6.859 linhas nas
-- últimas 24 h (4 jobs rodam a cada minuto), a mais antiga de 02/09.
--
-- A correção: um job diário que apaga o histórico de execução com mais de 14
-- dias. É log de sistema do pg_cron, não dado de cliente: não fere a regra
-- apagar = arquivar. 14 dias bastam para diagnosticar qualquer job (o volume
-- estável fica em ~96 mil linhas). Roda às 04:41 UTC (01:41 em Brasília), sem
-- coincidir com os outros jobs diários. A primeira execução apaga ~20 mil
-- linhas, o que é leve. Sem VACUUM FULL (travaria a tabela; o espaço liberado
-- é reaproveitado) e sem desligar cron.log_run (é o diagnóstico dos jobs).
--
-- Idempotente (desagenda pelo nome antes de agendar). Não aplicar direto: o
-- dono aplica na integração (SQL Editor).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'cron-limpar-historico';
    PERFORM cron.schedule(
      'cron-limpar-historico',
      '41 4 * * *',
      $c$delete from cron.job_run_details where coalesce(end_time, start_time) < now() - interval '14 days'$c$
    );
  END IF;
END
$$;

-- Conferência (só leitura):
-- select jobname, schedule, active from cron.job where jobname = 'cron-limpar-historico';
-- select min(start_time), count(*), pg_size_pretty(pg_total_relation_size('cron.job_run_details')) from cron.job_run_details;
-- Voltar atrás: select cron.unschedule(jobid) from cron.job where jobname = 'cron-limpar-historico';
