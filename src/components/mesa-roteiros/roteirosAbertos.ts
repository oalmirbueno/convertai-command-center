import { createContext, useContext, useSyncExternalStore } from "react";
import { custoDaResposta, textoDoErro } from "@/lib/mesa/api";
import { gravarEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import type { PreenchimentoDoRoteiro } from "../../../supabase/functions/mesa-roteiros/modulos/ideias-de-tema";

/**
 * Faixa de roteiros abertos (19/10/2026). O dono: "escolher em cima os
 * roteiros que eu quiser e fazer vários na mesma área, mesma dinâmica de
 * trabalho". Cada aba é um roteiro (da agenda, das ideias, da biblioteca ou
 * novo) com a etapa em que parou (Roteiro, Revisão ou PDF). A faixa fica
 * guardada por cliente (useEstadoDaTela); fechar uma aba só a tira da faixa,
 * nunca apaga o roteiro nem o rascunho.
 *
 * Este arquivo é só lógica (sem tela) e fica leve: a página da mesa o importa
 * direto. O lote do "Gerar todos" mora aqui também, fora dos componentes,
 * para seguir gerando quando a equipe troca de aba ou de etapa.
 */

export type EtapaDaAba = "roteiro" | "revisao" | "pdf";
export const ETAPAS_DA_ABA: readonly EtapaDaAba[] = ["roteiro", "revisao", "pdf"];
export const ehEtapaDaAba = (v: unknown): v is EtapaDaAba => typeof v === "string" && (ETAPAS_DA_ABA as readonly string[]).indexOf(v) >= 0;

export interface AbaDeRoteiro {
  id: string;
  titulo: string;
  etapa: EtapaDaAba;
  roteiro: string | null;
  tarefa: string | null;
  /** Roteiro avulso ainda sem roteiro gravado (formulário com as ideias). */
  avulso: boolean;
  modelo: string | null;
  base: string | null;
}

export interface FaixaGuardada {
  abas: AbaDeRoteiro[];
  /** A última aba aberta (para voltar onde parou). */
  ativa: string | null;
}

export const FAIXA_VAZIA: FaixaGuardada = { abas: [], ativa: null };

/** Mais que isso, a aba mais antiga sai da faixa (o roteiro continua na agenda). */
export const LIMITE_DE_ABAS = 30;

/** O que abre uma aba: um roteiro, uma peça da agenda ou um avulso (com modelo ou base). */
export interface PedidoDeAba {
  titulo: string;
  roteiro?: string | null;
  tarefa?: string | null;
  avulso?: boolean;
  modelo?: string | null;
  base?: string | null;
  etapa?: EtapaDaAba;
}

const textoOuNulo = (v: unknown) => (typeof v === "string" && v ? v.slice(0, 120) : null);

function abaValida(v: unknown): v is AbaDeRoteiro {
  if (!v || typeof v !== "object") return false;
  const a = v as AbaDeRoteiro;
  return typeof a.id === "string" && !!a.id && typeof a.titulo === "string" && ehEtapaDaAba(a.etapa) && (!!a.roteiro || !!a.tarefa || a.avulso === true);
}

export function validarFaixa(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const f = v as FaixaGuardada;
  return Array.isArray(f.abas) && f.abas.every(abaValida) && (f.ativa === null || typeof f.ativa === "string");
}

let contador = 0;
export function novoIdDeAba(): string {
  contador += 1;
  return `a${Date.now().toString(36)}${contador.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** A aba que já mostra este pedido (roteiro ou peça). Avulso sempre abre uma aba nova. */
export function abaDoPedido(f: FaixaGuardada, p: PedidoDeAba): AbaDeRoteiro | null {
  if (p.roteiro) return f.abas.filter((a) => a.roteiro === p.roteiro)[0] || null;
  if (p.tarefa) return f.abas.filter((a) => a.tarefa === p.tarefa)[0] || null;
  return null;
}

/** Abre (ou reaproveita) a aba do pedido. Não muda a ativa: quem chama decide. */
export function abrirNaFaixa(f: FaixaGuardada, p: PedidoDeAba, id: string = novoIdDeAba()): { faixa: FaixaGuardada; id: string; nova: boolean } {
  const existente = abaDoPedido(f, p);
  if (existente) {
    const titulo = p.titulo && existente.titulo !== p.titulo && !tituloProvisorio(p.titulo) ? p.titulo : existente.titulo;
    const etapa = p.etapa || existente.etapa;
    if (titulo === existente.titulo && etapa === existente.etapa) return { faixa: f, id: existente.id, nova: false };
    return { faixa: { ...f, abas: f.abas.map((a) => (a.id === existente.id ? { ...a, titulo, etapa } : a)) }, id: existente.id, nova: false };
  }
  const aba: AbaDeRoteiro = {
    id,
    titulo: (p.titulo || "Roteiro").slice(0, 120),
    etapa: p.etapa || "roteiro",
    roteiro: textoOuNulo(p.roteiro),
    tarefa: textoOuNulo(p.tarefa),
    avulso: !p.roteiro && !p.tarefa,
    modelo: textoOuNulo(p.modelo),
    base: textoOuNulo(p.base),
  };
  let abas = f.abas.concat([aba]);
  // Passou do limite: sai a mais antiga que não é a ativa.
  while (abas.length > LIMITE_DE_ABAS) {
    const k = abas.findIndex((a) => a.id !== f.ativa && a.id !== aba.id);
    if (k < 0) break;
    abas = abas.slice(0, k).concat(abas.slice(k + 1));
  }
  return { faixa: { ...f, abas }, id: aba.id, nova: true };
}

/** Tira a aba da faixa (não apaga nada). Se era a ativa, diz qual abrir no lugar. */
export function fecharDaFaixa(f: FaixaGuardada, id: string): { faixa: FaixaGuardada; proxima: AbaDeRoteiro | null } {
  const k = f.abas.findIndex((a) => a.id === id);
  if (k < 0) return { faixa: f, proxima: null };
  const abas = f.abas.slice(0, k).concat(f.abas.slice(k + 1));
  const eraAtiva = f.ativa === id;
  const proxima = eraAtiva ? abas[Math.min(k, abas.length - 1)] || null : null;
  return { faixa: { abas, ativa: eraAtiva ? (proxima ? proxima.id : null) : f.ativa }, proxima };
}

export function atualizarAbaNaFaixa(f: FaixaGuardada, id: string, parte: Partial<Omit<AbaDeRoteiro, "id">>): FaixaGuardada {
  let mudou = false;
  const abas = f.abas.map((a) => {
    if (a.id !== id) return a;
    const nova = { ...a, ...parte };
    if (Object.keys(parte).some((k) => (nova as any)[k] !== (a as any)[k])) mudou = true;
    return nova;
  });
  return mudou ? { ...f, abas } : f;
}

const PROVISORIOS = ["Roteiro", "Roteiro avulso", "Roteiro da peça", "Roteiro do modelo", "Roteiro da biblioteca"];
export const tituloProvisorio = (t: string) => PROVISORIOS.indexOf(t) >= 0;

/** Título curto da aba (o inteiro vai no title). */
export function tituloCurto(t: string, max = 26): string {
  const limpo = (t || "Roteiro").replace(/\s+/g, " ").trim();
  return limpo.length > max ? `${limpo.slice(0, max - 1).trim()}…` : limpo;
}

/** Parâmetros do endereço que abrem a aba. */
export function enderecoDaAba(a: AbaDeRoteiro, etapa: EtapaDaAba = a.etapa): Record<string, string | null> {
  return {
    etapa,
    aba: a.id,
    roteiro: a.roteiro,
    tarefa: a.roteiro ? null : a.tarefa,
    avulso: !a.roteiro && a.avulso ? "1" : null,
    modelo: a.roteiro ? null : a.modelo,
    base: a.roteiro ? null : a.base,
  };
}

// ------------------------------------------------------------------ formulário de cada aba

/** Chave do formulário de geração (a mesma de antes: por peça, ou "avulso"; avulso na faixa: pela aba). */
export const chaveDoFormulario = (clientId: string, chave: string) => `mesa-roteiros:gerar:${clientId}:${chave}`;

/** Ideia aberta numa aba: o formulário dela já abre preenchido. */
export function preencherFormularioDaAba(clientId: string, abaId: string, v: PreenchimentoDoRoteiro) {
  const base = chaveDoFormulario(clientId, abaId);
  gravarEstadoDaTela(`${base}:tema`, v.tema);
  gravarEstadoDaTela(`${base}:pedido`, v.pedido);
  gravarEstadoDaTela(`${base}:tipo`, v.tipo);
  gravarEstadoDaTela(`${base}:duracao`, v.duracao_s);
  gravarEstadoDaTela(`${base}:objetivo`, v.objetivo);
  gravarEstadoDaTela(`${base}:modelo-base`, v.modeloBase);
}

// ------------------------------------------------------------------ contexto da faixa

export interface ItemParaAbrir {
  pedido: PedidoDeAba;
  /** Ideia: o formulário da aba nova abre preenchido. */
  preencher?: PreenchimentoDoRoteiro | null;
}

export interface ApiDaFaixa {
  abas: AbaDeRoteiro[];
  abaAtiva: AbaDeRoteiro | null;
  /** Abre todos na faixa (sem repetir) e devolve o id da aba de cada item, na mesma ordem. `ir`: abre a primeira. */
  abrirVarios: (itens: ItemParaAbrir[], opcoes?: { ir?: boolean }) => string[];
  atualizarAba: (id: string, parte: Partial<Omit<AbaDeRoteiro, "id">>) => void;
  /** O título real chegou (roteiro carregado, peça lida): troca o da aba ativa. */
  nomearAtiva: (titulo: string) => void;
}

export const FaixaContexto = createContext<ApiDaFaixa | null>(null);
/** Fora da mesa (teste de uma etapa sozinha) não há faixa: a seleção em lote some. */
export const useFaixa = () => useContext(FaixaContexto);

// ------------------------------------------------------------------ lote do "Gerar todos"

export type EstadoNoLote = "fila" | "gerando" | "pronto" | "falhou";

export interface LoteDeRoteiros {
  ativo: boolean;
  itens: { abaId: string; estado: EstadoNoLote; erro: string | null }[];
  custo_usd: number;
}

const lotes: Record<string, LoteDeRoteiros> = {};
const ouvintes = new Set<() => void>();
const avisar = () => ouvintes.forEach((f) => f());
const ouvir = (f: () => void) => {
  ouvintes.add(f);
  return () => {
    ouvintes.delete(f);
  };
};

function mudarItem(clientId: string, abaId: string, estado: EstadoNoLote, erro: string | null = null) {
  const l = lotes[clientId];
  if (!l) return;
  lotes[clientId] = { ...l, itens: l.itens.map((i) => (i.abaId === abaId ? { abaId, estado, erro } : i)) };
  avisar();
}

export function useLoteDeRoteiros(clientId: string): LoteDeRoteiros | null {
  return useSyncExternalStore(ouvir, () => lotes[clientId] || null, () => null);
}

export function estadoDaAbaNoLote(lote: LoteDeRoteiros | null, abaId: string) {
  return lote ? lote.itens.filter((i) => i.abaId === abaId)[0] || null : null;
}

export function esquecerLoteDeRoteiros(clientId: string) {
  if (lotes[clientId] && lotes[clientId].ativo) return;
  delete lotes[clientId];
  avisar();
}

export interface ResumoDoLote {
  feitos: number;
  falhas: number;
  custo_usd: number;
}

/**
 * Gera um roteiro por vez (em sequência, nunca em paralelo), com o estado de
 * cada aba. Um lote por cliente: com um rodando, outro não começa (null).
 */
export async function rodarLoteDeRoteiros<C>({
  clientId,
  itens,
  gerar,
  aoGerado,
}: {
  clientId: string;
  itens: { abaId: string; corpo: C }[];
  gerar: (corpo: C) => Promise<any>;
  aoGerado: (abaId: string, data: any) => void;
}): Promise<ResumoDoLote | null> {
  if (!itens.length || (lotes[clientId] && lotes[clientId].ativo)) return null;
  lotes[clientId] = { ativo: true, itens: itens.map((i) => ({ abaId: i.abaId, estado: "fila", erro: null })), custo_usd: 0 };
  avisar();
  const resumo: ResumoDoLote = { feitos: 0, falhas: 0, custo_usd: 0 };
  for (const item of itens) {
    mudarItem(clientId, item.abaId, "gerando");
    try {
      const data = await gerar(item.corpo);
      const custo = custoDaResposta(data);
      if (custo) resumo.custo_usd += custo;
      if (data && data.roteiro && data.roteiro.id) {
        resumo.feitos += 1;
        aoGerado(item.abaId, data);
        mudarItem(clientId, item.abaId, "pronto");
      } else {
        resumo.falhas += 1;
        mudarItem(clientId, item.abaId, "falhou", (data && data.aviso_banco) || "O roteiro não foi guardado.");
      }
    } catch (e) {
      resumo.falhas += 1;
      mudarItem(clientId, item.abaId, "falhou", textoDoErro(e));
    }
    if (lotes[clientId]) {
      lotes[clientId] = { ...lotes[clientId], custo_usd: resumo.custo_usd };
      avisar();
    }
  }
  if (lotes[clientId]) lotes[clientId] = { ...lotes[clientId], ativo: false };
  avisar();
  return resumo;
}
