-- Frente R (25/09 noite): o histórico do cliente parou de ser lido.
-- A migration 20260925162220_dossie_eventos_das_mesas passou a chamar
-- app_private.movimentos_do_cliente_bruto, que só existiria se a migration de
-- 21/09 (20260921130000) tivesse rodado; ela nunca rodou. Desde 25/09 ~16h toda
-- chamada a movimentos_do_cliente dava erro 42883 (fila do dossiê desistindo,
-- Central e rituais sem linha do tempo). Recria a leitura completa em
-- app_private (corpo de 20260921120000) e devolve à fila quem desistiu.

CREATE OR REPLACE FUNCTION app_private.movimentos_do_cliente_bruto(
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

REVOKE ALL ON FUNCTION app_private.movimentos_do_cliente_bruto(uuid, timestamptz, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.movimentos_do_cliente_bruto(uuid, timestamptz, timestamptz, boolean) TO service_role;

UPDATE app_private.dossie_fila
   SET tentativas = 0, ultimo_erro = NULL, pedido_em = now() - interval '2 minutes'
 WHERE ultimo_erro LIKE '%movimentos_do_cliente_bruto%';
