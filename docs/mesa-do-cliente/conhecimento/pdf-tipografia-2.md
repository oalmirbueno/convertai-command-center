# Tipografia 2: anatomia das letras, classificação e linhas da fonte

- Arquivo de origem: `Design/arquivo_anexo_22565.pdf` (infográfico "Anatomia e terminologia tipográfica", 4 pranchas)
- Páginas lidas: 4 de 4
- Tema irmão: `pdf-tipografia-1.md` (termos gerais, espaçamentos, hierarquia, alinhamento, 13 dicas)
- Observação: no original, as seções 2.2 e 2.3 aparecem com o título "Entrelinha", mas o conteúdo é sobre **serifas** e sobre **eixo e modulação**. Aqui estão nomeadas pelo conteúdo real.
- Por que isso importa para o agente: o gerador de imagem não "escolhe fonte" por nome com precisão. Ele desenha letras a partir da descrição. Quem sabe descrever a anatomia (terminal, serifa, eixo, altura-x, abertura) consegue pedir o estilo certo e consegue revisar se a letra saiu correta.

---

## 1. Conceitos

### 1.1 Partes da letra (vocabulário para descrever e revisar)
| Termo (PT / EN) | O que é | Onde aparece no material |
|---|---|---|
| Ápice / apex | ponto onde dois traços se encontram em cima ou embaixo | topo do A, vértice do M e do V |
| Barra / cross bar, bar | traço horizontal que cruza ou liga hastes | A, e, f |
| Haste / stem | traço vertical principal | M, T |
| Braço / arm | traço horizontal ou diagonal livre numa ponta | T, Y |
| Barriga, bojo / bowl | traço curvo que fecha um espaço | b |
| Incisão / nick | pequeno entalhe onde a curva encontra a haste | base do b |
| Terminal | final de um traço sem serifa | f, a |
| Abertura / aperture | a abertura parcial de uma contraforma | e, u |
| Cauda (o material grafa "calda") / tail | traço descendente final | j, Q |
| Espaço interno, contraforma / counter | espaço vazio dentro da letra | Q, o |
| Junção / junction | ponto onde um traço encontra outro | T, a |
| Perna / leg | traço diagonal inferior | R, k |
| Espinha / spine | curva central do s | s |
| Espora / spur | pequena projeção num traço | a, l, h, u |
| Serifa / serif | traço de acabamento no fim das hastes | l, h |
| Ombro / shoulder | curva que sai da haste | h |
| Orelha / ear | pequeno traço no topo do g | g |
| Link | ligação entre os dois bojos do g de dois andares | g |
| Laço / loop | bojo inferior do g de dois andares | g |

- **Por que funciona na percepção:** reconhecemos letras pelas partes mais distintivas (aberturas, ascendentes, descendentes, contraformas). Letras com contraformas grandes e aberturas amplas continuam distinguíveis quando ficam pequenas ou borradas, que é exatamente a condição do feed no celular.

### 1.2 Terminais (final dos traços em a, c, f, j, r, s, y)
- **Bola ou botão (ball):** terminal arredondado e cheio, típico de didones como a Bodoni. Passa elegância clássica e moda.
- **Lágrima ou gota (teardrop):** terminal em forma de gota, típico de serifadas antigas como a Caslon. Passa tradição, editorial, literatura.
- **Bico ou afiado (beak):** terminal pontudo em cunha, típico de egípcias. Passa firmeza e personalidade.
- **Ausente:** o traço termina reto, sem acabamento, típico de geométricas como a Futura. Passa modernidade e limpeza.

### 1.3 Serifas (definição citada no material a partir de Bringhurst: traço acrescentado ao início ou fim dos traços principais)
- **Bilateral, adnata e reflexiva:** nasce junto ao traço de forma suave, para os dois lados, e retrocede sobre si mesma (exemplo: Caslon Bold). Clássica, literária.
- **Bilateral, abrupta, retangular ou egípcia:** encontra a haste de forma brusca, com espessura próxima à da haste (exemplo: Egyptian 710). É a família das slab serifs. Robusta, industrial, chamativa, ótima para headline forte.
- **Unilateral, adnata e transitiva:** só para um lado e acompanhando a direção da escrita (exemplo: Script C). Caligráfica, pessoal.

### 1.4 Eixo e modulação do traço
- **Traço modulado com eixo vertical (racionalista):** grossos e finos muito contrastados, com o eixo das partes finas na vertical (exemplo: Caslon Bold no material; didones levam isso ao extremo). Elegância, sofisticação, precisão.
- **Traço modulado com eixo oblíquo (humanista):** as partes finas seguem uma diagonal, como a escrita com pena (exemplo: Bastarda). Calor humano, tradição, mão.
- **Traço não modulado (eixo ausente ou vertical presumido):** espessura quase uniforme (exemplo: Humanst 521, e a maioria das sem serifa). Neutralidade, clareza, tela.
- **Por que funciona:** alto contraste de traço fica lindo grande e frágil pequeno; as partes finas "somem" no celular. Traço uniforme resiste melhor em tamanho pequeno e em fundo com imagem.

### 1.5 Corpo da fonte
- Retângulo que contém cada letra: altura fixa para toda a fonte, largura variável por letra (M largo, p e b estreitos, e o p ocupa a área abaixo da linha de base).
- **Consequência prática:** o tamanho em pontos ou pixels mede o corpo, não a letra visível. Duas fontes no mesmo tamanho podem parecer de tamanhos bem diferentes por causa da altura-x.

### 1.6 Entrelinha (três casos mostrados no material)
- **Positiva:** espaço entre linhas maior que o corpo; linhas separadas e arejadas.
- **De corpo (sólida):** entrelinha igual ao corpo; linhas encostando visualmente.
- **Negativa:** entrelinha menor que o corpo; as linhas se sobrepõem parcialmente (descendentes de uma linha invadindo a área das ascendentes da outra).

### 1.7 Kerning (no sentido do material)
- Quando parte de uma letra avança sobre o espaço de outra, invadindo o corpo vizinho, para que o par fique opticamente equilibrado. Exemplos do material: Yo, Ta, Wo, Ke, Pa.
- Não confundir com espaçamento geral, que é apenas a distância entre os corpos.
- **Por que funciona:** o olho avalia a área de branco entre letras, não a distância matemática. Letras com diagonais ou braços (T, V, W, Y, P, A) criam buracos que precisam ser compensados.

### 1.8 Linhas da fonte
1. **Linha da ascendente (topo):** até onde sobem as hastes de b, d, h, k, l; pode ou não coincidir com a altura da maiúscula.
2. **Linha da caixa alta (versal, cap height):** topo das maiúsculas.
3. **Altura-x (linha mediana):** topo das minúsculas sem ascendente (x, a, o, e).
4. **Linha de base (baseline):** onde as letras se apoiam.
5. **Linha da descendente (fundo):** até onde descem p, q, g, j, y.

- **Por que importa:** fontes com **altura-x grande** parecem maiores e são mais legíveis no mesmo tamanho. Em português, a linha de ascendente também recebe **acentos** em maiúsculas (Á, Ê, Ã, Ç tem cedilha na descendente), e isso muda como se pode apertar a entrelinha.

---

## 2. Como aplicar num card de Instagram 4:5 (1080x1350)

### 2.1 Escolha de fonte pela anatomia (legibilidade no celular)
- Para N2 e N3 (apoio e detalhes): prefira **altura-x grande** (minúsculas com pelo menos cerca de 50% da altura das maiúsculas), **aberturas amplas** (e, a, c, s bem abertos), **contraformas grandes** e **traço pouco modulado**. Isso garante leitura com 40 a 48px no card.
- Para N1 (headline): liberdade maior. Didone de alto contraste, slab, display ou condensada funcionam porque o tamanho é grande (96px ou mais). Mesmo assim, as partes finas de uma didone precisam ter pelo menos cerca de 4px de espessura no card para não sumirem; na prática, didone só com N1 acima de 110px.
- Evite traços finíssimos (hairline) em qualquer texto abaixo de 60px.
- Script: verifique se as maiúsculas continuam reconhecíveis (scripts ornamentadas como o "Ke" do material ficam ilegíveis em tamanho pequeno).

### 2.2 Combinar pelo contraste de anatomia
- Combine fontes que **contrastam** claramente (serifada de alto contraste na N1 com sem serifa sem modulação na N2). Duas fontes parecidas mas não iguais (duas geométricas diferentes) parecem erro.
- Se usar uma única família, crie o contraste com peso (Black e Regular) e caixa (alta na N1, baixa na N2).
- Terminais conversam com o tom:
  - bola: moda, beleza, gastronomia sofisticada;
  - gota: editorial, cultura, educação, advocacia tradicional;
  - bico ou slab: varejo com energia, esporte, construção, campanhas de oferta;
  - ausente (geométrica ou grotesca): tecnologia, serviços, finanças modernas, saúde.

### 2.3 Entrelinha de headline com acentos em português
- Headline em caixa alta com entrelinha **negativa** fica muito forte visualmente, mas em português os acentos das maiúsculas (Á, É, Ê, Ó, Ô, Ã, Õ) sobem acima da linha de versal e colidem com a linha de cima. Regras:
  - caixa alta sem nenhum acento nas linhas de baixo: entrelinha de 0,85 a 0,95 do tamanho;
  - caixa alta com acentos: entrelinha mínima de 1,0 do tamanho e conferir colisão;
  - caixa baixa: descendentes (g, j, p, q, y, ç) da linha de cima podem tocar ascendentes e acentos da linha de baixo; mínimo de 0,95 a 1,05.
- Na revisão, olhar especificamente para os pontos de possível colisão: acento sobre letra embaixo de um g, p, q, j ou ç em cima.

### 2.4 Kerning em headlines grandes
- Em N1 de 96px para cima, o espaço entre pares fica visível. Pares críticos em português: **Te, To, Ta, Tr, Va, Vo, Ve, Wo, Yo, AV, AT, LT, LV, PA, P., F., r,** e aspas com letras.
- Headline bem feita tem manchas de branco entre letras visualmente iguais. Se aparecer um "buraco" (exemplo: "T o" parecendo duas palavras), o gerador errou e a lâmina precisa ser refeita ou editada.
- Números grandes (preço, porcentagem, estatística) também precisam de kerning: "1" costuma sobrar espaço; "%" e "R$" devem ficar próximos do número.

### 2.5 Altura-x e alinhamento óptico
- Ao alinhar texto a um ícone ou imagem, alinhe pelo **topo das maiúsculas** (versal) ou pela **linha de base**, não pela caixa do texto.
- Letras redondas (O, C, G, S) e pontudas (A, V) passam um pouco da linha de base e da versal por compensação óptica; isso é correto, não é erro.
- A margem esquerda óptica: letras como T, V, W, A e aspas parecem recuadas quando alinhadas matematicamente; na headline grande o ideal é que pareçam alinhadas à margem.

### 2.6 Números e dados
- Em card de dado, o número é a N1 e costuma ser o maior elemento do card (160 a 320px). Use fonte com algarismos bem desenhados e robustos (grotesca bold, slab ou condensada).
- Símbolos (R$, %, +, x) em tamanho de cerca de 50 a 60% da altura do número, alinhados ao topo ou à base de forma consistente.

---

## 3. Como pedir isso ao gerador de imagem

Descrever por anatomia dá resultados mais previsíveis que apenas o nome da fonte. Use os termos em inglês, que o modelo reconhece melhor, e acrescente "semelhante a [nome]" quando o kit da marca indicar uma fonte.

### Estilos tipográficos descritos por anatomia
- Didone:
  - PT: "Serifada didone de altíssimo contraste entre traços grossos e finos, eixo vertical, terminais em bola, semelhante a Bodoni."
  - EN: "High-contrast Didone serif with hairline thin strokes, vertical stress and ball terminals, similar to Bodoni."
- Serifada clássica:
  - PT: "Serifada clássica de estilo antigo, serifas suaves e terminais em gota, eixo levemente inclinado."
  - EN: "Old-style serif with bracketed serifs, teardrop terminals and slightly diagonal stress, similar to Caslon."
- Slab:
  - PT: "Slab serif robusta, serifas retangulares grossas com espessura próxima à das hastes."
  - EN: "Sturdy slab serif with thick rectangular serifs almost as heavy as the stems, similar to Roboto Slab."
- Geométrica:
  - PT: "Sans serif geométrica, bojos circulares, sem terminais decorativos, traço uniforme."
  - EN: "Geometric sans-serif with circular bowls, no terminals and uniform stroke weight, similar to Futura or Montserrat."
- Grotesca condensada para headline:
  - PT: "Sans serif grotesca condensada extra bold, caixa alta, letras altas e estreitas."
  - EN: "Extra-bold condensed grotesque sans-serif, all caps, tall narrow letterforms, similar to Bebas Neue."
- Humanista de leitura:
  - PT: "Sans serif humanista de leitura, altura-x grande, aberturas amplas, muito legível em tamanho pequeno."
  - EN: "Humanist sans-serif for body text with a large x-height and open apertures, highly legible at small sizes."

### Entrelinha e colisões
- PT: "Headline em caixa alta com entrelinha apertada, mas os acentos (Á, Ê, Ã) nunca encostam nas letras da linha de cima."
- EN: "All-caps headline with tight leading, but accent marks (Á, Ê, Ã) never touch the letters of the line above."
- PT: "Texto de apoio com entrelinha positiva, arejada, linhas bem separadas."
- EN: "Supporting text with open, positive leading and clearly separated lines."

### Kerning e acabamento
- PT: "Espaçamento entre letras opticamente equilibrado, sem buracos entre pares como T e o, V e a; nenhuma letra encostando na outra."
- EN: "Optically balanced letter spacing with no gaps in pairs like T-o or V-a; no letters touching each other."
- PT: "Letras nítidas e bem formadas, traços consistentes, sem letras derretidas, duplicadas ou deformadas."
- EN: "Crisp, well-formed letterforms with consistent strokes; no melted, doubled or distorted letters."

### Números
- PT: "O número \"[73%]\" é o maior elemento do card, em sans serif condensada black; o símbolo de porcentagem tem cerca de metade da altura do número e fica alinhado ao topo."
- EN: "The number \"[73%]\" is the largest element on the card, in a black condensed sans-serif; the percent sign is about half the number's height, top-aligned."

### Contraste entre famílias
- PT: "Headline em serifada de alto contraste; texto de apoio em sans serif neutra de traço uniforme; as duas nunca se misturam na mesma linha."
- EN: "Headline in a high-contrast serif; supporting text in a neutral monoline sans-serif; never mixed within the same line."

---

## 4. Erros que deixam a arte genérica ou amadora

1. **Didone ou fonte de traço fino em texto pequeno:** as partes finas desaparecem no celular.
2. **Duas fontes quase iguais** combinadas (duas sem serifa geométricas diferentes): parece descuido, não contraste.
3. **Script ornamentada em maiúsculas ou em palavra longa:** ilegível.
4. **Entrelinha negativa com acentos:** acento de Ã ou É encostando no g ou no p de cima; em português isso é erro frequente.
5. **Buracos de kerning em headline grande:** "T o d o s" com espaço visual irregular; parece palavra quebrada.
6. **Letras deformadas pelo gerador:** g de dois andares com laço quebrado, e sem barra, a com bojo aberto, cedilha solta, til no lugar errado. Qualquer uma dessas reprova a lâmina.
7. **Fonte com altura-x pequena no apoio:** parece menor do que o tamanho indicado e cansa.
8. **Símbolos desproporcionais em números:** R$ do mesmo tamanho do valor, % gigante, vírgula decimal minúscula.
9. **Falso bold, falso itálico, contorno ou sombra** aplicados para "dar peso" em vez de usar o peso real da família.
10. **Mistura de terminais e eixos sem intenção:** três estilos de serifa na mesma peça.

---

## 5. Checklist de revisão (olhando a imagem pronta)

- [ ] As letras estão íntegras (g, e, a, ç, ã, õ, é bem formados, sem traços quebrados ou duplicados)?
- [ ] Os acentos e a cedilha estão nas letras certas e bem posicionados?
- [ ] Nenhum acento ou descendente colide com a linha vizinha?
- [ ] O estilo tipográfico corresponde ao descrito (serifada, slab, geométrica, condensada, script)?
- [ ] Se há duas famílias, elas contrastam claramente (e não são quase iguais)?
- [ ] Nenhuma fonte de traço finíssimo está sendo usada em texto de apoio ou detalhe?
- [ ] O texto de apoio tem altura-x generosa e continua legível no tamanho de celular?
- [ ] A headline grande tem espaçamento entre letras regular, sem buracos nem letras encostadas?
- [ ] Números e símbolos (R$, %, +) estão proporcionais e alinhados de forma consistente?
- [ ] Texto e ícones ou imagens estão alinhados pela linha de base ou pelo topo das maiúsculas?
- [ ] Não há falso negrito, falso itálico, contorno ou sombra que deformem as letras?
- [ ] Terminais e serifas combinam com o tom da marca (clássico, moderno, robusto, afetivo)?
