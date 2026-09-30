/**
 * UXM: as fontes do site, sem banco (o pacote-do-site.ts reexporta; os testes
 * importam daqui para não puxar o cliente do Supabase).
 */
import { urlDoGoogleFonts } from "../tipografia-da-marca.ts";
import { FONTES_DA_BASE } from "./dados/fontes.ts";

/**
 * Lacuna 4.2: as fontes do site. Ordem: fontes do kit (cliente_fontes) ->
 * tipografia da Identidade (contexto.tipografia, "tipografiaCitada") -> o par
 * da base escolhido (só quando o kit não tem fontes).
 */
export function fontesDoSite(kit: Array<{ nome: string; papel: string }>, citada: { titulo?: string | null; texto?: string | null } | null | undefined, par: { titulo: string; texto: string } | null): { fontes: Array<{ nome: string; papel: string }>; origem: "kit" | "identidade" | "base" | null } {
  if (kit.length) return { fontes: kit.slice(0, 4), origem: "kit" };
  const t = citada && citada.titulo ? String(citada.titulo).trim() : "";
  const x = citada && citada.texto ? String(citada.texto).trim() : "";
  if (t || x) return { fontes: [t ? { nome: t, papel: "titulo" } : null, x ? { nome: x, papel: "texto" } : null].filter((f): f is { nome: string; papel: string } => !!f), origem: "identidade" };
  if (par) return { fontes: [{ nome: par.titulo, papel: "titulo" }, { nome: par.texto, papel: "texto" }], origem: "base" };
  return { fontes: [], origem: null };
}

/** Lacuna 4.1: o endereço css2 (display=swap) só com famílias conhecidas (catálogo da casa ou fontes da base). */
export const urlDasFontesDoSite = (fontes: Array<{ nome: string }>) => urlDoGoogleFonts(fontes.map((f) => ({ familia: f.nome })), { extras: FONTES_DA_BASE, somenteConhecidas: true });
