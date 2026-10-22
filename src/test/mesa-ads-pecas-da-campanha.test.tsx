import { createElement as h } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Peças prontas da campanha da Mesa como criativos na Mesa Ads (22/10/2026): a Mesa Ads lê campanha_mesa
 * da URL e mostra "Peças da campanha X" (posts, carrosséis e stories 9:16 prontos, com fase e data);
 * "Usar como criativo" segue o caminho de registro de criativo (ação da mesa-ads, mesmo trabalho do
 * Estúdio, sem copiar arquivo); sem o parâmetro, "Puxar de uma campanha" lista as campanhas com peças
 * prontas; o criativo guarda campanha_mesa_id e mostra "Da campanha X". Banco e funções simulados.
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  tabelas: {} as Record<string, unknown>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range", "update", "gte", "lte"]) b[m] = () => b;
    const primeiro = () => ({ data: Array.isArray(dados) ? (dados[0] === undefined ? null : dados[0]) : dados, error: null });
    b.maybeSingle = () => Promise.resolve(primeiro());
    b.single = () => Promise.resolve(primeiro());
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null, count: Array.isArray(dados) ? dados.length : 0 }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: vi.fn(),
      from: (tabela: string) => consulta(tabela),
      storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/img.png" }, error: null }) }) },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));
vi.mock("@/components/mesa-ads/ArteDoCriativo", async (original) => {
  const real = (await original()) as Record<string, unknown>;
  return { ...real, default: () => h("div", { "data-arte-falsa": "" }, "arte") };
});
vi.mock("@/components/mesa-ads/VideoDoCriativo", () => ({ default: () => h("div", null, "Bancada de vídeo") }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import AbaEstudioAds from "@/components/mesa-ads/AbaEstudioAds";
import { campanhaDoCriativo, contarProntasPorCampanha, corpoDoUsar, faseEData, montarPecas } from "@/components/mesa-ads/campanhaDaMesaApi";
import { blocoDaCampanhaDaMesa, criativoDaPeca, ctaDoBriefing, pecasDoCorpo, textoVisivel } from "../../supabase/functions/mesa-ads/campanha-da-mesa";

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const CAMPANHA = "33333333-3333-3333-3333-333333333333";
const OUTRA = "44444444-4444-4444-4444-444444444444";
const T_POST = "55555555-5555-5555-5555-555555555551";
const T_CARROSSEL = "55555555-5555-5555-5555-555555555552";
const T_GERANDO = "55555555-5555-5555-5555-555555555553";
const T_STORY = "55555555-5555-5555-5555-555555555554";
const SEQ = "66666666-6666-6666-6666-666666666661";

const arte = (id: string, campanha: string, temaId: string, laminas: number, feitas: number, extra: Record<string, unknown> = {}) => ({
  id,
  client_id: CLIENTE,
  status: "pronto",
  legenda: `Legenda da peça ${temaId}. Black Friday com 30% de desconto em todos os móveis da loja, só até domingo.`,
  direcao: {
    cards: Array.from({ length: laminas }, (_, i) => ({ ordem: i + 1, texto_exato: `Lâmina ${i + 1}` })),
    arte_rapida: { pedido: `Peça "${temaId}"`, titulo: `Título ${temaId}`, peca: laminas > 1 ? "carrossel" : "unica", campanha_id: campanha, peca_da_campanha: { campanha_id: campanha, tema_id: temaId }, ...extra },
  },
  cards: Array.from({ length: feitas }, (_, i) => ({ ordem: i + 1, versao: 1, storage_path: `${CLIENTE}/arte-${id}-${i + 1}.png` })),
  atualizado_em: "2026-10-20T12:00:00Z",
});

const CAMPANHA_LINHA = {
  id: CAMPANHA,
  client_id: CLIENTE,
  nome: "Black Friday",
  periodo_inicio: "2026-11-20",
  periodo_fim: "2026-11-30",
  proposta_id: "77777777-7777-7777-7777-777777777777",
  briefing: { oferta: "30% em todos os móveis", cta: "Chama no WhatsApp", mensagem_central: "O melhor preço do ano" },
  criado_em: "2026-10-20T10:00:00Z",
};

const ITENS = [
  { tema_id: "t1", data: "2026-11-21", etapa: "Aquecimento", tema: "Vem aí a Black", formato: "post" },
  { tema_id: "t2", data: "2026-11-27", etapa: "Lançamento da oferta", tema: "Os 5 mais vendidos", formato: "carrossel" },
  { tema_id: "t3", data: "2026-11-29", etapa: "Urgência", tema: "Últimas horas", formato: "post" },
];

const SEQUENCIA = { id: SEQ, client_id: CLIENTE, data: "2026-11-28", objetivo: "vender", titulo: "Stories do último dia", gancho_de_amanha: null, criado_em: "2026-10-20", escolha: { campanha: { campanha_id: CAMPANHA, tema_id: null, fase: "urgencia", nome: "Black Friday" } } };
const story = (ordem: number, comArte: boolean) => ({
  id: `88888888-8888-8888-8888-88888888888${ordem}`,
  sequencia_id: SEQ,
  client_id: CLIENTE,
  ordem,
  molde: "livre",
  titulo: `Tela ${ordem}`,
  texto_na_tela: `Texto ${ordem}`,
  adesivo: { tipo: "nenhum" },
  fundo: { tipo: "gerada", trabalho_id: T_STORY, lamina: ordem, ...(comArte ? { caminho: `${CLIENTE}/story-${ordem}.png`, versao: 1 } : {}) },
  situacao: "arte_pronta",
  caminho: "automatico",
  criado_em: "2026-10-20",
  atualizado_em: "2026-10-20",
});

const criativoDaCampanha = (id: string, trabalhoId: string) => ({
  id,
  client_id: CLIENTE,
  plano_id: null,
  angulo_id: null,
  trabalho_id: trabalhoId,
  nome: "Black Friday · Vem aí a Black",
  formato: "feed_4x5",
  copy: { texto_principal: "Legenda da peça t1.", titulo: "Título t1", cta_meta: "Enviar mensagem", campanha_mesa_id: CAMPANHA, campanha_mesa: { id: CAMPANHA, nome: "Black Friday", fase: "aquecimento", data: "2026-11-21" } },
  status: "rascunho",
  ad_id: null,
  evidencia: "E0",
  criado_em: "2026-10-21T12:00:00Z",
  atualizado_em: "2026-10-21T12:00:00Z",
});

const valor = (): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Softy Móveis",
  userId: "u-1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 50,
  catalogo: [],
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
});

function montar(props: Record<string, unknown>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(
      QueryClientProvider,
      { client: qc },
      h(TooltipProvider as any, null, h(MesaProvider as any, { valor: valor() }, h(AbaEstudioAds as any, { criativoId: null, onCriativo: vi.fn(), planoId: null, ...props }))),
    ),
  );
}

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
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
  mock.tabelas = {
    ads_criativos: [],
    ads_planos: [],
    ads_creatives: [],
    mesa_campanhas: [CAMPANHA_LINHA],
    calendario_propostas: [{ id: CAMPANHA_LINHA.proposta_id, itens: ITENS }],
    estudio_trabalhos: [arte(T_POST, CAMPANHA, "t1", 1, 1), arte(T_CARROSSEL, CAMPANHA, "t2", 5, 5), arte(T_GERANDO, CAMPANHA, "t3", 1, 0)],
  };
  mock.invoke.mockImplementation(async (funcao: string, opcoes: { body: Record<string, unknown> }) => {
    const corpo = opcoes.body;
    if (funcao === "mesa-stories") return { data: { sequencias: [SEQUENCIA], stories: [story(1, true), story(2, true)], custo_usd: 0 }, error: null };
    if (funcao === "mesa-ads" && corpo.acao === "criativos_da_campanha_mesa") {
      const pecas = corpo.pecas as { trabalho_id: string }[];
      return { data: { criativos: pecas.map((p, i) => ({ ...criativoDaCampanha(`99999999-9999-9999-9999-99999999999${i}`, p.trabalho_id) })), ja_existiam: [], recusadas: [], custo_usd: 0 }, error: null };
    }
    return { data: { ok: true, custo_usd: 0 }, error: null };
  });
});

describe("regras das peças da campanha", () => {
  it("só entra arte pronta da campanha, com fase e data da série; stories 9:16 da sequência", () => {
    const trabalhos = [
      arte(T_POST, CAMPANHA, "t1", 1, 1),
      arte(T_CARROSSEL, CAMPANHA, "t2", 5, 5),
      arte(T_GERANDO, CAMPANHA, "t3", 1, 0),
      arte("55555555-5555-5555-5555-555555555559", OUTRA, "x", 1, 1),
      arte("55555555-5555-5555-5555-555555555558", CAMPANHA, "t1", 1, 1, { arquivada_em: "2026-10-20" }),
    ];
    const pecas = montarPecas(CAMPANHA_LINHA, trabalhos, ITENS, [SEQUENCIA as any], [story(1, true), story(2, true)] as any, [{ id: "c-1", trabalho_id: T_POST }]);
    expect(pecas.map((p) => p.trabalho_id)).toEqual([T_POST, T_CARROSSEL, T_STORY]);
    const [post, carrossel, stories] = pecas;
    expect(post).toMatchObject({ tipo: "post", formato: "feed_4x5", fase: "aquecimento", data: "2026-11-21", titulo: "Vem aí a Black", criativo_id: "c-1" });
    expect(carrossel).toMatchObject({ tipo: "carrossel", formato: "carrossel", fase: "lancamento", laminas: 5, criativo_id: null });
    expect(stories).toMatchObject({ tipo: "stories", formato: "stories_9x16", fase: "urgencia", sequencia_id: SEQ, laminas: 2 });
    expect(faseEData(carrossel.fase, carrossel.data)).toBe("Lançamento · 27/11");
  });

  it("sequência com tela sem arte não entra", () => {
    const pecas = montarPecas(CAMPANHA_LINHA, [], ITENS, [SEQUENCIA as any], [story(1, true), story(2, false)] as any, []);
    expect(pecas).toEqual([]);
  });

  it("seletor: só campanhas com peças prontas, com a contagem", () => {
    const lista = contarProntasPorCampanha(
      [{ id: CAMPANHA, nome: "Black Friday" }, { id: OUTRA, nome: "Natal" }],
      [arte(T_POST, CAMPANHA, "t1", 1, 1), arte(T_CARROSSEL, CAMPANHA, "t2", 5, 5), arte(T_GERANDO, OUTRA, "t3", 1, 0)],
    );
    expect(lista).toEqual([{ id: CAMPANHA, nome: "Black Friday", prontas: 2 }]);
  });

  it("a referência de volta vem de copy.campanha_mesa_id", () => {
    expect(campanhaDoCriativo(criativoDaCampanha("c", T_POST) as any)).toMatchObject({ id: CAMPANHA, nome: "Black Friday" });
    expect(campanhaDoCriativo({ copy: { titulo: "x" } } as any)).toBeNull();
  });

  it("servidor: o criativo aponta para o mesmo trabalho, copy da legenda e CTA do briefing, rascunho", () => {
    const [peca] = pecasDoCorpo(corpoDoUsar(CLIENTE, CAMPANHA, montarPecas(CAMPANHA_LINHA, [arte(T_CARROSSEL, CAMPANHA, "t2", 5, 5)], ITENS, [], [], [])).pecas);
    const linha = criativoDaPeca({ id: CAMPANHA, nome: "Black Friday", briefing: CAMPANHA_LINHA.briefing }, peca, { legenda: arte(T_CARROSSEL, CAMPANHA, "t2", 5, 5).legenda, titulo: "Os 5 mais vendidos da Black", laminas: 5 }, CLIENTE, "u-1") as any;
    expect(linha).toMatchObject({ client_id: CLIENTE, trabalho_id: T_CARROSSEL, plano_id: null, formato: "carrossel", status: "rascunho" });
    expect(linha.copy.campanha_mesa_id).toBe(CAMPANHA);
    expect(linha.copy.campanha_mesa).toMatchObject({ nome: "Black Friday", fase: "lancamento", data: "2026-11-27", oferta: "30% em todos os móveis" });
    expect(linha.copy.texto_principal.length).toBeLessThanOrEqual(125);
    expect(linha.copy.texto_principal).toContain("Black Friday com 30%");
    expect(linha.copy.titulo.length).toBeLessThanOrEqual(40);
    expect(linha.copy.cta_meta).toBe("Enviar mensagem");
    expect(textoVisivel("Curta. " + "x".repeat(200))).toBe("Curta.");
    expect(ctaDoBriefing("Compre agora no site")).toBe("Comprar agora");
    expect(ctaDoBriefing("")).toBe("Saiba mais");
  });

  it("servidor: o Refinar copy recebe a peça e o briefing da campanha", () => {
    const bloco = blocoDaCampanhaDaMesa({ campanha_mesa: { nome: "Black Friday", fase: "urgencia", copy_da_peca: "Últimas horas!" } }, { oferta: "30% off", cta: "Chama no WhatsApp" });
    expect(bloco).toContain('PEÇA DA CAMPANHA DA MESA "Black Friday"');
    expect(bloco).toContain("Oferta: 30% off");
    expect(bloco).toContain("CTA da campanha: Chama no WhatsApp");
    expect(bloco).toContain("Copy da peça: Últimas horas!");
    expect(blocoDaCampanhaDaMesa({ titulo: "x" }, null)).toBe("");
  });

  it("servidor: ação registrada, grátis, sem Meta e com o vínculo conferido", () => {
    const fonte = readFileSync(resolve(__dirname, "../../supabase/functions/mesa-ads/index.ts"), "utf8");
    expect(fonte).toContain("criativos_da_campanha_mesa: criativosDaCampanhaMesa");
    const corpo = fonte.slice(fonte.indexOf("async function criativosDaCampanhaMesa"), fonte.indexOf("const ACOES: Record<string,"));
    expect(corpo).toContain("exigirAcessoAoCliente");
    expect(corpo).toContain('from("ads_criativos").insert(');
    expect(corpo).toContain("custo_usd: 0");
    expect(corpo).not.toMatch(/graph\.facebook|chamarTexto|storage\.from\([^)]*\)\.(upload|copy)/);
    const pagina = readFileSync(resolve(__dirname, "../pages/MesaAds.tsx"), "utf8");
    expect(pagina).toContain('params.get("campanha_mesa")');
  });
});

describe("Estúdio Ads com a campanha da Mesa", () => {
  it("lê campanha_mesa e lista as peças prontas com fase e data", async () => {
    montar({ campanhaMesaId: CAMPANHA, onCampanhaMesa: vi.fn(), onAbrirSemPlano: vi.fn() });
    const secao = await screen.findByRole("region", { name: "Peças da campanha" });
    expect(await within(secao).findByText("Peças da campanha Black Friday")).toBeTruthy();
    const lista = await within(secao).findByRole("list", { name: "Peças prontas da campanha" });
    await waitFor(() => expect(within(lista).getAllByRole("listitem").length).toBe(3));
    expect(within(lista).getByText("Vem aí a Black")).toBeTruthy();
    expect(within(lista).getByText(/Post · Aquecimento · 21\/11/)).toBeTruthy();
    expect(within(lista).getByText(/Carrossel · 5 · Lançamento · 27\/11/)).toBeTruthy();
    expect(within(lista).getByText(/Stories · 2 · Urgência · 28\/11/)).toBeTruthy();
    expect(within(lista).queryByText("Últimas horas")).toBeNull();
  });

  it("Usar como criativo: várias peças pelo registro de criativo e abre o primeiro", async () => {
    const onAbrirSemPlano = vi.fn();
    montar({ campanhaMesaId: CAMPANHA, onCampanhaMesa: vi.fn(), onAbrirSemPlano });
    const lista = await screen.findByRole("list", { name: "Peças prontas da campanha" });
    await waitFor(() => expect(within(lista).getAllByRole("listitem").length).toBe(3));
    fireEvent.click(within(lista).getByRole("button", { name: "Marcar Vem aí a Black" }));
    fireEvent.click(within(lista).getByRole("button", { name: "Marcar Stories do último dia" }));
    const usar = screen.getByRole("button", { name: /Usar como criativo \(2\)/ });
    fireEvent.click(usar);
    await waitFor(() => expect(onAbrirSemPlano).toHaveBeenCalledWith("99999999-9999-9999-9999-999999999990"));
    const chamada = mock.invoke.mock.calls.find((c) => c[0] === "mesa-ads" && c[1].body.acao === "criativos_da_campanha_mesa");
    expect(chamada).toBeTruthy();
    const corpo = chamada![1].body;
    expect(corpo.client_id).toBe(CLIENTE);
    expect(corpo.campanha_id).toBe(CAMPANHA);
    expect(corpo.pecas.map((p: any) => [p.trabalho_id, p.formato])).toEqual([
      [T_POST, "feed_4x5"],
      [T_STORY, "stories_9x16"],
    ]);
  });

  it("peça que já é criativo não marca de novo e abre o criativo", async () => {
    mock.tabelas.ads_criativos = [criativoDaCampanha("c-ja", T_POST)];
    const onAbrirSemPlano = vi.fn();
    montar({ campanhaMesaId: CAMPANHA, onCampanhaMesa: vi.fn(), onAbrirSemPlano });
    const lista = await screen.findByRole("list", { name: "Peças prontas da campanha" });
    const ja = await within(lista).findByRole("button", { name: "Já é criativo" });
    fireEvent.click(ja);
    expect(onAbrirSemPlano).toHaveBeenCalledWith("c-ja");
  });

  it("sem o parâmetro: Puxar de uma campanha lista as campanhas com peças prontas", async () => {
    const onCampanhaMesa = vi.fn();
    montar({ campanhaMesaId: null, onCampanhaMesa, onAbrirSemPlano: vi.fn() });
    const seletor = (await screen.findByRole("combobox", { name: "Puxar de uma campanha" })) as HTMLSelectElement;
    await waitFor(() => expect(within(seletor).getByRole("option", { name: "Black Friday (2 prontas)" })).toBeTruthy());
    expect(screen.queryByRole("region", { name: "Peças da campanha" })).toBeNull();
    fireEvent.change(seletor, { target: { value: CAMPANHA } });
    expect(onCampanhaMesa).toHaveBeenCalledWith(CAMPANHA);
  });

  it("o criativo da campanha mostra a etiqueta Da campanha X", async () => {
    mock.tabelas.ads_criativos = [criativoDaCampanha("c-ja", T_POST)];
    const onCampanhaMesa = vi.fn();
    montar({ campanhaMesaId: null, onCampanhaMesa, onAbrirSemPlano: vi.fn() });
    const etiqueta = await waitFor(() => {
      const el = document.querySelector("[data-etiqueta-da-campanha]");
      if (!el) throw new Error("sem etiqueta");
      return el as HTMLElement;
    });
    expect(etiqueta.textContent).toBe("Da campanha Black Friday");
    fireEvent.click(within(etiqueta).getByRole("button"));
    expect(onCampanhaMesa).toHaveBeenCalledWith(CAMPANHA);
    expect(document.querySelector("[data-da-campanha]")!.textContent).toBe("Da campanha Black Friday");
  });
});
