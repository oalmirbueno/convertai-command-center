-- 11/11/2026 (PR #126, rodada 4): a trava da publicação cancelada conta só
-- o cancelamento feito por pessoa e vale para a cadeia de revisões inteira.
--
-- B1: antes de nascer a revisão, o Estúdio salva o post anterior com
--     publications: [] e o save cancela as planejadas com o motivo
--     removed_from_plan (já era assim no main). Isso não é cancelamento de
--     pessoa: a revisão normal volta a criar a publicação na mesma conta.
--     Conta como pessoa o último publication_cancelled da linha cujo
--     metadata.reason NÃO é removed_from_plan nem
--     removed_from_approved_media_plan (cancelar pela Agenda, arquivar o
--     post...). Linha cancelada sem evento conta como pessoa (lado seguro).
-- B2: A (cancelada de propósito) → B (nasce sem publicação) → C. A trava
--     sobe a cadeia de revision_of_post_id. Em cada conta decide o post mais
--     novo da cadeia que tem linha nessa conta: se a pessoa reabriu num post
--     do meio, a limpeza seguinte não volta a travar.
-- B3: o save aprovado normalizava as publicações sem reabrir_cancelada e a
--     marca do admin sumia antes da trava. A marca agora segue (só quando é
--     true: sem ela a impressão digital do payload fica igual).
--
-- Migration nova e aditiva: a 143000 pode já ter rodado em banco de dev ou
-- Preview. Os trechos trocados são os que a 143000 escreveu. Rodar de novo
-- não muda nada: cada troca confere se já foi aplicada.

CREATE OR REPLACE FUNCTION public.editorial_conta_cancelada_por_pessoa(
  p_post_id uuid,
  p_revision_of_post_id uuid,
  p_external_account_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
  WITH RECURSIVE cadeia(post_id, nivel) AS (
    SELECT inicio.post_id, inicio.nivel
    FROM (VALUES (p_post_id, 0), (p_revision_of_post_id, 1)) AS inicio(post_id, nivel)
    WHERE inicio.post_id IS NOT NULL
    UNION
    SELECT internal.revision_of_post_id, cadeia.nivel + 1
    FROM cadeia
    JOIN public.editorial_post_internal AS internal
      ON internal.post_id = cadeia.post_id
    WHERE internal.revision_of_post_id IS NOT NULL
      AND cadeia.nivel < 64
  ),
  mais_nova AS (
    SELECT publication.id, publication.status
    FROM cadeia
    JOIN public.editorial_publications AS publication
      ON publication.post_id = cadeia.post_id
      AND publication.external_account_id = p_external_account_id
    ORDER BY cadeia.nivel
    LIMIT 1
  )
  SELECT COALESCE((
    SELECT mais_nova.status = 'cancelled'
      AND NOT COALESCE((
        SELECT COALESCE(
          event.metadata->>'reason' IN ('removed_from_plan', 'removed_from_approved_media_plan'),
          false
        )
        FROM public.editorial_events AS event
        WHERE event.publication_id = mais_nova.id
          AND event.event_type = 'publication_cancelled'
        -- Empate de horário (mesma transação): a pessoa vem primeiro.
        ORDER BY event.created_at DESC,
          COALESCE(
            event.metadata->>'reason' IN ('removed_from_plan', 'removed_from_approved_media_plan'),
            false
          )
        LIMIT 1
      ), false)
    FROM mais_nova
  ), false)
$fn$;

REVOKE ALL ON FUNCTION public.editorial_conta_cancelada_por_pessoa(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

DO $mig$
DECLARE
  _def text;
  _novo text;
  _alvo_trava text := $a$    IF NOT _recovered AND _existing_publication.id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.editorial_publications AS cancelled_row
        WHERE cancelled_row.external_account_id = _account.id
          AND cancelled_row.status = 'cancelled'
          AND (
            cancelled_row.post_id = _post_id
            OR (
              _revision_of_post_id IS NOT NULL
              AND cancelled_row.post_id = _revision_of_post_id
            )
          )
      ) THEN
      IF COALESCE(_plan->>'reabrir_cancelada', '') IS DISTINCT FROM 'true'
        OR NOT public.editorial_can_publish_client(_client_id) THEN
        RAISE EXCEPTION 'cancelled publication stays cancelled until an admin or manager reopens it';
      END IF;
      SELECT publication.* INTO _existing_publication$a$;
  _nova_trava text := $b$    IF NOT _recovered AND _existing_publication.id IS NULL THEN
      -- Rodada 4: só cancelamento de pessoa trava, na cadeia de revisões
      -- inteira (editorial_conta_cancelada_por_pessoa). A limpeza da revisão
      -- (removed_from_plan) não conta; a linha do mesmo post é reaproveitada.
      IF public.editorial_conta_cancelada_por_pessoa(_post_id, _revision_of_post_id, _account.id)
        AND (
          COALESCE(_plan->>'reabrir_cancelada', '') IS DISTINCT FROM 'true'
          OR NOT public.editorial_can_publish_client(_client_id)
        ) THEN
        RAISE EXCEPTION 'cancelled publication stays cancelled until an admin or manager reopens it';
      END IF;
      SELECT publication.* INTO _existing_publication$b$;
  _alvo_evento text := $a$          'reabrir_cancelada', CASE WHEN _existing_publication.status = 'cancelled' THEN true ELSE NULL END$a$;
  _novo_evento text := $b$          'reabrir_cancelada', CASE WHEN _existing_publication.status = 'cancelled' AND COALESCE(_plan->>'reabrir_cancelada', '') = 'true' THEN true ELSE NULL END$b$;
  _alvo_marca text := $a$          'idempotency_key',
            NULLIF(source.value->>'idempotency_key', '')
        )
      ) AS plan$a$;
  _nova_marca text := $b$          'idempotency_key',
            NULLIF(source.value->>'idempotency_key', ''),
          -- Rodada 4 (B3): a marca do admin segue até a trava.
          'reabrir_cancelada',
            CASE WHEN source.value->>'reabrir_cancelada' = 'true' THEN true END
        )
      ) AS plan$b$;
BEGIN
  -- 1) Save comum: trava pela cadeia e só por pessoa; evento diz a marca.
  _def := replace(pg_get_functiondef('public.save_editorial_post_unlocked(jsonb,integer)'::regprocedure), E'\r\n', E'\n');
  IF position('editorial_conta_cancelada_por_pessoa' IN _def) = 0 THEN
    IF (length(_def) - length(replace(_def, _alvo_trava, ''))) / length(_alvo_trava) <> 1 THEN
      RAISE EXCEPTION 'comum trava: trecho da 143000 nao encontrado uma vez';
    END IF;
    _def := replace(_def, _alvo_trava, _nova_trava);
  END IF;
  IF position(_alvo_evento IN _def) > 0 THEN
    IF (length(_def) - length(replace(_def, _alvo_evento, ''))) / length(_alvo_evento) <> 1 THEN
      RAISE EXCEPTION 'comum evento: trecho da 143000 repetido';
    END IF;
    _def := replace(_def, _alvo_evento, _novo_evento);
  ELSIF position(_novo_evento IN _def) = 0 THEN
    RAISE EXCEPTION 'comum evento: trecho da 143000 nao encontrado';
  END IF;
  EXECUTE _def;

  -- 2) Save aprovado: a marca segue na normalização e a mesma trava.
  _def := replace(pg_get_functiondef('public.save_approved_editorial_post_unlocked(jsonb,integer)'::regprocedure), E'\r\n', E'\n');
  IF position('editorial_conta_cancelada_por_pessoa' IN _def) = 0 THEN
    IF (length(_def) - length(replace(_def, _alvo_trava, ''))) / length(_alvo_trava) <> 1 THEN
      RAISE EXCEPTION 'aprovado trava: trecho da 143000 nao encontrado uma vez';
    END IF;
    _def := replace(_def, _alvo_trava, _nova_trava);
  END IF;
  IF position(_nova_marca IN _def) = 0 THEN
    IF (length(_def) - length(replace(_def, _alvo_marca, ''))) / length(_alvo_marca) <> 1 THEN
      RAISE EXCEPTION 'aprovado marca: normalizacao nao encontrada uma vez';
    END IF;
    _def := replace(_def, _alvo_marca, _nova_marca);
  END IF;
  EXECUTE _def;
END
$mig$;
