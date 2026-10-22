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
  /** 22/10/2026 (caminho Gerar): o pedido da Mesa Vídeos que fez esta cena em vídeo. */
  video?: VideoDaCena;
}

/** A cena feita por IA na Mesa Vídeos (o arquivo sai do pedido quando fica pronto). */
export interface VideoDaCena {
  pedido_id: string;
  motor: string;
  /** Assinatura da descrição e dos segundos quando foi pedida: mudou, a cena pede refazer. */
  assinatura: string;
  em: string;
}

/** Onde a fala de cada cena está dentro do MP3 da narração (tempo DO ARQUIVO). */
export interface TrechoDaNarracao {
  ordem: number;
  de_s: number;
  ate_s: number;
}

/** A narração da peça pela ElevenLabs (operação gerar da ação campanha_narracao). */
export interface NarracaoDoRoteiro {
  /** Caminho do MP3 no bucket mesa (pasta do cliente). */
  arquivo: string;
  arquivo_id: string | null;
  duracao_s: number;
  voz: { voice_id: string; nome: string };
  modelo: string;
  /** As falas lidas, juntas na ordem (mudou, a narração está desatualizada). */
  texto: string;
  cenas: TrechoDaNarracao[];
  /** Palavras com tempo DENTRO do arquivo (a música abaixa na voz, a legenda sai daqui). */
  palavras: Array<{ t: string; i: number; f: number }>;
  custo_usd: number;
  em: string;
}

/** O projeto montado na Mesa Edição (a versão que vai para o render). */
export interface MontagemDoRoteiro {
  versao_id: string;
  em: string;
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
  narracao?: NarracaoDoRoteiro;
  montagem?: MontagemDoRoteiro;
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VOICE_ID = /^[A-Za-z0-9]{8,64}$/;
const r3 = (n: unknown) => Math.round((Number(n) || 0) * 1000) / 1000;
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const curto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** O pedido de vídeo da cena, ou undefined quando não é válido. */
export function normalizarVideoDaCena(v: unknown): VideoDaCena | undefined {
  const o = obj(v);
  if (!o || typeof o.pedido_id !== "string" || !UUID.test(o.pedido_id)) return undefined;
  return { pedido_id: o.pedido_id, motor: curto(o.motor, 60), assinatura: curto(o.assinatura, 40), em: curto(o.em, 40) };
}

/** A narração gravada no item, ou undefined quando falta o essencial. */
export function normalizarNarracaoDoRoteiro(v: unknown): NarracaoDoRoteiro | undefined {
  const o = obj(v);
  const voz = o ? obj(o.voz) : null;
  if (!o || typeof o.arquivo !== "string" || !o.arquivo || o.arquivo.indexOf("..") >= 0 || !voz || typeof voz.voice_id !== "string" || !VOICE_ID.test(voz.voice_id)) return undefined;
  const cenas = (Array.isArray(o.cenas) ? o.cenas : [])
    .map((x) => obj(x))
    .filter((x): x is Record<string, unknown> => !!x && Number(x.ordem) >= 1)
    .slice(0, 8)
    .map((x) => ({ ordem: Math.round(Number(x.ordem)), de_s: Math.max(0, r3(x.de_s)), ate_s: Math.max(0, r3(x.ate_s)) }))
    .filter((x) => x.ate_s > x.de_s);
  const palavras = (Array.isArray(o.palavras) ? o.palavras : [])
    .map((x) => obj(x))
    .filter((x): x is Record<string, unknown> => !!x && typeof x.t === "string")
    .slice(0, 800)
    .map((x) => ({ t: String(x.t).slice(0, 60), i: Math.max(0, r3(x.i)), f: Math.max(0, r3(x.f)) }));
  return {
    arquivo: o.arquivo.slice(0, 300),
    arquivo_id: typeof o.arquivo_id === "string" && UUID.test(o.arquivo_id) ? o.arquivo_id : null,
    duracao_s: Math.max(0, r3(o.duracao_s)),
    voz: { voice_id: voz.voice_id, nome: curto(voz.nome, 80) || "Voz" },
    modelo: curto(o.modelo, 40),
    texto: typeof o.texto === "string" ? o.texto.slice(0, 4000) : "",
    cenas,
    palavras,
    custo_usd: Math.max(0, Math.round((Number(o.custo_usd) || 0) * 1e6) / 1e6),
    em: curto(o.em, 40),
  };
}

function normalizarMontagem(v: unknown): MontagemDoRoteiro | undefined {
  const o = obj(v);
  if (!o || typeof o.versao_id !== "string" || !UUID.test(o.versao_id)) return undefined;
  return { versao_id: o.versao_id, em: curto(o.em, 40) };
}

/** O roteiro em forma fixa (de 1 a 8 cenas, de 1 a 20 segundos cada), ou null sem cena. */
export function normalizarRoteiroDeVideo(v: unknown): RoteiroDeVideo | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const cenas = (Array.isArray(o.cenas) ? o.cenas : [])
    .map((x, i) => {
      const c = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      const video = normalizarVideoDaCena(c.video);
      return {
        ordem: i + 1,
        descricao: txt(c.descricao, 400),
        fala: txt(c.fala, 400),
        texto_na_tela: txt(c.texto_na_tela, 120),
        segundos: Math.max(1, Math.min(20, Math.round(Number(c.segundos) || 3))),
        ...(video ? { video } : {}),
      };
    })
    .filter((c) => c.descricao || c.fala || c.texto_na_tela)
    .slice(0, 8)
    .map((c, i) => ({ ...c, ordem: i + 1 }));
  if (!cenas.length) return null;
  const soma = cenas.reduce((s, c) => s + c.segundos, 0);
  const narracao = normalizarNarracaoDoRoteiro(o.narracao);
  const montagem = normalizarMontagem(o.montagem);
  return {
    gancho: txt(o.gancho, 200),
    cenas,
    duracao: Math.max(5, Math.min(90, soma)),
    trilha: txt(o.trilha, 160),
    cta: txt(o.cta, 200),
    ...(typeof o.gerado_em === "string" ? { gerado_em: o.gerado_em.slice(0, 40) } : {}),
    ...(narracao ? { narracao } : {}),
    ...(montagem ? { montagem } : {}),
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
