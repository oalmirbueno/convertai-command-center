import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FunilKanban from "@/components/comercial/FunilKanban";
import {
  FAIXAS_DO_FILTRO,
  entradaNaEtapa,
  explicarTemperatura,
  faixaDaTemperatura,
  passaNoFiltroDeTemperatura,
  temperaturaDoLead,
  type EventoDoLead,
} from "@/components/comercial/temperatura";
import { quandoVence, resumoDaOportunidade } from "@/components/comercial/resumoDaOportunidade";
import type { Atividade, Lead } from "@/lib/comercial";

/**
 * Resumo rápido da oportunidade e temperatura do lead (19/10/2026).
 *
 * A temperatura é regra fixa (temperatura.ts): os cenários abaixo travam o
 * sentido de cada sinal (parado esfria, reunião esquenta, proposta aberta
 * esquenta) sem travar o número exato, que pode ser recalibrado nos pesos.
 */

afterEach(cleanup);
beforeEach(() => {
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    /* sem armazenamento: o teste segue */
  }
});

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

const AGORA = "2026-10-19T15:00:00.000Z";
const diasAtras = (dias: number) => new Date(new Date(AGORA).getTime() - dias * 86400000).toISOString();
const diasAFrente = (dias: number) => new Date(new Date(AGORA).getTime() + dias * 86400000).toISOString();

const lead = (parcial: Partial<Lead>): Lead => ({
  id: "l1",
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
  classe: null,
  qualificacao: {},
  closed_at: null,
  created_at: diasAtras(90),
  expected_close_date: null,
  organization_id: null,
  contact_id: null,
  ...parcial,
});

const atividade = (parcial: Partial<Atividade>): Atividade => ({
  id: "a1",
  lead_id: "l1",
  kind: "ligacao",
  title: "Retornar a ligação",
  due_at: diasAFrente(1),
  done_at: null,
  owner_id: null,
  notes: null,
  ...parcial,
});

const evento = (parcial: Partial<EventoDoLead>): EventoDoLead => ({
  lead_id: "l1",
  kind: "nota",
  from_stage: null,
  to_stage: null,
  note: null,
  created_at: diasAtras(1),
  ...parcial,
});

const entrouEmProposta = (dias: number) =>
  evento({ kind: "stage", from_stage: "diagnostico", to_stage: "proposta", created_at: diasAtras(dias) });

describe("temperatura do lead (regra fixa)", () => {
  it("parado esfria: o mesmo lead perde pontos quanto mais tempo fica sem movimento", () => {
    const recente = temperaturaDoLead(lead({}), [], [entrouEmProposta(2)], AGORA);
    const parado20 = temperaturaDoLead(lead({}), [], [entrouEmProposta(20)], AGORA);
    const parado45 = temperaturaDoLead(lead({}), [], [entrouEmProposta(45)], AGORA);
    expect(parado20.valor).toBeLessThan(recente.valor);
    expect(parado45.valor).toBeLessThan(parado20.valor);
    expect(parado45.faixa).toBe("frio");
    expect(parado45.motivos.some((m) => m.rotulo.indexOf("parado há 45 dias") === 0 && m.pontos < 0)).toBe(true);
  });

  it("reunião marcada esquenta", () => {
    const eventos = [entrouEmProposta(5)];
    const sem = temperaturaDoLead(lead({}), [], eventos, AGORA);
    const com = temperaturaDoLead(lead({}), [atividade({ kind: "reuniao", title: "Apresentar", due_at: diasAFrente(2) })], eventos, AGORA);
    expect(com.valor).toBeGreaterThan(sem.valor);
    expect(com.motivos.map((m) => m.rotulo)).toContain("reunião marcada");
  });

  it("proposta aberta pelo cliente e conversa registrada esquentam; recusada esfria", () => {
    const base = [entrouEmProposta(5)];
    const antes = temperaturaDoLead(lead({}), [], base, AGORA).valor;
    const aberta = temperaturaDoLead(lead({}), [], [...base, evento({ note: "Proposta P-12 aberta pelo cliente.", created_at: diasAtras(2) })], AGORA);
    expect(aberta.valor).toBeGreaterThan(antes);
    // A nota automática da proposta não conta como conversa.
    expect(aberta.motivos.some((m) => m.rotulo.indexOf("conversa") >= 0)).toBe(false);
    const conversa = temperaturaDoLead(lead({}), [], [...base, evento({ note: "Ligou pedindo ajuste no escopo", created_at: diasAtras(1) })], AGORA);
    expect(conversa.valor).toBeGreaterThan(antes);
    const recusada = temperaturaDoLead(lead({}), [], [...base, evento({ note: "Proposta P-12 recusada: preço", created_at: diasAtras(1) })], AGORA);
    expect(recusada.valor).toBeLessThan(antes);
  });

  it("20/10/2026: a nota do formulário do site é automática e não conta como conversa", () => {
    const base = [entrouEmProposta(5)];
    const antes = temperaturaDoLead(lead({}), [], base, AGORA);
    const doSite = temperaturaDoLead(lead({}), [], [...base, evento({ note: "Chegou pelo formulário do site Loja (/contato).", created_at: diasAtras(1) })], AGORA);
    expect(doSite.motivos.some((m) => m.rotulo.indexOf("conversa") >= 0)).toBe(false);
    expect(doSite.valor).toBe(antes.valor);
  });

  it("compromisso atrasado esfria e a origem pesa", () => {
    const eventos = [entrouEmProposta(5)];
    const emDia = temperaturaDoLead(lead({}), [atividade({ due_at: diasAFrente(1) })], eventos, AGORA);
    const atrasado = temperaturaDoLead(lead({}), [atividade({ due_at: diasAtras(2) })], eventos, AGORA);
    expect(atrasado.valor).toBeLessThan(emDia.valor);
    const indicacao = temperaturaDoLead(lead({ origin: "indicacao" }), [], eventos, AGORA);
    const manual = temperaturaDoLead(lead({ origin: "manual" }), [], eventos, AGORA);
    expect(indicacao.valor).toBeGreaterThan(manual.valor);
  });

  it("lead quente de verdade passa de 65 e fica entre 0 e 100", () => {
    const quente = temperaturaDoLead(
      lead({ stage: "negociacao", origin: "indicacao" }),
      [atividade({ kind: "reuniao", due_at: diasAFrente(1) }), atividade({ id: "a2", done_at: diasAtras(1) })],
      [
        evento({ kind: "stage", to_stage: "negociacao", created_at: diasAtras(3) }),
        evento({ note: "Proposta P-1 aberta pelo cliente.", created_at: diasAtras(2) }),
        evento({ note: "Conversou no WhatsApp", created_at: diasAtras(1) }),
      ],
      AGORA,
    );
    expect(quente.faixa).toBe("quente");
    expect(quente.valor).toBeLessThanOrEqual(100);
    expect(quente.valor).toBeGreaterThanOrEqual(65);
  });

  it("o porquê lista cada sinal com o peso", () => {
    const t = temperaturaDoLead(lead({}), [atividade({ kind: "reuniao", due_at: diasAFrente(2) })], [entrouEmProposta(5)], AGORA);
    const texto = explicarTemperatura(t);
    expect(texto).toContain(`${t.valor} de 100`);
    expect(texto).toContain("+20 reunião marcada");
  });

  it("faixas e filtro", () => {
    expect(faixaDaTemperatura(10)).toBe("frio");
    expect(faixaDaTemperatura(35)).toBe("morno");
    expect(faixaDaTemperatura(65)).toBe("quente");
    const t = { valor: 70, faixa: "quente" as const, motivos: [] };
    expect(passaNoFiltroDeTemperatura(t, "todas")).toBe(true);
    expect(passaNoFiltroDeTemperatura(t, "quente")).toBe(true);
    expect(passaNoFiltroDeTemperatura(t, "frio")).toBe(false);
    expect(FAIXAS_DO_FILTRO).toEqual(["todas", "quente", "morno", "frio"]);
  });
});

describe("resumo rápido da oportunidade", () => {
  it("mostra o tempo na etapa a partir do último evento de etapa", () => {
    const r = resumoDaOportunidade(lead({}), [], [entrouEmProposta(30), entrouEmProposta(6)], AGORA);
    expect(r.tempoNaEtapa).toBe("há 6 dias em Proposta");
    expect(r.diasNaEtapa).toBe(6);
    expect(r.chance).toBe(60);
    expect(r.valor).toContain("/mês");
  });

  it("sem evento de etapa, usa a criação e avisa que é estimado", () => {
    const r = resumoDaOportunidade(lead({ created_at: diasAtras(9) }), [], [], AGORA);
    expect(r.tempoNaEtapa).toBe("há cerca de 9 dias em Proposta");
    expect(entradaNaEtapa(lead({ stage: "novo" }), []).estimado).toBe(false);
  });

  it("mostra o próximo passo e quando vence", () => {
    const r = resumoDaOportunidade(
      lead({}),
      [atividade({ kind: "reuniao", title: "Apresentar proposta", due_at: diasAFrente(1) })],
      [entrouEmProposta(6)],
      AGORA,
    );
    expect(r.proximoPasso).toBe("Reunião: Apresentar proposta");
    expect(r.quando).toBe("amanhã");
    expect(r.atrasado).toBe(false);
    const atrasado = resumoDaOportunidade(lead({}), [atividade({ due_at: diasAtras(3) })], [], AGORA);
    expect(atrasado.atrasado).toBe(true);
    expect(atrasado.quando).toContain("atrasado desde");
  });

  it("lead sem nada marcado não inventa próximo passo", () => {
    const r = resumoDaOportunidade(lead({ monthly_value: 0, one_off_value: 0 }), [], [], AGORA);
    expect(r.proximoPasso).toBeNull();
    expect(r.quando).toBeNull();
    expect(r.valor).toBe("sem valor definido");
    expect(quandoVence("lixo", AGORA).texto).toBe("");
  });
});

function comProvedores(no: React.ReactNode) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

describe("o funil mostra o resumo e filtra por temperatura", () => {
  const haDias = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
  const leads = [
    lead({ id: "quente", name: "Lead Quente", stage: "negociacao", origin: "indicacao", created_at: haDias(20) }),
    lead({ id: "frio", name: "Lead Frio", stage: "proposta", created_at: haDias(60) }),
  ];
  const atividades = [
    atividade({ id: "r1", lead_id: "quente", kind: "reuniao", title: "Fechar escopo", due_at: new Date(Date.now() + 86400000).toISOString() }),
  ];
  const eventos = [
    evento({ lead_id: "quente", kind: "stage", to_stage: "negociacao", created_at: haDias(2) }),
    evento({ lead_id: "quente", note: "Conversou por WhatsApp", created_at: haDias(1) }),
    evento({ lead_id: "frio", kind: "stage", to_stage: "proposta", created_at: haDias(45) }),
  ];

  const montar = () =>
    comProvedores(
      <FunilKanban
        leads={leads}
        atividades={atividades}
        eventos={eventos}
        carregando={false}
        clientes={[]}
        onAbrir={() => {}}
        onNovo={() => {}}
        onImportar={() => {}}
        importando={false}
        onMovido={async () => {}}
      />,
    );

  it("cartão mostra termômetro, tempo na etapa e próximo passo com o quando", () => {
    montar();
    expect(screen.getAllByText(/há 2 dias em Negociação/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/há 45 dias em Proposta/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Fechar escopo · amanhã/).length).toBeGreaterThan(0);
    const termometros = screen.getAllByRole("img", { name: /Temperatura:/ });
    expect(termometros.length).toBe(2);
    expect(termometros.some((t) => (t.getAttribute("title") || "").indexOf("Quente") === 0)).toBe(true);
    expect(termometros.some((t) => (t.getAttribute("title") || "").indexOf("Frio") === 0)).toBe(true);
  });

  it("filtro por temperatura deixa só a faixa escolhida", () => {
    montar();
    expect(screen.getAllByText("Lead Frio").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Temperatura/ }));
    const lista = screen.getByRole("listbox");
    fireEvent.click(within(lista).getByText("Quente"));
    expect(screen.queryAllByText("Lead Frio").length).toBe(0);
    expect(screen.getAllByText("Lead Quente").length).toBeGreaterThan(0);
  });

  it("ordenar pelo mais quente é um botão só de ícone com o nome no title", () => {
    montar();
    const botao = screen.getByRole("button", { name: "Mais quente primeiro" });
    expect(botao.getAttribute("title")).toContain("Mais quente primeiro");
    expect(botao.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(botao);
    expect(screen.getByRole("button", { name: "Mais quente primeiro" }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("a janela do lead tem o resumo no topo", () => {
  it("AdminComercial liga o resumo e a história dos leads", () => {
    const pagina = readFileSync("src/pages/AdminComercial.tsx", "utf8");
    expect(pagina).toContain("<ResumoNoTopoDoLead lead={lead} atividades={atividades} eventos={eventos} />");
    expect(pagina).toContain('queryKey: ["comercial-eventos"]');
    expect(pagina).toContain("eventos={eventos}");
  });

  it("os arquivos novos não usam regex proibida no piso Safari 11", () => {
    for (const arquivo of [
      "src/components/comercial/temperatura.ts",
      "src/components/comercial/resumoDaOportunidade.ts",
      "src/components/comercial/Termometro.tsx",
      "src/components/comercial/eventosDoFunil.ts",
    ]) {
      const fonte = readFileSync(arquivo, "utf8");
      expect(fonte).not.toContain("(?<");
      expect(fonte).not.toContain("\\p{");
    }
  });
});
