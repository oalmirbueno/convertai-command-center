import { useEffect, useState } from "react";
import { familiaSegura, urlDoGoogleFonts } from "../../../supabase/functions/_shared/tipografia-da-marca";

/**
 * Fontes do Google carregadas SOB DEMANDA (IDV2): só quando a seção de
 * tipografia, a prévia do brandbook ou a peça da marca abre. O painel não
 * carrega família nenhuma de antemão (painel leve). Cada endereço entra uma
 * vez só na página.
 */

const pedidas: Record<string, Promise<void>> = {};

function carregarCss(url: string): Promise<void> {
  if (pedidas[url]) return pedidas[url];
  pedidas[url] = new Promise<void>((resolver) => {
    if (typeof document === "undefined") return resolver();
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = url;
    link.setAttribute("data-fonte-da-marca", "");
    link.onload = () => resolver();
    // Sem rede ou bloqueado: a prévia fica com a fonte de reserva (nunca trava a tela).
    link.onerror = () => resolver();
    document.head.appendChild(link);
  });
  return pedidas[url];
}

/** Carrega as famílias e espera o navegador ter os arquivos (quando ele sabe esperar). */
export async function carregarFontesGoogle(familias: Array<{ familia: string; pesos?: number[] }>): Promise<void> {
  const validas = familias.filter((f) => !!familiaSegura(f.familia));
  const url = urlDoGoogleFonts(validas);
  if (!url) return;
  await carregarCss(url);
  const fontes = typeof document !== "undefined" ? (document as unknown as { fonts?: { load?: (f: string) => Promise<unknown> } }).fonts : undefined;
  if (!fontes || typeof fontes.load !== "function") return;
  await Promise.all(validas.map((f) => fontes.load!(`${(f.pesos && f.pesos[0]) || 400} 24px "${familiaSegura(f.familia)}"`).catch(() => null)));
}

/** Hook: carrega quando `ativo` e diz quando ficou pronto (a prévia troca a fonte de reserva pela real). */
export function useFontesGoogle(familias: Array<{ familia: string; pesos?: number[] }>, ativo = true): boolean {
  const chave = familias.map((f) => `${f.familia}:${(f.pesos || []).join(",")}`).join("|");
  const [pronto, setPronto] = useState(false);
  useEffect(() => {
    if (!ativo || !chave) return;
    let vivo = true;
    setPronto(false);
    carregarFontesGoogle(familias).then(() => {
      if (vivo) setPronto(true);
    });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, ativo]);
  return pronto;
}
