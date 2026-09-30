/**
 * Tipografia da marca (frente IDV2, 30/09/2026): combinações do Google Fonts
 * (título + texto) escolhidas por quem entende de tipo, com a prévia real
 * carregada sob demanda na tela (só quando a seção abre).
 *
 * A lista é curada (não é a API do Google Fonts: sem chave e sem chamada).
 * Todas as famílias são livres (licença OFL ou Apache) para uso comercial.
 * A sugestão por personalidade é regra fixa (etiquetas); a sugestão com IA
 * (diretor de marca) usa o mesmo catálogo para conferir o nome da família.
 *
 * Puro: sem Deno, sem banco. Sem lookbehind, sem \p{} (Safari 11).
 */

import type { ArquetipoId, EixoId } from "./estrategia-de-marca.ts";

export type CategoriaDaFonte = "serifada" | "sem_serifa" | "display" | "mono" | "manuscrita";

export type FonteDoCatalogo = { familia: string; categoria: CategoriaDaFonte; pesos: number[]; licenca: "OFL" | "Apache" };

export const FONTES_DO_CATALOGO: FonteDoCatalogo[] = [
  { familia: "Inter", categoria: "sem_serifa", pesos: [400, 500, 600, 700, 800], licenca: "OFL" },
  { familia: "Manrope", categoria: "sem_serifa", pesos: [400, 500, 600, 700, 800], licenca: "OFL" },
  { familia: "DM Sans", categoria: "sem_serifa", pesos: [400, 500, 700], licenca: "OFL" },
  { familia: "Work Sans", categoria: "sem_serifa", pesos: [400, 500, 600, 700], licenca: "OFL" },
  { familia: "Outfit", categoria: "sem_serifa", pesos: [400, 500, 600, 700, 800], licenca: "OFL" },
  { familia: "Plus Jakarta Sans", categoria: "sem_serifa", pesos: [400, 500, 600, 700, 800], licenca: "OFL" },
  { familia: "Poppins", categoria: "sem_serifa", pesos: [400, 500, 600, 700, 800], licenca: "OFL" },
  { familia: "Montserrat", categoria: "sem_serifa", pesos: [400, 500, 600, 700, 800], licenca: "OFL" },
  { familia: "Nunito", categoria: "sem_serifa", pesos: [400, 600, 700, 800], licenca: "OFL" },
  { familia: "Source Sans 3", categoria: "sem_serifa", pesos: [400, 600, 700], licenca: "OFL" },
  { familia: "IBM Plex Sans", categoria: "sem_serifa", pesos: [400, 500, 600, 700], licenca: "OFL" },
  { familia: "Space Grotesk", categoria: "sem_serifa", pesos: [400, 500, 600, 700], licenca: "OFL" },
  { familia: "Sora", categoria: "sem_serifa", pesos: [400, 500, 600, 700, 800], licenca: "OFL" },
  { familia: "Archivo", categoria: "sem_serifa", pesos: [400, 500, 600, 700, 800], licenca: "OFL" },
  { familia: "Rubik", categoria: "sem_serifa", pesos: [400, 500, 600, 700, 800], licenca: "OFL" },
  { familia: "Karla", categoria: "sem_serifa", pesos: [400, 500, 700], licenca: "OFL" },
  { familia: "Lato", categoria: "sem_serifa", pesos: [400, 700, 900], licenca: "OFL" },
  { familia: "Open Sans", categoria: "sem_serifa", pesos: [400, 600, 700], licenca: "OFL" },
  { familia: "Playfair Display", categoria: "serifada", pesos: [400, 600, 700, 800], licenca: "OFL" },
  { familia: "Cormorant Garamond", categoria: "serifada", pesos: [400, 500, 600, 700], licenca: "OFL" },
  { familia: "DM Serif Display", categoria: "serifada", pesos: [400], licenca: "OFL" },
  { familia: "Fraunces", categoria: "serifada", pesos: [400, 600, 700, 800], licenca: "OFL" },
  { familia: "Libre Baskerville", categoria: "serifada", pesos: [400, 700], licenca: "OFL" },
  { familia: "Lora", categoria: "serifada", pesos: [400, 500, 600, 700], licenca: "OFL" },
  { familia: "Merriweather", categoria: "serifada", pesos: [400, 700, 900], licenca: "OFL" },
  { familia: "Source Serif 4", categoria: "serifada", pesos: [400, 600, 700], licenca: "OFL" },
  { familia: "Crimson Pro", categoria: "serifada", pesos: [400, 500, 600, 700], licenca: "OFL" },
  { familia: "EB Garamond", categoria: "serifada", pesos: [400, 500, 600, 700], licenca: "OFL" },
  { familia: "Bricolage Grotesque", categoria: "display", pesos: [400, 600, 700, 800], licenca: "OFL" },
  { familia: "Syne", categoria: "display", pesos: [400, 600, 700, 800], licenca: "OFL" },
  { familia: "Bebas Neue", categoria: "display", pesos: [400], licenca: "OFL" },
  { familia: "Oswald", categoria: "display", pesos: [400, 500, 600, 700], licenca: "OFL" },
  { familia: "Anton", categoria: "display", pesos: [400], licenca: "OFL" },
  { familia: "Righteous", categoria: "display", pesos: [400], licenca: "OFL" },
  { familia: "Baloo 2", categoria: "display", pesos: [400, 600, 700, 800], licenca: "OFL" },
  { familia: "Fredoka", categoria: "display", pesos: [400, 500, 600, 700], licenca: "OFL" },
  { familia: "Space Mono", categoria: "mono", pesos: [400, 700], licenca: "OFL" },
  { familia: "JetBrains Mono", categoria: "mono", pesos: [400, 500, 700], licenca: "OFL" },
  { familia: "Caveat", categoria: "manuscrita", pesos: [400, 600, 700], licenca: "OFL" },
  { familia: "Dancing Script", categoria: "manuscrita", pesos: [400, 600, 700], licenca: "OFL" },
];

export const ROTULO_DA_CATEGORIA: Record<CategoriaDaFonte, string> = {
  serifada: "Serifada",
  sem_serifa: "Sem serifa",
  display: "Display",
  mono: "Monoespaçada",
  manuscrita: "Manuscrita",
};

/** Etiquetas de estilo (o vocabulário que liga a tipografia à personalidade da marca). */
export const ESTILOS_DE_TIPO = ["classica", "moderna", "tecnologica", "elegante", "amigavel", "ousada", "editorial", "minimalista", "artesanal", "divertida", "confiavel", "jovem"] as const;
export type EstiloDeTipo = (typeof ESTILOS_DE_TIPO)[number];

export type ParDeFontes = { id: string; nome: string; titulo: string; texto: string; pesoTitulo: number; estilos: EstiloDeTipo[]; porque: string };

export const PARES_DE_FONTES: ParDeFontes[] = [
  { id: "p01", nome: "Editorial clássico", titulo: "Playfair Display", texto: "Source Sans 3", pesoTitulo: 700, estilos: ["editorial", "elegante", "classica"], porque: "Contraste alto no título com texto limpo: revista e marca de tradição." },
  { id: "p02", nome: "Luxo discreto", titulo: "Cormorant Garamond", texto: "Manrope", pesoTitulo: 600, estilos: ["elegante", "classica", "minimalista"], porque: "Serifa fina e sem serifa geométrica: sofisticação sem peso." },
  { id: "p03", nome: "Moderno versátil", titulo: "Inter", texto: "Inter", pesoTitulo: 800, estilos: ["moderna", "minimalista", "confiavel", "tecnologica"], porque: "Uma família só em pesos diferentes: consistente em qualquer tela." },
  { id: "p04", nome: "Tecnologia", titulo: "Space Grotesk", texto: "IBM Plex Sans", pesoTitulo: 700, estilos: ["tecnologica", "moderna", "ousada"], porque: "Grotesca com personalidade e texto técnico legível." },
  { id: "p05", nome: "Amigável", titulo: "Nunito", texto: "Nunito", pesoTitulo: 800, estilos: ["amigavel", "jovem", "divertida"], porque: "Terminais arredondados passam calor e proximidade." },
  { id: "p06", nome: "Jovem e geométrico", titulo: "Poppins", texto: "DM Sans", pesoTitulo: 700, estilos: ["jovem", "moderna", "amigavel"], porque: "Geometria redonda no título e texto neutro para ler bem." },
  { id: "p07", nome: "Ousado de impacto", titulo: "Bebas Neue", texto: "Montserrat", pesoTitulo: 400, estilos: ["ousada", "jovem", "moderna"], porque: "Condensada em caixa alta chama atenção em pôster e rede social." },
  { id: "p08", nome: "Artesanal contemporâneo", titulo: "Fraunces", texto: "Work Sans", pesoTitulo: 700, estilos: ["artesanal", "editorial", "amigavel"], porque: "Serifa macia e de caráter, com texto honesto: feito à mão, sem ser rústico." },
  { id: "p09", nome: "Confiável", titulo: "Merriweather", texto: "Lato", pesoTitulo: 700, estilos: ["confiavel", "classica", "editorial"], porque: "Serifa robusta de leitura longa com texto neutro: saúde, direito, educação." },
  { id: "p10", nome: "Minimalista", titulo: "Manrope", texto: "Manrope", pesoTitulo: 700, estilos: ["minimalista", "moderna", "elegante"], porque: "Geométrica aberta, bom espaço entre letras: marcas de produto e design." },
  { id: "p11", nome: "Criativo", titulo: "Syne", texto: "Karla", pesoTitulo: 700, estilos: ["ousada", "editorial", "moderna"], porque: "Display de estúdio criativo com texto de personalidade." },
  { id: "p12", nome: "Esportivo", titulo: "Oswald", texto: "Rubik", pesoTitulo: 600, estilos: ["ousada", "jovem", "confiavel"], porque: "Condensada forte e texto robusto: energia e movimento." },
  { id: "p13", nome: "Clássico sóbrio", titulo: "Libre Baskerville", texto: "Open Sans", pesoTitulo: 700, estilos: ["classica", "confiavel", "elegante"], porque: "Baskerville conhecida e texto universal: sério sem ser frio." },
  { id: "p14", nome: "Divertido", titulo: "Baloo 2", texto: "Nunito", pesoTitulo: 800, estilos: ["divertida", "amigavel", "jovem"], porque: "Formas gordinhas e alegres para marcas leves." },
  { id: "p15", nome: "Premium moderno", titulo: "Plus Jakarta Sans", texto: "Plus Jakarta Sans", pesoTitulo: 800, estilos: ["moderna", "elegante", "tecnologica"], porque: "Sem serifa contemporânea, apertada no título: SaaS e marcas premium." },
  { id: "p16", nome: "Editorial moderno", titulo: "DM Serif Display", texto: "DM Sans", pesoTitulo: 400, estilos: ["editorial", "elegante", "moderna"], porque: "Par da mesma família de desenho: harmonia garantida." },
  { id: "p17", nome: "Tradição acolhedora", titulo: "Lora", texto: "Source Sans 3", pesoTitulo: 700, estilos: ["classica", "amigavel", "artesanal"], porque: "Serifa calorosa para marcas de família, comida e bem-estar." },
  { id: "p18", nome: "Industrial", titulo: "Archivo", texto: "Archivo", pesoTitulo: 800, estilos: ["ousada", "tecnologica", "confiavel"], porque: "Grotesca larga e firme: construção, logística, indústria." },
  { id: "p19", nome: "Assinatura manual", titulo: "Caveat", texto: "Karla", pesoTitulo: 700, estilos: ["artesanal", "divertida", "amigavel"], porque: "Letra de mão para detalhes e texto limpo para ler (use a manuscrita com moderação)." },
  { id: "p20", nome: "Geométrico limpo", titulo: "Outfit", texto: "Work Sans", pesoTitulo: 700, estilos: ["moderna", "minimalista", "jovem"], porque: "Geometria simples, ótima em ícone e em tela pequena." },
  { id: "p21", nome: "Literário", titulo: "EB Garamond", texto: "Crimson Pro", pesoTitulo: 600, estilos: ["classica", "editorial", "elegante"], porque: "Garamond de livro: cultura, editora, vinho." },
  { id: "p22", nome: "Código", titulo: "Space Mono", texto: "Inter", pesoTitulo: 700, estilos: ["tecnologica", "ousada", "minimalista"], porque: "Monoespaçada no título dá cara de software; Inter segura o texto." },
  { id: "p23", nome: "Impacto elegante", titulo: "Anton", texto: "Lora", pesoTitulo: 400, estilos: ["ousada", "editorial"], porque: "Condensada pesada com serifa de texto: manchete de revista." },
  { id: "p24", nome: "Sóbrio corporativo", titulo: "Source Serif 4", texto: "Source Sans 3", pesoTitulo: 700, estilos: ["confiavel", "classica", "minimalista"], porque: "Superfamília da Adobe: seriedade e leitura excelente." },
];

// ------------------------------------------------------------------ nome da família e endereço

/** Família com nome seguro (letras, números e espaço; até 40). O resto vira "". */
export function familiaSegura(v: unknown): string {
  const s = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  return /^[A-Za-z0-9 ]{2,40}$/.test(s) ? s : "";
}

export function fonteDoCatalogo(familia: string): FonteDoCatalogo | null {
  const f = familiaSegura(familia).toLowerCase();
  return FONTES_DO_CATALOGO.filter((x) => x.familia.toLowerCase() === f)[0] || null;
}

/** Endereço do CSS do Google Fonts (css2, display=swap) para as famílias pedidas. */
export function urlDoGoogleFonts(familias: Array<{ familia: string; pesos?: number[] }>): string | null {
  const partes: string[] = [];
  const vistas: string[] = [];
  for (const f of familias) {
    const nome = familiaSegura(f.familia);
    if (!nome || vistas.indexOf(nome.toLowerCase()) >= 0) continue;
    vistas.push(nome.toLowerCase());
    const doCatalogo = fonteDoCatalogo(nome);
    const pedidos = (f.pesos && f.pesos.length ? f.pesos : doCatalogo ? doCatalogo.pesos : [400, 700]).filter((p) => p >= 100 && p <= 900 && p % 100 === 0);
    const disponiveis = doCatalogo ? pedidos.filter((p) => doCatalogo.pesos.indexOf(p) >= 0) : pedidos;
    const pesos = (disponiveis.length ? disponiveis : doCatalogo ? [doCatalogo.pesos[0]] : [400]).slice().sort((a, b) => a - b).filter((p, i, l) => l.indexOf(p) === i);
    partes.push(`family=${nome.replace(/ /g, "+")}:wght@${pesos.join(";")}`);
  }
  if (!partes.length) return null;
  return `https://fonts.googleapis.com/css2?${partes.join("&")}&display=swap`;
}

export function linkDaFamilia(familia: string): string {
  return `https://fonts.google.com/specimen/${encodeURIComponent(familiaSegura(familia) || "Inter").replace(/%20/g, "+")}`;
}

/** Pilha de fontes com a reserva do sistema pela categoria. */
export function pilhaDaFonte(familia: string): string {
  const f = fonteDoCatalogo(familia);
  const reserva = f && f.categoria === "serifada" ? "Georgia, 'Times New Roman', serif" : f && f.categoria === "mono" ? "'Courier New', monospace" : "Helvetica, Arial, sans-serif";
  const nome = familiaSegura(familia);
  return nome ? `"${nome}", ${reserva}` : reserva;
}

// ------------------------------------------------------------------ sugestão por personalidade (regra fixa)

const ESTILOS_DO_ARQUETIPO: Record<ArquetipoId, EstiloDeTipo[]> = {
  inocente: ["amigavel", "minimalista"],
  explorador: ["ousada", "jovem"],
  sabio: ["classica", "confiavel", "editorial"],
  heroi: ["ousada", "confiavel"],
  fora_da_lei: ["ousada", "editorial"],
  mago: ["elegante", "moderna"],
  cara_comum: ["amigavel", "confiavel"],
  amante: ["elegante", "editorial"],
  bobo_da_corte: ["divertida", "jovem"],
  cuidador: ["amigavel", "confiavel"],
  criador: ["artesanal", "editorial", "ousada"],
  governante: ["classica", "elegante", "confiavel"],
};

/** Etiquetas que a personalidade pede, pelo arquétipo e pelos eixos (-2 a 2). */
export function estilosDaPersonalidade(e: { arquetipo?: ArquetipoId | ""; eixos?: Partial<Record<EixoId, number>> }): EstiloDeTipo[] {
  const saida: EstiloDeTipo[] = [];
  const por = (s: EstiloDeTipo) => {
    if (saida.indexOf(s) < 0) saida.push(s);
  };
  if (e.arquetipo) (ESTILOS_DO_ARQUETIPO[e.arquetipo] || []).forEach(por);
  const x = e.eixos || {};
  if ((x.tradicao || 0) <= -1) por("classica");
  if ((x.tradicao || 0) >= 1) por("moderna");
  if ((x.formalidade || 0) >= 1) por("amigavel");
  if ((x.formalidade || 0) <= -1) por("confiavel");
  if ((x.humor || 0) >= 1) por("divertida");
  if ((x.energia || 0) >= 1) por("ousada");
  if ((x.energia || 0) <= -1) por("minimalista");
  if ((x.acesso || 0) >= 1) por("elegante");
  if ((x.razao || 0) <= -1) por("tecnologica");
  return saida;
}

/** Pares ordenados pelo quanto combinam com as etiquetas (empate: a ordem do catálogo). */
export function paresParaEstilos(estilos: EstiloDeTipo[], quantos = 24): Array<ParDeFontes & { encaixe: number }> {
  return PARES_DE_FONTES.map((p, i) => ({ p, i, encaixe: p.estilos.filter((s) => estilos.indexOf(s) >= 0).length }))
    .sort((a, b) => b.encaixe - a.encaixe || a.i - b.i)
    .slice(0, quantos)
    .map((x) => ({ ...x.p, encaixe: x.encaixe }));
}

/** Hierarquia de 5 níveis do manual (tamanho em px e peso) para o par escolhido. */
export function hierarquiaDoPar(par: { titulo: string; texto: string; pesoTitulo?: number }): Array<{ nivel: string; familia: string; tamanho: number; peso: number; exemplo: string }> {
  const pt = par.pesoTitulo || 700;
  return [
    { nivel: "Título 1", familia: par.titulo, tamanho: 40, peso: pt, exemplo: "A marca em uma frase" },
    { nivel: "Título 2", familia: par.titulo, tamanho: 28, peso: pt, exemplo: "Um subtítulo que organiza" },
    { nivel: "Subtítulo", familia: par.texto, tamanho: 18, peso: 600, exemplo: "Uma linha de apoio" },
    { nivel: "Texto", familia: par.texto, tamanho: 15, peso: 400, exemplo: "O texto corrido precisa ser confortável de ler em qualquer tela." },
    { nivel: "Complementar", familia: par.texto, tamanho: 12, peso: 400, exemplo: "Legenda, nota de rodapé e crédito" },
  ];
}

/**
 * Proposta de par (da IA) em forma segura: famílias com nome seguro; quem
 * está no catálogo ganha "conferida" (a tela avisa quando não está: o nome
 * pode não existir no Google Fonts).
 */
export function normalizarParesPropostos(bruto: unknown): Array<{ titulo: string; texto: string; porque: string; conferida: boolean }> {
  const lista = Array.isArray(bruto) ? bruto : bruto && typeof bruto === "object" && Array.isArray((bruto as Record<string, unknown>).pares) ? ((bruto as Record<string, unknown>).pares as unknown[]) : [];
  const saida: Array<{ titulo: string; texto: string; porque: string; conferida: boolean }> = [];
  for (const b of lista) {
    const o = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
    const titulo = familiaSegura(o.titulo);
    const texto = familiaSegura(o.texto) || titulo;
    if (!titulo || saida.some((s) => s.titulo === titulo && s.texto === texto)) continue;
    saida.push({ titulo, texto, porque: String(o.porque == null ? "" : o.porque).replace(/\s+/g, " ").trim().slice(0, 300), conferida: !!fonteDoCatalogo(titulo) && !!fonteDoCatalogo(texto) });
    if (saida.length >= 4) break;
  }
  return saida;
}
