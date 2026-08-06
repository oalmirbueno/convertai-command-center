# Exemplo 01 — Health check

Handshake público MCP (sem acessar dados nem listar tools privadas):

```bash
curl -sS -X POST "$ACELERIQ_MCP_URL" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"health-check","version":"1.0.0"}}}' \
  | jq '.result | {protocolVersion, serverInfo, capabilities}'
```

Resposta esperada:

```json
{
  "protocolVersion": "2025-06-18",
  "serverInfo": {
    "name": "aceleriq-mcp",
    "title": "Aceleriq OS MCP",
    "version": "1.8.0"
  },
  "capabilities": { "tools": { "listChanged": true } }
}
```

Um `GET` sem Bearer responde `401` com o desafio OAuth de propósito; não use
esse GET como health check.

Descoberta autenticada e filtrada pela credencial:

```bash
curl -sS -X POST "$ACELERIQ_MCP_URL" \
  -H "Authorization: Bearer $ACELERIQ_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"aceleriq_capabilities","arguments":{}}}'
```
