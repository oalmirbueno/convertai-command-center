/**
 * Render pela fila (frente EDT, F1, 30/09/2026): o que a função editor-video,
 * o worker (workers/render) e a tela precisam concordar. Puro e sem import.
 *
 * Um pedido por clique (uid) e no máximo UM ativo por versão e tipo
 * (render_final, amostra, onda): pedir de novo devolve o que já está na fila.
 * O worker pega pela RPC render_pedidos_pegar (FOR UPDATE SKIP LOCKED, trava
 * com prazo); a tela consulta no máximo a cada 15 s (sem laço).
 */

export const TIPOS_DE_RENDER = ["render_final", "amostra", "onda"] as const;
export type TipoDeRender = (typeof TIPOS_DE_RENDER)[number];

export const ESTADOS_DO_RENDER = ["fila", "rodando", "pronto", "erro", "cancelado"] as const;
export type EstadoDoRender = (typeof ESTADOS_DO_RENDER)[number];

export const ROTULO_DO_ESTADO: Record<EstadoDoRender, string> = {
  fila: "Na fila",
  rodando: "Renderizando",
  pronto: "Pronto",
  erro: "Não saiu",
  cancelado: "Cancelado",
};

export const ROTULO_DO_TIPO: Record<TipoDeRender, string> = {
  render_final: "Vídeo inteiro",
  amostra: "Amostra",
  onda: "Onda do áudio",
};

export const ETAPAS_DO_RENDER = ["baixando", "medindo", "montando", "renderizando", "mixando", "subindo"] as const;
export type EtapaDoRender = (typeof ETAPAS_DO_RENDER)[number];

export const ROTULO_DA_ETAPA: Record<EtapaDoRender, string> = {
  baixando: "Baixando as mídias",
  medindo: "Medindo a onda",
  montando: "Montando a composição",
  renderizando: "Renderizando",
  mixando: "Acertando o volume (-14 LUFS)",
  subindo: "Subindo o MP4",
};

export const AMOSTRA_MIN_S = 8;
export const AMOSTRA_MAX_S = 15;
/** A tela nunca consulta o andamento mais de uma vez a cada 15 s. */
export const CONSULTA_MINIMA_MS = 15_000;
/** Pedido na fila há mais que isso sem worker vivo: a tela avisa que a máquina parece desligada. */
export const FILA_PARADA_MS = 120_000;
/** Worker visto há menos que isso está ligado. */
export const WORKER_VIVO_MS = 90_000;
/** Parte do upload resumível (TUS) do Storage. */
export const PARTE_DO_UPLOAD_BYTES = 6 * 1024 * 1024;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Próxima consulta permitida (ms desde a época). */
export const proximaConsultaEm = (ultimaMs: number | null, agoraMs: number) => (ultimaMs === null ? agoraMs : Math.max(agoraMs, ultimaMs + CONSULTA_MINIMA_MS));

/** Janela da amostra: 8 a 15 s, dentro do vídeo; sem pedido, os primeiros 12 s. */
export function janelaDaAmostra(inicio: unknown, fim: unknown, duracao: number): { inicio_s: number; fim_s: number } {
  const d = Math.max(0, Number(duracao) || 0);
  let i = Number(inicio);
  let f = Number(fim);
  if (!isFinite(i) || i < 0) i = 0;
  if (!isFinite(f) || f <= i) f = i + 12;
  if (f - i < AMOSTRA_MIN_S) f = i + AMOSTRA_MIN_S;
  if (f - i > AMOSTRA_MAX_S) f = i + AMOSTRA_MAX_S;
  if (d > 0 && f > d) {
    f = d;
    i = Math.max(0, Math.min(i, f - AMOSTRA_MIN_S));
  }
  return { inicio_s: r3(i), fim_s: r3(Math.max(i, f)) };
}

/** Caminho do arquivo pronto no bucket mesa (pasta do cliente). */
export const caminhoDaSaida = (clientId: string, pedidoId: string, tipo: TipoDeRender) =>
  `${clientId}/video/render/${tipo === "amostra" ? "amostras/" : ""}${pedidoId}.mp4`;

/** Estado do worker para a tela ("ligado", "desligado", "nunca visto"). */
export function situacaoDoWorker(vistoEm: string | null, agoraMs: number): "ligado" | "desligado" | "nunca" {
  if (!vistoEm) return "nunca";
  const t = Date.parse(vistoEm);
  if (!isFinite(t)) return "nunca";
  return agoraMs - t <= WORKER_VIVO_MS ? "ligado" : "desligado";
}

// ------------------------------------------------------------------ projeto para o render

interface ClipeMinimo {
  id: string;
  fonte: string | null;
  inicio_s: number;
  entrada_s: number;
  saida_s: number;
  velocidade: number;
  estilo: Record<string, unknown> | null;
  comparar?: { fonte_b: string; entrada_b_s: number } | null;
}

interface TrilhaMinima {
  id: string;
  tipo: string;
  oculta: boolean;
  muda?: boolean;
  clipes: ClipeMinimo[];
}

interface ProjetoMinimo {
  duracao_s: number;
  fontes: Record<string, { storage_bucket: string | null; storage_path: string | null; midia?: string }>;
  trilhas: TrilhaMinima[];
}

const duracao = (c: ClipeMinimo) => Math.max(0, c.saida_s - c.entrada_s) / (c.velocidade > 0 ? c.velocidade : 1);

/** Fontes que aparecem de fato (trilha visível, clipe com fonte, o "depois" do comparar). */
export function fontesUsadas(p: ProjetoMinimo): string[] {
  const usadas: string[] = [];
  const incluir = (k: string | null | undefined) => {
    if (k && p.fontes[k] && usadas.indexOf(k) < 0) usadas.push(k);
  };
  p.trilhas.filter((t) => !t.oculta).forEach((t) =>
    t.clipes.forEach((c) => {
      incluir(c.fonte);
      if (c.comparar) incluir(c.comparar.fonte_b);
    }),
  );
  return usadas.sort();
}

/**
 * O projeto só com o trecho [inicio, fim] (amostra): cada clipe que cruza o
 * trecho é aparado (a entrada da fonte anda junto); texto e peça de motion
 * guardam em `estilo._desde_s` quanto já tinham andado, e as palavras da
 * legenda andam para trás o mesmo tanto. Nada fora do trecho fica.
 */
export function recortarProjeto<P extends ProjetoMinimo>(p: P, inicio: number, fim: number): P {
  const ini = Math.max(0, inicio);
  const trilhas = p.trilhas.map((t) => {
    const clipes: ClipeMinimo[] = [];
    t.clipes.forEach((c) => {
      const cFim = c.inicio_s + duracao(c);
      if (cFim <= ini + 1e-6 || c.inicio_s >= fim - 1e-6) return;
      const cortadoAntes = Math.max(0, ini - c.inicio_s);
      const cortadoDepois = Math.max(0, cFim - fim);
      const v = c.velocidade > 0 ? c.velocidade : 1;
      const novo: ClipeMinimo = {
        ...c,
        inicio_s: r3(Math.max(c.inicio_s, ini) - ini),
        entrada_s: r3(c.entrada_s + cortadoAntes * v),
        saida_s: r3(c.saida_s - cortadoDepois * v),
      };
      if (cortadoAntes > 0 && !c.fonte) {
        const estilo: Record<string, unknown> = { ...(c.estilo || {}) };
        estilo._desde_s = r3((Number(estilo._desde_s) || 0) + cortadoAntes);
        if (Array.isArray(estilo.palavras)) {
          estilo.palavras = (estilo.palavras as { t: string; i: number; f: number }[]).map((w) => ({ t: w.t, i: r3(w.i - cortadoAntes), f: r3(w.f - cortadoAntes) }));
        }
        novo.estilo = estilo;
      }
      if (novo.comparar) novo.comparar = { ...novo.comparar, entrada_b_s: r3(novo.comparar.entrada_b_s + cortadoAntes * v) };
      if (novo.saida_s - novo.entrada_s > 0.001) clipes.push(novo);
    });
    return { ...t, clipes };
  });
  return { ...p, trilhas, duracao_s: r3(fim - ini) };
}

// ------------------------------------------------------------------ pedido que vem da tela

export interface PedidoDeRender {
  tipo: TipoDeRender;
  uid: string;
  inicio_s: number | null;
  fim_s: number | null;
  /** Só para a onda: as fontes a medir (vazio = todas as de vídeo e áudio da trilha principal). */
  fontes: string[];
}

const UID = /^[A-Za-z0-9_-]{8,80}$/;

/** Confere o pedido (tipo, uid do clique, janela da amostra). Lança Error com a frase para a tela. */
export function lerPedidoDeRender(corpo: Record<string, unknown>, duracaoDoProjeto: number): PedidoDeRender {
  const tipo = String(corpo.tipo || "render_final") as TipoDeRender;
  if ((TIPOS_DE_RENDER as readonly string[]).indexOf(tipo) < 0) throw new Error("Tipo de render desconhecido.");
  const uid = String(corpo.uid || "");
  if (!UID.test(uid)) throw new Error("Pedido sem a marca do clique (uid).");
  if (tipo === "amostra") {
    const j = janelaDaAmostra(corpo.inicio_s, corpo.fim_s, duracaoDoProjeto);
    return { tipo, uid, inicio_s: j.inicio_s, fim_s: j.fim_s, fontes: [] };
  }
  const fontes = tipo === "onda" && Array.isArray(corpo.fontes) ? (corpo.fontes as unknown[]).map((x) => String(x || "").slice(0, 60)).filter(Boolean).slice(0, 40) : [];
  return { tipo, uid, inicio_s: null, fim_s: null, fontes };
}
