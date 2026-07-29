import type { EditorialQueryResult } from "@/hooks/useEditorialCalendar";

export function updateCachedEditorialPostStage(
  value: unknown,
  postId: string,
  productionStatus: string,
) {
  if (!value || typeof value !== "object") return value;
  const result = value as EditorialQueryResult;
  if (!Array.isArray(result.posts)) return value;

  return {
    ...result,
    posts: result.posts.map((bundle) =>
      bundle.post.id === postId
        ? {
            ...bundle,
            post: {
              ...bundle.post,
              production_status: productionStatus,
            },
          }
        : bundle,
    ),
  };
}

export function updateCachedEditorialPublicationDate(
  value: unknown,
  publicationId: string,
  scheduledAt: string | null,
) {
  if (!value || typeof value !== "object") return value;
  const result = value as EditorialQueryResult;
  if (!Array.isArray(result.posts)) return value;

  return {
    ...result,
    posts: result.posts.map((bundle) => {
      if (
        !bundle.publications.some(
          (item) => item.publication.id === publicationId,
        )
      ) {
        return bundle;
      }
      return {
        ...bundle,
        publications: bundle.publications.map((item) =>
          item.publication.id === publicationId
            ? {
                ...item,
                publication: {
                  ...item.publication,
                  scheduled_at: scheduledAt,
                },
              }
            : item,
        ),
      };
    }),
  };
}

export function updateCachedTaskStatus(
  value: unknown,
  taskId: string,
  status: string,
) {
  if (!Array.isArray(value)) return value;
  return value.map((task) => {
    if (
      !task ||
      typeof task !== "object" ||
      !("id" in task) ||
      task.id !== taskId
    ) {
      return task;
    }
    return { ...task, status };
  });
}
