import { createElement as h, type ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { createHash } from "node:crypto";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";

/**
 * Importar, editor de código e galeria na tela (Gravyx, 19/10/2026), com a
 * função e o Storage falsos: "Usar modelo" cria o site do modelo e abre no
 * Briefing; o HTML escolhido é conferido na tela, sobe como zip limpo e vira
 * site_importar; o .env recusa antes de subir; o editor abre o zip do motor,
 * e o Salvar manda só o arquivo mudado com a marca de quando foi aberto.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), upload: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    storage: { from: () => ({ upload: mock.upload }) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() } }));

import GaleriaDeModelos from "@/components/mesa-site/GaleriaDeModelos";
import ImportarSite from "@/components/mesa-site/ImportarSite";
import EditorDeCodigo from "@/components/mesa-site/EditorDeCodigo";
import type { LinhaDoSite } from "@/components/mesa-site/siteApi";

const CLIENTE = "22222222-2222-4222-8222-222222222222";
const SITE = "33333333-3333-4333-8333-333333333333";

const valor = (): MesaValor =>
  ({ clientId: CLIENTE, clientName: "Padaria", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 10, catalogo: [], catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(), marcas: [], marca: null }) as unknown as MesaValor;

function montar(filho: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(MesaProvider, { valor: valor(), children: filho }))));
}

const corpos = (acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[0] === "mesa-site" && c[1].body.acao === acao).map((c: any[]) => c[1].body);

beforeEach(() => {
  mock.invoke.mockReset();
  mock.upload.mockReset();
  mock.invoke.mockImplementation(async (_f: string, o: { body: { acao: string } }) => {
    if (o.body.acao === "sites_listar") return { data: { sites: [{ id: "x", nome: "Página de vendas Padaria" }] }, error: null };
    if (o.body.acao === "site_do_modelo") return { data: { site: { id: SITE } }, error: null };
    if (o.body.acao === "site_importar") return { data: { site: { id: SITE }, trabalho: { id: "t-1" } }, error: null };
    return { data: {}, error: null };
  });
  mock.upload.mockResolvedValue({ data: {}, error: null });
});

describe("galeria de modelos", () => {
  it("lista os cinco modelos e Usar modelo cria o site do modelo com nome livre e abre no Briefing", async () => {
    const onAbrir = vi.fn();
    const { container } = montar(h(GaleriaDeModelos, { marcaId: null, onAbrir }));
    // 25/10: os modelos esquemáticos ficam recolhidos embaixo dos sites prontos; a seta abre.
    expect(container.querySelectorAll("[data-modelo]").length).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: /Modelos de página/ }));
    expect(container.querySelectorAll("[data-modelo]").length).toBe(5);
    await waitFor(() => expect(corpos("sites_listar").length).toBe(1));
    await new Promise((r) => setTimeout(r, 20));
    fireEvent.click(container.querySelector('[data-usar-modelo="vendas"]')!);
    await waitFor(() => expect(onAbrir).toHaveBeenCalledWith(SITE, "briefing"));
    expect(corpos("site_do_modelo")[0]).toMatchObject({ client_id: CLIENTE, modelo: "vendas", nome: "Página de vendas Padaria 2" });
  });
});

describe("importar site", () => {
  it("um HTML: confere na tela, sobe o zip limpo na pasta de importação e pede site_importar", async () => {
    const onImportado = vi.fn();
    const onMudar = vi.fn();
    montar(h(ImportarSite, { aberta: true, onMudar, marcaId: null, onImportado }));
    const entrada = document.querySelector("[data-entrada-html]") as HTMLInputElement;
    fireEvent.change(entrada, { target: { files: [new File(["<h1>Pão quente</h1>"], "landing.html", { type: "text/html" })] } });
    await waitFor(() => expect(document.querySelector('[data-analise-da-importacao="ok"]')).not.toBeNull());
    expect(screen.getByText("Página HTML única")).toBeTruthy();
    fireEvent.click(document.querySelector("[data-confirmar-importacao]")!);
    await waitFor(() => expect(onImportado).toHaveBeenCalledWith(SITE));
    const [path, blob, opcoes] = mock.upload.mock.calls[0];
    expect(path).toMatch(new RegExp(`^${CLIENTE}/site/importacao/[a-z0-9-]+\\.zip$`));
    expect(opcoes).toMatchObject({ contentType: "application/zip", upsert: false });
    const zip = await JSZip.loadAsync(blob as Blob);
    expect(Object.keys(zip.files)).toEqual(["index.html"]);
    expect(corpos("site_importar")[0]).toMatchObject({ client_id: CLIENTE, origem: "html", path, nome: "Site landing", framework: "Página HTML única", manifesto: [{ caminho: "index.html", bytes: expect.any(Number) }] });
  });

  it("uma pasta com .env é recusada na tela, com o arquivo, e nada sobe", async () => {
    montar(h(ImportarSite, { aberta: true, onMudar: vi.fn(), marcaId: null, onImportado: vi.fn() }));
    const comCaminho = (conteudo: string, caminho: string) => Object.assign(new File([conteudo], caminho.split("/").pop()!), { webkitRelativePath: caminho });
    fireEvent.change(document.querySelector("[data-entrada-pasta]")!, { target: { files: [comCaminho("<h1>oi</h1>", "site/index.html"), comCaminho("CHAVE=1", "site/.env")] } });
    await waitFor(() => expect(document.querySelector('[data-analise-da-importacao="segredo"]')).not.toBeNull());
    expect(screen.getByText(".env: arquivo .env (variáveis e chaves)")).toBeTruthy();
    expect((document.querySelector("[data-confirmar-importacao]") as HTMLButtonElement).disabled).toBe(true);
    expect(mock.upload).not.toHaveBeenCalled();
  });
});

describe("editor de código", () => {
  it("abre o zip do motor, edita e o Salvar manda só o arquivo mudado com a marca de quando abriu", async () => {
    const original = "export default function Hero() {\n  return <h1>Antes</h1>;\n}\n";
    const z = new JSZip();
    z.file("site-33333333/src/secoes/Hero.tsx", original);
    z.file("site-33333333/package.json", "{}");
    z.file("site-33333333/public/logo.png", new Uint8Array([137, 80, 78, 71]));
    const bytes = await z.generateAsync({ type: "uint8array" });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })));
    mock.invoke.mockImplementation(async (_f: string, o: { body: { acao: string } }) => {
      if (o.body.acao === "codigo_ler") return { data: { zip: { url: "https://x/zip", commit: "abc12345def", em: "2026-10-19T12:00:00Z" }, rascunho: { aberto: false, em_andamento: false } }, error: null };
      if (o.body.acao === "codigo_salvar") return { data: { trabalho: { id: "t-9" } }, error: null };
      return { data: {}, error: null };
    });
    const site = { id: SITE, client_id: CLIENTE, nome: "Site", projeto: "site-33333333" } as LinhaDoSite;
    montar(h(EditorDeCodigo, { site, aberta: true, onMudar: vi.fn() }));
    const caixa = (await waitFor(() => {
      const c = document.querySelector("[data-caixa-do-codigo]") as HTMLTextAreaElement | null;
      expect(c && c.value).toBe(original);
      return c;
    })) as HTMLTextAreaElement;
    expect(caixa.readOnly).toBe(false);
    fireEvent.change(caixa, { target: { value: original.replace("Antes", "Depois") } });
    fireEvent.click(document.querySelector("[data-salvar-codigo]")!);
    await waitFor(() => expect(corpos("codigo_salvar").length).toBe(1));
    expect(corpos("codigo_salvar")[0]).toEqual({
      acao: "codigo_salvar",
      site_id: SITE,
      de: "abc12345def",
      arquivos: [{ caminho: "src/secoes/Hero.tsx", conteudo: original.replace("Antes", "Depois"), sha_antes: createHash("sha256").update(original).digest("hex") }],
    });
    vi.unstubAllGlobals();
  });
});
