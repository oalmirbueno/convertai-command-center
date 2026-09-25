import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mesa, versão 4 (23/09), a tela: agente do mês (pedido livre com anexos),
 * hypes da semana e campanhas. Cada ação chama a ação certa da função
 * agente-calendario (docs/mesa-do-cliente/CONTRATOS-V4.md).
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  upload: vi.fn(),
  tabelas: {} as Record<string, unknown>,
  updates: [] as { tabela: string; valor: unknown }[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range"]) b[m] = () => b;
    b.update = (valor: unknown) => {
      mock.updates.push({ tabela, valor });
      return b;
    };
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
import AgenteDoMes from "@/components/mesa/AgenteDoMes";
import HypesDaSemana from "@/components/mesa/HypesDaSemana";
import CampanhaNova from "@/components/mesa/CampanhaNova";
import CampanhaDetalhe from "@/components/mesa/CampanhaDetalhe";
import AbaCampanhas from "@/components/mesa/AbaCampanhas";
import {
  corpoDaCampanha,
  corpoDoPedidoLivre,
  extensaoDoAnexo,
  hojeIso,
  mensagemDoHype,
  segundaDaSemanaIso,
  type Campanha,
} from "@/components/mesa/mesaV4Api";
import type { ModeloIa } from "@/lib/mesa/api";

const CLIENTE = "11111111-1111-1111-1111-111111111111";

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

const proposta = {
  id: "22222222-2222-2222-2222-222222222222",
  client_id: CLIENTE,
  project_id: "33333333-3333-3333-3333-333333333333",
  periodo_inicio: "2026-10-01",
  periodo_fim: "2026-10-20",
  parametros: { origem: "campanha" },
  status: "pronta",
  diagnostico: null,
  itens: [{ tema_id: "c1", data: "2026-10-02", formato: "carrossel", tema: "Teaser do amor", gancho: "Quem ama presenteia", cards: [{ ordem: 1, texto: "Capa" }] }],
  conversa_id: null,
  task_ids: [],
  gravada_em: null,
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
};

beforeEach(() => {
  vi.clearAllMocks();
  mock.tabelas = {};
  mock.updates = [];
  mock.upload.mockResolvedValue({ data: {}, error: null });
  mock.invoke.mockImplementation(async (_funcao: string, { body }: any) => {
    if (body.acao === "pedido_livre") return { data: { proposta: { ...proposta, id: "p-novo", status: "pronta" }, resposta: "Preparei 1 conteúdo.", project_id: "proj", custo_usd: 0.02 }, error: null };
    if (body.acao === "campanha_criar") return { data: { campanha, proposta, resposta: "ok", project_id: "proj", custo_usd: 0.1 }, error: null };
    if (body.acao === "campanha_selo") return { data: { campanha: { ...campanha, selo_path: `${CLIENTE}/campanhas/x/selo.png` }, selo_path: "x", custo_usd: 0.04 }, error: null };
    if (body.acao === "gravar") return { data: { proposta: { ...proposta, status: "gravada" }, itens: [{ task_id: "t1" }] }, error: null };
    if (body.acao === "buscar_hypes") return { data: { hypes: { client_id: CLIENTE, semana: segundaDaSemanaIso(hojeIso()), itens: [], resumo: null, criado_em: "2026-09-23T12:00:00Z" }, cache: false, custo_usd: 0.1 }, error: null };
    return { data: {}, error: null };
  });
});

describe("agente do mês", () => {
  it("enviar o pedido com um print sobe a imagem em pedidos/ e chama pedido_livre com o caminho", async () => {
    // Criar conteúdos (pedido livre); o padrão do agente agora é Planejar o mês.
    montar(h(AgenteDoMes, { modoInicial: "criar" }));
    const entrada = screen.getByTestId("entrada-de-anexos") as HTMLInputElement;
    const arquivo = new File(["x"], "print.png", { type: "image/png" });
    fireEvent.change(entrada, { target: { files: [arquivo] } });
    await waitFor(() => expect(mock.upload).toHaveBeenCalledTimes(1));
    const caminho = mock.upload.mock.calls[0][0] as string;
    expect(caminho.indexOf(`${CLIENTE}/pedidos/`)).toBe(0);
    expect(caminho.slice(-4)).toBe(".png");

    fireEvent.change(screen.getByLabelText("Pedido ao agente do mês"), { target: { value: "Arte de depoimentos com estes prints" } });
    const enviar = screen.getByRole("button", { name: /Enviar/ });
    await waitFor(() => expect(enviar).not.toBeDisabled());
    fireEvent.click(enviar);
    await waitFor(() => expect(chamadasDe("pedido_livre").length).toBe(1));
    expect(chamadasDe("pedido_livre")[0]).toEqual({
      acao: "pedido_livre",
      client_id: CLIENTE,
      mensagem: "Arte de depoimentos com estes prints",
      anexos: [caminho],
    });
  });

  it("os atalhos só preenchem o campo, sem gastar", () => {
    montar(h(AgenteDoMes, { modoInicial: "criar" }));
    fireEvent.click(screen.getByRole("button", { name: "Prepare a agenda de hoje" }));
    expect((screen.getByLabelText("Pedido ao agente do mês") as HTMLTextAreaElement).value).toBe("Prepare a agenda de hoje.");
    expect(mock.invoke).not.toHaveBeenCalled();
  });

  it("anexo só JPG, PNG ou WEBP e o corpo leva no máximo 6 caminhos", () => {
    expect(extensaoDoAnexo({ type: "image/png", name: "a.png" })).toBe("png");
    expect(extensaoDoAnexo({ type: "", name: "foto.JPEG" })).toBe("jpg");
    expect(extensaoDoAnexo({ type: "application/pdf", name: "a.pdf" })).toBeNull();
    expect(extensaoDoAnexo({ type: "", name: "x.constructor" })).toBeNull();
    const corpo = corpoDoPedidoLivre({ clientId: CLIENTE, mensagem: "oi", anexos: ["1", "2", "3", "4", "5", "6", "7"], campanhaId: "c" });
    expect((corpo.anexos as string[]).length).toBe(6);
    expect(corpo.campanha_id).toBe("c");
  });
});

describe("hypes da semana", () => {
  const hype = { titulo: "Dia das Crianças", o_que_e: "Data comemorativa", janela: "proximas_semanas", como_usar: "Kit presente", formato: "carrossel", cuidado: "", nota: 8.5, fonte: "https://exemplo.com/x" };

  it("a busca da semana aparece sem custo; Criar conteúdo chama pedido_livre com a mensagem do hype", async () => {
    mock.tabelas.mesa_hypes = [{ client_id: CLIENTE, semana: segundaDaSemanaIso(hojeIso()), itens: [hype], resumo: "Semana de datas", criado_em: new Date().toISOString() }];
    const inicio = vi.fn();
    const fim = vi.fn();
    montar(h(HypesDaSemana, { onCriarCampanha: vi.fn(), onPedidoInicio: inicio, onPedidoFim: fim }));
    await screen.findByText("Dia das Crianças");
    expect(screen.getByRole("button", { name: /Buscar de novo/ })).toBeTruthy();
    expect(chamadasDe("buscar_hypes").length).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: /Criar conteúdo/ }));
    await waitFor(() => expect(chamadasDe("pedido_livre").length).toBe(1));
    expect(chamadasDe("pedido_livre")[0]).toEqual({ acao: "pedido_livre", client_id: CLIENTE, mensagem: mensagemDoHype(hype) });
    expect(mensagemDoHype(hype)).toContain("Dia das Crianças");
    expect(inicio).toHaveBeenCalled();
    await waitFor(() => expect(fim).toHaveBeenCalled());
  });

  it("Buscar de novo força a busca; Criar campanha avisa o índice do hype", async () => {
    mock.tabelas.mesa_hypes = [{ client_id: CLIENTE, semana: segundaDaSemanaIso(hojeIso()), itens: [hype], resumo: null, criado_em: new Date().toISOString() }];
    const criarCampanha = vi.fn();
    montar(h(HypesDaSemana, { onCriarCampanha: criarCampanha }));
    await screen.findByText("Dia das Crianças");
    fireEvent.click(screen.getByRole("button", { name: /Criar campanha/ }));
    expect(criarCampanha).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByRole("button", { name: /Buscar de novo/ }));
    await waitFor(() => expect(chamadasDe("buscar_hypes").length).toBe(1));
    expect(chamadasDe("buscar_hypes")[0]).toEqual({ acao: "buscar_hypes", client_id: CLIENTE, forcar: true });
  });

  it("sem busca na semana, Buscar hypes não força", async () => {
    montar(h(HypesDaSemana, { onCriarCampanha: vi.fn() }));
    const botao = await screen.findByRole("button", { name: /Buscar hypes/ });
    fireEvent.click(botao);
    await waitFor(() => expect(chamadasDe("buscar_hypes").length).toBe(1));
    expect(chamadasDe("buscar_hypes")[0]).toEqual({ acao: "buscar_hypes", client_id: CLIENTE });
  });
});

describe("campanhas", () => {
  it("Criar campanha chama campanha_criar com o pedido e o período", async () => {
    const criada = vi.fn();
    montar(h(CampanhaNova, { onCriada: criada }));
    fireEvent.change(screen.getByLabelText("Pedido da campanha"), { target: { value: "Promoção do amor" } });
    fireEvent.click(screen.getByRole("button", { name: /Criar campanha/ }));
    await waitFor(() => expect(chamadasDe("campanha_criar").length).toBe(1));
    const corpo = chamadasDe("campanha_criar")[0];
    expect(corpo).toMatchObject({ acao: "campanha_criar", client_id: CLIENTE, pedido: "Promoção do amor", periodo_inicio: hojeIso() });
    expect(corpo.quantidade).toBeUndefined();
    await waitFor(() => expect(criada).toHaveBeenCalledWith(expect.objectContaining({ id: campanha.id }), "proj"));
  });

  it("o corpo da campanha limita anexos e referências e leva o hype", () => {
    const corpo = corpoDaCampanha({ clientId: CLIENTE, pedido: "x", quantidade: 5, referenciasIds: ["1", "2", "3", "4", "5", "6", "7", "8", "9"], hype: { titulo: "H" } });
    expect(corpo.quantidade).toBe(5);
    expect((corpo.referencias_ids as string[]).length).toBe(8);
    expect(corpo.hype).toEqual({ titulo: "H" });
  });

  it("Desenhar selo chama campanha_selo e Mandar para a agenda grava os conteúdos escolhidos com o projeto da proposta", async () => {
    mock.tabelas.calendario_propostas = [proposta];
    montar(h(CampanhaDetalhe, { campanha }));
    await screen.findByText("Teaser do amor");
    fireEvent.click(screen.getByRole("button", { name: /Desenhar selo/ }));
    await waitFor(() => expect(chamadasDe("campanha_selo").length).toBe(1));
    expect(chamadasDe("campanha_selo")[0]).toEqual({ acao: "campanha_selo", campanha_id: campanha.id });
    // 25/09: a equipe escolhe (todos os que faltam vêm marcados) e manda só os escolhidos.
    fireEvent.click(screen.getByRole("button", { name: /Mandar para a agenda \(1\)/ }));
    await waitFor(() => expect(chamadasDe("gravar").length).toBe(1));
    expect(chamadasDe("gravar")[0]).toEqual({ acao: "gravar", proposta_id: proposta.id, tema_ids: ["c1"], project_id: proposta.project_id });
  });

  it("a aba Campanhas lista as campanhas do cliente", async () => {
    mock.tabelas.mesa_campanhas = [campanha];
    montar(h(AbaCampanhas, {}));
    // Tela estreita (matchMedia falso nos testes): a lista vira seletor e as
    // recentes aparecem no estado vazio.
    const recentes = await screen.findByRole("list", { name: "Campanhas recentes" });
    expect(within(recentes).getByText("Promoção do amor")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Campanha aberta" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Nova campanha/ }).length).toBeGreaterThan(0);
  });

  it("a aba Campanhas existe na Mesa, entre Mês e Estúdio, e baixa sozinha", () => {
    const pagina = readFileSync(resolve(__dirname, "../pages/MesaDoCliente.tsx"), "utf8");
    expect(pagina).toContain('import("@/components/mesa/AbaCampanhas")');
    expect(pagina).not.toContain("import AbaCampanhas from");
    const mes = pagina.indexOf('{ valor: "mes", rotulo: "Mês" }');
    const campanhas = pagina.indexOf('{ valor: "campanhas", rotulo: "Campanhas" }');
    const estudio = pagina.indexOf('{ valor: "estudio", rotulo: "Estúdio" }');
    expect(mes).toBeGreaterThan(0);
    expect(campanhas).toBeGreaterThan(mes);
    expect(estudio).toBeGreaterThan(campanhas);
    expect(pagina).toContain('{aba === "campanhas" && (');
  });
});
