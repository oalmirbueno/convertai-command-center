-- Agenda do comercial: compromisso proprio, sem lead amarrado.
--
-- A atividade nascia obrigatoriamente presa a um lead. So que a agenda de
-- quem vende tem duas metades: a ligacao para a Padaria do Ze E a reuniao
-- de planejamento da semana, o bloco para escrever proposta, o almoco com
-- o indicador que ainda nao virou lead. Sem poder marcar essas, a pessoa
-- volta para o calendario do celular, e a agenda do painel vira metade da
-- verdade: nao da para confiar nela para saber se o dia esta cheio.
--
-- Duas mudancas, e as duas sao consequencia de uma so decisao:
--
-- 1. `lead_id` passa a aceitar nulo.
-- 2. O robo de lembrete passa a usar LEFT JOIN e a montar a mensagem sem o
--    nome do lead quando nao houver. Com INNER JOIN, o compromisso proprio
--    seria criado, ficaria na tela e NUNCA avisaria: o pior tipo de falha,
--    porque parece que funciona.

alter table public.commercial_activities
  alter column lead_id drop not null;

-- O indice do lead continua util para a aba do lead; o parcial evita
-- carregar as linhas soltas nele.
drop index if exists public.commercial_activities_por_lead;
create index if not exists commercial_activities_por_lead
  on public.commercial_activities (lead_id, due_at desc)
  where lead_id is not null;

create or replace function public.commercial_activity_reminders()
returns integer
language plpgsql
set search_path to ''
as $$
declare
  _hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  _ids uuid[];
  _enviados integer := 0;
begin
  -- Os ids saem primeiro, para uma lista so: um CTE nao sobrevive de um
  -- comando para o outro, e a marcacao de "ja avisei" precisa cair
  -- exatamente sobre as mesmas linhas que geraram aviso.
  select array_agg(escolhidas.id) into _ids
  from (
    select atividade.id
    from public.commercial_activities as atividade
    left join public.commercial_leads as lead on lead.id = atividade.lead_id
    where atividade.done_at is null
      -- Lead arquivado silencia a atividade dele; compromisso proprio
      -- (sem lead) nunca e silenciado por essa regra.
      and (atividade.lead_id is null or lead.archived_at is null)
      and (atividade.due_at at time zone 'America/Sao_Paulo')::date <= _hoje
      and (atividade.reminded_on is null or atividade.reminded_on < _hoje)
    order by atividade.due_at
    limit 200
  ) as escolhidas;

  if _ids is null then
    return 0;
  end if;

  -- Uma notificacao por atividade por dia, para o dono dela. Sem dono, vai
  -- para os admins: atividade sem dono e justamente a que ninguem esta
  -- olhando.
  with destinatarios as (
    select
      coalesce(atividade.owner_id, papel.user_id) as user_id,
      atividade.title,
      atividade.due_at,
      lead.name as lead_name
    from public.commercial_activities as atividade
    left join public.commercial_leads as lead on lead.id = atividade.lead_id
    left join lateral (
      select role_row.user_id
      from public.user_roles as role_row
      where role_row.role = 'admin'::public.app_role
        and atividade.owner_id is null
    ) as papel on true
    where atividade.id = any(_ids)
      and coalesce(atividade.owner_id, papel.user_id) is not null
  ),
  gravadas as (
    insert into public.notifications (user_id, message, notification_type, link)
    select distinct
      destinatarios.user_id,
      case
        when destinatarios.lead_name is null then
          case
            when (destinatarios.due_at at time zone 'America/Sao_Paulo')::date < _hoje
              then format('Atrasado: %s', destinatarios.title)
            else format('Hoje: %s', destinatarios.title)
          end
        when (destinatarios.due_at at time zone 'America/Sao_Paulo')::date < _hoje
          then format('Atrasado com %s: %s', destinatarios.lead_name, destinatarios.title)
        else format('Hoje com %s: %s', destinatarios.lead_name, destinatarios.title)
      end,
      'commercial',
      '/comercial/agenda'
    from destinatarios
    returning 1
  )
  select count(*) into _enviados from gravadas;

  update public.commercial_activities
  set reminded_on = _hoje
  where id = any(_ids);

  return _enviados;
end
$$;

revoke all on function public.commercial_activity_reminders() from public;
revoke execute on function public.commercial_activity_reminders() from anon;
revoke execute on function public.commercial_activity_reminders() from authenticated;
