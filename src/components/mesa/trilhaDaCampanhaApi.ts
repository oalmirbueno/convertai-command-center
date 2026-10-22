import { chamarFuncao, ErroDaMesa } from "@/lib/mesa/api";

/**
 * Trilha e efeitos da campanha na tela (22/10/2026). A ação mora na função
 * agente-calendario (campanha_trilha, supabase/functions/agente-calendario/
 * modulos/trilha-da-campanha.ts); as regras puras (tema, tom, pedido sem voz,
 * pacotes de efeitos, provedor suno desligado) em trilha-da-campanha-regras.ts.
 *
 * Custo antes, no padrão da casa: gerar sem `confirmado` volta 409
 * confirmar_custo e aqui vira { situacao: "confirmar_custo", custo_estimado_usd }
 * (nada gasto); com `confirmado: true` gera e cobra na carteira do cliente.
 */

export interface SomDaCampanha {
  id: string;
  tipo: "trilha" | "efeito";
  titulo: string;
  duracao_s: number;
  favorito: boolean;
  loop: boolean;
  tema: string | null;
  caminho: string;
  link: string | null;
  escolhida: boolean;
  criado_em: string;
}

export interface TrilhaEscolhida {
  arquivo: string;
  titulo: string;
  duracao: number;
  origem: string;
  som_id?: string;
  file_id?: string;
  loop?: boolean;
  escolhida_em?: string;
}

export interface ProvedorNaTela {
  id: string;
  nome: string;
  ligado: boolean;
  motivo: string | null;
}

export interface EstadoDaTrilha {
  tem_chave: boolean;
  aviso_chave: string | null;
  provedores: ProvedorNaTela[];
  tema: { id: string; rotulo: string };
  temas: Array<{ id: string; rotulo: string }>;
  pacote: Array<{ id: string; rotulo: string; duracao_s: number }>;
  custos: { trilha: Record<string, number>; efeito: number };
  sons: SomDaCampanha[];
  escolhida: TrilhaEscolhida | null;
}

export const DURACOES = [15, 30, 60] as const;

export const chaveDaTrilha = (campanhaId: string) => ["mesa", "campanha-trilha", campanhaId] as const;

const lista = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

function normalizarSom(v: unknown): SomDaCampanha | null {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  if (!o || typeof o.id !== "string") return null;
  return {
    id: o.id,
    tipo: o.tipo === "efeito" ? "efeito" : "trilha",
    titulo: typeof o.titulo === "string" ? o.titulo : "Som",
    duracao_s: Number(o.duracao_s) || 0,
    favorito: o.favorito === true,
    loop: o.loop === true,
    tema: typeof o.tema === "string" ? o.tema : null,
    caminho: typeof o.caminho === "string" ? o.caminho : "",
    link: typeof o.link === "string" ? o.link : null,
    escolhida: o.escolhida === true,
    criado_em: typeof o.criado_em === "string" ? o.criado_em : "",
  };
}

export const normalizarSons = (v: unknown): SomDaCampanha[] => lista<unknown>(v).map(normalizarSom).filter((s): s is SomDaCampanha => !!s);

/** A trilha escolhida em briefing.trilha (o que as peças de vídeo e Reels levam como sugestão). */
export function trilhaSugeridaDaCampanha(briefing: unknown): TrilhaEscolhida | null {
  const b = briefing && typeof briefing === "object" ? (briefing as Record<string, unknown>) : null;
  const t = b && b.trilha && typeof b.trilha === "object" ? (b.trilha as Record<string, unknown>) : null;
  if (!t || typeof t.arquivo !== "string" || !t.arquivo) return null;
  return {
    arquivo: t.arquivo,
    titulo: typeof t.titulo === "string" ? t.titulo : "Trilha da campanha",
    duracao: Number(t.duracao) || 0,
    origem: typeof t.origem === "string" ? t.origem : "elevenlabs",
    ...(typeof t.som_id === "string" ? { som_id: t.som_id } : {}),
    ...(typeof t.file_id === "string" ? { file_id: t.file_id } : {}),
    ...(t.loop === true ? { loop: true } : {}),
    ...(typeof t.escolhida_em === "string" ? { escolhida_em: t.escolhida_em } : {}),
  };
}

function chamar<T>(operacao: string, campanhaId: string, extra: Record<string, unknown> = {}): Promise<T> {
  return chamarFuncao<T>("agente-calendario", { acao: "campanha_trilha", operacao, campanha_id: campanhaId, ...extra });
}

export async function lerTrilhaDaCampanha(campanhaId: string): Promise<EstadoDaTrilha> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r: any = await chamar("estado", campanhaId);
  return {
    tem_chave: r && r.tem_chave === true,
    aviso_chave: r && typeof r.aviso_chave === "string" ? r.aviso_chave : null,
    provedores: lista<ProvedorNaTela>(r && r.provedores),
    tema: r && r.tema && typeof r.tema.id === "string" ? r.tema : { id: "institucional", rotulo: "Institucional" },
    temas: lista(r && r.temas),
    pacote: lista(r && r.pacote),
    custos: r && r.custos && typeof r.custos === "object" ? r.custos : { trilha: {}, efeito: 0 },
    sons: normalizarSons(r && r.sons),
    escolhida: trilhaSugeridaDaCampanha({ trilha: r && r.escolhida }),
  };
}

export type ResultadoDaGeracao =
  | { situacao: "confirmar_custo"; custo_estimado_usd: number; mensagem: string }
  | { situacao: "feito"; sons: SomDaCampanha[]; avisos: string[]; custo_usd: number };

async function gerar(operacao: "gerar_trilha" | "gerar_efeitos", campanhaId: string, corpo: Record<string, unknown>): Promise<ResultadoDaGeracao> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let r: any;
  try {
    r = await chamar(operacao, campanhaId, corpo);
  } catch (e) {
    if (e instanceof ErroDaMesa && e.codigo === "confirmar_custo") {
      return { situacao: "confirmar_custo", custo_estimado_usd: Number((e.detalhes || {}).custo_estimado_usd) || 0, mensagem: e.message };
    }
    throw e;
  }
  return {
    situacao: "feito",
    sons: normalizarSons(r && r.sons),
    avisos: lista<unknown>(r && r.avisos).filter((a): a is string => typeof a === "string" && !!a),
    custo_usd: Number(r && r.custo_usd) || 0,
  };
}

export function gerarTrilhasDaCampanha(p: { campanhaId: string; duracao: number; loop: boolean; opcoes: number; extra?: string; tema?: string | null; confirmado?: boolean }) {
  return gerar("gerar_trilha", p.campanhaId, {
    duracao: p.duracao,
    loop: p.loop,
    opcoes: p.opcoes,
    ...(p.extra && p.extra.trim() ? { extra: p.extra.trim() } : {}),
    ...(p.tema ? { tema: p.tema } : {}),
    ...(p.confirmado ? { confirmado: true } : {}),
  });
}

export function gerarEfeitosDaCampanha(p: { campanhaId: string; efeitos?: string[]; livre?: string; tema?: string | null; confirmado?: boolean }) {
  return gerar("gerar_efeitos", p.campanhaId, {
    ...(p.livre && p.livre.trim() ? { livre: p.livre.trim() } : { efeitos: p.efeitos || [] }),
    ...(p.tema ? { tema: p.tema } : {}),
    ...(p.confirmado ? { confirmado: true } : {}),
  });
}

/** Vira a trilha da campanha (null tira). O MP3 vai para Arquivos do cliente. */
export async function escolherTrilhaDaCampanha(campanhaId: string, somId: string | null): Promise<{ trilha: TrilhaEscolhida | null; aviso: string | null; campanha: unknown }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r: any = await chamar("escolher", campanhaId, { som_id: somId });
  return { trilha: trilhaSugeridaDaCampanha({ trilha: r && r.trilha }), aviso: r && typeof r.aviso === "string" ? r.aviso : null, campanha: r && r.campanha };
}

export async function favoritarSom(campanhaId: string, somId: string, favorito: boolean): Promise<void> {
  await chamar("favoritar", campanhaId, { som_id: somId, favorito });
}

/** Link assinado do Storage com o nome do arquivo para baixar o MP3. */
export function linkParaBaixar(link: string, titulo: string): string {
  const nome = `${titulo.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "trilha"}.mp3`;
  return `${link}${link.indexOf("?") >= 0 ? "&" : "?"}download=${encodeURIComponent(nome)}`;
}

/** Barras da ondinha sem baixar o áudio (forma estável pelo id); a real entra quando toca. */
export function ondaPeloId(id: string, barras = 40): number[] {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  const saida: number[] = [];
  for (let i = 0; i < barras; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    const base = 0.35 + 0.45 * Math.abs(Math.sin((i / barras) * Math.PI));
    saida.push(Math.max(0.12, Math.min(1, base * (0.55 + (h % 1000) / 1000 * 0.6))));
  }
  return saida;
}

/** Picos reais do MP3 (Web Audio; Safari antigo usa webkitAudioContext e a forma de callback). */
export async function picosDoAudio(link: string, barras = 40): Promise<number[] | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const Ctx = w.AudioContext || w.webkitAudioContext;
    if (!Ctx) return null;
    const bytes = await (await fetch(link)).arrayBuffer();
    const ctx = new Ctx();
    const buf: AudioBuffer = await new Promise((ok, falha) => ctx.decodeAudioData(bytes, ok, falha));
    if (ctx.close) ctx.close();
    const dados = buf.getChannelData(0);
    const passo = Math.max(1, Math.floor(dados.length / barras));
    const picos: number[] = [];
    let maior = 0;
    for (let i = 0; i < barras; i++) {
      let pico = 0;
      for (let j = i * passo; j < Math.min(dados.length, (i + 1) * passo); j += 64) pico = Math.max(pico, Math.abs(dados[j]));
      picos.push(pico);
      maior = Math.max(maior, pico);
    }
    return maior > 0 ? picos.map((p) => Math.max(0.08, p / maior)) : null;
  } catch {
    return null;
  }
}
