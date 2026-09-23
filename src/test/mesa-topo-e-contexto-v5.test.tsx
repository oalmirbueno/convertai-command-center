import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mesa, versão 5 (pedido do dono em 23/09, noite): topo numa barra fina,
 * aba Contexto em hubs recolhíveis com score, paleta em amostras grandes,
 * galeria de fontes que cabe em qualquer tela e microfone no agente de
 * contexto.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: mock.invoke }, rpc: mock.rpc, from: mock.from, storage: { from: vi.fn() } },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));

const CLIENTES = [
  { id: "11111111-1111-1111-1111-111111111111", company_name: "Padaria São João" },
  { id: "22222222-2222-2222-2222-222222222222", company_name: "Ótica Visão" },
  { id: "33333333-3333-3333-3333-333333333333", company_name: "Academia Força" },
];
vi.mock("@/hooks/useSupabaseData", () => ({
  useClients: () => ({ data: CLIENTES, isLoading: false, isSuccess: true, isFetching: false, dataUpdatedAt: 1, refetch: vi.fn() }),
}));
vi.mock("@/components/mesa/MesaContexto", async (original) => ({
  ...(await original<typeof import("@/components/mesa/MesaContexto")>()),
  useCatalogo: () => ({ data: [], isLoading: false }),
}));
// As abas não entram neste teste: só o topo.
vi.mock("@/components/mesa/AbaContexto", () => ({ default: () => <p>aba contexto aberta</p> }));
vi.mock("@/components/mesa/AbaMes", () => ({ default: () => <p>aba mês</p> }));
vi.mock("@/components/mesa/AbaCampanhas", () => ({ default: () => <p>aba campanhas</p> }));
vi.mock("@/components/mesa/AbaEstudio", () => ({ default: () => <p>aba estúdio</p> }));
vi.mock("@/components/mesa/AbaEntrega", () => ({ default: () => <p>aba entrega</p> }));

import MesaDoCliente, { filtrarClientes } from "@/pages/MesaDoCliente";
import AgenteDeContexto from "@/components/mesa/AgenteDeContexto";
import { alturaDoPopup } from "@/components/mesa/ContextoBibliotecaDeFontes";
import { Hub, useHubsAbertos } from "@/components/mesa/ContextoHub";
import { normalizarHex, PaletaDaMarca, textoSobre } from "@/components/mesa/ContextoPaleta";
import { scoreDoItem, scoreDoGrupo, montarChecklist } from "@/components/mesa/ContextoAutomatico";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import { faixaDoScore, nivelDoTexto, scoreDoConsolidado, type KitDoContexto } from "@/components/mesa/contextoDoCliente";
import { TooltipProvider } from "@/components/ui/tooltip";

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");

beforeAll(() => {
  // O Popover do Radix mede o gatilho; o jsdom não tem ResizeObserver.
  if (typeof (globalThis as any).ResizeObserver === "undefined") {
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
  mock.rpc.mockResolvedValue({ data: { saldo_usd: 12.5, total_usd: 3.2, por_modelo: [], por_tarefa: [] }, error: null });
});

const kit = (extra: Partial<KitDoContexto> = {}): KitDoContexto => ({
  client_id: "c",
  paleta: null,
  logo_file_id: null,
  estilo: null,
  regras: null,
  contexto: null,
  contexto_atualizado_em: null,
  ...extra,
});

const longo = (n: number) => "x".repeat(n);

// ------------------------------------------------------------------ score

describe("score do contexto consolidado", () => {
  it("vazio: zero, com os nove campos no que falta e o de maior peso primeiro", () => {
    const r = scoreDoConsolidado(null);
    expect(r.score).toBe(0);
    expect(r.completos).toBe(0);
    expect(r.campos.map((c) => c.rotulo)).toEqual(["Negócio", "Público", "Oferta", "Tom de voz", "Diferenciais", "Tipografia", "Logo", "Estilo", "Regras"]);
    expect(r.campos.reduce((t, c) => t + c.peso, 0)).toBe(100);
    expect(r.faltas).toHaveLength(9);
    expect(r.faltas[0].ganho).toBe(15);
    expect(r.faltas[0].texto).toContain("Preencher");
  });

  it("tudo preenchido com profundidade: 100 e nada faltando", () => {
    const r = scoreDoConsolidado(
      kit({
        estilo: longo(200),
        regras: longo(150),
        contexto: {
          negocio: longo(200),
          publico: longo(200),
          oferta: longo(200),
          tom_de_voz: longo(200),
          diferenciais: ["Entrega rápida", "Projeto sob medida", "Garantia de 5 anos"],
          tipografia: { titulo: "Playfair", texto: "Inter" },
          logo: { descricao: longo(80) },
        },
      }),
    );
    expect(r.score).toBe(100);
    expect(r.faltas).toEqual([]);
    expect(r.completos).toBe(9);
  });

  it("profundidade conta: texto curto vale menos que médio, lista com 2 itens vale menos que com 3", () => {
    expect(nivelDoTexto("", 100)).toBe("vazio");
    expect(nivelDoTexto("   ", 100)).toBe("vazio");
    expect(nivelDoTexto(longo(20), 100)).toBe("curto");
    expect(nivelDoTexto(longo(60), 100)).toBe("medio");
    expect(nivelDoTexto(longo(100), 100)).toBe("completo");

    const curto = scoreDoConsolidado(kit({ contexto: { negocio: longo(20) } }));
    const medio = scoreDoConsolidado(kit({ contexto: { negocio: longo(100) } }));
    const cheio = scoreDoConsolidado(kit({ contexto: { negocio: longo(160) } }));
    expect(curto.score).toBe(6);
    expect(medio.score).toBe(11);
    expect(cheio.score).toBe(15);
    expect(curto.faltas.find((f) => f.chave === "negocio")!.texto).toContain("Aprofundar negócio");

    const dois = scoreDoConsolidado(kit({ contexto: { diferenciais: ["A", "B", "  "] } }));
    expect(dois.campos.find((c) => c.chave === "diferenciais")!.nivel).toBe("medio");
    expect(dois.faltas.find((f) => f.chave === "diferenciais")!.texto).toContain("hoje 2");

    const soTitulo = scoreDoConsolidado(kit({ contexto: { tipografia: { titulo: "Playfair" } } }));
    expect(soTitulo.faltas.find((f) => f.chave === "tipografia")!.texto).toBe("Dizer a fonte de texto.");
  });

  it("estilo e regras vêm do kit; o que falta vem na ordem do que mais sobe", () => {
    const r = scoreDoConsolidado(kit({ estilo: longo(200), regras: longo(10) }));
    expect(r.campos.find((c) => c.chave === "estilo")!.nivel).toBe("completo");
    expect(r.campos.find((c) => c.chave === "regras")!.nivel).toBe("curto");
    const ganhos = r.faltas.map((f) => f.ganho);
    expect(ganhos.slice().sort((a, b) => b - a)).toEqual(ganhos);
  });

  it("resultado em JSON puro e faixas de cor", () => {
    const r = scoreDoConsolidado(kit({ contexto: { negocio: "Loja" } }));
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    expect(faixaDoScore(10)).toBe("baixo");
    expect(faixaDoScore(40)).toBe("medio");
    expect(faixaDoScore(75)).toBe("bom");
  });

  it("score dos outros hubs sai do checklist; o que ainda lê fica sem número", () => {
    const itens = montarChecklist({ kit: null, fontes: null, referencias: { total: 4, semLeitura: 2 }, acervo: null, documentos: null });
    expect(scoreDoItem(itens.find((i) => i.chave === "referencias"))).toBe(50);
    expect(scoreDoItem(itens.find((i) => i.chave === "imagens"))).toBeNull();
    expect(scoreDoGrupo(itens, ["logo", "paleta"])).toBe(0);
    expect(scoreDoGrupo(itens, ["logo", "fontes"])).toBeNull();
  });
});

// ------------------------------------------------------------------ hubs

function HubDeTeste() {
  const hubs = useHubsAbertos({ a: false });
  return (
    <Hub id="a" titulo="Contexto consolidado" resumo="7 de 9 campos completos" score={72} aberto={hubs.aberto("a")} onAlternar={() => hubs.alternar("a")}>
      <p>conteúdo do hub</p>
    </Hub>
  );
}

describe("hubs recolhíveis", () => {
  it("recolhido mostra só o resumo e o score; abre e lembra", () => {
    const { unmount } = render(<HubDeTeste />);
    expect(screen.getByText("7 de 9 campos completos")).toBeTruthy();
    expect(screen.getByLabelText("Score de contexto consolidado: 72 de 100")).toBeTruthy();
    expect(screen.queryByText("conteúdo do hub")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Contexto consolidado/ }));
    expect(screen.getByText("conteúdo do hub")).toBeTruthy();
    unmount();
    render(<HubDeTeste />);
    expect(screen.getByText("conteúdo do hub")).toBeTruthy();
  });

  it("a aba começa com a Marca aberta e o consolidado recolhido", () => {
    const tela = ler("src/components/mesa/ContextoAutomatico.tsx");
    expect(tela).toContain('const HUBS_ABERTOS_DE_INICIO: Record<string, boolean> = { "ctx-marca": true };');
    for (const id of ["ctx-marca", "ctx-consolidado", "ctx-referencias", "ctx-fotos", "ctx-documentos"]) {
      expect(tela).toContain(`id="${id}"`);
    }
    // Fotos e referências só são posicionadas, com as mesmas props de antes.
    expect(tela).toContain('<FotosDoCliente onOrganizar={onIrPara ? () => onIrPara("imagens") : undefined} />');
    expect(tela).toContain("<GaleriaDeReferencias");
    expect(tela).toContain("aoLer={(data) => depoisDeMontar(clientId, data)}");
  });
});

// ------------------------------------------------------------------ marca

describe("paleta em amostras grandes", () => {
  it("hex normalizado e texto legível por cima da cor", () => {
    expect(normalizarHex("#00c853")).toBe("#00C853");
    expect(normalizarHex("fff")).toBe("#FFFFFF");
    expect(normalizarHex("verde")).toBeNull();
    expect(textoSobre("#FFFFFF")).toBe("#111111");
    expect(textoSobre("#111827")).toBe("#FFFFFF");
    expect(textoSobre("#00C853")).toBe("#111111");
  });

  it("mostra nome, papel e hex; clicar copia o hex", async () => {
    const escrever = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: escrever }, configurable: true });
    render(<PaletaDaMarca paleta={[{ nome: "Verde folha", hex: "#00c853", papel: "principal" }, { nome: "", hex: "#111827", papel: "texto" }]} />);
    expect(screen.getByText("Verde folha")).toBeTruthy();
    expect(screen.getByText("Principal")).toBeTruthy();
    expect(screen.getByText("#111827")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Copiar #00C853, Verde folha"));
    await waitFor(() => expect(escrever).toHaveBeenCalledWith("#00C853"));
  });
});

// ------------------------------------------------------------------ fontes

describe("galeria de fontes cabe em qualquer tela", () => {
  it("a altura vem da janela: notebook de 768, celular e tela grande", () => {
    expect(alturaDoPopup(768)).toBe(720);
    expect(alturaDoPopup(1080)).toBe(900);
    expect(alturaDoPopup(560)).toBe(544);
    expect(alturaDoPopup(200)).toBe(320);
  });

  it("cabeçalho e rodapé fixos, só a lista rola", () => {
    const fonte = ler("src/components/mesa/ContextoBibliotecaDeFontes.tsx");
    expect(fonte).toContain("style={{ maxHeight: alturaMaxima, height: alturaMaxima }}");
    expect(fonte).toContain('className="flex w-[calc(100vw-16px)] max-w-5xl flex-col gap-0 overflow-hidden');
    expect(fonte).toContain('data-lista-de-fontes className="min-h-0 flex-1 overflow-y-auto');
    expect(fonte).toContain('<div className="flex shrink-0 flex-col border-t border-border');
    // A lista mínima de 240 px empurrava o rodapé para fora em tela baixa.
    expect(fonte).not.toContain("min-h-[240px]");
    expect(fonte).not.toContain("max-h-[90vh]");
  });
});

// ------------------------------------------------------------------ topo

function Endereco() {
  const loc = useLocation();
  return <output data-testid="endereco">{loc.search}</output>;
}

function montarPagina(inicial: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[inicial]}>
        <MesaDoCliente />
        <Endereco />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("topo compacto da Mesa", () => {
  it("busca sem acento e quem começa com o termo vem primeiro", () => {
    const lista = [
      { id: "1", nome: "Padaria São João" },
      { id: "2", nome: "Ótica Visão" },
      { id: "3", nome: "Academia Força" },
    ];
    expect(filtrarClientes(lista, "otica").map((c) => c.id)).toEqual(["2"]);
    expect(filtrarClientes(lista, "sao").map((c) => c.id)).toEqual(["1", "2"]);
    expect(filtrarClientes(lista, "a").map((c) => c.id)).toEqual(["3", "1", "2"]);
    expect(filtrarClientes(lista, "").length).toBe(3);
  });

  it("sem título grande: o seletor de cliente abre com busca e troca o cliente", async () => {
    montarPagina("/mesa");
    expect(screen.queryByText("Escolha um cliente para abrir a mesa dele.")).toBeTruthy();
    // O título fica só para leitor de tela.
    expect(screen.getByRole("heading", { name: "Mesa do cliente" }).className).toContain("sr-only");
    expect(screen.queryByRole("navigation", { name: "Etapas da Mesa" })).toBeNull();

    fireEvent.click(screen.getByRole("combobox", { name: "Escolher o cliente" }));
    const busca = await screen.findByLabelText("Buscar cliente");
    fireEvent.change(busca, { target: { value: "otica" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(busca, { key: "Enter" });

    await waitFor(() => expect(screen.getByTestId("endereco").textContent).toContain("client=22222222-2222-2222-2222-222222222222"));
    expect(screen.getByTestId("endereco").textContent).toContain("aba=contexto");
    expect(await screen.findByText("aba contexto aberta")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /Cliente: Ótica Visão/ })).toBeTruthy();
  });

  it("com cliente: etapas, saldo pequeno e atalhos na mesma barra fixa", async () => {
    montarPagina("/mesa?client=11111111-1111-1111-1111-111111111111&aba=mes");
    const nav = screen.getByRole("navigation", { name: "Etapas da Mesa" });
    const cabecalho = nav.closest("header")!;
    expect(cabecalho.className).toContain("sticky");
    expect(cabecalho.contains(screen.getByRole("combobox"))).toBe(true);
    expect(await screen.findByText("aba mês")).toBeTruthy();
    await waitFor(() => expect(cabecalho.textContent).toContain("US$ 12,50"));
    expect(screen.getByLabelText("Recarregar carteira")).toBeTruthy();
    expect(screen.getByLabelText("Modelos de IA e chaves")).toBeTruthy();

    // Trocar pelo seletor com o clique também troca o cliente.
    fireEvent.click(screen.getByRole("combobox", { name: /Cliente: Padaria São João/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Academia Força" }));
    await waitFor(() => expect(screen.getByTestId("endereco").textContent).toContain("client=33333333-3333-3333-3333-333333333333"));
  });

  it("o nav continua sendo o que o Estúdio e o Contexto medem", () => {
    const pagina = ler("src/pages/MesaDoCliente.tsx");
    expect(pagina).toContain('aria-label="Etapas da Mesa"');
    expect(pagina).not.toContain('className="heading-page"');
    expect(pagina).not.toContain("<BarraDeCusto");
    expect(ler("src/components/mesa/EstudioAltura.ts")).toContain(`document.querySelector('nav[aria-label="Etapas da Mesa"]')`);
    expect(ler("src/components/mesa/AbaContexto.tsx")).toContain("fimDoCabecalhoFixo()");
  });
});

// ------------------------------------------------------------------ ditado

type Ouvinte = { onresult: ((e: any) => void) | null; onend: (() => void) | null; start: () => void; stop: () => void; abort: () => void };
let ultimoReconhecedor: Ouvinte | null = null;

class ReconhecedorFalso implements Ouvinte {
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onend: (() => void) | null = null;
  constructor() {
    ultimoReconhecedor = this;
  }
  start() {}
  stop() {
    if (this.onend) this.onend();
  }
  abort() {}
}

const valorDaMesa = (): MesaValor => ({
  clientId: "11111111-1111-1111-1111-111111111111",
  clientName: "Cliente sintético",
  userId: "u-1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 10,
  catalogo: [
    { id: "x", provedor: "openai", modelo_api: "x", tipo: "texto", rotulo: "X", preco_entrada_1m: 1, preco_saida_1m: 1, preco_cache_1m: null, preco_imagem: null, raciocinio: [], padrao_para: ["contexto"], ativo: true } as any,
  ],
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
});

function comMesa(filho: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <MesaProvider valor={valorDaMesa()}>{filho}</MesaProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("microfone no agente de contexto", () => {
  beforeEach(() => {
    (window as any).webkitSpeechRecognition = ReconhecedorFalso;
    ultimoReconhecedor = null;
    mock.invoke.mockImplementation(async (_funcao: string, { body }: { body: any }) => {
      if (body && body.acao === "historico") return { data: { mensagens: [] }, error: null };
      if (body && body.acao === "conversar") return { data: { resposta: "Anotado.", mudou: [], memorias: 0, kit: null, custo_usd: 0.001 }, error: null };
      return { data: {}, error: null };
    });
  });
  afterEach(() => {
    delete (window as any).webkitSpeechRecognition;
  });

  it("o microfone fica ao lado do Enviar e escreve no campo enquanto a pessoa fala", async () => {
    comMesa(<AgenteDeContexto preencher />);
    const mic = screen.getByRole("button", { name: "Falar em vez de digitar" });
    const enviar = screen.getByRole("button", { name: /Enviar/ });
    expect(mic.closest("div")).toBe(enviar.parentElement);

    fireEvent.click(mic);
    expect(ultimoReconhecedor).not.toBeNull();
    act(() => {
      ultimoReconhecedor!.onresult!({ resultIndex: 0, results: { length: 1, 0: { isFinal: false, 0: { transcript: "a cor principal é verde" } } } });
    });
    const campo = screen.getByPlaceholderText(/O que o agente precisa saber/) as HTMLTextAreaElement;
    expect(campo.value).toBe("A cor principal é verde");
    expect(screen.getByRole("button", { name: "Parar ditado" })).toBeTruthy();
  });

  it("Ctrl+Enter continua enviando (Enter sozinho não envia)", async () => {
    comMesa(<AgenteDeContexto preencher />);
    const campo = screen.getByPlaceholderText(/O que o agente precisa saber/);
    fireEvent.change(campo, { target: { value: "nunca usar fundo preto" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(mock.invoke).not.toHaveBeenCalledWith("agente-contexto", expect.objectContaining({ body: expect.objectContaining({ acao: "conversar" }) }));
    fireEvent.keyDown(campo, { key: "Enter", ctrlKey: true });
    await waitFor(() =>
      expect(mock.invoke).toHaveBeenCalledWith("agente-contexto", { body: expect.objectContaining({ acao: "conversar", mensagem: "nunca usar fundo preto" }) }),
    );
  });

  it("usa o componente pronto do ditado, sem outra implementação", () => {
    const agente = ler("src/components/mesa/AgenteDeContexto.tsx");
    expect(agente).toContain('import { Ditado } from "./Ditado";');
    expect(agente).toContain("<Ditado valor={texto} onChange={setTexto}");
    expect(agente).not.toContain("SpeechRecognition");
  });
});

// ------------------------------------------------------------------ aba inteira

/** Consulta encadeada do supabase que sempre responde com a linha dada. */
function consultaQueResponde(linhas: unknown) {
  const resposta = { data: linhas, error: null };
  const cadeia: any = {};
  for (const m of ["select", "eq", "order", "limit", "in", "neq", "is", "not", "range"]) cadeia[m] = () => cadeia;
  cadeia.maybeSingle = async () => ({ data: Array.isArray(linhas) ? linhas[0] || null : linhas, error: null });
  cadeia.single = cadeia.maybeSingle;
  cadeia.then = (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(resposta).then(ok, erro);
  return cadeia;
}

describe("aba Contexto em hubs", () => {
  beforeEach(() => {
    mock.from.mockImplementation((tabela: string) =>
      consultaQueResponde(
        tabela === "cliente_kit_marca"
          ? [
              {
                client_id: "11111111-1111-1111-1111-111111111111",
                paleta: [{ nome: "Verde folha", hex: "#00C853", papel: "principal" }],
                logo_file_id: null,
                estilo: "Luz natural de manhã, muito respiro e tipografia serifada nos títulos.",
                regras: null,
                contexto: { negocio: "Padaria artesanal de bairro", diferenciais: ["Fermentação natural"] },
                contexto_atualizado_em: "2026-09-23T12:00:00Z",
              },
            ]
          : [],
      ),
    );
    mock.invoke.mockImplementation(async (_f: string, { body }: { body: any }) => {
      if (body && body.acao === "historico") return { data: { mensagens: [] }, error: null };
      if (body && body.acao === "ler") {
        return {
          data: { kit: null, fontes: [], encontrado: { documentos: [], tem_dossie: false, artes_aprovadas: 0, referencias: {}, sincronizadas_agora: 0 }, candidatos_a_logo: [], lacunas: ["Falta o público"] },
          error: null,
        };
      }
      return { data: {}, error: null };
    });
  });

  it("abre com a Marca à vista (paleta em amostra) e o consolidado recolhido com score e resumo", async () => {
    const { default: ContextoAutomatico } = await import("@/components/mesa/ContextoAutomatico");
    comMesa(<ContextoAutomatico onIrPara={vi.fn()} />);
    expect(await screen.findByLabelText("Copiar #00C853, Verde folha")).toBeTruthy();
    const consolidado = screen.getAllByRole("button", { name: /Contexto consolidado/ }).filter((b) => b.hasAttribute("aria-controls"))[0];
    expect(consolidado.getAttribute("aria-expanded")).toBe("false");
    expect(consolidado.textContent).toMatch(/de 9 campos completos/);
    expect(screen.queryByText("Para subir o score")).toBeNull();
    fireEvent.click(consolidado);
    expect(screen.getByText("Para subir o score")).toBeTruthy();
    for (const titulo of [/Referências/, /Fotos reais/, /Documentos e pendências/]) {
      // O chip do checklist tem o mesmo nome; o hub é o botão que abre e fecha.
      const hub = screen.getAllByRole("button", { name: titulo }).filter((b) => b.hasAttribute("aria-controls"));
      expect(hub).toHaveLength(1);
      expect(hub[0].getAttribute("aria-expanded")).toBe("false");
    }
  });
});

// ------------------------------------------------------------------ compatibilidade

describe("compatibilidade e texto nos arquivos desta rodada", () => {
  it("sem lookbehind, \\p{}, grupo nomeado, aspect-ratio, :has, min() de CSS, .at() ou travessão", () => {
    for (const rel of [
      "src/pages/MesaDoCliente.tsx",
      "src/components/mesa/AbaContexto.tsx",
      "src/components/mesa/AgenteDeContexto.tsx",
      "src/components/mesa/ContextoAutomatico.tsx",
      "src/components/mesa/ContextoBibliotecaDeFontes.tsx",
      "src/components/mesa/ContextoCartaoMarca.tsx",
      "src/components/mesa/ContextoHub.tsx",
      "src/components/mesa/ContextoLogos.tsx",
      "src/components/mesa/ContextoMarca.tsx",
      "src/components/mesa/ContextoPaleta.tsx",
      "src/components/mesa/contextoDoCliente.ts",
    ]) {
      const texto = ler(rel);
      expect(texto, rel).not.toContain("(?<");
      expect(texto, rel).not.toMatch(/\\p\{/);
      expect(texto, rel).not.toContain("aspect-[");
      expect(texto, rel).not.toContain(":has(");
      expect(texto, rel).not.toContain("[min(");
      expect(texto, rel).not.toContain(".at(");
      expect(texto, rel).not.toContain("—");
      expect(texto, rel).not.toContain("–");
    }
  });
});
