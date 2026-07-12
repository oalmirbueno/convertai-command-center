# Adaptações futuras — inbox por agente

Esta rodada consolida a rota única `memory/inbox/chatgpt/`. Para habilitar
inbox distinto por agente (`codex/`, `claude-code/`, `claude/`, `hermes/`)
mantendo as garantias de segurança atuais, siga este roteiro:

## 1. Servidor MCP
Em `supabase/functions/_shared/second-brain-github.ts`:
- Trocar a constante `INBOX_PREFIX` por uma função
  `resolveInbox(origin) → string`, com allowlist explícita:
  ```ts
  const INBOXES = {
    "chatgpt-work": "memory/inbox/chatgpt/",
    "codex":        "memory/inbox/codex/",
    "claude-code":  "memory/inbox/claude-code/",
    "claude":       "memory/inbox/claude/",
    "hermes":       "memory/inbox/hermes/",
  } as const;
  ```
- **Não** aceitar path do input. O agente informa apenas `origin`; o
  servidor resolve o inbox.
- Manter todos os bloqueios atuais (raiz, MEMORY.md, decisions, projects,
  context, lessons, pending, inbox de outros agentes).

## 2. Tool `memory_propose_update`
- Adicionar validação: `origin ∈ Object.keys(INBOXES)`.
- Rejeitar qualquer tentativa de sobrescrever `origin` via headers falsos —
  cruzar com `X-Agent-Origin` real da chamada.
- Continuar gerando filename no servidor.

## 3. Auditoria
- `mcp_audit_log` já registra `origin` — nenhum schema muda.
- Adicionar campo derivado `inbox_path` para queries rápidas.

## 4. Credenciais
- Manter uma chave por agente (já é o padrão desta rodada).
- Escopo `memory:propose` permanece o mesmo — a divergência de inbox é
  decidida pela `origin`, não pelo escopo.

## 5. Rollout
1. Deploy do servidor com allowlist + fallback para `chatgpt/`.
2. Migrar agentes um a um alterando apenas o header `X-Agent-Origin`.
3. Após 100% migrado, remover o fallback.

## O que **não** fazer
- Não aceitar `inbox_path` no input da tool.
- Não permitir subpastas dentro do inbox.
- Não flexibilizar bloqueios de diretórios canônicos.
- Não emitir uma chave que possa gravar em múltiplos inboxes.
