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
  `status`, `priority`, `due_date`, `assigned_to`, `estimated_hours`.
  Qualquer outro campo é rejeitado pelo servidor.
- `update_task` **não** permite trocar `project_id`, `source`, `created_at`
  nem propriedade.
- `complete_task` recusa tarefas já concluídas — sempre verificar `status`
  antes de reexecutar.
- Enviar `correlation_id` estável (UUID v4) para garantir idempotência: um
  replay do mesmo `correlation_id` retorna o registro original.

## Fluxo recomendado
1. Listar tarefas atuais com `aceleriq_list_tasks` para evitar duplicatas.
2. Se for necessário criar, gerar `correlation_id` e chamar `create_task`.
3. Retornar ao usuário o `id` final para conferência (o servidor devolve o
   registro completo).

## O que NÃO fazer
- Não expor `delete_task` (não existe nesta camada).
- Não usar `create_task` para "mover" tarefa entre projetos — recuse.
- Não escrever em `tasks.source` — o servidor força `source='mcp'`.
