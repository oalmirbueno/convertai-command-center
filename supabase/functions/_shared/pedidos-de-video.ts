/**
 * Pedidos preparados da Mesa Vídeos (Frente V2, 25/09/2026): "animar cena",
 * "transcrever" e "legendar". Preparar não gasta nada: grava o pedido com os
 * parâmetros, o executor e o custo estimado. Sem motor de vídeo (ou de
 * transcrição) configurado no catálogo ia_modelos, o executor fica "em breve"
 * e o custo da parte sem motor aparece como "Sem cotação", nunca US$ 0.
 *
 * Preços de referência: kit audiovisual V2 (precos-referencia.json, conferido
 * em 25/09/2026, sem teste de conta). Valem só para a parte de texto (direção
 * da cena, revisão da legenda); mídia, render, armazenamento, impostos e
 * câmbio ficam fora, como o próprio kit avisa.
 *
 * Puro: sem Deno, sem banco. A tela, a função mesa-videos e os testes usam o mesmo.
 */

export const PRECOS_REFERENCIA = {
  conferido_em: "2026-09-25",
  moeda: "USD",
  unidade: "1M tokens",
  conta_testada: false,
  fonte: "kit audiovisual V2 (precos-referencia.json)",
  modelos: [
    { modelo: "gpt-6-astra", rotulo: "GPT-6 Astra", entrada: 10, saida: 50, escopo: "Standard, contexto curto, sem cache", url: "https://developers.openai.com/api/docs/models/gpt-6-astra" },
    { modelo: "claude-opus-5.5", rotulo: "Claude Opus 5.5", entrada: 4, saida: 20, escopo: "base, sem cache", url: "https://platform.claude.com/docs/en/about-claude/pricing" },
    { modelo: "claude-sonnet-5", rotulo: "Claude Sonnet 5", entrada: 2, saida: 10, escopo: "base, sem cache", url: "https://platform.claude.com/docs/en/about-claude/pricing" },
  ],
  fora_da_conta: ["cache", "contexto longo", "prioridade e região", "ferramentas", "mídia", "render", "armazenamento", "impostos", "câmbio"],
} as const;

export type ModeloDeReferencia = (typeof PRECOS_REFERENCIA.modelos)[number]["modelo"];
export const MODELO_PADRAO_DO_TEXTO: ModeloDeReferencia = "claude-sonnet-5";

export const TIPOS_DE_PEDIDO = ["animar_cena", "transcrever", "legendar"] as const;
export type TipoDePedido = (typeof TIPOS_DE_PEDIDO)[number];

export const ROTULO_DO_PEDIDO: Record<TipoDePedido, string> = {
  animar_cena: "Animar cena",
  transcrever: "Transcrever",
  legendar: "Legendar",
};

export const ESTADOS_DO_PEDIDO = ["em_breve", "aguardando_confirmacao", "cancelado"] as const;
export type EstadoDoPedido = (typeof ESTADOS_DO_PEDIDO)[number];

export const ROTULO_DO_ESTADO_DO_PEDIDO: Record<EstadoDoPedido, string> = {
  em_breve: "Preparado · executor em breve",
  aguardando_confirmacao: "Preparado · falta confirmar",
  cancelado: "Cancelado",
};

export const MOVIMENTOS_DE_CAMERA = [
  { valor: "parada", rotulo: "Câmera parada" },
  { valor: "travelling", rotulo: "Travelling" },
  { valor: "pan", rotulo: "Pan" },
  { valor: "orbita", rotulo: "Órbita" },
  { valor: "zoom_lento", rotulo: "Zoom lento" },
  { valor: "na_mao", rotulo: "Câmera na mão" },
  { valor: "subida", rotulo: "Subida" },
] as const;

export const DURACAO_MIN_S = 2;
export const DURACAO_MAX_S = 15;
export const DURACAO_PADRAO_S = 5;

export interface ParametrosDoAnimar {
  duracao_s: number;
  movimento: string;
  audio: { fala: string | null; trilha: string | null; efeitos: string | null };
  /** Id do motor de vídeo no catálogo (ia_modelos) quando existir. */
  motor_video: string | null;
}

export interface ParametrosDaFala {
  /** Duração do take em segundos (para estimar); null = desconhecida. */
  duracao_s: number | null;
  idioma: string;
  /** Nomes, marcas e valores que a transcrição deve respeitar (ASR erra nome de marca). */
  vocabulario: string[];
}

export type ParametrosDoPedido = ParametrosDoAnimar | ParametrosDaFala;

const textoCurto = (v: unknown, max: number): string | null => {
  const s = String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return s || null;
};

export function normalizarParametros(tipo: TipoDePedido, bruto: unknown): ParametrosDoPedido {
  const o = bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>) : {};
  if (tipo === "animar_cena") {
    const d = Number(o.duracao_s);
    const mov = String(o.movimento || "");
    const a = o.audio && typeof o.audio === "object" ? (o.audio as Record<string, unknown>) : {};
    return {
      duracao_s: isFinite(d) && d > 0 ? Math.max(DURACAO_MIN_S, Math.min(DURACAO_MAX_S, Math.round(d))) : DURACAO_PADRAO_S,
      movimento: MOVIMENTOS_DE_CAMERA.some((m) => m.valor === mov) ? mov : "parada",
      audio: { fala: textoCurto(a.fala, 400), trilha: textoCurto(a.trilha, 200), efeitos: textoCurto(a.efeitos, 200) },
      motor_video: textoCurto(o.motor_video, 120),
    };
  }
  const d = Number(o.duracao_s);
  const vocab = Array.isArray(o.vocabulario) ? o.vocabulario : String(o.vocabulario || "").split(",");
  return {
    duracao_s: isFinite(d) && d > 0 ? Math.round(d * 10) / 10 : null,
    idioma: textoCurto(o.idioma, 10) || "pt-BR",
    vocabulario: vocab
      .map((x) => textoCurto(x, 60))
      .filter((x): x is string => !!x)
      .slice(0, 40),
  };
}

// ------------------------------------------------------------------ custo

export interface ParteDoCusto {
  rotulo: string;
  /** null = sem cotação (sem motor ou sem preço de referência). */
  usd: number | null;
  detalhe: string;
}

export interface EstimativaDoPedido {
  partes: ParteDoCusto[];
  /** Soma das partes com cotação. */
  cotado_usd: number;
  /** Alguma parte sem cotação: o total não está completo. */
  incompleta: boolean;
  moeda: "USD";
  referencia: string;
}

function precoDoTexto(modelo: string, entrada: number, saida: number): number | null {
  const m = PRECOS_REFERENCIA.modelos.find((x) => x.modelo === modelo);
  if (!m) return null;
  return Math.round(((entrada * m.entrada + saida * m.saida) / 1000000) * 10000) / 10000;
}

/** Tokens da fala: ~150 palavras por minuto, ~1,4 token por palavra em português. */
export const tokensDaFala = (duracaoS: number) => Math.ceil((duracaoS / 60) * 150 * 1.4);

export function estimarPedido(tipo: TipoDePedido, p: ParametrosDoPedido, modeloDoTexto: string = MODELO_PADRAO_DO_TEXTO): EstimativaDoPedido {
  const nome = (PRECOS_REFERENCIA.modelos.find((x) => x.modelo === modeloDoTexto) || { rotulo: modeloDoTexto }).rotulo;
  const partes: ParteDoCusto[] = [];
  if (tipo === "animar_cena") {
    const a = p as ParametrosDoAnimar;
    partes.push({ rotulo: "Direção da cena (texto)", usd: precoDoTexto(modeloDoTexto, 6000, 1500), detalhe: `${nome}, ~6 mil tokens de entrada e ~1,5 mil de saída` });
    partes.push({
      rotulo: `Vídeo de ${a.duracao_s} s`,
      usd: null,
      detalhe: a.motor_video ? `motor ${a.motor_video}: sem preço de referência por segundo` : "sem motor de vídeo configurado",
    });
  } else {
    const f = p as ParametrosDaFala;
    partes.push({ rotulo: "Transcrição com tempos (fala)", usd: null, detalhe: "sem motor de transcrição configurado" });
    if (f.duracao_s) {
      const t = tokensDaFala(f.duracao_s);
      partes.push({
        rotulo: tipo === "legendar" ? "Legenda revisada (texto)" : "Revisão de nomes e valores (texto)",
        usd: precoDoTexto(modeloDoTexto, t * 2 + 1500, t),
        detalhe: `${nome}, fala de ${Math.round(f.duracao_s)} s`,
      });
    } else {
      partes.push({ rotulo: "Revisão do texto", usd: null, detalhe: "duração do take desconhecida" });
    }
  }
  const cotado = partes.reduce((s, x) => s + (x.usd || 0), 0);
  return {
    partes,
    cotado_usd: Math.round(cotado * 10000) / 10000,
    incompleta: partes.some((x) => x.usd === null),
    moeda: "USD",
    referencia: `${PRECOS_REFERENCIA.fonte}, conferido em ${PRECOS_REFERENCIA.conferido_em}; fora da conta: ${PRECOS_REFERENCIA.fora_da_conta.join(", ")}`,
  };
}

/** "~US$ 0,03 + sem cotação" (nunca US$ 0 quando falta cotação). */
export function textoDaEstimativa(e: Pick<EstimativaDoPedido, "cotado_usd" | "incompleta" | "partes">): string {
  const temCotado = e.partes.some((x) => x.usd !== null);
  const valor = `US$ ${e.cotado_usd.toFixed(e.cotado_usd > 0 && e.cotado_usd < 0.1 ? 4 : 2).replace(".", ",")}`;
  if (!temCotado) return "Sem cotação";
  return e.incompleta ? `~${valor} + parte sem cotação` : `~${valor}`;
}

// ------------------------------------------------------------------ executor

export interface ModeloDoCatalogo {
  id: string;
  tipo: string;
  ativo: boolean;
  rotulo?: string | null;
}

/**
 * Quem executaria o pedido. Motor de vídeo = modelo ativo do catálogo com tipo
 * "video" (hoje o catálogo só tem texto e imagem); transcrição = tipo "audio".
 * Sem ele, "em_breve". Nunca troca o motor escolhido pela equipe.
 */
export function executorDoPedido(tipo: TipoDePedido, catalogo: ModeloDoCatalogo[], escolhido?: string | null): { executor: string; rotulo: string; estado: EstadoDoPedido } {
  const tipoDoMotor = tipo === "animar_cena" ? "video" : "audio";
  const ativos = (catalogo || []).filter((m) => m && m.ativo && m.tipo === tipoDoMotor);
  const m = (escolhido && ativos.find((x) => x.id === escolhido)) || ativos[0] || null;
  if (!m) return { executor: "em_breve", rotulo: tipo === "animar_cena" ? "Motor de vídeo em breve" : "Transcrição em breve", estado: "em_breve" };
  return { executor: m.id, rotulo: m.rotulo || m.id, estado: "aguardando_confirmacao" };
}

/** Chave que impede o mesmo pedido duas vezes (mesmo alvo, tipo e parâmetros). */
export function chaveDoPedido(tipo: TipoDePedido, alvo: Record<string, unknown>, p: ParametrosDoPedido): string {
  const partes = [tipo, String(alvo.canvas_id || ""), String(alvo.no_id || ""), String(alvo.arquivo_id || ""), JSON.stringify(p)];
  let h = 5381;
  const s = partes.join("|");
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${tipo}:${(h >>> 0).toString(36)}`;
}
