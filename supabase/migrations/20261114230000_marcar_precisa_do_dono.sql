-- 14/11/2026: agência autogerenciável. Um agente marca, com o motivo, a
-- decisão que realmente depende do dono, sem precisar de vínculo de execução.
--
-- Autorização do Almir em 14/11/2026 (America/Sao_Paulo): 21h04, "pode
-- construir e publicar a próxima parte"; 21h53, seguir as próximas etapas em
-- paralelo, inclusive a mudança no banco.
--
-- Por que existe: operator_request_approval só abre pedido a partir de um
-- vínculo de execução (link_id) e de uma ação do catálogo fechado. Faltava o
-- caminho para "isto só o dono decide" quando não há vínculo. O pedido entra
-- em operator_approvals como qualquer outro, a tela de Execução já o mostra e
-- a caixa "Precisa de você" da Esteira já o lê como decisão pedida por agente.
--
-- O que esta migration faz:
--
-- A) operator_approvals.action_kind aceita um valor novo,
--    'pedir_decisao_do_dono'. O check é recriado com os 16 valores de sempre
--    mais este; nenhuma linha existente muda. O valor novo só entra pela RPC
--    abaixo: operator_request_approval e a ferramenta do MCP continuam com o
--    catálogo antigo.
--
-- B) Índice único parcial em request_key, só para o valor novo: a mesma chave
--    nunca vira dois pedidos.
--
-- C) marcar_precisa_do_dono(...): a equipe autenticada (admin, gestor, design,
--    tráfego), em nome de um operador ativo, grava UM pedido em aberto
--    (status 'pendente') em operator_approvals, registra na trilha dos
--    operadores e avisa os admins no sino do painel. Repetir a mesma chave
--    devolve o pedido que já existe.
--
-- O que esta migration NÃO faz: não aprova nada, não decide pelo dono, não
-- toca em files (approval_status, agency_approval_status), não toca em
-- estudio_trabalhos (entrega_status, carimbo da revisão), não chama
-- decide_file_approval nem aprovar_pelo_cliente, não agenda, não publica, não
-- envia mensagem a cliente, não marca o vínculo de execução
-- (operator_task_links fica como está), não altera Auth, política de RLS nem
-- função existente.
--
-- Migration nova e aditiva. Rollback em
-- docs/rollback/20261114230000_marcar_precisa_do_dono.sql (remove a função e
-- o índice; os pedidos já gravados ficam).

-- ─── A) O valor novo no catálogo de ações ───────────────────────────────────
-- Conferido em produção em 14/11/2026: o check tem este nome e exatamente os
-- 16 valores abaixo. A lista só cresce.

ALTER TABLE public.operator_approvals
  DROP CONSTRAINT IF EXISTS operator_approvals_action_kind_check;

ALTER TABLE public.operator_approvals
  ADD CONSTRAINT operator_approvals_action_kind_check CHECK (action_kind IN (
    'publicar', 'agendar', 'enviar_mensagem', 'contatar_cliente',
    'criar_proposta', 'enviar_contrato', 'ativar_campanha',
    'alterar_orcamento', 'gastar', 'alterar_financeiro',
    'alterar_permissoes', 'exportar_dados', 'excluir_dados',
    'mudar_estrategia', 'alterar_responsavel', 'promover_autonomia',
    'pedir_decisao_do_dono'
  ));

-- ─── B) Uma chave, um pedido ────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS operator_approvals_precisa_do_dono_key
  ON public.operator_approvals (request_key)
  WHERE action_kind = 'pedir_decisao_do_dono';

-- ─── C) A RPC ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.marcar_precisa_do_dono(
  p_operator_slug text,
  p_o_que text,
  p_por_que text,
  p_request_key text,
  p_client_id uuid DEFAULT NULL,
  p_link_id uuid DEFAULT NULL,
  p_kanban_task_id uuid DEFAULT NULL,
  p_custo_previsto numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  _ator uuid := auth.uid();
  _slug text := lower(btrim(COALESCE(p_operator_slug, '')));
  _o_que text := left(btrim(COALESCE(p_o_que, '')), 2000);
  _por_que text := left(btrim(COALESCE(p_por_que, '')), 2000);
  _pedido text := btrim(COALESCE(p_request_key, ''));
  _chave text;
  _op public.internal_operators%ROWTYPE;
  _tarefa uuid := p_kanban_task_id;
  _aprov public.operator_approvals%ROWTYPE;
BEGIN
  -- Só a equipe autenticada. O cliente do portal nunca passa daqui.
  IF _ator IS NULL OR NOT (
    public.has_role(_ator, 'admin'::public.app_role)
    OR public.has_role(_ator, 'manager'::public.app_role)
    OR public.has_role(_ator, 'design'::public.app_role)
    OR public.has_role(_ator, 'traffic'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'só a equipe da agência marca uma decisão para o dono' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _op FROM public.internal_operators WHERE slug = _slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'operador % não existe na hierarquia', _slug USING ERRCODE = '22023';
  END IF;
  IF _op.status <> 'active' THEN
    RAISE EXCEPTION 'operador % está pausado e não abre pedido até ser reativado', _slug USING ERRCODE = '22023';
  END IF;

  IF length(_o_que) < 10 THEN
    RAISE EXCEPTION 'diga o que precisa ser decidido (pelo menos 10 caracteres)' USING ERRCODE = '22023';
  END IF;
  IF length(_por_que) < 10 THEN
    RAISE EXCEPTION 'diga por que isto depende do dono (pelo menos 10 caracteres)' USING ERRCODE = '22023';
  END IF;
  IF length(_pedido) < 8 OR length(_pedido) > 120 THEN
    RAISE EXCEPTION 'a chave do pedido tem de 8 a 120 caracteres' USING ERRCODE = '22023';
  END IF;
  IF p_custo_previsto IS NOT NULL AND p_custo_previsto < 0 THEN
    RAISE EXCEPTION 'o custo previsto não pode ser negativo' USING ERRCODE = '22023';
  END IF;

  IF p_client_id IS NOT NULL AND NOT public.can_access_client(p_client_id) THEN
    RAISE EXCEPTION 'cliente não encontrado ou sem acesso a este cliente' USING ERRCODE = '42501';
  END IF;
  IF p_client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_client_id) THEN
    RAISE EXCEPTION 'cliente não encontrado ou sem acesso a este cliente' USING ERRCODE = '42501';
  END IF;

  -- O vínculo e a tarefa são só referência: nada neles é alterado.
  -- Conferimos que existem e que pertencem ao mesmo cliente do pedido.
  IF p_link_id IS NOT NULL THEN
    DECLARE
      _tarefa_do_vinculo uuid;
    BEGIN
      SELECT l.kanban_task_id INTO _tarefa_do_vinculo
        FROM public.operator_task_links l WHERE l.id = p_link_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'vínculo de execução % não existe', p_link_id USING ERRCODE = '22023';
      END IF;
      IF p_kanban_task_id IS NOT NULL AND _tarefa_do_vinculo IS NOT NULL
         AND _tarefa_do_vinculo IS DISTINCT FROM p_kanban_task_id THEN
        RAISE EXCEPTION 'o vínculo e a tarefa informados não são do mesmo trabalho' USING ERRCODE = '22023';
      END IF;
      _tarefa := COALESCE(_tarefa, _tarefa_do_vinculo);
    END;
  END IF;
  IF _tarefa IS NOT NULL THEN
    DECLARE
      _cliente_da_tarefa uuid;
    BEGIN
      SELECT pr.client_id INTO _cliente_da_tarefa
        FROM public.tasks t
        JOIN public.projects pr ON pr.id = t.project_id
       WHERE t.id = _tarefa AND t.deleted_at IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'tarefa % não existe', _tarefa USING ERRCODE = '22023';
      END IF;
      IF p_client_id IS NOT NULL AND _cliente_da_tarefa IS DISTINCT FROM p_client_id THEN
        RAISE EXCEPTION 'a tarefa ou o vínculo não pertence a este cliente' USING ERRCODE = '22023';
      END IF;
    END;
  ELSIF p_kanban_task_id IS NOT NULL THEN
    RAISE EXCEPTION 'tarefa % não existe', p_kanban_task_id USING ERRCODE = '22023';
  END IF;

  -- Idempotência: a chave é do operador E do cliente (ou "interno").
  -- Sem o cliente na chave, a mesma chave em outro cliente devolvia o pedido
  -- alheio e não gravava o novo.
  _chave := 'precisa_do_dono:' || _slug || ':' || COALESCE(p_client_id::text, 'interno') || ':' || _pedido;
  PERFORM pg_advisory_xact_lock(hashtextextended(_chave, 0));

  SELECT * INTO _aprov FROM public.operator_approvals
   WHERE action_kind = 'pedir_decisao_do_dono' AND request_key = _chave;
  IF FOUND THEN
    IF _aprov.operator_id IS DISTINCT FROM _op.id
       OR _aprov.client_id IS DISTINCT FROM p_client_id THEN
      RAISE EXCEPTION 'esta chave já foi usada em outro pedido' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'ja_existia', true,
      'approval_id', _aprov.id,
      'status', _aprov.status,
      'client_id', _aprov.client_id,
      'criado_em', _aprov.created_at,
      'link', '/execucao?aprovacao=' || _aprov.id::text,
      'regra', 'pedido já aberto com esta chave: nada novo foi gravado; nada foi aprovado, agendado nem publicado'
    );
  END IF;

  INSERT INTO public.operator_approvals
    (origin, operator_id, task_link_id, kanban_task_id, client_id, action_kind,
     o_que, por_que, custo_previsto, reversivel, payload, payload_version,
     status, request_key)
  VALUES
    ('operator', _op.id, p_link_id, _tarefa, p_client_id, 'pedir_decisao_do_dono',
     _o_que, _por_que, p_custo_previsto, true,
     jsonb_build_object('origem', 'precisa_de_voce', 'operador', _slug, 'pedido_por', _ator),
     1, 'pendente', _chave)
  RETURNING * INTO _aprov;

  INSERT INTO public.operator_audit_log
    (actor, operator_id, task_link_id, kanban_task_id, action, approval_required)
  VALUES ('mcp:' || _slug, _op.id, p_link_id, _tarefa,
          'marcou decisão para o dono: ' || left(_o_que, 140), true);

  -- Aviso interno, no sino dos admins do painel. Nenhum cliente é avisado.
  INSERT INTO public.notifications (user_id, message, notification_type, link)
  SELECT ur.user_id,
         _op.display_name || ' precisa da sua decisão: ' || left(_o_que, 140),
         'aprovacao_necessaria',
         '/execucao?aprovacao=' || _aprov.id::text
    FROM public.user_roles ur WHERE ur.role = 'admin'::public.app_role;

  RETURN jsonb_build_object(
    'ok', true,
    'ja_existia', false,
    'approval_id', _aprov.id,
    'status', _aprov.status,
    'client_id', _aprov.client_id,
    'criado_em', _aprov.created_at,
    'link', '/execucao?aprovacao=' || _aprov.id::text,
    'regra', 'só o pedido foi gravado: nada foi aprovado, agendado nem publicado; a decisão é do dono, na Execução'
  );
END;
$function$;

COMMENT ON FUNCTION public.marcar_precisa_do_dono(text, text, text, text, uuid, uuid, uuid, numeric) IS
  'Um agente (operador ativo), pela equipe autenticada, marca uma decisão que depende do dono: grava um pedido pendente em operator_approvals (action_kind pedir_decisao_do_dono), a trilha e o aviso aos admins. Idempotente pela chave. Nunca aprova, nunca agenda, nunca publica e não altera arquivo, peça, agenda nem vínculo.';

REVOKE ALL ON FUNCTION public.marcar_precisa_do_dono(text, text, text, text, uuid, uuid, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcar_precisa_do_dono(text, text, text, text, uuid, uuid, uuid, numeric) TO authenticated;
