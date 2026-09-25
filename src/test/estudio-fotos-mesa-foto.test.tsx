import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Estúdio, 25/09 (dono): "escolho do acervo, que são as fotos que foram
 * feitas na Mesa Foto. Não tem aqui"; "salvar lâmina não atualiza"; "tem que
 * ser mais simplificado". A ferramenta Fotos tem Acervo | Mesa Foto | Subir,
 * a aba Mesa Foto lista as fotos de lá (aprovadas primeiro, Canvas, detalhe
 * 4K) e a escolha grava na lâmina na hora, pelo próprio caminho no bucket mesa.
 */

const CLIENTE = "11111111-1111-1111-1111-111111111111";

const mock = vi.hoisted(() => ({ upload: vi.fn(), download: vi.fn(), tabelas: {} as Record<string, any[]>, filtros: [] as string[] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    from: (tabela: string) => {
      const filtros: ((r: any) => boolean)[] = [];
      const b: any = {
        select: () => b,
        order: () => b,
        limit: () => b,
        range: () => b,
        eq: (c: string, v: unknown) => {
          mock.filtros.push(`${tabela}.${c}=${String(v)}`);
          filtros.push((r) => r[c] === v);
          return b;
        },
        then: (ok: any, erro: any) => Promise.resolve({ data: (mock.tabelas[tabela] || []).filter((r) => filtros.every((f) => f(r))), error: null }).then(ok, erro),
      };
      return b;
    },
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: vi.fn(async () => ({ data: { signedUrl: "https://x/y.png" }, error: null })),
        upload: mock.upload,
        download: mock.download,
      })),
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import EstudioFotos, { caminhoDiretoDoAcervo, filtrarDaMesaFoto, filtroInicialDaMesaFoto, podeIrParaLamina, type FotoDaMesaFoto } from "@/components/mesa/EstudioFotos";
import { pastaDaFoto, pastasDoAcervo, PASTA_MESA_FOTO } from "@/lib/mesa/pastas";

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

function montar(filho: any, rota = "/mesa?aba=estudio") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(MemoryRouter, { initialEntries: [rota] }, h(QueryClientProvider, { client: qc }, h(MesaProvider, { valor: valorDaMesa() }, filho))));
}

const foto = (id: string, extra: Partial<FotoDaMesaFoto>): FotoDaMesaFoto & { client_id: string; ativa: boolean } => ({
  id,
  client_id: CLIENTE,
  ativa: true,
  storage_bucket: "mesa",
  storage_path: `${CLIENTE}/foto/ensaios/${id}.png`,
  nome: `Foto ${id}`,
  pasta: "Mesa Foto / Ensaios",
  categoria: "produto",
  tags: ["mesa_foto"],
  descricao: null,
  origem: "mesa_foto",
  aprovada: false,
  gerada: true,
  modo: "ensaio",
  criado_em: "2026-09-24T10:00:00Z",
  ...extra,
});

const APROVADA = foto("a1", { aprovada: true, tags: ["mesa_foto", "ensaio"], criado_em: "2026-09-24T12:00:00Z" });
const CANVAS = foto("c1", { modo: "canvas", tags: ["mesa_foto", "canvas", "gerada"], storage_path: `${CLIENTE}/foto/canvas/c1.png`, criado_em: "2026-09-25T09:00:00Z" });
const DETALHE = foto("d1", { modo: "detalhe", tags: ["mesa_foto", "detalhe_4k", "gerada"], storage_path: `${CLIENTE}/foto/detalhes/d1.png` });
const WEB = foto("w1", { gerada: false, modo: null, tags: ["mesa_foto", "referencia_web", "nao_publicar"] });

beforeEach(() => {
  mock.upload.mockReset();
  mock.download.mockReset();
  mock.filtros.length = 0;
  mock.tabelas = { cliente_imagens: [APROVADA, CANVAS, DETALHE, WEB] };
});

describe("fotos da Mesa Foto: regras puras", () => {
  it("filtros: aprovadas, Canvas, detalhe 4K; referência da internet nunca entra; mais novas primeiro", () => {
    const lista = [APROVADA, CANVAS, DETALHE, WEB];
    expect(filtrarDaMesaFoto(lista, "aprovadas").map((f) => f.id)).toEqual(["a1"]);
    expect(filtrarDaMesaFoto(lista, "canvas").map((f) => f.id)).toEqual(["c1"]);
    expect(filtrarDaMesaFoto(lista, "detalhe").map((f) => f.id)).toEqual(["d1"]);
    expect(filtrarDaMesaFoto(lista, "todas").map((f) => f.id)).toEqual(["c1", "a1", "d1"]);
    expect(podeIrParaLamina(WEB)).toBe(false);
    expect(filtroInicialDaMesaFoto(lista)).toBe("aprovadas");
    expect(filtroInicialDaMesaFoto([CANVAS])).toBe("todas");
  });

  it("foto do bucket mesa na pasta do cliente entra pelo próprio caminho; a de outro bucket é copiada", () => {
    expect(caminhoDiretoDoAcervo(CLIENTE, APROVADA)).toBe(APROVADA.storage_path);
    expect(caminhoDiretoDoAcervo(CLIENTE, { storage_bucket: "workspace", storage_path: `${CLIENTE}/ws/a.jpg` })).toBeNull();
    expect(caminhoDiretoDoAcervo(CLIENTE, { storage_bucket: "mesa", storage_path: "globais/x.jpg" })).toBeNull();
    expect(caminhoDiretoDoAcervo(CLIENTE, { storage_bucket: "mesa", storage_path: `${CLIENTE}/../outro/x.jpg` })).toBeNull();
  });

  it("no acervo, as fotos da Mesa Foto ganham a pasta Mesa Foto (antes: Fora do Workspace)", () => {
    const { pastas, pastaDoNo } = pastasDoAcervo([], [{ origem: "mesa_foto", workspace_node_id: null, pasta: "Mesa Foto / Canvas" }]);
    expect(pastaDaFoto({ origem: "mesa_foto" }, pastaDoNo)).toBe(PASTA_MESA_FOTO);
    expect(pastas.map((p) => p.nome)).toEqual(["Mesa Foto"]);
  });
});

describe("ferramenta Fotos: Acervo | Mesa Foto | Subir", () => {
  it("aba Mesa Foto lê só origem mesa_foto, abre nas aprovadas e grava a escolha na hora, sem upload", async () => {
    const onSalvar = vi.fn().mockResolvedValue(undefined);
    montar(h(EstudioFotos, { card: { ordem: 3, fotos_livres: [] }, ocupado: false, temArte: false, onSalvar }));
    expect(screen.getAllByRole("tab").map((t) => t.textContent && t.textContent.trim())).toEqual(["Acervo", "Mesa Foto", "Subir"]);
    fireEvent.click(screen.getByRole("tab", { name: /Mesa Foto/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Usar nesta lâmina: Foto a1" })).toBeTruthy());
    expect(mock.filtros).toContain("cliente_imagens.origem=mesa_foto");
    // Abre nas aprovadas: a do Canvas aparece ao trocar o filtro; a referência da internet nunca.
    expect(screen.queryByRole("button", { name: "Usar nesta lâmina: Foto c1" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Canvas/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Usar nesta lâmina: Foto c1" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Todas/ }));
    expect(screen.queryByRole("button", { name: "Usar nesta lâmina: Foto w1" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Usar nesta lâmina: Foto c1" }));
    await waitFor(() => expect(onSalvar).toHaveBeenCalledWith({ card: { ordem: 3, fotos_livres: [{ caminho: CANVAS.storage_path, papel: "fundo" }] } }));
    expect(mock.upload).not.toHaveBeenCalled();
    expect(mock.download).not.toHaveBeenCalled();
  });

  it("vindo da Mesa Foto (&fotos=) abre na aba Mesa Foto e mostra as fotos que vieram", async () => {
    montar(h(EstudioFotos, { card: { ordem: 1, fotos_livres: [] }, ocupado: false, temArte: false, onSalvar: vi.fn() }), `/mesa?aba=estudio&fotos=${APROVADA.id}`);
    expect(screen.getByRole("tab", { name: /Mesa Foto/ }).getAttribute("aria-selected")).toBe("true");
    await waitFor(() => expect(screen.getByText("Fotos que vieram da Mesa Foto")).toBeTruthy());
  });

  it("a ferramenta abre sozinha no Estúdio quando a URL traz fotos da Mesa Foto", () => {
    const estudio = readFileSync(resolve(__dirname, "../..", "src/components/mesa/AbaEstudio.tsx"), "utf8");
    expect(estudio).toContain('if (fotosNaUrl && estado === "producao") abrirFerramenta("fotos", false);');
  });
});
