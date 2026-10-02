import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 02/10 (dono: "a Mesa Foto está muito bagunçada e confusa"): Fotos só com
 * fotos (Produto e Modelo separados, artes fora, grade com rolagem própria),
 * navegação que sempre vai para frente, produto com nome e troca, Foto com
 * modelo com quem aparece e o custo antes, Aprovar com a próxima ação, o
 * diretor que preenche enquanto a pessoa escreve e a separação pelo Jev.
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  rpc: vi.fn(),
  tabelas: {} as Record<string, unknown>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "gte", "lte", "lt", "contains", "order", "limit", "range", "update", "insert"]) b[m] = () => b;
    const primeiro = () => ({ data: Array.isArray(dados) ? (dados[0] === undefined ? null : dados[0]) : dados, error: null });
    b.maybeSingle = () => Promise.resolve(primeiro());
    b.single = () => Promise.resolve(primeiro());
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null, count: Array.isArray(dados) ? dados.length : 0 }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: mock.rpc,
      from: (tabela: string) => consulta(tabela),
      storage: {
        from: () => ({
          upload: vi.fn(),
          createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/img.png" }, error: null }),
          createSignedUrls: () => Promise.resolve({ data: [], error: null }),
        }),
      },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));

import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import { MesaFotoProvider, type MesaFotoValor } from "@/components/mesa-foto/Comuns";
import EtapaAcervo from "@/components/mesa-foto/EtapaAcervo";
import EtapaAprovar from "@/components/mesa-foto/EtapaAprovar";
import EscolhaDoProduto, { nomeDoKit } from "@/components/mesa-foto/EscolhaDoProduto";
import { opcoesDeModelo } from "@/components/mesa-foto/EscolhaDoModeloDaFoto";
import { resumoDaFotoComModelo } from "@/components/mesa-foto/EtapaCampanha";
import { acoesDepoisDeAprovar } from "@/components/mesa-foto/DepoisDeAprovar";
import { ehArte, ehSoFoto, ladoDaFoto, precisaSeparar, separarFotos } from "@/components/mesa-foto/tipoDaFoto";
import { destinoAoEscolher, destinoDoGerar, etapaDeGerar } from "@/components/mesa-foto/linhaDeProducao";
import { normalizarFoto, normalizarKit, proximoPasso, type FotoDoAcervo } from "@/components/mesa-foto/fotoApi";
import { linkDeImagem } from "@/components/mesa-foto/acervoApi";
import { chipsDaIntencao, lerIntencaoDoDiretor, preenchimentoDaIntencao } from "@/components/mesa-foto/intencaoDoDiretor";
import { direcaoDoPreenchimento, normalizarPreenchimento } from "@/components/mesa-foto/escolhasDaLinha";
import { CATEGORIA_DO_LADO, categoriaDoLadoPedido, lerSeparacao, perguntasDaSeparacao } from "../../supabase/functions/mesa-foto/fotos-separar";
import { lerPessoaEscolhida, tagsDaPessoaNaFoto } from "../../supabase/functions/mesa-foto/pessoa-escolhida";

const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
const CLIENTE = "11111111-1111-4111-8111-111111111111";
const KIT = "bbbbbbbb-0000-4000-8000-000000000001";
const KIT2 = "bbbbbbbb-0000-4000-8000-000000000002";
const F1 = "aaaaaaaa-0000-4000-8000-000000000001";
const F2 = "aaaaaaaa-0000-4000-8000-000000000002";
const F3 = "aaaaaaaa-0000-4000-8000-000000000003";
const A1 = "aaaaaaaa-0000-4000-8000-000000000021";
const A2 = "aaaaaaaa-0000-4000-8000-000000000022";
const G1 = "aaaaaaaa-0000-4000-8000-000000000031";
const P1 = "dddddddd-0000-4000-8000-000000000001";

const linha = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  client_id: CLIENTE,
  nome: `foto ${id.slice(-2)}.jpg`,
  storage_bucket: "mesa",
  storage_path: `${CLIENTE}/foto/originais/${id}.jpg`,
  origem: "mesa_foto",
  pasta: null,
  categoria: null,
  tags: [],
  descricao: null,
  ativa: true,
  derivada_de: null,
  gerada: false,
  modo: null,
  kit_id: null,
  aprovada: false,
  largura: 1600,
  altura: 1200,
  criado_em: "2026-09-20T10:00:00Z",
  ...extra,
});
const foto = (id: string, extra: Record<string, unknown> = {}) => normalizarFoto(linha(id, extra)) as FotoDoAcervo;

const FOTOS = [
  linha(F1, { nome: "oculos-frente.jpg", categoria: "produto" }),
  linha(F2, { nome: "IMG_2041.jpg" }),
  linha(F3, { nome: "retrato da Ana.jpg", categoria: "pessoa" }),
  linha(A1, { nome: "post-feed-maio.png", origem: "workspace", pasta: "Artes de maio" }),
  linha(A2, { nome: "carrossel 3.png", categoria: "arte", origem: "workspace" }),
];

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Ótica Sintética",
  userId: "u-1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 50,
  catalogo: [],
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
});

const valorDaFoto = (extra: Partial<MesaFotoValor> = {}): MesaFotoValor => ({
  kitId: null,
  ensaioId: null,
  imagemId: null,
  escolherKit: vi.fn(),
  escolherEnsaio: vi.fn(),
  irPara: vi.fn(),
  selecionadas: [],
  setSelecionadas: vi.fn(),
  abrirAgente: vi.fn(),
  pedirAoDiretor: vi.fn(),
  abrirNoEstudio: vi.fn(),
  prepararNaAgenda: vi.fn(),
  escolherObjetivo: vi.fn(),
  ...extra,
});

function montar(filho: any, f: MesaFotoValor) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(MemoryRouter, { initialEntries: [`/mesa-foto?client=${CLIENTE}`] }, h(QueryClientProvider, { client: qc }, h(MesaProvider, { valor: valorDaMesa() }, h(MesaFotoProvider, { valor: f }, filho)))));
}

const esperar = async (seletor: string) =>
  (await waitFor(() => {
    const el = document.querySelector(seletor);
    if (!el) throw new Error(`sem ${seletor}`);
    return el;
  })) as HTMLElement;

beforeAll(() => {
  if (typeof (globalThis as any).ResizeObserver === "undefined") {
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => {};
  if (!(Element.prototype as any).hasPointerCapture) (Element.prototype as any).hasPointerCapture = () => false;
});

beforeEach(() => {
  mock.invoke.mockReset();
  mock.rpc.mockReset();
  mock.tabelas = {};
  mock.rpc.mockResolvedValue({ data: {}, error: null });
  mock.invoke.mockResolvedValue({ data: { ok: true }, error: null });
  try {
    window.sessionStorage.clear();
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

// ------------------------------------------------------------------ 1 e 2: Fotos, só fotos

describe("Fotos: só fotos, Produto e Modelo separados", () => {
  it("separa produto e modelo pelos metadados e tira artes, carrosséis, logos e arquivadas", () => {
    expect(ehArte(foto(A1, { nome: "post-feed-maio.png", pasta: "Artes de maio" }))).toBe(true);
    expect(ehArte(foto(A2, { categoria: "arte" }))).toBe(true);
    expect(ehArte(foto(F1, { tags: ["carrossel"] }))).toBe(true);
    expect(ehArte(foto(F1, { categoria: "logo" }))).toBe(true);
    // Gerada da Mesa Foto nunca é arte, mesmo com "post" na pasta.
    expect(ehArte(foto(G1, { gerada: true, modo: "ensaio", tags: ["mesa_foto", "gerada"], pasta: "Mesa Foto / Post" }))).toBe(false);
    expect(ehSoFoto(foto(F1, { ativa: false }))).toBe(false);
    expect(ladoDaFoto(foto(F3, { categoria: "pessoa" }))).toBe("modelo");
    expect(ladoDaFoto(foto(G1, { modo: "clone", gerada: true }))).toBe("modelo");
    expect(ladoDaFoto(foto(G1, { tags: ["pessoa_sintetica", "com_persona:x"] }))).toBe("modelo");
    expect(ladoDaFoto(foto(F1, { categoria: "produto" }))).toBe("produto");
    expect(ladoDaFoto(foto(F2))).toBe("produto");
    // Produto do tipo pessoa leva a foto para Modelo.
    const kitPessoa = normalizarKit({ id: KIT, client_id: CLIENTE, tipo: "pessoa", nome: "Ana", status: "confirmado" }, [{ kit_id: KIT, imagem_id: F2, papel: "rosto" }])!;
    expect(ladoDaFoto(foto(F2), [kitPessoa])).toBe("modelo");
    const s = separarFotos(FOTOS.map((x) => normalizarFoto(x) as FotoDoAcervo));
    expect(s.produto.map((f) => f.id)).toEqual([F1, F2]);
    expect(s.modelo.map((f) => f.id)).toEqual([F3]);
    expect(s.fora).toBe(2);
    // Só a foto sem sinal (nome de câmera, sem categoria) vai para o Jev.
    expect(s.aSeparar.map((f) => f.id)).toEqual([F2]);
    expect(precisaSeparar(foto(F1, { categoria: "produto" }))).toBe(false);
  });

  it("a etapa mostra as fotos na grade com rolagem própria, as abas com contagem e as artes fora", async () => {
    mock.tabelas.cliente_imagens = FOTOS;
    montar(h(EtapaAcervo), valorDaFoto());
    await screen.findByText("oculos-frente.jpg");
    const abas = await esperar("[data-lados-das-fotos]");
    expect(within(abas).getByRole("tab", { name: /Produto/ }).textContent).toContain("2");
    expect(within(abas).getByRole("tab", { name: /Modelo/ }).textContent).toContain("1");
    // Artes nunca aparecem (ficam na Mesa) e o contador avisa.
    expect(screen.queryByText("post-feed-maio.png")).toBeNull();
    expect(screen.queryByText("carrossel 3.png")).toBeNull();
    expect(document.querySelector("[data-artes-fora]")!.getAttribute("data-artes-fora")).toBe("2");
    // A grade é a área grande e rola por dentro (RegiaoRolavel), com a coluna do produto ao lado.
    const grade = document.querySelector("[data-rolagem-das-fotos]") as HTMLElement;
    expect(grade.querySelector(`[data-foto="${F1}"]`)).toBeTruthy();
    expect(grade.className + " " + (grade.parentElement ? grade.parentElement.className : "")).toMatch(/overflow-y-auto/);
    expect(document.querySelector("[data-coluna-do-produto]")).toBeTruthy();
    // Modelo: só a pessoa.
    fireEvent.click(within(abas).getByRole("tab", { name: /Modelo/ }));
    await waitFor(() => expect(screen.queryByText("oculos-frente.jpg")).toBeNull());
    expect(screen.getByText("retrato da Ana.jpg")).toBeTruthy();
    // Subir, colar e link à vista.
    expect(screen.getByRole("button", { name: /Subir fotos em lote/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Colar/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Link/ }));
    expect(screen.getByLabelText("Link da imagem")).toBeTruthy();
  });

  it("trazer do link chama acervo_importar_url com o lado aberto; Separar com IA manda só as sem sinal", async () => {
    mock.tabelas.cliente_imagens = FOTOS;
    mock.invoke.mockImplementation(async (_n: string, o: any) => {
      const acao = o && o.body && o.body.acao;
      if (acao === "acervo_importar_url") return { data: { imagem: linha("aaaaaaaa-0000-4000-8000-000000000099", { nome: "da-loja" }), ja_existia: false }, error: null };
      if (acao === "fotos_separar") return { data: { separadas: [{ id: F2, lado: "arte", categoria: "arte" }], custo_usd: 0.001 }, error: null };
      return { data: { ok: true }, error: null };
    });
    montar(h(EtapaAcervo), valorDaFoto());
    await screen.findByText("oculos-frente.jpg");
    fireEvent.click(screen.getByRole("button", { name: /Link/ }));
    fireEvent.change(screen.getByLabelText("Link da imagem"), { target: { value: "https://loja.test/oculos.jpg" } });
    fireEvent.click(screen.getByRole("button", { name: /Trazer/ }));
    await waitFor(() => expect(mock.invoke.mock.calls.some((c: any[]) => c[1].body.acao === "acervo_importar_url")).toBe(true));
    const corpo = mock.invoke.mock.calls.find((c: any[]) => c[1].body.acao === "acervo_importar_url")![1].body;
    expect(corpo).toMatchObject({ client_id: CLIENTE, url: "https://loja.test/oculos.jpg", lado: "produto" });
    fireEvent.click(await screen.findByRole("button", { name: /Separar com IA \(1\)/ }));
    await waitFor(() => expect(mock.invoke.mock.calls.some((c: any[]) => c[1].body.acao === "fotos_separar")).toBe(true));
    expect(mock.invoke.mock.calls.find((c: any[]) => c[1].body.acao === "fotos_separar")![1].body.imagem_ids).toEqual([F2]);
    expect(linkDeImagem("http://x.test/a.jpg")).toBeNull();
    expect(linkDeImagem("https://x.test/a.jpg")).toBe("https://x.test/a.jpg");
  });

  it("servidor: perguntas do Jev por foto, só grava com confiança, e o lado pedido vira categoria", () => {
    const fotos = [{ id: F2, nome: "IMG_2041.jpg", pasta: null, descricao: "óculos sobre a mesa", tags: [], origem: "upload" }];
    const q = perguntasDaSeparacao(fotos);
    expect(Object.keys(q.questions)).toEqual(["f0"]);
    expect(Object.keys(q.questions.f0.criteria)).toEqual(["produto", "modelo", "arte"]);
    expect(lerSeparacao(fotos, { f0: { choice: "modelo", confidence: 0.9 } })[0].categoria).toBe(CATEGORIA_DO_LADO.modelo);
    expect(lerSeparacao(fotos, { f0: { choice: "modelo", confidence: 0.4 } })[0].categoria).toBeNull();
    expect(lerSeparacao(fotos, { f0: { choice: "outra", confidence: 0.99 } })[0].categoria).toBeNull();
    expect(categoriaDoLadoPedido("modelo")).toBe("pessoa");
    expect(categoriaDoLadoPedido("x")).toBeNull();
  });
});

// ------------------------------------------------------------------ 3: navegação sempre para frente

describe("navegação: Escolher e Gerar vão para frente, sem laço", () => {
  it("Gerar nunca volta ao O que fazer", () => {
    expect(etapaDeGerar(null)).not.toBe("criar");
    expect(destinoDoGerar({ objetivo: null, marcadas: [], kitId: null }).etapa).toBe("ensaio");
    expect(destinoDoGerar({ objetivo: null, marcadas: [F1], kitId: null })).toMatchObject({ etapa: "estudio", imagem: F1, objetivo: "melhorar" });
    expect(destinoDoGerar({ objetivo: null, marcadas: [F1], kitId: KIT })).toMatchObject({ etapa: "ensaio", objetivo: "variacoes" });
    expect(destinoDoGerar({ objetivo: "modelo", marcadas: [], kitId: null }).etapa).toBe("campanha");
    expect(destinoDoGerar({ objetivo: "post", marcadas: [F1], kitId: null })).toMatchObject({ etapa: "agenda", levarAoPost: true });
    for (const o of [null, "melhorar", "variacoes", "modelo", "fundo", "post"] as const) {
      expect(destinoDoGerar({ objetivo: o, marcadas: [], kitId: null }).etapa).not.toBe("criar");
    }
  });

  it("Escolher vai direto para a ferramenta quando já tem o que precisa; senão para as Fotos", () => {
    expect(destinoAoEscolher("variacoes", { marcadas: [], kitId: null, produtos: 2 })).toMatchObject({ etapa: "ensaio" });
    expect(destinoAoEscolher("modelo", { marcadas: [], kitId: KIT, produtos: 1 })).toMatchObject({ etapa: "campanha" });
    expect(destinoAoEscolher("variacoes", { marcadas: [], kitId: null, produtos: 0 })).toMatchObject({ etapa: "acervo" });
    expect(destinoAoEscolher("melhorar", { marcadas: [F1], kitId: null, produtos: 0 })).toMatchObject({ etapa: "estudio", imagem: F1 });
    expect(destinoAoEscolher("fundo", { marcadas: [], kitId: null, produtos: 0 })).toMatchObject({ etapa: "acervo" });
    expect(destinoAoEscolher("post", { marcadas: [F1, F2], kitId: null, produtos: 0 })).toMatchObject({ etapa: "agenda", levarAoPost: true });
  });

  it("dentro da ferramenta, o Próximo não manda de volta ao passo 1 nem às Fotos", () => {
    const kits = [normalizarKit({ id: KIT, client_id: CLIENTE, tipo: "produto", nome: "Óculos", status: "confirmado" }, [])!];
    const p = proximoPasso({ fotos: 3, kits, kitId: null, ensaio: null, selecionadas: 0, objetivo: null, etapa: "ensaio" });
    expect(p.etapa).toBe("ensaio");
    expect(proximoPasso({ fotos: 3, kits, kitId: KIT, ensaio: null, selecionadas: 0, objetivo: null, etapa: "campanha" }).etapa).toBe("campanha");
    // Fora das ferramentas segue igual: sem objetivo, escolher o que fazer.
    expect(proximoPasso({ fotos: 3, kits, kitId: null, ensaio: null, selecionadas: 0, objetivo: null, etapa: "acervo" }).etapa).toBe("criar");
  });

  it("o passo 3 da casca usa o destino para frente e o O que fazer mostra só ícone e nome", () => {
    const casca = ler("src/pages/MesaFoto.tsx");
    expect(casca).toContain("destinoDoGerar({ objetivo, marcadas, kitId: kitUrl })");
    expect(casca).toContain("destinoAoEscolher(o,");
    const criar = ler("src/components/mesa-foto/EtapaCriar.tsx");
    expect(criar).toContain("<AjudaRecolhida");
    expect(criar).not.toMatch(/Precisa: <span/);
  });
});

// ------------------------------------------------------------------ 4: produto com nome e troca

describe("produto da geração: nome, capa e troca", () => {
  it("mostra o produto escolhido com o nome, lista os outros com nome e troca", async () => {
    mock.tabelas.cliente_imagens = FOTOS;
    mock.tabelas.foto_kits = [
      { id: KIT, client_id: CLIENTE, tipo: "produto", nome: "Óculos Aviador", status: "confirmado", frente_imagem_id: F1 },
      { id: KIT2, client_id: CLIENTE, tipo: "produto", nome: "", status: "rascunho" },
    ];
    const f = valorDaFoto({ kitId: KIT });
    montar(h(EscolhaDoProduto), f);
    const nome = await esperar("[data-nome-do-produto]");
    expect(nome.textContent).toContain("Óculos Aviador");
    fireEvent.click(screen.getByRole("button", { name: /Trocar/ }));
    const lista = await esperar("[data-lista-de-produtos]");
    expect(within(lista).getByText("Óculos Aviador")).toBeTruthy();
    expect(within(lista).getByText("Produto sem nome")).toBeTruthy();
    fireEvent.click(lista.querySelector(`[data-produto-opcao="${KIT2}"]`) as HTMLElement);
    expect(f.escolherKit).toHaveBeenCalledWith(KIT2);
    expect(nomeDoKit({ nome: "  " })).toBe("Produto sem nome");
  });
});

// ------------------------------------------------------------------ 5: foto com modelo

describe("foto com modelo: quem aparece e quantas", () => {
  it("lista modelos e clones prontos primeiro e resume quantas fotos e com quem", () => {
    const opcoes = opcoesDeModelo(
      [
        { id: P1, client_id: CLIENTE, nome: "Bia", ficha: {} as any, invariantes: [], status: "pronta", ancora_imagem_id: "x", motor_preferido_id: null, versao: 1, etica_marcada: true, custo_usd: 0, atualizado_em: "" },
        { id: "dddddddd-0000-4000-8000-000000000002", client_id: CLIENTE, nome: "Sem âncora", ficha: {} as any, invariantes: [], status: "rascunho", ancora_imagem_id: null, motor_preferido_id: null, versao: 1, etica_marcada: true, custo_usd: 0, atualizado_em: "" },
      ],
      [],
    );
    expect(opcoes[0]).toMatchObject({ tipo: "persona", nome: "Bia", pronta: true });
    expect(opcoes[1].pronta).toBe(false);
    expect(resumoDaFotoComModelo({ quantidade: 6, pessoa: { tipo: "persona", id: P1, nome: "Bia" }, produto: "Óculos" })).toBe("6 fotos de Óculos com Bia");
    expect(resumoDaFotoComModelo({ quantidade: 1, pessoa: null, produto: null })).toContain("pessoa nova");
  });

  it("servidor: a pessoa escolhida é conferida e a foto aprovada leva a etiqueta certa", () => {
    expect(lerPessoaEscolhida({ tipo: "persona", id: P1, nome: " Bia " })).toEqual({ tipo: "persona", id: P1, nome: "Bia" });
    expect(lerPessoaEscolhida({ tipo: "outro", id: P1 })).toBeNull();
    expect(lerPessoaEscolhida({ tipo: "clone", id: "x" })).toBeNull();
    expect(tagsDaPessoaNaFoto({ tipo: "clone", id: P1, nome: "Ana" }, true)).toEqual(["pessoa_real_autorizada", `com_clone:${P1}`]);
    expect(tagsDaPessoaNaFoto(null, true)).toEqual(["pessoa_sintetica"]);
    expect(tagsDaPessoaNaFoto(null, false)).toEqual([]);
    const indice = ler("supabase/functions/mesa-foto/index.ts");
    expect(indice).toContain("pessoa_escolhida: d.pessoaEscolhida ?? null");
    expect(indice).toContain("textoDeIdentidadeParaGeracao({ nome: identidadeDaPessoa.nome");
  });
});

// ------------------------------------------------------------------ 6: aprovar com a próxima ação

describe("Aprovar: marcar, aprovar e seguir", () => {
  it("as ações depois de aprovar são Agenda, Estúdio, Mesa, Ads, Kit e Variar; sem aprovada, nenhuma", () => {
    expect(acoesDepoisDeAprovar([{ id: G1, aprovada: true, referencia_web: false, kit_id: KIT }]).map((a) => a.acao)).toEqual(["agenda", "estudio", "mesa", "ads", "kit", "variar"]);
    expect(acoesDepoisDeAprovar([{ id: G1, aprovada: false, referencia_web: false, kit_id: null }])).toEqual([]);
    expect(acoesDepoisDeAprovar([{ id: G1, aprovada: true, referencia_web: true, kit_id: null }])).toEqual([]);
  });

  it("marca, aprova as marcadas e mostra para onde as aprovadas vão", async () => {
    mock.tabelas.foto_ensaios = [];
    mock.tabelas.cliente_imagens = [linha(F1), linha(G1, { gerada: true, modo: "angulo", derivada_de: F1 })];
    mock.invoke.mockImplementation(async (_n: string, o: any) => {
      if (o && o.body && o.body.acao === "acervo_decidir") {
        mock.tabelas.cliente_imagens = (mock.tabelas.cliente_imagens as any[]).map((x) => (x.id === G1 ? { ...x, aprovada: true } : x));
        return { data: { imagem: { ...linha(G1, { gerada: true, modo: "angulo", derivada_de: F1 }), aprovada: true } }, error: null };
      }
      return { data: { ok: true }, error: null };
    });
    const f = valorDaFoto();
    montar(h(EtapaAprovar), f);
    const caixa = await screen.findByRole("checkbox", { name: /Marcar foto 31.jpg/ });
    fireEvent.click(caixa);
    const aprovar = document.querySelector("[data-aprovar-marcadas]") as HTMLButtonElement;
    expect(aprovar.getAttribute("data-aprovar-marcadas")).toBe("1");
    fireEvent.click(aprovar);
    const depois = await esperar("[data-depois-de-aprovar]");
    expect(Array.from(depois.querySelectorAll("[data-proxima-acao]")).map((b) => b.getAttribute("data-proxima-acao"))).toEqual(["agenda", "estudio", "mesa", "ads", "kit", "variar"]);
    fireEvent.click(depois.querySelector('[data-proxima-acao="agenda"]') as HTMLElement);
    expect(f.prepararNaAgenda).toHaveBeenCalledWith([G1]);
  });
});

// ------------------------------------------------------------------ 8: o diretor preenche enquanto a pessoa fala

describe("diretor: preenche produto, modelo, quantidade, ângulos, cenas e luz", () => {
  const produtos = [{ id: KIT, nome: "Óculos Aviador" }];
  const modelos = [{ tipo: "persona" as const, id: P1, nome: "Bia" }];

  it("lê o pedido e monta o preenchimento da ferramenta", () => {
    const i = lerIntencaoDoDiretor("Quero 8 fotos do óculos aviador de frente e de cima, na bancada, luz natural", { produtos, modelos })!;
    expect(i).toMatchObject({ objetivo: "variacoes", produto: { id: KIT }, quantidade: 8, luz: "Natural" });
    expect(i.angulos).toEqual(["Frente", "De cima"]);
    expect(i.cenas).toEqual(["Bancada"]);
    const comModelo = lerIntencaoDoDiretor("6 fotos com a Bia usando o óculos aviador na praia", { produtos, modelos })!;
    expect(comModelo).toMatchObject({ objetivo: "modelo", modelo: { id: P1 }, quantidade: 6 });
    expect(chipsDaIntencao(comModelo)).toEqual(["Foto com modelo", "Óculos Aviador", "Bia", "6 fotos", "Praia"]);
    const p = preenchimentoDaIntencao(i, "texto", 123);
    expect(normalizarPreenchimento(p)).toMatchObject({ objetivo: "variacoes", kitId: KIT, quantidade: 8, em: 123 });
    expect(direcaoDoPreenchimento(p)).toContain("Ângulos: Frente, De cima.");
    // Pergunta ou pedido de organizar não vira proposta.
    expect(lerIntencaoDoDiretor("aprove as fotos de ontem", { produtos, modelos })).toBeNull();
    expect(lerIntencaoDoDiretor("oi", { produtos, modelos })).toBeNull();
  });
});
