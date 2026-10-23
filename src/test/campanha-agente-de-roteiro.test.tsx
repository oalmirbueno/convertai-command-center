import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regras puras do agente de roteiro da peça de vídeo (23/10/2026, dono: "o agente onde eu dou a ideia do
 * roteiro e ele já faz, quantos minutos e tudo ... completo com cenas ... até dar sugestão, participar junto
 * com ultra criatividade"): duração pedida presa à lista, cenas reescaladas para somar o tempo, até 24 cenas
 * de 30 s, câmera e som por cena, a escolha do Jev e as versões guardadas na peça.
 * Agente unificado (23/10): a tela é uma só (RoteiroDaPecaDeVideo, testada em peca-de-video-roteiro); estas
 * regras seguem valendo para o roteiro antigo do item, que a peça lê e leva para a tabela sem perder nada.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = () => {
    const b: any = {};
    for (const m of ["select", "eq", "neq", "in", "is", "or", "order", "limit", "contains"]) b[m] = () => b;
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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/components/mesa-videos/videosApi", async (original) => {
  const real = (await original()) as Record<string, unknown>;
  return { ...real, usePedidos: () => ({ data: { itens: [], disponivel: true } }) };
});
vi.mock("@/components/mesa/GravarVideoDaCampanha", () => ({ default: () => h("div", null, "Gravar") }));
vi.mock("@/components/mesa/GerarVideoDaCampanha", () => ({ default: () => h("div", null, "Gerar") }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import CampanhaVideos from "@/components/mesa/CampanhaVideos";
import { chaves, type Campanha, type ItemProposto } from "@/components/mesa/mesaV4Api";
import type { ModeloIa } from "@/lib/mesa/api";
import { roteiroDaPecaAntiga } from "../../supabase/functions/mesa-roteiros/modulos/roteiro-da-peca";
import { MAX_CENAS, normalizarRoteiroDeVideo, normalizarVideoPronto, type RoteiroDeVideo } from "../../supabase/functions/agente-calendario/modulos/roteiro-de-video";
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
    const d = roteiroDaPecaAntiga(r, "Tema");
    expect(d.blocos.length).toBeLessThanOrEqual(14);
    expect(d.blocos.reduce((s, b) => s + b.segundos, 0)).toBe(120);
    expect(d.blocos[0].funcao).toBe("Cenas 1 a 2");
    expect(d.blocos[0].visual).toContain("Câmera: close lento");
    expect(d.blocos[0].broll).toContain("Som: trilha sobe");
    // O título é o tema (é por ele que a peça acha o roteiro); o nome antigo fica embaixo.
    expect(d.titulo).toBe("Tema");
    expect(d.subtitulo).toBe("Longo");
    expect(d.duracao_alvo_s).toBe(120);
    expect(d.broll).toEqual(["Trilha: Trilha X"]);
  });
});

// ------------------------------------------------------------------ peças de vídeo sem depender do agente (23/10)

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const CAMPANHA_ID = "d7140376-0000-4000-8000-000000000002";
const PROPOSTA_ID = "22222222-2222-4222-8222-222222222223";
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
const chamadas = (acao: string) => mock.invoke.mock.calls.filter((c) => c[1] && c[1].body && c[1].body.acao === acao).map((c) => c[1].body);

describe("vídeo pronto da peça (regra pura)", () => {
  it("aceita só vídeo do cliente (mesa) ou do Workspace, sem subir pasta", () => {
    expect(normalizarVideoPronto({ bucket: "mesa", caminho: `${CLIENTE}/video/brutos/a.mp4`, nome: "a.mp4" }, CLIENTE)).toMatchObject({ bucket: "mesa", nome: "a.mp4" });
    expect(normalizarVideoPronto({ bucket: "mesa", caminho: "outro-cliente/video/a.mp4" }, CLIENTE)).toBeUndefined();
    expect(normalizarVideoPronto({ bucket: "workspace", caminho: "pasta/../x.mp4" })).toBeUndefined();
    expect(normalizarVideoPronto({ bucket: "workspace", caminho: "pasta/foto.png" })).toBeUndefined();
    expect(normalizarVideoPronto({ bucket: "s3", caminho: "a.mp4" })).toBeUndefined();
  });
});

describe("Vídeos e Reels sem depender do agente (tela)", () => {
  const semVideo = { ...proposta, itens: [] as unknown[] };
  const comPronto = { ...proposta, itens: [{ ...pecaDeVideo, video_pronto: { bucket: "mesa", caminho: `${CLIENTE}/video/brutos/reels.mp4`, nome: "reels.mp4", em: "x" } }] };

  function montarCom(p: unknown) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(chaves.proposta(PROPOSTA_ID), p);
    render(h(MemoryRouter, null, h(QueryClientProvider, { client: qc }, h(TooltipProvider, null, h(MesaProvider, { valor: valorDaMesa(), children: h(CampanhaVideos, { campanha }) })))));
  }

  beforeEach(() => {
    mock.invoke.mockReset();
    mock.invoke.mockImplementation(async (_f: string, { body }: any) => {
      if (body.acao === "campanha_peca_de_video") {
        if (body.operacao === "criar") return { data: { proposta: { ...proposta, itens: [{ ...pecaDeVideo, tema_id: "c2", tema: body.tema }] }, tema_id: "c2", custo_usd: 0 }, error: null };
        if (body.operacao === "tirar") return { data: { proposta: { ...proposta, itens: [] }, tema_id: body.tema_id, custo_usd: 0 }, error: null };
        return { data: { proposta: { ...proposta, itens: [{ ...pecaDeVideo, ...(body.video ? { video_pronto: body.video } : {}) }] }, tema_id: body.tema_id, custo_usd: 0 }, error: null };
      }
      if (body.acao === "editar_item") return { data: { proposta: { ...proposta, itens: [{ ...pecaDeVideo, ...body.campos }] }, avisos: [], custo_usd: 0 }, error: null };
      return { data: {}, error: null };
    });
  });

  it("campanha sem vídeo: o Novo vídeo aparece; Só a peça cria sem custo; não há agente antigo", async () => {
    montarCom(semVideo);
    expect(await screen.findByRole("region", { name: "Novo vídeo na campanha" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: /Agente de roteiro de Novo vídeo/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("Nome do vídeo novo"), { target: { value: "Bastidor da bancada" } });
    fireEvent.click(screen.getByRole("button", { name: /Só a peça/ }));
    await waitFor(() => expect(chamadas("campanha_peca_de_video").length).toBe(1));
    expect(chamadas("campanha_peca_de_video")[0]).toMatchObject({ operacao: "criar", campanha_id: CAMPANHA_ID, tema: "Bastidor da bancada", video: null });
    expect(await screen.findByText("Bastidor da bancada")).toBeTruthy();
  });

  it("Roteiro com o agente: cria a peça (sem custo) e o agente de roteiro unificado aparece nela, pronto para criar", async () => {
    montarCom(semVideo);
    fireEvent.change(await screen.findByLabelText("Nome do vídeo novo"), { target: { value: "Bastidor da bancada" } });
    fireEvent.click(screen.getByRole("button", { name: /Roteiro com o agente/ }));
    await waitFor(() => expect(chamadas("campanha_peca_de_video")[0]).toMatchObject({ operacao: "criar", tema: "Bastidor da bancada", video: null }));
    const agente = await screen.findByRole("region", { name: /Agente de roteiro de Bastidor da bancada/ });
    expect(within(agente).getByLabelText(/Ideia do roteiro/)).toBeTruthy();
    expect(within(agente).getByRole("button", { name: /Criar roteiro/ })).toBeTruthy();
    expect(screen.getAllByRole("region", { name: /Agente de roteiro/ })).toHaveLength(1);
    expect(chamadas("campanha_roteiro_agente")).toHaveLength(0);
  });

  it("peça com vídeo pronto: mostra o vídeo, tira o vídeo, edita o nome e apaga com confirmação", async () => {
    montarCom(comPronto);
    expect(await screen.findByText(/Vídeo pronto: reels\.mp4/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tirar o vídeo da peça" }));
    await waitFor(() => expect(chamadas("campanha_peca_de_video")[0]).toMatchObject({ operacao: "anexar", tema_id: "v1", video: null }));

    fireEvent.click(screen.getByRole("button", { name: /Editar a peça/ }));
    fireEvent.change(screen.getByLabelText(/Nome da peça/), { target: { value: "Reels novo" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(chamadas("editar_item")[0]).toMatchObject({ tema_id: "v1", campos: { tema: "Reels novo" } }));

    fireEvent.click(screen.getByRole("button", { name: /^Apagar a peça/ }));
    expect(chamadas("campanha_peca_de_video").filter((b) => b.operacao === "tirar").length).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: /Confirmar: apagar a peça/ }));
    await waitFor(() => expect(chamadas("campanha_peca_de_video").filter((b) => b.operacao === "tirar").length).toBe(1));
  });
});
