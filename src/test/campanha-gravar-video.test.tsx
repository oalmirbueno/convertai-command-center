import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Campanhas, vídeo para GRAVAR (22/10/2026): a peça de vídeo da campanha gera o roteiro pelo motor de
 * roteiros (mesa-roteiros, gerar) com a campanha, mostra o roteiro para ler e baixa o documento em PDF ou
 * Word. Reabrir acha o roteiro já feito sem gerar de novo. Banco e função simulados.
 * No fim, o contrato do servidor: o contexto da campanha (briefing, fase e o que a peça já tem na série).
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  tabelas: {} as Record<string, unknown>,
  montarPdf: vi.fn(),
  baixarBytes: vi.fn(),
  docx: vi.fn(),
  baixarDoc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "overlaps", "gte", "lt", "lte", "gt", "order", "limit", "range"]) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve({ data: Array.isArray(dados) ? dados[0] || null : dados, error: null });
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null }).then(ok, erro);
    return b;
  };
  return { supabase: { functions: { invoke: mock.invoke }, rpc: vi.fn(), from: (t: string) => consulta(t) } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));
vi.mock("@/components/mesa-roteiros/pdfNoNavegador", () => ({
  itemSolto: (r: unknown) => ({ roteiro: r, versao: 1, hash: "h", status: "rascunho" }),
  itemDoPdf: (l: any) => ({ roteiro: l.versoes[0].conteudo, versao: l.versao_atual, hash: "h", status: l.status }),
  montarPdf: (...a: unknown[]) => {
    mock.montarPdf(...a);
    return { bytes: new Uint8Array([37, 80, 68, 70]), nome: "roteiros-cliente-teste.pdf" };
  },
  baixarBytes: (...a: unknown[]) => mock.baixarBytes(...a),
}));
vi.mock("@/lib/laboratorio/exportar", () => ({
  docxDoProjeto: (...a: unknown[]) => {
    mock.docx(...a);
    return Promise.resolve(new Blob(["docx"]));
  },
  baixarDocumentoDoLab: (...a: unknown[]) => mock.baixarDoc(...a),
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import GravarVideoDaCampanha, { corpoDoRoteiroDaPeca, roteiroDaPecaDaCampanha, textoDoRoteiro } from "@/components/mesa/GravarVideoDaCampanha";
import type { Campanha, ItemProposto } from "@/components/mesa/mesaV4Api";
import { normalizarLinhaDoRoteiro, normalizarRoteiro } from "../../supabase/functions/_shared/roteiro-modelo";
import { campanhaParaORoteiro, faseDaPecaNaLinha, itemDaPecaNaSerie } from "../../supabase/functions/mesa-roteiros/modulos/campanha-da-peca";
import { calcularLinhaDoTempo } from "../../supabase/functions/agente-calendario/modulos/linha-do-tempo";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const CAMPANHA = "22222222-2222-4222-8222-222222222222";
const PROPOSTA = "33333333-3333-4333-8333-333333333333";
const ROTEIRO = "44444444-4444-4444-8444-444444444444";
const MODELO = "openai/gpt-teste";

const campanha = {
  id: CAMPANHA,
  client_id: CLIENTE,
  nome: "Black Friday da loja",
  pedido: "Black Friday com desconto",
  objetivo: "Vender o kit de inverno",
  periodo_inicio: "2026-11-01",
  periodo_fim: "2026-11-28",
  conceito: null,
  identidade: null,
  referencias_ids: null,
  selo_path: null,
  proposta_id: PROPOSTA,
  status: "ativa",
  custo_usd: 0,
  criado_em: "2026-10-20T10:00:00Z",
  briefing: { oferta: "Kit inverno com 30% de desconto", publico: "Mães de Curitiba", tom: "Próximo e direto" },
} as unknown as Campanha;

const item = {
  tema_id: "t-video-1",
  tema: "Bastidor do kit de inverno",
  data: "2026-11-10",
  formato: "video",
  etapa: "sustentacao",
  gancho: "Você sabe o que vem no kit?",
  cta: "Chama no direct",
  task_id: null,
  roteiro_video: {
    gancho: "Abri o kit na sua frente",
    cenas: [
      { descricao: "Mão abrindo a caixa", fala: "Olha o que vem aqui", texto_na_tela: "Kit inverno", segundos: 5 },
      { descricao: "Peças na mesa", fala: "Três peças por um preço", texto_na_tela: "30% off", segundos: 6 },
    ],
    trilha: "",
    cta: "Chama no direct",
  },
} as unknown as ItemProposto;

const CONTEUDO = {
  titulo: "Bastidor do kit de inverno",
  subtitulo: "O que vem no kit",
  tipo: "fala_camera",
  duracao_alvo_s: 30,
  ganchos: [
    { texto: "Abri o kit de inverno na sua frente", mecanismo: "demonstração", promessa: "mostrar o kit", motivo: "" },
    { texto: "Três peças, um preço", mecanismo: "resultado primeiro", promessa: "", motivo: "" },
  ],
  gancho_escolhido: 0,
  blocos: [
    { id: "b1", funcao: "Abertura", fala: "Olha o que vem no kit de inverno", segundos: 5, visual: "Caixa na mesa", texto_na_tela: "Kit inverno", broll: "Close da etiqueta" },
    { id: "b2", funcao: "Prova", fala: "São três peças por um preço só", segundos: 8, visual: "Peças abertas", texto_na_tela: "30% off", broll: "" },
  ],
  direcao: { enquadramento: "Peito para cima", ambiente: "Loja", figurino: "Casaco do kit", objetos: "Caixa", luz: "Janela", camera: "Celular na vertical", orientacoes: ["Olhar na lente"] },
  broll: ["Cliente experimentando"],
  cta: "Chama no direct",
  legenda: "O kit de inverno chegou",
  hashtags: ["#inverno", "#curitiba"],
  pendencias: ["Confirmar o preço final"],
};

const linhaGravada = () => ({
  id: ROTEIRO,
  client_id: CLIENTE,
  task_id: null,
  proposta_id: PROPOSTA,
  campanha_id: CAMPANHA,
  titulo: "Bastidor do kit de inverno",
  tipo: "fala_camera",
  status: "rascunho",
  versao_atual: 1,
  versao_aprovada: null,
  versoes: [{ numero: 1, origem: "ia", conteudo: CONTEUDO, criado_em: "2026-10-22T10:00:00Z", custo_usd: 0.05 }],
  comentarios: [],
  custo_usd: 0.05,
  criado_em: "2026-10-22T10:00:00Z",
  atualizado_em: "2026-10-22T10:00:00Z",
});

let respostas: Record<string, unknown> = {};
const chamadasDe = (acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[0] === "mesa-roteiros" && c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);

beforeEach(() => {
  vi.clearAllMocks();
  mock.tabelas = {};
  respostas = { estimar: { estimativa_usd: 0.05, modelo_id: MODELO, custo_usd: 0 } };
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
  mock.invoke.mockImplementation(async (_nome: string, opcoes: any) => {
    const acao = opcoes && opcoes.body ? opcoes.body.acao : "";
    // O servidor guarda o roteiro gerado: a releitura da lista já o traz.
    if (acao === "peca_gerar" && respostas.peca_gerar) mock.tabelas.roteiros = [linhaGravada()];
    if (respostas[acao] !== undefined) return { data: respostas[acao], error: null };
    return { data: { ok: true, custo_usd: 0 }, error: null };
  });
});

function montar(aoAtualizar = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const mesa = {
    clientId: CLIENTE, clientName: "Cliente Teste", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 50,
    catalogo: [{ id: MODELO, nome: "Modelo de teste", tipo: "texto", provedor: "openai", ativo: true, preco_entrada_1m: 1, preco_saida_1m: 4, padrao_para: ["estrategista"] }],
    catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(),
  } as unknown as MesaValor;
  render(
    h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(TooltipProvider, null, h(MesaProvider, { valor: mesa, children: h(GravarVideoDaCampanha, { clientId: CLIENTE, campanha, propostaId: PROPOSTA, item, aoAtualizar }) })))),
  );
  return { qc, aoAtualizar };
}

describe("vídeo da campanha para gravar (tela)", () => {
  // 23/10 (frente B): o Gravar pede 2 versões ao motor (peca_gerar) e o Jev escolhe; o custo inclui as 3 conferências.
  it("gera pelo motor de roteiros com a campanha, o tipo escolhido e o custo do estimar antes", async () => {
    respostas.peca_gerar = { roteiro: linhaGravada(), versao: { numero: 1 }, custo_usd: 0.05, saldo_usd: 10 };
    const { aoAtualizar } = montar();
    await waitFor(() => expect(chamadasDe("estimar")).toHaveLength(1));
    expect(chamadasDe("estimar")[0]).toEqual(expect.objectContaining({ client_id: CLIENTE, acao_alvo: "peca" }));
    fireEvent.click(screen.getByRole("tab", { name: "UGC" }));
    const gerar = await screen.findByRole("button", { name: /Gerar roteiro/ });
    // O preço do motor aparece antes (estimativa das 2 versões mais as conferências do Jev).
    await waitFor(() => expect(gerar.textContent).toMatch(/US\$ 0,0515/));
    await waitFor(() => expect(gerar).not.toBeDisabled());
    fireEvent.click(gerar);
    await waitFor(() => expect(chamadasDe("peca_gerar")).toHaveLength(1));
    const corpo = chamadasDe("peca_gerar")[0];
    expect(corpo).toEqual(expect.objectContaining({ client_id: CLIENTE, campanha_id: CAMPANHA, tema_id: "t-video-1", tema: "Bastidor do kit de inverno", tipo: "ugc", duracao_s: 11, modelo_id: MODELO }));
    expect(corpo.pedido).toMatch(/Black Friday da loja/);
    expect(corpo.pedido).toMatch(/Fase da linha do tempo/);
    expect(corpo.pedido).toMatch(/Mão abrindo a caixa \| fala: Olha o que vem aqui/);
    expect(corpo.pedido).toMatch(/CTA: Chama no direct/);
    // O roteiro aparece para ler.
    expect(await screen.findByText("Olha o que vem no kit de inverno")).toBeTruthy();
    expect(screen.getByText("Abri o kit de inverno na sua frente")).toBeTruthy();
    expect(screen.getByText("Peito para cima")).toBeTruthy();
    expect(screen.getByText("#inverno #curitiba")).toBeTruthy();
    expect(screen.getByText("Confirmar o preço final")).toBeTruthy();
    expect(aoAtualizar).toHaveBeenCalledWith(expect.objectContaining({ id: ROTEIRO }));
    const abrir = screen.getByRole("link", { name: /no Roteiros/ });
    expect(abrir.getAttribute("href")).toBe(`/mesa-roteiros?client=${CLIENTE}&etapa=roteiro&roteiro=${ROTEIRO}`);
  });

  it("reabre o roteiro já feito sem gerar de novo e baixa em PDF e Word", async () => {
    mock.tabelas.roteiros = [linhaGravada()];
    montar();
    expect(await screen.findByText("Olha o que vem no kit de inverno")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Gerar roteiro/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /em PDF/ }));
    await waitFor(() => expect(mock.baixarBytes).toHaveBeenCalledTimes(1));
    expect(mock.montarPdf).toHaveBeenCalledWith("Cliente Teste", [expect.objectContaining({ versao: 1 })]);
    expect(mock.baixarBytes).toHaveBeenCalledWith(expect.any(Uint8Array), "roteiros-cliente-teste.pdf");
    fireEvent.click(screen.getByRole("button", { name: /em Word/ }));
    await waitFor(() => expect(mock.baixarDoc).toHaveBeenCalledTimes(1));
    const doc = mock.docx.mock.calls[0][0];
    expect(doc.markdown).toMatch(/^# Bastidor do kit de inverno/);
    expect(doc.markdown).toMatch(/## Ganchos/);
    expect(doc.markdown).toMatch(/Fala: São três peças por um preço só/);
    expect(mock.baixarDoc).toHaveBeenCalledWith(expect.any(Blob), "roteiro-bastidor-do-kit-de-inverno.docx");
    expect(chamadasDe("peca_gerar")).toHaveLength(0);
  });

  it("acha o roteiro da peça: pela tarefa da agenda e, fora dela, pela campanha e o tema; arquivado não conta", () => {
    const base = normalizarLinhaDoRoteiro(linhaGravada())!;
    const daTarefa = { ...base, id: "outro", task_id: "tarefa-1", campanha_id: null, titulo: "Título da agenda" };
    const arquivado = { ...base, id: "velho", arquivado_em: "2026-10-01T00:00:00Z" };
    expect(roteiroDaPecaDaCampanha([arquivado, base], { campanhaId: CAMPANHA, item })!.id).toBe(ROTEIRO);
    expect(roteiroDaPecaDaCampanha([base, daTarefa], { campanhaId: CAMPANHA, item: { ...item, task_id: "tarefa-1" } })!.id).toBe("outro");
    expect(roteiroDaPecaDaCampanha([{ ...base, campanha_id: null }], { campanhaId: CAMPANHA, propostaId: PROPOSTA, item })!.id).toBe(ROTEIRO);
    expect(roteiroDaPecaDaCampanha([{ ...base, campanha_id: "x", proposta_id: null }], { campanhaId: CAMPANHA, item })).toBeNull();
    expect(roteiroDaPecaDaCampanha([arquivado], { campanhaId: CAMPANHA, item })).toBeNull();
  });

  it("sem roteiro da série, a duração é 30 s e a peça da agenda leva a tarefa", () => {
    const c = corpoDoRoteiroDaPeca({ clientId: CLIENTE, campanha, item: { ...item, roteiro_video: undefined, task_id: "tarefa-9" } as ItemProposto, tipo: "fala_camera" });
    expect(c).toEqual(expect.objectContaining({ duracao_s: 30, task_id: "tarefa-9", campanha_id: CAMPANHA, tipo: "fala_camera" }));
    expect(textoDoRoteiro(normalizarRoteiro(CONTEUDO))).toMatch(/## Confirmar antes de gravar\n- Confirmar o preço final/);
  });
});

describe("contrato do servidor: a campanha no contexto do roteiro", () => {
  const linha = calcularLinhaDoTempo({ esquema: "promocional", evento: "2026-11-28", inicio: "2026-11-01", fim: "2026-11-28", hoje: "2026-11-01" });

  it("lê briefing, fase da linha do tempo e o que a peça já tem na série", () => {
    const camp = { id: CAMPANHA, nome: "Black Friday", objetivo: "Vender", conceito: "Inverno quente", pedido: "BF", periodo_inicio: "2026-11-01", periodo_fim: "2026-11-28", briefing: { oferta: "30% no kit", publico: "Mães", tom_da_campanha: "Direto", produtos: [{ nome: "Kit", preco: "R$ 99" }], provas: ["200 vendidos"], linha_do_tempo: linha } };
    const dado = campanhaParaORoteiro(camp, item as unknown as Record<string, unknown>);
    expect(dado.nome).toBe("Black Friday");
    expect(dado.periodo).toEqual(["2026-11-01", "2026-11-28"]);
    expect(dado.briefing).toEqual(expect.objectContaining({ oferta: "30% no kit", publico: "Mães", tom: "Direto", provas: ["200 vendidos"] }));
    expect(dado.briefing!.produtos![0]).toEqual(expect.objectContaining({ nome: "Kit", preco: "R$ 99" }));
    const esperada = linha.fases.filter((f) => "2026-11-10" >= f.inicio && "2026-11-10" <= f.fim)[0];
    expect(dado.fase_da_peca).toEqual(expect.objectContaining({ nome: esperada.nome, inicio: esperada.inicio, fim: esperada.fim }));
    expect(dado.peca_na_serie).toEqual(expect.objectContaining({ tema: "Bastidor do kit de inverno", gancho: "Você sabe o que vem no kit?" }));
    expect(dado.peca_na_serie!.roteiro_video!.cenas).toHaveLength(2);
    // Sem briefing nem peça: os campos de sempre e nada inventado.
    const vazio = campanhaParaORoteiro({ nome: "X", briefing: {} }, null);
    expect(vazio.briefing).toBeNull();
    expect(vazio.fase_da_peca).toBeNull();
    expect(vazio.peca_na_serie).toBeNull();
  });

  it("acha a peça na série pela tarefa e, sem ela, pelo tema_id; fase pela etapa quando não há linha", () => {
    const itens = [{ tema_id: "a", task_id: "t1" }, { tema_id: "b", task_id: null }];
    expect(itemDaPecaNaSerie(itens, { taskId: "t1", temaId: "b" })!.tema_id).toBe("a");
    expect(itemDaPecaNaSerie(itens, { taskId: "t-fora", temaId: "b" })!.tema_id).toBe("b");
    expect(itemDaPecaNaSerie(itens, { temaId: "z" })).toBeNull();
    expect(itemDaPecaNaSerie(null, { temaId: "a" })).toBeNull();
    expect(faseDaPecaNaLinha(null, { etapa: "urgência" })).toEqual(expect.objectContaining({ nome: "urgência" }));
    expect(faseDaPecaNaLinha(linha, { etapa: "encerramento", data: "2027-01-01" })!.etapa).toBe(linha.fases.filter((f) => f.fase === "encerramento")[0].etapa);
  });

  it("index.ts: lê briefing e série da campanha, aceita tema_id e liga o roteiro à série", () => {
    const fonte = readFileSync(resolve(process.cwd(), "supabase/functions/mesa-roteiros/index.ts"), "utf8");
    expect(fonte).toContain('select("id, nome, objetivo, conceito, pedido, periodo_inicio, periodo_fim, status, briefing, proposta_id")');
    expect(fonte).toContain("campanha: campanha ? campanhaParaORoteiro(campanha, pecaDaCampanha) : null,");
    expect(fonte).toContain("temaId: limpo(corpo.tema_id, 80) || null,");
    expect(fonte).toContain("propostaId: proposta ? proposta.id : propostaDaCampanha,");
    expect(fonte).toContain("contextoDaPeca(p.clientId, peca, { campanhaId: p.campanhaId, temaId: p.temaId,");
  });
});
