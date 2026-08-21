import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ESTAGIOS,
  ESTAGIOS_ABERTOS,
  METRICAS,
  type Lead,
  kpisDaCampanha,
  primeiroDiaDoMes,
  proximoMes,
  realizadoDoMes,
  resumoDoFunil,
} from "@/lib/comercial";

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");
const migration = ler("supabase/migrations/20260821190000_departamento_comercial.sql");
const lib = ler("src/lib/comercial.ts");
const app = ler("src/App.tsx");
const layout = ler("src/components/AppLayout.tsx");

const lead = (parcial: Partial<Lead>): Lead => ({
  id: parcial.id || "l1",
  name: "Lead",
  company: null,
  email: null,
  whatsapp: null,
  origin: "manual",
  campaign_id: null,
  quiz_submission_id: null,
  stage: "novo",
  monthly_value: 0,
  one_off_value: 0,
  owner_id: null,
  next_action: null,
  next_action_at: null,
  notes: null,
  lost_reason: null,
  won_client_id: null,
  closed_at: null,
  created_at: "2026-08-10T12:00:00Z",
  ...parcial,
});

/**
 * O módulo comercial é interno por definição — funil, meta e investimento de
 * marketing são gestão da casa, não material de cliente. E o número de
 * dinheiro tem um dono só: o Financeiro. A meta mora aqui; o realizado é
 * lido de lá na hora de exibir.
 */

describe("acesso: gestão da casa, não da equipe inteira", () => {
  it("a rota tem trava própria, mais estreita que a da equipe", () => {
    expect(app).toContain("function ComercialRoute");
    expect(app).toContain('profile?.role === "admin" || profile?.role === "manager"');
  });

  it("o banco repete a mesma régua — é ele que protege o dado", () => {
    // Trava de tela sozinha não protege nada: basta chamar a API direto.
    const politicas = migration.split("create policy").length - 1;
    expect(politicas).toBe(4);
    expect(migration).toContain("public.has_role(auth.uid(), 'admin'::public.app_role)");
    expect(migration).toContain("public.has_role(auth.uid(), 'manager'::public.app_role)");
    expect(migration).not.toContain("'design'::public.app_role");
    expect(migration).not.toContain("'client'::public.app_role");
  });

  it("as quatro tabelas ligam RLS e fecham anon", () => {
    for (const tabela of [
      "commercial_campaigns",
      "commercial_leads",
      "commercial_lead_events",
      "commercial_goals",
    ]) {
      expect(migration).toContain(`alter table public.${tabela} enable row level security`);
      expect(migration).toContain(`revoke all on public.${tabela} from anon`);
    }
  });

  it("o menu não oferece porta que não abre", () => {
    expect(layout).toContain('soGestao: true');
    expect(layout).toContain("const gruposPorPapel = (podeGestao: boolean)");
    // A peneira é uma só: os grupos do desktop e a lista do celular saem dela.
    expect(layout).toContain("gruposDoMenu.flatMap((grupo) => grupo.items)");
  });
});

describe("o realizado vem do Financeiro, não é digitado aqui", () => {
  it("receita do mês lê financial_entries por competência", () => {
    // Competência é a régua com que o Financeiro fecha o mês; usar a data de
    // pagamento faria a mesma empresa ter dois "faturamento de agosto".
    expect(lib).toContain('.from("financial_entries")');
    expect(lib).toContain('.eq("direction", "in")');
    expect(lib).toContain('.gte("competence", inicio)');
    expect(lib).toContain('.is("cancelled_at", null)');
  });

  it("a métrica de receita devolve exatamente o que o Financeiro deu", () => {
    const valor = realizadoDoMes({
      metrica: "receita",
      leads: [lead({ stage: "ganho", monthly_value: 9999, closed_at: "2026-08-12T00:00:00Z" })],
      periodo: "2026-08-01",
      receitaFinanceiro: 42000,
    });
    // Nem soma nem ajusta com o funil: o dono do número é um só.
    expect(valor).toBe(42000);
  });

  it("mensalidade nova conta só o que fechou no mês", () => {
    const leads = [
      lead({ id: "a", stage: "ganho", monthly_value: 2000, closed_at: "2026-08-05T00:00:00Z" }),
      lead({ id: "b", stage: "ganho", monthly_value: 3000, closed_at: "2026-07-30T00:00:00Z" }),
      lead({ id: "c", stage: "proposta", monthly_value: 5000 }),
    ];
    expect(
      realizadoDoMes({ metrica: "mrr_novo", leads, periodo: "2026-08-01", receitaFinanceiro: 0 }),
    ).toBe(2000);
    expect(
      realizadoDoMes({ metrica: "fechamentos", leads, periodo: "2026-08-01", receitaFinanceiro: 0 }),
    ).toBe(1);
  });

  it("cada métrica declara de onde vem o número", () => {
    for (const metrica of METRICAS) expect(metrica.fonte.length).toBeGreaterThan(10);
  });

  it("a virada de ano no cálculo do mês seguinte", () => {
    expect(proximoMes("2026-12-01")).toBe("2027-01-01");
    expect(proximoMes("2026-08-01")).toBe("2026-09-01");
    expect(primeiroDiaDoMes(new Date(2026, 0, 31))).toBe("2026-01-01");
  });
});

describe("o funil sabe o que está em risco", () => {
  it("ganho e perdido ficam fora do quadro de trabalho", () => {
    // Quadro que acumula fechado vira arquivo, e a coluna de hoje some.
    expect(ESTAGIOS_ABERTOS).not.toContain("ganho");
    expect(ESTAGIOS_ABERTOS).not.toContain("perdido");
    expect(ESTAGIOS.length).toBe(ESTAGIOS_ABERTOS.length + 2);
  });

  it("valor em jogo é o do ano: mensalidade × 12 + entrada", () => {
    const resumo = resumoDoFunil(
      [lead({ stage: "proposta", monthly_value: 1000, one_off_value: 3000 })],
      "2026-08-01",
      "2026-08-21",
    );
    expect(resumo.valorEmJogo).toBe(15000);
  });

  it("conta lead esquecido — é disso que funil morre", () => {
    const resumo = resumoDoFunil(
      [
        lead({ id: "a", stage: "contato", next_action_at: "2026-08-01" }),
        lead({ id: "b", stage: "contato", next_action_at: "2026-08-30" }),
        lead({ id: "c", stage: "contato" }),
      ],
      "2026-08-01",
      "2026-08-21",
    );
    expect(resumo.atrasados).toBe(1);
    expect(resumo.semProximoPasso).toBe(1);
  });

  it("aproveitamento é nulo enquanto nada fechou, não zero", () => {
    // Zero por cento diria que a casa perdeu tudo; nulo diz que não houve
    // decisão ainda, que é o que aconteceu.
    const semFechamento = resumoDoFunil([lead({ stage: "proposta" })], "2026-08-01", "2026-08-21");
    expect(semFechamento.taxaDeGanho).toBeNull();

    const comFechamento = resumoDoFunil(
      [
        lead({ id: "a", stage: "ganho", closed_at: "2026-08-10T00:00:00Z" }),
        lead({ id: "b", stage: "perdido", closed_at: "2026-08-11T00:00:00Z" }),
      ],
      "2026-08-01",
      "2026-08-21",
    );
    expect(comFechamento.taxaDeGanho).toBe(0.5);
  });
});

describe("KPI de campanha não inventa divisão", () => {
  const campanha = {
    id: "c1",
    name: "Meta agosto",
    channel: "meta",
    status: "ativa",
    starts_on: null,
    ends_on: null,
    budget: 3000,
    spent: 1500,
    goal: null,
    notes: null,
  };

  it("custo por lead e por cliente ficam nulos sem denominador", () => {
    const kpi = kpisDaCampanha(campanha, []);
    expect(kpi.custoPorLead).toBeNull();
    expect(kpi.custoPorCliente).toBeNull();
  });

  it("com leads e fechamento, a conta sai", () => {
    const kpi = kpisDaCampanha(campanha, [
      lead({ id: "a", campaign_id: "c1" }),
      lead({ id: "b", campaign_id: "c1", stage: "ganho", monthly_value: 1000, one_off_value: 2000 }),
      lead({ id: "c", campaign_id: "outra", stage: "ganho", monthly_value: 9000 }),
    ]);
    expect(kpi.leads).toBe(2);
    expect(kpi.ganhos).toBe(1);
    expect(kpi.custoPorLead).toBe(750);
    expect(kpi.custoPorCliente).toBe(1500);
    // 1000×12 + 2000 = 14000 sobre 1500 investido.
    expect(kpi.retornoAnual).toBeCloseTo(14000 / 1500, 5);
  });

  it("campanha sem investimento não vira retorno infinito", () => {
    const kpi = kpisDaCampanha({ ...campanha, spent: 0 }, [
      lead({ id: "a", campaign_id: "c1", stage: "ganho", monthly_value: 1000 }),
    ]);
    expect(kpi.retornoAnual).toBeNull();
    expect(kpi.custoPorLead).toBeNull();
  });
});

describe("o dado do funil não duplica nem se perde", () => {
  it("um lead por diagnóstico, garantido no banco", () => {
    // Puxar duas vezes criaria funil duplicado e a conversão passaria a mentir.
    expect(migration).toContain("commercial_leads_quiz_unico");
    expect(migration).toContain("where quiz_submission_id is not null");
  });

  it("mensalidade e entrada são campos separados", () => {
    // Somar os dois faria a meta de mensalidade nova mentir sempre que
    // houvesse projeto avulso junto.
    expect(migration).toContain("monthly_value numeric(12,2)");
    expect(migration).toContain("one_off_value numeric(12,2)");
  });

  it("o lead ganho aponta para o cliente criado — é a ponte com o Financeiro", () => {
    expect(migration).toContain("won_client_id uuid references public.profiles(id)");
  });

  it("meta é sempre do mês, e o banco recusa o resto", () => {
    expect(migration).toContain("date_trunc('month', period) = period");
    expect(migration).toContain("unique (period, metric)");
  });

  it("mudar de estágio registra a passagem", () => {
    // "Em que pé está" sem "como chegou aqui" vira adivinhação na semana
    // seguinte.
    expect(lib).toContain('kind: "stage"');
    expect(lib).toContain("from_stage: lead.stage");
  });
});

const kanban = ler("src/components/comercial/FunilKanban.tsx");
const pagina = ler("src/pages/AdminComercial.tsx");

describe("o funil é um kanban de arrastar, não uma lista", () => {
  it("o cartão é arrastável e a coluna recebe", () => {
    expect(kanban).toContain("useDraggable({");
    expect(kanban).toContain("useDroppable({ id: estagio })");
  });

  it("mouse e toque são sensores separados — senão o celular perde a rolagem", () => {
    // O cartão inteiro é arrastável: um sensor de ponteiro único capturaria
    // o toque e mataria o scroll da coluna.
    expect(kanban).toContain("useSensor(MouseSensor, { activationConstraint: { distance: 3 } })");
    expect(kanban).toContain("delay: 150, tolerance: 8");
  });

  it("o cartão sai do lugar antes da ida ao banco", () => {
    // Esperar a resposta faz o arrasto parecer quebrado, e quem arrasta
    // tenta de novo — criando duas gravações.
    expect(kanban).toContain("const moverNaTela = (leadId: string, destino: EstagioId)");
    expect(kanban).toContain('queryClient.setQueryData<Lead[]>(["comercial-leads"]');
  });

  it("soltar no mesmo lugar não abre o lead", () => {
    // O clique de soltar chega logo depois do fim do arrasto.
    expect(kanban).toContain("acabouDeArrastar");
  });

  it("ganho e perdido são faixa, não coluna", () => {
    // Coluna de fechado incha para sempre e empurra o trabalho de hoje para
    // fora da tela.
    expect(kanban).toContain("{arrastando && (");
    expect(kanban).toContain('id="ganho"');
    expect(kanban).toContain('id="perdido"');
  });

  it("fechar pede contexto antes de gravar", () => {
    expect(kanban).toContain("setFechamento({ lead, destino })");
    expect(kanban).toContain("Confirmar ganho");
    expect(kanban).toContain("motivo.trim().length < 3");
  });

  it("o lead atrasado sobe na coluna", () => {
    // O quadro tem que empurrar para a mão o que está parado.
    expect(kanban).toContain("const atrasoA = estaAtrasado(a, hoje) ? 0 : 1;");
  });

  it("dá para procurar dentro do funil", () => {
    expect(kanban).toContain("Buscar por nome ou empresa");
  });
});

describe("Comercial é área própria, não item de Gestão", () => {
  it("tem grupo próprio no menu, antes de Gestão", () => {
    expect(layout).toContain('label: "Comercial"');
    expect(layout.indexOf('label: "Comercial"')).toBeLessThan(
      layout.indexOf('label: "Gestão"'),
    );
  });

  it("cada área do departamento tem endereço próprio", () => {
    // Entrada de menu que cai sempre na mesma tela não é área.
    expect(layout).toContain('url: "/comercial/metas"');
    expect(layout).toContain('url: "/comercial/marketing"');
    expect(app).toContain('path="/comercial/:aba"');
  });

  it("as três entradas continuam restritas", () => {
    const grupo = layout.slice(
      layout.indexOf('label: "Comercial"'),
      layout.indexOf('label: "Gestão"'),
    );
    expect(grupo.split("soGestao: true").length - 1).toBe(3);
  });

  it("a aba sai da URL, então o voltar do navegador funciona", () => {
    expect(pagina).toContain("useParams<{ aba?: string }>()");
    expect(pagina).toContain('navigate(proxima === "funil" ? "/comercial" : `/comercial/${proxima}`)');
  });
});
