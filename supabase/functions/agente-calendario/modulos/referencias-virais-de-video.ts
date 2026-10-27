/**
 * Referências virais para o vídeo de IA da pauta (27/10/2026). Dono: "conseguir colocar referências e buscar
 * referências virais de vídeos gerados com IA com base no nicho e vídeos satisfatórios, para replicar".
 *
 * Uma pesquisa na web do motor de texto (a mesma da pesquisa de mercado da campanha) devolve vídeos curtos REAIS
 * que viralizaram: feitos com IA ou "satisfatórios" (transformação, processo, antes e depois, encaixe perfeito)
 * do universo do cliente. Cada cartão traz o link que a busca citou, o porquê de funcionar e a ESTRUTURA (as
 * batidas de cena, o movimento de câmera e os segundos), descrita pela forma e nunca pelo conteúdo: a tela usa
 * a estrutura com o produto e as fotos do próprio cliente. Link que a busca não citou não entra.
 *
 * Puro: a função, a tela e os testes (vitest) leem este arquivo. Sem travessão.
 */
import { movimentoDoTexto, type MovimentoDaCena } from "../../mesa-videos/modulos/composicao-no-pedido.ts";

export const TIPOS_DE_REFERENCIA_VIRAL = ["ia", "satisfatorio"] as const;
export type TipoDeReferenciaViral = (typeof TIPOS_DE_REFERENCIA_VIRAL)[number];
export const FOCOS_DA_BUSCA_VIRAL = ["ambos", "ia", "satisfatorio"] as const;
export type FocoDaBuscaViral = (typeof FOCOS_DA_BUSCA_VIRAL)[number];
export const PLATAFORMAS = ["instagram", "tiktok", "youtube", "outro"] as const;
export type PlataformaDaReferencia = (typeof PLATAFORMAS)[number];

export const MAX_REFERENCIAS_VIRAIS = 6;
export const MAX_BATIDAS = 6;

export interface BatidaDaEstrutura {
  /** A forma da cena (o que a câmera mostra, sem o produto de outra marca). */
  o_que: string;
  movimento: MovimentoDaCena;
  segundos: number;
}

export interface ReferenciaViral {
  id: string;
  titulo: string;
  link: string;
  plataforma: PlataformaDaReferencia;
  tipo: TipoDeReferenciaViral;
  porque_funciona: string;
  gancho: string;
  /** O sinal de alcance como a fonte disse ("2,3 mi de views"), ou vazio. */
  sinal: string;
  estrutura: BatidaDaEstrutura[];
}

const txt = (v: unknown, max: number) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().replace(/\s*[–—]\s*/g, ", ").slice(0, max);

/** Mesmo endereço, sem barra final, âncora nem parâmetros de rastreio (para cruzar o link com as fontes da busca). */
export function chaveDoLink(u: string): string {
  const s = String(u || "").trim().replace(/#.*$/, "");
  const [base, consulta] = s.split("?");
  const mantidos = (consulta || "")
    .split("&")
    .filter((p) => p && !/^(utm_|igsh|igshid|si|feature|fbclid|_t|_r)=?/i.test(p));
  return `${base.replace(/\/+$/, "").toLowerCase()}${mantidos.length ? `?${mantidos.join("&")}` : ""}`;
}

export function plataformaDoLink(link: string): PlataformaDaReferencia {
  const s = link.toLowerCase();
  if (/instagram\.com/.test(s)) return "instagram";
  if (/tiktok\.com/.test(s)) return "tiktok";
  if (/youtube\.com|youtu\.be/.test(s)) return "youtube";
  return "outro";
}

const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
};

/** Esquema da saída do modelo (estrito: tudo obrigatório, sem restrição numérica). */
export const ESQUEMA_DAS_REFERENCIAS_VIRAIS = {
  nome: "referencias_virais_de_video",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      referencias: {
        type: "array",
        description: "4 a 6 vídeos curtos reais, cada um com o link de uma página que a busca trouxe.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            titulo: { type: "string", description: "Nome curto do vídeo ou do perfil, como a fonte mostra." },
            link: { type: "string", description: "https de uma página real da busca (o vídeo ou a matéria sobre ele)." },
            tipo: { type: "string", enum: [...TIPOS_DE_REFERENCIA_VIRAL] },
            porque_funciona: { type: "string", description: "1 a 2 frases: gancho, ritmo, loop, transformação ou satisfação que prende." },
            gancho: { type: "string", description: "O que prende nos 2 primeiros segundos, descrito pela forma." },
            sinal: { type: "string", description: "Alcance que a fonte cita (views, curtidas), ou vazio." },
            estrutura: {
              type: "array",
              description: "3 a 5 batidas em ordem, pela FORMA (sem o produto de outra marca).",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  o_que: { type: "string" },
                  movimento: { type: "string", description: "Movimento de câmera da batida." },
                  segundos: { type: "number" },
                },
                required: ["o_que", "movimento", "segundos"],
              },
            },
          },
          required: ["titulo", "link", "tipo", "porque_funciona", "gancho", "sinal", "estrutura"],
        },
      },
    },
    required: ["referencias"],
  },
} as const;

export interface PedidoDaBuscaViral {
  hoje: string;
  foco: FocoDaBuscaViral;
  nicho: string;
  publico?: string | null;
  tema?: string | null;
  hype?: string | null;
  ganchos?: string | null;
}

const ROTULO_DO_FOCO: Record<FocoDaBuscaViral, string> = {
  ambos: "vídeos feitos com IA E vídeos satisfatórios",
  ia: "vídeos feitos com IA (gerados por Kling, Veo, Seedance, Sora, Runway, Hailuo e parecidos)",
  satisfatorio: "vídeos satisfatórios (oddly satisfying: transformação, processo, antes e depois, encaixe perfeito, limpeza, corte, ASMR visual)",
};

/** O pedido ao modelo com a busca ligada. */
export function pedidoDaBuscaViral(p: PedidoDaBuscaViral): string {
  return [
    `Hoje é ${p.hoje}.`,
    `NICHO E NEGÓCIO DO CLIENTE: ${txt(p.nicho, 900)}`,
    p.publico ? `PÚBLICO: ${txt(p.publico, 300)}` : "",
    p.tema ? `PAUTA DO VÍDEO: ${txt(p.tema, 300)}` : "",
    p.hype ? `ASSUNTOS EM ALTA NO NICHO (use se casar):\n${String(p.hype).slice(0, 1500)}` : "",
    p.ganchos ? `GANCHOS QUE VENCEM NO NICHO (régua do gancho, não copie):\n${String(p.ganchos).slice(0, 2500)}` : "",
    "",
    `TAREFA: pesquise na web ${ROTULO_DO_FOCO[p.foco]} que viralizaram nos últimos 12 meses em Reels, TikTok ou Shorts e que servem de molde para um vídeo curto vertical deste cliente (o universo dele: o produto, o serviço, o material, o ambiente, o resultado que ele entrega).`,
    "Devolva de 4 a 6 referências. Para cada uma: o título, o link (https) de uma página REAL que a busca trouxe (o próprio vídeo ou uma matéria sobre ele), o tipo (ia ou satisfatorio), por que funciona, o gancho dos 2 primeiros segundos e o alcance que a fonte cita (ou vazio).",
    "Na estrutura, descreva de 3 a 5 batidas pela FORMA, para replicar com o produto e as fotos do próprio cliente: o que a câmera mostra (sem a marca ou o produto do vídeo original), o movimento de câmera e os segundos de cada batida.",
    "Nada inventado: vídeo sem link real da busca não entra. Sem política, sem pessoa famosa como molde e sem conteúdo para menores. Português do Brasil, sem travessão.",
  ].filter((l) => l !== "").join("\n");
}

/**
 * A resposta da busca em forma fixa: só os cartões cujo link a busca citou (sem fontes, nada entra), sem
 * repetir link, até MAX_REFERENCIAS_VIRAIS. A estrutura sai com o movimento da lista da tela e de 2 a 10 s por
 * batida.
 */
export function referenciasComFonte(v: unknown, fontesDaBusca: string[], foco: FocoDaBuscaViral = "ambos"): ReferenciaViral[] {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const citadas = new Set(fontesDaBusca.map(chaveDoLink));
  const vistos = new Set<string>();
  const saida: ReferenciaViral[] = [];
  for (const x of Array.isArray(o.referencias) ? o.referencias : []) {
    const r = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const link = txt(r.link, 500);
    const chave = chaveDoLink(link);
    if (link.indexOf("https://") !== 0 || !citadas.has(chave) || vistos.has(chave)) continue;
    const tipo: TipoDeReferenciaViral = r.tipo === "ia" ? "ia" : "satisfatorio";
    if (foco !== "ambos" && tipo !== foco) continue;
    const estrutura = (Array.isArray(r.estrutura) ? r.estrutura : [])
      .map((b) => {
        const q = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
        const oQue = txt(q.o_que, 200);
        return { o_que: oQue, movimento: movimentoDoTexto(q.movimento, movimentoDoTexto(oQue)), segundos: Math.max(2, Math.min(10, Math.round(Number(q.segundos) || 4))) };
      })
      .filter((b) => b.o_que)
      .slice(0, MAX_BATIDAS);
    const titulo = txt(r.titulo, 140);
    if (!titulo || !estrutura.length) continue;
    vistos.add(chave);
    saida.push({
      id: fnv(chave),
      titulo,
      link,
      plataforma: plataformaDoLink(link),
      tipo,
      porque_funciona: txt(r.porque_funciona, 400),
      gancho: txt(r.gancho, 240),
      sinal: txt(r.sinal, 80),
      estrutura,
    });
    if (saida.length >= MAX_REFERENCIAS_VIRAIS) break;
  }
  return saida;
}

/** O foco que a tela pediu (padrão: os dois). */
export function focoDaBusca(v: unknown): FocoDaBuscaViral {
  return (FOCOS_DA_BUSCA_VIRAL as readonly string[]).indexOf(String(v)) >= 0 ? (v as FocoDaBuscaViral) : "ambos";
}
