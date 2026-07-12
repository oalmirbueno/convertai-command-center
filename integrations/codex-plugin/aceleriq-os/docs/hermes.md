# Hermes Agent

## Origem
`X-Agent-Origin: hermes`

## Perfil
Agente operacional focado em automações. Recomendado:
- `aceleriq:read`
- `aceleriq:write` — restrito aos 4 endpoints autorizados
- `memory:read`
- `memory:propose` — apenas se realmente for gerar insights

## Configuração
Cliente MCP HTTP genérico. Exemplo minimal (Node):

```ts
import { createMCPClient } from "@ai-sdk/mcp";
const client = await createMCPClient({
  transport: {
    type: "http",
    url: process.env.ACELERIQ_MCP_URL!,
    headers: {
      Authorization: `Bearer ${process.env.ACELERIQ_MCP_TOKEN}`,
      Accept: "application/json, text/event-stream",
      "X-Agent-Origin": "hermes",
    },
  },
});
```

## Writeback (planejado)
`memory/inbox/hermes/`. Bloqueado nesta rodada — usar `chatgpt/` até o
adapter estar habilitado (ver `adapters.md`).
