import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Webhook de vendas no nó `checkout`: sem integração mostra "Criar
 * integração"; no Asaas o token aparece uma vez com aviso e some no "Já
 * copiei"; com integração mostra o endereço (copiar com ícone), pede o
 * segredo do gateway e lista os últimos 5 eventos; "outro link" só avisa.
 */

const m = vi.hoisted(() => ({
  listarIntegracoes: vi.fn(),
  listarEventos: vi.fn(),
  criarIntegracao: vi.fn(),
  salvarSegredo: vi.fn(),
  desligarIntegracao: vi.fn(),
}));

vi.mock("@/lib/laboratorio/vendas", async (orig) => ({ ...(await orig<typeof import("@/lib/laboratorio/vendas")>()), ...m }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import IntegracaoDeVendas from "./IntegracaoDeVendas";
import type { IntegracaoDeVenda } from "@/lib/laboratorio/vendas";

const ENDERECO = "https://x.supabase.co/functions/v1/vendas-webhook/stripe/0123456789abcdef0123456789abcdef";

const integ = (o: Partial<IntegracaoDeVenda> = {}): IntegracaoDeVenda => ({
  id: "i1",
  client_id: "c1",
  gateway: "stripe",
  ativo: true,
  endereco: ENDERECO,
  criado_em: "2026-10-19T10:00:00Z",
  tem_segredo: false,
  segredo_final: null,
  segredo_gerado_pelo_painel: false,
  token_api: "nao",
  tem_token_api: false,
  ultimo_evento_em: null,
  ...o,
});

describe("IntegracaoDeVendas", () => {
  beforeEach(() => {
    Object.values(m).forEach((f) => f.mockReset());
    m.listarEventos.mockResolvedValue([]);
  });

  it("outro link: só avisa que mede o clique, sem chamar a função", () => {
    render(<IntegracaoDeVendas clienteId="c1" gateway="outro link" />);
    expect(screen.getByText(/só o clique é medido/)).toBeInTheDocument();
    expect(m.listarIntegracoes).not.toHaveBeenCalled();
  });

  it("sem integração: cria e, no Asaas, mostra o token uma vez com aviso", async () => {
    m.listarIntegracoes.mockResolvedValue([]);
    m.criarIntegracao.mockResolvedValue({
      integracao: integ({ gateway: "asaas", tem_segredo: true, segredo_final: "beef", segredo_gerado_pelo_painel: true, token_api: "opcional", endereco: ENDERECO.replace("stripe", "asaas") }),
      segredo: "token-gerado-0123456789abcdef0123456789abcdef",
    });
    render(<IntegracaoDeVendas clienteId={null} gateway="Asaas" />);
    fireEvent.click(await screen.findByRole("button", { name: "Criar integração" }));
    expect(m.criarIntegracao).toHaveBeenCalledWith(null, "asaas");
    expect(await screen.findByText("token-gerado-0123456789abcdef0123456789abcdef")).toBeInTheDocument();
    expect(screen.getByText(/não aparece de novo/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Já copiei, esconder o token" }));
    expect(screen.queryByText("token-gerado-0123456789abcdef0123456789abcdef")).not.toBeInTheDocument();
    // Asaas: a chave de API é opcional e o webhook já está pronto.
    expect(screen.getByText("Chave de API (opcional)")).toBeInTheDocument();
    expect(screen.getByText(/Pronto para receber · segredo termina em beef/)).toBeInTheDocument();
  });

  it("com integração: endereço com copiar em ícone, pede o segredo e lista até 5 eventos", async () => {
    m.listarIntegracoes.mockResolvedValue([integ({ ativo: false, id: "velha" }), integ()]);
    m.listarEventos.mockResolvedValue(
      Array.from({ length: 6 }, (_, i) => ({
        id: `e${i}`,
        tipo: i === 0 ? "compra_aprovada" : "pix_gerado",
        valor: 197,
        moeda: "BRL",
        produto_externo_id: null,
        comprador_email: `p${i}@x.com`,
        comprador_nome: null,
        lead_id: null,
        recebido_em: "2026-10-19T12:00:00Z",
      })),
    );
    const escrever = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: escrever }, configurable: true });
    m.salvarSegredo.mockResolvedValue(integ({ tem_segredo: true, segredo_final: "3456" }));

    render(<IntegracaoDeVendas clienteId="c1" gateway="Stripe" />);
    expect(await screen.findByText(ENDERECO)).toBeInTheDocument();
    expect(m.listarIntegracoes).toHaveBeenCalledWith("c1", "stripe");
    expect(m.listarEventos).toHaveBeenCalledWith("c1", { gateway: "stripe", limite: 5 });

    const copiar = screen.getByRole("button", { name: "Copiar endereço" });
    expect(copiar).toHaveAttribute("title", "Copiar endereço");
    fireEvent.click(copiar);
    await waitFor(() => expect(escrever).toHaveBeenCalledWith(ENDERECO));

    const lista = screen.getByRole("list", { name: "Últimos eventos de venda" });
    expect(lista.querySelectorAll("li")).toHaveLength(5);
    expect(screen.getByText("Compra aprovada · R$ 197,00")).toBeInTheDocument();

    expect(screen.getByText(/Falta o segredo/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Segredo de assinatura (whsec_...)"), { target: { value: "whsec_123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(m.salvarSegredo).toHaveBeenCalledWith("i1", { segredo: "whsec_123456", token_api: undefined }));
    expect(await screen.findByText(/Pronto para receber · segredo termina em 3456/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Segredo de assinatura (whsec_...)")).not.toBeInTheDocument();
  });

  it("instrução de onde colar fica no '?' recolhido e desligar é ícone com nome", async () => {
    m.listarIntegracoes.mockResolvedValue([integ({ tem_segredo: true })]);
    render(<IntegracaoDeVendas clienteId="c1" gateway="Stripe" />);
    await screen.findByText(ENDERECO);
    expect(screen.queryByText(/Desenvolvedores › Webhooks/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Onde colar o endereço no Stripe" }));
    expect(await screen.findByText(/Desenvolvedores › Webhooks/)).toBeInTheDocument();
    const desligar = screen.getByRole("button", { name: "Desligar o webhook" });
    expect(desligar).toHaveAttribute("title", "Desligar o webhook");
  });

  it("erro ao ler: mostra a frase e tenta de novo", async () => {
    m.listarIntegracoes.mockRejectedValueOnce(new Error("Só admin ou gestor liga o checkout.")).mockResolvedValueOnce([]);
    render(<IntegracaoDeVendas clienteId="c1" gateway="Hotmart" />);
    expect(await screen.findByText("Só admin ou gestor liga o checkout.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByRole("button", { name: "Criar integração" })).toBeInTheDocument();
  });
});
