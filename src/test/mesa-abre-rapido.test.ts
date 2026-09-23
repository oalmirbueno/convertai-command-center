import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, type Query } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A Mesa abre rápido (pedido do dono em 23/09: "quando eu entro na mesa, já
 * não precisa ficar carregando"). Fixa as peças que fazem isso e as travas
 * que impedem o cache de mostrar dado errado.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: mock.invoke }, rpc: mock.rpc, from: vi.fn(), storage: { from: vi.fn() } },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { EstimativaInline } from "@/components/mesa/Custo";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import { doItem } from "@/components/mesa/useAgendaDoMes";
import { chavePersistivel, criarQueryClient, dadoSimples, devePersistir, IDADE_MAXIMA_MS } from "@/lib/mesa/cachePersistido";

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");
const app = ler("src/App.tsx");
const pagina = ler("src/pages/MesaDoCliente.tsx");
const agenda = ler("src/components/mesa/useAgendaDoMes.ts");
const api = ler("src/lib/mesa/api.ts");

const consulta = (queryKey: unknown[], data: unknown, status = "success") =>
  ({ queryKey, state: { status, data } }) as unknown as Query;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("o que vai para o navegador", () => {
  it("só Mesa e lista de clientes; nunca URL assinada nem estimativa", () => {
    expect(chavePersistivel(["mesa", "agenda-do-mes", "c", "2026-09-01"])).toBe(true);
    expect(chavePersistivel(["clients", "u", "admin"])).toBe(true);
    expect(chavePersistivel(["mesa", "url", "mesa", "a/b.png"])).toBe(false);
    expect(chavePersistivel(["mesa", "estimativa", "[]"])).toBe(false);
    expect(chavePersistivel(["projects", "u"])).toBe(false);
  });

  it("só dado JSON puro: Map, Set, Date e função ficam de fora", () => {
    expect(dadoSimples({ itens: [{ id: "1", n: 2 }], roteiros: { a: { cards: [] } } })).toBe(true);
    expect(dadoSimples({ roteiros: new Map() })).toBe(false);
    expect(dadoSimples({ lista: [new Set()] })).toBe(false);
    expect(dadoSimples({ quando: new Date() })).toBe(false);
    expect(dadoSimples({ f: () => 1 })).toBe(false);
    expect(dadoSimples({ n: NaN })).toBe(false);
  });

  it("consulta com erro ou ainda carregando não é guardada", () => {
    expect(devePersistir(consulta(["mesa", "previsao", "c"], { saldo_usd: 1 }))).toBe(true);
    expect(devePersistir(consulta(["mesa", "previsao", "c"], undefined, "error"))).toBe(false);
    expect(devePersistir(consulta(["mesa", "itens-do-mes", "c"], { trabalhos: new Map() }))).toBe(false);
  });

  it("o que vai para o navegador vive 24 h na memória; a Mesa relê depois de 2 min", () => {
    const qc = criarQueryClient();
    expect(qc.getQueryDefaults(["mesa", "previsao", "c"]).gcTime).toBe(IDADE_MAXIMA_MS);
    expect(qc.getQueryDefaults(["mesa", "previsao", "c"]).staleTime).toBe(2 * 60_000);
    expect(qc.getQueryDefaults(["clients", "u"]).gcTime).toBe(IDADE_MAXIMA_MS);
    expect(qc.getDefaultOptions().queries?.gcTime).toBe(5 * 60_000);
  });

  it("o carimbo leva a versão e o dono: outro build ou outra pessoa descarta o guardado", () => {
    const fonte = ler("src/lib/mesa/cachePersistido.ts");
    expect(fonte).toContain('export const CHAVE_DO_CACHE = "aceleriq-cache-v1";');
    expect(fonte).toContain("const carimbo = () => `${VERSAO}:${donoDaSessao()}`;");
    expect(fonte).toContain("serialize: (cliente) => JSON.stringify({ ...cliente, buster: carimbo() })");
    expect(app).toContain("<LimpezaDoCacheAoTrocarDeUsuario />");
  });
});

describe("a Mesa não espera o que não precisa", () => {
  it("o cliente vem do endereço e as leituras não esperam a lista de clientes", () => {
    expect(pagina).toContain('const clientIdUrl = params.get("client") || "";');
    expect(pagina).not.toContain("enabled: !!cliente,");
    expect(pagina.match(/enabled: !!clientId,/g)?.length).toBe(2);
    // O saldo vem do consumo e da previsão: a RPC só de saldo saiu.
    expect(pagina).not.toContain('rpc("ia_saldo"');
  });

  it("cada aba baixa sozinha, com esqueleto no lugar, e as outras vêm em tempo ocioso", () => {
    for (const aba of ["AbaContexto", "AbaMes", "AbaEstudio", "AbaEntrega"]) {
      expect(pagina).not.toContain(`import ${aba} from`);
      expect(pagina).toContain(`import("@/components/mesa/${aba}")`);
    }
    expect(pagina).toContain("<Suspense fallback={<EsqueletoDaAba />}>");
    expect(pagina).toContain("requestIdleCallback");
    expect(app).toContain("<Suspense fallback={<EsqueletoDaMesa />}><MesaDoCliente /></Suspense>");
  });

  it("a rota espera o papel antes de decidir (não trata a equipe como cliente)", () => {
    const rota = app.slice(app.indexOf("function ProtectedRoute("), app.indexOf("function StaffRoute("));
    expect(rota).toContain("if (!profile && !profileError) return <LoadingScreen />;");
    expect(rota.indexOf("if (!profile && !profileError)")).toBeGreaterThan(rota.indexOf("if (!user)"));
  });

  it("agenda do mês: duas rodadas em paralelo, sem a ida separada a projects, e sem Map", () => {
    expect(agenda).toContain('projects!inner(client_id, deleted_at)');
    expect(agenda).toContain('.eq("projects.client_id", clientId)');
    expect(agenda).not.toContain('.from("projects")');
    expect(agenda.match(/await Promise\.all\(/g)?.length).toBe(2);
    expect(agenda).toContain("placeholderData: keepPreviousData");
    expect(agenda).toContain("roteiros: Record<string, RoteiroDoItem>;");
    expect(doItem({ a: 1 }, "a")).toBe(1);
    expect(doItem({ a: 1 } as Record<string, number>, "constructor")).toBeUndefined();
  });

  it("catálogo direto da tabela, sem a função de borda", () => {
    const corpo = api.slice(api.indexOf("export async function lerCatalogo"), api.indexOf("export const modelosAtivos"));
    expect(corpo).toContain('from("ia_modelos")');
    expect(corpo).not.toContain("chamarFuncao");
  });
});

describe("estimativa: nada de ia-gateway enquanto o catálogo chega", () => {
  const valor = (extra: Partial<MesaValor>): MesaValor => ({
    clientId: "11111111-1111-1111-1111-111111111111",
    clientName: "Cliente sintético",
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
    ...extra,
  });
  const montar = (v: MesaValor) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      h(QueryClientProvider, { client: qc }, h(MesaProvider, { valor: v }, h(EstimativaInline, { partes: [{ modeloId: "x", tipo: "texto", tokensEntrada: 1000 }] }))),
    );
  };

  it("catálogo carregando: mostra estimando e não chama a função", async () => {
    montar(valor({ catalogoCarregando: true }));
    expect(screen.getByText("estimando…")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 30));
    expect(mock.invoke).not.toHaveBeenCalled();
  });

  it("catálogo com o modelo: conta local, sem rede", async () => {
    montar(
      valor({
        catalogo: [
          { id: "x", provedor: "openai", modelo_api: "x", tipo: "texto", rotulo: "X", preco_entrada_1m: 1, preco_saida_1m: 0, preco_cache_1m: null, preco_imagem: null, raciocinio: [], padrao_para: [], ativo: true },
        ],
      }),
    );
    expect(await screen.findByText(/por envio/)).toBeTruthy();
    expect(mock.invoke).not.toHaveBeenCalled();
  });

  it("catálogo pronto sem o modelo: aí sim pergunta à função", async () => {
    mock.invoke.mockResolvedValue({ data: { custo_usd: 0.2 }, error: null });
    montar(valor({}));
    await waitFor(() => expect(mock.invoke).toHaveBeenCalledWith("ia-gateway", { body: expect.objectContaining({ acao: "estimar" }) }));
  });
});
