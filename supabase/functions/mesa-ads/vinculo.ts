/**
 * Vínculo automático entre os anúncios da conta da Meta e os criativos da
 * Mesa Ads (pedido do dono em 26/09/2026: "anúncios sem vínculo: já deixar
 * tudo reconhecido de forma automática e inteligente").
 *
 * Tudo aqui é regra em código, puro (sem Deno, sem banco), para o Vitest:
 * - sinais de cada par anúncio x criativo: imagem (impressão digital dHash de
 *   64 bits), utm_content e nome do anúncio (o pacote do gestor nomeia o
 *   anúncio igual ao arquivo), texto principal, título, campanha com o nome do
 *   plano e datas (anúncio que rodou antes de o criativo existir não pode ser
 *   dele);
 * - a confiança junta os sinais (1 menos o produto das faltas) e desconta
 *   imagem diferente;
 * - a decisão: confiança alta e sem rival perto liga sozinho; no meio do
 *   caminho vai para o Jev (Choice com "nenhum") ou para a equipe confirmar;
 *   baixa fica sem par. Um criativo casa com uma peça só (a mesma arte pode
 *   rodar em vários anúncios: a peça junta esses anúncios).
 *
 * Sem travessão nos textos.
 */

export type AnuncioParaVinculo = {
  ad_id: string;
  nome: string | null;
  titulo: string | null;
  corpo: string | null;
  destino: string | null;
  campanha: string | null;
  /** Primeiro dia com entrega que a coleta guardou (AAAA-MM-DD). */
  primeiro_dia: string | null;
  gasto: number;
  status: string | null;
  /** Mesma arte em vários anúncios: mesma peça (calculos.chaveDaPeca). */
  peca: string | null;
  /** dHash de 64 bits em hexadecimal (16 caracteres) ou null. */
  impressao: string | null;
  imagem_url: string | null;
};

export type CriativoParaVinculo = {
  id: string;
  nome: string | null;
  textos: string[];
  titulos: string[];
  criado_em: string | null;
  plano: string | null;
  angulo: string | null;
  ad_id: string | null;
  impressao: string | null;
  /** Nome que o pacote do gestor dá ao anúncio (01-nome-4x5), quando existir. */
  nome_do_anuncio: string | null;
};

export type TipoDeSinal = "imagem" | "utm" | "nome" | "texto" | "titulo" | "campanha" | "data" | "imagem_diferente";
export type Sinal = { tipo: TipoDeSinal; peso: number; detalhe: string };
export type Par = { criativo_id: string; confianca: number; sinais: Sinal[] };

export const LIMIAR_AUTOMATICO = 0.8;
export const LIMIAR_INCERTO = 0.45;
/** Rival a menos que isto do primeiro deixa a escolha incerta. */
export const FOLGA_DO_RIVAL = 0.12;

// ------------------------------------------------------------------ texto

const PALAVRAS_VAZIAS = new Set([
  "para", "com", "que", "uma", "um", "dos", "das", "nos", "nas", "por", "mais", "seu", "sua", "seus", "suas", "voce", "voces",
  "the", "and", "este", "esta", "isso", "aqui", "como", "sem", "ate", "quem", "onde", "tem", "ter", "sao", "foi", "ser",
]);

/** Minúsculo, sem acento, sem pontuação. */
export function normalizarTexto(s: string | null | undefined): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function palavras(s: string | null | undefined): string[] {
  return normalizarTexto(s).split(" ").filter((p) => p.length >= 3 && !PALAVRAS_VAZIAS.has(p));
}

/** Coeficiente de Dice entre os conjuntos de palavras (0 a 1). */
export function similaridade(a: string | null | undefined, b: string | null | undefined): number {
  const x = new Set(palavras(a));
  const y = new Set(palavras(b));
  if (!x.size || !y.size) return 0;
  let comum = 0;
  for (const p of x) if (y.has(p)) comum++;
  return (2 * comum) / (x.size + y.size);
}

/** Slug do jeito do pacote do gestor (nomeDeArquivo): minúsculo, sem acento, hífen. */
export function slug(s: string | null | undefined): string {
  return normalizarTexto(s).replace(/\s+/g, "-");
}

/** utm_content do destino, se houver. */
export function utmContent(destino: string | null | undefined): string | null {
  const m = /[?&]utm_content=([^&#]+)/i.exec(String(destino ?? ""));
  if (!m) return null;
  try {
    return decodeURIComponent(m[1].replace(/\+/g, " ")).trim() || null;
  } catch {
    return m[1];
  }
}

// ------------------------------------------------------------------ imagem

/** Distância de Hamming entre duas impressões de 64 bits em hexadecimal (null se inválidas). */
export function distanciaDasImpressoes(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b || a.length !== b.length || !/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return null;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/**
 * dHash de 64 bits a partir de 9x8 tons de cinza (72 valores, linha a linha):
 * cada bit diz se o pixel é mais claro que o vizinho da direita.
 */
export function dHashDeCinzas(cinzas: ArrayLike<number>): string | null {
  if (cinzas.length !== 72) return null;
  let hex = "";
  for (let y = 0; y < 8; y++) {
    let nibble = 0;
    for (let x = 0; x < 8; x++) {
      const bit = cinzas[y * 9 + x] > cinzas[y * 9 + x + 1] ? 1 : 0;
      nibble = (nibble << 1) | bit;
      if (x === 3 || x === 7) {
        hex += nibble.toString(16);
        nibble = 0;
      }
    }
  }
  return hex;
}

// ------------------------------------------------------------------ sinais

const dia = (iso: string | null | undefined) => (iso ? String(iso).slice(0, 10) : null);
function somarDias(data: string, n: number): string {
  const d = new Date(`${data}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Sinais de um par e a confiança (0 a 1). impossivel = o anúncio rodou antes de o criativo existir. */
export function sinaisDoPar(ad: AnuncioParaVinculo, cr: CriativoParaVinculo): { confianca: number; sinais: Sinal[]; impossivel: boolean } {
  const sinais: Sinal[] = [];
  const criado = dia(cr.criado_em);
  const primeiro = dia(ad.primeiro_dia);
  // Um dia de folga para fuso e para a coleta que grava o dia da Meta.
  const impossivel = !!(criado && primeiro && primeiro < somarDias(criado, -1));

  const d = distanciaDasImpressoes(ad.impressao, cr.impressao);
  if (d !== null) {
    if (d <= 6) sinais.push({ tipo: "imagem", peso: 0.9, detalhe: "Mesma imagem" });
    else if (d <= 11) sinais.push({ tipo: "imagem", peso: 0.6, detalhe: "Imagem muito parecida" });
    else if (d >= 22) sinais.push({ tipo: "imagem_diferente", peso: -0.25, detalhe: "Imagem diferente" });
  }

  const utm = utmContent(ad.destino);
  const nomeDoPacote = slug(cr.nome_do_anuncio);
  const idCurto = cr.id.slice(0, 8).toLowerCase();
  if (utm && ((nomeDoPacote && slug(utm) === nomeDoPacote) || slug(utm).indexOf(idCurto) >= 0)) {
    sinais.push({ tipo: "utm", peso: 0.9, detalhe: "utm_content igual ao nome do anúncio no pacote" });
  }

  const nomeAd = slug(ad.nome);
  const nomeCr = slug(cr.nome);
  if (nomeAd && ((nomeDoPacote.length >= 6 && nomeAd.indexOf(nomeDoPacote) >= 0) || nomeAd.indexOf(idCurto) >= 0)) {
    sinais.push({ tipo: "nome", peso: 0.75, detalhe: "Nome do anúncio igual ao do pacote" });
  } else if (nomeAd && nomeCr) {
    const s = similaridade(ad.nome, cr.nome);
    if (s >= 0.6) sinais.push({ tipo: "nome", peso: 0.35, detalhe: "Nome parecido" });
  }

  const corpo = ad.corpo || "";
  const melhorTexto = cr.textos.reduce((m, t) => Math.max(m, similaridade(corpo, t)), 0);
  if (corpo && melhorTexto >= 0.85) sinais.push({ tipo: "texto", peso: 0.6, detalhe: "Texto principal igual" });
  else if (corpo && melhorTexto >= 0.6) sinais.push({ tipo: "texto", peso: 0.35, detalhe: "Texto principal parecido" });
  else if (corpo && melhorTexto >= 0.4) sinais.push({ tipo: "texto", peso: 0.15, detalhe: "Texto com trechos em comum" });

  const titulo = normalizarTexto(ad.titulo);
  if (titulo) {
    if (cr.titulos.some((t) => normalizarTexto(t) === titulo)) sinais.push({ tipo: "titulo", peso: 0.35, detalhe: "Título igual" });
    else if (cr.titulos.some((t) => similaridade(ad.titulo, t) >= 0.7)) sinais.push({ tipo: "titulo", peso: 0.2, detalhe: "Título parecido" });
  }

  const campanha = slug(ad.campanha);
  const plano = slug(cr.plano);
  const angulo = slug(cr.angulo);
  if (campanha && ((plano.length >= 5 && campanha.indexOf(plano) >= 0) || (angulo.length >= 5 && (campanha.indexOf(angulo) >= 0 || nomeAd.indexOf(angulo) >= 0)))) {
    sinais.push({ tipo: "campanha", peso: 0.15, detalhe: "Campanha ou anúncio com o nome do plano ou do ângulo" });
  }

  if (criado && primeiro && !impossivel && primeiro <= somarDias(criado, 60)) sinais.push({ tipo: "data", peso: 0.05, detalhe: "Começou a rodar depois de o criativo ser criado" });

  if (impossivel) return { confianca: 0, sinais, impossivel };
  let falta = 1;
  let desconto = 0;
  for (const s of sinais) {
    if (s.peso > 0) falta *= 1 - s.peso;
    else desconto += -s.peso;
  }
  // Só data não é sinal: sem nenhum outro, confiança zero.
  const temSinalForte = sinais.some((s) => s.peso > 0 && s.tipo !== "data");
  const confianca = temSinalForte ? Math.max(0, Math.min(1, 1 - falta - desconto)) : 0;
  return { confianca: Math.round(confianca * 100) / 100, sinais, impossivel };
}

// ------------------------------------------------------------------ decisão

export type EstadoDoVinculo = "ligado" | "automatico" | "incerto" | "sem_par";

export type VinculoDecidido = {
  peca: string;
  /** Anúncios da peça, o de maior gasto primeiro (é ele que vai para ads_criativos.ad_id). */
  ad_ids: string[];
  ad_principal: string;
  estado: EstadoDoVinculo;
  criativo_id: string | null;
  confianca: number;
  sinais: Sinal[];
  /** Até 4 candidatos, do mais provável ao menos (para o Jev e para a equipe). */
  candidatos: Par[];
};

/** Agrupa os anúncios por peça (sem peça, cada anúncio é a sua), o de maior gasto primeiro. */
export function pecasDosAnuncios(ads: AnuncioParaVinculo[]): { peca: string; ads: AnuncioParaVinculo[] }[] {
  const mapa = new Map<string, AnuncioParaVinculo[]>();
  for (const a of ads) {
    const k = a.peca || `ad:${a.ad_id}`;
    const l = mapa.get(k) ?? [];
    l.push(a);
    mapa.set(k, l);
  }
  return [...mapa.entries()]
    .map(([peca, l]) => ({ peca, ads: l.slice().sort((x, y) => y.gasto - x.gasto) }))
    .sort((x, y) => y.ads[0].gasto - x.ads[0].gasto);
}

/**
 * Decide o vínculo de cada peça. `recusados` guarda pares "criativo|ad" que a
 * equipe (ou o Jev, com "nenhum") já recusou: não voltam como candidato.
 */
export function decidirVinculos(
  ads: AnuncioParaVinculo[],
  criativos: CriativoParaVinculo[],
  opcoes: { recusados?: Set<string>; limiarAutomatico?: number; limiarIncerto?: number } = {},
): VinculoDecidido[] {
  const recusados = opcoes.recusados ?? new Set<string>();
  const auto = opcoes.limiarAutomatico ?? LIMIAR_AUTOMATICO;
  const incerto = opcoes.limiarIncerto ?? LIMIAR_INCERTO;
  const pecas = pecasDosAnuncios(ads);
  const porAdLigado = new Map<string, CriativoParaVinculo>();
  for (const c of criativos) if (c.ad_id) porAdLigado.set(c.ad_id, c);

  const saida: VinculoDecidido[] = [];
  const pendentes: { item: VinculoDecidido; pares: Par[] }[] = [];
  const criativoOcupado = new Set<string>();

  for (const p of pecas) {
    const ids = p.ads.map((a) => a.ad_id);
    const ligado = p.ads.map((a) => porAdLigado.get(a.ad_id)).find((c) => !!c);
    const base = { peca: p.peca, ad_ids: ids, ad_principal: ids[0] };
    if (ligado) {
      criativoOcupado.add(ligado.id);
      saida.push({ ...base, estado: "ligado", criativo_id: ligado.id, confianca: 1, sinais: [], candidatos: [] });
      continue;
    }
    const pares: Par[] = [];
    for (const c of criativos) {
      if (c.ad_id) continue; // criativo já ligado a outro anúncio: a equipe desfaz se precisar
      if (ids.some((id) => recusados.has(`${c.id}|${id}`))) continue;
      let melhor: { confianca: number; sinais: Sinal[] } | null = null;
      for (const a of p.ads) {
        const s = sinaisDoPar(a, c);
        if (s.impossivel) continue;
        if (!melhor || s.confianca > melhor.confianca) melhor = s;
      }
      if (melhor && melhor.confianca > 0) pares.push({ criativo_id: c.id, confianca: melhor.confianca, sinais: melhor.sinais });
    }
    pares.sort((x, y) => y.confianca - x.confianca);
    pendentes.push({ item: { ...base, estado: "sem_par", criativo_id: null, confianca: 0, sinais: [], candidatos: pares.slice(0, 4) }, pares });
  }

  // Um criativo, uma peça: os pares mais fortes escolhem primeiro.
  const ordem = pendentes.slice().sort((x, y) => (y.pares[0] ? y.pares[0].confianca : 0) - (x.pares[0] ? x.pares[0].confianca : 0));
  for (const { item, pares } of ordem) {
    const livres = pares.filter((x) => !criativoOcupado.has(x.criativo_id));
    item.candidatos = livres.slice(0, 4);
    const primeiro = livres[0];
    if (!primeiro || primeiro.confianca < incerto) {
      saida.push(item);
      continue;
    }
    const rival = livres[1];
    const disputado = !!rival && rival.confianca >= primeiro.confianca - FOLGA_DO_RIVAL;
    item.criativo_id = primeiro.criativo_id;
    item.confianca = primeiro.confianca;
    item.sinais = primeiro.sinais;
    item.estado = primeiro.confianca >= auto && !disputado ? "automatico" : "incerto";
    if (item.estado === "automatico") criativoOcupado.add(primeiro.criativo_id);
    saida.push(item);
  }
  const peso: Record<EstadoDoVinculo, number> = { incerto: 0, automatico: 1, ligado: 2, sem_par: 3 };
  return saida.sort((a, b) => peso[a.estado] - peso[b.estado] || b.confianca - a.confianca);
}

/** Textos e títulos de um criativo da Mesa Ads (copy principal e pacote), sem repetição. */
export function textosDoCriativo(copy: Record<string, unknown> | null | undefined): { textos: string[]; titulos: string[] } {
  const c = copy ?? {};
  const pacote = (c.pacote && typeof c.pacote === "object" ? c.pacote : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");
  const textos = [str(c.texto_principal), str(c.texto_principal_longo), str(c.headline_arte)];
  for (const t of Array.isArray(pacote.textos_principais) ? pacote.textos_principais : []) textos.push(str((t as Record<string, unknown>)?.texto));
  const titulos = [str(c.titulo)];
  for (const t of Array.isArray(pacote.titulos) ? pacote.titulos : []) titulos.push(str(t));
  const unicos = (l: string[]) => [...new Set(l.filter(Boolean))];
  return { textos: unicos(textos).slice(0, 12), titulos: unicos(titulos).slice(0, 12) };
}
