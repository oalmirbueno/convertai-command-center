-- Decisao de produto do dono: o CLIENTE ve o cronograma COMPLETO da agenda
-- dele - backlog, em producao, pronto, agendado e publicado. Antes so via
-- post "ready" com arte aprovada e o calendario parecia vazio/zerado mesmo
-- com semanas de trabalho planejado.
--
-- O que continua protegido: dados internos (editorial_post_internal e
-- publication_internal tem RLS propria), arquivos nao liberados
-- (can_client_read_file) e clientes de outros donos.

CREATE OR REPLACE FUNCTION public.editorial_client_can_read_post(
  _post_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.editorial_posts AS post
    WHERE post.id = _post_id
      AND post.archived_at IS NULL
      AND auth.uid() = post.client_id
      AND public.has_role(auth.uid(), 'client'::public.app_role)
  )
$$;

CREATE OR REPLACE FUNCTION public.editorial_client_can_read_publication(
  _publication_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.editorial_publications AS publication
    JOIN public.editorial_posts AS post
      ON post.id = publication.post_id
    WHERE publication.id = _publication_id
      AND publication.status <> 'cancelled'
      AND post.archived_at IS NULL
      AND auth.uid() = publication.client_id
      AND public.has_role(auth.uid(), 'client'::public.app_role)
  )
$$;

REVOKE ALL ON FUNCTION public.editorial_client_can_read_post(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.editorial_client_can_read_publication(uuid)
  FROM PUBLIC, anon;
