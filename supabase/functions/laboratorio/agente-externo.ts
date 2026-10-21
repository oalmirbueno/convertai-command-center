/** O nó acompanha a execução já existente do operador; não cria outra tarefa nem aprova nada. */
export type VinculoExterno = { status: string; last_action: string | null; last_evidence: string | null; next_step: string | null; block_reason: string | null; updated_at: string };
const txt = (v: unknown, max = 4000) => typeof v === "string" ? v.trim().slice(0, max) : "";

export function retornoDoAgenteExterno(saida: Record<string, unknown>, vinculo: VinculoExterno | null): { saida: Record<string, unknown>; status: "pronto" | "aguardando" | "erro"; erro?: string } {
  if (!vinculo) return { saida: { ...saida, texto: "A tarefa ainda não devolveu um acompanhamento. Abra o diário da execução para conferir." }, status: "aguardando" };
  const prova = txt(vinculo.last_evidence);
  const acao = txt(vinculo.last_action, 1500);
  const proximo = txt(vinculo.next_step, 800);
  const bloqueio = txt(vinculo.block_reason, 800);
  const nome = txt(saida.operador_nome, 100) || "agente";
  const pronto = vinculo.status === "done" && !!prova;
  const cancelado = ["cancelled", "canceled", "cancelado"].includes(vinculo.status);
  const estado = pronto ? "Concluído com prova" : vinculo.status === "done" ? "Conclusão ainda sem prova" : vinculo.status === "review" ? "Entrega em revisão" : vinculo.status === "blocked" ? "Aguardando um desbloqueio" : vinculo.status === "in_progress" ? "Em execução" : cancelado ? "Execução cancelada" : "Na fila do agente";
  const texto = [`${nome}: ${estado}.`, acao ? `Última ação: ${acao}` : "", bloqueio ? `O que falta: ${bloqueio}` : "", proximo ? `Próximo passo: ${proximo}` : "", pronto ? `Prova: ${prova}` : ""].filter(Boolean).join("\n\n");
  return { saida: { ...saida, texto, estado: pronto ? "feito" : cancelado ? "cancelado" : "aguardando", vinculo_status: vinculo.status, prova: pronto ? prova : "", atualizado_em: vinculo.updated_at }, status: pronto ? "pronto" : cancelado ? "erro" : "aguardando", ...(cancelado ? { erro: texto } : {}) };
}
