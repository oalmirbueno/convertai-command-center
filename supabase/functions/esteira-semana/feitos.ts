/**
 * O que JÁ FOI FEITO nas últimas semanas, para o plano não propor de novo
 * (frente CE, 28/09/2026).
 *
 * O dono: "tá repetindo demais as tarefas: a gente finaliza, depois ele
 * volta". Causa: a marca de feito da esteira vale só para a semana em que foi
 * feita (cycle_item_state por week_start) e o plano da semana seguinte era
 * gerado sem saber dela; bastava a IA escrever o mesmo passo com outro título
 * para ele voltar como novo.
 *
 * Fonte: o diário do cliente (project_memory), onde toda marcação de feito
 * da esteira ("Feito · X", kind ciclo ou marco) e toda tarefa concluída
 * (gatilho do banco, kind acao) ficam com título e data.
 */

import { contencao, ngramas, palavras } from "../ritual-writer/memoria.ts";
import type { PerguntaJev, ResultadoJev } from "../_shared/jev.ts";

// deno-lint-ignore no-explicit-any
type Banco = { from: (t: string) => any };

export interface FeitoAntes {
  titulo: string;
  quando: string;
}

const PREFIXO = /^(feito|j[aá] tem|conclu[ií]d[ao])\s*[·:.-]\s*/i;

export async function lerFeitosAntes(db: Banco, clientId: string, agora: Date = new Date(), dias = 35): Promise<FeitoAntes[]> {
  const desde = new Date(agora.getTime() - dias * 86_400_000).toISOString();
  const { data, error } = await db.from("project_memory").select("title, created_at, kind")
    .eq("client_id", clientId).in("kind", ["ciclo", "acao", "marco"]).gte("created_at", desde)
    .order("created_at", { ascending: false }).limit(200);
  if (error || !Array.isArray(data)) return [];
  const saida: FeitoAntes[] = [];
  const vistos = new Set<string>();
  for (const r of data as Array<Record<string, unknown>>) {
    const bruto = String(r.title ?? "").trim();
    // Desfeito depois de feito (a lista vem do mais novo): o feito antigo não vale.
    const desfeito = /^desfeito\s*[·:.-]\s*/i.exec(bruto);
    if (desfeito) { vistos.add(bruto.slice(desfeito[0].length).trim().toLowerCase()); continue; }
    if (!PREFIXO.test(bruto)) continue;
    const titulo = bruto.replace(PREFIXO, "").trim();
    const chave = titulo.toLowerCase();
    if (!titulo || vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push({ titulo, quando: String(r.created_at ?? "") });
  }
  return saida;
}

/** Radicais (5 letras) das palavras com peso: "montar" e "montado" batem. */
function radicais(texto: string): Set<string> {
  return new Set(palavras(texto).filter((p) => p.length >= 4).map((p) => p.slice(0, 5)));
}

/** O item proposto já foi feito (mesmo com outras palavras)? Devolve qual. Só a regra. */
export function jaFeito(item: { titulo: string; passo?: string }, feitos: readonly FeitoAntes[]): FeitoAntes | null {
  const a = ngramas(palavras(item.titulo), 2);
  const b = ngramas(palavras(`${item.titulo} ${item.passo ?? ""}`), 2);
  const ra = radicais(item.titulo);
  for (const f of feitos) {
    const x = ngramas(palavras(f.titulo), 2);
    if (a.size && x.size && (contencao(a, x) >= 0.6 || contencao(x, a) >= 0.6 || (x.size >= 2 && contencao(x, b) >= 0.75))) return f;
    const rx = radicais(f.titulo);
    if (ra.size >= 2 && rx.size >= 2 && (contencao(ra, rx) >= 0.75 || contencao(rx, ra) >= 0.75)) return f;
  }
  return null;
}

/** Parecido o bastante para valer a pergunta ao Jev (nem igual, nem outro assunto). */
function parecido(item: { titulo: string; passo?: string }, f: FeitoAntes): boolean {
  const ra = radicais(`${item.titulo} ${item.passo ?? ""}`);
  const rx = radicais(f.titulo);
  return rx.size > 0 && contencao(rx, ra) >= 0.34;
}

export type PerguntarJaFeito = (pedido: { state: unknown; questions: Record<string, PerguntaJev> }, opcoes?: { timeoutMs?: number }) => Promise<ResultadoJev>;

/**
 * Tira do plano o que já foi feito. Primeiro a regra; o que ela não resolve
 * e se parece com algum feito vai ao Jev numa chamada só (Choice por passo:
 * qual feito é o mesmo trabalho, ou "nenhum"). Sem Jev, fica a regra.
 */
export async function filtrarJaFeitos<T extends { titulo: string; passo: string }>(
  propostos: readonly T[],
  feitos: readonly FeitoAntes[],
  perguntar: PerguntarJaFeito | null,
): Promise<{ novos: T[]; removidos: Array<{ item: T; feito: FeitoAntes; fonte: "regra" | "jev" }> }> {
  const removidos: Array<{ item: T; feito: FeitoAntes; fonte: "regra" | "jev" }> = [];
  const duvida: Array<{ item: T; candidatos: FeitoAntes[] }> = [];
  const novos: T[] = [];
  for (const item of propostos) {
    const f = jaFeito(item, feitos);
    if (f) { removidos.push({ item, feito: f, fonte: "regra" }); continue; }
    const candidatos = feitos.filter((x) => parecido(item, x)).slice(0, 12);
    if (candidatos.length) duvida.push({ item, candidatos });
    else novos.push(item);
  }
  if (!duvida.length) return { novos, removidos };
  if (!perguntar) return { novos: [...novos, ...duvida.map((d) => d.item)], removidos };

  const questions: Record<string, PerguntaJev> = {};
  duvida.forEach((d, i) => {
    const criteria: Record<string, string> = { nenhum: "Nenhum: é trabalho novo, ou o próximo degrau depois do que foi feito." };
    d.candidatos.forEach((c, k) => { criteria[`f${k + 1}`] = `${c.quando.slice(0, 10)}: ${c.titulo.slice(0, 160)}`; });
    questions[`feito_${i}`] = {
      type: "choice",
      instructions: `Uma agência planeja a semana de um cliente. O plano propôs: "${d.item.titulo}: ${d.item.passo.slice(0, 200)}". Algum dos itens já feitos nas últimas semanas é ESTE MESMO trabalho (mesma peça, mesma decisão, mesma entrega), a ponto de propor de novo ser repetição? Um passo seguinte ou uma nova peça do mesmo tema não é o mesmo trabalho.`,
      criteria,
    };
  });
  let respostas: ResultadoJev["answers"] = {};
  try {
    respostas = (await perguntar({ state: { propostos: duvida.map((d) => d.item.titulo) }, questions }, { timeoutMs: 8_000 })).answers ?? {};
  } catch {
    return { novos: [...novos, ...duvida.map((d) => d.item)], removidos };
  }
  duvida.forEach((d, i) => {
    const a = respostas[`feito_${i}`];
    const escolha = typeof a?.choice === "string" ? a.choice : "nenhum";
    const prob = a?.probabilities ? Number(a.probabilities[escolha]) : 0;
    const k = escolha.startsWith("f") ? Number(escolha.slice(1)) - 1 : -1;
    if (k >= 0 && prob >= 0.6 && d.candidatos[k]) removidos.push({ item: d.item, feito: d.candidatos[k], fonte: "jev" });
    else novos.push(d.item);
  });
  const ordem = new Map(propostos.map((p, i) => [p, i]));
  novos.sort((x, y) => (ordem.get(x) ?? 0) - (ordem.get(y) ?? 0));
  return { novos, removidos };
}

export function feitosComoTexto(feitos: readonly FeitoAntes[]): string {
  if (!feitos.length) return "";
  return [
    "JA FEITO NAS ULTIMAS SEMANAS (nao proponha de novo; o proximo degrau parte daqui):",
    ...feitos.slice(0, 40).map((f) => `- ${f.quando.slice(8, 10)}/${f.quando.slice(5, 7)}: ${f.titulo}`),
  ].join("\n");
}
