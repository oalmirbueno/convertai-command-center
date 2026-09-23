# Biblioteca de fontes do estúdio

Catálogo das fontes que o diretor de arte da Mesa do Cliente pode usar nos cards. Cada família tem categoria, personalidade, usos, nichos, licença, suporte ao português, arquivos e uma amostra PNG (1080x1350) que vai junto para o gerador de imagem como referência visual.

Onde estão os dados:

- Catálogo completo (JSON): `C:\Users\Usuario\AppData\Local\Temp\claude\fontes\catalogo.json`
- Amostras PNG: `C:\Users\Usuario\AppData\Local\Temp\claude\fontes\amostras\<slug>.png`
- Arquivos de fonte extraídos de `Fontes.zip`: `C:\Users\Usuario\AppData\Local\Temp\claude\fontes\extraidas`

Esses caminhos ficam na pasta temporária do Windows. Antes de ligar o catálogo ao painel, copie `catalogo.json`, `amostras/` e os arquivos das famílias aptas para um armazenamento definitivo e atualize os caminhos.

## Números da biblioteca

- 2035 arquivos de fonte no zip (.ttf, .otf, .woff, .woff2), muitos repetidos em mais de um formato.
- 567 famílias catalogadas. 17 conjuntos de ícones e ornamentos puros ficaram de fora (Font Awesome, Entypo, Foundicons, Segoe UI Emoji e similares).
- 267 famílias aptas para uso em cliente (campo `apta: true`).
- 224 famílias sem todos os acentos do português (á é í ó ú â ê ô ã õ ç À).
- Uso comercial no catálogo inteiro: 65 liberado, 415 a verificar, 87 não permitido.
- Uso comercial entre as aptas: 58 liberado, 209 a verificar.

## Regras gerais para o diretor de arte

1. Escolha só famílias com `apta: true`. As outras têm pelo menos um problema grave listado em `restricoes` (sem acento do português, marca d'água de demo nos números, licença só pessoal, conjunto incompleto ou acabamento amador).
2. Licença: prefira `uso_comercial: liberado` (SIL OFL, Apache e licenças livres declaradas). `verificar` quer dizer que a fonte é comercial ou de autor independente e a licença não veio na pasta: só use depois que o dono confirmar a compra ou a licença. Nunca use `não permitido`.
3. No máximo duas famílias por peça: uma para título e outra para texto. Uma terceira só entra se for script de destaque em uma a três palavras.
4. Crie hierarquia primeiro com peso e tamanho dentro da mesma família. Só traga a segunda família quando o contraste pedir outra estrutura.
5. Combine estruturas diferentes: serifa com sans, condensada com proporção normal, script com sans limpa. Evite duas display juntas, duas scripts juntas ou duas sans geométricas parecidas.
6. Script e manuscrita só em destaque curto ou assinatura. Nunca em texto corrido, nunca em caixa-alta, nunca menor que cerca de 48 px no card de 1080 px.
7. Texto corrido pede família com `texto corrido` nos usos (regular e negrito, boa leitura). No card 1080x1350, texto com no mínimo 28 px e linhas de até 40 caracteres.
8. Preço e número grande: use família com `destaque/número` nos usos. Condensadas (Bebas Neue, Oswald, Antonio, League Gothic) rendem bem em preço.
9. Família com `so_maiusculas: true` só aceita texto em caixa-alta.
10. Mande ao gerador a amostra PNG (`amostra_local`) de cada família escolhida e diga qual peso usar em cada linha. Se a peça usa um peso que não aparece na amostra, consulte o campo `arquivos`.
11. Legibilidade no celular vence estilo: se o título não se lê em miniatura no feed, troque a família ou aumente o peso.

Nas tabelas abaixo, (¹) marca família cuja licença comercial precisa ser verificada antes do uso.

## Regras de escolha por nicho

| Nicho | Título | Texto | Destaque | Evitar |
|---|---|---|---|---|
| Jurídico, contabilidade e consultoria | Sorts Mill Goudy, Forum, Calluna (¹), Alegreya Sans SC | Source Sans, PT Sans, Lato | Roboto Slab | script casual, display infantil, grunge, fontes arredondadas |
| Saúde, clínicas e odontologia | Montserrat, Quicksand, Museo Sans (¹) | Open Sans, Source Sans, Lato | Varela | gótica, grunge, pincel agressivo, didone muito dramática |
| Gastronomia e restaurantes | Lobster, Abril Fatface, ITC Benguiat (¹), Pacifico | Aleo, Bitter, Lato | Hipster Script (¹), DJB Chalk It Up (¹) | sans técnicas e futuristas, fontes finas demais sobre foto de comida |
| Hamburgueria, bar e cervejaria | Bebas Neue, Swiss 721 Black Condensed (¹), Lobster, Old Press (¹) | Roboto, Aleo, Oswald | Hipster Script (¹), Antonio | script romântica, serifas delicadas, arredondadas infantis |
| Cafeteria, confeitaria e doceria | Pacifico, Dancing Script, Amatic SC, Fredoka One | Quicksand, Lato, Aleo | Great Vibes, Indie Flower | condensadas pesadas, estêncil, técnicas |
| Tecnologia, startups e SaaS | Montserrat, Poppins, Exo, Kanit | Roboto, Titillium, Source Sans | Orbitron, Antonio | script, serifas vintage, display desenhada à mão |
| Moda e varejo de roupas | Abril Fatface, Bodoni XT (¹), Raleway, Bebas Neue | Raleway, Montserrat, Lato | Great Vibes, Janes Smith (¹) | quadrinhos, infantil, pixel |
| Varejo popular, ofertas e promoções | Bebas Neue, League Gothic, Oswald, Luckiest Guy | Roboto, Open Sans, PT Sans | Antonio, Swiss 721 Black Condensed (¹) | fontes finas e leves no preço, didone, script fina |
| Luxo, joalheria e alto padrão | Bodoni XT (¹), Forum, Viceroy, Shango (¹) | Raleway, Montserrat, Lato | Great Vibes, Alex Brush | pesadas, grunge, quadrinhos, arredondadas |
| Infantil, festas e brinquedos | Fredoka One, Sniglet, Finger Paint, Good Dog (¹) | Quicksand, Varela, Gotham Rounded (¹) | Indie Flower, Baloo Bhaijaan | gótica, didone, condensadas agressivas |
| Construção, reforma e indústria | Oswald, Bebas Neue, Roboto Slab, Oswald Stencil | Roboto, Source Sans, PT Sans | Antonio | script, arredondadas infantis, serifas delicadas |
| Beleza, estética e salão | Raleway, Abril Fatface, Quesha (¹), Montserrat | Lato, Montserrat, Raleway | Great Vibes, Alex Brush, Dancing Script | pesadas, grunge, estêncil, técnicas |
| Educação, cursos e escolas | Poppins, Aleo, Bitter, Montserrat | Open Sans, PT Sans, Source Sans | Learning Curve (¹), DJB Chalk It Up (¹) | gótica, grunge, script ilegível em texto |
| Esportes, academia e suplementos | Oswald, League Gothic, Bebas Neue, Swiss 721 Black Condensed (¹) | Roboto, Titillium, Source Sans | Antonio, Kaiya Land (¹) | script romântica, serifas delicadas, fontes finas |
| Imobiliário e arquitetura | Montserrat, Raleway, Forum, Termina (¹) | Lato, Source Sans, Raleway | Antonio | quadrinhos, infantil, grunge |
| Finanças, seguros e corporativo | Montserrat, Roboto Slab, Lato, Gotham (¹) | Source Sans, Roboto, Lato | Antonio | script, display desenhada à mão, grunge |
| Pet shop e veterinária | Fredoka One, Quicksand, Baloo Bhaijaan | Quicksand, Open Sans, Varela | Indie Flower, Pacifico | gótica, didone, estêncil |
| Casamento, eventos e cerimonial | Great Vibes, Alex Brush, Sorts Mill Goudy, Forum | Raleway, Lato, Montserrat | Great Vibes | condensadas pesadas, quadrinhos, técnicas |
| Automotivo, oficina e motos | Exo, Oswald, Titillium, Swiss 721 Black Condensed (¹) | Roboto, Titillium, Source Sans | Orbitron, Antonio | script delicada, arredondadas infantis, serifas clássicas |
| Bem-estar, yoga e terapias | Raleway, Quicksand, Caviar Dreams | Lato, Quicksand, Open Sans | Dancing Script, Hide Away (¹) | pesadas, grunge, condensadas agressivas |

Quando o nicho do cliente não estiver na lista, filtre o catálogo pelo campo `nichos` e pela personalidade da marca, e escolha a família de texto entre os pareamentos da família de título.

## Regras de escolha por personalidade de marca

| Personalidade da marca | Categorias que combinam | Famílias sugeridas | Evitar |
|---|---|---|---|
| Sofisticada e elegante | serifada moderna/didone, serifada clássica elegante, script caligráfica formal, sans geométrica leve | Abril Fatface, Bodoni XT (¹), Forum, Raleway, Great Vibes | pesadas, quadrinhos, grunge, arredondadas |
| Confiável e tradicional | serifada clássica, slab, sans humanista | Sorts Mill Goudy, Calluna (¹), Roboto Slab, Source Sans, PT Sans | script casual, display desenhada à mão |
| Moderna e tecnológica | sans geométrica, sans grotesca, técnica/futurista | Montserrat, Poppins, Exo, Titillium, Roboto | serifas vintage, script, gótica |
| Humana e acolhedora | sans humanista, sans arredondada | Open Sans, Lato, Quicksand, Alegreya Sans, Museo Sans (¹) | condensadas agressivas, didone dramática |
| Ousada e popular | condensada, sans pesada, display pesada | Bebas Neue, League Gothic, Oswald, Luckiest Guy, Antonio | fontes finas, script delicada |
| Divertida e jovem | display infantil, sans arredondada, script retrô | Fredoka One, Sniglet, Pacifico, Baloo Bhaijaan, Good Dog (¹) | didone, serifas clássicas sóbrias |
| Artesanal e autêntica | display desenhada à mão, slab, script casual | Amatic SC, DJB Chalk It Up (¹), Aleo, Indie Flower, Bitter | técnicas e futuristas |
| Retrô e nostálgica | script retrô, serifada vintage, condensada vintage | Lobster, Pacifico, ITC Benguiat (¹), Hipster Script (¹), Old Press (¹) | técnicas, geométricas frias |
| Enérgica e esportiva | condensada, display pincel, sans técnica | Oswald, League Gothic, Swiss 721 Black Condensed (¹), Titillium, Kaiya Land (¹) | script romântica, serifas delicadas |
| Romântica e delicada | script caligráfica, script monolinear, sans leve | Great Vibes, Alex Brush, Dancing Script, Raleway, Hide Away (¹) | pesadas, estêncil, grunge |
| Minimalista e arejada | sans geométrica leve, condensada leve | Raleway, Caviar Dreams, Montserrat, Pompiere, Quicksand | display ornamentada, grunge, quadrinhos |

Como ler a personalidade: o campo `personalidade` de cada família traz 4 adjetivos. Cruze esses adjetivos com o tom de voz do cliente (dossiê) e descarte famílias com adjetivos opostos ao tom (por exemplo, "barulhenta" para uma clínica, "sóbria" para uma festa infantil).

## Pareamentos recomendados

Combinações entre famílias da própria biblioteca. Cada família apta também traz 2 ou 3 pareamentos no campo `pareamentos` do catálogo.

| Título ou destaque | Texto | Bom para | Por quê |
|---|---|---|---|
| Abril Fatface | Lato | moda, beleza, editorial | A didone pesada de Abril Fatface cria um título dramático e elegante; Lato é neutra e calorosa, deixa o texto limpo sem competir com o contraste do título. |
| Bebas Neue | Open Sans | varejo, promoções, eventos | Bebas Neue é condensada e só em maiúsculas: cabe muita chamada em pouco espaço; Open Sans tem ótima leitura em tela pequena e equilibra a urgência do título. |
| Oswald | Source Sans | notícias, esportes, serviços | Oswald dá força e verticalidade ao título; Source Sans é humanista e aberta, ideal para o corpo do carrossel. |
| Montserrat | Sorts Mill Goudy | educação, editorial, consultoria | Título geométrico e firme em Montserrat com texto em serifa clássica: moderno por fora, culto e confiável por dentro. |
| Bodoni XT (¹) | Raleway | luxo, joalheria, moda | Bodoni XT traz o contraste de traço típico de revista de moda; Raleway é fina e elegante, mantém o ar sofisticado no texto. |
| Great Vibes | Raleway | casamento, beleza, confeitaria fina | Great Vibes é caligráfica e romântica, perfeita para uma palavra de destaque; Raleway em pesos leves dá o respiro que a script pede. |
| Pacifico | Quicksand | cafeteria, sorveteria, açaí | Pacifico é retrô e simpática, com cara de letreiro; Quicksand é arredondada e leve, conversa com a curva da script sem disputar. |
| Lobster | Aleo | gastronomia, hamburgueria, bar | Lobster tem espírito de letreiro de restaurante; Aleo é uma slab macia que dá sabor artesanal e boa leitura ao cardápio. |
| Roboto Slab | Roboto | tecnologia, finanças, institucional | Mesma superfamília: a versão slab dá peso ao título e a Roboto sem serifa segura o texto com métricas idênticas. |
| Exo | Titillium | tecnologia, games, automotivo | Exo tem desenho técnico e futurista para títulos; Titillium mantém a mesma linguagem técnica com leitura limpa no texto. |
| Fredoka One | Quicksand | infantil, pet, festas | Fredoka One é arredondada e gordinha, transmite alegria; Quicksand repete a curva em peso leve e deixa o texto amigável. |
| Alegreya Sans SC | Alegreya Sans | institucional, jurídico, educação | Mesma família: os versaletes da Alegreya Sans SC dão um título discreto e nobre, e a Alegreya Sans regular cuida do texto com o mesmo DNA. |
| League Gothic | PT Sans | esportes, notícias, varejo | League Gothic é estreita e alta, ótima para chamadas grandes; PT Sans é clara e compacta no corpo, sem perder personalidade. |
| Forum | Lato | luxo, jurídico, imobiliário | Forum lembra as capitulares romanas e passa tradição; Lato moderniza o conjunto e mantém o texto leve. |
| Luckiest Guy | Open Sans | promoções, games, infantil | Luckiest Guy é pesada e divertida, grita a oferta; Open Sans neutraliza o barulho e garante que o texto seja lido. |
| Dancing Script | Montserrat | confeitaria, papelaria, presentes | Dancing Script dá o toque manuscrito e afetivo; Montserrat geométrica organiza preço e informação com clareza. |
| Poppins | Bitter | educação, cursos, conteúdo | Poppins em peso forte cria títulos modernos e amigáveis; Bitter é uma slab feita para tela, confortável em parágrafos. |
| Antonio | Roboto | varejo, preço, promoções | Antonio é condensada e forte, ótima para números e preços grandes; Roboto dá o texto objetivo das condições da oferta. |
| Montserrat Alternates | Montserrat | moda, design, cafeteria | Mesma família: as alternativas trazem letras curiosas para o título e a Montserrat regular mantém o texto sóbrio. |
| Orbitron | Exo | games, eletrônicos, tecnologia | Orbitron é quadrada e sci-fi, feita para títulos curtos; Exo segue a mesma estética técnica, mas lê bem em frases mais longas. |
| Abril Fatface | Raleway | beleza, estética, moda | Didone pesada no título e geométrica fina no texto: contraste de peso e de estrutura que parece capa de revista. |
| Bebas Neue | Dancing Script | varejo de moda, lojas, promoções | Bebas Neue organiza a chamada em bloco; uma palavra em Dancing Script por cima quebra a rigidez e humaniza a peça. |

## Famílias aptas

| Família | Categoria | Pesos | Uso comercial | Usos | Nichos |
|---|---|---|---|---|---|
| Amatic SC | condensada (desenhada à mão) | 400, 700 | liberado | título de impacto, destaque/número | cafeteria, artesanato, papelaria, eventos |
| Antonio | condensada | 300, 400, 700 | liberado | título de impacto, subtítulo, destaque/número | varejo popular, esportes, notícias, eventos |
| Bebas Neue | condensada | 400 | liberado | título de impacto, destaque/número | varejo popular, esportes, notícias, eventos |
| Benton Sans | condensada | 300, 500, 700 | verificar | título de impacto, subtítulo, destaque/número | varejo popular, esportes, notícias, eventos |
| Densia Sans | condensada (leve/fina) | 400 | liberado | título de impacto, destaque/número | moda, arquitetura, beleza, cultura |
| Fago Co | condensada | 400, 700 | verificar | título de impacto, subtítulo, destaque/número | varejo popular, esportes, notícias, eventos |
| finesse | condensada (desenhada à mão) | 400 | verificar | título de impacto, destaque/número | cafeteria, artesanato, papelaria, eventos |
| Give You What You Like | condensada (desenhada à mão) | 400 | verificar | título de impacto, destaque/número | cafeteria, artesanato, papelaria, eventos |
| Labtop Unicase | condensada (técnica/futurista) | 400, 700 | verificar | título de impacto, subtítulo, destaque/número | tecnologia, indústria, automotivo |
| League Gothic | condensada | 400 | liberado | título de impacto, destaque/número | varejo popular, esportes, notícias, eventos |
| Love Story Rough | condensada (desenhada à mão) | 400 | verificar | título de impacto, destaque/número | cafeteria, artesanato, papelaria, eventos |
| Marvellous | condensada (desenhada à mão) | 250, 300, 400, 700 | verificar | título de impacto, destaque/número | cafeteria, artesanato, papelaria, eventos |
| Marvellous Serif | condensada (desenhada à mão) | 250, 300, 400, 700 | verificar | título de impacto, destaque/número | cafeteria, artesanato, papelaria, eventos |
| Mast | condensada | 300, 900 | verificar | título de impacto, subtítulo, destaque/número | varejo popular, esportes, notícias, eventos |
| Old Press | condensada (vintage) | 400 | verificar | título de impacto, destaque/número | barbearia, cervejaria/bar, hamburgueria |
| Ostrich Sans | condensada | 300, 400, 500, 700, 900 | liberado | título de impacto, subtítulo, destaque/número | varejo popular, esportes, notícias, eventos |
| Oswald | condensada | 200, 300, 400, 500, 600, 700, 800 | liberado | título de impacto, subtítulo, destaque/número | varejo popular, esportes, notícias, eventos |
| Oswald Stencil | condensada (estêncil) | 700 | liberado | título de impacto, destaque/número | construção, logística, aventura, automotivo |
| Pompiere | condensada (leve/fina) | 400 | liberado | título de impacto, destaque/número | moda, arquitetura, beleza, cultura |
| PWFine | condensada (desenhada à mão) | 500 | verificar | título de impacto, destaque/número | cafeteria, artesanato, papelaria, eventos |
| survivor | condensada (desenhada à mão) | 400 | verificar | título de impacto, destaque/número | cafeteria, artesanato, papelaria, eventos |
| Swiss 721 Black Condensed | condensada (pesada/black) | 900 | verificar | título de impacto, destaque/número | varejo popular, esportes, promoções, academia |
| Voltaire | condensada | 400 | liberado | título de impacto, destaque/número | varejo popular, esportes, notícias, eventos |
| Zrnic | condensada | 400 | verificar | título de impacto, destaque/número | varejo popular, esportes, notícias, eventos |
| ADALICIA | display (desenhada à mão) | 400 | verificar | título de impacto, destaque/número | cafeteria, papelaria, infantil, artesanato |
| Before Breakfast | display (desenhada à mão) | 400 | verificar | título de impacto, destaque/número | cafeteria, papelaria, infantil, artesanato |
| Bhatoshine | display (desenhada à mão) | 400 | verificar | título de impacto, destaque/número | cafeteria, papelaria, infantil, artesanato |
| Bis Spater | display (desenhada à mão) | 400 | verificar | título de impacto, destaque/número | cafeteria, papelaria, infantil, artesanato |
| Blair Md ITC | display (elegante) | 500 | verificar | título de impacto, destaque/número | jurídico, luxo, joalheria, eventos |
| BOKEH | display (estêncil) | 400 | verificar | título de impacto, destaque/número | construção, arquitetura, logística |
| Botanica Sans | display (desenhada à mão) | 400 | verificar | título de impacto, destaque/número | cafeteria, papelaria, infantil, artesanato |
| Coco | display (art déco) | 400, 700 | verificar | título de impacto, destaque/número | eventos, coquetelaria, moda, hotelaria |
| Deco Neue | display (art déco) | 300, 500, 700 | verificar | título de impacto, destaque/número | eventos, coquetelaria, moda, hotelaria |
| DJB Chalk It Up | display (giz) | 400 | verificar | título de impacto, destaque/número | educação, cafeteria, restaurante, cardápios |
| Face Your Fears | display (grunge) | 400 | verificar | título de impacto, destaque/número | música, streetwear, games, tatuagem |
| Finger Paint | display (infantil) | 400 | liberado | título de impacto, destaque/número | infantil, brinquedos, festas, confeitaria |
| Gilligan | display (desenhada à mão) | 400 | verificar | título de impacto, destaque/número | cafeteria, papelaria, infantil, artesanato |
| Good Dog | display (infantil) | 400 | verificar | título de impacto, destaque/número | infantil, brinquedos, festas, confeitaria |
| Happy Girl | display (desenhada à mão) | 400 | verificar | título de impacto, destaque/número | cafeteria, papelaria, infantil, artesanato |
| KG Ten Thousand Reasons | display (desenhada à mão) | 400 | verificar | título de impacto, destaque/número | cafeteria, papelaria, infantil, artesanato |
| Luckiest Guy | display (quadrinhos) | 400 | liberado | título de impacto, destaque/número | games, infantil, food service, promoções |
| Madelyn | display (desenhada à mão) | 400 | verificar | título de impacto, destaque/número | cafeteria, papelaria, infantil, artesanato |
| Melissa | display (desenhada à mão) | 400 | verificar | título de impacto, destaque/número | cafeteria, papelaria, infantil, artesanato |
| Nanami | display (contorno (outline)) | 400 | verificar | título de impacto, destaque/número | eventos, infantil, varejo |
| Olive | display (desenhada à mão) | 500 | verificar | título de impacto, destaque/número | cafeteria, papelaria, infantil, artesanato |
| Oval Single | display (arredondada) | 400 | verificar | título de impacto, destaque/número | alimentação, varejo, infantil |
| Serpentine | display (desenhada à mão) | 400 | verificar | título de impacto, destaque/número | cafeteria, papelaria, infantil, artesanato |
| Sniglet | display (infantil) | 400 | liberado | título de impacto, destaque/número | infantil, brinquedos, festas, confeitaria |
| Square Font | display (técnica/futurista) | 400 | verificar | título de impacto, destaque/número | tecnologia, games, eletrônicos, eventos |
| Strawberry | display (desenhada à mão) | 400 | verificar | título de impacto, destaque/número | cafeteria, papelaria, infantil, artesanato |
| Streets of Fire | display (grunge) | 400 | verificar | título de impacto, destaque/número | música, streetwear, games, tatuagem |
| Vonique 92 | display (art déco) | 400 | verificar | título de impacto, destaque/número | eventos, coquetelaria, moda, hotelaria |
| Wachtower | display (desenhada à mão) | 400 | verificar | título de impacto, destaque/número | cafeteria, papelaria, infantil, artesanato |
| 232MKSD Round | sans geométrica (arredondada) | 200, 500, 700 | verificar | título de impacto, subtítulo, destaque/número | infantil, saúde, pet, alimentação saudável |
| Ample Soft | sans geométrica (arredondada) | 250, 300, 400, 500, 700 | verificar | título de impacto, texto corrido, subtítulo, destaque/número | infantil, saúde, pet, alimentação saudável |
| Arciform Sans | sans geométrica | 400 | verificar | texto corrido, destaque/número | tecnologia, startups, moda, arquitetura |
| Ashby | sans geométrica (retrô) | 300, 400, 500, 700, 800, 900 | verificar | título de impacto, subtítulo, destaque/número | moda, cafeteria, música, design |
| Avant Gard EF | sans geométrica | 700 | verificar | título de impacto, destaque/número | tecnologia, startups, moda, arquitetura |
| Baloo Bhaijaan | sans geométrica (arredondada) | 400 | liberado | destaque/número | infantil, saúde, pet, alimentação saudável |
| Banda | sans geométrica (leve/fina) | 400 | verificar | título de impacto, destaque/número | beleza, moda, arquitetura, decoração |
| Caviar Dreams | sans geométrica | 400, 700 | liberado | título de impacto, texto corrido, subtítulo, destaque/número | tecnologia, startups, moda, arquitetura |
| Charlevoix | sans geométrica | 250, 300, 400, 500, 700, 800, 900 | verificar | título de impacto, texto corrido, subtítulo, destaque/número | tecnologia, startups, moda, arquitetura |
| Citrica | sans geométrica | 400 | liberado | texto corrido, destaque/número | tecnologia, startups, moda, arquitetura |
| COCOGOOSE | sans geométrica (pesada/black) | 400 | verificar | título de impacto, destaque/número | varejo popular, esportes, promoções, eventos |
| Code | sans geométrica (leve/fina) | 300, 700 | verificar | título de impacto, subtítulo, destaque/número | beleza, moda, arquitetura, decoração |
| Concord | sans geométrica | 100, 250, 300, 400, 500, 700, 800 | verificar | título de impacto, texto corrido, subtítulo, destaque/número | tecnologia, startups, moda, arquitetura |
| Coves | sans geométrica | 300, 700 | verificar | título de impacto, texto corrido, subtítulo, destaque/número | tecnologia, startups, moda, arquitetura |
| Eight One | sans geométrica (retrô) | 400 | verificar | título de impacto, destaque/número | moda, cafeteria, música, design |
| Existence | sans geométrica (leve/fina) | 300 | liberado | título de impacto, destaque/número | beleza, moda, arquitetura, decoração |
| Exo | sans geométrica (técnica/futurista) | 100, 200, 300, 400, 500, 600, 700, 800, 900 | liberado | título de impacto, texto corrido, subtítulo, destaque/número | tecnologia, games, automotivo, eletrônicos |
| Fredoka One | sans geométrica (arredondada) | 400 | liberado | destaque/número | infantil, saúde, pet, alimentação saudável |
| Futura LT | sans geométrica | 200, 400, 500, 700, 800 | verificar | título de impacto, texto corrido, subtítulo, destaque/número | tecnologia, startups, moda, arquitetura |
| Gentona | sans geométrica | 250, 300, 400, 500, 600, 700, 800, 900 | verificar | título de impacto, texto corrido, subtítulo, destaque/número | tecnologia, startups, moda, arquitetura |
| Geogrotesque | sans geométrica (técnica/futurista) | 250, 275, 300, 400, 500, 600, 700 | verificar | título de impacto, texto corrido, subtítulo, destaque/número | tecnologia, games, automotivo, eletrônicos |
| Golden Sans | sans geométrica | 250, 300, 400, 500, 700, 900 | verificar | título de impacto, texto corrido, subtítulo, destaque/número | tecnologia, startups, moda, arquitetura |
| Gotham | sans geométrica | 250, 275, 300, 325, 350, 450, 500, 700, 900 | verificar | título de impacto, texto corrido, subtítulo, destaque/número | tecnologia, startups, moda, arquitetura |
| Gotham Rounded | sans geométrica (arredondada) | 300, 325, 350, 700 | verificar | título de impacto, texto corrido, subtítulo, destaque/número | infantil, saúde, pet, alimentação saudável |
| Kanit | sans geométrica | 250, 275, 300, 400, 500, 600, 700, 800, 900 | liberado | título de impacto, texto corrido, subtítulo, destaque/número | tecnologia, startups, moda, arquitetura |
| Minimal | sans geométrica (leve/fina) | 400 | verificar | título de impacto, destaque/número | beleza, moda, arquitetura, decoração |
| Montserrat | sans geométrica | 250, 275, 300, 400, 500, 600, 700, 800, 900 | liberado | título de impacto, texto corrido, subtítulo, destaque/número | tecnologia, startups, moda, arquitetura |
| Montserrat Alternates | sans geométrica (retrô) | 250, 275, 300, 400, 500, 600, 700, 800, 900 | liberado | título de impacto, subtítulo, destaque/número | moda, cafeteria, música, design |
| Mosk | sans geométrica | 250, 300, 400, 500, 600, 700, 800, 900 | verificar | título de impacto, texto corrido, subtítulo, destaque/número | tecnologia, startups, moda, arquitetura |
| Nexa | sans geométrica | 100, 300, 400, 700, 900 | verificar | título de impacto, texto corrido, subtítulo, destaque/número | tecnologia, startups, moda, arquitetura |
| Nobel | sans geométrica | 200, 300, 400, 700, 900 | verificar | título de impacto, texto corrido, subtítulo, destaque/número | tecnologia, startups, moda, arquitetura |
| Orbitron | sans geométrica (técnica/futurista) | 300, 500, 700, 900 | liberado | título de impacto, subtítulo, destaque/número | tecnologia, games, automotivo, eletrônicos |
| Panton | sans geométrica | 400, 700 | verificar | título de impacto, texto corrido, subtítulo, destaque/número | tecnologia, startups, moda, arquitetura |
| Poppins | sans geométrica | 250, 275, 300, 400, 500, 600, 700, 800, 900 | liberado | título de impacto, texto corrido, subtítulo, destaque/número | tecnologia, startups, moda, arquitetura |
| Quicksand | sans geométrica (arredondada) | 300, 400, 500, 700 | liberado | título de impacto, texto corrido, subtítulo, destaque/número | infantil, saúde, pet, alimentação saudável |
| Raleway | sans geométrica | 250, 275, 300, 400, 500, 600, 700, 800, 900 | liberado | título de impacto, texto corrido, subtítulo, destaque/número | tecnologia, startups, moda, arquitetura |
| RR Beaver | sans geométrica (pesada/black) | 400 | liberado | título de impacto, destaque/número | varejo popular, esportes, promoções, eventos |
| Sofia | sans geométrica | 250, 300, 400, 500, 600, 700, 900 | liberado | título de impacto, texto corrido, subtítulo, destaque/número | tecnologia, startups, moda, arquitetura |
| Termina | sans geométrica | 200, 250, 300, 400, 500, 600, 700, 800, 900 | verificar | título de impacto, subtítulo, destaque/número | tecnologia, startups, moda, arquitetura |
| Toma Sans | sans geométrica | 400 | verificar | texto corrido, destaque/número | tecnologia, startups, moda, arquitetura |
| Uni Sans | sans geométrica | 100, 300, 400, 600, 900 | verificar | título de impacto, texto corrido, subtítulo, destaque/número | tecnologia, startups, moda, arquitetura |
| Varela | sans geométrica | 400 | liberado | texto corrido, destaque/número | tecnologia, startups, moda, arquitetura |
| advent | sans grotesca/neo-grotesca (técnica/futurista) | 100, 200, 300, 400, 700, 800, 900 | verificar | título de impacto, texto corrido, subtítulo, destaque/número | tecnologia, games, engenharia, startups |
| Lato | sans grotesca/neo-grotesca | 100, 250, 300, 400, 500, 600, 700, 800, 900 | liberado | título de impacto, texto corrido, subtítulo, destaque/número | tecnologia, finanças, corporativo, varejo |
| Roboto | sans grotesca/neo-grotesca | 250, 300, 400, 500, 700, 900 | liberado | título de impacto, texto corrido, subtítulo, destaque/número | tecnologia, finanças, corporativo, varejo |
| Titillium | sans grotesca/neo-grotesca (técnica/futurista) | 250, 300, 400, 600, 700, 900 | liberado | título de impacto, texto corrido, subtítulo, destaque/número | tecnologia, games, engenharia, startups |
| Alegreya Sans | sans humanista | 250, 300, 400, 500, 700, 800, 900 | liberado | título de impacto, texto corrido, subtítulo, destaque/número | saúde, educação, serviços, institucional |
| Alegreya Sans SC | sans humanista (versaletes) | 250, 300, 400, 500, 700, 800, 900 | liberado | título de impacto, texto corrido, subtítulo, destaque/número | institucional, jurídico, editorial |
| Aller | sans humanista | 300, 400, 700 | verificar | título de impacto, texto corrido, subtítulo, destaque/número | saúde, educação, serviços, institucional |
| Asap | sans humanista | 700 | liberado | título de impacto, destaque/número | saúde, educação, serviços, institucional |
| Gibson | sans humanista | 400, 600 | verificar | título de impacto, texto corrido, subtítulo, destaque/número | saúde, educação, serviços, institucional |
| Istok Web | sans humanista | 400, 700 | liberado | título de impacto, texto corrido, subtítulo, destaque/número | saúde, educação, serviços, institucional |
| Junction | sans humanista | 300, 500, 700 | liberado | título de impacto, texto corrido, subtítulo, destaque/número | saúde, educação, serviços, institucional |
| Klavika CH | sans humanista (técnica/futurista) | 400, 500, 700 | verificar | título de impacto, texto corrido, subtítulo, destaque/número | tecnologia, engenharia, automotivo, indústria |
| Museo Sans | sans humanista | 250, 300, 500, 600, 900 | verificar | título de impacto, texto corrido, subtítulo, destaque/número | saúde, educação, serviços, institucional |
| Myriad | sans humanista | 300, 400 | verificar | texto corrido, subtítulo, destaque/número | saúde, educação, serviços, institucional |
| Oli Jo | sans humanista | 700 | verificar | título de impacto, destaque/número | saúde, educação, serviços, institucional |
| Open Sans | sans humanista | 300, 400, 600, 700, 800 | liberado | título de impacto, texto corrido, subtítulo, destaque/número | saúde, educação, serviços, institucional |
| Philosopher | sans humanista | 400, 700 | liberado | título de impacto, texto corrido, subtítulo, destaque/número | saúde, educação, serviços, institucional |
| PT Sans | sans humanista | 400, 700 | liberado | título de impacto, texto corrido, subtítulo, destaque/número | saúde, educação, serviços, institucional |
| Scala Sans | sans humanista | 300, 500, 700, 900 | verificar | título de impacto, texto corrido, subtítulo, destaque/número | saúde, educação, serviços, institucional |
| Segoe UI | sans humanista | 300, 350, 400, 600, 700, 900 | verificar | título de impacto, subtítulo, destaque/número | saúde, educação, serviços, institucional |
| Source Sans | sans humanista | 200, 300, 400, 600, 700, 900 | liberado | título de impacto, texto corrido, subtítulo, destaque/número | saúde, educação, serviços, institucional |
| Ubuntu | sans humanista | 300, 400, 700 | liberado | título de impacto, texto corrido, subtítulo, destaque/número | saúde, educação, serviços, institucional |
| Weekly | sans humanista | 300, 600 | verificar | título de impacto, texto corrido, subtítulo, destaque/número | saúde, educação, serviços, institucional |
| A Bientot | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Aamonoline | script/manuscrita (assinatura) | 400 | verificar | assinatura | fotografia, beleza, moda, marca pessoal |
| Absorbed | script/manuscrita (pincel (brush)) | 400 | verificar | título de impacto, assinatura | moda, beleza, food service, eventos |
| Adventure | script/manuscrita (pincel (brush)) | 400 | verificar | título de impacto, assinatura | moda, beleza, food service, eventos |
| Aesthetics | script/manuscrita (pincel (brush)) | 400 | verificar | título de impacto, assinatura | moda, beleza, food service, eventos |
| Alex Brush | script/manuscrita (caligráfica formal) | 400 | liberado | assinatura | casamento, beleza, confeitaria fina, joalheria |
| Ampera | script/manuscrita (retrô) | 400 | verificar | título de impacto, destaque/número, assinatura | hamburgueria, cafeteria, cervejaria/bar, barbearia |
| Amsterdam | script/manuscrita (pincel (brush)) | 700 | verificar | título de impacto, assinatura | moda, beleza, food service, eventos |
| Anabella | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Anemone | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Anydore | script/manuscrita (retrô) | 400 | verificar | título de impacto, destaque/número, assinatura | hamburgueria, cafeteria, cervejaria/bar, barbearia |
| arabella | script/manuscrita (caligráfica formal) | 400 | verificar | assinatura | casamento, beleza, confeitaria fina, joalheria |
| Atingle | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Autumn in November | script/manuscrita (pincel (brush)) | 400 | verificar | título de impacto, assinatura | moda, beleza, food service, eventos |
| Balmoral LET | script/manuscrita (caligráfica formal) | 400 | verificar | assinatura | casamento, beleza, confeitaria fina, joalheria |
| Barbala | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Beautiful Mess | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Beautiful Ms Gracia | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Bentley | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Beverly | script/manuscrita (pincel (brush)) | 400 | verificar | título de impacto, assinatura | moda, beleza, food service, eventos |
| Billy Ohio | script/manuscrita (pincel (brush)) | 400 | verificar | título de impacto, assinatura | moda, beleza, food service, eventos |
| Bloom Skirt | script/manuscrita (pincel (brush)) | 400 | verificar | título de impacto, assinatura | moda, beleza, food service, eventos |
| Botanica Script | script/manuscrita (pincel (brush)) | 400 | verificar | título de impacto, assinatura | moda, beleza, food service, eventos |
| Boutique Script | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Bravo | script/manuscrita (manuscrita casual) | 500 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Brightside Typeface | script/manuscrita (caligráfica formal) | 400 | verificar | assinatura | casamento, beleza, confeitaria fina, joalheria |
| Brushy | script/manuscrita (pincel (brush)) | 500 | verificar | título de impacto, assinatura | moda, beleza, food service, eventos |
| Carolina | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Challista Script | script/manuscrita (caligráfica formal) | 400 | verificar | assinatura | casamento, beleza, confeitaria fina, joalheria |
| Charmel | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| City Lights | script/manuscrita (pincel (brush)) | 400 | verificar | título de impacto, assinatura | moda, beleza, food service, eventos |
| Cretina | script/manuscrita (monolinear) | 400 | verificar | assinatura | beleza, papelaria, casamento, bem-estar |
| Cuassus | script/manuscrita (caligráfica formal) | 400 | verificar | assinatura | casamento, beleza, confeitaria fina, joalheria |
| Daily Grind | script/manuscrita (retrô) | 400 | verificar | título de impacto, destaque/número, assinatura | hamburgueria, cafeteria, cervejaria/bar, barbearia |
| Dancing Script | script/manuscrita (manuscrita casual) | 400, 700 | liberado | título de impacto, assinatura | confeitaria, papelaria, beleza, infantil |
| Debby | script/manuscrita (pincel (brush)) | 400 | verificar | título de impacto, assinatura | moda, beleza, food service, eventos |
| Deisy | script/manuscrita (manuscrita casual) | 500 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Densfort | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Desire Script | script/manuscrita (pincel (brush)) | 400 | verificar | título de impacto, assinatura | moda, beleza, food service, eventos |
| Esperance | script/manuscrita (pincel (brush)) | 400 | verificar | título de impacto, assinatura | moda, beleza, food service, eventos |
| Fabiana | script/manuscrita (pincel (brush)) | 500 | verificar | título de impacto, assinatura | moda, beleza, food service, eventos |
| featherly tall | script/manuscrita (caligráfica formal) | 400 | verificar | assinatura | casamento, beleza, confeitaria fina, joalheria |
| Fixity | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Flowergirls | script/manuscrita (caligráfica formal) | 400 | verificar | assinatura | casamento, beleza, confeitaria fina, joalheria |
| Freestyle Script | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Great Vibes | script/manuscrita (caligráfica formal) | 400 | liberado | assinatura | casamento, beleza, confeitaria fina, joalheria |
| Gumdrop | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Gypsy | script/manuscrita (manuscrita casual) | 500 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Halften | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Hamster | script/manuscrita (retrô) | 400 | verificar | título de impacto, destaque/número, assinatura | hamburgueria, cafeteria, cervejaria/bar, barbearia |
| Hello August | script/manuscrita (pincel (brush)) | 500 | verificar | título de impacto, assinatura | moda, beleza, food service, eventos |
| Hide Away | script/manuscrita (monolinear) | 400, 800 | verificar | título de impacto, assinatura | beleza, papelaria, casamento, bem-estar |
| Hipster Script | script/manuscrita (retrô) | 400 | verificar | título de impacto, destaque/número, assinatura | hamburgueria, cafeteria, cervejaria/bar, barbearia |
| Huh Girls | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Humble Hearts | script/manuscrita (monolinear) | 400 | verificar | assinatura | beleza, papelaria, casamento, bem-estar |
| illusias | script/manuscrita (caligráfica formal) | 400 | verificar | assinatura | casamento, beleza, confeitaria fina, joalheria |
| Indie Flower | script/manuscrita (manuscrita casual) | 400 | liberado | assinatura | confeitaria, papelaria, beleza, infantil |
| Instyle | script/manuscrita (manuscrita casual) | 500 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Janes Smith | script/manuscrita (assinatura) | 400 | verificar | assinatura | fotografia, beleza, moda, marca pessoal |
| Janges | script/manuscrita (caligráfica formal) | 400 | verificar | assinatura | casamento, beleza, confeitaria fina, joalheria |
| Jasper | script/manuscrita (pincel (brush)) | 500 | verificar | título de impacto, assinatura | moda, beleza, food service, eventos |
| Jherry Jill | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Johana | script/manuscrita (pincel (brush)) | 400 | verificar | título de impacto, assinatura | moda, beleza, food service, eventos |
| Joshico | script/manuscrita (retrô) | 400 | verificar | título de impacto, destaque/número, assinatura | hamburgueria, cafeteria, cervejaria/bar, barbearia |
| Just Tuesday | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Kaiya Land | script/manuscrita (pincel (brush)) | 400 | verificar | título de impacto, assinatura | moda, beleza, food service, eventos |
| Kenzo Script | script/manuscrita (pincel (brush)) | 400 | verificar | título de impacto, assinatura | moda, beleza, food service, eventos |
| Koko Kruse | script/manuscrita (manuscrita casual) | 500 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Lafesta | script/manuscrita (retrô) | 400 | verificar | título de impacto, destaque/número, assinatura | hamburgueria, cafeteria, cervejaria/bar, barbearia |
| Learning Curve | script/manuscrita (caligrafia escolar) | 400 | verificar | assinatura | educação, educação infantil, papelaria |
| Lepota | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Lobster | script/manuscrita (retrô) | 400 | liberado | título de impacto, destaque/número, assinatura | hamburgueria, cafeteria, cervejaria/bar, barbearia |
| Loreal | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Lupitta | script/manuscrita (caligráfica formal) | 400 | verificar | assinatura | casamento, beleza, confeitaria fina, joalheria |
| Majesta | script/manuscrita (pincel (brush)) | 400 | verificar | título de impacto, assinatura | moda, beleza, food service, eventos |
| Malina | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Marguerite | script/manuscrita (retrô) | 400 | verificar | título de impacto, destaque/número, assinatura | hamburgueria, cafeteria, cervejaria/bar, barbearia |
| Mark My Words | script/manuscrita (pincel (brush)) | 400 | verificar | título de impacto, assinatura | moda, beleza, food service, eventos |
| Master Of Break | script/manuscrita (pincel (brush)) | 400 | verificar | título de impacto, assinatura | moda, beleza, food service, eventos |
| Maxwell | script/manuscrita (manuscrita casual) | 500 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Mellow | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Meownella | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Mericella | script/manuscrita (pincel (brush)) | 400 | verificar | título de impacto, assinatura | moda, beleza, food service, eventos |
| Midnight Rose | script/manuscrita (assinatura) | 400 | verificar | assinatura | fotografia, beleza, moda, marca pessoal |
| Minnie | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Miss Zippy | script/manuscrita (manuscrita casual) | 500 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| ML Aareata | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| ML Dear Sister | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| ML Elusive Dream | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| ML Fortune | script/manuscrita (caligráfica formal) | 400 | verificar | assinatura | casamento, beleza, confeitaria fina, joalheria |
| ML Tasty morsel | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| ML Tokyo Aurora | script/manuscrita (monolinear) | 400, 700 | verificar | título de impacto, assinatura | beleza, papelaria, casamento, bem-estar |
| Mr Proxy | script/manuscrita (pincel (brush)) | 500 | verificar | título de impacto, assinatura | moda, beleza, food service, eventos |
| Pacifico | script/manuscrita (retrô) | 400 | liberado | título de impacto, destaque/número, assinatura | hamburgueria, cafeteria, cervejaria/bar, barbearia |
| Pamela | script/manuscrita (caligráfica formal) | 400 | verificar | assinatura | casamento, beleza, confeitaria fina, joalheria |
| Please Dont Take My Man | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Priscillia Script | script/manuscrita (pincel (brush)) | 500 | verificar | título de impacto, assinatura | moda, beleza, food service, eventos |
| Quincy | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Rebel | script/manuscrita (pincel (brush)) | 400 | verificar | título de impacto, assinatura | moda, beleza, food service, eventos |
| Rinstonia | script/manuscrita (assinatura) | 400 | verificar | assinatura | fotografia, beleza, moda, marca pessoal |
| Rose Of Baltimore | script/manuscrita (caligráfica formal) | 400 | verificar | assinatura | casamento, beleza, confeitaria fina, joalheria |
| Rwanda | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Salamander Script | script/manuscrita (caligráfica formal) | 400, 700 | verificar | título de impacto, assinatura | casamento, beleza, confeitaria fina, joalheria |
| Sanelma | script/manuscrita (retrô) | 400 | verificar | título de impacto, destaque/número, assinatura | hamburgueria, cafeteria, cervejaria/bar, barbearia |
| Sentimental | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Shadows Into | script/manuscrita (manuscrita casual) | 300 | liberado | assinatura | confeitaria, papelaria, beleza, infantil |
| Silent Night | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| silicia script | script/manuscrita (caligráfica formal) | 500 | verificar | assinatura | casamento, beleza, confeitaria fina, joalheria |
| Skylar | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Specialist | script/manuscrita (assinatura) | 500 | verificar | assinatura | fotografia, beleza, moda, marca pessoal |
| Stephanie Jane | script/manuscrita (pincel (brush)) | 400 | verificar | título de impacto, assinatura | moda, beleza, food service, eventos |
| Sticky | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Stinker | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| streetlight | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Sunset Hill | script/manuscrita (pincel (brush)) | 400 | verificar | título de impacto, assinatura | moda, beleza, food service, eventos |
| Super | script/manuscrita (manuscrita casual) | 900 | verificar | título de impacto, assinatura | confeitaria, papelaria, beleza, infantil |
| Swing MT | script/manuscrita (retrô) | 700 | verificar | título de impacto, destaque/número, assinatura | hamburgueria, cafeteria, cervejaria/bar, barbearia |
| Thank you | script/manuscrita (pincel (brush)) | 400 | verificar | título de impacto, assinatura | moda, beleza, food service, eventos |
| That's Font Folks! | script/manuscrita (retrô) | 400 | verificar | título de impacto, destaque/número, assinatura | hamburgueria, cafeteria, cervejaria/bar, barbearia |
| The Eolian | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Trust Me | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Unbossy | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Unkempt | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Vintage Beauty | script/manuscrita (manuscrita casual) | 400 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Yolanda | script/manuscrita (pincel (brush)) | 400 | verificar | título de impacto, assinatura | moda, beleza, food service, eventos |
| Zabar | script/manuscrita (manuscrita casual) | 500 | verificar | assinatura | confeitaria, papelaria, beleza, infantil |
| Balham | serifada clássica | 400 | verificar | texto corrido, destaque/número | jurídico, educação, editorial, consultoria |
| Calluna | serifada clássica | 400 | verificar | texto corrido, destaque/número | jurídico, educação, editorial, consultoria |
| Day | serifada clássica | 400 | verificar | texto corrido, destaque/número | jurídico, educação, editorial, consultoria |
| Edmundsbury Serif | serifada clássica | 400 | verificar | texto corrido, destaque/número | jurídico, educação, editorial, consultoria |
| Foglihten | serifada clássica | 500 | liberado | destaque/número | jurídico, educação, editorial, consultoria |
| Forum | serifada clássica | 400 | liberado | destaque/número | jurídico, educação, editorial, consultoria |
| ITC Benguiat | serifada clássica (vintage) | 700 | verificar | título de impacto, destaque/número | gastronomia, cervejaria/bar, barbearia, antiquário |
| Metropolis | serifada clássica | 300 | liberado | texto corrido, destaque/número | jurídico, educação, editorial, consultoria |
| Old Newspaper Types | serifada clássica (vintage) | 500 | verificar | título de impacto, destaque/número | gastronomia, cervejaria/bar, barbearia, antiquário |
| Shango | serifada clássica (elegante) | 400, 500, 700 | verificar | título de impacto, destaque/número | luxo, moda, beleza, joalheria |
| Sorts Mill Goudy | serifada clássica | 500 | liberado | destaque/número | jurídico, educação, editorial, consultoria |
| Viceroy | serifada clássica (elegante) | 400 | liberado | título de impacto, destaque/número | luxo, moda, beleza, joalheria |
| Abril Fatface | serifada moderna/didone | 400 | liberado | título de impacto, destaque/número | moda, luxo, beleza, joalheria |
| Bedini | serifada moderna/didone | 700 | verificar | título de impacto, destaque/número | moda, luxo, beleza, joalheria |
| Bodoni XT | serifada moderna/didone | 500 | verificar | título de impacto, destaque/número | moda, luxo, beleza, joalheria |
| Quesha | serifada moderna/didone | 400 | verificar | título de impacto, destaque/número | moda, luxo, beleza, joalheria |
| Voor | serifada moderna/didone | 400 | verificar | título de impacto, destaque/número | moda, luxo, beleza, joalheria |
| Aleo | slab | 300, 400, 700 | liberado | título de impacto, texto corrido, destaque/número | construção, educação, tecnologia, varejo |
| Bitter | slab | 400 | liberado | título de impacto, texto corrido, destaque/número | construção, educação, tecnologia, varejo |
| Museo | slab | 300, 400, 500 | verificar | título de impacto, texto corrido, destaque/número | construção, educação, tecnologia, varejo |
| Museo Slab | slab | 500 | verificar | título de impacto, destaque/número | construção, educação, tecnologia, varejo |
| Newslab | slab | 250, 300, 350, 400, 500, 700, 800, 900 | verificar | título de impacto, texto corrido, destaque/número | construção, educação, tecnologia, varejo |
| Roboto Slab | slab | 250, 300, 400, 700 | liberado | título de impacto, texto corrido, destaque/número | construção, educação, tecnologia, varejo |

## Famílias fora do uso em cliente

300 famílias ficaram no catálogo com `apta: false`. Motivos (uma família pode ter mais de um):

- acabamento amador ou uso muito específico; evitar em marca de cliente: 247
- não tem todos os acentos do português: 224
- licença não permite uso comercial: 87
- faltam caracteres da amostra: 73
- números ou pontuação trazem marca d'água de versão demo: 31
- conjunto de caracteres incompleto: 8
- só tem maiúsculas: 2

Lista resumida (família: primeiro motivo):

- 5seconds: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Adlanta: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Aerostat: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- After Night: não tem todos os acentos do português (Çç)
- Afterlight: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Againts: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Aivengo: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Alemeta: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Alphabet Pony: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Amazing Kids: não tem todos os acentos do português (Çç)
- Anabella Sans: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Andrea2: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Angelface: licença não permite uso comercial
- Angelica: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Anisa Sans: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Another Typewriter: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Aprikas: números ou pontuação trazem marca d'água de versão demo
- Aquino: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Arenq: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Arista: não tem todos os acentos do português (ÇÕç)
- Aron Grotesque: faltam caracteres da amostra: 0 1 2 3 4 5 6 7 8 9
- Art Plot: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Arthard: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Artypa: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Atlantica: números ou pontuação trazem marca d'água de versão demo
- Autarquica: números ou pontuação trazem marca d'água de versão demo
- Authen: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Autumn Chant: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Babycakes: acabamento amador ou uso muito específico; evitar em marca de cliente
- Bada Boom BB: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Balans: acabamento amador ou uso muito específico; evitar em marca de cliente
- Ballpark: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Barbatrick: acabamento amador ou uso muito específico; evitar em marca de cliente
- basic title font: não tem todos os acentos do português (ÀÁÃÇÉÍÕÚáâãçéêíôõú)
- Battery: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- bearer Fond: acabamento amador ou uso muito específico; evitar em marca de cliente
- Beauty and the Beast: licença não permite uso comercial
- Begonia: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Bellahana: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Black Party: não tem todos os acentos do português (Çç)
- Blanche de la Fontaine: números ou pontuação trazem marca d'água de versão demo
- Bobel: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Boycott: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Bread&Cheese: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Breathe: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Bubble Gum: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Bubbleboddy: números ou pontuação trazem marca d'água de versão demo
- Buttercup: licença não permite uso comercial
- Cartina: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Cascade: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Cassandra: faltam caracteres da amostra: $ , . :
- Cassiopea: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Caviar: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Champagne & Limousines: licença não permite uso comercial
- Chapaza: licença não permite uso comercial
- Chasing Embers: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Cheeseburger: acabamento amador ou uso muito específico; evitar em marca de cliente
- Chenier: não tem todos os acentos do português (ÃÍÓÕÚãíóõ)
- Chunk Five: não tem todos os acentos do português (Õõ)
- claws: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Coco Gothic: números ou pontuação trazem marca d'água de versão demo
- College: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Comic Block: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Contemporary: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Contento Script: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Cookies: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- cookies&milk: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Cool Sans: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Cornflower: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Cortney: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Cotasia: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Cupcake!: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- DCC Ash: não tem todos os acentos do português (ÀÃÇÕãçêõ)
- Dear Hearts: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- DHF Story Brush: não tem todos os acentos do português (ÀÃÇÍÓÕÚáâãçéêíóôõú)
- Digital-7 Mono: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Dirtyline Rising Brush: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- DIS PLAY: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Divines: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- DK The Cats Whiskers: faltam caracteres da amostra: 4
- DK Woolwich: faltam caracteres da amostra: 4 5
- Dragonfly: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Dreamboat: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Dreamers: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Dust Cloud: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Edo: faltam caracteres da amostra: $ :
- Elega: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Elianto: não tem todos os acentos do português (Çç)
- ELYS: conjunto de caracteres incompleto (faltam letras básicas)
- Elyse: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Embossed Germanica: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Emma: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Ethernal: números ou pontuação trazem marca d'água de versão demo
- Everglow: não tem todos os acentos do português (ÀÃÕ)
- Evergreen: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Fakedes Outline: acabamento amador ou uso muito específico; evitar em marca de cliente
- Fieldfare: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- FISH&CHIPS: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Flashlight: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Flintstone: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Fluted Germanica: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Foliage: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Fortunates December: faltam caracteres da amostra: $
- Freshman: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Frosty: não tem todos os acentos do português (ÀÁÃÍÓÕÚ)
- Funny Rails: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Gamer: acabamento amador ou uso muito específico; evitar em marca de cliente
- Georgina: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Gladifilthefte: faltam caracteres da amostra: $
- Goldoni: não tem todos os acentos do português (ÉÍÓÕÚéêíóôõú)
- Grocery Rounded: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Grutch Shaded: não tem todos os acentos do português (ÃÕãõ)
- Hand Originals: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Hand Typist: não tem todos os acentos do português (Çç)
- Handletter: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Happylife: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Have Faith: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- HBM Serenity: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- hellifa: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Hello Wedding: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Hey Baby: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Hi Sunshine: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Honeyflower: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Ice Age Movie Font: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Jelly Fish: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Jemmy: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Jinky: não tem todos os acentos do português (ÀÁÃÍÓÕÚ)
- Journey: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Julias Dream: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Justlove: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Kabel: faltam caracteres da amostra: $
- Ke Aloha: licença não permite uso comercial
- Kitten: números ou pontuação trazem marca d'água de versão demo
- Kiwami: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Kraft Nine: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Lackers: não tem todos os acentos do português (Çç)
- Langdon: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Langoustine: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Lauren: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Lavanda: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Lazy Monday: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- LEIXO: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Lesliecy: qualidade insuficiente
- Letra Hipster: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Liam Smith: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Lights of the Stardust: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- LIQUIDO: não tem todos os acentos do português (ÃÇÕãçõ)
- Litle Simple St: licença não permite uso comercial
- LOVE BRINGS FREEDOM: conjunto de caracteres incompleto (faltam letras básicas)
- Lovehearts: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Lovely: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Magnitude: não tem todos os acentos do português (À)
- Magnolia Sky: acabamento amador ou uso muito específico; evitar em marca de cliente
- Manteka: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Marchy Script: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Marmale: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Matryoshka: conjunto de caracteres incompleto (faltam letras básicas)
- Mayton: não tem todos os acentos do português (ÀÃÕãêõ)
- Maze: conjunto de caracteres incompleto (faltam letras básicas)
- Melina: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- mellony dry brush: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Merry Christmas Flake: licença não permite uso comercial
- Mimosa: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Miss Hippie: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Modern Magic: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Molot: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Monad: não tem todos os acentos do português (ÀÁÃÉÍÓÕÚáâãéêíóôõú)
- Mooglonk: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Moon Flower: licença não permite uso comercial
- Moonlights on the Beach: licença não permite uso comercial
- Morning: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Morracle: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Motoplatio: conjunto de caracteres incompleto (faltam letras básicas)
- Mustardo: faltam caracteres da amostra: 0 1 2 3 4 5 6 7 8 9
- Myron: não tem todos os acentos do português (Çç)
- Nevis: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Nexa Rust: números ou pontuação trazem marca d'água de versão demo
- Nightingale: licença não permite uso comercial
- Obsidian: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Old Originals: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Old Stamper: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Onevia: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Ooh Lala: faltam caracteres da amostra: .
- Originals is Out: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Paduka Script: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Painted: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Painted Paradise: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Painting in the Sunlight: licença não permite uso comercial
- Paradiso Vintage: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Paxton: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Payb Ack: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Peanut Butter Cookies: licença não permite uso comercial
- Pechenka: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Pepper mint: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- PF Din Text: licença não permite uso comercial
- Plain Germanica: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Plane Crash: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Pretty Girls Script: licença não permite uso comercial
- Prologue Script Lite: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Puzzled: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- PWCactus: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçêíóôõú)
- Quantify: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Raleigh Rock: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Razed: licença não permite uso comercial
- Reconsider: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Respective: licença não permite uso comercial
- Retro slab serif: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Riverhack: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Roselina Script: não tem todos os acentos do português (À)
- Ruffle Beauty: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Rumba: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Sadhira: licença não permite uso comercial
- Safina: acabamento amador ou uso muito específico; evitar em marca de cliente
- Saldina: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Salinas: licença não permite uso comercial
- Sallie: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Sandstorm: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Sandy Lite: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Scratchy: não tem todos os acentos do português (Çç)
- Seashore: não tem todos os acentos do português (Çç)
- Second Lyrics: licença não permite uso comercial
- Sensation: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Sensations and Qualities: licença não permite uso comercial
- September: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Sequel: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Sevilia: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- SF Movie Poster: não tem todos os acentos do português (Çç)
- Shadowed Germanica: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Shakehand: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Shamber: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- She Always Walk Alone: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Shinella: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Shotgun: licença não permite uso comercial
- Signarita Zhai: não tem todos os acentos do português (Çç)
- Signerica: licença não permite uso comercial
- sileighty: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Silver Forte Grunge: números ou pontuação trazem marca d'água de versão demo
- Simpleton: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Simplifica: qualidade insuficiente
- Sinisuka: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Sixtape: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Sketch: números ou pontuação trazem marca d'água de versão demo
- Skybird: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Sladosti: conjunto de caracteres incompleto (faltam letras básicas)
- Smoking Tequila: acabamento amador ou uso muito específico; evitar em marca de cliente
- Smooth Stone: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Smoothies: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Snowdrop: acabamento amador ou uso muito específico; evitar em marca de cliente
- something wild: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- South Gardens: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Special Touch: números ou pontuação trazem marca d'água de versão demo
- Stackyard: números ou pontuação trazem marca d'água de versão demo
- Starbright: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Starshine: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Stone Age: conjunto de caracteres incompleto (faltam letras básicas)
- Stranger back in the Night: licença não permite uso comercial
- Studio Gothic: licença não permite uso comercial
- Stylish Brush: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Summer Love: faltam caracteres da amostra: , .
- summertime: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Sun Valley: números ou pontuação trazem marca d'água de versão demo
- Supermassive Black Hole: acabamento amador ou uso muito específico; evitar em marca de cliente
- Swallow Tail: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Sweet Brush: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Sweet Sensations: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Sweethearts: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Syabab: licença não permite uso comercial
- Syntesiatest: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Tessalate: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- The Blacklist: faltam caracteres da amostra: $
- The Bravery: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- The Moment: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Tomato Soup: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- tombow: conjunto de caracteres incompleto (faltam letras básicas)
- TOYZARUX: faltam caracteres da amostra: $ ,
- Trajanus Bricks: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕáâãçéêíóôõú)
- Trash Hand: faltam caracteres da amostra: $
- Traveling Typewriter: licença não permite uso comercial
- True Lies: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Unthrift First: números ou pontuação trazem marca d'água de versão demo
- Variane Script: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Veronica: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Virtual: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Voice of the Highlander: faltam caracteres da amostra: $
- Wabi Sabi: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Walking in Sunlight: licença não permite uso comercial
- Walking Stones: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- War is Over: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Warm Script: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Water: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Water Park: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Wavehaus: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Wermland Gothic: licença não permite uso comercial
- White Larch: números ou pontuação trazem marca d'água de versão demo
- Wildberry: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Withlove: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- xscale: não tem todos os acentos do português (áâãçéêíóôõú)
- Yesmina: acabamento amador ou uso muito específico; evitar em marca de cliente
- You And Me: não tem todos os acentos do português (ÀÁÃÇÉÍÓÕÚáâãçéêíóôõú)
- Zaheera: faltam caracteres da amostra: $ , . 0 1 2 3 4 5 6 7 8 9 :

## Como o catálogo foi montado

- Metadados lidos com fontTools: família, subfamília, peso (usWeightClass, corrigido pelo nome do estilo quando o arquivo vinha todo como 400), itálico, largura, número de glifos e mapa de caracteres.
- Suporte ao português conferido renderizando cada caractere com Pillow: além de existir no mapa, o glifo precisa ter desenho (várias fontes demo mapeiam acentos para glifos vazios) e os números não podem ser marca d'água de demo.
- Categoria, subestilo e nota de qualidade (0 a 3) definidos olhando uma folha de contato com todas as famílias renderizadas.
- Licença: texto de licença, copyright e nome de arquivo de cada fonte. Os únicos arquivos de licença do zip são os readme da League of Moveable Type (Orbitron, Ostrich Sans, Sniglet, Sorts Mill Goudy), que declaram SIL OFL 1.1.
