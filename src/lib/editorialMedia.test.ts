import { describe, expect, it } from "vitest";
import {
  buildApprovedMediaAssets,
  editorialMediaOrderIndex,
  filterApprovedMediaAssets,
  inferEditorialMediaContentType,
  orderEditorialCarouselFiles,
  type EditorialMediaFile,
} from "@/lib/editorialMedia";

function file(
  id: string,
  patch: Partial<EditorialMediaFile> = {},
): EditorialMediaFile {
  return {
    id,
    client_id: "client-1",
    project_id: "project-1",
    file_name: `${id}.png`,
    file_url: `files://client-1/${id}.png`,
    mime_type: "image/png",
    created_at: "2026-07-29T12:00:00.000Z",
    parent_file_id: null,
    agency_approval_status: "approved",
    approval_status: "approved",
    visibility: "approval",
    locked_at: "2026-07-29T13:00:00.000Z",
    status: "ready",
    archived_at: null,
    ...patch,
  };
}

describe("approved editorial media", () => {
  it("groups a publishable root with its children without requiring child approval", () => {
    const root = file("root", {
      file_name: "Campanha.png",
      storage_bucket: "files",
      storage_path: "client/root/v1/1-campanha.png",
    });
    const second = file("second", {
      file_name: "Campanha (2/3).png",
      parent_file_id: root.id,
      approval_status: "none",
      storage_path: "client/root/v1/2-campanha.png",
    });
    const third = file("third", {
      file_name: "Campanha (3/3).png",
      parent_file_id: root.id,
      approval_status: "none",
      storage_path: "client/root/v1/3-campanha.png",
    });

    const assets = buildApprovedMediaAssets([third, root, second]);

    expect(assets).toHaveLength(1);
    expect(assets[0].contentType).toBe("carousel");
    expect(assets[0].files.map((item) => item.id)).toEqual([
      "root",
      "second",
      "third",
    ]);
    expect(assets[0].root).toBe(root);
    expect(assets[0].files[1]).toBe(second);
  });

  it("requires the complete root double-gate", () => {
    const candidates = [
      file("agency-pending", { agency_approval_status: "pending" }),
      file("client-pending", { approval_status: "pending" }),
      file("internal", { visibility: "internal" }),
      file("unlocked", { locked_at: null }),
      file("archived", {
        archived_at: "2026-07-29T14:00:00.000Z",
      }),
      file("valid"),
    ];

    expect(
      buildApprovedMediaAssets(candidates).map((asset) => asset.id),
    ).toEqual(["valid"]);
  });

  it("hides roots used by another post and keeps the current post exception", () => {
    const first = file("first");
    const second = file("second");

    expect(
      buildApprovedMediaAssets([first, second], {
        usedRootFileIds: ["first", "second"],
        currentRootFileId: "second",
      }).map((asset) => asset.id),
    ).toEqual(["second"]);
  });

  it("excludes PDFs, documents, audio and unsupported roots", () => {
    const candidates = [
      file("pdf", {
        file_name: "planejamento.pdf",
        file_url: "files://planejamento.pdf",
        mime_type: "application/pdf",
      }),
      file("document", {
        file_name: "roteiro.docx",
        file_url: "files://roteiro.docx",
        mime_type:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
      file("audio", {
        file_name: "trilha.mp3",
        file_url: "files://trilha.mp3",
        mime_type: "audio/mpeg",
      }),
      file("image"),
      file("video", {
        file_name: "reel.mp4",
        file_url: "files://reel.mp4",
        mime_type: "video/mp4",
      }),
    ];

    expect(
      buildApprovedMediaAssets(candidates)
        .map((asset) => asset.contentType)
        .sort(),
    ).toEqual(["static", "video"]);
  });

  it("infers static, carousel and video from the real files", () => {
    const image = file("image");
    const child = file("child", { parent_file_id: image.id });
    const video = file("video", {
      file_name: "video.mp4",
      file_url: "files://video.mp4",
      mime_type: "video/mp4",
    });

    expect(inferEditorialMediaContentType(image, [])).toBe("static");
    expect(inferEditorialMediaContentType(image, [child])).toBe("carousel");
    expect(inferEditorialMediaContentType(video, [])).toBe("video");
  });

  it("orders by storage index, then name index, then creation and id", () => {
    const root = file("root");
    const byStorage = file("storage", {
      parent_file_id: root.id,
      storage_path: "client/root/v1/2-card.png",
      file_name: "Sem índice.png",
    });
    const byName = file("name", {
      parent_file_id: root.id,
      storage_path: "legacy/card.png",
      file_name: "Campanha (3/6).png",
    });
    const early = file("a-early", {
      parent_file_id: root.id,
      storage_path: "legacy/card-a.png",
      file_name: "Sem índice A.png",
      created_at: "2026-07-29T10:00:00.000Z",
    });
    const late = file("b-late", {
      parent_file_id: root.id,
      storage_path: "legacy/card-b.png",
      file_name: "Sem índice B.png",
      created_at: "2026-07-29T11:00:00.000Z",
    });

    expect(editorialMediaOrderIndex(byStorage)).toBe(2);
    expect(editorialMediaOrderIndex(byName)).toBe(3);
    expect(
      orderEditorialCarouselFiles(root, [late, byName, early, byStorage]).map(
        (item) => item.id,
      ),
    ).toEqual(["root", "storage", "name", "a-early", "b-late"]);
  });

  it("preserves original URL and storage references", () => {
    const root = file("root", {
      file_url: "files://client/root/original.png",
      storage_bucket: "files",
      storage_path: "client/root/original.png",
    });

    const [asset] = buildApprovedMediaAssets([root]);

    expect(asset.root).toBe(root);
    expect(asset.root.file_url).toBe("files://client/root/original.png");
    expect(asset.root.storage_bucket).toBe("files");
    expect(asset.root.storage_path).toBe("client/root/original.png");
  });

  it("searches names and approved public metadata accent-insensitively", () => {
    const campaign = file("campaign", {
      file_name: "Campanha de verão.png",
      caption: "Lavanderia no Bacacheri",
      description: "Economize tempo",
    });
    const institutional = file("institutional", {
      file_name: "Institucional.png",
    });
    const assets = buildApprovedMediaAssets([campaign, institutional]);

    expect(
      filterApprovedMediaAssets(assets, "verao").map((asset) => asset.id),
    ).toEqual(["campaign"]);
    expect(
      filterApprovedMediaAssets(assets, "bacacheri").map((asset) => asset.id),
    ).toEqual(["campaign"]);
  });
});
