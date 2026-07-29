# ADR-0001: Área da tarefa e sincronização editorial

- Status: proposto
- Data: 28/07/2026
- Escopo: Kanban central e calendário editorial

## Contexto

O calendário editorial precisa consumir as tarefas de Design do Kanban central sem criar uma fila paralela. A classificação anterior dependia indiretamente do responsável, e o vínculo entre tarefa e conteúdo não mantinha os dois fluxos sincronizados.

## Decisão

1. `tasks.workstream` passa a ser a classificação canônica da área da tarefa.
2. Os valores aceitos são `general`, `design`, `content`, `video`, `traffic`, `development` e `operations`. O padrão é `general`.
3. `tasks.delivery_type` registra o tipo específico da entrega sem substituir a área. O padrão `unspecified` preserva tarefas legadas e outros criadores ainda não migrados.
4. Os tipos aceitos são `unspecified`, `design`, `branding`, `static`, `carousel`, `reel`, `story`, `video`, `short`, `article`, `google_post`, `planning`, `copywriting`, `website`, `landing_page`, `automation`, `traffic`, `seo`, `document`, `report` e `other`.
5. A elegibilidade editorial é derivada no aplicativo. São publicáveis `design`, `static`, `carousel`, `reel`, `story`, `video`, `short`, `article` e `google_post`; `design` corresponde ao formato editorial `static`.
6. Tipos não publicáveis, como Branding, Planejamento, Site e Automação, permanecem no Kanban central e não devem entrar no calendário editorial.
7. Enquanto `delivery_type` estiver ausente ou como `unspecified`, a interface mantém o fallback conservador por área, responsável de Design ou sinais editoriais fortes no título e na descrição. Sinais legados claros de Branding, Planejamento, Site, Automação, Tráfego, SEO, Documento ou Relatório prevalecem e ficam fora do calendário. Áreas explícitas de Tráfego, Desenvolvimento e Operações também nunca entram nesse fallback.
8. Cada tarefa pode possuir uma única cadeia editorial ativa. Uma revisão mantém a tarefa da origem e só pode partir da revisão ativa atual.
9. Mudanças de etapa são sincronizadas nos dois sentidos:

| Kanban | Editorial |
|---|---|
| `backlog` ou `todo` | `draft` |
| `doing` | `production` |
| `review` ou `approved` | `ready` |

| Editorial | Kanban |
|---|---|
| `draft` | `backlog` |
| `production` | `doing` |
| `ready`, ainda não totalmente publicado | `review` |
| `ready`, com ao menos uma publicação válida e todas publicadas | `done` |

## Guardrails

- O Kanban nunca agenda nem publica em rede social.
- O double-gate e os arquivos imutáveis continuam sendo a fonte da autorização de publicação.
- Uma tarefa ligada não pode ir para `done` antes da publicação integral.
- Publicações agendadas, publicadas ou com falha não podem voltar de etapa por um movimento no Kanban.
- Tarefas com `source` iniciado por `client_request:` não entram no filtro Design, não podem ser ligadas ao editorial e preservam o fluxo próprio de Pedidos.
- Conteúdos cancelados ou arquivados deixam de reservar a tarefa na bandeja.
- A revisão atual é o terminal da cadeia `revision_of_post_id`, sem depender da ordem dos UUIDs.
- As mutações públicas e os writes diretos de status adquirem o mesmo lock transacional antes de bloquear linhas. Isso serializa o trecho crítico e evita raízes duplicadas e deadlocks entre tarefa, conteúdo e publicação.
- A migration para com diagnóstico se encontrar uma cadeia sem estado interno de origem, uma revisão ligada a outra tarefa ou mais de uma cadeia ativa para a mesma tarefa.

## Consequências

- Cliente, projeto, busca, responsável e etapa são filtros compartilhados entre conteúdos e tarefas.
- O Kanban central também pode filtrar por tipo de entrega e mostra o tipo explícito em cada card.
- Selecionar um tipo de entrega sugere a área correspondente, mas `workstream` e `delivery_type` permanecem campos distintos.
- Tarefas criativas sem conteúdo aparecem diretamente nas colunas editoriais, sem uma faixa paralela comprimindo o quadro.
- Alterar uma etapa no Kanban atualiza o conteúdo ativo; alterar o conteúdo atualiza o Kanban.
- O lock transacional é global para este sincronizador. As mutações críticas são curtas, mas mudanças simultâneas de etapa serão processadas em sequência.
- A aplicação da migration reconcilia uma vez os vínculos ativos já existentes.
- A migration de `workstream` deve ser aplicada antes da publicação do frontend que consulta essa coluna.
- Em rollback operacional, os triggers de sincronização podem ser removidos sem apagar tarefas, conteúdos ou histórico. A coluna `workstream` pode permanecer de forma compatível com a versão anterior.

## Referências

- `supabase/migrations/20260728234519_add_task_workstreams.sql`
- `supabase/migrations/20260728235000_sync_editorial_tasks_bidirectionally.sql`
- `supabase/migrations/20260729144624_add_task_delivery_type.sql`
- `src/lib/taskWorkstreams.ts`
- `src/lib/taskWorkstreams.test.ts`
- `src/lib/taskDeliveryTypes.ts`
- `src/lib/taskDeliveryTypes.test.ts`
- `src/hooks/useEditorialCalendar.ts`
