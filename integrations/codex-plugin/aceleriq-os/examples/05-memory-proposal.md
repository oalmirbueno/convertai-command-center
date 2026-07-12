# Exemplo 05 — Proposta no Segundo Cérebro

A tool `memory_propose_update` grava **exclusivamente** em
`memory/inbox/chatgpt/`. O nome do arquivo é gerado pelo servidor
(`YYYY-MM-DDTHH-mm-ssZ--<slug>--<corr8>.md`). Não aceita `path`,
`filename`, `tags`, `content` ou escolha de outro inbox.

## Schema real da tool

Obrigatórios:
- `title` (string, 3–160)
- `summary` (string, 10–2000)
- `origin` (string, 2–120 — ex.: `codex`, `chatgpt-work`, `hermes-agent`)
- `correlation_id` (string, 6–64 — UUID recomendado; replays idempotentes)

Opcionais:
- `context` (string, ≤6000)
- `body_markdown` (string, ≤12000)
- `risks` (string, ≤2000)
- `suggested_destination` (string, ≤256 — apenas orientação para o OpenClaw)

## Chamada JSON-RPC

```json
{
  "jsonrpc": "2.0",
  "id": 11,
  "method": "tools/call",
  "params": {
    "name": "memory_propose_update",
    "arguments": {
      "title": "Padrão de assinatura de e-mails de aprovação",
      "summary": "Padronizar a assinatura usada nos e-mails de aprovação enviados ao cliente para reforçar a identidade AcelerIQ.",
      "origin": "codex",
      "correlation_id": "d0f1a2b3-4c5d-6e7f-8091-a2b3c4d5e6f7",
      "context": "Hoje cada operador usa uma assinatura diferente; falta consistência visual.",
      "suggested_destination": "memory/decisions.md",
      "risks": "Nenhum risco operacional; apenas padronização visual.",
      "body_markdown": "## Proposta\n- Bloco fixo com nome, cargo e canal de contato.\n- Rodapé com link para o portal do cliente."
    }
  }
}
```

## Resposta (exemplo)

```json
{
  "path": "memory/inbox/chatgpt/2026-07-12T19-30-45Z--padrao-de-assinatura-de-e-mails-de-aprovacao--d0f1a2b3.md",
  "sha": "…",
  "commit_sha": "…",
  "commit_url": "https://github.com/…",
  "bytes": 812,
  "branch": "main"
}
```

Notas:
- Extensão sempre `.md`; `.txt`, `.json`, `.markdown` são rejeitados.
- Sobrescrita não é permitida (commit falha se o path já existir).
- Nenhum arquivo consolidado (`MEMORY.md`, `memory/now.md`,
  `memory/agent-context.md`, `memory/decisions/`, `memory/projects/`,
  `memory/context/`, `memory/lessons/`, `memory/pending/`) pode ser
  alcançado a partir desta tool.
