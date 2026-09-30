/**
 * Tabelas fixas que ligam a base UI UX Pro Max às peças que o painel já tem
 * (frente UXM, 30/09/2026). Regra fixa, sem julgamento: estilo da base ->
 * preset da casa e DNA; trecho da ordem de um padrão de landing -> seção da
 * biblioteca (com o que ficou sem equivalente dito em voz alta); humor de
 * tipografia -> estilos de tipo da Identidade; tipo de produto -> nicho do
 * site; padrões permitidos por tipo de site; forma do dado -> gráfico; regra
 * de UX -> modo de conferência (código, agente, manual, não se aplica).
 *
 * Puro, sem Deno, sem banco e SEM importar a base (a tela carrega isto sem os
 * dados). Sem lookbehind, sem \p{}, sem travessão.
 */

import type { EstiloDeTipo } from "../tipografia-da-marca.ts";

// ------------------------------------------------------------------ estilo da base -> preset da casa

export type LigacaoDoEstilo = { preset: string; dna: string[] };

/**
 * Os 50 estilos ativos -> o preset da casa mais próximo (um dos 11, para a
 * prévia, o modo e o movimento) e os atributos do DNA do PRÓPRIO estilo. Ao
 * escolher o estilo da base, `dna` vira o DNA do site (camposDoEstilo com
 * `atributos`): 14 estilos caem em saas_limpo e é o DNA que os separa no motor.
 */
export const PRESET_DO_ESTILO: Record<string, LigacaoDoEstilo> = {
  "minimalism-and-swiss-style": { preset: "suico", dna: ["claro_editorial", "sans_pesada", "minimalista"] },
  neumorphism: { preset: "saas_limpo", dna: ["claro_editorial", "profundidade", "minimalista"] },
  glassmorphism: { preset: "vidro_aurora", dna: ["vidro", "profundidade"] },
  brutalism: { preset: "brutalista", dna: ["sans_pesada", "minimalista"] },
  "3d-and-hyperrealism": { preset: "produto_em_cena", dna: ["cena_3d", "profundidade", "luz_dramatica"] },
  "vibrant-and-block-based": { preset: "pop_vibrante", dna: ["sans_pesada", "bento"] },
  "dark-mode-oled": { preset: "tech_neon", dna: ["quase_preto", "luz_dramatica"] },
  "accessible-and-ethical": { preset: "saas_limpo", dna: ["claro_editorial", "minimalista"] },
  claymorphism: { preset: "pop_vibrante", dna: ["profundidade", "bento"] },
  "aurora-ui": { preset: "vidro_aurora", dna: ["luz_dramatica", "profundidade", "vidro"] },
  "retro-futurism": { preset: "tech_neon", dna: ["quase_preto", "luz_dramatica", "textura"] },
  "flat-design": { preset: "saas_limpo", dna: ["claro_editorial", "minimalista"] },
  skeuomorphism: { preset: "produto_em_cena", dna: ["profundidade", "textura"] },
  "liquid-glass": { preset: "vidro_aurora", dna: ["vidro", "profundidade"] },
  "motion-driven": { preset: "cinema_noturno", dna: ["luz_dramatica", "profundidade"] },
  "micro-interactions": { preset: "saas_limpo", dna: ["claro_editorial", "minimalista"] },
  "inclusive-design": { preset: "saas_limpo", dna: ["claro_editorial", "minimalista"] },
  "zero-interface": { preset: "suico", dna: ["minimalista", "claro_editorial"] },
  "soft-ui-evolution": { preset: "saas_limpo", dna: ["claro_editorial", "profundidade"] },
  "data-dense-dashboard": { preset: "saas_limpo", dna: ["bento", "sans_pesada"] },
  neubrutalism: { preset: "brutalista", dna: ["sans_pesada", "bento"] },
  "bento-box-grid": { preset: "saas_limpo", dna: ["bento", "claro_editorial"] },
  "y2k-aesthetic": { preset: "pop_vibrante", dna: ["profundidade", "textura"] },
  "cyberpunk-ui": { preset: "tech_neon", dna: ["quase_preto", "luz_dramatica", "vidro"] },
  "organic-biophilic": { preset: "organico", dna: ["claro_editorial", "foto_real", "textura"] },
  "ai-native-ui": { preset: "saas_limpo", dna: ["minimalista", "claro_editorial"] },
  "memphis-design": { preset: "pop_vibrante", dna: ["sans_pesada", "bento"] },
  "dimensional-layering": { preset: "vidro_aurora", dna: ["profundidade", "vidro"] },
  "exaggerated-minimalism": { preset: "suico", dna: ["sans_pesada", "minimalista"] },
  "kinetic-typography": { preset: "brutalista", dna: ["sans_pesada", "minimalista"] },
  "parallax-storytelling": { preset: "cinema_noturno", dna: ["profundidade", "luz_dramatica", "foto_real"] },
  "hud-sci-fi-fui": { preset: "tech_neon", dna: ["quase_preto", "vidro", "luz_dramatica"] },
  "pixel-art": { preset: "pop_vibrante", dna: ["bento", "textura"] },
  "spatial-ui-visionos": { preset: "vidro_aurora", dna: ["vidro", "profundidade", "cena_3d"] },
  "e-ink-paper": { preset: "editorial_claro", dna: ["claro_editorial", "minimalista", "textura"] },
  "gen-z-chaos-maximalism": { preset: "pop_vibrante", dna: ["sans_pesada", "textura", "profundidade"] },
  "biomimetic-organic-2-0": { preset: "organico", dna: ["textura", "profundidade"] },
  "anti-polish-raw-aesthetic": { preset: "brutalista", dna: ["textura", "sans_pesada"] },
  "tactile-digital-deformable-ui": { preset: "pop_vibrante", dna: ["profundidade", "bento"] },
  "nature-distilled": { preset: "organico", dna: ["claro_editorial", "foto_real", "textura"] },
  "interactive-cursor-design": { preset: "cinema_noturno", dna: ["quase_preto", "luz_dramatica"] },
  "voice-first-multimodal": { preset: "saas_limpo", dna: ["minimalista"] },
  "3d-product-preview": { preset: "produto_em_cena", dna: ["cena_3d", "profundidade"] },
  "editorial-grid-magazine": { preset: "editorial_claro", dna: ["claro_editorial", "serifada_gigante", "foto_real"] },
  "vintage-analog-retro-film": { preset: "cinema_noturno", dna: ["textura", "foto_real", "luz_dramatica"] },
  bauhaus: { preset: "pop_vibrante", dna: ["sans_pesada", "bento"] },
  "material-you-md3-mobile": { preset: "saas_limpo", dna: ["claro_editorial", "bento"] },
  "fluent-2": { preset: "saas_limpo", dna: ["claro_editorial", "minimalista"] },
  "shopify-polaris": { preset: "saas_limpo", dna: ["claro_editorial", "bento"] },
  "spectrum-design-system": { preset: "saas_limpo", dna: ["claro_editorial", "minimalista"] },
};

// ------------------------------------------------------------------ padrão de landing -> seções da biblioteca

/**
 * Trecho da ordem de um padrão ("Hero with headline/image", "Testimonials
 * carousel", "Pricing cards (3 tiers)") -> id da BIBLIOTECA_DE_SECOES. A
 * primeira regra que casa vence. "global" = topo ou rodapé (o mapa já tem);
 * SEM_EQUIVALENTE = a biblioteca não tem a peça (dito na tela).
 */
export const SEM_EQUIVALENTE = "sem_equivalente";
export const TRECHO_PARA_SECAO: Array<{ casa: RegExp; secao: string }> = [
  { casa: /footer|navbar|\bnav\b/, secao: "global" },
  { casa: /hero|intro hook|intro \(|interactive element/, secao: "hero" },
  { casa: /before|transformation/, secao: "antes_depois" },
  { casa: /\bfaq\b/, secao: "faq" },
  { casa: /pricing|price comparison|price\/specs|tiers/, secao: "pricing" },
  { casa: /testimonial|\breviews?\b|rating/, secao: "depoimentos" },
  { casa: /proof|trust|safety|credib|certs/, secao: "prova" },
  { casa: /logos|sponsors/, secao: "marquee" },
  { casa: /metrics|indicators|stats|count\b/, secao: "numeros" },
  { casa: /comparison|matrix|compare/, secao: "diferenciais" },
  { casa: /problem|pain/, secao: "problema" },
  { casa: /how it works|step \d|chapter|journey|guided|tour|what you.ll learn|progression/, secao: "processo" },
  { casa: /bento/, secao: "bento" },
  { casa: /portfolio|project grid|case stud/, secao: "portfolio" },
  { casa: /speakers|members|team/, secao: "equipe" },
  { casa: /about|bio\b|philosophy|author/, secao: "sobre" },
  { casa: /listings|configurator/, secao: "vitrine" },
  { casa: /screenshots|gallery|video|mockup|preview|teaser|visual|detail reveal|horizontal track|result/, secao: "galeria" },
  { casa: /form|email capture|contact|search bar|search focused/, secao: "contato" },
  { casa: /feature|detail cards|specs/, secao: "bento" },
  { casa: /benefit|value prop|use cases|solutions? by|solution|categories|topics|lead magnet|urgency|bonuses|archives|issues|agenda|schedule/, secao: "servicos" },
  { casa: /headline|description|input/, secao: "hero" },
  { casa: /cta|register|join|download|purchase|buy|submit|sign ?up|become a/, secao: "chamada" },
];

/** A ordem de um padrão ("A > B > C") em seções da biblioteca, sem repetir, e o que ficou sem equivalente. */
export function secoesDaOrdem(ordem: string): { secoes: string[]; sem_equivalente: string[] } {
  const secoes: string[] = [];
  const sem: string[] = [];
  const trechos = String(ordem || "").split(">").map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean);
  for (const t of trechos) {
    const baixo = t.toLowerCase();
    const achada = TRECHO_PARA_SECAO.filter((r) => r.casa.test(baixo))[0];
    if (!achada) {
      if (sem.indexOf(t) < 0) sem.push(t);
      continue;
    }
    if (achada.secao === "global") continue;
    if (secoes.indexOf(achada.secao) < 0) secoes.push(achada.secao);
  }
  return { secoes, sem_equivalente: sem };
}

/** Padrões de landing que cabem em cada tipo de site (os outros não entram na escolha). */
export const PADROES_POR_TIPO: Record<"institucional" | "landing" | "portfolio" | "loja" | "bio", string[]> = {
  institucional: [
    "hero-features-cta", "hero-testimonials-cta", "trust-authority-conversion", "feature-rich-showcase", "hero-centric-design", "faq-documentation-landing",
    "enterprise-gateway", "before-after-transformation", "bento-grid-showcase", "scroll-triggered-storytelling", "product-review-ratings-focused",
    "community-forum-landing", "comparison-table-focus", "pricing-page-cta", "event-conference-landing",
  ],
  landing: [
    "hero-features-cta", "hero-testimonials-cta", "product-demo-features", "minimal-single-column", "funnel-3-step-conversion", "comparison-table-cta",
    "lead-magnet-form", "pricing-page-cta", "video-first-hero", "scroll-triggered-storytelling", "ai-personalization-landing", "waitlist-coming-soon",
    "comparison-table-focus", "pricing-focused-landing", "app-store-style-landing", "immersive-interactive-experience", "event-conference-landing",
    "product-review-ratings-focused", "before-after-transformation", "newsletter-content-first", "webinar-registration", "bento-grid-showcase",
    "interactive-3d-configurator", "ai-driven-dynamic-landing", "feature-rich-showcase", "hero-centric-design", "trust-authority-conversion",
    "real-time-operations-landing",
  ],
  portfolio: [
    "portfolio-grid", "horizontal-scroll-journey", "scroll-triggered-storytelling", "hero-centric-design", "bento-grid-showcase",
    "immersive-interactive-experience", "before-after-transformation", "minimal-single-column", "hero-testimonials-cta",
  ],
  loja: [
    "feature-rich-showcase", "product-review-ratings-focused", "marketplace-directory", "pricing-focused-landing", "hero-centric-design",
    "interactive-3d-configurator", "app-store-style-landing", "bento-grid-showcase", "hero-testimonials-cta", "comparison-table-cta", "product-demo-features",
  ],
  bio: ["minimal-single-column", "lead-magnet-form", "newsletter-content-first", "hero-centric-design"],
};

// ------------------------------------------------------------------ humor de tipo -> estilos de tipo da Identidade

export const HUMOR_PARA_ESTILO_DE_TIPO: Array<{ casa: RegExp; estilo: EstiloDeTipo }> = [
  { casa: /classic|traditional|timeless|heritage|old-school|literary|academic|scholarly|vintage|retro/, estilo: "classica" },
  { casa: /modern|contemporary|geometric|clean/, estilo: "moderna" },
  { casa: /tech|technical|developer|code|futuristic|digital|data|precise|mono|hacker|sci-fi/, estilo: "tecnologica" },
  { casa: /elegant|luxury|sophisticated|premium|refined|high-end|fashion/, estilo: "elegante" },
  { casa: /friendly|approachable|warm|soft|rounded|gentle|casual|calm/, estilo: "amigavel" },
  { casa: /bold|impactful|strong|dramatic|loud|energetic|brutal|shouty|aggressive/, estilo: "ousada" },
  { casa: /editorial|magazine|journalism|news|publishing|print/, estilo: "editorial" },
  { casa: /minimal|neutral|swiss|austere/, estilo: "minimalista" },
  { casa: /handmade|craft|artisan|handwritten|organic|indie|natural|sketch/, estilo: "artesanal" },
  { casa: /playful|fun\b|kids|children|gaming|whimsical|cheerful/, estilo: "divertida" },
  { casa: /trust|professional|corporate|reliable|serious|authoritative|accessible|formal/, estilo: "confiavel" },
  { casa: /youth|gen z|startup|trendy|young|youthful|energetic/, estilo: "jovem" },
];

/** Estilos de tipo que um texto de humor (da base, em inglês) sugere, sem repetir. */
export function estilosDeTipoDoHumor(texto: string): EstiloDeTipo[] {
  const baixo = String(texto || "").toLowerCase();
  const saida: EstiloDeTipo[] = [];
  for (const r of HUMOR_PARA_ESTILO_DE_TIPO) if (r.casa.test(baixo) && saida.indexOf(r.estilo) < 0) saida.push(r.estilo);
  return saida;
}

// ------------------------------------------------------------------ tipo de produto -> nicho do site

/** Regras por palavra do nome do produto (em inglês, da base). A primeira que casa vence; sem nenhuma, serviço local. */
export const PRODUTO_PARA_NICHO: Array<{ casa: RegExp; nicho: string }> = [
  { casa: /luxury|premium/, nicho: "luxo" },
  { casa: /wedding|event|conference|symposium|webinar|ticketing|box office|theater|cinema|sports team/, nicho: "evento" },
  { casa: /creative agency|marketing agency|freelancer|design system/, nicho: "agencia" },
  { casa: /gaming|game\b/, nicho: "app" },
  { casa: /fintech|crypto|knowledge base|documentation|job board|biotech|space tech|quantum|spatial computing|climate|bookmark|expense/, nicho: "saas" },
  { casa: /portfolio|photography|resume|museum|gallery|architecture|interior/, nicho: "portfolio" },
  { casa: /e-commerce|shop|store|marketplace|florist|bakery|grocery|classifieds|auction|subscription box|digital products|wishlist|brewery|winery/, nicho: "ecommerce" },
  { casa: /waitlist|crowdfunding|open source|launch/, nicho: "lancamento" },
  { casa: /clinic|dental|veterinary|pharmacy|spa|beauty|restaurant|food service|cafe|gym|real estate|hotel|hospitality|legal|insurance|home services|childcare|daycare|senior|coworking|church|religious|bootcamp|hyperlocal|travel|dealership|non-profit|charity|b2b service|logistics|construction|telemedicine|patient/, nicho: "servico_local" },
  { casa: /saas|dashboard|platform|tool|crm|manager|management|builder|developer|api|analytics|software|portal|system|workflow|automation|ide\b|database|signage|kiosk|status page|config/, nicho: "saas" },
  { casa: /app|tracker|game|reminder|timer|finder|planner|maker|editor|generator|guide|calculator|client|streaming|messaging|recorder|translator|wallpaper|noise|learning|os\b/, nicho: "app" },
];

export function nichoDoProduto(nomeDaBase: string): string {
  const baixo = String(nomeDaBase || "").toLowerCase();
  const r = PRODUTO_PARA_NICHO.filter((x) => x.casa.test(baixo))[0];
  return r ? r.nicho : "servico_local";
}

// ------------------------------------------------------------------ forma do dado -> gráfico

export type FormaDoDado = "tempo" | "categorias" | "parte_do_todo";
/**
 * Os tipos que o src/lib/Grafico.tsx da casca do motor desenha (o mesmo nome
 * no servidor, no pacote.ts do modelo e no AGENTS.md). "rosca" é o de parte
 * do todo (o Grafico aceita "donut" só como nome antigo).
 */
export type TipoDoGrafico = "linha" | "barras" | "rosca";
/** Forma do dado -> número da linha em charts.csv (Trend Over Time, Compare Categories, Part-to-Whole). */
export const GRAFICO_DA_FORMA: Record<FormaDoDado, { no: string; tipo: TipoDoGrafico }> = {
  tempo: { no: "1", tipo: "linha" },
  categorias: { no: "2", tipo: "barras" },
  parte_do_todo: { no: "3", tipo: "rosca" },
};
/** Rótulo do tipo na tela. */
export const ROTULO_DO_GRAFICO: Record<TipoDoGrafico, string> = { linha: "linha", barras: "barras", rosca: "rosca" };

// ------------------------------------------------------------------ regra de UX -> modo de conferência

export type ModoDaRegra = "codigo" | "agente" | "manual" | "nao_se_aplica";

/** Conferidas por código no HTML pré-renderizado e no CSS do build (revisao-ux.ts). */
export const REGRAS_POR_CODIGO = ["9", "99", "28", "102", "36", "76", "38", "39", "42", "43", "54", "45", "47", "50", "75", "51", "57", "58", "68", "96", "108"];
/** Pedem o layout vivo: o agente do motor confere e deixa a prova em .aceleriq/ux/<seção>.json. */
export const REGRAS_DO_AGENTE = ["19", "66", "69", "100", "104", "111", "112", "113", "115", "116", "117"];
/** Não valem para o site de um cliente (padrão "não se aplica", com o motivo; a pessoa pode reabrir). */
export const REGRAS_QUE_NAO_SE_APLICAM: Record<string, string> = {
  "60": "o site do cliente não tem login nem senha",
  "107": "o site do cliente não tem login",
  "89": "o site do cliente não tem busca",
  "90": "o site do cliente não tem busca",
  "91": "ação em lote é de painel logado, não de site",
  "92": "o site não tem assistente de IA",
  "93": "o site não tem assistente de IA",
  "98": "o site não tem assistente de IA",
  "48": "o build da casa já divide o código por página",
  "49": "a hospedagem da casa já cuida do cache",
};

export function modoDaRegra(no: string): { modo: ModoDaRegra; motivo?: string } {
  const n = String(no);
  if (REGRAS_POR_CODIGO.indexOf(n) >= 0) return { modo: "codigo" };
  if (REGRAS_DO_AGENTE.indexOf(n) >= 0) return { modo: "agente" };
  if (REGRAS_QUE_NAO_SE_APLICAM[n]) return { modo: "nao_se_aplica", motivo: REGRAS_QUE_NAO_SE_APLICAM[n] };
  return { modo: "manual" };
}

/** Regras de UX ligadas a cada seção da biblioteca (entram no pacote quando a seção está no mapa). */
export const REGRAS_DA_SECAO: Record<string, string[]> = {
  topo: ["2", "3", "45", "100"],
  hero: ["9", "96", "110", "20"],
  marquee: ["108", "9"],
  depoimentos: ["108", "37"],
  galeria: ["38", "47", "46"],
  antes_depois: ["103", "38"],
  portfolio: ["38", "47"],
  vitrine: ["38", "46", "86"],
  numeros: ["86", "118"],
  pricing: ["37", "86"],
  faq: ["41"],
  contato: ["43", "54", "55", "57", "58", "61", "109", "32"],
  chamada: ["32", "29"],
  links: ["66", "104"],
  rolagem_fixa: ["99", "9"],
  processo: ["81"],
  rodape: ["105"],
};
