import { createElement as h } from "react";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Diretor de fotografia agêntico da Mesa Foto (pedido do dono, 26/09: "o
 * diretor não é agente"). Regras puras do servidor
 * (supabase/functions/mesa-foto/diretor-agentico.ts) e a tela
 * (diretorApi.ts e CartaoDaGeracao.tsx): pacote de contexto por cliente,
 * apelidos, custo antes da geração, execução item a item, Desfazer e leitura
 * por visão sem reprocessar. A função é simulada.
 */

const mock = vi.hoisted(() => ({ chamar: vi.fn(), toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));

vi.mock("@/lib/mesa/api", async (original) => {
  const real = await original<typeof import("@/lib/mesa/api")>();
  return { ...real, chamarFuncao: (...args: unknown[]) => mock.chamar(...args) };
});
vi.mock("sonner", () => ({ toast: mock.toast }));

import {
  aplicarCustos,
  blocoDoPacote,
  chamadaDaGeracao,
  chaveDoCusto,
  comLeituras,
  comResultadoDoItem,
  type EntradaDoPacote,
  emAndamento,
  idsDasLeituras,
  imagemJaLida,
  itensPendentes,
  lerFoco,
  marcarAndamento,
  montarPacote,
  normalizarAcoesDoDiretor,
  normalizarGeracoesDoDiretor,
  paraLer,
  pararGeracao,
  pedidoDoItem,
  criarCacheCurto,
} from "../../supabase/functions/mesa-foto/diretor-agentico";
import { desfazerItemAItem, executarItemAItem, type ResultadoDoItem } from "../../supabase/functions/_shared/acoes-do-agente";
import {
  CHAVES_DAS_LISTAS,
  CHAVES_DO_ABERTO,
  chaveDoContextoDoDiretor,
  confirmarGeracaoItemAItem,
  focoDaTela,
  publicarSelecao,
  useContextoDoDiretor,
  type RespostaDoItem,
} from "@/components/mesa-foto/diretorApi";
import CartaoDaGeracao from "@/components/mesa-foto/CartaoDaGeracao";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import { gravarEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { chaveDasFotos } from "@/components/mesa-foto/fotoApi";
import { chaveDoClone, chaveDosClones } from "@/components/mesa-foto/clonesApi";
import { chaveDoBook, chaveDosBooks } from "@/components/mesa-foto/bookApi";
import { chaveDosCanvases } from "@/components/mesa-foto/canvasApi";
import type { AcaoDoAgente } from "@/lib/agentes/acoesDoAgente";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const F1 = "aaaaaaaa-0000-4000-8000-000000000001";
const F2 = "aaaaaaaa-0000-4000-8000-000000000002";
const F3 = "aaaaaaaa-0000-4000-8000-000000000003";
const G1 = "aaaaaaaa-0000-4000-8000-000000000011";
const WEB = "aaaaaaaa-0000-4000-8000-000000000021";
const CL = "cccccccc-0000-4000-8000-000000000001";
const CL_VENCIDO = "cccccccc-0000-4000-8000-000000000002";
const P1 = "bbbbbbbb-0000-4000-8000-000000000001";
const BK = "dddddddd-0000-4000-8000-000000000001";
const KIT = "eeeeeeee-0000-4000-8000-000000000001";
const CAMP = "ffffffff-0000-4000-8000-000000000001";
const UUID_NO_TEXTO = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function entrada(clientId: string, extra: Partial<EntradaDoPacote> = {}): EntradaDoPacote {
  const cliente = clientId === A ? "Loja A" : "Loja B";
  return {
    clientId,
    cliente,
    foco: lerFoco({ etapa: "clones", clone_id: CL, imagem_ids: [G1] }),
    imagens: [
      { id: F1, nome: `${cliente} rosto.jpg`, tags: ["papel:rosto", "tipo:pessoa"], ativa: true, gerada: false, origem: "upload", criado_em: "2026-09-20" },
      { id: F2, nome: `${cliente} corpo.jpg`, tags: [], ativa: true, gerada: false, origem: "upload", criado_em: "2026-09-21" },
      { id: F3, nome: `${cliente} mesa.jpg`, tags: [], ativa: true, gerada: false, origem: "upload", kit_id: KIT, criado_em: "2026-09-22" },
      { id: G1, nome: `${cliente} variação praia.png`, tags: ["gerada", `clone:${CL}`, "pessoa_real_autorizada"], ativa: true, gerada: true, origem: "mesa_foto", modo: "clone", descricao: "Pessoa real recriada por IA", criado_em: "2026-09-25" },
      { id: WEB, nome: "ref loja.jpg", tags: ["referencia_web"], ativa: true, gerada: false, origem: "referencia_web", criado_em: "2026-09-19" },
    ],
    clones: [
      { id: CL, nome: clientId === A ? "Ana" : "Bruno", status: "pronta", identidade_real: [{ imagem_id: F1, principal: true }], autorizacao_ok: true },
      { id: CL_VENCIDO, nome: "Carla", status: "pronta", identidade_real: [{ imagem_id: F2 }], autorizacao_ok: false, motivo_autorizacao: "A autorização desta pessoa venceu: registre uma nova." },
    ],
    prompts: [{ id: P1, titulo: "Herói em papel colorido", categoria: "produto", client_id: null, prompt_pt: "Produto sobre papel de fundo terracota, flash direto suave." }],
    books: [{ id: BK, nome: "Book verão", status: "aberto", assunto: { tipo: "clone", id: CL, nome: clientId === A ? "Ana" : "Bruno" } }],
    kits: [{ id: KIT, nome: "Mouse NTC", variante: "preto", status: "confirmado" }],
    personas: [],
    campanhas: [{ id: CAMP, nome: "Dia dos Pais", status: "ativa" }],
    leituras: {},
    lidasNoStorage: [],
    contexto: { marca: cliente, cerebro: true, dossie: true, campanha: "Dia dos Pais" },
    ...extra,
  };
}

describe("pacote de contexto do cliente (servidor, sem IA)", () => {
  it("cada cliente tem o seu pacote, com apelidos e sem UUID no que vai ao modelo", () => {
    const pa = montarPacote(entrada(A));
    const pb = montarPacote(entrada(B));
    expect(pa.cliente).toBe("Loja A");
    expect(pb.cliente).toBe("Loja B");
    // O que está marcado vem primeiro; depois as do clone aberto.
    expect(pa.imagens[0]).toMatchObject({ id: G1, ref: "i1" });
    expect(pa.clones[0]).toMatchObject({ id: CL, ref: "c1", titulo: "Ana" });
    expect(pb.clones[0].titulo).toBe("Bruno");
    expect(pa.prompts[0].ref).toBe("p1");
    expect(pa.books[0].ref).toBe("b1");
    expect(pa.kits[0].ref).toBe("k1");
    expect(pa.campanhas[0].ref).toBe("cp1");
    const bloco = blocoDoPacote(pa);
    expect(bloco).toContain("clone aberto c1 (Ana)");
    expect(bloco).toContain("fotos marcadas na tela: i1");
    expect(bloco).toContain("cp1 | Dia dos Pais");
    expect(bloco).not.toMatch(UUID_NO_TEXTO);
    expect(blocoDoPacote(pb)).not.toContain("c1 | Ana");
    expect(blocoDoPacote(pb)).not.toContain("Loja A");
    expect(pa.resumo).toContain("clones");
    expect(pa.foco_rotulo).toBe("Clones, Ana aberto, 1 foto marcada");
  });

  it("troca de cliente troca a chave do contexto na tela (nada do anterior aparece)", async () => {
    const foco = focoDaTela({ clientId: A, etapa: "acervo", selecionadas: [], kitId: null, ensaioId: null });
    expect(chaveDoContextoDoDiretor(A, foco)).not.toEqual(chaveDoContextoDoDiretor(B, foco));
    mock.chamar.mockReset();
    let pronto: (v: unknown) => void = () => undefined;
    mock.chamar.mockImplementation((_f: string, corpo: any) =>
      corpo.client_id === A ? Promise.resolve({ resumo: "12 fotos · 1 clone", foco_rotulo: "Fotos", contagens: { fotos: 12 } }) : new Promise((r) => (pronto = r)),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const embrulho = ({ children }: { children: any }) => h(QueryClientProvider, { client: qc }, children);
    const { result, rerender } = renderHook(({ c }) => useContextoDoDiretor(c, focoDaTela({ clientId: c, etapa: "acervo", selecionadas: [], kitId: null, ensaioId: null })), {
      wrapper: embrulho,
      initialProps: { c: A },
    });
    await waitFor(() => expect(result.current.data && result.current.data.resumo).toBe("12 fotos · 1 clone"));
    expect(mock.chamar).toHaveBeenCalledWith("mesa-foto", expect.objectContaining({ acao: "diretor_contexto", client_id: A }));
    rerender({ c: B });
    // Cliente novo: o resumo do anterior não fica à vista enquanto o novo carrega.
    expect(result.current.data).toBeUndefined();
    await act(async () => pronto({ resumo: "3 fotos", foco_rotulo: "Fotos" }));
    await waitFor(() => expect(result.current.data && result.current.data.resumo).toBe("3 fotos"));
  });

  it("o foco lê o que está aberto só na etapa em que o dono está, e a seleção da etapa vai primeiro", () => {
    gravarEstadoDaTela(CHAVES_DO_ABERTO.clone(A), CL);
    gravarEstadoDaTela(CHAVES_DO_ABERTO.book(A), BK);
    publicarSelecao(A, "clones", [G1]);
    const noClone = focoDaTela({ clientId: A, etapa: "clones", selecionadas: [F2], kitId: KIT, ensaioId: null });
    expect(noClone).toMatchObject({ etapa: "clones", clone_id: CL, book_id: null, kit_id: KIT, imagem_ids: [G1, F2] });
    const noBook = focoDaTela({ clientId: A, etapa: "book", selecionadas: [], kitId: null, ensaioId: null });
    expect(noBook).toMatchObject({ clone_id: null, book_id: BK, imagem_ids: [] });
    // Outro cliente não herda o aberto nem a seleção.
    expect(focoDaTela({ clientId: B, etapa: "clones", selecionadas: [], kitId: null, ensaioId: null })).toMatchObject({ clone_id: null, imagem_ids: [] });
    publicarSelecao(A, "clones", []);
  });

  it("as chaves que a tela relê são as mesmas das listas da Mesa Foto", () => {
    expect(CHAVES_DAS_LISTAS.fotos(A)).toEqual(chaveDasFotos(A));
    expect(CHAVES_DAS_LISTAS.clones(A)).toEqual(chaveDosClones(A));
    expect(CHAVES_DAS_LISTAS.clone(CL)).toEqual(chaveDoClone(CL));
    expect(CHAVES_DAS_LISTAS.books(A)).toEqual(chaveDosBooks(A));
    expect(CHAVES_DAS_LISTAS.book(BK)).toEqual(chaveDoBook(BK));
    expect(CHAVES_DAS_LISTAS.canvases(A)).toEqual(chaveDosCanvases(A));
  });

  it("cache curto: vale por pouco tempo e esquece por cliente", () => {
    const c = criarCacheCurto<number>(1000);
    c.gravar(`${A}|x`, 1, 0);
    c.gravar(`${B}|x`, 2, 0);
    expect(c.ler(`${A}|x`, 500)).toBe(1);
    expect(c.ler(`${A}|x`, 1500)).toBeNull();
    c.esquecer(`${B}|`);
    expect(c.ler(`${B}|x`, 10)).toBeNull();
  });
});

describe("ações sem custo com apelidos", () => {
  it("troca apelido por alvo, ignora apelido inventado e recusa clone sem autorização", () => {
    const p = montarPacote(entrada(A));
    const refDe = (id: string) => (p.imagens.find((i) => i.id === id) || { ref: "?" }).ref;
    const a = normalizarAcoesDoDiretor(
      {
        resumo: "Aprovo e organizo.",
        itens: [
          { operacao: "aprovar_e_enviar", ref: refDe(G1), para: "" },
          { operacao: "mandar_para_campanha", ref: refDe(G1), para: "cp1" },
          { operacao: "fotos_do_clone", ref: "c1", para: `${refDe(F1)}, ${refDe(F2)}` },
          { operacao: "fotos_do_clone", ref: "c2", para: refDe(F1) },
          { operacao: "levar_ao_canvas", ref: refDe(F3), para: "" },
          { operacao: "montar_book", ref: "k1", para: "" },
          { operacao: "arquivar_foto", ref: "i99", para: "" },
          { operacao: "aprovar_e_enviar", ref: refDe(WEB), para: "" },
        ],
      },
      p,
    );
    expect(a).not.toBeNull();
    const acao = a as NonNullable<typeof a>;
    expect(acao.agente).toBe("diretor");
    expect(acao.itens.map((i) => [i.operacao, i.alvo_id])).toEqual([
      ["aprovar_e_enviar", G1],
      ["mandar_para_campanha", G1],
      ["fotos_do_clone", CL],
      ["levar_ao_canvas", F3],
      ["montar_book", KIT],
    ]);
    expect(acao.itens[1].para).toBe(CAMP);
    expect(acao.itens[1].para_rotulo).toBe("Dia dos Pais");
    expect(acao.itens[2].para).toBe(`${F1},${F2}`);
    expect(acao.itens[4].para).toBe("Book de Mouse NTC (preto)");
    expect(acao.ignorados).toContain("i99");
    expect(acao.recusados.map((r) => r.operacao)).toEqual(expect.arrayContaining(["fotos_do_clone", "aprovar_e_enviar"]));
    expect(acao.recusados.find((r) => r.ref === "c2")!.motivo).toContain("venceu");
  });

  it("foto gerada não vira foto de origem do clone", () => {
    const p = montarPacote(entrada(A));
    const g = p.imagens.find((i) => i.id === G1)!.ref;
    expect(normalizarAcoesDoDiretor({ resumo: "", itens: [{ operacao: "fotos_do_clone", ref: "c1", para: g }] }, p)).toBeNull();
  });
});

describe("gerações pagas: custo antes, item a item, Desfazer", () => {
  const proposta = () => {
    const p = montarPacote(entrada(A));
    const acao = normalizarGeracoesDoDiretor(
      [
        { operacao: "gerar_clone", ref: "c1", quantidade: 3, cenario: "praia ao fim da tarde", pose: "sentada na areia", roupa: "linho claro", pedido: null, formato: "4:5", prompt_ref: null },
        { operacao: "gerar_clone", ref: "c2", quantidade: 2, cenario: "café", pose: null, roupa: null, pedido: null, formato: null, prompt_ref: null },
        { operacao: "variar_imagem", ref: p.imagens.find((i) => i.id === WEB)!.ref, quantidade: 1, cenario: "mesa", pose: null, roupa: null, pedido: null, formato: null, prompt_ref: null },
        { operacao: "gerar_do_prompt", ref: "p1", quantidade: 1, cenario: null, pose: null, roupa: null, pedido: "com sombra curta", formato: null, prompt_ref: null },
        { operacao: "gerar_clone", ref: "c9", quantidade: 1, cenario: null, pose: null, roupa: null, pedido: null, formato: null, prompt_ref: null },
      ],
      p,
    );
    return { p, acao: acao as NonNullable<typeof acao> };
  };

  it("uma foto por item (g1..gN), travas com motivo e o pedido guardado no servidor", () => {
    const { acao } = proposta();
    expect(acao.agente).toBe("diretor_geracao");
    expect(acao.itens.map((i) => i.ref)).toEqual(["g1", "g2", "g3", "g4"]);
    expect(acao.itens.slice(0, 3).every((i) => i.alvo_id === CL && i.operacao === "gerar_clone")).toBe(true);
    expect(acao.itens[0].titulo).toBe("Ana (1 de 3)");
    expect(acao.itens[3]).toMatchObject({ operacao: "gerar_do_prompt", alvo_id: P1 });
    expect(pedidoDoItem(acao, "g4")).toMatchObject({ kit_id: KIT, prompt_texto: expect.stringContaining("terracota") });
    expect(pedidoDoItem(acao, "g2")).toMatchObject({ clone_id: CL, cenario: "praia ao fim da tarde", vez: 2, vezes: 3 });
    expect(acao.recusados.find((r) => r.ref === "c2")!.motivo).toContain("venceu");
    expect(acao.recusados.some((r) => r.motivo.indexOf("Referência da internet") === 0)).toBe(true);
    expect(acao.ignorados).toContain("c9");
    // Nada de UUID no que o modelo viu; o id real só existe na proposta guardada.
    expect(JSON.stringify(acao.itens.map((i) => i.detalhe))).not.toMatch(UUID_NO_TEXTO);
  });

  it("prompt sem produto aberto não gera; o limite de fotos por pedido vale", () => {
    const p = montarPacote(entrada(A, { kits: [], foco: lerFoco({ etapa: "biblioteca" }) }));
    const a = normalizarGeracoesDoDiretor([{ operacao: "gerar_do_prompt", ref: "p1", quantidade: 2, cenario: null, pose: null, roupa: null, pedido: null, formato: null, prompt_ref: null }], p)!;
    expect(a.itens).toHaveLength(0);
    expect(a.recusados[0].motivo).toContain("Abra o produto");
    const muitas = normalizarGeracoesDoDiretor(
      [1, 2, 3].map(() => ({ operacao: "gerar_clone", ref: "c1", quantidade: 8, cenario: "estúdio", pose: null, roupa: null, pedido: null, formato: null, prompt_ref: null })),
      montarPacote(entrada(A)),
    )!;
    expect(muitas.itens).toHaveLength(16);
    expect(muitas.recusados.some((r) => r.operacao === "limite")).toBe(true);
  });

  it("o custo estimado fica na proposta antes do Confirmar (item sem estimativa marca incompleto)", () => {
    const { acao } = proposta();
    const pd1 = pedidoDoItem(acao, "g1")!;
    const pd4 = pedidoDoItem(acao, "g4")!;
    const comCusto = aplicarCustos(acao, { [chaveDoCusto(pd1)]: 0.12, [chaveDoCusto(pd4)]: 0.2 });
    expect(comCusto.custo_estimado_usd).toBeCloseTo(0.56, 6);
    expect((comCusto.contexto as any).custo_incompleto).toBe(false);
    const semUm = aplicarCustos(acao, { [chaveDoCusto(pd1)]: 0.12 });
    expect((semUm.contexto as any).custo_incompleto).toBe(true);
  });

  it("cada item chama a ação que a Mesa Foto já tem", () => {
    const { acao } = proposta();
    expect(chamadaDaGeracao(pedidoDoItem(acao, "g1")!, A)).toMatchObject({ acao: "clone_variacao_gerar", corpo: { modelo_id: CL, formato: "4:5", pedido: { cenario: "praia ao fim da tarde" } } });
    expect(chamadaDaGeracao(pedidoDoItem(acao, "g4")!, A)).toMatchObject({ acao: "book_gerar", precisaDeBook: { kit_id: KIT } });
    expect(chamadaDaGeracao(pedidoDoItem(acao, "g4")!, A, { bookId: BK })).toMatchObject({ acao: "book_gerar", corpo: { book_id: BK } });
    const p = montarPacote(entrada(A));
    const doClone = normalizarGeracoesDoDiretor([{ operacao: "variar_imagem", ref: "i1", quantidade: 1, cenario: null, pose: null, roupa: null, pedido: null, formato: null, prompt_ref: null }], p)!;
    expect(chamadaDaGeracao(pedidoDoItem(doClone, "g1")!, A)).toEqual({ acao: "clone_variacao_refazer", corpo: { modelo_id: CL, imagem_id: G1 } });
    const refF3 = p.imagens.find((i) => i.id === F3)!.ref;
    const produto = normalizarGeracoesDoDiretor([{ operacao: "variar_imagem", ref: refF3, quantidade: 1, cenario: "bancada de travertino", pose: null, roupa: null, pedido: null, formato: null, prompt_ref: null }], p)!;
    expect(chamadaDaGeracao(pedidoDoItem(produto, "g1")!, A)).toMatchObject({ acao: "preparar", corpo: { client_id: A, imagem_id: F3, modo: "cenario", kit_id: KIT } });
  });

  it("execução item a item: cada resultado é guardado, a proposta só fica feita no fim, e item em andamento não repete", async () => {
    const { acao } = proposta();
    let atual: AcaoDoAgente = acao as AcaoDoAgente;
    expect(emAndamento(marcarAndamento(acao, "g1", 1000), "g1", 2000)).toBe(true);
    expect(emAndamento(marcarAndamento(acao, "g1", 1000), "g1", 1000 + 11 * 60 * 1000)).toBe(false);
    const ordem: string[] = [];
    for (const item of itensPendentes(acao)) {
      const [r] = await executarItemAItem([item], async (it) => {
        ordem.push(it.ref);
        if (it.ref === "g2") throw new Error("Saldo insuficiente na carteira de IA deste cliente.");
        return { desfazer: { imagem_id: `img-${it.ref}`, custo_usd: 0.1 } };
      }, 1);
      atual = comResultadoDoItem(atual as any, r, "u-1") as AcaoDoAgente;
      if (item.ref !== "g4") expect(atual.executada_em).toBeFalsy();
    }
    expect(ordem).toEqual(["g1", "g2", "g3", "g4"]);
    expect(atual.executada_em).toBeTruthy();
    expect(atual.resultados!.find((r) => r.ref === "g2")).toMatchObject({ ok: false, motivo: expect.stringContaining("Saldo") });
    expect(itensPendentes(atual as any)).toHaveLength(0);
  });

  it("Desfazer arquiva o que saiu, na ordem inversa; cancelar no meio guarda o feito", async () => {
    const { acao } = proposta();
    const resultados: ResultadoDoItem[] = [
      { ref: "g1", alvo_id: CL, titulo: "Ana", operacao: "gerar_clone", ok: true, desfazer: { imagem_id: "img-1" } },
      { ref: "g2", alvo_id: CL, titulo: "Ana", operacao: "gerar_clone", ok: false, motivo: "Saldo" },
      { ref: "g3", alvo_id: CL, titulo: "Ana", operacao: "gerar_clone", ok: true, desfazer: { imagem_id: "img-3" } },
    ];
    const arquivadas: string[] = [];
    const r = await desfazerItemAItem(resultados, async (x) => {
      arquivadas.push(String(x.desfazer!.imagem_id));
    });
    expect(arquivadas).toEqual(["img-3", "img-1"]);
    expect(r.voltaram).toBe(2);
    expect(pararGeracao({ ...acao, resultados: [resultados[0]] }, "u-1").executada_em).toBeTruthy();
    expect(pararGeracao(acao, "u-1").descartada_em).toBeTruthy();
  });
});

describe("leitura por visão guardada (uma vez por imagem)", () => {
  it("só lê o que não tem leitura; foto lida pelo acervo ou com JSON guardado não é lida de novo", () => {
    const e = entrada(A, { foco: lerFoco({ etapa: "clones", clone_id: CL, imagem_ids: [F1, F2, WEB] }) });
    const p = montarPacote(e);
    // F1 já foi lida pelo "Ler foto" (tags papel:/tipo:); WEB é referência da internet; G1 é variação nova do clone.
    expect(paraLer(p, [])).toEqual([F2, G1]);
    expect(p.sem_leitura).toEqual([F2, G1]);
    const lida = comLeituras(e, { [F2]: { descricao: "Pessoa de corpo inteiro, camisa azul.", observado: [], texto_lido: "", lida_em: "2026-09-26" } });
    const depois = montarPacote(lida);
    expect(paraLer(depois, [])).toEqual([G1]);
    expect(depois.imagens.find((i) => i.id === F2)!.detalhe).toContain("leitura: Pessoa de corpo inteiro");
    // Guardada no Storage (nome do arquivo = id da imagem): conta como lida sem baixar de novo.
    const doStorage = montarPacote({ ...e, lidasNoStorage: idsDasLeituras([`${G1}.json`, `${F2}.json`, "outra-coisa.txt"]) });
    expect(paraLer(doStorage, [])).toEqual([]);
    expect(imagemJaLida({ id: G1, nome: "x", gerada: true, tags: ["papel:pessoa"] }, new Set())).toBe(false);
  });
});

describe("tela: cartão da geração", () => {
  const CLIENTE = A;
  const valorDaMesa = (saldo: number | null = 50): MesaValor => ({
    clientId: CLIENTE,
    clientName: "Loja A",
    userId: "u-1",
    isAdmin: true,
    podeRecarregar: true,
    saldoUsd: saldo,
    catalogo: [],
    catalogoCarregando: false,
    atualizarCusto: vi.fn(),
    abrirRecarga: vi.fn(),
    abrirChaves: vi.fn(),
    abrirModelos: vi.fn(),
  });
  const acaoDaTela = (): AcaoDoAgente => {
    const p = montarPacote(entrada(A));
    const a = normalizarGeracoesDoDiretor([{ operacao: "gerar_clone", ref: "c1", quantidade: 3, cenario: "praia", pose: null, roupa: null, pedido: null, formato: null, prompt_ref: null }], p)!;
    return aplicarCustos(a, { [chaveDoCusto(pedidoDoItem(a, "g1")!)]: 0.1 }) as AcaoDoAgente;
  };
  const montar = (acao: AcaoDoAgente, executar: (m: string, a: string, r: string) => Promise<RespostaDoItem>, saldo: number | null = 50) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(h(QueryClientProvider, { client: qc }, h(MesaProvider, { valor: valorDaMesa(saldo), children: h(CartaoDaGeracao, { acao, mensagemId: "m-1", executar }) })));
  };

  beforeEach(() => {
    mock.toast.success.mockReset();
  });

  it("mostra o custo no botão antes e nada é gerado sem o Confirmar", () => {
    const executar = vi.fn();
    montar(acaoDaTela(), executar);
    expect(screen.getByRole("button", { name: /Gerar 3 fotos · ~US\$ 0,30/ })).toBeTruthy();
    expect(executar).not.toHaveBeenCalled();
  });

  it("sem saldo para o total, o botão não gera", () => {
    montar(acaoDaTela(), vi.fn(), 0.2);
    expect((screen.getByRole("button", { name: /Gerar 3 fotos/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Saldo da carteira do cliente não cobre/)).toBeTruthy();
  });

  it("Confirmar gera uma foto por vez, na ordem, e termina feito com Desfazer", async () => {
    const acao = acaoDaTela();
    const chamadas: string[] = [];
    let atual: any = acao;
    const executar = vi.fn(async (_m: string, _a: string, ref: string): Promise<RespostaDoItem> => {
      chamadas.push(ref);
      const item = acao.itens.find((i) => i.ref === ref)!;
      const resultado = { ref, alvo_id: item.alvo_id, titulo: item.titulo, operacao: item.operacao, ok: true, desfazer: { imagem_id: `img-${ref}`, clone_id: CL, custo_usd: 0.1 } };
      atual = comResultadoDoItem(atual, resultado, "u-1");
      return { anexo: atual, resultado, custo_usd: 0.1, repetido: false };
    });
    montar(acao, executar);
    fireEvent.click(screen.getByRole("button", { name: /Gerar 3 fotos/ }));
    await waitFor(() => expect(document.querySelector("[data-acao-agente='feita']")).toBeTruthy());
    expect(chamadas).toEqual(["g1", "g2", "g3"]);
    expect(screen.getByRole("button", { name: /Desfazer/ })).toBeTruthy();
  });

  it("confirmar de novo depois de uma queda continua só com o que falta", async () => {
    const acao = acaoDaTela();
    const feitoAntes = { ref: "g1", alvo_id: CL, titulo: "Ana", operacao: "gerar_clone", ok: true, desfazer: { imagem_id: "img-g1" } };
    const refs: string[] = [];
    const r = await confirmarGeracaoItemAItem({
      mensagemId: "m-1",
      acao: { ...acao, resultados: [feitoAntes] },
      executar: async (_m, _a, ref) => {
        refs.push(ref);
        return { anexo: null, resultado: null, custo_usd: 0.1, repetido: false };
      },
    });
    expect(refs).toEqual(["g2", "g3"]);
    expect(r.custo_usd).toBeCloseTo(0.2, 6);
  });
});
