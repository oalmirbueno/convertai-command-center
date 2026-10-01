import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente PRO3 (30/09): a proposta mora em Clientes (pedido do dono), não no
 * seletor de mesas. Cobre: a Proposta fora do seletor (e o caminho de volta
 * "Clientes › Propostas" na casca), a entrada por Clientes (lista, filtro,
 * Nova proposta numa janela central), a criação para cliente novo (lead que
 * já é cliente, lead sem ficha e o cadastro na hora sem mandar nada ao
 * prospect) e o upsell pré-carregado (o que o cliente já tem e os resultados
 * reais, sem número inventado), mais o conselho em Clientes.
 */

configure({ asyncUtilTimeout: 8000 });

const mock = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), tabelas: {} as Record<string, unknown>, selects: [] as Array<{ tabela: string; campos: string }> }));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["eq", "neq", "not", "in", "is", "or", "contains", "overlaps", "gte", "lt", "lte", "gt", "order", "limit", "range", "update", "insert", "like"]) b[m] = () => b;
    b.select = (campos: string) => {
      mock.selects.push({ tabela, campos });
      return b;
    };
    const primeiro = () => ({ data: Array.isArray(dados) ? (dados[0] === undefined ? null : dados[0]) : dados, error: null });
    b.maybeSingle = () => Promise.resolve(primeiro());
    b.single = () => Promise.resolve(primeiro());
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null }).then(ok, erro);
    return b;
  };
  return { supabase: { functions: { invoke: mock.invoke }, rpc: mock.rpc, from: (t: string) => consulta(t) } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));

import { MESAS, MESAS_FORA_DO_SELETOR, enderecoDaMesa } from "@/components/mesa-foto/TrocaDeMesas";
import SeletorDeMesa from "@/components/sistema/SeletorDeMesa";
import { CaminhoDasPropostas } from "@/pages/MesaProposta";
import AreaDePropostas from "@/components/clientes-propostas/AreaDePropostas";
import NovaProposta from "@/components/clientes-propostas/NovaProposta";
import PropostaDocumento from "@/components/mesa-proposta/PropostaDocumento";
import { normalizarProposta } from "@/components/mesa-proposta/propostaApi";
import { contextoDoClienteParaConselho } from "@/components/clientes-propostas/PropostasDoCliente";
import { enderecoDaProposta, filtrarCarteira, linhaDaCarteira, situacaoDaLinha, valorDaLinha } from "@/components/clientes-propostas/propostasDaCarteira";
import { blocoDoTipo, blocosParaMostrar, comBloco, conteudoDoModelo, MODELO_PADRAO_ACELERIQ, TIPOS_DE_BLOCO } from "../../supabase/functions/_shared/proposta-modelo";
import { camposDaProposta, camposDoBloco } from "../../supabase/functions/_shared/proposta-comercial";
import {
  blocoJaTem,
  contextoDoUpsell,
  lerUpsell,
  materialDoUpsell,
  montarUpsell,
  resultadosDoEstado,
  servicosDoCadastro,
  SERVICOS_DA_CASA,
  textoDoPlano,
  type EstadoParaUpsell,
} from "../../supabase/functions/mesa-proposta/modulos/proposta-upsell";
import { planoDoCliente, retratoDoCliente } from "../../supabase/functions/mesa-proposta/upsell";
import { alvosDaProposta, normalizarAcoesDaProposta } from "../../supabase/functions/mesa-proposta/acoes-da-proposta";
import { elencoPadrao, grupoDaOrigem } from "../../supabase/functions/conselho/modulos/conselho";
import { SERVICE_LABELS } from "@/lib/cycleDefs";

const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
const CLIENTE = "11111111-1111-4111-8111-111111111111";
const OUTRO = "33333333-3333-4333-8333-333333333333";
const PROPOSTA = "22222222-2222-4222-8222-222222222222";
const hojeMais = (dias: number) => new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);

function Endereco() {
  const l = useLocation();
  return h("output", { "data-testid": "endereco" }, `${l.pathname}${l.search}`);
}

function montar(filho: any, endereco = "/clientes") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, { initialEntries: [endereco] }, h(Routes, null, h(Route, { path: "*", element: h("div", null, filho, h(Endereco)) })))));
}

const chamadasDe = (funcao: string, acao: string) => mock.invoke.mock.calls.filter((c) => c[0] === funcao && c[1] && c[1].body && c[1].body.acao === acao);

beforeEach(() => {
  mock.invoke.mockReset();
  mock.rpc.mockReset();
  mock.rpc.mockResolvedValue({ data: {}, error: null });
  mock.selects = [];
  mock.tabelas = {};
  window.localStorage.clear();
});

// ------------------------------------------------------------------ 1) fora do seletor

describe("a Proposta fora do seletor de mesas", () => {
  it("não está em MESAS (nem no Alt+M e nos números), mas o endereço da rota continua", () => {
    expect(MESAS.map((m) => m.valor)).not.toContain("proposta");
    expect(MESAS_FORA_DO_SELETOR.map((m) => m.valor)).toEqual(["proposta"]);
    expect(enderecoDaMesa("proposta", CLIENTE)).toBe(`/mesa-proposta?client=${CLIENTE}`);
    expect(ler("src/App.tsx")).toContain('path="/mesa-proposta"');
  });

  it("o seletor aberto não lista a Proposta", async () => {
    montar(h(SeletorDeMesa, { atual: "mesa", clientId: CLIENTE, marcaId: null }), `/mesa?client=${CLIENTE}`);
    fireEvent.click(screen.getByRole("button", { name: /Mesa aberta: Mesa/ }));
    const lista = await screen.findByRole("navigation", { name: "Trocar de mesa" });
    expect(within(lista).queryByText("Proposta")).toBeNull();
    expect(within(lista).getAllByRole("link").map((l) => l.getAttribute("href") || "")).not.toContain(`/mesa-proposta?client=${CLIENTE}`);
  });

  it("a casca da Mesa Proposta mostra Clientes › Propostas no lugar do seletor", () => {
    montar(h(CaminhoDasPropostas), `/mesa-proposta?client=${CLIENTE}`);
    const nav = screen.getByRole("navigation", { name: "Caminho" });
    expect(within(nav).getByRole("link", { name: /Clientes/ }).getAttribute("href")).toBe("/clientes");
    expect(within(nav).getByRole("link", { name: "Propostas" }).getAttribute("href")).toBe("/clientes?propostas=1");
    const pagina = ler("src/pages/MesaProposta.tsx");
    expect(pagina).toContain("caminho={<CaminhoDasPropostas />}");
    // O seletor de cliente continua.
    expect(pagina).toContain('cliente={<SeletorDeClientesDaMesa mesa="proposta"');
    expect(ler("src/components/sistema/CascaDaMesa.tsx")).toContain("{caminho || <SeletorDeMesa");
  });
});

// ------------------------------------------------------------------ 2) entrada por Clientes

const linhaCrua = (extra: Record<string, unknown> = {}) => ({
  id: PROPOSTA,
  client_id: CLIENTE,
  lead_id: null,
  numero: "2026-010",
  titulo: "Redes sociais",
  status: "vista",
  validade_ate: hojeMais(10),
  total_unico: 3000,
  total_mensal: 1500,
  enviada_em: new Date(Date.now() - 6 * 86400000).toISOString(),
  vista_em: new Date(Date.now() - 4 * 86400000).toISOString(),
  aceita_em: null,
  atualizado_em: "2026-09-30T10:00:00Z",
  ultimo_followup_em: null,
  upsell_em: null,
  ...extra,
});

describe("propostas em Clientes: leitura, filtro e endereço", () => {
  it("a linha traz status do dia, valor, validade, vista e o follow-up pendente", () => {
    const l = linhaDaCarteira(linhaCrua())!;
    expect(l.status).toBe("vista");
    expect(valorDaLinha(l)).toBe("R$ 3.000,00 + R$ 1.500,00/mês");
    expect(situacaoDaLinha(l)).toMatch(/^Vista em /);
    expect(l.followup && l.followup.situacao).toBe("viu_sem_resposta");
    const vencida = linhaDaCarteira(linhaCrua({ status: "enviada", validade_ate: hojeMais(-3) }))!;
    expect(vencida.status).toBe("expirada");
    expect(vencida.followup).toBeNull();
    const upsell = linhaDaCarteira(linhaCrua({ id: "u", status: "rascunho", upsell_em: "2026-09-30T10:00:00Z", total_unico: 0, total_mensal: 0 }))!;
    expect(upsell.upsell).toBe(true);
    expect(valorDaLinha(upsell)).toBe("Sem valor");
    const lista = [l, vencida, upsell];
    expect(filtrarCarteira(lista, "abertas").map((x) => x.id)).toEqual([PROPOSTA, "u"]);
    expect(filtrarCarteira(lista, "followup")).toHaveLength(1);
    expect(filtrarCarteira(lista, "upsell").map((x) => x.id)).toEqual(["u"]);
    expect(filtrarCarteira(lista, "encerradas")).toHaveLength(1);
    expect(enderecoDaProposta(upsell)).toBe(`/mesa-proposta?client=${CLIENTE}&proposta=u&etapa=contexto`);
    // PRS: enviada, vista, aceita, recusada ou vencida abre no Acompanhar.
    expect(enderecoDaProposta(l)).toBe(`/mesa-proposta?client=${CLIENTE}&proposta=${PROPOSTA}&etapa=acompanhar`);
    expect(enderecoDaProposta(vencida)).toBe(`/mesa-proposta?client=${CLIENTE}&proposta=${vencida.id}&etapa=acompanhar`);
  });

  it("a área Propostas abre por ?propostas=1, lista com o nome do cliente e abre a mesa no clique", async () => {
    mock.tabelas = { propostas: [linhaCrua(), linhaCrua({ id: "44444444-4444-4444-8444-444444444444", client_id: OUTRO, numero: "2026-011", status: "aceita", aceita_em: "2026-09-29T12:00:00Z" })] };
    montar(h(AreaDePropostas, { clientes: [{ id: CLIENTE, nome: "Loja da Joana" }], nomeDoCliente: (id: string) => (id === CLIENTE ? "Loja da Joana" : "Padaria"), podeCriarCliente: true, abrirNaEntrada: true }));
    const area = screen.getByRole("region", { name: "Propostas" });
    const linha = await within(area).findByRole("button", { name: /Abrir a proposta 2026-010 de Loja da Joana/ });
    // Filtro padrão "Em aberto": a aceita fica fora.
    expect(within(area).queryByRole("button", { name: /2026-011/ })).toBeNull();
    expect(within(area).getByText("Follow-up")).toBeTruthy();
    // A leitura não pede o contexto inteiro: só a marca do upsell.
    const sel = mock.selects.find((s) => s.tabela === "propostas");
    expect(sel && sel.campos).toContain("upsell_em:contexto->upsell->>lido_em");
    expect(sel && sel.campos).not.toMatch(/(^|, )contexto(,|$)/);
    fireEvent.click(linha);
    expect(screen.getByTestId("endereco").textContent).toBe(`/mesa-proposta?client=${CLIENTE}&proposta=${PROPOSTA}&etapa=acompanhar`);
  });

  it("Nova proposta abre numa janela central (dialog), com Cliente novo e Upsell", async () => {
    mock.tabelas = { propostas: [], commercial_leads: [] };
    montar(h(AreaDePropostas, { clientes: [{ id: CLIENTE, nome: "Loja da Joana" }], nomeDoCliente: () => "Loja da Joana", podeCriarCliente: true, abrirNaEntrada: true }));
    fireEvent.click(screen.getByRole("button", { name: "Nova proposta" }));
    const janela = await screen.findByRole("dialog");
    expect(within(janela).getByText("Nova proposta")).toBeTruthy();
    expect(within(janela).getByRole("tab", { name: "Cliente novo" }).getAttribute("aria-selected")).toBe("true");
    expect(within(janela).getByRole("tab", { name: "Upsell" })).toBeTruthy();
    // JanelaCentral do sistema (nada de gaveta lateral).
    expect(ler("src/components/clientes-propostas/NovaProposta.tsx")).toContain('import JanelaCentral from "@/components/sistema/JanelaCentral";');
    expect(ler("src/components/clientes-propostas/NovaProposta.tsx")).not.toMatch(/components\/ui\/(sheet|drawer)/);
  });

  it("Clientes e a ficha ligam a área, o upsell na linha e a seção Propostas com o conselho", () => {
    const clientes = ler("src/pages/Clients.tsx");
    expect(clientes).toContain("<AreaDePropostas");
    expect(clientes).toContain('abrirNaEntrada={searchParams.get("propostas") === "1"}');
    expect(clientes).toContain("<AcoesComerciaisDoCliente");
    // PRS: o "..." da linha abre a janela única (o teste renderizado mora em prs-clientes-linha.test.tsx).
    expect(clientes).toContain('rotulo: "Proposta de upsell..."');
    expect(clientes).toContain('tipo: "upsell"');
    const ficha = ler("src/components/admin/EditClientDrawer.tsx");
    expect(ficha).toContain("<PropostasDoCliente");
    const secao = ler("src/components/clientes-propostas/PropostasDoCliente.tsx");
    expect(secao).toContain('origem="cliente"');
    expect(secao).toContain("<BotaoDoConselho");
    expect(ler("src/pages/MesaProposta.tsx")).toContain('origem="mesa-proposta"');
  });
});

// ------------------------------------------------------------------ 3) cliente novo

describe("Nova proposta para cliente novo", () => {
  const LEAD_CLIENTE = { id: "55555555-5555-4555-8555-555555555555", name: "Joana", company: "Loja da Joana", email: "joana@loja.com", whatsapp: "41999990000", stage: "ganho", won_client_id: CLIENTE };
  const LEAD_SEM_FICHA = { id: "66666666-6666-4666-8666-666666666666", name: "Carlos Lima", company: "Oficina Lima", email: "carlos@oficina.com", whatsapp: "41988880000", stage: "proposta", won_client_id: null };

  it("lead que já é cliente: cria na hora com o lead e abre a Mesa Proposta nele", async () => {
    mock.tabelas = { commercial_leads: [LEAD_CLIENTE, LEAD_SEM_FICHA] };
    mock.invoke.mockResolvedValue({ data: { proposta: { id: PROPOSTA, numero: "2026-012" }, custo_usd: 0 }, error: null });
    const onAberta = vi.fn();
    montar(h(NovaProposta, { aberta: true, onAberta, clientes: [], podeCriarCliente: true, onCriarCliente: vi.fn() }));
    const janela = await screen.findByRole("dialog");
    const lead = within(janela).getByLabelText("Lead do Comercial") as HTMLSelectElement;
    await waitFor(() => expect(lead.querySelectorAll("option").length).toBe(3));
    fireEvent.change(lead, { target: { value: LEAD_CLIENTE.id } });
    fireEvent.click(within(janela).getByRole("button", { name: /Criar proposta$/ }));
    await waitFor(() => expect(chamadasDe("mesa-proposta", "criar")).toHaveLength(1));
    expect(chamadasDe("mesa-proposta", "criar")[0][1].body).toMatchObject({ acao: "criar", client_id: CLIENTE, lead_id: LEAD_CLIENTE.id });
    expect(chamadasDe("mesa-proposta", "criar")[0][1].body.tipo).toBeUndefined();
    await waitFor(() => expect(screen.getByTestId("endereco").textContent).toBe(`/mesa-proposta?client=${CLIENTE}&proposta=${PROPOSTA}&etapa=contexto`));
    expect(onAberta).toHaveBeenCalledWith(false);
  });

  it("lead sem ficha: leva os dados do lead para o cadastro na hora (nada é criado antes)", async () => {
    mock.tabelas = { commercial_leads: [LEAD_SEM_FICHA] };
    const onCriarCliente = vi.fn();
    montar(h(NovaProposta, { aberta: true, onAberta: vi.fn(), clientes: [], podeCriarCliente: true, onCriarCliente }));
    const janela = await screen.findByRole("dialog");
    const lead = within(janela).getByLabelText("Lead do Comercial") as HTMLSelectElement;
    await waitFor(() => expect(lead.querySelectorAll("option").length).toBe(2));
    fireEvent.change(lead, { target: { value: LEAD_SEM_FICHA.id } });
    fireEvent.click(within(janela).getByRole("button", { name: "Criar o cliente e seguir" }));
    expect(onCriarCliente).toHaveBeenCalledWith({ fullName: "Carlos Lima", company: "Oficina Lima", email: "carlos@oficina.com", phone: "41988880000", leadId: LEAD_SEM_FICHA.id });
    expect(mock.invoke).not.toHaveBeenCalled();
  });

  it("sem permissão de criar cliente (gestor), o botão fica desligado e explica", async () => {
    mock.tabelas = { commercial_leads: [] };
    montar(h(NovaProposta, { aberta: true, onAberta: vi.fn(), clientes: [], podeCriarCliente: false, onCriarCliente: vi.fn() }));
    const janela = await screen.findByRole("dialog");
    expect((within(janela).getByRole("button", { name: "Criar o cliente e seguir" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(janela).getByText(/Só o admin cria cliente/)).toBeTruthy();
  });

  it("lead sem ficha até o fim: cadastro rápido com os dados do lead (nada enviado) e a proposta nasce nele", async () => {
    const NOVO = "77777777-7777-4777-8777-777777777777";
    mock.tabelas = { propostas: [], commercial_leads: [LEAD_SEM_FICHA] };
    mock.invoke.mockImplementation((funcao: string, { body }: any) => {
      if (funcao === "manage-team") return Promise.resolve({ data: { user_id: NOVO }, error: null });
      if (funcao === "mesa-proposta" && body.acao === "criar") return Promise.resolve({ data: { proposta: { id: PROPOSTA, numero: "2026-015" }, custo_usd: 0 }, error: null });
      return Promise.resolve({ data: {}, error: null });
    });
    montar(h(AreaDePropostas, { clientes: [], nomeDoCliente: () => "Oficina Lima", podeCriarCliente: true, abrirNaEntrada: true }));
    fireEvent.click(screen.getByRole("button", { name: "Nova proposta" }));
    let janela = await screen.findByRole("dialog");
    const lead = within(janela).getByLabelText("Lead do Comercial") as HTMLSelectElement;
    await waitFor(() => expect(lead.querySelectorAll("option").length).toBe(2));
    fireEvent.change(lead, { target: { value: LEAD_SEM_FICHA.id } });
    fireEvent.click(within(janela).getByRole("button", { name: "Criar o cliente e seguir" }));
    // A janela do cliente rápido (central) já vem com o lead.
    await waitFor(() => expect(screen.getByText("Cliente novo para a proposta")).toBeTruthy());
    janela = screen.getByRole("dialog");
    expect((within(janela).getByLabelText("Nome") as HTMLInputElement).value).toBe("Carlos Lima");
    expect((within(janela).getByLabelText("Empresa") as HTMLInputElement).value).toBe("Oficina Lima");
    expect((within(janela).getByLabelText("E-mail") as HTMLInputElement).value).toBe("carlos@oficina.com");
    expect(within(janela).getByRole("tab", { name: "Lead do Comercial" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(within(janela).getByRole("button", { name: "Criar e abrir a proposta" }));
    await waitFor(() => expect(chamadasDe("mesa-proposta", "criar")).toHaveLength(1));
    expect(chamadasDe("mesa-proposta", "criar")[0][1].body).toMatchObject({ client_id: NOVO, lead_id: LEAD_SEM_FICHA.id });
    expect(mock.invoke.mock.calls.filter((c) => c[0] === "send-transactional-email")).toHaveLength(0);
    await waitFor(() => expect(screen.getByTestId("endereco").textContent).toBe(`/mesa-proposta?client=${NOVO}&proposta=${PROPOSTA}&etapa=contexto`));
  });
});

// ------------------------------------------------------------------ 4) upsell pré-carregado

const ESTADO: EstadoParaUpsell = {
  periodos: { mes: { de: "2026-09-01", ate: "2026-09-30" }, mesAnterior: { de: "2026-08-01", ate: "2026-08-31" }, desde: "2026-08-31T12:00:00Z" },
  organico: {
    semanas: [
      { de: "2026-09-22", ate: "2026-09-28", seguidores: 4210, alcance: 18350, interacoes: 912 },
      { de: "2026-09-15", ate: "2026-09-21", seguidores: 4100, alcance: 15000, interacoes: 800 },
      { de: "2026-08-25", ate: "2026-08-31", seguidores: 3900, alcance: null, interacoes: null },
    ],
    publicadosNoMes: 14,
    publicadosNoMesAnterior: 11,
  },
  pago: { mes: { gasto: 2350.5, contatos: 87, vendas: 0, receita: 0 } },
  operacao: { tarefasConcluidas: [{ id: "t1", titulo: "Carrossel de lançamento", quando: "2026-09-20" }] },
};

describe("upsell pré-carregado com o que o cliente já tem", () => {
  it("serviços do cadastro (sem bandeira de controle) e as mesmas chaves do painel", () => {
    expect(Object.keys(SERVICOS_DA_CASA).sort()).toEqual(Object.keys(SERVICE_LABELS).sort());
    expect(servicosDoCadastro({ social: true, trafego: true, one_off_done: true, cobranca: true, internal_company: true })).toEqual(["Social media", "Tráfego pago"]);
    expect(textoDoPlano({ nome: "Growth", valor: 2500, periodo: "monthly", desde: "2026-08-01", origem: "financeiro" })).toBe("Growth, R$ 2.500,00 por mês, desde 01/08/2026");
  });

  it("resultados reais só com base, cada um com o período; sem medição, nada", () => {
    const r = resultadosDoEstado(ESTADO);
    expect(r.map((x) => x.titulo)).toEqual(["Seguidores", "Alcance", "Conteúdo publicado", "Anúncios", "Entregas"]);
    expect(r[0].texto).toBe("4.210 seguidores na semana de 22/09 a 28/09 (+310 desde 25/08).");
    expect(r[3].texto).toContain("R$ 2.350,50 investidos em anúncios de 01/09 a 30/09, 87 contatos");
    expect(r[3].texto).not.toMatch(/vendas/);
    const vazio: EstadoParaUpsell = { ...ESTADO, organico: { semanas: [], publicadosNoMes: 0, publicadosNoMesAnterior: 0 }, pago: { mes: { gasto: 0, contatos: 0, vendas: 0, receita: 0 } }, operacao: { tarefasConcluidas: [] } };
    expect(resultadosDoEstado(vazio)).toEqual([]);
    expect(resultadosDoEstado(null)).toEqual([]);
  });

  it("o retrato vira o bloco, o material (origem dos números) e o contexto curto da IA", () => {
    const u = montarUpsell({ cliente: "Loja da Joana", servicos: ["Social media"], plano: { nome: "Growth", valor: 2500, periodo: "monthly", desde: null, origem: "financeiro" }, resultados: resultadosDoEstado(ESTADO), lidoEm: "2026-09-30T12:00:00Z" });
    expect(blocoJaTem(u)).toMatchObject({ servicos: ["Social media"], plano: "Growth, R$ 2.500,00 por mês" });
    const m = materialDoUpsell(u);
    expect(m.nome).toMatch(/^Cliente hoje/);
    expect(m.texto).toContain("4.210 seguidores");
    expect(m.texto).toContain("Serviços contratados hoje: Social media.");
    expect(contextoDoUpsell(u).length).toBeLessThanOrEqual(2500);
    expect(lerUpsell({ upsell: u })).toMatchObject({ cliente: "Loja da Joana", servicos: ["Social media"] });
    expect(lerUpsell({ notas: "x" })).toBeNull();
    const semNada = materialDoUpsell(montarUpsell({ cliente: "X", servicos: [], plano: null, resultados: [] }));
    expect(semNada.texto).toContain("Não cite número de resultado.");
  });

  it("o bloco 'O que você já tem' vem logo depois da capa e some da proposta de cliente novo", () => {
    expect(TIPOS_DE_BLOCO.slice(0, 3)).toEqual(["capa", "ja_tem", "desafio"]);
    const nova = conteudoDoModelo(MODELO_PADRAO_ACELERIQ);
    expect(blocosParaMostrar(nova).map((b) => b.tipo)).not.toContain("ja_tem");
    expect(camposDoBloco(blocoDoTipo(nova, "ja_tem"))).toEqual([]);
    expect(camposDaProposta(nova).some((c) => c.chave.indexOf("ja_tem.") === 0)).toBe(false);
    const u = montarUpsell({ cliente: "Loja", servicos: ["Social media"], plano: null, resultados: [{ titulo: "Seguidores", texto: "4.210 seguidores." }] });
    const upsell = comBloco(nova, "ja_tem", { dados: blocoJaTem(u) });
    expect(blocosParaMostrar(upsell)[1].tipo).toBe("ja_tem");
    // A IA só escreve a abertura; serviços, plano e resultados são do painel.
    expect(camposDoBloco(blocoDoTipo(upsell, "ja_tem")).map((c) => c.chave)).toEqual(["ja_tem.texto"]);
  });

  it("a proposta de upsell se reconhece pelo contexto e desenha o bloco na página do cliente", () => {
    const u = montarUpsell({ cliente: "Loja", servicos: ["Social media", "Tráfego pago"], plano: { nome: "Growth", valor: 2500, periodo: "monthly", desde: null, origem: "financeiro" }, resultados: [{ titulo: "Seguidores", texto: "4.210 seguidores na semana." }] });
    const conteudo = comBloco(comBloco(conteudoDoModelo(MODELO_PADRAO_ACELERIQ), "capa", { dados: { headline: "O próximo passo", subtitulo: "", projeto: "" } }), "ja_tem", { dados: blocoJaTem(u) });
    const p = normalizarProposta({ id: PROPOSTA, client_id: CLIENTE, numero: "2026-013", titulo: "Próximo passo", status: "rascunho", conteudo, itens: [], contexto: { upsell: u } })!;
    expect(p.tipo).toBe("upsell");
    expect(p.upsell && p.upsell.servicos).toEqual(["Social media", "Tráfego pago"]);
    expect(normalizarProposta({ id: PROPOSTA, client_id: CLIENTE, conteudo, contexto: {} })!.tipo).toBe("nova");
    render(h(PropostaDocumento, { dados: { numero: "2026-013", titulo: "Próximo passo", conteudo, itens: [], validade_ate: null, data: null }, cliente: "Loja", previa: true }));
    const pagina = screen.getByRole("region", { name: "O que você já tem" });
    expect(within(pagina).getByText("Tráfego pago")).toBeTruthy();
    expect(within(pagina).getByText("Growth, R$ 2.500,00 por mês")).toBeTruthy();
    expect(within(pagina).getByText("4.210 seguidores na semana.")).toBeTruthy();
  });

  it("servidor: plano do termo vigente do Financeiro; sem termo, o do cadastro; retrato sem inventar", async () => {
    const banco = (tabelas: Record<string, unknown>) => ({
      from: (t: string) => {
        const dados = tabelas[t] === undefined ? [] : tabelas[t];
        const b: any = {};
        for (const m of ["select", "eq", "neq", "in", "is", "gte", "lte", "lt", "order", "limit", "range", "not"]) b[m] = () => b;
        b.maybeSingle = () => Promise.resolve({ data: Array.isArray(dados) ? dados[0] || null : dados, error: null });
        b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null }).then(ok, erro);
        return b;
      },
    });
    const avisos: string[] = [];
    const termo = { status: "active", final_amount: 2650, operational_amount: 2491, billing_period: "monthly", starts_on: "2026-06-01", ends_on: null, financial_plan_versions: { plan_id: "p", financial_plans: { name: "Growth" } } };
    expect(await planoDoCliente(banco({ financial_client_terms: [termo] }), CLIENTE, null, avisos)).toEqual({ nome: "Growth", valor: 2650, periodo: "monthly", desde: "2026-06-01", origem: "financeiro" });
    expect(await planoDoCliente(banco({}), CLIENTE, { plan_name: "Mensalidade", plan_value: 1800 }, avisos)).toMatchObject({ nome: "Mensalidade", valor: 1800, origem: "cadastro" });
    expect(await planoDoCliente(banco({}), CLIENTE, null, avisos)).toBeNull();
    const servico = banco({ profiles: [{ services_config: { social: true, one_off_done: true }, plan_name: null, plan_value: null }], financial_client_terms: [termo] });
    const r = await retratoDoCliente(servico, banco({}) as any, CLIENTE, "Loja da Joana", new Date("2026-09-30T15:00:00Z"));
    expect(r.servicos).toEqual(["Social media"]);
    expect(r.plano && r.plano.nome).toBe("Growth");
    // Banco sem nenhuma medição: nenhum resultado (nada inventado).
    expect(r.resultados).toEqual([]);
  });

  it("a função cria o upsell com o retrato, o título do próximo passo e a ação de reler", () => {
    const fonte = ler("supabase/functions/mesa-proposta/index.ts");
    expect(fonte).toContain('const ehUpsell = corpo.tipo === "upsell";');
    expect(fonte).toContain("contexto = { upsell: retrato, materiais: [materialDoUpsell(retrato)] };");
    expect(fonte).toContain("upsell_atualizar: upsellAtualizar,");
    expect(fonte).toContain('tipo_da_proposta: linha.contexto.upsell ? "upsell" : "nova",');
    const sql = ler("supabase/migrations/20260930210000_propostas_em_clientes.sql");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS tipo text");
    expect(sql).toContain("GENERATED ALWAYS AS (CASE WHEN contexto ? 'upsell' THEN 'upsell' ELSE 'nova' END) STORED");
    expect(sql).not.toMatch(/DROP POLICY|USING \(true\)|GRANT (INSERT|UPDATE|DELETE)/i);
  });

  it("o agente não reescreve o que o cliente já tem, e o bloco vazio não muda os apelidos", () => {
    const nova = conteudoDoModelo(MODELO_PADRAO_ACELERIQ);
    const base = { id: PROPOSTA, titulo: "x", numero: "1", status: "rascunho", validade_ate: null, itens: [] };
    const alvosNova = alvosDaProposta({ ...base, blocos: nova.blocos });
    expect(alvosNova.find((a) => a.ref === "b2")!.dados!.tipo).toBe("desafio");
    const u = montarUpsell({ cliente: "Loja", servicos: ["Social media"], plano: null, resultados: [] });
    const upsell = comBloco(nova, "ja_tem", { dados: blocoJaTem(u) });
    const alvos = alvosDaProposta({ ...base, blocos: upsell.blocos });
    expect(alvos.find((a) => a.ref === "b2")!.dados!.tipo).toBe("ja_tem");
    const a = normalizarAcoesDaProposta({ resumo: "x", itens: [{ operacao: "reescrever_bloco", ref: "b2", para: "mais forte" }] }, { ...base, blocos: upsell.blocos }, "reescreva", 0.05, 0.02)!;
    expect(a.itens).toHaveLength(0);
    expect(a.recusados.map((r) => r.motivo).join(" ")).toMatch(/vem do painel/);
  });
});

// ------------------------------------------------------------------ conselho em Clientes

describe("conselho de agentes em Clientes", () => {
  it("origens cliente, proposta e upsell com o elenco sugerido; tema do cliente pré-preenchido", () => {
    expect(grupoDaOrigem("cliente")).toBe("cliente");
    expect(elencoPadrao("cliente")).toEqual(["estrategista_marca", "performance", "comercial", "cetico"]);
    expect(grupoDaOrigem("upsell")).toBe("proposta");
    expect(grupoDaOrigem("proposta")).toBe("proposta");
    expect(grupoDaOrigem("mesa-proposta")).toBe("proposta");
    const ctx = contextoDoClienteParaConselho({ id: CLIENTE, nome: "Loja", services_config: { social: true, cobranca: true }, plan_name: "Growth", client_type: "hybrid" });
    expect(ctx).toContain("Cliente híbrido. Serviços contratados: Social media. Plano: Growth.");
  });
});


describe("upsell pela janela de Clientes", () => {
  it("escolhe o cliente da casa e cria com tipo upsell, abrindo no Rascunho (sem custo, com Desfazer)", async () => {
    mock.invoke.mockResolvedValue({ data: { proposta: { id: PROPOSTA, numero: "2026-014" }, avisos_upsell: [], custo_usd: 0 }, error: null });
    montar(h(NovaProposta, { aberta: true, onAberta: vi.fn(), tipoInicial: "upsell", clientes: [{ id: CLIENTE, nome: "Loja da Joana" }], podeCriarCliente: true, onCriarCliente: vi.fn() }));
    const janela = await screen.findByRole("dialog");
    expect(within(janela).getByRole("tab", { name: "Upsell" }).getAttribute("aria-selected")).toBe("true");
    const criar = within(janela).getByRole("button", { name: "Criar proposta de upsell" }) as HTMLButtonElement;
    expect(criar.disabled).toBe(true);
    fireEvent.change(within(janela).getByLabelText("Cliente do upsell"), { target: { value: CLIENTE } });
    fireEvent.click(criar);
    await waitFor(() => expect(chamadasDe("mesa-proposta", "criar")).toHaveLength(1));
    expect(chamadasDe("mesa-proposta", "criar")[0][1].body).toMatchObject({ acao: "criar", client_id: CLIENTE, tipo: "upsell" });
    await waitFor(() => expect(screen.getByTestId("endereco").textContent).toBe(`/mesa-proposta?client=${CLIENTE}&proposta=${PROPOSTA}&etapa=rascunho`));
    const { toast } = await import("sonner");
    const chamada = (toast.success as any).mock.calls.find((c: any[]) => /upsell/.test(String(c[0])));
    expect(chamada && chamada[1].action.label).toBe("Desfazer");
  });
});
