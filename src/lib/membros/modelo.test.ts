import { describe, it, expect } from "vitest";
import {
  buscarProdutos,
  destinoOperacional,
  podeAbrir,
  rotuloDoAcesso,
  trilhos,
  urlHttps,
  type Produto,
} from "./modelo";
const produto = (v: Partial<Produto> = {}): Produto => ({
  id: "p1",
  titulo: "Guia de criação",
  descricao: "Material real do catálogo",
  categoria: "Guias",
  formato: "PDF",
  capa_url: null,
  estado: "publicado",
  gratuito: false,
  destaque: false,
  checkout_url: null,
  condicoes: "",
  ordem: 0,
  origens: [],
  progresso: 0,
  ultimo_material: null,
  ...v,
});
describe("direitos e organização da biblioteca", () => {
  it("comprador sem papel não entra no operacional", () => {
    expect(destinoOperacional("member")).toBe("/solucoes");
    expect(destinoOperacional(undefined)).toBe("/solucoes");
  });
  it.each(["admin", "client", "design", "traffic", "manager"])(
    "preserva entrada autorizada de %s",
    (papel) => {
      expect(destinoOperacional(papel)).toBe("/dashboard");
    },
  );
  it("um direito de compra é suficiente sem benefício de plano", () => {
    expect(podeAbrir(produto({ origens: ["compra"] }))).toBe(true);
    expect(rotuloDoAcesso(produto({ origens: ["compra", "plano"] }))).toBe(
      "Adquirido",
    );
  });
  it("não presume acesso só por ser produto existente", () => {
    expect(podeAbrir(produto())).toBe(false);
    expect(rotuloDoAcesso(produto())).toBe("Disponível para compra");
  });
  it("não renderiza trilhos vazios", () => expect(trilhos([])).toEqual([]));
  it("continuar exige direito e progresso real", () => {
    const ret = trilhos([
      produto({ id: "sem", progresso: 50, ultimo_material: "m" }),
      produto({
        id: "com",
        origens: ["compra"],
        progresso: 25,
        ultimo_material: "m",
      }),
      produto({
        id: "fim",
        origens: ["compra"],
        progresso: 100,
        ultimo_material: "m",
      }),
    ]);
    expect(
      ret
        .find((t) => t.titulo === "Continue de onde parou")
        ?.produtos.map((p) => p.id),
    ).toEqual(["com"]);
  });
  it("busca ignora acentos e combina categoria", () => {
    expect(buscarProdutos([produto()], "criacao", "Guias")).toHaveLength(1);
    expect(buscarProdutos([produto()], "criacao", "Kits")).toHaveLength(0);
  });
  it.each([
    "javascript:alert(1)",
    "http://example.com",
    "https://user:pass@example.com",
    null,
  ])("recusa destino inseguro %s", (v) => expect(urlHttps(v)).toBeNull());
  it("aceita checkout HTTPS confirmado no cadastro", () =>
    expect(urlHttps("https://example.com/oferta")).toBe(
      "https://example.com/oferta",
    ));
});
