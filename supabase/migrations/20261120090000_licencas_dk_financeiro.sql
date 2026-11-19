-- Licenças da plataforma DK Sorteios no Financeiro (19/11/2026). Interno: só admin lê; só o servidor grava.
-- Cada pagamento de licença que cai no Asaas da Aceleriq vira um lançamento de entrada, uma vez só (pelo id do
-- pagamento no Asaas), com bruto, taxa e líquido. Fica fora de public.billing de propósito: lá o cliente lê as
-- linhas com o client_id dele, e o cliente DK não pode saber que esta área existe.
-- Rollback lógico: cron.unschedule('licencas-dk-sync'); drop table public.licencas_dk_pagamentos, public.licencas_dk_ajuste.

create table if not exists public.licencas_dk_ajuste (
  id boolean primary key default true check (id),
  cliente_id uuid references public.profiles(id) on delete set null,
  ultima_sincronizacao timestamptz,
  ultimo_erro text,
  atualizado_em timestamptz not null default now()
);

create table if not exists public.licencas_dk_pagamentos (
  asaas_pagamento_id text primary key check (asaas_pagamento_id ~ '^pay_[A-Za-z0-9_-]{1,100}$'),
  cliente_id uuid references public.profiles(id) on delete set null,
  referencia text not null check (upper(referencia) like 'LIC%'),
  descricao text not null default '',
  forma text not null default 'UNDEFINED',
  situacao text not null check (situacao in ('recebido', 'confirmado', 'estornado')),
  bruto numeric(12, 2) not null check (bruto > 0),
  liquido numeric(12, 2) not null check (liquido >= 0 and liquido <= bruto),
  taxa numeric(12, 2) generated always as (bruto - liquido) stored,
  pago_em date,
  recebido_em date not null,
  criado_no_asaas date,
  sincronizado_em timestamptz not null default now(),
  criado_em timestamptz not null default now()
);

create index if not exists licencas_dk_pagamentos_recebido_em_idx on public.licencas_dk_pagamentos (recebido_em desc);

alter table public.licencas_dk_ajuste enable row level security;
alter table public.licencas_dk_pagamentos enable row level security;

revoke all on public.licencas_dk_ajuste from anon, authenticated;
revoke all on public.licencas_dk_pagamentos from anon, authenticated;
grant select on public.licencas_dk_ajuste to authenticated;
grant select on public.licencas_dk_pagamentos to authenticated;
grant all on public.licencas_dk_ajuste to service_role;
grant all on public.licencas_dk_pagamentos to service_role;

drop policy if exists licencas_dk_ajuste_admin_le on public.licencas_dk_ajuste;
create policy licencas_dk_ajuste_admin_le on public.licencas_dk_ajuste
  for select to authenticated using (public.has_role((select auth.uid()), 'admin'::public.app_role));

drop policy if exists licencas_dk_pagamentos_admin_le on public.licencas_dk_pagamentos;
create policy licencas_dk_pagamentos_admin_le on public.licencas_dk_pagamentos
  for select to authenticated using (public.has_role((select auth.uid()), 'admin'::public.app_role));

-- O vínculo com o cliente DK (Vip DK). Só entra se o cadastro existir neste banco; em outro banco fica vazio.
insert into public.licencas_dk_ajuste (id, cliente_id)
select true, p.id from public.profiles p where p.id = 'eae16e8d-174a-4f4c-9613-4944571f7235'
on conflict (id) do nothing;
insert into public.licencas_dk_ajuste (id) values (true) on conflict (id) do nothing;

-- A rotina: a cada 10 minutos, lê as faturas de licença pagas no Asaas e grava o que for novo ou mudou.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'licencas-dk-sync';
    perform cron.schedule('licencas-dk-sync', '*/10 * * * *', $cron$
      select net.http_post(
        url := 'https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/licencas-dk-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key'),
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        body := jsonb_build_object('acao', 'sincronizar'),
        timeout_milliseconds := 60000
      );
    $cron$);
  end if;
end;
$$;
