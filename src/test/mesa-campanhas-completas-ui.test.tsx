import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Campanha completa (pedido do dono, 25/09): imagens da campanha (acervo e
 * envio, com papel e porquê), briefing e plano de imagens. A tela chama
 * campanha_salvar (sem custo) e campanha_plano_imagens (estrategista + Jev) na
 * função agente-calendario; campanha_criar leva briefing e imagens.
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
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range", "update"]) b[m] = () => b;
    const primeiro = () => ({ data: Array.isArray(dados) ? (dados[0] === undefined ? null : dados[0]) : dados, error: null });
    b.maybeSingle = () => Promise.resolve(primeiro());
    b.single = () => Promise.resolve(primeiro());
    b.then = (ok: any, erro: any) =>
      Promise.resolve({ data: dados, error: null, count: Array.isArray(dados) ? dados.length : 0 }).then(ok, erro);
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
          createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/img.png" }, error: null }),
        }),
      },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import CampanhaNova from "@/components/mesa/CampanhaNova";
import CampanhaDetalhe from "@/components/mesa/CampanhaDetalhe";
import {
  assinaturaDoPlano,
  corpoDoSalvarCampanha,
  normalizarBriefing,
  normalizarImagensDaCampanha,
  normalizarPlanoDeImagens,
  planoDesatualizado,
} from "@/components/mesa/campanhasApi";
import { corpoDaCampanha, type Campanha } from "@/components/mesa/mesaV4Api";
import type { ModeloIa } from "@/lib/mesa/api";

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const FOTO_KIT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOTO_LOJA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FOTO_WEB = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const catalogo: ModeloIa[] = [
  {
    id: "openai:gpt-texto", provedor: "openai", modelo_api: "gpt-texto", tipo: "texto", rotulo: "Texto",
    preco_entrada_1m: 1, preco_saida_1m: 2, preco_cache_1m: null, preco_imagem: null,
    raciocinio: ["low", "medium"], padrao_para: ["estrategista"], ativo: true,
  },
  {
    id: "openai:gpt-image-2", provedor: "openai", modelo_api: "gpt-image-2", tipo: "imagem", rotulo: "Imagem",
    preco_entrada_1m: null, preco_saida_1m: null, preco_cache_1m: null, preco_imagem: { baixa: 0.01, media: 0.04, alta: 0.17 },
    raciocinio: [], padrao_para: ["imagem"], ativo: true,
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

function montar(filho: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MesaProvider, { valor: valorDaMesa() }, filho)));
}

const chamadasDe = (acao: string) =>
  mock.invoke.mock.calls.filter((c) => c[0] === "agente-calendario" && c[1] && c[1].body && c[1].body.acao === acao).map((c) => c[1].body);

const acervo = [
  { id: FOTO_KIT, storage_bucket: "mesa", storage_path: `${CLIENTE}/foto/originais/kit.jpg`, nome: "kit-casal.jpg", pasta: "Produtos", categoria: "produto", tags: [], descricao: "Kit para casal", origem: "mesa_foto" },
  { id: FOTO_LOJA, storage_bucket: "mesa", storage_path: `${CLIENTE}/foto/originais/loja.jpg`, nome: "loja.jpg", pasta: "Ambiente", categoria: "ambiente", tags: [], descricao: "Fachada da loja", origem: "workspace" },
  { id: FOTO_WEB, storage_bucket: "mesa", storage_path: `${CLIENTE}/foto/web/x.jpg`, nome: "Ref. internet: kit", pasta: "Mesa Foto / Referências da internet", categoria: "produto", tags: ["mesa_foto", "referencia_web", "nao_publicar"], descricao: null, origem: "mesa_foto" },
];

const proposta = {
  id: "22222222-2222-2222-2222-222222222222",
  client_id: CLIENTE,
  project_id: "33333333-3333-3333-3333-333333333333",
  periodo_inicio: "2026-10-01",
  periodo_fim: "2026-10-20",
  parametros: { origem: "campanha" },
  status: "pronta",
  diagnostico: null,
  itens: [
    { tema_id: "c1", data: "2026-10-02", formato: "carrossel", tema: "Teaser do amor", gancho: "Quem ama presenteia", cards: [{ ordem: 1, funcao: "capa", texto: "O presente que fala por você" }, { ordem: 2, texto: "Oferta" }] },
  ],
  conversa_id: null,
  task_ids: [],
  gravada_em: null,
};

const imagens = [
  { imagem_id: FOTO_KIT, papel: "heroi" as const, nota: "Mostra o kit inteiro" },
  { imagem_id: FOTO_LOJA, papel: "ambiente" as const, nota: "" },
];

const plano = {
  gerado_em: "2026-09-25T10:00:00Z",
  assinatura: assinaturaDoPlano(imagens, proposta.itens),
  fonte: "campanha",
  resumo: "O kit carrega a campanha: capa e oferta com ele.",
  analise: [{ imagem_id: FOTO_KIT, o_que_mostra: "Kit com duas canecas e flores", forca: "Produto inteiro e nítido", serve_para: "capa e oferta" }],
  pecas: [
    { tema_id: "c1", ordem: 1, imagem_id: FOTO_KIT, candidatas: [FOTO_KIT, FOTO_LOJA], uso: "fundo", por_que: "A capa precisa do produto herói inteiro.", escolha: "jev", confianca: 0.82, aviso: null },
    { tema_id: "c1", ordem: 2, imagem_id: FOTO_LOJA, candidatas: [FOTO_LOJA], uso: "fundo", por_que: "Mostra onde retirar.", escolha: "estrategista", confianca: null, aviso: "O Jev acha que nenhuma das fotos serve bem a esta lâmina. Confira antes de gerar." },
  ],
  lacunas: ["Kit em uso por um casal real"],
  jev_erro: null,
};

const campanha: Campanha = {
  id: "44444444-4444-4444-4444-444444444444",
  client_id: CLIENTE,
  nome: "Promoção do amor",
  pedido: "promoção do amor",
  objetivo: "Vender kits para casal",
  periodo_inicio: "2026-10-01",
  periodo_fim: "2026-10-20",
  conceito: "O amor se mostra nos detalhes.",
  identidade: { tema_visual: "Luz quente", paleta_apoio: [{ nome: "Vinho", hex: "#880516" }], tipografia: "Serifa", elementos: "Corações", tom: "Leve", selo: { texto: "Amor em dobro", descricao: "Selo redondo" } },
  referencias_ids: [],
  selo_path: null,
  proposta_id: proposta.id,
  status: "planejada",
  custo_usd: 0.2,
  criado_em: "2026-09-23T12:00:00Z",
  briefing: {
    produtos: [{ nome: "Kit casal", por_que: "Mais vendido em outubro" }],
    oferta: "20% nos kits até 20/10",
    mensagem_central: "Presente que fala por você",
    publico: "Casais de 25 a 40 anos",
    provas: ["4,9 no Google"],
    tom: "Leve e romântico",
    cta: "Chame no WhatsApp",
  },
  imagens,
  plano_imagens: plano as any,
};

beforeEach(() => {
  vi.clearAllMocks();
  mock.tabelas = { cliente_imagens: acervo };
  mock.upload.mockResolvedValue({ data: {}, error: null });
  mock.invoke.mockImplementation(async (_funcao: string, { body }: any) => {
    if (body.acao === "campanha_criar") return { data: { campanha, proposta, resposta: "ok", project_id: "proj", custo_usd: 0.1 }, error: null };
    if (body.acao === "campanha_salvar") return { data: { campanha: { ...campanha, imagens: body.imagens || campanha.imagens, briefing: body.briefing || campanha.briefing }, recusadas: [], custo_usd: 0 }, error: null };
    if (body.acao === "campanha_plano_imagens") return { data: { campanha, plano_imagens: plano, custo_usd: 0.05 }, error: null };
    return { data: {}, error: null };
  });
});

describe("contrato e regras puras", () => {
  it("imagens: só UUID, sem repetir, papel conhecido, até 12", () => {
    const lista = normalizarImagensDaCampanha([
      { imagem_id: FOTO_KIT, papel: "heroi", nota: " kit " },
      { imagem_id: FOTO_KIT, papel: "apoio" },
      { imagem_id: "nao-e-uuid" },
      { imagem_id: FOTO_LOJA, papel: "qualquer" },
    ]);
    expect(lista).toEqual([
      { imagem_id: FOTO_KIT, papel: "heroi", nota: "kit" },
      { imagem_id: FOTO_LOJA, papel: "apoio", nota: "" },
    ]);
    const muitas = Array.from({ length: 15 }, (_, i) => ({ imagem_id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}` }));
    expect(normalizarImagensDaCampanha(muitas).length).toBe(12);
  });

  it("briefing em forma fixa, sem produto vazio nem prova vazia", () => {
    expect(normalizarBriefing({ produtos: [{ nome: "" }, { nome: "Kit", por_que: "vende" }], provas: ["", "4,9"] })).toEqual({
      produtos: [{ nome: "Kit", por_que: "vende" }],
      oferta: "",
      mensagem_central: "",
      publico: "",
      provas: ["4,9"],
      tom: "",
      cta: "",
    });
    expect(normalizarBriefing(null).produtos).toEqual([]);
  });

  it("o plano fica velho quando mudam as imagens (ou o papel) ou os conteúdos", () => {
    const p = normalizarPlanoDeImagens(plano);
    expect(planoDesatualizado(p, imagens, proposta.itens as any)).toBe(false);
    expect(planoDesatualizado(p, [imagens[0]], proposta.itens as any)).toBe(true);
    expect(planoDesatualizado(p, [{ ...imagens[0], papel: "apoio" }, imagens[1]], proposta.itens as any)).toBe(true);
    expect(planoDesatualizado(p, imagens, [{ ...proposta.itens[0], cards: [{ ordem: 1 }] }] as any)).toBe(true);
    // Sem conteúdos lidos ainda, não acusa.
    expect(planoDesatualizado(p, imagens, null)).toBe(false);
  });

  it("corpos: campanha_salvar manda só o que mudou; campanha_criar leva briefing preenchido e imagens", () => {
    expect(corpoDoSalvarCampanha({ campanhaId: "c", imagens })).toEqual({ acao: "campanha_salvar", campanha_id: "c", imagens });
    expect(corpoDoSalvarCampanha({ campanhaId: "c" })).toEqual({ acao: "campanha_salvar", campanha_id: "c" });
    const vazio = normalizarBriefing({});
    expect(corpoDaCampanha({ clientId: CLIENTE, pedido: "x", briefing: vazio, imagens: [] })).toEqual({ acao: "campanha_criar", client_id: CLIENTE, pedido: "x" });
    const cheio = corpoDaCampanha({ clientId: CLIENTE, pedido: "x", briefing: { ...vazio, oferta: "20%" }, imagens });
    expect(cheio.briefing).toEqual({ ...vazio, oferta: "20%" });
    expect(cheio.imagens).toEqual(imagens);
  });
});

describe("campanha nova", () => {
  it("escolher imagens no acervo (a primeira vira produto herói) e o briefing vão no campanha_criar", { timeout: 20_000 }, async () => {
    const criada = vi.fn();
    montar(h(CampanhaNova, { onCriada: criada }));
    fireEvent.change(screen.getByLabelText("Pedido da campanha"), { target: { value: "Promoção do amor" } });

    fireEvent.click(screen.getByRole("button", { name: /Escolher no acervo/ }));
    const busca = await screen.findByPlaceholderText("Buscar por nome, pasta, descrição ou tag");
    fireEvent.change(busca, { target: { value: "jpg" } });
    fireEvent.click(await screen.findByTitle("Kit para casal"));
    fireEvent.click(screen.getByTitle("Fachada da loja"));

    const lista = await screen.findByRole("list", { name: "Imagens da campanha" });
    const papeis = within(lista).getAllByRole("group", { name: "Papel da imagem" });
    expect(within(papeis[0]).getByRole("button", { name: "Produto herói" })).toHaveAttribute("aria-pressed", "true");
    expect(within(papeis[1]).getByRole("button", { name: "Apoio" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(papeis[1]).getByRole("button", { name: "Ambiente" }));
    const nota = within(lista).getByLabelText("Por que usar kit-casal.jpg");
    fireEvent.change(nota, { target: { value: "Mostra o kit inteiro" } });
    fireEvent.blur(nota);

    fireEvent.click(screen.getByRole("button", { name: /Mais opções/ }));
    fireEvent.change(screen.getByLabelText("Produto 1"), { target: { value: "Kit casal" } });
    fireEvent.change(screen.getByLabelText("Oferta"), { target: { value: "20% nos kits" } });

    fireEvent.click(screen.getByRole("button", { name: /Criar campanha/ }));
    await waitFor(() => expect(chamadasDe("campanha_criar").length).toBe(1));
    const corpo = chamadasDe("campanha_criar")[0];
    expect(corpo.imagens).toEqual([
      { imagem_id: FOTO_KIT, papel: "heroi", nota: "Mostra o kit inteiro" },
      { imagem_id: FOTO_LOJA, papel: "ambiente", nota: "" },
    ]);
    expect(corpo.briefing).toMatchObject({ produtos: [{ nome: "Kit casal", por_que: "" }], oferta: "20% nos kits" });
    await waitFor(() => expect(criada).toHaveBeenCalled());
  });

  it("referência da internet (nao_publicar) não entra na campanha", async () => {
    montar(h(CampanhaNova, { onCriada: vi.fn() }));
    fireEvent.click(screen.getByRole("button", { name: /Escolher no acervo/ }));
    fireEvent.change(await screen.findByPlaceholderText("Buscar por nome, pasta, descrição ou tag"), { target: { value: "internet" } });
    fireEvent.click(await screen.findByTitle("Ref. internet: kit"));
    expect(screen.queryByRole("list", { name: "Imagens da campanha" })).toBeNull();
  });
});

describe("campanha aberta", () => {
  it("mostra briefing, imagens e o plano com o porquê de cada lâmina, a escolha do Jev e o aviso", async () => {
    mock.tabelas.calendario_propostas = [proposta];
    montar(h(CampanhaDetalhe, { campanha }));
    for (const secao of ["Briefing", "Imagens da campanha", "Plano de imagens"]) {
      expect(screen.getByRole("button", { name: new RegExp(secao) })).toHaveAttribute("aria-expanded", "true");
    }
    expect(screen.getByText("20% nos kits até 20/10")).toBeTruthy();
    expect(screen.getByText("Presente que fala por você")).toBeTruthy();
    expect(await screen.findByText("A capa precisa do produto herói inteiro.")).toBeTruthy();
    expect(screen.getByText(/Escolha do Jev \(82%\) entre 2 candidatas/)).toBeTruthy();
    expect(screen.getByText(/nenhuma das fotos serve bem/)).toBeTruthy();
    expect(screen.getByText("Kit em uso por um casal real")).toBeTruthy();
    expect(screen.queryByText(/mudaram depois deste plano/)).toBeNull();
  });

  it("trocar o papel de uma imagem salva a lista inteira pela campanha_salvar (sem custo)", async () => {
    mock.tabelas.calendario_propostas = [proposta];
    montar(h(CampanhaDetalhe, { campanha }));
    const lista = await screen.findByRole("list", { name: "Imagens da campanha" });
    const papeis = within(lista).getAllByRole("group", { name: "Papel da imagem" });
    fireEvent.click(within(papeis[1]).getByRole("button", { name: "Apoio" }));
    await waitFor(() => expect(chamadasDe("campanha_salvar").length).toBe(1));
    expect(chamadasDe("campanha_salvar")[0]).toEqual({
      acao: "campanha_salvar",
      campanha_id: campanha.id,
      imagens: [imagens[0], { ...imagens[1], papel: "apoio" }],
    });
  });

  it("editar o briefing salva pela campanha_salvar", async () => {
    mock.tabelas.calendario_propostas = [proposta];
    montar(h(CampanhaDetalhe, { campanha }));
    fireEvent.click(screen.getByRole("button", { name: /Editar briefing/ }));
    fireEvent.change(screen.getByLabelText("Oferta"), { target: { value: "25% nos kits" } });
    fireEvent.click(screen.getByRole("button", { name: /Salvar briefing/ }));
    await waitFor(() => expect(chamadasDe("campanha_salvar").length).toBe(1));
    const corpo = chamadasDe("campanha_salvar")[0];
    expect(corpo.imagens).toBeUndefined();
    expect(corpo.briefing).toMatchObject({ oferta: "25% nos kits", produtos: [{ nome: "Kit casal", por_que: "Mais vendido em outubro" }] });
  });

  it("Refazer o plano chama campanha_plano_imagens com o id da campanha", async () => {
    mock.tabelas.calendario_propostas = [proposta];
    montar(h(CampanhaDetalhe, { campanha }));
    await screen.findByText("A capa precisa do produto herói inteiro.");
    fireEvent.click(screen.getByRole("button", { name: /Refazer o plano/ }));
    await waitFor(() => expect(chamadasDe("campanha_plano_imagens").length).toBe(1));
    expect(chamadasDe("campanha_plano_imagens")[0]).toEqual({ acao: "campanha_plano_imagens", campanha_id: campanha.id });
  });

  it("plano feito sobre outras imagens avisa que ficou velho", async () => {
    mock.tabelas.calendario_propostas = [proposta];
    montar(h(CampanhaDetalhe, { campanha: { ...campanha, imagens: [imagens[0]] } }));
    expect(await screen.findByText(/mudaram depois deste plano/)).toBeTruthy();
  });
});
