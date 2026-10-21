import { janelaDoPedidoComLimite } from "./periodo-do-pedido.ts";

export interface MensagemDoPeriodoSemProposta {
  papel: "usuario" | "agente";
  conteudo: string;
  uso_id?: string;
  anexos: unknown[];
}

interface PedidoSemItens {
  periodo: { inicio: string; fim: string } | null;
  itensDoModelo: unknown;
  respostaDoModelo: unknown;
  mensagem: string;
  anexosDoUsuario: unknown[];
  conversaId: string;
  projectId: string | null;
  uso: { usoId: string; custoUsd: number; saldoUsd: number; reservaUsada?: string | null };
}

/** Uma janela explícita pode estar completa; isso é uma explicação, sem proposta vazia. */
export async function concluirPeriodoSemItens(p: PedidoSemItens, registrar: (mensagens: MensagemDoPeriodoSemProposta[]) => Promise<void>) {
  // Legado e saídas malformadas continuam no erro pedido_sem_itens do chamador.
  if (!p.periodo || !Array.isArray(p.itensDoModelo) || p.itensDoModelo.length !== 0) return null;
  const { inicio, fim } = p.periodo;
  janelaDoPedidoComLimite(inicio, "", fim);
  const explicacao = typeof p.respostaDoModelo === "string" ? p.respostaDoModelo.trim().slice(0, 2000) : "";
  const resposta = explicacao || `Nenhum conteúdo novo foi proposto de ${inicio} até ${fim}. A agenda existente foi preservada. Revise o período ou os critérios do pedido antes de fazer outro pedido.`;
  await registrar([
    { papel: "usuario", conteudo: p.mensagem, anexos: p.anexosDoUsuario },
    { papel: "agente", conteudo: resposta, uso_id: p.uso.usoId, anexos: [{ tipo: "calendario_sem_proposta", sem_proposta: true, quantidade: 0, periodo_pedido: { inicio, fim } }] },
  ]);
  return {
    proposta: null, quantidade: 0, sem_proposta: true, resposta, aviso_da_acao: resposta,
    conversa_id: p.conversaId, project_id: p.projectId,
    custo_usd: Math.round(p.uso.custoUsd * 1e6) / 1e6, saldo_usd: p.uso.saldoUsd,
    reserva_usada: p.uso.reservaUsada ?? null,
  };
}
