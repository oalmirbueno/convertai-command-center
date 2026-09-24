# -*- coding: utf-8 -*-
"""Monta docs/mesa-foto/biblioteca/biblioteca.json (frente D, Mesa Foto).

Todos os prompts sao texto proprio da Aceleriq; a fonte registrada e a
inspiracao tecnica (licenca da fonte anotada ao lado)."""
import json, os, sys

SAIDA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "biblioteca.json")

F = {
    "cc0prod": ("Awesome AI Product Photography Prompts (JeremyGDM)", "https://github.com/JeremyGDM/awesome-ai-product-photography-prompts", "Autoral Aceleriq; modelo adaptado de fonte CC0 1.0"),
    "evolink": ("Awesome GPT Image 2 API and Prompts (EvoLinkAI)", "https://github.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts", "Autoral Aceleriq; inspiração em coleção CC0 1.0"),
    "youmind": ("Awesome Nano Banana Pro Prompts (YouMind OpenLab)", "https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts", "Autoral Aceleriq; inspiração em coleção CC BY 4.0"),
    "zerolu": ("Awesome GPT Image (ZeroLu)", "https://github.com/ZeroLu/awesome-gpt-image", "Autoral Aceleriq; inspiração em coleção MIT"),
    "openai": ("OpenAI Cookbook: guia de prompts para GPT Image", "https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide", "Autoral Aceleriq; técnica de guia oficial (repositório MIT)"),
    "google": ("Google Developers Blog: prompts para Gemini Image", "https://developers.googleblog.com/en/how-to-prompt-gemini-2-5-flash-image-generation-for-the-best-results/", "Autoral Aceleriq; técnica de guia oficial"),
    "bfl": ("Black Forest Labs: FLUX Prompt Reference", "https://docs.bfl.ai/guides/prompting_unified_reference", "Autoral Aceleriq; técnica de guia oficial"),
    "bflhex": ("Black Forest Labs: cores por código HEX", "https://docs.bfl.ai/guides/usecases_t2i_hex_color_prompting", "Autoral Aceleriq; técnica de guia oficial"),
    "bria": ("Bria: boas práticas de product shots", "https://docs.bria.ai/product-shots-best-practices", "Autoral Aceleriq; técnica de guia oficial"),
    "shopify": ("Shopify Help Center: fotografia de produto", "https://help.shopify.com/en/manual/products/product-media/product-photography", "Autoral Aceleriq; técnica de guia público"),
    "shopifyfood": ("Shopify Blog: dicas de fotografia de alimentos", "https://www.shopify.com/blog/food-photography-tips", "Autoral Aceleriq; técnica de guia público"),
    "adobe": ("Adobe: guia de fotografia de produto", "https://www.adobe.com/uk/creativecloud/photography/discover/product-photography.html", "Autoral Aceleriq; técnica de guia público"),
}
WIKI = {
    "3pt": "Three-point_lighting", "tercos": "Rule_of_thirds", "rembrandt": "Rembrandt_lighting",
    "butterfly": "Butterfly_lighting", "highkey": "High-key_lighting", "food": "Food_photography",
    "stilllife": "Still_life_photography", "golden": "Golden_hour_(photography)", "softbox": "Softbox",
    "bokeh": "Bokeh", "dof": "Depth_of_field", "negativo": "Negative_space", "linhas": "Leading_lines",
    "temp": "Color_temperature", "duramole": "Hard_and_soft_light", "moda": "Fashion_photography",
    "arq": "Architectural_photography", "retrato": "Portrait_photography", "macro": "Macro_photography",
    "catch": "Catchlight", "gobo": "Gobo_(lighting)", "beauty": "Beauty_dish", "fill": "Fill_light",
    "key": "Key_light", "contraluz": "Backlighting_(lighting_design)", "chiaro": "Chiaroscuro",
}
for k, p in WIKI.items():
    F["wiki_" + k] = ("Wikipedia: " + p.replace("_", " "), "https://en.wikipedia.org/wiki/" + p, "Autoral Aceleriq; conceito de fonte CC BY-SA 4.0 (sem cópia de texto)")

# Trechos reaproveitados
ID_PT = "Use a foto enviada como referência de identidade: mantenha forma, proporções, cor, material e todo o texto do rótulo exatamente como no original, sem inventar detalhes."
ID_EN = "Use the attached photo as the identity reference: keep shape, proportions, color, material and all label text exactly as in the original, without inventing details."
FOOD_PT = "Mantenha a porção, os ingredientes e a montagem exatamente como na foto de referência, sem acrescentar nem aumentar nada."
FOOD_EN = "Keep the portion, ingredients and plating exactly as in the reference photo, adding or enlarging nothing."
GENTE_PT = "Use somente a foto autorizada enviada: preserve rosto, traços, idade, tom de pele, cabelo e formato do corpo exatamente como são; retoque natural apenas de luz e cor, sem alterar anatomia."
GENTE_EN = "Use only the authorized photo provided: preserve face, features, age, skin tone, hair and body shape exactly as they are; natural retouching of light and color only, no anatomical changes."

NEG_PROD = "texto inventado, logotipo inventado, rótulo distorcido, produto deformado, proporção alterada, reflexos sujos, poeira, sombra dupla, aparência de render plástico, saturação exagerada, marca d'água"
NEG_FOOD = "porção aumentada, ingrediente que não está na receita, comida brilhante artificial, aparência de plástico, fumaça exagerada, talheres sujos, saturação exagerada, marca d'água"
NEG_BEB = "rótulo distorcido, texto inventado, gotas de aparência plástica, bolhas irreais, vidro com reflexos sujos, líquido com cor alterada, marca d'água"
NEG_GENTE = "rosto alterado, pele de plástico, afinamento de corpo, rejuvenescimento, olhos alterados, dentes artificiais, mãos deformadas, dedos extras, maquiagem não pedida, marca d'água"
NEG_AMB = "linhas verticais tortas, distorção de lente grande angular, pessoas inventadas, placas com texto inventado, HDR exagerado, céu artificial, marca d'água"

I = []

def add(cat, titulo, pt, en, neg, tags, fonte, uso, destaque=False):
    nome, url, lic = F[fonte]
    I.append({
        "titulo": titulo, "categoria": cat, "prompt_pt": pt, "prompt_en": en,
        "negativo": neg, "tags": tags, "fonte_nome": nome, "fonte_url": url,
        "licenca": lic, "uso": uso, "destaque": destaque,
    })

# ------------------------------------------------------------------ produto
C = "produto"
add(C, "Packshot em fundo branco puro para marketplace",
    f"Foto profissional de e-commerce de [produto], centralizado em fundo branco puro (#FFFFFF), vista frontal, produto inteiro no quadro com respiro de 10% nas bordas. Luz de estúdio suave e uniforme com duas softboxes laterais a 45 graus e rebatedor por baixo, sombra de contato sutil e natural sob a base. Câmera full frame, lente 100 mm, f/11, foco nítido de ponta a ponta. Cor neutra e fiel. {ID_PT} Formato 1:1.",
    f"Professional e-commerce photo of [product], centered on pure white background (#FFFFFF), front view, whole product in frame with 10% breathing room at the edges. Soft, even studio light from two softboxes at 45 degrees plus a bounce card below, subtle natural contact shadow under the base. Full frame camera, 100mm lens, f/11, sharp edge to edge. Neutral, true to life color. {ID_EN} 1:1 aspect ratio.",
    NEG_PROD + ", props, cenário, fundo cinza", ["fundo branco", "marketplace", "catálogo", "packshot", "1:1"], "cc0prod",
    "Primeira foto de anúncio em marketplace e loja virtual.", True)
add(C, "Três quartos em fundo infinito cinza claro",
    f"Packshot de [produto] em ângulo de três quartos (frente e lateral visíveis), apoiado em fundo infinito cinza claro (#E9E9E7) sem emenda. Softbox grande como luz principal à esquerda a 45 graus, rebatedor branco à direita, luz de recorte suave por trás para separar o contorno. Lente 90 mm, f/8, câmera levemente acima da altura do produto. Sombra macia de contato. {ID_PT} Formato 4:5.",
    f"Packshot of [product] at a three quarter angle (front and side visible), resting on a seamless light gray sweep (#E9E9E7). Large softbox as key light at 45 degrees camera left, white bounce on the right, soft rim light from behind to separate the silhouette. 90mm lens, f/8, camera slightly above product height. Soft contact shadow. {ID_EN} 4:5 aspect ratio.",
    NEG_PROD, ["três quartos", "fundo infinito", "catálogo", "4:5"], "cc0prod",
    "Segunda foto do anúncio, mostra volume e lateral.")
add(C, "Produto flutuante com sombra suave",
    f"[Produto] suspenso levemente acima de uma superfície clara, como se flutuasse, com sombra difusa projetada 3 cm abaixo. Fundo em gradiente suave de [cor clara da marca, ex. #F3EEE8] para branco. Luz de softbox superior ampla e rebatedor frontal. Lente 85 mm, f/8, enquadramento central com bastante respiro. {ID_PT} Formato 1:1.",
    f"[Product] hovering slightly above a light surface, as if floating, casting a diffused shadow 3 cm below. Background in a soft gradient from [light brand color, e.g. #F3EEE8] to white. Broad overhead softbox and front fill card. 85mm lens, f/8, centered framing with generous breathing room. {ID_EN} 1:1 aspect ratio.",
    NEG_PROD + ", fios de sustentação visíveis", ["flutuante", "sombra suave", "minimalista"], "cc0prod",
    "Destaque de produto em redes sociais e banners limpos.")
add(C, "Herói em pedestal com recorte de luz",
    f"[Produto] como herói sobre um pedestal cilíndrico de [material, ex. gesso fosco] em cenário de estúdio de tom [cor], luz principal de softbox estreita (strip) em diagonal, luz de recorte dos dois lados desenhando o contorno, leve névoa de fundo iluminada. Câmera ligeiramente abaixo do produto, lente 70 mm, f/8. Produto ocupa o terço inferior central, espaço livre acima para título. {ID_PT} Formato 4:5.",
    f"[Product] as the hero on a cylindrical pedestal of [material, e.g. matte plaster] in a studio set in [color] tones, narrow strip softbox key light on a diagonal, rim lights on both sides tracing the outline, light haze lit in the background. Camera slightly below the product, 70mm lens, f/8. Product sits in the lower central third, clean space above for a headline. {ID_EN} 4:5 aspect ratio.",
    NEG_PROD + ", texto gerado na imagem", ["herói", "pedestal", "campanha", "lançamento"], "cc0prod",
    "Peça de lançamento e capa de campanha.", True)
add(C, "Macro de acabamento e material",
    f"Close-up extremo de [detalhe do produto: costura, textura, gravação, fecho], lente macro 100 mm, f/5.6, profundidade de campo curta com a área principal nítida. Luz lateral rasante de uma softbox pequena revelando a textura real do [material], rebatedor do lado oposto. Fundo neutro desfocado. Só mostre detalhes que aparecem na foto de referência. {ID_PT}",
    f"Extreme close-up of [product detail: stitching, texture, engraving, clasp], 100mm macro lens, f/5.6, shallow depth of field with the key area sharp. Raking side light from a small softbox revealing the real texture of the [material], bounce card opposite. Neutral out of focus background. Only show details visible in the reference photo. {ID_EN}",
    NEG_PROD + ", brilho exagerado, textura inventada", ["macro", "detalhe", "textura", "qualidade"], "cc0prod",
    "Provar qualidade de material; foto 3 ou 4 do anúncio.")
add(C, "Knolling do kit completo vista superior",
    f"Vista superior a 90 graus de [produto] e todos os itens do kit organizados em grade ortogonal (knolling), espaçamento igual entre as peças, alinhados ao quadro. Superfície [cor sólida clara]. Softbox grande diretamente acima com difusor duplo para sombras mínimas. Lente 50 mm, f/11, tudo nítido. Mostre apenas os itens que existem no kit real. {ID_PT} Formato 1:1.",
    f"Top down 90 degree view of [product] and every kit item arranged in an orthogonal grid (knolling), equal spacing between pieces, aligned to the frame. [Light solid color] surface. Large overhead softbox with double diffusion for minimal shadows. 50mm lens, f/11, everything sharp. Only show items that exist in the real kit. {ID_EN} 1:1 aspect ratio.",
    NEG_PROD + ", itens extras, peças duplicadas", ["knolling", "vista superior", "kit", "conteúdo da caixa"], "cc0prod",
    "Mostrar o que vem na caixa.")
add(C, "Lifestyle em mesa de madeira com luz de janela",
    f"Foto lifestyle de [produto] sobre mesa de madeira clara com toalha de linho, luz natural de janela entrando pela esquerda às 9 h, sombras macias. Um ou dois objetos de apoio coerentes com o uso ([ex. xícara, caderno]) desfocados ao fundo. Lente 50 mm, f/2.8, câmera na altura da mesa levemente acima. O produto é o ponto focal claro e o rótulo fica legível. {ID_PT} Formato 4:5.",
    f"Lifestyle photo of [product] on a light wood table with a linen cloth, natural window light from the left at 9 a.m., soft shadows. One or two supporting props that fit the use ([e.g. cup, notebook]) blurred in the background. 50mm lens, f/2.8, camera at table height slightly above. The product is the clear focal point and the label stays readable. {ID_EN} 4:5 aspect ratio.",
    NEG_PROD + ", excesso de objetos, cena poluída", ["lifestyle", "luz de janela", "madeira", "feed"], "cc0prod",
    "Feed do Instagram e anúncio de consideração.", True)
add(C, "Produto em uso nas mãos",
    f"[Produto] segurado por duas mãos naturais, unhas limpas e curtas, sem joias chamativas, gesto de uso real ([ex. abrindo a tampa]). Recorte fechado no produto e nas mãos, sem rosto. Luz difusa de janela lateral, fundo [ambiente] desfocado. Lente 85 mm, f/3.2. Escala realista entre mão e produto. {ID_PT} Formato 4:5.",
    f"[Product] held by two natural hands, clean short nails, no flashy jewelry, a real usage gesture ([e.g. opening the lid]). Tight crop on product and hands, no face. Diffused side window light, blurred [setting] background. 85mm lens, f/3.2. Realistic scale between hand and product. {ID_EN} 4:5 aspect ratio.",
    NEG_PROD + ", mãos deformadas, dedos extras, escala errada", ["mãos", "uso", "escala", "ugc"], "cc0prod",
    "Mostrar tamanho real e uso; bom para anúncios.")
add(C, "Produto e embalagem lado a lado",
    f"[Produto] em pé ao lado da sua embalagem original, embalagem levemente atrás e à direita, ambos de frente com leve rotação de 15 graus. Fundo [cor neutra], luz de softbox principal à esquerda, rebatedor à direita, sombras suaves. Lente 90 mm, f/11. Texto da embalagem e do produto exatamente como nas fotos de referência. {ID_PT} Formato 1:1.",
    f"[Product] standing beside its original packaging, packaging slightly behind and to the right, both facing camera with a slight 15 degree turn. [Neutral color] background, main softbox camera left, bounce on the right, soft shadows. 90mm lens, f/11. Packaging and product text exactly as in the reference photos. {ID_EN} 1:1 aspect ratio.",
    NEG_PROD + ", embalagem inventada", ["embalagem", "unboxing", "catálogo"], "shopify",
    "Anúncio que precisa mostrar a caixa (presente, kit).")
add(C, "Cor sólida da marca com sombra dura editorial",
    f"[Produto] sobre fundo e superfície na mesma cor sólida [cor da marca em HEX, ex. #2F5D50], luz dura de um refletor pequeno a 60 graus criando sombra longa e nítida para a direita, estética editorial de revista. Lente 85 mm, f/11. Composição com o produto deslocado para o terço esquerdo e espaço negativo à direita. {ID_PT} Formato 4:5.",
    f"[Product] on a background and surface in the same solid color [brand color HEX, e.g. #2F5D50], hard light from a small reflector at 60 degrees casting a long crisp shadow to the right, editorial magazine look. 85mm lens, f/11. Product placed on the left third with negative space on the right. {ID_EN} 4:5 aspect ratio.",
    NEG_PROD + ", degradê no fundo", ["cor da marca", "sombra dura", "editorial", "hex"], "bflhex",
    "Posts de marca com paleta própria.")
add(C, "Mármore com sombra de folhagem",
    f"[Produto] sobre placa de mármore branco com veios cinza suaves, sombra de folhas projetada por gobo (luz dura atravessando galhos) cruzando a cena na diagonal, sensação de manhã ensolarada. Lente 70 mm, f/8, câmera a 30 graus acima. Paleta clara com toque de verde. {ID_PT} Formato 4:5.",
    f"[Product] on a white marble slab with soft gray veining, leaf shadows cast by a gobo (hard light through branches) crossing the scene diagonally, sunny morning feel. 70mm lens, f/8, camera 30 degrees above. Light palette with a touch of green. {ID_EN} 4:5 aspect ratio.",
    NEG_PROD, ["mármore", "gobo", "sombra de folhas", "premium"], "wiki_gobo",
    "Linha premium, cosmético, casa e decoração.")
add(C, "Nicho de concreto arquitetônico",
    f"[Produto] posicionado dentro de um nicho retangular de concreto aparente liso, luz de sol dura entrando de cima em diagonal formando um recorte geométrico de luz e sombra, paleta cinza quente. Lente 50 mm, f/8, câmera frontal na altura do nicho. {ID_PT} Formato 4:5.",
    f"[Product] placed inside a rectangular niche of smooth exposed concrete, hard sunlight coming from above at a diagonal forming a geometric cut of light and shadow, warm gray palette. 50mm lens, f/8, frontal camera at niche height. {ID_EN} 4:5 aspect ratio.",
    NEG_PROD + ", rachaduras exageradas", ["concreto", "arquitetônico", "geométrico"], "youmind",
    "Marcas de design, tecnologia e moda masculina.")
add(C, "Escala com objetos do cotidiano",
    f"[Produto] sobre uma mesa ao lado de objetos de tamanho conhecido ([ex. caneca, celular, caderno A5]), todos em escala real e coerente com as medidas informadas: [medidas]. Luz natural difusa, lente 50 mm, f/5.6, vista a 30 graus. {ID_PT} Se as medidas não foram informadas, não use esta tomada.",
    f"[Product] on a table beside everyday objects of known size ([e.g. mug, phone, A5 notebook]), all in real scale consistent with the given dimensions: [dimensions]. Diffused natural light, 50mm lens, f/5.6, 30 degree view. {ID_EN} If dimensions were not provided, do not use this shot.",
    NEG_PROD + ", escala errada", ["escala", "medida", "tamanho real"], "shopify",
    "Responder a dúvida de tamanho antes da compra.")
add(C, "Frontal ortográfico com lente longa",
    f"Vista estritamente frontal de [produto], câmera na altura do centro do produto, lente 150 mm para eliminar distorção de perspectiva, f/11. Fundo branco ou [cor], iluminação simétrica com duas strip boxes laterais, sem sombra no fundo. Rótulo perfeitamente reto e legível. {ID_PT} Formato 1:1.",
    f"Strictly frontal view of [product], camera at the product's center height, 150mm lens to remove perspective distortion, f/11. White or [color] background, symmetrical lighting from two side strip boxes, no background shadow. Label perfectly straight and readable. {ID_EN} 1:1 aspect ratio.",
    NEG_PROD + ", perspectiva inclinada", ["frontal", "ortográfico", "rótulo", "catálogo"], "adobe",
    "Rótulo legível para catálogo e tabela nutricional real.")
add(C, "Reflexo em lâmina de água",
    f"[Produto] apoiado sobre uma lâmina rasa de água parada em superfície escura fosca, reflexo espelhado limpo abaixo, pequenas ondulações concêntricas discretas. Luz de recorte traseira e softbox frontal alta. Lente 90 mm, f/8, câmera baixa quase na linha da água. {ID_PT} Formato 4:5.",
    f"[Product] standing on a shallow sheet of still water over a dark matte surface, clean mirrored reflection below, a few discreet concentric ripples. Back rim light and high front softbox. 90mm lens, f/8, low camera almost at water level. {ID_EN} 4:5 aspect ratio.",
    NEG_PROD + ", respingos exagerados", ["água", "reflexo", "premium"], "evolink",
    "Campanha de hidratação, bebidas, perfumes, relógios.")
add(C, "Cena sazonal discreta",
    f"[Produto] em cena de [data: Natal, Dia das Mães, verão brasileiro], com poucos elementos da estação ([ex. ramos de pinheiro e luzes desfocadas ao fundo]) que sugerem a data sem roubar a atenção. Luz quente suave lateral, lente 50 mm, f/2.8. O produto é o maior elemento nítido do quadro. {ID_PT} Formato 4:5.",
    f"[Product] in a [occasion: Christmas, Mother's Day, Brazilian summer] scene, with few seasonal elements ([e.g. pine sprigs and blurred lights behind]) that suggest the date without stealing attention. Soft warm side light, 50mm lens, f/2.8. The product is the largest sharp element in the frame. {ID_EN} 4:5 aspect ratio.",
    NEG_PROD + ", excesso de decoração, texto de data", ["sazonal", "datas comemorativas", "campanha"], "cc0prod",
    "Calendário comercial (Natal, Mães, Pais, Black Friday).")
add(C, "Bancada de ateliê para produto artesanal",
    f"[Produto artesanal] sobre bancada de madeira de ateliê com ferramentas do ofício desfocadas ao fundo ([ex. linhas, tesoura, moldes]), luz de janela lateral quente, poeira nenhuma. Lente 50 mm, f/2.8, câmera na altura da bancada. Transmite feito à mão e cuidado, sem parecer bagunça. {ID_PT} Formato 4:5.",
    f"[Handmade product] on a wooden workshop bench with craft tools blurred in the background ([e.g. threads, scissors, patterns]), warm side window light, no dust. 50mm lens, f/2.8, camera at bench height. Conveys handmade care without looking messy. {ID_EN} 4:5 aspect ratio.",
    NEG_PROD + ", bagunça, ferramentas no primeiro plano", ["artesanal", "ateliê", "pequeno produtor", "história"], "youmind",
    "Marcas de pequeno produtor que vendem a história do feito à mão.")

# ------------------------------------------------------------------ alimento
C = "alimento"
add(C, "Prato herói a 45 graus com luz de janela",
    f"Foto comercial de [prato] servido em [louça], câmera a 45 graus, lente 90 mm, f/4, foco no ponto mais apetitoso do prato. Luz natural de janela lateral por trás e à esquerda (contraluz lateral) realçando textura e brilho natural, rebatedor branco na frente. Superfície de [madeira escura, pedra ou linho], um guardanapo e talher discretos. {FOOD_PT} Formato 4:5.",
    f"Commercial photo of [dish] served on [tableware], camera at 45 degrees, 90mm lens, f/4, focus on the most appetizing point of the dish. Natural side back window light from the left enhancing texture and natural sheen, white bounce card in front. [Dark wood, stone or linen] surface, a discreet napkin and cutlery. {FOOD_EN} 4:5 aspect ratio.",
    NEG_FOOD, ["45 graus", "prato", "cardápio", "luz de janela"], "shopifyfood",
    "Foto principal de cardápio, apps de entrega e feed de restaurante.", True)
add(C, "Mesa posta em vista superior",
    f"Vista superior a 90 graus de uma mesa com [pratos do cardápio], composição equilibrada com pratos em tamanhos diferentes, mãos opcionais servindo, guardanapos de linho e copos. Luz difusa de softbox grande acima e levemente lateral para sombras curtas. Lente 35 mm, f/8, tudo nítido. {FOOD_PT} Formato 4:5.",
    f"Top down 90 degree view of a table with [menu dishes], balanced composition with plates of different sizes, optional hands serving, linen napkins and glasses. Diffused light from a large overhead softbox slightly to the side for short shadows. 35mm lens, f/8, everything sharp. {FOOD_EN} 4:5 aspect ratio.",
    NEG_FOOD + ", pratos cortados na borda sem intenção", ["flat lay", "vista superior", "mesa posta", "compartilhar"], "wiki_food",
    "Mostrar variedade do cardápio em uma imagem.", True)
add(C, "Macro de textura apetitosa",
    f"Macro de [alimento: crosta do pão, miolo, calda, grelhado], lente macro 100 mm, f/4, foco seletivo no detalhe, luz lateral rasante suave revelando textura, fundo do próprio prato desfocado. Cor natural, sem brilho artificial. {FOOD_PT}",
    f"Macro of [food: bread crust, crumb, sauce, grill marks], 100mm macro lens, f/4, selective focus on the detail, soft raking side light revealing texture, the plate itself blurred behind. Natural color, no artificial gloss. {FOOD_EN}",
    NEG_FOOD, ["macro", "textura", "detalhe"], "wiki_macro",
    "Stories e anúncios de desejo; detalhe de padaria e confeitaria.")
add(C, "Ardósia com luz lateral e exposição correta",
    f"[Prato] sobre ardósia cinza grafite, luz lateral de uma softbox média à esquerda com bandeira preta à direita para dar volume, exposição correta e sombras abertas (sem escurecer a foto). Lente 90 mm, f/5.6, ângulo de 30 graus. Ervas frescas somente se fizerem parte da receita. {FOOD_PT} Formato 4:5.",
    f"[Dish] on graphite gray slate, side light from a medium softbox on the left with a black flag on the right for volume, correct exposure with open shadows (do not darken the image). 90mm lens, f/5.6, 30 degree angle. Fresh herbs only if part of the recipe. {FOOD_EN} 4:5 aspect ratio.",
    NEG_FOOD + ", foto subexposta, sombras fechadas", ["ardósia", "luz lateral", "volume"], "wiki_duramole",
    "Pratos de restaurante com visual sofisticado.")
add(C, "Lanche frontal na altura dos olhos",
    f"[Lanche: hambúrguer, sanduíche] fotografado de frente na altura do recheio, lente 100 mm, f/5.6, mostrando as camadas reais exatamente na ordem da receita. Fundo [cor] limpo desfocado, luz principal lateral com contraluz para brilho natural do queijo e do pão. {FOOD_PT} Formato 4:5.",
    f"[Sandwich or burger] shot straight on at filling height, 100mm lens, f/5.6, showing the real layers exactly in recipe order. Clean blurred [color] background, side key light with backlight for the natural sheen of cheese and bun. {FOOD_EN} 4:5 aspect ratio.",
    NEG_FOOD + ", camadas extras, lanche mais alto que o real", ["lanche", "camadas", "hamburgueria", "frontal"], "shopifyfood",
    "Hamburguerias e lanchonetes; cardápio de delivery.")
add(C, "Delivery com embalagem de entrega",
    f"[Prato] na embalagem de entrega real do restaurante, tampa aberta ao lado, sacola ao fundo, sobre bancada clara. Luz natural difusa, lente 50 mm, f/4, câmera a 45 graus. A comida aparece como chega ao cliente. {FOOD_PT} Mantenha a embalagem como na foto enviada. Formato 1:1.",
    f"[Dish] in the restaurant's real delivery packaging, lid open beside it, bag in the background, on a light counter. Diffused natural light, 50mm lens, f/4, camera at 45 degrees. The food looks the way it arrives to the customer. {FOOD_EN} Keep the packaging as in the provided photo. 1:1 aspect ratio.",
    NEG_FOOD + ", embalagem inventada", ["delivery", "embalagem", "app de entrega"], "shopifyfood",
    "Vitrine de aplicativo de entrega; expectativa honesta.")
add(C, "Ingredientes da receita ao redor",
    f"[Prato] ao centro com os ingredientes crus que realmente compõem a receita ([lista informada]) dispostos ao redor em pequenas porções, vista superior, superfície de madeira clara. Luz de janela lateral suave, lente 50 mm, f/8. Nenhum ingrediente fora da lista. {FOOD_PT} Formato 4:5.",
    f"[Dish] in the center with the raw ingredients that truly make up the recipe ([provided list]) arranged around in small portions, top down view, light wood surface. Soft side window light, 50mm lens, f/8. No ingredient outside the list. {FOOD_EN} 4:5 aspect ratio.",
    NEG_FOOD, ["ingredientes", "receita", "vista superior", "transparência"], "wiki_food",
    "Mostrar que é feito com ingredientes frescos; conteúdo educativo.")
add(C, "Prato quente com vapor natural",
    f"[Prato quente] recém servido com vapor leve e natural subindo, visível contra fundo escuro desfocado atrás, contraluz lateral para desenhar o vapor, rebatedor na frente para manter o prato bem exposto. Lente 85 mm, f/4, ângulo de 30 graus. {FOOD_PT} Formato 4:5.",
    f"[Hot dish] freshly served with light natural steam rising, visible against a blurred dark background behind, side backlight to draw the steam, bounce card in front to keep the dish well exposed. 85mm lens, f/4, 30 degree angle. {FOOD_EN} 4:5 aspect ratio.",
    NEG_FOOD + ", fumaça densa, vapor exagerado", ["vapor", "quente", "contraluz", "inverno"], "wiki_contraluz",
    "Sopas, cafés, massas; campanhas de inverno.")
add(C, "Fatia de bolo mostrando camadas",
    f"Fatia de [bolo] em prato de sobremesa, cortada de forma limpa, vista lateral na altura da fatia para mostrar as camadas reais, o bolo inteiro desfocado ao fundo. Luz lateral suave de janela, lente 100 mm, f/4. Garfo de sobremesa ao lado. {FOOD_PT} Formato 4:5.",
    f"Slice of [cake] on a dessert plate, cleanly cut, side view at slice height to show the real layers, the whole cake blurred behind. Soft side window light, 100mm lens, f/4. Dessert fork beside it. {FOOD_EN} 4:5 aspect ratio.",
    NEG_FOOD + ", camadas extras, recheio a mais", ["confeitaria", "bolo", "camadas", "doce"], "wiki_stilllife",
    "Confeitarias e cafeterias.")
add(C, "Café da manhã brasileiro",
    f"Mesa de café da manhã com [itens reais do cardápio, ex. pão de queijo, frutas tropicais cortadas, café coado], toalha de algodão clara, luz de sol suave da manhã entrando pela janela, vista a 45 graus, lente 35 mm, f/4. Clima acolhedor e real, sem exagero de itens. {FOOD_PT} Formato 4:5.",
    f"Breakfast table with [real menu items, e.g. cheese bread, cut tropical fruit, filtered coffee], light cotton tablecloth, soft morning sunlight through the window, 45 degree view, 35mm lens, f/4. Cozy and real mood, not overloaded. {FOOD_EN} 4:5 aspect ratio.",
    NEG_FOOD + ", mesa superlotada", ["café da manhã", "brasileiro", "padaria", "hotelaria"], "youmind",
    "Padarias, pousadas e cafeterias.")
add(C, "Tigela vista de cima com coberturas reais",
    f"Tigela de [açaí, poke, salada] vista de cima a 90 graus, coberturas organizadas em faixas exatamente como servidas, colher ao lado, fundo de cor sólida [cor] ou madeira clara. Luz de softbox superior difusa, lente 50 mm, f/8. {FOOD_PT} Formato 1:1.",
    f"Bowl of [acai, poke, salad] seen from directly above at 90 degrees, toppings arranged in rows exactly as served, spoon beside it, solid [color] or light wood background. Diffused overhead softbox, 50mm lens, f/8. {FOOD_EN} 1:1 aspect ratio.",
    NEG_FOOD + ", tigela transbordando", ["tigela", "vista superior", "açaí", "saudável"], "cc0prod",
    "Açaiterias, casas de poke, saladas.")
add(C, "Gesto de servir sem exagero",
    f"Mão servindo [prato] no momento da ação ([ex. levantando uma fatia de pizza com o queijo esticando levemente]), movimento natural e crível, velocidade de obturador alta 1/500 s para congelar, lente 85 mm, f/4, luz lateral. {FOOD_PT} Formato 4:5.",
    f"Hand serving [dish] mid action ([e.g. lifting a pizza slice with the cheese stretching slightly]), natural believable motion, fast 1/500 s shutter to freeze it, 85mm lens, f/4, side light. {FOOD_EN} 4:5 aspect ratio.",
    NEG_FOOD + ", queijo esticado exagerado, mãos deformadas", ["ação", "movimento", "servir", "pizza"], "shopifyfood",
    "Anúncios de desejo com movimento.")
add(C, "Série de cardápio em fundo neutro",
    f"[Prato] centralizado em fundo neutro [cor clara] sempre com o mesmo ângulo de 45 graus, mesma distância, mesma louça e mesma luz de softbox lateral esquerda, para compor uma série consistente de cardápio. Lente 90 mm, f/8. {FOOD_PT} Formato 1:1.",
    f"[Dish] centered on a neutral [light color] background always at the same 45 degree angle, same distance, same tableware and same left side softbox light, to build a consistent menu series. 90mm lens, f/8. {FOOD_EN} 1:1 aspect ratio.",
    NEG_FOOD + ", variação de ângulo entre fotos", ["série", "cardápio", "consistência", "fundo neutro"], "wiki_food",
    "Cardápio digital com todas as fotos iguais em padrão.")
add(C, "Vitrine de padaria no balcão",
    f"Vitrine de [padaria ou confeitaria] com [produtos reais] organizados em bandejas, vista na altura do balcão, lente 35 mm, f/5.6, luz ambiente quente da loja equilibrada com luz de janela, vidro sem reflexos fortes. {FOOD_PT} Formato 4:5.",
    f"[Bakery or pastry] display case with [real products] arranged on trays, seen at counter height, 35mm lens, f/5.6, warm store ambient light balanced with window light, glass without strong reflections. {FOOD_EN} 4:5 aspect ratio.",
    NEG_FOOD + ", reflexos no vidro, produtos inventados", ["vitrine", "padaria", "loja"], "wiki_food",
    "Padarias e confeitarias com loja física.")
add(C, "Pizza vista de cima com fatia afastada",
    f"[Pizza] inteira vista de cima sobre tábua de madeira, uma fatia levemente afastada, coberturas exatamente como na foto de referência, luz difusa superior com leve direção lateral, lente 50 mm, f/8. {FOOD_PT} Formato 1:1.",
    f"Whole [pizza] from above on a wooden board, one slice pulled slightly away, toppings exactly as in the reference photo, diffused overhead light with a slight side direction, 50mm lens, f/8. {FOOD_EN} 1:1 aspect ratio.",
    NEG_FOOD + ", cobertura extra", ["pizza", "vista superior", "delivery"], "cc0prod",
    "Pizzarias e delivery.")

# ------------------------------------------------------------------ bebida
C = "bebida"
add(C, "Garrafa em contraluz com condensação",
    f"[Garrafa de bebida] gelada com gotas de condensação naturais e nítidas, em contraluz com painel difuso atrás para revelar a transparência e a cor real do líquido, duas strip boxes laterais desenhando as bordas do vidro. Fundo [cor]. Lente 100 mm, f/11. {ID_PT} Formato 4:5.",
    f"Chilled [beverage bottle] with natural crisp condensation droplets, backlit by a diffused panel to reveal the transparency and real color of the liquid, two side strip boxes tracing the glass edges. [Color] background. 100mm lens, f/11. {ID_EN} 4:5 aspect ratio.",
    NEG_BEB, ["contraluz", "condensação", "garrafa", "gelada"], "cc0prod",
    "Foto principal de bebida gelada.", True)
add(C, "Splash congelado em alta velocidade",
    f"[Bebida] em copo com respingo dinâmico congelado no ar, estética de fotografia de alta velocidade (flash de 1/10000 s), gotas nítidas, fundo de cor sólida [cor da marca]. Contraluz para o líquido brilhar. Lente 100 mm, f/11. Cor do líquido fiel. {ID_PT} Formato 4:5.",
    f"[Beverage] in a glass with a dynamic splash frozen mid air, high speed photography look (1/10000 s flash), sharp droplets, solid [brand color] background. Backlight so the liquid glows. 100mm lens, f/11. True liquid color. {ID_EN} 4:5 aspect ratio.",
    NEG_BEB + ", respingo cobrindo o rótulo", ["splash", "alta velocidade", "dinâmico"], "cc0prod",
    "Anúncio de impacto para bebida.")
add(C, "Drink em balcão de bar à noite",
    f"[Drink] em copo baixo com gelo cristalino sobre balcão de madeira escura, luzes práticas quentes do bar desfocadas em bokeh ao fundo, luz de recorte traseira no copo e uma softbox pequena frontal para expor bem o drink. Lente 85 mm, f/2.8. Guarnição somente a da receita. Formato 4:5.",
    f"[Cocktail] in a rocks glass with crystal clear ice on a dark wood bar counter, warm practical bar lights blurred into bokeh behind, back rim light on the glass and a small front softbox so the drink stays well exposed. 85mm lens, f/2.8. Only the recipe's garnish. 4:5 aspect ratio.",
    NEG_BEB + ", gelo turvo, guarnição inventada", ["drink", "bar", "noite", "bokeh"], "wiki_bokeh",
    "Bares e restaurantes com carta de drinks.")
add(C, "Espresso com crema em macro",
    f"Xícara de espresso com crema dourada e textura tigrada natural, vista a 30 graus, lente macro 100 mm, f/4, luz lateral suave de janela, pires e colher, grãos de café desfocados ao fundo. Formato 4:5.",
    f"Espresso cup with golden crema and natural tiger striping, 30 degree view, 100mm macro lens, f/4, soft side window light, saucer and spoon, coffee beans blurred in the background. 4:5 aspect ratio.",
    NEG_BEB + ", espuma artificial, crema exagerada", ["café", "espresso", "macro", "cafeteria"], "wiki_macro",
    "Cafeterias e torrefações.")
add(C, "Suco natural com frutas cortadas",
    f"Copo de [suco] com as frutas reais da receita cortadas ao lado, gotas na parede do copo, luz de dia lateral com contraluz para a cor brilhar, fundo claro ensolarado desfocado. Lente 85 mm, f/4. Cor do suco fiel à fruta. Formato 4:5.",
    f"Glass of [juice] with the recipe's real fruits cut beside it, droplets on the glass, side daylight with backlight so the color glows, bright sunny blurred background. 85mm lens, f/4. Juice color true to the fruit. 4:5 aspect ratio.",
    NEG_BEB + ", frutas que não estão na receita", ["suco", "frutas", "natural", "verão"], "shopifyfood",
    "Lanchonetes, casas de suco, delivery saudável.")
add(C, "Lata no gelo em cor sólida",
    f"[Lata de bebida] meio enterrada em gelo picado cristalino, gotas nítidas, fundo em cor sólida [cor da marca, HEX], luz de recorte dos dois lados e softbox frontal alta. Lente 90 mm, f/11. {ID_PT} Formato 4:5.",
    f"[Beverage can] half buried in crystal clear crushed ice, sharp droplets, solid [brand color, HEX] background, rim lights on both sides and a high front softbox. 90mm lens, f/11. {ID_EN} 4:5 aspect ratio.",
    NEG_BEB + ", lata amassada", ["lata", "gelo", "cor da marca"], "evolink",
    "Anúncio de refrigerantes, energéticos, águas saborizadas.")
add(C, "Copo com espuma e bolhas reais",
    f"[Bebida com espuma] servida em copo adequado, colarinho cremoso de dois dedos, bolhas finas subindo, contraluz difuso atrás do copo para mostrar a cor, fundo de [ambiente] desfocado. Lente 85 mm, f/4. Rótulo da garrafa ao lado exatamente como na foto de referência. Formato 4:5.",
    f"[Foamy beverage] served in a proper glass, creamy two finger head, fine bubbles rising, diffused backlight behind the glass to show the color, blurred [setting] background. 85mm lens, f/4. Bottle label beside it exactly as in the reference photo. 4:5 aspect ratio.",
    NEG_BEB + ", espuma transbordando", ["espuma", "cervejaria", "artesanal"], "wiki_contraluz",
    "Cervejarias artesanais e bares.")
add(C, "Taça ao pôr do sol",
    f"Taça de [bebida] sobre mesa ao ar livre no fim da tarde, sol baixo atrás criando contraluz dourado através do líquido, paisagem desfocada ao fundo, rebatedor frontal para expor o copo. Lente 85 mm, f/2.8. Formato 4:5.",
    f"Glass of [beverage] on an outdoor table late afternoon, low sun behind creating golden backlight through the liquid, blurred landscape behind, front bounce to expose the glass. 85mm lens, f/2.8. 4:5 aspect ratio.",
    NEG_BEB + ", sol estourado sem detalhe", ["pôr do sol", "golden hour", "vinícola", "externa"], "wiki_golden",
    "Vinícolas, rooftops, pousadas.")
add(C, "Chá quente com vapor em luz de janela",
    f"Xícara de [chá ou infusão] quente com vapor leve, folhas soltas e bule ao lado, luz de janela lateral suave com contraluz para o vapor aparecer, tons claros e naturais. Lente 85 mm, f/3.2, ângulo de 30 graus. Formato 4:5.",
    f"Cup of hot [tea or infusion] with light steam, loose leaves and teapot beside it, soft side window light with backlight so the steam shows, light natural tones. 85mm lens, f/3.2, 30 degree angle. 4:5 aspect ratio.",
    NEG_BEB + ", vapor exagerado", ["chá", "vapor", "aconchego"], "shopifyfood",
    "Casas de chá, cafeterias, produtos naturais.")
add(C, "Garrafa em gradiente de estúdio",
    f"Packshot de [garrafa] de frente, rótulo reto e legível, em fundo gradiente de [cor escura suave] para [cor clara], strip boxes verticais nos dois lados desenhando linhas de brilho limpas no vidro, luz de fundo para separar. Lente 100 mm, f/11. {ID_PT} Formato 4:5.",
    f"Front packshot of [bottle], label straight and readable, on a gradient background from [soft dark color] to [light color], vertical strip boxes on both sides drawing clean highlight lines on the glass, background light for separation. 100mm lens, f/11. {ID_EN} 4:5 aspect ratio.",
    NEG_BEB, ["garrafa", "gradiente", "strip box", "packshot"], "wiki_softbox",
    "Catálogo de bebidas premium.")
add(C, "Bebida em quiosque de praia",
    f"[Bebida] sobre mesa de madeira de quiosque de praia brasileira, mar e areia desfocados ao fundo, sol forte do meio da manhã com sombra curta, cores vivas e naturais, gotas de condensação. Lente 50 mm, f/2.8. {ID_PT} Formato 9:16 com espaço acima para texto.",
    f"[Beverage] on a wooden table at a Brazilian beach kiosk, sea and sand blurred behind, strong mid morning sun with short shadow, vivid natural colors, condensation droplets. 50mm lens, f/2.8. {ID_EN} 9:16 aspect ratio with space above for text.",
    NEG_BEB + ", pessoas no fundo", ["praia", "verão", "tropical", "9:16"], "youmind",
    "Campanhas de verão em stories e reels.")
add(C, "Vidro escuro desenhado com faixas de luz",
    f"[Garrafa de vidro escuro] em fundo cinza médio, contorno desenhado por duas faixas de luz verticais refletidas no vidro (técnica de campo claro), tampa com brilho controlado, sem reflexos do estúdio. Lente 100 mm, f/11. Exposição correta. {ID_PT} Formato 4:5.",
    f"[Dark glass bottle] on a mid gray background, silhouette drawn by two vertical light stripes reflected on the glass (bright field technique), controlled highlight on the cap, no studio reflections. 100mm lens, f/11. Correct exposure. {ID_EN} 4:5 aspect ratio.",
    NEG_BEB + ", reflexo de equipamento", ["vidro escuro", "faixas de luz", "técnica"], "wiki_duramole",
    "Vinhos, azeites, cervejas em garrafa âmbar.")

# ------------------------------------------------------------------ cosmetico
C = "cosmetico"
add(C, "Frasco em gradiente pastel com luz ampla",
    f"[Frasco de cosmético] em pé sobre superfície acrílica fosca, fundo em gradiente pastel de [cor 1] para [cor 2], luz ampla e envolvente de uma softbox octogonal frontal alta e rebatedores laterais, reflexo suave na base. Rótulo reto e legível. Lente 100 mm, f/11. {ID_PT} Formato 4:5.",
    f"[Cosmetic bottle] standing on a frosted acrylic surface, pastel gradient background from [color 1] to [color 2], broad wrapping light from a high front octagonal softbox with side bounces, soft reflection at the base. Label straight and readable. 100mm lens, f/11. {ID_EN} 4:5 aspect ratio.",
    NEG_PROD, ["gradiente", "pastel", "frasco", "beleza"], "cc0prod",
    "Foto principal de linha de beleza e skincare.", True)
add(C, "Textura de creme em macro",
    f"Amostra de [creme, gel, sérum] espalhada em pincelada sobre superfície de vidro fosco, textura real com picos e brilho natural, lente macro 100 mm, f/5.6, luz lateral rasante, fundo na cor do produto. A cor e a consistência devem seguir a foto de referência da textura. Formato 1:1.",
    f"Swatch of [cream, gel, serum] spread in a brush stroke on frosted glass, real texture with peaks and natural sheen, 100mm macro lens, f/5.6, raking side light, background in the product's color. Color and consistency must follow the texture reference photo. 1:1 aspect ratio.",
    "textura inventada, cor alterada, brilho plástico, bolhas, marca d'água", ["textura", "swatch", "macro", "skincare"], "wiki_macro",
    "Mostrar sensorial do produto; carrossel e anúncio.")
add(C, "Cena de spa com pedra e água",
    f"[Produto de cuidado] sobre pedra lisa clara ao lado de água cristalina rasa com leves ondulações, folha verde desfocada no primeiro plano, luz suave difusa e fresca. Lente 90 mm, f/5.6. Paleta branca, verde e tons de pedra. {ID_PT} Formato 4:5.",
    f"[Care product] on a smooth light stone beside shallow crystal clear water with gentle ripples, green leaf blurred in the foreground, soft, fresh diffused light. 90mm lens, f/5.6. White, green and stone palette. {ID_EN} 4:5 aspect ratio.",
    NEG_PROD, ["spa", "natural", "água", "pedra"], "youmind",
    "Linhas naturais, clínicas de estética, bem-estar.")
add(C, "Bastão de maquiagem em ângulo herói",
    f"[Batom ou bastão] aberto em diagonal com a tampa ao lado, ponta nítida mostrando o formato real, sobre superfície da mesma cor do produto (tom sobre tom), luz dura pequena criando sombra definida. Lente macro 100 mm, f/8. {ID_PT} Formato 4:5.",
    f"[Lipstick or stick] open on a diagonal with the cap beside it, sharp tip showing the real shape, on a surface matching the product color (tone on tone), small hard light casting a defined shadow. 100mm macro lens, f/8. {ID_EN} 4:5 aspect ratio.",
    NEG_PROD + ", cor do produto alterada", ["maquiagem", "tom sobre tom", "macro"], "cc0prod",
    "Lançamento de cor, maquiagem.")
add(C, "Cáusticas de sol em frasco de vidro",
    f"[Frasco de vidro] sobre superfície clara com luz de sol dura e baixa atravessando o vidro e o líquido, projetando cáusticas coloridas e sombra longa na superfície, estética de verão elegante. Lente 70 mm, f/8. {ID_PT} Formato 4:5.",
    f"[Glass bottle] on a light surface with low hard sunlight passing through glass and liquid, casting colored caustics and a long shadow on the surface, elegant summer look. 70mm lens, f/8. {ID_EN} 4:5 aspect ratio.",
    NEG_PROD + ", cáusticas cobrindo o rótulo", ["cáusticas", "sol", "vidro", "verão"], "wiki_duramole",
    "Perfumes, óleos, séruns em vidro.", True)
add(C, "Bancada de banheiro real",
    f"[Produto] sobre bancada de banheiro clara, azulejo ou pedra ao fundo desfocado, toalha dobrada e planta pequena, luz natural de janela difusa, sensação de rotina real e limpa. Lente 50 mm, f/2.8. {ID_PT} Formato 4:5.",
    f"[Product] on a light bathroom counter, tiles or stone blurred behind, folded towel and small plant, diffused natural window light, a clean real routine feel. 50mm lens, f/2.8. {ID_EN} 4:5 aspect ratio.",
    NEG_PROD + ", banheiro bagunçado", ["banheiro", "rotina", "lifestyle"], "cc0prod",
    "Mostrar o produto no dia a dia; anúncios UGC.")
add(C, "Linha completa em degraus",
    f"Linha de produtos [nomes] organizada em degraus de acrílico ou blocos de gesso de alturas diferentes, do maior para o menor, fundo na cor da linha, luz de softbox ampla frontal e recortes laterais, todos os rótulos legíveis. Lente 70 mm, f/11. {ID_PT} Formato 16:9 ou 1:1.",
    f"Product line [names] arranged on acrylic steps or plaster blocks of different heights, largest to smallest, background in the line's color, broad front softbox and side rims, all labels readable. 70mm lens, f/11. {ID_EN} 16:9 or 1:1 aspect ratio.",
    NEG_PROD + ", produto a mais ou a menos", ["linha", "família de produtos", "banner"], "adobe",
    "Banner de site e capa de catálogo.")
add(C, "Conta-gotas com gota suspensa",
    f"Pipeta de [sérum] segurada acima do frasco com uma gota suspensa nítida prestes a cair, fundo claro desfocado, contraluz para a gota brilhar, lente macro 100 mm, f/5.6, velocidade 1/1000 s. {ID_PT} Formato 4:5.",
    f"Dropper of [serum] held above the bottle with a sharp droplet hanging about to fall, light blurred background, backlight so the droplet sparkles, 100mm macro lens, f/5.6, 1/1000 s. {ID_EN} 4:5 aspect ratio.",
    NEG_PROD + ", gota gigante, líquido com cor alterada", ["sérum", "gota", "macro", "contraluz"], "evolink",
    "Séruns e óleos faciais.")
add(C, "Pó compacto com textura revelada",
    f"[Pó compacto ou sombra] aberto, com uma pequena parte do pó delicadamente esfarelada ao lado para mostrar a textura real, espelho sem reflexo do estúdio, vista superior a 60 graus, luz difusa ampla. Lente macro 100 mm, f/8. {ID_PT} Formato 1:1.",
    f"[Pressed powder or eyeshadow] open, with a small portion delicately crumbled beside it to show the real texture, mirror without studio reflections, 60 degree top view, broad diffused light. 100mm macro lens, f/8. {ID_EN} 1:1 aspect ratio.",
    NEG_PROD + ", cor do pó alterada, pó espalhado demais", ["maquiagem", "textura", "pó"], "cc0prod",
    "Maquiagem, cores de coleção.")
add(C, "Perfume com reflexo em acrílico",
    f"[Frasco de perfume] sobre base de acrílico preto brilhante com reflexo espelhado limpo, fundo em gradiente suave [cor], luz de recorte traseira desenhando as bordas do vidro e softbox frontal alta para o rótulo. Lente 100 mm, f/11. Exposição clara e correta. {ID_PT} Formato 4:5.",
    f"[Perfume bottle] on a glossy black acrylic base with a clean mirrored reflection, soft [color] gradient background, back rim light tracing the glass edges and a high front softbox for the label. 100mm lens, f/11. Bright, correct exposure. {ID_EN} 4:5 aspect ratio.",
    NEG_PROD, ["perfume", "reflexo", "acrílico", "premium"], "wiki_contraluz",
    "Perfumaria e presentes.")
add(C, "Ingredientes da fórmula ao redor",
    f"[Produto] cercado pelos ingredientes ativos que constam na fórmula ([lista informada], ex. fatias de pepino, flor de camomila), dispostos com leveza, superfície clara, luz natural difusa, lente 90 mm, f/8. Nenhum ingrediente fora da lista. {ID_PT} Formato 4:5.",
    f"[Product] surrounded by the active ingredients listed in the formula ([provided list], e.g. cucumber slices, chamomile flower), arranged lightly, light surface, diffused natural light, 90mm lens, f/8. No ingredient outside the list. {ID_EN} 4:5 aspect ratio.",
    NEG_PROD + ", ingrediente não informado", ["ingredientes", "fórmula", "natural"], "shopify",
    "Comunicar ativos sem prometer efeito.")
add(C, "Rotina de cuidados em flat lay",
    f"Vista superior dos produtos da rotina [etapas: limpeza, tratamento, hidratação] em sequência da esquerda para a direita, com pequenas amostras de textura ao lado de cada um, fundo [cor clara], softbox superior, lente 50 mm, f/8. {ID_PT} Formato 4:5.",
    f"Top down view of the routine products [steps: cleanse, treat, moisturize] in sequence from left to right, with small texture swatches beside each, [light color] background, overhead softbox, 50mm lens, f/8. {ID_EN} 4:5 aspect ratio.",
    NEG_PROD, ["rotina", "flat lay", "passo a passo", "carrossel"], "cc0prod",
    "Carrossel educativo de rotina.")

# ------------------------------------------------------------------ moda
C = "moda"
add(C, "Flat lay de look completo",
    f"Vista superior de [peça principal] passada e alinhada, com acessórios do look ([ex. cinto, sapato, bolsa]) ao redor, composição equilibrada, fundo de [cor ou textura clara], softbox superior grande com sombras curtas, lente 35 mm, f/8. Cor e estampa do tecido fiéis à referência. {ID_PT} Formato 4:5.",
    f"Top down view of [main garment] pressed and aligned, with the outfit's accessories ([e.g. belt, shoes, bag]) around it, balanced composition, [light color or texture] background, large overhead softbox with short shadows, 35mm lens, f/8. Fabric color and print true to the reference. {ID_EN} 4:5 aspect ratio.",
    NEG_PROD + ", amassados, estampa alterada, fiapos", ["flat lay", "look", "vista superior", "loja"], "wiki_moda",
    "Montar looks para feed e e-commerce sem modelo.", True)
add(C, "Manequim invisível em fundo branco",
    f"[Peça de roupa] com efeito de manequim invisível (ghost mannequin), volume natural do corpo, gola e interior visíveis, fundo branco puro, luz uniforme de duas softboxes frontais laterais, lente 70 mm, f/11. Caimento, cor, estampa e costuras exatamente como na foto de referência. Formato 4:5.",
    f"[Garment] with an invisible ghost mannequin effect, natural body volume, collar and inside visible, pure white background, even light from two front side softboxes, 70mm lens, f/11. Fit, color, print and seams exactly as in the reference photo. 4:5 aspect ratio.",
    NEG_PROD + ", manequim visível, caimento inventado", ["ghost mannequin", "fundo branco", "e-commerce"], "shopify",
    "Catálogo de roupas para loja virtual.")
add(C, "Macro de tecido e trama",
    f"Close-up macro do tecido de [peça], trama e fibras visíveis, luz rasante lateral para revelar relevo, lente macro 100 mm, f/8, cor fiel. Mostra etiqueta de composição só se estiver na foto enviada. {ID_PT}",
    f"Macro close-up of the fabric of [garment], weave and fibers visible, raking side light revealing relief, 100mm macro lens, f/8, true color. Show the composition tag only if it is in the provided photo. {ID_EN}",
    NEG_PROD + ", trama inventada", ["tecido", "macro", "qualidade"], "wiki_macro",
    "Provar qualidade do tecido.")
add(C, "Calçado três quartos em cor sólida",
    f"[Calçado] em ângulo de três quartos a partir da frente, levemente elevado, sobre superfície e fundo em cor sólida [cor], sombra macia, luz principal de softbox a 45 graus e recorte traseiro realçando o material. Lente 90 mm, f/11. {ID_PT} Formato 1:1.",
    f"[Shoe] at a three quarter front angle, slightly raised, on a solid [color] surface and background, soft shadow, softbox key at 45 degrees and back rim highlighting the material. 90mm lens, f/11. {ID_EN} 1:1 aspect ratio.",
    NEG_PROD + ", cadarço inventado, sola alterada", ["calçado", "três quartos", "cor sólida"], "cc0prod",
    "Lojas de calçados e tênis.")
add(C, "Peça no cabide em parede texturizada",
    f"[Peça] pendurada em cabide de madeira contra parede de reboco claro texturizado, luz de janela lateral suave criando leve sombra na parede, caimento natural, lente 50 mm, f/5.6. {ID_PT} Formato 4:5.",
    f"[Garment] hanging on a wooden hanger against a light textured plaster wall, soft side window light creating a gentle shadow on the wall, natural drape, 50mm lens, f/5.6. {ID_EN} 4:5 aspect ratio.",
    NEG_PROD + ", amassados, cabide de plástico", ["cabide", "parede", "minimalista"], "youmind",
    "Brechós, marcas autorais e slow fashion.")
add(C, "Bolsa em pedestal de estúdio",
    f"[Bolsa] em pé sobre bloco de gesso, alça naturalmente apoiada, fundo em tom [cor], luz principal de softbox a 45 graus, rebatedor e recorte suave para realçar o couro ou tecido. Lente 85 mm, f/11. {ID_PT} Formato 4:5.",
    f"[Bag] standing on a plaster block, handle resting naturally, [color] toned background, softbox key at 45 degrees, bounce and soft rim to bring out the leather or fabric. 85mm lens, f/11. {ID_EN} 4:5 aspect ratio.",
    NEG_PROD + ", ferragens inventadas", ["bolsa", "acessório", "pedestal"], "cc0prod",
    "Acessórios e marroquinaria.")
add(C, "Joia em macro com luz de tenda",
    f"[Joia] em macro sobre superfície de [veludo ou pedra clara], luz difusa de tenda envolvendo a peça para brilho limpo no metal sem reflexos do estúdio, um ponto de luz pequeno para faísca nas pedras, lente macro 100 mm, f/11 com empilhamento de foco. {ID_PT} Formato 1:1.",
    f"[Jewelry] in macro on a [velvet or light stone] surface, diffused light tent wrapping the piece for clean metal shine without studio reflections, one small point light for sparkle in the stones, 100mm macro lens, f/11 with focus stacking. {ID_EN} 1:1 aspect ratio.",
    NEG_PROD + ", pedras inventadas, metal com cor alterada", ["joia", "macro", "tenda de luz"], "adobe",
    "Joalherias e semijoias.")
add(C, "Look vestido em modelo autorizado na rua",
    f"{GENTE_PT} A pessoa veste [peça] em cenário urbano de [rua com fachada clara], luz de fim de tarde lateral, postura natural caminhando, corpo inteiro, lente 85 mm, f/2.8, fundo desfocado. Caimento e cor da peça fiéis à foto do produto. Formato 4:5.",
    f"{GENTE_EN} The person wears [garment] in an urban setting of [street with light facade], late afternoon side light, natural walking posture, full body, 85mm lens, f/2.8, blurred background. Garment fit and color true to the product photo. 4:5 aspect ratio.",
    NEG_GENTE + ", peça com cor alterada", ["modelo", "rua", "editorial", "pessoa autorizada"], "wiki_moda",
    "Editorial com modelo do cliente, com autorização.")
add(C, "Pilha de peças dobradas",
    f"Pilha de [peças básicas] dobradas com precisão em cores [lista], vista frontal levemente de cima, fundo claro neutro, luz de softbox lateral suave, lente 70 mm, f/8. Cores exatamente como as variantes reais. Formato 4:5.",
    f"Stack of [basic garments] precisely folded in [color list], front view slightly from above, neutral light background, soft side softbox light, 70mm lens, f/8. Colors exactly as the real variants. 4:5 aspect ratio.",
    NEG_PROD + ", cor inventada", ["básicos", "cores", "variantes", "pilha"], "shopify",
    "Mostrar grade de cores de uma peça.")
add(C, "Óculos com reflexo controlado",
    f"[Óculos] abertos, apoiados em ângulo de três quartos sobre superfície clara, lentes sem reflexos do estúdio, sombra colorida suave da lente na superfície, luz difusa ampla, lente 100 mm, f/11. {ID_PT} Formato 1:1.",
    f"[Glasses] open, resting at a three quarter angle on a light surface, lenses without studio reflections, soft tinted lens shadow on the surface, broad diffused light, 100mm lens, f/11. {ID_EN} 1:1 aspect ratio.",
    NEG_PROD + ", haste torta", ["óculos", "ótica", "acessório"], "adobe",
    "Óticas e marcas de óculos.")
add(C, "Relógio com mostrador legível",
    f"[Relógio] em ângulo de três quartos apoiado na pulseira, ponteiros em 10h10, mostrador nítido e sem reflexos, luz de tenda difusa com uma faixa de brilho no vidro, fundo [cor], lente macro 100 mm, f/11. {ID_PT} Formato 1:1.",
    f"[Watch] at a three quarter angle resting on its strap, hands at 10:10, sharp dial without reflections, diffused tent light with one highlight stripe on the crystal, [color] background, 100mm macro lens, f/11. {ID_EN} 1:1 aspect ratio.",
    NEG_PROD + ", números inventados no mostrador", ["relógio", "10h10", "acessório"], "cc0prod",
    "Relojoarias e acessórios.")
add(C, "Arara de coleção na loja",
    f"Arara com as peças da coleção [nome] organizadas por cor em loja clara, luz ambiente equilibrada com luz de janela, lente 35 mm, f/5.6, verticais retas. Peças e cores fiéis às fotos enviadas. Formato 4:5.",
    f"Clothing rack with the [name] collection pieces organized by color in a bright store, ambient light balanced with window light, 35mm lens, f/5.6, straight verticals. Pieces and colors true to the provided photos. 4:5 aspect ratio.",
    NEG_AMB + ", peças inventadas", ["coleção", "arara", "loja física"], "wiki_moda",
    "Anunciar chegada de coleção em loja física.")

# ------------------------------------------------------------------ tecnologia
C = "tecnologia"
add(C, "Dispositivo em mesa minimalista",
    f"[Dispositivo] em ângulo de três quartos sobre mesa minimalista clara, luz lateral suave de uma softbox grande com gradiente de brilho limpo nas superfícies, reflexos controlados, fundo desfocado de escritório claro. Lente 85 mm, f/5.6. Portas, botões e câmeras só onde existem na foto de referência. {ID_PT} Formato 4:5.",
    f"[Device] at a three quarter angle on a light minimalist desk, soft side light from a large softbox with a clean highlight gradient on the surfaces, controlled reflections, blurred bright office background. 85mm lens, f/5.6. Ports, buttons and cameras only where they exist in the reference photo. {ID_EN} 4:5 aspect ratio.",
    NEG_PROD + ", portas inventadas, botões inventados", ["tecnologia", "três quartos", "mesa"], "wiki_duramole",
    "Foto principal de eletrônicos e acessórios.", True)
add(C, "Tela com conteúdo fornecido",
    f"[Dispositivo com tela] de frente levemente rotacionado, tela mostrando exatamente a imagem fornecida [arquivo da tela] ou tela apagada com reflexo suave, sem inventar interface. Luz difusa, fundo [cor], lente 90 mm, f/8. {ID_PT} Formato 4:5.",
    f"[Device with screen] facing forward with a slight turn, screen showing exactly the provided image [screen file] or switched off with a soft reflection, no invented interface. Diffused light, [color] background, 90mm lens, f/8. {ID_EN} 4:5 aspect ratio.",
    NEG_PROD + ", interface inventada, texto na tela", ["tela", "app", "mockup"], "openai",
    "Divulgar app ou sistema no aparelho real.")
add(C, "Portas e conectores documentados",
    f"Close-up da lateral de [dispositivo] mostrando as portas e conectores exatamente como na foto de referência, luz rasante para relevo, lente macro 100 mm, f/8. {ID_PT} Se a lateral não foi fotografada, não use esta tomada.",
    f"Close-up of the side of [device] showing ports and connectors exactly as in the reference photo, raking light for relief, 100mm macro lens, f/8. {ID_EN} If the side was not photographed, do not use this shot.",
    NEG_PROD + ", portas inventadas", ["detalhe", "conectores", "especificação"], "shopify",
    "Responder dúvidas técnicas de compatibilidade.")
add(C, "Fone flutuando em gradiente",
    f"[Fone de ouvido] flutuando em ângulo dinâmico sobre fundo gradiente de [cor 1] para [cor 2], luz de recorte colorida de um lado e softbox branca do outro, sombra suave abaixo. Lente 85 mm, f/8. {ID_PT} Formato 1:1.",
    f"[Headphones] floating at a dynamic angle over a gradient background from [color 1] to [color 2], colored rim light on one side and white softbox on the other, soft shadow below. 85mm lens, f/8. {ID_EN} 1:1 aspect ratio.",
    NEG_PROD, ["áudio", "flutuante", "gradiente"], "evolink",
    "Anúncio de acessórios de áudio.")
add(C, "Setup de home office",
    f"[Produto] integrado a um setup de home office organizado: mesa de madeira clara, planta, luminária, notebook fechado, luz de janela lateral de manhã, lente 35 mm, f/4, câmera a 30 graus. O produto em destaque no terço direito. {ID_PT} Formato 16:9.",
    f"[Product] integrated into a tidy home office setup: light wood desk, plant, lamp, closed laptop, morning side window light, 35mm lens, f/4, camera at 30 degrees. Product featured on the right third. {ID_EN} 16:9 aspect ratio.",
    NEG_PROD + ", cabos bagunçados, telas com texto", ["home office", "setup", "lifestyle"], "youmind",
    "Periféricos, móveis de escritório, acessórios.")
add(C, "Aparelho em uso nas mãos",
    f"Mãos naturais usando [dispositivo] em situação real ([ex. no sofá, no café]), sem rosto, luz ambiente suave, lente 50 mm, f/2.8, escala realista. {ID_PT} Formato 4:5.",
    f"Natural hands using [device] in a real situation ([e.g. on the sofa, at a cafe]), no face, soft ambient light, 50mm lens, f/2.8, realistic scale. {ID_EN} 4:5 aspect ratio.",
    NEG_PROD + ", mãos deformadas, dedos extras", ["uso", "mãos", "ugc"], "cc0prod",
    "Anúncios com cara de uso real.")
add(C, "Keynote com luz dura geométrica",
    f"[Produto] em fundo cinza grafite médio, faixa de luz dura estreita cruzando o produto em diagonal e revelando sua silhueta, estética de apresentação de lançamento tecnológico, exposição do produto correta e legível. Lente 100 mm, f/11. {ID_PT} Formato 16:9 com espaço à esquerda para texto.",
    f"[Product] on a medium graphite gray background, a narrow hard light band crossing the product diagonally and revealing its silhouette, tech launch keynote look, product correctly exposed and readable. 100mm lens, f/11. {ID_EN} 16:9 aspect ratio with space on the left for text.",
    NEG_PROD + ", produto subexposto", ["keynote", "lançamento", "tech", "16:9"], "wiki_chiaro",
    "Lançamento de produto tecnológico e banners de site.")
add(C, "Acessórios do kit em grade",
    f"Vista superior de [dispositivo] com todos os acessórios reais da caixa (cabos, carregador, manual) em grade alinhada, fundo branco, luz superior difusa, lente 50 mm, f/11. Nenhum acessório que não vem na caixa. {ID_PT} Formato 1:1.",
    f"Top down view of [device] with every real in box accessory (cables, charger, manual) in an aligned grid, white background, diffused overhead light, 50mm lens, f/11. No accessory that is not in the box. {ID_EN} 1:1 aspect ratio.",
    NEG_PROD + ", acessórios inventados", ["kit", "knolling", "conteúdo da caixa"], "cc0prod",
    "Mostrar o que vem na caixa.")
add(C, "Eletrodoméstico em cozinha real",
    f"[Eletrodoméstico] sobre bancada de cozinha clara e organizada, ingredientes coerentes com o uso ao lado, luz de janela lateral, lente 35 mm, f/5.6, câmera na altura da bancada levemente acima, escala realista. {ID_PT} Formato 4:5.",
    f"[Appliance] on a clean, light kitchen counter, ingredients that fit its use beside it, side window light, 35mm lens, f/5.6, camera at counter height slightly above, realistic scale. {ID_EN} 4:5 aspect ratio.",
    NEG_PROD + ", escala errada, cozinha bagunçada", ["cozinha", "eletrodoméstico", "lifestyle"], "adobe",
    "Lojas de eletrodomésticos e utilidades.")
add(C, "Vestível no pulso",
    f"[Relógio inteligente ou pulseira] no pulso de uma pessoa (sem rosto), braço em posição natural apoiado, tela com a imagem fornecida ou apagada, luz lateral suave externa, lente 85 mm, f/2.8, fundo desfocado de [ambiente]. {ID_PT} Formato 4:5.",
    f"[Smartwatch or band] on a person's wrist (no face), arm resting naturally, screen showing the provided image or switched off, soft outdoor side light, 85mm lens, f/2.8, blurred [setting] background. {ID_EN} 4:5 aspect ratio.",
    NEG_PROD + ", interface inventada, pulso deformado", ["vestível", "pulso", "esporte"], "cc0prod",
    "Vestíveis e acessórios esportivos.")
add(C, "Cabo e carregador em cor sólida",
    f"[Cabo ou carregador] enrolado em curva elegante sobre fundo de cor sólida [cor], conectores nítidos e fiéis à referência, luz de softbox superior com sombra suave, lente macro 100 mm, f/11. {ID_PT} Formato 1:1.",
    f"[Cable or charger] coiled in an elegant curve on a solid [color] background, connectors sharp and true to the reference, overhead softbox with soft shadow, 100mm macro lens, f/11. {ID_EN} 1:1 aspect ratio.",
    NEG_PROD + ", conector inventado", ["cabo", "carregador", "acessório"], "cc0prod",
    "Acessórios de baixo custo em marketplace.")

# ------------------------------------------------------------------ pessoa
C = "pessoa"
add(C, "Retrato corporativo com luz de janela",
    f"{GENTE_PT} Retrato corporativo do peito para cima, roupa [descrição], fundo de escritório claro desfocado, luz de janela grande a 45 graus como luz principal, rebatedor branco do outro lado, reflexo de luz nos olhos. Lente 85 mm, f/2.8, câmera na altura dos olhos. Expressão natural e confiante. Formato 4:5.",
    f"{GENTE_EN} Corporate head and shoulders portrait, clothing [description], blurred bright office background, large window at 45 degrees as key light, white bounce on the other side, catchlight in the eyes. 85mm lens, f/2.8, camera at eye level. Natural, confident expression. 4:5 aspect ratio.",
    NEG_GENTE, ["corporativo", "retrato", "linkedin", "luz de janela"], "wiki_retrato",
    "Foto de perfil profissional, site institucional, LinkedIn.", True)
add(C, "Headshot de estúdio em três pontos",
    f"{GENTE_PT} Headshot em estúdio, fundo cinza médio liso, luz principal em softbox octogonal a 45 graus e acima dos olhos, preenchimento suave do lado oposto a 1/3 da intensidade, luz de cabelo por trás para separar do fundo. Lente 85 mm, f/5.6. Formato 4:5.",
    f"{GENTE_EN} Studio headshot, plain mid gray background, key light from an octagonal softbox at 45 degrees and above eye level, soft fill opposite at one third the intensity, hair light from behind to separate from the background. 85mm lens, f/5.6. 4:5 aspect ratio.",
    NEG_GENTE, ["headshot", "estúdio", "três pontos"], "wiki_3pt",
    "Equipe, palestrantes, profissionais liberais.")
add(C, "Retrato no próprio negócio",
    f"{GENTE_PT} A pessoa no seu ambiente de trabalho real ([ex. cozinha do restaurante, bancada da oficina, consultório]), plano médio, olhando para a câmera ou fazendo seu ofício, luz ambiente equilibrada com luz de janela, lente 35 mm, f/2.8, fundo com elementos do negócio levemente desfocados. Formato 4:5.",
    f"{GENTE_EN} The person in their real workplace ([e.g. restaurant kitchen, workshop bench, office]), medium shot, looking at camera or doing their craft, ambient light balanced with window light, 35mm lens, f/2.8, business elements slightly blurred behind. 4:5 aspect ratio.",
    NEG_GENTE + ", ambiente inventado", ["retrato ambientado", "dono", "história", "negócio"], "wiki_retrato",
    "Contar a história do dono; posts de bastidores e sobre nós.", True)
add(C, "Luz Rembrandt editorial",
    f"{GENTE_PT} Retrato editorial com luz Rembrandt: uma fonte principal a 45 graus lateral e acima, formando o pequeno triângulo de luz na bochecha do lado da sombra, rebatedor fraco para manter detalhes, fundo [cor escura suave]. Lente 85 mm, f/4. Exposição do rosto correta. Formato 4:5.",
    f"{GENTE_EN} Editorial portrait with Rembrandt lighting: one key source at 45 degrees to the side and above, forming the small triangle of light on the shadow side cheek, weak bounce to keep detail, [soft dark color] background. 85mm lens, f/4. Correct face exposure. 4:5 aspect ratio.",
    NEG_GENTE + ", rosto subexposto", ["rembrandt", "editorial", "dramático"], "wiki_rembrandt",
    "Perfis autorais, advogados, consultores.")
add(C, "Luz borboleta para beleza",
    f"{GENTE_PT} Retrato de beleza com luz borboleta: beauty dish centralizado acima e à frente do rosto criando pequena sombra sob o nariz, rebatedor abaixo do queixo, fundo claro. Lente 100 mm, f/8. Pele com textura real. Formato 4:5.",
    f"{GENTE_EN} Beauty portrait with butterfly lighting: beauty dish centered above and in front of the face creating a small shadow under the nose, bounce below the chin, light background. 100mm lens, f/8. Skin with real texture. 4:5 aspect ratio.",
    NEG_GENTE, ["borboleta", "beauty dish", "beleza", "salão"], "wiki_butterfly",
    "Salões, estética, maquiadoras (com autorização).")
add(C, "Retrato externo na hora dourada",
    f"{GENTE_PT} Retrato ao ar livre no fim da tarde, sol baixo atrás da pessoa criando luz de recorte dourada no cabelo, rebatedor dourado suave na frente para iluminar o rosto, fundo de vegetação desfocado. Lente 85 mm, f/2. Formato 4:5.",
    f"{GENTE_EN} Outdoor portrait late afternoon, low sun behind the person creating golden rim light in the hair, soft gold reflector in front to light the face, blurred foliage background. 85mm lens, f/2. 4:5 aspect ratio.",
    NEG_GENTE + ", rosto contra a luz sem detalhe", ["golden hour", "externa", "retrato"], "wiki_golden",
    "Retratos leves para redes sociais.")
add(C, "Equipe em grupo com fotos autorizadas",
    f"Foto de equipe com [número] pessoas, cada uma baseada somente na sua própria foto autorizada; preserve rosto, idade, tom de pele e corpo de cada pessoa. Disposição em duas fileiras com alturas variadas, fundo [ambiente da empresa] desfocado, luz ampla e uniforme de duas softboxes grandes, lente 50 mm, f/8 para todos nítidos. Formato 16:9.",
    f"Team photo with [number] people, each based only on their own authorized photo; preserve each person's face, age, skin tone and body. Two rows at varied heights, blurred [company setting] background, broad even light from two large softboxes, 50mm lens, f/8 so everyone is sharp. 16:9 aspect ratio.",
    NEG_GENTE + ", pessoas inventadas, rostos misturados", ["equipe", "grupo", "institucional"], "wiki_retrato",
    "Página sobre nós, recrutamento.")
add(C, "Mãos do ofício em ação",
    f"Close-up das mãos de [profissional] trabalhando ([ex. sovando massa, costurando, montando peça]), sem rosto, luz lateral de janela, lente 85 mm, f/2.8, velocidade 1/250 s. Mãos naturais baseadas na foto autorizada, sem alterar forma ou tom de pele. Formato 4:5.",
    f"Close-up of [professional]'s hands at work ([e.g. kneading dough, sewing, assembling]), no face, side window light, 85mm lens, f/2.8, 1/250 s. Natural hands based on the authorized photo, without changing shape or skin tone. 4:5 aspect ratio.",
    "mãos deformadas, dedos extras, pele de plástico, anéis inventados, marca d'água", ["mãos", "ofício", "artesanal", "processo"], "wiki_retrato",
    "Mostrar processo e cuidado sem expor o rosto.")
add(C, "Tratar luz e cor de retrato existente",
    f"Edite somente luz e cor desta foto: corrija exposição, balanço de branco para pele natural, abra levemente as sombras do rosto e recupere altas luzes. Não altere rosto, expressão, idade, corpo, cabelo, roupa, pose nem fundo. Resultado deve parecer a mesma foto bem revelada.",
    f"Edit only the light and color of this photo: fix exposure, white balance for natural skin, gently open face shadows and recover highlights. Do not change face, expression, age, body, hair, clothing, pose or background. The result must look like the same photo, well developed.",
    NEG_GENTE + ", fundo alterado, pele lisa demais", ["tratar", "luz e cor", "retoque", "edição"], "openai",
    "Modo Tratar luz e cor em foto de pessoa do cliente.", True)
add(C, "Trocar o fundo preservando a pessoa",
    f"Mantenha a pessoa exatamente como está na foto (rosto, cabelo, roupa, pose, contorno e luz no corpo) e troque apenas o fundo por [novo fundo, ex. escritório claro desfocado], ajustando a luz do fundo para combinar com a direção e a temperatura da luz no rosto. Bordas do cabelo naturais, sem halo.",
    f"Keep the person exactly as in the photo (face, hair, clothing, pose, outline and light on the body) and replace only the background with [new background, e.g. blurred bright office], matching the background light to the direction and temperature of the light on the face. Natural hair edges, no halo.",
    NEG_GENTE + ", halo no contorno, luz incoerente", ["trocar fundo", "preservar", "recorte"], "openai",
    "Modo Preservar com máscara na pessoa.")
add(C, "Avatar quadrado para perfil",
    f"{GENTE_PT} Retrato de perfil enquadrado do peito para cima, rosto centralizado com espaço acima da cabeça, fundo liso em [cor da marca, HEX] suave, luz frontal ampla e rebatedor, lente 85 mm, f/4. Pensado para recorte circular. Formato 1:1.",
    f"{GENTE_EN} Profile portrait framed chest up, face centered with room above the head, plain soft [brand color, HEX] background, broad front light and bounce, 85mm lens, f/4. Designed for circular crop. 1:1 aspect ratio.",
    NEG_GENTE, ["avatar", "perfil", "1:1", "cor da marca"], "bflhex",
    "Foto de perfil em redes e WhatsApp Business.")
add(C, "Bastidores espontâneos",
    f"{GENTE_PT} Foto espontânea de bastidores: a pessoa rindo ou conversando durante o trabalho, câmera discreta a 35 mm, f/2, luz ambiente real do local, leve granulação natural, enquadramento documental. Formato 4:5.",
    f"{GENTE_EN} Candid behind the scenes photo: the person laughing or talking while working, discreet 35mm camera, f/2, the location's real ambient light, light natural grain, documentary framing. 4:5 aspect ratio.",
    NEG_GENTE + ", pose forçada", ["bastidores", "espontâneo", "documental", "stories"], "zerolu",
    "Stories e posts de humanização da marca.")

# ------------------------------------------------------------------ ambiente
C = "ambiente"
add(C, "Interior comercial com verticais retas",
    f"Interior de [restaurante, loja, clínica] fotografado com lente 24 mm tilt-shift, câmera na altura de 1,2 m, linhas verticais perfeitamente retas, luz natural de janela equilibrada com a luz interna quente, exposição que mostra detalhes nas janelas e nas sombras sem HDR exagerado. Ambiente limpo e organizado, sem pessoas. Mantenha móveis e acabamentos como na foto de referência. Formato 4:5 ou 16:9.",
    f"Interior of [restaurant, store, clinic] shot with a 24mm tilt shift lens, camera at 1.2 m height, perfectly straight vertical lines, natural window light balanced with warm interior light, exposure holding detail in windows and shadows without overdone HDR. Clean, tidy space, no people. Keep furniture and finishes as in the reference photo. 4:5 or 16:9 aspect ratio.",
    NEG_AMB, ["interior", "verticais", "arquitetura", "loja"], "wiki_arq",
    "Google Meu Negócio, site, apresentar o espaço.", True)
add(C, "Fachada na hora azul",
    f"Fachada de [estabelecimento] na hora azul logo após o pôr do sol, luzes internas e letreiro acesos, céu azul profundo equilibrado com a luz quente da fachada, câmera em tripé, lente 24 mm, f/8, verticais corrigidas. Fachada e letreiro exatamente como na foto de referência. Formato 4:5.",
    f"Facade of [business] at blue hour just after sunset, interior lights and sign on, deep blue sky balanced with the warm facade light, camera on tripod, 24mm lens, f/8, corrected verticals. Facade and sign exactly as in the reference photo. 4:5 aspect ratio.",
    NEG_AMB + ", letreiro com texto alterado", ["fachada", "hora azul", "noturna"], "bfl",
    "Apresentar o endereço; perfil do Google e capa.")
add(C, "Consultório ou escritório clean",
    f"[Consultório ou escritório] claro e organizado, mobiliário como na foto de referência, luz natural difusa de janelas grandes, plantas, paleta branca e madeira clara, lente 24 mm, f/8, câmera na altura de 1,2 m, verticais retas, sem pessoas. Formato 16:9.",
    f"Bright, tidy [clinic or office], furniture as in the reference photo, diffused natural light from large windows, plants, white and light wood palette, 24mm lens, f/8, camera at 1.2 m height, straight verticals, no people. 16:9 aspect ratio.",
    NEG_AMB, ["consultório", "escritório", "saúde", "clean"], "wiki_arq",
    "Clínicas, escritórios de advocacia e contabilidade.")
add(C, "Quarto de pousada acolhedor",
    f"Quarto de [pousada ou hotel] com cama arrumada com enxoval branco, luz de manhã entrando pela janela, abajures acesos com luz quente suave, lente 24 mm, f/8, câmera no canto na altura do peito, verticais retas. Mobiliário e vista da janela como na foto de referência. Formato 4:5.",
    f"[Guesthouse or hotel] room with a made bed in white linens, morning light through the window, bedside lamps on with soft warm light, 24mm lens, f/8, camera in the corner at chest height, straight verticals. Furniture and window view as in the reference photo. 4:5 aspect ratio.",
    NEG_AMB + ", vista inventada", ["hotelaria", "quarto", "pousada"], "wiki_arq",
    "Pousadas, hotéis, aluguel por temporada.")
add(C, "Área externa com jardim",
    f"Área externa de [estabelecimento] com jardim e mesas, luz de fim de tarde lateral dourada, sombras longas suaves, céu natural, lente 24 mm, f/8, verticais retas, sem pessoas. Plantas e estrutura como na foto de referência. Formato 16:9.",
    f"Outdoor area of [business] with garden and tables, golden late afternoon side light, soft long shadows, natural sky, 24mm lens, f/8, straight verticals, no people. Plants and structure as in the reference photo. 16:9 aspect ratio.",
    NEG_AMB, ["externa", "jardim", "golden hour"], "wiki_golden",
    "Restaurantes com varanda, pousadas, eventos.")
add(C, "Detalhe de decoração do espaço",
    f"Close de um canto decorado de [espaço] ([ex. prateleira com objetos, luminária, textura de parede]), lente 50 mm, f/2.8, luz natural lateral, fundo do ambiente desfocado. Mostra a personalidade do lugar. Formato 4:5.",
    f"Close view of a decorated corner of [space] ([e.g. shelf with objects, lamp, wall texture]), 50mm lens, f/2.8, natural side light, the room blurred behind. Shows the place's personality. 4:5 aspect ratio.",
    NEG_AMB + ", objetos inventados", ["detalhe", "decoração", "carrossel"], "wiki_dof",
    "Carrossel de ambiente e stories.")
add(C, "Cozinha profissional em serviço",
    f"Cozinha profissional de [restaurante] durante o serviço, equipe desfocada em movimento ao fundo (sem rostos definidos), bancada de inox limpa em primeiro plano com um prato sendo finalizado, luz ambiente da cozinha equilibrada, lente 35 mm, f/2.8, velocidade 1/60 s. Formato 4:5.",
    f"Professional kitchen of [restaurant] during service, team blurred in motion behind (no defined faces), clean stainless steel counter in the foreground with a dish being finished, balanced kitchen ambient light, 35mm lens, f/2.8, 1/60 s. 4:5 aspect ratio.",
    NEG_AMB + ", rostos definidos, sujeira", ["cozinha", "bastidores", "restaurante"], "wiki_food",
    "Bastidores de restaurante.")
add(C, "Vitrine da loja vista de fora",
    f"Vitrine de [loja] vista da calçada, produtos organizados como na foto de referência, reflexos da rua controlados com polarizador, luz interna acesa equilibrada com luz do dia nublado, lente 35 mm, f/8, verticais retas. Formato 4:5.",
    f"[Store] window display seen from the sidewalk, products arranged as in the reference photo, street reflections controlled with a polarizer, interior lights on balanced with overcast daylight, 35mm lens, f/8, straight verticals. 4:5 aspect ratio.",
    NEG_AMB + ", produtos inventados", ["vitrine", "varejo", "loja física"], "wiki_arq",
    "Comércio de rua, campanhas de vitrine.")
add(C, "Salão de beleza pronto para receber",
    f"[Salão de beleza] vazio e arrumado, cadeiras alinhadas, espelhos sem reflexo do fotógrafo, luz ambiente clara e uniforme, lente 24 mm, f/8, câmera na altura de 1,2 m, verticais retas. Acabamentos como na foto de referência. Formato 16:9.",
    f"Empty, tidy [beauty salon], chairs aligned, mirrors without the photographer's reflection, bright even ambient light, 24mm lens, f/8, camera at 1.2 m height, straight verticals. Finishes as in the reference photo. 16:9 aspect ratio.",
    NEG_AMB + ", reflexo do fotógrafo", ["salão", "beleza", "espaço"], "wiki_arq",
    "Salões, barbearias, estúdios.")
add(C, "Espaço de eventos montado",
    f"[Espaço de eventos] montado para [tipo de evento], mesas postas, iluminação cênica quente acesa e luz natural do fim da tarde, lente 24 mm, f/8, câmera elevada a 1,6 m, verticais retas, sem pessoas. Estrutura como na foto de referência. Formato 16:9.",
    f"[Event venue] set up for [event type], tables set, warm scenic lighting on with late afternoon natural light, 24mm lens, f/8, camera raised to 1.6 m, straight verticals, no people. Structure as in the reference photo. 16:9 aspect ratio.",
    NEG_AMB, ["eventos", "buffet", "casamento"], "wiki_arq",
    "Buffets, salões de festa, espaços de casamento.")

# ------------------------------------------------------------------ estilo
C = "estilo"
add(C, "Minimalista claro escandinavo",
    "Estilo minimalista escandinavo: paleta branca, bege e madeira clara, poucos objetos, muito espaço livre, luz difusa de dia nublado entrando por janela grande, sombras leves e abertas, contraste baixo, cores naturais. Aplique a [assunto].",
    "Scandinavian minimalist style: white, beige and light wood palette, few objects, lots of free space, diffused overcast daylight through a large window, light open shadows, low contrast, natural colors. Apply to [subject].",
    "excesso de objetos, cores saturadas, sombras duras, marca d'água", ["minimalista", "claro", "escandinavo"], "wiki_highkey",
    "Marcas de casa, bem-estar e serviços leves.")
add(C, "Editorial de revista em cor sólida",
    "Estilo editorial de revista: fundo e superfície em uma única cor sólida [HEX], luz dura de fonte única criando sombras gráficas definidas, composição ousada com muito espaço negativo, cores intensas porém fiéis. Aplique a [assunto].",
    "Magazine editorial style: background and surface in a single solid color [HEX], hard single source light casting defined graphic shadows, bold composition with lots of negative space, intense yet faithful colors. Apply to [subject].",
    "degradê, luz difusa sem direção, objetos de apoio, marca d'água", ["editorial", "cor sólida", "sombra dura"], "bflhex",
    "Campanhas de marca com personalidade forte.", True)
add(C, "Filme analógico de grão fino",
    "Estilo de filme negativo colorido de 35 mm: grão fino e natural, tons de pele quentes e fiéis, verdes suaves, contraste médio, leve desbotado nas sombras, luz natural. Aplique a [assunto], sem vinheta exagerada.",
    "35mm color negative film style: fine natural grain, warm faithful skin tones, soft greens, medium contrast, slight lift in the shadows, natural light. Apply to [subject], no heavy vignette.",
    "grão pesado, vinheta forte, vazamento de luz exagerado, cores irreais, marca d'água", ["analógico", "filme", "nostálgico"], "bfl",
    "Moda, gastronomia autoral, marcas com estética afetiva.")
add(C, "Luxo discreto em tons terrosos",
    "Estilo de luxo discreto: paleta de areia, caramelo, oliva e off-white, materiais nobres (linho, travertino, couro natural), luz lateral suave de fim de tarde, composição limpa e simétrica, nada brilhante demais. Aplique a [assunto].",
    "Quiet luxury style: sand, caramel, olive and off white palette, fine materials (linen, travertine, natural leather), soft late afternoon side light, clean symmetrical composition, nothing overly shiny. Apply to [subject].",
    "dourado exagerado, brilho excessivo, ostentação, logotipos, marca d'água", ["luxo", "terroso", "premium"], "youmind",
    "Marcas premium de moda, casa e cosmético.")
add(C, "Tropical brasileiro vibrante",
    "Estilo tropical brasileiro: folhas de costela-de-adão e bananeira, luz de sol dura do meio da manhã com sombras recortadas de folhas, cores vivas (verde, amarelo, azul do céu), superfícies de ladrilho hidráulico ou madeira. Aplique a [assunto].",
    "Brazilian tropical style: monstera and banana leaves, hard mid morning sunlight with cut out leaf shadows, vivid colors (green, yellow, sky blue), patterned cement tile or wood surfaces. Apply to [subject].",
    "clichês turísticos, bandeira, texto, saturação estourada, marca d'água", ["tropical", "brasil", "verão", "vibrante"], "wiki_gobo",
    "Campanhas de verão e marcas com identidade brasileira.")
add(C, "Rústico artesanal",
    "Estilo rústico artesanal: madeira de demolição, tecido cru, cerâmica feita à mão, luz de janela lateral quente, tons de terra, textura evidente, sensação de feito à mão. Aplique a [assunto].",
    "Rustic handmade style: reclaimed wood, raw fabric, handmade ceramics, warm side window light, earth tones, evident texture, a handmade feel. Apply to [subject].",
    "sujeira, poeira, objetos quebrados, marca d'água", ["rústico", "artesanal", "terra"], "wiki_stilllife",
    "Cafés, padarias, empórios, produtos artesanais.")
add(C, "Pop de blocos de cor",
    "Estilo pop com blocos de cor: duas ou três cores sólidas complementares em planos geométricos (fundo, piso, bloco), luz dura frontal levemente lateral, sombras curtas, visual alegre e gráfico. Aplique a [assunto]. Cores: [HEX 1], [HEX 2], [HEX 3].",
    "Pop color blocking style: two or three complementary solid colors in geometric planes (background, floor, block), hard front light slightly to the side, short shadows, cheerful graphic look. Apply to [subject]. Colors: [HEX 1], [HEX 2], [HEX 3].",
    "degradê, texturas, excesso de cores, marca d'água", ["pop", "color blocking", "gráfico", "jovem"], "bflhex",
    "Marcas jovens, bebidas, tecnologia de consumo.")
add(C, "Clínico limpo para saúde",
    "Estilo clínico e limpo: branco, azul claro e cinza, superfícies lisas, luz ampla e uniforme de estúdio, alto nível de nitidez, sem sombras duras, sensação de higiene e confiança. Aplique a [assunto].",
    "Clean clinical style: white, light blue and gray, smooth surfaces, broad even studio light, high sharpness, no hard shadows, a feeling of hygiene and trust. Apply to [subject].",
    "aparência hospitalar fria demais, instrumentos cirúrgicos, sangue, marca d'água", ["saúde", "clínico", "limpo"], "wiki_highkey",
    "Clínicas, farmácias de manipulação, odontologia.")
add(C, "Natural orgânico",
    "Estilo natural orgânico: linho cru, madeira clara, folhas secas e flores do campo, luz de manhã suave e difusa, paleta bege e verde sálvia, composição respirada. Aplique a [assunto].",
    "Natural organic style: raw linen, light wood, dried leaves and wildflowers, soft diffused morning light, beige and sage green palette, airy composition. Apply to [subject].",
    "plástico, cores artificiais, excesso de elementos, marca d'água", ["natural", "orgânico", "sustentável"], "youmind",
    "Produtos naturais, veganos, sustentáveis.")
add(C, "Cinematográfico com cor de cinema",
    "Estilo cinematográfico: proporção 21:9 ou 16:9, cor de cinema com altas luzes quentes e sombras levemente frias, profundidade de campo curta, luz motivada por uma fonte do cenário (janela ou luminária), exposição correta e legível. Aplique a [assunto].",
    "Cinematic style: 21:9 or 16:9 frame, film color grade with warm highlights and slightly cool shadows, shallow depth of field, light motivated by a source in the scene (window or lamp), correct readable exposure. Apply to [subject].",
    "teal e laranja exagerado, imagem escura, barras pretas, marca d'água", ["cinematográfico", "cinema", "16:9"], "bfl",
    "Capas de vídeo, banners largos, campanhas narrativas.")
add(C, "Monocromático tom sobre tom",
    "Estilo monocromático tom sobre tom: fundo, superfície e objetos de apoio em variações de uma mesma cor [HEX], o assunto em destaque por textura e luz lateral suave, sombras coloridas da mesma família. Aplique a [assunto].",
    "Monochrome tone on tone style: background, surface and props in variations of one color [HEX], subject standing out through texture and soft side light, tinted shadows of the same family. Apply to [subject].",
    "cores fora da paleta, contraste de cor forte, marca d'água", ["monocromático", "tom sobre tom", "paleta"], "bflhex",
    "Lançamento de cor ou variante; feed harmônico.", True)
add(C, "Retrô anos 70",
    "Estilo retrô anos 70: paleta mostarda, laranja queimado e marrom, luz quente de fim de tarde, leve granulação, objetos de época discretos, cores ligeiramente desbotadas. Aplique a [assunto].",
    "1970s retro style: mustard, burnt orange and brown palette, warm late afternoon light, light grain, discreet period props, slightly faded colors. Apply to [subject].",
    "fantasia caricata, excesso de objetos, marca d'água", ["retrô", "anos 70", "nostalgia"], "youmind",
    "Campanhas temáticas e marcas com estética vintage.")
add(C, "Autêntico de celular estilo UGC",
    "Estilo foto de celular autêntica: enquadramento casual levemente torto, luz ambiente real do local, pequenas imperfeições naturais, profundidade de campo do celular, cores naturais sem filtro pesado. Aplique a [assunto]. Deve parecer uma foto real de cliente.",
    "Authentic phone photo style: casual, slightly tilted framing, the location's real ambient light, small natural imperfections, phone depth of field, natural colors without heavy filter. Apply to [subject]. It should look like a real customer photo.",
    "aparência de estúdio, perfeição artificial, pele lisa demais, marca d'água", ["ugc", "celular", "autêntico", "anúncio"], "zerolu",
    "Anúncios que precisam parecer conteúdo orgânico.")

# ------------------------------------------------------------------ composicao
C = "composicao"
add(C, "Regra dos terços com espaço para texto",
    "Composição pela regra dos terços: [assunto] posicionado no cruzamento das linhas do terço [esquerdo ou direito] inferior, olhar ou frente do assunto voltado para o espaço livre, dois terços do quadro com espaço negativo limpo e uniforme para receber título depois. Não gere texto.",
    "Rule of thirds composition: [subject] placed at the intersection of the lower [left or right] third lines, subject's gaze or front facing the open space, two thirds of the frame kept as clean, even negative space for a headline added later. Do not generate text.",
    "texto gerado, assunto centralizado, fundo poluído, marca d'água", ["regra dos terços", "espaço negativo", "texto"], "wiki_tercos",
    "Artes que vão receber título na Mesa.", True)
add(C, "Flat lay em grade organizada",
    "Composição flat lay: câmera exatamente a 90 graus sobre a superfície, [itens] em grade alinhada com espaçamento igual, bordas paralelas ao quadro, um item principal maior no centro ou em diagonal, luz superior difusa com sombras curtas.",
    "Flat lay composition: camera exactly 90 degrees above the surface, [items] in an aligned grid with equal spacing, edges parallel to the frame, one larger main item in the center or on a diagonal, diffused overhead light with short shadows.",
    "perspectiva inclinada, itens sobrepostos sem intenção, marca d'água", ["flat lay", "grade", "vista superior"], "cc0prod",
    "Kits, looks, ingredientes, rotinas.")
add(C, "Ângulo de mesa a 45 graus",
    "Composição a 45 graus: câmera inclinada como o olhar de quem está sentado à mesa, [assunto] no terço inferior com a frente virada para a câmera, fundo com elementos desfocados do ambiente, profundidade de campo média (f/4).",
    "45 degree composition: camera tilted like the view of someone seated at the table, [subject] in the lower third with its front facing the camera, blurred environment elements behind, medium depth of field (f/4).",
    "vista superior, perspectiva distorcida, marca d'água", ["45 graus", "mesa", "comida"], "shopifyfood",
    "Pratos, bebidas, produtos de mesa.")
add(C, "Herói central simétrico",
    "Composição central simétrica: [assunto] exatamente no centro, eixo vertical alinhado, elementos de apoio espelhados dos dois lados, câmera frontal na altura do assunto, fundo uniforme. Transmite força e estabilidade.",
    "Centered symmetrical composition: [subject] exactly in the center, vertical axis aligned, supporting elements mirrored on both sides, frontal camera at subject height, uniform background. Conveys strength and stability.",
    "assimetria acidental, horizonte torto, marca d'água", ["simetria", "central", "herói"], "wiki_negativo",
    "Lançamentos e peças institucionais.")
add(C, "Câmera baixa para imponência",
    "Composição em contra-plongée: câmera abaixo do [assunto] olhando levemente para cima, lente 35 mm, o assunto parece maior e imponente, céu ou fundo limpo acima. Mantenha as proporções reais do assunto.",
    "Low angle composition: camera below the [subject] looking slightly up, 35mm lens, the subject looks larger and imposing, clean sky or background above. Keep the subject's real proportions.",
    "distorção exagerada, proporção alterada, marca d'água", ["contra-plongée", "câmera baixa", "impacto"], "bfl",
    "Calçados, garrafas, fachadas, produtos com presença.")
add(C, "Linhas que conduzem o olhar",
    "Composição com linhas guia: elementos do cenário (borda da mesa, tábuas do piso, sombra, prateleira) formando linhas que convergem para o [assunto] posicionado no terço [direito], profundidade de campo média.",
    "Leading lines composition: scene elements (table edge, floorboards, shadow, shelf) forming lines that converge on the [subject] placed on the [right] third, medium depth of field.",
    "linhas que saem do quadro sem destino, marca d'água", ["linhas guia", "profundidade", "direção do olhar"], "wiki_linhas",
    "Ambientes, produtos em cenário, retratos ambientados.")
add(C, "Moldura dentro do quadro",
    "Composição com moldura natural: [assunto] enquadrado por um elemento do primeiro plano (arco, janela, folhas, vão de porta) desfocado, criando profundidade e direcionando o olhar para o centro nítido.",
    "Frame within a frame composition: [subject] framed by a blurred foreground element (arch, window, leaves, doorway), creating depth and guiding the eye to the sharp center.",
    "moldura cobrindo o assunto, marca d'água", ["moldura", "primeiro plano", "profundidade"], "cc0prod",
    "Produtos em cenário e ambientes com charme.")
add(C, "Diagonal dinâmica",
    "Composição diagonal: [assunto] disposto em diagonal do canto inferior esquerdo ao superior direito, sombras acompanhando a diagonal, sensação de movimento e energia, espaço livre no canto oposto.",
    "Diagonal composition: [subject] laid out on a diagonal from bottom left to top right corner, shadows following the diagonal, a sense of motion and energy, free space in the opposite corner.",
    "horizonte torto sem intenção, marca d'água", ["diagonal", "dinâmica", "movimento"], "bfl",
    "Esporte, bebidas, tecnologia, anúncios com energia.")
add(C, "Camadas de profundidade",
    "Composição em três camadas: primeiro plano desfocado com um elemento de apoio, [assunto] nítido no plano médio, fundo desfocado do ambiente; lente 85 mm, f/2.8. Cria profundidade e sensação de lugar real.",
    "Three layer composition: blurred foreground with a supporting element, sharp [subject] in the midground, blurred environment behind; 85mm lens, f/2.8. Creates depth and a sense of a real place.",
    "tudo no mesmo plano, desfoque no assunto, marca d'água", ["camadas", "profundidade de campo", "bokeh"], "wiki_dof",
    "Lifestyle de produto e comida.")
add(C, "Macro close-up de detalhe",
    "Composição em close-up extremo: o [detalhe] ocupa 70% do quadro, foco crítico em um ponto, restante desfocado suavemente, luz rasante para textura. Só mostre o que existe na foto de referência.",
    "Extreme close-up composition: the [detail] fills 70% of the frame, critical focus on one point, the rest softly blurred, raking light for texture. Only show what exists in the reference photo.",
    "detalhe inventado, foco no lugar errado, marca d'água", ["macro", "close-up", "detalhe"], "wiki_macro",
    "Carrossel de detalhes e provas de qualidade.")
add(C, "Série consistente para vários itens",
    "Composição de série: mesmo ângulo, mesma distância da câmera, mesmo enquadramento (assunto ocupando 70% da altura), mesmo fundo [cor] e mesma luz em todas as fotos de [lista de itens], para que a grade da loja fique uniforme.",
    "Series composition: same angle, same camera distance, same framing (subject filling 70% of the height), same [color] background and same lighting across all photos of [item list], so the store grid looks uniform.",
    "variação de ângulo, variação de luz, variação de fundo, marca d'água", ["série", "consistência", "grade da loja"], "shopify",
    "Catálogo e cardápio com muitos itens.", True)
add(C, "Vertical 9:16 com área segura",
    "Composição vertical 9:16 para stories e reels: [assunto] no centro vertical entre 25% e 75% da altura, 14% superiores e 20% inferiores livres (área da interface), fundo contínuo que permita expandir.",
    "Vertical 9:16 composition for stories and reels: [subject] vertically centered between 25% and 75% of the height, top 14% and bottom 20% kept free (interface area), continuous background that can extend.",
    "assunto cortado nas bordas, elementos importantes nas áreas da interface, marca d'água", ["9:16", "stories", "reels", "área segura"], "youmind",
    "Stories, reels e anúncios verticais.")

# ------------------------------------------------------------------ luz
C = "luz"
add(C, "Três pontos clássico",
    "Iluminação de três pontos: luz principal em softbox a 45 graus lateral e um pouco acima do [assunto], luz de preenchimento do lado oposto com cerca de metade da intensidade, luz de recorte por trás para separar o contorno do fundo. Exposição equilibrada.",
    "Three point lighting: softbox key light 45 degrees to the side and slightly above the [subject], fill light on the opposite side at about half the intensity, back rim light to separate the outline from the background. Balanced exposure.",
    "sombras duplas, luz chapada, marca d'água", ["três pontos", "estúdio", "clássico"], "wiki_3pt",
    "Padrão seguro para produto e retrato.", True)
add(C, "Janela lateral com rebatedor",
    "Luz natural de janela grande lateral (à esquerda) como única fonte, difusa por cortina fina, rebatedor branco do lado oposto para abrir as sombras, temperatura de cor de dia (5500 K), sombras suaves e direcionais sobre o [assunto].",
    "Natural light from a large side window (left) as the only source, diffused by a sheer curtain, white bounce card opposite to open the shadows, daylight color temperature (5500 K), soft directional shadows on the [subject].",
    "luz de flash direta, sombras duras, cor amarelada, marca d'água", ["luz de janela", "natural", "rebatedor"], "wiki_fill",
    "Comida, cosmético, lifestyle, retrato.", True)
add(C, "Softbox superior para vista de cima",
    "Luz de uma softbox grande posicionada diretamente acima e levemente atrás do [assunto], difusão dupla, rebatedores brancos nas laterais, sombras curtas e macias, iluminação uniforme em toda a superfície.",
    "Light from a large softbox directly above and slightly behind the [subject], double diffusion, white bounce cards on the sides, short soft shadows, even illumination across the whole surface.",
    "sombra longa, ponto quente de luz, marca d'água", ["softbox", "vista superior", "flat lay"], "wiki_softbox",
    "Flat lay, knolling, pratos de cima.")
add(C, "Contraluz para vidro e líquido",
    "Contraluz com painel difuso atrás do [assunto transparente], revelando a cor e a transparência do líquido, duas bandeiras pretas laterais para desenhar bordas escuras nítidas no vidro, rebatedor frontal pequeno para o rótulo.",
    "Backlight with a diffused panel behind the [transparent subject], revealing the liquid's color and transparency, two black side flags to draw crisp dark edges on the glass, small front bounce for the label.",
    "vidro sem contorno, rótulo escuro, reflexos do estúdio, marca d'água", ["contraluz", "vidro", "líquido", "bebida"], "wiki_contraluz",
    "Garrafas, copos, frascos de vidro, óleos.")
add(C, "Hora dourada externa",
    "Luz de hora dourada: sol baixo a 10 graus do horizonte, lateral ou por trás do [assunto], luz quente e macia, sombras longas, recorte dourado nas bordas, rebatedor para manter o assunto bem exposto.",
    "Golden hour light: low sun 10 degrees above the horizon, to the side or behind the [subject], warm soft light, long shadows, golden rim on the edges, reflector to keep the subject well exposed.",
    "céu estourado, assunto subexposto, laranja artificial, marca d'água", ["golden hour", "externa", "quente"], "wiki_golden",
    "Retratos, bebidas, ambientes externos.")
add(C, "Sol duro com sombras gráficas",
    "Luz dura de sol do meio da manhã, sombras nítidas e bem definidas projetadas pelo [assunto] na superfície, alto contraste com sombras ainda legíveis, cores vivas. Estética de verão e editorial.",
    "Hard mid morning sunlight, crisp well defined shadows cast by the [subject] on the surface, high contrast with shadows still readable, vivid colors. Summer editorial look.",
    "sombras fechadas sem detalhe, reflexo estourado, marca d'água", ["luz dura", "sol", "sombra gráfica"], "wiki_duramole",
    "Verão, moda, bebidas, cosméticos solares.")
add(C, "Gobo de folhagem ou persiana",
    "Luz dura atravessando um recorte (gobo) de [folhagem ou persiana] e projetando um padrão de sombras sobre o [assunto] e a superfície, luz de preenchimento suave para manter o assunto legível.",
    "Hard light passing through a [foliage or blinds] cutout (gobo), casting a shadow pattern over the [subject] and surface, soft fill light to keep the subject readable.",
    "padrão cobrindo o rótulo, sombras confusas, marca d'água", ["gobo", "sombra projetada", "textura de luz"], "wiki_gobo",
    "Cosmético, casa, produto premium.")
add(C, "High key com fundo limpo",
    "Iluminação high key: fundo iluminado separadamente até ficar branco limpo, luz principal ampla frontal e preenchimento forte, sombras mínimas, imagem clara e arejada com o [assunto] bem definido e sem perder detalhes.",
    "High key lighting: background lit separately to clean white, broad front key and strong fill, minimal shadows, a bright airy image with the [subject] well defined and no lost detail.",
    "bordas estouradas, assunto lavado, marca d'água", ["high key", "claro", "fundo branco"], "wiki_highkey",
    "E-commerce, saúde, beleza.")
add(C, "Faixas de luz para superfícies brilhantes",
    "Duas strip boxes verticais estreitas, uma de cada lado do [assunto brilhante], criando reflexos lineares limpos que desenham a forma, fundo com luz própria em gradiente, sem reflexo do equipamento.",
    "Two narrow vertical strip boxes, one on each side of the [glossy subject], creating clean linear reflections that define the shape, separately lit gradient background, no equipment reflection.",
    "reflexo de softbox quadrada, reflexos manchados, marca d'água", ["strip box", "brilho", "metal", "vidro"], "wiki_softbox",
    "Garrafas, metais, eletrônicos, perfumes.")
add(C, "Tenda de luz para metal e joia",
    "Iluminação em tenda difusa envolvendo todo o [assunto metálico], reflexos suaves e contínuos no metal, um ponto de luz pequeno para brilho nas pedras, sem reflexos da câmera nem do estúdio.",
    "Diffused tent lighting wrapping the whole [metallic subject], soft continuous reflections on the metal, one small point light for sparkle on stones, no camera or studio reflections.",
    "reflexo da câmera, metal manchado, marca d'água", ["tenda de luz", "metal", "joia"], "adobe",
    "Joias, relógios, talheres, cromados.")
add(C, "Céu nublado difuso",
    "Luz de dia nublado: iluminação plana, uniforme e sem sombras marcadas, cores fiéis e saturação natural, ideal para mostrar o [assunto] com precisão de cor.",
    "Overcast daylight: flat, even lighting without marked shadows, faithful colors and natural saturation, ideal to show the [subject] with color accuracy.",
    "céu cinza dominante, imagem sem vida, marca d'água", ["nublado", "difusa", "cor fiel"], "bfl",
    "Roupas, fachadas, produtos com cor crítica.")
add(C, "Beauty dish frontal",
    "Beauty dish com difusor posicionado acima e à frente do [assunto], luz concentrada no centro com queda suave nas bordas, rebatedor abaixo, brilho definido e contraste médio.",
    "Beauty dish with diffuser placed above and in front of the [subject], light concentrated in the center with a soft falloff at the edges, bounce below, defined sheen and medium contrast.",
    "pele de plástico, brilho oleoso, marca d'água", ["beauty dish", "beleza", "retrato"], "wiki_beauty",
    "Retrato de beleza e cosméticos em mão.")

# ------------------------------------------------------------------ validação
titulos = [x["titulo"] for x in I]
assert len(titulos) == len(set(titulos)), "titulo repetido"
destaques = [x for x in I if x["destaque"]]
assert len(destaques) == 20, len(destaques)
proibidos = ["\u2014", "\u2013"]
for x in I:
    for k, v in x.items():
        vals = v if isinstance(v, list) else [v]
        for s in vals:
            if isinstance(s, str):
                for p in proibidos:
                    assert p not in s, (x["titulo"], k)
                assert "$bib$" not in s
    for k in ("titulo", "categoria", "prompt_pt", "prompt_en", "fonte_nome", "fonte_url", "licenca", "uso"):
        assert x[k].strip(), (x["titulo"], k)

cats = {}
for x in I:
    cats[x["categoria"]] = cats.get(x["categoria"], 0) + 1

doc = {
    "versao": 1,
    "gerado_em": "2026-09-24",
    "descricao": "Semente da biblioteca de prompts da Mesa Foto. Texto próprio Aceleriq; fonte_nome/fonte_url indicam a inspiração técnica e licenca registra a situação da fonte. Colchetes marcam o que a equipe troca pelo dado real do cliente.",
    "regras": [
        "Colchetes [ ] são campos a preencher com dados reais do kit do cliente.",
        "Prompts com referência pressupõem as fotos do kit anexadas (identidade primeiro).",
        "Pessoa: só foto autorizada do cliente; nada muda rosto, idade ou corpo.",
        "Alimento: porção e ingredientes iguais à referência.",
        "Negativo: lista para modelos que aceitam; em FLUX reescrever como descrição positiva; no Midjourney usar --no com poucas palavras.",
    ],
    "total": len(I),
    "por_categoria": cats,
    "destaques": len(destaques),
    "itens": I,
}
os.makedirs(os.path.dirname(SAIDA), exist_ok=True)
with open(SAIDA, "w", encoding="utf-8", newline="\n") as f:
    json.dump(doc, f, ensure_ascii=False, indent=2)
    f.write("\n")
print(len(I), cats, "destaques:", len(destaques))
