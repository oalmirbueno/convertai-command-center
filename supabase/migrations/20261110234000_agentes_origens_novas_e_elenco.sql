-- Hierarquia: origens novas e elenco completo (10/11/2026, pedido do dono).
--
-- "Tem o Mercúrio do Hermes e o Mercúrio do Grok, os dois têm que estar lá; também o Rafael da automação
--  do n8n, o Claude Code, o Codex e o Dot do ChatGPT. O Money é comercial e finanças; o Orion entra no
--  marketing, cuida de social media e conteúdo dos clientes."
--
-- O que muda:
--   1. origem aceita também n8n, claude_code, codex e chatgpt;
--   2. Mercúrio volta a ser do Hermes (a migration anterior o marcou como Grok por engano de leitura) e
--      o Mercúrio do Grok entra como agente próprio;
--   3. entram Rafael (n8n), Claude Code, Codex e Dot (ChatGPT);
--   4. Money vai para Comercial (receita, finanças e oportunidades de freela) e Orion para Marketing;
--   5. a automação do Rafael age no painel com o nome interno "mercurio": as ferramentas do comercial
--      passam a marcar a última execução do Rafael também.
--
-- Fonte das funções: mapa do time registrado no segundo cérebro em 08/11/2026 e o pedido do dono.
-- Não toca em post, anúncio, financeiro nem mensagem a cliente. Não cria credencial nem permissão.

-- ───────────────────────── 1) origens ─────────────────────────
ALTER TABLE public.internal_operators DROP CONSTRAINT IF EXISTS internal_operators_origem_check;
ALTER TABLE public.internal_operators
  ADD CONSTRAINT internal_operators_origem_check
  CHECK (origem IN ('hermes', 'grok', 'paperclip', 'n8n', 'claude_code', 'codex', 'chatgpt'));

-- Quem se cadastra sozinho: a origem sai do prefixo da referência quando ele é uma origem conhecida.
CREATE OR REPLACE FUNCTION app_private.operador_origem_no_cadastro()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  _prefixo text := split_part(COALESCE(NEW.hermes_profile_ref, ''), ':', 1);
BEGIN
  IF NEW.origem IS NULL OR NEW.origem = 'hermes' THEN
    NEW.origem := CASE
      WHEN _prefixo IN ('grok', 'n8n', 'claude_code', 'codex', 'chatgpt', 'paperclip') THEN _prefixo
      WHEN NEW.parent_slug = 'paperclip' THEN 'paperclip'
      ELSE 'hermes'
    END;
  END IF;
  RETURN NEW;
END;
$$;

-- ───────────────────────── 2 a 4) elenco ─────────────────────────
UPDATE public.internal_operators SET origem = 'hermes' WHERE slug = 'mercurio';

UPDATE public.internal_operators
   SET area = 'Comercial', role = 'Receita, finanças e oportunidades', display_order = 44,
       scope = 'Bot do Grok: receita e caixa, e busca de oportunidades nas plataformas de freela. Só leitura no financeiro: não lança, não cobra e não fala com cliente sem aprovação.'
 WHERE slug = 'money';

UPDATE public.internal_operators
   SET area = 'Marketing', role = 'Social media e conteúdo dos clientes', display_order = 34,
       scope = 'Bot do Grok: cuida da operação de social media e do conteúdo dos clientes (artes, peças e calendário depois da revisão). Não publica nem notifica cliente sem aprovação.'
 WHERE slug = 'orion';

INSERT INTO public.internal_operators
  (slug, display_name, role, status, scope, permissions, hermes_profile_ref, is_coordinator, area, parent_slug, display_order, origem)
VALUES
  ('mercurio-grok', 'Mercúrio (Grok)', 'Comercial por oportunidade', 'active',
   'Bot do Grok: comercial por oportunidade e receita. Não é o Mercúrio do Hermes. Não envia proposta nem fala com cliente sem aprovação.',
   '{}'::jsonb, 'grok:mercurio', false, 'Comercial', 'jori', 43, 'grok'),
  ('rafael', 'Rafael', 'Vendedor de WhatsApp (automação do n8n)', 'active',
   'Automação do n8n no número oficial: prospecta, responde texto e áudio, trata objeção, gera Pix, marca reunião e repassa para a equipe. Por dentro do painel ele age com o nome Mercúrio.',
   '{}'::jsonb, 'n8n:rafael', false, 'Comercial', 'mercurio', 41, 'n8n'),
  ('claude-code', 'Claude Code', 'Código, front e vídeo por código', 'active',
   'Claude Code na assinatura do Almir: código do painel, front, vídeo por código e o trabalho pesado de materiais. Publica só o que foi testado; chave, gasto e conta de anúncio dependem do Almir.',
   '{}'::jsonb, 'claude_code:claude-code', false, 'Tecnologia', NULL, 82, 'claude_code'),
  ('codex', 'Codex', 'Scripts, testes e revisão cruzada', 'active',
   'Codex: scripts, testes, revisão cruzada do código e memória. Não migra motor de projeto existente sem motivo.',
   '{}'::jsonb, 'codex:codex', false, 'Tecnologia', NULL, 83, 'codex'),
  ('dot', 'Dot', 'Assistente no ChatGPT', 'active',
   'Dot, no ChatGPT: conversa, contexto e orientação que chegam ao painel pela conexão do ChatGPT. Não age em cliente, post, anúncio nem financeiro sem aprovação.',
   '{}'::jsonb, 'chatgpt:dot', false, 'Coordenação', NULL, 6, 'chatgpt')
ON CONFLICT (slug) DO NOTHING;

-- ───────────────────────── 5) o Rafael aparece trabalhando ─────────────────────────
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
  -- A conversa do comercial registrada como "mercurio" vem da automação do Rafael (n8n).
  IF _slug = 'mercurio' AND NEW.tool_name LIKE 'aceleriq_comercial_%' THEN
    PERFORM app_private.operador_marcar_execucao('rafael', COALESCE(NEW.created_at, now()));
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- O registro de auditoria vale mais que a marca de execução: nunca falha por causa dela.
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION app_private.mcp_audit_marca_execucao() FROM PUBLIC, anon, authenticated;

-- O Rafael já trabalhou hoje: a marca dele nasce com a última conversa do comercial (janela de 3 dias).
UPDATE public.internal_operators o
   SET last_run_at = x.quando
  FROM (SELECT max(l.created_at) AS quando
          FROM public.mcp_audit_log l
         WHERE l.created_at > now() - interval '3 days' AND l.success
           AND l.tool_name LIKE 'aceleriq_comercial_%'
           AND NOT app_private.mcp_ferramenta_e_leitura(l.tool_name)
           AND l.tool_name <> 'aceleriq_comercial_atribuir_agente'
           AND lower(COALESCE(l.sanitized_input->>'operador', l.sanitized_input->>'operator', '')) = 'mercurio') x
 WHERE o.slug = 'rafael' AND x.quando IS NOT NULL AND (o.last_run_at IS NULL OR o.last_run_at < x.quando);
