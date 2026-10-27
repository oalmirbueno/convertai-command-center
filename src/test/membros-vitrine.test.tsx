import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import VitrineDoMembro from "@/components/membros/VitrineDoMembro";
import {
  CAPAS_MEMBROS,
  capaDoProduto,
  produtoDeDemonstracao,
  produtosDaVitrine,
} from "@/lib/membros/capas";
import type { Produto } from "@/lib/membros/modelo";

const produto = (valores: Partial<Produto> = {}): Produto => ({
  id: "crm",
  titulo: "CRM Aceleriq",
  descricao: "Organize seus contatos.",
  categoria: "Ferramentas",
  formato: "CRM",
  capa_url: null,
  estado: "publicado",
  gratuito: false,
  destaque: false,
  checkout_url: null,
  condicoes: "",
  ordem: 1,
  origens: [],
  progresso: 0,
  ultimo_material: null,
  ...valores,
});

afterEach(cleanup);

describe("vitrine da biblioteca", () => {
  it("abre a oferta correspondente sem transformar bloqueio em licença", () => {
    const abrir = vi.fn();
    const item = produto();
    render(<VitrineDoMembro produtos={[item]} abrir={abrir} />);
    const cartao = screen.getByRole("button", {
      name: "Conhecer CRM Aceleriq",
    });
    expect(within(cartao).getByText("Ver detalhes")).toBeInTheDocument();
    fireEvent.click(cartao);
    expect(abrir).toHaveBeenCalledWith(item);
    expect(item.origens).toEqual([]);
  });

  it("respeita licença da ferramenta mesmo sem acesso aos materiais", () => {
    const item = produto();
    const abrir = vi.fn();
    render(
      <VitrineDoMembro
        produtos={[item]}
        abrir={abrir}
        acesso={() => ({
          rotulo: "Licença ativa",
          ferramenta: true,
          liberado: true,
        })}
      />,
    );
    const cartao = screen.getByRole("button", { name: "Abrir CRM Aceleriq" });
    expect(within(cartao).getByText("Abrir ferramenta")).toBeInTheDocument();
    fireEvent.click(cartao);
    expect(abrir).toHaveBeenCalledWith(item);
  });

  it("não expõe cadastro de teste nem oferece compra de UGC futuro", () => {
    render(
      <VitrineDoMembro
        produtos={[
          produto({
            titulo: "Boas-vindas à biblioteca: Produto de teste",
            categoria: "Teste",
            gratuito: true,
            origens: ["gratuito"],
          }),
        ]}
        abrir={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Produto de teste/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("article", { name: "Estúdio UGC, em breve" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /UGC/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /UGC/ })).not.toBeInTheDocument();
  });

  it("entrega boas-vindas reais sem depender de curso ou vídeo de demonstração", () => {
    const abrir = vi.fn();
    render(<VitrineDoMembro produtos={[]} abrir={abrir} />);
    fireEvent.click(screen.getByRole("button", { name: /Boas-vindas/ }));
    const guia = screen.getByRole("dialog", { name: "Boas-vindas à Aceleriq" });
    expect(
      within(guia).getByText("Prepare sua primeira campanha"),
    ).toBeInTheDocument();
    expect(
      within(guia).getByText("Revise antes de publicar"),
    ).toBeInTheDocument();
    expect(abrir).not.toHaveBeenCalled();
  });

  it("abre o guia real mesmo quando o administrador tem acesso à amostra antiga", () => {
    const abrir = vi.fn();
    render(
      <VitrineDoMembro
        produtos={[
          produto({
            titulo: "Boas-vindas à biblioteca: Produto de teste",
            categoria: "Teste",
            gratuito: true,
            origens: ["administracao"],
          }),
        ]}
        abrir={abrir}
        acesso={() => ({
          rotulo: "Administração",
          ferramenta: false,
          liberado: true,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Boas-vindas/ }));
    expect(
      screen.getByRole("dialog", { name: "Boas-vindas à Aceleriq" }),
    ).toBeInTheDocument();
    expect(abrir).not.toHaveBeenCalled();
  });

  it("usa boas-vindas cadastradas somente quando o conteúdo já está liberado", () => {
    const item = produto({
      titulo: "Boas-vindas à Aceleriq",
      gratuito: true,
      origens: ["gratuito"],
    });
    const abrir = vi.fn();
    render(<VitrineDoMembro produtos={[item]} abrir={abrir} />);
    fireEvent.click(screen.getByRole("button", { name: /Boas-vindas/ }));
    expect(abrir).toHaveBeenCalledWith(item);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("mantém a ação desabilitada enquanto a licença é conferida", () => {
    const abrir = vi.fn();
    render(
      <VitrineDoMembro
        produtos={[produto()]}
        abrir={abrir}
        acesso={() => ({
          rotulo: "Conferindo",
          ferramenta: true,
          liberado: false,
          conferindo: true,
        })}
      />,
    );
    const cartao = screen.getByRole("button", {
      name: "Conhecer CRM Aceleriq",
    });
    expect(cartao).toBeDisabled();
    fireEvent.click(cartao);
    expect(abrir).not.toHaveBeenCalled();
  });
});

describe("capas e seleção de produtos", () => {
  it("preserva a capa cadastrada e descarta protocolos inseguros", () => {
    expect(
      capaDoProduto(produto({ capa_url: "https://cdn.example.org/capa.webp" })),
    ).toBe("https://cdn.example.org/capa.webp");
    expect(capaDoProduto(produto({ capa_url: "javascript:alert(1)" }))).toBe(
      CAPAS_MEMBROS.relacionamento,
    );
  });

  it("não confunde oferta real de teste gratuito com cadastro de demonstração", () => {
    expect(
      produtoDeDemonstracao(
        produto({ titulo: "Teste grátis do CRM", categoria: "Ferramentas" }),
      ),
    ).toBe(false);
    expect(produtoDeDemonstracao(produto({ categoria: "Teste" }))).toBe(true);
  });

  it("ordena sem modificar o catálogo nem direitos legados", () => {
    const itens = [
      produto({ id: "segundo", ordem: 2, origens: ["manual"] }),
      produto({ id: "primeiro", ordem: 1 }),
      produto({ id: "rascunho", estado: "rascunho" }),
    ];
    expect(produtosDaVitrine(itens).map((item) => item.id)).toEqual([
      "primeiro",
      "segundo",
    ]);
    expect(itens[0].id).toBe("segundo");
    expect(itens[0].origens).toEqual(["manual"]);
  });
});
