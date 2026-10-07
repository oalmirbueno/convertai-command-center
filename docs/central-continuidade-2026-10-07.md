# Central: continuidade das respostas

O fluxo compartilhado de Atualizar todos passa a consultar decisões anteriores do agente (antes a memória do ritual consultava apenas kind=ritual). As confirmações recebem um bloco próprio no contexto para não desaparecerem atrás dos avanços automáticos. Perguntas passam a ser opcionais; perguntas idênticas já respondidas são filtradas e o modelo recebe as respostas, datas e instruções para resolver paráfrases e conflitos.

Ao aplicar, as respostas originais são gravadas e relidas antes da IA. O identificador inclui cliente, rodada e conteúdo; repetir um envio não duplica o diário. O dossiê é versionado pelo RPC existente e relido. Falha de persistência, conflito concorrente ou consolidação inválida interrompe a publicação. Nenhuma migração ou mudança de RLS.

A tela permite aplicar um cliente diretamente, com publicação opcional explícita. Edições invalidam o resultado antigo, preservando a retomada somente de etapas que continuam válidas. A fila continua com dois clientes simultâneos, iniciando o próximo quando libera uma vaga. Central e Mesas invalidam os caches do dossiê, contexto, memória e cérebro ao terminar.

Pesquisa externa é opcional na etapa de respostas, usando a capacidade real do motor existente. Uma reserva sem pesquisa não pode se apresentar como pesquisa realizada. A decisão da IA sobre utilidade e interpretação de respostas continua probabilística; não é garantia de ausência de erro. Este fluxo atualiza conhecimento e rituais, não executa alterações em campanhas externas.

## Verificação

- Testes de regras, persistência/releitura, deduplicação, fila, edição, aplicação individual, publicação bloqueada por erro e compatibilidade do modelo.
- Auditoria somente leitura confirmou 55 decisões históricas de agente-central, sem alterar seus conteúdos.
- Conferir no navegador: Atualizar todos → Responder; publicação explícita, pesquisa opcional e botão por cliente. Com zero perguntas, pode informar contexto livre ou aplicar a leitura disponível.
- Não executar uma carteira inteira como teste nem publicar mensagens artificiais nos portais.

## Retomada e rollback

Entradas novas usam project_memory e metadata.central_respostas do dossiê existente. Histórico e versões anteriores ficam preservados. Reverter o commit e republicar agente-central/frontend restaura o comportamento anterior sem remover dados. O parâmetro pesquisaWeb no modelo compartilhado é opcional; outros chamadores mantêm seu comportamento. Não refazer a área Execução nesta frente.
