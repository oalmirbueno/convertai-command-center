/**
 * Roteiro das peças de vídeo da campanha (22/10/2026, dono: "roteiros de vídeos ali mesmo, tudo de forma
 * intuitiva e fácil, sem sair da tela"). O roteiro mora no item da série (roteiro_video): gancho, cenas com
 * fala e texto na tela, duração e a trilha sugerida da campanha. A direção do vídeo (video.prompt e
 * video.narracao), que o estúdio de vídeo da pauta lê, sai do roteiro aqui, sem modelo.
 * Puro (a tela e as funções importam o mesmo). Sem lookbehind, sem classe Unicode e sem grupo nomeado.
 */

export interface CenaDoRoteiro {
  ordem: number;
  /** O que aparece (imagem, ação, enquadramento). */
  descricao: string;
  /** O que se fala (narração ou a pessoa falando); pode ser vazio. */
  fala: string;
  /** O texto que aparece na tela; pode ser vazio. */
  texto_na_tela: string;
  segundos: number;
}

export interface RoteiroDeVideo {
  gancho: string;
  cenas: CenaDoRoteiro[];
  /** Duração total em segundos (a soma das cenas, de 5 a 90). */
  duracao: number;
  /** A trilha sugerida (o título da trilha da campanha ou o clima pedido). */
  trilha: string;
  cta: string;
  gerado_em?: string;
}

export const ESQUEMA_DO_ROTEIRO_DE_VIDEO = {
  nome: "roteiro_do_video_da_campanha",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["gancho", "cenas", "trilha", "cta"],
    properties: {
      gancho: { type: "string" },
      cenas: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["descricao", "fala", "texto_na_tela", "segundos"],
          properties: { descricao: { type: "string" }, fala: { type: "string" }, texto_na_tela: { type: "string" }, segundos: { type: "integer" } },
        },
      },
      trilha: { type: "string" },
      cta: { type: "string" },
    },
  },
};

const txt = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().replace(/\s*[–—]\s*/g, ", ").slice(0, max) : "");

/** O roteiro em forma fixa (de 1 a 8 cenas, de 1 a 20 segundos cada), ou null sem cena. */
export function normalizarRoteiroDeVideo(v: unknown): RoteiroDeVideo | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const cenas = (Array.isArray(o.cenas) ? o.cenas : [])
    .map((x, i) => {
      const c = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      return {
        ordem: i + 1,
        descricao: txt(c.descricao, 400),
        fala: txt(c.fala, 400),
        texto_na_tela: txt(c.texto_na_tela, 120),
        segundos: Math.max(1, Math.min(20, Math.round(Number(c.segundos) || 3))),
      };
    })
    .filter((c) => c.descricao || c.fala || c.texto_na_tela)
    .slice(0, 8)
    .map((c, i) => ({ ...c, ordem: i + 1 }));
  if (!cenas.length) return null;
  const soma = cenas.reduce((s, c) => s + c.segundos, 0);
  return {
    gancho: txt(o.gancho, 200),
    cenas,
    duracao: Math.max(5, Math.min(90, soma)),
    trilha: txt(o.trilha, 160),
    cta: txt(o.cta, 200),
    ...(typeof o.gerado_em === "string" ? { gerado_em: o.gerado_em.slice(0, 40) } : {}),
  };
}

/** A direção que o estúdio de vídeo lê (prompt e narração), tirada do roteiro. */
export function direcaoDoRoteiro(r: RoteiroDeVideo): { prompt: string; narracao: string } {
  const prompt = [
    `Gancho nos primeiros segundos: ${r.gancho}.`,
    ...r.cenas.map((c) => `Cena ${c.ordem} (${c.segundos}s): ${c.descricao}${c.texto_na_tela ? `. Texto na tela: "${c.texto_na_tela}"` : ""}`),
    r.cta ? `Fecha com: ${r.cta}.` : "",
    r.trilha ? `Trilha: ${r.trilha}.` : "",
  ].filter(Boolean).join("\n");
  const narracao = r.cenas.map((c) => c.fala).filter(Boolean).join(" ");
  return { prompt: prompt.slice(0, 3000), narracao: narracao.slice(0, 1500) };
}

/** O que falta no roteiro (para a tela avisar antes de abrir no estúdio). */
export function faltasDoRoteiro(r: RoteiroDeVideo | null): string[] {
  if (!r) return ["sem roteiro"];
  const faltas: string[] = [];
  if (!r.gancho) faltas.push("gancho");
  if (!r.cenas.some((c) => c.fala || c.texto_na_tela)) faltas.push("fala ou texto na tela");
  if (!r.cta) faltas.push("CTA");
  return faltas;
}
