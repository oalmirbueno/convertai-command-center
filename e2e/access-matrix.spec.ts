import type { Page, Response } from "@playwright/test";
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

interface ReadResult { status: number; ids: string[]; validRows: boolean }

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
      reads[table].push({
        status: response.status(),
        validRows,
        ids: validRows ? (rows as { id: string }[]).map((row) => row.id).sort() : [],
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
    if (allowed.length > 0) {
      await expect.poll(() => observation.reads.projects.length).toBeGreaterThan(0);
    }
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
      await page.getByRole("tab", { name: "Entregas", exact: true }).click();
      await expect(page.getByRole("tab", { name: "Entregas", exact: true })).toHaveAttribute("aria-selected", "true");
      await page.getByRole("tab", { name: "Visão geral", exact: true }).click();
      await page.getByRole("button", { name: "Voltar aos projetos", exact: true }).click();
      await expect(list.getByText(fixture.projects[role].name, { exact: true })).toBeVisible();
    }

    await page.goto("/kanban");
    if (role === "clientA" || role === "clientB") {
      await expect(page).toHaveURL(CI_E2E_APP_ORIGIN + "/dashboard");
      await expect(page.getByRole("heading", { name: "Kanban", exact: true })).toHaveCount(0);
      await page.goto("/clientes");
      await expect(page).toHaveURL(CI_E2E_APP_ORIGIN + "/dashboard");
    } else {
      await expect(page).toHaveURL(CI_E2E_APP_ORIGIN + "/kanban");
      await expect(page.getByRole("heading", { name: "Kanban", exact: true })).toBeVisible();
      for (const key of ["clientA", "clientB"] as const) {
        const task = page.getByRole("button", { name: "Abrir tarefa " + fixture.tasks[key].title, exact: true });
        if ((allowed as readonly string[]).includes(key)) await expect(task).toBeVisible();
        else await expect(task).toHaveCount(0);
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
        expect(result.status, table + " REST query must succeed").toBe(200);
        expect(result.validRows, table + " REST query must return rows").toBe(true);
        // Some detail/dashboard queries legitimately narrow the same scope.
        expect(result.ids.filter((id) => !allowedIds.includes(id)),
          table + " response must not expose cross-client rows").toEqual([]);
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
