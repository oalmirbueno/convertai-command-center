import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projetosDoCliente } from "@/lib/clientes/projetosDoCliente";

/**
 * Documentos do portal. Em "Ver como cliente" o admin lê `useProjects()` sem filtro (todos os projetos da
 * agência): o seletor "Projeto" listava projetos de outros clientes. Agora só os do cliente da tela. Para o
 * cliente real nada muda (a RLS já devolve só os dele).
 */

const estado = vi.hoisted(() => ({
  clientId: "c1" as string | null,
  projetos: [] as Array<{ id: string; name: string; client_id: string }>,
}));

vi.mock("@/hooks/useClientIdentity", () => ({ useClientIdentity: () => ({ clientId: estado.clientId, isImpersonating: true }) }));
vi.mock("@/hooks/useSupabaseData", () => ({
  useFiles: () => ({ data: [], isLoading: false }),
  useProjects: () => ({ data: estado.projetos }),
}));
vi.mock("@/hooks/useFileApprovalDecision", () => ({ useFileApprovalDecision: () => ({ decide: vi.fn(), submitting: false, isReadOnly: true }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/client/useTelaPequena", () => ({ useTelaPequena: () => false }));
vi.mock("@/components/shared/CarouselSlider", () => ({ default: () => null }));

import ClientDocuments from "@/pages/ClientDocuments";

const PROJETOS = [
  { id: "p1", name: "Site da Marina", client_id: "c1" },
  { id: "p2", name: "Tráfego do Outro Cliente", client_id: "c2" },
  { id: "p3", name: "Social da Marina", client_id: "c1" },
];

beforeEach(() => {
  window.localStorage.clear();
  estado.clientId = "c1";
  estado.projetos = PROJETOS;
});
afterEach(cleanup);

describe("projetosDoCliente", () => {
  it("fica só com os projetos do cliente", () => {
    expect(projetosDoCliente(PROJETOS, "c1").map((p) => p.id)).toEqual(["p1", "p3"]);
    expect(projetosDoCliente(PROJETOS, "c2").map((p) => p.id)).toEqual(["p2"]);
  });

  it("sem cliente ou sem lista: nenhum projeto", () => {
    expect(projetosDoCliente(PROJETOS, null)).toEqual([]);
    expect(projetosDoCliente(undefined, "c1")).toEqual([]);
  });
});

describe("Documentos em Ver como cliente", () => {
  it("o seletor Projeto lista só os projetos do cliente da tela", () => {
    render(
      <MemoryRouter>
        <ClientDocuments />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Projeto/ }));
    const opcoes = screen.getAllByRole("option").map((o) => o.textContent || "");
    expect(opcoes.some((t) => t.includes("Site da Marina"))).toBe(true);
    expect(opcoes.some((t) => t.includes("Social da Marina"))).toBe(true);
    expect(opcoes.some((t) => t.includes("Outro Cliente"))).toBe(false);
  });

  it("cliente real (só os projetos dele na lista): nada muda", () => {
    estado.projetos = PROJETOS.filter((p) => p.client_id === "c1");
    render(
      <MemoryRouter>
        <ClientDocuments />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Projeto/ }));
    const opcoes = screen.getAllByRole("option").map((o) => o.textContent || "");
    expect(opcoes.filter((t) => t.includes("Marina"))).toHaveLength(2);
  });
});
