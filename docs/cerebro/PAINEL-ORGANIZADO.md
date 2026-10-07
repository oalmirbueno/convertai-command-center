# Segundo cérebro e prioridades no painel

07/10/2026. Complemento ao cérebro existente, sem nova tabela ou provedor de IA.

## Onde abrir

- Mesa → cliente → Contexto → Segundo cérebro.
- Dossiê de contexto na Central → Abrir memória e aprendizados.
- Prioridades → Contexto de cada cliente.

O dossiê atual vem da chave canônica (`contexto`, projeto nulo, `is_current`). O histórico não decide qual versão é atual. Títulos existentes viram seções recolhíveis; o texto original permanece inteiro. A memória usa `agente_memoria`, a mesma fonte dos agentes, com área, tipo, origem, evidência e validade.

Em uso indica registro ativo, não confirmação factual. A revisar reúne registros ativos vencidos e planos de meses anteriores. Histórico reúne os inativos e substituídos. Resultados e sinais usa a leitura compartilhada de campanhas, aprovações e métricas, carregada só ao abrir; uma fonte indisponível fica explícita. A interface não transforma resultados isolados em causalidade.

Registrar grava área e agente compatíveis, bloqueia duplicata normalizada ativa e verifica o retorno do banco. Arquivar e reativar conferem cliente, ID e estado esperado, preservam texto e validade, e recusam registros substituídos. Erro ou zero linhas não viram sucesso. O formulário oferece 7, 30, 90 dias e sem prazo. Nenhum segredo ou chave nova é necessário.

O cérebro geral é exibido na marca principal. Marcas secundárias continuam no contexto específico existente; este lote não funde os dossiês de projetos com o geral. Os registros são limitados aos 500 mais recentes, com aviso; o histórico de dossiês mostra as últimas 12 versões, além da consulta independente do atual.

## Próxima ação

A fila mantém as regras de urgência e o Feito/Desfazer existentes. Mostra uma ação principal por cliente, as demais ao expandir, busca sem acentos e atalho ao contexto. Após filtrar uma ação, reordena pelo que permanece visível. Empates consideram o prazo real e depois a espera de aprovação. A consulta atualiza a cada minuto enquanto a página está ativa e ao retornar à janela.

Contextos a conferir é separado da fila operacional: ausência de dossiê geral, data inválida ou mais de 90 dias sem revisão. Usa metadados de clientes visíveis, em lotes de até 100, respeitando a sessão/RLS; erro de leitura nunca é apresentado como ausência de dossiê. A idade sinaliza revisão, não informação incorreta.

## Validação e limites

Testes de isolamento, validade, histórico, preservação do texto, ordenação, busca/navegação, duplicação e escrita sem retorno. Regressões da fila, contexto e dossiê. Typecheck, build e compat MCP. Conferência visual em produção após publicação.

Este lote não altera automaticamente dossiês, calendários ou aprovações, não faz migração e não gera conteúdo pago. Revisar com o agente preenche o pedido no agente existente; o usuário ainda envia pela interface com o custo normal. A deduplicação semântica existente do servidor continua disponível aos agentes; o registro manual usa igualdade normalizada, sem chamada de modelo.

Rollback: reverter o PR ou voltar o Worker anterior. Como o esquema não mudou, os registros permanecem compatíveis com os agentes e com a tela antiga.
