import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePwaProfile } from "@/hooks/usePwaProfile";

/**
 * O Ciclo é instalável como aplicativo separado. Quem decide o que o
 * navegador instala é o <link rel="manifest"> da página aberta, então a troca
 * (e a devolução ao sair) precisa ser confiável: sem ela, o dono instala o
 * painel inteiro achando que instalou o Ciclo.
 */
describe("perfil de PWA por tela", () => {
  const setupHead = () => {
    document.head.innerHTML = `
      <link rel="manifest" href="/manifest.webmanifest" />
      <meta name="apple-mobile-web-app-title" content="Aceleriq" />
    `;
    return {
      manifest: () => document.querySelector('link[rel="manifest"]')?.getAttribute("href"),
      appleTitle: () =>
        document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute("content"),
    };
  };

  it("aponta para o manifest da tela enquanto ela está aberta", () => {
    const head = setupHead();
    const { unmount } = renderHook(() => usePwaProfile("/ciclo.webmanifest", "Ciclo"));

    expect(head.manifest()).toBe("/ciclo.webmanifest");
    expect(head.appleTitle()).toBe("Ciclo");

    unmount();
  });

  it("devolve o manifest do painel ao sair da tela", () => {
    const head = setupHead();
    const { unmount } = renderHook(() => usePwaProfile("/ciclo.webmanifest", "Ciclo"));
    unmount();

    expect(head.manifest()).toBe("/manifest.webmanifest");
    expect(head.appleTitle()).toBe("Aceleriq");
  });

  it("não quebra quando a página não declara manifest", () => {
    document.head.innerHTML = "";
    expect(() =>
      renderHook(() => usePwaProfile("/ciclo.webmanifest", "Ciclo")).unmount(),
    ).not.toThrow();
  });
});
