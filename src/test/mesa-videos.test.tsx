import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mesa Vídeos (frente V2, 25/09/2026; docs/mesa-videos/CONTRATO.md) e Mesa
 * Edição (frente E2, 26/09): filtro do acervo, organizador de takes
 * (normalização, melhores e desfazer), pacote para editar (a partir do projeto
 * de edição), memória de versões, pedidos preparados (com o modelo de vídeo),
 * fila do computador do agente (desligada), o agente das duas mesas, o fluxo
 * Vídeos -> Edição e a tela básica das duas mesas. A função mesa-videos, o
 * Storage e as tabelas são simulados.
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
import MesaEdicao from "@/pages/MesaEdicao";
import EtapaOrganizar from "@/components/mesa-edicao/EtapaOrganizar";
import EtapaEditar from "@/components/mesa-edicao/EtapaEditar";
import EtapaEntrada from "@/components/mesa-edicao/EtapaEntrada";
import EtapaResultados from "@/components/mesa-videos/EtapaResultados";
import { entradaDoPacote, projetoDaEntrada } from "@/components/mesa-edicao/pacote";
import { segundosDoTexto } from "@/components/mesa-edicao/Versoes";
import { ETAPAS_DA_MESA_EDICAO, etapaValidaDaEdicao } from "@/components/mesa-edicao/Comuns";
import { ETAPAS_DA_MESA_VIDEOS, etapaAntigaDaEdicao, etapaValida } from "@/components/mesa-videos/Comuns";
import { extensaoDoVideo, fotosParaVideo, historiasDasLinhas, naEntradaDaEdicao, normalizarArquivo, novoIdDoArquivo } from "@/components/mesa-videos/videosApi";
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
import { duracaoNoModelo, duracoesDoModelo, modeloDeVideo, modelosDeVideo, textoDasDuracoes, travaDePessoaReal } from "../../supabase/functions/_shared/modelos-de-video";
import { edlDoProjeto, normalizarProjeto, projetoDosTakes, proximaRevisao, duracaoDoProjeto } from "../../supabase/functions/_shared/projeto-de-edicao";
import { acaoDoEnvioParaEdicao, camposDoEnvio, INTENCOES, intencaoPorPalavras, perguntaDaIntencao } from "../../supabase/functions/_shared/agente-de-video";

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

  it("com melhores (Mesa Edição), sugere o último take de cada cena sem melhor e trava o que já é melhor", () => {
    const takes = [
      take(A1, { roteiro_id: ROTEIRO, cena_ref: "produto", nome: "tk1.mov", nome_original: "take 1.mov" }),
      take(A2, { roteiro_id: ROTEIRO, cena_ref: "produto", nome: "tk2.mov", nome_original: "take 2.mov" }),
      take(A3, { roteiro_id: ROTEIRO, cena_ref: "abertura", nome: "A.mp4", nome_original: "A.mp4", melhor: true }),
    ];
    // Sem a opção, nada de melhor (o organizador de antes continua igual).
    expect(proporOrganizacao(takes, ROTEIROS).some((i) => i.operacao === "marcar_melhor")).toBe(false);
    const itens = proporOrganizacao(takes, ROTEIROS, { melhores: true });
    expect(itens.filter((i) => i.operacao === "marcar_melhor")).toEqual([{ arquivo_id: A2, operacao: "marcar_melhor", para: "" }]);
    const acao = acaoDaOrganizacao(takes, itens, ROTEIROS)!;
    expect(acao.itens.some((i) => i.operacao === "marcar_melhor" && i.rotulo === "Marcar como melhor")).toBe(true);
    const travada = acaoDaOrganizacao(takes, [{ arquivo_id: A3, operacao: "marcar_melhor", para: "" }], ROTEIROS)!;
    expect(travada.recusados[0].motivo).toMatch(/Já é o melhor/);
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

  it("o edl.json e o projeto.json saem do projeto de edição (o que o editor vai abrir)", () => {
    const p = montarPacote(entrada);
    const projeto = JSON.parse(p.arquivos["projeto.json"]);
    expect(projeto.trilhas.map((t: { tipo: string }) => t.tipo)).toEqual(["video", "texto", "legenda", "audio", "sobreposicao"]);
    expect(projeto.trilhas[0].clipes).toEqual([expect.objectContaining({ fonte: "cafe-c01-t02", inicio_s: 0, entrada_s: 0, saida_s: 7.5 })]);
    // Projeto editado (corte e texto): o edl.json segue o projeto.
    const editado = normalizarProjeto({
      ...projeto,
      trilhas: [
        { ...projeto.trilhas[0], clipes: [{ ...projeto.trilhas[0].clipes[0], entrada_s: 1, saida_s: 5 }] },
        { tipo: "texto", clipes: [{ id: "t1", inicio_s: 0.5, entrada_s: 0, saida_s: 2, texto: "Bom dia" }] },
      ],
    })!;
    const edl = JSON.parse(montarPacote({ ...entrada, projeto: editado }).arquivos["edl.json"]);
    expect(edl.ranges).toEqual([{ source: "cafe-c01-t02", start: 1, end: 5 }]);
    expect(edl.overlays).toEqual([{ tipo: "texto", start: 0.5, end: 2.5, texto: "Bom dia", source: null }]);
    expect(edl.total_duration_s).toBe(4);
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
    // O projeto da tela: os melhores; sem melhor, todos (com duração) na ordem das cenas.
    expect(entradaDoPacote({ ...base, quais: "todos" }).projeto!.trilhas[0].clipes.map((c) => c.fonte)).toEqual(["cafe-c01-t02"]);
    expect(projetoDaEntrada({ ...entradaDoPacote({ ...base, arquivos: semMelhor, quais: "todos" }) }).trilhas[0].clipes).toHaveLength(2);
    // Gerado só entra depois de aprovado para a Edição.
    const gerado = normalizarArquivo({ ...takes[0], id: A4, tipo: "gerado", estado: "ativo", criado_em: "", melhor: false })!;
    expect(entradaDoPacote({ ...base, arquivos: [gerado], roteiro: null, quais: "todos" }).takes).toHaveLength(0);
    expect(entradaDoPacote({ ...base, arquivos: [{ ...gerado, edicao_desde: "2026-09-26T00:00:00Z" }], roteiro: null, quais: "todos" }).takes).toHaveLength(1);
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

// ------------------------------------------------------------------ frente E2: modelos, projeto e agente

describe("modelos de vídeo (Mesa Vídeos, Gerar)", () => {
  it("catálogo documentado, nenhum ligado sem motor no ia_modelos, e a duração presa ao que o modelo aceita", () => {
    const lista = modelosDeVideo([{ id: "texto-1", tipo: "texto", ativo: true }]);
    expect(lista.map((m) => m.id)).toEqual(["veo-3.1", "kling-3", "seedance-2", "runway-gen4"]);
    expect(lista.every((m) => !m.ligado)).toBe(true);
    const veo = modeloDeVideo("veo-3.1")!;
    expect(duracoesDoModelo(veo)).toEqual([4, 6, 8]);
    expect(duracaoNoModelo(veo, 5)).toBe(4);
    expect(duracaoNoModelo(veo, 15)).toBe(8);
    expect(textoDasDuracoes(veo)).toBe("4, 6 ou 8 s");
    expect(travaDePessoaReal(modeloDeVideo("seedance-2"), true)).toMatch(/pessoa real/);
    expect(travaDePessoaReal(veo, true)).toBeNull();
    // Motor ligado no catálogo aparece como ligado; motor extra entra no fim.
    const ligados = modelosDeVideo([{ id: "google-veo-3.1", tipo: "video", ativo: true, rotulo: "Veo 3.1" }, { id: "outro", tipo: "video", ativo: true, rotulo: "Outro" }]);
    expect(ligados.find((m) => m.id === "veo-3.1")!.motor_id).toBe("google-veo-3.1");
    expect(ligados[ligados.length - 1]).toEqual(expect.objectContaining({ id: "outro", ligado: true }));
  });

  it("pedido com modelo: a duração segue o modelo, cena de roteiro vira gerar_cena e nunca custa US$ 0", () => {
    const p = normalizarParametros("animar_cena", { duracao_s: 7, modelo: "veo-3.1", formato: "9:16" }) as { duracao_s: number; modelo: string; formato: string };
    expect(p.duracao_s).toBe(6);
    expect(p.modelo).toBe("veo-3.1");
    const g = normalizarParametros("gerar_cena", { duracao_s: 10, modelo: "seedance-2", descricao: "Café na mesa", formato: "quadrado" }) as { duracao_s: number; descricao: string; formato: string };
    expect(g).toEqual(expect.objectContaining({ duracao_s: 10, descricao: "Café na mesa", formato: "9:16" }));
    const e = estimarPedido("gerar_cena", g as never);
    expect(e.partes[1]).toEqual(expect.objectContaining({ usd: null, detalhe: expect.stringContaining("Seedance 2.0") }));
    expect(executorDoPedido("gerar_cena", []).estado).toBe("em_breve");
    expect(chaveDoPedido("gerar_cena", { roteiro_id: ROTEIRO, cena_ref: "a" }, g as never)).not.toBe(chaveDoPedido("gerar_cena", { roteiro_id: ROTEIRO, cena_ref: "b" }, g as never));
  });
});

describe("projeto de edição (base do editor completo)", () => {
  const takes = [
    { id: A1, nome: "cafe_c01_t02.mov", tipo: "bruto", storage_bucket: "mesa", storage_path: "x/a.mov", cena_ref: "abertura", melhor: true, duracao_s: 7.5, largura: 1080, altura: 1920 },
    { id: A2, nome: "cafe_c02_t01.mov", tipo: "bruto", storage_bucket: "mesa", storage_path: "x/b.mov", cena_ref: "produto", melhor: true, duracao_s: 3.25, largura: 1080, altura: 1920 },
    { id: A3, nome: "sem-duracao.mov", tipo: "bruto", storage_bucket: "mesa", storage_path: "x/c.mov", cena_ref: null, melhor: true, duracao_s: null, largura: null, altura: null },
  ];

  it("primeira montagem: takes em sequência na trilha de vídeo, cinco trilhas, formato e fps", () => {
    const p = projetoDosTakes({ titulo: "Reel", formato: "9:16", fps: null, takes });
    expect(p.largura).toBe(1080);
    expect(p.altura).toBe(1920);
    expect(p.fps).toBe(25);
    expect(p.fps_informado).toBe(false);
    expect(Object.keys(p.fontes)).toEqual(["cafe-c01-t02", "cafe-c02-t01", "sem-duracao"]);
    expect(p.trilhas[0].clipes.map((c) => [c.fonte, c.inicio_s, c.saida_s])).toEqual([
      ["cafe-c01-t02", 0, 7.5],
      ["cafe-c02-t01", 7.5, 3.25],
    ]);
    expect(p.duracao_s).toBe(10.75);
    const edl = edlDoProjeto(p);
    expect(Object.keys(edl)).toEqual(["version", "sources", "fps", "ranges", "grade", "overlays", "total_duration_s", "note"]);
    expect(edl.total_duration_s).toBe(10.75);
    expect(edl.note).toContain("FPS 25 provisório");
  });

  it("valida o que vem de fora: fonte desconhecida, trecho vazio, velocidade e tipos fora da lista", () => {
    const p = normalizarProjeto({
      formato: "16:9",
      fps: 30,
      fontes: { a: { nome: "a.mov", duracao_s: 10 } },
      trilhas: [
        { tipo: "video", clipes: [{ fonte: "a", inicio_s: 0, entrada_s: 2, saida_s: 6, velocidade: 2 }, { fonte: "zzz", inicio_s: 4, entrada_s: 0, saida_s: 1 }, { fonte: "a", entrada_s: 3, saida_s: 3 }] },
        { tipo: "efeito_magico", clipes: [] },
        { tipo: "legenda", clipes: [{ inicio_s: 0, entrada_s: 0, saida_s: 1.5, texto: "Oi", transicao_entrada: { tipo: "fade", duracao_s: 9 } }] },
      ],
    })!;
    expect(p.largura).toBe(1920);
    expect(p.trilhas.map((t) => t.tipo)).toEqual(["video", "legenda"]);
    expect(p.trilhas[0].clipes).toHaveLength(2);
    expect(p.trilhas[0].clipes[1].fonte).toBeNull();
    expect(p.trilhas[1].clipes[0].transicao_entrada).toEqual({ tipo: "fade", duracao_s: 5 });
    expect(duracaoDoProjeto(p.trilhas)).toBe(5);
    expect(normalizarProjeto({ trilhas: "x" })).toBeNull();
  });

  it("revisão sobe a cada gravação e a trava otimista recusa quem leu uma revisão velha", () => {
    const p = projetoDosTakes({ titulo: "Reel", takes });
    const r1 = proximaRevisao(null, p, null, "t1");
    expect(r1.revisao).toBe(1);
    const r2 = proximaRevisao(r1, p, 1, "t2");
    expect(r2.revisao).toBe(2);
    expect(() => proximaRevisao(r2, p, 1, "t3")).toThrow(/mudou/);
  });
});

describe("agente das mesas de vídeo", () => {
  it("entende pelas palavras quando o Jev não responde, e a pergunta do Jev tem a saída nenhuma", () => {
    expect(intencaoPorPalavras("edicao", "organiza tudo por cena")).toBe("organizar");
    expect(intencaoPorPalavras("edicao", "quero transcrever os vídeos")).toBe("transcrever");
    expect(intencaoPorPalavras("edicao", "abre o pacote pro Remotion")).toBe("pacote");
    expect(intencaoPorPalavras("videos", "manda os aprovados para a edição")).toBe("enviar_para_edicao");
    expect(intencaoPorPalavras("videos", "gera a próxima cena")).toBe("gerar");
    expect(intencaoPorPalavras("videos", "bom dia")).toBe("nenhuma");
    const q = perguntaDaIntencao("videos", "o que falta?");
    expect(Object.keys(q.questions.intencao.criteria)).toEqual(INTENCOES.videos.map((i) => i.valor).concat(["nenhuma"]));
    expect(q.questions.intencao.type).toBe("choice");
  });

  it("mandar para a Edição: só gerados fora da Edição, com apelidos e Desfazer", () => {
    const acao = acaoDoEnvioParaEdicao([
      { id: A1, nome: "v1.mp4", tipo: "gerado", estado: "ativo", edicao_desde: null },
      { id: A2, nome: "v2.mp4", tipo: "gerado", estado: "ativo", edicao_desde: "2026-09-26" },
      { id: A3, nome: "bruto.mov", tipo: "bruto", estado: "ativo", edicao_desde: null },
    ])!;
    expect(acao.agente).toBe("envio_para_edicao");
    expect(acao.itens.map((i) => `${i.ref}:${i.alvo_id}:${i.operacao}`)).toEqual([`r1:${A1}:enviar_para_edicao`]);
    expect(camposDoEnvio("enviar_para_edicao", "agora")).toEqual({ edicao_desde: "agora" });
    expect(acaoDoEnvioParaEdicao([])).toBeNull();
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

describe("Mesa Vídeos e Mesa Edição no esqueleto das mesas", () => {
  it("rota, pré-carga, troca, seletor de clientes e etapas (7 mesas)", () => {
    expect(MESAS_DO_PAINEL["/mesa-videos"].prefixo).toBe("mesa-videos");
    expect(Object.keys(MESAS_DO_PAINEL["/mesa-videos"].etapas)).toEqual(ETAPAS_DA_MESA_VIDEOS.map((e) => e.valor));
    expect(Object.keys(MESAS_DO_PAINEL["/mesa-videos"].etapas)).toEqual(["base", "kit", "biblia", "roteiro", "gerar", "resultados"]);
    expect(etapaQueVaiAbrir("/mesa-videos", `?client=${CLIENTE}&etapa=gerar`)).toBe("gerar");
    expect(etapaQueVaiAbrir("/mesa-videos", `?client=${CLIENTE}`)).toBe("base");
    expect(cargasDaMesa("/mesa-videos", `?client=${CLIENTE}&etapa=resultados`).map(([k]) => k)).toEqual(["pagina/mesa-videos", "mesa-videos/resultados", "mesa-videos/agente"]);
    // Mesa Edição
    expect(Object.keys(MESAS_DO_PAINEL["/mesa-edicao"].etapas)).toEqual(ETAPAS_DA_MESA_EDICAO.map((e) => e.valor));
    expect(etapaQueVaiAbrir("/mesa-edicao", `?client=${CLIENTE}`)).toBe("entrada");
    expect(cargasDaMesa("/mesa-edicao", `?client=${CLIENTE}&etapa=editar`).map(([k]) => k)).toEqual(["pagina/mesa-edicao", "mesa-edicao/editar", "mesa-edicao/agente"]);
    expect(etapaValidaDaEdicao("nada")).toBe("entrada");
    expect(MESAS.map((m) => m.valor)).toEqual(["mesa", "ads", "foto", "videos", "edicao", "publicidade", "roteiros"]);
    expect(enderecoDaMesa("videos", CLIENTE)).toBe(`/mesa-videos?client=${CLIENTE}`);
    expect(enderecoDaMesa("edicao", CLIENTE)).toBe(`/mesa-edicao?client=${CLIENTE}`);
    expect(NOME_DA_MESA.videos).toBe("Mesa Vídeos");
    expect(NOME_DA_MESA.edicao).toBe("Mesa Edição");
    expect(montarClientesDaMesa("videos", [{ id: CLIENTE, company_name: "A", plan_status: "active" }], []).visiveis).toHaveLength(1);
    expect(montarClientesDaMesa("edicao", [{ id: CLIENTE, company_name: "A", plan_status: "active" }], []).visiveis).toHaveLength(1);
    // Etapas antigas: acervo, história e roteiros viram a Base; edição e versões vão para a Mesa Edição.
    expect(etapaValida("nada")).toBe("base");
    expect(etapaValida("acervo")).toBe("base");
    expect(etapaAntigaDaEdicao("edicao")).toBe("organizar");
    expect(etapaAntigaDaEdicao("memoria")).toBe("editar");
    expect(etapaAntigaDaEdicao("base")).toBeNull();
    const app = ler("src/App.tsx");
    expect(app).toContain('<Route path="/mesa-videos"');
    expect(app).toContain("<Suspense fallback={<EsqueletoDaMesa />}><MesaVideos /></Suspense>");
    expect(app).toContain('<Route path="/mesa-edicao"');
    expect(app).toContain("<Suspense fallback={<EsqueletoDaMesa />}><MesaEdicao /></Suspense>");
  });

  it("piso Safari 11 / Chrome 64 nos arquivos novos da tela", () => {
    for (const p of [
      "src/pages/MesaVideos.tsx",
      "src/pages/MesaEdicao.tsx",
      "src/components/mesa-videos/videosApi.ts",
      "src/components/mesa-videos/MesaDeVideo.tsx",
      "src/components/mesa-videos/EtapaBase.tsx",
      "src/components/mesa-videos/EtapaGerar.tsx",
      "src/components/mesa-videos/EtapaResultados.tsx",
      "src/components/mesa-videos/AgenteDaMesaDeVideo.tsx",
      "src/components/mesa-edicao/EtapaEntrada.tsx",
      "src/components/mesa-edicao/EtapaOrganizar.tsx",
      "src/components/mesa-edicao/EtapaEditar.tsx",
      "src/components/mesa-edicao/AreaDoEditor.tsx",
      "src/components/mesa-edicao/Versoes.tsx",
      "src/components/mesa-edicao/pacote.ts",
      "supabase/functions/_shared/modelos-de-video.ts",
      "supabase/functions/_shared/projeto-de-edicao.ts",
      "supabase/functions/_shared/agente-de-video.ts",
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

describe("tela da Mesa Vídeos (geração)", () => {
  it("abre com as três etapas, a troca de mesas, o agente fixo e sem chamar a função (nada gasta ao abrir)", async () => {
    montar(h(MesaVideos));
    expect(await screen.findByRole("navigation", { name: "Etapas da Mesa Vídeos" })).toBeTruthy();
    for (const e of ETAPAS_DA_MESA_VIDEOS) expect(screen.getByRole("button", { name: new RegExp(e.rotulo) })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Mesa aberta: Mesa Vídeos/ }));
    const troca = await screen.findByRole("navigation", { name: "Trocar de mesa" });
    expect(troca.querySelectorAll("[data-item-de-mesa], a").length).toBeGreaterThanOrEqual(7);
    fireEvent.keyDown(document.activeElement || document.body, { key: "Escape" });
    // A lista das mesas (popover) pode seguir aberta: consulta também o que ela esconde.
    expect(await screen.findByRole("tab", { name: /Cenas/, hidden: true }, { timeout: 5000 })).toBeTruthy();
    expect(await screen.findByText("Agente de vídeo", undefined, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Pedido para o agente", hidden: true })).toBeTruthy();
    expect(mock.invoke).not.toHaveBeenCalled();
  });

  it("endereço antigo de edição abre a Mesa Edição no Organizar", async () => {
    function Onde() {
      const l = useLocation();
      return h("p", { "data-testid": "onde" }, `${l.pathname}${l.search}`);
    }
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      h(
        QueryClientProvider,
        { client: qc },
        h(MemoryRouter, { initialEntries: [`/mesa-videos?client=${CLIENTE}&etapa=edicao`] }, h(TooltipProvider, null, h(Routes, null, h(Route, { path: "/mesa-videos", element: h(MesaVideos) }), h(Route, { path: "*", element: h(Onde) })))),
      ),
    );
    await waitFor(() => expect(screen.getByTestId("onde").textContent).toBe(`/mesa-edicao?client=${CLIENTE}&etapa=organizar`));
  });

  it("Resultados: aprovar manda o vídeo gerado para a Edição, com Desfazer", async () => {
    mock.tabelas.video_arquivos = [...ARQUIVOS, { id: A3, client_id: CLIENTE, nome: "cena1_gerada.mp4", nome_original: "cena1_gerada.mp4", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/brutos/g.mp4`, tipo: "gerado", melhor: false, estado: "ativo", criado_em: "2026-09-26T10:00:00Z", edicao_desde: null }];
    montar(h(MesaProvider, { valor: valorDaMesa(), children: h(EtapaResultados, { irPara: vi.fn() }) }));
    fireEvent.click(await screen.findByRole("button", { name: "Aprovar cena1_gerada.mp4 e mandar para a Edição" }));
    await waitFor(() => expect(chamadas("arquivo_editar")).toEqual([{ acao: "arquivo_editar", arquivo_id: A3, campos: { na_edicao: true } }]));
    const { toast } = await import("sonner");
    const aviso = (toast.success as any).mock.calls.find((c: any[]) => c[0] === "Aprovado e na Edição");
    aviso[1].action.onClick();
    await waitFor(() => expect(chamadas("arquivo_editar")[1]).toEqual({ acao: "arquivo_editar", arquivo_id: A3, campos: { na_edicao: false } }));
    // Os brutos (gravações de fora) não aparecem nos Resultados.
    expect(screen.queryByText("IMG_1.MOV")).toBeNull();
  });
});

describe("tela da Mesa Edição", () => {
  it("abre com as três etapas e o agente de edição, sem chamar a função", async () => {
    montar(h(MesaEdicao), `/mesa-edicao?client=${CLIENTE}`);
    expect(await screen.findByRole("navigation", { name: "Etapas da Mesa Edição" })).toBeTruthy();
    for (const e of ETAPAS_DA_MESA_EDICAO) expect(screen.getByRole("button", { name: new RegExp(e.rotulo) })).toBeTruthy();
    expect(await screen.findByText("IMG_1.MOV")).toBeTruthy();
    expect(await screen.findByText("Agente de edição")).toBeTruthy();
    expect(mock.invoke).not.toHaveBeenCalled();
  });

  it("fluxo Vídeos -> Edição: o gerado aprovado entra na Entrada; o não aprovado fica só nos Resultados", async () => {
    const gerado = { id: A3, client_id: CLIENTE, nome: "aprovado.mp4", nome_original: "aprovado.mp4", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/brutos/g.mp4`, tipo: "gerado", melhor: false, estado: "ativo", criado_em: "2026-09-26T10:00:00Z", edicao_desde: "2026-09-26T11:00:00Z" };
    const naoAprovado = { ...gerado, id: A4, nome: "pendente.mp4", edicao_desde: null };
    expect(naEntradaDaEdicao(normalizarArquivo(gerado)!)).toBe(true);
    expect(naEntradaDaEdicao(normalizarArquivo(naoAprovado)!)).toBe(false);
    mock.tabelas.video_arquivos = [...ARQUIVOS, gerado, naoAprovado];
    montar(h(MesaProvider, { valor: valorDaMesa(), children: h(EtapaEntrada, { irPara: vi.fn() }) }));
    expect(await screen.findByText("aprovado.mp4")).toBeTruthy();
    expect(screen.getByText("Da Mesa Vídeos")).toBeTruthy();
    expect(screen.queryByText("pendente.mp4")).toBeNull();
    expect(screen.getByText("IMG_1.MOV")).toBeTruthy();
  });

  it("sem o SQL V2-01, os vídeos vêm da pasta do Storage e a tela avisa", async () => {
    mock.erros.video_arquivos = { message: 'relation "public.video_arquivos" does not exist', code: "42P01" };
    mock.lista.mockResolvedValue({ data: [{ name: "x1.mp4", created_at: "2026-09-25T10:00:00Z", metadata: { size: 2048, mimetype: "video/mp4" } }], error: null });
    montar(h(MesaEdicao), `/mesa-edicao?client=${CLIENTE}`);
    expect(await screen.findByText("x1.mp4")).toBeTruthy();
    expect(document.querySelector("[data-aviso-de-ativacao]")).toBeTruthy();
  });

  it("Editar: área do editor reservada com a linha do tempo, pacote com pendências e o computador do agente desligado", async () => {
    montar(h(MesaProvider, { valor: valorDaMesa(), children: h(EtapaEditar, { irPara: vi.fn() }) }));
    await waitFor(() => expect(document.querySelector('[data-area-do-editor="reservada"]')).toBeTruthy());
    expect(document.querySelectorAll("[data-trilha]").length).toBe(5);
    expect(document.querySelector("[data-previa-do-pacote]")!.textContent).toContain("Sincronia de áudio não medida");
    expect(document.querySelector('[data-computador-do-agente="desligado"]')).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pedir tarefa" }).hasAttribute("disabled")).toBe(true);
    // Salvar versão leva o projeto junto.
    fireEvent.click(screen.getByRole("button", { name: "Salvar como versão" }));
    await waitFor(() => expect(chamadas("versao_registrar")).toHaveLength(1));
    const corpo = chamadas("versao_registrar")[0];
    expect(corpo.projeto.trilhas[0].clipes.map((c: { fonte: string }) => c.fonte)).toEqual(["img-2"]);
    expect(corpo.estado).toBe("rascunho");
  });

  it("Organizar: o organizador propõe, a equipe confirma no cartão", async () => {
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
    montar(h(MesaProvider, { valor: valorDaMesa(), children: h(EtapaOrganizar, { irPara: vi.fn() }) }));
    expect((await screen.findAllByText("IMG_1.MOV")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Organizar por roteiro e cena/ }));
    await waitFor(() => expect(chamadas("takes_organizar_propor")).toEqual([{ acao: "takes_organizar_propor", client_id: CLIENTE }]));
    expect(await screen.findByText("take_t01.mov", { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(chamadas("executar_acao_agente")).toEqual([{ acao: "executar_acao_agente", mensagem_id: "33333333-3333-4333-8333-333333333333", acao_id: "org-1" }]));
  });

  it("marcar melhor take manda só o campo e oferece desfazer", async () => {
    mock.invoke.mockResolvedValue({ data: { arquivo: {}, desfazer: { melhor: false } }, error: null });
    montar(h(MesaProvider, { valor: valorDaMesa(), children: h(EtapaOrganizar, { irPara: vi.fn() }) }));
    fireEvent.click(await screen.findByRole("button", { name: "Marcar IMG_1.MOV como melhor" }));
    await waitFor(() => expect(chamadas("arquivo_editar")).toEqual([{ acao: "arquivo_editar", arquivo_id: A1, campos: { melhor: true } }]));
    const { toast } = await import("sonner");
    const aviso = (toast.success as any).mock.calls.find((c: any[]) => c[0] === "Marcado como melhor take");
    expect(aviso && aviso[1].action.label).toBe("Desfazer");
    aviso[1].action.onClick();
    await waitFor(() => expect(chamadas("arquivo_editar")[1]).toEqual({ acao: "arquivo_editar", arquivo_id: A1, campos: { melhor: false } }));
  });
});

describe("agente de edição na tela", () => {
  it("atalho Organizar tudo propõe pelo contrato comum (sem Jev) e mostra o cartão para confirmar", async () => {
    mock.invoke.mockImplementation((_f: string, { body }: any) => {
      if (body.acao === "takes_organizar_propor") {
        return Promise.resolve({
          data: {
            mensagem_id: "44444444-4444-4444-8444-444444444444",
            acao: { tipo: "acao_agente", agente: "organizador_de_takes", id: "org-2", resumo: "Organizar 1 take.", itens: [{ ref: "t1", alvo_id: A1, titulo: "IMG_1.MOV", detalhe: null, operacao: "renomear", rotulo: "Renomear", para: "take_t01.mov" }], ignorados: [], recusados: [] },
          },
          error: null,
        });
      }
      return Promise.resolve({ data: {}, error: null });
    });
    montar(h(MesaEdicao), `/mesa-edicao?client=${CLIENTE}`);
    fireEvent.click(await screen.findByRole("button", { name: "Organizar tudo" }));
    await waitFor(() => expect(chamadas("takes_organizar_propor")).toHaveLength(1));
    expect(chamadas("agente_entender")).toHaveLength(0);
    expect((await screen.findAllByText("Organizar 1 take.")).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Confirmar" }).length).toBeGreaterThan(0);
  });

  it("texto livre passa pela função (Jev) e abre a etapa pedida", async () => {
    mock.invoke.mockImplementation((_f: string, { body }: any) => Promise.resolve({ data: body.acao === "agente_entender" ? { intencao: "versoes", confianca: 0.9, via: "jev" } : {}, error: null }));
    montar(h(MesaEdicao), `/mesa-edicao?client=${CLIENTE}`);
    const campo = await screen.findByRole("textbox", { name: "Pedido para o agente" });
    fireEvent.change(campo, { target: { value: "quero ver as versões do reel" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(chamadas("agente_entender")).toEqual([{ acao: "agente_entender", client_id: CLIENTE, mesa: "edicao", texto: "quero ver as versões do reel" }]));
    expect(await screen.findByText("Abri as versões.")).toBeTruthy();
  });
});
