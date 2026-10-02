/**
 * Diretrizes da marca (frente CI, 02/10/2026): o que o dono e o cliente
 * mandaram evitar ou preferir, os perfis de referência que a marca NÃO segue
 * e a identidade sintetizada dos perfis de referência (visual, vídeo e
 * pegada, tom e formatos).
 *
 * Pedido do dono: "tudo que eu mandar ali, com base na marca e no contexto,
 * ele já tem que alterar e fazer" ("não quero que o perfil siga aquele",
 * "isso está muito ruim", "o cliente não gostou de X"), "ler os perfis de
 * referência e gerar toda a base a partir deles" e "refletir em TODAS as
 * mesas da marca".
 *
 * Onde mora: `contexto.diretrizes` do contexto da marca (cliente_kit_marca
 * para o cliente e a marca principal; cliente_marcas.contexto para a outra
 * marca). Assim a regra única de herança (heranca-da-marca.ts) vale sem
 * código novo: a outra marca só usa as dela, nunca as do cliente.
 *
 * Quem lê: o contexto completo da marca (contexto-completo-regras.ts) põe a
 * seção em TODO bloco de prompt, em qualquer área, mesmo quando a mesa pede
 * só algumas partes. Por isso todas as mesas (Estúdio, Vídeos, Motion, Foto,
 * Ads, Copy, Instagram, Site, Identidade...) recebem a mesma regra.
 *
 * Arquivo puro (a tela importa o mesmo): sem import, sem lookbehind, sem
 * classe de propriedade Unicode e sem grupo nomeado (Safari 11). Sem travessão.
 */

// ------------------------------------------------------------------ vocabulário

export const AREAS_DA_DIRETRIZ = ["geral", "arte", "video", "copy", "foto", "ads"] as const;
export type AreaDaDiretriz = (typeof AREAS_DA_DIRETRIZ)[number];

export const ROTULO_DA_AREA_DA_DIRETRIZ: Record<AreaDaDiretriz, string> = {
  geral: "tudo",
  arte: "artes",
  video: "vídeos",
  copy: "textos",
  foto: "fotos",
  ads: "anúncios",
};

export type ItemDaDiretriz = { id: string; texto: string; area: AreaDaDiretriz; origem: "dono" | "cliente"; em: string };
export type PerfilExcluido = { handle: string; motivo: string; em: string };
export type IdentidadeDoPerfil = { handle: string; visual: string; video: string; tom: string; formatos: string };
export type IdentidadeDeReferencia = {
  visual: string;
  video: string;
  tom: string;
  formatos: string;
  levar: string;
  nao_levar: string;
  /** @ dos perfis que entraram na síntese. */
  perfis: string[];
  por_perfil: IdentidadeDoPerfil[];
  posts: number;
  gerado_em: string;
};
export type DiretrizesDaMarca = {
  evitar: ItemDaDiretriz[];
  preferir: ItemDaDiretriz[];
  perfis_excluidos: PerfilExcluido[];
  identidade_referencia: IdentidadeDeReferencia | null;
  atualizado_em: string | null;
};

export const MAX_ITENS_POR_LISTA = 30;
export const MAX_PERFIS_EXCLUIDOS = 30;
const MAX_TEXTO = 300;

// ------------------------------------------------------------------ utilitários

const linha = (v: unknown, max: number): string => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);

/** Minúsculo, sem acento e sem pontuação: para comparar textos. */
export function chaveDoTexto(v: unknown): string {
  return String(v == null ? "" : v).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9@._]+/g, " ").trim();
}

/** "@Fulano.Doces" ou "instagram.com/fulano.doces/" vira "fulano.doces"; inválido: null. */
export function handleDoPerfil(bruto: unknown): string | null {
  let s = String(bruto == null ? "" : bruto).trim();
  const m = /instagram\.com\/([^/?#\s]+)/i.exec(s);
  if (m) s = m[1];
  s = s.replace(/^@+/, "").trim().toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(s) ? s : null;
}

const ehArea = (v: unknown): v is AreaDaDiretriz => typeof v === "string" && (AREAS_DA_DIRETRIZ as readonly string[]).indexOf(v) >= 0;

function itemValido(x: unknown): ItemDaDiretriz | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const texto = linha(o.texto, MAX_TEXTO);
  if (!texto) return null;
  return {
    id: linha(o.id, 40) || `d${chaveDoTexto(texto).slice(0, 24).replace(/ /g, "-")}`,
    texto,
    area: ehArea(o.area) ? o.area : "geral",
    origem: o.origem === "cliente" ? "cliente" : "dono",
    em: linha(o.em, 40),
  };
}

function identidadeValida(x: unknown): IdentidadeDeReferencia | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const ident: IdentidadeDeReferencia = {
    visual: linha(o.visual, 900),
    video: linha(o.video, 900),
    tom: linha(o.tom, 600),
    formatos: linha(o.formatos, 600),
    levar: linha(o.levar, 600),
    nao_levar: linha(o.nao_levar, 600),
    perfis: (Array.isArray(o.perfis) ? o.perfis : []).map(handleDoPerfil).filter((h): h is string => !!h).slice(0, 12),
    por_perfil: (Array.isArray(o.por_perfil) ? o.por_perfil : [])
      .map((p) => {
        const r = (p ?? {}) as Record<string, unknown>;
        const handle = handleDoPerfil(r.handle);
        return handle ? { handle, visual: linha(r.visual, 400), video: linha(r.video, 400), tom: linha(r.tom, 300), formatos: linha(r.formatos, 300) } : null;
      })
      .filter((p): p is IdentidadeDoPerfil => !!p)
      .slice(0, 12),
    posts: Math.max(0, Math.round(Number(o.posts) || 0)),
    gerado_em: linha(o.gerado_em, 40),
  };
  return ident.visual || ident.video || ident.tom || ident.formatos || ident.por_perfil.length ? ident : null;
}

/** Diretrizes vazias. */
export function diretrizesVazias(): DiretrizesDaMarca {
  return { evitar: [], preferir: [], perfis_excluidos: [], identidade_referencia: null, atualizado_em: null };
}

/** Lê o que está gravado (qualquer forma) e devolve a forma certa, sem item inválido. */
export function normalizarDiretrizes(bruto: unknown): DiretrizesDaMarca {
  const o = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? (bruto as Record<string, unknown>) : {};
  const lista = (v: unknown) => (Array.isArray(v) ? v : []).map(itemValido).filter((i): i is ItemDaDiretriz => !!i).slice(-MAX_ITENS_POR_LISTA);
  const vistos: Record<string, true> = {};
  const excluidos: PerfilExcluido[] = [];
  for (const p of Array.isArray(o.perfis_excluidos) ? o.perfis_excluidos : []) {
    const r = (p ?? {}) as Record<string, unknown>;
    const handle = handleDoPerfil(typeof p === "string" ? p : r.handle);
    if (!handle || vistos[handle]) continue;
    vistos[handle] = true;
    excluidos.push({ handle, motivo: linha(r.motivo, 200), em: linha(r.em, 40) });
  }
  return {
    evitar: lista(o.evitar),
    preferir: lista(o.preferir),
    perfis_excluidos: excluidos.slice(-MAX_PERFIS_EXCLUIDOS),
    identidade_referencia: identidadeValida(o.identidade_referencia),
    atualizado_em: linha(o.atualizado_em, 40) || null,
  };
}

/** Tem alguma coisa para as mesas lerem? */
export function temDiretrizes(d: DiretrizesDaMarca | null | undefined): boolean {
  return !!d && (d.evitar.length > 0 || d.preferir.length > 0 || d.perfis_excluidos.length > 0 || !!d.identidade_referencia);
}

/** A marca decidiu não seguir este perfil? */
export function perfilExcluido(d: DiretrizesDaMarca | null | undefined, handle: unknown): boolean {
  const h = handleDoPerfil(handle);
  return !!d && !!h && d.perfis_excluidos.some((p) => p.handle === h);
}

/** Só os perfis que a marca ainda segue (a lista vem de cliente_perfis_instagram). */
export function perfisQueValem<P extends { handle: string }>(perfis: P[], d: DiretrizesDaMarca | null | undefined): P[] {
  return perfis.filter((p) => !perfilExcluido(d, p.handle));
}

// ------------------------------------------------------------------ mudanças

export type NovaDiretriz = { texto: string; area: AreaDaDiretriz; origem: "dono" | "cliente" };
export type MudancasNasDiretrizes = {
  evitar: NovaDiretriz[];
  preferir: NovaDiretriz[];
  /** Textos (ou trechos) que saem das listas de evitar e preferir. */
  remover: string[];
  excluir_perfis: Array<{ handle: string; motivo: string }>;
  voltar_a_seguir: string[];
};

export function mudancasVazias(): MudancasNasDiretrizes {
  return { evitar: [], preferir: [], remover: [], excluir_perfis: [], voltar_a_seguir: [] };
}

export function semMudancas(m: MudancasNasDiretrizes | null | undefined): boolean {
  return !m || (!m.evitar.length && !m.preferir.length && !m.remover.length && !m.excluir_perfis.length && !m.voltar_a_seguir.length);
}

/** Normaliza o que veio do modelo (ou da tela). Nada válido: null. */
export function normalizarMudancas(bruto: unknown): MudancasNasDiretrizes | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const novas = (v: unknown): NovaDiretriz[] => {
    const saida: NovaDiretriz[] = [];
    for (const x of Array.isArray(v) ? v : []) {
      const r = (x ?? {}) as Record<string, unknown>;
      const texto = linha(typeof x === "string" ? x : r.texto, MAX_TEXTO);
      if (!texto || saida.some((s) => chaveDoTexto(s.texto) === chaveDoTexto(texto))) continue;
      saida.push({ texto, area: ehArea(r.area) ? r.area : "geral", origem: r.origem === "cliente" ? "cliente" : "dono" });
    }
    return saida.slice(0, 8);
  };
  const handles = (v: unknown) => (Array.isArray(v) ? v : []).map((x) => handleDoPerfil(x && typeof x === "object" ? (x as Record<string, unknown>).handle : x)).filter((h): h is string => !!h);
  const excluir: Array<{ handle: string; motivo: string }> = [];
  for (const x of Array.isArray(o.excluir_perfis) ? o.excluir_perfis : []) {
    const r = (x ?? {}) as Record<string, unknown>;
    const handle = handleDoPerfil(typeof x === "string" ? x : r.handle);
    if (handle && !excluir.some((e) => e.handle === handle)) excluir.push({ handle, motivo: linha(r.motivo, 200) });
  }
  const m: MudancasNasDiretrizes = {
    evitar: novas(o.evitar),
    preferir: novas(o.preferir),
    remover: (Array.isArray(o.remover) ? o.remover : []).map((x) => linha(x, MAX_TEXTO)).filter(Boolean).slice(0, 8),
    excluir_perfis: excluir.slice(0, 6),
    voltar_a_seguir: handles(o.voltar_a_seguir).filter((h, i, a) => a.indexOf(h) === i).slice(0, 6),
  };
  return semMudancas(m) ? null : m;
}

/** O texto da lista casa com o pedido de remover? Igual, ou um contém o outro (trecho com 6 letras ou mais). */
export function casaComORemover(texto: string, pedido: string): boolean {
  const a = chaveDoTexto(texto);
  const b = chaveDoTexto(pedido);
  if (!a || !b) return false;
  if (a === b) return true;
  const menor = a.length < b.length ? a : b;
  const maior = a.length < b.length ? b : a;
  return menor.length >= 6 && maior.indexOf(menor) >= 0;
}

export type DesfazerDasDiretrizes = {
  adicionados: string[];
  removidos: Array<ItemDaDiretriz & { lista: "evitar" | "preferir" }>;
  excluidos: string[];
  reincluidos: PerfilExcluido[];
};

/**
 * Aplica as mudanças e devolve as diretrizes novas, o que o Desfazer precisa
 * e o resumo em palavras do dono. Regras:
 * - texto repetido não entra de novo;
 * - evitar algo que estava em preferir (e o contrário) tira de lá: o pedido
 *   novo vale sobre o antigo ("o cliente não gostou de X");
 * - cada lista guarda as 30 mais novas.
 */
export function aplicarMudancas(
  atualBruto: unknown,
  m: MudancasNasDiretrizes,
  opcoes: { agora: string; gerarId: () => string },
): { diretrizes: DiretrizesDaMarca; desfazer: DesfazerDasDiretrizes; resumo: string[] } {
  const d = normalizarDiretrizes(atualBruto);
  const desfazer: DesfazerDasDiretrizes = { adicionados: [], removidos: [], excluidos: [], reincluidos: [] };
  const resumo: string[] = [];
  const tirar = (lista: "evitar" | "preferir", casa: (i: ItemDaDiretriz) => boolean) => {
    const fica: ItemDaDiretriz[] = [];
    for (const i of d[lista]) {
      if (casa(i)) desfazer.removidos.push({ ...i, lista });
      else fica.push(i);
    }
    const saiu = d[lista].length - fica.length;
    d[lista] = fica;
    return saiu;
  };
  for (const pedido of m.remover) {
    const saiu = tirar("evitar", (i) => casaComORemover(i.texto, pedido)) + tirar("preferir", (i) => casaComORemover(i.texto, pedido));
    if (saiu) resumo.push(`Tirei das diretrizes: ${pedido}`);
  }
  const somar = (lista: "evitar" | "preferir", outra: "evitar" | "preferir", novas: NovaDiretriz[]) => {
    for (const n of novas) {
      const k = chaveDoTexto(n.texto);
      tirar(outra, (i) => chaveDoTexto(i.texto) === k);
      if (d[lista].some((i) => chaveDoTexto(i.texto) === k)) continue;
      const item: ItemDaDiretriz = { id: opcoes.gerarId(), texto: n.texto, area: n.area, origem: n.origem, em: opcoes.agora };
      d[lista].push(item);
      desfazer.adicionados.push(item.id);
      resumo.push(`${lista === "evitar" ? "Evitar" : "Preferir"}${n.area !== "geral" ? ` (${ROTULO_DA_AREA_DA_DIRETRIZ[n.area]})` : ""}: ${n.texto}`);
    }
    while (d[lista].length > MAX_ITENS_POR_LISTA) {
      const velho = d[lista].shift() as ItemDaDiretriz;
      desfazer.removidos.push({ ...velho, lista });
    }
  };
  somar("evitar", "preferir", m.evitar);
  somar("preferir", "evitar", m.preferir);
  for (const e of m.excluir_perfis) {
    if (d.perfis_excluidos.some((p) => p.handle === e.handle)) continue;
    d.perfis_excluidos.push({ handle: e.handle, motivo: e.motivo, em: opcoes.agora });
    desfazer.excluidos.push(e.handle);
    resumo.push(`Não seguir @${e.handle}${e.motivo ? ` (${e.motivo})` : ""}`);
  }
  while (d.perfis_excluidos.length > MAX_PERFIS_EXCLUIDOS) desfazer.reincluidos.push(d.perfis_excluidos.shift() as PerfilExcluido);
  for (const h of m.voltar_a_seguir) {
    const antes = d.perfis_excluidos.filter((p) => p.handle === h);
    if (!antes.length) continue;
    d.perfis_excluidos = d.perfis_excluidos.filter((p) => p.handle !== h);
    desfazer.reincluidos.push(...antes);
    resumo.push(`Voltar a seguir @${h}`);
  }
  if (resumo.length) d.atualizado_em = opcoes.agora;
  return { diretrizes: d, desfazer, resumo };
}

/**
 * Desfazer: tira só o que esta ação pôs e devolve o que ela tirou (o que
 * outra ação mudou depois fica como está).
 */
export function reverterMudancas(atualBruto: unknown, desfazer: Partial<DesfazerDasDiretrizes> | null | undefined, agora: string): DiretrizesDaMarca {
  const d = normalizarDiretrizes(atualBruto);
  const u = desfazer || {};
  const ids = Array.isArray(u.adicionados) ? u.adicionados.map(String) : [];
  d.evitar = d.evitar.filter((i) => ids.indexOf(i.id) < 0);
  d.preferir = d.preferir.filter((i) => ids.indexOf(i.id) < 0);
  for (const r of Array.isArray(u.removidos) ? u.removidos : []) {
    const item = itemValido(r);
    const lista = r && r.lista === "preferir" ? "preferir" : "evitar";
    if (item && !d[lista].some((i) => chaveDoTexto(i.texto) === chaveDoTexto(item.texto))) d[lista].push(item);
  }
  const excluidos = Array.isArray(u.excluidos) ? u.excluidos.map((h) => handleDoPerfil(h)).filter(Boolean) : [];
  d.perfis_excluidos = d.perfis_excluidos.filter((p) => excluidos.indexOf(p.handle) < 0);
  for (const p of Array.isArray(u.reincluidos) ? u.reincluidos : []) {
    const h = handleDoPerfil(p && p.handle);
    if (h && !d.perfis_excluidos.some((x) => x.handle === h)) d.perfis_excluidos.push({ handle: h, motivo: linha(p.motivo, 200), em: linha(p.em, 40) });
  }
  d.atualizado_em = agora;
  return d;
}

/** Troca a identidade de referência; devolve a de antes (para o Desfazer). */
export function trocarIdentidade(atualBruto: unknown, nova: IdentidadeDeReferencia | null, agora: string): { diretrizes: DiretrizesDaMarca; antes: IdentidadeDeReferencia | null } {
  const d = normalizarDiretrizes(atualBruto);
  const antes = d.identidade_referencia;
  d.identidade_referencia = nova ? identidadeValida(nova) : null;
  d.atualizado_em = agora;
  return { diretrizes: d, antes };
}

// ------------------------------------------------------------------ conferência (o agente testa o que fez)

export type Conferencia = { ok: boolean; conferidos: string[]; faltaram: string[] };

/** Depois de gravar: cada mudança pedida está mesmo nas diretrizes lidas de novo do banco? */
export function conferirMudancas(lidas: DiretrizesDaMarca, m: MudancasNasDiretrizes): Conferencia {
  const conferidos: string[] = [];
  const faltaram: string[] = [];
  const marca = (ok: boolean, texto: string) => (ok ? conferidos : faltaram).push(texto);
  const tem = (lista: ItemDaDiretriz[], texto: string) => lista.some((i) => chaveDoTexto(i.texto) === chaveDoTexto(texto));
  for (const n of m.evitar) marca(tem(lidas.evitar, n.texto) && !tem(lidas.preferir, n.texto), `evitar "${n.texto}"`);
  for (const n of m.preferir) marca(tem(lidas.preferir, n.texto) && !tem(lidas.evitar, n.texto), `preferir "${n.texto}"`);
  for (const r of m.remover) {
    const novo = m.evitar.concat(m.preferir).some((n) => casaComORemover(n.texto, r));
    if (!novo) marca(!lidas.evitar.concat(lidas.preferir).some((i) => casaComORemover(i.texto, r)), `fora das diretrizes "${r}"`);
  }
  for (const e of m.excluir_perfis) marca(perfilExcluido(lidas, e.handle), `não seguir @${e.handle}`);
  for (const h of m.voltar_a_seguir) marca(!perfilExcluido(lidas, h), `voltar a seguir @${h}`);
  return { ok: faltaram.length === 0, conferidos, faltaram };
}

/** O que o bloco das mesas precisa trazer depois desta mudança (trecho curto de cada texto e cada @). */
export function trechosEsperadosNoBloco(m: MudancasNasDiretrizes): string[] {
  const trechos = m.evitar.concat(m.preferir).map((n) => chaveDoTexto(n.texto).slice(0, 40)).filter(Boolean);
  return trechos.concat(m.excluir_perfis.map((e) => `@${e.handle}`));
}

/** O bloco do prompt traz o trecho? (comparação sem acento nem pontuação) */
export function blocoTraz(bloco: string, trecho: string): boolean {
  const b = chaveDoTexto(bloco);
  const t = chaveDoTexto(trecho);
  return !!t && b.indexOf(t) >= 0;
}

// ------------------------------------------------------------------ seção do prompt

/** Áreas do contexto completo que leem cada área da diretriz (geral entra sempre). */
const AREAS_QUE_LEEM: Record<string, AreaDaDiretriz[] | "todas"> = {
  geral: "todas",
  calendario: "todas",
  campanha: "todas",
  identidade: "todas",
  arte: ["arte", "foto"],
  foto: ["foto", "arte"],
  video: ["video", "copy"],
  copy: ["copy"],
  ads: ["ads", "copy", "arte", "video"],
  comercial: ["copy"],
  site: ["arte", "copy", "foto"],
  documento: ["copy"],
  contrato: [],
};

/** A diretriz vale na área do trabalho? */
export function diretrizValeNaArea(item: Pick<ItemDaDiretriz, "area">, area: string): boolean {
  if (item.area === "geral") return true;
  const leem = AREAS_QUE_LEEM[area] ?? "todas";
  return leem === "todas" || leem.indexOf(item.area) >= 0;
}

/**
 * A identidade que ainda vale: a síntese inteira quando nenhum perfil dela
 * foi excluído; senão só o que cada perfil que ficou trouxe (e o aviso de
 * refazer). Nenhum perfil sobrou: null (o excluído não influencia nada).
 */
export function identidadeQueVale(d: DiretrizesDaMarca | null | undefined): { identidade: IdentidadeDeReferencia; refazer: boolean } | null {
  const i = d && d.identidade_referencia;
  if (!i) return null;
  const fora = i.perfis.filter((h) => perfilExcluido(d, h));
  if (!fora.length) return { identidade: i, refazer: false };
  const ficam = i.por_perfil.filter((p) => !perfilExcluido(d, p.handle));
  if (!ficam.length) return null;
  const juntar = (campo: "visual" | "video" | "tom" | "formatos") => ficam.map((p) => (p[campo] ? `@${p.handle}: ${p[campo]}` : "")).filter(Boolean).join(" | ");
  return {
    identidade: { ...i, visual: juntar("visual"), video: juntar("video"), tom: juntar("tom"), formatos: juntar("formatos"), levar: "", nao_levar: i.nao_levar, perfis: ficam.map((p) => p.handle), por_perfil: ficam },
    refazer: true,
  };
}

const dataCurta = (iso: string | null | undefined) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

export const TITULO_DAS_DIRETRIZES = "DIRETRIZES DO DONO PARA ESTA MARCA (valem sobre referência, estilo, tendência e sugestão sua; quem pediu foi o dono ou o cliente)";

/**
 * A seção que TODA mesa recebe no prompt (vazia quando não há diretriz).
 * `area` filtra evitar e preferir pela área do trabalho.
 */
export function secaoDasDiretrizes(d: DiretrizesDaMarca | null | undefined, area = "geral"): string {
  if (!temDiretrizes(d)) return "";
  const x = d as DiretrizesDaMarca;
  const item = (i: ItemDaDiretriz) => `- ${i.texto}${i.area !== "geral" ? ` (${ROTULO_DA_AREA_DA_DIRETRIZ[i.area]})` : ""}${i.origem === "cliente" ? " [o cliente pediu]" : ""}`;
  const evitar = x.evitar.filter((i) => diretrizValeNaArea(i, area)).slice().reverse();
  const preferir = x.preferir.filter((i) => diretrizValeNaArea(i, area)).slice().reverse();
  const partes: string[] = [];
  if (evitar.length) partes.push(`Evitar (nunca faça):\n${evitar.map(item).join("\n")}`);
  if (preferir.length) partes.push(`Preferir:\n${preferir.map(item).join("\n")}`);
  if (x.perfis_excluidos.length) {
    partes.push(`Perfis que a marca NÃO segue (não copie estilo, formato, tom nem pegada deles, mesmo que apareçam em referência): ${x.perfis_excluidos.map((p) => `@${p.handle}${p.motivo ? ` (${p.motivo})` : ""}`).join(", ")}.`);
  }
  const vale = identidadeQueVale(x);
  if (vale) {
    const i = vale.identidade;
    const quando = dataCurta(i.gerado_em);
    const linhas = [
      `IDENTIDADE DOS PERFIS DE REFERÊNCIA (síntese de ${i.perfis.map((h) => `@${h}`).join(", ")}${i.posts ? `, ${i.posts} posts` : ""}${quando ? `, ${quando}` : ""}; adapte para esta marca, nunca copie)${vale.refazer ? " (parcial: um perfil saiu, a síntese vai ser refeita)" : ""}`,
      i.visual ? `Visual: ${i.visual}` : "",
      i.video ? `Vídeo e pegada: ${i.video}` : "",
      i.tom ? `Tom: ${i.tom}` : "",
      i.formatos ? `Formatos: ${i.formatos}` : "",
      i.levar ? `Levar para a marca: ${i.levar}` : "",
      i.nao_levar ? `Não levar: ${i.nao_levar}` : "",
    ].filter(Boolean);
    partes.push(linhas.join("\n"));
  }
  return partes.length ? `${TITULO_DAS_DIRETRIZES}\n${partes.join("\n")}` : "";
}

/** Linhas para a tela de Contexto (só as preenchidas). */
export function linhasDasDiretrizesParaTela(bruto: unknown): Array<{ chave: string; rotulo: string; texto: string }> {
  const d = normalizarDiretrizes(bruto);
  const saida: Array<{ chave: string; rotulo: string; texto: string }> = [];
  const lista = (itens: ItemDaDiretriz[]) => itens.slice().reverse().map((i) => `• ${i.texto}${i.area !== "geral" ? ` (${ROTULO_DA_AREA_DA_DIRETRIZ[i.area]})` : ""}`).join("\n");
  if (d.evitar.length) saida.push({ chave: "diretrizes_evitar", rotulo: "Evitar", texto: lista(d.evitar) });
  if (d.preferir.length) saida.push({ chave: "diretrizes_preferir", rotulo: "Preferir", texto: lista(d.preferir) });
  if (d.perfis_excluidos.length) saida.push({ chave: "diretrizes_perfis", rotulo: "Perfis que a marca não segue", texto: d.perfis_excluidos.map((p) => `@${p.handle}${p.motivo ? ` (${p.motivo})` : ""}`).join("\n") });
  const vale = identidadeQueVale(d);
  if (vale) {
    const i = vale.identidade;
    const texto = [i.visual ? `Visual: ${i.visual}` : "", i.video ? `Vídeo e pegada: ${i.video}` : "", i.tom ? `Tom: ${i.tom}` : "", i.formatos ? `Formatos: ${i.formatos}` : ""].filter(Boolean).join("\n");
    if (texto) saida.push({ chave: "diretrizes_identidade", rotulo: `Identidade das referências (${i.perfis.map((h) => `@${h}`).join(", ")})`, texto });
  }
  return saida;
}
