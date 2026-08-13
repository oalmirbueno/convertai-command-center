-- ============================================================================
-- Aceleriq OS - aprovação dada fora do painel (grupo, WhatsApp, ligação)
-- ============================================================================
--
-- O problema real: nem todo cliente entra no painel para aprovar. Ele responde
-- "pode publicar" no grupo e pronto. Só que o sistema continuava esperando o
-- clique dele, o material ficava travado e a publicação agendada não saía.
--
-- Esta função dá uma via oficial para a equipe registrar essa aprovação, sem
-- afrouxar nada da segurança:
--   - só equipe com acesso àquele cliente pode registrar;
--   - as mesmas travas da aprovação normal continuam valendo (o material tem
--     que estar aprovado internamente e realmente aguardando o cliente);
--   - o registro guarda QUEM registrou e POR ONDE veio o aceite, então o
--     histórico nunca finge que o cliente clicou no painel.
--
-- Só existe o caminho de APROVAÇÃO. Recusa com pedido de ajuste continua
-- exigindo o cliente, porque ali o texto do feedback é dele e não nosso.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_offline_client_approval(
  p_file_id uuid,
  p_expected_version integer,
  p_channel text,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _file public.files%ROWTYPE;
  _actor uuid := auth.uid();
  _channel text := NULLIF(btrim(p_channel), '');
  _note text := NULLIF(btrim(p_note), '');
BEGIN
  IF _channel IS NULL
    OR _channel NOT IN ('grupo', 'whatsapp', 'ligacao', 'presencial', 'email') THEN
    RAISE EXCEPTION 'invalid approval channel';
  END IF;

  SELECT * INTO _file
  FROM public.files
  WHERE id = p_file_id
    AND parent_file_id IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'file not found';
  END IF;

  -- Só equipe, e só de cliente que ela realmente atende.
  IF _actor IS NULL
    OR NOT public.is_staff(_actor)
    OR NOT public.can_access_client(_file.client_id) THEN
    RAISE EXCEPTION 'offline approval access denied';
  END IF;

  IF p_expected_version IS NULL
    OR COALESCE(_file.version, 1) <> p_expected_version THEN
    RAISE EXCEPTION 'file version changed; refresh before deciding';
  END IF;

  -- Exatamente as mesmas condições da aprovação feita pelo cliente.
  IF _file.agency_approval_status <> 'approved'
    OR _file.visibility <> 'approval'
    OR _file.approval_status <> 'pending'
    OR _file.locked_at IS NOT NULL
    OR _file.archived_at IS NOT NULL
    OR COALESCE(_file.status, 'ready') <> 'ready' THEN
    RAISE EXCEPTION 'file is not awaiting a client decision';
  END IF;

  UPDATE public.files
  SET
    approval_status = 'none',
    client_decided_by = NULL,
    client_decided_at = NULL,
    locked_at = now()
  WHERE parent_file_id = p_file_id;

  -- A decisão é do cliente (ele aprovou, só que por fora), por isso o registro
  -- fica no nome dele. Quem registrou aparece no evento logo abaixo.
  UPDATE public.files
  SET
    approval_status = 'approved',
    feedback = NULL,
    client_decided_by = _file.client_id,
    client_decided_at = now(),
    locked_at = now()
  WHERE id = p_file_id;

  INSERT INTO public.file_approval_events (
    file_id,
    client_id,
    actor_id,
    event_type,
    from_status,
    to_status,
    feedback,
    metadata
  ) VALUES (
    _file.id,
    _file.client_id,
    _actor,
    'client_approved_offline',
    _file.approval_status,
    'approved',
    _note,
    jsonb_build_object(
      'version', p_expected_version,
      'channel', _channel,
      'registered_by_staff', true
    )
  );

  RETURN _file.id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_offline_client_approval(uuid, integer, text, text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.record_offline_client_approval(uuid, integer, text, text)
  TO authenticated;
