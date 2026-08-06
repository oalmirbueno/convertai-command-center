# Exemplo 06 — Linha e calendário editorial

## Consultar carrosséis do período

```json
{
  "jsonrpc": "2.0",
  "id": 21,
  "method": "tools/call",
  "params": {
    "name": "aceleriq_list_editorial_calendar",
    "arguments": {
      "client_id": "…uuid-cliente…",
      "project_id": "…uuid-projeto…",
      "date_from": "2026-08-01",
      "date_to": "2026-08-31",
      "format": "carousel",
      "include_unscheduled": false,
      "limit": 100,
      "offset": 0
    }
  }
}
```

O retorno mistura, em uma única página cronológica, posts editoriais ativos e
tarefas publicáveis ainda sem post. Um post ligado substitui sua tarefa para
não contar a mesma pauta duas vezes. Contas e arquivos retornam somente
metadados seguros, sem token, caminho de Storage ou estado interno.

## Adicionar pauta sem agendar

```json
{
  "jsonrpc": "2.0",
  "id": 22,
  "method": "tools/call",
  "params": {
    "name": "aceleriq_create_editorial_item",
    "arguments": {
      "client_id": "…uuid-cliente…",
      "project_id": "…uuid-projeto…",
      "title": "Carrossel: 5 erros no primeiro anúncio",
      "description": "Criar sete cards com capa, cinco erros e CTA final.",
      "format": "carousel",
      "due_date": "2026-08-20",
      "priority": "high",
      "idempotency_key": "linha-editorial:cliente:2026-08:carrossel-01"
    }
  }
}
```

Essa chamada não cria aprovação, plano de publicação ou postagem externa.
