import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { PecaFato } from "@/lib/esteiraLinha/esteiraLinha";

/**
 * A tela da Esteira em linha do tempo com dados simulados (sem rede): faixas
 * por cliente ativo, cartões no dia certo, destaque e alerta do dia
 * prioritário, link do cartão e troca de semana.
 */

// Quarta-feira, 18/11/2026, meio-dia em São Paulo. Semana de 16 a 22/11.
const QUARTA = new Date("2026-11-18T15:00:00Z");

const CLIENTES = [
  { id: "c1", company_name: "Alfa Comércio", plan_status: "active", deleted_at: null },
  { id: "c2", company_name: null, full_name: "Beta Loja", plan_status: "active", deleted_at: null },
  { id: "c3", company_name: "Pausado Ltda", plan_status: "paused", deleted_at: null },
  { id: "c4", company_name: "Apagado Ltda", plan_status: "active", deleted_at: "2026-10-01T00:00:00Z" },
  // Na lista temporária de pausa operacional (RD AR): plano active, mas sem dia prioritário na Esteira.
  { id: "52f2efb6-9928-4074-b8e2-bc972baf1f6a", company_name: "Rd Ar Climatização", plan_status: "active", deleted_at: null },
];

const DIAS = [
  { client_id: "c1", dia: 2, situacao: "confirmado" },
  { client_id: "c2", dia: 4, situacao: "confirmado" },
  { client_id: "52f2efb6-9928-4074-b8e2-bc972baf1f6a", dia: 2, situacao: "confirmado" },
];

const peca = (extra: Partial<PecaFato>): PecaFato => ({
  chave: "post:p1",
  clientId: "c1",
  titulo: "Peça",
  contentType: "static",
  post: null,
  publicacoes: [],
  tarefa: null,
  trabalho: null,
  arquivos: [],
  ...extra,
});

const PECAS: PecaFato[] = [
  peca({
    chave: "post:p1", titulo: "Promoção de sexta", contentType: "carousel",
    post: { id: "p1", production_status: "ready", archived_at: null, temArquivo: true },
    // 01:30 UTC de quarta ainda é terça em São Paulo: cai no dia prioritário da Alfa.
    publicacoes: [{ status: "scheduled", scheduled_at: "2026-11-18T01:30:00Z", published_at: null }],
  }),
  peca({
    chave: "task:t9", clientId: "c2", titulo: "Reel do bastidor", contentType: "reel",
    tarefa: { id: "t9", status: "todo", due_date: "2026-11-20" },
    trabalho: { status: "gerando", entrega_status: null, temArquivo: false },
  }),
];

const leituras: Array<{ ids: string[]; segunda: string }> = [];

vi.mock("@/hooks/useSupabaseData", () => ({ useClients: () => ({ data: CLIENTES, isLoading: false, isFetching: false, error: null, refetch: vi.fn() }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, profile: { role: "admin" } }) }));
vi.mock("@/lib/diaPrioritarioApi", () => ({ useDiasPrioritarios: () => ({ data: DIAS, isLoading: false, isFetching: false, error: null, refetch: vi.fn() }) }));
vi.mock("@/lib/esteiraLinha/esteiraLinhaFatos", () => ({
  lerPecasDaEsteiraLinha: async (ids: string[], segunda: string) => {
    leituras.push({ ids, segunda });
    return segunda === "2026-11-16" ? PECAS : [];
  },
}));

import EsteiraLinhaDoTempo from "@/pages/EsteiraLinhaDoTempo";

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <EsteiraLinhaDoTempo agora={QUARTA} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const celula = (tela: HTMLElement, cliente: string, dia: string) =>
  tela.querySelector(`[data-faixa-da-esteira="${cliente}"] [data-dia="${dia}"]`) as HTMLElement;

describe("tela da Esteira em linha do tempo", () => {
  it("mostra os dias, uma faixa por cliente ativo, os cartões, o destaque, o alerta e o link", async () => {
    const { container } = montar();
    await screen.findByText("Promoção de sexta");

    expect(screen.getByRole("heading", { name: "Esteira" })).toBeTruthy();
    const cabecalhos = screen.getAllByRole("columnheader").map((th) => th.textContent);
    expect(cabecalhos).toEqual(["Cliente", "Seg 16", "Ter 17", "Qua 18Hoje", "Qui 19", "Sex 20", "Sáb 21", "Dom 22"]);

    // Só os ativos, e a leitura das peças é uma só para a carteira inteira.
    expect(screen.getAllByRole("rowheader").map((th) => th.textContent)).toEqual([
      "Alfa ComércioDia prioritário: terça-feira",
      "Beta LojaDia prioritário: quinta-feira",
      "Rd Ar Climatização",
    ]);
    expect(leituras).toEqual([{ ids: ["52f2efb6-9928-4074-b8e2-bc972baf1f6a", "c1", "c2"], segunda: "2026-11-16" }]);
    // RD AR (pausa operacional): a faixa fica, a terça não destaca nem alerta.
    const tercaDaRdAr = celula(container, "52f2efb6-9928-4074-b8e2-bc972baf1f6a", "2026-11-17");
    expect(tercaDaRdAr.getAttribute("data-prioritario")).toBeNull();
    expect(tercaDaRdAr.getAttribute("data-alerta")).toBeNull();

    // Alfa: a peça caiu na terça (dia prioritário), com destaque e sem alerta.
    const tercaDaAlfa = celula(container, "c1", "2026-11-17");
    expect(tercaDaAlfa.getAttribute("data-prioritario")).toBe("sim");
    expect(tercaDaAlfa.getAttribute("data-alerta")).toBeNull();
    const cartao = within(tercaDaAlfa).getByRole("link");
    expect(cartao.getAttribute("href")).toBe("/calendario?client=c1&content=p1");
    expect(cartao.textContent).toContain("Carrossel");
    expect(cartao.textContent).toContain("Agendado");
    expect(cartao.getAttribute("aria-label")).toContain("Abrir na Agenda");

    // Beta: a peça está na sexta e leva ao Estúdio; a quinta (dia prioritário) está vazia.
    const quintaDaBeta = celula(container, "c2", "2026-11-19");
    expect(quintaDaBeta.getAttribute("data-alerta")).toBe("sim");
    expect(quintaDaBeta.textContent).toBe("Dia prioritário sem peça");
    const doEstudio = within(celula(container, "c2", "2026-11-20")).getByRole("link");
    expect(doEstudio.getAttribute("href")).toBe("/mesa?client=c2&aba=estudio&task=t9");
    expect(doEstudio.textContent).toContain("Arte");
    expect(container.querySelectorAll('[data-alerta="sim"]')).toHaveLength(1);

    // Legenda no rodapé, e nenhuma ação além de navegar e atualizar.
    const legenda = screen.getByRole("contentinfo", { name: "Legenda das etapas" });
    for (const etapa of ["Pauta", "Arte", "Revisão", "Aprovação", "Agendado", "No ar"]) expect(within(legenda).getByText(etapa)).toBeTruthy();
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") || b.textContent)).toEqual(
      expect.arrayContaining(["Semana anterior", "Semana atual", "Próxima semana", "Atualizar"]),
    );
  });

  it("troca de semana e volta para a atual", async () => {
    const { container } = montar();
    await screen.findByText("Promoção de sexta");
    expect((screen.getByRole("button", { name: "Semana atual" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Próxima semana" }));
    await waitFor(() => expect(screen.getAllByRole("columnheader")[1].textContent).toBe("Seg 23"));
    await waitFor(() => expect(screen.queryByText("Promoção de sexta")).toBeNull());
    // Semana sem peça: as faixas continuam e os dois dias prioritários alertam.
    await waitFor(() => expect(container.querySelectorAll('[data-alerta="sim"]')).toHaveLength(2));
    expect(screen.getAllByRole("rowheader")).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "Semana atual" }));
    await screen.findByText("Promoção de sexta");
    fireEvent.click(screen.getByRole("button", { name: "Semana anterior" }));
    await waitFor(() => expect(screen.getAllByRole("columnheader")[1].textContent).toBe("Seg 9"));
  });
});
