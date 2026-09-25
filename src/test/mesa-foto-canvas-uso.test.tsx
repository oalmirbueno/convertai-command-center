import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Canvas da Mesa Foto, correções de uso (dono, 26/09): "a parte de produtos,
 * pessoa, ambiente está cobrindo demais o quadro" e "quando eu rolo, ele fica
 * mexendo todo o canvas". O que abre sobre o quadro é estreito, com altura
 * máxima e rolagem própria, encostado na lateral; rolar num painel não mexe
 * no quadro (nowheel/nopan/nodrag e a roda presa); no fundo do quadro, rolar
 * move o quadro e Ctrl + rolar (ou pinça) dá zoom.
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
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
          upload: vi.fn(),
          createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/img.png" }, error: null }),
          createSignedUrls: () => Promise.resolve({ data: [], error: null }),
        }),
      },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));
vi.mock("@/hooks/useSupabaseData", () => ({
  useClients: () => ({ data: [{ id: "11111111-1111-1111-1111-111111111111", company_name: "Ótica Sintética" }], isLoading: false, isSuccess: true }),
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import type { ModeloIa } from "@/lib/mesa/api";
import { MesaFotoProvider, type MesaFotoValor } from "@/components/mesa-foto/Comuns";
import EtapaCanvas from "@/components/mesa-foto/EtapaCanvas";
import { esquecerAndamentos } from "@/components/mesa-foto/modelosApi";
import { rolaDentro } from "@/components/mesa-foto/canvas/comum";

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const KIT = "bbbbbbbb-0000-4000-8000-000000000001";
const F1 = "aaaaaaaa-0000-4000-8000-000000000001";
const P1 = "dddddddd-0000-4000-8000-000000000001";
const ANCORA = "eeeeeeee-0000-4000-8000-000000000001";
const CANVAS = "ffffffff-0000-4000-8000-000000000001";
const GPT = "openrouter:openai/gpt-image-2.5-sunburst";

const catalogo: ModeloIa[] = [
  {
    id: "openai:gpt-texto", provedor: "openai", modelo_api: "gpt-texto", tipo: "texto", rotulo: "Texto",
    preco_entrada_1m: 1, preco_saida_1m: 2, preco_cache_1m: null, preco_imagem: null,
    raciocinio: [], padrao_para: ["estrategista", "diretor_arte", "leitura"], ativo: true,
  },
  {
    id: GPT, provedor: "openrouter", modelo_api: "openai/gpt-image-2.5-sunburst", tipo: "imagem", rotulo: "GPT Image",
    preco_entrada_1m: null, preco_saida_1m: null, preco_cache_1m: null, preco_imagem: { baixa: 0.025, media: 0.05, alta: 0.1 },
    raciocinio: [], padrao_para: ["imagem"], ativo: true,
  },
];

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Ótica Sintética",
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

const valorDaFoto = (): MesaFotoValor => ({
  kitId: null,
  ensaioId: null,
  imagemId: null,
  escolherKit: vi.fn(),
  escolherEnsaio: vi.fn(),
  irPara: vi.fn(),
  selecionadas: [],
  setSelecionadas: vi.fn(),
  abrirAgente: vi.fn(),
});

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(
      QueryClientProvider,
      { client: qc },
      h(MemoryRouter, { initialEntries: [`/mesa-foto?client=${CLIENTE}`] }, h(TooltipProvider, null, h(MesaProvider, { valor: valorDaMesa(), children: h(MesaFotoProvider, { valor: valorDaFoto(), children: h(EtapaCanvas) }) }))),
    ),
  );
}

const CANVAS_BRUTO = {
  id: CANVAS,
  client_id: CLIENTE,
  nome: "Óculos na praia",
  versao: 2,
  status: "ativo",
  atualizado_em: "2026-09-25T12:00:00Z",
  viewport: { x: 0, y: 0, zoom: 1 },
  nos: [
    { id: "no-produto", tipo: "produto", x: 0, y: 0, dados: { kit_id: KIT } },
    { id: "no-saida", tipo: "saida", x: 380, y: 40, dados: { motores: [GPT], formato: "4:5", qualidade: "alta" } },
  ],
  ligacoes: [{ id: "l1", de: "no-produto", para: "no-saida", ordem: 0 }],
};

beforeAll(() => {
  class Observador {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as any).ResizeObserver = Observador;
  if (!(globalThis as any).DOMMatrixReadOnly) {
    (globalThis as any).DOMMatrixReadOnly = class {
      m22: number;
      constructor(t?: string) {
        const m = typeof t === "string" ? /scale\(([0-9.]+)\)/.exec(t) : null;
        this.m22 = m ? Number(m[1]) : 1;
      }
    };
  }
  Object.defineProperties(HTMLElement.prototype, {
    offsetHeight: { configurable: true, get() { return parseFloat((this as HTMLElement).style.height) || 1; } },
    offsetWidth: { configurable: true, get() { return parseFloat((this as HTMLElement).style.width) || 1; } },
  });
  (SVGElement.prototype as any).getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 });
  if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => {};
  if (!(Element.prototype as any).hasPointerCapture) (Element.prototype as any).hasPointerCapture = () => false;
});

beforeEach(() => {
  vi.clearAllMocks();
  esquecerAndamentos();
  document.body.removeAttribute("data-modo-foco");
  mock.tabelas = {
    cliente_imagens: [{ id: F1, client_id: CLIENTE, nome: "loja.jpg", storage_bucket: "mesa", storage_path: `${CLIENTE}/foto/originais/${F1}.jpg`, origem: "mesa_foto", tags: [], criado_em: "2026-09-25T10:00:00Z" }],
    foto_kits: [{ id: KIT, client_id: CLIENTE, tipo: "moda", nome: "Óculos Aro Fino", frente_imagem_id: F1, status: "confirmado", atualizado_em: "2026-09-25T10:00:00Z" }],
    foto_kit_refs: [{ kit_id: KIT, imagem_id: F1, papel: "identidade", prioridade: 0 }],
    foto_modelos: [{ id: P1, client_id: CLIENTE, nome: "Marina", ficha: {}, invariantes: [], status: "pronta", ancora_imagem_id: ANCORA, versao: 1, etica: { sintetica: true, adulta: true }, atualizado_em: "2026-09-24T10:00:00Z" }],
    foto_modelo_imagens: [],
    foto_canvas: [CANVAS_BRUTO],
    foto_biblioteca: [],
  };
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
  mock.rpc.mockResolvedValue({ data: { saldo_usd: 12.5 }, error: null });
  mock.invoke.mockResolvedValue({ data: { ok: true, custo_usd: 0.01 }, error: null });
});

const abrirQuadro = async () => {
  montar();
  await waitFor(() => expect(document.querySelectorAll("[data-no-do-canvas]").length).toBe(2));
};

const classes = (el: Element | null) => (el ? (el.getAttribute("class") || "").split(/\s+/) : []);

/** Painel sobre o quadro: o React Flow não mexe no quadro a partir dele. */
function semMexerNoQuadro(el: Element | null) {
  expect(el).toBeTruthy();
  const c = classes(el);
  for (const k of ["nowheel", "nopan", "nodrag", "overscroll-contain"]) expect(c).toContain(k);
}

/** Transformação do quadro: onde está e o zoom. */
function vista() {
  const v = document.querySelector(".react-flow__viewport") as HTMLElement;
  const t = v.style.transform;
  const m = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)\s*scale\(\s*([\d.]+)\s*\)/.exec(t);
  expect(m).toBeTruthy();
  return { x: Number(m![1]), y: Number(m![2]), zoom: Number(m![3]) };
}

/** Finge uma caixa com rolagem própria (o jsdom não calcula layout nem lê o Tailwind). */
function caixaQueRola(el: HTMLElement, topo: number) {
  el.style.overflowY = "auto";
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: 600 });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: 200 });
  el.scrollTop = topo;
  Object.defineProperty(el, "scrollTop", { configurable: true, writable: true, value: topo });
}

describe("canvas: painéis que abrem não cobrem o quadro", () => {
  it("paleta, esteira, ajustes e como funciona levam nowheel/nopan/nodrag; os que rolam têm altura máxima e rolagem própria", async () => {
    await abrirQuadro();
    const paleta = document.querySelector("[data-paleta-lateral]") as HTMLElement;
    semMexerNoQuadro(paleta);
    expect(classes(paleta)).toEqual(expect.arrayContaining(["overflow-y-auto", "max-h-[calc(100%-24px)]"]));
    semMexerNoQuadro(document.querySelector("[data-esteira-de-produtos]"));
    expect(classes(document.querySelector("[data-fila-da-esteira]"))).toEqual(expect.arrayContaining(["overflow-x-auto", "overscroll-contain"]));
    // Como funciona: encostado na paleta, estreito (não mais no meio do quadro).
    const como = document.querySelector("[data-como-funciona]") as HTMLElement;
    semMexerNoQuadro(como);
    expect(classes(como)).toContain("left-[76px]");
    expect(classes(como)).not.toContain("left-1/2");
    // Ajustes recolhidos e abertos.
    semMexerNoQuadro(document.querySelector('[data-ajustes="recolhidos"]'));
    fireEvent.click(screen.getByRole("button", { name: "Abrir os ajustes" }));
    const ajustes = await waitFor(() => {
      const a = document.querySelector('[data-ajustes="abertos"]') as HTMLElement;
      expect(a).toBeTruthy();
      return a;
    });
    semMexerNoQuadro(ajustes);
    // Só da altura do conteúdo (no máximo a do quadro), estreita, e folha no pé em tela pequena.
    expect(classes(ajustes)).toEqual(expect.arrayContaining(["sm:max-h-[calc(100%-24px)]", "sm:w-[272px]", "max-h-[60%]", "bottom-2"]));
    expect(classes(ajustes)).not.toContain("bottom-3");
    expect(classes(ajustes.querySelector("[data-rolagem-propria]"))).toEqual(expect.arrayContaining(["overflow-y-auto", "min-h-0"]));
    // Dica discreta de como rolar.
    expect(document.querySelector("[data-ajuda-do-quadro]")!.textContent).toMatch(/Rolar move o quadro.*Ctrl.*zoom/);
  });

  it("escolher produto/pessoa/ambiente abre uma gaveta estreita ao lado da paleta, sem véu escuro; Esc e o fundo do quadro fecham", async () => {
    await abrirQuadro();
    fireEvent.click(document.querySelector('[data-paleta="ambiente"]') as HTMLElement);
    const gaveta = await waitFor(() => {
      const g = document.querySelector('[data-escolher-cartao="ambiente"]') as HTMLElement;
      expect(g).toBeTruthy();
      return g;
    });
    // Dentro do quadro, encostada na paleta, estreita, com rolagem própria.
    expect(gaveta.closest("[data-quadro]")).toBeTruthy();
    expect(gaveta.getAttribute("data-gaveta")).toBe("quadro");
    expect(gaveta.getAttribute("aria-modal")).toBe("false");
    semMexerNoQuadro(gaveta);
    expect(classes(gaveta)).toEqual(expect.arrayContaining(["sm:left-[76px]", "sm:w-[320px]", "sm:max-h-[calc(100%-24px)]", "max-h-[62%]"]));
    expect(classes(gaveta.querySelector("[data-rolagem-propria]"))).toEqual(expect.arrayContaining(["overflow-y-auto", "min-h-0", "overscroll-contain"]));
    // Nada de véu por cima das fotos, nem janela no meio da tela.
    expect(document.querySelector('.fixed[class*="bg-black"], [class*="inset-0"][class*="bg-black"]')).toBeNull();
    expect(document.querySelector('[role="dialog"][data-state]')).toBeNull();
    // Como funciona sai do caminho enquanto a gaveta está aberta.
    expect(document.querySelector("[data-como-funciona]")).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(document.querySelector("[data-escolher-cartao]")).toBeNull());

    // Adicionar abre de novo; tocar no fundo do quadro fecha.
    fireEvent.click(document.querySelector('[data-paleta="adicionar"]') as HTMLElement);
    await waitFor(() => expect(document.querySelector('[data-escolher-cartao="produto"]')).toBeTruthy());
    fireEvent.click(document.querySelector(".react-flow__pane") as HTMLElement);
    await waitFor(() => expect(document.querySelector("[data-escolher-cartao]")).toBeNull());
  });

  it("modelos prontos viram gaveta estreita; abrir a escolha fecha os modelos (uma gaveta por vez)", async () => {
    await abrirQuadro();
    fireEvent.click(screen.getByRole("button", { name: /Modelos prontos/ }));
    const galeria = await waitFor(() => {
      const g = document.querySelector("[data-modelos-prontos]") as HTMLElement;
      expect(g).toBeTruthy();
      return g;
    });
    const gaveta = galeria.closest("[data-gaveta]") as HTMLElement;
    expect(gaveta.getAttribute("data-gaveta")).toBe("quadro");
    semMexerNoQuadro(gaveta);
    expect(within(gaveta).getByRole("button", { name: /Montar pelo contexto/ })).toBeTruthy();
    // Nada de faixa larga no pé do quadro.
    expect(document.querySelector('[class*="max-w-[900px]"]')).toBeNull();
    fireEvent.click(document.querySelector('[data-paleta="produto"]') as HTMLElement);
    await waitFor(() => expect(document.querySelector('[data-escolher-cartao="produto"]')).toBeTruthy());
    expect(document.querySelector("[data-modelos-prontos]")).toBeNull();
    expect(document.querySelectorAll("[data-gaveta]")).toHaveLength(1);
    fireEvent.click(within(document.querySelector("[data-gaveta]") as HTMLElement).getByRole("button", { name: "Fechar a escolha" }));
    await waitFor(() => expect(document.querySelector("[data-gaveta]")).toBeNull());
  });

  it("modo lista: a escolha abre como folha no pé da página", async () => {
    await abrirQuadro();
    fireEvent.click(screen.getByRole("button", { name: /Modo lista/ }));
    await waitFor(() => expect(document.querySelector("[data-modo-lista]")).toBeTruthy());
    fireEvent.click(within(document.querySelector("[data-modo-lista]") as HTMLElement).getByRole("button", { name: "Pessoa" }));
    const folha = await waitFor(() => {
      const g = document.querySelector('[data-escolher-cartao="modelo"]') as HTMLElement;
      expect(g).toBeTruthy();
      return g;
    });
    expect(folha.getAttribute("data-gaveta")).toBe("pagina");
    expect(classes(folha)).toEqual(expect.arrayContaining(["fixed", "bottom-0", "max-h-[75vh]"]));
  });
});

describe("canvas: rolagem", () => {
  it("rolar no fundo do quadro move o quadro (sem zoom e sem rolar a página); Ctrl + rolar dá zoom", async () => {
    await abrirQuadro();
    const fundo = document.querySelector(".react-flow__pane") as HTMLElement;
    const antes = vista();
    // fireEvent devolve false quando a página não rola (preventDefault).
    expect(fireEvent.wheel(fundo, { deltaY: 100, deltaX: 0 })).toBe(false);
    const depois = vista();
    expect(depois.zoom).toBe(antes.zoom);
    expect(depois.y).toBeLessThan(antes.y);
    fireEvent.wheel(fundo, { deltaY: -200, ctrlKey: true });
    await waitFor(() => expect(vista().zoom).toBeGreaterThan(antes.zoom));
  });

  it("rolar em qualquer painel, lista ou gaveta não mexe no quadro nem na página; dentro da caixa que rola, rola só ela", async () => {
    await abrirQuadro();
    fireEvent.click(document.querySelector('[data-paleta="ambiente"]') as HTMLElement);
    const gaveta = await waitFor(() => {
      const g = document.querySelector('[data-escolher-cartao="ambiente"]') as HTMLElement;
      expect(g).toBeTruthy();
      return g;
    });
    fireEvent.click(screen.getByRole("button", { name: "Abrir os ajustes" }));
    await waitFor(() => expect(document.querySelector('[data-ajustes="abertos"]')).toBeTruthy());
    const antes = vista();
    const paineis = ["[data-paleta-lateral]", "[data-esteira-de-produtos]", '[data-ajustes="abertos"]', "[data-escolher-cartao]"].map((q) => document.querySelector(q) as HTMLElement);
    for (const p of paineis) {
      // Sem nada para rolar: a roda para no painel (a página e o quadro ficam parados).
      expect(fireEvent.wheel(p, { deltaY: 120 })).toBe(false);
      expect(fireEvent.wheel(p, { deltaY: -120, ctrlKey: true })).toBe(false);
    }
    expect(vista()).toEqual(antes);

    // Caixa com rolagem: rola (o navegador faz), e na ponta para ali.
    const corpo = gaveta.querySelector("[data-rolagem-propria]") as HTMLElement;
    caixaQueRola(corpo, 0);
    const opcao = corpo.querySelector("[data-opcao-da-escolha], button") as HTMLElement;
    expect(fireEvent.wheel(opcao, { deltaY: 100 })).toBe(true);
    expect(fireEvent.wheel(opcao, { deltaY: -100 })).toBe(false);
    caixaQueRola(corpo, 400);
    expect(fireEvent.wheel(opcao, { deltaY: 100 })).toBe(false);
    expect(fireEvent.wheel(opcao, { deltaY: -100 })).toBe(true);
    expect(vista()).toEqual(antes);
  });

  it("esteira: a roda vertical anda a fila de produtos para o lado", async () => {
    await abrirQuadro();
    const fila = await waitFor(() => {
      const f = document.querySelector("[data-fila-da-esteira]") as HTMLElement;
      expect(f).toBeTruthy();
      return f;
    });
    fila.style.overflowX = "auto";
    Object.defineProperty(fila, "scrollWidth", { configurable: true, value: 900 });
    Object.defineProperty(fila, "clientWidth", { configurable: true, value: 300 });
    fila.scrollLeft = 0;
    expect(fireEvent.wheel(fila, { deltaY: 80 })).toBe(false);
    expect(fila.scrollLeft).toBe(80);
  });

  it("rolaDentro: sobe do alvo até a raiz procurando caixa que ainda rola na direção", () => {
    const raizDoPainel = document.createElement("div");
    const caixa = document.createElement("div");
    const alvo = document.createElement("span");
    caixa.appendChild(alvo);
    raizDoPainel.appendChild(caixa);
    document.body.appendChild(raizDoPainel);
    expect(rolaDentro(alvo, raizDoPainel, 0, 50)).toBe(false);
    caixaQueRola(caixa, 100);
    expect(rolaDentro(alvo, raizDoPainel, 0, 50)).toBe(true);
    expect(rolaDentro(alvo, raizDoPainel, 0, -50)).toBe(true);
    expect(rolaDentro(alvo, raizDoPainel, 30, 0)).toBe(false);
    raizDoPainel.remove();
  });

  it("conversa do agente: a caixa tem rolagem própria e desce sozinha, sem scrollIntoView (que rolava a página e o quadro)", async () => {
    const espiao = vi.spyOn(Element.prototype as any, "scrollIntoView");
    await abrirQuadro();
    fireEvent.click(document.querySelector('[data-paleta="agente"]') as HTMLElement);
    const conversa = await waitFor(() => {
      const c = document.querySelector('[role="log"][aria-label="Conversa com o agente"]') as HTMLElement;
      expect(c).toBeTruthy();
      return c;
    });
    expect(classes(conversa)).toEqual(expect.arrayContaining(["nowheel", "overflow-y-auto", "overscroll-contain", "max-h-[30vh]"]));
    expect(conversa.closest('[data-ajustes="abertos"]')).toBeTruthy();
    expect(espiao).not.toHaveBeenCalled();
    espiao.mockRestore();
    expect(ler("src/components/mesa-foto/canvas/Agente.tsx")).not.toMatch(/scrollIntoView\(/);
  });
});

describe("canvas: configuração do React Flow", () => {
  it("rolar = mover o quadro, zoom só com Ctrl/Cmd ou pinça; controles fora da paleta", () => {
    const fonte = ler("src/components/mesa-foto/EtapaCanvas.tsx");
    const quadro = fonte.slice(fonte.indexOf("<ReactFlow"), fonte.indexOf("</ReactFlow>"));
    expect(quadro).toMatch(/\n\s+panOnScroll\n/);
    expect(quadro).toContain("zoomOnScroll={false}");
    expect(quadro).toMatch(/\n\s+zoomOnPinch\n/);
    expect(quadro).toMatch(/\n\s+preventScrolling\n/);
    expect(quadro).toContain('noWheelClassName="nowheel"');
    expect(quadro).toContain("style={{ left: 60 }}");
    // A escolha não usa mais a janela do meio da tela com véu.
    expect(ler("src/components/mesa-foto/canvas/Escolher.tsx")).not.toMatch(/@\/components\/ui\/dialog/);
  });
});
