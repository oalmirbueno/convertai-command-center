import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente TR (27/09), tela: o modelo do agente sênior (padrão GPT-6 Luna no
 * raciocínio máximo, lembrado por cliente, mandado em toda mensagem), o
 * "Otimizar agora" de um clique, o plano mandado pelo Plano de teste que o
 * agente assume sozinho, o cartão com o que ele já fez (Voltar este) e a
 * campanha montada com o Confirmar para ativar, e a rotina ("O agente está
 * cuidando desta conta", Pausar a rotina, Interferir, O que foi feito com a
 * prova e o Desfazer). A função é simulada: nada sai para a Meta.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = () => {
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "order", "limit", "range", "gte", "update", "insert"]) b[m] = () => b;
    b.single = () => Promise.resolve({ data: null, error: null });
    b.maybeSingle = b.single;
    b.then = (ok: any, erro: any) => Promise.resolve({ data: [], error: null }).then(ok, erro);
    return b;
  };
  return { supabase: { functions: { invoke: mock.invoke }, rpc: vi.fn(), from: () => consulta(), storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: null, error: null }) }) } } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import type { ModeloIa } from "@/lib/mesa/api";
import AgenteSenior, { TEXTO_DE_OTIMIZAR } from "@/components/mesa-ads/AgenteSenior";
import AbaConta from "@/components/mesa-ads/AbaConta";
import RotinaDoAgente from "@/components/mesa-ads/RotinaDoAgente";
import EnviarAoAgenteSenior from "@/components/mesa-ads/EnviarAoAgenteSenior";
import { deixarPlanoParaOAgente, pegarPlanoParaOAgente } from "@/components/mesa-ads/ponteDoAgente";
import { modeloEfetivo, partesDoAgenteSenior } from "@/components/mesa-ads/agenteSeniorApi";
import { gravarEstadoDaTela } from "@/components/sistema/useEstadoDaTela";

const CLIENTE = "44444444-4444-4444-4444-444444444444";
const OUTRO = "55555555-5555-5555-5555-555555555555";
const NIVEIS = ["none", "low", "medium", "high", "xhigh", "max"];

const catalogo: ModeloIa[] = [
  { id: "openai:gpt-texto", provedor: "openai", modelo_api: "gpt-texto", tipo: "texto", rotulo: "Texto", preco_entrada_1m: 1, preco_saida_1m: 2, preco_cache_1m: null, preco_imagem: null, raciocinio: ["low", "medium"], padrao_para: ["estrategista"], ativo: true } as ModeloIa,
  { id: "openrouter:openai/gpt-6-luna", provedor: "openrouter", modelo_api: "openai/gpt-6-luna", tipo: "texto", rotulo: "GPT-6 Luna", preco_entrada_1m: 0.1, preco_saida_1m: 0.5, preco_cache_1m: null, preco_imagem: null, raciocinio: NIVEIS, padrao_para: ["leitura"], ativo: true } as ModeloIa,
  { id: "openrouter:openai/gpt-6-sol", provedor: "openrouter", modelo_api: "openai/gpt-6-sol", tipo: "texto", rotulo: "GPT-6 Sol", preco_entrada_1m: 2, preco_saida_1m: 10, preco_cache_1m: null, preco_imagem: null, raciocinio: NIVEIS, padrao_para: [], ativo: true } as ModeloIa,
];

const valor = (clientId = CLIENTE): MesaValor => ({
  clientId, clientName: "Cliente", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 50,
  catalogo, catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(),
});

function montar(filho: any, clientId = CLIENTE, rota: string | null = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const conteudo = h(QueryClientProvider, { client: qc }, h(TooltipProvider, null, h(MesaProvider, { valor: valor(clientId), children: filho })));
  return render(rota ? h(MemoryRouter, { initialEntries: [rota] }, conteudo) : conteudo);
}

const chamadas = (acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[0] === "mesa-ads" && c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);

function responder(mapa: Record<string, unknown>) {
  mock.invoke.mockImplementation(async (_f: string, { body }: any) =>
    Object.prototype.hasOwnProperty.call(mapa, body.acao) ? { data: typeof mapa[body.acao] === "function" ? (mapa[body.acao] as (b: any) => unknown)(body) : mapa[body.acao], error: null } : { data: { ok: true }, error: null },
  );
}

beforeEach(() => {
  mock.invoke.mockReset();
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

describe("modelo do agente sênior", () => {
  it("padrão GPT-6 Luna no raciocínio máximo, com o preço na linha e no Otimizar agora (um clique, modo agir)", async () => {
    responder({ conta_conversa_ler: { conversa_id: "conv-1", mensagens: [] }, conta_conversar: { conversa_id: "conv-1", custo_usd: 0.03 } });
    montar(h(AgenteSenior, {}));
    await screen.findByText(/Peça o que fazer com a conta/);
    const linha = screen.getByRole("button", { name: "Modelo do agente sênior" });
    expect(linha.textContent).toMatch(/GPT-6 Luna · raciocínio máximo · US\$ 0,10 \/ 0,50 por 1M · padrão/);
    fireEvent.click(screen.getByRole("button", { name: /Otimizar agora/ }));
    await waitFor(() => expect(chamadas("conta_conversar")).toHaveLength(1));
    expect(chamadas("conta_conversar")[0]).toMatchObject({ mensagem: TEXTO_DE_OTIMIZAR, modo: "agir", modelo_id: "openrouter:openai/gpt-6-luna", raciocinio: "max" });
  });

  it("a escolha fica lembrada por cliente e vale na mensagem; voltar ao padrão", async () => {
    gravarEstadoDaTela(`mesa-ads:agente-senior:modelo:${CLIENTE}`, { modelo: "openrouter:openai/gpt-6-sol", raciocinio: "high" });
    responder({ conta_conversa_ler: { conversa_id: "conv-1", mensagens: [] }, conta_conversar: { conversa_id: "conv-1" } });
    montar(h(AgenteSenior, {}));
    await screen.findByText(/Peça o que fazer com a conta/);
    expect(screen.getByRole("button", { name: "Modelo do agente sênior" }).textContent).toMatch(/GPT-6 Sol · raciocínio alto/);
    fireEvent.change(screen.getByLabelText("Mensagem ao agente sênior"), { target: { value: "O que pausar?" } });
    fireEvent.click(screen.getByRole("button", { name: /^Enviar/ }));
    await waitFor(() => expect(chamadas("conta_conversar")).toHaveLength(1));
    expect(chamadas("conta_conversar")[0]).toMatchObject({ mensagem: "O que pausar?", modelo_id: "openrouter:openai/gpt-6-sol", raciocinio: "high" });
    expect(chamadas("conta_conversar")[0].modo).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Modelo do agente sênior" }));
    fireEvent.click(screen.getByRole("button", { name: /Voltar ao padrão/ }));
    expect(screen.getByRole("button", { name: "Modelo do agente sênior" }).textContent).toMatch(/GPT-6 Luna · raciocínio máximo/);
  });

  it("outro cliente começa no padrão; modelo desligado no catálogo cai no padrão; a estimativa usa o raciocínio", () => {
    gravarEstadoDaTela(`mesa-ads:agente-senior:modelo:${CLIENTE}`, { modelo: "openrouter:openai/gpt-6-sol", raciocinio: "high" });
    expect(modeloEfetivo(catalogo, { modelo: "", raciocinio: "" })).toMatchObject({ modelo: { id: "openrouter:openai/gpt-6-luna" }, raciocinio: "max" });
    expect(modeloEfetivo(catalogo, { modelo: "openai:inexistente", raciocinio: "high" }).modelo!.id).toBe("openrouter:openai/gpt-6-luna");
    expect(modeloEfetivo([catalogo[0]], null)).toMatchObject({ modelo: { id: "openai:gpt-texto" }, raciocinio: "medium" });
    const semPensar = partesDoAgenteSenior(catalogo, false, { modelo: catalogo[1], raciocinio: "low" })[0];
    const noMaximo = partesDoAgenteSenior(catalogo, true, { modelo: catalogo[1], raciocinio: "max" })[0];
    expect(noMaximo.tokensSaida! - semPensar.tokensSaida!).toBe(32000 - 4000);
    expect(noMaximo.buscasWeb).toBe(5);
  });
});

describe("Enviar ao agente sênior (Plano de teste) e o agente assumindo", () => {
  function Endereco() {
    const l = useLocation();
    return h("p", { "data-endereco": "" }, l.search);
  }

  it("o botão do plano deixa o plano e abre a aba Conta; a ponte vale uma vez e por 10 minutos", async () => {
    responder({});
    montar(
      h(Routes, null, h(Route, { path: "/mesa-ads", element: h("div", null, h(EnviarAoAgenteSenior, { plano: { id: "p-1", nome: "Teste da espera" } }), h(Endereco)) })),
      CLIENTE,
      `/mesa-ads?client=${CLIENTE}&etapa=plano&plano=p-1`,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Enviar ao agente sênior/ }));
    await waitFor(() => expect((document.querySelector("[data-endereco]") as HTMLElement).textContent).toContain("etapa=conta"));
    expect((document.querySelector("[data-endereco]") as HTMLElement).textContent).toContain("plano=p-1");
    expect(chamadas("conta_conversar")).toHaveLength(0);
    const p = pegarPlanoParaOAgente(CLIENTE);
    expect(p).toMatchObject({ plano_id: "p-1", nome: "Teste da espera" });
    expect(pegarPlanoParaOAgente(CLIENTE)).toBeNull();
    deixarPlanoParaOAgente(OUTRO, "p-2", "Velho", Date.now() - 11 * 60_000);
    expect(pegarPlanoParaOAgente(OUTRO)).toBeNull();
  });

  it("a aba Conta pega o plano deixado (uma vez), abre o agente e ele assume; a rotina aparece no topo", async () => {
    deixarPlanoParaOAgente(CLIENTE, "p-7", "Plano do vídeo");
    responder({ conta_conversa_ler: { conversa_id: "conv-1", mensagens: [] }, conta_conversar: { conversa_id: "conv-1" }, rotina_ler: rotinaLigada });
    montar(h(AbaConta, {}));
    await waitFor(() => expect(chamadas("conta_conversar")).toHaveLength(1), { timeout: 8000 });
    expect(chamadas("conta_conversar")[0]).toMatchObject({ modo: "assumir_plano", plano_id: "p-7" });
    expect(await screen.findByText("O agente está cuidando desta conta")).toBeTruthy();
    expect(pegarPlanoParaOAgente(CLIENTE)).toBeNull();
  }, 20000);

  it("com o plano, o agente assume sozinho: modo assumir_plano, o plano e sem pesquisa, uma vez só", async () => {
    responder({ conta_conversa_ler: { conversa_id: "conv-1", mensagens: [] }, conta_conversar: { conversa_id: "conv-1" } });
    const onAssumido = vi.fn();
    montar(h(AgenteSenior, { assumir: { plano_id: "p-1", nome: "Teste da espera" }, onAssumido }));
    await waitFor(() => expect(chamadas("conta_conversar")).toHaveLength(1));
    expect(chamadas("conta_conversar")[0]).toMatchObject({ modo: "assumir_plano", plano_id: "p-1", pesquisar: false, mensagem: "", modelo_id: "openrouter:openai/gpt-6-luna" });
    await waitFor(() => expect(onAssumido).toHaveBeenCalledTimes(1));
    expect(chamadas("conta_conversar")).toHaveLength(1);
  });
});

const itemPausadoSozinho = {
  id: "i1", tipo: "pausar", na_meta: true, auto: true, alvo: { ref: "n1", nivel: "anuncio", meta_id: "140000000000001", nome: "Post antigo" }, criativo: null, texto: null, variacao_pct: null,
  motivo: "R$ 40 em 3 dias sem nenhuma conversa", de: { status: "ACTIVE", orcamento_diario_brl: null, nome: "Post antigo" }, para: { status: "PAUSED" }, limitado: false, indisponivel: null,
  resultado: { ok: true, feito_em: "2026-09-27T15:00:00Z", depois: { status: "PAUSED" } },
};
const itemMontado = {
  id: "i2", tipo: "montar_campanha_do_plano", na_meta: true, auto: true, alvo: null, criativo: null, texto: null, variacao_pct: null,
  motivo: "Você mandou o plano ao agente sênior.", de: null, para: null, limitado: false, indisponivel: null,
  montagem: { plano_id: "p-1", plano_nome: "Teste da espera", campanha_nome: "Teste da espera | Mesa Ads | 27/09", verba_diaria_brl: 40, objetivo: "mensagens", criativos: [{ id: "c1", nome: "Espera V1" }], modelo: { ad_id: "140000000000009", nome: "Chama no WhatsApp" }, faltas: [] },
  resultado: { ok: true, feito_em: "2026-09-27T15:00:00Z", criado: { campanha_id: "120000000000900", conjunto_id: "130000000000900", anuncio_ids: "160000000000901" } },
};
const itemAtivar = {
  id: "i3", tipo: "ativar", na_meta: true, alvo: { ref: "c2", nivel: "campanha", meta_id: "120000000000002", nome: "Engajamento" }, criativo: null, texto: null, variacao_pct: null,
  motivo: "Voltar a campanha que vendia", de: { status: "PAUSED", orcamento_diario_brl: null, nome: "Engajamento" }, para: { status: "ACTIVE" }, limitado: false, indisponivel: null,
};
const conversaComAcoes = (itens: unknown[]) => ({
  conversa_id: "conv-1",
  mensagens: [{
    id: "m9", papel: "agente", conteudo: "ok", criado_em: "2026-09-27T15:00:00Z",
    estrategia: { resposta: "Pausei o que queimava e montei a campanha do plano.", diagnostico: [], escalar: [], manter: [], cortar: [], reestruturacao: { objetivo: "mensagens", porque: "", evento_otimizacao: "", campanhas: [], verba_total_diaria_brl: null, passos: [] }, proximos_criativos: [], pesquisa: [], perguntas: [], plano_de_teste: null },
    numeros: null,
    acoes: { tipo: "acoes_conta", resumo: "Pausar o que queima e montar a campanha.", itens, ignorados: [], gestao: { disponivel: true, motivo: null }, caminho: { rotulo: "Ir para a campanha montada", destino: `/mesa-ads?client=${CLIENTE}&etapa=conta&campanha=120000000000900` } },
  }],
});

describe("cartão: o que ele já fez e a campanha montada", () => {
  it("\"Já fiz\" com o Voltar este (só o item), a montagem com o Confirmar para ativar e o caminho; o resto espera o Confirmar", async () => {
    responder({
      conta_conversa_ler: conversaComAcoes([itemPausadoSozinho, itemMontado, itemAtivar]),
      conta_acao_desfazer: { anexo: { tipo: "acoes_conta", resumo: "x", itens: [{ ...itemPausadoSozinho, resultado: { ...itemPausadoSozinho.resultado, desfeito: true } }, itemMontado, itemAtivar], ignorados: [], gestao: null }, voltaram: 1 },
      conta_montagem_ativar: { anexo: { tipo: "acoes_conta", resumo: "x", itens: [itemPausadoSozinho, { ...itemMontado, resultado: { ...itemMontado.resultado, ativada_em: "2026-09-27T15:05:00Z" } }, itemAtivar], ignorados: [], gestao: null } },
    });
    montar(h(AgenteSenior, {}));
    expect(await screen.findByText(/Já fiz 2 · o resto espera você/)).toBeTruthy();
    expect(screen.getAllByText("Já fiz")).toHaveLength(2);
    expect(screen.getByText(/Teste da espera \| Mesa Ads \| 27\/09 · R\$\s?40,00 por dia · 1 criativo/)).toBeTruthy();
    expect(screen.getByText(/Montada na Meta e pausada: 1 anúncio em análise/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Ir para a campanha montada/ })).toBeTruthy();
    // Ativar a campanha antiga continua esperando o Confirmar (aumenta gasto).
    expect(screen.getByRole("button", { name: /Confirmar 1/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Desfazer este item: Pausar Post antigo/ }));
    await waitFor(() => expect(chamadas("conta_acao_desfazer")).toEqual([{ acao: "conta_acao_desfazer", mensagem_id: "m9", itens: ["i1"] }]));
    fireEvent.click(await screen.findByRole("button", { name: /Ativar campanha \(R\$\s?40,00 por dia\)/ }));
    await waitFor(() => expect(chamadas("conta_montagem_ativar")).toEqual([{ acao: "conta_montagem_ativar", mensagem_id: "m9", item: "i2" }]));
    expect(await screen.findByText("Ativada")).toBeTruthy();
  });
});

const rotinaLigada = {
  disponivel: true,
  rotina: {
    ligada: true, teto_diario_brl: 80, subida_max_pct: 20, max_acoes_rodada: 3, max_acoes_dia: 6, limites: { custo_alvo_brl: 12 },
    regras: [{ id: "r1", texto: "não mexe no conjunto Raio 5 km até sexta", tipo: "nao_mexer", alvos: [{ nivel: "conjunto", meta_id: "130000000000005", nome: "Raio 5 km" }], ate: "2026-10-02", ativa: true, texto_da_regra: "Não mexer: conjunto Raio 5 km, até 02/10", vale: true }],
    estado: { rodada_em: "2026-09-27T15:00:00Z", olhando: "3 anúncios ativos em 1 campanha, últimos 7 dias, números de 11:40.", fez: ["Pausei o anúncio Post antigo."], planeja: ["Carrossel: O Jev preferiu observar: não mexi."], parou_por: null, bloqueio: null, sincronizado_em: "2026-09-27T14:40:00Z", proxima_rodada_em: "2026-09-27T16:00:00Z" },
    ultima_rodada_em: "2026-09-27T15:00:00Z", proxima_rodada_em: "2026-09-27T16:00:00Z", ligada_em: "2026-09-27T10:00:00Z", pausada_em: null,
  },
  acoes: [
    {
      id: "a1", origem: "rotina", tipo: "pausar", estado: "feita", alvo: { nivel: "anuncio", meta_id: "140000000000001", nome: "Post antigo" }, resumo: "Pausei o anúncio Post antigo.", porque: "Gastou R$ 40,00 em 3 dias sem nenhuma conversa.",
      prova: { numeros: { periodo: { inicio: "2026-09-21", fim: "2026-09-27", dias: 7 }, gasto: 40, impressoes: 5000, resultados: 0, resultado_rotulo: "Conversas iniciadas", custo_por_resultado: null, ctr_link_pct: 1.1, frequencia: 1.3 }, fonte: "Meta Ads, coletado pelo painel", sincronizado_em: "2026-09-27T14:40:00Z", regra: "x", limites: { custo_alvo_brl: 12, fonte_do_alvo: "dono" }, antes: { status: "ACTIVE" }, depois: { status: "PAUSED" }, jev: { escolha: "pausar", probabilidade: 0.85 }, caminho: { rotulo: "Ver a campanha", destino: `/mesa-ads?client=${CLIENTE}&etapa=conta&campanha=120000000000001` } },
      resultado_depois: null, criado_em: "2026-09-27T15:00:00Z", desfeita_em: null, pode_desfazer: true,
    },
    {
      id: "a2", origem: "rotina", tipo: "proposta", estado: "proposta", alvo: { nivel: "anuncio", meta_id: "140000000000003", nome: "Carrossel" }, resumo: "Criativo novo para Carrossel", porque: "Frequência 4,2 e CTR caindo.",
      prova: { pedido_ao_agente: "O anúncio Carrossel precisa de criativo novo. Monte o plano de teste." }, resultado_depois: null, criado_em: "2026-09-27T15:00:00Z", desfeita_em: null, pode_desfazer: false,
    },
  ],
};

describe("rotina: acompanhamento humano claro", () => {
  it("mostra o que olha, o que fez e o que pretende; Pausar a rotina; Interferir vira regra visível", async () => {
    responder({ rotina_ler: rotinaLigada, rotina_salvar: { ...rotinaLigada, rotina: { ...rotinaLigada.rotina, ligada: false, pausada_em: "2026-09-27T15:10:00Z" } }, rotina_regra: rotinaLigada });
    montar(h(RotinaDoAgente, {}));
    expect(await screen.findByText("O agente está cuidando desta conta")).toBeTruthy();
    expect(screen.getByText(/Olhando: 3 anúncios ativos em 1 campanha/)).toBeTruthy();
    expect(screen.getByText("Pausei o anúncio Post antigo.")).toBeTruthy();
    expect(screen.getByText(/O Jev preferiu observar/)).toBeTruthy();
    expect(screen.getByText("Não mexer: conjunto Raio 5 km, até 02/10")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Instrução para a rotina"), { target: { value: "segura a verba até sexta" } });
    fireEvent.click(screen.getByRole("button", { name: /Virar regra/ }));
    await waitFor(() => expect(chamadas("rotina_regra")).toEqual([{ acao: "rotina_regra", client_id: CLIENTE, texto: "segura a verba até sexta" }]));
    fireEvent.click(screen.getByRole("button", { name: /Pausar a rotina/ }));
    await waitFor(() => expect(chamadas("rotina_salvar")).toEqual([{ acao: "rotina_salvar", client_id: CLIENTE, ligada: false }]));
    expect(await screen.findByText("Rotina pausada")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Ligar a rotina/ })).toBeTruthy();
  });

  it("O que foi feito: a prova (números, fonte, antes e depois, Jev), o Desfazer e a proposta levada ao agente", async () => {
    responder({ rotina_ler: rotinaLigada, rotina_desfazer: { ...rotinaLigada, acoes: [{ ...rotinaLigada.acoes[0], estado: "desfeita", pode_desfazer: false }, rotinaLigada.acoes[1]] } });
    const onPedirAoAgente = vi.fn();
    montar(h(RotinaDoAgente, { onPedirAoAgente, abrirFeito: true }));
    const lista = await screen.findByRole("list", { name: "O que foi feito" });
    // A proposta também traz a prova (os números que motivaram); a primeira é a da pausa.
    fireEvent.click(within(lista).getAllByRole("button", { name: "Prova" })[0]);
    const prova = document.querySelector("[data-prova]") as HTMLElement;
    expect(prova.textContent).toMatch(/R\$\s?40,00 gastos · 0 conversas iniciadas/);
    expect(prova.textContent).toMatch(/Meta Ads, coletado pelo painel, coletado às/);
    expect(prova.textContent).toMatch(/ativo.*pausado/);
    expect(prova.textContent).toMatch(/pausar \(85%\)/);
    expect(prova.textContent).toMatch(/definido por você/);
    // Contrato comum: o caminho para a campanha na aba Conta.
    expect(within(lista).getByRole("button", { name: /Ver a campanha/ }).getAttribute("data-caminho-do-agente")).toBe(`/mesa-ads?client=${CLIENTE}&etapa=conta&campanha=120000000000001`);
    fireEvent.click(within(lista).getByRole("button", { name: "Montar com o agente sênior" }));
    expect(onPedirAoAgente).toHaveBeenCalledWith("O anúncio Carrossel precisa de criativo novo. Monte o plano de teste.");
    fireEvent.click(within(lista).getByRole("button", { name: /Desfazer: Pausei o anúncio Post antigo/ }));
    await waitFor(() => expect(chamadas("rotina_desfazer")).toEqual([{ acao: "rotina_desfazer", acao_id: "a1" }]));
    expect(await screen.findByText("Desfeito")).toBeTruthy();
  });

  it("desligada: convida a ligar (sem teto só pausa); conta travada mostra que não age; em preparação sem o SQL", async () => {
    responder({ rotina_ler: { disponivel: true, rotina: null, acoes: [] }, rotina_salvar: rotinaLigada });
    montar(h(RotinaDoAgente, {}));
    expect(await screen.findByText("Rotina de monitoramento")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Ligar a rotina/ }));
    await waitFor(() => expect(chamadas("rotina_salvar")).toEqual([{ acao: "rotina_salvar", client_id: CLIENTE, ligada: true }]));
  });

  it("conta travada e SQL pendente", async () => {
    responder({ rotina_ler: { ...rotinaLigada, rotina: { ...rotinaLigada.rotina, estado: { ...rotinaLigada.rotina.estado, bloqueio: "A conta de anúncios Aceleriq está com pagamento pendente na Meta (saldo em aberto)." } } } });
    const { unmount } = montar(h(RotinaDoAgente, {}));
    expect(await screen.findByText(/Não age agora: A conta de anúncios Aceleriq está com pagamento pendente/)).toBeTruthy();
    unmount();
    responder({ rotina_ler: { disponivel: false, motivo: "A rotina está em preparação: falta aplicar o SQL TR-01 no banco." } });
    montar(h(RotinaDoAgente, {}));
    expect(await screen.findByText(/falta aplicar o SQL TR-01/)).toBeTruthy();
  });
});
