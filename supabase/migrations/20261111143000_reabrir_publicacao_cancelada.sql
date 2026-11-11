-- 11/11/2026: post cancelado voltava a ser agendável e batia em
-- editorial_publications_post_account_key. A UNIQUE (post_id, external_account_id)
-- vale também para a linha cancelada, e o save não a enxergava.
--
-- O que muda, e só isto (o resto da função continua o que já está no banco):
-- · save_editorial_post_unlocked e save_approved_editorial_post_unlocked,
--   antes do INSERT: se não há publicação carregada, reaproveita a linha
--   cancelled/planned do mesmo post e da mesma conta (FOR UPDATE), em vez de
--   inserir outra. O caminho pelo id também aceita a cancelada.
-- · No caminho aprovado, a reabertura marca
--   editorial_publication_internal.included_in_approval_snapshot e grava
--   publication_reopened.
-- · transition reopen aceita arte aprovada e publicável
--   (editorial_file_is_publishable_media), não só arquivo editável.
--
-- Não mexe na UNIQUE, nem em GRANT/REVOKE das funções que já existiam.

CREATE OR REPLACE FUNCTION pg_temp.trocar_funcao(assinatura regprocedure, alvo text, novo text, rotulo text)
RETURNS void
LANGUAGE plpgsql
AS $troca$
DECLARE
  definicao text;
  saida text;
  vezes integer;
BEGIN
  definicao := pg_get_functiondef(assinatura);
  vezes := (length(definicao) - length(replace(definicao, alvo, ''))) / length(alvo);
  IF vezes <> 1 THEN
    RAISE EXCEPTION '%: trecho encontrado % vez(es); nada foi alterado', rotulo, vezes;
  END IF;
  saida := replace(definicao, alvo, novo);
  EXECUTE saida;
END
$troca$;

SELECT pg_temp.trocar_funcao(
  'public.transition_editorial_publication_unlocked(uuid,text,integer,timestamptz,text,text,text,text,text,timestamptz)'::regprocedure,
  $alvo$IF p_action = 'reopen' AND NOT _internal.included_in_approval_snapshot AND (cardinality(_requested_file_ids) = 0 OR EXISTS (SELECT 1 FROM unnest(_requested_file_ids) AS requested(file_id) WHERE NOT COALESCE(public.file_is_editable(requested.file_id), false))) THEN
    RAISE EXCEPTION 'this cancelled plan was not approved; create a revision';$alvo$,
  $novo$IF p_action = 'reopen' AND NOT _internal.included_in_approval_snapshot AND (cardinality(_requested_file_ids) = 0 OR EXISTS (SELECT 1 FROM unnest(_requested_file_ids) AS requested(file_id) WHERE NOT COALESCE(public.file_is_editable(requested.file_id), false) AND NOT COALESCE(public.editorial_file_is_publishable_media(requested.file_id, _publication.client_id, _publication.project_id), false))) THEN
    RAISE EXCEPTION 'this cancelled plan was not approved; create a revision';$novo$,
  'reopen publicavel'
);

-- Caminho comum: id da cancelada segue para o UPDATE; chave nova reaproveita a linha.
SELECT pg_temp.trocar_funcao(
  'public.save_editorial_post_unlocked(jsonb,integer)'::regprocedure,
  $alvo$        END IF;
        _publication_id := _existing_publication.id;
        _recovered := true;
      ELSE
        _publication_id := gen_random_uuid();$alvo$,
  $novo$        END IF;
        _publication_id := _existing_publication.id;
        _recovered := _existing_publication.status IS DISTINCT FROM 'cancelled';
      ELSE
        _publication_id := gen_random_uuid();$novo$,
  'comum idempotencia cancelada'
);

SELECT pg_temp.trocar_funcao(
  'public.save_editorial_post_unlocked(jsonb,integer)'::regprocedure,
  $alvo$      IF NOT FOUND
        OR _existing_publication.post_id IS DISTINCT FROM _post_id
        OR _existing_publication.status <> 'planned' THEN
        RAISE EXCEPTION 'publication plan is unavailable or immutable';$alvo$,
  $novo$      IF NOT FOUND
        OR _existing_publication.post_id IS DISTINCT FROM _post_id
        OR _existing_publication.status NOT IN ('planned', 'cancelled') THEN
        RAISE EXCEPTION 'publication plan is unavailable or immutable';$novo$,
  'comum id cancelado'
);

SELECT pg_temp.trocar_funcao(
  'public.save_editorial_post_unlocked(jsonb,integer)'::regprocedure,
  $alvo$    IF NOT _recovered AND _existing_publication.id IS NULL THEN
      INSERT INTO public.editorial_publications ($alvo$,
  $novo$    IF NOT _recovered AND _existing_publication.id IS NULL THEN
      SELECT publication.* INTO _existing_publication
      FROM public.editorial_publications AS publication
      WHERE publication.post_id = _post_id
        AND publication.external_account_id = _account.id
        AND publication.status IN ('cancelled', 'planned')
      ORDER BY CASE publication.status WHEN 'planned' THEN 0 ELSE 1 END, publication.id
      LIMIT 1
      FOR UPDATE OF publication;
      IF FOUND THEN
        _publication_id := _existing_publication.id;
      END IF;
    END IF;

    IF NOT _recovered AND _existing_publication.id IS NULL THEN
      INSERT INTO public.editorial_publications ($novo$,
  'comum reaproveita cancelada'
);

-- Caminho aprovado: a mesma reabertura, com selo e evento publication_reopened.
SELECT pg_temp.trocar_funcao(
  'public.save_approved_editorial_post_unlocked(jsonb,integer)'::regprocedure,
  $alvo$        IF _existing_publication.status NOT IN ('planned', 'scheduled') THEN
          RAISE EXCEPTION 'publication plan is unavailable or immutable';
        END IF;
        _publication_id := _existing_publication.id;
        _recovered := true;$alvo$,
  $novo$        IF _existing_publication.status = 'cancelled' THEN
          _publication_id := _existing_publication.id;
        ELSIF _existing_publication.status NOT IN ('planned', 'scheduled') THEN
          RAISE EXCEPTION 'publication plan is unavailable or immutable';
        ELSE
          _publication_id := _existing_publication.id;
          _recovered := true;
        END IF;$novo$,
  'aprovado idempotencia cancelada'
);

SELECT pg_temp.trocar_funcao(
  'public.save_approved_editorial_post_unlocked(jsonb,integer)'::regprocedure,
  $alvo$      IF NOT FOUND
        OR _existing_publication.post_id IS DISTINCT FROM _post_id
        OR _existing_publication.status NOT IN ('planned', 'scheduled') THEN
        RAISE EXCEPTION 'publication plan is unavailable or immutable';$alvo$,
  $novo$      IF NOT FOUND
        OR _existing_publication.post_id IS DISTINCT FROM _post_id
        OR _existing_publication.status NOT IN ('planned', 'scheduled', 'cancelled') THEN
        RAISE EXCEPTION 'publication plan is unavailable or immutable';$novo$,
  'aprovado id cancelado'
);

SELECT pg_temp.trocar_funcao(
  'public.save_approved_editorial_post_unlocked(jsonb,integer)'::regprocedure,
  $alvo$    IF NOT _recovered AND _existing_publication.id IS NULL THEN
      INSERT INTO public.editorial_publications ($alvo$,
  $novo$    IF NOT _recovered AND _existing_publication.id IS NULL THEN
      SELECT publication.* INTO _existing_publication
      FROM public.editorial_publications AS publication
      WHERE publication.post_id = _post_id
        AND publication.external_account_id = _account.id
        AND publication.status IN ('cancelled', 'planned')
      ORDER BY CASE publication.status WHEN 'planned' THEN 0 ELSE 1 END, publication.id
      LIMIT 1
      FOR UPDATE OF publication;
      IF FOUND THEN
        _publication_id := _existing_publication.id;
      END IF;
    END IF;

    IF NOT _recovered AND _existing_publication.id IS NULL THEN
      INSERT INTO public.editorial_publications ($novo$,
  'aprovado reaproveita cancelada'
);

SELECT pg_temp.trocar_funcao(
  'public.save_approved_editorial_post_unlocked(jsonb,integer)'::regprocedure,
  $alvo$      UPDATE public.editorial_publication_internal
      SET
        failure_code = NULL,
        failure_reason = NULL,
        updated_by = _actor
      WHERE publication_id = _publication_id;$alvo$,
  $novo$      UPDATE public.editorial_publication_internal
      SET
        failure_code = NULL,
        failure_reason = NULL,
        included_in_approval_snapshot = CASE
          WHEN _existing_publication.status = 'cancelled' THEN true
          ELSE included_in_approval_snapshot
        END,
        updated_by = _actor
      WHERE publication_id = _publication_id;$novo$,
  'aprovado selo da reabertura'
);

SELECT pg_temp.trocar_funcao(
  'public.save_approved_editorial_post_unlocked(jsonb,integer)'::regprocedure,
  $alvo$        _actor,
        'publication_updated',
        _existing_publication.status,$alvo$,
  $novo$        _actor,
        CASE
          WHEN _existing_publication.status = 'cancelled' THEN 'publication_reopened'
          ELSE 'publication_updated'
        END,
        _existing_publication.status,$novo$,
  'aprovado evento reopened'
);
