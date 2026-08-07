import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const page = read("src/pages/EditorialCalendar.tsx");
const toolbar = read("src/components/editorial/EditorialToolbar.tsx");
const scheduler = read(
  "src/components/editorial/EditorialScheduleDialog.tsx",
);
const schedulerPayload = read("src/lib/editorialScheduler.ts");
const picker = read("src/components/editorial/ApprovedMediaPicker.tsx");
const preview = read(
  "src/components/editorial/EditorialAssetPreviewDialog.tsx",
);
const detail = read("src/components/editorial/EditorialDetailSheet.tsx");
const views = read("src/components/editorial/EditorialCalendarViews.tsx");
const hook = read("src/hooks/useEditorialCalendar.ts");
const clients = read("src/pages/Clients.tsx");
const connections = read(
  "src/components/admin/ClientConnectionsPanel.tsx",
);
const editor = read("src/components/editorial/EditorialEditor.tsx");
const carousel = read("src/components/shared/CarouselSlider.tsx");

describe("editorial scheduling UX contract", () => {
  it("keeps agenda and content production as separate operational areas", () => {
    expect(toolbar).toContain("Área editorial");
    expect(toolbar).toContain("Agenda");
    expect(toolbar).toContain("Conteúdos");
    expect(toolbar).toContain("Agendar publicação");
    expect(toolbar).toContain("Criar conteúdo");
    expect(toolbar).toContain("Todos os formatos");
    expect(page).toContain("isPublishableTask(task)");
    expect(page).toMatch(
      /view === "board"\s*\? productionTasks\s*:\s*editorialDeadlineTasks/,
    );
  });

  it("schedules an approved asset atomically and preserves the complete plan", () => {
    expect(scheduler).toContain("loadEditorialPostForMutation");
    expect(scheduler).toContain("buildEditorialSchedulePayload");
    expect(scheduler).toContain("expectedVersion:");
    expect(scheduler).toContain("existing.publication.first_comment");
    expect(scheduler).toContain("existing.publication.alt_text");
    expect(schedulerPayload).toContain("asset_file_ids:");
    expect(schedulerPayload).toContain("targetAsset.files.map");
    expect(scheduler).not.toMatch(
      /\.from\(\s*["']editorial_[^"']+["']\s*\)\s*\.(?:insert|update|delete)/,
    );
    expect(scheduler.indexOf("if (attempt.prepared)")).toBeLessThan(
      scheduler.indexOf("completePost = await loadEditorialPostForMutation"),
    );
    expect(scheduler).toContain("activeEditorialSchedulePlans");
    expect(scheduler).toContain("selectedExistingPlan.postVersion");
    expect(scheduler).toContain("editorialSchedulePlanMatchesSnapshot");
    expect(scheduler).toContain("const stalePlan =");
    expect(scheduler).toContain("setSelectedExistingPlan(null)");
  });

  it("clears an incompatible format filter after scheduling", () => {
    expect(page).toMatch(
      /onScheduled=\{\([\s\S]*?\[\s*"q",\s*"format",\s*"platform"/,
    );
  });

  it("finds, filters and previews the complete carousel before selection", () => {
    expect(picker).toContain("filterApprovedMediaAssets");
    expect(picker).toContain("Carrosséis");
    expect(picker).toContain("Ver completo");
    expect(picker).toContain("EditorialAssetPreviewDialog");
    expect(preview).toContain("initialChildren={children.map");
    expect(preview).toContain("Conteúdo completo, na mesma ordem");
    expect(carousel).toContain("initialChildren !== undefined");
    expect(carousel).toContain("orderEditorialCarouselFiles");
    expect(carousel).toContain("onTouchStart");
    expect(carousel).toContain("onTouchEnd");
    expect(carousel).toContain("h-11 w-11");
  });

  it("shows media on cards and a clear approved to published tracker", () => {
    expect(views).toContain("EditorialFileThumbnail");
    expect(views).toContain("primaryFileChildren");
    expect(views).toContain("hasPublicationOverride");
    expect(views).toContain("publication?.fileChildren");
    expect(views).toContain("Mover ${item.post.post.title}");
    expect(views).toContain("grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4");
    expect(views).not.toContain('label: "Agenda e publicados"');
    expect(detail).toContain("PublicationProgress");
    expect(detail).toContain("Agendado no painel");
    expect(detail).toContain("CarouselSlider");
    expect(hook).toContain('.in("parent_file_id", chunk)');
    expect(hook).toContain('fileChildrenMode === "scheduled"');
  });

  it("keeps official publishing accounts inside the selected client and project", () => {
    expect(scheduler).toContain("<EditorialAccountSetup");
    expect(scheduler).toContain("onAccountReady={handleAccountReady}");
    expect(scheduler).toContain("showManualOptions={false}");
    expect(scheduler).toContain("compact");
    expect(scheduler).toContain("options?.canManageAccounts === true");
    expect(scheduler).not.toContain("/clientes?client=");
    expect(clients).toContain('searchParams.get("section") === "accounts"');
    expect(clients).toContain('searchParams.get("project")');
    expect(connections).toContain("Contas para publicação");
    expect(connections).toContain("EditorialAccountSetup");
    expect(connections).toContain("publishingProjectId");
    expect(connections).toContain("showManualOptions={false}");
    expect(connections).not.toContain("useEditorialEditorOptions");
    expect(scheduler).toContain("reconexão necessária");
    expect(scheduler).toContain("missingSelectedAccountIds");
    expect(scheduler).toContain("refetchOptions");
    expect(scheduler).toContain("Conecte ou vincule a conta aqui mesmo para continuar.");
    expect(scheduler).toContain("Revise ou reconecte o vínculo abaixo para continuar.");
    expect(scheduler).not.toContain("Abra as contas do cliente e revise o vínculo.");
    expect(hook).toContain('"can_manage_client"');
  });

  it("replaces the native browser alert with an accessible in-app discard dialog", () => {
    expect(scheduler).not.toContain("window.confirm");
    expect(scheduler).toContain("<AlertDialog");
    expect(scheduler).toContain("Continuar editando");
    expect(scheduler).toContain("Descartar e fechar");
  });

  it("keeps new content creation free from account and scheduling setup", () => {
    expect(editor).not.toContain("<EditorialAccountSetup");
    expect(editor).toContain("showExistingPublicationPlan");
    expect(editor).toContain("Plano de publicação existente");
    expect(editor).toContain("setPublications([])");
  });
});
