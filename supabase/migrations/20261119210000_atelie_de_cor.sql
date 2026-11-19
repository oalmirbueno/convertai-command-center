-- Ateliê de Cor (19/11/2026): projetos de paleta (briefing, as propostas do
-- motor, a escolhida e os textos da IA). Só a equipe; com cliente, só quem tem
-- acesso a ele. Idempotente (o banco recebe pelo MCP ou pelo SQL Editor).

CREATE TABLE IF NOT EXISTS public.atelie_cor_projetos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  titulo text NOT NULL DEFAULT 'Paleta',
  modo text NOT NULL DEFAULT 'zero' CHECK (modo IN ('cliente', 'briefing', 'zero', 'nicho', 'manual')),
  briefing jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(briefing) = 'object'),
  propostas jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(propostas) = 'array'),
  escolhida text,
  textos jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(textos) = 'object'),
  favorita boolean NOT NULL DEFAULT false,
  aplicada_em timestamptz,
  criado_por uuid DEFAULT auth.uid(),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS atelie_cor_projetos_cliente_idx ON public.atelie_cor_projetos (client_id, atualizado_em DESC);
CREATE INDEX IF NOT EXISTS atelie_cor_projetos_recentes_idx ON public.atelie_cor_projetos (atualizado_em DESC);

CREATE OR REPLACE FUNCTION public.atelie_cor_tocar() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS atelie_cor_projetos_tocar ON public.atelie_cor_projetos;
CREATE TRIGGER atelie_cor_projetos_tocar BEFORE UPDATE ON public.atelie_cor_projetos
FOR EACH ROW EXECUTE FUNCTION public.atelie_cor_tocar();

ALTER TABLE public.atelie_cor_projetos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS atelie_cor_le ON public.atelie_cor_projetos;
CREATE POLICY atelie_cor_le ON public.atelie_cor_projetos FOR SELECT TO authenticated
USING (public.is_staff((select auth.uid())) AND (client_id IS NULL OR public.can_access_client(client_id)));

DROP POLICY IF EXISTS atelie_cor_insere ON public.atelie_cor_projetos;
CREATE POLICY atelie_cor_insere ON public.atelie_cor_projetos FOR INSERT TO authenticated
WITH CHECK (public.is_staff((select auth.uid())) AND (client_id IS NULL OR public.can_access_client(client_id)));

DROP POLICY IF EXISTS atelie_cor_altera ON public.atelie_cor_projetos;
CREATE POLICY atelie_cor_altera ON public.atelie_cor_projetos FOR UPDATE TO authenticated
USING (public.is_staff((select auth.uid())) AND (client_id IS NULL OR public.can_access_client(client_id)))
WITH CHECK (public.is_staff((select auth.uid())) AND (client_id IS NULL OR public.can_access_client(client_id)));

DROP POLICY IF EXISTS atelie_cor_apaga ON public.atelie_cor_projetos;
CREATE POLICY atelie_cor_apaga ON public.atelie_cor_projetos FOR DELETE TO authenticated
USING (public.is_staff((select auth.uid())) AND (client_id IS NULL OR public.can_access_client(client_id)));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.atelie_cor_projetos TO authenticated;
