-- 26/11 (dono): anúncios "em tempo real". Números da conta e campanhas: de 1 h para ~10 min
-- (o cron roda a cada 10 min); peças e números por criativo: de 30 min para ~20 min.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.ads_metrics_tick'::regproc);
  if position('interval ''1 hour''' in d) = 0 then raise exception 'ads_metrics_tick: trava de 1 hora não encontrada'; end if;
  execute replace(d, 'interval ''1 hour''', 'interval ''9 minutes''');

  d := pg_get_functiondef('public.ads_creatives_tick'::regproc);
  if position('c.updated_at > now() - interval ''30 minutes''' in d) = 0 then raise exception 'ads_creatives_tick: trava de 30 min não encontrada'; end if;
  execute replace(d, 'c.updated_at > now() - interval ''30 minutes''', 'c.updated_at > now() - interval ''19 minutes''');
end $$;
