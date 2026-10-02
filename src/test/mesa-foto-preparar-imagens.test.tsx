import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Preparar imagens da Mesa Foto (02/10/2026; dono: "de um lado os produtos
 * como catálogo por departamento, do outro os clones e modelos; seletor de
 * modelo e de imagens, inclusive editadas; editar, salvar, comparar antes e
 * depois e ficar só com o resultado; tudo sincronizado"). Fixa os seletores
 * (filtros, catálogo, modelos e clones), a edição com linhagem, o arquivar do
 * antes (nunca apaga; foto de produto não arquiva) e a escolha levada ao
 * Canvas.
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  updates: [] as { tabela: string; valores: unknown; filtros: [string, unknown][] }[],
  tabelas: {} as Record<string, unknown[]>,
}));
vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const b: any = { _filtros: [] as [string, unknown][], _update: null as unknown };
    for (const m of ["select", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range", "insert"]) b[m] = () => b;
    b.eq = (c: string, v: unknown) => {
      b._filtros.push([c, v]);
      return b;
    };
    b.update = (v: unknown) => {
      b._update = v;
      return b;
    };
    b.then = (ok: any, erro: any) => {
      if (b._update) mock.updates.push({ tabela, valores: b._update, filtros: b._filtros });
      return Promise.resolve({ data: b._update ? null : mock.tabelas[tabela] || [], error: null }).then(ok, erro);
    };
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: vi.fn(),
      from: (t: string) => consulta(t),
      storage: { from: () => ({ createSignedUrl: (c: string) => Promise.resolve({ data: { signedUrl: `https://arquivo.test/${c}` }, error: null }) }) },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));

import type { FotoDoAcervo, KitDeFoto } from "@/components/mesa-foto/fotoApi";
import type { Persona } from "@/components/mesa-foto/modelosApi";
import type { Clone } from "@/components/mesa-foto/clonesApi";
import { chaveDasPersonas } from "@/components/mesa-foto/modelosApi";
import { chaveDosClones } from "@/components/mesa-foto/clonesApi";
import { dadosDaPessoa, ehArte, ehEditada, filtrarImagens, modelosParaEscolher, produtoDaFoto, produtosPorDepartamento } from "@/components/mesa-foto/seletores/seletores";
import { imagensParaEditar, lerSelecaoLevadaAoCanvas, levarSelecaoAoCanvas, mudarAtivaDaFoto, podeFicarComODepois, trocarNaLista, ehVersaoDe } from "@/components/mesa-foto/preparar/preparo";
import { caixaDaEscolha } from "@/components/mesa-foto/canvas/caixas";
import { canvasVazio, entradasDoGerar } from "@/components/mesa-foto/canvasApi";
import SeletorDeImagens from "@/components/mesa-foto/seletores/SeletorDeImagens";
import SeletorDeModelo from "@/components/mesa-foto/seletores/SeletorDeModelo";
import { AntesEDepois } from "@/components/mesa-foto/preparar/EdicaoDeImagens";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import { MesaFotoProvider, type MesaFotoValor } from "@/components/mesa-foto/Comuns";
import { chaveDasFotos, chaveDosKits } from "@/components/mesa-foto/fotoApi";
import PrepararImagens from "@/components/mesa-foto/preparar/PrepararImagens";

const CLIENTE = "11111111-1111-1111-1111-111111111111";

const foto = (id: string, extra: Partial<FotoDoAcervo> = {}): FotoDoAcervo => ({
  id, client_id: CLIENTE, nome: `${id}.jpg`, storage_bucket: "mesa", storage_path: `c/${id}.jpg`, origem: "upload", pasta: null, categoria: null, tags: [], descricao: null,
  ativa: true, derivada_de: null, gerada: false, modo: null, kit_id: null, aprovada: false, largura: 800, altura: 1000, criado_em: "2026-10-01", referencia_web: false, ...extra,
});

const kit = (id: string, tipo: string, nome: string, extra: Partial<KitDeFoto> = {}): KitDeFoto =>
  ({ id, client_id: CLIENTE, tipo, nome, variante: "", atributos: { observado: [], informado: [], inferido: [] }, invariantes: [], lacunas: [], autorizacao: null, frente_imagem_id: null, status: "confirmado", atualizado_em: null, refs: [], ...extra }) as KitDeFoto;

const FOTOS: FotoDoAcervo[] = [
  foto("orig"),
  foto("edit", { derivada_de: "orig", tags: ["preparo:fundo_branco"], modo: "preservar" }),
  foto("amp", { tags: ["upscale"], modo: "detalhe" }),
  foto("arte", { categoria: "arte", nome: "Promoção de outubro" }),
  foto("ger", { gerada: true, modo: "canvas" }),
  foto("prod", { categoria: "produto", nome: "Óculos Aurora frente" }),
  foto("ref", { nome: "Foto da loja" }),
  foto("velha", { ativa: false }),
  foto("web", { referencia_web: true }),
];
const KITS: KitDeFoto[] = [
  kit("k1", "moda", "Óculos Aurora", { frente_imagem_id: "prod" }),
  kit("k2", "cosmetico", "Batom Rubi", { refs: [{ imagem_id: "ref", papel: "identidade", vista: null, prioridade: 1 } as any] }),
  kit("k3", "moda", "Bolsa Areia"),
  kit("k4", "pessoa", "Marina"),
  kit("k5", "alimento", "Café", { status: "arquivado" }),
];

describe("seletor de imagens: filtros", () => {
  it("todas sem arquivada e sem referência da internet; editadas, artes, produtos, originais e geradas", () => {
    const ids = (f: Parameters<typeof filtrarImagens>[1], busca = "") => filtrarImagens(FOTOS, f, busca, KITS).map((x) => x.id);
    expect(ids("todas")).toEqual(["orig", "edit", "amp", "arte", "ger", "prod", "ref"]);
    expect(ids("editadas")).toEqual(["edit", "amp"]);
    expect(ids("artes")).toEqual(["arte"]);
    expect(ids("produtos")).toEqual(["prod", "ref"]);
    expect(ids("originais")).toEqual(["orig", "arte", "prod", "ref"]);
    expect(ids("geradas")).toEqual(["ger"]);
    expect(ids("todas", "promocao")).toEqual(["arte"]);
    expect(ids("todas", "ÓCULOS")).toEqual(["prod"]);
    expect(ehEditada(foto("x", { derivada_de: "y", modo: "clone" }))).toBe(false);
    expect(ehArte(foto("x", { tags: ["carrossel:3"] }))).toBe(true);
  });

  it("produtos como catálogo por departamento, sem pessoa e sem arquivado, com busca", () => {
    const d = produtosPorDepartamento(KITS);
    expect(d.map((x) => [x.rotulo, x.kits.map((k) => k.nome)])).toEqual([
      ["Cosmético", ["Batom Rubi"]],
      ["Moda", ["Bolsa Areia", "Óculos Aurora"]],
    ]);
    expect(produtosPorDepartamento(KITS, "oculos").map((x) => x.kits.map((k) => k.id))).toEqual([["k1"]]);
    expect(produtoDaFoto(KITS, "ref")!.nome).toBe("Batom Rubi");
    expect(produtoDaFoto(KITS, "orig")).toBeNull();
  });
});

const persona = (id: string, nome: string, status: string, client_id: string | null = CLIENTE): Persona =>
  ({ id, client_id, nome, ficha: {}, invariantes: [], status, ancora_imagem_id: status === "rascunho" ? null : `anc-${id}`, motor_preferido_id: null, versao: 2, etica_marcada: true, custo_usd: 0, atualizado_em: "" }) as unknown as Persona;
const clone = (id: string, nome: string, ok: boolean, real = true): Clone =>
  ({ id, client_id: CLIENTE, nome, status: "pronta", versao: 1, invariantes: [], motor_preferido_id: null, ancora_imagem_id: null, identidade_real: real ? [{ imagem_id: `img-${id}`, principal: true }] : [], autorizacao: null, autorizacao_valida: { ok, motivo: ok ? null : "Autorização vencida" }, capa_url: null, capa_e_real: true }) as Clone;

const PERSONAS = [persona("p1", "Marina", "pronta"), persona("p2", "Bia", "rascunho"), persona("p3", "Velha", "arquivada"), persona("p4", "Agência", "folha", null)];
const CLONES = [clone("c1", "Almir", true), clone("c2", "Joana", false), clone("c3", "Sem foto", true, false)];

describe("seletor de modelo: modelos e clones numa lista", () => {
  it("prontas primeiro; arquivada fora; clone sem autorização ou sem foto não vai", () => {
    const l = modelosParaEscolher(PERSONAS, CLONES);
    expect(l.map((o) => [o.chave, o.pronto])).toEqual([
      ["persona:p4", true],
      ["clone:c1", true],
      ["persona:p1", true],
      ["persona:p2", false],
      ["clone:c2", false],
      ["clone:c3", false],
    ]);
    expect(l.find((o) => o.id === "p2")!.motivo).toMatch(/Sem âncora/);
    expect(l.find((o) => o.id === "c2")!.motivo).toBe("Autorização vencida");
    expect(l.find((o) => o.id === "c3")!.motivo).toBe("Sem foto da pessoa");
    expect(l.find((o) => o.id === "p4")!.da_agencia).toBe(true);
  });

  it("vira o cartão Pessoa do Canvas: persona pelo id, clone como foto real autorizada", () => {
    const l = modelosParaEscolher(PERSONAS, CLONES);
    expect(dadosDaPessoa(l.find((o) => o.id === "p1")!)).toEqual({ modelo_id: "p1", versao: 2, imagem_id: null, autorizada: false, titulo: "Marina" });
    expect(dadosDaPessoa(l.find((o) => o.id === "c1")!)).toEqual({ modelo_id: null, versao: null, imagem_id: "img-c1", autorizada: true, titulo: "Almir" });
    expect(dadosDaPessoa(l.find((o) => o.id === "c2")!).autorizada).toBe(false);
  });
});

describe("editar: linhagem, antes e depois e arquivar o antes", () => {
  beforeEach(() => {
    mock.updates.length = 0;
  });

  it("foto de produto não arquiva; as outras sim", () => {
    expect(podeFicarComODepois("ref", KITS)).toEqual({ ok: false, motivo: "É foto do produto Batom Rubi: ela fica guardada." });
    expect(podeFicarComODepois("prod", KITS).ok).toBe(false);
    expect(podeFicarComODepois("orig", KITS)).toEqual({ ok: true, motivo: null });
  });

  it("o depois toma o lugar do antes na fila; a versão nova é da aberta", () => {
    expect(trocarNaLista(["a", "b", "c"], "b", "b2")).toEqual(["a", "b2", "c"]);
    expect(trocarNaLista(["a", "b2"], "a", "b2")).toEqual(["b2"]);
    expect(trocarNaLista(["a"], "x", "y")).toEqual(["a", "y"]);
    expect(ehVersaoDe(foto("n", { derivada_de: "orig" }), "orig")).toBe(true);
    expect(ehVersaoDe(foto("n"), "orig")).toBe(false);
    expect(ehVersaoDe(null, "orig")).toBe(false);
  });

  it("editar produto é editar a capa dele (sem repetir)", () => {
    expect(imagensParaEditar(["orig", "prod"], ["k1", "k2", "k3"], KITS)).toEqual(["orig", "prod", "ref"]);
  });

  it("arquivar é ativa = false no acervo do cliente (nunca apaga); desfazer volta", async () => {
    await mudarAtivaDaFoto(CLIENTE, "orig", false);
    await mudarAtivaDaFoto(CLIENTE, "orig", true);
    expect(mock.updates).toEqual([
      { tabela: "cliente_imagens", valores: { ativa: false }, filtros: [["id", "orig"], ["client_id", CLIENTE]] },
      { tabela: "cliente_imagens", valores: { ativa: true }, filtros: [["id", "orig"], ["client_id", CLIENTE]] },
    ]);
  });
});

describe("escolha levada ao Canvas", () => {
  it("vai e volta uma vez só, e vira uma caixa com produtos, pessoa e imagens como estilo", () => {
    const pessoa = dadosDaPessoa(modelosParaEscolher(PERSONAS, [])[1]);
    levarSelecaoAoCanvas(CLIENTE, { kit_ids: ["k1", "k3"], imagem_ids: ["arte"], pessoa });
    const s = lerSelecaoLevadaAoCanvas(CLIENTE)!;
    expect(s).toEqual({ kit_ids: ["k1", "k3"], imagem_ids: ["arte"], pessoa });
    expect(lerSelecaoLevadaAoCanvas(CLIENTE)).toBeNull();
    let n = 0;
    const c = caixaDaEscolha(canvasVazio(CLIENTE), s, { caixa: "g", cartao: (t) => `${t}-${n++}` }, ["m1"]);
    expect(entradasDoGerar(c, "g").map((e) => [e.entrada, e.no.tipo])).toEqual([
      ["produto", "produto"],
      ["produto", "produto"],
      ["pessoa", "modelo"],
      ["estilo", "estilo"],
    ]);
    expect(c.nos.find((x) => x.tipo === "modelo")!.dados).toMatchObject({ modelo_id: "p1", versao: 2 });
    expect(c.nos.find((x) => x.tipo === "estilo")!.dados.imagem_id).toBe("arte");
    levarSelecaoAoCanvas(CLIENTE, { kit_ids: [], imagem_ids: [], pessoa: null });
    expect(lerSelecaoLevadaAoCanvas(CLIENTE)).toBeNull();
  });
});

// ------------------------------------------------------------------ tela

const valorDaMesa = (): MesaValor =>
  ({ clientId: CLIENTE, clientName: "Ótica", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 50, catalogo: [], catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn() }) as MesaValor;

function montar(filho: any, qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(MesaProvider, { valor: valorDaMesa(), children: filho }))));
}

describe("seletores na tela", () => {
  beforeEach(() => {
    mock.invoke.mockReset();
    mock.invoke.mockImplementation(async (_f: string, o: any) => (o.body.acao === "clones_listar" ? { data: { clones: [] }, error: null } : { data: {}, error: null }));
    mock.tabelas = { foto_kits: [], foto_kit_refs: [], foto_modelo_imagens: [] };
  });

  it("seletor de imagens: o filtro Editadas mostra só as versões novas e marcar devolve os ids", async () => {
    const onMudar = vi.fn();
    montar(h(SeletorDeImagens, { clientId: CLIENTE, fotos: FOTOS, escolhidas: ["orig"], onMudar }));
    expect(document.querySelectorAll("[data-imagem-do-seletor]")).toHaveLength(7);
    fireEvent.click(screen.getByRole("radio", { name: "Editadas" }));
    await waitFor(() => expect(Array.from(document.querySelectorAll("[data-imagem-do-seletor]")).map((b) => b.getAttribute("data-imagem-do-seletor"))).toEqual(["edit", "amp"]));
    expect(within(document.querySelector('[data-imagem-do-seletor="edit"]') as HTMLElement).getByText("editada")).toBeTruthy();
    fireEvent.click(document.querySelector('[data-imagem-do-seletor="edit"]') as HTMLElement);
    expect(onMudar).toHaveBeenCalledWith(["orig", "edit"]);
  });

  it("seletor de modelo: modelos e clones com a foto; a que não está pronta fica desligada; Sem pessoa desmarca", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
    qc.setQueryData(chaveDasPersonas(CLIENTE), PERSONAS);
    qc.setQueryData(chaveDosClones(CLIENTE), CLONES);
    const onEscolher = vi.fn();
    const onCriar = vi.fn();
    montar(h(SeletorDeModelo, { clientId: CLIENTE, valor: "persona:p1", onEscolher, onCriar }), qc);
    await waitFor(() => expect(document.querySelector('[data-modelo-do-seletor="clone:c1"]')).toBeTruthy());
    expect((document.querySelector('[data-modelo-do-seletor="persona:p1"]') as HTMLElement).getAttribute("aria-pressed")).toBe("true");
    expect((document.querySelector('[data-modelo-do-seletor="clone:c2"]') as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('[data-modelo-do-seletor="persona:p3"]')).toBeNull();
    fireEvent.click(document.querySelector('[data-modelo-do-seletor="clone:c1"]') as HTMLElement);
    expect(onEscolher).toHaveBeenLastCalledWith(expect.objectContaining({ chave: "clone:c1", imagem_id: "img-c1", pronto: true }));
    fireEvent.click(screen.getByRole("button", { name: /Sem pessoa/ }));
    expect(onEscolher).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByRole("button", { name: /Criar modelo/ }));
    expect(onCriar).toHaveBeenCalled();
  });

  it("antes e depois: Ficar com o depois e Manter os dois; foto de produto mostra o motivo", async () => {
    const onFicar = vi.fn();
    const onManter = vi.fn();
    const t = montar(h(AntesEDepois, { antes: FOTOS[0], depois: FOTOS[1], podeArquivar: true, motivo: null, onFicar, onManter, ocupado: false }));
    await waitFor(() => expect(document.querySelector("[data-antes-e-depois] img")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Ficar com o depois/ }));
    fireEvent.click(screen.getByRole("button", { name: /Manter os dois/ }));
    expect(onFicar).toHaveBeenCalledTimes(1);
    expect(onManter).toHaveBeenCalledTimes(1);
    t.unmount();
    montar(h(AntesEDepois, { antes: FOTOS[6], depois: FOTOS[1], podeArquivar: false, motivo: "É foto do produto Batom Rubi: ela fica guardada.", onFicar, onManter, ocupado: false }));
    expect((screen.getByRole("button", { name: /Ficar com o depois/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("É foto do produto Batom Rubi: ela fica guardada.")).toBeTruthy();
  });
});

describe("Preparar imagens na tela", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    mock.invoke.mockReset();
    mock.invoke.mockImplementation(async (_f: string, o: any) => (o.body.acao === "clones_listar" ? { data: { clones: [] }, error: null } : { data: {}, error: null }));
  });

  it("catálogo por departamento à esquerda, modelos à direita; Montar no Canvas leva a escolha e abre o Canvas", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
    qc.setQueryData(chaveDasFotos(CLIENTE), FOTOS);
    qc.setQueryData(chaveDosKits(CLIENTE), KITS);
    qc.setQueryData(chaveDasPersonas(CLIENTE), PERSONAS);
    qc.setQueryData(chaveDosClones(CLIENTE), CLONES);
    const irPara = vi.fn();
    const onFechar = vi.fn();
    const foto: MesaFotoValor = { kitId: null, ensaioId: null, imagemId: null, escolherKit: vi.fn(), escolherEnsaio: vi.fn(), irPara, selecionadas: [], setSelecionadas: vi.fn(), abrirAgente: vi.fn(), etapa: "criar" };
    render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(MesaProvider, { valor: valorDaMesa(), children: h(MesaFotoProvider, { valor: foto, children: h(PrepararImagens, { aberta: true, onFechar }) }) }))));
    const janela = await screen.findByRole("dialog");
    expect(Array.from(janela.querySelectorAll("[data-departamento]")).map((d) => d.getAttribute("data-departamento"))).toEqual(["cosmetico", "moda"]);
    const montar = within(janela).getByRole("button", { name: /Montar no Canvas/ }) as HTMLButtonElement;
    expect(montar.disabled).toBe(true);
    fireEvent.click(janela.querySelector('[data-produto-do-catalogo="k1"]') as HTMLElement);
    await waitFor(() => expect(janela.querySelector('[data-modelo-do-seletor="persona:p1"]')).toBeTruthy());
    fireEvent.click(janela.querySelector('[data-modelo-do-seletor="persona:p1"]') as HTMLElement);
    // Editar imagens conta a capa do produto marcado.
    expect(within(janela).getByRole("button", { name: /Editar imagens \(1\)/ })).toBeTruthy();
    fireEvent.click(within(janela).getByRole("button", { name: /Montar no Canvas/ }));
    expect(irPara).toHaveBeenCalledWith("canvas");
    expect(onFechar).toHaveBeenCalled();
    expect(lerSelecaoLevadaAoCanvas(CLIENTE)).toEqual({ kit_ids: ["k1"], imagem_ids: [], pessoa: { modelo_id: "p1", versao: 2, imagem_id: null, autorizada: false, titulo: "Marina" } });
  });

  it("Artes e Fotos usam o seletor de imagens; Editar imagens abre a fila com as marcadas", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
    qc.setQueryData(chaveDasFotos(CLIENTE), FOTOS);
    qc.setQueryData(chaveDosKits(CLIENTE), KITS);
    qc.setQueryData(chaveDasPersonas(CLIENTE), []);
    qc.setQueryData(chaveDosClones(CLIENTE), []);
    const foto: MesaFotoValor = { kitId: null, ensaioId: null, imagemId: null, escolherKit: vi.fn(), escolherEnsaio: vi.fn(), irPara: vi.fn(), selecionadas: [], setSelecionadas: vi.fn(), abrirAgente: vi.fn(), etapa: "criar" };
    render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(MesaProvider, { valor: valorDaMesa(), children: h(MesaFotoProvider, { valor: foto, children: h(PrepararImagens, { aberta: true, onFechar: vi.fn() }) }) }))));
    const janela = await screen.findByRole("dialog");
    fireEvent.click(within(janela).getByRole("tab", { name: "Artes" }));
    await waitFor(() => expect(Array.from(janela.querySelectorAll("[data-imagem-do-seletor]")).map((b) => b.getAttribute("data-imagem-do-seletor"))).toEqual(["arte"]));
    fireEvent.click(janela.querySelector('[data-imagem-do-seletor="arte"]') as HTMLElement);
    fireEvent.click(within(janela).getByRole("tab", { name: "Fotos" }));
    await waitFor(() => expect(janela.querySelector('[data-imagem-do-seletor="orig"]')).toBeTruthy());
    fireEvent.click(janela.querySelector('[data-imagem-do-seletor="orig"]') as HTMLElement);
    fireEvent.click(within(janela).getByRole("button", { name: /Editar imagens \(2\)/ }));
    await waitFor(() => expect(document.querySelector("[data-edicao-de-imagens]")).toBeTruthy());
    expect(Array.from(document.querySelectorAll("[data-em-edicao]")).map((b) => b.getAttribute("data-em-edicao"))).toEqual(["arte", "orig"]);
    expect(within(document.querySelector("[data-edicoes]") as HTMLElement).getByRole("button", { name: /Tirar fundo/ })).toBeTruthy();
  });
});
