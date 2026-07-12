# Codex

## Origem
`X-Agent-Origin: codex`

## Instalação
```bash
codex plugin install ./integrations/codex-plugin/aceleriq-os
```
Preencher `.env` (ver `.env.example`). O Codex expande variáveis dentro de
`.mcp.json` automaticamente.

## Writeback (planejado)
Inbox oficial: `memory/inbox/codex/`. Nesta rodada o servidor ainda força
`memory/inbox/chatgpt/`. Para habilitar `codex/`, ver
[`adapters.md`](adapters.md).

## Fluxo típico
1. `memory_get_context` para carregar contexto OpenClaw.
2. `aceleriq_get_client_context` para focar o cliente da conversa.
3. Executar leitura/escrita conforme skill selecionada.
