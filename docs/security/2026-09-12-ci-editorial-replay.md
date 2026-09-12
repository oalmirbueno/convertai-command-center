# Replay editorial do banco vazio no CI — 12/09/2026

O CI parava na migration histórica 20260814110000, antes das correções deste PR. Ela procura a guarda de reuso de mídia em save_editorial_post_unlocked, mas essa guarda pertence a save_approved_editorial_post_unlocked. A migration seguinte, 20260814120000_free_art_approved_flow.sql, registra explicitamente essa distinção e corrige o fluxo aprovado. As fontes envolvidas são byte a byte iguais ao main e permanecem intactas.

A correção é exclusiva do scaffolding de CI: scripts/prepare-ci-editorial-replay.mjs materializa quatro arquivos temporários, antes/depois de 20260814070000 e antes/depois de 20260814110000. Cada par dá temporariamente ao corpo aprovado real o nome consultado pelo patch histórico, executa o SQL histórico sem mudar um byte e restaura imediatamente os nomes. A função geral nunca recebe uma guarda inventada nem tem seu corpo substituído. Nenhuma migration é pulada e a migration corretiva 20260814120000 também executa integralmente, reconhecendo o resultado canônico.

## Evidência e proteção preservada

- A função aprovada real é criada em 20260729233930_fb88e549-12f5-4470-83e2-53115d155764.sql:121; sua guarda aparece na linha 439.
- A função geral vem de 20260728161129_create_editorial_calendar.sql e é renomeada em 20260728235000_sync_editorial_tasks_bidirectionally.sql:48.
- O alvo incorreto está em 20260814110000_free_art_from_archived_publications.sql:14; a ausência da guarda interrompe nas linhas 38–39.
- 20260814070000 também tentava alterar o alvo geral, mas tolerava ausência com NOTICE. Adaptá-la primeiro é necessário para que a correção completa de 20260814120000 reconheça sua guarda final; cada adaptação é encerrada antes das migrations intermediárias.
- Catálogo vivo do backend novo consultado somente para definições/ACL: ambas as funções são SECURITY DEFINER, owner postgres, search_path vazio. A geral concede EXECUTE a service_role; a aprovada concede somente ao owner, sem anon/authenticated/service_role.
- O REVOKE/GRANT do patch histórico atinge o nome temporário. Por isso a restauração também retira explicitamente essa concessão transitória de service_role e exige igualdade das ACLs, owner, SECURITY DEFINER e search_path com o snapshot original por OID.
- O hash do corpo geral deve permanecer invariável. O hash do corpo aprovado antes e depois de cada patch é derivado exclusivamente dos corpos e substituições reais das migrations fixadas por SHA-256.
- Não há importação de linhas, credenciais, configuração privada ou snapshot completo de produção.

## Interface do CI

Executar node scripts/prepare-ci-editorial-replay.mjs --self-test e --stage depois de preparar o bootstrap legado e antes de supabase start. Executar --restore em passo always, antes de remover o bootstrap legado e restaurar os shadow files. O staging exige CI=true e GITHUB_ACTIONS=true, recusa sobrescrita e registra os seis hashes (quatro adaptadores editoriais e dois pré-requisitos de operadores descritos abaixo). Restore remove somente os arquivos temporários cujo nome e hash correspondem ao registro; não remove nem altera migrations históricas. --print-plan fornece os nomes e hashes sem escrita.

O SQL exige session_user=postgres e ausência de registros em editorial_posts/editorial_publications; valida assinatura, nome temporário livre, corpo esperado e permissões antes da troca. Qualquer divergência interrompe o CI. Os snapshots são metadados de teste num schema privado aceleriq_ci_replay, nunca registros de negócio. O adaptador não é um bootstrap remoto genérico nem entra na ledger de produção.

Arquivos gerados:
- 20260814065959_ci_bind_approved_editorial.sql
- 20260814070001_ci_restore_editorial_names.sql
- 20260814105959_ci_bind_approved_editorial.sql
- 20260814110001_ci_restore_editorial_names.sql
- 20260828135959_ci_seed_operator_parents.sql
- 20260828140001_ci_freeze_operator_parents.sql

Fontes fixadas por SHA-256 no gerador:
- Calendar: 3eebbca18216f74a8f1222a6366c3bd6f15b0fa4311666333daf7cfa199c57cd
- Fluxo aprovado: c997ecb61a0df4554fdffd3879f278016c2640a438fce8cb54e747937e4ca47c
- Patch 14:07: d2d7b35bb45b197edf801917655ab4728bbc006fa2826792e695620ea71a4a3c
- Patch 14:11: 2d6bb8ff931d779c671b658389a34fe707fc4ed6fc755b723230231aef3b0d37
- Correção 14:12: 645227a41badbe7fe2651b81b4010bed9e5d7c305cfbb759e7b2201b9e671662

## Validação executada

node scripts/test-ci-editorial-replay.mjs passou 16 assertions pgTAP em PostgreSQL 17.11 isolado. O runner cria somente banco novo acq_isolated_editorial_* em loopback e o mantém para inspeção. Ele usa o fixture editorial sintético, instala as funções reais extraídas das fontes e executa literalmente os patches anteriores 20260812120000/20260814020000/20260814030000, os dois patches adaptados e a correção 20260814120000.

Os testes verificam:
- OIDs, nomes, corpo geral e permissões restaurados;
- bloqueio real de mídia vinculada a post vivo e publicação viva;
- adoção real de mídia de post arquivado, publicação de post arquivado e client_shared sem data de decisão;
- três novos posts e três eventos de auditoria nos caminhos autorizados;
- negação ao papel cliente;
- preservação integral de posts e publicações anteriores.

Log local: logs/database-isolated/editorial-replay.log, ignorado pelo Git. O self-test do gerador também passou. Não há Docker disponível no notebook; o replay completo da stack Supabase e das migrations posteriores depende do CI GitHub. Esses testes locais provam o pré-requisito editorial e seu comportamento, não antecipam resultado verde de etapas remotas ainda não executadas. Nenhuma alteração ou execução mutável foi feita em produção.

## Pré-requisito do organograma encontrado no replay seguinte

O run 34723797322 avançou pelo trecho editorial e parou em 20260828140000_operadores_hierarquia_e_vinculo_unico.sql:93: `parent_not_found: default nao e um operador conhecido`. O seed real de 20260827200000 contém somente Augusto, Vértice, Registro e Prisma. O organograma de 28/08 exige Augusto → default e Vértice/Registro/Prisma → atlas; atlas responde a Augusto. Assim, existem dois pais ausentes no banco vazio. Os demais slugs ausentes são ignorados explicitamente pelo SQL histórico e não precisam de cadastro.

Os dois novos arquivos temporários cercam somente 20260828140000. O primeiro insere diretamente dois cadastros sintéticos, com IDs determinísticos, escopo explícito de CI, `hermes_profile_ref=''`, `permissions={}`, `last_run_at=NULL` e estado `inactive`. Não chama `operator_register`, não cria conta humana, tarefa, fila, aprovação ou configuração de integração. A migration original roda inteira, inclusive reconciliação e organograma. Como o organograma ativa os cadastros, o arquivo imediatamente seguinte devolve somente os dois fixtures a `inactive`; mantém hierarquia, coordenação e as seis auditorias originais. `inactive` satisfaz tanto a constraint de 27/08 quanto sua ampliação em 29/08. Não há DELETE, TRUNCATE ou remoção de registros no scaffolding.

As pré-condições exigem os dois atestados editoriais já restaurados, exatamente os quatro slugs do seed canônico e zero runs, vínculos ou auditorias. Também recusam triggers não revisados de INSERT/UPDATE em internal_operators e de INSERT em operator_audit_log. No histórico, o único trigger relevante recusa UPDATE/DELETE da auditoria; permanece intacto. `operator_update` valida o pai/ciclo, atualiza os metadados e insere auditoria, sem HTTP ou runner. A rotina histórica de reconciliação contém um DELETE para gêmeos, mas a pré-condição de zero vínculos garante que seu ramo não execute no CI. A pós-condição exige seis operadores, seis auditorias de organograma e preservação dos campos estáveis dos quatro pilotos antes de congelar os dois fixtures. Qualquer divergência aborta.

`permissions={}` é metadado descritivo, não uma autorização técnica. A inércia depende também do isolamento do banco CI, estado inactive, ausência de vínculo com runtime e filas vazias. Não constitui prova de retomada real dos agentes.

Após `supabase start`, executar o teste somente leitura abaixo antes de pgTAP:

```sh
psql -X -v ON_ERROR_STOP=1 -f supabase/bootstrap/ci-operator-parents-postcheck.sql
```

Usar a conexão local já configurada pelo workflow. O arquivo exige o atestado do scaffolding e verifica, no schema completo, zero linhas associadas aos dois pais em operator_task_links, operator_runs, operator_approvals, operator_participations, assignment_proposals e operator_deliveries. Todas têm operator_id nas definições reais. A ausência de qualquer tabela ou mudança da identidade/inércia do fixture interrompe o teste; não é pulada. O arquivo não é migration, não entra no plano de produção e não altera dados.

Fontes adicionais fixadas por SHA-256:

- Operadores 27/08: `76e2aa288af5c4767e7df7d3b8072d607f135933de2b0a66c8f10211f41dadf2`.
- Hierarquia 28/08 01:00: `3fa3ae53155c714c571010c27b1858321b073a0a4b090b20c64ba23b99e2158c`.
- Reparo/organograma 28/08 14:00: `0b244130c7729a768fa91ab168bc1b3a82d03b673029f5493be4d7fe48bbc72a`.
- Participação/aprovação/propostas 29/08: `dd5aab22e436a36d1e8a879175840622025028b0b1111cd0d370afd9729e969f`.
- Entregas 01/09: `75764b1a1ed30a0c0471c0b4cd1ec9cb387c008553107116d07526b56f872138`.

O runner existente agora passou **16 assertions editoriais + 20 de operadores** em PostgreSQL 17 isolado, executando literalmente as três migrations de operadores acima. Depois instalou integralmente as duas fontes posteriores de tabelas e passou o mesmo pós-check usado pelo workflow completo. Os testes negativos exercitam pai desconhecido, ciclo, tentativa de evento dos dois cadastros inativos e UPDATE proibido da auditoria; confirmam zero execução/HTTP/tarefa/conta humana e reconciliação vazia idempotente. A prova local é focal: a stack completa ainda precisa passar no GitHub CI. Nenhuma migration histórica ou ledger foi editada e nenhum comando mutável foi executado em produção.
