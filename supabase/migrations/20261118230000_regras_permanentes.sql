-- Regras permanentes (18/11/2026): o dono deixou de aprovar rotina.
--
-- Antes: todo pedido de aprovação de agente entrava como pendente e esperava o dono.
-- Agora: o pedido passa primeiro pelas regras permanentes. Dentro de uma regra LIGADA, ele já nasce
-- aprovado, com o nome da regra na auditoria, e não vai para a caixa "Precisa de você". Fora da regra,
-- ou com a regra desligada, entra como pendente, igual a antes.
--
-- O que entra:
--  1) public.regras_permanentes: a regra, se está ligada, as ações e os agentes que ela cobre e os limites.
--  2) public.regras_permanentes_usos: cada vez que uma regra autorizou algo (quem, cliente, ação, valor).
--  3) operator_approvals.regra_permanente: qual regra aprovou aquele pedido.
--  4) app_private.regra_permanente_avaliar: a decisão, num lugar só. operator_request_approval passa a consultá-la.
--  5) regra_permanente_ajustar (o dono liga, desliga e muda o limite) e regras_permanentes_limpar_fila
--     (tira da caixa os pedidos antigos que hoje cabem numa regra; com _aplicar=false só mostra).
--
-- Sempre sobe para o dono, com qualquer regra ligada: recarga, gasto acima do teto, cliente novo, preço e
-- negociação, reclamação, peça rejeitada mais de uma vez, mudança de rumo, financeiro, permissões e
-- exclusão ou exportação de dados.
--
-- A regra AUTORIZA. Quem executa continua sendo a ferramenta de cada ação, com as travas que ela já tem.

-- ───────────────────────── 1) as regras ─────────────────────────
CREATE TABLE IF NOT EXISTS public.regras_permanentes (
  chave text PRIMARY KEY CHECK (chave ~ '^[a-z][a-z0-9_]{2,40}$'),
  nome text NOT NULL CHECK (char_length(nome) BETWEEN 3 AND 80),
  area text NOT NULL,
  descricao text NOT NULL CHECK (char_length(descricao) <= 600),
  ligada boolean NOT NULL DEFAULT false,
  acoes text[] NOT NULL DEFAULT '{}',
  operadores text[] NOT NULL DEFAULT '{}',
  limites jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(limites) = 'object'),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid
);

CREATE TABLE IF NOT EXISTS public.regras_permanentes_usos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  regra text NOT NULL REFERENCES public.regras_permanentes(chave) ON DELETE RESTRICT,
  operator_slug text NOT NULL,
  client_id uuid,
  action_kind text NOT NULL,
  approval_id uuid REFERENCES public.operator_approvals(id) ON DELETE SET NULL,
  valor numeric,
  assunto text,
  detalhe jsonb NOT NULL DEFAULT '{}'::jsonb,
  usado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS regras_permanentes_usos_regra_idx ON public.regras_permanentes_usos (regra, usado_em DESC);
CREATE INDEX IF NOT EXISTS regras_permanentes_usos_assunto_idx ON public.regras_permanentes_usos (client_id, assunto, usado_em DESC) WHERE assunto IS NOT NULL;

ALTER TABLE public.operator_approvals ADD COLUMN IF NOT EXISTS regra_permanente text;
COMMENT ON COLUMN public.operator_approvals.regra_permanente IS
  'Chave da regra permanente que aprovou este pedido. Nulo = decidido por pessoa (ou ainda pendente).';

DO $$
DECLARE _t text;
BEGIN
  FOREACH _t IN ARRAY ARRAY['regras_permanentes', 'regras_permanentes_usos'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', _t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', _t || '_equipe_le', _t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_staff((select auth.uid())))', _t || '_equipe_le', _t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', _t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', _t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', _t);
  END LOOP;
END $$;

-- As três primeiras. Conteúdo e Tráfego nascem ligadas (decisão do dono em 18/11).
-- Mensagens nasce DESLIGADA: falta colar os três textos-modelo aprovados; sem texto ela não autoriza nada.
INSERT INTO public.regras_permanentes (chave, nome, area, descricao, ligada, acoes, operadores, limites) VALUES
  ('conteudo_revisado', 'Conteúdo revisado segue sem o dono', 'Conteúdo',
   'Peça com revisão interna aprovada por outro agente vai direto para o cliente aprovar. Aprovada pelo cliente, o agente agenda e publica sem passar pelo dono.',
   true, ARRAY['publicar', 'agendar'], ARRAY[]::text[], '{"max_rejeicoes": 1}'::jsonb),
  ('trafego_ate_o_teto', 'Tráfego até o teto da semana', 'Tráfego',
   'O Trafe pausa, troca criativo e ajusta verba sozinho enquanto o gasto do cliente na semana (segunda a domingo) ficar até o teto. Acima disso ou em recarga, sobe para o dono.',
   true, ARRAY['alterar_orcamento', 'ativar_campanha'], ARRAY['trafe'], '{"teto_semana_brl": 120, "dias_sem_coleta": 3}'::jsonb),
  ('mensagens_de_rotina', 'Mensagens de rotina a clientes', 'Clientes',
   'Três textos-modelo já aprovados (mensalidade vencida, lembrete de aprovação, pedido de material) saem sem revisão, no grupo do cliente, em dias úteis, dentro do horário, no máximo 2 por assunto. Só troca o que está entre colchetes.',
   false, ARRAY['enviar_mensagem', 'contatar_cliente'], ARRAY[]::text[],
   '{"hora_inicio": 9, "hora_fim": 18, "max_por_assunto": 2, "intervalo_dias": 6, "modelos": {"mensalidade_vencida": {"nome": "Mensalidade vencida", "texto": ""}, "lembrete_aprovacao": {"nome": "Lembrete de aprovação", "texto": ""}, "pedido_material": {"nome": "Pedido de material", "texto": ""}}}'::jsonb)
ON CONFLICT (chave) DO NOTHING;

-- ───────────────────────── 2) a decisão ─────────────────────────

-- O texto bate com o modelo, trocando só o que está entre colchetes?
CREATE OR REPLACE FUNCTION app_private.texto_segue_o_modelo(_texto text, _modelo text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO ''
AS $$
DECLARE
  _m text := btrim(regexp_replace(COALESCE(_modelo, ''), '\s+', ' ', 'g'));
  _t text := btrim(regexp_replace(COALESCE(_texto, ''), '\s+', ' ', 'g'));
  _padrao text;
BEGIN
  IF _m = '' OR _t = '' THEN RETURN false; END IF;
  -- Colchete que sobrou no texto = lacuna não preenchida.
  IF _t ~ '\[[^\]]*\]' THEN RETURN false; END IF;
  _padrao := regexp_replace(_m, '([\\.^$*+?(){}|-])', '\\\1', 'g');
  _padrao := regexp_replace(_padrao, '\[[^\]]*\]', '.{1,160}?', 'g');
  RETURN _t ~ ('^' || _padrao || '$');
END;
$$;

-- Devolve {autoriza, regra, nome, motivo, valor, assunto, client_id}. Nunca levanta erro: na dúvida, sobe.
CREATE OR REPLACE FUNCTION app_private.regra_permanente_avaliar(
  _operator_slug text,
  _action_kind text,
  _payload jsonb,
  _custo numeric,
  _kanban_task_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _p jsonb := COALESCE(_payload, '{}'::jsonb);
  _r public.regras_permanentes%ROWTYPE;
  _cliente uuid;
  _agora timestamp := (now() AT TIME ZONE 'America/Sao_Paulo');
  _segunda date := date_trunc('week', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;
  _gasto numeric;
  _ultima date;
  _aumento numeric;
  _teto numeric;
  _trabalho uuid;
  _modelo text;
  _texto_modelo text;
  _assunto text;
  _usos integer;
  _ultimo_uso timestamptz;
  sobe CONSTANT text := 'sobe';
BEGIN
  -- O que sempre sobe, com qualquer regra ligada.
  IF _action_kind IN ('gastar', 'alterar_financeiro', 'alterar_permissoes', 'exportar_dados', 'excluir_dados',
                      'mudar_estrategia', 'criar_proposta', 'enviar_contrato', 'alterar_responsavel', 'promover_autonomia') THEN
    RETURN jsonb_build_object('autoriza', false, 'motivo', 'Esta ação sempre passa pelo dono.');
  END IF;
  IF COALESCE((_p->>'recarga')::boolean, false) OR COALESCE((_p->>'cliente_novo')::boolean, false)
     OR COALESCE((_p->>'negociacao')::boolean, false) OR COALESCE((_p->>'reclamacao')::boolean, false)
     OR COALESCE((_p->>'mudanca_de_rumo')::boolean, false) THEN
    RETURN jsonb_build_object('autoriza', false, 'motivo', 'Recarga, cliente novo, preço e negociação, reclamação e mudança de rumo sempre passam pelo dono.');
  END IF;

  BEGIN
    _cliente := NULLIF(_p->>'client_id', '')::uuid;
  EXCEPTION WHEN others THEN _cliente := NULL; END;
  IF _cliente IS NULL AND _kanban_task_id IS NOT NULL THEN
    SELECT pr.client_id INTO _cliente FROM public.tasks t JOIN public.projects pr ON pr.id = t.project_id WHERE t.id = _kanban_task_id;
  END IF;

  FOR _r IN SELECT * FROM public.regras_permanentes WHERE ligada AND _action_kind = ANY(acoes) ORDER BY chave LOOP
    IF cardinality(_r.operadores) > 0 AND NOT (lower(_operator_slug) = ANY(_r.operadores)) THEN CONTINUE; END IF;

    -- ── Conteúdo: revisão interna aprovada; para agendar e publicar, também o cliente aprovou.
    IF _r.chave = 'conteudo_revisado' THEN
      BEGIN
        _trabalho := NULLIF(_p->>'trabalho_id', '')::uuid;
      EXCEPTION WHEN others THEN _trabalho := NULL; END;
      IF _trabalho IS NULL THEN
        RETURN jsonb_build_object('autoriza', false, 'regra', _r.chave, 'motivo', 'Faltou trabalho_id no payload: sem a peça não dá para conferir a revisão.');
      END IF;
      IF COALESCE((_p->>'rejeicoes')::integer, 0) > COALESCE((_r.limites->>'max_rejeicoes')::integer, 1) THEN
        RETURN jsonb_build_object('autoriza', false, 'regra', _r.chave, 'motivo', 'Peça rejeitada mais de uma vez: passa pelo dono.');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.estudio_trabalhos e WHERE e.id = _trabalho AND e.revisao_decisao = 'aprovado'
                       AND (_cliente IS NULL OR e.client_id = _cliente)) THEN
        RETURN jsonb_build_object('autoriza', false, 'regra', _r.chave, 'motivo', 'A peça ainda não tem revisão interna aprovada (aceleriq_revisar_trabalho_interno).');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.estudio_trabalhos e JOIN public.files f ON f.id = ANY(e.file_ids)
                      WHERE e.id = _trabalho AND f.approval_status = 'approved') THEN
        RETURN jsonb_build_object('autoriza', false, 'regra', _r.chave, 'motivo', 'O cliente ainda não aprovou esta peça.');
      END IF;
      SELECT e.client_id INTO _cliente FROM public.estudio_trabalhos e WHERE e.id = _trabalho;
      RETURN jsonb_build_object('autoriza', true, 'regra', _r.chave, 'nome', _r.nome, 'client_id', _cliente,
                                'motivo', 'Peça com revisão interna e aprovação do cliente.');
    END IF;

    -- ── Tráfego: gasto da semana (segunda a domingo) até o teto, com coleta recente.
    IF _r.chave = 'trafego_ate_o_teto' THEN
      IF _cliente IS NULL THEN
        RETURN jsonb_build_object('autoriza', false, 'regra', _r.chave, 'motivo', 'Faltou client_id no payload.');
      END IF;
      IF COALESCE(_p->>'tipo', '') NOT IN ('pausar', 'trocar_criativo', 'ajustar_verba') THEN
        RETURN jsonb_build_object('autoriza', false, 'regra', _r.chave, 'motivo', 'A regra cobre só pausar, trocar_criativo e ajustar_verba (campo tipo do payload).');
      END IF;
      SELECT COALESCE(sum(d.spend) FILTER (WHERE d.day >= _segunda), 0), max(d.day) INTO _gasto, _ultima
        FROM public.ads_campaign_daily d WHERE d.client_id = _cliente AND d.day >= _segunda - 14;
      IF _ultima IS NULL OR _ultima < (_agora::date - COALESCE((_r.limites->>'dias_sem_coleta')::integer, 3)) THEN
        RETURN jsonb_build_object('autoriza', false, 'regra', _r.chave, 'motivo', 'O gasto deste cliente não está coletado no painel: sem o número, passa pelo dono.');
      END IF;
      _teto := COALESCE((_r.limites->>'teto_semana_brl')::numeric, 0);
      _aumento := GREATEST(COALESCE(NULLIF(_p->>'aumento_na_semana', '')::numeric, _custo, 0), 0);
      IF _gasto + _aumento > _teto THEN
        RETURN jsonb_build_object('autoriza', false, 'regra', _r.chave, 'valor', _gasto + _aumento,
          'motivo', format('Gasto da semana R$ %s mais o ajuste R$ %s passa do teto de R$ %s.', round(_gasto, 2), round(_aumento, 2), round(_teto, 2)));
      END IF;
      RETURN jsonb_build_object('autoriza', true, 'regra', _r.chave, 'nome', _r.nome, 'client_id', _cliente, 'valor', _gasto + _aumento,
        'motivo', format('Gasto da semana R$ %s com o ajuste, dentro do teto de R$ %s.', round(_gasto + _aumento, 2), round(_teto, 2)));
    END IF;

    -- ── Mensagens de rotina: modelo aprovado, grupo do cliente, dia útil, horário e no máximo N por assunto.
    IF _r.chave = 'mensagens_de_rotina' THEN
      _modelo := COALESCE(_p->>'modelo', '');
      _texto_modelo := _r.limites #>> ARRAY['modelos', _modelo, 'texto'];
      IF _cliente IS NULL OR _texto_modelo IS NULL OR btrim(_texto_modelo) = '' THEN
        RETURN jsonb_build_object('autoriza', false, 'regra', _r.chave, 'motivo', 'Faltou client_id ou o modelo não é um dos aprovados (campo modelo do payload).');
      END IF;
      IF COALESCE(_p->>'canal', '') <> 'grupo_do_cliente' THEN
        RETURN jsonb_build_object('autoriza', false, 'regra', _r.chave, 'motivo', 'A regra vale só para o grupo do cliente (canal="grupo_do_cliente").');
      END IF;
      IF NOT app_private.texto_segue_o_modelo(_p->>'texto', _texto_modelo) THEN
        RETURN jsonb_build_object('autoriza', false, 'regra', _r.chave, 'motivo', 'O texto não segue o modelo aprovado: só pode trocar o que está entre colchetes.');
      END IF;
      IF extract(isodow FROM _agora) > 5
         OR extract(hour FROM _agora) < COALESCE((_r.limites->>'hora_inicio')::integer, 9)
         OR extract(hour FROM _agora) >= COALESCE((_r.limites->>'hora_fim')::integer, 18) THEN
        RETURN jsonb_build_object('autoriza', false, 'regra', _r.chave, 'motivo', 'Fora do horário da regra (dias úteis, dentro do horário comercial).');
      END IF;
      _assunto := _modelo || ':' || COALESCE(NULLIF(btrim(_p->>'referencia'), ''), 'geral');
      SELECT count(*), max(u.usado_em) INTO _usos, _ultimo_uso
        FROM public.regras_permanentes_usos u WHERE u.regra = _r.chave AND u.client_id = _cliente AND u.assunto = _assunto;
      IF _usos >= COALESCE((_r.limites->>'max_por_assunto')::integer, 2) THEN
        RETURN jsonb_build_object('autoriza', false, 'regra', _r.chave, 'motivo', 'Este assunto já teve o máximo de mensagens de rotina com este cliente.');
      END IF;
      IF _usos > 0 AND _ultimo_uso > now() - make_interval(days => COALESCE((_r.limites->>'intervalo_dias')::integer, 6)) THEN
        RETURN jsonb_build_object('autoriza', false, 'regra', _r.chave, 'motivo', 'Ainda não deu o intervalo entre a primeira e a segunda mensagem deste assunto.');
      END IF;
      RETURN jsonb_build_object('autoriza', true, 'regra', _r.chave, 'nome', _r.nome, 'client_id', _cliente, 'assunto', _assunto,
                                'motivo', 'Texto-modelo aprovado, no grupo do cliente, dentro do horário.');
    END IF;
  END LOOP;

  RETURN jsonb_build_object('autoriza', false, 'motivo', 'Nenhuma regra permanente ligada cobre esta ação para este agente.');
EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('autoriza', false, 'motivo', 'Não deu para conferir a regra: ' || left(SQLERRM, 120));
END;
$$;

REVOKE ALL ON FUNCTION app_private.regra_permanente_avaliar(text, text, jsonb, numeric, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.texto_segue_o_modelo(text, text) FROM PUBLIC, anon, authenticated;

-- Marca um pedido como aprovado pela regra e registra o uso e a auditoria. Só chamada daqui de dentro.
CREATE OR REPLACE FUNCTION app_private.regra_permanente_aprovar(_approval_id uuid, _decisao jsonb, _ator text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _a public.operator_approvals%ROWTYPE;
  _slug text;
BEGIN
  UPDATE public.operator_approvals
     SET status = 'aprovado', decided_at = now(), regra_permanente = _decisao->>'regra',
         decision_note = left('Regra permanente: ' || COALESCE(_decisao->>'nome', _decisao->>'regra') || '. ' || COALESCE(_decisao->>'motivo', ''), 500)
   WHERE id = _approval_id AND status = 'pendente'
  RETURNING * INTO _a;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT slug INTO _slug FROM public.internal_operators WHERE id = _a.operator_id;
  INSERT INTO public.regras_permanentes_usos (regra, operator_slug, client_id, action_kind, approval_id, valor, assunto, detalhe)
  VALUES (_decisao->>'regra', COALESCE(_slug, '?'), NULLIF(_decisao->>'client_id', '')::uuid, _a.action_kind, _a.id,
          NULLIF(_decisao->>'valor', '')::numeric, _decisao->>'assunto', jsonb_build_object('motivo', _decisao->>'motivo'));
  INSERT INTO public.operator_audit_log (actor, operator_id, task_link_id, kanban_task_id, action, old_status, new_status, evidence, approval_required)
  VALUES (_ator, _a.operator_id, _a.task_link_id, _a.kanban_task_id,
          'regra permanente ' || (_decisao->>'regra') || ' autorizou: ' || _a.action_kind, 'pendente', 'aprovado',
          left(COALESCE(_decisao->>'motivo', ''), 500), false);
END;
$$;
REVOKE ALL ON FUNCTION app_private.regra_permanente_aprovar(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;

-- ───────────────────────── 3) o pedido de aprovação consulta a regra ─────────────────────────
CREATE OR REPLACE FUNCTION public.operator_request_approval(
  _operator_slug text,
  _link_id uuid,
  _action_kind text,
  _o_que text,
  _por_que text,
  _payload jsonb,
  _dados_usados text DEFAULT NULL,
  _destino text DEFAULT NULL,
  _impacto text DEFAULT NULL,
  _risco text DEFAULT NULL,
  _custo_previsto numeric DEFAULT NULL,
  _prazo date DEFAULT NULL,
  _reversivel boolean DEFAULT true,
  _evidencia text DEFAULT NULL,
  _valid_until timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _op public.internal_operators%rowtype;
  _link public.operator_task_links%rowtype;
  _aprov public.operator_approvals%rowtype;
  _versao integer;
  _decisao jsonb;
BEGIN
  SELECT * INTO _op FROM public.internal_operators WHERE slug = lower(trim(_operator_slug));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'operator_not_found: % nao existe na hierarquia', _operator_slug;
  END IF;
  IF _op.status <> 'active' THEN
    RAISE EXCEPTION 'operator_paused: % esta pausado e nao pede aprovacao ate ser reativado', _op.slug;
  END IF;

  SELECT * INTO _link FROM public.operator_task_links WHERE id = _link_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'link_not_found: vinculo % nao existe', _link_id;
  END IF;

  IF nullif(trim(_o_que), '') IS NULL OR nullif(trim(_por_que), '') IS NULL THEN
    RAISE EXCEPTION 'explicacao_obrigatoria: aprovacao sem "o que" e "por que" nao entra na fila';
  END IF;

  SELECT coalesce(max(payload_version), 0) + 1 INTO _versao
    FROM public.operator_approvals
   WHERE task_link_id = _link.id AND action_kind = _action_kind;

  INSERT INTO public.operator_approvals
    (operator_id, task_link_id, kanban_task_id, action_kind, o_que, por_que,
     dados_usados, destino, impacto, risco, custo_previsto, prazo, reversivel,
     payload, payload_version, evidencia, valid_until)
  VALUES
    (_op.id, _link.id, _link.kanban_task_id, _action_kind, trim(_o_que), trim(_por_que),
     _dados_usados, _destino, _impacto, _risco, _custo_previsto, _prazo,
     coalesce(_reversivel, true), coalesce(_payload, '{}'::jsonb), _versao,
     _evidencia, _valid_until)
  RETURNING * INTO _aprov;

  INSERT INTO public.operator_audit_log
    (actor, operator_id, task_link_id, kanban_task_id, action, approval_required)
  VALUES ('mcp:' || _op.slug, _op.id, _link.id, _link.kanban_task_id,
          'pediu aprovacao: ' || _action_kind || ' v' || _versao, true);

  -- Regra permanente: dentro dela, o pedido já sai aprovado e não vai para a caixa do dono.
  _decisao := app_private.regra_permanente_avaliar(_op.slug, _action_kind, _payload, _custo_previsto, _link.kanban_task_id);
  IF COALESCE((_decisao->>'autoriza')::boolean, false) THEN
    PERFORM app_private.regra_permanente_aprovar(_aprov.id, _decisao, 'regra:' || (_decisao->>'regra'));
    RETURN jsonb_build_object(
      'ok', true, 'approval_id', _aprov.id, 'payload_version', _versao,
      'status', 'aprovado', 'autorizado_por_regra', _decisao->>'regra', 'motivo', _decisao->>'motivo',
      'regra', 'aprovado por regra permanente do dono: pode executar ESTE payload, e so ele; o uso ficou registrado'
    );
  END IF;

  UPDATE public.operator_task_links
     SET approval_required = true, updated_at = now()
   WHERE id = _link.id;

  INSERT INTO public.notifications (user_id, message, notification_type, link)
  SELECT ur.user_id,
    _op.display_name || ' pede aprovacao para ' || replace(_action_kind, '_', ' ')
      || ': ' || left(trim(_o_que), 140),
    'aprovacao_necessaria',
    '/execucao?aprovacao=' || _aprov.id
  FROM public.user_roles ur WHERE ur.role = 'admin';

  RETURN jsonb_build_object(
    'ok', true, 'approval_id', _aprov.id, 'payload_version', _versao,
    'status', 'pendente', 'por_que_subiu', _decisao->>'motivo',
    'regra', 'nada e executado ate um humano aprovar; e o executado tem que ser ESTE payload'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.operator_request_approval(
  text, uuid, text, text, text, jsonb, text, text, text, text,
  numeric, date, boolean, text, timestamptz
) FROM anon, authenticated;

-- ───────────────────────── 4) o dono liga, desliga e muda o limite ─────────────────────────
CREATE OR REPLACE FUNCTION public.regra_permanente_ajustar(_chave text, _ligada boolean DEFAULT NULL, _limites jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _eu uuid := auth.uid();
  _antes public.regras_permanentes%ROWTYPE;
  _depois public.regras_permanentes%ROWTYPE;
  _modelo record;
BEGIN
  IF _eu IS NULL OR NOT public.has_role(_eu, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'so_o_dono' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _antes FROM public.regras_permanentes WHERE chave = _chave FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'regra_nao_encontrada' USING ERRCODE = 'P0002'; END IF;
  IF _limites IS NOT NULL AND jsonb_typeof(_limites) <> 'object' THEN
    RAISE EXCEPTION 'limites_invalidos' USING ERRCODE = '22023';
  END IF;

  UPDATE public.regras_permanentes
     SET ligada = COALESCE(_ligada, ligada), limites = COALESCE(_limites, limites), atualizado_em = now(), atualizado_por = _eu
   WHERE chave = _chave
  RETURNING * INTO _depois;

  -- Mensagens de rotina só liga com os textos dos modelos preenchidos.
  IF _depois.chave = 'mensagens_de_rotina' AND _depois.ligada THEN
    FOR _modelo IN SELECT key, value FROM jsonb_each(COALESCE(_depois.limites->'modelos', '{}'::jsonb)) LOOP
      IF btrim(COALESCE(_modelo.value->>'texto', '')) = '' THEN
        RAISE EXCEPTION 'falta_texto_do_modelo: %', _modelo.key USING ERRCODE = '22023';
      END IF;
    END LOOP;
    IF COALESCE(_depois.limites->'modelos', '{}'::jsonb) = '{}'::jsonb THEN
      RAISE EXCEPTION 'falta_texto_do_modelo' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.operator_audit_log (actor, action, old_status, new_status, evidence)
  VALUES ('humano:' || _eu::text, 'regra permanente ' || _chave || ' ajustada',
          CASE WHEN _antes.ligada THEN 'ligada' ELSE 'desligada' END,
          CASE WHEN _depois.ligada THEN 'ligada' ELSE 'desligada' END,
          CASE WHEN _limites IS NOT NULL AND _limites IS DISTINCT FROM _antes.limites THEN 'limites alterados' ELSE NULL END);
  RETURN jsonb_build_object('ok', true, 'chave', _chave, 'ligada', _depois.ligada);
END;
$$;

-- Limpa a fila: pedidos pendentes que hoje cabem numa regra. _aplicar=false só mostra.
CREATE OR REPLACE FUNCTION public.regras_permanentes_limpar_fila(_aplicar boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _eu uuid := auth.uid();
  _a record;
  _d jsonb;
  _itens jsonb := '[]'::jsonb;
BEGIN
  IF _eu IS NULL OR NOT public.has_role(_eu, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'so_o_dono' USING ERRCODE = '42501';
  END IF;
  FOR _a IN
    SELECT ap.id, ap.action_kind, ap.payload, ap.custo_previsto, ap.kanban_task_id, ap.o_que, ap.created_at, o.slug
      FROM public.operator_approvals ap JOIN public.internal_operators o ON o.id = ap.operator_id
     WHERE ap.status = 'pendente' ORDER BY ap.created_at
  LOOP
    _d := app_private.regra_permanente_avaliar(_a.slug, _a.action_kind, _a.payload, _a.custo_previsto, _a.kanban_task_id);
    IF COALESCE((_d->>'autoriza')::boolean, false) THEN
      _itens := _itens || jsonb_build_object('approval_id', _a.id, 'regra', _d->>'regra', 'operador', _a.slug,
                                             'acao', _a.action_kind, 'o_que', left(_a.o_que, 200), 'criado_em', _a.created_at);
      IF _aplicar THEN
        PERFORM app_private.regra_permanente_aprovar(_a.id, _d, 'humano:' || _eu::text || ':limpeza');
      END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('total', jsonb_array_length(_itens), 'aplicado', COALESCE(_aplicar, false), 'itens', _itens);
END;
$$;

REVOKE ALL ON FUNCTION public.regra_permanente_ajustar(text, boolean, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.regras_permanentes_limpar_fila(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regra_permanente_ajustar(text, boolean, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regras_permanentes_limpar_fila(boolean) TO authenticated, service_role;
