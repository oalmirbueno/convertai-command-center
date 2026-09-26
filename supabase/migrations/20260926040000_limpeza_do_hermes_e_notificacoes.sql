-- Limpeza pedida pelo dono em 26/09 ("apagar as tarefas do Hermes e tudo o que
-- acumulou"). Nada é apagado de vez: cada linha tirada vai antes para
-- app_private.arquivo_limpeza (lote 'hermes-2609'), e dá para restaurar.
-- A trilha de auditoria do Hermes (operator_audit_log) é imutável e fica.
CREATE TABLE IF NOT EXISTS app_private.arquivo_limpeza (
  id bigserial PRIMARY KEY,
  lote text NOT NULL,
  tabela text NOT NULL,
  acao text NOT NULL,
  linha jsonb NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON app_private.arquivo_limpeza FROM PUBLIC, anon, authenticated;

-- 1) Execuções do Hermes que não terminaram (tempo esgotado, paradas, em revisão)
INSERT INTO app_private.arquivo_limpeza (lote, tabela, acao, linha)
SELECT 'hermes-2609', 'operator_runs', 'removida', to_jsonb(r) FROM public.operator_runs r
WHERE r.status <> 'done' OR r.task_link_id IN (SELECT id FROM public.operator_task_links WHERE status <> 'done');
DELETE FROM public.operator_runs r
WHERE r.status <> 'done' OR r.task_link_id IN (SELECT id FROM public.operator_task_links WHERE status <> 'done');

-- 2) Vínculos de tarefa do Hermes abertos (fila, bloqueados, esperando, revisão)
INSERT INTO app_private.arquivo_limpeza (lote, tabela, acao, linha)
SELECT 'hermes-2609', 'tasks', 'arquivada', to_jsonb(t)
FROM public.tasks t JOIN public.operator_task_links l ON l.painel_task_id = t.id
WHERE l.status <> 'done' AND t.deleted_at IS NULL AND t.status <> 'done';
UPDATE public.tasks t SET deleted_at = now()
FROM public.operator_task_links l
WHERE l.painel_task_id = t.id AND l.status <> 'done' AND t.deleted_at IS NULL AND t.status <> 'done';

INSERT INTO app_private.arquivo_limpeza (lote, tabela, acao, linha)
SELECT 'hermes-2609', 'operator_task_links', 'removido', to_jsonb(l) FROM public.operator_task_links l WHERE l.status <> 'done'
  AND NOT EXISTS (SELECT 1 FROM public.operator_runs r WHERE r.task_link_id = l.id);
DELETE FROM public.operator_task_links l WHERE l.status <> 'done'
  AND NOT EXISTS (SELECT 1 FROM public.operator_runs r WHERE r.task_link_id = l.id);

-- 3) Aprovações marcadas como aprovadas e nunca executadas: expiram
INSERT INTO app_private.arquivo_limpeza (lote, tabela, acao, linha)
SELECT 'hermes-2609', 'operator_approvals', 'expirada', to_jsonb(a) FROM public.operator_approvals a
WHERE a.executed_at IS NULL AND a.invalidated_at IS NULL AND a.status IN ('pendente', 'aprovado', 'adiado', 'alteracoes_pedidas');
UPDATE public.operator_approvals SET status = 'expirado', invalidated_at = now(), invalidation_reason = 'limpeza_do_dono_2609'
WHERE executed_at IS NULL AND invalidated_at IS NULL AND status IN ('pendente', 'aprovado', 'adiado', 'alteracoes_pedidas');

-- 4) Notificações acumuladas não lidas das contas do dono (Almir, admin do Hermes e robô do N8N)
INSERT INTO app_private.arquivo_limpeza (lote, tabela, acao, linha)
SELECT 'hermes-2609', 'notifications', 'marcada_lida', jsonb_build_object('id', n.id, 'user_id', n.user_id)
FROM public.notifications n
WHERE coalesce(n.read, false) = false
  AND n.user_id IN ('06848537-c3df-4601-8aaf-12e8653d88dd', 'fdb91b7d-6356-4d1d-b7b8-f72483d265fa', '528fb32d-33ce-4c98-84bf-fbc756262f49');
UPDATE public.notifications SET read = true
WHERE coalesce(read, false) = false
  AND user_id IN ('06848537-c3df-4601-8aaf-12e8653d88dd', 'fdb91b7d-6356-4d1d-b7b8-f72483d265fa', '528fb32d-33ce-4c98-84bf-fbc756262f49');
