# Canvas do Laboratório: leitura, execução e documentação

## Escopo

Continuação do Laboratório existente a partir de `cc53d61e`, sem reconstruir o painel ou a biblioteca de membros. Branch `codex/laboratorio-canvas-operacional`.

O pedido é trabalhar dentro dos nós: gerar conteúdos conectados, escolher modelos reais, visualizar páginas, corrigir uma peça preservando as outras e exportar a construção completa.

## Comportamento entregue

- Conexões com três intensidades, incluindo 10% de opacidade; filtro das conexões do nó selecionado ou ocultação visual. Nenhuma dessas opções desfaz ligações.
- Rotas com cantos suaves procuram faixas livres entre os cartões. Organização reserva espaço para cartões expandidos, com rolagem interna. A opção 100% recupera o tamanho de leitura.
- Modelos de texto e motores de imagem vêm do catálogo configurado. Nós determinísticos não fingem usar IA. O modo nativo de membros vincula um produto existente, com custo de IA zero.
- Montar e gerar encaminha os especialistas afetados para a confirmação do custo. Alterar fonte, preço ou ligação também inclui os resultados dependentes daquela frente. Outras frentes e etapas de publicação não entram automaticamente.
- Estimativa e execução de lote usam o mesmo plano. Ancestrais prontos podem ser reaproveitados; alterações de contexto, modelo, ligações ou cliente invalidam a autorização pendente correspondente.
- Dependências assíncronas continuam durante o acompanhamento do projeto, inclusive através de nós estáticos. A reserva original é reaproveitada. O menu permite cancelar apenas etapas reservadas que ainda esperam.
- Cancelamento e invalidação exigem confirmação da transição terminal antes do estorno. Falha de persistência não é apresentada como cancelamento concluído.
- Ajustar substitui apenas a imagem selecionada. A primeira variação ocupa aquele lugar; variantes adicionais ficam ao final, preservando índices e principal das vizinhas. A saída anterior permanece disponível mesmo ao reabrir durante a revisão ou depois de erro.
- CRM nativo consulta agência ou o cliente exato do projeto. Só leva resumos e etapas, sem copiar contatos pessoais. Biblioteca nativa mostra estrutura real e link para o produto existente. Ambas as consultas usam o JWT de quem chamou e os controles existentes de permissão.
- Prévia grande navega entre caminhos explícitos com HTML pronto do mesmo projeto, com voltar e seletor de páginas. Scripts e formulários da página ficam inativos no visor; compra ou cadastro não são simulados como operações reais.
- Exporta PDF verdadeiro, Word `.docx`, Markdown e JSON com contexto, configurações, modelos, nós, ligações, resultados disponíveis e pendências. Credenciais e links temporários são retirados. PDF carrega seu motor e a fonte só ao baixar.
- Agente externo acompanha a tarefa existente e só conclui com estado concluído e evidência. Não cria tarefa paralela para acompanhar.

## Verificação

- Backend: 143 testes Deno, `deno check` do entrypoint e diff check aprovados, incluindo Landing legada e Página v4 ligadas ao Checkout.
- Primeira rodada visual: 38 testes React aprovados, incluindo troca de contexto e descarte de resposta atrasada.
- PDF sintético de seis páginas verificado visualmente e por extração. Word conferido como OOXML; não houve renderização em LibreOffice.
- Navegador local com os componentes reais e respostas de demonstração: leitura das conexões, recolhimento, abertura no celular, navegação de página para checkout e obrigado e download de PDF pelo botão.
- Os testes antigos foram atualizados para os novos contratos, mantendo as verificações de conteúdo e ligações. A rodada final de interface, tipos e build deve constar com o resultado exato na descrição do PR.
- Sem geração paga ou gravação em dados reais nos testes deste lote.

## Limites e operação

- A continuação depende do acompanhamento do canvas aberto ou reaberto; não foi criado um novo trabalhador permanente em segundo plano.
- Se o processo cair depois de assumir uma geração, a recuperação não repete a chamada paga automaticamente. É necessária inspeção daquela execução.
- Duas solicitações iniciais simultâneas em abas diferentes ainda têm a corrida preexistente entre leitura e inserção. A trava CAS deste lote protege continuação e cancelamento; uma garantia completa na primeira entrada exige idempotência atômica no banco, em lote próprio.
- O visor é uma prévia de conteúdo e percurso. Não testa checkout real, disparo de mensagens, gravação de lead ou liberação de licença.
- A biblioteca nativa não cria produto nem concede acesso. Kiwify e Asaas não são ativados por este lote.
- Exportação contém as execuções disponíveis na tela; não promete recuperar revisões históricas não carregadas. Imagens e vídeos permanecem como referências de arquivos.
- Sem migração de schema. Novas ações compatíveis: `conexoes_da_casa` e `rodada_cancelar`. A estimativa antiga continua igual; planejamento completo de dependências usa `rodada: true`.

## Revisão e publicação

Revisar o draft PR, especialmente reserva/estorno, isolamento das consultas nativas e preservação de peças. Publicar frontend e função `laboratorio` do mesmo lote após aprovação. Testar um projeto descartável antes de usar um funil de cliente.

Rollback: reverter o commit do lote e republicar frontend e função correspondentes. Não há migração para desfazer. Projetos e arquivos gerados permanecem salvos.

Sem credenciais, dados de contato ou segredos neste documento.
