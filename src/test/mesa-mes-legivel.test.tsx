import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { act, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Aba Mês legível (pedido do dono em 23/09): o calendário do mês com título
 * inteiro, formato, horário, miniatura da arte e as cores e selos da Agenda;
 * o agente do mês nunca espreme o calendário; microfone no agente, escrevendo
 * enquanto a pessoa fala; colar texto (Wispr Flow) nunca vira anexo.
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  upload: vi.fn(),
  tabelas: {} as Record<string, unknown>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "gte", "lt", "lte", "gt", "overlaps", "contains", "order", "limit", "range"]) b[m] = () => b;
    const primeiro = () => ({ data: Array.isArray(dados) ? (dados[0] === undefined ? null : dados[0]) : dados, error: null });
    b.maybeSingle = () => Promise.resolve(primeiro());
    b.single = () => Promise.resolve(primeiro());
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null, count: Array.isArray(dados) ? dados.length : 0 }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: vi.fn(),
      from: (tabela: string) => consulta(tabela),
      storage: {
        from: () => ({
          upload: mock.upload,
          createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/assinada.png" }, error: null }),
        }),
      },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import AgendaDoMes from "@/components/mesa/AgendaDoMes";
import AgenteDoMes from "@/components/mesa/AgenteDoMes";
import { colagemEhImagem } from "@/components/mesa/AnexosDoPedido";
import { montarArtesDoMes } from "@/components/mesa/MesArtes";
import { etapaDoPost } from "@/components/mesa/MesCartoes";
import type { EditorialFileRow } from "@/hooks/useEditorialCalendar";
import type { ModeloIa } from "@/lib/mesa/api";

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");

const CLIENTE = "11111111-1111-1111-1111-111111111111";

const catalogo: ModeloIa[] = [
  {
    id: "openai:gpt-texto", provedor: "openai", modelo_api: "gpt-texto", tipo: "texto", rotulo: "Texto",
    preco_entrada_1m: 1, preco_saida_1m: 2, preco_cache_1m: null, preco_imagem: null,
    raciocinio: ["low"], padrao_para: ["estrategista"], ativo: true,
  },
];

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Cliente sintético",
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

function montar(filho: any, rota = "/mesa?client=c&mes=2026-09-01") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(MemoryRouter, { initialEntries: [rota] }, h(QueryClientProvider, { client: qc }, h(TooltipProvider, null, h(MesaProvider, { valor: valorDaMesa() }, filho)))),
  );
}

const arquivo = (id: string, extra: Partial<EditorialFileRow> = {}): EditorialFileRow => ({
  id,
  client_id: CLIENTE,
  project_id: "proj",
  file_name: `${id}.png`,
  mime_type: "image/png",
  file_url: `https://arquivo.test/${id}.png`,
  storage_bucket: null,
  storage_path: null,
  approval_status: "pending",
  visibility: "internal",
  locked_at: null,
  status: "ready",
  archived_at: null,
  parent_file_id: null,
  ...extra,
});

const TITULO_LONGO = "Carrossel com as cinco perguntas que todo cliente faz antes de fechar o projeto de marcenaria sob medida e as respostas honestas";

beforeEach(() => {
  vi.clearAllMocks();
  mock.tabelas = {};
  mock.upload.mockResolvedValue({ data: {}, error: null });
  mock.invoke.mockResolvedValue({ data: {}, error: null });
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

afterEach(() => {
  delete (window as any).webkitSpeechRecognition;
});

describe("agenda do mês legível", () => {
  beforeEach(() => {
    mock.tabelas.tasks = [
      { id: "t1", title: TITULO_LONGO, description: "Contexto do item", due_date: "2026-09-15", delivery_type: "carousel", status: "doing", project_id: "proj" },
      { id: "t2", title: "Post estático sem arte ainda", description: null, due_date: "2026-09-16", delivery_type: "static", status: "todo", project_id: "proj" },
    ];
    mock.tabelas.estudio_trabalhos = [
      { id: "w1", task_id: "t1", client_id: CLIENTE, status: "entregue", entrega_status: "aguardando_cliente", file_ids: ["capa1", "f2", "f3"], cards: [], direcao: null, atualizado_em: "2026-09-22T12:00:00Z" },
    ];
    mock.tabelas.staff_files_secure = [
      arquivo("capa1"),
      arquivo("f2", { parent_file_id: "capa1", file_name: "Tema (2/3)" }),
      arquivo("f3", { parent_file_id: "capa1", file_name: "Tema (3/3)" }),
    ];
  });

  it("a miniatura da arte aparece no dia, com o selo Arte pronta e as lâminas", async () => {
    const { container } = montar(h(AgendaDoMes, {}));
    await waitFor(() => {
      const dia = container.querySelector('[data-dia="2026-09-15"]');
      expect(dia && dia.querySelector('img[src="https://arquivo.test/capa1.png"]')).toBeTruthy();
    });
    const dia = container.querySelector('[data-dia="2026-09-15"]') as HTMLElement;
    expect(dia.textContent).toContain("Arte pronta · aguardando aprovação");
    expect(dia.textContent).toContain("3 lâminas");
    expect(dia.textContent).toContain("Carrossel");
    // O dia sem arte não inventa miniatura.
    const outro = container.querySelector('[data-dia="2026-09-16"]') as HTMLElement;
    expect(outro.querySelector("img")).toBeNull();
    expect(outro.textContent).toContain("Post estático");
  });

  it("o título aparece em até 3 linhas e inteiro no tooltip", async () => {
    const { container } = montar(h(AgendaDoMes, {}));
    await waitFor(() => expect(container.querySelector('[data-dia="2026-09-15"] [data-cartao="item"]')).toBeTruthy());
    const cartao = container.querySelector('[data-dia="2026-09-15"] [data-cartao="item"]') as HTMLElement;
    expect(cartao.getAttribute("title")).toContain(TITULO_LONGO);
    const candidatos = Array.prototype.slice.call(cartao.querySelectorAll("span")).filter((s: HTMLElement) => s.textContent === TITULO_LONGO);
    const titulo = candidatos[candidatos.length - 1] as HTMLElement;
    expect(titulo.className).toContain("line-clamp-3");
    expect(titulo.className).not.toContain("truncate");
  });

  it("a grade garante 150 px por dia e rola de lado em vez de espremer; a seleção fica abaixo", async () => {
    const { container } = montar(h(AgendaDoMes, {}));
    await waitFor(() => expect(container.querySelector('[data-dia="2026-09-15"]')).toBeTruthy());
    const grade = container.querySelector('[data-vista="mes"]') as HTMLElement;
    expect(grade.className).toContain("overflow-x-auto");
    expect((grade.firstElementChild as HTMLElement).className).toContain("min-w-[1050px]");
    expect(container.querySelector("#selecao-do-mes")).toBeTruthy();
    const fonte = ler("src/components/mesa/AgendaDoMes.tsx");
    expect(fonte).not.toContain("xl:grid-cols-[minmax(0,1fr)_340px]");
  });

  it("Mês, Semana e Lista: a lista mostra cartões grandes com a miniatura", async () => {
    const { container } = montar(h(AgendaDoMes, {}));
    await waitFor(() => expect(container.querySelector('[data-dia="2026-09-15"]')).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: /Lista/ }));
    await waitFor(() => expect(container.querySelector('[data-vista="mes"]')).toBeNull());
    const lista = container.querySelector('[data-vista="lista"]') as HTMLElement;
    expect(lista.className).toContain("overflow-y-auto");
    await waitFor(() => expect(lista.querySelector('img[src="https://arquivo.test/capa1.png"]')).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: /Semana/ }));
    expect(container.querySelector('[data-vista="semana"]')).toBeTruthy();
  });

  it("clicar no cartão seleciona o item e ele aparece no painel de baixo", async () => {
    const { container } = montar(h(AgendaDoMes, {}));
    await waitFor(() => expect(container.querySelector('[data-dia="2026-09-15"] [data-cartao="item"]')).toBeTruthy());
    fireEvent.click(container.querySelector('[data-dia="2026-09-15"] [data-cartao="item"]') as HTMLElement);
    const selecao = container.querySelector("#selecao-do-mes") as HTMLElement;
    expect(selecao.textContent).toContain(TITULO_LONGO);
    expect(screen.getByRole("button", { name: /Completar e melhorar com o agente/ })).toBeTruthy();
  });
});

describe("artes do mês e cores da Agenda", () => {
  it("item com arte do Estúdio e post com arquivo principal ganham miniatura; JSON puro", () => {
    const artes = montarArtesDoMes(
      CLIENTE,
      [
        { task_id: "t1", client_id: CLIENTE, status: "entregue", entrega_status: null, file_ids: ["capa1"], atualizado_em: "2026-09-22" },
        { task_id: "t2", client_id: CLIENTE, status: "dirigido", entrega_status: null, file_ids: [], atualizado_em: "2026-09-22" },
      ],
      [{ post_id: "p1", arquivo_id: "capaP" }, { post_id: "p2", arquivo_id: null }],
      [arquivo("capa1"), arquivo("capaP")],
      [],
    );
    expect(Object.keys(artes.porItem)).toEqual(["t1"]);
    expect(Object.keys(artes.porPost)).toEqual(["p1"]);
    expect(JSON.parse(JSON.stringify(artes))).toEqual(artes);
  });

  it("a etapa do post segue a Agenda (publicado, falhou, programado)", () => {
    const futuro = new Date(Date.now() + 86400000).toISOString();
    expect(etapaDoPost({ producao: null, status: "published", scheduled_at: futuro })).toBe("published");
    expect(etapaDoPost({ producao: null, status: "partially_published", scheduled_at: futuro })).toBe("published");
    expect(etapaDoPost({ producao: null, status: "failed", scheduled_at: futuro })).toBe("failed");
    expect(etapaDoPost({ producao: null, status: "scheduled", scheduled_at: futuro })).toBe("scheduled");
  });
});

describe("agente do mês não espreme o calendário", () => {
  it("coluna ao lado só a partir de 1800 px e recolhível; abaixo disso, gaveta com botão fixo", () => {
    const aba = ler("src/components/mesa/AbaMes.tsx");
    expect(aba).toContain('export const TELA_DO_AGENTE_AO_LADO = "(min-width: 1800px)"');
    expect(aba).toContain("useMidia(TELA_DO_AGENTE_AO_LADO)");
    expect(aba).not.toContain("xl:grid-cols-[minmax(0,1fr)_380px]");
    expect(aba).toContain('<SheetContent side="right"');
    expect(aba).toContain("Agente do mês");
    expect(aba).toContain("const aoLado = larga && !recolhido;");
  });
});

// ------------------------------------------------------------------ microfone e colagem

class ReconhecedorFalso {
  static ultimo: ReconhecedorFalso | null = null;
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onend: (() => void) | null = null;
  constructor() {
    ReconhecedorFalso.ultimo = this;
  }
  start() {}
  stop() {
    if (this.onend) this.onend();
  }
  abort() {}
}

describe("microfone no agente do mês", () => {
  it("o botão fica ao lado do Enviar e o texto aparece no campo enquanto a pessoa fala", async () => {
    (window as any).webkitSpeechRecognition = ReconhecedorFalso;
    montar(h(AgenteDoMes, {}));
    const microfone = screen.getByRole("button", { name: "Falar em vez de digitar" });
    fireEvent.click(microfone);
    const r = ReconhecedorFalso.ultimo as ReconhecedorFalso;
    expect(r.lang).toBe("pt-BR");
    expect(r.interimResults).toBe(true);
    act(() => {
      r.onresult!({ resultIndex: 0, results: { length: 1, 0: { isFinal: false, 0: { transcript: "prepare três conteúdos" } } } });
    });
    expect((screen.getByLabelText("Pedido ao agente do mês") as HTMLTextAreaElement).value).toBe("Prepare três conteúdos");
    expect(screen.getByRole("button", { name: /Enviar/ })).toBeTruthy();
    const fonte = ler("src/components/mesa/AgenteDoMes.tsx");
    expect(fonte).toContain("<Ditado valor={texto} onChange={setTexto}");
  });

  it("a conversa com o estrategista também tem microfone", () => {
    expect(ler("src/components/mesa/AbaMes.tsx")).toContain("<Ditado valor={texto} onChange={setTexto}");
  });
});

describe("colar no campo do agente", () => {
  const colar = (alvo: HTMLElement, clipboardData: unknown) => {
    const evento = createEvent.paste(alvo, {});
    Object.defineProperty(evento, "clipboardData", { value: clipboardData });
    fireEvent(alvo, evento);
    return evento;
  };

  it("texto colado (Wispr Flow, Ctrl+V) segue para o campo, sem virar anexo", () => {
    montar(h(AgenteDoMes, {}));
    const campo = screen.getByLabelText("Pedido ao agente do mês");
    const evento = colar(campo, { files: [], getData: (t: string) => (t === "text/plain" ? "texto ditado" : "") });
    expect(evento.defaultPrevented).toBe(false);
    expect(mock.upload).not.toHaveBeenCalled();
  });

  it("texto com imagem de brinde (Word) também não é interceptado", () => {
    montar(h(AgenteDoMes, {}));
    const campo = screen.getByLabelText("Pedido ao agente do mês");
    const imagem = new File(["x"], "image.png", { type: "image/png" });
    const evento = colar(campo, { files: [imagem], getData: (t: string) => (t === "text/plain" ? "parágrafo copiado" : "") });
    expect(evento.defaultPrevented).toBe(false);
    expect(mock.upload).not.toHaveBeenCalled();
  });

  it("um print (só imagem) vira anexo", async () => {
    montar(h(AgenteDoMes, {}));
    const campo = screen.getByLabelText("Pedido ao agente do mês");
    const imagem = new File(["x"], "print.png", { type: "image/png" });
    const evento = colar(campo, { files: [imagem], getData: () => "" });
    expect(evento.defaultPrevented).toBe(true);
    await waitFor(() => expect(mock.upload).toHaveBeenCalledTimes(1));
  });

  it("a regra, direto", () => {
    expect(colagemEhImagem(null)).toBe(false);
    expect(colagemEhImagem({ files: [], getData: () => "oi" })).toBe(false);
    expect(colagemEhImagem({ files: [new File(["x"], "a.png", { type: "image/png" })], getData: () => "  " })).toBe(true);
    expect(colagemEhImagem({ files: [new File(["x"], "a.png", { type: "image/png" })] })).toBe(true);
  });
});

describe("compatibilidade e texto nos arquivos da aba Mês", () => {
  it("sem lookbehind, \\p{}, grupo nomeado, aspect-ratio, :has, .at() nem travessão", () => {
    for (const rel of [
      "src/components/mesa/AbaMes.tsx",
      "src/components/mesa/AgendaDoMes.tsx",
      "src/components/mesa/AgenteDoMes.tsx",
      "src/components/mesa/AnexosDoPedido.tsx",
      "src/components/mesa/HypesDaSemana.tsx",
      "src/components/mesa/MesArtes.tsx",
      "src/components/mesa/MesCartoes.tsx",
      "src/components/mesa/useAgendaDoMes.ts",
    ]) {
      const texto = ler(rel);
      expect(texto, rel).not.toContain("(?<");
      expect(texto, rel).not.toMatch(/\\p\{/);
      expect(texto, rel).not.toContain("aspect-[");
      expect(texto, rel).not.toContain("aspect-square");
      expect(texto, rel).not.toContain("has-[");
      expect(texto, rel).not.toContain(".at(");
      expect(texto, rel).not.toContain("@container");
      expect(texto, rel).not.toContain("—");
      expect(texto, rel).not.toContain("–");
    }
  });
});
