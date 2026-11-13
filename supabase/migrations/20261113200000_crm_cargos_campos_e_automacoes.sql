-- CRM da empresa, rodada 2 (13/11/2026): cargos com hierarquia (admin, gerente, vendedor), repasse de
-- negocios, perfil de cada pessoa, campos proprios por ramo (inclui consorcio), automacoes e avisos.
--
-- Quem ve o que, quando a empresa separa por vendedor (visibilidade = 'proprios' e o plano permite):
--   admin    ve tudo;
--   gerente  ve os proprios negocios, os da equipe dele e os sem responsavel;
--   vendedor ve os proprios e os sem responsavel.
-- Com visibilidade = 'todos' todo mundo ve tudo, como antes; os cargos continuam valendo para o que
-- cada um pode configurar.

-- ---------------------------------------------------------------------------
-- 1. Cargos, equipe e perfil
-- ---------------------------------------------------------------------------
do $$
declare _c text;
begin
  for _c in
    select conname from pg_constraint
     where conrelid = 'public.produto_membros'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%papel%'
  loop
    execute format('alter table public.produto_membros drop constraint %I', _c);
  end loop;
end;
$$;

alter table public.produto_membros
  add constraint produto_membros_papel_check check (papel in ('admin', 'gerente', 'usuario')),
  add column if not exists gerente_id uuid references public.produto_membros(id) on delete set null,
  add column if not exists cargo text not null default '' check (length(cargo) <= 60),
  add column if not exists telefone text check (telefone is null or length(telefone) <= 30),
  add column if not exists sobre text not null default '' check (length(sobre) <= 280),
  add column if not exists foto text check (foto is null or (foto like 'data:image/%' and length(foto) <= 90000)),
  add column if not exists meta_mensal numeric(14, 2) not null default 0 check (meta_mensal >= 0);

create index if not exists produto_membros_gerente_idx on public.produto_membros (gerente_id) where gerente_id is not null;

-- O gerente de alguem e da mesma empresa, esta ativo e tem cargo de gerente ou admin. Ninguem gerencia a si mesmo.
create or replace function public.produto_membro_gerente_valido()
returns trigger
language plpgsql
set search_path = ''
as $$
declare _g public.produto_membros;
begin
  if new.gerente_id is null then
    return new;
  end if;
  if new.gerente_id = new.id then
    raise exception 'A pessoa não pode ser gerente dela mesma.' using errcode = 'P0001';
  end if;
  select * into _g from public.produto_membros where id = new.gerente_id;
  if _g.id is null or _g.conta_id <> new.conta_id or _g.estado = 'removido' or _g.papel not in ('gerente', 'admin') then
    raise exception 'Escolha como gerente alguém da empresa com cargo de gerente.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists produto_membro_gerente_valido_trg on public.produto_membros;
create trigger produto_membro_gerente_valido_trg
  before insert or update of gerente_id, conta_id on public.produto_membros
  for each row execute function public.produto_membro_gerente_valido();

-- Quem deixa de ser gerente (ou sai) solta a equipe: os vendedores ficam sem gerente.
create or replace function public.produto_membro_solta_equipe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.papel not in ('gerente', 'admin') and old.papel in ('gerente', 'admin')) or (new.estado = 'removido' and old.estado <> 'removido') then
    update public.produto_membros set gerente_id = null where gerente_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists produto_membro_solta_equipe_trg on public.produto_membros;
create trigger produto_membro_solta_equipe_trg
  after update of papel, estado on public.produto_membros
  for each row execute function public.produto_membro_solta_equipe();

-- O cargo de quem esta logado na empresa dele (nulo quando nao tem empresa).
create or replace function public.crm_meu_papel()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.papel from public.produto_membros m where m.user_id = auth.uid() and m.estado = 'ativo' limit 1
$$;

-- Admin ou gerente da empresa.
create or replace function public.crm_sou_gestor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select coalesce(public.crm_meu_papel() in ('admin', 'gerente'), false) $$;

-- Os usuarios da equipe de quem esta logado (so o gerente tem equipe).
create or replace function public.crm_minha_equipe()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(v.user_id), '{}'::uuid[])
    from public.produto_membros eu
    join public.produto_membros v on v.gerente_id = eu.id and v.estado = 'ativo' and v.user_id is not null
   where eu.user_id = auth.uid() and eu.estado = 'ativo' and eu.papel in ('gerente', 'admin')
$$;

do $$
declare _f text;
begin
  foreach _f in array array['crm_meu_papel()', 'crm_sou_gestor()', 'crm_minha_equipe()'] loop
    execute format('revoke all on function public.%s from public, anon', _f);
    execute format('grant execute on function public.%s to authenticated, service_role', _f);
  end loop;
end;
$$;

-- Negocios e compromissos passam a respeitar a equipe do gerente.
drop policy if exists "crm da conta" on public.crm_leads;
create policy "crm da conta" on public.crm_leads
  for all to authenticated
  using (conta_id = (select public.crm_conta_atual())
         and ((select public.crm_ve_tudo()) or owner_id is null or owner_id = auth.uid()
              or owner_id = any ((select public.crm_minha_equipe())::uuid[])))
  with check (conta_id = (select public.crm_conta_atual()));

drop policy if exists "crm da conta" on public.crm_activities;
create policy "crm da conta" on public.crm_activities
  for all to authenticated
  using (conta_id = (select public.crm_conta_atual())
         and ((select public.crm_ve_tudo()) or owner_id is null or owner_id = auth.uid()
              or owner_id = any ((select public.crm_minha_equipe())::uuid[])))
  with check (conta_id = (select public.crm_conta_atual()));

-- Trocar o responsavel segue a hierarquia quando a empresa separa por vendedor: o vendedor so pega
-- para si (ou solta); o gerente distribui dentro da equipe dele; o admin distribui para qualquer um.
-- Automacao e servico (API, maquina de leads) passam direto.
create or replace function public.crm_dono_segue_hierarquia()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _eu uuid := auth.uid();
  _papel text;
begin
  if _eu is null or coalesce(current_setting('crm.automacao', true), '') = '1' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.owner_id is not distinct from old.owner_id then
    return new;
  end if;
  if new.owner_id is null or new.owner_id = _eu or public.crm_ve_tudo() then
    return new;
  end if;
  _papel := public.crm_meu_papel();
  if _papel = 'gerente' and new.owner_id = any (public.crm_minha_equipe()) then
    return new;
  end if;
  raise exception 'Só o gerente ou quem administra a empresa repassa um negócio para outra pessoa.' using errcode = '42501';
end;
$$;

drop trigger if exists crm_dono_segue_hierarquia_trg on public.crm_leads;
create trigger crm_dono_segue_hierarquia_trg
  before insert or update of owner_id on public.crm_leads
  for each row execute function public.crm_dono_segue_hierarquia();

-- Repasse: o gestor passa um ou varios negocios para alguem (ou para ninguem). Os compromissos abertos
-- vao junto e a historia do negocio guarda quem repassou.
create or replace function public.crm_repassar(_leads uuid[], _para uuid default null, _nota text default '')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _eu uuid := auth.uid();
  _conta uuid := public.crm_conta_atual();
  _papel text := public.crm_meu_papel();
  _equipe uuid[] := public.crm_minha_equipe();
  _ve_tudo boolean := public.crm_ve_tudo();
  _nome_para text;
  _nome_eu text;
  _quantos integer := 0;
  _l record;
begin
  if _conta is null then
    raise exception 'O CRM da empresa não está liberado.' using errcode = '42501';
  end if;
  if coalesce(_papel, '') not in ('admin', 'gerente') then
    raise exception 'Só o gerente ou quem administra a empresa repassa negócios.' using errcode = '42501';
  end if;
  if coalesce(array_length(_leads, 1), 0) = 0 or array_length(_leads, 1) > 500 then
    raise exception 'Escolha de 1 a 500 negócios.' using errcode = 'P0001';
  end if;
  if _para is not null then
    select m.nome into _nome_para from public.produto_membros m
     where m.conta_id = _conta and m.user_id = _para and m.estado = 'ativo';
    if not found then
      raise exception 'Essa pessoa não está ativa na empresa.' using errcode = 'P0001';
    end if;
    if _papel = 'gerente' and not _ve_tudo and _para <> _eu and not (_para = any (_equipe)) then
      raise exception 'O gerente repassa para a própria equipe.' using errcode = '42501';
    end if;
  end if;
  select m.nome into _nome_eu from public.produto_membros m where m.conta_id = _conta and m.user_id = _eu and m.estado = 'ativo';

  perform set_config('crm.automacao', '1', true);
  for _l in
    select l.id, l.owner_id from public.crm_leads l
     where l.conta_id = _conta and l.id = any (_leads) and l.owner_id is distinct from _para
       and (_papel = 'admin' or _ve_tudo or l.owner_id is null or l.owner_id = _eu or l.owner_id = any (_equipe))
     for update
  loop
    update public.crm_leads set owner_id = _para where id = _l.id;
    update public.crm_activities set owner_id = _para where conta_id = _conta and lead_id = _l.id and done_at is null;
    insert into public.crm_lead_events (conta_id, lead_id, kind, note, created_by)
    values (_conta, _l.id, 'nota',
            left('Repassado por ' || coalesce(nullif(_nome_eu, ''), 'gestor') || ' para ' || coalesce(nullif(_nome_para, ''), case when _para is null then 'ninguém (sem responsável)' else 'outra pessoa' end)
                 || case when btrim(coalesce(_nota, '')) <> '' then '. ' || btrim(_nota) else '' end, 600),
            _eu);
    if _para is not null and _para <> _eu then
      insert into public.crm_avisos (conta_id, para, titulo, texto, lead_id)
      values (_conta, _para, 'Negócio repassado para você', left(coalesce(nullif(btrim(_nota), ''), 'Veja o negócio e marque o próximo passo.'), 280), _l.id);
    end if;
    _quantos := _quantos + 1;
  end loop;
  perform set_config('crm.automacao', '', true);
  return _quantos;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Avisos dentro do produto (o sino)
-- ---------------------------------------------------------------------------
create table if not exists public.crm_avisos (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.produto_contas(id) on delete cascade,
  para uuid not null,
  titulo text not null check (length(titulo) between 1 and 120),
  texto text not null default '' check (length(texto) <= 400),
  lead_id uuid references public.crm_leads(id) on delete cascade,
  lido_em timestamptz,
  criado_em timestamptz not null default now()
);

create index if not exists crm_avisos_para_idx on public.crm_avisos (para, criado_em desc);

alter table public.crm_avisos enable row level security;
revoke all on public.crm_avisos from anon;
grant select, update on public.crm_avisos to authenticated;
grant all on public.crm_avisos to service_role;

drop policy if exists "crm avisos de quem recebe" on public.crm_avisos;
create policy "crm avisos de quem recebe" on public.crm_avisos
  for select to authenticated
  using (para = auth.uid() and conta_id = (select public.crm_conta_atual()));

drop policy if exists "crm avisos marcar lido" on public.crm_avisos;
create policy "crm avisos marcar lido" on public.crm_avisos
  for update to authenticated
  using (para = auth.uid() and conta_id = (select public.crm_conta_atual()))
  with check (para = auth.uid() and conta_id = (select public.crm_conta_atual()));

-- So o "lido" muda pela tela.
create or replace function public.crm_aviso_so_marca_lido()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.conta_id := old.conta_id; new.para := old.para; new.titulo := old.titulo;
    new.texto := old.texto; new.lead_id := old.lead_id; new.criado_em := old.criado_em;
  end if;
  return new;
end;
$$;

drop trigger if exists crm_aviso_so_marca_lido_trg on public.crm_avisos;
create trigger crm_aviso_so_marca_lido_trg
  before update on public.crm_avisos
  for each row execute function public.crm_aviso_so_marca_lido();

-- ---------------------------------------------------------------------------
-- 3. Campos proprios do negocio (por ramo: consorcio, imobiliaria, clinica...)
-- ---------------------------------------------------------------------------
alter table public.crm_leads
  add column if not exists campos jsonb not null default '{}'::jsonb
    check (jsonb_typeof(campos) = 'object' and pg_column_size(campos) <= 16000);

create table if not exists public.crm_campos (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null default public.crm_conta_atual() references public.produto_contas(id) on delete cascade,
  chave text not null check (chave ~ '^[a-z][a-z0-9_]{1,39}$'),
  rotulo text not null check (length(btrim(rotulo)) between 2 and 40),
  tipo text not null default 'texto' check (tipo in ('texto', 'numero', 'dinheiro', 'porcentagem', 'data', 'lista', 'sim_nao')),
  opcoes jsonb not null default '[]'::jsonb check (jsonb_typeof(opcoes) = 'array' and pg_column_size(opcoes) <= 4000),
  grupo text not null default '' check (length(grupo) <= 40),
  no_cartao boolean not null default false,
  obrigatorio boolean not null default false,
  ordem integer not null default 0,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (conta_id, chave)
);

alter table public.crm_campos enable row level security;
revoke all on public.crm_campos from anon;
grant select, insert, update, delete on public.crm_campos to authenticated;
grant all on public.crm_campos to service_role;

drop policy if exists "crm campos leitura" on public.crm_campos;
create policy "crm campos leitura" on public.crm_campos
  for select to authenticated
  using (conta_id = (select public.crm_conta_atual()));

drop policy if exists "crm campos do gestor" on public.crm_campos;
create policy "crm campos do gestor" on public.crm_campos
  for all to authenticated
  using (conta_id = (select public.crm_conta_atual()) and (select public.crm_sou_gestor()))
  with check (conta_id = (select public.crm_conta_atual()) and (select public.crm_sou_gestor()));

-- Uma empresa nao passa de 40 campos.
create or replace function public.crm_campos_limite()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.crm_campos c where c.conta_id = new.conta_id) >= 40 then
    raise exception 'O limite é de 40 campos por empresa.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists crm_campos_limite_trg on public.crm_campos;
create trigger crm_campos_limite_trg
  before insert on public.crm_campos
  for each row execute function public.crm_campos_limite();

-- O ramo "consorcio" entra na lista de ramos aceitos.
create or replace function public.produto_perfil_valido(_p jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'nicho', case when _p ->> 'nicho' in ('imobiliaria', 'consorcio', 'saude', 'servicos', 'varejo', 'agencia', 'educacao', 'b2b', 'outro') then _p ->> 'nicho' end,
    'objetivo', case when _p ->> 'objetivo' in ('organizar', 'prospectar', 'equipe', 'pos_venda') then _p ->> 'objetivo' end,
    'etapas', (
      select case when count(*) > 0 then jsonb_object_agg(e.chave, left(btrim(e.valor), 24)) end
        from jsonb_each_text(case when jsonb_typeof(_p -> 'etapas') = 'object' then _p -> 'etapas' else '{}'::jsonb end) as e(chave, valor)
       where e.chave in ('novo', 'contato', 'diagnostico', 'proposta', 'negociacao', 'ganho', 'perdido')
         and length(btrim(e.valor)) between 2 and 24
    )
  ))
$$;

-- ---------------------------------------------------------------------------
-- 4. Automacoes
-- ---------------------------------------------------------------------------
create table if not exists public.crm_automacoes (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null default public.crm_conta_atual() references public.produto_contas(id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 2 and 80),
  gatilho text not null check (gatilho in ('negocio_criado', 'etapa_mudou', 'negocio_ganho', 'negocio_perdido', 'negocio_parado')),
  -- { "etapa": "proposta" } limita a etapa; { "dias": 5 } e o tempo parado; { "sem_dono": true } so sem responsavel.
  condicao jsonb not null default '{}'::jsonb check (jsonb_typeof(condicao) = 'object' and pg_column_size(condicao) <= 2000),
  acao text not null check (acao in ('criar_tarefa', 'atribuir_rodizio', 'atribuir_membro', 'mover_etapa', 'avisar')),
  -- criar_tarefa { titulo, em_dias, tipo }; atribuir_membro { user_id }; mover_etapa { para }; avisar { quem: dono|gerente|admin, texto }
  parametros jsonb not null default '{}'::jsonb check (jsonb_typeof(parametros) = 'object' and pg_column_size(parametros) <= 4000),
  ativa boolean not null default true,
  execucoes integer not null default 0,
  ultima_em timestamptz,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists crm_automacoes_conta_idx on public.crm_automacoes (conta_id, gatilho) where ativa;

create table if not exists public.crm_automacao_execucoes (
  id bigint generated always as identity primary key,
  conta_id uuid not null references public.produto_contas(id) on delete cascade,
  automacao_id uuid not null references public.crm_automacoes(id) on delete cascade,
  lead_id uuid references public.crm_leads(id) on delete cascade,
  resultado text not null default '' check (length(resultado) <= 200),
  em timestamptz not null default now()
);

create index if not exists crm_automacao_execucoes_idx on public.crm_automacao_execucoes (automacao_id, lead_id, em desc);

alter table public.crm_automacoes enable row level security;
alter table public.crm_automacao_execucoes enable row level security;
revoke all on public.crm_automacoes, public.crm_automacao_execucoes from anon;
grant select, insert, update, delete on public.crm_automacoes to authenticated;
grant select on public.crm_automacao_execucoes to authenticated;
grant all on public.crm_automacoes, public.crm_automacao_execucoes to service_role;

drop policy if exists "crm automacoes leitura" on public.crm_automacoes;
create policy "crm automacoes leitura" on public.crm_automacoes
  for select to authenticated
  using (conta_id = (select public.crm_conta_atual()));

drop policy if exists "crm automacoes do gestor" on public.crm_automacoes;
create policy "crm automacoes do gestor" on public.crm_automacoes
  for all to authenticated
  using (conta_id = (select public.crm_conta_atual()) and (select public.crm_sou_gestor()))
  with check (conta_id = (select public.crm_conta_atual()) and (select public.crm_sou_gestor()));

drop policy if exists "crm execucoes do gestor" on public.crm_automacao_execucoes;
create policy "crm execucoes do gestor" on public.crm_automacao_execucoes
  for select to authenticated
  using (conta_id = (select public.crm_conta_atual()) and (select public.crm_sou_gestor()));

-- A tela nao mexe nos contadores, e uma empresa nao passa de 30 automacoes.
create or replace function public.crm_automacao_guarda()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.crm_automacoes a where a.conta_id = new.conta_id) >= 30 then
      raise exception 'O limite é de 30 automações por empresa.' using errcode = 'P0001';
    end if;
    if auth.uid() is not null then
      new.execucoes := 0; new.ultima_em := null;
    end if;
  else
    new.conta_id := old.conta_id;
    if auth.uid() is not null and coalesce(current_setting('crm.automacao', true), '') <> '1' then
      new.execucoes := old.execucoes; new.ultima_em := old.ultima_em;
    end if;
    new.atualizado_em := now();
  end if;
  return new;
end;
$$;

drop trigger if exists crm_automacao_guarda_trg on public.crm_automacoes;
create trigger crm_automacao_guarda_trg
  before insert or update on public.crm_automacoes
  for each row execute function public.crm_automacao_guarda();

-- Quem recebe o proximo negocio no rodizio: o vendedor ativo com menos negocios abertos
-- (empate: quem recebeu o ultimo ha mais tempo). Gerente e admin so entram se nao houver vendedor.
create or replace function public.crm_proximo_do_rodizio(_conta uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with pessoas as (
    select m.user_id, m.papel,
           (select count(*) from public.crm_leads l
             where l.conta_id = _conta and l.owner_id = m.user_id and l.archived_at is null and l.stage not in ('ganho', 'perdido')) as abertos,
           (select max(l.created_at) from public.crm_leads l where l.conta_id = _conta and l.owner_id = m.user_id) as ultimo
      from public.produto_membros m
     where m.conta_id = _conta and m.estado = 'ativo' and m.user_id is not null
  )
  select p.user_id from pessoas p
   where p.papel = 'usuario' or not exists (select 1 from pessoas v where v.papel = 'usuario')
   order by p.abertos, p.ultimo nulls first, p.user_id
   limit 1
$$;

revoke all on function public.crm_proximo_do_rodizio(uuid) from public, anon, authenticated;
grant execute on function public.crm_proximo_do_rodizio(uuid) to service_role;

-- Aplica uma automacao a um negocio. Devolve o que fez (vazio quando nao fez nada).
create or replace function public.crm_automacao_aplicar(_a public.crm_automacoes, _l public.crm_leads)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  _p jsonb := _a.parametros;
  _feito text := '';
  _alvo uuid;
  _para text;
  _dias integer;
  _quem text;
  _texto text;
begin
  if _a.acao = 'criar_tarefa' then
    _dias := least(greatest(coalesce(nullif(_p ->> 'em_dias', '')::integer, 1), 0), 90);
    insert into public.crm_activities (conta_id, lead_id, kind, title, due_at, owner_id, notes)
    values (_l.conta_id, _l.id,
            case when _p ->> 'tipo' in ('ligacao', 'reuniao', 'whatsapp', 'email', 'proposta', 'tarefa') then _p ->> 'tipo' else 'tarefa' end,
            left(coalesce(nullif(btrim(_p ->> 'titulo'), ''), 'Dar o próximo passo'), 160),
            greatest((date_trunc('day', now() at time zone 'America/Sao_Paulo') + make_interval(days => _dias) + interval '9 hours') at time zone 'America/Sao_Paulo',
                     now() + interval '1 hour'),
            _l.owner_id, 'Criado pela automação "' || _a.nome || '".');
    _feito := 'tarefa criada';
  elsif _a.acao in ('atribuir_rodizio', 'atribuir_membro') then
    if _a.acao = 'atribuir_rodizio' then
      _alvo := public.crm_proximo_do_rodizio(_l.conta_id);
    else
      select m.user_id into _alvo from public.produto_membros m
       where m.conta_id = _l.conta_id and m.estado = 'ativo' and m.user_id::text = _p ->> 'user_id';
    end if;
    if _alvo is not null and _l.owner_id is distinct from _alvo then
      update public.crm_leads set owner_id = _alvo where id = _l.id;
      update public.crm_activities set owner_id = _alvo where conta_id = _l.conta_id and lead_id = _l.id and done_at is null;
      insert into public.crm_avisos (conta_id, para, titulo, texto, lead_id)
      values (_l.conta_id, _alvo, 'Negócio novo para você', left(coalesce(nullif(_l.company, ''), _l.name), 200), _l.id);
      _feito := 'responsável definido';
    end if;
  elsif _a.acao = 'mover_etapa' then
    _para := _p ->> 'para';
    if _para in ('novo', 'contato', 'diagnostico', 'proposta', 'negociacao') and _l.stage <> _para and _l.stage not in ('ganho', 'perdido') then
      update public.crm_leads set stage = _para where id = _l.id;
      insert into public.crm_lead_events (conta_id, lead_id, kind, from_stage, to_stage, note)
      values (_l.conta_id, _l.id, 'stage', _l.stage, _para, 'Movido pela automação "' || _a.nome || '".');
      _feito := 'etapa mudada';
    end if;
  elsif _a.acao = 'avisar' then
    _quem := coalesce(_p ->> 'quem', 'gerente');
    _texto := left(coalesce(nullif(btrim(_p ->> 'texto'), ''), coalesce(nullif(_l.company, ''), _l.name)), 280);
    insert into public.crm_avisos (conta_id, para, titulo, texto, lead_id)
    select _l.conta_id, d.user_id, left(_a.nome, 120), _texto, _l.id
      from (
        select distinct m.user_id
          from public.produto_membros m
         where m.conta_id = _l.conta_id and m.estado = 'ativo' and m.user_id is not null
           and (
             (_quem = 'dono' and m.user_id = _l.owner_id)
             or (_quem = 'admin' and m.papel = 'admin')
             or (_quem = 'gerente' and (
                   m.id = (select v.gerente_id from public.produto_membros v where v.conta_id = _l.conta_id and v.user_id = _l.owner_id and v.estado = 'ativo')
                   or (m.papel = 'admin' and not exists (
                         select 1 from public.produto_membros v
                          where v.conta_id = _l.conta_id and v.user_id = _l.owner_id and v.estado = 'ativo' and v.gerente_id is not null))
                 ))
           )
      ) d;
    if found then
      _feito := 'aviso enviado';
    end if;
  end if;

  if _feito <> '' then
    insert into public.crm_automacao_execucoes (conta_id, automacao_id, lead_id, resultado) values (_l.conta_id, _a.id, _l.id, _feito);
    update public.crm_automacoes set execucoes = execucoes + 1, ultima_em = now() where id = _a.id;
  end if;
  return _feito;
end;
$$;

revoke all on function public.crm_automacao_aplicar(public.crm_automacoes, public.crm_leads) from public, anon, authenticated;
grant execute on function public.crm_automacao_aplicar(public.crm_automacoes, public.crm_leads) to service_role;

-- Dispara as automacoes de um acontecimento. Uma automacao nao dispara outra (sem cascata).
create or replace function public.crm_automacoes_no_negocio()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _gatilhos text[];
  _a public.crm_automacoes;
  _atual public.crm_leads;
begin
  if coalesce(current_setting('crm.automacao', true), '') = '1' or new.archived_at is not null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    _gatilhos := array['negocio_criado'];
  elsif new.stage is distinct from old.stage then
    _gatilhos := array['etapa_mudou'] || case new.stage when 'ganho' then array['negocio_ganho'] when 'perdido' then array['negocio_perdido'] else '{}'::text[] end;
  else
    return new;
  end if;

  perform set_config('crm.automacao', '1', true);
  begin
    for _a in
      select a.* from public.crm_automacoes a
       where a.conta_id = new.conta_id and a.ativa and a.gatilho = any (_gatilhos)
         and (not (a.condicao ? 'etapa') or a.condicao ->> 'etapa' = new.stage)
         and (coalesce((a.condicao ->> 'sem_dono')::boolean, false) is not true or new.owner_id is null)
       order by a.criado_em
       limit 30
    loop
      select * into _atual from public.crm_leads where id = new.id;
      perform public.crm_automacao_aplicar(_a, _atual);
    end loop;
  exception when others then
    -- Uma automacao com defeito nunca impede a equipe de salvar o negocio.
    raise warning 'crm automacao falhou: %', sqlerrm;
  end;
  perform set_config('crm.automacao', '', true);
  return new;
end;
$$;

drop trigger if exists zzz_crm_automacoes_no_negocio on public.crm_leads;
create trigger zzz_crm_automacoes_no_negocio
  after insert or update of stage on public.crm_leads
  for each row execute function public.crm_automacoes_no_negocio();

-- De hora em hora: negocio aberto parado ha N dias. Cada automacao age no maximo uma vez por negocio a cada N dias.
create or replace function public.crm_automacoes_de_tempo()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _a public.crm_automacoes;
  _l public.crm_leads;
  _dias integer;
  _feitos integer := 0;
begin
  perform set_config('crm.automacao', '1', true);
  for _a in
    select a.* from public.crm_automacoes a
      join public.produto_contas c on c.id = a.conta_id
     where a.ativa and a.gatilho = 'negocio_parado' and c.crm_ativo and public.produto_conta_liberada(c.id)
  loop
    _dias := least(greatest(coalesce(nullif(_a.condicao ->> 'dias', '')::integer, 5), 1), 180);
    for _l in
      select l.* from public.crm_leads l
       where l.conta_id = _a.conta_id and l.archived_at is null and l.stage not in ('ganho', 'perdido')
         and (not (_a.condicao ? 'etapa') or _a.condicao ->> 'etapa' = l.stage)
         and (coalesce((_a.condicao ->> 'sem_dono')::boolean, false) is not true or l.owner_id is null)
         and l.updated_at < now() - make_interval(days => _dias)
         and not exists (select 1 from public.crm_activities t where t.lead_id = l.id and t.done_at is null and t.due_at >= now())
         and not exists (select 1 from public.crm_automacao_execucoes e
                          where e.automacao_id = _a.id and e.lead_id = l.id and e.em > now() - make_interval(days => _dias))
       order by l.updated_at
       limit 200
    loop
      begin
        if public.crm_automacao_aplicar(_a, _l) <> '' then
          _feitos := _feitos + 1;
        end if;
      exception when others then
        raise warning 'crm automacao de tempo falhou: %', sqlerrm;
      end;
    end loop;
  end loop;
  perform set_config('crm.automacao', '', true);
  return _feitos;
end;
$$;

revoke all on function public.crm_automacoes_de_tempo() from public, anon, authenticated;
grant execute on function public.crm_automacoes_de_tempo() to service_role;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    begin
      perform cron.unschedule('crm-automacoes-de-tempo');
    exception when others then null;
    end;
    perform cron.schedule('crm-automacoes-de-tempo', '17 * * * *', 'select public.crm_automacoes_de_tempo();');
  end if;
end;
$$;

-- As tabelas novas seguem as regras das outras do CRM: a empresa da linha nao muda.
do $$
declare _t text;
begin
  foreach _t in array array['crm_campos', 'crm_automacoes'] loop
    execute format('drop trigger if exists %I on public.%I', _t || '_conta_fixa', _t);
    execute format('create trigger %I before update on public.%I for each row execute function public.crm_conta_nao_muda()', _t || '_conta_fixa', _t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Equipe: convidar com cargo, mudar cargo, perfil e ranking
-- ---------------------------------------------------------------------------
drop function if exists public.produto_convidar(text, text, text);
create or replace function public.produto_convidar(_email text, _nome text default '', _papel text default 'usuario', _gerente uuid default null, _cargo text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _eu uuid := auth.uid();
  _conta uuid := public.produto_minha_conta();
  _c public.produto_contas;
  _limpo text := lower(btrim(coalesce(_email, '')));
  _ocupados integer;
  _id uuid;
begin
  if _conta is null or not public.produto_sou_admin_da_conta(_conta) then
    raise exception 'Só quem administra a empresa convida.' using errcode = '42501';
  end if;
  if _limpo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'E-mail inválido.' using errcode = 'P0001';
  end if;
  if coalesce(_papel, 'usuario') not in ('admin', 'gerente', 'usuario') then
    raise exception 'Cargo inválido.' using errcode = 'P0001';
  end if;
  select * into _c from public.produto_contas where id = _conta for update;
  if exists (select 1 from public.produto_membros m where m.conta_id = _conta and m.email = _limpo and m.estado <> 'removido') then
    raise exception 'Essa pessoa já está na empresa.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.produto_membros m where m.email = _limpo and m.estado = 'ativo') then
    raise exception 'Esse e-mail já usa o produto em outra empresa.' using errcode = 'P0001';
  end if;
  select count(*) into _ocupados from public.produto_membros m where m.conta_id = _conta and m.estado <> 'removido';
  if _ocupados >= _c.usuarios_contratados then
    raise exception 'Todos os % usuários do plano estão em uso. Aumente os usuários para convidar.', _c.usuarios_contratados using errcode = 'P0001';
  end if;
  insert into public.produto_membros (conta_id, email, nome, papel, estado, convidado_por, gerente_id, cargo)
  values (_conta, _limpo, left(btrim(coalesce(_nome, '')), 120), coalesce(_papel, 'usuario'), 'convidado', _eu,
          case when coalesce(_papel, 'usuario') = 'usuario' then _gerente end, left(btrim(coalesce(_cargo, '')), 60))
  returning id into _id;
  insert into public.produto_historico (conta_id, ator, acao, detalhe)
  values (_conta, _eu, 'membro_convidado', jsonb_build_object('membro', _id, 'papel', coalesce(_papel, 'usuario')));
  return _id;
end;
$$;

revoke all on function public.produto_convidar(text, text, text, uuid, text) from public, anon;
grant execute on function public.produto_convidar(text, text, text, uuid, text) to authenticated, service_role;

create or replace function public.produto_membro_mudar(_membro uuid, _papel text default null, _remover boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _eu uuid := auth.uid();
  _m public.produto_membros;
  _admins integer;
begin
  select * into _m from public.produto_membros where id = _membro for update;
  if _m.id is null or not public.produto_sou_admin_da_conta(_m.conta_id) then
    raise exception 'Só quem administra a empresa altera a equipe.' using errcode = '42501';
  end if;
  select count(*) into _admins from public.produto_membros m
   where m.conta_id = _m.conta_id and m.estado = 'ativo' and m.papel = 'admin' and m.id <> _m.id;
  if _m.papel = 'admin' and _m.estado = 'ativo' and _admins = 0
     and (_remover or coalesce(_papel, 'admin') <> 'admin') then
    raise exception 'A empresa precisa de pelo menos uma pessoa administradora.' using errcode = 'P0001';
  end if;
  if _remover then
    update public.produto_membros set estado = 'removido', gerente_id = null where id = _m.id;
    -- Os negocios da pessoa ficam sem dono, para a equipe redistribuir.
    perform set_config('crm.automacao', '1', true);
    update public.crm_leads set owner_id = null where conta_id = _m.conta_id and owner_id = _m.user_id;
    update public.crm_activities set owner_id = null where conta_id = _m.conta_id and owner_id = _m.user_id and done_at is null;
    perform set_config('crm.automacao', '', true);
    insert into public.produto_historico (conta_id, ator, acao, detalhe)
    values (_m.conta_id, _eu, 'membro_removido', jsonb_build_object('membro', _m.id));
  elsif _papel in ('admin', 'gerente', 'usuario') then
    update public.produto_membros set papel = _papel, gerente_id = case when _papel = 'usuario' then gerente_id end where id = _m.id;
    insert into public.produto_historico (conta_id, ator, acao, detalhe)
    values (_m.conta_id, _eu, 'membro_papel', jsonb_build_object('membro', _m.id, 'papel', _papel));
  end if;
end;
$$;

-- O perfil de uma pessoa. Cada um edita o proprio (nome, cargo, telefone, sobre, foto); o admin define
-- o gerente e a meta de qualquer um; o gerente define a meta da equipe dele.
create or replace function public.produto_membro_perfil(_membro uuid, _dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _eu uuid := auth.uid();
  _m public.produto_membros;
  _meu public.produto_membros;
  _admin boolean;
  _proprio boolean;
  _lidera boolean;
  _gerente uuid;
begin
  select * into _m from public.produto_membros where id = _membro for update;
  select * into _meu from public.produto_membros where user_id = _eu and estado = 'ativo' limit 1;
  if _m.id is null or _meu.id is null or _m.conta_id <> _meu.conta_id or _m.estado = 'removido' then
    raise exception 'Pessoa não encontrada na empresa.' using errcode = '42501';
  end if;
  _admin := _meu.papel = 'admin';
  _proprio := _m.id = _meu.id;
  _lidera := _meu.papel = 'gerente' and _m.gerente_id = _meu.id;
  if not (_admin or _proprio or _lidera) then
    raise exception 'Você só edita o próprio perfil.' using errcode = '42501';
  end if;
  if _dados ? 'foto' and _dados ->> 'foto' is not null and (_dados ->> 'foto' not like 'data:image/%' or length(_dados ->> 'foto') > 90000) then
    raise exception 'A foto precisa ser uma imagem pequena.' using errcode = 'P0001';
  end if;
  if _admin and _dados ? 'gerente_id' then
    _gerente := nullif(_dados ->> 'gerente_id', '')::uuid;
  else
    _gerente := _m.gerente_id;
  end if;
  update public.produto_membros set
    nome = case when (_admin or _proprio) and _dados ? 'nome' and length(btrim(_dados ->> 'nome')) >= 2 then left(btrim(_dados ->> 'nome'), 120) else nome end,
    cargo = case when _dados ? 'cargo' then left(btrim(coalesce(_dados ->> 'cargo', '')), 60) else cargo end,
    telefone = case when (_admin or _proprio) and _dados ? 'telefone' then nullif(left(btrim(coalesce(_dados ->> 'telefone', '')), 30), '') else telefone end,
    sobre = case when (_admin or _proprio) and _dados ? 'sobre' then left(btrim(coalesce(_dados ->> 'sobre', '')), 280) else sobre end,
    foto = case when (_admin or _proprio) and _dados ? 'foto' then _dados ->> 'foto' else foto end,
    meta_mensal = case when (_admin or _lidera) and _dados ? 'meta_mensal' then least(greatest(coalesce(nullif(_dados ->> 'meta_mensal', '')::numeric, 0), 0), 999999999) else meta_mensal end,
    gerente_id = case when papel = 'usuario' then _gerente end
  where id = _m.id;
end;
$$;

revoke all on function public.produto_membro_perfil(uuid, jsonb) from public, anon;
grant execute on function public.produto_membro_perfil(uuid, jsonb) to authenticated, service_role;
revoke all on function public.crm_repassar(uuid[], uuid, text) from public, anon;
grant execute on function public.crm_repassar(uuid[], uuid, text) to authenticated, service_role;

-- Ranking do mes: o que cada pessoa vendeu, o que tem em aberto e a meta. O vendedor ve a posicao de todos
-- (nome e vendas ganhas), para a disputa saudavel; valores em aberto de colegas so o gestor ve.
create or replace function public.crm_ranking(_mes date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _eu uuid := auth.uid();
  _conta uuid := public.crm_conta_atual();
  _papel text := public.crm_meu_papel();
  _equipe uuid[] := public.crm_minha_equipe();
  _ve_tudo boolean := public.crm_ve_tudo();
  _ini timestamptz;
  _fim timestamptz;
begin
  if _conta is null then
    return '[]'::jsonb;
  end if;
  _ini := (date_trunc('month', coalesce(_mes::timestamp, now() at time zone 'America/Sao_Paulo'))) at time zone 'America/Sao_Paulo';
  _fim := _ini + interval '1 month';
  return (
    select coalesce(jsonb_agg(to_jsonb(r) order by r.vendido desc, r.ganhos desc, r.nome), '[]'::jsonb)
      from (
        select m.id as membro_id, m.user_id, m.nome, m.cargo, m.papel, m.foto, m.gerente_id, m.meta_mensal,
               coalesce(g.ganhos, 0) as ganhos,
               coalesce(g.vendido, 0) as vendido,
               case when d.detalhe then coalesce(a.abertos, 0) end as abertos,
               case when d.detalhe then coalesce(a.em_jogo, 0) end as em_jogo,
               case when d.detalhe then coalesce(g.perdidos, 0) end as perdidos,
               case when d.detalhe then coalesce(t.atrasadas, 0) end as atrasadas
          from public.produto_membros m
          cross join lateral (select (_papel = 'admin' or _ve_tudo or m.user_id = _eu or m.user_id = any (_equipe)) as detalhe) d
          left join lateral (
            select count(*) filter (where l.stage = 'ganho') as ganhos,
                   count(*) filter (where l.stage = 'perdido') as perdidos,
                   sum(case when l.stage = 'ganho' then l.monthly_value * 12 + l.one_off_value else 0 end) as vendido
              from public.crm_leads l
             where l.conta_id = _conta and l.owner_id = m.user_id and l.archived_at is null
               and l.stage in ('ganho', 'perdido') and l.closed_at >= _ini and l.closed_at < _fim
          ) g on true
          left join lateral (
            select count(*) as abertos, sum(l.monthly_value * 12 + l.one_off_value) as em_jogo
              from public.crm_leads l
             where l.conta_id = _conta and l.owner_id = m.user_id and l.archived_at is null and l.stage not in ('ganho', 'perdido')
          ) a on true
          left join lateral (
            select count(*) as atrasadas from public.crm_activities t
             where t.conta_id = _conta and t.owner_id = m.user_id and t.done_at is null and t.due_at < now()
          ) t on true
         where m.conta_id = _conta and m.estado = 'ativo' and m.user_id is not null
      ) r
  );
end;
$$;

revoke all on function public.crm_ranking(date) from public, anon;
grant execute on function public.crm_ranking(date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. O estado do produto passa a trazer cargo, gerente e perfil de cada pessoa
-- ---------------------------------------------------------------------------
create or replace function public.produto_estado()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _eu uuid := auth.uid();
  _conta public.produto_contas;
  _eu_membro public.produto_membros;
  _plano public.produto_planos;
  _cfg public.produto_config;
  _admin boolean;
  _gestor boolean;
  _mes date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
begin
  if _eu is null then
    raise exception 'sem sessao' using errcode = '28000';
  end if;
  select * into _cfg from public.produto_config where id;
  select m.* into _eu_membro from public.produto_membros m where m.user_id = _eu and m.estado = 'ativo' limit 1;

  if _eu_membro.id is null then
    return jsonb_build_object(
      'conta', null,
      'convite', (select jsonb_build_object('conta', c.nome, 'papel', m.papel)
                    from public.produto_membros m join public.produto_contas c on c.id = m.conta_id
                   where m.estado = 'convidado' and m.email = lower((select u.email from auth.users u where u.id = _eu))
                   order by m.convidado_em desc limit 1),
      'dono_da_casa', public.produto_dono(),
      'pagamentos_ativos', _cfg.pagamentos_ativos,
      'teste_dias', _cfg.teste_dias
    );
  end if;

  select * into _conta from public.produto_contas where id = _eu_membro.conta_id;
  select * into _plano from public.produto_planos where id = _conta.plano_id;
  _admin := _eu_membro.papel = 'admin';
  _gestor := _eu_membro.papel in ('admin', 'gerente');

  return jsonb_build_object(
    'conta', jsonb_build_object(
      'id', _conta.id, 'nome', _conta.nome, 'estado', _conta.estado, 'plano_id', _conta.plano_id,
      'usuarios_contratados', _conta.usuarios_contratados, 'crm_ativo', _conta.crm_ativo,
      'email_ativo', _conta.email_ativo, 'email_caixas_contratadas', _conta.email_caixas_contratadas,
      'teste_ate', _conta.teste_ate, 'atrasada_desde', _conta.atrasada_desde, 'acesso_ate', _conta.acesso_ate,
      'visibilidade', _conta.visibilidade,
      'aparencia', _conta.aparencia,
      'perfil', _conta.perfil,
      'documento', case when _admin then _conta.documento end,
      'email_cobranca', case when _admin then _conta.email_cobranca end,
      'telefone', case when _admin then _conta.telefone end
    ),
    'eu', jsonb_build_object('membro_id', _eu_membro.id, 'papel', _eu_membro.papel, 'nome', _eu_membro.nome, 'email', _eu_membro.email,
                             'cargo', _eu_membro.cargo, 'gerente_id', _eu_membro.gerente_id),
    'plano', jsonb_build_object('id', _plano.id, 'nome', _plano.nome, 'preco_usuario', _plano.preco_usuario,
                                'limites', _plano.limites, 'email_caixas_incluidas', _plano.email_caixas_incluidas),
    'liberada', public.produto_conta_liberada(_conta.id),
    'crm', _conta.crm_ativo and public.produto_conta_liberada(_conta.id),
    'email', _conta.email_ativo and public.produto_conta_liberada(_conta.id),
    'dono_da_casa', public.produto_dono(),
    'pagamentos_ativos', _cfg.pagamentos_ativos,
    'tolerancia_dias', _cfg.tolerancia_dias,
    've_tudo', public.crm_ve_tudo(),
    'equipe', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', m.id, 'user_id', m.user_id, 'nome', m.nome, 'email', case when _gestor or m.user_id = _eu then m.email end,
                  'papel', m.papel, 'estado', m.estado, 'entrou_em', m.entrou_em,
                  'cargo', m.cargo, 'gerente_id', m.gerente_id, 'foto', m.foto, 'sobre', m.sobre,
                  'telefone', case when _gestor or m.user_id = _eu then m.telefone end,
                  'meta_mensal', case when _gestor or m.user_id = _eu then m.meta_mensal end)
                  order by case m.papel when 'admin' then 0 when 'gerente' then 1 else 2 end, m.nome), '[]'::jsonb)
                 from public.produto_membros m where m.conta_id = _conta.id and m.estado <> 'removido'),
    'avisos_novos', (select count(*) from public.crm_avisos a where a.conta_id = _conta.id and a.para = _eu and a.lido_em is null),
    -- Busca cancelada so nao conta se foi cancelada antes de a maquina comecar.
    'maquina_no_mes', (select count(*) from public.leads_buscas b
                        where b.conta_id = _conta.id and (b.situacao <> 'cancelada' or b.pego_em is not null)
                          and (b.created_at at time zone 'America/Sao_Paulo') >= _mes),
    'assinatura', case when _admin then (
        select jsonb_build_object('estado', a.estado, 'valor_mensal', a.valor_mensal, 'proximo_vencimento', a.proximo_vencimento,
                                  'cartao_final', a.cartao_final, 'cartao_bandeira', a.cartao_bandeira, 'itens', a.itens,
                                  'troca_agendada', a.troca_agendada,
                                  'checkout_link', case when a.estado = 'aguardando' and a.checkout_expira > now() then a.checkout_link end)
          from public.produto_assinaturas a where a.conta_id = _conta.id) end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. O que cada plano diz que entrega, com o que esta rodada trouxe
-- ---------------------------------------------------------------------------
update public.produto_planos set
  resumo = 'O CRM completo para organizar a venda.',
  recursos = '["Painel com funil, vendas do mês e ranking", "Funil de vendas com arrastar e soltar", "Campos do seu ramo em cada negócio", "Agenda, lembretes e metas", "Automações prontas e rodízio de leads", "Link de captação com rastreamento", "Máquina de leads: 5 buscas por mês"]'::jsonb
where id = 'starter';

update public.produto_planos set
  resumo = 'Para a equipe com gerente, que prospecta todo dia.',
  recursos = '["Tudo do Starter", "Gerentes com equipe: cada vendedor vê só os próprios negócios", "Repasse de contatos entre vendedores", "Máquina de leads: 30 buscas por mês, com Google Maps", "Campanhas e custo por cliente", "Pixel e API de Conversões da Meta", "E-mail profissional incluído na mensalidade"]'::jsonb
where id = 'pro';
