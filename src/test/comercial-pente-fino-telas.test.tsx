import { readFileSync } from "node:fs";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Lead } from "@/lib/comercial";

afterEach(cleanup);

/**
 * Pente-fino do Comercial (01/11/2026): as telas que mostravam número ou
 * configuração que não eram os do banco. Montam de verdade, no molde de
 * comercial-renderiza.
 */

const config = vi.hoisted(() => ({ ler: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }),
        order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
        is: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
      }),
    }),
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "u1" } } }) },
  },
}));

vi.mock("@/lib/comercial", async (original) => ({
  ...(await original<typeof import("@/lib/comercial")>()),
  lerConfigDoMercurio: config.ler,
  listarCaixa: () => Promise.resolve([]),
}));

import FunilKanban from "@/components/comercial/FunilKanban";
import CaixaDoComercial from "@/components/comercial/CaixaDoComercial";

const lead = (parcial: Partial<Lead>): Lead => ({
  id: "l1",
  name: "Padaria do Zé",
  company: null,
  email: null,
  whatsapp: null,
  origin: "manual",
  campaign_id: null,
  quiz_submission_id: null,
  stage: "proposta",
  monthly_value: 1500,
  one_off_value: 0,
  owner_id: null,
  next_action: null,
  next_action_at: null,
  notes: null,
  lost_reason: null,
  won_client_id: null,
  classe: null,
  qualificacao: {},
  closed_at: null,
  created_at: "2026-10-10T12:00:00Z",
  expected_close_date: null,
  organization_id: null,
  contact_id: null,
  ...parcial,
});

function comProvedores(no: React.ReactNode) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter>{no}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("10. os contadores dos filtros do funil contam só o que o quadro mostra", () => {
  it("com 1 aberto, 1 ganho e 1 perdido, 'Todas' e 'Todos' dizem 1", () => {
    comProvedores(
      <FunilKanban
        leads={[
          lead({ id: "a" }),
          lead({ id: "g", stage: "ganho", closed_at: "2026-10-20T12:00:00Z" }),
          lead({ id: "p", stage: "perdido", closed_at: "2026-10-21T12:00:00Z" }),
        ]}
        atividades={[]}
        carregando={false}
        clientes={[]}
        onAbrir={() => {}}
        onNovo={() => {}}
        onImportar={() => {}}
        importando={false}
        onMovido={async () => {}}
      />,
    );
    const filtros = screen.getByRole("group", { name: "Filtros do funil" });
    // Quem atende (lista): o botão mostra a opção escolhida e o contador dela.
    expect(within(filtros).getByRole("button", { name: "Quem atende: Todos" }).textContent).toBe("Todos1");
    // Classe: a opção "Todas" (segmentada ou em lista) mostra o contador.
    const classe = within(filtros).queryByRole("tablist", { name: "Classe" });
    const todas = classe
      ? within(classe).getByRole("tab", { name: /Todas/ })
      : within(filtros).getByRole("button", { name: /^Classe:/ });
    expect(todas.textContent).toBe("Todas1");
  });
});

describe("7. a configuração do Mercúrio não mostra o padrão como real", () => {
  it("leitura que falha mostra o erro e trava campos e Salvar", async () => {
    config.ler.mockRejectedValue(new Error("falhou"));
    comProvedores(<CaixaDoComercial leads={[]} onAbrirLead={() => {}} />);
    expect(await screen.findByText("Não foi possível ler a configuração do Mercúrio.")).toBeTruthy();
    const orientacoes = screen.getByLabelText("Orientações para o Mercúrio") as HTMLTextAreaElement;
    expect(orientacoes.closest("fieldset")?.disabled).toBe(true);
    expect((screen.getByRole("checkbox") as HTMLInputElement).closest("fieldset")?.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Salvar" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("enquanto lê, os campos ficam travados; lida, abrem com o que veio do banco", async () => {
    let entregar: (v: unknown) => void = () => {};
    config.ler.mockReturnValue(new Promise((ok) => { entregar = ok; }));
    comProvedores(<CaixaDoComercial leads={[]} onAbrirLead={() => {}} />);
    const orientacoes = screen.getByLabelText("Orientações para o Mercúrio") as HTMLTextAreaElement;
    expect(orientacoes.closest("fieldset")?.disabled).toBe(true);
    entregar({ slug: "mercurio", ativo: true, limite_primeiros_contatos_dia: 5, horario_inicio: "08:00", horario_fim: "17:00", orientacoes: "Nunca prometer prazo" });
    await waitFor(() => expect(orientacoes.value).toBe("Nunca prometer prazo"));
    expect(orientacoes.closest("fieldset")?.disabled).toBe(false);
  });
});

describe("11. levar ao CRM pela Máquina de leads recarrega os leads do Comercial", () => {
  it("invalida a chave real dos leads", () => {
    const maquina = readFileSync("src/components/comercial/MaquinaDeLeads.tsx", "utf8");
    const pagina = readFileSync("src/pages/AdminComercial.tsx", "utf8");
    expect(pagina).toContain('queryKey: ["comercial-leads"]');
    const importar = maquina.slice(maquina.indexOf("const importar = useMutation"), maquina.indexOf("const descartar = useMutation"));
    expect(importar).toContain('invalidateQueries({ queryKey: ["comercial-leads"] })');
  });
});
