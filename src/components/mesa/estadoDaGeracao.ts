/**
 * O andamento de cada geração de vídeo da pauta em palavras claras (27/10/2026). Dono: "está meio quebrado onde
 * aparece 'gerando' e tal; melhore essa área". Antes a tela dizia só "Gerando" (sem tempo), o erro vinha cortado
 * numa linha e não havia como tentar de novo; a aba de resultados só relia o banco, sem perguntar ao provedor.
 *
 * - situacaoDoPedido: na fila, gerando (com o tempo que falta pelo tempo típico do motor), guardando, pronto,
 *   parte pronta, falhou (com o motivo legível) ou cancelado; "demorando mais que o normal" quando passa.
 * - corpoDeTentarDeNovo: o mesmo pedido de novo, com a chave "tentar-<pedido>" (o duplo clique não gera dois) e
 *   só as variações que falharam. A tentativa que falhou não foi cobrada (o servidor só cobra o que fica pronto).
 * Puro. Sem travessão.
 */
import type { PedidoDeVideo } from "@/components/mesa-videos/videosApi";
import type { MotorDeVideo } from "../../../supabase/functions/mesa-videos/modulos/modelos-de-video";

export type SituacaoDaGeracao = "na_fila" | "gerando" | "guardando" | "pronto" | "parcial" | "falhou" | "cancelado";

export interface LeituraDoPedido {
  situacao: SituacaoDaGeracao;
  rotulo: string;
  /** Tempo que falta, motivo da falha ou o que fazer. */
  detalhe: string;
  /** Passou do tempo típico (segue conferido pelo servidor). */
  atrasado: boolean;
  /** 0..1 pelo tempo típico (só para a barra; nunca chega a 1 antes de pronto). */
  progresso: number | null;
  prontas: number;
  total: number;
}

interface Envio {
  n?: number;
  estado?: string;
  erro?: string | null;
  arquivo_id?: string | null;
  posicao?: number | null;
}

export const enviosDoPedido = (p: PedidoDeVideo): Envio[] => {
  const r = (p as unknown as { resultado?: { envios?: Envio[] } }).resultado;
  return r && Array.isArray(r.envios) ? r.envios : [];
};

/** Tempo típico de um clipe (s): motor de rascunho em 1 min; os outros em 2 min mais 15 s por segundo de vídeo. */
export function tempoTipicoS(motor: Pick<MotorDeVideo, "prazo_min"> | null | undefined, duracaoS: number): number {
  if (motor && motor.prazo_min <= 10) return 60;
  return 120 + 15 * Math.max(1, Math.min(30, Number(duracaoS) || 5));
}

const minutos = (s: number) => (s < 60 ? "menos de 1 min" : `cerca de ${Math.round(s / 60)} min`);

/** O motivo do provedor em português claro (o texto original fica no title). */
export function motivoLegivel(erro: string | null | undefined): string {
  const e = String(erro || "").trim();
  if (!e) return "O provedor não explicou o motivo.";
  const s = e.toLowerCase();
  if (/saldo|insufficient|balance|credit/.test(s)) return "Saldo insuficiente na carteira de IA do cliente.";
  if (/content|policy|moderat|nsfw|safety|sensitive|flagged|violat/.test(s)) return "O provedor recusou a cena pela política de conteúdo. Mude o texto ou a imagem.";
  if (/prazo|timeout|timed out|venceu|expired/.test(s)) return "O provedor demorou demais e a geração venceu.";
  if (/image|imagem|frame|quadro/.test(s) && /invalid|inv[aá]lid|size|tamanho|format/.test(s)) return "A imagem de partida não foi aceita (formato ou tamanho). Troque a imagem.";
  if (/rate|429|too many|ocupado|busy|overload|503|502/.test(s)) return "O provedor estava ocupado. Tente de novo em instantes.";
  return e.length > 160 ? `${e.slice(0, 157)}...` : e;
}

/** A leitura do pedido para a tela, com o tempo que falta pelo tempo típico do motor. */
export function situacaoDoPedido(p: PedidoDeVideo, agora: number, motor?: Pick<MotorDeVideo, "prazo_min"> | null): LeituraDoPedido {
  const envios = enviosDoPedido(p);
  const total = Math.max(1, envios.length || Number(p.parametros && p.parametros.variacoes) || 1);
  const prontas = envios.filter((e) => e.estado === "pronto" || !!e.arquivo_id).length;
  const estado = String(p.estado);
  const base = { prontas, total, atrasado: false, progresso: null as number | null };
  if (estado === "pronto") return { ...base, situacao: "pronto", rotulo: "Pronto", detalhe: total > 1 ? `${prontas} de ${total} prontas` : "Entrou na prancheta" };
  if (estado === "cancelado") return { ...base, situacao: "cancelado", rotulo: "Cancelado", detalhe: "Nada foi cobrado do que foi cancelado." };
  if (estado === "erro") {
    const erro = envios.map((e) => e.erro).find(Boolean);
    return { ...base, situacao: "falhou", rotulo: "Falhou", detalhe: motivoLegivel(erro) };
  }
  if (estado === "parcial") {
    const erro = envios.map((e) => e.erro).find(Boolean);
    return { ...base, situacao: "parcial", rotulo: "Parte pronta", detalhe: `${prontas} de ${total} prontas · ${motivoLegivel(erro)}` };
  }
  if (estado === "baixando") return { ...base, situacao: "guardando", rotulo: "Guardando", detalhe: "Pronto no provedor, guardando no acervo", progresso: 0.95 };
  const inicio = Date.parse(String(p.criado_em || ""));
  const passou = isFinite(inicio) ? Math.max(0, (agora - inicio) / 1000) : 0;
  const tipico = tempoTipicoS(motor, Number(p.parametros && p.parametros.duracao_s) || 5);
  const naFila = estado === "enviado" && envios.some((e) => typeof e.posicao === "number" && (e.posicao as number) > 0);
  if (passou > tipico) {
    return { ...base, situacao: naFila ? "na_fila" : "gerando", rotulo: naFila ? "Na fila" : "Gerando", detalhe: "Demorando mais que o normal. O servidor segue conferindo a cada minuto, por até 24 h.", atrasado: true, progresso: 0.9 };
  }
  const falta = tipico - passou;
  if (naFila) {
    const pos = envios.map((e) => e.posicao).find((x) => typeof x === "number") as number | undefined;
    return { ...base, situacao: "na_fila", rotulo: "Na fila", detalhe: `${pos ? `Posição ${pos} no provedor · ` : ""}falta ${minutos(falta)}`, progresso: Math.min(0.9, passou / tipico) };
  }
  return { ...base, situacao: "gerando", rotulo: "Gerando", detalhe: `Falta ${minutos(falta)}`, progresso: Math.min(0.9, passou / tipico) };
}

const TIPOS_QUE_TENTAM_DE_NOVO = ["gerar_livre", "gerar_plano"];

/** Dá para tentar de novo: falhou, parte pronta ou cancelado, num tipo que o gerar_video refaz. */
export function podeTentarDeNovo(p: PedidoDeVideo): boolean {
  const estado = String(p.estado);
  if (["erro", "parcial", "cancelado"].indexOf(estado) < 0) return false;
  const alvo = (p.alvo || {}) as { modo?: string };
  if (alvo.modo === "avatar" || alvo.modo === "labial" || alvo.modo === "estender") return false;
  return TIPOS_QUE_TENTAM_DE_NOVO.indexOf(String(p.tipo)) >= 0;
}

/**
 * O corpo do gerar_video para tentar de novo: os mesmos parâmetros (motor, modo, prompt, quadros, referências,
 * pauta e composição), só as variações que falharam e a chave "tentar-<pedido>".
 */
export function corpoDeTentarDeNovo(p: PedidoDeVideo): Record<string, unknown> | null {
  if (!podeTentarDeNovo(p)) return null;
  const par = (p.parametros || {}) as Record<string, unknown>;
  const alvo = (p.alvo || {}) as Record<string, unknown>;
  const falharam = enviosDoPedido(p).filter((e) => !e.arquivo_id && e.estado !== "pronto").length;
  const variacoes = Math.max(1, Math.min(4, String(p.estado) === "parcial" ? falharam || 1 : Number(par.variacoes) || 1));
  const corpo: Record<string, unknown> = {
    acao: "gerar_video",
    tipo: p.tipo,
    client_id: p.client_id,
    motor: String(alvo.motor || p.executor || ""),
    modo: alvo.modo || undefined,
    prompt: par.prompt || "",
    negativo: par.negativo || "",
    duracao_s: par.duracao_s,
    formato: par.formato,
    resolucao: par.resolucao,
    audio: par.audio === true,
    variacoes,
    quadro_inicial_path: par.quadro_inicial_path || null,
    quadro_final_path: par.quadro_final_path || null,
    referencias_paths: Array.isArray(par.referencias_paths) ? par.referencias_paths : [],
    camera: par.camera || null,
    titulo: alvo.titulo || undefined,
    uid: `tentar-${p.id}`,
  };
  if (par.task_id) corpo.task_id = par.task_id;
  if (par.ads_criativo_id) corpo.ads_criativo_id = par.ads_criativo_id;
  if (par.composicao) corpo.composicao = par.composicao;
  if (Array.isArray(par.referencias_papeis)) corpo.referencias_papeis = par.referencias_papeis;
  return corpo;
}

/** Ordem da lista: o que anda primeiro, depois o que falhou, depois o pronto; mais novo antes. */
export function ordenarPedidos(pedidos: PedidoDeVideo[]): PedidoDeVideo[] {
  const peso = (p: PedidoDeVideo) => (["enviado", "gerando", "baixando"].indexOf(String(p.estado)) >= 0 ? 0 : ["erro", "parcial"].indexOf(String(p.estado)) >= 0 ? 1 : 2);
  return pedidos.slice().sort((a, b) => peso(a) - peso(b) || String(b.criado_em).localeCompare(String(a.criado_em)));
}
