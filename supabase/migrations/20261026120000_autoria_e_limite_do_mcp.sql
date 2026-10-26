-- Autoria por chave e limite de leitura do diário (26/10/2026, MCP 2.19). Só amplia e é idempotente.
--
-- Diagnóstico de 26/10: (a) o MCP aceitava `operator` livre, então qualquer chave assinava como qualquer
-- agente (a chave do Hermes escreveu como "paperclip" e "gestor-trafego"); (b) o leitor do Hermes abria o
-- diário ~100 mil vezes por dia porque a confirmação de resposta nunca casava.
--
-- 1) public.operator_key_bindings: quais operadores cada credencial pode assinar. principal é
--    'key:<api_keys.id>' ou 'oauth:<auth.oauth_clients.id>'; uma linha por credencial tem padrao = true
--    (o operador usado quando a assinatura pedida não é dela). Semente a partir do histórico: a chave
--    "Hermes Agent MCP" assina pelos operadores do Hermes (todas as áreas menos Paperclip, padrão
--    "default"); as chaves e os dois OAuth do Paperclip assinam pelos agentes da área Paperclip (padrão
--    "paperclip"). Operador cadastrado depois por uma credencial é ligado a ela pelo MCP.
-- 2) public.mcp_taxa + public.mcp_taxa_consumir: contador por janela de 1 minuto (limite de leitura do
--    diário: 30/min por vínculo e 120/min por credencial). Tabela UNLOGGED: contador, não histórico.
-- 3) operator_participations.metadata: guarda reply_to_entry_id (a resposta que atende uma instrução).

create table if not exists public.operator_key_bindings (
  principal text not null check (principal ~ '^(key|oauth):[0-9a-f-]{36}$'),
  operator_slug text not null check (operator_slug ~ '^[a-z][a-z0-9-]{1,38}$'),
  padrao boolean not null default false,
  rotulo text,
  created_at timestamptz not null default now(),
  primary key (principal, operator_slug)
);
create unique index if not exists operator_key_bindings_um_padrao
  on public.operator_key_bindings (principal) where padrao;

alter table public.operator_key_bindings enable row level security;
drop policy if exists operator_key_bindings_equipe_le on public.operator_key_bindings;
create policy operator_key_bindings_equipe_le on public.operator_key_bindings
  for select to authenticated using (public.is_staff(auth.uid()));
revoke all on public.operator_key_bindings from anon;
grant select on public.operator_key_bindings to authenticated;
grant select, insert, update, delete on public.operator_key_bindings to service_role;

-- Semente. Repetir não duplica (chave primária) nem cria segundo padrão.
insert into public.operator_key_bindings (principal, operator_slug, rotulo)
select 'key:27901254-b463-4f6c-8c39-92bd1884a250', o.slug, 'Hermes Agent MCP'
from public.internal_operators o
where coalesce(o.area, '') <> 'Paperclip'
on conflict do nothing;

insert into public.operator_key_bindings (principal, operator_slug, rotulo)
select p.principal, o.slug, p.rotulo
from (values
  ('key:66f423be-254f-4e4b-80d9-7ec4335e4c02', 'Aceleriq Paperclip Login'),
  ('key:532d49bb-9b15-427f-bada-ce4e10bb5092', 'Aceleriq Peperclip 2 (rotacionada)'),
  ('key:31aa8b16-36a4-4525-b095-04c70611caeb', 'Peperclip Aceleriq Mesas'),
  ('oauth:e1428bc0-2223-413a-8df1-f595f3cf3acd', 'Paperclip (OAuth)'),
  ('oauth:f11c6245-59c0-40d3-a2f1-91b19e9d1140', 'OAuth f11c6245 usado pelo Paperclip')
) as p(principal, rotulo)
cross join public.internal_operators o
where o.area = 'Paperclip'
on conflict do nothing;

update public.operator_key_bindings b set padrao = true
where b.principal = 'key:27901254-b463-4f6c-8c39-92bd1884a250' and b.operator_slug = 'default'
  and not exists (select 1 from public.operator_key_bindings x where x.principal = b.principal and x.padrao);

update public.operator_key_bindings b set padrao = true
where b.operator_slug = 'paperclip'
  and b.principal in ('key:66f423be-254f-4e4b-80d9-7ec4335e4c02', 'key:532d49bb-9b15-427f-bada-ce4e10bb5092',
    'key:31aa8b16-36a4-4525-b095-04c70611caeb', 'oauth:e1428bc0-2223-413a-8df1-f595f3cf3acd',
    'oauth:f11c6245-59c0-40d3-a2f1-91b19e9d1140')
  and not exists (select 1 from public.operator_key_bindings x where x.principal = b.principal and x.padrao);

-- Contador por janela.
create unlogged table if not exists public.mcp_taxa (
  chave text not null,
  janela timestamptz not null,
  usos integer not null default 0,
  primary key (chave, janela)
);
alter table public.mcp_taxa enable row level security;
revoke all on public.mcp_taxa from anon, authenticated;
grant select, insert, update, delete on public.mcp_taxa to service_role;

-- Soma 1 ao contador da janela corrente e diz se ainda cabe. Nunca levanta erro por limite
-- (quem chama decide a mensagem) e nunca usa 40001: erro "tente já" virou laço em 26/09.
create or replace function public.mcp_taxa_consumir(_chave text, _maximo integer, _janela_seg integer default 60)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  _inicio timestamptz := to_timestamp(floor(extract(epoch from now()) / greatest(_janela_seg, 1)) * greatest(_janela_seg, 1));
  _usos integer;
begin
  insert into public.mcp_taxa as t (chave, janela, usos) values (left(_chave, 200), _inicio, 1)
  on conflict (chave, janela) do update set usos = t.usos + 1
  returning usos into _usos;
  -- Limpeza barata: de vez em quando apaga janelas velhas.
  if random() < 0.01 then
    delete from public.mcp_taxa where janela < now() - interval '10 minutes';
  end if;
  return jsonb_build_object('ok', _usos <= _maximo, 'usos', _usos, 'maximo', _maximo,
    'libera_em', _inicio + make_interval(secs => greatest(_janela_seg, 1)));
end;
$$;
revoke all on function public.mcp_taxa_consumir(text, integer, integer) from public, anon, authenticated;
grant execute on function public.mcp_taxa_consumir(text, integer, integer) to service_role;

alter table public.operator_participations add column if not exists metadata jsonb not null default '{}'::jsonb;
create index if not exists operator_participations_responde_a
  on public.operator_participations ((metadata->>'reply_to_entry_id'))
  where metadata ? 'reply_to_entry_id';

-- Conferência (todas true):
-- select exists (select 1 from public.operator_key_bindings where principal = 'key:27901254-b463-4f6c-8c39-92bd1884a250' and operator_slug = 'default' and padrao),
--   exists (select 1 from public.operator_key_bindings where principal = 'oauth:e1428bc0-2223-413a-8df1-f595f3cf3acd' and operator_slug = 'paperclip' and padrao),
--   not exists (select 1 from public.operator_key_bindings where principal = 'key:27901254-b463-4f6c-8c39-92bd1884a250' and operator_slug = 'paperclip'),
--   (public.mcp_taxa_consumir('teste', 1)->>'ok')::boolean,
--   exists (select 1 from information_schema.columns where table_name = 'operator_participations' and column_name = 'metadata');
