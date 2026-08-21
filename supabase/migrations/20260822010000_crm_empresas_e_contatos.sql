-- O que faltava para ser um CRM, e nao uma lista de leads.
--
-- O funil guardava nome, empresa, e-mail e telefone DENTRO da linha do
-- negocio. Parece detalhe, e e a diferenca entre um CRM e uma planilha:
--
-- 1. A mesma empresa volta. O contrato de site acabou, seis meses depois ela
--    quer social. Com tudo dentro do negocio, e um cadastro novo do zero: o
--    historico de quem ja conversou, o que foi proposto e por que nao fechou
--    daquela vez fica orfao no negocio antigo.
-- 2. Empresa tem mais de uma pessoa. Quem decide, quem paga, quem opera. Um
--    campo de e-mail so obriga a escolher uma e esquecer as outras.
-- 3. A pessoa troca de empresa. O contato continua sendo a mesma pessoa.
--
-- Por isso o desenho de todo CRM que se sustenta e o mesmo: EMPRESA tem
-- CONTATOS, e os NEGOCIOS apontam para os dois. O negocio termina; a empresa
-- e o contato ficam, com a historia inteira.
--
-- E a ponta que liga no painel: a empresa aponta para o cliente cadastrado
-- quando fecha. E o elo que deixa perguntar "quanto essa empresa ja rendeu"
-- juntando funil e financeiro.

create table if not exists public.commercial_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  segment text,
  site text,
  city text,
  notes text,
  -- Preenchido quando a empresa vira cliente do painel. Da lado do cliente
  -- ja existe profiles; aqui fica o lado de quem ainda nao e, e o elo entre
  -- os dois quando passa a ser.
  client_id uuid references public.profiles(id) on delete set null,
  owner_id uuid,
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commercial_organizations_vivas
  on public.commercial_organizations (name) where archived_at is null;

create table if not exists public.commercial_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.commercial_organizations(id) on delete set null,
  name text not null,
  role text,
  email text,
  whatsapp text,
  -- Quem atende primeiro. Sem isto, empresa com quatro contatos nao diz por
  -- onde comecar, e cada pessoa da casa liga para um.
  is_primary boolean not null default false,
  notes text,
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commercial_contacts_por_empresa
  on public.commercial_contacts (organization_id) where archived_at is null;

-- O negocio passa a APONTAR para empresa e contato. As colunas antigas de
-- texto ficam: sao o que existe hoje nos leads ja cadastrados, e apagar
-- dado por causa de refatoracao e o tipo de perda que nao volta.
alter table public.commercial_leads
  add column if not exists organization_id uuid
    references public.commercial_organizations(id) on delete set null,
  add column if not exists contact_id uuid
    references public.commercial_contacts(id) on delete set null;

create index if not exists commercial_leads_por_empresa
  on public.commercial_leads (organization_id) where organization_id is not null;

drop trigger if exists commercial_organizations_updated_at on public.commercial_organizations;
create trigger commercial_organizations_updated_at
  before update on public.commercial_organizations
  for each row execute function public.update_updated_at_column();

drop trigger if exists commercial_contacts_updated_at on public.commercial_contacts;
create trigger commercial_contacts_updated_at
  before update on public.commercial_contacts
  for each row execute function public.update_updated_at_column();

alter table public.commercial_organizations enable row level security;
alter table public.commercial_contacts enable row level security;

drop policy if exists "comercial admin e manager" on public.commercial_organizations;
create policy "comercial admin e manager" on public.commercial_organizations
  for all to authenticated
  using (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or public.has_role(auth.uid(), 'manager'::public.app_role)
  )
  with check (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or public.has_role(auth.uid(), 'manager'::public.app_role)
  );

drop policy if exists "comercial admin e manager" on public.commercial_contacts;
create policy "comercial admin e manager" on public.commercial_contacts
  for all to authenticated
  using (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or public.has_role(auth.uid(), 'manager'::public.app_role)
  )
  with check (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or public.has_role(auth.uid(), 'manager'::public.app_role)
  );

revoke all on public.commercial_organizations from anon;
revoke all on public.commercial_contacts from anon;

-- Os leads que ja existem ganham empresa e contato a partir do que estava
-- escrito neles. Sem isto, o CRM nasceria com duas realidades: os antigos em
-- texto solto e os novos em ficha, e nenhuma tela conseguiria mostrar as
-- duas coisas ao mesmo tempo sem mentir.
DO $migra$
DECLARE
  _lead record;
  _org uuid;
  _contato uuid;
BEGIN
  FOR _lead IN
    SELECT id, name, company, email, whatsapp, created_by
    FROM public.commercial_leads
    WHERE organization_id IS NULL
  LOOP
    IF COALESCE(btrim(_lead.company), '') <> '' THEN
      SELECT org.id INTO _org
      FROM public.commercial_organizations AS org
      WHERE lower(org.name) = lower(btrim(_lead.company))
      LIMIT 1;

      IF _org IS NULL THEN
        INSERT INTO public.commercial_organizations (name, created_by)
        VALUES (btrim(_lead.company), _lead.created_by)
        RETURNING id INTO _org;
      END IF;
    ELSE
      _org := NULL;
    END IF;

    INSERT INTO public.commercial_contacts (
      organization_id, name, email, whatsapp, is_primary, created_by
    )
    VALUES (
      _org,
      COALESCE(NULLIF(btrim(_lead.name), ''), 'Sem nome'),
      _lead.email,
      _lead.whatsapp,
      true,
      _lead.created_by
    )
    RETURNING id INTO _contato;

    UPDATE public.commercial_leads
    SET organization_id = _org, contact_id = _contato
    WHERE id = _lead.id;
  END LOOP;
END
$migra$;
