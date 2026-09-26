import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mesa Vídeos (frente V2, 25/09/2026; docs/mesa-videos/CONTRATO.md): filtro do
 * acervo, organizador de takes (normalização e desfazer), pacote para editar,
 * memória de versões, pedidos preparados, fila do computador do agente
 * (desligada) e a tela básica. A função mesa-videos, o Storage e as tabelas
 * são simulados.
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  rpc: vi.fn(),
  tabelas: {} as Record<string, unknown>,
  erros: {} as Record<string, { message: string; code?: string }>,
  lista: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const erro = mock.erros[tabela] || null;
    const dados = erro ? null : mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range", "update", "insert"]) b[m] = () => b;
    const primeiro = () => ({ data: Array.isArray(dados) ? (dados[0] === undefined ? null : dados[0]) : dados, error: erro });
    b.maybeSingle = () => Promise.resolve(primeiro());
    b.single = () => Promise.resolve(primeiro());
    b.then = (ok: any, falha: any) => Promise.resolve({ data: dados, error: erro, count: Array.isArray(dados) ? dados.length : 0 }).then(ok, falha);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: mock.rpc,
      from: (tabela: string) => consulta(tabela),
      storage: {
        from: () => ({
          upload: vi.fn().mockResolvedValue({ data: { path: "x" }, error: null }),
          list: mock.lista,
          createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/v.mp4" }, error: null }),
          createSignedUrls: () => Promise.resolve({ data: [], error: null }),
        }),
      },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));

const CLIENTE = "11111111-1111-4111-8111-111111111111";
vi.mock("@/hooks/useSupabaseData", () => ({
  useClients: () => ({
    data: [{ id: "11111111-1111-4111-8111-111111111111", company_name: "Café Sintético", plan_status: "active" }],
    isLoading: false,
    isSuccess: true,
    isFetching: false,
    dataUpdatedAt: 1,
    refetch: vi.fn(),
  }),
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import MesaVideos from "@/pages/MesaVideos";
import EtapaEdicao, { entradaDoPacote } from "@/components/mesa-videos/EtapaEdicao";
import { segundosDoTexto } from "@/components/mesa-videos/EtapaMemoria";
import { ETAPAS_DA_MESA_VIDEOS, etapaValida } from "@/components/mesa-videos/Comuns";
import { extensaoDoVideo, fotosParaVideo, historiasDasLinhas, normalizarArquivo, novoIdDoArquivo } from "@/components/mesa-videos/videosApi";
import { normalizarFotos } from "@/components/mesa-foto/fotoApi";
import { MESAS_DO_PAINEL, cargasDaMesa, etapaQueVaiAbrir } from "@/lib/mesa/preCarga";
import { MESAS, enderecoDaMesa } from "@/components/mesa-foto/TrocaDeMesas";
import { montarClientesDaMesa, NOME_DA_MESA } from "@/components/mesa/clientesDaMesa";
import {
  acaoDaOrganizacao,
  aplicarCampos,
  camposDaOperacao,
  camposDoDesfazer,
  desfazerDaOperacao,
  lerNomeDoTake,
  nomeNormalizado,
  proporOrganizacao,
  slugDoNome,
  type TakeParaOrganizar,
} from "../../supabase/functions/_shared/organizador-de-takes";
import { celula, montarPacote } from "../../supabase/functions/_shared/pacote-de-edicao";
import { BLOCOS_DA_EDICAO, conhecimentoEdicao, FONTE_BRABO } from "../../supabase/functions/_shared/conhecimento-edicao";
import { comFeedback, decidir, motivoParaNaoMudar, normalizarVersao, proximoNumero, resumoPorVideo, tempoDoVideo } from "../../supabase/functions/_shared/memoria-de-video";
import { chaveDoPedido, estimarPedido, executorDoPedido, normalizarParametros, textoDaEstimativa } from "../../supabase/functions/_shared/pedidos-de-video";
import { computadorLigado, motivoParaRecusar, normalizarPedidoDeTarefa, pareceCredencial, podeMudarEstado } from "../../supabase/functions/_shared/computador-do-agente";
import { normalizarRoteiroAprovado } from "../../supabase/functions/_shared/roteiros-para-video";

const raiz = process.cwd();
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8").replace(/\r\n/g, "\n");

const ROTEIRO = "22222222-2222-4222-8222-222222222222";
const A1 = "aaaaaaaa-0000-4000-8000-000000000001";
const A2 = "aaaaaaaa-0000-4000-8000-000000000002";
const A3 = "aaaaaaaa-0000-4000-8000-000000000003";
const A4 = "aaaaaaaa-0000-4000-8000-000000000004";

const take = (id: string, extra: Partial<TakeParaOrganizar> = {}): TakeParaOrganizar => ({
  id,
  nome: "IMG_0001.MOV",
  nome_original: "IMG_0001.MOV",
  tipo: "bruto",
  grupo: null,
  roteiro_id: null,
  cena_ref: null,
  melhor: false,
  estado: "ativo",
  gravado_em: null,
  criado_em: "2026-09-25T10:00:00Z",
  ...extra,
});

const ROTEIROS = [{ id: ROTEIRO, titulo: "Café da manhã", cenas: [{ ref: "abertura", ordem: 1, titulo: "Abertura" }, { ref: "produto", ordem: 2, titulo: "Produto" }] }];

// ------------------------------------------------------------------ filtro do acervo

describe("acervo da Mesa Vídeos: só o que serve a vídeo", () => {
  const foto = (id: string, extra: Record<string, unknown>) => ({
    id,
    client_id: CLIENTE,
    nome: id,
    storage_bucket: "mesa",
    storage_path: `${CLIENTE}/foto/${id}.jpg`,
    origem: "upload",
    tags: [],
    ativa: true,
    gerada: false,
    aprovada: false,
    criado_em: "2026-09-25T10:00:00Z",
    ...extra,
  });

  it("cenas, personagens, clones autorizados e produtos entram; artes, carrosséis, internet e inativas ficam fora", () => {
    const fotos = normalizarFotos([
      foto("cena", { tags: ["cena:n1"], gerada: true }),
      foto("pers", { tags: ["personagem:m1"], gerada: true }),
      foto("clone", { modo: "clone", tags: ["clone:c1"] }),
      foto("prod", { kit_id: "k1", categoria: "produto" }),
      foto("arte", { categoria: "arte" }),
      foto("logo", { categoria: "logo" }),
      foto("carrossel", { tags: ["carrossel", "cena"] }),
      foto("solta", {}),
      foto("velha", { ativa: false, tags: ["cena"] }),
      foto("web", { kit_id: "k1", categoria: "produto", tags: ["referencia_web"] }),
    ]);
    const g = fotosParaVideo(fotos);
    expect(g.cena.map((f) => f.id)).toEqual(["cena"]);
    expect(g.personagem.map((f) => f.id)).toEqual(["pers"]);
    expect(g.clone.map((f) => f.id)).toEqual(["clone"]);
    expect(g.produto.map((f) => f.id)).toEqual(["prod"]);
  });

  it("a História vem da view na ordem, com a foto mais nova quando a cena não fixou uma", () => {
    const h1 = historiasDasLinhas([
      { canvas_id: "c1", client_id: CLIENTE, canvas_nome: "Manhã", no_id: "n2", numero: 2, titulo: "Xícara", resultados: [] },
      {
        canvas_id: "c1",
        client_id: CLIENTE,
        canvas_nome: "Manhã",
        historia: { sinopse: "Um café" },
        no_id: "n1",
        numero: 1,
        titulo: "Abre",
        resultados: [
          { status: "gerada", storage_path: "a.png", storage_bucket: "mesa" },
          { status: "falhou", storage_path: "b.png" },
          { status: "gerada", storage_path: "c.png" },
        ],
      },
    ]);
    expect(h1).toHaveLength(1);
    expect(h1[0].cenas.map((c) => c.no_id)).toEqual(["n1", "n2"]);
    expect(h1[0].cenas[0].foto_do_resultado).toEqual({ storage_bucket: "mesa", storage_path: "c.png" });
    expect(h1[0].cenas[1].foto_do_resultado).toBeNull();
  });

  it("aceita os formatos de gravação e gera id sem crypto.randomUUID", () => {
    expect(extensaoDoVideo({ name: "IMG_1.MOV" })).toBe("mov");
    expect(extensaoDoVideo({ name: "voz.wav" })).toBe("wav");
    expect(extensaoDoVideo({ name: "sem", type: "video/mp4" })).toBe("mp4");
    expect(extensaoDoVideo({ name: "foto.jpg", type: "image/jpeg" })).toBeNull();
    expect(novoIdDoArquivo()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(normalizarArquivo({ id: "x", storage_path: "p", melhor: "sim" })!.melhor).toBe(false);
  });
});

// ------------------------------------------------------------------ organizador

describe("organizador de takes: normalização", () => {
  it("lê cena e take do nome, sem confundir nome de câmera", () => {
    expect(lerNomeDoTake("Cena 2 Take 3.mov")).toEqual({ cena: 2, take: 3 });
    expect(lerNomeDoTake("cafe_c02_t03.mp4")).toEqual({ cena: 2, take: 3 });
    expect(lerNomeDoTake("sc2-tk1.MP4")).toEqual({ cena: 2, take: 1 });
    expect(lerNomeDoTake("s02_t04.mov")).toEqual({ cena: 2, take: 4 });
    expect(lerNomeDoTake("take 7.mov")).toEqual({ cena: null, take: 7 });
    expect(lerNomeDoTake("C0012.MP4")).toEqual({ cena: null, take: null });
    expect(lerNomeDoTake("IMG_1234.MOV")).toEqual({ cena: null, take: null });
    expect(lerNomeDoTake("DJI_0001.MP4")).toEqual({ cena: null, take: null });
  });

  it("nome no padrão roteiro_c01_t01 com a extensão original", () => {
    expect(slugDoNome("Café da Manhã!")).toBe("cafe-da-manha");
    expect(nomeNormalizado({ base: "Café da manhã", cena: 2, take: 3, ext: "mov" })).toBe("cafe-da-manha_c02_t03.mov");
    expect(nomeNormalizado({ base: "", cena: null, take: 12 })).toBe("take_t12");
  });

  it("agrupa por roteiro e cena, mantém o número de take do nome e numera o resto na ordem de gravação", () => {
    const takes = [
      take(A1, { roteiro_id: ROTEIRO, cena_ref: "produto", nome: "tk2.mov", nome_original: "take 2.mov" }),
      take(A2, { roteiro_id: ROTEIRO, cena_ref: "produto", nome: "IMG_9.MOV", nome_original: "IMG_9.MOV", gravado_em: "2026-09-25T09:00:00Z" }),
      take(A3, { roteiro_id: ROTEIRO, cena_ref: "abertura", nome: "A.mp4", nome_original: "A.mp4" }),
      take(A4, { nome: "solto.mov", nome_original: "solto.mov", estado: "arquivado" }),
    ];
    const itens = proporOrganizacao(takes, ROTEIROS);
    const nomes = itens.filter((i) => i.operacao === "renomear").reduce((m, i) => ({ ...m, [i.arquivo_id]: i.para }), {} as Record<string, string>);
    expect(nomes[A1]).toBe("cafe-da-manha_c02_t02.mov");
    expect(nomes[A2]).toBe("cafe-da-manha_c02_t01.mov");
    expect(nomes[A3]).toBe("cafe-da-manha_c01_t01.mp4");
    expect(itens.some((i) => i.arquivo_id === A4)).toBe(false);
    const grupos = itens.filter((i) => i.operacao === "agrupar").map((i) => i.para);
    expect(grupos).toContain("Café da manhã / Cena 2");
    expect(grupos).toContain("Café da manhã / Cena 1");
    // Aplicar a proposta e propor de novo: nada muda (idempotente).
    const depois = takes.map((t) =>
      itens.filter((i) => i.arquivo_id === t.id).reduce((x, i) => aplicarCampos(x, camposDaOperacao(i.operacao, i.para)), t),
    );
    expect(proporOrganizacao(depois, ROTEIROS)).toEqual([]);
  });

  it("vira ação do contrato comum com apelidos (sem UUID para o modelo) e trava o arquivamento do melhor take", () => {
    const takes = [take(A1, { nome: "x.mov", nome_original: "cena 1 take 1.mov" }), take(A2, { melhor: true, nome: "y.mov" })];
    const acao = acaoDaOrganizacao(
      takes,
      [
        { arquivo_id: A1, operacao: "renomear", para: "take_c01_t01.mov" },
        { arquivo_id: A1, operacao: "agrupar", para: "Sem roteiro / Cena 1" },
        { arquivo_id: A2, operacao: "arquivar", para: "" },
      ],
      [],
    )!;
    expect(acao.agente).toBe("organizador_de_takes");
    expect(acao.itens.map((i) => `${i.ref}:${i.operacao}`)).toEqual(["t1:renomear", "t1:agrupar"]);
    expect(acao.itens.every((i) => !/[0-9a-f]{8}-/.test(i.ref))).toBe(true);
    expect(acao.recusados).toEqual([expect.objectContaining({ ref: "t2", operacao: "arquivar", motivo: expect.stringContaining("melhor take") })]);
  });

  it("desfazer volta exatamente como estava", () => {
    const antes = take(A1, { nome: "IMG_1.MOV", grupo: "Rascunho", roteiro_id: null, cena_ref: null, melhor: false });
    for (const [op, para] of [
      ["renomear", "cafe_c01_t01.mov"],
      ["agrupar", "Café / Cena 1"],
      ["ligar_roteiro", ROTEIRO],
      ["ligar_cena", "abertura"],
      ["arquivar", null],
      ["marcar_melhor", null],
    ] as Array<[string, string | null]>) {
      const desfazer = desfazerDaOperacao(antes, op);
      const mudado = aplicarCampos(antes, camposDaOperacao(op, para));
      expect(mudado, op).not.toEqual(antes);
      expect(aplicarCampos(mudado, camposDoDesfazer(desfazer)), op).toEqual(antes);
    }
    expect(() => camposDaOperacao("apagar_de_vez", null)).toThrow();
    expect(camposDoDesfazer({ campos: { roteiro_id: "nao-e-uuid" } })).toEqual({ roteiro_id: null });
  });
});

// ------------------------------------------------------------------ pacote

describe("pacote para editar", () => {
  const takes = [
    { id: A1, nome: "cafe_c01_t01.mov", nome_original: "A.mov", tipo: "bruto", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/brutos/a.mov`, grupo: "Café / Cena 1", roteiro_id: ROTEIRO, cena_ref: "abertura", melhor: false, duracao_s: 8, largura: 1080, altura: 1920, bytes: 10, sha256: null },
    { id: A2, nome: "cafe_c01_t02.mov", nome_original: "B.mov", tipo: "bruto", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/brutos/b.mov`, grupo: "Café / Cena 1", roteiro_id: ROTEIRO, cena_ref: "abertura", melhor: true, duracao_s: 7.5, largura: 1080, altura: 1920, bytes: 10, sha256: null, url: "https://x.test/b" },
    { id: A3, nome: "cafe_c02_t01.mov", nome_original: "C.mov", tipo: "bruto", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/brutos/c.mov`, grupo: "Café / Cena 2", roteiro_id: ROTEIRO, cena_ref: "produto", melhor: false, duracao_s: null, largura: null, altura: null, bytes: null, sha256: null },
  ];
  const entrada = {
    cliente: { id: CLIENTE, nome: "Café Sintético" },
    titulo: "Reel, da manhã",
    formato: "9:16",
    fps: 25,
    destino: "remotion" as const,
    roteiro: { id: ROTEIRO, titulo: "Café da manhã", cenas: [{ ref: "abertura", ordem: 1, titulo: "Abertura", fala: "Bom dia" }, { ref: "produto", ordem: 2, titulo: "Produto", fala: "O café" }] },
    historia: null,
    takes,
    legendas: [{ arquivo_id: A2, estado: "em_breve", srt: "1\n00:00:00,000 --> 00:00:01,000\nBom dia\n" }],
    referencias: [{ titulo: "Ref 1", url: "https://ref.test" }],
    direcao: "Ritmo calmo.",
    gerado_em: "2026-09-25T20:00:00Z",
  };

  it("leva roteiro, takes na ordem de montar, legendas, direção e referências", () => {
    const p = montarPacote(entrada);
    expect(Object.keys(p.arquivos)).toEqual(
      expect.arrayContaining(["roteiro.md", "takes.csv", "decupagem.csv", "direcao.md", "referencias.md", "edl.json", "pacote.json", "LEIA-ME.md", "links.txt", "legendas/cafe_c01_t02.srt", "legendas/PENDENTE.txt"]),
    );
    const linhas = p.arquivos["takes.csv"].split("\n");
    expect(linhas[1].indexOf("cafe_c01_t02.mov")).toBe(0); // melhor da cena 1 primeiro
    expect(linhas[3].indexOf("cafe_c02_t01.mov")).toBe(0);
    expect(p.arquivos["roteiro.md"]).toContain("## Cena 2: Produto");
    expect(p.arquivos["referencias.md"]).toContain("https://ref.test");
    expect(p.nome_do_zip).toBe("pacote-cafe-sintetico-reel-da-manha.zip");
  });

  it("a direção do pacote é o conhecimento de edição, com a fonte e a nota da equipe antes", () => {
    const p = montarPacote(entrada);
    const d = p.arquivos["direcao.md"];
    expect(d).toContain(conhecimentoEdicao("pacote").texto);
    expect(d.indexOf("Ritmo calmo.")).toBeLessThan(d.indexOf("## Método"));
    expect(d).toContain(FONTE_BRABO.autor);
    expect(JSON.parse(p.arquivos["pacote.json"]).direcao_blocos).toEqual(BLOCOS_DA_EDICAO.map((b) => b.id));
  });

  it("edl.json no formato dos projetos Remotion do dono, só com os melhores com duração", () => {
    const edl = JSON.parse(montarPacote(entrada).arquivos["edl.json"]);
    expect(Object.keys(edl)).toEqual(["version", "sources", "fps", "ranges", "grade", "overlays", "total_duration_s", "note"]);
    expect(edl.fps).toBe(25);
    expect(edl.ranges).toEqual([{ source: "cafe-c01-t02", start: 0, end: 7.5 }]);
    expect(edl.total_duration_s).toBe(7.5);
  });

  it("pendências honestas: cena sem melhor take, legenda faltando e sincronia não medida", () => {
    const p = montarPacote(entrada);
    expect(p.pendencias.join(" | ")).toContain("Cena 2 (Produto) sem melhor take marcado");
    expect(p.pendencias.join(" | ")).toContain("sem legenda pronta");
    expect(p.pendencias.join(" | ")).toContain("Sincronia de áudio não medida");
    const vazio = montarPacote({ ...entrada, roteiro: null, takes: [], fps: null });
    expect(vazio.pendencias.join(" | ")).toContain("Nenhum take no pacote");
    expect(vazio.pendencias.join(" | ")).toContain("FPS da composição não informado");
    expect(JSON.parse(vazio.arquivos["edl.json"]).note).toContain("FPS 25 provisório");
  });

  it("CSV protege vírgula, aspas e quebra de linha", () => {
    expect(celula('a,"b"\nc')).toBe('"a,""b""\nc"');
    expect(celula(null)).toBe("");
  });

  it("a tela escolhe os melhores do roteiro (ou todos, se nenhum foi marcado)", () => {
    const arquivos = takes.map((t) => normalizarArquivo({ ...t, estado: "ativo", criado_em: "" })!);
    const base = { clienteId: CLIENTE, clienteNome: "Café", titulo: "X", arquivos, roteiro: entrada.roteiro, historia: null, pedidos: [], destino: "editor" as const, fps: null, formato: "9:16", direcao: "", agora: "2026-09-25T00:00:00Z" };
    expect(entradaDoPacote({ ...base, quais: "melhores" }).takes.map((t) => t.id)).toEqual([A2]);
    expect(entradaDoPacote({ ...base, quais: "todos" }).takes).toHaveLength(3);
    const semMelhor = arquivos.map((a) => ({ ...a, melhor: false }));
    expect(entradaDoPacote({ ...base, arquivos: semMelhor, quais: "melhores" }).takes).toHaveLength(3);
  });
});

// ------------------------------------------------------------------ memória

describe("memória por vídeo", () => {
  const v = (extra: Record<string, unknown> = {}) =>
    normalizarVersao({ id: "v1", client_id: CLIENTE, video_id: "vid", titulo: "Reel", numero: 1, estado: "em_revisao", feedback: [], custo_usd: 0.5, criado_em: "2026-09-25T10:00:00Z", ...extra })!;

  it("numera as versões do vídeo e soma o custo; a aprovada mais nova fica à mão", () => {
    const lista = [v(), v({ id: "v2", numero: 2, estado: "aprovada", custo_usd: 0.25, criado_em: "2026-09-26T10:00:00Z" }), v({ id: "o1", video_id: "outro", numero: 1, custo_usd: null })];
    expect(proximoNumero(lista, "vid")).toBe(3);
    expect(proximoNumero(lista, "novo")).toBe(1);
    const r = resumoPorVideo(lista);
    const reel = r.find((x) => x.video_id === "vid")!;
    expect(reel.atual.numero).toBe(2);
    expect(reel.aprovada && reel.aprovada.id).toBe("v2");
    expect(reel.custo_total_usd).toBe(0.75);
    expect(r.find((x) => x.video_id === "outro")!.custo_total_usd).toBeNull();
  });

  it("comentário com o tempo do vídeo; aprovada é imutável e rejeitar pede motivo", () => {
    const com = comFeedback(v(), { autor: "u", texto: "  Cortar a pausa  ", tempo_s: 12.34 }, "agora");
    expect(com.feedback).toEqual([{ autor: "u", texto: "Cortar a pausa", tempo_s: 12.3, em: "agora" }]);
    expect(tempoDoVideo(65)).toBe("1:05");
    const aprovada = decidir(com, "aprovar", "dono", "agora");
    expect(aprovada.estado).toBe("aprovada");
    expect(() => comFeedback(aprovada, { autor: "u", texto: "mais", tempo_s: null }, "x")).toThrow(/aprovada/);
    expect(motivoParaNaoMudar(aprovada, "decidir")).toMatch(/imutável/);
    expect(() => decidir(v(), "rejeitar", "dono", "agora", "  ")).toThrow(/motivo/);
    expect(decidir(v(), "rejeitar", "dono", "agora", "Legenda cobre o produto").motivo).toBe("Legenda cobre o produto");
  });

  it("o tempo do comentário aceita 1:05 ou segundos", () => {
    expect(segundosDoTexto("1:05")).toBe(65);
    expect(segundosDoTexto("12,5")).toBe(12.5);
    expect(segundosDoTexto("")).toBeNull();
    expect(segundosDoTexto("abc")).toBeNull();
  });
});

// ------------------------------------------------------------------ pedidos e computador

describe("pedidos preparados e o computador do agente", () => {
  it("animar cena sem motor de vídeo: executor em breve e o vídeo sem cotação (nunca US$ 0)", () => {
    const p = normalizarParametros("animar_cena", { duracao_s: 40, movimento: "voar", audio: { fala: "Oi" } });
    expect(p).toEqual({ duracao_s: 15, movimento: "parada", audio: { fala: "Oi", trilha: null, efeitos: null }, motor_video: null });
    const e = estimarPedido("animar_cena", p);
    expect(e.incompleta).toBe(true);
    expect(e.cotado_usd).toBeGreaterThan(0);
    expect(e.partes.find((x) => x.rotulo.indexOf("Vídeo") === 0)!.usd).toBeNull();
    expect(textoDaEstimativa(e)).toContain("parte sem cotação");
    const catalogo = [{ id: "texto-1", tipo: "texto", ativo: true }, { id: "img-1", tipo: "imagem", ativo: true }];
    expect(executorDoPedido("animar_cena", catalogo)).toEqual({ executor: "em_breve", rotulo: "Motor de vídeo em breve", estado: "em_breve" });
    expect(executorDoPedido("animar_cena", [...catalogo, { id: "veo", tipo: "video", ativo: true, rotulo: "Veo" }]).estado).toBe("aguardando_confirmacao");
  });

  it("legenda estima pela duração; sem duração, sem cotação; mesma chave para o mesmo pedido", () => {
    const com = estimarPedido("legendar", normalizarParametros("legendar", { duracao_s: 60 }));
    expect(com.partes[1].usd).toBeGreaterThan(0);
    const sem = estimarPedido("legendar", normalizarParametros("legendar", {}));
    expect(textoDaEstimativa(sem)).toBe("Sem cotação");
    const p = normalizarParametros("transcrever", { duracao_s: 10, vocabulario: "Café Sintético, preço do combo" });
    expect((p as { vocabulario: string[] }).vocabulario).toEqual(["Café Sintético", "preço do combo"]);
    expect(chaveDoPedido("transcrever", { arquivo_id: A1 }, p)).toBe(chaveDoPedido("transcrever", { arquivo_id: A1 }, p));
    expect(chaveDoPedido("transcrever", { arquivo_id: A1 }, p)).not.toBe(chaveDoPedido("transcrever", { arquivo_id: A2 }, p));
  });

  it("fila do computador do agente: desligada por padrão, sem credencial e só o dono aprova", () => {
    expect(computadorLigado(undefined)).toBe(false);
    expect(computadorLigado("true")).toBe(false);
    expect(computadorLigado("1")).toBe(true);
    const pedido = normalizarPedidoDeTarefa({ titulo: "Organizar bins no Premiere", app: "premiere", passos: "Abrir o projeto\nCriar bins por cena" });
    expect(motivoParaRecusar(pedido, false)).toMatch(/desligado/);
    expect(motivoParaRecusar(pedido, true)).toBeNull();
    expect(pareceCredencial("senha: 1234")).toBe(true);
    expect(pareceCredencial("cartão 4111 1111 1111 1111")).toBe(true);
    expect(motivoParaRecusar({ ...pedido, passos: ["Entrar com password = abc"] }, true)).toMatch(/Credencial/);
    expect(normalizarPedidoDeTarefa({ titulo: "x", passos: ["Publicar o vídeo"] }).irreversivel).toBe(true);
    expect(podeMudarEstado("aguardando_dono", "aprovada", "admin", false)).toBe(true);
    expect(podeMudarEstado("aguardando_dono", "aprovada", "equipe", true)).toBe(false);
    expect(podeMudarEstado("aprovada", "cancelada", "equipe", true)).toBe(true);
    expect(podeMudarEstado("executando", "feita", "admin", false)).toBe(false);
  });

  it("roteiro aprovado da Mesa Roteiros entra só pelo contrato de dados", () => {
    const r = normalizarRoteiroAprovado({ id: ROTEIRO, client_id: CLIENTE, titulo: "Café", cenas: [{ ref: "b", ordem: 2 }, { ref: "a", ordem: 1 }, { ref: "a", ordem: 3 }] })!;
    expect(r.cenas.map((c) => c.ref)).toEqual(["a", "b"]);
    expect(normalizarRoteiroAprovado({ id: "nao-uuid" })).toBeNull();
  });
});

// ------------------------------------------------------------------ conhecimento

describe("conhecimento de edição (Brabo destilado)", () => {
  it("em palavras próprias, com a fonte e sem travessão", () => {
    const k = conhecimentoEdicao("pacote");
    expect(k.ids).toEqual(BLOCOS_DA_EDICAO.map((b) => b.id));
    expect(k.tamanho).toBeLessThanOrEqual(k.teto);
    expect(conhecimentoEdicao("legenda").ids).toEqual(["edicao_legenda_e_lettering", "edicao_sincronia"]);
    const modulo = ler("supabase/functions/_shared/conhecimento-edicao.ts");
    expect(modulo).not.toMatch(/[—–]/);
    expect(modulo).toContain("Fernando Araújo / Brabo Space");
    // Frases do SKILL.md original não aparecem copiadas.
    for (const frase of [
      "Transforme a fala em uma experiência visual",
      "O foco visual principal costuma estar nas interações superiores",
      "Prefira o ciclo ilustração superior",
      "Não importar os 70/30/5 frames do PicPay",
    ]) {
      expect(modulo).not.toContain(frase);
    }
  });

  it("motor registrado e ligado na função mesa-videos", () => {
    const motores = ler("supabase/functions/_shared/motores.ts");
    expect(motores).toContain('id: "mesa_videos.direcao_de_edicao"');
    expect(ler("supabase/functions/mesa-videos/index.ts")).toContain('const CONHECIMENTO_DA_EDICAO = conhecimentoEdicao("pacote").texto;');
    expect(ler("supabase/config.toml")).toContain("[functions.mesa-videos]\n    verify_jwt = true");
  });
});

// ------------------------------------------------------------------ esqueleto das mesas

describe("Mesa Vídeos no esqueleto das mesas", () => {
  it("rota, pré-carga, troca, seletor de clientes e etapas", () => {
    expect(MESAS_DO_PAINEL["/mesa-videos"].prefixo).toBe("mesa-videos");
    expect(Object.keys(MESAS_DO_PAINEL["/mesa-videos"].etapas)).toEqual(ETAPAS_DA_MESA_VIDEOS.map((e) => e.valor));
    expect(etapaQueVaiAbrir("/mesa-videos", `?client=${CLIENTE}&etapa=edicao`)).toBe("edicao");
    expect(etapaQueVaiAbrir("/mesa-videos", `?client=${CLIENTE}`)).toBe("acervo");
    expect(cargasDaMesa("/mesa-videos", `?client=${CLIENTE}&etapa=memoria`).map(([k]) => k)).toEqual(["pagina/mesa-videos", "mesa-videos/memoria"]);
    expect(MESAS.map((m) => m.valor)).toContain("videos");
    expect(enderecoDaMesa("videos", CLIENTE)).toBe(`/mesa-videos?client=${CLIENTE}`);
    expect(NOME_DA_MESA.videos).toBe("Mesa Vídeos");
    expect(montarClientesDaMesa("videos", [{ id: CLIENTE, company_name: "A", plan_status: "active" }], []).visiveis).toHaveLength(1);
    expect(etapaValida("nada")).toBe("acervo");
    const app = ler("src/App.tsx");
    expect(app).toContain('<Route path="/mesa-videos"');
    expect(app).toContain("<Suspense fallback={<EsqueletoDaMesa />}><MesaVideos /></Suspense>");
  });

  it("piso Safari 11 / Chrome 64 nos arquivos novos da tela", () => {
    for (const p of [
      "src/pages/MesaVideos.tsx",
      "src/components/mesa-videos/videosApi.ts",
      "src/components/mesa-videos/EtapaAcervo.tsx",
      "src/components/mesa-videos/EtapaHistoria.tsx",
      "src/components/mesa-videos/EtapaRoteiros.tsx",
      "src/components/mesa-videos/EtapaEdicao.tsx",
      "src/components/mesa-videos/EtapaMemoria.tsx",
      "supabase/functions/_shared/organizador-de-takes.ts",
      "supabase/functions/_shared/pacote-de-edicao.ts",
      "supabase/functions/_shared/pedidos-de-video.ts",
      "supabase/functions/_shared/memoria-de-video.ts",
      "supabase/functions/_shared/computador-do-agente.ts",
    ]) {
      const f = ler(p);
      expect(f, p).not.toMatch(/\(\?<[=!]/); // lookbehind
      expect(f, p).not.toMatch(/\(\?<[a-z]/i); // grupo nomeado
      expect(f, p).not.toMatch(/\\p\{/);
      expect(f, p).not.toMatch(/\.at\(/);
      expect(f, p).not.toMatch(/Object\.hasOwn\(/);
      if (p.indexOf("src/") === 0) expect(f, p).not.toMatch(/crypto\.randomUUID/);
      expect(f, p).not.toMatch(/[—–]/);
    }
  });
});

// ------------------------------------------------------------------ tela

const valorDaMesa = (): MesaValor => ({
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
});

function montar(filho: any, caminho = `/mesa-videos?client=${CLIENTE}`) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, { initialEntries: [caminho] }, h(TooltipProvider, null, filho))));
}

const chamadas = (acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[0] === "mesa-videos" && c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);

const ARQUIVOS = [
  { id: A1, client_id: CLIENTE, nome: "IMG_1.MOV", nome_original: "IMG_1.MOV", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/brutos/a.mov`, tipo: "bruto", melhor: false, estado: "ativo", duracao_s: 12, criado_em: "2026-09-25T10:00:00Z" },
  { id: A2, client_id: CLIENTE, nome: "IMG_2.MOV", nome_original: "IMG_2.MOV", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/brutos/b.mov`, tipo: "bruto", melhor: true, estado: "ativo", duracao_s: 9, criado_em: "2026-09-25T10:01:00Z" },
];

beforeEach(() => {
  vi.clearAllMocks();
  mock.tabelas = { video_arquivos: ARQUIVOS, cliente_imagens: [], video_pedidos: [], video_versoes: [], agente_computador_tarefas: [] };
  mock.erros = { roteiros_aprovados_para_video: { message: 'relation "public.roteiros_aprovados_para_video" does not exist', code: "42P01" } };
  mock.rpc.mockResolvedValue({ data: { saldo_usd: 10 }, error: null });
  mock.lista.mockResolvedValue({ data: [], error: null });
  mock.invoke.mockResolvedValue({ data: {}, error: null });
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

describe("tela da Mesa Vídeos", () => {
  it("abre com as cinco etapas, a troca de mesas e sem chamar a função (nada gasta ao abrir)", async () => {
    montar(h(MesaVideos));
    expect(await screen.findByRole("navigation", { name: "Etapas da Mesa Vídeos" })).toBeTruthy();
    for (const e of ETAPAS_DA_MESA_VIDEOS) expect(screen.getByRole("button", { name: new RegExp(e.rotulo) })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Trocar de mesa" })).toBeTruthy();
    expect(await screen.findByText("Fotos para vídeo")).toBeTruthy();
    expect(await screen.findByText("IMG_1.MOV")).toBeTruthy();
    expect(mock.invoke).not.toHaveBeenCalled();
  });

  it("sem o SQL V2-01, as gravações vêm da pasta do Storage e a tela avisa", async () => {
    mock.erros.video_arquivos = { message: 'relation "public.video_arquivos" does not exist', code: "42P01" };
    mock.lista.mockResolvedValue({ data: [{ name: "x1.mp4", created_at: "2026-09-25T10:00:00Z", metadata: { size: 2048, mimetype: "video/mp4" } }], error: null });
    montar(h(MesaVideos));
    expect(await screen.findByText("x1.mp4")).toBeTruthy();
    expect(document.querySelector("[data-aviso-de-ativacao]")).toBeTruthy();
  });

  it("Edição: o organizador propõe, a equipe confirma no cartão e o computador do agente está desligado", async () => {
    mock.invoke.mockImplementation((_f: string, { body }: any) => {
      if (body.acao === "takes_organizar_propor") {
        return Promise.resolve({
          data: {
            mensagem_id: "33333333-3333-4333-8333-333333333333",
            acao: {
              tipo: "acao_agente",
              agente: "organizador_de_takes",
              id: "org-1",
              resumo: "Organizar 2 takes.",
              itens: [{ ref: "t1", alvo_id: A1, titulo: "IMG_1.MOV", detalhe: null, operacao: "renomear", rotulo: "Renomear", para: "take_t01.mov" }],
              ignorados: [],
              recusados: [],
            },
          },
          error: null,
        });
      }
      if (body.acao === "executar_acao_agente") return Promise.resolve({ data: { anexo: { tipo: "acao_agente", agente: "organizador_de_takes", id: "org-1", resumo: "", itens: [], ignorados: [], recusados: [], executada_em: "agora", resultados: [] }, feitos: 1, falhas: 0 }, error: null });
      return Promise.resolve({ data: {}, error: null });
    });
    montar(h(MesaProvider, { valor: valorDaMesa(), children: h(EtapaEdicao) }));
    expect((await screen.findAllByText("IMG_1.MOV")).length).toBeGreaterThan(0);
    expect(document.querySelector('[data-computador-do-agente="desligado"]')).toBeTruthy();
    expect(screen.getByRole("button", { name: /Pedir tarefa/ }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Organizar por roteiro e cena/ }));
    await waitFor(() => expect(chamadas("takes_organizar_propor")).toEqual([{ acao: "takes_organizar_propor", client_id: CLIENTE }]));
    expect(await screen.findByText("take_t01.mov", { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(chamadas("executar_acao_agente")).toEqual([{ acao: "executar_acao_agente", mensagem_id: "33333333-3333-4333-8333-333333333333", acao_id: "org-1" }]));
    // A prévia do pacote já mostra o que falta, sem gastar.
    expect(document.querySelector("[data-previa-do-pacote]")!.textContent).toContain("Sincronia de áudio não medida");
  });

  it("marcar melhor take manda só o campo e oferece desfazer", async () => {
    mock.invoke.mockResolvedValue({ data: { arquivo: {}, desfazer: { melhor: false } }, error: null });
    montar(h(MesaProvider, { valor: valorDaMesa(), children: h(EtapaEdicao) }));
    fireEvent.click(await screen.findByRole("button", { name: "Marcar IMG_1.MOV como melhor" }));
    await waitFor(() => expect(chamadas("arquivo_editar")).toEqual([{ acao: "arquivo_editar", arquivo_id: A1, campos: { melhor: true } }]));
    const { toast } = await import("sonner");
    const aviso = (toast.success as any).mock.calls.find((c: any[]) => c[0] === "Marcado como melhor take");
    expect(aviso && aviso[1].action.label).toBe("Desfazer");
    aviso[1].action.onClick();
    await waitFor(() => expect(chamadas("arquivo_editar")[1]).toEqual({ acao: "arquivo_editar", arquivo_id: A1, campos: { melhor: false } }));
  });
});
