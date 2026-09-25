import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Marcas por projeto na tela (pedido do dono em 25/09): seletor "Marca" ao
 * lado do cliente só quando o cliente tem 2 ou mais marcas (Acerbi e CME),
 * marca no endereço, marca_id nas chamadas e o kit da CME no Contexto.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), from: vi.fn(), update: vi.fn(), upload: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    rpc: mock.rpc,
    from: mock.from,
    storage: { from: () => ({ upload: mock.upload, remove: vi.fn(async () => ({})), createSignedUrl: vi.fn(async () => ({ data: null, error: new Error("x") })) }) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));

const ACERBI_CLIENTE = "39ebda82-637c-498b-a23a-b622f645e852";
const OUTRO_CLIENTE = "22222222-2222-2222-2222-222222222222";
const ID_ACERBI = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID_CME = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

vi.mock("@/hooks/useSupabaseData", () => ({
  useClients: () => ({
    data: [
      { id: "39ebda82-637c-498b-a23a-b622f645e852", company_name: "Acerbi" },
      { id: "22222222-2222-2222-2222-222222222222", company_name: "Ótica Visão" },
    ],
    isLoading: false,
    isSuccess: true,
    isFetching: false,
    dataUpdatedAt: 1,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/components/mesa/MesaContexto", async (original) => ({
  ...(await original<typeof import("@/components/mesa/MesaContexto")>()),
  useCatalogo: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/components/mesa/AbaContexto", () => ({ default: () => <p>aba contexto aberta</p> }));
vi.mock("@/components/mesa/AbaMes", () => ({ default: () => <p>aba mês</p> }));
vi.mock("@/components/mesa/AbaCampanhas", () => ({ default: () => <p>aba campanhas</p> }));
vi.mock("@/components/mesa/AbaEstudio", () => ({ default: () => <p>aba estúdio</p> }));
vi.mock("@/components/mesa/AbaEntrega", () => ({ default: () => <p>aba entrega</p> }));

import MesaDoCliente from "@/pages/MesaDoCliente";
import SeletorDeMarca from "@/components/mesa/SeletorDeMarca";
import ContextoKitDaMarca, { caminhoDaLogoDaMarca } from "@/components/mesa/ContextoKitDaMarca";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import { chamarFuncao } from "@/lib/mesa/api";
import type { MarcaDoCliente } from "@/lib/mesa/marcas";

const linhaDaMarca = (extra: Partial<MarcaDoCliente>): MarcaDoCliente => ({
  id: ID_ACERBI,
  client_id: ACERBI_CLIENTE,
  project_id: "1a55e3e5-0000-4000-8000-000000000001",
  nome: "Acerbi",
  principal: true,
  ordem: 0,
  paleta: [],
  logo_path: null,
  logo_alt_path: null,
  logo_file_id: null,
  logo_alt_file_id: null,
  estilo: null,
  regras: null,
  tom: null,
  contexto_extra: null,
  ...extra,
});
const ACERBI = linhaDaMarca({});
const CME = linhaDaMarca({ id: ID_CME, project_id: "a220d8f6-0000-4000-8000-000000000003", nome: "CME", principal: false, ordem: 1 });

let marcasNoBanco: Record<string, unknown[] | "erro"> = {};

function consulta(tabela: string) {
  let cliente = "";
  const cadeia: any = {};
  for (const m of ["select", "order", "limit", "in", "neq", "is", "not", "range"]) cadeia[m] = () => cadeia;
  cadeia.eq = (col: string, v: string) => {
    if (col === "client_id") cliente = v;
    return cadeia;
  };
  cadeia.update = (campos: unknown) => {
    mock.update(tabela, campos);
    return cadeia;
  };
  const resposta = () => {
    if (tabela === "cliente_marcas") {
      const r = marcasNoBanco[cliente];
      if (r === "erro") return { data: null, error: { code: "42P01", message: "relation does not exist" } };
      return { data: r || [], error: null };
    }
    return { data: [], error: null };
  };
  cadeia.maybeSingle = async () => ({ data: null, error: null });
  cadeia.single = cadeia.maybeSingle;
  cadeia.then = (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(resposta()).then(ok, erro);
  return cadeia;
}

beforeAll(() => {
  if (typeof (globalThis as any).ResizeObserver === "undefined") {
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
  marcasNoBanco = { [ACERBI_CLIENTE]: [ACERBI, CME] };
  mock.from.mockImplementation((t: string) => consulta(t));
  mock.rpc.mockResolvedValue({ data: { saldo_usd: 10, total_usd: 0, por_modelo: [], por_tarefa: [] }, error: null });
  mock.invoke.mockResolvedValue({ data: { ok: true }, error: null });
});

function Endereco() {
  const loc = useLocation();
  return <output data-testid="endereco">{loc.search}</output>;
}

function montar(inicial: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[inicial]}>
        <MesaDoCliente />
        <Endereco />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("seletor de marca na casca da Mesa", () => {
  it("cliente com Acerbi e CME: seletor ao lado do cliente, a principal aberta de início", async () => {
    montar(`/mesa?client=${ACERBI_CLIENTE}&aba=mes`);
    const grupo = await screen.findByRole("radiogroup", { name: "Marca do cliente" });
    const opcoes = grupo.querySelectorAll('[role="radio"]');
    expect(Array.prototype.map.call(opcoes, (o: HTMLElement) => o.textContent)).toEqual(["Acerbi", "CME"]);
    expect(screen.getByRole("radio", { name: "Acerbi" }).getAttribute("aria-checked")).toBe("true");
  });

  it("trocar para a CME grava no endereço e as chamadas levam marca_id da CME", async () => {
    montar(`/mesa?client=${ACERBI_CLIENTE}&aba=mes&task=${ID_ACERBI}`);
    fireEvent.click(await screen.findByRole("radio", { name: "CME" }));
    await waitFor(() => expect(screen.getByTestId("endereco").textContent).toContain(`marca=${ID_CME}`));
    // item aberto de outra marca fecha
    expect(screen.getByTestId("endereco").textContent).not.toContain("task=");
    expect(screen.getByRole("radio", { name: "CME" }).getAttribute("aria-checked")).toBe("true");
    await act(async () => {
      await chamarFuncao("agente-calendario", { acao: "propor_temas", client_id: ACERBI_CLIENTE });
    });
    expect(mock.invoke).toHaveBeenCalledWith("agente-calendario", { body: { acao: "propor_temas", client_id: ACERBI_CLIENTE, marca_id: ID_CME } });
  });

  it("endereço com a CME abre direto nela", async () => {
    montar(`/mesa?client=${ACERBI_CLIENTE}&aba=contexto&marca=${ID_CME}`);
    await waitFor(() => expect(screen.getByRole("radio", { name: "CME" }).getAttribute("aria-checked")).toBe("true"));
  });

  it("cliente com uma marca só: nada de seletor e o corpo das chamadas não muda", async () => {
    montar(`/mesa?client=${OUTRO_CLIENTE}&aba=mes`);
    await screen.findByText("aba mês");
    await waitFor(() => expect(mock.from).toHaveBeenCalledWith("cliente_marcas"));
    expect(screen.queryByRole("radiogroup", { name: "Marca do cliente" })).toBeNull();
    const corpo = { acao: "gravar", proposta_id: "p" };
    await act(async () => {
      await chamarFuncao("agente-calendario", corpo);
    });
    expect(mock.invoke.mock.calls[mock.invoke.mock.calls.length - 1][1].body).toBe(corpo);
  });

  it("banco ainda sem a tabela de marcas: a Mesa abre igual, sem seletor", async () => {
    marcasNoBanco = { [ACERBI_CLIENTE]: "erro" };
    montar(`/mesa?client=${ACERBI_CLIENTE}&aba=mes`);
    await screen.findByText("aba mês");
    await waitFor(() => expect(mock.from).toHaveBeenCalledWith("cliente_marcas"));
    expect(screen.queryByRole("radiogroup", { name: "Marca do cliente" })).toBeNull();
  });

  it("componente sozinho: some com menos de 2 marcas e um toque escolhe", () => {
    const escolher = vi.fn();
    const { container, rerender } = render(<SeletorDeMarca marcas={[ACERBI]} valor={ID_ACERBI} onEscolher={escolher} />);
    expect(container.innerHTML).toBe("");
    rerender(<SeletorDeMarca marcas={[ACERBI, CME]} valor={ID_ACERBI} onEscolher={escolher} />);
    fireEvent.click(screen.getByRole("radio", { name: "Acerbi" }));
    expect(escolher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "CME" }));
    expect(escolher).toHaveBeenCalledWith(ID_CME);
  });
});

describe("kit da CME no Contexto", () => {
  const valor = (): MesaValor => ({
    clientId: ACERBI_CLIENTE,
    clientName: "Acerbi",
    userId: "u-1",
    isAdmin: true,
    podeRecarregar: true,
    saldoUsd: 10,
    catalogo: [],
    catalogoCarregando: false,
    atualizarCusto: () => undefined,
    abrirRecarga: () => undefined,
    abrirChaves: () => undefined,
    abrirModelos: () => undefined,
    marcas: [ACERBI, CME],
    marca: CME,
  });

  function montarKit(m: MarcaDoCliente) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <MesaProvider valor={valor()}>
          <ContextoKitDaMarca marca={m} />
        </MesaProvider>
      </QueryClientProvider>,
    );
  }

  it("logo da CME no bucket mesa sob a pasta do cliente", () => {
    expect(caminhoDaLogoDaMarca(ACERBI_CLIENTE, ID_CME, false, "jpeg", 5)).toBe(`${ACERBI_CLIENTE}/marcas/${ID_CME}/logo-5.jpg`);
    expect(caminhoDaLogoDaMarca(ACERBI_CLIENTE, ID_CME, true, "png", 5)).toBe(`${ACERBI_CLIENTE}/marcas/${ID_CME}/logo-alternativa-5.png`);
  });

  it("sem logo avisa que nunca usa a do cliente; salvar grava paleta, estilo e tom na marca", async () => {
    montarKit(linhaDaMarca({ ...CME, paleta: [{ nome: "Rosa", hex: "#E91E63", papel: "principal" }], estilo: "leve" }));
    expect(screen.getByText(/Kit próprio da marca/)).toBeTruthy();
    expect(screen.getAllByText(/nunca usa a do cliente/).length).toBe(2);
    fireEvent.change(screen.getByPlaceholderText("Vazio: usa o tom do cliente."), { target: { value: "acolhedor" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar kit da CME" }));
    await waitFor(() => expect(mock.update).toHaveBeenCalled());
    const [tabela, campos] = mock.update.mock.calls[0];
    expect(tabela).toBe("cliente_marcas");
    expect(campos).toMatchObject({ paleta: [{ nome: "Rosa", hex: "#E91E63", papel: "principal" }], estilo: "leve", tom: "acolhedor", atualizado_por: "u-1" });
  });

  it("cor fora do formato não salva", async () => {
    montarKit(linhaDaMarca({ ...CME, paleta: [{ nome: "Errada", hex: "rosa", papel: "principal" }] }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar kit da CME" }));
    await new Promise((r) => setTimeout(r, 10));
    expect(mock.update).not.toHaveBeenCalled();
  });
});
