import { useEffect, useState } from "react";
import { CONSULTA_MINIMA_MS, FILA_PARADA_MS, ROTULO_DA_ETAPA, ROTULO_DO_ESTADO, type EtapaDoRender, type EstadoDoRender, type TipoDeRender } from "../../../supabase/functions/_shared/render-do-editor";
import type { OndaDaFonte, ProjetoDeEdicao } from "../../../supabase/functions/_shared/projeto-de-edicao";
import { palavrasNaOnda } from "../../../supabase/functions/_shared/onda-do-audio";
import { trilhaPrincipal, type Operacao } from "./operacoes";

/**
 * Render pela fila, lado da tela (frente EDT, F1). Um "vigia" por versão do
 * vídeo, compartilhado por quem mostra (barra do editor e agente): uma leitura
 * a cada 15 s NO MÍNIMO, só enquanto há pedido ativo e a aba está à vista; sem
 * pedido ativo, nenhuma consulta (sem laço).
 */

export interface PedidoNaFila {
  id: string;
  tipo: TipoDeRender;
  estado: EstadoDoRender;
  etapa: EtapaDoRender | null;
  progresso: number;
  entrada: Record<string, unknown> | null;
  resultado: Record<string, unknown> | null;
  erro_mensagem: string | null;
  criado_em: string;
  concluido_em: string | null;
  arquivo_id: string | null;
  url: string | null;
}

export interface EstadoDaFila {
  pedidos: PedidoNaFila[];
  worker: { visto_em: string | null; situacao: "ligado" | "desligado" | "nunca" } | null;
  erro: string | null;
  /** Código do erro (banco_sem_fila, funcao_indisponivel...). */
  codigo: string | null;
  lendo: boolean;
}

type Chamar = (corpo: Record<string, unknown>) => Promise<any>;

const ativo = (p: PedidoNaFila) => p.estado === "fila" || p.estado === "rodando";

export function rotuloDoPedido(p: PedidoNaFila, agoraMs: number, worker: EstadoDaFila["worker"]): string {
  if (p.estado === "rodando") return `${p.etapa ? ROTULO_DA_ETAPA[p.etapa] : ROTULO_DO_ESTADO.rodando} ${Math.round((Number(p.progresso) || 0) * 100)}%`;
  if (p.estado === "fila") {
    const parado = agoraMs - Date.parse(p.criado_em) > FILA_PARADA_MS && (!worker || worker.situacao !== "ligado");
    return parado ? "Na fila: a máquina da agência parece desligada" : ROTULO_DO_ESTADO.fila;
  }
  if (p.estado === "erro") return p.erro_mensagem || ROTULO_DO_ESTADO.erro;
  return ROTULO_DO_ESTADO[p.estado];
}

/** Ondas prontas num pedido de onda (resultado.ondas), já no formato do projeto. */
export function ondasDoResultado(p: PedidoNaFila): Record<string, OndaDaFonte> {
  const r = p.resultado && typeof p.resultado === "object" ? (p.resultado as Record<string, unknown>).ondas : null;
  return r && typeof r === "object" ? (r as Record<string, OndaDaFonte>) : {};
}

interface Vigia {
  estado: EstadoDaFila;
  ouvintes: Set<(e: EstadoDaFila) => void>;
  timer: ReturnType<typeof setTimeout> | null;
  ultima: number;
  clientId: string;
  chamar: Chamar;
  /** Pedidos que já estavam prontos na primeira leitura (não viram "pronto agora"). */
  vistos: Set<string>;
  aoTerminar: Set<(p: PedidoNaFila) => void>;
}

const VIGIAS = new Map<string, Vigia>();

function emitir(v: Vigia, e: Partial<EstadoDaFila>) {
  v.estado = { ...v.estado, ...e };
  v.ouvintes.forEach((f) => f(v.estado));
}

function agendar(v: Vigia, versaoId: string) {
  if (v.timer) clearTimeout(v.timer);
  v.timer = null;
  if (!v.estado.pedidos.some(ativo) || !v.ouvintes.size) return;
  const espera = Math.max(CONSULTA_MINIMA_MS, v.ultima + CONSULTA_MINIMA_MS - Date.now());
  v.timer = setTimeout(() => {
    v.timer = null;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      // Aba escondida: não consulta; volta a olhar quando a aba aparecer.
      const voltar = () => {
        document.removeEventListener("visibilitychange", voltar);
        void ler(versaoId);
      };
      document.addEventListener("visibilitychange", voltar);
      return;
    }
    void ler(versaoId);
  }, espera);
}

async function ler(versaoId: string): Promise<void> {
  const v = VIGIAS.get(versaoId);
  if (!v) return;
  // Nunca duas leituras em menos de 15 s (quem pediu cedo recebe o que já tem).
  if (Date.now() - v.ultima < CONSULTA_MINIMA_MS && v.estado.pedidos.length) {
    agendar(v, versaoId);
    return;
  }
  v.ultima = Date.now();
  emitir(v, { lendo: true });
  try {
    const r = await v.chamar({ acao: "render_status", client_id: v.clientId, versao_id: versaoId });
    const pedidos = ((r && r.pedidos) || []) as PedidoNaFila[];
    const antes = v.estado.pedidos;
    pedidos.forEach((p) => {
      const era = antes.find((x) => x.id === p.id);
      const terminouAgora = (p.estado === "pronto" || p.estado === "erro") && ((era && ativo(era)) || (!era && !v.vistos.has(p.id) && antes.length > 0));
      if (terminouAgora) v.aoTerminar.forEach((f) => f(p));
      v.vistos.add(p.id);
    });
    emitir(v, { pedidos, worker: r && r.worker ? r.worker : null, erro: null, codigo: null, lendo: false });
  } catch (e) {
    const codigo = e && typeof e === "object" && typeof (e as { codigo?: unknown }).codigo === "string" ? String((e as { codigo: string }).codigo) : "erro";
    emitir(v, { erro: e instanceof Error ? e.message : "Não deu para ler a fila.", codigo, lendo: false });
    // Erro não tenta sozinho: a pessoa pede de novo (ou o próximo pedido relê).
    return;
  }
  agendar(v, versaoId);
}

function vigia(clientId: string, versaoId: string, chamar: Chamar): Vigia {
  let v = VIGIAS.get(versaoId);
  if (!v) {
    v = { estado: { pedidos: [], worker: null, erro: null, codigo: null, lendo: false }, ouvintes: new Set(), timer: null, ultima: 0, clientId, chamar, vistos: new Set(), aoTerminar: new Set() };
    VIGIAS.set(versaoId, v);
  }
  return v;
}

/** Estado da fila desta versão (lida depois de um pedido ou quando a pessoa pede; com pedido ativo, a cada 15 s no mínimo). */
export function useFilaDeRender(clientId: string, versaoId: string | null | undefined, chamar: Chamar, aoTerminar?: (p: PedidoNaFila) => void, lerAoAbrir = false): EstadoDaFila {
  const [estado, setEstado] = useState<EstadoDaFila>(() => (versaoId && VIGIAS.get(versaoId) ? (VIGIAS.get(versaoId) as Vigia).estado : { pedidos: [], worker: null, erro: null, codigo: null, lendo: false }));
  useEffect(() => {
    if (!versaoId || !clientId) return;
    const v = vigia(clientId, versaoId, chamar);
    v.ouvintes.add(setEstado);
    if (aoTerminar) v.aoTerminar.add(aoTerminar);
    setEstado(v.estado);
    // Abrir o editor não chama a função: a fila é lida depois de um pedido desta aba ou quando a pessoa pede.
    if (!v.ultima && lerAoAbrir) void ler(versaoId);
    else agendar(v, versaoId);
    return () => {
      v.ouvintes.delete(setEstado);
      if (aoTerminar) v.aoTerminar.delete(aoTerminar);
      if (!v.ouvintes.size && v.timer) {
        clearTimeout(v.timer);
        v.timer = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, versaoId]);
  return estado;
}

/** Põe na fila (uid do clique: pedir duas vezes devolve o mesmo) e já mostra o pedido. */
export async function pedirRender(chamar: Chamar, e: { clientId: string; versaoId: string; tipo: TipoDeRender; uid: string; revisao?: number | null; inicio_s?: number; fim_s?: number; fontes?: string[] }): Promise<{ pedido: PedidoNaFila; ja_existia: boolean }> {
  const r = await chamar({ acao: "render_pedir", client_id: e.clientId, versao_id: e.versaoId, tipo: e.tipo, uid: e.uid, revisao: e.revisao ?? null, inicio_s: e.inicio_s, fim_s: e.fim_s, fontes: e.fontes });
  const v = vigia(e.clientId, e.versaoId, chamar);
  const pedido = r.pedido as PedidoNaFila;
  v.vistos.add(pedido.id);
  emitir(v, { pedidos: [pedido].concat(v.estado.pedidos.filter((p) => p.id !== pedido.id)), erro: null, codigo: null });
  agendar(v, e.versaoId);
  return { pedido, ja_existia: !!r.ja_existia };
}

export async function cancelarRender(chamar: Chamar, clientId: string, versaoId: string, pedidoId: string): Promise<void> {
  const r = await chamar({ acao: "render_cancelar", client_id: clientId, pedido_id: pedidoId });
  const v = VIGIAS.get(versaoId);
  if (v && r && r.pedido) emitir(v, { pedidos: v.estado.pedidos.map((p) => (p.id === pedidoId ? { ...p, ...(r.pedido as PedidoNaFila) } : p)) });
}

/** Uid de um clique (idempotência do pedido). */
export const uidDoClique = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** "Ver o andamento": uma leitura agora (respeita os 15 s). */
export function lerFilaAgora(clientId: string, versaoId: string, chamar: Chamar): void {
  vigia(clientId, versaoId, chamar);
  void ler(versaoId);
}

/** Só para os testes: esquece os vigias. */
export function _limparVigias() {
  VIGIAS.forEach((v) => v.timer && clearTimeout(v.timer));
  VIGIAS.clear();
}

export function opsDaOnda(projeto: ProjetoDeEdicao, p: PedidoNaFila, agora: string): Operacao[] {
  const ondas = ondasDoResultado(p);
  const ops: Operacao[] = [];
  Object.keys(ondas).forEach((k) => {
    if (!projeto.fontes[k]) return;
    ops.push({ op: "onda", fonte: k, onda: ondas[k] });
    // A palavra passa a começar quando a voz volta (o transcritor adianta até 0,3 s).
    const tr = projeto.transcricoes[k];
    if (tr && tr.por_palavra && ondas[k].pausas && ondas[k].pausas.length) {
      ops.push({ op: "transcricao", fonte: k, transcricao: { ...tr, segmentos: palavrasNaOnda(tr.segmentos, ondas[k].pausas), versao: tr.versao + 1, origem: `${tr.origem || "fala"} + onda`, em: agora } });
    }
  });
  return ops;
}

/** Fontes da trilha principal sem onda medida (vídeo e áudio). */
export function fontesSemOnda(p: ProjetoDeEdicao): string[] {
  const t = trilhaPrincipal(p);
  const chaves: string[] = [];
  (t ? t.clipes : []).forEach((c) => {
    if (!c.fonte || chaves.indexOf(c.fonte) >= 0) return;
    const f = p.fontes[c.fonte];
    if (f && f.midia !== "imagem" && f.storage_path && !(p.ondas || {})[c.fonte]) chaves.push(c.fonte);
  });
  return chaves;
}

