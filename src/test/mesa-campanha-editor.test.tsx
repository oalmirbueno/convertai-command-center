import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Editor da campanha rodando (22/10/2026): mudança planejada com diff e confirmação parcial, peças aprovadas
 * protegidas, versão e voltar, produto com foto indo como referência (sem colagem), sugestões com fonte,
 * editor manual; o tom comercial (estrutura, [OFERTA A DEFINIR], nicho regulado); esquema por tipo; mercado
 * com fonte e diferenciação; a reescrita só das peças não aprovadas e o "a refazer".
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  tabelas: {} as Record<string, unknown>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range", "update", "gte"]) b[m] = () => b;
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
      storage: { from: () => ({ upload: vi.fn(() => Promise.resolve({ data: {}, error: null })), createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/img.png" }, error: null }) }) },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import CampanhaMudanca from "@/components/mesa/CampanhaMudanca";
import CampanhaProdutos from "@/components/mesa/CampanhaProdutos";
import { EditorDaIdeia, HistoricoDaCampanha, SeletorDoTom } from "@/components/mesa/CampanhaEditor";
import { arquivosDaPeca, corpoDaPeca, pedidoDaPeca, semColagem, situacaoDaPeca, sugestoesProativas } from "@/components/mesa/regrasDaCampanha";
import type { Campanha, ItemProposto } from "@/components/mesa/mesaV4Api";
import type { ModeloIa } from "@/lib/mesa/api";
import type { AcaoDoAgente } from "@/lib/agentes/acoesDoAgente";
import { aplicarMudanca, itensDaMudanca, itensEscolhidos, pecasComApelido, versoesDaCampanha } from "../../supabase/functions/agente-calendario/modulos/mudanca-da-campanha";
import { blocoDoEsquema, esquemaDaCampanha } from "../../supabase/functions/agente-calendario/modulos/esquemas-de-campanha";
import { blocoDoMercado, mercadoComFonte } from "../../supabase/functions/agente-calendario/modulos/mercado-da-campanha";
import { blocoDoTomDaCampanha, linhaDoTomParaAPeca, nichoRegulado, OFERTA_A_DEFINIR, ofertaInformada, tomDaCampanha } from "../../supabase/functions/agente-calendario/modulos/tom-da-campanha";
import { lerConferencia, perguntasDaConferencia } from "../../supabase/functions/agente-calendario/modulos/conferencia-da-campanha";

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const CAMPANHA_ID = "44444444-4444-4444-4444-444444444444";
const FOTO_KIT = "55555555-5555-4555-8555-555555555555";
const FOTO_PRODUTO = "66666666-6666-4666-8666-666666666666";

const catalogo: ModeloIa[] = [
  {
    id: "openai:gpt-texto", provedor: "openai", modelo_api: "gpt-texto", tipo: "texto", rotulo: "Texto",
    preco_entrada_1m: 1, preco_saida_1m: 2, preco_cache_1m: null, preco_imagem: null,
    raciocinio: ["low", "medium"], padrao_para: ["estrategista", "diretor_arte", "leitura"], ativo: true,
  },
  {
    id: "openai:gpt-image-2", provedor: "openai", modelo_api: "gpt-image-2", tipo: "imagem", rotulo: "Imagem",
    preco_entrada_1m: null, preco_saida_1m: null, preco_cache_1m: null, preco_imagem: { baixa: 0.01, media: 0.04, alta: 0.17 },
    raciocinio: [], padrao_para: ["imagem"], ativo: true,
  },
];

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE, clientName: "Cliente sintético", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 50,
  catalogo, catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(),
});

function montar(filho: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(TooltipProvider, null, h(MesaProvider, { valor: valorDaMesa(), children: filho }))));
}

const chamadas = (acao: string) =>
  mock.invoke.mock.calls.filter((c) => c[1] && c[1].body && c[1].body.acao === acao).map((c) => c[1].body);

const itens: ItemProposto[] = [
  { tema_id: "c1", data: "2026-11-16", formato: "carrossel", etapa: "aquecimento", tema: "Vem aí", gancho: "Guarde a data", cards: [{ ordem: 1, texto: "Capa" }, { ordem: 2, texto: "Data" }] },
  { tema_id: "c2", data: "2026-11-27", formato: "estatico", etapa: "lançamento", tema: "Abriu", gancho: "30% hoje", cards: [{ ordem: 1, texto: "30% OFF" }], task_id: "t-aprovada" },
  { tema_id: "c3", data: "2026-11-28", formato: "estatico", etapa: "último chamado", tema: "Último dia", gancho: "Acaba hoje", cards: [{ ordem: 1, texto: "Acaba hoje" }] },
];

const campanha: Campanha = {
  id: CAMPANHA_ID, client_id: CLIENTE, nome: "Black do PC", pedido: "Black Friday", objetivo: "Vender", periodo_inicio: "2026-11-14", periodo_fim: "2026-11-29",
  conceito: "A maior do ano.", identidade: { tema_visual: "Preto e neon" },
  referencias_ids: [], selo_path: null, proposta_id: "22222222-2222-4222-8222-222222222222", status: "planejada", custo_usd: 0, criado_em: "2026-10-21T12:00:00Z",
  briefing: {
    produtos: [{ nome: "Elixir de desempenho", por_que: "Carro-chefe", imagem_id: FOTO_PRODUTO, preco: "R$ 199", preco_promocional: "R$ 129", destaque: true }],
    oferta: "", mensagem_central: "PC rápido de novo", publico: "Gamers", provas: [], tom: "Direto", cta: "Chame no WhatsApp",
    versoes: [{ id: "v1", criada_em: "2026-10-22T10:00:00Z", motivo: "Mais agressiva", por: "u-1", caminho: `${CLIENTE}/campanhas/${CAMPANHA_ID}/versoes/1.json`, arquivados: [] }],
  } as any,
  imagens: [{ imagem_id: FOTO_KIT, papel: "heroi", nota: "" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mock.tabelas = {};
  mock.invoke.mockImplementation(async (_f: string, { body }: any) => ({ data: { campanha, custo_usd: 0 }, error: null }));
});

// ------------------------------------------------------------------ mudança planejada (servidor, puro)

describe("mudança planejada", () => {
  const pecas = pecasComApelido(itens as any, new Set(), new Set(["c1", "c3"]));
  const resposta = {
    resposta: "Mais agressiva.",
    nome: "Black do PC: só hoje",
    briefing: { oferta: "40% no Elixir", mensagem_central: "", publico: "", tom: "", cta: "" },
    conducao: "Mais urgência a cada dia",
    alterar: [
      { peca: "a1", tema: "", gancho: "Seu PC está lento? 40% só na Black", data: "", etapa: "", cta: "", legenda: "Nova legenda", laminas: [], motivo: "mais direto" },
      { peca: "a2", tema: "Abriu: 40%", gancho: "", data: "", etapa: "", cta: "", legenda: "", laminas: [], motivo: "" },
      { peca: "a9", tema: "Fantasma", gancho: "", data: "", etapa: "", cta: "", legenda: "", laminas: [], motivo: "" },
    ],
    novas: [{ data: "2026-11-26", formato: "estatico", etapa: "urgência", tema: "Amanhã começa", gancho: "Contagem", laminas: ["Falta 1 dia"], cta: "Garanta", produto: "Elixir de desempenho", motivo: "" }],
    sair: [{ peca: "a3", motivo: "repetida" }],
  };
  const { itens: lista, ignorados } = itensDaMudanca(resposta, pecas, { briefing: { oferta: "", __nome: "Black do PC" }, conducao: "", periodo: { inicio: "2026-11-14", fim: "2026-11-29" } });

  it("monta o diff antes → depois, marca a peça aprovada como protegida e ignora apelido inexistente", () => {
    expect(ignorados).toEqual(["a9"]);
    const ops = lista.map((i) => i.operacao);
    expect(ops).toEqual(["briefing", "nome", "conducao", "alterar_peca", "alterar_peca_protegida", "nova_peca", "tirar_peca"]);
    expect(lista[0].detalhe).toBe("(vazio) → 40% no Elixir");
    expect(lista[3].detalhe).toContain("a arte será refeita");
    expect(lista[4].detalhe).toContain("Já aprovada ou na agenda");
  });

  it("sem lista confirma tudo menos os protegidos; com lista, só os escolhidos (confirmação parcial)", () => {
    expect(itensEscolhidos(lista, undefined).map((i) => i.operacao)).not.toContain("alterar_peca_protegida");
    const parcial = itensEscolhidos(lista, [lista[3].ref, lista[5].ref]);
    const r = aplicarMudanca({ briefing: { oferta: "" }, itens: itens as any }, parcial);
    expect(r.mudaram).toEqual(["c1"]);
    expect(r.novas.map((n) => n.tema_id)).toEqual(["c4"]);
    expect(r.briefing.oferta).toBe("");
    const c1 = r.itens.filter((i) => i.tema_id === "c1")[0];
    expect(c1.gancho).toBe("Seu PC está lento? 40% só na Black");
    expect(c1.copy).toBe("Nova legenda");
    // A aprovada não muda sem marcação.
    expect(r.itens.filter((i) => i.tema_id === "c2")[0].tema).toBe("Abriu");
  });

  it("a reescrita aplicada muda só as não aprovadas e devolve as que mudaram (a refazer)", () => {
    const r = aplicarMudanca({ briefing: {}, itens: itens as any }, itensEscolhidos(lista, undefined));
    expect(r.mudaram).toEqual(["c1"]);
    expect(r.sairam).toEqual(["c3"]);
    expect(r.briefing.__nome).toBe("Black do PC: só hoje");
    expect(r.briefing.conducao).toBe("Mais urgência a cada dia");
    const s = situacaoDaPeca(campanha, itens[0], null, [], r.mudaram);
    expect(s.refazer).toBe(true);
    expect(situacaoDaPeca(campanha, itens[2], null, [], r.mudaram).refazer).toBe(false);
  });

  it("o índice de versões só guarda versão com id e caminho", () => {
    const v = versoesDaCampanha([{ id: "v1", caminho: "a/b.json", criada_em: "x", motivo: "m" }, { id: "", caminho: "c" }, null]);
    expect(v.map((x) => x.id)).toEqual(["v1"]);
  });
});

describe("cartão da mudança (confirmação parcial)", () => {
  const acao: AcaoDoAgente = {
    tipo: "acao_agente", agente: "campanha.mudanca", id: "acao-1", resumo: "Mais agressiva", ignorados: [], recusados: [],
    itens: [
      { ref: "m1", alvo_id: "oferta", titulo: "Oferta", detalhe: "(vazio) → 40%", operacao: "briefing", rotulo: "Briefing", para: null } as any,
      { ref: "m2", alvo_id: "c1", titulo: "a1 · Vem aí", detalhe: "Gancho: x → y · a arte será refeita", operacao: "alterar_peca", rotulo: "Muda", para: null } as any,
      { ref: "m3", alvo_id: "c2", titulo: "a2 · Abriu", detalhe: "Já aprovada ou na agenda: só com a sua marcação.", operacao: "alterar_peca_protegida", rotulo: "Muda", para: null } as any,
    ],
  };

  it("a protegida vem desmarcada; desmarcar um item confirma só o resto", async () => {
    montar(h(CampanhaMudanca, { campanha, mensagemId: "msg-1", acao }));
    const protegida = screen.getByRole("checkbox", { name: "Incluir a2 · Abriu" }) as HTMLInputElement;
    expect(protegida.checked).toBe(false);
    expect((screen.getByRole("checkbox", { name: "Incluir a1 · Vem aí" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/1 peça\(s\) a gerar de novo/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Incluir Oferta" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar 1 item(ns)" }));
    await waitFor(() => expect(chamadas("campanha_mudanca_confirmar").length).toBe(1));
    expect(chamadas("campanha_mudanca_confirmar")[0]).toEqual({ acao: "campanha_mudanca_confirmar", mensagem_id: "msg-1", acao_id: "acao-1", refs: ["m2"] });
  });

  it("depois de feita mostra Desfazer", async () => {
    montar(h(CampanhaMudanca, { campanha, mensagemId: "msg-1", acao: { ...acao, executada_em: "2026-10-22T10:00:00Z" } }));
    fireEvent.click(screen.getByRole("button", { name: "Desfazer a mudança" }));
    await waitFor(() => expect(chamadas("campanha_mudanca_desfazer").length).toBe(1));
  });
});

describe("versões e editor manual", () => {
  it("voltar a uma versão chama campanha_versao_voltar", async () => {
    montar(h(HistoricoDaCampanha, { campanha }));
    expect(screen.getByText("Mais agressiva")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Voltar a esta versão" }));
    await waitFor(() => expect(chamadas("campanha_versao_voltar")[0]).toEqual({ acao: "campanha_versao_voltar", campanha_id: CAMPANHA_ID, versao_id: "v1" }));
  });

  it("nome, objetivo e conceito à mão salvam por campanha_salvar", async () => {
    montar(h(EditorDaIdeia, { campanha }));
    fireEvent.click(screen.getByRole("button", { name: "Editar nome, objetivo e conceito" }));
    fireEvent.change(screen.getByLabelText("Conceito da campanha"), { target: { value: "Exorcismo de vírus" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(chamadas("campanha_salvar").length).toBe(1));
    expect(chamadas("campanha_salvar")[0]).toMatchObject({ campanha_id: CAMPANHA_ID, nome: "Black do PC", conceito: "Exorcismo de vírus" });
  });

  it("produto novo com preço entra no briefing sem perder os outros", async () => {
    montar(h(CampanhaProdutos, { campanha }));
    fireEvent.click(screen.getByRole("button", { name: "Adicionar produto" }));
    fireEvent.change(screen.getByLabelText("Nome do produto"), { target: { value: "Poção anti-lentidão" } });
    fireEvent.change(screen.getByLabelText("Preço promocional"), { target: { value: "R$ 59" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar o produto" }));
    await waitFor(() => expect(chamadas("campanha_salvar").length).toBe(1));
    const produtos = chamadas("campanha_salvar")[0].briefing.produtos;
    expect(produtos.map((p: any) => p.nome)).toEqual(["Elixir de desempenho", "Poção anti-lentidão"]);
    expect(produtos[1].preco_promocional).toBe("R$ 59");
    expect(produtos[0].imagem_id).toBe(FOTO_PRODUTO);
  });

  it("o seletor do tom tem Comercial direto como padrão", () => {
    const onValor = vi.fn();
    montar(h(SeletorDoTom, { valor: undefined, onValor }));
    expect(screen.getByRole("radio", { name: "Comercial direto" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "Institucional" }));
    expect(onValor).toHaveBeenCalledWith("institucional");
  });
});

// ------------------------------------------------------------------ produto com foto como referência

describe("produto da campanha nas peças", () => {
  it("a foto do produto vai primeiro como referência, fiel e sem colagem", () => {
    const arquivos = arquivosDaPeca(campanha, { tema_id: "c1", tema: "Vem aí", gancho: "", cards: [] });
    expect(arquivos[0]).toEqual({ imagem_id: FOTO_PRODUTO, nome: "Produto Elixir de desempenho", papel: "referencia" });
    expect(arquivos.every((a) => a.papel === "referencia")).toBe(true);
    const corpo = corpoDaPeca({ clientId: CLIENTE, campanha, item: itens[0], posicao: { i: 1, total: 3 }, marcaId: null, modeloImagemId: null });
    expect(semColagem(corpo.arquivos as { papel: string }[])).toBe(true);
    expect((corpo.arquivos as any[])[0]).toEqual({ imagem_id: FOTO_PRODUTO, nome: "Produto Elixir de desempenho", papel: "referencia" });
    expect(String(corpo.pedido)).toContain("Produto: Elixir de desempenho (de R$ 199 por R$ 129)");
    expect(String(corpo.pedido)).toContain("sem colar a foto");
  });

  it("produto enviado (caminho) vai como referência por caminho", () => {
    const c = { ...campanha, briefing: { ...(campanha.briefing as any), produtos: [{ nome: "Kit", por_que: "", caminho: "x/produto-1.png", destaque: true }] } };
    expect(arquivosDaPeca(c, { tema_id: "c1" })[0]).toEqual({ caminho: "x/produto-1.png", nome: "Produto Kit", papel: "referencia" });
  });
});

// ------------------------------------------------------------------ sugestões proativas

describe("sugestões com fonte", () => {
  const pecas = itens.map((i) => situacaoDaPeca(campanha, i, null));
  it("fim, fase, anúncio sem lead e data do calendário viram pedido pronto ao agente", () => {
    const s = sugestoesProativas({
      campanha, pecas, hoje: "2026-11-27",
      adsPorDia: [{ day: "2026-11-24", spend: 10, leads: 0 }, { day: "2026-11-25", spend: 10, leads: 0 }, { day: "2026-11-26", spend: 12, leads: 0 }],
      datas: [{ titulo: "Black Friday", pico: "2026-11-27" }, { titulo: "Natal", pico: "2026-12-25" }],
    });
    const fontes = s.map((x) => x.fonte);
    expect(fontes[0]).toBe("fim");
    expect(fontes).toContain("ads");
    expect(fontes).toContain("fase");
    expect(fontes).toContain("hype");
    expect(s.filter((x) => x.fonte === "hype").length).toBe(1);
    s.forEach((x) => expect(x.pedido.length).toBeGreaterThan(10));
  });

  it("buraco de dias úteis sem peça vira sugestão da agenda", () => {
    const s = sugestoesProativas({ campanha, pecas, hoje: "2026-11-10" });
    const agenda = s.filter((x) => x.fonte === "agenda")[0];
    expect(agenda).toBeTruthy();
    expect(agenda.pedido).toContain("2026-11-17");
  });
});

// ------------------------------------------------------------------ tom comercial

describe("tom comercial da campanha", () => {
  it("o prompt traz problema, solução, oferta e CTA de ação, com as fases e o educativo só de apoio", () => {
    const b = blocoDoTomDaCampanha(tomDaCampanha(undefined), { temOferta: true });
    expect(b).toContain("Comercial direto");
    expect(b).toContain("problema do cliente, solução, oferta");
    expect(b).toContain("CTA de ação direta");
    expect(b).toContain("urgência = prazo e escassez");
    expect(b).toContain("no máximo 1 peça de prova ou dica por fase");
    expect(b).toContain("mais agressiva");
    expect(b).not.toContain(OFERTA_A_DEFINIR);
  });

  it("sem oferta informada, a marca [OFERTA A DEFINIR] entra no prompt e na peça", () => {
    expect(ofertaInformada({ oferta: "", produtos: [] })).toBe(false);
    expect(ofertaInformada({ oferta: "", produtos: [{ preco_promocional: "R$ 129" }] })).toBe(true);
    expect(blocoDoTomDaCampanha("comercial_direto", { temOferta: false })).toContain(OFERTA_A_DEFINIR);
    const semOferta = { ...campanha, briefing: { ...(campanha.briefing as any), oferta: "", produtos: [] } };
    expect(pedidoDaPeca(semOferta, itens[0], { i: 1, total: 3 })).toContain(OFERTA_A_DEFINIR);
    expect(pedidoDaPeca(semOferta, itens[0], { i: 1, total: 3 })).toContain("Tom de campanha comercial");
    // Institucional não força a marca.
    const institucional = { ...semOferta, briefing: { ...(semOferta.briefing as any), tom_da_campanha: "institucional" } };
    expect(pedidoDaPeca(institucional, itens[0], { i: 1, total: 3 })).not.toContain(OFERTA_A_DEFINIR);
  });

  it("nicho regulado (advocacia) fica comercial dentro da regra", () => {
    expect(nichoRegulado("Escritório de advocacia previdenciária")).toBe("juridico");
    expect(nichoRegulado("Clínica odontológica")).toBe("saude");
    expect(nichoRegulado("Loja de informática")).toBeNull();
    const b = blocoDoTomDaCampanha("comercial_direto", { nicho: "juridico", temOferta: true });
    expect(b).toContain("OAB");
    expect(b).toContain("sem promessa de resultado");
    expect(linhaDoTomParaAPeca("comercial_direto", "juridico")).toContain("OAB");
  });

  it("o Jev confere CTA e oferta por peça e avisa antes da arte", () => {
    const pecas = [{ tema_id: "c1", tema: "Dica", gancho: "Como limpar o PC", laminas: [], cta: "Siga" }];
    const p = perguntasDaConferencia({ nome: "x", briefing: {} } as any, pecas as any);
    expect(Object.keys(p.questions)).toContain("comercial_0");
    const fraca = lerConferencia({ peca_0: { score: 2 }, comercial_0: { score: 0 } }, pecas as any);
    expect(fraca.pecas[0].aviso_comercial).toContain("Sem CTA de ação ou sem oferta");
    const forte = lerConferencia({ peca_0: { score: 2 }, comercial_0: { score: 3 } }, pecas as any);
    expect(forte.pecas[0].aviso_comercial).toBeNull();
  });
});

// ------------------------------------------------------------------ esquemas e mercado

describe("esquema por tipo", () => {
  it("Black traz pré-Black, contagem, Black Week, Cyber Monday e última chamada", () => {
    const e = esquemaDaCampanha("Black Friday do PC", "promocao");
    expect(e.id).toBe("black_friday");
    const bloco = blocoDoEsquema(e);
    for (const m of ["Pré-Black", "Contagem regressiva", "Black Week", "Cyber Monday", "Última chamada"]) expect(bloco).toContain(m);
  });

  it("Natal e promoção da empresa têm esquemas próprios; sem ocasião vale o tipo", () => {
    expect(esquemaDaCampanha("Campanha de Natal", null).id).toBe("natal");
    expect(esquemaDaCampanha("Queima de estoque de outubro", null).id).toBe("promocional");
    expect(esquemaDaCampanha("Nova linha", "lancamento").id).toBe("lancamento");
    expect(esquemaDaCampanha("", null).id).toBe("promocional");
  });
});

describe("o que o mercado está fazendo", () => {
  it("só entra padrão com link que a busca citou; diferenciação e o que evitar ficam", () => {
    const m = mercadoComFonte(
      {
        padroes: [
          { padrao: "Contagem regressiva nos stories", fonte: "Meio & Mensagem", link: "https://exemplo.com/a/" },
          { padrao: "Inventado", fonte: "?", link: "https://nao-citado.com" },
          { padrao: "Sem https", fonte: "x", link: "http://exemplo.com/b" },
        ],
        diferenciacao: "Diagnóstico grátis antes da oferta",
        evitar: ["Só % OFF genérico"],
      },
      ["https://exemplo.com/a", "http://exemplo.com/b"],
      "2026-10-22",
    );
    expect(m).not.toBeNull();
    expect(m!.padroes.map((p) => p.padrao)).toEqual(["Contagem regressiva nos stories"]);
    expect(m!.diferenciacao).toBe("Diagnóstico grátis antes da oferta");
    expect(blocoDoMercado(m)).toContain("Evite o que todo mundo faz");
  });

  it("sem fonte, nada entra", () => {
    expect(mercadoComFonte({ padroes: [{ padrao: "x", fonte: "y", link: "https://a.com" }] }, [], "2026-10-22")).toBeNull();
  });
});
