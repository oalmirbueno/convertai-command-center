import type { ItemDaBiblioteca } from "./fotoApi";

/**
 * Arsenal de prompts (pedido do dono, 02/10, item 9 da Mesa Foto): a
 * biblioteca organizada por área da foto (Produto, Modelo, Cenário, Luz,
 * Ângulo, Detalhe, Composição), com prompts de lógica fotográfica montados
 * para os produtos do cliente ("faz a lógica": o molde com o produto já
 * preenchido) e sem referência de outro segmento (frasco de vidro para uma
 * ótica, por exemplo).
 *
 * Tudo aqui é puro e determinístico: palavras-chave fixas, nenhum modelo de
 * linguagem. A tela (EtapaBiblioteca, PainelDoArsenal) só desenha.
 */

// ------------------------------------------------------------------ áreas

export type AreaDoArsenal = "produto" | "modelo" | "cenario" | "luz" | "angulo" | "detalhe" | "composicao";

export const AREAS_DO_ARSENAL: { valor: AreaDoArsenal; rotulo: string; categoria: string; dica: string }[] = [
  { valor: "produto", rotulo: "Produto", categoria: "produto", dica: "Packshot, herói e foto de catálogo do produto." },
  { valor: "modelo", rotulo: "Modelo", categoria: "pessoa", dica: "Pessoa usando ou segurando o produto, retrato e mãos." },
  { valor: "cenario", rotulo: "Cenário", categoria: "cenario", dica: "Fundo, superfície, ambiente e estilo da cena." },
  { valor: "luz", rotulo: "Luz", categoria: "luz", dica: "Esquema de luz: janela, recorte, contraluz, sol duro." },
  { valor: "angulo", rotulo: "Ângulo", categoria: "composicao", dica: "Altura e posição da câmera: frontal, três quartos, de cima, de baixo." },
  { valor: "detalhe", rotulo: "Detalhe", categoria: "produto", dica: "Macro de acabamento, textura, logo e rótulo." },
  { valor: "composicao", rotulo: "Composição", categoria: "composicao", dica: "Onde o produto fica no quadro, espaço para texto e formato." },
];

export const rotuloDaArea = (a: AreaDoArsenal | string) => (AREAS_DO_ARSENAL.find((x) => x.valor === a) || { rotulo: "Outra" }).rotulo;

export const ehAreaDoArsenal = (v: unknown): v is AreaDoArsenal => AREAS_DO_ARSENAL.some((a) => a.valor === v);

/** Categoria da biblioteca (CATEGORIAS_DA_BIBLIOTECA) para a área. */
const AREA_DA_CATEGORIA: Record<string, AreaDoArsenal> = {
  produto: "produto",
  alimento: "produto",
  bebida: "produto",
  cosmetico: "produto",
  moda: "produto",
  tecnologia: "produto",
  pessoa: "modelo",
  ambiente: "cenario",
  cenario: "cenario",
  estilo: "cenario",
  luz: "luz",
  composicao: "composicao",
};

/** Categorias que são técnica (valem para qualquer produto): o prompt delas nunca some por segmento. */
const CATEGORIAS_DE_TECNICA = ["luz", "composicao", "estilo", "pessoa"];

/** Categorias de segmento: sem palavra-chave no título, o segmento do item é a própria categoria. */
const CATEGORIAS_DE_SEGMENTO = ["alimento", "bebida", "cosmetico", "moda", "tecnologia"];

/** Sem acento, minúsculo, só letras e números separados por um espaço (com espaço nas pontas). */
export function normalizar(texto: unknown): string {
  const t = String(texto == null ? "" : texto)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return t ? ` ${t} ` : " ";
}

/** A palavra (ou expressão) aparece inteira no texto normalizado, no singular ou com "s". */
function tem(normalizado: string, palavra: string): boolean {
  const p = normalizar(palavra).trim();
  if (!p) return false;
  return normalizado.indexOf(` ${p} `) >= 0 || normalizado.indexOf(` ${p}s `) >= 0;
}

const DETALHE_NO_TITULO = ["macro", "textura", "detalhe", "trama", "acabamento", "gota", "close", "close up"];
const ANGULO_NO_TITULO = ["tres quartos", "vista superior", "vista de cima", "camera baixa", "angulo", "45 graus", "altura dos olhos", "ortografico", "frontal"];

/** A área de um item: tag "area:<valor>" manda; depois o título (macro, ângulo) e por fim a categoria. */
export function areaDoItem(item: Pick<ItemDaBiblioteca, "categoria" | "titulo" | "tags">): AreaDoArsenal {
  const tags = item.tags || [];
  for (const t of tags) {
    const m = /^area:(.+)$/i.exec(String(t).trim());
    if (m && ehAreaDoArsenal(m[1].toLowerCase())) return m[1].toLowerCase() as AreaDoArsenal;
  }
  const porCategoria = AREA_DA_CATEGORIA[item.categoria] || "produto";
  if (porCategoria === "produto" || porCategoria === "composicao") {
    const titulo = normalizar(item.titulo);
    if (DETALHE_NO_TITULO.some((p) => tem(titulo, p))) return "detalhe";
    if (ANGULO_NO_TITULO.some((p) => tem(titulo, p))) return "angulo";
  }
  return porCategoria;
}

// ------------------------------------------------------------------ segmentos (relevância)

export type Segmento = "otica" | "cosmetico" | "bebida" | "alimento" | "moda" | "acessorio" | "tecnologia" | "saude" | "hospedagem" | "eventos";

/** Palavras que dizem o segmento (português e inglês, sem acento). Só título e tags do item; nome e tipo do produto. */
const PALAVRAS_DO_SEGMENTO: Record<Segmento, string[]> = {
  otica: ["oculos", "otica", "armacao", "lentes", "lente de contato", "multifocal", "eyewear", "eyeglass", "eyeglasses", "sunglass", "sunglasses", "glasses", "spectacles", "optical", "optician"],
  cosmetico: [
    "cosmetico", "frasco", "creme", "serum", "perfume", "batom", "maquiagem", "skincare", "skin care", "hidratante", "shampoo", "condicionador", "sabonete",
    "esmalte", "po compacto", "conta gotas", "spa", "beleza", "salao de beleza", "cuidados", "cream", "lotion", "lipstick", "makeup", "cosmetic", "fragrance",
    "glass bottle", "glass jar", "pote de vidro", "dropper",
  ],
  bebida: [
    "bebida", "drink", "garrafa", "lata", "cerveja", "vinho", "suco", "cha", "espresso", "cafe", "coquetel", "taca", "copo", "refrigerante", "splash",
    "beverage", "bottle", "wine", "beer", "juice", "coffee", "tea", "cocktail",
  ],
  alimento: [
    "alimento", "prato", "comida", "lanche", "hamburguer", "sanduiche", "pizza", "bolo", "pao", "padaria", "confeitaria", "doce", "cardapio", "restaurante",
    "cozinha", "cafe da manha", "refeicao", "acai", "poke", "salada", "sobremesa", "food", "meal", "dish", "burger", "cake", "bread", "bakery", "dessert", "restaurant",
  ],
  moda: [
    "moda", "roupa", "look", "vestido", "camisa", "camiseta", "calca", "saia", "tecido", "calcado", "sapato", "tenis", "bolsa", "cabide", "arara", "manequim",
    "fashion", "dress", "shirt", "shoe", "sneaker", "handbag", "clothing", "apparel",
  ],
  acessorio: ["joia", "anel", "colar", "brinco", "pulseira", "relogio", "jewelry", "jewellery", "ring", "necklace", "earring", "watch"],
  tecnologia: [
    "tecnologia", "dispositivo", "celular", "smartphone", "notebook", "computador", "fone", "fone de ouvido", "eletronico", "eletrodomestico", "carregador",
    "cabo", "tablet", "gadget", "home office", "phone", "laptop", "headphone", "headphones", "device", "charger",
  ],
  saude: ["saude", "consultorio", "clinica", "clinico", "dentista", "odontologia", "farmacia", "clinic", "dental"],
  hospedagem: ["pousada", "hotel", "hospedagem", "quarto de hotel", "resort"],
  eventos: ["espaco de eventos", "evento", "festa", "casamento", "buffet", "wedding"],
};

/** Só do lado do cliente: palavra ambígua no item ("lente 100 mm" está em quase todo prompt). */
const PALAVRAS_SO_DO_PRODUTO: Partial<Record<Segmento, string[]>> = {
  otica: ["lente", "solar", "grau"],
};

/** Segmentos vizinhos: uma ótica também vende relógio e conversa com saúde. */
const VIZINHOS: Partial<Record<Segmento, Segmento[]>> = {
  otica: ["saude", "acessorio"],
  acessorio: ["moda"],
  moda: ["acessorio"],
  alimento: ["bebida"],
  bebida: ["alimento"],
  saude: ["otica", "cosmetico"],
};

const SEGMENTOS = Object.keys(PALAVRAS_DO_SEGMENTO) as Segmento[];

export function segmentosDoTexto(texto: string, doProduto = false): Segmento[] {
  const n = normalizar(texto);
  return SEGMENTOS.filter((s) => {
    const palavras = doProduto ? PALAVRAS_DO_SEGMENTO[s].concat(PALAVRAS_SO_DO_PRODUTO[s] || []) : PALAVRAS_DO_SEGMENTO[s];
    return palavras.some((p) => tem(n, p));
  });
}

/** Um produto do cliente, como o arsenal precisa (de um kit ou da tela). */
export interface ProdutoDoArsenal {
  nome: string;
  /** Tipo do kit (produto, moda, cosmetico...) ou um tipo escrito ("óculos de sol"). */
  tipo?: string | null;
  marca?: string | null;
}

/** Códigos de TipoDoKit: genéricos demais para entrar no texto do prompt. */
const CODIGOS_DE_TIPO = ["produto", "pessoa", "alimento", "bebida", "cosmetico", "moda", "tecnologia", "outro"];

/** Segmentos do produto: pelo nome primeiro (mais preciso); sem nada no nome, pelo tipo. */
export function segmentosDoProduto(p: ProdutoDoArsenal): Segmento[] {
  const pelo = segmentosDoTexto(`${p.nome || ""} ${p.marca || ""}`, true);
  if (pelo.length) return pelo;
  return segmentosDoTexto(String(p.tipo || ""), true);
}

/** Segmentos de um item da biblioteca: título e tags; sem palavra-chave, a categoria quando ela é de segmento. */
export function segmentosDoItem(item: Pick<ItemDaBiblioteca, "tipo" | "categoria" | "titulo" | "tags" | "uso" | "prompt_pt">): Segmento[] {
  // Referência não tem prompt: o título e a descrição dizem o assunto da foto.
  const texto = [item.titulo, (item.tags || []).join(" "), item.tipo === "referencia" ? `${item.prompt_pt || ""} ${item.uso || ""}` : ""].join(" ");
  const achados = segmentosDoTexto(texto);
  if (achados.length) return achados;
  return CATEGORIAS_DE_SEGMENTO.indexOf(item.categoria) >= 0 ? [item.categoria as Segmento] : [];
}

/**
 * O item serve para algum produto do cliente? Técnica (luz, composição,
 * estilo, pessoa) sempre serve; item sem segmento reconhecido também. Sem
 * produto do cliente com segmento conhecido, não dá para julgar: mostra tudo.
 */
export function relevante(
  item: Pick<ItemDaBiblioteca, "tipo" | "categoria" | "titulo" | "tags" | "uso" | "prompt_pt">,
  produtos: ProdutoDoArsenal[],
): boolean {
  const doCliente: Segmento[] = [];
  for (const p of produtos || []) {
    for (const s of segmentosDoProduto(p)) {
      if (doCliente.indexOf(s) < 0) doCliente.push(s);
      for (const v of VIZINHOS[s] || []) if (doCliente.indexOf(v) < 0) doCliente.push(v);
    }
  }
  if (!doCliente.length) return true;
  if (item.tipo === "prompt" && CATEGORIAS_DE_TECNICA.indexOf(item.categoria) >= 0) return true;
  const doItem = segmentosDoItem(item);
  if (!doItem.length) return true;
  return doItem.some((s) => doCliente.indexOf(s) >= 0);
}

/** Itens (prompt ou referência) sem imagem nenhuma para mostrar. */
export function itensSemImagem<T extends Pick<ItemDaBiblioteca, "storage_path" | "imagem_url" | "miniatura_url">>(itens: T[]): T[] {
  return (itens || []).filter((i) => !(i.storage_path || i.imagem_url || i.miniatura_url));
}

// ------------------------------------------------------------------ preencher o molde

export interface DadosDoPrompt {
  produto?: string | null;
  tipo?: string | null;
  marca?: string | null;
  modelo?: string | null;
}

/** O assunto do prompt: o nome do produto e, quando ajuda, o tipo escrito ("Aviador Clássico (óculos de sol)"). */
export function assuntoDoPrompt(produto?: string | null, tipo?: string | null): string {
  const nome = String(produto || "").replace(/\s+/g, " ").trim();
  if (!nome) return "";
  const t = String(tipo || "").replace(/\s+/g, " ").trim();
  if (!t || CODIGOS_DE_TIPO.indexOf(normalizar(t).trim()) >= 0) return nome;
  if (normalizar(nome).indexOf(normalizar(t)) >= 0) return nome;
  return `${nome} (${t.toLowerCase()})`;
}

const SLOT = /\{\{\s*([^{}]+?)\s*\}\}|\{\s*([^{}]+?)\s*\}|\[([^[\]]+)\]/g;

const comeca = (chave: string, prefixos: string[]) => prefixos.some((p) => chave === p || chave.indexOf(`${p} `) === 0);

const CHAVES_DO_PRODUTO = ["produto", "product", "assunto", "subject", "objeto", "item", "nome do produto"];
const CHAVES_DA_MARCA = ["marca", "brand"];
const CHAVES_DO_MODELO = ["modelo", "model", "pessoa", "person", "descricao", "profissional"];
const CHAVES_DO_TIPO = ["tipo", "type", "categoria"];
/** Primeira lacuna que não é o assunto (cor, exemplo, lista...). */
const NAO_E_ASSUNTO = [
  "ex", "cor", "hex", "numero", "lista", "data", "nome", "nomes", "material", "ambiente", "detalhe", "etapas", "novo fundo", "folhagem", "esquerdo",
  "direito", "arquivo", "tipo de evento", "veludo", "rua", "madeira", "louca", "espaco", "estabelecimento", "restaurante", "loja", "salao",
];

/** Genéricos que viram o produto quando o prompt não tem lacuna. */
const GENERICOS: { padrao: RegExp }[] = [
  { padrao: /\b(?:um|uma|o|a)\s+frasco de vidro\b/gi },
  { padrao: /\bfrasco de vidro\b/gi },
  { padrao: /\b(?:um|o)\s+produto\b/gi },
  { padrao: /\bproduto\b(?!s)/gi },
  { padrao: /\b(?:a|the)\s+glass bottle\b/gi },
  { padrao: /\b(?:a|the)\s+product\b(?!\s+(?:photography|photo|photos|shot|shots))/gi },
  { padrao: /\bproduct\b(?!s|\s+(?:photography|photo|photos|shot|shots))/gi },
];

/**
 * Preenche o molde: {produto}, {{produto}} e [produto] (e assunto, product,
 * subject) viram o produto do cliente; marca, modelo e tipo nas lacunas
 * deles. Lacuna sem dado fica como está, para a pessoa completar. Sem
 * lacuna de assunto, troca o assunto genérico ("frasco de vidro", "o
 * produto", "product") pelo produto.
 *
 * `primeiraComoAssunto` (padrão sim): a primeira lacuna no começo do texto
 * é o assunto ("[Frasco de cosmético] em gradiente..."), salvo cor, exemplo
 * e afins. Prompt de pessoa e de ambiente passa false.
 */
export function preencherPrompt(template: string, dados: DadosDoPrompt, opcoes: { primeiraComoAssunto?: boolean } = {}): string {
  const texto = String(template || "");
  if (!texto) return "";
  const assunto = assuntoDoPrompt(dados.produto, dados.tipo);
  const marca = String(dados.marca || "").trim();
  const modelo = String(dados.modelo || "").trim();
  const tipo = String(dados.tipo || "").trim();
  const primeira = opcoes.primeiraComoAssunto !== false;
  let preencheuAssunto = false;
  let indice = 0;
  const saida = texto.replace(SLOT, (inteiro: string, a: string | undefined, b: string | undefined, c: string | undefined, pos: number) => {
    const conteudo = String(a || b || c || "");
    const chave = normalizar(conteudo).trim();
    const n = indice++;
    if (comeca(chave, CHAVES_DO_PRODUTO)) {
      if (!assunto) return inteiro;
      preencheuAssunto = true;
      return assunto;
    }
    if (comeca(chave, CHAVES_DA_MARCA)) return marca || inteiro;
    if (comeca(chave, CHAVES_DO_MODELO)) return modelo || inteiro;
    if (comeca(chave, CHAVES_DO_TIPO)) return tipo || inteiro;
    if (primeira && n === 0 && pos <= 60 && assunto && !comeca(chave, NAO_E_ASSUNTO)) {
      preencheuAssunto = true;
      return assunto;
    }
    return inteiro;
  });
  if (preencheuAssunto || !assunto) return saida;
  // Sem lacuna de assunto: só troca o genérico (um padrão por vez, para não trocar duas vezes).
  if (normalizar(saida).indexOf(normalizar(assunto)) >= 0) return saida;
  for (const g of GENERICOS) {
    g.padrao.lastIndex = 0;
    if (g.padrao.test(saida)) {
      g.padrao.lastIndex = 0;
      return saida.replace(g.padrao, assunto);
    }
  }
  return saida;
}

/** Prompt de um item da biblioteca já preenchido para um produto. */
export function promptDoItem(item: Pick<ItemDaBiblioteca, "categoria" | "prompt_pt" | "prompt_en">, dados: DadosDoPrompt, ingles = false): string {
  const base = ingles ? item.prompt_en || item.prompt_pt : item.prompt_pt || item.prompt_en;
  const primeiraComoAssunto = item.categoria !== "pessoa" && item.categoria !== "ambiente";
  return preencherPrompt(base || "", dados, { primeiraComoAssunto });
}

// ------------------------------------------------------------------ prompts de lógica fotográfica

export interface LogicaDaArea {
  id: string;
  area: AreaDoArsenal;
  titulo: string;
  /** Molde com {produto} e {modelo}. */
  texto: string;
}

/** Moldes de lógica fotográfica por área: assunto + lente, luz, ângulo, fundo e composição. */
export const LOGICAS_DO_ARSENAL: LogicaDaArea[] = [
  {
    id: "packshot",
    area: "produto",
    titulo: "Packshot de catálogo",
    texto:
      "Foto profissional de {produto}, inteiro no quadro e centralizado em fundo branco puro sem emenda, com respiro de 10% nas bordas. Duas softboxes a 45 graus e rebatedor por baixo, sombra de contato suave. Câmera full frame, lente 100 mm, f/11, foco nítido de ponta a ponta, cor fiel. Mantenha forma, proporções, cor, material e todo texto exatamente como na foto de referência. Formato 1:1.",
  },
  {
    id: "heroi",
    area: "produto",
    titulo: "Herói em três quartos",
    texto:
      "Foto herói de {produto} em ângulo de três quartos, apoiado em pedestal fosco sobre fundo de cor sólida suave. Softbox grande a 45 graus como luz principal, recorte de luz por trás para separar o contorno, rebatedor branco do lado oposto. Lente 90 mm, f/8, câmera um pouco acima da altura do produto. Produto idêntico à referência. Formato 4:5.",
  },
  {
    id: "em-uso",
    area: "modelo",
    titulo: "Modelo usando o produto",
    texto:
      "Retrato de meio corpo de {modelo} usando {produto} de forma natural, olhar fora da câmera, expressão tranquila. Luz de janela lateral suave com rebatedor, fundo desfocado de ambiente real. Lente 85 mm, f/2, foco no produto e nos olhos, pele com textura real. O produto aparece inteiro, nítido e idêntico à referência. Formato 4:5.",
  },
  {
    id: "nas-maos",
    area: "modelo",
    titulo: "Produto nas mãos",
    texto:
      "Close das mãos de {modelo} segurando {produto} na altura do peito, gesto natural e unhas limpas. Luz suave lateral, fundo neutro desfocado. Lente 100 mm, f/4, foco no produto. Forma, cor e texto do produto como na referência. Formato 4:5.",
  },
  {
    id: "ambiente-real",
    area: "cenario",
    titulo: "Ambiente real de uso",
    texto:
      "{produto} no ambiente onde ele é usado no dia a dia, apoiado em superfície natural com dois ou três objetos de apoio discretos que não roubam a atenção. Luz natural de janela pela lateral, sombras suaves. Lente 50 mm, f/4, fundo levemente desfocado. Produto idêntico à referência. Formato 4:5.",
  },
  {
    id: "cor-da-marca",
    area: "cenario",
    titulo: "Fundo na cor da marca",
    texto:
      "{produto} sobre fundo e superfície de cor sólida da marca, sombra dura e gráfica de sol de fim de tarde. Composição limpa, produto no centro. Lente 70 mm, f/8. Produto idêntico à referência. Formato 1:1.",
  },
  {
    id: "janela",
    area: "luz",
    titulo: "Luz suave de janela",
    texto:
      "{produto} iluminado por uma janela grande à esquerda com cortina difusora, rebatedor branco à direita para abrir as sombras, contraste baixo e transição suave. Lente 90 mm, f/5.6, ISO 100, cor fiel. Produto idêntico à referência.",
  },
  {
    id: "recorte",
    area: "luz",
    titulo: "Contraluz com recorte",
    texto:
      "{produto} em fundo escuro, luz de recorte por trás dos dois lados desenhando o contorno, luz principal suave e baixa pela frente. Faixas de luz controladas para reflexos limpos. Lente 100 mm, f/8. Produto idêntico à referência.",
  },
  {
    id: "frontal",
    area: "angulo",
    titulo: "Frontal na altura do produto",
    texto:
      "{produto} fotografado de frente, câmera exatamente na altura do centro do produto, linhas retas e sem distorção. Lente 100 mm, f/11, fundo limpo. Produto idêntico à referência. Formato 1:1.",
  },
  {
    id: "de-cima",
    area: "angulo",
    titulo: "Vista de cima (flat lay)",
    texto:
      "{produto} em vista de cima a 90 graus, com respiro sobre superfície de textura suave, itens de apoio alinhados em grade. Softbox superior grande, sombras curtas e suaves. Lente 50 mm, f/8. Produto idêntico à referência. Formato 4:5.",
  },
  {
    id: "de-baixo",
    area: "angulo",
    titulo: "Câmera baixa",
    texto:
      "{produto} visto de baixo para cima, câmera quase na altura da superfície, dando imponência. Fundo de parede lisa ou céu limpo. Lente 35 mm, f/8. Produto idêntico à referência. Formato 4:5.",
  },
  {
    id: "macro",
    area: "detalhe",
    titulo: "Macro do acabamento",
    texto:
      "Macro de {produto} mostrando acabamento, textura e material de perto, profundidade de campo curta com foco preciso no detalhe principal. Luz lateral rasante para revelar a textura. Lente macro 100 mm, f/5.6, empilhamento de foco. Detalhe idêntico à referência.",
  },
  {
    id: "marca-de-perto",
    area: "detalhe",
    titulo: "Logo e rótulo de perto",
    texto:
      "Close de {produto} com foco no logo, gravação ou rótulo, texto legível e exatamente como na referência, sem inventar letras. Luz suave frontal com faixa de luz lateral. Lente macro 100 mm, f/8.",
  },
  {
    id: "tercos",
    area: "composicao",
    titulo: "Terços com espaço para texto",
    texto:
      "{produto} no terço direito do quadro, área livre e limpa à esquerda para o texto do anúncio, fundo liso em tom suave. Luz suave lateral. Lente 85 mm, f/8. Produto idêntico à referência. Formato 4:5.",
  },
  {
    id: "vertical",
    area: "composicao",
    titulo: "Vertical 9:16 com área segura",
    texto:
      "{produto} no meio do quadro 9:16, livre das faixas de 14% em cima e 20% embaixo onde fica a interface do Stories e do Reels. Fundo limpo com profundidade suave. Lente 50 mm, f/5.6. Produto idêntico à referência.",
  },
];

/** O cuidado que muda por segmento (entra no fim do prompt de lógica). */
const CUIDADO_DO_SEGMENTO: Partial<Record<Segmento, string>> = {
  otica: "Lentes sem reflexo sujo: controle os reflexos com faixas de luz e polarizador, armação alinhada e simétrica, hastes abertas.",
  cosmetico: "Rótulo legível, embalagem sem marca de dedo, reflexos limpos no vidro ou no plástico.",
  bebida: "Condensação real, líquido com cor viva e transparência, reflexos controlados no vidro.",
  alimento: "Textura apetitosa e real, sem brilho artificial, porção verdadeira.",
  moda: "Caimento e textura do tecido aparentes, peça sem amassado, cor fiel.",
  acessorio: "Metal sem mancha e sem reflexo do fotógrafo, tenda de luz para brilho uniforme.",
  tecnologia: "Tela limpa e sem reflexo, cantos e portas nítidos, sem poeira.",
  saude: "Ambiente limpo e claro, sensação de cuidado e confiança.",
};

export const MODELO_PADRAO = "uma pessoa adulta de aparência natural";

export interface PromptDoArsenal {
  id: string;
  area: AreaDoArsenal;
  titulo: string;
  /** O prompt já preenchido, pronto para copiar. */
  texto: string;
  origem: "logica" | "biblioteca";
  /** Produto usado no preenchimento ("" quando o cliente ainda não tem produto). */
  produto: string;
  item_id?: string;
  negativo?: string;
}

/**
 * Prompts do cliente por área: os moldes de lógica fotográfica para cada
 * produto (até 6) e os prompts da biblioteca que servem para o produto
 * principal, já preenchidos. Biblioteca vazia ainda dá prompts úteis; sem
 * produto, o molde fica com a lacuna [produto] para completar.
 */
export function promptsDoCliente(
  itens: ItemDaBiblioteca[],
  produtos: ProdutoDoArsenal[],
  opcoes: { area?: AreaDoArsenal | "todas"; modelo?: string | null; maxProdutos?: number } = {},
): PromptDoArsenal[] {
  const area = opcoes.area && opcoes.area !== "todas" ? opcoes.area : null;
  const modelo = String(opcoes.modelo || "").trim() || MODELO_PADRAO;
  const lista = (produtos || []).filter((p) => p && String(p.nome || "").trim()).slice(0, Math.max(1, opcoes.maxProdutos || 6));
  const saida: PromptDoArsenal[] = [];
  const logicas = LOGICAS_DO_ARSENAL.filter((l) => !area || l.area === area);
  if (!lista.length) {
    for (const l of logicas) {
      saida.push({ id: `logica:${l.id}`, area: l.area, titulo: l.titulo, texto: preencherPrompt(l.texto.replace(/\{produto\}/g, "[produto]"), { modelo }), origem: "logica", produto: "" });
    }
  }
  lista.forEach((p, n) => {
    const segs = segmentosDoProduto(p);
    const cuidado = segs.map((s) => CUIDADO_DO_SEGMENTO[s]).filter(Boolean)[0] || "";
    for (const l of logicas) {
      const molde = cuidado && l.area !== "modelo" ? `${l.texto} ${cuidado}` : l.texto;
      saida.push({
        id: `logica:${l.id}:${n}`,
        area: l.area,
        titulo: lista.length > 1 ? `${l.titulo} · ${p.nome}` : l.titulo,
        texto: preencherPrompt(molde, { produto: p.nome, tipo: p.tipo, marca: p.marca, modelo }),
        origem: "logica",
        produto: p.nome,
      });
    }
  });
  const principal = lista[0] || null;
  for (const i of itens || []) {
    if (i.tipo !== "prompt" || !(i.prompt_pt || i.prompt_en)) continue;
    const a = areaDoItem(i);
    if (area && a !== area) continue;
    if (!relevante(i, lista)) continue;
    saida.push({
      id: `biblioteca:${i.id}`,
      area: a,
      titulo: i.titulo,
      texto: promptDoItem(i, principal ? { produto: principal.nome, tipo: principal.tipo, marca: principal.marca, modelo } : { modelo }),
      origem: "biblioteca",
      produto: principal ? principal.nome : "",
      item_id: i.id,
      negativo: i.negativo || undefined,
    });
  }
  return saida;
}

/** Produtos do arsenal a partir dos kits (pessoa fica de fora; a marca sai do atributo "Marca: X" quando houver). */
export function produtosDosKits(
  kits: { tipo: string; nome: string; variante?: string | null; atributos?: { observado?: string[]; informado?: string[]; inferido?: string[] } | null }[],
): ProdutoDoArsenal[] {
  const saida: ProdutoDoArsenal[] = [];
  for (const k of kits || []) {
    if (!k || k.tipo === "pessoa" || !String(k.nome || "").trim()) continue;
    const at = k.atributos || {};
    const linhas = ([] as string[]).concat(at.informado || [], at.observado || [], at.inferido || []);
    let marca: string | null = null;
    for (const l of linhas) {
      const m = /^\s*(?:pela internet:\s*)?marca\s*:\s*(.+)$/i.exec(String(l));
      if (m) {
        marca = m[1].trim();
        break;
      }
    }
    const nome = [k.nome, k.variante].filter((x) => x && String(x).trim()).join(" ").trim();
    saida.push({ nome, tipo: k.tipo, marca });
  }
  return saida;
}

// ------------------------------------------------------------------ referências livres (Openverse)

/** Termo em inglês do segmento, para a busca pública. */
const TERMO_DO_SEGMENTO: Partial<Record<Segmento, string>> = {
  otica: "eyeglasses",
  cosmetico: "skincare bottle",
  bebida: "drink",
  alimento: "food plate",
  moda: "fashion outfit",
  acessorio: "jewelry",
  tecnologia: "gadget",
  saude: "clinic",
  hospedagem: "hotel room",
  eventos: "event venue",
};

const PESSOA_DO_SEGMENTO: Partial<Record<Segmento, string[]>> = {
  otica: ["woman wearing eyeglasses portrait", "man wearing sunglasses outdoor"],
  cosmetico: ["woman skincare routine portrait"],
  moda: ["model street style portrait"],
  acessorio: ["hand wearing ring close up"],
  bebida: ["person holding drink"],
  alimento: ["person eating at restaurant"],
  tecnologia: ["person using smartphone"],
};

/** Buscas sugeridas no Openverse por área (Modelo busca pessoas e retratos), ajustadas ao segmento do cliente. */
export function buscasLivresDaArea(area: AreaDoArsenal | "todas", produtos: ProdutoDoArsenal[]): string[] {
  const segs: Segmento[] = [];
  for (const p of produtos || []) for (const s of segmentosDoProduto(p)) if (segs.indexOf(s) < 0) segs.push(s);
  const termo = segs.map((s) => TERMO_DO_SEGMENTO[s]).filter(Boolean)[0] || "";
  const comTermo = (t: string) => (termo ? `${termo} ${t}` : t);
  let lista: string[];
  switch (area) {
    case "modelo":
      lista = (segs.map((s) => PESSOA_DO_SEGMENTO[s] || []).filter((l) => l.length)[0] || []).concat(["portrait natural light", "person smiling outdoor portrait", "hands holding object"]);
      break;
    case "cenario":
      lista = ["minimal interior", "wood table still life", "marble surface", termo ? `${termo} shop interior` : "shop interior"];
      break;
    case "luz":
      lista = ["window light still life", "backlight silhouette", "golden hour light", "hard light shadow"];
      break;
    case "angulo":
      lista = [comTermo("flat lay top view"), "low angle", "three quarter view still life"];
      break;
    case "detalhe":
      lista = [comTermo("macro"), "macro texture", "close up detail"];
      break;
    case "composicao":
      lista = ["negative space minimal", "rule of thirds", "leading lines"];
      break;
    default:
      lista = [comTermo("product photography"), "product photography studio", "still life studio"];
  }
  return lista.filter((v, i) => lista.indexOf(v) === i).slice(0, 5);
}

/** Categoria com que uma referência livre entra na biblioteca, pela área. */
export function categoriaDaArea(area: AreaDoArsenal | "todas"): string {
  if (area === "todas") return "estilo";
  return (AREAS_DO_ARSENAL.find((a) => a.valor === area) || { categoria: "estilo" }).categoria;
}
