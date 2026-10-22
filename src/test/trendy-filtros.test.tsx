import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Hype, HypesDaSemana as PesquisaDeHypes } from "@/components/mesa/mesaV4Api";
import { dadosDoTrendy, itensDoTrendy, separarLeitura } from "@/components/mesa/trendy";
import { alternarJuntado, juntadoDaNoticia, MAXIMO_POR_LISTA, sementeDaSelecao, type ItemJuntado } from "@/components/mesa/hypeETrending";
import { tirarSementeDaCampanha } from "@/components/mesa/sementeDaCampanha";

const estado = vi.hoisted(() => ({ clientId: "cliente-a", dados: {} as Record<string, unknown>, ler: vi.fn(), trending: vi.fn() }));
vi.mock("@/components/mesa/MesaContexto", () => ({ useMesa: () => ({ clientId: estado.clientId, catalogo: [] }) }));
vi.mock("@/components/sistema/TituloRecolhivel", () => ({ useRecolhido: () => [false, vi.fn()] }));
vi.mock("@/components/sistema/Secao", () => ({ CabecalhoDeSecao: ({ titulo, acao }: { titulo: string; acao: unknown }) => <div><h2>{titulo}</h2>{acao as never}</div> }));
vi.mock("@/components/mesa/Custo", () => ({
  AvisoDeErro: () => null,
  BotaoComCusto: ({ rotulo, executar }: { rotulo: unknown; executar: () => Promise<unknown> }) => <button type="button" onClick={() => void executar()}>{rotulo as never}</button>,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => { const q: Record<string, unknown> = {}; for (const m of ["select", "eq", "is", "limit", "in", "gte", "ilike"]) q[m] = () => q; q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok); return q; } } }));
vi.mock("@/components/mesa/mesaV4Api", async (original) => ({
  ...await original<typeof import("@/components/mesa/mesaV4Api")>(),
  lerHypes: async (id: string) => { estado.ler(id); return estado.dados[id] || null; },
}));
vi.mock("@/components/mesa/hypeETrending", async (original) => ({
  ...await original<typeof import("@/components/mesa/hypeETrending")>(),
  buscarTrending: (...args: unknown[]) => estado.trending(...args),
}));

import HypesDaSemana from "@/components/mesa/HypesDaSemana";

const hypes: Hype[] = [
  { titulo: "Dia do café", formato: "estatico", fonte: "https://fonte.test/cafe", janela: "esta_semana" },
  { tipo: "nicho", titulo: "Decoração da vitrine", formato: "carrossel", sinal: "Busca por ambientes reais", fonte: "https://fonte.test/vitrine" },
  { tipo: "nicho", titulo: "Vídeo da montagem", formato: "reels", sinal: "Bastidores da loja" },
];
const pesquisa = (clientId: string, itens = hypes): PesquisaDeHypes => ({ client_id: clientId, itens, semana: "2026-10-19", criado_em: "2026-10-21T15:00:00Z", resumo: null });
const agora = new Date().toISOString();
const noticia = { titulo: "Varejo projeta Black Friday recorde", fonte: "Jornal Teste", fonte_url: "https://jornal.test", link: "https://news.google.com/rss/articles/abc", data: agora };

beforeEach(() => {
  estado.clientId = "cliente-a";
  estado.dados = { "cliente-a": pesquisa("cliente-a") };
  estado.ler.mockClear();
  estado.trending.mockReset().mockResolvedValue({ assunto: "varejo", recencia: "7d", itens: [noticia], sugeridos: ["Varejo"], buscado_em: agora, fonte: "Google Notícias" });
  tirarSementeDaCampanha("cliente-a");
});

const tela = (cache: QueryClient, criar = vi.fn()) => <QueryClientProvider client={cache}><HypesDaSemana onCriarCampanha={criar} /></QueryClientProvider>;

describe("leitura da semana dentro de Hype e Trending", () => {
  it("aceita pesquisas antigas sem tipo, conserva os índices e separa hype de nicho", () => {
    const itens = itensDoTrendy(hypes, ["Hype: Dia do café"]);
    expect(itens.map((x) => x.indice)).toEqual([1, 2]);
    const { hype, nicho } = separarLeitura(itensDoTrendy(hypes, []));
    expect(hype.map((x) => x.indice)).toEqual([0]);
    expect(nicho.map((x) => x.indice)).toEqual([1, 2]);
  });

  it("não trata resultados de outro cliente como do cliente aberto", () => {
    const dados = pesquisa("cliente-a");
    expect(dadosDoTrendy(dados, "cliente-b")).toBeNull();
    expect(dadosDoTrendy(dados, "cliente-a")).toBe(dados);
    expect(dadosDoTrendy(undefined, "cliente-a")).toBeNull();
  });

  it("a fonte da tela não usa gap em flex nem lookbehind, \\p{} ou grupo nomeado (Safari 11)", () => {
    for (const arq of ["HypesDaSemana.tsx", "AreaDoHype.tsx", "AreaDoTrending.tsx", "BarraDeJuntar.tsx", "LinhaDoHypeETrending.tsx", "hypeETrending.ts", "datasDoHype.ts", "trendy.ts"]) {
      const fonte = readFileSync(resolve("src/components/mesa", arq), "utf8");
      expect(fonte, arq).not.toMatch(/\(\?<[=!]|\\p\{|\(\?<[a-z]/i);
      expect(fonte, arq).not.toMatch(/\bflex\b[^"`]*\bgap-\d/);
    }
  });
});

describe("juntar para a campanha", () => {
  it("cada lista aceita até 6 itens e desmarca no segundo clique", () => {
    let lista: ItemJuntado[] = [];
    for (let i = 0; i < MAXIMO_POR_LISTA + 2; i += 1) lista = alternarJuntado(lista, juntadoDaNoticia({ ...noticia, link: `https://n.test/${i}` }));
    expect(lista).toHaveLength(MAXIMO_POR_LISTA);
    lista = alternarJuntado(lista, juntadoDaNoticia({ ...noticia, link: "https://n.test/0" }));
    expect(lista).toHaveLength(MAXIMO_POR_LISTA - 1);
    expect(sementeDaSelecao(lista, "  ")).not.toHaveProperty("pedido");
    expect(sementeDaSelecao(lista, " Black Friday com 30% ").pedido).toBe("Black Friday com 30%");
  });

  it("marca uma data, um hype da leitura e uma notícia; a barra grava a semente com o pedido e abre a campanha", async () => {
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const criar = vi.fn();
    render(tela(cache, criar));
    expect(screen.getByRole("heading", { name: "Hype e Trending" })).toBeTruthy();
    await screen.findByText("Dia do café");
    // Hype: a 1ª data do calendário fixo e o hype lido na web.
    const datas = screen.getByRole("list", { name: "Datas que vêm por aí" });
    const primeiraData = within(datas).getAllByRole("listitem")[0];
    const tituloDaData = primeiraData.querySelector("p")!.textContent!;
    fireEvent.click(within(primeiraData).getByRole("checkbox"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Juntar Dia do café" }));
    expect((document.querySelector("[data-barra-de-juntar]") as HTMLElement).textContent).toContain("2 selecionados");
    // Trending: vazio com ação; a busca traz a manchete real.
    fireEvent.click(screen.getByRole("button", { name: /^Trending/ }));
    fireEvent.click(screen.getByRole("button", { name: "Buscar o que está em alta" }));
    await screen.findByText(noticia.titulo);
    expect(estado.trending).toHaveBeenCalledWith("cliente-a", "", "7d");
    expect(screen.getByRole("link", { name: `Abrir a matéria: ${noticia.titulo}` }).getAttribute("href")).toBe(noticia.link);
    fireEvent.click(screen.getByRole("checkbox", { name: `Juntar ${noticia.titulo}` }));
    fireEvent.change(screen.getByLabelText("Pedido da campanha (opcional)"), { target: { value: "Black Friday com 30% no plano anual" } });
    const barra = document.querySelector("[data-barra-de-juntar]") as HTMLElement;
    expect(barra.textContent).toContain("3 selecionados");
    fireEvent.click(within(barra).getByRole("button", { name: "Criar campanha" }));
    expect(criar).toHaveBeenCalledTimes(1);
    const s = tirarSementeDaCampanha("cliente-a")!;
    expect(s.pedido).toBe("Black Friday com 30% no plano anual");
    expect(s.hypes.map((h) => h.titulo)).toEqual([tituloDaData, "Dia do café"]);
    expect(s.hypes[1].indice).toBe(0);
    expect(s.trends).toEqual([{ titulo: noticia.titulo, fonte: "Jornal Teste", url: noticia.link, data: agora, resumo: undefined }]);
    // A seleção zera depois de criar.
    expect(document.querySelector("[data-barra-de-juntar]")).toBeNull();
    cache.clear();
  });

  it("erro do Trending mostra Tentar de novo, que busca outra vez", async () => {
    estado.trending.mockReset().mockRejectedValueOnce(new Error("O Google Notícias não respondeu.")).mockResolvedValue({ assunto: "café", recencia: "24h", itens: [noticia], sugeridos: [], buscado_em: agora });
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(tela(cache));
    fireEvent.click(screen.getByRole("button", { name: /^Trending/ }));
    fireEvent.change(screen.getByLabelText("Assunto das notícias"), { target: { value: "café" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar notícias" }));
    await screen.findByText("Não foi possível buscar as notícias.");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await screen.findByText(noticia.titulo);
    expect(estado.trending).toHaveBeenLastCalledWith("cliente-a", "café", "7d");
    cache.clear();
  });

  it("trocar de cliente não leva a seleção nem a leitura do anterior", async () => {
    estado.dados["cliente-b"] = pesquisa("cliente-b", [{ titulo: "Flores do cliente B", janela: "hoje" }]);
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(tela(cache));
    await screen.findByText("Dia do café");
    fireEvent.click(screen.getByRole("checkbox", { name: "Juntar Dia do café" }));
    expect(document.querySelector("[data-barra-de-juntar]")).not.toBeNull();
    estado.clientId = "cliente-b";
    rerender(tela(cache));
    await screen.findByText("Flores do cliente B");
    expect(screen.queryByText("Dia do café")).toBeNull();
    expect(document.querySelector("[data-barra-de-juntar]")).toBeNull();
    await waitFor(() => expect(estado.ler).toHaveBeenCalledWith("cliente-b"));
    cache.clear();
  });
});

describe("2ª rodada: organizado, alinhado e complementar", () => {
  it("as duas colunas têm cabeçalho fixo e rolagem própria (de 1024 px para cima), com espaço no fim", async () => {
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(tela(cache));
    await screen.findByText("Dia do café");
    const colunas = [document.querySelector('[data-area="hype"]') as HTMLElement];
    fireEvent.click(screen.getByRole("button", { name: /^Trending/ }));
    colunas.push(document.querySelector('[data-area="trending"]') as HTMLElement);
    for (const c of colunas) {
      expect(c.className).toContain("lg:h-[640px]");
      expect(c.firstElementChild!.hasAttribute("data-cabecalho-da-coluna")).toBe(true);
      const rola = Array.from(c.querySelectorAll("div")).find((d) => d.className.split(" ").indexOf("lg:overflow-y-auto") >= 0) as HTMLElement;
      expect(rola).not.toBeNull();
      expect(rola.className).toContain("pb-6");
      expect(rola.className).not.toMatch(/(^| )overflow-y-auto/);
    }
    cache.clear();
  });

  it("toda linha é a mesma grade: caixinha, texto, nota no mesmo lugar e as ações sempre por último", async () => {
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(tela(cache));
    await screen.findByText("Dia do café");
    const linhas = Array.from(document.querySelectorAll("[data-linha-hype-trending]"));
    expect(linhas.length).toBeGreaterThan(3);
    const grades = new Set(linhas.map((l) => (l.className.match(/grid-cols-\[[^\]]+\]/) || [""])[0]));
    expect(Array.from(grades)).toEqual(["grid-cols-[20px_minmax(0,1fr)_28px_auto]"]);
    for (const l of linhas) {
      const filhos = Array.from(l.children);
      expect(filhos).toHaveLength(4);
      expect(filhos[2].hasAttribute("data-nota")).toBe(true);
      expect(filhos[3].hasAttribute("data-acoes")).toBe(true);
      // Criar conteúdo, Criar campanha e o lugar da seta: sempre 3 peças, na mesma ordem.
      expect(filhos[3].children).toHaveLength(3);
      expect(filhos[3].children[1].getAttribute("aria-label")).toBe("Criar campanha");
    }
    cache.clear();
  });

  it("mantém o que já havia: leitura semanal (hype e nicho), pauta pronta com Usar a pauta e o sinal do nicho", async () => {
    estado.dados["cliente-a"] = pesquisa("cliente-a", hypes.concat([{ titulo: "Pauta do feriado", janela: "hoje", pauta: { tema: "Feriado", gancho: "Abre amanhã", laminas: ["a"], legenda: "x" } }]));
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(tela(cache));
    const linha = (await screen.findByText("Pauta do feriado")).closest("li") as HTMLElement;
    expect(within(linha).getByRole("button", { name: /Usar a pauta/ })).toBeTruthy();
    expect(screen.getByText("Lidos na web")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Trending/ }));
    expect(screen.getByText("Em alta no nicho")).toBeTruthy();
    expect(screen.getByText("Decoração da vitrine")).toBeTruthy();
    expect(screen.getByText("Busca por ambientes reais")).toBeTruthy();
    cache.clear();
  });

  it("Buscar o que está em alta agora busca as notícias do nicho e abre o Trending", async () => {
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(tela(cache));
    await screen.findByText("Dia do café");
    fireEvent.click(screen.getByRole("button", { name: /Buscar o que está em alta agora/ }));
    await screen.findByText(noticia.titulo);
    expect(estado.trending).toHaveBeenCalledWith("cliente-a", "", "7d");
    expect(document.querySelector('[data-area="trending"]')).not.toBeNull();
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
