# aceleriq-os (Codex Plugin)

Plugin **privado** que conecta o Codex (e outros clientes MCP compatíveis) ao
**Aceleriq Performance OS** através do MCP central já publicado. Este pacote
**não hospeda dados**, **não replica o Segundo Cérebro** e **não sobe um segundo
servidor MCP** — apenas empacota configuração, skills e exemplos para consumir
o endpoint oficial.

- **Endpoint MCP:** definido por `ACELERIQ_MCP_URL`; a allowlist aceita somente `api.aceleriq.online`, o endereço estável independente do project ref.
- **Protocolo:** MCP 2025-06-18 (Streamable HTTP)
- **Auth:** Bearer token `mcp_live_*` emitido em `/api-docs → aba MCP`
- **Segundo Cérebro:** ponte GitHub → `oalmirbueno/segundo-cerebro-almir`
  (leitura completa, escrita restrita a `memory/inbox/chatgpt/`)

> **Gate de distribuição:** não instale nem distribua este pacote enquanto
> `api.aceleriq.online` não tiver DNS/TLS válidos e o handshake MCP ao vivo não
> passar. A allowlist é deliberadamente fechada e não volta ao project ref antigo.

## Instalação

```bash
cp .env.example .env
# preencha ACELERIQ_MCP_TOKEN com a credencial emitida no painel
codex plugin install ./integrations/codex-plugin/aceleriq-os
```

O Codex lerá `.codex-plugin/plugin.json` e carregará `.mcp.json` como
configuração de servidor MCP. Após instalar, use `codex plugin list` para
confirmar `aceleriq-os → ready`.

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `ACELERIQ_MCP_URL` | ✅ | URL pública completa do MCP canônico. |
| `ACELERIQ_MCP_TOKEN` | ✅ | Token `mcp_live_*`. **Nunca** commitar. |
| `ACELERIQ_AGENT_ORIGIN` | ⛔ | Identificador de origem (padrão `codex`). |

Consulte [`docs/security.md`](docs/security.md) para rotação e revogação.

## Skills disponíveis

| Skill | Objetivo |
| --- | --- |
| [`client-context`](skills/client-context.md)   | Dossiê consolidado de cliente antes de qualquer ação. |
| [`task-management`](skills/task-management.md) | Criar / atualizar / concluir tarefas com allowlist rígida. |
| [`editorial-calendar`](skills/editorial-calendar.md) | Consultar o calendário filtrado e adicionar pautas publicáveis sem agendar ou publicar. |
| [`reports`](skills/reports.md)                 | Listar relatórios e gerar **rascunhos** (nunca publicar). |
| [`second-brain`](skills/second-brain.md)       | Consultar OpenClaw (memory_get_context / search / fetch). |
| [`memory-proposals`](skills/memory-proposals.md) | Propor updates de memória no inbox do agente. |
| [`project-review`](skills/project-review.md)   | Auditoria estruturada de projeto (leitura). |

## Escopos por credencial

O painel `/api-docs → MCP` permite emitir credenciais com um subconjunto de:

- `aceleriq:read` — leitura de clientes, projetos, tarefas, relatórios, workspace.
- `aceleriq:write` — escrita operacional controlada; inclui o granular `editorial:write` por compatibilidade.
- `editorial:read` — calendário editorial completo do cliente autorizado.
- `editorial:write` — cria somente a tarefa publicável da linha editorial; não aprova, agenda ou publica.
- `memory:read` — leitura do Segundo Cérebro.
- `memory:propose` — proposta em `memory/inbox/chatgpt/`.

Cada agente **deve** ter credencial própria e `X-Agent-Origin` próprio.
Veja o catálogo completo em [`docs/tools-catalog.md`](docs/tools-catalog.md).

## Writeback (inbox por agente)

| Agente | Inbox no Segundo Cérebro |
| --- | --- |
| ChatGPT Work | `memory/inbox/chatgpt/` |
| Codex        | `memory/inbox/codex/`   |
| Claude Code  | `memory/inbox/claude-code/` |
| Claude       | `memory/inbox/claude/`  |
| Hermes       | `memory/inbox/hermes/`  |

> ⚠️ **Nesta rodada**, a tool `memory_propose_update` grava exclusivamente em
> `memory/inbox/chatgpt/` — o path é fixado pelo servidor e **não é aceito no
> input**. Para habilitar inbox específico por agente, veja
> [`docs/adapters.md`](docs/adapters.md).

## Guias por cliente

- [`docs/chatgpt-work.md`](docs/chatgpt-work.md)
- [`docs/codex.md`](docs/codex.md)
- [`docs/claude-code.md`](docs/claude-code.md)
- [`docs/hermes.md`](docs/hermes.md)
- [`docs/openclaw.md`](docs/openclaw.md)
- [`docs/second-brain.md`](docs/second-brain.md)
- [`docs/security.md`](docs/security.md)
- [`docs/tools-catalog.md`](docs/tools-catalog.md)

## Exemplos

Ver [`examples/`](examples/) — inclui:
- `01-health-check.md` — handshake e listagem de tools
- `02-client-dossier.md` — dossiê consolidado
- `03-create-task.md` — criação de tarefa idempotente
- `04-report-draft.md` — rascunho de relatório
- `05-memory-proposal.md` — proposta no inbox
- `06-editorial-calendar.md` — calendário filtrado e criação idempotente de pauta

## Validação

```bash
node scripts/validate.mjs
```

Verifica manifests, skills, docs, exemplos, ausência de token real no exemplo
de ambiente e, quando `ACELERIQ_MCP_URL` estiver definida, o `initialize`
público do MCP.
