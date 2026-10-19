import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Laboratório, 20/10/2026 (pedido do dono):
 * - Início: Fluxos e Recentes lado a lado no desktop (fluxos 2/3, recentes numa coluna), empilha no celular.
 * - Galeria de fluxos: abas de categoria (campo `categoria`, sem ele "Outros"), busca, miniatura,
 *   número de nós, "Usar fluxo" e a aba "Seus fluxos".
 * - Créditos do Laboratório: chip no cabeçalho, janela com saldo/extrato, carregar só admin, e a
 *   janela de custo com "saldo depois" e "Carregar créditos" quando falta.
 */

const m = vi.hoisted(() => ({ chamar: vi.fn() }));

vi.mock("@/lib/mesa/api", async (orig) => ({ ...(await orig<typeof import("@/lib/mesa/api")>()), chamarFuncao: m.chamar }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u1" } }) }));
vi.mock("@/hooks/useSupabaseData", () => ({
  useClients: () => ({ data: [{ id: "11111111-1111-4111-8111-111111111111", company_name: "Acerbi" }], isLoading: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/laboratorio/estudio-livre/EstudioLivre", () => ({ default: () => <div /> }));
vi.mock("@/integrations/supabase/client", () => {
  const cadeia = (): any => {
    const c: any = new Proxy(function () {}, {
      get: (_t, k) => (k === "then" ? (ok: (v: unknown) => void) => ok({ data: [], error: null }) : c),
      apply: () => c,
    });
    return c;
  };
  return { supabase: { from: () => cadeia(), rpc: () => cadeia(), functions: { invoke: vi.fn() }, storage: { from: () => ({}) } } };
});

import Laboratorio from "@/pages/Laboratorio";
import JanelaDeCusto from "@/components/laboratorio/JanelaDeCusto";
import { categoriasDos, filtrarFluxos, semAcento } from "@/components/laboratorio/GaleriaDeFluxos";
import { ErroDaMesa } from "@/lib/mesa/api";
import { saldoDepoisDoCusto, semCredito, type FluxoDaGaleria } from "@/lib/laboratorio/api";

const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8").replace(/\r\n/g, "\n");

beforeAll(() => {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => {};
  if (!(Element.prototype as any).hasPointerCapture) (Element.prototype as any).hasPointerCapture = () => false;
});

const canvas = (n: number) => ({
  nos: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, tipo: i === 0 ? "contexto" : "copy", x: i * 320, y: 0, dados: {} })),
  ligacoes: Array.from({ length: Math.max(0, n - 1) }, (_, i) => ({ id: `l${i}`, de: `n${i}`, para: `n${i + 1}` })),
  viewport: { x: 0, y: 0, zoom: 1 },
});

const TEMPLATES = [
  { id: "t-funil", nome: "Funil de vendas completo", descricao: "Pesquisa, oferta e funil", icone: "filter", oficial: true, categoria: "Vendas", canvas: canvas(3) },
  { id: "t-carrossel", nome: "Carrossel", descricao: "Lâminas em ordem", icone: "layers", oficial: true, categoria: "Conteúdo", canvas: canvas(2) },
  { id: "t-logo", nome: "Logo", descricao: "Variações de logo", icone: "pen-tool", oficial: true, canvas: canvas(2) },
  { id: "t-meu", nome: "Meu fluxo de Reels", descricao: "Pessoal", icone: "workflow", oficial: false, canvas: canvas(1) },
];

const PROJETOS = [
  { id: "p1", nome: "Café especial", client_id: null, status: "ativo", versao: 1, nos: 7, updated_at: "2026-10-19T10:00:00Z" },
  { id: "p2", nome: "Funil outubro", client_id: null, status: "ativo", versao: 1, nos: 4, updated_at: "2026-10-18T10:00:00Z" },
];

type Creditos = { saldo_usd: number; ativa: boolean; pode_carregar: boolean; movimentos?: unknown[]; gasto_mes_usd?: number; por_projeto?: unknown[] };

function funcao(o: { templates?: unknown[]; creditos?: Creditos; trocas?: Record<string, (c: any) => unknown> } = {}) {
  m.chamar.mockImplementation(async (f: string, corpo: any) => {
    if (f !== "laboratorio") return {};
    if (o.trocas && o.trocas[corpo.acao]) return o.trocas[corpo.acao](corpo);
    switch (corpo.acao) {
      case "projetos_listar":
        return { projetos: PROJETOS };
      case "templates_listar":
        return { templates: o.templates ?? TEMPLATES };
      case "creditos":
        return { disponivel: true, movimentos: [], gasto_mes_usd: 0, por_projeto: [], ...(o.creditos ?? { saldo_usd: 0, ativa: false, pode_carregar: true }) };
      default:
        return {};
    }
  });
}

const chamadas = (acao: string) => m.chamar.mock.calls.filter((c) => c[0] === "laboratorio" && c[1].acao === acao).map((c) => c[1]);

function montarPagina(inicio = "/laboratorio") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[inicio]}>
        <Routes>
          <Route path="/laboratorio" element={<Laboratorio />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function achar(seletor: string): Promise<HTMLElement> {
  let el: HTMLElement | null = null;
  await waitFor(() => {
    el = document.querySelector(seletor) as HTMLElement | null;
    expect(el).not.toBeNull();
  });
  return el!;
}

beforeEach(() => {
  m.chamar.mockReset();
});

describe("Início: Fluxos e Recentes lado a lado", () => {
  it("no desktop, fluxos à esquerda (2/3) e recentes numa coluna à direita; no celular empilha", async () => {
    funcao();
    montarPagina();
    const grade = await achar("[data-inicio-lado-a-lado]");
    // Uma coluna até 1024 px; de 1024 para cima, 3 colunas (fluxos ocupa 2).
    expect(grade.className).toContain("grid");
    expect(grade.className).toContain("lg:grid-cols-3");
    expect(grade.className).not.toMatch(/(^|\s)grid-cols-[23]/);
    const fluxos = grade.querySelector("[data-coluna-fluxos]") as HTMLElement;
    const recentes = grade.querySelector("[data-coluna-recentes]") as HTMLElement;
    expect(fluxos.className).toContain("lg:col-span-2");
    expect(fluxos.nextElementSibling).toBe(recentes);
    // Recentes em lista compacta, na mesma coluna.
    await waitFor(() => expect(recentes.querySelectorAll("[data-recente]").length).toBe(2));
    expect(recentes.textContent).toContain("Café especial");
    expect(recentes.textContent).toContain("7 nós");
    // Abrir um recente leva ao canvas.
    fireEvent.click(within(recentes).getByTitle("Abrir Café especial no canvas"));
    await waitFor(() => expect(document.querySelector("[data-aba-inicio]")).toBeNull());
  });
});

describe("Galeria de fluxos", () => {
  it("agrupa pela categoria e cai em Outros sem ela; busca sem acento; Seus fluxos à parte", async () => {
    funcao();
    montarPagina();
    const galeria = await achar("[data-galeria-de-fluxos]");
    await waitFor(() => expect(galeria.querySelectorAll("[data-template]").length).toBe(3));
    const chips = Array.prototype.map.call(galeria.querySelectorAll("[data-chip-categoria]"), (e: Element) => e.getAttribute("data-chip-categoria"));
    expect(chips).toEqual(["todos", "Vendas", "Conteúdo", "Outros", "pessoais"]);
    // O logo sem categoria está em Outros.
    expect(galeria.querySelector('[data-template="t-logo"]')!.getAttribute("data-categoria")).toBe("Outros");

    // Cartão: miniatura com um bloco por nó, nome, descrição, número de nós e "Usar fluxo".
    const funil = galeria.querySelector('[data-template="t-funil"]') as HTMLElement;
    expect(funil.querySelectorAll("[data-miniatura-do-fluxo] rect").length).toBe(3);
    expect(funil.querySelectorAll("[data-miniatura-do-fluxo] path").length).toBe(2);
    expect(funil.textContent).toContain("Funil de vendas completo");
    expect(funil.textContent).toContain("Pesquisa, oferta e funil");
    expect(funil.textContent).toContain("3 nós");
    expect(within(funil).getByRole("button", { name: "Usar fluxo" })).toBeTruthy();

    fireEvent.click(galeria.querySelector('[data-chip-categoria="Vendas"]')!);
    await waitFor(() => expect(Array.prototype.map.call(galeria.querySelectorAll("[data-template]"), (e: Element) => e.getAttribute("data-template"))).toEqual(["t-funil"]));
    expect(galeria.querySelector('[data-chip-categoria="Vendas"]')!.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(galeria.querySelector('[data-chip-categoria="todos"]')!);
    fireEvent.change(within(galeria).getByLabelText("Buscar fluxo"), { target: { value: "LAMINAS" } });
    await waitFor(() => expect(Array.prototype.map.call(galeria.querySelectorAll("[data-template]"), (e: Element) => e.getAttribute("data-template"))).toEqual(["t-carrossel"]));
    fireEvent.change(within(galeria).getByLabelText("Buscar fluxo"), { target: { value: "" } });

    fireEvent.click(galeria.querySelector('[data-chip-categoria="pessoais"]')!);
    await waitFor(() => expect(Array.prototype.map.call(galeria.querySelectorAll("[data-template]"), (e: Element) => e.getAttribute("data-template"))).toEqual(["t-meu"]));
    expect(galeria.textContent).toContain("1 nó");
  });

  it("Usar fluxo cria o projeto pelo template e abre o canvas", async () => {
    funcao({ trocas: { template_usar: () => ({ projeto: { id: "novo", nome: "Carrossel", canvas: canvas(2), versao: 1, status: "ativo" } }) } });
    montarPagina();
    const galeria = await achar("[data-galeria-de-fluxos]");
    await waitFor(() => expect(galeria.querySelector('[data-usar-fluxo="t-carrossel"]')).not.toBeNull());
    fireEvent.click(galeria.querySelector('[data-usar-fluxo="t-carrossel"]')!);
    await waitFor(() => expect(chamadas("template_usar")[0]).toMatchObject({ template_id: "t-carrossel" }));
  });

  it("sem nenhuma categoria (os templates de hoje): só Todos e Seus fluxos", async () => {
    funcao({ templates: TEMPLATES.map((t) => ({ ...t, categoria: undefined })) });
    montarPagina();
    const galeria = await achar("[data-galeria-de-fluxos]");
    await waitFor(() => expect(galeria.querySelectorAll("[data-template]").length).toBe(3));
    const chips = Array.prototype.map.call(galeria.querySelectorAll("[data-chip-categoria]"), (e: Element) => e.getAttribute("data-chip-categoria"));
    expect(chips).toEqual(["todos", "pessoais"]);
  });

  it("regras puras: ordem das categorias (Outros por último), filtro e busca", () => {
    const f = (id: string, categoria: string, oficial = true, nome = id): FluxoDaGaleria => ({ id, nome, descricao: "", icone: "", oficial, categoria, canvas: { nos: [], ligacoes: [], viewport: { x: 0, y: 0, zoom: 1 } } as any });
    const lista = [f("a", "Outros"), f("b", "Vídeo"), f("c", "Marca"), f("d", "Vídeo"), f("e", "Outros", false, "Lançamento")];
    expect(categoriasDos(lista)).toEqual(["Vídeo", "Marca", "Outros"]);
    expect(filtrarFluxos(lista, { categoria: "Vídeo" }, "").map((x) => x.id)).toEqual(["b", "d"]);
    expect(filtrarFluxos(lista, "todos", "").map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
    expect(filtrarFluxos(lista, "pessoais", "").map((x) => x.id)).toEqual(["e"]);
    // Com busca, Todos procura também nos pessoais.
    expect(filtrarFluxos(lista, "todos", "lancamento").map((x) => x.id)).toEqual(["e"]);
    expect(semAcento("Lançamento Ágil")).toBe("lancamento agil");
  });
});

describe("Créditos do Laboratório", () => {
  it("chip no cabeçalho com o saldo; a janela mostra saldo, gasto e extrato; admin carrega", async () => {
    funcao({
      creditos: {
        saldo_usd: 12.5,
        ativa: true,
        pode_carregar: true,
        gasto_mes_usd: 3.2,
        movimentos: [
          { id: "m1", tipo: "carga", valor_usd: 20, saldo_depois: 20, projeto_id: null, projeto_nome: null, nota: "Pix", criado_em: "2026-10-20T10:00:00Z" },
          { id: "m2", tipo: "uso", valor_usd: 7.5, saldo_depois: 12.5, projeto_id: "p1", projeto_nome: "Café especial", nota: "Rodar tudo (3 nós)", criado_em: "2026-10-20T11:00:00Z" },
        ],
        por_projeto: [{ projeto_id: "p1", projeto_nome: "Café especial", gasto_usd: 3.2 }],
      },
      trocas: { creditos_carregar: (c) => ({ saldo_usd: 12.5 + Number(c.valor_usd), ativa: true }) },
    });
    montarPagina();
    const chip = await achar("[data-chip-de-creditos]");
    await waitFor(() => expect(chip.textContent).toContain("12,50"));
    expect(chip.getAttribute("aria-label")).toContain("Créditos do Laboratório");
    fireEvent.click(chip);
    const janela = await screen.findByRole("dialog", { name: /Créditos do Laboratório/ });
    await waitFor(() => expect(within(janela).getByText("Saldo")).toBeTruthy());
    expect(janela.querySelectorAll("[data-movimento]").length).toBe(2);
    expect(janela.textContent).toContain("Café especial");
    expect(janela.textContent).toContain("Gasto por projeto");

    const valor = janela.querySelector("[data-valor-da-carga]") as HTMLInputElement;
    fireEvent.change(valor, { target: { value: "50" } });
    fireEvent.change(within(janela).getByLabelText("Nota da carga"), { target: { value: "Pix de outubro" } });
    fireEvent.click(janela.querySelector("[data-confirmar-carga]")!);
    await waitFor(() => expect(chamadas("creditos_carregar")[0]).toMatchObject({ valor_usd: 50, nota: "Pix de outubro" }));
  });

  it("quem não é admin vê o saldo mas não carrega", async () => {
    funcao({ creditos: { saldo_usd: 5, ativa: true, pode_carregar: false } });
    montarPagina();
    fireEvent.click(await achar("[data-chip-de-creditos]"));
    const janela = await screen.findByRole("dialog", { name: /Créditos do Laboratório/ });
    await waitFor(() => expect(janela.textContent).toContain("Só o admin carrega créditos."));
    expect(janela.querySelector("[data-carregar-creditos]")).toBeNull();
    expect(janela.querySelector("[data-valor-da-carga]")).toBeNull();
  });

  function montarCusto(creditos: Creditos, total: number) {
    funcao({ creditos });
    const onConfirmar = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <JanelaDeCusto aberta titulo="Rodar tudo" linhas={[{ id: "n1", nome: "Copy", custo_usd: total }]} total={total} rodando={false} onConfirmar={onConfirmar} onFechar={() => undefined} />
      </QueryClientProvider>,
    );
    return { onConfirmar };
  }

  it("janela de custo com saldo suficiente: mostra o saldo depois e roda", async () => {
    const { onConfirmar } = montarCusto({ saldo_usd: 5, ativa: true, pode_carregar: true }, 0.4);
    const linha = await achar("[data-saldo-depois]");
    expect(linha.textContent).toContain("Saldo depois US$ 4,60");
    expect(document.querySelector("[data-sem-credito]")).toBeNull();
    fireEvent.click(document.querySelector("[data-confirmar-custo]")!);
    expect(onConfirmar).toHaveBeenCalled();
  });

  it("janela de custo sem saldo: avisa o que falta e troca o Rodar por Carregar créditos", async () => {
    const { onConfirmar } = montarCusto({ saldo_usd: 0.1, ativa: true, pode_carregar: true }, 0.4);
    const aviso = await achar("[data-sem-credito]");
    expect(aviso.textContent).toContain("Falta US$ 0,30");
    expect(document.querySelector("[data-confirmar-custo]")).toBeNull();
    const carregar = document.querySelector("[data-carregar-creditos-do-custo]") as HTMLButtonElement;
    expect(carregar.disabled).toBe(false);
    fireEvent.click(carregar);
    await screen.findByRole("dialog", { name: /Créditos do Laboratório/ });
    expect(onConfirmar).not.toHaveBeenCalled();
  });

  it("janela de custo com o limite desligado (o começo): não mostra saldo e roda como antes", async () => {
    montarCusto({ saldo_usd: 0, ativa: false, pode_carregar: true }, 0.4);
    await waitFor(() => expect(chamadas("creditos").length).toBeGreaterThan(0));
    expect(document.querySelector("[data-saldo-depois]")).toBeNull();
    expect(document.querySelector("[data-confirmar-custo]")).not.toBeNull();
  });

  it("402 sem_credito vira saldo e custo; saldo depois só com o limite ligado", () => {
    const e = new ErroDaMesa("sem_credito", "Sem crédito no Laboratório: o saldo é US$ 0.10 e isto custa US$ 0.40. Carregue créditos para rodar.", { saldo_usd: 0.1, custo_usd: 0.4 });
    expect(semCredito(e)).toEqual({ saldo_usd: 0.1, custo_usd: 0.4 });
    expect(semCredito(new ErroDaMesa("confirmacao_necessaria", "x"))).toBeNull();
    expect(saldoDepoisDoCusto({ disponivel: true, ativa: true, saldo_usd: 1 }, 0.25)).toEqual({ depois: 0.75, falta: 0 });
    expect(saldoDepoisDoCusto({ disponivel: true, ativa: false, saldo_usd: 0 }, 0.25)).toBeNull();
    expect(saldoDepoisDoCusto({ disponivel: false, ativa: true, saldo_usd: 0 }, 0.25)).toBeNull();
  });

  it("contrato: ações na função, migration com RLS de equipe, RPCs só pelo serviço e com trava de linha", () => {
    const acoes = ler("supabase/functions/laboratorio/acoes.ts");
    for (const a of ["creditos:", "creditos_carregar:", "creditos_limite:"]) expect(acoes).toContain(a);
    const sql = ler("supabase/migrations/20261020050000_laboratorio_creditos.sql");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.lab_carteira");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.lab_creditos_movimentos");
    expect(sql).toContain("tipo IN ('carga', 'uso', 'estorno', 'ajuste')");
    expect(sql).toContain("ativa boolean NOT NULL DEFAULT false");
    expect(sql).toContain("COALESCE(public.is_staff((select auth.uid())), false)");
    for (const rpc of ["lab_creditos_carregar", "lab_creditos_reservar", "lab_creditos_estornar"]) {
      expect(sql).toContain(`CREATE OR REPLACE FUNCTION public.${rpc}(`);
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${rpc}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`));
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${rpc}\\([^)]*\\) TO service_role;`));
    }
    expect(sql.split("SET search_path = ''").length - 1).toBe(4);
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("'sem_credito'");
    expect(ler("supabase/migration-manifest.sha256")).toContain("supabase/migrations/20261020050000_laboratorio_creditos.sql");
  });
});
