import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Modelos, item 10 do dono (02/10): a folha das 6 vistas com a pessoa
 * EXATAMENTE igual, a folha aprovada como referência em toda geração seguinte
 * e a grade de cartões com "Usar como modelo" e "Combinar com produto".
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  tabelas: {} as Record<string, unknown>,
  gravar: vi.fn(),
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
      rpc: () => Promise.resolve({ data: { saldo_usd: 10 }, error: null }),
      from: (tabela: string) => consulta(tabela),
      storage: {
        from: () => ({
          createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/img.png" }, error: null }),
          createSignedUrls: () => Promise.resolve({ data: [], error: null }),
        }),
      },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));
vi.mock("@/components/mesa-foto/escolhasDaLinha", async (original) => ({
  ...(await original<typeof import("@/components/mesa-foto/escolhasDaLinha")>()),
  gravarModeloEscolhido: mock.gravar,
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import { MesaFotoProvider, type MesaFotoValor } from "@/components/mesa-foto/Comuns";
import EtapaModelos from "@/components/mesa-foto/EtapaModelos";
import { personaUsavelNaTela, progressoDasFolhas, VISTAS_DA_FOLHA } from "@/components/mesa-foto/modelosApi";
import {
  descricaoDaFicha,
  FOLHA_PADRAO,
  fichaEmTexto,
  identidadesDaVista,
  invariantesDaFicha,
  normalizarFicha,
  promptDaVista,
  promptDoDetalhe,
  resumoDaFolha,
  statusDaPersona,
  TETO_IDENTIDADES_DA_FOLHA,
  VISTAS_PARA_PRONTA,
} from "../../supabase/functions/mesa-foto/personas";
import {
  FOLHA_DAS_6_VISTAS,
  REGRAS_DA_FOLHA,
  REGRAS_DE_IDENTIDADE,
  textoDeIdentidadeParaGeracao,
} from "../../supabase/functions/mesa-foto/modelos-folha";

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const KIT = "bbbbbbbb-0000-4000-8000-000000000001";
const P1 = "dddddddd-0000-4000-8000-000000000001";
const P2 = "dddddddd-0000-4000-8000-000000000002";
const A1 = "eeeeeeee-0000-4000-8000-000000000001";
const A2 = "eeeeeeee-0000-4000-8000-000000000002";

const fichaBase = { idade_aparente: 29, genero_apresentado: "feminino", tom_de_pele: "morena clara", rosto: "oval", cabelo: { cor: "castanho", comprimento: "ombro", textura: "ondulado" }, marcas: ["pinta no queixo"] };

// ------------------------------------------------------------------ função: folha e identidade

describe("folha das 6 vistas: a lista canônica", () => {
  it("a folha é frente, 3/4 esquerda, 3/4 direita, perfil, meio corpo e corpo inteiro, igual na função e na tela", () => {
    const canonica = ["frente", "tres_quartos_esq", "tres_quartos_dir", "perfil_esq", "meio_corpo", "corpo_inteiro"];
    expect([...FOLHA_DAS_6_VISTAS]).toEqual(canonica);
    expect(FOLHA_PADRAO).toEqual(canonica);
    expect(VISTAS_DA_FOLHA.map((v) => v.valor)).toEqual(canonica);
    // Pronta = as 6 aprovadas (uma por vista); antes bastavam 3.
    expect(VISTAS_PARA_PRONTA).toBe(6);
    const vistas = (aprovadas: string[]) => aprovadas.map((v, i) => ({ id: `v${i}`, papel: "vista", vista: v, aprovada: true }));
    expect(statusDaPersona({ status: "folha", ancora_imagem_id: "a" }, vistas(canonica))).toBe("pronta");
    expect(statusDaPersona({ status: "folha", ancora_imagem_id: "a" }, vistas(["frente", "frente", "perfil_esq", "meio_corpo", "maos", "perfil_dir"]))).toBe("folha");
    expect(resumoDaFolha(vistas(["frente", "frente", "perfil_esq"])).aprovadas).toBe(2);
  });
});

describe("identidade travada nos prompts da função", () => {
  const f = normalizarFicha(fichaBase);
  const inv = invariantesDaFicha(f);

  it("toda vista da folha leva as regras de identidade, as regras da folha e a posição na folha", () => {
    const p = promptDaVista({ nome: "Marina", ficha: f, invariantes: inv, vista: "tres_quartos_esq", identidades: ["âncora da persona", "vista aprovada da folha"] });
    expect(p).toContain('IDENTIDADE TRAVADA da persona "Marina"');
    for (const r of REGRAS_DE_IDENTIDADE) expect(p).toContain(r);
    for (const r of REGRAS_DA_FOLHA) expect(p).toContain(r);
    expect(p).toContain("mesma geometria do rosto");
    expect(p).toContain("mesmo tom e subtom de pele");
    expect(p).toContain("mesmas proporções do corpo");
    expect(p).toContain("nada de embelezar");
    expect(p).toContain("sem semelhança com nenhuma pessoa real");
    expect(p).toContain("só o ângulo e a distância da câmera mudam");
    expect(p).toContain("fundo neutro liso claro");
    expect(p).toContain("vista 2 de 6 da folha");
    expect(p).toContain("Imagem 1: âncora da persona. IDENTIDADE da persona");
    expect(p).toContain("Imagem 2: vista aprovada da folha. IDENTIDADE da persona");
    expect(p).not.toMatch(/[—–]/);
  });

  it("detalhe 4K e as gerações seguintes (Canvas, Book pela fichaEmTexto) repetem a identidade travada", () => {
    expect(promptDoDetalhe({ alvo: "pessoa", nome: "Marina", ficha: f, invariantes: inv, comIdentidade: 2 })).toContain('IDENTIDADE TRAVADA da persona "Marina"');
    expect(fichaEmTexto(f)).toMatch(/^Pessoa adulta de 29 anos de idade aparente/);
    expect(fichaEmTexto(f)).toContain("Identidade travada: sempre esta mesma pessoa");
    expect(descricaoDaFicha(f)).not.toContain("Identidade travada");
    const persona = textoDeIdentidadeParaGeracao({ nome: "Marina", invariantes: ["pinta no queixo"], tipo: "persona" });
    expect(persona).toContain('a persona sintética "Marina"');
    expect(persona).toContain("pinta no queixo");
    expect(persona).toContain("pessoa adulta sintética");
    const clone = textoDeIdentidadeParaGeracao({ nome: "Dra. Paula", invariantes: [], tipo: "clone" });
    expect(clone).toContain('a pessoa real "Dra. Paula"');
    expect(clone).toContain("com autorização registrada");
    expect(clone).not.toContain("TRAÇOS QUE NÃO MUDAM");
  });

  it("a folha aprovada vai como referência: âncora, uma imagem por vista, as 6 da folha antes das extras, até o teto", () => {
    const ancora = { id: "a", papel: "candidata", vista: null, aprovada: true };
    const imgs = [
      ancora,
      { id: "f-velha", papel: "vista", vista: "frente", aprovada: true },
      { id: "f-nova", papel: "vista", vista: "frente", aprovada: true },
      { id: "maos", papel: "vista", vista: "maos", aprovada: true },
      { id: "p", papel: "vista", vista: "perfil_esq", aprovada: true },
      { id: "q", papel: "vista", vista: "tres_quartos_dir", aprovada: true },
      { id: "m", papel: "vista", vista: "meio_corpo", aprovada: true },
      { id: "r", papel: "vista", vista: "tres_quartos_esq", aprovada: false },
    ];
    const naFolha = identidadesDaVista(ancora, imgs, "frente", 16, TETO_IDENTIDADES_DA_FOLHA).map((i) => i.id);
    expect(naFolha[0]).toBe("a");
    expect(naFolha).toHaveLength(5);
    expect(naFolha).toContain("f-nova");
    expect(naFolha).not.toContain("f-velha");
    expect(naFolha).not.toContain("maos");
    expect(naFolha).not.toContain("r");
    // No uso (Canvas, Book): até 4 e nunca além do limite do gerador.
    expect(identidadesDaVista(ancora, imgs, "frente", 16)).toHaveLength(4);
    expect(identidadesDaVista(ancora, imgs, "frente", 2).map((i) => i.id)).toEqual(["a", "f-nova"]);
  });
});

// ------------------------------------------------------------------ tela: grade de cartões

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Ótica Sintética",
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

function montar(foto: Partial<MesaFotoValor>) {
  const valorDaFoto: MesaFotoValor = {
    kitId: null,
    ensaioId: null,
    imagemId: null,
    escolherKit: vi.fn(),
    escolherEnsaio: vi.fn(),
    irPara: vi.fn(),
    selecionadas: [],
    setSelecionadas: vi.fn(),
    abrirAgente: vi.fn(),
    ...foto,
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(
      QueryClientProvider,
      { client: qc },
      h(
        MemoryRouter,
        { initialEntries: [`/mesa-foto?client=${CLIENTE}`] },
        h(TooltipProvider, null, h(MesaProvider, { valor: valorDaMesa(), children: h(MesaFotoProvider, { valor: valorDaFoto, children: h(EtapaModelos) }) })),
      ),
    ),
  );
}

const imagem = (id: string, modelo: string, extra: Record<string, unknown> = {}) => ({
  id,
  modelo_id: modelo,
  papel: "candidata",
  storage_bucket: "mesa",
  storage_path: `${CLIENTE}/foto/modelos/${modelo}/${id}.png`,
  largura: 1088,
  altura: 1360,
  criado_em: "2026-10-02T10:00:00Z",
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    /* sem armazenamento */
  }
  mock.invoke.mockResolvedValue({ data: { ok: true, custo_usd: 0 }, error: null });
  mock.tabelas = {
    foto_modelos: [
      { id: P1, client_id: CLIENTE, nome: "Marina", ficha: fichaBase, invariantes: [], status: "folha", ancora_imagem_id: A1, motor_preferido_id: "openrouter:openai/gpt-image-2.5-sunburst", versao: 2, etica: { sintetica: true }, atualizado_em: "2026-10-02T10:00:00Z" },
      { id: P2, client_id: null, nome: "Rafa", ficha: { ...fichaBase, genero_apresentado: "masculino" }, invariantes: [], status: "pronta", ancora_imagem_id: A2, motor_preferido_id: "openrouter:openai/gpt-image-2.5-sunburst", versao: 1, etica: { sintetica: true }, atualizado_em: "2026-10-01T10:00:00Z" },
    ],
    foto_modelo_imagens: [
      imagem(A1, P1, { aprovada: true }),
      imagem(A2, P2, { aprovada: true }),
      ...["frente", "tres_quartos_esq", "perfil_esq", "meio_corpo"].map((v) => imagem(`p1-${v}`, P1, { papel: "vista", vista: v, aprovada: true })),
      ...FOLHA_PADRAO.map((v) => imagem(`p2-${v}`, P2, { papel: "vista", vista: v, aprovada: true })),
    ],
    cliente_imagens: [],
  };
});

describe("aba Modelos: grade de cartões com Usar como modelo e Combinar com produto", () => {
  it("progresso e uso pela tela: 4 de 6 vistas e persona com âncora usável", () => {
    expect(progressoDasFolhas([P1, P2], mock.tabelas.foto_modelo_imagens as any[])).toEqual({ [P1]: 4, [P2]: 6 });
    expect(personaUsavelNaTela({ status: "folha", ancora_imagem_id: A1 })).toBe(true);
    expect(personaUsavelNaTela({ status: "candidatos", ancora_imagem_id: null })).toBe(false);
    expect(personaUsavelNaTela({ status: "arquivada", ancora_imagem_id: A1 })).toBe(false);
  });

  it("mostra um cartão por persona com o progresso da folha, e Usar como modelo grava a escolha e abre a Foto com modelo", async () => {
    const irPara = vi.fn();
    const escolherObjetivo = vi.fn();
    montar({ irPara, escolherObjetivo });
    const lista = await screen.findByRole("list", { name: "Lista de personas" });
    await waitFor(() => expect(lista.querySelectorAll("[data-cartao-da-persona]").length).toBe(2));
    const cartao1 = lista.querySelector(`[data-persona="${P1}"]`) as HTMLElement;
    const cartao2 = lista.querySelector(`[data-persona="${P2}"]`) as HTMLElement;
    expect(within(cartao1).getByText("Marina")).toBeTruthy();
    expect(within(cartao2).getByText("Rafa")).toBeTruthy();
    await waitFor(() => expect(within(cartao1).getByText("4 de 6 vistas")).toBeTruthy());
    expect(within(cartao2).getByText("6 de 6 vistas")).toBeTruthy();
    expect(within(cartao2).getByText(/da agência/)).toBeTruthy();

    fireEvent.click(within(cartao2).getByRole("button", { name: /Usar como modelo/ }));
    expect(mock.gravar).toHaveBeenCalledWith(CLIENTE, { tipo: "persona", id: P2, nome: "Rafa" });
    expect(escolherObjetivo).toHaveBeenCalledWith("modelo");
    expect(irPara).toHaveBeenCalledWith("campanha");

    // Sem produto escolhido, Combinar com produto abre a Foto com modelo mesmo assim (lá tem o seletor de produto).
    fireEvent.click(within(cartao1).getByRole("button", { name: /Combinar com produto/ }));
    expect(mock.gravar).toHaveBeenLastCalledWith(CLIENTE, { tipo: "persona", id: P1, nome: "Marina" });
    expect(irPara).toHaveBeenLastCalledWith("campanha");
  });

  it("Combinar com produto leva o produto escolhido junto; a persona aberta mostra a faixa das 6 vistas", async () => {
    const irPara = vi.fn();
    montar({ irPara, kitId: KIT });
    const lista = await screen.findByRole("list", { name: "Lista de personas" });
    await waitFor(() => expect(lista.querySelector(`[data-persona="${P1}"]`)).toBeTruthy());
    fireEvent.click(within(lista.querySelector(`[data-persona="${P1}"]`) as HTMLElement).getByRole("button", { name: /Combinar com produto/ }));
    expect(irPara).toHaveBeenCalledWith("campanha", { kit: KIT });
    // A primeira persona abre sozinha, com a folha como faixa de 6 espaços.
    fireEvent.click(await screen.findByRole("button", { name: "Vistas do modelo" }));
    const faixa = await screen.findByRole("list", { name: "Vistas da folha" });
    expect(faixa.querySelectorAll("[data-vista]").length).toBe(6);
    await waitFor(() => expect(document.querySelector("[data-folha-aprovada]")?.getAttribute("data-folha-aprovada")).toBe("4"));
    // Os dois espaços vazios têm o botão de gerar com custo.
    const vazias = ["tres_quartos_dir", "corpo_inteiro"].map((v) => faixa.querySelector(`[data-vista="${v}"]`) as HTMLElement);
    vazias.forEach((li) => expect(within(li).getByRole("button", { name: /Gerar/ })).toBeTruthy());
  });
});
