-- Hierarquia de agentes: origem, última execução de agente externo e organização pelo painel (10/11/2026).
--
-- Pedido do dono:
--   1. editar, apagar e organizar os agentes pelo painel, com a origem (Hermes, Grok ou Paperclip) no cartão;
--   2. a Clio (ACQ-10) roda todo dia e aparecia "sem execução": só operator_report_event gravava last_run_at,
--      e agente externo (Hermes, Grok, n8n) que age pelo MCP nunca passa por ali;
--   3. atualizar a lista com os bots do Grok.
--
-- O que esta migration faz:
--   a) coluna `origem` em internal_operators (hermes, grok, paperclip), preenchida pelo que já se sabe;
--   b) public.operador_registrar_execucao(slug, quando): o registro explícito, para o n8n e as funções;
--   c) gatilho no mcp_audit_log: toda chamada de ESCRITA bem-sucedida em que o agente se identifica
--      (operator, operador, operator_slug ou o prefixo "slug:" da idempotency_key) marca last_run_at.
--      Leitura (fila, lista, consulta) não conta: senão um laço de consulta calaria o aviso
--      "nenhum agente roda há N dias". No máximo uma gravação a cada 5 minutos por agente, e o gatilho
--      nunca derruba o registro de auditoria;
--   d) public.operadores_reordenar (arrastar no painel) e public.operador_apagar_de_vez (só agente sem
--      histórico: a auditoria é imutável; quem tem histórico é aposentado);
--   e) os bots do Grok que faltavam e a área do Jori.
--
-- Não toca em post, anúncio, financeiro nem mensagem a cliente.

-- ───────────────────────── a) origem ─────────────────────────
ALTER TABLE public.internal_operators ADD COLUMN IF NOT EXISTS origem text;

UPDATE public.internal_operators
   SET origem = CASE
         WHEN hermes_profile_ref LIKE 'grok:%' THEN 'grok'
         WHEN slug = 'paperclip' OR parent_slug = 'paperclip' THEN 'paperclip'
         ELSE 'hermes'
       END
 WHERE origem IS NULL;

ALTER TABLE public.internal_operators ALTER COLUMN origem SET DEFAULT 'hermes';
ALTER TABLE public.internal_operators ALTER COLUMN origem SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'internal_operators_origem_check') THEN
    ALTER TABLE public.internal_operators
      ADD CONSTRAINT internal_operators_origem_check CHECK (origem IN ('hermes', 'grok', 'paperclip'));
  END IF;
END $$;

-- Agente que se cadastra sozinho (aceleriq_operator_register) não informa a origem: ela sai da referência
-- ("grok:...") ou do superior (time do Paperclip). Depois disso, quem manda é a edição no painel.
CREATE OR REPLACE FUNCTION app_private.operador_origem_no_cadastro()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF NEW.origem IS NULL OR NEW.origem = 'hermes' THEN
    NEW.origem := CASE
      WHEN NEW.hermes_profile_ref LIKE 'grok:%' THEN 'grok'
      WHEN NEW.parent_slug = 'paperclip' THEN 'paperclip'
      ELSE 'hermes'
    END;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS operador_origem_no_cadastro ON public.internal_operators;
CREATE TRIGGER operador_origem_no_cadastro
  BEFORE INSERT ON public.internal_operators
  FOR EACH ROW EXECUTE FUNCTION app_private.operador_origem_no_cadastro();

-- ───────────────────────── b) registro da execução ─────────────────────────
-- Marca a última execução. Só grava se a anterior tiver mais de 5 minutos (ou não existir), para um
-- agente que chama o MCP dezenas de vezes por minuto não virar dezenas de gravações.
CREATE OR REPLACE FUNCTION app_private.operador_marcar_execucao(_slug text, _quando timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _n integer;
BEGIN
  UPDATE public.internal_operators
     SET last_run_at = _quando
   WHERE slug = _slug
     AND (last_run_at IS NULL OR last_run_at < _quando - interval '5 minutes');
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n > 0;
END;
$$;
REVOKE ALL ON FUNCTION app_private.operador_marcar_execucao(text, timestamptz) FROM PUBLIC, anon, authenticated;

-- O registro explícito: o n8n (ACQ-10 da Clio) e as funções chamam ao terminar a rodada.
CREATE OR REPLACE FUNCTION public.operador_registrar_execucao(_operator_slug text, _quando timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _slug text := lower(btrim(COALESCE(_operator_slug, '')));
  _t timestamptz := COALESCE(_quando, now());
  _op public.internal_operators%ROWTYPE;
BEGIN
  IF _slug = '' THEN RAISE EXCEPTION 'OPERADOR_OBRIGATORIO'; END IF;
  -- Nem no futuro nem velho demais: o relógio de quem chama não manda no painel.
  IF _t > now() THEN _t := now(); END IF;
  IF _t < now() - interval '7 days' THEN RAISE EXCEPTION 'EXECUCAO_ANTIGA_DEMAIS: informe uma data dos ultimos 7 dias'; END IF;
  SELECT * INTO _op FROM public.internal_operators WHERE slug = _slug;
  IF NOT FOUND THEN RAISE EXCEPTION 'OPERADOR_NAO_ENCONTRADO: %', _slug; END IF;
  PERFORM app_private.operador_marcar_execucao(_slug, _t);
  SELECT * INTO _op FROM public.internal_operators WHERE slug = _slug;
  RETURN jsonb_build_object('operator', _op.slug, 'nome', _op.display_name, 'last_run_at', _op.last_run_at);
END;
$$;
REVOKE ALL ON FUNCTION public.operador_registrar_execucao(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.operador_registrar_execucao(text, timestamptz) TO service_role;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'acq_n8n_worker') THEN
    GRANT EXECUTE ON FUNCTION public.operador_registrar_execucao(text, timestamptz) TO acq_n8n_worker;
  END IF;
END $$;

-- ───────────────────────── c) gatilho no registro do MCP ─────────────────────────
-- Ferramenta de leitura não prova que o agente trabalhou.
CREATE OR REPLACE FUNCTION app_private.mcp_ferramenta_e_leitura(_tool text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
  SELECT COALESCE(_tool, '') ~ '(^aceleriq_(get|list|search|fetch)|^memory_(fetch|search|get|list|recent)|_(fila|queue|board|digest|contexto|saude|estado|candidatos|horarios|repasses|trabalhos)$|panorama|_guia$|_health$|_capabilities$|_overview$|_diagnostico$|base_dos_agentes|agent_conversations|audit_integrity|_boletim$|_membros$)';
$$;

CREATE OR REPLACE FUNCTION app_private.mcp_audit_marca_execucao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _e jsonb := NEW.sanitized_input;
  _chave text;
  _slug text;
BEGIN
  IF NEW.success IS NOT TRUE OR _e IS NULL OR jsonb_typeof(_e) <> 'object' THEN RETURN NULL; END IF;
  IF app_private.mcp_ferramenta_e_leitura(NEW.tool_name) THEN RETURN NULL; END IF;
  -- Nestas, "operator" é o ALVO (quem recebe a tarefa, quem é cadastrado), não quem age.
  IF NEW.tool_name IN ('aceleriq_operator_register', 'aceleriq_operator_organize', 'aceleriq_operator_assign',
                       'aceleriq_operator_propose_assignee', 'aceleriq_comercial_atribuir_agente', 'aceleriq_agent_handoff') THEN
    RETURN NULL;
  END IF;
  -- O diário serve para ler e para escrever: só a escrita conta.
  IF NEW.tool_name = 'aceleriq_operator_diary' AND NOT (_e ? 'body' OR _e ? 'entry_type') THEN RETURN NULL; END IF;

  _slug := COALESCE(_e->>'operator', _e->>'operador', _e->>'operator_slug');
  IF _slug IS NULL THEN
    _chave := _e->>'idempotency_key';
    IF _chave IS NOT NULL AND position(':' IN _chave) > 1 THEN _slug := split_part(_chave, ':', 1); END IF;
  END IF;
  _slug := lower(btrim(COALESCE(_slug, '')));
  IF _slug = '' OR length(_slug) > 60 THEN RETURN NULL; END IF;

  PERFORM app_private.operador_marcar_execucao(_slug, COALESCE(NEW.created_at, now()));
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- O registro de auditoria vale mais que a marca de execução: nunca falha por causa dela.
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION app_private.mcp_audit_marca_execucao() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS mcp_audit_marca_execucao ON public.mcp_audit_log;
CREATE TRIGGER mcp_audit_marca_execucao
  AFTER INSERT ON public.mcp_audit_log
  FOR EACH ROW WHEN (NEW.success)
  EXECUTE FUNCTION app_private.mcp_audit_marca_execucao();

-- O que já aconteceu nos últimos 3 dias (a Clio abriu tarefas e seguia "sem execução"). Janela curta
-- de propósito: a tabela é grande e a leitura vai pelo índice de created_at.
WITH chamadas AS (
  SELECT lower(btrim(COALESCE(
           l.sanitized_input->>'operator', l.sanitized_input->>'operador', l.sanitized_input->>'operator_slug',
           CASE WHEN position(':' IN COALESCE(l.sanitized_input->>'idempotency_key', '')) > 1
                THEN split_part(l.sanitized_input->>'idempotency_key', ':', 1) END))) AS slug,
         max(l.created_at) AS quando
    FROM public.mcp_audit_log l
   WHERE l.created_at > now() - interval '3 days'
     AND l.success
     AND jsonb_typeof(l.sanitized_input) = 'object'
     AND NOT app_private.mcp_ferramenta_e_leitura(l.tool_name)
     AND l.tool_name NOT IN ('aceleriq_operator_register', 'aceleriq_operator_organize', 'aceleriq_operator_assign',
                             'aceleriq_operator_propose_assignee', 'aceleriq_comercial_atribuir_agente', 'aceleriq_agent_handoff')
     AND (l.tool_name <> 'aceleriq_operator_diary' OR l.sanitized_input ? 'body' OR l.sanitized_input ? 'entry_type')
   GROUP BY 1
)
UPDATE public.internal_operators o
   SET last_run_at = c.quando
  FROM chamadas c
 WHERE c.slug = o.slug AND (o.last_run_at IS NULL OR o.last_run_at < c.quando);

-- ───────────────────────── d) organizar e apagar pelo painel ─────────────────────────
-- Arrastar: grava área, superior e ordem de vários agentes de uma vez. Só o admin.
CREATE OR REPLACE FUNCTION public.operadores_reordenar(_itens jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _i jsonb;
  _id uuid;
  _area text;
  _pai text;
  _slug text;
  _n integer := 0;
BEGIN
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'SO_ADMIN_ORGANIZA' USING ERRCODE = '42501';
  END IF;
  IF _itens IS NULL OR jsonb_typeof(_itens) <> 'array' OR jsonb_array_length(_itens) = 0 THEN RETURN 0; END IF;
  IF jsonb_array_length(_itens) > 300 THEN RAISE EXCEPTION 'ITENS_DEMAIS'; END IF;

  FOR _i IN SELECT * FROM jsonb_array_elements(_itens) LOOP
    _id := (_i->>'id')::uuid;
    SELECT slug INTO _slug FROM public.internal_operators WHERE id = _id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'OPERADOR_NAO_ENCONTRADO: %', _id; END IF;
    _area := NULLIF(btrim(COALESCE(_i->>'area', '')), '');
    _pai := NULLIF(lower(btrim(COALESCE(_i->>'parent_slug', ''))), '');
    IF _pai IS NOT NULL THEN
      IF _pai = _slug THEN RAISE EXCEPTION 'SUPERIOR_INVALIDO: o agente nao responde a si mesmo'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.internal_operators WHERE slug = _pai) THEN
        RAISE EXCEPTION 'SUPERIOR_NAO_ENCONTRADO: %', _pai;
      END IF;
    END IF;
    UPDATE public.internal_operators
       SET display_order = COALESCE((_i->>'display_order')::integer, display_order),
           area = CASE WHEN _i ? 'area' THEN _area ELSE area END,
           parent_slug = CASE WHEN _i ? 'parent_slug' THEN _pai ELSE parent_slug END
     WHERE id = _id;
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END;
$$;
REVOKE ALL ON FUNCTION public.operadores_reordenar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operadores_reordenar(jsonb) TO authenticated;

-- Quanto histórico o agente tem (a tela pergunta antes de oferecer "apagar de vez").
CREATE OR REPLACE FUNCTION app_private.operador_historico(_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT jsonb_build_object(
    'execucoes', (SELECT count(*) FROM public.operator_runs WHERE operator_id = _id),
    'tarefas', (SELECT count(*) FROM public.operator_task_links WHERE operator_id = _id),
    'auditoria', (SELECT count(*) FROM public.operator_audit_log WHERE operator_id = _id),
    'participacoes', (SELECT count(*) FROM public.operator_participations WHERE operator_id = _id),
    'aprovacoes', (SELECT count(*) FROM public.operator_approvals WHERE operator_id = _id),
    'propostas', (SELECT count(*) FROM public.assignment_proposals WHERE operator_id = _id),
    'entregas', (SELECT count(*) FROM public.operator_deliveries WHERE operator_id = _id),
    'subordinados', (SELECT count(*) FROM public.internal_operators f
                      WHERE f.parent_slug = (SELECT slug FROM public.internal_operators WHERE id = _id)),
    'chaves', (SELECT count(*) FROM public.operator_key_bindings b
                WHERE b.operator_slug = (SELECT slug FROM public.internal_operators WHERE id = _id)));
$$;
REVOKE ALL ON FUNCTION app_private.operador_historico(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.operador_historico(_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'SO_ADMIN' USING ERRCODE = '42501';
  END IF;
  RETURN app_private.operador_historico(_id);
END;
$$;
REVOKE ALL ON FUNCTION public.operador_historico(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operador_historico(uuid) TO authenticated;

-- Apagar de vez: só quem não deixou rastro. A auditoria é imutável (20260827200000), então agente com
-- histórico é aposentado, não apagado. Quem respondia a ele passa a responder ao superior dele.
CREATE OR REPLACE FUNCTION public.operador_apagar_de_vez(_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _op public.internal_operators%ROWTYPE;
  _h jsonb;
  _rastro bigint;
  _filhos integer;
BEGIN
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'SO_ADMIN_APAGA' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _op FROM public.internal_operators WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OPERADOR_NAO_ENCONTRADO'; END IF;
  _h := app_private.operador_historico(_id);
  _rastro := (_h->>'execucoes')::bigint + (_h->>'tarefas')::bigint + (_h->>'auditoria')::bigint
           + (_h->>'participacoes')::bigint + (_h->>'aprovacoes')::bigint + (_h->>'propostas')::bigint
           + (_h->>'entregas')::bigint;
  IF _rastro > 0 THEN
    RAISE EXCEPTION 'OPERADOR_COM_HISTORICO: % registros. Aposente em vez de apagar.', _rastro;
  END IF;
  IF (_h->>'chaves')::bigint > 0 THEN
    RAISE EXCEPTION 'OPERADOR_COM_CHAVE: ha credencial ligada a este agente. Aposente em vez de apagar.';
  END IF;
  UPDATE public.internal_operators SET parent_slug = _op.parent_slug WHERE parent_slug = _op.slug;
  GET DIAGNOSTICS _filhos = ROW_COUNT;
  DELETE FROM public.internal_operators WHERE id = _id;
  RETURN jsonb_build_object('apagado', _op.slug, 'nome', _op.display_name, 'subordinados_remanejados', _filhos);
END;
$$;
REVOKE ALL ON FUNCTION public.operador_apagar_de_vez(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operador_apagar_de_vez(uuid) TO authenticated;

-- ───────────────────────── e) os bots do Grok ─────────────────────────
-- Jori coordena os bots do Grok: a área estava como 'orquestracao' (minúscula, fora do padrão).
UPDATE public.internal_operators
   SET area = 'Coordenação', origem = 'grok', is_coordinator = true, display_order = 5
 WHERE slug = 'jori';

-- Elo já estava cadastrado ao lado da Clio (Clientes, mesmo superior): só a origem e a ordem ficam garantidas.
UPDATE public.internal_operators SET origem = 'grok', area = 'Clientes', display_order = 2 WHERE slug = 'elo';
UPDATE public.internal_operators SET area = 'Clientes', display_order = 1 WHERE slug = 'clio';

-- Mercúrio: o dono listou entre os bots do Grok. O histórico e o slug continuam os mesmos.
UPDATE public.internal_operators SET origem = 'grok' WHERE slug = 'mercurio';

-- Os que faltavam. ON CONFLICT: se o próprio bot já se cadastrou, o cadastro dele vale.
INSERT INTO public.internal_operators
  (slug, display_name, role, status, scope, permissions, hermes_profile_ref, is_coordinator, area, parent_slug, display_order, origem)
VALUES
  ('orion', 'Orion', 'Conteúdo', 'active',
   'Bot do Grok: conteúdo dos clientes a partir do contexto que o Elo passa. Não publica nem fala com cliente sem aprovação.',
   '{}'::jsonb, 'grok:orion', false, 'Conteúdo', 'jori', 10, 'grok'),
  ('trafe', 'Trafe', 'Tráfego pago', 'active',
   'Bot do Grok: leitura e proposta de tráfego pago a partir do contexto que o Elo passa. Não altera campanha nem verba sem aprovação.',
   '{}'::jsonb, 'grok:trafe', false, 'Tráfego', 'jori', 10, 'grok'),
  ('infra', 'Infra', 'Integrações', 'active',
   'Bot do Grok: integrações e infraestrutura das automações. Não muda credencial nem produção sem aprovação.',
   '{}'::jsonb, 'grok:infra', false, 'Tecnologia', 'jori', 81, 'grok'),
  ('garim', 'Garim', 'Referências', 'active',
   'Bot do Grok: garimpa referências de conteúdo, vídeo e design para a equipe.',
   '{}'::jsonb, 'grok:garim', false, 'Pesquisa', 'jori', 86, 'grok'),
  ('soci', 'Soci', 'Redes da Aceleriq', 'active',
   'Bot do Grok: redes sociais da própria Aceleriq. Não publica sem aprovação.',
   '{}'::jsonb, 'grok:soci', false, 'Marketing', 'jori', 33, 'grok'),
  ('drop', 'Drop', 'GATUM', 'active',
   'Bot do Grok: operação da GATUM (produtos e páginas).',
   '{}'::jsonb, 'grok:drop', false, 'GATUM', 'jori', 10, 'grok'),
  ('nomi', 'Nomi', 'Naming', 'active',
   'Bot do Grok: nomes de marca, produto e campanha.',
   '{}'::jsonb, 'grok:nomi', false, 'Marca', 'jori', 10, 'grok'),
  ('money', 'Money', 'Receita', 'active',
   'Bot do Grok: acompanha receita e oportunidades de caixa. Só leitura: não mexe no financeiro.',
   '{"finance_write": false}'::jsonb, 'grok:money', false, 'Finanças', 'jori', 51, 'grok')
ON CONFLICT (slug) DO NOTHING;
