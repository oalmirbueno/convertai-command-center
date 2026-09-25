import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Canvas v3 da Mesa Foto (pedidos do dono, 25/09): composição genérica
 * (Pessoa real com autorização, Ambiente em 3 modos, Agente que escreve o
 * pedido), ação e pose do Resultado, variações e carrossel com foto base e
 * ângulo obrigatório, esteira de produtos de outros clientes, modelos prontos
 * e "montar pelo contexto", Usar na Mesa em 1 clique, modo foco e tela cheia.
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  rpc: vi.fn(),
  tabelas: {} as Record<string, unknown>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range", "update", "insert"]) b[m] = () => b;
    const primeiro = () => ({ data: Array.isArray(dados) ? (dados[0] === undefined ? null : dados[0]) : dados, error: null });
    b.maybeSingle = () => Promise.resolve(primeiro());
    b.single = () => Promise.resolve(primeiro());
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null, count: Array.isArray(dados) ? dados.length : 0 }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: mock.rpc,
      from: (tabela: string) => consulta(tabela),
      storage: {
        from: () => ({
          upload: vi.fn(),
          createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/img.png" }, error: null }),
          createSignedUrls: () => Promise.resolve({ data: [], error: null }),
        }),
      },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));
vi.mock("@/hooks/useSupabaseData", () => ({
  useClients: () => ({
    data: [
      { id: "11111111-1111-1111-1111-111111111111", company_name: "Ótica Sintética" },
      { id: "22222222-2222-2222-2222-222222222222", company_name: "Loja Parceira" },
    ],
    isLoading: false,
    isSuccess: true,
  }),
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import type { ModeloIa } from "@/lib/mesa/api";
import { MesaFotoProvider, type MesaFotoValor } from "@/components/mesa-foto/Comuns";
import EtapaCanvas from "@/components/mesa-foto/EtapaCanvas";
import { esquecerAndamentos } from "@/components/mesa-foto/modelosApi";
import {
  ACOES_DO_RESULTADO as ACOES_DA_TELA,
  ANGULOS_DE_VARIACAO as ANGULOS_DA_TELA,
  aplicarModeloPronto,
  aplicarRespostaDoAgente,
  canvasVazio,
  corpoDoAgente,
  corpoDoCanvas,
  corpoDoPedidoDoCanvas,
  faltaNoCartao,
  ligar,
  MODELOS_PRONTOS,
  montarPelaResposta,
  normalizarCanvas,
  normalizarRespostaDoAgente,
  novoNo,
  partesDoResultado,
  POSES_DO_RESULTADO as POSES_DA_TELA,
  TIPO_NA_FUNCAO,
  TIPOS_DE_NO,
  type Canvas,
} from "@/components/mesa-foto/canvasApi";
import { gerarNoResultado, gerarVariacoes, tirarPendentes } from "@/components/mesa-foto/canvas/geracao";
import {
  ACOES_DO_RESULTADO,
  ambienteDoContexto,
  ANGULOS_DE_VARIACAO,
  CHAVES_DOS_MODELOS_PRONTOS,
  dadosDoNo,
  entradasDaSaida,
  garantirQueDaParaGerar,
  historicoDoAgente,
  LENTE_UGC,
  normalizarCanvas as normalizarCanvasNaFuncao,
  ordenarComBase,
  POSES_DO_RESULTADO,
  promptDoCanvas,
  respostaDoAgente,
  resultadosDaSaida,
  textosDasEntradas,
  TIPOS_DE_NO as TIPOS_NA_FUNCAO,
} from "../../supabase/functions/mesa-foto/canvas-regras";

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const OUTRO = "22222222-2222-2222-2222-222222222222";
const KIT = "bbbbbbbb-0000-4000-8000-000000000001";
const KIT_DE_FORA = "bbbbbbbb-0000-4000-8000-000000000009";
const F1 = "aaaaaaaa-0000-4000-8000-000000000001";
const F2 = "aaaaaaaa-0000-4000-8000-000000000002";
const P1 = "dddddddd-0000-4000-8000-000000000001";
const ANCORA = "eeeeeeee-0000-4000-8000-000000000001";
const CANVAS = "ffffffff-0000-4000-8000-000000000001";
const GPT = "openrouter:openai/gpt-image-2.5-sunburst";

const imagemDoCatalogo = (id: string, api: string, preco: number, padrao = false): ModeloIa => ({
  id,
  provedor: "openrouter",
  modelo_api: api,
  tipo: "imagem",
  rotulo: api,
  preco_entrada_1m: null,
  preco_saida_1m: null,
  preco_cache_1m: null,
  preco_imagem: { baixa: preco / 4, media: preco / 2, alta: preco },
  raciocinio: [],
  padrao_para: padrao ? ["imagem"] : [],
  ativo: true,
});

const catalogo: ModeloIa[] = [
  {
    id: "openai:gpt-texto", provedor: "openai", modelo_api: "gpt-texto", tipo: "texto", rotulo: "Texto",
    preco_entrada_1m: 1, preco_saida_1m: 2, preco_cache_1m: null, preco_imagem: null,
    raciocinio: [], padrao_para: ["estrategista", "diretor_arte", "leitura"], ativo: true,
  },
  imagemDoCatalogo(GPT, "openai/gpt-image-2.5-sunburst", 0.1, true),
];

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Ótica Sintética",
  userId: "u-1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 50,
  catalogo,
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
});

const valorDaFoto = (): MesaFotoValor => ({
  kitId: null,
  ensaioId: null,
  imagemId: null,
  escolherKit: vi.fn(),
  escolherEnsaio: vi.fn(),
  irPara: vi.fn(),
  selecionadas: [],
  setSelecionadas: vi.fn(),
  abrirAgente: vi.fn(),
});

function montar(filho: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(
      QueryClientProvider,
      { client: qc },
      h(MemoryRouter, { initialEntries: [`/mesa-foto?client=${CLIENTE}`] }, h(TooltipProvider, null, h(MesaProvider, { valor: valorDaMesa(), children: h(MesaFotoProvider, { valor: valorDaFoto(), children: filho }) }))),
    ),
  );
}

const chamadasDe = (acao: string) =>
  mock.invoke.mock.calls.filter((c: any[]) => c[0] === "mesa-foto" && c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);

let respostas: Record<string, any> = {};

beforeAll(() => {
  class Observador {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as any).ResizeObserver = Observador;
  if (!(globalThis as any).DOMMatrixReadOnly) {
    (globalThis as any).DOMMatrixReadOnly = class {
      m22: number;
      constructor(t?: string) {
        const m = typeof t === "string" ? /scale\(([0-9.]+)\)/.exec(t) : null;
        this.m22 = m ? Number(m[1]) : 1;
      }
    };
  }
  Object.defineProperties(HTMLElement.prototype, {
    offsetHeight: { configurable: true, get() { return parseFloat((this as HTMLElement).style.height) || 1; } },
    offsetWidth: { configurable: true, get() { return parseFloat((this as HTMLElement).style.width) || 1; } },
  });
  (SVGElement.prototype as any).getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 });
  if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => {};
  if (!(Element.prototype as any).hasPointerCapture) (Element.prototype as any).hasPointerCapture = () => false;
});

const PERSONA = {
  id: P1,
  client_id: CLIENTE,
  nome: "Marina",
  ficha: { idade_aparente: 29, tom_de_pele: "morena clara" },
  invariantes: [],
  status: "pronta",
  ancora_imagem_id: ANCORA,
  versao: 1,
  etica: { sintetica: true, adulta: true },
  atualizado_em: "2026-09-24T10:00:00Z",
};

const CANVAS_BRUTO = {
  id: CANVAS,
  client_id: CLIENTE,
  nome: "Óculos na praia",
  versao: 2,
  status: "ativo",
  atualizado_em: "2026-09-25T12:00:00Z",
  viewport: { x: 0, y: 0, zoom: 1 },
  nos: [
    { id: "no-produto", tipo: "produto", x: 0, y: 0, dados: { kit_id: KIT } },
    { id: "no-saida", tipo: "saida", x: 380, y: 40, dados: { motores: [GPT], formato: "4:5", qualidade: "alta" } },
  ],
  ligacoes: [{ id: "l1", de: "no-produto", para: "no-saida", ordem: 0 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  esquecerAndamentos();
  respostas = {};
  tirarPendentes(CANVAS);
  document.body.removeAttribute("data-modo-foco");
  mock.tabelas = {
    cliente_imagens: [{ id: F1, client_id: CLIENTE, nome: "loja.jpg", storage_bucket: "mesa", storage_path: `${CLIENTE}/foto/originais/${F1}.jpg`, origem: "mesa_foto", tags: [], criado_em: "2026-09-25T10:00:00Z" }],
    foto_kits: [{ id: KIT, client_id: CLIENTE, tipo: "moda", nome: "Óculos Aro Fino", frente_imagem_id: F1, status: "confirmado", atualizado_em: "2026-09-25T10:00:00Z" }],
    foto_kit_refs: [{ kit_id: KIT, imagem_id: F1, papel: "identidade", prioridade: 0 }],
    foto_modelos: [PERSONA],
    foto_modelo_imagens: [],
    foto_canvas: [CANVAS_BRUTO],
    foto_biblioteca: [],
  };
  try {
    window.localStorage.clear();
    window.localStorage.setItem("mesa-foto:canvas:como-funciona-visto", "1");
  } catch {
    /* sem armazenamento */
  }
  mock.rpc.mockResolvedValue({ data: { saldo_usd: 12.5 }, error: null });
  mock.invoke.mockImplementation(async (_nome: string, opcoes: any) => {
    const acao = opcoes && opcoes.body ? opcoes.body.acao : "";
    if (respostas[acao] !== undefined) return { data: typeof respostas[acao] === "function" ? respostas[acao](opcoes.body) : respostas[acao], error: null };
    return { data: { ok: true, custo_usd: 0.01 }, error: null };
  });
});

// ------------------------------------------------------------------ regras da função (sem rede)

describe("canvas v3: regras da função", () => {
  it("cartões novos: agente, pessoa real com autorização e ambiente em 3 modos, com os nomes da função", () => {
    expect(TIPOS_NA_FUNCAO).toContain("agente");
    expect(dadosDoNo("agente", { pedido: "ela segurando o óculos", mensagens: [{ papel: "agente", texto: "ok" }, { papel: "x", texto: "" }] })).toEqual({ titulo: null, pedido: "ela segurando o óculos", mensagens: [{ papel: "agente", texto: "ok" }] });
    expect(() => dadosDoNo("agente", { pedido: "modelo parecida com a Anitta" })).toThrow();
    expect(dadosDoNo("modelo", { imagem_id: F1, autorizada: true })).toMatchObject({ modelo_id: null, imagem_id: F1, autorizada: true });
    // Com persona escolhida, a foto real não vale.
    expect(dadosDoNo("modelo", { modelo_id: P1, imagem_id: F1, autorizada: true })).toMatchObject({ modelo_id: P1, imagem_id: null, autorizada: false });
    expect(dadosDoNo("ambiente", { imagem_id: F1 })).toMatchObject({ modo: "foto", uso: "complementar" });
    expect(dadosDoNo("ambiente", { modo: "contexto" })).toMatchObject({ modo: "contexto", texto: null });
    expect(dadosDoNo("saida", { acao: "na_mao", pose: "ugc_selfie", carrossel: 9 })).toMatchObject({ acao: "na_mao", pose: "ugc_selfie", carrossel: 6 });
    expect(dadosDoNo("saida", { acao: "voar", carrossel: 2 })).toMatchObject({ acao: "livre", pose: "nenhuma", carrossel: 0 });
  });

  it("pessoa real sem autorização não gera; o pedido do agente entra no PEDIDO", () => {
    const c = normalizarCanvasNaFuncao({
      nos: [
        { id: "p", tipo: "modelo", dados: { imagem_id: F1 } },
        { id: "a", tipo: "agente", dados: { pedido: "na praia, segurando o produto" } },
        { id: "s", tipo: "saida", dados: {} },
      ],
      ligacoes: [
        { de: "p", para: "s", ordem: 0 },
        { de: "a", para: "s", ordem: 1 },
      ],
    });
    const e = entradasDaSaida(c, "s");
    expect(e.agente!.map((n) => n.id)).toEqual(["a"]);
    expect(() => garantirQueDaParaGerar(e)).toThrow(/autorização/);
    expect(textosDasEntradas(e)).toEqual([{ texto: "na praia, segurando o produto", papel: "pedido" }]);
    const autorizada = normalizarCanvasNaFuncao({ ...c, nos: c.nos.map((n) => (n.id === "p" ? { ...n, dados: { ...n.dados, autorizada: true } } : n)) });
    expect(() => garantirQueDaParaGerar(entradasDaSaida(autorizada, "s"))).not.toThrow();
  });

  it("prompt v3: ação, pose UGC com lente de celular, foto base, ângulo obrigatório e carrossel", () => {
    const cand = (papel: "produto" | "pessoa" | "ambiente", id: string, no: string) => ({ papel, origem: { tipo: "acervo" as const, id, no_id: no }, imagem_id: id, titulo: id, legenda: papel });
    const base = { ...cand("produto", "base", "s"), papel: "base" as const };
    const ordem = ordenarComBase(base, [cand("produto", "i1", "p1"), cand("pessoa", "i2", "m1"), cand("ambiente", "i3", "a1")], 3);
    expect(ordem.referencias.map((r) => [r.ordem, r.papel])).toEqual([[1, "base"], [2, "produto"], [3, "pessoa"]]);
    expect(ordem.cortadas).toHaveLength(1);
    const p = promptDoCanvas({
      referencias: ordem.referencias,
      produtos: [{ no_id: "p1", nome: "Óculos", variante: null, invariantes: [], lacunas: [] }],
      pessoas: [],
      pessoasReais: [{ no_id: "m1", nome: "Ana" }],
      ambientes: [{ texto: "loja da marca", no_id: "a1", modo: "foto", uso: "usar" }],
      estilos: [],
      textos: [{ texto: "ela mostra o óculos", papel: "pedido" }],
      formato: "9:16",
      acao: "segurando",
      pose: "ugc_selfie",
      angulo: 2,
      quadro: { atual: 2, total: 4 },
    });
    expect(p).toContain("FOTOGRAFIA UGC REAL FEITA COM CELULAR");
    expect(p).toContain("Imagem 1: A FOTO BASE desta série");
    expect(p).toContain('Imagem 3: A PESSOA DA FOTO "Ana" (pessoa real, com autorização');
    expect(p).toContain(`COMPOSIÇÃO: ${ACOES_DO_RESULTADO.segurando}`);
    expect(p).toContain(POSES_DO_RESULTADO.ugc_selfie);
    expect(p).toContain(LENTE_UGC);
    expect(p).toContain("poros visíveis");
    expect(p).not.toContain("85 mm");
    expect(p).toContain(`ÂNGULO DESTA VERSÃO (obrigatório): ${ANGULOS_DE_VARIACAO[2]}`);
    expect(p).toContain("CARROSSEL: esta é a foto 2 de 4");
    expect(p).not.toContain("pessoa é sintética");
    expect(p).not.toMatch(/[—–]/);
    // Foto do lugar "como está".
    const lugar = promptDoCanvas({ referencias: [{ ...cand("ambiente", "i3", "a1"), ordem: 1 }], produtos: [], pessoas: [], ambientes: [{ texto: null, no_id: "a1", uso: "usar" }], estilos: [], textos: [], formato: "4:5" });
    expect(lugar).toContain("Imagem 1: O LUGAR REAL");
  });

  it("ambiente pelo contexto sem IA, histórico curto e resposta do agente só com o que está nas listas", () => {
    expect(ambienteDoContexto({ cliente: "Ótica X", estilo: "minimalista claro", nicho: "ótica de bairro", campanha: "Dia dos Pais" })).toBe("Ambiente pensado para Ótica X: lugar típico de ótica de bairro, com a cara da marca (minimalista claro), no clima da campanha Dia dos Pais. Cenário crível, sem texto nem marca de terceiros.");
    expect(ambienteDoContexto(null)).toMatch(/^Ambiente pensado para a marca: lugar real/);
    expect(historicoDoAgente(Array.from({ length: 20 }, (_, i) => ({ papel: i % 2 ? "agente" : "usuario", texto: `m${i}` })))).toHaveLength(12);
    const r = respostaDoAgente(
      { resposta: "Feito — pedido escrito", pedido: "Ela segura o óculos", acao: "na_mao", pose: "dançando", formato: "9:16", modelo_pronto: "ugc-selfie", kit_id: KIT_DE_FORA, modelo_id: P1, ambiente: "praia" },
      { kits: [KIT], modelos: [P1], modelosProntos: CHAVES_DOS_MODELOS_PRONTOS, formatos: ["4:5", "9:16"] },
    );
    expect(r).toEqual({ resposta: "Feito, pedido escrito", pedido: "Ela segura o óculos", acao: "na_mao", pose: null, ambiente: "praia", formato: "9:16", modelo_pronto: "ugc-selfie", kit_id: null, modelo_id: P1 });
    expect(respostaDoAgente({ resposta: "x", pedido: "parecida com a Zendaya" }, { kits: [], modelos: [], modelosProntos: [], formatos: [] }).pedido).toBe("");
  });

  it("resultados da série guardam grupo e quadro; foto solta não leva esses campos", () => {
    const r = resultadosDaSaida([{ geracao_id: "g1", grupo: "car-1", quadro: 2, tipo: "carrossel" }, { geracao_id: "g2" }]);
    expect(r[0]).toMatchObject({ grupo: "car-1", quadro: 2, tipo: "carrossel" });
    expect("grupo" in r[1]).toBe(false);
  });
});

// ------------------------------------------------------------------ contrato tela x função

describe("canvas v3: contrato tela x função", () => {
  const canvasFonte = ler("supabase/functions/mesa-foto/canvas.ts");
  const regras = ler("supabase/functions/mesa-foto/canvas-regras.ts");

  it("canvas_agente registrada, com fôlego, 300 s e lendo só o que a tela manda", () => {
    expect(canvasFonte).toContain("canvas_agente: canvasAgente,");
    expect(canvasFonte).toMatch(/ACOES_LONGAS_DO_CANVAS = \[[^\]]*"canvas_agente"/);
    expect(canvasFonte).toContain("timeoutMs: 300_000,");
    const corpo = corpoDoAgente({ canvasId: CANVAS, gerarId: "no-saida", mensagem: " oi ", tarefa: "montar", historico: [{ papel: "usuario", texto: "a" }] });
    expect(corpo).toEqual({ acao: "canvas_agente", canvas_id: CANVAS, tarefa: "montar", no_saida_id: "no-saida", mensagem: "oi", historico: [{ papel: "usuario", texto: "a" }] });
    const funcao = canvasFonte.slice(canvasFonte.indexOf("async function canvasAgente("), canvasFonte.indexOf("/** estimar {"));
    for (const campo of ["corpo.canvas_id", "corpo.tarefa", "corpo.mensagem", "corpo.historico", "lerPedidoDoCanvas(corpo)"]) expect(funcao).toContain(campo);
    // Uma imagem por chamada continua: variações e carrossel são N chamadas de canvas_gerar.
    expect(canvasFonte.match(/await chamarImagem\(/g) ?? []).toHaveLength(1);
  });

  it("campos da série vão no canvas_gerar e a função lê cada um", () => {
    const corpo = corpoDoPedidoDoCanvas("canvas_gerar", { canvasId: CANVAS, gerarId: "s", motorId: GPT, qualidade: "alta", baseImagemId: F1, angulo: 3, quadro: 2, quadros: 5, grupo: "car-1" });
    expect(corpo).toEqual({ acao: "canvas_gerar", canvas_id: CANVAS, no_saida_id: "s", modelo_imagem_id: GPT, qualidade: "alta", base_imagem_id: F1, angulo: 3, quadro: 2, quadros: 5, grupo: "car-1" });
    for (const campo of ["corpo.base_imagem_id", "corpo.angulo", "corpo.quadro, corpo.quadros", "corpo.grupo"]) expect(canvasFonte).toContain(campo);
    // Foto base só do acervo deste cliente; produto de outro cliente não aponta kit_id nem derivada_de.
    expect(canvasFonte).toContain('"A foto base não está no acervo deste cliente."');
    expect(canvasFonte).toContain("kit_id: mt.kitIdsDoCliente[0] ?? null,");
    expect(canvasFonte).toContain("for (const outro of conferidos.clientesDosKits) await f.garantirAcesso(ch, outro);");
    expect(canvasFonte).not.toContain('"kit_de_outro_cliente"');
  });

  it("listas espelhadas: ações, poses, ângulos, modelos prontos e tipos de cartão", () => {
    expect(ACOES_DA_TELA.map((a) => a.valor)).toEqual(Object.keys(ACOES_DO_RESULTADO));
    expect(POSES_DA_TELA.map((a) => a.valor)).toEqual(Object.keys(POSES_DO_RESULTADO));
    expect(ANGULOS_DA_TELA).toHaveLength(ANGULOS_DE_VARIACAO.length);
    expect(MODELOS_PRONTOS.map((m) => m.chave)).toEqual(CHAVES_DOS_MODELOS_PRONTOS);
    (Object.keys(TIPOS_DE_NO) as (keyof typeof TIPO_NA_FUNCAO)[]).forEach((t) => expect(TIPOS_NA_FUNCAO as readonly string[]).toContain(TIPO_NA_FUNCAO[t]));
    // Vídeo fica só preparado: nem a tela nem a função têm o tipo ainda.
    expect(Object.keys(TIPOS_DE_NO)).not.toContain("video");
    expect(regras).toContain("canvas_video_gerar");
    expect(() => normalizarCanvasNaFuncao({ nos: [{ id: "v", tipo: "video" }] })).toThrow(/Tipo de cartão/);
  });

  it("o que a tela salva dos cartões novos passa na função e volta igual", () => {
    let c: Canvas = { ...canvasVazio(CLIENTE), id: CANVAS, versao: 1 };
    const g = novoNo("gerar", 400, 0, { motores: [GPT], acao: "segurando", pose: "apresentando", carrossel: 4 });
    const real = novoNo("modelo", 0, 0, { imagem_id: F1, autorizada: true, titulo: "Ana" });
    const lugar = novoNo("ambiente", 0, 100, { modo: "foto", uso: "usar", imagem_id: F2 });
    const contexto = novoNo("ambiente", 0, 200, { modo: "contexto" });
    const agente = novoNo("agente", 0, 300, { pedido: "na loja", mensagens: [{ papel: "usuario", texto: "oi" }] });
    const deFora = novoNo("produto", 0, 400, { kit_id: KIT_DE_FORA, titulo: "Tênis" });
    c = { ...c, nos: [g, real, lugar, contexto, agente, deFora] };
    [real, lugar, contexto, agente, deFora].forEach((n) => {
      c = ligar(c, n.id, g.id);
    });
    const naFuncao = normalizarCanvasNaFuncao(corpoDoCanvas(c));
    expect(naFuncao.nos.map((n) => n.tipo)).toEqual(["saida", "modelo", "ambiente", "ambiente", "agente", "produto"]);
    const deVolta = normalizarCanvas({ ...naFuncao, id: CANVAS, versao: 1 }, CLIENTE)!;
    deVolta.nos.forEach((n) => expect(n.dados).toEqual(c.nos.find((x) => x.id === n.id)!.dados));
    expect(deVolta.ligacoes).toEqual(c.ligacoes);
    expect(faltaNoCartao(deVolta.nos[3])).toBe("");
    expect(faltaNoCartao({ ...real, dados: { ...real.dados, autorizada: false } })).toBe("Confirme a autorização da pessoa");
  });
});

// ------------------------------------------------------------------ montagem na tela

describe("canvas v3: modelos prontos, agente e custo", () => {
  it("modelo pronto põe ação, pose, formato e carrossel no Resultado; UGC sai em 9:16", () => {
    const centro = novoNo("gerar", 420, 0, { motores: [GPT] });
    const c = aplicarModeloPronto({ ...canvasVazio(CLIENTE), nos: [centro] }, "ugc-selfie", GPT, { kit_id: KIT });
    expect(c.nos.find((n) => n.id === centro.id)!.dados).toMatchObject({ acao: "segurando", pose: "ugc_selfie", formato: "9:16" });
    const car = aplicarModeloPronto(canvasVazio(CLIENTE), "carrossel-de-produto", GPT);
    const g = car.nos.find((n) => n.tipo === "gerar")!;
    expect(g.dados.carrossel).toBe(5);
    const amb = car.nos.find((n) => n.tipo === "ambiente")!;
    expect(amb.dados.modo).toBe("contexto");
    // Carrossel: o custo é o do carrossel inteiro no primeiro motor (5 fotos).
    expect(partesDoResultado(g, 3)).toHaveLength(5);
    expect(partesDoResultado({ dados: { motores: [GPT, "b"] } }, 1)).toHaveLength(2);
  });

  it("resposta do agente vai para o cartão dele e para o Resultado ligado; montar pelo contexto preenche o quadro", () => {
    const g = novoNo("gerar", 420, 0, { motores: [GPT] });
    const a = novoNo("agente", 0, 0);
    let c: Canvas = { ...canvasVazio(CLIENTE), nos: [g, a] };
    c = ligar(c, a.id, g.id);
    const r = normalizarRespostaDoAgente({ resposta: "Pronto", pedido: "Ela segura o óculos na praia", acao: "na_mao", pose: "apresentando", formato: "9:16", custo_usd: 0.01 });
    const depois = aplicarRespostaDoAgente(c, a.id, "quero na praia", r);
    expect(depois.nos.find((n) => n.id === a.id)!.dados).toMatchObject({ pedido: "Ela segura o óculos na praia", mensagens: [{ papel: "usuario", texto: "quero na praia" }, { papel: "agente", texto: "Pronto" }] });
    expect(depois.nos.find((n) => n.id === g.id)!.dados).toMatchObject({ acao: "na_mao", pose: "apresentando", formato: "9:16" });
    const montado = montarPelaResposta({ ...canvasVazio(CLIENTE), nos: [novoNo("gerar", 420, 0, { motores: [GPT] })] }, normalizarRespostaDoAgente({ modelo_pronto: "produto-na-praia", pedido: "Óculos na areia", ambiente: "Praia de Floripa", kit_id: KIT }), GPT);
    const texto = montado.nos.find((n) => n.tipo === "texto")!;
    const ambiente = montado.nos.find((n) => n.tipo === "ambiente")!;
    expect(texto.dados.texto).toBe("Óculos na areia");
    expect(ambiente.dados).toMatchObject({ modo: "descrever", texto: "Praia de Floripa" });
    expect(montado.nos.find((n) => n.tipo === "produto")!.dados.kit_id).toBe(KIT);
  });
});

// ------------------------------------------------------------------ geração em série

describe("canvas v3: variações e carrossel (N chamadas, uma imagem por chamada)", () => {
  const gerou = (b: any) => {
    const n = chamadasDe("canvas_gerar").length;
    const imagem = { id: `aaaaaaaa-0000-4000-8000-00000000010${n}`, client_id: CLIENTE, nome: "c.png", storage_bucket: "mesa", storage_path: `${CLIENTE}/foto/canvas/${n}.png`, gerada: true, modo: "canvas", criado_em: "2026-09-25T10:00:00Z" };
    return { geracao: { id: `ger-${n}`, motor_id: b.modelo_imagem_id, status: "gerada" }, imagem, custo_usd: 0.1 };
  };

  it("carrossel: a capa sai primeiro sem base; as outras usam a capa como base, cada uma num ângulo", async () => {
    respostas.canvas_gerar = gerou;
    await gerarNoResultado({ queryClient: new QueryClient(), clientId: CLIENTE, canvasId: CANVAS, gerarId: "s", motores: [GPT, "outro"], carrossel: 4, qualidade: "alta", atualizar: vi.fn() });
    const c = chamadasDe("canvas_gerar");
    expect(c).toHaveLength(4);
    expect(c[0].base_imagem_id).toBeUndefined();
    expect(c.map((x) => x.quadro)).toEqual([1, 2, 3, 4]);
    expect(c.every((x) => x.quadros === 4 && x.modelo_imagem_id === GPT && x.grupo === c[0].grupo)).toBe(true);
    expect(c.slice(1).every((x) => x.base_imagem_id === "aaaaaaaa-0000-4000-8000-000000000101")).toBe(true);
    expect(new Set(c.map((x) => x.angulo)).size).toBe(4);
    const pend = tirarPendentes(CANVAS);
    expect(pend.s.map((r) => r.tipo)).toEqual(["carrossel", "carrossel", "carrossel", "carrossel"]);
  });

  it("variações desta: 3 chamadas com a foto como base, ângulos diferentes e sem repetir o da base", async () => {
    respostas.canvas_gerar = gerou;
    const base = { geracao_id: "g-base", imagem_id: F2, storage_bucket: "mesa", storage_path: "x.png", url: "", motor_id: GPT, status: "gerada" as const, erro: "", custo_usd: 0.1, conferencia: null, criado_em: "", grupo: null, quadro: null, tipo: "foto" as const };
    await gerarVariacoes({ queryClient: new QueryClient(), clientId: CLIENTE, canvasId: CANVAS, gerarId: "s", base, qualidade: "alta", atualizar: vi.fn() });
    const c = chamadasDe("canvas_gerar");
    expect(c).toHaveLength(3);
    expect(c.every((x) => x.base_imagem_id === F2 && x.modelo_imagem_id === GPT && x.grupo === "var-g-base")).toBe(true);
    expect(c.map((x) => x.angulo)).toEqual([1, 2, 3]);
  });
});

// ------------------------------------------------------------------ tela

const noDoQuadro = (tipo: string) => document.querySelector(`[data-no-do-canvas][data-tipo="${tipo}"]`) as HTMLElement;

describe("canvas v3: tela", () => {
  it("modo foco: o body ganha data-modo-foco com o Canvas aberto, dá para desligar e some ao sair", async () => {
    const tela = montar(h(EtapaCanvas));
    await waitFor(() => expect(document.querySelectorAll("[data-no-do-canvas]").length).toBe(2));
    expect(document.body.getAttribute("data-modo-foco")).toBe("canvas");
    fireEvent.click(screen.getByRole("button", { name: /Mostrar menu/ }));
    await waitFor(() => expect(document.body.hasAttribute("data-modo-foco")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: /Só o canvas/ }));
    await waitFor(() => expect(document.body.getAttribute("data-modo-foco")).toBe("canvas"));
    tela.unmount();
    expect(document.body.hasAttribute("data-modo-foco")).toBe(false);
  });

  it("tela cheia sai num portal no body (fora da página) e Esc volta", async () => {
    montar(h(EtapaCanvas));
    await waitFor(() => expect(document.querySelectorAll("[data-no-do-canvas]").length).toBe(2));
    fireEvent.click(screen.getByRole("button", { name: "Tela cheia" }));
    await waitFor(() => expect(document.querySelector("[data-quadro]")!.getAttribute("data-tela-cheia")).toBe("sim"));
    const quadro = document.querySelector("[data-quadro]") as HTMLElement;
    expect(quadro.parentElement).toBe(document.body);
    expect(quadro.closest("[data-canvas-escuro]")).toBeNull();
    expect(document.body.getAttribute("data-modo-foco")).toBe("canvas");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(document.querySelector("[data-quadro]")!.getAttribute("data-tela-cheia")).toBe("nao"));
  });

  it("paleta com Agente (bolinha) e Vídeo em breve; cartão selecionado mostra Apagar e sai do quadro", async () => {
    montar(h(EtapaCanvas));
    await waitFor(() => expect(document.querySelectorAll("[data-no-do-canvas]").length).toBe(2));
    expect((document.querySelector('[data-paleta="video"]') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(document.querySelector('[data-paleta="agente"]') as HTMLElement);
    await waitFor(() => expect(noDoQuadro("agente")).toBeTruthy());
    await waitFor(() => expect(document.querySelectorAll(".react-flow__edge").length).toBe(2));
    // O painel abre na conversa do agente.
    await waitFor(() => expect(document.querySelector("[data-chat-do-agente]")).toBeTruthy());
    const apagar = await waitFor(() => {
      const b = within(noDoQuadro("agente")).getByRole("button", { name: "Apagar o cartão" });
      return b;
    });
    fireEvent.click(apagar);
    await waitFor(() => expect(noDoQuadro("agente")).toBeFalsy());
    await waitFor(() => expect(document.querySelectorAll(".react-flow__edge").length).toBe(1));
  });

  it("agente: a mensagem vai com o canvas salvo e o Resultado ligado; o pedido e a ação voltam para o quadro", async () => {
    respostas.canvas_salvar = (b: any) => ({ canvas: { ...b.canvas, id: CANVAS, client_id: CLIENTE, versao: (b.versao_esperada || 0) + 1 } });
    respostas.canvas_agente = { resposta: "Escrevi o pedido.", pedido: "Óculos na mão dela, luz de janela", acao: "na_mao", pose: null, custo_usd: 0.01 };
    montar(h(EtapaCanvas));
    await waitFor(() => expect(document.querySelectorAll("[data-no-do-canvas]").length).toBe(2));
    fireEvent.click(document.querySelector('[data-paleta="agente"]') as HTMLElement);
    const campo = (await screen.findByLabelText("Mensagem para o agente")) as HTMLTextAreaElement;
    expect(document.querySelector("[data-chat-do-agente]")!.textContent).toMatch(/~US\$/);
    fireEvent.change(campo, { target: { value: "quero pegada natural" } });
    fireEvent.click(within(document.querySelector("[data-chat-do-agente]") as HTMLElement).getByRole("button", { name: /Enviar/ }));
    await waitFor(() => expect(chamadasDe("canvas_agente")).toHaveLength(1));
    const corpo = chamadasDe("canvas_agente")[0];
    expect(corpo).toMatchObject({ canvas_id: CANVAS, no_saida_id: "no-saida", mensagem: "quero pegada natural", tarefa: "conversar" });
    expect(chamadasDe("canvas_salvar").length).toBeGreaterThan(0);
    await waitFor(() => expect((screen.getByLabelText("Pedido do agente") as HTMLTextAreaElement).value).toBe("Óculos na mão dela, luz de janela"));
    expect(screen.getByText("Escrevi o pedido.")).toBeTruthy();
    await waitFor(() => expect(noDoQuadro("gerar").textContent).toContain("Na mão de"));
  });

  it("esteira: produtos deste e de outro cliente; tocar põe o produto já ligado ao Resultado", async () => {
    mock.tabelas.foto_kits = [
      { id: KIT, client_id: CLIENTE, tipo: "moda", nome: "Óculos Aro Fino", frente_imagem_id: F1, status: "confirmado", atualizado_em: "2026-09-25T10:00:00Z" },
      { id: KIT_DE_FORA, client_id: OUTRO, tipo: "moda", nome: "Tênis Parceiro", frente_imagem_id: null, status: "confirmado", atualizado_em: "2026-09-25T10:00:00Z" },
    ];
    montar(h(EtapaCanvas));
    await waitFor(() => expect(document.querySelectorAll("[data-no-do-canvas]").length).toBe(2));
    const esteira = document.querySelector("[data-esteira-de-produtos]") as HTMLElement;
    expect(within(esteira).getByRole("combobox", { name: "Produtos de qual cliente" })).toBeTruthy();
    expect(within(esteira).getByRole("option", { name: "Loja Parceira" })).toBeTruthy();
    const deFora = await waitFor(() => {
      const b = esteira.querySelector(`[data-produto-da-esteira="${KIT_DE_FORA}"]`) as HTMLElement;
      expect(b).toBeTruthy();
      return b;
    });
    expect(deFora.textContent).toContain("outro");
    fireEvent.click(deFora);
    await waitFor(() => expect(document.querySelectorAll('[data-no-do-canvas][data-tipo="produto"]').length).toBe(2));
    await waitFor(() => expect(document.querySelectorAll(".react-flow__edge").length).toBe(2));
    await waitFor(() => expect(noDoQuadro("gerar").querySelector("[data-junta]")!.textContent).toContain("Tênis Parceiro"));
  });

  it("galeria de modelos prontos com miniatura e o botão Montar pelo contexto com custo", async () => {
    montar(h(EtapaCanvas));
    await waitFor(() => expect(document.querySelectorAll("[data-no-do-canvas]").length).toBe(2));
    fireEvent.click(screen.getByRole("button", { name: /Modelos prontos/ }));
    const galeria = await waitFor(() => {
      const g = document.querySelector("[data-modelos-prontos]") as HTMLElement;
      expect(g).toBeTruthy();
      return g;
    });
    expect(galeria.querySelectorAll("[data-miniatura-do-modelo]")).toHaveLength(MODELOS_PRONTOS.length);
    expect(within(galeria).getByRole("button", { name: /Montar pelo contexto/ }).textContent).toMatch(/~US\$/);
  });
});

// ------------------------------------------------------------------ casca e piso

describe("canvas v3: casca do painel e piso do navegador", () => {
  it("AppLayout marca topo, conteúdo e flutuantes; o CSS do modo foco esconde só com o atributo no body", () => {
    const casca = ler("src/components/AppLayout.tsx");
    for (const marca of ['data-casca="topo"', 'data-casca="conteudo"', 'data-casca="flutuante"']) expect(casca).toContain(marca);
    const css = ler("src/index.css");
    expect(css).toContain('body[data-modo-foco] [data-casca="flutuante"]');
    expect(css).toContain('body[data-modo-foco] [data-casca="topo"]');
  });

  it("React Flow só no EtapaCanvas (inclusive na pasta canvas/), e o código novo respeita Safari 11 / Chrome 64", () => {
    const pasta = resolve(raiz, "src/components/mesa-foto");
    const arquivos: string[] = [];
    const andar = (dir: string, prefixo: string) => {
      readdirSync(dir).forEach((n) => {
        const cheio = resolve(dir, n);
        if (statSync(cheio).isDirectory()) andar(cheio, `${prefixo}${n}/`);
        else if (/\.(ts|tsx)$/.test(n)) arquivos.push(`${prefixo}${n}`);
      });
    };
    andar(pasta, "");
    expect(arquivos.filter((n) => /from "@xyflow\/react"/.test(readFileSync(resolve(pasta, n), "utf8")))).toEqual(["EtapaCanvas.tsx"]);
    const novos = ["EtapaCanvas.tsx", "canvasApi.ts", "canvas/Agente.tsx", "canvas/comum.tsx", "canvas/Editores.tsx", "canvas/Escolher.tsx", "canvas/Esteira.tsx", "canvas/Galeria.tsx", "canvas/geracao.ts", "canvas/ModoLista.tsx"]
      .map((n) => ler(`src/components/mesa-foto/${n}`))
      .concat([ler("src/lib/modoFoco.ts")])
      .join("\n");
    expect(novos).not.toMatch(/\(\?<[=!a-zA-Z]|\\p\{|\.at\(|Object\.hasOwn|aspect-ratio|aspect-\[|:has\(|\[(min|max|clamp)\(|flatMap|NodeResizer|NodeToolbar|onPointer/);
    // Nunca escurecer a foto: sem véu preto, gradiente escuro por cima ou brightness.
    expect(novos).not.toMatch(/bg-black|from-black|via-black|to-black|brightness\(|bg-gradient-to/);
    expect(novos).not.toMatch(/[—–]/);
  });
});
