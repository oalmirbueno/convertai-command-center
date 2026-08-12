import { describe, expect, it } from "vitest";
import {
  EDITORIAL_PLATFORM_CONFIG,
  EDITORIAL_PLATFORMS,
  EDITORIAL_VISUAL_STAGE_LABELS,
  editorialVisualStage,
  EDITORIAL_PRODUCTION_STATUS_CONFIG,
  EDITORIAL_PUBLICATION_STATUSES,
  EDITORIAL_STATUS_CONFIG,
  PLATFORM_LABELS,
  PRODUCTION_STATUS_LABELS,
  PUBLICATION_STATUS_LABELS,
  SUPPORTED_EDITORIAL_PLATFORMS,
  aggregateEditorialStatus,
  aggregateEditorialPostStatus,
  canEditEditorial,
  canPublishEditorial,
  editorialPermissions,
  filterEditorialPosts,
  getEditorialApprovalStage,
  getEditorialPermissions,
  isEditorialFileEditable,
  isEditorialFilePublishable,
  isFileEditable,
  isEditorialPublicationStatus,
  isFilePublishable,
  isSupportedEditorialPlatform,
  matchesEditorialFilters,
  type EditorialApprovalFile,
  type EditorialFilterablePost,
  type EditorialPublicationStatus,
} from "@/lib/editorial";

const approvedFile: EditorialApprovalFile = {
  agency_approval_status: "approved",
  visibility: "approval",
  approval_status: "approved",
  locked_at: "2026-07-28T18:00:00.000Z",
  status: "ready",
};

const publication = (
  platform: string,
  status: EditorialPublicationStatus,
  caption?: string,
) => ({ platform, status, caption });

const posts: EditorialFilterablePost[] = [
  {
    title: "Lançamento de verão",
    objective: "Apresentar a nova coleção",
    default_caption: "Conheça as novidades",
    content_type: "carousel",
    client_name: "Cliente Árvore",
    project_name: "Campanha Julho",
    publications: [
      publication("instagram", "published", "Carrossel publicado"),
      publication("linkedin", "scheduled", "Versão corporativa"),
    ],
  },
  {
    title: "Bastidores da equipe",
    objective: "Gerar proximidade",
    content_type: "reel",
    client_name: "Cliente B",
    publications: [
      publication("tiktok", "failed", "Vídeo vertical"),
      publication("youtube", "scheduled", "YouTube Short"),
    ],
  },
  {
    title: "Ideia ainda em produção",
    production_status: "production",
    publications: [],
  },
];

describe("editorial platforms and visual metadata", () => {
  it("keeps the supported publication platforms explicit and ordered", () => {
    expect(SUPPORTED_EDITORIAL_PLATFORMS).toEqual([
      "instagram",
      "facebook",
      "tiktok",
      "linkedin",
      "youtube",
      "google_business",
    ]);
    expect(EDITORIAL_PLATFORMS).toBe(SUPPORTED_EDITORIAL_PLATFORMS);
  });

  it("accepts only supported editorial platforms", () => {
    expect(isSupportedEditorialPlatform("instagram")).toBe(true);
    expect(isSupportedEditorialPlatform("google_business")).toBe(true);
    expect(isSupportedEditorialPlatform("google_ads")).toBe(false);
    expect(isSupportedEditorialPlatform("")).toBe(false);
    expect(isSupportedEditorialPlatform(null)).toBe(false);
  });

  it("provides a non-empty label and color for every platform", () => {
    for (const platform of SUPPORTED_EDITORIAL_PLATFORMS) {
      expect(EDITORIAL_PLATFORM_CONFIG[platform].label).not.toBe("");
      expect(PLATFORM_LABELS[platform]).toBe(
        EDITORIAL_PLATFORM_CONFIG[platform].label,
      );
      expect(EDITORIAL_PLATFORM_CONFIG[platform].color).toMatch(
        /^#[0-9A-F]{6}$/i,
      );
    }
  });

  it("provides visual metadata for publication and aggregate statuses", () => {
    expect(EDITORIAL_PUBLICATION_STATUSES).toEqual([
      "planned",
      "scheduled",
      "published",
      "failed",
      "cancelled",
    ]);
    expect(EDITORIAL_STATUS_CONFIG.partially_published.label).toBe(
      "Publicado parcialmente",
    );
    expect(PUBLICATION_STATUS_LABELS.scheduled).toBe("Agendado");
    expect(PRODUCTION_STATUS_LABELS.production).toBe("Em produção");
    expect(EDITORIAL_PRODUCTION_STATUS_CONFIG.ready.color).toBe("#F59E0B");
    for (const config of Object.values(EDITORIAL_STATUS_CONFIG)) {
      expect(config.label).not.toBe("");
      expect(config.color).toMatch(/^#[0-9A-F]{6}$/i);
    }
    expect(isEditorialPublicationStatus("scheduled")).toBe(true);
    expect(isEditorialPublicationStatus("ready")).toBe(false);
  });
});

describe("editorial role permissions", () => {
  it.each(["admin", "manager"])(
    "allows %s to read, edit, and publish",
    (role) => {
      expect(getEditorialPermissions(role)).toEqual({
        canRead: true,
        canEdit: true,
        canPublish: true,
        readOnly: false,
      });
      expect(canEditEditorial(role)).toBe(true);
      expect(canPublishEditorial(role)).toBe(true);
      expect(editorialPermissions(role).canPublish).toBe(true);
    },
  );

  it.each(["design", "traffic"])(
    "allows %s to edit but never publish",
    (role) => {
      expect(getEditorialPermissions(role)).toEqual({
        canRead: true,
        canEdit: true,
        canPublish: false,
        readOnly: false,
      });
      expect(canEditEditorial(role)).toBe(true);
      expect(canPublishEditorial(role)).toBe(false);
    },
  );

  it("keeps the client read-only", () => {
    expect(getEditorialPermissions("client")).toEqual({
      canRead: true,
      canEdit: false,
      canPublish: false,
      readOnly: true,
    });
  });

  it("denies unknown and missing roles", () => {
    expect(getEditorialPermissions("unknown")).toEqual({
      canRead: false,
      canEdit: false,
      canPublish: false,
      readOnly: false,
    });
    expect(getEditorialPermissions(null).canRead).toBe(false);
    expect(getEditorialPermissions(undefined).canEdit).toBe(false);
  });
});

describe("editorial file approval gate", () => {
  it("accepts only an agency-approved, client-approved, locked, ready file", () => {
    expect(isEditorialFilePublishable(approvedFile)).toBe(true);
    expect(isFilePublishable(approvedFile)).toBe(true);
  });

  it.each([
    ["agency_approval_status", "pending"],
    ["visibility", "internal"],
    ["approval_status", "pending"],
    ["locked_at", null],
    ["status", "processing"],
  ] as const)("rejects a file with invalid %s", (field, value) => {
    expect(
      isEditorialFilePublishable({ ...approvedFile, [field]: value }),
    ).toBe(false);
  });

  it("rejects a missing file", () => {
    expect(isEditorialFilePublishable(null)).toBe(false);
    expect(isEditorialFilePublishable(undefined)).toBe(false);
  });

  it("allows copy editing only before the file enters review", () => {
    const editableFile: EditorialApprovalFile = {
      agency_approval_status: "not_requested",
      visibility: "internal",
      approval_status: "none",
      locked_at: null,
      status: "ready",
    };

    expect(isEditorialFileEditable(editableFile)).toBe(true);
    expect(isFileEditable(editableFile)).toBe(true);
    expect(
      isEditorialFileEditable({
        ...editableFile,
        agency_approval_status: "pending",
      }),
    ).toBe(false);
    expect(isEditorialFileEditable(approvedFile)).toBe(false);
    expect(isEditorialFileEditable(null)).toBe(false);
  });
});

describe("editorial approval stage aggregation", () => {
  it("requires every active platform-specific file to pass the gate", () => {
    expect(
      getEditorialApprovalStage({
        primaryFile: approvedFile,
        publications: [
          {
            publication: {
              status: "planned",
              file_id: "specific-file",
            },
            file: {
              ...approvedFile,
              agency_approval_status: "pending",
              approval_status: "none",
              locked_at: null,
            },
          },
        ],
      }),
    ).toBe("agency_review");

    expect(
      getEditorialApprovalStage({
        primaryFile: approvedFile,
        publications: [
          {
            publication: {
              status: "planned",
              file_id: "specific-file",
            },
            file: {
              ...approvedFile,
              approval_status: "rejected",
            },
          },
        ],
      }),
    ).toBe("changes");
  });

  it("ignores cancelled overrides and recognizes a complete double-gate", () => {
    expect(
      getEditorialApprovalStage({
        primaryFile: approvedFile,
        publications: [
          {
            publication: {
              status: "cancelled",
              file_id: "old-file",
            },
            file: {
              ...approvedFile,
              approval_status: "rejected",
            },
          },
          {
            publication: {
              status: "scheduled",
              file_id: null,
            },
            file: null,
          },
        ],
      }),
    ).toBe("approved");
  });

  it("never reports approval when a required file is unavailable", () => {
    expect(
      getEditorialApprovalStage({
        primaryFile: approvedFile,
        publications: [
          {
            publication: {
              status: "scheduled",
              file_id: "missing-file",
            },
            file: null,
          },
        ],
      }),
    ).toBe("not_requested");
    expect(
      getEditorialApprovalStage({
        primaryFile: null,
        publications: [],
      }),
    ).toBe("not_requested");
  });
});

describe("editorial post status aggregation", () => {
  it("returns draft when the post has no publications", () => {
    expect(aggregateEditorialPostStatus([])).toBe("draft");
    expect(aggregateEditorialPostStatus(null)).toBe("draft");
    expect(aggregateEditorialPostStatus([{ status: "legacy" }])).toBe("draft");
  });

  it.each([
    ["planned", "planned"],
    ["scheduled", "scheduled"],
    ["published", "published"],
    ["failed", "failed"],
    ["cancelled", "cancelled"],
  ] as const)("returns %s when every publication is %s", (expected, status) => {
    expect(
      aggregateEditorialPostStatus([
        { status },
        { status },
      ]),
    ).toBe(expected);
  });

  it("reports a partially published post when another platform is pending", () => {
    expect(
      aggregateEditorialPostStatus([
        { status: "published" },
        { status: "scheduled" },
      ]),
    ).toBe("partially_published");
    expect(
      aggregateEditorialStatus([
        { status: "published" },
        { status: "scheduled" },
      ]),
    ).toBe("partially_published");
    expect(
      aggregateEditorialPostStatus([
        { status: "published" },
        { status: "failed" },
      ]),
    ).toBe("partially_published");
  });

  it("prioritizes an actionable failure until any platform is published", () => {
    expect(
      aggregateEditorialPostStatus([
        { status: "failed" },
        { status: "scheduled" },
      ]),
    ).toBe("failed");
  });

  it("keeps active scheduled or planned work ahead of cancellations", () => {
    expect(
      aggregateEditorialPostStatus([
        { status: "scheduled" },
        { status: "cancelled" },
      ]),
    ).toBe("scheduled");
    expect(
      aggregateEditorialPostStatus([
        { status: "planned" },
        { status: "cancelled" },
      ]),
    ).toBe("planned");
  });
});

describe("editorial post filters", () => {
  it("matches text without case or accent sensitivity", () => {
    expect(matchesEditorialFilters(posts[0], { text: "arvore" })).toBe(true);
    expect(matchesEditorialFilters(posts[0], { text: "VERÃO" })).toBe(true);
    expect(matchesEditorialFilters(posts[0], { text: "inexistente" })).toBe(
      false,
    );
  });

  it("searches publication captions and platform labels", () => {
    expect(matchesEditorialFilters(posts[0], { text: "corporativa" })).toBe(
      true,
    );
    expect(matchesEditorialFilters(posts[1], { text: "youtube" })).toBe(true);
  });

  it("filters by a publication platform", () => {
    expect(matchesEditorialFilters(posts[0], { platform: "instagram" })).toBe(
      true,
    );
    expect(matchesEditorialFilters(posts[0], { platform: "tiktok" })).toBe(
      false,
    );
  });

  it("filters by the aggregate publication status", () => {
    expect(
      matchesEditorialFilters(posts[0], { status: "partially_published" }),
    ).toBe(true);
    expect(matchesEditorialFilters(posts[1], { status: "failed" })).toBe(true);
    expect(matchesEditorialFilters(posts[2], { status: "draft" })).toBe(true);
  });

  it("combines text, platform, and status filters", () => {
    expect(
      filterEditorialPosts(posts, {
        text: "bastidores",
        platform: "tiktok",
        status: "failed",
      }),
    ).toEqual([posts[1]]);
    expect(
      filterEditorialPosts(posts, {
        text: "bastidores",
        platform: "instagram",
        status: "failed",
      }),
    ).toEqual([]);
  });

  it("returns every post when filters are empty or set to all", () => {
    expect(filterEditorialPosts(posts)).toEqual(posts);
    expect(
      filterEditorialPosts(posts, { platform: "all", status: "all" }),
    ).toEqual(posts);
  });
});

describe("estágio visual único da agenda e do quadro", () => {
  it("distingue rascunho, produção e pronto quando a publicação ainda é planejada", () => {
    // Bug recorrente: o calendário coloria só por status de publicação, então
    // mover para "produção" não mudava nada na agenda.
    expect(editorialVisualStage("draft", "planned")).toBe("draft");
    expect(editorialVisualStage("production", "planned")).toBe("production");
    expect(editorialVisualStage("ready", "planned")).toBe("ready");
  });

  it("deixa a publicação vencer quando ela já saiu do planejamento", () => {
    expect(editorialVisualStage("production", "scheduled")).toBe("scheduled");
    expect(editorialVisualStage("ready", "published")).toBe("published");
    expect(editorialVisualStage("draft", "failed")).toBe("failed");
    expect(editorialVisualStage("ready", "cancelled")).toBe("cancelled");
  });

  it("cai em rascunho sem informação e respeita cancelamento de produção", () => {
    expect(editorialVisualStage(null, null)).toBe("draft");
    expect(editorialVisualStage("cancelled", "planned")).toBe("cancelled");
  });

  it("tem rótulo para todos os estágios", () => {
    const stages = ["draft", "production", "ready", "scheduled", "published", "failed", "cancelled"] as const;
    for (const stage of stages) {
      expect(EDITORIAL_VISUAL_STAGE_LABELS[stage]).toBeTruthy();
    }
  });
});
