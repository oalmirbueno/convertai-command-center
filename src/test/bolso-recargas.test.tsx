import { createElement as h } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { centavosDoCampo, quantidadePossivel } from "@/lib/bolso/recargas";
const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  user: "a",
  falha: false,
  ofertas: [] as unknown[],
  salvar: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: m.user } }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: m.rpc } }));
import CreditosBolso from "@/components/membros/bolso/CreditosBolso";
import AdminOfertasBolso from "@/components/membros/bolso/AdminOfertasBolso";
const oferta = {
  id: "o",
  codigo: "essencial",
  nome: "Essencial",
  versao: 1,
  descricao: "Pacote para criar",
  preco_centavos: 1900,
  creditos: 50,
  validade_dias: 365,
  tarifa_texto: 1,
  tarifa_imagem: 5,
  formatos: ["feed_1x1"],
  moeda: "BRL",
  provisao_ia_centavos: 700,
  estado: "rascunho",
  politica_id: "p",
};
const politicas = [
  {
    id: "p",
    versao: 1,
    estado: "aprovado" as const,
    teste: false,
    nota: "",
    aprovado_em: null,
    dados: {
      creditos_iniciais: 100,
      tarifa_texto: 1,
      tarifa_imagem: 5,
      validade_meses: 12,
      formatos: ["feed_1x1" as const],
    },
  },
];
function montar(filho: unknown) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const el = h(QueryClientProvider, { client: qc }, filho as never);
  return { ...render(el), qc };
}
beforeEach(() => {
  m.user = "a";
  m.falha = false;
  m.ofertas = [oferta];
  m.rpc.mockReset();
  m.rpc.mockImplementation(async (nome: string) => {
    if (nome === "bolso_estado")
      return {
        data: {
          exposto: true,
          modo: "real",
          carteira: "real",
          direito: { tipo: "anual", fim: "2027-10-27" },
          saldo: { disponivel: m.user === "a" ? 17 : 41, reservado: 0 },
          politica: politicas[0].dados,
        },
        error: null,
      };
    if (nome === "bolso_extrato") return { data: [], error: null };
    if (nome === "bolso_ofertas_listar")
      return m.falha
        ? { data: null, error: { code: "XX", message: "interno" } }
        : {
            data: { pagamentos_habilitados: false, ofertas: m.ofertas },
            error: null,
          };
    if (nome === "bolso_admin_ofertas_listar")
      return { data: m.ofertas, error: null };
    return { data: "nova", error: null };
  });
});
afterEach(cleanup);
describe("recargas individuais", () => {
  it("valores BRL são inteiros e entradas ambíguas são recusadas", () => {
    expect(centavosDoCampo("19,90")).toBe(1990);
    expect(centavosDoCampo("0.05")).toBe(5);
    for (const s of ["-10", "1.000,00", "NaN", "1e4", "10,999", ""])
      expect(centavosDoCampo(s)).toBeNull();
    expect(quantidadePossivel(17, 5)).toBe(3);
  });
  it("mostra preço e possibilidades sem permitir pagamento", async () => {
    montar(h(CreditosBolso));
    expect(await screen.findByText("Essencial")).toBeTruthy();
    expect(screen.getByText("Até 50 textos")).toBeTruthy();
    expect(screen.getByText("Ou até 10 imagens")).toBeTruthy();
    const b = screen.getByRole("button", {
      name: /Recargas em breve/,
    }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    fireEvent.click(b);
    expect(
      m.rpc.mock.calls.every(([nome]) => !String(nome).includes("pagamento")),
    ).toBe(true);
    expect(screen.queryByText(/OpenRouter/)).toBeNull();
  });
  it("catálogo vazio não inventa preço ou pacote", async () => {
    m.ofertas = [];
    montar(h(CreditosBolso));
    expect(
      await screen.findByRole("heading", { name: "Recargas em breve" }),
    ).toBeTruthy();
    expect(screen.queryByText("Essencial")).toBeNull();
  });
  it("falha no catálogo preserva saldo e oferece repetição", async () => {
    m.falha = true;
    montar(h(CreditosBolso));
    expect(
      await screen.findByText("Não conseguimos carregar as recargas."),
    ).toBeTruthy();
    expect(screen.getByText("Disponível para criar")).toBeTruthy();
    expect(screen.queryByText("interno")).toBeNull();
  });
  it("trocar conta exige novo saldo sem aproveitar cache anterior", async () => {
    const { rerender, qc } = montar(h(CreditosBolso));
    await screen.findByText("Essencial");
    expect(qc.getQueryData(["bolso", "estado", "a"])).toMatchObject({
      saldo: { disponivel: 17 },
    });
    m.user = "b";
    rerender(h(QueryClientProvider, { client: qc }, h(CreditosBolso)));
    await waitFor(() =>
      expect(qc.getQueryData(["bolso", "estado", "b"])).toMatchObject({
        saldo: { disponivel: 41 },
      }),
    );
  });
  it("admin separa provisão de IA da receita antes de taxas", async () => {
    montar(h(AdminOfertasBolso, { politicas }));
    await screen.findByText("Essencial");
    expect(screen.getByText("Provisão para IA")).toBeTruthy();
    expect(screen.getByText("Antes de taxas")).toBeTruthy();
    expect(screen.getByText("Rascunho")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Publicar oferta/ }));
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(
      m.rpc.mock.calls.some(([nome]) => nome === "bolso_admin_oferta_aprovar"),
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
  });
  it("formulário rejeita provisão maior que preço e saldo inválido", async () => {
    montar(h(AdminOfertasBolso, { politicas }));
    await screen.findByText("Essencial");
    fireEvent.click(screen.getByRole("button", { name: "Nova oferta" }));
    fireEvent.change(screen.getByLabelText("Nome do pacote"), {
      target: { value: "Novo" },
    });
    fireEvent.change(screen.getByLabelText("Código da oferta"), {
      target: { value: "novo" },
    });
    fireEvent.change(screen.getByLabelText("Preço em reais"), {
      target: { value: "19" },
    });
    fireEvent.change(screen.getByLabelText("Provisão para IA em reais"), {
      target: { value: "20" },
    });
    fireEvent.change(screen.getByLabelText("Quantidade de créditos"), {
      target: { value: "50" },
    });
    fireEvent.change(screen.getByLabelText("Política do acesso"), {
      target: { value: "p" },
    });
    expect(
      (
        screen.getByRole("button", {
          name: "Salvar rascunho",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("Provisão para IA em reais"), {
      target: { value: "7" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() =>
      expect(m.rpc).toHaveBeenCalledWith("bolso_admin_oferta_salvar", {
        _dados: expect.objectContaining({
          preco_centavos: 1900,
          provisao_ia_centavos: 700,
          creditos: 50,
        }),
      }),
    );
  });
});
