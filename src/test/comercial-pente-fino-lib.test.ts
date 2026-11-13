import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pente-fino do Comercial (01/11/2026): as regras da biblioteca que mostravam
 * dado errado como se fosse real.
 *
 * O Supabase falso abaixo guarda linhas por tabela e aplica de verdade os
 * filtros pedidos, o teto de 1.000 linhas do PostgREST, o índice único de
 * `quiz_submission_id` e a recusa silenciosa da RLS (update sem erro e sem
 * linha). Falhas são ligadas por "tabela:operação".
 */

type Linha = Record<string, unknown>;
type Filtro = (l: Linha) => boolean;

const banco = vi.hoisted(() => ({
  tabelas: {} as Record<string, Array<Record<string, unknown>>>,
  falhas: {} as Record<string, { message: string }>,
  rlsRecusa: new Set<string>(),
  updates: [] as Array<{ tabela: string; corpo: Record<string, unknown> }>,
  inserts: [] as Array<{ tabela: string; corpo: unknown }>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const filtros: Filtro[] = [];
    let op: "select" | "update" | "insert" = "select";
    let corpo: unknown = null;
    let limite = Infinity;
    let um = false;
    const linhas = () => (banco.tabelas[tabela] ||= []);
    const executar = (): { data: unknown; error: { message: string } | null } => {
      const falha = banco.falhas[`${tabela}:${op}`];
      if (falha) return { data: null, error: falha };
      if (op === "insert") {
        const novas = (Array.isArray(corpo) ? corpo : [corpo]) as Linha[];
        banco.inserts.push({ tabela, corpo });
        if (tabela === "commercial_leads") {
          const ja = new Set(linhas().map((l) => l.quiz_submission_id).filter(Boolean));
          if (novas.some((n) => n.quiz_submission_id && ja.has(n.quiz_submission_id))) {
            return { data: null, error: { message: "duplicate key value violates unique constraint" } };
          }
        }
        linhas().push(...novas);
        return { data: novas.map((n, i) => ({ id: n.id || `novo-${i}` })), error: null };
      }
      const alvo = linhas().filter((l) => filtros.every((f) => f(l)));
      if (op === "update") {
        banco.updates.push({ tabela, corpo: corpo as Record<string, unknown> });
        if (banco.rlsRecusa.has(tabela)) return { data: [], error: null };
        alvo.forEach((l) => Object.assign(l, corpo as Linha));
        return { data: alvo.map((l) => ({ id: l.id })), error: null };
      }
      // O PostgREST devolve no máximo 1.000 linhas por leitura.
      const lidas = alvo.slice(0, Math.min(limite, 1000));
      if (um) return { data: lidas[0] || null, error: null };
      return { data: lidas, error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q,
      update: (c: unknown) => { op = "update"; corpo = c; return q; },
      insert: (c: unknown) => { op = "insert"; corpo = c; return q; },
      eq: (c: string, v: unknown) => { filtros.push((l) => l[c] === v); return q; },
      is: (c: string, v: null) => { filtros.push((l) => (l[c] ?? null) === v); return q; },
      not: (c: string, o: string, v: null) => { if (o === "is") filtros.push((l) => (l[c] ?? null) !== v); return q; },
      in: (c: string, vs: unknown[]) => { filtros.push((l) => vs.includes(l[c])); return q; },
      gte: (c: string, v: string) => { filtros.push((l) => String(l[c]) >= v); return q; },
      lt: (c: string, v: string) => { filtros.push((l) => String(l[c]) < v); return q; },
      order: () => q,
      limit: (n: number) => { limite = n; return q; },
      maybeSingle: () => { um = true; return q; },
      single: () => { um = true; return q; },
      then: (ok: (r: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(executar()).then(ok, erro),
    };
    return q;
  };
  return {
    supabase: {
      from: (t: string) => consulta(t),
      auth: { getUser: () => Promise.resolve({ data: { user: { id: "u1" } } }) },
    },
  };
});

import {
  ErroDeLeitura,
  clientesRecorrentesDoMes,
  diaEmSaoPaulo,
  importarLeadsDoQuiz,
  linhasDeMetaDoMes,
  moverLead,
  realizadoDoMes,
  recebidoDoMes,
  receitaDoMes,
  resumoDoFunil,
  salvarDadosDaEmpresaDoLead,
  salvarLead,
  type Lead,
} from "@/lib/comercial";
import { situacaoDaLinha } from "@/components/clientes-propostas/propostasDaCarteira";

const pagina = readFileSync("src/pages/AdminComercial.tsx", "utf8");

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

beforeEach(() => {
  banco.tabelas = {};
  banco.falhas = {};
  banco.rlsRecusa = new Set();
  banco.updates = [];
  banco.inserts = [];
});

describe("1. a Visão geral mostra os clientes recorrentes do Financeiro", () => {
  it("a linha de recorrentes leva a contagem lida, não 0", () => {
    const linhas = linhasDeMetaDoMes({
      metas: [{ metric: "clientes_recorrentes", target: 10 }],
      leads: [],
      periodo: "2026-10-01",
      receitaFinanceiro: 0,
      clientesRecorrentes: 7,
    });
    const recorrentes = linhas.find((l) => l.id === "clientes_recorrentes");
    expect(recorrentes).toMatchObject({ alvo: 10, feito: 7 });
  });

  it("a página passa a contagem para a Visão geral", () => {
    const chamada = pagina.slice(pagina.indexOf("<VisaoGeral"), pagina.indexOf("/>", pagina.indexOf("<VisaoGeral")));
    expect(chamada).toContain("clientesRecorrentes={clientesRecorrentes}");
  });
});

describe("2. o mês do ganho e do lead é o de São Paulo", () => {
  // 31/10 às 22h30 em São Paulo = 2026-11-01T01:30Z.
  const ganhoNaVirada = lead({ stage: "ganho", closed_at: "2026-11-01T01:30:00Z", monthly_value: 2000 });
  const criadoNaVirada = lead({ id: "l2", stage: "novo", created_at: "2026-11-01T02:00:00Z" });

  it("o dia do instante é o de São Paulo; data pura passa como está", () => {
    expect(diaEmSaoPaulo("2026-11-01T01:30:00Z")).toBe("2026-10-31");
    expect(diaEmSaoPaulo("2026-11-01T03:00:00+00:00")).toBe("2026-11-01");
    expect(diaEmSaoPaulo("2026-10-15")).toBe("2026-10-15");
    expect(diaEmSaoPaulo("lixo")).toBeNull();
    expect(diaEmSaoPaulo(null)).toBeNull();
  });

  it("realizadoDoMes conta o ganho de 31/10 às 22h30 em outubro, não em novembro", () => {
    const leads = [ganhoNaVirada, criadoNaVirada];
    const base = { leads, receitaFinanceiro: 0 };
    expect(realizadoDoMes({ ...base, metrica: "fechamentos", periodo: "2026-10-01" })).toBe(1);
    expect(realizadoDoMes({ ...base, metrica: "mrr_novo", periodo: "2026-10-01" })).toBe(2000);
    expect(realizadoDoMes({ ...base, metrica: "fechamentos", periodo: "2026-11-01" })).toBe(0);
    // O lead criado 31/10 às 23h (02h UTC de 01/11) é de outubro.
    expect(realizadoDoMes({ ...base, metrica: "leads", periodo: "2026-10-01" })).toBe(2);
    expect(realizadoDoMes({ ...base, metrica: "leads", periodo: "2026-11-01" })).toBe(0);
  });

  it("resumoDoFunil põe o ganho da virada no mês certo", () => {
    expect(resumoDoFunil([ganhoNaVirada], "2026-10-01", "2026-11-01T12:00:00Z").ganhosNoMes).toBe(1);
    expect(resumoDoFunil([ganhoNaVirada], "2026-11-01", "2026-11-01T12:00:00Z").ganhosNoMes).toBe(0);
  });

  it("a página não compara mais o texto UTC do created_at com o mês", () => {
    expect(pagina).not.toContain('(l.created_at || "").slice(0, 7)');
    expect(pagina).toContain("diaEmSaoPaulo(l.created_at)");
  });
});

describe("3. falha no Financeiro não vira R$ 0", () => {
  it("receitaDoMes e clientesRecorrentesDoMes sobem ErroDeLeitura", async () => {
    banco.falhas["billing:select"] = { message: "permission denied" };
    await expect(receitaDoMes("2026-10-01")).rejects.toBeInstanceOf(ErroDeLeitura);
    await expect(clientesRecorrentesDoMes("2026-10-01")).rejects.toBeInstanceOf(ErroDeLeitura);
  });

  it("sem falha, continuam somando", async () => {
    banco.tabelas.billing = [
      { amount: 1000, status: "paid", type: "renewal", client_id: "c1", paid_date: "2026-10-05", due_date: "2026-10-05" },
      { amount: 500, status: "paid", type: "one_off", client_id: "c2", paid_date: "2026-10-20", due_date: "2026-10-20" },
    ];
    await expect(receitaDoMes("2026-10-01")).resolves.toBe(1500);
    await expect(clientesRecorrentesDoMes("2026-10-01")).resolves.toBe(1);
  });

  it("o recebido do mês sai separado por origem, na régua do Financeiro", async () => {
    banco.tabelas.billing = [
      // Mensalidades: duas do mesmo cliente contam um recorrente só.
      { amount: 1000, status: "paid", type: "renewal", client_id: "c1", paid_date: "2026-10-05", due_date: "2026-10-05" },
      { amount: 800, status: "paid", type: "renewal", client_id: "c1", paid_date: "2026-10-28", due_date: "2026-10-28" },
      // Parcial: entra só o que foi pago.
      { amount: 900, paid_amount: 400, status: "partial", type: "renewal", client_id: "c2", paid_date: "2026-10-10", due_date: "2026-10-10" },
      // Pago sem data de pagamento: vale o mês do vencimento.
      { amount: 300, status: "paid", type: "one_off", client_id: "c3", paid_date: null, due_date: "2026-10-15" },
      // Vencia em outubro, pago em novembro: é dinheiro de novembro.
      { amount: 700, status: "paid", type: "renewal", client_id: "c4", paid_date: "2026-11-02", due_date: "2026-10-30" },
      // Fora da conta: em aberto, recarga de anúncio e dólar do Freela.
      { amount: 600, status: "pending", type: "renewal", client_id: "c5", paid_date: null, due_date: "2026-10-12" },
      { amount: 2000, status: "paid", type: "ads_recharge", client_id: "c1", paid_date: "2026-10-06", due_date: "2026-10-06" },
      { amount: 150, status: "paid", type: "freela", client_id: null, currency: "USD", paid_date: "2026-10-07", due_date: "2026-10-07" },
    ];
    banco.tabelas.payment_installments = [
      { amount: 1347, paid_amount: 900, status: "partial", paid_date: "2026-10-13", due_date: "2026-10-13" },
      { amount: 697, status: "paid", paid_date: "2026-09-28", due_date: "2026-09-28" },
    ];
    await expect(recebidoDoMes("2026-10-01")).resolves.toEqual({
      mensalidades: 2200,
      avulsos: 300,
      projetos: 900,
      total: 3400,
      clientesRecorrentes: 2,
    });
  });

  it("a tela conta essas leituras no aviso de erro", () => {
    const linha = pagina.slice(pagina.indexOf("const leituraFalhou"), pagina.indexOf(";", pagina.indexOf("const leituraFalhou")));
    expect(linha).toContain("erroNaReceita");
    expect(linha).toContain("erroNosRecorrentes");
  });
});

describe("4. trazer do diagnóstico depois de 1.000 leads", () => {
  const quiz = (id: string) => ({ id, lead_name: `Pessoa ${id}`, lead_email: null, lead_whatsapp: null, lead_company: null, submitted_at: "2026-10-30T12:00:00Z" });

  it("com 1.200 leads de quiz, só traz os novos (sem repetido que derrube o lote)", async () => {
    banco.tabelas.quiz_submissions = [quiz("q1"), quiz("q2"), quiz("q3")];
    banco.tabelas.commercial_leads = [
      ...Array.from({ length: 1200 }, (_, i) => ({ id: `antigo${i}`, quiz_submission_id: `velho${i}` })),
      // O lead de q1 já existe, mas está depois da milésima linha.
      { id: "jaTem", quiz_submission_id: "q1" },
    ];
    await expect(importarLeadsDoQuiz()).resolves.toBe(2);
    const gravados = banco.inserts.find((i) => i.tabela === "commercial_leads")!.corpo as Linha[];
    expect(gravados.map((g) => g.quiz_submission_id)).toEqual(["q2", "q3"]);
  });

  it("leitura do quiz, dos existentes ou gravação que falha sobe erro, não '0 novos'", async () => {
    banco.tabelas.quiz_submissions = [quiz("q1")];
    banco.falhas["quiz_submissions:select"] = { message: "falhou" };
    await expect(importarLeadsDoQuiz()).rejects.toThrow();

    banco.falhas = { "commercial_leads:select": { message: "falhou" } };
    await expect(importarLeadsDoQuiz()).rejects.toThrow();

    banco.falhas = { "commercial_leads:insert": { message: "falhou" } };
    await expect(importarLeadsDoQuiz()).rejects.toThrow();
  });
});

describe("5. editar o lead não devolve a etapa antiga", () => {
  it("salvarLead sem stage não manda stage na edição", async () => {
    banco.tabelas.commercial_leads = [{ id: "l1", stage: "ganho", name: "Antigo" }];
    await expect(salvarLead({ id: "l1", name: "Novo nome", notes: "uma nota" })).resolves.toBe("l1");
    expect(banco.updates[0].corpo).not.toHaveProperty("stage");
    expect(banco.tabelas.commercial_leads[0].stage).toBe("ganho");
  });

  it("a janela do lead só manda stage na criação", () => {
    const salvar = pagina.slice(pagina.indexOf("const id = await salvarLead({"), pagina.indexOf("} as never);", pagina.indexOf("const id = await salvarLead({")));
    expect(salvar).not.toContain("stage: lead?.stage");
    expect(salvar).toContain('...(lead ? {} : { stage: "novo" })');
  });
});

describe("6. mover pela janela salva a edição pendente antes", () => {
  it("mover salva mantendo aberto e não move se não salvou", () => {
    const mover = pagina.slice(pagina.indexOf("const mover = async (para: EstagioId)"), pagina.indexOf("const temDadosDaEmpresa"));
    expect(mover).toContain("if (sujo)");
    expect(mover).toContain("await salvar({ manterAberto: true })");
    expect(mover.indexOf("salvar({ manterAberto: true })")).toBeLessThan(mover.indexOf("moverLead("));
  });
});

describe("8. mover recusado pela RLS não vira sucesso", () => {
  it("update com 0 linhas devolve false e não grava evento", async () => {
    banco.tabelas.commercial_leads = [{ id: "l1", stage: "proposta" }];
    banco.rlsRecusa.add("commercial_leads");
    await expect(moverLead({ lead: lead({}), paraEstagio: "negociacao" as never })).resolves.toBe(false);
    expect(banco.inserts.filter((i) => i.tabela === "commercial_lead_events")).toHaveLength(0);
  });

  it("evento que falha devolve false", async () => {
    banco.tabelas.commercial_leads = [{ id: "l1", stage: "proposta" }];
    banco.falhas["commercial_lead_events:insert"] = { message: "falhou" };
    await expect(moverLead({ lead: lead({}), paraEstagio: "negociacao" as never })).resolves.toBe(false);
  });

  it("movimento aceito devolve true e registra a passagem", async () => {
    banco.tabelas.commercial_leads = [{ id: "l1", stage: "proposta" }];
    await expect(moverLead({ lead: lead({}), paraEstagio: "negociacao" as never })).resolves.toBe(true);
    expect(banco.tabelas.commercial_leads[0].stage).toBe("negociacao");
    expect(banco.inserts.filter((i) => i.tabela === "commercial_lead_events")).toHaveLength(1);
  });
});

describe("9. dados da empresa pelo lead", () => {
  it("não renomeia a ficha da empresa", async () => {
    banco.tabelas.commercial_leads = [{ id: "l1", organization_id: "o1", company: "" }];
    banco.tabelas.commercial_organizations = [{ id: "o1", name: "Padaria do Zé Ltda", city: null }];
    await expect(salvarDadosDaEmpresaDoLead("l1", { city: " Curitiba " })).resolves.toBe(true);
    const update = banco.updates.find((u) => u.tabela === "commercial_organizations")!;
    expect(update.corpo).not.toHaveProperty("name");
    expect(banco.tabelas.commercial_organizations[0]).toMatchObject({ name: "Padaria do Zé Ltda", city: "Curitiba" });
  });

  it("leitura do lead que falha devolve false, sem dizer que salvou", async () => {
    banco.falhas["commercial_leads:select"] = { message: "falhou" };
    await expect(salvarDadosDaEmpresaDoLead("l1", { city: "Curitiba" })).resolves.toBe(false);
  });
});

describe("12. a data da proposta é o dia de São Paulo", () => {
  it("aceita, vista ou enviada em 31/10 às 22h não aparece como 01/11", () => {
    const base = { enviada_em: null, vista_em: null, aceita_em: null, validade_ate: null };
    expect(situacaoDaLinha({ ...base, status: "aceita", aceita_em: "2026-11-01T01:00:00Z" })).toBe("Aceita em 31/10/2026");
    expect(situacaoDaLinha({ ...base, status: "vista", vista_em: "2026-11-01T01:00:00Z" })).toBe("Vista em 31/10/2026");
    expect(situacaoDaLinha({ ...base, status: "enviada", enviada_em: "2026-11-01T01:00:00Z" })).toBe("Enviada em 31/10/2026, não aberta");
  });
});
