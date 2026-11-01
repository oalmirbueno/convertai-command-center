export interface EditorialTaskLinkRow {
  post_id: string;
  task_id: string | null;
  revision_of_post_id: string | null;
}

export interface EditorialTaskLinkIndex {
  taskIds: string[];
  postIdByTaskId: Record<string, string>;
}

export function buildEditorialTaskLinkIndex(
  links: EditorialTaskLinkRow[],
  activePostIds: ReadonlySet<string>,
): EditorialTaskLinkIndex {
  const activeLinks = links.filter(
    (
      link,
    ): link is EditorialTaskLinkRow & {
      task_id: string;
    } => Boolean(link.task_id && activePostIds.has(link.post_id)),
  );
  const nonTerminalPostIds = new Set(
    activeLinks
      .map((link) => link.revision_of_post_id)
      .filter((postId): postId is string => Boolean(postId)),
  );
  const postIdByTaskId: Record<string, string> = {};

  for (const link of activeLinks) {
    if (nonTerminalPostIds.has(link.post_id)) continue;
    const currentPostId = postIdByTaskId[link.task_id];
    if (!currentPostId || link.post_id.localeCompare(currentPostId) < 0) {
      postIdByTaskId[link.task_id] = link.post_id;
    }
  }

  return {
    taskIds: Object.keys(postIdByTaskId).sort(),
    postIdByTaskId,
  };
}

/**
 * Agenda do cliente (01/11/2026): o índice tarefa -> conteúdo do próprio cliente, vindo da função
 * `editorial_client_task_links` (o cliente não lê editorial_post_internal). Sem ele a mesma peça aparecia
 * duas vezes: a tarefa no prazo e o card do conteúdo.
 *
 * Função ainda não aplicada no banco (o PostgREST responde PGRST202; o Postgres, 42883): devolve índice
 * vazio, que é exatamente o comportamento de antes. Qualquer outro erro sobe, para não guardar "sem
 * vínculo" como dado bom.
 */
export function indiceDoClienteAPartirDaResposta(resposta: {
  data: EditorialTaskLinkRow[] | null;
  error: { code?: string | null; message?: string } | null;
}): EditorialTaskLinkIndex {
  if (resposta.error) {
    const codigo = String(resposta.error.code || "");
    if (codigo === "PGRST202" || codigo === "42883") return { taskIds: [], postIdByTaskId: {} };
    throw resposta.error;
  }
  const linhas = resposta.data || [];
  // A função já devolve só conteúdos ativos e não arquivados: todos contam como ativos.
  return buildEditorialTaskLinkIndex(linhas, new Set(linhas.map((linha) => linha.post_id)));
}
