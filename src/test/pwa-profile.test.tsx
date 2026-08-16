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
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    `;
    return {
      manifest: () => document.querySelector('link[rel="manifest"]')?.getAttribute("href"),
      appleTitle: () =>
        document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute("content"),
      appleIcon: () =>
        document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href"),
    };
  };

  it("aponta para o manifest da tela enquanto ela está aberta", () => {
    const head = setupHead();
    const { unmount } = renderHook(() => usePwaProfile({ manifestHref: "/ciclo.webmanifest", appleTitle: "Ciclo", appleIcon: "/ciclo-apple-touch-icon.png" }));

    expect(head.manifest()).toBe("/ciclo.webmanifest");
    expect(head.appleTitle()).toBe("Ciclo");
    // Sem trocar o ícone, o atalho do Ciclo sai no iOS com a cara do painel.
    expect(head.appleIcon()).toBe("/ciclo-apple-touch-icon.png");

    unmount();
  });

  it("devolve o manifest do painel ao sair da tela", () => {
    const head = setupHead();
    const { unmount } = renderHook(() => usePwaProfile({ manifestHref: "/ciclo.webmanifest", appleTitle: "Ciclo", appleIcon: "/ciclo-apple-touch-icon.png" }));
    unmount();

    expect(head.manifest()).toBe("/manifest.webmanifest");
    expect(head.appleTitle()).toBe("Aceleriq");
    expect(head.appleIcon()).toBe("/apple-touch-icon.png");
  });

  it("não quebra quando a página não declara manifest", () => {
    document.head.innerHTML = "";
    expect(() =>
      renderHook(() => usePwaProfile({ manifestHref: "/ciclo.webmanifest", appleTitle: "Ciclo", appleIcon: "/ciclo-apple-touch-icon.png" })).unmount(),
    ).not.toThrow();
  });
});
