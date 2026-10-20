import { useCallback, useRef, useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactFlowProvider } from "@xyflow/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Nós criativos com o motor treinado (21/10): as funções da Mesa Foto em cada
 * imagem (principal, ajustar, variar, usar como referência, salvar nos
 * arquivos, baixar, ampliar e comparar), "No motor" com o tempo, o que o nó
 * usa das entradas (saida.usou) com a sugestão "+ Ligar", e o pacote no Pôr
 * no ar. Respostas da função em mock (contrato em src/lib/laboratorio/api.ts).
 */

const m = vi.hoisted(() => ({ chamar: vi.fn(), toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

vi.mock("@/lib/mesa/api", async (orig) => ({ ...(await orig<typeof import("@/lib/mesa/api")>()), chamarFuncao: m.chamar }));
vi.mock("sonner", () => ({ toast: m.toast }));
// Cliente com duas marcas (Acerbi e CME): o nó Marca mostra o seletor.
vi.mock("@/lib/mesa/marcas", async (orig) => ({
  ...(await orig<typeof import("@/lib/mesa/marcas")>()),
  useMarcasDoCliente: (clientId: string) => ({ data: clientId ? [{ id: "mA", nome: "Acerbi", principal: true }, { id: "mB", nome: "CME", principal: false }] : [], isLoading: false }),
}));
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
import { ErroDaMesa } from "@/lib/mesa/api";
import { ligar, podeLigar, type CanvasDoLab } from "@/lib/laboratorio/nos";
import { avisarNosSoltos, normalizarExecucao, precisaAcompanhar, type ExecucaoDoLab } from "@/lib/laboratorio/api";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pacoteDoNo, sugestoesDoNo, usandoDoNo } from "@/lib/laboratorio/complemento";

const P = "aaaaaaaa-0000-4000-8000-000000000001";
const CLIENTE = "11111111-1111-4111-8111-111111111111";

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

beforeEach(() => {
  m.chamar.mockReset();
  Object.keys(m.toast).forEach((k) => (m.toast as any)[k].mockReset());
  m.chamar.mockImplementation(async (_f: string, corpo: any) => {
    if (corpo.acao === "no_ajustar" || corpo.acao === "no_variar") {
      if (!corpo.confirmado) throw new ErroDaMesa("confirmacao_necessaria", "Confirme o custo.", { error: "confirmacao_necessaria", custo_usd: corpo.acao === "no_variar" ? 0.12 : 0.04 });
      return { execucao: { id: "nova", no_id: corpo.no_id, tipo: "imagem", status: "na_fila", saida: {}, created_at: new Date().toISOString() } };
    }
    if (corpo.acao === "salvar_nos_arquivos") return { salvos: [{ nome: "post-1.png", path: "client/x/post-1.png", pasta: corpo.destino === "cliente" ? "Café da Serra / Laboratório" : "Laboratório / Livres / Projeto" }] };
    return {};
  });
});

const imagens = [1, 2, 3].map((i) => ({ path: `global/laboratorio/p/${i}.png`, url: `https://img.test/${i}.png` }));
const ex = (noId: string, status: string, saida: Record<string, unknown>, created_at = "2026-10-21T10:00:00Z") => normalizarExecucao({ id: `e-${noId}`, no_id: noId, tipo: "imagem", status, saida, created_at })!;

function montar(o: { canvas: CanvasDoLab; execucoes?: Record<string, ExecucaoDoLab>; clienteId?: string | null; onNovaExecucao?: (id: string, e: ExecucaoDoLab) => void }) {
  const fora = { canvas: o.canvas };
  function Teste() {
    const [canvas, setCanvas] = useState<CanvasDoLab>(fora.canvas);
    const atual = useRef(canvas);
    const [sel, setSel] = useState<string | null>(null);
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
          execucoes={o.execucoes || {}}
          selecionado={sel}
          rodandoNo={null}
          onSelecionar={setSel}
          onMudarCanvas={mudar}
          onTentarLigar={tentar}
          onRodar={() => undefined}
          onSoltar={() => undefined}
          onViewport={() => undefined}
          projetoId={P}
          clienteId={o.clienteId === undefined ? CLIENTE : o.clienteId}
          antesDeChamar={() => Promise.resolve()}
          onNovaExecucao={o.onNovaExecucao}
        />
      </div>
    );
  }
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ReactFlowProvider>
        <Teste />
      </ReactFlowProvider>
    </QueryClientProvider>,
  );
  return fora;
}

const no = (id: string) => {
  const el = document.querySelector(`[data-no-do-quadro="${id}"]`);
  if (!el) throw new Error(`sem o nó ${id}`);
  return el as HTMLElement;
};
const umaImagem = (dados: Record<string, unknown> = {}): CanvasDoLab => ({ nos: [{ id: "i1", tipo: "imagem", x: 400, y: 0, dados }], ligacoes: [], viewport: { x: 0, y: 0, zoom: 1 } });

describe("cada imagem gerada tem as funções da Mesa Foto", () => {
  it("escolher a principal (segue para os próximos nós)", () => {
    const fora = montar({ canvas: umaImagem(), execucoes: { i1: ex("i1", "pronto", { imagens }) } });
    const i1 = no("i1");
    expect(i1.querySelectorAll("[data-imagem-gerada]")).toHaveLength(3);
    expect(i1.querySelector('[data-imagem-gerada="0"] [data-selo-principal]')).not.toBeNull();
    fireEvent.click(i1.querySelector('[data-imagem-gerada="1"]') as HTMLElement);
    fireEvent.click(i1.querySelector('[data-escolher-principal="1"]') as HTMLElement);
    expect(fora.canvas.nos[0].dados.principal).toBe(1);
    expect(no("i1").querySelector('[data-imagem-gerada="1"] [data-selo-principal]')).not.toBeNull();
  });

  it("ajustar com pedido: custo antes (409), confirma e a execução nova vai para o editor", async () => {
    const onNovaExecucao = vi.fn();
    montar({ canvas: umaImagem(), execucoes: { i1: ex("i1", "pronto", { imagens }) }, onNovaExecucao });
    fireEvent.click(no("i1").querySelector('[data-ajustar-imagem="0"]') as HTMLElement);
    fireEvent.change(within(no("i1")).getByLabelText("O que mudar na imagem 1"), { target: { value: "fundo mais claro" } });
    fireEvent.click(no("i1").querySelector("[data-pedir-imagem]") as HTMLElement);
    const confirmar = await waitFor(() => {
      const el = no("i1").querySelector("[data-confirmar-custo]");
      if (!el) throw new Error("sem custo");
      return el as HTMLElement;
    });
    expect(confirmar.textContent).toContain("US$ 0,04");
    fireEvent.click(within(confirmar).getByText("Confirmar"));
    await waitFor(() => expect(onNovaExecucao).toHaveBeenCalled());
    expect(onNovaExecucao.mock.calls[0][0]).toBe("i1");
    expect(onNovaExecucao.mock.calls[0][1].status).toBe("na_fila");
    const pedidos = m.chamar.mock.calls.filter((c) => c[1].acao === "no_ajustar").map((c) => c[1]);
    expect(pedidos[0]).toEqual({ acao: "no_ajustar", projeto_id: P, no_id: "i1", indice: 0, pedido: "fundo mais claro" });
    expect(pedidos[1]).toMatchObject({ confirmado: true });
  });

  it("variar de 1 a 4, com o custo antes", async () => {
    const onNovaExecucao = vi.fn();
    montar({ canvas: umaImagem(), execucoes: { i1: ex("i1", "pronto", { imagens }) }, onNovaExecucao });
    fireEvent.click(no("i1").querySelector('[data-variar-imagem="0"]') as HTMLElement);
    fireEvent.click(within(no("i1").querySelector('[data-pedido-da-imagem="variar"]') as HTMLElement).getByText("3"));
    fireEvent.click(no("i1").querySelector("[data-pedir-imagem]") as HTMLElement);
    await waitFor(() => expect(no("i1").querySelector("[data-confirmar-custo]")!.textContent).toContain("Variar 3× custa US$ 0,12"));
    fireEvent.click(within(no("i1").querySelector("[data-confirmar-custo]") as HTMLElement).getByText("Confirmar"));
    await waitFor(() => expect(onNovaExecucao).toHaveBeenCalled());
    expect(m.chamar.mock.calls.filter((c) => c[1].acao === "no_variar").pop()![1]).toMatchObject({ indice: 0, quantidade: 3, confirmado: true });
  });

  it("usar como referência cria um nó Mídia com a imagem, já ligado", () => {
    const fora = montar({ canvas: umaImagem(), execucoes: { i1: ex("i1", "pronto", { imagens }) } });
    fireEvent.click(no("i1").querySelector('[data-imagem-gerada="2"]') as HTMLElement);
    fireEvent.click(no("i1").querySelector('[data-usar-referencia="2"]') as HTMLElement);
    const midia = fora.canvas.nos.find((n) => n.tipo === "midia")!;
    expect(midia).toBeTruthy();
    expect((midia.dados.midias as any[])[0]).toMatchObject({ tipo: "imagem", url: "https://img.test/3.png", path: "global/laboratorio/p/3.png" });
    expect(midia.dados.imagens).toEqual([{ path: "global/laboratorio/p/3.png", url: "https://img.test/3.png", nome: "Referência", bucket: "workspace" }]);
    expect(fora.canvas.ligacoes).toEqual([expect.objectContaining({ de: midia.id, para: "i1" })]);
  });

  // jsdom não mede: o nó fica oculto para as buscas por papel; o menu é lido pelo atributo role.
  it("salvar nos arquivos: do cliente ou do Laboratório, e o toast diz a pasta", async () => {
    montar({ canvas: umaImagem(), execucoes: { i1: ex("i1", "pronto", { imagens }) } });
    fireEvent.click(within(no("i1")).getByLabelText("Salvar nos arquivos"));
    const menu = no("i1").querySelector("[data-menu-salvar]") as HTMLElement;
    expect(Array.prototype.map.call(menu.querySelectorAll("[role=menuitem]"), (b: HTMLElement) => b.textContent)).toEqual(["Arquivos do cliente", "Pasta do Laboratório"]);
    fireEvent.click(within(menu).getByText("Arquivos do cliente"));
    await waitFor(() => expect(m.toast.success).toHaveBeenCalledWith("Salvo nos arquivos", { description: "Em Café da Serra / Laboratório" }));
    expect(m.chamar.mock.calls.find((c) => c[1].acao === "salvar_nos_arquivos")![1]).toEqual({ acao: "salvar_nos_arquivos", projeto_id: P, no_id: "i1", destino: "cliente", indices: [0] });
  });

  it("sem cliente, só a pasta do Laboratório", () => {
    montar({ canvas: umaImagem(), execucoes: { i1: ex("i1", "pronto", { imagens }) }, clienteId: null });
    fireEvent.click(within(no("i1")).getByLabelText("Salvar nos arquivos"));
    const menu = no("i1").querySelector("[data-menu-salvar]") as HTMLElement;
    expect(Array.prototype.map.call(menu.querySelectorAll("[role=menuitem]"), (b: HTMLElement) => b.textContent)).toEqual(["Pasta do Laboratório"]);
  });

  it("ampliar com as mesmas ações e comparar com a principal", async () => {
    montar({ canvas: umaImagem(), execucoes: { i1: ex("i1", "pronto", { imagens }) } });
    fireEvent.click(no("i1").querySelector('[data-imagem-gerada="2"]') as HTMLElement);
    fireEvent.click(within(no("i1")).getByLabelText("Ampliar"));
    const janela = await screen.findByRole("dialog");
    expect(within(janela).getByText("Imagem 3 de 3")).toBeInTheDocument();
    expect(within(janela).getByRole("button", { name: "Escolher como principal" })).toBeInTheDocument();
    expect(within(janela).getByRole("button", { name: "Variar" })).toBeInTheDocument();
    fireEvent.click(within(janela).getByRole("button", { name: "Comparar com a principal" }));
    const comparando = janela.querySelector("[data-comparando]") as HTMLElement;
    expect(Array.prototype.map.call(comparando.querySelectorAll("img"), (i: HTMLImageElement) => i.getAttribute("src"))).toEqual(["https://img.test/1.png", "https://img.test/3.png"]);
  });

  it("logo, carrossel, anúncio, template, influenciador e UGC também", () => {
    const tipos = ["logo", "carrossel", "anuncio", "template_designer", "influenciador", "ugc"];
    const canvas: CanvasDoLab = { nos: tipos.map((t, i) => ({ id: `c${i}`, tipo: t as any, x: i * 400, y: 0, dados: {} })), ligacoes: [], viewport: { x: 0, y: 0, zoom: 1 } };
    const execucoes: Record<string, ExecucaoDoLab> = {};
    tipos.forEach((_, i) => (execucoes[`c${i}`] = ex(`c${i}`, "pronto", { imagens })));
    montar({ canvas, execucoes });
    tipos.forEach((t, i) => expect(no(`c${i}`).querySelector("[data-acoes-da-imagem]"), t).not.toBeNull());
  });
});

describe("contrato final do motor da casa", () => {
  it("Resultado e Carrossel 'aguardando' no estudio_arte: no_acompanhar e 'No motor' com o tempo", () => {
    const aguardando = ex("i1", "aguardando", { motor: "estudio_arte", etapa: "gerando", imagens: [] }, new Date(Date.now() - 20_000).toISOString());
    expect(precisaAcompanhar("imagem", aguardando)).toBe(true);
    expect(precisaAcompanhar("carrossel", ex("c1", "aguardando", { etapa: "gerando" }))).toBe(true);
    expect(precisaAcompanhar("imagem", ex("i1", "pronto", { motor: "estudio_arte" }))).toBe(false);
    montar({ canvas: umaImagem(), execucoes: { i1: aguardando } });
    expect(no("i1").querySelector('[data-estado-do-no="no_motor"]')).not.toBeNull();
    expect(no("i1").querySelector("[data-no-motor] [data-tempo-no-motor]")!.textContent).toMatch(/^\d+ s$/);
    const editor = readFileSync(resolve(__dirname, "../..", "src/components/laboratorio/EditorDoProjeto.tsx"), "utf8");
    expect(editor).toContain('const ESPERAM_DE_FORA = ["filme", "por_no_ar", "imagem", "carrossel"];');
  });

  it("ajustar confirmado responde 202 { execucao_id, status: 'rodando' }", async () => {
    m.chamar.mockImplementation(async (_f: string, corpo: any) => {
      if (corpo.acao !== "no_ajustar") return {};
      if (!corpo.confirmado) throw new ErroDaMesa("confirmacao_necessaria", "Confirme o custo.", { custo_usd: 0.04 });
      return { execucao_id: "e202", status: "rodando" };
    });
    const onNovaExecucao = vi.fn();
    montar({ canvas: umaImagem(), execucoes: { i1: ex("i1", "pronto", { imagens }) }, onNovaExecucao });
    fireEvent.click(no("i1").querySelector('[data-ajustar-imagem="0"]') as HTMLElement);
    fireEvent.change(within(no("i1")).getByLabelText("O que mudar na imagem 1"), { target: { value: "mais luz" } });
    fireEvent.click(no("i1").querySelector("[data-pedir-imagem]") as HTMLElement);
    await waitFor(() => expect(no("i1").querySelector("[data-confirmar-custo]")).not.toBeNull());
    fireEvent.click(within(no("i1").querySelector("[data-confirmar-custo]") as HTMLElement).getByText("Confirmar"));
    await waitFor(() => expect(onNovaExecucao).toHaveBeenCalled());
    expect(onNovaExecucao.mock.calls[0][1]).toMatchObject({ id: "e202", no_id: "i1", status: "rodando" });
  });

  it("o chip mostra o 'como' de saida.usou no title", () => {
    montar({ canvas: umaImagem(), execucoes: { i1: ex("i1", "pronto", { imagens, usou: [{ tipo: "marca", rotulo: "Marca", no_id: "mk", como: "cores e logo no canto" }] }) } });
    expect(no("i1").querySelector("[data-usando]")!.getAttribute("title")).toBe("Marca: cores e logo no canto");
  });

  it("salvar: sem cliente (400), sem imagem (409) e a pasta do Laboratório só confirma", async () => {
    m.chamar.mockImplementation(async (_f: string, corpo: any) => {
      if (corpo.acao !== "salvar_nos_arquivos") return {};
      if (corpo.destino === "cliente") throw new ErroDaMesa("sem_imagem", "Sem imagem pronta.");
      return { salvos: [{ nome: "x.png", path: "x", pasta: "Laboratório / Livres / Café" }] };
    });
    montar({ canvas: umaImagem(), execucoes: { i1: ex("i1", "pronto", { imagens }) } });
    fireEvent.click(within(no("i1")).getByLabelText("Salvar nos arquivos"));
    fireEvent.click(within(no("i1").querySelector("[data-menu-salvar]") as HTMLElement).getByText("Arquivos do cliente"));
    await waitFor(() => expect(m.toast.warning).toHaveBeenCalledWith("Ainda não há imagem pronta", expect.anything()));
    fireEvent.click(within(no("i1")).getByLabelText("Salvar nos arquivos"));
    fireEvent.click(within(no("i1").querySelector("[data-menu-salvar]") as HTMLElement).getByText("Pasta do Laboratório"));
    await waitFor(() => expect(m.toast.success).toHaveBeenCalledWith("Já está na pasta do Laboratório", { description: "Em Laboratório / Livres / Café" }));
    m.chamar.mockImplementation(async () => {
      throw new ErroDaMesa("sem_cliente", "Sem cliente.");
    });
    fireEvent.click(within(no("i1")).getByLabelText("Salvar nos arquivos"));
    fireEvent.click(within(no("i1").querySelector("[data-menu-salvar]") as HTMLElement).getByText("Arquivos do cliente"));
    await waitFor(() => expect(m.toast.warning).toHaveBeenCalledWith("Este projeto não tem cliente", expect.anything()));
  });

  it("escolha_a_marca no nó criativo: aviso e '+ Ligar Marca'; o nó Marca escolhe entre as marcas do cliente", () => {
    const erro = normalizarExecucao({ id: "e9", no_id: "i1", tipo: "imagem", status: "erro", erro: "escolha_a_marca: este cliente tem mais de uma marca", saida: {} })!;
    const fora = montar({ canvas: umaImagem(), execucoes: { i1: erro } });
    const aviso = no("i1").querySelector("[data-escolha-a-marca]") as HTMLElement;
    expect(aviso.textContent).toContain("Escolha a marca no nó Marca");
    fireEvent.click(aviso.querySelector("[data-ligar-marca]") as HTMLElement);
    const marca = fora.canvas.nos.find((n) => n.tipo === "marca")!;
    expect(fora.canvas.ligacoes.some((l) => l.de === marca.id && l.para === "i1")).toBe(true);
    const escolha = no(marca.id).querySelector("[data-escolha-da-marca]") as HTMLElement;
    expect(escolha.textContent).toContain("Escolha qual marca vale aqui.");
    fireEvent.click(within(escolha).getByText("CME"));
    expect(fora.canvas.nos.find((n) => n.id === marca.id)!.dados.marca_id).toBe("mB");
  });

  it("nó solto do planejar: aviso discreto com o motivo no title, some quando ganha ligação", async () => {
    montar({ canvas: umaImagem() });
    act(() => {
      avisarNosSoltos(P, [{ no_id: "i1", tipo: "imagem", motivo: "Nenhum nó entrega texto para este Resultado." }]);
    });
    await waitFor(() => expect(no("i1").querySelector("[data-no-solto]")!.getAttribute("title")).toBe("Nenhum nó entrega texto para este Resultado."));
  });
});

describe("fila do motor", () => {
  it("'No motor' com o tempo decorrido; as imagens aparecem conforme chegam", () => {
    const desde = new Date(Date.now() - 65_000).toISOString();
    montar({ canvas: umaImagem(), execucoes: { i1: ex("i1", "rodando", { imagens: imagens.slice(0, 1) }, desde) } });
    const motor = no("i1").querySelector("[data-no-motor]") as HTMLElement;
    expect(motor.textContent).toContain("No motor · 1 pronta(s)");
    expect(motor.querySelector("[data-tempo-no-motor]")!.textContent).toMatch(/^1 min \d+ s$/);
    expect(no("i1").querySelectorAll("[data-imagem-gerada]")).toHaveLength(1);
  });
});

describe("cada nó se complementa", () => {
  const anuncio: CanvasDoLab = {
    nos: [
      { id: "cp", tipo: "copy", x: 0, y: 0, dados: {} },
      { id: "an", tipo: "anuncio", x: 400, y: 0, dados: {} },
      { id: "ar", tipo: "por_no_ar", x: 800, y: 0, dados: {} },
      { id: "im", tipo: "imagem", x: 0, y: 300, dados: { titulo: "Post do clube" } },
    ],
    ligacoes: [
      { id: "l1", de: "cp", para: "an" },
      { id: "l2", de: "an", para: "ar" },
      { id: "l3", de: "im", para: "ar" },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  it("chips do que o nó usa (antes de rodar pelas entradas; depois por saida.usou) e '+ Ligar' do que falta", () => {
    const antes = usandoDoNo(anuncio, { cp: ex("cp", "pronto", { texto: "Seu café" }) }, "an");
    expect(antes).toEqual([{ rotulo: "Copy", pronto: true, no_id: "cp" }]);
    const depois = usandoDoNo(anuncio, { an: ex("an", "pronto", { usou: [{ tipo: "marca", rotulo: "Marca", no_id: "mk" }, { tipo: "copy", rotulo: "Copy", no_id: "cp" }] }) }, "an");
    expect(depois.map((u) => u.rotulo)).toEqual(["Marca", "Copy"]);
    const sugestoes = sugestoesDoNo(anuncio, "an");
    expect(sugestoes.indexOf("copy")).toBe(-1);
    expect(sugestoes.length).toBeGreaterThan(0);

    const fora = montar({ canvas: anuncio, execucoes: { cp: ex("cp", "pronto", { texto: "Seu café" }) } });
    const chips = no("an").querySelectorAll("[data-usando]");
    expect(chips[0].textContent).toBe("Copy");
    expect(chips[0].getAttribute("title")).toBe("Usando: Copy");
    const sugestao = no("an").querySelector(`[data-sugestao="${sugestoes[0]}"]`) as HTMLElement;
    fireEvent.click(sugestao);
    const novo = fora.canvas.nos.find((n) => n.tipo === sugestoes[0] && n.id !== "im")!;
    expect(novo).toBeTruthy();
    expect(fora.canvas.ligacoes.some((l) => l.de === novo.id && l.para === "an")).toBe(true);
  });

  it("o Pôr no ar mostra o pacote montado: miniaturas e textos de tudo que chega", () => {
    const execucoes = {
      cp: ex("cp", "pronto", { texto: "Seu café, do jeito certo." }),
      an: ex("an", "pronto", { texto: "Clube do café: 1º mês com 20% off" }),
      im: ex("im", "pronto", { imagens }),
    };
    const pecas = pacoteDoNo(anuncio, execucoes, "ar");
    expect(pecas.map((p) => p.no_id).sort()).toEqual(["an", "cp", "im"]);
    expect(pecas.find((p) => p.no_id === "im")!.imagem).toMatchObject(imagens[0]);
    montar({ canvas: anuncio, execucoes });
    const pacote = no("ar").querySelector("[data-pacote-do-fluxo]") as HTMLElement;
    expect(pacote.textContent).toContain("3 de 3 prontas");
    expect(pacote.textContent).toContain("Clube do café: 1º mês com 20% off");
    expect(pacote.querySelector('[data-peca-do-pacote="im"] img')!.getAttribute("src")).toBe("https://img.test/1.png");
  });

  it("a saída normalizada guarda saida.usou", () => {
    const e = normalizarExecucao({ id: "e", no_id: "x", status: "pronto", saida: { usou: [{ tipo: "midia", rotulo: "Foto do produto", no_id: "m1" }, { lixo: true }] } })!;
    expect(e.saida.usou).toEqual([{ tipo: "midia", rotulo: "Foto do produto", no_id: "m1", como: "" }]);
  });
});
