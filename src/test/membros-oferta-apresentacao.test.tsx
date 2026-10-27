import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import LeitorDeProduto from "@/components/membros/LeitorDeProduto";
import type { Produto } from "@/lib/membros/modelo";

const mocks = vi.hoisted(() => ({ materiais: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "admin-teste" } }),
}));
vi.mock("@/lib/membros/api", () => ({
  carregarMateriais: mocks.materiais,
  abrirArquivo: vi.fn(),
  gravarProgresso: vi.fn(),
  mensagemDoErro: (erro: Error) => erro.message,
}));

const produto: Produto = {
  id: "crm",
  titulo: "CRM Aceleriq",
  descricao: "Organize seus contatos e próximas ações.",
  categoria: "Ferramentas",
  formato: "CRM",
  capa_url: null,
  estado: "publicado",
  gratuito: false,
  destaque: false,
  checkout_url: null,
  condicoes: "Licença individual.",
  ordem: 0,
  origens: ["administracao"],
  progresso: 0,
  ultimo_material: null,
  em_venda: false,
};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("apresentação de ferramenta sem licença", () => {
  it("mostra a oferta sem consultar materiais ou transformar privilégio admin em licença", () => {
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <LeitorDeProduto
          produto={produto}
          pendente={false}
          fechar={() => {}}
          somenteOferta
        />
      </QueryClientProvider>,
    );
    expect(
      screen.getByRole("region", { name: "Oferta do produto" }),
    ).toBeInTheDocument();
    expect(screen.getByText(produto.descricao)).toBeInTheDocument();
    expect(mocks.materiais).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Entrar no modo foco" }),
    ).not.toBeInTheDocument();
    expect(produto.origens).toEqual(["administracao"]);
  });

  it("mantém a compra indisponível quando não existe checkout ativo", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <LeitorDeProduto
          produto={produto}
          pendente={false}
          fechar={() => {}}
          somenteOferta
        />
      </QueryClientProvider>,
    );
    expect(
      screen.getByText(
        "Conteúdo bloqueado. A compra ainda não está disponível.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /checkout/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Checkout de/)).not.toBeInTheDocument();
  });
});
