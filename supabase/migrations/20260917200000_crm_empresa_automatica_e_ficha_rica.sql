-- CRM: a empresa escrita no lead vira ficha sozinha, e a ficha fica rica.
--
-- O que estava quebrado (2026-09-17): dez prospects cadastrados com "Empresa"
-- preenchida e a aba Empresas vazia. O campo company do lead era texto solto;
-- a ficha em commercial_organizations so existia se alguem a criasse a mao em
-- outra tela. Resultado: 12 leads com empresa, 0 fichas.
--
-- 1) Gatilho: lead com company e sem organization_id acha a ficha pelo nome
--    (sem diferenciar maiusculas) ou cria, e se liga a ela. Vale para a tela,
--    para o MCP e para a importacao do diagnostico: a regra mora no banco.
-- 2) Pessoa: quando o lead tem nome de gente (diferente do nome da empresa) e
--    e-mail ou WhatsApp, vira contato da empresa e o lead se liga a ele.
-- 3) Ficha rica: instagram, telefone, endereco, CNPJ e porte como campos
--    proprios, para o contexto nao morar em "Notas".
-- 4) Preenche as fichas dos leads que ja existem.

ALTER TABLE public.commercial_organizations
  ADD COLUMN IF NOT EXISTS instagram text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS cnpj text,
  ADD COLUMN IF NOT EXISTS size text;

COMMENT ON COLUMN public.commercial_organizations.size IS 'Porte em texto livre: numero de unidades, funcionarios, faturamento estimado.';

CREATE OR REPLACE FUNCTION public.commercial_lead_liga_empresa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _empresa text := NULLIF(btrim(COALESCE(NEW.company, '')), '');
  _pessoa text := NULLIF(btrim(COALESCE(NEW.name, '')), '');
  _org uuid;
  _contato uuid;
BEGIN
  IF NEW.organization_id IS NULL AND _empresa IS NOT NULL THEN
    SELECT o.id INTO _org FROM public.commercial_organizations o
     WHERE lower(btrim(o.name)) = lower(_empresa) AND o.archived_at IS NULL
     ORDER BY o.created_at LIMIT 1;
    IF _org IS NULL THEN
      INSERT INTO public.commercial_organizations (name, owner_id, created_by)
      VALUES (left(_empresa, 160), NEW.owner_id, COALESCE(NEW.created_by, auth.uid()))
      RETURNING id INTO _org;
    END IF;
    NEW.organization_id := _org;
  END IF;

  -- Pessoa de verdade (nao o nome da empresa repetido) com algum meio de contato.
  IF NEW.contact_id IS NULL AND NEW.organization_id IS NOT NULL AND _pessoa IS NOT NULL
     AND lower(_pessoa) IS DISTINCT FROM lower(COALESCE(_empresa, ''))
     AND (NULLIF(btrim(COALESCE(NEW.email, '')), '') IS NOT NULL OR NULLIF(btrim(COALESCE(NEW.whatsapp, '')), '') IS NOT NULL) THEN
    SELECT c.id INTO _contato FROM public.commercial_contacts c
     WHERE c.organization_id = NEW.organization_id AND c.archived_at IS NULL
       AND (lower(btrim(c.name)) = lower(_pessoa)
            OR (NEW.email IS NOT NULL AND lower(btrim(COALESCE(c.email, ''))) = lower(btrim(NEW.email))))
     ORDER BY c.created_at LIMIT 1;
    IF _contato IS NULL THEN
      INSERT INTO public.commercial_contacts (organization_id, name, email, whatsapp, is_primary, created_by)
      VALUES (
        NEW.organization_id, left(_pessoa, 160), NULLIF(btrim(COALESCE(NEW.email, '')), ''), NULLIF(btrim(COALESCE(NEW.whatsapp, '')), ''),
        NOT EXISTS (SELECT 1 FROM public.commercial_contacts x WHERE x.organization_id = NEW.organization_id AND x.archived_at IS NULL),
        COALESCE(NEW.created_by, auth.uid())
      ) RETURNING id INTO _contato;
    END IF;
    NEW.contact_id := _contato;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS commercial_lead_liga_empresa_trg ON public.commercial_leads;
CREATE TRIGGER commercial_lead_liga_empresa_trg
  BEFORE INSERT OR UPDATE OF company, organization_id, name, email, whatsapp ON public.commercial_leads
  FOR EACH ROW EXECUTE FUNCTION public.commercial_lead_liga_empresa();

-- Os leads que ja existem ganham ficha agora (o gatilho roda no UPDATE OF company).
UPDATE public.commercial_leads
   SET company = company
 WHERE organization_id IS NULL AND NULLIF(btrim(COALESCE(company, '')), '') IS NOT NULL;
