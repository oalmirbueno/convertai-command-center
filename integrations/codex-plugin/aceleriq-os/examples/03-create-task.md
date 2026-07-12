# Exemplo 03 — Criar tarefa idempotente

```json
{
  "jsonrpc": "2.0", "id": 42, "method": "tools/call",
  "params": {
    "name": "aceleriq_create_task",
    "arguments": {
      "correlation_id": "b7c9e2c1-9f52-4d2b-9c1e-2f7a2a3d1122",
      "project_id": "…uuid…",
      "title": "Revisar copy do anúncio v3",
      "description": "Rever CTA e provas sociais antes do envio.",
      "status": "todo",
      "priority": "high",
      "due_date": "2026-07-15",
      "estimated_hours": 2
    }
  }
}
```

Regras aplicadas automaticamente pelo servidor:
- `source = 'mcp'` (não aceito no input);
- Replay do mesmo `correlation_id` devolve o registro original — sem duplicar;
- Campos desconhecidos são rejeitados;
- Log gravado em `mcp_audit_log` com `key_id` + `origin`.
