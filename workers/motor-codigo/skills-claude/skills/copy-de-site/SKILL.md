---
name: copy-de-site
description: Estrutura de página que converte e copy de site em português do Brasil, na voz da marca do cliente. Use ao construir ou ajustar qualquer seção com texto (hero, problema, serviços, prova, FAQ, chamada), ao escrever microtexto (botão, rótulo, aviso, título de bloco) e quando o pacote não trouxer a copy de um bloco.
---

# Copy de site que converte (método da casa)

A copy das seções vem do pacote (`.aceleriq/pacote.json`, campo `copy`, escolhida pela equipe). Você NÃO reescreve essa copy: você a coloca no lugar certo da página. Esta skill vale para três casos:
1. decidir a ORDEM e o PAPEL de cada bloco da página;
2. escrever o microtexto que o pacote não traz (botão, rótulo de campo, aviso, legenda, título curto de bloco);
3. preencher um bloco sem copy, só com o que o pacote sustenta (senão o bloco sai e você diz em `DECIDI:`).

## A página que converte (papéis, nesta ordem)
| Papel | O que faz | Seções típicas |
|---|---|---|
| Gancho | para o visitante em 3 segundos com o resultado que ELE quer | hero |
| Dor | nomeia a dor do público nas palavras dele e vira para a solução | problema |
| Oferta | o que o cliente entrega e o resultado de cada item | serviços, processo, diferenciais, vitrine, preços |
| Prova | confiança só com dado real (ver skill prova-honesta) | depoimentos, números, portfólio, sobre, equipe |
| Objeções | responde quem hesita antes de agir | FAQ |
| Chamada | leva ao próximo passo do objetivo do site | chamada, contato |

O objetivo do site (no pedido da passada, "OBJETIVO DO SITE") diz qual é o próximo passo do visitante. Todo CTA da página aponta para ele, com o mesmo verbo.

## Regras de escrita
- Título: até 8 palavras, com o ganho ou a dor concreta. Nada de "Bem-vindo", "Soluções completas", "Qualidade e excelência".
- Subtítulo: 1 ou 2 frases. Quem é, o que faz, para quem, por que agora.
- CTA: verbo + ganho, até 5 palavras ("Marcar minha avaliação", "Pedir pelo WhatsApp"). Um CTA principal por dobra; o secundário é link discreto.
- Oferta: cada item com o resultado ("Instalação em 1 dia" só se o pacote disser 1 dia).
- FAQ: pergunta como o cliente pergunta; resposta em até 3 frases.
- Escaneável: blocos curtos, listas de 3 a 5 itens, números só reais.

## O guia e os ganchos da casa
O pacote traz `copy_da_casa`: `guia` (gancho, clareza, viralização, humanizer e verdade) e `ganchos` (fórmulas vencedoras do nicho). Use as FÓRMULAS para o microtexto e para um título que faltar; nunca copie a frase de exemplo e nunca troque só o nome do produto. Chave `{assim}` pede dado real: sem o dado, outra fórmula.

## Antes de dizer pronto
- Todo texto visível saiu do pacote ou é microtexto seu dentro destas regras.
- Rode a skill humanizar-texto no microtexto que você escreveu.
- Nada de texto copiado de referência ou de modelo pronto (ver a regra de AUTORIA do pedido).
