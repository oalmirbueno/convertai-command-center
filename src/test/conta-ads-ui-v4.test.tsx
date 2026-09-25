import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Conta de anúncios v4 (frente E, 25/09/2026): a tela da conta com saldo,
 * comparação, tendência, tabela de campanhas, anúncios em páginas, evolução
 * e desempenho do cliente; e ligar conta sem o erro cru do banco.
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  rpc: vi.fn(),
  tabelas: {} as Record<string, unknown>,
  escritas: [] as { tabela: string; op: string; valor: unknown }[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "order", "limit", "range", "gte"]) b[m] = () => b;
    b.insert = (valor: unknown) => {
      mock.escritas.push({ tabela, op: "insert", valor });
      return b;
    };
    b.update = (valor: unknown) => {
      mock.escritas.push({ tabela, op: "update", valor });
      return b;
    };
    b.single = () => Promise.resolve({ data: { id: "nova-conta" }, error: null });
    b.maybeSingle = b.single;
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: mock.rpc,
      from: (tabela: string) => consulta(tabela),
      storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/x.png" }, error: null }) }) },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import type { ModeloIa } from "@/lib/mesa/api";
import AbaConta, { ANUNCIOS_POR_PAGINA, PERIODOS_DA_CONTA } from "@/components/mesa-ads/AbaConta";
import { extrasDaConta, normalizarDesempenho, normalizarEvolucao } from "@/components/mesa-ads/contaApi";
import { connectAdsAccount, ContaDeOutroCliente, numeroDaConta } from "@/hooks/useAdsMetrics";

const raiz = resolve(__dirname, "../..");
const CLIENTE = "22222222-2222-2222-2222-222222222222";

const catalogo: ModeloIa[] = [
  {
    id: "openai:gpt-texto", provedor: "openai", modelo_api: "gpt-texto", tipo: "texto", rotulo: "Texto",
    preco_entrada_1m: 1, preco_saida_1m: 2, preco_cache_1m: null, preco_imagem: null,
    raciocinio: ["low", "medium"], padrao_para: ["estrategista", "diretor_arte", "leitura"], ativo: true,
  },
];

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE, clientName: "Cliente Sintético", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 50,
  catalogo, catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(),
});

function montar(filho: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(TooltipProvider, null, h(MesaProvider, { valor: valorDaMesa(), children: filho }))));
}

const chamadasDe = (acao: string) =>
  mock.invoke.mock.calls.filter((c: any[]) => c[0] === "mesa-ads" && c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);

function responder(mapa: Record<string, unknown>) {
  mock.invoke.mockImplementation(async (_f: string, { body }: any) =>
    Object.prototype.hasOwnProperty.call(mapa, body.acao) ? { data: mapa[body.acao], error: null } : { data: { ok: true }, error: null },
  );
}

const anuncio = (i: number) => ({
  ad_id: `ad-${i}`, nome: `Peça ${i}`, status: "ACTIVE", campaign_id: "cp-trafego", campanha: "Tráfego | Site", conjunto: "Público frio", formato: i % 2 ? "video" : "imagem",
  imagem_url: null, titulo: "", corpo: "", descricao: "", cta: "", destino: "",
  metricas: { gasto: 10 + i, resultados: 5, custo_por_resultado: 2, ctr_saida_pct: 1.1, frequencia_media: 1.2, resultado_rotulo: "Visitas à página" },
  diagnostico: null, tendencia: { ctr_var_pct: null, custo_resultado_var_pct: null, frequencia: 1.2 }, sinal: "manter", referencia_id: null,
});

const CONTA_V4 = {
  conectada: true,
  atualizado_em: new Date().toISOString(),
  periodo: { inicio: "2026-09-12", fim: "2026-09-25", dias: 14 },
  totais: { gasto: 812.4, impressoes: 40000, resultados: 300, custo_por_resultado: 2.71, ctr_saida_pct: 1.4, cpm: 20.31, frequencia_media: 1.7, alcance: 23500, resultado_rotulo: "Visitas à página", roas: null, cpc_link: 1.45 },
  comparacao: { gasto_pct: 12.5, resultados_pct: 30, custo_por_resultado_pct: -13.4, ctr_link_pct: 4, cpm_pct: 2, alcance_pct: null },
  serie: [
    { dia: "2026-09-24", gasto: 50, resultados: 20, cliques_link: 30, custo_por_resultado: 2.5 },
    { dia: "2026-09-25", gasto: 60, resultados: 25, cliques_link: 32, custo_por_resultado: 2.4 },
  ],
  contas: [{ external_account_id: "ea1", nome: "Conta Principal", numero: "123", moeda: "BRL", status: "ativa", gasto_total: 15230.9, saldo_disponivel: 432.1, limite_de_gasto: null, pre_paga: true, pagamento: "Saldo disponível (R$ 432,10 BRL)", coletado_em: "2026-09-25T13:00:00Z", erro: "saldo: 200 Permissions error" }],
  campanhas: [{ campaign_id: "cp-trafego", nome: "Tráfego | Site", status: "ACTIVE", objetivo: "OUTCOME_TRAFFIC", orcamento_diario: 40, metricas: { gasto: 812.4, resultados: 300, custo_por_resultado: 2.71, resultado_rotulo: "Visitas à página" } }],
  anuncios: Array.from({ length: 15 }, (_, i) => anuncio(i + 1)),
};

const EVOLUCAO = {
  leitura: {
    periodo: { inicio: "2026-09-12", fim: "2026-09-25" },
    vencedores: [{ id: "ad-1", canal: "anuncios", nome: "Peça 1", imagem_url: null, link: null, motivo: "Custa R$ 1,20 por visita, 55% abaixo da média da conta (R$ 2,71), com 40 visitas.", numeros: { custo_por_resultado: 1.2 } }],
    manter: [],
    descartar: [{ id: "ad-9", canal: "anuncios", nome: "Peça 9", imagem_url: null, link: null, motivo: "Gastou R$ 60,00 sem nenhum(a) visita; a média da conta é R$ 2,71 por visita.", numeros: {} }],
    observar: [],
    conteudo: {
      destaques: [],
      abaixo: [],
      sinais: [{ id: "p-7", canal: "organico", nome: "Qual planta você prefere?", imagem_url: null, link: "https://instagram.test/p7", motivo: "Pouca curtida e muito comentário: 14 comentários para 20 curtidas.", numeros: {} }],
    },
    proximos_testes: [{ titulo: "Variar o vencedor \"Peça 1\"", canal: "anuncios", hipotese: "Trocar só o gancho.", como: "2 a 3 variações.", metrica: "Custo por visita", criterio: "Manter até R$ 1,32.", base_id: "ad-1" }],
    aprendizados: [{ canal: "organico", tipo: "repetir", chave: "sinal:p-7", texto: "Post com pergunta puxou conversa." }],
    limites: ["Alcance de anúncio é aproximado."],
  },
  explicacao: null,
  memorias: { gravadas: 1, repetidas: 0, erro: null },
  custo_usd: 0,
};

beforeAll(() => {
  if (typeof (globalThis as any).ResizeObserver === "undefined") {
    (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  mock.tabelas = {};
  mock.escritas = [];
  mock.rpc.mockResolvedValue({ data: { saldo_usd: 10 }, error: null });
  responder({});
});

describe("conta de anúncios v4", () => {
  it("resumo com comparação, saldo da conta, tendência, tabela de campanhas e anúncios em páginas de 12", async () => {
    responder({ conta_ao_vivo: CONTA_V4, evolucao: EVOLUCAO });
    montar(h(AbaConta, {}));
    const resumo = await screen.findByRole("region", { name: "Resumo do período" });
    expect(within(resumo).getByText("R$ 812,40")).toBeTruthy();
    expect(within(resumo).getByText("Visitas à página")).toBeTruthy();
    expect(within(resumo).getByText("+13%")).toBeTruthy();
    expect(within(resumo).getByText("-13%").className).toContain("text-success");
    const saldo = screen.getByRole("region", { name: "Saldo das contas" });
    expect(within(saldo).getByText("R$ 432,10")).toBeTruthy();
    expect(within(saldo).getByText("R$ 15.230,90")).toBeTruthy();
    expect(within(saldo).getByText(/A Meta recusou parte da leitura/)).toBeTruthy();
    expect(screen.getByRole("region", { name: "Tendência diária" })).toBeTruthy();
    const tabela = screen.getByRole("region", { name: "Campanhas" });
    expect(within(tabela).getByText("Tráfego | Site", { selector: "span" })).toBeTruthy();
    expect(screen.getAllByRole("article")).toHaveLength(ANUNCIOS_POR_PAGINA);
    fireEvent.click(screen.getByRole("button", { name: /Mostrar mais 3 de 3/ }));
    expect(screen.getAllByRole("article")).toHaveLength(15);
    expect(within(screen.getAllByRole("article")[0]).getAllByText("Visitas à página").length).toBeGreaterThan(0);
    // Evolução e desempenho só carregam quando a equipe abre (tela rápida).
    expect(chamadasDe("evolucao")).toHaveLength(0);
    expect(chamadasDe("desempenho_cliente")).toHaveLength(0);
  });

  it("período de 7 a 90 dias", async () => {
    responder({ conta_ao_vivo: CONTA_V4 });
    expect(PERIODOS_DA_CONTA).toEqual([7, 14, 30, 60, 90]);
    montar(h(AbaConta, {}));
    await screen.findByRole("region", { name: "Resumo do período" });
    fireEvent.click(screen.getByRole("radio", { name: "90 dias" }));
    await waitFor(() => expect(chamadasDe("conta_ao_vivo").some((c) => c.dias === 90)).toBe(true));
  });

  it("evolução: vencedores, descartar com motivo, sinais do público, testes e aprendizados gravados", async () => {
    responder({ conta_ao_vivo: CONTA_V4, evolucao: EVOLUCAO });
    montar(h(AbaConta, {}));
    await screen.findByRole("region", { name: "Resumo do período" });
    fireEvent.click(screen.getByRole("button", { name: "Ler evolução" }));
    const ev = await screen.findByRole("region", { name: "Evolução" });
    await within(ev).findByText(/55% abaixo da média da conta/);
    expect(chamadasDe("evolucao")[0]).toEqual({ acao: "evolucao", client_id: CLIENTE, dias: 14, explicar: false });
    expect(within(ev).getByText(/Gastou R\$ 60,00 sem nenhum/)).toBeTruthy();
    expect(within(ev).getByText(/Pouca curtida e muito comentário/)).toBeTruthy();
    expect(within(ev).getByText("Variar o vencedor \"Peça 1\"")).toBeTruthy();
    expect(within(ev).getByText(/Gravados na memória dos agentes: 1 novo/)).toBeTruthy();
  });

  it("normalizadores tolerantes: resposta velha vira vazio, nunca erro", () => {
    const x = extrasDaConta({ totais: {}, anuncios: [{ nome: "sem id" }] });
    expect(x.contas).toEqual([]);
    expect(x.comparacao).toBeNull();
    expect(x.serie).toEqual([]);
    expect(x.resultado_rotulo).toBe("Resultados");
    const e = normalizarEvolucao({ ok: true });
    expect(e.vencedores).toEqual([]);
    expect(e.explicacao).toBeNull();
    expect(normalizarDesempenho({ ok: true })).toBeNull();
    const d = normalizarDesempenho({ organico: { totais: { interacoes: 5 }, contas: [{ seguidores: 10, seguidores_variacao: 2 }, { seguidores: 5 }] }, anuncios: { totais: { gasto: 3 } }, somado: {} });
    expect(d && d.organico.seguidores).toBe(15);
    expect(d && d.organico.seguidores_variacao).toBe(2);
  });
});

describe("ligar conta de anúncio", () => {
  it("número pelo act_, só dígitos ou link do Gerenciador", () => {
    expect(numeroDaConta("act_123456789")).toBe("123456789");
    expect(numeroDaConta(" 123456789 ")).toBe("123456789");
    expect(numeroDaConta("https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=987654321&nav=x")).toBe("987654321");
    expect(numeroDaConta("abc")).toBeNull();
  });

  it("já ligada devolve a mesma conta, desligada volta a valer, sem erro cru do banco", async () => {
    mock.tabelas.external_accounts = [{ id: "ea-1", client_id: CLIENTE, status: "active" }];
    await expect(connectAdsAccount({ clientId: CLIENTE, actId: "act_123456", displayName: "X" })).resolves.toEqual({ id: "ea-1", situacao: "ja_ligada" });
    mock.tabelas.external_accounts = [{ id: "ea-2", client_id: CLIENTE, status: "inactive" }];
    await expect(connectAdsAccount({ clientId: CLIENTE, actId: "123456", displayName: "X" })).resolves.toEqual({ id: "ea-2", situacao: "reativada" });
    expect(mock.escritas.some((e) => e.op === "update" && (e.valor as any).status === "active")).toBe(true);
  });

  it("conta de outro cliente pede confirmação; confirmada, liga", async () => {
    mock.tabelas.external_accounts = [{ id: "ea-3", client_id: "outro", status: "active" }];
    await expect(connectAdsAccount({ clientId: CLIENTE, actId: "123456", displayName: "X" })).rejects.toBeInstanceOf(ContaDeOutroCliente);
    await expect(connectAdsAccount({ clientId: CLIENTE, actId: "123456", displayName: "X", confirmarOutroCliente: true })).resolves.toEqual({ id: "nova-conta", situacao: "nova" });
  });

  it("a tela de /anuncios pede a leitura na hora e mostra conta sem gasto no hub", () => {
    const tela = readFileSync(resolve(raiz, "src/pages/AdminAds.tsx"), "utf8");
    expect(tela).toContain("await collectAdsMetricsNow();");
    expect(tela).toContain('"Conta ligada · sem gasto nos últimos 30 dias"');
    expect(tela).toContain("A Meta recusou a leitura:");
  });
});

describe("compatibilidade com iPhone e Android antigos nos arquivos novos", () => {
  it("sem lookbehind, \\p{}, grupo nomeado, .at(), Object.hasOwn, aspect-ratio, :has e min()/max()/clamp() em classe", () => {
    for (const arquivo of ["src/components/mesa-ads/contaApi.ts", "src/components/mesa-ads/ContaPaineis.tsx", "src/components/mesa-ads/AbaConta.tsx", "src/hooks/useAdsMetrics.ts"]) {
      const f = readFileSync(resolve(raiz, arquivo), "utf8");
      expect(f, arquivo).not.toMatch(/\(\?<[=!]/);
      expect(f, arquivo).not.toMatch(/\\p\{/);
      expect(f, arquivo).not.toMatch(/\(\?<[a-zA-Z]/);
      expect(f, arquivo).not.toMatch(/\.at\(/);
      expect(f, arquivo).not.toMatch(/Object\.hasOwn\(/);
      expect(f, arquivo).not.toMatch(/aspect-/);
      expect(f, arquivo).not.toMatch(/:has\(/);
      expect(f, arquivo).not.toMatch(/\[(?:min|max|clamp)\(/);
    }
    // Travessão: só nos arquivos novos (os antigos têm comentários de antes da regra).
    for (const arquivo of ["src/components/mesa-ads/contaApi.ts", "src/components/mesa-ads/ContaPaineis.tsx"]) {
      expect(readFileSync(resolve(raiz, arquivo), "utf8"), arquivo).not.toMatch(/[\u2014\u2013]/);
    }
  });
});
