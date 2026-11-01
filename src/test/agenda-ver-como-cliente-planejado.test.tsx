import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * "Ver como cliente" precisa mostrar o MESMO cronograma que o cliente real vê.
 * A RLS (20260814150000_cliente_ve_cronograma_completo) e o filtro final do
 * hook entregam planejado, agendado e publicado; a consulta da visão forçada
 * pedia só agendado e publicado, e as planejadas sumiam da prévia.
 */

type Chamada = { tabela: string; metodo: string; args: unknown[] };
const chamadas: Chamada[] = [];

function respostaDe(tabela: string) {
  if (tabela === "editorial_posts") {
    return [
      {
        id: "post-1",
        client_id: "client-1",
        project_id: "project-1",
        primary_file_id: null,
        title: "Carrossel planejado",
        content_type: "carousel",
        objective: null,
        default_caption: null,
        production_status: "draft",
        version: 1,
        archived_at: null,
        created_at: "2026-11-01T12:00:00.000Z",
        updated_at: "2026-11-01T12:00:00.000Z",
      },
    ];
  }
  return [];
}

function consulta(tabela: string) {
  const alvo: Record<string, unknown> = {};
  const encadeia = new Proxy(alvo, {
    get(_, metodo: string) {
      if (metodo === "then") {
        return (resolver: (valor: unknown) => unknown) =>
          resolver({ data: respostaDe(tabela), error: null });
      }
      return (...args: unknown[]) => {
        chamadas.push({ tabela, metodo, args });
        return encadeia;
      };
    },
  });
  return encadeia;
}

vi.mock("@/integrations/supabase/client", () => {
  const canal = { on: () => canal, subscribe: () => canal };
  return {
    supabase: {
      from: (tabela: string) => consulta(tabela),
      rpc: () => Promise.resolve({ data: null, error: null }),
      channel: () => canal,
      removeChannel: () => undefined,
    },
  };
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" }, profile: { role: "admin" } }),
}));

import { useEditorialCalendar } from "@/hooks/useEditorialCalendar";

afterEach(() => {
  chamadas.length = 0;
});

function embrulho() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("ver como cliente: cronograma completo, como o cliente real", () => {
  it("as duas leituras de publicações pedem planejado, agendado e publicado", async () => {
    const { result } = renderHook(
      () =>
        useEditorialCalendar(
          {
            clientId: "client-1",
            rangeStart: "2026-11-01T03:00:00.000Z",
            rangeEnd: "2026-12-01T03:00:00.000Z",
          },
          { forceClientView: true },
        ),
      { wrapper: embrulho() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const filtrosDeStatus = chamadas.filter(
      (c) =>
        c.tabela === "editorial_publications" &&
        c.metodo === "in" &&
        c.args[0] === "status",
    );
    // Uma da leitura do período, outra da presença global do plano.
    expect(filtrosDeStatus).toHaveLength(2);
    for (const filtro of filtrosDeStatus) {
      expect(filtro.args[1]).toEqual(["planned", "scheduled", "published"]);
    }
  });

  it("a equipe, sem forçar a visão do cliente, não ganha recorte de status", async () => {
    const { result } = renderHook(
      () =>
        useEditorialCalendar({
          clientId: "client-1",
          rangeStart: "2026-11-01T03:00:00.000Z",
          rangeEnd: "2026-12-01T03:00:00.000Z",
        }),
      { wrapper: embrulho() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(
      chamadas.some(
        (c) =>
          c.tabela === "editorial_publications" &&
          c.metodo === "in" &&
          c.args[0] === "status",
      ),
    ).toBe(false);
  });
});
