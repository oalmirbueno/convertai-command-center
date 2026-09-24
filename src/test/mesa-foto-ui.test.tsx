import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h, useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mesa Foto (docs/mesa-foto/CONTRATO.md): as telas das sete etapas contra o
 * contrato da função mesa-foto (que a frente A escreve em paralelo). A função,
 * o Storage e as tabelas são simulados; o teste confere a rota, as etapas, os
 * campos que cada ação manda, os normalizadores tolerantes e as regras de
 * compatibilidade e de texto.
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

const CLIENTE = "11111111-1111-1111-1111-111111111111";
vi.mock("@/hooks/useSupabaseData", () => ({
  useClients: () => ({
    data: [{ id: "11111111-1111-1111-1111-111111111111", company_name: "Loja Sintética" }],
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
import { ETAPAS_DA_MESA_FOTO, MesaFotoProvider, type MesaFotoValor } from "@/components/mesa-foto/Comuns";
import EtapaAcervo, { filtrarFotos } from "@/components/mesa-foto/EtapaAcervo";
import EtapaKits, { avisosDoKit } from "@/components/mesa-foto/EtapaKits";
import EtapaPreparar from "@/components/mesa-foto/EtapaPreparar";
import EtapaEnsaio from "@/components/mesa-foto/EtapaEnsaio";
import EtapaRevisar from "@/components/mesa-foto/EtapaRevisar";
import EtapaUsar, { enderecoParaUsar } from "@/components/mesa-foto/EtapaUsar";
import EtapaBiblioteca from "@/components/mesa-foto/EtapaBiblioteca";
import AgenteDiretor from "@/components/mesa-foto/AgenteDiretor";
import { enderecoDaMesa } from "@/components/mesa-foto/TrocaDeMesas";
import {
  aplicarSugestao,
  AZIMUTES,
  caminhoDoOriginal,
  classeDaFoto,
  contarDuplicadas,
  corpoDoKit,
  dataParaIso,
  descreverGuia,
  ELEVACOES,
  enviarFotos,
  ENQUADRAMENTOS,
  extensaoDoOriginal,
  faltaAutorizacao,
  FORMATOS,
  guiaParaEnviar,
  kitVazio,
  leiaMeDoZip,
  listaDeTextos,
  MAX_REFERENCIAS_NO_GUIA,
  nomeNoZip,
  normalizarEncontrada,
  normalizarEnsaio,
  normalizarFoto,
  normalizarItemDaBiblioteca,
  normalizarLeitura,
  normalizarPropostas,
  normalizarReceita,
  normalizarSugestoes,
  normalizarUrls,
  PAPEIS_DA_REF,
  RECEITAS_LOCAIS,
  receitaServeParaKit,
  refsParaSalvar,
  resumoDoEnsaio,
  sugestaoPedeEnsaio,
  TIPOS_DE_KIT,
  vencerGeracoes,
  VISTAS_DA_REF,
  type FotoDoAcervo,
} from "@/components/mesa-foto/fotoApi";
// O lado da função (TypeScript puro, sem Deno): a tela confere contra o que ela aceita.
import { type KitFoto, MAX_REFERENCIAS_DE_ESTILO, montarTomada } from "../../supabase/functions/mesa-foto/calculos";
import {
  AZIMUTES as AZIMUTES_DA_FUNCAO,
  cameraDoPreset,
  ELEVACOES as ELEVACOES_DA_FUNCAO,
  ENQUADRAMENTOS as ENQUADRAMENTOS_DA_FUNCAO,
  FORMATOS as FORMATOS_DA_FUNCAO,
  PAPEIS as PAPEIS_DA_FUNCAO,
  RECEITAS as RECEITAS_DA_FUNCAO,
  TIPOS_DE_KIT as TIPOS_DA_FUNCAO,
  VISTAS as VISTAS_DA_FUNCAO,
} from "../../supabase/functions/mesa-foto/receitas";

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");

const catalogo: ModeloIa[] = [
  {
    id: "openai:gpt-texto", provedor: "openai", modelo_api: "gpt-texto", tipo: "texto", rotulo: "Texto",
    preco_entrada_1m: 1, preco_saida_1m: 2, preco_cache_1m: null, preco_imagem: null,
    raciocinio: ["low", "medium"], padrao_para: ["estrategista", "diretor_arte", "leitura"], ativo: true,
  },
  {
    id: "openai:gpt-image-2", provedor: "openai", modelo_api: "gpt-image-2", tipo: "imagem", rotulo: "Imagem",
    preco_entrada_1m: null, preco_saida_1m: null, preco_cache_1m: null, preco_imagem: { baixa: 0.01, media: 0.04, alta: 0.17 },
    raciocinio: [], padrao_para: ["imagem"], ativo: true,
  },
];

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Loja Sintética",
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

function Onde() {
  const l = useLocation();
  return h("output", { "data-testid": "onde" }, `${l.pathname}${l.search}`);
}

function montar(filho: any, foto: Partial<MesaFotoValor> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(
      QueryClientProvider,
      { client: qc },
      h(
        MemoryRouter,
        { initialEntries: [`/mesa-foto?client=${CLIENTE}`] },
        h(
          TooltipProvider,
          null,
          h(MesaProvider, { valor: valorDaMesa(), children: h(MesaFotoProvider, { valor: valorDaFoto(foto), children: h("div", null, filho, h(Onde)) }) }),
        ),
      ),
    ),
  );
}

const chamadasDe = (acao: string) =>
  mock.invoke.mock.calls.filter((c: any[]) => c[0] === "mesa-foto" && c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);

const F1 = "aaaaaaaa-0000-4000-8000-000000000001";
const F2 = "aaaaaaaa-0000-4000-8000-000000000002";
const F3 = "aaaaaaaa-0000-4000-8000-000000000003";
const KIT = "bbbbbbbb-0000-4000-8000-000000000001";
const ENSAIO = "cccccccc-0000-4000-8000-000000000001";

const fotoBruta = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  client_id: CLIENTE,
  nome: `foto-${id.slice(-1)}.jpg`,
  storage_bucket: "mesa",
  storage_path: `${CLIENTE}/foto/originais/${id}.jpg`,
  origem: "mesa_foto",
  tags: [],
  ativa: true,
  criado_em: "2026-09-24T10:00:00Z",
  ...extra,
});

const FOTOS = [
  fotoBruta(F1, { nome: "mouse-frente.jpg", largura: 1200, altura: 900 }),
  fotoBruta(F2, { nome: "mouse-caixa.jpg" }),
  fotoBruta(F3, { nome: "mouse-tres-quartos.png", gerada: true, modo: "angulo", derivada_de: F1, aprovada: true, kit_id: KIT }),
];

const KIT_BRUTO = {
  id: KIT,
  client_id: CLIENTE,
  tipo: "produto",
  nome: "Mouse M720",
  variante: "grafite",
  atributos: { observado: ["2 botões laterais"], informado: [], inferido: [] },
  invariantes: ["logo no topo"],
  lacunas: ["vista inferior não documentada"],
  frente_imagem_id: F1,
  status: "ativo",
  atualizado_em: "2026-09-24T10:00:00Z",
};

const ENSAIO_BRUTO = {
  id: ENSAIO,
  client_id: CLIENTE,
  kit_id: KIT,
  receita_id: "catalogo-fiel",
  receita_versao: "proposta-1",
  finalidade: "catalogo",
  formatos: ["1:1"],
  status: "planejado",
  custo_usd: 0.02,
  tomadas: [
    { id: "t1", nome: "Principal limpa", modo: "preservar", formato: "1:1", status: "pendente", invariantes: ["logo"], versoes: [] },
    { id: "t2", nome: "Verso documentado", modo: "angulo", formato: "1:1", bloqueada: true, motivo_bloqueio: "O verso não foi fotografado.", versoes: [] },
    {
      id: "t3",
      nome: "Três quartos",
      modo: "angulo",
      formato: "4:5",
      camera: { azimute: 45, elevacao: 0, enquadramento: "medio" },
      versoes: [
        {
          versao: 1,
          imagem_id: null,
          storage_path: `${CLIENTE}/foto/ensaios/v1.png`,
          custo_usd: 0.17,
          conferencia: { pontos: [{ criterio: "Rótulo", ok: false, nota: "letra trocada" }, { criterio: "Proporção", ok: true }], alertas: ["Logo menor que no original"] },
        },
      ],
    },
  ],
};

let respostas: Record<string, any> = {};

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
  vi.clearAllMocks();
  mock.tabelas = { cliente_imagens: FOTOS, foto_kits: [KIT_BRUTO], foto_kit_refs: [{ kit_id: KIT, imagem_id: F1, papel: "identidade", vista: "frente", prioridade: 0 }, { kit_id: KIT, imagem_id: F2, papel: "embalagem", prioridade: 1 }], foto_ensaios: [ENSAIO_BRUTO] };
  respostas = {};
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    /* sem armazenamento */
  }
  mock.rpc.mockResolvedValue({ data: { saldo_usd: 12.5, total_usd: 3.2, por_modelo: [], por_tarefa: [] }, error: null });
  mock.upload.mockResolvedValue({ data: { path: "x" }, error: null });
  mock.invoke.mockImplementation(async (_nome: string, opcoes: any) => {
    const acao = opcoes && opcoes.body ? opcoes.body.acao : "";
    if (respostas[acao] !== undefined) return { data: typeof respostas[acao] === "function" ? respostas[acao](opcoes.body) : respostas[acao], error: null };
    return { data: { ok: true, custo_usd: 0.01 }, error: null };
  });
});

// ------------------------------------------------------------------ rota e casca

describe("rota, casca e troca entre mesas", () => {
  it("a rota /mesa-foto existe só para admin, gestor e design, dentro da casca, com o esqueleto da Mesa", () => {
    const app = ler("src/App.tsx");
    expect(app).toContain('const MesaFoto = lazy(() => import("@/pages/MesaFoto"));');
    const rota = app.split("\n").find((l) => l.indexOf('path="/mesa-foto"') >= 0) || "";
    expect(rota).toContain('["admin", "manager", "design"].includes(profile?.role || "")');
    expect(rota).toContain("<Suspense fallback={<EsqueletoDaMesa />}><MesaFoto /></Suspense>");
    expect(rota).toContain('<Navigate to="/dashboard" replace />');
    // Mesma rota-mãe da /mesa-ads (linhas vizinhas).
    expect(app.indexOf('path="/mesa-foto"')).toBeGreaterThan(app.indexOf('path="/mesa-ads"'));
    expect(ler("src/components/AppLayout.tsx")).toContain('location.pathname.indexOf("/mesa") === 0');
  });

  it("a Central ganha Mesa Foto ao lado de Mesa e Mesa Ads, e as duas mesas mostram a troca rápida", () => {
    const central = ler("src/pages/AdminExperience.tsx");
    expect(central).toContain("navigate(`/mesa-foto?client=${client.id}`)");
    expect(central.indexOf("Mesa Foto")).toBeGreaterThan(central.indexOf("navigate(`/mesa-ads?client=${client.id}`)"));
    expect(ler("src/pages/MesaAds.tsx")).toContain('<TrocaDeMesas atual="ads" clientId={clientId} />');
    expect(ler("src/pages/MesaDoCliente.tsx")).toContain('<TrocaDeMesas atual="mesa" clientId={clientId} />');
    expect(enderecoDaMesa("foto", CLIENTE)).toBe(`/mesa-foto?client=${CLIENTE}`);
    expect(enderecoDaMesa("ads", CLIENTE)).toBe(`/mesa-ads?client=${CLIENTE}`);
    const api = ler("src/lib/mesa/api.ts");
    expect(api).toContain('| "mesa-foto"');
    expect(api).toContain('"mesa-foto": "diretor de fotografia"');
  });

  it("a página mostra cliente, saldo, as sete etapas, a troca de mesas e a barra do kit e do ensaio", async () => {
    render(
      h(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        h(MemoryRouter, { initialEntries: [`/mesa-foto?client=${CLIENTE}&kit=${KIT}&ensaio=${ENSAIO}`] }, h(TooltipProvider, null, h(MesaFoto))),
      ),
    );
    expect(screen.getByRole("heading", { name: "Mesa Foto" }).className).toContain("sr-only");
    const nav = screen.getByRole("navigation", { name: "Etapas da Mesa Foto" });
    const botoes = within(nav).getAllByRole("button");
    expect(botoes.map((b) => b.textContent)).toEqual(["1Acervo", "2Kits", "3Preparar", "4Ensaio", "5Revisar", "6Usar", "7Biblioteca"]);
    expect(ETAPAS_DA_MESA_FOTO.map((e) => e.valor)).toEqual(["acervo", "kits", "preparar", "ensaio", "revisar", "usar", "biblioteca"]);
    // Celular: duas linhas, sem rolagem lateral.
    expect(nav.className).toContain("grid-cols-4");
    expect(nav.className).toContain("sm:grid-cols-7");
    expect(botoes[0].getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("combobox", { name: /Cliente: Loja Sintética/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Saldo e gasto do mês" })).toBeTruthy();
    const troca = screen.getByRole("navigation", { name: "Trocar de mesa" });
    expect(within(troca).getAllByRole("link").map((l) => l.textContent)).toEqual(["Mesa", "Mesa Ads"]);
    expect(within(troca).getByText("Mesa Foto").getAttribute("aria-current")).toBe("page");
    // Barra do kit e do ensaio.
    const barra = await screen.findByLabelText("Kit, ensaio e custo");
    await waitFor(() => expect(barra.textContent).toContain("Mouse M720"));
    await waitFor(() => expect(barra.textContent).toContain("Catálogo fiel"));
    expect(barra.textContent).toContain("0/3 aprovadas");
    // O diretor de fotografia fica à mão em qualquer etapa.
    expect(await screen.findByRole("button", { name: "Abrir o diretor de fotografia" })).toBeTruthy();
    fireEvent.click(botoes[6]);
    await waitFor(() => expect(within(nav).getAllByRole("button")[6].getAttribute("aria-current")).toBe("page"));
  });
});

// ------------------------------------------------------------------ acervo

describe("etapa 1, acervo", () => {
  it("lista as fotos com o selo de gerada, filtra por classe e mostra a linhagem", async () => {
    montar(h(EtapaAcervo));
    await screen.findByText("mouse-frente.jpg");
    expect(document.querySelectorAll('[data-selo="gerada"]').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("radio", { name: "Geradas" }));
    await waitFor(() => expect(screen.queryByText("mouse-frente.jpg")).toBeNull());
    expect(screen.getByText("mouse-tres-quartos.png")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Abrir mouse-tres-quartos.png" }));
    expect(await screen.findByText(/Imagem gerada por IA/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "mouse-frente.jpg" })).toBeTruthy(); // "Veio de"
  });

  it("soltar fotos sobe cada original em <client>/foto/originais/ e registra no acervo; formato errado não sobe", async () => {
    respostas.acervo_registrar = (corpo: any) => ({ imagens: corpo.caminhos.map((c: string, i: number) => ({ id: `novo-${i}`, storage_path: c, nome: corpo.nomes[i] })), duplicadas: [] });
    montar(h(EtapaAcervo));
    await screen.findByText("mouse-frente.jpg");
    const zona = document.querySelector("[data-zona-de-envio]") as HTMLElement;
    const jpg = new File(["a"], "novo.jpg", { type: "image/jpeg" });
    const gif = new File(["b"], "anim.gif", { type: "image/gif" });
    fireEvent.drop(zona, { dataTransfer: { files: [jpg, gif] } });
    await waitFor(() => expect(chamadasDe("acervo_registrar")).toHaveLength(1));
    expect(mock.upload).toHaveBeenCalledTimes(1);
    const caminho = mock.upload.mock.calls[0][0] as string;
    expect(caminho.indexOf(`${CLIENTE}/foto/originais/`)).toBe(0);
    expect(caminho.slice(-4)).toBe(".jpg");
    const corpo = chamadasDe("acervo_registrar")[0];
    expect(corpo.client_id).toBe(CLIENTE);
    expect(corpo.caminhos).toEqual([caminho]);
    expect(corpo.nomes).toEqual(["novo.jpg"]);
  });

  it("Ler foto mostra o custo antes, chama acervo_ler_foto e mostra a leitura", async () => {
    respostas.acervo_ler_foto = { descricao: "Mouse grafite sobre mesa", observado: ["2 botões"], texto_lido: "M720", qualidade: { nitidez: "boa", problemas: ["reflexo no topo"] }, custo_usd: 0.003 };
    montar(h(EtapaAcervo));
    fireEvent.click(await screen.findByRole("button", { name: "Abrir mouse-frente.jpg" }));
    const botao = await screen.findByRole("button", { name: /Ler foto/ });
    expect(botao.textContent).toContain("US$");
    fireEvent.click(botao);
    await waitFor(() => expect(chamadasDe("acervo_ler_foto")).toHaveLength(1));
    expect(chamadasDe("acervo_ler_foto")[0]).toEqual({ acao: "acervo_ler_foto", client_id: CLIENTE, imagem_id: F1 });
    expect(await screen.findByText("Mouse grafite sobre mesa")).toBeTruthy();
    expect(screen.getByText("reflexo no topo")).toBeTruthy();
  });

  it("filtrarFotos separa original, tratada, gerada, aprovada e kit", () => {
    const fotos = FOTOS.map((f) => normalizarFoto(f) as FotoDoAcervo);
    expect(filtrarFotos(fotos, "original", "todos", [], "").map((f) => f.id)).toEqual([F1, F2]);
    expect(filtrarFotos(fotos, "aprovada", "todos", [], "").map((f) => f.id)).toEqual([F3]);
    expect(filtrarFotos(fotos, "todas", "todos", [], "caixa").map((f) => f.id)).toEqual([F2]);
  });
});

// ------------------------------------------------------------------ kits

describe("etapa 2, kits", () => {
  it("sugere kit com as fotos marcadas, usa a proposta e salva com papéis, atributos e lacunas", async () => {
    respostas.kit_sugerir = {
      kits: [
        {
          nome: "Mouse sem fio",
          tipo: "produto",
          refs: [{ imagem_id: F1, papel: "identidade", vista: "frente" }, { imagem_id: F2, papel: "embalagem" }],
          atributos: { observado: ["2 botões laterais"], inferido: ["sensor óptico"] },
          invariantes: ["logo no topo"],
          lacunas: ["verso"],
          perguntas: ["Confirmar a cor"],
        },
      ],
      custo_usd: 0.01,
    };
    respostas.kit_salvar = (corpo: any) => ({ kit: { ...corpo.kit, id: "kit-novo" }, refs: corpo.refs });
    montar(h(EtapaKits), { selecionadas: [F1, F2] });
    fireEvent.click(await screen.findByRole("button", { name: /Sugerir com 2 fotos/ }));
    await waitFor(() => expect(chamadasDe("kit_sugerir")).toHaveLength(1));
    expect(chamadasDe("kit_sugerir")[0].imagem_ids).toEqual([F1, F2]);
    expect(await screen.findByText("Confirmar a cor")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Usar esta proposta" }));
    expect((screen.getByLabelText("Nome do kit") as HTMLInputElement).value).toBe("Mouse sem fio");
    fireEvent.change(screen.getByLabelText("Lacunas"), { target: { value: "verso\nvista inferior" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar kit" }));
    await waitFor(() => expect(chamadasDe("kit_salvar")).toHaveLength(1));
    const corpo = chamadasDe("kit_salvar")[0];
    expect(corpo.client_id).toBe(CLIENTE);
    expect(corpo.kit.nome).toBe("Mouse sem fio");
    expect(corpo.kit.atributos).toEqual({ observado: ["2 botões laterais"], informado: [], inferido: ["sensor óptico"] });
    expect(corpo.kit.invariantes).toEqual(["logo no topo"]);
    expect(corpo.kit.lacunas).toEqual(["verso", "vista inferior"]);
    expect(corpo.kit.id).toBeUndefined();
    expect(corpo.refs).toEqual([
      { imagem_id: F1, papel: "identidade", vista: "frente", prioridade: 0 },
      { imagem_id: F2, papel: "embalagem", vista: null, prioridade: 1 },
    ]);
  });

  it("kit de pessoa não salva sem autorização confirmada; embalagem sozinha avisa que o produto não foi documentado", async () => {
    montar(h(EtapaKits));
    fireEvent.click(await screen.findByRole("button", { name: /Novo kit/ }));
    fireEvent.change(screen.getByLabelText("Nome do kit"), { target: { value: "Dra. Ana" } });
    fireEvent.click(screen.getByRole("radio", { name: "Pessoa" }));
    expect((screen.getByRole("button", { name: "Criar kit" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/confirme a autorização do cliente/)).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Autorização confirmada" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Criar kit" }) as HTMLButtonElement).disabled).toBe(false));

    const soCaixa = { ...kitVazio(CLIENTE), refs: [{ imagem_id: F2, papel: "embalagem" as const, vista: "", prioridade: 0 }] };
    expect(avisosDoKit(soCaixa, []).join(" ")).toContain("Embalagem não é o produto");
    expect(faltaAutorizacao({ tipo: "pessoa", autorizacao: null })).toBe(true);
    expect(corpoDoKit({ ...kitVazio(CLIENTE, "produto"), nome: " X ", autorizacao: { confirmada: true, quem: "a", data: "", finalidade: "", observacao: "" } }).autorizacao).toBeNull();
  });
});

// ------------------------------------------------------------------ preparar

describe("etapa 3, preparar", () => {
  it("modos dizem o que muda e o que fica; preparar manda o modo, as áreas e o guia", async () => {
    respostas.preparar = { imagem: { id: "derivada-1", storage_path: `${CLIENTE}/foto/derivadas/d1.png`, nome: "mouse-frente-fundo-branco.png", derivada_de: F1 }, custo_usd: 0.17 };
    montar(h(EtapaPreparar), { imagemId: F1 });
    fireEvent.click(await screen.findByRole("radio", { name: /Fundo branco/ }));
    expect(screen.getByText(/O fundo vira branco de catálogo/)).toBeTruthy();
    expect(screen.getByText(/O assunto recortado, com os pixels originais/)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Escrever meu prompt/ }));
    fireEvent.change(screen.getByLabelText("Seu prompt"), { target: { value: "luz suave da esquerda" } });
    expect(document.querySelector("[data-o-que-sera-usado]")!.textContent).toContain("Seu prompt: luz suave da esquerda");
    const botao = screen.getByRole("button", { name: /Preparar: fundo branco/ });
    expect(botao.textContent).toContain("US$");
    fireEvent.click(botao);
    await waitFor(() => expect(chamadasDe("preparar")).toHaveLength(1));
    const corpo = chamadasDe("preparar")[0];
    expect(corpo).toEqual({ acao: "preparar", client_id: CLIENTE, imagem_id: F1, modo: "fundo_branco", guia: { modo: "livre", texto: "luz suave da esquerda" } });
    expect(corpo.areas_protegidas).toBeUndefined();
  });

  it("marcar áreas protegidas desenha na foto sem escurecer e manda as frações", async () => {
    montar(h(EtapaPreparar), { imagemId: F1 });
    fireEvent.click(await screen.findByRole("button", { name: /Marcar áreas protegidas/ }));
    const mesa = screen.getByRole("application", { name: /Arraste para marcar/ });
    mesa.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    // jsdom sem PointerEvent: usa mouse.
    fireEvent.mouseDown(mesa, { clientX: 20, clientY: 10, button: 0 });
    fireEvent.mouseMove(mesa, { clientX: 120, clientY: 60 });
    fireEvent.mouseUp(mesa);
    await waitFor(() => expect(document.querySelectorAll("[data-area-protegida]").length).toBe(1));
    const area = document.querySelector("[data-area-protegida]") as HTMLElement;
    expect(area.className).not.toContain("bg-black");
    fireEvent.click(screen.getByRole("button", { name: /Preparar: preservar e limpar/ }));
    await waitFor(() => expect(chamadasDe("preparar")).toHaveLength(1));
    expect(chamadasDe("preparar")[0].areas_protegidas).toEqual([{ x0: 0.1, y0: 0.1, x1: 0.6, y1: 0.6 }]);
  });

  it("a derivada aparece com Aprovar esta foto (acervo_decidir); aprovada, pode tirar a aprovação", async () => {
    const D = "aaaaaaaa-0000-4000-8000-0000000000d1";
    // A derivada mais nova vem primeiro (o acervo é lido do mais novo para o mais antigo).
    mock.tabelas.cliente_imagens = [fotoBruta(D, { nome: "mouse-frente (fundo branco)", derivada_de: F1, gerada: true, modo: "preservar", storage_path: `${CLIENTE}/foto/derivadas/d1.png` })].concat(FOTOS);
    respostas.acervo_decidir = (corpo: any) => {
      // O banco muda junto (a releitura do acervo vê a mesma decisão).
      mock.tabelas.cliente_imagens = (mock.tabelas.cliente_imagens as any[]).map((f) => (f.id === D ? { ...f, aprovada: corpo.decisao === "aprovar" } : f));
      return { imagem: (mock.tabelas.cliente_imagens as any[]).find((f) => f.id === D), custo_usd: 0 };
    };
    montar(h(EtapaPreparar), { imagemId: F1 });
    fireEvent.click(await screen.findByRole("button", { name: /Aprovar esta foto/ }));
    await waitFor(() => expect(chamadasDe("acervo_decidir")).toHaveLength(1));
    expect(chamadasDe("acervo_decidir")[0]).toEqual({ acao: "acervo_decidir", client_id: CLIENTE, imagem_id: D, decisao: "aprovar" });
    expect(await screen.findByText(/Aprovada pela equipe/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tirar aprovação" }));
    await waitFor(() => expect(chamadasDe("acervo_decidir")).toHaveLength(2));
    expect(chamadasDe("acervo_decidir")[1].decisao).toBe("rejeitar");
  });
});

// ------------------------------------------------------------------ ensaio

describe("etapa 4, ensaio", () => {
  it("planejar manda kit, receita, finalidade, formatos e tomadas escolhidas", async () => {
    respostas.receitas = { receitas: RECEITAS_LOCAIS };
    respostas.ensaio_planejar = { ensaio: { ...ENSAIO_BRUTO, id: "novo-ensaio" }, estimativa_usd: 1.2, custo_usd: 0.04 };
    mock.tabelas.foto_ensaios = [];
    const escolherEnsaio = vi.fn();
    montar(h(EtapaEnsaio), { kitId: KIT, escolherEnsaio });
    await screen.findByText("vista inferior não documentada");
    fireEvent.click(screen.getByRole("radio", { name: /Catálogo fiel/ }));
    fireEvent.click(screen.getByRole("button", { name: "Escala com medida confirmada" }));
    const planejar = screen.getByRole("button", { name: /Planejar 7 tomadas/ });
    fireEvent.click(planejar);
    await waitFor(() => expect(chamadasDe("ensaio_planejar")).toHaveLength(1));
    const corpo = chamadasDe("ensaio_planejar")[0];
    expect(corpo.client_id).toBe(CLIENTE);
    expect(corpo.kit_id).toBe(KIT);
    expect(corpo.receita_id).toBe("catalogo-fiel");
    expect(corpo.finalidade).toBe("catalogo");
    expect(corpo.formatos).toEqual(["1:1", "4:5"]);
    // Ids das tomadas da receita (a função recusa o que não for id: tomada_desconhecida).
    expect(corpo.tomadas_pedidas).toEqual(["principal", "frente", "tres-quartos", "lateral", "verso", "detalhe", "com-embalagem"]);
    await waitFor(() => expect(escolherEnsaio).toHaveBeenCalledWith("novo-ensaio"));
  });

  it("receita que não serve para o tipo do kit não planeja (a função recusaria com receita_incompativel)", async () => {
    respostas.receitas = { receitas: RECEITAS_LOCAIS };
    mock.tabelas.foto_ensaios = [];
    montar(h(EtapaEnsaio), { kitId: KIT });
    await screen.findByText("vista inferior não documentada");
    fireEvent.click(screen.getByRole("radio", { name: /Retrato profissional/ }));
    expect(screen.getByText(/não serve para kit de produto/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Planejar 6 tomadas/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("tomada bloqueada pode ser conferida de novo com tomada_editar (sem IA), depois de completar o kit", async () => {
    respostas.tomada_editar = (corpo: any) => ({
      ensaio: { ...ENSAIO_BRUTO, tomadas: ENSAIO_BRUTO.tomadas.map((t: any) => (t.id === corpo.tomada_id ? { ...t, bloqueada: false, status: "pendente", motivo_bloqueio: null } : t)) },
      tomada: { id: corpo.tomada_id, nome: "Verso documentado", status: "pendente" },
      custo_usd: 0,
    });
    montar(h(EtapaEnsaio), { kitId: KIT, ensaioId: ENSAIO });
    const bloqueada = (await screen.findByText("Verso documentado")).closest("[data-tomada]") as HTMLElement;
    fireEvent.click(within(bloqueada).getByRole("button", { name: /conferir de novo/ }));
    await waitFor(() => expect(chamadasDe("tomada_editar")).toHaveLength(1));
    expect(chamadasDe("tomada_editar")[0]).toEqual({ acao: "tomada_editar", ensaio_id: ENSAIO, tomada_id: "t2", campos: { nome: "Verso documentado" } });
    await waitFor(() => expect(within(screen.getByText("Verso documentado").closest("[data-tomada]") as HTMLElement).getByRole("button", { name: /^Gerar/ })).toBeTruthy());
    expect(chamadasDe("tomada_gerar")).toHaveLength(0);
  });

  it("tomada gravada em gerando trava o botão; presa há mais de 6 minutos vira falhou e pode gerar de novo", async () => {
    const antigo = new Date(Date.now() - 10 * 60_000).toISOString();
    mock.tabelas.foto_ensaios = [
      {
        ...ENSAIO_BRUTO,
        atualizado_em: new Date().toISOString(),
        tomadas: [
          { id: "g1", nome: "Gerando agora", status: "gerando", versoes: [] },
          { id: "g2", nome: "Presa antiga", status: "gerando", gerando_desde: antigo, versoes: [] },
          { id: "g3", nome: "Falhou antes", status: "falhou", ultimo_erro: "O gerador recusou o tamanho.", versoes: [] },
        ],
      },
    ];
    montar(h(EtapaEnsaio), { kitId: KIT, ensaioId: ENSAIO });
    const agora = (await screen.findByText("Gerando agora")).closest("[data-tomada]") as HTMLElement;
    expect((within(agora).getByRole("button", { name: /^Gerar/ }) as HTMLButtonElement).disabled).toBe(true);
    const presa = screen.getByText("Presa antiga").closest("[data-tomada]") as HTMLElement;
    expect(within(presa).getByText(/passou de 6 minutos/)).toBeTruthy();
    expect((within(presa).getByRole("button", { name: /^Gerar/ }) as HTMLButtonElement).disabled).toBe(false);
    const falhou = screen.getByText("Falhou antes").closest("[data-tomada]") as HTMLElement;
    expect(within(falhou).getByText(/O gerador recusou o tamanho/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Gerar 2 tomadas, uma por vez/ })).toBeTruthy();
  });

  it("tomada bloqueada mostra o motivo e não gera; gerar manda a câmera dos botões e o guia, uma tomada por vez", async () => {
    respostas.tomada_gerar = (corpo: any) => ({
      ensaio: { ...ENSAIO_BRUTO, tomadas: ENSAIO_BRUTO.tomadas.map((t: any) => (t.id === corpo.tomada_id ? { ...t, versoes: [{ versao: 1, storage_path: "x.png", custo_usd: 0.17 }] } : t)) },
      versao: { versao: 1, storage_path: "x.png" },
      custo_usd: 0.17,
    });
    montar(h(EtapaEnsaio), { kitId: KIT, ensaioId: ENSAIO });
    const bloqueada = (await screen.findByText("Verso documentado")).closest("[data-tomada]") as HTMLElement;
    expect(within(bloqueada).getByText(/O verso não foi fotografado/)).toBeTruthy();
    expect(within(bloqueada).queryByRole("button", { name: /Gerar/ })).toBeNull();

    const t1 = screen.getByText("Principal limpa").closest("[data-tomada]") as HTMLElement;
    fireEvent.click(within(t1).getByRole("button", { name: "Mudar a câmera" }));
    fireEvent.click(within(t1).getByRole("radio", { name: "Três quartos direito" }));
    fireEvent.click(within(t1).getByRole("radio", { name: "Detalhe" }));
    expect(within(t1).getByText(/Novo ângulo: partes que não aparecem/)).toBeTruthy();
    fireEvent.click(within(t1).getByRole("button", { name: /^Gerar/ }));
    await waitFor(() => expect(chamadasDe("tomada_gerar")).toHaveLength(1));
    const corpo = chamadasDe("tomada_gerar")[0];
    expect(corpo.ensaio_id).toBe(ENSAIO);
    expect(corpo.tomada_id).toBe("t1");
    expect(corpo.camera).toEqual({ azimute: 45, elevacao: 0, enquadramento: "detalhe" });
    expect(corpo.guia).toEqual({ modo: "nenhum" });
    expect(corpo.qualidade).toBe("alta");
    expect(corpo.modelo_imagem_id).toBe("openai:gpt-image-2");
  });
});

// ------------------------------------------------------------------ revisar

describe("etapa 5, revisar", () => {
  it("versões com as fontes do kit, conferência como aviso, aprovar e rejeitar com motivo", async () => {
    respostas.versao_decidir = { ensaio: ENSAIO_BRUTO };
    montar(h(EtapaRevisar), { ensaioId: ENSAIO });
    expect(await screen.findByText("Conferência (aviso, a decisão é sua)")).toBeTruthy();
    expect(screen.getByText("Logo menor que no original")).toBeTruthy();
    expect(screen.getByText("Fontes do kit")).toBeTruthy();
    expect(document.querySelectorAll('[data-selo="gerada"]').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Rejeitar" }));
    const confirmar = screen.getByRole("button", { name: "Rejeitar com motivo" });
    expect((confirmar as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Rosto mudou" }));
    fireEvent.click(confirmar);
    await waitFor(() => expect(chamadasDe("versao_decidir")).toHaveLength(1));
    expect(chamadasDe("versao_decidir")[0]).toEqual({ acao: "versao_decidir", ensaio_id: ENSAIO, tomada_id: "t3", versao: 1, decisao: "rejeitar", motivo: "Rosto mudou" });
    fireEvent.click(screen.getByRole("button", { name: /Aprovar/ }));
    await waitFor(() => expect(chamadasDe("versao_decidir")).toHaveLength(2));
    expect(chamadasDe("versao_decidir")[1].decisao).toBe("aprovar");
    // Sem laço automático: nenhuma geração nem conferência disparou sozinha.
    expect(chamadasDe("tomada_gerar")).toHaveLength(0);
    expect(chamadasDe("versao_conferir")).toHaveLength(0);
  });

  it("versão como a função grava: conferência pendente mostra Conferir; ok nulo não é falha; aprovada false é rejeitada", async () => {
    respostas.versao_conferir = {
      ensaio_id: ENSAIO,
      tomada_id: "t3",
      versao: 1,
      conferencia: { pontos: [{ criterio: "mesmo texto do rótulo", ok: true, nota: "igual" }, { criterio: "verso", ok: null, nota: "não avaliado" }], alertas: [], resumo: "Fiel às fontes.", jev: { divergencia_critica: 0.1, aviso: false } },
      custo_usd: 0.01,
    };
    mock.tabelas.foto_ensaios = [
      {
        ...ENSAIO_BRUTO,
        tomadas: [
          {
            id: "t3",
            nome: "Três quartos",
            modo: "angulo",
            formato: "4:5",
            status: "rejeitada",
            versoes: [
              { versao: 1, storage_path: `${CLIENTE}/foto/ensaios/v1.png`, custo_usd: 0.17, conferencia: { pendente: true }, aprovada: null, decisao: null, motivo_rejeicao: null },
              { versao: 2, storage_path: `${CLIENTE}/foto/ensaios/v2.png`, custo_usd: 0.17, conferencia: { pendente: true }, aprovada: false, decisao: "rejeitada", motivo_rejeicao: null },
            ],
          },
        ],
      },
    ];
    montar(h(EtapaRevisar), { ensaioId: ENSAIO });
    const v1 = (await screen.findAllByText("v1"))[0].closest("[data-versao]") as HTMLElement;
    expect(within(v1).queryByText("Conferência (aviso, a decisão é sua)")).toBeNull();
    const v2 = screen.getByText("v2").closest("[data-versao]") as HTMLElement;
    expect(within(v2).getByText("rejeitada")).toBeTruthy();
    fireEvent.click(within(v1).getByRole("button", { name: /Conferir/ }));
    await waitFor(() => expect(chamadasDe("versao_conferir")).toHaveLength(1));
    expect(chamadasDe("versao_conferir")[0]).toEqual({ acao: "versao_conferir", ensaio_id: ENSAIO, tomada_id: "t3", versao: 1 });
    expect(await within(v1).findByText("Fiel às fontes.")).toBeTruthy();
    const caixa = within(v1).getByText("Conferência (aviso, a decisão é sua)").closest("[data-conferencia]") as HTMLElement;
    expect(caixa.className).toContain("bg-success/10");
    expect(within(caixa).getByLabelText("não avaliado")).toBeTruthy();
  });
});

// ------------------------------------------------------------------ usar

describe("etapa 6, usar", () => {
  it("mostra as aprovadas marcadas como geradas e leva para o Estúdio da Mesa com as fotos", async () => {
    montar(h(EtapaUsar));
    expect(await screen.findByText("mouse-tres-quartos.png")).toBeTruthy();
    expect(screen.queryByText("mouse-frente.jpg")).toBeNull();
    expect(screen.getByRole("button", { name: /Baixar em ZIP/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Enviar para Arquivos/ }));
    await waitFor(() => expect(chamadasDe("enviar")).toHaveLength(1));
    expect(chamadasDe("enviar")[0]).toEqual({ acao: "enviar", client_id: CLIENTE, imagem_ids: [F3], destino: "arquivos" });
    fireEvent.click(screen.getByRole("button", { name: /Usar na Mesa$/ }));
    await waitFor(() => expect(screen.getByTestId("onde").textContent).toBe(`/mesa?client=${CLIENTE}&aba=estudio&fotos=${F3}`));
    expect(enderecoParaUsar("ads", CLIENTE, [F1, F3])).toBe(`/mesa-ads?client=${CLIENTE}&etapa=estudio&fotos=${F1},${F3}`);
    expect(JSON.parse(window.sessionStorage.getItem(`mesa-foto:para-usar:${CLIENTE}`) || "{}").ids).toEqual([F3]);
  });
});

// ------------------------------------------------------------------ biblioteca

describe("biblioteca de prompts e referências", () => {
  it("prompt com quando usar, evitar e Copiar; referência com licença e autor; busca pública e importar", async () => {
    mock.tabelas.foto_biblioteca = [
      { id: "p1", client_id: null, tipo: "prompt", categoria: "luz", titulo: "Luz de janela", prompt_pt: "luz natural lateral suave", prompt_en: "soft side window light", uso: "Produto de mesa", negativo: "sombra dura", fonte_nome: "Repo", licenca: "MIT", autor: "Equipe" },
      { id: "r1", client_id: CLIENTE, tipo: "referencia", categoria: "cenario", titulo: "Bancada clara", imagem_url: "https://img.test/r1.jpg", licenca: "CC BY 4.0", autor: "Maria" },
    ];
    const escrever = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: escrever }, configurable: true });
    respostas.referencias_buscar = {
      resultados: [{ id: "ov1", titulo: "Mesa de madeira", imagem_url: "https://img.test/cheia.jpg", miniatura_url: "https://img.test/mini.jpg", fonte_url: "https://openverse.org/x", licenca: "pdm", licenca_rotulo: "Domínio público", autor: "Fulano", autor_url: "https://autor.test" }],
    };
    respostas.referencia_importar = { item: { id: "r2", tipo: "referencia", titulo: "Mesa de madeira" } };
    montar(h(EtapaBiblioteca));
    expect(await screen.findByText("Luz de janela")).toBeTruthy();
    expect(screen.getByText("Produto de mesa")).toBeTruthy();
    expect(screen.getByText("sombra dura")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copiar" }));
    await waitFor(() => expect(escrever).toHaveBeenCalledWith("luz natural lateral suave"));
    fireEvent.click(screen.getByRole("button", { name: "Copiar em inglês" }));
    await waitFor(() => expect(escrever).toHaveBeenCalledWith("soft side window light"));
    expect(screen.getByText("CC BY 4.0")).toBeTruthy();
    expect(screen.getByText(/Maria/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("O que buscar"), { target: { value: "wood table" } });
    fireEvent.click(screen.getByRole("button", { name: /Buscar referências/ }));
    await waitFor(() => expect(chamadasDe("referencias_buscar")).toEqual([{ acao: "referencias_buscar", q: "wood table" }]));
    expect(await screen.findByText("Domínio público")).toBeTruthy();
    const mini = screen.getByRole("img", { name: "Mesa de madeira" }) as HTMLImageElement;
    expect(mini.src).toBe("https://img.test/mini.jpg");
    fireEvent.click(screen.getByRole("button", { name: /Importar/ }));
    await waitFor(() => expect(chamadasDe("referencia_importar")).toHaveLength(1));
    const corpo = chamadasDe("referencia_importar")[0];
    expect(corpo.client_id).toBe(CLIENTE);
    expect(corpo.referencia.licenca).toBe("pdm");
    expect(corpo.referencia.licenca_rotulo).toBe("Domínio público");
    expect(corpo.referencia.autor).toBe("Fulano");
  });
});

// ------------------------------------------------------------------ agente

function AgenteAberto() {
  const [aberto, setAberto] = useState(false);
  return h(AgenteDiretor, { aberto, onAberto: setAberto });
}

describe("diretor de fotografia", () => {
  it("botão flutuante abre o pop-up; a mensagem vai com o kit e o ensaio; sugestão só muda com Aplicar", async () => {
    respostas.agente_conversar = { resposta: "Faça a principal com luz lateral.", sugestoes: [{ id: "s1", titulo: "Trocar a luz da principal", descricao: "Luz lateral suave" }], conversa_id: "conv-1", custo_usd: 0.02 };
    respostas.agente_aplicar = { ensaio: ENSAIO_BRUTO };
    montar(h(AgenteAberto), { kitId: KIT, ensaioId: ENSAIO, selecionadas: [F1] });
    fireEvent.click(screen.getByRole("button", { name: "Abrir o diretor de fotografia" }));
    const campo = await screen.findByLabelText("Mensagem ao diretor");
    fireEvent.change(campo, { target: { value: "Que luz usar?" } });
    fireEvent.click(screen.getByRole("button", { name: "Mandar" }));
    await waitFor(() => expect(chamadasDe("agente_conversar")).toHaveLength(1));
    expect(chamadasDe("agente_conversar")[0]).toEqual({ acao: "agente_conversar", client_id: CLIENTE, mensagem: "Que luz usar?", kit_id: KIT, ensaio_id: ENSAIO, anexos: [{ imagem_id: F1 }] });
    expect(await screen.findByText("Faça a principal com luz lateral.")).toBeTruthy();
    expect(chamadasDe("agente_aplicar")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    await waitFor(() => expect(chamadasDe("agente_aplicar")).toHaveLength(1));
    expect(chamadasDe("agente_aplicar")[0].ensaio_id).toBe(ENSAIO);
    expect(chamadasDe("agente_aplicar")[0].sugestao.titulo).toBe("Trocar a luz da principal");
    // Segunda mensagem segue a mesma conversa.
    fireEvent.change(screen.getByLabelText("Mensagem ao diretor"), { target: { value: "E o fundo?" } });
    fireEvent.click(screen.getByRole("button", { name: "Mandar" }));
    await waitFor(() => expect(chamadasDe("agente_conversar")).toHaveLength(2));
    expect(chamadasDe("agente_conversar")[1].conversa_id).toBe("conv-1");
  });
});

// ------------------------------------------------------------------ normalizadores

describe("normalizadores tolerantes a campo faltando", () => {
  it("foto, ensaio, tomada e versão sem os campos novos não quebram", () => {
    const f = normalizarFoto({ id: "x", storage_path: "c/a.jpg" })!;
    expect(f.nome).toBe("a.jpg");
    expect(f.gerada).toBe(false);
    expect(f.tags).toEqual([]);
    expect(classeDaFoto(f)).toBe("original");
    expect(classeDaFoto({ gerada: false, derivada_de: "y", modo: null })).toBe("derivada");
    expect(classeDaFoto({ gerada: false, derivada_de: null, modo: "angulo" })).toBe("gerada");
    expect(normalizarFoto(null)).toBeNull();

    const e = normalizarEnsaio({ id: "e", tomadas: [{ nome: "A" }, { id: "b", status: "bloqueada" }, { id: "c", versoes: [{ decisao: "aprovar" }] }, null] })!;
    expect(e.tomadas.map((t) => t.status)).toEqual(["pendente", "bloqueada", "aprovada"]);
    expect(e.tomadas[0].id).toBe("tomada-1");
    expect(e.tomadas[2].versoes[0].versao).toBe(1);
    expect(e.formatos).toEqual([]);
    expect(resumoDoEnsaio(e)).toMatchObject({ total: 3, aprovadas: 1, bloqueadas: 1 });
    expect(normalizarEnsaio({})).toBeNull();
    const r = normalizarEnsaio({ id: "e", tomadas: [{ id: "t", versoes: [{ versao: 2, motivo_rejeicao: "texto" }] }] })!;
    expect(r.tomadas[0].versoes[0].rejeitada).toBe(true);
  });

  it("propostas, leitura, urls, duplicadas, receitas e biblioteca em qualquer forma", () => {
    expect(normalizarPropostas({ kit: { nome: "K", tipo: "inventado" } })[0].tipo).toBe("produto");
    expect(normalizarPropostas({ sugestoes: [{ nome: "A" }, { nome: "B" }] })).toHaveLength(2);
    expect(normalizarPropostas(null)).toEqual([]);
    expect(normalizarLeitura({ leitura: { descricao: "d" } }).descricao).toBe("d");
    expect(normalizarLeitura(undefined).observado).toEqual([]);
    expect(normalizarUrls({ arquivos: [{ imagem_id: "a", url: "u1" }] })).toEqual({ a: "u1" });
    expect(normalizarUrls({ urls: { b: "u2" } })).toEqual({ b: "u2" });
    expect(normalizarUrls({ urls: [{ id: "c", signed_url: "u3" }] })).toEqual({ c: "u3" });
    expect(contarDuplicadas([1, 2])).toBe(2);
    expect(contarDuplicadas("3")).toBe(3);
    expect(contarDuplicadas(undefined)).toBe(0);
    expect(normalizarReceita({ id: "alimentos" })!.nome).toBe("Alimentos e pratos");
    expect(RECEITAS_LOCAIS).toHaveLength(8);
    // Mesma regra da função (tipos_de_kit da receita): alimentos não serve bebida; bebidas e catálogo fiel servem.
    expect(receitaServeParaKit(RECEITAS_LOCAIS[3], "bebida")).toBe(false);
    expect(receitaServeParaKit(RECEITAS_LOCAIS[4], "bebida")).toBe(true);
    expect(receitaServeParaKit(RECEITAS_LOCAIS[0], "bebida")).toBe(true);
    expect(receitaServeParaKit(RECEITAS_LOCAIS[1], "cosmetico")).toBe(false);
    expect(receitaServeParaKit(RECEITAS_LOCAIS[5], "produto")).toBe(false);
    const daFuncao = normalizarReceita({ id: "tecnologia", tipos_de_kit: ["tecnologia", "produto"], tomadas: [{ id: "principal", nome: "Principal em três quartos", camera: {} }, { id: "portas", nome: "Portas documentadas" }] })!;
    expect(daFuncao.tomadas).toEqual([{ id: "principal", nome: "Principal em três quartos" }, { id: "portas", nome: "Portas documentadas" }]);
    expect(daFuncao.tipos_de_kit).toEqual(["tecnologia", "produto"]);
    // Nome solto de receita conhecida ganha o id da receita.
    expect(normalizarReceita({ id: "alimentos", tomadas: ["Vista a 45 graus"] })!.tomadas).toEqual([{ id: "45-graus", nome: "Vista a 45 graus" }]);
    expect(listaDeTextos("a\n\n b \na")).toEqual(["a", "b"]);
    expect(normalizarItemDaBiblioteca({ id: "i" })!.tipo).toBe("prompt");
    const achada = normalizarEncontrada({ url: "https://x/y.jpg", licenca: "by", licenca_rotulo: "CC BY 4.0" }, 0)!;
    expect(achada.licenca).toBe("CC BY 4.0");
    expect(achada.licenca_codigo).toBe("by");
    expect(achada.miniatura_url).toBe("https://x/y.jpg");
    expect(normalizarEncontrada({ imagem_url: "u", licenca: "cc0" }, 1)!.licenca).toBe("cc0");
  });

  it("guia: só os campos do modo; incompleto vira sem guia; o que será usado fica escrito", () => {
    expect(guiaParaEnviar({ modo: "biblioteca" })).toEqual({ modo: "nenhum" });
    expect(guiaParaEnviar({ modo: "biblioteca", prompt_id: "p", texto: "x" })).toEqual({ modo: "biblioteca", prompt_id: "p" });
    // A função usa no máximo 2 referências de estilo (MAX_REFERENCIAS_DE_ESTILO).
    expect(guiaParaEnviar({ modo: "referencia", referencia_ids: ["a", "b", "c", "d"] })).toEqual({ modo: "referencia", referencia_ids: ["a", "b"] });
    expect((guiaParaEnviar({ modo: "livre", texto: "x".repeat(3000) }).texto || "").length).toBe(1500);
    expect(guiaParaEnviar({ modo: "livre", texto: "  " })).toEqual({ modo: "nenhum" });
    expect(guiaParaEnviar(null)).toEqual({ modo: "nenhum" });
    expect(descreverGuia({ modo: "nenhum" }, [])).toContain("Sem guia");
  });

  it("upload, ZIP e refs: caminho do original, extensão pelo tipo, gerada marcada no nome e no LEIA-ME", () => {
    expect(caminhoDoOriginal(CLIENTE, "id", "jpg")).toBe(`${CLIENTE}/foto/originais/id.jpg`);
    expect(extensaoDoOriginal({ type: "image/png" })).toBe("png");
    expect(extensaoDoOriginal({ name: "a.JPEG" })).toBe("jpg");
    expect(extensaoDoOriginal({ type: "image/gif", name: "a.gif" })).toBeNull();
    const fotos = FOTOS.map((f) => normalizarFoto(f) as FotoDoAcervo);
    const usados: string[] = [];
    const nomes = fotos.map((f) => nomeNoZip(f, usados));
    expect(nomes).toEqual(["mouse-frente.jpg", "mouse-caixa.jpg", "mouse-tres-quartos_gerada.jpg"]);
    expect(nomeNoZip(fotos[0], usados)).toBe("mouse-frente-2.jpg");
    const leia = leiaMeDoZip(fotos, nomes, "Loja");
    expect(leia).toContain("mouse-tres-quartos_gerada.jpg: GERADA, aprovada");
    expect(refsParaSalvar([{ imagem_id: "a", papel: "detalhe", vista: " ", prioridade: 9 }])).toEqual([{ imagem_id: "a", papel: "detalhe", vista: null, prioridade: 0 }]);
  });
});

// ------------------------------------------------------------------ contrato com a função

describe("tela e função falam a mesma língua (supabase/functions/mesa-foto)", () => {
  it("formatos, vistas, papéis, tipos, grade de câmera e limite do guia são os da função", () => {
    expect(FORMATOS.map((f) => f.valor).sort()).toEqual(FORMATOS_DA_FUNCAO.slice().sort());
    expect(VISTAS_DA_REF.map((v) => v.valor).sort()).toEqual(Object.keys(VISTAS_DA_FUNCAO).sort());
    expect(PAPEIS_DA_REF.map((p) => p.valor)).toEqual(PAPEIS_DA_FUNCAO);
    expect(TIPOS_DE_KIT.map((t) => t.valor)).toEqual(TIPOS_DA_FUNCAO);
    expect(AZIMUTES.map((a) => a.graus)).toEqual(AZIMUTES_DA_FUNCAO.map((a) => a.graus));
    expect(ELEVACOES.map((e) => e.graus)).toEqual(ELEVACOES_DA_FUNCAO.map((e) => e.graus));
    expect(ENQUADRAMENTOS.map((e) => e.valor)).toEqual(ENQUADRAMENTOS_DA_FUNCAO);
    expect(MAX_REFERENCIAS_NO_GUIA).toBe(MAX_REFERENCIAS_DE_ESTILO);
  });

  it("a cópia local das receitas tem os mesmos ids, tomadas e tipos de kit da função", () => {
    expect(RECEITAS_LOCAIS.map((r) => r.id)).toEqual(RECEITAS_DA_FUNCAO.map((r) => r.id));
    for (const r of RECEITAS_DA_FUNCAO) {
      const local = RECEITAS_LOCAIS.find((x) => x.id === r.id)!;
      expect(local.tomadas.map((t) => t.id), r.id).toEqual(r.tomadas.map((t) => t.id));
      expect(local.tipos_de_kit.slice().sort(), r.id).toEqual(r.tipos_de_kit.slice().sort());
      // O que a função devolve em "receitas" vira a mesma receita na tela.
      const lida = normalizarReceita(JSON.parse(JSON.stringify(r)))!;
      expect(lida.tomadas.map((t) => t.id)).toEqual(r.tomadas.map((t) => t.id));
      expect(lida.tipos_de_kit).toEqual(r.tipos_de_kit);
    }
  });

  it("tomada e versão montadas pela própria função passam pelos normalizadores da tela", () => {
    const kit: KitFoto = {
      tipo: "produto",
      nome: "Mouse",
      variante: null,
      atributos: { observado: [], informado: [], inferido: [] },
      invariantes: [],
      lacunas: [],
      autorizacao: null,
      frente_imagem_id: null,
      status: "rascunho",
    };
    const refs = [{ imagem_id: F1, papel: "identidade" as const, vista: "frente", prioridade: 0 }];
    const receita = RECEITAS_DA_FUNCAO[0];
    const ctx = { kit, refs, receita, formatos: ["4:5" as const] };
    const lateral = montarTomada({ id: "lateral", nome: "Lateral", camera: cameraDoPreset("a90-e0-dmedio") }, ctx);
    const verso = montarTomada({ id: "verso", nome: "Verso", camera: cameraDoPreset("a180-e0-dmedio"), exige: receita.tomadas.find((t) => t.id === "verso")!.exige }, ctx);
    const comVersao = {
      ...lateral,
      versoes: [
        { versao: 1, imagem_id: null, storage_path: "a.png", custo_usd: 0.1, conferencia: { pendente: true }, aprovada: false, decisao: "rejeitada", motivo_rejeicao: "logo errado" },
        { versao: 2, imagem_id: null, storage_path: "b.png", custo_usd: 0.1, conferencia: { pendente: true }, aprovada: null, decisao: null, motivo_rejeicao: null },
      ],
      status: "gerada",
    };
    const e = normalizarEnsaio(JSON.parse(JSON.stringify({ id: ENSAIO, tomadas: [lateral, verso, comVersao] })))!;
    expect(e.tomadas[0]).toMatchObject({ id: "lateral", status: "pendente", modo: "angulo", camera: { azimute: 90, elevacao: 0, enquadramento: "medio" } });
    expect(e.tomadas[1].status).toBe("bloqueada");
    expect(e.tomadas[1].motivo_bloqueio).toContain("Falta");
    expect(e.tomadas[2].status).toBe("gerada");
    expect(e.tomadas[2].versoes.map((v) => [v.aprovada, v.rejeitada, v.conferencia])).toEqual([
      [false, true, null],
      [false, false, null],
    ]);
    // O status da função manda sobre o booleano bloqueada (o kit pode ter sido completado).
    expect(normalizarEnsaio({ id: "x", tomadas: [{ id: "t", status: "pendente", bloqueada: true }] })!.tomadas[0].status).toBe("pendente");
  });

  it("gerando vence em 6 minutos; data da autorização e vista vão no formato do banco", () => {
    const base = normalizarEnsaio({ id: "e", atualizado_em: "2026-09-24T10:00:00Z", tomadas: [{ id: "a", status: "gerando" }, { id: "b", status: "gerando", gerando_desde: "2026-09-24T10:09:00Z" }] })!;
    const depois = vencerGeracoes(base, Date.parse("2026-09-24T10:10:00Z"));
    expect(depois.tomadas.map((t) => t.status)).toEqual(["falhou", "gerando"]);
    expect(depois.tomadas[0].ultimo_erro).toContain("6 minutos");
    expect(vencerGeracoes(base, Date.parse("2026-09-24T10:03:00Z")).tomadas.map((t) => t.status)).toEqual(["gerando", "gerando"]);

    expect(dataParaIso("24/09/2026")).toBe("2026-09-24");
    expect(dataParaIso("2026-09-24")).toBe("2026-09-24");
    expect(dataParaIso("amanhã")).toBe("");
    const pessoa = { ...kitVazio(CLIENTE, "pessoa"), nome: "Ana", autorizacao: { confirmada: true, quem: "Ana", data: "5/9/2026", finalidade: "site", observacao: "" } };
    expect((corpoDoKit(pessoa).autorizacao as any).data).toBe("2026-09-05");
    expect(refsParaSalvar([{ imagem_id: "a", papel: "identidade", vista: "Frente", prioridade: 0 }, { imagem_id: "b", papel: "verso", vista: "verso", prioridade: 1 }])).toEqual([
      { imagem_id: "a", papel: "identidade", vista: null, prioridade: 0 },
      { imagem_id: "b", papel: "verso", vista: "verso", prioridade: 1 },
    ]);
    // Frente fora das referências a função recusaria (frente_fora_do_kit): vai nula.
    expect(corpoDoKit({ ...kitVazio(CLIENTE), nome: "X", frente_imagem_id: F2, refs: [{ imagem_id: F1, papel: "identidade", vista: "", prioridade: 0 }] }).frente_imagem_id).toBeNull();
  });

  it("enviar vai em lotes de 30; sugestão de prompt aplica sem ensaio, com o client_id", async () => {
    respostas.enviar = (corpo: any) => ({ file_ids: corpo.imagem_ids.map((id: string) => `file-${id}`), aviso: corpo.imagem_ids.length < 30 ? "revisão não pedida" : null });
    const ids = Array.from({ length: 45 }, (_, i) => `img-${i}`);
    const r = await enviarFotos(CLIENTE, ids, "aprovacao");
    expect(chamadasDe("enviar").map((c) => c.imagem_ids.length)).toEqual([30, 15]);
    expect(r.file_ids).toHaveLength(45);
    expect(r.aviso).toBe("revisão não pedida");

    respostas.agente_aplicar = { item: { id: "p9", tipo: "prompt", titulo: "Luz dura lateral", prompt_pt: "luz dura" }, custo_usd: 0 };
    const s = normalizarSugestoes([{ id: "s1", tipo: "prompt", titulo: "Luz dura lateral", motivo: "combina com a marca", prompt_pt: "luz dura" }])[0];
    expect(s.descricao).toBe("combina com a marca");
    expect(sugestaoPedeEnsaio(s)).toBe(false);
    const aplicado = await aplicarSugestao({ clientId: CLIENTE, ensaioId: null }, s);
    expect(chamadasDe("agente_aplicar")[0]).toEqual({ acao: "agente_aplicar", client_id: CLIENTE, sugestao: s.bruto });
    expect(aplicado.item!.titulo).toBe("Luz dura lateral");
  });
});

// ------------------------------------------------------------------ compatibilidade e texto

describe("compatibilidade Safari 11 / Chrome 64, texto de tela e fotografia", () => {
  const pasta = resolve(raiz, "src/components/mesa-foto");
  const arquivos = readdirSync(pasta)
    .filter((n) => /\.(ts|tsx)$/.test(n))
    .map((n) => resolve(pasta, n))
    .concat([resolve(raiz, "src/pages/MesaFoto.tsx")]);

  it("nenhum arquivo da Mesa Foto usa travessão, lookbehind, \\p{}, grupo nomeado, .at(), Object.hasOwn, aspect-ratio, :has, flatMap ou min()/max()/clamp() em classe", () => {
    const proibidos: [string, RegExp][] = [
      ["travessão", /[\u2014\u2013]/],
      ["lookbehind", /\(\?<[=!]/],
      ["grupo nomeado", /\(\?<[a-zA-Z]/],
      ["\\p{}", /\\p\{/],
      [".at(", /\.at\(/],
      ["Object.hasOwn", /Object\.hasOwn\b/],
      ["aspect-ratio", /aspect-(square|video|\[)|aspect-ratio/],
      [":has", /:has\(|has-\[/],
      ["min/max/clamp em classe", /-\[(min|max|clamp)\(/],
      ["flatMap", /\.flatMap\(/],
      ["Promise.allSettled", /Promise\.allSettled/],
      ["Object.fromEntries", /Object\.fromEntries/],
      ["replaceAll", /\.replaceAll\(/],
    ];
    const achados: string[] = [];
    arquivos.forEach((a) => {
      const texto = readFileSync(a, "utf8");
      proibidos.forEach(([nome, re]) => {
        if (re.test(texto)) achados.push(`${a.split(/[\\/]/).pop()}: ${nome}`);
      });
    });
    expect(achados).toEqual([]);
  });

  it("nada escurece a foto para destaque (sem véu preto, gradiente escuro ou brightness)", () => {
    const achados: string[] = [];
    arquivos.forEach((a) => {
      const texto = readFileSync(a, "utf8");
      if (/bg-black|from-black|via-black|to-black|brightness\(|bg-gradient-to/.test(texto)) achados.push(a.split(/[\\/]/).pop() || a);
    });
    expect(achados).toEqual([]);
  });

  it("grades da Mesa Foto têm min-w-0 (celular sem rolagem lateral) e as queries guardam só JSON", () => {
    arquivos.forEach((a) => {
      const texto = readFileSync(a, "utf8");
      const grades = texto.match(/className="[^"]*\bgrid\b[^"]*"/g) || [];
      grades.forEach((g) => {
        if (g.indexOf("grid-cols-") >= 0 && g.indexOf("min-w-0") < 0 && g.indexOf("grid-cols-2 gap-2\"") < 0 && g.indexOf("grid-cols-3 gap-0.5") < 0) {
          throw new Error(`${a.split(/[\\/]/).pop()}: grade sem min-w-0: ${g}`);
        }
      });
    });
    const api = ler("src/components/mesa-foto/fotoApi.ts");
    // O que vai para o cache são objetos normalizados (JSON puro), nunca Blob, File ou Date.
    expect(api).not.toMatch(/new Date\([^)]*\)\s*[,}]/);
    expect(api.indexOf("queryFn")).toBeGreaterThan(0);
  });
});
