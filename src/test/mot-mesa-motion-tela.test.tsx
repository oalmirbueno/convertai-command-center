import { createElement as h, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente MOT (30/09): telas da Mesa Motion. Storyboards (3 caminhos, o
 * Escolher e o Trocar com Desfazer), entrevista (opção clicável grava; "Sem
 * prova" vale sozinha; "Usar o padrão"), a construção (amostra e final vão
 * para a fila com a marca do clique; lote das finais com Confirmar), a barra
 * do filme (lembra o filme, filme de outro cliente sai do endereço, "Novo
 * filme" pela janela) e o link da Mesa Edição com a versão do formato.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => {
  const cadeia: Record<string, unknown> = {};
  ["select", "eq", "in", "order", "limit", "is", "not", "gte", "lt", "maybeSingle", "single"].forEach((k) => (cadeia[k] = () => cadeia));
  (cadeia as { then: unknown }).then = (ok: (v: unknown) => unknown) => ok({ data: [], error: null });
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: vi.fn(async () => ({ data: null, error: null })),
      from: vi.fn(() => cadeia),
      storage: { from: vi.fn(() => ({ upload: vi.fn(async () => ({ error: null })) })) },
      channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
      removeChannel: vi.fn(),
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { toast } from "sonner";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import { gravarEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import EtapaStoryboards from "@/components/mesa-motion/EtapaStoryboards";
import EtapaEntrevista from "@/components/mesa-motion/EtapaEntrevista";
import EtapaConstrucao from "@/components/mesa-motion/EtapaConstrucao";
import EtapaRender from "@/components/mesa-motion/EtapaRender";
import EtapaStills from "@/components/mesa-motion/EtapaStills";
import { assinaturaDaCena, cenaDaLinha } from "../../supabase/functions/_shared/motion-metodo";

const CLIENTE = "4dd691a7-d481-451f-800b-5e6b6fdc8721";
const OUTRO_CLIENTE = "5ee791a7-d481-451f-800b-5e6b6fdc8722";
const FILME = "33333333-3333-4333-8333-333333333333";
const FILME_B = "44444444-4444-4444-8444-444444444444";
const FILME_DO_OUTRO = "55555555-5555-4555-8555-555555555555";
const NOVO = "66666666-6666-4666-8666-666666666666";
const VERSAO_916 = "77777777-7777-4777-8777-777777777777";

const cenaA = cenaDaLinha({ ordem: 1, titulo: "Marca entra", peca: "logo_sting", params: { tagline: "Método" }, duracao_s: 5 }).cena;
const filmeBase = {
  id: FILME,
  client_id: CLIENTE,
  marca_id: null,
  nome: "Apresentação AcelerIQ",
  tipo: "apresentacao",
  etapa: "storyboards",
  formatos: ["9:16", "16:9"],
  insumos: {},
  entrevista: { duracao: "15" },
  brand: { essencia: "Método", publico: "", promessa: "", tom: "", provas: [], evitar: "", movimento: "", regras: "", beats: [] },
  storyboards: [0, 1, 2].map((i) => ({ conceito: `Conceito ${i + 1}`, resumo: "r", cenas: [cenaA], avisos: [] })),
  storyboard_escolhido: null,
  cenas: [cenaA],
  renders: [],
  critica: {},
  som: {},
  montagem: {},
  entrega: {},
  modelo: null,
  custo_usd: 0,
  arquivado_em: null,
  criado_em: "",
  atualizado_em: "",
};

const valor: MesaValor = {
  clientId: CLIENTE,
  clientName: "AcelerIQ",
  userId: "u1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 10,
  catalogo: [{ id: "openrouter:anthropic/claude-opus-5.5", provedor: "openrouter", modelo_api: "anthropic/claude-opus-5.5", tipo: "texto", rotulo: "Claude Opus 5.5", preco_entrada_1m: 4, preco_saida_1m: 20, preco_cache_1m: null, preco_imagem: null, raciocinio: null, padrao_para: ["motion"], ativo: true }],
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
  versaoCarteira: 0,
  marcas: [],
  marca: null,
} as unknown as MesaValor;

function montar(no: ReactNode, busca = `?client=${CLIENTE}&filme=${FILME}`) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(MemoryRouter, { initialEntries: [`/mesa-motion${busca}`] }, h(QueryClientProvider, { client: qc }, h(MesaProvider, { valor }, no))));
}

type Corpo = Record<string, unknown>;
function responder(filme: Record<string, unknown>, extra: (body: Corpo) => unknown = () => undefined, lista: Array<Record<string, unknown>> = [filme]) {
  mock.invoke.mockImplementation(async (_f: string, { body }: { body: Corpo }) => {
    const proprio = extra(body);
    if (proprio !== undefined) return { data: proprio, error: null };
    if (body.acao === "filmes_listar") return { data: { filmes: lista }, error: null };
    if (body.acao === "filme_ler") return { data: { filme: lista.find((f) => f.id === body.filme_id) || filme, links: {} }, error: null };
    if (body.acao === "render_status") return { data: { pedidos: [], finais: [], links: {}, worker: { visto_em: null, situacao: "ligado" } }, error: null };
    if (body.acao === "storyboard_escolher") return { data: { filme: { ...filme, storyboard_escolhido: body.indice ?? null }, anterior: { storyboard_escolhido: null, cenas: (filme.cenas as unknown[]).length, stills_aprovados: 0, sob_medida: 0, pode_desfazer: (filme.cenas as unknown[]).length > 0 } }, error: null };
    if (body.acao === "filme_salvar") return { data: { filme: { ...filme, entrevista: body.entrevista || filme.entrevista } }, error: null };
    if (body.acao === "cena_pedir") return { data: { pedidos: [{ id: "p1" }] }, error: null };
    if (body.acao === "insumos_ler") return { data: { videos: [], musicas: [], imagens: [], kit: null }, error: null };
    return { data: {}, error: null };
  });
}

const chamadas = (acao: string) => mock.invoke.mock.calls.filter((c) => (c[1] as { body: { acao: string } }).body.acao === acao).map((c) => (c[1] as { body: Corpo }).body);
const aberto = () => (document.querySelector("[data-filme-aberto]") as HTMLElement).getAttribute("data-filme-aberto");

beforeEach(() => {
  vi.clearAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    /* sem storage */
  }
});

describe("Mesa Motion na tela", () => {
  it("storyboards: mostra os 3 caminhos e o Escolher grava o índice", async () => {
    responder({ ...filmeBase, cenas: [] });
    montar(h(EtapaStoryboards, { irPara: vi.fn() }));
    await screen.findByText("Conceito 1");
    expect(screen.getByText("Conceito 3")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Escolher" })[1]);
    await waitFor(() => expect(chamadas("storyboard_escolher")[0]).toMatchObject({ filme_id: FILME, indice: 1 }));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("storyboards: com cenas, 'Trocar para este' troca num clique e o aviso diz o que saiu, com Desfazer", async () => {
    const irPara = vi.fn();
    responder(filmeBase, (b) => (b.acao === "storyboard_desfazer" ? { filme: filmeBase } : undefined));
    montar(h(EtapaStoryboards, { irPara }));
    await screen.findByText("Conceito 1");
    expect(screen.queryByRole("button", { name: "Escolher" })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Trocar para este" })[2]);
    await waitFor(() => expect(irPara).toHaveBeenCalledWith("stills"));
    expect(chamadas("storyboard_escolher")[0]).toMatchObject({ indice: 2 });
    const [texto, opcoes] = (toast.success as unknown as { mock: { calls: Array<[string, { duration: number; action: { label: string; onClick: () => void } }]> } }).mock.calls[0];
    expect(texto).toBe("Cenas trocadas: 1 cena");
    expect(opcoes.duration).toBeGreaterThanOrEqual(15000);
    expect(opcoes.action.label).toBe("Desfazer");
    opcoes.action.onClick();
    await waitFor(() => expect(chamadas("storyboard_desfazer")[0]).toMatchObject({ filme_id: FILME, qual: "troca" }));
  });

  it("entrevista: clicar numa opção nomeada grava o ingrediente", async () => {
    responder(filmeBase);
    montar(h(EtapaEntrevista, { irPara: vi.fn() }));
    fireEvent.click(await screen.findByRole("button", { name: "Sting com rastro" }));
    await waitFor(() => expect(chamadas("filme_salvar")[0]).toMatchObject({ filme_id: FILME, entrevista: { duracao: "15", logo: "sting" } }));
  });

  it("entrevista: 'Sem prova' vale sozinha e 'Usar o padrão' preenche só a forma que está vazia, com Desfazer", async () => {
    responder({ ...filmeBase, entrevista: { duracao: "30", prova: ["numeros", "prints"] } });
    montar(h(EtapaEntrevista, { irPara: vi.fn() }));
    fireEvent.click(await screen.findByRole("button", { name: "Sem prova" }));
    await waitFor(() => expect(chamadas("filme_salvar")[0].entrevista).toMatchObject({ prova: ["sem_prova"] }));
    fireEvent.click(screen.getByRole("button", { name: /Usar o padrão/ }));
    await waitFor(() => expect(chamadas("filme_salvar")).toHaveLength(2));
    // A duração escolhida (30) fica; o resto da forma entra; objetivo, prova, frases e clima não.
    expect(chamadas("filme_salvar")[1].entrevista).toEqual({ duracao: "30", prova: ["sem_prova"], logo: "sting", abertura: "titulo", transicao: "corte_na_batida", ritmo: "medio", fundo: "escuro" });
  });

  it("stills: 'Aprovar os prontos' aprova só o still em dia, cena por cena, com Desfazer; sem falta, 'Pedir os que faltam' fica desligado", async () => {
    const still = { pedido_id: "s1", cena_id: cenaA.id, modo: "still", formato: "9:16", assinatura: assinaturaDaCena(cenaA), estado: "pronto", saida_path: `${CLIENTE}/s.png`, arquivo_id: null, folha_path: null, check: null, em: "2026-09-30T10:00:00Z" };
    responder({ ...filmeBase, etapa: "stills", renders: [still] }, (b) => (b.acao === "cena_salvar" ? { filme: { ...filmeBase, renders: [still], cenas: [{ ...cenaA, still_aprovado: (b.cena as { still_aprovado: boolean }).still_aprovado }] } } : undefined));
    montar(h(EtapaStills, { irPara: vi.fn() }));
    const pedir = (await screen.findByRole("button", { name: /Pedir os que faltam \(0\)/ })) as HTMLButtonElement;
    expect(pedir.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Aprovar os prontos \(1\)/ }));
    await waitFor(() => expect(chamadas("cena_salvar")[0]).toMatchObject({ filme_id: FILME, cena: { id: cenaA.id, still_aprovado: true } }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const [, opcoes] = (toast.success as unknown as { mock: { calls: Array<[string, { action: { onClick: () => void } }]> } }).mock.calls[0];
    opcoes.action.onClick();
    await waitFor(() => expect(chamadas("cena_salvar")[1]).toMatchObject({ cena: { id: cenaA.id, still_aprovado: false } }));
  });

  it("construção: amostra e cena final vão para a fila com a marca do clique", async () => {
    responder({ ...filmeBase, etapa: "construcao" });
    montar(h(EtapaConstrucao, { irPara: vi.fn() }));
    fireEvent.click(await screen.findByRole("button", { name: /Amostra de 5 s/ }));
    await waitFor(() => expect(chamadas("cena_pedir")[0]).toMatchObject({ filme_id: FILME, cena_id: cenaA.id, modo: "amostra" }));
    fireEvent.click(screen.getByRole("button", { name: /Cena final \(2 formatos\)/ }));
    await waitFor(() => expect(chamadas("cena_pedir")[1]).toMatchObject({ modo: "final" }));
    expect(String(chamadas("cena_pedir")[0].uid)).toMatch(/^amostra-/);
  });

  it("construção: 'Cenas finais que faltam' pede Confirmar na mesma linha e manda só os formatos que faltam", async () => {
    responder({ ...filmeBase, etapa: "construcao" });
    montar(h(EtapaConstrucao, { irPara: vi.fn() }));
    const lote = await screen.findByRole("button", { name: /Cenas finais que faltam \(1 cena × 2 formatos\)/ });
    fireEvent.click(lote);
    expect(chamadas("cena_pedir")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /^Confirmar/ }));
    await waitFor(() => expect(chamadas("cena_pedir")[0]).toMatchObject({ cena_id: cenaA.id, modo: "final", formatos: ["9:16", "16:9"] }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("1 cena final na fila."));
  });
});

describe("barra do filme: lembrar, dono e Novo filme", () => {
  it("troca de cliente: filme de outro cliente no endereço sai e abre o do cliente aberto", async () => {
    const doOutro = { ...filmeBase, id: FILME_DO_OUTRO, client_id: OUTRO_CLIENTE, nome: "Filme do outro" };
    responder(filmeBase, (b) => (b.acao === "filme_ler" && b.filme_id === FILME_DO_OUTRO ? { filme: doOutro, links: {} } : undefined));
    montar(h(EtapaEntrevista, { irPara: vi.fn() }), `?client=${CLIENTE}&filme=${FILME_DO_OUTRO}`);
    await waitFor(() => expect(aberto()).toBe(FILME));
    await screen.findByRole("button", { name: "Sting com rastro" });
    expect(screen.queryByText("Filme do outro")).toBeNull();
    // O filme do outro cliente não virou o lembrado deste.
    const guardado = Object.keys(window.localStorage).filter((k) => k.indexOf(`mesa-motion:filme:${CLIENTE}`) >= 0).map((k) => window.localStorage.getItem(k) || "");
    expect(guardado.join(" ")).not.toContain(FILME_DO_OUTRO);
    // A troca de cliente e de marca na casca também limpa o ?filme=.
    const casca = readFileSync(resolve(__dirname, "../components/mesa-videos/MesaDeVideo.tsx"), "utf8");
    expect(casca).toMatch(/mudar\(\{ client: id, etapa: [^}]*filme: null \}\)/);
    expect(casca).toMatch(/mudar\(\{ marca: id, filme: null \}, true\)/);
  });

  it("volta sem ?filme=: abre o lembrado (e, sem lembrança, o mais recente)", async () => {
    const maisNovo = { ...filmeBase, id: FILME_B, nome: "Filme da marca AcelerIQ", tipo: "filme_marca" };
    responder(filmeBase, () => undefined, [maisNovo, filmeBase]);
    gravarEstadoDaTela(`mesa-motion:filme:${CLIENTE}:sem-marca`, FILME);
    const um = montar(h(EtapaEntrevista, { irPara: vi.fn() }), `?client=${CLIENTE}`);
    await waitFor(() => expect(aberto()).toBe(FILME));
    um.unmount();
    window.localStorage.clear();
    montar(h(EtapaEntrevista, { irPara: vi.fn() }), `?client=${CLIENTE}`);
    await waitFor(() => expect(aberto()).toBe(FILME_B));
  });

  it("'Nenhum' no select é respeitado: não reabre sozinho", async () => {
    responder(filmeBase);
    montar(h(EtapaEntrevista, { irPara: vi.fn() }), `?client=${CLIENTE}`);
    await waitFor(() => expect(aberto()).toBe(FILME));
    fireEvent.change(screen.getByRole("combobox", { name: "Escolher o filme" }), { target: { value: "" } });
    await waitFor(() => expect(aberto()).toBe(""));
    await screen.findByText("Escolha ou crie um filme");
    await new Promise((r) => setTimeout(r, 50));
    expect(aberto()).toBe("");
  });

  it("'Novo filme': a janela já traz o nome, Enter cria, e o filme novo continua aberto depois da lista recarregar", async () => {
    const novo = { ...filmeBase, id: NOVO, nome: "Apresentação AcelerIQ 2", etapa: "insumos", cenas: [] };
    let criado = false;
    responder(filmeBase, (b) => {
      if (b.acao === "filme_criar") {
        criado = true;
        return { filme: novo };
      }
      if (b.acao === "filmes_listar") return { filmes: criado ? [novo, filmeBase] : [filmeBase] };
      if (b.acao === "filme_ler" && b.filme_id === NOVO) return { filme: novo, links: {} };
      return undefined;
    });
    montar(h(EtapaEntrevista, { irPara: vi.fn() }), `?client=${CLIENTE}`);
    await waitFor(() => expect(aberto()).toBe(FILME));
    fireEvent.click(document.querySelector("[data-novo-filme]") as HTMLElement);
    const nome = (await screen.findByRole("textbox", { name: "Nome do filme" })) as HTMLInputElement;
    // "Apresentação AcelerIQ" já existe: o nome já preenchido não repete.
    expect(nome.value).toBe("Apresentação AcelerIQ 2");
    expect(nome.maxLength).toBe(120);
    fireEvent.submit(nome.closest("form") as HTMLFormElement);
    await waitFor(() => expect(chamadas("filme_criar")[0]).toMatchObject({ client_id: CLIENTE, nome: "Apresentação AcelerIQ 2", tipo: "apresentacao" }));
    await waitFor(() => expect(aberto()).toBe(NOVO));
    await waitFor(() => expect(chamadas("filmes_listar").length).toBeGreaterThanOrEqual(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(aberto()).toBe(NOVO);
  });
});

describe("render: link da Mesa Edição e a Entrega", () => {
  it("o link abre a versão que o Motion montou naquele formato; sem filme pronto, a Entrega espera", async () => {
    const pronto = { ...filmeBase, etapa: "render", formatos: ["9:16"], montagem: { versoes: { "9:16": VERSAO_916 }, pedidos: { "9:16": "p-916" } } };
    responder(pronto, (b) =>
      b.acao === "render_status"
        ? { pedidos: [], finais: [{ id: "p-916", tipo: "render_final", estado: "rodando", etapa: null, progresso: 0.4, entrada: { formato: "9:16" }, resultado: null, saida_path: null, erro_mensagem: null, criado_em: "", versao_id: VERSAO_916 }], links: {}, worker: { visto_em: null, situacao: "ligado" } }
        : undefined,
    );
    montar(h(EtapaRender, { irPara: vi.fn() }));
    const link = (await screen.findByText(/Abrir na Mesa Edição/)).closest("a") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toContain(`versao=${VERSAO_916}`);
    expect(link.getAttribute("href")).toContain("etapa=editar");
    // Render em andamento: o botão trava (nada de versão repetida por clique).
    await waitFor(() => expect((document.querySelector('[data-montar="renderizando"]') as HTMLButtonElement).disabled).toBe(true));
    expect((document.querySelector("[data-entregar]") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Nenhum filme pronto ainda")).toBeTruthy();
  });
});
