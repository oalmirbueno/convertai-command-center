---
name: reports
description: Consultar relatórios existentes e gerar rascunhos (nunca publicar/enviar) via MCP.
scopes: [aceleriq:read, aceleriq:write]
tools: [aceleriq_list_reports, aceleriq_get_report, aceleriq_create_report_draft]
---

# Relatórios

No endpoint legado, leitura de relatórios requer credencial admin/unrestricted
até o serviço receber recorte próprio por cliente. Para credenciais restritas,
`create_report_draft` continua disponível em projetos atribuídos, mas não
presuma que `list_reports` ou `get_report` aparecerão em `tools/list`.

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
- Sempre gerar `idempotency_key` estável para permitir replay seguro.
- Preencher `metrics`, `highlights` e `next_steps` com dados reais extraídos
  de `aceleriq_get_project` / `aceleriq_list_tasks` — nunca fabricados.
- Nunca chamar `create_report_draft` sem antes checar
  `aceleriq_get_project` para validar existência.
