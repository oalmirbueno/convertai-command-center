import type { FotoDoAcervo, KitDeFoto } from "./fotoApi";

/**
 * Fotos são só fotos (02/10, dono: "a Mesa Foto mistura criativo, arte e
 * carrossel com as fotos; separe produto e modelo").
 *
 * O acervo do cliente (cliente_imagens) é o mesmo da Mesa e da Mesa Ads: lá
 * entram também as artes entregues, carrosséis, logos e posts que vieram do
 * Workspace. Na Mesa Foto ficam só as fotos, em dois lados:
 * - Produto: fotos do produto, embalagem, detalhe, ambiente, e o que a
 *   Mesa Foto gerou a partir do produto sem pessoa.
 * - Modelo: pessoa (real ou sintética), clone, persona, foto com modelo.
 *
 * Regra determinística pelos metadados (categoria, etiquetas, pasta, nome,
 * modo, produto do tipo pessoa). Foto sem nenhum sinal fica em "Produto" e
 * entra na lista de "a separar": o Jev decide no servidor (fotos_separar),
 * só nessas, e grava a categoria.
 *
 * Arquivo puro: a página, o seletor de fotos e os testes usam as mesmas regras.
 */

export type LadoDaFoto = "produto" | "modelo";

type FotoParaSeparar = Pick<FotoDoAcervo, "nome" | "categoria" | "tags" | "pasta" | "modo" | "kit_id" | "ativa"> & {
  origem?: string;
  descricao?: string | null;
};

const CATEGORIAS_DE_ARTE = ["arte", "logo"];
const CATEGORIAS_DE_PESSOA = ["pessoa", "equipe"];
const CATEGORIAS_DE_PRODUTO = ["produto", "detalhe", "ambiente", "fachada", "antes_depois"];

const TAGS_DE_ARTE = ["arte", "artes", "criativo", "criativos", "carrossel", "carousel", "post", "posts", "story", "stories", "banner", "logo", "logotipo", "peca", "peça", "layout", "mockup", "flyer", "template", "tipo:arte", "arte_final", "entrega"];
const TAGS_DE_MODELO = ["pessoa", "modelo", "rosto", "persona", "clone", "retrato", "pessoa_sintetica", "pessoa_real_autorizada", "clone_variacao", "tipo:pessoa", "papel:rosto", "papel:corpo"];

/** Palavras de arte no nome ou na pasta (Workspace: "Artes de maio", "Carrossel 3", "post_feed.png"). */
const ARTE_NO_TEXTO = /(^|[^a-z])(artes?|criativos?|carross?e?l|carousel|posts?|story|stories|banners?|feed|thumbs?|thumbnail|logos?|logotipo|layouts?|mockups?|flyers?|panfletos?|templates?|entregues?|cards?)([^a-z]|$)/;
const MODELO_NO_TEXTO = /(^|[^a-z])(modelos?|pessoas?|retratos?|rostos?|selfies?|equipe|clones?|personas?|influencer|ensaio de moda|lookbook)([^a-z]|$)/;

const semAcento = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const temTag = (tags: string[] | null | undefined, lista: string[]) => (tags || []).some((t) => lista.indexOf(semAcento(t)) >= 0 || lista.indexOf(t.toLowerCase()) >= 0);
const temTagComPrefixo = (tags: string[] | null | undefined, prefixos: string[]) => (tags || []).some((t) => prefixos.some((p) => t.toLowerCase().indexOf(p) === 0));

/** É arte, criativo, carrossel, post, logo: fica na Mesa (Estúdio), fora das fotos. */
export function ehArte(f: FotoParaSeparar): boolean {
  const cat = semAcento(f.categoria || "");
  if (CATEGORIAS_DE_ARTE.indexOf(cat) >= 0) return true;
  if (temTag(f.tags, TAGS_DE_ARTE)) return true;
  // Foto da Mesa Foto (gerada, ensaio, clone) nunca é arte, mesmo com "post" no nome da pasta.
  if (f.modo || temTag(f.tags, ["mesa_foto"])) return false;
  const texto = semAcento(`${f.pasta || ""} ${f.nome || ""}`).replace(/[_\-./]+/g, " ");
  return ARTE_NO_TEXTO.test(texto);
}

/** Entra nas fotos da Mesa Foto: ativa e não é arte. */
export function ehSoFoto(f: FotoParaSeparar): boolean {
  if (f.ativa === false) return false;
  return !ehArte(f);
}

/**
 * Produto ou modelo. `kits` serve para a foto que está num produto do tipo
 * pessoa (book de pessoa, clone antigo).
 */
export function ladoDaFoto(f: FotoParaSeparar & { id?: string }, kits: Pick<KitDeFoto, "id" | "tipo" | "refs">[] = []): LadoDaFoto {
  if (f.modo === "clone") return "modelo";
  const cat = semAcento(f.categoria || "");
  if (CATEGORIAS_DE_PESSOA.indexOf(cat) >= 0) return "modelo";
  if (temTag(f.tags, TAGS_DE_MODELO) || temTagComPrefixo(f.tags, ["persona:", "clone:", "persona_imagem:", "com_persona:", "com_clone:"])) return "modelo";
  const kit = kits.find((k) => k.id === f.kit_id || (!!f.id && k.refs.some((r) => r.imagem_id === f.id)));
  if (kit && kit.tipo === "pessoa") return "modelo";
  if (CATEGORIAS_DE_PRODUTO.indexOf(cat) >= 0) return "produto";
  const texto = semAcento(`${f.pasta || ""} ${f.nome || ""}`).replace(/[_\-./]+/g, " ");
  if (MODELO_NO_TEXTO.test(texto)) return "modelo";
  return "produto";
}

/**
 * Sem nenhum sinal (categoria, etiqueta de lado, produto, nome que diga):
 * a regra pôs em "Produto" por padrão. São essas que o Jev separa.
 */
export function precisaSeparar(f: FotoParaSeparar & { id?: string; gerada?: boolean }, kits: Pick<KitDeFoto, "id" | "tipo" | "refs">[] = []): boolean {
  if (!ehSoFoto(f)) return false;
  if (f.gerada || f.modo) return false;
  if (f.categoria) return false;
  if (f.kit_id || (f.id && kits.some((k) => k.refs.some((r) => r.imagem_id === f.id)))) return false;
  if (temTag(f.tags, TAGS_DE_MODELO) || temTagComPrefixo(f.tags, ["persona:", "clone:", "com_persona:", "com_clone:"])) return false;
  const texto = semAcento(`${f.pasta || ""} ${f.nome || ""}`).replace(/[_\-./]+/g, " ");
  if (MODELO_NO_TEXTO.test(texto)) return false;
  return true;
}

export interface FotosSeparadas<T> {
  produto: T[];
  modelo: T[];
  /** Fora das fotos (artes, carrosséis, logos, inativas). */
  fora: number;
  /** Em "Produto" só por falta de sinal: o Jev pode separar. */
  aSeparar: T[];
}

export function separarFotos<T extends FotoParaSeparar & { id: string; gerada?: boolean }>(fotos: T[], kits: Pick<KitDeFoto, "id" | "tipo" | "refs">[] = []): FotosSeparadas<T> {
  const saida: FotosSeparadas<T> = { produto: [], modelo: [], fora: 0, aSeparar: [] };
  for (const f of fotos) {
    if (!ehSoFoto(f)) {
      saida.fora++;
      continue;
    }
    if (ladoDaFoto(f, kits) === "modelo") saida.modelo.push(f);
    else {
      saida.produto.push(f);
      if (precisaSeparar(f, kits)) saida.aSeparar.push(f);
    }
  }
  return saida;
}

export const LADOS_DA_FOTO: { valor: LadoDaFoto; rotulo: string; dica: string }[] = [
  { valor: "produto", rotulo: "Produto", dica: "Fotos do produto, embalagem, detalhe e ambiente." },
  { valor: "modelo", rotulo: "Modelo", dica: "Pessoas: modelos da IA, clones e fotos com modelo." },
];
