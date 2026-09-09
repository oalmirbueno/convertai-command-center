-- A migração 20260901030000 ("todos os posts e não só os 25") acrescentou o
-- parâmetro _after à social_metrics_url usando CREATE OR REPLACE. Como a
-- assinatura mudou de 5 para 6 parâmetros, o Postgres não substituiu nada:
-- criou uma segunda função e deixou a antiga no lugar.
--
-- Com as duas convivendo e o _after tendo valor padrão, qualquer chamada com 5
-- argumentos vira ambígua e o banco recusa com:
--     function social_private.social_metrics_url(text, text, text, date, date)
--     is not unique
-- Na prática: a tela de métricas parava de listar posts.
--
-- A versão de 6 parâmetros faz tudo o que a antiga fazia (mesmos ramos profile,
-- reach, post_insights e identity) e melhora o ramo posts: limit=100 com
-- paginação em vez de limit=25. Apagar a antiga é seguro, e as chamadas com 5
-- argumentos passam a resolver nela, com _after nulo.

drop function if exists social_private.social_metrics_url(text, text, text, date, date);

do $$
begin
  if (select count(*) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'social_private'
        and p.proname = 'social_metrics_url') <> 1 then
    raise exception 'social_metrics_url deveria ter exatamente uma versao apos esta migracao';
  end if;
end $$;
