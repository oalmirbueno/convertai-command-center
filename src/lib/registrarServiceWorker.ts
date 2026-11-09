import { BUILD_ID } from "@/lib/appRefresh";

/**
 * Liga o service worker do painel (public/sw.js). Só no site publicado: em desenvolvimento ele guardaria arquivos que
 * mudam a cada tecla. Dentro de um quadro (Central, prévias) não registra. Falha de registro nunca aparece para a
 * pessoa: o painel funciona igual sem ele.
 */
export function registrarServiceWorker(buildId: string = BUILD_ID): boolean {
  if (buildId === "dev") return false;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
  try {
    if (window.self !== window.top) return false;
  } catch {
    return false;
  }
  const registrar = () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => { /* sem service worker: segue igual */ });
  };
  // Depois de a página carregar: o registro não disputa rede com a abertura.
  if (document.readyState === "complete") registrar();
  else window.addEventListener("load", registrar, { once: true });
  return true;
}
