import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement as h } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Laboratório v2 (20/10/2026, Aceleriq-Laboratorio/ESPEC-LABORATORIO-v2.md):
 * Canvas Studio no topo do canvas (planejar em modo projeto_completo, as
 * operações entram com a animação de construção e nas colunas da função),
 * a Início manda pedido grande para o canvas, nós novos (pesquisa, oferta,
 * funil, filme, pôr no ar) na paleta e no inspetor, o Filme escolhe o
 * storyboard no próprio nó, o Pôr no ar mostra os estados, tela cheia em
 * todas as abas e o "Filme cinematográfico" da Identidade abre o
 * Laboratório com o template "Filme da marca". As respostas da função vêm
 * das funções puras dela (modulos/regras.ts) e dos formatos de filme.ts e
 * no-ar.ts.
 */

const m = vi.hoisted(() => ({ chamar: vi.fn(), realtime: [] as Array<{ filtro: any; cb: (msg: any) => void }> }));

vi.mock("@/lib/mesa/api", async (orig) => ({ ...(await orig<typeof import("@/lib/mesa/api")>()), chamarFuncao: m.chamar }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u1" } }) }));
vi.mock("@/hooks/useSupabaseData", () => ({
  useClients: () => ({ data: [{ id: "11111111-1111-4111-8111-111111111111", company_name: "Acerbi" }], isLoading: false }),
}));
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
        const canal: any = {
          on: (_ev: string, filtro: any, cb: (msg: any) => void) => {
            m.realtime.push({ filtro, cb });
            return canal;
          },
          subscribe: () => canal,
        };
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
import EditorDoProjeto from "@/components/laboratorio/EditorDoProjeto";
import ResultadoDoNo from "@/components/laboratorio/ResultadoDoNo";
import { ICONES_DOS_NOS } from "@/components/laboratorio/icones";
import VideoDaMarca from "@/components/mesa-identidade/VideoDaMarca";
import { MesaProvider } from "@/components/mesa/MesaContexto";
import { ProjetoProvider, type ProjetoDaMesa } from "@/components/mesa-identidade/Comuns";
import { normalizarExecucao } from "@/lib/laboratorio/api";
import { ALVOS_NO_AR, TIPOS_DA_V2, TIPOS_DE_NO as TIPOS_DA_TELA, aplicarOperacoes as aplicarNaTela, atrasosDaConstrucao, ehProjetoCompleto, normalizarOperacao, type CanvasDoLab } from "@/lib/laboratorio/nos";
import {
  ALVOS_NO_AR as ALVOS_DA_FUNCAO,
  CAMPOS_DO_TIPO,
  ENTRADAS_ACEITAS,
  TIPOS_DE_NO as TIPOS_DA_FUNCAO,
  aplicarOperacoes as aplicarNaFuncao,
  lerPlano,
  normalizarCanvas as normalizarNaFuncao,
} from "../../supabase/functions/laboratorio/modulos/regras";

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
const CLIENTE = "11111111-1111-4111-8111-111111111111";
const canvasInicial: CanvasDoLab = {
  nos: [
    { id: "c1", tipo: "contexto", x: 0, y: 0, dados: { texto: "Café especial em cápsula" } },
    { id: "i1", tipo: "imagem", x: 320, y: 0, dados: { prompt: "" } },
  ],
  ligacoes: [{ id: "l1", de: "c1", para: "i1" }],
  viewport: { x: 0, y: 0, zoom: 1 },
};
const projeto = (extra: Record<string, unknown> = {}) => ({ id: PROJETO, nome: "Café", client_id: null, canvas: canvasInicial, versao: 3, status: "ativo", updated_at: "2026-10-20T10:00:00Z", ...extra });

/** planejar como acoes.ts responde: o plano passa pelo aplicarOperacoes da função (colunas por etapa no modo completo). */
function planoComoAFuncao(corpo: any, canvas: CanvasDoLab, operacoes: unknown[], resposta: string) {
  const completo = corpo.modo === "projeto_completo";
  const plano = lerPlano({ resposta, operacoes }, "");
  const aplicado = aplicarNaFuncao(normalizarNaFuncao(canvas), plano.operacoes, { projetoCompleto: completo });
  return { resposta: plano.resposta, operacoes: aplicado.recibos, canvas_previsto: aplicado.canvas, versao: 3, custo_usd: 0.031, modelo_id: corpo.modelo_id, modo: completo ? "projeto_completo" : "simples", colunas: aplicado.colunas };
}

const OPS_DO_LOW_TICKET = [
  { op: "criar", ref: "pesq", tipo: "pesquisa", dados_json: JSON.stringify({ titulo: "Mercado de cápsulas", tema: "preços e concorrentes" }) },
  { op: "criar", ref: "of", tipo: "oferta", dados_json: JSON.stringify({ titulo: "Oferta", produto: "Kit degustação", preco: "R$ 47" }) },
  { op: "criar", ref: "fun", tipo: "funil", dados_json: JSON.stringify({ titulo: "Funil" }) },
  { op: "criar", ref: "lp", tipo: "landing", dados_json: JSON.stringify({ titulo: "Página de vendas" }) },
  { op: "criar", ref: "ar", tipo: "por_no_ar", dados_json: JSON.stringify({ titulo: "Publicar", alvo: "publicar_site" }) },
  { op: "ligar", de: "c1", para: "pesq" },
  { op: "ligar", de: "pesq", para: "of" },
  { op: "ligar", de: "of", para: "fun" },
  { op: "ligar", de: "fun", para: "lp" },
  { op: "ligar", de: "lp", para: "ar" },
  { op: "organizar" },
];

function funcao(trocas: Record<string, (corpo: any) => unknown> = {}) {
  m.chamar.mockImplementation(async (f: string, corpo: any) => {
    if (f !== "laboratorio") return {};
    if (trocas[corpo.acao]) return trocas[corpo.acao](corpo);
    switch (corpo.acao) {
      case "projetos_listar":
        return { projetos: [projeto()] };
      case "templates_listar":
        return { templates: [] };
      case "projeto_ler":
        return { projeto: projeto(), cliente_nome: null, execucoes: {} };
      case "projeto_criar":
        return { projeto: projeto({ nome: corpo.nome, canvas: { nos: [], ligacoes: [], viewport: { x: 0, y: 0, zoom: 1 } }, versao: 1 }) };
      case "projeto_salvar":
        return { projeto: projeto({ canvas: corpo.canvas, versao: (corpo.versao_esperada || 0) + 1 }) };
      case "execucoes_ler":
        return { execucoes: [] };
      default:
        return {};
    }
  });
}

const corpos = (acao: string) => m.chamar.mock.calls.filter((c) => c[0] === "laboratorio" && c[1].acao === acao).map((c) => c[1]);

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

const studio = async () => (await waitFor(() => {
  const el = document.querySelector("[data-canvas-studio]");
  if (!el) throw new Error("sem Canvas Studio");
  return el as HTMLElement;
}));

async function abrirModoLista() {
  fireEvent.click(await screen.findByRole("button", { name: "Modo lista" }));
  return await waitFor(() => {
    const el = document.querySelector("[data-modo-lista-do-lab]");
    if (!el) throw new Error("sem modo lista");
    return el as HTMLElement;
  });
}

beforeEach(() => {
  m.chamar.mockReset();
  m.realtime.length = 0;
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

// ------------------------------------------------------------------ Canvas Studio

describe("Canvas Studio", () => {
  it("o atalho de projeto manda planejar com modo projeto_completo e as operações entram no quadro com a construção, nas colunas da função", async () => {
    funcao({ planejar: (c) => planoComoAFuncao(c, canvasInicial, OPS_DO_LOW_TICKET, "Pesquisei o mercado e montei o low ticket.") });
    montarEditor();
    const barra = await studio();
    const atalhos = within(barra).getByRole("group", { name: "Atalhos do Canvas Studio" });
    expect(Array.prototype.map.call(atalhos.querySelectorAll("[data-atalho]"), (b: Element) => b.getAttribute("aria-label"))).toEqual(["Produto low ticket", "Funil de vendas", "Montar empresa", "Webinar", "Quiz de qualificação", "Lançamento", "Checkout com upsell", "Carrossel", "Landing page", "Filme"]);
    // Modelo e cliente na mesma caixa da Início.
    expect(within(barra).getByLabelText("Modelo")).toBeInTheDocument();
    expect(within(barra).getByLabelText("Cliente")).toBeInTheDocument();

    // 21/10 (o dono pediu a mudança: "quando ele escolhe [o projeto pronto], ele só abre essa parte aqui
    // das perguntas"): o atalho de PROJETO COMPLETO já manda o planejar em projeto_completo, sem esperar o
    // Enviar (antes ele só preenchia a caixa). Os outros atalhos continuam só preenchendo.
    fireEvent.click(within(atalhos).getByRole("button", { name: "Produto low ticket" }));
    await waitFor(() => expect(corpos("planejar")).toHaveLength(1));
    expect(corpos("planejar")[0]).toMatchObject({ projeto_id: PROJETO, modo: "projeto_completo", modelo_id: "openrouter:anthropic/claude-opus-5.5" });
    expect(corpos("planejar")[0].mensagem).toContain("low ticket");

    // A construção: os nós novos entram com atraso por coluna (a animação), sem clicar em Aplicar.
    const resposta = await waitFor(() => {
      const el = document.querySelector("[data-resposta-do-studio]");
      if (!el) throw new Error("sem resposta");
      return el as HTMLElement;
    });
    expect(resposta.textContent).toMatch(/5 nó\(s\) no quadro · projeto completo/);
    expect(resposta.textContent).toContain("Pesquisei o mercado");
    await waitFor(() => expect(corpos("projeto_salvar").length).toBeGreaterThan(0), { timeout: 6000 });
    const salvo = corpos("projeto_salvar")[0].canvas as CanvasDoLab;
    expect(salvo.nos.map((n) => n.tipo).sort()).toEqual(["contexto", "funil", "imagem", "landing", "oferta", "pesquisa", "por_no_ar"]);
    const previsto = (await m.chamar.mock.results.find((r, i) => m.chamar.mock.calls[i][1].acao === "planejar")!.value).canvas_previsto as CanvasDoLab;
    // Posições = colunas por etapa da função (canvas_previsto), não um arranjo próprio da tela.
    for (const n of salvo.nos) {
      const p = previsto.nos.find((x) => x.id === n.id)!;
      expect([n.id, n.x, n.y]).toEqual([p.id, p.x, p.y]);
    }
    const pesquisa = salvo.nos.find((n) => n.tipo === "pesquisa")!;
    const noAr = salvo.nos.find((n) => n.tipo === "por_no_ar")!;
    expect(salvo.ligacoes.some((l) => l.de === "c1" && l.para === pesquisa.id)).toBe(true);
    expect(pesquisa.x).toBeLessThan(noAr.x);
    expect(corpos("no_executar")).toHaveLength(0);
    expect(corpos("rodar_tudo")).toHaveLength(0);

    // Desfazer volta o quadro de antes.
    fireEvent.click(within(barra).getByRole("button", { name: "Desfazer a construção" }));
    await waitFor(() => {
      const ultimo = corpos("projeto_salvar").slice(-1)[0].canvas as CanvasDoLab;
      expect(ultimo.nos.map((n) => n.id)).toEqual(["c1", "i1"]);
    }, { timeout: 6000 });
  });

  it("o organizar da função ({ modo: etapas, posicoes }) vale como veio; sem posições, organiza aqui", () => {
    const op = normalizarOperacao({ indice: 0, op: "organizar", aceita: true, recibo: "Organizei por etapa.", operacao: { op: "organizar", modo: "etapas", posicoes: { c1: { x: 80, y: 80 }, i1: { x: 1520, y: 80 } }, colunas: [] } })!;
    expect(op.posicoes).toEqual({ c1: { x: 80, y: 80 }, i1: { x: 1520, y: 80 } });
    const r = aplicarNaTela(canvasInicial, [op]);
    expect(r.canvas.nos.map((n) => [n.id, n.x, n.y])).toEqual([["c1", 80, 80], ["i1", 1520, 80]]);
    const semPosicoes = aplicarNaTela(canvasInicial, [normalizarOperacao({ op: "organizar" })!]);
    expect(semPosicoes.canvas.nos.map((n) => n.x)).toEqual([60, 380]);
  });

  it("a animação de construção vai coluna por coluna (esquerda para a direita) e é curta", () => {
    const c: CanvasDoLab = {
      nos: [
        { id: "a", tipo: "pesquisa", x: 80, y: 80, dados: {} },
        { id: "b", tipo: "oferta", x: 440, y: 80, dados: {} },
        { id: "b2", tipo: "funil", x: 440, y: 270, dados: {} },
        { id: "z", tipo: "por_no_ar", x: 2240, y: 80, dados: {} },
      ],
      ligacoes: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const at = atrasosDaConstrucao(c, ["z", "b2", "a", "b"]);
    expect(at.a).toBe(0);
    expect(at.b).toBeGreaterThan(at.a);
    expect(at.b2).toBeGreaterThan(at.b);
    expect(at.z).toBeGreaterThan(at.b2);
    expect(Math.max(at.a, at.b, at.b2, at.z)).toBeLessThan(2000);
  });

  it("pedido de ajuste num quadro montado vai sem modo; pedido de negócio num quadro vazio vai em projeto completo", async () => {
    expect(ehProjetoCompleto("troca a copy do anúncio", null, 6)).toBe(false);
    expect(ehProjetoCompleto("Quero montar uma empresa de café do zero", null, 0)).toBe(true);
    expect(ehProjetoCompleto("um carrossel sobre café", "carrossel", 0)).toBe(false);
    expect(ehProjetoCompleto("qualquer coisa", "funil", 12)).toBe(true);

    funcao({ planejar: (c) => planoComoAFuncao(c, canvasInicial, [{ op: "definir", no: "i1", dados_json: JSON.stringify({ prompt: "Foto da cápsula" }) }], "Ajustei o Resultado.") });
    montarEditor();
    const barra = await studio();
    fireEvent.change(within(barra).getByLabelText("Pedido para o Canvas Studio"), { target: { value: "põe uma foto da cápsula no Resultado" } });
    fireEvent.click(within(barra).getByRole("button", { name: "Enviar o pedido" }));
    await waitFor(() => expect(corpos("planejar")).toHaveLength(1));
    expect(corpos("planejar")[0]).not.toHaveProperty("modo");
    await waitFor(() => expect(corpos("projeto_salvar").length).toBeGreaterThan(0), { timeout: 6000 });
    expect((corpos("projeto_salvar")[0].canvas as CanvasDoLab).nos.find((n) => n.id === "i1")!.dados.prompt).toBe("Foto da cápsula");
  });

  it("Início: pedido de projeto completo cria o projeto, abre o canvas e o Canvas Studio monta lá (sem pedido_inicio)", async () => {
    let canvasSalvo: CanvasDoLab = { nos: [], ligacoes: [], viewport: { x: 0, y: 0, zoom: 1 } };
    funcao({
      projeto_ler: () => ({ projeto: projeto({ canvas: canvasSalvo, versao: 1 }), cliente_nome: null, execucoes: {} }),
      projeto_salvar: (c) => {
        canvasSalvo = c.canvas;
        return { projeto: projeto({ canvas: c.canvas, versao: c.versao_esperada + 1 }) };
      },
      planejar: (c) => planoComoAFuncao(c, canvasSalvo, OPS_DO_LOW_TICKET.filter((o) => !(o.op === "ligar" && o.de === "c1")), "Montei a empresa."),
    });
    montarPagina();
    const caixa = (await screen.findByLabelText("Pedido para o Laboratório")) as HTMLTextAreaElement;
    // A Início tem os mesmos atalhos de projeto do Canvas Studio.
    expect(screen.getByRole("button", { name: "Montar empresa" })).toBeInTheDocument();
    fireEvent.change(caixa, { target: { value: "Quero montar uma empresa de café especial do zero" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar o pedido" }));

    await waitFor(() => expect(corpos("projeto_criar")).toHaveLength(1));
    expect(corpos("projeto_criar")[0]).toMatchObject({ client_id: null, contexto: "Quero montar uma empresa de café especial do zero" });
    await waitFor(() => expect(document.querySelector(`[data-editor-do-projeto="${PROJETO}"]`)).not.toBeNull());
    expect(screen.getByTestId("endereco").textContent).toContain(`projeto=${PROJETO}`);
    await waitFor(() => expect(corpos("planejar")).toHaveLength(1));
    expect(corpos("planejar")[0]).toMatchObject({ projeto_id: PROJETO, mensagem: "Quero montar uma empresa de café especial do zero", modo: "projeto_completo" });
    expect(corpos("pedido_inicio")).toHaveLength(0);
    await waitFor(() => expect(canvasSalvo.nos.length).toBe(5), { timeout: 6000 });
  });

  it("Projetos: Novo projeto em branco cria e já abre o canvas com o Canvas Studio", async () => {
    montarPagina("/laboratorio?aba=projetos");
    fireEvent.click(await screen.findByRole("button", { name: "Novo projeto em branco" }));
    await waitFor(() => expect(corpos("projeto_criar")).toHaveLength(1));
    await waitFor(() => expect(document.querySelector(`[data-editor-do-projeto="${PROJETO}"]`)).not.toBeNull());
    expect(await studio()).toBeInTheDocument();
    expect(screen.getByTestId("endereco").textContent).toContain(`projeto=${PROJETO}`);
  });
});

// ------------------------------------------------------------------ nós novos

describe("Nós novos: pesquisa, oferta, funil, filme e pôr no ar", () => {
  it("as regras de ligação e os campos dos nós novos são os da função (ENTRADAS_ACEITAS e CAMPOS_DO_TIPO)", () => {
    for (const t of TIPOS_DA_V2) {
      expect(TIPOS_DA_FUNCAO as readonly string[], `a função ainda não tem o tipo ${t}`).toContain(t);
      expect(TIPOS_DA_TELA[t].entradas.slice().sort(), `entradas de ${t}`).toEqual((ENTRADAS_ACEITAS as Record<string, readonly string[]>)[t].slice().sort());
      for (const c of TIPOS_DA_TELA[t].campos) expect((CAMPOS_DO_TIPO as Record<string, readonly string[]>)[t], `${t}.${c.chave}`).toContain(c.chave);
    }
    // Todo tipo da tela entra em ENTRADAS_ACEITAS igual (inclusive os antigos, que agora recebem pesquisa, oferta e funil).
    for (const t of Object.keys(TIPOS_DA_TELA)) expect(TIPOS_DA_TELA[t as keyof typeof TIPOS_DA_TELA].entradas.slice().sort(), t).toEqual((ENTRADAS_ACEITAS as Record<string, readonly string[]>)[t].slice().sort());
    expect(ALVOS_NO_AR.map((a) => a.valor)).toEqual([...ALVOS_DA_FUNCAO]);
  });

  it("cada nó tem um ícone só dele", () => {
    const icones = Object.keys(ICONES_DOS_NOS).map((k) => ICONES_DOS_NOS[k as keyof typeof ICONES_DOS_NOS]);
    expect(new Set(icones).size).toBe(icones.length);
    expect(Object.keys(ICONES_DOS_NOS).sort()).toEqual(Object.keys(TIPOS_DA_TELA).sort());
  });

  it("a paleta tem os nós novos e o inspetor mostra os campos de cada um", async () => {
    montarEditor();
    const paleta = await screen.findByRole("toolbar", { name: "Nós do projeto" });
    const inspetor = () =>
      waitFor(() => {
        const el = document.querySelector("[data-painel-do-inspetor]");
        if (!el) throw new Error("sem inspetor");
        return el as HTMLElement;
      });

    fireEvent.click(within(paleta).getByRole("button", { name: "Pesquisa" }));
    // O inspetor abre pelo "Abrir detalhes" da barra do nó (os campos já ficam no próprio nó).
    fireEvent.click(await screen.findByRole("button", { name: "Abrir detalhes" }));
    expect(within(await inspetor()).getByLabelText("O que pesquisar")).toBeInTheDocument();

    fireEvent.click(within(paleta).getByRole("button", { name: "Oferta" }));
    let el = await inspetor();
    await waitFor(() => expect(within(el).getByLabelText("Produto")).toBeInTheDocument());
    expect(within(el).getByLabelText("Preço")).toBeInTheDocument();

    fireEvent.click(within(paleta).getByRole("button", { name: "Funil" }));
    await waitFor(() => expect(within(document.querySelector("[data-painel-do-inspetor]") as HTMLElement).getByLabelText("Objetivo do funil")).toBeInTheDocument());

    fireEvent.click(within(paleta).getByRole("button", { name: "Filme" }));
    el = await inspetor();
    await waitFor(() => expect(within(el).getByLabelText("Ideia do filme")).toBeInTheDocument());
    expect((within(el).getByLabelText("Formato") as HTMLSelectElement).value).toBe("ambos");

    fireEvent.click(within(paleta).getByRole("button", { name: "Pôr no ar" }));
    el = await inspetor();
    const alvo = (await waitFor(() => within(el).getByLabelText("O que pôr no ar"))) as HTMLSelectElement;
    expect(Array.prototype.map.call(alvo.options, (o: HTMLOptionElement) => o.value)).toEqual(["publicar_site", "subir_anuncio_pausado", "conectar_pagina", "ligar_mensagens", "outro"]);
    const quem = within(el).getByLabelText("Quem põe no ar") as HTMLSelectElement;
    expect(quem.options[0].textContent).toMatch(/Automático/);
    expect(el.querySelector("[data-regra-no-ar]")!.textContent).toMatch(/sem a sua aprovação/);
    expect(within(el).getByRole("button", { name: "Pedir aprovação" })).toBeInTheDocument();
  });

  it("Pesquisa mostra as fontes com link; Oferta e Funil mostram o resumo e as etapas", () => {
    const pesquisa = normalizarExecucao({ id: "e1", no_id: "p1", tipo: "pesquisa", status: "pronto", saida: { texto: "O mercado de cápsulas cresce.", fontes: [{ titulo: "Abic", url: "https://abic.com.br/x" }, { url: "javascript:alert(1)" }, "https://www.exemplo.com/a"] } })!;
    const { container, rerender } = render(<MemoryRouter><ResultadoDoNo execucao={pesquisa} tipo="pesquisa" compacto={false} /></MemoryRouter>);
    const links = Array.prototype.map.call(container.querySelectorAll("[data-fonte]"), (a: HTMLAnchorElement) => [a.textContent, a.getAttribute("href"), a.getAttribute("target")]);
    expect(links).toEqual([["Abic", "https://abic.com.br/x", "_blank"], ["exemplo.com", "https://www.exemplo.com/a", "_blank"]]);

    const funil = normalizarExecucao({ id: "e2", no_id: "f1", tipo: "funil", status: "pronto", saida: { texto: "", json: { etapas: [{ nome: "Anúncio" }, { nome: "Captura", pagina: "LP" }, { nome: "Vendas" }, { nome: "Upsell" }] } } })!;
    rerender(<MemoryRouter><ResultadoDoNo execucao={funil} tipo="funil" /></MemoryRouter>);
    expect(Array.prototype.map.call(container.querySelectorAll("[data-etapa-do-funil]"), (e: Element) => e.textContent)).toEqual(["Anúncio", "Captura", "Vendas", "Upsell"]);

    const oferta = normalizarExecucao({ id: "e3", no_id: "o1", tipo: "oferta", status: "pronto", saida: { texto: "", json: { produto: "Kit degustação", preco: "R$ 47", promessa: "Café de cafeteria em casa" } } })!;
    rerender(<MemoryRouter><ResultadoDoNo execucao={oferta} tipo="oferta" /></MemoryRouter>);
    expect(container.querySelector("[data-resumo-da-oferta]")!.textContent).toMatch(/Kit degustação · R\$ 47/);
    expect(container.textContent).not.toMatch(/nasce pausado/);
  });
});

// ------------------------------------------------------------------ filme

const storyboards = ["Manhã", "Ritual", "Origem"].map((titulo, indice) => ({ indice, titulo, resumo: `Roteiro ${titulo}`, cenas: 5, duracao_s: 20, planos_de_video: 0, imagens: [] }));
/** saidaInicialDoFilme (filme.ts): o nó fica 'aguardando' com os 3 storyboards. */
const saidaDoFilme = (extra: Record<string, unknown> = {}) => ({ texto: "3 storyboards prontos. Escolha um no nó para renderizar o filme.", filme_id: "fm1", client_id: CLIENTE, formatos: ["16:9", "9:16"], etapa: "escolher", storyboards, storyboard_escolhido: null, render: { progresso: 0, prontas: 0, total: 0, faltando: [], montagem: {} }, render_progresso: 0, videos: [], video_url: "", video_path: "", avisos: [], ...extra });

describe("Filme", () => {
  it("escolhe o storyboard no próprio nó (filme_escolher { projeto_id, no_id, indice }) e passa a acompanhar o render", async () => {
    const canvas: CanvasDoLab = {
      nos: [
        { id: "c1", tipo: "contexto", x: 0, y: 0, dados: { texto: "Marca de café" } },
        { id: "f1", tipo: "filme", x: 360, y: 0, dados: { ideia: "", formato: "ambos" } },
      ],
      ligacoes: [{ id: "l1", de: "c1", para: "f1" }],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const linha = (saida: unknown) => ({ id: "e7", no_id: "f1", tipo: "filme", status: "aguardando", saida, created_at: "2026-10-20T10:00:00Z" });
    funcao({
      projeto_ler: () => ({ projeto: projeto({ canvas }), cliente_nome: null, execucoes: { f1: linha(saidaDoFilme()) } }),
      filme_escolher: (c) => ({ execucao_id: "e7", execucao: linha(saidaDoFilme({ etapa: "renderizando", storyboard_escolhido: c.indice, texto: `Storyboard ${c.indice + 1} escolhido.` })) }),
    });
    montarEditor();
    const lista = await abrirModoLista();
    fireEvent.click(within(lista.querySelector('[data-linha-do-no="f1"]') as HTMLElement).getAllByRole("button")[0]);
    const grade = await waitFor(() => {
      const el = document.querySelector("[data-storyboards-do-filme]");
      if (!el) throw new Error("sem storyboards");
      return el as HTMLElement;
    });
    expect(grade.querySelectorAll("[data-storyboard]")).toHaveLength(3);
    expect(grade.textContent).toMatch(/5 cenas · 20 s/);

    fireEvent.click(within(grade).getByRole("button", { name: "Escolher o storyboard 2" }));
    await waitFor(() => expect(corpos("filme_escolher")).toHaveLength(1));
    expect(corpos("filme_escolher")[0]).toEqual({ acao: "filme_escolher", projeto_id: PROJETO, no_id: "f1", indice: 1 });
    const andando = await waitFor(() => {
      const el = document.querySelector("[data-filme-renderizando]");
      if (!el) throw new Error("sem render");
      return el as HTMLElement;
    });
    expect(andando.textContent).toMatch(/Renderizando "Ritual"/);
    expect(document.querySelector("[data-storyboards-do-filme]")).toBeNull();
  });

  it("render pronto: o vídeo aparece no nó (o primeiro formato com link)", () => {
    const ex = normalizarExecucao({ id: "e7", no_id: "f1", tipo: "filme", status: "pronto", saida: saidaDoFilme({ etapa: "pronto", storyboard_escolhido: 1, videos: [{ formato: "16:9", url: "https://video.test/16x9.mp4", path: "x/16x9.mp4" }] }) })!;
    const { container } = render(<MemoryRouter><ResultadoDoNo execucao={ex} tipo="filme" /></MemoryRouter>);
    expect(container.querySelector("[data-video-do-filme]")!.getAttribute("src")).toBe("https://video.test/16x9.mp4");
  });
});

// ------------------------------------------------------------------ pôr no ar

/** SaidaDoNoAr (no-ar.ts). */
const saidaNoAr = (estado: string, extra: Record<string, unknown> = {}) => ({ texto: "", estado, alvo: "publicar_site", action_kind: "publicar_site", aprovacao_id: "ap1", link_aprovacao: "/execucao?aprovacao=ap1", operador: "default", operador_nome: "Hermes", tarefa_id: "t1", link_id: null, prova: "", link_no_ar: "", ...extra });

describe("Pôr no ar", () => {
  const montar = (status: string, saida: unknown, erro = "") => {
    const ex = normalizarExecucao({ id: "e9", no_id: "n1", tipo: "por_no_ar", status, saida, erro })!;
    return render(<MemoryRouter><ResultadoDoNo execucao={ex} tipo="por_no_ar" /></MemoryRouter>).container;
  };
  const passoAtual = (c: HTMLElement) => (c.querySelector('[aria-current="step"]') || { getAttribute: () => null }).getAttribute("data-passo-no-ar");

  it("aguardando sua aprovação → com o agente → feito com prova e link; recusado não vai ao ar", () => {
    let c = montar("aguardando", saidaNoAr("aguardando_aprovacao"));
    expect(c.querySelector("[data-estado-no-ar]")!.getAttribute("data-estado-no-ar")).toBe("aguardando_aprovacao");
    expect(passoAtual(c)).toBe("aguardando_aprovacao");
    const abrir = c.querySelector("[data-abrir-aprovacao]") as HTMLAnchorElement;
    expect(abrir.textContent).toMatch(/Abrir a aprovação/);
    expect(abrir.getAttribute("href")).toBe("/execucao?aprovacao=ap1");

    c = montar("aguardando", saidaNoAr("com_agente"));
    expect(passoAtual(c)).toBe("com_agente");
    expect(c.textContent).toMatch(/Com o agente \(Hermes\)/);
    expect(c.querySelector("[data-abrir-aprovacao]")).toBeNull();

    c = montar("pronto", saidaNoAr("feito", { prova: "Publicado em https://cafe.test", link_no_ar: "https://cafe.test" }));
    expect(c.querySelector("[data-estado-no-ar]")!.getAttribute("data-estado-no-ar")).toBe("feito");
    expect((c.querySelector("[data-link-no-ar]") as HTMLAnchorElement).getAttribute("href")).toBe("https://cafe.test");
    expect(c.querySelector("[data-prova-no-ar]")!.textContent).toMatch(/Publicado em/);

    c = montar("erro", saidaNoAr("recusado"), "O dono não aprovou.");
    expect(c.querySelector("[data-estado-no-ar]")!.getAttribute("data-estado-no-ar")).toBe("recusado");
    expect(c.textContent).toMatch(/Nada foi ao ar/);
  });

  it("o estado do Pôr no ar chega pelo realtime de lab_execucoes (sem no_acompanhar); 409 ja_pedido avisa que já foi pedido", async () => {
    const { toast } = await import("sonner");
    const { ErroDaMesa } = await import("@/lib/mesa/api");
    const canvas: CanvasDoLab = { nos: [{ id: "n1", tipo: "por_no_ar", x: 0, y: 0, dados: { alvo: "publicar_site" } }], ligacoes: [], viewport: { x: 0, y: 0, zoom: 1 } };
    const linha = (estado: string, status: string) => ({ id: "e9", projeto_id: PROJETO, no_id: "n1", tipo: "por_no_ar", status, saida: saidaNoAr(estado), created_at: "2026-10-20T10:00:00Z" });
    funcao({
      projeto_ler: () => ({ projeto: projeto({ canvas }), cliente_nome: null, execucoes: { n1: linha("aguardando_aprovacao", "aguardando") } }),
      estimar: () => ({ por_no: [{ no_id: "n1", tipo: "por_no_ar", custo_usd: 0 }], total_usd: 0, ordem: ["n1"], livre: true }),
      no_executar: () => {
        throw new ErroDaMesa("ja_pedido", "Este Pôr no ar já tem um pedido aberto.", { aprovacao_id: "ap1", status: "pendente" });
      },
    });
    montarEditor();
    const lista = await abrirModoLista();
    fireEvent.click(within(lista.querySelector('[data-linha-do-no="n1"]') as HTMLElement).getAllByRole("button")[0]);
    await waitFor(() => expect(document.querySelector('[data-estado-no-ar="aguardando_aprovacao"]')).not.toBeNull());
    await waitFor(() => expect(m.realtime.length).toBeGreaterThan(0));
    const canal = m.realtime[m.realtime.length - 1];
    expect(canal.filtro).toMatchObject({ table: "lab_execucoes", filter: `projeto_id=eq.${PROJETO}` });
    act(() => canal.cb({ new: linha("com_agente", "aguardando") }));
    await waitFor(() => expect(document.querySelector('[data-estado-no-ar="com_agente"]')).not.toBeNull());
    act(() => canal.cb({ new: { ...linha("feito", "pronto"), saida: saidaNoAr("feito", { link_no_ar: "https://cafe.test", prova: "Publicado." }) } }));
    await waitFor(() => expect(document.querySelector('[data-estado-no-ar="feito"]')).not.toBeNull());
    expect(corpos("no_acompanhar")).toHaveLength(0);

    // Rodar de novo com pedido aberto: a função responde 409 ja_pedido e a tela avisa.
    fireEvent.click(screen.getByRole("button", { name: "Pedir aprovação" }));
    const janela = await waitFor(() => {
      const el = document.querySelector("[data-janela-de-custo]");
      if (!el) throw new Error("sem janela");
      return el as HTMLElement;
    });
    fireEvent.click(within(janela).getByRole("button", { name: /Rodar/ }));
    await waitFor(() => expect(corpos("no_executar")).toHaveLength(1));
    expect(corpos("no_executar")[0]).toMatchObject({ no_id: "n1", confirmado: true });
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith("Já pedido", expect.objectContaining({ description: expect.stringMatching(/Precisa de você/) })));
  });

  it("o Filme renderizando é acompanhado pelo no_acompanhar a cada 5 s, um passo por vez", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const canvas: CanvasDoLab = { nos: [{ id: "f1", tipo: "filme", x: 0, y: 0, dados: { ideia: "" } }], ligacoes: [], viewport: { x: 0, y: 0, zoom: 1 } };
      const linha = (extra: Record<string, unknown>, status = "aguardando") => ({ id: "e7", no_id: "f1", tipo: "filme", status, saida: saidaDoFilme(extra), created_at: "2026-10-20T10:00:00Z" });
      funcao({
        projeto_ler: () => ({ projeto: projeto({ canvas }), cliente_nome: null, execucoes: { f1: linha({ etapa: "renderizando", storyboard_escolhido: 0, render_progresso: 40 }) } }),
        no_acompanhar: () => ({ execucao_id: "e7", execucao: linha({ etapa: "pronto", storyboard_escolhido: 0, video_url: "https://video.test/f.mp4" }, "pronto") }),
      });
      montarEditor();
      await screen.findByLabelText("Pedido para o Canvas Studio");
      expect(corpos("no_acompanhar")).toHaveLength(0);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5200);
      });
      await waitFor(() => expect(corpos("no_acompanhar")).toHaveLength(1));
      expect(corpos("no_acompanhar")[0]).toEqual({ acao: "no_acompanhar", projeto_id: PROJETO, no_id: "f1" });
      // Vídeo pronto: para de acompanhar.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(11000);
      });
      expect(corpos("no_acompanhar")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ------------------------------------------------------------------ tela cheia

describe("Tela cheia em todas as abas", () => {
  it.each(["inicio", "projetos", "estudio", "logos", "arquivos"])("aba %s: o botão só ícone liga o modo foco e a área ocupa a janela; sair volta", async (aba) => {
    montarPagina(`/laboratorio?aba=${aba}`);
    const pagina = document.querySelector("[data-pagina-laboratorio]") as HTMLElement;
    const botao = await screen.findByRole("button", { name: "Tela cheia" });
    expect(botao.textContent).toBe("");
    expect(botao.getAttribute("title")).toBe("Tela cheia");
    fireEvent.click(botao);
    expect(pagina.hasAttribute("data-tela-cheia")).toBe(true);
    expect(pagina.className).toMatch(/fixed inset-0/);
    expect(document.body.getAttribute("data-modo-foco")).toBe("laboratorio");
    fireEvent.click(screen.getByRole("button", { name: "Sair da tela cheia" }));
    expect(pagina.hasAttribute("data-tela-cheia")).toBe(false);
    expect(document.body.hasAttribute("data-modo-foco")).toBe(false);
  });

  it("no canvas, a tela cheia do editor cobre a janela inteira e o Esc sai", async () => {
    montarPagina(`/laboratorio?aba=projetos&projeto=${PROJETO}`);
    const editor = await waitFor(() => {
      const el = document.querySelector(`[data-editor-do-projeto="${PROJETO}"]`);
      if (!el) throw new Error("sem editor");
      return el as HTMLElement;
    });
    // Um botão só (o do editor): o da página some com o canvas aberto.
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Tela cheia" })).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Tela cheia" }));
    expect(editor.className).toMatch(/fixed inset-0/);
    expect(document.querySelector("[data-pagina-laboratorio]")!.hasAttribute("data-tela-cheia")).toBe(true);
    expect(document.body.hasAttribute("data-modo-foco")).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(editor.className).not.toMatch(/fixed inset-0/));
    expect(document.body.hasAttribute("data-modo-foco")).toBe(false);
  });
});

// ------------------------------------------------------------------ Identidade

describe("Identidade: Filme cinematográfico abre o Laboratório", () => {
  it("o botão usa o template Filme da marca (template_usar com client_id) e abre o projeto no canvas", async () => {
    const TEMPLATE = "6c0a1b10-0000-4000-8000-00000000000a";
    const NOVO = "bbbbbbbb-0000-4000-8000-000000000002";
    funcao({
      templates_listar: () => ({ templates: [{ id: "t-outro", nome: "Carrossel", oficial: true, canvas: canvasInicial }, { id: TEMPLATE, nome: "Filme da marca", descricao: "", icone: "clapperboard", oficial: true, canvas: canvasInicial }] }),
      template_usar: () => ({ projeto: { ...projeto(), id: NOVO, client_id: CLIENTE } }),
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const valor: ProjetoDaMesa = { projeto: { id: "pi1", client_id: CLIENTE, marca_id: null, dados: {} } as any, salvarParte: vi.fn(), concluir: vi.fn(), reabrir: vi.fn(), irPara: vi.fn(), guardar: vi.fn() } as any;
    render(
      h(QueryClientProvider, { client: qc },
        h(MemoryRouter, { initialEntries: ["/mesa/identidade"] },
          h(Routes, null,
            h(Route, { path: "/mesa/identidade", element: h(MesaProvider, { valor: { clientId: CLIENTE, clientName: "Acerbi", userId: null, isAdmin: true, podeRecarregar: true, saldoUsd: 10, catalogo: [], catalogoCarregando: false, atualizarCusto: () => undefined, abrirRecarga: () => undefined, abrirChaves: () => undefined, abrirModelos: () => undefined } as any }, h(ProjetoProvider, { valor }, h(VideoDaMarca))) }),
            h(Route, { path: "/laboratorio", element: h(Endereco) }),
          ))),
    );
    fireEvent.click(screen.getByRole("button", { name: "Criar vídeo" }));
    const filme = await waitFor(() => {
      const el = document.querySelector("[data-filme-no-laboratorio]");
      if (!el) throw new Error("sem botão");
      return el as HTMLElement;
    });
    expect(filme.textContent).toMatch(/Filme cinematográfico/);
    fireEvent.click(filme);
    await waitFor(() => expect(corpos("template_usar")).toHaveLength(1));
    expect(corpos("template_usar")[0]).toEqual({ acao: "template_usar", template_id: TEMPLATE, client_id: CLIENTE });
    const endereco = await screen.findByTestId("endereco");
    expect(endereco.textContent).toBe(`/laboratorio?aba=projetos&projeto=${NOVO}&client=${CLIENTE}`);
  });
});

// ------------------------------------------------------------------ código

describe("Código do Laboratório v2", () => {
  it("sem lookbehind, \\p{} nem grupo nomeado (nem em comentário)", () => {
    const arquivos = [
      "src/pages/Laboratorio.tsx",
      "src/lib/laboratorio/nos.ts",
      "src/lib/laboratorio/api.ts",
      "src/lib/laboratorio/pedidoPendente.ts",
      "src/components/laboratorio/CanvasStudio.tsx",
      "src/components/laboratorio/CaixaDoPedido.tsx",
      "src/components/laboratorio/EditorDoProjeto.tsx",
      "src/components/laboratorio/QuadroDoLab.tsx",
      "src/components/laboratorio/ResultadoDoNo.tsx",
      "src/components/laboratorio/Inspetor.tsx",
      "src/components/laboratorio/AbaInicio.tsx",
      "src/components/laboratorio/AbaProjetos.tsx",
      "src/components/mesa-identidade/VideoDaMarca.tsx",
    ];
    for (const a of arquivos) expect(/\(\?<[=!]|\\p\{|\(\?<[A-Za-z]/.test(ler(a)), a).toBe(false);
  });
});
