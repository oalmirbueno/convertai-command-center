/**
 * Trava da marca (frente T, 26/09/2026). Regra dura do dono, vale para
 * referência de carrossel, template, combinação e estilo do cliente:
 *
 *   "NUNCA trocar a tipografia do cliente, as cores do cliente nem o logo do
 *   cliente pelos da referência."
 *
 * A referência empresta layout, hierarquia, proporção, peso relativo, tamanho
 * relativo, espaçamento, caixa-alta ou baixa, tratamento e composição. A letra
 * é sempre a do kit (peso que a fonte do cliente não tem: o mais perto, com
 * tamanho e espaçamento ajustados), as cores são as do kit com a FUNÇÃO que a
 * referência dá (dominante, destaque, neutro) e o logo é o do cliente, pelo
 * caminho que o Estúdio já usa.
 *
 * Em código: neutralizarMarcaDaReferencia tira do texto que vai ao modelo
 * qualquer fonte, hex e nome de cor que não sejam do kit; blocoDaMarcaTravada
 * monta a regra curta com a letra e as cores do kit. Puro. Sem travessão.
 */

export type KitDaTrava = {
  fontes?: Array<{ nome?: string | null; papel?: string | null }> | null;
  paleta?: Array<{ nome?: string | null; hex?: string | null; papel?: string | null }> | null;
} | null;

/** Famílias comuns em referência (lista aberta: o que não está aqui e vem entre aspas depois de "fonte" também sai). */
export const FONTES_CONHECIDAS = [
  "Montserrat", "Poppins", "Roboto", "Inter", "Helvetica Neue", "Helvetica", "Arial", "Futura", "Bebas Neue", "Bebas", "Playfair Display", "Playfair",
  "Lato", "Open Sans", "Oswald", "Raleway", "Gotham", "Avenir", "Garamond", "EB Garamond", "Times New Roman", "Didot", "Bodoni", "Georgia", "Nunito",
  "Merriweather", "DM Sans", "DM Serif Display", "DM Serif", "Anton", "Archivo", "Space Grotesk", "Syne", "Outfit", "Manrope", "Sora", "Lora",
  "Libre Baskerville", "Baskerville", "Cormorant Garamond", "Cormorant", "Josefin Sans", "Quicksand", "Rubik", "Work Sans", "Ubuntu", "Source Sans Pro",
  "Source Sans", "PT Sans", "PT Serif", "Barlow Condensed", "Barlow", "Fira Sans", "Karla", "Mulish", "Cabinet Grotesk", "Clash Display", "Satoshi",
  "Neue Haas Grotesk", "Proxima Nova", "Brandon Grotesque", "Gilroy", "Druk", "League Spartan", "Spartan", "Chivo", "IBM Plex Sans",
  "IBM Plex Serif", "Noto Sans", "Noto Serif", "Plus Jakarta Sans", "Lexend", "Epilogue", "Urbanist", "Figtree", "Onest", "Unbounded", "Righteous",
  "Pacifico", "Lobster", "Dancing Script", "Great Vibes", "Abril Fatface", "Alfa Slab One", "Roboto Slab", "Roboto Condensed", "Titillium Web",
  "Exo 2", "Exo", "Kanit", "Heebo", "Cabin", "Hind", "Arvo", "Bitter", "Crimson Text", "Vollkorn", "Zilla Slab",
];

/** Nomes de cor (pt e en). Neutros viram "neutro claro/escuro"; o resto vira "cor do kit". "Black" e "white" ficam de fora: em design são peso de letra. */
const NEUTROS: Array<[string, string]> = [
  ["off-white", "neutro claro"], ["off white", "neutro claro"], ["branco", "neutro claro"], ["branca", "neutro claro"],
  ["preto", "neutro escuro"], ["preta", "neutro escuro"], ["grafite", "neutro escuro"],
  ["cinza", "neutro"], ["gray", "neutro"], ["grey", "neutro"],
];
const CORES = [
  "verde", "azul", "amarelo", "amarela", "laranja", "vermelho", "vermelha", "roxo", "roxa", "rosa", "pink", "lilás", "lilas", "violeta", "marrom",
  "bege", "dourado", "dourada", "prateado", "prateada", "turquesa", "vinho", "bordô", "bordo", "magenta", "ciano", "coral", "mostarda", "creme",
  "caramelo", "terracota", "salmão", "salmao", "lavanda", "menta", "oliva", "esmeralda", "anil", "índigo", "indigo", "carmim", "fúcsia", "fucsia",
  "green", "blue", "yellow", "orange", "red", "purple", "brown", "gold", "golden", "silver", "navy", "teal", "beige",
];
const TONS = "(?:\\s+(?:claro|clara|escuro|escura|vibrante|neon|pastel|queimado|queimada|fechado|fechada|intenso|intensa|suave|royal|bebê|bebe|militar|musgo|petróleo|petroleo|light|dark))?";

const LETRA = "A-Za-z\\u00C0-\\u00FF";
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Troca a palavra inteira (sem pegar pedaço de outra), sem lookbehind: o separador da esquerda volta no lugar. */
function trocarPalavra(texto: string, termo: string, por: string, flags = "gi"): string {
  const re = new RegExp(`(^|[^${LETRA}0-9])(${termo})(?=$|[^${LETRA}0-9])`, flags);
  return texto.replace(re, (_m, antes: string) => `${antes}${por}`);
}

function fontesDoKit(kit: KitDaTrava): string[] {
  return ((kit && kit.fontes) || []).map((f) => String((f && f.nome) || "").trim()).filter(Boolean);
}

function hexDoKit(kit: KitDaTrava): string[] {
  return ((kit && kit.paleta) || []).map((c) => String((c && c.hex) || "").trim().toLowerCase()).filter((h) => /^#[0-9a-f]{6}$/.test(h));
}

/**
 * Tira do texto (que vai ao modelo) o que a referência diria da marca dela:
 * fonte, hex, rgb e nome de cor. O que é do kit do cliente fica. Não mexe em
 * layout, hierarquia, peso, tamanho, espaçamento, caixa nem tratamento.
 */
export function neutralizarMarcaDaReferencia(texto: string, kit: KitDaTrava = null, opcoes: { nomesDeCor?: boolean } = {}): string {
  if (!texto) return "";
  let s = String(texto);
  const doKit = fontesDoKit(kit).map(semAcento);
  const hexKit = hexDoKit(kit);
  // Hex e funções de cor que não são do kit.
  s = s.replace(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi, (h) => (hexKit.indexOf(h.toLowerCase()) >= 0 ? h : "cor do kit"));
  s = s.replace(/\b(?:rgba?|hsla?)\s*\([^)]{0,40}\)/gi, "cor do kit");
  // Fonte entre aspas depois de "fonte", "tipografia", "letra" ou "font".
  s = s.replace(/(fonte|tipografia|letra|font|typeface)(\s+(?:chamada\s+|tipo\s+)?)["“‘']([^"”’']{2,40})["”’']/gi, (m, p: string, meio: string, nome: string) =>
    doKit.indexOf(semAcento(nome.trim())) >= 0 ? m : `${p}${meio}do kit`,
  );
  // Famílias conhecidas (as mais longas primeiro: "Helvetica Neue" antes de "Helvetica").
  const fontes = FONTES_CONHECIDAS.slice().sort((a, b) => b.length - a.length);
  for (const f of fontes) {
    if (doKit.indexOf(semAcento(f)) >= 0) continue;
    // Nome próprio: só com a caixa da família ("Futura" sai, "a futura cliente" fica). O peso colado fica ("fonte do kit Black").
    s = trocarPalavra(s, `${escapar(f)}`, "fonte do kit", "g");
  }
  s = s.replace(/fonte do kit(\s+fonte do kit)+/gi, "fonte do kit");
  if (opcoes.nomesDeCor !== false) {
    for (const [nome, por] of NEUTROS) s = trocarPalavra(s, `${escapar(nome)}${TONS}`, por);
    for (const nome of CORES.slice().sort((a, b) => b.length - a.length)) s = trocarPalavra(s, `${escapar(nome)}${TONS}`, "cor do kit");
    s = s.replace(/cor do kit(\s*(?:e|,|\/)\s*cor do kit)+/gi, "cores do kit");
  }
  return s;
}

/**
 * A regra curta da trava, com a letra e as cores do kit quando há (senão, a
 * regra sem nomes: o prompt da lâmina já traz o kit).
 */
export function blocoDaMarcaTravada(kit: KitDaTrava = null): string {
  const fontes = ((kit && kit.fontes) || []).filter((f) => f && f.nome).slice(0, 3).map((f) => `${String(f.nome).trim()}${f.papel ? ` (${String(f.papel).trim()})` : ""}`);
  const cores = ((kit && kit.paleta) || [])
    .filter((c) => c && c.hex && /^#[0-9a-f]{6}$/i.test(String(c.hex)))
    .slice(0, 6)
    .map((c) => `${String(c.hex)}${c.papel ? ` ${String(c.papel).trim()}` : c.nome ? ` ${String(c.nome).trim()}` : ""}`);
  return [
    "- MARCA TRAVADA: letra, cores e logo são SEMPRE os do cliente. Da referência e do molde vêm só layout, hierarquia, proporção, peso e tamanho relativos, espaçamento, caixa alta ou baixa, tratamento e composição.",
    `- LETRA: ${fontes.length ? fontes.join(", ") : "a do kit do cliente"}; peso que ela não tem: o mais perto, ajustando tamanho e espaçamento.`,
    `- COR: ${cores.length ? cores.join(", ") : "as do kit do cliente"}, cada uma na mesma função que a referência dá (dominante, destaque, neutro).`,
    "- LOGO: só a do cliente, a do kit; nunca a da referência.",
  ].join("\n");
}
