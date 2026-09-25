import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { MemoryRouter } from "react-router-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Estúdio grande (pedido do dono em 23/09, noite). Fixa:
 * - o Estúdio abre com um item selecionado (o último aberto; senão o primeiro de A fazer);
 * - arte antiga da tarefa (post sem arquivo principal, anexo da tarefa, item que já passou) conta como "Na agenda";
 * - o preço de cada qualidade (Rascunho, Padrão, Final) aparece no seletor;
 * - foto real composta: colar arquivo, papel, salvar chama configurar com fotos_livres;
 * - o Ampliar abre a lâmina no tamanho certo, sem espremer;
 * - o andamento da geração é um indicador só por lâmina.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), from: vi.fn(), upload: vi.fn(), download: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    rpc: mock.rpc,
    from: mock.from,
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: vi.fn(async () => ({ data: { signedUrl: "https://x/y.png" }, error: null })),
        upload: mock.upload,
        download: mock.download,
      })),
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import { ConfirmDialogProvider } from "@/components/shared/confirmDialog";
import AbaEstudio, { itemInicial, precosPorQualidade, QUALIDADES_DO_ESTUDIO } from "@/components/mesa/AbaEstudio";
import { Ampliar, PROPORCAO_PADRAO, tamanhoNoAmpliar } from "@/components/mesa/Ampliar";
import EstudioFotos, { corpoDasFotos, imagensDoColar, papelParaNova, trocarPapel } from "@/components/mesa/EstudioFotos";
import { emSemanas, inicioDaSemana, rotuloDaSemana } from "@/components/mesa/EstudioLista";
import EstudioLaminaGrande from "@/components/mesa/EstudioLaminaGrande";
import { passaNoFiltro } from "@/components/mesa/EstudioSituacao";
import PranchetaDoEstudio from "@/components/mesa/PranchetaDoEstudio";
import {
  dataLocal,
  janelaDaLista,
  janelaDeLeitura,
  laminasNaOrdem,
  lerDetalhesDosItens,
  PROXIMOS_DIAS,
  semPassadoVazio,
  type FotoLivre,
  type ItemDoMes,
} from "@/components/mesa/useItensDoMes";
import type { ModeloIa } from "@/lib/mesa/api";

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");

const CLIENTE = "11111111-1111-1111-1111-111111111111";

const modelo = (extra: Partial<ModeloIa>): ModeloIa => ({
  id: "x",
  provedor: "openai",
  modelo_api: "x",
  tipo: "texto",
  rotulo: "X",
  preco_entrada_1m: 1,
  preco_saida_1m: 2,
  preco_cache_1m: null,
  preco_imagem: null,
  raciocinio: [],
  padrao_para: [],
  ativo: true,
  ...extra,
});
const diretor = modelo({ id: "openai:diretor", padrao_para: ["diretor_arte"] });
const leitor = modelo({ id: "openai:leitor", rotulo: "Leitor", padrao_para: ["leitura"], preco_entrada_1m: 0.1, preco_saida_1m: 0.4 });
const imagem = modelo({
  id: "openai:imagem",
  tipo: "imagem",
  rotulo: "Imagem",
  preco_entrada_1m: 0,
  preco_saida_1m: 0,
  preco_imagem: { baixa: 0.01, media: 0.04, alta: 0.17 },
  padrao_para: ["imagem"],
});

const valorDaMesa = (extra: Partial<MesaValor> = {}): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Cliente sintético",
  userId: "u-1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 10,
  catalogo: [diretor, leitor, imagem],
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
  ...extra,
});

function envolver(filho: any, valor = valorDaMesa()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return h(MemoryRouter, null, h(QueryClientProvider, { client: qc }, h(ConfirmDialogProvider, null, h(MesaProvider, { valor }, filho))));
}

/** Banco falso: cada tabela devolve as linhas que passam nos filtros usados pela tela. */
function bancoFalso(tabelas: Record<string, any[]>) {
  return (nome: string) => {
    const filtros: ((r: any) => boolean)[] = [];
    const b: any = {
      select: () => b,
      order: () => b,
      eq: (c: string, v: unknown) => { filtros.push((r) => r[c] === v); return b; },
      neq: (c: string, v: unknown) => { filtros.push((r) => r[c] !== v); return b; },
      in: (c: string, vs: unknown[]) => { filtros.push((r) => vs.indexOf(r[c]) >= 0); return b; },
      is: (c: string, v: unknown) => { filtros.push((r) => (r[c] === undefined ? null : r[c]) === v); return b; },
      not: (c: string) => { filtros.push((r) => r[c] !== null && r[c] !== undefined); return b; },
      overlaps: (c: string, vs: unknown[]) => { filtros.push((r) => (r[c] || []).some((x: unknown) => vs.indexOf(x) >= 0)); return b; },
      gte: (c: string, v: string) => { filtros.push((r) => String(r[c]) >= v); return b; },
      lt: (c: string, v: string) => { filtros.push((r) => String(r[c]) < v); return b; },
      limit: () => b,
      range: () => b,
      contains: () => b,
      or: () => b,
      update: () => b,
      maybeSingle: () => Promise.resolve({ data: (tabelas[nome] || []).filter((r) => filtros.every((f) => f(r)))[0] || null, error: null }),
      then: (ok: any, erro: any) =>
        Promise.resolve({ data: (tabelas[nome] || []).filter((r) => filtros.every((f) => f(r))), error: null, count: 0 }).then(ok, erro),
    };
    return b;
  };
}

const daqui = (dias: number) => {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return dataLocal(d);
};

const item = (id: string, due = "2026-10-01"): ItemDoMes => ({ id, title: `Pauta ${id}`, due_date: due, delivery_type: "carousel", status: "todo", project_id: "p1" });

function limparNavegador() {
  try {
    window.sessionStorage.clear();
    window.localStorage.clear();
  } catch {
    /* sem storage */
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  limparNavegador();
});

// ---------------------------------------------------------------- dados da aba

const tarefas = [
  { id: "i-1", title: "Pauta sem nada", due_date: daqui(2), delivery_type: "carousel", status: "todo", project_id: "p1", deleted_at: null },
  { id: "i-2", title: "Pauta com arte antiga", due_date: daqui(-10), delivery_type: "carousel", status: "todo", project_id: "p1", deleted_at: null },
  { id: "i-3", title: "Pauta em produção", due_date: daqui(4), delivery_type: "carousel", status: "todo", project_id: "p1", deleted_at: null },
  { id: "i-4", title: "Pauta vencida e vazia", due_date: daqui(-5), delivery_type: "carousel", status: "todo", project_id: "p1", deleted_at: null },
];
const tabelasDaAba = {
  projects: [{ id: "p1", client_id: CLIENTE, deleted_at: null }],
  tasks: tarefas,
  estudio_trabalhos: [
    {
      id: "t-3",
      client_id: CLIENTE,
      task_id: "i-3",
      status: "dirigido",
      direcao: { conceito: "Conceito", cards: [{ ordem: 1, funcao: "capa", texto_exato: "Título" }, { ordem: 2, texto_exato: "Segunda" }] },
      cards: [{ ordem: 1, versao: 1, storage_path: "c/estudio/t-3/card-1-v1.png", verificacao: { pendente: true } }],
      file_ids: [],
      custo_usd: 0,
      conversa_id: null,
      legenda: null,
      hashtags: [],
      atualizado_em: "2026-09-23T00:00:00Z",
      criado_em: "2026-09-23",
    },
  ],
  editorial_post_internal: [{ post_id: "p-2", task_id: "i-2", revision_of_post_id: null }],
  // Post de antes do Estúdio: sem arquivo principal, a arte está só na publicação.
  editorial_posts: [{ id: "p-2", title: "Post antigo", default_caption: "Legenda antiga", production_status: "ready", primary_file_id: null, archived_at: null }],
  editorial_publications: [{ post_id: "p-2", file_id: "f-2", status: "published", scheduled_at: "2026-09-10T12:00:00Z", delivery_mode: "manual", published_at: "2026-09-10T12:00:00Z", permalink: null }],
  staff_files_secure: [{ id: "f-2", file_name: "arte antiga.png", file_url: "files://c/f2.png", storage_bucket: "files", storage_path: "c/f2.png", mime_type: "image/png", parent_file_id: null, archived_at: null }],
  calendario_propostas: [],
  task_attachments: [],
};

function montarAba(tarefaId: string | null, onTarefa = vi.fn()) {
  return render(envolver(h(AbaEstudio, { mes: "2026-09-01", onMes: vi.fn(), tarefaId, onTarefa })));
}

async function comLargura<T>(largura: number, fn: () => Promise<T>): Promise<T> {
  const antes = window.innerWidth;
  (window as any).innerWidth = largura;
  try {
    return await fn();
  } finally {
    (window as any).innerWidth = antes;
  }
}

describe("o Estúdio abre com um item selecionado", () => {
  it("sem item na URL: abre o primeiro de A fazer, sem mexer no endereço", async () => {
    mock.from.mockImplementation(bancoFalso(tabelasDaAba));
    await comLargura(1440, async () => {
      const onTarefa = vi.fn();
      montarAba(null, onTarefa);
      // i-1 é o primeiro de "A fazer" (i-2 já tem arte, i-4 venceu vazio e nem entra).
      expect(await screen.findByText("Preparar a direção")).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Pauta sem nada" })).toBeTruthy();
      expect(onTarefa).not.toHaveBeenCalled();
      // O cartão aberto fica marcado na faixa.
      const cartao = screen.getAllByTitle("Pauta sem nada").find((e) => e.tagName === "BUTTON");
      expect(cartao?.getAttribute("aria-current")).toBe("true");
    });
  });

  it("volta no último aberto neste cliente; o clique na faixa grava o item na URL e como último", async () => {
    mock.from.mockImplementation(bancoFalso(tabelasDaAba));
    window.localStorage.setItem(`mesa:estudio:ultimo:${CLIENTE}`, "i-3");
    await comLargura(1440, async () => {
      const onTarefa = vi.fn();
      montarAba(null, onTarefa);
      expect(await screen.findByText("Prancheta")).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Pauta em produção" })).toBeTruthy();
      fireEvent.click(screen.getByTitle("Pauta sem nada"));
      expect(onTarefa).toHaveBeenCalledWith("i-1");
      expect(window.localStorage.getItem(`mesa:estudio:ultimo:${CLIENTE}`)).toBe("i-1");
    });
  });

  it("regra pura: último se ainda está na faixa; senão o primeiro de A fazer; senão o primeiro", () => {
    const itens = ["a", "b", "c"].map((id) => item(id));
    const aFazer = (i: ItemDoMes) => i.id !== "a";
    expect(itemInicial(itens, "c", aFazer)).toBe("c");
    expect(itemInicial(itens, "sumiu", aFazer)).toBe("b");
    expect(itemInicial(itens, null, () => false)).toBe("a");
    expect(itemInicial([], "c", aFazer)).toBeNull();
  });
});

describe("arte antiga da tarefa conta como Na agenda", () => {
  it("post sem arquivo principal (arte na publicação), anexo de imagem da tarefa; vídeo não conta", async () => {
    mock.from.mockImplementation(
      bancoFalso({
        estudio_trabalhos: [],
        calendario_propostas: [],
        editorial_post_internal: [
          { post_id: "p-1", task_id: "i-1", revision_of_post_id: null },
          { post_id: "p-5", task_id: "i-5", revision_of_post_id: null },
        ],
        editorial_posts: [
          { id: "p-1", title: "Antigo", default_caption: "Legenda", production_status: "ready", primary_file_id: null, archived_at: null },
          { id: "p-5", title: "Reel", default_caption: null, production_status: "ready", primary_file_id: "f-video", archived_at: null },
        ],
        editorial_publications: [{ post_id: "p-1", file_id: "f-1", status: "published", scheduled_at: "2026-09-01T12:00:00Z" }],
        staff_files_secure: [
          { id: "f-1", file_name: "carrossel.png", file_url: "files://c/f1.png", storage_bucket: "files", storage_path: "c/f1.png", mime_type: "image/png" },
          { id: "f-video", file_name: "reel.mp4", file_url: "files://c/reel.mp4", storage_bucket: "files", storage_path: "c/reel.mp4", mime_type: "video/mp4" },
        ],
        task_attachments: [{ id: "a-3", task_id: "i-3", file_name: "arte.jpg", file_url: "https://cdn.exemplo/arte.jpg", file_type: "image/jpeg", created_at: "2026-08-01" }],
      }),
    );
    const dados = await lerDetalhesDosItens(CLIENTE, ["i-1", "i-3", "i-5"].map((id) => item(id)));
    expect(dados.artes["i-1"]).toMatchObject({ post_id: "p-1", capa: { id: "f-1", caminho: "c/f1.png" }, origem: "post" });
    expect(dados.artes["i-3"]).toMatchObject({ post_id: "", origem: "anexo", capa: { url: "https://cdn.exemplo/arte.jpg" } });
    expect(dados.artes["i-5"]).toBeUndefined();
    // Cache só com JSON puro.
    expect(JSON.parse(JSON.stringify(dados))).toEqual(dados);
    expect(passaNoFiltro("na_agenda", null, dados.artes["i-1"])).toBe(true);
    expect(passaNoFiltro("a_fazer", null, dados.artes["i-3"])).toBe(false);
  });

  it("os próximos 60 dias leem 45 dias para trás; do passado só fica o item com arte ou trabalho", () => {
    const agora = new Date(2026, 8, 23, 15, 0);
    expect(janelaDaLista(PROXIMOS_DIAS, agora)).toEqual({ inicio: "2026-09-23", fimExclusivo: "2026-11-23" });
    expect(janelaDeLeitura(PROXIMOS_DIAS, agora)).toEqual({ inicio: "2026-08-09", fimExclusivo: "2026-11-23" });
    expect(janelaDeLeitura("2026-09-01", agora)).toEqual({ inicio: "2026-09-01", fimExclusivo: "2026-10-01" });
    const dados = {
      itens: [item("velho-com-arte", "2026-09-01"), item("velho-vazio", "2026-09-02"), item("velho-em-producao", "2026-09-03"), item("hoje", "2026-09-23")],
      trabalhos: { "velho-em-producao": { id: "t" } as any },
      publicacoes: {},
      roteiros: {},
      artes: { "velho-com-arte": { post_id: "p", titulo: null, legenda: null, status: null, capa: null, do_estudio: false } },
    };
    expect(semPassadoVazio(dados, "2026-09-23").itens.map((i) => i.id)).toEqual(["velho-com-arte", "velho-em-producao", "hoje"]);
  });

  it("na aba: a arte antiga (antes de hoje) aparece em Na agenda com contagem", async () => {
    mock.from.mockImplementation(bancoFalso(tabelasDaAba));
    await comLargura(1440, async () => {
      montarAba("i-1");
      const naAgenda = await screen.findByRole("tab", { name: /Na agenda/ });
      await waitFor(() => expect(naAgenda.textContent).toContain("1"));
      fireEvent.click(naAgenda);
      expect(await screen.findByTitle("Pauta com arte antiga")).toBeTruthy();
      // Pauta vencida sem arte nem trabalho não volta.
      expect(screen.queryByTitle("Pauta vencida e vazia")).toBeNull();
    });
  });

  it("carrossel da Agenda na ordem do slider; filha que não é imagem fica de fora", () => {
    const capa = { id: "raiz", nome: "Carrossel (1/3).png", bucket: "files", caminho: "c/raiz.png", url: null };
    const filhas = [
      { id: "f3", file_name: "Carrossel (3/3).png", file_url: "files://c/3.png", storage_bucket: "files", storage_path: "c/3.png", created_at: "2026-09-01T10:00:00Z" },
      { id: "f2", file_name: "Carrossel (2/3).png", file_url: "files://c/2.png", storage_bucket: "files", storage_path: "c/2.png", created_at: "2026-09-01T11:00:00Z" },
      { id: "fv", file_name: "bastidores.mp4", file_url: "files://c/v.mp4", storage_bucket: "files", storage_path: "c/v.mp4", created_at: "2026-09-01T12:00:00Z" },
    ];
    expect(laminasNaOrdem(capa, filhas).map((a) => a.id)).toEqual(["raiz", "f2", "f3"]);
  });
});

describe("a faixa das pautas: posts lado a lado por semana", () => {
  it("semana de segunda a domingo, em ordem; rótulo curto", () => {
    expect(inicioDaSemana("2026-09-23")).toBe("2026-09-21");
    expect(inicioDaSemana("2026-09-27")).toBe("2026-09-21");
    expect(inicioDaSemana("2026-09-28")).toBe("2026-09-28");
    expect(rotuloDaSemana("2026-09-21")).toBe("21 a 27/09");
    expect(rotuloDaSemana("2026-09-28")).toBe("28/09 a 04/10");
    const semanas = emSemanas([item("b", "2026-09-30"), item("a", "2026-09-22"), { ...item("s"), due_date: null }, item("c", "2026-09-24")]);
    expect(semanas.map((s) => [s.semana, s.itens.map((i) => i.id)])).toEqual([
      ["2026-09-21", ["a", "c"]],
      ["2026-09-28", ["b"]],
      ["", ["s"]],
    ]);
  });
});

describe("o preço de cada qualidade aparece no seletor", () => {
  it("Rascunho, Padrão e Final com o preço estimado por lâmina", () => {
    const precos = precosPorQualidade(imagem.id, leitor.id, [imagem, leitor]);
    expect(QUALIDADES_DO_ESTUDIO.map((q) => q.rotulo)).toEqual(["Rascunho", "Padrão", "Final"]);
    for (const q of ["baixa", "media", "alta"] as const) expect(precos[q]).toMatch(/^~US\$ /);
    expect(precos.baixa).not.toBe(precos.alta);
    // Sem gerador escolhido não inventa preço.
    expect(precosPorQualidade("", leitor.id, [imagem, leitor])).toEqual({ baixa: "", media: "", alta: "" });
  });

  it("na barra do item, cada botão de qualidade mostra o preço", async () => {
    mock.from.mockImplementation(bancoFalso(tabelasDaAba));
    await comLargura(1440, async () => {
      montarAba("i-3");
      const grupo = await screen.findByRole("radiogroup", { name: "Qualidade da lâmina" });
      const botoes = grupo.querySelectorAll("[role=radio]");
      expect(botoes.length).toBe(3);
      expect(botoes[0].textContent).toMatch(/Rascunho~US\$ /);
      expect(botoes[1].textContent).toMatch(/Padrão~US\$ /);
      expect(botoes[2].textContent).toMatch(/Final~US\$ /);
    });
  });
});

describe("foto real composta (fotos_livres)", () => {
  it("papel: primeiro fundo, depois até 2 elementos; virar fundo troca o anterior", () => {
    const f = (caminho: string, papel: FotoLivre["papel"]): FotoLivre => ({ caminho, papel });
    expect(papelParaNova([])).toBe("fundo");
    expect(papelParaNova([f("a", "fundo")])).toBe("elemento");
    expect(papelParaNova([f("a", "fundo"), f("b", "elemento"), f("c", "elemento")])).toBeNull();
    expect(trocarPapel([f("a", "fundo"), f("b", "elemento")], 1, "fundo")).toEqual([f("a", "elemento"), f("b", "fundo")]);
    expect(trocarPapel([f("a", "fundo"), f("b", "elemento"), f("c", "elemento")], 0, "elemento")).toBeNull();
    expect(corpoDasFotos(3, [{ caminho: "x", papel: "elemento", nota: "  rosto à direita  " }, { caminho: "y", papel: "fundo", nota: "" }])).toEqual({
      card: { ordem: 3, fotos_livres: [{ caminho: "x", papel: "elemento", nota: "rosto à direita" }, { caminho: "y", papel: "fundo" }] },
    });
    expect(corpoDasFotos(1, [])).toEqual({ card: { ordem: 1, fotos_livres: [] } });
  });

  it("o colar só reconhece arquivo de imagem; texto passa direto", () => {
    const arquivo = new File(["x"], "rosto.png", { type: "image/png" });
    const comArquivo = { items: [{ kind: "file", type: "image/png", getAsFile: () => arquivo }], files: [] } as unknown as DataTransfer;
    const soTexto = { items: [{ kind: "string", type: "text/plain", getAsFile: () => null }], files: [] } as unknown as DataTransfer;
    expect(imagensDoColar(comArquivo)).toEqual([arquivo]);
    expect(imagensDoColar(soTexto)).toEqual([]);
    expect(imagensDoColar(null)).toEqual([]);
  });

  it("Ctrl+V com arquivo sobe no bucket mesa e grava na hora; papel e nota também gravam sozinhos (sem Salvar)", async () => {
    mock.upload.mockResolvedValue({ data: {}, error: null });
    const onSalvar = vi.fn().mockResolvedValue(undefined);
    render(envolver(h(EstudioFotos, { card: { ordem: 2, fotos_livres: [] }, ocupado: false, temArte: true, onSalvar })));

    // Colar texto não sobe nada.
    const colarTexto = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(colarTexto, "clipboardData", { value: { items: [{ kind: "string", type: "text/plain", getAsFile: () => null }], files: [] } });
    act(() => { window.dispatchEvent(colarTexto); });
    expect(colarTexto.defaultPrevented).toBe(false);
    expect(mock.upload).not.toHaveBeenCalled();

    // Colar a foto: sobe e vira o fundo.
    const arquivo = new File(["x"], "fundo.png", { type: "image/png" });
    const colar = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(colar, "clipboardData", { value: { items: [{ kind: "file", type: "image/png", getAsFile: () => arquivo }], files: [] } });
    act(() => { window.dispatchEvent(colar); });
    expect(colar.defaultPrevented).toBe(true);
    await waitFor(() => expect(mock.upload).toHaveBeenCalledTimes(1));
    const caminho = mock.upload.mock.calls[0][0] as string;
    expect(caminho).toMatch(new RegExp(`^${CLIENTE}/estudio/fotos/[0-9a-f-]{36}\\.png$`));
    const papel = await screen.findByRole("radiogroup", { name: "Papel da foto 1" });
    expect(papel.querySelector("[aria-checked=true]")?.textContent).toBe("Fundo");
    // Subiu e já gravou na lâmina, sem botão de salvar (dono, 25/09: "salvar lâmina não atualiza").
    await waitFor(() => expect(onSalvar).toHaveBeenCalledWith({ card: { ordem: 2, fotos_livres: [{ caminho, papel: "fundo" }] } }));
    expect(screen.queryByRole("button", { name: /Salvar na lâmina/ })).toBeNull();

    // Vira elemento: grava na hora. A nota grava ao sair do campo.
    fireEvent.click(screen.getByRole("radio", { name: "Elemento" }));
    await waitFor(() => expect(onSalvar).toHaveBeenCalledWith({ card: { ordem: 2, fotos_livres: [{ caminho, papel: "elemento" }] } }));
    const nota = screen.getByLabelText("Como usar a foto 1");
    fireEvent.change(nota, { target: { value: "rosto à direita, olhando para o texto" } });
    fireEvent.blur(nota);
    await waitFor(() =>
      expect(onSalvar).toHaveBeenCalledWith({ card: { ordem: 2, fotos_livres: [{ caminho, papel: "elemento", nota: "rosto à direita, olhando para o texto" }] } }),
    );
  });

  it("miniatura com remover; remover grava na hora e limpa com []", async () => {
    const onSalvar = vi.fn().mockResolvedValue(undefined);
    render(
      envolver(
        h(EstudioFotos, { card: { ordem: 1, fotos_livres: [{ caminho: `${CLIENTE}/estudio/fotos/a.png`, papel: "fundo" }] }, ocupado: false, temArte: false, onSalvar }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remover a foto 1" }));
    await waitFor(() => expect(onSalvar).toHaveBeenCalledWith({ card: { ordem: 1, fotos_livres: [] } }));
  });

  it("a ferramenta Fotos está na barra do estúdio e grava pelo configurar da lâmina", () => {
    const estudio = ler("src/components/mesa/AbaEstudio.tsx");
    expect(estudio).toContain('producao: ["lamina", "diretor", "fotos", "referencias", "conjunto", "legenda", "entrega"]');
    expect(estudio).toContain("onSalvar={(corpo) => configurar(corpo)}");
    expect(estudio).toContain('await chamarFuncao<{ trabalho?: TrabalhoGravado }>("estudio-arte", { acao: "configurar", trabalho_id: trabalho.id, ...corpo });');
    // O trabalho devolvido entra no cache na hora: a escolha aparece na lâmina sem esperar a lista do mês.
    expect(estudio).toContain("gravarTrabalhoNoCache(queryClient, clientId, r && r.trabalho);");
  });
});

describe("o Ampliar abre a lâmina inteira, sem espremer", () => {
  it("4:5 e 1:1 mantêm a proporção e cabem em ~90% da altura", () => {
    for (const [p, w, hh] of [[0.8, 1440, 900], [1, 1440, 900], [0.8, 390, 844], [1, 1024, 640]] as const) {
      const t = tamanhoNoAmpliar(p, w, hh);
      expect(Math.abs(t.largura / t.altura - p)).toBeLessThan(0.01);
      expect(t.altura).toBeLessThanOrEqual(hh * 0.9);
      expect(t.largura).toBeLessThanOrEqual(w * 0.94);
    }
    // No computador a lâmina 4:5 fica grande (bem acima dos 512 px do Dialog padrão).
    expect(tamanhoNoAmpliar(PROPORCAO_PADRAO, 1440, 900).altura).toBeGreaterThan(650);
    expect(tamanhoNoAmpliar(null, 1440, 900)).toEqual(tamanhoNoAmpliar(0.8, 1440, 900));
  });

  it("a janela acompanha a imagem (sem max-w-lg) e o quadro tem largura e altura em px", async () => {
    render(envolver(h(Ampliar, { imagens: [{ caminho: "a.png", titulo: "Lâmina 1", proporcao: 1 }, { caminho: "b.png", titulo: "Lâmina 2" }], indice: 0, onFechar: vi.fn() })));
    const dialogo = await screen.findByRole("dialog");
    expect(dialogo.className).toContain("max-w-none");
    expect(dialogo.className).not.toContain("max-w-lg");
    const quadro = await waitFor(() => {
      const q = document.querySelector("[data-ampliar-quadro]") as HTMLElement | null;
      if (!q) throw new Error("sem quadro");
      return q;
    });
    expect(quadro.style.width).toMatch(/px$/);
    expect(parseInt(quadro.style.width, 10)).toBe(parseInt(quadro.style.height, 10));
    // Navega entre as lâminas.
    fireEvent.click(screen.getByRole("button", { name: "Próxima imagem" }));
    expect(await screen.findByText("2 de 2")).toBeTruthy();
    const ampliar = ler("src/components/mesa/Ampliar.tsx");
    // Sem min() no CSS (o Chrome 64 não entende e caía no max-w-lg de 512 px).
    expect(ampliar).not.toContain("max-w-[min(");
  });
});

describe("o andamento da geração é um indicador só por lâmina", () => {
  it("cada lâmina em andamento tem um status (etapa e tempo); a barrinha some no lugar dele", () => {
    const cards = [{ ordem: 1, funcao: "capa" }, { ordem: 2 }, { ordem: 3 }];
    const acoes = vi.fn(() => h("span", null, "ação"));
    render(
      envolver(
        h(PranchetaDoEstudio, {
          cards,
          ultimas: new Map(),
          selecionado: 1,
          onSelecionar: vi.fn(),
          andamento: { 1: { etapa: "gerando", desde: Date.now() - 16000 }, 2: { etapa: "fila", desde: Date.now() } },
          infinito: false,
          largura: 112,
          orientacao: "vertical",
          podeReordenar: false,
          onReordenar: vi.fn(),
          acoes,
        }),
      ),
    );
    // Só os indicadores da lâmina (o dnd-kit tem uma região de aviso própria, também "status").
    const status = Array.from(document.querySelectorAll("[data-progresso-da-lamina]")) as HTMLElement[];
    expect(status.length).toBe(2);
    expect(status[0].getAttribute("aria-label")).toBe("Lâmina 1: gerando");
    expect(status[0].textContent).toMatch(/gerando\s*1[6-7] s/);
    expect(status[1].getAttribute("aria-label")).toBe("Lâmina 2: na fila");
    expect(status[1].textContent).not.toMatch(/ s$/);
    // Só a lâmina livre mostra as ações.
    expect(screen.getAllByText("ação").length).toBe(1);
  });

  it("a lâmina grande e a ferramenta Lâmina não repetem o indicador", () => {
    render(
      envolver(
        h(EstudioLaminaGrande, {
          card: { ordem: 1, funcao: "capa" },
          total: 2,
          versoes: [{ ordem: 1, versao: 1, storage_path: "c/1.png" }],
          versaoVista: null,
          onVersaoVista: vi.fn(),
          desenhandoAreas: false,
          areas: [],
          onAreas: vi.fn(),
          ocupado: true,
          onAmpliar: vi.fn(),
        }),
      ),
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(ler("src/components/mesa/EstudioLaminaGrande.tsx")).not.toContain("Cronometro");
    const card = ler("src/components/mesa/CardDoEstudio.tsx");
    expect(card).not.toContain("gerandoDesde");
    expect(card).toContain("function BotaoDaLamina({ emAndamento, ...props }");
    const estudio = ler("src/components/mesa/AbaEstudio.tsx");
    expect(estudio).not.toContain("Cronometro");
    expect(estudio).not.toContain("gerando ${");
    // O cronômetro não recomeça entre as etapas (gerando -> conferindo).
    expect(estudio).toContain('const desde = antes && antes.etapa !== "fila" && etapa !== "fila" ? antes.desde : Date.now();');
  });
});
