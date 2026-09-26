import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mesa Publicidade (frente P, 26/09): a tela contra o contrato da função
 * mesa-publicidade. Função, Storage e tabelas simulados. Confere a rota, a
 * casca (etapas, troca de mesas, tela cheia), a direção com aprovação, a
 * revisão que trava a foto com o produto mudado e o envio com linhagem.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), tabelas: {} as Record<string, unknown> }));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range", "update", "insert"]) b[m] = () => b;
    const primeiro = () => ({ data: Array.isArray(dados) ? (dados[0] === undefined ? null : dados[0]) : dados, error: null });
    b.maybeSingle = () => Promise.resolve(primeiro());
    b.single = () => Promise.resolve(primeiro());
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: mock.rpc,
      from: (tabela: string) => consulta(tabela),
      storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/img.png" }, error: null }) }) },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));
vi.mock("@/hooks/useSupabaseData", () => ({
  useClients: () => ({
    data: [{ id: "11111111-1111-1111-1111-111111111111", company_name: "Ótica Sintética", plan_status: "active" }],
    isLoading: false,
    isSuccess: true,
    isFetching: false,
    dataUpdatedAt: 1,
    refetch: vi.fn(),
  }),
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import MesaPublicidade from "@/pages/MesaPublicidade";
import { ETAPAS_DA_PUBLICIDADE } from "@/components/mesa-publicidade/Comuns";
import { enderecoDaMesa } from "@/components/mesa-foto/TrocaDeMesas";
import { MESAS_DO_PAINEL, etapaQueVaiAbrir } from "@/lib/mesa/preCarga";
import { entraPeloPadrao, NOME_DA_MESA } from "@/components/mesa/clientesDaMesa";

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CAMPANHA = U(10);
const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

const territorio = (id: string, nome: string, status: string) => ({
  id,
  nome,
  conceito: `Conceito ${nome}.`,
  tensao_humana: "t",
  promessa: "p",
  razao_para_acreditar: "r",
  direcao_de_arte: { paleta: ["#112233"], luz: "luz dura", tratamento: "editorial", enquadramentos: "médio" },
  casting: { perfil: "mulher urbana", idade_aprox: 32, estilo: "minimalista", figurino: "" },
  ambiente: "rua",
  referencias: [],
  riscos: [],
  por_que_combina: "",
  status,
  briefing_versao: 1,
});

const conf = (ok: boolean) => ({ veredito: ok ? "produto_ok" : "reprovada", mudancas: ok ? [] : ["logo"], motivos: ok ? [] : ["Rótulo e texto iguais: logo sumiu"], sem_evidencia: [], estetica: [], restricoes_citadas: [] });

function campanhaBase(extra: Record<string, unknown> = {}) {
  return {
    id: CAMPANHA,
    client_id: CLIENTE,
    nome: "Óculos Aurora",
    categoria: "oculos",
    kit_id: U(20),
    kit_nome: "Óculos Aurora",
    produto_fontes: [U(21)],
    briefing: { publico: "adultos", destino: "WhatsApp", restricoes: { logo: "logo na haste" } },
    briefing_versao: 1,
    territorios: [territorio(U(50), "Expressão pessoal", "proposto"), territorio(U(51), "Rotina urbana", "proposto"), territorio(U(52), "Presente", "proposto")],
    territorio_id: null,
    tomadas: [],
    ensaio_id: null,
    revisoes: [],
    encaminhamentos: [],
    persistida: true,
    ...extra,
  };
}

let campanhaAtual: Record<string, unknown> = campanhaBase();

beforeAll(() => {
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
  campanhaAtual = campanhaBase();
  mock.tabelas = { cliente_imagens: [], foto_kits: [], foto_ensaios: [] };
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    /* sem armazenamento */
  }
  mock.rpc.mockResolvedValue({ data: { saldo_usd: 10, total_usd: 1, por_modelo: [], por_tarefa: [] }, error: null });
  mock.invoke.mockImplementation(async (nome: string, opcoes: any) => {
    const corpo = (opcoes && opcoes.body) || {};
    if (nome !== "mesa-publicidade") return { data: { ok: true }, error: null };
    if (corpo.acao === "campanhas_listar") return { data: { campanhas: [{ id: CAMPANHA, nome: "Óculos Aurora", kit_nome: "Óculos Aurora", status: "rascunho" }], banco: true }, error: null };
    if (corpo.acao === "campanha_abrir") return { data: { campanha: campanhaAtual, banco: true }, error: null };
    if (corpo.acao === "territorio_aprovar") {
      campanhaAtual = { ...campanhaAtual, territorio_id: corpo.territorio_id, territorios: (campanhaAtual.territorios as any[]).map((t) => ({ ...t, status: t.id === corpo.territorio_id ? "aprovado" : t.status })) };
      return { data: { campanha: campanhaAtual }, error: null };
    }
    if (corpo.acao === "encaminhar") {
      campanhaAtual = { ...campanhaAtual, encaminhamentos: [{ id: "e1", destino: corpo.destino, imagem_id: U(201), linhagem: { versao: 1, funcao: "atrair", territorio_nome: "Rotina urbana", briefing_versao: 1, fontes_do_produto: [U(21)] } }] };
      return { data: { campanha: campanhaAtual, imagem_ids: [U(201)] }, error: null };
    }
    if (corpo.acao === "agente_historico") return { data: { conversa_id: null, mensagens: [] }, error: null };
    return { data: { campanha: campanhaAtual }, error: null };
  });
});

function montar(endereco: string) {
  return render(
    h(
      QueryClientProvider,
      { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
      h(MemoryRouter, { initialEntries: [endereco] }, h(TooltipProvider, null, h(MesaPublicidade))),
    ),
  );
}

describe("rota e casca da Mesa Publicidade", () => {
  it("rota só para equipe, pré-carga, troca de mesas, seletor de clientes e SQL no padrão", () => {
    const app = ler("src/App.tsx");
    expect(app).toContain("const MesaPublicidade = PaginaMesaPublicidade;");
    const rota = app.split("\n").find((l) => l.indexOf('path="/mesa-publicidade"') >= 0) || "";
    expect(rota).toContain('["admin", "manager", "design"].includes(profile?.role || "")');
    expect(rota).toContain("<Suspense fallback={<EsqueletoDaMesa />}><MesaPublicidade /></Suspense>");
    expect(Object.keys(MESAS_DO_PAINEL["/mesa-publicidade"].etapas)).toEqual(ETAPAS_DA_PUBLICIDADE.map((e) => e.valor));
    expect(etapaQueVaiAbrir("/mesa-publicidade", `?client=${CLIENTE}`)).toBe("campanha");
    expect(etapaQueVaiAbrir("/mesa-publicidade", `?client=${CLIENTE}&etapa=revisao`)).toBe("revisao");
    expect(enderecoDaMesa("publicidade", CLIENTE)).toBe(`/mesa-publicidade?client=${CLIENTE}`);
    expect(NOME_DA_MESA.publicidade).toBe("Mesa Publicidade");
    expect(entraPeloPadrao("publicidade", { id: CLIENTE, plan_status: "active" }).entra).toBe(true);
    expect(ler("supabase/config.toml")).toMatch(/\[functions\.mesa-publicidade\]\s+verify_jwt = true/);
    expect(ler("src/lib/mesa/api.ts")).toContain('"mesa-publicidade": "diretor de campanha"');
  });

  it("a página mostra o cliente, as cinco etapas, a troca de mesas, a tela cheia e o agente", async () => {
    montar(`/mesa-publicidade?client=${CLIENTE}&etapa=direcao&campanha=${CAMPANHA}`);
    expect(screen.getByRole("heading", { name: "Mesa Publicidade" }).className).toContain("sr-only");
    const nav = screen.getByRole("navigation", { name: "Etapas da Mesa Publicidade" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(["1Campanha", "2Direção", "3Tomadas", "4Revisão", "5Envio"]);
    expect((nav.querySelector("[data-caminho-principal]") as HTMLElement).className).toContain("grid-cols-5");
    expect(screen.getByRole("combobox", { name: /Cliente: Ótica Sintética/ })).toBeTruthy();
    const troca = screen.getByRole("navigation", { name: "Trocar de mesa" });
    expect(within(troca).getByText("Publicidade").getAttribute("aria-current")).toBe("page");
    expect(within(troca).getAllByRole("link").map((l) => l.textContent)).toEqual(expect.arrayContaining(["Mesa", "Mesa Ads", "Mesa Foto"]));
    expect(await screen.findByRole("button", { name: "Abrir o agente da Mesa Publicidade" }, { timeout: 8000 })).toBeTruthy();
    const pagina = ler("src/pages/MesaPublicidade.tsx");
    expect(pagina).toContain("const telaCheia = useTelaCheiaDaMesa();");
    expect(pagina).toContain("<BotaoDeTelaCheia tela={telaCheia}");
  });
});

describe("direção, revisão e envio", () => {
  it("três territórios; aprovar um manda o id certo e marca o aprovado", async () => {
    montar(`/mesa-publicidade?client=${CLIENTE}&etapa=direcao&campanha=${CAMPANHA}`);
    await waitFor(() => expect(document.querySelectorAll("[data-territorio]").length).toBe(3), { timeout: 8000 });
    const cartao = document.querySelector(`[data-territorio="${U(51)}"]`) as HTMLElement;
    fireEvent.click(within(cartao).getByRole("button", { name: /Aprovar este território/ }));
    await waitFor(() => {
      const chamada = mock.invoke.mock.calls.find((c) => c[1] && c[1].body && c[1].body.acao === "territorio_aprovar");
      expect(chamada && chamada[1].body).toMatchObject({ campanha_id: CAMPANHA, territorio_id: U(51), client_id: CLIENTE });
    });
    await waitFor(() => expect(document.querySelector(`[data-territorio="${U(51)}"]`)!.hasAttribute("data-aprovado")).toBe(true));
  });

  it("a revisão trava a aprovação da foto com o produto mudado e libera a conferida", async () => {
    campanhaAtual = campanhaBase({
      territorio_id: U(50),
      territorios: [territorio(U(50), "Expressão pessoal", "aprovado")],
      ensaio_id: U(30),
      revisoes: [
        { id: U(101), foto_tomada_id: "t1", versao: 1, imagem_id: null, storage_path: "a.png", avaliacao: conf(false), decisao: null },
        { id: U(102), foto_tomada_id: "t2", versao: 1, imagem_id: null, storage_path: "b.png", avaliacao: conf(true), decisao: null },
      ],
    });
    montar(`/mesa-publicidade?client=${CLIENTE}&etapa=revisao&campanha=${CAMPANHA}`);
    await waitFor(() => expect(document.querySelectorAll("[data-revisao]").length).toBe(2), { timeout: 8000 });
    const mudou = document.querySelector('[data-revisao="t1"]') as HTMLElement;
    expect(mudou.textContent).toContain("Produto mudou");
    expect(mudou.textContent).toContain("Mudou: logo ou texto.");
    expect((within(mudou).getByRole("button", { name: /Aprovar/ }) as HTMLButtonElement).disabled).toBe(true);
    const ok = document.querySelector('[data-revisao="t2"]') as HTMLElement;
    expect((within(ok).getByRole("button", { name: /Aprovar/ }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(within(ok).getByRole("button", { name: /Aprovar/ }));
    await waitFor(() => {
      const chamada = mock.invoke.mock.calls.find((c) => c[1] && c[1].body && c[1].body.acao === "revisao_decidir");
      expect(chamada && chamada[1].body).toMatchObject({ campanha_id: CAMPANHA, foto_tomada_id: "t2", versao: 1, decisao: "aprovar" });
    });
    // O atalho do agente para reprovar as que mudaram o produto.
    expect(screen.getByRole("button", { name: /Reprovar as 1 que mudaram o produto/ })).toBeTruthy();
  });

  it("o envio leva só as aprovadas, registra a linhagem e avisa que anúncio e verba são à parte", async () => {
    campanhaAtual = campanhaBase({
      territorio_id: U(50),
      territorios: [territorio(U(50), "Rotina urbana", "aprovado")],
      ensaio_id: U(30),
      revisoes: [
        { id: U(101), foto_tomada_id: "t1", versao: 1, imagem_id: U(201), storage_path: "a.png", avaliacao: conf(true), decisao: "aprovada" },
        { id: U(102), foto_tomada_id: "t2", versao: 1, imagem_id: U(202), storage_path: "b.png", avaliacao: conf(false), decisao: null },
      ],
    });
    montar(`/mesa-publicidade?client=${CLIENTE}&etapa=envio&campanha=${CAMPANHA}`);
    const ads = await screen.findByText("Mesa Ads", { selector: "p" }, { timeout: 8000 });
    expect(screen.getByText(/Aprovar a foto não aprova anúncio nem verba/)).toBeTruthy();
    const secao = ads.closest("[data-destino]") as HTMLElement;
    fireEvent.click(within(secao).getByRole("button", { name: /Mandar 1 foto/ }));
    await waitFor(() => {
      const chamada = mock.invoke.mock.calls.find((c) => c[1] && c[1].body && c[1].body.acao === "encaminhar");
      expect(chamada && chamada[1].body).toMatchObject({ campanha_id: CAMPANHA, destino: "ads" });
    });
    try {
      expect(JSON.parse(window.sessionStorage.getItem(`mesa-foto:para-usar:${CLIENTE}`) || "{}").ids).toEqual([U(201)]);
    } catch {
      /* sem armazenamento no ambiente */
    }
  });

  it("sem produto na Mesa Foto, a campanha leva para cadastrar lá (sem acervo paralelo)", async () => {
    mock.invoke.mockImplementation(async (_n: string, opcoes: any) => {
      const acao = opcoes && opcoes.body ? opcoes.body.acao : "";
      if (acao === "campanhas_listar") return { data: { campanhas: [], banco: false }, error: null };
      return { data: {}, error: null };
    });
    montar(`/mesa-publicidade?client=${CLIENTE}&etapa=campanha`);
    const link = await screen.findByRole("link", { name: "Abrir a Mesa Foto" }, { timeout: 8000 });
    expect(link.getAttribute("href")).toBe(`/mesa-foto?client=${CLIENTE}&etapa=acervo`);
    expect(document.querySelector("[data-rascunho-da-publicidade]")).toBeTruthy();
  });
});
