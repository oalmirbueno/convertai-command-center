import { useSyncExternalStore } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ErroDaMesa, textoDoErro, usd, type Qualidade } from "@/lib/mesa/api";
import { chaveDosEnsaios, gerarTomada, guardarEnsaio, invalidarFotos, type Camera, type Guia } from "./fotoApi";

/**
 * Gerar em lote (CONTRATO-V2): uma chamada de tomada_gerar por foto, uma de
 * cada vez, com o andamento de cada foto. O lote vive fora da tela (neste
 * módulo): dá para trocar de etapa, abrir o diretor ou ir para a Campanha e
 * voltar, que o lote segue e a tela reencontra o andamento. Cada foto pronta
 * já fica gravada no ensaio; se a página fechar, o que foi gerado fica salvo
 * e o resto espera na tela para gerar depois.
 *
 * Sem laço de correção: gera uma vez cada foto. Falha de uma foto não para o
 * lote, a não ser quando falta saldo, cota, chave ou modelo (aí as outras
 * falhariam igual).
 */

export type EstadoNoLote = "fila" | "gerando" | "feita" | "falhou" | "pulada";

export interface ItemDoLote {
  tomada_id: string;
  nome: string;
  estado: EstadoNoLote;
  erro: string;
  custo_usd: number;
}

export interface Lote {
  ensaio_id: string;
  client_id: string;
  itens: ItemDoLote[];
  ativo: boolean;
  /** Pediram para parar: termina a foto atual e pula o resto. */
  parar: boolean;
  motivo_parada: string;
  custo_usd: number;
}

let lotes: Record<string, Lote> = {};
const ouvintes: (() => void)[] = [];

function avisar() {
  ouvintes.slice().forEach((f) => f());
}

function inscrever(f: () => void) {
  ouvintes.push(f);
  return () => {
    const i = ouvintes.indexOf(f);
    if (i >= 0) ouvintes.splice(i, 1);
  };
}

function mudarLote(ensaioId: string, fn: (l: Lote) => Lote) {
  const atual = lotes[ensaioId];
  if (!atual) return;
  const copia: Record<string, Lote> = {};
  Object.keys(lotes).forEach((k) => {
    copia[k] = lotes[k];
  });
  copia[ensaioId] = fn(atual);
  lotes = copia;
  avisar();
}

function mudarItem(ensaioId: string, tomadaId: string, mudancas: Partial<ItemDoLote>) {
  mudarLote(ensaioId, (l) => ({ ...l, itens: l.itens.map((i) => (i.tomada_id === tomadaId ? { ...i, ...mudancas } : i)) }));
}

export const loteDe = (ensaioId: string | null | undefined): Lote | null => (ensaioId ? lotes[ensaioId] || null : null);

/** Andamento do lote de um ensaio (ou nulo). Reage a cada foto. */
export function useLote(ensaioId: string | null | undefined): Lote | null {
  return useSyncExternalStore(inscrever, () => loteDe(ensaioId));
}

/** Todos os lotes (para a barra mostrar o que está gerando em qualquer etapa). */
export function useLotes(): Record<string, Lote> {
  return useSyncExternalStore(inscrever, () => lotes);
}

export function resumoDoLote(l: Lote | null) {
  if (!l) return { total: 0, feitas: 0, falharam: 0, puladas: 0, andando: 0, atual: null as ItemDoLote | null };
  let feitas = 0;
  let falharam = 0;
  let puladas = 0;
  let atual: ItemDoLote | null = null;
  l.itens.forEach((i) => {
    if (i.estado === "feita") feitas++;
    else if (i.estado === "falhou") falharam++;
    else if (i.estado === "pulada") puladas++;
    else if (i.estado === "gerando") atual = i;
  });
  return { total: l.itens.length, feitas, falharam, puladas, andando: feitas + falharam + puladas, atual };
}

/** A tomada está sendo gerada pelo lote agora. */
export const geraNoLote = (l: Lote | null, tomadaId: string) => !!l && l.ativo && l.itens.some((i) => i.tomada_id === tomadaId && (i.estado === "gerando" || i.estado === "fila"));

export interface PedidoDeLote {
  clientId: string;
  ensaioId: string;
  tomadas: { id: string; nome: string; camera?: Camera | null }[];
  modeloImagemId: string | null;
  qualidade: Qualidade;
  guia?: Guia | null;
  queryClient: QueryClient;
  /** Relê o saldo da barra depois de cada foto. */
  aoAtualizarCusto?: () => void;
}

/** Começa o lote; devolve false quando este ensaio já tem um lote andando. */
export function iniciarLote(p: PedidoDeLote): boolean {
  const atual = lotes[p.ensaioId];
  if (atual && atual.ativo) return false;
  if (!p.tomadas.length) return false;
  const copia: Record<string, Lote> = {};
  Object.keys(lotes).forEach((k) => {
    copia[k] = lotes[k];
  });
  copia[p.ensaioId] = {
    ensaio_id: p.ensaioId,
    client_id: p.clientId,
    itens: p.tomadas.map((t) => ({ tomada_id: t.id, nome: t.nome, estado: "fila" as EstadoNoLote, erro: "", custo_usd: 0 })),
    ativo: true,
    parar: false,
    motivo_parada: "",
    custo_usd: 0,
  };
  lotes = copia;
  avisar();
  void rodar(p);
  return true;
}

/** Para depois da foto que está gerando agora (ela termina e fica salva). */
export function pararLote(ensaioId: string) {
  mudarLote(ensaioId, (l) => ({ ...l, parar: true }));
}

/** Tira o resumo de um lote terminado da tela. */
export function esquecerLote(ensaioId: string) {
  const l = lotes[ensaioId];
  if (!l || l.ativo) return;
  const copia: Record<string, Lote> = {};
  Object.keys(lotes).forEach((k) => {
    if (k !== ensaioId) copia[k] = lotes[k];
  });
  lotes = copia;
  avisar();
}

/** Só para os testes: começa sem nenhum lote. */
export function esquecerTodosOsLotes() {
  lotes = {};
  avisar();
}

async function rodar(p: PedidoDeLote) {
  const id = p.ensaioId;
  for (const t of p.tomadas) {
    const agora = lotes[id];
    if (!agora) return;
    if (agora.parar) {
      mudarLote(id, (l) => ({ ...l, motivo_parada: l.motivo_parada || "Parado a pedido.", itens: l.itens.map((i) => (i.estado === "fila" ? { ...i, estado: "pulada" as EstadoNoLote } : i)) }));
      break;
    }
    mudarItem(id, t.id, { estado: "gerando" });
    try {
      const r = await gerarTomada({ ensaioId: id, tomadaId: t.id, modeloImagemId: p.modeloImagemId, qualidade: p.qualidade, camera: t.camera || null, guia: p.guia || null });
      if (r.ensaio) guardarEnsaio(p.queryClient, p.clientId, r.ensaio);
      else void p.queryClient.invalidateQueries({ queryKey: chaveDosEnsaios(p.clientId) });
      invalidarFotos(p.queryClient, p.clientId);
      const custo = Number((r && r.custo_usd) || 0) || 0;
      mudarItem(id, t.id, { estado: "feita", custo_usd: custo });
      mudarLote(id, (l) => ({ ...l, custo_usd: l.custo_usd + custo }));
    } catch (e) {
      // A falha fica escrita na tomada (status falhou): relê o ensaio.
      void p.queryClient.invalidateQueries({ queryKey: chaveDosEnsaios(p.clientId) });
      mudarItem(id, t.id, { estado: "falhou", erro: textoDoErro(e) });
      if (e instanceof ErroDaMesa && e.acao) {
        // Sem saldo, cota, chave ou modelo: as próximas falhariam igual.
        mudarLote(id, (l) => ({ ...l, motivo_parada: textoDoErro(e), itens: l.itens.map((i) => (i.estado === "fila" ? { ...i, estado: "pulada" as EstadoNoLote } : i)) }));
        if (p.aoAtualizarCusto) p.aoAtualizarCusto();
        break;
      }
    }
    if (p.aoAtualizarCusto) p.aoAtualizarCusto();
  }
  mudarLote(id, (l) => ({ ...l, ativo: false }));
  const fim = lotes[id];
  if (!fim) return;
  const r = resumoDoLote(fim);
  if (r.feitas) {
    toast.success(`${r.feitas} de ${r.total} ${r.total === 1 ? "foto gerada" : "fotos geradas"}`, {
      description: `Custo real: ${usd(fim.custo_usd)}. Agora é revisar e aprovar.${r.falharam ? ` ${r.falharam} ${r.falharam === 1 ? "falhou" : "falharam"} e pode gerar de novo.` : ""}`,
    });
  } else if (r.falharam) {
    toast.error("O lote não gerou nenhuma foto", { description: fim.motivo_parada || (fim.itens.find((i) => i.erro) || { erro: "" }).erro || "Tente de novo.", duration: 9000 });
  }
}
