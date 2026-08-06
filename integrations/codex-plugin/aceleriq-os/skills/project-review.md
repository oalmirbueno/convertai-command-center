---
name: project-review
description: Auditoria estruturada de um projeto — apenas leitura, saída em relatório Markdown pronto para revisão humana.
scopes: [aceleriq:read]
tools: [aceleriq_get_project, aceleriq_list_tasks, aceleriq_list_reports, aceleriq_list_files, aceleriq_list_workspace_nodes]
---

# Revisão de Projetos

## Objetivo
Produzir um panorama executivo de um projeto: escopo, progresso, riscos,
entregas pendentes e sinais de bloqueio. **Nenhuma escrita.** Se a revisão
sugerir criar tarefa ou rascunho de relatório, apresente a sugestão e
aguarde confirmação — não execute automaticamente.

## Checklist
1. `aceleriq_get_project` — marcos, tarefas resumidas, arquivos, relatórios.
2. `aceleriq_list_tasks` (`project_id=<uuid>`, `only_open=true`). Para uma
   etapa específica, use `status`.
3. `aceleriq_list_reports` — últimos 3 relatórios entregues.
4. `aceleriq_list_files` (`approval_status=pending`) — bloqueios de aprovação.
5. `aceleriq_list_workspace_nodes` (opcional) — entregáveis em produção.

Os passos 3–5 exigem que essas tools estejam visíveis. No endpoint legado com
papel restrito elas ficam ocultas até receberem recorte próprio por cliente;
nesse caso, conclua a revisão com projeto e tarefas, sem tentar contornar o
bloqueio.

## Saída sugerida
```
## Projeto <name>
- Status: <status> · Progresso: <progress>%
- Marco atual: <milestone>
- Tarefas abertas: <n> (bloqueadas: <n>)
- Aprovações pendentes: <n>
- Relatórios recentes: <lista>
- Riscos identificados: <bullets>
- Próximos passos sugeridos: <bullets>
```

## Restrições
- Não expor notas internas de relatórios.
- Não incluir dados de outros clientes por engano — filtre sempre por `project_id`.
