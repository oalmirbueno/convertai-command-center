-- MCP 2.37.0 (19/11/2026): auditoria das assinaturas dos agentes.
--
-- O Grok Bot guarda uma credencial só para todos os agentes dele (não dá para isolar por agente),
-- então o servidor não consegue IMPEDIR que um agente assine como outro. O que ele faz é deixar
-- rastro e alerta:
--   1) public.mcp_assinaturas_log: uma linha por chamada do Escritório e das ferramentas que gravam
--      com `operator` (principal da credencial, operador declarado e o efetivo, ferramenta,
--      correlation, IP, user-agent, hash da sessão MCP quando vier, horário). Só acrescenta.
--   2) public.mcp_alertas_assinatura: fila de alertas, um registro por hora, credencial e tipo
--      (sem spam: a mesma ocorrência na mesma hora só soma a contagem).
--   3) Vínculos que faltavam na credencial "Grok Bot": cada agente assina com o próprio nome.
-- Nada é apagado nem alterado nas tabelas existentes.

create table if not exists public.mcp_assinaturas_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  principal text not null,
  chave_nome text,
  tool_name text not null,
  correlation_id uuid,
  operador_declarado text,
  operador_efetivo text,
  -- sem_operator | ok | fora_dos_vinculos | vinculos_nao_instalados | vinculos_indisponiveis | initialize
  decisao text not null,
  ip text,
  user_agent text,
  sessao_hash text,
  protocolo text,
  cliente_info text
);
create index if not exists mcp_assinaturas_log_principal_em on public.mcp_assinaturas_log (principal, created_at desc);
create index if not exists mcp_assinaturas_log_em on public.mcp_assinaturas_log (created_at desc);

create table if not exists public.mcp_alertas_assinatura (
  id uuid primary key default gen_random_uuid(),
  hora timestamptz not null,
  principal text not null,
  tipo text not null, -- fora_dos_vinculos | operadores_com_sinais_diferentes | vinculos_indisponiveis
  operadores text[] not null default '{}',
  contagem integer not null default 1,
  primeira_em timestamptz not null default now(),
  ultima_em timestamptz not null default now(),
  amostra jsonb not null default '{}'::jsonb,
  status text not null default 'aberto', -- aberto | visto
  constraint mcp_alertas_assinatura_hora_principal_tipo unique (hora, principal, tipo)
);
create index if not exists mcp_alertas_assinatura_hora on public.mcp_alertas_assinatura (hora desc);

alter table public.mcp_assinaturas_log enable row level security;
alter table public.mcp_alertas_assinatura enable row level security;
drop policy if exists mcp_assinaturas_log_equipe_le on public.mcp_assinaturas_log;
create policy mcp_assinaturas_log_equipe_le on public.mcp_assinaturas_log for select to authenticated using (public.is_staff(auth.uid()));
drop policy if exists mcp_alertas_assinatura_equipe_le on public.mcp_alertas_assinatura;
create policy mcp_alertas_assinatura_equipe_le on public.mcp_alertas_assinatura for select to authenticated using (public.is_staff(auth.uid()));
revoke all on public.mcp_assinaturas_log, public.mcp_alertas_assinatura from anon, authenticated;
grant select on public.mcp_assinaturas_log, public.mcp_alertas_assinatura to authenticated;
grant select, insert, update on public.mcp_assinaturas_log, public.mcp_alertas_assinatura to service_role;

-- Registra (ou soma a) a ocorrência da hora. Devolve se o alerta é novo na hora.
create or replace function public.mcp_alerta_assinatura_registrar(_principal text, _tipo text, _operadores text[], _amostra jsonb)
returns table (alerta_id uuid, contagem integer, novo boolean)
language plpgsql
security definer
set search_path to ''
as $$
begin
  return query
  insert into public.mcp_alertas_assinatura as a (hora, principal, tipo, operadores, amostra)
  values (date_trunc('hour', now()), _principal, _tipo, coalesce(_operadores, '{}'), coalesce(_amostra, '{}'::jsonb))
  on conflict on constraint mcp_alertas_assinatura_hora_principal_tipo do update
    set contagem = a.contagem + 1,
        ultima_em = now(),
        operadores = (select coalesce(array_agg(distinct x order by x), '{}') from unnest(a.operadores || excluded.operadores) as x),
        amostra = excluded.amostra
  returning a.id, a.contagem, (xmax = 0);
end;
$$;
revoke all on function public.mcp_alerta_assinatura_registrar(text, text, text[], jsonb) from public, anon, authenticated;
grant execute on function public.mcp_alerta_assinatura_registrar(text, text, text[], jsonb) to service_role;

-- Vínculos que faltavam na credencial "Grok Bot" (nenhum vira padrão; o padrão continua jori).
insert into public.operator_key_bindings (principal, operator_slug, padrao, rotulo)
select 'key:18f75399-8f15-454c-ba72-5d4ae6f97817', o.slug, false, 'Grok Bot: agente ligado por Infra em 19/11/2026'
from public.internal_operators o
where o.slug in ('infra', 'money', 'pulso', 'soci', 'garim', 'corte', 'drop', 'nomi')
  and exists (select 1 from public.operator_key_bindings b where b.principal = 'key:18f75399-8f15-454c-ba72-5d4ae6f97817')
on conflict (principal, operator_slug) do nothing;
