# MCP oficial e calendário editorial

O MCP oficial do Lovable usa o JWT da sessão OAuth em todas as consultas e mutações. O token é repassado ao Supabase, portanto as políticas RLS continuam sendo a autoridade para cliente, projeto e usuário.

## Descoberta paginada

`list_clients`, `list_projects` e `list_tasks` aceitam `limit` de até 500 e `offset`. As respostas incluem `meta.total`, `meta.returned`, `meta.has_more` e `meta.next_offset`. `list_tasks` também retorna o `client_id` derivado do projeto e aceita filtros de área, tipo de entrega, origem e apenas itens abertos.

## `list_editorial_calendar`

- exige `client_id` e aceita `project_id` do mesmo cliente;
- retorna apenas tipos publicáveis: arte estática, carrossel, reel, story, vídeo, short, artigo e post Google;
- aceita período, formato, status de produção e status de publicação;
- exclui tarefas concluídas, arquivadas, canceladas e solicitações de cliente;
- filtros de produção ou publicação retornam somente posts compatíveis;
- tarefas ligadas a um post editorial ativo não são repetidas como outro item;
- inclui conta social com campos públicos e arquivos completos do carrossel em ordem determinística;
- não retorna tokens, IDs externos do provedor, caminhos de Storage ou tabelas internas;
- pagina em ordem `calendar_at ASC NULLS LAST`, `updated_at DESC`, tipo e ID.

Quando `date_from` ou `date_to` é informado, o período usa `tasks.due_date` para pautas e `editorial_publications.scheduled_at` para posts. Um post ainda sem plano agendado não possui data de calendário e, por isso, não entra nesse recorte. Para localizar esses rascunhos, omita o período e use `production_status`.

## `create_editorial_item`

A ferramenta cria somente uma tarefa de produção no Kanban editorial. Ela exige cliente, projeto, título, briefing, `format` publicável, data e um UUID de idempotência. O projeto é conferido dentro do cliente, do recorte RLS e das atribuições editoriais. Área e origem são calculadas de forma determinística.

O UUID de idempotência também é o ID determinístico da tarefa. Uma assinatura imutável da requisição original fica na origem técnica da tarefa. Assim, repetir a mesma carga retorna o item atual mesmo depois de uma mudança legítima de status; reutilizar a chave com outra carga é rejeitado. `assigned_to`, quando informado, só pode ser o próprio usuário OAuth.

Essa ferramenta não cria post pronto, não aprova, não agenda e não publica. Essas transições permanecem nos gates humanos e no fluxo determinístico do painel.
