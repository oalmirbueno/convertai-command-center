# Prompts de exemplo do Estúdio da Mesa (27/09)

Gerados por `docs/estudio/gerar-prompts-exemplo.ts` com o código do compositor (`supabase/functions/_shared/direcao-arte.ts`), o kit real da AcelerIQ e a direção do trabalho 615faaf6. O prompt de verdade de cada geração agora fica gravado na versão da lâmina (`prompt_enviado` e `anexos_legendas`).

## O que mudou em 27/09

- Replicar referência: prompt próprio. Saiu tudo o que o diretor escreveu para a cena (imagem, ilustração, ponto focal, fundo, tratamento, zona do texto, tamanhos, fio visual, conceito, estilo de cena, série, padrão e proibições que brigavam com a referência). Entrou o molde: a referência lida por visão como especificação (posição e tamanho de cada bloco em %, caixa alta, família, largura e peso da letra, cor por papel, assunto, elementos, fundo), mapeado bloco a bloco para o texto da lâmina. A referência 1 é a imagem 1, a base a editar. Qualidade alta.
- Logo: vai achatada sobre um fundo liso de contraste (cinza-escuro para logo clara), com o texto exato dela e as cores de cada parte escritos no prompt e na legenda. Logo clara em lâmina clara ganha uma parte escura da composição para pousar. Continua desenhada pelo gerador, no tamanho mínimo de antes.
- Demais modos: a IMAGEM E COMPOSIÇÃO voltou a abrir o prompt (ordem de 23 e 24/09); voltaram as técnicas do padrão (rei da lâmina, planos de profundidade, recorte intencional, cores puxadas para a paleta, eixo e agrupamento) e o elemento visual forte e inesperado da capa; as proibições não proíbem mais o texto da logo nem esvaziam a cena.

## Normal: capa de carrossel, sem foto

Lâmina 1 de 4 do trabalho 615faaf6. Anexos: logo achatada, amostra da fonte, uma arte da marca.

Tamanho: 9392 caracteres.

```text
ARTE FINAL de carrossel, lâmina 1 de 4 para o Instagram da marca. Função desta lâmina: capa (parar a rolagem com um gancho forte).
Conceito do conjunto: Transformar a proposta em uma página que deixa de ser uma lista de entregas e passa a mostrar o raciocínio por trás delas.
Em conflito entre regras, vale nesta ordem: o texto exato, a logo oficial no tamanho pedido, as cores e as fontes da marca, a composição e o acabamento.
1. IMAGEM E COMPOSIÇÃO
- Imagem: Vista oblíqua próxima de uma proposta impressa ocupando a metade inferior da mesa; uma mão segura a página com linhas de tarefas sem texto legível. Um fio verde sai da lista e segue em direção à borda direita.
- CONTINUIDADE DA SÉRIE (obrigatório): Mesmo ensaio fotorrealista em uma mesa de trabalho contemporânea: proposta impressa, caderno e notebook sem marcas; mãos de uma pessoa adulta em roupa neutra, sem mostrar rosto. Luz natural lateral suave, alternando fundos claros e carvão, com verde #00D52B só nos destaques. Mantenha a mesma protagonista, cenário e luz em todas as lâminas; varia só a pose, o gesto e o enquadramento.
- CAPA QUE PARA A ROLAGEM: quem está rolando o feed tem que parar aqui. A maior headline do conjunto, em peso black, com a palavra-chave na cor de destaque; um elemento visual forte e inesperado (escala grande, recorte ousado, objeto cortado pela borda, rosto ou olhar para a câmera, gesto em ação); contraste pela escala e pela cor de destaque, legível até no tamanho da miniatura do feed; mesma luz, cenário e paleta das lâminas seguintes. Nada competindo com a headline.
- O sujeito da foto fica do lado oposto à área do texto (topo esquerda); essa área é calma e uniforme na própria foto (parede, céu, sombra, fundo desfocado) ou recebe um painel da paleta alinhado ao grid.
- Ponto focal: Headline grande no alto à esquerda; a folha inclinada abaixo reforça a ideia de lista.
- Fundo: Mesa clara com área uniforme no topo para o título (cor dominante #F7F7F7).
- Tratamento: Foto integrada com perspectiva diagonal, recorte próximo e fio verde conectando a lista à saída pela direita.
- Estilo visual da marca, obrigatório: As artes usam fotografias ou cenas fotorrealistas de contexto profissional, como escritório, celular, notebook e materiais de trabalho. A iluminação alterna entre fundos escuros com luz de recorte e cenas claras com luz suave, mantendo contraste alto para a mensagem. (resumido para o exemplo)
2. TEXTO EXATO (escrito pela própria arte, integrado à composição; só isto, com esta grafia e acentuação, e nenhuma outra palavra)
- Área do texto: de 11% a 72% da largura e de 7% a 43% da altura do quadro, alinhamento à esquerda, todos os blocos no mesmo eixo e com a mesma margem.
- HEADLINE: "Seu orçamento parece / uma lista de tarefas?", letra de cerca de 116 px numa arte de 1080 x 1350, peso extra negrito ou negrito, fonte Citrica, cor #111111.
- A barra ( / ) marca a quebra de linha: quebre a linha ali e não desenhe a barra.
- A headline tem cerca de 3 vezes a altura do texto de apoio e cada linha dela ocupa cerca de 9% da altura do quadro. O apoio ocupa uma coluna de no máximo 66% da largura, com linhas de 25 a 38 caracteres.
- Headline e apoio formam um grupo, a 16 a 32 px um do outro; CTA, selo e logo ficam a pelo menos 96 px desse grupo. Entrelinha da headline de 1,0 a 1,1, sem acento encostando na linha de cima; entrelinha do apoio de 1,3 a 1,5.
3. LOGO
- Logo oficial anexada, desenhada junto com a arte e idêntica ao anexo (mesmas letras, símbolo, cores e proporção); não redesenhe nem troque por outro texto. Uma logo só.
- O que a logo é: As letras da logo formam exatamente "Aceleriq" ("Aceler" em branco #FFFFFF, "iq" em verde #00D52B), com estas maiúsculas e minúsculas. Símbolo: seta angular em traços geométricos verdes e brancos, à esquerda das letras. Cores medidas no arquivo: branco #FFFFFF, verde #00D52B.
- Tamanho: cerca de 324 x 95 px numa arte de 1080 x 1350 (30% da largura), nunca menor que 259 x 76 px: legível de longe, nunca um detalhe pequenininho.
- Lugar: faz parte da composição, alinhada ao mesmo eixo e à mesma margem do bloco de texto (acima da headline ou abaixo do apoio ou do CTA) ou no ponto que o layout pedir, dentro das margens, com respiro em volta; nunca no canto superior direito, nunca sobre rosto, mão ou produto.
- A logo tem letras ou partes claras: ela fica sobre uma área ESCURA da própria arte (fundo escuro, sombra, parte escura da foto), inteira, com todas as letras legíveis; nunca sobre fundo claro, onde as partes claras somem. A logo entra direto sobre a arte, sem caixa, cartão, retângulo ou fundo próprio atrás, exatamente como o desenho dela.
- O fundo desta lâmina é claro e a logo é clara: a composição tem uma parte escura para ela (uma faixa do grid de borda a borda em #111111, uma área de sombra ou um objeto escuro da cena) e a logo fica nessa parte, nunca direto no fundo claro.
4. MARCA
- Paleta (use só estas cores, na proporção 60-30-10, com um destaque único): Verde vibrante #00D52B (primária e destaque), Preto carvão #111111 (secundária e fundo), Branco suave #F7F7F7 (fundo e texto sobre), Cinza claro #E7E8E9 (fundo), Cinza médio #6B6F73 (texto secundário).
- Tipografia: títulos em Citrica, texto em Roboto. Se houver amostra da fonte anexada, siga o desenho exato das letras da amostra.
- Regras da marca: Faça: preserve a combinação de verde, preto e branco; mantenha alto contraste e hierarquia clara. Não faça: invente resultados, depoimentos, urgência ou escassez. (resumido para o exemplo)
5. FORMATO
- Arte vertical 4:5 (1080 x 1350), usando o quadro inteiro, sem bordas vazias.
- Margens de segurança: 90 px nas laterais (mais 34 px na capa, que aparece recortada em 3:4 na grade do perfil), 100 px no topo e 106 px na base. Nenhum texto nem a logo encostam nas margens.
- Canto superior direito livre de texto (o Instagram mostra o contador do carrossel ali).
PADRÃO DE DESIGN (técnicas que valem em toda lâmina)
- Hierarquia: no máximo 3 níveis e um só ponto focal (o rei da lâmina); a headline domina, com pelo menos 3 vezes a altura do apoio, e o segundo maior elemento tem no máximo metade do primeiro.
- Grid: todos os blocos no mesmo eixo e na mesma margem; texto do mesmo assunto agrupado e blocos diferentes bem afastados; pelo menos 30% da arte em respiro ou fundo calmo.
- Profundidade: foto e texto na mesma cena, em planos (fundo, texto, sujeito), com recorte intencional, uma luz coerente e as cores da foto puxadas para a paleta; objeto recortado pousa com sombra de contato, sem halo nem caixa.
- Leitura: texto só sobre área calma e uniforme da foto, painel sólido do grid ou gradiente local suave; contraste forte, legível até em preto e branco e no tamanho da miniatura do feed.
- Letras nítidas e íntegras, no máximo 2 famílias, sem esticar, sem contorno, sem sombra pesada, nada justificado nem hifenizado; acentos do português exatos (ã, õ, ç, é, ê, á, ó); nenhuma palavra sozinha na última linha.
- Cor: paleta da marca em 60-30-10; a cor de destaque (até 10% da área) só na palavra-chave, no número ou no CTA.
- Acabamento de agência premium: foto real do nicho, pele, mãos e rostos naturais, sombras coerentes, grão sutil só se o estilo pedir.
PROIBIDO
- Nenhum texto além do texto exato e das letras da própria logo oficial: sem o nome da marca escrito fora da logo, site, telefone, @, hashtag, preço, data, marca d'água, legenda ou letras de enfeite.
- Nenhuma logo ou marca de outra empresa, pessoa a mais, objeto solto sem função, ícone de banco de imagens ou elemento repetido ou duplicado; os objetos de apoio são só os que a cena pede ou teria naturalmente.
- Pessoas com anatomia correta e natural: cabeça alinhada ao corpo, pescoço natural, cinco dedos em cada mão, mãos segurando os objetos de um jeito possível, braços e pernas inteiros e na proporção certa.
- Sem moldura, borda, contorno ou cantos arredondados em volta da arte; o fundo vai até a borda. Faixas e formas gráficas só as do layout da marca.
- Não escureça a imagem para criar destaque. Evite: tudo centralizado e do mesmo tamanho, faixa preta genérica, gradiente roxo e azul, neon, brilho, 3D plástico, ícones de banco.
- Não copie o texto das outras lâminas da série.
- Sem travessão no texto.

REGRAS FINAIS (valem sobre tudo acima)
- Arte final completa numa imagem só. Todo o texto é desenhado pela própria arte, integrado à composição, nunca uma caixa de texto solta por cima da imagem.
- Escreva exatamente este texto, com a mesma grafia e acentuação, e nenhum outro texto: "Seu orçamento parece
uma lista de tarefas?"
- Logo: a oficial anexada, idêntica ao anexo, no tamanho do bloco LOGO (nunca pequenininha), sem caixa atrás. Uma logo só.
- Imagens anexadas, na ordem (use cada uma só para o que a legenda dela diz; nada delas entra na arte além disso): imagem 1: LOGO OFICIAL da marca (as letras dizem "Aceleriq"): reproduza exatamente esta logo, com todas as letras, o símbolo, as cores e a proporção; não redesenhe, não invente símbolo e não ponha caixa ou retângulo atrás dela. Ela está sobre um fundo cinza-escuro liso SÓ para você enxergar as partes claras; esse fundo não faz parte da logo e não vai para a arte.; imagem 2: amostra da fonte Citrica (titulo): siga o desenho destas letras; imagem 3: arte já publicada da própria marca: siga a mesma identidade (cores, tipografia, tratamento de foto); não copie o layout, o texto nem as pessoas dela.
```

## Série: lâmina 2 de 4 (sem logo)

A capa vai anexada como guia; o miolo não leva logo.

Tamanho: 7840 caracteres.

```text
ARTE FINAL de carrossel, lâmina 2 de 4 para o Instagram da marca. Função desta lâmina: conteúdo (uma ideia só).
Conceito do conjunto: Transformar a proposta em uma página que deixa de ser uma lista de entregas e passa a mostrar o raciocínio por trás delas.
Em conflito entre regras, vale nesta ordem: o texto exato, a logo oficial no tamanho pedido, as cores e as fontes da marca, a composição e o acabamento.
1. IMAGEM E COMPOSIÇÃO
- Imagem: Close de uma página de proposta com linhas de tarefas desconectadas; mão aponta para a lista.
- CONTINUIDADE DA SÉRIE (obrigatório): Mesmo ensaio fotorrealista em uma mesa de trabalho contemporânea: proposta impressa, caderno e notebook sem marcas; mãos de uma pessoa adulta em roupa neutra, sem mostrar rosto. Luz natural lateral suave, alternando fundos claros e carvão, com verde #00D52B só nos destaques. Mantenha a mesma protagonista, cenário e luz em todas as lâminas; varia só a pose, o gesto e o enquadramento.
- O sujeito da foto fica do lado oposto à área do texto (centro esquerda); essa área é calma e uniforme na própria foto (parede, céu, sombra, fundo desfocado) ou recebe um painel da paleta alinhado ao grid.
- Ponto focal: A lista impressa, vista de perto, com headline em área escura uniforme à esquerda.
- Fundo: Campo carvão #111111 na metade esquerda para o texto; mesa clara e documento à direita (cor dominante #111111).
- Tratamento: Contraste por planos: painel escuro integrado ao enquadramento, documento nítido em primeiro plano.
- Estilo visual da marca, obrigatório: As artes usam fotografias ou cenas fotorrealistas de contexto profissional, como escritório, celular, notebook e materiais de trabalho. A iluminação alterna entre fundos escuros com luz de recorte e cenas claras com luz suave, mantendo contraste alto para a mensagem. (resumido para o exemplo)
2. TEXTO EXATO (escrito pela própria arte, integrado à composição; só isto, com esta grafia e acentuação, e nenhuma outra palavra)
- Área do texto: de 8% a 68% da largura e de 33% a 67% da altura do quadro, alinhamento à esquerda, todos os blocos no mesmo eixo e com a mesma margem.
- HEADLINE: "Entregas sem objetivo", letra de cerca de 124 px numa arte de 1080 x 1350, peso extra negrito ou negrito, fonte Citrica, cor #F7F7F7.
- APOIO: "A proposta enumera entregas, mas não conecta cada uma ao objetivo.", letra de cerca de 40 px numa arte de 1080 x 1350, peso regular, fonte Roboto, cor #F7F7F7.
- A headline tem cerca de 3 vezes a altura do texto de apoio e cada linha dela ocupa cerca de 9% da altura do quadro. O apoio ocupa uma coluna de no máximo 66% da largura, com linhas de 25 a 38 caracteres.
- Headline e apoio formam um grupo, a 16 a 32 px um do outro; CTA, selo e logo ficam a pelo menos 96 px desse grupo. Entrelinha da headline de 1,0 a 1,1, sem acento encostando na linha de cima; entrelinha do apoio de 1,3 a 1,5.
3. LOGO
- Sem logo nesta lâmina: não desenhe logo, símbolo nem marca.
4. MARCA
- Paleta (use só estas cores, na proporção 60-30-10, com um destaque único): Verde vibrante #00D52B (primária e destaque), Preto carvão #111111 (secundária e fundo), Branco suave #F7F7F7 (fundo e texto sobre), Cinza claro #E7E8E9 (fundo), Cinza médio #6B6F73 (texto secundário).
- Tipografia: títulos em Citrica, texto em Roboto. Se houver amostra da fonte anexada, siga o desenho exato das letras da amostra.
- Regras da marca: Faça: preserve a combinação de verde, preto e branco; mantenha alto contraste e hierarquia clara. Não faça: invente resultados, depoimentos, urgência ou escassez. (resumido para o exemplo)
5. FORMATO
- Arte vertical 4:5 (1080 x 1350), usando o quadro inteiro, sem bordas vazias.
- Margens de segurança: 90 px nas laterais, 100 px no topo e 106 px na base. Nenhum texto nem a logo encostam nas margens.
- Canto superior direito livre de texto (o Instagram mostra o contador do carrossel ali).
PADRÃO DE DESIGN (técnicas que valem em toda lâmina)
- Hierarquia: no máximo 3 níveis e um só ponto focal (o rei da lâmina); a headline domina, com pelo menos 3 vezes a altura do apoio, e o segundo maior elemento tem no máximo metade do primeiro.
- Grid: todos os blocos no mesmo eixo e na mesma margem; texto do mesmo assunto agrupado e blocos diferentes bem afastados; pelo menos 30% da arte em respiro ou fundo calmo.
- Profundidade: foto e texto na mesma cena, em planos (fundo, texto, sujeito), com recorte intencional, uma luz coerente e as cores da foto puxadas para a paleta; objeto recortado pousa com sombra de contato, sem halo nem caixa.
- Leitura: texto só sobre área calma e uniforme da foto, painel sólido do grid ou gradiente local suave; contraste forte, legível até em preto e branco e no tamanho da miniatura do feed.
- Letras nítidas e íntegras, no máximo 2 famílias, sem esticar, sem contorno, sem sombra pesada, nada justificado nem hifenizado; acentos do português exatos (ã, õ, ç, é, ê, á, ó); nenhuma palavra sozinha na última linha.
- Cor: paleta da marca em 60-30-10; a cor de destaque (até 10% da área) só na palavra-chave, no número ou no CTA.
- Acabamento de agência premium: foto real do nicho, pele, mãos e rostos naturais, sombras coerentes, grão sutil só se o estilo pedir.
PROIBIDO
- Nenhum texto além do texto exato e das letras da própria logo oficial: sem o nome da marca escrito fora da logo, site, telefone, @, hashtag, preço, data, marca d'água, legenda ou letras de enfeite.
- Nenhuma logo ou marca de outra empresa, pessoa a mais, objeto solto sem função, ícone de banco de imagens ou elemento repetido ou duplicado; os objetos de apoio são só os que a cena pede ou teria naturalmente.
- Pessoas com anatomia correta e natural: cabeça alinhada ao corpo, pescoço natural, cinco dedos em cada mão, mãos segurando os objetos de um jeito possível, braços e pernas inteiros e na proporção certa.
- Sem moldura, borda, contorno ou cantos arredondados em volta da arte; o fundo vai até a borda. Faixas e formas gráficas só as do layout da marca.
- Não escureça a imagem para criar destaque. Evite: tudo centralizado e do mesmo tamanho, faixa preta genérica, gradiente roxo e azul, neon, brilho, 3D plástico, ícones de banco.
- Não copie o texto das outras lâminas da série.
- Sem travessão no texto.

SÉRIE DO CARROSSEL (lâmina 2 de 4): esta lâmina continua a capa (imagem 2); não é uma peça nova.
- Repita o sistema visual da capa: o mesmo grid e as mesmas margens, as mesmas linhas, formas e elementos gráficos (mesmo traço, espessura, cantos, cor e posição relativa), a mesma tipografia (família, peso, caixa e escala relativa), a mesma paleta e proporção de cores e o mesmo tratamento de foto, luz e textura.
- Varie só o conteúdo: o texto, a imagem desta lâmina e a posição do bloco dentro do mesmo grid. Não reinvente o estilo, não troque de fonte nem de paleta e não crie elementos gráficos que a capa não tem.
- Não copie o texto nem a composição exata da capa: é a mesma série, não a mesma lâmina.

REGRAS FINAIS (valem sobre tudo acima)
- Arte final completa numa imagem só. Todo o texto é desenhado pela própria arte, integrado à composição, nunca uma caixa de texto solta por cima da imagem.
- Escreva exatamente este texto, com a mesma grafia e acentuação, e nenhum outro texto: "Entregas sem objetivo
A proposta enumera entregas, mas não conecta cada uma ao objetivo."
- Sem logo nesta lâmina: não desenhe logo, símbolo nem marca.
- Imagens anexadas, na ordem (use cada uma só para o que a legenda dela diz; nada delas entra na arte além disso): imagem 1: amostra da fonte Citrica (titulo): siga o desenho destas letras; imagem 2: CAPA desta série (lâmina 1), já aprovada: é o guia do sistema visual; repita o grid, as margens, as linhas, formas e elementos gráficos (mesmo traço, espessura e cor), a tipografia, a paleta, o tratamento e a mesma protagonista, cenário e luz; não copie o texto nem a composição exata dela.
```

## Foto real: lâmina final com foto do acervo

A foto é a imagem 1 (máscara); a área da logo abre junto com a do texto.

Tamanho: 9795 caracteres.

```text
EDITE a imagem 1 (foto real do cliente). Desenhe SÓ dentro destas áreas: de 7% a 95% da largura e de 47% a 96% da altura; de 9% a 47% da largura e de 5% a 22% da altura. Fora delas a foto fica exatamente como está.

Não reenquadre a imagem 1: mesmo corte, mesmo zoom, mesma posição e tamanho de cada pessoa e objeto, nada aproximado, afastado, girado ou espelhado. A saída tem exatamente o mesmo enquadramento da imagem 1.

Escreva o texto e a logo DIRETAMENTE sobre a imagem, integrados à cena: sem caixa, cartão, painel, faixa, retângulo, moldura, véu, desfoque ou área de cor atrás das letras. Ignore qualquer indicação de fundo liso ou de área de cor para o texto: aqui o fundo é a própria foto. O contraste vem da cor e do peso das letras (escolha na paleta a cor que mais contrasta com aquela parte da foto) e, se preciso, de uma sombra suave nas próprias letras. Não escureça a foto.

ARTE FINAL de carrossel, lâmina 4 de 4 para o Instagram da marca. Função desta lâmina: fechamento com chamada para ação.
Conceito do conjunto: Transformar a proposta em uma página que deixa de ser uma lista de entregas e passa a mostrar o raciocínio por trás delas.
Em conflito entre regras, vale nesta ordem: o texto exato, a logo oficial no tamanho pedido, as cores e as fontes da marca, a composição e o acabamento.
1. IMAGEM E COMPOSIÇÃO
- Imagem: a FOTO REAL do cliente anexada como imagem 1 (foto da equipe na mesa de trabalho, luz natural) é a base desta lâmina. Não redesenhe a foto: pessoas, objetos, ambiente, luz, cores, corte e enquadramento ficam exatamente como estão. Desenhe só o texto e a logo, direto sobre a foto, sem painel, véu, caixa ou desfoque atrás deles.
- O texto fica na área indicada (base esquerda), sobre a parte mais calma da foto; o contraste vem da cor e do peso das letras, nunca de escurecer ou cobrir a foto.
2. TEXTO EXATO (escrito pela própria arte, integrado à composição; só isto, com esta grafia e acentuação, e nenhuma outra palavra)
- Área do texto: de 8% a 75% da largura e de 54% a 92% da altura do quadro, alinhamento à esquerda, todos os blocos no mesmo eixo e com a mesma margem.
- HEADLINE: "Feche com o próximo passo", letra de cerca de 124 px numa arte de 1080 x 1350, peso extra negrito ou negrito, fonte Citrica, cor #F7F7F7.
- APOIO: "Inclua etapas, dependências e próximo passo para aprovação.", letra de cerca de 40 px numa arte de 1080 x 1350, peso regular, fonte Roboto, cor #F7F7F7.
- CTA: "Salve para revisar sua próxima proposta.", letra de cerca de 41 px numa arte de 1080 x 1350, peso negrito, fonte Roboto, cor #00D52B.
- A headline tem cerca de 3 vezes a altura do texto de apoio e cada linha dela ocupa cerca de 9% da altura do quadro. O apoio ocupa uma coluna de no máximo 66% da largura, com linhas de 25 a 38 caracteres.
- Headline e apoio formam um grupo, a 16 a 32 px um do outro; CTA, selo e logo ficam a pelo menos 96 px desse grupo. Entrelinha da headline de 1,0 a 1,1, sem acento encostando na linha de cima; entrelinha do apoio de 1,3 a 1,5.
3. LOGO
- Logo oficial anexada, desenhada junto com a arte e idêntica ao anexo (mesmas letras, símbolo, cores e proporção); não redesenhe nem troque por outro texto. Uma logo só.
- O que a logo é: As letras da logo formam exatamente "Aceleriq" ("Aceler" em branco #FFFFFF, "iq" em verde #00D52B), com estas maiúsculas e minúsculas. Símbolo: seta angular em traços geométricos verdes e brancos, à esquerda das letras. Cores medidas no arquivo: branco #FFFFFF, verde #00D52B.
- Tamanho: cerca de 324 x 95 px numa arte de 1080 x 1350 (30% da largura), nunca menor que 259 x 76 px: legível de longe, nunca um detalhe pequenininho.
- Lugar: dentro da área reservada para ela (de 11% a 45% da largura e de 7% a 20% da altura do quadro), alinhada ao lado de fora dessa área; é a única área, além da do texto, em que a imagem muda.
- A logo tem letras ou partes claras: ela fica sobre uma área ESCURA da própria arte (fundo escuro, sombra, parte escura da foto), inteira, com todas as letras legíveis; nunca sobre fundo claro, onde as partes claras somem. A logo entra direto sobre a arte, sem caixa, cartão, retângulo ou fundo próprio atrás, exatamente como o desenho dela.
4. MARCA
- Paleta (use só estas cores, na proporção 60-30-10, com um destaque único): Verde vibrante #00D52B (primária e destaque), Preto carvão #111111 (secundária e fundo), Branco suave #F7F7F7 (fundo e texto sobre), Cinza claro #E7E8E9 (fundo), Cinza médio #6B6F73 (texto secundário).
- Tipografia: títulos em Citrica, texto em Roboto. Se houver amostra da fonte anexada, siga o desenho exato das letras da amostra.
- Estilo visual da marca, no texto e nos elementos gráficos: As artes usam fotografias ou cenas fotorrealistas de contexto profissional, como escritório, celular, notebook e materiais de trabalho. A iluminação alterna entre fundos escuros com luz de recorte e cenas claras com luz suave, mantendo contraste alto para a mensagem. (resumido para o exemplo)
- Regras da marca: Faça: preserve a combinação de verde, preto e branco; mantenha alto contraste e hierarquia clara. Não faça: invente resultados, depoimentos, urgência ou escassez. (resumido para o exemplo)
5. FORMATO
- Arte vertical 4:5 (1080 x 1350), usando o quadro inteiro, sem bordas vazias.
- Margens de segurança: 90 px nas laterais, 100 px no topo e 106 px na base. Nenhum texto nem a logo encostam nas margens.
- Canto superior direito livre de texto (o Instagram mostra o contador do carrossel ali).
PADRÃO DE DESIGN (técnicas que valem em toda lâmina)
- Hierarquia: no máximo 3 níveis e um só ponto focal (o rei da lâmina); a headline domina, com pelo menos 3 vezes a altura do apoio, e o segundo maior elemento tem no máximo metade do primeiro.
- Grid: todos os blocos no mesmo eixo e na mesma margem; texto do mesmo assunto agrupado e blocos diferentes bem afastados; pelo menos 30% da arte em respiro ou fundo calmo.
- Profundidade: foto e texto na mesma cena, em planos (fundo, texto, sujeito), com recorte intencional, uma luz coerente e as cores da foto puxadas para a paleta; objeto recortado pousa com sombra de contato, sem halo nem caixa.
- Leitura: texto só sobre área calma e uniforme da foto, painel sólido do grid ou gradiente local suave; contraste forte, legível até em preto e branco e no tamanho da miniatura do feed.
- Letras nítidas e íntegras, no máximo 2 famílias, sem esticar, sem contorno, sem sombra pesada, nada justificado nem hifenizado; acentos do português exatos (ã, õ, ç, é, ê, á, ó); nenhuma palavra sozinha na última linha.
- Cor: paleta da marca em 60-30-10; a cor de destaque (até 10% da área) só na palavra-chave, no número ou no CTA.
- Acabamento de agência premium: foto real do nicho, pele, mãos e rostos naturais, sombras coerentes, grão sutil só se o estilo pedir.
PROIBIDO
- Nenhum texto além do texto exato e das letras da própria logo oficial: sem o nome da marca escrito fora da logo, site, telefone, @, hashtag, preço, data, marca d'água, legenda ou letras de enfeite.
- Nenhuma logo ou marca de outra empresa, pessoa a mais, objeto solto sem função, ícone de banco de imagens ou elemento repetido ou duplicado; os objetos de apoio são só os que a cena pede ou teria naturalmente.
- Pessoas com anatomia correta e natural: cabeça alinhada ao corpo, pescoço natural, cinco dedos em cada mão, mãos segurando os objetos de um jeito possível, braços e pernas inteiros e na proporção certa.
- Sem moldura, borda, contorno ou cantos arredondados em volta da arte; o fundo vai até a borda. Faixas e formas gráficas só as do layout da marca.
- Não escureça a imagem para criar destaque. Evite: tudo centralizado e do mesmo tamanho, faixa preta genérica, gradiente roxo e azul, neon, brilho, 3D plástico, ícones de banco.
- Não copie o texto das outras lâminas da série.
- Sem travessão no texto.

SÉRIE DO CARROSSEL (lâmina 4 de 4): esta lâmina continua a capa (imagem 4); não é uma peça nova.
- A cena desta lâmina já está decidida. Da capa vem o sistema do texto: a mesma tipografia (família, peso, caixa e escala relativa entre headline e apoio), as mesmas cores de texto e de destaque, o mesmo alinhamento e os mesmos elementos gráficos do texto (fios, sublinhados, marcadores), no mesmo traço e espessura.
- Varie só o conteúdo: o texto, a imagem desta lâmina e a posição do bloco dentro do mesmo grid. Não reinvente o estilo, não troque de fonte nem de paleta e não crie elementos gráficos que a capa não tem.
- Não copie o texto nem a composição exata da capa: é a mesma série, não a mesma lâmina.
- FECHAMENTO: esta é a última lâmina. Feche voltando à capa: a mesma cor dominante ou o mesmo elemento gráfico e o mesmo enquadramento da capa, como um espelho do começo, com o CTA em destaque.

REGRAS FINAIS (valem sobre tudo acima)
- Arte final completa numa imagem só. Todo o texto é desenhado pela própria arte, integrado à composição, nunca uma caixa de texto solta por cima da imagem.
- Escreva exatamente este texto, com a mesma grafia e acentuação, e nenhum outro texto: "Feche com o próximo passo
Inclua etapas, dependências e próximo passo para aprovação.
Salve para revisar sua próxima proposta."
- Logo: a oficial anexada, idêntica ao anexo, no tamanho do bloco LOGO (nunca pequenininha), sem caixa atrás. Uma logo só.
- Imagens anexadas, na ordem (use cada uma só para o que a legenda dela diz; nada delas entra na arte além disso): imagem 2: LOGO OFICIAL da marca (as letras dizem "Aceleriq"): reproduza exatamente esta logo, com todas as letras, o símbolo, as cores e a proporção; não redesenhe, não invente símbolo e não ponha caixa ou retângulo atrás dela. Ela está sobre um fundo cinza-escuro liso SÓ para você enxergar as partes claras; esse fundo não faz parte da logo e não vai para a arte.; imagem 3: amostra da fonte Citrica (titulo): siga o desenho destas letras.
```

## Recorte: pessoa sem fundo na lâmina 2

O código põe o recorte do lado oposto ao texto e cola o original de volta no fim.

Tamanho: 7635 caracteres.

```text
EDITE a imagem 1: ela já tem a pessoa ou o produto REAL recortado, no lugar certo (de 50% a 100% da largura e de 10% a 100% da altura). Ele fica exatamente como está: mesmo rosto, feições, corpo, roupa, cores, tamanho e posição; não redesenhe, não mova, não corte e não cubra. Crie em volta dele a lâmina inteira pela direção abaixo: o fundo ou um cenário simples na paleta da marca, luz coerente com a do recorte, uma sombra de contato suave onde ele pousa, os elementos gráficos, o texto na área indicada.

Sem caixa, moldura, borda, contorno branco, halo ou brilho em volta do recorte; nenhum texto, logo, forma ou elemento por cima dele. A cor lisa da imagem 1 é só o ponto de partida: troque pelo fundo da direção.

ARTE FINAL de carrossel, lâmina 2 de 4 para o Instagram da marca. Função desta lâmina: conteúdo (uma ideia só).
Conceito do conjunto: Transformar a proposta em uma página que deixa de ser uma lista de entregas e passa a mostrar o raciocínio por trás delas.
Em conflito entre regras, vale nesta ordem: o texto exato, a logo oficial no tamanho pedido, as cores e as fontes da marca, a composição e o acabamento.
1. IMAGEM E COMPOSIÇÃO
- Imagem: o recorte REAL (pessoa sorrindo segurando a proposta) já posto na imagem 1, de 50% a 100% da largura e de 10% a 100% da altura, com cenário simples em volta, na paleta da marca.
- CONTINUIDADE DA SÉRIE (obrigatório): Mesmo ensaio fotorrealista em uma mesa de trabalho contemporânea: proposta impressa, caderno e notebook sem marcas; mãos de uma pessoa adulta em roupa neutra, sem mostrar rosto. Luz natural lateral suave, alternando fundos claros e carvão, com verde #00D52B só nos destaques. Mantenha a mesma protagonista, cenário e luz em todas as lâminas; varia só a pose, o gesto e o enquadramento.
- O sujeito da foto fica do lado oposto à área do texto (coluna esquerda); essa área é calma e uniforme na própria foto (parede, céu, sombra, fundo desfocado) ou recebe um painel da paleta alinhado ao grid.
- Ponto focal: a pessoa ou o produto recortado, com a headline no espaço livre ao lado ou acima.
- Fundo: Campo carvão #111111 na metade esquerda para o texto; mesa clara e documento à direita (cor dominante #111111).
- Tratamento: Contraste por planos: painel escuro integrado ao enquadramento, documento nítido em primeiro plano.
- Estilo visual da marca, obrigatório: As artes usam fotografias ou cenas fotorrealistas de contexto profissional, como escritório, celular, notebook e materiais de trabalho. A iluminação alterna entre fundos escuros com luz de recorte e cenas claras com luz suave, mantendo contraste alto para a mensagem. (resumido para o exemplo)
2. TEXTO EXATO (escrito pela própria arte, integrado à composição; só isto, com esta grafia e acentuação, e nenhuma outra palavra)
- Área do texto: de 8% a 50% da largura e de 7% a 92% da altura do quadro, alinhamento à esquerda, todos os blocos no mesmo eixo e com a mesma margem.
- HEADLINE: "Entregas sem objetivo", letra de cerca de 124 px numa arte de 1080 x 1350, peso extra negrito ou negrito, fonte Citrica, cor #F7F7F7.
- APOIO: "A proposta enumera entregas, mas não conecta cada uma ao objetivo.", letra de cerca de 40 px numa arte de 1080 x 1350, peso regular, fonte Roboto, cor #F7F7F7.
- A headline tem cerca de 3 vezes a altura do texto de apoio e cada linha dela ocupa cerca de 9% da altura do quadro. O apoio ocupa uma coluna de no máximo 66% da largura, com linhas de 25 a 38 caracteres.
- Headline e apoio formam um grupo, a 16 a 32 px um do outro; CTA, selo e logo ficam a pelo menos 96 px desse grupo. Entrelinha da headline de 1,0 a 1,1, sem acento encostando na linha de cima; entrelinha do apoio de 1,3 a 1,5.
3. LOGO
- Sem logo nesta lâmina: não desenhe logo, símbolo nem marca.
4. MARCA
- Paleta (use só estas cores, na proporção 60-30-10, com um destaque único): Verde vibrante #00D52B (primária e destaque), Preto carvão #111111 (secundária e fundo), Branco suave #F7F7F7 (fundo e texto sobre), Cinza claro #E7E8E9 (fundo), Cinza médio #6B6F73 (texto secundário).
- Tipografia: títulos em Citrica, texto em Roboto. Se houver amostra da fonte anexada, siga o desenho exato das letras da amostra.
- Regras da marca: Faça: preserve a combinação de verde, preto e branco; mantenha alto contraste e hierarquia clara. Não faça: invente resultados, depoimentos, urgência ou escassez. (resumido para o exemplo)
5. FORMATO
- Arte vertical 4:5 (1080 x 1350), usando o quadro inteiro, sem bordas vazias.
- Margens de segurança: 90 px nas laterais, 100 px no topo e 106 px na base. Nenhum texto nem a logo encostam nas margens.
- Canto superior direito livre de texto (o Instagram mostra o contador do carrossel ali).
PADRÃO DE DESIGN (técnicas que valem em toda lâmina)
- Hierarquia: no máximo 3 níveis e um só ponto focal (o rei da lâmina); a headline domina, com pelo menos 3 vezes a altura do apoio, e o segundo maior elemento tem no máximo metade do primeiro.
- Grid: todos os blocos no mesmo eixo e na mesma margem; texto do mesmo assunto agrupado e blocos diferentes bem afastados; pelo menos 30% da arte em respiro ou fundo calmo.
- Profundidade: foto e texto na mesma cena, em planos (fundo, texto, sujeito), com recorte intencional, uma luz coerente e as cores da foto puxadas para a paleta; objeto recortado pousa com sombra de contato, sem halo nem caixa.
- Leitura: texto só sobre área calma e uniforme da foto, painel sólido do grid ou gradiente local suave; contraste forte, legível até em preto e branco e no tamanho da miniatura do feed.
- Letras nítidas e íntegras, no máximo 2 famílias, sem esticar, sem contorno, sem sombra pesada, nada justificado nem hifenizado; acentos do português exatos (ã, õ, ç, é, ê, á, ó); nenhuma palavra sozinha na última linha.
- Cor: paleta da marca em 60-30-10; a cor de destaque (até 10% da área) só na palavra-chave, no número ou no CTA.
- Acabamento de agência premium: foto real do nicho, pele, mãos e rostos naturais, sombras coerentes, grão sutil só se o estilo pedir.
PROIBIDO
- Nenhum texto além do texto exato e das letras da própria logo oficial: sem o nome da marca escrito fora da logo, site, telefone, @, hashtag, preço, data, marca d'água, legenda ou letras de enfeite.
- Nenhuma logo ou marca de outra empresa, pessoa a mais, objeto solto sem função, ícone de banco de imagens ou elemento repetido ou duplicado; os objetos de apoio são só os que a cena pede ou teria naturalmente.
- Pessoas com anatomia correta e natural: cabeça alinhada ao corpo, pescoço natural, cinco dedos em cada mão, mãos segurando os objetos de um jeito possível, braços e pernas inteiros e na proporção certa.
- Sem moldura, borda, contorno ou cantos arredondados em volta da arte; o fundo vai até a borda. Faixas e formas gráficas só as do layout da marca.
- Não escureça a imagem para criar destaque. Evite: tudo centralizado e do mesmo tamanho, faixa preta genérica, gradiente roxo e azul, neon, brilho, 3D plástico, ícones de banco.
- Não copie o texto das outras lâminas da série.
- Sem travessão no texto.

REGRAS FINAIS (valem sobre tudo acima)
- Arte final completa numa imagem só. Todo o texto é desenhado pela própria arte, integrado à composição, nunca uma caixa de texto solta por cima da imagem.
- Escreva exatamente este texto, com a mesma grafia e acentuação, e nenhum outro texto: "Entregas sem objetivo
A proposta enumera entregas, mas não conecta cada uma ao objetivo."
- Sem logo nesta lâmina: não desenhe logo, símbolo nem marca.
- Imagens anexadas, na ordem (use cada uma só para o que a legenda dela diz; nada delas entra na arte além disso): imagem 2: amostra da fonte Citrica (titulo): siga o desenho destas letras.
```

## Contínuo: capa sobre a fatia do panorama

O código cola só o que mudou nas áreas do texto e da logo sobre a fatia intacta.

Tamanho: 9114 caracteres.

```text
EDITE a imagem 1: ela é a cena desta lâmina, parte de um panorama que atravessa o carrossel, e já está pronta. Escreva só o texto e a logo por cima, nas áreas indicadas. Mantenha a mesma cena, luz, pessoas e objetos, na mesma posição e escala. Não mude nada nas faixas das bordas esquerda e direita (7% de cada lado): elas emendam com as lâminas vizinhas.

Não reenquadre a imagem 1: mesmo corte, mesmo zoom, mesma posição e tamanho de cada pessoa e objeto, nada aproximado, afastado, girado ou espelhado. A saída tem exatamente o mesmo enquadramento da imagem 1.

Escreva o texto e a logo DIRETAMENTE sobre a imagem, integrados à cena: sem caixa, cartão, painel, faixa, retângulo, moldura, véu, desfoque ou área de cor atrás das letras. Ignore qualquer indicação de fundo liso ou de área de cor para o texto: aqui o fundo é a própria foto. O contraste vem da cor e do peso das letras (escolha na paleta a cor que mais contrasta com aquela parte da foto) e, se preciso, de uma sombra suave nas próprias letras. Não escureça a foto.

ARTE FINAL de carrossel, lâmina 1 de 4 para o Instagram da marca. Função desta lâmina: capa (parar a rolagem com um gancho forte).
Conceito do conjunto: Transformar a proposta em uma página que deixa de ser uma lista de entregas e passa a mostrar o raciocínio por trás delas.
Em conflito entre regras, vale nesta ordem: o texto exato, a logo oficial no tamanho pedido, as cores e as fontes da marca, a composição e o acabamento.
1. IMAGEM E COMPOSIÇÃO
- Imagem: a FOTO REAL do cliente anexada como imagem 1 (fundo panorâmico contínuo do carrossel, já pronto: o texto entra por cima, sem mudar a cena) é a base desta lâmina. Não redesenhe a foto: pessoas, objetos, ambiente, luz, cores, corte e enquadramento ficam exatamente como estão. Desenhe só o texto e a logo, direto sobre a foto, sem painel, véu, caixa ou desfoque atrás deles.
- CAPA QUE PARA A ROLAGEM: a maior headline do conjunto, em peso black, com a palavra-chave na cor de destaque, legível até no tamanho da miniatura do feed. A foto já é o elemento visual forte: não mude a foto. Nada competindo com a headline.
- O texto fica na área indicada (topo esquerda), sobre a parte mais calma da foto; o contraste vem da cor e do peso das letras, nunca de escurecer ou cobrir a foto.
2. TEXTO EXATO (escrito pela própria arte, integrado à composição; só isto, com esta grafia e acentuação, e nenhuma outra palavra)
- Área do texto: de 11% a 72% da largura e de 7% a 43% da altura do quadro, alinhamento à esquerda, todos os blocos no mesmo eixo e com a mesma margem.
- HEADLINE: "Seu orçamento parece / uma lista de tarefas?", letra de cerca de 116 px numa arte de 1080 x 1350, peso extra negrito ou negrito, fonte Citrica, cor #111111.
- A barra ( / ) marca a quebra de linha: quebre a linha ali e não desenhe a barra.
- A headline tem cerca de 3 vezes a altura do texto de apoio e cada linha dela ocupa cerca de 9% da altura do quadro. O apoio ocupa uma coluna de no máximo 66% da largura, com linhas de 25 a 38 caracteres.
- Headline e apoio formam um grupo, a 16 a 32 px um do outro; CTA, selo e logo ficam a pelo menos 96 px desse grupo. Entrelinha da headline de 1,0 a 1,1, sem acento encostando na linha de cima; entrelinha do apoio de 1,3 a 1,5.
3. LOGO
- Logo oficial anexada, desenhada junto com a arte e idêntica ao anexo (mesmas letras, símbolo, cores e proporção); não redesenhe nem troque por outro texto. Uma logo só.
- O que a logo é: As letras da logo formam exatamente "Aceleriq" ("Aceler" em branco #FFFFFF, "iq" em verde #00D52B), com estas maiúsculas e minúsculas. Símbolo: seta angular em traços geométricos verdes e brancos, à esquerda das letras. Cores medidas no arquivo: branco #FFFFFF, verde #00D52B.
- Tamanho: cerca de 324 x 95 px numa arte de 1080 x 1350 (30% da largura), nunca menor que 259 x 76 px: legível de longe, nunca um detalhe pequenininho.
- Lugar: dentro da área reservada para ela (de 11% a 45% da largura e de 88% a 92% da altura do quadro), alinhada ao lado de fora dessa área; é a única área, além da do texto, em que a imagem muda.
- A logo tem letras ou partes claras: ela fica sobre uma área ESCURA da própria arte (fundo escuro, sombra, parte escura da foto), inteira, com todas as letras legíveis; nunca sobre fundo claro, onde as partes claras somem. A logo entra direto sobre a arte, sem caixa, cartão, retângulo ou fundo próprio atrás, exatamente como o desenho dela.
4. MARCA
- Paleta (use só estas cores, na proporção 60-30-10, com um destaque único): Verde vibrante #00D52B (primária e destaque), Preto carvão #111111 (secundária e fundo), Branco suave #F7F7F7 (fundo e texto sobre), Cinza claro #E7E8E9 (fundo), Cinza médio #6B6F73 (texto secundário).
- Tipografia: títulos em Citrica, texto em Roboto. Se houver amostra da fonte anexada, siga o desenho exato das letras da amostra.
- Estilo visual da marca, no texto e nos elementos gráficos: As artes usam fotografias ou cenas fotorrealistas de contexto profissional, como escritório, celular, notebook e materiais de trabalho. A iluminação alterna entre fundos escuros com luz de recorte e cenas claras com luz suave, mantendo contraste alto para a mensagem. (resumido para o exemplo)
- Regras da marca: Faça: preserve a combinação de verde, preto e branco; mantenha alto contraste e hierarquia clara. Não faça: invente resultados, depoimentos, urgência ou escassez. (resumido para o exemplo)
5. FORMATO
- Arte vertical 4:5 (1080 x 1350), usando o quadro inteiro, sem bordas vazias.
- Margens de segurança: 90 px nas laterais (mais 34 px na capa, que aparece recortada em 3:4 na grade do perfil), 100 px no topo e 106 px na base. Nenhum texto nem a logo encostam nas margens.
- Canto superior direito livre de texto (o Instagram mostra o contador do carrossel ali).
PADRÃO DE DESIGN (técnicas que valem em toda lâmina)
- Hierarquia: no máximo 3 níveis e um só ponto focal (o rei da lâmina); a headline domina, com pelo menos 3 vezes a altura do apoio, e o segundo maior elemento tem no máximo metade do primeiro.
- Grid: todos os blocos no mesmo eixo e na mesma margem; texto do mesmo assunto agrupado e blocos diferentes bem afastados; pelo menos 30% da arte em respiro ou fundo calmo.
- Profundidade: foto e texto na mesma cena, em planos (fundo, texto, sujeito), com recorte intencional, uma luz coerente e as cores da foto puxadas para a paleta; objeto recortado pousa com sombra de contato, sem halo nem caixa.
- Leitura: texto só sobre área calma e uniforme da foto, painel sólido do grid ou gradiente local suave; contraste forte, legível até em preto e branco e no tamanho da miniatura do feed.
- Letras nítidas e íntegras, no máximo 2 famílias, sem esticar, sem contorno, sem sombra pesada, nada justificado nem hifenizado; acentos do português exatos (ã, õ, ç, é, ê, á, ó); nenhuma palavra sozinha na última linha.
- Cor: paleta da marca em 60-30-10; a cor de destaque (até 10% da área) só na palavra-chave, no número ou no CTA.
- Acabamento de agência premium: foto real do nicho, pele, mãos e rostos naturais, sombras coerentes, grão sutil só se o estilo pedir.
PROIBIDO
- Nenhum texto além do texto exato e das letras da própria logo oficial: sem o nome da marca escrito fora da logo, site, telefone, @, hashtag, preço, data, marca d'água, legenda ou letras de enfeite.
- Nenhuma logo ou marca de outra empresa, pessoa a mais, objeto solto sem função, ícone de banco de imagens ou elemento repetido ou duplicado; os objetos de apoio são só os que a cena pede ou teria naturalmente.
- Pessoas com anatomia correta e natural: cabeça alinhada ao corpo, pescoço natural, cinco dedos em cada mão, mãos segurando os objetos de um jeito possível, braços e pernas inteiros e na proporção certa.
- Sem moldura, borda, contorno ou cantos arredondados em volta da arte; o fundo vai até a borda. Faixas e formas gráficas só as do layout da marca.
- Não escureça a imagem para criar destaque. Evite: tudo centralizado e do mesmo tamanho, faixa preta genérica, gradiente roxo e azul, neon, brilho, 3D plástico, ícones de banco.
- Não copie o texto das outras lâminas da série.
- Sem travessão no texto.

REGRAS FINAIS (valem sobre tudo acima)
- Arte final completa numa imagem só. Todo o texto é desenhado pela própria arte, integrado à composição, nunca uma caixa de texto solta por cima da imagem.
- Escreva exatamente este texto, com a mesma grafia e acentuação, e nenhum outro texto: "Seu orçamento parece
uma lista de tarefas?"
- Logo: a oficial anexada, idêntica ao anexo, no tamanho do bloco LOGO (nunca pequenininha), sem caixa atrás. Uma logo só.
- Imagens anexadas, na ordem (use cada uma só para o que a legenda dela diz; nada delas entra na arte além disso): imagem 2: LOGO OFICIAL da marca (as letras dizem "Aceleriq"): reproduza exatamente esta logo, com todas as letras, o símbolo, as cores e a proporção; não redesenhe, não invente símbolo e não ponha caixa ou retângulo atrás dela. Ela está sobre um fundo cinza-escuro liso SÓ para você enxergar as partes claras; esse fundo não faz parte da logo e não vai para a arte.; imagem 3: amostra da fonte Citrica (titulo): siga o desenho destas letras.
```

## Anúncio: criativo único feed 4:5

Mesa Ads; zona segura e regras do criativo da base de anúncios.

Tamanho: 11702 caracteres.

```text
ARTE FINAL de criativo de anúncio para tráfego pago na Meta (Facebook e Instagram), formato Feed 4:5 (1080 x 1350). Uma peça só, com uma mensagem só: parar a rolagem da pessoa certa, fazer entender a oferta em 1 segundo e levar à ação.
Conceito do conjunto: Transformar a proposta em uma página que deixa de ser uma lista de entregas e passa a mostrar o raciocínio por trás delas.
Em conflito entre regras, vale nesta ordem: o texto exato, a logo oficial no tamanho pedido, as cores e as fontes da marca, a composição e o acabamento.
1. IMAGEM E COMPOSIÇÃO
- Imagem: Vista oblíqua próxima de uma proposta impressa ocupando a metade inferior da mesa; uma mão segura a página com linhas de tarefas sem texto legível. Um fio verde sai da lista e segue em direção à borda direita.
- CRIATIVO QUE PARA A ROLAGEM: headline curta e grande, em peso black, com a palavra-chave na cor de destaque; um elemento visual forte e inesperado ligado à oferta (escala grande, recorte ousado, produto ou serviço em ação, rosto ou olhar para a câmera); contraste pela escala e pela cor de destaque, legível na tela do celular. Nada competindo com a headline.
- O sujeito da foto fica do lado oposto à área do texto (topo esquerda); essa área é calma e uniforme na própria foto (parede, céu, sombra, fundo desfocado) ou recebe um painel da paleta alinhado ao grid.
- Ponto focal: Headline grande no alto à esquerda; a folha inclinada abaixo reforça a ideia de lista.
- Fundo: Mesa clara com área uniforme no topo para o título (cor dominante #F7F7F7).
- Tratamento: Foto integrada com perspectiva diagonal, recorte próximo e fio verde conectando a lista à saída pela direita.
- Estilo visual da marca, obrigatório: As artes usam fotografias ou cenas fotorrealistas de contexto profissional, como escritório, celular, notebook e materiais de trabalho. A iluminação alterna entre fundos escuros com luz de recorte e cenas claras com luz suave, mantendo contraste alto para a mensagem. (resumido para o exemplo)
2. TEXTO EXATO (escrito pela própria arte, integrado à composição; só isto, com esta grafia e acentuação, e nenhuma outra palavra)
- Área do texto: de 8% a 73% da largura e de 7% a 43% da altura do quadro, alinhamento à esquerda, todos os blocos no mesmo eixo e com a mesma margem.
- HEADLINE: "Sua proposta explica o porquê?", letra de cerca de 116 px numa arte de 1080 x 1350, peso extra negrito ou negrito, fonte Citrica, cor #111111.
- CTA: "Fale com a AcelerIQ", letra de cerca de 38 px numa arte de 1080 x 1350, peso negrito, fonte Roboto, cor #00D52B.
- A headline tem cerca de 3 vezes a altura do texto de apoio e cada linha dela ocupa cerca de 9% da altura do quadro. O apoio ocupa uma coluna de no máximo 66% da largura, com linhas de 25 a 38 caracteres.
- Headline e apoio formam um grupo, a 16 a 32 px um do outro; CTA, selo e logo ficam a pelo menos 96 px desse grupo. Entrelinha da headline de 1,0 a 1,1, sem acento encostando na linha de cima; entrelinha do apoio de 1,3 a 1,5.
3. LOGO
- Logo oficial anexada, desenhada junto com a arte e idêntica ao anexo (mesmas letras, símbolo, cores e proporção); não redesenhe nem troque por outro texto. Uma logo só.
- O que a logo é: As letras da logo formam exatamente "Aceleriq" ("Aceler" em branco #FFFFFF, "iq" em verde #00D52B), com estas maiúsculas e minúsculas. Símbolo: seta angular em traços geométricos verdes e brancos, à esquerda das letras. Cores medidas no arquivo: branco #FFFFFF, verde #00D52B.
- Tamanho: cerca de 324 x 95 px numa arte de 1080 x 1350 (30% da largura), nunca menor que 259 x 76 px: legível de longe, nunca um detalhe pequenininho.
- Lugar: faz parte da composição, alinhada ao mesmo eixo e à mesma margem do bloco de texto (acima da headline ou abaixo do apoio ou do CTA) ou no ponto que o layout pedir, dentro das margens e da zona segura, com respiro em volta; nunca no canto superior direito, nunca sobre rosto, mão ou produto.
- A logo tem letras ou partes claras: ela fica sobre uma área ESCURA da própria arte (fundo escuro, sombra, parte escura da foto), inteira, com todas as letras legíveis; nunca sobre fundo claro, onde as partes claras somem. A logo entra direto sobre a arte, sem caixa, cartão, retângulo ou fundo próprio atrás, exatamente como o desenho dela.
- O fundo desta lâmina é claro e a logo é clara: a composição tem uma parte escura para ela (uma faixa do grid de borda a borda em #111111, uma área de sombra ou um objeto escuro da cena) e a logo fica nessa parte, nunca direto no fundo claro.
4. MARCA
- Paleta (use só estas cores, na proporção 60-30-10, com um destaque único): Verde vibrante #00D52B (primária e destaque), Preto carvão #111111 (secundária e fundo), Branco suave #F7F7F7 (fundo e texto sobre), Cinza claro #E7E8E9 (fundo), Cinza médio #6B6F73 (texto secundário).
- Tipografia: títulos em Citrica, texto em Roboto. Se houver amostra da fonte anexada, siga o desenho exato das letras da amostra.
- Regras da marca: Faça: preserve a combinação de verde, preto e branco; mantenha alto contraste e hierarquia clara. Não faça: invente resultados, depoimentos, urgência ou escassez. (resumido para o exemplo)
5. FORMATO
- Arte vertical 4:5 (1080 x 1350), usando o quadro inteiro, sem bordas vazias.
- Margens de segurança (zona segura do formato): 90 px nas laterais, 100 px no topo e 107 px na base. Nenhum texto, logo, rosto ou produto encosta nelas.
CRIATIVO DE ANÚNCIO (Feed 4:5 (1080 x 1350)) para tráfego pago: o objetivo é fazer a pessoa certa parar, entender a oferta em 1 segundo e agir.

Zona segura: nada importante (texto, logo, rosto, produto) nos 6% de cima, nos 6% de baixo nem nos 6% das laterais.

ANATOMIA DO CRIATIVO ESTÁTICO DE ALTA CONVERSÃO
- Uma mensagem só por peça. Se precisa de duas, são duas peças (ou um carrossel).
- Leitura em 1 segundo no celular: headline de até 7 palavras, grande, alto contraste; texto de apoio curto.
- Hierarquia: gancho visual, headline, benefício ou prova, CTA. O olho percorre nessa ordem.
- Benefício específico e verificável, não adjetivo ("entrega em 48 h" em vez de "entrega rápida", só se for verdade).
- Prova visível quando existir: número com período, selo real, detalhe do produto, pessoa real autorizada.
- CTA escrito na peça coerente com o botão e o destino ("Chame no WhatsApp", "Veja os horários").
- Marca presente sem dominar: logo pequena, cores da marca; o produto e a situação são os protagonistas.
- Contraste que para a rolagem: escala, cor de destaque, recorte, rosto ou olhar, objeto inesperado. Nunca escurecer a foto para criar destaque.
- Pouco texto na imagem: a copy longa vai no texto do anúncio, não na arte.
- Nada importante fora da zona segura do formato.

PARAR A ROLAGEM (a peça disputa atenção com amigos, vídeos e outros anúncios)
- Um ponto focal dominante: um elemento (produto, rosto, objeto, número ou palavra) ocupa de 40% a 60% do quadro. Se tudo tem o mesmo tamanho, nada chama.
- Contraste de escala: o maior elemento é bem maior que o segundo; manchete grande, a maior coisa escrita na peça.
- Contraste de cor: fundo chapado ou foto clara e nítida e uma cor de destaque da marca (ou a complementar dela) num lugar só: a palavra-chave, o selo ou o produto.
- Contraste de valor sem escurecer: separar texto e fundo com bloco de cor sólida, recorte, contorno, sombra curta ou área limpa da foto. Proibido véu preto, gradiente escuro, vinheta ou filtro que apague a foto ou a capa.
- Tipografia pesada: peso bold ou black, poucas palavras, uma palavra de destaque em cor.
- Composição com energia: diagonal, produto saindo do quadro, sobreposição de camadas, ângulo heroico; nunca tudo centralizado e pequeno.
- Fugir do padrão do nicho: se todos mostram a fachada, mostrar o detalhe; se todos usam a mesma cor, usar a cor da marca que ninguém usa; se todos usam banco de imagem, usar foto real.
- Real vende: foto real do produto, do trabalho e da equipe, com textura, mãos, uso e contexto.
- Direto: a oferta ou o benefício aparece sem precisar de legenda; CTA escrito curto e visível.

Agressivo dentro da política: direto e impossível de ignorar, nunca enganoso. Sem elementos que imitem a interface (botão de play falso, notificação, mensagem não lida, alerta do sistema, cursor, barra de busca), sem logo, selo ou layout de terceiros, sem imagem chocante, sem foco negativo em parte do corpo. Sem texto de preço, desconto, prazo ou número que não esteja no texto exato da peça.
PADRÃO DE DESIGN (técnicas que valem em toda lâmina)
- Hierarquia: no máximo 3 níveis e um só ponto focal (o rei da lâmina); a headline domina, com pelo menos 3 vezes a altura do apoio, e o segundo maior elemento tem no máximo metade do primeiro.
- Grid: todos os blocos no mesmo eixo e na mesma margem; texto do mesmo assunto agrupado e blocos diferentes bem afastados; pelo menos 30% da arte em respiro ou fundo calmo.
- Profundidade: foto e texto na mesma cena, em planos (fundo, texto, sujeito), com recorte intencional, uma luz coerente e as cores da foto puxadas para a paleta; objeto recortado pousa com sombra de contato, sem halo nem caixa.
- Leitura: texto só sobre área calma e uniforme da foto, painel sólido do grid ou gradiente local suave; contraste forte, legível até em preto e branco e no tamanho da miniatura do feed.
- Letras nítidas e íntegras, no máximo 2 famílias, sem esticar, sem contorno, sem sombra pesada, nada justificado nem hifenizado; acentos do português exatos (ã, õ, ç, é, ê, á, ó); nenhuma palavra sozinha na última linha.
- Cor: paleta da marca em 60-30-10; a cor de destaque (até 10% da área) só na palavra-chave, no número ou no CTA.
- Acabamento de agência premium: foto real do nicho, pele, mãos e rostos naturais, sombras coerentes, grão sutil só se o estilo pedir.
PROIBIDO
- Nenhum texto além do texto exato e das letras da própria logo oficial: sem o nome da marca escrito fora da logo, site, telefone, @, hashtag, preço, data, marca d'água, legenda ou letras de enfeite.
- Nenhuma logo ou marca de outra empresa, pessoa a mais, objeto solto sem função, ícone de banco de imagens ou elemento repetido ou duplicado; os objetos de apoio são só os que a cena pede ou teria naturalmente.
- Pessoas com anatomia correta e natural: cabeça alinhada ao corpo, pescoço natural, cinco dedos em cada mão, mãos segurando os objetos de um jeito possível, braços e pernas inteiros e na proporção certa.
- Sem moldura, borda, contorno ou cantos arredondados em volta da arte; o fundo vai até a borda. Faixas e formas gráficas só as do layout da marca.
- Não escureça a imagem para criar destaque. Evite: tudo centralizado e do mesmo tamanho, faixa preta genérica, gradiente roxo e azul, neon, brilho, 3D plástico, ícones de banco.
- Sem travessão no texto.

REGRAS FINAIS (valem sobre tudo acima)
- Arte final completa numa imagem só. Todo o texto é desenhado pela própria arte, integrado à composição, nunca uma caixa de texto solta por cima da imagem.
- Escreva exatamente este texto, com a mesma grafia e acentuação, e nenhum outro texto: "Sua proposta explica o porquê?
Fale com a AcelerIQ"
- Logo: a oficial anexada, idêntica ao anexo, no tamanho do bloco LOGO (nunca pequenininha), sem caixa atrás. Uma logo só.
- Imagens anexadas, na ordem (use cada uma só para o que a legenda dela diz; nada delas entra na arte além disso): imagem 1: LOGO OFICIAL da marca (as letras dizem "Aceleriq"): reproduza exatamente esta logo, com todas as letras, o símbolo, as cores e a proporção; não redesenhe, não invente símbolo e não ponha caixa ou retângulo atrás dela. Ela está sobre um fundo cinza-escuro liso SÓ para você enxergar as partes claras; esse fundo não faz parte da logo e não vai para a arte.; imagem 2: amostra da fonte Citrica (titulo): siga o desenho destas letras.
```

## Replicar referência: lâmina final com a referência "VALE A PENA?" como molde

Imagem 1 = referência 1 (base a editar), qualidade alta. Nada da cena do diretor entra; o layout vem do molde medido.

Tamanho: 8621 caracteres.

```text
MODO REPLICAR REFERÊNCIA: esta lâmina (4 de 4) é a referência escolhida pela equipe, refeita com o texto, a marca e o assunto deste cliente. Quem olhar as duas lado a lado reconhece o mesmo layout.
A imagem 1 é a BASE A EDITAR: é a referência 1, já no quadro desta lâmina. Mantenha dela a composição, a grade, a posição e a escala de cada bloco, os elementos gráficos, o recorte e o tratamento da imagem e o espaço vazio. Troque só o que está abaixo: o texto, as cores (pelas da marca, na mesma função), as fontes, a marca dela (pela logo oficial) e o assunto.
Referência 2 (imagem 2): dela vem só o acabamento (luz, textura, tratamento de cor e os elementos gráficos); a posição e o tamanho dos blocos são os da referência 1.
LAYOUT DA REFERÊNCIA 1 (medido na imagem; é a regra de layout desta lâmina, posições em % do quadro)
- Grade: Título enorme ocupa a faixa de cima de borda a borda; pessoa centralizada da metade para baixo; textos pequenos nos quatro cantos; celulares espalhados em volta da pessoa.
- Fundo: cor lisa clara, quase branca, com leve textura de papel; na marca, #F7F7F7 no lugar de #F2F2EE.
- Assunto da referência: pessoa jovem olhando para a câmera, meio corpo, de 24% a 76% da largura e de 30% a 100% da altura do quadro, plano médio frontal, cortado pela base.
- Elementos gráficos, nos mesmos lugares e na mesma escala, com a cor trocada pela da marca na mesma função: celulares com a tela virada para a câmera, inclinados em volta da pessoa (de 4% a 96% da largura e de 35% a 85% da altura do quadro, #00D52B); fio fino horizontal separando o título da foto (de 6% a 94% da largura e de 29% a 30% da altura do quadro, #111111).
- Tratamento: Luz de estúdio suave e frontal, cores chapadas, contraste alto entre o título e o fundo; acabamento de pôster editorial.
1. TEXTO EXATO (só isto, com esta grafia e acentuação, e nenhuma outra palavra)
- HEADLINE: "FECHE COM O PRÓXIMO PASSO" no lugar do TÍTULO da referência, de 6% a 94% da largura e de 6% a 27% da altura do quadro, em CAIXA ALTA, letra maiúscula com cerca de 9.5% da altura do quadro (128 px), em cerca de 2 linhas, alinhado ao centro, fonte Citrica com o desenho da referência (sem serifa, condensada, peso black), cor #111111.
- APOIO: "Inclua etapas, dependências e próximo passo para aprovação." no lugar do TEXTO da referência, de 5% a 32% da largura e de 88% a 96% da altura do quadro, letra maiúscula com cerca de 2.1% da altura do quadro (28 px), em cerca de 3 linhas, alinhado à esquerda, fonte Roboto com o desenho da referência (sem serifa, peso regular), cor #111111.
- CTA: "SALVE PARA REVISAR SUA PRÓXIMA PROPOSTA." no lugar do TEXTO PEQUENO da referência, de 5% a 30% da largura e de 2% a 5% da altura do quadro, em CAIXA ALTA, letra maiúscula com cerca de 2.1% da altura do quadro (28 px), alinhado à esquerda, fonte Roboto com o desenho da referência (sem serifa, peso medio), cor #111111; o texto é maior que o da referência: use mais linhas (cerca de 3) crescendo a partir desse lugar, no mesmo alinhamento, sem invadir o título nem o assunto.
- Blocos de texto da referência sem texto nesta lâmina (texto pequeno em de 70% a 95% da largura e de 2% a 5% da altura do quadro): ficam sem texto nenhum; o espaço continua vazio ou com o elemento gráfico da referência.
- Entrelinha dos títulos de 1,0 a 1,1, sem acento encostando na linha de cima; nenhuma letra cortada nem deformada.
2. LOGO
- Logo oficial anexada, desenhada junto com a arte e idêntica ao anexo (mesmas letras, símbolo, cores e proporção); não redesenhe nem troque por outro texto. Uma logo só.
- O que a logo é: As letras da logo formam exatamente "Aceleriq" ("Aceler" em branco #FFFFFF, "iq" em verde #00D52B), com estas maiúsculas e minúsculas. Símbolo: seta angular em traços geométricos verdes e brancos, à esquerda das letras. Cores medidas no arquivo: branco #FFFFFF, verde #00D52B.
- Tamanho: cerca de 324 x 95 px numa arte de 1080 x 1350 (30% da largura), nunca menor que 259 x 76 px: legível de longe, nunca um detalhe pequenininho.
- Lugar: onde a referência põe a marca dela (de 70% a 95% da largura e de 92% a 96% da altura do quadro), dentro das margens. A referência só orienta o lugar: a logo fica no tamanho acima, nunca menor.
- A logo tem letras ou partes claras: ela fica sobre uma área ESCURA da própria arte (fundo escuro, sombra, parte escura da foto), inteira, com todas as letras legíveis; nunca sobre fundo claro, onde as partes claras somem. A logo entra direto sobre a arte, sem caixa, cartão, retângulo ou fundo próprio atrás, exatamente como o desenho dela.
- O fundo desta lâmina é claro e a logo é clara: a composição tem uma parte escura para ela (uma faixa do grid de borda a borda em #111111, uma área de sombra ou um objeto escuro da cena) e a logo fica nessa parte, nunca direto no fundo claro.
- A logo é a imagem 3; a marca, o nome e o site da referência não entram.
3. MARCA
- Paleta (só estas cores, cada uma na função que a cor equivalente tem na referência: fundo por fundo, título por título, destaque por destaque): Verde vibrante #00D52B (primária e destaque), Preto carvão #111111 (secundária e fundo), Branco suave #F7F7F7 (fundo e texto sobre), Cinza claro #E7E8E9 (fundo), Cinza médio #6B6F73 (texto secundário).
- O que é colorido e chama atenção na referência (título colorido, faixa, seta, botão) fica em #00D52B ou na cor da marca de mesma função, sempre legível.
- Fontes da marca: títulos em Citrica, texto em Roboto, com o peso, a largura (condensada, normal) e a escala do texto equivalente da referência. Se houver amostra da fonte anexada, siga o desenho das letras dela.
- Regras da marca: Faça: preserve a combinação de verde, preto e branco; mantenha alto contraste e hierarquia clara. Não faça: invente resultados, depoimentos, urgência ou escassez. (resumido para o exemplo)
4. ASSUNTO
- Pessoa: outra pessoa (nunca a da referência), com a mesma pose, enquadramento, escala e luz, roupa neutra e sem marcas.
- Não copie da referência: o texto, a logo, o nome ou o site de outra marca, marcas d'água e as pessoas dela.
5. FORMATO
- Arte 1080 x 1350, usando o quadro inteiro, sem bordas vazias. Margens de segurança: 90 px nas laterais, 100 px no topo e 107 px na base. Onde a referência encosta texto ou logo na borda, aproxime do lugar dela sem passar da margem.
PROIBIDO
- Nenhum texto além do texto exato e das letras da própria logo oficial: sem o nome da marca escrito fora da logo, site, telefone, @, hashtag, preço, data, marca d'água, legenda ou letras de enfeite.
- Nenhuma logo ou marca de outra empresa, pessoa a mais, objeto solto sem função, ícone de banco de imagens ou elemento repetido ou duplicado; os objetos de apoio são só os que a cena pede ou teria naturalmente.
- Pessoas com anatomia correta e natural: cabeça alinhada ao corpo, pescoço natural, cinco dedos em cada mão, mãos segurando os objetos de um jeito possível, braços e pernas inteiros e na proporção certa.
- Sem moldura, borda, contorno ou cantos arredondados em volta da arte; o fundo vai até a borda. Faixas e formas gráficas só as da referência, nas cores da marca.
- Não escureça a imagem para criar destaque. Evite: neon, brilho, 3D plástico, gradiente roxo e azul que a referência não tenha.
- Não copie o texto das outras lâminas da série.
- Sem travessão no texto.

REGRAS FINAIS (valem sobre tudo acima)
- Arte final completa numa imagem só. Todo o texto é desenhado pela própria arte, integrado à composição, nunca uma caixa de texto solta por cima da imagem.
- Escreva exatamente este texto, com a mesma grafia e acentuação, e nenhum outro texto: "FECHE COM O PRÓXIMO PASSO
Inclua etapas, dependências e próximo passo para aprovação.
SALVE PARA REVISAR SUA PRÓXIMA PROPOSTA."
- Logo: a oficial anexada, idêntica ao anexo, no tamanho do bloco LOGO (nunca pequenininha), sem caixa atrás. Uma logo só.
- Imagens anexadas, na ordem (use cada uma só para o que a legenda dela diz; nada delas entra na arte além disso): imagem 1: REFERÊNCIA 1 escolhida pela equipe: o molde desta lâmina (layout, grade, escala e posição de cada bloco); imagem 2: REFERÊNCIA 2 escolhida pela equipe: só o acabamento (luz, textura, tratamento de cor e elementos gráficos); imagem 3: LOGO OFICIAL da marca (as letras dizem "Aceleriq"): reproduza exatamente esta logo, com todas as letras, o símbolo, as cores e a proporção; não redesenhe, não invente símbolo e não ponha caixa ou retângulo atrás dela. Ela está sobre um fundo cinza-escuro liso SÓ para você enxergar as partes claras; esse fundo não faz parte da logo e não vai para a arte.; imagem 4: amostra da fonte Citrica (titulo): siga o desenho destas letras.
```
