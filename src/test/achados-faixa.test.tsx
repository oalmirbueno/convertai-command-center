import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import FaixaDeAchados, { MAXIMO_A_VISTA } from "@/components/achados/FaixaDeAchados";
import type { Achado } from "@/components/achados/detectores";

/**
 * Faixa de achados (20/10/2026): some sem achado, mostra no máximo 6 com
 * "Ver todos", a ação certa (link, cópia ou ação da própria tela) e aparece
 * no topo da Carteira da Central e no topo do Ciclo.
 */

type Row = Record<string, unknown>;
const dbState = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: dbState.from } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "staff" }, profile: { role: "manager" } }) }));
// Sábado, 12/09/2026: o ritual devido é a Prova de Movimento (sexta).
vi.mock("@/hooks/useNow", () => ({ useNow: () => new Date("2026-09-12T12:00:00Z") }));
vi.mock("@/hooks/usePwaProfile", () => ({ usePwaProfile: () => undefined }));
vi.mock("@/hooks/useFotosDosClientes", () => ({ useFotosDosClientes: () => ({ fotoDe: () => null }) }));
vi.mock("@/components/esteira/EsteiraClientSheet", () => ({ default: () => null }));

const copiado = vi.hoisted(() => ({ texto: "" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

function query(data: Row[]) {
  const promise = Promise.resolve({ data, error: null });
  return Object.assign(promise, {
    select: () => promise, in: () => promise, eq: () => promise,
    is: () => promise, gte: () => promise, order: () => promise, lt: () => promise,
  });
}

function fakeFrom(table: string) {
  const rows: Record<string, Row[]> = {
    user_roles: [{ user_id: "client" }],
    profiles: [{ id: "client", plan_status: "active", company_name: "Cliente sintético", created_at: "2026-01-01", services_config: { social: true } }],
    team_client_assignments: [{ client_id: "client" }],
  };
  return query(rows[table] ?? []);
}

const achado = (id: string, extra: Partial<Achado> = {}): Achado => ({
  id, numero: 3, frase: `frase ${id}`, acao: { rotulo: `Ação ${id}`, rota: `/rota-${id}` }, tom: "atencao", valor: 0, clientes: [], ajuda: `regra ${id}`, ...extra,
});

const comRotas = (ui: ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  dbState.from.mockImplementation(fakeFrom);
  copiado.texto = "";
  Object.assign(navigator, { clipboard: { writeText: (t: string) => { copiado.texto = t; return Promise.resolve(); } } });
});
afterEach(cleanup);

describe("FaixaDeAchados", () => {
  it("sem achado não desenha nada", () => {
    const { container } = comRotas(<FaixaDeAchados achados={[]} />);
    expect(container.querySelector("[data-faixa-de-achados]")).toBeNull();
  });

  it("número grande, frase curta e a ação como link", () => {
    comRotas(<FaixaDeAchados achados={[achado("a")]} />);
    const item = document.querySelector('[data-achado="a"]') as HTMLElement;
    expect(within(item).getByText("3")).toBeInTheDocument();
    expect(within(item).getByText("frase a")).toBeInTheDocument();
    expect(within(item).getByRole("link", { name: "Ação a: 3 frase a" })).toHaveAttribute("href", "/rota-a");
  });

  it("no máximo 6 à vista e 'Ver todos' abre o resto", () => {
    const lista = Array.from({ length: 8 }, (_, i) => achado(`x${i}`));
    comRotas(<FaixaDeAchados achados={lista} />);
    expect(MAXIMO_A_VISTA).toBe(6);
    expect(document.querySelectorAll("[data-achado]")).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: "Ver todos (8)" }));
    expect(document.querySelectorAll("[data-achado]")).toHaveLength(8);
  });

  it("mensagem pronta é copiada (nada é enviado)", async () => {
    comRotas(<FaixaDeAchados achados={[achado("cobranca-atrasada", { acao: { rotulo: "Copiar cobrança", copiar: "Oi, Acerbi!" } })]} />);
    fireEvent.click(screen.getByRole("button", { name: /Copiar cobrança/ }));
    await waitFor(() => expect(copiado.texto).toBe("Oi, Acerbi!"));
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("ação da própria tela passa na frente do link (ex.: gerar o ritual na Central)", () => {
    const gerar = vi.fn();
    comRotas(<FaixaDeAchados achados={[achado("ritual-pendente", { acao: { rotulo: "Gerar", rota: "/central" }, extra: { ritual: "rota_semana" } })]} acoesLocais={{ "ritual-pendente": gerar }} />);
    fireEvent.click(screen.getByRole("button", { name: /Gerar/ }));
    expect(gerar).toHaveBeenCalledWith(expect.objectContaining({ id: "ritual-pendente", extra: { ritual: "rota_semana" } }));
  });

  it("no celular a faixa rola por dentro, para o lado; do tablet para cima vira grade", () => {
    comRotas(<FaixaDeAchados achados={[achado("a")]} />);
    const lista = screen.getByRole("list", { name: "Achados com ação" });
    expect(lista.className).toContain("overflow-x-auto");
    expect(lista.className).toContain("min-w-0");
    expect(lista.className).toContain("sm:grid");
    expect(lista.className).toContain("sm:overflow-visible");
  });
});

describe("a faixa no Ciclo", () => {
  it("aparece no topo do Ciclo com o ritual devido e a ação certa", async () => {
    const { default: AdminEsteira } = await import("@/pages/AdminEsteira");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter><AdminEsteira /></MemoryRouter>
      </QueryClientProvider>,
    );
    const item = await screen.findByText("cliente sem a Prova de Movimento enviada", {}, { timeout: 15000 });
    const cartao = item.closest("[data-achado]") as HTMLElement;
    expect(cartao.getAttribute("data-achado")).toBe("ritual-pendente");
    expect(within(cartao).getByRole("link", { name: /Gerar/ })).toHaveAttribute("href", "/central");
  }, 20000);
});

describe("a faixa na Central", () => {
  const central = readFileSync(resolve(__dirname, "../..", "src/pages/AdminExperience.tsx"), "utf8").replace(/\r\n/g, "\n");

  it("fica no topo da aba Carteira, acima das partes Dia Prioritário e Saúde", () => {
    const carteira = central.indexOf('{activeTab === "carteira" && (');
    const faixa = central.indexOf("<FaixaDeAchados", carteira);
    const abas = central.indexOf('data-abas-da-carteira=""', carteira);
    expect(carteira).toBeGreaterThan(0);
    expect(faixa).toBeGreaterThan(carteira);
    expect(faixa).toBeLessThan(abas);
  });

  it("filtra pelo cliente aberto e o ritual abre o gerador da própria Central", () => {
    expect(central).toContain('useAchados({ clienteEmFoco: expandedHealth, ativo: !cycleReview && activeTab === "carteira" })');
    expect(central).toMatch(/"ritual-pendente": \(a\) => \{ setGenClientId\(expandedHealth \|\| "__all__"\); setGenRitual\(a\.extra\?\.ritual \|\| ritualForToday\(\)\); setGenPreviews\(null\); setGeneratorOpen\(true\); \}/);
  });
});
