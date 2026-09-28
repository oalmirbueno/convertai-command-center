import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente AD (28/09), tela: o Gerenciador ao vivo na aba Conta (situação da
 * conta travada com o motivo e o que fazer, árvore com a entrega real,
 * filtros, ação da equipe com a prova lida da Meta e o Desfazer da marca), o
 * cartão da ordem direta ao agente ("Feito e conferido" ou "Não fiz: motivo")
 * e o andamento real enquanto espera. A função é simulada: nada sai para a Meta.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = () => {
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "order", "limit", "range", "gte", "update", "insert"]) b[m] = () => b;
    b.single = () => Promise.resolve({ data: null, error: null });
    b.maybeSingle = b.single;
    b.then = (ok: any, erro: any) => Promise.resolve({ data: [], error: null }).then(ok, erro);
    return b;
  };
  return { supabase: { functions: { invoke: mock.invoke }, rpc: vi.fn().mockResolvedValue({ data: {}, error: null }), from: () => consulta(), storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: null, error: null }) }) } } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import GerenciadorAoVivo, { SituacaoDaConta } from "@/components/mesa-ads/GerenciadorAoVivo";
import { filtrarArvore, normalizarGerenciador, faixaDaVerba } from "@/components/mesa-ads/gerenciadorApi";
import { CartaoDasAcoes } from "@/components/mesa-ads/AcoesDoAgente";
import { normalizarAcoesDaConta } from "@/components/mesa-ads/acoesDoAgenteApi";
import { normalizarMensagensDoAgente } from "@/components/mesa-ads/agenteSeniorApi";

const CLIENTE = "66666666-6666-6666-6666-666666666666";

const valor = (): MesaValor => ({
  clientId: CLIENTE, clientName: "Cliente", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 50,
  catalogo: [], catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(),
});

function montar(filho: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(TooltipProvider, null, h(MesaProvider, { valor: valor(), children: filho }))));
}

const chamadas = (acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[0] === "mesa-ads" && c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);

function responder(mapa: Record<string, unknown>) {
  mock.invoke.mockImplementation(async (_f: string, { body }: any) =>
    Object.prototype.hasOwnProperty.call(mapa, body.acao) ? { data: typeof mapa[body.acao] === "function" ? (mapa[body.acao] as (b: any) => unknown)(body) : mapa[body.acao], error: null } : { data: { ok: true }, error: null },
  );
}

const entrega = (estado: string, rotulo: string, motivo: string | null = null) => ({ estado, rotulo, motivo });
const anuncio = (id: string, nome: string, e: any, hoje = 0) => ({
  nivel: "anuncio", id, nome, conta: "1871637719955892", campaign_id: "120000000000001", adset_id: "130000000000001", status: "ACTIVE", efetivo: "ACTIVE", entrega: e,
  objetivo: null, otimizacao: null, orcamento_diario_brl: null, orcamento_total_brl: null, metricas: { gasto: 80, impressoes: 4000, resultados: 12, resultado_rotulo: "Conversas iniciadas", custo_por_resultado: 6.67, ctr_link: 1.3, cpm: 20, frequencia: 1.5 },
  hoje: { gasto: hoje, impressoes: hoje ? 300 : 0 }, link_meta: `https://business.facebook.com/adsmanager/manage/ads?act=1871637719955892&selected_ad_ids=${id}`, marca: null, filhos: [],
});

const LEITURA = {
  plataformas: [{ id: "meta", nome: "Meta Ads", conectada: true, lida: true, motivo: null }, { id: "google", nome: "Google Ads", conectada: false, lida: false, motivo: "Google Ads não está conectado." }],
  contas: [{
    id: "1871637719955892", nome: "Conta 01 Aceleriq", moeda: "BRL",
    situacao: { codigo: 3, rotulo: "Saldo em aberto", travada: true, motivo: "A conta tem pagamento pendente na Meta (saldo em aberto): nada entrega e a Meta recusa mudanças até quitar.", o_que_fazer: "Quite em Cobrança e pagamentos do Gerenciador de Anúncios e clique em Atualizar agora." },
    saldo_a_pagar_brl: 14.86, gasto_total_brl: 5000, link_meta: "https://business.facebook.com/adsmanager/manage/campaigns?act=1871637719955892",
    link_cobranca: "https://business.facebook.com/billing_hub/accounts/details?asset_id=1871637719955892", fonte: "meta_ao_vivo", lido_em: "2026-09-28T13:32:00Z", aviso: null,
  }],
  campanhas: [
    {
      nivel: "campanha", id: "120000000000001", nome: "Visitas IG", conta: "1871637719955892", campaign_id: "120000000000001", adset_id: null, status: "ACTIVE", efetivo: "ACTIVE",
      entrega: entrega("conta_travada", "Não entrega", "A conta tem pagamento pendente na Meta (saldo em aberto)."), objetivo: "OUTCOME_ENGAGEMENT", otimizacao: null, orcamento_diario_brl: 40, orcamento_total_brl: null,
      metricas: { gasto: 80, impressoes: 4000, resultados: 12, resultado_rotulo: "Conversas iniciadas", custo_por_resultado: 6.67, ctr_link: 1.3, cpm: 20, frequencia: 1.5 }, hoje: { gasto: 0, impressoes: 0 },
      link_meta: "https://business.facebook.com/adsmanager/manage/campaigns?act=1871637719955892&selected_campaign_ids=120000000000001",
      marca: { acao_id: "ac-1", origem: "agente", tipo: "renomear", estado: "feita", resumo: "Renomeei a campanha Visitas IG.", quando: "2026-09-28T13:32:00Z", pode_desfazer: true },
      filhos: [{
        nivel: "conjunto", id: "130000000000001", nome: "Aberto", conta: "1871637719955892", campaign_id: "120000000000001", adset_id: "130000000000001", status: "ACTIVE", efetivo: "ACTIVE",
        entrega: entrega("conta_travada", "Não entrega"), objetivo: null, otimizacao: "CONVERSATIONS", orcamento_diario_brl: null, orcamento_total_brl: null, metricas: null, hoje: { gasto: 0, impressoes: 0 },
        link_meta: "https://business.facebook.com/adsmanager/manage/adsets?act=1871637719955892", marca: null,
        filhos: [anuncio("140000000000001", "Reel da recepção", entrega("conta_travada", "Não entrega"))],
      }],
    },
    {
      nivel: "campanha", id: "120000000000002", nome: "Antiga de setembro", conta: "1871637719955892", campaign_id: "120000000000002", adset_id: null, status: "PAUSED", efetivo: "PAUSED",
      entrega: entrega("pausado", "Pausado"), objetivo: null, otimizacao: null, orcamento_diario_brl: null, orcamento_total_brl: 500, metricas: null, hoje: { gasto: 0, impressoes: 0 },
      link_meta: "https://business.facebook.com/adsmanager/manage/campaigns?act=1&selected_campaign_ids=120000000000002", marca: null, filhos: [],
    },
  ],
  resumo: { campanhas: 2, campanhas_ativas: 1, campanhas_entregando: 0, conjuntos_ativos: 1, anuncios: 1, anuncios_ativos: 1, anuncios_entregando: 0, anuncios_com_problema: 0, gasto_hoje: 0, impressoes_hoje: 0, gasto_periodo: 80, resultados_periodo: 12, alertas: ["Conta 01 Aceleriq: A conta tem pagamento pendente na Meta (saldo em aberto): nada entrega e a Meta recusa mudanças até quitar."] },
  periodo: { inicio: "2026-09-15", fim: "2026-09-28", dias: 14 },
  fonte: "meta_ao_vivo",
  lido_em: "2026-09-28T13:32:00Z",
  sincronizado_em: "2026-09-28T13:20:00Z",
  gestao: { disponivel: false, motivo: "A conta de anúncios Conta 01 Aceleriq está com pagamento pendente na Meta (saldo em aberto)." },
  avisos: [],
  gravada_em: "2026-09-28T13:32:00Z",
};

beforeAll(() => {
  if (typeof (globalThis as any).ResizeObserver === "undefined") (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});

beforeEach(() => {
  mock.invoke.mockReset();
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

describe("situação da conta (topo enxuto)", () => {
  it("conta com saldo em aberto: o motivo, o que fazer, o link da cobrança, só leitura e as plataformas não conectadas", () => {
    montar(h(SituacaoDaConta, { leitura: normalizarGerenciador(LEITURA), carregando: false, erro: null }));
    const s = screen.getByRole("region", { name: "Situação da conta" });
    expect(within(s).getByText("Saldo em aberto")).toBeTruthy();
    expect(within(s).getByText(/nada entrega e a Meta recusa mudanças/)).toBeTruthy();
    expect(within(s).getByText(/A pagar: R\$\s?14,86/)).toBeTruthy();
    expect(within(s).getByRole("link", { name: /Cobrança e pagamentos na Meta/ }).getAttribute("href")).toBe("https://business.facebook.com/billing_hub/accounts/details?asset_id=1871637719955892");
    expect(within(s).getByText(/Só leitura agora: A conta de anúncios Conta 01 Aceleriq/)).toBeTruthy();
    expect(within(s).getByText(/Google Ads: não conectado/)).toBeTruthy();
    expect(s.querySelector("[data-travada='sim']")).toBeTruthy();
  });
});

describe("gerenciador ao vivo", () => {
  it("lê com o período, mostra a entrega real com o motivo, filtra (ativos, entregando, todos) e abre a árvore", async () => {
    responder({ gerenciador_ler: LEITURA });
    montar(h(GerenciadorAoVivo, { dias: 14 }));
    const g = await screen.findByRole("region", { name: "Gerenciador de anúncios" });
    await within(g).findByText("Visitas IG");
    expect(chamadas("gerenciador_ler")[0]).toEqual({ acao: "gerenciador_ler", client_id: CLIENTE, dias: 14 });
    expect(within(g).getByText(/Lido na Meta às 10:32/)).toBeTruthy();
    // Ativos por padrão: a pausada fica de fora.
    expect(within(g).queryByText("Antiga de setembro")).toBeNull();
    expect(within(g).getAllByText("Não entrega").length).toBeGreaterThan(0);
    expect(within(g).getByText(/pagamento pendente na Meta \(saldo em aberto\)\./)).toBeTruthy();
    // Marca da última ação do agente, com o Desfazer.
    expect(within(g).getByText(/Renomeei a campanha Visitas IG pelo agente às 10:32/)).toBeTruthy();
    fireEvent.click(within(g).getByRole("button", { name: /Entregando agora \(0\)/ }));
    expect(await within(g).findByText(/Nada está entregando agora/)).toBeTruthy();
    fireEvent.click(within(g).getByRole("button", { name: /Todos \(2\)/ }));
    expect(within(g).getByText("Antiga de setembro")).toBeTruthy();
    fireEvent.click(within(g).getByRole("button", { name: "Abrir campanha Visitas IG" }));
    fireEvent.click(within(g).getByRole("button", { name: "Abrir conjunto Aberto" }));
    expect(within(g).getByText("Reel da recepção")).toBeTruthy();
  });

  it("ação da equipe: renomear manda gerenciador_acao e mostra a prova lida na Meta; não feito mostra o motivo", async () => {
    let vez = 0;
    responder({
      gerenciador_ler: { ...LEITURA, gestao: { disponivel: true, motivo: null } },
      gerenciador_acao: () => {
        vez++;
        return vez === 1
          ? { resultado: { ok: true, feito_em: "2026-09-28T13:40:00Z", relido_em: "2026-09-28T13:40:02Z", antes: { status: "ACTIVE", nome: "Visitas IG" }, depois: { status: "ACTIVE", nome: "Visitas IG (teste)" }, resposta: { success: true } }, resumo: "Renomeou a campanha Visitas IG para Visitas IG (teste).", acao_id: "ac-9" }
          : { resultado: { ok: false, motivo: "A conta de anúncios Conta 01 Aceleriq está com pagamento pendente na Meta (saldo em aberto)." }, resumo: "Tentativa de pausar a campanha Visitas IG: não feito.", acao_id: "ac-10" };
      },
    });
    montar(h(GerenciadorAoVivo, { dias: 14 }));
    const g = await screen.findByRole("region", { name: "Gerenciador de anúncios" });
    await within(g).findByText("Visitas IG");
    fireEvent.click(within(g).getByRole("button", { name: "Ações: Visitas IG" }));
    const painel = within(g).getByRole("group", { name: "Ações em Visitas IG" });
    expect(within(painel).getByRole("link", { name: /Abrir na Meta/ }).getAttribute("href")).toContain("selected_campaign_ids=120000000000001");
    fireEvent.click(within(painel).getByRole("button", { name: "Renomear" }));
    fireEvent.change(within(painel).getByLabelText("Nome novo"), { target: { value: "Visitas IG (teste)" } });
    fireEvent.click(within(painel).getByRole("button", { name: /Confirmar/ }));
    await waitFor(() => expect(chamadas("gerenciador_acao")[0]).toEqual({ acao: "gerenciador_acao", client_id: CLIENTE, tipo: "renomear", nivel: "campanha", meta_id: "120000000000001", nome_atual: "Visitas IG", nome: "Visitas IG (teste)" }));
    const prova = await within(painel).findByText(/Feito e conferido na Meta às 10:40/);
    expect(prova).toBeTruthy();
    expect(within(painel).getByText(/Antes: "Visitas IG" · Depois \(relido na Meta\): "Visitas IG \(teste\)" · A Meta respondeu: sucesso/)).toBeTruthy();
    // Pausar com a conta travada: não feito, com o motivo.
    fireEvent.click(within(painel).getByRole("button", { name: /Pausar/ }));
    fireEvent.click(within(painel).getByRole("button", { name: /Confirmar/ }));
    expect(await within(painel).findByText(/Não fiz: A conta de anúncios Conta 01 Aceleriq está com pagamento pendente/)).toBeTruthy();
    expect(within(painel).getByText("Nada mudou na conta.")).toBeTruthy();
  });

  it("Desfazer da marca chama rotina_desfazer com a ação", async () => {
    responder({ gerenciador_ler: LEITURA, rotina_desfazer: { disponivel: true, rotina: null, acoes: [] } });
    montar(h(GerenciadorAoVivo, { dias: 14 }));
    const g = await screen.findByRole("region", { name: "Gerenciador de anúncios" });
    fireEvent.click(await within(g).findByRole("button", { name: "Desfazer: Renomeei a campanha Visitas IG." }));
    await waitFor(() => expect(chamadas("rotina_desfazer")).toEqual([{ acao: "rotina_desfazer", acao_id: "ac-1" }]));
  });

  it("normalização tolerante, filtro que poda a árvore e a faixa da verba (30% por vez, mínimo R$ 5)", () => {
    const vazia = normalizarGerenciador({ ok: true });
    expect(vazia.campanhas).toEqual([]);
    expect(vazia.resumo.gasto_hoje).toBeNull();
    const l = normalizarGerenciador({ ...LEITURA, campanhas: [{ ...LEITURA.campanhas[0], link_meta: "javascript:alert(1)" }] });
    expect(l.campanhas[0].link_meta).toBe("");
    const arvore = normalizarGerenciador(LEITURA).campanhas;
    expect(filtrarArvore(arvore, "ativos").map((c) => c.id)).toEqual(["120000000000001"]);
    expect(filtrarArvore(arvore, "entregando")).toEqual([]);
    expect(filtrarArvore(arvore, "todos")).toHaveLength(2);
    expect(faixaDaVerba(40)).toEqual({ min: 28, max: 52 });
    expect(faixaDaVerba(6)).toEqual({ min: 5, max: 7.8 });
    expect(faixaDaVerba(null)).toBeNull();
  });
});

describe("ordem direta no cartão do agente", () => {
  const item = (resultado: any) => ({
    id: "i1", tipo: "renomear", na_meta: true, auto: true, alvo: { ref: "direto", nivel: "campanha", meta_id: "120000000000001", nome: "[NÃO ATIVAR] Tentativa" }, criativo: null,
    texto: "[NÃO ATIVAR] Tentativa (teste painel)", variacao_pct: null, motivo: "Ordem direta da equipe", de: { status: "PAUSED", orcamento_diario_brl: null, nome: "[NÃO ATIVAR] Tentativa" },
    para: { nome: "[NÃO ATIVAR] Tentativa (teste painel)" }, limitado: false, indisponivel: null, resultado,
  });

  it("feito: Feito e conferido na Meta, a prova relida e o Voltar este; nada para confirmar", () => {
    const acoes = normalizarAcoesDaConta({ tipo: "acoes_conta", resumo: "x", itens: [item({ ok: true, feito_em: "2026-09-28T14:20:00Z", relido_em: "2026-09-28T14:20:01Z", depois: { status: "PAUSED", nome: "[NÃO ATIVAR] Tentativa (teste painel)" }, resposta: { success: true } })], ignorados: [], gestao: { disponivel: true, motivo: null } })!;
    montar(h(CartaoDasAcoes, { mensagemId: "m1", acoes }));
    expect(screen.getByText("Feito e conferido na Meta")).toBeTruthy();
    expect(screen.getByText(/Conferido na Meta às 11:20: nome "\[NÃO ATIVAR\] Tentativa \(teste painel\)" \(a Meta respondeu sucesso\)/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Desfazer este item: Renomear/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Confirmar/ })).toBeNull();
  });

  it("não feito: o motivo no item e o selo Não feito, sem Confirmar vazio", () => {
    const acoes = normalizarAcoesDaConta({ tipo: "acoes_conta", resumo: "x", itens: [item({ ok: false, motivo: "A conta de anúncios está com pagamento pendente na Meta (saldo em aberto)." })], ignorados: [], gestao: { disponivel: false, motivo: "saldo em aberto" } })!;
    montar(h(CartaoDasAcoes, { mensagemId: "m1", acoes }));
    expect(screen.getByText(/A conta de anúncios está com pagamento pendente/)).toBeTruthy();
    expect(screen.getByText("Não feito: o motivo está no item")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Confirmar/ })).toBeNull();
  });

  it("ensaio (sem gestão) diz o motivo real, não um genérico", () => {
    const acoes = normalizarAcoesDaConta({ tipo: "acoes_conta", resumo: "x", modo: "ensaio", itens: [{ ...item(null), auto: false, ensaio: true, resultado: undefined }], ignorados: [], gestao: { disponivel: false, motivo: "A conta de anúncios Conta 01 está com pagamento pendente na Meta (saldo em aberto)." } })!;
    montar(h(CartaoDasAcoes, { mensagemId: "m1", acoes }));
    expect(screen.getByText(/Não mexi na conta: A conta de anúncios Conta 01 está com pagamento pendente/)).toBeTruthy();
  });

  it("a conversa traz o andamento real gravado na mensagem do dono", () => {
    const c = normalizarMensagensDoAgente({
      conversa_id: "c1",
      mensagens: [{ id: "u1", papel: "usuario", conteudo: "renomeia", criado_em: "2026-09-28T14:19:00Z", andamento: { tipo: "andamento", etapa: "executando", rotulo: "Renomeando a campanha X: relendo na Meta, fazendo e conferindo", fim: false, historico: [{ etapa: "recebido", rotulo: "Recebi o pedido", em: "x" }, { etapa: "executando", rotulo: "Renomeando", em: "y" }] } }],
    });
    expect(c.mensagens[0].andamento).toMatchObject({ etapa: "executando", fim: false });
    expect(c.mensagens[0].andamento!.historico).toHaveLength(2);
  });
});

describe("compatibilidade e texto dos arquivos novos", () => {
  it("sem travessão, lookbehind, \\p{}, grupo nomeado, .at( e flatMap", () => {
    const raiz = resolve(__dirname, "../..");
    for (const a of ["src/components/mesa-ads/GerenciadorAoVivo.tsx", "src/components/mesa-ads/gerenciadorApi.ts"]) {
      const t = readFileSync(resolve(raiz, a), "utf8");
      expect(t).not.toMatch(/[—–]/);
      expect(t).not.toMatch(/\(\?<[=!a-zA-Z]/);
      expect(t).not.toMatch(/\\p\{/);
      expect(t).not.toMatch(/\.at\(|\.flatMap\(/);
    }
  });
});
