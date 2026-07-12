# ChatGPT Work

## Origem
`X-Agent-Origin: chatgpt-work`

## Credencial
Para ChatGPT Work, use OAuth. Não cole token `mcp_live_*` no conector.

## Configuração
Em ChatGPT Work → **Custom Connectors** → adicionar servidor MCP:
- URL: `https://gicbrgagstyvbaaumprj.supabase.co/functions/v1/mcp-server`
- Auth: OAuth
- Após salvar, o ChatGPT deve abrir a tela de login/autorização do Aceleriq.

Se o ChatGPT oferecer Bearer/manual, não use para o Work. Bearer segue
disponível apenas para clientes técnicos e automações controladas.

## Writeback
`memory_propose_update` grava em `memory/inbox/chatgpt/`. Este é o
único inbox habilitado nesta rodada — o path é fixado pelo servidor.

## Restrições
- Não peça publicação de relatório — indisponível.
- Não peça exclusão de tarefa/projeto — indisponível.
- Não peça criação/edição de cliente — indisponível.
