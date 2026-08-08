# Deploy portátil do frontend, MCP e backend Supabase

## Estado entregue e fronteiras

O GitHub é a fonte canônica do código, migrations, workflows, contratos de ambiente e decisões. O estado atual permite:

- compilar e hospedar o frontend Vite fora do Lovable;
- usar `/functions/v1/mcp-server` e `/functions/v1/mcp-oauth-metadata` como MCP canônico;
- publicar ou reverter essas duas funções por SHA imutável no GitHub Actions;
- executar seis workloads de IA com qualquer provider OpenAI-compatible ou OpenAI direto;
- enviar e-mail diretamente pelo Resend;
- verificar os hooks de Auth e supressão com Standard Webhooks;
- reconstruir um banco vazio com os pré-requisitos legados reais antes da ledger de migrations.

O Lovable continua sendo o host atual do frontend de produção e uma camada de compatibilidade. `/functions/v1/mcp` e `LOVABLE_API_KEY` não são requisitos da arquitetura portátil: permanecem apenas para consumidores e callbacks antigos durante a transição.

O projeto Supabase atual continua sendo o backend operacional. Mover Database, Auth, Storage, Vault, Edge Functions ou dados para outro projeto é um corte separado, descrito adiante. O inventário canônico de configuração está em [`ENVIRONMENT-INVENTORY.md`](ENVIRONMENT-INVENTORY.md).

## Invariante de segurança antes do deploy MCP

> A migration `supabase/migrations/20260807210000_bind_mcp_oauth_clients.sql` deve ser aplicada pelo workflow de banco antes de publicar `mcp-oauth-metadata` ou `mcp-server` pelo workflow MCP.

Ela cria `public.mcp_oauth_allowed_redirect_origins` e `public.is_allowed_mcp_oauth_client(uuid)`. O servidor usa essa função para vincular o JWT a um cliente OAuth público com redirect origins permitidas. O workflow MCP não aplica nem reverte migrations de propósito.

A sequência de produção é sempre:

1. `Deploy Supabase Database` no SHA do tip atual de `main`, com backup confirmado;
2. confirmar a migration na ledger e os objetos por consulta somente leitura;
3. `Deploy Supabase MCP` no mesmo SHA de release.

Os dois workflows usam o grupo de concorrência `supabase-production`, sem cancelamento de operação em andamento. A serialização impede sobreposição, mas não substitui essa ordem.

Mantenha uma janela sem novos merges entre os dois workflows. Como ambos autorizam o tip remoto de `main`, se o tip avançar depois do banco, execute o workflow de banco novamente no novo SHA antes do release MCP.

Antes do primeiro deploy em cada projeto, confirme pelo processo aprovado de banco que a migration foi registrada e que os objetos existem. Uma verificação somente leitura possível é:

```sql
select
  to_regclass('public.mcp_oauth_allowed_redirect_origins') is not null
    as origins_table_ready,
  to_regprocedure('public.is_allowed_mcp_oauth_client(uuid)') is not null
    as client_binding_ready,
  public.is_allowed_mcp_oauth_client(
    '00000000-0000-0000-0000-000000000000'::uuid
  ) is false as unknown_client_rejected;
```

As três colunas precisam retornar `true`. O workflow MCP executa essa mesma verificação em formato legível por máquina e interrompe antes de qualquer alteração de secret ou função quando o resultado diverge. Não existe bypass por variável de ambiente: todo cliente OAuth precisa passar pelo binding do banco.

O consentimento OAuth padrão solicita somente `openid email profile`. Esse conjunto OIDC concede no runtime apenas `clients:read`, ainda restrito às atribuições do usuário. Ferramentas adicionais, principalmente qualquer escrita, permanecem negadas até um Custom Access Token Hook emitir scopes de aplicação explícitos; o servidor sempre intersecta esses scopes com sua allowlist e com o limite de dados do principal.

## Resolução dos endpoints MCP

O frontend resolve cada endpoint de forma independente:

| Superfície | Override explícito | Fallback |
|---|---|---|
| MCP canônico | `VITE_MCP_SERVER_URL` | `${VITE_SUPABASE_URL}/functions/v1/mcp-server` |
| OAuth Protected Resource Metadata | `VITE_MCP_OAUTH_METADATA_URL` | `${VITE_SUPABASE_URL}/functions/v1/mcp-oauth-metadata` |

Os overrides aceitam URLs absolutas HTTP ou HTTPS, sem credenciais, query string ou fragmento. HTTP é permitido apenas em loopback. Como variáveis `VITE_*` entram no JavaScript durante o build, uma troca de endpoint exige novo artefato do frontend.

No runtime das Edge Functions, o contrato é separado:

| Variável | Uso | Fallback |
|---|---|---|
| `SUPABASE_URL` | base do projeto, normalmente injetada pelo Supabase | obrigatória |
| `MCP_RESOURCE_URL` | URL pública de `/mcp-server` | derivada de `SUPABASE_URL` |
| `MCP_OAUTH_METADATA_URL` | URL pública do metadata | derivada de `SUPABASE_URL` |
| `MCP_AUTH_ISSUER` | issuer aceito para JWTs | `${SUPABASE_URL}/auth/v1` |
| `MCP_ALLOWED_ORIGINS` | origens de navegador adicionais | defaults do ChatGPT mais origens canônicas |

Em proxy ou domínio customizado, as duas URLs públicas apontam ao proxy, mas `MCP_AUTH_ISSUER` continua apontando ao emissor que realmente assina os JWTs do projeto Supabase.

## Banco vazio: bootstrap real antes das migrations

O primeiro histórico versionado pressupõe objetos que já existiam no banco original. Para um banco local, CI ou projeto remoto realmente vazio, use `supabase/bootstrap/legacy_prerequisites.sql`. Ele reconstrói a definição real de `quiz_submissions`, índices, RLS, grants, trigger e os dispatchers portáteis da fila de e-mail. Não contém dados nem valores de segredos.

### Local e CI

Em um checkout descartável ou antes do reset local:

```sh
cp \
  supabase/bootstrap/legacy_prerequisites.sql \
  supabase/migrations/20260528163000_legacy_prerequisites.sql

supabase start
supabase db reset --local --no-seed
supabase test db
```

O workflow `Supabase DB Tests (RLS)` executa essa mesma cópia antes do reset. O arquivo copiado é um artefato de bootstrap e não deve ser adicionado à ledger permanente do projeto original.

### Projeto Supabase remoto novo e vazio

1. Crie um checkout de release isolado no SHA aprovado.
2. Execute primeiro o reset e os testes locais completos, onde a cópia temporária continua permitida.
3. Confirme por leitura que o projeto remoto alvo está realmente vazio, que `public.quiz_submissions` ainda não existe e que não há migrations da aplicação registradas.
4. Obtenha host, porta, database, usuário e senha pelo secret store aprovado. Não escreva DSN ou senha no repositório, histórico do shell ou argumento de processo. Grave a senha em um `PGPASSFILE` temporário com modo `0600`, usando a integração do secret manager, e remova-o ao terminar.
5. Aplique `supabase/bootstrap/legacy_prerequisites.sql` diretamente uma única vez, em transação e com parada no primeiro erro:

```sh
bootstrap_secret_dir="$(mktemp -d)"
chmod 700 "$bootstrap_secret_dir"
export PGPASSFILE="$bootstrap_secret_dir/pgpass"
# O secret manager deve preencher PGPASSFILE no formato libpq, sem imprimir o valor.
chmod 600 "$PGPASSFILE"

PGHOST="YOUR_DB_HOST" \
  PGPORT="5432" \
  PGDATABASE="postgres" \
  PGUSER="YOUR_DB_USER" \
  psql \
  --set ON_ERROR_STOP=1 \
  --single-transaction \
  --file supabase/bootstrap/legacy_prerequisites.sql

# Remova o diretório temporário pelo mecanismo seguro aprovado no ambiente.
```

6. Não copie o bootstrap para `supabase/migrations` nessa operação remota e não insira uma versão para ele em `supabase_migrations.schema_migrations`.
7. Vincule o Supabase CLI exclusivamente ao projeto novo e execute `supabase db push --linked` com apenas a ledger versionada do repositório.
8. Confira `supabase migration list --linked`, confirme `20260807210000` e valide os dois objetos do binding OAuth antes de qualquer Edge Function.

Registrar o bootstrap remoto como `20260528163000` criaria uma versão existente apenas no remoto e deixaria a ledger em drift. Por isso, a cópia temporária é exclusiva de local/CI; no remoto vazio, o SQL de bootstrap é pré-condição não versionada, aplicada diretamente e sem tocar `schema_migrations`. Depois disso, `supabase db push` registra somente as migrations realmente versionadas. O workflow de produção rejeita de propósito qualquer bootstrap copiado para `supabase/migrations`.

O comando padrão do Supabase para aplicar migrations pendentes a um remoto vinculado é `supabase db push`. Ele só deve ser executado por uma pessoa/processo por vez e depois de confirmar projeto e backup. Depois de alinhar a ledger, releases incrementais usam o workflow normal. Consulte a [documentação oficial de migrations do Supabase](https://supabase.com/docs/guides/deployment/database-migrations).

### Banco atual de produção

Nunca aplique `legacy_prerequisites.sql` ao banco de produção existente. Os objetos já fazem parte do estado real e migrations posteriores os endurecem. Nesse banco, aplique somente migrations novas ainda pendentes pelo workflow `Deploy Supabase Database`.

### Baseline normalizado da produção Lovable

O banco original de produção foi construído pelo executor histórico do Lovable.
Antes do corte `20260807210000`, vários timestamps registrados remotamente não
coincidem com o nome do arquivo local equivalente, embora representem o mesmo
efeito publicado. Essa diferença histórica não é uma fila de migrations para
reaplicar e não autoriza reescrever a ledger remota.

O baseline normalizado é somente um controle de comparação, composto por:

- `supabase/production-migration-baseline.json`, manifesto explícito e fixo de
  96 aliases entre a versão remota e o arquivo local revisado. A fotografia
  contém 89 correspondências exatas de statements, duas sanitizações históricas
  já aprovadas e cinco marcadores de ledger revisados;
- `supabase/production-migration-ledger.sql`, consulta somente leitura que
  produz o fingerprint dos 96 registros históricos e de qualquer migration
  forward já aplicada, sem inserir, atualizar ou remover linhas;
- `supabase/production-baseline-attestation.sql`, atestação somente leitura para
  `20260728234519_add_task_workstreams.sql` e
  `20260728235000_sync_editorial_tasks_bidirectionally.sql`. Os efeitos dessas
  duas migrations existem no schema de produção, mas o executor histórico não
  criou as duas linhas correspondentes na ledger. Elas são absorvidas pelo
  baseline apenas quando a estrutura, os dados e as permissões retornam o
  sentinel exato `PRODUCTION_BASELINE_SCHEMA_READY`;
- 12 migrations forward-only já versionadas a partir de `20260807210000`,
  fixadas individualmente por versão, nome, hash do arquivo e hash do array de
  statements da CLI. Cada migration futura posterior precisa ser acrescentada
  explicitamente ao manifesto no mesmo PR.

Todos os checks são fail-closed. Alias, quantidade, versão, caminho, hash,
modo de correspondência, checksum das consultas, schema attestation ou sentinel
ausente ou divergente interrompe o release. A correção suportada é revisar a
causa e, quando o schema precisar mudar, criar uma nova migration forward-only.
Não existe fallback que aceite uma correspondência aproximada.

Esta normalização não usa e não autoriza `supabase migration repair`,
`supabase db reset`, seed, `supabase db push --include-all` nem escrita manual
em `supabase_migrations.schema_migrations`. Ela também não converte um banco
existente em banco vazio e nunca aplica o bootstrap legado à produção atual.

O baseline aprovado resolve somente a identidade do histórico já publicado.
Ele não prova recuperabilidade nem conclui o gate privado de segurança. Cada
release continua exigindo evidência real de backup restaurável do projeto exato
e checklist privado realmente concluído antes de selecionar `BACKUP_VERIFIED`
e `PRIVATE_SECURITY_CHECKLIST_VERIFIED`.

## Configuração portátil antes das funções

### IA

Configure pelo menos um caminho independente:

1. `AI_API_KEY` e, se necessário, `AI_BASE_URL` e `AI_MODEL`; ou
2. `OPENAI_API_KEY` para OpenAI direto.

`AI_BASE_URL` exige HTTPS fora de `localhost`, `127.0.0.1` e `[::1]`. `LOVABLE_API_KEY`, quando ainda existe, é somente o último fallback de compatibilidade. Os workloads cobertos são `workspace-ocr`, `process-meeting-notes`, `mcp-files-worker`, `workspace-agent-import`, `voice-assistant-agent` e `workspace-agent`.

### E-mail, fila e hooks

1. Configure `RESEND_API_KEY`, domínio verificado e, apenas se necessário, `RESEND_API_URL`.
2. Configure `APP_PUBLIC_URL`, `EMAIL_FROM_DOMAIN`, `EMAIL_SITE_NAME` e `EMAIL_LOGO_URL` para o novo domínio.
3. Crie no Vault `email_queue_function_url` com a URL completa de `process-email-queue` e `email_queue_service_role_key` com a credencial de serviço do projeto alvo.
4. Configure `SEND_EMAIL_HOOK_SECRET` na função e o mesmo segredo no Send Email Hook do Supabase Auth.
5. Configure `SUPPRESSION_WEBHOOK_SECRET` na função e no callback do provider para `handle-email-suppression`.
6. Configure `EMAIL_PREVIEW_SECRET` e rotacione consumidores internos de preview.
7. Teste assinatura, idempotência, enfileiramento, envio, supressão e DLQ antes de retirar callbacks antigos.

O transporte chama o Resend diretamente. `auth-email-hook` e `handle-email-suppression` usam Standard Webhooks; os módulos Lovable só são carregados quando o segredo portátil correspondente está ausente. Remova `LOVABLE_API_KEY` do ambiente migrado apenas depois de validar IA, callbacks e previews portáteis.

`EMAIL_FROM_DOMAIN` cobre Auth, contratos e e-mails transacionais. Configure somente um domínio já verificado no Resend e valide todos os templates antes do corte.

## Release de banco e operação MCP pelo GitHub

Os workflows manuais [`.github/workflows/deploy-supabase-database.yml`](../../.github/workflows/deploy-supabase-database.yml), [`.github/workflows/deploy-supabase-public-edge.yml`](../../.github/workflows/deploy-supabase-public-edge.yml) e [`.github/workflows/deploy-supabase-mcp.yml`](../../.github/workflows/deploy-supabase-mcp.yml) são os procedimentos versionados de produção. Todos usam o environment GitHub `production`, o mesmo grupo exclusivo `supabase-production` e `cancel-in-progress: false`.

### Configurar o environment `production`

Obrigatórios:

- secret `SUPABASE_ACCESS_TOKEN`;
- secret `SUPABASE_DB_PASSWORD` para o workflow de banco e para os preflights
  read-only dos releases Public Edge e MCP;
- secret `MCP_SMOKE_TOKEN`, chave MCP dedicada, de leitura e sem acesso irrestrito,
  usada somente pelo smoke autenticado;
- secrets `MCP_SMOKE_EXPECTED_KEY_ID` e `MCP_SMOKE_EXPECTED_CLIENT_ID`,
  identidades opacas que vinculam o smoke à chave e ao único cliente sintético;
- var `SUPABASE_PROJECT_ID`, ou secret homônimo apenas para compatibilidade.
- var `APP_PUBLIC_URL`, base pública canônica sem path adicional.

Opcionais:

- `MCP_BASE_URL`;
- `MCP_RESOURCE_URL`;
- `MCP_OAUTH_METADATA_URL`;
- `MCP_AUTH_ISSUER`;
- `MCP_ALLOWED_ORIGINS`.

Os quatro overrides exclusivos do MCP são reconciliados integralmente: valores definidos são validados e gravados como secrets das Edge Functions; vars ausentes ou vazias removem o secret antigo correspondente. `APP_PUBLIC_URL` é configuração global do projeto, compartilhada com e-mails e contratos: este workflow apenas a valida pelo metadata/smoke e nunca a altera. Se `MCP_BASE_URL` ficar vazio, o smoke usa `https://${SUPABASE_PROJECT_ID}.supabase.co`.

### 1. Release forward-only do banco

Pré-condições:

- PR aprovado, mergeado e checks do `main` verdes;
- backup restaurável do projeto exato criado e verificado;
- o gate privado de rotação ou aposentadoria de credenciais concluído, sem
  copiar valores ou detalhes do incidente para logs, documentação ou secrets;
- SHA completo de 40 caracteres igual ao tip remoto atual de `main`;
- baseline normalizado de produção validado integralmente, com os 96 aliases,
  as duas schema attestations e todas as migrations a partir do corte;
- migration `20260807210000_bind_mcp_oauth_clients.sql` presente nesse SHA.

As migrations de segurança posteriores também respeitam EXPAND/CUTOVER. Em especial, `20260807222000_harden_public_tokens_private.sql` é uma EXPAND compatível: cria digests/RPCs v2 e mantém temporariamente os bearers e contratos v1 públicos para o runtime antigo continuar operando enquanto o banco é publicado primeiro. Só depois de publicar e testar todas as Edge Functions e telas v2 uma migration CUTOVER separada pode apagar esses valores, remover bridges/índices legados e tornar o caminho privado exclusivo. Após esse CUTOVER, rollback de aplicação nunca deve voltar a consultar `profiles.first_access_token` ou `quiz_submissions.token`; em incidente, pause os endpoints e reemita links, sem copiar plaintext de volta ao schema público.

No GitHub Actions, execute `Deploy Supabase Database` com:

| Input | Valor |
|---|---|
| `target_sha` | SHA completo do tip atual de `main` |
| `deployment_confirmation` | `APPLY_DATABASE_PRODUCTION` |
| `backup_confirmation` | `BACKUP_VERIFIED` |
| `private_security_confirmation` | `PRIVATE_SECURITY_CHECKLIST_VERIFIED` |

O workflow confirma o projeto, rejeita o bootstrap temporário dentro da pasta de
migrations e valida o fingerprint legado e as duas attestations antes de qualquer
push. Somente depois dos sentinels exatos ele mostra a ledger, executa dry-run,
aplica as migrations posteriores ao corte com `supabase db push --linked` e
repete a verificação. Ele nunca executa reset, seed, migration repair,
`--include-all` nem escrita manual na ledger.

O banco é forward-only. Não existe operação de rollback destrutivo: qualquer correção usa uma nova migration revisada, outro SHA no tip de `main` e um novo backup confirmado.

Depois do sucesso, confirme que todas as migrations versionadas a partir de
`20260807210000` constam na ledger, que o baseline continua íntegro e que os três
checks da consulta de segurança retornam `true`.

### 2. Release das cinco Edge Functions não-MCP

Este release é somente de avanço e aceita exclusivamente o tip remoto atual de
`main`. A ordem protegida é: aplicar o banco EXPAND; abrir o Preview do frontend
do mesmo SHA **sem publicá-lo ainda**; validar as telas compatíveis e revisar as
chaves pelo ApiDocs do Preview; executar este workflow; validar no mesmo Preview
os fluxos que dependem da Edge nova, especialmente o Inbox; e só então publicar
o frontend do mesmo SHA.
Toda chave `api-gateway` operacional e não expirada deve receber escopo de
cliente `explicit` ou `all`, ou ser revogada.

A fase EXPAND mantém compatibilidade com o runtime **já publicado**. Primeiro
acesso e quiz conservam bridges v1/v2, inclusive o bearer público temporário
consumido pela versão antiga. O banco também preserva temporariamente
`validate_api_key(text)` para o gateway antigo; a Edge nova passa a usar
`validate_api_key_for_audience(text,text)`. O validator legado só poderá ser
removido numa migration CUTOVER posterior. O gateway antigo ainda não impõe os
novos escopos por cliente, portanto minimize esse intervalo e não avance ao
Public Edge enquanto a revisão pelo Preview do ApiDocs estiver incompleta.

O Inbox é a exceção de transporte: a Edge antiga aceita `?token=`, multipart e
payload legado; a UI nova usa `x-inbox-token`, body binário e o contrato de
quota. Antes do Public Edge, valide no Preview apenas administração de links e
as demais telas. Depois do workflow, valide o upload completo no mesmo Preview.
A Edge nova aceita temporariamente `?token=` para manter o frontend antigo vivo;
ela também aceita o POST multipart legado com `file` e `sender`, limitado a 25
MiB antes do parse e encaminhado ao mesmo fluxo de reserva e quarentena. Os dois
fallbacks são removidos somente no CUTOVER posterior.

Antes do Public Edge, inventarie os convites de quiz ainda pendentes e os links
de primeiro acesso ainda necessários. As migrations `20260807216000` e
`20260807217000` expiram links antigos que não tinham validade explícita;
reemitir pelo fluxo novo e notificar o destinatário é a recuperação suportada.
Após publicar a Edge, valide um link novo de cada tipo. Durante a janela EXPAND,
`client-first-access` também preserva `email` e `full_name` na validação para a
tela antiga concluir o login; a política nova de senha forte continua sendo
imposta pelo servidor e esses campos extras saem apenas no CUTOVER.

No GitHub Actions, execute `Deploy Supabase Public Edge` com:

| Input | Valor |
|---|---|
| `target_sha` | SHA completo do tip atual de `main` |
| `release_confirmation` | `DEPLOY_PUBLIC_EDGE_PRODUCTION` |
| `database_confirmation` | `PUBLIC_EDGE_DATABASE_GATES_VERIFIED` |

O preflight consulta o banco sem aplicar migrations. Ele exige as versões
`20260807221000`, `20260807222000` e `20260807223000` na ledger, os objetos
privados e grants dos RPCs v2. Antes do gate, crie e configure as novas chaves,
troque os consumidores enquanto o shim EXPAND ainda aceita os dois formatos,
execute o smoke e revogue as credenciais legadas. O preflight bloqueia o release
se existir chave `api-gateway` ativa com `client_scope_mode=none` ou qualquer
chave legada não-MCP, ativa, ainda com `audience` nula.
Depois dos testes, typecheck e Deno check, o workflow publica somente esta
allowlist, deixando `api-gateway` por último:

1. `admin-reset-client-access`;
2. `client-first-access`;
3. `submit-quiz`;
4. `workspace-inbox`;
5. `api-gateway`.

Nenhuma migration, função adicional ou configuração de secret é alterada. O
workflow também não recebe `service_role`. Após os cinco deploys, estes smokes
sem bearer, `apikey`, `X-API-Key` ou token de inbox precisam confirmar a rejeição
esperada:

| Endpoint | Requisição | Resultado obrigatório |
|---|---|---:|
| `admin-reset-client-access` | `POST` sem body | HTTP `401` |
| `client-first-access` | `GET` | HTTP `405` |
| `submit-quiz` | `GET` | HTTP `405` |
| `api-gateway` | `GET` | HTTP `401` |
| `workspace-inbox` | `GET` | HTTP `404`, `code=invalid_or_expired_link` e `Cache-Control: no-store` |

Os cinco comandos da CLI são sequenciais, portanto uma falha pode deixar um
prefixo da allowlist já publicado. Não faça rollback de banco nem ajuste manual
no Dashboard. Corrija a causa e repita o mesmo workflow/SHA enquanto ele ainda
for o tip de `main`; se `main` avançou, prepare e valide o novo tip, execute o
release de banco e abra um novo Preview antes de repetir este release. As telas
compatíveis e os escopos do Preview devem estar validados antes deste gate. Após
o deploy, valide um upload pela produção antiga com query + multipart e outro
pelo Preview com header + body binário. A publicação do frontend acontece
somente depois dos dois smokes.

### 3. Release MCP

Pré-condições:

- PR aprovado e mergeado;
- checks do `main` verdes;
- workflow de banco concluído no mesmo SHA;
- migration de binding OAuth confirmada na ledger e no schema;
- runtime MCP configurado;
- SHA completo de 40 caracteres igual ao tip remoto atual de `main`.

No GitHub Actions, execute `Deploy Supabase MCP` com:

| Input | Valor |
|---|---|
| `operation` | `release` |
| `target_sha` | SHA completo do tip atual de `main` |
| `release_confirmation` | `DEPLOY_MCP_PRODUCTION` |
| `rollback_confirmation` | `CANCEL` |

O workflow valida o control plane atual e o checkout imutável, executa testes, TypeScript e checks Deno, e confirma tanto o binding OAuth quanto a presença de todas as migrations do `main` na ledger remota. Depois publica `mcp-server` e `mcp-oauth-metadata`. O primeiro smoke autenticado acessa o endpoint nativo e descobre pelo desafio a configuração que ainda está efetivamente ativa; por isso uma troca ou remoção de URL/issuer não é comparada prematuramente com os valores desejados. Só depois desse gate o workflow reconcilia os overrides exclusivos do MCP e executa o smoke final, agora exigindo a configuração desejada (inclusive o fallback nativo do issuer quando o override está vazio). Database, migrations, `APP_PUBLIC_URL` e outras funções não são tocados.

### Rollback MCP

Escolha um SHA anterior que seja ancestral do `main` atual e que ainda satisfaça o verificador de portabilidade. Execute:

| Input | Valor |
|---|---|
| `operation` | `rollback` |
| `target_sha` | SHA completo do ancestral aprovado |
| `release_confirmation` | `CANCEL` |
| `rollback_confirmation` | `ROLLBACK_MCP_PRODUCTION` |

O rollback republica somente as duas funções a partir desse SHA e repete os dois smokes. Ele não reverte migrations, tabelas, configuração global ou dados. Um ancestral project-bound só é elegível quando nenhum override MCP incompatível estiver configurado; `APP_PUBLIC_URL` não impede o primeiro rollback porque permanece sob gestão global, fora deste workflow. Se a operação falhar parcialmente, corrija a causa e repita o rollback/release com um SHA integralmente validado; não ajuste arquivos direto no painel.

Não há rollback de banco no workflow. Se uma migration exigir correção, preserve o estado, prepare uma migration forward-only no `main`, confirme outro backup restaurável e execute novamente o workflow de banco antes de qualquer função dependente.

## Build portátil do frontend

Comece pelo exemplo público:

```sh
cp .env.example .env.local
npm ci
npm test -- --run
npm run typecheck
npm run build
node scripts/verify-mcp-portability.mjs
node scripts/mcp-smoke.mjs --self-test
```

O resultado fica em `dist/` e pode ser servido por qualquer host com fallback de SPA para `index.html`.

O contrato de endpoints/provedores já foi desacoplado, e o `.env` e o seed estático foram removidos do HEAD. A situação de cada credencial e qualquer incidente relacionado pertencem ao registro operacional privado. O workflow exige confirmação explícita de que o gate privado foi concluído; nunca copie valores ou detalhes desse registro para logs, issues ou documentação.

### Container

O estágio de runtime usa a versão estável `nginx:1.30.4-alpine`, fixada pelo
digest multi-plataforma imutável no `Dockerfile`. Atualize a tag e o digest
juntos, em um PR que repita o smoke do container.

```sh
docker build \
  --build-arg VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY \
  --build-arg VITE_APP_PUBLIC_URL=https://app.example.com \
  --build-arg VITE_MCP_SERVER_URL=https://api.example.com/functions/v1/mcp-server \
  --build-arg VITE_MCP_OAUTH_METADATA_URL=https://api.example.com/functions/v1/mcp-oauth-metadata \
  --build-arg VITE_WEBHOOK_URL=https://automation.example.com/webhook \
  --build-arg VITE_SUPPORT_WHATSAPP_NUMBER=5511999999999 \
  --tag aceleriq-os:COMMIT_SHA \
  .

docker run --rm --publish 8080:8080 aceleriq-os:COMMIT_SHA
```

Se o MCP continuar no domínio nativo do Supabase, omita os dois argumentos `VITE_MCP_*`. O Nginx expõe `/healthz`, aplica cache `immutable` somente a `/assets/` — onde o Vite publica arquivos com hash — e usa fallback para rotas do `BrowserRouter`. `index.html` permanece com `no-store`.

## Smoke tests

### Frontend

```sh
curl --fail http://127.0.0.1:8080/healthz
curl --fail http://127.0.0.1:8080/login
curl --fail http://127.0.0.1:8080/conectar-mcp
curl --fail http://127.0.0.1:8080/calendario
```

As quatro chamadas devem retornar HTTP 200. No navegador, valide login, painel, `/conectar-mcp`, callbacks de Auth e ausência de erros no console. O CI também constrói e inicia o container, espera o `HEALTHCHECK` ficar saudável e compara byte a byte `index.html` com as respostas de `/login`, `/conectar-mcp` e `/calendario`; isso impede que um 200 sem fallback SPA seja aceito por engano.

### MCP remoto

Carregue `MCP_SMOKE_TOKEN`, `MCP_SMOKE_EXPECTED_KEY_ID` e `MCP_SMOKE_EXPECTED_CLIENT_ID` a partir do gerenciador de segredos do ambiente, informe a URL pública canônica esperada e execute:

```sh
MCP_BASE_URL=https://YOUR_PROJECT_REF.supabase.co \
  MCP_SMOKE_TOKEN="$MCP_SMOKE_TOKEN" \
  MCP_SMOKE_EXPECTED_KEY_ID="$MCP_SMOKE_EXPECTED_KEY_ID" \
  MCP_SMOKE_EXPECTED_CLIENT_ID="$MCP_SMOKE_EXPECTED_CLIENT_ID" \
  MCP_SMOKE_EXPECTED_PUBLIC_URL=https://app.example.com \
  node scripts/mcp-smoke.mjs --require-authenticated
```

O smoke canônico valida o desafio `401` com `WWW-Authenticate`, metadata OAuth, `initialize`, `tools/list`, o desafio sem credencial e uma leitura protegida com a chave dedicada. O token nunca é impresso no resultado. `--include-compat` também testa `/mcp`, mas nunca substitui `/mcp-server`.

### Backend migrado

Além do smoke MCP, valide:

- login, refresh e logout de perfis admin e cliente;
- isolamento RLS entre clientes;
- upload, leitura, processamento e download de arquivos;
- os seis workloads de IA sem `LOVABLE_API_KEY`;
- Auth email, fila, Resend, unsubscribe e supressão;
- Segundo Cérebro, Meta OAuth e jobs habilitados no ambiente;
- Auth redirect URLs, CORS, Storage e callbacks externos.

## Release e rollback do frontend

### Release

1. Parta do `main` remoto e conclua os checks.
2. Gere artefato ou imagem imutável identificada pelo SHA.
3. Publique primeiro em Preview e execute smoke de frontend e MCP.
4. Valide Auth e fluxos admin/cliente com aprovação humana.
5. Promova exatamente o artefato validado, sem recompilar.
6. Mantenha o host anterior disponível até o aceite.
7. Faça DNS em uma mudança separada, com TTL e janela de rollback definidos.

### Rollback

1. Reimplante a imagem ou artefato do SHA anterior.
2. Se houve DNS, restaure o destino anterior.
3. Repita `/healthz`, rotas de SPA e smoke MCP.
4. Registre SHA, causa e resultado.

Um rollback somente do frontend não altera Database nem Edge Functions.

## Migração completa para outro projeto Supabase

Portabilidade já entregue não equivale a copiar o backend. Uma migração completa deve seguir esta ordem:

1. congelar o SHA e inventariar ambientes pelo [`ENVIRONMENT-INVENTORY.md`](ENVIRONMENT-INVENTORY.md);
2. reconciliar migrations com o schema real e gerar backups testados de Database, Auth e Storage;
3. criar o projeto alvo sem tráfego e executar o bootstrap de banco vazio;
4. aplicar a ledger completa, garantindo o binding OAuth antes das funções; depois da carga inicial, toda migration incremental usa `Deploy Supabase Database` com backup confirmado;
5. recriar extensões, grants, RLS, Vault, cron, filas, buckets e políticas;
6. configurar secrets de Supabase, IA, Resend, Standard Webhooks, Meta e Segundo Cérebro;
7. implantar todas as Edge Functions necessárias. O workflow MCP atual cobre apenas `mcp-oauth-metadata` e `mcp-server`, sempre depois do workflow de banco;
8. migrar e reconciliar dados, identidades e objetos de Storage com contagens e checksums;
9. configurar Auth, redirect URLs, CORS, OAuth social, callbacks e domínio de e-mail; definir a tela de consentimento como `${VITE_APP_PUBLIC_URL}/oauth/consent` (`/.lovable/oauth/consent` é somente alias temporário);
10. executar pgTAP, testes unitários, TypeScript, build, smoke MCP e testes de admin/cliente;
11. ensaiar restauração e rollback antes do corte;
12. gerar o frontend com as novas variáveis, promover o artefato validado e só então alterar DNS;
13. manter o projeto anterior em modo recuperável durante a janela aprovada.

Rollback de uma migração de backend restaura o frontend/DNS ao projeto anterior e retoma os callbacks anteriores. Não tente desfazer migrations destrutivamente durante o incidente; preserve o alvo para diagnóstico e reconcilie escritas feitas durante a janela antes de desativá-lo.

## Domínio estável opcional para o MCP

Um domínio como `api.aceleriq.online` pode ocultar o hostname do projeto Supabase. Só o ative depois de certificado, roteamento, CORS, OAuth Protected Resource Metadata, redirect URLs e smoke tests. Depois do corte:

O plugin Codex versionado permite exclusivamente esse domínio estável. Portanto, **não distribua nem instale o plugin** antes de DNS, TLS e o smoke MCP ao vivo desse hostname passarem; até esse gate, use o cliente MCP configurado diretamente no ambiente de transição, sem publicar o pacote do plugin.

- configure `ACELERIQ_MCP_URL` com o endpoint nesse domínio estável;
- confirme que a origem está na allowlist `security.network` do plugin Codex;
- `VITE_MCP_SERVER_URL` e `MCP_RESOURCE_URL` apontam à mesma URL pública de recurso;
- `VITE_MCP_OAUTH_METADATA_URL` e `MCP_OAUTH_METADATA_URL` apontam ao mesmo metadata público;
- `MCP_AUTH_ISSUER` continua no issuer canônico do JWT.

Trocar esse domínio ou o host do frontend não exige reescrever o protocolo, as ferramentas nem o MCP.
