import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao } from "@/lib/mesa/api";
import { chaveDasFotos, invalidarFotos, normalizarFoto, type FotoDoAcervo } from "./fotoApi";
import type { LadoDaFoto } from "./tipoDaFoto";

/**
 * Fotos (passo 2), 02/10: foto de um link, a separação produto ou modelo (à
 * mão pelo menu da foto ou pelo Jev nas fotos sem sinal) e o lado das fotos
 * novas. A categoria é a mesma coluna da Mesa (produto, pessoa, arte).
 */

export const CATEGORIA_DO_LADO: Record<LadoDaFoto, string> = { produto: "produto", modelo: "pessoa" };

/** Link de imagem colado: só https e com cara de endereço. */
export function linkDeImagem(texto: string): string | null {
  const t = String(texto || "").trim();
  if (!/^https:\/\/[^\s]+$/i.test(t) || t.length > 2000) return null;
  try {
    const u = new URL(t);
    return u.protocol === "https:" && !!u.hostname && u.hostname.indexOf(".") > 0 ? u.toString() : null;
  } catch {
    return null;
  }
}

export async function importarDoLink(clientId: string, url: string, lado: LadoDaFoto): Promise<{ imagem: FotoDoAcervo | null; jaExistia: boolean }> {
  const data = await chamarFuncao<any>("mesa-foto", { acao: "acervo_importar_url", client_id: clientId, url, lado });
  return { imagem: normalizarFoto(data && data.imagem), jaExistia: !!(data && data.ja_existia) };
}

/** Grava o lado (categoria) das fotos: subir na aba Modelo, mover pelo menu da foto. */
export async function moverParaLado(queryClient: QueryClient, clientId: string, ids: string[], lado: LadoDaFoto): Promise<void> {
  const validos = ids.filter(Boolean).slice(0, 200);
  if (!validos.length) return;
  const categoria = CATEGORIA_DO_LADO[lado];
  // Na hora, no cache (a grade troca de aba sem esperar a releitura).
  queryClient.setQueryData<FotoDoAcervo[]>(chaveDasFotos(clientId), (lista) => (lista || []).map((f) => (validos.indexOf(f.id) >= 0 ? { ...f, categoria } : f)));
  const { error } = await (supabase as any).from("cliente_imagens").update({ categoria }).eq("client_id", clientId).in("id", validos);
  if (error) {
    invalidarFotos(queryClient, clientId);
    throw new Error("Não foi possível mover as fotos agora.");
  }
}

export interface SeparacaoDaFoto {
  id: string;
  lado: "produto" | "modelo" | "arte" | null;
  categoria: string | null;
}

/** Jev separa as fotos sem sinal (até 20 por vez) e grava a categoria. */
export async function separarComJev(queryClient: QueryClient, clientId: string, ids: string[]): Promise<{ separadas: SeparacaoDaFoto[]; custo_usd: number }> {
  const data = await chamarFuncao<any>("mesa-foto", { acao: "fotos_separar", client_id: clientId, imagem_ids: ids.slice(0, 20) });
  const brutas: any[] = data && Array.isArray(data.separadas) ? data.separadas : [];
  const separadas: SeparacaoDaFoto[] = brutas
    .filter((x) => x && typeof x.id === "string")
    .map((x) => ({ id: String(x.id), lado: x.lado === "produto" || x.lado === "modelo" || x.lado === "arte" ? x.lado : null, categoria: typeof x.categoria === "string" ? x.categoria : null }));
  queryClient.setQueryData<FotoDoAcervo[]>(chaveDasFotos(clientId), (lista) =>
    (lista || []).map((f) => {
      const s = separadas.find((x) => x.id === f.id && !!x.categoria);
      return s ? { ...f, categoria: s.categoria } : f;
    }),
  );
  invalidarFotos(queryClient, clientId);
  return { separadas, custo_usd: Number((data && data.custo_usd) || 0) || 0 };
}

