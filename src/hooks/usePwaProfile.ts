import { useEffect, useState } from "react";

/**
 * Perfil de PWA por tela.
 *
 * O painel inteiro é um app instalável (manifest global, escopo "/"). Algumas
 * telas de uso diário, como o Ciclo da Semana, funcionam melhor como um
 * aplicativo separado na tela inicial: abre direto no checklist, em tela
 * cheia, sem misturar com o resto do painel.
 *
 * O navegador decide o que instalar a partir do <link rel="manifest"> da
 * página aberta no momento. Este hook troca esse link (e o título do atalho
 * no iOS) enquanto a tela está montada, e devolve tudo ao normal na saída.
 */
export function usePwaProfile(manifestHref: string, appleTitle: string) {
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const appleMeta = document.querySelector<HTMLMetaElement>(
      'meta[name="apple-mobile-web-app-title"]',
    );
    const previousManifest = link?.getAttribute("href") || null;
    const previousTitle = appleMeta?.getAttribute("content") || null;

    link?.setAttribute("href", manifestHref);
    appleMeta?.setAttribute("content", appleTitle);

    return () => {
      if (previousManifest) link?.setAttribute("href", previousManifest);
      if (previousTitle) appleMeta?.setAttribute("content", previousTitle);
    };
  }, [manifestHref, appleTitle]);
}

/**
 * Verdadeiro quando a página está aberta como aplicativo instalado (sem a
 * barra do navegador). Serve para esconder atalhos que só fazem sentido
 * dentro do painel completo.
 */
export function useStandalone(): boolean {
  const [standalone, setStandalone] = useState(() => matchStandalone());

  useEffect(() => {
    const media = window.matchMedia("(display-mode: standalone)");
    const update = () => setStandalone(matchStandalone());
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return standalone;
}

function matchStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // iOS usa navigator.standalone; o resto segue o display-mode do manifest.
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia("(display-mode: standalone)").matches;
}
