# Segurança

## Princípios
1. **Uma credencial por agente.** Nunca compartilhar `mcp_live_*` entre
   ChatGPT Work, Codex, Claude Code, Hermes ou OpenClaw. Auditoria depende de
   `key_id` estável.
2. **Origem própria.** Cada agente envia `X-Agent-Origin` distinto
   (`chatgpt-work`, `codex`, `claude-code`, `hermes`, `openclaw`). O servidor
   registra em `mcp_audit_log.origin`.
3. **Escopo mínimo.** Emita a chave apenas com os escopos necessários
   (`editorial:read`, `editorial:write`, `aceleriq:read`, `aceleriq:write`,
   `memory:read`, `memory:propose`).
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
- Escrita fora das tools registradas e do escopo concedido.
- Alteração de `project_id`, `source`, `client_id` via update.
- Acesso a cliente fora de `team_client_assignments` para manager, design ou
  traffic. Admin é o único papel interno irrestrito; chave sem proprietário
  falha fechada para dados de clientes.
- No endpoint legado, usuários restritos recebem somente as tools que já
  aplicam esse recorte no servidor: descoberta de clientes/projetos, tarefas,
  calendário editorial e as escritas operacionais correspondentes. As tools
  `memory_*` permanecem disponíveis porque usam a ponte GitHub e suas próprias
  regras de path, sem consultar tabelas de cliente com `service_role`. Qualquer
  outro serviço legado ainda sem recorte fica oculto e falha com 403; admin
  permanece compatível com a superfície completa.
- No OAuth, quando claims `scope`/`scopes` trazem ao menos um escopo MCP da
  aplicação, elas são cruzadas com a allowlist interna; uma autorização somente
  leitura não ganha escrita. Tokens antigos e tokens com apenas
  `openid email profile` preservam a compatibilidade atual. Para consentimento
  granular real, o projeto precisa emitir os scopes internos por um Supabase
  Custom Access Token Hook; este plugin não cria nem altera esse hook.
  Referência: [OAuth 2.1 Server do Supabase](https://supabase.com/docs/guides/auth/oauth-server)
  e [Custom Access Token Hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook).
- Criação editorial que tente usar tipo não publicável, projeto de outro
  cliente, aprovação, agendamento ou publicação.
- Publicação/envio de relatórios (`status` sempre `draft`).
- Escrita no Segundo Cérebro fora de `memory/inbox/chatgpt/`.
- Path traversal (`..`, paths absolutos) em `memory_fetch`.

## O que o cliente **não** deve fazer
- Logar o token, o header `Authorization` ou payloads sensíveis.
- Passar o token para o modelo (LLM) — mantê-lo no transporte.
- Chamar GitHub diretamente. Toda leitura/escrita do Segundo Cérebro passa
  pelo MCP.
- Armazenar token em `localStorage` de navegador.
