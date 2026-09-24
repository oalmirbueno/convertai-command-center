import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mesa Foto, abas Modelos e Canvas (docs/mesa-foto/MODELOS-E-CANVAS.md): as
 * telas contra as ações novas da função mesa-foto (modelo_criar,
 * modelo_candidata_gerar, modelo_ancora_escolher, modelo_vista_gerar,
 * modelo_detalhar, modelo_conferir, canvas_salvar, canvas_montar,
 * canvas_gerar, canvas_conferir e os alvos novos de estimar), que a frente do
 * servidor escreve em paralelo. Função, Storage e tabelas são simulados.
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  upload: vi.fn(),
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
          upload: mock.upload,
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
    data: [{ id: "11111111-1111-1111-1111-111111111111", company_name: "Ótica Sintética" }],
    isLoading: false,
    isSuccess: true,
    isFetching: false,
    dataUpdatedAt: 1,
    refetch: vi.fn(),
  }),
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import type { ModeloIa } from "@/lib/mesa/api";
import MesaFoto from "@/pages/MesaFoto";
import { MesaFotoProvider, type MesaFotoValor } from "@/components/mesa-foto/Comuns";
import EtapaModelos from "@/components/mesa-foto/EtapaModelos";
import EtapaCanvas from "@/components/mesa-foto/EtapaCanvas";
import {
  acharNoCatalogo,
  candidatasPorMotor,
  conferirImagemDaPersona,
  corpoDaPersona,
  criarPersona,
  decidirImagemDaPersona,
  detalharImagem,
  emParalelo,
  escolherAncora,
  esquecerAndamentos,
  extrasDaEstimativaDaCandidata,
  extrasDaEstimativaDoDetalhe,
  gerarCandidata,
  gerarVista,
  MOTOR_DO_DETALHE,
  motoresDaRodada,
  normalizarConferenciaDaPersona,
  normalizarFicha,
  normalizarImagemDaPersona,
  normalizarPersona,
  novoIdDeRodada,
  pedeSemelhanca,
  pedirAoCanvas,
  problemasDaPersona,
  rascunhoVazio,
  resumoDaPersona,
  STATUS_DA_PERSONA,
  VISTAS_DA_FOLHA,
} from "@/components/mesa-foto/modelosApi";
import {
  aplicarModeloPronto,
  bloqueiosDoGerar,
  canvasVazio,
  conferirGeracao,
  corpoDoCanvas,
  desligar,
  entradasDoGerar,
  gerarNoCanvas,
  guardarRascunho,
  juntarResultados,
  lerRascunho,
  ligar,
  montarCanvas,
  normalizarCanvas,
  normalizarMontagem,
  novoNo,
  podeLigar,
  removerNo,
  salvarCanvas,
  TIPO_NA_FUNCAO,
  TIPOS_DE_NO,
  type Canvas,
} from "@/components/mesa-foto/canvasApi";
import { classeDaFoto, normalizarFoto } from "@/components/mesa-foto/fotoApi";
import {
  canvasGravado,
  lerPedidoDoCanvas,
  lerTipoDeNo,
  normalizarCanvas as normalizarCanvasNaFuncao,
  TIPOS_DE_NO as TIPOS_DE_NO_NA_FUNCAO,
} from "../../supabase/functions/mesa-foto/canvas-regras";
import {
  alertasDoRealismo,
  FOLHA_PADRAO,
  invariantesDaFicha,
  MOTOR_DETALHE,
  normalizarFicha as normalizarFichaNaFuncao,
  normalizarLeituraDaPersona,
  RODADA_PADRAO,
  STATUS_DA_PERSONA as STATUS_NA_FUNCAO,
  VISTAS_DA_PERSONA,
} from "../../supabase/functions/mesa-foto/personas";
import { chunkPara } from "../../config/chunk-strategy";

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const KIT = "bbbbbbbb-0000-4000-8000-000000000001";
const F1 = "aaaaaaaa-0000-4000-8000-000000000001";
const P1 = "dddddddd-0000-4000-8000-000000000001";
const P2 = "dddddddd-0000-4000-8000-000000000002";
const ANCORA = "eeeeeeee-0000-4000-8000-000000000001";
const CANVAS = "ffffffff-0000-4000-8000-000000000001";

const GPT = "openrouter:openai/gpt-image-2.5-sunburst";
const NANO = "openrouter:google/gemini-3-pro-image";
const SEEDREAM = "openrouter:bytedance-seed/seedream-5-0-pro";

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
  imagemDoCatalogo(NANO, "google/gemini-3-pro-image", 0.134),
  imagemDoCatalogo(SEEDREAM, "bytedance-seed/seedream-5-0-pro", 0.09),
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

const valorDaFoto = (extra: Partial<MesaFotoValor> = {}): MesaFotoValor => ({
  kitId: null,
  ensaioId: null,
  imagemId: null,
  escolherKit: vi.fn(),
  escolherEnsaio: vi.fn(),
  irPara: vi.fn(),
  selecionadas: [],
  setSelecionadas: vi.fn(),
  abrirAgente: vi.fn(),
  ...extra,
});

function montar(filho: any, foto: Partial<MesaFotoValor> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(
      QueryClientProvider,
      { client: qc },
      h(
        MemoryRouter,
        { initialEntries: [`/mesa-foto?client=${CLIENTE}`] },
        h(TooltipProvider, null, h(MesaProvider, { valor: valorDaMesa(), children: h(MesaFotoProvider, { valor: valorDaFoto(foto), children: filho }) })),
      ),
    ),
  );
}

const chamadasDe = (acao: string) =>
  mock.invoke.mock.calls.filter((c: any[]) => c[0] === "mesa-foto" && c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);

const PERSONA_BRUTA = {
  id: P1,
  client_id: CLIENTE,
  nome: "Marina",
  ficha: { idade_aparente: 29, tom_de_pele: "morena clara", cabelo: { cor: "castanho", comprimento: "ombro" }, estilo: "urbano" },
  invariantes: ["pinta no queixo"],
  status: "candidatos",
  versao: 1,
  etica: { sintetica: true, adulta: true, marcado_em: "2026-09-24" },
  atualizado_em: "2026-09-24T10:00:00Z",
};

const imagemBruta = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  modelo_id: P1,
  papel: "candidata",
  storage_bucket: "mesa",
  storage_path: `mesa/modelos/${P1}/${id}.png`,
  largura: 1024,
  altura: 1280,
  criado_em: "2026-09-24T11:00:00Z",
  ...extra,
});

let respostas: Record<string, any> = {};

beforeAll(() => {
  // O que o React Flow pede no jsdom (guia de testes do xyflow).
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

beforeEach(() => {
  vi.clearAllMocks();
  esquecerAndamentos();
  respostas = {};
  mock.tabelas = {
    cliente_imagens: [
      { id: F1, client_id: CLIENTE, nome: "oculos-frente.jpg", storage_bucket: "mesa", storage_path: `${CLIENTE}/foto/originais/${F1}.jpg`, origem: "mesa_foto", tags: [], criado_em: "2026-09-24T10:00:00Z" },
    ],
    foto_kits: [{ id: KIT, client_id: CLIENTE, tipo: "moda", nome: "Óculos Aro Fino", frente_imagem_id: F1, status: "confirmado", atualizado_em: "2026-09-24T10:00:00Z" }],
    foto_kit_refs: [{ kit_id: KIT, imagem_id: F1, papel: "identidade", prioridade: 0 }],
    foto_ensaios: [],
    foto_modelos: [PERSONA_BRUTA],
    foto_modelo_imagens: [],
    foto_canvas: [],
    foto_biblioteca: [],
  };
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
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

// ------------------------------------------------------------------ navegação

describe("navegação: Modelos e Canvas discretos, fora do caminho de 3 passos", () => {
  it("as duas abas aparecem depois de um traço fino, e o caminho principal continua com 3 passos", async () => {
    render(
      h(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        h(MemoryRouter, { initialEntries: [`/mesa-foto?client=${CLIENTE}&etapa=acervo`] }, h(TooltipProvider, null, h(MesaFoto))),
      ),
    );
    const nav = screen.getByRole("navigation", { name: "Etapas da Mesa Foto" });
    const caminho = nav.querySelector("[data-caminho-principal]") as HTMLElement;
    expect(within(caminho).getAllByRole("button")).toHaveLength(3);
    const avancadas = Array.from(nav.querySelectorAll("[data-etapa-avancada]")).map((b) => b.textContent);
    expect(avancadas).toEqual(["Modelos", "Canvas"]);
    // Mais discretas que as de apoio (letra menor, cor mais apagada) e a linha quebra no celular.
    const modelos = nav.querySelector('[data-etapa-avancada="modelos"]') as HTMLElement;
    expect(modelos.className).toContain("text-[11.5px]");
    expect((nav.querySelector("[data-etapas-de-apoio]") as HTMLElement).className).toContain("flex-wrap");
    fireEvent.click(modelos);
    await waitFor(() => expect(modelos.getAttribute("aria-current")).toBe("page"));
    expect((await screen.findAllByText("Marina")).length).toBeGreaterThan(0);
    expect(document.querySelector(`[data-persona="${P1}"]`)).toBeTruthy();
  });

  it("a página carrega o Canvas só quando a aba abre (fora da pré-carga) e o React Flow só existe no arquivo do Canvas", () => {
    const pagina = ler("src/pages/MesaFoto.tsx");
    expect(pagina).toContain('const EtapaCanvas = lazy(() => import("@/components/mesa-foto/EtapaCanvas"));');
    const preCarga = /for \(const carregar of \[([^\]]*)\]\)/.exec(pagina);
    expect(preCarga && preCarga[1]).toContain("carregarModelos");
    expect(preCarga && preCarga[1]).not.toMatch(/Canvas/);
    const pasta = resolve(raiz, "src/components/mesa-foto");
    const comXyflow = readdirSync(pasta).filter((n) => /\.(ts|tsx)$/.test(n) && /from "@xyflow\/react"/.test(readFileSync(resolve(pasta, n), "utf8")));
    expect(comXyflow).toEqual(["EtapaCanvas.tsx"]);
    expect(pagina.indexOf("@xyflow")).toBe(-1);
    // Dependência nova, versão da pesquisa, fixa.
    expect(JSON.parse(ler("package.json")).dependencies["@xyflow/react"]).toBe("12.12.0");
    // Solto (não agrupado à mão): fica no pedaço da aba Canvas.
    expect(chunkPara("/projeto/node_modules/@xyflow/react/dist/esm/index.js")).toBeUndefined();
    expect(chunkPara("/projeto/node_modules/@xyflow/system/dist/esm/index.js")).toBeUndefined();
  });

  it("o quadro respeita o piso Safari 11 / Chrome 64", () => {
    const fonte = ler("src/components/mesa-foto/EtapaCanvas.tsx");
    for (const exigido of ["selectionOnDrag={false}", "selectionKeyCode={null}", "multiSelectionKeyCode={null}", "connectOnClick", 'import "@xyflow/react/dist/style.css";', "handles: alcasDoNo(n.tipo)", "measured: { width: tamanho.largura, height: tamanho.altura }"]) {
      expect(fonte).toContain(exigido);
    }
    expect(fonte).not.toMatch(/NodeResizer|NodeToolbar|onPointer/);
    const poli = ler("src/polyfills.ts");
    expect(poli).toContain('typeof g.ResizeObserver === "undefined"');
    expect(poli).toContain('typeof g.structuredClone !== "function"');
  });
});

// ------------------------------------------------------------------ modelos: regras e normalizadores

describe("modelos: normalizadores tolerantes e regras da persona", () => {
  it("persona, ficha, imagem e conferência aceitam campo faltando e forma diferente", () => {
    const p = normalizarPersona(PERSONA_BRUTA);
    expect(p && p.nome).toBe("Marina");
    expect(p && p.ficha.cabelo).toBe("castanho, ombro");
    expect(p && p.etica_marcada).toBe(true);
    expect(normalizarPersona({ id: "x", status: "inventado" })).toMatchObject({ status: "rascunho", nome: "Persona sem nome", client_id: null, versao: 1 });
    expect(normalizarPersona(null)).toBeNull();
    expect(normalizarFicha({ idade: "33", genero: "feminino", marcas: ["sardas", "pinta"] })).toMatchObject({ idade_aparente: 33, genero_apresentado: "feminino", marcas: "sardas, pinta" });
    const i = normalizarImagemDaPersona({ id: "i1", papel: "outra coisa", uso: "pose", url: "https://x.test/a.png", modelo_imagem_id: GPT }, P1);
    expect(i).toMatchObject({ papel: "candidata", uso_da_referencia: "pose", modelo_id: P1, motor_id: GPT, url: "https://x.test/a.png", storage_bucket: "mesa" });
    const c = normalizarConferenciaDaPersona({ conferencia: { observado: { pele: "poros visíveis", maos: "ok" }, notas_jev: { realismo_pele: 2.4, lembra_pessoa_publica: { valor: 0.1 } }, alertas: ["pele lisa na testa"] } });
    expect(c && c.observado).toEqual(["pele: poros visíveis", "maos: ok"]);
    // Score do Jev na escala dos níveis (pele vai de 0 a 3) vira 0 a 1 na tela; Noul já é 0 a 1.
    expect(c && c.notas).toEqual([{ criterio: "realismo pele", valor: 2.4 / 3 }, { criterio: "lembra pessoa publica", valor: 0.1 }]);
    expect(normalizarConferenciaDaPersona({})).toBeNull();
  });

  it("só adulto (21+), sem pedir semelhança com pessoa real e com a declaração ética", () => {
    const r = { ...rascunhoVazio(), nome: "Marina", etica: true };
    expect(problemasDaPersona(r)).toEqual([]);
    expect(problemasDaPersona({ ...r, ficha: { ...r.ficha, idade_aparente: 19 } })).toContain("Idade aparente mínima: 21 anos.");
    expect(problemasDaPersona({ ...r, etica: false }).join(" ")).toMatch(/Confirme a declaração/);
    expect(problemasDaPersona({ ...r, ficha: { ...r.ficha, rosto: "parecida com uma atriz famosa" } }).join(" ")).toMatch(/semelhança/);
    expect(pedeSemelhanca("sósia do cantor")).toBe(true);
    expect(pedeSemelhanca("cabelo castanho, estilo urbano")).toBe(false);
    const corpo = corpoDaPersona(CLIENTE, { ...r, daAgencia: true, referencias: [{ imagem_id: F1, uso: "luz" }] });
    expect(corpo.escopo).toBe("agencia");
    expect(corpo.client_id).toBe(CLIENTE);
    expect(corpo.referencias).toEqual([{ imagem_id: F1, uso: "luz" }]);
    expect(corpo.etica_confirmada).toBe(true);
  });

  it("motores da rodada: os padrões da pesquisa que estão no catálogo, com a resolução; os que faltam são avisados", () => {
    const { opcoes, faltando } = motoresDaRodada(catalogo);
    expect(opcoes.filter((o) => o.padrao).map((o) => [o.id, o.rotulo, o.resolucao])).toEqual([
      [GPT, "GPT Image 2.5", null],
      [NANO, "Nano Banana Pro", "2K"],
      [SEEDREAM, "Seedream 5.0 Pro", "2K"],
    ]);
    expect(faltando).toEqual(["MAI-Image-2.6"]);
    // Catálogo sem nenhum dos padrões: o primeiro gerador ativo vem ligado.
    const outro = motoresDaRodada([imagemDoCatalogo("x:y", "outro/gerador", 0.02)]);
    expect(outro.opcoes[0]).toMatchObject({ id: "x:y", padrao: true });
  });

  it("resumo da persona e candidatas agrupadas por motor", () => {
    const imgs = [
      normalizarImagemDaPersona(imagemBruta("c1", { motor_id: NANO }))!,
      normalizarImagemDaPersona(imagemBruta("c2", { motor_id: GPT }))!,
      normalizarImagemDaPersona(imagemBruta("v1", { papel: "vista", vista: "perfil_esq" }))!,
      normalizarImagemDaPersona(imagemBruta("v2", { papel: "vista", vista: "frente", aprovada: false }))!,
      normalizarImagemDaPersona(imagemBruta("d1", { papel: "detalhe", derivada_de: "c2" }))!,
    ];
    const p = normalizarPersona({ ...PERSONA_BRUTA, ancora_imagem_id: "c2" })!;
    const r = resumoDaPersona(p, imgs);
    expect(r.ancora && r.ancora.id).toBe("c2");
    expect(r.vistasProntas).toBe(1);
    expect(r.vistas.frente).toBeNull();
    expect(r.detalhes.map((d) => d.id)).toEqual(["d1"]);
    expect(candidatasPorMotor(r.candidatas, [GPT, NANO]).map((g) => g.motor_id)).toEqual([GPT, NANO]);
    expect(VISTAS_DA_FOLHA.map((v) => v.valor)).toEqual(["frente", "tres_quartos_esq", "tres_quartos_dir", "perfil_esq", "meio_corpo", "corpo_inteiro"]);
  });

  it("em paralelo: todas as chamadas saem, e a falha de uma não para as outras", async () => {
    const feitos: number[] = [];
    await emParalelo([1, 2, 3, 4, 5], 2, async (n) => {
      if (n === 2) throw new Error("falhou");
      feitos.push(n);
    });
    expect(feitos.sort()).toEqual([1, 3, 4, 5]);
  });

  it("foto gerada no Canvas ou detalhada em 4K conta como gerada no acervo", () => {
    const f = normalizarFoto({ id: "x", storage_path: "a.png", modo: "canvas" });
    expect(f && f.modo).toBe("canvas");
    expect(classeDaFoto({ gerada: false, derivada_de: null, modo: "detalhe" })).toBe("gerada");
  });
});

// ------------------------------------------------------------------ modelos: tela

describe("aba Modelos", () => {
  it("nova persona: recusa idade abaixo de 21, e cria com a ficha, as referências de estilo e a declaração ética", async () => {
    respostas.modelo_criar = (b: any) => {
      const modelo = { id: P2, client_id: b.escopo === "agencia" ? null : b.client_id, nome: b.nome, ficha: b.ficha, status: "rascunho" };
      (mock.tabelas.foto_modelos as any[]).unshift(modelo);
      return { modelo };
    };
    montar(h(EtapaModelos));
    fireEvent.click((await screen.findAllByRole("button", { name: /Nova persona/ }))[0]);
    fireEvent.change(screen.getByLabelText("Nome da persona"), { target: { value: "Bia" } });
    fireEvent.change(screen.getByLabelText("Idade aparente"), { target: { value: "19" } });
    fireEvent.click(screen.getByRole("button", { name: /Criar persona/ }));
    expect(await screen.findByText("Idade aparente mínima: 21 anos.")).toBeTruthy();
    expect(chamadasDe("modelo_criar")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Idade aparente"), { target: { value: "31" } });
    fireEvent.change(screen.getByLabelText("Cabelo"), { target: { value: "preto, cacheado" } });
    fireEvent.click(screen.getByLabelText("Declaração ética"));
    fireEvent.click(screen.getByRole("button", { name: /Criar persona/ }));
    await waitFor(() => expect(chamadasDe("modelo_criar")).toHaveLength(1));
    const corpo = chamadasDe("modelo_criar")[0];
    expect(corpo).toMatchObject({ client_id: CLIENTE, escopo: "cliente", etica_confirmada: true, nome: "Bia" });
    expect(corpo.ficha).toMatchObject({ idade_aparente: 31, cabelo: { cor: "preto", comprimento: "cacheado", textura: "" }, genero_apresentado: "feminino" });
    expect(corpo.modelo).toBeUndefined();
    await waitFor(() => expect(document.querySelector(`[data-persona-aberta="${P2}"]`)).toBeTruthy());
  });

  it("rodada lado a lado: uma chamada por motor ligado, juntas, com a resolução de cada um; erro de um motor fica na coluna dele", async () => {
    respostas.modelo_candidata_gerar = (b: any) => {
      if (b.modelo_imagem_id === SEEDREAM) return { error: "modelo_indisponivel", mensagem: "Seedream fora do ar agora." };
      const img = imagemBruta(`cand-${b.modelo_imagem_id.slice(-6)}`, { motor_id: b.modelo_imagem_id, rodada_id: b.rodada_id });
      (mock.tabelas.foto_modelo_imagens as any[]).push(img);
      return { imagem: { ...img, url: "https://arquivo.test/c.png" }, url: "https://arquivo.test/c.png", custo_usd: 0.1 };
    };
    montar(h(EtapaModelos));
    // Motores: cartões com liga/desliga e preço; os 3 padrões do catálogo vêm ligados.
    const motores = await screen.findByRole("list", { name: "Motores da rodada" });
    expect(within(motores).getAllByRole("switch").filter((s) => s.getAttribute("aria-checked") === "true")).toHaveLength(3);
    expect(screen.getByText(/Ainda não ativos no catálogo: MAI-Image-2.6/)).toBeTruthy();
    const gerar = screen.getByRole("button", { name: /Gerar 3 candidatas/ });
    // Total antes de gastar: 0,10 + 0,134 + 0,09 (mais a entrada).
    expect(gerar.textContent).toMatch(/~US\$ 0,3/);
    fireEvent.click(gerar);
    await waitFor(() => expect(chamadasDe("modelo_candidata_gerar")).toHaveLength(3));
    const corpos = chamadasDe("modelo_candidata_gerar");
    expect(corpos.map((c) => c.modelo_imagem_id)).toEqual([GPT, NANO, SEEDREAM]);
    expect(corpos.map((c) => c.resolucao)).toEqual([undefined, "2K", "2K"]);
    corpos.forEach((c) => expect(c).toMatchObject({ client_id: CLIENTE, modelo_id: P1, qualidade: "alta" }));
    // A rodada inteira leva o mesmo id (UUID criado na tela), sem campo que a função não lê.
    expect(corpos[0].rodada_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(new Set(corpos.map((c) => c.rodada_id)).size).toBe(1);
    corpos.forEach((c) => expect(Object.keys(c).filter((k) => ["motor_id", "formato", "prompt_extra"].indexOf(k) >= 0)).toEqual([]));
    // As que saíram aparecem por motor, com o selo de gerada; o erro fica escrito na coluna do Seedream.
    await waitFor(() => expect(document.querySelectorAll("[data-candidata]").length).toBe(2));
    expect(document.querySelectorAll('[data-coluna-do-motor] [data-selo="gerada"]').length).toBe(2);
    expect(await screen.findByText("Seedream fora do ar agora.")).toBeTruthy();
    // Escolher a âncora (a mais real): decisão do dono.
    respostas.modelo_ancora_escolher = { modelo: { ...PERSONA_BRUTA, status: "ancora", ancora_imagem_id: (mock.tabelas.foto_modelo_imagens as any[])[1].id, motor_preferido_id: NANO } };
    const coluna = document.querySelector(`[data-coluna-do-motor="${NANO}"]`) as HTMLElement;
    fireEvent.click(within(coluna).getByRole("button", { name: /Âncora/ }));
    await waitFor(() => expect(chamadasDe("modelo_ancora_escolher")).toHaveLength(1));
    expect(chamadasDe("modelo_ancora_escolher")[0]).toEqual({ acao: "modelo_ancora_escolher", modelo_id: P1, imagem_id: (mock.tabelas.foto_modelo_imagens as any[])[1].id });
  });

  it("comparação às cegas esconde o nome do motor até escolher a âncora", async () => {
    mock.tabelas.foto_modelo_imagens = [imagemBruta("c1", { motor_id: GPT }), imagemBruta("c2", { motor_id: NANO })];
    montar(h(EtapaModelos));
    await waitFor(() => expect(document.querySelectorAll("[data-candidata]").length).toBe(2));
    fireEvent.click(screen.getByLabelText("Comparação às cegas"));
    const colunas = screen.getByRole("list", { name: "Candidatas por motor" });
    expect(within(colunas).getByText("Motor A")).toBeTruthy();
    expect(within(colunas).getByText("Motor B")).toBeTruthy();
    expect(within(colunas).queryByText("GPT Image 2.5")).toBeNull();
  });

  it("folha de 6 vistas com o motor da âncora, e Detalhar em 4K vira versão nova com antes e depois", async () => {
    mock.tabelas.foto_modelos = [{ ...PERSONA_BRUTA, status: "ancora", ancora_imagem_id: ANCORA, motor_preferido_id: GPT }];
    mock.tabelas.foto_modelo_imagens = [imagemBruta(ANCORA, { papel: "ancora", motor_id: GPT })];
    respostas.modelo_vista_gerar = (b: any) => ({ imagem: imagemBruta(`vista-${b.vista}`, { papel: "vista", vista: b.vista, motor_id: GPT }), custo_usd: 0.1 });
    montar(h(EtapaModelos));
    const gerarFolha = await screen.findByRole("button", { name: /Gerar a folha/ });
    fireEvent.click(gerarFolha);
    await waitFor(() => expect(chamadasDe("modelo_vista_gerar")).toHaveLength(6));
    expect(chamadasDe("modelo_vista_gerar").map((c) => c.vista).sort()).toEqual(VISTAS_DA_FOLHA.map((v) => v.valor).sort());
    // A folha usa o gerador da âncora, escolhido pela função: a tela não manda motor (a função recusaria outro).
    chamadasDe("modelo_vista_gerar").forEach((c) => {
      expect(c).toMatchObject({ client_id: CLIENTE, modelo_id: P1, qualidade: "alta" });
      expect(c.motor_id).toBeUndefined();
      expect(c.modelo_imagem_id).toBeUndefined();
    });

    respostas.modelo_detalhar = () => {
      const imagem = imagemBruta("detalhe-1", { papel: "detalhe", resolucao: "4K" });
      (mock.tabelas.foto_modelo_imagens as any[]).push({ ...imagem, derivada_de: ANCORA });
      return { origem: "modelo", imagem, url: "https://arquivo.test/d.png", antes: { imagem_id: ANCORA, url: "https://arquivo.test/a.png" }, depois: { imagem_id: "detalhe-1", url: "https://arquivo.test/d.png" }, custo_usd: 0.24 };
    };
    fireEvent.click(screen.getByRole("button", { name: /Detalhar em 4K/ }));
    await waitFor(() => expect(chamadasDe("modelo_detalhar")).toHaveLength(1));
    expect(chamadasDe("modelo_detalhar")[0]).toEqual({ acao: "modelo_detalhar", client_id: CLIENTE, modelo_id: P1, imagem_id: ANCORA, alvo: "pessoa", modelo_imagem_id: NANO });
    expect(await screen.findByLabelText("Cortina entre antes e depois")).toBeTruthy();
    // Ampliação fiel espera a conta fal.ai.
    expect((screen.getByRole("button", { name: "Ampliar fiel" }) as HTMLButtonElement).disabled).toBe(true);
    // Persona com âncora pode ir para o Canvas.
    expect(screen.getByRole("button", { name: /Usar no Canvas/ })).toBeTruthy();
  });

  it("conferir uma candidata mostra a leitura como aviso, sem escolher sozinho", async () => {
    mock.tabelas.foto_modelo_imagens = [imagemBruta("c1", { motor_id: GPT })];
    respostas.modelo_conferir = { conferencia: { alertas: ["Pele lisa demais na testa"], notas_jev: { realismo_pele: 0.4 } }, custo_usd: 0.01 };
    montar(h(EtapaModelos));
    await waitFor(() => expect(document.querySelector(`[data-coluna-do-motor="${GPT}"]`)).toBeTruthy());
    const coluna = document.querySelector(`[data-coluna-do-motor="${GPT}"]`) as HTMLElement;
    fireEvent.click(within(coluna).getByRole("button", { name: /Conferir/ }));
    await waitFor(() => expect(chamadasDe("modelo_conferir")).toEqual([{ acao: "modelo_conferir", client_id: CLIENTE, modelo_id: P1, imagem_id: "c1" }]));
    expect(await screen.findByText("Pele lisa demais na testa")).toBeTruthy();
    expect(screen.getByText("Conferência (aviso, você decide)")).toBeTruthy();
    expect(chamadasDe("modelo_ancora_escolher")).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ canvas: grafo

describe("canvas: o grafo em código (sem React Flow)", () => {
  const base = () => {
    const c = canvasVazio(CLIENTE);
    const gerar = novoNo("gerar", 400, 0, { motores: [GPT] });
    const produto = novoNo("produto", 0, 0, { kit_id: KIT });
    const estilo = novoNo("estilo", 0, 300, { texto: "céu azul" });
    const pessoa = novoNo("modelo", 0, 150, { modelo_id: P1 });
    return { c: { ...c, nos: [gerar, estilo, produto, pessoa] }, gerar, produto, estilo, pessoa };
  };

  it("liga só cartão para Saída, sem repetir; a entrada sai do tipo do cartão; a ordem é produto, pessoa, ambiente, estilo, texto", () => {
    const { c, gerar, produto, estilo, pessoa } = base();
    expect(podeLigar(c, gerar.id, produto.id)).toBeNull();
    expect(podeLigar(c, produto.id, produto.id)).toBeNull();
    let g = ligar(c, estilo.id, gerar.id);
    g = ligar(g, produto.id, gerar.id);
    g = ligar(g, pessoa.id, gerar.id);
    expect(ligar(g, produto.id, gerar.id).ligacoes).toHaveLength(3);
    expect(entradasDoGerar(g, gerar.id).map((e) => [e.numero, e.entrada])).toEqual([
      [1, "produto"],
      [2, "pessoa"],
      [3, "estilo"],
    ]);
    const semEstilo = desligar(g, g.ligacoes[0].id);
    expect(entradasDoGerar(semEstilo, gerar.id).map((e) => e.entrada)).toEqual(["produto", "pessoa"]);
    const semProduto = removerNo(g, produto.id);
    expect(semProduto.nos.some((n) => n.id === produto.id)).toBe(false);
    expect(semProduto.ligacoes.some((l) => l.de === produto.id)).toBe(false);
  });

  it("bloqueios iguais aos da função: sem produto e sem pessoa, persona sem âncora, cartão incompleto, nenhum motor", () => {
    const { c, gerar, estilo, pessoa } = base();
    expect(bloqueiosDoGerar(ligar(c, estilo.id, gerar.id), gerar.id)).toContain("Ligue ao menos um produto ou uma persona.");
    const personas = [normalizarPersona(PERSONA_BRUTA)!];
    const comPessoa = ligar(c, pessoa.id, gerar.id);
    expect(bloqueiosDoGerar(comPessoa, gerar.id, personas).join(" ")).toMatch(/Marina ainda não tem âncora/);
    const semMotor = { ...comPessoa, nos: comPessoa.nos.map((n) => (n.id === gerar.id ? { ...n, dados: { ...n.dados, motores: [] } } : n)) };
    expect(bloqueiosDoGerar(semMotor, gerar.id, [{ ...personas[0], status: "pronta" }])).toEqual(["Ligue ao menos um motor."]);
    const vazio = novoNo("produto", 0, 0);
    expect(bloqueiosDoGerar(ligar({ ...c, nos: c.nos.concat([vazio]) }, vazio.id, gerar.id), gerar.id).join(" ")).toMatch(/escolha o produto/);
  });

  it("normaliza o canvas salvo em qualquer forma (nos/ligacoes ou nodes/edges do quadro) e manda só JSON limpo", () => {
    const c = normalizarCanvas({
      id: CANVAS,
      nome: "Óculos na praia",
      nodes: [
        { id: "g", tipo: "saida", position: { x: 10.4, y: 20.6 }, data: { motores: [GPT], formato: "9:16" } },
        { id: "p", tipo: "produto", x: 0, y: 0, dados: { kit_id: KIT } },
        { id: "t", tipo: "prompt", x: 0, y: 0, dados: { texto: "na praia" } },
        { id: "z", tipo: "desconhecido" },
      ],
      edges: [
        { source: "p", target: "g" },
        { source: "g", target: "p" },
        { source: "t", target: "g", ordem: 0 },
      ],
      viewport: { x: 5, y: 6, zoom: 0.8 },
      versao: 3,
    })!;
    expect(c.nos.map((n) => n.tipo)).toEqual(["gerar", "produto", "texto"]);
    expect(c.ligacoes.map((l) => l.entrada)).toEqual(["produto", "texto"]);
    expect(c.nos[0].dados).toMatchObject({ motores: [GPT], formato: "9:16", qualidade: "alta", resultados: [] });
    const corpo = corpoDoCanvas(c) as any;
    expect(corpo).toMatchObject({ id: CANVAS, nome: "Óculos na praia", viewport: { x: 5, y: 6, zoom: 0.8 } });
    // Vai com os nomes da função (saida, prompt) e a ligação sem "entrada" (sai do tipo do cartão).
    expect(corpo.nos[0]).toMatchObject({ id: "g", tipo: "saida", x: 10, y: 21 });
    expect(corpo.nos[2]).toMatchObject({ id: "t", tipo: "prompt", dados: { texto: "na praia", papel: "pedido" } });
    expect(corpo.ligacoes[0]).toEqual({ id: "lig-p-g", de: "p", para: "g", ordem: 0 });
    expect(JSON.parse(JSON.stringify(corpo))).toEqual(corpo);
  });

  it("modelos prontos montam o grafo já ligado; resultados se juntam sem repetir; rascunho local sobrevive sem armazenamento", () => {
    const pronto = aplicarModeloPronto(canvasVazio(CLIENTE), "produto-pessoa-ambiente", GPT);
    const gerar = pronto.nos.find((n) => n.tipo === "gerar")!;
    expect(gerar.dados.motores).toEqual([GPT]);
    expect(entradasDoGerar(pronto, gerar.id).map((e) => e.entrada)).toEqual(["produto", "pessoa", "ambiente"]);
    const r = { geracao_id: "g1", imagem_id: "i1", storage_bucket: "mesa", storage_path: "a.png", url: "", motor_id: GPT, status: "gerada" as const, erro: "", custo_usd: 0.1, conferencia: null, criado_em: "" };
    const um = juntarResultados(pronto, { [gerar.id]: [r] });
    const dois = juntarResultados(um, { [gerar.id]: [r] });
    expect(dois.nos.find((n) => n.id === gerar.id)!.dados.resultados).toHaveLength(1);
    guardarRascunho({ ...pronto, id: CANVAS });
    expect(lerRascunho(CLIENTE, CANVAS)!.nos).toHaveLength(4);
    const original = window.localStorage.getItem.bind(window.localStorage);
    const espiao = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    expect(lerRascunho(CLIENTE, CANVAS)).toBeNull();
    espiao.mockRestore();
    expect(original).toBeTruthy();
  });

  it("o pedido montado (canvas_montar) aceita as formas combinadas", () => {
    const m = normalizarMontagem({
      compilado: {
        referencias: [
          { ordem: 2, papel: "pessoa", origem: { tipo: "modelo", id: P1 }, imagem_id: ANCORA },
          { ordem: 1, papel: "produto", origem: { tipo: "produto", id: KIT }, imagem_id: F1 },
        ],
        prompt: "Imagem 1: o produto. Imagem 2: a pessoa.",
        avisos: ["Folha incompleta"],
      },
      estimativa_usd: "0.12",
    });
    expect(m.referencias.map((r) => [r.ordem, r.papel, r.origem_tipo])).toEqual([
      [1, "produto", "produto"],
      [2, "pessoa", "modelo"],
    ]);
    expect(m.estimativa_usd).toBe(0.12);
    expect(m.avisos).toEqual(["Folha incompleta"]);
  });
});

// ------------------------------------------------------------------ canvas: tela

const CANVAS_BRUTO = {
  id: CANVAS,
  client_id: CLIENTE,
  nome: "Óculos com a Marina",
  versao: 3,
  status: "ativo",
  atualizado_em: "2026-09-24T12:00:00Z",
  viewport: { x: 0, y: 0, zoom: 1 },
  nos: [
    { id: "no-produto", tipo: "produto", x: 0, y: 0, dados: { kit_id: KIT } },
    { id: "no-pessoa", tipo: "modelo", x: 0, y: 160, dados: { modelo_id: P1, versao: 1 } },
    { id: "no-saida", tipo: "gerar", x: 380, y: 40, dados: { motores: [GPT, NANO], formato: "4:5", qualidade: "alta" } },
  ],
  ligacoes: [
    { id: "l1", de: "no-produto", para: "no-saida", entrada: "produto", ordem: 0 },
    { id: "l2", de: "no-pessoa", para: "no-saida", entrada: "pessoa", ordem: 0 },
  ],
};

describe("aba Canvas", () => {
  beforeEach(() => {
    mock.tabelas.foto_canvas = [CANVAS_BRUTO];
    mock.tabelas.foto_modelos = [{ ...PERSONA_BRUTA, status: "pronta", ancora_imagem_id: ANCORA }];
    mock.tabelas.foto_modelo_imagens = [imagemBruta(ANCORA, { papel: "ancora" })];
  });

  it("abre o canvas salvo com os cartões no quadro e a Saída com as entradas na ordem", async () => {
    montar(h(EtapaCanvas));
    await waitFor(() => expect(document.querySelectorAll("[data-no-do-canvas]").length).toBe(3));
    expect(document.querySelector('[data-no-do-canvas="no-saida"]')!.getAttribute("data-tipo")).toBe("gerar");
    const entradas = await screen.findByRole("list", { name: "Entradas da Saída" });
    expect(entradas.textContent).toContain("Produto: Óculos Aro Fino");
    expect(entradas.textContent).toContain("Pessoa: Marina");
    // As ligações viram linhas no quadro, com a cor do papel.
    await waitFor(() => expect(document.querySelectorAll(".react-flow__edge").length).toBe(2));
    expect(screen.getByText("Salvo")).toBeTruthy();
  });

  it("tocar num cartão da paleta põe no quadro e já liga à Saída única", async () => {
    montar(h(EtapaCanvas));
    await waitFor(() => expect(document.querySelectorAll("[data-no-do-canvas]").length).toBe(3));
    fireEvent.click(document.querySelectorAll('[data-paleta="estilo"]')[0] as HTMLElement);
    await waitFor(() => expect(document.querySelectorAll('[data-no-do-canvas][data-tipo="estilo"]').length).toBe(1));
    await waitFor(() => expect(document.querySelectorAll(".react-flow__edge").length).toBe(3));
    expect(screen.getByText("Alterações não salvas")).toBeTruthy();
  });

  it("Montar mostra o pedido que vai ao gerador; Gerar dispara uma chamada por motor e o resultado volta na Saída", async () => {
    respostas.canvas_montar = { referencias: [{ ordem: 1, papel: "produto", imagem_id: F1 }, { ordem: 2, papel: "pessoa", imagem_id: ANCORA }], prompt: "Imagem 1: o produto Óculos Aro Fino (não mudar formato, cor, logo).", estimativa_usd: 0.1 };
    respostas.canvas_gerar = (b: any) => ({
      geracao: { id: `ger-${b.modelo_imagem_id.slice(-5)}`, motor_id: b.modelo_imagem_id, status: "gerada" },
      imagem: { id: `img-${b.modelo_imagem_id.slice(-5)}`, client_id: CLIENTE, nome: "canvas.png", storage_bucket: "mesa", storage_path: `${CLIENTE}/foto/canvas/${b.modelo_imagem_id.slice(-5)}.png`, gerada: true, modo: "canvas" },
      custo_usd: 0.1,
    });
    montar(h(EtapaCanvas));
    fireEvent.click(await screen.findByRole("button", { name: /Montar/ }));
    await waitFor(() => expect(chamadasDe("canvas_montar")).toHaveLength(1));
    expect(chamadasDe("canvas_montar")[0]).toEqual({ acao: "canvas_montar", canvas_id: CANVAS, no_saida_id: "no-saida", modelo_imagem_id: GPT, qualidade: "alta" });
    await waitFor(() => expect(document.querySelector("[data-pedido-montado]")).toBeTruthy());
    const pedido = document.querySelector("[data-pedido-montado]") as HTMLElement;
    expect(pedido.textContent).toContain("Imagem 1: o produto Óculos Aro Fino");
    expect(within(pedido).getByRole("list", { name: "Referências na ordem" }).querySelectorAll("li")).toHaveLength(2);

    const gerar = screen.getByRole("button", { name: /Gerar em 2 motores/ });
    expect(gerar.textContent).toMatch(/~US\$ 0,2/);
    fireEvent.click(gerar);
    await waitFor(() => expect(chamadasDe("canvas_gerar")).toHaveLength(2));
    expect(chamadasDe("canvas_gerar").map((c) => c.modelo_imagem_id)).toEqual([GPT, NANO]);
    chamadasDe("canvas_gerar").forEach((c) => expect(c).toEqual({ acao: "canvas_gerar", canvas_id: CANVAS, no_saida_id: "no-saida", modelo_imagem_id: c.modelo_imagem_id, qualidade: "alta" }));
    await waitFor(() => expect(document.querySelectorAll("[data-resultado]").length).toBe(2));
    expect(document.querySelectorAll('[data-resultado] [data-selo="gerada"]').length).toBe(2);

    respostas.canvas_conferir = { conferencia: { alertas: ["Cor da armação mais escura que no kit"] } };
    fireEvent.click(within(document.querySelectorAll("[data-resultado]")[0] as HTMLElement).getByRole("button", { name: /Conferir/ }));
    await waitFor(() => expect(chamadasDe("canvas_conferir")).toHaveLength(1));
    expect(await screen.findByText("Cor da armação mais escura que no kit")).toBeTruthy();
  });

  it("salvar manda a versão esperada; se outra aba mudou, avisa e oferece recarregar", async () => {
    respostas.canvas_salvar = { error: "canvas_mudou", mensagem: "O canvas mudou em outra aba." };
    montar(h(EtapaCanvas));
    fireEvent.click(await screen.findByRole("button", { name: /^Salvar/ }));
    await waitFor(() => expect(chamadasDe("canvas_salvar")).toHaveLength(1));
    const corpo = chamadasDe("canvas_salvar")[0];
    expect(corpo).toMatchObject({ client_id: CLIENTE, versao_esperada: 3, canvas: { id: CANVAS, nome: "Óculos com a Marina" } });
    expect(corpo.canvas.ligacoes).toEqual([
      { id: "l1", de: "no-produto", para: "no-saida", ordem: 0 },
      { id: "l2", de: "no-pessoa", para: "no-saida", ordem: 0 },
    ]);
    expect(corpo.canvas.nos.map((n: any) => n.tipo)).toEqual(["produto", "modelo", "saida"]);
    expect(await screen.findByText("Mudou em outra aba")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Recarregar" })).toBeTruthy();
  });

  it("modo lista (celular): o mesmo grafo em formulário, e adicionar já liga à Saída", async () => {
    montar(h(EtapaCanvas));
    fireEvent.click(await screen.findByRole("button", { name: /Modo lista/ }));
    await waitFor(() => expect(document.querySelector("[data-modo-lista]")).toBeTruthy());
    const lista = document.querySelector("[data-modo-lista]") as HTMLElement;
    expect(lista.querySelectorAll("[data-entrada-da-lista]")).toHaveLength(2);
    fireEvent.click(within(lista).getByRole("button", { name: /Prompt/ }));
    await waitFor(() => expect(lista.querySelectorAll("[data-entrada-da-lista]")).toHaveLength(3));
    expect(screen.getByLabelText("Texto do prompt")).toBeTruthy();
  });

  it("canvas novo nasce com a Saída e o motor padrão; 'Usar no Canvas' da aba Modelos chega com a persona", async () => {
    mock.tabelas.foto_canvas = [];
    pedirAoCanvas(CLIENTE, P1);
    montar(h(EtapaCanvas));
    await waitFor(() => expect(document.querySelectorAll('[data-no-do-canvas][data-tipo="gerar"]').length).toBe(1));
    await waitFor(() => expect(document.querySelectorAll('[data-no-do-canvas][data-tipo="modelo"]').length).toBe(1));
    // A persona chega ligada à Saída (número 1 na ordem), e a Saída nasce com 1 motor (o padrão).
    await waitFor(() => expect(document.querySelectorAll(".react-flow__edge").length).toBe(1));
    const pessoa = document.querySelector('[data-no-do-canvas][data-tipo="modelo"]') as HTMLElement;
    await waitFor(() => expect(pessoa.textContent).toContain("Marina"));
    expect((document.querySelector('[data-no-do-canvas][data-tipo="gerar"]') as HTMLElement).textContent).toContain("1 motor");
    // O painel abre no cartão novo, com a persona escolhida.
    expect(screen.getByText("Cartão: Modelo")).toBeTruthy();
  });
});

// ------------------------------------------------------------------ contrato tela x função

/**
 * Contrato pelo código: cada campo que a tela manda é lido pela ação na função
 * (modelos.ts, canvas.ts, canvas-regras.ts), e os obrigatórios vão sempre. Se
 * um lado renomear um campo sem o outro, estes testes quebram.
 */
const FONTE_DA_FUNCAO = ["modelos.ts", "canvas.ts", "canvas-regras.ts"].map((n) => ler(`supabase/functions/mesa-foto/${n}`)).join("\n");

/** Corpo de uma function (até a chave que fecha no mesmo recuo da declaração); vazio se não existe. */
function corpoDaFuncao(nome: string): string {
  const i = FONTE_DA_FUNCAO.indexOf(`function ${nome}(`);
  if (i < 0) return "";
  const inicioDaLinha = FONTE_DA_FUNCAO.lastIndexOf("\n", i) + 1;
  const recuo = /^ */.exec(FONTE_DA_FUNCAO.slice(inicioDaLinha, i))![0];
  const fim = FONTE_DA_FUNCAO.indexOf(`\n${recuo}}\n`, i);
  return FONTE_DA_FUNCAO.slice(i, fim < 0 ? undefined : fim);
}

/** Campos de `corpo` que a function lê, somando as functions para as quais ela passa o corpo. */
function camposLidos(nome: string, vistos: string[] = []): string[] {
  if (vistos.indexOf(nome) >= 0) return [];
  vistos.push(nome);
  const fonte = corpoDaFuncao(nome);
  const campos: string[] = [];
  const somar = (c: string) => {
    if (campos.indexOf(c) < 0) campos.push(c);
  };
  const leituras = /\bcorpo\.([a-z_]+)/g;
  let m: RegExpExecArray | null;
  while ((m = leituras.exec(fonte))) somar(m[1]);
  const repasses = /(\w+)\([^()]*\bcorpo\b/g;
  while ((m = repasses.exec(fonte))) camposLidos(m[1], vistos).forEach(somar);
  return campos;
}

/** A function que atende a ação (o mapa acoes de modelos.ts e canvas.ts). */
function funcaoDaAcao(acao: string): string {
  const m = new RegExp(`\\b${acao}: (\\w+),`).exec(FONTE_DA_FUNCAO);
  expect(m, `ação ${acao} registrada na função`).toBeTruthy();
  return m ? m[1] : "";
}

/** O que a função exige em cada ação (UUID, ética, gerador, decisão, versão). */
const OBRIGATORIOS: Record<string, string[]> = {
  modelo_criar: ["client_id", "nome", "ficha", "escopo", "etica_confirmada"],
  modelo_candidata_gerar: ["modelo_id", "modelo_imagem_id"],
  modelo_ancora_escolher: ["modelo_id", "imagem_id"],
  modelo_vista_gerar: ["modelo_id", "vista"],
  modelo_detalhar: ["imagem_id", "alvo"],
  modelo_conferir: ["modelo_id", "imagem_id"],
  modelo_imagem_decidir: ["imagem_id", "decisao"],
  canvas_salvar: ["client_id", "canvas", "versao_esperada"],
  canvas_montar: ["canvas_id", "no_saida_id", "modelo_imagem_id"],
  canvas_gerar: ["canvas_id", "no_saida_id", "modelo_imagem_id"],
  canvas_conferir: ["geracao_id"],
};

describe("contrato tela x função: nomes de ação e de campo", () => {
  it("o leitor de campos acha o que a função lê (inclusive pelo que ela repassa)", () => {
    expect(camposLidos("modeloCriar")).toEqual(expect.arrayContaining(["client_id", "etica_confirmada", "nome", "ficha", "escopo", "referencias", "referencias_ids", "uso_referencias"]));
    expect(camposLidos("canvasGerar")).toEqual(expect.arrayContaining(["canvas_id", "no_saida_id", "modelo_imagem_id", "qualidade", "resolucao", "seed"]));
  });

  it("cada chamada da tela manda só campos que a ação lê, e sempre os obrigatórios", async () => {
    const rascunho = { ...rascunhoVazio(), nome: "Bia", etica: true, referencias: [{ imagem_id: F1, uso: "luz" as const }] };
    const canvas: Canvas = { ...canvasVazio(CLIENTE), id: CANVAS, versao: 2, nos: [novoNo("gerar", 0, 0, { motores: [GPT] })] };
    await criarPersona(CLIENTE, rascunho);
    await gerarCandidata({ clientId: CLIENTE, modeloId: P1, motorId: NANO, resolucao: "2K", qualidade: "alta", pedido: "luz de janela", rodadaId: novoIdDeRodada() });
    await escolherAncora(P1, ANCORA);
    await gerarVista({ clientId: CLIENTE, modeloId: P1, vista: "frente", qualidade: "alta" });
    await detalharImagem({ clientId: CLIENTE, modeloId: P1, imagemId: ANCORA, motorId: NANO });
    await conferirImagemDaPersona(CLIENTE, P1, ANCORA);
    await decidirImagemDaPersona(ANCORA, "aprovar", "a mais real");
    await salvarCanvas(canvas);
    await montarCanvas({ canvasId: CANVAS, gerarId: canvas.nos[0].id, motorId: GPT, qualidade: "alta", resolucao: "2K" });
    await gerarNoCanvas({ canvasId: CANVAS, gerarId: canvas.nos[0].id, motorId: GPT, qualidade: "media" });
    await conferirGeracao("99999999-0000-4000-8000-000000000001");
    const acoes = Object.keys(OBRIGATORIOS);
    for (const acao of acoes) {
      const corpos = chamadasDe(acao);
      expect(corpos.length, `a tela chamou ${acao}`).toBeGreaterThan(0);
      const lidos = camposLidos(funcaoDaAcao(acao));
      for (const corpo of corpos) {
        const mandados = Object.keys(corpo).filter((k) => k !== "acao");
        expect(mandados.filter((k) => lidos.indexOf(k) < 0), `${acao}: campos que a função não lê`).toEqual([]);
        expect(OBRIGATORIOS[acao].filter((k) => corpo[k] === undefined || corpo[k] === null || corpo[k] === ""), `${acao}: obrigatórios faltando`).toEqual([]);
        expect(OBRIGATORIOS[acao].filter((k) => lidos.indexOf(k) < 0), `${acao}: obrigatório que a função não lê`).toEqual([]);
      }
    }
    // O canvas dentro de canvas_salvar: só o que normalizarCanvas e canvasSalvar leem.
    const salvo = chamadasDe("canvas_salvar")[0].canvas;
    const doCanvas = camposLidos("canvasSalvar").concat(["id"]);
    expect(Object.keys(salvo).filter((k) => ["nome", "nos", "ligacoes", "viewport", "id"].indexOf(k) < 0)).toEqual([]);
    expect(doCanvas).toContain("canvas");
  });

  it("estimar: os alvos e os campos que a tela usa são os da função", () => {
    const tela = ler("src/components/mesa-foto/EtapaModelos.tsx");
    const alvos: string[] = [];
    const re = /usePrecoNoServidor\(clientId, "([a-z_]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(tela))) alvos.push(m[1]);
    expect(alvos.sort()).toEqual(["modelo_candidata", "modelo_detalhar"]);
    const daFuncao = /ALVOS_DE_ESTIMATIVA_DE_MODELOS = \[([^\]]*)\]/.exec(FONTE_DA_FUNCAO);
    alvos.forEach((a) => expect(daFuncao && daFuncao[1]).toContain(`"${a}"`));
    // A qualidade é lida pelo estimar do index; o resto pelo estimarModelos.
    const lidos = camposLidos("estimarModelos").concat(["qualidade"]);
    const extras = [extrasDaEstimativaDaCandidata(NANO, "2K", "alta", P1), extrasDaEstimativaDoDetalhe(NANO), extrasDaEstimativaDoDetalhe(null)];
    extras.forEach((e) => expect(Object.keys(e).filter((k) => lidos.indexOf(k) < 0)).toEqual([]));
  });

  it("ficha da tela passa na ficha da função (cabelo em partes, marcas em lista) e volta igual", () => {
    const r = { ...rascunhoVazio(), nome: "Bia", etica: true };
    r.ficha = { ...r.ficha, idade_aparente: 31, cabelo: "castanho escuro, ondulado, na altura do ombro", marcas: "sardas leves, pinta no queixo", rosto: "oval" };
    const corpo = corpoDaPersona(CLIENTE, { ...r, invariantes: "pinta no queixo\ncabelo sempre solto" });
    const ficha = normalizarFichaNaFuncao(corpo.ficha);
    expect(ficha.cabelo).toEqual({ cor: "castanho escuro", comprimento: "ondulado", textura: "na altura do ombro" });
    expect(ficha.marcas).toEqual(["sardas leves", "pinta no queixo"]);
    expect(invariantesDaFicha(ficha, corpo.invariantes)).toEqual(expect.arrayContaining(["pinta no queixo", "cabelo sempre solto"]));
    // A ficha gravada pela função volta para a tela com o mesmo texto.
    expect(normalizarFicha(ficha)).toMatchObject({ idade_aparente: 31, cabelo: "castanho escuro, ondulado, na altura do ombro", marcas: "sardas leves, pinta no queixo", rosto: "oval" });
  });

  it("vistas, status e geradores da tela são os da função", () => {
    expect(VISTAS_DA_FOLHA.map((v) => v.valor)).toEqual(FOLHA_PADRAO);
    VISTAS_DA_FOLHA.forEach((v) => expect(VISTAS_DA_PERSONA as readonly string[]).toContain(v.valor));
    expect(Object.keys(STATUS_DA_PERSONA).sort()).toEqual(STATUS_NA_FUNCAO.slice().sort());
    // Com o catálogo que a função usa, a tela acha todos os geradores da rodada, com o mesmo padrão e a mesma resolução.
    const doServidor = RODADA_PADRAO.map((r) => imagemDoCatalogo(r.modelo_imagem_id, r.modelo_imagem_id.split(":")[1], 0.1));
    const { opcoes, faltando } = motoresDaRodada(doServidor);
    expect(faltando).toEqual([]);
    RODADA_PADRAO.forEach((r) => {
      const o = opcoes.find((x) => x.id === r.modelo_imagem_id);
      expect(o, r.modelo_imagem_id).toBeTruthy();
      expect(o && [o.padrao, o.resolucao]).toEqual([r.padrao, r.resolucao]);
    });
    const comDetalhe = doServidor.concat([imagemDoCatalogo(MOTOR_DETALHE.produto, MOTOR_DETALHE.produto.split(":")[1], 0.1)]);
    expect((acharNoCatalogo(comDetalhe, MOTOR_DO_DETALHE.procura) || { id: "" }).id).toBe(MOTOR_DETALHE.pessoa);
  });

  it("canvas: o que a tela salva passa na validação da função e volta igual (tipos, dados, ligações, resultados)", () => {
    let c: Canvas = { ...canvasVazio(CLIENTE), id: CANVAS, versao: 4, nome: "Óculos na praia" };
    const gerar = novoNo("gerar", 400, 0, { motores: [GPT, NANO], formato: "9:16", qualidade: "media", resolucao: "2K" });
    const produto = novoNo("produto", 0, 0, { kit_id: KIT });
    const pessoa = novoNo("modelo", 0, 150, { modelo_id: P1, versao: 2 });
    const ambiente = novoNo("ambiente", 0, 300, { imagem_id: F1, texto: "praia ao fim da tarde" });
    const estilo = novoNo("estilo", 0, 450, { biblioteca_id: F1, texto: "céu azul" });
    const prompt = novoNo("texto", 0, 600, { texto: "sorrindo", papel: "restricao" });
    c = { ...c, nos: [gerar, produto, pessoa, ambiente, estilo, prompt] };
    [produto, pessoa, ambiente, estilo, prompt].forEach((n) => {
      c = ligar(c, n.id, gerar.id);
    });
    const resultado = { geracao_id: "g-1", imagem_id: F1, storage_bucket: "mesa", storage_path: `${CLIENTE}/foto/canvas/g-1.png`, url: "https://assinada.test/expira", motor_id: GPT, status: "gerada" as const, erro: "", custo_usd: 0.1, conferencia: null, criado_em: "2026-09-24T12:00:00Z" };
    c = juntarResultados(c, { [gerar.id]: [resultado] });
    const corpo = corpoDoCanvas(c) as any;
    // Todo tipo da tela tem nome na função, e é o mesmo que a função traduz do apelido.
    (Object.keys(TIPOS_DE_NO) as (keyof typeof TIPO_NA_FUNCAO)[]).forEach((t) => {
      expect(TIPOS_DE_NO_NA_FUNCAO as readonly string[]).toContain(TIPO_NA_FUNCAO[t]);
      expect(lerTipoDeNo(t)).toBe(TIPO_NA_FUNCAO[t]);
    });
    const naFuncao = normalizarCanvasNaFuncao(corpo);
    expect(naFuncao.nos.map((n) => n.tipo)).toEqual(["saida", "produto", "modelo", "ambiente", "estilo", "prompt"]);
    expect(naFuncao.ligacoes).toHaveLength(5);
    expect(naFuncao.nos[4].dados).toMatchObject({ imagem_ids: [], biblioteca_ids: [F1], guia: "céu azul" });
    expect(naFuncao.nos[2].dados).toMatchObject({ modelo_id: P1, versao: 2 });
    const resultados = naFuncao.nos[0].dados.resultados as any[];
    expect(resultados).toHaveLength(1);
    expect(resultados[0].url).toBeUndefined();
    // O que a função grava volta para a tela igual (a URL assinada não é guardada: a tela assina pelo caminho).
    const deVolta = normalizarCanvas({ ...naFuncao, id: CANVAS, versao: 4 }, CLIENTE)!;
    expect(deVolta.nos.map((n) => [n.id, n.tipo])).toEqual(c.nos.map((n) => [n.id, n.tipo]));
    expect(deVolta.ligacoes).toEqual(c.ligacoes);
    deVolta.nos.forEach((n) => {
      const antes = c.nos.find((x) => x.id === n.id)!;
      if (n.tipo === "gerar") expect(n.dados).toEqual({ ...antes.dados, resultados: [{ ...resultado, url: "" }] });
      else expect(n.dados).toEqual(antes.dados);
    });
  });

  it("canvas gravado com os nomes antigos da tela (texto, gerar, entrada, estilo no singular) continua abrindo na função", () => {
    const antigo = {
      nome: "Antigo",
      nos: [
        { id: "no-saida", tipo: "gerar", x: 0, y: 0, dados: { motores: [GPT], formato: "4:5" } },
        { id: "no-produto", tipo: "produto", x: 0, y: 0, dados: { kit_id: KIT } },
        { id: "no-estilo", tipo: "estilo", x: 0, y: 0, dados: { imagem_id: F1, texto: "luz fria" } },
        { id: "no-texto", tipo: "texto", x: 0, y: 0, dados: { texto: "na praia" } },
      ],
      ligacoes: [
        { id: "l1", de: "no-produto", para: "no-saida", entrada: "produto", ordem: 0 },
        { id: "l2", de: "no-estilo", para: "no-saida", entrada: "estilo", ordem: 0 },
        { id: "l3", de: "no-texto", para: "no-saida", entrada: "texto", ordem: 0 },
      ],
    };
    const g = canvasGravado(antigo);
    expect(g.nos.map((n) => n.tipo)).toEqual(["saida", "produto", "estilo", "prompt"]);
    expect(g.nos[2].dados).toMatchObject({ imagem_ids: [F1], guia: "luz fria" });
    expect(g.ligacoes.map((l) => Object.keys(l).sort())).toEqual([["de", "id", "ordem", "para"], ["de", "id", "ordem", "para"], ["de", "id", "ordem", "para"]]);
    // Pedido de montar e gerar com os nomes da tela vale igual ao da função.
    expect(lerPedidoDoCanvas({ no_gerar_id: "no-saida", motor_id: GPT })).toEqual(lerPedidoDoCanvas({ no_saida_id: "no-saida", modelo_imagem_id: GPT }));
  });

  it("conferência: o que a função devolve (persona e Canvas) aparece na tela como aviso, notas de 0 a 1", () => {
    const leitura = normalizarLeituraDaPersona({ pele: "poros visíveis", maos: "cinco dedos", resumo: "retrato natural", artefatos: [], lembra_alguem: "não" });
    const notas = { realismo_pele: 3, anatomia: 2, luz: 1, lembra_pessoa_publica: 0.7, identidade_diferente: null };
    const composto = alertasDoRealismo(notas, leitura);
    const daPersona = normalizarConferenciaDaPersona({ imagem_id: ANCORA, conferencia: { leitura, notas_jev: notas, nota_realismo: composto.nota_realismo, alertas: composto.alertas, jev_erro: null } })!;
    expect(daPersona.observado.slice(0, 3)).toEqual(["retrato natural", "pele: poros visíveis", "mãos: cinco dedos"]);
    expect(daPersona.alertas.join(" ")).toMatch(/pessoa pública/);
    expect(daPersona.notas.map((n) => n.criterio)).toEqual(["realismo", "realismo pele", "anatomia", "luz", "lembra pessoa publica"]);
    daPersona.notas.forEach((n) => expect(n.valor >= 0 && n.valor <= 1).toBe(true));
    const doCanvas = normalizarConferenciaDaPersona({ conferencia: { pontos: [{ criterio: "cor e acabamento do produto", ok: false, nota: "mais escura" }], alertas: [], resumo: "produto fiel", pele: "sem pessoa", lembra_alguem: "não", jev: { divergencia_critica: 0.2, lembra_pessoa_publica: null, realismo_pele: 1.5, aviso: false } } })!;
    expect(doCanvas.pontos[0]).toEqual({ criterio: "cor e acabamento do produto", ok: false, nota: "mais escura" });
    expect(doCanvas.observado[0]).toBe("produto fiel");
    expect(doCanvas.notas).toEqual([{ criterio: "divergencia critica", valor: 0.2 }, { criterio: "realismo pele", valor: 0.5 }]);
  });
});
