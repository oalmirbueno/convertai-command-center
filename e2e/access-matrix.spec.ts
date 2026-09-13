import type { Page, Response } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CI_E2E_API_ORIGIN, CI_E2E_APP_ORIGIN } from "../config/ci-e2e-environment";
import { readCiFixture, USER_ROLES, type UserRole } from "./support/ci-fixture";
import { test, expect, isLocalEndpoint } from "./support/network";

async function login(page: Page, role: UserRole) {
  const user = readCiFixture().users[role];
  await page.goto("/login?next=%2Fprojetos");
  await expect(page.getByRole("heading", { name: "Bem-vindo de volta" })).toBeVisible();
  await page.getByPlaceholder("seu@email.com").fill(user.email);
  await page.locator('input[autocomplete="current-password"]').fill(user.password);
  const authentication = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.origin === CI_E2E_API_ORIGIN && url.pathname === "/auth/v1/token"
      && url.searchParams.get("grant_type") === "password";
  });
  await page.locator('form button[type="submit"]').click();
  // Do not read or attach the response: it contains disposable session tokens.
  expect((await authentication).status(), "Real password login must succeed").toBe(200);
  await expect(page).toHaveURL(CI_E2E_APP_ORIGIN + "/projetos");
  await expect(page.locator(".heading-page", { hasText: /^Projetos$/ })).toBeVisible();
}

async function logout(page: Page) {
  await page.locator('[data-tour="nav-user"] > button').click();
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/projetos");
  await expect(page).toHaveURL(/\/login$/);
}

interface ReadResult {
  status: number;
  ids: string[];
  validRows: boolean;
  queryKeys: string[];
  errorCode: string | null;
  errorMessage: string | null;
  taskCards?: { id: string; title: string; status: string }[];
}

function assertScopedRead(table: "projects" | "tasks", result: ReadResult, allowedIds: string[]) {
  // Only the synthetic projects/tasks PostgREST errors reach this diagnostic.
  // No auth response, headers, request body or session is collected.
  const diagnostic = table + " REST: HTTP " + result.status
    + (result.errorCode ? " [" + result.errorCode + "]" : "")
    + (result.errorMessage ? " " + result.errorMessage : "");
  expect(result.status, diagnostic).toBe(200);
  expect(result.validRows, diagnostic + "; expected an array of rows").toBe(true);
  expect(result.ids.filter((id) => !allowedIds.includes(id)),
    table + " response must not expose cross-client rows").toEqual([]);
}

function observeWorkReads(page: Page) {
  const reads: Record<"projects" | "tasks", ReadResult[]> = { projects: [], tasks: [] };
  const pending = new Set<Promise<void>>();
  const handler = (response: Response) => {
    const url = new URL(response.url());
    const table = url.pathname === "/rest/v1/projects" ? "projects"
      : url.pathname === "/rest/v1/tasks" ? "tasks" : null;
    if (url.origin !== CI_E2E_API_ORIGIN || !table
      || response.request().method() !== "GET"
      || !url.searchParams.get("select")?.startsWith("*")) return;
    const done = (async () => {
      let rows: unknown;
      try { rows = await response.json(); } catch { rows = null; }
      const validRows = Array.isArray(rows)
        && rows.every((row) => row && typeof row.id === "string");
      const error = !validRows && rows && typeof rows === "object"
        ? rows as { code?: unknown; message?: unknown } : null;
      reads[table].push({
        status: response.status(),
        validRows,
        queryKeys: [...url.searchParams.keys()].sort(),
        ids: validRows ? (rows as { id: string }[]).map((row) => row.id).sort() : [],
        errorCode: typeof error?.code === "string" ? error.code.slice(0, 24) : null,
        errorMessage: typeof error?.message === "string"
          ? error.message.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 300)
          : null,
        taskCards: table === "tasks" && validRows
          ? (rows as { id: string; title: string; status: string }[])
            .map((row) => ({ id: row.id, title: row.title, status: row.status }))
            .sort((left, right) => left.id.localeCompare(right.id))
          : undefined,
      });
    })();
    pending.add(done);
    void done.finally(() => pending.delete(done));
  };
  page.on("response", handler);
  return {
    reads,
    async finish() {
      page.off("response", handler);
      await Promise.all(pending);
    },
  };
}

async function readProjectsWithoutScopeFilter(page: Page) {
  const requestPromise = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return request.method() === "GET" && url.origin === CI_E2E_API_ORIGIN
      && url.pathname === "/rest/v1/projects"
      && url.searchParams.get("select") === "id,client_id";
  });
  const result = await page.evaluate(async () => {
    // Reuse the real application's Vite module and its normal authenticated
    // client. Neither the test nor Node reads storage, getSession, headers or
    // the Auth response. The JWT stays inside the normal browser SDK flow.
    const modulePath = "/src/integrations/supabase/client.ts";
    const { supabase } = await import(modulePath) as { supabase: SupabaseClient };
    const { data, error, status } = await supabase
      .from("projects")
      .select("id,client_id")
      .is("deleted_at", null);
    return {
      status,
      errorCode: error?.code ?? null,
      rows: data?.map((row) => ({ id: row.id as string, client_id: row.client_id as string })) ?? null,
    };
  });
  const url = new URL((await requestPromise).url());
  // Assert the real browser request cannot quietly turn into a scoped UI
  // query. The only predicate permitted here excludes deleted projects.
  expect([...url.searchParams.keys()].sort()).toEqual(["deleted_at", "select"]);
  expect(url.searchParams.get("deleted_at")).toBe("is.null");
  expect(result.status, "Unfiltered project read must succeed through RLS").toBe(200);
  expect(result.errorCode).toBeNull();
  return result.rows?.sort((left, right) => left.id.localeCompare(right.id));
}

async function kanbanCardDiagnostic(page: Page, titles: string[]) {
  // Counts and known synthetic labels only: never dump the page, auth UI,
  // arbitrary text, user menus or the full accessibility tree.
  return page.evaluate((knownTitles) => {
    const boards = Array.from(document.querySelectorAll('[data-tour="kanban-board"]'));
    const roleButtons = Array.from(document.querySelectorAll('[role="button"][aria-label]'));
    return {
      boardCount: boards.length,
      boardRoleButtonCount: boards.reduce((count, board) => count + board.querySelectorAll('[role="button"]').length, 0),
      backlogLabelCount: Array.from(document.querySelectorAll("span,button"))
        .filter((node) => node.textContent?.trim() === "Backlog").length,
      seededCards: knownTitles.map((title) => {
        const label = "Abrir tarefa " + title;
        const cards = roleButtons.filter((node) => node.getAttribute("aria-label") === label);
        return {
          label,
          count: cards.length,
          nodes: cards.map((node) => ({
            hasBounds: node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0,
            ariaHidden: node.closest('[aria-hidden="true"]') !== null,
            inert: node.closest("[inert]") !== null,
          })),
        };
      }),
    };
  }, titles);
}

for (const role of USER_ROLES) {
  test(`${role}: real login, scoped work, permitted controls and logout`, async ({ page }) => {
    const fixture = readCiFixture();
    const allowed = role === "admin" ? ["clientA", "clientB"] as const
      : role === "unassignedStaff" ? [] : [role === "clientB" ? "clientB" : "clientA"] as const;
    const observation = observeWorkReads(page);
    await login(page, role);

    // useTasks asks for the full table, without a client filter. Inspecting
    // this actual browser response catches a leak hidden by frontend filters.
    await expect.poll(() => observation.reads.tasks.length).toBeGreaterThan(0);
    const expectedTaskCards = allowed.map((key) => ({
      id: fixture.tasks[key].id, title: fixture.tasks[key].title, status: "backlog",
    })).sort((left, right) => left.id.localeCompare(right.id));
    for (const read of observation.reads.tasks) {
      assertScopedRead("tasks", read, expectedTaskCards.map((task) => task.id));
      expect(read.taskCards, "Real task reads must return the seeded cards before testing Kanban").toEqual(expectedTaskCards);
    }
    if (allowed.length > 0) {
      await expect.poll(() => observation.reads.projects.length).toBeGreaterThan(0);
    }
    for (const read of observation.reads.projects) {
      assertScopedRead("projects", read, allowed.map((key) => fixture.projects[key].id));
    }
    if (role === "clientA" || role === "clientB") {
      // The client UI itself already reads projects without id/client_id (or
      // another scope predicate); these REST responses also attest client RLS.
      expect(observation.reads.projects.some((read) =>
        JSON.stringify(read.queryKeys) === JSON.stringify(["deleted_at", "order", "select"])),
      "Client UI must make an unfiltered project read, not hide cross-client rows with a request filter").toBe(true);
    }
    const expectedProjects = allowed.map((key) => ({
      id: fixture.projects[key].id,
      client_id: fixture.projects[key].clientId,
    })).sort((left, right) => left.id.localeCompare(right.id));
    expect(await readProjectsWithoutScopeFilter(page),
      "Backend must restrict unfiltered projects for every logged-in role").toEqual(expectedProjects);

    const list = page.locator('[data-tour="projects-list"]');
    for (const key of ["clientA", "clientB"] as const) {
      const project = list.getByText(fixture.projects[key].name, { exact: true });
      if ((allowed as readonly string[]).includes(key)) await expect(project).toBeVisible();
      else await expect(project).toHaveCount(0);
    }
    if (allowed.length === 0) {
      await expect(page.getByText("Nenhum projeto encontrado.", { exact: true })).toBeVisible();
    }

    // A real filter and reset change the displayed results without creating
    // a project, task, attachment, approval, queue item or publication.
    await page.getByRole("button", { name: "Planejamento", exact: true }).click();
    await expect(page.getByText("Nenhum projeto encontrado.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Todos", exact: true }).click();
    for (const key of allowed) {
      await expect(list.getByText(fixture.projects[key].name, { exact: true })).toBeVisible();
    }

    const create = page.getByRole("button", { name: "Novo Projeto", exact: true });
    if (role === "admin") {
      await create.click();
      await expect(page.getByRole("heading", { name: "Novo Projeto", exact: true })).toBeVisible();
      await page.getByPlaceholder("Ex: Social Media 2026").fill("CI draft cancelled before save");
      await page.getByRole("button", { name: "Cancelar", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Novo Projeto", exact: true })).toHaveCount(0);
      await expect(list.getByText("CI draft cancelled before save", { exact: true })).toHaveCount(0);
    } else {
      await expect(create).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Gerar via Ata", exact: true })).toHaveCount(0);
    }

    if (role === "clientA" || role === "clientB") {
      await list.getByText(fixture.projects[role].name, { exact: true }).click();
      await expect(page.getByRole("heading", { name: fixture.projects[role].name, exact: true })).toBeVisible();
      const backToProjects = page.getByRole("button", { name: "Voltar aos projetos", exact: true });
      // The navbar's transparent logo padding used to cover this first action.
      // Check the real browser hit target without changing scroll or forcing a
      // click; only this boolean leaves the page, never a DOM or session dump.
      await expect.poll(() => backToProjects.evaluate((button) => {
        const bounds = button.getBoundingClientRect();
        const target = document.elementFromPoint(
          bounds.left + bounds.width / 2,
          bounds.top + bounds.height / 2,
        );
        return target !== null && button.contains(target);
      }), { message: "The project back button must receive pointer input below the navbar" }).toBe(true);
      await page.getByRole("tab", { name: "Entregas", exact: true }).click();
      await expect(page.getByRole("tab", { name: "Entregas", exact: true })).toHaveAttribute("aria-selected", "true");
      await page.getByRole("tab", { name: "Visão geral", exact: true }).click();
      await backToProjects.click();
      await expect(list.getByText(fixture.projects[role].name, { exact: true })).toBeVisible();
    }

    const readsBeforeKanban = observation.reads.tasks.length;
    await page.goto("/kanban");
    if (role === "clientA" || role === "clientB") {
      await expect(page).toHaveURL(CI_E2E_APP_ORIGIN + "/dashboard");
      await expect(page.getByRole("heading", { name: "Kanban", exact: true })).toHaveCount(0);
      await page.goto("/clientes");
      await expect(page).toHaveURL(CI_E2E_APP_ORIGIN + "/dashboard");
    } else {
      await expect(page).toHaveURL(CI_E2E_APP_ORIGIN + "/kanban");
      await expect(page.getByRole("heading", { name: "Kanban", exact: true })).toBeVisible();
      // goto reloads the application. Do not mistake the previous Projects
      // response for proof that Kanban's new authenticated query succeeded.
      await expect.poll(() => observation.reads.tasks.length,
        { message: "Kanban reload must complete a fresh tasks REST response" })
        .toBeGreaterThan(readsBeforeKanban);
      for (const read of observation.reads.tasks.slice(readsBeforeKanban)) {
        assertScopedRead("tasks", read, expectedTaskCards.map((task) => task.id));
        expect(read.taskCards, "Fresh Kanban read must preserve the seeded cards").toEqual(expectedTaskCards);
      }
      for (const key of ["clientA", "clientB"] as const) {
        const task = page.getByRole("button", { name: "Abrir tarefa " + fixture.tasks[key].title, exact: true });
        try {
          if ((allowed as readonly string[]).includes(key)) await expect(task).toBeVisible();
          else await expect(task).toHaveCount(0);
        } catch (cause) {
          const diagnostic = await kanbanCardDiagnostic(page,
            [fixture.tasks.clientA.title, fixture.tasks.clientB.title]);
          throw new Error("Kanban REST passed; scoped DOM diagnostic: " + JSON.stringify(diagnostic), { cause });
        }
      }
      if (role === "unassignedStaff") {
        await expect(page.getByText("Nenhuma tarefa encontrada.", { exact: true })).toBeVisible();
      }
      if (role !== "admin") {
        await page.goto("/comercial");
        await expect(page).toHaveURL(CI_E2E_APP_ORIGIN + "/dashboard");
      }
    }

    await observation.finish();
    for (const table of ["projects", "tasks"] as const) {
      const allowedIds = allowed.map((key) => fixture[table][key].id).sort();
      for (const result of observation.reads[table]) {
        // Some detail/dashboard queries legitimately narrow the same scope.
        assertScopedRead(table, result, allowedIds);
      }
      if (allowed.length > 0) {
        expect(observation.reads[table].some((result) => JSON.stringify(result.ids) === JSON.stringify(allowedIds)),
          table + " must actually return the allowed work").toBe(true);
      }
    }
    await logout(page);
  });
}

test("visitor cannot open protected work routes", async ({ page }) => {
  for (const path of ["/projetos", "/kanban", "/clientes"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Bem-vindo de volta" })).toBeVisible();
    await expect(page.locator('[data-tour="projects-list"]')).toHaveCount(0);
  }
});

test("wrong password is rejected by real local Auth", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("seu@email.com").fill(readCiFixture().users.clientA.email);
  await page.locator('input[autocomplete="current-password"]').fill("CI-deliberately-wrong-password");
  const denied = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.origin === CI_E2E_API_ORIGIN && url.pathname === "/auth/v1/token";
  });
  await page.locator('form button[type="submit"]').click();
  expect((await denied).status()).toBe(400);
  await expect(page.getByText("Email ou senha incorretos", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/projetos");
  await expect(page).toHaveURL(/\/login$/);
});

test("HTTP and WebSocket egress fail closed, including wrong loopback ports", async ({ page, egress }) => {
  // Reserved .invalid hostnames never identify a production service. URL-only
  // assertions additionally protect against broad '*.supabase.co' allowances.
  for (const remote of ["https://remote.supabase.co", "http://127.0.0.1:54322",
    "http://127.0.0.1:4173.e2e.invalid", "http://127.0.0.1:4173@e2e.invalid"]) {
    expect(isLocalEndpoint(remote, "http")).toBe(false);
  }
  expect(isLocalEndpoint("wss://remote.supabase.co/realtime/v1", "ws")).toBe(false);
  expect(isLocalEndpoint("ws://127.0.0.1:54322", "ws")).toBe(false);
  await page.goto("/login");
  for (const url of ["https://egress.e2e.invalid/probe", "http://127.0.0.1:49001/probe"]) {
    egress.expectBlocked(url);
    const failed = page.waitForEvent("requestfailed", (request) => request.url() === url);
    const outcome = await page.evaluate(async (target) => {
      try { await fetch(target); return "unexpected-success"; } catch { return "blocked"; }
    }, url);
    expect(outcome).toBe("blocked");
    expect((await failed).failure()?.errorText).toContain("ERR_BLOCKED_BY_CLIENT");
    expect(egress.blocked).toContain(url);
  }
  for (const url of ["wss://egress.e2e.invalid/socket", "ws://127.0.0.1:49001/socket"]) {
    egress.expectBlocked(url);
    const code = await page.evaluate((target) => new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Socket was not closed by the guard")), 5_000);
      const socket = new WebSocket(target);
      socket.onclose = (event) => { clearTimeout(timer); resolve(event.code); };
    }), url);
    expect(code).toBe(1008);
    expect(egress.blocked).toContain(url);
  }
});
