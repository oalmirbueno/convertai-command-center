import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const banco = vi.hoisted(() => ({
  dados: {} as Record<string, unknown[]>,
  chamadas: [] as Array<{ tabela: string; metodo: string; args: unknown[] }>,
  atualizado: [{ id: "foto" }] as unknown[],
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabela: string) => {
      let escrita = false;
      const q: Record<string, unknown> = {};
      for (const metodo of ["select", "eq", "is", "order", "range", "update", "insert"]) {
        q[metodo] = (...args: unknown[]) => {
          banco.chamadas.push({ tabela, metodo, args });
          if (metodo === "update" || metodo === "insert") escrita = true;
          return q;
        };
      }
      q.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: escrita ? banco.atualizado : banco.dados[tabela] || [], error: null }).then(resolve);
      return q;
    },
  },
}));
vi.mock("@/lib/fileUrls", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/fileUrls")>();
  return { ...original, useResolvedFileUrl: () => ({ url: "https://example.invalid/foto.png", error: null }) };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import AbaOrganizacao from "@/components/mesa/AbaOrganizacao";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import {
  contagensDasPastas, criarPastaNaOrganizacao, dentroDaPasta, filtrarOrganizacao, itensDaOrganizacao,
  lerOrganizacao, linkDoWorkspaceDaOrganizacao, moverNaOrganizacao, pastasDaOrganizacao,
  type ArquivoDaOrganizacao, type NoDaOrganizacao,
} from "@/components/mesa/organizacaoDaMesa";

const cliente = "cliente-a";
const no = (id: string, extra: Partial<NoDaOrganizacao> = {}): NoDaOrganizacao => ({
  id, client_id: cliente, scope: "client", parent_id: null, kind: "folder", name: id,
  mime: null, storage_path: null, created_at: "2026-10-21", inbox_scan_status: null, ...extra,
});
const arquivo = (id: string, extra: Partial<ArquivoDaOrganizacao> = {}): ArquivoDaOrganizacao => ({
  id, client_id: cliente, project_id: "projeto-a", parent_file_id: null, file_name: `${id}.png`,
  file_url: "files://foto.png", file_type: "image/png", mime_type: "image/png", storage_bucket: "files",
  storage_path: "foto.png", folder: "Campanha", created_at: "2026-10-20", ...extra,
});
const nos = [no("campanha", { name: "Campanha" }), no("produto", { parent_id: "campanha", name: "Produto" }), no("foto", { parent_id: "produto", kind: "file", name: "Promoção.png", mime: "image/png", storage_path: "cliente/foto.png" })];

beforeEach(() => {
  banco.dados = { workspace_nodes: nos, staff_files_secure: [arquivo("arte")] };
  banco.chamadas = [];
  banco.atualizado = [{ id: "foto" }];
});

describe("Organização na Mesa", () => {
  it("lê só o cliente e não transforma nós bloqueados ou de outro cliente em arquivos visíveis", async () => {
    banco.dados.workspace_nodes = [...nos, no("fora", { client_id: "cliente-b" }), no("bloqueado", { kind: "file", inbox_scan_status: "blocked" })];
    banco.dados.staff_files_secure = [arquivo("arte"), arquivo("outra", { client_id: "cliente-b" })];
    const acervo = await lerOrganizacao(cliente);
    expect(acervo.nos.map((n) => n.id)).toEqual(["campanha", "produto", "foto"]);
    expect(acervo.arquivos.map((a) => a.id)).toEqual(["arte"]);
    for (const tabela of ["workspace_nodes", "staff_files_secure"]) expect(banco.chamadas).toContainEqual({ tabela, metodo: "eq", args: ["client_id", cliente] });
    expect(banco.chamadas).toContainEqual({ tabela: "workspace_nodes", metodo: "eq", args: ["scope", "client"] });
    const colunas = banco.chamadas.filter((c) => c.metodo === "select").map((c) => c.args[0]);
    expect(colunas.join(" ")).not.toMatch(/inbox_token|\*/);
  });

  it("mantém o recorte da marca nos Arquivos, oculta filhos de carrossel e evita duplicar o Workspace", () => {
    const acervo = { nos, arquivos: [arquivo("arte"), arquivo("outra-marca", { project_id: "projeto-b" }), arquivo("filho", { parent_file_id: "arte" }), arquivo("duplicada", { file_url: "workspace://cliente/foto.png", storage_bucket: "workspace", storage_path: "cliente/foto.png" })] };
    expect(itensDaOrganizacao(acervo, { so: ["projeto-a"] }).map((a) => a.id)).toEqual(["foto", "arte"]);
    expect(filtrarOrganizacao(itensDaOrganizacao(acervo, null), nos, "workspace:campanha", "promocao").map((a) => a.id)).toEqual(["foto"]);
    expect(filtrarOrganizacao(itensDaOrganizacao(acervo, null), nos, "arquivos:Campanha", "").every((i) => i.origem === "arquivos")).toBe(true);
    expect(pastasDaOrganizacao(nos)).toEqual([{ id: "campanha", nome: "Campanha" }, { id: "produto", nome: "Campanha / Produto" }]);
    expect(Array.from(contagensDasPastas(itensDaOrganizacao(acervo, null), nos))).toEqual([["produto", 1], ["campanha", 1]]);
  });

  it("recusa mover entre clientes, para dentro de si ou sobre um estado que outra tela já mudou", async () => {
    await expect(moverNaOrganizacao(cliente, "foto", "estranha", [...nos, no("estranha", { client_id: "cliente-b" })])).rejects.toThrow("fora deste cliente");
    await expect(moverNaOrganizacao(cliente, "campanha", "produto", nos)).rejects.toThrow("fora deste item");
    expect(banco.chamadas.filter((c) => c.metodo === "update")).toHaveLength(0);
    banco.atualizado = [];
    await expect(moverNaOrganizacao(cliente, "foto", "campanha", nos)).rejects.toThrow("mudou em outra tela");
    expect(banco.chamadas).toContainEqual({ tabela: "workspace_nodes", metodo: "eq", args: ["client_id", cliente] });
    expect(banco.chamadas).toContainEqual({ tabela: "workspace_nodes", metodo: "eq", args: ["parent_id", "produto"] });
  });

  it("cria pasta real sem copiar arquivos, recusa duplicatas e limita a árvore com ciclos", async () => {
    await criarPastaNaOrganizacao(cliente, "operador", "  Natal  ", "campanha", nos);
    expect(banco.chamadas).toContainEqual({ tabela: "workspace_nodes", metodo: "insert", args: [{ scope: "client", client_id: cliente, parent_id: "campanha", kind: "folder", name: "Natal", created_by: "operador" }] });
    await expect(criarPastaNaOrganizacao(cliente, "operador", "produto", "campanha", nos)).rejects.toThrow("Já existe");
    const ciclo = [no("a", { parent_id: "b" }), no("b", { parent_id: "a" })];
    expect(dentroDaPasta("a", "inexistente", ciclo)).toBe(false);
    expect(pastasDaOrganizacao(ciclo)).toHaveLength(2);
    expect(linkDoWorkspaceDaOrganizacao(cliente, "campanha")).toBe("/workspace?client=cliente-a&pasta=campanha");
  });

  it("mostra a galeria, filtra por pasta e busca, e abre o planejamento pelo fluxo existente", async () => {
    const valor: MesaValor = { clientId: cliente, clientName: "Cliente A", userId: "operador", isAdmin: true, podeRecarregar: true, saldoUsd: 10, catalogo: [], catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn() };
    const onAbrirMes = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { unmount } = render(<QueryClientProvider client={qc}><MemoryRouter><MesaProvider valor={valor}><AbaOrganizacao onAbrirMes={onAbrirMes} /></MesaProvider></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText("Promoção.png")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar arquivos" }), { target: { value: "promocao" } });
    await waitFor(() => expect(screen.queryByText("arte.png")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /Campanha \/ Produto/ }));
    expect(screen.getByText("Promoção.png")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Workspace" }).getAttribute("href")).toBe("/workspace?client=cliente-a&pasta=produto");
    fireEvent.click(screen.getByRole("button", { name: "Planejar o mês" }));
    expect(onAbrirMes).toHaveBeenCalledOnce();
    unmount(); qc.clear();
  });

  it("22/10: Abrir mostra o arquivo na própria tela (visor grande), sem abrir aba nova, e a lateral fica parada", async () => {
    const valor: MesaValor = { clientId: cliente, clientName: "Cliente A", userId: "operador", isAdmin: true, podeRecarregar: true, saldoUsd: 10, catalogo: [], catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn() };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const abrirJanela = vi.spyOn(window, "open").mockImplementation(() => null);
    const { container, unmount } = render(<QueryClientProvider client={qc}><MemoryRouter><MesaProvider valor={valor}><AbaOrganizacao onAbrirMes={vi.fn()} /></MesaProvider></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText("Promoção.png")).toBeTruthy();
    expect(container.querySelector("[data-lateral-fixa]")?.className).toContain("md:sticky");
    const abrir = screen.queryAllByRole("button", { name: /^Abrir / });
    if (abrir.length) {
      fireEvent.click(abrir[0]);
      expect(await screen.findByRole("dialog")).toBeTruthy();
      expect(abrirJanela).not.toHaveBeenCalled();
    }
    abrirJanela.mockRestore();
    unmount(); qc.clear();
  });
});
