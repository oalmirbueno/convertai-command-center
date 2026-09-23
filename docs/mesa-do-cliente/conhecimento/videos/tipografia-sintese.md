# Síntese de tipografia para o diretor de arte (cards 4:5, 1080x1350)

Base: quatro aulas de "Tipografia à vida" (Cursos Thiago) resumidas em `tipografia-01` a `tipografia-04`, mais regras de tela de celular convertidas para o canvas do Instagram. Onde o número não veio da aula, está marcado como regra de trabalho.

Contexto do sistema: o gerador de imagem desenha a lâmina inteira, texto incluído, e recebe amostras PNG das fontes do cliente (`cliente_fontes`, papéis `titulo`, `texto`, `destaque`). Portanto a tipografia precisa ser descrita em palavras e ancorada na amostra anexada.

---

## 1. Classificação das fontes e personalidade

| Classe | Como reconhecer | Personalidade | Onde usar no card | Onde não usar |
|---|---|---|---|---|
| Sem serifa geométrica (Montserrat, Poppins, Gotham) | círculos perfeitos, formas construídas | moderna, direta, confiável, "digital" | título e texto; padrão de conversão | quando o tom pede tradição |
| Sem serifa humanista/neutra (Inter, Lato, Roboto, Open Sans) | traço com leve variação, aberta | clara, acessível, neutra | texto de apoio, dados | título que precisa de personalidade forte |
| Sem serifa condensada (Bebas Neue, Anton, Oswald) | alta e estreita, muitas vezes só caixa alta | impacto, energia, esporte, outdoor | título curto e grande, número | texto corrido |
| Serifada clássica (Garamond, Merriweather, Lora) | serifas finas, leitura longa | tradição, seriedade, credibilidade | título sóbrio, citação | texto pequeno em fundo com ruído |
| Serifada de alto contraste / display (Playfair Display, DM Serif, Coachella) | contraste forte entre traço grosso e fino | elegância, luxo, editorial, moda | título grande | abaixo de uns 60 px (traços finos somem) |
| Slab serif (Roboto Slab, Arvo, Arctic) | serifa grossa e quadrada | robusta, industrial, confiável, "mão na massa" | título, selo | contexto delicado ou de luxo |
| Script caligráfica (Dancing Script, Allagia) | cursiva fluida e regular | delicada, afetiva, feminina, convite | uma palavra ou frase curta de destaque | parágrafo |
| Brush (Billy Ohio, FontBlade) | textura de pincel, irregular | artesanal, jovem, energia, "feito à mão" | uma palavra de impacto | qualquer texto com mais de 4 palavras |
| Handwritten / manuscrita (Alfrida) | letra desenhada à mão, variações | pessoal, autêntica, assinatura | assinatura, nota, palavra solta | informação importante |
| Comic (Amatic, fontes de quadrinho) | informal, "desenhada" | divertida, leve, descontraída | açaí, doces, infantil, humor | comunicado sério, saúde, jurídico, finanças |
| Display decorativa (Maqueen, góticas, 3D) | desenho muito peculiar | temática, chamativa | uma palavra de título, datas temáticas | texto de apoio, marca sóbria em excesso |

Regras que vieram das aulas:
- Serifa no digital deve ser escolha consciente: passa seriedade e tradição (advocacia, empresa antiga) ou, em título, ar moderno e ousado.
- Script e brush são para destaque curto. Brush em texto longo "mata" a leitura. A caligráfica aguenta um pouco mais.
- Comic tira a seriedade: ótima para marca leve, desastrosa em conteúdo sério.
- Display em uma palavra dentro de um layout sóbrio cria destaque sem bagunça.

## 2. Pareamento (título x texto)

Regras de ouro (aula 03):
1. Prefira uma família com vários pesos. Em design de conversão, uma família basta: texto em Regular, destaque em Black.
2. Máximo de três famílias por peça; no card, o normal é **uma ou duas** (+ uma script só para uma palavra, se o tom pedir).
3. Se usar duas, que sejam de classes diferentes (serifada + sem serifa, condensada + neutra). Duas sem serifa parecidas parecem erro.
4. Nunca esticar, achatar, criar negrito ou itálico falso.

Pares prontos (regra de trabalho, conferir contra a biblioteca do cliente):

| Título | Texto | Efeito | Nichos |
|---|---|---|---|
| Sans geométrica Black (Montserrat Black, Poppins ExtraBold) | mesma família Regular/Medium | direto, conversão, unidade | cursos, serviços, tech, varejo |
| Serifada alto contraste (Playfair Display, DM Serif Display) | sans humanista (Inter, Lato) | editorial, elegante | moda, estética, arquitetura, gastronomia premium |
| Serifada clássica (Merriweather, Lora) | sans neutra (Source Sans, Roboto) | sério, confiável | advocacia, contabilidade, consultoria, saúde tradicional |
| Condensada caixa alta (Bebas Neue, Anton) | sans neutra (Montserrat, Roboto) | impacto, energia | academia, esporte, automotivo, eventos, promoção |
| Slab (Roboto Slab, Arvo) | sans neutra | robusto, prático | construção, indústria, oficina, educação técnica |
| Script ou brush (uma palavra) | sans bold (Montserrat Bold, Poppins) | leve, afetivo, artesanal | açaí, sorveteria, confeitaria, beleza, datas comemorativas |
| Sans arredondada (Nunito, Quicksand, Baloo) | mesma família | acolhedor, amigável | infantil, pet, odontopediatria, saúde acolhedora |

## 3. Escala tipográfica no canvas 1080x1350

O post no feed aparece com cerca de 375 a 430 px de largura de tela. Um pixel do canvas vira mais ou menos 0,35 a 0,4 px de tela. Por isso o texto precisa ser bem maior do que parece no computador (aula 03, dica 10: se precisar de zoom, ninguém lê).

### Tamanhos (altura da fonte em px no canvas)

| Nível | Tamanho recomendado | Mínimo absoluto | Observação |
|---|---|---|---|
| Número ou estatística herói | 180 a 320 | 140 | um por lâmina |
| Título de capa (gancho) | 96 a 150 | 80 | 2 a 4 linhas |
| Título de lâmina interna | 72 a 110 | 64 | até 3 linhas |
| Subtítulo / frase de apoio | 48 a 64 | 44 | |
| Texto corrido | 40 a 48 | 36 | nunca em peso Light/Thin abaixo de 60 |
| Botão / CTA | 44 a 56, negrito | 40 | |
| Rodapé: @, fonte do dado, "arrasta", numeração | 28 a 34 | 28 | nada abaixo de 28 px |

- Proporção entre níveis: use uma escala de cerca de 1,33 a 1,5 entre degraus (ex.: 42, 56, 75, 100, 133). O título deve ter pelo menos 2 vezes o tamanho do texto de apoio, senão a hierarquia some.
- Pesos finos (Thin, Light) e serifas de alto contraste só acima de 60 px.
- Se o gerador trabalhar em 1024x1536 e o card for recortado para 4:5, multiplique os tamanhos por 0,95 e mantenha todo texto dentro da faixa central de 1280 px de altura (o recorte come cerca de 128 px em cima e embaixo).

### Entrelinha (line-height)
- Títulos: 1,0 a 1,15 do tamanho da fonte (condensadas em caixa alta aguentam 0,95 a 1,05).
- Texto corrido: 1,3 a 1,5 (ex.: fonte de 42 px com entrelinha de 55 a 63 px).
- Português tem acento, til e cedilha: nunca entrelinha tão apertada que o acento de uma linha encoste na descendente da outra (aula 01).
- Espaço entre blocos (título para texto): pelo menos 1 linha de texto de apoio, cerca de 40 a 64 px.

### Tracking (espaçamento entre letras)
- Texto corrido: 0 (padrão da fonte).
- Títulos grandes em caixa baixa: levemente fechado, de -1% a -3%.
- Títulos em caixa alta: levemente aberto, de +2% a +5%.
- Rótulos pequenos em caixa alta (categoria, "arrasta para o lado"): aberto, de +8% a +15%.
- Kerning apertado demais junta letras e mata a legibilidade (aula 02).

### Comprimento de linha e quantidade de texto
- Texto corrido: 25 a 40 caracteres por linha no card (máximo 45).
- Título: 10 a 20 caracteres por linha, linhas de comprimento parecido.
- Capa: até 10 palavras. Lâmina interna: até 35 palavras no total. Para gerador de imagem, quanto menos texto, menos erro de ortografia: mire 25 palavras por lâmina.
- Margem lateral de 80 a 100 px (mínimo 64); topo e base de 96 a 120 px. A grade do perfil pode mostrar a miniatura recortada nas laterais: nada essencial colado na borda.

## 4. Hierarquia
- Defina a hierarquia antes de desenhar (aula 02). No máximo três níveis por lâmina: gancho, apoio, detalhe.
- O olho ocidental lê em Z, da esquerda para a direita e de cima para baixo. O gancho vai no topo ou no terço superior; o CTA no fim do percurso.
- A primeira parte do texto recebe mais atenção: comece o título pela palavra que importa.
- Ferramentas de contraste: tamanho, peso, cor, família, caixa alta, fundo atrás de uma palavra. Use uma ou duas, não todas.
- Quando tudo é destaque, nada é destaque (aula 03): um destaque por lâmina.
- Modelo "MÉDULA": nome grande e colorido, o que é em tamanho médio, data e local pequenos. O resto é para quem já foi fisgado.

## 5. Legibilidade e leiturabilidade
- Alinhamento: à esquerda para texto; centralizado para títulos curtos e capa; à direita só por motivo de composição; justificado nunca.
- Hifenização: nunca em rede social.
- Trapos: linhas com comprimento parecido; não deixar palavra curta ou letra sozinha pendurada; quebrar "e", "de", "a", "o" para a linha de baixo.
- Viúvas e órfãos: última linha com uma palavra só é erro; reescreva ou reequilibre as quebras.
- Contraste de cor mínimo: ver `cor-sintese.md` (texto de apoio 4,5:1, título grande 3:1).
- Texto sobre foto: sempre com área calma, faixa sólida, gradiente ou escurecimento da foto atrás do texto.
- Caixa alta só em títulos curtos e rótulos; texto corrido em caixa alta cansa.
- Itálico e script em mais de uma frase reduzem a leitura.

## 6. Como escolher a fonte pelo nicho e pela marca

Ordem de decisão:
1. **Kit do cliente primeiro.** Se a marca tem fontes com papel definido, use-as. Nunca trocar a fonte da marca por gosto.
2. **Tom do conteúdo** (aula 03, dica 6): o mesmo cliente pode usar a script de destaque num post de Dia das Mães e só a sans num post de preço.
3. **Público** (dica 9): jovem, sênior, B2B, feminino, masculino, técnico.
4. **Eixos de personalidade da marca** para quando o kit estiver incompleto:
   - tradicional ↔ moderna: serifada clássica ↔ sans geométrica
   - séria ↔ divertida: serifada ou sans neutra ↔ arredondada, comic, script
   - luxo ↔ popular: serifada de alto contraste com muito espaço ↔ sans pesada, condensada, grande
   - técnica ↔ humana: sans neutra, mono ↔ humanista, manuscrita
   - calma ↔ energia: pesos leves e muito respiro ↔ Black, condensada, caixa alta

Tabela de partida por nicho (regra de trabalho):

| Nicho | Título | Texto | Destaque |
|---|---|---|---|
| Advocacia, contabilidade, consultoria | serifada clássica ou alto contraste | sans neutra | nenhum script |
| Clínica médica, odontologia | sans humanista ou arredondada | sans neutra | peso Bold, nunca comic |
| Estética, beleza, salão | serifada alto contraste | sans leve | script caligráfica em 1 palavra |
| Moda | serifada display ou sans muito fina e grande | sans neutra | caixa alta espaçada |
| Açaí, sorveteria, doces, confeitaria | sans arredondada ou bold | sans | brush ou comic em 1 palavra |
| Restaurante, hamburgueria | condensada ou slab | sans | brush para "novo", "hoje" |
| Academia, esporte, suplemento | condensada caixa alta, itálica leve | sans | número gigante |
| Imobiliária, arquitetura | serifada elegante ou sans geométrica leve | sans | muito espaço em branco |
| Tecnologia, SaaS, agência | sans geométrica | sans neutra | mono para dado |
| Cursos, infoproduto, mentoria | sans geométrica Black | mesma família | cor de acento no destaque |
| Infantil, pet | sans arredondada | arredondada | comic com moderação |
| Automotivo, oficina | condensada ou slab | sans | caixa alta |

## 7. Como descrever tipografia no prompt do gerador

Princípios:
- Coloque o texto exato entre aspas e com as quebras de linha já decididas (use " / " ou nova linha). O gerador não deve escolher as quebras.
- Descreva: classe, peso, largura, caixa, tracking, alinhamento, posição, tamanho relativo, cor em hex.
- Ancore na amostra: "igual à amostra anexada 'Montserrat Black'". O gerador pode não conhecer o nome da fonte.
- Proíba o que costuma dar errado: letras distorcidas, texto extra, hifenização, justificado, acentos trocados.
- Diga que os acentos do português precisam sair exatamente como escritos.
- Uma instrução de tipografia por nível (título, apoio, detalhe).

Vocabulário (português → inglês para o prompt):
- sem serifa geométrica → geometric sans-serif
- sem serifa humanista → humanist sans-serif
- condensada → condensed / compressed
- serifada de alto contraste → high-contrast serif, didone style
- serifa grossa → slab serif
- caligráfica → calligraphic script
- pincel → brush script, hand-painted lettering
- manuscrita → handwritten
- arredondada → rounded sans-serif
- peso: fino, regular, negrito, preto → thin, regular, bold, black / heavy
- caixa alta, caixa baixa → all caps / uppercase, lowercase, sentence case
- espaçamento entre letras aberto / fechado → wide / tight letter-spacing (tracking)
- entrelinha → line spacing / leading / line-height
- alinhado à esquerda, centralizado → left-aligned, centered
- margens seguras → generous safe margins

Modelo em português (para a direção da lâmina):
> Título "COMO ECONOMIZAR / NO SEU IR" em sem serifa geométrica peso Black, caixa alta, igual à amostra "Montserrat Black", branco #FFFFFF, alinhado à esquerda no terço superior, ocupando cerca de 80% da largura útil, entrelinha justa (1,05), tracking levemente aberto. Abaixo, com respiro de uma linha, o texto "3 deduções que quase / ninguém usa" em Montserrat Regular, cerca de um terço da altura do título, alinhado à esquerda, entrelinha 1,4. Sem hifenização, sem texto justificado, sem outro texto além do indicado. Acentos em português exatamente como escritos.

Modelo em inglês (para o prompt do gerador):
> Headline text, exactly: "COMO ECONOMIZAR / NO SEU IR". Typeset in a heavy geometric sans-serif, black weight, all caps, matching the attached font sample "Montserrat Black"; white #FFFFFF; left-aligned in the upper third; spans about 80% of the safe width; tight leading (1.05); slightly open letter-spacing. Below it, with one line of breathing room, the supporting text, exactly: "3 deduções que quase / ninguém usa", in Montserrat Regular, about one third of the headline height, left-aligned, 1.4 line spacing. Crisp, perfectly legible, correctly spelled Brazilian Portuguese with all accents (ç, ã, õ, é) preserved exactly. Letters keep their true proportions: no stretching, no warping, no fake bold. No hyphenation, no justified text, balanced line lengths, no extra words, no lorem ipsum, no watermark.

Frases curtas úteis:
- "Only the text in quotes appears in the image." / "Somente o texto entre aspas aparece na imagem."
- "One highlighted word in orange #F28C28, same font, same size." / "Uma palavra destacada em laranja #F28C28, mesma fonte, mesmo tamanho."
- "Script font used only for the word 'mãe'." / "Fonte script só na palavra 'mãe'."
- "Text sits on a calm, uncluttered area with strong contrast." / "O texto fica sobre área limpa e com contraste forte."
- "All text inside a 90 px safe margin." / "Todo texto dentro de margem segura de 90 px."

---

## Checklist de revisão tipográfica (sim/não)

Responda sim ou não. Qualquer "não" volta para ajuste.

1. A lâmina usa no máximo duas famílias (mais uma script em uma palavra, se houver)?
2. As fontes usadas estão na biblioteca do cliente ou foram aprovadas para ele?
3. A classe da fonte combina com o tom do conteúdo e com o nicho?
4. Existe um único gancho claramente maior e mais pesado que o resto?
5. O título tem pelo menos 2 vezes o tamanho do texto de apoio?
6. Todo texto corrido tem pelo menos 36 px no canvas 1080x1350 (ideal 40 a 48)?
7. Nenhum texto (nem rodapé ou @) está abaixo de 28 px?
8. Pesos Light/Thin e serifas finas só aparecem acima de 60 px?
9. A entrelinha do texto está entre 1,3 e 1,5, e a do título entre 1,0 e 1,15, sem acento encostando na linha de cima?
10. As linhas de texto têm entre 25 e 40 caracteres?
11. O texto de apoio está alinhado à esquerda (ou o título curto centralizado), sem justificado?
12. Não há hifenização?
13. Não há viúva, órfão, palavra curta ou letra sozinha pendurada no fim da linha?
14. Os trapos têm linhas de comprimento parecido?
15. Há no máximo um destaque por lâmina?
16. Script, brush ou comic aparecem em no máximo 4 palavras?
17. As letras mantêm as proporções originais (sem esticar, achatar ou negrito falso)?
18. Todo texto está dentro da margem segura (80 a 100 px laterais, 96 a 120 px topo e base)?
19. O texto gerado bate letra por letra com o texto exato, com todos os acentos do português?
20. Olhando a lâmina a um terço do tamanho, dá para ler tudo sem zoom?
21. Nas lâminas de um mesmo carrossel, fontes, tamanhos e posições dos níveis se repetem com consistência?
