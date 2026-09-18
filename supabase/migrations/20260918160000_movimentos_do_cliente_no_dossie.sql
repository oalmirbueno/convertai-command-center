-- Todo movimento do cliente entra no dossiê, no histórico e nos rituais,
-- com a data certa (2026-09-18).
--
-- Regra do dono: a Central tem que reconhecer sozinha qualquer movimento
-- (material novo e o que ele é: carrossel, arte, documento; enviado para
-- aprovação; aprovado ou com ajustes; agendado no calendário; publicado;
-- tarefa, marco, pedido, mensagem enviada) e isso tem que aparecer no dossiê
-- e no histórico do cliente com o dia certo, e sair na geração dos rituais.
-- Os movimentos antigos entram também: a leitura é feita direto das tabelas
-- que já guardam tudo, então o passado vem junto sem migração de dados.
--
-- Peças:
-- 1) rotulo_do_material: "Carrossel", "Arte", "Documento", "Vídeo"...
-- 2) movimentos_do_cliente: UMA leitura, normalizada e datada, de todas as
--    fontes. Serve o dossiê (tudo), o histórico do cliente (só o visível a
--    ele, na voz "você") e os rituais.
-- 3) dossie_avancos_texto reescrita: a seção automática do dossiê passa a
--    ser um diário por dia, em vez de listas soltas sem data.
-- 4) O dossiê se atualiza na hora em decisão do cliente, liberação para
--    aprovação, agendamento, publicação, marco e pedido; upload de material
--    (em lote) entra pelo cron de 15 minutos.

-- 1) O que é o material -------------------------------------------------
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
    WHEN lower(coalesce(_file_type, '')) LIKE '%logo%' OR lower(coalesce(_file_type, '')) LIKE '%brand%' THEN 'Peça de marca'
    WHEN lower(coalesce(_file_type, '')) LIKE '%relat%' OR lower(coalesce(_folder, '')) = 'relatorios' THEN 'Relatório'
    WHEN lower(coalesce(_folder, '')) = 'contratos' THEN 'Contrato'
    WHEN lower(coalesce(_file_type, '')) LIKE '%document%' OR lower(coalesce(_file_type, '')) LIKE '%pdf%' OR lower(coalesce(_file_type, '')) LIKE '%doc%'
      OR lower(coalesce(_file_type, '')) LIKE '%briefing%' OR lower(coalesce(_file_type, '')) LIKE '%plano%' OR lower(coalesce(_file_type, '')) LIKE '%estrat%'
      OR lower(coalesce(_folder, '')) IN ('estrategicos', 'operacionais') THEN 'Documento'
    ELSE 'Material'
  END
$$;

-- Nome limpo para gente ler: sem extensão e sem o "(2/4)" das lâminas.
CREATE OR REPLACE FUNCTION public.nome_do_material(_file_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
  SELECT btrim(regexp_replace(regexp_replace(coalesce(_file_name, 'material'), '\s*\(\d+/\d+\)\s*$', ''), '\.(png|jpe?g|webp|gif|pdf|mp4|mov|docx?|pptx?|xlsx?|svg)$', '', 'i'))
$$;

-- 2) Todos os movimentos, datados -----------------------------------------
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
  -- Quem pode ler: o backend, a equipe com acesso ao cliente, ou o próprio cliente.
  IF NOT app_private.rpc_trusted_backend() THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RPC_AUTH_REQUIRED';
    END IF;
    IF auth.uid() <> _client_id THEN
      PERFORM app_private.require_rpc_client_staff(_client_id);
    END IF;
  END IF;

  RETURN QUERY
  WITH laminas AS (
    SELECT c.parent_file_id AS file_id, count(*) + 1 AS n
      FROM public.files c
     WHERE c.client_id = _client_id AND c.parent_file_id IS NOT NULL AND c.archived_at IS NULL
     GROUP BY c.parent_file_id
  ),
  capa AS (
    SELECT f.id, f.file_name, f.file_type, f.folder, f.created_at, f.revision_of_file_id, f.caption, f.description,
           public.rotulo_do_material(f.file_type, f.folder) AS rotulo,
           public.nome_do_material(f.file_name) AS nome,
           coalesce(l.n, 1) AS n_laminas
      FROM public.files f
      LEFT JOIN laminas l ON l.file_id = f.id
     WHERE f.client_id = _client_id AND f.parent_file_id IS NULL AND f.archived_at IS NULL
  ),
  todos AS (
    -- Material novo nos arquivos (interno: o cliente vê quando é liberado).
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
    -- Decisões e liberações registradas na aprovação (a revisão interna
    -- fica de fora: 'enviado para aprovação' já diz que ela passou).
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
           ev.event_type IN ('released_for_approval', 'released_client_shared', 'client_approved', 'client_rejected'),
           'file_approval_events', c.id, NULL::text
      FROM public.file_approval_events ev
      JOIN capa c ON c.id = ev.file_id
     WHERE ev.client_id = _client_id
       AND ev.event_type IN ('released_for_approval', 'released_client_shared', 'client_approved', 'client_rejected')
       AND ev.created_at >= _desde AND ev.created_at <= _ate

    UNION ALL
    -- Calendário: agendado, reagendado, publicado, cancelado, falhou.
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
    -- Tarefas concluídas (interno).
    SELECT t.updated_at, 'tarefa_feita',
           'Tarefa concluída: ' || coalesce(NULLIF(btrim(t.title), ''), 'tarefa') || CASE WHEN p.name IS NOT NULL THEN ' (' || p.name || ')' ELSE '' END,
           NULL::text, NULLIF(left(btrim(coalesce(t.description, '')), 160), ''), false, 'tasks', t.id, NULL::text
      FROM public.tasks t
      JOIN public.projects p ON p.id = t.project_id AND p.client_id = _client_id AND p.deleted_at IS NULL
     WHERE t.status = 'done' AND t.deleted_at IS NULL
       AND t.updated_at >= _desde AND t.updated_at <= _ate

    UNION ALL
    -- Marcos concluídos (o cliente vê).
    SELECT m.updated_at, 'marco',
           'Marco concluído: ' || coalesce(NULLIF(btrim(m.title), ''), 'marco') || CASE WHEN p.name IS NOT NULL THEN ' (' || p.name || ')' ELSE '' END,
           'Etapa concluída: ' || coalesce(NULLIF(btrim(m.title), ''), 'marco'),
           NULLIF(left(btrim(coalesce(m.description, '')), 160), ''), true, 'milestones', m.id, NULL::text
      FROM public.milestones m
      JOIN public.projects p ON p.id = m.project_id AND p.client_id = _client_id AND p.deleted_at IS NULL
     WHERE m.status = 'completed' AND m.deleted_at IS NULL
       AND m.updated_at >= _desde AND m.updated_at <= _ate

    UNION ALL
    -- Diário: mensagens enviadas ao cliente e ações feitas na esteira/ciclo.
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
    -- Pedidos do cliente.
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

REVOKE ALL ON FUNCTION public.movimentos_do_cliente(uuid, timestamptz, timestamptz, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.movimentos_do_cliente(uuid, timestamptz, timestamptz, boolean) TO authenticated, service_role;

-- 3) A seção automática do dossiê vira diário por dia ----------------------
CREATE OR REPLACE FUNCTION public.dossie_avancos_texto(_client_id uuid, _dias integer DEFAULT 14)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH mov AS (
    SELECT m.quando, m.tipo, m.titulo, m.detalhe, m.visivel_ao_cliente, m.link,
           (m.quando AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
           row_number() OVER (ORDER BY m.quando DESC) AS pos
      FROM public.movimentos_do_cliente(_client_id, now() - make_interval(days => _dias), now(), false) m
  ),
  limitado AS (SELECT * FROM mov WHERE pos <= 120),
  dias AS (
    SELECT dia,
           '**' || CASE extract(isodow FROM dia)
             WHEN 1 THEN 'Segunda' WHEN 2 THEN 'Terça' WHEN 3 THEN 'Quarta' WHEN 4 THEN 'Quinta'
             WHEN 5 THEN 'Sexta' WHEN 6 THEN 'Sábado' ELSE 'Domingo' END
           || ', ' || to_char(dia, 'DD/MM') || '**' || E'\n'
           || string_agg(
                '- ' || to_char(quando AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') || ' · ' || titulo
                || CASE WHEN detalhe IS NOT NULL THEN ' — ' || btrim(regexp_replace(detalhe, '\s+', ' ', 'g')) ELSE '' END
                || CASE WHEN link IS NOT NULL THEN ' ' || link ELSE '' END
                || CASE WHEN visivel_ao_cliente THEN '' ELSE ' [interno]' END,
                E'\n' ORDER BY quando DESC) AS bloco
      FROM limitado
     GROUP BY dia
  ),
  agenda AS (
    SELECT e.scheduled_at, coalesce(po.title, 'publicação') AS title, po.content_type, e.platform
      FROM public.editorial_publications e
      LEFT JOIN public.editorial_posts po ON po.id = e.post_id
     WHERE e.client_id = _client_id AND e.status = 'scheduled' AND e.scheduled_at > now()
     ORDER BY e.scheduled_at
     LIMIT 12
  ),
  aguardando AS (
    SELECT public.rotulo_do_material(f.file_type, f.folder) || ' "' || public.nome_do_material(f.file_name) || '"' AS item, f.approval_requested_at
      FROM public.files f
     WHERE f.client_id = _client_id AND f.parent_file_id IS NULL AND f.archived_at IS NULL
       AND f.approval_status = 'pending' AND f.visibility = 'approval'
     ORDER BY f.approval_requested_at DESC NULLS LAST
     LIMIT 12
  )
  SELECT concat_ws(E'\n',
    '## Avanços recentes (automático, ' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') || ')',
    'Registro gerado pelo painel a partir do que aconteceu nos últimos ' || _dias || ' dias, dia a dia. Não edite esta seção: ela é reescrita. Itens marcados [interno] não aparecem para o cliente.',
    CASE WHEN EXISTS (SELECT 1 FROM dias) THEN E'\n' || (SELECT string_agg(bloco, E'\n\n' ORDER BY dia DESC) FROM dias)
         ELSE E'\nSem movimentos registrados no período.' END,
    CASE WHEN (SELECT count(*) FROM mov) > 120 THEN '(+' || ((SELECT count(*) FROM mov) - 120) || ' movimentos anteriores no histórico completo.)' END,
    CASE WHEN EXISTS (SELECT 1 FROM aguardando) THEN
      E'\n**Aguardando aprovação do cliente:** ' || (SELECT string_agg(item || CASE WHEN approval_requested_at IS NOT NULL THEN ' (desde ' || to_char(approval_requested_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM') || ')' ELSE '' END, '; ') FROM aguardando) END,
    E'\n**Agenda à frente:** ' || CASE WHEN EXISTS (SELECT 1 FROM agenda)
      THEN (SELECT string_agg(public.rotulo_do_material(NULL, NULL, content_type) || ' "' || public.nome_do_material(title) || '" ' || to_char(scheduled_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') || CASE WHEN platform IS NOT NULL THEN ' (' || initcap(platform) || ')' ELSE '' END, '; ' ORDER BY scheduled_at) FROM agenda)
      ELSE 'nada agendado.' END
  );
$$;

-- A versão de 14 dias cobre a semana inteira do ritual de sexta e a anterior.
CREATE OR REPLACE FUNCTION public.dossie_registrar_avancos_interno(_client_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  _atual public.client_dossiers%rowtype;
  _marcador constant text := '## Avanços recentes (automático';
  _humano text; _secao text; _novo text; _pos integer;
BEGIN
  select * into _atual from public.client_dossiers d
    where d.client_id = _client_id and d.dossier_type = 'contexto' and d.project_id is null and d.is_current limit 1;
  if not found then return false; end if;
  _secao := public.dossie_avancos_texto(_client_id, 14);
  _pos := position(_marcador in _atual.content);
  _humano := case when _pos > 0 then rtrim(left(_atual.content, _pos - 1)) else rtrim(_atual.content) end;
  if _pos > 0 and trim(substr(_atual.content, _pos)) = trim(_secao) then return false; end if;
  _novo := _humano || E'\n\n' || _secao;
  perform public.upsert_current_dossier(
    _client_id := _client_id, _content := _novo, _dossier_type := 'contexto', _project_id := null,
    _summary := _atual.summary, _change_reason := 'Movimentos automáticos do painel (14 dias)',
    _source := 'painel', _actor := 'ciclo', _tags := array['avancos-automaticos'],
    _metadata := coalesce(_atual.metadata, '{}'::jsonb) || jsonb_build_object('auto_avancos', true, 'auto_avancos_em', now()),
    _expected_version := _atual.version);
  return true;
end; $$;
REVOKE ALL ON FUNCTION public.dossie_registrar_avancos_interno(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.dossie_registrar_avancos(_client_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- rpc-caller-boundary-20260912
  PERFORM app_private.require_rpc_client_staff(_client_id);
  RETURN public.dossie_registrar_avancos_interno(_client_id);
END; $$;

CREATE OR REPLACE FUNCTION public.dossie_registrar_avancos_todos()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare _c record; _n integer := 0;
begin
  for _c in select distinct d.client_id from public.client_dossiers d join public.profiles p on p.id = d.client_id and p.deleted_at is null
            where d.is_current and d.dossier_type = 'contexto' and d.project_id is null loop
    begin
      if public.dossie_registrar_avancos_interno(_c.client_id) then _n := _n + 1; end if;
    exception when others then raise warning 'dossie_registrar_avancos(%): %', _c.client_id, sqlerrm; end;
  end loop;
  return _n;
end; $$;

-- 4) O dossiê acompanha o movimento na hora -------------------------------
-- Roda dentro da transação de quem fez o movimento (inclusive o cliente
-- aprovando), por isso usa a versão interna, sem exigir equipe.
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
  ELSIF TG_TABLE_NAME = 'milestones' THEN
    SELECT p.client_id INTO _client FROM public.projects p WHERE p.id = NEW.project_id;
    _vale := NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed');
  END IF;
  IF _client IS NULL OR NOT _vale THEN RETURN NEW; END IF;
  BEGIN
    PERFORM public.dossie_registrar_avancos_interno(_client);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'movimento_atualiza_dossie(%): %', _client, SQLERRM;
  END;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS movimento_atualiza_dossie ON public.file_approval_events;
CREATE TRIGGER movimento_atualiza_dossie AFTER INSERT ON public.file_approval_events
  FOR EACH ROW EXECUTE FUNCTION public.movimento_atualiza_dossie();
DROP TRIGGER IF EXISTS movimento_atualiza_dossie ON public.editorial_events;
CREATE TRIGGER movimento_atualiza_dossie AFTER INSERT ON public.editorial_events
  FOR EACH ROW EXECUTE FUNCTION public.movimento_atualiza_dossie();
DROP TRIGGER IF EXISTS movimento_atualiza_dossie ON public.client_requests;
CREATE TRIGGER movimento_atualiza_dossie AFTER INSERT ON public.client_requests
  FOR EACH ROW EXECUTE FUNCTION public.movimento_atualiza_dossie();
DROP TRIGGER IF EXISTS movimento_atualiza_dossie ON public.milestones;
CREATE TRIGGER movimento_atualiza_dossie AFTER INSERT OR UPDATE OF status ON public.milestones
  FOR EACH ROW EXECUTE FUNCTION public.movimento_atualiza_dossie();

-- Upload de material chega em lote (uma lâmina por vez): entra pelo cron,
-- que só grava versão nova quando a seção mudou.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'dossie-movimentos-15min';
    PERFORM cron.schedule('dossie-movimentos-15min', '*/15 * * * *', $cron$select public.dossie_registrar_avancos_todos();$cron$);
  END IF;
END $$;
