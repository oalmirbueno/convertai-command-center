/**
 * Cálculos da Mesa Foto, puros e sem IA (docs/mesa-foto/CONTRATO.md).
 *
 * Tudo aqui é regra fixa e testável: validação de entrada (caminhos, kit,
 * referências, guia, itens da biblioteca), leitura de cabeçalho de imagem,
 * ordem das fontes do kit, bloqueio e modo das tomadas, estimativa de custo,
 * prompts fotográficos, decisão de versão, complemento das áreas protegidas,
 * normalização do Openverse e das sugestões do agente. Sem dependência de
 * Deno nem de banco: a função mesa-foto usa e o teste do painel importa.
 *
 * Sem travessão nos textos (regra do dono).
 */

import { type CapacidadesImagem, limiteDeReferencias } from "../_shared/capacidades-imagem.ts";
import {
  type Camera,
  cameraDoPreset,
  CRITERIOS_CONFERENCIA,
  CRITERIOS_DA_TOMADA,
  ENQUADRAMENTOS,
  type Enquadramento,
  type Exigencia,
  type Foco,
  FOCOS,
  FORMATOS,
  type Formato,
  gruposDoTipo,
  MUDANCAS_DA_RODADA,
  ORDEM_DAS_VARIACOES,
  PROIBICOES_PESSOA_SINTETICA,
  tipoDeVariacaoPorId,
  type TipoDeVariacao,
  type TomadaDaReceita,
  lenteDaTomada,
  type ModoTomada,
  NOMES_DAS_VISTAS,
  PAPEIS,
  PAPEIS_DE_EVIDENCIA,
  type PapelRef,
  presetPorId,
  PROIBICOES,
  PROIBICOES_GERAIS,
  type Receita,
  TIPOS_DE_KIT,
  type TipoKit,
  VISTAS,
  azimuteEmPalavras,
  elevacaoEmPalavras,
  enquadramentoEmPalavras,
  idDoPreset,
} from "./receitas.ts";

// ------------------------------------------------------------ erro de regra

/** Erro de entrada ou de regra com status HTTP e código para a tela. */
export class ErroDeRegra extends Error {
  status: number;
  codigo: string;
  extra: Record<string, unknown>;
  constructor(status: number, codigo: string, mensagem: string, extra: Record<string, unknown> = {}) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.extra = extra;
  }
}

// ------------------------------------------------------------ texto

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Travessão e meia-risca viram vírgula (regra do dono), sem mexer em hífen de palavra. */
export function semTravessao(texto: string): string {
  return texto.replace(/\s*[\u2014\u2013]\s*/g, ", ").replace(/,\s*,/g, ",");
}

/** Texto limpo, sem travessão, cortado no máximo. */
export const limpo = (v: unknown, max = 2000): string =>
  typeof v === "string" ? semTravessao(v.trim().replace(/[ \t]+/g, " ")).slice(0, max).trim() : "";

export const limpoOuNulo = (v: unknown, max = 2000): string | null => limpo(v, max) || null;

/** Lista de textos curtos, sem vazios nem repetidos. */
export function listaDeTextos(v: unknown, maxItens = 20, maxTexto = 300): string[] {
  if (!Array.isArray(v)) return [];
  const saida: string[] = [];
  for (const item of v) {
    const t = limpo(item, maxTexto);
    if (t && !saida.includes(t)) saida.push(t);
    if (saida.length >= maxItens) break;
  }
  return saida;
}

export const arred6 = (v: number) => Math.round((Number.isFinite(v) ? v : 0) * 1e6) / 1e6;

export function nomeSeguro(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "foto";
}

// ------------------------------------------------------------ bytes de imagem

export type MimeImagem = "image/png" | "image/jpeg" | "image/webp";

/** Tipo pelo conteúdo (não pela extensão). GIF e o resto ficam de fora. */
export function mimeDe(b: Uint8Array): MimeImagem | null {
  if (b.length < 16) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return "image/webp";
  }
  return null;
}

export const extensaoDe = (mime: string) => ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as Record<string, string>)[mime] ?? "bin";

/** Largura e altura pelo cabeçalho (PNG, JPEG e WebP), sem decodificar a imagem. */
export function dimensoesDaImagem(b: Uint8Array): { largura: number; altura: number } | null {
  const mime = mimeDe(b);
  if (!mime) return null;
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  if (mime === "image/png") {
    if (b.length < 24) return null;
    const u32 = (i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
    const largura = u32(16), altura = u32(20);
    return largura > 0 && altura > 0 ? { largura, altura } : null;
  }
  if (mime === "image/jpeg") {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marcador = b[i + 1];
      if (marcador === 0xff) { i++; continue; }
      // Marcadores sem tamanho (RST, SOI, EOI, TEM).
      if ((marcador >= 0xd0 && marcador <= 0xd9) || marcador === 0x01) { i += 2; continue; }
      const ehSof = marcador >= 0xc0 && marcador <= 0xcf && marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc;
      if (ehSof) {
        const altura = u16be(i + 5), largura = u16be(i + 7);
        return largura > 0 && altura > 0 ? { largura, altura } : null;
      }
      const tamanho = u16be(i + 2);
      if (tamanho < 2) return null;
      i += 2 + tamanho;
    }
    return null;
  }
  // WebP: VP8 (com perdas), VP8L (sem perdas) ou VP8X (estendido).
  if (b.length < 30) return null;
  const pedaco = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (pedaco === "VP8 ") {
    const largura = (b[26] | (b[27] << 8)) & 0x3fff, altura = (b[28] | (b[29] << 8)) & 0x3fff;
    return largura > 0 && altura > 0 ? { largura, altura } : null;
  }
  if (pedaco === "VP8L") {
    const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
    return { largura: (bits & 0x3fff) + 1, altura: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (pedaco === "VP8X") {
    return { largura: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), altura: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
  }
  return null;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const resumo = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
  return Array.from(resumo, (x) => x.toString(16).padStart(2, "0")).join("");
}

// ------------------------------------------------------------ caminhos

/** Pasta dos originais da Mesa Foto no bucket mesa (o front sobe aqui). */
export const pastaDosOriginais = (clientId: string) => `${clientId}/foto/originais/`;

/** Caminho de original aceito: dentro da pasta do cliente, sem subir de pasta nem caractere estranho. */
export function caminhoDeOriginalValido(clientId: string, caminho: unknown): string | null {
  if (typeof caminho !== "string") return null;
  const c = caminho.trim();
  if (!c.startsWith(pastaDosOriginais(clientId)) || c.length > 400) return null;
  if (c.includes("..") || c.includes("//") || c.includes("\\") || /[\u0000-\u001f]/.test(c)) return null;
  if (c.length <= pastaDosOriginais(clientId).length) return null;
  return c;
}

/** Caminho no bucket mesa que pertence ao cliente (qualquer subpasta dele) ou à biblioteca da agência. */
export function caminhoDoClienteNoMesa(clientId: string, caminho: unknown, aceitarBiblioteca = false): string | null {
  if (typeof caminho !== "string") return null;
  const c = caminho.trim();
  if (c.length > 400 || c.includes("..") || c.includes("//") || c.includes("\\")) return null;
  if (c.startsWith(`${clientId}/`) && c.length > clientId.length + 1) return c;
  if (aceitarBiblioteca && c.startsWith("biblioteca/") && c.length > 11) return c;
  return null;
}

/** Nome legível a partir do arquivo enviado. */
export function nomeDoArquivo(caminho: string, nome?: unknown): string {
  const dado = limpo(nome, 120);
  if (dado) return dado;
  const base = caminho.split("/").pop() ?? "foto";
  return base.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "foto";
}

// ------------------------------------------------------------ áreas

/** Área relativa à imagem, de 0 a 1 (mesmo formato de _shared/imagem-local.ts). */
export type Area = { x0: number; y0: number; x1: number; y1: number };

const limitar01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

/** Áreas pedidas pela tela: ordena os cantos, corta em [0,1] e descarta as vazias (como normalizarAreas). */
export function lerAreas(bruto: unknown, max = 6): Area[] {
  if (!Array.isArray(bruto)) return [];
  const saida: Area[] = [];
  for (const a of bruto.slice(0, max)) {
    if (!a || typeof a !== "object") continue;
    const r = a as Record<string, unknown>;
    const xa = limitar01(Number(r.x0)), xb = limitar01(Number(r.x1));
    const ya = limitar01(Number(r.y0)), yb = limitar01(Number(r.y1));
    const area = { x0: Math.min(xa, xb), y0: Math.min(ya, yb), x1: Math.max(xa, xb), y1: Math.max(ya, yb) };
    if (area.x1 - area.x0 >= 0.02 && area.y1 - area.y0 >= 0.02) saida.push(area);
  }
  return saida;
}

/**
 * Tudo o que NÃO está protegido, em retângulos (a máscara do editor abre essas
 * áreas e devolverOriginalForaDasAreas devolve o original no resto, isto é,
 * dentro das áreas protegidas). Grade pelas bordas das áreas, células livres
 * juntadas por linha e faixas iguais juntadas na vertical.
 */
export function complementoDasAreas(protegidas: Area[]): Area[] {
  if (!protegidas.length) return [{ x0: 0, y0: 0, x1: 1, y1: 1 }];
  const unicos = (v: number[]) => Array.from(new Set(v.map((x) => Math.round(x * 1e6) / 1e6))).sort((a, b) => a - b);
  const xs = unicos([0, 1, ...protegidas.flatMap((a) => [a.x0, a.x1])]);
  const ys = unicos([0, 1, ...protegidas.flatMap((a) => [a.y0, a.y1])]);
  const dentro = (cx: number, cy: number) => protegidas.some((a) => cx > a.x0 && cx < a.x1 && cy > a.y0 && cy < a.y1);
  type Faixa = { y0: number; y1: number; trechos: [number, number][] };
  const faixas: Faixa[] = [];
  for (let j = 0; j < ys.length - 1; j++) {
    const y0 = ys[j], y1 = ys[j + 1];
    if (y1 - y0 <= 1e-9) continue;
    const cy = (y0 + y1) / 2;
    const trechos: [number, number][] = [];
    for (let i = 0; i < xs.length - 1; i++) {
      const x0 = xs[i], x1 = xs[i + 1];
      if (x1 - x0 <= 1e-9 || dentro((x0 + x1) / 2, cy)) continue;
      const ultimo = trechos[trechos.length - 1];
      if (ultimo && Math.abs(ultimo[1] - x0) < 1e-9) ultimo[1] = x1;
      else trechos.push([x0, x1]);
    }
    const anterior = faixas[faixas.length - 1];
    if (anterior && Math.abs(anterior.y1 - y0) < 1e-9 && JSON.stringify(anterior.trechos) === JSON.stringify(trechos)) anterior.y1 = y1;
    else faixas.push({ y0, y1, trechos });
  }
  return faixas.flatMap((f) => f.trechos.map(([x0, x1]) => ({ x0, y0: f.y0, x1, y1: f.y1 })));
}

/** Tamanhos de trabalho aceitos pelo gerador (múltiplos de 16), nas proporções do OpenRouter. */
export const TAMANHOS_DE_TRABALHO = ["1024x1024", "1088x1360", "1360x1088", "1024x1536", "1536x1024", "1088x1920", "1920x1088"];

/** Tamanho de trabalho de proporção mais próxima da foto (recorte mínimo). */
export function tamanhoDeTrabalho(largura: number | null | undefined, altura: number | null | undefined): string {
  if (!largura || !altura || largura <= 0 || altura <= 0) return "1024x1024";
  const alvo = largura / altura;
  let melhor = TAMANHOS_DE_TRABALHO[0];
  let dif = Infinity;
  for (const t of TAMANHOS_DE_TRABALHO) {
    const [l, a] = t.split("x").map(Number);
    const d = Math.abs(Math.log(l / a / alvo));
    if (d < dif) { dif = d; melhor = t; }
  }
  return melhor;
}

// ------------------------------------------------------------ kit

/**
 * Produto identificado pela embalagem ou foto e confirmado (ou não) na
 * internet por produto_identificar. Fica em foto_kits.atributos.identificacao.
 */
export type Identificacao = {
  marca: string | null;
  modelo: string | null;
  variante: string | null;
  categoria: string | null;
  especificacoes: string[];
  confianca: "alta" | "media" | "baixa";
  evidencias: string[];
  paginas: { url: string; fonte: string | null }[];
  identificado_em: string | null;
};

export const CONFIANCAS = ["alta", "media", "baixa"] as const;

export function normalizarIdentificacao(bruto: unknown): Identificacao | null {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return null;
  const r = bruto as Record<string, unknown>;
  const marca = limpoOuNulo(r.marca, 120);
  const modelo = limpoOuNulo(r.modelo, 160);
  if (!marca && !modelo) return null;
  const confianca = (CONFIANCAS as readonly string[]).includes(String(r.confianca)) ? (r.confianca as Identificacao["confianca"]) : "baixa";
  const paginas: Identificacao["paginas"] = [];
  for (const p of Array.isArray(r.paginas) ? r.paginas : []) {
    const o = (p && typeof p === "object" ? p : { url: p }) as Record<string, unknown>;
    const u = urlPublicaSegura(o.url);
    if (u && !paginas.some((x) => x.url === u.toString())) paginas.push({ url: u.toString(), fonte: limpoOuNulo(o.fonte, 120) ?? u.hostname });
    if (paginas.length >= 8) break;
  }
  return {
    marca,
    modelo,
    variante: limpoOuNulo(r.variante, 120),
    categoria: limpoOuNulo(r.categoria, 120),
    especificacoes: listaDeTextos(r.especificacoes, 20, 200),
    confianca,
    evidencias: listaDeTextos(r.evidencias, 12, 300),
    paginas,
    identificado_em: typeof r.identificado_em === "string" ? r.identificado_em.slice(0, 40) : null,
  };
}

export type Atributos = { observado: string[]; informado: string[]; inferido: string[]; identificacao?: Identificacao };

export type Autorizacao = {
  confirmada: boolean;
  /** Quem autorizou (a própria pessoa ou o responsável), como a tela registra. */
  quem: string | null;
  /** Data da autorização (AAAA-MM-DD). */
  data: string | null;
  finalidade: string | null;
  escopo: string | null;
  validade: string | null;
  observacao: string | null;
  registrada_por?: string | null;
  registrada_em?: string | null;
};

export type StatusKit = "rascunho" | "confirmado" | "arquivado";
export const STATUS_KIT: StatusKit[] = ["rascunho", "confirmado", "arquivado"];

export type KitFoto = {
  id?: string;
  client_id?: string;
  tipo: TipoKit;
  nome: string;
  variante: string | null;
  atributos: Atributos;
  invariantes: string[];
  lacunas: string[];
  autorizacao: Autorizacao | null;
  frente_imagem_id: string | null;
  status: StatusKit;
};

export type RefDoKit = {
  imagem_id: string;
  papel: PapelRef;
  vista: string | null;
  prioridade: number;
  /** Do acervo (quando a função junta). */
  gerada?: boolean;
  aprovada?: boolean;
  nome?: string | null;
  descricao?: string | null;
  /** Foto baixada da internet por produto_identificar (uso interno, não publicar). */
  origem_web?: OrigemWeb | null;
};

// ------------------------------------------------------------ referência da internet

/** De onde veio uma referência da internet: a imagem, a página e o site. */
export type OrigemWeb = { url: string; pagina: string | null; fonte: string };

export const TAG_REFERENCIA_WEB = "referencia_web";
export const AVISO_REFERENCIA_WEB = "Referência da internet, uso interno para fidelidade, não publicar.";

/** Descrição gravada em cliente_imagens.descricao (legível e relida por lerOrigemWeb). */
export function descricaoDaReferenciaWeb(o: OrigemWeb, produto?: string | null): string {
  return semTravessao([
    AVISO_REFERENCIA_WEB,
    produto ? `Produto: ${limpo(produto, 200)}.` : "",
    `Fonte: ${limpo(o.fonte, 120)}.`,
    o.pagina ? `Página: ${o.pagina}` : "",
    `Imagem: ${o.url}`,
  ].filter(Boolean).join("\n")).slice(0, 1000);
}

/** Origem de uma imagem do acervo marcada como referência da internet (ou null). */
export function lerOrigemWeb(tags: string[] | null | undefined, descricao: string | null | undefined): OrigemWeb | null {
  if (!(tags ?? []).includes(TAG_REFERENCIA_WEB)) return null;
  const d = descricao ?? "";
  const campo = (nome: string) => d.match(new RegExp(`^${nome}: (.+)$`, "m"))?.[1]?.trim() ?? null;
  const url = urlPublicaSegura(campo("Imagem"))?.toString() ?? "";
  const pagina = urlPublicaSegura(campo("Página"))?.toString() ?? null;
  const fonteTag = (tags ?? []).find((t) => t.startsWith("fonte:"))?.slice(6) ?? null;
  const fonte = (campo("Fonte") ?? fonteTag ?? "internet").replace(/\.$/, "");
  return { url, pagina, fonte };
}

/**
 * Endereços de imagem de produto numa página (og:image, twitter:image,
 * image_src e o campo image do JSON-LD), absolutos e só https público.
 */
export function imagensDoHtml(html: string, base: string, max = 8): string[] {
  const saida: string[] = [];
  const pegar = (bruto: unknown) => {
    if (typeof bruto !== "string" || !bruto.trim()) return;
    let abs: string;
    try {
      abs = new URL(bruto.trim().replace(/&amp;/g, "&"), base).toString();
    } catch {
      return;
    }
    const u = urlPublicaSegura(abs);
    if (u && !saida.includes(u.toString())) saida.push(u.toString());
  };
  const trecho = html.slice(0, 600_000);
  const meta = /<meta\b[^>]*>/gi;
  for (const [tag] of trecho.matchAll(meta)) {
    const nome = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? "";
    if (!["og:image", "og:image:secure_url", "og:image:url", "twitter:image", "twitter:image:src"].includes(nome)) continue;
    pegar(tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1]);
  }
  for (const [tag] of trecho.matchAll(/<link\b[^>]*>/gi)) {
    if (/\brel\s*=\s*["']image_src["']/i.test(tag)) pegar(tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1]);
  }
  const blocos = trecho.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  const visitar = (v: unknown, fundo: number) => {
    if (fundo > 6 || saida.length >= max) return;
    if (Array.isArray(v)) return v.forEach((x) => visitar(x, fundo + 1));
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    const img = o.image;
    if (typeof img === "string") pegar(img);
    else if (Array.isArray(img)) img.forEach((x) => (typeof x === "string" ? pegar(x) : visitar(x, fundo + 1)));
    else if (img && typeof img === "object") pegar((img as Record<string, unknown>).url ?? (img as Record<string, unknown>).contentUrl);
    for (const chave of ["@graph", "offers", "mainEntity", "itemListElement"]) if (o[chave]) visitar(o[chave], fundo + 1);
  };
  for (const [, conteudo] of blocos) {
    try {
      visitar(JSON.parse(conteudo.trim()), 0);
    } catch { /* JSON-LD quebrado */ }
  }
  return saida.slice(0, max);
}

/** Imagem de referência pequena demais (ícone, miniatura, logotipo) não serve. */
export const LADO_MINIMO_REFERENCIA_WEB = 400;
export const referenciaWebServe = (d: { largura: number; altura: number } | null) =>
  !!d && Math.min(d.largura, d.altura) >= LADO_MINIMO_REFERENCIA_WEB && Math.max(d.largura, d.altura) / Math.min(d.largura, d.altura) <= 3.2;

// ------------------------------------------------------------ kit rascunho sem duplicar

/** Chave do produto para achar o mesmo kit: nome e variante normalizados. */
export const chaveDoProduto = (k: { nome: string; variante?: string | null }) => `${nomeSeguro(k.nome)}|${k.variante ? nomeSeguro(k.variante) : ""}`;

export type KitExistente = { id: string; status: string; nome: string; variante: string | null; atualizado_em?: string; refs: { imagem_id: string; papel: string }[] };

/**
 * Kit rascunho do mesmo produto (mesmo nome e variante, ou alguma foto de
 * evidência em comum). Kit confirmado ou arquivado nunca é reaproveitado.
 */
export function kitParecido(existentes: KitExistente[], novo: { nome: string; variante: string | null; refs: { imagem_id: string; papel: string }[] }): KitExistente | null {
  const evid = new Set(novo.refs.filter((r) => PAPEIS_DE_EVIDENCIA.includes(r.papel as PapelRef)).map((r) => r.imagem_id));
  const chave = chaveDoProduto(novo);
  const rascunhos = existentes.filter((k) => k.status === "rascunho")
    .slice().sort((a, b) => String(b.atualizado_em ?? "").localeCompare(String(a.atualizado_em ?? "")));
  return rascunhos.find((k) => chaveDoProduto(k) === chave) ??
    rascunhos.find((k) => k.refs.some((r) => evid.has(r.imagem_id) && PAPEIS_DE_EVIDENCIA.includes(r.papel as PapelRef))) ??
    null;
}

export const LACUNA_SO_CAIXA = "Falta foto do produto fora da embalagem: a caixa sozinha não documenta o formato do produto.";
export const LACUNA_SO_WEB = "O produto fora da caixa está documentado só por referências da internet (uso interno, não publicar): confirme com o cliente modelo e variante.";

/**
 * Junta o kit rascunho existente com o novo: referências somadas, o que a
 * equipe informou fica, observado, inferido e invariantes somados, lacunas
 * refeitas pelo que o kit tem agora.
 */
export function mesclarKit(
  existente: KitFoto & { refs: RefDoKit[] },
  novo: KitFoto & { refs: RefDoKit[] },
  opcoes: { preferirNomeNovo?: boolean; refsWeb?: string[] } = {},
): KitFoto & { refs: RefDoKit[] } {
  const refs: RefDoKit[] = [];
  for (const r of [...existente.refs, ...novo.refs]) {
    if (!refs.some((x) => x.imagem_id === r.imagem_id && x.papel === r.papel)) refs.push(r);
  }
  const unir = (a: string[], b: string[], max: number) => Array.from(new Set([...a, ...b])).slice(0, max);
  const identificacao = novo.atributos.identificacao ?? existente.atributos.identificacao;
  const kit: KitFoto & { refs: RefDoKit[] } = {
    ...existente,
    tipo: novo.tipo,
    nome: opcoes.preferirNomeNovo ? novo.nome : existente.nome,
    variante: opcoes.preferirNomeNovo ? novo.variante ?? existente.variante : existente.variante ?? novo.variante,
    atributos: {
      observado: unir(existente.atributos.observado, novo.atributos.observado, 30),
      informado: existente.atributos.informado,
      inferido: unir(existente.atributos.inferido, novo.atributos.inferido, 30),
      ...(identificacao ? { identificacao } : {}),
    },
    invariantes: unir(existente.invariantes, novo.invariantes, 20),
    lacunas: unir(novo.lacunas, existente.lacunas.filter((l) => l !== LACUNA_SO_CAIXA && l !== LACUNA_SO_WEB), 20),
    status: "rascunho",
    refs,
  };
  kit.lacunas = lacunasDaEvidencia(kit, refs, opcoes.refsWeb ?? []);
  return kit;
}

/** Lacunas de evidência refeitas: só caixa, ou produto documentado só pela internet. */
export function lacunasDaEvidencia(kit: Pick<KitFoto, "tipo" | "lacunas">, refs: RefDoKit[], refsWeb: string[]): string[] {
  const outras = kit.lacunas.filter((l) => l !== LACUNA_SO_CAIXA && l !== LACUNA_SO_WEB && !/fora da embalagem|caixa sozinha/i.test(l));
  if (kit.tipo === "pessoa") return outras.slice(0, 20);
  const identidades = refs.filter((r) => r.papel === "identidade");
  const extra: string[] = [];
  if (!identidades.length && refs.some((r) => r.papel === "embalagem")) extra.push(LACUNA_SO_CAIXA);
  else if (identidades.length && identidades.every((r) => refsWeb.includes(r.imagem_id) || !!r.origem_web)) extra.push(LACUNA_SO_WEB);
  return [...extra, ...outras].slice(0, 20);
}

function lerAutorizacao(v: unknown): Autorizacao | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const data = typeof r.data === "string" && /^\d{4}-\d{2}-\d{2}/.test(r.data) ? r.data.slice(0, 10) : null;
  return {
    confirmada: r.confirmada === true,
    quem: limpoOuNulo(r.quem, 200),
    data,
    finalidade: limpoOuNulo(r.finalidade, 500),
    escopo: limpoOuNulo(r.escopo, 500),
    validade: typeof r.validade === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.validade) ? r.validade : null,
    observacao: limpoOuNulo(r.observacao, 1000),
    registrada_por: typeof r.registrada_por === "string" && UUID.test(r.registrada_por) ? r.registrada_por : null,
    registrada_em: typeof r.registrada_em === "string" ? r.registrada_em.slice(0, 40) : null,
  };
}

/** Kit vindo da tela, validado. Erro de regra quando falta o essencial. */
export function normalizarKit(bruto: unknown): KitFoto {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) throw new ErroDeRegra(400, "kit_invalido", "Envie o kit como objeto.");
  const r = bruto as Record<string, unknown>;
  const tipo = String(r.tipo ?? "") as TipoKit;
  if (!TIPOS_DE_KIT.includes(tipo)) throw new ErroDeRegra(400, "tipo_invalido", `Tipo de kit inválido. Use: ${TIPOS_DE_KIT.join(", ")}.`);
  const nome = limpo(r.nome, 120);
  if (!nome) throw new ErroDeRegra(400, "nome_obrigatorio", "Dê um nome ao kit (produto, pessoa ou prato).");
  const at = (r.atributos && typeof r.atributos === "object" ? r.atributos : {}) as Record<string, unknown>;
  const status = STATUS_KIT.includes(r.status as StatusKit) ? (r.status as StatusKit) : "rascunho";
  const frente = typeof r.frente_imagem_id === "string" && UUID.test(r.frente_imagem_id) ? r.frente_imagem_id : null;
  const identificacao = normalizarIdentificacao(at.identificacao);
  return {
    ...(typeof r.id === "string" && UUID.test(r.id) ? { id: r.id } : {}),
    tipo,
    nome,
    variante: limpoOuNulo(r.variante, 120),
    atributos: {
      observado: listaDeTextos(at.observado, 30, 300),
      informado: listaDeTextos(at.informado, 30, 300),
      inferido: listaDeTextos(at.inferido, 30, 300),
      ...(identificacao ? { identificacao } : {}),
    },
    invariantes: listaDeTextos(r.invariantes, 20, 200),
    lacunas: listaDeTextos(r.lacunas, 20, 300),
    autorizacao: tipo === "pessoa" ? lerAutorizacao(r.autorizacao) : null,
    frente_imagem_id: frente,
    status,
  };
}

/** Referências do kit vindas da tela: papel e vista conhecidos, sem repetir (imagem, papel). */
export function normalizarRefs(bruto: unknown, max = 40): RefDoKit[] {
  if (!Array.isArray(bruto)) return [];
  const saida: RefDoKit[] = [];
  const vistas = new Set(NOMES_DAS_VISTAS);
  for (const item of bruto) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const imagem = String(r.imagem_id ?? "");
    const papel = String(r.papel ?? "") as PapelRef;
    if (!UUID.test(imagem)) throw new ErroDeRegra(400, "referencia_invalida", "Cada referência precisa de imagem_id.");
    if (!PAPEIS.includes(papel)) throw new ErroDeRegra(400, "papel_invalido", `Papel inválido. Use: ${PAPEIS.join(", ")}.`);
    if (saida.some((s) => s.imagem_id === imagem && s.papel === papel)) continue;
    const prioridade = Number(r.prioridade);
    saida.push({
      imagem_id: imagem,
      papel,
      vista: typeof r.vista === "string" && vistas.has(r.vista) ? r.vista : null,
      prioridade: Number.isFinite(prioridade) ? Math.max(0, Math.min(1000, Math.round(prioridade))) : 100,
    });
    if (saida.length >= max) break;
  }
  return saida;
}

export type ImagemDoAcervo = { id: string; client_id: string; gerada: boolean | null; aprovada: boolean | null };

/**
 * Referências conferidas contra o acervo: toda imagem do mesmo cliente e
 * nenhuma imagem gerada sem aprovação no papel de evidência (regra: imagem
 * gerada não vira referência de identidade sem aprovação).
 */
export function conferirRefs(refs: RefDoKit[], clientId: string, imagens: ImagemDoAcervo[]): void {
  const porId = new Map(imagens.map((i) => [i.id, i]));
  const fora = refs.filter((r) => porId.get(r.imagem_id)?.client_id !== clientId).map((r) => r.imagem_id);
  if (fora.length) throw new ErroDeRegra(404, "imagem_fora_do_cliente", "Há referência que não está no acervo deste cliente.", { imagem_ids: fora });
  const geradas = refs
    .filter((r) => PAPEIS_DE_EVIDENCIA.includes(r.papel))
    .filter((r) => porId.get(r.imagem_id)?.gerada === true && porId.get(r.imagem_id)?.aprovada !== true)
    .map((r) => r.imagem_id);
  if (geradas.length) {
    throw new ErroDeRegra(409, "gerada_sem_aprovacao", "Imagem gerada só vira evidência do kit depois de aprovada. Use como estilo ou cenário, ou aprove antes.", {
      imagem_ids: geradas,
    });
  }
}

/** Autorização de uso de imagem da pessoa confirmada no kit. */
export const autorizacaoConfirmada = (kit: Pick<KitFoto, "tipo" | "autorizacao">) =>
  kit.tipo !== "pessoa" || kit.autorizacao?.confirmada === true;

const PAPEIS_DE_IDENTIDADE = (tipo: TipoKit): PapelRef[] => (tipo === "pessoa" ? ["rosto", "identidade"] : ["identidade"]);

/** Tem pelo menos uma foto que documenta o assunto (identidade; rosto para pessoa). */
export const temIdentidade = (kit: Pick<KitFoto, "tipo">, refs: RefDoKit[]) =>
  refs.some((r) => PAPEIS_DE_IDENTIDADE(kit.tipo).includes(r.papel));

/** Medida real informada pelo cliente (para a tomada de escala). */
export const temMedidaInformada = (kit: Pick<KitFoto, "atributos">) =>
  kit.atributos.informado.some((a) => /(medida|dimens|tamanho|altura|largura|comprimento|\d\s?(cm|mm|m)\b|ml\b|litro)/i.test(a));

/** Motivo do bloqueio de uma tomada (evidência ausente) ou null quando pode gerar. */
export function motivoDoBloqueio(kit: KitFoto, refs: RefDoKit[], exige?: Exigencia | null, foco?: Foco | null): string | null {
  if (kit.status === "arquivado") return "O kit está arquivado.";
  if (!autorizacaoConfirmada(kit)) return "Pessoa sem autorização de uso registrada no kit.";
  if (foco === "embalagem") {
    // A caixa é o assunto: basta a foto real dela.
    if (!refs.some((r) => r.papel === "embalagem")) return "Falta uma foto real da embalagem no kit.";
  } else if (!temIdentidade(kit, refs)) {
    if (kit.tipo === "pessoa") return "Falta foto real do rosto da pessoa no kit (papel rosto ou identidade).";
    return foco === "fora_da_embalagem"
      ? "Falta foto do produto fora da caixa. Use Identificar produto (busca as fotos oficiais na internet) ou suba uma foto real do produto. Embalagem sozinha não documenta o produto."
      : "Falta a foto de identidade do assunto no kit. Embalagem sozinha não documenta o produto: identifique o produto pela embalagem (busca as fotos oficiais na internet) ou faça a foto com a embalagem como assunto.";
  }
  if (exige?.papeis?.length && !refs.some((r) => exige.papeis!.includes(r.papel))) return `Falta ${exige.descricao} no kit.`;
  if (exige?.informado === "medida" && !temMedidaInformada(kit)) return `Falta ${exige.descricao}.`;
  return null;
}

const distanciaAngular = (a: number, b: number) => {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.min(d, 360 - d);
};

/**
 * Modo da tomada pela câmera: a vista pedida foi documentada por alguma foto
 * de evidência do kit (mesmo lado, até 22 graus, e altura parecida) ou é um
 * novo ângulo (gera partes não vistas, marcado como gerado).
 */
export function modoDaCamera(camera: Camera, refs: RefDoKit[]): Extract<ModoTomada, "cenario" | "angulo"> {
  // Embalagem não documenta a vista do produto (a caixa não é o objeto).
  const evidencia = refs.filter((r) => PAPEIS_DE_EVIDENCIA.includes(r.papel) && r.papel !== "embalagem");
  // Detalhe: vale a foto de detalhe (ou rótulo) do kit.
  if (camera.enquadramento === "detalhe" && evidencia.some((r) => r.papel === "detalhe" || r.papel === "rotulo" || r.vista === "detalhe")) {
    return "cenario";
  }
  for (const r of evidencia) {
    const v = r.vista ? VISTAS[r.vista] : null;
    // Sem vista marcada, a foto de identidade conta como a frente do kit.
    const az = v ? v.azimute : r.papel === "identidade" || r.papel === "rosto" ? 0 : null;
    const el = v ? v.elevacao : 0;
    if (camera.elevacao >= 75) {
      if (el != null && el >= 60) return "cenario";
      continue;
    }
    if (az == null) continue;
    if (distanciaAngular(camera.azimute, az) <= 22 && Math.abs(camera.elevacao - (el ?? 0)) < 45) return "cenario";
  }
  return "angulo";
}

/** Câmera da tela ou do diretor: preset conhecido ou posição própria dentro dos limites. */
export function lerCamera(bruto: unknown): Camera | null {
  if (typeof bruto === "string") return presetPorId(bruto) ? cameraDoPreset(bruto) : null;
  if (!bruto || typeof bruto !== "object") return null;
  const r = bruto as Record<string, unknown>;
  if (typeof r.preset_id === "string" && presetPorId(r.preset_id)) return cameraDoPreset(r.preset_id);
  const az = Number(r.azimute), el = Number(r.elevacao);
  const enq = String(r.enquadramento ?? "") as Enquadramento;
  if (!Number.isFinite(az) || !Number.isFinite(el) || !ENQUADRAMENTOS.includes(enq)) return null;
  const azimute = ((Math.round(az) % 360) + 360) % 360;
  const elevacao = Math.max(-30, Math.min(90, Math.round(el)));
  const id = idDoPreset(azimute, elevacao, enq);
  return { azimute, elevacao, enquadramento: enq, preset_id: presetPorId(id) ? id : null };
}

// ------------------------------------------------------------ tomadas

export type Conferencia = {
  pontos: { criterio: string; ok: boolean | null; nota: string }[];
  alertas: string[];
  resumo: string;
  /** Noul do Jev: probabilidade de divergência crítica (Noul não tem confiança separada). */
  jev: { divergencia_critica: number | null; aviso: boolean } | { erro: string } | null;
  modelo_id: string | null;
  conferida_em: string;
  custo_usd: number;
};

export type VersaoTomada = {
  versao: number;
  imagem_id: string | null;
  storage_path: string;
  custo_usd: number;
  conferencia: Conferencia | { pendente: true };
  /** null = sem decisão; true aprovada (travada); false rejeitada. */
  aprovada: boolean | null;
  /** O mesmo em palavras, como a tela lê. */
  decisao: "aprovada" | "rejeitada" | null;
  motivo_rejeicao: string | null;
  criado_em: string;
  criado_por: string | null;
  gerada: true;
  modo: ModoTomada;
  camera: Camera;
  formato: Formato;
  tamanho: string | null;
  fontes: string[];
  guia: Guia | null;
  modelo_id: string | null;
  qualidade: string | null;
  prompt: string;
  uso_ids: string[];
  reserva_usada: string | null;
  travada: boolean;
  decidida_por: string | null;
  decidida_em: string | null;
};

/** gerando e falhou são gravados pela função em volta da chamada ao gerador. */
export type StatusTomada = "pendente" | "bloqueada" | "gerando" | "gerada" | "aprovada" | "rejeitada" | "falhou";

export type Tomada = {
  id: string;
  nome: string;
  objetivo: string;
  receita_tomada_id: string | null;
  camera: Camera;
  cenario: string;
  luz: string;
  lente: string;
  modo: ModoTomada;
  /** Toda tomada do ensaio sai do gerador (imagem sintética derivada). */
  gerado: true;
  /** Vista não documentada no kit: partes geradas, sem garantia de fidelidade. */
  angulo_novo: boolean;
  pode_mudar: string[];
  invariantes: string[];
  proibicoes: string[];
  formato: Formato;
  espaco_para_texto: boolean;
  exige: Exigencia | null;
  status: StatusTomada;
  bloqueada: boolean;
  motivo_bloqueio: string | null;
  /** Última falha do gerador nesta tomada (status falhou). */
  ultimo_erro: string | null;
  observacao: string | null;
  versoes: VersaoTomada[];
  /** v2: assunto da foto (produto, embalagem ou produto fora da embalagem). */
  foco?: Foco;
  /** v2: tipo de variação (TIPOS_DE_VARIACAO) quando a tomada segue um. */
  tipo_variacao?: string | null;
  /** v2: objetos de cena pedidos (direção de arte). */
  props?: string[];
  /** v2: o que muda quando o tipo se repete no lote. */
  mudanca?: string | null;
  /** v2: cena de campanha com pessoa sintética (receita campanha-com-modelo). */
  campanha?: CenaDeCampanha | null;
};

/** Cena de campanha: o que a pessoa sintética faz com o produto. */
export type CenaDeCampanha = {
  com_pessoa: boolean;
  acao: string;
  expressao: string;
  figurino: string;
};

export function lerCenaDeCampanha(bruto: unknown): CenaDeCampanha | null {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return null;
  const r = bruto as Record<string, unknown>;
  return {
    com_pessoa: r.com_pessoa !== false,
    acao: limpo(r.acao, 400),
    expressao: limpo(r.expressao, 200),
    figurino: limpo(r.figurino, 300),
  };
}

const focoValido = (v: unknown): Foco | undefined => (FOCOS.includes(v as Foco) ? (v as Foco) : undefined);

/** Invariantes fixas por grupo, antes das invariantes escritas no kit. */
export function invariantesDoKit(kit: KitFoto): string[] {
  const grupos = gruposDoTipo(kit.tipo);
  const fixas: string[] = [];
  if (grupos.includes("produto")) {
    fixas.push(
      `mesmo produto (${kit.nome}${kit.variante ? `, variante ${kit.variante}` : ""})`,
      "mesma cor e mesmo material",
      "mesmo texto do rótulo, letra por letra, na mesma posição",
      "mesma quantidade de botões, portas e peças",
      "mesmas proporções",
    );
  }
  if (grupos.includes("pessoa")) {
    fixas.push("mesma pessoa, mesmo rosto", "mesma idade aparente e mesmo tom de pele", "mesmo corpo e mesmas proporções", "mesmo cabelo, óculos e acessórios");
  }
  if (grupos.includes("alimento")) {
    fixas.push("mesmos ingredientes", "mesma porção", "mesmo ponto de preparo e mesma montagem", "mesmo recipiente");
  }
  return [...fixas, ...kit.invariantes.filter((i) => !fixas.includes(i))].slice(0, 24);
}

/** Invariantes quando a caixa é o assunto: a arte da embalagem não muda. */
export const INVARIANTES_DA_EMBALAGEM = [
  "mesma embalagem real: arte, cores, textos e logotipos idênticos, letra por letra, na mesma posição",
  "mesmas proporções e o mesmo formato da caixa",
  "caixa fechada, sem inventar o produto de dentro",
];

export const invariantesDaTomada = (kit: KitFoto, foco?: Foco | null): string[] =>
  foco === "embalagem" ? [`embalagem de ${kit.nome}${kit.variante ? ` (variante ${kit.variante})` : ""}`, ...INVARIANTES_DA_EMBALAGEM] : invariantesDoKit(kit);

export const proibicoesDoKit = (kit: KitFoto): string[] =>
  [...gruposDoTipo(kit.tipo).flatMap((g) => PROIBICOES[g]), ...PROIBICOES_GERAIS];

/** Proibições da tomada: as do kit e, quando aparece pessoa (mão ou campanha), as da pessoa sintética. */
export function proibicoesDaTomada(kit: KitFoto, t: { campanha?: CenaDeCampanha | null; tipo_variacao?: string | null; foco?: Foco | null }): string[] {
  const base = proibicoesDoKit(kit);
  const extra: string[] = [];
  if (t.foco === "fora_da_embalagem") extra.push("não desenhar o produto a partir da arte impressa na caixa; a caixa não aparece");
  const comPessoa = !!t.campanha?.com_pessoa || !!tipoDeVariacaoPorId(t.tipo_variacao)?.com_maos;
  if (comPessoa && kit.tipo !== "pessoa") extra.push(...PROIBICOES_PESSOA_SINTETICA);
  const flutua = !!tipoDeVariacaoPorId(t.tipo_variacao)?.flutuando;
  return [...base, ...extra].filter((p) => !(flutua && /flutuando/.test(p)));
}

export const formatoValido = (v: unknown): Formato | null => (FORMATOS as readonly string[]).includes(String(v)) ? (v as Formato) : null;

/** Formatos pedidos pela tela (ao menos um; padrão 4:5). */
export function lerFormatos(v: unknown): Formato[] {
  const lista = Array.isArray(v) ? v.map(formatoValido).filter((f): f is Formato => !!f) : [];
  const unicos = Array.from(new Set(lista));
  return unicos.length ? unicos : ["4:5"];
}

type BaseTomada = {
  id: string;
  nome: string;
  objetivo?: string | null;
  receita_tomada_id?: string | null;
  camera: Camera;
  cenario?: string | null;
  luz?: string | null;
  pode_mudar?: string[];
  formato?: Formato | null;
  espaco_para_texto?: boolean;
  exige?: Exigencia | null;
  observacao?: string | null;
  versoes?: VersaoTomada[];
  foco?: Foco | null;
  tipo_variacao?: string | null;
  props?: string[];
  mudanca?: string | null;
  campanha?: CenaDeCampanha | null;
};

/**
 * Modo da tomada: pela câmera, contra as fotos de evidência. Com a caixa como
 * assunto, a embalagem é a evidência; na campanha o produto é refeito pelo
 * gerador na orientação que a cena pedir (modo cenário, dito na promessa).
 */
export function modoDaTomada(camera: Camera, refs: RefDoKit[], foco?: Foco | null, campanha?: CenaDeCampanha | null): Extract<ModoTomada, "cenario" | "angulo"> {
  if (campanha) return "cenario";
  if (foco === "embalagem") return modoDaCamera(camera, refs.filter((r) => r.papel === "embalagem").map((r) => ({ ...r, papel: "identidade" as PapelRef })));
  return modoDaCamera(camera, refs);
}

/** Monta a tomada completa: modo pela câmera, bloqueio pela evidência, lente, invariantes e proibições do kit. */
export function montarTomada(base: BaseTomada, ctx: { kit: KitFoto; refs: RefDoKit[]; receita: Receita | null; formatos: Formato[] }): Tomada {
  const foco = focoValido(base.foco);
  const campanha = base.campanha ?? null;
  const modo = modoDaTomada(base.camera, ctx.refs, foco, campanha);
  const bloqueio = motivoDoBloqueio(ctx.kit, ctx.refs, base.exige ?? null, foco);
  const versoes = base.versoes ?? [];
  const tipoVar = tipoDeVariacaoPorId(base.tipo_variacao);
  const t: Tomada = {
    id: base.id,
    nome: limpo(base.nome, 120) || "Tomada",
    objetivo: limpo(base.objetivo, 400),
    receita_tomada_id: base.receita_tomada_id ?? null,
    camera: base.camera,
    cenario: limpo(base.cenario, 800) || tipoVar?.cenario || ctx.receita?.cenario || "Cenário neutro de estúdio.",
    luz: limpo(base.luz, 800) || tipoVar?.luz || ctx.receita?.luz || "Luz suave de estúdio com chave, preenchimento e recorte.",
    // Na campanha com pessoa a lente é de retrato (a pessoa define o quadro).
    lente: lenteDaTomada(campanha?.com_pessoa ? "pessoa" : ctx.kit.tipo, base.camera),
    modo,
    gerado: true,
    angulo_novo: modo === "angulo",
    pode_mudar: (base.pode_mudar ?? []).slice(0, 12),
    invariantes: invariantesDaTomada(ctx.kit, foco),
    proibicoes: proibicoesDaTomada(ctx.kit, { campanha, tipo_variacao: base.tipo_variacao, foco }),
    formato: base.formato && ctx.formatos.includes(base.formato) ? base.formato : ctx.formatos[0],
    espaco_para_texto: base.espaco_para_texto === true,
    exige: base.exige ?? null,
    status: "pendente",
    bloqueada: !!bloqueio,
    motivo_bloqueio: bloqueio,
    ultimo_erro: null,
    observacao: limpoOuNulo(base.observacao, 600),
    versoes,
    foco: foco ?? "produto",
    tipo_variacao: tipoVar?.id ?? null,
    props: listaDeTextos(base.props, 8, 160),
    mudanca: limpoOuNulo(base.mudanca, 300),
    campanha,
  };
  t.status = statusDaTomada(t);
  return t;
}

/** Os campos v2 de uma tomada salva, para remontar (tomada_gerar, ajuste). */
export const camposV2 = (t: Partial<Tomada>): Pick<BaseTomada, "foco" | "tipo_variacao" | "props" | "mudanca" | "campanha"> => ({
  foco: t.foco ?? null,
  tipo_variacao: t.tipo_variacao ?? null,
  props: t.props ?? [],
  mudanca: t.mudanca ?? null,
  campanha: t.campanha ?? null,
});

/** Status da tomada pelas versões e pelo bloqueio. */
export function statusDaTomada(t: Pick<Tomada, "motivo_bloqueio" | "versoes">): StatusTomada {
  if (t.versoes.some((v) => v.aprovada === true)) return "aprovada";
  if (t.versoes.length) return t.versoes[t.versoes.length - 1].aprovada === false ? "rejeitada" : "gerada";
  return t.motivo_bloqueio ? "bloqueada" : "pendente";
}

export type StatusEnsaio = "planejado" | "em_producao" | "concluido" | "arquivado";

export function statusDoEnsaio(tomadas: Tomada[], atual?: string | null): StatusEnsaio {
  if (atual === "arquivado") return "arquivado";
  const geraveis = tomadas.filter((t) => !(t.motivo_bloqueio && !t.versoes.length));
  if (geraveis.length && geraveis.every((t) => t.versoes.some((v) => v.aprovada === true))) return "concluido";
  if (tomadas.some((t) => t.versoes.length)) return "em_producao";
  return "planejado";
}

/** Tomada planejada pelo diretor, validada contra a receita e os presets. */
export type TomadaDoDiretor = {
  receita_tomada_id: string | null;
  nome: string;
  objetivo: string;
  preset_id: string | null;
  cenario: string;
  luz: string;
  pode_mudar: string[];
  formato: string | null;
  observacao: string | null;
  props?: string[];
};

/** Campos v2 que a tomada da receita carrega para a tomada do ensaio. */
const doReceita = (t: TomadaDaReceita | null): Pick<BaseTomada, "foco" | "tipo_variacao" | "campanha"> => ({
  foco: t?.foco ?? null,
  tipo_variacao: t?.tipo_variacao ?? null,
  campanha: t && t.com_pessoa !== undefined ? { com_pessoa: t.com_pessoa, acao: "", expressao: "", figurino: "" } : null,
});

/**
 * Tomadas do ensaio: as do diretor (validadas) e, se ele não devolveu nada
 * aproveitável, as da receita. Câmera de preset desconhecido cai na câmera da
 * tomada da receita; o modo e o bloqueio são sempre decididos aqui, no código.
 */
export function montarTomadas(
  receita: Receita,
  doDiretor: TomadaDoDiretor[],
  ctx: { kit: KitFoto; refs: RefDoKit[]; formatos: Formato[] },
  max = 12,
): Tomada[] {
  const porId = new Map(receita.tomadas.map((t) => [t.id, t]));
  const base: BaseTomada[] = [];
  const usadas = new Set<string>();
  for (const d of doDiretor.slice(0, max)) {
    const daReceita = d.receita_tomada_id ? porId.get(d.receita_tomada_id) ?? null : null;
    const camera = (d.preset_id && presetPorId(d.preset_id) ? cameraDoPreset(d.preset_id) : null) ?? daReceita?.camera ?? cameraDoPreset("a0-e0-dmedio");
    const raiz = daReceita?.id ?? (nomeSeguro(d.nome || "tomada").slice(0, 30) || "tomada");
    let id = raiz;
    for (let n = 2; usadas.has(id); n++) id = `${raiz}-${n}`;
    usadas.add(id);
    base.push({
      id,
      nome: d.nome || daReceita?.nome || "Tomada",
      objetivo: d.objetivo || daReceita?.objetivo || "",
      receita_tomada_id: daReceita?.id ?? null,
      camera,
      cenario: d.cenario,
      luz: d.luz,
      pode_mudar: listaDeTextos(d.pode_mudar, 12, 200),
      formato: formatoValido(d.formato),
      espaco_para_texto: daReceita?.espaco_para_texto,
      // Tomada nova do diretor (fora da receita) não exige nada além do básico.
      exige: daReceita?.exige ?? null,
      observacao: d.observacao,
      props: d.props ?? [],
      ...doReceita(daReceita),
    });
  }
  if (!base.length) {
    for (const t of receita.tomadas.slice(0, max)) {
      base.push({ id: t.id, nome: t.nome, objetivo: t.objetivo, receita_tomada_id: t.id, camera: t.camera, espaco_para_texto: t.espaco_para_texto, exige: t.exige ?? null, ...doReceita(t) });
    }
  }
  return base.map((b) => montarTomada(b, { ...ctx, receita }));
}

// ------------------------------------------------------------ fontes

/** Grupo da fonte na ordem do contrato: identidade > detalhe > embalagem > estilo e cenário. */
export function grupoDaFonte(papel: PapelRef): number {
  if (papel === "identidade" || papel === "rosto") return 0;
  if (papel === "detalhe" || papel === "rotulo" || papel === "verso" || papel === "corpo") return 1;
  if (papel === "embalagem") return 2;
  return 3;
}

/**
 * Limite de imagens de entrada por motor e o limite prático da casa. Vem das
 * capacidades do modelo (coluna ia_modelos.capacidades, sincronizada da lista
 * de imagens do OpenRouter; sem ela, a família conhecida em
 * _shared/capacidades-imagem.ts): GPT Image 16, Gemini e Seedream 14,
 * Riverflow 10, FLUX.2 8, MAI 5, Qwen 4, Grok 3, Krea 1.
 */
export const LIMITE_PRATICO_DE_FONTES = 8;
export function limiteDeFontesDoMotor(m: {
  provedor: string;
  modelo_api: string;
  capacidades?: CapacidadesImagem | null;
  modalidades?: { entrada?: string[]; saida?: string[] } | null;
}): number {
  return limiteDeReferencias(m);
}

/**
 * Fontes da tomada, em ordem: identidade (a vista mais perto da câmera
 * primeiro), detalhe, embalagem (só quando a tomada pede embalagem) e, no
 * fim, uma referência de estilo ou cenário do kit. Pose só entra em kit de
 * pessoa e nunca como identidade.
 */
export function fontesDaTomada(refs: RefDoKit[], tomada: Pick<Tomada, "camera" | "exige"> & { foco?: Foco | null }, limite: number): RefDoKit[] {
  const caixaEAssunto = tomada.foco === "embalagem";
  // Fora da embalagem a arte da caixa nunca entra (o produto sai das fotos do produto).
  const pedeEmbalagem = caixaEAssunto || (tomada.foco !== "fora_da_embalagem" && !!tomada.exige?.papeis?.includes("embalagem"));
  const perto = (r: RefDoKit) => {
    const v = r.vista ? VISTAS[r.vista] : null;
    if (!v || v.azimute == null) return 90;
    return distanciaAngular(v.azimute, tomada.camera.azimute);
  };
  const grupo = (r: RefDoKit) => (caixaEAssunto && r.papel === "embalagem" ? -1 : grupoDaFonte(r.papel));
  // Foto real do cliente antes da referência da internet no mesmo grupo.
  const daWeb = (r: RefDoKit) => (r.origem_web ? 1 : 0);
  const candidatas = refs.filter((r) => r.papel !== "embalagem" || pedeEmbalagem);
  const ordenadas = candidatas.slice().sort((a, b) =>
    grupo(a) - grupo(b) ||
    daWeb(a) - daWeb(b) ||
    (grupo(a) <= 1 ? perto(a) - perto(b) : 0) ||
    a.prioridade - b.prioridade
  );
  const evidencia = ordenadas.filter((r) => grupoDaFonte(r.papel) <= 2);
  const estilo = ordenadas.filter((r) => grupoDaFonte(r.papel) === 3).slice(0, 1);
  const vistos = new Set<string>();
  const saida: RefDoKit[] = [];
  for (const r of [...evidencia, ...estilo]) {
    if (vistos.has(r.imagem_id)) continue;
    vistos.add(r.imagem_id);
    saida.push(r);
    if (saida.length >= limite) break;
  }
  return saida;
}

const ROTULO_DO_PAPEL: Record<PapelRef, string> = {
  identidade: "IDENTIDADE do assunto (a verdade sobre forma, cor e texto)",
  rosto: "IDENTIDADE: rosto real da pessoa",
  detalhe: "DETALHE real do assunto",
  rotulo: "RÓTULO real (texto a manter igual)",
  verso: "VERSO real do assunto",
  corpo: "CORPO real da pessoa (proporções)",
  embalagem: "EMBALAGEM real (não é o produto; só entra na cena quando a tomada pede)",
  pose: "SÓ POSE: não copie o rosto nem o corpo desta pessoa",
  estilo: "SÓ ESTILO (luz, composição e clima): não copie o objeto, as pessoas nem o texto",
  cenario: "SÓ CENÁRIO de referência: não copie objetos nem pessoas",
};

export function legendaDaFonte(r: Pick<RefDoKit, "papel" | "vista"> & { origem_web?: OrigemWeb | null }, i: number, foco?: Foco | null): string {
  const rotulo = foco === "embalagem" && r.papel === "embalagem"
    ? "EMBALAGEM real, que é o ASSUNTO desta foto (arte, texto e cores a manter iguais)"
    : ROTULO_DO_PAPEL[r.papel];
  const web = r.origem_web
    ? ` Foto oficial ou de loja do produto achada na internet (${r.origem_web.fonte}): serve para a forma, a cor, o material e os detalhes do produto; ignore fundo, texto de loja, selos e marca d'água dela`
    : "";
  return `Imagem ${i}: ${rotulo}${r.vista && r.vista !== "livre" ? `, vista ${r.vista.replace(/_/g, " ")}` : ""}.${web ? `${web}.` : ""}`;
}

// ------------------------------------------------------------ guia

export type Guia = {
  modo: "biblioteca" | "referencia" | "livre" | "nenhum";
  prompt_id: string | null;
  referencia_ids: string[];
  texto: string | null;
};

export const MAX_REFERENCIAS_DE_ESTILO = 2;

export function lerGuia(bruto: unknown): Guia {
  const nenhum: Guia = { modo: "nenhum", prompt_id: null, referencia_ids: [], texto: null };
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return nenhum;
  const r = bruto as Record<string, unknown>;
  const modo = String(r.modo ?? "nenhum");
  const texto = limpoOuNulo(r.texto, 1500);
  if (modo === "biblioteca") {
    const id = String(r.prompt_id ?? "");
    if (!UUID.test(id)) throw new ErroDeRegra(400, "guia_invalido", "Escolha um prompt da biblioteca (prompt_id).");
    return { modo, prompt_id: id, referencia_ids: [], texto };
  }
  if (modo === "referencia") {
    const ids = Array.isArray(r.referencia_ids) ? Array.from(new Set(r.referencia_ids.map(String).filter((x) => UUID.test(x)))) : [];
    if (!ids.length) throw new ErroDeRegra(400, "guia_invalido", "Escolha ao menos uma referência de estilo (referencia_ids).");
    return { modo, prompt_id: null, referencia_ids: ids.slice(0, MAX_REFERENCIAS_DE_ESTILO), texto };
  }
  if (modo === "livre") {
    if (!texto) throw new ErroDeRegra(400, "guia_invalido", "Escreva a direção livre (texto).");
    return { modo, prompt_id: null, referencia_ids: [], texto };
  }
  return nenhum;
}

// ------------------------------------------------------------ prompts

const VARIACOES = [
  "mude a disposição do cenário e dos objetos de cena (props), mantendo câmera e assunto",
  "mude a altura e a direção da luz chave (por exemplo da esquerda para a direita), mantendo o clima",
  "mude a superfície e a cor de apoio do cenário dentro da paleta, mantendo câmera e assunto",
  "mude a distância focal percebida e o respiro do enquadramento, mantendo o ângulo",
];

/** Variação real para refazer: a versão n pede uma mudança concreta e cita o motivo das rejeições. */
export function blocoDeVariacao(versoesAntes: number, rejeicoes: string[]): string {
  if (versoesAntes <= 0) return "";
  const pedido = VARIACOES[(versoesAntes - 1) % VARIACOES.length];
  const motivos = rejeicoes.filter(Boolean).slice(-3);
  return [
    `VARIAÇÃO REAL (versão ${versoesAntes + 1}): não repita a composição anterior; ${pedido}.`,
    motivos.length ? `A equipe rejeitou versões anteriores por: ${motivos.join("; ")}. Corrija isso.` : "",
  ].filter(Boolean).join(" ");
}

export type EntradaPromptTomada = {
  kit: KitFoto;
  tomada: Tomada;
  finalidade: string;
  marca: { nome: string; estilo?: string | null; paleta?: string[] };
  fontes: (Pick<RefDoKit, "papel" | "vista"> & { origem_web?: OrigemWeb | null })[];
  estilos: { titulo: string }[];
  guiaTexto: string | null;
  versoesAntes: number;
  rejeicoes: string[];
  /** v2: guia de estilo do ensaio (campanha ou variações com referência de estilo). */
  guiaDeEstilo?: GuiaDeEstilo | null;
  /** v2: pessoa sintética da campanha. */
  modelo?: ModeloSintetico | null;
  /** v2: foto já aprovada desta campanha anexada logo depois das fontes (mesma pessoa sintética). */
  pessoaAprovada?: boolean;
};

// ------------------------------------------------------------ guia de estilo e pessoa sintética

/** Direção extraída das referências de estilo (nunca cópia de foto, marca ou pessoa). */
export type GuiaDeEstilo = {
  resumo: string;
  paleta: string[];
  luz: string;
  cenarios: string[];
  props: string[];
  enquadramentos: string[];
  clima: string;
  figurino: string;
  evitar: string[];
};

export function normalizarGuiaDeEstilo(bruto: unknown): GuiaDeEstilo | null {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return null;
  const r = bruto as Record<string, unknown>;
  const g: GuiaDeEstilo = {
    resumo: limpo(r.resumo, 800),
    paleta: listaDeTextos(r.paleta, 8, 80),
    luz: limpo(r.luz, 500),
    cenarios: listaDeTextos(r.cenarios, 8, 200),
    props: listaDeTextos(r.props, 10, 120),
    enquadramentos: listaDeTextos(r.enquadramentos, 8, 160),
    clima: limpo(r.clima, 300),
    figurino: limpo(r.figurino, 300),
    evitar: listaDeTextos(r.evitar, 8, 200),
  };
  return g.resumo || g.luz || g.cenarios.length || g.paleta.length ? g : null;
}

export function guiaDeEstiloEmTexto(g: GuiaDeEstilo): string {
  return [
    g.resumo,
    g.paleta.length ? `Paleta: ${g.paleta.join(", ")}.` : "",
    g.luz ? `Luz: ${g.luz}` : "",
    g.cenarios.length ? `Cenários do universo: ${g.cenarios.join("; ")}.` : "",
    g.props.length ? `Props: ${g.props.join(", ")}.` : "",
    g.enquadramentos.length ? `Enquadramentos: ${g.enquadramentos.join("; ")}.` : "",
    g.clima ? `Clima: ${g.clima}` : "",
    g.figurino ? `Figurino: ${g.figurino}` : "",
    g.evitar.length ? `Evitar: ${g.evitar.join("; ")}.` : "",
  ].filter(Boolean).join(" ");
}

/** Pessoa sintética da campanha: perfil, idade aparente (adulta) e estilo. */
export type ModeloSintetico = { perfil: string; idade_aprox: number; estilo: string; avisos: string[] };

export const IDADE_MINIMA_MODELO = 21;
export const IDADE_PADRAO_MODELO = 30;

/** Pedido de sósia ("parecida com fulano", lookalike): removido do texto e avisado. */
const SOSIA = /\b(parecid[oa]s? com|igual (?:a|ao|à)|a cara d[aoe]|s[oó]sia|lookalike|look-alike|estilo d[aoe] (?:famos|celebr|ator|atriz|cantor))[^.,;]*/gi;

export function lerModeloSintetico(bruto: unknown): ModeloSintetico {
  const r = (bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto : {}) as Record<string, unknown>;
  const avisos: string[] = [];
  const semSosia = (v: unknown, max: number) => {
    const t = limpo(v, max);
    if (new RegExp(SOSIA.source, "i").test(t)) {
      avisos.push("Pedido de semelhança com pessoa real removido: a pessoa sintética não pode parecer alguém conhecido.");
      return t.replace(SOSIA, "").replace(/\s{2,}/g, " ").replace(/^[,;\s]+|[,;\s]+$/g, "");
    }
    return t;
  };
  let idade = Math.round(Number(r.idade_aprox));
  if (!Number.isFinite(idade) || idade <= 0) idade = IDADE_PADRAO_MODELO;
  if (idade < IDADE_MINIMA_MODELO) {
    avisos.push(`Idade aparente ajustada para ${IDADE_MINIMA_MODELO} anos: a pessoa sintética é sempre adulta.`);
    idade = IDADE_MINIMA_MODELO;
  }
  return {
    perfil: semSosia(r.perfil, 300),
    idade_aprox: Math.min(80, idade),
    estilo: semSosia(r.estilo, 300),
    avisos: Array.from(new Set(avisos)),
  };
}

const ROTULO_DO_TIPO: Record<TipoKit, string> = {
  produto: "PRODUTO",
  pessoa: "RETRATO",
  alimento: "ALIMENTO",
  bebida: "BEBIDA",
  cosmetico: "COSMÉTICO",
  moda: "MODA",
  tecnologia: "TECNOLOGIA",
  outro: "PRODUTO",
};

/**
 * Prompt fotográfico da tomada: fontes na ordem anexada, câmera em palavras,
 * lente e profundidade de campo, luz (chave, preenchimento, recorte), cenário
 * e materiais, sombra de contato e reflexo, invariantes, o que pode mudar,
 * proibições do tipo, lacunas e aviso de novo ângulo.
 */
/** Linhas das imagens anexadas: fontes, pessoa sintética aprovada (campanha) e estilos, na ordem do envio. */
function linhasDasImagens(e: EntradaPromptTomada): string[] {
  if (!e.fontes.length && !e.estilos.length && !e.pessoaAprovada) return [];
  const linhas = ["IMAGENS ANEXADAS, NA ORDEM:"];
  e.fontes.forEach((f, i) => linhas.push(legendaDaFonte(f, i + 1, e.tomada.foco)));
  let n = e.fontes.length;
  if (e.pessoaAprovada) {
    n += 1;
    linhas.push(`Imagem ${n}: SÓ A PESSOA SINTÉTICA já aprovada nesta campanha (mesmo rosto, cabelo e tom de pele, para manter a mesma modelo); não é o produto e não copie a cena.`);
  }
  e.estilos.forEach((s, i) =>
    linhas.push(`Imagem ${n + i + 1}: SÓ ESTILO, LUZ E COMPOSIÇÃO ("${s.titulo}"); não copie o objeto, as pessoas, a marca nem o texto desta imagem.`)
  );
  return linhas;
}

/** Direção de arte: o que diferencia esta foto (tipo de variação, props, paleta, mudança da rodada). */
function linhaDeDirecaoDeArte(e: EntradaPromptTomada): string | null {
  const t = e.tomada;
  const tipo = tipoDeVariacaoPorId(t.tipo_variacao);
  const partes = [
    tipo ? `${tipo.nome}: ${tipo.direcao}` : "",
    t.props?.length ? `Objetos de cena: ${t.props.join(", ")}; cada prop com função na história, sem marca, sem texto e menor que o assunto.` : "",
    t.mudanca ? `Diferente das outras fotos do lote: ${t.mudanca}.` : "",
    "Composição com hierarquia clara: o assunto é o herói, respiro nas bordas, linhas do cenário levando o olhar até ele.",
  ].filter(Boolean);
  return partes.length ? `DIREÇÃO DE ARTE: ${partes.join(" ")}` : null;
}

/** Fidelidade do produto dita como diretor de arte (forma, cor, texto e proporção). */
function linhaDeFidelidade(e: EntradaPromptTomada): string {
  if (e.tomada.foco === "embalagem") {
    return "FIDELIDADE: a caixa aparece exatamente como nas fotos da embalagem: mesma arte, mesmas cores, textos e logotipos legíveis letra por letra, mesmas proporções; nada de texto inventado.";
  }
  return "FIDELIDADE DO PRODUTO: mesmo formato e silhueta, mesmas proporções entre as partes, mesma cor e acabamento (fosco, brilhante, texturizado), logotipo e textos do produto exatamente como nas fontes e legíveis, mesma quantidade de peças; escala real em relação ao cenário e às mãos.";
}

/**
 * Prompt fotográfico da tomada: fontes na ordem anexada, câmera em palavras,
 * lente e profundidade de campo, luz (chave, preenchimento, recorte), cenário
 * e materiais, direção de arte, sombra de contato e reflexo, invariantes, o
 * que pode mudar, proibições do tipo, lacunas e aviso de novo ângulo.
 * Tomada de campanha sai em promptDaCampanha.
 */
export function promptDaTomada(e: EntradaPromptTomada): string {
  const { kit, tomada } = e;
  if (tomada.campanha) return promptDaCampanha(e);
  const assunto = `${kit.nome}${kit.variante ? ` (variante ${kit.variante})` : ""}`;
  const tipo = tipoDeVariacaoPorId(tomada.tipo_variacao);
  const linhas: string[] = [];
  linhas.push(`FOTOGRAFIA PUBLICITÁRIA PROFISSIONAL DE ${ROTULO_DO_TIPO[kit.tipo]} para ${e.finalidade || "uso comercial"} da marca ${e.marca.nome}.`);
  linhas.push(`Tomada "${tomada.nome}"${tomada.objetivo ? `: ${tomada.objetivo}` : ""}.`);
  if (tomada.foco === "embalagem") {
    linhas.push(`ASSUNTO: a embalagem real de ${assunto}. A caixa é o herói desta foto; fotografe exatamente a caixa das imagens de embalagem, fechada, sem abrir nem desenhar o produto de dentro.`);
  } else {
    linhas.push(`ASSUNTO: ${assunto}. É exatamente o mesmo assunto das imagens de identidade anexadas; fotografe-o, não crie outro parecido.`);
  }
  if (tomada.foco === "fora_da_embalagem") {
    linhas.push(
      "FORA DA EMBALAGEM: mostre o produto em si, fora da caixa, recriado a partir das fotos do produto (reais ou de referência da internet). Nunca desenhe o produto a partir da arte impressa na caixa; a caixa não aparece.",
    );
  }
  linhas.push(...linhasDasImagens(e));
  linhas.push(
    `CÂMERA: ${azimuteEmPalavras(tomada.camera.azimute)}; ${elevacaoEmPalavras(tomada.camera.elevacao)}; ${enquadramentoEmPalavras(tomada.camera.enquadramento, kit.tipo)}. Posição relativa à frente do assunto definida no kit.`,
  );
  linhas.push(`LENTE: ${tomada.lente}.`);
  linhas.push(`LUZ: ${tomada.luz} Luz chave, preenchimento e recorte coerentes entre si e com o cenário; balanço de branco correto; realces controlados sem estourar.`);
  linhas.push(`CENÁRIO: ${tomada.cenario} Materiais e superfícies realistas, escala coerente com o assunto.`);
  const direcao = linhaDeDirecaoDeArte(e);
  if (direcao) linhas.push(direcao);
  if (tipo?.com_maos) {
    linhas.push(
      "MÃO: mão adulta natural, pele com textura real, cinco dedos com unhas e articulações corretas, segurando o assunto com a pegada que ele pede; só a mão e o antebraço entram no quadro, sem rosto.",
    );
  }
  linhas.push(
    tipo?.flutuando
      ? "SOMBRA E REFLEXO: o assunto flutua de propósito, levemente inclinado; sombra projetada suave e distante no fundo, coerente com a luz chave; sem sombra de contato, sem fio nem suporte aparente; nada de sombra dupla."
      : "SOMBRA E REFLEXO: sombra de contato suave e curta sob o assunto, na direção oposta à luz chave; reflexo na superfície só se ela for brilhante e coerente com o material; nada de sombra dupla nem assunto flutuando.",
  );
  linhas.push(linhaDeFidelidade(e));
  linhas.push(`INVARIANTES (não mudar): ${tomada.invariantes.join("; ")}.`);
  if (tomada.pode_mudar.length) linhas.push(`PODE MUDAR: ${tomada.pode_mudar.join("; ")}.`);
  linhas.push(`PROIBIDO: ${tomada.proibicoes.join("; ")}.`);
  const lacunas = tomada.foco === "embalagem" ? [] : kit.lacunas;
  if (lacunas.length) linhas.push(`NÃO DOCUMENTADO NO KIT (não invente, deixe fora do quadro ou discreto): ${lacunas.join("; ")}.`);
  if (tomada.modo === "angulo") {
    linhas.push(
      "NOVO ÂNGULO: esta vista não aparece nas fontes. Gere o mínimo necessário das partes não vistas, de forma sóbria e plausível, sem detalhes chamativos; nunca espelhe uma vista documentada.",
    );
  }
  if (tomada.espaco_para_texto) linhas.push("COMPOSIÇÃO: deixe uma área limpa de cerca de um terço do quadro para texto, sem escrever nada nela.");
  if (e.marca.estilo || e.marca.paleta?.length) {
    linhas.push(
      `MARCA: ${e.marca.estilo ? `${e.marca.estilo}. ` : ""}${e.marca.paleta?.length ? `Paleta de apoio ${e.marca.paleta.join(", ")} só no cenário e nos objetos de cena, nunca no assunto.` : ""}`.trim(),
    );
  }
  if (e.guiaDeEstilo) linhas.push(`GUIA DE ESTILO DO ENSAIO: ${guiaDeEstiloEmTexto(e.guiaDeEstilo)} Só direção: não copie foto, marca nem pessoa das referências.`);
  if (e.guiaTexto) linhas.push(`DIREÇÃO DE ESTILO: ${e.guiaTexto} Esta direção não muda as invariantes nem as proibições acima.`);
  const variacao = blocoDeVariacao(e.versoesAntes, e.rejeicoes);
  if (variacao) linhas.push(variacao);
  linhas.push(`FORMATO ${tomada.formato}. Fotografia realista de campanha profissional, câmera full frame, nitidez onde importa, cor fiel, sem aparência de ilustração, 3D ou banco de imagens genérico.`);
  return semTravessao(linhas.join("\n"));
}

/** Enquadramento da campanha em palavras (a pessoa define o quadro). */
function enquadramentoDaCampanha(camera: Camera, comPessoa: boolean): string {
  if (!comPessoa) return enquadramentoEmPalavras(camera.enquadramento, "produto");
  if (camera.enquadramento === "detalhe") return "retrato de perto, do peito para cima, rosto e produto nítidos no mesmo plano de foco";
  if (camera.enquadramento === "medio") return "plano médio, da cintura para cima, com o cenário legível atrás";
  return "plano aberto, corpo inteiro no ambiente, produto ainda reconhecível";
}

/**
 * Prompt de campanha: pessoa sintética (adulta, sem parecer ninguém real)
 * usando o produto do kit, que é invariante; guia de estilo das referências
 * só como direção.
 */
export function promptDaCampanha(e: EntradaPromptTomada): string {
  const { kit, tomada } = e;
  const cena = tomada.campanha ?? { com_pessoa: true, acao: "", expressao: "", figurino: "" };
  const assunto = `${kit.nome}${kit.variante ? ` (variante ${kit.variante})` : ""}`;
  const produto = tomada.foco === "embalagem" ? `a embalagem real de ${assunto} (caixa fechada, arte idêntica)` : assunto;
  const m = e.modelo;
  const linhas: string[] = [];
  linhas.push(`FOTOGRAFIA PUBLICITÁRIA EDITORIAL de campanha da marca ${e.marca.nome}${e.finalidade ? ` (${e.finalidade})` : ""}.`);
  linhas.push(`Cena "${tomada.nome}"${tomada.objetivo ? `: ${tomada.objetivo}` : ""}.`);
  linhas.push(`PRODUTO (invariante): ${produto}, exatamente como nas imagens de identidade anexadas; não redesenhe, não troque a variante, não crie outro parecido.`);
  if (cena.com_pessoa) {
    linhas.push([
      "PESSOA SINTÉTICA: pessoa gerada, que não existe, não é o cliente e não é ninguém real.",
      m?.perfil ? `Perfil: ${m.perfil}.` : "",
      `Idade aparente de cerca de ${m?.idade_aprox ?? IDADE_PADRAO_MODELO} anos, adulta.`,
      m?.estilo ? `Estilo: ${m.estilo}.` : "",
      "Rosto natural e único, sem parecer celebridade, influenciador ou qualquer pessoa conhecida; pele com poros e textura real, sem retoque plástico; proporções anatômicas corretas.",
    ].filter(Boolean).join(" "));
    linhas.push([
      cena.acao ? `AÇÃO: ${cena.acao}.` : "AÇÃO: a pessoa usa o produto do jeito real de uso, com naturalidade.",
      cena.expressao ? `Expressão: ${cena.expressao}.` : "",
      cena.figurino ? `Figurino: ${cena.figurino}.` : "",
      "Mãos naturais com cinco dedos, unhas e articulações corretas; o produto no corpo ou na mão na escala real e na posição certa de uso.",
    ].filter(Boolean).join(" "));
  } else {
    linhas.push("SEM PESSOA: o produto sozinho é o herói da cena, no clima da campanha.");
  }
  linhas.push(...linhasDasImagens(e));
  linhas.push(`CÂMERA: ${enquadramentoDaCampanha(tomada.camera, cena.com_pessoa)}; ${elevacaoEmPalavras(tomada.camera.elevacao)}.`);
  linhas.push(`LENTE: ${tomada.lente}.`);
  linhas.push(`LUZ: ${tomada.luz} Luz com intenção de campanha: chave, preenchimento e recorte coerentes entre si, na pele e no produto; balanço de branco do guia; nunca escurecer a foto para dar destaque.`);
  linhas.push(`CENÁRIO: ${tomada.cenario} Profundidade real, materiais críveis, escala coerente.`);
  const direcao = linhaDeDirecaoDeArte(e);
  if (direcao) linhas.push(direcao);
  if (e.guiaDeEstilo) linhas.push(`GUIA DE ESTILO DA CAMPANHA: ${guiaDeEstiloEmTexto(e.guiaDeEstilo)} Só direção: não copie foto, marca, texto nem pessoa das referências.`);
  linhas.push(linhaDeFidelidade(e));
  linhas.push(`INVARIANTES DO PRODUTO (não mudar): ${tomada.invariantes.join("; ")}.`);
  if (tomada.pode_mudar.length) linhas.push(`PODE MUDAR: ${tomada.pode_mudar.join("; ")}.`);
  linhas.push(`PROIBIDO: ${tomada.proibicoes.join("; ")}.`);
  const lacunas = tomada.foco === "embalagem" ? [] : kit.lacunas;
  if (lacunas.length) linhas.push(`NÃO DOCUMENTADO NO KIT (não invente; deixe fora do quadro ou discreto): ${lacunas.join("; ")}.`);
  if (tomada.espaco_para_texto) linhas.push("COMPOSIÇÃO: deixe uma área limpa de cerca de um terço do quadro para texto, sem escrever nada nela.");
  if (e.marca.paleta?.length) linhas.push(`MARCA: paleta de apoio ${e.marca.paleta.join(", ")} no cenário, no figurino e nos objetos de cena, nunca no produto.`);
  if (e.guiaTexto) linhas.push(`DIREÇÃO DE ESTILO: ${e.guiaTexto} Esta direção não muda as invariantes nem as proibições acima.`);
  const variacao = blocoDeVariacao(e.versoesAntes, e.rejeicoes);
  if (variacao) linhas.push(variacao);
  linhas.push(`FORMATO ${tomada.formato}. Fotografia realista de campanha editorial, câmera full frame, pele e tecidos com textura real, sem aparência de ilustração, 3D ou banco de imagens genérico.`);
  return semTravessao(linhas.join("\n"));
}

export type EntradaPromptPreparo = {
  modo: "fundo_branco" | "fundo_transparente" | "cenario" | "luz_cor" | "limpar";
  tipo: TipoKit | null;
  cenario: string | null;
  instrucao: string | null;
  guiaTexto: string | null;
  estilos: { titulo: string }[];
  temAreasProtegidas: boolean;
  entradaRecortada: boolean;
};

/** Prompt do preparo: o que muda e o que fica, por modo. */
export function promptDoPreparo(e: EntradaPromptPreparo): string {
  const assunto = e.tipo === "pessoa" ? "a pessoa" : e.tipo === "alimento" ? "o prato" : "o produto";
  const fica = e.tipo === "pessoa"
    ? "rosto, traços, idade aparente, pele, corpo, cabelo e acessórios idênticos"
    : e.tipo === "alimento"
    ? "ingredientes, porção, ponto de preparo, montagem e recipiente idênticos"
    : "forma, cor, material, texto do rótulo, botões e proporções idênticos, sem espelhar";
  const linhas: string[] = [];
  const primeira = "A primeira imagem anexada é a foto real a editar.";
  if (e.modo === "fundo_transparente") {
    linhas.push(primeira, `Recorte ${assunto} principal e devolva a imagem com o fundo totalmente transparente (canal alfa).`);
    linhas.push(`Não mude nada em ${assunto}: ${fica}. Mantenha posição e tamanho no quadro.`);
    linhas.push("Inclua partes finas que fazem parte do assunto (alças, cabos, fios de cabelo, bordas de vidro). Sem sombra, sem chão, sem contorno branco.");
  } else if (e.modo === "fundo_branco") {
    linhas.push(primeira, "Troque só o fundo por branco puro de estúdio (#FFFFFF), contínuo, sem costura, sem textura e sem objetos.");
    linhas.push(`${assunto[0].toUpperCase()}${assunto.slice(1)} fica exatamente onde está: ${fica}.`);
    linhas.push("Sombra de contato suave e curta sob o assunto, coerente com a luz da foto; nada de sombra dupla.");
  } else if (e.modo === "cenario") {
    linhas.push(primeira, `Coloque ${assunto} no cenário: ${e.cenario}.`);
    linhas.push(`${assunto[0].toUpperCase()}${assunto.slice(1)} fica exatamente onde está, no mesmo tamanho e na mesma perspectiva: ${fica}.`);
    linhas.push("Construa o cenário na perspectiva e na luz da foto: mesma altura de câmera, mesma direção da luz chave, sombra de contato e reflexo coerentes com a superfície; escala realista dos objetos de cena.");
    if (e.entradaRecortada) linhas.push("A foto chega recortada (fundo transparente): preencha só o fundo.");
  } else if (e.modo === "luz_cor") {
    linhas.push(primeira, "Trate luz e cor como um retocador profissional: balanço de branco neutro, exposição correta, contraste suave, altas luzes e sombras recuperadas, cores fiéis ao material.");
    linhas.push(`Não mude o conteúdo: ${fica}. Nenhum objeto entra ou sai do quadro.`);
    linhas.push("Não escureça a foto para dar destaque; sem vinheta pesada, sem filtro de cor.");
  } else {
    linhas.push(primeira, "Limpe a foto: remova poeira, manchas, fiapos, marcas de dedo, reflexos indesejados e pequenos objetos que distraem.");
    linhas.push(`Não mexa no conteúdo principal: ${fica}. Enquadramento e luz iguais.`);
  }
  if (e.temAreasProtegidas) linhas.push("As áreas protegidas da foto voltam com os pixels originais depois da edição: não as redesenhe.");
  if (e.instrucao) linhas.push(`PEDIDO DA EQUIPE: ${e.instrucao}`);
  e.estilos.forEach((s, i) => linhas.push(`Imagem ${i + 2}: SÓ ESTILO, LUZ E COMPOSIÇÃO ("${s.titulo}"); não copie o objeto, as pessoas, a marca nem o texto desta imagem.`));
  if (e.guiaTexto) linhas.push(`DIREÇÃO DE ESTILO: ${e.guiaTexto} Esta direção não muda o que precisa ficar igual.`);
  linhas.push("Resultado fotográfico realista, sem texto sobreposto nem marca d'água.");
  return semTravessao(linhas.join("\n"));
}

/** Modo gravado na derivada do acervo e se ela contém pixels gerados. */
export function derivadaDoPreparo(modo: EntradaPromptPreparo["modo"], rota: "recorte" | "gerador"): { modo: ModoTomada; gerada: boolean } {
  if (modo === "fundo_transparente") return { modo: "preservar", gerada: false };
  if (modo === "fundo_branco") return { modo: "preservar", gerada: rota === "gerador" };
  if (modo === "cenario") return { modo: "cenario", gerada: true };
  if (modo === "luz_cor") return { modo: "luz_cor", gerada: true };
  return { modo: "preservar", gerada: true };
}

// ------------------------------------------------------------ estimativa

export type Estimativa = {
  tomadas_geraveis: number;
  tomadas_bloqueadas: number;
  geracao_usd: number;
  conferencia_usd: number;
  total_usd: number;
  por_tomada_usd: Record<string, number>;
};

/** Estimativa pela contagem de tomadas que podem ser geradas (bloqueadas não custam). */
export function estimativaDoEnsaio(
  tomadas: Pick<Tomada, "id" | "motivo_bloqueio">[],
  custoDaGeracao: (id: string) => number,
  custoDaConferencia: (id: string) => number,
): Estimativa {
  const geraveis = tomadas.filter((t) => !t.motivo_bloqueio);
  const por: Record<string, number> = {};
  let g = 0, c = 0;
  for (const t of geraveis) {
    const cg = Math.max(0, custoDaGeracao(t.id));
    const cc = Math.max(0, custoDaConferencia(t.id));
    por[t.id] = arred6(cg);
    g += cg;
    c += cc;
  }
  return {
    tomadas_geraveis: geraveis.length,
    tomadas_bloqueadas: tomadas.length - geraveis.length,
    geracao_usd: arred6(g),
    conferencia_usd: arred6(c),
    total_usd: arred6(g + c),
    por_tomada_usd: por,
  };
}

// ------------------------------------------------------------ versões

export const proximaVersao = (t: Pick<Tomada, "versoes">) => Math.max(0, ...t.versoes.map((v) => v.versao)) + 1;

/**
 * Decisão da equipe sobre uma versão. Aprovar trava a versão (imutável);
 * rejeitar guarda o motivo. Versão travada não é rejeitada depois: ajuste
 * gera versão nova e a aprovação histórica fica.
 */
export function decidirVersao(
  t: Tomada,
  numero: number,
  decisao: "aprovar" | "rejeitar",
  motivo: string | null,
  quem: string,
  quando: string,
): { tomada: Tomada; versao: VersaoTomada; mudou: boolean } {
  const i = t.versoes.findIndex((v) => v.versao === numero);
  if (i < 0) throw new ErroDeRegra(404, "versao_inexistente", "Esta versão não existe na tomada.");
  const atual = t.versoes[i];
  if (decisao === "aprovar" && atual.aprovada === true) return { tomada: t, versao: atual, mudou: false };
  if (decisao === "rejeitar" && atual.travada) {
    throw new ErroDeRegra(409, "versao_travada", "Versão aprovada fica travada. Para corrigir, gere uma versão nova.");
  }
  const nova: VersaoTomada = decisao === "aprovar"
    ? { ...atual, aprovada: true, decisao: "aprovada", travada: true, motivo_rejeicao: null, decidida_por: quem, decidida_em: quando }
    : { ...atual, aprovada: false, decisao: "rejeitada", motivo_rejeicao: limpoOuNulo(motivo, 800), decidida_por: quem, decidida_em: quando };
  const versoes = t.versoes.slice();
  versoes[i] = nova;
  const tomada = { ...t, versoes };
  tomada.status = statusDaTomada(tomada);
  return { tomada, versao: nova, mudou: true };
}

// ------------------------------------------------------------ conferência

/** Critérios da conferência da tomada: os do tipo do kit e os da própria tomada. */
export function criteriosDaConferencia(tipo: TipoKit, opcoes: { comPessoaSintetica?: boolean; embalagem?: boolean } = {}): string[] {
  const base = opcoes.embalagem
    ? ["Embalagem igual às fontes (arte, cores, texto e logotipos)", "Texto da embalagem legível e sem espelhamento", "Proporção da caixa"]
    : gruposDoTipo(tipo).flatMap((g) => CRITERIOS_CONFERENCIA[g]);
  const pessoa = opcoes.comPessoaSintetica && tipo !== "pessoa" ? CRITERIOS_PESSOA_SINTETICA : [];
  return [...base, ...pessoa, ...CRITERIOS_DA_TOMADA];
}

export const CRITERIOS_PESSOA_SINTETICA = [
  "Mãos com anatomia correta",
  "Pessoa sintética adulta, natural e sem parecer pessoa real conhecida",
  "Produto na escala e na posição certas de uso",
];

// ------------------------------------------------------------ plano de variações

export type VagaDeVariacao = {
  id: string;
  tipo: TipoDeVariacao;
  camera: Camera;
  foco: Foco;
  /** 0 na primeira vez do tipo; 1 em diante quando ele se repete no lote. */
  rodada: number;
  mudanca: string | null;
};

export const MAX_VARIACOES = 16;

/**
 * Vagas do lote de variações, decididas no código para serem diferentes de
 * verdade: tipos na ordem pedida (ou a padrão), câmera trocada quando o tipo
 * se repete e uma mudança concreta por rodada. Sem foto do produto, a caixa
 * vira o assunto (e "fora da caixa" e "com embalagem" saem da ordem padrão).
 */
export function planoDeVariacoes(
  quantidade: unknown,
  tipos: unknown,
  ctx: { temIdentidade: boolean; temEmbalagem: boolean },
): VagaDeVariacao[] {
  const q = Math.max(1, Math.min(MAX_VARIACOES, Math.round(Number(quantidade)) || 8));
  const pedidos = Array.isArray(tipos) ? Array.from(new Set(tipos.map(String))).filter((t) => tipoDeVariacaoPorId(t)) : [];
  let ordem = pedidos.length ? pedidos : ORDEM_DAS_VARIACOES.slice();
  if (!pedidos.length) {
    if (!ctx.temIdentidade) ordem = ordem.filter((t) => t !== "fora_da_caixa" && t !== "com_embalagem");
    if (!ctx.temEmbalagem) ordem = ordem.filter((t) => t !== "com_embalagem");
  }
  const vagas: VagaDeVariacao[] = [];
  for (let i = 0; i < q; i++) {
    const tipo = tipoDeVariacaoPorId(ordem[i % ordem.length])!;
    const rodada = Math.floor(i / ordem.length);
    const camera = tipo.cameras[rodada % tipo.cameras.length];
    let foco: Foco = tipo.foco;
    if (!ctx.temIdentidade && ctx.temEmbalagem && foco === "produto" && tipo.id !== "com_embalagem") foco = "embalagem";
    vagas.push({
      id: rodada ? `${tipo.id}-${rodada + 1}` : tipo.id,
      tipo,
      camera,
      foco,
      rodada,
      mudanca: rodada ? MUDANCAS_DA_RODADA[((rodada - 1) % (MUDANCAS_DA_RODADA.length - 1)) + 1] : null,
    });
  }
  return vagas;
}

/**
 * Vagas a partir das variações que o diretor escreveu na conversa: tipo
 * conhecido, câmera pedida (preset) ou a do tipo, id único e o mesmo foco de
 * planoDeVariacoes (sem foto do produto, a caixa é o assunto).
 */
export function vagasDoDiretor(variacoes: VariacaoSugerida[], ctx: { temIdentidade: boolean; temEmbalagem: boolean }): VagaDeVariacao[] {
  const vezes = new Map<string, number>();
  const usados = new Set<string>();
  return variacoes.slice(0, MAX_VARIACOES).map((v) => {
    const tipo = tipoDeVariacaoPorId(v.tipo) ?? tipoDeVariacaoPorId("cenario_marca")!;
    const rodada = vezes.get(tipo.id) ?? 0;
    vezes.set(tipo.id, rodada + 1);
    const camera = v.camera && presetPorId(v.camera) ? cameraDoPreset(v.camera) : tipo.cameras[rodada % tipo.cameras.length];
    let foco: Foco = tipo.foco;
    if (!ctx.temIdentidade && ctx.temEmbalagem && foco === "produto" && tipo.id !== "com_embalagem") foco = "embalagem";
    const raiz = nomeSeguro(v.nome || tipo.id).slice(0, 30) || tipo.id;
    let id = raiz;
    for (let n = 2; usados.has(id); n++) id = `${raiz}-${n}`;
    usados.add(id);
    return { id, tipo, camera, foco, rodada, mudanca: rodada ? MUDANCAS_DA_RODADA[((rodada - 1) % (MUDANCAS_DA_RODADA.length - 1)) + 1] : null };
  });
}

/**
 * Vagas do plano aplicado: as variações do diretor (até a quantidade) e,
 * se a equipe pediu mais no cartão, o complemento com tipos ainda não usados.
 */
export function vagasDoPlano(
  variacoes: VariacaoSugerida[],
  quantidade: unknown,
  tipos: string[] | null | undefined,
  ctx: { temIdentidade: boolean; temEmbalagem: boolean },
): VagaDeVariacao[] {
  const q = Math.max(1, Math.min(MAX_VARIACOES, Math.round(Number(quantidade)) || variacoes.length || 8));
  const saida = vagasDoDiretor(variacoes.slice(0, q), ctx);
  if (saida.length >= q) return saida;
  const usados = new Set(saida.map((v) => v.tipo.id));
  const complemento = planoDeVariacoes(MAX_VARIACOES, tipos && tipos.length ? tipos : null, ctx)
    .sort((a, b) => Number(usados.has(a.tipo.id)) - Number(usados.has(b.tipo.id)));
  const ids = new Set(saida.map((v) => v.id));
  for (const v of complemento) {
    if (saida.length >= q) break;
    let id = v.id;
    for (let n = 2; ids.has(id); n++) id = `${v.id}-${n}`;
    ids.add(id);
    saida.push({ ...v, id });
  }
  return saida;
}

/** Blocos "Entendi:" e "Próximo passo:" da resposta do diretor, para a tela destacar. */
export function blocosDaResposta(resposta: string): { entendi: string; proximo_passo: string } {
  const bloco = (rotulo: string) => resposta.match(new RegExp(`^\\s*${rotulo}\\s*:\\s*(.+)$`, "im"))?.[1]?.trim() ?? "";
  return { entendi: limpo(bloco("Entendi"), 600), proximo_passo: limpo(bloco("Pr[oó]ximo passo"), 600) };
}

/** Tipo de variação dito pelo diretor (id ou nome solto) ou null. */
export function tipoDeVariacaoDoTexto(v: unknown): TipoDeVariacao | null {
  const direto = tipoDeVariacaoPorId(v);
  if (direto) return direto;
  const t = nomeSeguro(String(v ?? "")).replace(/-/g, "_");
  if (!t || t === "foto") return null;
  const achar = (re: RegExp, id: string) => (re.test(t) ? tipoDeVariacaoPorId(id) : null);
  return achar(/heroi|fundo_(de_)?cor|cor_solida/, "heroi_fundo_cor") ?? achar(/branco|catalogo|marketplace/, "fundo_branco") ??
    achar(/lifestyle|uso|mesa|ambiente/, "lifestyle") ?? achar(/mao|segurando/, "na_mao") ?? achar(/flat|de_cima/, "flat_lay") ??
    achar(/macro|detalhe|close/, "macro") ?? achar(/marca|universo/, "cenario_marca") ?? achar(/flutu|suspens|levit/, "flutuando") ??
    achar(/fora|sem_caixa|unbox/, "fora_da_caixa") ?? achar(/embalagem|caixa/, "com_embalagem") ?? null;
}

/** Conferência do leitor normalizada: todo critério aparece (o não avaliado fica com ok null). */
export function normalizarConferencia(bruto: unknown, criterios: string[]): Pick<Conferencia, "pontos" | "alertas" | "resumo"> {
  const r = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const lidos = Array.isArray(r.pontos) ? r.pontos : [];
  const pontos = criterios.map((criterio) => {
    const achado = lidos.find((p) => p && typeof p === "object" && limpo((p as Record<string, unknown>).criterio, 200) === criterio) as
      | Record<string, unknown>
      | undefined;
    if (!achado) return { criterio, ok: null, nota: "não avaliado" };
    return { criterio, ok: typeof achado.ok === "boolean" ? achado.ok : null, nota: limpo(achado.nota, 500) };
  });
  return { pontos, alertas: listaDeTextos(r.alertas, 8, 400), resumo: limpo(r.resumo, 1200) };
}

// ------------------------------------------------------------ biblioteca

export const TIPOS_BIBLIOTECA = ["prompt", "referencia"] as const;
export const CATEGORIAS_BIBLIOTECA = [
  "produto", "alimento", "bebida", "cosmetico", "moda", "tecnologia", "pessoa", "ambiente", "estilo", "composicao", "luz", "cenario",
] as const;
export type CategoriaBiblioteca = typeof CATEGORIAS_BIBLIOTECA[number];

export type ItemBiblioteca = {
  tipo: "prompt" | "referencia";
  categoria: CategoriaBiblioteca;
  titulo: string;
  prompt_pt: string | null;
  prompt_en: string | null;
  negativo: string | null;
  imagem_url: string | null;
  storage_path: string | null;
  fonte_nome: string | null;
  fonte_url: string | null;
  licenca: string | null;
  autor: string | null;
  /** Página do autor (atribuição de licenças CC BY). */
  autor_url: string | null;
  tags: string[];
  destaque: boolean;
  /** Quando usar o item (texto da curadoria). */
  uso: string | null;
};

/** Produto genérico (sem marca) que ilustra cada categoria no exemplo gerado da biblioteca. */
const GENERICO_DA_CATEGORIA: Record<string, string> = {
  produto: "uma caixa ou um frasco genérico de cor neutra",
  alimento: "um prato simples e bem montado",
  bebida: "um copo ou uma garrafa de vidro sem rótulo",
  cosmetico: "um frasco de sérum ou creme sem rótulo",
  moda: "uma bolsa ou um tênis sem marca",
  tecnologia: "um fone de ouvido ou um mouse genérico",
  pessoa: "uma pessoa sintética adulta, que não existe e não se parece com ninguém conhecido",
  ambiente: "um ambiente interno simples e bem iluminado",
  estilo: "um objeto genérico de cor neutra",
  composicao: "três objetos genéricos de cores neutras",
  luz: "uma esfera ou um frasco genérico que mostra bem a luz",
  cenario: "um objeto genérico de cor neutra no cenário",
};

/**
 * Prompt do exemplo da biblioteca: o prompt do item aplicado a um produto
 * genérico da categoria, sem marca e sem texto, para a equipe ver como fica.
 */
export function promptDoExemplo(item: { categoria?: string | null; titulo: string; prompt_pt?: string | null; prompt_en?: string | null; negativo?: string | null }): string {
  const generico = GENERICO_DA_CATEGORIA[String(item.categoria ?? "")] ?? GENERICO_DA_CATEGORIA.produto;
  const base = (item.prompt_en || item.prompt_pt || "").trim();
  return semTravessao([
    `EXEMPLO ILUSTRATIVO do prompt "${limpo(item.titulo, 160)}" da biblioteca da agência, para a equipe ver como a direção fica numa foto.`,
    `ASSUNTO: ${generico}. Sem marca, sem logotipo, sem texto legível, sem embalagem de marca real.`,
    `DIREÇÃO (siga fielmente a luz, o cenário, a composição e o clima): ${base.slice(0, 3000)}`,
    item.negativo ? `EVITE: ${limpo(item.negativo, 800)}.` : "",
    item.categoria === "pessoa" ? `PESSOA: ${PROIBICOES_PESSOA_SINTETICA.join("; ")}.` : "",
    "Fotografia realista de estúdio profissional, câmera full frame, cor fiel, sem aparência de ilustração ou 3D, sem texto sobreposto e sem marca d'água.",
  ].filter(Boolean).join("\n"));
}

/** Categoria da biblioteca que combina com o tipo do kit. */
export function categoriaDoKit(tipo: TipoKit): CategoriaBiblioteca {
  if (tipo === "outro") return "produto";
  return tipo as CategoriaBiblioteca;
}

export function normalizarItemBiblioteca(bruto: unknown): ItemBiblioteca {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) throw new ErroDeRegra(400, "item_invalido", "Envie o item como objeto.");
  const r = bruto as Record<string, unknown>;
  const tipo = String(r.tipo ?? "") as ItemBiblioteca["tipo"];
  if (!(TIPOS_BIBLIOTECA as readonly string[]).includes(tipo)) throw new ErroDeRegra(400, "tipo_invalido", "Tipo do item: prompt ou referencia.");
  const categoria = String(r.categoria ?? "") as CategoriaBiblioteca;
  if (!(CATEGORIAS_BIBLIOTECA as readonly string[]).includes(categoria)) {
    throw new ErroDeRegra(400, "categoria_invalida", `Categoria inválida. Use: ${CATEGORIAS_BIBLIOTECA.join(", ")}.`);
  }
  const titulo = limpo(r.titulo, 160);
  if (!titulo) throw new ErroDeRegra(400, "titulo_obrigatorio", "Dê um título ao item.");
  const url = (v: unknown) => {
    if (v == null || v === "") return null;
    const u = urlPublicaSegura(v);
    if (!u) throw new ErroDeRegra(400, "url_invalida", "Endereço inválido: use https público.");
    return u.toString();
  };
  const item: ItemBiblioteca = {
    tipo,
    categoria,
    titulo,
    prompt_pt: limpoOuNulo(r.prompt_pt, 4000),
    prompt_en: typeof r.prompt_en === "string" ? r.prompt_en.trim().slice(0, 4000) || null : null,
    negativo: limpoOuNulo(r.negativo, 1500),
    imagem_url: url(r.imagem_url),
    storage_path: typeof r.storage_path === "string" && r.storage_path.trim() ? r.storage_path.trim().slice(0, 400) : null,
    fonte_nome: limpoOuNulo(r.fonte_nome, 200),
    fonte_url: url(r.fonte_url),
    licenca: limpoOuNulo(r.licenca, 120),
    autor: limpoOuNulo(r.autor, 200),
    autor_url: url(r.autor_url),
    tags: listaDeTextos(r.tags, 20, 60).map((t) => t.toLowerCase()),
    destaque: r.destaque === true,
    uso: limpoOuNulo(r.uso, 600),
  };
  if (tipo === "prompt" && !item.prompt_pt && !item.prompt_en) throw new ErroDeRegra(400, "prompt_obrigatorio", "Um item de prompt precisa do texto do prompt.");
  if (tipo === "referencia" && !item.imagem_url && !item.storage_path) {
    throw new ErroDeRegra(400, "imagem_obrigatoria", "Uma referência precisa da imagem (imagem_url ou storage_path).");
  }
  return item;
}

// ------------------------------------------------------------ URL pública
// Mesmas regras da Mesa Ads (mesa-ads/calculos.ts), copiadas para esta
// função não depender de arquivo de outra frente.

/** IPv4 de rede interna, reservada ou de metadados (bloqueado para busca no servidor). */
export function ipv4Interno(ip: string): boolean {
  const p = ip.split(".").map((x) => Number(x));
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19));
}

/** IPv6 interno (loopback, local, único local, IPv4 mapeado). */
export function ipv6Interno(ip: string): boolean {
  const h = ip.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::" || h === "::1") return true;
  if (/^f[cd]/.test(h) || /^fe[89ab]/.test(h)) return true;
  const mapeado = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapeado) return ipv4Interno(mapeado[1]);
  return h.startsWith("::ffff:") || h.startsWith("64:ff9b:");
}

/** Só https público na porta padrão, sem usuário e senha, sem host interno. */
export function urlPublicaSegura(bruto: unknown): URL | null {
  if (typeof bruto !== "string" || !bruto.trim() || bruto.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(bruto.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  if (u.port && u.port !== "443") return null;
  const h = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!h) return null;
  if (h.startsWith("[")) return ipv6Interno(h) ? null : u;
  if (/^[\d.]+$/.test(h)) return ipv4Interno(h) ? null : u;
  if (!h.includes(".") || h === "localhost" || /\.(localhost|local|internal|lan|home|corp|intranet)$/.test(h)) return null;
  return u;
}

// ------------------------------------------------------------ Openverse

export const OPENVERSE_URL = "https://api.openverse.org/v1/images/";

export type ItemDeReferencia = {
  /** Id do Openverse (serve para citar e para não importar duas vezes). */
  id: string | null;
  titulo: string;
  imagem_url: string;
  /** Miniatura do Openverse (thumbnail). */
  miniatura_url: string | null;
  fonte_url: string | null;
  fonte_nome: string | null;
  /** Código cru da licença no Openverse (cc0, by, by-sa, by-nd, pdm...). */
  licenca: string;
  /** Licença legível (ex.: CC BY-SA 4.0). */
  licenca_rotulo: string;
  licenca_url: string | null;
  autor: string | null;
  autor_url: string | null;
  largura: number | null;
  altura: number | null;
};

/** Sem cadastro, o Openverse só entrega até a página 12 (13 a 20 falham). */
export const OPENVERSE_MAX_PAGINA = 12;

/** Endereço da busca: só uso comercial por padrão; "modificacao" pede também permissão de alterar. */
export function urlDoOpenverse(q: unknown, licenca: unknown, pagina: unknown = 1, opcoes: { categoria?: "photograph"; porPagina?: number } = {}): string {
  const termo = limpo(q, 200);
  if (termo.length < 2) throw new ErroDeRegra(400, "busca_curta", "Escreva ao menos 2 letras para buscar referências.");
  const p = Math.max(1, Math.min(OPENVERSE_MAX_PAGINA, Math.round(Number(pagina) || 1)));
  const tipo = licenca === "todas" ? null : licenca === "modificacao" ? "commercial,modification" : "commercial";
  const qs = new URLSearchParams({ q: termo, page_size: String(Math.max(1, Math.min(20, opcoes.porPagina ?? 20))), page: String(p), mature: "false" });
  if (tipo) qs.set("license_type", tipo);
  if (opcoes.categoria) qs.set("category", opcoes.categoria);
  return `${OPENVERSE_URL}?${qs.toString()}`;
}

/** Categoria da biblioteca em inglês, para a busca de exemplo no Openverse. */
const CATEGORIA_EM_INGLES: Record<string, string> = {
  produto: "product", alimento: "food", bebida: "drink", cosmetico: "cosmetics", moda: "fashion", tecnologia: "gadget",
  pessoa: "portrait", ambiente: "interior", estilo: "product", composicao: "still life", luz: "studio light", cenario: "set",
};

const PALAVRAS_VAZIAS = new Set((
  "a an the of and or with without for on in at to from by into onto over under near its it is are be as this that these those very " +
  "photo photograph photography image picture shot style professional high quality detailed realistic ultra hd 4k 8k " +
  "lens mm f aperture iso camera lighting light soft hard shadow shadows background composition frame framing subject " +
  "product premium commercial editorial minimal minimalist clean sharp focus depth field bokeh angle view close up closeup"
).split(" "));

/**
 * Termos curtos para achar no Openverse uma foto que ilustre o prompt:
 * palavras concretas do prompt em inglês (sem jargão de fotografia) e a
 * categoria em inglês. Sem prompt em inglês, usa as tags.
 */
export function termosDeBusca(item: { categoria?: string | null; prompt_en?: string | null; titulo?: string | null; tags?: string[] | null }, max = 4): string {
  const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const texto = semAcento(String(item.prompt_en ?? "")).replace(/[^a-z\s-]/g, " ");
  const palavras: string[] = [];
  for (const p of texto.split(/\s+/)) {
    const w = p.replace(/^-+|-+$/g, "");
    if (w.length < 3 || PALAVRAS_VAZIAS.has(w) || palavras.includes(w)) continue;
    palavras.push(w);
    if (palavras.length >= max) break;
  }
  if (!palavras.length) {
    for (const t of item.tags ?? []) {
      const w = semAcento(t).replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
      if (w && !palavras.includes(w)) palavras.push(w);
      if (palavras.length >= max) break;
    }
  }
  const cat = CATEGORIA_EM_INGLES[String(item.categoria ?? "")] ?? "product";
  if (!palavras.some((p) => cat.includes(p))) palavras.push(cat);
  return palavras.join(" ").slice(0, 200);
}

/** Licença legível a partir do código e da versão do Openverse. */
export function rotuloDaLicenca(licenca: unknown, versao: unknown): string {
  const l = String(licenca ?? "").toLowerCase();
  const v = typeof versao === "string" && versao.trim() ? ` ${versao.trim()}` : "";
  if (l === "cc0") return `CC0${v}`;
  if (l === "pdm") return "Domínio público (PDM)";
  if (!l) return "desconhecida";
  return `CC ${l.toUpperCase()}${v}`;
}

/** Resultados do Openverse no formato da mesa; só imagem em https público. */
export function itensDoOpenverse(json: unknown): ItemDeReferencia[] {
  const r = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const lista = Array.isArray(r.results) ? r.results : [];
  const saida: ItemDeReferencia[] = [];
  for (const bruto of lista) {
    if (!bruto || typeof bruto !== "object") continue;
    const o = bruto as Record<string, unknown>;
    const imagem = urlPublicaSegura(o.url);
    if (!imagem) continue;
    const u = (v: unknown) => urlPublicaSegura(v)?.toString() ?? null;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null);
    const codigo = String(o.license ?? "").toLowerCase().trim();
    saida.push({
      id: typeof o.id === "string" && o.id.length <= 64 ? o.id : null,
      titulo: limpo(o.title, 200) || "Referência sem título",
      imagem_url: imagem.toString(),
      miniatura_url: u(o.thumbnail),
      fonte_url: u(o.foreign_landing_url),
      fonte_nome: limpoOuNulo(o.source ?? o.provider, 120),
      licenca: codigo || "desconhecida",
      licenca_rotulo: rotuloDaLicenca(o.license, o.license_version),
      licenca_url: u(o.license_url),
      autor: limpoOuNulo(o.creator, 200),
      autor_url: u(o.creator_url),
      largura: num(o.width),
      altura: num(o.height),
    });
  }
  return saida;
}

// ------------------------------------------------------------ agente

export const TIPOS_DE_SUGESTAO = [
  "tomada_nova", "ajuste_tomada", "prompt", "busca_referencia", "plano_de_variacoes", "campanha", "identificar_produto",
] as const;
export type TipoSugestao = typeof TIPOS_DE_SUGESTAO[number];

/** Variação de um plano do diretor (camera = preset_id da grade). */
export type VariacaoSugerida = { nome: string; tipo: string; camera: string | null; cenario: string; luz: string; props: string[]; formato: string | null };

export const ENQUADRAMENTOS_DE_CAMPANHA = ["close", "medio", "aberto"] as const;
export type EnquadramentoDeCampanha = typeof ENQUADRAMENTOS_DE_CAMPANHA[number];

/** Foto de campanha planejada (pelo diretor ou por campanha_planejar). */
export type FotoDeCampanha = {
  nome: string;
  objetivo: string;
  acao: string;
  expressao: string;
  figurino: string;
  enquadramento: EnquadramentoDeCampanha;
  camera: string | null;
  cenario: string;
  luz: string;
  props: string[];
  formato: string | null;
  com_pessoa: boolean;
};

export const MAX_FOTOS_CAMPANHA = 16;

export function lerFotosDeCampanha(bruto: unknown, formatos: readonly string[], max = MAX_FOTOS_CAMPANHA): FotoDeCampanha[] {
  if (!Array.isArray(bruto)) return [];
  const saida: FotoDeCampanha[] = [];
  for (const item of bruto) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const nome = limpo(r.nome, 120);
    const cenario = limpo(r.cenario ?? r.cena, 800);
    if (!nome && !cenario) continue;
    const enq = String(r.enquadramento ?? "");
    saida.push({
      nome: nome || `Foto ${saida.length + 1}`,
      objetivo: limpo(r.objetivo ?? r.cena, 400),
      acao: limpo(r.acao, 400),
      expressao: limpo(r.expressao, 200),
      figurino: limpo(r.figurino, 300),
      enquadramento: (ENQUADRAMENTOS_DE_CAMPANHA as readonly string[]).includes(enq) ? (enq as EnquadramentoDeCampanha) : "medio",
      camera: typeof r.camera === "string" && presetPorId(r.camera) ? r.camera : typeof r.preset_id === "string" && presetPorId(r.preset_id) ? r.preset_id : null,
      cenario,
      luz: limpo(r.luz, 800),
      props: listaDeTextos(r.props, 8, 160),
      formato: typeof r.formato === "string" && formatos.includes(r.formato) ? r.formato : null,
      com_pessoa: r.com_pessoa !== false,
    });
    if (saida.length >= max) break;
  }
  return saida;
}

/** Câmera da foto de campanha: preset pedido ou a do enquadramento. */
export function cameraDaCampanha(f: Pick<FotoDeCampanha, "camera" | "enquadramento" | "com_pessoa">): Camera {
  if (f.camera && presetPorId(f.camera)) return cameraDoPreset(f.camera);
  if (!f.com_pessoa) return cameraDoPreset("a45-e-30-dmedio");
  return cameraDoPreset(f.enquadramento === "close" ? "a0-e0-ddetalhe" : f.enquadramento === "aberto" ? "a315-e0-daberto" : "a45-e0-dmedio");
}

export function lerVariacoesSugeridas(bruto: unknown, formatos: readonly string[], max = MAX_VARIACOES): VariacaoSugerida[] {
  if (!Array.isArray(bruto)) return [];
  const saida: VariacaoSugerida[] = [];
  for (const item of bruto) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const tipo = tipoDeVariacaoDoTexto(r.tipo) ?? tipoDeVariacaoDoTexto(r.nome);
    const nome = limpo(r.nome, 120) || tipo?.nome || "";
    if (!nome) continue;
    const camera = typeof r.camera === "string" && presetPorId(r.camera) ? r.camera : typeof r.preset_id === "string" && presetPorId(r.preset_id) ? r.preset_id : null;
    saida.push({
      nome,
      tipo: tipo?.id ?? "cenario_marca",
      camera,
      cenario: limpo(r.cenario, 800),
      luz: limpo(r.luz, 800),
      props: listaDeTextos(r.props, 8, 160),
      formato: typeof r.formato === "string" && formatos.includes(r.formato) ? r.formato : null,
    });
    if (saida.length >= max) break;
  }
  return saida;
}

const idsValidos = (v: unknown, max: number) =>
  Array.isArray(v) ? Array.from(new Set(v.map((x) => String(x ?? "").trim()).filter((x) => UUID.test(x)))).slice(0, max) : [];

export type CamposDaTomada = {
  nome?: string;
  objetivo?: string;
  preset_id?: string;
  cenario?: string;
  luz?: string;
  formato?: string;
  pode_mudar?: string[];
};

export type Sugestao = {
  id: string;
  tipo: TipoSugestao;
  titulo: string;
  motivo: string;
  tomada_id: string | null;
  campos: CamposDaTomada | null;
  prompt_pt: string | null;
  prompt_en: string | null;
  negativo: string | null;
  categoria: CategoriaBiblioteca | null;
  busca: string | null;
  /** v2: kit do plano de variações ou da campanha. */
  kit_id?: string | null;
  quantidade?: number | null;
  variacoes?: VariacaoSugerida[];
  /** Tipos escolhidos no cartão para completar o plano. */
  tipos?: string[];
  guia_de_estilo?: GuiaDeEstilo | null;
  modelo?: ModeloSintetico | null;
  fotos?: FotoDeCampanha[];
  /** v2: fotos para identificar_produto (acervo do cliente). */
  imagem_ids?: string[];
  /** v2: referências de estilo da campanha (acervo ou biblioteca). */
  referencias_estilo_ids?: string[];
};

function lerCampos(v: unknown, formatos: readonly string[]): CamposDaTomada | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const c: CamposDaTomada = {};
  const nome = limpo(r.nome, 120);
  if (nome) c.nome = nome;
  const objetivo = limpo(r.objetivo, 400);
  if (objetivo) c.objetivo = objetivo;
  if (typeof r.preset_id === "string" && presetPorId(r.preset_id)) c.preset_id = r.preset_id;
  const cenario = limpo(r.cenario, 800);
  if (cenario) c.cenario = cenario;
  const luz = limpo(r.luz, 800);
  if (luz) c.luz = luz;
  if (typeof r.formato === "string" && formatos.includes(r.formato)) c.formato = r.formato;
  const pode = listaDeTextos(r.pode_mudar, 12, 200);
  if (pode.length) c.pode_mudar = pode;
  return Object.keys(c).length ? c : null;
}

/**
 * Sugestões do agente, conferidas: ajuste só de tomada que existe, tomada
 * nova com nome, prompt com texto, busca com termo. No máximo 6.
 */
export function normalizarSugestoes(
  bruto: unknown,
  ctx: { tomadaIds: string[]; formatos?: readonly string[]; kitIds?: string[]; kitPadrao?: string | null },
): Sugestao[] {
  if (!Array.isArray(bruto)) return [];
  const formatos = ctx.formatos ?? FORMATOS;
  const saida: Sugestao[] = [];
  for (const item of bruto) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const tipo = String(r.tipo ?? "") as TipoSugestao;
    if (!(TIPOS_DE_SUGESTAO as readonly string[]).includes(tipo)) continue;
    const campos = lerCampos(r.campos, formatos);
    const tomadaId = typeof r.tomada_id === "string" && ctx.tomadaIds.includes(r.tomada_id) ? r.tomada_id : null;
    const categoria = (CATEGORIAS_BIBLIOTECA as readonly string[]).includes(String(r.categoria)) ? (r.categoria as CategoriaBiblioteca) : null;
    const s: Sugestao = {
      id: `s${saida.length + 1}`,
      tipo,
      titulo: limpo(r.titulo, 160) || "Sugestão",
      motivo: limpo(r.motivo, 800),
      tomada_id: tomadaId,
      campos,
      prompt_pt: limpoOuNulo(r.prompt_pt, 4000),
      prompt_en: typeof r.prompt_en === "string" ? r.prompt_en.trim().slice(0, 4000) || null : null,
      negativo: limpoOuNulo(r.negativo, 1500),
      categoria,
      busca: limpoOuNulo(r.busca, 200),
    };
    if (tipo === "ajuste_tomada" && (!tomadaId || !campos)) continue;
    if (tipo === "tomada_nova" && !campos?.nome) continue;
    if (tipo === "prompt" && !s.prompt_pt && !s.prompt_en) continue;
    if (tipo === "busca_referencia" && !s.busca) continue;
    if (tipo === "plano_de_variacoes" || tipo === "campanha") {
      // Kit precisa ser do cliente (lista da conversa); sem ele, o kit aberto.
      const pedido = typeof r.kit_id === "string" && UUID.test(r.kit_id) ? r.kit_id : null;
      const kitId = pedido && (!ctx.kitIds || ctx.kitIds.includes(pedido)) ? pedido : ctx.kitPadrao ?? null;
      if (!kitId) continue;
      s.kit_id = kitId;
      // Quantidade ajustada no cartão vale sobre a contagem da lista (a função completa ou corta).
      const q = Math.round(Number(r.quantidade));
      const qPedida = Number.isFinite(q) && q > 0 ? q : 0;
      if (tipo === "plano_de_variacoes") {
        s.variacoes = lerVariacoesSugeridas(r.variacoes, formatos);
        s.quantidade = Math.min(MAX_VARIACOES, qPedida || s.variacoes.length);
        s.tipos = Array.isArray(r.tipos) ? Array.from(new Set(r.tipos.map(String))).filter((t) => tipoDeVariacaoPorId(t)) : [];
        if (!s.quantidade) continue;
      } else {
        s.fotos = lerFotosDeCampanha(r.fotos, formatos);
        s.quantidade = Math.min(MAX_FOTOS_CAMPANHA, qPedida || s.fotos.length);
        if (!s.quantidade) continue;
        s.guia_de_estilo = normalizarGuiaDeEstilo(r.guia_de_estilo);
        s.modelo = lerModeloSintetico(r.modelo);
        s.referencias_estilo_ids = idsValidos(r.referencias_estilo_ids, 4);
      }
    }
    if (tipo === "identificar_produto") {
      s.imagem_ids = idsValidos(r.imagem_ids, 6);
      if (!s.imagem_ids.length) continue;
    }
    saida.push(s);
    if (saida.length >= 6) break;
  }
  return saida;
}

/**
 * Aplica uma sugestão de tomada ao ensaio (sem IA): tomada nova entra no fim;
 * ajuste troca só os campos pedidos. Modo, lente e bloqueio são recalculados.
 */
export function aplicarSugestaoDeTomada(
  tomadas: Tomada[],
  s: Sugestao,
  ctx: { kit: KitFoto; refs: RefDoKit[]; receita: Receita | null; formatos: Formato[] },
): { tomadas: Tomada[]; tomada: Tomada } {
  const c = s.campos ?? {};
  if (s.tipo === "tomada_nova") {
    if (tomadas.length >= 20) throw new ErroDeRegra(409, "ensaio_cheio", "O ensaio já tem 20 tomadas.");
    let id = nomeSeguro(c.nome ?? "tomada").slice(0, 30) || "tomada";
    const base = id;
    for (let n = 2; tomadas.some((t) => t.id === id); n++) id = `${base}-${n}`;
    const tomada = montarTomada({
      id,
      nome: c.nome ?? "Tomada",
      objetivo: c.objetivo,
      camera: c.preset_id ? cameraDoPreset(c.preset_id) : cameraDoPreset("a0-e0-dmedio"),
      cenario: c.cenario,
      luz: c.luz,
      pode_mudar: c.pode_mudar,
      formato: formatoValido(c.formato),
    }, ctx);
    return { tomadas: [...tomadas, tomada], tomada };
  }
  if (s.tipo !== "ajuste_tomada") throw new ErroDeRegra(400, "sugestao_sem_tomada", "Esta sugestão não muda tomadas.");
  const i = tomadas.findIndex((t) => t.id === s.tomada_id);
  if (i < 0) throw new ErroDeRegra(404, "tomada_inexistente", "A tomada desta sugestão não existe mais no ensaio.");
  const atual = tomadas[i];
  const tomada = montarTomada({
    id: atual.id,
    nome: c.nome ?? atual.nome,
    objetivo: c.objetivo ?? atual.objetivo,
    receita_tomada_id: atual.receita_tomada_id,
    camera: c.preset_id ? cameraDoPreset(c.preset_id) : atual.camera,
    cenario: c.cenario ?? atual.cenario,
    luz: c.luz ?? atual.luz,
    pode_mudar: c.pode_mudar ?? atual.pode_mudar,
    formato: formatoValido(c.formato) ?? atual.formato,
    espaco_para_texto: atual.espaco_para_texto,
    exige: atual.exige,
    observacao: atual.observacao,
    versoes: atual.versoes,
    ...camposV2(atual),
  }, ctx);
  const nova = tomadas.slice();
  nova[i] = tomada;
  return { tomadas: nova, tomada };
}

/** Categoria do acervo (cliente_imagens.categoria) para a foto aprovada aparecer certo na Mesa. */
export const categoriaDoAcervo = (tipo: TipoKit) => (tipo === "pessoa" ? "pessoa" : "produto");
