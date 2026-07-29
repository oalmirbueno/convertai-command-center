import { describe, expect, it } from "vitest";
import {
  updateCachedEditorialPostStage,
  updateCachedEditorialPublicationDate,
  updateCachedTaskStatus,
} from "@/lib/editorialOptimistic";

const result = {
  accounts: [],
  posts: [
    {
      post: { id: "post-1", production_status: "draft" },
      publications: [
        {
          publication: {
            id: "publication-1",
            scheduled_at: "2026-07-29T12:00:00.000Z",
          },
        },
      ],
    },
    {
      post: { id: "post-2", production_status: "production" },
      publications: [],
    },
  ],
};

describe("editorial optimistic cache helpers", () => {
  it("updates only the moved post", () => {
    const updated = updateCachedEditorialPostStage(
      result,
      "post-1",
      "ready",
    ) as typeof result;

    expect(updated.posts[0].post.production_status).toBe("ready");
    expect(updated.posts[1]).toBe(result.posts[1]);
  });

  it("updates and rolls back one publication without touching another item", () => {
    const moved = updateCachedEditorialPublicationDate(
      result,
      "publication-1",
      "2026-08-03T12:00:00.000Z",
    ) as typeof result;
    const rolledBack = updateCachedEditorialPublicationDate(
      moved,
      "publication-1",
      "2026-07-29T12:00:00.000Z",
    ) as typeof result;

    expect(moved.posts[0].publications[0].publication.scheduled_at).toBe(
      "2026-08-03T12:00:00.000Z",
    );
    expect(rolledBack.posts[0].publications[0].publication.scheduled_at).toBe(
      "2026-07-29T12:00:00.000Z",
    );
    expect(rolledBack.posts[1]).toBe(moved.posts[1]);
  });

  it("updates only the target task and ignores non-array caches", () => {
    const tasks = [
      { id: "task-1", status: "todo" },
      { id: "task-2", status: "doing" },
    ];

    expect(updateCachedTaskStatus(tasks, "task-1", "review")).toEqual([
      { id: "task-1", status: "review" },
      { id: "task-2", status: "doing" },
    ]);
    expect(updateCachedTaskStatus(null, "task-1", "review")).toBeNull();
  });
});
