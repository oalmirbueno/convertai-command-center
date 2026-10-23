import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Agente de roteiro da peça de vídeo da campanha (23/10/2026, dono: "o agente onde eu dou a ideia do roteiro
 * e ele já faz, quantos minutos e tudo, ele fica para selecionar ali dentro mesmo ... completo com cenas ...
 * até dar sugestão, participar junto com ultra criatividade"):
 * - regras puras: duração pedida presa à lista, cenas reescaladas para somar o tempo, até 24 cenas de 30 s,
 *   câmera e som por cena, a escolha do Jev e as versões guardadas na peça;
 * - o documento (PDF e Word) cobre todas as cenas, mesmo no roteiro longo;
 * - a tela: ideia, duração, estilo e criatividade vão no pedido; as duas versões aparecem com a recomendada;
 *   "Usar esta" grava a escolhida; a sugestão vira pedido e o ajuste volta como edição para salvar.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = () => {
    const b: any = {};
    for (const m of ["select", "eq", "neq", "in", "order", "limit"]) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve({ data: null, error: null });
    b.then = (ok: any, erro: any) => Promise.resolve({ data: [], error: null }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
      from: () => consulta(),
      storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/a" }, error: null }) }) },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/mesa-videos/videosApi", async (original) => {
  const real = (await original()) as Record<string, unknown>;
  return { ...real, usePedidos: () => ({ data: { itens: [], disponivel: true } }) };
});
vi.mock("@/components/mesa/GravarVideoDaCampanha", () => ({ default: () => h("div", null, "Gravar"), textoDoRoteiro: () => "" }));
vi.mock("@/components/mesa/GerarVideoDaCampanha", () => ({ default: () => h("div", null, "Gerar") }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import CampanhaVideos from "@/components/mesa/CampanhaVideos";
import { roteiroDoDocumento } from "@/components/mesa/documentoDoRoteiroDeVideo";
import { chaves, type Campanha, type ItemProposto } from "@/components/mesa/mesaV4Api";
import type { ModeloIa } from "@/lib/mesa/api";
import { MAX_CENAS, normalizarRoteiroDeVideo, type RoteiroDeVideo } from "../../supabase/functions/agente-calendario/modulos/roteiro-de-video";
import {
  ajustarDuracao,
  ajusteDaResposta,
  cenasParaDuracao,
  lerEscolhaDoRoteiro,
  normalizarDuracaoPedida,
  normalizarOpcoesDoRoteiro,
  perguntaDaEscolhaDoRoteiro,
  tarefaDoAgenteDeRoteiro,
  versoesDaResposta,
} from "../../supabase/functions/agente-calendario/modulos/agente-de-roteiro";

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const CAMPANHA_ID = "d7140376-0000-4000-8000-000000000002";
const PROPOSTA_ID = "22222222-2222-4222-8222-222222222223";

const cena = (n: number, extra: Record<string, unknown> = {}) => ({ descricao: `Cena ${n} acontece`, plano: "close lento", fala: `Fala ${n}`, texto_na_tela: `Tela ${n}`, som: "trilha sobe", segundos: 5, ...extra });

describe("agente de roteiro (regras puras)", () => {
  it("duração pedida presa à lista e faixa de cenas pela duração", () => {
    expect(normalizarDuracaoPedida(60)).toBe(60);
    expect(normalizarDuracaoPedida(100)).toBe(90);
    expect(normalizarDuracaoPedida(1000)).toBe(300);
    expect(normalizarDuracaoPedida(undefined)).toBe(30);
    expect(cenasParaDuracao(15).min).toBe(3);
    expect(cenasParaDuracao(300).max).toBe(MAX_CENAS);
  });

  it("o código acerta a soma: as cenas são reescaladas para o tempo pedido, cada uma de 1 a 30 s", () => {
    const r = normalizarRoteiroDeVideo({ gancho: "G", cenas: [cena(1, { segundos: 3 }), cena(2, { segundos: 9 }), cena(3, { segundos: 4 })], trilha: "", cta: "C" }) as RoteiroDeVideo;
    const um = ajustarDuracao(r, 60);
    expect(um.cenas.reduce((s, c) => s + c.segundos, 0)).toBe(60);
    expect(um.duracao).toBe(60);
    expect(um.cenas.every((c) => c.segundos >= 1 && c.segundos <= 30)).toBe(true);
    // Poucas cenas para muito tempo: para no teto de 30 s por cena.
    expect(ajustarDuracao(r, 300).duracao).toBe(90);
  });

  it("o roteiro guarda câmera, som, título, conceito e sugestões, com até 24 cenas", () => {
    const r = normalizarRoteiroDeVideo({ titulo: "PC floresta", conceito: "A poeira vira floresta", sugestoes: ["Abra com o som da ventoinha", ""], gancho: "G", cenas: Array.from({ length: 30 }, (_, i) => cena(i + 1)), trilha: "Suspense", cta: "Chame" }) as RoteiroDeVideo;
    expect(r.cenas.length).toBe(MAX_CENAS);
    expect(r.cenas[0]).toMatchObject({ plano: "close lento", som: "trilha sobe" });
    expect(r).toMatchObject({ titulo: "PC floresta", conceito: "A poeira vira floresta", sugestoes: ["Abra com o som da ventoinha"] });
    expect(r.duracao).toBe(120);
  });

  it("a tarefa leva a duração, o estilo e a ultra criatividade; o pedido vira duas versões diferentes", () => {
    const t = tarefaDoAgenteDeRoteiro({ ideia: "PC com floresta de poeira", duracao: 300, estilo: "humor", criatividade: "ultra" });
    expect(t).toContain("5 min (300 segundos");
    expect(t).toContain("Humor");
    expect(t).toContain("Ultra criatividade");
    expect(t).toContain("2 versões COMPLETAS");
    expect(t).toContain("PC com floresta de poeira");
    expect(t.indexOf("—")).toBe(-1);
  });

  it("as versões voltam normalizadas, com a ideia e a duração pedida", () => {
    const vs = versoesDaResposta({ versoes: [{ titulo: "A", conceito: "a", gancho: "g", cenas: [cena(1), cena(2)], trilha: "t", cta: "c", sugestoes: [] }, { titulo: "B", conceito: "b", gancho: "g", cenas: [], trilha: "t", cta: "c", sugestoes: [] }] }, { duracao: 30, ideia: "minha ideia" });
    expect(vs.length).toBe(1);
    expect(vs[0]).toMatchObject({ titulo: "A", ideia: "minha ideia", duracao: 30 });
    const a = ajusteDaResposta({ resposta: "Troquei a abertura — mais rápida.", roteiro: { titulo: "A2", conceito: "", gancho: "g2", cenas: [cena(1)], trilha: "", cta: "c", sugestoes: ["x"] } }, { duracao: 15, antes: vs[0] });
    expect(a && a.roteiro.duracao).toBe(15);
    expect(a && a.resposta).toBe("Troquei a abertura, mais rápida.");
    expect(ajusteDaResposta({ resposta: "nada" }, { duracao: 15, antes: vs[0] })).toBeNull();
  });

  it("o Jev escolhe por Choice entre as versões; resposta fora da lista fica na primeira", () => {
    const q = perguntaDaEscolhaDoRoteiro(2);
    expect(q.melhor.type).toBe("choice");
    expect(Object.keys(q.melhor.criteria)).toEqual(["v1", "v2"]);
    expect(lerEscolhaDoRoteiro({ choice: "v2", confidence: 0.8 }, 2)).toEqual({ indice: 1, confianca: 0.8 });
    expect(lerEscolhaDoRoteiro({ choice: "v9" }, 2).indice).toBe(0);
    expect(lerEscolhaDoRoteiro(null, 2)).toEqual({ indice: 0, confianca: null });
  });

  it("as versões guardadas na peça são lidas de volta e a recomendada fica dentro da lista", () => {
    const o = normalizarOpcoesDoRoteiro({ versoes: [{ gancho: "g", cenas: [cena(1)], trilha: "", cta: "" }], recomendada: 5, duracao: 61, estilo: "x", criatividade: "ousada" });
    expect(o).toMatchObject({ recomendada: 0, duracao: 60, estilo: "viral", criatividade: "ousada" });
    expect(normalizarOpcoesDoRoteiro({ versoes: [] })).toBeNull();
  });

  it("o documento cobre todas as cenas mesmo no roteiro longo (blocos de até 14)", () => {
    const r = normalizarRoteiroDeVideo({ titulo: "Longo", gancho: "G", cenas: Array.from({ length: 24 }, (_, i) => cena(i + 1)), trilha: "Trilha X", cta: "Chame" }) as RoteiroDeVideo;
    const d = roteiroDoDocumento(r, "Tema");
    expect(d.blocos.length).toBeLessThanOrEqual(14);
    expect(d.blocos.reduce((s, b) => s + b.segundos, 0)).toBe(120);
    expect(d.blocos[0].funcao).toBe("Cenas 1 a 2");
    expect(d.blocos[0].visual).toContain("Câmera: close lento");
    expect(d.titulo).toBe("Longo");
    expect(d.duracao_alvo_s).toBe(120);
  });
});

// ------------------------------------------------------------------ tela

const catalogo: ModeloIa[] = [
  {
    id: "openai:gpt-texto", provedor: "openai", modelo_api: "gpt-texto", tipo: "texto", rotulo: "Texto",
    preco_entrada_1m: 1, preco_saida_1m: 2, preco_cache_1m: null, preco_imagem: null,
    raciocinio: ["low"], padrao_para: ["estrategista"], ativo: true,
  },
];
const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE, clientName: "Cliente sintético", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 50,
  catalogo, catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(),
});

const campanha = { id: CAMPANHA_ID, client_id: CLIENTE, nome: "Halloween do PC", proposta_id: PROPOSTA_ID, briefing: {} } as unknown as Campanha;
const pecaDeVideo: ItemProposto = { tema_id: "v1", data: "2026-10-27", formato: "video", etapa: "sustentação", tema: "Reels do PC assombrado", gancho: "Travou", cards: [] } as unknown as ItemProposto;
const proposta = { id: PROPOSTA_ID, client_id: CLIENTE, itens: [pecaDeVideo] };

const versao = (titulo: string, sugestoes: string[] = []) => ({ titulo, conceito: `Conceito ${titulo}`, gancho: `Gancho ${titulo}`, cenas: [cena(1), cena(2), cena(3)], duracao: 15, trilha: "Suspense", cta: "Chame no WhatsApp", sugestoes });

const chamadas = (acao: string) => mock.invoke.mock.calls.filter((c) => c[1] && c[1].body && c[1].body.acao === acao).map((c) => c[1].body);
const confirmarCusto = async (botao: HTMLElement, acao: string, antes = 0) => {
  fireEvent.click(botao);
  await new Promise((r) => setTimeout(r, 450));
  if (chamadas(acao).length <= antes) fireEvent.click(botao);
};

beforeEach(() => {
  mock.invoke.mockReset();
  mock.invoke.mockImplementation(async (_f: string, { body }: any) => {
    if (body.acao === "campanha_roteiro_agente" && body.operacao === "criar") {
      const opcoes = { versoes: [versao("Poeira viva"), versao("Floresta no gabinete", ["Abra com o som da ventoinha"])], recomendada: 1, porque: "O Jev recomenda (80% de confiança).", ideia: body.ideia, duracao: body.duracao_s, estilo: body.estilo, criatividade: body.criatividade, em: "x" };
      return { data: { opcoes, proposta: { ...proposta, itens: [{ ...pecaDeVideo, roteiro_opcoes: opcoes }] }, custo_usd: 0.02 }, error: null };
    }
    if (body.acao === "campanha_roteiro_agente" && body.operacao === "ajustar") {
      return { data: { roteiro: { ...body.roteiro, gancho: "Gancho ajustado", sugestoes: ["Feche com o técnico rindo"] }, resposta: "Abri com a ventoinha e encurtei a fala.", custo_usd: 0.01 }, error: null };
    }
    if (body.acao === "editar_item") {
      const item = { ...pecaDeVideo, ...body.campos };
      return { data: { proposta: { ...proposta, itens: [item] }, item, avisos: [], custo_usd: 0 }, error: null };
    }
    return { data: {}, error: null };
  });
});

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(chaves.proposta(PROPOSTA_ID), proposta);
  render(h(MemoryRouter, null, h(QueryClientProvider, { client: qc }, h(TooltipProvider, null, h(MesaProvider, { valor: valorDaMesa(), children: h(CampanhaVideos, { campanha }) })))));
  return qc;
}

describe("agente de roteiro na peça de vídeo (tela)", () => {
  it("cria duas versões com a ideia, a duração e o estilo; usa a escolhida; a sugestão vira ajuste para salvar", async () => {
    montar();
    const agente = await screen.findByRole("region", { name: /Agente de roteiro de Reels do PC assombrado/ });
    fireEvent.change(within(agente).getByLabelText(/Ideia do roteiro/), { target: { value: "O técnico abre um PC e acha uma floresta de poeira" } });
    fireEvent.click(within(agente).getByRole("button", { name: "1 min" }));
    fireEvent.click(within(agente).getByRole("button", { name: "Humor" }));
    expect(within(agente).getByRole("button", { name: /Ultra/ }).getAttribute("aria-pressed")).toBe("true");
    await confirmarCusto(within(agente).getByRole("button", { name: /Criar roteiro/ }), "campanha_roteiro_agente");
    await waitFor(() => expect(chamadas("campanha_roteiro_agente").length).toBe(1));
    expect(chamadas("campanha_roteiro_agente")[0]).toMatchObject({ operacao: "criar", campanha_id: CAMPANHA_ID, tema_id: "v1", ideia: "O técnico abre um PC e acha uma floresta de poeira", duracao_s: 60, estilo: "humor", criatividade: "ultra" });

    const lista = await screen.findByRole("list", { name: /Versões do agente/ });
    const itens = within(lista).getAllByRole("listitem").filter((li) => li.getAttribute("data-versao"));
    expect(itens.length).toBe(2);
    expect(itens[1].getAttribute("data-recomendada")).toBe("sim");
    expect(within(itens[1]).getByText("Recomendada")).toBeTruthy();
    fireEvent.click(within(itens[0]).getByRole("button", { name: /Ver as cenas da versão 1/ }));
    expect(within(itens[0]).getAllByText("Câmera: close lento").length).toBe(3);

    fireEvent.click(screen.getByRole("button", { name: "Usar a versão 2" }));
    await waitFor(() => expect(chamadas("editar_item").length).toBe(1));
    expect(chamadas("editar_item")[0].campos.roteiro_video).toMatchObject({ titulo: "Floresta no gabinete", gancho: "Gancho Floresta no gabinete" });

    // Com o roteiro escolhido: a conversa com o agente e as sugestões dele.
    const sugestao = await screen.findByRole("button", { name: /Abra com o som da ventoinha/ });
    fireEvent.click(sugestao);
    const pedido = screen.getByLabelText(/Pedido ao agente/) as HTMLInputElement;
    expect(pedido.value).toBe("Abra com o som da ventoinha");
    await confirmarCusto(screen.getByRole("button", { name: /Ajustar/ }), "campanha_roteiro_agente", 1);
    await waitFor(() => expect(chamadas("campanha_roteiro_agente").length).toBe(2));
    expect(chamadas("campanha_roteiro_agente")[1]).toMatchObject({ operacao: "ajustar", pedido: "Abra com o som da ventoinha" });
    expect(chamadas("campanha_roteiro_agente")[1].roteiro.titulo).toBe("Floresta no gabinete");
    // O ajuste volta como edição: aparece a resposta e o salvar (sem custo).
    expect(await screen.findByText("Abri com a ventoinha e encurtei a fala.")).toBeTruthy();
    expect((screen.getByLabelText("Gancho de Reels do PC assombrado") as HTMLInputElement).value).toBe("Gancho ajustado");
    fireEvent.click(screen.getByRole("button", { name: "Salvar o roteiro" }));
    await waitFor(() => expect(chamadas("editar_item").length).toBe(2));
    expect(chamadas("editar_item")[1].campos.roteiro_video.gancho).toBe("Gancho ajustado");
  });
});
