-- O dossiê acompanha o movimento SEM travar quem está trabalhando (2026-09-21).
--
-- O que quebrou: ao agendar um post no calendário, "canceling statement due
-- to statement timeout". Causa: o gatilho reescrevia o dossiê dentro da
-- própria transação de quem agendava, e o cron de 15 minutos reescrevia os
-- 19 dossiês numa transação só, segurando o lock de cada cliente por até
-- 22 s. Quem agendava esperava o lock e estourava os 8 s do painel.
--
-- Agora:
-- 1) Gatilho só ENFILEIRA o cliente (microssegundos, sem lock de dossiê).
-- 2) Um cron por minuto processa a fila, poucos clientes por vez, cada um
--    com lock curto, e só depois de 90 s sem movimento novo (upload de 6
--    lâminas + liberação viram UMA versão do dossiê, não sete).
-- 3) A leitura de movimentos calcula rótulo só dos arquivos do período, com
--    índices para as tabelas que não tinham.
-- 4) "O que é aquele arquivo" ganha um julgamento tipado (TypeSafe/Jev) em
--    segundo plano, que grava files.file_type quando a confiança passa do
--    corte. Ver supabase/functions/materiais-classificar.

-- 1) Fila -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_private.dossie_fila (
  client_id uuid PRIMARY KEY,
  pedido_em timestamptz NOT NULL DEFAULT now(),
  primeiro_pedido_em timestamptz NOT NULL DEFAULT now(),
  motivo text,
  tentativas integer NOT NULL DEFAULT 0,
  ultimo_erro text
);

CREATE OR REPLACE FUNCTION public.dossie_enfileirar(_client_id uuid, _motivo text DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $$
  INSERT INTO app_private.dossie_fila (client_id, motivo)
  VALUES (_client_id, _motivo)
  ON CONFLICT (client_id) DO UPDATE
    SET pedido_em = now(),
        motivo = coalesce(EXCLUDED.motivo, app_private.dossie_fila.motivo);
$$;
REVOKE ALL ON FUNCTION public.dossie_enfileirar(uuid, text) FROM PUBLIC, anon, authenticated;

-- 2) Gatilhos só enfileiram ----------------------------------------------
CREATE OR REPLACE FUNCTION public.movimento_atualiza_dossie()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _client uuid; _vale boolean := false;
BEGIN
  IF TG_TABLE_NAME = 'file_approval_events' THEN
    _client := NEW.client_id;
    _vale := NEW.event_type IN ('released_for_approval', 'released_client_shared', 'client_approved', 'client_rejected');
  ELSIF TG_TABLE_NAME = 'editorial_events' THEN
    _client := NEW.client_id;
    _vale := NEW.event_type IN ('publication_scheduled', 'publication_rescheduled', 'publication_published', 'publication_cancelled');
  ELSIF TG_TABLE_NAME = 'client_requests' THEN
    _client := NEW.client_id; _vale := TG_OP = 'INSERT';
  ELSIF TG_TABLE_NAME = 'files' THEN
    _client := NEW.client_id; _vale := NEW.parent_file_id IS NULL;
  ELSIF TG_TABLE_NAME = 'milestones' THEN
    SELECT p.client_id INTO _client FROM public.projects p WHERE p.id = NEW.project_id;
    _vale := NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed');
  END IF;
  IF _client IS NULL OR NOT _vale THEN RETURN NEW; END IF;
  BEGIN
    PERFORM public.dossie_enfileirar(_client, TG_TABLE_NAME);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'movimento_atualiza_dossie(%): %', _client, SQLERRM;
  END;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS movimento_atualiza_dossie ON public.files;
CREATE TRIGGER movimento_atualiza_dossie AFTER INSERT ON public.files
  FOR EACH ROW EXECUTE FUNCTION public.movimento_atualiza_dossie();

-- Tarefa concluída também só enfileira (antes reescrevia o dossiê na hora).
CREATE OR REPLACE FUNCTION public.tasks_acao_feita_no_dossie()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _client uuid;
  _projeto text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'done' OR OLD.status IS NOT DISTINCT FROM 'done' THEN
    RETURN NEW;
  END IF;
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  SELECT p.client_id, p.name INTO _client, _projeto FROM public.projects p WHERE p.id = NEW.project_id;
  IF _client IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM public.project_memory m
     WHERE m.client_id = _client AND m.kind = 'acao'
       AND m.metadata->>'task_id' = NEW.id::text
       AND m.created_at > now() - interval '24 hours'
  ) THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.project_memory (client_id, project_id, kind, source, title, content, tags, metadata, created_by)
  VALUES (
    _client, NEW.project_id, 'acao', 'ciclo',
    left('Feito · ' || COALESCE(NULLIF(btrim(NEW.title), ''), 'tarefa'), 200),
    left(concat_ws(' · ',
      'Tarefa concluída' || CASE WHEN _projeto IS NOT NULL THEN ' em ' || _projeto ELSE '' END,
      NULLIF(btrim(COALESCE(NEW.description, '')), '')
    ), 8000),
    ARRAY['acao', 'tarefa'],
    jsonb_build_object('task_id', NEW.id, 'auto', true, 'client_visible', false, 'source_task', NEW.source, 'assigned_to', NEW.assigned_to),
    COALESCE(auth.uid(), NEW.assigned_to)
  );
  BEGIN
    PERFORM public.dossie_enfileirar(_client, 'tasks');
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'dossie_enfileirar falhou para %: %', _client, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- 3) Processador da fila: poucos por vez, lock curto, só depois de aquietar --
CREATE OR REPLACE FUNCTION public.dossie_processar_fila(_max integer DEFAULT 5, _quieto interval DEFAULT interval '90 seconds')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _c record; _n integer := 0;
BEGIN
  FOR _c IN
    SELECT f.client_id FROM app_private.dossie_fila f
     WHERE f.pedido_em <= now() - _quieto AND f.tentativas < 5
     ORDER BY f.pedido_em
     LIMIT greatest(1, _max)
     FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      PERFORM public.dossie_registrar_avancos_interno(_c.client_id);
      DELETE FROM app_private.dossie_fila WHERE client_id = _c.client_id;
      _n := _n + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE app_private.dossie_fila
         SET tentativas = tentativas + 1, ultimo_erro = left(SQLERRM, 300), pedido_em = now()
       WHERE client_id = _c.client_id;
      RAISE WARNING 'dossie_processar_fila(%): %', _c.client_id, SQLERRM;
    END;
  END LOOP;
  RETURN _n;
END; $$;
REVOKE ALL ON FUNCTION public.dossie_processar_fila(integer, interval) FROM PUBLIC, anon, authenticated;

-- A varredura geral (cron de sexta e ferramentas) passa a só enfileirar.
CREATE OR REPLACE FUNCTION public.dossie_registrar_avancos_todos()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _c record; _n integer := 0;
BEGIN
  FOR _c IN SELECT DISTINCT d.client_id FROM public.client_dossiers d JOIN public.profiles p ON p.id = d.client_id AND p.deleted_at IS NULL
            WHERE d.is_current AND d.dossier_type = 'contexto' AND d.project_id IS NULL LOOP
    PERFORM public.dossie_enfileirar(_c.client_id, 'varredura');
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END; $$;

-- 4) Leitura de movimentos: rótulo só dos arquivos do período + índices ------
CREATE INDEX IF NOT EXISTS file_approval_events_client_created_idx ON public.file_approval_events (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS client_requests_client_created_idx ON public.client_requests (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tasks_project_status_idx ON public.tasks (project_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS files_client_capa_created_idx ON public.files (client_id, created_at DESC) WHERE parent_file_id IS NULL AND archived_at IS NULL;

CREATE OR REPLACE FUNCTION public.rotulo_do_material(_file_type text, _folder text DEFAULT NULL, _content_type text DEFAULT NULL)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
  SELECT CASE
    WHEN lower(coalesce(_content_type, '')) IN ('carousel', 'carrossel') THEN 'Carrossel'
    WHEN lower(coalesce(_content_type, '')) IN ('reel', 'reels', 'video') THEN 'Vídeo'
    WHEN lower(coalesce(_content_type, '')) IN ('story', 'stories') THEN 'Story'
    WHEN lower(coalesce(_content_type, '')) IN ('static', 'image', 'post') THEN 'Arte'
    WHEN lower(coalesce(_file_type, '')) LIKE '%carrossel%' OR lower(coalesce(_file_type, '')) LIKE '%carousel%' THEN 'Carrossel'
    WHEN lower(coalesce(_file_type, '')) IN ('post', 'creative', 'criativo', 'static', 'image', 'png', 'visual_asset', 'social_media_asset', 'editable_visual_asset', 'preview', 'preview_social_media') THEN 'Arte'
    WHEN lower(coalesce(_file_type, '')) LIKE 'video%' OR lower(coalesce(_file_type, '')) LIKE '%reel%' THEN 'Vídeo'
    WHEN lower(coalesce(_file_type, '')) LIKE '%story%' THEN 'Story'
    WHEN lower(coalesce(_file_type, '')) = 'foto' OR lower(coalesce(_file_type, '')) LIKE '%photo%' THEN 'Foto'
    WHEN lower(coalesce(_file_type, '')) LIKE '%logo%' OR lower(coalesce(_file_type, '')) LIKE '%brand%' THEN 'Peça de marca'
    WHEN lower(coalesce(_file_type, '')) LIKE '%relat%' OR lower(coalesce(_folder, '')) = 'relatorios' THEN 'Relatório'
    WHEN lower(coalesce(_file_type, '')) LIKE '%contrat%' OR lower(coalesce(_folder, '')) = 'contratos' THEN 'Contrato'
    WHEN lower(coalesce(_file_type, '')) LIKE '%briefing%' THEN 'Briefing'
    WHEN lower(coalesce(_file_type, '')) LIKE '%document%' OR lower(coalesce(_file_type, '')) LIKE '%pdf%' OR lower(coalesce(_file_type, '')) LIKE '%doc%'
      OR lower(coalesce(_file_type, '')) LIKE '%plano%' OR lower(coalesce(_file_type, '')) LIKE '%estrat%'
      OR lower(coalesce(_folder, '')) IN ('estrategicos', 'operacionais') THEN 'Documento'
    ELSE 'Material'
  END
$$;

CREATE OR REPLACE FUNCTION public.movimentos_do_cliente(
  _client_id uuid,
  _desde timestamptz DEFAULT now() - interval '30 days',
  _ate timestamptz DEFAULT now(),
  _somente_visiveis boolean DEFAULT false
)
RETURNS TABLE(
  quando timestamptz,
  tipo text,
  titulo text,
  titulo_cliente text,
  detalhe text,
  visivel_ao_cliente boolean,
  origem text,
  ref_id uuid,
  link text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT app_private.rpc_trusted_backend() THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RPC_AUTH_REQUIRED';
    END IF;
    IF auth.uid() <> _client_id THEN
      PERFORM app_private.require_rpc_client_staff(_client_id);
    END IF;
  END IF;

  RETURN QUERY
  WITH eventos AS (
    SELECT ev.file_id, ev.event_type, ev.created_at, ev.feedback
      FROM public.file_approval_events ev
     WHERE ev.client_id = _client_id
       AND ev.event_type IN ('released_for_approval', 'released_client_shared', 'client_approved', 'client_rejected')
       AND ev.created_at >= _desde AND ev.created_at <= _ate
  ),
  -- Só as capas do período (criadas nele ou citadas em decisão nele): o
  -- rótulo e o nome limpo não são calculados para o acervo inteiro.
  capa_base AS (
    SELECT f.id, f.file_name, f.file_type, f.folder, f.created_at, f.revision_of_file_id, f.caption, f.description
      FROM public.files f
     WHERE f.client_id = _client_id AND f.parent_file_id IS NULL AND f.archived_at IS NULL
       AND ((f.created_at >= _desde AND f.created_at <= _ate) OR f.id IN (SELECT e.file_id FROM eventos e))
  ),
  laminas AS (
    SELECT c.parent_file_id AS file_id, count(*) + 1 AS n
      FROM public.files c
     WHERE c.parent_file_id IN (SELECT b.id FROM capa_base b) AND c.archived_at IS NULL
     GROUP BY c.parent_file_id
  ),
  capa AS (
    SELECT b.*, public.rotulo_do_material(b.file_type, b.folder) AS rotulo,
           public.nome_do_material(b.file_name) AS nome, coalesce(l.n, 1) AS n_laminas
      FROM capa_base b LEFT JOIN laminas l ON l.file_id = b.id
  ),
  todos AS (
    SELECT c.created_at AS quando,
           CASE WHEN c.revision_of_file_id IS NULL THEN 'material_novo' ELSE 'material_revisado' END AS tipo,
           CASE WHEN c.revision_of_file_id IS NULL THEN c.rotulo || ' "' || c.nome || '"' ELSE 'Nova versão de ' || lower(c.rotulo) || ' "' || c.nome || '"' END
             || CASE WHEN c.n_laminas > 1 THEN ' (' || c.n_laminas || ' lâminas)' ELSE '' END
             || ' entrou nos arquivos' AS titulo,
           NULL::text AS titulo_cliente,
           concat_ws(' · ', 'Pasta ' || coalesce(c.folder, 'materiais'), NULLIF(left(btrim(coalesce(c.description, c.caption, '')), 160), '')) AS detalhe,
           false AS visivel_ao_cliente, 'files' AS origem, c.id AS ref_id, NULL::text AS link
      FROM capa c
     WHERE c.created_at >= _desde AND c.created_at <= _ate

    UNION ALL
    SELECT ev.created_at,
           CASE ev.event_type
             WHEN 'released_for_approval' THEN 'aprovacao_pedida'
             WHEN 'released_client_shared' THEN 'compartilhado'
             WHEN 'client_approved' THEN 'aprovado'
             WHEN 'client_rejected' THEN 'ajustes_pedidos'
             ELSE ev.event_type END,
           CASE ev.event_type
             WHEN 'released_for_approval' THEN 'Enviado para aprovação do cliente: ' || c.rotulo || ' "' || c.nome || '"'
             WHEN 'released_client_shared' THEN 'Compartilhado com o cliente: ' || c.rotulo || ' "' || c.nome || '"'
             WHEN 'client_approved' THEN 'Cliente aprovou: ' || c.rotulo || ' "' || c.nome || '"'
             WHEN 'client_rejected' THEN 'Cliente pediu ajustes: ' || c.rotulo || ' "' || c.nome || '"'
             ELSE ev.event_type || ': ' || c.rotulo || ' "' || c.nome || '"' END
             || CASE WHEN c.n_laminas > 1 THEN ' (' || c.n_laminas || ' lâminas)' ELSE '' END,
           CASE ev.event_type
             WHEN 'released_for_approval' THEN 'Chegou para sua aprovação: ' || c.rotulo || ' "' || c.nome || '"'
             WHEN 'released_client_shared' THEN 'Material compartilhado com você: ' || c.rotulo || ' "' || c.nome || '"'
             WHEN 'client_approved' THEN 'Você aprovou: ' || c.rotulo || ' "' || c.nome || '"'
             WHEN 'client_rejected' THEN 'Você pediu ajustes: ' || c.rotulo || ' "' || c.nome || '"'
             ELSE NULL END
             || CASE WHEN c.n_laminas > 1 THEN ' (' || c.n_laminas || ' lâminas)' ELSE '' END,
           NULLIF(left(btrim(coalesce(ev.feedback, '')), 300), ''),
           true,
           'file_approval_events', c.id, NULL::text
      FROM eventos ev
      JOIN capa c ON c.id = ev.file_id

    UNION ALL
    SELECT e.created_at,
           CASE e.event_type
             WHEN 'publication_scheduled' THEN 'agendado'
             WHEN 'publication_rescheduled' THEN 'reagendado'
             WHEN 'publication_published' THEN 'publicado'
             WHEN 'publication_cancelled' THEN 'cancelado'
             WHEN 'publication_failed' THEN 'falha_publicacao'
             ELSE 'calendario' END,
           CASE e.event_type
             WHEN 'publication_scheduled' THEN 'Agendado no calendário: '
             WHEN 'publication_rescheduled' THEN 'Reagendado: '
             WHEN 'publication_published' THEN 'Publicado: '
             WHEN 'publication_cancelled' THEN 'Agendamento cancelado: '
             WHEN 'publication_failed' THEN 'Falha ao publicar: '
             ELSE 'Calendário: ' END
             || public.rotulo_do_material(NULL, NULL, po.content_type) || ' "' || public.nome_do_material(coalesce(po.title, 'publicação')) || '"'
             || CASE WHEN e.event_type IN ('publication_scheduled', 'publication_rescheduled') AND coalesce((e.metadata->>'scheduled_at')::timestamptz, pub.scheduled_at) IS NOT NULL
                     THEN ' para ' || to_char(coalesce((e.metadata->>'scheduled_at')::timestamptz, pub.scheduled_at) AT TIME ZONE 'America/Sao_Paulo', 'DD/MM "às" HH24:MI')
                     ELSE '' END
             || CASE WHEN pub.platform IS NOT NULL THEN ' (' || initcap(pub.platform) || ')' ELSE '' END,
           CASE e.event_type
             WHEN 'publication_scheduled' THEN 'Agendado para publicar: '
             WHEN 'publication_rescheduled' THEN 'Nova data de publicação: '
             WHEN 'publication_published' THEN 'No ar: '
             ELSE NULL END
             || public.rotulo_do_material(NULL, NULL, po.content_type) || ' "' || public.nome_do_material(coalesce(po.title, 'publicação')) || '"'
             || CASE WHEN e.event_type IN ('publication_scheduled', 'publication_rescheduled') AND coalesce((e.metadata->>'scheduled_at')::timestamptz, pub.scheduled_at) IS NOT NULL
                     THEN ' em ' || to_char(coalesce((e.metadata->>'scheduled_at')::timestamptz, pub.scheduled_at) AT TIME ZONE 'America/Sao_Paulo', 'DD/MM "às" HH24:MI')
                     ELSE '' END
             || CASE WHEN pub.platform IS NOT NULL THEN ' (' || initcap(pub.platform) || ')' ELSE '' END,
           NULLIF(left(btrim(coalesce(pub.caption, po.default_caption, '')), 160), ''),
           e.event_type IN ('publication_scheduled', 'publication_rescheduled', 'publication_published'),
           'editorial_events', coalesce(e.publication_id, e.post_id),
           CASE WHEN e.event_type = 'publication_published' THEN coalesce(e.metadata->>'permalink', pub.permalink) END
      FROM public.editorial_events e
      LEFT JOIN public.editorial_publications pub ON pub.id = e.publication_id
      LEFT JOIN public.editorial_posts po ON po.id = coalesce(e.post_id, pub.post_id)
     WHERE e.client_id = _client_id
       AND e.event_type IN ('publication_scheduled', 'publication_rescheduled', 'publication_published', 'publication_cancelled', 'publication_failed')
       AND e.created_at >= _desde AND e.created_at <= _ate

    UNION ALL
    SELECT t.updated_at, 'tarefa_feita',
           'Tarefa concluída: ' || coalesce(NULLIF(btrim(t.title), ''), 'tarefa') || CASE WHEN p.name IS NOT NULL THEN ' (' || p.name || ')' ELSE '' END,
           NULL::text, NULLIF(left(btrim(coalesce(t.description, '')), 160), ''), false, 'tasks', t.id, NULL::text
      FROM public.tasks t
      JOIN public.projects p ON p.id = t.project_id AND p.client_id = _client_id AND p.deleted_at IS NULL
     WHERE t.status = 'done' AND t.deleted_at IS NULL
       AND t.updated_at >= _desde AND t.updated_at <= _ate

    UNION ALL
    SELECT m.updated_at, 'marco',
           'Marco concluído: ' || coalesce(NULLIF(btrim(m.title), ''), 'marco') || CASE WHEN p.name IS NOT NULL THEN ' (' || p.name || ')' ELSE '' END,
           'Etapa concluída: ' || coalesce(NULLIF(btrim(m.title), ''), 'marco'),
           NULLIF(left(btrim(coalesce(m.description, '')), 160), ''), true, 'milestones', m.id, NULL::text
      FROM public.milestones m
      JOIN public.projects p ON p.id = m.project_id AND p.client_id = _client_id AND p.deleted_at IS NULL
     WHERE m.status = 'completed' AND m.deleted_at IS NULL
       AND m.updated_at >= _desde AND m.updated_at <= _ate

    UNION ALL
    SELECT pm.created_at,
           CASE WHEN pm.kind = 'ritual' THEN 'mensagem' ELSE 'acao' END,
           CASE WHEN pm.kind = 'ritual' THEN 'Mensagem enviada ao cliente: ' ELSE 'Ação feita: ' END
             || regexp_replace(coalesce(NULLIF(btrim(pm.title), ''), 'registro'), '^(Feito|Feita|Já tem|Ja tem)\s*·\s*', ''),
           CASE WHEN pm.kind = 'ritual' THEN 'Atualização enviada pela equipe: ' || regexp_replace(coalesce(NULLIF(btrim(pm.title), ''), 'mensagem'), '^(Feito|Feita|Já tem|Ja tem)\s*·\s*', '')
                ELSE 'Feito pela equipe: ' || regexp_replace(coalesce(NULLIF(btrim(pm.title), ''), 'ação'), '^(Feito|Feita|Já tem|Ja tem)\s*·\s*', '') END,
           NULLIF(left(btrim(coalesce(pm.content, '')), 200), ''),
           pm.kind = 'ritual' OR coalesce((pm.metadata->>'client_visible')::boolean, false),
           'project_memory', pm.id, NULL::text
      FROM public.project_memory pm
     WHERE pm.client_id = _client_id
       AND (pm.kind = 'ritual' OR (pm.kind = 'acao' AND pm.metadata->>'task_id' IS NULL) OR (pm.kind = 'ciclo' AND pm.metadata->>'acao' = 'done') OR pm.kind = 'marco')
       AND pm.created_at >= _desde AND pm.created_at <= _ate

    UNION ALL
    SELECT r.created_at, 'pedido',
           'Pedido do cliente: ' || coalesce(NULLIF(btrim(r.title), ''), 'pedido') || ' (' || coalesce(r.status, 'aberto') || ')',
           'Seu pedido registrado: ' || coalesce(NULLIF(btrim(r.title), ''), 'pedido'),
           NULLIF(left(btrim(coalesce(r.description, '')), 160), ''), true, 'client_requests', r.id, NULL::text
      FROM public.client_requests r
     WHERE r.client_id = _client_id
       AND r.created_at >= _desde AND r.created_at <= _ate
  )
  SELECT t.quando, t.tipo, t.titulo, coalesce(t.titulo_cliente, t.titulo), t.detalhe, t.visivel_ao_cliente, t.origem, t.ref_id, t.link
    FROM todos t
   WHERE (NOT _somente_visiveis OR t.visivel_ao_cliente)
   ORDER BY t.quando DESC;
END;
$$;

-- 5) Crons: fila por minuto; o de 15 min sai; a sexta só enfileira; TypeSafe a cada 30 min --
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('dossie-movimentos-15min', 'dossie-fila-1min', 'materiais-classificar-30min');
    PERFORM cron.schedule('dossie-fila-1min', '* * * * *', $cron$select public.dossie_processar_fila(5);$cron$);
    PERFORM cron.schedule('materiais-classificar-30min', '*/30 * * * *', $cron$
      select net.http_post(
        url := 'https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/materiais-classificar',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key'),
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        body := jsonb_build_object('limit', 40)
      );
    $cron$);
  END IF;
END $$;
