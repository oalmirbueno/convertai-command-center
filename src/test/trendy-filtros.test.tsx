import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Hype, HypesDaSemana as PesquisaDeHypes } from "@/components/mesa/mesaV4Api";
import { dadosDoTrendy, itensDoTrendy } from "@/components/mesa/trendy";
import { alternarJuntado, juntadoDaNoticia, MAXIMO_POR_LISTA, sementeDaSelecao, type ItemJuntado } from "@/components/mesa/hypeETrending";
import { tirarSementeDaCampanha } from "@/components/mesa/sementeDaCampanha";

const estado = vi.hoisted(() => ({ clientId: "cliente-a", dados: {} as Record<string, unknown>, ler: vi.fn(), trending: vi.fn(), pedido: vi.fn(), ordenar: vi.fn() }));
vi.mock("@/components/mesa/MesaContexto", () => ({ useMesa: () => ({ clientId: estado.clientId, catalogo: [], atualizarCusto: vi.fn() }) }));
vi.mock("@/components/sistema/TituloRecolhivel", () => ({ useRecolhido: () => [false, vi.fn()] }));
vi.mock("@/components/sistema/Secao", () => ({ CabecalhoDeSecao: ({ titulo, acao }: { titulo: string; acao: unknown }) => <div><h2>{titulo}</h2>{acao as never}</div> }));
vi.mock("@/components/mesa/Custo", () => ({
  AvisoDeErro: () => null,
  avisarCustoReal: vi.fn(),
  useAvisarErro: () => vi.fn(),
  // Estimativa fixa para o menu Criar mostrar o custo só ali dentro.
  useEstimativa: (_p: unknown, ativo: boolean) => ({ data: ativo ? 0.14 : undefined }),
  BotaoComCusto: ({ rotulo, executar }: { rotulo: unknown; executar: () => Promise<unknown> }) => <button type="button" onClick={() => void executar()}>{rotulo as never}</button>,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => { const q: Record<string, unknown> = {}; for (const m of ["select", "eq", "is", "limit", "in", "gte", "ilike"]) q[m] = () => q; q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok); return q; } } }));
vi.mock("@/components/mesa/mesaV4Api", async (original) => ({
  ...await original<typeof import("@/components/mesa/mesaV4Api")>(),
  lerHypes: async (id: string) => { estado.ler(id); return estado.dados[id] || null; },
  pedidoLivre: (p: unknown) => estado.pedido(p),
  buscarHypes: async () => ({}),
}));
vi.mock("@/components/mesa/hypeETrending", async (original) => ({
  ...await original<typeof import("@/components/mesa/hypeETrending")>(),
  buscarTrending: (...args: unknown[]) => estado.trending(...args),
  ordenarDatasDoHype: (...args: unknown[]) => estado.ordenar(...args),
}));

import HypesDaSemana from "@/components/mesa/HypesDaSemana";

const hypes: Hype[] = [
  { titulo: "Dia do café", formato: "estatico", fonte: "https://fonte.test/cafe", janela: "esta_semana", nota: 8, pauta: { tema: "Café da casa", gancho: "Hoje tem", laminas: ["a"], legenda: "x" } },
  { tipo: "nicho", titulo: "Decoração da vitrine", formato: "carrossel", sinal: "Busca por ambientes reais", fonte: "https://fonte.test/vitrine" },
  { tipo: "nicho", titulo: "Vídeo da montagem", formato: "reels", sinal: "Bastidores da loja" },
];
const pesquisa = (clientId: string, itens = hypes): PesquisaDeHypes => ({ client_id: clientId, itens, semana: "2026-10-19", criado_em: "2026-10-21T15:00:00Z", resumo: "Semana de vitrine." });
const agora = new Date().toISOString();
const noticia = { titulo: "Varejo projeta Black Friday recorde", fonte: "Jornal Teste", fonte_url: "https://jornal.test", link: "https://news.google.com/rss/articles/abc", data: agora };

beforeEach(() => {
  estado.clientId = "cliente-a";
  estado.dados = { "cliente-a": pesquisa("cliente-a") };
  estado.ler.mockClear();
  estado.pedido.mockReset().mockResolvedValue({});
  estado.trending.mockReset().mockResolvedValue({ assunto: "varejo", recencia: "7d", itens: [noticia], sugeridos: ["Varejo"], buscado_em: agora, fonte: "Google Notícias" });
  // Jev das datas: profissão e gastronomia não servem a este cliente; o resto serve.
  estado.ordenar.mockReset().mockImplementation(async (_c: string, datas: Array<{ id: string; tipo: string }>) => ({
    notas: Object.fromEntries(datas.map((d) => [d.id, { nota: d.tipo === "profissao" || d.tipo === "gastronomia" ? 1 : 8, nivel: null }])),
    segmento: "Moda",
    custo_usd: 0.0004,
  }));
  try { window.localStorage.clear(); } catch { /* sem armazenamento */ }
  tirarSementeDaCampanha("cliente-a");
});

const tela = (cache: QueryClient, criar = vi.fn()) => <QueryClientProvider client={cache}><HypesDaSemana onCriarCampanha={criar} /></QueryClientProvider>;
const montar = (criar = vi.fn()) => {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const r = render(tela(cache, criar));
  return { ...r, cache };
};
const abrirVisao = (nome: RegExp) => fireEvent.click(screen.getByRole("button", { name: nome }));

describe("leitura da semana", () => {
  it("aceita pesquisas antigas sem tipo, conserva os índices e não mistura clientes", () => {
    expect(itensDoTrendy(hypes, ["Hype: Dia do café"]).map((x) => x.indice)).toEqual([1, 2]);
    const dados = pesquisa("cliente-a");
    expect(dadosDoTrendy(dados, "cliente-b")).toBeNull();
    expect(dadosDoTrendy(dados, "cliente-a")).toBe(dados);
  });

  it("a fonte da tela não usa gap em flex nem lookbehind, \\p{} ou grupo nomeado (Safari 11)", () => {
    for (const arq of ["HypesDaSemana.tsx", "VisaoDaSemana.tsx", "AreaDoHype.tsx", "AreaDoTrending.tsx", "BarraDeJuntar.tsx", "LinhaDoHypeETrending.tsx", "hypeETrending.ts", "datasDoHype.ts", "trendy.ts"]) {
      const fonte = readFileSync(resolve("src/components/mesa", arq), "utf8");
      expect(fonte, arq).not.toMatch(/\(\?<[=!]|\\p\{|\(\?<[a-z]/i);
      expect(fonte, arq).not.toMatch(/\bflex\b[^"`]*\bgap-\d/);
    }
  });
});

describe("três visões: Da semana (a de antes, primeiro), Datas e Em alta", () => {
  it("abre na Da semana, igual ao modelo antigo: cartões, grupos, resumo, nota, sinal e Como usar com a pauta", async () => {
    const { cache } = montar();
    const nav = screen.getByRole("navigation", { name: "Visões do Radar" });
    expect(within(nav).getAllByRole("button").map((b) => b.getAttribute("data-etapa")).filter(Boolean)).toEqual(["semana", "datas", "em-alta", "trendy"]);
    expect(within(nav).getByRole("button", { name: /Da semana/ }).getAttribute("aria-current")).toBe("page");
    await screen.findByText("Dia do café");
    expect(screen.getByText("Hypes do momento")).toBeTruthy();
    expect(screen.getByText("Em alta no nicho")).toBeTruthy();
    expect(screen.getByText("Semana de vitrine.")).toBeTruthy();
    expect(screen.getByText("Busca por ambientes reais")).toBeTruthy();
    const cartao = screen.getByText("Dia do café").closest("article") as HTMLElement;
    expect(within(cartao).getByText("8")).toBeTruthy();
    fireEvent.click(within(cartao).getByRole("button", { name: /Como usar/ }));
    expect(within(cartao).getByText("Café da casa")).toBeTruthy();
    // Dois ícones diretos, sem menu: "Usar a pauta" (custo só no title) e "Criar campanha".
    expect(cartao.querySelectorAll("[role='menu'], [data-menu-criar]")).toHaveLength(0);
    const usar = within(cartao).getByRole("button", { name: "Usar a pauta" });
    expect(usar.getAttribute("title")).toBe("Usar a pauta · ~US$ 0,14");
    expect(cartao.textContent).not.toMatch(/US\$/);
    expect(within(cartao).getByRole("button", { name: "Criar campanha" })).toBeTruthy();
    fireEvent.click(usar);
    await waitFor(() => expect(estado.pedido).toHaveBeenCalledWith(expect.objectContaining({ clientId: "cliente-a", hype: { tipo: undefined, titulo: "Dia do café" } })));
    cache.clear();
  });

  it("sem duplicação: a leitura semanal só aparece na Da semana", async () => {
    const { cache } = montar();
    await screen.findByText("Dia do café");
    abrirVisao(/^Datas/);
    expect(screen.queryByText("Dia do café")).toBeNull();
    expect(screen.queryByText("Lidos na web")).toBeNull();
    abrirVisao(/^Em alta/);
    expect(screen.queryByText("Decoração da vitrine")).toBeNull();
    expect(screen.queryByText("Em alta no nicho")).toBeNull();
    cache.clear();
  });

  it("Datas: agrupadas por período, bloco de calendário, uma ação só e sem custo fixo nas linhas", async () => {
    const { cache } = montar();
    abrirVisao(/^Datas/);
    const area = document.querySelector('[data-area="hype"]') as HTMLElement;
    await waitFor(() => expect(area.querySelector("[data-grupo='outras']")).not.toBeNull());
    const grupos = Array.from(area.querySelectorAll("[data-grupo]:not([data-grupo='outras'])")).map((g) => g.querySelector("h4")!.textContent);
    expect(grupos.length).toBeGreaterThan(1);
    for (const g of grupos) expect(["Agora", "Próximas 2 semanas", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"].some((x) => (g || "").indexOf(x) === 0)).toBe(true);
    const linhas = Array.from(area.querySelectorAll("[data-linha-hype-trending]")) as HTMLElement[];
    expect(linhas.length).toBeGreaterThan(3);
    // Nenhum custo à vista nas linhas; cada uma tem só o bloco e o "Criar".
    for (const l of linhas) {
      expect(l.textContent).not.toMatch(/US\$/);
      expect(l.querySelector("[data-bloco]")).not.toBeNull();
      expect(Array.from(l.querySelectorAll("[data-acoes] button")).map((b) => b.getAttribute("aria-label"))).toEqual(["Criar conteúdo", "Criar campanha"]);
      expect(l.querySelector("[data-acoes] [data-criar-conteudo]")!.getAttribute("title")).toMatch(/^Criar conteúdo · ~US\$/);
    }
    // O mês curto do bloco vem em maiúsculas pelo código ("25 OUT").
    expect(linhas[0].querySelector("[data-bloco]")!.textContent).toMatch(/^\d{2}[A-Z]{3}$/);
    cache.clear();
  });

  it("Datas: o primeiro item fica logo abaixo do cabeçalho, sem rolagem guardada e com respiro", async () => {
    const { cache } = montar();
    abrirVisao(/^Datas/);
    const area = document.querySelector('[data-area="hype"]') as HTMLElement;
    expect(area.firstElementChild!.hasAttribute("data-cabecalho-da-coluna")).toBe(true);
    const rola = Array.from(area.querySelectorAll("div")).find((d) => d.className.split(" ").indexOf("lg:overflow-y-auto") >= 0) as HTMLElement;
    expect(rola.scrollTop).toBe(0);
    expect(rola.className).toContain("pt-1");
    expect(rola.className).toContain("pb-6");
    cache.clear();
  });

  it("Em alta: vazio com ação, notícia real com link, uma ação só e erro com Tentar de novo", async () => {
    estado.trending.mockReset().mockRejectedValueOnce(new Error("O Google Notícias não respondeu.")).mockResolvedValue({ assunto: "café", recencia: "7d", itens: [noticia], sugeridos: [], buscado_em: agora });
    const { cache } = montar();
    abrirVisao(/^Em alta/);
    fireEvent.click(screen.getByRole("button", { name: /^Buscar o que está em alta\s*~/ }));
    await screen.findByText("Não foi possível buscar as notícias.");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await screen.findByText(noticia.titulo);
    expect(screen.getByRole("link", { name: `Abrir a matéria: ${noticia.titulo}` }).getAttribute("href")).toBe(noticia.link);
    const linha = screen.getByText(noticia.titulo).closest("li") as HTMLElement;
    expect(linha.textContent).not.toMatch(/US\$/);
    expect(Array.from(linha.querySelectorAll("[data-acoes] button")).map((b) => b.getAttribute("aria-label"))).toEqual(["Criar conteúdo desta notícia", "Criar campanha"]);
    cache.clear();
  });
});

describe("nicho do cliente (o que cabe no marketing)", () => {
  it("Em alta: mostra o que serve com o porquê; o que não serve fica em Mostrar descartadas", async () => {
    estado.trending.mockReset().mockResolvedValue({
      assunto: "Moda", recencia: "7d", sugeridos: ["Moda"], buscado_em: agora, fonte: "Google Notícias", custo_usd: 0.0012,
      itens: [
        { ...noticia, titulo: "Tendência de jeans volta às vitrines", link: "https://n.test/1", julgamento: { cabe: "serve", motivo: "Serve para surfar uma tendência que o público está acompanhando.", sensivel: false } },
        { ...noticia, titulo: "Acidente na BR deixa feridos", link: "https://n.test/2", julgamento: { cabe: "nao_serve", motivo: "Assunto sensível: não serve para marca.", sensivel: true } },
        { ...noticia, titulo: "Juros sobem de novo", link: "https://n.test/3", julgamento: { cabe: "nao_serve", motivo: "Não tem relação com o negócio ou o público do cliente.", sensivel: false } },
      ],
    });
    const { cache } = montar();
    abrirVisao(/^Em alta/);
    fireEvent.click(screen.getByRole("button", { name: /^Buscar o que está em alta\s*~/ }));
    await screen.findByText("Tendência de jeans volta às vitrines");
    expect(screen.getByText("Serve para surfar uma tendência que o público está acompanhando.")).toBeTruthy();
    expect(screen.queryByText("Acidente na BR deixa feridos")).toBeNull();
    expect(screen.queryByText("Juros sobem de novo")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mostrar descartadas (2)" }));
    expect(screen.getByText("Acidente na BR deixa feridos")).toBeTruthy();
    expect(screen.getByText("Assunto sensível: não serve para marca.")).toBeTruthy();
    // O custo do Jev está à vista no botão de buscar.
    expect(screen.getByRole("button", { name: "Buscar notícias" }).textContent).toMatch(/US\$/);
    cache.clear();
  });

  it("Datas: o Jev roda sozinho na 1ª abertura da semana e o que não é do nicho fica em Outras datas (recolhido)", async () => {
    const { cache } = montar();
    abrirVisao(/^Datas/);
    await waitFor(() => expect(estado.ordenar).toHaveBeenCalledTimes(1));
    const area = () => document.querySelector('[data-area="hype"]') as HTMLElement;
    await waitFor(() => expect(area().querySelector("[data-estado-do-jev]")!.textContent).toContain("Do nicho do cliente"));
    const principal = Array.from(area().querySelectorAll("[data-grupo]:not([data-grupo='outras']) [data-linha-hype-trending]"));
    expect(principal.length).toBeGreaterThan(0);
    expect(area().textContent).not.toMatch(/Dia do (Médico|Dentista|Professor)/);
    fireEvent.click(within(area()).getByRole("button", { name: /^Outras datas \(\d+\)/ }));
    expect(within(area()).getByRole("list", { name: "Outras datas" })).toBeTruthy();
    // Reabrir na mesma semana não chama o Jev de novo (notas guardadas).
    abrirVisao(/^Em alta/);
    abrirVisao(/^Datas/);
    await waitFor(() => expect(area().querySelector("[data-estado-do-jev]")!.textContent).toContain("Do nicho do cliente"));
    expect(estado.ordenar).toHaveBeenCalledTimes(1);
    cache.clear();
  });

  it("Da semana e Trendy na ordem da relevância ao cliente (nota do Jev)", async () => {
    estado.dados["cliente-a"] = pesquisa("cliente-a", [{ titulo: "Nota baixa", nota: 2, janela: "hoje" }, { titulo: "Nota alta", nota: 9, janela: "hoje" }, { titulo: "Sem nota", janela: "hoje" }]);
    const { cache } = montar();
    await screen.findByText("Nota alta");
    const titulos = () => Array.from(document.querySelectorAll("[data-cartao-da-semana] h3")).map((x) => x.textContent);
    expect(titulos()).toEqual(["Nota alta", "Nota baixa", "Sem nota"]);
    abrirVisao(/^Trendy/);
    const linhas = Array.from(document.querySelectorAll('[data-area="trendy"] [data-linha-hype-trending] button[aria-expanded] > span[title]')).map((x) => x.textContent);
    expect(linhas).toEqual(["Nota alta", "Nota baixa", "Sem nota"]);
    cache.clear();
  });
});

describe("Trendy (4ª visão, o do Codex de volta)", () => {
  it("existe depois de Em alta, com busca, tipo, formato só dos que existem, fonte e a data da pesquisa", async () => {
    const { cache } = montar();
    const nav = screen.getByRole("navigation", { name: "Visões do Radar" });
    expect(within(nav).getAllByRole("button").map((b) => b.getAttribute("data-etapa")).filter(Boolean)).toEqual(["semana", "datas", "em-alta", "trendy"]);
    await screen.findByText("Dia do café");
    abrirVisao(/^Trendy/);
    const area = document.querySelector('[data-area="trendy"]') as HTMLElement;
    expect(within(area).getByRole("status").textContent).toBe("3 de 3 sugestões · pesquisa de 21/10");
    // Formato: só os que existem (estático, carrossel, vídeo); nunca Foto nem Stories.
    fireEvent.keyDown(within(area).getByRole("button", { name: "Filtrar e ordenar" }), { key: "Enter" });
    const opcoes = (await screen.findAllByRole("menuitemradio")).map((o) => o.textContent);
    expect(opcoes).toContain("Carrossel");
    expect(opcoes).toContain("Estático");
    expect(opcoes).toContain("Vídeo / Reels");
    expect(opcoes).not.toContain("Foto");
    expect(opcoes).not.toContain("Stories");
    expect(opcoes).toContain("fonte.test");
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^Nicho/ }));
    expect(within(area).getByRole("status").textContent).toContain("2 de 3");
    fireEvent.change(within(area).getByLabelText("Buscar nas sugestões"), { target: { value: "vitrine" } });
    expect(within(area).getByRole("status").textContent).toContain("1 de 3");
    fireEvent.click(within(area).getByRole("button", { name: "Limpar filtros" }));
    expect(within(area).getByRole("status").textContent).toContain("3 de 3");
    cache.clear();
  });

  it("o ícone Criar campanha leva o índice original; juntar funciona no Trendy", async () => {
    const criar = vi.fn();
    const { cache } = montar(criar);
    await screen.findByText("Dia do café");
    abrirVisao(/^Trendy/);
    const area = () => document.querySelector('[data-area="trendy"]') as HTMLElement;
    fireEvent.change(within(area()).getByLabelText("Buscar nas sugestões"), { target: { value: "montagem" } });
    const linha = within(area()).getByText("Vídeo da montagem").closest("li") as HTMLElement;
    fireEvent.click(within(linha).getByRole("button", { name: "Criar campanha" }));
    expect(criar).toHaveBeenCalledTimes(1);
    expect(tirarSementeDaCampanha("cliente-a")!.trends.map((t) => t.titulo)).toEqual(["Vídeo da montagem"]);
    // Juntar: a mesma chave da leitura (índice original 0 do Dia do café).
    fireEvent.click(screen.getByRole("button", { name: "Juntar para campanha" }));
    fireEvent.change(within(area()).getByLabelText("Buscar nas sugestões"), { target: { value: "" } });
    fireEvent.click(within(area()).getByRole("checkbox", { name: "Juntar Dia do café" }));
    fireEvent.click(within(document.querySelector("[data-barra-de-juntar]") as HTMLElement).getByRole("button", { name: "Criar campanha" }));
    expect(tirarSementeDaCampanha("cliente-a")!.hypes).toEqual([expect.objectContaining({ titulo: "Dia do café", indice: 0 })]);
    cache.clear();
  });
});

describe("juntar para a campanha", () => {
  it("cada lista aceita até 6 itens e desmarca no segundo clique", () => {
    let lista: ItemJuntado[] = [];
    for (let i = 0; i < MAXIMO_POR_LISTA + 2; i += 1) lista = alternarJuntado(lista, juntadoDaNoticia({ ...noticia, link: `https://n.test/${i}` }));
    expect(lista).toHaveLength(MAXIMO_POR_LISTA);
    lista = alternarJuntado(lista, juntadoDaNoticia({ ...noticia, link: "https://n.test/0" }));
    expect(lista).toHaveLength(MAXIMO_POR_LISTA - 1);
    expect(sementeDaSelecao(lista, " Black Friday com 30% ").pedido).toBe("Black Friday com 30%");
  });

  it("as caixinhas só aparecem no modo juntar; juntar funciona nas três visões e a barra grava a semente", async () => {
    const criar = vi.fn();
    const { cache } = montar(criar);
    await screen.findByText("Dia do café");
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Juntar para campanha" }));
    // Da semana
    fireEvent.click(screen.getByRole("checkbox", { name: "Juntar Dia do café" }));
    // Datas
    abrirVisao(/^Datas/);
    const primeira = document.querySelector('[data-area="hype"] [data-linha-hype-trending]') as HTMLElement;
    const tituloDaData = primeira.querySelector("button[aria-expanded]")!.textContent!;
    fireEvent.click(within(primeira).getByRole("checkbox"));
    // Em alta
    abrirVisao(/^Em alta/);
    fireEvent.click(screen.getByRole("button", { name: /^Buscar o que está em alta\s*~/ }));
    await screen.findByText(noticia.titulo);
    fireEvent.click(screen.getByRole("checkbox", { name: `Juntar ${noticia.titulo}` }));
    const barra = document.querySelector("[data-barra-de-juntar]") as HTMLElement;
    expect(barra.textContent).toContain("3 selecionados");
    fireEvent.change(screen.getByLabelText("Pedido da campanha (opcional)"), { target: { value: "Black Friday com 30% no plano anual" } });
    fireEvent.click(within(barra).getByRole("button", { name: "Criar campanha" }));
    expect(criar).toHaveBeenCalledTimes(1);
    const s = tirarSementeDaCampanha("cliente-a")!;
    expect(s.pedido).toBe("Black Friday com 30% no plano anual");
    expect(s.hypes.map((h) => h.titulo)).toEqual(["Dia do café", tituloDaData]);
    expect(s.hypes[0].indice).toBe(0);
    expect(s.trends).toEqual([{ titulo: noticia.titulo, fonte: "Jornal Teste", url: noticia.link, data: agora, resumo: undefined }]);
    expect(document.querySelector("[data-barra-de-juntar]")).toBeNull();
    cache.clear();
  });

  it("o ícone Criar campanha de um item só grava a semente de um item", async () => {
    const criar = vi.fn();
    const { cache } = montar(criar);
    const cartao = (await screen.findByText("Decoração da vitrine")).closest("article") as HTMLElement;
    fireEvent.click(within(cartao).getByRole("button", { name: "Criar campanha" }));
    expect(criar).toHaveBeenCalledTimes(1);
    const s = tirarSementeDaCampanha("cliente-a")!;
    expect(s.hypes).toEqual([]);
    expect(s.trends.map((t) => t.titulo)).toEqual(["Decoração da vitrine"]);
    cache.clear();
  });

  it("Buscar o que está em alta agora busca as notícias do nicho e abre o Em alta", async () => {
    const { cache } = montar();
    await screen.findByText("Dia do café");
    fireEvent.click(screen.getByRole("button", { name: /Buscar o que está em alta agora/ }));
    await screen.findByText(noticia.titulo);
    expect(estado.trending).toHaveBeenCalledWith("cliente-a", "", "7d");
    expect(screen.getByRole("button", { name: /^Em alta/ }).getAttribute("aria-current")).toBe("page");
    cache.clear();
  });

  it("trocar de cliente não leva a seleção nem a leitura do anterior", async () => {
    estado.dados["cliente-b"] = pesquisa("cliente-b", [{ titulo: "Flores do cliente B", janela: "hoje" }]);
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(tela(cache));
    await screen.findByText("Dia do café");
    fireEvent.click(screen.getByRole("button", { name: "Juntar para campanha" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Juntar Dia do café" }));
    expect(document.querySelector("[data-barra-de-juntar]")).not.toBeNull();
    estado.clientId = "cliente-b";
    rerender(tela(cache));
    await screen.findByText("Flores do cliente B");
    expect(screen.queryByText("Dia do café")).toBeNull();
    expect(document.querySelector("[data-barra-de-juntar]")).toBeNull();
    cache.clear();
  });
});

describe("link antigo &hype=<n>", () => {
  it("a página ainda lê o parâmetro hype e o entrega à aba Campanhas; o novo caminho abre a campanha nova", () => {
    const pagina = readFileSync(resolve("src/pages/MesaDoCliente.tsx"), "utf8");
    expect(pagina).toContain('params.get("hype")');
    expect(pagina).toContain("hypeIndice={hypeUrl}");
    expect(pagina).toMatch(/onCriarCampanha=\{\(\) => mudar\(\{ aba: "campanhas", campanha: null, hype: null, nova: "1" \}\)\}/);
  });
});
