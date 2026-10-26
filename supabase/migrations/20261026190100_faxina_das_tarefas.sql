-- Faxina das tarefas (26/10/2026). Só amplia e é idempotente. NÃO roda sozinha: sem cron.
--
-- Dono: "tarefas sem sentido devem sumir; só as que dão resultado". Encerrar sem apagar, com o motivo.
--
-- public.faxina_das_tarefas_candidatos(): a lista (só leitura) do que seria encerrado e por quê:
--   duplicada            tarefa aberta com o mesmo título normalizado de outra aberta do mesmo cliente
--                        (fica a que tem dono, prazo, está mais adiantada e foi mexida por último)
--   vencida_automatica   aberta, criada por agente/script/ritual, com prazo vencido há mais de 7 dias
--   sem_dono_sem_prazo   aberta, criada por agente/script, sem dono e sem prazo há mais de 14 dias
--   vinculo_*            vínculo de agente aberto sem tarefa, de tarefa concluída/encerrada, ou parado
--                        (fila/andamento sem mexer há 7 dias; esperando o dono há 14)
-- Ficam sempre: tarefa de pedido do cliente (client_request:*), retorno do cliente (client_feedback), a da
-- vigia do calendário (vigia:calendario) e tarefa de pauta ligada a post da agenda não arquivado.
--
-- public.faxina_das_tarefas(_simular boolean default true): com _simular (o padrão) só devolve a contagem
-- por motivo e os itens, sem escrever nada. Com _simular = false, cada linha vai antes para
-- app_private.arquivo_limpeza (lote 'faxina-AAAA-MM-DD', com o motivo, dá para restaurar) e:
--   tarefa  -> deleted_at = now() (sai das telas, não é apagada)
--   vínculo -> status 'parado' com block_reason "Faxina dd/mm: <motivo>"
-- Só o admin ou a chave de serviço.

create or replace function public.faxina_das_tarefas_candidatos()
returns table (
  tabela text,
  id uuid,
  titulo text,
  client_id uuid,
  cliente text,
  motivo text,
  origem text,
  status text,
  criado_em timestamptz,
  atualizado_em timestamptz,
  prazo date,
  manter_id uuid
)
language sql
stable
security definer
set search_path to ''
as $$
-- [candidatos]
with hoje as (
  select (now() at time zone 'America/Sao_Paulo')::date as d
),
abertas as (
  select t.id, t.title, t.status, t.source, t.origem_externa, t.assigned_to, t.due_date, t.created_at, t.updated_at,
         pr.client_id,
         coalesce(nullif(btrim(c.company_name), ''), c.full_name) as cliente,
         -- Criada por agente, script ou ritual (não por gente no painel, nem pelo cliente).
         (coalesce(t.source, '') in ('mcp', 'ops', 'agente_mesa_hermes')
           or coalesce(t.source, '') like 'mcp:%'
           or coalesce(t.source, '') like 'agente%'
           or coalesce(t.source, '') like 'ciclo%'
           or coalesce(t.source, '') like 'ritual:%'
           or coalesce(t.source, '') like 'orion%'
           or t.origem_externa is not null) as automatica,
         btrim(regexp_replace(lower(translate(coalesce(t.title, ''),
           'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
           'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc')), '[^a-z0-9]+', ' ', 'g')) as titulo_norm
    from public.tasks t
    join public.projects pr on pr.id = t.project_id
    left join public.profiles c on c.id = pr.client_id
   where t.deleted_at is null
     and t.status <> 'done'
     and coalesce(t.source, '') not like 'client_request:%'
     and coalesce(t.source, '') <> 'client_feedback'
     and coalesce(t.origem_externa, '') <> 'vigia:calendario'
     -- Tarefa de pauta (ligada a post da agenda que não foi arquivado) fica: o caminho dela é a agenda
     -- (arquivar a pauta), senão o post fica órfão. Cobre a guarda do excluir do painel (agendado/no ar).
     and not exists (
       select 1 from public.editorial_post_internal epi
         join public.editorial_posts po on po.id = epi.post_id
        where epi.task_id = t.id and po.archived_at is null)
),
ordem as (
  select a.*,
         row_number() over (
           partition by a.client_id, a.titulo_norm
           order by (a.assigned_to is not null) desc, (a.due_date is not null) desc,
                    case a.status when 'doing' then 0 when 'review' then 1 when 'todo' then 2 else 3 end,
                    a.updated_at desc, a.id) as rn,
         first_value(a.id) over (
           partition by a.client_id, a.titulo_norm
           order by (a.assigned_to is not null) desc, (a.due_date is not null) desc,
                    case a.status when 'doing' then 0 when 'review' then 1 when 'todo' then 2 else 3 end,
                    a.updated_at desc, a.id) as primeira
    from abertas a
),
tarefas as (
  select o.*,
         case
           when o.titulo_norm <> '' and o.rn > 1 then 'duplicada'
           when o.automatica and o.due_date is not null and o.due_date < (select d from hoje) - 7 then 'vencida_automatica'
           when o.automatica and o.assigned_to is null and o.due_date is null and o.created_at < now() - interval '14 days' then 'sem_dono_sem_prazo'
         end as motivo_da_faxina
    from ordem o
),
vinculos as (
  select l.id, l.status, l.created_at, l.updated_at, l.last_action, l.execution_source,
         t.id as task_id, t.title, t.status as task_status, t.deleted_at as task_deleted_at, pr.client_id,
         coalesce(nullif(btrim(c.company_name), ''), c.full_name) as cliente,
         case
           when t.id is null or t.deleted_at is not null then 'vinculo_sem_tarefa'
           when t.status = 'done' then 'vinculo_de_tarefa_concluida'
           when exists (select 1 from tarefas x where x.id = t.id and x.motivo_da_faxina is not null) then 'vinculo_de_tarefa_encerrada'
           when l.status in ('queued', 'in_progress') and l.updated_at < now() - interval '7 days' then 'vinculo_parado'
           when l.status in ('awaiting_input', 'review', 'blocked') and l.updated_at < now() - interval '14 days' then 'vinculo_parado'
         end as motivo_da_faxina
    from public.operator_task_links l
    left join public.tasks t on t.id = coalesce(l.painel_task_id, l.kanban_task_id)
    left join public.projects pr on pr.id = t.project_id
    left join public.profiles c on c.id = pr.client_id
   where l.status not in ('done', 'parado')
)
select 'tasks'::text, x.id, left(x.title, 200), x.client_id, x.cliente, x.motivo_da_faxina, x.source, x.status,
       x.created_at, x.updated_at, x.due_date, case when x.motivo_da_faxina = 'duplicada' then x.primeira end
  from tarefas x
 where x.motivo_da_faxina is not null
union all
select 'operator_task_links'::text, v.id, left(coalesce(v.title, v.last_action, 'vínculo sem tarefa'), 200), v.client_id, v.cliente,
       v.motivo_da_faxina, v.execution_source, v.status, v.created_at, v.updated_at, null::date, v.task_id
  from vinculos v
 where v.motivo_da_faxina is not null;
-- [/candidatos]
$$;
revoke all on function public.faxina_das_tarefas_candidatos() from public, anon, authenticated;
grant execute on function public.faxina_das_tarefas_candidatos() to service_role;

create or replace function public.faxina_das_tarefas(_simular boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  _hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  _lote text := 'faxina-' || to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD');
  _contagem jsonb;
  _itens jsonb;
  _tarefas integer := 0;
  _vinculos integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not coalesce(public.has_role(auth.uid(), 'admin'::public.app_role), false) then
    raise exception 'faxina_das_tarefas: só o admin' using errcode = '42501';
  end if;

  -- A lista é lida uma vez e guardada na variável: simular não escreve nada, nem tabela temporária.
  select coalesce(jsonb_agg(to_jsonb(c) order by c.tabela, c.motivo, c.cliente, c.titulo), '[]'::jsonb) into _itens
    from public.faxina_das_tarefas_candidatos() c;
  select coalesce(jsonb_object_agg(x.motivo, x.n), '{}'::jsonb) into _contagem
    from (select e ->> 'motivo' as motivo, count(*) as n from jsonb_array_elements(_itens) e group by 1) x;

  if not coalesce(_simular, true) then
    -- Tarefas: cópia com o motivo para desfazer, depois some das telas (deleted_at), nunca DELETE.
    insert into app_private.arquivo_limpeza (lote, tabela, acao, linha)
    select _lote, 'tasks', 'arquivada', to_jsonb(t) || jsonb_build_object('motivo_da_faxina', e ->> 'motivo', 'manter_id', e ->> 'manter_id')
      from jsonb_array_elements(_itens) e
      join public.tasks t on t.id = (e ->> 'id')::uuid
     where e ->> 'tabela' = 'tasks' and t.deleted_at is null;
    update public.tasks t set deleted_at = now()
      from jsonb_array_elements(_itens) e
     where e ->> 'tabela' = 'tasks' and t.id = (e ->> 'id')::uuid and t.deleted_at is null;
    get diagnostics _tarefas = row_count;

    -- Vínculos de agente: parados com o motivo (o diário e as entregas ficam).
    insert into app_private.arquivo_limpeza (lote, tabela, acao, linha)
    select _lote, 'operator_task_links', 'parado', to_jsonb(l) || jsonb_build_object('motivo_da_faxina', e ->> 'motivo')
      from jsonb_array_elements(_itens) e
      join public.operator_task_links l on l.id = (e ->> 'id')::uuid
     where e ->> 'tabela' = 'operator_task_links' and l.status not in ('done', 'parado');
    update public.operator_task_links l
       set status = 'parado',
           block_reason = left('Faxina ' || to_char(_hoje, 'DD/MM') || ': ' || replace(e ->> 'motivo', '_', ' '), 500),
           updated_at = now()
      from jsonb_array_elements(_itens) e
     where e ->> 'tabela' = 'operator_task_links' and l.id = (e ->> 'id')::uuid and l.status not in ('done', 'parado');
    get diagnostics _vinculos = row_count;
  end if;

  return jsonb_build_object(
    'simulacao', coalesce(_simular, true),
    'lote', case when coalesce(_simular, true) then null else _lote end,
    'contagem', _contagem,
    'total', jsonb_array_length(_itens),
    'tarefas_encerradas', _tarefas,
    'vinculos_parados', _vinculos,
    'itens', _itens
  );
end;
$$;
revoke all on function public.faxina_das_tarefas(boolean) from public, anon;
grant execute on function public.faxina_das_tarefas(boolean) to authenticated, service_role;

-- Conferência (todas true):
-- select exists (select 1 from pg_proc where proname = 'faxina_das_tarefas_candidatos'),
--   exists (select 1 from pg_proc where proname = 'faxina_das_tarefas');
-- Simulação (não escreve): select public.faxina_das_tarefas(true) -> 'contagem';
-- Aplicar (só depois de conferir): select public.faxina_das_tarefas(false);
