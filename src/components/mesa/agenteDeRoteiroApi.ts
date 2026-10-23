import { chamarFuncao, padraoPara, parteDaConferenciaDoJev, type ModeloIa, type ParteDaEstimativa } from "@/lib/mesa/api";
import type { ItemProposto } from "./mesaV4Api";
import type { RoteiroDeVideo } from "../../../supabase/functions/agente-calendario/modulos/roteiro-de-video";
import {
  normalizarOpcoesDoRoteiro,
  type CriatividadeDoRoteiro,
  type EstiloDoRoteiro,
  type OpcoesDoRoteiro,
} from "../../../supabase/functions/agente-calendario/modulos/agente-de-roteiro";

/**
 * Agente de roteiro da peça de vídeo (23/10/2026): a ação campanha_roteiro_agente do agente-calendario.
 * criar devolve as versões (guardadas na peça em roteiro_opcoes); ajustar devolve o roteiro sem gravar.
 */

export interface PedidoDoAgente {
  campanhaId: string;
  temaId: string;
  ideia: string;
  duracao: number;
  estilo: EstiloDoRoteiro;
  criatividade: CriatividadeDoRoteiro;
  /** O modelo da copy escolhido na tela (vazio: o servidor usa o lembrado ou o padrão). */
  corpoDoModelo?: Record<string, string>;
}

export const criarRoteiroComAgente = (p: PedidoDoAgente) =>
  chamarFuncao<{ opcoes: OpcoesDoRoteiro; proposta: unknown; custo_usd: number }>("agente-calendario", {
    acao: "campanha_roteiro_agente",
    operacao: "criar",
    campanha_id: p.campanhaId,
    tema_id: p.temaId,
    ideia: p.ideia,
    duracao_s: p.duracao,
    estilo: p.estilo,
    criatividade: p.criatividade,
    ...(p.corpoDoModelo || {}),
  });

export const ajustarRoteiroComAgente = (p: { campanhaId: string; temaId: string; roteiro: RoteiroDeVideo; pedido: string; duracao: number; criatividade: CriatividadeDoRoteiro; corpoDoModelo?: Record<string, string> }) =>
  chamarFuncao<{ roteiro: RoteiroDeVideo; resposta: string; custo_usd: number }>("agente-calendario", {
    acao: "campanha_roteiro_agente",
    operacao: "ajustar",
    campanha_id: p.campanhaId,
    tema_id: p.temaId,
    roteiro: p.roteiro,
    pedido: p.pedido,
    duracao_s: p.duracao,
    criatividade: p.criatividade,
    ...(p.corpoDoModelo || {}),
  });

/** O custo antes: o modelo da copy (ou o estrategista) e, no criar, a escolha do Jev. */
export function partesDoAgenteDeRoteiro(catalogo: ModeloIa[], modeloId: string, operacao: "criar" | "ajustar", duracao: number): ParteDaEstimativa[] {
  const m = modeloId || (padraoPara(catalogo, "estrategista") || { id: "" }).id;
  // A saída cresce com a duração (duas versões no criar, uma no ajustar).
  const porVersao = Math.min(6000, 1500 + duracao * 15);
  const saida = operacao === "criar" ? porVersao * 2 : porVersao;
  const texto: ParteDaEstimativa = { modeloId: m || null, tipo: "texto", tokensEntrada: 32000, tokensSaida: saida };
  return operacao === "criar" ? [texto, parteDaConferenciaDoJev()] : [texto];
}

export const opcoesDaPeca = (item: ItemProposto): OpcoesDoRoteiro | null => normalizarOpcoesDoRoteiro((item as ItemProposto & { roteiro_opcoes?: unknown }).roteiro_opcoes);
