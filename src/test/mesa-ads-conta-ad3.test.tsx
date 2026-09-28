import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente AD3 (28/09), aba Conta da Mesa Ads. Pedido do dono: o topo enxuto e alinhado; o Gerenciador
 * igual ao da Meta (abas Campanhas, Conjuntos e Anúncios com cor por nível, colunas alinhadas e a linha
 * de total); clicar e abrir o anúncio com o criativo, os números e o diagnóstico; Pausar, Retomar e
 * Otimizar na linha; filtro de data para a aba toda; e o relatório do período que já cai em Relatórios.
 * A função é simulada: nada sai para a Meta nem para o banco.
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
import AbaConta from "@/components/mesa-ads/AbaConta";
import { diagnosticoCurto, normalizarAnuncioAberto, normalizarGerenciador, nosDoNivel, pedidoDeOtimizar, totalDaLista } from "@/components/mesa-ads/gerenciadorApi";
import { chaveDoPeriodo, corpoDoPeriodo, resolverPeriodo } from "@/components/mesa-ads/periodoDaConta";
import { aprendizadoDaMeta, escolherProjetoDoRelatorio, linksDoAnuncio, qualidadeDaMeta, rotuloDoRanking, videoDaMeta } from "../../supabase/functions/mesa-ads/gerenciador";
import { montarRelatorioDeAnuncios, reais, type MetricasParaRelatorio } from "../../supabase/functions/mesa-ads/relatorio-ads";

const raiz = resolve(__dirname, "../..");
const CLIENTE = "77777777-7777-7777-7777-777777777777";

const valor = (): MesaValor => ({
  clientId: CLIENTE, clientName: "Verzelo", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 50,
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

const CONTA = "1871637719955892";
const m = (gasto: number, resultados: number, rotulo = "Conversas iniciadas") => ({
  gasto, impressoes: gasto * 50, resultados, resultado_rotulo: rotulo, custo_por_resultado: resultados ? Math.round((gasto / resultados) * 100) / 100 : null, ctr_link: 1.2, cpm: 20, frequencia: 1.4, alcance: gasto * 30, cliques_link: gasto * 0.6,
});
const entrega = (estado: string, rotulo: string, motivo: string | null = null) => ({ estado, rotulo, motivo });
const no = (nivel: string, id: string, nome: string, extra: Record<string, unknown> = {}) => ({
  nivel, id, nome, conta: CONTA, campaign_id: "120000000000001", adset_id: nivel === "campanha" ? null : "130000000000001", status: "ACTIVE", efetivo: "ACTIVE",
  entrega: entrega("entregando", "Entregando"), objetivo: null, otimizacao: null, orcamento_diario_brl: null, orcamento_total_brl: null, metricas: m(40, 8),
  hoje: { gasto: 12, impressoes: 300 }, link_meta: `https://business.facebook.com/adsmanager/manage/ads?act=${CONTA}&selected_ad_ids=${id}`, marca: null, filhos: [], ...extra,
});

const ANUNCIO_A = no("anuncio", "140000000000001", "Reel do jardim");
const ANUNCIO_B = no("anuncio", "140000000000002", "Carrossel antes e depois", { metricas: m(20, 2) });
const CONJUNTO = no("conjunto", "130000000000001", "Curitiba 25 a 55", { filhos: [ANUNCIO_A, ANUNCIO_B], metricas: m(60, 10) });
const LEITURA = {
  plataformas: [{ id: "meta", nome: "Meta Ads", conectada: true, lida: true, motivo: null }],
  contas: [{
    id: CONTA, nome: "Verzelo Paisagismo", moeda: "BRL", situacao: { codigo: 1, rotulo: "Ativa", travada: false, motivo: null, o_que_fazer: null },
    saldo_a_pagar_brl: 0, gasto_total_brl: 5000, link_meta: `https://business.facebook.com/adsmanager/manage/campaigns?act=${CONTA}`,
    link_cobranca: `https://business.facebook.com/billing_hub/accounts/details?asset_id=${CONTA}`, fonte: "meta_ao_vivo", lido_em: "2026-09-28T15:00:00Z", aviso: null,
  }],
  campanhas: [
    no("campanha", "120000000000001", "Mensagens | Jardim", { orcamento_diario_brl: 40, filhos: [CONJUNTO], metricas: m(60, 10) }),
    no("campanha", "120000000000009", "Tráfego | Site", { campaign_id: "120000000000009", orcamento_diario_brl: 20, metricas: m(30, 90, "Visitas à página") }),
  ],
  resumo: { campanhas: 2, campanhas_ativas: 2, campanhas_entregando: 2, conjuntos_ativos: 1, anuncios: 2, anuncios_ativos: 2, anuncios_entregando: 2, anuncios_com_problema: 0, gasto_hoje: 24, impressoes_hoje: 600, gasto_periodo: 90, resultados_periodo: 100, alertas: [] },
  periodo: { inicio: "2026-09-15", fim: "2026-09-28", dias: 14 },
  fonte: "meta_ao_vivo", lido_em: "2026-09-28T15:00:00Z", sincronizado_em: "2026-09-28T14:50:00Z", gestao: { disponivel: true, motivo: null }, avisos: [], gravada_em: null,
};

const ANUNCIO_ABERTO = {
  anuncio: {
    ad_id: "140000000000001", nome: "Reel do jardim",
    criativo: { titulo: "Seu jardim pronto em 7 dias", corpo: "Projeto, plantio e manutenção.", descricao: null, cta: "Enviar mensagem", destino: "WhatsApp", imagem_url: "https://scontent.test/capa.jpg", video: { fonte: "https://video.test/reel.mp4", capa: "https://scontent.test/capa.jpg", duracao_s: 21, link: null } },
    links: { previa: "https://fb.me/previa-reel", instagram: "https://www.instagram.com/p/abc", meta: `https://business.facebook.com/adsmanager/manage/ads?act=${CONTA}&selected_ad_ids=140000000000001` },
    qualidade: { qualidade: { valor: "ABOVE_AVERAGE", rotulo: "Acima da média", tom: "bom" }, engajamento: null, conversao: null },
    aprendizado: { estado: "aprendendo", rotulo: "Em aprendizado", motivo: "A Meta ainda está aprendendo a entregar este conjunto (12 de cerca de 50 resultados na semana). Evite mexer em verba e público agora." },
    fonte: "meta_ao_vivo", aviso: null, lido_em: "2026-09-28T15:01:00Z",
  },
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

describe("período da aba (hoje, ontem, 7, 14, 30, este mês, mês passado, livre)", () => {
  it("resolve as datas em Brasília e manda só { dias } nos últimos N dias", () => {
    const hoje = "2026-09-28";
    expect(resolverPeriodo({ preset: "hoje" }, hoje)).toMatchObject({ inicio: hoje, fim: hoje, dias: 1, ultimos: false });
    expect(resolverPeriodo({ preset: "ontem" }, hoje)).toMatchObject({ inicio: "2026-09-27", fim: "2026-09-27", dias: 1 });
    expect(resolverPeriodo({ preset: "7" }, hoje)).toMatchObject({ inicio: "2026-09-22", fim: hoje, dias: 7, ultimos: true });
    expect(resolverPeriodo({ preset: "este_mes" }, hoje)).toMatchObject({ inicio: "2026-09-01", fim: hoje, dias: 28 });
    expect(resolverPeriodo({ preset: "mes_passado" }, hoje)).toMatchObject({ inicio: "2026-08-01", fim: "2026-08-31", dias: 31, rotulo: "Mês passado" });
    expect(resolverPeriodo({ preset: "mes_passado" }, "2026-03-10")).toMatchObject({ inicio: "2026-02-01", fim: "2026-02-28" });
    expect(resolverPeriodo({ preset: "livre", inicio: "2026-09-02", fim: "2026-09-10" }, hoje)).toMatchObject({ dias: 9, rotulo: "02/09 a 10/09" });
    // Livre inválido cai nos 14 dias; fim no futuro vira hoje; mais de 180 dias é cortado.
    expect(resolverPeriodo({ preset: "livre", inicio: "2026-09-10", fim: "2026-09-02" }, hoje)).toMatchObject({ preset: "14", dias: 14 });
    expect(resolverPeriodo({ preset: "livre", inicio: "2026-09-20", fim: "2026-12-01" }, hoje)).toMatchObject({ fim: hoje, dias: 9 });
    expect(resolverPeriodo({ preset: "livre", inicio: "2025-01-01", fim: hoje }, hoje).dias).toBe(180);
    expect(corpoDoPeriodo(resolverPeriodo({ preset: "14" }, hoje))).toEqual({ dias: 14 });
    expect(corpoDoPeriodo(resolverPeriodo({ preset: "ontem" }, hoje))).toEqual({ dias: 1, inicio: "2026-09-27", fim: "2026-09-27" });
    expect(corpoDoPeriodo(30)).toEqual({ dias: 30 });
    expect(chaveDoPeriodo(resolverPeriodo({ preset: "14" }, hoje))).toBe(14);
    expect(chaveDoPeriodo(resolverPeriodo({ preset: "hoje" }, hoje))).toBe("2026-09-28_2026-09-28");
  });

  it("na aba: escolher Ontem relê a conta e o gerenciador com inicio e fim", { timeout: 20000 }, async () => {
    responder({ gerenciador_ler: LEITURA, conta_ao_vivo: { conectada: true, periodo: { inicio: "2026-09-15", fim: "2026-09-28" }, anuncios: [], campanhas: [], totais: {} } });
    montar(h(AbaConta, {}));
    await screen.findByRole("region", { name: "Gerenciador de anúncios" });
    fireEvent.click(screen.getByRole("button", { name: "Período: 14 dias" }));
    fireEvent.click(await screen.findByRole("option", { name: "Ontem" }));
    const ontem = resolverPeriodo({ preset: "ontem" });
    await waitFor(() => expect(chamadas("conta_ao_vivo").some((c) => c.inicio === ontem.inicio && c.fim === ontem.fim && c.dias === 1)).toBe(true));
    await waitFor(() => expect(chamadas("gerenciador_ler").some((c) => c.inicio === ontem.inicio && c.fim === ontem.fim)).toBe(true));
    // Período livre: as duas datas e o Aplicar.
    fireEvent.click(screen.getByRole("button", { name: "Período: Ontem" }));
    fireEvent.click(await screen.findByRole("option", { name: "Período livre" }));
    const livre = screen.getByRole("form", { name: "Período livre" });
    fireEvent.change(within(livre).getByLabelText("De"), { target: { value: "2026-09-01" } });
    fireEvent.change(within(livre).getByLabelText("Até"), { target: { value: "2026-09-10" } });
    fireEvent.click(within(livre).getByRole("button", { name: /Aplicar/ }));
    await waitFor(() => expect(chamadas("conta_ao_vivo").some((c) => c.inicio === "2026-09-01" && c.fim === "2026-09-10" && c.dias === 10)).toBe(true));
  });
});

describe("gerenciador como o da Meta", () => {
  it("abas por nível com cor e contagem, colunas alinhadas, linha de total e descer pelo nome", async () => {
    responder({ gerenciador_ler: LEITURA });
    montar(h(GerenciadorAoVivo, { dias: 14 }));
    const g = await screen.findByRole("region", { name: "Gerenciador de anúncios" });
    await within(g).findByText("Mensagens | Jardim");
    const abas = within(g).getByRole("tablist", { name: "Nível do gerenciador" });
    expect(within(abas).getByRole("tab", { name: /Campanhas 2/ }).getAttribute("aria-selected")).toBe("true");
    expect(within(abas).getByRole("tab", { name: /Conjuntos 1/ })).toBeTruthy();
    expect(within(abas).getByRole("tab", { name: /Anúncios 2/ })).toBeTruthy();
    const tabela = within(g).getByRole("table", { name: "Campanhas no gerenciador" });
    const cabecalho = within(tabela).getAllByRole("columnheader").map((c) => c.textContent);
    expect(cabecalho).toEqual(["Campanha", "Entrega", "Orçamento", "Resultados", "Custo por resultado", "Gasto", "Alcance", "Impressões", "CTR", "CPM", "Frequência"]);
    // Cada linha com a cor do nível (faixa) e as mesmas colunas.
    const linha = tabela.querySelector("[data-no='120000000000001']") as HTMLElement;
    expect(linha.querySelector(".bg-sky-500")).toBeTruthy();
    expect(within(linha).getAllByRole("cell")).toHaveLength(11);
    // Total: gasto somado; resultados de tipos diferentes não somam.
    const total = tabela.querySelector("[data-total]") as HTMLElement;
    expect(within(total).getByText("Total de 2 campanhas")).toBeTruthy();
    expect(within(total).getByText(/R\$\s?90,00/)).toBeTruthy();
    expect(within(total).getByText("Vários tipos")).toBeTruthy();
    // O nome da campanha desce para os conjuntos dela (com o x para sair); o do conjunto, para os anúncios.
    fireEvent.click(within(tabela).getByRole("button", { name: "Mensagens | Jardim" }));
    expect(within(g).getByRole("tab", { name: /Conjuntos 1/ }).getAttribute("aria-selected")).toBe("true");
    expect(within(g).getByText("Campanha: Mensagens | Jardim")).toBeTruthy();
    const conjuntos = within(g).getByRole("table", { name: "Conjuntos no gerenciador" });
    expect((conjuntos.querySelector("[data-no='130000000000001']") as HTMLElement).querySelector(".bg-violet-500")).toBeTruthy();
    fireEvent.click(within(conjuntos).getByRole("button", { name: "Curitiba 25 a 55" }));
    const anuncios = within(g).getByRole("table", { name: "Anúncios no gerenciador" });
    expect(within(anuncios).getByText("Total de 2 anúncios")).toBeTruthy();
    expect(within(anuncios).getByText("Carrossel antes e depois")).toBeTruthy();
    fireEvent.click(within(g).getByRole("button", { name: "Ver todos, sem Curitiba 25 a 55" }));
    expect(within(g).queryByText("Conjunto: Curitiba 25 a 55")).toBeNull();
  });

  it("Pausar na linha abre a confirmação já em Pausar e manda gerenciador_acao; Otimizar leva o item ao agente", async () => {
    responder({
      gerenciador_ler: LEITURA,
      gerenciador_acao: { resultado: { ok: true, feito_em: "2026-09-28T15:10:00Z", relido_em: "2026-09-28T15:10:02Z", antes: { status: "ACTIVE" }, depois: { status: "PAUSED" }, resposta: { success: true } }, resumo: "Pausou a campanha Tráfego | Site.", acao_id: "ac-1" },
    });
    const onOtimizar = vi.fn();
    montar(h(GerenciadorAoVivo, { dias: 14, onOtimizar }));
    const g = await screen.findByRole("region", { name: "Gerenciador de anúncios" });
    await within(g).findByText("Tráfego | Site");
    fireEvent.click(within(g).getByRole("button", { name: "Otimizar Tráfego | Site" }));
    expect(onOtimizar).toHaveBeenCalledTimes(1);
    expect(onOtimizar.mock.calls[0][0]).toMatchObject({ id: "120000000000009", nivel: "campanha" });
    fireEvent.click(within(g).getByRole("button", { name: "Pausar Tráfego | Site" }));
    const painel = within(g).getByRole("group", { name: "Ações em Tráfego | Site" });
    expect(within(painel).getByRole("button", { name: /Pausar/ }).getAttribute("aria-pressed")).toBe("true");
    expect(within(painel).getByText(/Pausar a campanha Tráfego \| Site\./)).toBeTruthy();
    fireEvent.click(within(painel).getByRole("button", { name: /Confirmar/ }));
    await waitFor(() => expect(chamadas("gerenciador_acao")[0]).toEqual({ acao: "gerenciador_acao", client_id: CLIENTE, tipo: "pausar", nivel: "campanha", meta_id: "120000000000009", nome_atual: "Tráfego | Site" }));
    expect(await within(painel).findByText(/Feito e conferido na Meta às 12:10/)).toBeTruthy();
  });

  it("conta travada: Pausar e Retomar da linha ficam só leitura, com o motivo no título", async () => {
    responder({ gerenciador_ler: { ...LEITURA, gestao: { disponivel: false, motivo: "Saldo em aberto na Meta." } } });
    montar(h(GerenciadorAoVivo, { dias: 14 }));
    const g = await screen.findByRole("region", { name: "Gerenciador de anúncios" });
    const pausar = (await within(g).findByRole("button", { name: "Pausar Tráfego | Site" })) as HTMLButtonElement;
    expect(pausar.disabled).toBe(true);
    expect(pausar.getAttribute("title")).toBe("Saldo em aberto na Meta.");
  });

  it("clicar no anúncio abre o painel ao lado: vídeo, texto, números, diagnóstico curto e as ações", async () => {
    responder({ gerenciador_ler: LEITURA, gerenciador_anuncio: ANUNCIO_ABERTO });
    const onOtimizar = vi.fn();
    const onVariar = vi.fn();
    montar(h(GerenciadorAoVivo, {
      dias: 14,
      onOtimizar,
      onVariar,
      anuncios: [{ ad_id: "140000000000001", nome: "Reel do jardim", imagem_url: "https://arquivo.test/ficha.png", titulo: "", corpo: "", cta: "", destino: "", sinal: "escalar", diagnostico: null, tendencia: { ctr_var_pct: -30, custo_resultado_var_pct: null, frequencia: 3.4 }, referencia_id: "ref-1" }],
    }));
    const g = await screen.findByRole("region", { name: "Gerenciador de anúncios" });
    await within(g).findByText("Mensagens | Jardim");
    fireEvent.click(within(g).getByRole("tab", { name: /Anúncios 2/ }));
    fireEvent.click(within(g).getByRole("button", { name: "Reel do jardim" }));
    const painel = await screen.findByRole("dialog", { name: "Anúncio Reel do jardim" });
    await waitFor(() => expect(chamadas("gerenciador_anuncio")[0]).toEqual({ acao: "gerenciador_anuncio", client_id: CLIENTE, ad_id: "140000000000001", dias: 14 }));
    const video = (await within(painel).findByLabelText("Vídeo de Reel do jardim")) as HTMLVideoElement;
    expect(video.getAttribute("src")).toBe("https://video.test/reel.mp4");
    expect(within(painel).getByText("Seu jardim pronto em 7 dias")).toBeTruthy();
    expect(within(painel).getByText("Enviar mensagem")).toBeTruthy();
    expect(within(painel).getByRole("link", { name: /Prévia na Meta/ }).getAttribute("href")).toBe("https://fb.me/previa-reel");
    const diag = within(painel).getByRole("region", { name: "Diagnóstico" });
    expect(within(diag).getByText("Acima da média")).toBeTruthy();
    // Frequência do período (1,4, a da linha) vale mais que a da tendência; o clique caiu 30%: atenção.
    expect(within(diag).getByText("Atenção")).toBeTruthy();
    expect(within(diag).getByText("O clique caiu na segunda metade do período.")).toBeTruthy();
    expect(within(diag).getByText("Em aprendizado")).toBeTruthy();
    const numeros = within(painel).getByRole("region", { name: "Números do período" });
    expect(within(numeros).getByText("Conversas iniciadas")).toBeTruthy();
    fireEvent.click(within(painel).getByRole("button", { name: /^Otimizar/ }));
    expect(onOtimizar.mock.calls[0][0]).toMatchObject({ id: "140000000000001", nivel: "anuncio" });
    fireEvent.click(within(painel).getByRole("button", { name: /Criar variações/ }));
    expect(onVariar).toHaveBeenCalledWith("140000000000001");
    fireEvent.click(within(painel).getByRole("button", { name: "Fechar o anúncio" }));
    expect(screen.queryByRole("dialog", { name: "Anúncio Reel do jardim" })).toBeNull();
  });

  it("sem gestão por permissão (conta ativa), o topo diz Só leitura agora com o motivo", () => {
    montar(h(SituacaoDaConta, { leitura: normalizarGerenciador({ ...LEITURA, gestao: { disponivel: false, motivo: "Falta ads_management." } }), carregando: false, erro: null }));
    const s = screen.getByRole("region", { name: "Situação da conta" });
    expect(within(s).getByText("Só leitura agora: Falta ads_management.")).toBeTruthy();
    expect(within(s).getByText("Ativa")).toBeTruthy();
    expect(s.querySelector("[data-travada='nao']")).toBeTruthy();
  });
});

describe("relatório do período", () => {
  it("o botão gera o relatório com o período e mostra o link para Relatórios", { timeout: 20000 }, async () => {
    responder({
      gerenciador_ler: LEITURA,
      conta_ao_vivo: { conectada: true, periodo: { inicio: "2026-09-15", fim: "2026-09-28" }, anuncios: [], campanhas: [], totais: {} },
      relatorio_ads_gerar: { relatorio: { id: "11111111-2222-3333-4444-555555555555", titulo: "Anúncios · Verzelo · 15/09 a 28/09/2026", status: "draft", projeto: { id: "p", nome: "Tráfego Verzelo" }, atualizado: false, link: "/relatorios/11111111-2222-3333-4444-555555555555" } },
    });
    montar(h(AbaConta, {}));
    await screen.findByRole("region", { name: "Gerenciador de anúncios" });
    const botao = await screen.findByRole("button", { name: /Relatório/ });
    await waitFor(() => expect((botao as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(botao);
    await waitFor(() => expect(chamadas("relatorio_ads_gerar")).toEqual([{ acao: "relatorio_ads_gerar", client_id: CLIENTE, dias: 14 }]));
    const aviso = await screen.findByRole("status");
    expect(within(aviso).getByText(/Relatório criado em Relatórios, como rascunho \(projeto Tráfego Verzelo\)/)).toBeTruthy();
    expect(within(aviso).getByRole("link", { name: "Abrir o relatório" }).getAttribute("href")).toBe("/relatorios/11111111-2222-3333-4444-555555555555");
  });
});

describe("regras puras (tela)", () => {
  const arvore = normalizarGerenciador(LEITURA).campanhas;
  it("níveis, total, pedido do Otimizar e diagnóstico curto", () => {
    expect(nosDoNivel(arvore, "conjunto").map((n) => n.id)).toEqual(["130000000000001"]);
    expect(nosDoNivel(arvore, "anuncio", "130000000000001")).toHaveLength(2);
    expect(nosDoNivel(arvore, "anuncio", "120000000000009")).toHaveLength(0);
    const t = totalDaLista(nosDoNivel(arvore, "anuncio"));
    expect(t).toMatchObject({ quantos: 2, gasto: 60, resultados: 10, resultado_rotulo: "Conversas iniciadas", custo_por_resultado: 6, cpm: 20, ctr_link: 1.2, hoje: 24 });
    const p = pedidoDeOtimizar(arvore[0], "de 15/09 a 28/09");
    expect(p).toContain('Otimizar a campanha "Mensagens | Jardim" (id 120000000000001) sem criar nada do zero');
    expect(p).toContain("R$ 60,00 gastos, 10 conversas iniciadas a R$ 6,00 cada");
    const semDado = diagnosticoCurto({ qualidade: null, aprendizado: null, frequencia: null, ctr_var_pct: null, impressoes: 100 });
    expect(semDado.map((d) => d.valor)).toEqual(["Pouca entrega para avaliar", "Sem leitura", "Sem leitura"]);
    const atencao = diagnosticoCurto({ qualidade: null, aprendizado: null, frequencia: 2.6, ctr_var_pct: 5, impressoes: 3000 });
    expect(atencao[1]).toMatchObject({ valor: "Atenção", tom: "medio" });
    const cansado = diagnosticoCurto({ qualidade: null, aprendizado: { estado: "limitado", rotulo: "Aprendizado limitado", motivo: "x" }, frequencia: 3.4, ctr_var_pct: -30, impressoes: 9000 });
    expect(cansado[1]).toMatchObject({ valor: "Cansando o público", tom: "ruim", dica: "Frequência 3,4 e o clique caindo: hora de variar o criativo." });
    expect(cansado[2]).toMatchObject({ valor: "Aprendizado limitado", tom: "ruim" });
    const aberto = normalizarAnuncioAberto({ anuncio: { ...ANUNCIO_ABERTO.anuncio, links: { previa: "javascript:alert(1)", meta: "https://mal.test/x" } } })!;
    expect(aberto.links).toEqual({ previa: null, instagram: null, meta: null });
    expect(normalizarAnuncioAberto({ ok: true })).toBeNull();
  });
});

// ------------------------------------------------------------------ servidor (puro)

const met = (x: Partial<MetricasParaRelatorio>): MetricasParaRelatorio => ({
  gasto: 0, impressoes: 0, alcance: null, cliques_link: null, resultados: 0, resultado_rotulo: "Conversas iniciadas", resultado_tipo: "mensagens",
  custo_por_resultado: null, cpm: null, frequencia: null, valor_conversao: null, roas: null, acoes: {}, ...x,
});

describe("servidor: relatório de anúncios (relatorio-ads.ts)", () => {
  const entrada = {
    cliente: "Verzelo",
    periodo: { inicio: "2026-09-01", fim: "2026-09-28", dias: 28 },
    totais: met({ gasto: 1234.56, impressoes: 60000, alcance: 21000, cliques_link: 900, resultados: 45, custo_por_resultado: 27.43, cpm: 20.58, frequencia: 2.86, acoes: { mensagens: 45, cliques_link: 900 } }),
    comparacao: { gasto_pct: 12.4, resultados_pct: 30, custo_por_resultado_pct: -14, ctr_link_pct: null, cpm_pct: 2 },
    serie: [{ dia: "2026-09-02", gasto: 40, resultados: 2 }, { dia: "2026-09-01", gasto: 30, resultados: 1 }],
    campanhas: [
      { nome: "Mensagens | Jardim", status: "ACTIVE", metricas: met({ gasto: 900, impressoes: 40000, resultados: 36, custo_por_resultado: 25, cliques_link: 600, alcance: 15000 }) },
      { nome: "Mensagens | Manutenção", status: "ACTIVE", metricas: met({ gasto: 334.56, impressoes: 20000, resultados: 9, custo_por_resultado: 37.17, cliques_link: 300 }) },
      { nome: "Parada", status: "PAUSED", metricas: met({}) },
    ],
    anuncios: [
      { nome: "Reel do jardim", status: "ACTIVE", sinal: "escalar", metricas: met({ gasto: 500, resultados: 25, custo_por_resultado: 20 }), frequencia: 1.8, ctr_var_pct: 3 },
      { nome: "Carrossel", status: "ACTIVE", sinal: "renovar", metricas: met({ gasto: 300, resultados: 8, custo_por_resultado: 37.5 }), frequencia: 3.6, ctr_var_pct: -28 },
      { nome: "Post antigo", status: "ACTIVE", sinal: "pausar", metricas: met({ gasto: 80, resultados: 0 }), frequencia: 2, ctr_var_pct: null },
      { nome: "Nunca rodou", status: "PAUSED", sinal: "sem_dados", metricas: met({}), frequencia: null, ctr_var_pct: null },
    ],
    contas: [{ nome: "Verzelo Paisagismo", saldo_a_pagar: 14.86 }],
    gerado_em: "2026-09-28T15:00:00Z",
  };

  it("título, resumo, destaques e próximos passos em regra, sem travessão", () => {
    const r = montarRelatorioDeAnuncios(entrada);
    expect(r.title).toBe("Anúncios · Verzelo · 01/09 a 28/09/2026");
    expect(r.summary).toContain("De 01/09 a 28/09/2026 (28 dias), R$ 1.234,56 investidos em 2 campanhas trouxeram 45 conversas iniciadas, a R$ 27,43 cada.");
    expect(r.summary).toContain("Frente aos 28 dias anteriores: investimento +12%, resultados +30%, custo por resultado -14%.");
    expect(r.summary).toContain("· Mensagens | Jardim: R$ 900,00, 36 conversas iniciadas (R$ 25,00 cada), CTR 1,50%.");
    expect(r.summary).toContain("Criativos: 3 anúncios rodaram no período; 1 com sinal de escalar, 1 pedindo criativo novo, 1 para pausar.");
    expect(r.highlights).toContain("Campanha mais eficiente: Mensagens | Jardim, 36 conversas iniciadas a R$ 25,00 cada.");
    expect(r.highlights).toContain("Melhor criativo: Reel do jardim");
    expect(r.highlights).toContain("O custo por resultado caiu 14%");
    expect(r.next_steps).toContain("· Reforçar a verba de Reel do jardim, subindo até 30% por vez");
    expect(r.next_steps).toContain("Criar variações de Carrossel: o público já viu muito (frequência 3,6)");
    expect(r.next_steps).toContain("Pausar Post antigo");
    expect(r.next_steps).toContain("Quitar R$ 14,86 em aberto na conta Verzelo Paisagismo");
    expect(JSON.stringify(r)).not.toMatch(/[—–]/);
  });

  it("métricas nos nomes da tela de relatório, a quebra por campanha e a série em ordem", () => {
    const r = montarRelatorioDeAnuncios(entrada);
    expect(r.metrics).toMatchObject({ ad_spend: 1234.56, impressions: 60000, reach: 21000, link_clicks: 900, results: 45, cost_per_result: 27.43, ctr: 1.5, cpm: 20.58, frequency: 2.86, messages: 45, source: "mesa_ads", __source: "meta_ads", __dimension: "Campanha" });
    expect((r.metrics.__breakdown as Record<string, unknown>[])).toHaveLength(2);
    expect((r.metrics.__breakdown as Record<string, unknown>[])[0]).toMatchObject({ Campanha: "Mensagens | Jardim", "Valor usado": 900, Resultados: 36 });
    expect(r.chart_data.map((d) => d.label)).toEqual(["01/09", "02/09"]);
    expect(r.chart_data[0]).toMatchObject({ Investido: 30, "Conversas iniciadas": 1 });
    expect(r.chart_type).toBe("area");
  });

  it("período sem gasto não inventa análise", () => {
    const r = montarRelatorioDeAnuncios({ ...entrada, totais: met({}), comparacao: null, campanhas: [], anuncios: [], contas: [], serie: [] });
    expect(r.summary).toBe("De 01/09 a 28/09/2026 (28 dias), não houve investimento em anúncios nas contas ligadas.");
    expect(r.next_steps).toBe("· Definir a campanha do próximo período com o objetivo e a verba.");
    expect(r.metrics.__breakdown).toBeUndefined();
    expect(reais(1234567.8)).toBe("R$ 1.234.567,80");
  });

  it("projeto do relatório: o pedido deste cliente, senão o vivo de tráfego ou marketing", () => {
    const projetos = [
      { id: "a", name: "Site", project_type: "site", status: "active", updated_at: "2026-09-20" },
      { id: "b", name: "Social", project_type: "social_media", status: "active", updated_at: "2026-09-10" },
      { id: "c", name: "Tráfego", project_type: "traffic", status: "standby", updated_at: "2026-08-01" },
      { id: "d", name: "Tráfego antigo", project_type: "traffic", status: "done", updated_at: "2026-09-27" },
      { id: "e", name: "Apagado", project_type: "traffic", status: "active", deleted_at: "2026-09-01" },
    ];
    expect(escolherProjetoDoRelatorio(projetos)!.id).toBe("c");
    expect(escolherProjetoDoRelatorio(projetos, "a")!.id).toBe("a");
    expect(escolherProjetoDoRelatorio(projetos, "e")!.id).toBe("c");
    expect(escolherProjetoDoRelatorio([{ id: "d", name: "x", project_type: "traffic", status: "done" }])!.id).toBe("d");
    expect(escolherProjetoDoRelatorio([])).toBeNull();
  });
});

describe("servidor: o anúncio aberto (gerenciador.ts)", () => {
  it("rankings, aprendizado, vídeo e links, só https", () => {
    expect(rotuloDoRanking("BELOW_AVERAGE_20")).toMatchObject({ tom: "ruim", rotulo: "Abaixo da média (20% piores)" });
    expect(rotuloDoRanking("UNKNOWN")).toBeNull();
    expect(qualidadeDaMeta({ data: [{ quality_ranking: "AVERAGE", engagement_rate_ranking: "ABOVE_AVERAGE" }] })).toMatchObject({ qualidade: { rotulo: "Na média" }, engajamento: { tom: "bom" }, conversao: null });
    expect(qualidadeDaMeta(null)).toEqual({ qualidade: null, engajamento: null, conversao: null });
    expect(aprendizadoDaMeta({ learning_stage_info: { status: "LEARNING", conversions: 12 } })!.motivo).toContain("12 de cerca de 50 resultados");
    expect(aprendizadoDaMeta({ learning_stage_info: { status: "FAIL" } })!.estado).toBe("limitado");
    expect(aprendizadoDaMeta({})).toBeNull();
    const v = videoDaMeta({ source: "https://video.test/a.mp4", picture: "https://img.test/p.jpg", length: 21.5, permalink_url: "/reel/123", thumbnails: { data: [{ uri: "https://img.test/pequena.jpg", width: 120 }, { uri: "https://img.test/grande.jpg", width: 720 }] } })!;
    expect(v).toEqual({ fonte: "https://video.test/a.mp4", capa: "https://img.test/grande.jpg", duracao_s: 21.5, link: "https://www.facebook.com/reel/123" });
    expect(videoDaMeta({ source: "http://inseguro.test/a.mp4" })).toBeNull();
    expect(linksDoAnuncio({ preview_shareable_link: "https://fb.me/x", creative: { instagram_permalink_url: "javascript:1" } })).toEqual({ previa: "https://fb.me/x", instagram: null });
  });

  it("index.ts: rotas novas, leitura direta, conta do cliente conferida e relatório só em rascunho", () => {
    const fonte = readFileSync(resolve(raiz, "supabase/functions/mesa-ads/index.ts"), "utf8");
    expect(fonte).toContain("gerenciador_anuncio: gerenciadorAnuncio,");
    expect(fonte).toContain("relatorio_ads_gerar: relatorioAdsGerar,");
    const longas = fonte.slice(fonte.indexOf("const ACOES_LONGAS"), fonte.indexOf("]);", fonte.indexOf("const ACOES_LONGAS")));
    expect(longas).not.toContain('"gerenciador_anuncio"');
    expect(longas).not.toContain('"relatorio_ads_gerar"');
    const anuncio = fonte.slice(fonte.indexOf("async function gerenciadorAnuncio("), fonte.indexOf("function paraRelatorio("));
    expect(anuncio).toContain("exigirAcessoAoCliente(chamador, clientId)");
    expect(anuncio).toContain("foraDasContas(bruto, contas)");
    expect(anuncio).toContain("TETO_DO_ANUNCIO_MS");
    const relatorio = fonte.slice(fonte.indexOf("async function relatorioAdsGerar("), fonte.indexOf("/** Clientes por chamada do cron"));
    expect(relatorio).toContain('status: "draft"');
    expect(relatorio).not.toContain('"published"');
    expect(relatorio).toContain('.contains("metrics", { source: "mesa_ads" })');
    expect(fonte).toContain("periodoDoPedido({ dias: corpo.dias, inicio: corpo.inicio, fim: corpo.fim }, DIAS_CONTA, 14, hojeSaoPaulo());\n  const chave = `${clientId}:${periodo.inicio}:${periodo.fim}`;");
  });
});

describe("compatibilidade e texto dos arquivos da frente AD3", () => {
  it("sem travessão, lookbehind, \\p{}, grupo nomeado, .at( e flatMap", () => {
    for (const a of [
      "src/components/mesa-ads/GerenciadorAoVivo.tsx",
      "src/components/mesa-ads/gerenciadorApi.ts",
      "src/components/mesa-ads/periodoDaConta.ts",
      "src/components/mesa-ads/SeletorDePeriodo.tsx",
    ]) {
      const t = readFileSync(resolve(raiz, a), "utf8");
      expect(t, a).not.toMatch(/[—–]/);
      expect(t, a).not.toMatch(/\(\?<[=!a-zA-Z]/);
      expect(t, a).not.toMatch(/\\p\{/);
      expect(t, a).not.toMatch(/\.at\(|\.flatMap\(/);
      expect(t, a).not.toMatch(/aspect-|:has\(/);
    }
  });
});
