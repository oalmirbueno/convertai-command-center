import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Caminho Gerar do vídeo da campanha (22/10/2026): roteiro e cenas, cenas em vídeo pela Mesa Vídeos (409 de
 * todas as cenas somado antes), narração pela ElevenLabs (custo antes, só gera com confirmado) e a
 * montagem (versao_registrar com a voz em papel "voz" e a música em papel "trilha", depois render_pedir
 * render_final). Funções falsas: supabase.functions.invoke (agente-calendario), mesa-videos e editor-video.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), mesaVideos: vi.fn(), editor: vi.fn(), pedidos: [] as unknown[], arquivos: [] as unknown[] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    rpc: vi.fn(),
    from: vi.fn(),
    storage: { from: () => ({ createSignedUrl: (c: string) => Promise.resolve({ data: { signedUrl: `https://assinado.test/${c}` }, error: null }) }) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/components/mesa-videos/videosApi", async (original) => {
  const real = (await original()) as Record<string, unknown>;
  return {
    ...real,
    chamarMesaVideos: mock.mesaVideos,
    usePedidos: () => ({ data: { itens: mock.pedidos, disponivel: true } }),
    useArquivosDeVideo: () => ({ data: { arquivos: mock.arquivos, degradado: false } }),
  };
});
vi.mock("@/lib/mesa-videos/api", async (original) => {
  const real = (await original()) as Record<string, unknown>;
  const { MOTORES_DE_VIDEO } = await import("../../supabase/functions/mesa-videos/modulos/modelos-de-video");
  const lista = MOTORES_DE_VIDEO.filter((m) => m.id === "seedance-2.0-mini" || m.id === "seedance-2.5").map((m) => ({ motor: m, estado: "pronto", estado_rotulo: "Pronto", nivel: "normal", novo: false, chave: null }));
  return { ...real, useMotoresDaMesa: () => ({ lista, motores: MOTORES_DE_VIDEO, carregando: false, semFuncao: false, recarregar: () => undefined }) };
});
vi.mock("@/lib/editor/api", () => ({ chamarEditorVideo: mock.editor }));

import { ErroDaMesa } from "@/lib/mesa/api";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import GerarVideoDaCampanha from "@/components/mesa/GerarVideoDaCampanha";
import { projetoDoVideoDaCampanha, CHAVE_DA_NARRACAO, CHAVE_DA_TRILHA } from "@/components/mesa/montagemDoVideoDaCampanha";
import type { Campanha, ItemProposto } from "@/components/mesa/mesaV4Api";
import { normalizarRoteiroDeVideo, type RoteiroDeVideo } from "../../supabase/functions/agente-calendario/modulos/roteiro-de-video";
import { assinaturaDaCena, pedidoDaNarracao, textoDaNarracao } from "../../supabase/functions/agente-calendario/modulos/narracao-da-campanha-regras";

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const CAMP = "44444444-4444-4444-4444-444444444444";
const PROPOSTA = "22222222-2222-2222-2222-222222222222";
const VERSAO = "88888888-8888-8888-8888-888888888888";
const VOZ = "AbCdEfGh12345678";
const pedidoId = (n: number) => `7777777${n}-7777-7777-7777-777777777777`;
const arquivoId = (n: number) => `6666666${n}-6666-6666-6666-666666666666`;

const roteiroBase = (): RoteiroDeVideo =>
  normalizarRoteiroDeVideo({
    gancho: "Loja vazia?",
    cenas: [
      { descricao: "Vitrine apagada", fala: "Sua loja vazia na Black Friday?", texto_na_tela: "Loja vazia?", segundos: 3 },
      { descricao: "Clientes entrando", fala: "", texto_na_tela: "Até 40%", segundos: 4 },
      { descricao: "Caixa cheio", fala: "Até quarenta por cento, só neste fim de semana.", texto_na_tela: "", segundos: 5 },
    ],
    trilha: "Black Friday",
    cta: "Chame no direct",
  }) as RoteiroDeVideo;

/** O roteiro com as três cenas já em vídeo e a narração em dia com as falas. */
function roteiroPronto(): RoteiroDeVideo {
  const r = roteiroBase();
  return {
    ...r,
    cenas: r.cenas.map((c) => ({ ...c, video: { pedido_id: pedidoId(c.ordem), motor: "seedance-2.0-mini", assinatura: assinaturaDaCena(c), em: "" } })),
    narracao: {
      arquivo: `${CLIENTE}/campanhas/${CAMP}/narracao/t-video.mp3`,
      arquivo_id: null,
      duracao_s: 6,
      voz: { voice_id: VOZ, nome: "Ana" },
      modelo: "eleven_v4",
      texto: textoDaNarracao(r),
      cenas: [
        { ordem: 1, de_s: 0, ate_s: 2 },
        { ordem: 3, de_s: 2.2, ate_s: 5.6 },
      ],
      palavras: [{ t: "Sua", i: 0.05, f: 0.3 }],
      custo_usd: 0.01,
      em: "2026-10-22T12:00:00Z",
    },
  };
}

const valorDaMesa = (): MesaValor =>
  ({
    clientId: CLIENTE,
    clientName: "Cliente sintético",
    userId: "u-1",
    isAdmin: true,
    podeRecarregar: true,
    saldoUsd: 50,
    catalogo: [],
    catalogoCarregando: false,
    atualizarCusto: vi.fn(),
    abrirRecarga: vi.fn(),
    abrirChaves: vi.fn(),
    abrirModelos: vi.fn(),
  }) as unknown as MesaValor;

const campanha = (briefing: Record<string, unknown> = {}) => ({ id: CAMP, client_id: CLIENTE, nome: "Black Friday", proposta_id: PROPOSTA, briefing }) as unknown as Campanha;
const peca = (r: RoteiroDeVideo): ItemProposto => ({ tema_id: "t-video", formato: "video", tema: "Reels da oferta", roteiro_video: r }) as unknown as ItemProposto;

function montarTela(c: Campanha, item: ItemProposto) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(MemoryRouter, null, h(QueryClientProvider, { client: qc }, h(MesaProvider, { valor: valorDaMesa(), children: h(GerarVideoDaCampanha, { clientId: CLIENTE, campanha: c, propostaId: PROPOSTA, item }) }))),
  );
}

const corposDoCalendario = () => mock.invoke.mock.calls.map((x) => (x[1] as { body: Record<string, unknown> }).body);

beforeEach(() => {
  mock.invoke.mockReset();
  mock.mesaVideos.mockReset();
  mock.editor.mockReset();
  mock.pedidos = [];
  mock.arquivos = [];
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

describe("montagem do vídeo gerado (puro)", () => {
  it("cenas em sequência no tempo da fala, voz e trilha nos papéis certos, texto na tela", () => {
    const r = roteiroPronto();
    const clipes = r.cenas.map((c) => ({ ordem: c.ordem, arquivo_id: arquivoId(c.ordem), nome: `cena ${c.ordem}`, tipo: "gerado", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/gerados/${c.ordem}.mp4`, duracao_s: 5, largura: 720, altura: 1280 }));
    const trilha = { arquivo: `${CLIENTE}/campanhas/${CAMP}/sons/t.mp3`, titulo: "Black Friday · A", duracao: 30, origem: "elevenlabs", som_id: "55555555-5555-5555-5555-555555555555" };
    const { projeto, avisos } = projetoDoVideoDaCampanha({ clientId: CLIENTE, titulo: "BF · Reels", roteiro: r, clipes, trilha });
    expect(avisos).toEqual([]);
    const video = projeto.trilhas.find((t) => t.tipo === "video")!;
    expect(video.clipes).toHaveLength(3);
    // Cena 1: 0,35 + 2 + 0,5 = 2,85 s; cena 2 sem fala: 4 s; cena 3: 0,35 + 3,4 + 0,5 = 4,25 s.
    expect(video.clipes.map((c) => c.inicio_s)).toEqual([0, 2.88, 6.88]);
    expect(video.clipes.every((c) => c.volume === 0)).toBe(true);
    const vozes = projeto.trilhas.filter((t) => t.tipo === "audio").reduce((l, t) => l.concat(t.clipes.filter((c) => c.estilo && c.estilo.papel === "voz")), [] as typeof video.clipes);
    expect(vozes.map((c) => [c.fonte, c.cena_ref, c.entrada_s])).toEqual([
      [CHAVE_DA_NARRACAO, "1", 0],
      [CHAVE_DA_NARRACAO, "3", 2.2],
    ]);
    // O respiro de 0,35 s antes da fala, no quadro mais perto (25 fps).
    expect(Math.abs(vozes[0].inicio_s - 0.35)).toBeLessThanOrEqual(0.04);
    const musica = projeto.trilhas.filter((t) => t.tipo === "audio").reduce((l, t) => l.concat(t.clipes.filter((c) => c.estilo && c.estilo.papel === "trilha")), [] as typeof video.clipes);
    expect(musica).toHaveLength(1);
    expect(musica[0].fonte).toBe(CHAVE_DA_TRILHA);
    expect(projeto.mixagem).toMatchObject({ trilha_abaixo_da_voz_db: 22, lufs_alvo: -14, duck: true });
    const textos = projeto.trilhas.find((t) => t.tipo === "texto")!.clipes;
    expect(textos.map((c) => c.texto)).toEqual(["Loja vazia?", "Até 40%"]);
    expect(projeto.fontes[CHAVE_DA_NARRACAO].storage_path).toBe(r.narracao!.arquivo);
    expect(projeto.transcricoes[CHAVE_DA_NARRACAO].por_palavra).toBe(true);
  });

  it("arquivo de outro cliente não entra", () => {
    const r = roteiroPronto();
    const clipes = r.cenas.map((c) => ({ ordem: c.ordem, arquivo_id: arquivoId(c.ordem), nome: "x", tipo: "gerado", storage_bucket: "mesa", storage_path: `outro/${c.ordem}.mp4`, duracao_s: 5, largura: null, altura: null }));
    expect(() => projetoDoVideoDaCampanha({ clientId: CLIENTE, titulo: "x", roteiro: r, clipes, trilha: null })).toThrow(/fora do acervo/);
  });
});

describe("tela do Gerar vídeo", () => {
  it("roteiro: cenas editáveis e salvar pelo editar_item, sem custo", async () => {
    mock.invoke.mockImplementation(async (_f: string, o: { body: Record<string, unknown> }) => ({ data: { proposta: { id: PROPOSTA, itens: [] }, item: { ...peca(roteiroBase()), roteiro_video: { ...roteiroBase(), gancho: "Novo gancho" } } }, error: null }));
    montarTela(campanha(), peca(roteiroBase()));
    expect(screen.getByLabelText("Fala da cena 1")).toHaveProperty("value", "Sua loja vazia na Black Friday?");
    fireEvent.change(screen.getByLabelText("Fala da cena 2"), { target: { value: "Entra todo mundo" } });
    fireEvent.click(screen.getByRole("button", { name: /Salvar o roteiro/ }));
    await waitFor(() => expect(mock.invoke).toHaveBeenCalled());
    const corpo = corposDoCalendario()[0];
    expect(corpo).toMatchObject({ acao: "editar_item", proposta_id: PROPOSTA, tema_id: "t-video" });
    expect(((corpo.campos as { roteiro_video: RoteiroDeVideo }).roteiro_video.cenas[1]).fala).toBe("Entra todo mundo");
  });

  it("cenas: o 409 de todas as cenas somado antes, só gera com a confirmação e registra os pedidos na peça", async () => {
    let n = 0;
    mock.mesaVideos.mockImplementation(async (corpo: Record<string, unknown>) => {
      if (corpo.acao !== "gerar_video") return {};
      if (corpo.custo_confirmado_usd === undefined) throw new ErroDaMesa("confirmar_custo", "Confirme o custo antes de gerar.", { custo_estimado: { usd: 0.62, detalhe: "4 s" } });
      n += 1;
      return { ok: true, pedido_id: pedidoId(n) };
    });
    mock.invoke.mockImplementation(async () => ({ data: { item: peca(roteiroPronto()), proposta: { id: PROPOSTA, itens: [] } }, error: null }));
    montarTela(campanha(), peca(roteiroBase()));
    fireEvent.click(screen.getByRole("button", { name: /Cenas em vídeo/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Gerar 3 cenas/ }));
    const confirmar = await screen.findByRole("button", { name: /Confirmar US\$ 1,86/ });
    // Nada gerado ainda: só as três estimativas.
    const antes = mock.mesaVideos.mock.calls.map((x) => x[0] as Record<string, unknown>);
    expect(antes).toHaveLength(3);
    expect(antes.every((c) => c.custo_confirmado_usd === undefined)).toBe(true);
    fireEvent.click(confirmar);
    await waitFor(() => expect(corposDoCalendario().some((b) => b.operacao === "registrar")).toBe(true));
    const confirmados = mock.mesaVideos.mock.calls.map((x) => x[0] as Record<string, unknown>).filter((c) => c.custo_confirmado_usd !== undefined);
    expect(confirmados).toHaveLength(3);
    for (const c of confirmados) {
      expect(c).toMatchObject({ acao: "gerar_video", client_id: CLIENTE, motor: "seedance-2.0-mini", modo: "texto", formato: "9:16", audio: false, variacoes: 1, custo_confirmado_usd: 0.62 });
      expect(Number(c.duracao_s)).toBeGreaterThanOrEqual(4);
      expect(String(c.prompt)).toMatch(/Sem texto, legenda ou logotipo/);
    }
    // O uid da estimativa é o mesmo da confirmação (clicar duas vezes não gera duas).
    expect(confirmados.map((c) => c.uid)).toEqual(antes.map((c) => c.uid));
    const registro = corposDoCalendario().find((b) => b.operacao === "registrar")!;
    expect(registro).toMatchObject({ acao: "campanha_narracao", campanha_id: CAMP, tema_id: "t-video" });
    expect((registro.cenas as Array<{ ordem: number; pedido_id: string }>).map((c) => c.ordem)).toEqual([1, 2, 3]);
  });

  it("narração: a voz da marca, o custo antes e só gera com confirmado", async () => {
    mock.invoke.mockImplementation(async (_f: string, o: { body: Record<string, unknown> }) => {
      const b = o.body;
      if (b.operacao === "vozes") return { data: { tem_chave: true, vozes_da_marca: [{ voice_id: VOZ, nome: "Voz da loja", padrao: true }], vozes: [{ voice_id: "OutraVoz12345678", nome: "Bia" }], modelos: [], modelo_padrao: "eleven_v4" }, error: null };
      if (b.operacao === "gerar" && !b.confirmado) return { data: { error: "confirmar_custo", mensagem: "A narração custa cerca de US$ 0,01. Confirme para continuar.", custo_estimado_usd: 0.0064 }, error: null };
      return { data: { narracao: roteiroPronto().narracao, link: "https://assinado.test/n.mp3", item: peca(roteiroPronto()), proposta: { id: PROPOSTA, itens: [] }, avisos: [], custo_usd: 0.0064 }, error: null };
    });
    montarTela(campanha(), peca(roteiroBase()));
    fireEvent.click(screen.getByRole("button", { name: /Narração/ }));
    const voz = (await screen.findByLabelText("Voz da narração")) as HTMLSelectElement;
    await waitFor(() => expect(voz.value).toBe(VOZ));
    const estimativa = pedidoDaNarracao(roteiroBase(), "eleven_v4").custo_usd;
    expect(estimativa).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Gerar narração/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar US\$/ }));
    await screen.findByText(/em dia com as falas/);
    const gerar = corposDoCalendario().filter((b) => b.operacao === "gerar");
    expect(gerar).toHaveLength(2);
    expect(gerar[0].confirmado).toBeUndefined();
    expect(gerar[1]).toMatchObject({ acao: "campanha_narracao", campanha_id: CAMP, tema_id: "t-video", voz_id: VOZ, modelo: "eleven_v4", confirmado: true });
  });

  it("montar: versao_registrar com a voz e a trilha nos papéis certos e render_pedir render_final", async () => {
    const r = roteiroPronto();
    mock.pedidos = r.cenas.map((c) => ({ id: pedidoId(c.ordem), client_id: CLIENTE, estado: "pronto", parametros: { duracao_s: 5 }, resultado: { envios: [{ arquivo_id: arquivoId(c.ordem) }] } }));
    mock.arquivos = r.cenas.map((c) => ({ id: arquivoId(c.ordem), client_id: CLIENTE, nome: `Cena ${c.ordem}`, tipo: "gerado", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/gerados/${c.ordem}.mp4`, duracao_s: 5, largura: 720, altura: 1280, estado: "ativo" }));
    mock.mesaVideos.mockImplementation(async (corpo: Record<string, unknown>) => (corpo.acao === "versao_registrar" ? { versao: { id: VERSAO, projeto: { revisao: 0 } } } : {}));
    mock.editor.mockImplementation(async (corpo: Record<string, unknown>) => {
      if (corpo.acao === "render_pedir") return { pedido: { id: "r1", tipo: "render_final", estado: "fila", etapa: null, progresso: 0, entrada: null, resultado: null, erro_mensagem: null, criado_em: new Date().toISOString(), concluido_em: null, arquivo_id: null, url: null } };
      return { pedidos: [], worker: null };
    });
    mock.invoke.mockImplementation(async () => ({ data: { item: peca({ ...r, montagem: { versao_id: VERSAO, em: "" } }), proposta: { id: PROPOSTA, itens: [] } }, error: null }));
    const trilha = { arquivo: `${CLIENTE}/campanhas/${CAMP}/sons/t.mp3`, titulo: "Black Friday · A", duracao: 30, origem: "elevenlabs", som_id: "55555555-5555-5555-5555-555555555555" };
    montarTela(campanha({ trilha }), peca(r));
    const passos = screen.getByRole("navigation", { name: "Passos do vídeo gerado" });
    fireEvent.click(within(passos).getByRole("button", { name: /Montar/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Montar o vídeo/ }));
    await waitFor(() => expect(mock.editor.mock.calls.some((x) => (x[0] as Record<string, unknown>).acao === "render_pedir")).toBe(true));
    const registrar = mock.mesaVideos.mock.calls.map((x) => x[0] as Record<string, unknown>).find((c) => c.acao === "versao_registrar")!;
    expect(registrar).toMatchObject({ client_id: CLIENTE, estado: "rascunho" });
    const projeto = registrar.projeto as { trilhas: Array<{ tipo: string; clipes: Array<{ fonte: string | null; estilo: Record<string, unknown> | null; texto: string | null }> }>; formato: string };
    expect(projeto.formato).toBe("9:16");
    const audios = projeto.trilhas.filter((t) => t.tipo === "audio").reduce((l, t) => l.concat(t.clipes), [] as Array<{ fonte: string | null; estilo: Record<string, unknown> | null }>);
    expect(audios.filter((c) => c.estilo && c.estilo.papel === "voz").every((c) => c.fonte === CHAVE_DA_NARRACAO)).toBe(true);
    expect(audios.filter((c) => c.estilo && c.estilo.papel === "voz")).toHaveLength(2);
    expect(audios.filter((c) => c.estilo && c.estilo.papel === "trilha").map((c) => c.fonte)).toEqual([CHAVE_DA_TRILHA]);
    expect(projeto.trilhas.find((t) => t.tipo === "texto")!.clipes.map((c) => c.texto)).toEqual(["Loja vazia?", "Até 40%"]);
    const render_ = mock.editor.mock.calls.map((x) => x[0] as Record<string, unknown>).find((c) => c.acao === "render_pedir")!;
    expect(render_).toMatchObject({ client_id: CLIENTE, versao_id: VERSAO, tipo: "render_final", revisao: 0 });
    // A versão montada fica marcada na peça.
    const montagem = corposDoCalendario().find((b) => b.operacao === "registrar")!;
    expect(montagem).toMatchObject({ acao: "campanha_narracao", tema_id: "t-video", montagem: { versao_id: VERSAO } });
  });
});
