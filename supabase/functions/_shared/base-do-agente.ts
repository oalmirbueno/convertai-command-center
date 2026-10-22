/**
 * A base de cada agente NA GERAÇÃO (17/10/2026). O dono ensina (texto,
 * documento, link) e a pesquisa semanal complementa; aqui o agente lê o que
 * aprendeu antes de gerar.
 *
 * - Lê as fichas ativas do agente: as gerais e as só deste cliente.
 * - Cabem todas no teto: vão todas (as do cliente primeiro).
 * - Não cabem: o Jev dá uma nota de relevância de cada ficha para ESTE pedido
 *   (Score, uma pergunta por ficha, todas numa chamada) e entram as melhores
 *   até o teto. Sem o Jev, a ordem cai na conta de palavras em comum.
 * - O uso fica registrado (agente_base_registrar_uso): a tela mostra quantas
 *   vezes cada ficha entrou e quando.
 *
 * Sem ficha nenhuma o bloco volta vazio e o prompt sai byte a byte igual ao de
 * antes (os testes de prompt exato continuam valendo).
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { cobrarJev, type ReferenciaUso, type Tarefa } from "./ia-motor.ts";
import { jevPerguntar, notaScore, type PerguntaJev } from "./jev.ts";
import { deveSair, pesoDaFicha, type ResultadoDaFicha } from "./resultado-das-fichas.ts";
import { ehDaCasa } from "./agentes-com-base.ts";

export { AGENTES_COM_BASE, agenteComBase, CHAVES_COM_BASE, ehDaCasa } from "./agentes-com-base.ts";

export interface FichaDaBase {
  id: string;
  titulo: string;
  tecnica: string;
  quando_usar: string;
  exemplo: string;
  client_id: string | null;
  /** 23/10: "biblioteca:..." marca o documento da Biblioteca da casa. */
  fonte_url?: string | null;
  /** 17/10: o resultado gravado pela rotina da base (aprovações e múltiplo dos posts). */
  aprovadas?: number;
  ajustadas?: number;
  reprovadas?: number;
  posts?: number;
  multiplo?: number | string | null;
  anuncios?: number;
  eficiencia?: number | string | null;
}

/** O resultado da ficha no formato do módulo puro (a coluna numeric chega como texto). */
export function resultadoDaFicha(f: FichaDaBase): ResultadoDaFicha {
  const m = f.multiplo === null || f.multiplo === undefined ? null : Number(f.multiplo);
  const ef = f.eficiencia === null || f.eficiencia === undefined ? null : Number(f.eficiencia);
  return { aprovadas: f.aprovadas ?? 0, ajustadas: f.ajustadas ?? 0, reprovadas: f.reprovadas ?? 0, posts: f.posts ?? 0, multiplo: m !== null && Number.isFinite(m) ? m : null, anuncios: f.anuncios ?? 0, eficiencia: ef !== null && Number.isFinite(ef) ? ef : null };
}

/** Teto padrão do bloco no prompt (caracteres). */
export const TETO_DA_BASE = 6_000;
/** Quantas fichas o Jev avalia de uma vez (as mais novas). */
const MAX_FICHAS_AVALIADAS = 40;
/** Nota mínima (0 a 3) para entrar quando há seleção. */
const NOTA_MINIMA = 1;
/**
 * 23/10 (Biblioteca da casa): por pedido entram no máximo MAX_DA_CASA documentos da casa, os mais relevantes,
 * e eles nunca passam de PARTE_DA_CASA do teto (o resto fica para o que o dono ensinou e o que veio dos resultados).
 */
export const MAX_DA_CASA = 3;
export const PARTE_DA_CASA = 0.5;
/** Quantos documentos da casa o Jev avalia por pedido (o resto das 40 vagas fica com as outras fichas). */
const CASA_AVALIADA = 15;

export const CABECALHO_DA_BASE =
  "BASE DO AGENTE (técnicas que o dono ensinou e que a pesquisa trouxe; aplique as que servem a este pedido, sempre a serviço de vender para o cliente, sem citar a base nem copiar exemplos ao pé da letra):";

export function textoDaFicha(f: FichaDaBase): string {
  const partes = [`- ${f.titulo.trim()}${f.client_id ? " (só deste cliente)" : ""}: ${f.tecnica.trim()}`];
  if (f.quando_usar.trim()) partes.push(`Quando usar: ${f.quando_usar.trim()}`);
  if (f.exemplo.trim()) partes.push(`Exemplo: ${f.exemplo.trim()}`);
  return partes.join(" ");
}

/** As palavras de 4 letras ou mais, sem acento, para a ordem de reserva. */
function palavras(t: string): Set<string> {
  return new Set(
    t.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").split(/[^a-z0-9]+/).filter((p) => p.length >= 4),
  );
}

export function ordemPorPalavras(fichas: FichaDaBase[], pedido: string): FichaDaBase[] {
  const doPedido = palavras(pedido);
  const pontos = (f: FichaDaBase) => {
    let n = 0;
    palavras(`${f.titulo} ${f.tecnica} ${f.quando_usar}`).forEach((p) => { if (doPedido.has(p)) n += 1; });
    return n + (f.client_id ? 0.5 : 0);
  };
  return fichas.map((f, i) => ({ f, i, p: pontos(f) })).sort((a, b) => b.p - a.p || a.i - b.i).map((x) => x.f);
}

/** Enche o bloco até o teto, na ordem dada (com no máximo `maxDaCasa` documentos da casa, dentro da parte deles). */
export function encherAteOTeto(fichas: FichaDaBase[], teto: number, maxDaCasa = MAX_DA_CASA): FichaDaBase[] {
  const escolhidas: FichaDaBase[] = [];
  const tetoDaCasa = Math.floor(teto * PARTE_DA_CASA);
  let total = CABECALHO_DA_BASE.length;
  let casa = 0;
  let casaTotal = 0;
  for (const f of fichas) {
    const t = textoDaFicha(f).length + 1;
    if (total + t > teto) continue;
    if (ehDaCasa(f.fonte_url)) {
      if (casa >= maxDaCasa || casaTotal + t > tetoDaCasa) continue;
      casa += 1;
      casaTotal += t;
    }
    escolhidas.push(f);
    total += t;
  }
  return escolhidas;
}

export function blocoDaBase(fichas: FichaDaBase[]): string {
  if (!fichas.length) return "";
  return `${CABECALHO_DA_BASE}\n${fichas.map(textoDaFicha).join("\n")}`;
}

const NIVEIS_DE_RELEVANCIA = [
  "Não tem relação com o que foi pedido",
  "Relação distante: só ajudaria num pedido diferente",
  "Ajuda em parte: uma ideia aproveitável neste pedido",
  "Ajuda diretamente a fazer melhor exatamente este pedido",
];

export async function lerFichasDoAgente(
  db: SupabaseClient,
  agente: string,
  clientId: string | null,
): Promise<FichaDaBase[]> {
  let q = db
    .from("agente_base_fichas")
    .select("id, titulo, tecnica, quando_usar, exemplo, client_id, fonte_url, aprovadas, ajustadas, reprovadas, posts, multiplo, anuncios, eficiencia")
    .eq("agente", agente)
    .eq("ativa", true);
  q = clientId ? q.or(`client_id.is.null,client_id.eq.${clientId}`) : q.is("client_id", null);
  const { data, error } = await q.order("criado_em", { ascending: false }).limit(120);
  if (error) {
    console.error("base-do-agente: leitura falhou", { agente, erro: error.message });
    return [];
  }
  return (data ?? []) as FichaDaBase[];
}

/**
 * O bloco da base para o prompt do agente. Nunca derruba a geração: sem base,
 * sem banco ou sem Jev, volta o que der (no pior caso, vazio).
 */
export async function baseDoAgente(
  db: SupabaseClient,
  e: {
    agente: string;
    clientId: string | null;
    pedido: string;
    teto?: number;
    tarefa: Tarefa;
    referencia?: ReferenciaUso;
    criadoPor?: string | null;
  },
): Promise<{ bloco: string; ids: string[] }> {
  try {
    const teto = e.teto ?? TETO_DA_BASE;
    // 17/10: a ficha que só reprova (ou cujos posts rendem bem abaixo do normal) não entra mais.
    const todas = (await lerFichasDoAgente(db, e.agente, e.clientId)).filter((f) => !deveSair(resultadoDaFicha(f)));
    if (!todas.length) return { bloco: "", ids: [] };
    // As do cliente primeiro (a regra mais específica); dentro de cada grupo, as que aprovam e rendem antes.
    const porPeso = (lista: FichaDaBase[]) => lista.map((f, i) => ({ f, i, p: pesoDaFicha(resultadoDaFicha(f)) })).sort((a, b) => b.p - a.p || a.i - b.i).map((x) => x.f);
    const ordenadas = [...porPeso(todas.filter((f) => f.client_id)), ...porPeso(todas.filter((f) => !f.client_id))];
    const caberiam = encherAteOTeto(ordenadas, teto);
    let escolhidas = caberiam;
    if (caberiam.length < ordenadas.length && e.pedido.trim()) {
      escolhidas = encherAteOTeto(await ordemPeloJev(ordenadas, e), teto);
    }
    if (!escolhidas.length) return { bloco: "", ids: [] };
    const ids = escolhidas.map((f) => f.id);
    void db.rpc("agente_base_registrar_uso", {
      _ids: ids,
      _agente: e.agente,
      _client_id: e.clientId,
      _referencia_tipo: e.referencia?.tipo ?? null,
      _referencia_id: e.referencia?.id ?? null,
    }).then(({ error }) => { if (error) console.error("base-do-agente: uso não registrado", error.message); });
    return { bloco: blocoDaBase(escolhidas), ids };
  } catch (erro) {
    console.error("base-do-agente: falhou", erro instanceof Error ? erro.message : String(erro));
    return { bloco: "", ids: [] };
  }
}

async function ordemPeloJev(
  fichas: FichaDaBase[],
  e: { agente: string; clientId: string | null; pedido: string; tarefa: Tarefa; referencia?: ReferenciaUso; criadoPor?: string | null },
): Promise<FichaDaBase[]> {
  // 23/10: os documentos da casa sempre passam pelo Jev (até CASA_AVALIADA); as outras fichas ficam com o resto das vagas.
  const daCasa = fichas.filter((f) => ehDaCasa(f.fonte_url)).slice(0, CASA_AVALIADA);
  const avaliadas = [...fichas.filter((f) => !ehDaCasa(f.fonte_url)).slice(0, MAX_FICHAS_AVALIADAS - daCasa.length), ...daCasa];
  const reserva = ordemPorPalavras(fichas, e.pedido);
  const questions: Record<string, PerguntaJev> = {};
  avaliadas.forEach((_, i) => {
    questions[`f${i}`] = {
      type: "score",
      instructions: `Quanto a técnica em \`fichas[${i}]\` ajuda o agente a fazer melhor o \`pedido\` (o que ele vai gerar agora)?`,
      criteria: NIVEIS_DE_RELEVANCIA,
    };
  });
  try {
    const r = await jevPerguntar({
      state: {
        pedido: e.pedido.slice(0, 3_000),
        fichas: avaliadas.map((f) => ({ titulo: f.titulo, tecnica: f.tecnica.slice(0, 600), quando_usar: f.quando_usar })),
      },
      questions,
    });
    if (e.clientId) {
      await cobrarJev(r, { clientId: e.clientId, tarefa: e.tarefa, referencia: e.referencia, criadoPor: e.criadoPor ?? null }).catch(() => null);
    }
    // A nota do Jev (0 a 3) com o empurrão do resultado da ficha (aprovação e posts).
    const notas = avaliadas.map((f, i) => ({ f, nota: (notaScore(r.answers[`f${i}`]) ?? 0) + (f.client_id ? 0.25 : 0) + 0.5 * pesoDaFicha(resultadoDaFicha(f)) }));
    const boas = notas.filter((n) => n.nota >= NOTA_MINIMA).sort((a, b) => b.nota - a.nota).map((n) => n.f);
    return boas.length ? boas : reserva;
  } catch (erro) {
    console.error("base-do-agente: Jev indisponível, ordem por palavras", erro instanceof Error ? erro.message : String(erro));
    return reserva;
  }
}
