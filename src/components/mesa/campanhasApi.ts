import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao, padraoPara, saidaPorRaciocinio, TAMANHOS, type ModeloIa, type ParteDaEstimativa } from "@/lib/mesa/api";
import { chaves, MAX_ANEXOS, type Campanha, type MensagemDoAgente, type PropostaV4 } from "./mesaV4Api";

/**
 * Campanhas, versão 5 (23/09, noite): a conversa com o agente da campanha.
 * Contrato em docs/mesa-do-cliente/CONTRATOS-V5.md (campanha_conversar). A
 * conversa mora em agente_conversas (referencia_tipo 'mesa_campanha',
 * referencia_id = campanha.id) e a tela lê direto (RLS da equipe). Tudo que
 * volta das leituras é JSON puro: a Mesa guarda o cache no navegador.
 */

export const REFERENCIA_DA_CONVERSA = "mesa_campanha";

export const chavesDaCampanha = {
  conversa: (clientId: string, campanhaId: string) => ["mesa", "campanha-conversa", clientId, campanhaId] as const,
  contagem: (clientId: string, ids: string[]) => ["mesa", "campanhas-contagem", clientId, ids.join(",")] as const,
};

export interface ConversaDaCampanha {
  conversaId: string | null;
  mensagens: MensagemDoAgente[];
}

export async function lerConversaDaCampanha(campanhaId: string): Promise<ConversaDaCampanha> {
  const { data: conversas, error } = await (supabase as any)
    .from("agente_conversas")
    .select("id")
    .eq("referencia_tipo", REFERENCIA_DA_CONVERSA)
    .eq("referencia_id", campanhaId)
    .order("criado_em", { ascending: false })
    .limit(1);
  if (error) throw error;
  const conversaId: string | null = conversas && conversas[0] ? String(conversas[0].id) : null;
  if (!conversaId) return { conversaId: null, mensagens: [] };
  const { data, error: erroMsgs } = await (supabase as any)
    .from("agente_mensagens")
    .select("id, papel, conteudo, anexos, criado_em")
    .eq("conversa_id", conversaId)
    .order("criado_em", { ascending: false })
    .limit(80);
  if (erroMsgs) throw erroMsgs;
  const mensagens = ((data || []) as MensagemDoAgente[])
    .slice()
    .reverse()
    .map((m) => ({
      id: String(m.id),
      papel: m.papel,
      conteudo: String(m.conteudo || ""),
      anexos: Array.isArray(m.anexos) ? m.anexos : [],
      criado_em: String(m.criado_em || ""),
    }));
  return { conversaId, mensagens };
}

/**
 * Quantos conteúdos cada proposta de campanha tem (para a lista). Lê só o id
 * e os itens das propostas das campanhas e devolve { proposta_id: n }.
 */
export async function lerContagemDosConteudos(propostaIds: string[]): Promise<Record<string, number>> {
  if (!propostaIds.length) return {};
  const { data, error } = await (supabase as any).from("calendario_propostas").select("id, itens").in("id", propostaIds);
  if (error) throw error;
  const saida: Record<string, number> = {};
  ((data || []) as { id: string; itens: unknown }[]).forEach((p) => {
    saida[String(p.id)] = Array.isArray(p.itens) ? p.itens.length : 0;
  });
  return saida;
}

export interface CorpoDaConversa {
  campanhaId: string;
  mensagem: string;
  anexos?: string[];
}

export function corpoDaConversaDaCampanha(c: CorpoDaConversa): Record<string, unknown> {
  const corpo: Record<string, unknown> = { acao: "campanha_conversar", campanha_id: c.campanhaId, mensagem: c.mensagem };
  if (c.anexos && c.anexos.length) corpo.anexos = c.anexos.slice(0, MAX_ANEXOS);
  return corpo;
}

export const campanhaConversar = (c: CorpoDaConversa) => chamarFuncao<any>("agente-calendario", corpoDaConversaDaCampanha(c));

/** Uma chamada do estrategista (pode refazer os conteúdos), mais a leitura das imagens. */
export const partesDaConversaDaCampanha = (catalogo: ModeloIa[], anexos: number): ParteDaEstimativa[] => {
  const m = padraoPara(catalogo, "estrategista");
  return [
    {
      modeloId: m ? m.id : null,
      tipo: "texto",
      tokensEntrada: TAMANHOS.conversarMes.entrada + anexos * TAMANHOS.imagemAnexos.entrada,
      tokensSaida: saidaPorRaciocinio("medium"),
    },
  ];
};

/** Troca a campanha na lista em cache (ou põe no topo, se for nova). */
export function trocarCampanhaNoCache(qc: QueryClient, clientId: string, nova: Campanha) {
  qc.setQueryData<Campanha[]>(chaves.campanhas(clientId), (lista) => {
    const atual = lista || [];
    const tem = atual.some((c) => c.id === nova.id);
    return tem ? atual.map((c) => (c.id === nova.id ? nova : c)) : [nova].concat(atual);
  });
}

/**
 * Resposta do agente da campanha (ou de outra ação da campanha): a campanha
 * e a proposta mudam na tela na hora; a lista e a contagem relêem depois.
 */
export function aplicarRespostaDaCampanha(qc: QueryClient, clientId: string, data: any) {
  const campanha = data && data.campanha ? (data.campanha as Campanha) : null;
  const proposta = data && data.proposta && data.proposta.id ? (data.proposta as PropostaV4) : null;
  if (campanha) trocarCampanhaNoCache(qc, clientId, campanha);
  if (proposta) qc.setQueryData(chaves.proposta(proposta.id), proposta);
  void qc.invalidateQueries({ queryKey: chaves.campanhas(clientId) });
  void qc.invalidateQueries({ queryKey: ["mesa", "campanhas-contagem", clientId] });
}

/** Quantos conteúdos a campanha tem, pela proposta em cache ou pela contagem. */
export function conteudosDaCampanha(qc: QueryClient, campanha: Campanha, contagem: Record<string, number> | undefined): number | null {
  if (!campanha.proposta_id) return 0;
  const p = qc.getQueryData<PropostaV4 | null>(chaves.proposta(campanha.proposta_id));
  if (p && Array.isArray(p.itens)) return p.itens.length;
  if (contagem && Object.prototype.hasOwnProperty.call(contagem, campanha.proposta_id)) return contagem[campanha.proposta_id];
  return null;
}
