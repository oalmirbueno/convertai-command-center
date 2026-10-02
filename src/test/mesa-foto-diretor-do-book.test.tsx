import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Diretor do book (02/10, dono: "Book de fotos: hoje é impossível criar"):
 * o plano sai do pedido em palavras (conta pura, sem IA e sem custo) e o
 * "Confirmar e gerar" cria o book e gera as tomadas, com o custo antes.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), tabelas: {} as Record<string, unknown> }));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range", "update", "insert"]) b[m] = () => b;
    const primeiro = () => ({ data: Array.isArray(dados) ? (dados[0] === undefined ? null : dados[0]) : dados, error: null });
    b.maybeSingle = () => Promise.resolve(primeiro());
    b.single = () => Promise.resolve(primeiro());
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null, count: Array.isArray(dados) ? dados.length : 0 }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: () => Promise.resolve({ data: { saldo_usd: 50 }, error: null }),
      from: (tabela: string) => consulta(tabela),
      storage: {
        from: () => ({
          upload: () => Promise.resolve({ data: { path: "x" }, error: null }),
          createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/img.png" }, error: null }),
          createSignedUrls: () => Promise.resolve({ data: [], error: null }),
        }),
      },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import type { ModeloIa } from "@/lib/mesa/api";
import { usd } from "@/lib/mesa/api";
import { MesaFotoProvider, type MesaFotoValor } from "@/components/mesa-foto/Comuns";
import EtapaBook, { pedidosDoPlano, promptDaFotoDoBook } from "@/components/mesa-foto/EtapaBook";
import { esquecerTodosOsLotes } from "@/components/mesa-foto/lote";
import { normalizarFoto } from "@/components/mesa-foto/fotoApi";
import { normalizarBook } from "@/components/mesa-foto/bookApi";
import { custoDasTomadas, planoDoBook, quantidadeNoTexto, type ContextoDoPlano } from "@/components/mesa-foto/diretorDoBook";
import { erroDoBancoDoBook, lerPedidoDoBook } from "../../supabase/functions/mesa-foto/book-regras";

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const KIT = "bbbbbbbb-0000-4000-8000-000000000001";
const KIT2 = "bbbbbbbb-0000-4000-8000-000000000002";
const PERSONA = "cccccccc-0000-4000-8000-000000000001";
const BOOK = "ffffffff-0000-4000-8000-00000000000b";
const F1 = "aaaaaaaa-0000-4000-8000-000000000001";

const ctx = (extra: Partial<ContextoDoPlano> = {}): ContextoDoPlano => ({
  produtos: [
    { id: KIT, nome: "Mouse M720", tipo: "tecnologia" },
    { id: KIT2, nome: "Caneca Aurora", tipo: "produto" },
  ],
  modelos: [{ id: PERSONA, nome: "Lia", tipo: "persona" }],
  custoPorFotoUsd: 0.17,
  ...extra,
});

describe("diretorDoBook: o plano a partir do pedido", () => {
  it("quantidade do texto (número ou por extenso), padrão 8 e limite de 4 a 16", () => {
    expect(quantidadeNoTexto("quero 12 fotos")).toBe(12);
    expect(quantidadeNoTexto("um book com doze fotos")).toBe(12);
    expect(quantidadeNoTexto("book do mouse")).toBeNull();
    expect(planoDoBook("book do Mouse M720", ctx()).quantidade).toBe(8);
    expect(planoDoBook("12 fotos do Mouse M720", ctx()).tomadas).toHaveLength(12);
    const muito = planoDoBook("40 fotos do Mouse M720", ctx());
    expect(muito.quantidade).toBe(16);
    expect(muito.avisos.some((a) => /de 4 a 16/.test(a))).toBe(true);
    expect(planoDoBook("2 fotos da caneca aurora", ctx()).quantidade).toBe(4);
    expect(planoDoBook("2 fotos", ctx({ quantidadeFixa: 6 })).quantidade).toBe(6);
  });

  it("assunto pelo nome citado; sem nome, o primeiro produto com aviso; sem nada, sem tomadas", () => {
    const caneca = planoDoBook("8 fotos da caneca aurora na cozinha", ctx());
    expect(caneca.assunto).toEqual({ tipo: "produto", id: KIT2, nome: "Caneca Aurora", citado: true });
    expect(caneca.tomadas.every((t) => t.prompt.indexOf("Caneca Aurora") >= 0)).toBe(true);
    const semNome = planoDoBook("um book bonito", ctx());
    expect(semNome.assunto && semNome.assunto.id).toBe(KIT);
    expect(semNome.assunto && semNome.assunto.citado).toBe(false);
    expect(semNome.avisos[0]).toMatch(/Nenhum produto citado/);
    const vazio = planoDoBook("book", { produtos: [], modelos: [], custoPorFotoUsd: 0.17 });
    expect(vazio.assunto).toBeNull();
    expect(vazio.tomadas).toHaveLength(0);
    expect(vazio.custoTotalUsd).toBeNull();
    expect(vazio.avisos[0]).toMatch(/Identifique um produto em Fotos/);
    // Modelo citado sem produto: o book é do modelo, toda tomada com a pessoa.
    const lia = planoDoBook("6 fotos da Lia na rua", ctx());
    expect(lia.assunto).toMatchObject({ tipo: "persona", id: PERSONA });
    expect(lia.tomadas.every((t) => t.comModelo)).toBe(true);
    // Assunto escolhido na tela vale mais que o texto.
    expect(planoDoBook("Mouse M720", ctx({ assuntoFixo: { tipo: "produto", id: KIT2 } })).assunto!.id).toBe(KIT2);
  });

  it("modelo: o texto pede pessoa ou cita o modelo num book de produto; as últimas tomadas levam o modelo", () => {
    const sem = planoDoBook("8 fotos do Mouse M720", ctx());
    expect(sem.tomadas.some((t) => t.comModelo)).toBe(false);
    const com = planoDoBook("8 fotos do Mouse M720, algumas com modelo", ctx());
    const comModelo = com.tomadas.filter((t) => t.comModelo);
    expect(comModelo.length).toBe(3);
    expect(com.tomadas.slice(-3).every((t) => t.comModelo)).toBe(true);
    expect(comModelo[0].prompt).toMatch(/pessoa adulta/);
    const lia = planoDoBook("8 fotos do Mouse M720 com a Lia", ctx());
    expect(lia.assunto!.id).toBe(KIT);
    expect(lia.modelo && lia.modelo.id).toBe(PERSONA);
    expect(lia.avisos.some((a) => /sem o rosto fiel/.test(a))).toBe(true);
  });

  it("ângulos, cenas e luzes do texto entram e se espalham pelo book (capa primeiro, sem repetir à toa)", () => {
    const p = planoDoBook("8 fotos do Mouse M720 de frente, 3/4, perfil e detalhe macro, na bancada e na praia, luz de fim de tarde e neon", ctx());
    expect(p.pedidos.angulos).toEqual(["frente", "tres_quartos", "perfil", "detalhe"]);
    expect(p.pedidos.cenas).toEqual(["bancada", "praia"]);
    expect(p.pedidos.luzes).toEqual(["fim_de_tarde", "neon"]);
    expect(p.tomadas[0].titulo).toBe("Capa");
    expect(p.tomadas[0].angulo).toBe("Frente");
    for (const a of ["Frente", "3/4", "Perfil", "Detalhe"]) expect(p.tomadas.some((t) => t.angulo === a)).toBe(true);
    for (const c of ["Bancada", "Praia"]) expect(p.tomadas.some((t) => t.cena === c)).toBe(true);
    for (const l of ["Fim de tarde", "Neon"]) expect(p.tomadas.some((t) => t.luz === l)).toBe(true);
    const combinacoes = p.tomadas.map((t) => `${t.angulo}|${t.cena}|${t.luz}`);
    expect(new Set(combinacoes).size).toBe(combinacoes.length);
    const detalhe = p.tomadas.filter((t) => t.angulo === "Detalhe")[0];
    expect(detalhe.enquadramento).toMatch(/fechado/);
    expect(detalhe.prompt).toMatch(/macro 100 mm/);
    // Outros termos: de cima / flat lay, contra-plongée, estúdio, fundo infinito, loja, casa, rua; natural, dura, estúdio suave.
    const q = planoDoBook("flat lay e contra-plongée no estúdio, fundo infinito, loja, casa e rua; luz natural, luz dura e softbox", ctx());
    expect(q.pedidos.angulos).toEqual(["de_cima", "contra_plongee"]);
    expect(q.pedidos.cenas).toEqual(expect.arrayContaining(["estudio", "fundo_infinito", "loja", "casa", "rua"]));
    expect(q.pedidos.luzes).toEqual(expect.arrayContaining(["natural", "dura", "estudio_suave"]));
    // Sem nada no texto: o padrão do book (frente, 3/4, perfil, detalhe, de cima).
    const padrao = planoDoBook("Mouse M720", ctx());
    expect(padrao.tomadas.map((t) => t.angulo).slice(0, 5)).toEqual(["Frente", "3/4", "Perfil", "Detalhe", "De cima"]);
  });

  it("custo = quantidade x preço de uma foto; sem preço, sem total", () => {
    expect(planoDoBook("12 fotos do Mouse M720", ctx()).custoTotalUsd).toBeCloseTo(2.04, 6);
    expect(planoDoBook("Mouse M720", ctx({ custoPorFotoUsd: null })).custoTotalUsd).toBeNull();
    expect(custoDasTomadas(5, 0.17)).toBeCloseTo(0.85, 6);
    expect(custoDasTomadas(5, null)).toBeNull();
  });

  it("prompts passam nas regras do servidor (sem travessão, nada proibido) e viram pedidos do diretor", () => {
    const p = planoDoBook("12 fotos do Mouse M720, frente e detalhe, com modelo, em casa, luz natural", ctx());
    const pedidos = pedidosDoPlano(p.tomadas);
    expect(pedidos).toHaveLength(12);
    pedidos.forEach((x, i) => {
      expect(x.origem).toEqual({ tipo: "diretor", id: null });
      expect(x.prompt).not.toMatch(/[—–]/);
      expect(() => lerPedidoDoBook(x, i)).not.toThrow();
    });
  });

  it("servidor: só a tabela ausente fala da migration; outro erro leva o código real", () => {
    expect(erroDoBancoDoBook({ code: "42P01", message: 'relation "public.foto_books" does not exist' }, "criar o book").codigo).toBe("book_sem_tabela");
    expect(erroDoBancoDoBook({ code: "PGRST205", message: "Could not find the table 'public.foto_books' in the schema cache" }, "ler os books").message).toMatch(/falta a tabela foto_books/);
    const outro = erroDoBancoDoBook({ code: "23514", message: "violates check constraint" }, "criar o book");
    expect(outro.codigo).toBe("book_indisponivel");
    expect(outro.message).toMatch(/23514/);
    expect(outro.message).not.toMatch(/migration/);
  });

  it("o prompt que gerou a foto vai junto ao Arsenal", () => {
    const book = normalizarBook({ id: BOOK, client_id: CLIENTE, nome: "Book de Mouse M720", assunto: { tipo: "produto", id: KIT }, pedidos: [{ id: "p1", titulo: "Capa", prompt: "o prompt da capa" }] })!;
    const foto = normalizarFoto({ id: F1, client_id: CLIENTE, nome: "Book de Mouse M720: Capa", storage_bucket: "mesa", storage_path: "x.png" })!;
    expect(promptDaFotoDoBook(foto, book)).toBe("o prompt da capa");
  });
});

// ------------------------------------------------------------------ tela

const catalogo: ModeloIa[] = [
  {
    id: "openai:gpt-image-2", provedor: "openai", modelo_api: "gpt-image-2", tipo: "imagem", rotulo: "Imagem",
    preco_entrada_1m: null, preco_saida_1m: null, preco_cache_1m: null, preco_imagem: { baixa: 0.01, media: 0.04, alta: 0.17 },
    raciocinio: [], padrao_para: ["imagem"], ativo: true,
  },
];

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Loja Sintética",
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

const irPara = vi.fn();
const valorDaFoto = (): MesaFotoValor => ({
  kitId: null,
  ensaioId: null,
  imagemId: null,
  escolherKit: vi.fn(),
  escolherEnsaio: vi.fn(),
  irPara,
  selecionadas: [],
  setSelecionadas: vi.fn(),
  abrirAgente: vi.fn(),
}) as unknown as MesaFotoValor;

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(
      QueryClientProvider,
      { client: qc },
      h(MemoryRouter, { initialEntries: [`/mesa-foto?client=${CLIENTE}`] }, h(TooltipProvider, null, h(MesaProvider, { valor: valorDaMesa(), children: h(MesaFotoProvider, { valor: valorDaFoto(), children: h(EtapaBook) }) }))),
    ),
  );
}

let respostas: Record<string, any> = {};
const chamadasDe = (acao: string) =>
  mock.invoke.mock.calls.filter((c: any[]) => c[0] === "mesa-foto" && c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);

beforeAll(() => {
  if (typeof (globalThis as any).ResizeObserver === "undefined") {
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => {};
});

beforeEach(() => {
  vi.clearAllMocks();
  esquecerTodosOsLotes();
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    /* sem armazenamento */
  }
  mock.tabelas = {
    cliente_imagens: [],
    foto_kits: [{ id: KIT, client_id: CLIENTE, tipo: "tecnologia", nome: "Mouse M720", variante: "", atributos: {}, invariantes: [], lacunas: [], frente_imagem_id: F1, status: "confirmado", atualizado_em: "2026-10-01T10:00:00Z" }],
    foto_kit_refs: [{ kit_id: KIT, imagem_id: F1, papel: "identidade", vista: "frente", prioridade: 0 }],
  };
  respostas = { books_listar: { books: [] } };
  mock.invoke.mockImplementation(async (_nome: string, opcoes: any) => {
    const acao = opcoes && opcoes.body ? opcoes.body.acao : "";
    if (respostas[acao] !== undefined) return { data: typeof respostas[acao] === "function" ? respostas[acao](opcoes.body) : respostas[acao], error: null };
    return { data: { ok: true }, error: null };
  });
});

describe("Diretor do book na tela", () => {
  it("escrever o pedido e montar o plano mostra as tomadas e o custo (sem gastar)", async () => {
    montar();
    const bloco = (await waitFor(() => {
      const el = document.querySelector("[data-diretor-do-plano]");
      if (!el) throw new Error("sem bloco");
      return el;
    })) as HTMLElement;
    fireEvent.change(within(bloco).getByLabelText("O que você quer no book?"), { target: { value: "10 fotos do Mouse M720, frente e detalhe, na bancada, luz de fim de tarde" } });
    // Monta de novo até o produto chegar do banco (o plano escolhe pelo nome).
    await waitFor(() => {
      fireEvent.click(within(bloco).getByRole("button", { name: /Montar o plano/ }));
      expect((within(bloco).getByLabelText("Assunto") as HTMLSelectElement).value).toBe(`produto:${KIT}`);
    });
    expect(bloco.querySelectorAll("[data-tomada-do-plano]")).toHaveLength(10);
    expect((bloco.querySelector("[data-custo-do-plano]") as HTMLElement).textContent).toContain(`10 fotos · ~${usd(1.7)}`);
    // Tirar uma tomada baixa a conta.
    fireEvent.click(within(bloco).getByRole("button", { name: "Tirar a foto 10" }));
    await waitFor(() => expect(bloco.querySelectorAll("[data-tomada-do-plano]")).toHaveLength(9));
    expect((bloco.querySelector("[data-custo-do-plano]") as HTMLElement).textContent).toContain(`9 fotos · ~${usd(1.53)}`);
    // Montar não chama nada que gaste.
    expect(chamadasDe("book_criar")).toHaveLength(0);
    expect(chamadasDe("book_gerar")).toHaveLength(0);
  });

  it("Confirmar e gerar (custo antes) cria o book com o assunto, guarda o plano na fila e gera cada tomada", async () => {
    const bookBruto = { id: BOOK, client_id: CLIENTE, nome: "Book de Mouse M720", assunto: { tipo: "produto", id: KIT, nome: "Mouse M720" }, referencias: [], pedidos: [], selecao: [], conversa: [], status: "aberto", custo_usd: 0 };
    respostas.book_criar = { book: bookBruto, assunto: { tipo: "produto", id: KIT, nome: "Mouse M720", categorias: ["produto"] } };
    respostas.book_salvar = (b: any) => ({ book: { ...bookBruto, pedidos: b.pedidos } });
    respostas.book_ler = () => new Promise(() => undefined);
    respostas.book_gerar = () => ({ imagem: null, custo_usd: 0.17 });
    montar();
    const bloco = (await waitFor(() => {
      const el = document.querySelector("[data-diretor-do-plano]");
      if (!el) throw new Error("sem bloco");
      return el;
    })) as HTMLElement;
    fireEvent.change(within(bloco).getByLabelText("O que você quer no book?"), { target: { value: "4 fotos do Mouse M720" } });
    await waitFor(() => {
      fireEvent.click(within(bloco).getByRole("button", { name: /Montar o plano/ }));
      expect((within(bloco).getByLabelText("Assunto") as HTMLSelectElement).value).toBe(`produto:${KIT}`);
    });
    const botao = await within(bloco).findByRole("button", { name: /Confirmar e gerar 4 fotos/ });
    expect(botao.textContent).toContain(usd(0.68));
    fireEvent.click(botao);
    await new Promise((r) => setTimeout(r, 450));
    expect(chamadasDe("book_criar")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /Clique de novo para confirmar/ }));
    await waitFor(() => expect(chamadasDe("book_criar")).toEqual([{ acao: "book_criar", client_id: CLIENTE, assunto: { tipo: "produto", id: KIT } }]));
    await waitFor(() => expect(chamadasDe("book_salvar").length).toBe(1));
    expect(chamadasDe("book_salvar")[0].pedidos).toHaveLength(4);
    expect(chamadasDe("book_salvar")[0].pedidos[0]).toMatchObject({ titulo: "Capa", origem: { tipo: "diretor", id: null } });
    await waitFor(() => expect(chamadasDe("book_gerar")).toHaveLength(4));
    expect(chamadasDe("book_gerar")[0]).toMatchObject({ book_id: BOOK, qualidade: "alta" });
    expect(chamadasDe("book_gerar")[0].pedido.prompt).toMatch(/Mouse M720/);
  });
});
