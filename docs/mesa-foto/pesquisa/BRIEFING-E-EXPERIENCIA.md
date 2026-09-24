# Briefing e composição da área

## Resultado desejado

Uma pessoa da equipe reúne fotos simples do cliente e sai com um conjunto organizado de imagens profissionais, consistente com o produto ou pessoa real e pronto para uso comercial. A mesa deve oferecer controle suficiente para um trabalho profissional sem exigir que o operador conheça modelos, samplers e treinamento.

## Composição da tela

**Barra superior:** cliente, kit selecionado, nome do ensaio, estado e custo estimado/consumido. O cliente ativo deve ser inequívoco durante toda a sessão.

**Coluna esquerda:** fontes do kit, miniaturas dos originais, papéis das referências e lacunas. Exemplo: produto, caixa, verso, rótulo, rosto, corpo, cenário e estilo. Mostrar quando falta evidência para a tomada pedida.

**Área central:** imagem atual com zoom, comparação antes/depois e máscara. No modo Ensaio, alternar para grade de tomadas com estado individual. Miniaturas não devem apagar a distinção entre original e imagem gerada.

**Coluna direita:** controles de finalidade, preservação, câmera, luz, cenário e formato. Começar por presets com edição avançada opcional. Campo de instrução serve para refinamento, não como única forma de uso.

**Faixa inferior:** versões, motivo de correção, aprovação e ações de uso nas mesas. Ações de geração mostram quantidade e estimativa antes de disparar.

No celular, transformar as colunas em painéis sequenciais. Confirmar requisitos de navegador do painel antes de usar canvas/WebGL ou bibliotecas recentes. O seletor de câmera pode começar com botões e presets, sem depender de um visor 3D.

## Jornada 1: mouse e embalagem

1. Selecionar cliente e subir fotos do mouse e da caixa.
2. O sistema sugere um kit; a equipe confirma modelo e variante.
3. Identificar fotos de detalhe e características protegidas, como logo e quantidade de botões.
4. Preparar recorte, fundo limpo e cor.
5. Selecionar pack de catálogo ou campanha; o sistema mostra as tomadas possíveis e lacunas.
6. Gerar opções a partir do kit, revisar bordas, texto e atributos físicos.
7. Aprovar versões e escolher quais serão usadas no anúncio.

Se só houver uma foto da caixa, o fluxo prepara a própria embalagem e sinaliza que o objeto ainda não foi documentado. Não completar automaticamente um mouse genérico e chamá-lo de produto real.

## Jornada 2: retrato profissional

1. Criar kit da pessoa com autorização e referências complementares.
2. Confirmar identidade e detalhes que não devem mudar.
3. Escolher retrato, meio corpo, cenário, roupa permitida e direção de luz.
4. Produzir opções e comparar com os originais, incluindo pele, idade aparente, óculos, mãos e cabelo.
5. Aprovar a identidade visual antes de usar uma foto gerada como referência adicional.

O objetivo é um ensaio da pessoa, mantendo suas características. Retoque de luz não deve virar alteração automática de anatomia ou rejuvenescimento.

## Jornada 3: alimento e delivery

1. Subir prato real, embalagem, porção e detalhes disponíveis.
2. Registrar ingredientes e montagem confirmados.
3. Selecionar vista compatível com a comida: superior, 45° ou lateral.
4. Preparar luz, fundo e composição sem aumentar porção nem inventar ingredientes.
5. Conferir se a imagem apresenta o que o cliente realmente entrega.

## Estados e mensagens

| Situação | Comportamento esperado |
| --- | --- |
| Kit vazio | Mostrar orientações de captura e seleção de fontes |
| Foto desfocada ou incompleta | Explicar o defeito e sugerir outra fonte |
| Identificação incerta | Pedir confirmação pontual do modelo/variante, mantendo o restante do trabalho |
| Parte não documentada | Informar a lacuna e limitar o compromisso da geração |
| Job na fila | Mostrar tomada, estado e possibilidade de continuar trabalhando |
| Falha do provedor | Manter fontes/configuração e oferecer nova tentativa com custo claro |
| Resultado divergente | Destacar revisão e permitir correção por área ou nova tomada |
| Versão aprovada | Travar a versão e criar derivada para ajustes posteriores |

## Critérios de uma experiência profissional

- O operador sabe o que vai mudar e o que precisa permanecer igual.
- A direção fotográfica é reutilizável por cliente, produto e categoria.
- Um resultado rejeitado alimenta correções específicas, sem modificar o original.
- Formatos de catálogo, feed, stories e banners derivam de uma tomada aprovada com reenquadramento consciente.
- A biblioteca pode atender diversas categorias sem obrigar todos os assuntos ao mesmo preset.
- A mesa entrega imagens-base; texto publicitário e layout continuam disponíveis no fluxo de artes/ads.
