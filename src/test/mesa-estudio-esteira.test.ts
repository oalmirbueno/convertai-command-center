import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Estúdio como esteira de produção (pedido do dono em 23/09). Fixa:
 * - a chave da lista não leva o item aberto (clicar na lista não some com ela);
 * - o cache da lista é JSON puro (vai para o localStorage);
 * - item com arte na Agenda não conta em "A fazer";
 * - o preparo manda quantidade e contínuo decididos antes da direção;
 * - depois de entregar, o próprio Estúdio envia para aprovação;
 * - o esboço da lâmina sem arte não vaza da caixa.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    rpc: mock.rpc,
    from: mock.from,
    storage: { from: vi.fn(() => ({ createSignedUrl: vi.fn(async () => ({ data: { signedUrl: "https://x/y.png" }, error: null })) })) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import { ConfirmDialogProvider } from "@/components/shared/confirmDialog";
import AbaEstudio from "@/components/mesa/AbaEstudio";
import EstudioEntrega from "@/components/mesa/EstudioEntrega";
import EstudioPreparar from "@/components/mesa/EstudioPreparar";
import { contarFiltros, faltaEnviar, filtroValido, itemResolvido, passaNoFiltro, situacaoDoItem } from "@/components/mesa/EstudioSituacao";
import { medidasDoEsboco, respiroDoEsboco } from "@/components/mesa/PranchetaDoEstudio";
import { alturaDaEsteira, faixaDaLargura } from "@/components/mesa/EstudioAltura";
import { corpoDoPreparar, enviarUmParaAprovacao } from "@/components/mesa/estudioUtil";
import {
  chaveDosItens,
  dataLocal,
  lerDetalhesDosItens,
  paraMapas,
  type ArteNaAgenda,
  type ItemDoMes,
  type Trabalho,
} from "@/components/mesa/useItensDoMes";
import type { ModeloIa } from "@/lib/mesa/api";

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");
const estudio = ler("src/components/mesa/AbaEstudio.tsx");
const hook = ler("src/components/mesa/useItensDoMes.ts");
const prancheta = ler("src/components/mesa/PranchetaDoEstudio.tsx");

const CLIENTE = "11111111-1111-1111-1111-111111111111";

const diretor: ModeloIa = {
  id: "openai:diretor",
  provedor: "openai",
  modelo_api: "diretor",
  tipo: "texto",
  rotulo: "Diretor",
  preco_entrada_1m: 1,
  preco_saida_1m: 2,
  preco_cache_1m: null,
  preco_imagem: null,
  raciocinio: [],
  padrao_para: ["diretor_arte"],
  ativo: true,
};

const valorDaMesa = (extra: Partial<MesaValor> = {}): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Cliente sintético",
  userId: "u-1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 10,
  catalogo: [diretor],
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
  ...extra,
});

function montar(filho: any, valor = valorDaMesa()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(MemoryRouter, null, h(QueryClientProvider, { client: qc }, h(MesaProvider, { valor }, filho))));
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
      maybeSingle: () => Promise.resolve({ data: (tabelas[nome] || []).filter((r) => filtros.every((f) => f(r)))[0] || null, error: null }),
      then: (ok: any, erro: any) =>
        Promise.resolve({ data: (tabelas[nome] || []).filter((r) => filtros.every((f) => f(r))), error: null, count: 0 }).then(ok, erro),
    };
    return b;
  };
}

const item = (id: string): ItemDoMes => ({ id, title: `Pauta ${id}`, due_date: "2026-10-01", delivery_type: "carousel", status: "todo", project_id: "p1" });

const trabalhoBase = (extra: Partial<Trabalho> = {}): Trabalho => ({
  id: "t-1",
  task_id: "i-1",
  status: "dirigido",
  direcao: { cards: [{ ordem: 1 }, { ordem: 2 }] },
  modelo_imagem_id: null,
  qualidade: "media",
  cards: [],
  legenda: null,
  hashtags: [],
  file_ids: [],
  custo_usd: 0,
  conversa_id: null,
  atualizado_em: "2026-09-23T00:00:00Z",
  ...extra,
});

const arte: ArteNaAgenda = {
  post_id: "post-1",
  titulo: "Post com arte",
  legenda: null,
  status: "ready",
  capa: { id: "f-1", nome: "arte.png", bucket: "files", caminho: "c/arte.png", url: "files://c/arte.png" },
  do_estudio: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("a lista não some ao clicar num item", () => {
  it("a chave é só cliente e janela; o item aberto nunca entra nela", () => {
    expect(chaveDosItens(CLIENTE, "proximos")).toEqual(["mesa", "itens-do-mes", CLIENTE, "proximos"]);
    expect(chaveDosItens(CLIENTE, "2026-10-01")).toEqual(["mesa", "itens-do-mes", CLIENTE, "2026-10-01"]);
    expect(hook).toContain("export function useItensDoMes(clientId: string, mes: string) {");
    expect(hook).toContain("queryKey: chaveDosItens(clientId, mes),");
    expect(hook).toContain("placeholderData: keepPreviousData,");
    expect(hook).not.toContain("tarefaExtra");
    expect(estudio).toContain("useItensDoMes(clientId, janela);");
    // O item fora da janela vem de uma consulta pequena à parte, só quando não está na lista.
    expect(estudio).toContain("useItemAvulso(clientId, tarefaId, !!tarefaId && listaPronta && !naLista)");
  });
});

describe("o cache da lista é JSON puro e acha a arte que já está na Agenda", () => {
  const tabelas = {
    estudio_trabalhos: [
      { id: "t-3", client_id: CLIENTE, task_id: "i-3", status: "dirigido", direcao: { cards: [{ ordem: 1 }] }, cards: [], file_ids: [], criado_em: "2026-09-20" },
      {
        id: "t-4",
        client_id: CLIENTE,
        task_id: "i-4",
        status: "entregue",
        direcao: { cards: [{ ordem: 1 }] },
        cards: [{ ordem: 1, versao: 1, storage_path: "c/estudio/t-4/card-1-v1.png" }],
        file_ids: ["f-4"],
        post_id: "p-4",
        criado_em: "2026-09-20",
      },
    ],
    editorial_post_internal: [
      { post_id: "p-2", task_id: "i-2", revision_of_post_id: "p-2-velho" },
      { post_id: "p-2-velho", task_id: "i-2", revision_of_post_id: null },
      { post_id: "p-3", task_id: "i-3", revision_of_post_id: null },
      { post_id: "p-4", task_id: "i-4", revision_of_post_id: null },
    ],
    editorial_posts: [
      { id: "p-2", title: "Post 2", default_caption: "Legenda 2", production_status: "ready", primary_file_id: "f-2", archived_at: null },
      { id: "p-2-velho", title: "Velho", default_caption: null, production_status: "ready", primary_file_id: "f-velho", archived_at: null },
      { id: "p-3", title: "Post 3", default_caption: null, production_status: "ready", primary_file_id: "f-3", archived_at: null },
      { id: "p-4", title: "Post 4", default_caption: null, production_status: "ready", primary_file_id: "f-4", archived_at: null },
    ],
    staff_files_secure: [
      { id: "f-2", file_name: "arte 2.png", file_url: "files://c/f2.png", storage_bucket: "files", storage_path: "c/f2.png" },
      { id: "f-3", file_name: "arte 3.png", file_url: "files://c/f3.png", storage_bucket: "files", storage_path: "c/f3.png" },
      { id: "f-4", file_name: "arte 4.png", file_url: "files://c/f4.png", storage_bucket: "files", storage_path: "c/f4.png" },
    ],
    calendario_propostas: [
      {
        client_id: CLIENTE,
        status: "gravada",
        task_ids: ["i-1", "i-9"],
        itens: [{ task_id: "i-1", cards: [{}, {}, {}], carrossel_infinito: true }, { task_id: "i-9", tema: "sem roteiro" }],
      },
    ],
    editorial_publications: [{ post_id: "p-4", status: "scheduled", scheduled_at: "2026-10-01T12:00:00Z", delivery_mode: "auto", published_at: null, permalink: null }],
  };

  it("sem Map nem Set no cache; os mapas saem no select", async () => {
    mock.from.mockImplementation(bancoFalso(tabelas));
    const dados = await lerDetalhesDosItens(CLIENTE, ["i-1", "i-2", "i-3", "i-4", "i-9"].map(item));
    expect(JSON.parse(JSON.stringify(dados))).toEqual(dados);
    for (const k of Object.keys(dados)) {
      expect((dados as any)[k] instanceof Map).toBe(false);
      expect((dados as any)[k] instanceof Set).toBe(false);
    }
    // Post revisado por outro mais novo não vale.
    expect(dados.artes["i-2"]).toMatchObject({ post_id: "p-2", legenda: "Legenda 2", capa: { bucket: "files", caminho: "c/f2.png" }, do_estudio: false });
    expect(dados.artes["i-4"].do_estudio).toBe(true);
    expect(dados.roteiros["i-1"]).toEqual({ laminas: 3, continuo: true });
    expect(dados.roteiros["i-9"]).toEqual({ laminas: 0, continuo: null });
    expect(dados.publicacoes["p-4"].scheduled_at).toBe("2026-10-01T12:00:00Z");

    const mapas = paraMapas(dados);
    expect(mapas.trabalhos.get("i-4")?.id).toBe("t-4");
    expect(mapas.artes.get("i-2")?.post_id).toBe("p-2");
    // Estrela só com roteiro detalhado (a direção sai dele sem custo).
    expect(mapas.roteiros.has("i-1")).toBe(true);
    expect(mapas.roteiros.has("i-9")).toBe(false);
    // A Entrega segue usando .get() nos mapas.
    expect(typeof mapas.publicacoes.get).toBe("function");
  });

  it("item com arte na Agenda não conta em A fazer; trabalho novo em andamento volta a contar", async () => {
    mock.from.mockImplementation(bancoFalso(tabelas));
    const itens = ["i-1", "i-2", "i-3", "i-4"].map(item);
    const m = paraMapas(await lerDetalhesDosItens(CLIENTE, itens));
    const t = (i: ItemDoMes) => m.trabalhos.get(i.id) || null;
    const a = (i: ItemDoMes) => m.artes.get(i.id) || null;
    expect(passaNoFiltro("a_fazer", t(itens[1]), a(itens[1]))).toBe(false);
    expect(passaNoFiltro("na_agenda", t(itens[1]), a(itens[1]))).toBe(true);
    expect(situacaoDoItem(t(itens[1]), a(itens[1]), false)).toEqual({ rotulo: "na agenda", tom: "ok" });
    // Refazendo no estúdio: o trabalho novo está na esteira de novo.
    expect(passaNoFiltro("a_fazer", t(itens[2]), a(itens[2]))).toBe(true);
    expect(contarFiltros(itens, t, a)).toEqual({ a_fazer: 2, com_arte: 0, na_agenda: 2 });
  });

  it("regras sem banco: arte na Agenda sem trabalho resolve; filtro antigo vira Na agenda", () => {
    expect(itemResolvido(null, arte)).toBe(true);
    expect(itemResolvido(trabalhoBase(), arte)).toBe(false);
    expect(passaNoFiltro("a_fazer", null, arte)).toBe(false);
    expect(passaNoFiltro("com_arte", null, arte)).toBe(false);
    expect(passaNoFiltro("a_fazer", null, null)).toBe(true);
    expect(filtroValido("entregues")).toBe("na_agenda");
    expect(filtroValido("qualquer")).toBe("a_fazer");
  });
});

describe("o preparo decide tudo antes da direção", () => {
  it("diretor leva quantidade, contínuo e pedido; roteiro não leva quantidade nem pedido", () => {
    expect(corpoDoPreparar("t-1", { modo: "diretor", laminas: 5, continuo: true, pedido: "  use fotos reais " }, { postUnico: false, qualidade: "media" })).toEqual({
      acao: "preparar",
      task_id: "t-1",
      modo: "diretor",
      qualidade: "media",
      carrossel_infinito: true,
      laminas: 5,
      instrucao: "use fotos reais",
    });
    const auto = corpoDoPreparar("t-1", { modo: "diretor", laminas: null, continuo: false, pedido: "" });
    expect(auto.laminas).toBeUndefined();
    expect(auto.carrossel_infinito).toBe(false);
    expect(auto.instrucao).toBeUndefined();
    const roteiro = corpoDoPreparar("t-1", { modo: "roteiro", laminas: 4, continuo: true, pedido: "algo" });
    expect(roteiro).toEqual({ acao: "preparar", task_id: "t-1", modo: "roteiro", carrossel_infinito: true });
    // Post de uma lâmina só: sem quantidade e sem contínuo.
    const estatico = corpoDoPreparar("t-1", { modo: "diretor", laminas: 5, continuo: true, pedido: "" }, { postUnico: true });
    expect(estatico.laminas).toBeUndefined();
    expect(estatico.carrossel_infinito).toBeUndefined();
    // Fora de 1 a 10 não vai.
    expect(corpoDoPreparar("t-1", { modo: "diretor", laminas: 12, continuo: false, pedido: "" }).laminas).toBeUndefined();
  });

  it("o cartão Preparar manda a quantidade e o contínuo escolhidos, com o preço ao lado", async () => {
    const onPreparar = vi.fn().mockResolvedValue({ custo_usd: 0.03 });
    const onConcluido = vi.fn();
    montar(
      h(EstudioPreparar, {
        roteiro: null,
        postUnico: false,
        partesDiretor: () => [{ modeloId: diretor.id, tipo: "texto", tokensEntrada: 20000, tokensSaida: 8000 }],
        onPreparar,
        onConcluido,
      }),
    );
    fireEvent.click(screen.getByRole("radio", { name: "5" }));
    fireEvent.click(screen.getByRole("switch", { name: "Carrossel contínuo" }));
    fireEvent.change(screen.getByPlaceholderText("Ex.: use fotos reais do ambiente, capa centralizada"), { target: { value: "capa centralizada" } });
    expect(await screen.findByText("~US$ 0,036")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Preparar direção/ }));
    await waitFor(() => expect(onPreparar).toHaveBeenCalledWith({ modo: "diretor", laminas: 5, continuo: true, pedido: "capa centralizada" }));
    await waitFor(() => expect(onConcluido).toHaveBeenCalled());
  });

  it("com roteiro detalhado, abre no roteiro grátis e o contínuo vem do estrategista", async () => {
    const onPreparar = vi.fn().mockResolvedValue({});
    montar(
      h(EstudioPreparar, {
        roteiro: { laminas: 4, continuo: true },
        postUnico: false,
        partesDiretor: () => [],
        onPreparar,
        onConcluido: vi.fn(),
      }),
    );
    expect(screen.queryByRole("radiogroup", { name: "Quantidade de lâminas" })).toBeNull();
    expect((screen.getByRole("switch", { name: "Carrossel contínuo" }) as HTMLElement).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Montar do roteiro/ }));
    await waitFor(() => expect(onPreparar).toHaveBeenCalledWith({ modo: "roteiro", laminas: null, continuo: true, pedido: "" }));
  });
});

describe("depois de entregar, o próprio Estúdio envia para aprovação", () => {
  const entregue = trabalhoBase({ status: "entregue", file_ids: ["f-1"], entrega_status: null, cards: [{ ordem: 1, versao: 1, storage_path: "a" }, { ordem: 2, versao: 1, storage_path: "b" }] });
  const props = (extra: Record<string, unknown> = {}) => ({
    trabalho: entregue,
    laminasFeitas: 2,
    laminasTotal: 2,
    legendaEscrita: true,
    ehDesign: false,
    entregando: false,
    enviando: false,
    ocupado: false,
    erroDoEnvio: null,
    linkArquivos: `/arquivos?client=${CLIENTE}`,
    linkAgenda: null,
    onEntregar: vi.fn(),
    onEnviar: vi.fn(),
    ...extra,
  });

  it("entregue e não enviado: mostra Enviar para aprovação e Abrir em Arquivos", () => {
    const p = props();
    montar(h(EstudioEntrega, p));
    fireEvent.click(screen.getByRole("button", { name: /Enviar para aprovação/ }));
    expect(p.onEnviar).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: /Abrir em Arquivos/ }).getAttribute("href")).toBe(`/arquivos?client=${CLIENTE}`);
  });

  it("design pede a revisão da agência; já enviado não mostra o botão; o erro aparece", () => {
    const { unmount } = montar(h(EstudioEntrega, props({ ehDesign: true, erroDoEnvio: "Sem permissão para enviar." })));
    expect(screen.getByRole("button", { name: /Pedir revisão da agência/ })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Sem permissão para enviar.");
    unmount();
    montar(h(EstudioEntrega, props({ trabalho: { ...entregue, entrega_status: "aguardando_cliente" } })));
    expect(screen.queryByRole("button", { name: /Enviar para aprovação/ })).toBeNull();
    expect(faltaEnviar({ ...entregue, entrega_status: "reprovado" })).toBe(true);
  });

  it("antes de entregar: entregar e enviar num clique", () => {
    const p = props({ trabalho: trabalhoBase({ status: "pronto", cards: entregue.cards }) });
    montar(h(EstudioEntrega, p));
    fireEvent.click(screen.getByRole("button", { name: /Entregar e enviar para aprovação/ }));
    expect(p.onEntregar).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: /Só entregar em Arquivos/ }));
    expect(p.onEntregar).toHaveBeenCalledWith(false);
  });

  it("o envio confere o resultado da arte, não só a resposta da RPC", async () => {
    mock.rpc.mockResolvedValueOnce({ data: { resultados: [{ trabalho_id: "t-1", ok: false, erro: "Arquivo sem aprovação liberada." }] }, error: null });
    await expect(enviarUmParaAprovacao("t-1")).rejects.toThrow("Arquivo sem aprovação liberada.");
    expect(mock.rpc).toHaveBeenCalledWith("mesa_enviar_para_aprovacao", { _trabalho_ids: ["t-1"] });
    mock.rpc.mockResolvedValueOnce({ data: { resultados: [{ trabalho_id: "t-1", ok: true, estado: "aguardando_cliente" }] }, error: null });
    await expect(enviarUmParaAprovacao("t-1")).resolves.toMatchObject({ ok: true });
    // A aba usa o mesmo envio, ao entregar e depois.
    expect(estudio).toContain("await enviarUmParaAprovacao(trabalho.id);");
    expect(estudio).toContain("onEnviar={() => void enviarAgora()}");
  });
});

describe("o esboço da lâmina sem arte não vaza da caixa", () => {
  const caixa = { x0: 8.3, x1: 60, y0: 60, y1: 92 };
  const longo = [
    { papel: "headline", texto: "Um título bem comprido que não caberia inteiro numa miniatura pequena de jeito nenhum" },
    { papel: "subtitulo", texto: "Subtítulo também comprido, com muitas palavras para quebrar em várias linhas" },
    { papel: "apoio", texto: "Texto de apoio, mais uma frase longa que precisa ser cortada no fim da caixa" },
  ];
  // Altura que o texto ocupa com o line-clamp de cada bloco (mesma conta do CSS: linha de 1,12).
  const alturaDoTexto = (m: { fonte: number; linhas: number; espaco: number }[]) =>
    m.reduce((s, x) => s + (x.linhas ? x.fonte * 1.12 * x.linhas + x.espaco : 0), 0);

  it("cabe na caixa em qualquer largura e corta as linhas que sobram", () => {
    for (const largura of [96, 128, 200, 360]) {
      const m = medidasDoEsboco(longo, largura, caixa);
      const alturaInterna = ((caixa.y1 - caixa.y0) / 100) * largura * 1.25 - 2 * respiroDoEsboco(largura);
      expect(alturaDoTexto(m)).toBeLessThanOrEqual(alturaInterna);
      expect(m[0].linhas).toBeGreaterThan(0);
      // Um bloco escondido esconde os seguintes (ordem de leitura).
      const primeiroEscondido = m.findIndex((b) => b.linhas === 0);
      if (primeiroEscondido >= 0) for (const b of m.slice(primeiroEscondido)) expect(b.linhas).toBe(0);
    }
    // Na miniatura pequena não cabe tudo: o último bloco some em vez de vazar.
    const pequena = medidasDoEsboco(longo, 96, caixa);
    expect(pequena[pequena.length - 1].linhas).toBe(0);
  });

  it("a letra acompanha a largura da miniatura (px calculado)", () => {
    const curto = [{ papel: "headline", texto: "Oi" }];
    const pequena = medidasDoEsboco(curto, 100, caixa)[0].fonte;
    const grande = medidasDoEsboco(curto, 300, caixa)[0].fonte;
    expect(grande / pequena).toBeGreaterThan(2.5);
    expect(grande / pequena).toBeLessThan(3.5);
  });

  it("cada bloco tem line-clamp e a caixa esconde o excesso", () => {
    expect(prancheta).toContain("WebkitLineClamp: m.linhas");
    expect(prancheta).toContain('display: "-webkit-box"');
    expect(prancheta).toContain("absolute flex flex-col justify-center overflow-hidden rounded-sm bg-background");
  });
});

describe("a aba inteira no computador (faixa das pautas em cima, estúdio grande embaixo)", () => {
  const daqui = (dias: number) => {
    const d = new Date();
    d.setDate(d.getDate() + dias);
    return dataLocal(d);
  };
  const tarefas = [
    { id: "i-1", title: "Pauta sem nada", due_date: daqui(2), delivery_type: "carousel", status: "todo", project_id: "p1", deleted_at: null },
    { id: "i-2", title: "Pauta com arte na Agenda", due_date: daqui(3), delivery_type: "carousel", status: "todo", project_id: "p1", deleted_at: null },
    { id: "i-3", title: "Pauta em produção", due_date: daqui(4), delivery_type: "carousel", status: "todo", project_id: "p1", deleted_at: null },
  ];
  const tabelas = {
    projects: [{ id: "p1", client_id: CLIENTE, deleted_at: null }],
    tasks: tarefas,
    estudio_trabalhos: [
      {
        id: "t-3",
        client_id: CLIENTE,
        task_id: "i-3",
        status: "dirigido",
        direcao: { conceito: "Conceito de teste", fio_visual: "Mesma luz", cards: [{ ordem: 1, funcao: "capa", texto_exato: "Título da capa" }, { ordem: 2, texto_exato: "Segunda lâmina" }] },
        cards: [{ ordem: 1, versao: 1, storage_path: "c/estudio/t-3/card-1-v1.png", verificacao: { pendente: true } }],
        file_ids: [],
        custo_usd: 0.05,
        conversa_id: null,
        legenda: null,
        hashtags: [],
        atualizado_em: "2026-09-23T00:00:00Z",
        criado_em: "2026-09-23",
      },
    ],
    editorial_post_internal: [{ post_id: "p-2", task_id: "i-2", revision_of_post_id: null }],
    editorial_posts: [{ id: "p-2", title: "Post 2", default_caption: "Legenda do post", production_status: "ready", primary_file_id: "f-2", archived_at: null }],
    staff_files_secure: [{ id: "f-2", file_name: "arte.png", file_url: "files://c/f2.png", storage_bucket: "files", storage_path: "c/f2.png", parent_file_id: null, archived_at: null }],
    calendario_propostas: [],
    editorial_publications: [],
  };

  function montarAba(tarefaId: string) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const arvore = (id: string) =>
      h(MemoryRouter, null, h(QueryClientProvider, { client: qc }, h(ConfirmDialogProvider, null, h(MesaProvider, { valor: valorDaMesa() }, h(AbaEstudio, { mes: "2026-09-01", onMes: vi.fn(), tarefaId: id, onTarefa: vi.fn() })))));
    const r = render(arvore(tarefaId));
    return { ...r, trocar: (id: string) => r.rerender(arvore(id)) };
  }

  it("produção, arte na Agenda e preparo, sem quebrar", async () => {
    const largura = window.innerWidth;
    (window as any).innerWidth = 1440;
    mock.from.mockImplementation(bancoFalso(tabelas));
    mock.invoke.mockResolvedValue({ data: { custo_usd: 0.04 }, error: null });
    try {
      const aba = montarAba("i-3");
      // Faixa das pautas em cima, com a arte da Agenda fora de "A fazer".
      expect(await screen.findByText("Pauta sem nada")).toBeTruthy();
      expect(screen.queryByText("Pauta com arte na Agenda")).toBeNull();
      // Embaixo: barra do item, prancheta e a lâmina escolhida; ferramentas na barra lateral (antes, abas do inspetor).
      expect(await screen.findByText("Prancheta")).toBeTruthy();
      expect(screen.getAllByText("Pauta em produção").length).toBeGreaterThan(0);
      expect(screen.getByRole("navigation", { name: "Ferramentas" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Lâmina" }).getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByRole("button", { name: /Gerar as que faltam \(1\)/ })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Conjunto" }));
      expect(screen.getByText("Mesma luz")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Entrega" }));
      expect((screen.getByRole("button", { name: /Só entregar em Arquivos/ }) as HTMLButtonElement).disabled).toBe(true);

      // Arte já na Agenda: mostra a arte e só refaz se pedir.
      aba.trocar("i-2");
      expect(await screen.findByText("Arte já na Agenda")).toBeTruthy();
      expect(screen.getAllByText("Legenda do post").length).toBeGreaterThan(0);
      fireEvent.click(screen.getByRole("button", { name: /Refazer no Estúdio/ }));
      fireEvent.click(screen.getByRole("button", { name: "Sim, refazer" }));
      expect(await screen.findByText("Preparar a direção")).toBeTruthy();

      // Sem nada: o cartão Preparar com as escolhas antes da direção.
      aba.trocar("i-1");
      expect(await screen.findByText("Preparar a direção")).toBeTruthy();
      expect(screen.getByRole("radiogroup", { name: "Quantidade de lâminas" })).toBeTruthy();
    } finally {
      (window as any).innerWidth = largura;
    }
  }, 20000);
});

describe("a esteira cabe na janela", () => {
  it("colunas só a partir de 1024 px; altura abaixo do cabeçalho fixo, com mínimo", () => {
    expect(faixaDaLargura(390)).toBe("celular");
    expect(faixaDaLargura(800)).toBe("tablet");
    expect(faixaDaLargura(1100)).toBe("compacto");
    expect(faixaDaLargura(1440)).toBe("mesa");
    expect(alturaDaEsteira(1000, 200)).toBe(768);
    // O estúdio tem no mínimo 620 px (antes 460: a lâmina grande cortava).
    expect(alturaDaEsteira(600, 200)).toBe(620);
  });

  it("ações da lâmina sempre visíveis: nada escondido no hover", () => {
    expect(prancheta).not.toContain("group-hover:opacity-100");
    expect(prancheta).not.toContain("opacity-0");
    expect(prancheta).not.toContain("hover:-translate-y");
  });
});

describe("estúdio com a altura de uma tela (dono, 23/09 noite)", () => {
  const aba = readFileSync(resolve(process.cwd(), "src/components/mesa/AbaEstudio.tsx"), "utf8");
  it("a altura fixa vale só para o estúdio; a faixa de pautas fica fora e a página rola", () => {
    expect(aba).toContain('<div ref={areaDoEstudio} className="mt-3 flex min-h-0 min-w-0 flex-col" style={altura ? { height: altura } : undefined}>');
    expect(aba).not.toContain('<div ref={raiz} className="flex min-w-0 flex-col" style={altura ? { height: altura } : undefined}>');
    expect(aba).toContain("encaixarNaJanela(areaDoEstudio.current)");
  });
});
