-- O painel aprende que o post JA SAIU, em vez de esperar alguem contar.
--
-- O RELATO, e ele corrige o meu diagnostico anterior: "na vdd aconteceu,
-- so que nao notificou e nao viu".
--
-- Os cinco agendamentos vencidos NAO estavam parados por falta de acao. O
-- dono publicou cada um na mao, no Instagram, no horario. Os numeros
-- mostram isso sem margem: marcado 15:50, no ar 15:53. Marcado 18:25, no
-- ar 18:29. Marcado 10:38, no ar 10:41. Tres a quatro minutos, o tempo de
-- abrir o aplicativo e colar a legenda.
--
-- O painel e que continuou achando que estavam agendados. E como a baixa
-- oficial nunca aconteceu, o recibo nunca rodou, e o recibo e quem avisa.
-- Nao era o aviso que estava quebrado: era o painel que nao sabia.
--
-- E por isso o alarme de atraso, sozinho, seria PIOR que o silencio: ele
-- gritaria "nao foi ao ar" sobre cinco posts que foram. Alarme falso
-- ensina a ignorar alarme.
--
-- A CORRECAO e o painel olhar para a realidade. Ele ja colhe os posts
-- reais de cada conta em social_post_metrics, com media_id, permalink e
-- hora. Entao: agendamento vencido + post real na conta certa, na janela
-- certa = foi ao ar. Da baixa com o permalink VERDADEIRO e deixa o recibo
-- avisar, exatamente como avisaria se a maquina tivesse publicado.
--
-- A REGRA QUE NAO SE CRUZA: casa so quando ha UM candidato. Dois posts na
-- janela viram duvida, e duvida nao vira escrita — o registro fica como
-- esta e o atraso e reportado para gente decidir. Chutar qual post
-- pertence a qual agendamento gravaria o link errado no historico do
-- cliente, e registro publicado e imutavel: nao teria volta.
--
-- Rodar de novo nao faz mal.

create or replace function public.editorial_reconciliar_publicados()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _pub record;
  _real record;
  _quantos integer;
  _quem uuid;
  _casados integer := 0;
  _ambiguos integer := 0;
  _sem_par integer := 0;
begin
  for _pub in
    select p.id, p.client_id, p.external_account_id, p.scheduled_at
      from public.editorial_publications p
     where p.status = 'scheduled'
       and p.scheduled_at is not null
       and p.scheduled_at < now() - interval '15 minutes'
     order by p.scheduled_at
     limit 200
  loop
    -- Janela apertada de proposito: meia hora antes cobre quem adiantou, e
    -- seis horas depois cobre quem publicou mais tarde no mesmo dia. Mais
    -- larga que isso comeca a alcancar o post do dia seguinte.
    select count(*) into _quantos
      from public.social_post_metrics m
     where m.external_account_id = _pub.external_account_id
       and m.posted_at between _pub.scheduled_at - interval '30 minutes'
                           and _pub.scheduled_at + interval '6 hours'
       -- Post ja reivindicado por outro agendamento nao conta duas vezes.
       and not exists (
         select 1 from public.editorial_publications q
          where q.permalink is not null and q.permalink = m.permalink
       );

    if _quantos = 0 then
      _sem_par := _sem_par + 1;
      continue;
    end if;

    if _quantos > 1 then
      -- Duvida nao vira escrita. Fica para o alarme de atraso reportar, e
      -- para gente decidir qual e qual.
      _ambiguos := _ambiguos + 1;
      continue;
    end if;

    select m.* into _real
      from public.social_post_metrics m
     where m.external_account_id = _pub.external_account_id
       and m.posted_at between _pub.scheduled_at - interval '30 minutes'
                           and _pub.scheduled_at + interval '6 hours'
       and not exists (
         select 1 from public.editorial_publications q
          where q.permalink is not null and q.permalink = m.permalink
       )
     limit 1;

    -- Sem permalink de verdade nao ha baixa: o recibo exige endereco
    -- publico valido, e com razao. Registro sem prova nao e registro.
    if _real.permalink is null
       or btrim(_real.permalink) !~* '^https?://[^[:space:]]+$' then
      _sem_par := _sem_par + 1;
      continue;
    end if;

    -- Registro publicado e IMUTAVEL: esta e a unica chance de gravar
    -- status, endereco e hora, entao vao juntos.
    update public.editorial_publications
       set status = 'published',
           permalink = btrim(_real.permalink),
           published_at = _real.posted_at
     where id = _pub.id;

    -- Quem agendou foi quem publicou na mao. Se nao houver, o dono.
    select coalesce(
             (select pi.scheduled_by from public.editorial_publication_internal pi
               where pi.publication_id = _pub.id),
             (select ur.user_id from public.user_roles ur
               where ur.role = 'admin'::public.app_role limit 1)
           ) into _quem;

    -- Isto dispara o recibo, que escreve o comentario na tarefa e avisa a
    -- equipe E o cliente. O mesmo caminho da publicacao automatica: nada
    -- de aviso paralelo que um dia diverge do outro.
    update public.editorial_publication_internal
       set published_by = _quem, updated_at = now()
     where publication_id = _pub.id;

    _casados := _casados + 1;
  end loop;

  return jsonb_build_object(
    'reconciliados', _casados,
    'ambiguos', _ambiguos,
    'sem_post_real', _sem_par,
    'em', now()
  );
end;
$$;

revoke execute on function public.editorial_reconciliar_publicados() from anon;
grant execute on function public.editorial_reconciliar_publicados() to authenticated, service_role;

/**
 * A mensagem do alarme muda, porque a realidade dele mudou.
 *
 * Agora o alarme so fala DEPOIS que a reconciliacao ja procurou o post na
 * conta e nao achou. Entao ele nao pode mais dizer "esta em modo manual",
 * como se ninguem tivesse conferido: ele tem que dizer que o painel OLHOU
 * a conta e nao encontrou nada publicado naquela janela. E uma afirmacao
 * mais forte, e por isso mesmo mais util.
 */
create or replace function public.editorial_alerta_agendamento_atrasado()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _pub record;
  _cliente text;
  _quando text;
  _motivo text;
  _avisados integer := 0;
begin
  for _pub in
    select p.id, p.client_id, p.platform, p.scheduled_at, p.delivery_mode,
           po.title as titulo,
           coalesce(
             public.editorial_file_is_publishable(
               coalesce(p.file_id, po.primary_file_id), p.client_id, p.project_id
             ), false) as arte_liberada,
           (select count(*) from public.social_post_metrics m
             where m.external_account_id = p.external_account_id
               and m.posted_at between p.scheduled_at - interval '30 minutes'
                                   and p.scheduled_at + interval '6 hours') as posts_na_janela
      from public.editorial_publications p
      left join public.editorial_posts po on po.id = p.post_id
     where p.status = 'scheduled'
       and p.scheduled_at is not null
       and p.scheduled_at < now() - interval '15 minutes'
       and not exists (
         select 1 from public.notifications n
          where n.notification_type = 'agendamento_atrasado'
            and n.link = '/calendario?publicacao=' || p.id::text
       )
     order by p.scheduled_at
     limit 200
  loop
    select coalesce(nullif(trim(pr.company_name), ''), pr.full_name)
      into _cliente
      from public.profiles pr where pr.id = _pub.client_id;

    _quando := to_char(_pub.scheduled_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI');

    _motivo := case
      when _pub.posts_na_janela > 1 then
        'o painel achou MAIS DE UM post na conta nessa janela e nao quis chutar qual e: confirme qual deles e este e de a baixa pelo painel'
      when not _pub.arte_liberada then
        'a arte ainda nao esta aprovada dos dois lados'
      when _pub.delivery_mode <> 'automatic' then
        'esta pronta e aprovada, o painel conferiu a conta e nao achou nenhum post nessa janela: publique, ou ligue a automacao dessa conta para sair sozinho'
      else
        'esta liberada e automatica, e mesmo assim nao saiu: verifique a conexao da conta'
    end;

    insert into public.notifications (user_id, message, notification_type, link)
    select ur.user_id,
           format('Agendamento de %s passou da hora (%s) e o painel nao encontrou publicacao: %s',
                  coalesce(_cliente, 'cliente'), _quando, _motivo),
           'agendamento_atrasado',
           '/calendario?publicacao=' || _pub.id::text
      from public.user_roles ur
     where ur.role = 'admin'::public.app_role;

    _avisados := _avisados + 1;
  end loop;

  return jsonb_build_object('avisados', _avisados, 'em', now());
end;
$$;

revoke execute on function public.editorial_alerta_agendamento_atrasado() from anon;
grant execute on function public.editorial_alerta_agendamento_atrasado() to authenticated, service_role;

/**
 * O alarme de atraso passa a rodar DEPOIS da reconciliacao.
 *
 * A ordem importa mais do que parece: se o alarme corresse primeiro, ele
 * avisaria "nao foi ao ar" sobre um post que a reconciliacao daria baixa
 * dois segundos depois. O aviso ficaria no sino, errado, para sempre —
 * porque o alarme so avisa uma vez por publicacao, de proposito.
 */
create or replace function public.editorial_conferir_agendamentos()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _rec jsonb;
  _ale jsonb;
begin
  _rec := public.editorial_reconciliar_publicados();
  _ale := public.editorial_alerta_agendamento_atrasado();
  return jsonb_build_object('reconciliacao', _rec, 'alerta', _ale);
end;
$$;

revoke execute on function public.editorial_conferir_agendamentos() from anon;
grant execute on function public.editorial_conferir_agendamentos() to authenticated, service_role;

do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('editorial-agendamento-atrasado')
      where exists (select 1 from cron.job where jobname = 'editorial-agendamento-atrasado');
    perform cron.schedule(
      'editorial-agendamento-atrasado', '*/15 * * * *',
      $job$SELECT public.editorial_conferir_agendamentos();$job$
    );
  end if;
end
$cron$;
