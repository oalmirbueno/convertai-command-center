import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Agente sênior que age (pedido do dono em 25/09 à noite), tela: o que ele
 * viu com a fonte, as ações em cartão (só o marcado é feito, Desfazer), o
 * aviso de acesso só de leitura, o teste montado pelo agente e o kit de
 * recepção com o post indo para a agenda só no Confirmar.
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
import AgenteSenior from "@/components/mesa-ads/AgenteSenior";
import KitDeRecepcao from "@/components/mesa-ads/KitDeRecepcao";
import TesteDoAgente from "@/components/mesa-ads/TesteDoAgente";
import { normalizarPlano } from "@/components/mesa-ads/adsApi";
import { proximoDiaUtil, roteiroComercialEmTexto, normalizarKit } from "@/components/mesa-ads/acoesDoAgenteApi";

const CLIENTE = "33333333-3333-3333-3333-333333333333";

const catalogo: ModeloIa[] = [
  {
    id: "openai:gpt-texto", provedor: "openai", modelo_api: "gpt-texto", tipo: "texto", rotulo: "Texto",
    preco_entrada_1m: 1, preco_saida_1m: 2, preco_cache_1m: null, preco_imagem: null,
    raciocinio: ["low", "medium"], padrao_para: ["estrategista", "diretor_arte", "leitura"], ativo: true,
  } as ModeloIa,
];

const valor = (isAdmin = true): MesaValor => ({
  clientId: CLIENTE, clientName: "Cliente", userId: "u-1", isAdmin, podeRecarregar: true, saldoUsd: 50,
  catalogo, catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(),
});

function montar(filho: any, isAdmin = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(TooltipProvider, null, h(MesaProvider, { valor: valor(isAdmin), children: filho }))));
}

const chamadas = (funcao: string, acao: string) =>
  mock.invoke.mock.calls.filter((c: any[]) => c[0] === funcao && c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);

function responder(mapa: Record<string, unknown>) {
  mock.invoke.mockImplementation(async (_f: string, { body }: any) =>
    Object.prototype.hasOwnProperty.call(mapa, body.acao) ? { data: mapa[body.acao], error: null } : { data: { ok: true }, error: null },
  );
}

const itemPausar = {
  id: "i1", tipo: "pausar", na_meta: true, alvo: { ref: "n1", nivel: "anuncio", meta_id: "140000000000001", nome: "Post antigo" }, criativo: null, texto: null, variacao_pct: null,
  motivo: "R$ 80 sem nenhuma conversa em 14 dias", de: { status: "ACTIVE", efetivo: "ACTIVE", orcamento_diario_brl: null, nome: "Post antigo" }, para: { status: "PAUSED" }, limitado: false, indisponivel: null,
};
const itemVerba = {
  id: "i2", tipo: "orcamento", na_meta: true, alvo: { ref: "c1", nivel: "campanha", meta_id: "120000000000001", nome: "Mensagens" }, criativo: null, texto: null, variacao_pct: 30,
  motivo: "R$ 4 por conversa", de: { status: "ACTIVE", efetivo: "ACTIVE", orcamento_diario_brl: 100, nome: "Mensagens" }, para: { orcamento_diario_brl: 130 }, limitado: true, indisponivel: null,
};

const mensagemComAcoes = (gestao: { disponivel: boolean; motivo: string | null }, extra: Record<string, unknown> = {}) => ({
  conversa_id: "conv-1",
  mensagens: [{
    id: "m2", papel: "agente", conteudo: "ok", criado_em: "2026-09-25T20:00:00Z",
    estrategia: {
      resposta: "Pause o que gasta sem conversa e suba a verba do que traz mensagem.",
      diagnostico: [{ titulo: "Verba parada em anúncio sem conversa", detalhe: "R$ 80 sem resultado", gravidade: "alta" }],
      escalar: [], manter: [], cortar: [],
      reestruturacao: { objetivo: "mensagens", porque: "", evento_otimizacao: "", campanhas: [], verba_total_diaria_brl: null, passos: [] },
      proximos_criativos: [{ titulo: "Relógio", angulo: "espera", gancho_verbal: "Sem fila", gancho_visual: "relógio", formato: "feed_4x5", estilo_visual: "", objetivo: "mensagens", cta_meta: "Enviar mensagem", base_ad_id: "", porque: "venceu" }],
      pesquisa: [], perguntas: [],
      plano_de_teste: { hipotese: "O gancho da espera traz conversa mais barata.", variavel: "O gancho", publico: "Raio 5 km", orcamento_diario_brl: 40, duracao_dias: 7, metrica_decisao: "Custo por conversa", criterio_vitoria: "Abaixo de R$ 12" },
    },
    numeros: {
      fonte: "Meta Ads, coletado pelo painel", periodo: { inicio: "2026-09-01", fim: "2026-09-24", dias: 24 }, atualizado_em: new Date().toISOString(),
      gasto: 1200, resultados: 90, resultado_rotulo: "Conversas iniciadas", custo_por_resultado: 13.33, ctr_link_pct: 1.2, cpm: 22, frequencia: 1.8,
      comparacao: { gasto_pct: 10, resultados_pct: -5, custo_por_resultado_pct: 15 }, mix: [{ rotulo: "Mensagem", pct: 60, gasto: 720, resultados: 90 }], alertas: [], anuncios_ativos: 4,
    },
    acoes: { tipo: "acoes_conta", resumo: "Pausar um anúncio e subir a verba do vencedor.", itens: [itemPausar, itemVerba], ignorados: [], gestao, ...extra },
  }],
});

beforeEach(() => {
  mock.invoke.mockReset();
});

describe("agente sênior que age (tela)", () => {
  it("mostra o que viu com a fonte, e confirma só o item marcado; depois dá para desfazer", async () => {
    responder({
      conta_conversa_ler: mensagemComAcoes({ disponivel: true, motivo: null }),
      conta_acao_executar: {
        anexo: { tipo: "acoes_conta", resumo: "x", itens: [{ ...itemPausar, resultado: { ok: true, feito_em: "2026-09-25T20:05:00Z" } }, { ...itemVerba, resultado: { ok: false, motivo: "Não marcado nesta confirmação." } }], ignorados: [], gestao: { disponivel: true, motivo: null }, executada_em: "2026-09-25T20:05:00Z" },
        feitos: 1, falhas: 0,
      },
      conta_acao_desfazer: { anexo: { tipo: "acoes_conta", resumo: "x", itens: [{ ...itemPausar, resultado: { ok: true, desfeito: true } }], ignorados: [], gestao: null, executada_em: "x", desfeita_em: "y" }, voltaram: 1 },
    });
    montar(h(AgenteSenior, { nomeDe: (id: string) => `Anúncio ${id}` }));
    expect(await screen.findByText("O que ele viu")).toBeTruthy();
    expect(screen.getByText(/Fonte: Meta Ads, coletado pelo painel, de /)).toBeTruthy();
    expect(screen.getByText("Ações propostas · 2")).toBeTruthy();
    expect(screen.getByText(/limitado a 30% por vez/)).toBeTruthy();
    // Tira a verba da confirmação: só o pausar vai.
    fireEvent.click(screen.getByLabelText(/Marcar: Mudar orçamento diário Mensagens/));
    fireEvent.click(screen.getByRole("button", { name: /Confirmar 1/ }));
    await waitFor(() => expect(chamadas("mesa-ads", "conta_acao_executar")).toEqual([{ acao: "conta_acao_executar", mensagem_id: "m2", itens: ["i1"] }]));
    fireEvent.click(await screen.findByRole("button", { name: /Desfazer/ }));
    await waitFor(() => expect(chamadas("mesa-ads", "conta_acao_desfazer")).toEqual([{ acao: "conta_acao_desfazer", mensagem_id: "m2" }]));
    expect(await screen.findByText(/Desfeito: a conta voltou/)).toBeTruthy();
  });

  it("token só de leitura: itens indisponíveis com o motivo e o caminho para conectar com gestão", async () => {
    const motivo = "O acesso de anúncios deste cliente só tem leitura (ads_read). Para o agente mexer na campanha, conecte com permissão de gestão (ads_management).";
    responder({
      conta_conversa_ler: {
        ...mensagemComAcoes({ disponivel: false, motivo }),
        mensagens: mensagemComAcoes({ disponivel: false, motivo }).mensagens.map((m) => ({ ...m, acoes: { ...m.acoes, itens: m.acoes.itens.map((i) => ({ ...i, indisponivel: motivo })) } })),
      },
    });
    montar(h(AgenteSenior, {}));
    expect(await screen.findByRole("link", { name: /Conectar com permissão de gestão/ })).toBeTruthy();
    expect(screen.getAllByText(motivo).length).toBeGreaterThan(1);
    expect((screen.getByRole("button", { name: /Confirmar 0/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("modo Direto às ações manda modo agir", async () => {
    responder({ conta_conversa_ler: { conversa_id: "conv-1", mensagens: [] }, conta_conversar: { conversa_id: "conv-1", custo_usd: 0 } });
    montar(h(AgenteSenior, {}));
    await screen.findByText(/Peça o que fazer com a conta/);
    fireEvent.click(screen.getByLabelText(/Direto às ações/));
    fireEvent.change(screen.getByLabelText("Mensagem ao agente sênior"), { target: { value: "Otimize" } });
    fireEvent.click(screen.getByRole("button", { name: /^Enviar/ }));
    await waitFor(() => expect(chamadas("mesa-ads", "conta_conversar")).toHaveLength(1));
    expect(chamadas("mesa-ads", "conta_conversar")[0]).toMatchObject({ mensagem: "Otimize", modo: "agir" });
    try {
      window.localStorage.removeItem("mesa-ads:agente-senior:agir");
    } catch {
      /* ok */
    }
  });
});

const KIT = {
  promessa_do_anuncio: "Clareamento sem fila, com hora marcada",
  post: { formato: "carrossel", titulo: "Por que aqui não tem fila", gancho: "Cansou de esperar?", roteiro: [{ ordem: 1, texto: "Hora marcada de verdade", visual: "relógio" }], legenda: "Legenda pronta", cta: "Chama no WhatsApp", por_que_recebe: "Confirma a promessa" },
  perfil: ["Bio com hora marcada"],
  comercial: { canal: "WhatsApp", primeira_resposta: "Oi! Tenho horário amanhã.", perguntas_qualificacao: ["Já fez clareamento?"], objecoes: [{ objecao: "É caro", resposta: "Parcelamos em 10 vezes", fonte: "briefing" }], oferta_e_fechamento: "Avaliação grátis", follow_up: [{ quando: "No dia seguinte", mensagem: "Conseguiu ver?" }] },
  lacunas: [],
  conferencia: { post_confirma: 8.5, roteiro_fiel: 9, risco_politica: 10, alerta: false, jev_erro: null },
};

const plano = (kit: unknown) => normalizarPlano({ id: "p-1", client_id: CLIENTE, nome: "Plano", status: "rascunho", angulos: [{ id: "a1", nome: "Espera", kit_recepcao: kit }], estrutura: {} });

describe("kit de recepção (tela)", () => {
  it("mostra o post e o roteiro de vendas; o post só vai para a agenda no Confirmar", async () => {
    responder({ kit_agenda: { task_id: "t-1", data: proximoDiaUtil(), plano: { id: "p-1", client_id: CLIENTE, nome: "Plano", angulos: [{ id: "a1", nome: "Espera", kit_recepcao: { ...KIT, agenda: { task_id: "t-1", data: proximoDiaUtil() } } }], estrutura: {} } } });
    const p = plano(KIT);
    montar(h(KitDeRecepcao, { plano: p, angulo: p.angulos[0] }));
    expect(screen.getByText("Por que aqui não tem fila")).toBeTruthy();
    expect(screen.getByText(/Atendimento e vendas \(WhatsApp\)/)).toBeTruthy();
    expect(screen.getByText("do briefing")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Mandar para a agenda/ }));
    expect(chamadas("mesa-ads", "kit_agenda")).toHaveLength(0);
    expect(screen.getByRole("group", { name: "Confirmar o post na agenda" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Confirmar$/ }));
    await waitFor(() => expect(chamadas("mesa-ads", "kit_agenda")).toEqual([{ acao: "kit_agenda", plano_id: "p-1", angulo_id: "a1", data: proximoDiaUtil() }]));
  });

  it("roteiro em texto para colar no WhatsApp e próximo dia útil", () => {
    const t = roteiroComercialEmTexto(normalizarKit(KIT)!);
    expect(t).toContain("1. Primeira resposta");
    expect(t).toContain("Parcelamos em 10 vezes");
    expect(proximoDiaUtil(new Date(2026, 8, 25))).toBe("2026-09-28");
  });
});

describe("teste montado pelo agente (tela)", () => {
  it("mostra os campos preenchidos e marca o que ficou sem base", () => {
    const p = normalizarPlano({
      id: "p-2", client_id: CLIENTE, nome: "Teste do agente", status: "rascunho", angulos: [{ id: "a1", nome: "Relógio" }],
      estrutura: { teste: { hipotese: "Espera vende", variavel: "O gancho", publico: "", orcamento_diario_brl: null, duracao_dias: 7, metrica_decisao: "Custo por conversa", criterio_vitoria: "Abaixo de R$ 12" }, lacunas: ["Verba diária do teste: sem gasto no período."] },
    });
    montar(h(TesteDoAgente, { plano: p }));
    expect(screen.getByText("Teste montado pelo agente sênior")).toBeTruthy();
    expect(screen.getByText("Espera vende")).toBeTruthy();
    expect(screen.getAllByText("A definir").length).toBe(2);
    expect(screen.getByText(/Verba diária do teste/)).toBeTruthy();
  });
});
