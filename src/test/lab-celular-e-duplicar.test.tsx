import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 19/10/2026: (1) a caixa de pedido do Laboratório no celular (modelo e
 * cliente compactos, enviar sempre na mesma linha, à direita), (2) o
 * cabeçalho das mesas grudado também abaixo de 768 px e (3) "Duplicar para
 * outro cliente" no menu "…" do projeto (mesmo canvas, sem saídas e sem
 * mídias, nome "<nome> · <cliente>").
 */

const m = vi.hoisted(() => ({ chamar: vi.fn() }));

vi.mock("@/lib/mesa/api", async (orig) => ({ ...(await orig<typeof import("@/lib/mesa/api")>()), chamarFuncao: m.chamar }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u1" } }) }));
vi.mock("@/hooks/useSupabaseData", () => ({
  useClients: () => ({ data: [{ id: "11111111-1111-4111-8111-111111111111", company_name: "Acerbi Pernil e Cia Ltda" }], isLoading: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/laboratorio/estudio-livre/EstudioLivre", () => ({ default: () => <div /> }));
vi.mock("@/components/sistema/SeletorDeMesa", () => ({ default: () => <button type="button">Mesa</button> }));
vi.mock("@/components/briefing/BotaoDoBriefing", () => ({ default: () => null }));
vi.mock("@/components/mesa/BotaoDoContextoUsado", () => ({ default: () => null }));
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
      storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/x" }, error: null }) }) },
    },
  };
});

import CaixaDoPedido, { ATALHOS_DA_INICIO, ATALHOS_DO_CANVAS } from "@/components/laboratorio/CaixaDoPedido";
import CascaDaMesa from "@/components/sistema/CascaDaMesa";
import Laboratorio from "@/pages/Laboratorio";
import { canvasParaDuplicar, nomeDaCopia } from "@/lib/laboratorio/duplicar";
import type { CanvasDoLab } from "@/lib/laboratorio/nos";

const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8").replace(/\r\n/g, "\n");

beforeAll(() => {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  if (!(globalThis as any).DOMMatrixReadOnly) (globalThis as any).DOMMatrixReadOnly = class { m22 = 1; };
  (SVGElement.prototype as any).getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 });
  if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => {};
  if (!(Element.prototype as any).hasPointerCapture) (Element.prototype as any).hasPointerCapture = () => false;
});

const classes = (el: Element) => String(el.getAttribute("class") || "").split(/\s+/).filter(Boolean);

// ------------------------------------------------------------------ 1. caixa de pedido

describe("Caixa de pedido compacta (celular)", () => {
  const caixa = (compacta: boolean) =>
    render(
      <CaixaDoPedido
        valor="um carrossel"
        onMudar={() => undefined}
        onEnviar={() => undefined}
        enviando={false}
        modelo="openrouter:anthropic/claude-opus-5.5"
        onModelo={() => undefined}
        clienteId="11111111-1111-4111-8111-111111111111"
        onCliente={() => undefined}
        clientes={[{ id: "11111111-1111-4111-8111-111111111111", nome: "Acerbi Pernil e Cia Ltda" }]}
        atalhos={compacta ? ATALHOS_DO_CANVAS : ATALHOS_DA_INICIO}
        onAtalho={() => undefined}
        rotulo="Pedido"
        placeholder="Peça"
        tituloDoEnviar="Enviar"
        compacta={compacta}
      />,
    );

  for (const compacta of [false, true]) {
    it(`enviar fica na mesma linha de modelo e cliente, à direita (${compacta ? "Canvas Studio" : "Início"})`, () => {
      caixa(compacta);
      const linha = document.querySelector("[data-linha-do-pedido]")!;
      // A linha não quebra: só o grupo da esquerda quebra por dentro.
      expect(classes(linha)).not.toContain("flex-wrap");
      expect(classes(linha)).toContain("flex");
      const enviar = screen.getByRole("button", { name: "Enviar o pedido" });
      expect(enviar.parentElement).toBe(linha);
      expect(linha.lastElementChild).toBe(enviar);
      expect(classes(enviar)).toContain("shrink-0");
      const grupo = linha.firstElementChild!;
      expect(classes(grupo)).toEqual(expect.arrayContaining(["min-w-0", "flex-1", "flex-wrap"]));
      expect(within(grupo as HTMLElement).getByLabelText("Modelo")).toBeTruthy();
      expect(within(grupo as HTMLElement).getByLabelText("Cliente")).toBeTruthy();
    });
  }

  it("modelo e cliente: só ícone + nome curto truncado; o nome inteiro no title e no select", () => {
    caixa(false);
    const curtos = Array.prototype.map.call(document.querySelectorAll("[data-nome-curto]"), (e: Element) => e) as Element[];
    expect(curtos.map((e) => e.textContent)).toEqual(["Opus 5.5", "Acerbi Pernil e Cia Ltda"]);
    for (const e of curtos) expect(classes(e)).toEqual(expect.arrayContaining(["truncate", "min-w-0", "max-w-[76px]"]));
    const seletores = Array.prototype.slice.call(document.querySelectorAll("[data-seletor-compacto]")) as Element[];
    expect(seletores.map((s) => s.getAttribute("title"))).toEqual([
      "Modelo: Claude Opus 5.5",
      "Cliente: Acerbi Pernil e Cia Ltda (opcional: Livre usa a carteira da agência)",
    ]);
    // O select nativo continua lá (invisível por cima), com o nome no aria-label.
    const sel = screen.getByLabelText("Cliente") as HTMLSelectElement;
    expect(classes(sel)).toEqual(expect.arrayContaining(["absolute", "inset-0", "opacity-0"]));
    expect(sel.value).toBe("11111111-1111-4111-8111-111111111111");
  });
});

// ------------------------------------------------------------------ 2. cabeçalho das mesas

describe("CascaDaMesa: cabeçalho grudado também abaixo de 768 px", () => {
  it("sticky sem prefixo md:, -top-4 no celular e o recuo da barra só de 768 px para cima", () => {
    render(
      <MemoryRouter>
        <CascaDaMesa mesa="foto" titulo="Mesa Foto" clientId="c1" cliente={<span>Cliente</span>} etapas={<nav aria-label="Etapas da Mesa" />} telaCheia={{ cheia: false, alternar: () => undefined } as any}>
          <p>corpo</p>
        </CascaDaMesa>
      </MemoryRouter>,
    );
    const header = document.querySelector("header[data-cabecalho-da-mesa]")!;
    const c = classes(header);
    expect(c).toContain("sticky");
    // -top-4 desconta o pt-4 do <main> do celular (o sticky para na borda do padding).
    expect(c).toContain("-top-4");
    expect(c).not.toContain("md:sticky");
    expect(c).not.toContain("relative");
    expect(c).toContain("md:top-[calc(env(safe-area-inset-top)+80px)]");
    // Mesmo fundo opaco do computador (sem translúcido) e acima do corpo.
    expect(c).toEqual(expect.arrayContaining(["bg-background", "z-20", "border-b"]));
    // Nenhum ancestral da casca corta o eixo x (overflow-x-hidden mata o sticky).
    let pai = header.parentElement;
    while (pai && pai !== document.body) {
      expect(classes(pai).filter((k) => /overflow-(x-)?(hidden|clip)/.test(k))).toEqual([]);
      pai = pai.parentElement;
    }
  });
});

// ------------------------------------------------------------------ 3. duplicar para outro cliente

const PROJETO = "aaaaaaaa-0000-4000-8000-000000000001";
const NOVO = "aaaaaaaa-0000-4000-8000-000000000002";
const CLIENTE = "11111111-1111-4111-8111-111111111111";
const canvasDeOrigem: CanvasDoLab = {
  nos: [
    { id: "c1", tipo: "contexto", x: 0, y: 0, dados: { texto: "Café especial em cápsula" } },
    { id: "md", tipo: "midia", x: 0, y: 160, dados: { titulo: "Fotos do produto", imagens: [{ caminho: "cliente-a/foto1.png" }] } },
    { id: "gr", tipo: "gravity", x: 320, y: 160, dados: { prompt_base: "luz de janela", referencias: [{ caminho: "cliente-a/ref.png" }] } },
    { id: "i1", tipo: "imagem", x: 320, y: 0, dados: { prompt: "xícara", quantidade: 2 } },
  ],
  ligacoes: [
    { id: "l1", de: "c1", para: "i1" },
    { id: "l2", de: "md", para: "i1" },
  ],
  viewport: { x: 10, y: 20, zoom: 0.8 },
};
const projeto = (extra: Record<string, unknown> = {}) => ({ id: PROJETO, nome: "Café", client_id: null, canvas: canvasDeOrigem, versao: 3, status: "ativo", updated_at: "2026-10-19T10:00:00Z", ...extra });

const corpos = (acao: string) => m.chamar.mock.calls.filter((c) => c[0] === "laboratorio" && c[1].acao === acao).map((c) => c[1]);

function Endereco() {
  const l = useLocation();
  return <span data-testid="endereco">{l.pathname + l.search}</span>;
}

describe("Duplicar para outro cliente", () => {
  beforeEach(() => {
    m.chamar.mockReset();
    m.chamar.mockImplementation(async (f: string, corpo: any) => {
      if (f !== "laboratorio") return {};
      switch (corpo.acao) {
        case "projeto_ler":
          return corpo.projeto_id === NOVO
            ? { projeto: projeto({ id: NOVO, nome: "Café · Acerbi Pernil e Cia Ltda", client_id: CLIENTE, canvas: canvasParaDuplicar(canvasDeOrigem), versao: 1 }), cliente_nome: "Acerbi Pernil e Cia Ltda", execucoes: {} }
            : { projeto: projeto(), cliente_nome: null, execucoes: { i1: { id: "e1", no_id: "i1", status: "concluido", saida: { imagens: ["x.png"] } } } };
        case "projeto_criar":
          return { projeto: projeto({ id: NOVO, nome: corpo.nome, client_id: corpo.client_id, canvas: corpo.canvas, versao: 1 }) };
        case "execucoes_ler":
          return { execucoes: [] };
        default:
          return {};
      }
    });
  });

  it("canvasParaDuplicar: mesmos nós e ligações, sem as mídias, sem mexer no original", () => {
    const copia = canvasParaDuplicar(canvasDeOrigem);
    expect(copia.nos.map((n) => n.id)).toEqual(["c1", "md", "gr", "i1"]);
    expect(copia.ligacoes).toEqual(canvasDeOrigem.ligacoes);
    expect(copia.viewport).toEqual({ x: 10, y: 20, zoom: 0.8 });
    expect(copia.nos[1].dados).toEqual({ titulo: "Fotos do produto" });
    expect(copia.nos[2].dados).toEqual({ prompt_base: "luz de janela" });
    expect(copia.nos[3].dados).toEqual({ prompt: "xícara", quantidade: 2 });
    expect((canvasDeOrigem.nos[1].dados as any).imagens).toHaveLength(1);
    expect(nomeDaCopia("Café", "Livre")).toBe("Café · Livre");
    expect(nomeDaCopia("x".repeat(130), "Acerbi")).toHaveLength(120);
  });

  it("menu … › Duplicar: escolhe o cliente, cria o projeto com o canvas e abre o novo", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/laboratorio?aba=projetos&projeto=${PROJETO}`]}>
          <Routes>
            <Route path="/laboratorio" element={<><Laboratorio /><Endereco /></>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const mais = await screen.findByRole("button", { name: "Mais ações do projeto" }, { timeout: 20000 });
    await waitFor(() => expect((screen.getByLabelText("Nome do projeto") as HTMLInputElement).value).toBe("Café"));
    fireEvent.keyDown(mais, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Duplicar para outro cliente/ }));
    const janela = await screen.findByRole("dialog");
    fireEvent.change(within(janela).getByLabelText("Cliente do projeto novo"), { target: { value: CLIENTE } });
    expect(within(janela).getByText("Nome: Café · Acerbi Pernil e Cia Ltda")).toBeTruthy();
    fireEvent.click(within(janela).getByRole("button", { name: "Duplicar" }));

    await waitFor(() => expect(corpos("projeto_criar")).toHaveLength(1));
    const criar = corpos("projeto_criar")[0];
    expect(criar.client_id).toBe(CLIENTE);
    expect(criar.nome).toBe("Café · Acerbi Pernil e Cia Ltda");
    expect(criar.canvas.nos.map((n: any) => n.id)).toEqual(["c1", "md", "gr", "i1"]);
    expect(criar.canvas.ligacoes).toHaveLength(2);
    expect(JSON.stringify(criar.canvas)).not.toContain("cliente-a/");
    // Sem saídas/execuções: nada além do canvas, nome e cliente vai para a função.
    expect(Object.keys(criar).sort()).toEqual(["acao", "canvas", "client_id", "nome"]);
    await waitFor(() => expect(screen.getByTestId("endereco").textContent).toContain(`projeto=${NOVO}`));
  }, 40000);

  it("código sem lookbehind, \\p{} nem grupo nomeado (nem em comentário)", () => {
    for (const a of ["src/lib/laboratorio/duplicar.ts", "src/components/laboratorio/Seletores.tsx", "src/components/laboratorio/CaixaDoPedido.tsx", "src/components/laboratorio/EditorDoProjeto.tsx", "src/components/sistema/CascaDaMesa.tsx"]) {
      expect(/\(\?<[=!]|\\p\{|\(\?<[A-Za-z]/.test(ler(a)), a).toBe(false);
    }
  });
});
