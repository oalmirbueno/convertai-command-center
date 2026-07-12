# Exemplo 01 — Health check

Discovery público (sanitizado — nomes/escopos de tools e config do
Segundo Cérebro exigem Bearer + `aceleriq_capabilities`):

```bash
curl -sS "$ACELERIQ_MCP_URL" | jq '{name, version, status, protocolVersion, toolCount, secondBrain}'
```

Resposta esperada:

```json
{
  "name": "aceleriq-mcp",
  "version": "1.2.0",
  "status": "ok",
  "protocolVersion": "2025-06-18",
  "toolCount": 25,
  "secondBrain": { "configured": true }
}
```

Handshake autenticado + descoberta detalhada:

```bash
curl -sS -X POST "$ACELERIQ_MCP_URL" \
  -H "Authorization: Bearer $ACELERIQ_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"aceleriq_capabilities","arguments":{}}}'
```
