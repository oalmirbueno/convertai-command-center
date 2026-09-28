import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao } from "@/lib/mesa/api";
import { arteRapidaDa, ehArteRapida, type ArteRapida } from "../../../supabase/functions/_shared/arte-rapida";
import { ultimasVersoes, type ItemDoMes, type Trabalho } from "./useItensDoMes";

/**
 * Arte rápida (frente AE, 28/09): leituras e ações da tela. O trabalho é o
 * do Estúdio (estudio_trabalhos, RLS da equipe) marcado com
 * direcao.arte_rapida; as ações passam pela estudio-arte (rapida_preparar,
 * rapida_para_agenda, rapida_arquivar), com as regras em
 * supabase/functions/_shared/arte-rapida.ts.
 */

export const chavesDaArteRapida = {
  todas: (clientId: string) => ["mesa", "arte-rapida", clientId] as const,
  lista: (clientId: string) => ["mesa", "arte-rapida", clientId, "lista"] as const,
  um: (clientId: string, id: string) => ["mesa", "arte-rapida", clientId, "um", id] as const,
  fotos: (clientId: string, ids: string[]) => ["mesa", "arte-rapida", clientId, "fotos", ids.join(",")] as const,
};

/** Quantas aparecem no histórico (as mais recentes). */
export const MAX_NO_HISTORICO = 40;

function paraTrabalho(bruto: Record<string, unknown>): Trabalho {
  const t = bruto as unknown as Trabalho;
  return { ...t, cards: Array.isArray(t.cards) ? t.cards : [], direcao: t.direcao && typeof t.direcao === "object" ? t.direcao : ({ cards: [] } as unknown as Trabalho["direcao"]) };
}

/** As artes rápidas do cliente, mais novas primeiro (as arquivadas saem na tela, por artesDoHistorico). */
export async function lerArtesRapidas(clientId: string): Promise<Trabalho[]> {
  const { data, error } = await (supabase as any)
    .from("estudio_trabalhos")
    .select("*")
    .eq("client_id", clientId)
    .not("direcao->arte_rapida", "is", null)
    .order("atualizado_em", { ascending: false })
    .limit(MAX_NO_HISTORICO);
  if (error) throw error;
  return ((data || []) as Record<string, unknown>[]).map(paraTrabalho).filter((t) => ehArteRapida(t.direcao));
}

export async function lerArteRapida(clientId: string, id: string): Promise<Trabalho | null> {
  const { data, error } = await (supabase as any).from("estudio_trabalhos").select("*").eq("client_id", clientId).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? paraTrabalho(data as Record<string, unknown>) : null;
}

/** As do histórico: arte rápida e não arquivada. Função pura. */
export function artesDoHistorico(lista: Trabalho[]): Trabalho[] {
  return lista.filter((t) => {
    const a = arteRapidaDa(t.direcao);
    return !!a && !a.arquivada_em;
  });
}

/**
 * A arte rápida é da marca aberta? (Acerbi e CME). A marca mora em
 * direcao.marca_id; sem ela, só na principal. Sem marca aberta: todas.
 */
export function arteRapidaDaMarca(t: Trabalho, marca: { id: string; principal: boolean } | null): boolean {
  if (!marca) return true;
  const bruto = t.direcao ? (t.direcao as unknown as Record<string, unknown>).marca_id : null;
  const id = typeof bruto === "string" && bruto ? bruto : null;
  return id ? id === marca.id : marca.principal;
}

export const arteDoTrabalho = (t: Trabalho | null | undefined): ArteRapida | null => (t ? arteRapidaDa(t.direcao) : null);

/**
 * O item que o Estúdio abre para a arte rápida (sem item da Agenda). O id
 * começa com "rapida-" (nunca é um task_id) e só serve de chave na tela.
 */
export function itemDaArteRapida(t: Trabalho): ItemDoMes {
  const a = arteRapidaDa(t.direcao);
  const total = (t.direcao && Array.isArray(t.direcao.cards) ? t.direcao.cards : []).length;
  return {
    id: `rapida-${t.id}`,
    title: a ? a.titulo : "Arte rápida",
    due_date: a && a.data ? a.data : null,
    delivery_type: total > 1 || (a && a.peca === "carrossel") ? "carousel" : "static",
    status: "todo",
    project_id: "",
  };
}

export type TomDaArteRapida = "neutro" | "primario" | "ok" | "alerta" | "erro";

/** Onde a arte rápida está, numa palavra, para o histórico. Função pura. */
export function situacaoDaArteRapida(t: Trabalho): { rotulo: string; tom: TomDaArteRapida } {
  const a = arteRapidaDa(t.direcao);
  if (a && a.task_id) return { rotulo: "na Agenda", tom: "ok" };
  const cards = (t.direcao && Array.isArray(t.direcao.cards) ? t.direcao.cards : []).length;
  const feitas = ultimasVersoes(t.cards || []).size;
  if (t.status === "erro") return { rotulo: "com erro", tom: "erro" };
  if (!cards) return { rotulo: "sem direção", tom: "neutro" };
  if (!feitas) return { rotulo: "a gerar", tom: "primario" };
  if (feitas < cards) return { rotulo: `${feitas} de ${cards}`, tom: "alerta" };
  return { rotulo: "pronta", tom: "ok" };
}

/** Caminho da primeira lâmina com arte (miniatura do histórico), ou null. */
export function miniaturaDaArteRapida(t: Trabalho): string | null {
  const ultimas = ultimasVersoes(t.cards || []);
  const primeira = ultimas.get(1) || ultimas.values().next().value;
  return primeira && primeira.storage_path ? primeira.storage_path : null;
}

/** Troca o trabalho nas listas em cache da arte rápida (lista e o aberto). */
export function gravarArteRapidaNoCache(qc: QueryClient, clientId: string, t: Trabalho | null | undefined) {
  if (!t || !t.id) return;
  const novo = paraTrabalho(t as unknown as Record<string, unknown>);
  qc.setQueryData<Trabalho[]>(chavesDaArteRapida.lista(clientId), (lista) => {
    const atual = lista || [];
    return atual.some((x) => x.id === novo.id) ? atual.map((x) => (x.id === novo.id ? novo : x)) : [novo].concat(atual);
  });
  qc.setQueryData(chavesDaArteRapida.um(clientId, novo.id), novo);
}

// ------------------------------------------------------------------ ações

export const prepararArteRapida = (corpo: Record<string, unknown>) => chamarFuncao<any>("estudio-arte", corpo);

export interface RespostaDoLevar {
  trabalho: Trabalho;
  task: { id: string; title: string; due_date: string | null };
  item_criado: boolean;
  ja_levada?: boolean;
  caminho?: { rotulo: string; destino: string };
}

export const levarArteRapidaParaAgenda = (p: { trabalhoId: string; data: string; titulo?: string; pedidoId: string }) =>
  chamarFuncao<RespostaDoLevar>("estudio-arte", {
    acao: "rapida_para_agenda",
    trabalho_id: p.trabalhoId,
    data: p.data,
    titulo: p.titulo || undefined,
    pedido_id: p.pedidoId,
  });

export const arquivarArteRapida = (trabalhoId: string, desfazer = false) =>
  chamarFuncao<{ trabalho: Trabalho; arquivada: boolean }>("estudio-arte", { acao: "rapida_arquivar", trabalho_id: trabalhoId, desfazer });

/** Gera a arte única logo depois da direção (fila do servidor). Sem a fila no ar, a tela mostra o Gerar. */
export const gerarNaFila = (trabalhoId: string, ordens: number[], marcaId?: string | null) =>
  chamarFuncao<any>("estudio-arte", { acao: "enfileirar", trabalho_id: trabalhoId, ordens, marca_id: marcaId || undefined });

// ------------------------------------------------------------------ fotos do acervo (da Mesa Foto)

export interface FotoDoPedido {
  id: string;
  nome: string;
  storage_bucket: string;
  storage_path: string;
}

export async function lerFotosDoAcervo(clientId: string, ids: string[]): Promise<FotoDoPedido[]> {
  if (!ids.length) return [];
  const { data, error } = await (supabase as any)
    .from("cliente_imagens")
    .select("id, nome, storage_bucket, storage_path")
    .eq("client_id", clientId)
    .in("id", ids.slice(0, 6));
  if (error) throw error;
  const achadas = (data || []) as FotoDoPedido[];
  return ids.map((i) => achadas.filter((a) => a.id === i)[0]).filter(Boolean) as FotoDoPedido[];
}
