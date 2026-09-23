import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mesa, versão 5 (23/09, noite): seletor único de referências e pastas
 * espelhando o Workspace (docs/mesa-do-cliente/CONTRATOS-V5.md).
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  tabelas: {} as Record<string, unknown>,
  updates: [] as { tabela: string; valor: unknown }[],
  inserts: [] as { tabela: string; valor: unknown }[],
  assinadas: [] as { bucket: string; caminho: string }[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range"]) b[m] = () => b;
    b.update = (valor: unknown) => {
      mock.updates.push({ tabela, valor });
      return b;
    };
    b.insert = (valor: unknown) => {
      mock.inserts.push({ tabela, valor });
      b.inserido = { ...(valor as object), id: "r-novo" };
      return b;
    };
    const primeiro = () => ({ data: Array.isArray(dados) ? (dados[0] === undefined ? null : dados[0]) : dados, error: null });
    b.maybeSingle = () => Promise.resolve(primeiro());
    b.single = () => Promise.resolve(b.inserido ? { data: b.inserido, error: null } : primeiro());
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null, count: Array.isArray(dados) ? dados.length : 0 }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: vi.fn(),
      from: (tabela: string) => consulta(tabela),
      storage: {
        from: (bucket: string) => ({
          createSignedUrl: (caminho: string) => {
            mock.assinadas.push({ bucket, caminho });
            return Promise.resolve({ data: { signedUrl: `https://assinada.test/${bucket}/${caminho}` }, error: null });
          },
        }),
      },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import { ExploradorDePastas } from "@/components/mesa/NavegadorDePastas";
import SeletorDeReferencias, { PINTEREST_URL } from "@/components/mesa/SeletorDeReferencias";
import CampanhaReferencias, { MAX_REFERENCIAS } from "@/components/mesa/CampanhaReferencias";
import { montarArvore, pastaDaFoto, pastasDoAcervo, PASTA_ARQUIVOS, PASTA_ENVIADAS, RAIZ, trilhaAte, type NoDoWorkspace } from "@/lib/mesa/pastas";
import { ampliavelDaFonte, ehLinkDePin, fonteDaGlobal, ordenarPorDestaque, PAPEIS, urlDeImagemExterna } from "@/lib/mesa/referencias";

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Cliente sintético",
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

function montar(filho: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(TooltipProvider, null, h(MesaProvider, { valor: valorDaMesa() }, filho))));
}

const no = (id: string, name: string, kind: "folder" | "file", parent_id: string | null, storage_path: string | null = null): NoDoWorkspace => ({
  id,
  name,
  kind,
  mime: kind === "file" ? "image/jpeg" : null,
  storage_path,
  parent_id,
});

const NOS: NoDoWorkspace[] = [
  no("p-ref", "Referências", "folder", null),
  no("p-feed", "Feed aprovado", "folder", "p-ref"),
  no("p-vazia", "Contratos", "folder", null),
  no("n-1", "praia.jpg", "file", "p-feed", `${CLIENTE}/ws/praia.jpg`),
  no("n-2", "capa.jpg", "file", "p-ref", `${CLIENTE}/ws/capa.jpg`),
];

const REF_WORKSPACE = {
  id: "r-ws",
  origem: "workspace",
  papel: "tecnica",
  url_origem: null,
  storage_path: null,
  workspace_node_id: "n-2",
  file_id: null,
  leitura: "Título grande à esquerda",
  tags: [],
  ativa: true,
  criado_em: "2026-09-23T10:00:00Z",
  destaque: false,
};
const REF_ARTE = {
  ...REF_WORKSPACE,
  id: "r-arte",
  origem: "arquivo",
  papel: "identidade",
  workspace_node_id: null,
  storage_path: `${CLIENTE}/referencias/arte.png`,
  leitura: null,
  destaque: true,
};

beforeEach(() => {
  mock.invoke.mockReset();
  mock.updates.length = 0;
  mock.inserts.length = 0;
  mock.assinadas.length = 0;
  mock.tabelas = {
    cliente_referencias: [REF_WORKSPACE, REF_ARTE],
    workspace_nodes: NOS,
    files: [],
    referencias_globais: [
      {
        id: "g1",
        titulo: "Pôster granulado",
        leitura: "Figura granulada",
        tags: ["poster"],
        storage_path: "globais/pinterest/pin-01.jpg",
        url_origem: "https://i.pinimg.com/originals/da/ab/48/pin-01.jpg",
      },
    ],
  };
});

// ------------------------------------------------------------------ pastas

describe("pastas espelhando o Workspace", () => {
  it("conta as imagens da subárvore e monta a trilha", () => {
    const pastas = [
      { id: "a", nome: "A", paiId: RAIZ },
      { id: "b", nome: "B", paiId: "a" },
      { id: "c", nome: "C", paiId: "zz" },
    ];
    const arvore = montarArvore(pastas, { b: 2, a: 1, [RAIZ]: 3 });
    expect(arvore.total.a).toBe(3);
    expect(arvore.total[RAIZ]).toBe(6);
    // Pai que não existe vira primeiro nível.
    expect(arvore.filhos[RAIZ].map((p) => p.id)).toEqual(["a", "c"]);
    expect(trilhaAte(arvore, "b").map((p) => p.nome)).toEqual(["A", "B"]);
    expect(JSON.parse(JSON.stringify(arvore))).toEqual(arvore);
  });

  it("a foto do acervo fica na mesma pasta do Workspace; Arquivos e enviadas ganham pasta própria", () => {
    const fotos = [
      { origem: "workspace", workspace_node_id: "n-1", pasta: "Feed aprovado" },
      { origem: "arquivo", workspace_node_id: null, pasta: "Fotos da loja" },
      { origem: "upload", workspace_node_id: null, pasta: null },
    ];
    const { pastas, pastaDoNo } = pastasDoAcervo(NOS, fotos);
    expect(pastaDaFoto(fotos[0], pastaDoNo)).toBe("p-feed");
    expect(pastaDaFoto(fotos[1], pastaDoNo)).toBe(`${PASTA_ARQUIVOS}/Fotos da loja`);
    expect(pastaDaFoto(fotos[2], pastaDoNo)).toBe(PASTA_ENVIADAS);
    expect(pastas.map((p) => p.nome)).toEqual(["Referências", "Feed aprovado", "Contratos", "Arquivos", "Fotos da loja", "Enviadas"]);
  });

  it("navegar pasta e voltar: trilha, subpastas com contagem e pastas vazias ocultas", () => {
    const itens = NOS.filter((n) => n.kind === "file");
    render(
      h(ExploradorDePastas as any, {
        pastas: NOS.filter((n) => n.kind === "folder").map((n) => ({ id: n.id, nome: n.name, paiId: n.parent_id || RAIZ })),
        itens,
        pastaDoItem: (n: NoDoWorkspace) => n.parent_id || RAIZ,
        semArvore: true,
        renderizarItens: (lista: NoDoWorkspace[]) => h("ul", null, lista.map((n) => h("li", { key: n.id }, n.name))),
      }),
    );
    // Raiz: só a pasta com imagem aparece (Contratos está vazia).
    expect(screen.getByText("Referências")).toBeTruthy();
    expect(screen.queryByText("Contratos")).toBeNull();
    expect(screen.getByText("2 imagens")).toBeTruthy();
    expect((screen.getByText("Voltar").closest("button") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByText("Referências"));
    expect(screen.getByText("capa.jpg")).toBeTruthy();
    fireEvent.click(screen.getByText("Feed aprovado"));
    expect(screen.getByText("praia.jpg")).toBeTruthy();
    expect(screen.queryByText("capa.jpg")).toBeNull();
    const trilha = screen.getByRole("navigation", { name: "Trilha das pastas" });
    expect(within(trilha).getByText("Referências")).toBeTruthy();
    expect(within(trilha).getByText("Feed aprovado")).toBeTruthy();

    fireEvent.click(screen.getByText("Voltar"));
    expect(screen.getByText("capa.jpg")).toBeTruthy();
    fireEvent.click(screen.getByText("Voltar"));
    expect(screen.getByText("2 imagens")).toBeTruthy();
    expect(screen.queryByText("capa.jpg")).toBeNull();
  });
});

// ------------------------------------------------------------------ seletor

describe("seletor de referências", () => {
  it("abas: quatro para escolher (com o contador) e sem o banco da agência no modo gerenciar", async () => {
    const { unmount } = montar(h(SeletorDeReferencias, { selecionados: [], onChange: vi.fn(), max: 8 }));
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Do cliente", "Pastas do workspace", "Banco da agência", "Pinterest"]);
    expect(screen.getByText("0 de 8")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("tab", { name: /Do cliente/ }).textContent).toContain("(2)"), { timeout: 5000 });
    unmount();
    montar(h(SeletorDeReferencias, { modo: "gerenciar" }));
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Do cliente", "Pastas do workspace", "Pinterest"]);
    expect(screen.queryByText(/de 8/)).toBeNull();
  });

  it("papéis com nome claro; destaque primeiro; marcar destaque grava update destaque", async () => {
    montar(h(SeletorDeReferencias, { selecionados: [], onChange: vi.fn() }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /destaque/ }).length).toBe(2), { timeout: 5000 });
    expect(screen.getAllByText(/Artes da marca/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Referências de composição/).length).toBeGreaterThan(0);
    // A arte em destaque vem primeiro.
    const estrelas = screen.getAllByRole("button", { name: /destaque/ });
    expect(estrelas[0].getAttribute("aria-label")).toBe("Tirar do destaque");
    fireEvent.click(screen.getByRole("button", { name: "Marcar como destaque" }));
    await waitFor(() => expect(mock.updates).toContainEqual({ tabela: "cliente_referencias", valor: { destaque: true } }), { timeout: 5000 });
  });

  it("escolher respeita o limite", async () => {
    const onChange = vi.fn();
    montar(h(SeletorDeReferencias, { selecionados: ["r-arte"], onChange, max: 1 }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Usar|Escolhida/ }).length).toBe(2), { timeout: 5000 });
    const usar = screen.getByRole("button", { name: /Usar/ }) as HTMLButtonElement;
    expect(usar.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Escolhida/ }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("colar link de pin cria referência de composição e já escolhe", async () => {
    mock.invoke.mockResolvedValue({ data: { referencia: { id: "r-pin", papel: "identidade", ativa: true }, ja_existia: false }, error: null });
    const onChange = vi.fn();
    montar(h(SeletorDeReferencias, { selecionados: [], onChange, max: 8 }));
    fireEvent.click(screen.getByRole("tab", { name: /Pinterest/ }));
    const abrir = screen.getByText("Abrir o Pinterest").closest("a") as HTMLAnchorElement;
    expect(abrir.getAttribute("href")).toBe(PINTEREST_URL);
    expect(abrir.getAttribute("target")).toBe("_blank");
    expect(abrir.getAttribute("rel")).toContain("noopener");
    fireEvent.change(screen.getByLabelText("Link do pin"), { target: { value: "https://br.pinterest.com/pin/485051822390692739/" } });
    fireEvent.click(screen.getByRole("button", { name: /Adicionar/ }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(["r-pin"]), { timeout: 5000 });
    expect(mock.invoke).toHaveBeenCalledWith("estudio-arte", {
      body: { acao: "referencias", subacao: "importar_pinterest", client_id: CLIENTE, url: "https://br.pinterest.com/pin/485051822390692739/" },
    });
    expect(mock.updates).toContainEqual({ tabela: "cliente_referencias", valor: { papel: "tecnica", ativa: true } });
  });

  it("link que não é de pin nem chama a função", () => {
    expect(ehLinkDePin("https://pin.it/3xYz")).toBe(true);
    expect(ehLinkDePin("https://br.pinterest.com/pin/1/")).toBe(true);
    expect(ehLinkDePin("http://pinterest.com/pin/1/")).toBe(false);
    expect(ehLinkDePin("https://exemplo.com/pinterest")).toBe(false);
  });

  it("imagem do workspace escolhida vira referência de composição ligada ao nó", async () => {
    mock.tabelas.cliente_referencias = [];
    const onChange = vi.fn();
    montar(h(SeletorDeReferencias, { selecionados: [], onChange, max: 8, colunas: 3 }));
    fireEvent.click(screen.getByRole("tab", { name: /Pastas do workspace/ }));
    await waitFor(() => expect(screen.getAllByText("Referências").length).toBeGreaterThan(0), { timeout: 5000 });
    fireEvent.click(screen.getAllByText("Referências")[0]);
    await waitFor(() => expect(screen.getByText("capa.jpg")).toBeTruthy(), { timeout: 5000 });
    // Sem linha ainda: insere e escolhe o id devolvido.
    mock.tabelas.cliente_referencias = [];
    fireEvent.click(screen.getByRole("button", { name: /Usar/ }));
    await waitFor(() => expect(mock.inserts.length).toBe(1), { timeout: 5000 });
    expect(mock.inserts[0]).toEqual({
      tabela: "cliente_referencias",
      valor: { client_id: CLIENTE, origem: "workspace", workspace_node_id: "n-2", papel: "tecnica", ativa: true },
    });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(["r-novo"]), { timeout: 5000 });
  });
});

// ------------------------------------------------------------------ imagens

describe("imagens com URL assinada do bucket certo", () => {
  it("referência do Workspace assina no bucket workspace; a do bucket mesa, no mesa", async () => {
    montar(h(SeletorDeReferencias, { selecionados: [], onChange: vi.fn() }));
    await waitFor(() => {
      const srcs = Array.from(document.querySelectorAll("img")).map((i) => i.getAttribute("src"));
      expect(srcs).toContain(`https://assinada.test/workspace/${CLIENTE}/ws/capa.jpg`);
      expect(srcs).toContain(`https://assinada.test/mesa/${CLIENTE}/referencias/arte.png`);
    });
    for (const img of Array.from(document.querySelectorAll("img"))) expect(img.getAttribute("loading")).toBe("lazy");
  });

  it("banco da agência usa a imagem original do pin (a assinatura de globais/ é recusada pelo bucket)", async () => {
    montar(h(CampanhaReferencias, { valor: [], onChange: vi.fn() }));
    expect(MAX_REFERENCIAS).toBe(8);
    fireEvent.click(screen.getByRole("tab", { name: /Banco da agência/ }));
    await waitFor(() => {
      const srcs = Array.from(document.querySelectorAll("img")).map((i) => i.getAttribute("src"));
      expect(srcs).toContain("https://i.pinimg.com/originals/da/ab/48/pin-01.jpg");
    });
    expect(mock.assinadas.filter((a) => a.caminho.indexOf("globais/") === 0)).toEqual([]);
    const g = { storage_path: "globais/pinterest/pin-01.jpg", url_origem: "https://i.pinimg.com/originals/x.jpg" };
    expect(ampliavelDaFonte(fonteDaGlobal(g))).toEqual({ caminho: "https://i.pinimg.com/originals/x.jpg" });
    expect(ampliavelDaFonte({ bucket: "workspace", caminho: "c/a.jpg" })).toEqual({ caminho: "c/a.jpg", bucket: "workspace" });
    expect(urlDeImagemExterna("https://br.pinterest.com/pin/1/")).toBeNull();
  });

  it("destaque primeiro sem mudar a ordem dentro de cada grupo; resultado JSON puro", () => {
    const lista = [
      { id: "a", destaque: false },
      { id: "b", destaque: true },
      { id: "c", destaque: false },
      { id: "d", destaque: true },
    ];
    const ordenada = ordenarPorDestaque(lista);
    expect(ordenada.map((x) => x.id)).toEqual(["b", "d", "a", "c"]);
    expect(JSON.parse(JSON.stringify(ordenada))).toEqual(ordenada);
    expect(PAPEIS.identidade.rotulo).toBe("Artes da marca");
    expect(PAPEIS.tecnica.rotulo).toBe("Referências de composição");
  });
});

// ------------------------------------------------------------------ compatibilidade

describe("arquivos do seletor: navegador antigo e texto", () => {
  it("sem lookbehind, \\p{}, grupo nomeado, aspect-ratio, :has, .at() nem travessão", () => {
    for (const rel of [
      "src/components/mesa/SeletorDeReferencias.tsx",
      "src/components/mesa/NavegadorDePastas.tsx",
      "src/components/mesa/ContextoFotos.tsx",
      "src/components/mesa/ContextoImagens.tsx",
      "src/components/mesa/ContextoGaleriaDeReferencias.tsx",
      "src/components/mesa/ContextoReferencias.tsx",
      "src/components/mesa/CampanhaReferencias.tsx",
      "src/components/mesa/ReferenciasDoEstudio.tsx",
      "src/components/mesa/SeletorDoAcervo.tsx",
      "src/lib/mesa/referencias.ts",
      "src/lib/mesa/pastas.ts",
    ]) {
      const texto = ler(rel);
      expect(texto, rel).not.toContain("(?<");
      expect(texto, rel).not.toMatch(/\\p\{/);
      expect(texto, rel).not.toContain("aspect-[");
      expect(texto, rel).not.toContain("aspect-square");
      expect(texto, rel).not.toContain(":has(");
      expect(texto, rel).not.toContain(".at(");
      expect(texto, rel).not.toContain("—");
      expect(texto, rel).not.toContain("–");
    }
  });

  it("as chamadas da função de referências usam a ação referencias com subação", () => {
    const contexto = ler("src/components/mesa/ContextoReferencias.tsx");
    expect(contexto).toContain('acao: "referencias", subacao: "sincronizar_workspace"');
    expect(contexto).toContain('acao: "referencias", subacao: "ler"');
    expect(ler("src/lib/mesa/referencias.ts")).toContain('subacao: "importar_pinterest"');
  });
});
