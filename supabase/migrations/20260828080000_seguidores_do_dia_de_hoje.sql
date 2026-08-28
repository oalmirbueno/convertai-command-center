-- O numero de seguidores estava congelado na semana passada.
--
-- O RELATO: "tem muitas contas que ja mudou os numeros e melhoraram e
-- ainda esta travado com os numeros de inicio".
--
-- O QUE ACHEI, e e um erro de conceito, nao de codigo:
--
-- `followers_count` e um numero de AGORA. Quantas pessoas seguem a conta
-- neste instante. Mas ele estava sendo guardado como se fosse fechamento
-- de semana, na mesma linha de `reach` e `total_interactions` — que sao
-- somas de um periodo e, essas sim, param de mudar quando a semana acaba.
--
-- Juntar as duas coisas na mesma linha fez o numero vivo herdar a regra
-- do numero morto. O robo mira sempre a semana JA FECHADA, e so busca
-- aquela semana se a linha dela estiver incompleta. Preencheu uma vez? Nao
-- busca nunca mais.
--
-- Resultado medido: a linha mais recente de TODOS os doze clientes era da
-- semana de 17/08, colhida dia 24. Hoje e 28. O painel mostrava o retrato
-- de quatro dias atras e nao existia linha nenhuma da semana corrente.
-- Acerbi apareceu com 497 seguidores em tres semanas seguidas.
--
-- A CORRECAO, sem tocar no robo grande: uma segunda funcao, pequena, que
-- busca o retrato da semana CORRENTE. Ela so DESPACHA; quem le a resposta
-- e grava continua sendo o mesmo parse de sempre, que ja faz upsert por
-- (conta, semana). Nada de caminho paralelo que um dia diverge do original.
--
-- As cadencias, e cada uma tem motivo:
--   perfil (seguidores)  a cada 30 min — e um numero vivo, e a chamada e
--                        barata: um GET que devolve dois campos.
--   alcance e interacao  a cada 3 horas — sao somas que crescem devagar
--                        ao longo da semana, e a chamada e mais pesada.
--
-- Doze contas dao cerca de 32 chamadas por hora somando tudo, folgado no
-- limite do Graph. A semana JA FECHADA continua intocada: numero de
-- periodo encerrado nao muda, e reescrever seria apagar historico.
--
-- Rodar de novo nao faz mal.

create or replace function public.social_retrato_da_semana_corrente()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _inicio date;
  _fim date;
  _acct record;
  _fim_consulta date;
  _ig text;
  _token text;
  _url text;
  _rid bigint;
  _kind text;
  _idade interval;
  _despachados integer := 0;
begin
  -- A semana CORRENTE, nao a anterior. E aqui que mora a diferenca.
  _inicio := date_trunc(
    'week', (now() at time zone 'America/Sao_Paulo')::date::timestamp
  )::date;
  _fim := _inicio + 6;

  -- A semana corrente ainda nao acabou, entao o fim dela esta no FUTURO.
  -- Pedir insight com `until` no futuro e pedir dado que nao existe: o
  -- Graph recusa, o pedido gasta as tres tentativas e a linha termina com
  -- erro gravado. Para a CONSULTA, o fim e hoje; para o REGISTRO, o fim
  -- continua sendo o domingo, senao a linha mentiria sobre que semana e.
  _fim_consulta := least(_fim, (now() at time zone 'America/Sao_Paulo')::date);

  for _acct in
    select account.id, account.client_id
      from public.external_accounts as account
     where account.platform = 'instagram'
       and account.status = 'active'
  loop
    select t.resource_id, t.access_token into _ig, _token
      from social_private.autopublish_account_token(_acct.id) as t;
    -- Conta sem token nao e erro: e conta que ainda nao foi conectada.
    if _token is null then continue; end if;

    select now() - w.captured_at into _idade
      from public.social_metrics_weekly as w
     where w.external_account_id = _acct.id and w.week_start = _inicio;

    foreach _kind in array array['profile', 'reach', 'engage'] loop
      -- Nunca dois pedidos iguais em voo para a mesma conta e semana.
      if exists (
        select 1 from social_private.social_metrics_requests as r
         where r.external_account_id = _acct.id
           and r.week_start = _inicio
           and r.kind = _kind
      ) then
        continue;
      end if;

      -- Sem linha ainda: busca tudo. Com linha: so o que venceu.
      if _idade is not null then
        if _kind = 'profile' and _idade < interval '30 minutes' then continue; end if;
        if _kind <> 'profile' and _idade < interval '3 hours' then continue; end if;
      end if;

      _url := social_private.social_metrics_url(_kind, _ig, _token, _inicio, _fim_consulta);
      select net.http_get(url := _url) into _rid;
      insert into social_private.social_metrics_requests
        (external_account_id, client_id, kind, request_id, week_start, week_end)
      values (_acct.id, _acct.client_id, _kind, _rid, _inicio, _fim);
      _despachados := _despachados + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'despachados', _despachados,
    'semana', _inicio,
    'em', now()
  );
end;
$$;

revoke execute on function public.social_retrato_da_semana_corrente() from anon;
grant execute on function public.social_retrato_da_semana_corrente() to authenticated, service_role;

/**
 * O ciclo completo das metricas sociais.
 *
 * Despacha o retrato de hoje e roda o tick de sempre, que e quem le as
 * respostas e grava. A ordem nao importa para a corretude (o tick le o
 * que ja chegou, e o que acabou de sair chega no proximo), mas despachar
 * primeiro encurta em um ciclo o tempo ate o numero novo aparecer.
 */
create or replace function public.social_metrics_ciclo()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _retrato jsonb;
  _tick jsonb;
begin
  _retrato := public.social_retrato_da_semana_corrente();
  _tick := public.social_metrics_tick();
  return jsonb_build_object('retrato_de_hoje', _retrato, 'tick', _tick);
end;
$$;

revoke execute on function public.social_metrics_ciclo() from anon;
grant execute on function public.social_metrics_ciclo() to authenticated, service_role;

do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('social-metrics')
      where exists (select 1 from cron.job where jobname = 'social-metrics');
    perform cron.schedule(
      'social-metrics', '*/10 * * * *',
      $job$SELECT public.social_metrics_ciclo();$job$
    );
  end if;
end
$cron$;
