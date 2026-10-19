import { createElement as h } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 19/10/2026 (dono: "na edição escolher outro vídeo para editar, no momento
 * não permite, corrija e melhore"). A etapa Editar abria sempre a última
 * versão do cliente e a montagem saía de todos os vídeos da Entrada: não havia
 * como pôr outro vídeo no editor. Aqui: trocar mantendo deixa a edição antiga
 * nas versões; trocar descartando limpa a edição antiga (com Desfazer); as
 * edições recentes alternam entre os vídeos; e a janela pergunta antes.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), tabelas: {} as Record<string, unknown[]> }));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "order", "limit", "range"]) b[m] = () => b;
    b.then = (ok: any, falha: any) => Promise.resolve({ data: mock.tabelas[tabela] || [], error: null }).then(ok, falha);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      from: (t: string) => consulta(t),
      storage: { from: () => ({ list: vi.fn().mockResolvedValue({ data: [], error: null }), createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://x/v.mp4" }, error: null }) }) },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));

import { toast } from "sonner";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import { gravarEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import TrocarVideo from "@/components/mesa-edicao/TrocarVideo";
import { chaveDaVersaoAberta, edicoesRecentes, nomeDaEdicao, projetoDoVideo, trocarVideo, versaoAberta, videosParaTrocar } from "@/components/mesa-edicao/trocaDeVideo";
import type { ArquivoDeVideo } from "@/components/mesa-videos/videosApi";
import type { VersaoDeVideo } from "../../supabase/functions/mesa-videos/modulos/memoria-de-video";
import { clipeNovo, normalizarProjeto, proximaRevisao } from "../../supabase/functions/_shared/projeto-de-edicao";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const V_ANTIGA = "22222222-2222-4222-8222-222222222222";
const ARQ_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ARQ_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ARQ_G = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const arquivo = (id: string, nome: string, extra: Partial<ArquivoDeVideo> = {}): ArquivoDeVideo => ({
  id,
  client_id: CLIENTE,
  nome,
  nome_original: nome,
  storage_bucket: "mesa",
  storage_path: `${CLIENTE}/video/brutos/${id}.mp4`,
  tipo: "bruto",
  mime: "video/mp4",
  bytes: 1000,
  duracao_s: 12,
  largura: 1080,
  altura: 1920,
  sha256: null,
  gravado_em: null,
  roteiro_id: null,
  cena_ref: null,
  grupo: null,
  melhor: false,
  nota: null,
  estado: "ativo",
  criado_em: "2026-10-18T10:00:00Z",
  edicao_desde: null,
  origem: null,
  ...extra,
});

const A = arquivo(ARQ_A, "Gravacao A.mp4", { criado_em: "2026-10-17T10:00:00Z" });
const B = arquivo(ARQ_B, "Gravacao B.mp4", { criado_em: "2026-10-18T10:00:00Z" });
const GERADO = arquivo(ARQ_G, "Cena gerada.mp4", { tipo: "gerado", storage_path: `${CLIENTE}/video/gerados/g.mp4` });
const ARQUIVADO = arquivo("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "Velho.mp4", { estado: "arquivado" });
const AUDIO = arquivo("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "Locucao.mp3", { tipo: "audio", mime: "audio/mpeg" });
const SEM_DURACAO = arquivo("ffffffff-ffff-4fff-8fff-ffffffffffff", "Sem duracao.mp4", { duracao_s: null, criado_em: "2026-10-16T10:00:00Z" });

/** A edição de A com um corte e um texto feitos no editor (o que não pode sumir calado). */
function versaoDeA(): VersaoDeVideo {
  const p = projetoDoVideo(A, { formato: "9:16", agora: "2026-10-18T11:00:00Z" });
  const editado = { ...p, revisao: 3, trilhas: p.trilhas.map((t) => (t.tipo === "texto" ? { ...t, clipes: [clipeNovo({ id: "t1", inicio_s: 0, entrada_s: 0, saida_s: 2, texto: "Oferta de hoje" })] } : t)) };
  return { id: V_ANTIGA, client_id: CLIENTE, video_id: "99999999-9999-4999-8999-999999999999", titulo: "Gravacao A.mp4", numero: 1, pai_id: null, arquivo_id: ARQ_A, roteiro_id: null, estado: "rascunho", custo_usd: null, feedback: [], nota: null, decidido_por: null, decidido_em: null, motivo: null, criado_por: "u-1", criado_em: "2026-10-18T11:00:00Z", projeto: editado as never };
}

/** A função mesa-videos de mentira, com as regras de verdade (revisão e versão nova). */
function bancoFalso(inicial: VersaoDeVideo[]) {
  const versoes = inicial.map((v) => ({ ...v }));
  let n = 0;
  const chamar = vi.fn(async (corpo: Record<string, any>): Promise<any> => {
    if (corpo.acao === "versao_registrar") {
      n += 1;
      const v: VersaoDeVideo = { ...versaoDeA(), id: `0000000${n}-0000-4000-8000-000000000000`, video_id: corpo.video_id || `vid-${n}`, titulo: corpo.titulo, arquivo_id: corpo.arquivo_id, criado_em: `2026-10-19T1${n}:00:00Z`, projeto: { ...corpo.projeto, revisao: 1 } };
      versoes.push(v);
      return { versao: v };
    }
    if (corpo.acao === "projeto_salvar") {
      const v = versoes.find((x) => x.id === corpo.versao_id)!;
      v.projeto = proximaRevisao(normalizarProjeto(v.projeto), normalizarProjeto(corpo.projeto)!, corpo.revisao_lida, "2026-10-19T12:00:00Z") as never;
      return { versao: v };
    }
    throw new Error(`ação inesperada ${corpo.acao}`);
  });
  return { versoes, chamar };
}

const arquivosDasFontes = (v: VersaoDeVideo) => Object.values(normalizarProjeto(v.projeto)!.fontes).map((f) => f.arquivo_id);
const textos = (v: VersaoDeVideo) => normalizarProjeto(v.projeto)!.trilhas.filter((t) => t.tipo === "texto").reduce((s, t) => s + t.clipes.length, 0);

describe("trocar o vídeo em edição (regras)", () => {
  it("acervo e Mesa Vídeos separados; arquivado e áudio não entram; o mais novo primeiro", () => {
    const todos = [A, B, GERADO, ARQUIVADO, AUDIO, SEM_DURACAO];
    expect(videosParaTrocar(todos, "acervo").map((a) => a.id)).toEqual([ARQ_B, ARQ_A, SEM_DURACAO.id]);
    expect(videosParaTrocar(todos, "mesa_videos").map((a) => a.id)).toEqual([ARQ_G]);
  });

  it("a montagem do vídeo novo leva só ele, inteiro, no formato da edição de antes", () => {
    const p = projetoDoVideo(B, { formato: "1:1", agora: "2026-10-19T10:00:00Z" });
    expect(Object.values(p.fontes).map((f) => f.arquivo_id)).toEqual([ARQ_B]);
    expect(p.formato).toBe("1:1");
    expect(p.titulo).toBe("Gravacao B.mp4");
    expect(p.trilhas.find((t) => t.tipo === "video")!.clipes).toHaveLength(1);
  });

  it("trocar MANTENDO: versão nova com o vídeo novo e a edição antiga intacta nas versões e nas recentes", async () => {
    const banco = bancoFalso([versaoDeA()]);
    const atual = versaoAberta(banco.versoes, V_ANTIGA);
    const r = await trocarVideo({ clientId: CLIENTE, arquivo: B, atual, modo: "manter", agora: "2026-10-19T10:00:00Z", chamar: banco.chamar as never });
    expect(r.desfazer).toBeNull();
    expect(banco.chamar).toHaveBeenCalledTimes(1);
    const corpo = banco.chamar.mock.calls[0][0];
    expect(corpo).toMatchObject({ acao: "versao_registrar", client_id: CLIENTE, arquivo_id: ARQ_B, estado: "rascunho" });
    // Vídeo novo (sem video_id): não vira "v2" da edição antiga.
    expect(corpo.video_id).toBeUndefined();
    const antiga = banco.versoes.find((v) => v.id === V_ANTIGA)!;
    expect(arquivosDasFontes(antiga)).toEqual([ARQ_A]);
    expect(textos(antiga)).toBe(1);
    expect(normalizarProjeto(antiga.projeto)!.revisao).toBe(3);
    const nova = banco.versoes.find((v) => v.id === r.versaoId)!;
    expect(arquivosDasFontes(nova)).toEqual([ARQ_B]);
    // As duas aparecem nas edições recentes (a nova primeiro) para alternar.
    expect(edicoesRecentes(banco.versoes).map((v) => v.id)).toEqual([r.versaoId, V_ANTIGA]);
  });

  it("trocar DESCARTANDO: a mesma versão fica só com o vídeo novo (a edição antiga sai) e o Desfazer devolve", async () => {
    const banco = bancoFalso([versaoDeA()]);
    const atual = versaoAberta(banco.versoes, V_ANTIGA);
    const r = await trocarVideo({ clientId: CLIENTE, arquivo: B, atual, modo: "descartar", agora: "2026-10-19T10:00:00Z", chamar: banco.chamar as never });
    expect(r.versaoId).toBe(V_ANTIGA);
    expect(banco.chamar.mock.calls[0][0]).toMatchObject({ acao: "projeto_salvar", versao_id: V_ANTIGA, revisao_lida: null });
    expect(banco.versoes).toHaveLength(1);
    const v = banco.versoes[0];
    expect(arquivosDasFontes(v)).toEqual([ARQ_B]);
    expect(textos(v)).toBe(0);
    expect(nomeDaEdicao(v)).toBe("Gravacao B.mp4");
    expect(edicoesRecentes(banco.versoes).map((x) => x.id)).toEqual([V_ANTIGA]);
    // Desfazer: o projeto de antes volta, pela revisão que o descartar gravou.
    await r.desfazer!();
    expect(banco.chamar.mock.calls[1][0]).toMatchObject({ acao: "projeto_salvar", versao_id: V_ANTIGA, revisao_lida: 4 });
    expect(arquivosDasFontes(banco.versoes[0])).toEqual([ARQ_A]);
    expect(textos(banco.versoes[0])).toBe(1);
  });

  it("sem edição aberta, nasce uma edição nova; recentes ficam só com a versão editável mais nova de cada vídeo", async () => {
    const banco = bancoFalso([]);
    const r = await trocarVideo({ clientId: CLIENTE, arquivo: A, atual: null, modo: "descartar", agora: "2026-10-19T10:00:00Z", chamar: banco.chamar as never });
    expect(banco.chamar.mock.calls[0][0].acao).toBe("versao_registrar");
    expect(r.desfazer).toBeNull();
    const base = versaoDeA();
    const lista: VersaoDeVideo[] = [
      { ...base, id: "v1", numero: 1, criado_em: "2026-10-18T10:00:00Z" },
      { ...base, id: "v2", numero: 2, criado_em: "2026-10-18T12:00:00Z" },
      { ...base, id: "v3", video_id: "outro", numero: 1, estado: "aprovada", criado_em: "2026-10-18T13:00:00Z" },
    ];
    expect(edicoesRecentes(lista).map((v) => v.id)).toEqual(["v2"]);
    expect(versaoAberta(lista, "nao-existe")!.id).toBe("v2");
  });

  it("piso Safari 11 / Chrome 64 e sem travessão nos arquivos da troca", () => {
    for (const p of ["src/components/mesa-edicao/trocaDeVideo.ts", "src/components/mesa-edicao/TrocarVideo.tsx"]) {
      const f = readFileSync(resolve(__dirname, "../..", p), "utf8");
      expect(f, p).not.toMatch(/\(\?<[=!a-z]/i);
      expect(f, p).not.toMatch(/\\p\{/);
      expect(f, p).not.toMatch(/\.at\(|Object\.hasOwn\(/);
      expect(f, p).not.toMatch(/[—–]/);
    }
  });
});

// ------------------------------------------------------------------ a janela

const valor = (): MesaValor =>
  ({
    clientId: CLIENTE,
    clientName: "Café Sintético",
    userId: "u-1",
    isAdmin: true,
    podeRecarregar: true,
    saldoUsd: 10,
    catalogo: [],
    catalogoCarregando: false,
    atualizarCusto: vi.fn(),
    abrirRecarga: vi.fn(),
    abrirChaves: vi.fn(),
    abrirModelos: vi.fn(),
  }) as unknown as MesaValor;

function montar(irPara = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(h(MemoryRouter, { initialEntries: [`/mesa-edicao?client=${CLIENTE}&etapa=entrada`] }, h(QueryClientProvider, { client: qc }, h(MesaProvider, { valor: valor(), children: h(TrocarVideo, { irPara }) }))));
  return irPara;
}

const corpos = (acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[0] === "mesa-videos" && c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);

describe("Trocar vídeo na tela", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    try {
      window.localStorage.clear();
    } catch {
      /* sem storage */
    }
    mock.tabelas = { video_arquivos: [A, B, GERADO, SEM_DURACAO], video_versoes: [versaoDeA()] };
    mock.invoke.mockImplementation(async (_fn: string, op: { body: Record<string, unknown> }) => {
      if (op.body.acao === "versao_registrar") return { data: { versao: { ...versaoDeA(), id: "44444444-4444-4444-8444-444444444444", video_id: "novo", titulo: op.body.titulo, projeto: op.body.projeto } }, error: null };
      if (op.body.acao === "projeto_salvar") return { data: { versao: { ...versaoDeA(), projeto: { ...(op.body.projeto as object), revisao: 4 } } }, error: null };
      return { data: {}, error: null };
    });
  });

  it("só o ícone na barra; a janela mostra as edições recentes e os vídeos do acervo e da Mesa Vídeos", async () => {
    montar();
    const icone = screen.getByRole("button", { name: "Trocar vídeo" });
    expect(icone).toHaveAttribute("title", "Trocar vídeo");
    expect(icone.textContent).toBe("");
    fireEvent.click(icone);
    await waitFor(() => expect(document.querySelector(`[data-edicao-recente="${V_ANTIGA}"]`)).toBeTruthy());
    expect(document.querySelector(`[data-edicao-recente="${V_ANTIGA}"]`)).toHaveAttribute("aria-current", "true");
    await waitFor(() => expect(document.querySelector(`[data-video-para-trocar="${ARQ_B}"]`)).toBeTruthy());
    // Sem duração lida: aparece, mas não dá para escolher (e diz por quê).
    const semDuracao = document.querySelector(`[data-video-para-trocar="${SEM_DURACAO.id}"]`) as HTMLButtonElement;
    expect(semDuracao.disabled).toBe(true);
    expect(semDuracao.title).toMatch(/duração/);
    fireEvent.click(screen.getByRole("tab", { name: /Mesa Vídeos/ }));
    await waitFor(() => expect(document.querySelector(`[data-video-para-trocar="${ARQ_G}"]`)).toBeTruthy());
    expect(document.querySelector(`[data-video-para-trocar="${ARQ_B}"]`)).toBeNull();
  });

  it("com edição aberta, pergunta antes; Manter registra a versão nova e abre o editor nela", async () => {
    gravarEstadoDaTela(chaveDaVersaoAberta(CLIENTE), V_ANTIGA, "/");
    const irPara = montar();
    fireEvent.click(screen.getByRole("button", { name: "Trocar vídeo" }));
    await waitFor(() => expect(document.querySelector(`[data-video-para-trocar="${ARQ_B}"]`)).toBeTruthy());
    fireEvent.click(document.querySelector(`[data-video-para-trocar="${ARQ_B}"]`) as HTMLElement);
    expect(corpos("versao_registrar")).toHaveLength(0);
    await waitFor(() => expect(document.querySelector("[data-pergunta-da-troca]")).toBeTruthy());
    fireEvent.click(document.querySelector("[data-trocar-manter]") as HTMLElement);
    await waitFor(() => expect(corpos("versao_registrar")).toHaveLength(1));
    expect(corpos("versao_registrar")[0]).toMatchObject({ client_id: CLIENTE, arquivo_id: ARQ_B });
    expect(corpos("projeto_salvar")).toHaveLength(0);
    await waitFor(() => expect(irPara).toHaveBeenCalledWith("editar", { versao: "44444444-4444-4444-8444-444444444444" }));
    expect(toast.success).toHaveBeenCalledWith("Editando Gravacao B.mp4", { description: expect.stringMatching(/ficou nas versões/) });
  });

  it("Descartar grava o vídeo novo na mesma versão, reabre o editor nela e o aviso traz Desfazer", async () => {
    const irPara = montar();
    fireEvent.click(screen.getByRole("button", { name: "Trocar vídeo" }));
    await waitFor(() => expect(document.querySelector(`[data-video-para-trocar="${ARQ_B}"]`)).toBeTruthy());
    fireEvent.click(document.querySelector(`[data-video-para-trocar="${ARQ_B}"]`) as HTMLElement);
    fireEvent.click(await waitFor(() => document.querySelector("[data-trocar-descartar]") as HTMLElement));
    await waitFor(() => expect(corpos("projeto_salvar")).toHaveLength(1));
    expect(corpos("projeto_salvar")[0]).toMatchObject({ versao_id: V_ANTIGA, revisao_lida: null });
    expect(corpos("versao_registrar")).toHaveLength(0);
    await waitFor(() => expect(irPara).toHaveBeenCalledWith("editar", { versao: V_ANTIGA }));
    const aviso = (toast.success as any).mock.calls.find((c: any[]) => c[0] === "Editando Gravacao B.mp4");
    expect(aviso[1].action.label).toBe("Desfazer");
  });

  it("edição recente: um clique abre aquela edição no editor", async () => {
    const irPara = montar();
    fireEvent.click(screen.getByRole("button", { name: "Trocar vídeo" }));
    await waitFor(() => expect(document.querySelector(`[data-edicao-recente="${V_ANTIGA}"]`)).toBeTruthy());
    fireEvent.click(document.querySelector(`[data-edicao-recente="${V_ANTIGA}"]`) as HTMLElement);
    expect(irPara).toHaveBeenCalledWith("editar", { versao: V_ANTIGA });
    expect(mock.invoke).not.toHaveBeenCalled();
  });
});

describe("Mesa Edição: o Trocar vídeo vale em toda etapa e o editor obedece ao ?versao=", () => {
  const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
  it("a página põe o ícone na barra da mesa (acoesDaMesa) e a AreaDoEditor recarrega o editor no ?versao=", () => {
    expect(ler("src/pages/MesaEdicao.tsx")).toMatch(/acoesDaMesa=\{\(_etapa, irPara\) => \(/);
    expect(ler("src/components/mesa-videos/MesaDeVideo.tsx")).toMatch(/acoesDaMesa\(etapa, irPara\)/);
    const area = ler("src/components/mesa-edicao/AreaDoEditor.tsx");
    expect(area).toMatch(/setEscolhida\(versaoPedida\);\s*setRecarga\(\(n\) => n \+ 1\);/);
    expect(area).toContain("mesa-edicao:editor:versao:${clientId}");
  });
});
