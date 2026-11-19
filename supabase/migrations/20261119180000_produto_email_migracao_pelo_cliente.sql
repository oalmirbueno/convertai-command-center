-- Migração do e-mail feita pelo próprio cliente (19/11/2026, pedido do dono).
--
-- Depois de pagar, quem administra a empresa abre "Trazer seus e-mails antigos", escolhe onde o e-mail
-- está hoje, digita o e-mail e a senha de lá e a senha da caixa nova. A função produto-migracao confere
-- as duas senhas, guarda a de lá no Vault e cria o trabalho. Uma rotina (pg_cron, a cada minuto) chama a
-- função, que copia um pouco por vez (o provedor antigo é só lido) e anota o andamento aqui.
--
--   produto_email_migracoes         o trabalho de cada caixa: de onde, quanto já foi, em que pé está
--   produto_email_migracao_vistos   as mensagens já copiadas (chave do Message-ID): rodar de novo não duplica
--
-- A senha de lá mora no Vault (produto_email_migracao_<id>) e sai de lá quando a cópia termina.
-- Tudo é acréscimo e idempotente.

create table if not exists public.produto_email_migracoes (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.produto_contas(id) on delete cascade,
  caixa_id uuid not null references public.produto_email_caixas(id) on delete cascade,
  provedor_origem text not null default 'outro' check (length(provedor_origem) between 1 and 40),
  origem_host text not null check (origem_host ~ '^[a-z0-9.-]{3,120}$'),
  origem_porta integer not null default 993 check (origem_porta between 1 and 65535),
  origem_usuario text not null check (length(origem_usuario) between 3 and 254),
  estado text not null default 'copiando' check (estado in ('copiando', 'concluida', 'erro', 'pausada', 'cancelada')),
  total integer not null default 0,
  copiadas integer not null default 0,
  puladas integer not null default 0,
  erros integer not null default 0,
  pastas jsonb not null default '{}'::jsonb check (jsonb_typeof(pastas) = 'object' and pg_column_size(pastas) < 60000),
  mensagem text,
  tentativas integer not null default 0,
  proxima_em timestamptz not null default now(),
  iniciada_por uuid,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  concluida_em timestamptz
);

-- Um trabalho vivo por caixa.
create unique index if not exists produto_email_migracoes_uma_viva
  on public.produto_email_migracoes (caixa_id) where estado in ('copiando', 'pausada', 'erro');
create index if not exists produto_email_migracoes_fila on public.produto_email_migracoes (proxima_em) where estado = 'copiando';

alter table public.produto_email_migracoes enable row level security;
revoke all on public.produto_email_migracoes from anon;
grant select on public.produto_email_migracoes to authenticated;
drop policy if exists "migracao lida pela casa e por quem administra" on public.produto_email_migracoes;
create policy "migracao lida pela casa e por quem administra" on public.produto_email_migracoes
  for select to authenticated using (public.produto_dono() or public.produto_sou_admin_da_conta(conta_id));

create table if not exists public.produto_email_migracao_vistos (
  migracao_id uuid not null references public.produto_email_migracoes(id) on delete cascade,
  chave text not null check (length(chave) between 8 and 64),
  primary key (migracao_id, chave)
);
alter table public.produto_email_migracao_vistos enable row level security;
revoke all on public.produto_email_migracao_vistos from anon, authenticated;

-- A senha do e-mail de lá: só o servidor guarda, lê e apaga.
create or replace function public.produto_email_migracao_senha(_migracao uuid, _acao text, _senha text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  _nome text := 'produto_email_migracao_' || _migracao::text;
  _id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Só as funções do servidor mexem nesta senha.' using errcode = '42501';
  end if;
  select id into _id from vault.secrets where name = _nome;
  if _acao = 'guardar' then
    if nullif(btrim(coalesce(_senha, '')), '') is null then
      raise exception 'Senha vazia.' using errcode = 'P0001';
    end if;
    if _id is null then
      perform vault.create_secret(_senha, _nome, 'Senha do e-mail antigo do cliente, só durante a migração');
    else
      perform vault.update_secret(_id, _senha);
    end if;
    return 'ok';
  elsif _acao = 'ler' then
    return (select s.decrypted_secret from vault.decrypted_secrets s where s.name = _nome limit 1);
  elsif _acao = 'apagar' then
    if _id is not null then
      delete from vault.secrets where id = _id;
    end if;
    return 'ok';
  end if;
  raise exception 'Ação desconhecida.' using errcode = 'P0001';
end;
$$;

revoke all on function public.produto_email_migracao_senha(uuid, text, text) from public, anon, authenticated;
grant execute on function public.produto_email_migracao_senha(uuid, text, text) to service_role;

-- A rotina pega até _limite trabalhos prontos e reserva por 3 minutos (duas rodadas nunca pegam o mesmo).
create or replace function public.produto_email_migracao_pegar(_limite integer default 2)
returns setof public.produto_email_migracoes
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Só a rotina do servidor pega trabalho.' using errcode = '42501';
  end if;
  return query
  update public.produto_email_migracoes m set proxima_em = now() + interval '3 minutes', atualizado_em = now()
   where m.id in (
     select id from public.produto_email_migracoes
      where estado = 'copiando' and proxima_em <= now()
      order by proxima_em limit greatest(1, least(5, coalesce(_limite, 2)))
      for update skip locked)
  returning m.*;
end;
$$;

revoke all on function public.produto_email_migracao_pegar(integer) from public, anon, authenticated;
grant execute on function public.produto_email_migracao_pegar(integer) to service_role;

-- A rotina: a cada minuto, só quando há cópia esperando.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'produto-email-migracao';
    perform cron.schedule('produto-email-migracao', '* * * * *', $cron$
      select net.http_post(
        url := 'https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/produto-migracao',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key'),
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        body := jsonb_build_object('acao', 'trabalhar'),
        timeout_milliseconds := 150000
      )
      where exists (select 1 from public.produto_email_migracoes m where m.estado = 'copiando' and m.proxima_em <= now());
    $cron$);
  end if;
end;
$$;
