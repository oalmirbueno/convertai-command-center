---
name: memory-proposals
description: Propor atualizações ao Segundo Cérebro via commit isolado no inbox — nunca sobrescreve, nunca sai do inbox.
scopes: [memory:propose]
tools: [memory_propose_update]
---

# Propostas de Memória

## Regra dura
`memory_propose_update` grava exclusivamente em `memory/inbox/chatgpt/`.
O **path é fixado pelo servidor** e o nome de arquivo é gerado (timestamp +
slug + hash do correlation_id). **Não é possível** escolher outro inbox nesta
rodada — tentativas serão rejeitadas.

O que está **explicitamente bloqueado** pelo servidor:
- raiz do repositório
- `MEMORY.md`, `memory/now.md`, `memory/agent-context.md`
- `memory/decisions/`, `memory/projects/`, `memory/context/`, `memory/lessons/`, `memory/pending/`
- inboxes de outros agentes (`hermes/`, `openclaw/`, `codex/`, `claude/`)

## Formato exigido
Markdown com front-matter YAML:

```yaml
---
origin: codex            # ou chatgpt-work, hermes, claude-code
correlation_id: <uuid>
title: <título curto>
tags: [rotulos, opcionais]
proposed_at: 2026-07-12T19:30:00Z
---
```

Corpo em Markdown normal. Sempre incluir contexto (por quê), fonte (dado que
motivou a proposta) e ação sugerida.

## Fluxo
1. Buscar contexto atual (`memory_get_context` + `memory_search`).
2. Só propor mudança se realmente adicionar informação nova.
3. Enviar `correlation_id` estável — replay do mesmo id não duplica arquivo.
4. Informar ao usuário o path final retornado pelo servidor.

## Depois da proposta
Revisão humana / OpenClaw promove (ou descarta) o arquivo do inbox para o
diretório canônico. Nenhum agente externo pode fazer essa promoção.
