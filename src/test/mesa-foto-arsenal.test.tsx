import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Item 9 da Mesa Foto (02/10, "Arsenal de prompts"): áreas da foto, molde
 * preenchido com o produto do cliente, referência de outro segmento
 * escondida (frasco de vidro para uma ótica), listas com rolagem própria e o
 * painel para montar ao lado da geração. Banco e função simulados.
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
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
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: vi.fn(),
      from: (tabela: string) => consulta(tabela),
      storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://x.test/a.png" }, error: null }) }) },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import EtapaBiblioteca from "@/components/mesa-foto/EtapaBiblioteca";
import PainelDoArsenal from "@/components/mesa-foto/PainelDoArsenal";
import {
  AREAS_DO_ARSENAL,
  areaDoItem,
  buscasLivresDaArea,
  itensSemImagem,
  preencherPrompt,
  produtosDosKits,
  promptsDoCliente,
  relevante,
} from "@/components/mesa-foto/arsenalDaBiblioteca";
import { CATEGORIAS_DA_BIBLIOTECA, normalizarItemDaBiblioteca, type ItemDaBiblioteca } from "@/components/mesa-foto/fotoApi";

const CLIENTE = "11111111-1111-1111-1111-111111111111";

const item = (v: Record<string, unknown>): ItemDaBiblioteca => normalizarItemDaBiblioteca({ id: "x", ...v })!;

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Ótica Sintética",
  userId: "u-1",
  isAdmin: false,
  podeRecarregar: true,
  saldoUsd: 50,
  catalogo: [],
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
});

function montar(filho: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(QueryClientProvider, { client: qc }, h(MemoryRouter, { initialEntries: [`/mesa-foto?client=${CLIENTE}`] }, h(TooltipProvider, null, h(MesaProvider, { valor: valorDaMesa(), children: filho })))),
  );
}

const KIT_OCULOS = { id: "k1", client_id: CLIENTE, tipo: "moda", nome: "Óculos Aviador Clássico", variante: "dourado", atributos: { observado: [], informado: ["Marca: Visão Pura"], inferido: [] } };

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
  mock.invoke.mockReset();
  mock.invoke.mockResolvedValue({ data: {}, error: null });
  window.localStorage.clear();
  window.sessionStorage.clear();
  mock.tabelas = {
    foto_kits: [KIT_OCULOS],
    foto_kit_refs: [],
    foto_biblioteca: [
      { id: "p-luz", client_id: null, tipo: "prompt", categoria: "luz", titulo: "Janela lateral com rebatedor", prompt_pt: "Foto de [assunto] com luz de janela lateral e rebatedor branco." },
      { id: "p-pack", client_id: null, tipo: "prompt", categoria: "produto", titulo: "Packshot em fundo branco", prompt_pt: "Foto profissional de [produto] em fundo branco puro.", prompt_en: "Professional photo of [product] on pure white." },
      { id: "p-cosm", client_id: null, tipo: "prompt", categoria: "cosmetico", titulo: "Frasco em gradiente pastel", prompt_pt: "[Frasco de cosmético] em gradiente pastel." },
      { id: "r-frasco", client_id: null, tipo: "referencia", categoria: "produto", titulo: "frasco de vidro sobre superfície clara", imagem_url: "https://img.test/frasco.jpg", licenca: "CC0", autor: "Ana" },
      { id: "r-retrato", client_id: CLIENTE, tipo: "referencia", categoria: "pessoa", titulo: "Retrato com óculos na rua", imagem_url: "https://img.test/retrato.jpg", licenca: "CC BY 4.0", autor: "Bia" },
      { id: "r-vazia", client_id: null, tipo: "referencia", categoria: "cenario", titulo: "Bancada sem foto" },
    ],
  };
});

// ------------------------------------------------------------------ lógica pura

describe("áreas do arsenal", () => {
  it("toda categoria da biblioteca cai numa das 7 áreas; título de macro e de ângulo refina", () => {
    expect(AREAS_DO_ARSENAL.map((a) => a.rotulo)).toEqual(["Produto", "Modelo", "Cenário", "Luz", "Ângulo", "Detalhe", "Composição"]);
    const areas = AREAS_DO_ARSENAL.map((a) => a.valor);
    for (const c of CATEGORIAS_DA_BIBLIOTECA) expect(areas).toContain(areaDoItem({ categoria: c.valor, titulo: "Qualquer", tags: [] }));
    expect(areaDoItem({ categoria: "pessoa", titulo: "Retrato corporativo", tags: [] })).toBe("modelo");
    expect(areaDoItem({ categoria: "ambiente", titulo: "Fachada na hora azul", tags: [] })).toBe("cenario");
    expect(areaDoItem({ categoria: "estilo", titulo: "Minimalista claro", tags: [] })).toBe("cenario");
    expect(areaDoItem({ categoria: "luz", titulo: "Softbox superior para vista de cima", tags: [] })).toBe("luz");
    expect(areaDoItem({ categoria: "produto", titulo: "Macro de acabamento e material", tags: [] })).toBe("detalhe");
    expect(areaDoItem({ categoria: "produto", titulo: "Três quartos em fundo infinito", tags: [] })).toBe("angulo");
    expect(areaDoItem({ categoria: "composicao", titulo: "Câmera baixa para imponência", tags: [] })).toBe("angulo");
    expect(areaDoItem({ categoria: "composicao", titulo: "Regra dos terços", tags: [] })).toBe("composicao");
    expect(areaDoItem({ categoria: "bebida", titulo: "Garrafa em contraluz", tags: [] })).toBe("produto");
    expect(areaDoItem({ categoria: "produto", titulo: "Qualquer", tags: ["area:luz"] })).toBe("luz");
  });
});

describe("preencherPrompt", () => {
  it("preenche {produto}, {{produto}}, [produto] e [product]; marca e modelo nas lacunas deles", () => {
    expect(preencherPrompt("Foto de {produto} na mesa", { produto: "Óculos Aviador" })).toBe("Foto de Óculos Aviador na mesa");
    expect(preencherPrompt("Foto de {{ produto }} e {{marca}}", { produto: "Óculos Aviador", marca: "Visão Pura" })).toBe("Foto de Óculos Aviador e Visão Pura");
    expect(preencherPrompt("Packshot de [produto] em fundo [cor]", { produto: "Óculos Aviador" })).toBe("Packshot de Óculos Aviador em fundo [cor]");
    expect(preencherPrompt("Photo of [product], 1:1", { produto: "Óculos Aviador" })).toBe("Photo of Óculos Aviador, 1:1");
    expect(preencherPrompt("Retrato de {modelo} usando {produto}", { produto: "Óculos", modelo: "uma mulher de 30 anos" })).toBe("Retrato de uma mulher de 30 anos usando Óculos");
    // A primeira lacuna no começo é o assunto; cor e exemplo não.
    expect(preencherPrompt("[Frasco de cosmético] em gradiente [cor 1]", { produto: "Óculos Aviador" })).toBe("Óculos Aviador em gradiente [cor 1]");
    expect(preencherPrompt("Retrato em [cor escura suave]", { produto: "Óculos Aviador" })).toBe("Retrato em [cor escura suave]");
    // Tipo escrito entra entre parênteses; código de kit não.
    expect(preencherPrompt("Foto de [produto]", { produto: "Aviador", tipo: "Óculos de sol" })).toBe("Foto de Aviador (óculos de sol)");
    expect(preencherPrompt("Foto de [produto]", { produto: "Aviador", tipo: "moda" })).toBe("Foto de Aviador");
    // Sem produto, o molde fica como veio.
    expect(preencherPrompt("Foto de [produto]", {})).toBe("Foto de [produto]");
  });

  it("sem lacuna, troca o assunto genérico pelo produto", () => {
    expect(preencherPrompt("Um frasco de vidro sobre superfície clara, luz suave", { produto: "Óculos Aviador" })).toBe("Óculos Aviador sobre superfície clara, luz suave");
    expect(preencherPrompt("Foto do produto em fundo branco", { produto: "Óculos Aviador" })).toBe("Foto do Óculos Aviador em fundo branco");
    expect(preencherPrompt("Close of the product, product photography style", { produto: "Óculos Aviador" })).toBe("Close of Óculos Aviador, product photography style");
    expect(preencherPrompt("luz natural lateral suave", { produto: "Óculos Aviador" })).toBe("luz natural lateral suave");
  });
});

describe("relevância e prompts do cliente", () => {
  const oculos = produtosDosKits([KIT_OCULOS as any]);

  it("o produto do kit traz nome, variante e marca", () => {
    expect(oculos).toEqual([{ nome: "Óculos Aviador Clássico dourado", tipo: "moda", marca: "Visão Pura" }]);
  });

  it("referência 'frasco de vidro' some para a ótica; técnica e item genérico ficam", () => {
    const frasco = item({ tipo: "referencia", categoria: "produto", titulo: "frasco de vidro sobre superfície clara", imagem_url: "https://x" });
    expect(relevante(frasco, oculos)).toBe(false);
    expect(relevante(frasco, [{ nome: "Sérum facial", tipo: "cosmetico" }])).toBe(true);
    expect(relevante(frasco, [])).toBe(true);
    expect(relevante(item({ tipo: "prompt", categoria: "cosmetico", titulo: "Frasco em gradiente pastel" }), oculos)).toBe(false);
    expect(relevante(item({ tipo: "prompt", categoria: "moda", titulo: "Óculos com reflexo controlado" }), oculos)).toBe(true);
    expect(relevante(item({ tipo: "prompt", categoria: "moda", titulo: "Relógio com mostrador legível" }), oculos)).toBe(true);
    expect(relevante(item({ tipo: "prompt", categoria: "alimento", titulo: "Pizza vista de cima" }), oculos)).toBe(false);
    expect(relevante(item({ tipo: "prompt", categoria: "luz", titulo: "Contraluz para vidro e líquido" }), oculos)).toBe(true);
    expect(relevante(item({ tipo: "prompt", categoria: "produto", titulo: "Produto e embalagem lado a lado" }), oculos)).toBe(true);
    // "lente 100 mm" do prompt não faz um item de comida virar ótica.
    expect(relevante(item({ tipo: "prompt", categoria: "produto", titulo: "Frontal ortográfico com lente longa" }), [{ nome: "Pão de queijo", tipo: "alimento" }])).toBe(true);
  });

  it("biblioteca vazia ainda dá prompts de lógica por área, preenchidos com o produto", () => {
    const todos = promptsDoCliente([], oculos);
    const areas = Array.from(new Set(todos.map((p) => p.area)));
    expect(areas.sort()).toEqual(AREAS_DO_ARSENAL.map((a) => a.valor).sort());
    for (const p of todos) expect(p.texto).toContain("Óculos Aviador Clássico dourado");
    const luz = promptsDoCliente([], oculos, { area: "luz" });
    expect(luz.every((p) => p.area === "luz")).toBe(true);
    // O cuidado do segmento entra (reflexo nas lentes).
    expect(luz[0].texto).toMatch(/Lentes sem reflexo/);
    // Sem produto: a lacuna fica para completar.
    expect(promptsDoCliente([], [], { area: "produto" })[0].texto).toContain("[produto]");
  });

  it("prompts da biblioteca entram filtrados e preenchidos; o de outro segmento não", () => {
    const itens = [
      item({ id: "a", tipo: "prompt", categoria: "produto", titulo: "Packshot", prompt_pt: "Foto de [produto] em fundo branco." }),
      item({ id: "b", tipo: "prompt", categoria: "cosmetico", titulo: "Frasco em gradiente", prompt_pt: "[Frasco de cosmético] em gradiente." }),
    ];
    const lista = promptsDoCliente(itens, oculos, { area: "produto" });
    const daBiblioteca = lista.filter((p) => p.origem === "biblioteca");
    expect(daBiblioteca.map((p) => p.item_id)).toEqual(["a"]);
    expect(daBiblioteca[0].texto).toBe("Foto de Óculos Aviador Clássico dourado em fundo branco.");
  });

  it("itens sem imagem e buscas livres por área (Modelo busca pessoas)", () => {
    const lista = [item({ id: "a", imagem_url: "https://x" }), item({ id: "b" }), item({ id: "c", storage_path: "s.png" })];
    expect(itensSemImagem(lista).map((i) => i.id)).toEqual(["b"]);
    const modelo = buscasLivresDaArea("modelo", oculos);
    expect(modelo[0]).toMatch(/eyeglasses/);
    expect(modelo.some((q) => /portrait/.test(q))).toBe(true);
    expect(buscasLivresDaArea("luz", oculos).length).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------ telas

describe("EtapaBiblioteca como Arsenal de prompts", () => {
  it("listas com rolagem própria, referência sem imagem escondida, frasco de vidro fora e prompt preenchido", async () => {
    const tela = montar(h(EtapaBiblioteca));
    await screen.findByText("Packshot em fundo branco");
    // Toda lista longa rola por dentro, em qualquer largura.
    const rolagens = Array.from(tela.container.querySelectorAll("[data-rolagem-do-arsenal]")) as HTMLElement[];
    expect(rolagens.length).toBeGreaterThanOrEqual(2);
    for (const r of rolagens) {
      expect(r.className).toContain("overflow-y-auto");
      expect(r.className).toContain("max-h-[60vh]");
      expect(r.className).toContain("overscroll-contain");
      expect(r.className).not.toMatch(/(^|\s)lg:overflow-y-auto/);
    }
    // O prompt da biblioteca aparece com o produto do kit no lugar da lacuna.
    const pack = tela.container.querySelector('[data-prompt="p-pack"]') as HTMLElement;
    expect(within(pack).getByText("Foto profissional de Óculos Aviador Clássico dourado em fundo branco puro.")).toBeTruthy();
    // Outro segmento (cosmético, frasco de vidro) fica fora até pedir.
    expect(tela.container.querySelector('[data-prompt="p-cosm"]')).toBeNull();
    expect(tela.container.querySelector('[data-referencia="r-frasco"]')).toBeNull();
    expect(tela.container.querySelector('[data-referencia="r-retrato"]')).toBeTruthy();
    // Referência sem imagem só com "Sem imagem (1)".
    expect(tela.container.querySelector('[data-referencia="r-vazia"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Sem imagem \(1\)/ }));
    expect(tela.container.querySelector('[data-referencia="r-vazia"]')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Outros segmentos \(2\)/ }));
    expect(tela.container.querySelector('[data-referencia="r-frasco"]')).toBeTruthy();
    // Área Luz: só o que é de luz.
    const areas = screen.getByRole("radiogroup", { name: "Área da foto" });
    fireEvent.click(within(areas).getByRole("radio", { name: /Luz/ }));
    await waitFor(() => expect(tela.container.querySelector('[data-prompt="p-pack"]')).toBeNull());
    expect(tela.container.querySelector('[data-prompt="p-luz"]')).toBeTruthy();
    // Área Modelo: a busca livre sugere pessoas e retratos (sem buscar sozinha).
    fireEvent.click(within(areas).getByRole("radio", { name: /Modelo/ }));
    const sugestoes = Array.from(tela.container.querySelectorAll("[data-busca-sugerida]")).map((b) => b.getAttribute("data-busca-sugerida"));
    expect(sugestoes.some((s) => /portrait/.test(String(s)))).toBe(true);
    expect(mock.invoke.mock.calls.filter((c) => c[1] && c[1].body && c[1].body.acao === "referencias_buscar")).toHaveLength(0);
  });

  it("os resultados do Openverse rolam por dentro e importam na categoria da área", async () => {
    mock.invoke.mockImplementation((_f: string, { body }: any) => {
      if (body.acao === "referencias_buscar") {
        return Promise.resolve({ data: { resultados: [{ id: "ov1", titulo: "Woman wearing eyeglasses", imagem_url: "https://img.test/a.jpg", licenca: "cc0", licenca_rotulo: "CC0", autor: "Fulano" }] }, error: null });
      }
      if (body.acao === "referencia_importar") return Promise.resolve({ data: { item: { id: "novo", tipo: "referencia", titulo: "Woman wearing eyeglasses" } }, error: null });
      return Promise.resolve({ data: {}, error: null });
    });
    const tela = montar(h(EtapaBiblioteca));
    await screen.findByText("Packshot em fundo branco");
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Área da foto" })).getByRole("radio", { name: /Modelo/ }));
    const primeira = tela.container.querySelector("[data-busca-sugerida]") as HTMLElement;
    fireEvent.click(primeira);
    const lista = await waitFor(() => {
      const l = tela.container.querySelector("[data-resultados-livres]");
      if (!l) throw new Error("sem resultados");
      return l as HTMLElement;
    });
    expect(lista.getAttribute("data-rolagem-do-arsenal")).toBe("");
    expect(lista.className).toContain("overflow-y-auto");
    fireEvent.click(within(lista).getByRole("button", { name: /Importar/ }));
    await waitFor(() => expect(mock.invoke.mock.calls.filter((c) => c[1].body.acao === "referencia_importar")).toHaveLength(1));
    const corpo = mock.invoke.mock.calls.find((c) => c[1].body.acao === "referencia_importar")![1].body;
    expect(corpo).toMatchObject({ client_id: CLIENTE, categoria: "pessoa" });
  });
});

describe("PainelDoArsenal", () => {
  it("mostra os prompts preenchidos com o produto, rola por dentro, copia e usa", async () => {
    const escrever = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: escrever }, configurable: true });
    const usar = vi.fn();
    const tela = montar(h(PainelDoArsenal, { produtoNome: "Óculos Aviador", tipo: "Óculos de sol", onUsarPrompt: usar }));
    const painel = tela.container.querySelector("[data-painel-do-arsenal]") as HTMLElement;
    expect(within(painel).getByText("Arsenal de prompts")).toBeTruthy();
    const lista = painel.querySelector("[data-rolagem-do-arsenal]") as HTMLElement;
    expect(lista.className).toContain("overflow-y-auto");
    expect(lista.className).toContain("max-h-[60vh]");
    // Área Produto por padrão: o packshot de lógica já com o produto.
    const pack = within(lista).getByText(/^Foto profissional de Óculos Aviador \(óculos de sol\), inteiro no quadro/);
    expect(pack).toBeTruthy();
    // E o prompt da biblioteca que serve, preenchido.
    await waitFor(() => expect(within(lista).getByText("Foto profissional de Óculos Aviador (óculos de sol) em fundo branco puro.")).toBeTruthy());
    fireEvent.click(within(lista).getByRole("button", { name: "Copiar o prompt Packshot de catálogo" }));
    await waitFor(() => expect(escrever).toHaveBeenCalledWith(expect.stringContaining("Foto profissional de Óculos Aviador (óculos de sol)")));
    fireEvent.click(within(lista).getByRole("button", { name: "Usar o prompt Packshot de catálogo" }));
    expect(usar).toHaveBeenCalledWith(expect.stringContaining("Óculos Aviador (óculos de sol)"));
    // Modelo: atalhos de modelo entram no prompt.
    fireEvent.click(within(painel).getByRole("radio", { name: /Modelo/ }));
    fireEvent.click(within(painel).getByRole("button", { name: /Mulher 30/ }));
    expect(within(painel).getAllByText(/uma mulher de 30 anos/).length).toBeGreaterThan(0);
  });
});
