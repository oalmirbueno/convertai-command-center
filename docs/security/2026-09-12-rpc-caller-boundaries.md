# Limites de chamada das RPCs — 12/09/2026

A migration `20260912213530_rpc_caller_boundaries_preserve_data.sql` trata SEC-01 a SEC-05 da revisão em `e081a3b`. Fecha execução herdada de PUBLIC, acrescenta autorização por cliente às RPCs humanas e à leitura de projetos pela equipe, e protege os campos comerciais do perfil. Preserva registros de negócio e histórico e não dispara filas, OAuth ou e-mail durante a aplicação. Mantém assinaturas, parâmetros opcionais, tipos de retorno e OIDs existentes. Registra manutenção periódica SQL que só será ativada após aprovação e aplicação da migration.

## Consumidores e acesso preservado

| RPC/grupo | Consumidor observado | Fronteira após correção |
|---|---|---|
| SELECT projects | `useProjects`, detalhes de projeto e Data API autenticada | Admin global e cliente proprietário; design/traffic/manager somente com vínculo em team_client_assignments. RLS também vale para consulta REST sem filtros da UI. Service_role mantém seu acesso de backend. |
| upsert_current_dossier | `_shared/mcp-write-services.ts:878`, rotinas de avanços | Admin global; manager/design/traffic vinculados ao cliente; service_role e login postgres de cron. Cliente e uid ausente em authenticated recusados. |
| dossie_registrar_avancos / dossie_avancos_texto | `src/lib/esteira/esteiraAcoes.ts:127`, MCP de avanços, cron | Mesmo escopo de equipe por cliente. Versão e conteúdo anteriores preservados. |
| dossie_registrar_avancos_todos | Cron `dossie-avancos-semanais` | Somente backend/owner, sem chamada global por browser. |
| operator_assign_task / operator_human_action | `src/pages/AdminExecucao.tsx:633`, `:651`, MCP | Admin global; equipe restrita à tarefa/vínculo do próprio cliente; serviço mantido. Links sem tarefa resolvível exigem admin/serviço. |
| operator_update | `_shared/aceleriq-operators-services.ts:541` | Serviço MCP preservado; admin autenticado pode operar diretamente. Outros humanos recusados. |
| operator_expire_stale_runs / operator_fechar_orfaos | Antes, consultas de AdminExecucao e serviço MCP; agora manutenção agendada e início de run no backend | Admin/serviço/cron. As leituras deixam de fazer manutenção global; equipe comum não pode chamar as antigas RPCs para contornar o guarda. |
| operator_maintenance_tick | Novo cron `operator-maintenance-5min` e botão alternativo admin em AdminExecucao | Expiração e fechamento lógico em transação única, admin/serviço/cron; nenhuma dependência de acionamento manual por Almir. |
| decisões/aprovações/pausar | AdminExecucao e componentes de Execução | Grants de authenticated preservados, com guardas de papel que já existem no corpo. Sem execução durante a migration. |
| operator_report_event, participar, request_approval, propor_responsavel, registrar_feito | Serviços MCP com client service_role | Exclusivos do backend. O browser não pode se passar por operador nem alterar evidências por chamada direta. |
| operator_ordens_abertas / ordem_executada / cancelar_tarefa | Contrato de agente/backend | Somente service_role e owner. O UI continua lendo suas tabelas autorizadas. Nenhuma ordem existente é alterada. |
| save_meta_ads_token_from_login / ads_oauth_consume_session | `supabase/functions/social-meta-oauth/index.ts:686`, `:890` e callback | Somente backend da Edge OAuth. Admin continua usando a Edge autenticada; token RPC direta não é superfície de browser. Nenhum token é rotacionado por esta migration. |
| ads_oauth_create_session | Início OAuth do painel | Authenticated mantido; checagem admin já existente. |
| ads_contas_conhecidas | Catálogo global de Meta da integração | Admin autenticado/serviço. Não é lista de cliente; retorno permanece igual, com bloqueio do catálogo global para equipe não admin. |
| collect_ads_now | `src/hooks/useAdsMetrics.ts:121` | Botão de atualização da equipe preservado, com seu is_staff existente. Chama ticks como owner após validar o humano; a coleta é global como antes, dados retornados são contagens e a leitura de métricas continua sob RLS. |
| editorial_ciclo_publicacao, wrappers editoriais e social_metrics_ciclo | Cron SQL registrado nas migrations | Somente backend/owner. Nenhum botão direto de UI encontrado para esses wrappers. |
| ads_creatives_tick / ads_metrics_tick / social_metrics_tick / editorial_autopublish_tick | Cron e wrappers autorizados | Service_role e owner; sem PUBLIC, anon ou authenticated direto. Workers não são executados na migration. |
| audits de dossiê/referências | `_shared/aceleriq-read-services.ts:1731`, `:1758` | Somente serviço MCP; não expõem identificadores globais a visitantes. |
| expense_pagar/estornar, can_delete_file, admin_delete_readiness | UI financeira/administrativa/helpers | PUBLIC/anon removidos; authenticated/service mantidos com os guardas existentes. Não se muda Financeiro v1. |
| UPDATE profiles | ProfilePage:33/:44, AuthContext:229, AppLayout:192, UI administrativa financeira | Cliente edita nome, empresa, email, telefone, avatar e confirmação do tour. Admin e service_role mantêm campos comerciais. Novos campos não entram automaticamente na allowlist pessoal. |

O ator de comandos humanos de dossiê, organograma e atribuição passa a `painel:<auth.uid()>`. O valor fornecido pelo browser não governa a auditoria. Em chamadas backend o contrato do ator emitido pelo serviço MCP é mantido.

## Escopo de leitura de projetos

A policy `projects_select` de 09/03 permitia leitura global aos três papéis de equipe, embora seu comentário descrevesse projetos atribuídos. O histórico de 23/02 registra que a abertura começou como contorno da recursão entre projetos e tarefas. O cadastro `team_client_assignments` e o helper `can_access_client(uuid)` posteriores definem o vínculo usado nos demais recursos por cliente; o filtro de `useProjects` não substitui essa autorização no banco.

A correção altera somente o predicado da policy existente para `public.can_access_client(client_id)`. O helper já existente deriva a identidade de `auth.uid()`, consulta os papéis persistidos e o vínculo com o cliente, tem `SECURITY DEFINER`, `STABLE`, `search_path` vazio e EXECUTE para authenticated/service_role, sem anon. Seu corpo não consulta projetos nem tarefas: não reintroduz o ciclo de RLS. Admin continua global, o cliente com papel client lê seus próprios projetos e a equipe lê os clientes aos quais está vinculada. Atribuição de tarefa isolada não substitui o vínculo de equipe com o cliente.

O `ALTER POLICY` mantém o OID e o alvo authenticated. As policies administrativas de escrita, dados, datas, grants da tabela e histórico de projetos removidos logicamente permanecem intactos. O teste de leitura usa consulta sem filtro de cliente/ID, cobre os três papéis de equipe com e sem vínculo, admin, clientes distintos e visitante; a matriz E2E usa login real e o singleton da aplicação, sem extrair tokens.

A aplicação falha antes do `ALTER` se RLS estiver desligada, se `projects_select` não for a policy SELECT permissiva exclusiva para authenticated ou se outra policy permissiva SELECT/ALL puder reabrir a leitura. O helper consulta o par coberto pela chave única existente `(user_id, client_id)` de `team_client_assignments`; não adiciona joins de tarefas à leitura de projetos nem exige índice novo.

O ramo `assigned_to` de `useProjects` consulta tarefas pela sessão normal. A policy atual `tasks_staff_select` chama `can_staff_access_project`, cujo corpo já exige `can_access_client` e ignora `assigned_to`. Portanto, uma tarefa individual atribuída sem vínculo com o cliente já não aparece nessa consulta; o ramo é redundante sob a RLS atual. A correção mantém essa negação e não cria um helper privilegiado que expanda o acesso por atribuição isolada.

## Por que não usar current_user ou uid vazio

Uma função SECURITY DEFINER vê o owner em current_user. Usá-lo como prova de origem transformaria qualquer chamada de browser em chamada de serviço. O helper privado verifica o role efetivo de entrada em `current_setting('role')`. Service_role é reconhecido pelo papel real do banco; texto de JWT não substitui esse papel. Login postgres/supabase_admin/service_role sem SET ROLE é suportado para operações/cron; um request authenticated de session_user authenticator permanece sujeito ao uid/papel/vínculo, mesmo dentro de funções definidoras.

Os helpers novos ficam em app_private sem EXECUTE público e sem mudar USAGE do schema. Funções privadas não são uma nova API. Revogar somente de anon era insuficiente porque EXECUTE vinha de PUBLIC; agora ambos são retirados explicitamente, e os grants legítimos são declarados.

## Forma incremental e preservação

O preâmbulo de sete funções PL/pgSQL é acrescentado às definições efetivas por pg_get_functiondef, preservando os patches e as identidades já usados por outras funções. O lote falha se a assinatura, linguagem ou âncora BEGIN esperada não existir. O antigo check humano de fechar órfãos passa a reconhecer backend real, com o novo guarda admin aplicado antes dele. Dois leitores SQL recebem o mesmo resultado em um RETURN guardado. Não se copiam corpos históricos para substituir código atual. Não se movem funções de schema nem se renomeiam contratos públicos.

Profiles usa trigger, pois admin e cliente compartilham o papel authenticated no REST. Retirar UPDATE de colunas desse papel quebraria também a UI de Almir; o trigger autoriza o admin real e mantém as alterações pessoais do cliente. Compara todas as colunas menos a allowlist explícita, protegendo automaticamente campos adicionais. onboarding_done permanece editável porque o fluxo atual o usa para o tour de primeiro acesso; separar esse sinal de onboarding comercial seria outro lote.

Não há UPDATE/DELETE de dados existentes na migration. Não há limpeza, destruição de tabela, alteração de tokens, despacho de HTTP nem descarte de versões. As funções antigas mantêm seus comportamentos legítimos, mas exigem o chamador autorizado. A correção de cancelamento do worker pertence a uma migration separada; aqui apenas seus grants são tratados.

## Manutenção automática sem recuperar ordens antigas

`operator_maintenance_tick()` retorna JSONB `{stale_runs_expired, orphans: {propostas_fechadas, runs_expirados, vinculos_encerrados}}`. Faz expiração e fechamento lógico na mesma transação. A rotina preserva tarefas, proposals, runs, links, evidências, notas existentes e auditoria; não altera aprovações nem executa ordens. Os corpos efetivos foram inspecionados e usam apenas UPDATE de status/motivo/timestamps. Consulta de metadados confirmou ausência de triggers de usuário em operator_runs, operator_task_links e assignment_proposals no banco revisado.

O job `operator-maintenance-5min` executa `SELECT public.operator_maintenance_tick();` a cada cinco minutos. `cron.schedule` atualiza o mesmo nome/owner se já existir, evitando duplicação. Exige pg_cron instalado e falha de forma explícita se estiver ausente. Nenhum tick é chamado durante a migration; o job passa a funcionar somente após aplicação aprovada. Sessões postgres de cron e service_role real funcionam sem JWT. O botão admin é alternativa de operação, e não obrigação recorrente de Almir.

## Validação executável

Fixture: `tests/database-isolated/fixtures/security_contract.sql`. Testes: `tests/database-isolated/tests/rpc_caller_boundaries.test.sql`. Ambos só aceitam conexão com `SET aceleriq.isolated_tests='on'` em banco descartável. Ficam fora de `supabase test db`; o comando normal continua usando apenas o schema completo de aplicação. Não devem ser executados em produção.

O fixture contém tabelas sintéticas mínimas e 17 definições reais específicas do banco novo, verificadas sem segredos. Rotinas inalteradas fora dos cenários de negócio possuem stubs declarados para o teste de ACL; os ticks downstream registram dispatch local, Vault é uma tabela fictícia e cron.schedule apenas registra o comando em tabela. Assim, o teste executa as funções reais modificadas e os fluxos reais de dossiê/operador/token/manutenção, sem chamar Meta nem agendar processos reais.

Validação atual pelo runner em PostgreSQL 17.11 portátil, pgTAP 1.3.4, localhost:55432, bancos descartáveis `acq_isolated_*`: **121 asserts de segurança, zero falhas**. Inclui session_user=authenticator com SET ROLE; anon; authenticated sem uid; cliente; design/traffic/manager por tenant; admin sem assignments; service_role; cron postgres; ator não forjável; grants transitivos; Vault inerte; zero dispatch nas chamadas recusadas; alterações reais permitidas; fotografia integral de perfil legado/dossiê inseridos antes da migration; e manutenção repetida com contagens zero e comparação integral de campos/timestamps/histórico. A leitura de projetos inclui os três papéis de equipe com e sem vínculo, clientes próprios/cruzados, acesso admin/serviço, preservação de projetos arquivados e OID da policy inalterado.

As assertions positivas verificam persistência e retorno quando relevante, evitando confundir UPDATE de zero linhas com sucesso. Os testes de segurança correm em transação e terminam em ROLLBACK. O log local consolidado está em `work/security-sql-tests.log` da tarefa de revisão.

Runner versionado: `node scripts/test-isolated-db.mjs`, depois de `node scripts/test-isolated-db.mjs --self-test`. Usa PSQL_PATH (ou psql no PATH), PGHOST literal de loopback, PGPORT (padrão 54322), PGUSER=postgres e senha local opcional em PGPASSWORD. Descarta PGDATABASE/PGSERVICE/PGOPTIONS recebidos e gera nomes exclusivos `acq_isolated_security_*` e `acq_isolated_publication_*`. Cria cada banco vazio, aplica o bootstrap versionado, o fixture e sua migration, depois executa os testes. Não reutiliza o banco da aplicação e não apaga bancos automaticamente. Logs ficam em `logs/database-isolated/` (ignorados pelo Git), sem imprimir senha. Erros SQL, TAP negativo e plano incompleto/duplicado fazem o processo falhar.

O CI executa esses contratos após `supabase test db` no PostgreSQL do contêiner Supabase local (127.0.0.1:54322). A senha postgres ali é a configuração pública do contêiner descartável. SET SESSION AUTHORIZATION exige superuser para simular authenticator: se postgres estiver despromovido nesse contêiner, o passo CI usa supabase_admin local para elevar somente durante os contratos sintéticos, com trap para restaurar o papel original inclusive na falha. O runner genérico não eleva papéis; o bootstrap recusa um ambiente sem esse requisito. O runner local integrado passou **229 testes: 121 de segurança, 97 de publicação e 11 concorrentes por dblink**. A conexão dblink permanece em loopback e só usa a senha local temporária recebida por stdin; não acessa serviços externos.

O teste `supabase/tests/database/projects_rls.test.sql` roda separadamente no schema completo do CI. Exercita também o join entre tarefas e projetos sem recursão e confirma que `assigned_to` sem vínculo de cliente não concede leitura da tarefa nem do projeto. A confirmação do replay completo e da matriz E2E com Auth real depende desse CI; a suíte isolada não substitui essas verificações.

## Aceite antes de qualquer aplicação real

1. Integrar a migration ao manifesto/runner sem modificar migrations históricas.
2. Repetir o lote completo com as demais correções no banco isolado; comparar os consumidores com o deployment real em uso, inclusive Edge e MCP divergentes.
3. No preview autorizado, conferir UI de Almir (plano, renovação, atribuição, organograma, Esteira, OAuth Meta via Edge) e equipe vinculada. Não disparar publicações/cron reais para provar permissão.
4. Validar catálogo efetivo de grants/owners e que PostgREST segue mapeando requests a anon/authenticated/service_role. Asserções devem incluir herança de PUBLIC. Confirmar pg_cron e owner postgres/supabase_admin do novo job; acompanhar contagens/estado após o primeiro tick aprovado, sem reenviar ordens antigas.
5. Aplicação em produção é etapa separada. Em caso de regressão, corrigir o guarda/grant do consumidor específico preservando registros; não restaurar PUBLIC EXECUTE nem reverter dados.

Limites: o fixture não é replay integral das migrations, não prova todos os triggers/dependências de produção nem comportamento do provedor OAuth/Meta. Chamadas internas legítimas de refresh/expiração continuam globais como antes; a correção limita quem pode iniciá-las e protege o retorno de dados. Nenhum deploy foi executado por este subtrabalho.
