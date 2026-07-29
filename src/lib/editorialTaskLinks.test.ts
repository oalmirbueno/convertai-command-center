import { describe, expect, it } from "vitest";
import {
  buildEditorialTaskLinkIndex,
  type EditorialTaskLinkRow,
} from "@/lib/editorialTaskLinks";

const links: EditorialTaskLinkRow[] = [
  {
    post_id: "post-root",
    task_id: "task-b",
    revision_of_post_id: null,
  },
  {
    post_id: "post-revision-1",
    task_id: "task-b",
    revision_of_post_id: "post-root",
  },
  {
    post_id: "post-revision-2",
    task_id: "task-b",
    revision_of_post_id: "post-revision-1",
  },
  {
    post_id: "post-other",
    task_id: "task-a",
    revision_of_post_id: null,
  },
  {
    post_id: "post-without-task",
    task_id: null,
    revision_of_post_id: null,
  },
];

describe("editorial task link index", () => {
  it("resolves the active terminal revision for each linked task", () => {
    expect(
      buildEditorialTaskLinkIndex(
        links,
        new Set([
          "post-root",
          "post-revision-1",
          "post-revision-2",
          "post-other",
          "post-without-task",
        ]),
      ),
    ).toEqual({
      taskIds: ["task-a", "task-b"],
      postIdByTaskId: {
        "task-a": "post-other",
        "task-b": "post-revision-2",
      },
    });
  });

  it("falls back to the latest active ancestor when a revision is inactive", () => {
    expect(
      buildEditorialTaskLinkIndex(
        links,
        new Set(["post-root", "post-revision-1", "post-other"]),
      ),
    ).toEqual({
      taskIds: ["task-a", "task-b"],
      postIdByTaskId: {
        "task-a": "post-other",
        "task-b": "post-revision-1",
      },
    });
  });

  it("ignores inactive posts and links without tasks", () => {
    expect(
      buildEditorialTaskLinkIndex(
        links,
        new Set(["post-without-task"]),
      ),
    ).toEqual({
      taskIds: [],
      postIdByTaskId: {},
    });
  });
});
