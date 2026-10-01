/**
 * Trocar o cenário com a pessoa fixa, do lado da tela (frente TCN, 01/10/2026).
 * Regras e preços: supabase/functions/mesa-videos/modulos/troca-de-cenario.ts.
 *
 * - Custo antes: a ação sem `custo_confirmado_usd` devolve 409 confirmar_custo
 *   com a estimativa (nada é gasto). O clique "Gerar por US$ X" manda o mesmo
 *   corpo com o valor e um uid (o mesmo clique nunca gera duas vezes).
 * - O resultado entra no projeto por operação (Ctrl+Z desfaz), uma vez só:
 *   a tela marca `cenario_inserido` logo depois.
 */

import type { ProjetoDeEdicao } from "../../../supabase/functions/_shared/projeto-de-edicao";
import type { EstadoDaTroca, LayoutDaTroca, PapelDoEnvio, QualidadeDaTroca } from "../../../supabase/functions/mesa-videos/modulos/troca-de-cenario";
import { apelidosDoProjeto } from "./apelidos";
import type { ItemDaBiblioteca } from "./biblioteca";
import { acharClipe, emOrdem } from "./operacoes";

export interface TrocaNaTela {
  id: string;
  versao_id: string | null;
  clipe_ref: string | null;
  arquivo_id: string | null;
  fonte_path: string;
  entrada_s: number;
  saida_s: number;
  cenario: string;
  galeria: string | null;
  qualidade: QualidadeDaTroca;
  layout: LayoutDaTroca;
  formato: string | null;
  estado: EstadoDaTroca;
  estado_texto: string;
  amostras: { n: number; url: string | null; custo_usd: number }[];
  escolha: number | null;
  envios: { papel: PapelDoEnvio; motor: string; estado: string; posicao: number | null; erro: string | null }[];
  custo_estimado: Record<string, unknown> | null;
  custo_usd: number;
  resultado: { id: string; nome: string; tipo: string; storage_bucket: string; storage_path: string; duracao_s: number | null; largura: number | null; altura: number | null } | null;
  erro: string | null;
  inserido_em: string | null;
  criado_em: string;
}

export interface EstadoDasQualidades {
  [q: string]: { pronto: boolean; motivo: string | null };
}

export const EM_CURSO: EstadoDaTroca[] = ["amostrando", "preparando", "gerando", "compondo"];
export const emCurso = (t: Pick<TrocaNaTela, "estado">) => EM_CURSO.indexOf(t.estado) >= 0;

// ------------------------------------------------------------------ custo antes, depois gera

export type Chamar = (corpo: Record<string, unknown>) => Promise<any>;

export interface CustoMostrado {
  usd: number;
  detalhe: string;
}

export type RespostaDoPedido = { tipo: "custo"; custo: CustoMostrado; mudou: boolean } | { tipo: "feito"; troca: TrocaNaTela } | { tipo: "erro"; mensagem: string; codigo: string };

const codigoDe = (e: unknown) => (e && typeof e === "object" && typeof (e as { codigo?: unknown }).codigo === "string" ? String((e as { codigo: string }).codigo) : "");
const detalhesDe = (e: unknown): Record<string, unknown> => (e && typeof e === "object" && (e as { detalhes?: unknown }).detalhes && typeof (e as { detalhes: unknown }).detalhes === "object" ? (e as { detalhes: Record<string, unknown> }).detalhes : {});

export function custoDoErro(e: unknown): CustoMostrado | null {
  const c = detalhesDe(e).custo_estimado;
  if (!c || typeof c !== "object") return null;
  const usd = Number((c as Record<string, unknown>).usd);
  return isFinite(usd) ? { usd, detalhe: String((c as Record<string, unknown>).detalhe || "") } : null;
}

/** Sem o valor: a estimativa (nada gasto). Com o valor e o uid: gera. */
export async function pedirComCusto(chamar: Chamar, corpo: Record<string, unknown>, confirmado?: { usd: number; uid: string }): Promise<RespostaDoPedido> {
  const pedido: Record<string, unknown> = { ...corpo };
  if (confirmado) {
    pedido.custo_confirmado_usd = confirmado.usd;
    pedido.uid = confirmado.uid;
  } else delete pedido.custo_confirmado_usd;
  try {
    const r = await chamar(pedido);
    if (r && r.troca) return { tipo: "feito", troca: r.troca as TrocaNaTela };
    return { tipo: "erro", codigo: "sem_resposta", mensagem: "O servidor não devolveu a troca." };
  } catch (e) {
    const codigo = codigoDe(e);
    const custo = custoDoErro(e);
    if ((codigo === "confirmar_custo" || codigo === "custo_mudou") && custo) return { tipo: "custo", custo, mudou: codigo === "custo_mudou" };
    if (codigo === "acao_desconhecida" || codigo === "funcao_indisponivel") return { tipo: "erro", codigo, mensagem: "A troca de cenário está em preparação no servidor (função ainda não publicada)." };
    if (codigo === "banco_sem_troca_de_cenario") return { tipo: "erro", codigo, mensagem: "A troca de cenário ainda não foi ativada no banco." };
    return { tipo: "erro", codigo, mensagem: e instanceof Error && e.message ? e.message : "Não deu. Tente de novo." };
  }
}

// ------------------------------------------------------------------ de onde vem o vídeo

export interface OrigemDoVideo {
  /** "clipe:<id>" ou "arquivo:<id>". */
  chave: string;
  rotulo: string;
  fonte_path: string;
  fonte_bucket: string;
  arquivo_id: string | null;
  clipe_ref: string | null;
  /** Chave da fonte no projeto (para a URL já assinada). */
  fonte: string | null;
  entrada_s: number;
  saida_s: number;
  duracao_s: number | null;
}

const curto = (s: number) => {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

/** Clipes de vídeo do projeto (na ordem das trilhas), com o trecho da fonte que cada um usa. */
export function clipesDeVideo(p: ProjetoDeEdicao): OrigemDoVideo[] {
  const a = apelidosDoProjeto(p);
  const saida: OrigemDoVideo[] = [];
  p.trilhas.filter((t) => t.tipo === "video").forEach((t) =>
    emOrdem(t).forEach((c) => {
      const f = c.fonte ? p.fontes[c.fonte] : null;
      if (!f || !f.storage_path || f.midia !== "video" || (f.storage_bucket && f.storage_bucket !== "mesa")) return;
      saida.push({
        chave: `clipe:${c.id}`,
        rotulo: `${(a.porId[c.id] || "").toUpperCase()} · ${f.nome} · ${curto(c.entrada_s)} a ${curto(c.saida_s)}`,
        fonte_path: f.storage_path,
        fonte_bucket: "mesa",
        arquivo_id: f.arquivo_id || null,
        clipe_ref: c.id,
        fonte: c.fonte,
        entrada_s: c.entrada_s,
        saida_s: c.saida_s,
        duracao_s: f.duracao_s || null,
      });
    }),
  );
  return saida;
}

/** Vídeo do acervo inteiro como origem (o trecho começa no zero, até o teto da qualidade). */
export function origemDoAcervo(a: { id: string; nome: string; storage_bucket: string; storage_path: string; duracao_s: number | null }, maxS: number): OrigemDoVideo {
  const d = a.duracao_s && a.duracao_s > 0 ? a.duracao_s : maxS;
  return { chave: `arquivo:${a.id}`, rotulo: a.nome, fonte_path: a.storage_path, fonte_bucket: a.storage_bucket || "mesa", arquivo_id: a.id, clipe_ref: null, fonte: null, entrada_s: 0, saida_s: Math.round(Math.min(d, maxS) * 100) / 100, duracao_s: a.duracao_s };
}

/** O trecho preso ao que a qualidade aceita (mantém o início; corta o fim). */
export function trechoNoLimite(entrada: number, saida: number, maxS: number, duracaoDaFonte: number | null): { entrada_s: number; saida_s: number } {
  const e = Math.max(0, Math.round(entrada * 100) / 100);
  let s = Math.round(saida * 100) / 100;
  if (duracaoDaFonte && duracaoDaFonte > 0) s = Math.min(s, duracaoDaFonte);
  if (s - e > maxS) s = Math.round((e + maxS) * 100) / 100;
  return { entrada_s: e, saida_s: s };
}

// ------------------------------------------------------------------ resultado na linha do tempo

/** O arquivo pronto como item da Mídia (vira fonte e clipe). */
export function itemDoResultado(t: TrocaNaTela): ItemDaBiblioteca | null {
  const r = t.resultado;
  if (!r || !r.storage_path) return null;
  return { id: r.id, arquivo_id: r.id, nome: r.nome || "Cenário novo", tipo: r.tipo || "gerado", storage_bucket: r.storage_bucket || "mesa", storage_path: r.storage_path, duracao_s: r.duracao_s, largura: r.largura, altura: r.altura, origem: "gerado" };
}

/** Logo depois do clipe de onde veio (se ainda existe); senão, no fim. */
export function ondeEntra(p: ProjetoDeEdicao, t: Pick<TrocaNaTela, "clipe_ref">): "fim" | { depoisDe: string } {
  return t.clipe_ref && acharClipe(p, t.clipe_ref) ? { depoisDe: t.clipe_ref } : "fim";
}

/** As trocas prontas desta versão que ainda não entraram no projeto. */
export function prontasParaEntrar(trocas: TrocaNaTela[], versaoId: string, jaPostas: Record<string, true> = {}): TrocaNaTela[] {
  return trocas.filter((t) => t.estado === "pronto" && !t.inserido_em && t.versao_id === versaoId && !!t.resultado && !jaPostas[t.id]);
}

export const usd = (n: number) => `US$ ${n.toFixed(n < 0.1 ? 3 : 2).replace(".", ",")}`;
