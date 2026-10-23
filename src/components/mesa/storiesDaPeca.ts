import { gravarEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { pedidoDosStories } from "../../../supabase/functions/agente-calendario/modulos/escolha-do-mes";

/**
 * 24/10/2026: a peça de Stories do Mês abre na aba Stories já com o tema e o dia (o gerador é o da aba Stories,
 * sem duplicar). Deixa a Nova sequência preenchida e o bloco Sequência aberto; quem chama troca a aba
 * (/mesa?client=<id>&aba=stories). Dia que já passou vira hoje (a Nova sequência não aceita o passado).
 */
export function prepararStoriesDaPeca(clientId: string, item: { title: string; due_date: string | null }, hoje: string) {
  const dia = item.due_date && item.due_date.slice(0, 10) >= hoje ? item.due_date.slice(0, 10) : hoje;
  gravarEstadoDaTela(`mesa:stories:nova-v2:${clientId}`, { data: dia, modelo: "conversao", telas: 5, campanhaId: "", fase: "lancamento", pedido: pedidoDosStories(item.title), objetivo: "engajar", comImagens: true });
  gravarEstadoDaTela(`mesa:stories:bloco:${clientId}`, "sequencia");
}
