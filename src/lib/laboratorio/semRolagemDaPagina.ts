import { useEffect } from "react";

/**
 * Tela cheia do Laboratório (21/10/2026): enquanto a área cobre a janela, o
 * documento não rola por baixo. Sem isto a barra de rolagem da página ficava
 * à direita e a tela cheia saía 10 px mais estreita ("meio recortado"): o
 * index.css reserva o espaço da barra (scrollbar-gutter: stable) e o fixo
 * respeita essa reserva, então ela sai também.
 * Contagem de pedidos (a página e o editor podem pedir juntos): o estilo de
 * antes volta quando o último sai.
 */
let pedidos = 0;
let antes = "";
let reservaAntes = "";

export function useSemRolagemDaPagina(ativo: boolean) {
  useEffect(() => {
    if (!ativo || typeof document === "undefined") return;
    const html = document.documentElement;
    if (pedidos === 0) {
      antes = html.style.overflow;
      reservaAntes = html.style.getPropertyValue("scrollbar-gutter");
      html.style.overflow = "hidden";
      html.style.setProperty("scrollbar-gutter", "auto");
    }
    pedidos += 1;
    return () => {
      pedidos -= 1;
      if (pedidos <= 0) {
        pedidos = 0;
        html.style.overflow = antes;
        if (reservaAntes) html.style.setProperty("scrollbar-gutter", reservaAntes);
        else html.style.removeProperty("scrollbar-gutter");
      }
    };
  }, [ativo]);
}
