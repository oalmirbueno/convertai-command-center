import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Casca do editor de projetos do Laboratório (21/10/2026, pedido do dono):
 * perguntas primeiro (a etapa grande no lugar do canvas, opção que preenche a
 * pergunta certa, conversa livre, Seguir manda `respostas`, Pular manda
 * `pular_perguntas`), altura do canvas que nunca fica pequena, Canvas Studio
 * recolhível e lembrado, tela cheia de verdade (cobre a janela, casca some em
 * qualquer largura, "só o canvas" com a mini barra, Esc sai na ordem certa),
 * Excluir projeto com confirmação (editor e lista) e a lista com busca e filtro.
 */

const m = vi.hoisted(() => ({ chamar: vi.fn() }));

vi.mock("@/lib/mesa/api", async (orig) => ({ ...(await orig<typeof import("@/lib/mesa/api")>()), chamarFuncao: m.chamar }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u1" } }) }));
vi.mock("@/hooks/useSupabaseData", () => ({ useClients: () => ({ data: [], isLoading: false }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/laboratorio/estudio-livre/EstudioLivre", () => ({ default: () => <div data-testid="estudio-livre" /> }));
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
      auth: { getSession: async () => ({ data: { session: null } }) },
      channel: () => {
        const canal: any = { on: () => canal, subscribe: () => canal };
        return canal;
      },
      removeChannel: () => undefined,
      storage: {
        from: () => ({
          upload: vi.fn(),
          download: () => Promise.resolve({ data: null, error: new Error("sem arquivo") }),
          createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/x" }, error: null }),
          createSignedUrls: () => Promise.resolve({ data: [], error: null }),
        }),
      },
    },
  };
});

import Laboratorio from "@/pages/Laboratorio";
import EditorDoProjeto, { alturaMinimaDoCanvas } from "@/components/laboratorio/EditorDoProjeto";
import { filtrarProjetos, opcoesDoFiltro } from "@/components/laboratorio/AbaProjetos";
import { dataCurta } from "@/components/laboratorio/CartaoDeProjeto";
import { normalizarProjeto, type ProjetoDoLab } from "@/lib/laboratorio/api";
import { montarRespostas } from "@/lib/laboratorio/respostasDasPerguntas";
import type { CanvasDoLab } from "@/lib/laboratorio/nos";
import { perguntasQueFaltam } from "../../supabase/functions/laboratorio/modulos/regras";
import { motivoDoProjetoEmUso } from "../../supabase/functions/laboratorio/modulos/exclusao";
import { ErroDaMesa } from "@/lib/mesa/api";

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
  if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => {};
  if (!(Element.prototype as any).hasPointerCapture) (Element.prototype as any).hasPointerCapture = () => false;
});

const PROJETO = "aaaaaaaa-0000-4000-8000-000000000001";
const CLIENTE_A = "cccccccc-0000-4000-8000-00000000000a";
const CLIENTE_B = "cccccccc-0000-4000-8000-00000000000b";
const vazio = (): CanvasDoLab => ({ nos: [], ligacoes: [], viewport: { x: 0, y: 0, zoom: 1 } });
const comNos = (): CanvasDoLab => ({ nos: [{ id: "c1", tipo: "contexto", x: 80, y: 80, dados: { titulo: "Contexto" } }], ligacoes: [], viewport: { x: 0, y: 0, zoom: 1 } });
const projeto = (extra: Record<string, unknown> = {}) => ({ id: PROJETO, nome: "Café", client_id: null, canvas: vazio(), versao: 1, status: "ativo", updated_at: "2026-10-20T10:00:00Z", ...extra });
const PERGUNTAS = perguntasQueFaltam("Quero montar um produto low ticket do zero", null);

function funcao(trocas: Record<string, (corpo: any) => unknown> = {}) {
  m.chamar.mockImplementation(async (f: string, corpo: any) => {
    if (f !== "laboratorio") return {};
    if (trocas[corpo.acao]) return trocas[corpo.acao](corpo);
    switch (corpo.acao) {
      case "projetos_listar":
        return { projetos: [] };
      case "templates_listar":
        return { templates: [] };
      case "projeto_ler":
        return { projeto: projeto(), cliente_nome: null, execucoes: {} };
      case "projeto_criar":
        return { projeto: projeto({ id: "bbbbbbbb-0000-4000-8000-000000000002", nome: corpo.nome }) };
      case "projeto_salvar":
        return { projeto: projeto({ canvas: corpo.canvas, versao: (corpo.versao_esperada || 0) + 1 }) };
      case "execucoes_ler":
        return { execucoes: [] };
      case "projeto_excluir":
        return { excluido: true, projeto_id: corpo.projeto_id };
      case "projeto_arquivar":
        return { projeto: projeto({ id: corpo.projeto_id, status: "arquivado" }) };
      default:
        return {};
    }
  });
}

const corpos = (acao: string) => m.chamar.mock.calls.filter((c) => c[0] === "laboratorio" && c[1].acao === acao).map((c) => c[1]);

function montarEditor(onVoltar: () => void = () => undefined) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <EditorDoProjeto projetoId={PROJETO} clientes={[]} onVoltar={onVoltar} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

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

const achar = (seletor: string) =>
  waitFor(() => {
    const el = document.querySelector(seletor);
    if (!el) throw new Error(`sem ${seletor}`);
    return el as HTMLElement;
  });

const editor = () => achar(`[data-editor-do-projeto="${PROJETO}"]`);

beforeEach(() => {
  m.chamar.mockReset();
  funcao();
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

afterEach(() => {
  document.body.removeAttribute("data-modo-foco");
});

// ------------------------------------------------------------------ perguntas primeiro

describe("Perguntas primeiro", () => {
  it("montarRespostas: uma linha por pergunta respondida e a conversa livre junto", () => {
    const ps = [
      { id: "produto", pergunta: "Qual é o produto?", exemplos: [] },
      { id: "publico", pergunta: "Para quem?", exemplos: [] },
      { id: "x_livre", pergunta: "Algo mais? Conte", exemplos: [] },
    ];
    expect(montarRespostas(ps, { publico: "  Donos de bar ", produto: "" }, "")).toBe("Público: Donos de bar");
    expect(montarRespostas(ps, { produto: "Curso", x_livre: "sim" }, "quero vender rápido\nno Instagram")).toBe("Produto: Curso\nAlgo mais: sim\nConversa livre: quero vender rápido\nno Instagram");
    expect(montarRespostas(ps, {}, "   ")).toBe("");
  });

  it("a função pergunta: abre SÓ a etapa grande (sem canvas embaixo); a opção preenche a pergunta certa; Seguir manda as respostas e o canvas volta inteiro com a construção", async () => {
    funcao({
      planejar: (c) => {
        if (!c.respostas && !c.pular_perguntas) return { resposta: "Antes de montar, me diga o essencial.", perguntas: PERGUNTAS, operacoes: [], canvas_previsto: vazio(), versao: 1, modo: "projeto_completo", colunas: [] };
        return {
          resposta: "Montei.",
          operacoes: [{ indice: 0, op: "criar", aceita: true, recibo: "Criei Avatar.", operacao: { op: "criar", ref: "no_avatar_1", tipo: "avatar", dados: { titulo: "Avatar" }, x: 80, y: 120 } }],
          canvas_previsto: { nos: [{ id: "no_avatar_1", tipo: "avatar", x: 80, y: 120, dados: { titulo: "Avatar" } }], ligacoes: [], viewport: { x: 0, y: 0, zoom: 1 } },
          versao: 1,
          modo: "projeto_completo",
          colunas: [],
        };
      },
    });
    montarEditor();
    const studio = await achar("[data-canvas-studio]");
    expect(document.querySelector("[data-area-do-quadro]")).not.toBeNull();
    fireEvent.change(within(studio).getByLabelText("Pedido para o Canvas Studio"), { target: { value: "Quero montar um produto low ticket do zero" } });
    fireEvent.click(within(studio).getByRole("button", { name: "Enviar o pedido" }));

    const etapa = await achar("[data-etapa-das-perguntas]");
    // Só a etapa: sem o quadro, sem a caixa do Studio e sem o botão de "só o canvas".
    expect(document.querySelector("[data-area-do-quadro]")).toBeNull();
    expect(document.querySelector("[data-corpo-do-editor]")).toBeNull();
    expect(screen.queryByLabelText("Pedido para o Canvas Studio")).toBeNull();
    expect(screen.queryByRole("button", { name: "Canvas em tela cheia" })).toBeNull();
    expect(etapa.className).toMatch(/min-h-\[70vh\]/);
    expect(Array.prototype.map.call(etapa.querySelectorAll("[data-pergunta]"), (e: Element) => e.getAttribute("data-pergunta"))).toEqual(PERGUNTAS.map((p) => p.id));
    // Cada pergunta tem o seu campo.
    PERGUNTAS.forEach((p) => expect(etapa.querySelector(`[data-resposta="${p.id}"]`)).not.toBeNull());

    // A opção preenche a resposta DAQUELA pergunta (e só dela); nada vai para a função ainda.
    const publico = PERGUNTAS.find((p) => p.id === "publico")!;
    const outra = PERGUNTAS.find((p) => p.id !== "publico" && p.exemplos.length)!;
    const opcao = within(etapa.querySelector('[data-pergunta="publico"]') as HTMLElement).getByRole("button", { name: publico.exemplos[0] });
    fireEvent.click(opcao);
    expect((etapa.querySelector('[data-resposta="publico"]') as HTMLInputElement).value).toBe(publico.exemplos[0]);
    expect(opcao.getAttribute("aria-pressed")).toBe("true");
    PERGUNTAS.filter((p) => p.id !== "publico").forEach((p) => expect((etapa.querySelector(`[data-resposta="${p.id}"]`) as HTMLInputElement).value).toBe(""));
    expect(corpos("planejar")).toHaveLength(1);
    // Outra opção, em outra pergunta, não mexe na primeira.
    fireEvent.click(within(etapa.querySelector(`[data-pergunta="${outra.id}"]`) as HTMLElement).getByRole("button", { name: outra.exemplos[0] }));
    expect((etapa.querySelector('[data-resposta="publico"]') as HTMLInputElement).value).toBe(publico.exemplos[0]);
    // Campo livre de uma pergunta troca o texto dela.
    fireEvent.change(etapa.querySelector('[data-resposta="preco"]') ?? etapa.querySelector(`[data-resposta="${outra.id}"]`)!, { target: { value: "R$ 47" } });
    // Conversa livre vai junto.
    fireEvent.change(within(etapa).getByLabelText(/conversar de outro jeito/), { target: { value: "Vendo pelo Instagram" } });

    fireEvent.click(within(etapa).getByRole("button", { name: "Seguir" }));
    await waitFor(() => expect(corpos("planejar")).toHaveLength(2));
    const enviado = corpos("planejar")[1];
    expect(enviado).toMatchObject({ mensagem: "Quero montar um produto low ticket do zero", modo: "projeto_completo" });
    expect(enviado).not.toHaveProperty("pular_perguntas");
    expect(enviado.respostas).toContain(`Público: ${publico.exemplos[0]}`);
    expect(enviado.respostas).toContain("R$ 47");
    expect(enviado.respostas).toMatch(/Conversa livre: Vendo pelo Instagram$/);

    // Montado: a etapa sai e o canvas volta inteiro, com o nó novo (a construção).
    await waitFor(() => expect(document.querySelector("[data-etapa-das-perguntas]")).toBeNull());
    expect(document.querySelector("[data-area-do-quadro]")).not.toBeNull();
    await waitFor(() => expect(corpos("projeto_salvar").length).toBeGreaterThan(0), { timeout: 6000 });
    expect((corpos("projeto_salvar")[0].canvas as CanvasDoLab).nos.map((n) => n.tipo)).toEqual(["avatar"]);
  }, 30000);

  it("Pular manda pular_perguntas; fechar volta ao canvas com o pedido na caixa; Seguir sem resposta fica desligado", async () => {
    funcao({
      planejar: (c) => (c.pular_perguntas ? { resposta: "Montei assim mesmo.", operacoes: [], canvas_previsto: vazio(), versao: 1, modo: "projeto_completo" } : { resposta: "", perguntas: PERGUNTAS, operacoes: [], canvas_previsto: vazio(), versao: 1, modo: "projeto_completo" }),
    });
    montarEditor();
    const studio = await achar("[data-canvas-studio]");
    fireEvent.change(within(studio).getByLabelText("Pedido para o Canvas Studio"), { target: { value: "Quero montar uma empresa do zero" } });
    fireEvent.click(within(studio).getByRole("button", { name: "Enviar o pedido" }));
    let etapa = await achar("[data-etapa-das-perguntas]");
    expect((within(etapa).getByRole("button", { name: "Seguir" }) as HTMLButtonElement).disabled).toBe(true);

    // Fechar: o canvas volta e o pedido de antes fica na caixa.
    fireEvent.click(within(etapa).getByRole("button", { name: "Fechar as perguntas" }));
    await waitFor(() => expect(document.querySelector("[data-area-do-quadro]")).not.toBeNull());
    expect((screen.getByLabelText("Pedido para o Canvas Studio") as HTMLTextAreaElement).value).toBe("Quero montar uma empresa do zero");

    fireEvent.click(screen.getByRole("button", { name: "Enviar o pedido" }));
    etapa = await achar("[data-etapa-das-perguntas]");
    fireEvent.click(within(etapa).getByRole("button", { name: "Pular e montar assim mesmo" }));
    await waitFor(() => expect(corpos("planejar")).toHaveLength(3));
    expect(corpos("planejar")[2]).toMatchObject({ pular_perguntas: true, modo: "projeto_completo", mensagem: "Quero montar uma empresa do zero" });
    expect(corpos("planejar")[2]).not.toHaveProperty("respostas");
    await waitFor(() => expect(document.querySelector("[data-etapa-das-perguntas]")).toBeNull());
  }, 30000);

  it("Início: atalho de projeto completo já pergunta e abre SÓ a etapa grande; Seguir cria o projeto com as respostas; atalho comum só preenche", async () => {
    funcao({ perguntas_do_pedido: () => ({ perguntas: PERGUNTAS, fonte: "jev", custo_usd: 0 }) });
    montarPagina();
    const caixa = (await screen.findByLabelText("Pedido para o Laboratório")) as HTMLTextAreaElement;
    // Atalho comum: só preenche.
    fireEvent.click(screen.getByRole("button", { name: "Carrossel" }));
    expect(caixa.value).toContain("carrossel");
    expect(corpos("perguntas_do_pedido")).toHaveLength(0);
    // Atalho de projeto completo: pergunta na hora.
    fireEvent.click(screen.getByRole("button", { name: "Montar empresa" }));
    const etapa = await achar("[data-etapa-das-perguntas]");
    expect(corpos("perguntas_do_pedido")[0].pedido).toMatch(/montar uma empresa/);
    expect(screen.queryByLabelText("Pedido para o Laboratório")).toBeNull();
    expect(document.querySelector("[data-inicio-lado-a-lado]")).toBeNull();
    const publico = PERGUNTAS.find((p) => p.id === "publico")!;
    fireEvent.click(within(etapa.querySelector('[data-pergunta="publico"]') as HTMLElement).getByRole("button", { name: publico.exemplos[0] }));
    fireEvent.change(within(etapa).getByLabelText(/conversar de outro jeito/), { target: { value: "Café especial em Curitiba" } });
    fireEvent.click(within(etapa).getByRole("button", { name: "Seguir" }));
    await waitFor(() => expect(corpos("projeto_criar")).toHaveLength(1));
    expect(corpos("projeto_criar")[0].contexto).toContain(`Público: ${publico.exemplos[0]}`);
    expect(corpos("projeto_criar")[0].contexto).toContain("Conversa livre: Café especial em Curitiba");
    expect(corpos("pedido_inicio")).toHaveLength(0);
  }, 30000);

  it("Canvas Studio: atalho de projeto completo já manda o planejar e abre a etapa das perguntas; atalho comum só preenche", async () => {
    funcao({ planejar: () => ({ resposta: "", perguntas: PERGUNTAS, operacoes: [], canvas_previsto: vazio(), versao: 1, modo: "projeto_completo" }) });
    montarEditor();
    const studio = await achar("[data-canvas-studio]");
    const atalhos = within(studio).getByRole("group", { name: "Atalhos do Canvas Studio" });
    fireEvent.click(within(atalhos).getByRole("button", { name: "Carrossel" }));
    expect((within(studio).getByLabelText("Pedido para o Canvas Studio") as HTMLTextAreaElement).value).toContain("carrossel");
    expect(corpos("planejar")).toHaveLength(0);
    fireEvent.click(within(atalhos).getByRole("button", { name: "Produto low ticket" }));
    await waitFor(() => expect(corpos("planejar")).toHaveLength(1));
    expect(corpos("planejar")[0]).toMatchObject({ modo: "projeto_completo" });
    expect(corpos("planejar")[0].mensagem).toContain("low ticket");
    await achar("[data-etapa-das-perguntas]");
    expect(document.querySelector("[data-area-do-quadro]")).toBeNull();
  }, 30000);
});

// ------------------------------------------------------------------ altura e Studio recolhível

describe("Altura do canvas e Canvas Studio recolhível", () => {
  const alturaOriginal = window.innerHeight;
  const rectOriginal = Element.prototype.getBoundingClientRect;
  afterEach(() => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: alturaOriginal });
    Element.prototype.getBoundingClientRect = rectOriginal;
  });

  it("o piso é 70% da janela (nunca menos de 420 px)", () => {
    expect(alturaMinimaDoCanvas(1000)).toBe(700);
    expect(alturaMinimaDoCanvas(844)).toBe(591);
    expect(alturaMinimaDoCanvas(500)).toBe(420);
  });

  it("recolher o Studio vira uma linha fina, o canvas ganha a altura (medida de novo) e a escolha é lembrada", async () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1000 });
    // O topo do canvas desce com o Studio aberto (240 px) e sobe com ele recolhido (100 px).
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const r = rectOriginal.call(this);
      if (this.hasAttribute && this.hasAttribute("data-corpo-do-editor")) {
        const top = document.querySelector("[data-studio-recolhido]") ? 100 : 240;
        return { ...r, top, y: top, toJSON: () => null } as DOMRect;
      }
      return r;
    } as typeof Element.prototype.getBoundingClientRect;

    const r = montarEditor();
    const corpo = await achar("[data-corpo-do-editor]");
    await waitFor(() => expect(corpo.style.height).toBe("744px"));

    fireEvent.click(screen.getByRole("button", { name: "Recolher o Canvas Studio" }));
    await achar("[data-studio-recolhido]");
    expect(screen.queryByLabelText("Pedido para o Canvas Studio")).toBeNull();
    await waitFor(() => expect((document.querySelector("[data-corpo-do-editor]") as HTMLElement).style.height).toBe("884px"));

    // Lembrado: abre de novo recolhido.
    await new Promise((ok) => setTimeout(ok, 400));
    r.unmount();
    montarEditor();
    await achar("[data-studio-recolhido]");
    fireEvent.click(screen.getByRole("button", { name: "Abrir o Canvas Studio" }));
    expect(await screen.findByLabelText("Pedido para o Canvas Studio")).toBeInTheDocument();
    await waitFor(() => expect((document.querySelector("[data-corpo-do-editor]") as HTMLElement).style.height).toBe("744px"));
  }, 30000);
});

// ------------------------------------------------------------------ tela cheia

describe("Tela cheia de verdade", () => {
  it("cobre a janela inteira sem borda (sem p-3), com a área segura, e a casca some em qualquer largura", async () => {
    montarEditor();
    const el = await editor();
    fireEvent.click(await screen.findByRole("button", { name: "Tela cheia" }));
    expect(el.className).toMatch(/fixed inset-0 z-40/);
    expect(el.className).not.toMatch(/(^|\s)p-3(\s|$)/);
    // Sem a margem do space-y da página (empurrava 24 px para baixo) e sem a rolagem da página (barra à direita).
    expect(el.className).toMatch(/(^|\s)!m-0(\s|$)/);
    expect(document.documentElement.style.overflow).toBe("hidden");
    // Área segura do iPhone (o jsdom não entende env(): confere no código).
    expect(ler("src/components/laboratorio/EditorDoProjeto.tsx")).toContain('paddingTop: "env(safe-area-inset-top)"');
    expect(document.body.getAttribute("data-modo-foco")).toBe("laboratorio-canvas");
    // O CSS da tela cheia do Lab esconde topo, barra de baixo e o que flutua SEM media query (vale no celular).
    const css = ler("src/components/laboratorio/telaCheiaDoLab.css");
    expect(css).toContain('body[data-modo-foco^="laboratorio"] [data-casca="topo"]');
    expect(css).toContain('body[data-modo-foco^="laboratorio"] [data-casca="rodape"]');
    expect(css).toContain('body[data-modo-foco^="laboratorio"] [data-casca="flutuante"]');
    expect(css).not.toMatch(/@media/);
    expect(ler("src/components/laboratorio/EditorDoProjeto.tsx")).toContain('import "./telaCheiaDoLab.css";');
    expect(ler("src/pages/Laboratorio.tsx")).toContain('import "@/components/laboratorio/telaCheiaDoLab.css";');
    fireEvent.click(screen.getByRole("button", { name: "Sair da tela cheia" }));
    expect(el.className).not.toMatch(/fixed inset-0/);
    expect(document.body.hasAttribute("data-modo-foco")).toBe(false);
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("canvas em tela cheia: só o quadro de ponta a ponta, mini barra (sair, Studio, Rodar tudo); Esc sai do só-canvas antes da tela cheia", async () => {
    funcao({ projeto_ler: () => ({ projeto: projeto({ canvas: comNos() }), cliente_nome: null, execucoes: {} }), estimar: () => ({ por_no: [{ no_id: "c1", tipo: "contexto", custo_usd: 0 }], total_usd: 0, ordem: ["c1"] }) });
    montarEditor();
    const el = await editor();
    fireEvent.click(await screen.findByRole("button", { name: "Tela cheia" }));
    fireEvent.click(screen.getByRole("button", { name: "Canvas em tela cheia" }));
    expect(el.hasAttribute("data-so-canvas")).toBe(true);
    expect(el.className).toMatch(/fixed inset-0/);
    expect((document.querySelector("[data-topo-do-editor]") as HTMLElement).className).toMatch(/(^|\s)hidden(\s|$)/);
    const area = document.querySelector("[data-area-do-quadro]") as HTMLElement;
    expect(area.className).not.toMatch(/border/);
    const barra = within(screen.getByRole("toolbar", { name: "Barra do canvas em tela cheia" }));
    expect(barra.getByRole("button", { name: "Sair do canvas em tela cheia" })).toBeInTheDocument();
    expect(barra.getByRole("button", { name: "Abrir o Canvas Studio" })).toBeInTheDocument();
    fireEvent.click(barra.getByRole("button", { name: "Rodar tudo" }));
    await waitFor(() => expect(corpos("estimar")).toHaveLength(1));
    // Com a janela do custo aberta, o Esc é dela: nada sai.
    await screen.findByRole("dialog");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(el.hasAttribute("data-so-canvas")).toBe(true);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Esc: primeiro sai do só-canvas (a tela cheia fica), depois da tela cheia.
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(el.hasAttribute("data-so-canvas")).toBe(false));
    expect(el.className).toMatch(/fixed inset-0/);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(el.className).not.toMatch(/fixed inset-0/));
    expect(document.body.hasAttribute("data-modo-foco")).toBe(false);
  }, 30000);

  it("só o canvas sem a tela cheia antes: cobre a janela; Abrir o Canvas Studio volta com a caixa aberta", async () => {
    montarEditor();
    const el = await editor();
    fireEvent.click(screen.getByRole("button", { name: "Recolher o Canvas Studio" }));
    await achar("[data-studio-recolhido]");
    fireEvent.click(screen.getByRole("button", { name: "Canvas em tela cheia" }));
    expect(el.className).toMatch(/fixed inset-0/);
    expect(document.body.getAttribute("data-modo-foco")).toBe("laboratorio-canvas");
    fireEvent.click(within(screen.getByRole("toolbar", { name: "Barra do canvas em tela cheia" })).getByRole("button", { name: "Abrir o Canvas Studio" }));
    await waitFor(() => expect(el.hasAttribute("data-so-canvas")).toBe(false));
    expect(el.className).not.toMatch(/fixed inset-0/);
    expect(await screen.findByLabelText("Pedido para o Canvas Studio")).toBeInTheDocument();
  });

  it("na página: o Esc do editor não derruba as duas coisas de uma vez", async () => {
    montarPagina(`/laboratorio?aba=projetos&projeto=${PROJETO}`);
    const el = await editor();
    fireEvent.click(await screen.findByRole("button", { name: "Tela cheia" }));
    fireEvent.click(screen.getByRole("button", { name: "Canvas em tela cheia" }));
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(el.hasAttribute("data-so-canvas")).toBe(false));
    expect(document.querySelector("[data-pagina-laboratorio]")!.hasAttribute("data-tela-cheia")).toBe(true);
    expect(el.className).toMatch(/fixed inset-0/);
  });
});

// ------------------------------------------------------------------ excluir

describe("Excluir projeto", () => {
  it("no menu do editor: confirmação com o nome e o aviso; só exclui no confirmar e volta à lista", async () => {
    const voltar = vi.fn();
    montarEditor(voltar);
    const mais = await screen.findByRole("button", { name: "Mais ações do projeto" });
    await waitFor(() => expect((screen.getByLabelText("Nome do projeto") as HTMLInputElement).value).toBe("Café"));
    fireEvent.keyDown(mais, { key: "Enter" });
    expect(await screen.findByRole("menuitem", { name: /Arquivar o projeto/ })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("menuitem", { name: /Excluir projeto/ }));
    let janela = await screen.findByRole("dialog");
    expect(within(janela).getByText("Café")).toBeInTheDocument();
    expect(janela.textContent).toMatch(/não voltam/);
    expect(janela.textContent).toMatch(/continuam em Arquivos/);
    // Cancelar não exclui.
    fireEvent.click(within(janela).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(corpos("projeto_excluir")).toHaveLength(0);

    fireEvent.keyDown(screen.getByRole("button", { name: "Mais ações do projeto" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Excluir projeto/ }));
    janela = await screen.findByRole("dialog");
    fireEvent.click(within(janela).getByRole("button", { name: "Excluir de vez" }));
    await waitFor(() => expect(corpos("projeto_excluir")).toHaveLength(1));
    expect(corpos("projeto_excluir")[0]).toEqual({ acao: "projeto_excluir", projeto_id: PROJETO });
    await waitFor(() => expect(voltar).toHaveBeenCalled());
  }, 30000);
});

describe("Excluir projeto em uso", () => {
  it("motivoDoProjetoEmUso (a regra da função): nó rodando ou Pôr no ar com pedido aberto bloqueia; o resto pode", () => {
    expect(motivoDoProjetoEmUso([{ no_id: "a", tipo: "copy", status: "pronto", created_at: "1" }])).toBeNull();
    expect(motivoDoProjetoEmUso([{ no_id: "a", tipo: "imagem", status: "na_fila", created_at: "1" }])).toMatch(/1 nó está rodando/);
    expect(motivoDoProjetoEmUso([{ no_id: "z", tipo: "por_no_ar", status: "aguardando", saida: { estado: "aguardando_aprovacao" }, created_at: "1" }])).toMatch(/pedido aberto/);
    expect(motivoDoProjetoEmUso([{ no_id: "z", tipo: "por_no_ar", status: "pronto", saida: { estado: "feito" }, created_at: "1" }])).toBeNull();
    const acoes = ler("supabase/functions/laboratorio/acoes.ts");
    expect(acoes).toContain('throw new ErroHttp(409, "projeto_em_uso", emUso)');
    expect(acoes.indexOf("motivoDoProjetoEmUso(")).toBeLessThan(acoes.indexOf('from("lab_execucoes").delete()'));
  });

  it("409 projeto_em_uso: a frase da função aparece na janela, nada sai e o Excluir fica desligado", async () => {
    const frase = "Este projeto está em uso: o Pôr no ar tem um pedido aberto (aguardando aprovação ou com o agente). Espere terminar, ou recuse o pedido em Precisa de você, e exclua de novo. Nada foi apagado.";
    const voltar = vi.fn();
    funcao({
      projeto_excluir: () => {
        throw new ErroDaMesa("projeto_em_uso", frase);
      },
    });
    montarEditor(voltar);
    const mais = await screen.findByRole("button", { name: "Mais ações do projeto" });
    fireEvent.keyDown(mais, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Excluir projeto/ }));
    const janela = await screen.findByRole("dialog");
    fireEvent.click(within(janela).getByRole("button", { name: "Excluir de vez" }));
    const alerta = await waitFor(() => within(janela).getByRole("alert"));
    expect(alerta.textContent).toBe(frase);
    expect((within(janela).getByRole("button", { name: "Excluir de vez" }) as HTMLButtonElement).disabled).toBe(true);
    expect(voltar).not.toHaveBeenCalled();
  }, 30000);
});

// ------------------------------------------------------------------ lista

const LISTA = [
  { id: "p1", nome: "Café especial", client_id: CLIENTE_A, cliente_nome: "Acerbi", status: "ativo", versao: 1, nos: 7, updated_at: "2026-10-18T10:00:00Z" },
  { id: "p2", nome: "Funil de pães", client_id: CLIENTE_B, cliente_nome: "Padaria Sol", status: "ativo", versao: 1, nos: 3, updated_at: "2026-10-20T10:00:00Z" },
  { id: "p3", nome: "Teste livre", client_id: null, cliente_nome: null, status: "ativo", versao: 1, nos: 0, updated_at: "2026-10-19T10:00:00Z" },
  { id: "p4", nome: "Velho", client_id: null, cliente_nome: null, status: "arquivado", versao: 1, nos: 2, updated_at: "2026-10-01T10:00:00Z" },
];

describe("Lista de projetos: busca, filtro e ações", () => {
  const lista = () => LISTA.map((p) => normalizarProjeto(p)!) as ProjetoDoLab[];

  it("filtrarProjetos: só ativos, mais recente primeiro, busca sem acento por nome ou cliente, Livres e por cliente", () => {
    expect(filtrarProjetos(lista(), "", "todos").map((p) => p.id)).toEqual(["p2", "p3", "p1"]);
    expect(filtrarProjetos(lista(), "cafe", "todos").map((p) => p.id)).toEqual(["p1"]);
    expect(filtrarProjetos(lista(), "padaria", "todos").map((p) => p.id)).toEqual(["p2"]);
    expect(filtrarProjetos(lista(), "", "livres").map((p) => p.id)).toEqual(["p3"]);
    expect(filtrarProjetos(lista(), "", CLIENTE_A).map((p) => p.id)).toEqual(["p1"]);
    expect(opcoesDoFiltro(lista(), []).map((o) => o.rotulo)).toEqual(["Todos", "Livres", "Acerbi", "Padaria Sol"]);
    expect(dataCurta("2026-10-20T10:00:00Z", new Date("2026-10-20T15:00:00Z"))).toBe("hoje");
    expect(dataCurta("2026-10-19T10:00:00Z", new Date("2026-10-20T15:00:00Z"))).toBe("ontem");
    expect(dataCurta("2026-09-02T10:00:00Z", new Date("2026-10-20T15:00:00Z"))).toBe("02/09");
  });

  it("na tela: cartões com miniatura, cliente e nós; buscar e filtrar; excluir pelo … do cartão com confirmação", async () => {
    funcao({ projetos_listar: () => ({ projetos: LISTA }) });
    montarPagina("/laboratorio?aba=projetos");
    const grade = await achar("[data-grade-de-projetos]");
    const ids = () => Array.prototype.map.call(document.querySelectorAll("[data-cartao-de-projeto]"), (e: Element) => e.getAttribute("data-cartao-de-projeto"));
    expect(ids()).toEqual(["p2", "p3", "p1"]);
    const cartao = grade.querySelector('[data-cartao-de-projeto="p1"]') as HTMLElement;
    expect(cartao.querySelector("[data-miniatura]")).not.toBeNull();
    expect(cartao.textContent).toContain("Café especial");
    expect(cartao.textContent).toContain("Acerbi");
    expect(cartao.textContent).toContain("7 nó(s)");

    fireEvent.change(screen.getByLabelText("Buscar projetos"), { target: { value: "funil" } });
    await waitFor(() => expect(ids()).toEqual(["p2"]));
    fireEvent.change(screen.getByLabelText("Buscar projetos"), { target: { value: "" } });
    await waitFor(() => expect(ids()).toHaveLength(3));

    const filtro = screen.getByRole("tablist", { name: "Filtrar projetos" });
    fireEvent.click(within(filtro).getByRole("tab", { name: /Livres/ }));
    await waitFor(() => expect(ids()).toEqual(["p3"]));
    fireEvent.click(within(filtro).getByRole("tab", { name: /Padaria Sol/ }));
    await waitFor(() => expect(ids()).toEqual(["p2"]));
    fireEvent.click(within(filtro).getByRole("tab", { name: /Todos/ }));
    await waitFor(() => expect(ids()).toHaveLength(3));

    // Ações do cartão: abrir, duplicar, arquivar e excluir.
    const menu = within(document.querySelector('[data-cartao-de-projeto="p1"]') as HTMLElement).getByRole("button", { name: "Ações do projeto Café especial" });
    fireEvent.keyDown(menu, { key: "Enter" });
    const itens = (await screen.findAllByRole("menuitem")).map((i) => (i.textContent || "").trim());
    expect(itens).toEqual(["Abrir", "Duplicar", "Arquivar", "Excluir projeto"]);
    fireEvent.click(screen.getByRole("menuitem", { name: /Excluir projeto/ }));
    const janela = await screen.findByRole("dialog");
    expect(within(janela).getByText("Café especial")).toBeInTheDocument();
    fireEvent.click(within(janela).getByRole("button", { name: "Excluir de vez" }));
    await waitFor(() => expect(corpos("projeto_excluir")).toEqual([{ acao: "projeto_excluir", projeto_id: "p1" }]));
    await act(async () => undefined);
  }, 30000);

  it("sem lookbehind, \\p{} nem grupo nomeado nos arquivos da casca (nem em comentário)", () => {
    for (const a of [
      "src/components/laboratorio/EditorDoProjeto.tsx",
      "src/components/laboratorio/CanvasStudio.tsx",
      "src/components/laboratorio/PerguntasGuiadas.tsx",
      "src/components/laboratorio/AbaProjetos.tsx",
      "src/components/laboratorio/CartaoDeProjeto.tsx",
      "src/components/laboratorio/JanelaDeExcluirProjeto.tsx",
      "src/lib/laboratorio/respostasDasPerguntas.ts",
      "src/pages/Laboratorio.tsx",
    ]) {
      expect(/\(\?<[=!]|\\p\{|\(\?<[A-Za-z]/.test(ler(a)), a).toBe(false);
    }
  });
});
