import { createElement as h, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 26/10/2026: as fotos dos clientes caiam nas iniciais. O link da foto do
 * Instagram (CDN da Meta) vence em ~4 dias pelo `oe=` e a recaptura e a cada
 * 7; 11 clientes com logo nos arquivos nem chegavam a tentar a logo.
 */

const banco = vi.hoisted(() => ({
  tabelas: [] as Array<{ tabela: string; select: unknown[] }>,
  linhas: {} as Record<string, unknown[]>,
  assinaturas: [] as Array<{ bucket: string; caminhos: string[] }>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const registro = { tabela, select: [] as unknown[] };
    banco.tabelas.push(registro);
    const q: any = {};
    for (const m of ["not", "is", "ilike", "or", "order", "limit", "in", "eq"]) q[m] = () => q;
    q.select = (...args: unknown[]) => { registro.select = args; return q; };
    q.then = (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
      Promise.resolve({ data: banco.linhas[tabela] ?? [], error: null, count: 0 }).then(ok, erro);
    return q;
  };
  return {
    supabase: {
      from: consulta,
      storage: {
        from: (bucket: string) => ({
          createSignedUrls: async (caminhos: string[]) => {
            banco.assinaturas.push({ bucket, caminhos });
            return { data: caminhos.map((p) => ({ path: p, signedUrl: `https://assinada/${p}`, error: null })), error: null };
          },
        }),
      },
    },
  };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-1" }, profile: { role: "admin" } }) }));

import { candidatasDaFoto, linkDaMetaVencido, vencimentoDoLinkDaMeta } from "@/lib/fotoDoCliente";
import { useFotosDosClientes } from "@/hooks/useFotosDosClientes";
import FotoDoCliente from "@/components/clients/FotoDoCliente";
import LogoDoCliente from "@/components/admin/LogoDoCliente";

const AGORA = Date.parse("2026-10-26T12:00:00Z");
const hex = (ms: number) => Math.floor(ms / 1000).toString(16);
const ig = (venceEm: number) => `https://scontent.cdninstagram.com/v/t51/foto.jpg?stp=dst&oh=00_ab&oe=${hex(venceEm)}&_nc_sid=1`;

afterEach(() => cleanup());

describe("o link da Meta vence", () => {
  it("le o oe= em hexadecimal como segundos", () => {
    const vence = Date.parse("2026-10-24T00:00:00Z");
    expect(vencimentoDoLinkDaMeta(ig(vence))).toBe(vence);
    expect(linkDaMetaVencido(ig(vence), AGORA)).toBe(true);
    expect(linkDaMetaVencido(ig(AGORA + 86_400_000), AGORA)).toBe(false);
  });

  it("link de fora da Meta, ou sem oe=, nao e julgado", () => {
    expect(linkDaMetaVencido("https://x.supabase.co/storage/v1/object/sign/files/a.png?token=t&oe=1", AGORA)).toBe(false);
    expect(linkDaMetaVencido("https://scontent.fbcdn.net/v/foto.jpg", AGORA)).toBe(false);
  });
});

describe("as candidatas da foto", () => {
  it("cadastro, logo leve e Instagram valido, nessa ordem", () => {
    const valido = ig(AGORA + 86_400_000);
    expect(candidatasDaFoto({ avatarUrl: "a", logoUrl: "l", instagramUrl: valido, agora: AGORA })).toEqual([
      { url: "a", tipo: "foto" },
      { url: "l", tipo: "logo" },
      { url: valido, tipo: "instagram" },
    ]);
  });

  it("o Instagram vencido sai da lista, e a logo vira a primeira", () => {
    const vencido = ig(AGORA - 1000);
    expect(candidatasDaFoto({ logoUrl: "l", instagramUrl: vencido, agora: AGORA })).toEqual([{ url: "l", tipo: "logo" }]);
    expect(candidatasDaFoto({ instagramUrl: vencido, agora: AGORA })).toEqual([]);
  });
});

describe("FotoDoCliente quando a imagem nao abre", () => {
  it("passa para a logo e so depois mostra as iniciais", () => {
    const daqui = Date.now() + 86_400_000;
    render(h(FotoDoCliente, {
      nome: "Mirante Luz",
      fotos: [{ url: ig(daqui), tipo: "instagram" }, { url: "https://assinada/logo.png.mini.jpg", tipo: "logo" }],
    }));
    const primeira = screen.getByRole("img", { name: "Mirante Luz" }) as HTMLImageElement;
    expect(primeira.tagName).toBe("IMG");
    expect(primeira.src).toContain("cdninstagram");

    fireEvent.error(primeira);
    const segunda = screen.getByRole("img", { name: "Mirante Luz" }) as HTMLImageElement;
    expect(segunda.tagName).toBe("IMG");
    expect(segunda.src).toBe("https://assinada/logo.png.mini.jpg");

    fireEvent.error(segunda);
    const iniciais = screen.getByRole("img", { name: "Mirante Luz" });
    expect(iniciais.tagName).toBe("DIV");
    expect(iniciais.textContent).toBe("ML");
  });

  it("Instagram vencido nem chega a ser pedido", () => {
    render(h(FotoDoCliente, { nome: "Stop", fotos: [{ url: ig(Date.now() - 1000), tipo: "instagram" }] }));
    expect(screen.getByRole("img", { name: "Stop" }).tagName).toBe("DIV");
  });
});

describe("useFotosDosClientes", () => {
  let qc: QueryClient;
  const envolver = ({ children }: { children: ReactNode }) => h(QueryClientProvider, { client: qc }, children);

  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    banco.tabelas = [];
    banco.assinaturas = [];
    banco.linhas = {
      profiles: [{ id: "c3", avatar_url: "https://cadastro/c3.jpg" }],
      social_client_identity: [
        { client_id: "c1", external_account_id: "ig1", username: "mirante", profile_picture_url: ig(Date.now() - 1000), captured_at: "2026-10-15T00:00:00Z" },
      ],
      files: [
        { id: "f1", client_id: "c1", file_name: "logo principal.png", file_url: "files://c1/logo principal.png", storage_bucket: "files", storage_path: "c1/logo principal.png", mime_type: "image/png", created_at: "2026-09-01T00:00:00Z" },
        { id: "f2", client_id: "c2", file_name: "marca.jpg", file_url: "files://c2/marca.jpg", storage_bucket: "files", storage_path: "c2/marca.jpg", mime_type: "image/jpeg", created_at: "2026-09-01T00:00:00Z" },
      ],
    };
  });

  it("uma consulta para a carteira toda, logo de todos, assinada em lote pela miniatura", async () => {
    const { result } = renderHook(() => useFotosDosClientes(), { wrapper: envolver });
    await waitFor(() => expect(result.current.fotosDe("c2")).toHaveLength(1));

    // c1 tem Instagram (vencido) e mesmo assim a logo foi procurada e entra.
    expect(result.current.fotosDe("c1")).toEqual([{ url: "https://assinada/c1/logo principal.png.mini.jpg", tipo: "logo" }]);
    expect(result.current.fotosDe("c2")).toEqual([{ url: "https://assinada/c2/marca.jpg.mini.jpg", tipo: "logo" }]);
    expect(result.current.fotoDe("c3")).toEqual({ url: "https://cadastro/c3.jpg", tipo: "foto" });

    // Uma assinatura so para o bucket, miniatura antes do original.
    expect(banco.assinaturas).toEqual([{
      bucket: "files",
      caminhos: ["c1/logo principal.png.mini.jpg", "c1/logo principal.png", "c2/marca.jpg.mini.jpg", "c2/marca.jpg"],
    }]);
    // Chave estavel, sem a lista de ids.
    expect(qc.getQueryCache().findAll({ queryKey: ["fotos-dos-clientes"] }).map((q) => q.queryKey)).toEqual([["fotos-dos-clientes", "u-1"]]);
  });

  it("nao le social_post_metrics", async () => {
    const { result } = renderHook(() => useFotosDosClientes(), { wrapper: envolver });
    await waitFor(() => expect(result.current.fotosDe("c2")).toHaveLength(1));
    expect(banco.tabelas.map((t) => t.tabela)).not.toContain("social_post_metrics");
  });

  it("duas contas empatadas so contam posts com head (nenhuma linha vem)", async () => {
    banco.linhas.social_client_identity = [
      { client_id: "c1", external_account_id: "a", username: "outra", profile_picture_url: ig(Date.now() + 86_400_000), captured_at: "2026-10-15T00:00:00Z" },
      { client_id: "c1", external_account_id: "b", username: "terceira", profile_picture_url: ig(Date.now() + 86_400_000), captured_at: "2026-10-15T00:00:00Z" },
    ];
    const { result } = renderHook(() => useFotosDosClientes(), { wrapper: envolver });
    await waitFor(() => expect(result.current.fotosDe("c2")).toHaveLength(1));
    const posts = banco.tabelas.filter((t) => t.tabela === "social_post_metrics");
    expect(posts).toHaveLength(2);
    for (const p of posts) expect(p.select[1]).toEqual({ count: "exact", head: true });
  });

  it("FotoDoCliente com clienteId busca sozinho e o LogoDoCliente cai na logo quando o Instagram vence", async () => {
    render(h(QueryClientProvider, { client: qc },
      h(LogoDoCliente, { url: ig(Date.now() - 1000), nome: "Mirante", clienteId: "c1", tamanho: 32 })));
    const img = await screen.findByRole("img", { name: "Logo de Mirante" }) as HTMLImageElement;
    expect(img.src).toBe("https://assinada/c1/logo%20principal.png.mini.jpg");
  });
});
