/**
 * Biblioteca da Mesa Site (frente SIT2, 30/09/2026): o que um diretor de web
 * premium escolhe antes de construir. Tipos de site com o mapa padrão,
 * biblioteca de seções com os nomes do mercado (e a fórmula de copy de cada
 * uma), mapa do site editável (páginas e seções), presets de estilo (DNA com
 * prévia), presets de movimento dentro do kit livre e o preset do motor
 * ("rápido e barato" contra "premium").
 *
 * Julgamento é do Jev: montar o mapa a partir do briefing é um Noul por seção
 * opcional ("este negócio precisa desta seção?") e a escolha do preset é um
 * Choice numa lista fechada. Nada de prompt-e-parse para escolher.
 *
 * Puro: sem Deno, sem npm e sem banco. A função mesa-site, o worker, a tela e
 * os testes importam o mesmo arquivo.
 */

// ------------------------------------------------------------------ tipos de site

export const TIPOS_DE_SITE = [
  { id: "institucional", rotulo: "Institucional", descricao: "site da empresa com poucas páginas: o que faz, quem é e como falar" },
  { id: "landing", rotulo: "Landing de campanha", descricao: "uma página só, focada numa oferta e num único próximo passo" },
  { id: "portfolio", rotulo: "Portfólio", descricao: "trabalhos em destaque, com cases e contato" },
  { id: "loja", rotulo: "Loja simples", descricao: "vitrine de produtos com pedido pelo WhatsApp ou link de pagamento, sem carrinho" },
  { id: "bio", rotulo: "Link na bio", descricao: "página curta de links para a bio do Instagram e do TikTok" },
] as const;
export type TipoDeSite = (typeof TIPOS_DE_SITE)[number]["id"];
export const ehTipoDeSite = (v: unknown): v is TipoDeSite => typeof v === "string" && TIPOS_DE_SITE.some((t) => t.id === v);
export const rotuloDoTipo = (id: string) => (TIPOS_DE_SITE.find((t) => t.id === id) || { rotulo: id }).rotulo;

// ------------------------------------------------------------------ biblioteca de seções

export type CategoriaDaSecao = "estrutura" | "abertura" | "narrativa" | "oferta" | "prova" | "midia" | "conversao";

export type SlotDaSecao = { slot: "hero" | "secao" | "fundo" | "detalhe"; quantos: number; so_real?: boolean };

export type SecaoDaBiblioteca = {
  id: string;
  /** Nome que o mercado usa (é o que aparece na tela). */
  rotulo: string;
  categoria: CategoriaDaSecao;
  /** Uma linha: o que a seção faz. */
  descricao: string;
  /** Fórmula de copy da seção (vai para o redator e para o Preencher com IA). */
  formula: string;
  /** Padrão de construção (vai para o agente de código e para o AGENTS.md). */
  padrao: string;
  /** Imagens que a seção pede. */
  slots: SlotDaSecao[];
  /** Integração que a seção usa (a etapa Integrações liga). */
  integra?: Array<"formulario" | "mapa" | "whatsapp">;
  /** Só com dado real do cliente (depoimento, número, antes e depois, equipe, logos). */
  so_real?: boolean;
  /** Aparece em todas as páginas (topo e rodapé). */
  global?: boolean;
  /** Títulos no máximo (palavras). */
  max_palavras_titulo: number;
  /** Itens de lista (passos, serviços, perguntas), quando a seção tem. */
  itens?: { min: number; max: number; rotulo: string };
};

/** A biblioteca, na ordem canônica de uma página (é a ordem que o mapa usa ao inserir). */
export const BIBLIOTECA_DE_SECOES: SecaoDaBiblioteca[] = [
  { id: "topo", rotulo: "Topo e navegação", categoria: "estrutura", global: true, descricao: "logo, menu das páginas e o botão do próximo passo", formula: "Rótulos do menu com 1 ou 2 palavras; o botão repete o CTA principal.", padrao: "Barra fixa que encolhe ao rolar; menu vira gaveta no celular; logo pelo arquivo de public/marca.", slots: [], max_palavras_titulo: 4 },
  { id: "hero", rotulo: "Hero cinematográfico", categoria: "abertura", descricao: "a abertura que prende: headline de resultado, imagem grande e o CTA", formula: "Headline de resultado para o público em até 8 palavras; subtítulo que explica o que é e para quem em 1 ou 2 frases; CTA com ação e benefício em até 5 palavras.", padrao: "Tela inteira com a imagem do slot hero e espaço negativo para o título; título em escala grande; um CTA primário e um secundário discreto.", slots: [{ slot: "hero", quantos: 1 }], max_palavras_titulo: 8 },
  { id: "hero_dividido", rotulo: "Hero dividido", categoria: "abertura", descricao: "texto de um lado, imagem ou foto real do outro", formula: "Headline de resultado em até 8 palavras; subtítulo em 1 frase; CTA com ação e benefício.", padrao: "Duas colunas no computador (texto e imagem 4:5), empilha no celular com o texto primeiro.", slots: [{ slot: "secao", quantos: 1 }], max_palavras_titulo: 8 },
  { id: "marquee", rotulo: "Faixa de logos (marquee)", categoria: "prova", so_real: true, descricao: "logos de clientes, parceiros ou selos rolando", formula: "Uma frase curta de apoio (ex.: marcas que confiam); só nomes e logos reais.", padrao: "Faixa contínua com pausa no hover e movimento reduzido parado; sem logo inventada.", slots: [], max_palavras_titulo: 6 },
  { id: "problema", rotulo: "Problema e agitação", categoria: "narrativa", descricao: "a dor do público nas palavras dele", formula: "Problema, agitação e virada (PAS): título com a dor em até 8 palavras, 2 ou 3 frases que agitam e uma frase que vira para a solução.", padrao: "Tipografia grande com frases em cascata; nada de ícone genérico.", slots: [], max_palavras_titulo: 8, itens: { min: 0, max: 4, rotulo: "dores" } },
  { id: "servicos", rotulo: "Serviços", categoria: "oferta", descricao: "o que o cliente vende, em blocos claros", formula: "Título de benefício; cada serviço com nome e uma frase de resultado; sem preço inventado.", padrao: "Lista ou grade de 3 a 6 itens com troca de imagem no hover (quando houver imagem).", slots: [{ slot: "secao", quantos: 1 }], max_palavras_titulo: 7, itens: { min: 3, max: 6, rotulo: "serviços" } },
  { id: "bento", rotulo: "Grade bento", categoria: "oferta", descricao: "benefícios em blocos de tamanhos diferentes", formula: "Título curto; de 4 a 6 benefícios, cada um com 2 a 5 palavras de título e uma frase.", padrao: "Grade bento sem buraco (um bloco grande, os outros menores); imagem ou detalhe dentro de 1 ou 2 blocos.", slots: [{ slot: "detalhe", quantos: 2 }], max_palavras_titulo: 7, itens: { min: 4, max: 6, rotulo: "benefícios" } },
  { id: "processo", rotulo: "Como funciona", categoria: "narrativa", descricao: "os passos do começo ao resultado", formula: "Título com a promessa do processo; de 3 a 4 passos com verbo no começo e uma frase cada.", padrao: "Passos numerados com linha de progresso na rolagem; no celular, lista vertical.", slots: [], max_palavras_titulo: 7, itens: { min: 3, max: 4, rotulo: "passos" } },
  { id: "rolagem_fixa", rotulo: "Seção fixa (sticky)", categoria: "narrativa", descricao: "título preso enquanto as imagens rolam ao lado", formula: "Título que resume a ideia; 3 blocos curtos que mudam com a rolagem.", padrao: "Título preso (position sticky) e imagens rolando; sem prender a rolagem do celular.", slots: [{ slot: "secao", quantos: 3 }], max_palavras_titulo: 7, itens: { min: 3, max: 3, rotulo: "blocos" } },
  { id: "diferenciais", rotulo: "Diferenciais", categoria: "oferta", descricao: "por que escolher o cliente", formula: "Título de comparação implícita; de 3 a 5 diferenciais concretos, cada um com uma frase; nada de superlativo vazio.", padrao: "Lista com números grandes de ordem ou ícones de traço fino.", slots: [], max_palavras_titulo: 7, itens: { min: 3, max: 5, rotulo: "diferenciais" } },
  { id: "sobre", rotulo: "Sobre", categoria: "narrativa", descricao: "a história e o propósito do cliente", formula: "Título com o propósito; 2 ou 3 frases da história real; sem data ou número que não esteja nas fontes.", padrao: "Foto real grande (do acervo) ao lado do texto; citação do fundador só se real.", slots: [{ slot: "secao", quantos: 1, so_real: true }], max_palavras_titulo: 7 },
  { id: "equipe", rotulo: "Equipe", categoria: "narrativa", so_real: true, descricao: "quem faz, com foto real", formula: "Título curto; nome, cargo e uma frase por pessoa; só pessoas reais.", padrao: "Grade de retratos reais com o mesmo corte; nunca rosto gerado.", slots: [{ slot: "detalhe", quantos: 3, so_real: true }], max_palavras_titulo: 5, itens: { min: 2, max: 8, rotulo: "pessoas" } },
  { id: "numeros", rotulo: "Números (só reais)", categoria: "prova", so_real: true, descricao: "resultados que o cliente pode provar", formula: "De 2 a 4 números com rótulo curto; só números que estão nas fontes, senão a seção sai.", padrao: "Números grandes que contam ao aparecer (parados com movimento reduzido).", slots: [], max_palavras_titulo: 6, itens: { min: 2, max: 4, rotulo: "números" } },
  { id: "prova", rotulo: "Prova social", categoria: "prova", descricao: "confiança: método, garantias, selos e resultados reais", formula: "Título de confiança; sem dado real, fala do método e da garantia; com dado real, cita a fonte.", padrao: "Bloco sóbrio com selos ou garantias; nada de estrela ou nota inventada.", slots: [], max_palavras_titulo: 7, itens: { min: 0, max: 4, rotulo: "provas" } },
  { id: "depoimentos", rotulo: "Depoimentos", categoria: "prova", so_real: true, descricao: "o que clientes reais disseram", formula: "Só depoimentos reais com nome (ou iniciais) e contexto; texto fiel, cortado sem mudar o sentido.", padrao: "Carrossel acessível (botões e teclado) ou colunas; foto só se real.", slots: [], max_palavras_titulo: 6, itens: { min: 1, max: 6, rotulo: "depoimentos" } },
  { id: "galeria", rotulo: "Galeria", categoria: "midia", descricao: "fotos do trabalho, do lugar ou do produto", formula: "Título curto e legenda de até 6 palavras por foto.", padrao: "Grade em alvenaria com zoom leve no hover e visualização em tela cheia acessível.", slots: [{ slot: "detalhe", quantos: 6 }], max_palavras_titulo: 5 },
  { id: "antes_depois", rotulo: "Galeria antes e depois", categoria: "midia", so_real: true, descricao: "comparação do antes e do depois com foto real", formula: "Título do resultado; legenda com o que foi feito; só pares de fotos reais.", padrao: "Comparador com arrastar (e teclado) entre as duas fotos reais; nunca imagem gerada.", slots: [{ slot: "detalhe", quantos: 2, so_real: true }], max_palavras_titulo: 6, itens: { min: 1, max: 4, rotulo: "pares" } },
  { id: "portfolio", rotulo: "Portfólio e cases", categoria: "midia", descricao: "trabalhos em destaque com o resultado", formula: "Por case: cliente (se autorizado), desafio em 1 frase e resultado real em 1 frase.", padrao: "Cards grandes com a segunda imagem no hover e página ou modal do case.", slots: [{ slot: "secao", quantos: 3 }], max_palavras_titulo: 6, itens: { min: 2, max: 8, rotulo: "cases" } },
  { id: "vitrine", rotulo: "Vitrine de produtos", categoria: "oferta", descricao: "produtos com foto, preço real e o botão de pedir", formula: "Nome do produto, uma frase de benefício e o preço só se estiver nas fontes; botão pedir pelo WhatsApp.", padrao: "Grade de produtos com foto real ou do acervo; botão abre o WhatsApp com o nome do produto.", slots: [{ slot: "detalhe", quantos: 6 }], integra: ["whatsapp"], max_palavras_titulo: 6, itens: { min: 2, max: 12, rotulo: "produtos" } },
  { id: "pricing", rotulo: "Planos e preços", categoria: "oferta", descricao: "planos lado a lado com o do meio em destaque", formula: "De 2 a 3 planos com nome, para quem é e o que inclui; preço só se estiver nas fontes, senão 'sob consulta'.", padrao: "Plano do meio elevado; lista de itens com marca de visto; CTA por plano.", slots: [], max_palavras_titulo: 6, itens: { min: 2, max: 3, rotulo: "planos" } },
  { id: "faq", rotulo: "Perguntas frequentes", categoria: "conversao", descricao: "responde as objeções antes do contato", formula: "De 4 a 6 perguntas que o público faz de verdade; respostas curtas que tiram a objeção.", padrao: "Acordeão acessível com <details> e <summary>.", slots: [], max_palavras_titulo: 5, itens: { min: 4, max: 6, rotulo: "perguntas" } },
  { id: "chamada", rotulo: "CTA final", categoria: "conversao", descricao: "o último empurrão para o próximo passo", formula: "Título que repete o resultado com urgência honesta; uma frase; o CTA principal.", padrao: "Faixa larga com o CTA grande (botão magnético) e o WhatsApp como segunda opção.", slots: [{ slot: "fundo", quantos: 1 }], max_palavras_titulo: 8 },
  { id: "contato", rotulo: "Contato com mapa", categoria: "conversao", descricao: "formulário que cai no CRM, WhatsApp e mapa", formula: "Título convidativo; uma frase do que acontece depois do envio; endereço e horário só se estiverem nas fontes.", padrao: "Formulário da casa (src/lib/integracoes) ao lado do mapa, que só carrega com o clique ou o consentimento.", slots: [], integra: ["formulario", "mapa", "whatsapp"], max_palavras_titulo: 6 },
  { id: "links", rotulo: "Lista de links (bio)", categoria: "conversao", descricao: "os links da bio em botões grandes", formula: "Nome e frase curta do perfil; de 3 a 8 links com rótulo de ação.", padrao: "Coluna estreita centralizada, botões de 56 px, foto real ou logo no topo.", slots: [], integra: ["whatsapp"], max_palavras_titulo: 5, itens: { min: 3, max: 8, rotulo: "links" } },
  { id: "rodape", rotulo: "Rodapé", categoria: "estrutura", global: true, descricao: "contatos, redes, páginas e o aviso de privacidade", formula: "Uma frase da marca; contatos e endereço só das fontes; link da política de privacidade.", padrao: "Colunas simples, link para a política e o botão de preferências de cookies.", slots: [], max_palavras_titulo: 4 },
];

/** Ids antigos (Mesa Site 30/09) que continuam valendo. */
export const SECOES_LEGADAS = ["topo", "hero", "problema", "servicos", "processo", "diferenciais", "prova", "faq", "chamada", "rodape"];

export const secaoDaBiblioteca = (tipo: string): SecaoDaBiblioteca | null => BIBLIOTECA_DE_SECOES.find((s) => s.id === tipo) || null;
export const ehSecaoDaBiblioteca = (v: unknown): boolean => typeof v === "string" && BIBLIOTECA_DE_SECOES.some((s) => s.id === v);
export const ORDEM_CANONICA = BIBLIOTECA_DE_SECOES.map((s) => s.id);
export const ROTULO_DA_CATEGORIA: Record<CategoriaDaSecao, string> = {
  estrutura: "Estrutura",
  abertura: "Abertura",
  narrativa: "Narrativa",
  oferta: "Oferta",
  prova: "Prova",
  midia: "Mídia",
  conversao: "Conversão",
};

// ------------------------------------------------------------------ mapa do site

/** UXM: `variante` = id de uma variante da seção (site-variantes.ts); opcional, mapas antigos continuam valendo. */
export type SecaoNoMapa = { uid: string; tipo: string; nota?: string; variante?: string };
export type PaginaDoMapa = { id: string; slug: string; titulo: string; secoes: SecaoNoMapa[] };
/**
 * Seção escondida na prévia editável (SPV, 30/09): sai da página (o site não
 * mostra), mas guarda o lugar e o uid para voltar igual. `pagina` null = uma
 * global (topo ou rodapé).
 */
export type SecaoOculta = { uid: string; tipo: string; pagina: string | null; posicao: number; nota?: string; variante?: string };
export type MapaDoSite = { tipo: TipoDeSite; paginas: PaginaDoMapa[]; globais: string[]; fonte: "padrao" | "jev" | "manual"; ocultas?: SecaoOculta[] };

export const MAX_PAGINAS = 6;
export const MAX_SECOES_POR_PAGINA = 14;
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const UID = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const VARIANTE = /^[a-z0-9][a-z0-9-]{1,59}$/;

/** Mapa padrão de cada tipo (o ponto de partida; a equipe e o Jev ajustam). */
const PADRAO_POR_TIPO: Record<TipoDeSite, { globais: string[]; paginas: Array<{ id: string; slug: string; titulo: string; secoes: string[] }> }> = {
  institucional: {
    globais: ["topo", "rodape"],
    paginas: [
      { id: "inicio", slug: "", titulo: "Início", secoes: ["hero", "servicos", "diferenciais", "processo", "prova", "faq", "chamada"] },
      { id: "sobre", slug: "sobre", titulo: "Sobre", secoes: ["sobre", "diferenciais", "chamada"] },
      { id: "contato", slug: "contato", titulo: "Contato", secoes: ["contato", "faq"] },
    ],
  },
  landing: { globais: ["topo", "rodape"], paginas: [{ id: "inicio", slug: "", titulo: "Início", secoes: ["hero", "problema", "bento", "processo", "prova", "faq", "chamada"] }] },
  portfolio: {
    globais: ["topo", "rodape"],
    paginas: [
      { id: "inicio", slug: "", titulo: "Início", secoes: ["hero", "portfolio", "servicos", "prova", "chamada"] },
      { id: "sobre", slug: "sobre", titulo: "Sobre", secoes: ["sobre", "processo"] },
      { id: "contato", slug: "contato", titulo: "Contato", secoes: ["contato"] },
    ],
  },
  loja: { globais: ["topo", "rodape"], paginas: [{ id: "inicio", slug: "", titulo: "Início", secoes: ["hero_dividido", "vitrine", "diferenciais", "faq", "contato"] }] },
  bio: { globais: ["rodape"], paginas: [{ id: "inicio", slug: "", titulo: "Início", secoes: ["links"] }] },
};

/** Seções que o Jev pode acrescentar ao mapa padrão de cada tipo (Noul por seção). */
export const OPCIONAIS_POR_TIPO: Record<TipoDeSite, string[]> = {
  institucional: ["marquee", "numeros", "depoimentos", "equipe", "galeria", "antes_depois", "pricing", "bento"],
  landing: ["marquee", "numeros", "depoimentos", "pricing", "antes_depois", "rolagem_fixa", "contato"],
  portfolio: ["marquee", "depoimentos", "numeros", "galeria", "equipe"],
  loja: ["marquee", "depoimentos", "galeria", "pricing", "bento"],
  bio: ["vitrine", "galeria"],
};

/** Id da seção no site (o nome do componente sai daqui): na página inicial é o tipo; nas outras, "<página>-<tipo>". */
export function uidDaSecao(pagina: { slug: string; id: string }, tipo: string, usados: Set<string>): string {
  const base = pagina.slug ? `${pagina.id}-${tipo}`.replace(/_/g, "-") : tipo;
  let uid = base.slice(0, 44);
  let n = 2;
  while (usados.has(uid)) uid = `${base.slice(0, 44)}-${n++}`;
  usados.add(uid);
  return uid;
}

function montarPaginas(globais: string[], paginas: Array<{ id: string; slug: string; titulo: string; secoes: string[] }>): PaginaDoMapa[] {
  const usados = new Set<string>(globais);
  return paginas.map((p) => ({ id: p.id, slug: p.slug, titulo: p.titulo, secoes: p.secoes.filter(ehSecaoDaBiblioteca).map((tipo) => ({ uid: uidDaSecao(p, tipo, usados), tipo })) }));
}

export function mapaPadrao(tipo: TipoDeSite): MapaDoSite {
  const base = PADRAO_POR_TIPO[tipo] || PADRAO_POR_TIPO.landing;
  return { tipo, globais: base.globais.slice(), paginas: montarPaginas(base.globais, base.paginas), fonte: "padrao" };
}

const umaLinha = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const slugDe = (v: unknown) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

/**
 * Lê um mapa vindo da tela ou do banco sem confiar em nada: tipo válido, até 6
 * páginas (a primeira é a inicial, slug vazio), slugs únicos, até 14 seções
 * por página, só seções da biblioteca, uids únicos e seções globais só no
 * layout. Mapa sem página vira o padrão do tipo.
 */
export function normalizarMapa(bruto: unknown, tipoPadrao: TipoDeSite = "landing"): MapaDoSite {
  const o = bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>) : {};
  const tipo: TipoDeSite = ehTipoDeSite(o.tipo) ? o.tipo : tipoPadrao;
  const globaisValidas = BIBLIOTECA_DE_SECOES.filter((s) => s.global).map((s) => s.id);
  const globais = (Array.isArray(o.globais) ? o.globais : PADRAO_POR_TIPO[tipo].globais).map((g) => String(g)).filter((g, i, l) => globaisValidas.indexOf(g) >= 0 && l.indexOf(g) === i);
  const brutas = (Array.isArray(o.paginas) ? o.paginas : []).slice(0, MAX_PAGINAS);
  if (!brutas.length) return { ...mapaPadrao(tipo), globais };
  const slugs = new Set<string>();
  const ids = new Set<string>();
  const usados = new Set<string>(globais);
  const paginas: PaginaDoMapa[] = [];
  brutas.forEach((b, i) => {
    const p = b && typeof b === "object" ? (b as Record<string, unknown>) : {};
    const titulo = umaLinha(p.titulo, 40) || (i === 0 ? "Início" : `Página ${i + 1}`);
    let slug = i === 0 ? "" : slugDe(p.slug || titulo) || `pagina-${i + 1}`;
    if (slug && (!SLUG.test(slug) || slugs.has(slug))) slug = `${slug.slice(0, 34) || "pagina"}-${i + 1}`;
    slugs.add(slug);
    let id = slugDe(p.id || slug || "inicio").replace(/-/g, "_") || `pagina_${i + 1}`;
    if (ids.has(id)) id = `${id}_${i + 1}`;
    ids.add(id);
    const pagina = { id, slug };
    const secoes: SecaoNoMapa[] = [];
    for (const s of (Array.isArray(p.secoes) ? p.secoes : []).slice(0, MAX_SECOES_POR_PAGINA * 2)) {
      const x: Record<string, unknown> = s && typeof s === "object" ? (s as Record<string, unknown>) : { tipo: s };
      const tipoDaSecao = String(x.tipo || "");
      const lib = secaoDaBiblioteca(tipoDaSecao);
      if (!lib || lib.global) continue;
      if (secoes.length >= MAX_SECOES_POR_PAGINA) break;
      const pedido = typeof x.uid === "string" ? x.uid.toLowerCase() : "";
      let uid: string;
      if (pedido && UID.test(pedido) && !usados.has(pedido)) {
        uid = pedido;
        usados.add(uid);
      } else uid = uidDaSecao(pagina, tipoDaSecao, usados);
      const nota = umaLinha(x.nota, 200);
      const nova: SecaoNoMapa = nota ? { uid, tipo: tipoDaSecao, nota } : { uid, tipo: tipoDaSecao };
      if (typeof x.variante === "string" && VARIANTE.test(x.variante)) nova.variante = x.variante;
      secoes.push(nova);
    }
    paginas.push({ id, slug, titulo, secoes });
  });
  const mapa: MapaDoSite = { tipo, globais, paginas, fonte: o.fonte === "jev" || o.fonte === "padrao" ? (o.fonte as "jev" | "padrao") : "manual" };
  const ocultas = ocultasValidas(o.ocultas, mapa, usados);
  if (ocultas.length) mapa.ocultas = ocultas;
  return mapa;
}

/** SPV: as seções escondidas que ainda valem (uid único, fora das páginas, página que existe). */
function ocultasValidas(bruto: unknown, m: MapaDoSite, usados: Set<string>): SecaoOculta[] {
  const saida: SecaoOculta[] = [];
  const globaisValidas = BIBLIOTECA_DE_SECOES.filter((s) => s.global).map((s) => s.id);
  for (const b of (Array.isArray(bruto) ? bruto : []).slice(0, 24)) {
    const x = b && typeof b === "object" ? (b as Record<string, unknown>) : {};
    const uid = typeof x.uid === "string" ? x.uid.toLowerCase() : "";
    const tipo = String(x.tipo || "");
    const lib = secaoDaBiblioteca(tipo);
    if (!lib || !UID.test(uid)) continue;
    const pagina = typeof x.pagina === "string" && x.pagina ? x.pagina : null;
    if (lib.global) {
      if (pagina || uid !== tipo || globaisValidas.indexOf(uid) < 0 || m.globais.indexOf(uid) >= 0 || saida.some((o) => o.uid === uid)) continue;
    } else {
      if (!pagina || !m.paginas.some((p) => p.id === pagina) || usados.has(uid) || saida.some((o) => o.uid === uid)) continue;
    }
    const nova: SecaoOculta = { uid, tipo, pagina, posicao: Math.max(0, Math.min(MAX_SECOES_POR_PAGINA, Math.floor(Number(x.posicao) || 0))) };
    const nota = umaLinha(x.nota, 200);
    if (nota) nova.nota = nota;
    if (typeof x.variante === "string" && VARIANTE.test(x.variante)) nova.variante = x.variante;
    saida.push(nova);
  }
  return saida;
}

/** O mapa de um site antigo (só direcao.secoes, uma página). */
export function mapaDoLegado(secoes: unknown, tipo: TipoDeSite = "landing"): MapaDoSite {
  const lista = (Array.isArray(secoes) ? secoes : []).map((s) => String(s));
  const globais = lista.filter((s) => s === "topo" || s === "rodape");
  const corpo = lista.filter((s) => s !== "topo" && s !== "rodape" && ehSecaoDaBiblioteca(s));
  if (!corpo.length) return mapaPadrao(tipo);
  return { tipo, globais: globais.length ? globais : ["topo", "rodape"], paginas: [{ id: "inicio", slug: "", titulo: "Início", secoes: corpo.map((tipoDaSecao) => ({ uid: tipoDaSecao, tipo: tipoDaSecao })) }], fonte: "manual" };
}

/** Mapa do site guardado (ou o do legado). */
export function mapaDoSite(site: { mapa?: unknown; tipo?: unknown; direcao?: Record<string, unknown> | null }): MapaDoSite {
  const tipo: TipoDeSite = ehTipoDeSite(site.tipo) ? site.tipo : "landing";
  const m = site.mapa && typeof site.mapa === "object" ? (site.mapa as Record<string, unknown>) : null;
  if (m && Array.isArray(m.paginas) && m.paginas.length) return normalizarMapa(m, tipo);
  return mapaDoLegado(site.direcao && site.direcao.secoes, tipo);
}

/** As seções do site na ordem de construção: o topo, as páginas em ordem, o rodapé (é o direcao.secoes do motor). */
export function secoesDoMapa(m: MapaDoSite): string[] {
  const corpo: string[] = [];
  m.paginas.forEach((p) => p.secoes.forEach((s) => corpo.push(s.uid)));
  return [...m.globais.filter((g) => g === "topo"), ...corpo, ...m.globais.filter((g) => g !== "topo")];
}

/** Onde está uma seção (tipo e página) pelo uid. */
export function acharNoMapa(m: MapaDoSite, uid: string): { tipo: string; pagina: PaginaDoMapa | null } | null {
  if (m.globais.indexOf(uid) >= 0) return { tipo: uid, pagina: null };
  for (const p of m.paginas) {
    const s = p.secoes.find((x) => x.uid === uid);
    if (s) return { tipo: s.tipo, pagina: p };
  }
  return null;
}

/** Tipo da seção pelo uid (legado: o uid é o tipo). */
export const tipoDoUid = (m: MapaDoSite | null, uid: string) => {
  const achado = m ? acharNoMapa(m, uid) : null;
  return achado ? achado.tipo : uid;
};

/** Troca a seção X pela Y (mesmo lugar, uid novo quando o tipo muda). */
export function trocarSecaoNoMapa(m: MapaDoSite, uid: string, novoTipo: string): MapaDoSite {
  const lib = secaoDaBiblioteca(novoTipo);
  if (!lib || lib.global) return m;
  const usados = new Set<string>(secoesDoMapa(m));
  return {
    ...m,
    fonte: "manual",
    paginas: m.paginas.map((p) => ({
      ...p,
      secoes: p.secoes.map((s) => {
        if (s.uid !== uid) return s;
        usados.delete(uid);
        return { uid: uidDaSecao(p, novoTipo, usados), tipo: novoTipo };
      }),
    })),
  };
}

/** Acrescenta uma seção na página, na posição canônica (antes da primeira que vem depois na biblioteca). */
export function adicionarSecaoNoMapa(m: MapaDoSite, paginaId: string, tipo: string): MapaDoSite {
  const lib = secaoDaBiblioteca(tipo);
  if (!lib || lib.global) return m;
  const usados = new Set<string>(secoesDoMapa(m));
  return {
    ...m,
    fonte: "manual",
    paginas: m.paginas.map((p) => {
      if (p.id !== paginaId || p.secoes.length >= MAX_SECOES_POR_PAGINA) return p;
      const nova = { uid: uidDaSecao(p, tipo, usados), tipo };
      const ordem = ORDEM_CANONICA.indexOf(tipo);
      const i = p.secoes.findIndex((s) => ORDEM_CANONICA.indexOf(s.tipo) > ordem);
      const secoes = p.secoes.slice();
      if (i < 0) secoes.push(nova);
      else secoes.splice(i, 0, nova);
      return { ...p, secoes };
    }),
  };
}

export function removerSecaoDoMapa(m: MapaDoSite, uid: string): MapaDoSite {
  return { ...m, fonte: "manual", paginas: m.paginas.map((p) => ({ ...p, secoes: p.secoes.filter((s) => s.uid !== uid) })) };
}

// ------------------------------------------------------------------ Jev: montar o mapa

type PerguntaJev =
  | { type: "choice"; instructions: unknown; criteria: Record<string, unknown> }
  | { type: "noul"; instructions: unknown; criteria?: { true: unknown; false: unknown } };
type RespostaJev = { choice?: string; noul?: number };

/** Probabilidade mínima para o Jev pôr uma seção opcional no mapa. */
export const LIMIAR_DA_SECAO = 0.6;

/**
 * Perguntas do Jev para montar o mapa: um Choice do tipo (quando a equipe não
 * escolheu) e um Noul por seção opcional do tipo. Seção que só vale com dado
 * real (depoimento, número, antes e depois) só entra se as fontes têm o dado.
 */
export function perguntasDoMapa(tipo: TipoDeSite | null): Record<string, PerguntaJev> {
  const q: Record<string, PerguntaJev> = {};
  if (!tipo) {
    q.tipo = {
      type: "choice",
      instructions: "Which kind of website best fits this business and its briefing (state.marca, state.briefing, state.pedido)?",
      criteria: Object.fromEntries(TIPOS_DE_SITE.map((t) => [t.id, t.descricao])),
    };
  }
  const opcionais = tipo ? OPCIONAIS_POR_TIPO[tipo] : Array.from(new Set(Object.keys(OPCIONAIS_POR_TIPO).reduce((a: string[], k) => a.concat(OPCIONAIS_POR_TIPO[k as TipoDeSite]), [])));
  for (const id of opcionais) {
    const s = secaoDaBiblioteca(id);
    if (!s) continue;
    q[`secao_${id}`] = {
      type: "noul",
      instructions: s.so_real
        ? `This website should include a section "${s.rotulo}" (${s.descricao}). True ONLY if state.briefing or state.marca actually contains the real data needed (real testimonials, real numbers, real before and after photos, real team or client logos). Never assume it exists.`
        : `This business would clearly benefit from a website section "${s.rotulo}" (${s.descricao}), judging from state.marca, state.briefing and state.pedido.`,
      criteria: { true: "include the section", false: "leave it out" },
    };
  }
  return q;
}

/** Lê o Jev: o tipo (ou o dado) e as seções opcionais acima do limiar, na posição canônica da página inicial. */
export function mapaDoJev(answers: Record<string, RespostaJev>, tipoDado: TipoDeSite | null): { mapa: MapaDoSite; incluidas: Array<{ id: string; prob: number }> } {
  const escolhido = answers.tipo && typeof answers.tipo.choice === "string" && ehTipoDeSite(answers.tipo.choice) ? answers.tipo.choice : null;
  const tipo: TipoDeSite = tipoDado || escolhido || "landing";
  let mapa = mapaPadrao(tipo);
  const incluidas: Array<{ id: string; prob: number }> = [];
  const inicio = mapa.paginas[0];
  for (const id of OPCIONAIS_POR_TIPO[tipo]) {
    const r = answers[`secao_${id}`];
    const p = r && typeof r.noul === "number" && Number.isFinite(r.noul) ? r.noul : null;
    if (p === null || p < LIMIAR_DA_SECAO) continue;
    if (inicio.secoes.some((s) => s.tipo === id)) continue;
    mapa = adicionarSecaoNoMapa(mapa, inicio.id, id);
    incluidas.push({ id, prob: p });
  }
  return { mapa: { ...mapa, fonte: "jev" }, incluidas };
}

// ------------------------------------------------------------------ presets de estilo (DNA)

export type PresetDeEstilo = {
  id: string;
  rotulo: string;
  descricao: string;
  atributos: string[];
  movimento: "sutil" | "rolagem_fixa" | "tipo_cinetico" | "ken_burns";
  nivel: "awwwards" | "apple" | "editorial" | "saas";
  modo: "claro" | "escuro";
  /** Prévia na tela (a cor de destaque é a da marca; estas são as do preset). */
  previa: { fundo: string; texto: string; apoio: string; titulo: "serifada" | "sans" | "mono"; peso: number; raio: number };
};

export const PRESETS_DE_ESTILO: PresetDeEstilo[] = [
  { id: "cinema_noturno", rotulo: "Cinema noturno", descricao: "quase preto, luz de cinema, serifada gigante e grão de filme", atributos: ["quase_preto", "luz_dramatica", "serifada_gigante", "textura"], movimento: "rolagem_fixa", nivel: "awwwards", modo: "escuro", previa: { fundo: "#0A0A0B", texto: "#F4F2EE", apoio: "#1B1B1E", titulo: "serifada", peso: 400, raio: 0 } },
  { id: "editorial_claro", rotulo: "Editorial claro", descricao: "revista impressa na tela: muito respiro, serifada e foto real grande", atributos: ["claro_editorial", "serifada_gigante", "minimalista", "foto_real"], movimento: "ken_burns", nivel: "editorial", modo: "claro", previa: { fundo: "#FAF8F4", texto: "#141414", apoio: "#ECE8E0", titulo: "serifada", peso: 400, raio: 2 } },
  { id: "suico", rotulo: "Suíço tipográfico", descricao: "grade rígida, sans pesada e quase nada de cor", atributos: ["claro_editorial", "sans_pesada", "minimalista"], movimento: "sutil", nivel: "editorial", modo: "claro", previa: { fundo: "#F2F2F0", texto: "#0E0E0E", apoio: "#DADAD6", titulo: "sans", peso: 800, raio: 0 } },
  { id: "luxo_silencioso", rotulo: "Luxo silencioso", descricao: "escuro quente, serifada fina, foto real e zoom lento", atributos: ["quase_preto", "serifada_gigante", "minimalista", "foto_real"], movimento: "ken_burns", nivel: "apple", modo: "escuro", previa: { fundo: "#11100E", texto: "#EDE6DA", apoio: "#221F1B", titulo: "serifada", peso: 300, raio: 0 } },
  { id: "saas_limpo", rotulo: "SaaS limpo", descricao: "claro e rápido, grade bento e sans firme (Linear, Stripe)", atributos: ["claro_editorial", "bento", "sans_pesada"], movimento: "sutil", nivel: "saas", modo: "claro", previa: { fundo: "#FFFFFF", texto: "#0B0D12", apoio: "#F1F3F7", titulo: "sans", peso: 650, raio: 12 } },
  { id: "tech_neon", rotulo: "Tech neon", descricao: "escuro com vidro fosco, bento e títulos que se montam", atributos: ["quase_preto", "vidro", "bento", "luz_dramatica"], movimento: "tipo_cinetico", nivel: "saas", modo: "escuro", previa: { fundo: "#07080C", texto: "#E8EEF8", apoio: "#141824", titulo: "sans", peso: 700, raio: 14 } },
  { id: "organico", rotulo: "Orgânico acolhedor", descricao: "tons naturais, textura de papel e fotos reais", atributos: ["claro_editorial", "foto_real", "textura"], movimento: "ken_burns", nivel: "editorial", modo: "claro", previa: { fundo: "#F4EFE6", texto: "#2A241C", apoio: "#E4DACA", titulo: "serifada", peso: 500, raio: 18 } },
  { id: "brutalista", rotulo: "Brutalista", descricao: "blocos crus, sans pesada gigante e contraste máximo", atributos: ["sans_pesada", "minimalista", "bento"], movimento: "tipo_cinetico", nivel: "awwwards", modo: "claro", previa: { fundo: "#EDEDED", texto: "#000000", apoio: "#FFFFFF", titulo: "mono", peso: 800, raio: 0 } },
  { id: "pop_vibrante", rotulo: "Pop vibrante", descricao: "cor forte da marca, camadas e tipografia que salta", atributos: ["sans_pesada", "bento", "profundidade"], movimento: "tipo_cinetico", nivel: "awwwards", modo: "claro", previa: { fundo: "#FFF7EC", texto: "#1A1033", apoio: "#FFE3C2", titulo: "sans", peso: 800, raio: 24 } },
  { id: "vidro_aurora", rotulo: "Vidro e aurora", descricao: "camadas de vidro sobre luz difusa, cena presa na rolagem", atributos: ["vidro", "profundidade", "luz_dramatica"], movimento: "rolagem_fixa", nivel: "apple", modo: "escuro", previa: { fundo: "#0C0F1A", texto: "#EEF1FF", apoio: "#1A2036", titulo: "sans", peso: 600, raio: 20 } },
  { id: "produto_em_cena", rotulo: "Produto em cena", descricao: "o produto como herói em 3D, luz de estúdio e rolagem presa", atributos: ["cena_3d", "quase_preto", "luz_dramatica", "profundidade"], movimento: "rolagem_fixa", nivel: "apple", modo: "escuro", previa: { fundo: "#050505", texto: "#F5F5F7", apoio: "#161618", titulo: "sans", peso: 600, raio: 16 } },
];

export const presetDeEstilo = (id: unknown): PresetDeEstilo | null => PRESETS_DE_ESTILO.find((p) => p.id === id) || null;

/** Choice do Jev para o preset: a marca, o nicho e o que a leitura das referências viu. */
export function perguntaDoPreset(): Record<string, PerguntaJev> {
  return {
    preset: {
      type: "choice",
      instructions: "Which visual style preset best fits this brand (state.marca), its niche (state.nicho) and what the reference websites show (state.observacoes)? The brand palette is kept either way.",
      criteria: Object.fromEntries(PRESETS_DE_ESTILO.map((p) => [p.id, p.descricao])),
    },
  };
}

// ------------------------------------------------------------------ presets de movimento (kit livre)

/** O kit livre de movimento (plano/p4-motores.md §5): só estas bibliotecas entram no site. */
export const KIT_LIVRE = ["motion", "gsap", "scrolltrigger", "splittext", "lenis", "css"] as const;
export type PecaDoKit = (typeof KIT_LIVRE)[number];

export type PresetDeMotion = {
  id: string;
  rotulo: string;
  descricao: string;
  /** Movimento de base do DNA (o que o Jev e a fórmula de 6 blocos entendem). */
  base: "sutil" | "rolagem_fixa" | "tipo_cinetico" | "ken_burns";
  pecas: PecaDoKit[];
  intensidade: "baixa" | "media" | "alta";
  /** Instrução curta para o agente de código. */
  instrucao: string;
};

export const PRESETS_DE_MOTION: PresetDeMotion[] = [
  { id: "sutil", rotulo: "Sutil", descricao: "entrada suave de cada seção e micro-interações", base: "sutil", pecas: ["motion", "css"], intensidade: "baixa", instrucao: "Revelar (src/lib/Revelar.tsx) na entrada de cada bloco; hover de 150 a 250 ms; nada preso na rolagem." },
  { id: "cascata", rotulo: "Revelação em cascata", descricao: "itens de lista e grade aparecem um depois do outro", base: "sutil", pecas: ["motion"], intensidade: "media", instrucao: "Revelar com atraso em cascata (ATRASO_EM_CASCATA) nos itens de grade e lista; títulos primeiro." },
  { id: "magnetico", rotulo: "Botões magnéticos", descricao: "CTA que acompanha o cursor e cartões com inclinação leve", base: "sutil", pecas: ["motion"], intensidade: "media", instrucao: "Botão magnético com MOLA.firme só em ponteiro fino (hover: hover); sem efeito no toque." },
  { id: "rolagem_fixa", rotulo: "Cena presa na rolagem", descricao: "blocos que ficam presos e trocam com a rolagem (imersivo)", base: "rolagem_fixa", pecas: ["gsap", "scrolltrigger", "lenis"], intensidade: "alta", instrucao: "ScrollTrigger com pin só de 1024 px para cima; no celular vira sequência simples; scrub entre 0 e 1." },
  { id: "parallax", rotulo: "Parallax em camadas", descricao: "fundo e primeiro plano em velocidades diferentes", base: "rolagem_fixa", pecas: ["gsap", "scrolltrigger", "lenis"], intensidade: "media", instrucao: "Parallax com ScrollTrigger scrub em transform (nunca top/left), deslocamento de até 12%." },
  { id: "tipo_cinetico", rotulo: "Tipografia cinética", descricao: "títulos que se montam por palavra ou letra", base: "tipo_cinetico", pecas: ["gsap", "splittext"], intensidade: "alta", instrucao: "SplitText por palavra no h1 e nos títulos de seção, uma vez ao aparecer; texto real no HTML (SEO)." },
  { id: "ken_burns", rotulo: "Ken Burns lento", descricao: "zoom e deslize lentos nas imagens grandes", base: "ken_burns", pecas: ["motion", "css"], intensidade: "baixa", instrucao: "Escala de 1 a 1,06 em 12 a 18 s nas imagens de hero e fundo; parado com movimento reduzido." },
  { id: "marquee", rotulo: "Marquee contínuo", descricao: "faixas que correm sem parar (logos, frases)", base: "sutil", pecas: ["css"], intensidade: "baixa", instrucao: "Animação CSS em translateX com conteúdo duplicado; pausa no hover e no foco; parada com movimento reduzido." },
];

export const presetDeMotion = (id: unknown): PresetDeMotion | null => PRESETS_DE_MOTION.find((p) => p.id === id) || null;
/** Todo preset de movimento fica dentro do kit livre (testado). */
export const dentroDoKit = (p: PresetDeMotion) => p.pecas.every((x) => (KIT_LIVRE as readonly string[]).indexOf(x) >= 0);

/**
 * Ajuste da marca feito na prévia editável (frente SPV, 30/09): cor de
 * destaque, fundo e texto e as fontes de título e de texto SÓ deste site. O
 * kit da marca não muda (outras mesas seguem com ele); vazio = o do kit.
 */
export type AjustesDaMarcaNoSite = { destaque?: string; fundo?: string; texto?: string; fonte_titulo?: string; fonte_texto?: string };
export const PAPEIS_DE_COR_DO_AJUSTE = ["destaque", "fundo", "texto"] as const;
export const PAPEIS_DE_FONTE_DO_AJUSTE = ["fonte_titulo", "fonte_texto"] as const;
const HEX_DO_AJUSTE = /^#[0-9a-f]{6}$/i;
const FONTE_DO_AJUSTE = /^[A-Za-z0-9][A-Za-z0-9 ]{1,39}$/;

/** Só cores #rrggbb e nomes de família simples (letras, números e espaço). */
export function normalizarAjustes(bruto: unknown): AjustesDaMarcaNoSite | null {
  const o = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? (bruto as Record<string, unknown>) : {};
  const a: AjustesDaMarcaNoSite = {};
  for (const k of PAPEIS_DE_COR_DO_AJUSTE) {
    const v = typeof o[k] === "string" ? String(o[k]).trim() : "";
    if (HEX_DO_AJUSTE.test(v)) a[k] = v.toLowerCase();
  }
  for (const k of PAPEIS_DE_FONTE_DO_AJUSTE) {
    const v = typeof o[k] === "string" ? String(o[k]).replace(/\s+/g, " ").trim() : "";
    if (FONTE_DO_AJUSTE.test(v)) a[k] = v;
  }
  return Object.keys(a).length ? a : null;
}

/** As fontes do site com a troca feita na prévia (título e texto); as outras ficam. */
export function fontesComAjustes(fontes: Array<{ nome: string; papel: string }>, ajustes: AjustesDaMarcaNoSite | null | undefined): Array<{ nome: string; papel: string }> {
  if (!ajustes || (!ajustes.fonte_titulo && !ajustes.fonte_texto)) return fontes;
  const ehTitulo = (p: string) => /tit|display|head/i.test(p);
  const ehTexto = (p: string) => /texto|corpo|body/i.test(p);
  let lista = fontes.slice();
  if (ajustes.fonte_titulo) lista = [{ nome: ajustes.fonte_titulo, papel: "titulo" }].concat(lista.filter((f) => !ehTitulo(String(f.papel || ""))));
  if (ajustes.fonte_texto) lista = lista.filter((f) => !ehTexto(String(f.papel || ""))).concat([{ nome: ajustes.fonte_texto, papel: "texto" }]);
  return lista.slice(0, 4);
}

export type EstiloDoSite = { preset: string | null; motion: string[]; ajustes?: AjustesDaMarcaNoSite };

/** Estilo salvo: preset válido (ou nenhum), até 3 presets de movimento válidos e os ajustes da prévia (SPV). */
export function normalizarEstilo(bruto: unknown): EstiloDoSite {
  const o = bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>) : {};
  const preset = presetDeEstilo(o.preset) ? String(o.preset) : null;
  const motion = (Array.isArray(o.motion) ? o.motion : [])
    .map((m) => String(m))
    .filter((m, i, l) => !!presetDeMotion(m) && l.indexOf(m) === i)
    .slice(0, 3);
  const ajustes = normalizarAjustes(o.ajustes);
  return ajustes ? { preset, motion, ajustes } : { preset, motion };
}

// ------------------------------------------------------------------ preset do motor (custo)

export type ModeloParaPreset = {
  id: string;
  provedor: string;
  modelo_api: string;
  tipo?: string;
  ativo?: boolean;
  rotulo?: string | null;
  preco_entrada_1m: number | null;
  preco_saida_1m: number | null;
  preco_cache_1m?: number | null;
  contexto_tokens?: number | null;
  padrao_para?: string[] | null;
};

/** Custo previsto de UMA seção (mesma conta do motor: 260 mil de entrada com 80% de cache e 14 mil de saída). */
export function custoPorSecao(m: ModeloParaPreset): number {
  const pe = Number(m.preco_entrada_1m) || 0;
  const ps = Number(m.preco_saida_1m) || 0;
  const pc = m.preco_cache_1m == null ? pe : Number(m.preco_cache_1m) || 0;
  const entrada = 260_000;
  const cache = entrada * 0.8;
  return Math.round((((entrada - cache) * pe + cache * pc + 14_000 * ps) / 1_000_000) * 1e4) / 1e4;
}

/** Teto de uma seção para o premium não virar um modelo absurdo. */
export const TETO_DO_PREMIUM_POR_SECAO = 3;

const serveParaCodigo = (m: ModeloParaPreset) =>
  (m.tipo === undefined || m.tipo === "texto") && m.ativo !== false && (Number(m.preco_entrada_1m) || 0) > 0 && (Number(m.preco_saida_1m) || 0) > 0 && (m.contexto_tokens == null || Number(m.contexto_tokens) >= 64_000);

/**
 * "Rápido e barato" contra "premium", escolhidos do catálogo na hora:
 * rápido = o de menor custo por seção que serve para código; premium = o
 * padrão do papel site quando é mais caro que o rápido, senão o mais caro
 * abaixo do teto por seção.
 */
export function presetsDoMotor(catalogo: ModeloParaPreset[]): { rapido: ModeloParaPreset | null; premium: ModeloParaPreset | null } {
  const aptos = catalogo.filter(serveParaCodigo).slice().sort((a, b) => custoPorSecao(a) - custoPorSecao(b));
  if (!aptos.length) return { rapido: null, premium: null };
  const rapido = aptos[0];
  const padrao = aptos.find((m) => (m.padrao_para || []).indexOf("site") >= 0);
  const abaixoDoTeto = aptos.filter((m) => custoPorSecao(m) <= TETO_DO_PREMIUM_POR_SECAO);
  let premium: ModeloParaPreset | null = padrao && custoPorSecao(padrao) > custoPorSecao(rapido) ? padrao : abaixoDoTeto.length ? abaixoDoTeto[abaixoDoTeto.length - 1] : null;
  if (premium && premium.id === rapido.id) premium = null;
  return { rapido, premium };
}

// ------------------------------------------------------------------ slots de imagem por seção

export type SlotDoSite = { uid: string; tipo: string; rotulo: string; pagina: string; slot: SlotDaSecao["slot"]; precisa: number; tem: number; so_real: boolean };

/**
 * As imagens que o mapa pede, seção por seção, e quantas já tem. Imagem com
 * `secao` conta para a seção dela; imagem antiga (sem seção) conta para a
 * primeira seção que pede o mesmo slot.
 */
export function slotsDoMapa(m: MapaDoSite, imagens: Array<{ slot: string; secao?: string | null; escolhida?: boolean; origem?: string }>): SlotDoSite[] {
  const vivas = imagens.filter((i) => i.escolhida !== false);
  const soltas = vivas.filter((i) => !i.secao).map((i) => ({ ...i, usada: false }));
  const saida: SlotDoSite[] = [];
  m.paginas.forEach((p) => {
    p.secoes.forEach((s) => {
      const lib = secaoDaBiblioteca(s.tipo);
      if (!lib) return;
      lib.slots.forEach((sl) => {
        let tem = vivas.filter((i) => i.secao === s.uid && i.slot === sl.slot).length;
        for (const solta of soltas) {
          if (tem >= sl.quantos) break;
          if (!solta.usada && solta.slot === sl.slot && (!sl.so_real || solta.origem === "real")) {
            solta.usada = true;
            tem++;
          }
        }
        saida.push({ uid: s.uid, tipo: s.tipo, rotulo: lib.rotulo, pagina: p.titulo, slot: sl.slot, precisa: sl.quantos, tem: Math.min(tem, sl.quantos), so_real: !!(sl.so_real || lib.so_real) });
      });
    });
  });
  return saida;
}

/** Quantos slots ainda vazios (os de foto real contam: o gerador não preenche esses). */
export const slotsVazios = (slots: SlotDoSite[]) => slots.reduce((n, s) => n + Math.max(0, s.precisa - s.tem), 0);
/** Quantas imagens o gerador pode fazer (sem os slots de foto real). */
export const slotsQueOGeradorFaz = (slots: SlotDoSite[]) => slots.filter((s) => !s.so_real).reduce((n, s) => n + Math.max(0, s.precisa - s.tem), 0);

const semAcento = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** O tipo de seção pedido em texto (id, nome do mercado ou parte dele), ou null. */
export function tipoPedido(bruto: unknown): string | null {
  const t = semAcento(String(bruto ?? "").trim()).replace(/\s+/g, " ");
  if (!t) return null;
  const porId = BIBLIOTECA_DE_SECOES.find((s) => s.id === t.replace(/[\s-]+/g, "_"));
  if (porId) return porId.id;
  const porRotulo = BIBLIOTECA_DE_SECOES.find((s) => semAcento(s.rotulo) === t);
  if (porRotulo) return porRotulo.id;
  const contem = BIBLIOTECA_DE_SECOES.filter((s) => semAcento(s.rotulo).indexOf(t) >= 0 || t.indexOf(semAcento(s.rotulo)) >= 0);
  return contem.length === 1 ? contem[0].id : null;
}
