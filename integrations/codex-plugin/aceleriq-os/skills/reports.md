---
name: reports
description: Consultar relatórios existentes e gerar rascunhos (nunca publicar/enviar) via MCP.
scopes: [aceleriq:read, aceleriq:write]
tools: [aceleriq_list_reports, aceleriq_get_report, aceleriq_create_report_draft]
---

# Relatórios

## Leitura
- `aceleriq_list_reports` aceita filtros por `client_id` ou `project_id`.
- `aceleriq_get_report` devolve métricas, highlights e próximos passos.
  **Notas internas não são expostas** — não invente conteúdo delas.

## Escrita (rascunho apenas)
`aceleriq_create_report_draft` **sempre** força:
- `status = 'draft'`;
- `client_id` derivado do `project_id` (não aceito no input);
- nenhum campo de publicação, envio ou aprovação automática.

Se o usuário pedir "publicar" ou "enviar para o cliente", responda que essa
operação não está disponível via MCP e precisa ser feita pelo painel.

## Boas práticas
- Sempre gerar `correlation_id` estável para permitir replay seguro.
- Preencher `metrics`, `highlights` e `next_steps` com dados reais extraídos
  de `aceleriq_get_project` / `aceleriq_list_tasks` — nunca fabricados.
- Nunca chamar `create_report_draft` sem antes checar
  `aceleriq_get_project` para validar existência.
