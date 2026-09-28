import { chamarFuncao } from "@/lib/mesa/api";
import type { ItemDoMes } from "./useItensDoMes";

/**
 * Arquivar pela faixa das pautas do Estúdio (frente AE, 28/09, dono:
 * "conseguir apagar os conteúdos que não quero mais por aqui também").
 *
 * Apagar = arquivar, nunca exclusão real: o caminho é o mesmo do Mês
 * (agente-calendario arquivar_item_agenda: tarefa com deleted_at, memória do
 * estrategista, travas de pedido do cliente, publicação agendada ou no ar e
 * arte aprovada), com o post da Agenda só planejado saindo junto
 * (arquivar_post). "Desfazer" é o restaurar_item_agenda, que também devolve
 * esse post. Nunca src/lib/taskDelete.ts (que apaga de verdade).
 */

export interface ArquivadaDaFaixa {
  taskId: string;
  titulo: string;
  memoriaId: string | null;
  postId: string | null;
}

export interface RecusadaDaFaixa {
  taskId: string;
  titulo: string;
  motivo: string;
}

export const arquivarDaFaixa = (clientId: string, taskId: string) =>
  chamarFuncao<{ task_id: string; titulo: string; memoria_id: string | null; post_arquivado?: string | null; ja_estava_apagado?: boolean }>("agente-calendario", {
    acao: "arquivar_item_agenda",
    client_id: clientId,
    task_id: taskId,
    // A confirmação da tela já disse que a arte fica guardada: não pergunta de novo.
    confirmar_arte: true,
    arquivar_post: true,
  });

export const restaurarDaFaixa = (clientId: string, a: ArquivadaDaFaixa) =>
  chamarFuncao<{ task_id: string; aviso?: string | null }>("agente-calendario", {
    acao: "restaurar_item_agenda",
    client_id: clientId,
    task_id: a.taskId,
    memoria_id: a.memoriaId || undefined,
    post_id: a.postId || undefined,
  });

/** Tira da fila de geração o que ainda não começou (o que está gerando termina). */
export const tirarDaFila = (trabalhoId: string) => chamarFuncao<any>("estudio-arte", { acao: "cancelar_fila", trabalho_id: trabalhoId });

// ------------------------------------------------------------------ parecidas

/** Título sem acento, sem o prefixo de formato ("Carrossel |") e sem pontuação. Função pura. */
export function tituloComparavel(titulo: string): string {
  const t = String(titulo || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  const semPrefixo = t.replace(/^\s*(\[[^\]]*\]\s*)?(carrossel|post|estatico|reels?|story|stories|video|arte)\s*[|:]\s*/, "");
  return semPrefixo.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function palavras(t: string): string[] {
  return t.split(" ").filter((p) => p.length > 2);
}

/** Dois títulos contam como parecidos: iguais, um começa pelo outro, ou quase as mesmas palavras. */
export function titulosParecidos(a: string, b: string): boolean {
  const x = tituloComparavel(a);
  const y = tituloComparavel(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const menor = x.length <= y.length ? x : y;
  const maior = x.length <= y.length ? y : x;
  if (menor.length >= 20 && maior.indexOf(menor) === 0) return true;
  const px = palavras(x);
  const py = palavras(y);
  if (px.length < 3 || py.length < 3) return false;
  const conjunto: Record<string, true> = {};
  px.forEach((p) => {
    conjunto[p] = true;
  });
  const comuns = py.filter((p) => conjunto[p]).length;
  const uniao = px.length + py.length - comuns;
  return uniao > 0 && comuns / uniao >= 0.75;
}

/**
 * Pautas parecidas no mesmo dia (duplicata do plano ou de outro agente): o id
 * de cada uma aponta para as outras parecidas. Função pura.
 */
export function pautasParecidas(itens: Pick<ItemDoMes, "id" | "title" | "due_date">[]): Record<string, string[]> {
  const saida: Record<string, string[]> = {};
  const porDia: Record<string, Pick<ItemDoMes, "id" | "title" | "due_date">[]> = {};
  itens.forEach((i) => {
    const dia = i.due_date ? i.due_date.slice(0, 10) : "";
    if (!dia) return;
    (porDia[dia] = porDia[dia] || []).push(i);
  });
  Object.keys(porDia).forEach((dia) => {
    const lista = porDia[dia];
    for (let a = 0; a < lista.length; a++) {
      for (let b = a + 1; b < lista.length; b++) {
        if (!titulosParecidos(lista[a].title, lista[b].title)) continue;
        (saida[lista[a].id] = saida[lista[a].id] || []).push(lista[b].id);
        (saida[lista[b].id] = saida[lista[b].id] || []).push(lista[a].id);
      }
    }
  });
  return saida;
}
