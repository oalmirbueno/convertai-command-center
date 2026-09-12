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
| SEC-06 | Cancelamento e envio serializados; geração e registro de dispatch impedem POST final duplicado | SQL funcional, pg_net simulado e duas conexões dblink concorrentes |
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

## Limites de cancelamento e compatibilidade

O pg_net inicia HTTP após o COMMIT. Se o cancelamento obtiver o lock antes do enfileiramento final, nenhum envio final ocorre. Se o envio já foi enfileirado, o sistema recusa prometer cancelamento e orienta conferir o resultado. Em incerteza/timeout, retoma a verificação do container; não repete o POST final da mesma geração. Uma nova geração exige reabertura/agendamento válido e mantém os identificadores anteriores no histórico.

Publicações manuais legítimas, inclusive promoção pelo caminho canônico antigo, continuam suportadas. Conteúdo preparado sem fingerprint comprovável é recusado até preparação/retry autorizado. O estágio `cancelled` é terminal também na UI, sem spinner ou botão de retry automático.

O handler do segundo cérebro mantém compatibilidade com `client_name` por busca exata e única de perfil seguida da mesma autorização por UUID. O frontend novo envia `client_id`. Admin continua lendo notas legadas; equipe comum precisa de nota Markdown com um único `client_id` no front matter. Uma menção em ata compartilhada não prova escopo de cliente. A ausência dessas notas só remove contexto complementar, sem impedir a geração pelos fatos/dossiê do painel.

## Validação local reproduzível

- `npm test -- --run` e `npm run typecheck`.
- `npm run build`.
- `npm --prefix integrations/lovable-mcp-compat run verify` e `run generate`.
- `npm run migrations:verify`; `node scripts/verify-migration-integrity.mjs --base-ref origin/main`.
- `node scripts/verify-mcp-portability.mjs`; `npm run mcp:test:scripts`.
- `deno test --allow-env supabase/functions/mcp-server/mcp_test.ts supabase/functions/_shared/brain-client-context-handler_test.ts`.
- `deno check` dos entrypoints `brain-client-context`, `mcp-server` e `mcp-oauth-metadata`.
- `node scripts/test-isolated-db.mjs --self-test` e `node scripts/test-isolated-db.mjs` com PostgreSQL 17 local e pgTAP.

O runner SQL cria bancos exclusivos com dados sintéticos em loopback. Foram verificados 95 cenários de autorização/manutenção e 87 de publicação/concorrência. HTTP, Vault e agendamento são simulados. Isso não equivale a executar todas as dependências, triggers e provedores reais do backend; os limites estão nos fixtures e no documento de fronteiras RPC.

Resultados registrados: suíte integrada de aplicação com 192 arquivos e 2.374 testes aprovados; os 11 testes adicionados depois para o ledger por projeto também passaram. Os 60 testes Deno de MCP/segundo cérebro, TypeScript app/node/test, build, geração/validação compat e integridade de migrations passaram. O lint dos 62 arquivos revisados não introduziu diagnóstico novo frente à base (495 erros preexistentes passaram a 492; seis avisos mantidos); os dois arquivos posteriores do ledger por projeto passaram sem diagnóstico. O CI remoto terá resultado próprio no PR.

## Preview e aplicação

O AGENTS.md exige revisão humana antes de merge, aprovação explícita para aplicar migrations e Publish manual no Lovable. A branch e o draft PR deixam o pacote concreto para essa revisão.

1. Confirmar o SHA revisado, projeto `jjjtkowvxemvituvywvf`, ledger e assinaturas esperadas. Não executar `db reset`, `db push --include-all`, reparo de ledger, cópia de dados ou scripts de limpeza no backend real.
2. No Preview, conferir Almir/admin, equipe vinculada e cliente sem privilégios: edição pessoal, dados comerciais, atribuição, dossiê, Esteira, ações de configurações, histórico de tarefas e cancelamento exibido como terminal. Exercitar falhas e gravações apenas em dados sintéticos isolados. Não usar “visualizar como cliente” como substituto do teste de autorização.
3. Após aprovação, aplicar somente as duas migrations, na ordem acima, com preflight e transação. Conferir grants, trigger de profiles, rotina pg_cron e manutenção idempotente.
4. Implantar `brain-client-context`. Implantar `mcp-server` e `mcp-oauth-metadata` do mesmo checkout preparado. O workflow gera SHA/digest compartilhado e falha se as duas pontas não concordarem. Rollback para código legado continua disponível, sem exigir um campo de identidade que aquela versão ainda não possuía.
5. Publicar o frontend pelo fluxo manual do Lovable. Conferir `version.json.sourceRevision`, rotas e identidade MCP. Se o ambiente não tiver Git ou contiver modificações, a revisão será `null`, sem alegar um SHA incorreto.
6. Observar a rotina interna e consultar resultados já existentes. Não disparar Meta, mensagens, cobrança ou ordens antigas para demonstrar que uma permissão funciona.

## Rollback sem perder dados

Se houver regressão visual, reimplantar o frontend/Edge anterior aprovado. Preservar as colunas, eventos e registros existentes; não remover histórico nem restaurar EXECUTE de PUBLIC. Corrigir o grant/guarda específico do consumidor legítimo mediante revisão. Se a rotina de manutenção apresentar falha, pausar somente o job novo e manter a alternativa administrativa até corrigir a função. Nenhuma reversão deve reativar publicação cancelada ou reenviar uma geração já despachada.

A inspeção autenticada do dashboard publicado foi possível pelo Chrome. O código corrigido ainda exige validação visual no Preview e implantação aprovada; não há alegação de correção já publicada.
