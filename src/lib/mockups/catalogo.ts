/**
 * Catálogo de mockups e texturas lido do banco (mockup_catalogo, textura_catalogo), já limpo
 * para a tela. Linha com defeito fica fora, nunca derruba a lista.
 */

export type PapelDoSlot = "arte" | "logo" | "cor" | "verso";

export interface SlotDoMockup {
  indice: number;
  papel: PapelDoSlot;
  nome: string;
  soPx: [number, number];
  /** [x0, y0, x1, y1] em 0..1 no espaço do design. */
  areaSegura: [number, number, number, number];
  luminanciaSuperficie: number | null;
  /** Maior lado (px, na versão alta) que o slot ocupa na imagem: o design não precisa ser maior. */
  pxNaTela: number | null;
}

export interface ConjuntoDeCamadas {
  base: string;
  vazio: string;
  ganho: string;
  uv: string;
  mapa: string;
}

export interface MockupDoCatalogo {
  id: string;
  nome: string;
  categoria: CategoriaDeMockup;
  tags: string[];
  slots: SlotDoMockup[];
  largura: number;
  altura: number;
  larguraTrabalho: number;
  alturaTrabalho: number;
  caminhos: { alta: ConjuntoDeCamadas; trabalho: ConjuntoDeCamadas; thumb: string };
  luminanciaMedia: number | null;
}

export interface TexturaDoCatalogo {
  id: string;
  nome: string;
  categoria: string;
  largura: number;
  altura: number;
  caminho: string;
  caminhoMini: string;
}

export type CategoriaDeMockup =
  | "papelaria" | "cartao" | "folder" | "livro" | "dispositivo" | "poster" | "caneca" | "vestuario"
  | "sacola" | "embalagem" | "logo-efeito" | "outdoor" | "veiculo";

/** Ordem da sequência bonita: papelaria, digital, produto, exterior. */
export const CATEGORIAS: Array<{ id: CategoriaDeMockup; rotulo: string; grupo: "Papelaria" | "Digital" | "Produto" | "Exterior" }> = [
  { id: "papelaria", rotulo: "Papelaria", grupo: "Papelaria" },
  { id: "cartao", rotulo: "Cartão", grupo: "Papelaria" },
  { id: "folder", rotulo: "Folder", grupo: "Papelaria" },
  { id: "livro", rotulo: "Livro", grupo: "Papelaria" },
  { id: "dispositivo", rotulo: "Telas", grupo: "Digital" },
  { id: "poster", rotulo: "Pôster", grupo: "Digital" },
  { id: "caneca", rotulo: "Caneca", grupo: "Produto" },
  { id: "vestuario", rotulo: "Vestuário", grupo: "Produto" },
  { id: "sacola", rotulo: "Sacola", grupo: "Produto" },
  { id: "embalagem", rotulo: "Embalagem", grupo: "Produto" },
  { id: "logo-efeito", rotulo: "Logo com efeito", grupo: "Produto" },
  { id: "outdoor", rotulo: "Outdoor", grupo: "Exterior" },
  { id: "veiculo", rotulo: "Veículo", grupo: "Exterior" },
];

const IDS = CATEGORIAS.map((c) => c.id) as string[];
const PAPEIS: PapelDoSlot[] = ["arte", "logo", "cor", "verso"];

export const rotuloDaCategoria = (id: string) => (CATEGORIAS.find((c) => c.id === id) || { rotulo: id }).rotulo;

const num = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

const texto = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");

function conjunto(v: unknown): ConjuntoDeCamadas | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const c = { base: texto(o.base), vazio: texto(o.vazio), ganho: texto(o.ganho), uv: texto(o.uv), mapa: texto(o.mapa) };
  return c.base && c.vazio && c.ganho && c.uv && c.mapa ? c : null;
}

export function normalizarSlot(v: unknown): SlotDoMockup | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const indice = num(o.indice, 1, 8);
  const papel = PAPEIS.indexOf(o.papel as PapelDoSlot) >= 0 ? (o.papel as PapelDoSlot) : null;
  const area = Array.isArray(o.area_segura) ? o.area_segura.map((x) => num(x, 0, 1)) : [];
  if (!indice || !papel || area.length !== 4 || area.some((x) => x === null)) return null;
  const a = area as number[];
  if (a[2] <= a[0] || a[3] <= a[1]) return null;
  const so = Array.isArray(o.so_px) ? o.so_px.map((x) => num(x, 1, 20000)) : [];
  return {
    indice: Math.round(indice),
    papel,
    nome: texto(o.nome, 80),
    soPx: so.length === 2 && so[0] && so[1] ? [Math.round(so[0]), Math.round(so[1])] : [1024, 1024],
    areaSegura: [a[0], a[1], a[2], a[3]],
    luminanciaSuperficie: num(o.luminancia_superficie, 0, 1),
    pxNaTela: num(o.px_na_tela, 1, 10000),
  };
}

/** Linha de mockup_catalogo -> item da tela (ou null se estiver com defeito). */
export function normalizarMockup(v: unknown): MockupDoCatalogo | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = texto(o.id, 80);
  if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(id) || o.ativo === false) return null;
  if (IDS.indexOf(String(o.categoria)) < 0) return null;
  const slots = (Array.isArray(o.slots) ? o.slots : []).map(normalizarSlot);
  if (!slots.length || slots.some((s) => !s)) return null;
  const c = (o.caminhos || {}) as Record<string, unknown>;
  const alta = conjunto(c.alta);
  const trabalho = conjunto(c.trabalho);
  const thumb = texto(c.thumb);
  const largura = num(o.largura, 1, 6000);
  const altura = num(o.altura, 1, 6000);
  const lt = num(o.largura_trabalho, 1, 2048);
  const at = num(o.altura_trabalho, 1, 2048);
  if (!alta || !trabalho || !thumb || !largura || !altura || !lt || !at) return null;
  return {
    id,
    nome: texto(o.nome, 120) || id,
    categoria: o.categoria as CategoriaDeMockup,
    tags: Array.isArray(o.tags) ? o.tags.map((t) => texto(t, 40)).filter(Boolean) : [],
    slots: (slots as SlotDoMockup[]).sort((x, y) => x.indice - y.indice),
    largura,
    altura,
    larguraTrabalho: lt,
    alturaTrabalho: at,
    caminhos: { alta, trabalho, thumb },
    luminanciaMedia: num(o.luminancia_media, 0, 1),
  };
}

export function normalizarTextura(v: unknown): TexturaDoCatalogo | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = texto(o.id, 120);
  const largura = num(o.largura, 1, 4096);
  const altura = num(o.altura, 1, 4096);
  if (!id || o.ativo === false || !largura || !altura || !texto(o.caminho) || !texto(o.caminho_mini)) return null;
  return { id, nome: texto(o.nome, 120) || id, categoria: texto(o.categoria, 40), largura, altura, caminho: texto(o.caminho), caminhoMini: texto(o.caminho_mini) };
}

/** Ordena na sequência (papelaria, digital, produto, exterior) e, dentro da categoria, pelo nome. */
export function ordenarNaSequencia<T extends { categoria: string; nome: string }>(itens: T[]): T[] {
  const pos = (c: string) => {
    const i = IDS.indexOf(c);
    return i < 0 ? IDS.length : i;
  };
  return itens.slice().sort((a, b) => pos(a.categoria) - pos(b.categoria) || a.nome.localeCompare(b.nome, "pt-BR"));
}

/**
 * Candidatos para a sugestão: os mockups das categorias escolhidas. Sem categoria escolhida,
 * todos. Limite para o Jev (o estado vai inteiro numa pergunta por item).
 */
export function candidatosDaSugestao(itens: MockupDoCatalogo[], categorias: string[], limite = 40): MockupDoCatalogo[] {
  const set = categorias.length ? itens.filter((m) => categorias.indexOf(m.categoria) >= 0) : itens;
  return ordenarNaSequencia(set).slice(0, limite);
}
