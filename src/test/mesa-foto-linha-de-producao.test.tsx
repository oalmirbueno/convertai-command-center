import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente FTL (30/09; dono: "a linha de produção das fotos está muito confusa
 * e difícil, facilite"): a Mesa Foto vira um caminho curto em 5 passos:
 * 1 O que fazer, 2 Fotos, 3 Gerar, 4 Aprovar, 5 Usar. Aqui: as regras puras
 * (objetivos, prontidão, destino do passo 3), a faixa do passo 2
 * (GuiaDaLinha), o passo 4 (Aprovar, com as duas filas) e a garantia de que
 * nenhuma etapa antiga sumiu.
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
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "gte", "lte", "lt", "contains", "order", "limit", "range", "update", "insert"]) b[m] = () => b;
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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
// A página inteira (rodada 2 da FTL): login de admin e o cliente na lista.
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));
vi.mock("@/hooks/useSupabaseData", () => ({
  useClients: () => ({
    data: [{ id: "11111111-1111-4111-8111-111111111111", company_name: "Loja A" }],
    isLoading: false,
    isSuccess: true,
    isFetching: false,
    dataUpdatedAt: 1,
    refetch: vi.fn(),
  }),
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import MesaFoto from "@/pages/MesaFoto";
import BarraDoEnsaio from "@/components/mesa-foto/BarraDoEnsaio";
import { gravarEstadoDaTela, lerEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { ETAPAS_DA_MESA_FOTO, ETAPAS_DE_APOIO, FORMAS_DE_CRIAR, MesaFotoProvider, PASSOS_PRINCIPAIS, passoDaEtapa, type MesaFotoValor } from "@/components/mesa-foto/Comuns";
import GuiaDaLinha from "@/components/mesa-foto/GuiaDaLinha";
import EtapaAprovar, { geradasParaAprovar } from "@/components/mesa-foto/EtapaAprovar";
import EtapaUsar from "@/components/mesa-foto/EtapaUsar";
import { focoDaTela } from "@/components/mesa-foto/diretorApi";
import { normalizarFoto, proximoPasso } from "@/components/mesa-foto/fotoApi";
import { ehObjetivo, etapaDeGerar, marcadasQueContam, objetivoDaEtapa, OBJETIVOS, prontidaoDasFotos } from "@/components/mesa-foto/linhaDeProducao";
import { MESAS_DO_PAINEL } from "@/lib/mesa/preCarga";

const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
const CLIENTE = "11111111-1111-4111-8111-111111111111";
const KIT = "bbbbbbbb-0000-4000-8000-000000000001";
const ENSAIO = "cccccccc-0000-4000-8000-000000000001";
const F1 = "aaaaaaaa-0000-4000-8000-000000000001";
const F2 = "aaaaaaaa-0000-4000-8000-000000000002";
const G1 = "aaaaaaaa-0000-4000-8000-000000000011";
const G2 = "aaaaaaaa-0000-4000-8000-000000000012";

const linhaDaFoto = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  client_id: CLIENTE,
  nome: `foto ${id.slice(-2)}.jpg`,
  storage_bucket: "mesa",
  storage_path: `${CLIENTE}/foto/originais/${id}.jpg`,
  origem: "upload",
  pasta: null,
  categoria: null,
  tags: [],
  descricao: null,
  ativa: true,
  derivada_de: null,
  gerada: false,
  modo: null,
  kit_id: null,
  aprovada: false,
  largura: 1600,
  altura: 1200,
  criado_em: "2026-09-20T10:00:00Z",
  ...extra,
});

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Loja A",
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
  pedirAoDiretor: vi.fn(),
  abrirNoEstudio: vi.fn(),
  prepararNaAgenda: vi.fn(),
  escolherObjetivo: vi.fn(),
  ...extra,
});

function montar(filho: any, foto: MesaFotoValor) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(MemoryRouter, { initialEntries: [`/mesa-foto?client=${CLIENTE}`] }, h(QueryClientProvider, { client: qc }, h(MesaProvider, { valor: valorDaMesa() }, h(MesaFotoProvider, { valor: foto }, filho)))));
}

const esperar = async (seletor: string) =>
  (await waitFor(() => {
    const el = document.querySelector(seletor);
    if (!el) throw new Error(`sem ${seletor}`);
    return el;
  })) as HTMLElement;

beforeAll(() => {
  if (typeof (globalThis as any).ResizeObserver === "undefined") {
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => {};
  if (!(Element.prototype as any).hasPointerCapture) (Element.prototype as any).hasPointerCapture = () => false;
});

beforeEach(() => {
  vi.restoreAllMocks();
  mock.invoke.mockReset();
  mock.rpc.mockReset();
  mock.tabelas = {};
  mock.rpc.mockResolvedValue({ data: {}, error: null });
  mock.invoke.mockResolvedValue({ data: { ok: true }, error: null });
  try {
    window.sessionStorage.clear();
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

// ------------------------------------------------------------------ regras puras

describe("linha de produção: regras", () => {
  it("5 passos na ordem do pedido do dono, e toda etapa antiga cabe num passo ou em Mais", () => {
    expect(PASSOS_PRINCIPAIS.map((p) => p.rotulo)).toEqual(["O que fazer", "Fotos", "Gerar", "Aprovar", "Usar"]);
    const noCaminho = PASSOS_PRINCIPAIS.reduce((a: string[], p) => a.concat(p.inclui as string[]), []);
    const emMais = ETAPAS_DE_APOIO.map((e) => e.etapa as string);
    // Nenhuma função sumiu: cada etapa da mesa está num passo ou nas ferramentas avançadas, sem repetir.
    for (const e of ETAPAS_DA_MESA_FOTO) expect(noCaminho.indexOf(e.valor) >= 0 || emMais.indexOf(e.valor) >= 0).toBe(true);
    expect(noCaminho.length + emMais.length).toBe(ETAPAS_DA_MESA_FOTO.length);
    expect(passoDaEtapa("revisar")!.rotulo).toBe("Aprovar");
    expect(passoDaEtapa("agenda")!.rotulo).toBe("Usar");
    expect(passoDaEtapa("kits")!.rotulo).toBe("Fotos");
    expect(passoDaEtapa("canvas")).toBeNull();
    // A mesa abre no passo 1.
    expect(MESAS_DO_PAINEL["/mesa-foto"].padrao).toBe("criar");
    expect(Object.keys(MESAS_DO_PAINEL["/mesa-foto"].etapas)).toContain("aprovar");
  });

  it("cada objetivo aponta a ferramenta do passo 3, e a ferramenta aberta diz o objetivo", () => {
    expect(OBJETIVOS.map((o) => [o.valor, o.etapa])).toEqual([
      ["melhorar", "estudio"],
      ["variacoes", "ensaio"],
      ["modelo", "campanha"],
      ["fundo", "preparar"],
      ["post", "agenda"],
    ]);
    for (const f of FORMAS_DE_CRIAR) expect(objetivoDaEtapa(f.etapa)).not.toBeNull();
    expect(objetivoDaEtapa("acervo")).toBeNull();
    // Rodada 2: a Agenda é do passo 5; chegar nela nunca vira "Post com fotos" sozinho.
    expect(objetivoDaEtapa("agenda")).toBeNull();
    expect(objetivoDaEtapa("usar")).toBeNull();
    expect(etapaDeGerar(null)).toBe("criar");
    expect(etapaDeGerar("modelo")).toBe("campanha");
    expect(ehObjetivo("post")).toBe(true);
    expect(ehObjetivo("qualquer")).toBe(false);
    // Termos simples: o nome da forma é o do objetivo (a ferramenta fica na dica).
    expect(FORMAS_DE_CRIAR.map((f) => f.rotulo)).toEqual(["Melhorar uma foto", "Fotos do produto", "Foto com modelo", "Tirar fundo e ajustes"]);
  });

  it("prontidão do passo 2: diz o que falta em uma frase e o texto do botão de seguir", () => {
    expect(prontidaoDasFotos({ objetivo: null, selecionadas: 3, kitId: KIT, produtos: 1 })).toMatchObject({ pronto: false, seguir: "Escolher o que fazer" });
    expect(prontidaoDasFotos({ objetivo: "melhorar", selecionadas: 0, kitId: null, produtos: 0 })).toMatchObject({ pronto: false, falta: "Marque 1 foto na grade (ou suba uma)." });
    expect(prontidaoDasFotos({ objetivo: "melhorar", selecionadas: 1, kitId: null, produtos: 0 })).toEqual({ pronto: true, falta: "", seguir: "Abrir no Estúdio" });
    expect(prontidaoDasFotos({ objetivo: "fundo", selecionadas: 2, kitId: null, produtos: 0 }).seguir).toBe("Abrir a primeira no Preparar");
    expect(prontidaoDasFotos({ objetivo: "variacoes", selecionadas: 0, kitId: null, produtos: 0 }).falta).toContain("Identificar o produto");
    expect(prontidaoDasFotos({ objetivo: "variacoes", selecionadas: 0, kitId: null, produtos: 2 }).falta).toBe("Escolha o produto logo abaixo.");
    expect(prontidaoDasFotos({ objetivo: "modelo", selecionadas: 0, kitId: KIT, produtos: 1 })).toEqual({ pronto: true, falta: "", seguir: "Montar a foto com modelo" });
    expect(prontidaoDasFotos({ objetivo: "post", selecionadas: 0, kitId: null, produtos: 0 }).pronto).toBe(false);
    expect(prontidaoDasFotos({ objetivo: "post", selecionadas: 30, kitId: null, produtos: 0 }).seguir).toBe("Montar o carrossel (20)");
  });

  it("o diretor recebe 'revisar' quando a tela é Aprovar (a função conhece as etapas antigas)", () => {
    expect(focoDaTela({ clientId: CLIENTE, etapa: "aprovar", selecionadas: [], kitId: null, ensaioId: null }).etapa).toBe("revisar");
    expect(focoDaTela({ clientId: CLIENTE, etapa: "criar", selecionadas: [], kitId: null, ensaioId: null }).etapa).toBe("criar");
  });
});

// ------------------------------------------------------------------ passo 2: a faixa das Fotos

describe("passo 2: a faixa da linha (GuiaDaLinha)", () => {
  it("sem objetivo, as 5 opções em pílulas escolhem sem sair da tela", async () => {
    const foto = valorDaFoto();
    montar(h(GuiaDaLinha), foto);
    const faixa = await esperar('[data-guia-da-linha="sem-objetivo"]');
    const pilulas = Array.from(faixa.querySelectorAll("[data-objetivo-rapido]")).map((b) => b.getAttribute("data-objetivo-rapido"));
    expect(pilulas).toEqual(["melhorar", "variacoes", "modelo", "fundo", "post"]);
    fireEvent.click(faixa.querySelector('[data-objetivo-rapido="post"]') as HTMLElement);
    expect(foto.escolherObjetivo).toHaveBeenCalledWith("post");
  });

  it("melhorar uma foto: sem foto marcada o botão espera; com a foto marcada, abre no Estúdio nela", async () => {
    mock.tabelas.cliente_imagens = [linhaDaFoto(F1), linhaDaFoto(F2)];
    const sem = valorDaFoto({ objetivo: "melhorar" });
    const r = montar(h(GuiaDaLinha), sem);
    await esperar('[data-guia-da-linha="melhorar"]');
    expect((document.querySelector("[data-seguir-na-linha]") as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector("[data-falta]")!.textContent).toContain("Marque 1 foto");
    r.unmount();

    const com = valorDaFoto({ objetivo: "melhorar", selecionadas: [F2] });
    montar(h(GuiaDaLinha), com);
    await waitFor(() => expect(document.querySelector('[data-guia-da-linha="melhorar"]')!.getAttribute("data-pronto")).toBe("sim"));
    fireEvent.click(document.querySelector("[data-seguir-na-linha]") as HTMLElement);
    expect(com.irPara).toHaveBeenCalledWith("estudio", { imagem: F2 });
    // "Trocar" volta ao passo 1.
    fireEvent.click(screen.getByRole("button", { name: "Trocar" }));
    expect(com.irPara).toHaveBeenCalledWith("criar");
  });

  it("post com fotos: leva as marcadas para a Agenda; fotos do produto: segue quando o produto está escolhido", async () => {
    mock.tabelas.cliente_imagens = [linhaDaFoto(F1), linhaDaFoto(F2)];
    const post = valorDaFoto({ objetivo: "post", selecionadas: [F1, F2] });
    const r = montar(h(GuiaDaLinha), post);
    await waitFor(() => expect(document.querySelector('[data-guia-da-linha="post"]')!.getAttribute("data-pronto")).toBe("sim"));
    expect(document.querySelector("[data-seguir-na-linha]")!.textContent).toContain("Montar o carrossel (2)");
    fireEvent.click(document.querySelector("[data-seguir-na-linha]") as HTMLElement);
    expect(post.prepararNaAgenda).toHaveBeenCalledWith([F1, F2]);
    r.unmount();

    mock.tabelas.foto_kits = [{ id: KIT, client_id: CLIENTE, tipo: "produto", nome: "Mouse", status: "confirmado", refs: [] }];
    const produto = valorDaFoto({ objetivo: "variacoes", kitId: KIT });
    montar(h(GuiaDaLinha), produto);
    await waitFor(() => expect(document.querySelector('[data-guia-da-linha="variacoes"]')!.getAttribute("data-pronto")).toBe("sim"));
    fireEvent.click(document.querySelector("[data-seguir-na-linha]") as HTMLElement);
    expect(produto.irPara).toHaveBeenCalledWith("ensaio");
  });
});

// ------------------------------------------------------------------ passo 4: Aprovar

const ENSAIO_BRUTO = {
  id: ENSAIO,
  client_id: CLIENTE,
  kit_id: KIT,
  receita_id: "catalogo-fiel",
  receita_versao: "1",
  finalidade: "catalogo",
  formatos: ["1:1"],
  status: "gerando",
  custo_usd: 0.1,
  tomadas: [
    { id: "t1", nome: "Três quartos", modo: "angulo", formato: "1:1", status: "gerada", versoes: [{ versao: 1, imagem_id: null, storage_path: `${CLIENTE}/foto/ensaios/v1.png`, custo_usd: 0.1 }] },
    { id: "t2", nome: "Principal", modo: "preservar", formato: "1:1", status: "pendente", versoes: [] },
  ],
};

describe("passo 4: Aprovar (conferir e aprovar num lugar só)", () => {
  it("mostra a fila dos lotes e a das outras geradas; a aprovada fica à vista com o selo", async () => {
    mock.tabelas.foto_ensaios = [ENSAIO_BRUTO];
    mock.tabelas.cliente_imagens = [
      linhaDaFoto(F1),
      linhaDaFoto(G1, { gerada: true, modo: "clone", derivada_de: F1 }),
      linhaDaFoto(G2, { gerada: true, modo: "angulo", derivada_de: F1, aprovada: true }),
    ];
    mock.invoke.mockImplementation(async (_n: string, o: any) => {
      if (o && o.body && o.body.acao === "acervo_decidir") {
        // O banco passa a ter a foto aprovada (a releitura depois do aprovar vê a mesma coisa).
        mock.tabelas.cliente_imagens = (mock.tabelas.cliente_imagens as any[]).map((f) => (f.id === G1 ? { ...f, aprovada: true } : f));
        return { data: { imagem: { ...linhaDaFoto(G1, { gerada: true, modo: "clone", derivada_de: F1 }), aprovada: true } }, error: null };
      }
      return { data: { ok: true }, error: null };
    });
    const foto = valorDaFoto({ ensaioId: ENSAIO });
    montar(h(EtapaAprovar), foto);
    const lote = await esperar("[data-aprovar-do-lote]");
    expect(lote.querySelectorAll("[data-pendente]")).toHaveLength(1);
    const acervo = await esperar("[data-aprovar-do-acervo]");
    // Só a gerada sem aprovação entra (a já aprovada e a original ficam de fora).
    expect(Array.from(acervo.querySelectorAll("[data-gerada-para-aprovar]")).map((e) => e.getAttribute("data-gerada-para-aprovar"))).toEqual([G1]);
    expect(document.querySelector("[data-resumo-da-aprovacao]")!.textContent).toContain("2 fotos esperam");
    // Comparar com as fontes abre a revisão lado a lado.
    fireEvent.click(screen.getByRole("button", { name: /Comparar com as fontes/ }));
    expect(foto.irPara).toHaveBeenCalledWith("revisar", { ensaio: ENSAIO });
    // Aprovar a gerada do acervo: continua na lista, agora aprovada.
    fireEvent.click(within(acervo).getByRole("button", { name: /Aprovar esta foto/ }));
    await waitFor(() => expect(within(acervo).getByText("Aprovada pela equipe")).toBeTruthy());
    expect(acervo.querySelector(`[data-gerada-para-aprovar="${G1}"]`)).toBeTruthy();
    // O passo seguinte: Usar as aprovadas.
    fireEvent.click(await screen.findByRole("button", { name: /Seguir: Usar/ }));
    expect(foto.irPara).toHaveBeenCalledWith("usar");
  });

  it("sem nada esperando: diz que está tudo decidido e oferece gerar mais ou usar", async () => {
    mock.tabelas.foto_ensaios = [];
    mock.tabelas.cliente_imagens = [linhaDaFoto(F1), linhaDaFoto(G2, { gerada: true, modo: "angulo", aprovada: true })];
    const foto = valorDaFoto();
    montar(h(EtapaAprovar), foto);
    expect(await screen.findByText("Tudo decidido por aqui")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Usar as aprovadas" }));
    expect(foto.irPara).toHaveBeenCalledWith("usar");
    fireEvent.click(screen.getByRole("button", { name: "Gerar mais fotos" }));
    expect(foto.irPara).toHaveBeenCalledWith("criar");
  });

  it("geradasParaAprovar: só geradas sem aprovação, mais as que a tela já mostrou; referência da internet nunca", () => {
    const fotos = [
      normalizarFoto(linhaDaFoto(F1))!,
      normalizarFoto(linhaDaFoto(G1, { gerada: true }))!,
      normalizarFoto(linhaDaFoto(G2, { gerada: true, aprovada: true }))!,
      normalizarFoto(linhaDaFoto("aaaaaaaa-0000-4000-8000-000000000031", { gerada: true, origem: "referencia_web", tags: ["referencia_web"] }))!,
    ];
    const ids = (v: string[]) => geradasParaAprovar(fotos, v).map((f) => f.id);
    expect(ids([])).toEqual(fotos.filter((f) => !f.referencia_web && f.gerada && !f.aprovada).map((f) => f.id));
    expect(ids([G2])).toContain(G2);
  });

  it("Usar (passo 5) não revisa mais: mostra quantas esperam e leva a Aprovar", async () => {
    mock.tabelas.foto_ensaios = [ENSAIO_BRUTO];
    mock.tabelas.cliente_imagens = [linhaDaFoto(F1), linhaDaFoto(G1, { gerada: true, modo: "clone" })];
    const foto = valorDaFoto({ ensaioId: ENSAIO });
    montar(h(EtapaUsar), foto);
    const linha = await esperar("[data-esperando-aprovacao]");
    expect(linha.getAttribute("data-esperando-aprovacao")).toBe("2");
    expect(document.querySelector("[data-pendente]")).toBeNull();
    fireEvent.click(within(linha).getByRole("button", { name: "Aprovar" }));
    expect(foto.irPara).toHaveBeenCalledWith("aprovar");
  });
});

// ------------------------------------------------------------------ código

describe("linha de produção: código", () => {
  const arquivos = [
    "src/components/mesa-foto/linhaDeProducao.ts",
    "src/components/mesa-foto/GuiaDaLinha.tsx",
    "src/components/mesa-foto/EtapaAprovar.tsx",
    "src/components/mesa-foto/EtapaCriar.tsx",
  ];
  it("sem travessão, sem regex que o Safari 11 não entende, fonte só na escala e sem gap em flex", () => {
    for (const a of arquivos) {
      const t = ler(a);
      expect(t, a).not.toMatch(/[—–]/);
      expect(t, a).not.toMatch(/\(\?<[=!a-zA-Z]/);
      expect(t, a).not.toMatch(/\\p\{/);
      expect(t, a).not.toMatch(/text-\[(?!11px|12px|13px|14px|15px|20px|24px)\d+(\.\d+)?px\]/);
      expect(t, a).not.toMatch(/\bflex\b[^"]*\bgap-/);
      expect(t, a).not.toMatch(/aspect-ratio|aspect-\[|\.at\(/);
    }
  });

  it("a página liga o passo 4 sob demanda e abre no passo 1", () => {
    const pagina = ler("src/pages/MesaFoto.tsx");
    expect(pagina).toContain('const EtapaAprovar = lazyComPreCarga("mesa-foto/aprovar", carregarAprovar);');
    expect(pagina).toContain('{etapa === "aprovar" && <EtapaAprovar />}');
    expect(pagina).toContain(': "criar";');
  });
});

// ------------------------------------------------------------------ rodada 2 (achados do revisor)

const W = "aaaaaaaa-0000-4000-8000-000000000041";
const fotoDaWeb = () => linhaDaFoto(W, { origem: "referencia_web", tags: ["referencia_web"] });

function Onde() {
  const l = useLocation();
  return h("output", { "data-testid": "onde" }, `${l.pathname}${l.search}`);
}

function abrirPagina(busca: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, { initialEntries: [`/mesa-foto?client=${CLIENTE}${busca}`] }, h(TooltipProvider, null, h(MesaFoto)), h(Onde))));
}

const onde = () => screen.getByTestId("onde").textContent || "";
const objetivoGuardado = () => lerEstadoDaTela<string | null>(`mesa-foto:objetivo:${CLIENTE}`, null);
const nav = () => screen.getByRole("navigation", { name: "Etapas da Mesa Foto" });

describe("rodada 2: regras do próximo passo", () => {
  it("no Estúdio e no Preparar, depois de gerar o próximo é Aprovar; sem pendente e com aprovada, Usar", () => {
    const base = { fotos: 3, kits: [], kitId: null, ensaio: null, selecionadas: 1, objetivo: "melhorar" as const };
    expect(proximoPasso({ ...base, etapa: "estudio", geradas: { pendentes: 2, aprovadas: 1 } })).toEqual({ etapa: "aprovar", rotulo: "Aprovar 2 fotos" });
    expect(proximoPasso({ ...base, objetivo: "fundo", etapa: "preparar", geradas: { pendentes: 0, aprovadas: 1 } })).toEqual({ etapa: "usar", rotulo: "Usar 1 aprovada" });
    // Nada gerado ainda: a própria ferramenta (o cabeçalho esconde, já está nela).
    expect(proximoPasso({ ...base, etapa: "estudio", geradas: { pendentes: 0, aprovadas: 0 } }).etapa).toBe("estudio");
    // Fora das ferramentas de uma foto, a regra antiga vale.
    expect(proximoPasso({ ...base, etapa: "acervo", geradas: { pendentes: 2, aprovadas: 0 } }).etapa).toBe("estudio");
  });

  it("marcadas que contam: só as que existem e não são referência da internet", () => {
    const fotos = [normalizarFoto(linhaDaFoto(F1))!, normalizarFoto(fotoDaWeb())!];
    expect(marcadasQueContam([W, "sumiu", F1], fotos)).toEqual([F1]);
    // Antes de o acervo carregar, vale a seleção como está.
    expect(marcadasQueContam([W, F1], null)).toEqual([W, F1]);
  });
});

describe("rodada 2: o Próximo do cabeçalho leva as fotos do post", { timeout: 60000 }, () => {
  it("BarraDoEnsaio: 'Próximo: Montar o post' chama prepararNaAgenda com as marcadas que contam", async () => {
    const foto = valorDaFoto({ objetivo: "post", etapa: "aprovar", selecionadas: [W, F1, F2], marcadas: [F1, F2], proximo: { etapa: "agenda", rotulo: "Montar o post" } });
    montar(h(BarraDoEnsaio), foto);
    fireEvent.click(await screen.findByRole("button", { name: /Próximo: Montar o post/ }));
    expect(foto.prepararNaAgenda).toHaveBeenCalledWith([F1, F2]);
    expect(foto.irPara).not.toHaveBeenCalled();
  });

  it("na página: com 'Post com fotos', o Próximo do Aprovar grava as marcadas para a Agenda e abre o post", async () => {
    mock.tabelas.cliente_imagens = [linhaDaFoto(F1), linhaDaFoto(F2), fotoDaWeb()];
    gravarEstadoDaTela(`mesa-foto:objetivo:${CLIENTE}`, "post");
    gravarEstadoDaTela(`mesa-foto:selecionadas:${CLIENTE}`, [W, F1, F2]);
    const gravar = vi.spyOn(Storage.prototype, "setItem");
    abrirPagina("&etapa=aprovar");
    // A troca de etapa espera a etapa preguiçosa (a Agenda) baixar: já baixa antes, como a pré-carga da página.
    await import("@/components/mesa-foto/EtapaAgenda");
    fireEvent.click(await screen.findByRole("button", { name: /Próximo: Montar o post/ }, { timeout: 8000 }));
    await waitFor(() => expect(onde()).toContain("etapa=agenda"), { timeout: 30000 });
    const doPost = gravar.mock.calls.filter((c) => c[0] === `mesa-foto:fotos-do-post:${CLIENTE}`);
    // A referência da internet marcada fica de fora; as duas fotos do cliente vão para o post.
    expect(doPost.length).toBeGreaterThan(0);
    expect(JSON.parse(String(doPost[0][1]))).toEqual([F1, F2]);
  });
});

describe("rodada 2: o objetivo só muda pela escolha da pessoa (ou chegando de fora)", { timeout: 60000 }, () => {
  it("'Fotos do produto' continua depois de um Post na Agenda feito no passo 5", async () => {
    mock.tabelas.cliente_imagens = [linhaDaFoto(F1), linhaDaFoto(G2, { gerada: true, modo: "angulo", derivada_de: F1, aprovada: true })];
    gravarEstadoDaTela(`mesa-foto:objetivo:${CLIENTE}`, "variacoes");
    abrirPagina("&etapa=usar");
    fireEvent.click(await screen.findByRole("button", { name: /Post na Agenda/ }, { timeout: 8000 }));
    await waitFor(() => expect(onde()).toContain("etapa=agenda"));
    await new Promise((ok) => setTimeout(ok, 50));
    expect(objetivoGuardado()).toBe("variacoes");
    // O passo 3 continua sendo gerar (não "pula" como no post) e as Fotos pedem o produto.
    expect(within(nav()).getByRole("button", { name: "3. Gerar" }).hasAttribute("data-pula")).toBe(false);
    fireEvent.click(within(nav()).getByRole("button", { name: "2. Fotos" }));
    await waitFor(() => expect(document.querySelector('[data-guia-da-linha="variacoes"]')).toBeTruthy(), { timeout: 8000 });
  });

  it("quem chega de fora numa ferramenta de gerar (link do diretor, outra mesa) passa a fazer aquilo", async () => {
    mock.tabelas.cliente_imagens = [linhaDaFoto(F1)];
    gravarEstadoDaTela(`mesa-foto:objetivo:${CLIENTE}`, "melhorar");
    abrirPagina("&etapa=campanha");
    await waitFor(() => expect(objetivoGuardado()).toBe("modelo"), { timeout: 8000 });
  });
});

describe("rodada 2: a aba 3 abre já na foto marcada que conta", { timeout: 60000 }, () => {
  it("'Melhorar uma foto' com uma referência da internet marcada antes: o Estúdio abre na foto do cliente", async () => {
    mock.tabelas.cliente_imagens = [linhaDaFoto(F1), linhaDaFoto(F2), fotoDaWeb()];
    gravarEstadoDaTela(`mesa-foto:objetivo:${CLIENTE}`, "melhorar");
    gravarEstadoDaTela(`mesa-foto:selecionadas:${CLIENTE}`, [W, F2]);
    abrirPagina("&etapa=criar");
    // O Próximo do cabeçalho já conta só a foto do cliente.
    await screen.findByRole("button", { name: /Próximo: Abrir no Estúdio/ }, { timeout: 8000 });
    fireEvent.click(within(nav()).getByRole("button", { name: "3. Gerar" }));
    await waitFor(() => expect(onde()).toContain("etapa=estudio"));
    expect(onde()).toContain(`imagem=${F2}`);
    expect(objetivoGuardado()).toBe("melhorar");
  });
});
