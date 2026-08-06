# Exemplo 04 — Rascunho de relatório

```json
{
  "jsonrpc": "2.0", "id": 7, "method": "tools/call",
  "params": {
    "name": "aceleriq_create_report_draft",
    "arguments": {
      "project_id": "…uuid…",
      "title": "Semanal · S28",
      "period_start": "2026-07-06",
      "period_end":   "2026-07-12",
      "metrics":     { "impressions": 128340, "ctr": 2.1, "cpl": 4.7 },
      "highlights":  "Novo criativo bateu 3,4% CTR. CPL caiu 22% na semana.",
      "next_steps":  "Escalar os dois melhores criativos e testar novo público lookalike.",
      "idempotency_key": "relatorio-semanal:s28:2026"
    }
  }
}
```

Garantido pelo servidor:
- `status = 'draft'` — não publica, não envia, não notifica cliente;
- `client_id` derivado de `project_id` — não aceito no input;
- Retorna o registro final para conferência.
