# ChatGPT Work

## Origem
`X-Agent-Origin: chatgpt-work`

## Credencial
Emitir em `/api-docs → MCP → Nova credencial` com escopos:
`aceleriq:read`, `aceleriq:write` (opcional), `memory:read`,
`memory:propose` (opcional).

## Configuração
Em ChatGPT Work → **Custom Connectors** → adicionar servidor MCP:
- URL: `https://gicbrgagstyvbaaumprj.supabase.co/functions/v1/mcp-server`
- Auth: Bearer (colar `mcp_live_*`)
- Header extra: `X-Agent-Origin: chatgpt-work`

## Writeback
`memory_propose_update` grava em `memory/inbox/chatgpt/`. Este é o
único inbox habilitado nesta rodada — o path é fixado pelo servidor.

## Restrições
- Não peça publicação de relatório — indisponível.
- Não peça exclusão de tarefa/projeto — indisponível.
- Não peça criação/edição de cliente — indisponível.
