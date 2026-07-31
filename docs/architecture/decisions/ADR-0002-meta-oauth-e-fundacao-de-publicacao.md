# ADR-0002: Meta OAuth e fundação de publicação

- Status: proposto
- Data: 31/07/2026
- Escopo: contas externas, Instagram, Facebook e preparação do worker de publicação

## Contexto

O calendário já cadastra contas manualmente e agenda conteúdo dentro do painel, mas ainda não possui autenticação oficial com as redes nem execução automática. A primeira integração precisa conectar Páginas do Facebook e contas profissionais do Instagram sem expor tokens ao navegador e sem permitir que a preparação técnica contorne o double-gate editorial.

## Decisão

1. Usar Facebook Login for Business e Graph API versionada, com versão configurada no servidor.
2. Executar troca de código, descoberta de recursos e validação de permissões somente na Edge Function `social-meta-oauth` com JWT obrigatório.
3. Expor no schema público apenas o estado sanitizado da conexão. Sessões, grants, candidatos, mapeamentos e snapshots ficam em `social_private`, sem acesso direto dos papéis da API.
4. Persistir credenciais no Supabase Vault. O navegador recebe apenas IDs opacos, nomes, plataforma e estado da conexão.
5. Armazenar o estado OAuth somente como hash, consumi-lo uma vez e vinculá-lo ao usuário, cliente e projeto.
6. Permitir conectar Facebook e Instagram descobertos na mesma sessão. Ao concluir, descartar candidatos não escolhidos.
7. Revogar valores antigos do Vault em reconexão, desconexão, expiração e sessões abandonadas. Uma rotina periódica cobre abandonos sem callback final.
8. Manter `automation_enabled = false` em toda conexão criada nesta fase. Não existe RPC público de ativação neste lote.
9. Congelar por publicação a ordem, SHA-256, MIME e tamanho dos arquivos aprovados. O modo automático exige conexão oficial habilitada e integridade completa, além do fingerprint aprovado.
10. Preservar o fluxo manual e payloads legados. Nenhum worker, cron de publicação ou chamada de postagem externa faz parte deste lote.

## Guardrails

- `META_APP_SECRET`, tokens de usuário e tokens de Página nunca entram em resposta, log, frontend, commit ou evento público.
- Callback permitido somente no domínio canônico ou em localhost durante desenvolvimento, sempre no caminho `/oauth/meta/callback`.
- RLS mantém isolamento por cliente. RPCs autenticados validam ator, cliente, projeto, sessão e recurso.
- A conta conectada continua sem permissão de publicar automaticamente até um lote separado, revisado e autorizado.
- O snapshot de mídia participa da integridade aprovada e é gravado na mesma transação do conteúdo.
- Falhas de conexão ou de validação revertem a operação sem alterar publicações existentes.

## Configuração externa necessária

Antes de validar em Preview ou produção, a aplicação Meta precisa ter redirect canônico, Facebook Login for Business, permissões aprovadas e variáveis de servidor `META_APP_ID`, `META_APP_SECRET`, `META_LOGIN_CONFIG_ID`, `META_GRAPH_VERSION` e `META_REDIRECT_URI`. Nenhum desses valores é versionado.

## Consequências

- A equipe pode autenticar uma vez e escolher as Páginas e contas profissionais disponíveis para o projeto.
- O painel distingue conta manual, conectada, expirada e desconectada sem ler secrets.
- A preparação de publicação fica auditável e compatível com um worker determinístico posterior.
- O lote seguinte deve implementar fila, claim idempotente, retries, rate limits, kill switch, observabilidade e ativação explícita por cliente antes de qualquer postagem real.
- Em rollback operacional, a Edge Function pode ser desativada e as conexões oficiais marcadas como revogadas; contas manuais e o calendário atual continuam compatíveis.

## Referências

- `supabase/functions/social-meta-oauth/index.ts`
- `supabase/migrations/20260731175633_meta_oauth_foundation.sql`
- `supabase/tests/database/social_meta_oauth_foundation.test.sql`
- `src/components/editorial/EditorialAccountSetup.tsx`
- `src/pages/MetaOAuthCallback.tsx`
