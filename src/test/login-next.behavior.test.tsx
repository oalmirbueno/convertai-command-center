import { lazy, Suspense } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Login from "@/pages/Login";

const auth = vi.hoisted(() => ({
  user: null as { id: string } | null,
  profile: null as { id: string; role: string } | null,
  loading: false,
  loginWithCredentials: vi.fn().mockResolvedValue(undefined),
  signup: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: {} } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

function signedIn() {
  auth.user = { id: "synthetic-user" };
  auth.profile = { id: "synthetic-user", role: "admin" };
}

const currentPath = () => window.location.pathname + window.location.search + window.location.hash;

beforeEach(() => {
  auth.user = null;
  auth.profile = null;
  auth.loading = false;
  window.history.replaceState(null, "", "/login");
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("login return destination", () => {
  it("keeps next while the lazy destination suspends and Auth refreshes the profile", async () => {
    const destination = "/projetos?status=active#lista";
    window.history.replaceState(null, "", "/login?next=" + encodeURIComponent(destination));
    let resolveProjects!: (value: { default: () => JSX.Element }) => void;
    const Projects = lazy(() => new Promise<{ default: () => JSX.Element }>((resolve) => {
      resolveProjects = resolve;
    }));
    const app = () => (
      <BrowserRouter>
        <Suspense fallback={<p>Carregando destino</p>}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/projetos" element={<Projects />} />
            <Route path="/dashboard" element={<h1>Dashboard indevido</h1>} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    );
    const view = render(app());
    expect(screen.getByRole("heading", { name: "Bem-vindo de volta" })).toBeVisible();

    signedIn();
    view.rerender(app());
    await waitFor(() => expect(currentPath()).toBe(destination));
    // BrowserRouter has replaced window.history, but its transition retains
    // the login screen until the real lazy route can finish loading.
    expect(screen.getByText("Redirecionando...")).toBeVisible();

    // Auth may deliver another profile while that transition is pending.
    // This is a new context value, not a navigation or a mocked useNavigate.
    auth.profile = { id: "synthetic-user", role: "admin" };
    view.rerender(app());
    expect(currentPath()).toBe(destination);
    expect(screen.queryByRole("heading", { name: "Dashboard indevido" })).not.toBeInTheDocument();

    await act(async () => {
      resolveProjects({ default: () => <h1>Projetos carregados</h1> });
    });
    expect(await screen.findByRole("heading", { name: "Projetos carregados" })).toBeVisible();
    expect(currentPath()).toBe(destination);
  });

  it.each([
    null,
    "https://outside.invalid/steal",
    "//outside.invalid/steal",
    "/\\outside.invalid/steal",
    "/%5coutside.invalid/steal",
    "javascript:alert(1)",
  ])("uses the internal fallback for an absent or unsafe next: %s", async (next) => {
    const search = next === null ? "" : "?next=" + encodeURIComponent(next);
    window.history.replaceState(null, "", "/login" + search);
    signedIn();
    render(
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/dashboard" element={<h1>Painel seguro</h1>} />
        </Routes>
      </BrowserRouter>,
    );
    expect(await screen.findByRole("heading", { name: "Painel seguro" })).toBeVisible();
    expect(currentPath()).toBe("/dashboard");
  });
});
