-- CRM de verdade: atividade agendada, dono e previsão de fechamento.
--
-- O funil já movia o lead de coluna, mas isso é o quadro — não é o CRM. O
-- que faltava é o que um comercial faz entre uma coluna e outra:
--
-- 1. ATIVIDADE. O lead tinha um único `next_action` em texto livre. Um
--    comercial não tem "um próximo passo": tem a ligação de terça, a
--    reunião de quinta e a proposta para enviar sexta. Com um campo só,
--    marcar a ligação como feita apagava a reunião — e o histórico do que
--    foi combinado não existia.
--
-- 2. DONO. A coluna `owner_id` existia sem nada que a preenchesse. Funil de
--    time sem dono é funil de ninguém: dois ligam para o mesmo lead, ou
--    nenhum liga.
--
-- 3. PREVISÃO. Sem data esperada de fechamento não existe a pergunta que o
--    comercial responde toda semana — "quanto entra este mês?". O valor em
--    jogo somava o funil inteiro, inclusive o que só fecha no ano que vem.
--
-- E o elo com o painel: atividade vencida vira NOTIFICAÇÃO no sininho, na
-- mesma tabela que o resto do painel usa. Agenda que não cobra é lista de
-- desejos.

-- ─────────────────────────── Campos que faltavam ──────────────────────────

alter table public.commercial_leads
  add column if not exists expected_close_date date;

create index if not exists commercial_leads_por_previsao
  on public.commercial_leads (expected_close_date)
  where expected_close_date is not null and archived_at is null;

create index if not exists commercial_leads_por_dono
  on public.commercial_leads (owner_id) where owner_id is not null;

-- ──────────────────────────────── Atividades ──────────────────────────────

create table if not exists public.commercial_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.commercial_leads(id) on delete cascade,
  -- Tipo é texto com valores sugeridos na tela: o comercial inventa forma de
  -- falar com o cliente mais rápido do que se escreve migration.
  kind text not null default 'tarefa',
  title text not null,
  due_at timestamptz not null,
  done_at timestamptz,
  owner_id uuid,
  notes text,
  -- Marca o dia em que o lembrete já foi enviado ao sininho. Sem isto, o
  -- robô avisaria a mesma atividade a cada rodada, e o sininho viraria
  -- ruído que ninguém abre.
  reminded_on date,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A consulta que sustenta a tela e o robô: o que está em aberto, por prazo.
create index if not exists commercial_activities_abertas
  on public.commercial_activities (due_at)
  where done_at is null;

create index if not exists commercial_activities_por_lead
  on public.commercial_activities (lead_id, due_at desc);

drop trigger if exists commercial_activities_updated_at on public.commercial_activities;
create trigger commercial_activities_updated_at
  before update on public.commercial_activities
  for each row execute function public.update_updated_at_column();

alter table public.commercial_activities enable row level security;

drop policy if exists "comercial admin e manager" on public.commercial_activities;
create policy "comercial admin e manager" on public.commercial_activities
  for all to authenticated
  using (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or public.has_role(auth.uid(), 'manager'::public.app_role)
  )
  with check (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or public.has_role(auth.uid(), 'manager'::public.app_role)
  );

revoke all on public.commercial_activities from anon;

-- ─────────────────────── O lembrete que chega no sininho ──────────────────
--
-- NÃO é SECURITY DEFINER de propósito. Quem chama é o cron, que roda como
-- dono do banco e já passa por cima do RLS; dar poder de definer a uma
-- função que escreve notificação seria abrir uma porta que ninguém precisa.
-- Por isso também o execute é revogado de quem vem pela API.

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
  -- Os ids saem primeiro, para uma lista só: um CTE não sobrevive de um
  -- comando para o outro, e a marcação de "já avisei" precisa cair
  -- exatamente sobre as mesmas linhas que geraram aviso.
  select array_agg(escolhidas.id) into _ids
  from (
    select atividade.id
    from public.commercial_activities as atividade
    join public.commercial_leads as lead on lead.id = atividade.lead_id
    where atividade.done_at is null
      and lead.archived_at is null
      and (atividade.due_at at time zone 'America/Sao_Paulo')::date <= _hoje
      and (atividade.reminded_on is null or atividade.reminded_on < _hoje)
    order by atividade.due_at
    limit 200
  ) as escolhidas;

  if _ids is null then
    return 0;
  end if;

  -- Uma notificação por atividade por dia, para o dono dela — e, quando não
  -- há dono, para os admins: atividade sem dono é justamente a que ninguém
  -- está olhando.
  with destinatarios as (
    select
      coalesce(atividade.owner_id, papel.user_id) as user_id,
      atividade.title,
      atividade.due_at,
      lead.name as lead_name
    from public.commercial_activities as atividade
    join public.commercial_leads as lead on lead.id = atividade.lead_id
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
        when (destinatarios.due_at at time zone 'America/Sao_Paulo')::date < _hoje
          then format('Atrasado com %s: %s', destinatarios.lead_name, destinatarios.title)
        else format('Hoje com %s: %s', destinatarios.lead_name, destinatarios.title)
      end,
      'commercial',
      '/comercial'
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

-- Uma vez por dia, cedo: lembrete que chega de madrugada some antes de
-- alguém abrir o painel, e lembrete de hora em hora vira ruído.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('comercial-lembretes')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'comercial-lembretes');

    PERFORM cron.schedule(
      'comercial-lembretes',
      '0 11 * * *',
      'SELECT public.commercial_activity_reminders();'
    );
    RAISE NOTICE 'lembretes do comercial agendados para 8h de Brasilia';
  ELSE
    RAISE NOTICE 'pg_cron indisponivel: chame public.commercial_activity_reminders() por outro agendador';
  END IF;
END
$cron$;
