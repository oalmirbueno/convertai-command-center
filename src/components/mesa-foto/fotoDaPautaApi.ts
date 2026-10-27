import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao, padraoPara, parteDaConferenciaDoJev, type ModeloIa, type ParteDaEstimativa } from "@/lib/mesa/api";
import { chaveDasFotos, classeDaFoto, invalidarFotos, normalizarFoto, TAMANHOS_DA_FOTO, type FotoDoAcervo, type Guia } from "./fotoApi";
import { MAX_REFERENCIAS_DA_PAUTA, ordenarReferencias, PAPEIS_DA_REFERENCIA, paresDeTransformacao, type PapelDaReferencia } from "../../../supabase/functions/mesa-foto/foto-da-pauta-regras";

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
  /** O que a foto mostra, pela leitura de "Entender e organizar" (só tela). */
  descricao?: string | null;
  /** Rótulo da cena: mesmo lugar ou objeto entre fotos (só tela). */
  cena?: string | null;
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

// ------------------------------------------------------------------ entender e organizar as referências

export interface ReferenciaOrganizada {
  imagem_id: string;
  papel: PapelDaReferencia;
  descricao: string | null;
  cena: string | null;
  confianca: number | null;
  par: string | null;
}

/** O corpo exato da ação referencias_organizar (os testes conferem). */
export function corpoDoOrganizar(p: { clientId: string; taskId: string | null; titulo: string; pedido: string; referencias: ReferenciaDaPauta[] }): Record<string, unknown> {
  return {
    acao: "referencias_organizar",
    client_id: p.clientId,
    ...(p.taskId ? { task_id: p.taskId } : {}),
    titulo: p.titulo,
    pedido: p.pedido.trim(),
    referencias: p.referencias.slice(0, MAX_REFERENCIAS_DA_PAUTA).map((r) => ({ imagem_id: r.imagem_id, papel: r.papel })),
  };
}

export async function organizarReferencias(p: Parameters<typeof corpoDoOrganizar>[0]): Promise<{ referencias: ReferenciaOrganizada[]; custo_usd: number; avisos: string[] }> {
  const data = await chamarFuncao<any>("mesa-foto", corpoDoOrganizar(p));
  const lista: ReferenciaOrganizada[] = (data && Array.isArray(data.referencias) ? data.referencias : [])
    .filter((r: any) => r && typeof r.imagem_id === "string" && (PAPEIS_DA_REFERENCIA as readonly string[]).indexOf(r.papel) >= 0)
    .map((r: any) => ({
      imagem_id: r.imagem_id,
      papel: r.papel,
      descricao: typeof r.descricao === "string" ? r.descricao : null,
      cena: typeof r.cena === "string" ? r.cena : null,
      confianca: typeof r.confianca === "number" ? r.confianca : null,
      par: typeof r.par === "string" ? r.par : null,
    }));
  return {
    referencias: lista,
    custo_usd: Number((data && data.custo_usd) || 0) || 0,
    avisos: data && Array.isArray(data.avisos) ? data.avisos.map(String) : [],
  };
}

/**
 * Aplica a organização: papel, descrição e a ordem que o servidor devolveu.
 * Referência que a pessoa pôs enquanto a IA lia continua, no fim. Pura.
 */
export function aplicarOrganizacao(atuais: ReferenciaDaPauta[], organizadas: ReferenciaOrganizada[]): ReferenciaDaPauta[] {
  const ainda = new Set(atuais.map((r) => r.imagem_id));
  const vindas: ReferenciaDaPauta[] = organizadas
    .filter((o) => ainda.has(o.imagem_id))
    .map((o) => ({ imagem_id: o.imagem_id, papel: o.papel, descricao: o.descricao, cena: o.cena }));
  const vistas = new Set(vindas.map((r) => r.imagem_id));
  return vindas.concat(atuais.filter((r) => !vistas.has(r.imagem_id))).slice(0, MAX_REFERENCIAS_DA_PAUTA);
}

export type GrupoDeReferencias =
  | { tipo: "par"; antes: ReferenciaDaPauta; depois: ReferenciaDaPauta }
  | { tipo: "solta"; referencia: ReferenciaDaPauta };

/**
 * Como o gerador vai ler as referências: os pares antes e depois juntos (o 1º
 * antes com o 1º depois, a mesma regra do motor) e o resto na ordem. Pura.
 */
export function gruposDasReferencias(refs: ReferenciaDaPauta[]): GrupoDeReferencias[] {
  const ordem = ordenarReferencias(refs);
  const pares = paresDeTransformacao(ordem);
  const emPar = new Set<number>();
  const grupos: GrupoDeReferencias[] = pares.map((p) => {
    emPar.add(p.antes);
    emPar.add(p.depois);
    return { tipo: "par", antes: ordem[p.antes], depois: ordem[p.depois] };
  });
  ordem.forEach((r, i) => {
    if (!emPar.has(i)) grupos.push({ tipo: "solta", referencia: r });
  });
  return grupos;
}

/** Estimativa: uma leitura de visão com as fotos e a escolha dos papéis no Jev. */
export function partesDoOrganizar(catalogo: ModeloIa[], fotos: number): ParteDaEstimativa[] {
  const m = padraoPara(catalogo, "leitura");
  const n = Math.max(1, fotos);
  return [
    { modeloId: m ? m.id : null, tipo: "texto", tokensEntrada: TAMANHOS_DA_FOTO.lerFoto.entrada * n, tokensSaida: 250 * n },
    parteDaConferenciaDoJev(),
  ];
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
