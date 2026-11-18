-- 11/11/2026 (PR #126, rodada 4, ajuste da revisão cruzada): fecha os dois
-- caminhos que ainda soltavam a conta cancelada de propósito.
--
-- 1) Troca de conta numa publicação existente. A trava da 150000 só rodava
--    quando a publicação nascia. O save aceita o id de uma publicação do
--    post com outra conta (UPDATE ... external_account_id = _account.id).
--    Ex.: A tem o Instagram cancelado; B nasce sem publicação; C ganha o
--    Facebook; um save de C manda o id do Facebook com a conta Instagram.
--    A UNIQUE (post_id, external_account_id) não pega: C não tem Instagram.
--    Agora, nos dois saves (comum e aprovado), quando a conta muda, a conta
--    de DESTINO passa pela mesma trava, antes da troca.
-- 2) Cadeia longa. A busca parava no nível 64 e, sem linha achada, dizia
--    "não trava". Agora percorre a cadeia de revision_of_post_id com
--    detecção de ciclo (o caminho percorrido vai junto). Há um teto de
--    segurança (256 níveis); se a busca bater no teto sem decidir a conta,
--    ela conta como ainda travada (falha fechada): só admin/gestor com a
--    marca reabre.
--
-- Migration nova e aditiva: a 150000 não muda. Rodar de novo não muda nada
-- (cada troca confere se já foi aplicada).

-- Busca com teto explícito: o teste exercita o teto sem criar 256 posts.
CREATE OR REPLACE FUNCTION public.editorial_conta_cancelada_na_cadeia(
  p_post_id uuid,
  p_revision_of_post_id uuid,
  p_external_account_id uuid,
  p_max_nivel integer
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
  WITH RECURSIVE cadeia(post_id, nivel, caminho) AS (
    SELECT inicio.post_id, inicio.nivel, inicio.caminho
    FROM (VALUES
      (p_post_id, 0, array_remove(ARRAY[p_post_id], NULL)),
      (p_revision_of_post_id, 1, array_remove(ARRAY[p_post_id, p_revision_of_post_id], NULL))
    ) AS inicio(post_id, nivel, caminho)
    WHERE inicio.post_id IS NOT NULL
    UNION
    SELECT internal.revision_of_post_id, cadeia.nivel + 1, cadeia.caminho || internal.revision_of_post_id
    FROM cadeia
    JOIN public.editorial_post_internal AS internal
      ON internal.post_id = cadeia.post_id
    WHERE internal.revision_of_post_id IS NOT NULL
      -- Ciclo: o post já está no caminho, a cadeia acabou.
      AND NOT (internal.revision_of_post_id = ANY(cadeia.caminho))
      AND cadeia.nivel < GREATEST(COALESCE(p_max_nivel, 0), 1)
  ),
  -- Parou no teto e ainda havia post anterior fora do caminho.
  incompleta AS (
    SELECT EXISTS (
      SELECT 1
      FROM cadeia
      JOIN public.editorial_post_internal AS internal
        ON internal.post_id = cadeia.post_id
      WHERE cadeia.nivel >= GREATEST(COALESCE(p_max_nivel, 0), 1)
        AND internal.revision_of_post_id IS NOT NULL
        AND NOT (internal.revision_of_post_id = ANY(cadeia.caminho))
    ) AS valor
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
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM mais_nova) THEN (
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
    )
    -- Nenhuma linha da conta na cadeia: só não trava se a busca foi completa.
    ELSE (SELECT incompleta.valor FROM incompleta)
  END
$fn$;

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
  SELECT public.editorial_conta_cancelada_na_cadeia(
    p_post_id,
    p_revision_of_post_id,
    p_external_account_id,
    256
  )
$fn$;

REVOKE ALL ON FUNCTION public.editorial_conta_cancelada_na_cadeia(uuid, uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.editorial_conta_cancelada_por_pessoa(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

DO $mig$
DECLARE
  _def text;
  _funcao text;
  _alvo_troca text := $a$    ELSIF NOT _recovered THEN
      UPDATE public.editorial_publications
      SET
        external_account_id = _account.id,$a$;
  _nova_troca text := $b$    ELSIF NOT _recovered THEN
      -- Rodada 4 (troca de conta): a conta de destino passa pela mesma
      -- trava da criação, antes da troca.
      IF _existing_publication.external_account_id IS DISTINCT FROM _account.id
        AND public.editorial_conta_cancelada_por_pessoa(_post_id, _revision_of_post_id, _account.id)
        AND (
          COALESCE(_plan->>'reabrir_cancelada', '') IS DISTINCT FROM 'true'
          OR NOT public.editorial_can_publish_client(_client_id)
        ) THEN
        RAISE EXCEPTION 'cancelled publication stays cancelled until an admin or manager reopens it';
      END IF;
      UPDATE public.editorial_publications
      SET
        external_account_id = _account.id,$b$;
BEGIN
  FOREACH _funcao IN ARRAY ARRAY[
    'public.save_editorial_post_unlocked(jsonb,integer)',
    'public.save_approved_editorial_post_unlocked(jsonb,integer)'
  ] LOOP
    _def := replace(pg_get_functiondef(_funcao::regprocedure), E'\r\n', E'\n');
    -- Pré-requisito: a trava da 150000 já está no corpo.
    IF position('editorial_conta_cancelada_por_pessoa(_post_id, _revision_of_post_id, _account.id)' IN _def) = 0 THEN
      RAISE EXCEPTION '%: trava da 150000 nao encontrada', _funcao;
    END IF;
    IF position(_nova_troca IN _def) > 0 THEN
      CONTINUE;
    END IF;
    IF (length(_def) - length(replace(_def, _alvo_troca, ''))) / length(_alvo_troca) <> 1 THEN
      RAISE EXCEPTION '%: atualizacao da publicacao nao encontrada uma vez', _funcao;
    END IF;
    EXECUTE replace(_def, _alvo_troca, _nova_troca);
  END LOOP;
END
$mig$;
