-- 24/10/2026: fim de semana por cliente (dono: "true libera sábado e domingo; false mantém exatamente o
-- comportamento de hoje"). Coluna nova em mesa_cliente_config, a RPC da Entrega com o campo novo (a de 4
-- argumentos continua igual) e o agendador da Mesa (mesa_agendar_aprovados) passa a usar o próximo horário
-- do cliente. As regras puras moram em supabase/functions/_shared/agenda-inteligente.ts. Idempotente.

ALTER TABLE public.mesa_cliente_config
  ADD COLUMN IF NOT EXISTS postar_fim_de_semana boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.mesa_cliente_config.postar_fim_de_semana IS
  'true: o cliente posta no sábado e no domingo (Mês, gravar, encaixe, Estúdio, arte rápida e agendador); false: só de segunda a sexta.';

CREATE OR REPLACE FUNCTION public.mesa_config_agenda(_client_id uuid, _posts_por_dia integer, _hypes_por_dia integer, _horas_entre_posts integer, _postar_fim_de_semana boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL
    OR NOT (public.has_role(_uid, 'admin'::public.app_role) OR public.has_role(_uid, 'manager'::public.app_role))
    OR NOT public.can_access_client(_client_id) THEN
    RAISE EXCEPTION 'só admin ou gestor com acesso ao cliente muda este ajuste' USING ERRCODE = '42501';
  END IF;
  IF _posts_por_dia NOT BETWEEN 1 AND 5 OR _hypes_por_dia NOT BETWEEN 0 AND 3 OR _horas_entre_posts NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'limites fora do permitido (posts 1 a 5, hypes 0 a 3, horas 1 a 12)' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.mesa_cliente_config (client_id, posts_por_dia, hypes_por_dia, horas_entre_posts, postar_fim_de_semana, atualizado_em, atualizado_por)
  VALUES (_client_id, _posts_por_dia, _hypes_por_dia, _horas_entre_posts, COALESCE(_postar_fim_de_semana, false), now(), _uid)
  ON CONFLICT (client_id) DO UPDATE SET
    posts_por_dia = EXCLUDED.posts_por_dia,
    hypes_por_dia = EXCLUDED.hypes_por_dia,
    horas_entre_posts = EXCLUDED.horas_entre_posts,
    postar_fim_de_semana = EXCLUDED.postar_fim_de_semana,
    atualizado_em = now(),
    atualizado_por = _uid;
  RETURN jsonb_build_object('posts_por_dia', _posts_por_dia, 'hypes_por_dia', _hypes_por_dia, 'horas_entre_posts', _horas_entre_posts,
    'postar_fim_de_semana', COALESCE(_postar_fim_de_semana, false));
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_config_agenda(uuid, integer, integer, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesa_config_agenda(uuid, integer, integer, integer, boolean) TO authenticated;

-- O próximo horário de publicar do cliente: igual a mesa_proximo_horario_util (segunda a sexta), mas o
-- cliente com postar_fim_de_semana = true aceita também o sábado e o domingo.
CREATE OR REPLACE FUNCTION public.mesa_proximo_horario_do_cliente(_client_id uuid, _dia date, _hora time without time zone, _fuso text, _agora timestamp with time zone DEFAULT now())
RETURNS timestamp with time zone
LANGUAGE plpgsql
STABLE
SET search_path TO ''
AS $$
DECLARE
  _fds boolean := COALESCE((SELECT c.postar_fim_de_semana FROM public.mesa_cliente_config c WHERE c.client_id = _client_id), false);
  _d date := greatest(COALESCE(_dia, (_agora AT TIME ZONE _fuso)::date), (_agora AT TIME ZONE _fuso)::date);
  _quando timestamptz;
BEGIN
  IF NOT _fds THEN
    RETURN public.mesa_proximo_horario_util(_dia, _hora, _fuso, _agora);
  END IF;
  FOR _i IN 1..21 LOOP
    _quando := (_d + _hora) AT TIME ZONE _fuso;
    IF _quando >= _agora + interval '15 minutes' THEN
      RETURN _quando;
    END IF;
    _d := _d + 1;
  END LOOP;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_proximo_horario_do_cliente(uuid, date, time without time zone, text, timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesa_proximo_horario_do_cliente(uuid, date, time without time zone, text, timestamp with time zone) TO authenticated, service_role;

-- Agendador da Mesa: o mesmo de 20261020120000_stories_da_mesa.sql (conferido igual ao de produção pelo md5
-- do corpo em 24/10), com uma linha trocada: o horário vem de mesa_proximo_horario_do_cliente.
CREATE OR REPLACE FUNCTION public.mesa_agendar_aprovados()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _f record;
  _t record;
  _task record;
  _root record;
  _conta record;
  _hora time;
  _fuso text;
  _admin uuid;
  _ator uuid;
  _quando timestamptz;
  _tipo text;
  _modo text;
  _payload jsonb;
  _res jsonb;
  _post uuid;
  _atencao text;
  _pub_id uuid;
  _pub_versao integer;
  _pub_status text;
  _pub_fuso text;
  _pub_modo text;
  _assets jsonb;
  _segurada boolean;
  _pub_conta uuid;
  _agendados integer := 0;
  _precisam integer := 0;
  _falhas jsonb := '[]'::jsonb;
BEGIN
  SELECT user_id INTO _admin
    FROM public.user_roles
   WHERE role = 'admin'::public.app_role
   ORDER BY user_id
   LIMIT 1;
  IF _admin IS NULL THEN
    RETURN jsonb_build_object('agendados', 0, 'erro', 'nenhum admin cadastrado');
  END IF;

  FOR _f IN
    SELECT *
      FROM public.mesa_agendamento_fila
     WHERE processado_em IS NULL
       AND tentativas < 5
     ORDER BY criado_em
     LIMIT 20
     FOR UPDATE SKIP LOCKED
  LOOP
    _atencao := NULL;
    _post := NULL;
    BEGIN
      SELECT * INTO _t FROM public.estudio_trabalhos WHERE id = _f.trabalho_id;
      SELECT id, project_id, due_date, title INTO _task
        FROM public.tasks
       WHERE id = _t.task_id AND deleted_at IS NULL;
      SELECT id, file_name, caption, description INTO _root
        FROM public.files
       WHERE id = _f.file_id;

      IF _task.id IS NULL THEN
        _atencao := 'O item da agenda foi apagado. A arte aprovada está em Arquivos.';
      ELSIF _t.file_ids[1] IS DISTINCT FROM _f.file_id THEN
        _atencao := 'A arte aprovada não é a entrega atual deste trabalho. Confira em Arquivos antes de agendar.';
      END IF;

      IF _atencao IS NULL THEN
        SELECT p.id INTO _post
          FROM public.editorial_posts p
         WHERE p.primary_file_id = _f.file_id AND p.archived_at IS NULL
         LIMIT 1;
      END IF;

      IF _atencao IS NULL AND _post IS NULL THEN
        IF public.editorial_current_post_id_for_task(_task.id) IS NOT NULL THEN
          _atencao := 'O item já tem um post na Agenda. Ligue a arte aprovada por lá.';
        END IF;
      END IF;

      IF _atencao IS NULL AND _post IS NULL THEN
        SELECT ea.id,
               (c.connection_status = 'connected' AND COALESCE(c.automation_enabled, false)) AS automatica
          INTO _conta
          FROM public.project_external_accounts pea
          JOIN public.external_accounts ea ON ea.id = pea.external_account_id
          LEFT JOIN public.external_account_connections c ON c.external_account_id = ea.id
         WHERE pea.project_id = _task.project_id
           AND ea.client_id = _t.client_id
           AND ea.platform = 'instagram'
           AND ea.status = 'active'
         ORDER BY (c.connection_status = 'connected') DESC NULLS LAST, ea.created_at
         LIMIT 1;
        IF _conta.id IS NULL THEN
          _atencao := 'O projeto não tem conta do Instagram ligada. Ligue a conta na Agenda e agende por lá.';
        END IF;
      END IF;

      IF _atencao IS NULL AND _post IS NULL THEN
        SELECT c.hora_publicacao, c.fuso INTO _hora, _fuso
          FROM public.mesa_cliente_config c
         WHERE c.client_id = _t.client_id;
        IF COALESCE((SELECT c.horario_automatico FROM public.mesa_cliente_config c WHERE c.client_id = _t.client_id), true) THEN
          _hora := public.mesa_melhor_hora(_t.client_id, CASE WHEN cardinality(_t.file_ids) > 1 THEN 'carousel' ELSE 'static' END);
        END IF;
        _hora := COALESCE(_hora, '09:00'::time);
        _fuso := COALESCE(_fuso, 'America/Sao_Paulo');
        -- 24/10: cliente com postar_fim_de_semana também agenda no sábado e no domingo.
        _quando := public.mesa_proximo_horario_do_cliente(_t.client_id, _task.due_date, _hora, _fuso);
        -- 20/10 (Stories): arte de uma lâmina no formato stories_9x16 entra como story.
        _tipo := CASE
          WHEN cardinality(_t.file_ids) > 1 THEN 'carousel'
          WHEN _t.direcao->>'formato' = 'stories_9x16' THEN 'story'
          ELSE 'static'
        END;
        _modo := CASE
          WHEN _conta.automatica
            AND cardinality(_t.file_ids) BETWEEN 1 AND 10
            AND NOT EXISTS (
              SELECT 1 FROM public.files fr
               WHERE (fr.id = _f.file_id OR fr.parent_file_id = _f.file_id)
                 AND (fr.sha256 IS NULL OR lower(fr.sha256) !~ '^[0-9a-f]{64}$')
            )
            THEN 'automatic'
          ELSE 'manual'
        END;

        _ator := CASE
          WHEN _t.enviado_por IS NOT NULL AND public.has_role(_t.enviado_por, 'admin'::public.app_role) THEN _t.enviado_por
          ELSE _admin
        END;
        PERFORM set_config('request.jwt.claims',
          json_build_object('sub', _ator::text, 'role', 'authenticated')::text, true);

        _payload := jsonb_build_object(
          'id', NULL,
          'idempotency_key', public.mesa_uuid_estavel('mesa-post:' || _f.file_id::text),
          'mutation_id', public.mesa_uuid_estavel('mesa-mutacao:' || _f.file_id::text || ':' || _f.tentativas::text),
          'client_id', _t.client_id,
          'project_id', _task.project_id,
          'primary_file_id', _f.file_id,
          'title', COALESCE(NULLIF(btrim(_task.title), ''), _root.file_name),
          'content_type', _tipo,
          'objective', NULLIF(btrim(COALESCE(_root.description, '')), ''),
          'default_caption', NULLIF(btrim(COALESCE(_root.caption, '')), ''),
          'production_status', 'ready',
          'task_id', _task.id,
          'responsible_id', NULL,
          'internal_notes', 'Agendado pela Mesa do cliente quando a arte foi aprovada.',
          'revision_of_post_id', NULL,
          'publications', jsonb_build_array(jsonb_build_object(
            'id', NULL,
            'idempotency_key', public.mesa_uuid_estavel('mesa-publicacao:' || _f.file_id::text || ':' || _conta.id::text),
            'external_account_id', _conta.id,
            'file_id', _f.file_id,
            'caption', NULLIF(btrim(COALESCE(_root.caption, '')), ''),
            'first_comment', NULL,
            'alt_text', NULL,
            'asset_file_ids', to_jsonb(_t.file_ids),
            'delivery_mode', _modo,
            'scheduled_at', to_jsonb(_quando),
            'scheduled_timezone', _fuso
          ))
        );

        _res := public.save_editorial_post(_payload, NULL);
        _post := NULLIF(_res->>'post_id', '')::uuid;

        UPDATE public.estudio_trabalhos
           SET post_id = _post,
               agendado_para = _quando,
               entrega_status = 'agendado',
               entrega_aviso = NULL
         WHERE id = _t.id;

        PERFORM public.avisar_equipe(
          public.mesa_com_cliente(_t.client_id, 'Mesa: "' || COALESCE(_task.title, 'post') || '" foi aprovado e entrou na Agenda para '
            || to_char(_quando AT TIME ZONE _fuso, 'DD/MM "às" HH24:MI') || '.'),
          'publication',
          '/calendario?client=' || _t.client_id::text || COALESCE('&content=' || _post::text, '')
        );
        _agendados := _agendados + 1;

      ELSIF _atencao IS NULL AND _post IS NOT NULL THEN
        -- Frente EA: a entrega já pôs o post na Agenda. A data que vale é a
        -- da publicação (o dono confirmou na Entrega ou a equipe na Agenda).
        _pub_id := NULL;
        _quando := NULL;
        SELECT pub.id, pub.version, pub.status, pub.scheduled_at,
               COALESCE(pub.scheduled_timezone, 'America/Sao_Paulo'),
               COALESCE(pub.delivery_mode, 'manual')
          INTO _pub_id, _pub_versao, _pub_status, _quando, _pub_fuso, _pub_modo
          FROM public.editorial_publications pub
         WHERE pub.post_id = _post AND pub.status IN ('planned', 'scheduled', 'published')
         ORDER BY (pub.platform = 'instagram') DESC, pub.scheduled_at NULLS LAST
         LIMIT 1;

        -- Conserto 27/09: a peça entrou na Agenda antes da aprovação, sem as
        -- lâminas (a Agenda só congela arquivo aprovado). Aprovada e com data:
        -- congela as lâminas na ordem do Estúdio e o modo de entrega, pela
        -- mesma regra do caminho antigo, antes de o promotor agendar.
        IF _pub_id IS NOT NULL AND _pub_status = 'planned' AND _quando IS NOT NULL
          AND _t.agenda_sincronizada_em IS NOT NULL
          AND cardinality(_t.file_ids) > 0
          AND NOT EXISTS (
            SELECT 1 FROM social_private.editorial_publication_assets a WHERE a.publication_id = _pub_id
          ) THEN
          BEGIN
            SELECT pub.external_account_id INTO _pub_conta
              FROM public.editorial_publications pub WHERE pub.id = _pub_id;
            _pub_modo := CASE
              WHEN EXISTS (
                SELECT 1 FROM public.external_account_connections c
                 WHERE c.external_account_id = _pub_conta
                   AND c.client_id = _t.client_id
                   AND c.provider = 'meta'
                   AND c.connection_status = 'connected'
                   AND COALESCE(c.automation_enabled, false)
                   AND (c.expires_at IS NULL OR c.expires_at > now())
              )
                AND cardinality(_t.file_ids) BETWEEN 1 AND 10
                AND NOT EXISTS (
                  SELECT 1 FROM public.files fr
                   WHERE (fr.id = _f.file_id OR fr.parent_file_id = _f.file_id)
                     AND (fr.sha256 IS NULL OR lower(fr.sha256) !~ '^[0-9a-f]{64}$')
                )
                THEN 'automatic'
              ELSE 'manual'
            END;
            PERFORM set_config('request.jwt.claims',
              json_build_object('sub', _admin::text, 'role', 'authenticated')::text, true);
            PERFORM social_private.capture_editorial_asset_snapshots(
              _post,
              jsonb_build_object('publications', jsonb_build_array(jsonb_build_object(
                'id', _pub_id,
                'external_account_id', _pub_conta,
                'asset_file_ids', to_jsonb(_t.file_ids),
                'delivery_mode', _pub_modo,
                'scheduled_at', _quando,
                'scheduled_timezone', _pub_fuso
              ))),
              false
            );
          EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'mesa_agendar_aprovados: lâminas da peça % não congeladas: %', _t.id, SQLERRM;
          END;
        END IF;

        -- "Publicar assim que aprovar" e aprovação além da janela de 6 h do
        -- promotor: agenda para o minuto seguinte, pelo mesmo caminho do
        -- promotor (pedido de entrega, selo de aprovação e transição oficial).
        IF _pub_id IS NOT NULL AND _pub_status = 'planned' AND _quando IS NOT NULL
          AND _t.agenda_sincronizada_em IS NOT NULL
          AND COALESCE(_t.publicar_ao_aprovar, false)
          AND _quando < now() - interval '6 hours' THEN
          _quando := now() + interval '1 minute';
          PERFORM set_config('request.jwt.claims',
            json_build_object('sub', _admin::text, 'role', 'authenticated')::text, true);
          SELECT COALESCE(jsonb_agg(a.file_id::text ORDER BY a.position), '[]'::jsonb)
            INTO _assets
            FROM social_private.editorial_publication_assets a
           WHERE a.publication_id = _pub_id;
          INSERT INTO social_private.editorial_publication_delivery_requests
            (publication_id, client_id, request_fingerprint, delivery_mode, asset_count)
          VALUES (
            _pub_id, _t.client_id,
            encode(sha256(convert_to(jsonb_build_object(
              'delivery_mode', _pub_modo,
              'asset_file_ids', _assets,
              'scheduled_at', _quando,
              'scheduled_timezone', _pub_fuso
            )::text, 'UTF8')), 'hex'),
            _pub_modo, jsonb_array_length(_assets)
          )
          ON CONFLICT (publication_id) DO NOTHING;
          UPDATE public.editorial_post_internal
             SET approval_fingerprint = public.editorial_compute_approval_fingerprint(_post),
                 updated_by = COALESCE(auth.uid(), updated_by)
           WHERE post_id = _post AND approval_fingerprint IS NOT NULL;
          PERFORM public.transition_editorial_publication_unlocked(_pub_id, 'schedule', _pub_versao, _quando, _pub_fuso);
        END IF;

        _segurada := _quando IS NOT NULL AND public.mesa_publicacao_segurada(_post, _quando, _f.file_id);
        UPDATE public.estudio_trabalhos
           SET post_id = _post,
               entrega_status = CASE WHEN _quando IS NOT NULL AND NOT _segurada THEN 'agendado' ELSE 'aprovado' END,
               agendado_para = _quando,
               entrega_aviso = CASE
                 WHEN _t.agenda_sincronizada_em IS NULL AND _quando IS NOT NULL THEN 'Esta arte já estava na Agenda.'
                 WHEN _quando IS NULL THEN 'Aprovado. Confirme a data para agendar.'
                 WHEN _segurada THEN 'Aprovado depois do horário. Escolha uma nova data.'
                 ELSE NULL
               END
         WHERE id = _t.id;


      ELSE
        UPDATE public.estudio_trabalhos
           SET entrega_status = 'precisa_de_atencao', entrega_aviso = _atencao
         WHERE id = _t.id;
        PERFORM public.avisar_equipe(
          public.mesa_com_cliente(_t.client_id, 'Mesa: "' || COALESCE(_task.title, 'arte aprovada') || '" foi aprovado, mas não entrou sozinho na Agenda. ' || _atencao),
          'aprovacao_necessaria',
          '/mesa?client=' || _t.client_id::text || '&aba=entrega'
        );
        _precisam := _precisam + 1;
      END IF;

      UPDATE public.mesa_agendamento_fila
         SET processado_em = now(), erro = NULL
       WHERE trabalho_id = _f.trabalho_id;

    EXCEPTION WHEN OTHERS THEN
      UPDATE public.mesa_agendamento_fila
         SET tentativas = tentativas + 1,
             erro = left(SQLERRM, 500),
             processado_em = CASE WHEN tentativas + 1 >= 5 THEN now() ELSE NULL END
       WHERE trabalho_id = _f.trabalho_id;
      IF _f.tentativas + 1 >= 5 THEN
        UPDATE public.estudio_trabalhos
           SET entrega_status = 'precisa_de_atencao',
               entrega_aviso = left('Não consegui agendar sozinho: ' || SQLERRM, 1000)
         WHERE id = _f.trabalho_id;
        PERFORM public.avisar_equipe(
          public.mesa_com_cliente(_f.client_id, 'Mesa: uma arte aprovada não entrou sozinha na Agenda depois de 5 tentativas. Agende pela Agenda.'),
          'aprovacao_necessaria',
          '/mesa?client=' || _f.client_id::text || '&aba=entrega'
        );
      END IF;
      _falhas := _falhas || jsonb_build_object('trabalho_id', _f.trabalho_id, 'erro', left(SQLERRM, 300));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'agendados', _agendados,
    'precisam_de_atencao', _precisam,
    'falhas', _falhas,
    'em', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mesa_agendar_aprovados() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_agendar_aprovados() TO service_role;

-- Conferência (só leitura, depois de aplicar):
-- select column_name, column_default from information_schema.columns where table_name = 'mesa_cliente_config' and column_name = 'postar_fim_de_semana';
-- select position('mesa_proximo_horario_do_cliente' in pg_get_functiondef('public.mesa_agendar_aprovados()'::regprocedure)) > 0;
