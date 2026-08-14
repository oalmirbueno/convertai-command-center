-- Regra da casa aplicada ao motor editorial: material DISPONIBILIZADO ao
-- cliente (visibility = client_shared) dispensa a aprovacao do cliente e ja
-- vale como aprovado para agendar e publicar.
--
-- Antes, editorial_file_is_publishable so aceitava o fluxo de aprovacao
-- completo (visibility = approval + approval_status = approved). Uma arte
-- disponibilizada ficava travada em estado final e o "Aprovar tudo agora"
-- morria com "terminal file versions are immutable".
--
-- Forward-only e idempotente: apenas CREATE OR REPLACE da funcao, mesma
-- assinatura, permissoes preservadas.

CREATE OR REPLACE FUNCTION public.editorial_file_is_publishable(
  _file_id uuid,
  _client_id uuid,
  _project_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.files AS file_row
    WHERE file_row.id = _file_id
      AND file_row.parent_file_id IS NULL
      AND file_row.client_id = _client_id
      AND file_row.project_id = _project_id
      AND file_row.archived_at IS NULL
      AND COALESCE(file_row.status, 'ready') = 'ready'
      AND file_row.agency_approval_status = 'approved'
      AND file_row.locked_at IS NOT NULL
      AND (
        (file_row.visibility = 'approval' AND file_row.approval_status = 'approved')
        OR file_row.visibility = 'client_shared'
      )
  )
$$;

-- Mesmo perfil de permissao do original: uso apenas interno (SECURITY DEFINER
-- das funcoes editoriais), ninguem chama direto.
REVOKE ALL ON FUNCTION public.editorial_file_is_publishable(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
