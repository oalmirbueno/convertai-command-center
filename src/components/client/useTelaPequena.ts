import { useEffect, useState } from "react";

/**
 * Está abaixo de 640 px (celular em pé)? Portal do cliente, 16/10/2026: no
 * celular as telas do cliente viram "cara de aplicativo" (um item por vez,
 * lista de app, folha que sobe de baixo); de 640 px para cima nada muda.
 *
 * Igual ao useCelular (src/hooks/useCelular.ts), mas no corte de 640 px: já
 * nasce com a resposta certa (lê a janela no primeiro render), então a tela
 * não pinta o layout do computador e troca um instante depois. Só usa o
 * evento resize (Safari 11 não tem addEventListener em matchMedia).
 */
const LIMITE = 640;

function larguraAgora(): number {
  if (typeof window === "undefined") return LIMITE;
  return window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || LIMITE;
}

export function useTelaPequena(): boolean {
  const [pequena, setPequena] = useState(() => larguraAgora() < LIMITE);
  useEffect(() => {
    const medir = () => setPequena(larguraAgora() < LIMITE);
    medir();
    window.addEventListener("resize", medir);
    window.addEventListener("orientationchange", medir);
    return () => {
      window.removeEventListener("resize", medir);
      window.removeEventListener("orientationchange", medir);
    };
  }, []);
  return pequena;
}

export default useTelaPequena;
