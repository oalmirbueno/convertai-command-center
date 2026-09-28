-- CE-01 · Metas de seguidores por cliente (frente CE, 28/09/2026)
--
-- O dono: "quando bater a meta, a mensagem reconhece (batemos a meta,
-- parabéns, a próxima é X) e a próxima meta segue o que estiver cadastrado".
-- Não havia onde cadastrar meta de seguidores. Esta tabela guarda os degraus
-- (1.000, 1.500, 2.000...) por cliente. A conta de "batida" e "próxima" é do
-- código (supabase/functions/_shared/metas-de-seguidores.ts) contra
-- social_metrics_weekly; nada de gatilho.
--
-- Idempotente. RLS: equipe lê o que pode acessar (is_staff + can_access_client);
-- o próprio cliente lê as dele; admin e gestor cadastram e arquivam, sempre
-- dentro de can_access_client. Sem DELETE: apagar = arquivar (arquivada_em).
-- Grants mínimos: authenticated SELECT/INSERT/UPDATE; anon nada.

CREATE TABLE IF NOT EXISTS public.social_metas_seguidores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  meta integer NOT NULL CHECK (meta > 0 AND meta < 100000000),
  prazo date,
  nota text CHECK (nota IS NULL OR char_length(nota) <= 300),
  criado_por uuid DEFAULT auth.uid(),
  criado_em timestamptz NOT NULL DEFAULT now(),
  arquivada_em timestamptz,
  arquivada_por uuid
);

COMMENT ON TABLE public.social_metas_seguidores IS
  'Degraus de meta de seguidores por cliente (CE-01). Batida e próxima são calculadas no código contra social_metrics_weekly. Apagar = arquivar.';

-- Um degrau igual só uma vez enquanto ativo.
CREATE UNIQUE INDEX IF NOT EXISTS social_metas_seguidores_ativa_unica
  ON public.social_metas_seguidores (client_id, meta) WHERE arquivada_em IS NULL;
CREATE INDEX IF NOT EXISTS social_metas_seguidores_cliente
  ON public.social_metas_seguidores (client_id) WHERE arquivada_em IS NULL;

ALTER TABLE public.social_metas_seguidores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS social_metas_seguidores_staff_read ON public.social_metas_seguidores;
CREATE POLICY social_metas_seguidores_staff_read ON public.social_metas_seguidores
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) AND public.can_access_client(client_id));

DROP POLICY IF EXISTS social_metas_seguidores_client_read ON public.social_metas_seguidores;
CREATE POLICY social_metas_seguidores_client_read ON public.social_metas_seguidores
  FOR SELECT TO authenticated
  USING (client_id = auth.uid());

DROP POLICY IF EXISTS social_metas_seguidores_admin_insert ON public.social_metas_seguidores;
CREATE POLICY social_metas_seguidores_admin_insert ON public.social_metas_seguidores
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role))
    AND public.can_access_client(client_id)
  );

DROP POLICY IF EXISTS social_metas_seguidores_admin_update ON public.social_metas_seguidores;
CREATE POLICY social_metas_seguidores_admin_update ON public.social_metas_seguidores
  FOR UPDATE TO authenticated
  USING (
    (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role))
    AND public.can_access_client(client_id)
  )
  WITH CHECK (
    (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role))
    AND public.can_access_client(client_id)
  );

-- Quem arquiva fica registrado (sem confiar no navegador).
CREATE OR REPLACE FUNCTION public.social_metas_seguidores_arquivar_quem()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.arquivada_em IS NOT NULL AND OLD.arquivada_em IS NULL THEN
    NEW.arquivada_por := auth.uid();
  END IF;
  -- Meta e cliente não mudam depois de criados: degrau novo é linha nova.
  NEW.client_id := OLD.client_id;
  NEW.meta := OLD.meta;
  NEW.criado_por := OLD.criado_por;
  NEW.criado_em := OLD.criado_em;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS social_metas_seguidores_arquivar_quem_trg ON public.social_metas_seguidores;
CREATE TRIGGER social_metas_seguidores_arquivar_quem_trg
  BEFORE UPDATE ON public.social_metas_seguidores
  FOR EACH ROW EXECUTE FUNCTION public.social_metas_seguidores_arquivar_quem();

REVOKE ALL ON TABLE public.social_metas_seguidores FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.social_metas_seguidores TO authenticated;
GRANT ALL ON TABLE public.social_metas_seguidores TO service_role;
REVOKE ALL ON FUNCTION public.social_metas_seguidores_arquivar_quem() FROM PUBLIC, anon, authenticated;

-- Conferir depois de aplicar:
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.social_metas_seguidores'::regclass;  -- true
--   SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'public.social_metas_seguidores'::regclass ORDER BY 1;
--     -- 4 políticas: admin_insert (a), admin_update (w), client_read (r), staff_read (r); nenhuma de DELETE
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name = 'social_metas_seguidores' ORDER BY 1, 2;  -- anon ausente; authenticated SELECT/INSERT/UPDATE
