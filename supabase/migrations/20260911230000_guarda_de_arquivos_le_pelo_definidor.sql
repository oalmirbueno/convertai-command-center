-- A guarda de arquivos (files_secure_guard) roda com os direitos de quem
-- chama. Ao apagar ou editar, ela lia public.files direto, inclusive
-- agency_approval_status, que o papel authenticated NAO enxerga (a permissao
-- de leitura em files e por coluna, de proposito). Resultado: qualquer
-- exclusao pelo painel caia em "permission denied for table files" e a
-- funcao de borda devolvia 500 ("Edge Function returned a non-2xx").
--
-- Conserto: a leitura do estado da raiz passa por uma funcao definidora
-- pequena, que devolve SO o que a guarda precisa. E a cascata declarada no
-- banco (eventos de aprovacao do arquivo, append-only) deixa de segurar uma
-- exclusao que a propria guarda ja autorizou: a guarda liga um sinal
-- transacional e o gatilho dos eventos respeita esse sinal so no DELETE. A regra em si nao muda:
-- administrador apaga qualquer versao; equipe nao apaga travado nem em
-- revisao; estado de aprovacao so muda pelas funcoes guardadas.

CREATE OR REPLACE FUNCTION public.file_root_state(p_root_id uuid)
RETURNS TABLE (
  root_locked_at timestamptz,
  root_visibility text,
  root_agency_status text,
  root_approval_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT
    root.locked_at,
    root.visibility::text,
    root.agency_approval_status::text,
    root.approval_status::text
  FROM public.files AS root
  WHERE root.id = p_root_id
$$;

REVOKE ALL ON FUNCTION public.file_root_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.file_root_state(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.files_secure_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  _trusted_approval_write boolean :=
    current_user NOT IN ('anon', 'authenticated', 'service_role', 'authenticator');
  _admin_delete boolean :=
    TG_OP = 'DELETE' AND public.has_role(auth.uid(), 'admin'::public.app_role);
  _previous public.files%ROWTYPE;
  _contract public.contracts%ROWTYPE;
  _root_locked boolean;
  _root_visibility text;
  _root_agency_status text;
  _root_approval_status text;
  _root_editable boolean;
BEGIN
  -- Purga de conta (admin_purge_user): a cascata declarada no banco leva
  -- tudo que era do cliente, e esta guarda nao deve segurar a propria purga.
  IF current_setting('app.purge_in_progress', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    IF NEW.project_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.projects AS project
        WHERE project.id = NEW.project_id
          AND project.client_id = NEW.client_id
      ) THEN
      RAISE EXCEPTION 'file project must belong to the same client';
    END IF;
    IF NOT public.file_storage_matches_client(
      NEW.storage_bucket,
      NEW.storage_path,
      NEW.client_id
    ) THEN
      RAISE EXCEPTION 'file storage path must belong to the same client';
    END IF;
    IF NOT public.file_storage_reference_is_canonical(
      NEW.file_url,
      NEW.storage_bucket,
      NEW.storage_path
    ) THEN
      RAISE EXCEPTION 'private file URL must match its storage metadata';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.parent_file_id IS NOT NULL THEN
      SELECT
        file_state.client_id,
        file_state.parent_file_id,
        file_state.locked_at,
        file_state.visibility,
        file_state.agency_approval_status,
        file_state.approval_status,
        file_state.version
      INTO
        _previous.client_id,
        _previous.parent_file_id,
        _previous.locked_at,
        _previous.visibility,
        _previous.agency_approval_status,
        _previous.approval_status,
        _previous.version
      FROM public.file_guard_state(NEW.parent_file_id) AS file_state;

      IF NOT FOUND OR _previous.client_id IS DISTINCT FROM NEW.client_id THEN
        RAISE EXCEPTION 'carousel parent must belong to the same client';
      END IF;
      IF _previous.parent_file_id IS NOT NULL THEN
        RAISE EXCEPTION 'nested carousel children are not allowed';
      END IF;
      IF _previous.locked_at IS NOT NULL
        OR _previous.visibility <> 'internal'
        OR _previous.agency_approval_status <> 'not_requested'
        OR _previous.approval_status <> 'none' THEN
        RAISE EXCEPTION 'carousel children can only be added before review';
      END IF;
      IF NEW.revision_of_file_id IS NOT NULL THEN
        RAISE EXCEPTION 'a revision cannot also be a carousel child';
      END IF;
    END IF;

    IF NEW.revision_of_file_id IS NOT NULL THEN
      SELECT
        file_state.client_id,
        file_state.parent_file_id,
        file_state.locked_at,
        file_state.visibility,
        file_state.agency_approval_status,
        file_state.approval_status,
        file_state.version
      INTO
        _previous.client_id,
        _previous.parent_file_id,
        _previous.locked_at,
        _previous.visibility,
        _previous.agency_approval_status,
        _previous.approval_status,
        _previous.version
      FROM public.file_guard_state(NEW.revision_of_file_id) AS file_state;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'revision source not found';
      END IF;
      IF _previous.parent_file_id IS NOT NULL THEN
        RAISE EXCEPTION 'revision source must be a root file';
      END IF;
      IF _previous.client_id IS DISTINCT FROM NEW.client_id THEN
        RAISE EXCEPTION 'revision source belongs to another client';
      END IF;
      IF (
        _previous.approval_status <> 'rejected'
        AND _previous.agency_approval_status <> 'rejected'
      )
        OR _previous.locked_at IS NULL THEN
        RAISE EXCEPTION 'only a terminal rejected version can be revised';
      END IF;

      NEW.version := COALESCE(_previous.version, 1) + 1;
    ELSE
      NEW.version := COALESCE(NEW.version, 1);
    END IF;

    IF NEW.source = 'contract-public' THEN
      IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'contract-public inserts require the trusted signing backend';
      END IF;

      SELECT contract.* INTO _contract
      FROM public.contracts AS contract
      WHERE contract.client_id = NEW.client_id
        AND contract.status = 'completed'
        AND contract.client_signed_at IS NOT NULL
        AND contract.file_id IS NULL
        AND contract.original_file_name = NEW.file_name
        AND (
          (
            NEW.storage_path IS NOT NULL
            AND public.files_reference_matches(
              contract.original_file_url,
              NEW.storage_path
            )
          )
          OR (
            NEW.storage_path IS NULL
            AND contract.original_file_url = NEW.file_url
          )
        )
      ORDER BY contract.client_signed_at DESC
      LIMIT 1
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'signed contract not found or already registered';
      END IF;

      NEW.project_id := _contract.project_id;
      NEW.uploaded_by := COALESCE(_contract.created_by, _contract.client_id);
      NEW.file_name := _contract.original_file_name;
      NEW.file_url := CASE
        WHEN NEW.storage_path IS NOT NULL THEN 'files://' || NEW.storage_path
        ELSE _contract.original_file_url
      END;
      NEW.file_type := 'application/pdf';
      NEW.folder := 'contratos';
      NEW.description := format(
        'Contrato assinado por %s em %s',
        COALESCE(_contract.client_signature_name, 'cliente'),
        _contract.client_signed_at
      );
      NEW.parent_file_id := NULL;
      NEW.revision_of_file_id := NULL;
      NEW.version := COALESCE(NEW.version, 1);
      NEW.agency_approval_status := 'approved';
      NEW.agency_feedback := NULL;
      NEW.agency_reviewed_by :=
        COALESCE(_contract.created_by, _contract.client_id);
      NEW.agency_reviewed_at := _contract.client_signed_at;
      NEW.approval_status := 'approved';
      NEW.feedback := NULL;
      NEW.client_decided_by := _contract.client_id;
      NEW.client_decided_at := _contract.client_signed_at;
      NEW.approval_requested_at := _contract.client_signed_at;
      NEW.locked_at := _contract.client_signed_at;
      NEW.visibility := 'client_shared';
      NEW.requires_approval := false;
      NEW.source := 'contract-public';
      NEW.status := 'ready';
      NEW.storage_bucket := CASE
        WHEN NEW.storage_path IS NOT NULL THEN 'files'
        ELSE NULL
      END;
      RETURN NEW;
    END IF;

    NEW.agency_approval_status := 'not_requested';
    NEW.agency_feedback := NULL;
    NEW.agency_reviewed_by := NULL;
    NEW.agency_reviewed_at := NULL;
    NEW.approval_status := 'none';
    NEW.feedback := NULL;
    NEW.client_decided_by := NULL;
    NEW.client_decided_at := NULL;
    NEW.approval_requested_at := NULL;
    NEW.locked_at := NULL;
    NEW.visibility := 'internal';
    NEW.requires_approval := false;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT
      COALESCE(root_state.root_locked_at, OLD.locked_at) IS NOT NULL,
      root_state.root_visibility,
      root_state.root_agency_status,
      root_state.root_approval_status
    INTO
      _root_locked,
      _root_visibility,
      _root_agency_status,
      _root_approval_status
    FROM public.file_root_state(COALESCE(OLD.parent_file_id, OLD.id)) AS root_state;

    -- Administrador apaga qualquer versao; o mesmo vale para a limpeza
    -- confiavel que roda por dentro do banco (cascata ao apagar um cliente).
    -- Quem nao e administrador continua sem apagar versao travada ou em revisao.
    IF _trusted_approval_write OR _admin_delete THEN
      -- Exclusao autorizada: a cascata (eventos de aprovacao) pode seguir.
      PERFORM set_config('app.file_delete_in_progress', 'on', true);
      RETURN OLD;
    END IF;
    IF COALESCE(_root_locked, false) THEN
      RAISE EXCEPTION 'terminal file versions are immutable';
    END IF;
    _root_editable :=
      _root_visibility = 'internal'
      AND _root_agency_status = 'not_requested'
      AND _root_approval_status = 'none';
    IF NOT COALESCE(_root_editable, false) THEN
      RAISE EXCEPTION 'file versions under review or released are immutable';
    END IF;
    PERFORM set_config('app.file_delete_in_progress', 'on', true);
    RETURN OLD;
  END IF;

  SELECT
      COALESCE(root_state.root_locked_at, OLD.locked_at) IS NOT NULL,
      root_state.root_visibility,
      root_state.root_agency_status,
      root_state.root_approval_status
    INTO
      _root_locked,
      _root_visibility,
      _root_agency_status,
      _root_approval_status
    FROM public.file_root_state(COALESCE(OLD.parent_file_id, OLD.id)) AS root_state;

  IF COALESCE(_root_locked, false)
    AND NOT _trusted_approval_write THEN
    RAISE EXCEPTION 'terminal file versions are immutable';
  END IF;
  _root_editable :=
    _root_visibility = 'internal'
    AND _root_agency_status = 'not_requested'
    AND _root_approval_status = 'none';
  IF NOT _trusted_approval_write
    AND NOT COALESCE(_root_editable, false) THEN
    RAISE EXCEPTION 'file versions under review or released are immutable';
  END IF;

  IF NOT _trusted_approval_write AND (
    NEW.agency_approval_status IS DISTINCT FROM OLD.agency_approval_status
    OR NEW.agency_feedback IS DISTINCT FROM OLD.agency_feedback
    OR NEW.agency_reviewed_by IS DISTINCT FROM OLD.agency_reviewed_by
    OR NEW.agency_reviewed_at IS DISTINCT FROM OLD.agency_reviewed_at
    OR NEW.approval_status IS DISTINCT FROM OLD.approval_status
    OR NEW.feedback IS DISTINCT FROM OLD.feedback
    OR NEW.client_decided_by IS DISTINCT FROM OLD.client_decided_by
    OR NEW.client_decided_at IS DISTINCT FROM OLD.client_decided_at
    OR NEW.approval_requested_at IS DISTINCT FROM OLD.approval_requested_at
    OR NEW.visibility IS DISTINCT FROM OLD.visibility
    OR NEW.requires_approval IS DISTINCT FROM OLD.requires_approval
    OR NEW.locked_at IS DISTINCT FROM OLD.locked_at
    OR NEW.revision_of_file_id IS DISTINCT FROM OLD.revision_of_file_id
    OR NEW.version IS DISTINCT FROM OLD.version
  ) THEN
    RAISE EXCEPTION 'approval state can only change through guarded functions';
  END IF;

  RETURN NEW;
END
$function$;

-- Eventos de aprovacao continuam append-only; a unica excecao nova e a
-- cascata de uma exclusao de arquivo que a guarda de files autorizou.
CREATE OR REPLACE FUNCTION public.file_approval_events_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  -- Purga de conta (admin_purge_user): a cascata declarada no banco leva
  -- tudo que era do cliente, e esta guarda nao deve segurar a propria purga.
  IF current_setting('app.purge_in_progress', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE'
    AND current_setting('app.file_delete_in_progress', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'file approval events are append-only';
END
$function$;
