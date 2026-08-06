# Catálogo de Tools

Fonte de verdade: `tools/list` no endpoint
`https://gicbrgagstyvbaaumprj.supabase.co/functions/v1/mcp-server`.
Com Bearer, o servidor devolve somente as tools permitidas para a credencial.
Este catálogo é um snapshot legível da superfície administrativa.

O catálogo abaixo descreve a superfície completa para admin. No endpoint
legado, manager, design, traffic e chaves sem escopo `admin` veem somente as
tools já protegidas por cliente: clientes, projetos, tarefas, calendário
editorial e as escritas operacionais correspondentes. As tools `memory_*`
também permanecem disponíveis por não usarem tabelas de cliente. As demais
ficam ocultas e falham fechadas até receberem o mesmo recorte por
`team_client_assignments`.

## Sem escopo (públicas)
| Tool | Descrição |
| --- | --- |
| `aceleriq_health` | Ping do servidor. |
| `aceleriq_capabilities` | Tools + escopos disponíveis para a chave. |

## `aceleriq:read`
| Tool | Uso |
| --- | --- |
| `aceleriq_search` | Busca textual em clientes/projetos/tarefas/relatórios/workspace. |
| `aceleriq_fetch` | Fetch pontual por `{ type, id }`. |
| `aceleriq_list_clients` | Lista de clientes reais. |
| `aceleriq_get_client_context` | Dossiê consolidado do cliente. |
| `aceleriq_list_projects` | Filtros por cliente/status. |
| `aceleriq_get_project` | Marcos + tarefas + arquivos + relatórios. |
| `aceleriq_list_tasks` | Filtros por projeto/cliente/status/assignee. |
| `aceleriq_list_editorial_calendar` | Calendário deduplicado por cliente, projeto, período, formato e status; inclui posts standalone, planos, contas e carrossel seguro. |
| `aceleriq_list_reports` | Metadados de relatórios. |
| `aceleriq_get_report` | Métricas, highlights, próximos passos. |
| `aceleriq_list_briefings` | Briefings existentes. |
| `aceleriq_get_briefing` | Respostas do cliente. |
| `aceleriq_list_workspace_nodes` | Nós do workspace (pastas/arquivos/vídeos). |
| `aceleriq_get_workspace_node` | Metadados de um nó. |
| `aceleriq_list_files` | Arquivos de entrega/aprovação. |

## `aceleriq:write`
| Tool | Regras rígidas |
| --- | --- |
| `aceleriq_create_task` | Allowlist de campos; `source='mcp'` forçado; idempotente. |
| `aceleriq_create_editorial_item` | Cria tarefa publicável com cliente, projeto, formato e data; prefixo de origem `mcp:editorial:`; nunca aprova, agenda ou publica. |
| `aceleriq_update_task` | Nunca troca `project_id`, `source`, `created_at`, propriedade. |
| `aceleriq_complete_task` | Recusa se já `done`. |
| `aceleriq_create_report_draft` | `status='draft'`; `client_id` derivado; sem publicação/envio. |

## `memory:read`
| Tool | Uso |
| --- | --- |
| `memory_get_context` | Pilha canônica (`AGENTS_MEMORY_BRIDGE` → `agent-context` → `MEMORY.md` → `now.md`). |
| `memory_search` | GitHub Code Search restrito ao repo. |
| `memory_fetch` | Leitura por path relativo (com bloqueio de traversal). |
| `memory_list_pending_proposals` | Lista o inbox `memory/inbox/chatgpt/`. |

## `memory:propose`
| Tool | Regras |
| --- | --- |
| `memory_propose_update` | Grava **somente** em `memory/inbox/chatgpt/`; nome de arquivo gerado; nunca sobrescreve; commit isolado. |

## Tools deliberadamente ausentes
`create_client`, `update_client`, `delete_task`, `delete_project`, billing,
wallet, pagamentos, usuários, permissões, e-mails, publicação, aprovação
automática, envio para cliente. Nenhuma dessas será exposta por MCP.

## Argumentos editoriais

- `aceleriq_list_editorial_calendar` exige `client_id`; aceita `project_id`,
  `date_from`, `date_to`, `format`, `status`, `production_status`,
  `publication_status`, `include_unscheduled`, `limit` e `offset`.
- `delivery_type` é alias temporário de `format` na listagem. Valores
  conflitantes são rejeitados.
- `aceleriq_create_editorial_item` exige `client_id`, `project_id`, `title`,
  `format`, `due_date`, `idempotency_key` e ao menos `description` ou
  `context`.
- `aceleriq_list_tasks` usa `status` e `only_open`.
- Toda escrita idempotente usa `idempotency_key`.
