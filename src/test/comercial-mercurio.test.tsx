import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Comercial com o Mercúrio (25/10/2026): a Caixa (só quem avançou ou fechou, com o telefone e o WhatsApp para
 * continuar), o agente no lead (chave do Mercúrio, sugestões com prova que gravam no campo certo), as campanhas
 * da Meta ligadas com a chave do Mercúrio, o filtro do funil e a área Comercial no sino.
 */

type Chamada = { tabela: string; op: string; corpo?: unknown; filtros: Array<[string, unknown]> };
const mock = vi.hoisted(() => ({ dados: {} as Record<string, unknown>, chamadas: [] as Chamada[] }));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const c: Chamada = { tabela, op: "select", filtros: [] };
    const b: any = {};
    for (const m of ["select", "order", "limit", "neq", "or", "in", "is", "not"]) b[m] = (...a: unknown[]) => { if (m === "in" || m === "or") c.filtros.push([m, a]); return b; };
    b.eq = (k: string, v: unknown) => { c.filtros.push([k, v]); return b; };
    b.update = (corpo: unknown) => { c.op = "update"; c.corpo = corpo; mock.chamadas.push(c); return b; };
    b.insert = (corpo: unknown) => { c.op = "insert"; c.corpo = corpo; mock.chamadas.push(c); return b; };
    b.upsert = (corpo: unknown) => { c.op = "upsert"; c.corpo = corpo; mock.chamadas.push(c); return b; };
    const resultado = () => ({ data: c.op === "select" ? (mock.dados[tabela] ?? []) : null, error: null });
    b.maybeSingle = () => Promise.resolve({ data: Array.isArray(mock.dados[tabela]) ? (mock.dados[tabela] as unknown[])[0] ?? null : mock.dados[tabela] ?? null, error: null });
    b.then = (ok: any, erro: any) => Promise.resolve(resultado()).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      from: (t: string) => consulta(t),
      auth: { getUser: () => Promise.resolve({ data: { user: { id: "u-eu" } } }) },
      rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import {
  dadosLegiveis,
  destinoDoFato,
  linkDeLigar,
  linkDoWhatsapp,
  mensagemDeContinuidade,
  numeroParaWhatsapp,
  type FatoDoLead,
  type Lead,
} from "@/lib/comercial";
import CaixaDoComercial from "@/components/comercial/CaixaDoComercial";
import AgenteDoLead from "@/components/comercial/AgenteDoLead";
import CampanhasDaMeta, { filtrarCampanhasDaMeta } from "@/components/comercial/CampanhasDaMeta";
import ConversaDoLead, { quemEscreveu } from "@/components/comercial/ConversaDoLead";
import { passaNoFiltroDeQuemAtende } from "@/components/comercial/FunilKanban";
import { filtrarArea } from "@/hooks/useAvisosPorArea";
import { categoriaDoAviso, rotuloDoLink, rotuloDoTipoDoAviso } from "@/lib/avisos/rotulos";

const LEAD_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";

const lead = (extra: Partial<Lead> = {}): Lead =>
  ({ id: LEAD_ID, name: "Ana Souza", company: "Clínica Sorriso", email: null, whatsapp: null, origin: "prospeccao", campaign_id: null, quiz_submission_id: null, stage: "contato", monthly_value: 0, one_off_value: 0, owner_id: null, next_action: null, next_action_at: null, notes: null, lost_reason: null, won_client_id: null, closed_at: null, created_at: "2026-10-20T10:00:00Z", expected_close_date: null, organization_id: ORG_ID, contact_id: null, classe: null, qualificacao: {}, ...extra }) as Lead;

const montar = (filho: ReturnType<typeof h>) => render(h(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, filho));
const chamadas = (tabela: string, op: string) => mock.chamadas.filter((c) => c.tabela === tabela && c.op === op);

beforeEach(() => {
  mock.dados = {};
  mock.chamadas = [];
});

describe("regras do comercial com o Mercúrio", () => {
  it("o WhatsApp sai só com dígitos e o DDI 55 quando falta; número curto não vira link", () => {
    expect(numeroParaWhatsapp("(41) 99999-8888")).toBe("5541999998888");
    expect(numeroParaWhatsapp("+55 41 3333-2222")).toBe("554133332222");
    expect(numeroParaWhatsapp("0055 41 99999-8888")).toBe("5541999998888");
    expect(numeroParaWhatsapp("1234")).toBe("");
    expect(linkDoWhatsapp("41 99999-8888", "Oi, Ana!")).toBe("https://wa.me/5541999998888?text=Oi%2C%20Ana!");
    expect(linkDoWhatsapp("", "x")).toBe("");
    expect(linkDeLigar("41 99999-8888")).toBe("tel:+5541999998888");
    expect(mensagemDeContinuidade("Ana Souza")).toContain("Oi, Ana!");
  });

  it("os dados viram linhas legíveis e o fato sabe onde gravar", () => {
    expect(dadosLegiveis({ valor_mensal: 1500, servicos: ["tráfego", "site"], vazio: "", aceitou: true })).toEqual([
      { chave: "Valor mensal", valor: "1500" },
      { chave: "Servicos", valor: "tráfego, site" },
      { chave: "Aceitou", valor: "sim" },
    ]);
    expect(destinoDoFato("whatsapp")).toEqual({ tabela: "commercial_leads", coluna: "whatsapp" });
    expect(destinoDoFato("instagram")).toEqual({ tabela: "commercial_organizations", coluna: "instagram" });
    expect(destinoDoFato("qualificacao.dor")).toEqual({ tabela: "qualificacao", chave: "dor" });
    expect(destinoDoFato("qualquer_coisa")).toBeNull();
  });

  it("o filtro do funil separa Mercúrio e equipe; a busca de campanha acha pelo nome e pelo cliente", () => {
    expect(passaNoFiltroDeQuemAtende({ agente_slug: "mercurio" }, "mercurio")).toBe(true);
    expect(passaNoFiltroDeQuemAtende({ agente_slug: null }, "mercurio")).toBe(false);
    expect(passaNoFiltroDeQuemAtende({ agente_slug: "mercurio" }, "equipe")).toBe(false);
    expect(passaNoFiltroDeQuemAtende({}, "todos")).toBe(true);
    const lista = [{ campaign_id: "1", nome: "Black Friday", status: "ACTIVE", cliente: "Stop" }, { campaign_id: "2", nome: "Leads Aceleriq", status: "PAUSED", cliente: "" }];
    expect(filtrarCampanhasDaMeta(lista, "stop").map((c) => c.campaign_id)).toEqual(["1"]);
    expect(filtrarCampanhasDaMeta(lista, "").length).toBe(2);
  });

  it("a área Comercial do sino pega os tipos do comercial e o link /comercial; o Painel fica sem eles", () => {
    const q = { or: vi.fn().mockReturnThis(), not: vi.fn().mockReturnThis() };
    filtrarArea(q, "comercial");
    expect(q.or).toHaveBeenCalledWith("notification_type.in.(commercial,commercial_caixa),link.like./comercial%");
    const p = { or: vi.fn().mockReturnThis(), not: vi.fn().mockReturnThis() };
    filtrarArea(p, "painel");
    expect(p.not).toHaveBeenCalledWith("notification_type", "in", "(commercial,commercial_caixa)");
    expect(p.or).toHaveBeenCalledWith("link.is.null,link.not.like./comercial%");
    expect(categoriaDoAviso("commercial_caixa")).toBe("comercial");
    expect(rotuloDoTipoDoAviso("commercial_caixa")).toBe("Caixa do comercial");
    expect(rotuloDoLink("/comercial/caixa?item=x")).toBe("Abrir na Caixa do comercial");
  });

  it("a conversa diz quem escreveu", () => {
    const base = { id: "m", lead_id: LEAD_ID, canal: "whatsapp", texto: "oi", enviada_em: "", autor_id: null };
    expect(quemEscreveu({ ...base, direcao: "entrada", operador_slug: null }, "Ana")).toBe("Ana");
    expect(quemEscreveu({ ...base, direcao: "saida", operador_slug: "mercurio" }, "Ana")).toBe("Mercúrio");
    expect(quemEscreveu({ ...base, direcao: "saida", operador_slug: null }, "Ana")).toBe("Equipe");
  });
});

const itemDaCaixa = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  lead_id: LEAD_ID,
  tipo: "avancou",
  resumo: "Quer tráfego para a clínica; pediu proposta até sexta.",
  proximo_passo: "Mandar a proposta",
  telefone: "(41) 99999-8888",
  dados: { valor_mensal: 1500 },
  operador_slug: "mercurio",
  situacao: "nova",
  created_at: "2026-10-25T12:00:00Z",
  lead: { id: LEAD_ID, name: "Ana Souza", company: "Clínica Sorriso", whatsapp: null, stage: "proposta" },
  ...extra,
});

describe("Caixa do comercial (tela)", () => {
  it("mostra só a situação escolhida, com WhatsApp, ligar, abrir o lead e assumir", async () => {
    mock.dados.commercial_handoffs = [itemDaCaixa("h1"), itemDaCaixa("h2", { tipo: "fechou", situacao: "concluida", resumo: "Fechou o plano" })];
    const abrir = vi.fn();
    montar(h(CaixaDoComercial, { leads: [lead()], onAbrirLead: abrir }));
    const item = await screen.findByText(/Quer tráfego para a clínica/);
    const li = item.closest("li") as HTMLElement;
    expect(within(li).getByText("Avançou")).toBeTruthy();
    expect(within(li).getByText(/Valor mensal/)).toBeTruthy();
    const whats = within(li).getByRole("link", { name: /Continuar no WhatsApp/ }) as HTMLAnchorElement;
    expect(whats.href).toContain("https://wa.me/5541999998888?text=");
    expect((within(li).getByRole("link", { name: /Ligar para/ }) as HTMLAnchorElement).href).toBe("tel:+5541999998888");
    expect(screen.queryByText("Fechou o plano")).toBeNull();
    fireEvent.click(within(li).getByRole("button", { name: /Abrir o lead/ }));
    expect(abrir).toHaveBeenCalledWith(expect.objectContaining({ id: LEAD_ID }));
    fireEvent.click(within(li).getByRole("button", { name: "Assumir" }));
    await waitFor(() => expect(chamadas("commercial_handoffs", "update").length).toBe(1));
    expect(chamadas("commercial_handoffs", "update")[0].corpo).toMatchObject({ situacao: "assumida", assumida_por: "u-eu" });
  });

  it("o link do sino abre na situação do item e o destaca", async () => {
    mock.dados.commercial_handoffs = [itemDaCaixa("h1"), itemDaCaixa("h2", { tipo: "fechou", situacao: "concluida", resumo: "Fechou o plano" })];
    montar(h(CaixaDoComercial, { leads: [lead()], onAbrirLead: vi.fn(), itemDestacado: "h2" }));
    const item = await screen.findByText("Fechou o plano");
    const li = item.closest("li") as HTMLElement;
    expect(li.getAttribute("data-item-da-caixa")).toBe("h2");
    expect(li.className).toContain("ring-1");
    expect(within(li).getByText("Fechou")).toBeTruthy();
  });
});

describe("agente no lead (tela)", () => {
  const sugestao: FatoDoLead = { id: "f1", lead_id: LEAD_ID, organization_id: null, campo: "whatsapp", valor: "41 98888-7777", evidencia: "web.cited-claim", detalhe: "O site da clínica mostra este WhatsApp no rodapé", fonte_url: "https://clinica.test", situacao: "sugestao", operador_slug: "mercurio", created_at: "2026-10-25T12:00:00Z" };

  it("Confirmar grava o valor no campo do lead e marca o fato; a chave liga o Mercúrio", async () => {
    mock.dados.commercial_facts = [sugestao, { ...sugestao, id: "f2", campo: "instagram", valor: "@clinicasorriso", situacao: "gravado", detalhe: "O perfil mostra o e-mail da ficha" }];
    const aoMudar = vi.fn();
    montar(h(AgenteDoLead, { lead: lead(), aoMudar }));
    expect(await screen.findByText("O site da clínica mostra este WhatsApp no rodapé")).toBeTruthy();
    expect(screen.getByText("@clinicasorriso")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Confirmar WhatsApp: 41 98888-7777/ }));
    await waitFor(() => expect(chamadas("commercial_facts", "update").length).toBe(1));
    expect(chamadas("commercial_leads", "update")[0].corpo).toEqual({ whatsapp: "41 98888-7777" });
    expect(chamadas("commercial_facts", "update")[0].corpo).toMatchObject({ situacao: "gravado", decidido_por: "u-eu" });

    fireEvent.click(screen.getByLabelText("Mercúrio atende este lead"));
    await waitFor(() => expect(chamadas("commercial_leads", "update").some((c) => (c.corpo as Record<string, unknown>).agente_slug === "mercurio")).toBe(true));
  });

  it("a conversa registra uma mensagem enviada por fora", async () => {
    mock.dados.commercial_lead_messages = [{ id: "m1", lead_id: LEAD_ID, direcao: "entrada", canal: "whatsapp", texto: "Quanto custa?", enviada_em: "2026-10-25T12:00:00Z", operador_slug: null, autor_id: null }];
    montar(h(ConversaDoLead, { leadId: LEAD_ID, nomeDoLead: "Ana Souza" }));
    expect(await screen.findByText("Quanto custa?")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Texto da mensagem"), { target: { value: "Mandei a proposta por e-mail" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar mensagem" }));
    await waitFor(() => expect(chamadas("commercial_lead_messages", "insert").length).toBe(1));
    expect(chamadas("commercial_lead_messages", "insert")[0].corpo).toMatchObject({ lead_id: LEAD_ID, direcao: "saida", canal: "whatsapp", texto: "Mandei a proposta por e-mail", autor_id: "u-eu" });
  });
});

describe("campanhas da Meta e a chave do Mercúrio (tela)", () => {
  it("liga a campanha da Meta pela busca e liga o Mercúrio", async () => {
    mock.dados.ads_campaigns = [
      { campaign_id: "120", name: "Leads Aceleriq Outubro", effective_status: "ACTIVE", client_id: "c1" },
      { campaign_id: "121", name: "Black Friday Stop", effective_status: "PAUSED", client_id: "c2" },
    ];
    mock.dados.profiles = [{ id: "c1", company_name: "Aceleriq" }, { id: "c2", company_name: "Stop" }];
    const aoMudar = vi.fn();
    const aoMudarMercurio = vi.fn();
    montar(h(CampanhasDaMeta, { selecionadas: [], aoMudar, mercurioAtivo: false, aoMudarMercurio }));
    expect(await screen.findByText("Leads Aceleriq Outubro")).toBeTruthy();
    expect(screen.getByText("pausada · Stop")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Buscar campanha da Meta"), { target: { value: "outubro" } });
    expect(screen.queryByText("Black Friday Stop")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ligar Leads Aceleriq Outubro" }));
    expect(aoMudar).toHaveBeenCalledWith(["120"]);
    fireEvent.click(screen.getByLabelText("O Mercúrio atende os leads desta campanha"));
    expect(aoMudarMercurio).toHaveBeenCalledWith(true);
  });
});
