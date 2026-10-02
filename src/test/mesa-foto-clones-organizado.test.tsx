import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Aba Clones organizada (pedido do dono, 02/10: "gosto; organizar: as fotos
 * de antes num bloco compacto, a visualização do resultado maior, os clones
 * já feitos e as variações bem organizados"; e "toda lista rola na própria
 * área, nunca a página"). A função é simulada.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), tabelas: {} as Record<string, unknown>, toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));

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
vi.mock("sonner", () => ({ toast: mock.toast }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));
vi.mock("@/hooks/useSupabaseData", () => ({
  useClients: () => ({ data: [{ id: "11111111-1111-1111-1111-111111111111", company_name: "Loja Sintética" }], isLoading: false, isSuccess: true, isFetching: false, dataUpdatedAt: 1, refetch: vi.fn() }),
}));

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import { MesaFotoProvider, type MesaFotoValor } from "@/components/mesa-foto/Comuns";
import EtapaClones from "@/components/mesa-foto/EtapaClones";
import { esquecerTodosOsLotes } from "@/components/mesa-foto/lote";
import { rolagemPresaNoCelular } from "@/components/sistema/regras";

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const CL = "dddddddd-0000-4000-8000-000000000001";
const CL2 = "dddddddd-0000-4000-8000-000000000002";
const F1 = "aaaaaaaa-0000-4000-8000-000000000001";
const F2 = "aaaaaaaa-0000-4000-8000-000000000002";
const VA = "aaaaaaaa-0000-4000-8000-00000000000a";
const VB = "aaaaaaaa-0000-4000-8000-00000000000b";
const V1 = "eeeeeeee-0000-4000-8000-000000000001";

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Loja Sintética",
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

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(QueryClientProvider, { client: qc }, h(MemoryRouter, { initialEntries: [`/mesa-foto?client=${CLIENTE}`] }, h(TooltipProvider, null, h(MesaProvider, { valor: valorDaMesa(), children: h(MesaFotoProvider, { valor: valorDaFoto(), children: h(EtapaClones) }) })))),
  );
}

const fotoBruta = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  client_id: CLIENTE,
  nome: `foto-${id.slice(-1)}.jpg`,
  storage_bucket: "mesa",
  storage_path: `${CLIENTE}/foto/originais/${id}.jpg`,
  origem: "mesa_foto",
  tags: [],
  ativa: true,
  largura: 1200,
  altura: 1600,
  criado_em: "2026-09-24T10:00:00Z",
  ...extra,
});
const variacao = (id: string, nome: string) => fotoBruta(id, { nome, gerada: true, modo: "clone", tags: [`clone:${CL}`], storage_path: `${CLIENTE}/foto/gerada/${id}.png` });

const AUT = { confirmada: true, quem: "Paula", data: "2026-09-20", forma: "termo_assinado", finalidade: "posts da clínica", sabe_que_e_ia: true, adulta: true };
const cloneBruto = (extra: Record<string, unknown> = {}) => ({
  id: CL,
  client_id: CLIENTE,
  nome: "Dra. Paula",
  status: "folha",
  versao: 1,
  invariantes: [],
  motor_preferido_id: null,
  identidade_real: [
    { imagem_id: F1, principal: true },
    { imagem_id: F2, principal: false },
  ],
  autorizacao: AUT,
  ...extra,
});
const cloneLido = () => ({
  clone: cloneBruto(),
  autorizacao_valida: { ok: true, motivo: null },
  reais: [
    { ...fotoBruta(F1, { nome: "paula-frente.jpg" }), principal: true },
    { ...fotoBruta(F2, { nome: "paula-lado.jpg" }), principal: false },
  ],
  imagens: [{ id: V1, modelo_id: CL, papel: "vista", vista: "frente", storage_bucket: "mesa", storage_path: `${CLIENTE}/foto/clones/${CL}/frente.png`, aprovada: true, fontes: [{ tipo: "foto_real", id: F1 }] }],
  arquivadas: [],
  folha: { vistas: [], aprovadas: 1, total: 6, pronto: false, frente_aprovada: true },
  // A mais nova primeiro (como a função devolve).
  variacoes: [variacao(VB, "Paula no café"), variacao(VA, "Paula na rua")],
  variacoes_arquivadas: [],
  motores: [{ modelo_imagem_id: "openrouter:google/gemini-3-pro-image", rotulo: "Nano Banana Pro 2K", nota: "", padrao: true, disponivel: true, estimativa_usd: 0.14 }],
  presets: [],
});

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
  esquecerTodosOsLotes();
  mock.tabelas = {
    cliente_imagens: [fotoBruta(F1, { nome: "paula-frente.jpg" }), fotoBruta(F2, { nome: "paula-lado.jpg" }), variacao(VB, "Paula no café"), variacao(VA, "Paula na rua")],
  };
  const respostas: Record<string, unknown> = {
    clones_listar: {
      clones: [
        { ...cloneBruto(), capa_url: null, autorizacao_valida: { ok: true, motivo: null } },
        { ...cloneBruto({ id: CL2, nome: "Seu Carlos", status: "rascunho" }), capa_url: null, autorizacao_valida: { ok: true, motivo: null } },
      ],
    },
    clone_ler: cloneLido(),
  };
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    /* sem armazenamento */
  }
  mock.rpc.mockResolvedValue({ data: { saldo_usd: 12.5, total_usd: 3.2, por_modelo: [], por_tarefa: [] }, error: null });
  mock.invoke.mockImplementation(async (_nome: string, opcoes: any) => {
    const acao = opcoes && opcoes.body ? opcoes.body.acao : "";
    if (respostas[acao] !== undefined) return { data: respostas[acao], error: null };
    return { data: { ok: true, custo_usd: 0 }, error: null };
  });
});

const esperar = async (seletor: string, cond: (el: HTMLElement) => boolean = () => true) =>
  (await waitFor(() => {
    const el = document.querySelector(seletor) as HTMLElement | null;
    if (!el || !cond(el)) throw new Error(`sem ${seletor}`);
    return el;
  })) as HTMLElement;

describe("02/10: Clones organizados", () => {
  it("clones já feitos numa faixa no topo, com estado e quantas variações; o aberto em destaque e a faixa rola de lado", async () => {
    montar();
    const faixa = await esperar("[data-faixa-de-clones]", (el) => !!el.querySelector(`[data-item-do-clone="${CL2}"]`));
    const lista = faixa.querySelector("[data-lista-de-clones]") as HTMLElement;
    expect(lista.className).toMatch(/overflow-x-auto/);
    expect(lista.className).toMatch(/scrollbar-hidden/);
    const paula = within(faixa).getByRole("button", { name: "Abrir Dra. Paula" });
    await waitFor(() => expect(paula.getAttribute("aria-pressed")).toBe("true"));
    await waitFor(() => expect(paula.textContent).toMatch(/2 variações/));
    expect(within(faixa).getByRole("button", { name: "Abrir Seu Carlos" }).getAttribute("aria-pressed")).toBe("false");
    // A faixa recolhe pelo título, deixando à vista só o nome do aberto.
    fireEvent.click(within(faixa).getByRole("button", { name: /Clones/ }));
    expect(faixa.getAttribute("data-recolhido")).toBe("sim");
    expect(faixa.querySelector("[data-lista-de-clones]")).toBeNull();
  });

  it("antes: as fotos reais num bloco compacto (miniaturas pequenas numa linha), que recolhe", async () => {
    montar();
    const antes = await esperar("[data-antes-compacto]", (el) => !!el.querySelector(`[data-foto-real="${F2}"]`));
    const fotos = antes.querySelectorAll("[data-foto-real]");
    expect(fotos).toHaveLength(2);
    const linha = antes.querySelector('ul[aria-label="Fotos de origem"]') as HTMLElement;
    expect(linha.className).toMatch(/\bflex\b/);
    expect(linha.className).not.toMatch(/grid-cols/);
    fotos.forEach((li) => expect((li as HTMLElement).className).toMatch(/\bw-16\b/));
    expect(within(antes).getByRole("button", { name: "Adicionar foto de origem" })).toBeTruthy();
    fireEvent.click(within(antes).getByRole("button", { name: /Antes/ }));
    expect(antes.getAttribute("data-recolhido")).toBe("sim");
    expect(antes.querySelector("[data-foto-real]")).toBeNull();
    expect(antes.textContent).toMatch(/2 de 4 fotos reais/);
  });

  it("resultado grande: a variação mais nova inteira (sem corte), com as ações dela; escolher outra na galeria troca", async () => {
    montar();
    const grande = await esperar("[data-resultado-grande]", (el) => el.getAttribute("data-resultado-grande") === VB);
    await waitFor(() => expect(grande.querySelector("img")).toBeTruthy());
    expect((grande.querySelector("img") as HTMLElement).className).toMatch(/!object-contain/);
    expect(grande.querySelector(`[data-variacao-aberta="${VB}"]`)).toBeTruthy();
    expect(within(grande).getByRole("button", { name: /Baixar original/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Abrir: Paula na rua" }));
    await waitFor(() => expect(document.querySelector("[data-resultado-grande]")!.getAttribute("data-resultado-grande")).toBe(VA));
    expect(screen.getByRole("button", { name: "Abrir: Paula na rua" }).getAttribute("aria-pressed")).toBe("true");

    // Uma vista da folha também fica grande, com as ações de vista.
    fireEvent.click(screen.getByRole("button", { name: "Ver a vista Frente" }));
    await waitFor(() => expect(document.querySelector("[data-resultado-grande]")!.getAttribute("data-resultado-grande")).toBe(V1));
    expect(document.querySelector(`[data-resultado-grande] [data-vista-aberta="${V1}"]`)).toBeTruthy();
  });

  it("variações agrupadas por tipo, com cabeçalho curto, numa galeria que rola por dentro (nunca a página)", async () => {
    montar();
    const galeria = await esperar("[data-galeria-do-clone]", (el) => !!el.querySelector(`[data-variacao-do-clone="${VA}"]`));
    expect(galeria.className).toMatch(/overflow-y-auto/);
    expect(galeria.className).toMatch(/scrollbar-hidden/);
    // A regra da casa: nada de rolagem presa no celular (lá a lista rola de lado).
    expect(rolagemPresaNoCelular(galeria.className)).toBe(false);
    const variacoes = galeria.querySelector('[data-grupo-da-galeria="variacoes"]') as HTMLElement;
    expect(variacoes.textContent).toMatch(/Variações · 2/);
    const lista = variacoes.querySelector("[data-lista-de-variacoes]") as HTMLElement;
    expect(lista.className).toMatch(/overflow-x-auto/);
    expect(lista.querySelectorAll("[data-variacao-do-clone]")).toHaveLength(2);
    const folha = await waitFor(() => {
      const el = galeria.querySelector('[data-grupo-da-galeria="folha"]') as HTMLElement | null;
      if (!el) throw new Error("sem a folha na galeria");
      return el;
    });
    expect(folha.textContent).toMatch(/Folha · 1 de 6 aprovadas/);
    expect(folha.querySelector(`[data-vista-na-galeria="${V1}"]`)).toBeTruthy();
    // Cada variação na galeria leva o menu (gerar de novo, apagar) e a marcação para baixar.
    expect(within(lista).getByRole("button", { name: "Mais opções: Paula na rua" })).toBeTruthy();
    fireEvent.click(within(lista).getByLabelText("Marcar Paula na rua"));
    expect(within(variacoes).getByRole("button", { name: /Baixar 1/ })).toBeTruthy();
  });

  it("o arquivo segue as regras da casa (sem travessão, sem CSS moderno)", () => {
    const t = readFileSync(resolve(process.cwd(), "src/components/mesa-foto/EtapaClones.tsx"), "utf8");
    expect(t).not.toMatch(/[—–]/);
    expect(t).not.toMatch(/aspect-ratio|:has\(|\.at\(|Object\.hasOwn|\(\?<[=!a-z]|\\p\{/);
    expect(t).not.toMatch(/\[(?:min|max|clamp)\(/);
    expect(t).toContain("data-antes-compacto");
    expect(t).toContain("data-resultado-grande");
  });
});
