# Catálogo de Tools

Fonte de verdade: `GET https://gicbrgagstyvbaaumprj.supabase.co/functions/v1/mcp-server`
(campo `tools`). Este catálogo é um snapshot legível.

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
