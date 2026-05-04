alter table public.tasks add column if not exists ops_node_id uuid unique;
create index if not exists tasks_ops_node_id_idx on public.tasks(ops_node_id);