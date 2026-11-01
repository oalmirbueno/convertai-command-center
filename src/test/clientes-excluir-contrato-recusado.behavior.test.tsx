import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Excluir contrato (rascunho em PDF). O `.delete().eq("id")` não pedia as linhas apagadas: quando a RLS recusa,
 * o banco não dá erro, só apaga 0 linhas. A tela apagava o PDF do storage mesmo assim e dizia "Contrato
 * removido" (o contrato continuava, agora sem arquivo). Agora: sem linha apagada, avisa e não toca no storage.
 */

type Resposta = { data: unknown; error: unknown };

const estado = vi.hoisted(() => ({
  contratos: [] as unknown[],
  apagados: { data: [] as unknown, error: null as unknown },
  remover: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin", full_name: "Almir" }, user: { id: "u-1" } }) }));
vi.mock("@/hooks/useSupabaseData", () => ({ useClients: () => ({ data: [{ id: "cli-1", full_name: "Maria", company_name: "Padaria" }] }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: estado.toast }) }));
vi.mock("@/integrations/supabase/client", () => {
  const cadeia = () => {
    const c: Record<string, unknown> = {};
    c.select = () => c;
    c.order = () => c;
    c.eq = () => c;
    c.maybeSingle = () => Promise.resolve({ data: null, error: null });
    c.then = (ok: (r: Resposta) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve({ data: estado.contratos, error: null }).then(ok, erro);
    c.delete = () => {
      const d: Record<string, unknown> = {};
      d.eq = () => d;
      d.select = () => d;
      d.then = (ok: (r: Resposta) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(estado.apagados).then(ok, erro);
      return d;
    };
    return c;
  };
  return {
    supabase: {
      from: () => cadeia(),
      functions: { invoke: () => new Promise(() => {}) },
      storage: { from: () => ({ upload: vi.fn(), remove: (...a: unknown[]) => estado.remover(...a) }) },
    },
  };
});
vi.mock("@/lib/fileUrls", async () => {
  const real = await vi.importActual<Record<string, unknown>>("@/lib/fileUrls");
  return { ...real, useResolvedFileUrl: () => ({ url: "https://x/c.pdf", loading: false, error: null }), resolveFileUrl: vi.fn(async () => "https://x/c.pdf") };
});
vi.mock("@/components/contratos/AgenteDeContratos", () => ({ default: () => null }));

import AdminContracts from "@/pages/AdminContracts";

const RASCUNHO = {
  id: "c", title: "PDF sem assinatura", status: "draft", origem: "arquivo", description: null, client_id: "cli-1",
  original_file_url: "files://contracts/cli-1/1.pdf", original_file_name: "c.pdf", admin_signed_at: null, client_signed_at: null,
  sent_at: null, created_at: "2026-09-30T12:00:00Z", arquivado_em: null, substituido_por: null, numero: null, versao: 1,
};

function abrir() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/arquivos"]}>
        <AdminContracts clientId="cli-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function excluir() {
  fireEvent.click(await screen.findByRole("button", { name: "Excluir PDF sem assinatura" }));
  const janela = (await screen.findByText("Excluir contrato?")).closest(".space-y-4") as HTMLElement;
  fireEvent.click(within(janela).getByRole("button", { name: "Excluir" }));
}

beforeEach(() => {
  estado.contratos = [RASCUNHO];
  estado.remover = vi.fn(() => Promise.resolve({ error: null }));
  estado.toast = vi.fn();
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

describe("excluir contrato quando o banco recusa", () => {
  it("0 linhas apagadas (RLS): avisa que não excluiu e não apaga o PDF", async () => {
    estado.apagados = { data: [], error: null };
    abrir();
    await excluir();
    await waitFor(() => expect(estado.toast).toHaveBeenCalled());
    const aviso = estado.toast.mock.calls[0][0] as { title: string; variant?: string };
    expect(aviso.title).toBe("Não foi possível excluir o contrato");
    expect(aviso.variant).toBe("destructive");
    expect(estado.remover).not.toHaveBeenCalled();
  });

  it("linha apagada: remove o PDF e confirma", async () => {
    estado.apagados = { data: [{ id: "c" }], error: null };
    abrir();
    await excluir();
    await waitFor(() => expect(estado.toast).toHaveBeenCalled());
    expect((estado.toast.mock.calls[0][0] as { title: string }).title).toBe("Contrato removido");
    expect(estado.remover).toHaveBeenCalledTimes(1);
  });
});
