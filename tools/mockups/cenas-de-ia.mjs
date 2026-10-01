/**
 * As cenas dos mockups de IA do catálogo (frente MCK, rodada 2): o que o gerador desenha e como
 * o mockup_de_ia.py transforma cada uma em mockup (categoria, papel da área e fundo trocável).
 *
 * Regra de todas: a superfície da marca sai LISA, BRANCA e FOSCA, sem nada escrito. A logo e as
 * cores entram depois, pelo código, na perspectiva da superfície. O gerador nunca desenha marca.
 *
 * papel: "arte" (a peça inteira com a cor da marca e a logo) ou "logo" (só a logo sobre a
 * superfície: camiseta, avental, parede). fundo: true = objeto em fundo liso de estúdio, que o
 * painel troca por cor, degradê ou textura da marca.
 */

const SEM_TEXTO = "Absolutely no text, letters, numbers, logos, brand marks, symbols or patterns anywhere in the image.";
const LISA = "completely blank, pure matte white, perfectly flat, evenly lit, crisp clean straight edges, no print, no texture, no glare";
const FOTO = "Photorealistic commercial product photograph, natural soft light, realistic shadows, sharp focus, high detail.";
// Fundo trocável: croma verde liso (o mockup_de_ia.py recorta pelo verde, tira o reflexo verde do
// objeto e guarda a sombra de contato; no painel o fundo vira cor, degradê ou textura da marca).
const ESTUDIO = "on a seamless solid chroma key green studio backdrop and floor (pure flat green, color #00B140, evenly lit, no gradient), soft natural contact shadow on the green floor, generous empty green space around the object";

export const CENAS_DE_IA = [
  // Papelaria
  { id: "ia-papelaria-cartoes-mesa", nome: "Cartões na mesa (IA)", categoria: "cartao", papel: "arte", fundo: false, tamanho: "1536x1024", tags: ["cartao", "mesa", "ia"],
    prompt: `${FOTO} Top-down view of two standard business cards lying on a warm light oak desk, one slightly overlapping and rotated about 12 degrees, next to a black pen. Both cards are ${LISA}. ${SEM_TEXTO}` },
  { id: "ia-papelaria-timbrado", nome: "Papel timbrado na mesa (IA)", categoria: "papelaria", papel: "arte", fundo: false, tamanho: "1024x1536", tags: ["timbrado", "a4", "ia"],
    prompt: `${FOTO} A single A4 sheet of paper lying on a dark walnut desk, seen from above at a slight angle, a pair of glasses and a coffee cup near the edge of the frame. The sheet is ${LISA}. ${SEM_TEXTO}` },
  { id: "ia-papelaria-envelope", nome: "Envelope na pedra (IA)", categoria: "papelaria", papel: "arte", fundo: false, tamanho: "1536x1024", tags: ["envelope", "ia"],
    prompt: `${FOTO} A closed rectangular DL envelope, front side facing up, lying on smooth grey stone, top-down view, a sprig of eucalyptus in one corner. The envelope front is ${LISA}. ${SEM_TEXTO}` },
  // Embalagem
  { id: "ia-embalagem-sacola", nome: "Sacola de papel (IA)", categoria: "sacola", papel: "arte", fundo: true, tamanho: "1024x1536", tags: ["sacola", "varejo", "ia"],
    prompt: `${FOTO} A rectangular paper shopping bag with white rope handles standing upright, front panel facing the camera straight on, ${ESTUDIO}. The front panel of the bag is ${LISA}. ${SEM_TEXTO}` },
  { id: "ia-embalagem-caixa", nome: "Caixa de produto (IA)", categoria: "embalagem", papel: "arte", fundo: true, tamanho: "1536x1024", tags: ["caixa", "produto", "ia"],
    prompt: `${FOTO} A single rectangular product box standing upright, front face turned toward the camera at a gentle 20 degree angle, ${ESTUDIO}. The large front face of the box is ${LISA}. ${SEM_TEXTO}` },
  { id: "ia-embalagem-caixa-delivery", nome: "Caixa de delivery (IA)", categoria: "embalagem", papel: "arte", fundo: false, tamanho: "1536x1024", tags: ["delivery", "pizza", "alimento", "ia"],
    prompt: `${FOTO} A closed square cardboard delivery box lying on a rustic restaurant counter, seen from above at a slight angle. The top lid of the box is ${LISA}. ${SEM_TEXTO}` },
  { id: "ia-embalagem-tag", nome: "Etiqueta de roupa (IA)", categoria: "embalagem", papel: "arte", fundo: false, tamanho: "1024x1536", tags: ["etiqueta", "moda", "ia"],
    prompt: `${FOTO} A rectangular clothing hang tag with a thin cotton string, lying flat on folded beige linen fabric, top-down view, the tag fills about a third of the frame. The tag is ${LISA}. ${SEM_TEXTO}` },
  // Fachada
  { id: "ia-fachada-loja", nome: "Fachada de loja (IA)", categoria: "fachada", papel: "arte", fundo: false, tamanho: "1536x1024", tags: ["fachada", "loja", "rua", "ia"],
    prompt: `${FOTO} Daytime street photo of a small modern storefront seen from the sidewalk, straight on, glass door and shop window. Above the entrance there is a large wide rectangular sign board mounted flat on the facade, facing the camera; the sign board is ${LISA}. ${SEM_TEXTO}` },
  { id: "ia-fachada-placa-parede", nome: "Placa na parede do prédio (IA)", categoria: "fachada", papel: "arte", fundo: false, tamanho: "1536x1024", tags: ["fachada", "placa", "predio", "ia"],
    prompt: `${FOTO} Three-quarter view of a clean modern concrete building wall next to an entrance with plants. A large rectangular sign panel is mounted flat on the wall at eye level, seen in perspective; the panel is ${LISA}. ${SEM_TEXTO}` },
  // Veículo
  { id: "ia-veiculo-van", nome: "Van de entrega (IA)", categoria: "veiculo", papel: "arte", fundo: false, tamanho: "1536x1024", tags: ["van", "frota", "delivery", "ia"],
    prompt: `${FOTO} Side view of a white cargo delivery van parked on a clean city street, the whole van visible, the large flat cargo side panel between the doors and the rear is ${LISA}, no windows on the cargo area. ${SEM_TEXTO}` },
  { id: "ia-veiculo-moto-bau", nome: "Moto com baú (IA)", categoria: "veiculo", papel: "arte", fundo: false, tamanho: "1536x1024", tags: ["moto", "delivery", "entrega", "ia"],
    prompt: `${FOTO} Side view of a delivery motorcycle parked on a street with a large square cargo box mounted on the back seat. The side of the cargo box facing the camera is ${LISA}. ${SEM_TEXTO}` },
  // Vestuário
  { id: "ia-vestuario-camiseta", nome: "Camiseta no chão (IA)", categoria: "vestuario", papel: "logo", fundo: false, tamanho: "1024x1536", tags: ["camiseta", "uniforme", "ia"],
    prompt: `${FOTO} A plain crew neck t-shirt laid flat and neatly on a light wooden floor, top-down view, the whole shirt visible, fabric with subtle natural folds. The t-shirt is plain white with no print. ${SEM_TEXTO}` },
  { id: "ia-vestuario-avental", nome: "Avental (IA)", categoria: "vestuario", papel: "logo", fundo: true, tamanho: "1024x1536", tags: ["avental", "restaurante", "uniforme", "ia"],
    prompt: `${FOTO} A plain white bib apron hanging flat on a wooden hanger, front view, ${ESTUDIO}. The apron is plain white canvas with no print. ${SEM_TEXTO}` },
  { id: "ia-vestuario-ecobag", nome: "Ecobag (IA)", categoria: "vestuario", papel: "arte", fundo: true, tamanho: "1024x1536", tags: ["ecobag", "brinde", "ia"],
    prompt: `${FOTO} A plain white canvas tote bag hanging flat from a hook by its handles, front view, ${ESTUDIO}. The front of the bag is ${LISA}. ${SEM_TEXTO}` },
  // Digital
  { id: "ia-digital-celular-mao", nome: "Celular na mão (IA)", categoria: "dispositivo", papel: "arte", fundo: false, tamanho: "1024x1536", tags: ["celular", "instagram", "app", "ia"],
    prompt: `${FOTO} A hand holding a modern smartphone upright, screen facing the camera straight on, thin black bezels, softly blurred cafe in the background. The screen is lit and ${LISA}, no interface, no icons. ${SEM_TEXTO}` },
  { id: "ia-digital-notebook", nome: "Notebook na mesa (IA)", categoria: "dispositivo", papel: "arte", fundo: false, tamanho: "1536x1024", tags: ["notebook", "site", "ia"],
    prompt: `${FOTO} An open silver laptop on a tidy desk near a window, seen from the front at a slight angle, the screen facing the camera. The screen is lit and ${LISA}, no interface, no icons. ${SEM_TEXTO}` },
  { id: "ia-digital-tv-loja", nome: "TV do balcão (IA)", categoria: "dispositivo", papel: "arte", fundo: false, tamanho: "1536x1024", tags: ["tv", "cardapio", "loja", "ia"],
    prompt: `${FOTO} A large flat wall-mounted TV screen above a cafe counter, seen from the front at a slight angle. The screen is lit and ${LISA}, no interface. ${SEM_TEXTO}` },
  // Sinalização
  { id: "ia-sinalizacao-totem", nome: "Totem no shopping (IA)", categoria: "sinalizacao", papel: "arte", fundo: false, tamanho: "1024x1536", tags: ["totem", "shopping", "ia"],
    prompt: `${FOTO} A tall freestanding rectangular totem sign standing in a bright shopping mall corridor, front face toward the camera. The front face of the totem is ${LISA}. ${SEM_TEXTO}` },
  { id: "ia-sinalizacao-cavalete", nome: "Cavalete na calçada (IA)", categoria: "sinalizacao", papel: "arte", fundo: false, tamanho: "1024x1536", tags: ["cavalete", "calcada", "ia"],
    prompt: `${FOTO} An A-frame sidewalk sign standing on a city sidewalk in front of a cafe, front panel toward the camera. The front panel is ${LISA}. ${SEM_TEXTO}` },
  { id: "ia-sinalizacao-recepcao", nome: "Parede da recepção (IA)", categoria: "sinalizacao", papel: "logo", fundo: false, tamanho: "1536x1024", tags: ["recepcao", "escritorio", "parede", "ia"],
    prompt: `${FOTO} A modern office reception with a wooden reception desk in front of a smooth wall. On the wall behind the desk there is a large rectangular wall panel, ${LISA}. ${SEM_TEXTO}` },
  { id: "ia-sinalizacao-placa-porta", nome: "Placa da porta (IA)", categoria: "sinalizacao", papel: "arte", fundo: false, tamanho: "1536x1024", tags: ["placa", "porta", "consultorio", "ia"],
    prompt: `${FOTO} A small rectangular acrylic door sign mounted on a light grey wall next to a wooden office door, seen at a slight angle. The sign plate is ${LISA}. ${SEM_TEXTO}` },
];
