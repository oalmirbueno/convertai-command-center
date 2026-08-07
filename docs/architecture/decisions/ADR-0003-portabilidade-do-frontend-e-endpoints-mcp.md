# ADR-0003: Portabilidade do frontend e endpoints MCP

- Status: aceito
- Data: 07/08/2026
- Escopo: frontend, hospedagem e endereço público do MCP

## Contexto

O frontend de produção é publicado atualmente pelo Lovable e usa o projeto Supabase existente. O GitHub já é a fonte canônica do código, mas o repositório não possuía um contrato de ambiente para os endpoints MCP nem um artefato genérico de hospedagem com fallback de SPA.

O objetivo é manter o Lovable funcionando no presente e permitir outro host no futuro sem reescrever o MCP. Portar o frontend não autoriza mover o banco, Auth, Storage, Edge Functions ou secrets para outro projeto Supabase.

## Decisão

1. O GitHub permanece a fonte canônica do código, documentação e decisões. O Lovable é o host atual e uma compatibilidade de deploy, não uma dependência exclusiva do frontend.
2. O frontend continua sendo um build estático Vite e ganha uma imagem Docker multi-stage com Nginx, health check e fallback de SPA.
3. `VITE_MCP_SERVER_URL` e `VITE_MCP_OAUTH_METADATA_URL` definem endereços públicos explícitos. Na ausência de cada variável, o endereço é derivado de `VITE_SUPABASE_URL`.
4. `/functions/v1/mcp-server` e `/functions/v1/mcp-oauth-metadata` formam a superfície MCP portátil. `/functions/v1/mcp`, gerada para a integração Lovable, permanece apenas como compatibilidade controlada enquanto necessária.
5. Uma futura URL estável, por exemplo em `api.aceleriq.online`, pode ocultar o hostname do projeto do consumidor. DNS, certificado, Auth, CORS e callbacks exigem uma mudança operacional separada.
6. Migrar o projeto Supabase é uma decisão independente, com reconciliação de schema, backup, restauração, dados, Auth, Storage, funções, secrets, grants, RLS e plano de corte próprio.
7. Variáveis `VITE_*` são configuração de build. A promoção reutiliza o mesmo artefato validado; alterações de endpoint geram novo artefato.

## Consequências

- O mesmo commit pode ser publicado no Lovable ou em qualquer host de arquivos estáticos compatível com fallback de SPA.
- As telas de conexão MCP deixam de montar URLs a partir de uma referência de projeto e passam a consumir o contrato de endpoints centralizado.
- Trocar o host do frontend não exige alterar o protocolo nem as ferramentas do MCP.
- Trocar o projeto Supabase ainda exige um projeto de migração completo; este ADR apenas remove acoplamentos de endereço no frontend e no runtime MCP.
- O binding de clientes OAuth adiciona schema por migration e permanece independente do rollback das funções MCP.
- O desacoplamento de endpoints está entregue, o `.env` foi removido do índice e novos arquivos locais são ignorados. Valores sensíveis que já apareceram em commits anteriores ainda precisam ser rotacionados ou aposentados; decidir por eventual saneamento do histórico continua sendo uma ação de segurança separada.

## Rollback

Reimplantar o artefato anterior do frontend e, se aplicável, restaurar o destino anterior do domínio. Um rollback MCP republica somente as funções a partir de um SHA ancestral aprovado e não desfaz o schema aditivo do binding OAuth. O banco opera em modo forward-fix: qualquer correção usa uma nova migration revisada, tip atual de `main` e backup restaurável confirmado, nunca rollback destrutivo. A compatibilidade Lovable permanece disponível durante a transição.

## Referências

- `src/lib/mcp/endpoints.ts`
- `Dockerfile`
- `deploy/nginx.conf`
- `docs/operations/MCP-PORTABLE-DEPLOY.md`
- `docs/operations/ENVIRONMENT-INVENTORY.md`
