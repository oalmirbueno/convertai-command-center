import { createElement as h } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import { projetoDosTakes, type ProjetoDeEdicao } from "../../supabase/functions/_shared/projeto-de-edicao";

/**
 * 02/10, dono: "coloque filtros de pesquisa", "Skills mais claro e fácil, abre
 * um pop-up gigante", "melhore a tela cheia". A tela do editor monta de
 * verdade (Player trocado por uma caixa), com a Mídia vinda do banco falso.
 */

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const VERSAO = "22222222-2222-4222-8222-222222222222";
const mock = vi.hoisted(() => ({ invoke: vi.fn(), arquivos: [] as Record<string, unknown>[] }));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range", "update", "insert"]) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve({ data: null, error: null });
    b.single = () => Promise.resolve({ data: null, error: null });
    b.then = (ok: any, falha: any) => Promise.resolve({ data: tabela === "video_arquivos" ? mock.arquivos : [], error: null }).then(ok, falha);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      from: (t: string) => consulta(t),
      storage: {
        from: () => ({
          list: vi.fn().mockResolvedValue({ data: [], error: null }),
          createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://x.supabase.co/v.mp4" }, error: null }),
          createSignedUrls: (caminhos: string[]) => Promise.resolve({ data: caminhos.map((p) => ({ path: p, signedUrl: `https://x.supabase.co/${p}`, error: null })), error: null }),
        }),
      },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));
vi.mock("@remotion/player", () => ({ Player: (p: any) => h("div", { "data-player-falso": "", "data-controles": p.controls ? "sim" : "nao" }) }));

import EditorDeVideo from "@/components/mesa-edicao/editor/EditorDeVideo";
import { definirTelaCheia } from "@/components/mesa/TelaCheiaDaMesa";
import { limparFiltro } from "@/components/mesa-edicao/editor/buscaDoEditor";
import { aplicarOperacoes } from "@/lib/editor/operacoes";

const valor = (): MesaValor =>
  ({ clientId: CLIENTE, clientName: "Café", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 10, catalogo: [], catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn() }) as unknown as MesaValor;

const take = (id: string, nome: string, duracao_s: number, tipo = "bruto") => ({ id, nome, tipo, storage_bucket: "mesa", storage_path: `${CLIENTE}/video/${tipo}/${id}.mov`, cena_ref: null, melhor: true, duracao_s, largura: 1080, altura: 1920 });

function projeto(): ProjetoDeEdicao {
  const p = projetoDosTakes({ titulo: "Reel", fps: 25, takes: [take("a1", "take-t01.mov", 6), take("a2", "take-t02.mov", 5), take("a3", "take-t03.mov", 4)] });
  const t = p.trilhas[0];
  // O t02 de novo no fim: o take repetido.
  return aplicarOperacoes(p, [{ op: "inserir", trilha: t.id, clipe: { fonte: t.clipes[1].fonte, inicio_s: 15, entrada_s: 0, saida_s: 5 } }]);
}

function montar(p = projeto()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(TooltipProvider, null, h(MesaProvider, { valor: valor(), children: h(EditorDeVideo, { versaoId: VERSAO, projetoInicial: p, revisao: 1 }) })))));
}

beforeEach(() => {
  vi.clearAllMocks();
  limparFiltro(CLIENTE);
  act(() => definirTelaCheia(false));
  mock.invoke.mockImplementation((_f: string, { body }: any) => Promise.resolve({ data: body.acao === "projeto_salvar" ? { versao: { projeto: { revisao: body.revisao_lida + 1 } } } : {}, error: null }));
  mock.arquivos = [
    { id: "a1", client_id: CLIENTE, nome: "take-t01.mov", storage_path: `${CLIENTE}/video/bruto/a1.mov`, tipo: "bruto", duracao_s: 6, estado: "ativo" },
    { id: "g1", client_id: CLIENTE, nome: "praia gerada.mp4", storage_path: `${CLIENTE}/video/gerado/g1.mp4`, tipo: "gerado", duracao_s: 5, estado: "ativo" },
    { id: "m1", client_id: CLIENTE, nome: "trilha.mp3", storage_path: `${CLIENTE}/audio/m1.mp3`, tipo: "audio", duracao_s: 62, estado: "ativo" },
  ];
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  (window as any).IntersectionObserver = class {
    observe() {}
    disconnect() {}
  };
  (globalThis as any).CSS = { supports: () => true };
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

describe("Skills: lista clara, Aplicar e a proposta logo embaixo (sem cartão gigante)", () => {
  it("agrupa pelo objetivo, busca pelo nome, Aplicar mostra o que muda, Confirmar faz e o Desfazer volta", async () => {
    montar();
    fireEvent.click(screen.getByRole("tab", { name: "Skills" }));
    expect(document.querySelector('[data-grupo-de-skills="Cortar e limpar"]')).toBeTruthy();
    expect(document.querySelector('[data-grupo-de-skills="Imagem e ritmo"]')).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar skill" }), { target: { value: "repetidos" } });
    expect(document.querySelectorAll("[data-skill]")).toHaveLength(1);
    const linha = document.querySelector('[data-skill="remover_duplicados"]') as HTMLElement;
    expect(linha.textContent).toContain("Tira o mesmo take que aparece duas vezes");
    expect(document.querySelector('[data-apelido="c4"]')).toBeTruthy();
    fireEvent.click(within(linha).getByRole("button", { name: "Aplicar" }));
    const proposta = linha.querySelector('[data-proposta-da-skill="aberta"]') as HTMLElement;
    expect(proposta.textContent).toMatch(/1 mudança/);
    expect(proposta.textContent).toMatch(/4 para 3 clipes/);
    // A lista fica recolhida até pedir.
    expect(proposta.querySelector("ol")).toBeNull();
    fireEvent.click(within(proposta).getByRole("button", { name: /Ver a lista/ }));
    expect(proposta.querySelector("ol")!.textContent).toContain("Tirar c4");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    fireEvent.click(within(proposta).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(document.querySelector('[data-apelido="c4"]')).toBeNull());
    fireEvent.click(within(linha).getByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(document.querySelector('[data-apelido="c4"]')).toBeTruthy());
    expect(linha.querySelector('[data-proposta-da-skill="desfeita"]')).toBeTruthy();
  });
});

describe("busca com filtros", () => {
  it("linha do tempo: o texto apaga o que não bate, 'Só repetidos' acha o take repetido e Escolher seleciona", async () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Buscar na linha do tempo" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar na linha do tempo" }), { target: { value: "t02" } });
    await waitFor(() => expect(document.querySelectorAll("[data-achado]")).toHaveLength(2));
    expect(Array.from(document.querySelectorAll("[data-achado]")).map((x) => x.getAttribute("data-apelido"))).toEqual(["c2", "c4"]);
    expect(document.querySelector('[data-apelido="c1"]')!.className).toContain("opacity-25");
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar na linha do tempo" }), { target: { value: "" } });
    fireEvent.click(within(document.querySelector("[data-busca-da-linha]") as HTMLElement).getByRole("button", { name: /^Filtros/ }));
    fireEvent.click(screen.getByRole("button", { name: "Só repetidos" }));
    await waitFor(() => expect(Array.from(document.querySelectorAll("[data-achado]")).map((x) => x.getAttribute("data-apelido"))).toEqual(["c4"]));
    fireEvent.click(screen.getByRole("button", { name: "Escolher" }));
    await waitFor(() => expect(document.querySelector('[data-apelido="c4"]')!.className).toContain("ring-primary"));
    // Delete tira o escolhido: o repetido sai.
    fireEvent.keyDown(window, { key: "Delete" });
    await waitFor(() => expect(document.querySelector('[data-apelido="c4"]')).toBeNull());
  });

  it("Mídia: filtros de origem, tipo e uso, com a contagem; a mesma busca vale na linha do tempo", async () => {
    montar();
    fireEvent.click(screen.getByRole("tab", { name: "Mídia" }));
    await waitFor(() => expect(document.querySelectorAll("[data-item-da-biblioteca]")).toHaveLength(3));
    expect(document.querySelector('[data-item-da-biblioteca="a1"]')!.textContent).toContain("na linha");
    const busca = document.querySelector("[data-biblioteca-do-editor] [data-busca-com-filtros]") as HTMLElement;
    fireEvent.click(within(busca).getByRole("button", { name: /^Filtros/ }));
    fireEvent.change(within(busca).getByRole("combobox", { name: "Origem" }), { target: { value: "gerado" } });
    await waitFor(() => expect(document.querySelectorAll("[data-item-da-biblioteca]")).toHaveLength(1));
    expect(document.querySelector('[data-item-da-biblioteca="g1"]')).toBeTruthy();
    expect(busca.textContent).toContain("1 de 3");
    fireEvent.change(within(busca).getByRole("combobox", { name: "Origem" }), { target: { value: "todas" } });
    fireEvent.change(within(busca).getByRole("combobox", { name: "Uso" }), { target: { value: "sem_uso" } });
    fireEvent.change(within(busca).getByRole("combobox", { name: "Tipo" }), { target: { value: "audio" } });
    await waitFor(() => expect(Array.from(document.querySelectorAll("[data-item-da-biblioteca]")).map((x) => x.getAttribute("data-item-da-biblioteca"))).toEqual(["m1"]));
    fireEvent.click(within(busca).getByRole("button", { name: "Limpar a busca" }));
    await waitFor(() => expect(document.querySelectorAll("[data-item-da-biblioteca]")).toHaveLength(3));
  });
});

describe("tela cheia do editor", () => {
  it("Tela cheia leva o editor (com a linha do tempo) para a tela inteira; Só o vídeo é o player com controles", async () => {
    montar();
    expect(document.querySelector("[data-tela-cheia-do-editor]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tela cheia" }));
    await waitFor(() => expect(document.querySelector("[data-tela-cheia-do-editor]")).toBeTruthy());
    expect(document.body.hasAttribute("data-tela-cheia-da-mesa")).toBe(true);
    expect(document.querySelector("[data-linha-do-tempo]")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sair da tela cheia (Esc)" }));
    await waitFor(() => expect(document.querySelector("[data-tela-cheia-do-editor]")).toBeNull());
    expect(screen.getByRole("button", { name: "Só o vídeo" })).toBeTruthy();
    expect(document.querySelector("[data-player-falso]")!.getAttribute("data-controles")).toBe("nao");
  });
});

describe("leve: linha do tempo longa", () => {
  it("com mais de 100 clipes, só desenha a parte visível (e o escolhido); com poucos, desenha todos", async () => {
    const { default: LinhaDoTempo } = await import("@/components/mesa-edicao/editor/LinhaDoTempo");
    const { criarRelogio } = await import("@/components/mesa-edicao/editor/apoio");
    const { clipeNovo } = await import("../../supabase/functions/_shared/projeto-de-edicao");
    const base = projeto();
    const fonte = base.trilhas[0].clipes[0].fonte as string;
    const longo = { ...base, duracao_s: 300, trilhas: [{ ...base.trilhas[0], clipes: Array.from({ length: 150 }).map((_, k) => clipeNovo({ id: `v${k + 1}`, fonte, inicio_s: k * 2, entrada_s: 0, saida_s: 2 })) }] } as ProjetoDeEdicao;
    const props = { relogio: criarRelogio(0), px: 40, setPx: vi.fn(), onSelecionar: vi.fn(), onOps: vi.fn(), urls: {} };
    const { container, rerender } = render(h(LinhaDoTempo, { ...props, projeto: longo, selecao: ["v150"] }));
    await waitFor(() => expect(container.querySelectorAll("[data-clipe]").length).toBeLessThan(150));
    expect(container.querySelectorAll("[data-clipe]").length).toBeGreaterThan(20);
    expect(container.querySelector('[data-clipe="v150"]')).toBeTruthy(); // o escolhido sempre aparece
    rerender(h(LinhaDoTempo, { ...props, projeto: base, selecao: [] }));
    await waitFor(() => expect(container.querySelectorAll("[data-clipe]")).toHaveLength(4));
  });
});

describe("o que parecia falso foi ligado ou corrigido (auditoria 02/10)", () => {
  const ler = (p: string) => require("node:fs").readFileSync(require("node:path").resolve(process.cwd(), p), "utf8") as string;
  it("polaroide leva a foto escolhida; Parar só aparece onde para; Lado a lado diz que é o bruto", () => {
    const motion = ler("src/components/mesa-edicao/editor/PaineisDeTextoESom.tsx");
    expect(motion).toContain('fonte: d.id === "polaroide" ? fotoEscolhida : undefined');
    expect(motion).toContain('aria-label="Foto da polaroide"');
    const refs = ler("src/components/mesa-edicao/editor/PainelDeReferencias.tsx");
    expect(refs).toContain("{podeParar && (");
    expect(refs).toContain('rotulo: "Clipe do cliente (bruto)"');
  });
});
