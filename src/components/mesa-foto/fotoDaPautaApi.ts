import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao } from "@/lib/mesa/api";
import { chaveDasFotos, classeDaFoto, invalidarFotos, normalizarFoto, type FotoDoAcervo, type Guia } from "./fotoApi";
import { MAX_REFERENCIAS_DA_PAUTA, PAPEIS_DA_REFERENCIA, type PapelDaReferencia } from "../../../supabase/functions/mesa-foto/foto-da-pauta-regras";

/**
 * Estúdio da pauta de fotos (27/10/2026): Gerar com contexto, estilo e
 * referências com papel; organizar o acervo (favorita e uso); o carrossel.
 * O motor é a ação foto_da_pauta_gerar da função mesa-foto.
 */

export { MAX_REFERENCIAS_DA_PAUTA, PAPEIS_DA_REFERENCIA, type PapelDaReferencia };

export const ROTULO_DO_PAPEL: Record<PapelDaReferencia, string> = {
  antes: "Antes",
  depois: "Depois",
  produto: "Produto",
  cenario: "Cenário",
  estilo: "Estilo",
};

export interface ReferenciaDaPauta {
  imagem_id: string;
  papel: PapelDaReferencia;
}

export interface PedidoDeFotoDaPauta {
  clientId: string;
  taskId: string | null;
  titulo: string;
  pedido: string;
  referencias: ReferenciaDaPauta[];
  guia: Guia;
  modeloImagemId: string;
  formato: string;
  marcaId?: string | null;
  posicao?: { atual: number; total: number } | null;
}

/** O corpo exato da chamada (os testes conferem o que chega ao motor). */
export function corpoDaFotoDaPauta(p: PedidoDeFotoDaPauta): Record<string, unknown> {
  return {
    acao: "foto_da_pauta_gerar",
    client_id: p.clientId,
    ...(p.taskId ? { task_id: p.taskId } : {}),
    titulo: p.titulo,
    pedido: p.pedido.trim(),
    referencias: p.referencias.slice(0, MAX_REFERENCIAS_DA_PAUTA).map((r) => ({ imagem_id: r.imagem_id, papel: r.papel })),
    guia: p.guia,
    modelo_imagem_id: p.modeloImagemId,
    qualidade: "alta",
    formato: p.formato,
    ...(p.marcaId ? { marca_id: p.marcaId } : {}),
    ...(p.posicao ? { posicao: p.posicao } : {}),
  };
}

export async function gerarFotoDaPauta(p: PedidoDeFotoDaPauta): Promise<{ imagem: FotoDoAcervo | null; custo_usd: number; avisos: string[] }> {
  const data = await chamarFuncao<any>("mesa-foto", corpoDaFotoDaPauta(p));
  return {
    imagem: normalizarFoto(data && data.imagem),
    custo_usd: Number((data && data.custo_usd) || 0) || 0,
    avisos: data && Array.isArray(data.avisos) ? data.avisos.map(String) : [],
  };
}

// ------------------------------------------------------------------ organizar o acervo

export const TAG_FAVORITA = "favorita";
export const USOS_DA_FOTO = [
  { valor: "feed", rotulo: "Feed" },
  { valor: "stories", rotulo: "Stories" },
  { valor: "anuncio", rotulo: "Anúncio" },
  { valor: "usada", rotulo: "Já usada" },
] as const;
export type UsoDaFoto = typeof USOS_DA_FOTO[number]["valor"];

export const ehFavorita = (f: Pick<FotoDoAcervo, "tags">) => (f.tags || []).indexOf(TAG_FAVORITA) >= 0;
export const usoDaFoto = (f: Pick<FotoDoAcervo, "tags">): UsoDaFoto | null => {
  const t = (f.tags || []).find((x) => x.indexOf("uso:") === 0);
  const v = t ? t.slice(4) : "";
  return USOS_DA_FOTO.some((u) => u.valor === v) ? (v as UsoDaFoto) : null;
};

/** As etiquetas novas: favorita liga ou desliga; uso troca (um só por foto). Pura. */
export function etiquetasOrganizadas(tags: string[], mudanca: { favorita?: boolean; uso?: UsoDaFoto | null }): string[] {
  let saida = (tags || []).slice();
  if (mudanca.favorita !== undefined) {
    saida = saida.filter((t) => t !== TAG_FAVORITA);
    if (mudanca.favorita) saida.push(TAG_FAVORITA);
  }
  if (mudanca.uso !== undefined) {
    saida = saida.filter((t) => t.indexOf("uso:") !== 0);
    if (mudanca.uso) saida.push(`uso:${mudanca.uso}`);
  }
  return Array.from(new Set(saida)).slice(0, 40);
}

/** Grava favorita/uso nas etiquetas (a equipe edita etiquetas do acervo; o original não muda). */
export async function organizarFoto(queryClient: QueryClient, clientId: string, foto: FotoDoAcervo, mudanca: { favorita?: boolean; uso?: UsoDaFoto | null }): Promise<void> {
  const tags = etiquetasOrganizadas(foto.tags, mudanca);
  queryClient.setQueryData<FotoDoAcervo[]>(chaveDasFotos(clientId), (lista) => (lista || []).map((f) => (f.id === foto.id ? { ...f, tags } : f)));
  const { error } = await (supabase as any).from("cliente_imagens").update({ tags }).eq("client_id", clientId).eq("id", foto.id);
  if (error) {
    invalidarFotos(queryClient, clientId);
    throw new Error("Não foi possível organizar esta foto agora.");
  }
}

export type FiltroDoAcervoDaPauta = "todas" | "reais" | "geradas" | "favoritas" | "sem_uso" | "usadas" | "desta_pauta";
export const FILTROS_DO_ACERVO_DA_PAUTA: { valor: FiltroDoAcervoDaPauta; rotulo: string }[] = [
  { valor: "todas", rotulo: "Todas" },
  { valor: "reais", rotulo: "Reais" },
  { valor: "geradas", rotulo: "Geradas" },
  { valor: "favoritas", rotulo: "Favoritas" },
  { valor: "sem_uso", rotulo: "Sem uso" },
  { valor: "usadas", rotulo: "Com uso" },
  { valor: "desta_pauta", rotulo: "Desta pauta" },
];
export type OrdemDoAcervoDaPauta = "recentes" | "antigas" | "nome" | "favoritas";
export const ORDENS_DO_ACERVO_DA_PAUTA: { valor: OrdemDoAcervoDaPauta; rotulo: string }[] = [
  { valor: "recentes", rotulo: "Mais recentes" },
  { valor: "antigas", rotulo: "Mais antigas" },
  { valor: "favoritas", rotulo: "Favoritas primeiro" },
  { valor: "nome", rotulo: "Nome" },
];

/** Busca, filtro e ordem do acervo da pauta. Pura: os testes usam. */
export function acervoDaPauta(fotos: FotoDoAcervo[], o: { clientId: string; taskId?: string | null; busca?: string; filtro?: FiltroDoAcervoDaPauta; ordem?: OrdemDoAcervoDaPauta }): FotoDoAcervo[] {
  const termo = (o.busca || "").trim().toLowerCase();
  const filtro = o.filtro || "todas";
  const lista = fotos.filter((f) => f.client_id === o.clientId && f.ativa && !f.referencia_web).filter((f) => {
    if (termo && `${f.nome} ${f.pasta || ""} ${f.categoria || ""} ${f.descricao || ""} ${(f.tags || []).join(" ")}`.toLowerCase().indexOf(termo) < 0) return false;
    if (filtro === "reais") return classeDaFoto(f) === "original";
    if (filtro === "geradas") return classeDaFoto(f) !== "original";
    if (filtro === "favoritas") return ehFavorita(f);
    if (filtro === "sem_uso") return !usoDaFoto(f);
    if (filtro === "usadas") return !!usoDaFoto(f);
    if (filtro === "desta_pauta") return !!o.taskId && (f.tags || []).indexOf(`task:${o.taskId}`) >= 0;
    return true;
  });
  const data = (f: FotoDoAcervo) => Date.parse(f.criado_em) || 0;
  const ordem = o.ordem || "recentes";
  return lista.slice().sort((a, b) => {
    if (ordem === "nome") return a.nome.localeCompare(b.nome, "pt-BR");
    if (ordem === "antigas") return data(a) - data(b);
    if (ordem === "favoritas") return Number(ehFavorita(b)) - Number(ehFavorita(a)) || data(b) - data(a);
    return data(b) - data(a);
  });
}

/** Lado menor da foto em pixels (null quando o acervo não mediu). */
export const ladoMenor = (f: Pick<FotoDoAcervo, "largura" | "altura">) => (f.largura && f.altura ? Math.min(f.largura, f.altura) : null);
/** Alta qualidade para o feed: lado menor de 1080 px ou mais. */
export const LADO_DE_ALTA = 1080;
export const emAlta = (f: Pick<FotoDoAcervo, "largura" | "altura">) => {
  const l = ladoMenor(f);
  return l === null ? null : l >= LADO_DE_ALTA;
};

/** Move o item de um índice para outro (arrastar ou setas). Pura. */
export function moverNaOrdem<T>(lista: T[], de: number, para: number): T[] {
  if (de === para || de < 0 || para < 0 || de >= lista.length || para >= lista.length) return lista;
  const n = lista.slice();
  const [item] = n.splice(de, 1);
  n.splice(para, 0, item);
  return n;
}
