import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import AgendaComercial from "@/components/comercial/AgendaComercial";
import FunilKanban from "@/components/comercial/FunilKanban";
import type { Atividade, Lead } from "@/lib/comercial";

afterEach(cleanup);

/**
 * Teste de queda: renderiza as telas do comercial de verdade.
 *
 * Os testes anteriores liam o arquivo como TEXTO e conferiam se as regras
 * estavam escritas. Isso pega regra errada, mas nao pega tela que quebra ao
 * abrir. Aqui os componentes montam de fato, com dados nos formatos que o
 * banco devolve, inclusive os incomodos: atividade sem lead, lead sem valor,
 * data de virada de mes.
 */

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }),
        order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
        is: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
      }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      insert: () => Promise.resolve({ error: null }),
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "u1" } } }) },
  },
}));

const lead = (parcial: Partial<Lead>): Lead => ({
  id: parcial.id || "l1",
  name: "Padaria do Zé",
  company: "Padaria do Zé Ltda",
  email: null,
  whatsapp: null,
  origin: "manual",
  campaign_id: null,
  quiz_submission_id: null,
  stage: "proposta",
  monthly_value: 1500,
  one_off_value: 3000,
  owner_id: null,
  next_action: null,
  next_action_at: null,
  notes: null,
  lost_reason: null,
  won_client_id: null,
  closed_at: null,
  created_at: "2026-08-10T12:00:00Z",
  expected_close_date: "2026-08-30",
  organization_id: null,
  contact_id: null,
  ...parcial,
});

const atividade = (parcial: Partial<Atividade>): Atividade => ({
  id: parcial.id || "a1",
  lead_id: "l1",
  kind: "ligacao",
  title: "Retornar a ligação",
  due_at: "2026-08-20T14:00:00Z",
  done_at: null,
  owner_id: null,
  notes: null,
  ...parcial,
});

function comProvedores(no: React.ReactNode) {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={["/comercial"]}>
        <Routes>
          <Route path="/comercial" element={<>{no}</>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("o CRM abre sem quebrar", () => {
  it("com leads e atividades", () => {
    comProvedores(
      <FunilKanban
        leads={[lead({}), lead({ id: "l2", stage: "novo", monthly_value: 0, one_off_value: 0 })]}
        atividades={[atividade({}), atividade({ id: "a2", lead_id: "l2", done_at: "2026-08-19T10:00:00Z" })]}
        carregando={false}
        clientes={[{ id: "c1", nome: "Cliente A" }]}
        onAbrir={() => {}}
        onNovo={() => {}}
        onImportar={() => {}}
        importando={false}
        onMovido={async () => {}}
      />,
    );
    expect(screen.getAllByText("Padaria do Zé").length).toBeGreaterThan(0);
    // Lead sem valor nao pode virar "R$ NaN".
    expect(screen.getAllByText("sem valor definido").length).toBeGreaterThan(0);
  });

  it("com o funil vazio", () => {
    comProvedores(
      <FunilKanban
        leads={[]}
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
    expect(screen.getByText(/funil está vazio/i)).toBeTruthy();
  });

  it("lead sem compromisso avisa que ninguém marcou nada", () => {
    comProvedores(
      <FunilKanban
        leads={[lead({})]}
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
    expect(screen.getByText("sem próximo passo")).toBeTruthy();
  });
});

describe("a agenda abre sem quebrar", () => {
  it("desenha o mês e aceita compromisso sem lead", () => {
    comProvedores(
      <AgendaComercial
        atividades={[
          atividade({}),
          // O caso que o INNER JOIN antigo escondia: compromisso proprio.
          atividade({ id: "a3", lead_id: null, kind: "reuniao", title: "Planejamento" }),
        ]}
        leads={[lead({})]}
        onAbrirLead={() => {}}
        onMudou={async () => {}}
      />,
    );
    // Sete cabecalhos de dia da semana provam que a grade montou.
    expect(screen.getByText("seg")).toBeTruthy();
    expect(screen.getByText("dom")).toBeTruthy();
    expect(screen.getByText("Marcar")).toBeTruthy();
  });

  it("sem nada marcado", () => {
    comProvedores(
      <AgendaComercial
        atividades={[]}
        leads={[]}
        onAbrirLead={() => {}}
        onMudou={async () => {}}
      />,
    );
    expect(screen.getByText(/Nenhum compromisso neste dia/i)).toBeTruthy();
  });

  it("atividade de lead que não está na lista não derruba a tela", () => {
    // Acontece de verdade: lead arquivado sai da lista, a atividade fica.
    comProvedores(
      <AgendaComercial
        atividades={[atividade({ lead_id: "fantasma" })]}
        leads={[]}
        onAbrirLead={() => {}}
        onMudou={async () => {}}
      />,
    );
    // A grade do mes montou: os numeros dos dias estao la.
    expect(screen.getAllByText(/^\d+$/).length).toBeGreaterThan(20);
  });
});
