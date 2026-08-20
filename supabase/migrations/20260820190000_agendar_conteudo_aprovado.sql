-- Agendar conteúdo aprovado: o fluxo de todo dia parou de ser impossível.
--
-- O RELATO: o dono aprovou o material, abriu o card, escolheu conta e
-- horário, tocou em Programar — e recebeu "está em revisão, crie uma
-- revisão". O material estava aprovado; nada estava em revisão.
--
-- TRÊS CAUSAS SE COMPUNHAM:
--
-- 1. O roteador (save_editorial_post) escolhia o caminho aprovado pela HORA
--    da aprovação (client_decided_at <= post.created_at). Quem aprova DEPOIS
--    de criar o conteúdo — o fluxo normal da operação — caía no caminho
--    comum.
--
-- 2. O caminho comum tem um selo de integridade que cobre AS PUBLICAÇÕES.
--    Agendar adiciona uma publicação, o selo muda por definição, e o guarda
--    lia a mudança como adulteração. Agendar conteúdo aprovado pelo caminho
--    comum era estruturalmente impossível.
--
-- 3. Dentro do caminho aprovado havia a mesma suposição de hora: re-aprovar
--    um material adotado (decided_at avança) bloqueava qualquer salvar,
--    mesmo com o selo de copy e de aprovação batendo.
--
-- O QUE MUDA (três CREATE OR REPLACE completos, diffs mínimos e apontados):
--
-- · save_editorial_post: roteia pelo ESTADO (arquivo publicável + snapshot
--   de aprovação existente), não pela hora.
-- · save_editorial_post_unlocked: selo AUSENTE deixa de ser tratado como
--   divergência — o primeiro salvar de um conteúdo aprovado-depois-de-criado
--   ESTABELECE o selo (o UPDATE logo abaixo do guarda já gravava isso; o
--   guarda impedia de chegar lá). Divergência com selo PRESENTE continua
--   bloqueando.
-- · save_approved_editorial_post_unlocked: a checagem por hora sai. As
--   checagens reais ficam — copy idêntica ao material, selo batendo,
--   publicações não terminais.

-- ─────────────────────────── 1. O roteador ────────────────────────────────

CREATE OR REPLACE FUNCTION public.save_editorial_post(p_payload jsonb, p_expected_version integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _client_id uuid;
  _project_id uuid;
  _post_id uuid;
  _primary_file_id uuid;
  _use_approved_path boolean := false;
  _requires_delivery_gate boolean := false;
  _delegate_payload jsonb;
  _result jsonb;
BEGIN
  PERFORM public.editorial_lock_task_sync();

  IF jsonb_typeof(p_payload) = 'object' THEN
    _client_id := NULLIF(p_payload->>'client_id', '')::uuid;
    _project_id := NULLIF(p_payload->>'project_id', '')::uuid;
    _post_id := NULLIF(p_payload->>'id', '')::uuid;
    _primary_file_id := NULLIF(p_payload->>'primary_file_id', '')::uuid;

    IF _primary_file_id IS NOT NULL
      AND public.editorial_file_is_publishable_media(
        _primary_file_id,
        _client_id,
        _project_id
      ) THEN
      IF _post_id IS NULL THEN
        _use_approved_path := true;
      ELSE
        -- MUDANÇA: o snapshot de aprovação existir é o que habilita a
        -- máquina de agendamento aprovado. A comparação antiga
        -- (client_decided_at <= created_at) derrubava para o caminho comum
        -- qualquer conteúdo re-aprovado depois de criado — e o caminho
        -- comum não consegue agendar conteúdo aprovado.
        SELECT EXISTS (
          SELECT 1
          FROM public.editorial_posts AS post
          JOIN public.editorial_post_internal AS internal
            ON internal.post_id = post.id
          WHERE post.id = _post_id
            AND post.client_id = _client_id
            AND post.project_id = _project_id
            AND post.primary_file_id = _primary_file_id
            AND internal.approval_fingerprint IS NOT NULL
        ) INTO _use_approved_path;
      END IF;
    END IF;
  END IF;

  IF jsonb_typeof(COALESCE(p_payload->'publications', '[]'::jsonb)) =
      'array' THEN
    SELECT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        COALESCE(p_payload->'publications', '[]'::jsonb)
      ) AS plan(value)
      WHERE jsonb_typeof(plan.value) = 'object'
        AND (
          plan.value ? 'delivery_mode'
          OR plan.value ? 'asset_file_ids'
        )
    ) INTO _requires_delivery_gate;
  END IF;

  _delegate_payload := CASE
    WHEN _use_approved_path AND _requires_delivery_gate
      THEN social_private.stage_editorial_approved_schedules(p_payload)
    ELSE p_payload
  END;

  IF _use_approved_path THEN
    _result := public.save_approved_editorial_post_unlocked(
      _delegate_payload,
      p_expected_version
    );
  ELSE
    _result := public.save_editorial_post_unlocked(
      _delegate_payload,
      p_expected_version
    );
  END IF;

  IF _use_approved_path AND _requires_delivery_gate THEN
    PERFORM social_private.capture_editorial_asset_snapshots(
      (_result->>'post_id')::uuid,
      p_payload,
      COALESCE((_result->>'recovered')::boolean, false)
    );

    PERFORM social_private.schedule_captured_editorial_publications(
      (_result->>'post_id')::uuid,
      p_payload
    );
  END IF;

  RETURN _result;
END
$function$;

-- ───────────── 2 e 3. Patches mínimos nas duas funções grandes ─────────────
--
-- Formato patch de propósito: a mudança tem 6 linhas por função, e um paste
-- integral de 700 linhas esconderia o diff de quem revisa. A substituição é
-- exata e CONTADA: se um replay futuro encontrar o texto diferente do
-- esperado, a migration falha alto em vez de divergir em silêncio.

DO $patch$
DECLARE
  _fonte text;
  _alvo text;
  _sub text;
BEGIN
  -- save_approved_editorial_post_unlocked: a checagem por HORA sai.
  -- Re-aprovar um material adotado avança client_decided_at e passava a
  -- bloquear qualquer salvar. Copy idêntica e selo de aprovação batendo,
  -- conferidos logo abaixo dela, são a proteção real.
  SELECT pg_get_functiondef(p.oid) INTO _fonte
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'save_approved_editorial_post_unlocked';

  _alvo := E'    IF _primary_file.client_decided_at > _existing_post.created_at THEN\n'
        || E'      RAISE EXCEPTION ''the approved editorial snapshot is immutable; create a revision'';\n'
        || E'    END IF;\n';
  IF (length(_fonte) - length(replace(_fonte, _alvo, ''))) / length(_alvo) <> 1 THEN
    RAISE EXCEPTION 'patch (aprovado): alvo nao encontrado exatamente 1 vez';
  END IF;
  EXECUTE replace(_fonte, _alvo, '');

  -- save_editorial_post_unlocked: selo AUSENTE deixa de ser tratado como
  -- divergência. O conteúdo aprovado depois de criado nunca teve selo; o
  -- primeiro salvar ESTABELECE (o UPDATE logo abaixo do guarda já gravava
  -- isso — o guarda impedia de chegar lá). Divergência com selo PRESENTE
  -- continua bloqueando.
  SELECT pg_get_functiondef(p.oid) INTO _fonte
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'save_editorial_post_unlocked';

  _alvo := E'    AND (\n'
        || E'      _is_new\n'
        || E'      OR _existing_post_internal.approval_fingerprint\n'
        || E'        IS DISTINCT FROM _approval_fingerprint\n'
        || E'    ) THEN\n';
  _sub  := E'    AND (\n'
        || E'      _is_new\n'
        || E'      OR (\n'
        || E'        _existing_post_internal.approval_fingerprint IS NOT NULL\n'
        || E'        AND _existing_post_internal.approval_fingerprint\n'
        || E'          IS DISTINCT FROM _approval_fingerprint\n'
        || E'      )\n'
        || E'    ) THEN\n';
  IF (length(_fonte) - length(replace(_fonte, _alvo, ''))) / length(_alvo) <> 1 THEN
    RAISE EXCEPTION 'patch (comum): alvo nao encontrado exatamente 1 vez';
  END IF;
  EXECUTE replace(_fonte, _alvo, _sub);
END
$patch$;
