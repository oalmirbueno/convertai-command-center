import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Hype, HypesDaSemana as PesquisaDeHypes } from "@/components/mesa/mesaV4Api";
import { dadosDoTrendy, filtrarTrendy, FILTROS_INICIAIS_DO_TRENDY, formatoDoTrendy, itensDoTrendy } from "@/components/mesa/trendy";

const estado = vi.hoisted(() => ({ clientId: "cliente-a", dados: {} as Record<string, unknown>, ler: vi.fn() }));
vi.mock("@/components/mesa/MesaContexto", () => ({ useMesa: () => ({ clientId: estado.clientId, catalogo: [] }) }));
vi.mock("@/components/sistema/TituloRecolhivel", () => ({ useRecolhido: () => [false, vi.fn()] }));
vi.mock("@/components/sistema/Secao", () => ({ CabecalhoDeSecao: ({ titulo }: { titulo: string }) => <h2>{titulo}</h2> }));
vi.mock("@/components/mesa/Custo", () => ({ AvisoDeErro: () => null, BotaoComCusto: () => <button type="button">Criar conteúdo</button> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => { const q: Record<string, unknown> = {}; for (const m of ["select", "eq", "is", "limit"]) q[m] = () => q; q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok); return q; } } }));
vi.mock("@/components/mesa/mesaV4Api", async (original) => ({
  ...await original<typeof import("@/components/mesa/mesaV4Api")>(),
  lerHypes: async (id: string) => { estado.ler(id); return estado.dados[id] || null; },
}));

import HypesDaSemana from "@/components/mesa/HypesDaSemana";

const hypes: Hype[] = [
  { titulo: "Dia do café", formato: "estatico", fonte: "https://fonte.test/cafe" },
  { tipo: "nicho", titulo: "Decoração da vitrine", formato: "carrossel", sinal: "Busca por ambientes reais", fonte: "https://fonte.test/vitrine" },
  { tipo: "nicho", titulo: "Vídeo da montagem", formato: "reels", sinal: "Bastidores da loja" },
];
const pesquisa = (clientId: string, itens = hypes): PesquisaDeHypes => ({ client_id: clientId, itens, semana: "2026-10-19", criado_em: "2026-10-21T15:00:00Z", resumo: null });

beforeEach(() => { estado.clientId = "cliente-a"; estado.dados = { "cliente-a": pesquisa("cliente-a") }; estado.ler.mockClear(); });

describe("Trendy preserva os dados do mês", () => {
  it("aceita pesquisas antigas sem tipo e conserva os índices para campanha após filtrar", () => {
    const itens = itensDoTrendy(hypes, ["Hype: Dia do café"]);
    const filtrados = filtrarTrendy(itens, { ...FILTROS_INICIAIS_DO_TRENDY, tipo: "nicho", formato: "carrossel", busca: "decoracao reais" });
    expect(filtrados).toEqual([{ h: hypes[1], indice: 1 }]);
    expect(hypes).toHaveLength(3);
    expect(filtrarTrendy(itensDoTrendy(hypes, []), { ...FILTROS_INICIAIS_DO_TRENDY, tipo: "momento" })).toEqual([{ h: hypes[0], indice: 0 }]);
  });

  it("não trata resultados de outro cliente como sugestões do cliente aberto", () => {
    const dados = pesquisa("cliente-a");
    expect(dadosDoTrendy(dados, "cliente-b")).toBeNull();
    expect(dadosDoTrendy(dados, "cliente-a")).toBe(dados);
    expect(dadosDoTrendy(undefined, "cliente-a")).toBeNull();
  });

  it("busca na fonte e no sinal sem modificar a pesquisa existente", () => {
    const antes = JSON.stringify(hypes);
    expect(filtrarTrendy(itensDoTrendy(hypes, []), { ...FILTROS_INICIAIS_DO_TRENDY, busca: "fonte.test vitrine" }).map((x) => x.indice)).toEqual([1]);
    expect(filtrarTrendy(itensDoTrendy(hypes, []), { ...FILTROS_INICIAIS_DO_TRENDY, busca: "Bastidores" }).map((x) => x.indice)).toEqual([2]);
    expect(JSON.stringify(hypes)).toBe(antes);
  });

  it.each([["vídeo", "video"], ["Reels", "video"], ["Carrossel", "carrossel"], ["Stories", "story"], ["estático", "estatico"], [undefined, "outro"]])("agrupa formato %s como %s", (entrada, esperado) => {
    expect(formatoDoTrendy(entrada)).toBe(esperado);
  });
});

describe("Trendy na Mesa", () => {
  it("filtra sem pesquisar novamente e campanha recebe o índice da lista original", async () => {
    const criar = vi.fn();
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={cache}><HypesDaSemana onCriarCampanha={criar} /></QueryClientProvider>);
    await screen.findByText("Decoração da vitrine");
    expect(screen.getByRole("heading", { name: "Trendy" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ver fonte de Decoração da vitrine" }).getAttribute("href")).toBe("https://fonte.test/vitrine");
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "nicho" } });
    fireEvent.change(screen.getByLabelText("Formato"), { target: { value: "carrossel" } });
    expect(screen.queryByText("Dia do café")).toBeNull();
    expect(screen.queryByText("Vídeo da montagem")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Criar campanha" }));
    expect(criar).toHaveBeenCalledWith(1);
    expect(estado.ler.mock.calls).toEqual([["cliente-a"]]);
    expect(screen.getByRole("status").textContent).toContain("1 de 3 sugestões");
    fireEvent.change(screen.getByLabelText("Buscar nas sugestões"), { target: { value: "inexistente" } });
    expect(screen.getByText("Nenhuma sugestão com estes filtros.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    expect(screen.getByText("Dia do café")).toBeTruthy();
    cache.clear();
  });

  it("trocar de cliente não reutiliza sugestões nem filtros anteriores", async () => {
    estado.dados["cliente-b"] = pesquisa("cliente-b", [{ titulo: "Flores do cliente B", formato: "foto" }]);
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tela = () => <QueryClientProvider client={cache}><HypesDaSemana onCriarCampanha={vi.fn()} /></QueryClientProvider>;
    const { rerender } = render(tela());
    await screen.findByText("Dia do café");
    fireEvent.change(screen.getByLabelText("Buscar nas sugestões"), { target: { value: "café" } });
    estado.clientId = "cliente-b";
    rerender(tela());
    await screen.findByText("Flores do cliente B");
    expect(screen.queryByText("Dia do café")).toBeNull();
    expect((screen.getByLabelText("Buscar nas sugestões") as HTMLInputElement).value).toBe("");
    await waitFor(() => expect(estado.ler).toHaveBeenCalledWith("cliente-b"));
    cache.clear();
  });
});
