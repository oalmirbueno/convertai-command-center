import { chamarFuncao, ErroDaMesa } from "@/lib/mesa/api";
import type { ItemProposto } from "./mesaV4Api";
import type { NarracaoDoRoteiro } from "../../../supabase/functions/agente-calendario/modulos/roteiro-de-video";
import type { ModeloDeVoz } from "../../../supabase/functions/mesa-motion/modulos/narracao";

/**
 * Narração da peça de vídeo da campanha na tela (22/10/2026, caminho Gerar). A ação mora na função
 * agente-calendario (campanha_narracao, modulos/narracao-da-campanha.ts); as regras puras em
 * narracao-da-campanha-regras.ts. Custo antes, no padrão da casa: gerar sem `confirmado` volta 409
 * confirmar_custo e aqui vira { situacao: "confirmar_custo", custo_estimado_usd } (nada gasto).
 */

export interface VozDaNarracao {
  voice_id: string;
  nome: string;
  previa_url: string | null;
  descricao?: string;
  /** Voz que a marca já usa na Mesa Motion. */
  da_marca: boolean;
  padrao?: boolean;
}

export interface VozesDaNarracao {
  tem_chave: boolean;
  aviso_chave: string | null;
  aviso: string | null;
  vozes: VozDaNarracao[];
  modelos: ModeloDeVoz[];
  modelo_padrao: string;
}

export const chaveDasVozes = (campanhaId: string) => ["mesa", "campanha-narracao-vozes", campanhaId] as const;

const lista = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const texto = (v: unknown) => (typeof v === "string" ? v : "");

function chamar<T>(operacao: string, campanhaId: string, extra: Record<string, unknown> = {}): Promise<T> {
  return chamarFuncao<T>("agente-calendario", { acao: "campanha_narracao", operacao, campanha_id: campanhaId, ...extra });
}

/** As vozes da marca primeiro (a padrão no topo), depois as da conta da ElevenLabs, sem repetir. */
export async function lerVozesDaNarracao(campanhaId: string): Promise<VozesDaNarracao> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r: any = await chamar("vozes", campanhaId);
  const daMarca: VozDaNarracao[] = lista<Record<string, unknown>>(r && r.vozes_da_marca)
    .filter((v) => typeof v.voice_id === "string")
    .map((v) => ({ voice_id: String(v.voice_id), nome: texto(v.nome) || "Voz da marca", previa_url: texto(v.previa_url) || null, da_marca: true, padrao: v.padrao === true }))
    .sort((a, b) => Number(!!b.padrao) - Number(!!a.padrao));
  const ja = new Set(daMarca.map((v) => v.voice_id));
  const daConta: VozDaNarracao[] = lista<Record<string, unknown>>(r && r.vozes)
    .filter((v) => typeof v.voice_id === "string" && !ja.has(String(v.voice_id)))
    .map((v) => ({ voice_id: String(v.voice_id), nome: texto(v.nome) || "Voz", previa_url: texto(v.previa_url) || null, descricao: texto(v.descricao), da_marca: false }));
  return {
    tem_chave: !!(r && r.tem_chave),
    aviso_chave: r && typeof r.aviso_chave === "string" ? r.aviso_chave : null,
    aviso: r && typeof r.aviso === "string" ? r.aviso : null,
    vozes: daMarca.concat(daConta),
    modelos: lista<ModeloDeVoz>(r && r.modelos),
    modelo_padrao: r && typeof r.modelo_padrao === "string" ? r.modelo_padrao : "eleven_v4",
  };
}

export interface RespostaDaPeca {
  item?: ItemProposto;
  proposta?: unknown;
}

export type ResultadoDaNarracao =
  | { situacao: "confirmar_custo"; custo_estimado_usd: number; mensagem: string }
  | ({ situacao: "feito"; narracao: NarracaoDoRoteiro; link: string | null; avisos: string[]; custo_usd: number } & RespostaDaPeca);

export async function gerarNarracaoDaPeca(p: { campanhaId: string; temaId: string; vozId: string; vozNome: string; modelo: string; confirmado?: boolean }): Promise<ResultadoDaNarracao> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let r: any;
  try {
    r = await chamar("gerar", p.campanhaId, { tema_id: p.temaId, voz_id: p.vozId, voz_nome: p.vozNome, modelo: p.modelo, ...(p.confirmado ? { confirmado: true } : {}) });
  } catch (e) {
    if (e instanceof ErroDaMesa && e.codigo === "confirmar_custo") {
      return { situacao: "confirmar_custo", custo_estimado_usd: Number((e.detalhes || {}).custo_estimado_usd) || 0, mensagem: e.message };
    }
    throw e;
  }
  return {
    situacao: "feito",
    narracao: r.narracao as NarracaoDoRoteiro,
    link: typeof r.link === "string" ? r.link : null,
    avisos: lista<unknown>(r.avisos).filter((a): a is string => typeof a === "string" && !!a),
    custo_usd: Number(r.custo_usd) || 0,
    item: r.item,
    proposta: r.proposta,
  };
}

/** Grava na peça o pedido de vídeo de cada cena e (ou) a versão montada. Sem custo. */
export function registrarNaPeca(campanhaId: string, temaId: string, o: { cenas?: Array<{ ordem: number; pedido_id: string | null; motor?: string }>; montagem?: { versao_id: string } | null }): Promise<RespostaDaPeca> {
  return chamar<RespostaDaPeca>("registrar", campanhaId, { tema_id: temaId, ...(o.cenas ? { cenas: o.cenas } : {}), ...(o.montagem !== undefined ? { montagem: o.montagem } : {}) });
}
