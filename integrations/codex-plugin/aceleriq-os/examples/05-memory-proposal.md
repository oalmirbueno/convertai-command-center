# Exemplo 05 — Proposta no Segundo Cérebro

```json
{
  "jsonrpc": "2.0", "id": 11, "method": "tools/call",
  "params": {
    "name": "memory_propose_update",
    "arguments": {
      "correlation_id": "d0f1a2b3-…",
      "origin": "codex",
      "title": "Padrão de assinatura de e-mails de aprovação",
      "tags": ["email", "aprovacao"],
      "content": "---\norigin: codex\ntitle: Assinatura de e-mails de aprovação\n---\n\n## Contexto\n… texto proposto em Markdown …\n"
    }
  }
}
```

Resposta (exemplo):
```json
{ "path": "memory/inbox/chatgpt/2026-07-12T193045Z-assinatura-aprovacao-d0f1a2b3.md",
  "commit_sha": "…", "html_url": "https://github.com/…" }
```

⚠️ Path é forçado para `memory/inbox/chatgpt/`. Ver `docs/adapters.md` para
como habilitar inbox por agente no futuro.
