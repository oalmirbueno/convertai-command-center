---
name: second-brain
description: Consultar o Segundo Cérebro (OpenClaw memory) via ponte GitHub — leitura hierárquica, busca e fetch pontual.
scopes: [memory:read]
tools: [memory_get_context, memory_search, memory_fetch, memory_list_pending_proposals]
---

# Segundo Cérebro (OpenClaw)

## Fonte oficial
OpenClaw memory hospedada em `oalmirbueno/segundo-cerebro-almir` (branch `main`).
Todas as leituras passam por `mcp-server` → GitHub API — **nunca** fazer
requisições HTTP diretas ao repositório.

## Ordem canônica de contexto
1. `AGENTS_MEMORY_BRIDGE.md`
2. `memory/agent-context.md`
3. `MEMORY.md`
4. `memory/now.md`

Use `memory_get_context` para carregar essa pilha em uma única chamada.

## Ferramentas
- `memory_get_context` — snapshot inicial obrigatório em toda sessão nova.
- `memory_search` — GitHub Code Search restrito ao repo (sem escrita).
- `memory_fetch` — path relativo; recusa path traversal (`..`, absolutos).
- `memory_list_pending_proposals` — lista propostas ainda não revisadas
  pelo OpenClaw no inbox oficial.

## Bloqueios
Leitura é ampla, **escrita não existe aqui**. Para propor mudança use a skill
[`memory-proposals`](memory-proposals.md).
