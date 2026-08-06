# Exemplo 03 — Criar tarefa idempotente

```json
{
  "jsonrpc": "2.0", "id": 42, "method": "tools/call",
  "params": {
    "name": "aceleriq_create_task",
    "arguments": {
      "project_id": "…uuid…",
      "title": "Revisar copy do anúncio v3",
      "description": "Rever CTA e provas sociais antes do envio.",
      "status": "todo",
      "priority": "high",
      "due_date": "2026-07-15",
      "delivery_type": "copywriting",
      "idempotency_key": "revisar-copy-anuncio-v3:2026-07-15"
    }
  }
}
```

Regras aplicadas automaticamente pelo servidor:
- `source = 'mcp'` (não aceito no input);
- Replay da mesma `idempotency_key` devolve o registro original — sem duplicar;
- Campos desconhecidos são rejeitados;
- Log gravado em `mcp_audit_log` com `key_id` + `origin`.
