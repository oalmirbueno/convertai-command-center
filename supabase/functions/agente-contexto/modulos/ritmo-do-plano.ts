/** Permissão não é pedido de pesquisa. O modelo justifica uma lacuna antes de usar a web. */
export function precisaPesquisar(pedido: unknown, permitido: unknown, jaPesquisou: boolean): boolean {
  if (permitido !== true || jaPesquisou || !pedido || typeof pedido !== "object") return false;
  const o = pedido as Record<string, unknown>;
  return typeof o.motivo === "string" && o.motivo.trim().length > 0 &&
    typeof o.consulta === "string" && o.consulta.trim().length > 0;
}

/** Preserva o modelo escolhido, usando o menor esforço conversacional disponível. */
export function raciocinioDoPlano(aceitos: string[] | null): string | undefined {
  return ["low", "minimal", "medium", "high"].find(n => aceitos?.includes(n));
}

export const ORIENTACAO_DE_RITMO = `Primeiro resolva com os materiais, imagens, contexto e memória que recebeu. A web não foi acionada só porque está permitida.
- pesquisa: null quando o material basta. Só preencha {consulta, motivo} quando a equipe pediu pesquisa ou faltar um fato externo concreto indispensável. Não pesquise para organizar um evento com briefing, preencher tarefas ou analisar imagens anexadas. Falta de decisão da equipe vira pergunta objetiva, não pesquisa.
- Ao pedir pesquisa ou leitura interna, não escreva o plano inteiro ainda: resposta curta, ações null/listas vazias até receber o resultado. Na conclusão entregue o plano completo, sem repetir o briefing em cada tarefa. Sem pesquisa nem leitura pendente, conclua nesta chamada.
- A leitura de links já entregue nos materiais não deve ser repetida pela pesquisa. Se a pesquisa não trouxer fonte verificável, declare a lacuna; nunca preencha por suposição.`;
