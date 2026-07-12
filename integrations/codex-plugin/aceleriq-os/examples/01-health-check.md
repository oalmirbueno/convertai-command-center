# Exemplo 01 — Health check e handshake

```bash
curl -sS "$ACELERIQ_MCP_URL" | jq '{name, version, toolCount, secondBrain}'
```

Retorno esperado (resumo):
```json
{
  "name": "aceleriq-mcp",
  "version": "1.1.0-read",
  "toolCount": 25,
  "secondBrain": { "configured": true, "owner": "oalmirbueno", "repo": "segundo-cerebro-almir" }
}
```

Handshake JSON-RPC autenticado:

```bash
curl -sS "$ACELERIQ_MCP_URL" \
  -H "Authorization: Bearer $ACELERIQ_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"codex-aceleriq-os","version":"0.1.0"}}}'
```

Depois: `tools/list` para ver o subconjunto liberado pela sua credencial.
