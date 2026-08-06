---
name: task-management
description: Criar, atualizar e concluir tarefas do Aceleriq OS via MCP com allowlist estrita e idempotência.
scopes: [aceleriq:read, aceleriq:write]
tools: [aceleriq_list_tasks, aceleriq_create_task, aceleriq_update_task, aceleriq_complete_task]
---

# Gestão de Tarefas

## Regras não-negociáveis
- Nunca inventar `project_id` — resolver via `aceleriq_get_project` ou
  `aceleriq_list_projects` primeiro.
- `create_task` aceita **apenas**: `project_id`, `title`, `description`,
  `status`, `priority`, `delivery_type`, `due_date`, `assigned_to`,
  `milestone_id`, `idempotency_key`.
  Qualquer outro campo é rejeitado pelo servidor.
- `update_task` **não** permite trocar `project_id`, `source`, `created_at`
  nem propriedade.
- `complete_task` recusa tarefas já concluídas — sempre verificar `status`
  antes de reexecutar.
- Enviar `idempotency_key` estável (8–128 caracteres em
  `[A-Za-z0-9._:-]`) para garantir idempotência.

## Fluxo recomendado
1. Listar tarefas atuais com `aceleriq_list_tasks`, usando `client_id`,
   `project_id`, `status`, `only_open`, `delivery_type` ou `workstream`.
2. Se for necessário criar, gerar `idempotency_key` e chamar `create_task`.
3. Retornar ao usuário o `id` final para conferência (o servidor devolve o
   registro completo).

## O que NÃO fazer
- Não expor `delete_task` (não existe nesta camada).
- Não usar `create_task` para "mover" tarefa entre projetos — recuse.
- Não escrever em `tasks.source` — o servidor força `source='mcp'`.
