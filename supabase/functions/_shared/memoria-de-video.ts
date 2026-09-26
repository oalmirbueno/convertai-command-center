/**
 * Memória por vídeo da Mesa Vídeos (Frente V2, 25/09/2026), conforme o kit
 * audiovisual (MEMORIA-E-TEMPLATES.md): cada vídeo guarda as versões, o
 * feedback com o tempo do vídeo, o custo e a aprovação. Regras:
 * - aprovada é imutável: correção vira versão nova (pai = a anterior);
 * - rejeição também fica registrada (com o motivo);
 * - feedback explícito é da equipe ou do cliente, com autor e data;
 * - aprovação estética não é resultado de campanha (métrica fica fora daqui).
 *
 * Puro: sem Deno, sem banco. A tela, a função mesa-videos e os testes usam o mesmo.
 */

export const ESTADOS_DA_VERSAO = ["rascunho", "em_revisao", "aprovada", "rejeitada"] as const;
export type EstadoDaVersao = (typeof ESTADOS_DA_VERSAO)[number];

export const ROTULO_DO_ESTADO: Record<EstadoDaVersao, string> = {
  rascunho: "Rascunho",
  em_revisao: "Em revisão",
  aprovada: "Aprovada",
  rejeitada: "Rejeitada",
};

export interface FeedbackDaVersao {
  autor: string | null;
  texto: string;
  /** Segundo do vídeo a que o comentário se refere (null = geral). */
  tempo_s: number | null;
  em: string;
}

export interface VersaoDeVideo {
  id: string;
  client_id: string;
  video_id: string;
  titulo: string;
  numero: number;
  pai_id: string | null;
  arquivo_id: string | null;
  roteiro_id: string | null;
  estado: EstadoDaVersao;
  custo_usd: number | null;
  feedback: FeedbackDaVersao[];
  nota: string | null;
  decidido_por: string | null;
  decidido_em: string | null;
  motivo: string | null;
  criado_por: string | null;
  criado_em: string;
}

export const MAX_TEXTO_FEEDBACK = 1200;
export const MAX_FEEDBACKS = 200;
export const MAX_TITULO = 120;

const texto = (v: unknown, max: number) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const numeroOuNulo = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
};

export function normalizarFeedback(v: unknown): FeedbackDaVersao | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const t = texto(o.texto, MAX_TEXTO_FEEDBACK);
  if (!t) return null;
  const tempo = numeroOuNulo(o.tempo_s);
  return { autor: o.autor ? texto(o.autor, 80) : null, texto: t, tempo_s: tempo !== null && tempo >= 0 ? Math.round(tempo * 10) / 10 : null, em: String(o.em || "") };
}

export function normalizarVersao(v: unknown): VersaoDeVideo | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = String(o.id || "");
  const videoId = String(o.video_id || "");
  if (!id || !videoId) return null;
  const estado = (ESTADOS_DA_VERSAO as readonly string[]).indexOf(String(o.estado)) >= 0 ? (String(o.estado) as EstadoDaVersao) : "rascunho";
  const custo = numeroOuNulo(o.custo_usd);
  const n = Number(o.numero);
  return {
    id,
    client_id: String(o.client_id || ""),
    video_id: videoId,
    titulo: texto(o.titulo, MAX_TITULO) || "Vídeo",
    numero: isFinite(n) && n > 0 ? Math.floor(n) : 1,
    pai_id: o.pai_id ? String(o.pai_id) : null,
    arquivo_id: o.arquivo_id ? String(o.arquivo_id) : null,
    roteiro_id: o.roteiro_id ? String(o.roteiro_id) : null,
    estado,
    custo_usd: custo !== null && custo >= 0 ? custo : null,
    feedback: (Array.isArray(o.feedback) ? o.feedback : []).map(normalizarFeedback).filter((f): f is FeedbackDaVersao => !!f),
    nota: o.nota ? texto(o.nota, 600) : null,
    decidido_por: o.decidido_por ? String(o.decidido_por) : null,
    decidido_em: o.decidido_em ? String(o.decidido_em) : null,
    motivo: o.motivo ? texto(o.motivo, 400) : null,
    criado_por: o.criado_por ? String(o.criado_por) : null,
    criado_em: String(o.criado_em || ""),
  };
}

export const normalizarVersoes = (lista: unknown): VersaoDeVideo[] =>
  (Array.isArray(lista) ? lista : []).map(normalizarVersao).filter((v): v is VersaoDeVideo => !!v);

/** Número da próxima versão do vídeo (1 quando é a primeira). */
export function proximoNumero(versoes: Pick<VersaoDeVideo, "video_id" | "numero">[], videoId: string): number {
  return versoes.filter((v) => v.video_id === videoId).reduce((m, v) => Math.max(m, v.numero), 0) + 1;
}

/** Versão aprovada não muda (nem feedback novo, nem decisão nova): corrigir é criar versão nova. */
export function motivoParaNaoMudar(v: Pick<VersaoDeVideo, "estado">, mudanca: "feedback" | "decidir" | "editar"): string | null {
  if (v.estado === "aprovada") {
    return mudanca === "feedback"
      ? "Versão aprovada não recebe comentário novo: crie a próxima versão para corrigir."
      : "Versão aprovada é imutável: crie a próxima versão para corrigir.";
  }
  if (v.estado === "rejeitada" && mudanca === "decidir") return "Versão rejeitada: crie a próxima versão com a correção.";
  return null;
}

/** Acrescenta um comentário (lista nova; a original não muda). Lança com o motivo quando não pode. */
export function comFeedback(v: VersaoDeVideo, f: Omit<FeedbackDaVersao, "em">, agora: string): VersaoDeVideo {
  const motivo = motivoParaNaoMudar(v, "feedback");
  if (motivo) throw new Error(motivo);
  const novo = normalizarFeedback({ ...f, em: agora });
  if (!novo) throw new Error("Escreva o comentário.");
  if (v.feedback.length >= MAX_FEEDBACKS) throw new Error("Esta versão já tem comentários demais: crie a próxima versão.");
  return { ...v, feedback: v.feedback.concat([novo]) };
}

/** Aprovar ou rejeitar. Rejeitar pede motivo. */
export function decidir(v: VersaoDeVideo, decisao: "aprovar" | "rejeitar", quem: string, agora: string, motivo?: string | null): VersaoDeVideo {
  const trava = motivoParaNaoMudar(v, "decidir");
  if (trava) throw new Error(trava);
  const m = texto(motivo, 400);
  if (decisao === "rejeitar" && !m) throw new Error("Diga o motivo da rejeição (fica na memória do vídeo).");
  return { ...v, estado: decisao === "aprovar" ? "aprovada" : "rejeitada", decidido_por: quem, decidido_em: agora, motivo: m || null };
}

export interface ResumoDoVideo {
  video_id: string;
  titulo: string;
  versoes: VersaoDeVideo[];
  atual: VersaoDeVideo;
  aprovada: VersaoDeVideo | null;
  custo_total_usd: number | null;
  comentarios: number;
}

/** Vídeos com as versões em ordem (a mais nova primeiro no resumo), custo somado e a última aprovada. */
export function resumoPorVideo(versoes: VersaoDeVideo[]): ResumoDoVideo[] {
  const grupos: Record<string, VersaoDeVideo[]> = {};
  const ordem: string[] = [];
  versoes.forEach((v) => {
    if (!grupos[v.video_id]) {
      grupos[v.video_id] = [];
      ordem.push(v.video_id);
    }
    grupos[v.video_id].push(v);
  });
  return ordem
    .map((id) => {
      const lista = grupos[id].slice().sort((a, b) => a.numero - b.numero);
      const atual = lista[lista.length - 1];
      const aprovadas = lista.filter((v) => v.estado === "aprovada");
      const comCusto = lista.filter((v) => v.custo_usd !== null);
      return {
        video_id: id,
        titulo: atual.titulo,
        versoes: lista,
        atual,
        aprovada: aprovadas.length ? aprovadas[aprovadas.length - 1] : null,
        custo_total_usd: comCusto.length ? Math.round(comCusto.reduce((s, v) => s + (v.custo_usd || 0), 0) * 10000) / 10000 : null,
        comentarios: lista.reduce((s, v) => s + v.feedback.length, 0),
      };
    })
    .sort((a, b) => (a.atual.criado_em < b.atual.criado_em ? 1 : a.atual.criado_em > b.atual.criado_em ? -1 : 0));
}

/** "1:05" a partir de segundos. */
export function tempoDoVideo(s: number | null): string {
  if (s === null || !isFinite(s) || s < 0) return "";
  const t = Math.floor(s);
  const seg = t % 60;
  return `${Math.floor(t / 60)}:${seg < 10 ? `0${seg}` : seg}`;
}
