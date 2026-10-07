# Central de Performance em Execução

Solicitação: leitura clara da carteira Meta, propostas específicas e revisão documental separada da execução. Reutiliza tabelas, agentes e rotinas existentes. Não altera campanhas, verba, prazo, responsáveis ou agendamentos.

## Correção de banco

Plano incremental: substituir somente o corpo de `operator_report_event`, preservando assinatura, permissões e contratos. `detail.work_kind=documental` e o namespace legado `meta-snapshot-review-` preservam o estado da tarefa/vínculo, não registram entrega ao cliente e não disparam aviso rotineiro. Falhas, bloqueios e necessidade de resposta continuam notificáveis. Replay do mesmo evento/ação/evidência não repete aviso.

Preflight: comparar a definição publicada à definição auditada antes de aplicar. Não há mudança de tabela ou dados históricos. Validar função em transação com rollback usando um relato documental realista; conferir tarefa, responsável, vínculo, memória e notificações. Rollback lógico: `docs/execucao-performance-rollback.sql`. A correção implementa o pedido explícito de impedir que revisão documental altere a tarefa.

## Leitura

Tabela deriva das campanhas e dias existentes sob RLS. Paginação estável evita totais truncados. Não soma métricas de contas/clientes diferentes. Status ACTIVE é separado da entrega no último dia disponível. Coleta acima de 36 horas ou dia acima de 72 horas implica entrega não confirmada. Fonte declarada como espelho do painel; timestamps não certificam consulta primária Meta. Orçamento cadastrado não é autorização.

Decisões usam o RPC existente e a versão imutável. Histórico conecta entregas pela aprovação, sem atribuir variação geral da carteira a uma otimização. Medição causal ausente aparece como ausente. Documentos têm visualização e original recolhido.

## Hermes

A ponte existente recebe uma projeção legível do relatório Markdown já produzido. Exige caminho dentro do workflow e hash correspondente à evidência registrada. Não faz nova coleta nem IA; não cria cron. Relatórios acima de 32 mil caracteres requerem arquivo completo em vez de truncamento silencioso. Retentativas usam a mesma chave.

## Verificação e limites

Testes de estado/entrega/frescor/isolamento/prazos/atividade, leitura de evidência e compatibilidade MCP. Testar a interface publicada com dados reais sem aprovar propostas nem alterar Meta. A visualização não corrige retroativamente divergências nas campanhas: registra a necessidade de decisão.

Validação executada: 18 testes Vitest; 10 testes de ponte em arquivo na VPS; tipos app e Node; Deno no catálogo MCP; compatibilidade Lovable; dois testes transacionais de banco com rollback (preservação de tarefa/responsável/vínculo e deduplicação). Oito relatórios existentes importados e relidos no banco com conteúdo de 7.455 a 21.237 caracteres, todos documentais. Um teste antigo de lease do diário está desatualizado e fora deste lote; os testes específicos da ponte passaram.
