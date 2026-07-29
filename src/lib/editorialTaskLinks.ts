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
