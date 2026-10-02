/**
 * Diversidade visual no Estúdio de arte (02/10/2026): lê as últimas direções
 * do cliente (estudio_trabalhos.direcao, que o diretor já grava) e devolve o
 * "o que variar agora" para o diretor (regras em _shared/diversidade-visual.ts).
 *
 * pecaDoTrabalho é pura (Vitest); variarAgoraNoEstudio lê o banco e nunca
 * lança: falha vira as regras gerais.
 */

import { oQueVariarAgora, type OpcoesDoVariar, type PecaRecente } from "../../_shared/diversidade-visual.ts";

/** Famílias de layout da lâmina (para sugerir a que não apareceu). */
export const FAMILIAS_DE_LAYOUT_DA_ARTE = [
  "texto no topo e foto ocupando a base",
  "foto sangrando de página inteira com texto na base",
  "coluna de texto ao lado do sujeito",
  "tipográfica em escala grande, sem foto",
  "close de detalhe com texto curto no canto",
  "vista de cima (flat lay) com texto no espaço livre",
  "tela dividida meio a meio entre foto e cor lisa",
];

const ROTULO_DA_ZONA: Record<string, string> = {
  "topo-esquerda": "texto no topo",
  "topo-centro": "texto no topo",
  "centro-esquerda": "texto no meio, à esquerda",
  "centro": "texto centralizado",
  "base-esquerda": "texto na base",
  "base-centro": "texto na base",
  "base-direita": "texto na base",
  "coluna-esquerda": "coluna de texto ao lado do sujeito",
  "coluna-direita": "coluna de texto ao lado do sujeito",
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown, max = 240) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const ROUPA = /(roupa|veste|vestindo|vestida|vestido|usando|camiset\w*|camisa|blusa|jaleco|uniforme|moletom|terno|avental)[^.;]{0,80}/i;

/** O que uma direção do Estúdio usou: cor do fundo, zona do texto da capa, cena, roupa e formato. */
export function pecaDoTrabalho(t: { direcao?: unknown; tipo?: unknown }): PecaRecente {
  const d = obj(t.direcao);
  const cards = (Array.isArray(d.cards) ? d.cards : []).map(obj);
  const capa = cards[0] || {};
  const layout = obj(capa.layout);
  const fio = str(d.fio_visual, 600);
  const imagem = str(layout.imagem) || str(capa.ilustracao);
  const roupa = (ROUPA.exec(`${fio} ${imagem}`) || [""])[0].trim() || null;
  const zona = str(layout.zona_texto, 40);
  return {
    cores: [layout.cor_fundo, ...cards.slice(1, 3).map((c) => obj(c.layout).cor_fundo)].map((c) => (typeof c === "string" ? c : null)),
    layout: zona ? ROTULO_DA_ZONA[zona] || zona : null,
    cenario: [imagem, str(layout.fundo, 160)].filter(Boolean).join(". ") || null,
    roupa,
    formato: t.tipo === "ads" ? "criativo de anúncio" : cards.length > 1 ? "carrossel" : cards.length === 1 ? "post único" : null,
  };
}

// deno-lint-ignore no-explicit-any
type Banco = { from: (tabela: string) => any };

/** Marca do trabalho: a marca não principal só vê as peças dela; a principal, as sem marca e as dela. */
function daMarca(d: Record<string, unknown>, marca: { id: string; principal: boolean } | null | undefined): boolean {
  if (!marca) return true;
  const m = typeof d.marca_id === "string" ? d.marca_id : null;
  return marca.principal ? !m || m === marca.id : m === marca.id;
}

/** O bloco "o que variar agora" do diretor de arte; nunca lança. */
export async function variarAgoraNoEstudio(
  db: Banco,
  clientId: string,
  e: { excluirId?: string | null; marca?: { id: string; principal: boolean } | null; paleta?: OpcoesDoVariar["paleta"]; pedido?: string | null },
): Promise<string> {
  let pecas: PecaRecente[] = [];
  try {
    const { data, error } = await db
      .from("estudio_trabalhos")
      .select("id, direcao, tipo")
      .eq("client_id", clientId)
      .order("criado_em", { ascending: false })
      .limit(20);
    if (!error) {
      pecas = ((data as { id: string; direcao: unknown; tipo: unknown }[] | null) ?? [])
        .filter((t) => t.id !== e.excluirId && daMarca(obj(t.direcao), e.marca))
        .map(pecaDoTrabalho);
    }
  } catch {
    pecas = [];
  }
  return oQueVariarAgora(pecas, { paleta: e.paleta, pedido: e.pedido, familias: FAMILIAS_DE_LAYOUT_DA_ARTE });
}
