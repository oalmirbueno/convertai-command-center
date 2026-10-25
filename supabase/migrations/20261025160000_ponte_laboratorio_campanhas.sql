-- Ponte Laboratório ↔ Campanhas (25/10/2026). Contrato: docs/laboratorio/PONTE-CAMPANHAS.md.
-- Pedido do dono: "o laboratório do canvas sincronize com a área campanhas: lê e vê o funil e tudo e já puxa
-- pra campanha com base naquilo e já monta; e vice-versa, gerou a campanha também gera e aparece no canvas; e
-- atualizações e movimento de ambos os lados já atualiza as duas frentes, e já puxam completo e entendem a
-- lógica, sempre melhorando e complementando e nunca substituindo".
-- Só amplia e é idempotente.
--
-- 1) lab_projetos.campanha_id (um projeto por campanha) e mesa_campanhas.sincronia (estado da ponte).
-- 2) ponte_sugestoes: quando os dois lados têm valores diferentes, nada é trocado; a diferença vira sugestão
--    para a equipe confirmar (nas duas telas).
-- 3) ponte_lab_campanha_avisar(): gatilhos em mesa_campanhas, calendario_propostas (da campanha) e lab_projetos
--    (ligado) chamam a função ponte-lab-campanha na hora (pg_net, com segredo no Vault). A ponte é idempotente
--    (só escreve quando algo muda), então o eco de uma escrita da própria ponte termina sem laço.
--    Campanha nova também avisa: a ponte cria o canvas dela.
-- 4) Tempo real: lab_projetos, mesa_campanhas e calendario_propostas na publicação supabase_realtime (as telas
--    escutam a linha aberta e se atualizam).

-- ---------------------------------------------------------------------------
-- 1. A ligação
-- ---------------------------------------------------------------------------
alter table public.lab_projetos add column if not exists campanha_id uuid references public.mesa_campanhas(id) on delete set null;
create unique index if not exists lab_projetos_uma_por_campanha on public.lab_projetos (campanha_id) where campanha_id is not null;

alter table public.mesa_campanhas add column if not exists sincronia jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- 2. Sugestões da ponte (diferença entre os lados)
-- ---------------------------------------------------------------------------
create table if not exists public.ponte_sugestoes (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references public.mesa_campanhas(id) on delete cascade,
  projeto_id uuid references public.lab_projetos(id) on delete cascade,
  -- Para onde a sugestão iria: 'campanha' (o canvas sugere) ou 'canvas' (a campanha sugere).
  destino text not null check (destino in ('campanha', 'canvas')),
  -- O que muda: briefing.oferta, briefing.publico, peca:c3.tema, no:<id>.dados.titulo...
  chave text not null check (length(chave) between 1 and 160),
  rotulo text not null,
  valor_atual jsonb,
  valor_sugerido jsonb not null,
  situacao text not null default 'aberta' check (situacao in ('aberta', 'aceita', 'recusada', 'superada')),
  decidida_por uuid,
  decidida_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ponte_sugestoes_uma_aberta
  on public.ponte_sugestoes (campanha_id, destino, chave) where situacao = 'aberta';
create index if not exists ponte_sugestoes_por_campanha on public.ponte_sugestoes (campanha_id, situacao, created_at desc);

alter table public.ponte_sugestoes enable row level security;
drop policy if exists "equipe le sugestoes da ponte" on public.ponte_sugestoes;
create policy "equipe le sugestoes da ponte" on public.ponte_sugestoes
  for select to authenticated
  using (public.is_staff((select auth.uid())) and exists (select 1 from public.mesa_campanhas c where c.id = campanha_id and public.can_access_client(c.client_id)));
grant select on public.ponte_sugestoes to authenticated;
-- Escrita só pela função (service_role): aceitar aplica a mudança no lado de destino.

-- ---------------------------------------------------------------------------
-- 3. Aviso do banco para a ponte
-- ---------------------------------------------------------------------------
create table if not exists public.ponte_config (
  id boolean primary key default true check (id),
  ligada boolean not null default true,
  url text not null
);

insert into public.ponte_config (id, url)
values (true, 'https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/ponte-lab-campanha')
on conflict (id) do nothing;

alter table public.ponte_config enable row level security;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'ponte_lab_campanha_segredo') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'ponte_lab_campanha_segredo', 'Aviso do banco para a ponte Laboratório e Campanhas');
  end if;
end;
$$;

-- A função confere o segredo do aviso (só service_role lê).
create or replace function public.ponte_lab_campanha_segredo()
returns text
language sql
security definer
set search_path = public
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'ponte_lab_campanha_segredo' limit 1;
$$;

revoke all on function public.ponte_lab_campanha_segredo() from public, anon, authenticated;
grant execute on function public.ponte_lab_campanha_segredo() to service_role;

create or replace function public.ponte_lab_campanha_avisar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _url text;
  _campanha uuid;
  _lado text;
begin
  if tg_table_name = 'mesa_campanhas' then
    _campanha := new.id;
    _lado := 'campanha';
    -- Só a coluna da própria ponte mudou: nada a avisar (evita eco).
    if tg_op = 'UPDATE' and (to_jsonb(new) - 'sincronia' - 'atualizado_em') = (to_jsonb(old) - 'sincronia' - 'atualizado_em') then
      return new;
    end if;
  elsif tg_table_name = 'calendario_propostas' then
    select c.id into _campanha from public.mesa_campanhas c where c.proposta_id = new.id limit 1;
    _lado := 'campanha';
    if tg_op = 'UPDATE' and new.itens is not distinct from old.itens then
      return new;
    end if;
  elsif tg_table_name = 'lab_projetos' then
    _campanha := new.campanha_id;
    _lado := 'canvas';
    if tg_op = 'UPDATE' and new.canvas is not distinct from old.canvas and new.campanha_id is not distinct from old.campanha_id then
      return new;
    end if;
  end if;
  if _campanha is null then
    return new;
  end if;
  select url into _url from public.ponte_config where id and ligada;
  if _url is null then
    return new;
  end if;
  begin
    perform net.http_post(
      url := _url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-ponte-segredo', (select decrypted_secret from vault.decrypted_secrets where name = 'ponte_lab_campanha_segredo' limit 1)
      ),
      body := jsonb_build_object('acao', 'aviso', 'campanha_id', _campanha, 'lado', _lado, 'novo', tg_op = 'INSERT' and tg_table_name = 'mesa_campanhas'),
      timeout_milliseconds := 10000
    );
  exception when others then
    -- O aviso é ajuda: abrir qualquer uma das telas também sincroniza.
    null;
  end;
  return new;
end;
$$;

drop trigger if exists ponte_avisar_campanha on public.mesa_campanhas;
create trigger ponte_avisar_campanha
  after insert or update on public.mesa_campanhas
  for each row execute function public.ponte_lab_campanha_avisar();

drop trigger if exists ponte_avisar_proposta on public.calendario_propostas;
create trigger ponte_avisar_proposta
  after update of itens on public.calendario_propostas
  for each row execute function public.ponte_lab_campanha_avisar();

drop trigger if exists ponte_avisar_projeto on public.lab_projetos;
create trigger ponte_avisar_projeto
  after update of canvas, campanha_id on public.lab_projetos
  for each row execute function public.ponte_lab_campanha_avisar();

-- ---------------------------------------------------------------------------
-- 4. Tempo real
-- ---------------------------------------------------------------------------
do $$
declare
  _t text;
begin
  foreach _t in array array['lab_projetos', 'mesa_campanhas', 'calendario_propostas', 'ponte_sugestoes'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = _t) then
      execute format('alter publication supabase_realtime add table public.%I', _t);
    end if;
  end loop;
end;
$$;

-- Conferência depois de aplicar (todas true):
-- select exists (select 1 from information_schema.columns where table_name = 'lab_projetos' and column_name = 'campanha_id'),
--   to_regclass('public.ponte_sugestoes') is not null,
--   exists (select 1 from vault.secrets where name = 'ponte_lab_campanha_segredo'),
--   (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('lab_projetos', 'mesa_campanhas', 'calendario_propostas', 'ponte_sugestoes')) = 4;
