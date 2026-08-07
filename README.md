# Aceleriq OS

Painel operacional da Aceleriq para clientes, projetos, conteúdo, aprovações, arquivos, financeiro e integrações com agentes via MCP.

O GitHub é a fonte canônica do código, da arquitetura e das operações versionadas. O Lovable continua sendo o provedor atual do frontend de produção e permanece compatível, mas não é requisito para compilar ou hospedar o frontend, executar o MCP, consumir IA ou enviar e-mails. O backend atual continua no mesmo projeto Supabase; migrar dados, Auth, Storage ou Edge Functions para outro projeto é uma operação separada da portabilidade já entregue.

## Stack

- React 18, TypeScript e Vite
- Tailwind CSS e shadcn/ui
- Supabase Database, Auth, Storage e Edge Functions
- Vitest e ESLint
- Build estático, com opção de container Nginx

## Desenvolvimento local

Requisitos: Node.js 22 ou uma versão LTS compatível e npm.

```sh
cp .env.example .env.local
npm ci
npm run dev
```

Preencha `.env.local` antes de iniciar. O contrato de endpoints e provedores já está desacoplado do Lovable, o `.env` não faz mais parte do checkout e arquivos locais de ambiente são ignorados. O gate privado de credenciais deve estar concluído antes de qualquer release. Não versione credenciais de servidor nem detalhes de incidentes.

| Variável | Obrigatória | Uso |
|---|---:|---|
| `VITE_SUPABASE_URL` | sim | URL pública do projeto Supabase atual |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | sim | chave pública usada pelo navegador |
| `VITE_APP_PUBLIC_URL` | sim no build de produção | base de links absolutos e metadados sociais; em desenvolvimento pode usar a origem do navegador |
| `VITE_MCP_SERVER_URL` | não | sobrescreve o endpoint MCP padrão |
| `VITE_MCP_OAUTH_METADATA_URL` | não | sobrescreve o metadata OAuth do MCP |
| `VITE_WEBHOOK_URL` | conforme o ambiente | base dos webhooks externos |
| `VITE_SUPPORT_WHATSAPP_NUMBER` | não | número internacional dos CTAs de suporte; sem valor, os CTAs ficam ocultos |

Sem os dois overrides de MCP, o frontend deriva os endereços de `VITE_SUPABASE_URL`:

- `/functions/v1/mcp-server`
- `/functions/v1/mcp-oauth-metadata`

Como o Vite incorpora variáveis `VITE_*` no artefato, uma mudança de endpoint exige um novo build do frontend.

## Verificação

```sh
npm test
npm run typecheck
npm run build
npm run mcp:portability
```

## Deploy

O fluxo atual do frontend de produção continua sendo o publish manual no Lovable após PR, revisão e aceite. Para hospedar o mesmo build em outro provedor, há um `Dockerfile` portátil e fallback de SPA no Nginx.

Produção usa três workflows manuais e serializados pelo mesmo grupo `supabase-production`. Primeiro, [`Deploy Supabase Database`](.github/workflows/deploy-supabase-database.yml) aplica migrations forward-only do tip atual de `main`, com backup restaurável confirmado e sem reset, seed ou repair. Para o lote não-MCP, abra o Preview do frontend do mesmo SHA sem publicá-lo, revise os escopos das chaves no ApiDocs e só então execute [`Deploy Supabase Public Edge`](.github/workflows/deploy-supabase-public-edge.yml), que publica as cinco funções endurecidas após preflight read-only do banco e smoke negativo sem credenciais. Com a Edge nova, valide tanto o Inbox multipart da produção antiga quanto o protocolo binário do Preview; só então publique o frontend do mesmo SHA. [`Deploy Supabase MCP`](.github/workflows/deploy-supabase-mcp.yml) publica ou reverte separadamente as duas funções MCP a partir de SHA imutável. Cada workflow confirma seus próprios gates de banco antes de publicar funções.

O procedimento completo de bootstrap, build, smoke test, release, rollback e migração está em [`docs/operations/MCP-PORTABLE-DEPLOY.md`](docs/operations/MCP-PORTABLE-DEPLOY.md). O contrato público de configuração está em [`docs/operations/ENVIRONMENT-INVENTORY.md`](docs/operations/ENVIRONMENT-INVENTORY.md); o inventário real permanece privado. A decisão arquitetural está em [`ADR-0003`](docs/architecture/decisions/ADR-0003-portabilidade-do-frontend-e-endpoints-mcp.md).

Nunca envie `service_role`, segredos OAuth ou tokens de provedores ao frontend ou como argumentos de build.
