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

import {
  type Camera,
  cameraDoPreset,
  CRITERIOS_CONFERENCIA,
  CRITERIOS_DA_TOMADA,
  ENQUADRAMENTOS,
  type Enquadramento,
  type Exigencia,
  FORMATOS,
  type Formato,
  gruposDoTipo,
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

export type Atributos = { observado: string[]; informado: string[]; inferido: string[] };

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
};

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
  return {
    ...(typeof r.id === "string" && UUID.test(r.id) ? { id: r.id } : {}),
    tipo,
    nome,
    variante: limpoOuNulo(r.variante, 120),
    atributos: {
      observado: listaDeTextos(at.observado, 30, 300),
      informado: listaDeTextos(at.informado, 30, 300),
      inferido: listaDeTextos(at.inferido, 30, 300),
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
export function motivoDoBloqueio(kit: KitFoto, refs: RefDoKit[], exige?: Exigencia | null): string | null {
  if (kit.status === "arquivado") return "O kit está arquivado.";
  if (!autorizacaoConfirmada(kit)) return "Pessoa sem autorização de uso registrada no kit.";
  if (!temIdentidade(kit, refs)) {
    return kit.tipo === "pessoa"
      ? "Falta foto real do rosto da pessoa no kit (papel rosto ou identidade)."
      : "Falta a foto de identidade do assunto no kit. Embalagem sozinha não documenta o produto.";
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
};

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

export const proibicoesDoKit = (kit: KitFoto): string[] =>
  [...gruposDoTipo(kit.tipo).flatMap((g) => PROIBICOES[g]), ...PROIBICOES_GERAIS];

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
};

/** Monta a tomada completa: modo pela câmera, bloqueio pela evidência, lente, invariantes e proibições do kit. */
export function montarTomada(base: BaseTomada, ctx: { kit: KitFoto; refs: RefDoKit[]; receita: Receita | null; formatos: Formato[] }): Tomada {
  const modo = modoDaCamera(base.camera, ctx.refs);
  const bloqueio = motivoDoBloqueio(ctx.kit, ctx.refs, base.exige ?? null);
  const versoes = base.versoes ?? [];
  const t: Tomada = {
    id: base.id,
    nome: limpo(base.nome, 120) || "Tomada",
    objetivo: limpo(base.objetivo, 400),
    receita_tomada_id: base.receita_tomada_id ?? null,
    camera: base.camera,
    cenario: limpo(base.cenario, 800) || ctx.receita?.cenario || "Cenário neutro de estúdio.",
    luz: limpo(base.luz, 800) || ctx.receita?.luz || "Luz suave de estúdio com chave, preenchimento e recorte.",
    lente: lenteDaTomada(ctx.kit.tipo, base.camera),
    modo,
    gerado: true,
    angulo_novo: modo === "angulo",
    pode_mudar: (base.pode_mudar ?? []).slice(0, 12),
    invariantes: invariantesDoKit(ctx.kit),
    proibicoes: proibicoesDoKit(ctx.kit),
    formato: base.formato && ctx.formatos.includes(base.formato) ? base.formato : ctx.formatos[0],
    espaco_para_texto: base.espaco_para_texto === true,
    exige: base.exige ?? null,
    status: "pendente",
    bloqueada: !!bloqueio,
    motivo_bloqueio: bloqueio,
    ultimo_erro: null,
    observacao: limpoOuNulo(base.observacao, 600),
    versoes,
  };
  t.status = statusDaTomada(t);
  return t;
}

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
};

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
    });
  }
  if (!base.length) {
    for (const t of receita.tomadas.slice(0, max)) {
      base.push({ id: t.id, nome: t.nome, objetivo: t.objetivo, receita_tomada_id: t.id, camera: t.camera, espaco_para_texto: t.espaco_para_texto, exige: t.exige ?? null });
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

/** Limite de imagens de entrada por motor (documentação de cada API) e o limite prático da casa. */
export const LIMITE_PRATICO_DE_FONTES = 8;
export function limiteDeFontesDoMotor(m: { provedor: string; modelo_api: string }): number {
  if (m.provedor === "openai") return 16;
  if (m.provedor === "openrouter" && /^openai\/gpt-image/.test(m.modelo_api)) return 16;
  if (m.provedor === "openrouter" && /gemini/i.test(m.modelo_api)) return 14;
  return 8;
}

/**
 * Fontes da tomada, em ordem: identidade (a vista mais perto da câmera
 * primeiro), detalhe, embalagem (só quando a tomada pede embalagem) e, no
 * fim, uma referência de estilo ou cenário do kit. Pose só entra em kit de
 * pessoa e nunca como identidade.
 */
export function fontesDaTomada(refs: RefDoKit[], tomada: Pick<Tomada, "camera" | "exige">, limite: number): RefDoKit[] {
  const pedeEmbalagem = !!tomada.exige?.papeis?.includes("embalagem");
  const perto = (r: RefDoKit) => {
    const v = r.vista ? VISTAS[r.vista] : null;
    if (!v || v.azimute == null) return 90;
    return distanciaAngular(v.azimute, tomada.camera.azimute);
  };
  const candidatas = refs.filter((r) => r.papel !== "embalagem" || pedeEmbalagem);
  const ordenadas = candidatas.slice().sort((a, b) =>
    grupoDaFonte(a.papel) - grupoDaFonte(b.papel) ||
    (grupoDaFonte(a.papel) <= 1 ? perto(a) - perto(b) : 0) ||
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

export function legendaDaFonte(r: Pick<RefDoKit, "papel" | "vista">, i: number): string {
  return `Imagem ${i}: ${ROTULO_DO_PAPEL[r.papel]}${r.vista && r.vista !== "livre" ? `, vista ${r.vista.replace(/_/g, " ")}` : ""}.`;
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
  fontes: Pick<RefDoKit, "papel" | "vista">[];
  estilos: { titulo: string }[];
  guiaTexto: string | null;
  versoesAntes: number;
  rejeicoes: string[];
};

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
export function promptDaTomada(e: EntradaPromptTomada): string {
  const { kit, tomada } = e;
  const assunto = `${kit.nome}${kit.variante ? ` (variante ${kit.variante})` : ""}`;
  const linhas: string[] = [];
  linhas.push(`FOTOGRAFIA PROFISSIONAL DE ${ROTULO_DO_TIPO[kit.tipo]} para ${e.finalidade || "uso comercial"} da marca ${e.marca.nome}.`);
  linhas.push(`Tomada "${tomada.nome}"${tomada.objetivo ? `: ${tomada.objetivo}` : ""}.`);
  linhas.push(`ASSUNTO: ${assunto}. É exatamente o mesmo assunto das imagens de identidade anexadas; fotografe-o, não crie outro parecido.`);
  if (e.fontes.length || e.estilos.length) {
    linhas.push("IMAGENS ANEXADAS, NA ORDEM:");
    e.fontes.forEach((f, i) => linhas.push(legendaDaFonte(f, i + 1)));
    e.estilos.forEach((s, i) =>
      linhas.push(`Imagem ${e.fontes.length + i + 1}: SÓ ESTILO, LUZ E COMPOSIÇÃO ("${s.titulo}"); não copie o objeto, as pessoas, a marca nem o texto desta imagem.`)
    );
  }
  linhas.push(
    `CÂMERA: ${azimuteEmPalavras(tomada.camera.azimute)}; ${elevacaoEmPalavras(tomada.camera.elevacao)}; ${enquadramentoEmPalavras(tomada.camera.enquadramento, kit.tipo)}. Posição relativa à frente do assunto definida no kit.`,
  );
  linhas.push(`LENTE: ${tomada.lente}.`);
  linhas.push(`LUZ: ${tomada.luz} Luz chave, preenchimento e recorte coerentes entre si e com o cenário; balanço de branco correto.`);
  linhas.push(`CENÁRIO: ${tomada.cenario} Materiais e superfícies realistas, escala coerente com o assunto.`);
  linhas.push(
    "SOMBRA E REFLEXO: sombra de contato suave e curta sob o assunto, na direção oposta à luz chave; reflexo na superfície só se ela for brilhante e coerente com o material; nada de sombra dupla nem assunto flutuando.",
  );
  linhas.push(`INVARIANTES (não mudar): ${tomada.invariantes.join("; ")}.`);
  if (tomada.pode_mudar.length) linhas.push(`PODE MUDAR: ${tomada.pode_mudar.join("; ")}.`);
  linhas.push(`PROIBIDO: ${tomada.proibicoes.join("; ")}.`);
  if (kit.lacunas.length) linhas.push(`NÃO DOCUMENTADO NO KIT (não invente, deixe fora do quadro ou discreto): ${kit.lacunas.join("; ")}.`);
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
  if (e.guiaTexto) linhas.push(`DIREÇÃO DE ESTILO: ${e.guiaTexto} Esta direção não muda as invariantes nem as proibições acima.`);
  const variacao = blocoDeVariacao(e.versoesAntes, e.rejeicoes);
  if (variacao) linhas.push(variacao);
  linhas.push(`FORMATO ${tomada.formato}. Fotografia realista de estúdio profissional, nitidez de câmera full frame, sem aparência de ilustração ou 3D.`);
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
export function criteriosDaConferencia(tipo: TipoKit): string[] {
  return [...gruposDoTipo(tipo).flatMap((g) => CRITERIOS_CONFERENCIA[g]), ...CRITERIOS_DA_TOMADA];
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
export function urlDoOpenverse(q: unknown, licenca: unknown, pagina: unknown = 1): string {
  const termo = limpo(q, 200);
  if (termo.length < 2) throw new ErroDeRegra(400, "busca_curta", "Escreva ao menos 2 letras para buscar referências.");
  const p = Math.max(1, Math.min(OPENVERSE_MAX_PAGINA, Math.round(Number(pagina) || 1)));
  const tipo = licenca === "todas" ? null : licenca === "modificacao" ? "commercial,modification" : "commercial";
  const qs = new URLSearchParams({ q: termo, page_size: "20", page: String(p), mature: "false" });
  if (tipo) qs.set("license_type", tipo);
  return `${OPENVERSE_URL}?${qs.toString()}`;
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

export const TIPOS_DE_SUGESTAO = ["tomada_nova", "ajuste_tomada", "prompt", "busca_referencia"] as const;
export type TipoSugestao = typeof TIPOS_DE_SUGESTAO[number];

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
export function normalizarSugestoes(bruto: unknown, ctx: { tomadaIds: string[]; formatos?: readonly string[] }): Sugestao[] {
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
  }, ctx);
  const nova = tomadas.slice();
  nova[i] = tomada;
  return { tomadas: nova, tomada };
}

/** Categoria do acervo (cliente_imagens.categoria) para a foto aprovada aparecer certo na Mesa. */
export const categoriaDoAcervo = (tipo: TipoKit) => (tipo === "pessoa" ? "pessoa" : "produto");
