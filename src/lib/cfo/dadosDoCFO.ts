import { useQuery, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao } from "@/lib/mesa/api";
import type { AcaoDoAgente, PedidoDaAcao, RespostaDaAcao } from "@/lib/agentes/acoesDoAgente";
import {
  avaliarGasto,
  retratoDoCFO,
  type AvaliacaoDoGasto,
  type DadosDoCFO,
  type GastoProposto,
  type IntencaoDoCFO,
  type Retrato,
} from "../../../supabase/functions/agente-cfo/modulos/cfo-calculos";
import { caixinhasDe, COLUNAS, hojeEmSaoPaulo, montarDadosDoCFO } from "../../../supabase/functions/agente-cfo/modulos/cfo-dados";

/**
 * O CFO na tela (frente CFO, 30/09): a MESMA conta da função agente-cfo
 * (supabase/functions/agente-cfo/modulos), com o login do admin (RLS: o
 * financeiro é só dele). A tela calcula sozinha, sem esperar a função: o
 * painel de saúde, a projeção, o limite e a trava das despesas funcionam
 * mesmo antes da função ser publicada. Só a conversa precisa dela.
 */

export const CHAVE_DOS_DADOS_DO_CFO = ["cfo", "dados"] as const;

/** Tabelas novas do CFO ainda não estão nos tipos gerados: leitura sem tipo. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const semTipo = supabase as any;

export async function lerDadosDoCFO(userId: string): Promise<DadosDoCFO> {
  const desde = new Date(Date.now() - 62 * 86_400_000).toISOString();
  const [cobrancas, pagamentos, despesas, clientes, config, perfil, metas, travas] = await Promise.all([
    semTipo.from("billing").select(COLUNAS.cobrancas).limit(5000),
    semTipo.from("project_payments").select(COLUNAS.pagamentos).limit(2000),
    semTipo.from("expenses").select(COLUNAS.despesas).limit(5000),
    semTipo.from("profiles").select(COLUNAS.clientes).limit(5000),
    semTipo.from("financial_settings").select(COLUNAS.config).eq("settings_key", "default").maybeSingle(),
    semTipo.from("profiles").select("services_config").eq("id", userId).maybeSingle(),
    semTipo.from("cfo_metas").select(COLUNAS.metas).is("arquivado_em", null).order("criado_em", { ascending: true }).limit(50),
    semTipo.from("cfo_eventos").select(COLUNAS.travas).gte("criado_em", desde).limit(500),
  ]);
  const falha = [cobrancas, pagamentos, despesas, clientes, config, perfil].find((r: { error: unknown }) => r.error);
  if (falha) throw new Error(`Não consegui ler o financeiro: ${(falha.error as { message?: string }).message || "erro"}`);
  return montarDadosDoCFO({
    hoje: hojeEmSaoPaulo(),
    cobrancas: cobrancas.data,
    pagamentos: pagamentos.data,
    despesas: despesas.data,
    clientes: clientes.data,
    config: config.data,
    caixinhas: caixinhasDe(perfil.data?.services_config),
    // Sem a migration do CFO aplicada, metas e travas vêm vazias (o resto funciona).
    metas: metas.error ? [] : metas.data,
    travas: travas.error ? [] : travas.data,
  });
}

export function useDadosDoCFO(userId: string | null | undefined) {
  return useQuery({
    queryKey: [...CHAVE_DOS_DADOS_DO_CFO, userId],
    enabled: !!userId,
    queryFn: () => lerDadosDoCFO(userId as string),
    staleTime: 60_000,
  });
}

/** O retrato na hora da trava: relê (sem cache velho) e avalia o gasto. */
export async function avaliarGastoAgora(qc: QueryClient, userId: string, gasto: GastoProposto): Promise<{ avaliacao: AvaliacaoDoGasto; retrato: Retrato }> {
  const dados = await qc.fetchQuery({ queryKey: [...CHAVE_DOS_DADOS_DO_CFO, userId], queryFn: () => lerDadosDoCFO(userId), staleTime: 0 });
  const retrato = retratoDoCFO(dados);
  return { avaliacao: avaliarGasto(retrato, gasto), retrato };
}

/** Registro da trava (RLS: só o próprio admin). Falha não bloqueia o lançamento, mas vai para o console e para a tela. */
export async function registrarTrava(e: {
  avaliacao: AvaliacaoDoGasto;
  decisao: "lancou" | "desistiu";
  origem: "caixa" | "custos_fixos" | "painel";
  descricao?: string | null;
  recorrente?: boolean;
  userId: string;
}): Promise<string | null> {
  const { error } = await semTipo.from("cfo_eventos").insert({
    tipo: e.avaliacao.nivel === "bloqueado" ? "gasto_acima_do_limite" : "gasto_em_atencao",
    valor: e.avaliacao.valor,
    limite: e.avaliacao.limite,
    recorrente: e.recorrente === true,
    descricao: e.descricao ? String(e.descricao).slice(0, 300) : null,
    origem: e.origem,
    decisao: e.decisao,
    criado_por: e.userId,
  });
  if (error) {
    console.error("[cfo] trava não registrada", error.message);
    return error.message;
  }
  return null;
}

// ------------------------------------------------------------------ conversa com o agente (função agente-cfo)

export interface MensagemDoCFO {
  id: string;
  papel: "usuario" | "agente" | "sistema";
  conteudo: string;
  anexos: unknown[];
  criado_em: string;
}

export interface RespostaDoCFO {
  resposta: string;
  resposta_do_motor: string;
  intencao: IntencaoDoCFO;
  avaliacao: AvaliacaoDoGasto | null;
  anexo: AcaoDoAgente | null;
  mensagem_id: string | null;
  modelo_id: string | null;
  custo_usd: number;
  aviso: string | null;
}

export function perguntarAoCfo(pergunta: string, opcoes: { modeloId?: string | null; meses?: number } = {}): Promise<RespostaDoCFO> {
  return chamarFuncao<RespostaDoCFO>("agente-cfo", { acao: "perguntar", pergunta, modelo_id: opcoes.modeloId || null, meses: opcoes.meses || 6 });
}

export async function conversaDoCfo(): Promise<MensagemDoCFO[]> {
  const r = await chamarFuncao<{ mensagens: MensagemDoCFO[] }>("agente-cfo", { acao: "conversa" });
  return Array.isArray(r.mensagens) ? r.mensagens : [];
}

/** O pedido do cartão (Confirmar, Cancelar, Desfazer, Parar) para a função. */
export function pedidoDaAcaoDoCfo(mensagemId: string, acaoId: string, extra: { confirmarAcimaDoLimite?: boolean } = {}) {
  return (pedido: PedidoDaAcao): Promise<RespostaDaAcao> => {
    if (pedido === "desfazer") return chamarFuncao<RespostaDaAcao>("agente-cfo", { acao: "desfazer_acao_agente", mensagem_id: mensagemId, acao_id: acaoId });
    return chamarFuncao<RespostaDaAcao>("agente-cfo", {
      acao: "executar_acao_agente",
      mensagem_id: mensagemId,
      acao_id: acaoId,
      descartar: pedido === "descartar",
      parar: pedido === "parar",
      confirmar_acima_do_limite: extra.confirmarAcimaDoLimite === true,
    });
  };
}

/** O lançamento proposto exige o "entendi" do dono (passou do limite)? */
export function exigeConfirmacaoExplicita(acao: AcaoDoAgente | null | undefined): boolean {
  const ctx = (acao?.contexto || {}) as Record<string, unknown>;
  return ctx.exige_confirmacao_explicita === true;
}
