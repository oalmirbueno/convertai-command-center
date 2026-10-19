import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Laboratório v3 (20/10/2026, Aceleriq-Laboratorio/clickmax-rea.md): os 8
 * especialistas de criação na paleta e no inspetor (regras de ligação e
 * campos iguais aos da função), as perguntas guiadas antes de montar (Canvas
 * Studio e Início: os exemplos só preenchem a caixa; responder ou pular), a
 * trava do Pôr no ar por bloco de prova ou número sem fonte (visível, com o
 * motivo e a lista, e o "fonte confirmada" / "editar" que destrava) e os 3
 * templates novos. As respostas da função vêm das funções puras dela.
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
import EditorDoProjeto from "@/components/laboratorio/EditorDoProjeto";
import { ICONES_DOS_NOS } from "@/components/laboratorio/icones";
import { normalizarExecucao } from "@/lib/laboratorio/api";
import {
  TIPOS_DA_V3,
  TIPOS_DE_NO as TIPOS_DA_TELA,
  ancestraisDe as ancestraisNaTela,
  canvasVazio,
  criarNo,
  ligar,
  preencherComExemplo,
  travaDoNoAr as travaNaTela,
  type CanvasDoLab,
} from "@/lib/laboratorio/nos";
import {
  CAMPOS_DO_TIPO,
  ENTRADAS_ACEITAS,
  NOS_ESPECIALISTAS,
  TIPOS_DE_NO as TIPOS_DA_FUNCAO,
  ancestraisDe as ancestraisNaFuncao,
  blocosSemFonte,
  normalizarCanvas,
  perguntasQueFaltam,
  resolverBloco,
  travaDoNoAr as travaNaFuncao,
} from "../../supabase/functions/laboratorio/modulos/regras";
import { TEMPLATES_OFICIAIS_V3 } from "../../supabase/functions/laboratorio/modulos/templates";

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
const vazio = (): CanvasDoLab => ({ nos: [], ligacoes: [], viewport: { x: 0, y: 0, zoom: 1 } });
const projeto = (extra: Record<string, unknown> = {}) => ({ id: PROJETO, nome: "Café", client_id: null, canvas: vazio(), versao: 1, status: "ativo", updated_at: "2026-10-20T10:00:00Z", ...extra });

/** perguntas: o formato que acoes.ts devolve (as perguntas saem de perguntasQueFaltam). */
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
        return { projeto: projeto({ nome: corpo.nome }) };
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

async function abrirModoLista() {
  fireEvent.click(await screen.findByRole("button", { name: "Modo lista" }));
  return await achar("[data-modo-lista-do-lab]");
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

// ------------------------------------------------------------------ especialistas

describe("Especialistas de criação", () => {
  it("os 8 tipos são os da função, com as mesmas entradas e campos, um ícone cada", () => {
    expect(TIPOS_DA_V3).toEqual([...NOS_ESPECIALISTAS]);
    for (const t of TIPOS_DA_V3) {
      expect(TIPOS_DA_FUNCAO as readonly string[]).toContain(t);
      expect(TIPOS_DA_TELA[t].entradas.slice().sort(), t).toEqual((ENTRADAS_ACEITAS as Record<string, readonly string[]>)[t].slice().sort());
      for (const c of TIPOS_DA_TELA[t].campos) expect((CAMPOS_DO_TIPO as Record<string, readonly string[]>)[t], `${t}.${c.chave}`).toContain(c.chave);
      expect(TIPOS_DA_TELA[t].roda).toBe(true);
    }
    const icones = Object.keys(ICONES_DOS_NOS).map((k) => ICONES_DOS_NOS[k as keyof typeof ICONES_DOS_NOS]);
    expect(new Set(icones).size).toBe(icones.length);
  });

  it("a paleta tem os especialistas e o inspetor mostra os campos de cada um", async () => {
    montarEditor();
    const paleta = await screen.findByRole("toolbar", { name: "Nós do projeto" });
    const inspetor = () => achar("[data-painel-do-inspetor]");
    const casos: Array<[string, string[]]> = [
      ["Avatar", ["Público pensado", "Instrução"]],
      ["Order bump", ["Produto", "Preço"]],
      ["Upsell", ["Produto", "Preço"]],
      ["Downsell", ["Produto", "Preço"]],
      ["Sequência de ofertas", ["Instrução"]],
      ["Seções da página", ["Tipo de página", "Objetivo da página"]],
      ["Sequência de mensagens", ["Canal", "Mensagens", "Objetivo da sequência"]],
      ["Refino de tom", ["Tom", "Instrução"]],
    ];
    for (const [rotulo, campos] of casos) {
      fireEvent.click(within(paleta).getByRole("button", { name: rotulo }));
      const el = await inspetor();
      await waitFor(() => expect(within(el).getByRole("heading").textContent).toContain(rotulo));
      for (const c of campos) expect(within(el).getByLabelText(c), `${rotulo}: ${c}`).toBeInTheDocument();
    }
    const tipoDePagina = within(await inspetor()).queryByLabelText("Tipo de página");
    expect(tipoDePagina).toBeNull();
    fireEvent.click(within(paleta).getByRole("button", { name: "Seções da página" }));
    const opcoes = Array.prototype.map.call((within(await inspetor()).getByLabelText("Tipo de página") as HTMLSelectElement).options, (o: HTMLOptionElement) => o.value);
    expect(opcoes).toContain("aplicacao");
    expect(opcoes).toContain("inscricao");
  });
});

// ------------------------------------------------------------------ perguntas guiadas

describe("Perguntas guiadas antes de montar", () => {
  it("Canvas Studio: a função pergunta em vez de montar; o exemplo só preenche; mandar leva as respostas; pular monta assim mesmo", async () => {
    let vez = 0;
    funcao({
      planejar: (c) => {
        vez += 1;
        if (!c.respostas && !c.pular_perguntas) return { resposta: "Antes de montar, me diga o essencial.", perguntas: PERGUNTAS, operacoes: [], canvas_previsto: vazio(), versao: 1, modo: "projeto_completo", colunas: [] };
        return { resposta: "Montei.", operacoes: [{ indice: 0, op: "criar", aceita: true, recibo: "Criei Avatar.", operacao: { op: "criar", ref: "no_avatar_1", tipo: "avatar", dados: { titulo: "Avatar" }, x: 80, y: 120 } }], canvas_previsto: { nos: [{ id: "no_avatar_1", tipo: "avatar", x: 80, y: 120, dados: { titulo: "Avatar" } }], ligacoes: [], viewport: { x: 0, y: 0, zoom: 1 } }, versao: 1, modo: "projeto_completo", colunas: [] };
      },
    });
    montarEditor();
    const barra = await achar("[data-canvas-studio]");
    const caixa = within(barra).getByLabelText("Pedido para o Canvas Studio") as HTMLTextAreaElement;
    fireEvent.change(caixa, { target: { value: "Quero montar um produto low ticket do zero" } });
    fireEvent.click(within(barra).getByRole("button", { name: "Enviar o pedido" }));

    const grupo = await achar("[data-perguntas-guiadas]");
    expect(Array.prototype.map.call(grupo.querySelectorAll("[data-pergunta]"), (e: Element) => e.getAttribute("data-pergunta"))).toEqual(PERGUNTAS.map((p) => p.id));
    expect(grupo.querySelectorAll("[data-pergunta]").length).toBeLessThanOrEqual(4);
    expect(corpos("planejar")[0]).toMatchObject({ modo: "projeto_completo", mensagem: "Quero montar um produto low ticket do zero" });
    expect(corpos("projeto_salvar")).toHaveLength(0);
    expect(caixa.value).toBe("");

    // O exemplo só preenche a caixa (não chama a função de novo).
    const exemplo = grupo.querySelector('[data-exemplo="publico"]') as HTMLButtonElement;
    fireEvent.click(exemplo);
    expect(caixa.value).toBe(`Público: ${exemplo.textContent}`);
    expect(corpos("planejar")).toHaveLength(1);
    fireEvent.change(caixa, { target: { value: `${caixa.value}\nPreço: R$ 47` } });
    fireEvent.click(within(barra).getByRole("button", { name: "Enviar o pedido" }));
    await waitFor(() => expect(corpos("planejar")).toHaveLength(2));
    expect(corpos("planejar")[1]).toMatchObject({ mensagem: "Quero montar um produto low ticket do zero", modo: "projeto_completo", respostas: `Público: ${exemplo.textContent}\nPreço: R$ 47` });
    expect(corpos("planejar")[1]).not.toHaveProperty("pular_perguntas");
    await waitFor(() => expect(document.querySelector("[data-perguntas-guiadas]")).toBeNull());
    await waitFor(() => expect(corpos("projeto_salvar").length).toBeGreaterThan(0), { timeout: 6000 });

    // Outra rodada: pular e montar assim mesmo.
    fireEvent.change(caixa, { target: { value: "Quero montar um produto low ticket do zero" } });
    fireEvent.click(within(barra).getByRole("button", { name: "Enviar o pedido" }));
    await achar("[data-perguntas-guiadas]");
    fireEvent.click(screen.getByRole("button", { name: "Pular e montar assim mesmo" }));
    await waitFor(() => expect(corpos("planejar")).toHaveLength(4));
    expect(corpos("planejar")[3]).toMatchObject({ pular_perguntas: true, modo: "projeto_completo" });
    expect(vez).toBe(4);
  });

  it("Início: pergunta antes de criar o projeto completo; as respostas seguem com o pedido para o Canvas Studio", async () => {
    funcao({
      perguntas_do_pedido: () => ({ perguntas: PERGUNTAS, fonte: "jev", custo_usd: 0.0004 }),
      planejar: () => ({ resposta: "Montei.", operacoes: [], canvas_previsto: vazio(), versao: 1, modo: "projeto_completo", colunas: [] }),
    });
    montarPagina();
    const caixa = (await screen.findByLabelText("Pedido para o Laboratório")) as HTMLTextAreaElement;
    fireEvent.change(caixa, { target: { value: "Quero montar uma empresa do zero" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar o pedido" }));
    const grupo = await achar("[data-perguntas-guiadas]");
    expect(corpos("perguntas_do_pedido")[0]).toMatchObject({ pedido: "Quero montar uma empresa do zero", client_id: null });
    expect(corpos("projeto_criar")).toHaveLength(0);

    fireEvent.click(grupo.querySelector('[data-exemplo="publico"]') as HTMLElement);
    expect(caixa.value).toMatch(/^Público: /);
    expect(corpos("projeto_criar")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Enviar o pedido" }));
    await waitFor(() => expect(corpos("projeto_criar")).toHaveLength(1));
    expect(corpos("projeto_criar")[0].contexto).toContain("Quero montar uma empresa do zero");
    await waitFor(() => expect(corpos("planejar")).toHaveLength(1));
    expect(corpos("planejar")[0]).toMatchObject({ mensagem: "Quero montar uma empresa do zero", modo: "projeto_completo" });
    expect(corpos("planejar")[0].respostas).toMatch(/^Público: /);
    expect(corpos("perguntas_do_pedido")).toHaveLength(1);
  });

  it("o exemplo troca a linha da mesma pergunta e soma as outras", () => {
    expect(preencherComExemplo("", "Público", "Donos de bar")).toBe("Público: Donos de bar");
    expect(preencherComExemplo("Público: Donos de bar\nPreço: R$ 47", "Público", "Médicos")).toBe("Público: Médicos\nPreço: R$ 47");
    expect(preencherComExemplo("Produto: curso", "Objetivo", "Vender direto")).toBe("Produto: curso\nObjetivo: Vender direto");
  });
});

// ------------------------------------------------------------------ trava do Pôr no ar

describe("Regra contra invenção: Pôr no ar travado", () => {
  const canvas: CanvasDoLab = {
    nos: [
      { id: "cp", tipo: "copy", x: 0, y: 0, dados: { titulo: "Copy da página", formato: "landing" } },
      { id: "lp", tipo: "landing", x: 320, y: 0, dados: {} },
      { id: "ar", tipo: "por_no_ar", x: 640, y: 0, dados: { alvo: "publicar_site" } },
    ],
    ligacoes: [{ id: "l1", de: "cp", para: "lp" }, { id: "l2", de: "lp", para: "ar" }],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  const saidaDaCopy = { texto: "Clientes amam. [RASCUNHO SEM FONTE: depoimento de cliente]", rascunho_sem_fonte: blocosSemFonte({ textos: ["Clientes amam. [RASCUNHO SEM FONTE: depoimento de cliente]"] }) };
  const linha = (saida: unknown) => ({ id: "e1", projeto_id: PROJETO, no_id: "cp", tipo: "copy", status: "pronto", saida, created_at: "2026-10-20T10:00:00Z" });

  it("a trava da tela é a mesma da função (ancestrais e motivo)", () => {
    const saidas = { cp: saidaDaCopy };
    const naFuncao = travaNaFuncao(normalizarCanvas(canvas), "ar", saidas);
    const naTela = travaNaTela(canvas, "ar", { cp: normalizarExecucao(linha(saidaDaCopy))!.saida.rascunho_sem_fonte });
    expect(naTela.travado).toBe(true);
    expect(naTela.motivo).toBe(naFuncao.motivo);
    expect(naTela.blocos.map((b) => [b.no_id, b.id, b.texto])).toEqual(naFuncao.blocos.map((b) => [b.no_id, b.id, b.texto]));
    let c = canvasVazio();
    for (const t of ["contexto", "pesquisa", "avatar", "oferta", "upsell", "secoes_pagina", "landing", "por_no_ar"] as const) c = criarNo(c, t, undefined, undefined, t).canvas;
    for (const [de, para] of [["contexto", "pesquisa"], ["pesquisa", "avatar"], ["avatar", "oferta"], ["oferta", "upsell"], ["upsell", "secoes_pagina"], ["secoes_pagina", "landing"], ["landing", "por_no_ar"]]) c = ligar(c, de, para);
    expect(c.ligacoes).toHaveLength(7);
    expect(ancestraisNaTela(c, "por_no_ar")).toEqual(ancestraisNaFuncao(normalizarCanvas(c), "por_no_ar"));
  });

  it("o nó mostra TRAVADO com o motivo e a lista; marcar a fonte confirmada chama bloco_resolver e destrava", async () => {
    const resolvida = resolverBloco(saidaDaCopy, "b1", { modo: "fonte", fonte: "Print autorizado da cliente Ana", por: "u1", quando: "2026-10-20" }).saida;
    funcao({
      projeto_ler: () => ({ projeto: projeto({ canvas }), cliente_nome: null, execucoes: { cp: linha(saidaDaCopy) } }),
      bloco_resolver: () => ({ execucao_id: "e1", execucao: linha(resolvida) }),
    });
    montarEditor();
    const lista = await abrirModoLista();
    await waitFor(() => expect(lista.querySelector('[data-linha-do-no="ar"] [data-trava-na-lista]')).not.toBeNull());
    expect(lista.querySelector('[data-linha-do-no="cp"] [data-trava-na-lista]')).toBeNull();
    fireEvent.click(within(lista.querySelector('[data-linha-do-no="ar"]') as HTMLElement).getAllByRole("button")[0]);

    const trava = await achar("[data-trava-no-ar]");
    expect(trava.textContent).toMatch(/Travado: 1 bloco\(s\) de prova ou número sem fonte em Copy da página/);
    expect(trava.querySelectorAll("[data-bloco-sem-fonte]")).toHaveLength(1);
    expect(trava.textContent).toContain("depoimento de cliente");
    const pedir = screen.getByRole("button", { name: "Pedir aprovação" }) as HTMLButtonElement;
    expect(pedir.disabled).toBe(true);
    expect(pedir.getAttribute("title")).toMatch(/^Travado/);

    // Só ícone nas ações (o nome no title).
    const marcar = within(trava).getByRole("button", { name: "Marcar fonte confirmada" });
    expect(marcar.textContent).toBe("");
    fireEvent.click(marcar);
    const confirmar = within(trava).getByRole("button", { name: "Confirmar a fonte" }) as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true);
    fireEvent.change(within(trava).getByLabelText("De onde vem a prova"), { target: { value: "Print autorizado da cliente Ana" } });
    fireEvent.click(confirmar);
    await waitFor(() => expect(corpos("bloco_resolver")).toHaveLength(1));
    expect(corpos("bloco_resolver")[0]).toEqual({ acao: "bloco_resolver", projeto_id: PROJETO, no_id: "cp", bloco_id: "b1", modo: "fonte", fonte: "Print autorizado da cliente Ana" });
    await waitFor(() => expect(document.querySelector("[data-trava-no-ar]")).toBeNull());
    expect((screen.getByRole("button", { name: "Pedir aprovação" }) as HTMLButtonElement).disabled).toBe(false);
    expect(corpos("no_executar")).toHaveLength(0);
  });

  it("no nó que escreveu, os blocos aparecem com editar (troca o trecho)", async () => {
    const editada = resolverBloco(saidaDaCopy, "b1", { modo: "editar", texto: "Atendimento no mesmo dia.", por: "u1", quando: "2026-10-20" }).saida;
    funcao({
      projeto_ler: () => ({ projeto: projeto({ canvas }), cliente_nome: null, execucoes: { cp: linha(saidaDaCopy) } }),
      bloco_resolver: () => ({ execucao_id: "e1", execucao: linha(editada) }),
    });
    montarEditor();
    const lista = await abrirModoLista();
    fireEvent.click(within(lista.querySelector('[data-linha-do-no="cp"]') as HTMLElement).getAllByRole("button")[0]);
    const blocos = await achar("[data-blocos-sem-fonte]");
    expect(blocos.hasAttribute("data-trava-no-ar")).toBe(false);
    expect(document.querySelector('[data-resultado-do-no="cp"] [data-sem-fonte-no-no]')).not.toBeNull();
    fireEvent.click(within(blocos).getByRole("button", { name: "Editar o trecho" }));
    const campo = within(blocos).getByLabelText("Texto novo do trecho") as HTMLTextAreaElement;
    expect(campo.value).toBe("depoimento de cliente");
    fireEvent.change(campo, { target: { value: "Atendimento no mesmo dia." } });
    fireEvent.click(within(blocos).getByRole("button", { name: "Salvar o trecho" }));
    await waitFor(() => expect(corpos("bloco_resolver")).toHaveLength(1));
    expect(corpos("bloco_resolver")[0]).toMatchObject({ modo: "editar", texto: "Atendimento no mesmo dia.", bloco_id: "b1", no_id: "cp" });
    await waitFor(() => expect(document.querySelector("[data-blocos-sem-fonte]")).toBeNull());
  });
});

// ------------------------------------------------------------------ templates e código

describe("Templates e código da v3", () => {
  it("os 3 templates novos usam os especialistas e terminam no Pôr no ar", () => {
    expect(TEMPLATES_OFICIAIS_V3.map((t) => t.nome)).toEqual(["High ticket com aplicação", "Lançamento", "Webinar"]);
    for (const t of TEMPLATES_OFICIAIS_V3) {
      expect(t.canvas.nos.some((n) => (TIPOS_DA_V3 as string[]).indexOf(n.tipo) >= 0), t.nome).toBe(true);
      expect(t.canvas.nos.some((n) => n.tipo === "por_no_ar"), t.nome).toBe(true);
    }
  });

  it("sem lookbehind, \\p{} nem grupo nomeado (nem em comentário)", () => {
    const arquivos = [
      "src/lib/laboratorio/nos.ts",
      "src/lib/laboratorio/api.ts",
      "src/lib/laboratorio/pedidoPendente.ts",
      "src/components/laboratorio/PerguntasGuiadas.tsx",
      "src/components/laboratorio/BlocosSemFonte.tsx",
      "src/components/laboratorio/CanvasStudio.tsx",
      "src/components/laboratorio/AbaInicio.tsx",
      "src/components/laboratorio/Inspetor.tsx",
      "src/components/laboratorio/QuadroDoLab.tsx",
      "src/components/laboratorio/ModoListaDoLab.tsx",
      "src/components/laboratorio/ResultadoDoNo.tsx",
      "src/components/laboratorio/EditorDoProjeto.tsx",
      "supabase/functions/laboratorio/modulos/regras.ts",
      "supabase/functions/laboratorio/modulos/prompts.ts",
      "supabase/functions/laboratorio/perguntas.ts",
    ];
    for (const a of arquivos) expect(/\(\?<[=!]|\\p\{|\(\?<[A-Za-z]/.test(ler(a)), a).toBe(false);
  });
});
