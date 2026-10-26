-- Tarefa com origem externa (26/10/2026, MCP 2.19). Só amplia e é idempotente.
--
-- O Paperclip recriava as mesmas tarefas no Kanban a cada troca de chave: create_task só deduplicava
-- por idempotency_key dentro da mesma credencial (3 chaves + 2 OAuth). Agora a tarefa guarda de onde
-- veio (ex.: "paperclip:ACE-275") e o MCP devolve a existente em vez de criar outra. O MCP também
-- recusa título normalizado igual ao de tarefa aberta no mesmo projeto.
--
-- O índice único vale por projeto (tarefa aberta); o MCP confere também no cliente inteiro antes de criar.

alter table public.tasks add column if not exists origem_externa text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_origem_externa_formato') then
    alter table public.tasks add constraint tasks_origem_externa_formato
      check (origem_externa is null or (length(origem_externa) between 3 and 160 and origem_externa ~ '^[a-z0-9_-]+:'));
  end if;
end;
$$;

create unique index if not exists tasks_origem_externa_unica_no_projeto
  on public.tasks (project_id, origem_externa)
  where origem_externa is not null and deleted_at is null;

-- Conferência (todas true):
-- select exists (select 1 from information_schema.columns where table_name = 'tasks' and column_name = 'origem_externa'),
--   exists (select 1 from pg_indexes where indexname = 'tasks_origem_externa_unica_no_projeto');
