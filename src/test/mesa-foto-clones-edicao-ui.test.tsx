import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Aba Clones editável depois de criada (pedido do dono, 25/09 à noite):
 * fotos de origem com x, trocar, + e estrela; folha "feita com as fotos
 * antigas" com "Gerar de novo com as fotos novas"; gerar de novo escolhendo
 * as fotos; apagar vista, variação e clone (arquivar, com desfazer e
 * Arquivados); duplicar mantendo fotos e autorização. A função é simulada.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), upload: vi.fn(), rpc: vi.fn(), tabelas: {} as Record<string, unknown>, toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));

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
vi.mock("sonner", () => ({ toast: mock.toast }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));
vi.mock("@/hooks/useSupabaseData", () => ({
  useClients: () => ({ data: [{ id: "11111111-1111-1111-1111-111111111111", company_name: "Loja Sintética" }], isLoading: false, isSuccess: true, isFetching: false, dataUpdatedAt: 1, refetch: vi.fn() }),
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import type { ModeloIa } from "@/lib/mesa/api";
import { MesaFotoProvider, type MesaFotoValor } from "@/components/mesa-foto/Comuns";
import EtapaClones from "@/components/mesa-foto/EtapaClones";
import { esquecerTodosOsLotes } from "@/components/mesa-foto/lote";

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const CL = "dddddddd-0000-4000-8000-000000000001";
const CL2 = "dddddddd-0000-4000-8000-000000000002";
const F1 = "aaaaaaaa-0000-4000-8000-000000000001";
const F2 = "aaaaaaaa-0000-4000-8000-000000000002";
const F4 = "aaaaaaaa-0000-4000-8000-000000000004";
const V1 = "eeeeeeee-0000-4000-8000-000000000001";
const VAR = "aaaaaaaa-0000-4000-8000-000000000009";

const catalogo: ModeloIa[] = [
  { id: "openai:gpt-texto", provedor: "openai", modelo_api: "gpt-texto", tipo: "texto", rotulo: "Texto", preco_entrada_1m: 1, preco_saida_1m: 2, preco_cache_1m: null, preco_imagem: null, raciocinio: [], padrao_para: ["leitura", "diretor_arte"], ativo: true },
  { id: "openai:gpt-image-2", provedor: "openai", modelo_api: "gpt-image-2", tipo: "imagem", rotulo: "Imagem", preco_entrada_1m: null, preco_saida_1m: null, preco_cache_1m: null, preco_imagem: { baixa: 0.01, media: 0.04, alta: 0.17 }, raciocinio: [], padrao_para: ["imagem"], ativo: true },
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

function montar(foto: Partial<MesaFotoValor> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(QueryClientProvider, { client: qc }, h(MemoryRouter, { initialEntries: [`/mesa-foto?client=${CLIENTE}`] }, h(TooltipProvider, null, h(MesaProvider, { valor: valorDaMesa(), children: h(MesaFotoProvider, { valor: valorDaFoto(foto), children: h(EtapaClones) }) })))),
  );
}

const chamadasDe = (acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[0] === "mesa-foto" && c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);

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
const vistaBruta = (id: string, vista: string, extra: Record<string, unknown> = {}) => ({ id, modelo_id: CL, papel: "vista", vista, storage_bucket: "mesa", storage_path: `${CLIENTE}/foto/clones/${CL}/${vista}.png`, aprovada: true, fontes: [{ tipo: "foto_real", id: F1 }], ...extra });
const cloneLido = (extra: Record<string, unknown> = {}) => ({
  clone: cloneBruto(),
  autorizacao_valida: { ok: true, motivo: null },
  reais: [
    { ...fotoBruta(F1, { nome: "paula-frente.jpg" }), principal: true },
    { ...fotoBruta(F2, { nome: "paula-lado.jpg" }), principal: false },
  ],
  imagens: [],
  arquivadas: [],
  folha: { vistas: [], aprovadas: 0, total: 6, pronto: false, frente_aprovada: false },
  variacoes: [],
  variacoes_arquivadas: [],
  motores: [{ modelo_imagem_id: "openrouter:google/gemini-3-pro-image", rotulo: "Nano Banana Pro 2K", nota: "", padrao: true, disponivel: true, estimativa_usd: 0.14 }],
  presets: [],
  ...extra,
});

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
  esquecerTodosOsLotes();
  mock.tabelas = { cliente_imagens: [fotoBruta(F1, { nome: "paula-frente.jpg" }), fotoBruta(F2, { nome: "paula-lado.jpg" }), fotoBruta(F4, { nome: "paula-rua.jpg" })] };
  respostas = { clones_listar: { clones: [{ ...cloneBruto(), capa_url: null, autorizacao_valida: { ok: true, motivo: null } }] }, clone_ler: cloneLido() };
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

/** Clica e, se o botão pedir o segundo clique (sem estimativa ou caro), clica de novo. */
async function clicarComCusto(botao: HTMLElement, acao: string) {
  fireEvent.click(botao);
  await new Promise((r) => setTimeout(r, 30));
  if (!chamadasDe(acao).length) fireEvent.click(botao);
  await waitFor(() => expect(chamadasDe(acao).length).toBeGreaterThan(0));
}

const faixa = async () =>
  (await waitFor(() => {
    const el = document.querySelector("[data-faixa-de-origem]");
    if (!el || !el.querySelector(`[data-foto-real="${F2}"]`)) throw new Error("sem a faixa");
    return el as HTMLElement;
  })) as HTMLElement;

describe("fotos de origem editáveis depois de criado", () => {
  it("tirar uma foto e marcar outra como principal: só salva quando a equipe confirma", async () => {
    respostas.clone_fotos_editar = { clone: cloneBruto({ identidade_real: [{ imagem_id: F2, principal: true }] }), desatualizadas: [], avisos: [] };
    montar();
    const f = await faixa();
    expect(chamadasDe("clone_fotos_editar")).toHaveLength(0);
    const primeira = f.querySelector(`[data-foto-real="${F1}"]`) as HTMLElement;
    fireEvent.click(within(primeira).getByRole("button", { name: "Tirar a foto" }));
    // Com uma só, o x fica travado (o clone precisa de pelo menos 1 foto).
    const segunda = f.querySelector(`[data-foto-real="${F2}"]`) as HTMLElement;
    expect((within(segunda).getByRole("button", { name: "Tirar a foto" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/1 sai, principal nova/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Salvar fotos/ }));
    await waitFor(() => expect(chamadasDe("clone_fotos_editar")).toHaveLength(1));
    expect(chamadasDe("clone_fotos_editar")[0]).toEqual({ acao: "clone_fotos_editar", modelo_id: CL, imagem_ids: [F2], principal_id: F2 });
  });

  it("adicionar pelo +: escolhe no acervo e salva com a foto nova", async () => {
    respostas.clone_fotos_editar = { clone: cloneBruto({ identidade_real: [{ imagem_id: F1, principal: true }, { imagem_id: F2, principal: false }, { imagem_id: F4, principal: false }] }), desatualizadas: [V1], avisos: [] };
    montar();
    await faixa();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar foto de origem" }));
    fireEvent.click(await screen.findByRole("button", { name: "paula-rua.jpg" }));
    fireEvent.click(screen.getByRole("button", { name: /Usar 1 foto/ }));
    expect(await screen.findByText(/1 entra/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Salvar fotos/ }));
    await waitFor(() => expect(chamadasDe("clone_fotos_editar")).toHaveLength(1));
    expect(chamadasDe("clone_fotos_editar")[0].imagem_ids).toEqual([F1, F2, F4]);
    await waitFor(() => expect(mock.toast.success).toHaveBeenCalledWith("Fotos de origem salvas", expect.anything()));
  });

  it("trocar: a foto escolhida entra no lugar da outra (mesmo com o limite cheio)", async () => {
    respostas.clone_fotos_editar = { clone: cloneBruto(), desatualizadas: [], avisos: [] };
    montar();
    const f = await faixa();
    fireEvent.click(within(f.querySelector(`[data-foto-real="${F2}"]`) as HTMLElement).getByRole("button", { name: "Trocar a foto" }));
    // Troca é de uma por uma: escolher já troca (sem botão Usar).
    fireEvent.click(await screen.findByRole("button", { name: "paula-rua.jpg" }));
    fireEvent.click(await screen.findByRole("button", { name: /Salvar fotos/ }));
    await waitFor(() => expect(chamadasDe("clone_fotos_editar")).toHaveLength(1));
    expect(chamadasDe("clone_fotos_editar")[0].imagem_ids).toEqual([F1, F4]);
  });
});

describe("folha com as fotos antigas e gerar de novo", () => {
  it("vista feita com as fotos antigas: continua na tela marcada, e o botão gera de novo só as marcadas", async () => {
    respostas.clone_ler = cloneLido({ imagens: [vistaBruta(V1, "frente", { desatualizada: true }), vistaBruta("eeeeeeee-0000-4000-8000-000000000002", "perfil_esq")] });
    respostas.clone_folha_gerar = { imagem: vistaBruta("eeeeeeee-0000-4000-8000-000000000003", "frente", { aprovada: null }), custo_usd: 0.14 };
    montar();
    const aviso = (await waitFor(() => {
      const el = document.querySelector("[data-folha-desatualizada]");
      if (!el) throw new Error("sem aviso");
      return el;
    })) as HTMLElement;
    expect(aviso.textContent).toMatch(/1 vista foi feita com as fotos antigas/);
    expect(document.querySelector('[data-vista-do-clone="frente"] [data-vista-desatualizada]')).toBeTruthy();
    expect(document.querySelector('[data-vista-do-clone="perfil_esq"] [data-vista-desatualizada]')).toBeNull();
    await clicarComCusto(within(aviso).getByRole("button", { name: /Gerar de novo com as fotos novas/ }), "clone_folha_gerar");
    await waitFor(() => expect(chamadasDe("clone_folha_gerar")).toHaveLength(1));
    expect(chamadasDe("clone_folha_gerar")[0]).toMatchObject({ modelo_id: CL, vista: "frente" });
    expect(chamadasDe("clone_folha_gerar")[0].fotos_reais_ids).toBeUndefined();
  });

  it("gerar de novo uma vista escolhendo as fotos de origem", async () => {
    respostas.clone_ler = cloneLido({ imagens: [vistaBruta(V1, "frente")] });
    respostas.clone_folha_gerar = { imagem: vistaBruta("eeeeeeee-0000-4000-8000-000000000003", "frente", { aprovada: null }), custo_usd: 0.14 };
    montar();
    const frente = (await waitFor(() => {
      const el = document.querySelector('[data-vista-do-clone="frente"]');
      if (!el || !within(el as HTMLElement).queryByRole("button", { name: "Mais opções: Frente" })) throw new Error("sem a vista");
      return el;
    })) as HTMLElement;
    fireEvent.click(within(frente).getByRole("button", { name: "Mais opções: Frente" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Escolher as fotos e gerar de novo/ }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.click(within(dialogo).getByLabelText("Usar paula-lado.jpg"));
    await clicarComCusto(within(dialogo).getByRole("button", { name: /Gerar de novo com 1 foto/ }), "clone_folha_gerar");
    expect(chamadasDe("clone_folha_gerar")[0]).toMatchObject({ modelo_id: CL, vista: "frente", fotos_reais_ids: [F1] });
  });
});

describe("apagar (arquivar) com desfazer e restaurar", () => {
  it("apagar uma vista: sai na hora, vai para Apagadas e volta com Restaurar", async () => {
    // A função simulada guarda o estado: apagada vem em arquivadas na releitura.
    let apagada = false;
    respostas.clone_ler = () => (apagada ? cloneLido({ arquivadas: [vistaBruta(V1, "frente", { arquivada: true })] }) : cloneLido({ imagens: [vistaBruta(V1, "frente")] }));
    respostas.clone_imagem_arquivar = (b: any) => {
      apagada = b.restaurar !== true;
      return { imagem: { id: V1 }, custo_usd: 0 };
    };
    montar();
    const frente = (await waitFor(() => {
      const el = document.querySelector('[data-vista-do-clone="frente"]');
      if (!el || !within(el as HTMLElement).queryByRole("button", { name: "Mais opções: Frente" })) throw new Error("sem a vista");
      return el;
    })) as HTMLElement;
    fireEvent.click(within(frente).getByRole("button", { name: "Mais opções: Frente" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Apagar esta vista/ }));
    await waitFor(() => expect(document.querySelector(`[data-vista-apagada="${V1}"]`)).toBeTruthy());
    expect(chamadasDe("clone_imagem_arquivar")[0]).toEqual({ acao: "clone_imagem_arquivar", modelo_id: CL, imagem_id: V1, origem: "folha" });
    await waitFor(() => expect(mock.toast.success).toHaveBeenCalledWith("Vista Frente apagada", expect.objectContaining({ action: expect.objectContaining({ label: "Desfazer" }) })));
    fireEvent.click(within(document.querySelector(`[data-vista-apagada="${V1}"]`) as HTMLElement).getByRole("button", { name: /Restaurar/ }));
    await waitFor(() => expect(chamadasDe("clone_imagem_arquivar")).toHaveLength(2));
    expect(chamadasDe("clone_imagem_arquivar")[1]).toMatchObject({ imagem_id: V1, restaurar: true });
  });

  it("apagar uma variação e gerar de novo outra com o mesmo pedido", async () => {
    const variacao = fotoBruta(VAR, { nome: "Paula (variação: Café)", gerada: true, modo: "clone", tags: [`clone:${CL}`] });
    let apagada = false;
    respostas.clone_ler = () => (apagada ? cloneLido({ variacoes_arquivadas: [{ ...variacao, ativa: false }] }) : cloneLido({ variacoes: [variacao] }));
    respostas.clone_variacao_refazer = { imagem: fotoBruta("aaaaaaaa-0000-4000-8000-00000000000a", { gerada: true, modo: "clone", tags: [`clone:${CL}`] }), custo_usd: 0.14, avisos: [] };
    respostas.clone_imagem_arquivar = () => {
      apagada = true;
      return { imagem: { ...variacao, ativa: false }, custo_usd: 0 };
    };
    montar();
    const botao = await screen.findByRole("button", { name: "Mais opções: Paula (variação: Café)" });
    fireEvent.click(botao);
    fireEvent.click(await screen.findByRole("menuitem", { name: /Gerar de novo/ }));
    const dialogo = await screen.findByRole("dialog");
    await clicarComCusto(within(dialogo).getByRole("button", { name: /Gerar de novo com 2 fotos/ }), "clone_variacao_refazer");
    expect(chamadasDe("clone_variacao_refazer")[0]).toMatchObject({ modelo_id: CL, imagem_id: VAR });
    expect(chamadasDe("clone_variacao_refazer")[0].fotos_reais_ids).toBeUndefined();
    fireEvent.click(await screen.findByRole("button", { name: "Mais opções: Paula (variação: Café)" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Apagar esta variação/ }));
    await waitFor(() => expect(chamadasDe("clone_imagem_arquivar")).toHaveLength(1));
    expect(chamadasDe("clone_imagem_arquivar")[0]).toEqual({ acao: "clone_imagem_arquivar", modelo_id: CL, imagem_id: VAR, origem: "acervo" });
    await waitFor(() => expect(document.querySelector(`[data-variacao-apagada="${VAR}"]`)).toBeTruthy());
  });

  it("apagar o clone pede confirmação com o nome, e Arquivados restaura", async () => {
    respostas.clone_editar = (b: any) => ({ clone: cloneBruto({ status: b.arquivar ? "arquivada" : "folha" }), avisos: [] });
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Mais opções do clone Dra. Paula" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Apagar o clone/ }));
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByText("Apagar o clone de Dra. Paula?")).toBeTruthy();
    expect(within(dialogo).getByText(/fotos originais de Dra. Paula continuam no acervo/)).toBeTruthy();
    fireEvent.click(within(dialogo).getByRole("button", { name: /Apagar Dra. Paula/ }));
    await waitFor(() => expect(chamadasDe("clone_editar")).toEqual([{ acao: "clone_editar", modelo_id: CL, arquivar: true }]));

    respostas.clones_listar = (b: any) => (b.arquivados ? { clones: [{ ...cloneBruto({ status: "arquivada" }), autorizacao_valida: { ok: true, motivo: null } }] } : { clones: [] });
    fireEvent.click(screen.getByRole("button", { name: /Arquivados/ }));
    await waitFor(() => expect(chamadasDe("clones_listar").some((c) => c.arquivados === true)).toBe(true));
    fireEvent.click(await screen.findByRole("button", { name: "Restaurar Dra. Paula" }));
    await waitFor(() => expect(chamadasDe("clone_editar")[1]).toEqual({ acao: "clone_editar", modelo_id: CL, arquivar: false }));
  });
});

describe("duplicar e usar nas outras etapas", () => {
  it("duplicar manda o nome e a folha, e abre o clone novo na hora", async () => {
    respostas.clone_duplicar = { clone: { ...cloneBruto({ id: CL2, nome: "Dra. Paula (cópia)", status: "rascunho" }), autorizacao_valida: { ok: true, motivo: null } }, copiadas: 1, avisos: ["Mesmas fotos de origem e a mesma autorização de Paula (2026-09-20)."] };
    respostas.clone_ler = (b: any) => (b.modelo_id === CL2 ? { ...cloneLido(), clone: cloneBruto({ id: CL2, nome: "Dra. Paula (cópia)" }) } : cloneLido());
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /Duplicar/ }));
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByText(/mesma autorização de Paula/)).toBeTruthy();
    expect((within(dialogo).getByLabelText("Nome do clone duplicado") as HTMLInputElement).value).toBe("Dra. Paula (cópia)");
    fireEvent.click(within(dialogo).getByRole("button", { name: /^Duplicar$/ }));
    await waitFor(() => expect(chamadasDe("clone_duplicar")).toEqual([{ acao: "clone_duplicar", modelo_id: CL, levar_folha: true, nome: "Dra. Paula (cópia)" }]));
    await waitFor(() => expect(document.querySelector(`[data-clone-aberto="${CL2}"]`)).toBeTruthy());
  });

  it("clone sem autorização válida não duplica nem edita as fotos", async () => {
    respostas.clones_listar = { clones: [{ ...cloneBruto(), capa_url: null, autorizacao_valida: { ok: false, motivo: "A autorização desta pessoa foi revogada: nada novo pode ser gerado." } }] };
    respostas.clone_ler = { ...cloneLido(), autorizacao_valida: { ok: false, motivo: "A autorização desta pessoa foi revogada: nada novo pode ser gerado." } };
    montar();
    const f = await faixa();
    expect(within(f).queryByRole("button", { name: "Tirar a foto" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Adicionar foto de origem" })).toBeNull();
    expect((screen.getByRole("button", { name: /Duplicar/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Usar no Book leva à etapa Book (onde o clone aparece no seletor)", async () => {
    const irPara = vi.fn();
    montar({ irPara });
    fireEvent.click(await screen.findByRole("button", { name: "Mais opções do clone Dra. Paula" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Usar no Book/ }));
    expect(irPara).toHaveBeenCalledWith("book");
  });
});
