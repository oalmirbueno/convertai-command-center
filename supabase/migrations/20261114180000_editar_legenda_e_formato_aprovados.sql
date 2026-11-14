-- 14/11/2026: corrigir a legenda e o formato de um conteúdo já aprovado,
-- sem derrubar a aprovação e sem "Criar revisão".
--
-- Antes: a única saída era criar revisão. save_approved_editorial_post_unlocked
-- recusa qualquer mudança de default_caption e content_type ("approved
-- editorial copy is immutable"). O robô de publicação lê a legenda na hora de
-- publicar em editorial_publications.caption e o formato em
-- editorial_posts.content_type; os dois entram na impressão digital da
-- aprovação (editorial_compute_approval_fingerprint), que o envio confere.
--
-- Agora, duas RPCs estreitas, só para a equipe que agenda (admin ou gestor do
-- cliente, editorial_can_publish_client), nunca para o cliente do portal:
--
-- 1) editar_legenda_publicacao_aprovada(publicação, versão, legenda)
--    Muda editorial_publications.caption da publicação pedida (planejada ou
--    agendada) e editorial_posts.default_caption do mesmo post, para a Agenda
--    e um reagendamento (o save aprovado copia a legenda base para todas as
--    contas) não voltarem o texto antigo. As outras contas do mesmo post que
--    seguiam a legenda base também recebem o texto novo. Não mexe em status,
--    horário, modo de entrega, formato, aprovação do arquivo nem no selo da
--    aprovação; só refaz a impressão digital, que passa a valer o texto novo.
--    Auditoria: um evento caption_edited_after_approval por publicação, com
--    quem editou e a legenda antes e depois.
--
-- 2) ajustar_formato_publicacao_aprovada(post, versão, formato)
--    Troca o formato entre peça única: static, story, reel, video. Imagem vai
--    para static ou story; vídeo para reel, video ou story. Carrossel nunca
--    vira story. A tarefa vinculada acompanha o formato (o tipo da tarefa e o
--    formato precisam bater). Auditoria: content_type_adjusted_after_approval
--    com o formato antes e depois.
--
-- As duas exigem a aprovação intacta (impressão digital igual à atual):
-- não servem para "lavar" uma mudança feita por fora. Recusam publicação
-- publicada, com falha ou cancelada, e publicação cujo envio já começou.
-- A legenda também é recusada inteira quando OUTRA conta do mesmo conteúdo
-- está em envio: a legenda base e a impressão digital valem para o post todo.
-- editorial_events.event_type não tem CHECK de lista (só não vazio), então
-- não há constraint a atualizar.
--
-- Migration nova e aditiva. Nenhum dado é alterado ao aplicar.
-- Reverter: remover as duas funções novas e reaplicar editorial_task_delivery_type_guard
-- de 20260909100000_admin_apaga_sem_briga.sql.

-- A guarda da tarefa recusa trocar o tipo da tarefa enquanto o post ainda
-- tem o formato antigo, e a guarda do post recusa trocar o formato enquanto a
-- tarefa tem o tipo antigo. O ajuste de formato precisa mexer nos dois na
-- mesma transação: só a RPC de ajuste liga a marca local abaixo, para o post
-- que ela mesma está ajustando. A guarda do post (AFTER UPDATE) continua
-- conferindo que tarefa e formato terminam iguais.
CREATE OR REPLACE FUNCTION public.editorial_task_delivery_type_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _post_id uuid;
  _content_type text;
  _expected_content_type text;
BEGIN
  -- Purga de conta (admin_purge_user): a cascata declarada no banco leva
  -- tudo que era do cliente, e esta guarda nao deve segurar a propria purga.
  IF current_setting('app.purge_in_progress', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF NEW.delivery_type IS NOT DISTINCT FROM OLD.delivery_type THEN
    RETURN NEW;
  END IF;

  PERFORM public.editorial_lock_task_sync();
  _post_id := public.editorial_current_post_id_for_task(NEW.id);
  IF _post_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.delivery_type = 'unspecified'
    OR NOT public.editorial_delivery_type_is_publishable(NEW.delivery_type) THEN
    RAISE EXCEPTION
      'Uma tarefa com conteúdo editorial ativo precisa manter um tipo publicável.';
  END IF;

  -- 14/11/2026: ajuste de formato do conteúdo aprovado, na mesma transação.
  IF COALESCE(current_setting('app.editorial_ajuste_formato_post', true), '') = _post_id::text THEN
    RETURN NEW;
  END IF;

  SELECT post.content_type
  INTO _content_type
  FROM public.editorial_posts AS post
  WHERE post.id = _post_id;

  _expected_content_type :=
    public.editorial_content_type_for_delivery_type(NEW.delivery_type);
  IF _expected_content_type IS DISTINCT FROM _content_type THEN
    RAISE EXCEPTION
      'O tipo da tarefa não corresponde ao formato do conteúdo editorial ativo.';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.editorial_task_delivery_type_guard()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.editar_legenda_publicacao_aprovada(
  p_publication_id uuid,
  p_expected_version integer,
  p_caption text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  _actor uuid := auth.uid();
  _depois text := NULLIF(btrim(COALESCE(p_caption, '')), '');
  _pub public.editorial_publications%ROWTYPE;
  _pub_internal public.editorial_publication_internal%ROWTYPE;
  _post public.editorial_posts%ROWTYPE;
  _post_internal public.editorial_post_internal%ROWTYPE;
  _legenda_base_antes text;
  _alvo record;
  _editadas uuid[] := ARRAY[]::uuid[];
  _versao integer;
BEGIN
  -- Mesmo primeiro lock das transições, do save e do robô de publicação.
  PERFORM public.editorial_lock_task_sync();

  IF _actor IS NULL THEN
    RAISE EXCEPTION 'Entre no painel para editar a legenda.';
  END IF;
  IF _depois IS NULL THEN
    RAISE EXCEPTION 'A legenda não pode ficar vazia.';
  END IF;
  IF char_length(_depois) > 2200 THEN
    RAISE EXCEPTION 'A legenda passou de 2.200 caracteres, o limite do Instagram.';
  END IF;

  SELECT * INTO _pub
  FROM public.editorial_publications
  WHERE id = p_publication_id
  FOR UPDATE;
  -- Só a equipe que agenda (admin ou gestor do cliente). O cliente do portal
  -- nunca passa: ele aprova, não reescreve o que aprovou.
  IF NOT FOUND
    OR _actor = _pub.client_id
    OR NOT public.editorial_can_publish_client(_pub.client_id) THEN
    RAISE EXCEPTION 'Publicação não encontrada ou sem permissão para editar a legenda.';
  END IF;
  IF _pub.status NOT IN ('planned', 'scheduled') THEN
    RAISE EXCEPTION 'Só dá para editar a legenda de publicação planejada ou agendada. Publicada, com falha ou cancelada não muda por aqui.';
  END IF;
  IF p_expected_version IS NULL OR _pub.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'Esta publicação mudou desde que a tela carregou. Recarregue e tente de novo.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO _post
  FROM public.editorial_posts
  WHERE id = _pub.post_id
  FOR UPDATE;
  IF NOT FOUND
    OR _post.archived_at IS NOT NULL
    OR _post.client_id IS DISTINCT FROM _pub.client_id THEN
    RAISE EXCEPTION 'Conteúdo indisponível.';
  END IF;

  SELECT * INTO _post_internal
  FROM public.editorial_post_internal
  WHERE post_id = _post.id
  FOR UPDATE;
  SELECT * INTO _pub_internal
  FROM public.editorial_publication_internal
  WHERE publication_id = _pub.id
  FOR UPDATE;

  -- A aprovação precisa estar intacta agora. Se algo mudou por fora, o
  -- caminho continua sendo a revisão.
  IF _post.production_status <> 'ready'
    OR _post_internal.post_id IS NULL
    OR _post_internal.approval_fingerprint IS NULL
    OR _post_internal.approval_fingerprint IS DISTINCT FROM
      public.editorial_compute_approval_fingerprint(_post.id) THEN
    RAISE EXCEPTION 'Este conteúdo não está aprovado ou mudou depois da aprovação. Use Criar revisão.';
  END IF;
  IF _pub_internal.publication_id IS NULL OR NOT _pub_internal.included_in_approval_snapshot THEN
    RAISE EXCEPTION 'Esta publicação não faz parte do que foi aprovado. Edite pelo editor do conteúdo.';
  END IF;

  -- Envio em andamento: o contêiner da Meta pode já ter a legenda antiga.
  IF EXISTS (
    SELECT 1
    FROM social_private.autopublish_jobs AS job
    WHERE job.publication_id = _pub.id
      AND job.stage NOT IN ('done', 'failed', 'cancelled')
  ) THEN
    RAISE EXCEPTION 'O envio desta publicação já começou. Espere terminar antes de mudar a legenda.';
  END IF;
  -- Outra conta do mesmo conteúdo em envio: a legenda base e a impressão
  -- digital são do post inteiro, e o envio confere a impressão digital a cada
  -- passo. Mudar agora derrubaria o envio da outra conta. Recusa tudo, antes
  -- de qualquer gravação.
  IF EXISTS (
    SELECT 1
    FROM public.editorial_publications AS irma
    JOIN social_private.autopublish_jobs AS job
      ON job.publication_id = irma.id
    WHERE irma.post_id = _post.id
      AND irma.id <> _pub.id
      AND job.stage NOT IN ('done', 'failed', 'cancelled')
  ) THEN
    RAISE EXCEPTION 'Outra conta deste conteúdo está com o envio em andamento. Espere terminar antes de mudar a legenda.';
  END IF;

  _legenda_base_antes := _post.default_caption;

  IF _pub.caption IS NOT DISTINCT FROM _depois
    AND _legenda_base_antes IS NOT DISTINCT FROM _depois THEN
    RETURN jsonb_build_object(
      'publication_id', _pub.id,
      'post_id', _post.id,
      'changed', false,
      'version', _pub.version,
      'post_version', _post.version,
      'publicacoes_editadas', '[]'::jsonb
    );
  END IF;

  -- A publicação pedida e, do mesmo post, as outras contas vivas que seguiam
  -- a legenda base (o save aprovado copia a legenda base para todas; sem
  -- isto, o próximo reagendamento trocaria o texto delas sem registro).
  FOR _alvo IN
    SELECT publication.id, publication.caption, publication.status
    FROM public.editorial_publications AS publication
    LEFT JOIN public.editorial_publication_internal AS internal
      ON internal.publication_id = publication.id
    WHERE publication.post_id = _post.id
      AND (
        publication.id = _pub.id
        OR (
          publication.status IN ('planned', 'scheduled')
          AND COALESCE(internal.included_in_approval_snapshot, false)
          AND publication.caption IS NOT DISTINCT FROM _legenda_base_antes
          AND publication.caption IS DISTINCT FROM _depois
        )
      )
    ORDER BY (publication.id = _pub.id) DESC, publication.created_at, publication.id
    FOR UPDATE OF publication
  LOOP
    IF _alvo.caption IS DISTINCT FROM _depois THEN
      UPDATE public.editorial_publications
      SET caption = _depois
      WHERE id = _alvo.id;
    END IF;
    _editadas := _editadas || _alvo.id;

    INSERT INTO public.editorial_events (
      client_id,
      post_id,
      publication_id,
      actor_id,
      event_type,
      from_status,
      to_status,
      metadata
    ) VALUES (
      _post.client_id,
      _post.id,
      _alvo.id,
      _actor,
      'caption_edited_after_approval',
      _alvo.status,
      _alvo.status,
      jsonb_build_object(
        'caption_antes', _alvo.caption,
        'caption_depois', _depois,
        'legenda_base_antes', _legenda_base_antes,
        'publicacao_pedida', _pub.id,
        'origem', 'editar_legenda_publicacao_aprovada'
      )
    );
  END LOOP;

  IF _legenda_base_antes IS DISTINCT FROM _depois THEN
    UPDATE public.editorial_posts
    SET default_caption = _depois
    WHERE id = _post.id;
  END IF;

  -- O selo da aprovação continua; a impressão digital passa a valer o texto
  -- novo, senão o envio recusaria com "approval snapshot changed".
  UPDATE public.editorial_post_internal
  SET
    approval_fingerprint = public.editorial_compute_approval_fingerprint(_post.id),
    updated_by = _actor
  WHERE post_id = _post.id;

  SELECT version INTO _versao
  FROM public.editorial_publications
  WHERE id = _pub.id;
  SELECT version INTO _post.version
  FROM public.editorial_posts
  WHERE id = _post.id;

  RETURN jsonb_build_object(
    'publication_id', _pub.id,
    'post_id', _post.id,
    'changed', true,
    'status', _pub.status,
    'version', _versao,
    'post_version', _post.version,
    'publicacoes_editadas', to_jsonb(_editadas)
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.ajustar_formato_publicacao_aprovada(
  p_post_id uuid,
  p_expected_version integer,
  p_content_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  _actor uuid := auth.uid();
  _formato text := lower(btrim(COALESCE(p_content_type, '')));
  _post public.editorial_posts%ROWTYPE;
  _post_internal public.editorial_post_internal%ROWTYPE;
  _arquivo public.files%ROWTYPE;
  _e_video boolean;
  _task_id uuid;
  _tipo_tarefa_antes text;
  _tipo_tarefa_depois text;
  _formato_antes text;
BEGIN
  PERFORM public.editorial_lock_task_sync();

  IF _actor IS NULL THEN
    RAISE EXCEPTION 'Entre no painel para ajustar o formato.';
  END IF;
  IF _formato NOT IN ('static', 'story', 'reel', 'video') THEN
    RAISE EXCEPTION 'Formato não permitido aqui. Use Post estático, Story, Reel ou Vídeo.';
  END IF;

  SELECT * INTO _post
  FROM public.editorial_posts
  WHERE id = p_post_id
  FOR UPDATE;
  IF NOT FOUND
    OR _actor = _post.client_id
    OR NOT public.editorial_can_publish_client(_post.client_id) THEN
    RAISE EXCEPTION 'Conteúdo não encontrado ou sem permissão para ajustar o formato.';
  END IF;
  IF _post.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Conteúdo indisponível.';
  END IF;
  IF p_expected_version IS NULL OR _post.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'Este conteúdo mudou desde que a tela carregou. Recarregue e tente de novo.'
      USING ERRCODE = 'P0001';
  END IF;

  _formato_antes := _post.content_type;
  IF _formato_antes NOT IN ('static', 'story', 'reel', 'video') THEN
    RAISE EXCEPTION 'Só peça única troca de formato aqui. Carrossel não vira Story.';
  END IF;

  SELECT * INTO _post_internal
  FROM public.editorial_post_internal
  WHERE post_id = _post.id
  FOR UPDATE;
  IF _post.production_status <> 'ready'
    OR _post_internal.post_id IS NULL
    OR _post_internal.approval_fingerprint IS NULL
    OR _post_internal.approval_fingerprint IS DISTINCT FROM
      public.editorial_compute_approval_fingerprint(_post.id) THEN
    RAISE EXCEPTION 'Este conteúdo não está aprovado ou mudou depois da aprovação. Use Criar revisão.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.editorial_publications AS publication
    WHERE publication.post_id = _post.id
      AND publication.status NOT IN ('planned', 'scheduled', 'cancelled')
  ) THEN
    RAISE EXCEPTION 'Este conteúdo já tem publicação publicada ou com falha. Crie uma revisão para trocar o formato.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.editorial_publications AS publication
    JOIN social_private.autopublish_jobs AS job
      ON job.publication_id = publication.id
    WHERE publication.post_id = _post.id
      AND job.stage NOT IN ('done', 'failed', 'cancelled')
  ) THEN
    RAISE EXCEPTION 'O envio deste conteúdo já começou. Espere terminar antes de mudar o formato.';
  END IF;

  -- Peça única: o arquivo principal e o de cada publicação viva não podem ter
  -- lâminas (carrossel).
  IF EXISTS (
    SELECT 1
    FROM public.files AS child
    WHERE child.parent_file_id IN (
        SELECT _post.primary_file_id
        UNION
        SELECT publication.file_id
        FROM public.editorial_publications AS publication
        WHERE publication.post_id = _post.id
          AND publication.status <> 'cancelled'
          AND publication.file_id IS NOT NULL
      )
      AND child.archived_at IS NULL
      AND COALESCE(child.status, 'ready') = 'ready'
  ) THEN
    RAISE EXCEPTION 'Carrossel não vira Story: o Story precisa de uma peça só.';
  END IF;

  SELECT * INTO _arquivo
  FROM public.files
  WHERE id = _post.primary_file_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'O arquivo deste conteúdo não foi encontrado.';
  END IF;
  _e_video :=
    lower(COALESCE(_arquivo.mime_type, '')) LIKE 'video/%'
    OR lower(COALESCE(_arquivo.extension, '')) IN ('mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi')
    OR lower(COALESCE(_arquivo.file_type, '')) IN ('video', 'vídeo');
  IF _e_video AND _formato = 'static' THEN
    RAISE EXCEPTION 'Este conteúdo é um vídeo. Escolha Story, Reel ou Vídeo.';
  END IF;
  IF NOT _e_video AND _formato IN ('reel', 'video') THEN
    RAISE EXCEPTION 'Este conteúdo é uma imagem. Escolha Post estático ou Story.';
  END IF;

  IF _formato_antes = _formato THEN
    RETURN jsonb_build_object(
      'post_id', _post.id,
      'changed', false,
      'content_type', _formato,
      'version', _post.version
    );
  END IF;

  -- A tarefa vinculada acompanha o formato (as guardas exigem que batam).
  SELECT task.id, task.delivery_type
  INTO _task_id, _tipo_tarefa_antes
  FROM public.tasks AS task
  WHERE task.id = _post_internal.task_id
    AND task.deleted_at IS NULL
  FOR UPDATE OF task;
  _tipo_tarefa_depois := _tipo_tarefa_antes;

  IF _task_id IS NOT NULL
    AND _tipo_tarefa_antes IS DISTINCT FROM 'unspecified'
    AND public.editorial_content_type_for_delivery_type(_tipo_tarefa_antes) IS DISTINCT FROM _formato THEN
    _tipo_tarefa_depois := public.editorial_delivery_type_for_content_type(_formato);
    PERFORM set_config('app.editorial_ajuste_formato_post', _post.id::text, true);
    UPDATE public.tasks
    SET delivery_type = _tipo_tarefa_depois
    WHERE id = _task_id;
    PERFORM set_config('app.editorial_ajuste_formato_post', '', true);
  END IF;

  UPDATE public.editorial_posts
  SET content_type = _formato
  WHERE id = _post.id
  RETURNING * INTO _post;

  UPDATE public.editorial_post_internal
  SET
    approval_fingerprint = public.editorial_compute_approval_fingerprint(_post.id),
    updated_by = _actor
  WHERE post_id = _post.id;

  INSERT INTO public.editorial_events (
    client_id,
    post_id,
    publication_id,
    actor_id,
    event_type,
    from_status,
    to_status,
    metadata
  ) VALUES (
    _post.client_id,
    _post.id,
    NULL,
    _actor,
    'content_type_adjusted_after_approval',
    NULL,
    NULL,
    jsonb_build_object(
      'formato_antes', _formato_antes,
      'formato_depois', _formato,
      'tipo_tarefa_antes', _tipo_tarefa_antes,
      'tipo_tarefa_depois', _tipo_tarefa_depois,
      'origem', 'ajustar_formato_publicacao_aprovada'
    )
  );

  SELECT version INTO _post.version
  FROM public.editorial_posts
  WHERE id = _post.id;

  RETURN jsonb_build_object(
    'post_id', _post.id,
    'changed', true,
    'content_type', _formato,
    'version', _post.version
  );
END
$function$;

REVOKE ALL ON FUNCTION public.editar_legenda_publicacao_aprovada(uuid, integer, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.editar_legenda_publicacao_aprovada(uuid, integer, text)
  TO authenticated;

REVOKE ALL ON FUNCTION public.ajustar_formato_publicacao_aprovada(uuid, integer, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ajustar_formato_publicacao_aprovada(uuid, integer, text)
  TO authenticated;
