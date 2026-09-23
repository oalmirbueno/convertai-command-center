# Referências globais de composição (quadro do Pinterest do Thiago Rodrigues)

- Quadro: "Referências de Composição Visual", de Thiago Rodrigues (thiagorodri), descrito como "atualizado diariamente desde 2020". URL: https://br.pinterest.com/thiagorodri/refer%C3%AAncias-de-composi%C3%A7%C3%A3o-visual/
- Dono: o mesmo professor das aulas de técnicas (`videos/tecnicas-*.md`). No fim da aula "Recursos e Técnicas de Design, parte 2" ele indica este quadro como a coleção de referências de composição do curso. Ou seja, o quadro é a curadoria prática do que ele ensina.
- Dados por peça: `referencias-globais.json` (pin_url, imagem_url, arquivo_local, título, leitura de técnica, tags).
- Coletado em 2026-09-23.

## Como foi coletado e limite da amostra

- O quadro tem **1.638 pins**. Sem login, só os **25 pins mais recentes** ficam acessíveis (24 imagens únicas: os pins 9 e 10 são a mesma arte salva duas vezes).
- Caminho usado: (a) HTML público da página com o JSON embutido `__PWS_DATA__` (25 pins com URLs em `i.pinimg.com/originals`); (b) RSS público do quadro (26 itens, os mesmos 25 mais um item vazio); (c) navegador do app sem login: carregou os mesmos 24 a 25 pins e, ao rolar, abriu o modal "Que bom ter você no Pinterest" pedindo login. A coleta parou aí, sem login, sem aceitar termos e sem contornar o bloqueio.
- Todas as 25 imagens foram baixadas no tamanho original e olhadas uma a uma.
- Consequência: os padrões abaixo refletem a fase recente do quadro (peças de 2025 e 2026, muitas feitas para Instagram). Para ampliar a amostra, alguém com conta no Pinterest pode colar links de pins no fluxo de referências do cliente, ou a leitura pode ser refeita com uma sessão autorizada.

## O que o dono considera boa composição (padrões recorrentes)

1. **Um gesto visual forte por peça.** Quase toda peça se resume a uma ideia visual que dá para descrever numa frase: a pista que organiza o pôster, o raio que vira janela, o painel de vidro que esconde metade do rosto, a palavra que derrete. Nada de somar recursos.
2. **Foto integrada ao design, não foto com texto em cima.** A foto recebe uma intervenção que a transforma: grid por cima, painel fosco, fatiamento em faixas, tabuleiro, máscara, meio-tom. 15 das 24 imagens têm pessoas, e em nenhuma a foto aparece "crua" com um título colado.
3. **Recorte agressivo.** Rostos cortados nos olhos, no topo da cabeça, pela metade; sujeitos sangrando pelas bordas; detalhes no lugar do todo. Pelo menos 6 peças usam recorte extremo, fatiado ou em faixas.
4. **Profundidade por planos.** Texto atrás do sujeito, objeto na frente das letras, frente nítida e fundo desfocado, sombra real sobre fundo liso. Cria camadas sem 3D.
5. **Tipografia como imagem.** Em cerca de um terço das peças o texto é a figura principal: letras gigantes condensadas, palavra repetida em profundidade, espiral caligráfica, palavra que se distorce ou derrete.
6. **Paleta curtíssima.** Cerca de 20 das 24 imagens trabalham com 2 ou 3 cores. O padrão mais frequente é foto neutra (PB, dessaturada ou monocromática) com **uma cor saturada de destaque**: laranja, vermelho, amarelo neon, verde limão, ciano, azul elétrico.
7. **Cor da marca como sinal.** Quando há informação (calendário, placar, lista), a cor da marca marca o que importa (dias de destaque, meia palavra do título, linha que contorna a figura).
8. **Estrutura visível ou firme.** Grids aparentes com metadados nos cantos, faixas horizontais, cápsulas empilhadas, colunas de informação. Mesmo as peças livres respeitam margens claras e alinhamentos.
9. **Metáfora visual.** Várias peças contam a ideia pela forma: forma como janela (dupla exposição), texto que faz o que diz, objeto simbólico (mão rachada e borboleta, mãos da Criação).
10. **Acabamento com textura de impressão.** Grão, meio-tom, xerox e papel aparecem em 8 peças, sempre ligados ao tom (esporte, street, editorial, música).
11. **Hierarquia clara e texto curto.** Título de 1 a 6 palavras, apoio pequeno, rodapé discreto com marca, URL ou créditos. Texto corrido, quando existe, é minúsculo e serve de textura editorial.
12. **Espaço negativo com coragem.** Pôsteres de filme e peças minimalistas deixam metade do quadro vazia (fundo preto ou claro) para o foco respirar.

## Frequência das principais tags (24 imagens únicas)

| Tag | Peças | Tag | Peças |
|---|---|---|---|
| foto-integrada | 8 | metafora-visual | 5 |
| minimalista | 7 | tipografia-grande | 5 |
| recorte / recorte-extremo | 6 | cor-unica-destaque | 4 |
| halftone / textura-grao / textura-xerox / textura-papel | 8 | esporte | 4 |
| faixas-horizontais / faixa-horizontal | 4 | painel-sobre-foto / glassmorphism | 5 |
| texto-atras-do-sujeito / texto-sobre-sujeito | 5 | grid-visivel / grid-rigido / grid-assimetrico | 5 |
| silhueta | 3 | cor-de-marca-como-sinal | 3 |
| forma-como-janela / dupla-exposicao | 4 | numero-dominante | 2 |

## Famílias de composição encontradas (receitas)

| Família | Peças (ordem no JSON) | Receita curta |
|---|---|---|
| Faixas horizontais com recortes | 3, 13, 19 | 3 a 5 tiras empilhadas, recortes extremos (olhos), faixa central com a informação; texto em zigue-zague nas áreas vazias. |
| Painel de vidro sobre retrato | 7, 11, 21, 23 | Retrato de um lado, painel fosco cobrindo metade e desfocando o que está atrás; texto dentro do painel ou na faixa translúcida. |
| Grid aparente sobre foto | 6, 12, 20 | Linhas finas formando grade sobre o retrato; células preenchidas com a cor da marca; metadados nos cantos. |
| Texto atrás do sujeito / tipografia cenário | 8, 14, 17 | Palavra gigante em sans condensada; o sujeito ou objeto passa na frente; a palavra continua legível. |
| Forma como janela | 5, 22 | Símbolo grande (mão, raio) recortado no fundo escuro; dentro dele, a cena ou o rosto em uma cor. |
| Forma como estrutura | 4, 18 | Um elemento gráfico (pista, mãos) organiza o quadro; o título fica dentro dele ou no vão de tensão. |
| Texto que faz o que diz | 16, 25, 15 | Só tipografia (ou quase): a palavra derrete, se repete em profundidade ou gira em espiral. |
| Informação em grid rígido | 2, 9 | Calendário ou lista de cápsulas sobre foto escurecida; cor da marca destaca o que importa. |
| Foco seletivo com cor única | 1, 24 | Figura granulada ou em meio-tom; só um elemento nítido e colorido (produto ou marca). |

## Como o diretor de arte usa este banco

- **Escolha de referência:** para cada lâmina, buscar no JSON pelas tags da técnica protagonista (ex.: `texto-atras-do-sujeito`, `faixas-horizontais`, `forma-como-janela`) e enviar ao gerador até 4 imagens locais como referência de composição, nunca de conteúdo.
- **Nunca copiar marca, pessoa ou texto das referências.** Elas mostram estrutura (onde fica o foco, como o texto se integra), não identidade. A identidade vem do kit do cliente.
- **Traduzir a leitura em frase de prompt:** cada `leitura` já descreve posição, plano, escala e cor; o diretor adapta para o assunto do cliente usando as frases prontas de `videos/tecnicas-sintese.md`.
- **Adequar ao nicho:** as peças do quadro são, em boa parte, de esporte, cinema, moda e agência. Para nichos sóbrios (saúde, jurídico, contábil), usar as famílias mais calmas: painel de vidro, grid aparente, foco seletivo, forma como estrutura; evitar colagem, xerox e texto derretendo.

## Índice rápido

| # | Título | Tags principais |
|---|---|---|
| 1 | Pôster Oakley com figura granulada | cor-unica-destaque, silhueta, textura |
| 2 | Calendário de eventos Start21 | grid-rigido, numero-dominante, cor-de-marca-como-sinal |
| 3 | Pôster expressivo sobre olhos | colagem, faixas-horizontais, bicromia |
| 4 | Porsche 24h de Daytona | metafora-visual, forma-como-estrutura, texto-integrado |
| 5 | Night of the Living Dead | dupla-exposicao, forma-como-janela, espaco-negativo |
| 6 | "Successfully placed" | grid-visivel, profundidade-por-planos, blocos-de-cor |
| 7 | "How We Scale" | faixa-horizontal, silhueta, mix-serifa-sans |
| 8 | Vans, colagem editorial | texto-atras-do-sujeito, colagem, textura-xerox |
| 9 | "Starting Five" (Dayton) | lista-em-capsulas, quebra-de-moldura, zigue-zague |
| 10 | Mesma arte do 9 | idem |
| 11 | "New supplement is here" | painel-sobre-foto, glassmorphism |
| 12 | "Content without positioning is just noise" | grid-visivel, alternancia-de-pesos, metadados |
| 13 | Matchday Hull City x Manchester United | faixas-horizontais, recorte-extremo, halftone |
| 14 | "Go slower or you might miss the details" | tipografia-grande, refracao-vidro, diagonal |
| 15 | Homem-Aranha em espiral caligráfica | tipografia-como-forma, composicao-radial |
| 16 | "Let it go" | texto-que-faz-o-que-diz, textura-papel |
| 17 | "EVOLVE" | texto-atras-do-sujeito, profundidade-por-planos, layout-editorial |
| 18 | "Renaissance" | halftone, texto-no-espaco-de-tensao, simetria |
| 19 | "3 days to go" | faixas-horizontais, numero-dominante, zigue-zague |
| 20 | Andre Power no ADE | grid-rigido, duotone, foto-fatiada |
| 21 | "Who are you?" | texto-partido-pelo-sujeito, painel-sobre-foto |
| 22 | Harry Potter, raio como janela | simbolo-como-mascara, cor-unica-destaque |
| 23 | XTB "Keberanian" | painel-sobre-foto, palavra-chave-dominante, linha-de-marca |
| 24 | IRONWRATH | halftone, cor-neon, marcas-de-canto |
| 25 | "FOCUS" | tipografia-repetida, profundidade-por-escala |
