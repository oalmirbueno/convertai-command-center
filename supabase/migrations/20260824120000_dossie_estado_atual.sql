-- Dossiê com estado atual canônico + histórico intocável.
--
-- O relato: o card de dossiê do painel escolhia "o registro mais novo dentro
-- de uma lista de tipos" de project_memory — heurística. Bastava a rotina
-- gravar com um kind fora da lista, ou duas fontes escreverem em sequência,
-- para o painel exibir um dossiê velho como se fosse o atual. E o
-- upsert_project_memory é cumulativo por desenho: ele registra história,
-- não mantém estado.
--
-- O desenho novo, para TODOS os clientes (não só o caso que denunciou):
--   camada 1 (história): project_memory continua como está, append-only.
--   camada 2 (estado):   client_dossiers guarda as versões do dossiê em si,
--                        com EXATAMENTE UM registro is_current por
--                        (cliente, projeto, tipo) — garantido por índice
--                        único parcial, não por disciplina.
-- Toda troca de versão é transacional dentro do RPC upsert_current_dossier:
-- versão velha vira superseded (nunca é apagada), versão nova entra com
-- version+1, e regressão é BLOQUEADA por expected_version — atualização
-- antiga não substitui a mais nova em silêncio.

create table if not exists public.client_dossiers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  dossier_type text not null default 'contexto',
  version integer not null default 1,
  content text not null,
  summary text,
  change_reason text,
  prior_version_id uuid references public.client_dossiers(id),
  actor text,
  source text,
  tags text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  correlation_id text,
  idempotency_key text,
  is_current boolean not null default true,
  superseded_at timestamptz,
  superseded_by uuid references public.client_dossiers(id),
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Um e só um atual por chave canônica. project_id nulo (dossiê do cliente
-- inteiro) é normalizado para o uuid zero: sem isso, dois "atuais" nulos
-- coexistiriam porque null não colide com null em índice único.
create unique index if not exists client_dossiers_um_atual
  on public.client_dossiers (
    client_id,
    coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
    dossier_type
  )
  where is_current;

-- Replay de idempotência: a mesma chave nunca grava duas vezes.
create unique index if not exists client_dossiers_idempotencia
  on public.client_dossiers (client_id, dossier_type, idempotency_key)
  where idempotency_key is not null;

create index if not exists client_dossiers_historico
  on public.client_dossiers (client_id, dossier_type, version desc);

alter table public.client_dossiers enable row level security;

-- Dossiê é interno: equipe lê, cliente NUNCA (metadata.client_visible=false
-- é o padrão de nascença). Escrita só pelo RPC — nenhuma policy de
-- insert/update/delete de propósito.
drop policy if exists "equipe le dossies" on public.client_dossiers;
create policy "equipe le dossies" on public.client_dossiers
  for select using (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or public.has_role(auth.uid(), 'manager'::public.app_role)
    or public.has_role(auth.uid(), 'design'::public.app_role)
    or public.has_role(auth.uid(), 'traffic'::public.app_role)
  );

create or replace function public.upsert_current_dossier(
  _client_id uuid,
  _content text,
  _dossier_type text default 'contexto',
  _project_id uuid default null,
  _summary text default null,
  _change_reason text default null,
  _source text default null,
  _actor text default null,
  _tags text[] default '{}',
  _metadata jsonb default '{}'::jsonb,
  _correlation_id text default null,
  _idempotency_key text default null,
  _expected_version integer default null
)
returns public.client_dossiers
language plpgsql
security definer
set search_path = public
as $$
declare
  _atual public.client_dossiers%rowtype;
  _novo public.client_dossiers%rowtype;
begin
  -- Quem pode: serviço (sem uid) ou equipe. Cliente nunca escreve dossiê.
  if auth.uid() is not null
    and not (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      or public.has_role(auth.uid(), 'manager'::public.app_role)
      or public.has_role(auth.uid(), 'design'::public.app_role)
      or public.has_role(auth.uid(), 'traffic'::public.app_role)
    )
  then
    raise exception 'not_allowed: somente equipe atualiza dossie';
  end if;

  if coalesce(trim(_content), '') = '' then
    raise exception 'validation: content vazio';
  end if;

  perform 1 from public.profiles p
    where p.id = _client_id and p.deleted_at is null;
  if not found then
    raise exception 'not_found: client_id inexistente ou removido';
  end if;

  if _project_id is not null then
    perform 1 from public.projects pj
      where pj.id = _project_id
        and pj.client_id = _client_id
        and pj.deleted_at is null;
    if not found then
      raise exception 'validation: project_id nao pertence ao client_id ou foi removido';
    end if;
  end if;

  -- Replay: mesma idempotency_key devolve o que já foi gravado, sem
  -- criar versão nova. Gravação duplicada deixa de existir por construção.
  if _idempotency_key is not null then
    select * into _novo from public.client_dossiers d
      where d.client_id = _client_id
        and d.dossier_type = _dossier_type
        and d.idempotency_key = _idempotency_key
      limit 1;
    if found then
      return _novo;
    end if;
  end if;

  -- Tranca a chave inteira, não só a linha: na PRIMEIRA gravação de um
  -- cliente não existe linha para o for update segurar, e duas primeiras
  -- gravações simultâneas colidiriam no índice único em vez de virarem fila.
  perform pg_advisory_xact_lock(
    hashtext(
      _client_id::text || ':' || _dossier_type || ':'
      || coalesce(_project_id, '00000000-0000-0000-0000-000000000000'::uuid)::text
    )
  );

  -- Tranca a versão atual: duas atualizações simultâneas viram fila, não
  -- corrida — e a conta de versão nunca pula nem repete.
  select * into _atual from public.client_dossiers d
    where d.client_id = _client_id
      and d.dossier_type = _dossier_type
      and coalesce(d.project_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(_project_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and d.is_current
    for update;

  -- O bloqueio de regressão: quem escreve declara a versão que LEU. Se o
  -- mundo mudou desde então, a gravação para aqui, com conflito explícito —
  -- nunca retrocesso silencioso.
  if _expected_version is not null
    and coalesce(_atual.version, 0) <> _expected_version
  then
    raise exception 'version_conflict: a versao atual e % e voce esperava %',
      coalesce(_atual.version, 0), _expected_version;
  end if;

  if _atual.id is not null then
    update public.client_dossiers
      set is_current = false,
          superseded_at = now(),
          updated_at = now()
      where id = _atual.id;
  end if;

  insert into public.client_dossiers (
    client_id, project_id, dossier_type, version, content, summary,
    change_reason, prior_version_id, actor, source, tags, metadata,
    correlation_id, idempotency_key, is_current, effective_at
  ) values (
    _client_id, _project_id, _dossier_type,
    coalesce(_atual.version, 0) + 1,
    _content, _summary, _change_reason, _atual.id, _actor, _source,
    coalesce(_tags, '{}'),
    coalesce(_metadata, '{}'::jsonb) || jsonb_build_object('client_visible', false),
    _correlation_id, _idempotency_key, true, now()
  )
  returning * into _novo;

  if _atual.id is not null then
    update public.client_dossiers
      set superseded_by = _novo.id
      where id = _atual.id;
  end if;

  return _novo;
end;
$$;

revoke execute on function public.upsert_current_dossier(uuid, text, text, uuid, text, text, text, text, text[], jsonb, text, text, integer) from anon;
grant execute on function public.upsert_current_dossier(uuid, text, text, uuid, text, text, text, text, text[], jsonb, text, text, integer) to authenticated, service_role;

-- Auxiliar da auditoria global: chaves com mais de um is_current. O índice
-- único impede casos novos; isto confere o que já estava gravado.
create or replace function public.audit_dossies_duplicados()
returns table (id uuid)
language sql
security definer
set search_path = public
as $$
  select d.id
  from public.client_dossiers d
  join (
    select client_id,
      coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid) as pid,
      dossier_type
    from public.client_dossiers
    where is_current
    group by 1, 2, 3
    having count(*) > 1
  ) dup
    on dup.client_id = d.client_id
    and coalesce(d.project_id, '00000000-0000-0000-0000-000000000000'::uuid) = dup.pid
    and dup.dossier_type = d.dossier_type
  where d.is_current
$$;

revoke execute on function public.audit_dossies_duplicados() from anon;
grant execute on function public.audit_dossies_duplicados() to service_role;

-- ── Migração dos dossiês já gravados ────────────────────────────────────────
-- Nada é apagado: project_memory permanece intacta como história. Para cada
-- cliente, o registro de contexto mais recente vira a versão 1 do estado
-- atual canônico, apontando de onde veio. Clientes sem contexto gravado
-- simplesmente ainda não têm dossiê — o painel diz isso com clareza.
insert into public.client_dossiers (
  client_id, dossier_type, version, content, summary, change_reason,
  actor, source, metadata, correlation_id, is_current, effective_at, created_at
)
select distinct on (pm.client_id)
  pm.client_id,
  'contexto',
  1,
  pm.content,
  nullif(left(coalesce(pm.title, ''), 200), ''),
  'migracao: estado atual semeado do registro de contexto mais recente de project_memory',
  'migracao',
  coalesce(pm.source, 'migracao'),
  jsonb_build_object('origem_project_memory_id', pm.id, 'client_visible', false),
  'migracao-dossie-20260824',
  true,
  pm.created_at,
  pm.created_at
from public.project_memory pm
join public.profiles p on p.id = pm.client_id and p.deleted_at is null
where pm.kind in ('decisao','nota','marco','note','summary','decision','fact','second_brain','external')
  and pm.client_id is not null
  and coalesce(trim(pm.content), '') <> ''
order by pm.client_id, pm.created_at desc
on conflict do nothing;
