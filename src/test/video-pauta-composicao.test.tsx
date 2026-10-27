import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Vídeo de IA da pauta (27/10/2026). Dono: "está meio quebrado onde aparece 'gerando'... ele tem que puxar o
 * contexto e gerar a base, puxar automaticamente as imagens, criar a composição do vídeo e criar; aí tem a opção
 * de referências, antes e depois etc.; e buscar referências virais de vídeos gerados com IA e satisfatórios".
 * Cobre: estados claros da geração (tempo, motivo, tentar de novo sem cobrar duas vezes), montar pelo contexto
 * (foto real primeiro, uma por cena), referências com papel chegando ao pedido, busca viral com link conferido
 * e "usar" virando cenas, e o "só subir o vídeo" a um clique. Banco, funções e Storage simulados.
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  chamarMesaVideos: vi.fn(),
  subirVideos: vi.fn(),
  pedidos: [] as unknown[],
  arquivos: [] as unknown[],
  fotos: [] as unknown[],
  tabelas: {} as Record<string, unknown>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "overlaps", "gte", "lt", "lte", "gt", "order", "limit", "range", "update"]) b[m] = () => b;
    const um = () => Promise.resolve({ data: Array.isArray(dados) ? dados[0] || null : dados, error: null });
    b.maybeSingle = um;
    b.single = um;
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null }).then(ok, erro);
    return b;
  };
  const storage = { from: () => ({ createSignedUrl: (c: string) => Promise.resolve({ data: { signedUrl: `https://arquivos.test/${c}` }, error: null }), upload: () => Promise.resolve({ data: {}, error: null }), download: () => Promise.resolve({ data: new Blob(["x"], { type: "image/png" }), error: null }) }) };
  return { supabase: { functions: { invoke: mock.invoke }, rpc: vi.fn(async () => ({ data: { ok: true }, error: null })), from: (t: string) => consulta(t), storage } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));
vi.mock("@/components/mesa-videos/videosApi", async (original) => {
  const real = (await original()) as Record<string, unknown>;
  return {
    ...real,
    usePedidos: () => ({ data: { itens: mock.pedidos, disponivel: true }, refetch: vi.fn(), isError: false }),
    useArquivosDeVideo: () => ({ data: { arquivos: mock.arquivos, degradado: false }, refetch: vi.fn(), isError: false }),
    useVersoes: () => ({ data: { itens: [], disponivel: true }, refetch: vi.fn(), isError: false }),
    subirVideos: (...a: unknown[]) => mock.subirVideos(...a),
    chamarMesaVideos: (...a: unknown[]) => mock.chamarMesaVideos(...a),
  };
});
vi.mock("@/components/mesa-foto/fotoApi", async (original) => {
  const real = (await original()) as Record<string, unknown>;
  return { ...real, useFotos: () => ({ data: mock.fotos, isLoading: false }) };
});
vi.mock("@/lib/mesa-videos/api", async (original) => {
  const real = (await original()) as Record<string, any>;
  const lista = real.MOTORES_DE_VIDEO.map((m: any) => ({ motor: m, estado: m.situacao ? m.situacao : "pronto", estado_rotulo: "Pronto", nivel: m.linha === "fast" ? "rapido" : "normal", novo: false, chave: null }));
  return { ...real, useMotoresDaMesa: () => ({ lista, motores: real.MOTORES_DE_VIDEO, carregando: false, semFuncao: false, recarregar: () => undefined }) };
});

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import { ErroDaMesa } from "@/lib/mesa/api";
import EstudioDeVideoDaPauta from "@/components/mesa/EstudioDeVideoDaPauta";
import GeracoesDaPauta from "@/components/mesa/GeracoesDaPauta";
import { corpoDeTentarDeNovo, motivoLegivel, podeTentarDeNovo, situacaoDoPedido, tempoTipicoS } from "@/components/mesa/estadoDaGeracao";
import {
  arquivosDeCena,
  cenasQueFaltam,
  comReferencias,
  composicaoDaReferenciaViral,
  estadoDasCenas,
  montarComposicao,
  pedidosDaComposicao,
  rodadasPedidas,
  roteiroDaComposicao,
  type ReferenciaDoVideo,
} from "@/components/mesa/composicaoDoVideo";
import { situacaoDoVideo } from "@/components/mesa/videoDaPauta";
import { extrasDaComposicao, movimentoDoTexto } from "../../supabase/functions/mesa-videos/modulos/composicao-no-pedido";
import { ESQUEMA_DAS_REFERENCIAS_VIRAIS, chaveDoLink, pedidoDaBuscaViral, referenciasComFonte } from "../../supabase/functions/agente-calendario/modulos/referencias-virais-de-video";
import { MOTORES_DE_VIDEO } from "../../supabase/functions/mesa-videos/modulos/modelos-de-video";
import { CHAMADAS_SEM_METODO, SEM_METODO_DE_PROPOSITO } from "../../supabase/indice/motores";

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!(globalThis as any).ResizeObserver) (globalThis as any).ResizeObserver = ObservadorFalso;

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const TAREFA = "66666666-6666-4666-8666-666666666666";
const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const foto = (id: string, nome: string, extra: Record<string, unknown> = {}) => ({
  id, client_id: CLIENTE, nome, storage_bucket: "mesa", storage_path: `${CLIENTE}/fotos/${id}.jpg`, origem: "upload", pasta: null, categoria: "produto", tags: ["foto_real"], descricao: null,
  ativa: true, derivada_de: null, gerada: false, modo: null, kit_id: null, aprovada: true, largura: 1080, altura: 1920, criado_em: "2026-10-20T10:00:00Z", referencia_web: false, ...extra,
});

const MIDIA = {
  tipo: "video", fonte: "acervo", acervo: [{ id: "f-cozinha", nome: "Cozinha pronta", nota: 2.8 }, { id: "f-bancada", nome: "Bancada de mármore", nota: 2.3 }], web: [],
  gancho: "A cozinha que ninguém acreditava", cenas: ["Close lento na bancada de mármore", "Travelling lateral pela cozinha inteira", "Revela a sala integrada", "Fechamento com a família"],
  narracao: null, porque: null, resumo: "2 fotos do Workspace", pedido: null, gerada_em: "2026-10-27T10:00:00Z",
};

const pauta = (extra: Record<string, unknown> = {}) => ({ id: TAREFA, title: "Cozinha planejada", due_date: "2030-11-10", delivery_type: "reels", status: "todo", project_id: "77777777-7777-4777-8777-777777777777", modo_estudio: "video", caminho_video: "ia", midia: MIDIA, video: { estilo: "produto", prompt: "x", referencias: [], narracao: "", formato: "9:16" }, ...extra }) as any;

const pedido = (id: string, estado: string, extra: Record<string, unknown> = {}, envios: unknown[] = []) => ({
  id, client_id: CLIENTE, tipo: "gerar_livre", executor: "seedance-2.0-mini", estado, criado_em: new Date(Date.now() - 60_000).toISOString(), custo_estimado: { usd: 0.3 },
  alvo: { motor: "seedance-2.0-mini", modo: "primeiro_quadro", titulo: "Cozinha planejada · cena 1" },
  parametros: { task_id: TAREFA, prompt: "Cena 1", duracao_s: 5, formato: "9:16", resolucao: "720p", audio: false, variacoes: 1, quadro_inicial_path: `${CLIENTE}/fotos/f-cozinha.jpg`, quadro_final_path: null, referencias_paths: [], ...extra },
  resultado: { envios },
});

const mesa = (): MesaValor => ({
  clientId: CLIENTE, clientName: "Cliente Teste", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 50,
  catalogo: [{ id: "openai/gpt-teste", nome: "Teste", rotulo: "Teste", tipo: "texto", provedor: "openai", ativo: true, preco_entrada_1m: 1, preco_saida_1m: 4, padrao_para: ["estrategista", "diretor_arte"] }],
  catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(),
}) as unknown as MesaValor;

const montar = (filho: unknown) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(TooltipProvider, null, h(MesaProvider, { valor: mesa(), children: filho as any })))));
  return qc;
};

beforeEach(() => {
  vi.clearAllMocks();
  mock.pedidos = [];
  mock.arquivos = [];
  mock.fotos = [foto("f-cozinha", "Cozinha pronta"), foto("f-bancada", "Bancada de mármore"), foto("f-web", "Foto da internet", { referencia_web: true })];
  mock.tabelas = {};
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
  mock.invoke.mockImplementation(async (_n: string, o: any) => {
    const acao = o && o.body ? o.body.acao : "";
    if (acao === "estimar") return { data: { estimativa_usd: 0.02, custo_usd: 0 }, error: null };
    return { data: { ok: true, custo_usd: 0 }, error: null };
  });
  mock.chamarMesaVideos.mockResolvedValue({ ok: true });
});

// ------------------------------------------------------------------ estados da geração

describe("estados da geração: claros, com tempo, motivo e tentar de novo", () => {
  it("na fila com posição, gerando com o tempo que falta, atrasado quando passa do típico, pronto e guardando", () => {
    const agora = Date.now();
    const fila = situacaoDoPedido(pedido("p1", "enviado", {}, [{ n: 1, estado: "enviado", posicao: 3 }]) as any, agora, { prazo_min: 30 });
    expect(fila.situacao).toBe("na_fila");
    expect(fila.detalhe).toMatch(/Posição 3 no provedor · falta cerca de \d+ min/);
    const gerando = situacaoDoPedido(pedido("p2", "gerando") as any, agora, { prazo_min: 30 });
    expect(gerando).toEqual(expect.objectContaining({ situacao: "gerando", atrasado: false }));
    expect(gerando.detalhe).toMatch(/^Falta cerca de \d+ min$/);
    const velho = { ...pedido("p3", "gerando"), criado_em: new Date(agora - 20 * 60_000).toISOString() };
    const atrasado = situacaoDoPedido(velho as any, agora, { prazo_min: 30 });
    expect(atrasado.atrasado).toBe(true);
    expect(atrasado.detalhe).toMatch(/Demorando mais que o normal/);
    expect(situacaoDoPedido(pedido("p4", "baixando") as any, agora).rotulo).toBe("Guardando");
    expect(situacaoDoPedido(pedido("p5", "pronto", {}, [{ n: 1, estado: "pronto", arquivo_id: "a1" }]) as any, agora).situacao).toBe("pronto");
    expect(tempoTipicoS({ prazo_min: 10 }, 5)).toBe(60);
    expect(tempoTipicoS({ prazo_min: 30 }, 10)).toBe(270);
  });

  it("falhou com o motivo em português; tentar de novo repete o pedido com a composição, os papéis e a chave tentar-<pedido>", () => {
    const erro = pedido("p-erro", "erro", { composicao: { id: "v1", cena_id: "c1", ordem: 1, total: 3 }, referencias_papeis: [{ papel: "antes", nome: "a.jpg", caminho: `${CLIENTE}/q/a.png`, tipo: "imagem" }] }, [{ n: 1, estado: "erro", erro: "Content policy violation: flagged" }]);
    const l = situacaoDoPedido(erro as any, Date.now());
    expect(l).toEqual(expect.objectContaining({ situacao: "falhou", rotulo: "Falhou" }));
    expect(l.detalhe).toMatch(/política de conteúdo/);
    expect(motivoLegivel("")).toBe("O provedor não explicou o motivo.");
    expect(motivoLegivel("timeout waiting")).toMatch(/demorou demais/);
    expect(podeTentarDeNovo(erro as any)).toBe(true);
    const corpo = corpoDeTentarDeNovo(erro as any) as Record<string, any>;
    expect(corpo).toEqual(expect.objectContaining({ acao: "gerar_video", tipo: "gerar_livre", motor: "seedance-2.0-mini", modo: "primeiro_quadro", task_id: TAREFA, uid: "tentar-p-erro", variacoes: 1 }));
    expect(corpo.composicao).toEqual({ id: "v1", cena_id: "c1", ordem: 1, total: 3 });
    expect(corpo.referencias_papeis[0].papel).toBe("antes");
    // Sem custo confirmado: o servidor devolve o custo antes (409) e nada é gerado.
    expect(corpo.custo_confirmado_usd).toBeUndefined();
    // Parte pronta: só as variações que falharam.
    const parcial = { ...pedido("p-parcial", "parcial", { variacoes: 3 }, [{ n: 1, estado: "pronto", arquivo_id: "a" }, { n: 2, estado: "erro", erro: "x" }, { n: 3, estado: "erro", erro: "x" }]) };
    expect((corpoDeTentarDeNovo(parcial as any) as any).variacoes).toBe(2);
    // Avatar e foto que fala não passam pelo gerar_video.
    expect(podeTentarDeNovo({ ...erro, alvo: { modo: "avatar" } } as any)).toBe(false);
    expect(podeTentarDeNovo(pedido("p-ok", "pronto") as any)).toBe(false);
  });

  it("Tentar de novo na tela: mostra o motivo, pede o custo (409), confirma e manda com o custo e a mesma chave", async () => {
    const erro = pedido("p-erro", "erro", {}, [{ n: 1, estado: "erro", erro: "Content policy violation" }]);
    mock.chamarMesaVideos.mockImplementation(async (corpo: any) => {
      if (corpo.acao === "gerar_video" && corpo.custo_confirmado_usd === undefined) throw new ErroDaMesa("confirmar_custo", "Confirme o custo.", { custo_estimado: { usd: 0.31 } });
      return { ok: true, pedido_id: "p-novo" };
    });
    montar(h(GeracoesDaPauta, { pedidos: [erro] as any, titulo: "Gerações desta pauta" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Falhou/);
    expect(screen.getByText(/política de conteúdo/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    const confirmar = await screen.findByRole("button", { name: /Confirmar US\$ 0,31/ });
    expect(screen.getByText(/A tentativa que falhou não foi cobrada/)).toBeTruthy();
    fireEvent.click(confirmar);
    await waitFor(() => expect(mock.chamarMesaVideos.mock.calls.some((c: any[]) => c[0].custo_confirmado_usd === 0.31)).toBe(true));
    const enviados = mock.chamarMesaVideos.mock.calls.map((c: any[]) => c[0]).filter((c: any) => c.acao === "gerar_video");
    expect(enviados.every((c: any) => c.uid === "tentar-p-erro")).toBe(true);
  });

  it("enquanto gera, confere sozinho só os pedidos desta pauta (gerar_status), sem gerar de novo", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      montar(h(GeracoesDaPauta, { pedidos: [pedido("p-andando", "gerando")] as any, compacta: true }));
      expect(screen.getByText(/Falta cerca de/)).toBeTruthy();
      await vi.advanceTimersByTimeAsync(21_000);
      await waitFor(() => expect(mock.chamarMesaVideos).toHaveBeenCalledWith({ acao: "gerar_status", pedido_id: "p-andando" }));
      expect(mock.chamarMesaVideos.mock.calls.some((c: any[]) => c[0].acao === "gerar_video")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ------------------------------------------------------------------ montar pelo contexto

describe("montar pelo contexto: fotos reais primeiro, uma por cena; sem foto, a IA cria a base", () => {
  it("as fotos da mídia (nota do Jev) entram em ordem; a cena sem foto fica com a base da IA; o gancho abre", () => {
    const c = montarComposicao({ item: pauta(), clientId: CLIENTE, fotos: mock.fotos as any, agora: "2026-10-27T10:00:00Z", id: "v1" });
    expect(c.cenas).toHaveLength(4);
    expect(c.cenas.map((x) => x.imagem && x.imagem.id)).toEqual(["f-cozinha", "f-bancada", null, null]);
    expect(c.cenas[0].texto).toBe("A cozinha que ninguém acreditava");
    expect(c.cenas.slice(1).every((x) => !x.texto)).toBe(true);
    // O movimento sai do texto da cena.
    expect(c.cenas.map((x) => x.movimento)).toEqual(["Aproximação lenta", "Deslocamento lateral suave", "Revelação do ambiente", "Revelação do ambiente"]);
    // A foto que é referência da internet nunca entra; foto real do Estúdio entra depois das da mídia.
    const so = montarComposicao({ item: pauta({ midia: null }), clientId: CLIENTE, fotos: mock.fotos as any, fotoReal: ["f-web", "f-bancada"] });
    expect(so.cenas[0].imagem && so.cenas[0].imagem.id).toBe("f-bancada");
    expect(so.cenas.length).toBe(3);
    expect(movimentoDoTexto("drone de cima")).toBe("Plano de cima");
  });

  it("na tela: Montar pelo contexto (mídia já pensada, sem custo) monta as cenas com as fotos; só subir o vídeo continua a um clique", async () => {
    montar(h(EstudioDeVideoDaPauta, { item: pauta() }));
    fireEvent.click(await screen.findByRole("button", { name: /Montar pelo contexto/ }));
    const cenas = await screen.findByRole("list", { name: "Cenas da composição" });
    expect(within(cenas).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Trocar a imagem da cena 1" }).getAttribute("title")).toMatch(/Cozinha pronta/);
    expect(screen.getByRole("button", { name: "Trocar a imagem da cena 3" }).getAttribute("title")).toMatch(/IA cria a base/);
    expect((screen.getByLabelText("Gancho do vídeo") as HTMLInputElement).value).toBe("A cozinha que ninguém acreditava");
    // Nenhuma chamada paga para montar com a mídia que já existe.
    expect(mock.invoke.mock.calls.some((c: any[]) => c[1] && c[1].body && c[1].body.acao === "midia_da_peca")).toBe(false);
    // Mexer com cliques: descer a cena 1 troca a ordem.
    fireEvent.click(screen.getByRole("button", { name: "Descer a cena 1" }));
    expect(screen.getByRole("button", { name: "Trocar a imagem da cena 2" }).getAttribute("title")).toMatch(/Cozinha pronta/);
    // O botão de gerar mostra o custo antes.
    expect(screen.getByRole("button", { name: /^Gerar vídeo.*US\$/ }).textContent).toMatch(/US\$/);
    // Só subir: o envio do vídeo gravado segue na peça.
    expect(screen.getByRole("button", { name: /Vídeo gravado da peça: enviar do computador/ })).toBeTruthy();
  });

  it("Gerar manda um pedido por cena com o custo de cada uma, a composição e a chave estável", async () => {
    mock.chamarMesaVideos.mockImplementation(async (corpo: any) => (corpo.acao === "gerar_video" ? { ok: true, pedido_id: `p-${corpo.composicao.ordem}` } : { ok: true }));
    montar(h(EstudioDeVideoDaPauta, { item: pauta() }));
    fireEvent.click(await screen.findByRole("button", { name: /Montar pelo contexto/ }));
    await screen.findByRole("list", { name: "Cenas da composição" });
    fireEvent.click(screen.getByRole("button", { name: /^Gerar vídeo.*US\$/ }));
    const confirmacao = await screen.findByRole("group", { name: "Confirmar o custo" });
    fireEvent.click(within(confirmacao).getAllByRole("button").find((b) => /Confirmar|Gerar/.test(b.textContent || "")) as HTMLElement);
    await waitFor(() => expect(mock.chamarMesaVideos.mock.calls.filter((c: any[]) => c[0].acao === "gerar_video").length).toBe(4));
    const corpos = mock.chamarMesaVideos.mock.calls.map((c: any[]) => c[0]).filter((c: any) => c.acao === "gerar_video");
    expect(corpos.map((c: any) => c.modo)).toEqual(["primeiro_quadro", "primeiro_quadro", "texto", "texto"]);
    expect(corpos.every((c: any) => c.task_id === TAREFA && typeof c.custo_confirmado_usd === "number" && c.composicao.total === 4)).toBe(true);
    expect(corpos[0].quadro_inicial_path).toBe(`${CLIENTE}/fotos/f-cozinha.jpg`);
    expect(new Set(corpos.map((c: any) => c.uid)).size).toBe(4);
    expect(corpos[0].uid).toMatch(/^v[a-z0-9]+:c[a-z0-9]+:0:0$/);
  });
});

// ------------------------------------------------------------------ referências com papel

describe("referências com papel chegam ao pedido", () => {
  const refs: ReferenciaDoVideo[] = [
    { id: "r-antes", papel: "antes", tipo: "imagem", nome: "jardim-antes.jpg", bucket: "mesa", caminho: `${CLIENTE}/video/quadros/antes.png` },
    { id: "r-depois", papel: "depois", tipo: "imagem", nome: "jardim-depois.jpg", bucket: "mesa", caminho: `${CLIENTE}/video/quadros/depois.png` },
    { id: "r-mov", papel: "movimento", tipo: "video", nome: "drone.mp4", bucket: "mesa", caminho: `${CLIENTE}/video/brutos/drone.mp4` },
    { id: "r-prod", papel: "produto", tipo: "imagem", nome: "vaso.png", bucket: "mesa", caminho: `${CLIENTE}/video/quadros/vaso.png` },
  ];

  it("antes e depois viram a cena de transformação na abertura (primeiro e último quadro); produto preenche a cena sem imagem; movimento vai no prompt", () => {
    const c = comReferencias(montarComposicao({ item: pauta(), clientId: CLIENTE, fotos: mock.fotos as any, id: "v2" }), refs);
    expect(c.cenas[0]).toEqual(expect.objectContaining({ transformacao: true, movimento: "Câmera fixa", texto: "A cozinha que ninguém acreditava" }));
    expect(c.cenas[0].imagem && c.cenas[0].imagem.caminho).toBe(refs[0].caminho);
    expect(c.cenas[0].final && c.cenas[0].final.caminho).toBe(refs[1].caminho);
    expect(c.cenas.find((x) => x.imagem && x.imagem.id === "r-prod")).toBeTruthy();
    const p = pedidosDaComposicao(c, { clientId: CLIENTE, tema: "Jardim", motores: MOTORES_DE_VIDEO, nivel: "normal" });
    expect(p.motivo).toBeNull();
    const abertura = p.itens[0].corpo as any;
    expect(abertura.modo).toBe("primeiro_ultimo");
    expect(abertura.quadro_inicial_path).toBe(refs[0].caminho);
    expect(abertura.quadro_final_path).toBe(refs[1].caminho);
    expect(abertura.prompt).toMatch(/Transformação contínua do primeiro quadro \(antes\) ao último \(depois\)/);
    expect(abertura.prompt).toMatch(/estilo da referência "drone\.mp4"/);
    expect(abertura.referencias_papeis.map((r: any) => r.papel)).toEqual(["antes", "depois", "movimento", "produto"]);
    expect(abertura.composicao).toEqual({ id: "v2", cena_id: c.cenas[0].id, ordem: 1, total: c.cenas.length });
    expect(p.itens.every((i) => i.motor.cap.ultimo_quadro || (i.corpo as any).modo !== "primeiro_ultimo")).toBe(true);
    expect(p.custo.usd).toBeGreaterThan(0);
    // Tirar o antes tira a transformação e devolve o gancho à primeira cena.
    const sem = comReferencias(c, refs.filter((r) => r.papel !== "antes"));
    expect(sem.cenas.some((x) => x.transformacao)).toBe(false);
    expect(sem.cenas[0].texto).toBe("A cozinha que ninguém acreditava");
  });

  it("o servidor guarda no pedido só a composição válida e as referências da pasta do cliente com papel conhecido", () => {
    const extras = extrasDaComposicao({
      composicao: { id: "v2", cena_id: "c1", ordem: 1, total: 3 },
      referencias_papeis: [
        { papel: "antes", nome: "a", caminho: `${CLIENTE}/q/a.png` },
        { papel: "depois", nome: "b", caminho: "outro-cliente/q/b.png" },
        { papel: "estrela", nome: "c", caminho: `${CLIENTE}/q/c.png` },
        { papel: "movimento", nome: "d", caminho: `${CLIENTE}/../x.mp4`, tipo: "video" },
      ],
    }, CLIENTE);
    expect(extras).toEqual({ composicao: { id: "v2", cena_id: "c1", ordem: 1, total: 3 }, referencias_papeis: [{ papel: "antes", nome: "a", caminho: `${CLIENTE}/q/a.png`, tipo: "imagem" }] });
    expect(extrasDaComposicao({ composicao: { id: "v2", cena_id: "c1", ordem: 4, total: 3 } }, CLIENTE)).toEqual({});
    const geracao = ler("supabase/functions/mesa-videos/geracao.ts");
    expect(geracao).toContain("...extrasDaComposicao(corpo, clientId)");
  });
});

// ------------------------------------------------------------------ busca viral

describe("buscar referências virais: cartões com link conferido e usar vira cenas", () => {
  const resposta = {
    referencias: [
      { titulo: "Cozinha que se monta sozinha (IA)", link: "https://www.tiktok.com/@estudio/video/123?utm_source=x", tipo: "ia", porque_funciona: "Loop perfeito e transformação em 3 s.", gancho: "Cômodo vazio que se enche", sinal: "4,1 mi de views", estrutura: [{ o_que: "Cômodo vazio em plano geral", movimento: "câmera fixa", segundos: 3 }, { o_que: "Móveis surgem peça por peça", movimento: "zoom in lento", segundos: 8 }, { o_que: "Resultado final girando", movimento: "orbit", segundos: 4 }] },
      { titulo: "Inventado", link: "https://www.instagram.com/reel/naocitado/", tipo: "satisfatorio", porque_funciona: "x", gancho: "x", sinal: "", estrutura: [{ o_que: "y", movimento: "fixa", segundos: 3 }] },
      { titulo: "Repetido", link: "https://www.tiktok.com/@estudio/video/123/", tipo: "ia", porque_funciona: "x", gancho: "x", sinal: "", estrutura: [{ o_que: "y", movimento: "fixa", segundos: 3 }] },
    ],
  };

  it("só entra o vídeo cujo link a busca citou, sem repetir; o movimento vira a lista da tela; o esquema é estrito", () => {
    const fontes = ["https://www.tiktok.com/@estudio/video/123", "https://outra.com/materia"];
    const cartoes = referenciasComFonte(resposta, fontes);
    expect(cartoes).toHaveLength(1);
    expect(cartoes[0]).toEqual(expect.objectContaining({ plataforma: "tiktok", tipo: "ia", sinal: "4,1 mi de views" }));
    expect(cartoes[0].estrutura.map((b) => b.movimento)).toEqual(["Câmera fixa", "Aproximação lenta", "Órbita lenta"]);
    expect(referenciasComFonte(resposta, [])).toEqual([]);
    expect(referenciasComFonte(resposta, fontes, "satisfatorio")).toEqual([]);
    expect(chaveDoLink("https://A.com/x/?igsh=1&id=2#t")).toBe("https://a.com/x?id=2");
    const s = ESQUEMA_DAS_REFERENCIAS_VIRAIS.schema;
    expect(s.additionalProperties).toBe(false);
    expect(s.properties.referencias.items.required).toEqual(["titulo", "link", "tipo", "porque_funciona", "gancho", "sinal", "estrutura"]);
    const pedido = pedidoDaBuscaViral({ hoje: "2026-10-27", foco: "satisfatorio", nicho: "móveis planejados", tema: "Cozinha planejada", hype: "Black Friday", ganchos: "G1" });
    expect(pedido).toMatch(/satisfatórios/);
    expect(pedido).toMatch(/Nada inventado: vídeo sem link real da busca não entra/);
    expect(pedido).toMatch(/pela FORMA/);
  });

  it("usar como referência: as batidas viram as cenas, com as imagens do cliente na mesma ordem e o assunto da pauta", () => {
    const base = montarComposicao({ item: pauta(), clientId: CLIENTE, fotos: mock.fotos as any, id: "v3" });
    const [cartao] = referenciasComFonte(resposta, ["https://www.tiktok.com/@estudio/video/123"]);
    const c = composicaoDaReferenciaViral(base, cartao, "Cozinha planejada");
    expect(c.origem).toBe("viral");
    expect(c.viral).toEqual({ titulo: cartao.titulo, link: cartao.link });
    expect(c.cenas).toHaveLength(3);
    expect(c.cenas.map((x) => x.imagem && x.imagem.id)).toEqual(["f-cozinha", "f-bancada", null]);
    expect(c.cenas[0].descricao).toBe("Cômodo vazio em plano geral. Assunto: Cozinha planejada");
    expect(c.cenas.map((x) => x.duracao_s)).toEqual([5, 10, 5]);
    expect(c.cenas[0].texto).toBe(base.gancho);
  });

  it("na tela: busca com o custo antes, mostra o cartão e Usar troca as cenas", async () => {
    mock.invoke.mockImplementation(async (_n: string, o: any) => {
      const acao = o && o.body ? o.body.acao : "";
      if (acao === "estimar") return { data: { estimativa_usd: 0.02, custo_usd: 0 }, error: null };
      if (acao === "video_referencias_virais") return { data: { referencias: referenciasComFonte(resposta, ["https://www.tiktok.com/@estudio/video/123"]), foco: "ambos", custo_usd: 0.03 }, error: null };
      return { data: { ok: true, custo_usd: 0 }, error: null };
    });
    montar(h(EstudioDeVideoDaPauta, { item: pauta() }));
    fireEvent.click(await screen.findByRole("button", { name: /Montar pelo contexto/ }));
    await screen.findByRole("list", { name: "Cenas da composição" });
    const titulo = screen.getByRole("button", { name: /Referências virais/ });
    if (titulo.getAttribute("aria-expanded") === "false") fireEvent.click(titulo);
    const buscar = await screen.findByRole("button", { name: /Buscar referências virais/ });
    fireEvent.click(buscar);
    await new Promise((r) => setTimeout(r, 400));
    if (!mock.invoke.mock.calls.some((c: any[]) => c[1] && c[1].body && c[1].body.acao === "video_referencias_virais")) fireEvent.click(buscar);
    await waitFor(() => expect(mock.invoke.mock.calls.some((c: any[]) => c[1] && c[1].body && c[1].body.acao === "video_referencias_virais" && c[1].body.task_id === TAREFA)).toBe(true));
    const usar = await screen.findByRole("button", { name: /Usar como referência: Cozinha que se monta sozinha/ });
    expect(screen.getByRole("link", { name: /Abrir Cozinha que se monta sozinha/ }).getAttribute("href")).toMatch(/^https:\/\/www\.tiktok\.com/);
    fireEvent.click(usar);
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Cenas da composição" })).getAllByRole("listitem")).toHaveLength(3));
    expect(screen.getByRole("button", { name: /Em uso: Cozinha que se monta sozinha/ })).toBeTruthy();
  });

  it("a busca está registrada no índice dos motores com o porquê e a ação é longa no agente-calendario", () => {
    expect(CHAMADAS_SEM_METODO["agente-calendario/index.ts#buscarReferenciasVirais"]).toBe("videos.referencias_virais");
    expect(SEM_METODO_DE_PROPOSITO["videos.referencias_virais"]).toBeTruthy();
    const fonte = ler("supabase/functions/agente-calendario/index.ts");
    expect(fonte).toContain("video_referencias_virais: videoReferenciasVirais,");
    expect(fonte).toMatch(/"midia_da_peca", "video_referencias_virais"/);
    expect(fonte).toContain("referenciasComFonte(r.json, r.fontes, foco)");
  });
});

// ------------------------------------------------------------------ montagem e peça

describe("cenas prontas viram um vídeo só; a cena solta não vira o vídeo da peça", () => {
  it("andamento por cena, o que falta gerar, o roteiro da montagem e os arquivos de cena", () => {
    const c = montarComposicao({ item: pauta(), clientId: CLIENTE, fotos: mock.fotos as any, id: "v4" });
    const comp = (k: number) => ({ composicao: { id: "v4", cena_id: c.cenas[k].id, ordem: k + 1, total: 4 } });
    const pedidos = [
      { ...pedido("q1", "pronto", comp(0), [{ n: 1, estado: "pronto", arquivo_id: "a1" }]), chave: `gerar_livre:v4:${c.cenas[0].id}:0:0` },
      { ...pedido("q2", "gerando", comp(1)), chave: `gerar_livre:v4:${c.cenas[1].id}:0:0` },
      { ...pedido("q3", "erro", comp(2), [{ n: 1, estado: "erro", erro: "x" }]), chave: `gerar_livre:v4:${c.cenas[2].id}:0:0` },
    ];
    const arquivos = [{ id: "a1", client_id: CLIENTE, nome: "c1.mp4", nome_original: "c1.mp4", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/c1.mp4`, estado: "ativo", tipo: "gerado", pedido_id: "q1", duracao_s: 5.04, criado_em: "2026-10-27T10:00:00Z" }];
    const estados = estadoDasCenas(c, pedidos as any, arquivos as any);
    expect(estados.map((e) => e.tipo)).toEqual(["pronta", "andando", "falhou", "sem_pedido"]);
    expect(cenasQueFaltam(c, estados, rodadasPedidas(c, pedidos as any))).toEqual([c.cenas[2].id, c.cenas[3].id]);
    // Refazer a cena pronta (rodada nova) entra no próximo Gerar.
    const refeita = { ...c, cenas: c.cenas.map((x, k) => (k === 0 ? { ...x, rodada: 1 } : x)) };
    expect(cenasQueFaltam(refeita, estados, rodadasPedidas(refeita, pedidos as any))).toContain(c.cenas[0].id);
    const roteiro = roteiroDaComposicao(c, estados);
    expect(roteiro.cenas[0]).toEqual(expect.objectContaining({ ordem: 1, fala: "", texto_na_tela: c.gancho, segundos: 5.04 }));
    const deCena = arquivosDeCena(pedidos as any, arquivos as any);
    expect(deCena.has("a1")).toBe(true);
    // A peça não fica Pronta com a cena solta; só com o vídeo final montado.
    expect(situacaoDoVideo({ video_pronto: null }, null, (arquivos as any[]).filter((a) => !deCena.has(a.id))).estado).toBe("a_fazer");
  });

  it("a tela monta sozinha quando todas as cenas ficam prontas (versão na Edição e render final, sem custo de IA)", () => {
    const fonte = ler("src/components/mesa/ComposicaoDoVideoDaPauta.tsx");
    expect(fonte).toContain('acao: "versao_registrar"');
    expect(fonte).toContain('tipo: "render_final"');
    expect(fonte).toContain("projetoDoVideoDaCampanha(");
    const estudio = ler("src/components/mesa/EstudioDeVideoDaPauta.tsx");
    expect(estudio).toContain("geracoes={paraAPeca}");
    expect(estudio).toContain("<GeracoesDaPauta pedidos={pedidos} compacta");
    // A aba de gerações não pergunta em dobro ao provedor.
    expect(estudio).toContain("conferirSozinho={false}");
  });
});

// ------------------------------------------------------------------ tela com a composição guardada

describe("composição guardada com cena pronta, gerando e falha", () => {
  it("abre sem travar: cada cena diz o estado e a prancheta mostra o que gera e o que falhou", async () => {
    const { gravarEstadoDaTela } = await import("@/components/sistema/useEstadoDaTela");
    const { chaveDoEstudioDaPauta } = await import("@/components/mesa/modoDaPauta");
    const c = montarComposicao({ item: pauta(), clientId: CLIENTE, fotos: mock.fotos as any, id: "vdemo" });
    gravarEstadoDaTela(chaveDoEstudioDaPauta(CLIENTE, TAREFA, "composicao"), c);
    const comp = (k: number) => ({ composicao: { id: "vdemo", cena_id: c.cenas[k].id, ordem: k + 1, total: 4 } });
    mock.pedidos = [
      { ...pedido("p0", "pronto", comp(0), [{ n: 1, estado: "pronto", arquivo_id: "a1" }]), chave: `gerar_livre:vdemo:${c.cenas[0].id}:0:0` },
      { ...pedido("p1", "gerando", comp(1)), chave: `gerar_livre:vdemo:${c.cenas[1].id}:0:0` },
      { ...pedido("p2", "erro", comp(2), [{ n: 1, estado: "erro", erro: "Content policy violation" }]), chave: `gerar_livre:vdemo:${c.cenas[2].id}:0:0` },
    ];
    mock.arquivos = [{ id: "a1", client_id: CLIENTE, nome: "c1.mp4", nome_original: "c1.mp4", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/c1.mp4`, estado: "ativo", tipo: "gerado", pedido_id: "p0", duracao_s: 5, criado_em: "2026-10-27T10:00:00Z" }];
    montar(h(EstudioDeVideoDaPauta, { item: pauta() }));
    const cenas = await screen.findByRole("list", { name: "Cenas da composição" });
    const itens = within(cenas).getAllByRole("listitem");
    expect(itens.map((li) => li.getAttribute("data-estado-da-cena"))).toEqual(["pronta", "andando", "falhou", "sem_pedido"]);
    expect(document.querySelector('[data-pedido-na-prancheta="gerando"]')).toBeTruthy();
    expect(document.querySelector('[data-pedido-na-prancheta="falhou"]')).toBeTruthy();
    // A cena solta não vira o vídeo da peça: a peça segue A fazer.
    expect(document.querySelector('[data-estado-do-video="a_fazer"]')).toBeTruthy();
    // Gerar agora só pede as que faltam (a que falhou e a que não foi gerada).
    expect(screen.getByRole("button", { name: /^Gerar 2 cenas/ })).toBeTruthy();
  });
});
