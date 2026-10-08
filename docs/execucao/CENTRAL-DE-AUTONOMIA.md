# Central de Autonomia (/execucao?aba=central) — 08/10/2026

Evolução da Execução, sem painel novo. Primeira aba: **Central**.

## 1. Diagnóstico (inspeção do repositório e do banco)

| Frente | Onde está | O que serve à Central |
|---|---|---|
| /execucao | `src/pages/AdminExecucao.tsx` (abas `ABAS`, visões `VISOES`, `conteudoDaVisao`) | a Central entra como aba e visão `central`, sem filtros nem lateral |
| Kanban/tarefas | `tasks` (backlog, todo, doing, review, done; sem coluna "bloqueado") | estado da ENTREGA |
| Execuções | `operator_task_links` (vínculo), `operator_runs` (execução), `operator_audit_log` (trilha), `operator_participations` (diário), `operator_deliveries` | estado do TRABALHO do agente e prova |
| Aprovações | `operator_approvals` + `operator_approval_decidir` / `central_review_decide` (`src/lib/execucaoApresentacao.ts`) | Decisões do CEO reaproveitam `AprovacoesExplicadas` |
| MCP | `supabase/functions/mcp-server` → `_shared/aceleriq-operators-services.ts` (`operatorReport` → RPC `operator_report_event`; `completeTask` em `_shared/mcp-write-services.ts`) | origem dos relatos |
| Hermes | `integrations/hermes-operational/diary_consumer.py` (lê o diário pelo MCP a cada minuto) | canal seguro Gestor → Hermes |
| IA | `_shared/ia-motor.ts` (`modeloPadrao`, `chamarTexto` com cota, saldo, registro de uso), carteira da agência (padrão do `agente-cfo`) | redação do Gestor |
| Julgamento | `_shared/jev.ts` (TypeSafe) | conferência das frases e cliente com erro de grafia |
| Permissões | `has_role` / `is_staff`; rota `/execucao` é `StaffRoute` | Gestor só admin; indicadores e histórico para a equipe sob RLS |
| Calendário | `editorial_posts` / `editorial_publications` (permalink = prova de publicação) | publicado ≠ agendado |

## 2. O que foi construído

### A. Gestor Aceleriq (chat)
- Função `supabase/functions/gestor-aceleriq` (ações `perguntar`, `conversa`). Só admin (`has_role`), conferido antes de qualquer leitura.
- Recorte: cliente pelo nome exato (marca secundária como CME restringe ao projeto dela; nomes ambíguos voltam como pergunta; grafia errada: Jev Choice na lista real, limiar 0,85). Período pela frase, no fuso de São Paulo, com o período anterior.
- Ficha (`modulos/ficha.ts`): tarefas, execuções, diário com prova, publicações, entregas, aprovações; apelidos F1..Fn (o modelo nunca copia UUID). **O estado de cada fonte é decidido em código**: `feito_com_prova`, `concluido_sem_prova`, `execucao_feita_entrega_em_revisao`, `em_revisao`, `em_andamento`, `bloqueado`, `aguardando_insumo`, `divergente`, `agendado`, `decisao_pendente`...
- Redação: modelo padrão do papel `estrategista` (configuração existente), carteira da agência, JSON com itens `{secao, texto, fontes[]}`.
- Barreira 1 (código, `conferirContraAFicha`): item sem fonte, com fonte inexistente ou em seção incompatível com o estado sai. "Feito" citando revisão/edição é recusado.
- Barreira 2 (Jev, `modulos/conferencia.ts`): Choice sustenta / contradiz / não diz por afirmação; só fica o que é sustentado.
- Sem IA (sem carteira, provedor fora, teto de 60 respostas/dia, falha na conferência): resposta montada só da ficha (`respostaDoMotor`).
- Conversa persistida em `gestor_mensagens` (migration `20261008010000`), leitura só do próprio admin.

### B. Hermes
Canal seguro existente, sem simulação: **Encaminhar ao Hermes** abre o diário do vínculo aberto mais recente da coordenação (`is_coordinator` ou `augusto`) com o pedido pronto, tipo "instrução", com o prefixo de cliente que o consumidor já interpreta (`contextoDoPedido`). Quem envia é o dono. O Hermes lê, delega aos agentes e relata pelo MCP (`operator_report`, diário, entregas) — e isso volta para a Central.

Contrato técnico: entrada `operator_participations` {author_kind=humano, entry_type=instrucao, body com "Cliente: X / Referência do cliente: UUID"}; resposta esperada do Hermes por `aceleriq_operator_diary` citando o entry_id e por `aceleriq_operator_report` com evidência. Sem vínculo aberto da coordenação a tela avisa e não finge envio.

### C. Indicadores (`src/lib/centralAutonomia.ts`)
Tarefas abertas por coluna; tarefas concluídas no período (última mudança no período); execuções no período, concluídas, em andamento, bloqueadas/aguardando; entregas em revisão (card em review); decisões pendentes; incidentes (falha, expirou sem sinal, divergência execução×card); agentes ativos. Cada um com o período anterior.

### D. Histórico e evidências
Cada execução do período: agente, tarefa, cliente, início/fim, eventos (`operator_audit_log`), provas do diário, **resultado verificado** (`resultadoVerificado`: concluída com prova só com tarefa done + prova; execução concluída com tarefa em revisão aparece como "entrega em revisão"), bloqueio, próximo passo e divergência.

### E. Decisões do CEO
`AprovacoesExplicadas` (mesmo mecanismo auditado, `central_review_decide` / `operator_approval_decidir`).

## 3. Divergência do operator_report

Causa (função viva no banco, igual a `20260901010000_agente_termina_e_o_kanban_anda.sql:88-110`): `operator_status_do_card` move o card só em `started` (→ doing), `review` e `done` (→ review). Para `blocked`, `failed` e `awaiting_input` devolve `null`; `operator_expire_stale_runs` bloqueia o vínculo sem olhar o card. Resultado: execução e vínculo bloqueados com o card em doing.

`done` fechando execução e vínculo com a tarefa em review é o desenho ("até a revisão, nunca além"); concluir é humano (`complete_task`). Não é bug; a Central mostra como "Execução concluída · entrega em revisão".

Casos no banco em 08/10: `1980d0bb` (vínculo bloqueado, card doing), `15e6c02f` (expirou sem sinal, card todo — consistente), `3218120b` (vínculo done desde 29/08, card doing — anterior à regra do card).

Proposta (NÃO aplicada): `docs/execucao/proposta-operator-report-card-parado.sql` — parada com card em doing volta a todo, no relato e na expiração, com trilha e sem derrubar o evento. Validada em transação desfeita no banco real: mapa `blocked/failed/awaiting_input + doing → todo`, demais inalterados; `started` todo→doing, `blocked` doing→todo, expiração doing→todo, trilha gravada; depois conferido que nada persistiu. Impacto: só eventos novos; `assigned_to` intocado; não conclui nada. Reconciliação dos casos antigos fica separada, caso a caso.

Observação menor (sem patch): em `20261007230100` a trilha de relato documental registra `new_status` mesmo sem mover o vínculo.

## 4. Limites
- O Gestor não executa ação: não move card, não aprova, não publica, não fala com cliente.
- "Concluídas no período" usa a última mudança da tarefa (o banco não guarda a data de conclusão).
- Até 80 fontes por resposta; o excedente é contado no aviso.
- Interpretação semântica depende do modelo e do Jev; frases sem fonte não entram, mas a seleção do que citar é do modelo.
