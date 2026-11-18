-- Espaco do CRM (13/11/2026): as paginas da empresa, no estilo de um caderno compartilhado (playbook de
-- vendas, roteiros, treinamento, atas). Cada pagina pode ter paginas dentro dela.
--
-- Quem ve o que:
--   visivel_para = 'todos'     todo mundo da empresa le;
--   visivel_para = 'gestores'  so admin e gerente leem (e quem criou);
--   visivel_para = 'eu'        so quem criou le.
-- Quem escreve: qualquer pessoa da empresa cria; edita quem criou ou um gestor (nas paginas que ele ve).
-- O conta_id nasce da empresa de quem esta logado e nunca muda. Limite de 500 paginas por empresa.
--
-- Reaplicavel: pode rodar de novo sem erro.

create table if not exists public.crm_paginas (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null default public.crm_conta_atual() references public.produto_contas(id) on delete cascade,
  pai_id uuid references public.crm_paginas(id) on delete cascade,
  titulo text not null default '' check (length(titulo) <= 160),
  icone text check (icone is null or length(icone) <= 16),
  -- O documento do editor (TipTap). Teto de 400 mil bytes: cabe um playbook longo, nao cabe um arquivo colado.
  conteudo jsonb not null default '{}'::jsonb
    check (jsonb_typeof(conteudo) = 'object' and octet_length(conteudo::text) <= 400000),
  visivel_para text not null default 'todos' check (visivel_para in ('todos', 'gestores', 'eu')),
  ordem integer not null default 0,
  -- Sobe a cada gravacao: a tela grava dizendo qual versao leu, e nao passa por cima do que outra pessoa salvou.
  versao integer not null default 1,
  criado_por uuid default auth.uid() references auth.users(id) on delete set null,
  atualizado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  arquivada_em timestamptz,
  check (pai_id is null or pai_id <> id)
);

create index if not exists crm_paginas_conta_idx on public.crm_paginas (conta_id, pai_id, ordem);
create index if not exists crm_paginas_pai_idx on public.crm_paginas (pai_id) where pai_id is not null;
create index if not exists crm_paginas_autor_idx on public.crm_paginas (criado_por) where criado_por is not null;

-- ---------------------------------------------------------------------------
-- Guarda da pagina: autor, limite por empresa, pai da mesma empresa, sem volta em circulo
-- ---------------------------------------------------------------------------
-- Roda como dono do banco de proposito: precisa contar as paginas da empresa inteira e olhar o pai mesmo
-- quando quem esta logado nao enxerga todas. Nao devolve nada alem do proprio registro.
create or replace function public.crm_paginas_guarda()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _eu uuid := auth.uid();
  _conta_do_pai uuid;
  _subindo uuid;
  _passos integer := 0;
  _total integer;
begin
  if tg_op = 'INSERT' then
    -- Pela tela, o autor e sempre quem esta logado (o servidor, sem login, pode informar).
    if _eu is not null then
      new.criado_por := _eu;
      new.atualizado_por := _eu;
    end if;
    new.versao := 1;
    new.criado_em := now();
    new.atualizado_em := now();

    -- Uma empresa por vez na contagem: duas criacoes juntas nao furam o limite.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('crm_paginas:' || new.conta_id::text));
    select count(*) into _total from public.crm_paginas p where p.conta_id = new.conta_id;
    if _total >= 500 then
      raise exception 'A empresa chegou ao limite de 500 páginas. Exclua páginas arquivadas para abrir espaço.' using errcode = '23514';
    end if;
  else
    new.conta_id := old.conta_id;
    new.criado_por := old.criado_por;
    new.criado_em := old.criado_em;
    new.versao := old.versao + 1;
    new.atualizado_em := now();
    if _eu is not null then
      new.atualizado_por := _eu;
    end if;
  end if;

  if new.pai_id is not null and (tg_op = 'INSERT' or new.pai_id is distinct from old.pai_id) then
    if new.pai_id = new.id then
      raise exception 'Uma página não pode ficar dentro dela mesma.' using errcode = '23514';
    end if;
    select p.conta_id into _conta_do_pai from public.crm_paginas p where p.id = new.pai_id;
    if _conta_do_pai is null or _conta_do_pai <> new.conta_id then
      raise exception 'A página de cima precisa ser da mesma empresa.' using errcode = '23514';
    end if;
    -- Sobe pelos pais: se encontrar a propria pagina, seria um circulo. No maximo 10 niveis.
    _subindo := new.pai_id;
    while _subindo is not null loop
      _passos := _passos + 1;
      if _subindo = new.id then
        raise exception 'Uma página não pode ficar dentro de uma página que está dentro dela.' using errcode = '23514';
      end if;
      if _passos > 10 then
        raise exception 'São no máximo 10 níveis de páginas, uma dentro da outra.' using errcode = '23514';
      end if;
      select p.pai_id into _subindo from public.crm_paginas p where p.id = _subindo;
    end loop;
  end if;

  return new;
end;
$$;

revoke all on function public.crm_paginas_guarda() from public, anon, authenticated;

drop trigger if exists crm_paginas_guarda_trg on public.crm_paginas;
create trigger crm_paginas_guarda_trg
  before insert or update on public.crm_paginas
  for each row execute function public.crm_paginas_guarda();

-- O conta_id gravado e o que vale (a mesma trava das outras tabelas crm_*).
drop trigger if exists crm_paginas_conta_fixa on public.crm_paginas;
create trigger crm_paginas_conta_fixa
  before update on public.crm_paginas
  for each row execute function public.crm_conta_nao_muda();

-- ---------------------------------------------------------------------------
-- Acesso
-- ---------------------------------------------------------------------------
alter table public.crm_paginas enable row level security;

revoke all on public.crm_paginas from public, anon;
grant select, insert, update, delete on public.crm_paginas to authenticated;
grant all on public.crm_paginas to service_role;

drop policy if exists "paginas: ler" on public.crm_paginas;
create policy "paginas: ler" on public.crm_paginas
  for select to authenticated
  using (
    conta_id = (select public.crm_conta_atual())
    and (
      visivel_para = 'todos'
      or criado_por = (select auth.uid())
      or (visivel_para = 'gestores' and (select public.crm_sou_gestor()))
    )
  );

-- Qualquer pessoa da empresa cria. Pagina "so gestores" quem cria e gestor.
drop policy if exists "paginas: criar" on public.crm_paginas;
create policy "paginas: criar" on public.crm_paginas
  for insert to authenticated
  with check (
    conta_id = (select public.crm_conta_atual())
    and criado_por = (select auth.uid())
    and (visivel_para <> 'gestores' or (select public.crm_sou_gestor()))
  );

-- Edita quem criou, ou um gestor nas paginas que ele ve. O gestor nao transforma pagina dos outros em
-- "so eu" (ela sumiria para ele e ficaria so do autor sem o autor pedir).
drop policy if exists "paginas: editar" on public.crm_paginas;
create policy "paginas: editar" on public.crm_paginas
  for update to authenticated
  using (
    conta_id = (select public.crm_conta_atual())
    and (
      criado_por = (select auth.uid())
      or (visivel_para <> 'eu' and (select public.crm_sou_gestor()))
    )
  )
  with check (
    conta_id = (select public.crm_conta_atual())
    and (
      (criado_por = (select auth.uid()) and (visivel_para <> 'gestores' or (select public.crm_sou_gestor())))
      or (visivel_para <> 'eu' and (select public.crm_sou_gestor()))
    )
  );

-- Excluir de vez (a tela arquiva primeiro): as mesmas pessoas que editam.
drop policy if exists "paginas: excluir" on public.crm_paginas;
create policy "paginas: excluir" on public.crm_paginas
  for delete to authenticated
  using (
    conta_id = (select public.crm_conta_atual())
    and (
      criado_por = (select auth.uid())
      or (visivel_para <> 'eu' and (select public.crm_sou_gestor()))
    )
  );
