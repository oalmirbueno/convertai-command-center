/**
 * Receita de edição (frente V-B, 26/09): o que a edição de um vídeo de
 * REFERÊNCIA faz, medido e guardado para aplicar no vídeo do cliente com os
 * níveis de fidelidade do Estúdio (Idêntica, Próxima, Inspirada, Criativa).
 *
 * Duas camadas:
 * - medida no navegador, determinística: trocas de plano por diferença de
 *   quadros (tempo de cada corte), duração dos planos, prováveis punch-ins,
 *   energia do áudio e batidas, brilho/contraste/saturação;
 * - vista por um modelo com imagem (opcional, paga, com custo antes): estilo
 *   da legenda, textos na tela, B-roll, tratamento de cor, onde acaba o gancho
 *   e começa o CTA.
 * Nunca guarda o CONTEÚDO da referência (fala, marca, pessoas): só a edição.
 *
 * Links de rede social (Instagram, TikTok, YouTube) não são baixados pelo
 * servidor nem pelo navegador (termos das plataformas): o link fica guardado
 * para ver, e a análise completa pede o arquivo.
 *
 * Puro: sem Deno, sem banco. Tela, função e testes usam o mesmo.
 */

export const VERSAO_DA_RECEITA = 1;
export const MAX_CORTES = 600;
export const MAX_PICOS = 200;

export type Fidelidade = "identica" | "proxima" | "inspirada" | "criativa";
export const FIDELIDADES_DA_RECEITA: Fidelidade[] = ["identica", "proxima", "inspirada", "criativa"];

export interface LegendaDaReceita {
  tem: boolean;
  posicao: "topo" | "meio" | "base" | null;
  tamanho: "pequena" | "media" | "grande" | null;
  palavras_por_vez: number | null;
  destaque: boolean;
  caixa: boolean;
  animacao: string | null;
}

export interface ReceitaDeEdicao {
  versao: number;
  duracao_s: number;
  formato: string | null;
  estrutura: { gancho_ate_s: number; cta_de_s: number | null; fonte: "estimada" | "vista" };
  cortes: number[];
  punch_ins: number[];
  plano_medio_s: number;
  plano_mediano_s: number;
  planos_por_minuto: number;
  transicoes: { predominante: "corte" | "fade" | "outra"; suaves: number };
  legenda: LegendaDaReceita;
  textos_na_tela: boolean;
  broll: boolean;
  musica: { energia_media: number; batidas_por_minuto: number | null; picos: number[] };
  cor: { brilho: number; contraste: number; saturacao: number; tratamento: string | null };
  observacoes: string | null;
  analise: { quadros: number; passo_s: number; visao: boolean; modelo: string | null };
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown, min: number, max: number, padrao: number) => {
  const n = Number(v);
  return v === null || v === undefined || v === "" || !isFinite(n) ? padrao : Math.max(min, Math.min(max, n));
};
const txt = (v: unknown, max: number): string | null => {
  const s = String(v === null || v === undefined ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
  return s || null;
};
const um = <T extends string>(v: unknown, lista: readonly T[]): T | null => (lista.indexOf(String(v) as T) >= 0 ? (String(v) as T) : null);

export function mediana(l: number[]): number {
  if (!l.length) return 0;
  const o = l.slice().sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

// ------------------------------------------------------------------ cortes por diferença de quadros

export interface OpcoesDosCortes {
  /** Diferença média mínima (0 a 1) para ser troca de plano. */
  limiar?: number;
  /** Quantas vezes acima da mediana da vizinhança. */
  fator?: number;
  /** Menor plano aceito (s). */
  planoMinimo?: number;
}

/** Diferença média absoluta (0 a 1) entre duas assinaturas de quadro (tons de cinza 0..255). */
export function diferenca(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]);
  return s / n / 255;
}

/**
 * Trocas de plano (determinístico): diferença grande em relação ao quadro
 * anterior E bem acima da vizinhança (tira movimento de câmera e flash
 * isolado). O corte fica no meio entre os dois quadros amostrados. "Suaves"
 * (diferença média, também isolada) viram prováveis punch-ins/jump cuts.
 */
export function detectarCortes(assinaturas: ArrayLike<number>[], tempos: number[], o: OpcoesDosCortes = {}): { cortes: number[]; suaves: number[]; diferencas: number[] } {
  const limiar = o.limiar !== undefined ? o.limiar : 0.12;
  const fator = o.fator !== undefined ? o.fator : 3;
  const minimo = o.planoMinimo !== undefined ? o.planoMinimo : 0.3;
  const d: number[] = [0];
  for (let i = 1; i < assinaturas.length; i++) d.push(diferenca(assinaturas[i - 1], assinaturas[i]));
  const cortes: number[] = [];
  const suaves: number[] = [];
  let ultimo = -Infinity;
  for (let i = 1; i < d.length; i++) {
    const viz: number[] = [];
    for (let j = Math.max(1, i - 4); j <= Math.min(d.length - 1, i + 4); j++) if (j !== i) viz.push(d[j]);
    const base = Math.max(0.004, mediana(viz));
    const t = r3((tempos[i - 1] + tempos[i]) / 2);
    if (d[i] >= limiar && d[i] >= base * fator) {
      if (t - ultimo >= minimo) {
        cortes.push(t);
        ultimo = t;
      }
    } else if (d[i] >= limiar * 0.45 && d[i] >= base * (fator * 0.8) && t - ultimo >= minimo) {
      suaves.push(t);
    }
  }
  return { cortes: cortes.slice(0, MAX_CORTES), suaves: suaves.slice(0, MAX_CORTES), diferencas: d.map(r3) };
}

/** Duração dos planos a partir dos cortes. */
export function ritmo(cortes: number[], duracao: number): { plano_medio_s: number; plano_mediano_s: number; planos_por_minuto: number } {
  const marcos = [0].concat(cortes.filter((c) => c > 0 && c < duracao)).concat([duracao]);
  const planos: number[] = [];
  for (let i = 1; i < marcos.length; i++) if (marcos[i] - marcos[i - 1] > 0) planos.push(marcos[i] - marcos[i - 1]);
  const medio = planos.length ? planos.reduce((s, x) => s + x, 0) / planos.length : duracao;
  return { plano_medio_s: r2(medio), plano_mediano_s: r2(mediana(planos) || duracao), planos_por_minuto: duracao > 0 ? r2((planos.length / duracao) * 60) : 0 };
}

// ------------------------------------------------------------------ energia e batidas

/** Picos de energia (entradas de som) e batidas por minuto; energias em janelas de `janela_s`. */
export function batidas(energias: ArrayLike<number>, janela_s: number): { energia_media: number; batidas_por_minuto: number | null; picos: number[] } {
  const n = energias.length;
  if (!n) return { energia_media: 0, batidas_por_minuto: null, picos: [] };
  let soma = 0;
  for (let i = 0; i < n; i++) soma += energias[i];
  const media = soma / n;
  const subidas: number[] = [0];
  for (let i = 1; i < n; i++) subidas.push(Math.max(0, energias[i] - energias[i - 1]));
  const mediaSubida = subidas.reduce((s, x) => s + x, 0) / n;
  const picos: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (subidas[i] > mediaSubida * 2.2 && subidas[i] >= subidas[i - 1] && subidas[i] >= subidas[i + 1] && energias[i] > media * 0.6) {
      const t = r3(i * janela_s);
      if (!picos.length || t - picos[picos.length - 1] >= 0.2) picos.push(t);
    }
  }
  const intervalos: number[] = [];
  for (let i = 1; i < picos.length; i++) {
    const d = picos[i] - picos[i - 1];
    if (d >= 0.3 && d <= 1.5) intervalos.push(d);
  }
  const bpm = intervalos.length >= 4 ? Math.round(60 / mediana(intervalos)) : null;
  return { energia_media: r3(media), batidas_por_minuto: bpm, picos: picos.slice(0, MAX_PICOS) };
}

// ------------------------------------------------------------------ montar e normalizar

export interface MedidaDoNavegador {
  duracao_s: number;
  largura: number | null;
  altura: number | null;
  cortes: number[];
  suaves: number[];
  quadros: number;
  passo_s: number;
  brilho: number;
  contraste: number;
  saturacao: number;
  musica: { energia_media: number; batidas_por_minuto: number | null; picos: number[] } | null;
}

export function formatoPelaMedida(l: number | null, a: number | null): string | null {
  if (!l || !a) return null;
  const r = a / l;
  if (r > 1.6) return "9:16";
  if (r > 1.15) return "4:5";
  if (r > 0.85) return "1:1";
  return "16:9";
}

/** Receita só com o que o navegador mediu (estrutura estimada: gancho até o 1º corte depois de 2 s; CTA nos últimos 15%). */
export function receitaDaMedida(m: MedidaDoNavegador): ReceitaDeEdicao {
  const r = ritmo(m.cortes, m.duracao_s);
  const gancho = m.cortes.find((c) => c >= 2) || Math.min(3, m.duracao_s);
  return normalizarReceita({
    versao: VERSAO_DA_RECEITA,
    duracao_s: m.duracao_s,
    formato: formatoPelaMedida(m.largura, m.altura),
    estrutura: { gancho_ate_s: gancho, cta_de_s: m.duracao_s > 8 ? r3(m.duracao_s * 0.85) : null, fonte: "estimada" },
    cortes: m.cortes,
    punch_ins: m.suaves,
    ...r,
    transicoes: { predominante: "corte", suaves: 0 },
    legenda: { tem: false, posicao: null, tamanho: null, palavras_por_vez: null, destaque: false, caixa: false, animacao: null },
    textos_na_tela: false,
    broll: false,
    musica: m.musica || { energia_media: 0, batidas_por_minuto: null, picos: [] },
    cor: { brilho: m.brilho, contraste: m.contraste, saturacao: m.saturacao, tratamento: null },
    observacoes: null,
    analise: { quadros: m.quadros, passo_s: m.passo_s, visao: false, modelo: null },
  })!;
}

/** O que o modelo viu entra por cima da medida (só os campos de estilo; tempos de corte ficam os medidos). */
export function juntarVisao(r: ReceitaDeEdicao, v: Record<string, unknown> | null, modelo: string | null): ReceitaDeEdicao {
  if (!v) return r;
  const l = v.legenda && typeof v.legenda === "object" ? (v.legenda as Record<string, unknown>) : {};
  const e = v.estrutura && typeof v.estrutura === "object" ? (v.estrutura as Record<string, unknown>) : {};
  const gancho = num(e.gancho_ate_s, 0, r.duracao_s, -1);
  const cta = num(e.cta_de_s, 0, r.duracao_s, -1);
  return normalizarReceita({
    ...r,
    estrutura: { gancho_ate_s: gancho >= 0 ? gancho : r.estrutura.gancho_ate_s, cta_de_s: cta >= 0 ? cta : r.estrutura.cta_de_s, fonte: gancho >= 0 || cta >= 0 ? "vista" : r.estrutura.fonte },
    legenda: {
      tem: l.tem === true,
      posicao: um(l.posicao, ["topo", "meio", "base"] as const),
      tamanho: um(l.tamanho, ["pequena", "media", "grande"] as const),
      palavras_por_vez: l.palavras_por_vez,
      destaque: l.destaque === true,
      caixa: l.caixa === true,
      animacao: l.animacao,
    },
    textos_na_tela: v.textos_na_tela === true,
    broll: v.broll === true,
    transicoes: { predominante: um(v.transicao_predominante, ["corte", "fade", "outra"] as const) || r.transicoes.predominante, suaves: r.transicoes.suaves },
    cor: { ...r.cor, tratamento: txt(v.tratamento_de_cor, 120) },
    observacoes: txt(v.observacoes, 400),
    analise: { ...r.analise, visao: true, modelo },
  })!;
}

export function normalizarReceita(v: unknown): ReceitaDeEdicao | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const dur = num(o.duracao_s, 0, 3600, 0);
  if (dur <= 0) return null;
  const tempos = (x: unknown, max: number) =>
    (Array.isArray(x) ? x : [])
      .map(Number)
      .filter((t) => isFinite(t) && t > 0 && t < dur)
      .map(r3)
      .sort((a, b) => a - b)
      .filter((t, i, l) => i === 0 || t !== l[i - 1])
      .slice(0, max);
  const e = o.estrutura && typeof o.estrutura === "object" ? (o.estrutura as Record<string, unknown>) : {};
  const l = o.legenda && typeof o.legenda === "object" ? (o.legenda as Record<string, unknown>) : {};
  const t = o.transicoes && typeof o.transicoes === "object" ? (o.transicoes as Record<string, unknown>) : {};
  const m = o.musica && typeof o.musica === "object" ? (o.musica as Record<string, unknown>) : {};
  const c = o.cor && typeof o.cor === "object" ? (o.cor as Record<string, unknown>) : {};
  const a = o.analise && typeof o.analise === "object" ? (o.analise as Record<string, unknown>) : {};
  const cortes = tempos(o.cortes, MAX_CORTES);
  const rit = ritmo(cortes, dur);
  const ppv = num(l.palavras_por_vez, 1, 12, -1);
  const bpm = num(m.batidas_por_minuto, 30, 240, -1);
  const cta = num(e.cta_de_s, 0, dur, -1);
  return {
    versao: VERSAO_DA_RECEITA,
    duracao_s: r3(dur),
    formato: um(o.formato, ["9:16", "4:5", "1:1", "16:9"] as const),
    estrutura: { gancho_ate_s: r3(num(e.gancho_ate_s, 0, dur, Math.min(3, dur))), cta_de_s: cta >= 0 ? r3(cta) : null, fonte: e.fonte === "vista" ? "vista" : "estimada" },
    cortes,
    punch_ins: tempos(o.punch_ins, MAX_CORTES),
    plano_medio_s: rit.plano_medio_s,
    plano_mediano_s: rit.plano_mediano_s,
    planos_por_minuto: rit.planos_por_minuto,
    transicoes: { predominante: um(t.predominante, ["corte", "fade", "outra"] as const) || "corte", suaves: Math.max(0, Math.floor(num(t.suaves, 0, 10000, 0))) },
    legenda: {
      tem: l.tem === true,
      posicao: um(l.posicao, ["topo", "meio", "base"] as const),
      tamanho: um(l.tamanho, ["pequena", "media", "grande"] as const),
      palavras_por_vez: ppv >= 1 ? Math.round(ppv) : null,
      destaque: l.destaque === true,
      caixa: l.caixa === true,
      animacao: txt(l.animacao, 60),
    },
    textos_na_tela: o.textos_na_tela === true,
    broll: o.broll === true,
    musica: { energia_media: r3(num(m.energia_media, 0, 1, 0)), batidas_por_minuto: bpm >= 30 ? Math.round(bpm) : null, picos: tempos(m.picos, MAX_PICOS) },
    cor: { brilho: r3(num(c.brilho, 0, 1, 0)), contraste: r3(num(c.contraste, 0, 1, 0)), saturacao: r3(num(c.saturacao, 0, 1, 0)), tratamento: txt(c.tratamento, 120) },
    observacoes: txt(o.observacoes, 400),
    analise: { quadros: Math.max(0, Math.floor(num(a.quadros, 0, 100000, 0))), passo_s: r3(num(a.passo_s, 0, 10, 0)), visao: a.visao === true, modelo: txt(a.modelo, 80) },
  };
}

// ------------------------------------------------------------------ fidelidade -> parâmetros das skills

export interface ParametrosDaReceita {
  cortar: boolean;
  batida_s: number | null;
  zoom: number | null;
  transicao: "fade" | "dissolver" | null;
  legendar: boolean;
  palavras_por_bloco: number;
  estilo_legenda: "destaque" | "caixa" | "simples";
  posicao_legenda: "topo" | "meio" | "base" | null;
}

const limitarBatida = (s: number) => r2(Math.max(0.8, Math.min(6, s)));

/**
 * Idêntica: mesmo ritmo, zoom, transição e legenda, o mais perto possível.
 * Próxima: mesma pegada, um pouco mais solta (planos 20% mais longos, zoom mais leve).
 * Inspirada: só o espírito (ritmo no meio do caminho para 2,5 s, legenda no estilo, sem zoom).
 * Criativa: livre (corta silêncios e legenda padrão; o resto fica com a equipe).
 */
export function parametrosPelaFidelidade(r: ReceitaDeEdicao, f: Fidelidade): ParametrosDaReceita {
  const base = limitarBatida(r.plano_mediano_s || 2);
  const temPunch = r.punch_ins.length >= Math.max(2, Math.round(r.duracao_s / 20));
  const estilo: ParametrosDaReceita["estilo_legenda"] = r.legenda.caixa ? "caixa" : r.legenda.destaque ? "destaque" : "simples";
  const ppv = r.legenda.palavras_por_vez || 4;
  const transicao = r.transicoes.predominante === "fade" ? "fade" : null;
  if (f === "identica") return { cortar: true, batida_s: base, zoom: temPunch ? 1.08 : null, transicao, legendar: r.legenda.tem, palavras_por_bloco: ppv, estilo_legenda: estilo, posicao_legenda: r.legenda.posicao };
  if (f === "proxima")
    return { cortar: true, batida_s: limitarBatida(base * 1.2), zoom: temPunch ? 1.05 : null, transicao, legendar: r.legenda.tem, palavras_por_bloco: Math.max(1, Math.min(8, ppv + (ppv < 4 ? 1 : ppv > 4 ? -1 : 0))), estilo_legenda: estilo, posicao_legenda: r.legenda.posicao };
  if (f === "inspirada") return { cortar: true, batida_s: limitarBatida((base + 2.5) / 2), zoom: null, transicao: null, legendar: r.legenda.tem, palavras_por_bloco: 4, estilo_legenda: estilo, posicao_legenda: null };
  return { cortar: true, batida_s: null, zoom: null, transicao: null, legendar: true, palavras_por_bloco: 4, estilo_legenda: "destaque", posicao_legenda: null };
}

// ------------------------------------------------------------------ links

export type PlanoDoLink =
  | { tipo: "rede"; rede: "instagram" | "tiktok" | "youtube"; baixar: false; miniatura: string | null; mensagem: string }
  | { tipo: "painel"; baixar: true; mensagem: null }
  | { tipo: "arquivo_externo"; baixar: false; mensagem: string }
  | { tipo: "invalido"; baixar: false; mensagem: string };

/**
 * O que fazer com um link de referência. Rede social: NUNCA baixa (nem
 * servidor, nem navegador); guarda o link e a miniatura pública quando existe
 * (YouTube), e pede o arquivo para a análise completa. Arquivo do próprio
 * painel (Storage do projeto): usa. Arquivo em outro site: o painel não toca
 * mídia de fora (segurança do navegador), então pede o arquivo também.
 */
export function planoDoLink(bruto: string, dominioDoStorage?: string | null): PlanoDoLink {
  let u: URL;
  try {
    u = new URL(String(bruto || "").trim());
  } catch {
    return { tipo: "invalido", baixar: false, mensagem: "Link inválido." };
  }
  if (u.protocol !== "https:") return { tipo: "invalido", baixar: false, mensagem: "Use um link https." };
  const h = u.hostname.toLowerCase();
  const pedido = "Para a análise completa (cortes, ritmo, áudio), suba o arquivo do vídeo. O link fica guardado para ver.";
  if (h === "instagram.com" || h.endsWith(".instagram.com")) return { tipo: "rede", rede: "instagram", baixar: false, miniatura: null, mensagem: `Instagram não deixa baixar. ${pedido}` };
  if (h === "tiktok.com" || h.endsWith(".tiktok.com")) return { tipo: "rede", rede: "tiktok", baixar: false, miniatura: null, mensagem: `TikTok não deixa baixar. ${pedido}` };
  if (h === "youtu.be" || h === "youtube.com" || h.endsWith(".youtube.com")) {
    let id = "";
    if (h === "youtu.be") id = u.pathname.slice(1);
    else if (u.pathname.indexOf("/shorts/") === 0) id = u.pathname.split("/")[2] || "";
    else id = u.searchParams.get("v") || "";
    id = /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : "";
    return { tipo: "rede", rede: "youtube", baixar: false, miniatura: id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null, mensagem: `YouTube não deixa baixar. ${pedido}` };
  }
  if ((dominioDoStorage && h === dominioDoStorage.toLowerCase()) || (h.endsWith(".supabase.co") && u.pathname.indexOf("/storage/v1/object/") === 0)) return { tipo: "painel", baixar: true, mensagem: null };
  return { tipo: "arquivo_externo", baixar: false, mensagem: "O painel só toca vídeo guardado nele. Suba o arquivo para analisar." };
}

// ------------------------------------------------------------------ visão da receita (esquema do modelo)

export const ESQUEMA_DA_RECEITA = {
  nome: "receita_de_edicao",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["legenda", "textos_na_tela", "broll", "transicao_predominante", "tratamento_de_cor", "estrutura", "observacoes"],
    properties: {
      legenda: {
        type: "object",
        additionalProperties: false,
        required: ["tem", "posicao", "tamanho", "palavras_por_vez", "destaque", "caixa", "animacao"],
        properties: {
          tem: { type: "boolean" },
          posicao: { type: "string", enum: ["topo", "meio", "base", "nenhuma"] },
          tamanho: { type: "string", enum: ["pequena", "media", "grande", "nenhuma"] },
          palavras_por_vez: { type: "number" },
          destaque: { type: "boolean" },
          caixa: { type: "boolean" },
          animacao: { type: "string" },
        },
      },
      textos_na_tela: { type: "boolean" },
      broll: { type: "boolean" },
      transicao_predominante: { type: "string", enum: ["corte", "fade", "outra"] },
      tratamento_de_cor: { type: "string" },
      estrutura: {
        type: "object",
        additionalProperties: false,
        required: ["gancho_ate_s", "cta_de_s"],
        properties: { gancho_ate_s: { type: "number" }, cta_de_s: { type: "number" } },
      },
      observacoes: { type: "string" },
    },
  },
};

export function sistemaDaReceita(): string {
  return [
    "Você analisa a EDIÇÃO de um vídeo de referência por quadros (cada um com o tempo exato) e pelos tempos de corte medidos.",
    "Descreva só a edição: legenda (tem? posição, tamanho, palavras por vez, palavra em destaque, caixa, animação), textos na tela, B-roll, transição predominante, tratamento de cor, onde acaba o gancho e começa o CTA (tempos dos quadros; -1 se não houver).",
    "NÃO descreva nem copie o conteúdo (falas, marca, pessoas, produto). Português do Brasil, curto. Sem certeza: diga que não dá para ver.",
  ].join("\n");
}
