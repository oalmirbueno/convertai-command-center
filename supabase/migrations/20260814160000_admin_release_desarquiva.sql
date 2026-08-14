-- Poder total do admin: se o dono mandou liberar ao cliente, vai. Arquivo
-- arquivado e DESARQUIVADO na hora e a liberacao segue na mesma transacao.

CREATE OR REPLACE FUNCTION public.admin_release_file_now(
  p_file_id uuid,
  p_mode text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  _file public.files%ROWTYPE;
  _actor uuid := auth.uid();
BEGIN
  IF _actor IS NULL
    OR NOT (
      public.has_role(_actor, 'admin'::public.app_role)
      OR public.has_role(_actor, 'manager'::public.app_role)
    ) THEN
    RAISE EXCEPTION 'somente admin ou manager pode liberar ao cliente';
  END IF;
  IF p_mode NOT IN ('client_shared', 'approval') THEN
    RAISE EXCEPTION 'modo de liberacao invalido';
  END IF;

  SELECT * INTO _file
  FROM public.files
  WHERE id = p_file_id AND parent_file_id IS NULL
  FOR UPDATE;
  IF NOT FOUND OR NOT public.can_access_client(_file.client_id) THEN
    RAISE EXCEPTION 'arquivo nao encontrado ou sem acesso';
  END IF;
  IF COALESCE(_file.storage_path, _file.file_url) IS NULL THEN
    RAISE EXCEPTION 'o upload deste arquivo ainda nao concluiu; tente de novo em instantes';
  END IF;

  -- Admin mandou: arquivado desarquiva e segue (a funcao roda como dono do
  -- banco, entao a escrita e confiavel para as travas de imutabilidade).
  IF _file.archived_at IS NOT NULL THEN
    UPDATE public.files SET archived_at = NULL WHERE id = p_file_id;
    _file.archived_at := NULL;
  END IF;

  IF _file.visibility <> 'internal' THEN
    -- Ja liberado antes: nada a fazer, sem erro na cara do usuario.
    RETURN;
  END IF;

  IF _file.agency_approval_status = 'not_requested' THEN
    PERFORM public.request_file_agency_review(p_file_id);
  END IF;

  SELECT * INTO _file FROM public.files WHERE id = p_file_id;
  IF _file.agency_approval_status <> 'approved' THEN
    PERFORM public.review_file_agency(p_file_id, 'approved', NULL);
  END IF;

  SELECT * INTO _file FROM public.files WHERE id = p_file_id;
  IF _file.agency_approval_status <> 'approved' THEN
    RAISE EXCEPTION 'a revisao interna nao concluiu (estado atual: %). Me avise com este texto.',
      _file.agency_approval_status;
  END IF;

  PERFORM public.release_file_to_client(p_file_id, p_mode);
END
$function$;

REVOKE ALL ON FUNCTION public.admin_release_file_now(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_release_file_now(uuid, text) TO authenticated;
