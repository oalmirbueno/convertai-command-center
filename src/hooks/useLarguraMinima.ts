import { useEffect, useState } from "react";

/**
 * A janela tem pelo menos `px` de largura? Já nasce com a resposta certa
 * (lê a janela no primeiro render) e atualiza ao redimensionar e girar.
 * Só o evento resize (Safari 11 não tem addEventListener em matchMedia).
 * Uso: não montar o que não serve naquela largura (ex.: o iframe do PDF
 * abaixo de 640 px, que no iPhone mostra só a primeira página e no Chrome do
 * Android pode virar download), em vez de só escondê-lo com CSS.
 */
function larguraAgora(fallback: number): number {
  if (typeof window === "undefined") return fallback;
  return window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || fallback;
}

export function useLarguraMinima(px: number): boolean {
  const [cabe, setCabe] = useState(() => larguraAgora(px) >= px);
  useEffect(() => {
    const medir = () => setCabe(larguraAgora(px) >= px);
    medir();
    window.addEventListener("resize", medir);
    window.addEventListener("orientationchange", medir);
    return () => {
      window.removeEventListener("resize", medir);
      window.removeEventListener("orientationchange", medir);
    };
  }, [px]);
  return cabe;
}

export default useLarguraMinima;
