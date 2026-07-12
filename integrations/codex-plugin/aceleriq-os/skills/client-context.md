---
name: client-context
description: Reunir dossiê completo de um cliente do Aceleriq OS antes de qualquer ação (criar tarefa, propor mudança, gerar relatório).
scopes: [aceleriq:read]
tools: [aceleriq_list_clients, aceleriq_get_client_context, aceleriq_list_projects, aceleriq_list_briefings]
---

# Contexto de Cliente

## Quando usar
Sempre que o usuário mencionar um cliente pelo nome ou pedir "resumo",
"situação", "pendências", "briefing" ou "próximos passos".

## Passos
1. `aceleriq_list_clients` com `search=<nome mencionado>`. Se houver mais de
   um match, peça desambiguação — nunca escolha silenciosamente.
2. `aceleriq_get_client_context` com o `id` resolvido. Este retorno já traz:
   perfil, projetos, tarefas abertas, marcos próximos e briefings.
3. Complementar apenas se necessário:
   - `aceleriq_list_projects` para status/histórico completo.
   - `aceleriq_list_briefings` para respostas do onboarding.

## Regras
- **Não** invente campos ausentes.
- **Não** derive `client_id` a partir do nome sem passar pelo passo 1.
- Se `get_client_context` retornar vazio, informe explicitamente ao usuário.
- Nunca chame `aceleriq:write` a partir desta skill.
