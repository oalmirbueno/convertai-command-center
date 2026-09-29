-- ═══════════════════════════════════════════════════════════════════════
-- EN-01 · ADMIN APROVA PELO CLIENTE (frente EN, 28/09). NÃO APLICADO.
--
-- Pedido do dono (28/09): "o cliente está ocupado e pede para eu aprovar.
-- Então eu entro e aprovo todos, valendo pelo cliente e por mim. Tem que me
-- dar liberdade, pro admin." E, no Estúdio, "Disponibilizar ao cliente,
-- pronto para agendar": não precisa de aprovação, o cliente já deu o aval.
--
-- Este arquivo só amplia e é idempotente (pode rodar de novo):
--   1) public.aprovar_pelo_cliente(file, nota): numa transação só, registra
--      a revisão da agência (pelas RPCs oficiais), a liberação para aprovação
--      e o aceite do cliente dado ao admin (client_approved_offline, canal
--      'equipe', nota "aval do cliente ao admin"). Só admin e gestor (manager)
--      com acesso ao cliente. As travas de sempre continuam: reprovado é
--      final, arquivo arquivado ou fora do ar não passa, versão travada não
--      muda. O cliente recebe UM aviso ("aprovado por <nome> em seu nome"),
--      nunca o "aguardando sua aprovação" de um pedido que não existiu;
--   2) mesa_avisos_da_decisao (frente AP) diz a verdade quando a equipe
--      aprovou pelo cliente: "<nome> aprovou "<post>" em nome do cliente".
--      Um fato, um aviso: o mesmo aviso de sempre, só com o sujeito certo;
--   3) app_private.movimentos_do_cliente_bruto (histórico do portal e do
--      dossiê) mostra o aceite registrado pela equipe: "Aprovado por <nome>
--      em nome do cliente". O "chegou para sua aprovação" desse mesmo
--      aceite não aparece (o cliente nunca teve o pedido aberto).
--
-- RLS e can_access_client não mudam. Nenhum EXECUTE novo para anon.
-- record_offline_client_approval (canal grupo/whatsapp/…) segue igual.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1) Aprovar pelo cliente ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.aprovar_pelo_cliente(
  p_file_id uuid,
  p_nota text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _actor uuid := auth.uid();
  _file public.files%ROWTYPE;
  _nome text;
  _nota text := left(COALESCE(NULLIF(btrim(p_nota), ''), 'aval do cliente ao admin'), 500);
  _evento uuid;
BEGIN
  -- Só admin e gestor aprovam pelo cliente (design e tráfego não).
  IF _actor IS NULL
    OR NOT (
      public.has_role(_actor, 'admin'::public.app_role)
      OR public.has_role(_actor, 'manager'::public.app_role)
    ) THEN
    RAISE EXCEPTION 'só admin ou gestor aprova pelo cliente' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _file
    FROM public.files
   WHERE id = p_file_id
     AND parent_file_id IS NULL
   FOR UPDATE;
  IF NOT FOUND OR NOT public.can_access_client(_file.client_id) THEN
    RAISE EXCEPTION 'arquivo não encontrado ou sem acesso a este cliente' USING ERRCODE = '42501';
  END IF;

  -- Já decidido: nada a fazer (sem erro na cara do admin).
  IF _file.approval_status = 'approved' THEN
    RETURN jsonb_build_object('file_id', _file.id, 'estado', 'ja_aprovado');
  END IF;
  -- Disponibilizado ao cliente = aprovado pela regra da casa (e travado).
  IF _file.visibility = 'client_shared' AND _file.agency_approval_status = 'approved' THEN
    RETURN jsonb_build_object('file_id', _file.id, 'estado', 'disponivel');
  END IF;

  IF _file.approval_status = 'rejected' OR _file.agency_approval_status = 'rejected' THEN
    RAISE EXCEPTION 'este material foi reprovado e a decisão é final; entregue uma nova versão';
  END IF;
  IF _file.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'o material está arquivado; desarquive antes de aprovar';
  END IF;
  IF COALESCE(_file.status, 'ready') <> 'ready' THEN
    RAISE EXCEPTION 'o material ainda não está pronto em Arquivos';
  END IF;
  IF _file.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'terminal file versions are immutable';
  END IF;

  -- Revisão da agência e liberação, pelas mesmas regras das RPCs oficiais.
  IF _file.visibility = 'internal' THEN
    IF _file.agency_approval_status = 'not_requested' THEN
      PERFORM public.request_file_agency_review(p_file_id);
    END IF;
    SELECT * INTO _file FROM public.files WHERE id = p_file_id;
    IF _file.agency_approval_status <> 'approved' THEN
      PERFORM public.review_file_agency(p_file_id, 'approved', NULL);
    END IF;
    SELECT * INTO _file FROM public.files WHERE id = p_file_id;
    IF _file.agency_approval_status <> 'approved' THEN
      RAISE EXCEPTION 'a revisão da agência não concluiu (estado: %)', _file.agency_approval_status;
    END IF;

    -- Liberação para aprovação igual à de release_file_to_client, sem o aviso
    -- "aguardando sua aprovação": o aceite vem logo abaixo, na mesma transação.
    UPDATE public.files
       SET visibility = 'approval', requires_approval = true, approval_status = 'none',
           feedback = NULL, client_decided_by = NULL, client_decided_at = NULL,
           approval_requested_at = now(), locked_at = NULL
     WHERE parent_file_id = p_file_id;
    UPDATE public.files
       SET visibility = 'approval', requires_approval = true, approval_status = 'pending',
           feedback = NULL, client_decided_by = NULL, client_decided_at = NULL,
           approval_requested_at = now(), locked_at = NULL
     WHERE id = p_file_id;
    INSERT INTO public.file_approval_events (
      file_id, client_id, actor_id, event_type, from_status, to_status, metadata
    ) VALUES (
      _file.id, _file.client_id, _actor, 'released_for_approval', 'internal', 'approval',
      jsonb_build_object('version', COALESCE(_file.version, 1), 'on_behalf_of_client', true)
    );
    SELECT * INTO _file FROM public.files WHERE id = p_file_id;
  END IF;

  -- Mesmas condições da aprovação feita pelo cliente.
  IF _file.agency_approval_status <> 'approved'
    OR _file.visibility <> 'approval'
    OR _file.approval_status <> 'pending'
    OR _file.locked_at IS NOT NULL
    OR _file.archived_at IS NOT NULL
    OR COALESCE(_file.status, 'ready') <> 'ready' THEN
    RAISE EXCEPTION 'file is not awaiting a client decision';
  END IF;

  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(split_part(COALESCE(p.email, ''), '@', 1), ''), 'a equipe')
    INTO _nome
    FROM public.profiles p
   WHERE p.id = _actor;
  _nome := COALESCE(_nome, 'a equipe');

  UPDATE public.files
     SET approval_status = 'none', client_decided_by = NULL, client_decided_at = NULL, locked_at = now()
   WHERE parent_file_id = p_file_id;
  -- A decisão fica no nome do cliente (ele deu o aval); quem registrou fica no evento.
  UPDATE public.files
     SET approval_status = 'approved', feedback = NULL,
         client_decided_by = _file.client_id, client_decided_at = now(), locked_at = now()
   WHERE id = p_file_id;

  -- A nota vai no metadata (não em feedback): feedback é a voz do cliente e a
  -- Mesa leria como comentário dele.
  INSERT INTO public.file_approval_events (
    file_id, client_id, actor_id, event_type, from_status, to_status, feedback, metadata
  ) VALUES (
    _file.id, _file.client_id, _actor, 'client_approved_offline', 'pending', 'approved', NULL,
    jsonb_build_object(
      'version', COALESCE(_file.version, 1),
      'channel', 'equipe',
      'registered_by_staff', true,
      'on_behalf_of_client', true,
      'approved_by_name', _nome,
      'note', _nota
    )
  )
  RETURNING id INTO _evento;

  -- Um aviso ao cliente, com quem aprovou por ele.
  INSERT INTO public.notifications (user_id, message, notification_type, link)
  VALUES (
    _file.client_id,
    left('Aprovado por ' || _nome || ' em seu nome: ' || COALESCE(_file.file_name, 'material'), 500),
    'delivery',
    '/documentos'
  );

  RETURN jsonb_build_object('file_id', _file.id, 'estado', 'aprovado', 'evento_id', _evento, 'aprovado_por', _nome);
END;
$$;

REVOKE ALL ON FUNCTION public.aprovar_pelo_cliente(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aprovar_pelo_cliente(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.aprovar_pelo_cliente(uuid, text) IS
  'Frente EN (28/09): admin ou gestor aprova pelo cliente (revisão da agência, liberação e aceite do cliente dado ao admin, canal equipe) numa transação.';

-- ─── 2) Aviso da Mesa com o sujeito certo ───────────────────────────────
-- Mesma função viva da frente AP (20260928060000); muda só o sujeito da
-- frase quando o aceite foi registrado pela equipe em nome do cliente.

CREATE OR REPLACE FUNCTION public.mesa_avisos_da_decisao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _t_id uuid;
  _t_client uuid;
  _t_task uuid;
  _t_post uuid;
  _t_sincronizada timestamptz;
  _t_ao_aprovar boolean;
  _t_rodada integer;
  _titulo text;
  _quando timestamptz;
  _pub_id uuid;
  _lamina integer;
  _texto text;
  _msg text;
  _link text;
  _agendado boolean := false;
  _aprovou text;
BEGIN
  IF NEW.event_type NOT IN ('client_approved', 'client_approved_offline', 'client_rejected') THEN
    RETURN NEW;
  END IF;
  BEGIN
    SELECT t.id, t.client_id, t.task_id, t.post_id, t.agenda_sincronizada_em, t.publicar_ao_aprovar, t.entrega_rodada
      INTO _t_id, _t_client, _t_task, _t_post, _t_sincronizada, _t_ao_aprovar, _t_rodada
      FROM public.estudio_trabalhos t
     WHERE t.client_id = NEW.client_id
       AND cardinality(t.file_ids) > 0
       AND t.file_ids[1] = NEW.file_id
     ORDER BY t.criado_em DESC
     LIMIT 1;
    IF _t_id IS NULL THEN
      RETURN NEW;
    END IF;
    SELECT NULLIF(btrim(title), '') INTO _titulo FROM public.tasks WHERE id = _t_task;
    _titulo := COALESCE(_titulo, 'post');
    _texto := left(NULLIF(btrim(COALESCE(NEW.feedback, '')), ''), 1000);
    _lamina := public.mesa_lamina_citada(_texto);
    -- Frente EN: aceite registrado pela equipe em nome do cliente.
    _aprovou := CASE
      WHEN NEW.event_type = 'client_approved_offline' AND COALESCE(NEW.metadata ->> 'channel', '') = 'equipe'
        THEN COALESCE(NULLIF(btrim(NEW.metadata ->> 'approved_by_name'), ''), 'a equipe') || ' aprovou "' || _titulo || '" em nome do cliente'
      ELSE 'o cliente aprovou "' || _titulo || '"'
    END;

    -- O que o cliente escreveu fica na peça (pedido de ajuste ou comentário
    -- da aprovação). A função estudio-arte entende (Jev) e grava ao lado.
    IF _texto IS NOT NULL THEN
      UPDATE public.estudio_trabalhos
         SET ajustes_do_cliente = COALESCE(ajustes_do_cliente, '[]'::jsonb) || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
               'evento_id', NEW.id,
               'texto', _texto,
               'lamina', _lamina,
               'pedido_em', NEW.created_at,
               'file_id', NEW.file_id,
               'post_id', _t_post,
               'rodada', COALESCE(_t_rodada, 1),
               'decisao', CASE WHEN NEW.event_type = 'client_rejected' THEN 'ajuste' ELSE 'aprovado' END
             )))
       WHERE id = _t_id
         AND NOT (COALESCE(ajustes_do_cliente, '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('evento_id', NEW.id)));
    END IF;

    IF NEW.event_type = 'client_rejected' THEN
      PERFORM public.mesa_avisar_peca(
        _t_id,
        'ajuste:' || NEW.id::text,
        'approval',
        'Mesa: o cliente pediu ajuste em "' || _titulo || '"'
          || COALESCE(' (lâmina ' || _lamina::text || ')', '')
          || COALESCE(': ' || left(_texto, 300), '.'),
        '/mesa?client=' || _t_client::text || '&aba=estudio&task=' || _t_task::text || '&ajuste=cliente'
          || COALESCE('&lamina=' || _lamina::text, '')
      );
    ELSIF _t_sincronizada IS NOT NULL THEN
      SELECT pub.id, pub.scheduled_at INTO _pub_id, _quando
        FROM public.editorial_publications pub
       WHERE pub.post_id = _t_post AND pub.status IN ('planned', 'scheduled')
       ORDER BY (pub.platform = 'instagram') DESC
       LIMIT 1;
      _link := '/calendario?client=' || _t_client::text || COALESCE('&content=' || _t_post::text, '');
      IF _quando IS NULL THEN
        _msg := 'Mesa: ' || _aprovou || '; falta a data. Escolha a data, o perfil e se vai postar.';
        _link := '/mesa?client=' || _t_client::text || '&aba=estudio&task=' || _t_task::text || '&publicar=' || _t_id::text;
      ELSIF NOT COALESCE(_t_ao_aprovar, false) AND NEW.created_at > _quando + interval '5 minutes' THEN
        _msg := 'Mesa: ' || _aprovou || ' depois do horário. Escolha uma nova data.';
        _link := '/mesa?client=' || _t_client::text || '&aba=estudio&task=' || _t_task::text || '&publicar=' || _t_id::text;
      ELSE
        _msg := 'Mesa: ' || _aprovou || '. Agendado para '
          || to_char(greatest(_quando, NEW.created_at) AT TIME ZONE 'America/Sao_Paulo', 'DD/MM "às" HH24:MI') || '.';
        _agendado := _quando >= NEW.created_at;
      END IF;
      IF _texto IS NOT NULL THEN
        _msg := _msg || ' Comentário: "' || left(_texto, 200) || '"';
      END IF;
      PERFORM public.mesa_avisar_peca(_t_id, 'aprovado:' || NEW.id::text, 'approval', _msg, _link);
      -- Um fato, um aviso: o "agendado para" desta mesma data já foi dito aqui.
      IF _agendado AND _pub_id IS NOT NULL THEN
        INSERT INTO public.mesa_avisos_da_peca (chave, trabalho_id, tipo)
        VALUES (left('agendado:' || _pub_id::text || ':' || floor(extract(epoch FROM _quando))::bigint::text, 300), _t_id, 'publication')
        ON CONFLICT (chave) DO NOTHING;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'mesa_avisos_da_decisao: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_avisos_da_decisao() FROM PUBLIC, anon, authenticated;

-- ─── 3) Histórico do cliente: "Aprovado por <nome> em nome do cliente" ──
-- Mesma função viva (20260925235814); entram o aceite registrado pela equipe
-- e o metadata do evento. O resto não muda.

CREATE OR REPLACE FUNCTION app_private.movimentos_do_cliente_bruto(_client_id uuid, _desde timestamp with time zone DEFAULT (now() - '30 days'::interval), _ate timestamp with time zone DEFAULT now(), _somente_visiveis boolean DEFAULT false)
 RETURNS TABLE(quando timestamp with time zone, tipo text, titulo text, titulo_cliente text, detalhe text, visivel_ao_cliente boolean, origem text, ref_id uuid, link text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    SELECT ev.file_id, ev.event_type, ev.created_at, ev.feedback, ev.metadata,
           CASE
             WHEN ev.event_type = 'client_approved_offline' AND COALESCE(ev.metadata->>'channel', '') = 'equipe'
               THEN 'Aprovado por ' || COALESCE(NULLIF(btrim(ev.metadata->>'approved_by_name'), ''), 'a equipe') || ' em nome do cliente: '
             WHEN ev.event_type = 'client_approved_offline'
               THEN 'Cliente aprovou (registrado pela equipe): '
             ELSE NULL
           END AS offline_rotulo
      FROM public.file_approval_events ev
     WHERE ev.client_id = _client_id
       AND ev.event_type IN ('released_for_approval', 'released_client_shared', 'client_approved', 'client_rejected', 'client_approved_offline')
       -- O pedido de aprovação aberto e fechado pela equipe na mesma hora não é um fato para o cliente.
       AND NOT (ev.event_type = 'released_for_approval' AND COALESCE(ev.metadata->>'on_behalf_of_client', '') = 'true')
       AND ev.created_at >= _desde AND ev.created_at <= _ate
  ),
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
             WHEN 'client_approved_offline' THEN 'aprovado'
             WHEN 'client_rejected' THEN 'ajustes_pedidos'
             ELSE ev.event_type END,
           CASE ev.event_type
             WHEN 'released_for_approval' THEN 'Enviado para aprovação do cliente: ' || c.rotulo || ' "' || c.nome || '"'
             WHEN 'released_client_shared' THEN 'Compartilhado com o cliente: ' || c.rotulo || ' "' || c.nome || '"'
             WHEN 'client_approved' THEN 'Cliente aprovou: ' || c.rotulo || ' "' || c.nome || '"'
             WHEN 'client_approved_offline' THEN ev.offline_rotulo || c.rotulo || ' "' || c.nome || '"'
             WHEN 'client_rejected' THEN 'Cliente pediu ajustes: ' || c.rotulo || ' "' || c.nome || '"'
             ELSE ev.event_type || ': ' || c.rotulo || ' "' || c.nome || '"' END
             || CASE WHEN c.n_laminas > 1 THEN ' (' || c.n_laminas || ' lâminas)' ELSE '' END,
           CASE ev.event_type
             WHEN 'released_for_approval' THEN 'Chegou para sua aprovação: ' || c.rotulo || ' "' || c.nome || '"'
             WHEN 'released_client_shared' THEN 'Material compartilhado com você: ' || c.rotulo || ' "' || c.nome || '"'
             WHEN 'client_approved' THEN 'Você aprovou: ' || c.rotulo || ' "' || c.nome || '"'
             WHEN 'client_approved_offline' THEN ev.offline_rotulo || c.rotulo || ' "' || c.nome || '"'
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
$function$;

-- ─── Conferência (rodar depois de aplicar, só leitura) ───────────────────
-- select has_function_privilege('authenticated', 'public.aprovar_pelo_cliente(uuid, text)', 'execute') as equipe_executa,
--        has_function_privilege('anon', 'public.aprovar_pelo_cliente(uuid, text)', 'execute') as anon_executa; -- true, false
-- select position('em nome do cliente' in pg_get_functiondef('public.mesa_avisos_da_decisao()'::regprocedure)) > 0 as aviso_novo;
-- select position('client_approved_offline' in pg_get_functiondef('app_private.movimentos_do_cliente_bruto(uuid, timestamptz, timestamptz, boolean)'::regprocedure)) > 0 as historico_novo;
--
-- ─── Para desfazer ───────────────────────────────────────────────────────
--   drop function public.aprovar_pelo_cliente(uuid, text);
--   (e reaplicar mesa_avisos_da_decisao de 20260928060000 e
--    movimentos_do_cliente_bruto de 20260925235814, se quiser o texto antigo)
