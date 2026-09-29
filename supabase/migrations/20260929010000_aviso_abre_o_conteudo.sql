-- 29/09: o aviso de aprovação abre direto no conteúdo (post da Agenda, peça no
-- Estúdio ou Aprovações do cliente), e não só na Agenda.

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
        _atencao := 'O item da agenda foi apagado. A arte aprovada estÃ¡ em Arquivos.';
      ELSIF _t.file_ids[1] IS DISTINCT FROM _f.file_id THEN
        _atencao := 'A arte aprovada nÃ£o Ã© a entrega atual deste trabalho. Confira em Arquivos antes de agendar.';
      END IF;

      IF _atencao IS NULL THEN
        SELECT p.id INTO _post
          FROM public.editorial_posts p
         WHERE p.primary_file_id = _f.file_id AND p.archived_at IS NULL
         LIMIT 1;
      END IF;

      IF _atencao IS NULL AND _post IS NULL THEN
        IF public.editorial_current_post_id_for_task(_task.id) IS NOT NULL THEN
          _atencao := 'O item jÃ¡ tem um post na Agenda. Ligue a arte aprovada por lÃ¡.';
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
          _atencao := 'O projeto nÃ£o tem conta do Instagram ligada. Ligue a conta na Agenda e agende por lÃ¡.';
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
        _quando := public.mesa_proximo_horario_util(_task.due_date, _hora, _fuso);
        _tipo := CASE WHEN cardinality(_t.file_ids) > 1 THEN 'carousel' ELSE 'static' END;
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
          'Mesa: "' || COALESCE(_task.title, 'post') || '" foi aprovado e entrou na Agenda para '
            || to_char(_quando AT TIME ZONE _fuso, 'DD/MM "Ã s" HH24:MI') || '.',
          'publication',
          '/calendario?client=' || _t.client_id::text || COALESCE('&content=' || _post::text, '')
        );
        _agendados := _agendados + 1;

      ELSIF _atencao IS NULL AND _post IS NOT NULL THEN
        -- Frente EA: a entrega jÃ¡ pÃ´s o post na Agenda. A data que vale Ã© a
        -- da publicaÃ§Ã£o (o dono confirmou na Entrega ou a equipe na Agenda).
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

        -- Conserto 27/09: a peÃ§a entrou na Agenda antes da aprovaÃ§Ã£o, sem as
        -- lÃ¢minas (a Agenda sÃ³ congela arquivo aprovado). Aprovada e com data:
        -- congela as lÃ¢minas na ordem do EstÃºdio e o modo de entrega, pela
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
            RAISE WARNING 'mesa_agendar_aprovados: lÃ¢minas da peÃ§a % nÃ£o congeladas: %', _t.id, SQLERRM;
          END;
        END IF;

        -- "Publicar assim que aprovar" e aprovaÃ§Ã£o alÃ©m da janela de 6 h do
        -- promotor: agenda para o minuto seguinte, pelo mesmo caminho do
        -- promotor (pedido de entrega, selo de aprovaÃ§Ã£o e transiÃ§Ã£o oficial).
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
                 WHEN _t.agenda_sincronizada_em IS NULL AND _quando IS NOT NULL THEN 'Esta arte jÃ¡ estava na Agenda.'
                 WHEN _quando IS NULL THEN 'Aprovado. Confirme a data para agendar.'
                 WHEN _segurada THEN 'Aprovado depois do horÃ¡rio. Escolha uma nova data.'
                 ELSE NULL
               END
         WHERE id = _t.id;


      ELSE
        UPDATE public.estudio_trabalhos
           SET entrega_status = 'precisa_de_atencao', entrega_aviso = _atencao
         WHERE id = _t.id;
        PERFORM public.avisar_equipe(
          'Mesa: "' || COALESCE(_task.title, 'arte aprovada') || '" foi aprovado, mas nÃ£o entrou sozinho na Agenda. ' || _atencao,
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
               entrega_aviso = left('NÃ£o consegui agendar sozinho: ' || SQLERRM, 1000)
         WHERE id = _f.trabalho_id;
        PERFORM public.avisar_equipe(
          'Mesa: uma arte aprovada nÃ£o entrou sozinha na Agenda depois de 5 tentativas. Agende pela Agenda.',
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

CREATE OR REPLACE FUNCTION public.file_approval_avisa_equipe()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _cliente text;
  _arquivo text;
  _aprovou boolean;
  _mesa_cobre boolean := false;
  _comentario text;
  _post uuid;
  _trab record;
  _link text;
BEGIN
  IF NEW.actor_id IS DISTINCT FROM NEW.client_id THEN RETURN NEW; END IF;
  IF NEW.to_status NOT IN ('approved', 'changes_requested', 'rejected') THEN RETURN NEW; END IF;
  _aprovou := NEW.to_status = 'approved';

  BEGIN
    -- A frente EA avisa a peÃ§a da Mesa com mais detalhe (data de publicaÃ§Ã£o,
    -- lÃ¢mina citada). Quando o gatilho dela existe e a peÃ§a Ã© dela, o aviso
    -- genÃ©rico sai de cena. to_jsonb lÃª a coluna nova sem depender dela.
    IF EXISTS (
      SELECT 1 FROM pg_trigger tg
       WHERE tg.tgrelid = 'public.file_approval_events'::regclass
         AND tg.tgname = 'mesa_avisos_da_decisao_trg'
         AND tg.tgenabled <> 'D'
    ) THEN
      SELECT CASE WHEN _aprovou THEN (to_jsonb(t) ->> 'agenda_sincronizada_em') IS NOT NULL ELSE true END
        INTO _mesa_cobre
        FROM public.estudio_trabalhos t
       WHERE t.client_id = NEW.client_id
         AND cardinality(t.file_ids) > 0
         AND t.file_ids[1] = NEW.file_id
       ORDER BY t.criado_em DESC
       LIMIT 1;
    END IF;
    IF COALESCE(_mesa_cobre, false) THEN RETURN NEW; END IF;

    SELECT COALESCE(NULLIF(p.company_name, ''), p.full_name, 'Cliente') INTO _cliente FROM public.profiles p WHERE p.id = NEW.client_id;
    SELECT f.file_name INTO _arquivo FROM public.files f WHERE f.id = NEW.file_id;
    _comentario := left(NULLIF(btrim(COALESCE(NEW.feedback, '')), ''), 200);
    -- 29/09 (dono: "ao clicar no aviso, abrir direto no conteúdo"): o link vai
    -- ao post da Agenda que usa este arquivo; sem post, à peça no Estúdio; sem
    -- nenhum dos dois, às Aprovações do cliente.
    SELECT ep.id INTO _post FROM public.editorial_posts ep
     WHERE ep.client_id = NEW.client_id AND ep.primary_file_id = NEW.file_id
     ORDER BY ep.updated_at DESC LIMIT 1;
    IF _post IS NOT NULL THEN
      _link := '/calendario?client=' || NEW.client_id::text || '&content=' || _post::text;
    ELSE
      SELECT t.id, t.task_id INTO _trab FROM public.estudio_trabalhos t
       WHERE t.client_id = NEW.client_id AND cardinality(t.file_ids) > 0 AND t.file_ids[1] = NEW.file_id
       ORDER BY t.criado_em DESC LIMIT 1;
      IF _trab.id IS NOT NULL AND _trab.task_id IS NOT NULL THEN
        _link := '/mesa?client=' || NEW.client_id::text || '&aba=estudio&task=' || _trab.task_id::text;
      ELSE
        _link := '/aprovacoes?client=' || NEW.client_id::text;
      END IF;
    END IF;
    IF _aprovou THEN
      PERFORM public.avisar_equipe_do_cliente(NEW.client_id,
        'AprovaÃ§Ã£o recebida: ' || COALESCE(_cliente, 'Cliente') || ' aprovou "' || COALESCE(_arquivo, 'material') || '". Pronto para agendar na Agenda.'
          || COALESCE(' ComentÃ¡rio: "' || _comentario || '"', ''),
        'approval', _link);
    ELSE
      PERFORM public.avisar_equipe_do_cliente(NEW.client_id,
        'Ajustes solicitados: ' || COALESCE(_cliente, 'Cliente') || ' pediu mudanÃ§as em "' || COALESCE(_arquivo, 'material') || '".',
        'approval', _link);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'file_approval_avisa_equipe: %', SQLERRM;
  END;
  RETURN NEW;
END;
$function$;
