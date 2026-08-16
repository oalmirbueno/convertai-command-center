import { useEffect, useState } from "react";

export interface PwaProfile {
  /** Manifesto que descreve o aplicativo desta tela. */
  manifestHref: string;
  /** Nome do atalho no iOS, que ignora o manifesto. */
  appleTitle: string;
  /** Ícone do atalho no iOS, que também ignora os ícones do manifesto. */
  appleIcon: string;
}

/**
 * Perfil de PWA por tela.
 *
 * O painel inteiro é um app instalável (manifesto global, escopo "/"). O Ciclo
 * é um aplicativo separado, com página própria em /ciclo.html: quem instala
 * por lá recebe um ícone e um nome distintos, que abrem direto no checklist,
 * sem se misturar com o aplicativo do painel.
 *
 * Este hook cobre a outra porta: quando o Ciclo é aberto pela rota /ciclo
 * dentro do navegador, ele reveste a página com a identidade do Ciclo
 * (manifesto, nome e ícone do iOS) enquanto a tela estiver montada, e devolve
 * a identidade do painel na saída. Sem isso, instalar a partir daqui criaria
 * um segundo atalho com a cara do painel.
 */
export function usePwaProfile({ manifestHref, appleTitle, appleIcon }: PwaProfile) {
  useEffect(() => {
    const manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const appleMeta = document.querySelector<HTMLMetaElement>(
      'meta[name="apple-mobile-web-app-title"]',
    );
    const appleIconLink = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');

    const previous = {
      manifest: manifestLink?.getAttribute("href") || null,
      title: appleMeta?.getAttribute("content") || null,
      icon: appleIconLink?.getAttribute("href") || null,
    };

    manifestLink?.setAttribute("href", manifestHref);
    appleMeta?.setAttribute("content", appleTitle);
    appleIconLink?.setAttribute("href", appleIcon);

    return () => {
      if (previous.manifest) manifestLink?.setAttribute("href", previous.manifest);
      if (previous.title) appleMeta?.setAttribute("content", previous.title);
      if (previous.icon) appleIconLink?.setAttribute("href", previous.icon);
    };
  }, [manifestHref, appleTitle, appleIcon]);
}

/**
 * Verdadeiro quando a página está aberta como aplicativo instalado (sem a
 * barra do navegador). Serve para esconder o convite de instalação de quem já
 * instalou e para não redirecionar quem já está dentro do app.
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
  // iOS usa navigator.standalone; o resto segue o display-mode do manifesto.
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia("(display-mode: standalone)").matches;
}
