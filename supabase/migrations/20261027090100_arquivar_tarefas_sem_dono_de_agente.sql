-- Torneira das tarefas: arquivar sozinho, toda segunda, a tarefa de agente sem dono há 14 dias (27/10/2026).
-- Só amplia e é idempotente.
--
-- Diagnóstico de 26/10: agentes criaram 597 tarefas em 30 dias contra 2 entregas com prova; 762 abertas, 538
-- sem dono. O MCP 2.22 fecha a torneira (aceleriq_create_task de agente só com cliente, dono e prazo); esta
-- migration esvazia o que sobrou, pelo mesmo caminho da faxina de 26/10 (20261026190100_faxina_das_tarefas):
-- cópia em app_private.arquivo_limpeza (com o motivo, restaurável) e deleted_at = now() (sai das telas, nunca
-- DELETE).
--
-- Entra: tarefa aberta, sem dono, criada por agente/script/ritual (a mesma regra "automatica" da faxina),
-- criada há mais de 14 dias e sem mexida há 14 dias.
-- Fica sempre: pedido do cliente (client_request:*), retorno do cliente (client_feedback), a da vigia
-- (vigia:calendario), PAUTA (item do calendário: source mcp:editorial:*, ligada ao Estúdio ou a post da
-- Agenda; quem cuida é a Agenda) e tarefa com vínculo de agente mexido nos últimos 7 dias.
--
-- public.arquivar_tarefas_sem_dono_de_agente(_simular boolean default true): com _simular (o padrão) só
-- devolve a contagem e os itens. Com false, lote 'arquivo-semanal-AAAA-MM-DD'.
-- public.arquivo_de_tarefas_restaurar(_lote text): devolve as tarefas do lote às telas (deleted_at = null).
-- Cron 'arquivar-tarefas-sem-dono' toda segunda às 07h30 BRT. Só o admin ou a chave de serviço.

create or replace function public.arquivar_tarefas_sem_dono_de_agente_candidatos()
returns table (id uuid, titulo text, client_id uuid, cliente text, origem text, status text, criado_em timestamptz, atualizado_em timestamptz)
language sql
stable
security definer
set search_path to ''
as $$
-- [candidatos]
select t.id, left(t.title, 200), pr.client_id,
       coalesce(nullif(btrim(c.company_name), ''), c.full_name),
       coalesce(t.source, t.origem_externa), t.status, t.created_at, t.updated_at
  from public.tasks t
  join public.projects pr on pr.id = t.project_id
  left join public.profiles c on c.id = pr.client_id
 where t.deleted_at is null
   and t.status <> 'done'
   and t.assigned_to is null
   and t.created_at < now() - interval '14 days'
   and t.updated_at < now() - interval '14 days'
   -- Criada por agente, script ou ritual (a mesma regra da faxina de 26/10).
   and (coalesce(t.source, '') in ('mcp', 'ops', 'agente_mesa_hermes')
        or coalesce(t.source, '') like 'mcp:%'
        or coalesce(t.source, '') like 'agente%'
        or coalesce(t.source, '') like 'ciclo%'
        or coalesce(t.source, '') like 'ritual:%'
        or coalesce(t.source, '') like 'orion%'
        or t.origem_externa is not null)
   -- Ficam sempre.
   and coalesce(t.source, '') not like 'client_request:%'
   and coalesce(t.source, '') <> 'client_feedback'
   and coalesce(t.origem_externa, '') <> 'vigia:calendario'
   -- Pauta é item do calendário: a Agenda cuida dela.
   and coalesce(t.source, '') not like 'mcp:editorial:%'
   and not exists (select 1 from public.estudio_trabalhos e where e.task_id = t.id)
   and not exists (
     select 1 from public.editorial_post_internal epi
       join public.editorial_posts po on po.id = epi.post_id
      where epi.task_id = t.id and po.archived_at is null)
   -- Agente trabalhando nela agora.
   and not exists (
     select 1 from public.operator_task_links l
      where coalesce(l.painel_task_id, l.kanban_task_id) = t.id
        and l.status not in ('done', 'parado')
        and l.updated_at > now() - interval '7 days')
-- [/candidatos]
$$;
revoke all on function public.arquivar_tarefas_sem_dono_de_agente_candidatos() from public, anon, authenticated;
grant execute on function public.arquivar_tarefas_sem_dono_de_agente_candidatos() to service_role;

create or replace function public.arquivar_tarefas_sem_dono_de_agente(_simular boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  _lote text := 'arquivo-semanal-' || to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD');
  _itens jsonb;
  _arquivadas integer := 0;
begin
  -- Gente logada só se for admin; a chave de serviço e o pg_cron (sem JWT) passam.
  if coalesce(auth.role(), '') = 'authenticated' and not coalesce(public.has_role(auth.uid(), 'admin'::public.app_role), false) then
    raise exception 'arquivar_tarefas_sem_dono_de_agente: só o admin' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.cliente, c.criado_em), '[]'::jsonb) into _itens
    from public.arquivar_tarefas_sem_dono_de_agente_candidatos() c;

  if not coalesce(_simular, true) then
    insert into app_private.arquivo_limpeza (lote, tabela, acao, linha)
    select _lote, 'tasks', 'arquivada', to_jsonb(t) || jsonb_build_object('motivo_da_faxina', 'sem_dono_de_agente_14_dias')
      from jsonb_array_elements(_itens) e
      join public.tasks t on t.id = (e ->> 'id')::uuid
     where t.deleted_at is null;
    update public.tasks t set deleted_at = now()
      from jsonb_array_elements(_itens) e
     where t.id = (e ->> 'id')::uuid and t.deleted_at is null;
    get diagnostics _arquivadas = row_count;
  end if;

  return jsonb_build_object(
    'simulacao', coalesce(_simular, true),
    'lote', case when coalesce(_simular, true) then null else _lote end,
    'total', jsonb_array_length(_itens),
    'arquivadas', _arquivadas,
    'itens', _itens
  );
end;
$$;
revoke all on function public.arquivar_tarefas_sem_dono_de_agente(boolean) from public, anon;
grant execute on function public.arquivar_tarefas_sem_dono_de_agente(boolean) to authenticated, service_role;

-- Desfazer um lote (da faxina ou do arquivo semanal): as tarefas voltam às telas.
create or replace function public.arquivo_de_tarefas_restaurar(_lote text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  _n integer := 0;
begin
  -- Gente logada só se for admin; a chave de serviço e o pg_cron (sem JWT) passam.
  if coalesce(auth.role(), '') = 'authenticated' and not coalesce(public.has_role(auth.uid(), 'admin'::public.app_role), false) then
    raise exception 'arquivo_de_tarefas_restaurar: só o admin' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(_lote, '')), '') is null then
    return jsonb_build_object('ok', false, 'motivo', 'lote_vazio');
  end if;
  update public.tasks t set deleted_at = null
    from app_private.arquivo_limpeza a
   where a.lote = _lote and a.tabela = 'tasks' and a.acao = 'arquivada'
     and t.id = (a.linha ->> 'id')::uuid and t.deleted_at is not null;
  get diagnostics _n = row_count;
  return jsonb_build_object('ok', true, 'lote', _lote, 'restauradas', _n);
end;
$$;
revoke all on function public.arquivo_de_tarefas_restaurar(text) from public, anon;
grant execute on function public.arquivo_de_tarefas_restaurar(text) to authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'arquivar-tarefas-sem-dono';
    perform cron.schedule('arquivar-tarefas-sem-dono', '30 10 * * 1',
      $cron$ select public.arquivar_tarefas_sem_dono_de_agente(false); $cron$);
  end if;
end $$;

-- Conferência (todas true):
-- select exists (select 1 from pg_proc where proname = 'arquivar_tarefas_sem_dono_de_agente'),
--   exists (select 1 from pg_proc where proname = 'arquivo_de_tarefas_restaurar'),
--   exists (select 1 from cron.job where jobname = 'arquivar-tarefas-sem-dono');
-- Simulação (não escreve): select public.arquivar_tarefas_sem_dono_de_agente(true) - 'itens';
-- Desfazer: select public.arquivo_de_tarefas_restaurar('arquivo-semanal-AAAA-MM-DD');
