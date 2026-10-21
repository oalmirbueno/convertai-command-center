import { useCallback, useRef, useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactFlowProvider, useStoreApi } from "@xyflow/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Nós completos (21/10, dono: "os nós estão soltos e crus"): canvas cinza e
 * tela cheia na pílula, Gerar com IA com custo e Desfazer, seletores no
 * lugar de texto (Cliente, Marca, Contexto, Referências, Agente,
 * Configuração), Mídia cheia/carrossel/vídeo/biblioteca, o automático e o
 * soltar a ligação no cartão de outro nó. As respostas da função são mock
 * (o contrato está em src/lib/laboratorio/api.ts).
 */

const m = vi.hoisted(() => ({ chamar: vi.fn(), upload: vi.fn() }));

vi.mock("@/lib/mesa/api", async (orig) => ({ ...(await orig<typeof import("@/lib/mesa/api")>()), chamarFuncao: m.chamar }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u1" } }) }));
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
          upload: m.upload,
          download: () => Promise.resolve({ data: null, error: new Error("sem arquivo") }),
          createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/x" }, error: null }),
          createSignedUrls: (caminhos: string[]) => Promise.resolve({ data: caminhos.map((p) => ({ path: p, signedUrl: `https://arquivo.test/${p}` })), error: null }),
        }),
      },
    },
  };
});

import QuadroDoLab from "@/components/laboratorio/QuadroDoLab";
import { alturaMinimaDoCanvas } from "@/components/laboratorio/EditorDoProjeto";
import { ErroDaMesa } from "@/lib/mesa/api";
import { TIPOS_DE_NO, ligar, podeLigar, type CanvasDoLab } from "@/lib/laboratorio/nos";
import { normalizarExecucao, normalizarFontes, type ExecucaoDoLab } from "@/lib/laboratorio/api";
import { estadoDoAuto, nosParaDisparar } from "@/lib/laboratorio/auto";
import { dadosDasMidias, midiasDe } from "@/components/laboratorio/no/MidiaDoNo";
import { resumoDoQueVai } from "@/components/laboratorio/no/CorpoEspecial";

const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8").replace(/\r\n/g, "\n");
const P = "aaaaaaaa-0000-4000-8000-000000000001";
const CLIENTE = "11111111-1111-4111-8111-111111111111";

const FONTES = {
  cliente: { id: CLIENTE, nome: "Café da Serra" },
  dossie: { resumo: "Cafeteria de torra própria em Curitiba.", pontos: ["Público 25 a 45", "Clube de assinatura"] },
  marca: { cores: ["#0f766e", "#f5f5f4"], fontes: ["Inter", "Playfair"], tom: "Acolhedor e direto", logo_url: "https://cdn.test/logo.png", nunca: ["Prometer cura"] },
  midias: [
    { id: "f1", tipo: "imagem", url: "https://cdn.test/f1.jpg", miniatura_url: "", nome: "Fachada", origem: "acervo" },
    { id: "v1", tipo: "video", url: "https://cdn.test/v1.mp4", miniatura_url: "https://cdn.test/v1.jpg", nome: "Bastidor", origem: "workspace" },
  ],
  documentos: [],
};

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
  m.upload.mockReset();
  m.upload.mockResolvedValue({ data: {}, error: null });
  m.chamar.mockImplementation(async (_f: string, corpo: any) => {
    if (corpo.acao === "fontes_do_cliente") return FONTES;
    if (corpo.acao === "estimar") return { por_no: [{ no_id: corpo.nos && corpo.nos[0], custo_usd: 0.04 }], total_usd: 0.04 };
    if (corpo.acao === "projeto_config") return { config: { auto_ate_usd: 0 } };
    if (corpo.acao === "conexoes_da_casa" && corpo.catalogo) return { produtos: [] };
    return {};
  });
});

const acoes = () => m.chamar.mock.calls.map((c) => c[1].acao as string);

function montar(o: { canvas: CanvasDoLab; execucoes?: Record<string, ExecucaoDoLab>; selecionado?: string | null; clienteId?: string | null; onRodarAutomatico?: (id: string) => void; onSoCanvas?: () => void }) {
  const fora = { canvas: o.canvas, loja: null as ReturnType<typeof useStoreApi> | null, mudarExecucoes: (_e: Record<string, ExecucaoDoLab>) => undefined as void };
  function Sonda() {
    fora.loja = useStoreApi();
    return null;
  }
  function Teste() {
    const [canvas, setCanvas] = useState<CanvasDoLab>(fora.canvas);
    const [execucoes, setExecucoes] = useState<Record<string, ExecucaoDoLab>>(o.execucoes || {});
    fora.mudarExecucoes = setExecucoes;
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
          execucoes={execucoes}
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
          clientes={[{ id: CLIENTE, nome: "Café da Serra" }]}
          antesDeChamar={() => Promise.resolve()}
          onRodarAutomatico={o.onRodarAutomatico}
          onSoCanvas={o.onSoCanvas}
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

const no = (id: string) => {
  const el = document.querySelector(`[data-no-do-quadro="${id}"]`);
  if (!el) throw new Error(`sem o nó ${id}`);
  return el as HTMLElement;
};
const umNo = (tipo: string, dados: Record<string, unknown> = {}, id = "n1"): CanvasDoLab => ({ nos: [{ id, tipo: tipo as any, x: 0, y: 0, dados }], ligacoes: [], viewport: { x: 0, y: 0, zoom: 1 } });
const execucao = (noId: string, status: string, id: string, quando = "2026-10-21T10:00:00Z") => normalizarExecucao({ id, no_id: noId, tipo: "agente", status, saida: {}, created_at: quando })!;

// ------------------------------------------------------------------ 1. canvas

describe("canvas: fundo cinza, 100% e tela cheia na pílula", () => {
  it("fundo pelos tokens do tema, altura de verdade 100% e o botão de tela cheia liga o só canvas", () => {
    const onSoCanvas = vi.fn();
    montar({ canvas: umNo("contexto"), onSoCanvas });
    const raiz = document.querySelector(".react-flow") as HTMLElement;
    expect(raiz.getAttribute("style") || "").toMatch(/--xy-background-color: hsl\(var\(--muted\)/);
    expect(alturaMinimaDoCanvas(900)).toBe(884);
    const pilula = screen.getByRole("toolbar", { name: "Controles do quadro" });
    fireEvent.click(within(pilula).getByRole("button", { name: "Tela cheia do canvas" }));
    expect(onSoCanvas).toHaveBeenCalled();
    expect(ler("src/components/laboratorio/EditorDoProjeto.tsx")).toContain("onSoCanvas={() => setSoCanvas(!soCanvas)}");
  });
});

// ------------------------------------------------------------------ 2. Gerar com IA

describe("Gerar com IA no nó", () => {
  it("mostra o custo (409), confirma com confirmado, aplica os dados e desfaz", async () => {
    m.chamar.mockImplementation(async (_f: string, corpo: any) => {
      if (corpo.acao !== "no_preencher") return {};
      if (!corpo.confirmado) throw new ErroDaMesa("confirmacao_necessaria", "Confirme o custo.", { error: "confirmacao_necessaria", custo_usd: 0.02 });
      return { dados: { texto: "Lançamento do clube de café em novembro." }, explicacao: "Contexto escrito a partir do dossiê.", custo_usd: 0.02 };
    });
    const fora = montar({ canvas: umNo("contexto", { texto: "rascunho" }) });
    fireEvent.click(within(no("n1")).getByLabelText("Gerar com IA"));
    fireEvent.change(within(no("n1")).getByLabelText("Pedido para a IA (opcional)"), { target: { value: "foco no clube" } });
    fireEvent.click(no("n1").querySelector("[data-pedir-gerar]") as HTMLElement);
    const confirmar = await waitFor(() => {
      const el = no("n1").querySelector("[data-confirmar-gerar]");
      if (!el) throw new Error("sem confirmação");
      return el as HTMLElement;
    });
    expect(confirmar.textContent).toContain("US$ 0,02");
    fireEvent.click(within(confirmar).getByText("Confirmar"));
    await waitFor(() => expect(fora.canvas.nos[0].dados.texto).toBe("Lançamento do clube de café em novembro."));
    const pedidos = m.chamar.mock.calls.filter((c) => c[1].acao === "no_preencher").map((c) => c[1]);
    expect(pedidos[0]).toMatchObject({ projeto_id: P, no_id: "n1", pedido: "foco no clube" });
    expect(pedidos[0].confirmado).toBeUndefined();
    expect(pedidos[1]).toMatchObject({ confirmado: true });
    fireEvent.click(no("n1").querySelector("[data-desfazer-ia]") as HTMLElement);
    expect(fora.canvas.nos[0].dados.texto).toBe("rascunho");
  });

  it("erro da função aparece claro no nó", async () => {
    m.chamar.mockImplementation(async (_f: string, corpo: any) => {
      if (corpo.acao === "no_preencher") throw new ErroDaMesa("acao_desconhecida", "Ação ainda não disponível no servidor.");
      return {};
    });
    montar({ canvas: umNo("copy") });
    fireEvent.click(within(no("n1")).getByLabelText("Gerar com IA"));
    fireEvent.click(no("n1").querySelector("[data-pedir-gerar]") as HTMLElement);
    await waitFor(() => expect(within(no("n1")).getByText("Ação ainda não disponível no servidor.")).toBeInTheDocument());
  });
});

// ------------------------------------------------------------------ 3. seletores

describe("seletores no lugar de texto", () => {
  it("Cliente: escolhe, lê o dossiê e 'Usar no nó' põe no foco", async () => {
    const fora = montar({ canvas: umNo("cliente"), clienteId: null });
    fireEvent.change(within(no("n1")).getByLabelText("Cliente"), { target: { value: CLIENTE } });
    expect(fora.canvas.nos[0].dados.client_id).toBe(CLIENTE);
    const dossie = await waitFor(() => {
      const el = no("n1").querySelector("[data-dossie-do-cliente]");
      if (!el) throw new Error("sem dossiê");
      return el as HTMLElement;
    });
    expect(dossie.textContent).toContain("Cafeteria de torra própria");
    fireEvent.click(dossie.querySelector("[data-usar-dossie]") as HTMLElement);
    expect(String(fora.canvas.nos[0].dados.foco)).toContain("Clube de assinatura");
    expect(m.chamar.mock.calls.find((c) => c[1].acao === "fontes_do_cliente")![1]).toEqual({ acao: "fontes_do_cliente", client_id: CLIENTE });
  });

  it("Marca: puxa cores (bolinhas), fontes, tom e logo, e as cores ficam editáveis por chips", async () => {
    const fora = montar({ canvas: umNo("marca") });
    fireEvent.click(no("n1").querySelector("[data-puxar-marca]") as HTMLElement);
    await waitFor(() => expect(fora.canvas.nos[0].dados.paleta).toBe("#0f766e, #f5f5f4"));
    expect(fora.canvas.nos[0].dados).toMatchObject({ fontes: "Inter, Playfair", tom: "Acolhedor e direto", regras: "Prometer cura" });
    await waitFor(() => expect(no("n1").querySelector("[data-logo-da-marca]")!.getAttribute("src")).toBe("https://cdn.test/logo.png"));
    const chips = no("n1").querySelectorAll("[data-chip]");
    expect(chips.length).toBe(4);
    fireEvent.click(within(no("n1")).getByLabelText("Tirar #f5f5f4"));
    expect(fora.canvas.nos[0].dados.paleta).toBe("#0f766e");
    fireEvent.change(within(no("n1")).getByLabelText("Cores"), { target: { value: "#111111" } });
    fireEvent.keyDown(within(no("n1")).getByLabelText("Cores"), { key: "Enter" });
    expect(fora.canvas.nos[0].dados.paleta).toBe("#0f766e, #111111");
  });

  it("Contexto: puxar dossiê, puxar da marca e ler documento entram no texto", async () => {
    m.chamar.mockImplementation(async (_f: string, corpo: any) => {
      if (corpo.acao === "fontes_do_cliente") return FONTES;
      if (corpo.acao === "ler_documento") return { texto: "Briefing: abrir em novembro.", resumo: "Abrir em novembro.", lido: true };
      return {};
    });
    const fora = montar({ canvas: umNo("contexto", { texto: "" }) });
    fireEvent.click(no("n1").querySelector("[data-puxar-dossie]") as HTMLElement);
    await waitFor(() => expect(String(fora.canvas.nos[0].dados.texto)).toContain("Cafeteria de torra própria"));
    fireEvent.click(no("n1").querySelector("[data-puxar-da-marca]") as HTMLElement);
    await waitFor(() => expect(String(fora.canvas.nos[0].dados.texto)).toContain("Tom: Acolhedor e direto"));
    const arquivo = new File(["oi"], "briefing.md", { type: "text/markdown" });
    fireEvent.change(no("n1").querySelector("[data-entrada-ler-documento]") as HTMLInputElement, { target: { files: [arquivo] } });
    await waitFor(() => expect(String(fora.canvas.nos[0].dados.texto)).toContain("Briefing: abrir em novembro."));
    expect(m.upload.mock.calls[0][0]).toMatch(new RegExp(`^global/laboratorio/${P}/entradas/`));
    const leitura = m.chamar.mock.calls.find((c) => c[1].acao === "ler_documento")![1];
    expect(leitura.projeto_id).toBe(P);
    expect(leitura.arquivo.path).toMatch(/briefing\.md$/);
    expect((fora.canvas.nos[0].dados.arquivos as any[])[0].nome).toBe("briefing.md");
  });

  it("Referências: links com prévia, colar link e buscar referências com IA", async () => {
    const fora = montar({ canvas: umNo("referencias", { links: "https://www.exemplo.com/oferta" }) });
    const previa = no("n1").querySelector("[data-previa-do-link]") as HTMLElement;
    expect(previa.textContent).toContain("exemplo.com");
    expect(previa.textContent).toContain("/oferta");
    fireEvent.change(within(no("n1")).getByLabelText("Colar link"), { target: { value: "https://outro.com" } });
    fireEvent.keyDown(within(no("n1")).getByLabelText("Colar link"), { key: "Enter" });
    expect(fora.canvas.nos[0].dados.links).toBe("https://www.exemplo.com/oferta\nhttps://outro.com");
    m.chamar.mockImplementation(async (_f: string, corpo: any) => (corpo.acao === "no_preencher" ? { dados: { links: "https://a.com" }, explicacao: "1 referência", custo_usd: 0 } : {}));
    fireEvent.click(no("n1").querySelector("[data-abrir-gerar]") as HTMLElement);
    fireEvent.click(no("n1").querySelector("[data-pedir-gerar]") as HTMLElement);
    await waitFor(() => expect(fora.canvas.nos[0].dados.links).toBe("https://a.com"));
    expect(m.chamar.mock.calls.find((c) => c[1].acao === "no_preencher")![1].campos).toEqual(["links", "o_que_aproveitar"]);
  });

  it("Agente: papel por chips, modelo no nó e 'Gerar instrução com IA' só na instrução", async () => {
    const fora = montar({ canvas: umNo("agente", { instrucao: "" }) });
    expect(within(no("n1")).getByLabelText("Modelo")).toBeInTheDocument();
    fireEvent.click(within(no("n1")).getByText("Copywriter"));
    expect(fora.canvas.nos[0].dados.papel).toBe("copywriter");
    expect(String(fora.canvas.nos[0].dados.instrucao)).toContain("copywriter");
    m.chamar.mockImplementation(async (_f: string, corpo: any) => (corpo.acao === "no_preencher" ? { dados: { instrucao: "Escreva 3 ganchos." }, explicacao: "", custo_usd: 0 } : {}));
    fireEvent.click(no("n1").querySelector("[data-corpo-agente] [data-abrir-gerar]") as HTMLElement);
    fireEvent.click(no("n1").querySelector("[data-corpo-agente] [data-pedir-gerar]") as HTMLElement);
    await waitFor(() => expect(fora.canvas.nos[0].dados.instrucao).toBe("Escreva 3 ganchos."));
    expect(m.chamar.mock.calls.find((c) => c[1].acao === "no_preencher")![1].campos).toEqual(["instrucao"]);
  });

  it("Configuração: proporção em formas, quantidade em stepper, qualidade em segmentos e o resumo do que vai", () => {
    const canvas: CanvasDoLab = {
      nos: [
        { id: "cf", tipo: "config", x: 0, y: 0, dados: { proporcao: "1:1", quantidade: 1, qualidade: "media" } },
        { id: "i1", tipo: "imagem", x: 400, y: 0, dados: { titulo: "Post do clube" } },
      ],
      ligacoes: [{ id: "l1", de: "cf", para: "i1" }],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const fora = montar({ canvas });
    const cf = no("cf");
    fireEvent.click(within(cf).getByLabelText("4:5 feed"));
    expect(fora.canvas.nos[0].dados.proporcao).toBe("4:5");
    fireEvent.click(within(cf).getAllByLabelText("Mais")[0]);
    expect(fora.canvas.nos[0].dados.quantidade).toBe(2);
    fireEvent.click(within(cf).getByText("Alta"));
    expect(fora.canvas.nos[0].dados.qualidade).toBe("alta");
    const resumo = cf.querySelector("[data-resumo-dos-ligados]") as HTMLElement;
    expect(resumo.textContent).toContain("4:5 feed · 2 imagens · qualidade alta");
    expect(resumo.textContent).toContain("Vai para: Post do clube");
    expect(resumoDoQueVai({ id: "g", tipo: "gravity", x: 0, y: 0, dados: { prompt_base: "Luz da manhã", referencias: [{ path: "a" }] } })).toBe('"Luz da manhã" · 1 referência(s)');
  });

  it("escolha curta vira segmentos e número vira stepper em qualquer tipo (ex.: Recuperação)", () => {
    const fora = montar({ canvas: umNo("recuperacao", { via: "email", toques: 1 }) });
    const rec = no("n1");
    expect(rec.querySelector("[data-segmentos]")).not.toBeNull();
    fireEvent.click(within(rec).getByText("WhatsApp"));
    expect(fora.canvas.nos[0].dados.via).toBe("whatsapp");
  });
});

// ------------------------------------------------------------------ 4. mídia

describe("Mídia no nó", () => {
  it("uma foto ocupa o nó inteiro; várias viram carrossel; vídeo toca no nó", async () => {
    const fora = montar({ canvas: umNo("midia", { midias: [{ id: "a", tipo: "imagem", url: "https://cdn.test/a.jpg", path: "", nome: "a" }] }) });
    const cheia = no("n1").querySelector("[data-midia-cheia]") as HTMLElement;
    expect(cheia.className).toContain("rounded-b-xl");
    expect(cheia.querySelector("[data-foto-do-no]")!.className).toContain("w-full");
    // Envia um vídeo: vai para o storage do projeto e toca no nó.
    const video = new File(["x"], "bastidor.mp4", { type: "video/mp4" });
    fireEvent.change(no("n1").querySelector("[data-entrada-de-midia]") as HTMLInputElement, { target: { files: [video] } });
    await waitFor(() => expect((fora.canvas.nos[0].dados.midias as any[]).length).toBe(2));
    expect((fora.canvas.nos[0].dados.midias as any[])[1]).toMatchObject({ tipo: "video", nome: "bastidor.mp4" });
    expect(m.upload.mock.calls[0][0]).toMatch(new RegExp(`^global/laboratorio/${P}/entradas/`));
    await waitFor(() => expect(no("n1").querySelector("[data-video-do-no]")).not.toBeNull());
    expect(no("n1").querySelector("[data-pontos-do-carrossel]")!.getAttribute("aria-label")).toBe("Mídia 2 de 2");
    fireEvent.click(within(no("n1")).getByLabelText("Mídia anterior"));
    expect(no("n1").querySelector("[data-foto-do-no]")).not.toBeNull();
    // A foto também vai para dados.imagens (o que a função lê hoje); o vídeo não.
    expect(fora.canvas.nos[0].dados.imagens).toEqual([{ path: "", url: "https://cdn.test/a.jpg", nome: "a", bucket: "workspace" }]);
  });

  it("biblioteca do cliente com abas Imagens e Vídeos", async () => {
    const fora = montar({ canvas: umNo("midia") });
    fireEvent.click(within(no("n1")).getByLabelText("Escolher da biblioteca do cliente"));
    const janela = await screen.findByRole("dialog");
    await waitFor(() => expect(janela.querySelector('[data-midia-da-biblioteca="f1"]')).not.toBeNull());
    fireEvent.click(janela.querySelector('[data-midia-da-biblioteca="f1"]') as HTMLElement);
    fireEvent.click(within(janela).getByRole("tab", { name: /Vídeos/ }));
    fireEvent.click(janela.querySelector('[data-midia-da-biblioteca="v1"]') as HTMLElement);
    fireEvent.click(within(janela).getByText("Adicionar 2"));
    await waitFor(() => expect((fora.canvas.nos[0].dados.midias as any[]).map((x) => x.id)).toEqual(["f1", "v1"]));
    expect((fora.canvas.nos[0].dados.midias as any[])[1]).toMatchObject({ tipo: "video", capa: "https://cdn.test/v1.jpg" });
  });

  it("midiasDe lê as imagens antigas; dadosDasMidias espelha só as fotos", () => {
    expect(midiasDe({ imagens: [{ path: "global/x.png" }] })).toEqual([{ id: "global/x.png", tipo: "imagem", url: "", path: "global/x.png", nome: "" }]);
    const d = dadosDasMidias([
      { id: "1", tipo: "imagem", url: "", path: "p.png", nome: "p" },
      { id: "2", tipo: "video", url: "", path: "v.mp4", nome: "v" },
    ]);
    expect((d.imagens as any[]).length).toBe(1);
    expect(normalizarFontes(FONTES).midias.map((x) => x.tipo)).toEqual(["imagem", "video"]);
  });
});

// ------------------------------------------------------------------ 5. automático

describe("clica, conecta e gera automático", () => {
  const base: CanvasDoLab = {
    nos: [
      { id: "a1", tipo: "agente", x: 0, y: 0, dados: {} },
      { id: "c1", tipo: "copy", x: 400, y: 0, dados: { auto: true } },
    ],
    ligacoes: [{ id: "l1", de: "a1", para: "c1" }],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  it("uma vez por mudança de entrada; abrir o projeto não roda nada", () => {
    const disparados: Record<string, string> = {};
    const rodando = { a1: execucao("a1", "rodando", "e1") };
    expect(nosParaDisparar(base, rodando, disparados, true)).toEqual([]);
    expect(estadoDoAuto(base, rodando, "c1")).toBe("aguardando");
    const pronto = { a1: execucao("a1", "pronto", "e1") };
    expect(nosParaDisparar(base, pronto, disparados)).toEqual(["c1"]);
    expect(nosParaDisparar(base, pronto, disparados)).toEqual([]);
    // A entrada rodou de novo: nova assinatura, dispara de novo (uma vez).
    const outra = { a1: execucao("a1", "pronto", "e2", "2026-10-21T11:00:00Z") };
    expect(nosParaDisparar(base, outra, disparados)).toEqual(["c1"]);
    // Abrir com tudo pronto: a primeira leitura só registra.
    expect(nosParaDisparar(base, outra, {}, true)).toEqual([]);
    // Em dia: já rodou depois da última entrada.
    expect(estadoDoAuto(base, { ...outra, c1: execucao("c1", "pronto", "e3", "2026-10-21T12:00:00Z") }, "c1")).toBe("em_dia");
  });

  it("no quadro: pílula 'Aguardando entradas', interruptor Automático e a chamada quando a entrada fica pronta", async () => {
    const onRodarAutomatico = vi.fn();
    const fora = montar({ canvas: base, execucoes: { a1: execucao("a1", "rodando", "e1") }, onRodarAutomatico });
    expect(no("c1").querySelector("[data-aguardando-entradas]")).not.toBeNull();
    expect(onRodarAutomatico).not.toHaveBeenCalled();
    act(() => fora.mudarExecucoes({ a1: execucao("a1", "pronto", "e1") }));
    await waitFor(() => expect(onRodarAutomatico).toHaveBeenCalledWith("c1"));
    expect(onRodarAutomatico).toHaveBeenCalledTimes(1);
    const interruptor = no("a1").querySelector('[data-auto-do-no="a1"]') as HTMLInputElement;
    fireEvent.click(interruptor);
    expect(fora.canvas.nos[0].dados.auto).toBe(true);
  });

  it("o editor chama no_executar com automatico e mostra o custo se a função pedir (409)", () => {
    const editor = ler("src/components/laboratorio/EditorDoProjeto.tsx");
    expect(editor).toContain("executarNoAutomatico(projetoId, id)");
    expect(editor).toContain("onRodarAutomatico={rodarAutomatico}");
    expect(ler("src/lib/laboratorio/api.ts")).toContain('chamar("no_executar", { projeto_id: projetoId, no_id: noId, automatico: true })');
  });

  it("teto do projeto: 'Rodar sozinho até US$ X por nó' (0 a 5) na pílula", async () => {
    montar({ canvas: umNo("contexto") });
    fireEvent.click(screen.getByRole("button", { name: "Rodar sozinho até" }));
    const campo = (await screen.findByLabelText("Rodar sozinho até (US$ por nó)")) as HTMLInputElement;
    fireEvent.change(campo, { target: { value: "9" } });
    fireEvent.click(screen.getByText("Salvar"));
    await waitFor(() => expect(m.chamar.mock.calls.some((c) => c[1].acao === "projeto_config" && c[1].config && c[1].config.auto_ate_usd === 5)).toBe(true));
  });
});

// ------------------------------------------------------------------ 6. rodapé e resultado

describe("nó com cara de completo", () => {
  it("rodapé com custo estimado (selecionado) e Rodar; resultado de texto com copiar", async () => {
    const ex = normalizarExecucao({ id: "e1", no_id: "c1", tipo: "copy", status: "pronto", saida: { texto: "Seu café, do jeito certo." }, custo_usd: 0.01 })!;
    montar({ canvas: umNo("copy", {}, "c1"), execucoes: { c1: ex }, selecionado: "c1" });
    await waitFor(() => expect(no("c1").querySelector("[data-custo-do-no]")!.textContent).toContain("US$ 0,04"));
    expect(acoes()).toContain("estimar");
    expect(no("c1").querySelector('[data-rodar-no-rodape="c1"]')).not.toBeNull();
    expect(no("c1").querySelector("[data-copiar-texto]")).not.toBeNull();
  });

  it("todos os tipos abrem; mídia, vídeo e biblioteca nativa não prometem geração por IA", () => {
    const tipos = Object.keys(TIPOS_DE_NO);
    expect(tipos.length).toBeGreaterThanOrEqual(47);
    const canvas: CanvasDoLab = { nos: tipos.map((t, i) => ({ id: `n${i}`, tipo: t as any, x: (i % 8) * 400, y: Math.floor(i / 8) * 600, dados: {} })), ligacoes: [], viewport: { x: 0, y: 0, zoom: 1 } };
    montar({ canvas });
    tipos.forEach((t, i) => {
      const el = no(`n${i}`);
      const tem = !!el.querySelector(`[data-varinha-do-no="n${i}"]`);
      expect(tem, t).toBe(!["midia", "video", "area_membros"].includes(t));
    });
  });

  it("estrutura para plataforma externa mantém geração por IA, diferente da biblioteca nativa", () => {
    montar({ canvas: umNo("area_membros", { plataforma: "hotmart_club" }) });
    expect(within(no("n1")).getByLabelText("Gerar com IA")).toBeInTheDocument();
    expect(within(no("n1")).getByLabelText("Modelo")).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------ 7. ligar soltando no cartão

describe("soltar a ligação no cartão de outro nó liga", () => {
  it("o aoTerminarLigacao pega o nó pelo data-id e liga (sem precisar da bolinha)", async () => {
    const canvas: CanvasDoLab = {
      nos: [
        { id: "c1", tipo: "contexto", x: 0, y: 0, dados: {} },
        { id: "a1", tipo: "agente", x: 400, y: 0, dados: {} },
      ],
      ligacoes: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const fora = montar({ canvas });
    await waitFor(() => expect(fora.loja).not.toBeNull());
    const fim = fora.loja!.getState().onConnectEnd as (e: MouseEvent, s: unknown) => void;
    expect(typeof fim).toBe("function");
    const alvo = no("a1").querySelector("[data-corpo-do-no]") as HTMLElement;
    act(() => {
      fim({ target: alvo, clientX: 500, clientY: 100 } as unknown as MouseEvent, { isValid: false, toNode: null, fromNode: { id: "c1" }, fromHandle: { type: "source" } });
    });
    expect(fora.canvas.ligacoes).toEqual([expect.objectContaining({ de: "c1", para: "a1" })]);
    // Saindo da entrada, liga invertido.
    act(() => {
      fim({ target: no("c1"), clientX: 10, clientY: 10 } as unknown as MouseEvent, { isValid: false, toNode: null, fromNode: { id: "a1" }, fromHandle: { type: "target" } });
    });
    expect(fora.canvas.ligacoes).toHaveLength(1);
  });
});
