# Segundo Cérebro — Ponte GitHub

## Repositório
`oalmirbueno/segundo-cerebro-almir` (branch `main`, configurável via
`SECOND_BRAIN_DEFAULT_BRANCH`).

## Ponte
Edge Function `mcp-server` chama a GitHub REST API com um PAT armazenado
em segredo do backend (`SEGUNDO_CEREBRO_GITHUB_PAT`). O cliente MCP
**nunca** recebe o PAT.

## Escrita permitida
Somente em `memory/inbox/chatgpt/`. Bloqueios explícitos:
- raiz do repo
- `MEMORY.md`, `memory/now.md`, `memory/agent-context.md`
- `memory/decisions/`, `memory/projects/`, `memory/context/`, `memory/lessons/`, `memory/pending/`
- `memory/inbox/openclaw/`, `hermes/`, `codex/`, `claude/`

## Formato de proposta
- Filename gerado pelo servidor: `<ISO>-<slug>-<corrHash>.md`
- Nunca sobrescreve (commit falha se path já existe).
- Commit isolado com mensagem `chatgpt-inbox: <title> [<corrShort>]`.

## Leitura
Ampla dentro do repositório (`memory_get_context`, `memory_search`,
`memory_fetch`). Sem exposição de metadados sensíveis do GitHub
(colaboradores, PATs, webhooks).
