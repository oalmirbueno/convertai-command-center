# Segurança

## Princípios
1. **Uma credencial por agente.** Nunca compartilhar `mcp_live_*` entre
   ChatGPT Work, Codex, Claude Code, Hermes ou OpenClaw. Auditoria depende de
   `key_id` estável.
2. **Origem própria.** Cada agente envia `X-Agent-Origin` distinto
   (`chatgpt-work`, `codex`, `claude-code`, `hermes`, `openclaw`). O servidor
   registra em `mcp_audit_log.origin`.
3. **Escopo mínimo.** Emita a chave apenas com os escopos necessários
   (`aceleriq:read`, `aceleriq:write`, `memory:read`, `memory:propose`).
4. **Expiração.** Chaves de agentes externos devem ter `expires_at` <= 90 dias.
5. **Sem secrets no repositório.** Tokens vivem em `.env` local ou no cofre
   de secrets do host (Codex, GitHub Actions, etc.). O `.env` está em
   `.gitignore`.

## Emissão
Painel Aceleriq → `/api-docs` → aba **MCP** → **Nova credencial**.
O token é exibido **uma única vez** — armazene imediatamente no gerenciador
de secrets do agente.

## Rotação
Painel → **Rotacionar** gera um novo token e revoga o anterior após grace
period. Atualize o `.env` do agente antes de desativar o antigo.

## Revogação de emergência
Painel → **Revogar**. Requisições subsequentes retornam `401 invalid_key`.
Já registradas ficam preservadas em `mcp_audit_log` para auditoria.

## O que o servidor bloqueia por design
- Escrita fora das 4 tools autorizadas (`create_task`, `update_task`,
  `complete_task`, `create_report_draft`).
- Alteração de `project_id`, `source`, `client_id` via update.
- Publicação/envio de relatórios (`status` sempre `draft`).
- Escrita no Segundo Cérebro fora de `memory/inbox/chatgpt/`.
- Path traversal (`..`, paths absolutos) em `memory_fetch`.

## O que o cliente **não** deve fazer
- Logar o token, o header `Authorization` ou payloads sensíveis.
- Passar o token para o modelo (LLM) — mantê-lo no transporte.
- Chamar GitHub diretamente. Toda leitura/escrita do Segundo Cérebro passa
  pelo MCP.
- Armazenar token em `localStorage` de navegador.
