# Claude Code

## Origem
`X-Agent-Origin: claude-code`

## Configuração
Adicionar em `~/.claude/mcp.json` (ou config equivalente do Claude Code):

```json
{
  "mcpServers": {
    "aceleriq": {
      "transport": "streamable-http",
      "url": "https://gicbrgagstyvbaaumprj.supabase.co/functions/v1/mcp-server",
      "headers": {
        "Authorization": "Bearer ${ACELERIQ_MCP_TOKEN}",
        "Accept": "application/json, text/event-stream",
        "X-Agent-Origin": "claude-code"
      }
    }
  }
}
```

## Writeback (planejado)
Inbox oficial: `memory/inbox/claude-code/`. Nesta rodada ainda usa
`memory/inbox/chatgpt/`. Ver `adapters.md`.

## Boas práticas
- Ative apenas as skills necessárias por sessão.
- Nunca cole tokens no chat — mantenha em variável de ambiente.
