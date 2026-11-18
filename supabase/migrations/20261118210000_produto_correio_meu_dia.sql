-- Correio: tarefas e compromissos do dia (18/11/2026, pedido do dono).
--
-- "Ter uma área de to do list onde consegue organizar o dia e a agenda do dia, além do e-mail."
--
-- Cada pessoa da empresa tem as próprias tarefas e os próprios compromissos dentro do correio. Uma
-- tarefa ou um compromisso pode nascer de um e-mail (caixa_id + mensagem_ref guardam de onde veio).
-- Isto funciona sem provedor de e-mail contratado: é dado do painel. Só acréscimo, idempotente.

create table if not exists public.produto_correio_tarefas (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.produto_contas(id) on delete cascade,
  membro_id uuid not null references public.produto_membros(id) on delete cascade,
  titulo text not null check (length(btrim(titulo)) between 1 and 200),
  origem text check (origem is null or length(origem) <= 200),
  caixa_id uuid references public.produto_email_caixas(id) on delete set null,
  mensagem_ref text check (mensagem_ref is null or length(mensagem_ref) <= 300),
  prazo date,
  feita_em timestamptz,
  criado_em timestamptz not null default now()
);
create index if not exists produto_correio_tarefas_do_membro on public.produto_correio_tarefas (membro_id, feita_em, prazo);

create table if not exists public.produto_correio_compromissos (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.produto_contas(id) on delete cascade,
  membro_id uuid not null references public.produto_membros(id) on delete cascade,
  titulo text not null check (length(btrim(titulo)) between 1 and 200),
  detalhe text check (detalhe is null or length(detalhe) <= 300),
  inicio timestamptz not null,
  fim timestamptz check (fim is null or fim > inicio),
  caixa_id uuid references public.produto_email_caixas(id) on delete set null,
  mensagem_ref text check (mensagem_ref is null or length(mensagem_ref) <= 300),
  criado_em timestamptz not null default now()
);
create index if not exists produto_correio_compromissos_do_membro on public.produto_correio_compromissos (membro_id, inicio);

-- A pessoa é este membro, ativo, numa empresa com o e-mail liberado? É a regra das duas tabelas.
create or replace function public.produto_correio_sou(_membro uuid, _conta uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.produto_membros m
     where m.id = _membro and m.conta_id = _conta and m.user_id = auth.uid() and m.estado = 'ativo'
  ) and public.produto_email_liberado(_conta)
$$;

revoke all on function public.produto_correio_sou(uuid, uuid) from public, anon;
grant execute on function public.produto_correio_sou(uuid, uuid) to authenticated, service_role;

-- Quem sou eu no correio: o membro e a empresa da pessoa logada (a tela usa para criar tarefa e compromisso).
create or replace function public.produto_correio_eu()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select (
    select jsonb_build_object('membro_id', m.id, 'conta_id', m.conta_id, 'nome', m.nome)
      from public.produto_membros m
     where m.user_id = auth.uid() and m.estado = 'ativo'
     limit 1
  )
$$;

revoke all on function public.produto_correio_eu() from public, anon;
grant execute on function public.produto_correio_eu() to authenticated;

do $$
declare _t text;
begin
  foreach _t in array array['produto_correio_tarefas', 'produto_correio_compromissos'] loop
    execute format('alter table public.%I enable row level security', _t);
    execute format('revoke all on public.%I from anon', _t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', _t);
    -- Cada pessoa mexe só no que é dela. Nem o master nem a casa leem as tarefas dos outros.
    execute format('drop policy if exists "correio da propria pessoa" on public.%I', _t);
    execute format($p$create policy "correio da propria pessoa" on public.%I
      for all to authenticated
      using (public.produto_correio_sou(membro_id, conta_id))
      with check (public.produto_correio_sou(membro_id, conta_id))$p$, _t);
  end loop;
end;
$$;
