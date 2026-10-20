import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Laboratório, Estúdio livre (19/10/2026). Pedido do dono: "um estúdio com a mesma funcionalidade do
 * estúdio de artes ... mas livre: às vezes não é cliente nem projeto; posso escolher o cliente, mas não
 * quero que entre na mesa do cliente; vai para o arquivo livre organizado".
 * - sem cliente, o Estúdio livre guarda sob o cliente interno da agência (só arquivos), manda origem
 *   'laboratorio' e sem_marca, e cobra da carteira própria do Estúdio livre (19/10, sem criar cliente);
 * - a Mesa do cliente só lista as artes rápidas de origem 'mesa';
 * - na função, a arte do Laboratório vai para o Workspace global (nunca Arquivos do cliente, Agenda nem aprovação).
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), from: vi.fn(), upload: vi.fn(), clientes: [] as any[] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    rpc: mock.rpc,
    from: mock.from,
    auth: { getSession: vi.fn(async () => ({ data: { session: null } })) },
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: vi.fn(async () => ({ data: { signedUrl: "https://x/y.png" }, error: null })),
        upload: mock.upload,
        download: vi.fn(),
      })),
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/contexts/AuthContext", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }),
}));
vi.mock("@/hooks/useSupabaseData", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useClients: () => ({ data: mock.clientes, isLoading: false, isSuccess: true, isFetching: false }),
}));

import type { ModeloIa } from "@/lib/mesa/api";

const catalogo = vi.hoisted(() => [] as unknown[]);
vi.mock("@/components/mesa/MesaContexto", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useCatalogo: () => ({ data: catalogo, isLoading: false }),
}));

import { ConfirmDialogProvider } from "@/components/shared/confirmDialog";
import EstudioLivre from "@/components/laboratorio/estudio-livre/EstudioLivre";
import { chavesDaArteRapida, lerArteRapida, lerArtesRapidas } from "@/components/mesa/arteRapidaApi";
import {
  ACOES_SO_DA_MESA,
  ehDoLaboratorio,
  guardarNoLaboratorio,
  origemDoPedido,
  pastaDoCliente,
  pastasDoEstudioLivre,
  type NoDaPasta,
  type NoNovoDoLaboratorio,
  type PortaDoLaboratorio,
} from "../../supabase/functions/estudio-arte/modulos/estudio-livre";

const INTERNO = "99999999-9999-4999-8999-999999999999";
const CLIENTE = "11111111-1111-4111-8111-111111111111";

const modelo = (extra: Partial<ModeloIa>): ModeloIa =>
  ({
    id: "openai:x",
    provedor: "openai",
    nome: "Modelo",
    tipo: "texto",
    preco_entrada_1m: 1,
    preco_saida_1m: 4,
    preco_imagem: null,
    raciocinio: [],
    padrao_para: [],
    ativo: true,
    ...extra,
  }) as ModeloIa;
catalogo.push(
  modelo({ id: "openai:diretor", padrao_para: ["diretor_arte"] }),
  modelo({ id: "openai:leitor", padrao_para: ["leitura"], preco_entrada_1m: 0.1, preco_saida_1m: 0.4 }),
  modelo({ id: "openai:imagem", tipo: "imagem", preco_entrada_1m: 0, preco_saida_1m: 0, preco_imagem: { baixa: 0.01, media: 0.04, alta: 0.17 } as never, padrao_para: ["imagem"] }),
);

const fonte = (caminho: string) => readFileSync(resolve(__dirname, "..", "..", caminho), "utf8");

function bancoFalso(tabelas: Record<string, any[]>) {
  return (nome: string) => {
    const filtros: ((r: any) => boolean)[] = [];
    const b: any = {
      select: () => b,
      order: () => b,
      eq: (c: string, v: unknown) => {
        filtros.push((r) => r[c] === v);
        return b;
      },
      neq: () => b,
      in: (c: string, vs: unknown[]) => {
        filtros.push((r) => vs.indexOf(r[c]) >= 0);
        return b;
      },
      is: () => b,
      not: () => b,
      gte: () => b,
      lt: () => b,
      lte: () => b,
      limit: () => b,
      range: () => b,
      contains: () => b,
      overlaps: () => b,
      or: () => b,
      maybeSingle: () => Promise.resolve({ data: (tabelas[nome] || []).filter((r) => filtros.every((f) => f(r)))[0] || null, error: null }),
      then: (ok: any, erro: any) => Promise.resolve({ data: (tabelas[nome] || []).filter((r) => filtros.every((f) => f(r))), error: null }).then(ok, erro),
    };
    return b;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.clientes = [
    { id: "aaaaaaaa-0000-4000-8000-0000000000a1", company_name: "Doces em Ordem", services_config: { internal_company: true } },
    { id: INTERNO, company_name: "Aceleriq", services_config: { internal_company: true } },
    { id: CLIENTE, company_name: "Padaria Sol", services_config: {} },
  ];
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    /* sem storage */
  }
});

const arte = (id: string, origem: string | undefined) => ({
  id,
  client_id: CLIENTE,
  task_id: null,
  ...(origem ? { origem } : {}),
  status: "dirigido",
  direcao: { conceito: "c", cards: [{ ordem: 1 }], arte_rapida: { pedido: "p", titulo: `Arte ${id}`, peca: "unica", arquivos: [], documentos: [] } },
  cards: [],
  file_ids: [],
  atualizado_em: "2026-10-19",
});

describe("Mesa do cliente: só a origem 'mesa'", () => {
  it("lerArtesRapidas da Mesa filtra origem 'mesa'; a do Laboratório lê só as dela", async () => {
    mock.from.mockImplementation(bancoFalso({ estudio_trabalhos: [arte("m1", "mesa"), arte("l1", "laboratorio")] }));
    expect((await lerArtesRapidas(CLIENTE)).map((t) => t.id)).toEqual(["m1"]);
    expect((await lerArtesRapidas(CLIENTE, "laboratorio")).map((t) => t.id)).toEqual(["l1"]);
    // Aberta pelo endereço da Mesa: a do Laboratório não abre.
    expect(await lerArteRapida(CLIENTE, "l1")).toBeNull();
    expect((await lerArteRapida(CLIENTE, "l1", "laboratorio"))?.id).toBe("l1");
  });

  it("a chave da lista da Mesa é a de sempre; a do Laboratório é outra (o cache não mistura)", () => {
    expect(chavesDaArteRapida.lista(CLIENTE)).toEqual(["mesa", "arte-rapida", CLIENTE, "lista"]);
    expect(chavesDaArteRapida.lista(CLIENTE, "laboratorio")).toEqual(["mesa", "arte-rapida", CLIENTE, "lista", "laboratorio"]);
  });

  it("a lista da Mesa no código pede .eq('origem', origem) com 'mesa' de padrão", () => {
    const api = fonte("src/components/mesa/arteRapidaApi.ts");
    expect(api).toMatch(/lerArtesRapidas\(clientId: string, origem: OrigemDaArteRapida = "mesa"\)/);
    expect(api).toContain('.eq("origem", origem)');
  });
});

describe("Estúdio livre: tela", () => {
  it("sem cliente usa o cliente interno e manda origem 'laboratorio' no rapida_preparar", async () => {
    mock.from.mockImplementation(bancoFalso({ estudio_trabalhos: [], mesa_campanhas: [], cliente_marcas: [] }));
    mock.rpc.mockImplementation(async () => ({ data: { saldo_usd: 10 }, error: null }));
    mock.invoke.mockImplementation(async (_f: string, { body }: { body: Record<string, unknown> }) => {
      if (body.acao === "rapida_preparar") return { data: { trabalho: null, custo_usd: 0.05, avisos: [] }, error: null };
      return { data: {}, error: null };
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(h(MemoryRouter, { initialEntries: ["/laboratorio"] }, h(QueryClientProvider, { client: qc }, h(ConfirmDialogProvider, null, h(EstudioLivre, {})))));
    expect(await screen.findByRole("heading", { name: "Estúdio livre" })).toBeTruthy();
    const seletor = screen.getByLabelText("Cliente do trabalho") as HTMLSelectElement;
    expect(seletor.value).toBe("");
    // Os clientes internos não aparecem como cliente: o Livre não é cliente nenhum.
    expect(within(seletor).queryByText("Aceleriq")).toBeNull();
    expect(within(seletor).getByText("Padaria Sol")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("O que você precisa?"), { target: { value: "Arte do evento de sábado" } });
    fireEvent.click(screen.getByRole("button", { name: /Criar arte/ }));
    await waitFor(() => expect(mock.invoke.mock.calls.some((c) => (c[1] as any).body.acao === "rapida_preparar")).toBe(true));
    const corpo = (mock.invoke.mock.calls.filter((c) => (c[1] as any).body.acao === "rapida_preparar")[0][1] as any).body;
    expect(corpo).toMatchObject({ client_id: INTERNO, origem: "laboratorio", sem_marca: true, pedido: "Arte do evento de sábado" });
  });

  it("com cliente escolhido usa o cliente dele, ainda com origem 'laboratorio'", async () => {
    mock.from.mockImplementation(bancoFalso({ estudio_trabalhos: [], mesa_campanhas: [], cliente_marcas: [] }));
    mock.rpc.mockImplementation(async () => ({ data: { saldo_usd: 10 }, error: null }));
    mock.invoke.mockImplementation(async () => ({ data: { trabalho: null, custo_usd: 0, avisos: [] }, error: null }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(h(MemoryRouter, { initialEntries: ["/laboratorio"] }, h(QueryClientProvider, { client: qc }, h(ConfirmDialogProvider, null, h(EstudioLivre, { clientId: CLIENTE })))));
    expect(await screen.findByRole("heading", { name: "Estúdio livre" })).toBeTruthy();
    // O pai decidiu o cliente: sem o seletor.
    expect(screen.queryByLabelText("Cliente do trabalho")).toBeNull();
    fireEvent.change(screen.getByLabelText("O que você precisa?"), { target: { value: "Promo do pão" } });
    fireEvent.click(screen.getByRole("button", { name: /Criar arte/ }));
    await waitFor(() => expect(mock.invoke.mock.calls.some((c) => (c[1] as any).body.acao === "rapida_preparar")).toBe(true));
    const corpo = (mock.invoke.mock.calls.filter((c) => (c[1] as any).body.acao === "rapida_preparar")[0][1] as any).body;
    expect(corpo).toMatchObject({ client_id: CLIENTE, origem: "laboratorio" });
  });

  it("a Mesa do cliente não manda origem (fica no padrão 'mesa' do banco)", () => {
    const tela = fonte("src/components/mesa/EstudioArteRapida.tsx");
    expect(tela).toContain('origem === "laboratorio" ? { ...corpoDoPedido, origem, ');
    expect(tela).toContain(': corpoDoPedido);');
  });
});

// ------------------------------------------------------------------ função estudio-arte

function portaFalsa() {
  const nos: (NoDaPasta & { scope: string; client_id: null; storage_path?: string })[] = [];
  const subidos: string[] = [];
  let n = 0;
  const porta: PortaDoLaboratorio = {
    pastasFilhas: async (parentId) => nos.filter((x) => x.kind === "folder" && x.parent_id === parentId),
    criarPasta: async (parentId, nome) => {
      const id = `p${++n}`;
      nos.push({ id, parent_id: parentId, name: nome, kind: "folder", scope: "global", client_id: null });
      return id;
    },
    noComPrefixo: async (prefixo) => nos.filter((x) => x.kind === "file" && (x.storage_path || "").indexOf(`${prefixo}.`) === 0)[0] || null,
    subir: async (caminho) => {
      subidos.push(caminho);
    },
    criarNo: async (linha: NoNovoDoLaboratorio) => {
      const id = `f${++n}`;
      nos.push({ id, parent_id: linha.parent_id, name: linha.name, kind: "file", scope: linha.scope, client_id: linha.client_id, storage_path: linha.storage_path });
      return id;
    },
  };
  return { porta, nos, subidos };
}

const lamina = (ordem: number, versao = 1) => ({
  ordem,
  versao,
  carregar: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mime: "image/png", extensao: "png" })),
});

describe("estudio-arte: origem 'laboratorio' vai para o Workspace global", () => {
  it("origem e pastas: Laboratório / Livres (cliente interno) ou o nome / Estúdio livre / dia", () => {
    expect(origemDoPedido("laboratorio")).toBe("laboratorio");
    expect(origemDoPedido("qualquer")).toBe("mesa");
    expect(origemDoPedido(undefined)).toBe("mesa");
    expect(ehDoLaboratorio({ origem: "laboratorio" })).toBe(true);
    expect(ehDoLaboratorio({ origem: "mesa" })).toBe(false);
    expect(ehDoLaboratorio({})).toBe(false);
    expect(pastaDoCliente({ company_name: "Aceleriq", services_config: { internal_company: true } })).toBeNull();
    expect(pastaDoCliente({ company_name: "Padaria Sol", services_config: {} })).toBe("Padaria Sol");
    expect(pastasDoEstudioLivre(null, "2026-10-19")).toEqual(["Laboratório", "Livres", "Estúdio livre", "2026-10-19"]);
    expect(pastasDoEstudioLivre("Padaria/Sol", "2026-10-19")).toEqual(["Laboratório", "Padaria-Sol", "Estúdio livre", "2026-10-19"]);
  });

  it("guarda cada lâmina no escopo global (sem cliente), reaproveita a pasta existente e não repete o que já subiu", async () => {
    const f = portaFalsa();
    // A raiz já existe sem acento: é a mesma pasta.
    f.nos.push({ id: "raiz", parent_id: null, name: "Laboratorio", kind: "folder", scope: "global", client_id: null });
    const entrada = { trabalhoId: "t-1", titulo: "Evento de sábado", nomeDoCliente: null, dia: "2026-10-19", criadoPor: "u-1", laminas: [lamina(1), lamina(2)] };
    const r = await guardarNoLaboratorio(f.porta, entrada);
    expect(r.caminho).toEqual(["Laboratório", "Livres", "Estúdio livre", "2026-10-19"]);
    expect(r.novos).toBe(2);
    expect(f.nos.filter((x) => x.kind === "folder" && x.name === "Laboratório")).toHaveLength(0);
    const arquivos = f.nos.filter((x) => x.kind === "file");
    expect(arquivos.map((x) => x.name)).toEqual(["Evento de sábado (1 de 2).png", "Evento de sábado (2 de 2).png"]);
    expect(arquivos.every((x) => x.scope === "global" && x.client_id === null && x.parent_id === r.pasta_id)).toBe(true);
    expect(f.subidos).toEqual(["global/laboratorio/estudio-livre/t-1/1-v1.png", "global/laboratorio/estudio-livre/t-1/2-v1.png"]);
    // Guardar de novo: nada sobe; só a lâmina com versão nova.
    const outra = await guardarNoLaboratorio(f.porta, { ...entrada, laminas: [lamina(1), lamina(2, 2)] });
    expect(outra.novos).toBe(1);
    expect(outra.pasta_id).toBe(r.pasta_id);
    expect(f.subidos.slice(2)).toEqual(["global/laboratorio/estudio-livre/t-1/2-v2.png"]);
  });

  it("contrato do index.ts: grava a origem, usa o cliente interno sem cliente e o entregar do Laboratório não toca Arquivos, Agenda nem aprovação", () => {
    const s = fonte("supabase/functions/estudio-arte/index.ts");
    // rapida_preparar: a origem pedida, o cliente interno quando não veio cliente, e a coluna no insert.
    expect(s).toContain("origemDoPedido(corpo.origem)");
    expect(s).toMatch(/if \(!existente && semMarca\) \{\s*clientId = \(await clienteInternoDaAgencia\(servico\(\)\)\) \|\| "";/);
    // A arte livre é registrada antes da primeira cobrança: o banco debita a carteira do Estúdio livre.
    expect(s).toContain('from("estudio_livre_trabalhos").upsert({ trabalho_id: trabalhoId }');
    expect(s).toContain('...(rapida && rapida.origem === "laboratorio" ? { origem: "laboratorio" } : {})');
    // entregar: o desvio vem antes de qualquer caminho de Arquivos ou Agenda.
    const entregar = s.slice(s.indexOf("async function entregar("), s.indexOf("async function entregar(") + 600);
    expect(entregar.indexOf("ehDoLaboratorio(t)")).toBeGreaterThan(0);
    expect(entregar.indexOf("ehDoLaboratorio(t)")).toBeLessThan(entregar.indexOf("ehAds(t)"));
    const guardar = s.slice(s.indexOf("async function guardarArteDoLaboratorio("), s.indexOf("/** 19/10: as ações da Agenda"));
    expect(guardar).toContain("guardarNoLaboratorio(portaDoLaboratorio()");
    expect(guardar).not.toContain("create_file_record");
    expect(guardar).not.toContain("levarParaAgenda");
    expect(guardar).not.toContain("aprenderComAEntrega");
    expect(guardar).not.toContain('status: "entregue"');
    const porta = s.slice(s.indexOf("function portaDoLaboratorio()"), s.indexOf("async function guardarArteDoLaboratorio("));
    expect(porta).toContain('scope: "global", client_id: null, kind: "folder"');
    expect(porta).toContain("storage.from(BUCKET_DO_LABORATORIO)");
    expect(porta).not.toContain('from("files")');
    // Agenda, publicação e aprovação recusam o trabalho do Laboratório.
    expect(s).toContain("for (const acao of ACOES_SO_DA_MESA) if (ACOES[acao]) ACOES[acao] = soDaMesa(ACOES[acao]);");
    expect(ACOES_SO_DA_MESA).toEqual(expect.arrayContaining(["rapida_para_agenda", "entrega_concluir", "publicacao_confirmar", "agenda_sincronizar"]));
    expect(ACOES_SO_DA_MESA).not.toContain("entregar");
  });

  it("sem lookbehind, propriedade Unicode nem grupo nomeado nos arquivos novos", () => {
    for (const caminho of [
      "supabase/functions/estudio-arte/modulos/estudio-livre.ts",
      "src/components/laboratorio/estudio-livre/EstudioLivre.tsx",
      "src/components/laboratorio/estudio-livre/GuardarNoLaboratorio.tsx",
    ]) {
      const s = fonte(caminho);
      expect(s).not.toMatch(/\(\?<[=!]/);
      expect(s).not.toMatch(/\\p\{/);
      expect(s).not.toMatch(/\(\?<[a-zA-Z]/);
    }
  });
});
