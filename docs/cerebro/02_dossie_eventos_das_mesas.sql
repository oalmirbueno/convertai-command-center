-- Dossiê bidirecional: o que acontece nas mesas passa sozinho para o painel
-- (MCP 2.3, 25/09/2026). NÃO APLICADO: rodar pelo SQL Editor DEPOIS do
-- 01_cerebro_memoria.sql (ordem em docs/cerebro/AGENTES.md). Idempotente.
--
-- Regra da casa (21/09, "statement timeout" ao agendar): gatilho SÓ ENFILEIRA
-- em app_private.dossie_fila; quem reescreve o dossiê é o cron
-- dossie-fila-1min (dossie_processar_fila), com 90 s de calmaria e lock curto.
-- Este arquivo segue a regra: nenhum gatilho daqui toca client_dossiers.
--
-- Como o movimento vira texto do dossiê:
-- 1) app_private.movimentos_das_mesas lê as tabelas das mesas por período e
--    devolve linhas no mesmo formato de movimentos_do_cliente (todas
--    [interno]: o cliente não vê trabalho de bastidor pelo portal).
-- 2) public.movimentos_do_cliente (a porta pública, que dossie_avancos_texto
--    já chama) passa a juntar os movimentos de sempre com os das mesas. A
--    guarda de acesso é a MESMA da versão de 21/09; o cliente continua vendo
--    só o que é visível a ele, e as linhas das mesas nunca são visíveis.
-- 3) Gatilhos nas tabelas das mesas chamam dossie_enfileirar. O cron
--    processa a fila e a seção "Avanços recentes (automático)" do dossiê
--    ganha as linhas novas no dia certo.
--
-- O que já entrava no dossiê e continua igual (não duplicado aqui): arte
-- entregue em Arquivos (files), enviada para aprovação, aprovada e reprovada
-- pelo cliente (file_approval_events), agendada e publicada (editorial_events),
-- tarefa concluída (tasks). A entrega do Estúdio passa por esses caminhos.
--
-- Tabela ausente neste ambiente (Mesa Foto ainda não aplicada, por exemplo)
-- não quebra nada: a leitura pula a fonte e o gatilho só é criado se a tabela
-- existir.

-- 0) Mesa Foto: quando a foto foi aprovada (a data que o dossiê mostra) ------
DO $$
BEGIN
  IF to_regclass('public.cliente_imagens') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cliente_imagens' AND column_name = 'aprovada') THEN
    ALTER TABLE public.cliente_imagens ADD COLUMN IF NOT EXISTS aprovada_em timestamptz;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cliente_imagens_marca_aprovacao()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF NEW.aprovada IS TRUE AND (TG_OP = 'INSERT' OR OLD.aprovada IS NOT TRUE) THEN
    NEW.aprovada_em := now();
  ELSIF NEW.aprovada IS NOT TRUE THEN
    NEW.aprovada_em := NULL;
  END IF;
  RETURN NEW;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cliente_imagens' AND column_name = 'aprovada_em') THEN
    DROP TRIGGER IF EXISTS cliente_imagens_marca_aprovacao ON public.cliente_imagens;
    CREATE TRIGGER cliente_imagens_marca_aprovacao BEFORE INSERT OR UPDATE OF aprovada ON public.cliente_imagens
      FOR EACH ROW EXECUTE FUNCTION public.cliente_imagens_marca_aprovacao();
  END IF;
END $$;

-- 1) Leitura dos movimentos das mesas -----------------------------------------
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
  -- Campanhas da Mesa: criada e última alteração (uma linha por campanha).
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

  -- Conteúdo do mês gravado na agenda pelo estrategista.
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

  -- Mesa Ads: briefing, ofertas, planos, criativos (agrupados) e aprendizados.
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

  -- Mesa Foto: fotos aprovadas (agrupadas por dia).
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

  -- Cérebro do cliente: aprendizado novo (o que o dono ensinou entra no retrato).
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
END $$;
REVOKE ALL ON FUNCTION app_private.movimentos_das_mesas(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

-- 2) A porta pública junta as duas fontes (guarda idêntica à de 21/09) -------
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
DECLARE _so_visiveis boolean := _somente_visiveis;
BEGIN
  -- O cliente lê o próprio histórico, mas NUNCA escolhe ver o interno: o
  -- parâmetro é forçado no banco, não no front.
  IF NOT app_private.rpc_trusted_backend() THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RPC_AUTH_REQUIRED';
    END IF;
    IF auth.uid() <> _client_id THEN
      PERFORM app_private.require_rpc_client_staff(_client_id);
    ELSIF NOT coalesce(public.is_staff(auth.uid()), false) THEN
      _so_visiveis := true;
    END IF;
  END IF;
  IF _so_visiveis THEN
    -- Os movimentos das mesas são todos internos: nem entram na conta.
    RETURN QUERY SELECT * FROM app_private.movimentos_do_cliente_bruto(_client_id, _desde, _ate, true);
    RETURN;
  END IF;
  RETURN QUERY
  SELECT t.* FROM (
    SELECT * FROM app_private.movimentos_do_cliente_bruto(_client_id, _desde, _ate, false)
    UNION ALL
    SELECT * FROM app_private.movimentos_das_mesas(_client_id, _desde, _ate)
  ) t
  ORDER BY t.quando DESC;
END; $$;
REVOKE ALL ON FUNCTION public.movimentos_do_cliente(uuid, timestamptz, timestamptz, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.movimentos_do_cliente(uuid, timestamptz, timestamptz, boolean) TO authenticated, service_role;

-- 3) Gatilhos: só enfileiram ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.mesa_movimento_enfileira()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _vale boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- to_jsonb: a mesma expressão serve a tabelas sem a coluna (NEW.coluna quebraria na hora de planejar).
    _vale := CASE TG_TABLE_NAME
      WHEN 'calendario_propostas' THEN to_jsonb(NEW)->>'gravada_em' IS NOT NULL
      WHEN 'cliente_imagens' THEN (to_jsonb(NEW)->>'aprovada')::boolean IS TRUE
      ELSE true END;
  ELSIF TG_TABLE_NAME = 'mesa_campanhas' THEN
    -- Qualquer mudança de conteúdo (nome, período, briefing, imagens, status...), menos custo e carimbo.
    _vale := (to_jsonb(NEW) - ARRAY['custo_usd', 'atualizado_em']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['custo_usd', 'atualizado_em']);
  ELSIF TG_TABLE_NAME = 'calendario_propostas' THEN
    _vale := NEW.gravada_em IS DISTINCT FROM OLD.gravada_em AND NEW.gravada_em IS NOT NULL;
  ELSIF TG_TABLE_NAME = 'ads_ofertas' THEN
    _vale := NEW.status IS DISTINCT FROM OLD.status OR NEW.nome IS DISTINCT FROM OLD.nome OR NEW.oferta IS DISTINCT FROM OLD.oferta;
  ELSIF TG_TABLE_NAME IN ('ads_planos', 'ads_criativos') THEN
    _vale := NEW.status IS DISTINCT FROM OLD.status;
  ELSIF TG_TABLE_NAME = 'cliente_imagens' THEN
    _vale := (to_jsonb(NEW)->>'aprovada')::boolean IS TRUE AND (to_jsonb(OLD)->>'aprovada')::boolean IS NOT TRUE;
  END IF;
  IF NOT _vale OR NEW.client_id IS NULL THEN RETURN NEW; END IF;
  BEGIN
    PERFORM public.dossie_enfileirar(NEW.client_id, TG_TABLE_NAME);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'mesa_movimento_enfileira(%): %', NEW.client_id, SQLERRM;
  END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.mesa_movimento_enfileira() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE _t record;
BEGIN
  FOR _t IN SELECT * FROM (VALUES
    ('mesa_campanhas', 'AFTER INSERT OR UPDATE'),
    ('calendario_propostas', 'AFTER INSERT OR UPDATE OF gravada_em'),
    ('ads_briefings', 'AFTER INSERT'),
    ('ads_ofertas', 'AFTER INSERT OR UPDATE'),
    ('ads_planos', 'AFTER INSERT OR UPDATE OF status'),
    ('ads_criativos', 'AFTER INSERT OR UPDATE OF status'),
    ('ads_aprendizados', 'AFTER INSERT'),
    ('cliente_imagens', 'AFTER INSERT OR UPDATE OF aprovada'),
    ('agente_memoria', 'AFTER INSERT')
  ) AS v(tabela, quando) LOOP
    IF to_regclass('public.' || _t.tabela) IS NULL THEN
      RAISE NOTICE 'tabela % ausente: gatilho do dossiê não criado', _t.tabela;
      CONTINUE;
    END IF;
    IF _t.tabela = 'cliente_imagens' AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cliente_imagens' AND column_name = 'aprovada'
    ) THEN
      RAISE NOTICE 'cliente_imagens sem a coluna aprovada (Mesa Foto não aplicada): gatilho não criado';
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS mesa_movimento_enfileira ON public.%I', _t.tabela);
    EXECUTE format('CREATE TRIGGER mesa_movimento_enfileira %s ON public.%I FOR EACH ROW EXECUTE FUNCTION public.mesa_movimento_enfileira()', _t.quando, _t.tabela);
  END LOOP;
END $$;
