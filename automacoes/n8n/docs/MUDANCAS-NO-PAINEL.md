# Mudanças de painel necessárias (proposta, nada aplicado)

Levantadas contra o código em `f77d6bca` (MCP 2.9.0) e leitura somente em produção em 14/10/2026.
Cada item diz por que o workflow precisa dele e o que acontece até lá. O SQL de rascunho está em
`migrations/propostas-painel/` e **não foi testado contra o schema real**: é ponto de partida para o lote
do painel, com plano próprio, preflight e rollback (regra do AGENTS.md do repositório).

> **Atualização de 15/10/2026 (no ar, commit `20382ec6`, MCP 2.10.0):** os itens 3, 4 e 7 foram feitos no painel.
> - Item 3: `aceleriq_ritual_redigir` devolve o texto final do ritual com o escritor da Central, sem gravar nada
>   (`origem=automacao`, `confirmado_pelo_dono=false`). O ACQ-01 chama a ferramenta só quando há proposta nova de
>   ritual; sem resposta, fica o rascunho por regra e o motivo vai em `metrics.texto_final_pendente`.
> - Item 4: a seção automática "Avanços recentes" do dossiê tem teto de 12 mil caracteres (Mirante caiu de ~27 mil
>   para 12,7 mil nessa seção).
> - Item 7: tabela própria `aviso_publicacao` e as ferramentas `aceleriq_aviso_publicacao_fila|preparar|decidir|marcar_enviado`.
>   O ACQ-03 prepara o aviso pelo portal e a proposta local passa a `em_revisao` (ou `proposta` em dry-run).
> - Pendente: a chave "N8N Almir" tem só `aceleriq:read`; `aceleriq_ritual_redigir` exige `reports:write`
>   (`aceleriq:write` cobre). No piloto o texto do escritor volta `escopo` até a chave ganhar escrita.

| # | Mudança | Por quê | Até lá |
|---|---|---|---|
| 1 | Chave de máquina `mcp_live_*` para o n8n, criada por admin, com só `aceleriq:read` + as escritas do plano de ativação | Ferramentas de operador, revisão, Dia Prioritário e navegador exigem principal sem restrição; `*_por_agente` assume o admin da revisão | Credencial `ACQ MCP Aceleriq (máquina n8n)` vazia; workflows não rodam contra produção |
| 2 | Operador dedicado `n8n` em `internal_operators` | `central_review_fila/preparar/marcar_enviado` e `operator_report` pedem um slug ativo; usar `default` (Hermes) mistura autoria | Config usa `default` só para leitura no piloto |
| 3 | Proveniência automática na Central (agente-central) | `preparar` grava dossiê; `aplicar` atribui confirmações ao usuário autenticado. Automação precisa de rota própria que grave `origem=automacao`, `confirmado_pelo_dono=false` e não use JWT pessoal | ACQ-01 não chama agente-central; propõe seção "Leitura automática (NÃO confirmada)" via `upsert_current_dossier` com `metadata.origem=automacao` (só fora do dry-run) |
| 4 | Limite do dossiê | Mirante está com **57.361** caracteres (v134); o MCP aceita até 60.000. Qualquer seção nova estoura | ACQ-01 detecta e **bloqueia** a escrita (`dossie_excederia_60000_caracteres`), sem truncar |
| 5 | Claim/lease e estados de entrega em `central_review_dispatches` (`reivindicada`, `enviando`, `aceita`, `entregue`, `lida`, `envio_incerto`), `provider_message_id` e revalidação de validade/fonte/hash no `marcar_enviado` | Hoje o dispatch não tem lease e `marcar_enviado` não revalida validade nem fonte | Feito fora do painel, em `acq_n8n.saidas` (Postgres próprio, testado com concorrência real) |
| 6 | Destino técnico aprovado (tabela de destinos por cliente: canal, provedor, id técnico do grupo, quem aprovou, evidência) com tela | `destination.recipient` é o nome do grupo em texto livre; nome não identifica | `acq_n8n.destinos_aprovados`, vazio; sem destino aprovado o ACQ-02 bloqueia (`destino_desconhecido`) |
| 7 | Revisão de aviso de publicação (entidade além de relatório) em `/ciclo/revisao` | `central_review_prepare` só aceita `reports` em `draft`; não se deve inventar ritual para encaixar o aviso | ACQ-03 grava a proposta como `aguardando_extensao_revisao` em `acq_n8n.propostas` |
| 8 | Expiração formal de pedidos vencidos | Em 14/10 havia **10** pedidos `pendente` com `valid_until` vencido (1 da Mirante, de 12/10) | ACQ-01 e ACQ-05 apontam; não expiram nada |
| 9 | `hermes_status` / prontidão no MCP | Não existe no MCP 2.9.0; o operador `default` tem `last_run_at` de **29/08** | ACQ-05 abre incidente "prontidão do Hermes não confirmada" |
| 10 | Upload/vínculo do print do perfil à publicação | `browser_act capturar` não define onde o arquivo fica; falta ligar `screenshot_file_id` à `editorial_publications` | ACQ-03 guarda `screenshot_file_id` na proposta quando a captura existir |
| 11 | Registro das execuções do n8n em `/execucao` | Visibilidade dos runs | Usar `aceleriq_operator_report` com o operador `n8n` e `detail.page_url` (já suportado), liberado no plano de ativação |

## Como os resultados aparecem no painel (depois da ativação)

| Workflow | Onde aparece | Mecanismo existente |
|---|---|---|
| ACQ-01 | `/clientes` ou `/mesa` (dossiê, seção "Leitura automática"), `/relatorios` (rascunho do ritual), `/ciclo/revisao` (pedido preparado), `/execucao` (run) | `upsert_current_dossier`, `create_report_draft`, `central_review_preparar`, `operator_report` |
| ACQ-02 | `/ciclo/revisao` faixa "Enviados", sino `central_review_enviada`, `cycle_rituals` marcado | `central_review_marcar_enviado` (só depois do aceite do provedor) |
| ACQ-03 | `/ciclo/revisao`, seção "Avisos de post no ar" (pedido preparado), e `acq_n8n.propostas` | `aceleriq_aviso_publicacao_preparar` (MCP 2.10.0) |
| ACQ-04 | Dossiê/memória (proposta), conversa da Mesa (`aceleriq_agent_handoff`) | `upsert_project_memory`, `agent_handoff` |
| ACQ-05 | `/central` (Dia Prioritário), `/execucao` (incidentes), `/kanban` (ligado a tarefa existente) | `operator_report`; `dia_prioritario_registrar` só quando o contato aconteceu |
