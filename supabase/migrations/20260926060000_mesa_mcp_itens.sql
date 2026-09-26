-- M-01 (frente M, 26/09): área MCP do Contexto do cliente.
-- Guarda, por cliente, quais itens que chegaram pelo MCP (orientação, dossiê,
-- memória, arquivo, rascunho do Estúdio) valem para o planejamento do agente
-- do Mês e dos geradores. Sem esta tabela o painel funciona com os padrões
-- (orientações e dossiê ligados; o resto desligado) e a troca avisa que falta
-- aplicar este SQL.
-- Só amplia, idempotente. RLS: a equipe lê (is_staff + can_access_client);
-- só o service_role escreve (a Edge Function agente-calendario, ação
-- ativar_item_mcp, confere o acesso antes de gravar).

create table if not exists public.mesa_mcp_itens (
  client_id uuid not null,
  fonte text not null,
  item_id uuid not null,
  ativo boolean not null,
  atualizado_por uuid null,
  atualizado_em timestamptz not null default now(),
  constraint mesa_mcp_itens_pkey primary key (client_id, fonte, item_id),
  constraint mesa_mcp_itens_fonte_check check (fonte in ('orientacao', 'dossie', 'memoria', 'arquivo', 'rascunho'))
);

comment on table public.mesa_mcp_itens is
  'Mesa > Contexto > MCP: itens do MCP (orientação, dossiê, memória, arquivo, rascunho) que valem ou não para o planejamento do cliente. Sem linha, vale o padrão da fonte.';

create index if not exists mesa_mcp_itens_client_idx on public.mesa_mcp_itens (client_id);

alter table public.mesa_mcp_itens enable row level security;

drop policy if exists "mesa_mcp_itens_equipe_le" on public.mesa_mcp_itens;
create policy "mesa_mcp_itens_equipe_le" on public.mesa_mcp_itens
  for select to authenticated
  using (public.is_staff((select auth.uid())) and public.can_access_client(client_id));

revoke insert, update, delete on public.mesa_mcp_itens from anon, authenticated;
grant select on public.mesa_mcp_itens to authenticated;
grant all on public.mesa_mcp_itens to service_role;

-- O papel 'agente_mes' no catálogo não entra: o CHECK de ia_modelos.padrao_para não o aceita;
-- o código usa openrouter:openai/gpt-6-sol por padrão para o agente do Mês.
