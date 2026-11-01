import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Lista de Projetos. `deadline` é DATE: `new Date("2026-11-10")` é meia-noite UTC, ou seja 09/11 às 21h em
 * São Paulo, e o prazo aparecia um dia antes. O navegador está em UTC-3; o teste roda no mesmo fuso.
 */

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { id: "c1", role: "client" }, user: { id: "c1" } }) }));
vi.mock("@/hooks/useSupabaseData", () => ({
  useProjects: () => ({
    data: [{ id: "p1", client_id: "c1", name: "Site novo", status: "active", project_type: "site", progress: 30, deadline: "2026-11-10" }],
    isLoading: false,
  }),
  useTasks: () => ({ data: [] }),
}));
vi.mock("@/components/admin/CreateProjectModal", () => ({ default: () => null }));
vi.mock("@/components/admin/ProjectDrawer", () => ({ default: () => null }));
vi.mock("@/components/admin/MeetingToProjectModal", () => ({ default: () => null }));
vi.mock("@/components/client/ProjectView", () => ({ default: () => null }));

import Projects from "@/pages/Projects";

const fusoOriginal = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/Sao_Paulo";
});
afterAll(() => {
  process.env.TZ = fusoOriginal;
});
afterEach(cleanup);

describe("prazo do projeto no dia certo", () => {
  it("mostra 10/11/2026 para o prazo 2026-11-10 (não a véspera)", () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <Projects />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText("10/11/2026")).toBeTruthy();
    expect(screen.queryByText(/09\/11|9 de nov/)).toBeNull();
  });
});
