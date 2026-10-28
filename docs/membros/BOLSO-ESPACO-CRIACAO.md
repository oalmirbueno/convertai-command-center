# Área útil do estúdio Aceleriq de Bolso

Lote de 27/10/2026. Correção visual a partir de `b1c1a0f7`, sem mudanças no banco, APIs, modelos, consumo de créditos ou pagamentos.

## Problema e comportamento

O portal fixo acumulava topo, uma linha exclusiva para recolher o menu, título do estúdio, nome da campanha e etapas. Na tela de arte, o painel de controles ainda podia ocupar 44% da altura da janela. Abrir referências diminuía a prévia. Em larguras intermediárias, contexto e editor de texto também ficavam empilhados.

O estúdio agora tem topo de 64px e controle do menu junto da marca. Nome da campanha e etapas compartilham uma linha quando há espaço. Títulos longos ficam em até duas linhas, com nome completo disponível no atributo `title` e para leitores de tela.

Com pelo menos 760px de área útil, os controles de texto e arte ficam à esquerda e o resultado à direita. As colunas rolam independentemente, sem uma lista de referências reduzir a altura da imagem. Abaixo disso há uma única rolagem do trabalho, mantendo os resultados em altura natural. Em janelas com menos de 650px de altura, o conteúdo principal rola e os campos deixam de disputar uma altura fixa.

Marca, oferta, legenda e ajustes compartilham campos alinhados. A legenda começa com pelo menos 240px; as demais áreas de texto com 120px e redimensionamento vertical. No celular, a busca da biblioteca sai do topo durante a criação; o menu horizontal permanece disponível.

## Conferência da prévia

- `/membros?secao=estudio`, conta com acesso ao Bolso.
- Conferir biblioteca de campanhas e editar marca.
- Percorrer Objetivo, Produto, Oferta e Revisão na nova campanha.
- Abrir texto, editar conteúdo longo, copiar e salvar versão.
- Abrir arte, expandir fotos/referências e confirmar que a prévia continua ampla.
- Abrir confirmação de consumo, cancelar sem gerar; ampliar arte e fechar com Escape.
- Expandir e recolher menu; conferir também 1366×768, 1024×768, celular e janela baixa.
- Voltar à biblioteca: apresentação das outras seções permanece igual.

## Entrega e reversão

Preparado como draft PR para revisão humana, conforme `AGENTS.md`. Publicação é uma etapa posterior ao aceite; não considerar este documento como prova de implantação.

Reversão: reverter somente o commit deste lote e publicar novamente o frontend pelo fluxo normal. Não há SQL nem alteração de serviço a desfazer.
