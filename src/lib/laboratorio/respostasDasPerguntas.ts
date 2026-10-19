import type { PerguntaGuiada } from "./api";
import { ROTULOS_DAS_PERGUNTAS } from "./nos";

/**
 * Etapa das perguntas (21/10/2026, pedido do dono): cada pergunta tem a sua
 * resposta (a opção tocada preenche só a resposta DAQUELA pergunta, e o campo
 * livre dela troca o texto), mais uma conversa livre que vai junto. O que vai
 * para a função continua sendo o texto `respostas` do `planejar`, uma linha
 * "Rótulo: resposta" por pergunta respondida (o mesmo formato de antes).
 */

/** Rótulo curto da pergunta (o começo da linha da resposta). */
export function rotuloDaPergunta(p: PerguntaGuiada): string {
  return ROTULOS_DAS_PERGUNTAS[p.id] || p.pergunta.replace(/[?].*$/, "").trim() || p.id;
}

/** Junta as respostas por pergunta e a conversa livre no texto `respostas` do planejar. */
export function montarRespostas(perguntas: PerguntaGuiada[], respostas: Record<string, string>, conversa: string): string {
  const linhas: string[] = [];
  perguntas.forEach((p) => {
    const v = (respostas[p.id] || "").replace(/\s+/g, " ").trim();
    if (v) linhas.push(`${rotuloDaPergunta(p)}: ${v}`);
  });
  const livre = (conversa || "").trim();
  if (livre) linhas.push(`Conversa livre: ${livre}`);
  return linhas.join("\n");
}
