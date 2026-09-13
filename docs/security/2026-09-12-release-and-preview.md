# Correções de segurança e bugs — 12/09/2026

Este pacote implementa correções para os 17 achados da revisão do Aceleriq OS, com verificações locais, CI e inspeção de leitura do Preview com administrador. Os resultados automatizados devem ser conferidos no SHA atual do PR; a homologação real de equipe/cliente e do runner permanece pendente. O destino autorizado é **aceleriq.online**, repositório **oalmirbueno/convertai-command-center**, backend **jjjtkowvxemvituvywvf**. A implementação parte de `e081a3b2e8f3ebd1c990f9d2a35816eb17745714` e preserva a Esteira atual, dossiê geral, histórico, separação social/tráfego, Financeiro v1 e integração Lovable.

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
| F-02 | Cobrança só confirma após INSERT; falha preserva rascunho e bloqueia clique duplicado; falha de notificação é informada sem recriar a cobrança | Componente Financeiro, helper real com transporte simulado e resposta de gravação Edge |
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
- `deno test --allow-env supabase/functions/mcp-server/mcp_test.ts supabase/functions/_shared/brain-client-context-handler_test.ts supabase/functions/_shared/notification-write-response_test.ts`.
- `deno check` dos 13 entrypoints públicos e portáveis enumerados no workflow, com Deno 2.5.1.
- `node scripts/test-isolated-db.mjs --self-test` e `node scripts/test-isolated-db.mjs` com PostgreSQL 17 local e pgTAP.
- `node scripts/test-ci-editorial-replay.mjs` para os pré-requisitos editoriais e de operadores do banco vazio.
- `node scripts/test-ci-milestones-read-access.mjs` para a permissão legada de leitura exigida pelo join de tarefas no CI.

O runner SQL cria bancos exclusivos com dados sintéticos em loopback. Foram verificados 121 cenários de autorização/manutenção/projetos e 108 de publicação/concorrência, totalizando 229. HTTP, Vault e agendamento são simulados. Isso não equivale a executar todas as dependências, triggers e provedores reais do backend; os limites estão nos fixtures e no documento de fronteiras RPC. A classificação de mídia usa metadados, sem inspecionar os bytes do arquivo.

Os 60 testes Deno de MCP/segundo cérebro, os 13 entrypoints com Deno 2.5.1, TypeScript app/node/test, build, geração/validação compat e integridade de migrations passaram localmente. O fechamento da notificação acrescenta seis testes das leituras necessárias e da resposta de gravação Edge, executados na mesma etapa Deno do CI. O lint dos 62 arquivos iniciais revisados não introduziu diagnóstico novo frente à base (495 erros preexistentes passaram a 492; seis avisos mantidos); os scripts e testes posteriores de deploy foram verificados separadamente sem diagnóstico. Não há alegação de lint global limpo. O resultado final das suítes completas deve ser conferido nos checks do SHA atual do PR.

O CI da aplicação passou no commit `5dd3093`: 196 arquivos, 2.416 testes, tipos, build e contêiner com healthcheck/rotas. O fechamento adicional do deploy por projeto passou 55 testes direcionados. O replay completo do banco exigiu preparação de pré-requisitos ausentes num banco vazio: dois patches históricos endereçavam a guarda de mídia aprovada pelo nome do helper regular, e o organograma posterior esperava os operadores default e atlas. O corpo editorial esperado pertence ao helper aprovado; inserir seu corpo final no meio do histórico quebraria patches posteriores.

O scaffolding de CI usa aliases temporários somente ao redor desses dois patches. Verifica hashes das fontes históricas, corpo esperado, banco vazio, OIDs e ACLs; executa os SQL históricos intactos e restaura imediatamente os nomes e metadados. Para o organograma, insere dois operadores sintéticos sem referência de runner e os mantém inativos após o patch, preservando as seis auditorias históricas geradas. O script materializa seis adaptadores somente no GitHub CI e os remove por hash ao terminar. Nenhum adaptador integra o manifesto de produção. A validação PostgreSQL local adicional passou 16 testes editoriais e 20 de operadores. O pós-check completo exige zero vínculos, runs, aprovações, participações, propostas e entregas dos fixtures. O replay de todas as migrations e esse pós-check passaram no run `34724465837`; a suíte completa de permissões tem resultado próprio no PR.

O workflow executa também as verificações independentes quando uma asserção de banco falha, sem `continue-on-error`: a falha original mantém o job vermelho. Isso permite distinguir problemas de SQL, tipos, funções Edge e artefatos compat no mesmo SHA.

O E2E detectou HTTP 403 no join de tarefas com `milestones`. A inspeção de catálogo em leitura confirmou que o backend real tem SELECT para authenticated e a RLS histórica esperada; o banco novo de CI não herdou esse grant, ausente nos SQL versionados. Um adaptador executado só após o replay, com marcador explícito, atestação e tabelas vazias, concede exclusivamente esse SELECT. Preserva identidade, RLS, policies, outros grants e privilégios default. Os 22 testes PostgreSQL reproduzem a negativa antes, a leitura depois e as negações entre clientes/anon/escritas; nenhum grant foi aplicado em produção.

## Preview e aplicação

A matriz automatizada em `e2e/` usa o Supabase temporário já existente no CI, cinco contas criadas pela API Auth local e login por senha na aplicação real. Os oito cenários cobrem admin, equipe com/sem vínculo, clientes A/B, visitante, senha inválida e bloqueio de saída HTTP/WebSocket. Exercitam filtros, detalhe do cliente, permissões de rotas, formulário cancelado antes de salvar e logout. Tipos e descoberta de testes não contam como execução do navegador; o resultado Chromium é um check separado no SHA do PR.

A configuração E2E mantém o mesmo código da aplicação e define somente os valores públicos do backend loopback. Não importa o pin de produção, não injeta sessão nem simula Auth/respostas de negócio. As respostas de tarefas e projetos dos clientes não têm filtro de escopo. Para todos os cinco papéis autenticados, a matriz também usa o singleton Supabase da aplicação para consultar projetos sem filtro de cliente/ID, retornando somente identificadores e status. Assim testa a autorização pelo PostgREST, sem extrair tokens ou confiar nos cartões filtrados da equipe.

A verificação revelou uma falha adicional em `projects_select`: a remoção histórica de um ciclo entre projetos/tarefas tinha deixado leitura ampla a staff, apesar do comentário de atribuição e das regras atuais dos recursos filhos. A migration SEC01 nova alinha a policy ao helper atual `can_access_client`: admin global, cliente próprio e equipe vinculada por `team_client_assignments`. Nenhuma permissão de escrita muda. Atribuição isolada de tarefa já não concedia leitura sem vínculo sob a RLS atual de tarefas; essa negação permanece explícita nos testes, sem novo helper recursivo ou ampliação de acesso.

O primeiro E2E também reproduziu uma corrida no retorno do login: com `next=/projetos`, a URL global mudava antes de o destino lazy terminar de carregar; uma nova renderização do perfil redirecionava para Dashboard. Login agora lê a localização do React Router, mantendo o destino validado durante essa transição. O teste comportamental com BrowserRouter, Suspense e perfil atualizado falha antes e passa depois; outros seis casos mantêm o fallback seguro para destinos ausentes ou perigosos. A expectativa E2E e o bloqueio de chamadas externas permanecem iguais.

Na cobrança, um helper com resultado explícito confirma a aceitação da notificação sem alterar os consumidores antigos. Erros do banco e da função Edge chegam ao aviso da interface, preservando a cobrança criada; incerteza de transporte não repete a escrita. A função de notificação passa a retornar erro sanitizado se não conseguir confirmar a gravação. Sucesso confirma aceitação no banco, sem prometer entrega ao dispositivo do cliente.

Antes do seed, o CI verifica banco vazio e sem Vault, restaura depois somente os hooks de integração que desativou e confirma que nenhum HTTP foi enfileirado, inclusive por sequência do pg_net. Um bloqueio temporário de encaminhamento IPv4 contém a rede Docker inspecionada até parar o stack; navegador e chamadas Node têm guardas próprias de origem/redirect. As credenciais sintéticas ficam em arquivo ignorado, sem traces/HAR ou artefatos com tokens. O pós-check exige dados de trabalho intactos e filas de publicação/operadores vazias. Esses testes não substituem a homologação humana do Preview nem um smoke do runner real em ambiente autorizado e isolado.

O AGENTS.md exige revisão humana antes de merge, aprovação explícita para aplicar migrations e Publish manual no Lovable. A branch e o draft PR deixam o pacote concreto para essa revisão.

1. Confirmar o SHA revisado, projeto `jjjtkowvxemvituvywvf`, ledger e assinaturas esperadas. Não executar `db reset`, `db push --include-all`, reparo de ledger, cópia de dados ou scripts de limpeza no backend real.
2. No Preview, conferir Almir/admin, equipe vinculada e cliente sem privilégios: edição pessoal, dados comerciais, atribuição, dossiê, Esteira, ações de configurações, histórico de tarefas e cancelamento exibido como terminal. Exercitar falhas e gravações apenas em dados sintéticos isolados. Não usar “visualizar como cliente” como substituto do teste de autorização.
3. Após aprovação, aplicar somente as duas migrations, na ordem acima, com preflight e transação. Conferir grants, trigger de profiles, rotina pg_cron e manutenção idempotente.
4. Implantar `brain-client-context` e `notify-admin` pelo workflow de funções públicas revisado; a segunda função inclui o retorno correto das falhas de notificação. Implantar `mcp-server` e `mcp-oauth-metadata` do mesmo checkout preparado. O workflow gera SHA/digest compartilhado e falha se as duas pontas não concordarem. Rollback para código legado continua disponível, sem exigir um campo de identidade que aquela versão ainda não possuía.
5. Publicar o frontend pelo fluxo manual do Lovable. Conferir `version.json.sourceRevision`, rotas e identidade MCP. Se o ambiente não tiver Git ou contiver modificações, a revisão será `null`, sem alegar um SHA incorreto.
6. Observar a rotina interna e consultar resultados já existentes. Não disparar Meta, mensagens, cobrança ou ordens antigas para demonstrar que uma permissão funciona.

## Rollback sem perder dados

Se houver regressão visual, reimplantar o frontend/Edge anterior aprovado. Preservar as colunas, eventos e registros existentes; não remover histórico nem restaurar EXECUTE de PUBLIC. Corrigir o grant/guarda específico do consumidor legítimo mediante revisão. Se a rotina de manutenção apresentar falha, pausar somente o job novo e manter a alternativa administrativa até corrigir a função. Nenhuma reversão deve reativar publicação cancelada ou reenviar uma geração já despachada.

A inspeção autenticada do dashboard publicado foi possível pelo Chrome. O [projeto Lovable existente](https://lovable.dev/projects/96b08aa1-81bd-4fdc-b0a4-69d220daf3fe) também estava autenticado. Em Configurações → Git → GitHub, o repositório correto ofereceu a branch `codex/seguranca-bugs-20260912`; ela foi selecionada para atualizar somente a prévia, sem merge ou Publish. O commit de revisão apareceu no histórico e a ação Visualizar abriu o [login do Preview](https://preview--orbital-command-hq.lovable.app/login).

A prévia usa o backend `jjjtkowvxemvituvywvf` real e tem sessão própria. Na primeira tentativa, o formulário estava vazio e o login Google retornou HTTP 400, `Unsupported provider: provider is not enabled`. Posteriormente, a aba apresentou sessão de Almir Bueno/Administrador. O mecanismo que disponibilizou essa sessão não foi observado; nenhuma senha foi solicitada em texto, extraída ou redefinida, e nenhum provedor ou conta real foi criado.

Com o administrador autenticado, foram conferidos o dashboard, a lista de projetos e o filtro Planejamento/Todos, inclusive o layout desktop. O Kanban administrativo carregou os cartões de tarefas. Em Configurações, Segurança abriu `/perfil` e Notificações abriu o painel, fechado sem marcar leitura. A Esteira em `/ciclo` carregou as frentes Social/Tráfego; Social foi restaurada ao concluir. Nenhum formulário foi salvo, senha alterada ou trabalho enviado.

A leitura de `version.json` do Preview foi bloqueada pelo navegador (`net::ERR_BLOCKED_BY_CLIENT`), sem tentativa de contorno; portanto não foi atestado o SHA servido. Os cards e a prévia incorporada inicialmente apresentaram falhas, embora a aba separada depois permitisse essas verificações. O SHA local/CI tem evidência separada. A homologação real de equipe/cliente e do runner permanece pendente; não há alegação de migrations implantadas ou correção publicada. Testes de escrita e a matriz completa de autorização continuam restritos ao Supabase sintético.
