-- Frente R (25/09 noite): o que é feito para o cliente e não chegava ao contexto.
-- a) Estúdio: arte pronta ainda não entregue; b) item removido da agenda/execução.
-- Gatilho SÓ enfileira em dossie_fila; o cron reescreve o dossiê.
CREATE OR REPLACE FUNCTION app_private.movimentos_das_mesas(_client_id uuid, _desde timestamptz, _ate timestamptz)
RETURNS TABLE(
  quando timestamptz, tipo text, titulo text, titulo_cliente text, detalhe text,
  visivel_ao_cliente boolean, origem text, ref_id uuid, link text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  BEGIN
    RETURN QUERY
    SELECT c.criado_em, 'campanha_criada'::text,
           'Campanha criada na Mesa: "' || c.nome || '"'
             || CASE WHEN c.periodo_inicio IS NOT NULL THEN ' (' || to_char(c.periodo_inicio, 'DD/MM') || coalesce(' a ' || to_char(c.periodo_fim, 'DD/MM'), '') || ')' ELSE '' END,
           NULL::text, NULLIF(left(btrim(coalesce(c.objetivo, c.conceito, '')), 160), ''), false, 'mesa_campanhas'::text, c.id, NULL::text
      FROM public.mesa_campanhas c
     WHERE c.client_id = _client_id AND c.criado_em >= _desde AND c.criado_em <= _ate
    UNION ALL
    SELECT c.atualizado_em, 'campanha_alterada'::text,
           'Campanha alterada na Mesa: "' || c.nome || '" (' || c.status || ')',
           NULL::text, NULLIF(left(btrim(coalesce(c.objetivo, '')), 160), ''), false, 'mesa_campanhas'::text, c.id, NULL::text
      FROM public.mesa_campanhas c
     WHERE c.client_id = _client_id AND c.atualizado_em >= _desde AND c.atualizado_em <= _ate
       AND c.atualizado_em > c.criado_em + interval '2 minutes';
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
  END;

  BEGIN
    RETURN QUERY
    SELECT p.gravada_em, 'conteudo_gravado'::text,
           'Conteúdos do mês gravados na agenda pela Mesa: ' || coalesce(cardinality(p.task_ids), 0) || ' item(ns) de '
             || to_char(p.periodo_inicio, 'DD/MM') || ' a ' || to_char(p.periodo_fim, 'DD/MM'),
           NULL::text, NULLIF(left(btrim(coalesce(p.parametros->>'origem', '')), 80), ''), false, 'calendario_propostas'::text, p.id, NULL::text
      FROM public.calendario_propostas p
     WHERE p.client_id = _client_id AND p.gravada_em IS NOT NULL AND p.gravada_em >= _desde AND p.gravada_em <= _ate;
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
  END;

  BEGIN
    RETURN QUERY
    SELECT b.criado_em, 'briefing_de_ads'::text, 'Briefing de anúncios salvo na Mesa Ads (versão ' || b.versao || ')',
           NULL::text, NULL::text, false, 'ads_briefings'::text, b.id, NULL::text
      FROM public.ads_briefings b
     WHERE b.client_id = _client_id AND b.criado_em >= _desde AND b.criado_em <= _ate;
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
  END;
  BEGIN
    RETURN QUERY
    SELECT o.criado_em, 'oferta_salva'::text, 'Oferta criada na Mesa Ads: "' || o.nome || '"',
           NULL::text, NULLIF(left(btrim(coalesce(o.oferta->>'promessa', '')), 160), ''), false, 'ads_ofertas'::text, o.id, NULL::text
      FROM public.ads_ofertas o
     WHERE o.client_id = _client_id AND o.criado_em >= _desde AND o.criado_em <= _ate
    UNION ALL
    SELECT o.atualizado_em,
           CASE WHEN o.status = 'escolhida' THEN 'oferta_escolhida' ELSE 'oferta_salva' END,
           CASE WHEN o.status = 'escolhida' THEN 'Oferta escolhida para o tráfego: "' ELSE 'Oferta alterada na Mesa Ads: "' END || o.nome || '"',
           NULL::text, NULLIF(left(btrim(coalesce(o.oferta->>'promessa', '')), 160), ''), false, 'ads_ofertas'::text, o.id, NULL::text
      FROM public.ads_ofertas o
     WHERE o.client_id = _client_id AND o.atualizado_em >= _desde AND o.atualizado_em <= _ate
       AND o.atualizado_em > o.criado_em + interval '2 minutes' AND o.status <> 'arquivada';
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
  END;
  BEGIN
    RETURN QUERY
    SELECT pl.criado_em, 'plano_de_ads'::text,
           'Plano de teste de anúncios criado: "' || pl.nome || '" (' || coalesce(jsonb_array_length(pl.angulos), 0) || ' ângulo(s))',
           NULL::text, NULLIF(left(btrim(coalesce(pl.estrutura->>'resumo', '')), 160), ''), false, 'ads_planos'::text, pl.id, NULL::text
      FROM public.ads_planos pl
     WHERE pl.client_id = _client_id AND pl.criado_em >= _desde AND pl.criado_em <= _ate
    UNION ALL
    SELECT max(cr.criado_em), 'criativos_de_ads'::text,
           count(*) || ' criativo(s) de anúncio produzido(s)' || coalesce(' no plano "' || max(pl.nome) || '"', ''),
           NULL::text, NULL::text, false, 'ads_criativos'::text, cr.plano_id, NULL::text
      FROM public.ads_criativos cr
      LEFT JOIN public.ads_planos pl ON pl.id = cr.plano_id
     WHERE cr.client_id = _client_id AND cr.criado_em >= _desde AND cr.criado_em <= _ate
     GROUP BY cr.plano_id, (cr.criado_em AT TIME ZONE 'America/Sao_Paulo')::date
    UNION ALL
    SELECT a.criado_em, 'aprendizado_de_ads'::text, 'Aprendizado de anúncio com resultado (' || a.evidencia || '): ' || left(btrim(a.texto), 160),
           NULL::text, NULL::text, false, 'ads_aprendizados'::text, a.id, NULL::text
      FROM public.ads_aprendizados a
     WHERE a.client_id = _client_id AND a.criado_em >= _desde AND a.criado_em <= _ate;
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
  END;

  BEGIN
    RETURN QUERY
    SELECT max(i.aprovada_em), 'fotos_aprovadas'::text,
           count(*) || ' foto(s) aprovada(s) na Mesa Foto' || CASE WHEN bool_or(i.gerada) THEN ' (inclui geradas no ensaio)' ELSE '' END,
           NULL::text, left(string_agg(i.nome, ', ' ORDER BY i.aprovada_em DESC), 160), false, 'cliente_imagens'::text, NULL::uuid, NULL::text
      FROM public.cliente_imagens i
     WHERE i.client_id = _client_id AND i.aprovada IS TRUE AND i.aprovada_em >= _desde AND i.aprovada_em <= _ate
     GROUP BY (i.aprovada_em AT TIME ZONE 'America/Sao_Paulo')::date;
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
  END;

  BEGIN
    RETURN QUERY
    SELECT m.criado_em, 'aprendizado_do_cliente'::text,
           'Aprendizado registrado no cérebro (' || coalesce(m.area, m.agente) || '): ' || left(btrim(m.texto), 160),
           NULL::text, NULLIF(left(btrim(coalesce(m.motivo, '')), 160), ''), false, 'agente_memoria'::text, m.id, NULL::text
      FROM public.agente_memoria m
     WHERE m.client_id = _client_id AND m.criado_em >= _desde AND m.criado_em <= _ate
       AND m.texto NOT LIKE 'Plano do mês %';
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
  END;

  BEGIN
    RETURN QUERY
    SELECT e.atualizado_em, 'arte_pronta'::text,
           'Arte pronta no Estúdio (falta entregar): "' || coalesce(NULLIF(btrim(t.title), ''), 'arte') || '"',
           NULL::text, NULL::text, false, 'estudio_trabalhos'::text, e.id, NULL::text
      FROM public.estudio_trabalhos e
      LEFT JOIN public.tasks t ON t.id = e.task_id
     WHERE e.client_id = _client_id AND e.status = 'pronto'
       AND e.atualizado_em >= _desde AND e.atualizado_em <= _ate;
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
  END;

  BEGIN
    RETURN QUERY
    SELECT t.deleted_at, 'item_removido'::text,
           'Removido da agenda/execução: "' || coalesce(NULLIF(btrim(t.title), ''), 'item') || '"'
             || CASE WHEN t.due_date IS NOT NULL THEN ' (era para ' || to_char(t.due_date, 'DD/MM') || ')' ELSE '' END,
           NULL::text, NULL::text, false, 'tasks'::text, t.id, NULL::text
      FROM public.tasks t
      JOIN public.projects p ON p.id = t.project_id AND p.client_id = _client_id
     WHERE t.deleted_at IS NOT NULL AND t.deleted_at >= _desde AND t.deleted_at <= _ate;
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
  END;
END $$;
REVOKE ALL ON FUNCTION app_private.movimentos_das_mesas(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.contexto_extra_enfileira()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _client uuid;
BEGIN
  IF TG_TABLE_NAME = 'estudio_trabalhos' THEN
    IF NEW.status IS DISTINCT FROM 'pronto' OR OLD.status IS NOT DISTINCT FROM 'pronto' THEN RETURN NEW; END IF;
    _client := NEW.client_id;
  ELSIF TG_TABLE_NAME = 'tasks' THEN
    IF NEW.deleted_at IS NULL OR OLD.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
    SELECT p.client_id INTO _client FROM public.projects p WHERE p.id = NEW.project_id;
  END IF;
  IF _client IS NULL THEN RETURN NEW; END IF;
  BEGIN
    PERFORM public.dossie_enfileirar(_client, TG_TABLE_NAME);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'contexto_extra_enfileira(%): %', _client, SQLERRM;
  END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.contexto_extra_enfileira() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF to_regclass('public.estudio_trabalhos') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS contexto_extra_enfileira ON public.estudio_trabalhos;
    CREATE TRIGGER contexto_extra_enfileira AFTER UPDATE OF status ON public.estudio_trabalhos
      FOR EACH ROW EXECUTE FUNCTION public.contexto_extra_enfileira();
  END IF;
  DROP TRIGGER IF EXISTS contexto_extra_enfileira ON public.tasks;
  CREATE TRIGGER contexto_extra_enfileira AFTER UPDATE OF deleted_at ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION public.contexto_extra_enfileira();
END $$;
