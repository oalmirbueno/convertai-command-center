/**
 * Receitas de ensaio e presets de câmera da Mesa Foto.
 *
 * Origem: docs/mesa-foto/pesquisa/receitas-ensaio.json (8 receitas editoriais
 * propostas, não testadas) e presets-angulos.json (grade de 96 posições da
 * ficha Qwen Multi-Angles: 8 azimutes x 4 elevações x 3 enquadramentos).
 * Traduzido para português com acentos e completado com o que a função
 * precisa para planejar: luz e cenário de cada receita, câmera de cada tomada
 * e a evidência que a tomada exige do kit (sem ela a tomada fica bloqueada).
 *
 * Regras: ângulos são relativos à frente definida no kit e não são medida
 * garantida na imagem; vista de 90 graus (de cima) fica fora da grade e é
 * marcada como não testada. Sem dependência de Deno nem de banco: a função
 * mesa-foto usa e o teste do painel importa direto. Sem travessão.
 */

export const VERSAO_RECEITAS = "mesa-foto-2";

// ------------------------------------------------------------------ tipos

export type TipoKit = "produto" | "pessoa" | "alimento" | "bebida" | "cosmetico" | "moda" | "tecnologia" | "outro";
export const TIPOS_DE_KIT: TipoKit[] = ["produto", "pessoa", "alimento", "bebida", "cosmetico", "moda", "tecnologia", "outro"];

export type PapelRef =
  | "identidade"
  | "detalhe"
  | "embalagem"
  | "verso"
  | "rotulo"
  | "rosto"
  | "corpo"
  | "pose"
  | "estilo"
  | "cenario";
export const PAPEIS: PapelRef[] = ["identidade", "detalhe", "embalagem", "verso", "rotulo", "rosto", "corpo", "pose", "estilo", "cenario"];

/** Papéis que documentam o próprio assunto (evidência). Pose, estilo e cenário só orientam. */
export const PAPEIS_DE_EVIDENCIA: PapelRef[] = ["identidade", "detalhe", "embalagem", "verso", "rotulo", "rosto", "corpo"];

export type Enquadramento = "detalhe" | "medio" | "aberto";
export const ENQUADRAMENTOS: Enquadramento[] = ["detalhe", "medio", "aberto"];

export type Camera = {
  /** Graus em volta do assunto, 0 = frente definida no kit, 90 = lateral direita do assunto. */
  azimute: number;
  /** Graus acima (positivo) ou abaixo (negativo) da linha do assunto. */
  elevacao: number;
  enquadramento: Enquadramento;
  /** Preset da grade quando a câmera cai nela; null quando é posição própria (ex.: vista de cima). */
  preset_id: string | null;
};

export type Exigencia = {
  /** Qualquer um destes papéis no kit satisfaz a exigência. */
  papeis?: PapelRef[];
  /** Atributo que precisa estar entre os "informados" pelo cliente (ex.: medida). */
  informado?: "medida";
  /** Como a lacuna aparece na tela. */
  descricao: string;
};

/**
 * O que a foto mostra como assunto: o produto (padrão), a embalagem (quando
 * só há a caixa) ou o produto fora da embalagem (recriado das fotos do
 * produto, nunca da arte da caixa).
 */
export type Foco = "produto" | "embalagem" | "fora_da_embalagem";
export const FOCOS: Foco[] = ["produto", "embalagem", "fora_da_embalagem"];

export type TomadaDaReceita = {
  id: string;
  nome: string;
  objetivo: string;
  camera: Camera;
  exige?: Exigencia;
  /** Pede área livre no quadro para texto (anúncio, banner). */
  espaco_para_texto?: boolean;
  foco?: Foco;
  /** Tipo de variação (TIPOS_DE_VARIACAO) quando a tomada segue um deles. */
  tipo_variacao?: string;
  /** Tomada de campanha com pessoa sintética usando o produto. */
  com_pessoa?: boolean;
};

export type Receita = {
  id: string;
  nome: string;
  tipos_de_kit: TipoKit[];
  direcao: string;
  luz: string;
  cenario: string;
  tomadas: TomadaDaReceita[];
  atributos_criticos: string[];
  regra: string;
  testada: false;
};

// ---------------------------------------------------------------- presets

export type Preset = {
  id: string;
  nome: string;
  azimute_graus: number;
  elevacao_graus: number;
  enquadramento: Enquadramento;
  zoom_fal_sugerido: number;
  testado: false;
};

export const AZIMUTES: { graus: number; nome: string; vista: string }[] = [
  { graus: 0, nome: "Frente", vista: "frente" },
  { graus: 45, nome: "Três quartos direito", vista: "tres_quartos_direito" },
  { graus: 90, nome: "Lateral direita", vista: "lateral_direita" },
  { graus: 135, nome: "Posterior direito", vista: "posterior_direito" },
  { graus: 180, nome: "Verso", vista: "verso" },
  { graus: 225, nome: "Posterior esquerdo", vista: "posterior_esquerdo" },
  { graus: 270, nome: "Lateral esquerda", vista: "lateral_esquerda" },
  { graus: 315, nome: "Três quartos esquerdo", vista: "tres_quartos_esquerdo" },
];

export const ELEVACOES: { graus: number; nome: string }[] = [
  { graus: -30, nome: "Câmera baixa" },
  { graus: 0, nome: "Na altura do assunto" },
  { graus: 30, nome: "Elevada" },
  { graus: 60, nome: "Vista alta" },
];

const ZOOM_FAL: Record<Enquadramento, number> = { detalhe: 10, medio: 5, aberto: 0 };
const NOME_ENQUADRAMENTO: Record<Enquadramento, string> = { detalhe: "detalhe", medio: "médio", aberto: "aberto" };

/** Id no formato da pesquisa: a{azimute}-e{elevacao}-d{enquadramento} (ex.: a45-e-30-dmedio). */
export const idDoPreset = (azimute: number, elevacao: number, enquadramento: Enquadramento) =>
  `a${azimute}-e${elevacao}-d${enquadramento}`;

/** As 96 posições da grade, na mesma ordem do arquivo da pesquisa. */
export const PRESETS: Preset[] = AZIMUTES.flatMap((a) =>
  ELEVACOES.flatMap((e) =>
    ENQUADRAMENTOS.map((d) => ({
      id: idDoPreset(a.graus, e.graus, d),
      nome: `${a.nome} / ${e.nome} / ${NOME_ENQUADRAMENTO[d]}`,
      azimute_graus: a.graus,
      elevacao_graus: e.graus,
      enquadramento: d,
      zoom_fal_sugerido: ZOOM_FAL[d],
      testado: false as const,
    }))
  )
);

const PRESETS_POR_ID = new Map(PRESETS.map((p) => [p.id, p]));

export function presetPorId(id: unknown): Preset | null {
  return typeof id === "string" ? PRESETS_POR_ID.get(id) ?? null : null;
}

/** Câmera a partir de um preset da grade. */
export function cameraDoPreset(id: string): Camera {
  const p = presetPorId(id);
  if (!p) throw new Error(`preset desconhecido: ${id}`);
  return { azimute: p.azimute_graus, elevacao: p.elevacao_graus, enquadramento: p.enquadramento, preset_id: p.id };
}

/** Câmera fora da grade (ex.: vista de cima a 90 graus, 45 graus para alimento). */
const cameraPropria = (azimute: number, elevacao: number, enquadramento: Enquadramento): Camera => {
  const id = idDoPreset(azimute, elevacao, enquadramento);
  return { azimute, elevacao, enquadramento, preset_id: PRESETS_POR_ID.has(id) ? id : null };
};

// ---------------------------------------------------------------- receitas

const REGRA = "Tomadas dependem das evidências do kit; não preencher detalhes desconhecidos como reais.";
const c = cameraDoPreset;

export const RECEITAS: Receita[] = [
  {
    id: "catalogo-fiel",
    nome: "Catálogo fiel",
    tipos_de_kit: ["produto", "tecnologia", "cosmetico", "moda", "bebida", "outro"],
    direcao: "Fundo neutro, produto original recomposto, cor e escala consistentes entre as tomadas.",
    luz: "Luz ampla e suave de estúdio: softbox grande como luz chave a 45 graus e um pouco acima, rebatedor branco do lado oposto como preenchimento, recorte suave por trás para separar as bordas do fundo. Balanço de branco neutro.",
    cenario: "Fundo branco infinito de estúdio, sem costura, sem textura e sem objetos.",
    tomadas: [
      { id: "principal", nome: "Principal limpa", objetivo: "Foto principal da página do produto.", camera: c("a0-e0-dmedio") },
      { id: "frente", nome: "Frente", objetivo: "Frente comercial do produto.", camera: c("a0-e0-dmedio") },
      { id: "tres-quartos", nome: "Três quartos", objetivo: "Mostrar volume e profundidade.", camera: c("a45-e30-dmedio") },
      { id: "lateral", nome: "Lateral", objetivo: "Perfil e espessura.", camera: c("a90-e0-dmedio") },
      {
        id: "verso",
        nome: "Verso documentado",
        objetivo: "Verso real do produto.",
        camera: c("a180-e0-dmedio"),
        exige: { papeis: ["verso"], descricao: "uma foto real do verso" },
      },
      {
        id: "detalhe",
        nome: "Detalhe documentado",
        objetivo: "Detalhe que vende (acabamento, textura, marca).",
        camera: c("a0-e0-ddetalhe"),
        exige: { papeis: ["detalhe", "rotulo"], descricao: "uma foto real do detalhe" },
      },
      {
        id: "com-embalagem",
        nome: "Produto e embalagem",
        objetivo: "O que o cliente recebe.",
        camera: c("a45-e30-daberto"),
        exige: { papeis: ["embalagem"], descricao: "uma foto real da embalagem" },
      },
      {
        id: "escala",
        nome: "Escala com medida confirmada",
        objetivo: "Dar noção de tamanho real.",
        camera: c("a45-e30-daberto"),
        exige: { informado: "medida", descricao: "a medida real informada pelo cliente" },
      },
    ],
    atributos_criticos: ["Modelo", "Variante", "Cor", "Texto", "Proporção"],
    regra: REGRA,
    testada: false,
  },
  {
    id: "tecnologia",
    nome: "Tecnologia e acessórios",
    tipos_de_kit: ["tecnologia", "produto"],
    direcao: "Superfícies limpas, reflexos controlados, sensação de precisão.",
    luz: "Luz lateral suave com difusor grande, bandeiras pretas para desenhar reflexos controlados nas superfícies brilhantes, gradiente suave no corpo do aparelho e recorte frio discreto nas bordas.",
    cenario: "Superfície neutra fosca e fundo com gradiente suave, sem objetos que disputem atenção.",
    tomadas: [
      { id: "principal", nome: "Principal em três quartos", objetivo: "Foto principal do aparelho.", camera: c("a45-e30-dmedio") },
      { id: "frente", nome: "Frente", objetivo: "Frente comercial.", camera: c("a0-e0-dmedio") },
      { id: "lateral", nome: "Lateral", objetivo: "Espessura e perfil.", camera: c("a90-e0-dmedio") },
      {
        id: "portas",
        nome: "Portas documentadas",
        objetivo: "Conectores reais.",
        camera: c("a90-e0-ddetalhe"),
        exige: { papeis: ["detalhe"], descricao: "uma foto real das portas e conectores" },
      },
      {
        id: "botoes",
        nome: "Botões documentados",
        objetivo: "Botões e controles reais.",
        camera: c("a0-e30-ddetalhe"),
        exige: { papeis: ["detalhe"], descricao: "uma foto real dos botões" },
      },
      {
        id: "embalagem",
        nome: "Embalagem",
        objetivo: "Produto com a caixa.",
        camera: c("a45-e30-dmedio"),
        exige: { papeis: ["embalagem"], descricao: "uma foto real da embalagem" },
      },
      { id: "uso-em-mesa", nome: "Uso em mesa", objetivo: "Contexto de uso em mesa de trabalho.", camera: c("a45-e30-daberto") },
      { id: "campanha", nome: "Composição para campanha", objetivo: "Imagem de destaque para anúncio.", camera: c("a45-e-30-dmedio"), espaco_para_texto: true },
    ],
    atributos_criticos: ["Conectores", "Câmeras", "Botões", "Tela", "Espessura"],
    regra: REGRA,
    testada: false,
  },
  {
    id: "cosmeticos",
    nome: "Cosméticos e frascos",
    tipos_de_kit: ["cosmetico", "produto"],
    direcao: "Luz ampla, rótulo legível, materiais coerentes (vidro, plástico, metal).",
    luz: "Luz ampla e suave com duas softboxes em faixa dos lados para desenhar o contorno do frasco, luz de fundo discreta para a transparência, rebatedor frontal para o rótulo ficar legível.",
    cenario: "Fundo claro e limpo, bancada neutra quando houver apoio.",
    tomadas: [
      { id: "frasco", nome: "Frasco principal", objetivo: "Foto principal.", camera: c("a0-e0-dmedio") },
      {
        id: "frasco-e-caixa",
        nome: "Frasco e caixa",
        objetivo: "O que o cliente recebe.",
        camera: c("a45-e30-dmedio"),
        exige: { papeis: ["embalagem"], descricao: "uma foto real da caixa" },
      },
      {
        id: "rotulo",
        nome: "Rótulo",
        objetivo: "Rótulo legível.",
        camera: c("a0-e0-ddetalhe"),
        exige: { papeis: ["rotulo", "detalhe"], descricao: "uma foto nítida do rótulo" },
      },
      {
        id: "tampa",
        nome: "Tampa",
        objetivo: "Acabamento da tampa.",
        camera: c("a0-e60-ddetalhe"),
        exige: { papeis: ["detalhe"], descricao: "uma foto real da tampa" },
      },
      {
        id: "textura",
        nome: "Textura documentada",
        objetivo: "Textura real do produto.",
        camera: c("a0-e60-ddetalhe"),
        exige: { papeis: ["detalhe"], descricao: "uma foto real da textura do produto" },
      },
      { id: "bancada", nome: "Contexto de bancada", objetivo: "Uso no dia a dia.", camera: c("a45-e30-daberto") },
      { id: "campanha", nome: "Cena de campanha", objetivo: "Imagem de destaque para anúncio.", camera: c("a45-e-30-dmedio"), espaco_para_texto: true },
    ],
    atributos_criticos: ["Volume", "Rótulo", "Transparência", "Cor", "Quantidade"],
    regra: REGRA,
    testada: false,
  },
  {
    id: "alimentos",
    nome: "Alimentos e pratos",
    tipos_de_kit: ["alimento"],
    direcao: "Textura natural e luz lateral; preservar a receita real, a porção e a montagem.",
    luz: "Luz natural lateral difusa (janela grande) entre 90 e 120 graus em relação à câmera, rebatedor suave do lado oposto, contraluz leve para brilho e textura. Nada de luz dura de flash direto.",
    cenario: "Mesa de madeira ou pedra neutra, louça e talheres discretos, sem ingredientes que não fazem parte do prato.",
    tomadas: [
      { id: "principal", nome: "Prato principal", objetivo: "Foto principal do prato.", camera: c("a0-e30-dmedio") },
      { id: "45-graus", nome: "Vista a 45 graus", objetivo: "Volume e altura do prato.", camera: cameraPropria(0, 45, "medio") },
      { id: "de-cima", nome: "Vista superior quando adequada", objetivo: "Composição de cima para pratos planos.", camera: cameraPropria(0, 90, "medio") },
      {
        id: "detalhe",
        nome: "Detalhe real",
        objetivo: "Textura do alimento.",
        camera: c("a0-e30-ddetalhe"),
        exige: { papeis: ["detalhe"], descricao: "uma foto real do detalhe do prato" },
      },
      {
        id: "entrega",
        nome: "Embalagem de entrega",
        objetivo: "Como chega na casa do cliente.",
        camera: c("a45-e30-dmedio"),
        exige: { papeis: ["embalagem"], descricao: "uma foto real da embalagem de entrega" },
      },
      { id: "mesa", nome: "Contexto de mesa", objetivo: "Clima de refeição.", camera: c("a45-e30-daberto") },
    ],
    atributos_criticos: ["Ingredientes", "Porção", "Ponto de preparo", "Cor", "Montagem"],
    regra: REGRA,
    testada: false,
  },
  {
    id: "bebidas",
    nome: "Bebidas e embalagens",
    tipos_de_kit: ["bebida", "alimento"],
    direcao: "Reflexos controlados, líquido com cor real e escala fiel do recipiente.",
    luz: "Contraluz para a transparência do líquido, faixas de luz laterais para desenhar o contorno do vidro, reflexos controlados; gotas e gelo só quando documentados.",
    cenario: "Superfície neutra, fundo limpo com gradiente suave.",
    tomadas: [
      { id: "principal", nome: "Embalagem principal", objetivo: "Foto principal.", camera: c("a0-e0-dmedio") },
      {
        id: "rotulo",
        nome: "Rótulo",
        objetivo: "Rótulo legível.",
        camera: c("a0-e0-ddetalhe"),
        exige: { papeis: ["rotulo", "detalhe"], descricao: "uma foto nítida do rótulo" },
      },
      {
        id: "servida",
        nome: "Bebida servida documentada",
        objetivo: "A bebida no copo, como é servida.",
        camera: c("a45-e30-dmedio"),
        exige: { papeis: ["detalhe"], descricao: "uma foto real da bebida servida" },
      },
      {
        id: "detalhe",
        nome: "Detalhe",
        objetivo: "Acabamento do recipiente.",
        camera: c("a0-e0-ddetalhe"),
        exige: { papeis: ["detalhe"], descricao: "uma foto real do detalhe" },
      },
      { id: "mesa", nome: "Composição de mesa", objetivo: "Contexto de consumo.", camera: c("a45-e30-daberto") },
      { id: "com-texto", nome: "Cena com espaço para texto", objetivo: "Base para anúncio ou banner.", camera: c("a0-e0-daberto"), espaco_para_texto: true },
    ],
    atributos_criticos: ["Marca", "Volume", "Composição", "Recipiente", "Cor"],
    regra: REGRA,
    testada: false,
  },
  {
    id: "retrato-profissional",
    nome: "Retrato profissional",
    tipos_de_kit: ["pessoa"],
    direcao: "Pele natural, iluminação suave, roupa coerente com a profissão e a marca.",
    luz: "Luz principal suave (octabox grande) a 45 graus e um pouco acima da linha dos olhos, rebatedor para preencher as sombras do rosto, recorte suave no cabelo e nos ombros. Pele com textura real, sem retoque plástico.",
    cenario: "Fundo de estúdio neutro ou ambiente profissional desfocado coerente com o negócio.",
    tomadas: [
      {
        id: "frontal",
        nome: "Retrato frontal",
        objetivo: "Foto de perfil e apresentação.",
        camera: c("a0-e0-ddetalhe"),
        exige: { papeis: ["rosto", "identidade"], descricao: "fotos reais do rosto" },
      },
      {
        id: "tres-quartos",
        nome: "Três quartos",
        objetivo: "Retrato com mais profundidade.",
        camera: c("a45-e0-ddetalhe"),
        exige: { papeis: ["rosto", "identidade"], descricao: "fotos reais do rosto" },
      },
      {
        id: "meio-corpo",
        nome: "Meio corpo",
        objetivo: "Apresentação profissional.",
        camera: c("a0-e0-dmedio"),
        exige: { papeis: ["corpo", "identidade"], descricao: "uma foto real de meio corpo ou corpo inteiro" },
      },
      {
        id: "sentado",
        nome: "Sentado",
        objetivo: "Postura de atendimento.",
        camera: c("a45-e0-dmedio"),
        exige: { papeis: ["corpo"], descricao: "uma foto real de corpo" },
      },
      {
        id: "ambiente",
        nome: "Ambiente profissional",
        objetivo: "A pessoa no lugar de trabalho.",
        camera: c("a45-e0-dmedio"),
        exige: { papeis: ["corpo", "identidade"], descricao: "uma foto real de meio corpo ou corpo inteiro" },
      },
      {
        id: "com-texto",
        nome: "Foto com espaço para texto",
        objetivo: "Base para anúncio ou capa.",
        camera: c("a0-e0-dmedio"),
        espaco_para_texto: true,
        exige: { papeis: ["corpo", "identidade"], descricao: "uma foto real de meio corpo ou corpo inteiro" },
      },
    ],
    atributos_criticos: ["Identidade", "Idade aparente", "Pele", "Óculos", "Mãos"],
    regra: REGRA,
    testada: false,
  },
  {
    id: "ensaio-editorial",
    nome: "Ensaio pessoal editorial",
    tipos_de_kit: ["pessoa"],
    direcao: "Variar direção de luz e ambiente mantendo a identidade aprovada.",
    luz: "Direção de luz variada por tomada: luz natural suave de janela, contraluz dourado de fim de tarde, luz de estúdio com recorte. Sempre com exposição correta e pele natural.",
    cenario: "Ambientes coerentes com a história e o posicionamento da pessoa.",
    tomadas: [
      {
        id: "retrato",
        nome: "Retrato",
        objetivo: "Abertura do ensaio.",
        camera: c("a0-e0-ddetalhe"),
        exige: { papeis: ["rosto", "identidade"], descricao: "fotos reais do rosto" },
      },
      {
        id: "meio-corpo",
        nome: "Meio corpo",
        objetivo: "Presença e postura.",
        camera: c("a45-e0-dmedio"),
        exige: { papeis: ["corpo", "identidade"], descricao: "uma foto real de meio corpo ou corpo inteiro" },
      },
      {
        id: "corpo-inteiro",
        nome: "Corpo inteiro",
        objetivo: "Figura inteira com proporções reais.",
        camera: c("a0-e0-daberto"),
        exige: { papeis: ["corpo"], descricao: "uma foto real de corpo inteiro" },
      },
      {
        id: "pose",
        nome: "Pose alternativa",
        objetivo: "Variação de gesto e expressão.",
        camera: c("a315-e0-dmedio"),
        exige: { papeis: ["corpo", "identidade"], descricao: "uma foto real de meio corpo ou corpo inteiro" },
      },
      {
        id: "externo",
        nome: "Ambiente externo",
        objetivo: "Luz natural e contexto.",
        camera: c("a45-e0-daberto"),
        exige: { papeis: ["corpo"], descricao: "uma foto real de corpo inteiro" },
      },
      {
        id: "estudio",
        nome: "Ambiente de estúdio",
        objetivo: "Fundo limpo, luz controlada.",
        camera: c("a0-e0-dmedio"),
        exige: { papeis: ["corpo", "identidade"], descricao: "uma foto real de meio corpo ou corpo inteiro" },
      },
    ],
    atributos_criticos: ["Identidade", "Anatomia", "Expressão", "Cabelo", "Acessórios"],
    regra: REGRA,
    testada: false,
  },
  {
    id: "moda-acessorios",
    nome: "Moda e acessórios",
    tipos_de_kit: ["moda", "produto"],
    direcao: "Material, cor e proporção consistentes; caimento claro.",
    luz: "Luz ampla e uniforme para cor fiel, luz rasante lateral para revelar a textura do material e a costura.",
    cenario: "Fundo neutro claro; na composição editorial, ambiente coerente com a marca.",
    tomadas: [
      { id: "frente", nome: "Frente", objetivo: "Frente da peça.", camera: c("a0-e0-dmedio") },
      {
        id: "costas",
        nome: "Costas documentadas",
        objetivo: "Costas reais da peça.",
        camera: c("a180-e0-dmedio"),
        exige: { papeis: ["verso"], descricao: "uma foto real das costas" },
      },
      { id: "tres-quartos", nome: "Três quartos", objetivo: "Volume e caimento.", camera: c("a45-e0-dmedio") },
      {
        id: "material",
        nome: "Detalhe de material",
        objetivo: "Tecido, couro ou metal de perto.",
        camera: c("a0-e0-ddetalhe"),
        exige: { papeis: ["detalhe"], descricao: "uma foto real do material" },
      },
      {
        id: "fecho",
        nome: "Fecho ou costura",
        objetivo: "Acabamento.",
        camera: c("a0-e30-ddetalhe"),
        exige: { papeis: ["detalhe"], descricao: "uma foto real do fecho ou da costura" },
      },
      {
        id: "no-corpo",
        nome: "Escala no corpo",
        objetivo: "Peça vestida por pessoa autorizada.",
        camera: c("a0-e0-daberto"),
        exige: { papeis: ["corpo"], descricao: "uma foto real da peça vestida por pessoa autorizada" },
      },
      { id: "editorial", nome: "Composição editorial", objetivo: "Imagem de campanha.", camera: c("a45-e30-daberto"), espaco_para_texto: true },
    ],
    atributos_criticos: ["Estampa", "Costura", "Cor", "Proporção", "Modelo"],
    regra: REGRA,
    testada: false,
  },
  {
    id: "fora-da-embalagem",
    nome: "Produto fora da embalagem",
    tipos_de_kit: ["produto", "tecnologia", "cosmetico", "moda", "bebida", "outro"],
    direcao:
      "O produto em si, fora da caixa, recriado a partir das fotos do produto (reais ou referências oficiais da internet), nunca da arte impressa na embalagem. Sem foto do produto, a embalagem vira o assunto.",
    luz: "Softbox grande como chave a 45 graus e um pouco acima, rebatedor branco do lado oposto, recorte suave por trás para separar as bordas; reflexos desenhados com bandeiras nas partes brilhantes. Balanço de branco neutro.",
    cenario: "Superfície neutra e limpa, fundo com gradiente suave na paleta da marca, sem objetos que disputem atenção.",
    tomadas: [
      { id: "heroi", nome: "Herói fora da caixa", objetivo: "O produto sozinho, inteiro, como página de loja premium.", camera: c("a45-e30-dmedio"), foco: "fora_da_embalagem", tipo_variacao: "fora_da_caixa" },
      { id: "frente", nome: "Frente limpa", objetivo: "Frente comercial do produto fora da caixa.", camera: c("a0-e0-dmedio"), foco: "fora_da_embalagem", tipo_variacao: "fundo_branco" },
      { id: "na-mao", nome: "Na mão", objetivo: "Escala e uso: o produto na mão de uma pessoa adulta.", camera: c("a45-e0-dmedio"), foco: "fora_da_embalagem", tipo_variacao: "na_mao" },
      { id: "em-uso", nome: "Em uso", objetivo: "O produto no ambiente de uso do público.", camera: c("a45-e30-daberto"), foco: "fora_da_embalagem", tipo_variacao: "lifestyle" },
      {
        id: "com-caixa",
        nome: "Produto e caixa",
        objetivo: "O produto ao lado da embalagem real: o que o cliente recebe.",
        camera: c("a45-e30-daberto"),
        exige: { papeis: ["embalagem"], descricao: "uma foto real da embalagem" },
        tipo_variacao: "com_embalagem",
      },
      { id: "embalagem", nome: "Embalagem em destaque", objetivo: "A caixa real como assunto (serve mesmo sem foto do produto).", camera: c("a45-e30-dmedio"), foco: "embalagem", tipo_variacao: "heroi_fundo_cor" },
    ],
    atributos_criticos: ["Modelo", "Variante", "Cor", "Texto", "Proporção"],
    regra: "Produto fora da caixa só com foto do produto (real ou referência oficial da internet, uso interno). A arte da caixa nunca vira o produto.",
    testada: false,
  },
  {
    id: "campanha-com-modelo",
    nome: "Campanha com modelo",
    tipos_de_kit: ["produto", "tecnologia", "cosmetico", "moda", "bebida", "alimento", "outro"],
    direcao:
      "Fotografia publicitária editorial: uma pessoa sintética (gerada, adulta, sem parecer ninguém real) usando o produto do kit em cenários que complementam a identidade do cliente, com guia de estilo tirado das referências. O produto é invariante.",
    luz: "Luz de campanha com intenção: chave marcada e suave (octabox grande ou sol filtrado), preenchimento baixo para dar volume, recorte no cabelo e no produto; temperatura de cor coerente com o guia de estilo.",
    cenario: "Cenários do guia de estilo da campanha, coerentes com a marca e o público do cliente.",
    tomadas: [
      { id: "retrato", nome: "Retrato de perto com o produto", objetivo: "Rosto e produto juntos, olhar para a câmera.", camera: c("a0-e0-ddetalhe"), com_pessoa: true },
      { id: "meio-corpo", nome: "Meio corpo em cenário da marca", objetivo: "Atitude e estilo da campanha.", camera: c("a45-e0-dmedio"), com_pessoa: true },
      { id: "lifestyle", nome: "Lifestyle", objetivo: "A pessoa vivendo a rotina com o produto.", camera: c("a315-e0-daberto"), com_pessoa: true },
      { id: "produto-destaque", nome: "Produto em destaque", objetivo: "O produto sozinho, no clima da campanha.", camera: c("a45-e-30-dmedio"), com_pessoa: false, espaco_para_texto: true },
    ],
    atributos_criticos: ["Produto idêntico", "Mãos", "Pessoa sintética adulta", "Escala do produto no corpo"],
    regra: "Pessoa sintética nunca parecida com pessoa real conhecida; adulta; sem sexualização; marcada como gerada. O produto do kit não muda.",
    testada: false,
  },
];

/** Receitas que só existem na Mesa Foto v2 (fora da pesquisa original). */
export const RECEITAS_V2 = ["fora-da-embalagem", "campanha-com-modelo"];
export const RECEITA_CAMPANHA = "campanha-com-modelo";
/** receita_id gravado nos ensaios feitos por variacoes_planejar. */
export const RECEITA_VARIACOES = "variacoes";

// ---------------------------------------------------------------- variações

export type TipoDeVariacao = {
  id: string;
  nome: string;
  /** O que diferencia esta variação das outras, dito ao gerador. */
  direcao: string;
  /** Câmeras em ordem: a segunda vale quando o tipo se repete no lote. */
  cameras: Camera[];
  cenario: string;
  luz: string;
  props: string[];
  formato: "1:1" | "4:5" | "9:16" | "16:9";
  foco: Foco;
  exige?: Exigencia;
  /** Mostra mão ou corpo de pessoa (sintética). */
  com_maos?: boolean;
  /** Assunto suspenso no ar: a regra de sombra de contato muda. */
  flutuando?: boolean;
};

export const TIPOS_DE_VARIACAO: TipoDeVariacao[] = [
  {
    id: "heroi_fundo_cor",
    nome: "Herói em fundo de cor",
    direcao: "Foto herói de anúncio: o assunto grande, imponente e centralizado sobre cor sólida da marca.",
    cameras: [c("a45-e-30-dmedio"), c("a0-e0-dmedio")],
    cenario: "Fundo contínuo de papel sem costura em cor sólida saturada da paleta da marca, piso da mesma cor, sem objetos.",
    luz: "Softbox grande a 45 graus como chave, rebatedor branco do lado oposto, recorte por trás desenhando o contorno, leve gradiente de luz no fundo atrás do assunto.",
    props: [],
    formato: "4:5",
    foco: "produto",
  },
  {
    id: "fundo_branco",
    nome: "Fundo branco de catálogo",
    direcao: "Foto de catálogo e marketplace: limpa, fiel e sem distração.",
    cameras: [c("a0-e0-dmedio"), c("a45-e30-dmedio")],
    cenario: "Fundo branco puro (#FFFFFF) infinito, sem costura, sem textura e sem objetos.",
    luz: "Luz ampla e uniforme de duas softboxes laterais e uma de cima, sombras suaves e curtas, cor fiel ao material.",
    props: [],
    formato: "1:1",
    foco: "produto",
  },
  {
    id: "lifestyle",
    nome: "Lifestyle em uso",
    direcao: "O assunto no ambiente real do público, como se fosse flagrado em uso, com profundidade de campo.",
    cameras: [c("a45-e30-daberto"), c("a315-e30-daberto")],
    cenario: "Ambiente real de uso coerente com o público do cliente (mesa de trabalho, bancada, sala ou rua), com planos de profundidade e fundo levemente desfocado.",
    luz: "Luz natural de janela lateral, temperatura levemente quente, preenchimento suave de rebatedor, sem flash direto.",
    props: ["objetos do dia a dia do público, discretos, sem marca e sem texto"],
    formato: "4:5",
    foco: "produto",
  },
  {
    id: "na_mao",
    nome: "Na mão",
    direcao: "Escala e toque: o assunto seguro por uma mão adulta, de forma natural e crível.",
    cameras: [c("a45-e0-dmedio"), c("a0-e30-dmedio")],
    cenario: "Mão adulta segurando ou usando o assunto em primeiro plano, fundo de ambiente desfocado na paleta da marca.",
    luz: "Luz suave lateral com pele natural e textura real, recorte discreto no contorno do assunto.",
    props: [],
    formato: "4:5",
    foco: "produto",
    com_maos: true,
  },
  {
    id: "flat_lay",
    nome: "Flat lay com props",
    direcao: "Composição editorial vista de cima, geométrica, com respiro e objetos que contam o uso.",
    cameras: [{ azimute: 0, elevacao: 90, enquadramento: "medio", preset_id: null }, { azimute: 0, elevacao: 90, enquadramento: "aberto", preset_id: null }],
    cenario: "Superfície texturizada vista de cima (pedra, madeira clara, linho ou papel na cor da paleta), composição geométrica com espaço negativo.",
    luz: "Luz difusa de cima e levemente lateral, sombras curtas e suaves, sem brilho estourado.",
    props: ["3 a 5 objetos que contam o uso do produto, sem marca e sem texto"],
    formato: "1:1",
    foco: "produto",
  },
  {
    id: "macro",
    nome: "Macro de detalhe",
    direcao: "Close extremo do detalhe que vende (acabamento, textura, logotipo, material).",
    cameras: [c("a0-e0-ddetalhe"), c("a45-e30-ddetalhe")],
    cenario: "Fundo escuro neutro ou da cor da marca muito desfocado; o detalhe ocupa o quadro.",
    luz: "Luz rasante lateral para revelar textura, pequena luz de recorte para o brilho do material.",
    props: [],
    formato: "4:5",
    foco: "produto",
  },
  {
    id: "cenario_marca",
    nome: "Cenário da marca",
    direcao: "Cena construída com o universo do cliente: materiais, cores e objetos que contam a história da marca.",
    cameras: [c("a45-e30-dmedio"), c("a315-e0-dmedio")],
    cenario: "Cenário construído com as cores, materiais e texturas da identidade do cliente, com um ou dois elementos que remetem à história e ao público dele.",
    luz: "Luz de campanha: chave marcada e suave, recorte colorido discreto na cor da marca, preenchimento baixo para volume.",
    props: ["elementos do universo da marca, sem logotipo de terceiros"],
    formato: "4:5",
    foco: "produto",
  },
  {
    id: "flutuando",
    nome: "Produto flutuando",
    direcao: "Assunto suspenso no ar, levemente inclinado, com formas geométricas simples da paleta: clima de campanha surreal e limpo.",
    cameras: [c("a45-e-30-dmedio"), c("a0-e0-dmedio")],
    cenario: "Assunto suspenso no ar sobre fundo de cor da marca ou céu limpo, com duas ou três formas geométricas simples ao redor.",
    luz: "Luz de estúdio limpa e brilhante, chave suave de cima, recorte nas bordas; sombra projetada suave e distante no fundo.",
    props: ["formas geométricas simples na paleta da marca"],
    formato: "4:5",
    foco: "produto",
    flutuando: true,
  },
  {
    id: "fora_da_caixa",
    nome: "Fora da caixa",
    direcao: "O produto em si, fora da embalagem, inteiro e nítido, recriado das fotos do produto (nunca da arte da caixa).",
    cameras: [c("a45-e30-dmedio"), c("a315-e30-dmedio")],
    cenario: "Superfície neutra e limpa com gradiente suave na paleta da marca, sem a caixa.",
    luz: "Softbox grande a 45 graus, rebatedor do lado oposto, recorte por trás, reflexos controlados nas partes brilhantes.",
    props: [],
    formato: "4:5",
    foco: "fora_da_embalagem",
  },
  {
    id: "com_embalagem",
    nome: "Produto com a embalagem",
    direcao: "O produto ao lado da caixa real: o que o cliente recebe ao comprar.",
    cameras: [c("a45-e30-daberto"), c("a0-e30-daberto")],
    cenario: "Produto em primeiro plano e a caixa real logo atrás ou ao lado, superfície limpa da paleta da marca.",
    luz: "Luz ampla e suave para o texto da caixa ficar legível, recorte para separar produto e caixa.",
    props: [],
    formato: "4:5",
    foco: "produto",
    exige: { papeis: ["embalagem"], descricao: "uma foto real da embalagem" },
  },
];

const TIPOS_DE_VARIACAO_POR_ID = new Map(TIPOS_DE_VARIACAO.map((t) => [t.id, t]));

export function tipoDeVariacaoPorId(id: unknown): TipoDeVariacao | null {
  return typeof id === "string" ? TIPOS_DE_VARIACAO_POR_ID.get(id) ?? null : null;
}

/** Ordem padrão do lote: o mais útil primeiro e o mais diferente do anterior. */
export const ORDEM_DAS_VARIACOES = [
  "heroi_fundo_cor", "lifestyle", "na_mao", "flat_lay", "macro", "cenario_marca", "fundo_branco", "flutuando", "com_embalagem", "fora_da_caixa",
];

/** Quando um tipo se repete no lote, a rodada seguinte muda algo concreto. */
export const MUDANCAS_DA_RODADA = [
  "",
  "outra cor de apoio da paleta e outro material de superfície",
  "outra hora do dia e outra direção da luz chave",
  "outro cenário do mesmo universo e composição espelhada no quadro (sem espelhar o assunto)",
];

/** Regras da pessoa sintética (campanha e mãos), escritas como instrução ao gerador. */
export const PROIBICOES_PESSOA_SINTETICA = [
  "a pessoa é sintética: nunca parecida com pessoa real conhecida (celebridade, influenciador, político, atleta, modelo famoso)",
  "pessoa adulta, sem aparência de menor de idade",
  "sem sexualização, sem nudez e sem roupa reveladora",
  "mãos com cinco dedos, unhas e articulações corretas, segurando o produto de forma crível",
  "não copiar rosto, corpo, tatuagem nem pose exata de pessoas das referências de estilo",
];

const RECEITAS_POR_ID = new Map(RECEITAS.map((r) => [r.id, r]));

export function receitaPorId(id: unknown): Receita | null {
  return typeof id === "string" ? RECEITAS_POR_ID.get(id) ?? null : null;
}

// --------------------------------------------------- linguagem de fotógrafo

/** Grupo de regras por tipo de kit: o que conferir e o que é proibido mudar. */
export type Grupo = "produto" | "pessoa" | "alimento";

export function gruposDoTipo(tipo: TipoKit): Grupo[] {
  if (tipo === "pessoa") return ["pessoa"];
  if (tipo === "alimento") return ["alimento"];
  // Bebida tem rótulo (produto) e volume servido (alimento).
  if (tipo === "bebida") return ["produto", "alimento"];
  return ["produto"];
}

/** Proibições por grupo, escritas como instrução ao gerador. */
export const PROIBICOES: Record<Grupo, string[]> = {
  produto: [
    "não inventar lado, porta, botão, costura, texto ou detalhe que não aparece nas fontes",
    "não espelhar o produto (espelhar inverte o texto e as assimetrias)",
    "não mudar cor, material, acabamento, proporção nem a quantidade de botões, portas, câmeras ou peças",
    "não trocar a variante nem o modelo",
    "não acrescentar logo, selo, texto, preço ou marca d'água",
  ],
  pessoa: [
    "não mudar o rosto, os traços, a idade aparente, o tom de pele nem o formato do corpo",
    "não afinar, rejuvenescer, alongar nem 'embelezar' a pessoa; retoque só de luz",
    "manter cabelo, óculos, pintas, marcas, tatuagens e acessórios como nas fontes",
    "mãos naturais com cinco dedos, sem deformação",
    "não trocar a pessoa nem misturar traços de outra pessoa das referências de pose ou estilo",
  ],
  alimento: [
    "não aumentar a porção nem o volume",
    "não inventar ingrediente, cobertura, guarnição ou acompanhamento",
    "manter o ponto de preparo, a cor e a montagem reais",
    "manter o mesmo recipiente e a mesma embalagem das fontes",
  ],
};

/** Proibições que valem para toda foto da mesa. */
export const PROIBICOES_GERAIS = [
  "não escurecer a foto para dar destaque; exposição correta e tons naturais",
  "sem texto sobreposto, sem moldura, sem marca d'água",
];

/** Critérios da conferência por visão, por grupo. */
export const CRITERIOS_CONFERENCIA: Record<Grupo, string[]> = {
  produto: [
    "Produto e variante iguais às fontes",
    "Rótulo e texto iguais, legíveis e sem espelhamento",
    "Proporção e formato",
    "Cor e material",
    "Quantidade de elementos (botões, portas, peças)",
    "Reflexos coerentes com o material",
    "Sombra de contato coerente com a luz",
  ],
  pessoa: [
    "Rosto e traços da mesma pessoa",
    "Idade aparente e pele naturais",
    "Cabelo, óculos e acessórios",
    "Mãos com anatomia correta",
    "Corpo e proporções reais",
    "Sombra e luz coerentes",
  ],
  alimento: [
    "Ingredientes iguais aos das fontes",
    "Porção e volume iguais",
    "Ponto de preparo e montagem",
    "Recipiente e embalagem",
    "Reflexos e brilho naturais",
    "Sombra de contato coerente",
  ],
};

export const CRITERIOS_DA_TOMADA = ["Ângulo e enquadramento pedidos", "Cenário e luz pedidos"];

function normalizarAzimute(a: number): number {
  const x = ((Math.round(a) % 360) + 360) % 360;
  return x;
}

/** Lado da câmera em palavras (relativo à frente definida no kit). */
export function azimuteEmPalavras(azimute: number): string {
  const a = normalizarAzimute(azimute);
  const perto = (alvo: number) => Math.min(Math.abs(a - alvo), 360 - Math.abs(a - alvo)) <= 22;
  if (perto(0)) return "de frente, câmera alinhada ao eixo frontal do assunto";
  if (perto(45)) return "em três quartos pela direita do assunto (câmera girada cerca de 45 graus para a direita dele)";
  if (perto(90)) return "de lado, perfil direito do assunto (câmera a cerca de 90 graus)";
  if (perto(135)) return "por trás em três quartos, lado direito do assunto (cerca de 135 graus)";
  if (perto(180)) return "por trás, mostrando o verso do assunto";
  if (perto(225)) return "por trás em três quartos, lado esquerdo do assunto (cerca de 225 graus)";
  if (perto(270)) return "de lado, perfil esquerdo do assunto (câmera a cerca de 270 graus)";
  return "em três quartos pela esquerda do assunto (câmera girada cerca de 45 graus para a esquerda dele)";
}

export function elevacaoEmPalavras(elevacao: number): string {
  if (elevacao >= 75) return "vista de cima, câmera a prumo sobre o assunto (flat lay)";
  if (elevacao >= 50) return "vista alta, câmera a cerca de 60 graus olhando para baixo";
  if (elevacao >= 38) return "câmera a cerca de 45 graus olhando para baixo";
  if (elevacao >= 15) return "câmera levemente elevada, cerca de 30 graus olhando para baixo";
  if (elevacao > -15) return "câmera na altura do assunto, olhar reto";
  return "câmera baixa, cerca de 30 graus abaixo da linha do assunto, olhando para cima (ângulo heroico)";
}

export function enquadramentoEmPalavras(enquadramento: Enquadramento, tipo: TipoKit): string {
  if (tipo === "pessoa") {
    if (enquadramento === "detalhe") return "close de rosto e ombros";
    if (enquadramento === "medio") return "plano médio, da cintura para cima";
    return "plano aberto, corpo inteiro com o ambiente visível";
  }
  if (enquadramento === "detalhe") return "plano de detalhe, o detalhe ocupa a maior parte do quadro";
  if (enquadramento === "medio") return "plano médio, assunto inteiro ocupando cerca de 60% do quadro com respiro nas bordas";
  return "plano aberto, assunto menor no quadro com o cenário visível";
}

/** Lente e profundidade de campo por tipo e enquadramento (linguagem de fotógrafo). */
export function lenteDaTomada(tipo: TipoKit, camera: Camera): string {
  const grupos = gruposDoTipo(tipo);
  if (grupos.includes("pessoa")) {
    if (camera.enquadramento === "detalhe") return "objetiva de 85 mm em f/2.8, olhos em foco crítico, fundo desfocado suave";
    if (camera.enquadramento === "medio") return "objetiva de 50 mm em f/4, pessoa inteira em foco, fundo levemente desfocado";
    return "objetiva de 35 mm em f/5.6, sem distorção nas bordas, ambiente legível";
  }
  if (grupos.includes("alimento") && !grupos.includes("produto")) {
    if (camera.elevacao >= 75) return "objetiva de 50 mm em f/8, tudo em foco, sem perspectiva inclinada";
    if (camera.enquadramento === "detalhe") return "objetiva macro de 100 mm em f/4, foco na frente do alimento com queda suave";
    return "objetiva de 100 mm em f/5.6, foco na frente do prato, fundo com desfoque suave";
  }
  if (camera.enquadramento === "detalhe") return "objetiva macro de 100 mm em f/11 com empilhamento de foco, detalhe todo nítido";
  if (camera.enquadramento === "medio") return "objetiva de 85 a 100 mm em f/8, perspectiva sem distorção, produto todo nítido";
  return "objetiva de 50 mm em f/5.6, produto nítido e fundo levemente desfocado";
}

/** Vista do kit em azimute (e elevação), para saber se a câmera pedida foi documentada. */
export const VISTAS: Record<string, { azimute: number | null; elevacao: number | null }> = {
  frente: { azimute: 0, elevacao: 0 },
  tres_quartos_direito: { azimute: 45, elevacao: 0 },
  lateral_direita: { azimute: 90, elevacao: 0 },
  posterior_direito: { azimute: 135, elevacao: 0 },
  verso: { azimute: 180, elevacao: 0 },
  posterior_esquerdo: { azimute: 225, elevacao: 0 },
  lateral_esquerda: { azimute: 270, elevacao: 0 },
  tres_quartos_esquerdo: { azimute: 315, elevacao: 0 },
  topo: { azimute: null, elevacao: 90 },
  base: { azimute: null, elevacao: -90 },
  detalhe: { azimute: null, elevacao: null },
  livre: { azimute: null, elevacao: null },
};
export const NOMES_DAS_VISTAS = Object.keys(VISTAS);

/** Formatos de saída e o tamanho pedido ao gerador (múltiplos de 16). */
export const FORMATOS = ["1:1", "4:5", "9:16", "16:9", "3:2", "2:3"] as const;
export type Formato = typeof FORMATOS[number];
export const TAMANHO_DO_FORMATO: Record<Formato, string> = {
  "1:1": "1024x1024",
  "4:5": "1088x1360",
  "9:16": "1088x1920",
  "16:9": "1920x1088",
  "3:2": "1536x1024",
  "2:3": "1024x1536",
};

/** Modos do preparo (preparar) e o modo gravado na derivada do acervo. */
export const MODOS_PREPARAR = ["fundo_branco", "fundo_transparente", "cenario", "luz_cor", "limpar"] as const;
export type ModoPreparar = typeof MODOS_PREPARAR[number];

/** Modos das tomadas e das derivadas (coluna cliente_imagens.modo). */
export const MODOS_TOMADA = ["preservar", "luz_cor", "cenario", "angulo"] as const;
export type ModoTomada = typeof MODOS_TOMADA[number];

/** O que cada modo promete, dito na tela (regra: modos distintos, sempre ditos). */
export const PROMESSA_DO_MODO: Record<ModoTomada | "ensaio", string> = {
  preservar: "Preservar: os pixels originais do assunto voltam depois da geração.",
  luz_cor: "Tratar luz e cor: a aparência muda, a identidade não; os pixels do assunto são refeitos.",
  cenario: "Novo cenário: o assunto é refeito pelo gerador a partir das fontes do kit, na mesma vista documentada.",
  angulo: "Novo ângulo: gera partes que não aparecem nas fontes. Imagem gerada, sem garantia de fidelidade.",
  ensaio: "Tomada de ensaio gerada a partir das fontes do kit.",
};

/** Promessas da v2, ditas junto com a do modo. */
export const PROMESSA_CAMPANHA =
  "Campanha: pessoa sintética gerada por IA (não é pessoa real) usando o produto refeito a partir das fontes do kit; partes do produto que não aparecem nas fontes são geradas.";
export const PROMESSA_REFERENCIA_WEB =
  "Referência da internet: foto oficial ou de loja usada só internamente para a fidelidade do produto. Não publicar nem enviar ao cliente como foto final.";
