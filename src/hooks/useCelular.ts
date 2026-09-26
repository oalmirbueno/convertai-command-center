import { useEffect, useState } from "react";

/**
 * Está abaixo de 768 px? Igual ao useIsMobile, mas já nasce com a resposta
 * certa (lê a janela no primeiro render): a tela não pinta o layout do
 * computador e troca para o do celular um instante depois (nada piscando).
 * Só usa o evento resize (Safari 11 não tem addEventListener em matchMedia).
 * Frente E4, 26/09. Candidato a substituir o useIsMobile.
 */
const LIMITE = 768;

function larguraAgora(): number {
  if (typeof window === "undefined") return LIMITE;
  return window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || LIMITE;
}

export function useCelular(): boolean {
  const [celular, setCelular] = useState(() => larguraAgora() < LIMITE);
  useEffect(() => {
    const medir = () => setCelular(larguraAgora() < LIMITE);
    medir();
    window.addEventListener("resize", medir);
    window.addEventListener("orientationchange", medir);
    return () => {
      window.removeEventListener("resize", medir);
      window.removeEventListener("orientationchange", medir);
    };
  }, []);
  return celular;
}
