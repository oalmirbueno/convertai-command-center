-- ═══════════════════════════════════════════════════════════════════════
-- 27/11/2026 · Agenda, criar publicação, reagendar e publicador respeitam a
-- regra EXATA profiles.modo_aprovacao_do_cliente = 'dispensada'.
--
-- PROPOSTA. Não aplicada. Aplicar só com autorização explícita, backup
-- restaurável e preflight, pelo workflow forward-only.
--
-- O QUE MUDA
--   1) public.editorial_file_client_approval_waived(arquivo, cliente, projeto):
--      predicado novo, só leitura. Verdadeiro SOMENTE para a raiz ativa do
--      próprio cliente/projeto, pronta, aprovada pela agência, sem decisão do
--      cliente (client_decided_at/by NULL), sem trava, cujo cliente está com
--      modo_aprovacao_do_cliente = 'dispensada' (exato) e não apagado, em um
--      de dois estados coerentes:
--        a) interno, o normal da agência: visibility internal, approval_status
--           none, requires_approval false (não pede o cliente);
--        b) liberado: visibility approval, approval_status pending,
--           requires_approval true.
--      Lê o cadastro AO VIVO: revogar a regra fecha o caminho na hora.
--   2) public.editorial_file_is_publishable: o ramo de sempre fica idêntico
--      e ganha um OR com o predicado acima. _media, o save aprovado, a captura
--      das lâminas (imagem única e vídeo: só a raiz), a transição
--      schedule/publish, o autopublish_assert_dispatch e a seleção do tick
--      usam este predicado. Carrossel dispensado segue recusado: _media exige
--      lâminas filhas travadas (não mudou).
--   3) public.editorial_lock_client_approval_waiver: com o arquivo já preso,
--      se o estado do arquivo depende só da regra, prende a linha do cadastro
--      FOR SHARE. A regra não muda no meio da transação que confere e agenda.
--      Chamada no save aprovado e na transição (o worker já usa FOR SHARE).
--   4) save_editorial_post (roteador) e save_approved_editorial_post_unlocked:
--      post pronto que NUNCA teve selo (approval_fingerprint NULL) entra no save
--      canônico só pela dispensa exata, para gravar o PRIMEIRO selo depois de
--      todas as checagens de escopo, versão e texto. Selo presente e
--      divergente segue recusado; portal e qualquer outro valor, iguais.
--      A recusa "sem decisão do cliente e não client_shared" deixa passar só
--      o arquivo dispensado. Patches contados.
--   5) Registro da dispensa em cada publicação: gatilho AFTER grava
--      editorial_events 'client_approval_waived' (append-only, lido só pela
--      equipe) ao nascer, agendar, reagendar, trocar o arquivo ou publicar.
--      Metadados: origem, modo, timestamp, versão, sha256 e estado do arquivo.
--      Não grava aprovação nem decisão.
--   6) transition_editorial_publication_unlocked (patch contado):
--      - cancel: depois de revogada a regra, cancelar a publicação do MESMO
--        arquivo (mesma versão e sha256) que tem evento client_approval_waived
--        nessa publicação deixa de travar em "approval is in progress". Versão
--        e selo canônicos seguem conferidos. Destrava o withdraw (item 7).
--      - publish: a baixa de publicação já enviada (job do autopublish em
--        'done') do mesmo arquivo dispensado não para com a revogação.
--      - schedule, reagendar e o envio seguem fechados depois da revogação.
--   7) withdraw_file_client_approval: arquivo com publicação viva (planned,
--      scheduled ou failed, que pode tentar de novo) pela dispensa não volta a
--      rascunho enquanto ela viver. Arquivo do portal nunca tem esse evento.
--
-- O QUE NÃO MUDA
--   files.*, file_approval_events, decide_file_approval, aprovar_pelo_cliente,
--   release, files_secure_guard, file_is_editable, RLS, Auth, grants, o tick,
--   a fila, o cadastro e os dados existentes. Nenhum UPDATE em arquivo ou
--   cadastro. Portal e qualquer valor diferente de 'dispensada' seguem a
--   política atual.
--
-- IMUTABILIDADE SEM TRAVA
--   Os dois estados já são imutáveis para escrita direta (20260911230000 e
--   20260727132145): files_secure_guard só aceita UPDATE/DELETE não confiável
--   no estado interno editável (internal + not_requested + none),
--   file_is_editable é false e o storage escreve só em arquivo editável. As
--   saídas são as funções guardadas: liberar (continua dispensado), decisão do
--   cliente (aprovou → caminho travado; recusou → fecha o predicado),
--   aprovação offline, arquivamento e withdraw (item 7). Post e publicações
--   seguem presos pela approval_fingerprint; o dispatch confere tudo de novo
--   com a linha do cliente FOR SHARE antes do envio.
--
-- ROLLBACK LÓGICO (bloco comentado no fim): restaura as funções a partir de
--   social_private.autopublish_function_backups, tira o gatilho e os
--   auxiliares. Eventos gravados ficam (histórico append-only).
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 0) preflight ──────────────────────────────────────────────────────
DO $preflight$
DECLARE
  _base text;
  _esperado constant text := $esperado$
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
$esperado$;
BEGIN
  IF to_regprocedure('public.editorial_file_is_publishable(uuid,uuid,uuid)') IS NULL
    OR to_regprocedure('public.editorial_file_is_publishable_media(uuid,uuid,uuid)') IS NULL
    OR to_regprocedure('public.save_editorial_post(jsonb,integer)') IS NULL
    OR to_regprocedure('public.save_approved_editorial_post_unlocked(jsonb,integer)') IS NULL
    OR to_regprocedure('public.transition_editorial_publication_unlocked(uuid,text,integer,timestamptz,text,text,text,text,text,timestamptz)') IS NULL
    OR to_regprocedure('public.withdraw_file_client_approval(uuid)') IS NULL
    OR to_regclass('social_private.autopublish_jobs') IS NULL
    OR to_regprocedure('public.editorial_file_client_approval_waived(uuid,uuid,uuid)') IS NOT NULL
    OR to_regprocedure('public.editorial_lock_client_approval_waiver(uuid,uuid,uuid)') IS NOT NULL
    OR to_regprocedure('public.editorial_publication_waiver_covers_file(uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'preflight: funções editoriais ausentes ou migração já aplicada';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'modo_aprovacao_do_cliente'
  ) OR (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'files'
      AND column_name IN ('requires_approval', 'client_decided_at', 'client_decided_by', 'version', 'sha256')
  ) <> 5 OR (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'social_private' AND table_name = 'autopublish_jobs'
      AND column_name IN ('publication_id', 'stage')
  ) <> 2 THEN
    RAISE EXCEPTION 'preflight: colunas de cadastro, arquivo ou fila ausentes';
  END IF;
  SELECT p.prosrc INTO _base FROM pg_catalog.pg_proc AS p
   WHERE p.oid = 'public.editorial_file_is_publishable(uuid,uuid,uuid)'::regprocedure;
  IF regexp_replace(btrim(_base), '\s+', ' ', 'g') <> regexp_replace(btrim(_esperado), '\s+', ' ', 'g') THEN
    RAISE EXCEPTION 'preflight: editorial_file_is_publishable difere da versão 20260814050000; nada aplicado';
  END IF;
END
$preflight$;

CREATE TABLE IF NOT EXISTS social_private.autopublish_function_backups (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  function_signature text NOT NULL,
  prosrc_md5 text NOT NULL,
  functiondef text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE social_private.autopublish_function_backups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE social_private.autopublish_function_backups FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO social_private.autopublish_function_backups (function_signature, prosrc_md5, functiondef, reason)
SELECT p.oid::regprocedure::text, md5(p.prosrc), pg_catalog.pg_get_functiondef(p.oid),
       '20261127120000 aprovação dispensada: definição antes do patch'
  FROM pg_catalog.pg_proc AS p
 WHERE p.oid IN (
   'public.editorial_file_is_publishable(uuid,uuid,uuid)'::regprocedure,
   'public.save_editorial_post(jsonb,integer)'::regprocedure,
   'public.save_approved_editorial_post_unlocked(jsonb,integer)'::regprocedure,
   'public.transition_editorial_publication_unlocked(uuid,text,integer,timestamptz,text,text,text,text,text,timestamptz)'::regprocedure,
   'public.withdraw_file_client_approval(uuid)'::regprocedure
 );

-- ─── 1) o predicado da dispensa ────────────────────────────────────────
CREATE FUNCTION public.editorial_file_client_approval_waived(
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
    JOIN public.profiles AS client_profile
      ON client_profile.id = file_row.client_id
    WHERE file_row.id = _file_id
      AND file_row.parent_file_id IS NULL
      AND file_row.client_id = _client_id
      AND file_row.project_id = _project_id
      AND file_row.archived_at IS NULL
      AND COALESCE(file_row.status, 'ready') = 'ready'
      AND file_row.agency_approval_status = 'approved'
      AND file_row.client_decided_at IS NULL
      AND file_row.client_decided_by IS NULL
      AND file_row.locked_at IS NULL
      AND (
        -- interno: aprovado pela agência, sem pedir o cliente
        (
          file_row.visibility = 'internal'
          AND file_row.approval_status = 'none'
          AND file_row.requires_approval IS FALSE
        )
        -- liberado: já pedido ao cliente, sem decisão
        OR (
          file_row.visibility = 'approval'
          AND file_row.approval_status = 'pending'
          AND file_row.requires_approval IS TRUE
        )
      )
      AND client_profile.deleted_at IS NULL
      AND client_profile.modo_aprovacao_do_cliente = 'dispensada'
  )
$$;

COMMENT ON FUNCTION public.editorial_file_client_approval_waived(uuid, uuid, uuid) IS
  'Aprovação do cliente dispensada pelo cadastro (profiles.modo_aprovacao_do_cliente = ''dispensada'', exato): raiz do cliente/projeto, pronta, aprovada pela agência, sem decisão nem trava, interna (internal/none/requires_approval false) ou liberada (approval/pending/requires_approval true). Não grava aprovação nem decisão. Lê o cadastro ao vivo.';

REVOKE ALL ON FUNCTION public.editorial_file_client_approval_waived(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ─── 2) o predicado de sempre, com o OR da dispensa ────────────────────
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
  -- 27/11/2026: exceção do cadastro (modo_aprovacao_do_cliente = 'dispensada').
  OR COALESCE(public.editorial_file_client_approval_waived(_file_id, _client_id, _project_id), false)
$$;

REVOKE ALL ON FUNCTION public.editorial_file_is_publishable(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ─── 3) a regra não muda no meio da transação ──────────────────────────
-- Chamar com o arquivo já preso (FOR UPDATE/SHARE). Só prende o cadastro
-- quando o resultado depende dele: raiz aprovada pela agência, sem decisão e
-- sem trava. Ordem: arquivo, depois cadastro (o worker também lê FOR SHARE).
CREATE FUNCTION public.editorial_lock_client_approval_waiver(
  _file_id uuid,
  _client_id uuid,
  _project_id uuid
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.files AS file_row
    WHERE file_row.id = _file_id
      AND file_row.parent_file_id IS NULL
      AND file_row.client_id = _client_id
      AND file_row.project_id = _project_id
      AND file_row.agency_approval_status = 'approved'
      AND file_row.locked_at IS NULL
      AND file_row.client_decided_at IS NULL
      AND file_row.client_decided_by IS NULL
  ) THEN
    PERFORM 1 FROM public.profiles WHERE id = _client_id FOR SHARE;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.editorial_lock_client_approval_waiver(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- O arquivo da publicação é o mesmo que a dispensa registrou nela: evento
-- append-only client_approval_waived na publicação exata, mesmo arquivo,
-- mesma versão e mesmo sha256, ainda sem trava. Não lê a regra do cadastro.
CREATE FUNCTION public.editorial_publication_waiver_covers_file(
  _publication_id uuid,
  _file_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.editorial_publications AS pub
    JOIN public.editorial_events AS waiver_event
      ON waiver_event.publication_id = pub.id
     AND waiver_event.post_id = pub.post_id
     AND waiver_event.client_id = pub.client_id
    JOIN public.files AS file_row
      ON file_row.id = _file_id
    WHERE pub.id = _publication_id
      AND waiver_event.event_type = 'client_approval_waived'
      AND waiver_event.metadata->>'origem' = 'profiles.modo_aprovacao_do_cliente'
      AND waiver_event.metadata->>'modo' = 'dispensada'
      AND waiver_event.metadata->>'file_id' = file_row.id::text
      AND (waiver_event.metadata->>'file_version') IS NOT DISTINCT FROM file_row.version::text
      AND (waiver_event.metadata->>'file_sha256') IS NOT DISTINCT FROM file_row.sha256
      AND file_row.parent_file_id IS NULL
      AND file_row.client_id = pub.client_id
      AND file_row.project_id = pub.project_id
      AND file_row.locked_at IS NULL
  )
$$;

REVOKE ALL ON FUNCTION public.editorial_publication_waiver_covers_file(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ─── 4, 6 e 7) patches contados ────────────────────────────────────────
DO $patch$
DECLARE
  _def text;
  _alvo text;
  _novo text;
BEGIN
  -- 4a) roteador: post pronto sem selo entra no save canônico só pela dispensa.
  _def := replace(pg_get_functiondef('public.save_editorial_post(jsonb,integer)'::regprocedure), E'\r\n', E'\n');
  _alvo := E'            AND post.primary_file_id = _primary_file_id\n'
        || E'            AND internal.approval_fingerprint IS NOT NULL\n'
        || E'        ) INTO _use_approved_path;';
  _novo := E'            AND post.primary_file_id = _primary_file_id\n'
        || E'            AND (\n'
        || E'              internal.approval_fingerprint IS NOT NULL\n'
        || E'              -- 27/11/2026: nunca teve selo; só a dispensa exata grava o primeiro.\n'
        || E'              OR (\n'
        || E'                internal.approval_fingerprint IS NULL\n'
        || E'                AND post.production_status = ''ready''\n'
        || E'                AND post.archived_at IS NULL\n'
        || E'                AND COALESCE(public.editorial_file_client_approval_waived(_primary_file_id, _client_id, _project_id), false)\n'
        || E'              )\n'
        || E'            )\n'
        || E'        ) INTO _use_approved_path;';
  IF (length(_def) - length(replace(_def, _alvo, ''))) / length(_alvo) <> 1 THEN
    RAISE EXCEPTION 'patch roteador: trecho do selo não encontrado exatamente 1 vez; nada aplicado';
  END IF;
  EXECUTE replace(_def, _alvo, _novo);

  -- 4b) save aprovado: prende a regra, aceita o arquivo dispensado e o primeiro selo.
  _def := replace(pg_get_functiondef('public.save_approved_editorial_post_unlocked(jsonb,integer)'::regprocedure), E'\r\n', E'\n');
  _alvo := E'  WHERE file_row.id = _primary_file_id\n'
        || E'  FOR UPDATE;\n'
        || E'\n'
        || E'  IF NOT FOUND\n'
        || E'    OR NOT public.editorial_file_is_publishable_media(\n';
  _novo := E'  WHERE file_row.id = _primary_file_id\n'
        || E'  FOR UPDATE;\n'
        || E'\n'
        || E'  -- 27/11/2026: a regra do cadastro não muda até o fim desta transação.\n'
        || E'  -- O PERFORM troca FOUND; a ausência do arquivo é lida pela própria linha.\n'
        || E'  PERFORM public.editorial_lock_client_approval_waiver(_primary_file_id, _client_id, _project_id);\n'
        || E'\n'
        || E'  IF _primary_file.id IS NULL\n'
        || E'    OR NOT public.editorial_file_is_publishable_media(\n';
  IF (length(_def) - length(replace(_def, _alvo, ''))) / length(_alvo) <> 1 THEN
    RAISE EXCEPTION 'patch save aprovado: trecho do arquivo preso não encontrado exatamente 1 vez; nada aplicado';
  END IF;
  _def := replace(_def, _alvo, _novo);

  _alvo := E'    OR (\n'
        || E'      _primary_file.client_decided_at IS NULL\n'
        || E'      AND _primary_file.visibility <> ''client_shared''\n'
        || E'    ) THEN\n'
        || E'    RAISE EXCEPTION ''approved editorial media is unavailable, unsupported or outside the project'';';
  _novo := E'    OR (\n'
        || E'      _primary_file.client_decided_at IS NULL\n'
        || E'      AND _primary_file.visibility <> ''client_shared''\n'
        || E'      -- 27/11/2026: aprovação do cliente dispensada pelo cadastro (sem decisão gravada).\n'
        || E'      AND NOT public.editorial_file_client_approval_waived(_primary_file_id, _client_id, _project_id)\n'
        || E'    ) THEN\n'
        || E'    RAISE EXCEPTION ''approved editorial media is unavailable, unsupported or outside the project'';';
  IF (length(_def) - length(replace(_def, _alvo, ''))) / length(_alvo) <> 1 THEN
    RAISE EXCEPTION 'patch save aprovado: trecho da decisão do cliente não encontrado exatamente 1 vez; nada aplicado';
  END IF;
  _def := replace(_def, _alvo, _novo);

  _alvo := E'      OR _existing_post.production_status <> ''ready''\n'
        || E'      OR _post_internal.approval_fingerprint IS NULL\n'
        || E'      OR _post_internal.approval_fingerprint IS DISTINCT FROM\n'
        || E'        public.editorial_compute_approval_fingerprint(_post_id) THEN\n';
  _novo := E'      OR _existing_post.production_status <> ''ready''\n'
        || E'      -- 27/11/2026: selo ausente só pela dispensa exata (este save grava o primeiro).\n'
        || E'      OR (\n'
        || E'        _post_internal.approval_fingerprint IS NULL\n'
        || E'        AND NOT public.editorial_file_client_approval_waived(_primary_file_id, _client_id, _project_id)\n'
        || E'      )\n'
        || E'      OR (\n'
        || E'        _post_internal.approval_fingerprint IS NOT NULL\n'
        || E'        AND _post_internal.approval_fingerprint IS DISTINCT FROM\n'
        || E'          public.editorial_compute_approval_fingerprint(_post_id)\n'
        || E'      ) THEN\n';
  IF (length(_def) - length(replace(_def, _alvo, ''))) / length(_alvo) <> 1 THEN
    RAISE EXCEPTION 'patch save aprovado: trecho do selo não encontrado exatamente 1 vez; nada aplicado';
  END IF;
  EXECUTE replace(_def, _alvo, _novo);

  -- 6) transição: regra presa, cancelar destravado e baixa do envio já feito.
  _def := replace(pg_get_functiondef('public.transition_editorial_publication_unlocked(uuid,text,integer,timestamptz,text,text,text,text,text,timestamptz)'::regprocedure), E'\r\n', E'\n');
  _alvo := E'    IF _locked_file_count <> cardinality(_requested_file_ids) THEN RAISE EXCEPTION ''one or more publication files are unavailable''; END IF;\n';
  _novo := _alvo
        || E'    -- 27/11/2026: com os arquivos presos, a regra do cadastro também fica presa.\n'
        || E'    PERFORM public.editorial_lock_client_approval_waiver(requested.file_id, _publication.client_id, _publication.project_id) FROM unnest(_requested_file_ids) AS requested(file_id);\n';
  IF (length(_def) - length(replace(_def, _alvo, ''))) / length(_alvo) <> 1 THEN
    RAISE EXCEPTION 'patch transição: trecho dos arquivos presos não encontrado exatamente 1 vez; nada aplicado';
  END IF;
  _def := replace(_def, _alvo, _novo);

  _alvo := E'WHERE NOT COALESCE(public.file_is_editable(requested.file_id), false) AND NOT public.editorial_file_is_publishable(requested.file_id, _publication.client_id, _publication.project_id)) THEN\n'
        || E'      RAISE EXCEPTION ''cannot cancel a plan while its approval is in progress; create a revision'';';
  _novo := E'WHERE NOT COALESCE(public.file_is_editable(requested.file_id), false) AND NOT public.editorial_file_is_publishable(requested.file_id, _publication.client_id, _publication.project_id)\n'
        || E'      -- 27/11/2026: regra revogada; o mesmo arquivo que a dispensa registrou nesta publicação pode ser cancelado.\n'
        || E'      AND NOT COALESCE(public.editorial_publication_waiver_covers_file(_publication.id, requested.file_id), false)) THEN\n'
        || E'      RAISE EXCEPTION ''cannot cancel a plan while its approval is in progress; create a revision'';';
  IF (length(_def) - length(replace(_def, _alvo, ''))) / length(_alvo) <> 1 THEN
    RAISE EXCEPTION 'patch transição: trecho do cancelar não encontrado exatamente 1 vez; nada aplicado';
  END IF;
  _def := replace(_def, _alvo, _novo);

  _alvo := 'OR NOT public.editorial_file_is_publishable_media(_post.primary_file_id, _publication.client_id, _publication.project_id) OR NOT public.editorial_file_is_publishable_media(_effective_file_id, _publication.client_id, _publication.project_id)) THEN';
  _novo := 'OR NOT (public.editorial_file_is_publishable_media(_post.primary_file_id, _publication.client_id, _publication.project_id) OR (p_action = ''publish'' AND COALESCE(public.editorial_publication_waiver_covers_file(_publication.id, _post.primary_file_id), false) AND EXISTS (SELECT 1 FROM social_private.autopublish_jobs AS sent_job WHERE sent_job.publication_id = _publication.id AND sent_job.stage = ''done''))) '
        || 'OR NOT (public.editorial_file_is_publishable_media(_effective_file_id, _publication.client_id, _publication.project_id) OR (p_action = ''publish'' AND COALESCE(public.editorial_publication_waiver_covers_file(_publication.id, _effective_file_id), false) AND EXISTS (SELECT 1 FROM social_private.autopublish_jobs AS sent_job WHERE sent_job.publication_id = _publication.id AND sent_job.stage = ''done'')))) THEN'
        || E'\n    -- 27/11/2026: a baixa do que já saiu (job em done) não para com a revogação; agendar e enviar param.';
  IF (length(_def) - length(replace(_def, _alvo, ''))) / length(_alvo) <> 1 THEN
    RAISE EXCEPTION 'patch transição: trecho do schedule/publish não encontrado exatamente 1 vez; nada aplicado';
  END IF;
  EXECUTE replace(_def, _alvo, _novo);

  -- 7) withdraw: publicação viva pela dispensa (inclui failed) segura o arquivo.
  _def := replace(pg_get_functiondef('public.withdraw_file_client_approval(uuid)'::regprocedure), E'\r\n', E'\n');
  _alvo := E'    RAISE EXCEPTION ''so da para retirar o que ainda espera o cliente'';\n'
        || E'  END IF;\n';
  _novo := _alvo
        || E'  -- 27/11/2026: com publicação viva pela aprovação dispensada (planned, scheduled\n'
        || E'  -- ou failed, que pode tentar de novo), o arquivo não volta a rascunho editável.\n'
        || E'  IF EXISTS (\n'
        || E'    SELECT 1\n'
        || E'    FROM public.editorial_publications AS waived_pub\n'
        || E'    JOIN public.editorial_posts AS waived_post ON waived_post.id = waived_pub.post_id\n'
        || E'    WHERE COALESCE(waived_pub.file_id, waived_post.primary_file_id) = _file.id\n'
        || E'      AND waived_pub.client_id = _file.client_id\n'
        || E'      AND waived_pub.status IN (''planned'', ''scheduled'', ''failed'')\n'
        || E'      AND waived_post.archived_at IS NULL\n'
        || E'      AND EXISTS (\n'
        || E'        SELECT 1 FROM public.editorial_events AS waiver_event\n'
        || E'        WHERE waiver_event.publication_id = waived_pub.id\n'
        || E'          AND waiver_event.event_type = ''client_approval_waived''\n'
        || E'      )\n'
        || E'  ) THEN\n'
        || E'    RAISE EXCEPTION ''esta peca tem publicacao viva pela aprovacao dispensada do cadastro; cancele a publicacao na Agenda antes de retirar'';\n'
        || E'  END IF;\n';
  IF (length(_def) - length(replace(_def, _alvo, ''))) / length(_alvo) <> 1 THEN
    RAISE EXCEPTION 'patch withdraw: trecho não encontrado exatamente 1 vez; nada aplicado';
  END IF;
  EXECUTE replace(_def, _alvo, _novo);

  IF position('editorial_file_client_approval_waived' IN pg_get_functiondef('public.save_editorial_post(jsonb,integer)'::regprocedure)) = 0
    OR position('editorial_lock_client_approval_waiver' IN pg_get_functiondef('public.save_approved_editorial_post_unlocked(jsonb,integer)'::regprocedure)) = 0
    OR position('editorial_file_client_approval_waived' IN pg_get_functiondef('public.save_approved_editorial_post_unlocked(jsonb,integer)'::regprocedure)) = 0
    OR position('editorial_publication_waiver_covers_file' IN pg_get_functiondef('public.transition_editorial_publication_unlocked(uuid,text,integer,timestamptz,text,text,text,text,text,timestamptz)'::regprocedure)) = 0
    OR position('editorial_lock_client_approval_waiver' IN pg_get_functiondef('public.transition_editorial_publication_unlocked(uuid,text,integer,timestamptz,text,text,text,text,text,timestamptz)'::regprocedure)) = 0
    OR position('''failed'')' IN pg_get_functiondef('public.withdraw_file_client_approval(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'conferência dos patches falhou; desfeito';
  END IF;
END
$patch$;

-- ─── 5) registro da dispensa em cada publicação ────────────────────────
CREATE FUNCTION public.editorial_publication_record_client_approval_waiver()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _root uuid;
  _file public.files%ROWTYPE;
BEGIN
  IF NEW.status NOT IN ('planned', 'scheduled', 'published') THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE'
    AND NEW.status IS NOT DISTINCT FROM OLD.status
    AND NEW.file_id IS NOT DISTINCT FROM OLD.file_id
    AND NEW.scheduled_at IS NOT DISTINCT FROM OLD.scheduled_at THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(NEW.file_id, post.primary_file_id) INTO _root
    FROM public.editorial_posts AS post
   WHERE post.id = NEW.post_id AND post.client_id = NEW.client_id;
  IF _root IS NULL
    OR NOT COALESCE(public.editorial_file_client_approval_waived(_root, NEW.client_id, NEW.project_id), false) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO _file FROM public.files WHERE id = _root;

  INSERT INTO public.editorial_events (
    client_id, post_id, publication_id, actor_id, event_type, from_status, to_status, metadata
  ) VALUES (
    NEW.client_id,
    NEW.post_id,
    NEW.id,
    auth.uid(),
    'client_approval_waived',
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END,
    NEW.status,
    jsonb_strip_nulls(jsonb_build_object(
      'origem', 'profiles.modo_aprovacao_do_cliente',
      'modo', 'dispensada',
      'registrado_em', clock_timestamp(),
      'operacao', lower(TG_OP),
      'file_id', _file.id,
      'file_version', _file.version,
      'file_sha256', _file.sha256,
      'file_visibility', _file.visibility,
      'file_approval_status', _file.approval_status,
      'file_requires_approval', _file.requires_approval,
      'file_approval_requested_at', _file.approval_requested_at,
      'file_agency_reviewed_by', _file.agency_reviewed_by,
      'file_agency_reviewed_at', _file.agency_reviewed_at,
      'scheduled_at', NEW.scheduled_at,
      'aprovacao_do_cliente', 'nao registrada: dispensada pelo cadastro'
    ))
  );
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION public.editorial_publication_record_client_approval_waiver()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER editorial_publication_client_approval_waiver_trg
AFTER INSERT OR UPDATE OF status, file_id, scheduled_at ON public.editorial_publications
FOR EACH ROW EXECUTE FUNCTION public.editorial_publication_record_client_approval_waiver();

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════
-- CONFERÊNCIA (só leitura, depois de aplicar)
--   select public.editorial_file_client_approval_waived(f.id, f.client_id, f.project_id)
--     from public.files f where f.id = '<arquivo raiz>';                         -- true só na dispensada
--   select count(*) from public.editorial_events where event_type = 'client_approval_waived'; -- 0 até a 1ª publicação
--   select position('editorial_publication_waiver_covers_file' in pg_get_functiondef(
--     'public.transition_editorial_publication_unlocked(uuid,text,integer,timestamptz,text,text,text,text,text,timestamptz)'::regprocedure)) > 0; -- true
--
-- ROLLBACK LÓGICO (copiar, tirar o "-- " e rodar numa transação)
-- BEGIN;
-- DROP TRIGGER IF EXISTS editorial_publication_client_approval_waiver_trg ON public.editorial_publications;
-- DROP FUNCTION IF EXISTS public.editorial_publication_record_client_approval_waiver();
-- DO $rb$
-- DECLARE _b record;
-- BEGIN
--   FOR _b IN
--     SELECT DISTINCT ON (function_signature) function_signature, functiondef
--       FROM social_private.autopublish_function_backups
--      WHERE reason = '20261127120000 aprovação dispensada: definição antes do patch'
--      ORDER BY function_signature, id DESC
--   LOOP
--     EXECUTE _b.functiondef;
--   END LOOP;
-- END $rb$;
-- DROP FUNCTION IF EXISTS public.editorial_publication_waiver_covers_file(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.editorial_lock_client_approval_waiver(uuid, uuid, uuid);
-- DROP FUNCTION IF EXISTS public.editorial_file_client_approval_waived(uuid, uuid, uuid);
-- COMMIT;
-- Publicações já agendadas pela dispensa deixam de sair (o predicado fecha);
-- cancele-as antes do rollback. Os eventos client_approval_waived ficam.
-- ═══════════════════════════════════════════════════════════════════════
