import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Laboratório (/laboratorio, 19/10/2026): abas em ícone, pedido da Início
 * vira projeto no canvas, ligação inválida explica o porquê, "Rodar tudo"
 * estima antes e só roda depois do confirmar, operações do agente entram no
 * canvas só com o "Aplicar", Logos destaca a escolhida do Jev, e a rota e o
 * menu existem. A função `laboratorio` é simulada pelo contrato
 * (Aceleriq-Laboratorio/ESPEC-LABORATORIO.md).
 */

const m = vi.hoisted(() => ({ chamar: vi.fn() }));

vi.mock("@/lib/mesa/api", async (orig) => ({ ...(await orig<typeof import("@/lib/mesa/api")>()), chamarFuncao: m.chamar }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u1" } }) }));
vi.mock("@/hooks/useSupabaseData", () => ({
  useClients: () => ({ data: [{ id: "11111111-1111-4111-8111-111111111111", company_name: "Acerbi" }], isLoading: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/laboratorio/estudio-livre/EstudioLivre", () => ({
  default: ({ clientId }: { clientId?: string | null }) => <div data-testid="estudio-livre">{clientId == null ? "livre" : String(clientId)}</div>,
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
import EditorDoProjeto from "@/components/laboratorio/EditorDoProjeto";
import { aplicarOperacoes, canvasVazio, criarNo, ligar, normalizarOperacao, podeLigar, type CanvasDoLab } from "@/lib/laboratorio/nos";

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
const canvasInicial: CanvasDoLab = {
  nos: [
    { id: "c1", tipo: "contexto", x: 0, y: 0, dados: { texto: "Lançamento de outubro" } },
    { id: "i1", tipo: "imagem", x: 320, y: 0, dados: { prompt: "", proporcao: "1:1", quantidade: 2 } },
  ],
  ligacoes: [{ id: "l1", de: "c1", para: "i1" }],
  viewport: { x: 0, y: 0, zoom: 1 },
};
const projeto = (extra: Record<string, unknown> = {}) => ({ id: PROJETO, nome: "Outubro", client_id: null, canvas: canvasInicial, versao: 3, status: "ativo", updated_at: "2026-10-19T10:00:00Z", ...extra });

/** A função `laboratorio` simulada; cada teste pode trocar uma ação. */
function funcao(trocas: Record<string, (corpo: any) => unknown> = {}) {
  m.chamar.mockImplementation(async (f: string, corpo: any) => {
    if (f !== "laboratorio") return {};
    if (trocas[corpo.acao]) return trocas[corpo.acao](corpo);
    switch (corpo.acao) {
      case "projetos_listar":
        return { projetos: [projeto()] };
      case "templates_listar":
        return { templates: [{ id: "t1", nome: "Carrossel", descricao: "5 lâminas", oficial: true, canvas: canvasInicial }] };
      case "projeto_ler":
        return { projeto: projeto(), cliente_nome: null, execucoes: {} };
      case "projeto_salvar":
        return { projeto: projeto({ canvas: corpo.canvas, versao: (corpo.versao_esperada || 0) + 1 }) };
      case "execucoes_ler":
        return { execucoes: [] };
      default:
        return {};
    }
  });
}

const acoes = () => m.chamar.mock.calls.filter((c) => c[0] === "laboratorio").map((c) => c[1].acao as string);

function Endereco() {
  const l = useLocation();
  return <span data-testid="endereco">{l.pathname + l.search}</span>;
}

function montarPagina(inicio = "/laboratorio") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[inicio]}>
        <Routes>
          <Route path="/laboratorio" element={<><Laboratorio /><Endereco /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function montarEditor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <EditorDoProjeto projetoId={PROJETO} clientes={[]} onVoltar={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  m.chamar.mockReset();
  funcao();
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

describe("Laboratório: página e abas", () => {
  it("tem as cinco abas em ícone e cada uma abre a sua área", async () => {
    montarPagina();
    const nav = screen.getByRole("navigation", { name: "Abas do Laboratório" });
    const abas = Array.prototype.slice.call(nav.querySelectorAll("button[data-etapa]")) as HTMLButtonElement[];
    expect(abas.map((b) => b.getAttribute("data-etapa"))).toEqual(["inicio", "projetos", "estudio", "logos", "arquivos"]);
    expect(await screen.findByLabelText("Pedido para o Laboratório")).toBeInTheDocument();

    fireEvent.click(nav.querySelector('[data-etapa="logos"]') as HTMLElement);
    expect(await screen.findByLabelText("Nome da marca")).toBeInTheDocument();
    expect(screen.getByTestId("endereco").textContent).toContain("aba=logos");

    fireEvent.click(nav.querySelector('[data-etapa="estudio"]') as HTMLElement);
    expect((await screen.findByTestId("estudio-livre")).textContent).toBe("livre");

    fireEvent.click(nav.querySelector('[data-etapa="projetos"]') as HTMLElement);
    expect(await screen.findByText("Outubro")).toBeInTheDocument();

    fireEvent.click(nav.querySelector('[data-etapa="arquivos"]') as HTMLElement);
    expect(await screen.findByText("Nada gerado ainda")).toBeInTheDocument();
  });

  it("Início: o atalho só preenche; enviar chama pedido_inicio e abre o projeto no canvas", async () => {
    funcao({ pedido_inicio: () => ({ projeto: projeto() }) });
    montarPagina();
    const caixa = (await screen.findByLabelText("Pedido para o Laboratório")) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole("button", { name: "Carrossel" }));
    expect(caixa.value).toContain("carrossel");
    expect(acoes()).not.toContain("pedido_inicio");

    fireEvent.change(caixa, { target: { value: "Carrossel de 5 lâminas sobre café especial" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar o pedido" }));

    await waitFor(() => expect(acoes()).toContain("pedido_inicio"));
    const corpo = m.chamar.mock.calls.find((c) => c[1].acao === "pedido_inicio")![1];
    expect(corpo).toMatchObject({ pedido: "Carrossel de 5 lâminas sobre café especial", client_id: null, modelo_id: "openrouter:anthropic/claude-opus-5.5" });
    await waitFor(() => expect(document.querySelector(`[data-editor-do-projeto="${PROJETO}"]`)).not.toBeNull());
    expect(screen.getByTestId("endereco").textContent).toContain(`projeto=${PROJETO}`);
    expect(acoes()).toContain("projeto_ler");
  });
});

describe("Laboratório: canvas do projeto", () => {
  it("ligação inválida mostra a mensagem do porquê e não liga", async () => {
    montarEditor();
    const paleta = await screen.findByRole("toolbar", { name: "Nós do projeto" });
    fireEvent.click(within(paleta).getByRole("button", { name: "Logo" }));
    // O inspetor abre pelo "Abrir detalhes" da barra do nó (os campos já ficam no próprio nó).
    fireEvent.click(await screen.findByRole("button", { name: "Abrir detalhes" }));
    const inspetor = await waitFor(() => {
      const el = document.querySelector("[data-painel-do-inspetor]");
      if (!el) throw new Error("sem inspetor");
      return el as HTMLElement;
    });
    // A logo é o nó novo selecionado; tenta ligar a logo no Contexto (ponto de partida).
    fireEvent.change(within(inspetor).getByLabelText("Ligar a"), { target: { value: "c1" } });
    expect(within(inspetor).getByRole("alert").textContent).toMatch(/Contexto é ponto de partida/);
    expect(within(inspetor).queryByText(/Manda para/)).toBeNull();
  });

  it("Rodar tudo chama estimar, mostra o custo e só roda depois de confirmar", async () => {
    funcao({
      estimar: () => ({ por_no: [{ no_id: "i1", tipo: "imagem", custo_usd: 0.4, chamadas: [] }], total_usd: 0.4, ordem: ["i1"], carteira_client_id: "cccccccc-0000-4000-8000-00000000000c", livre: true }),
      rodar_tudo: () => ({ rodada_id: "r1", ordem: ["i1"], execucoes: { i1: "e1" }, estimativa_usd: 0.4, status: "rodando", acompanhar: "execucoes_ler" }),
    });
    montarEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Rodar tudo" }));
    await waitFor(() => expect(acoes()).toContain("estimar"));
    const janela = await waitFor(() => {
      const el = document.querySelector("[data-janela-de-custo]");
      if (!el) throw new Error("sem janela");
      return el as HTMLElement;
    });
    expect(janela.textContent).toContain("Resultado 1");
    expect(janela.textContent).toMatch(/US\$ 0,40/);
    expect(acoes()).not.toContain("rodar_tudo");

    fireEvent.click(within(janela).getByRole("button", { name: /Rodar · US\$ 0,40/ }));
    await waitFor(() => expect(acoes()).toContain("rodar_tudo"));
    const corpo = m.chamar.mock.calls.find((c) => c[1].acao === "rodar_tudo")![1];
    expect(corpo).toMatchObject({ projeto_id: PROJETO, confirmado: true });
    expect(acoes().indexOf("estimar")).toBeLessThan(acoes().indexOf("rodar_tudo"));
  });

  it("operações do agente só entram no canvas com Aplicar no canvas", async () => {
    funcao({
      planejar: () => ({
        resposta: "Pus uma copy de anúncio antes do Resultado.",
        operacoes: [
          { indice: 0, op: "criar", aceita: true, recibo: "Criar a Copy de anúncio", no_id: "no_copy_3", operacao: { op: "criar", ref: "no_copy_3", tipo: "copy", dados: { formato: "anuncio" }, x: 400, y: 80 } },
          { indice: 1, op: "ligar", aceita: true, recibo: "Ligar o Contexto na Copy", ligacao_id: "lig_c1_no_copy_3", operacao: { op: "ligar", de: "c1", para: "no_copy_3" } },
        ],
        canvas_previsto: canvasInicial,
        versao: 3,
        custo_usd: 0.02,
      }),
    });
    montarEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Abrir o agente do projeto" }));
    fireEvent.change(await screen.findByLabelText("Mensagem para o agente do projeto"), { target: { value: "põe uma copy" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar ao agente" }));

    expect(await screen.findByText("Criar a Copy de anúncio")).toBeInTheDocument();
    expect(screen.getByText("Ligar o Contexto na Copy")).toBeInTheDocument();
    const corpo = m.chamar.mock.calls.find((c) => c[1].acao === "planejar")![1];
    expect(corpo).toMatchObject({ projeto_id: PROJETO, mensagem: "põe uma copy", modelo_id: "openrouter:anthropic/claude-opus-5.5" });
    expect(acoes()).not.toContain("projeto_salvar");

    fireEvent.click(screen.getByRole("button", { name: "Aplicar no canvas" }));
    await waitFor(() => expect(acoes()).toContain("projeto_salvar"), { timeout: 6000 });
    const salvo = m.chamar.mock.calls.find((c) => c[1].acao === "projeto_salvar")![1];
    expect(salvo.versao_esperada).toBe(3);
    const copy = salvo.canvas.nos.find((n: any) => n.tipo === "copy");
    expect(copy).toBeTruthy();
    expect(salvo.canvas.ligacoes.some((l: any) => l.de === "c1" && l.para === copy.id)).toBe(true);
    expect(acoes()).not.toContain("no_executar");
    expect(acoes()).not.toContain("rodar_tudo");
  });

  it("conflito de versão avisa e oferece recarregar", async () => {
    const { ErroDaMesa } = await import("@/lib/mesa/api");
    funcao({
      projeto_salvar: () => {
        throw new ErroDaMesa("versao_mudou", "Outra pessoa salvou este projeto antes. Recarregue para não perder nada.", { projeto_atual: projeto({ versao: 4 }) });
      },
    });
    montarEditor();
    const nome = await screen.findByLabelText("Nome do projeto");
    fireEvent.change(nome, { target: { value: "Outubro v2" } });
    expect(await screen.findByRole("button", { name: "Recarregar" }, { timeout: 6000 })).toBeInTheDocument();
    expect(document.querySelector('[data-estado-do-salvar="conflito"]')).not.toBeNull();
  });
});

describe("Laboratório: Logos", () => {
  it("mostra o custo antes e destaca a escolhida do Jev com o motivo", async () => {
    const { ErroDaMesa } = await import("@/lib/mesa/api");
    funcao({
      logo_gerar: (c) => {
        if (!c.confirmado) throw new ErroDaMesa("confirmacao_necessaria", "Isto custa cerca de US$ 0.3000. Confirme para rodar.", { total_usd: 0.3, por_no: [{ no_id: null, tipo: "logo", custo_usd: 0.3 }] });
        return { execucao_id: "e1", projeto_id: PROJETO, imagens: [1, 2, 3].map((i) => ({ path: `global/laboratorio/p/e1-0${i}.png`, url: `https://img.test/${i}.png`, bucket: "workspace" })), escolha: { indice: 1, caminho: "monograma", motivo: "Mais legível em tamanho pequeno.", confianca: 0.7 }, aviso_jev: null, custo_usd: 0.3 };
      },
    });
    montarPagina("/laboratorio?aba=logos");
    fireEvent.change(await screen.findByLabelText("Nome da marca"), { target: { value: "Café Serra" } });
    fireEvent.click(screen.getByRole("button", { name: "Gerar logos" }));
    const janela = await waitFor(() => {
      const el = document.querySelector("[data-janela-de-custo]");
      if (!el) throw new Error("sem janela");
      return el as HTMLElement;
    });
    expect(m.chamar.mock.calls.filter((c) => c[1].acao === "logo_gerar").map((c) => c[1].confirmado)).toEqual([false]);
    fireEvent.click(within(janela).getByRole("button", { name: /Rodar/ }));
    expect(await screen.findByText("Mais legível em tamanho pequeno.", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("O Jev escolheu a 2ª.")).toBeInTheDocument();
    const eleita = document.querySelector("[data-escolhida-do-jev]") as HTMLElement;
    expect(eleita.getAttribute("data-variacao")).toBe("1");
    expect(within(eleita).getByText("Escolhida pelo Jev")).toBeInTheDocument();
    const corpo = m.chamar.mock.calls.filter((c) => c[1].acao === "logo_gerar")[1][1];
    expect(corpo).toMatchObject({ nome: "Café Serra", client_id: null, n: 4, confirmado: true });
  });
});

describe("Laboratório: regras do grafo", () => {
  it("logo aceita mídia mas não imagens de um Resultado; círculo não fecha", () => {
    let c = canvasVazio();
    const a = criarNo(c, "midia");
    c = a.canvas;
    const b = criarNo(c, "imagem");
    c = b.canvas;
    const l = criarNo(c, "logo");
    c = l.canvas;
    expect(podeLigar(c, a.no!.id, l.no!.id).ok).toBe(true);
    const r = podeLigar(c, b.no!.id, l.no!.id);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toMatch(/Logo não recebe imagens de Resultado/);
    const ag = criarNo(c, "agente");
    const cp = criarNo(ag.canvas, "copy");
    c = ligar(cp.canvas, ag.no!.id, cp.no!.id);
    const circulo = podeLigar(c, cp.no!.id, ag.no!.id);
    expect(!circulo.ok && circulo.motivo).toMatch(/círculo/);
  });

  it("aplicarOperacoes troca os ids do agente e devolve o que não coube", () => {
    const ops = [
      normalizarOperacao({ op: "criar", id: "novo", tipo: "agente", recibo: "Criar agente" })!,
      normalizarOperacao({ op: "ligar", de: "c1", para: "novo" })!,
      normalizarOperacao({ op: "definir", no_id: "novo", campo: "instrucao", valor: "Seja breve" })!,
      normalizarOperacao({ op: "ligar", de: "novo", para: "c1", recibo: "Ligar de volta" })!,
    ];
    const r = aplicarOperacoes(canvasInicial, ops);
    expect(r.feitas).toBe(3);
    expect(r.falhas.map((f) => f.recibo)).toEqual(["Ligar de volta"]);
    const novo = r.canvas.nos.find((n) => n.tipo === "agente")!;
    expect(novo.dados.instrucao).toBe("Seja breve");
    expect(r.canvas.ligacoes.some((l) => l.de === "c1" && l.para === novo.id)).toBe(true);
    expect(normalizarOperacao({ op: "apagar_tudo" })).toBeNull();
  });
});

describe("Laboratório: rota, menu e mapa", () => {
  it("rota para admin, gestor e design; item no menu e na troca de mesas; pré-carga; mapa do painel", async () => {
    const app = ler("src/App.tsx");
    expect(app).toContain('<Route path="/laboratorio" element={<>{["admin", "manager", "design"].includes(profile?.role || "") ? <Suspense fallback={<EsqueletoDaMesa />}><Laboratorio /></Suspense> : <Navigate to="/dashboard" replace />}</>} />');
    expect(app).toContain("PaginaLaboratorio");
    expect(ler("src/components/AppLayout.tsx")).toContain('{ title: "Laboratório", url: "/laboratorio", icon: FlaskConical, soCriacao: true }');
    expect(ler("src/lib/mesa/preCarga.ts")).toContain('lazyComPreCarga("pagina/laboratorio"');
    const { MESAS } = await import("@/components/mesa-foto/TrocaDeMesas");
    expect(MESAS.some((x) => x.valor === "laboratorio" && x.caminho === "/laboratorio")).toBe(true);
    const mapa = await import("../../supabase/functions/_shared/mapa-do-painel");
    expect(mapa.areaDaRota("/laboratorio?aba=logos")!.chave).toBe("laboratorio");
    expect(mapa.AGENTES_DO_PAINEL.some((g) => g.area === "laboratorio")).toBe(true);
    const { rotuloDoLugar } = await import("@/lib/navegacao/lugares");
    expect(rotuloDoLugar("/laboratorio", "?aba=logos")).toBe("Laboratório · Logos");
  });

  it("o código do Laboratório não usa lookbehind, \\p{} nem grupo nomeado", () => {
    const arquivos = [
      "src/pages/Laboratorio.tsx",
      "src/lib/laboratorio/nos.ts",
      "src/lib/laboratorio/api.ts",
      "src/lib/laboratorio/arquivos.ts",
      "src/components/laboratorio/EditorDoProjeto.tsx",
      "src/components/laboratorio/Inspetor.tsx",
      "src/components/laboratorio/QuadroDoLab.tsx",
      "src/components/laboratorio/AbaInicio.tsx",
      "src/components/laboratorio/AbaLogos.tsx",
      "src/components/laboratorio/AbaArquivos.tsx",
    ];
    for (const a of arquivos) expect(/\(\?<[=!]|\\p\{|\(\?<[A-Za-z]/.test(ler(a)), a).toBe(false);
  });
});
