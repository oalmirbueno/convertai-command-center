# Correções de segurança e bugs — 12/09/2026

Este pacote implementa correções para os 17 achados da revisão do Aceleriq OS, com validação local concluída e homologação no Preview/produção ainda pendente. O destino autorizado é **aceleriq.online**, repositório **oalmirbueno/convertai-command-center**, backend **jjjtkowvxemvituvywvf**. A implementação parte de `e081a3b2e8f3ebd1c990f9d2a35816eb17745714` e preserva a Esteira atual, dossiê geral, histórico, separação social/tráfego, Financeiro v1 e integração Lovable.

## Escopo e evidências

| Achado | Resultado implementado | Verificação principal |
|---|---|---|
| SEC-01 | Dossiê exige identidade de equipe e acesso ao cliente; serviço mantém acesso | SQL com anon, equipe vinculada/não vinculada, admin, serviço e versões preservadas |
| SEC-02 | Token Meta e consumo de sessão OAuth ficam restritos ao backend | SQL positivo de serviço e negativo de anon/cliente/equipe, Vault simulado |
| SEC-03 | Relatos e ordens de operador restritos ao backend; ações humanas guardadas por papel/cliente | SQL de autorização, ator derivado e histórico |
| SEC-04 | Wrappers e workers internos sem EXECUTE herdado de PUBLIC | Grants efetivos e chamadas permitidas de cron/serviço |
| SEC-05 | Cliente edita campos pessoais; campos comerciais exigem admin/backend | UPDATE real permitido/negado, perfil legado integralmente preservado |
| SEC-06 | Cancelamento e envio serializados; geração impede POST final duplicado; agendamento/publicação exigem mídia compatível | SQL funcional, pg_net simulado, tipos de mídia e duas conexões dblink concorrentes |
| SEC-07 | Segundo cérebro resolve perfil e verifica acesso por UUID; equipe recebe notas vinculadas ao cliente | Handler real com sessão ausente, cliente indevido, equipe válida, admin e notas mistas |
| F-01 | Erros da Esteira são apresentados; último snapshot permanece; cache inclui identidade | Consultas com falha, recuperação, refresh e troca de sessão |
| F-02 | Cobrança só confirma após INSERT; falha preserva rascunho e bloqueia clique duplicado | Componente Financeiro e serviço de gravação com transporte simulado |
| F-03 | Ações apontam para `/calendario` e `/anuncios` | Montagem e rotas existentes |
| F-04 | Publicação em um destino não oculta falha no outro | Post com destinos publicados/falhos no mesmo cenário |
| F-05 | Onboarding de tráfego não depende de etapa social removida | Cliente somente tráfego |
| F-06 | Fixtures completas permitem checagem de tipos dos testes | TypeScript app/node/test |
| F-07 | Segurança abre perfil; notificações abrem o painel existente | Cliques dos componentes |
| F-08 | Lista padrão filtra projetos removidos; opção explícita consulta o histórico no mesmo escopo | MCP e compat com histórico, paginação, contagem e isolamento |
| DEP-01 | Versão MCP central, identidade de release em ambas as pontas e validação pós-deploy | Rejeição de implantação parcial/versão divergente; geração compat Windows |
| DEP-02 | Mapa e tour descrevem Esteira atual, histórico em `/ciclo-antigo` e contratos em `/contratos` | Contratos de navegação e tour |

As consultas do quadro de operadores agora são somente leitura. A rotina `operator_maintenance_tick()` executa a manutenção interna a cada cinco minutos pelo pg_cron, de forma idempotente; o botão administrativo é uma alternativa. A retomada explícita `operator_report(event=started)` continua verificando execuções expiradas. Nenhuma dessas rotinas dispara trabalhos externos.

Essa correção de indicadores e reconciliação não comprova a retomada real dos agentes. Os testes locais cobrem autorização, manutenção e eventos sintéticos; o trajeto painel → ponte/runner → heartbeat → resultado ainda precisa de smoke em ambiente isolado que impeça despacho para clientes. O smoke MCP existente verifica autenticação/leitura e não inicia Hermes. Nos caminhos revisados, não foi encontrado um dry-run completo: a dependência concreta é um runner Hermes conectado ao ambiente isolado, com operador e tarefa sintéticos, acompanhando `started → heartbeat → done` e evidência persistida. Não foram reativadas ordens antigas. A matriz de perfis também permanece pendente no Preview; os testes de SQL e componentes não substituem essa homologação.

## Duas migrations novas, em ordem

1. `supabase/migrations/20260912213530_rpc_caller_boundaries_preserve_data.sql`
2. `supabase/migrations/20260912213638_secure_publication_cancellation_dispatch.sql`

As migrations antigas não foram editadas. O manifesto de integridade e a lista de forward migrations receberam somente as duas entradas novas. Não há migração de dados, limpeza de histórico, recriação de banco, alteração de cobrança real, rotação de token ou reenvio de ordens antigas neste lote.

O ledger do backend novo precisa de conferência própria. Seu snapshot contém metadados de 206 registros; 201 não retêm o SQL original. Comparar esse snapshot detecta drift do registro, mas não prova replay histórico. A implantação deve preservar essas entradas e aplicar somente as duas migrations deste pacote. O gerador legado não deve ser usado para reexecutar o histórico no backend novo.

O preflight MCP usa `node scripts/prepare-project-migration-ledger.mjs --project-ref jjjtkowvxemvituvywvf --ledger-sql-values`: espera as 206 triplas revisadas mais as duas novas, comparando versão, nome e hash. Um projeto desconhecido falha; o manifesto antigo só é selecionado pelo identificador explícito do backend antigo. Nenhum gerador deste preflight conecta ao banco ou aplica SQL. O corpo atual do tick e os wrappers de promoção/publicação foram comparados ao catálogo do backend novo e coincidem com os corpos canônicos usados na correção.

O workflow de banco usa `prepare-project-migration-view.mjs` para preparar a aplicação: cada versão já existente vira uma sentinela que aborta se for executada; somente as migrations pendentes possuem SQL real, copiado byte a byte e validado por hash. Uma lacuna antes de versão já aplicada, alteração de nome/hash, projeto desconhecido ou diretório de saída existente bloqueia a preparação. O postflight valida novamente contra os arquivos originais preservados. O workflow Public Edge também usa o ledger do projeto explícito. Nenhum desses workflows foi disparado em produção.

A atestação do schema é adaptada por `prepare-project-baseline-attestation.mjs`, com hash fixo do SQL histórico e todas as condições de readiness preservadas. Mantém os exatos 34 grants de SELECT e 12 de UPDATE por coluna, além de negar grants de tabela, usando `has_column_privilege` para não depender da visibilidade do `information_schema` do inspetor. Atualiza somente o esperado de serviço em `save_editorial_post_unlocked`, concedido pelos patches históricos e confirmado no catálogo atual; anon/authenticated continuam negados. A consulta adaptada retornou `PRODUCTION_BASELINE_SCHEMA_READY` no backend novo em leitura, sem concessão ou alteração de dados.

## Limites de cancelamento e compatibilidade

O pg_net inicia HTTP após o COMMIT. Se o cancelamento obtiver o lock antes do enfileiramento final, nenhum envio final ocorre. Se o envio já foi enfileirado, o sistema recusa prometer cancelamento e orienta conferir o resultado. Em incerteza/timeout, retoma a verificação do container; não repete o POST final da mesma geração. Uma nova geração exige reabertura/agendamento válido e mantém os identificadores anteriores no histórico.

Publicações manuais legítimas, inclusive promoção pelo caminho canônico antigo, continuam suportadas. Conteúdo preparado sem fingerprint comprovável é recusado até preparação/retry autorizado. O estágio `cancelled` é terminal também na UI, sem spinner ou botão de retry automático.

O replay completo também revelou que um documento PDF aprovado podia avançar pelo gate genérico de aprovação. A correção mantém sua anexação para revisão, mas exige o predicado canônico de imagem/vídeo antes de agendar, registrar publicação e despachar mídia. Aprovação de conteúdo não substitui compatibilidade de formato. Os testes atuais preservam as decisões versionadas de visibilidade do cronograma e de administração das alíquotas V1, com negações explícitas de acesso entre clientes, edição pelo cliente e escrita direta nas tabelas V2.

O handler do segundo cérebro mantém compatibilidade com `client_name` por busca exata e única de perfil seguida da mesma autorização por UUID. O frontend novo envia `client_id`. Admin continua lendo notas legadas; equipe comum precisa de nota Markdown com um único `client_id` no front matter. Uma menção em ata compartilhada não prova escopo de cliente. A ausência dessas notas só remove contexto complementar, sem impedir a geração pelos fatos/dossiê do painel.

## Validação local reproduzível

- `npm test -- --run` e `npm run typecheck`.
- `npm run build`.
- `npm --prefix integrations/lovable-mcp-compat run verify` e `run generate`.
- `npm run migrations:verify`; `node scripts/verify-migration-integrity.mjs --base-ref origin/main`.
- `node scripts/verify-mcp-portability.mjs`; `npm run mcp:test:scripts`.
- `deno test --allow-env supabase/functions/mcp-server/mcp_test.ts supabase/functions/_shared/brain-client-context-handler_test.ts`.
- `deno check` dos 13 entrypoints públicos e portáveis enumerados no workflow, com Deno 2.5.1.
- `node scripts/test-isolated-db.mjs --self-test` e `node scripts/test-isolated-db.mjs` com PostgreSQL 17 local e pgTAP.
- `node scripts/test-ci-editorial-replay.mjs` para os pré-requisitos editoriais e de operadores do banco vazio.

O runner SQL cria bancos exclusivos com dados sintéticos em loopback. Foram verificados 95 cenários de autorização/manutenção e 108 de publicação/concorrência, totalizando 203. HTTP, Vault e agendamento são simulados. Isso não equivale a executar todas as dependências, triggers e provedores reais do backend; os limites estão nos fixtures e no documento de fronteiras RPC. A classificação de mídia usa metadados, sem inspecionar os bytes do arquivo.

Os 60 testes Deno de MCP/segundo cérebro, os 13 entrypoints com Deno 2.5.1, TypeScript app/node/test, build, geração/validação compat e integridade de migrations passaram localmente. O lint dos 62 arquivos iniciais revisados não introduziu diagnóstico novo frente à base (495 erros preexistentes passaram a 492; seis avisos mantidos); os scripts e testes posteriores de deploy foram verificados separadamente sem diagnóstico. Não há alegação de lint global limpo. O resultado final das suítes completas deve ser conferido nos checks do SHA atual do PR.

O CI da aplicação passou no commit `119c49e`: 195 arquivos, 2.404 testes, tipos, build e contêiner com healthcheck/rotas. O fechamento adicional do deploy por projeto passou 45 testes direcionados. O replay completo do banco exigiu preparação de pré-requisitos ausentes num banco vazio: dois patches históricos endereçavam a guarda de mídia aprovada pelo nome do helper regular, e o organograma posterior esperava os operadores default e atlas. O corpo editorial esperado pertence ao helper aprovado; inserir seu corpo final no meio do histórico quebraria patches posteriores.

O scaffolding de CI usa aliases temporários somente ao redor desses dois patches. Verifica hashes das fontes históricas, corpo esperado, banco vazio, OIDs e ACLs; executa os SQL históricos intactos e restaura imediatamente os nomes e metadados. Para o organograma, insere dois operadores sintéticos sem referência de runner e os mantém inativos após o patch, preservando as seis auditorias históricas geradas. O script materializa seis adaptadores somente no GitHub CI e os remove por hash ao terminar. Nenhum adaptador integra o manifesto de produção. A validação PostgreSQL local adicional passou 16 testes editoriais e 20 de operadores. O pós-check completo exige zero vínculos, runs, aprovações, participações, propostas e entregas dos fixtures. O replay de todas as migrations e esse pós-check passaram no run `34724465837`; a suíte completa de permissões tem resultado próprio no PR.

O workflow executa também as verificações independentes quando uma asserção de banco falha, sem `continue-on-error`: a falha original mantém o job vermelho. Isso permite distinguir problemas de SQL, tipos, funções Edge e artefatos compat no mesmo SHA.

## Preview e aplicação

A matriz automatizada em `e2e/` usa o Supabase temporário já existente no CI, cinco contas criadas pela API Auth local e login por senha na aplicação real. Os oito cenários cobrem admin, equipe com/sem vínculo, clientes A/B, visitante, senha inválida e bloqueio de saída HTTP/WebSocket. Exercitam filtros, detalhe do cliente, permissões de rotas, formulário cancelado antes de salvar e logout. Tipos e descoberta de testes não contam como execução do navegador; o resultado Chromium é um check separado no SHA do PR.

A configuração E2E mantém o mesmo código da aplicação e define somente os valores públicos do backend loopback. Não importa o pin de produção, não injeta sessão nem simula Auth/respostas de negócio. As respostas de tarefas sem filtro de cliente verificam RLS; respostas/cartões de projetos verificam o filtro feito pela UI. A policy histórica de projetos permite leitura mais ampla a staff e não é atestada como restritiva por essa matriz.

Antes do seed, o CI verifica banco vazio e sem Vault, restaura depois somente os hooks de integração que desativou e confirma que nenhum HTTP foi enfileirado, inclusive por sequência do pg_net. Um bloqueio temporário de encaminhamento IPv4 contém a rede Docker inspecionada até parar o stack; navegador e chamadas Node têm guardas próprias de origem/redirect. As credenciais sintéticas ficam em arquivo ignorado, sem traces/HAR ou artefatos com tokens. O pós-check exige dados de trabalho intactos e filas de publicação/operadores vazias. Esses testes não substituem a homologação humana do Preview nem um smoke do runner real em ambiente autorizado e isolado.

O AGENTS.md exige revisão humana antes de merge, aprovação explícita para aplicar migrations e Publish manual no Lovable. A branch e o draft PR deixam o pacote concreto para essa revisão.

1. Confirmar o SHA revisado, projeto `jjjtkowvxemvituvywvf`, ledger e assinaturas esperadas. Não executar `db reset`, `db push --include-all`, reparo de ledger, cópia de dados ou scripts de limpeza no backend real.
2. No Preview, conferir Almir/admin, equipe vinculada e cliente sem privilégios: edição pessoal, dados comerciais, atribuição, dossiê, Esteira, ações de configurações, histórico de tarefas e cancelamento exibido como terminal. Exercitar falhas e gravações apenas em dados sintéticos isolados. Não usar “visualizar como cliente” como substituto do teste de autorização.
3. Após aprovação, aplicar somente as duas migrations, na ordem acima, com preflight e transação. Conferir grants, trigger de profiles, rotina pg_cron e manutenção idempotente.
4. Implantar `brain-client-context`. Implantar `mcp-server` e `mcp-oauth-metadata` do mesmo checkout preparado. O workflow gera SHA/digest compartilhado e falha se as duas pontas não concordarem. Rollback para código legado continua disponível, sem exigir um campo de identidade que aquela versão ainda não possuía.
5. Publicar o frontend pelo fluxo manual do Lovable. Conferir `version.json.sourceRevision`, rotas e identidade MCP. Se o ambiente não tiver Git ou contiver modificações, a revisão será `null`, sem alegar um SHA incorreto.
6. Observar a rotina interna e consultar resultados já existentes. Não disparar Meta, mensagens, cobrança ou ordens antigas para demonstrar que uma permissão funciona.

## Rollback sem perder dados

Se houver regressão visual, reimplantar o frontend/Edge anterior aprovado. Preservar as colunas, eventos e registros existentes; não remover histórico nem restaurar EXECUTE de PUBLIC. Corrigir o grant/guarda específico do consumidor legítimo mediante revisão. Se a rotina de manutenção apresentar falha, pausar somente o job novo e manter a alternativa administrativa até corrigir a função. Nenhuma reversão deve reativar publicação cancelada ou reenviar uma geração já despachada.

A inspeção autenticada do dashboard publicado foi possível pelo Chrome. O [projeto Lovable existente](https://lovable.dev/projects/96b08aa1-81bd-4fdc-b0a4-69d220daf3fe) também estava autenticado. Em Configurações → Git → GitHub, o repositório correto ofereceu a branch `codex/seguranca-bugs-20260912`; ela foi selecionada para atualizar somente a prévia, sem merge ou Publish. O commit de revisão apareceu no histórico e a ação Visualizar abriu o [login do Preview](https://preview--orbital-command-hq.lovable.app/login).

A prévia usa o backend `jjjtkowvxemvituvywvf` real e tem sessão própria. O formulário estava vazio, sem preenchimento de acesso disponível; o login Google retornou HTTP 400, `Unsupported provider: provider is not enabled`, no endpoint de autorização desse projeto. A homologação autenticada depende de entrar pela UI com acesso existente e, para a matriz completa, de sessões autorizadas de admin, equipe e cliente. Nenhuma senha foi solicitada em texto, extraída ou redefinida, e nenhum provedor ou conta foi criado.

O layout desktop do login e a desativação de Entrar com campos vazios foram conferidos. A leitura de `version.json` do Preview foi bloqueada pelo navegador (`net::ERR_BLOCKED_BY_CLIENT`), sem tentativa de contorno; portanto não foi atestado o SHA do artefato servido pela prévia. Os cards do Lovable indicavam prévia desatualizada/build malsucedido, e a prévia ao vivo incorporada ficou em branco após atualizar; isso também limita a homologação. O SHA de build local e do CI tem evidência separada. Não há alegação de correção já publicada ou de matriz autenticada concluída. Como o Preview aponta para dados reais, testes de escrita continuam restritos aos bancos sintéticos.
