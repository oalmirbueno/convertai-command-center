import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mesa Ads (docs/mesa-ads/SPEC.md): a tela das cinco etapas contra o
 * contrato da função mesa-ads. A função e as tabelas são simuladas; o teste
 * confere a rota, as etapas e os campos que cada ação manda.
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  upload: vi.fn(),
  rpc: vi.fn(),
  tabelas: {} as Record<string, unknown>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range", "update", "insert"]) b[m] = () => b;
    const primeiro = () => ({ data: Array.isArray(dados) ? (dados[0] === undefined ? null : dados[0]) : dados, error: null });
    b.maybeSingle = () => Promise.resolve(primeiro());
    b.single = () => Promise.resolve(primeiro());
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null, count: Array.isArray(dados) ? dados.length : 0 }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: mock.rpc,
      from: (tabela: string) => consulta(tabela),
      storage: {
        from: () => ({
          upload: mock.upload,
          createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/img.png" }, error: null }),
        }),
      },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));

const CLIENTE = "11111111-1111-1111-1111-111111111111";
vi.mock("@/hooks/useSupabaseData", () => ({
  useClients: () => ({
    data: [{ id: "11111111-1111-1111-1111-111111111111", company_name: "Clínica Sintética" }],
    isLoading: false,
    isSuccess: true,
    isFetching: false,
    dataUpdatedAt: 1,
    refetch: vi.fn(),
  }),
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import type { ModeloIa } from "@/lib/mesa/api";
import MesaAds, { ETAPAS_DA_MESA_ADS } from "@/pages/MesaAds";
import AbaOferta from "@/components/mesa-ads/AbaOferta";
import AbaReferencias, { LINKS_UTEIS } from "@/components/mesa-ads/AbaReferencias";
import AbaPlano, { corpoDaProducao } from "@/components/mesa-ads/AbaPlano";
import PainelDaCopy, { textoVisivel } from "@/components/mesa-ads/PainelDaCopy";
import AbaResultados, { periodoDosUltimos } from "@/components/mesa-ads/AbaResultados";
import { GuiaDaZonaSegura } from "@/components/mesa-ads/ArteDoCriativo";
import { briefingParaSalvar, normalizarBriefing, notasDe10, origemDoLink, type CriativoAds, type PlanoAds } from "@/components/mesa-ads/adsApi";

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");

const catalogo: ModeloIa[] = [
  {
    id: "openai:gpt-texto", provedor: "openai", modelo_api: "gpt-texto", tipo: "texto", rotulo: "Texto",
    preco_entrada_1m: 1, preco_saida_1m: 2, preco_cache_1m: null, preco_imagem: null,
    raciocinio: ["low", "medium"], padrao_para: ["estrategista", "diretor_arte", "leitura"], ativo: true,
  },
  {
    id: "openai:gpt-image-2", provedor: "openai", modelo_api: "gpt-image-2", tipo: "imagem", rotulo: "Imagem",
    preco_entrada_1m: null, preco_saida_1m: null, preco_cache_1m: null, preco_imagem: { baixa: 0.01, media: 0.04, alta: 0.17 },
    raciocinio: [], padrao_para: ["imagem"], ativo: true,
  },
];

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Clínica Sintética",
  userId: "u-1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 50,
  catalogo,
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
});

function montar(filho: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(TooltipProvider, null, h(MesaProvider, { valor: valorDaMesa(), children: filho }))));
}

const chamadasDe = (acao: string) =>
  mock.invoke.mock.calls.filter((c: any[]) => c[0] === "mesa-ads" && c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);

const PLANO: PlanoAds = {
  id: "22222222-2222-2222-2222-222222222222",
  client_id: CLIENTE,
  briefing_id: "b-1",
  nome: "Plano de setembro",
  status: "rascunho",
  angulos: [
    {
      id: "a1",
      nome: "A dor da espera",
      situacao: "Espera de 40 minutos na recepção",
      mecanismo: "Contraste com a agenda cumprida",
      gancho_visual: "Relógio na parede",
      gancho_verbal: "Cansou de esperar?",
      prova: "Pontualidade registrada na agenda",
      hipotese: "Acreditamos que mostrar a agenda cumprida aumentará as conversas, porque a espera é a queixa mais citada.",
      metrica: "Conversas qualificadas",
      janela_dias: 7,
      formatos: ["feed_4x5", "stories_9x16"],
      jev: { clareza: 8, relevancia: 7, prova: 6, risco_politica: 9 },
    },
    {
      id: "a2",
      nome: "Prova do resultado",
      formatos: ["quadrado_1x1"],
      jev: { clareza: 0.9, relevancia: 0.8, prova: 0.5, risco_politica: 0.9 },
    },
  ],
  estrutura: {},
  pedido: null,
  conversa_id: null,
  custo_usd: 0,
  criado_em: "2026-09-23T12:00:00Z",
  atualizado_em: "2026-09-23T12:00:00Z",
};

beforeAll(() => {
  if (typeof (globalThis as any).ResizeObserver === "undefined") {
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  mock.tabelas = {};
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
  mock.rpc.mockResolvedValue({ data: { saldo_usd: 12.5, total_usd: 3.2, por_modelo: [], por_tarefa: [] }, error: null });
  mock.invoke.mockImplementation(async () => ({ data: { ok: true, custo_usd: 0.01 }, error: null }));
});

// ------------------------------------------------------------------ rota e casca

describe("rota e casca", () => {
  it("a rota /mesa-ads existe para admin, gestor e design, com Suspense próprio, e o menu da Mesa ganha Mesa Ads", () => {
    const app = ler("src/App.tsx");
    // A rota baixa pela pré-carga das mesas (frente U, 25/09): página e etapa juntas.
    expect(app).toContain('const MesaAds = PaginaMesaAds;');
    expect(readFileSync(resolve(__dirname, "../lib/mesa/preCarga.ts"), "utf8")).toContain('pagina: () => import("@/pages/MesaAds"),');
    const rota = app.split("\n").find((l) => l.indexOf('path="/mesa-ads"') >= 0) || "";
    expect(rota).toContain('["admin", "manager", "design"].includes(profile?.role || "")');
    expect(rota).toContain("<Suspense fallback={<EsqueletoDaMesa />}><MesaAds /></Suspense>");
    expect(rota).toContain('<Navigate to="/dashboard" replace />');
    // A regra da largura da Mesa já cobre /mesa-ads.
    expect(ler("src/components/AppLayout.tsx")).toContain('location.pathname.indexOf("/mesa") === 0');
    expect("/mesa-ads".indexOf("/mesa")).toBe(0);
    // Onde a Mesa aparece (Central), a Mesa Ads aparece ao lado.
    const central = ler("src/pages/AdminExperience.tsx");
    expect(central).toContain("navigate(`/mesa-ads?client=${client.id}`)");
    expect(central.indexOf("Mesa Ads")).toBeGreaterThan(central.indexOf("navigate(`/mesa?client=${client.id}&aba=estudio`)"));
  });

  it("a página mostra o seletor de cliente, o saldo e as seis etapas (Conta antes de Resultados); trocar de etapa muda o endereço", async () => {
    render(
      h(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        h(MemoryRouter, { initialEntries: [`/mesa-ads?client=${CLIENTE}`] }, h(TooltipProvider, null, h(MesaAds))),
      ),
    );
    expect(screen.getByRole("heading", { name: "Mesa Ads" }).className).toContain("sr-only");
    const nav = screen.getByRole("navigation", { name: "Etapas da Mesa Ads" });
    const botoes = within(nav).getAllByRole("button");
    expect(botoes.map((b) => b.textContent)).toEqual(["1Oferta", "2Referências", "3Plano de teste", "4Estúdio Ads", "5Conta", "6Resultados"]);
    expect(ETAPAS_DA_MESA_ADS.map((e) => e.valor)).toEqual(["oferta", "referencias", "plano", "estudio", "conta", "resultados"]);
    // No celular, as etapas quebram em duas linhas de três (sem rolagem lateral).
    expect(nav.className).toContain("grid-cols-3");
    expect(nav.className).toContain("sm:grid-cols-6");
    expect(botoes[0].getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("combobox", { name: /Cliente: Clínica Sintética/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Saldo e gasto do mês" })).toBeTruthy();
    fireEvent.click(botoes[1]);
    await waitFor(() => expect(within(nav).getAllByRole("button")[1].getAttribute("aria-current")).toBe("page"));
    expect(await screen.findByRole("button", { name: /Importar meus anúncios/ })).toBeTruthy();
  });
});

// ------------------------------------------------------------------ oferta

describe("etapa 1, oferta", () => {
  it("sem briefing, os campos aparecem como lacuna e salvar manda briefing_salvar com o que foi escrito", async () => {
    montar(h(AbaOferta));
    const produto = await screen.findByLabelText("Produto ou serviço");
    expect(screen.getAllByText("lacuna").length).toBeGreaterThan(5);
    expect(screen.getByText("Lacuna: nenhuma situação com fonte.")).toBeTruthy();
    const salvar = screen.getByRole("button", { name: /Salvar briefing/ });
    expect((salvar as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(produto, { target: { value: "Clareamento dental" } });
    fireEvent.click(screen.getByRole("radio", { name: /Sabe do problema/ }));
    fireEvent.click(screen.getByRole("button", { name: /Prova/ }));
    fireEvent.change(screen.getByLabelText("Prova 1"), { target: { value: "32 avaliações 5 estrelas no Google" } });
    fireEvent.change(screen.getByLabelText("Custo tolerável"), { target: { value: "25,50" } });
    fireEvent.click(screen.getByRole("button", { name: /Salvar briefing/ }));

    await waitFor(() => expect(chamadasDe("briefing_salvar")).toHaveLength(1));
    const corpo = chamadasDe("briefing_salvar")[0];
    expect(corpo.client_id).toBe(CLIENTE);
    expect(corpo.briefing.oferta.produto).toBe("Clareamento dental");
    expect(corpo.briefing.publico.estagio_consciencia).toBe("problema");
    expect(corpo.briefing.provas).toEqual([{ tipo: "depoimento", texto: "32 avaliações 5 estrelas no Google", fonte: "", autorizado: false, periodo: "" }]);
    expect(corpo.briefing.objetivo.custo_toleravel_brl).toBe(25.5);
  });

  it("sugerir pelo contexto chama briefing_sugerir e mostra as lacunas, sem gravar", async () => {
    mock.invoke.mockImplementation(async (_f: string, { body }: any) =>
      body.acao === "briefing_sugerir"
        ? { data: { sugestao: { oferta: { produto: "Implante" } }, lacunas: ["preço confirmado", "provas"], custo_usd: 0.02 }, error: null }
        : { data: { ok: true }, error: null },
    );
    montar(h(AbaOferta));
    fireEvent.click(await screen.findByRole("button", { name: /Sugerir pelo contexto/ }));
    await waitFor(() => expect(chamadasDe("briefing_sugerir")).toEqual([{ acao: "briefing_sugerir", client_id: CLIENTE }]));
    expect(await screen.findByText("preço confirmado")).toBeTruthy();
    expect((screen.getByLabelText("Produto ou serviço") as HTMLInputElement).value).toBe("Implante");
    expect(chamadasDe("briefing_salvar")).toHaveLength(0);
  });

  it("normalização e envio: nada é inventado e linhas vazias não vão", () => {
    const b = normalizarBriefing({ publico: { situacoes: ["Sem tempo no almoço", { texto: "", fonte: "x" }] }, provas: [{ tipo: "estranho", texto: "a" }] });
    expect(b.oferta.produto).toBe("");
    expect(b.publico.situacoes[0]).toEqual({ texto: "Sem tempo no almoço", fonte: "" });
    expect(b.provas[0].tipo).toBe("depoimento");
    expect(b.provas[0].autorizado).toBe(false);
    const envio: any = briefingParaSalvar(b);
    expect(envio.publico.situacoes).toHaveLength(1);
    expect(envio.objetivo.custo_toleravel_brl).toBeNull();
    expect(envio.publico.estagio_consciencia).toBeNull();
  });
});

// ------------------------------------------------------------------ referências

describe("etapa 2, referências", () => {
  it("links úteis no topo e importar meus anúncios chama a ação grátis com o cliente", async () => {
    montar(h(AbaReferencias));
    for (const l of LINKS_UTEIS) {
      const a = screen.getByRole("link", { name: new RegExp(l.rotulo) });
      expect(a.getAttribute("href")).toBe(l.url);
      expect(a.getAttribute("target")).toBe("_blank");
    }
    fireEvent.click(screen.getByRole("button", { name: /Importar meus anúncios/ }));
    await waitFor(() => expect(chamadasDe("referencias_importar_proprias")).toEqual([{ acao: "referencias_importar_proprias", client_id: CLIENTE }]));
  });

  it("o selo de evidência mostra a escala no tooltip, e a biblioteca da agência é só leitura", async () => {
    mock.tabelas.ads_referencias = [
      { id: "r1", client_id: CLIENTE, titulo: "Anúncio próprio de agosto", origem: "anuncio_proprio", evidencia: "E3", metricas: { gasto: 320, resultados: 41 }, ficha: {}, mecanismo: "Agenda cumprida", tags: [], destaque: true, criado_em: "2026-09-01" },
      { id: "r2", client_id: null, titulo: "Clássico da agência", origem: "swiped", evidencia: "E0", metricas: {}, ficha: {}, mecanismo: null, tags: [], destaque: false, criado_em: "2026-09-02" },
    ];
    montar(h(AbaReferencias));
    const selo = await screen.findByRole("button", { name: "Evidência E3: Resultado documentado" });
    fireEvent.focus(selo);
    const dica = await screen.findByRole("tooltip");
    expect(dica.textContent).toContain("Escala de evidência");
    expect(dica.textContent).toContain("Replicação própria");
    expect(dica.textContent).toContain("não são prova de retorno");
    expect(screen.getByText(/R\$ 320,00 gasto/)).toBeTruthy();
    const estrelas = screen.getAllByRole("button", { name: /destaque|Destacar/i });
    expect(estrelas.some((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });

  it("origem pelo link colado", () => {
    expect(origemDoLink("https://www.facebook.com/ads/library/?id=1")).toBe("meta_ad_library");
    expect(origemDoLink("https://ads.tiktok.com/business/creativecenter/x")).toBe("tiktok");
    expect(origemDoLink("https://swiped.co/file/abc")).toBe("swiped");
    expect(origemDoLink("https://br.pinterest.com/pin/1")).toBe("pinterest");
    expect(origemDoLink("https://www.instagram.com/p/x")).toBe("instagram");
    expect(origemDoLink("https://exemplo.com")).toBe("outro");
  });
});

// ------------------------------------------------------------------ plano

describe("etapa 3, plano de teste", () => {
  it("gerar plano manda o briefing atual, o pedido e a quantidade de ângulos", async () => {
    mock.tabelas.ads_briefings = [{ id: "b-1", versao: 2, oferta: {}, publico: {}, objecoes: [], provas: [], destino: {}, objetivo: {}, restricoes: null, criado_em: "2026-09-23" }];
    montar(h(AbaPlano, { planoId: null, onPlano: vi.fn(), onProduzido: vi.fn() }));
    await screen.findByText(/Briefing versão 2/);
    fireEvent.change(screen.getByLabelText("Pedido para o plano"), { target: { value: "Foco em quem já orçou" } });
    fireEvent.click(screen.getByRole("radio", { name: "5" }));
    fireEvent.click(screen.getByRole("button", { name: /Gerar plano/ }));
    await waitFor(() => expect(chamadasDe("plano_gerar")).toHaveLength(1));
    expect(chamadasDe("plano_gerar")[0]).toEqual({
      acao: "plano_gerar",
      client_id: CLIENTE,
      briefing_id: "b-1",
      pedido: "Foco em quem já orçou",
      quantidade_angulos: 5,
    });
  });

  it("cada ângulo mostra hipótese e notas do Jev; produzir manda os ângulos e formatos escolhidos", async () => {
    mock.tabelas.ads_planos = [PLANO];
    const onProduzido = vi.fn();
    montar(h(AbaPlano, { planoId: PLANO.id, onPlano: vi.fn(), onProduzido }));
    expect(await screen.findByText("A dor da espera")).toBeTruthy();
    expect(screen.getByText(/Acreditamos que mostrar a agenda cumprida/)).toBeTruthy();
    // Política no Jev: 0 viola, 10 sem risco. A tela mostra "Política", nunca "risco".
    expect(screen.getAllByRole("meter", { name: "Política" })).toHaveLength(2);
    expect(screen.queryAllByRole("meter", { name: /Risco/ })).toHaveLength(0);
    // Notas em 0 a 1 viram 0 a 10; em 0 a 10 ficam.
    expect(screen.getAllByRole("meter", { name: "Clareza" }).map((m) => m.getAttribute("aria-valuenow"))).toEqual(["8", "9"]);

    // Formatos sugeridos pelos ângulos vêm marcados; tira o 1:1 e o ângulo 2.
    fireEvent.click(screen.getByRole("checkbox", { name: "Produzir o ângulo Prova do resultado" }));
    fireEvent.click(screen.getByRole("button", { name: /Quadrado 1:1/ }));
    expect(screen.getByText(/1 ângulo × 2 formatos = 2 criativos/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Produzir criativos/ }));
    await waitFor(() => expect(chamadasDe("criativos_produzir")).toHaveLength(1));
    expect(chamadasDe("criativos_produzir")[0]).toEqual({
      acao: "criativos_produzir",
      plano_id: PLANO.id,
      angulo_ids: ["a1"],
      formatos: ["feed_4x5", "stories_9x16"],
    });
    await waitFor(() => expect(onProduzido).toHaveBeenCalledWith(PLANO.id));
    // A conversa com o estrategista fica ao lado, com microfone e anexos.
    expect(screen.getByLabelText("Pedido ao estrategista de ads")).toBeTruthy();
  });

  it("corpo da produção segue a ordem do plano e da lista de formatos; notas em escala única", () => {
    expect(corpoDaProducao(PLANO, ["a2", "a1"], ["stories_9x16", "feed_4x5"])).toEqual({
      plano_id: PLANO.id,
      angulo_ids: ["a1", "a2"],
      formatos: ["feed_4x5", "stories_9x16"],
    });
    expect(notasDe10({ clareza: 1, relevancia: 8, prova: 3, risco_politica: 1 }).clareza).toBe(1);
    expect(notasDe10({ clareza: 0.5, relevancia: 1 }).relevancia).toBe(10);
    expect(notasDe10({ clareza: 85 }).clareza).toBe(8.5);
  });
});

// ------------------------------------------------------------------ estúdio ads

describe("etapa 4, estúdio ads: copy", () => {
  const criativo = (copy: CriativoAds["copy"]): CriativoAds => ({
    id: "c-1",
    client_id: CLIENTE,
    plano_id: PLANO.id,
    angulo_id: "a1",
    trabalho_id: null,
    nome: null,
    formato: "stories_9x16",
    copy,
    status: "rascunho",
    ad_id: null,
    evidencia: "E0",
    criado_em: "",
    atualizado_em: "",
  });

  it("contador de 125 caracteres visíveis e de 40 no título; a prévia do feed corta com o mais", () => {
    const longo = `${"Consulta sem espera na recepção. ".repeat(4)}Fim`;
    montar(h(PainelDaCopy, { criativo: criativo({ texto_principal: longo, titulo: "Agende hoje", cta_meta: "SEND_WHATSAPP_MESSAGE" }), caminhoDaArte: null }));
    expect(screen.getByLabelText(`Texto principal: ${longo.length} de 125`).textContent).toContain("(corta no feed)");
    expect(screen.getByLabelText("Título: 11 de 40").textContent).toBe("11/40");
    const previa = screen.getByLabelText("Prévia no feed");
    expect(previa.textContent).toContain("… mais");
    expect(previa.textContent).toContain("Enviar mensagem pelo WhatsApp");
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "x".repeat(45) } });
    expect(screen.getByLabelText("Título: 45 de 40").textContent).toContain("corta");
  });

  it("variar copy chama copy_variar com o criativo e a variação escolhida entra no formulário", async () => {
    mock.invoke.mockImplementation(async (_f: string, { body }: any) =>
      body.acao === "copy_variar"
        ? { data: { variacoes: [{ texto_principal: "Nova versão curta", titulo: "Título novo", cta_meta: "LEARN_MORE" }], custo_usd: 0.01 }, error: null }
        : { data: { ok: true }, error: null },
    );
    montar(h(PainelDaCopy, { criativo: criativo({ texto_principal: "Base" }), caminhoDaArte: null }));
    fireEvent.change(screen.getByLabelText("Pedido para variar a copy"), { target: { value: "mais direto" } });
    fireEvent.click(screen.getByRole("button", { name: /Variar copy/ }));
    await waitFor(() => expect(chamadasDe("copy_variar")).toEqual([{ acao: "copy_variar", criativo_id: "c-1", pedido: "mais direto" }]));
    fireEvent.click(await screen.findByRole("button", { name: "Usar esta" }));
    expect((screen.getByLabelText("Texto principal") as HTMLTextAreaElement).value).toBe("Nova versão curta");
    expect((screen.getByLabelText("Título") as HTMLInputElement).value).toBe("Título novo");
  });

  it("texto visível corta na palavra e a zona segura dos stories marca 14% e 20%", () => {
    expect(textoVisivel("curto")).toEqual({ visivel: "curto", cortado: false });
    const r = textoVisivel(`${"palavra ".repeat(30)}`);
    expect(r.cortado).toBe(true);
    expect(r.visivel.length).toBeLessThanOrEqual(125);
    expect(r.visivel.endsWith("palavra")).toBe(true);
    const { container } = render(h(GuiaDaZonaSegura));
    const faixas = container.querySelectorAll("[data-zona-segura] > div");
    expect((faixas[0] as HTMLElement).style.height).toBe("14%");
    expect((faixas[1] as HTMLElement).style.height).toBe("20%");
  });
});

// ------------------------------------------------------------------ resultados

describe("etapa 6, resultados (v5: claros e com vínculo automático)", () => {
  it("resumo no topo, objetivo com o rótulo certo, abas simples, aprendizado do criativo ligado e confirmação só do incerto", async () => {
    mock.invoke.mockImplementation(async (_f: string, { body }: any) => {
      if (body.acao === "conta_ao_vivo") {
        return {
          data: {
            conectada: true,
            periodo: { inicio: "2026-09-09", fim: "2026-09-22" },
            totais: { gasto: 1000, resultados: 60, custo_por_resultado: 16.67, resultado_rotulo: "Conversas iniciadas" },
            comparacao: { gasto_pct: 10, resultados_pct: 25, custo_por_resultado_pct: -12 },
            campanhas: [],
            mix_objetivos: {
              por_grupo: [
                { grupo: "engajamento", rotulo: "Engajamento", gasto: 700, pct: 70, resultados: 5000, custo_por_resultado: 0.14, resultado_rotulo: "Engajamentos" },
                { grupo: "mensagem", rotulo: "Mensagem", gasto: 300, pct: 30, resultados: 60, custo_por_resultado: 5, resultado_rotulo: "Conversas iniciadas" },
              ],
              perto_da_venda_pct: 30,
              alertas: ["70% do investimento está em engajamento ou alcance, que não otimizam para conversa nem venda."],
            },
            anuncios: [
              {
                ad_id: "111", nome: "Conversa pelo WhatsApp", status: "ACTIVE", campaign_id: "c1", campanha: "Mensagens", imagem_url: null, grupo: "mensagem", peca: "hash:a",
                metricas: { gasto: 300, impressoes: 20000, resultados: 60, custo_por_resultado: 5, ctr_saida_pct: 1.2, resultado_tipo: "mensagens", resultado_rotulo: "Conversas iniciadas" },
                criativo: { id: "cr-1", nome: "A dor da espera | V1 | feed_4x5", origem: "ligado" },
                diagnostico: { situacao: "com_sinais", sinais: [{ sinal: "Custo abaixo do tolerável", hipotese: "O gancho segura.", verificar: "Subir a verba aos poucos." }] },
                tendencia: {}, sinal: "escalar",
              },
              {
                ad_id: "222", nome: "Post impulsionado", status: "PAUSED", campaign_id: "c2", campanha: "Engajamento", imagem_url: null, grupo: "engajamento", peca: "hash:b",
                metricas: { gasto: 700, impressoes: 90000, resultados: 5000, custo_por_resultado: 0.14, resultado_tipo: "engajamento", resultado_rotulo: "Engajamentos" },
                criativo: null, diagnostico: null, tendencia: {}, sinal: "pausar",
              },
            ],
          },
          error: null,
        };
      }
      if (body.acao === "vinculos_automaticos") {
        return {
          data: {
            itens: [
              {
                peca: "hash:b", origem: "confirmar", confianca: 0.6, sinais: [{ tipo: "texto", detalhe: "Texto principal parecido" }],
                anuncio: { ad_id: "222", ad_ids: ["222"], nome: "Post impulsionado", corpo: "Texto do post", gasto_90d: 700 },
                criativo: null,
                candidatos: [{ criativo_id: "cr-2", nome: "Prova do resultado | V1 | feed_4x5", confianca: 0.6, sinais: ["Texto principal parecido"] }],
              },
              {
                peca: "hash:a", origem: "automatico", confianca: 0.93, sinais: [{ tipo: "imagem", detalhe: "Mesma imagem" }],
                anuncio: { ad_id: "111", ad_ids: ["111"], nome: "Conversa pelo WhatsApp", gasto_90d: 300 },
                criativo: { id: "cr-1", nome: "A dor da espera | V1 | feed_4x5" }, candidatos: [],
              },
            ],
            resumo: { ja_ligados: 0, automaticos: 1, pelo_jev: 0, confirmar: 1, sem_par: 0, criativos_livres: 1 },
            impressoes: { novas: 2, pendentes: 0 },
            historico_disponivel: true,
            custo_usd: 0.0004,
          },
          error: null,
        };
      }
      return { data: { ok: true, custo_usd: 0.001 }, error: null };
    });
    montar(h(AbaResultados));
    // Resumo no topo com a tendência e o alerta do mix de objetivos (código).
    expect(await screen.findByText("R$ 1.000,00")).toBeTruthy();
    expect(chamadasDe("conta_ao_vivo")[0]).toEqual({ acao: "conta_ao_vivo", client_id: CLIENTE, dias: 14 });
    expect(screen.getByText("+25%")).toBeTruthy();
    expect(screen.getByText(/70% do investimento está em engajamento/)).toBeTruthy();
    // Abas simples: Ativos agora mostra só o ativo.
    expect(screen.getByRole("tab", { name: "Ativos agora (1)" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("article", { name: "Anúncio Conversa pelo WhatsApp" })).toBeTruthy();
    expect(screen.queryByRole("article", { name: "Anúncio Post impulsionado" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Para descartar (1)" }));
    expect(screen.getByRole("article", { name: "Anúncio Post impulsionado" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Melhores criativos (2)" }));
    expect(screen.getByRole("article", { name: "Criativo A dor da espera | V1 | feed_4x5" })).toBeTruthy();
    // Objetivo: só mensagem, com o rótulo e o custo daquele objetivo.
    fireEvent.click(screen.getByRole("button", { name: "Mensagem (1)" }));
    expect(screen.getAllByText("Conversas iniciadas").length).toBeGreaterThan(0);
    expect(screen.getAllByText("R$ 5,00").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("tab", { name: "Ativos agora (1)" }));

    // Aprendizado só no anúncio ligado a criativo da Mesa Ads, com o período da conta.
    const cartao = screen.getByRole("article", { name: "Anúncio Conversa pelo WhatsApp" });
    fireEvent.click(within(cartao).getByRole("button", { name: /Aprendizado/ }));
    expect(screen.getByText("Custo abaixo do tolerável")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Aprendizado"), { target: { value: "Gancho de relógio perdeu para o de agenda." } });
    fireEvent.click(screen.getByRole("button", { name: /^Registrar\s*~/ }));
    await waitFor(() => expect(chamadasDe("aprendizado_registrar")).toHaveLength(1));
    expect(chamadasDe("aprendizado_registrar")[0]).toEqual({
      acao: "aprendizado_registrar",
      criativo_id: "cr-1",
      periodo_inicio: "2026-09-09",
      periodo_fim: "2026-09-22",
      texto: "Gancho de relógio perdeu para o de agenda.",
    });

    // Vínculo automático no lugar de "anúncios sem vínculo": o Jev entra sozinho e só o incerto pede confirmação.
    expect(await screen.findByText("1 reconhecidos agora")).toBeTruthy();
    expect(chamadasDe("vinculos_automaticos")[0]).toEqual({ acao: "vinculos_automaticos", client_id: CLIENTE, jev: true });
    expect(screen.queryByText("Anúncios sem vínculo")).toBeNull();
    expect(screen.getByText(/Conferência do Jev/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /É este/ }));
    await waitFor(() => expect(chamadasDe("vinculo_confirmar")).toEqual([{ acao: "vinculo_confirmar", client_id: CLIENTE, criativo_id: "cr-2", ad_id: "222" }]));
  });

  it("período dos últimos dias termina ontem", () => {
    expect(periodoDosUltimos(7, new Date(2026, 8, 23))).toEqual({ inicio: "2026-09-16", fim: "2026-09-22" });
  });

  it("sem tabela larga nem rolagem de lado na aba (bug da rolagem que movia a tela inteira)", () => {
    for (const arquivo of ["src/components/mesa-ads/AbaResultados.tsx", "src/components/mesa-ads/ResultadosClaros.tsx", "src/components/mesa-ads/ContaPaineis.tsx", "src/components/mesa-ads/VinculoAutomatico.tsx", "src/components/mesa-ads/AgenteSenior.tsx"]) {
      const fonte = ler(arquivo);
      expect(fonte).not.toMatch(/overflow-x-auto/);
      expect(fonte).not.toMatch(/min-w-\[\d+px\]/);
      // Caixa com rolagem própria só a partir do tablet (no celular o dedo rola a página).
      expect(fonte).not.toMatch(/(^|[\s"`])max-h-\[[^\]]+\] [^"`]*(^|\s)overflow-y-auto/);
    }
  });
});

describe("resultados no formato da função mesa-ads", () => {
  it("traduz ctr_saida_pct, frequencia_media e o diagnóstico de situacao e sinais", async () => {
    const { normalizarResultados } = await import("@/components/mesa-ads/adsApi");
    const r = normalizarResultados({
      periodo: { inicio: "2026-09-01", fim: "2026-09-14" },
      criativos: [{
        criativo_id: "c-9",
        ad_id: "555",
        nome: "Direct | Poda",
        metricas: { gasto: 20, impressoes: 3000, ctr_saida_pct: 0.5, frequencia_media: 3.4, resultados: 2, custo_por_resultado: 10 },
        diagnostico: {
          situacao: "com_sinais",
          sinais: [
            { codigo: "atencao", sinal: "Pouca atenção inicial", hipotese: "Abertura pouco clara.", verificar: "Visual e primeira frase." },
            { codigo: "fadiga", sinal: "Frequência alta", hipotese: "Fadiga criativa.", verificar: "Novo ângulo." },
          ],
          observacoes: [],
        },
      }, {
        criativo_id: "c-10",
        nome: "Pouco volume",
        metricas: { gasto: 1, impressoes: 80 },
        diagnostico: { situacao: "inconclusivo", sinais: [], observacoes: ["Qualidade dos contatos vem do comercial."] },
      }],
      sem_vinculo: [],
    });
    expect(r.linhas[0].metricas.ctr_saida).toBe(0.5);
    expect(r.linhas[0].metricas.frequencia).toBe(3.4);
    expect(r.linhas[0].diagnostico).toEqual({ sinal: "Pouca atenção inicial", leitura: "Abertura pouco clara. Fadiga criativa.", acao: "Visual e primeira frase. Novo ângulo." });
    expect((r.linhas[1].diagnostico as { sinal: string }).sinal).toBe("Inconclusivo");
  });
});
