import { useCallback, useRef, useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactFlowProvider, useStoreApi } from "@xyflow/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Canvas de nós do Laboratório (19/10): o bug do quadro branco ao arrastar
 * (nó remontado sem `measured`), a paleta em grupos com rolagem própria, os
 * campos no próprio nó (o mesmo renderizador do inspetor), a barra do nó
 * selecionado, o menu rápido do "+" e os controles próprios do quadro.
 */

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => {
  const cadeia = (): any => {
    const c: any = new Proxy(function () {}, {
      get: (_t, k) => (k === "then" ? (ok: (v: unknown) => void) => ok({ data: [], error: null }) : c),
      apply: () => c,
    });
    return c;
  };
  return {
    supabase: {
      from: () => cadeia(),
      rpc: () => cadeia(),
      functions: { invoke: vi.fn() },
      storage: {
        from: () => ({
          upload: vi.fn(() => Promise.resolve({ data: {}, error: null })),
          download: () => Promise.resolve({ data: null, error: new Error("sem arquivo") }),
          createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/x" }, error: null }),
          createSignedUrls: (caminhos: string[]) => Promise.resolve({ data: caminhos.map((p) => ({ path: p, signedUrl: `https://arquivo.test/${p}` })), error: null }),
        }),
      },
    },
  };
});

import QuadroDoLab from "@/components/laboratorio/QuadroDoLab";
import Paleta from "@/components/laboratorio/Paleta";
import Inspetor from "@/components/laboratorio/Inspetor";
import ResultadoDoNo from "@/components/laboratorio/ResultadoDoNo";
import { camposPrincipais } from "@/components/laboratorio/CamposDoNo";
import { lerMudancas, memoriaVazia, montarNo } from "@/components/laboratorio/no/montar";
import { TIPOS_DE_NO, gruposDaPaleta, ligar, podeLigar, tiposQueRecebem, type CanvasDoLab } from "@/lib/laboratorio/nos";
import { normalizarExecucao } from "@/lib/laboratorio/api";
import { blocoDosDocumentos, documentosDe, ehTextoPuro, TETO_DOS_DOCUMENTOS } from "../../supabase/functions/laboratorio/modulos/documentos";
import { CAMPOS_DO_TIPO } from "../../supabase/functions/laboratorio/modulos/regras";

const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8").replace(/\r\n/g, "\n");

beforeAll(() => {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  if (!(globalThis as any).DOMMatrixReadOnly) {
    (globalThis as any).DOMMatrixReadOnly = class {
      m22 = 1;
    };
  }
  (SVGElement.prototype as any).getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 });
});

const BASE: CanvasDoLab = {
  nos: [
    { id: "c1", tipo: "contexto", x: 0, y: 0, dados: { texto: "Lançamento de outubro" } },
    { id: "a1", tipo: "agente", x: 360, y: 0, dados: { instrucao: "", modelo_id: "openrouter:anthropic/claude-opus-5.5" } },
  ],
  ligacoes: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

/** O quadro com o estado do editor por fora (como o EditorDoProjeto faz) e a loja do xyflow à mão. */
function montar(o: { canvas?: CanvasDoLab; selecionado?: string | null; onRodar?: (id: string) => void; onSincronizar?: (id: string) => void; onAbrirDetalhes?: (id: string) => void; onMudarGatilho?: (ligacaoId: string, g: string | null) => void } = {}) {
  const fora = { canvas: o.canvas || BASE, loja: null as ReturnType<typeof useStoreApi> | null };
  function Sonda() {
    fora.loja = useStoreApi();
    return null;
  }
  function Teste() {
    const [canvas, setCanvas] = useState<CanvasDoLab>(fora.canvas);
    const atual = useRef(canvas);
    const [sel, setSel] = useState<string | null>(o.selecionado === undefined ? null : o.selecionado);
    const mudar = useCallback((fn: (c: CanvasDoLab) => CanvasDoLab) => {
      const novo = fn(atual.current);
      if (novo === atual.current) return;
      atual.current = novo;
      fora.canvas = novo;
      setCanvas(novo);
    }, []);
    const tentar = useCallback(
      (de: string, para: string) => {
        const v = podeLigar(atual.current, de, para);
        if (!v.ok) return v.motivo;
        mudar((c) => ligar(c, de, para));
        return null;
      },
      [mudar],
    );
    return (
      <div style={{ width: 1200, height: 800 }}>
        <QuadroDoLab
          canvas={canvas}
          execucoes={{}}
          selecionado={sel}
          rodandoNo={null}
          onSelecionar={setSel}
          onMudarCanvas={mudar}
          onTentarLigar={tentar}
          onRodar={o.onRodar || (() => undefined)}
          onSoltar={() => undefined}
          onViewport={() => undefined}
          projetoId="aaaaaaaa-0000-4000-8000-000000000001"
          onSincronizar={o.onSincronizar}
          onAbrirDetalhes={o.onAbrirDetalhes}
          onMudarGatilho={o.onMudarGatilho}
        />
        <Sonda />
      </div>
    );
  }
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ReactFlowProvider>
        <Teste />
      </ReactFlowProvider>
    </QueryClientProvider>,
  );
  return fora;
}

const noNaTela = (id: string) => {
  const el = document.querySelector(`[data-no-do-quadro="${id}"]`);
  if (!el) throw new Error(`sem o nó ${id}`);
  return el as HTMLElement;
};

// ------------------------------------------------------------------ 1. bug do arrasto

describe("arrastar um nó não apaga o quadro (measured preservado)", () => {
  it("a memória guarda a medida e o arrasto; o nó remontado leva measured, width e dragging", () => {
    const memoria = memoriaVazia();
    const r1 = lerMudancas([{ type: "dimensions", id: "c1", dimensions: { width: 272, height: 190 } }], memoria);
    expect(r1.mediu).toBe(true);
    const r2 = lerMudancas([{ type: "position", id: "c1", position: { x: 40, y: 30 }, dragging: true }], memoria);
    expect(r2.posicoes.c1).toEqual({ x: 40, y: 30 });
    expect(r2.arrasto).toBe(true);
    // O canvas muda de posição e o nó é remontado do zero: a medida continua.
    const no = montarNo({ id: "c1", tipo: "contexto", x: 40, y: 30, dados: {} }, { selecionado: false, largura: 272, memoria, data: {} });
    expect(no.measured).toEqual({ width: 272, height: 190 });
    expect(no.width).toBe(272);
    expect(no.dragging).toBe(true);
    // A altura não vira estilo fixo (o nó precisa crescer ao expandir).
    expect(no.height).toBeUndefined();
    // Medida igual não pede remontagem; o remover limpa a memória.
    expect(lerMudancas([{ type: "dimensions", id: "c1", dimensions: { width: 272, height: 190 } }], memoria).mediu).toBe(false);
    lerMudancas([{ type: "remove", id: "c1" }], memoria);
    expect(memoria.medidas.c1).toBeUndefined();
  });

  it("no quadro de verdade: depois de medir e arrastar, o nó segue medido e visível", async () => {
    const fora = montar();
    await waitFor(() => expect(fora.loja).not.toBeNull());
    const loja = fora.loja!;
    act(() => {
      loja.getState().triggerNodeChanges([{ type: "dimensions", id: "c1", dimensions: { width: 272, height: 210 } }]);
    });
    await waitFor(() => expect(loja.getState().nodeLookup.get("c1")!.measured.height).toBe(210));
    // Arrasta: a posição muda no canvas e os nós são remontados.
    act(() => {
      loja.getState().triggerNodeChanges([{ type: "position", id: "c1", position: { x: 80, y: 50 }, dragging: true }]);
    });
    await waitFor(() => expect(fora.canvas.nos.find((n) => n.id === "c1")).toMatchObject({ x: 80, y: 50 }));
    const interno = loja.getState().nodeLookup.get("c1")!;
    expect(interno.measured).toEqual({ width: 272, height: 210 });
    expect(interno.dragging).toBe(true);
    const casca = document.querySelector('.react-flow__node[data-id="c1"]') as HTMLElement;
    expect(casca.style.visibility).toBe("visible");
  });

  it("o canvas da Mesa Foto já monta os nós com measured (não tinha o mesmo bug)", () => {
    const codigo = ler("src/components/mesa-foto/EtapaCanvas.tsx");
    expect(codigo).toMatch(/measured: \{ width: tamanho\.largura, height: tamanho\.altura \}/);
  });
});

// ------------------------------------------------------------------ 2. paleta

describe("paleta em grupos, com rolagem própria", () => {
  it("grupos na ordem, separador discreto entre eles e todo tipo com o seu botão", () => {
    render(<Paleta onPor={() => undefined} />);
    const barra = screen.getByRole("toolbar", { name: "Nós do projeto" });
    // Rola por conta própria e a roda não mexe no quadro.
    expect(barra.className).toMatch(/\boverflow-y-auto\b/);
    expect(barra.className).toMatch(/\bnowheel\b/);
    expect(barra.className).toMatch(/\bmin-h-0\b/);
    const grupos = Array.prototype.map.call(barra.querySelectorAll("[data-grupo-da-paleta]"), (g: HTMLElement) => g.getAttribute("data-grupo-da-paleta"));
    // Na ordem da tela; "Outros" só aparece se houver tipo novo sem grupo (e sempre no fim).
    const ordem = ["entradas", "criacao", "funil", "mensagens", "agentes", "publicacao", "outros"];
    expect(grupos.slice(0, 6)).toEqual(ordem.slice(0, 6));
    expect(grupos.slice(6).every((g) => g === "outros")).toBe(true);
    expect(within(barra).getAllByRole("separator")).toHaveLength(grupos.length - 1);
    for (const t of Object.keys(TIPOS_DE_NO)) {
      const b = barra.querySelector(`[data-por-no="${t}"]`) as HTMLElement;
      expect(b, t).not.toBeNull();
      // Ícone só: o nome no title e no aria-label.
      expect(b.getAttribute("aria-label")).toBe(TIPOS_DE_NO[t as keyof typeof TIPOS_DE_NO].rotulo);
      expect(b.getAttribute("title")).toContain(TIPOS_DE_NO[t as keyof typeof TIPOS_DE_NO].rotulo);
      expect(b.textContent).toBe("");
    }
  });

  it("tipo novo sem grupo cai em Outros", () => {
    const tipos = TIPOS_DE_NO as unknown as Record<string, unknown>;
    tipos.teste_novo = { ...TIPOS_DE_NO.copy, tipo: "teste_novo", rotulo: "Teste novo" };
    try {
      const g = gruposDaPaleta();
      expect(g[g.length - 1].id).toBe("outros");
      expect(g[g.length - 1].tipos).toContain("teste_novo");
    } finally {
      delete tipos.teste_novo;
    }
    expect(gruposDaPaleta().some((x) => x.tipos.indexOf("teste_novo" as never) >= 0)).toBe(false);
  });

  it("recolhe para o lado e abre de novo; arrastar continua levando o tipo", () => {
    const onPor = vi.fn();
    render(<Paleta onPor={onPor} />);
    const dados: Record<string, string> = {};
    fireEvent.dragStart(screen.getByRole("button", { name: "Logo" }), { dataTransfer: { setData: (k: string, v: string) => (dados[k] = v), effectAllowed: "" } });
    expect(dados["application/laboratorio-no"]).toBe("logo");
    fireEvent.click(screen.getByRole("button", { name: "Logo" }));
    expect(onPor).toHaveBeenCalledWith("logo");
    fireEvent.click(screen.getByRole("button", { name: "Recolher a paleta" }));
    expect(screen.queryByRole("toolbar", { name: "Nós do projeto" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Abrir a paleta" }));
    expect(screen.getByRole("toolbar", { name: "Nós do projeto" })).toBeInTheDocument();
  });

  it("no editor, a paleta fica numa coluna da altura toda", () => {
    expect(ler("src/components/laboratorio/EditorDoProjeto.tsx")).toContain('<div className="mr-2 flex shrink-0 flex-col border-r border-border pr-1">');
  });
});

// ------------------------------------------------------------------ 3. campos no próprio nó

describe("campos no próprio nó (o mesmo esquema do inspetor)", () => {
  it("recolhido mostra os principais; expandir mostra todos, com o texto longo grande", async () => {
    expect(camposPrincipais("agente").map((c) => c.chave)).toEqual(["instrucao", "arquivos"]);
    expect(camposPrincipais("contexto").map((c) => c.chave)).toEqual(["texto", "arquivos"]);
    const fora = montar();
    const contexto = noNaTela("c1");
    const texto = within(contexto).getByLabelText("Texto") as HTMLTextAreaElement;
    expect(texto.value).toBe("Lançamento de outubro");
    // Digitar no nó muda o canvas, sem abrir inspetor nenhum.
    fireEvent.change(texto, { target: { value: "Lançamento de novembro" } });
    expect(fora.canvas.nos[0].dados.texto).toBe("Lançamento de novembro");
    expect(document.querySelector("[data-inspetor]")).toBeNull();
    // Campos são nodrag/nowheel (digitar e rolar não arrastam nem dão zoom).
    const corpo = contexto.querySelector("[data-corpo-do-no]") as HTMLElement;
    expect(corpo.className).toMatch(/\bnodrag\b/);
    expect(corpo.className).toMatch(/\bnowheel\b/);

    // jsdom não mede: o nó fica "visibility: hidden" e as buscas por papel não o enxergam (rótulo sim).
    const agente = noNaTela("a1");
    expect(within(agente).getByLabelText("Instrução")).toBeInTheDocument();
    expect(within(agente).queryByLabelText("Modelo")).toBeNull();
    expect(within(agente).getByLabelText("Escolher do Workspace")).toBeInTheDocument();
    expect(within(agente).getByLabelText("Enviar documento")).toBeInTheDocument();
    fireEvent.click(within(agente).getByLabelText("Expandir o nó"));
    await waitFor(() => expect(noNaTela("a1").hasAttribute("data-expandido")).toBe(true));
    const grande = noNaTela("a1");
    expect(within(grande).getByLabelText("Modelo")).toBeInTheDocument();
    expect((within(grande).getByLabelText("Instrução") as HTMLElement).className).toContain("min-h-[160px]");
    expect(grande.style.width).toBe("384px");
  });

  it("o inspetor usa o mesmo renderizador (CamposDoNo) e os ids não batem com os do nó", () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <Inspetor canvas={BASE} no={BASE.nos[1]} projetoId="p1" execucao={undefined} rodando={false} onMudarDados={() => undefined} onLigar={() => null} onDesligar={() => undefined} onRemover={() => undefined} onRodar={() => undefined} onGerarTudoDaBase={() => undefined} avisoDeLigacao={null} />
      </QueryClientProvider>,
    );
    const el = document.querySelector("[data-inspetor]") as HTMLElement;
    expect(within(el).getByLabelText("Modelo").id).toBe("inspetor-a1-modelo_id");
    expect(within(el).getByLabelText("Instrução")).toBeInTheDocument();
    expect(el.querySelector("[data-campo-arquivos]")).not.toBeNull();
    expect(ler("src/components/laboratorio/Inspetor.tsx")).toContain("<CamposDoNo");
  });

  it("documentos: campo 'arquivos' nos dois lados do contrato e o texto entra com teto", () => {
    expect(TIPOS_DE_NO.contexto.campos.some((c) => c.tipo === "arquivos")).toBe(true);
    expect(TIPOS_DE_NO.agente.campos.some((c) => c.tipo === "arquivos")).toBe(true);
    expect(CAMPOS_DO_TIPO.contexto).toContain("arquivos");
    expect(CAMPOS_DO_TIPO.agente).toContain("arquivos");
    const docs = documentosDe([{ id: "d1", nome: "briefing.md", url: "", tipo: "text/markdown", path: "global/laboratorio/p/entradas/d1-briefing.md" }, "lixo", { nome: "" }]);
    expect(docs).toHaveLength(1);
    expect(ehTextoPuro("", "notas.txt")).toBe(true);
    expect(ehTextoPuro("application/pdf", "contrato.pdf")).toBe(false);
    const bloco = blocoDosDocumentos([
      { nome: "briefing.md", tipo: "text/markdown", texto: "x".repeat(40000) },
      { nome: "contrato.pdf", tipo: "application/pdf", url: "https://arquivo.test/c.pdf", motivo: "Não lido como texto aqui." },
    ]);
    expect(bloco.length).toBeLessThan(TETO_DOS_DOCUMENTOS + 400);
    expect(bloco).toContain("[Documento: contrato.pdf (application/pdf)] Não lido como texto aqui. Endereço: https://arquivo.test/c.pdf");
    expect(ler("supabase/functions/laboratorio/executar.ts")).toContain("textoDosDocumentos(ctx, no.dados.arquivos)");
  });
});

// ------------------------------------------------------------------ 4/5/6. barra do nó, menu rápido, controles

describe("barra do nó, menu rápido e controles", () => {
  it("selecionado: Rodar (pelo fluxo de custo de fora), Duplicar, Sincronizar, Abrir detalhes e Apagar", async () => {
    const onRodar = vi.fn();
    const onSincronizar = vi.fn();
    const onAbrirDetalhes = vi.fn();
    const fora = montar({ selecionado: "a1", onRodar, onSincronizar, onAbrirDetalhes });
    const barra = await screen.findByRole("toolbar", { name: "Ações de Agente" });
    fireEvent.click(within(barra).getByRole("button", { name: "Rodar Agente" }));
    expect(onRodar).toHaveBeenCalledWith("a1");
    fireEvent.click(within(barra).getByRole("button", { name: "Sincronizar" }));
    expect(onSincronizar).toHaveBeenCalledWith("a1");
    fireEvent.click(within(barra).getByRole("button", { name: "Abrir detalhes" }));
    expect(onAbrirDetalhes).toHaveBeenCalledWith("a1");
    fireEvent.click(within(barra).getByRole("button", { name: "Duplicar o nó" }));
    expect(fora.canvas.nos.filter((n) => n.tipo === "agente")).toHaveLength(2);
    const copia = fora.canvas.nos[2];
    fireEvent.click(within(await screen.findByRole("toolbar", { name: "Ações de Agente" })).getByRole("button", { name: "Apagar o nó" }));
    expect(fora.canvas.nos.some((n) => n.id === copia.id)).toBe(false);
  });

  it("o '+' da saída abre os tipos que ligam ali; escolher cria o nó e já liga", async () => {
    const fora = montar();
    fireEvent.click(noNaTela("c1").querySelector('[data-mais-do-no="c1"]') as HTMLElement);
    const menu = await screen.findByRole("menu");
    const nomes = within(menu).getAllByRole("menuitem").map((b) => b.getAttribute("data-menu-tipo"));
    expect(nomes).toEqual(tiposQueRecebem("contexto"));
    expect(nomes).toContain("agente");
    expect(nomes).not.toContain("midia");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Copy" }));
    const novo = fora.canvas.nos.find((n) => n.tipo === "copy");
    expect(novo).toBeTruthy();
    expect(fora.canvas.ligacoes).toEqual([expect.objectContaining({ de: "c1", para: novo!.id })]);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("controles próprios numa pílula: zoom, ajustar, travar e mini-mapa", async () => {
    montar();
    const c = screen.getByRole("toolbar", { name: "Controles do quadro" });
    for (const n of ["Aumentar", "Diminuir", "Ajustar à tela", "Travar o quadro", "Mostrar o mini-mapa"]) expect(within(c).getByRole("button", { name: n })).toBeInTheDocument();
    // Cores do tema, nada de cor fixa que some no claro.
    expect(c.className).toContain("bg-popover");
    fireEvent.click(within(c).getByRole("button", { name: "Mostrar o mini-mapa" }));
    await waitFor(() => expect(document.querySelector(".react-flow__minimap")).not.toBeNull());
    fireEvent.click(within(c).getByRole("button", { name: "Travar o quadro" }));
    expect(document.querySelector("[data-quadro-do-lab]")!.hasAttribute("data-travado")).toBe(true);
    // Travado: o "+" some (não liga).
    expect(document.querySelector('[data-mais-do-no="c1"]')).toBeNull();
    expect(ler("src/components/laboratorio/QuadroDoLab.tsx")).not.toMatch(/<Controls\b/);
  });

  it("imagens geradas no nó em grade; tocar amplia e dá para baixar", async () => {
    const ex = normalizarExecucao({ id: "e1", no_id: "i1", tipo: "imagem", status: "pronto", saida: { imagens: [{ path: "global/a.png", url: "https://img.test/a.png" }, { path: "global/b.png", url: "https://img.test/b.png" }] } })!;
    render(<ResultadoDoNo execucao={ex} tipo="imagem" largura={248} />);
    const grade = document.querySelector("[data-grade-de-imagens]") as HTMLElement;
    expect(within(grade).getAllByRole("button", { name: /Ampliar a imagem/ })).toHaveLength(2);
    fireEvent.click(within(grade).getByRole("button", { name: "Ampliar a imagem 2" }));
    const janela = await screen.findByRole("dialog");
    expect(within(janela).getByText("Imagem 2 de 2")).toBeInTheDocument();
    expect(within(janela).getByRole("button", { name: "Baixar a imagem" })).toBeInTheDocument();
    expect(within(janela).getByRole("img", { name: "Imagem 2" }).getAttribute("src")).toBe("https://img.test/b.png");
  });

  it("gatilho do funil: etiqueta no meio do fio e o seletor abre ali mesmo", async () => {
    const onMudarGatilho = vi.fn();
    const canvas: CanvasDoLab = {
      nos: [
        { id: "pg", tipo: "pagina", x: 0, y: 0, dados: {} },
        { id: "a1", tipo: "agente", x: 400, y: 0, dados: {} },
      ],
      ligacoes: [{ id: "g1", de: "pg", para: "a1", gatilho: "enviou_formulario" }],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const fora = montar({ canvas, onMudarGatilho });
    await waitFor(() => expect(fora.loja).not.toBeNull());
    // jsdom não mede: dá tamanho aos elementos e mede as alças à mão para o xyflow desenhar o fio.
    const largura = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
    const altura = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 272 });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 160 });
    act(() => {
      const mapa = new Map();
      document.querySelectorAll(".react-flow__node").forEach((el) => {
        const id = el.getAttribute("data-id") as string;
        mapa.set(id, { id, nodeElement: el, force: true });
      });
      fora.loja!.getState().updateNodeInternals(mapa);
    });
    if (largura) Object.defineProperty(HTMLElement.prototype, "offsetWidth", largura);
    if (altura) Object.defineProperty(HTMLElement.prototype, "offsetHeight", altura);
    const etiqueta = (await waitFor(() => {
      const el = document.querySelector('[data-etiqueta-do-gatilho="g1"]');
      if (!el) throw new Error("sem etiqueta");
      return el;
    })) as HTMLElement;
    expect(etiqueta.textContent).toBe("Enviou o formulário");
    fireEvent.click(etiqueta);
    const seletor = await waitFor(() => {
      const el = document.querySelector('[data-seletor-no-fio="g1"]');
      if (!el) throw new Error("sem seletor");
      return el as HTMLElement;
    });
    const escolha = within(seletor).getByLabelText(/Quando/) as HTMLSelectElement;
    expect(escolha.value).toBe("enviou_formulario");
    fireEvent.change(escolha, { target: { value: "clicou_botao" } });
    expect(onMudarGatilho).toHaveBeenCalledWith("g1", "clicou_botao");
    expect(document.querySelector('[data-seletor-no-fio="g1"]')).toBeNull();
    // A catraca: o seletor usa a escala da casa (sem text-xs).
    expect(ler("src/components/laboratorio/SeletorDeGatilho.tsx")).not.toMatch(/text-(xs|sm|base|lg)/);
  });

  it("landing pronta: miniatura da página no nó", () => {
    const ex = normalizarExecucao({ id: "e2", no_id: "l1", tipo: "landing", status: "pronto", saida: { html_url: "https://site.test/p.html" } })!;
    render(<ResultadoDoNo execucao={ex} tipo="landing" largura={248} />);
    const mini = document.querySelector("[data-miniatura-da-landing]") as HTMLElement;
    expect(mini).not.toBeNull();
    expect(mini.querySelector("iframe")!.getAttribute("src")).toBe("https://site.test/p.html");
  });

  it("código novo sem lookbehind, \\p{} nem grupo nomeado", () => {
    for (const a of [
      "src/components/laboratorio/QuadroDoLab.tsx",
      "src/components/laboratorio/Paleta.tsx",
      "src/components/laboratorio/CamposDoNo.tsx",
      "src/components/laboratorio/ResultadoDoNo.tsx",
      "src/components/laboratorio/no/CartaoDoNo.tsx",
      "src/components/laboratorio/no/LigacaoDoLab.tsx",
      "src/components/laboratorio/no/MenuRapido.tsx",
      "src/components/laboratorio/no/ControlesDoQuadro.tsx",
      "src/components/laboratorio/no/EscolherDocumentos.tsx",
      "src/components/laboratorio/no/montar.ts",
      "src/lib/laboratorio/nos.ts",
    ])
      expect(/\(\?<[=!]|\\p\{|\(\?<[A-Za-z]/.test(ler(a)), a).toBe(false);
  });
});
