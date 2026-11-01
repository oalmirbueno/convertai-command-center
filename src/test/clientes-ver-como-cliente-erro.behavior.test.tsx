import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Ver como cliente". A tela lia o cliente (ou o projeto) e fazia `if (!data) navigate("/clientes")`: numa falha
 * de rede o admin era jogado de volta para Clientes, como se o cliente não existisse. Agora erro de leitura
 * mostra o erro com "Tentar de novo"; só o "não encontrado" de verdade volta para /clientes.
 */

type Resposta = { data: unknown; error: unknown };

const estado = vi.hoisted(() => ({
  respostas: [] as Array<{ data: unknown; error: unknown }>,
  leituras: [] as string[],
}));

vi.mock("@/hooks/useSupabaseData", () => ({ useClients: () => ({ data: [], isLoading: false }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabela: string) => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.maybeSingle = () => {
        estado.leituras.push(tabela);
        return Promise.resolve<Resposta>(estado.respostas.shift() ?? { data: null, error: null });
      };
      return c;
    },
  },
}));

import AdminViewAsClient from "@/pages/AdminViewAsClient";

function Local() {
  const l = useLocation();
  return <p data-local="">{l.pathname}</p>;
}

function abrir(endereco: string) {
  return render(
    <MemoryRouter initialEntries={[endereco]}>
      <Routes>
        <Route path="/ver-como-cliente" element={<AdminViewAsClient />} />
        <Route path="/clientes" element={<p>Tela de clientes</p>} />
      </Routes>
      <Local />
    </MemoryRouter>,
  );
}

const local = () => document.querySelector("[data-local]")?.textContent;

beforeEach(() => {
  estado.respostas = [];
  estado.leituras = [];
});
afterEach(cleanup);

describe("Ver como cliente: erro de leitura não vira 'cliente não encontrado'", () => {
  it("falha ao ler o cliente: fica na tela, mostra o erro e Tentar de novo relê", async () => {
    estado.respostas = [{ data: null, error: { message: "rede caiu" } }, { data: null, error: null }];
    abrir("/ver-como-cliente?client=c1");
    expect(await screen.findByText("Não foi possível carregar o portal deste cliente.")).toBeTruthy();
    expect(local()).toBe("/ver-como-cliente");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    // A segunda leitura volta "não encontrado": aí sim vai para Clientes.
    await waitFor(() => expect(local()).toBe("/clientes"));
    expect(estado.leituras).toEqual(["profiles", "profiles"]);
  });

  it("falha ao ler o projeto do endereço: mostra o erro em vez de voltar para Clientes", async () => {
    estado.respostas = [{ data: null, error: { message: "rede caiu" } }];
    abrir("/ver-como-cliente?project=p1");
    expect(await screen.findByText("Não foi possível carregar o portal deste cliente.")).toBeTruthy();
    expect(local()).toBe("/ver-como-cliente");
    expect(estado.leituras).toEqual(["projects"]);
  });

  it("cliente que não existe (sem erro): volta para Clientes", async () => {
    estado.respostas = [{ data: null, error: null }];
    abrir("/ver-como-cliente?client=c1");
    await waitFor(() => expect(local()).toBe("/clientes"));
  });
});
