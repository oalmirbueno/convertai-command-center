/**
 * A capa escolhida antes de mostrar (17/10/2026). Dono: "nota de 'isto vende?' antes de te mostrar: o Estúdio
 * gera duas capas e o Jev dá nota de gancho, clareza da oferta e leitura no celular; você vê só a melhor".
 *
 * Depois da direção (e da revisão do texto), antes de gravar e antes de qualquer imagem: o redator escreve 3
 * títulos alternativos para a capa (mesma promessa, sem inventar fato) e o Jev dá três notas a cada um dos 4
 * (o do diretor e os 3 novos), numa chamada só. A capa só troca quando a melhor passa a do diretor com folga;
 * sem laço, sem segunda rodada. Falhar em qualquer passo deixa a capa do diretor como estava.
 */

import type { BlocoTexto, CardDirecao } from "../../_shared/direcao-arte.ts";
import type { PerguntaJev, RespostaJev } from "../../_shared/jev.ts";

export const ALTERNATIVAS_DA_CAPA = 3;
/** A troca só vale com essa folga sobre a capa do diretor (notas de 0 a 3, ponderadas). */
export const FOLGA_PARA_TROCAR = 0.25;
const PESOS = { gancho: 0.45, clareza: 0.35, leitura: 0.2 } as const;

export const ESQUEMA_CAPAS = {
  nome: "capas_alternativas",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["capas"],
    properties: {
      capas: { type: "array", items: { type: "string" } },
    },
  },
};

export const SISTEMA_DAS_CAPAS = `Você é o redator de capas de carrossel e post de Instagram de uma agência de marketing. A capa é a primeira lâmina: o título que faz a pessoa parar de rolar.
Escreva ${ALTERNATIVAS_DA_CAPA} títulos ALTERNATIVOS para a capa dada, cada um com um ângulo diferente (curiosidade, dor ou erro, benefício direto, número concreto), mantendo a MESMA promessa e o mesmo assunto do conteúdo.
Regras: até 7 palavras; português do Brasil falado; palavras simples que se leem de relance no celular; nada de jargão de marketing; não invente número, preço, prazo, prêmio ou resultado que não esteja nos fatos; não escreva o nome da marca; sem travessão; sem emoji; sem aspas.
Responda só com o JSON pedido.`;

export function pedidoDasCapas(e: { capa: string; tema: string; conceito: string; outras: string[]; fatos: string[] }): string {
  return [
    `CAPA DO DIRETOR: ${e.capa}`,
    `ASSUNTO: ${e.tema}`,
    e.conceito ? `CONCEITO DA PEÇA: ${e.conceito}` : "",
    e.outras.length ? `O QUE AS LÂMINAS SEGUINTES DIZEM:\n${e.outras.map((t, i) => `${i + 2}. ${t}`).join("\n")}` : "",
    e.fatos.length ? `FATOS CONFIRMADOS (só estes números e nomes podem aparecer):\n${e.fatos.join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

/** O título da capa: o bloco headline (ou o primeiro). */
export function tituloDaCapa(card: CardDirecao): string {
  const blocos = card.blocos || [];
  const h = blocos.find((b) => b.papel === "headline") || blocos[0];
  return (h ? h.texto : card.texto_exato.split("\n")[0] || "").trim();
}

/** Os títulos novos, limpos: até 7 palavras, sem repetir o do diretor nem entre si. */
export function limparAlternativas(bruto: unknown, doDiretor: string): string[] {
  const lista = bruto && typeof bruto === "object" && Array.isArray((bruto as { capas?: unknown }).capas) ? (bruto as { capas: unknown[] }).capas : [];
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9à-ú]+/g, " ").trim();
  const vistos = new Set([norm(doDiretor)]);
  const out: string[] = [];
  for (const c of lista) {
    if (typeof c !== "string") continue;
    const t = c.replace(/["“”]/g, "").replace(new RegExp(String.fromCharCode(0x2014), "g"), ",").replace(/\s+/g, " ").trim();
    const palavras = t.split(" ").filter(Boolean).length;
    if (!t || palavras > 7 || palavras < 2 || vistos.has(norm(t))) continue;
    vistos.add(norm(t));
    out.push(t);
    if (out.length >= ALTERNATIVAS_DA_CAPA) break;
  }
  return out;
}

const NIVEIS = {
  gancho: [
    "Passaria batido: a pessoa continua rolando",
    "Chama pouca atenção: só para quem já procurava o assunto",
    "Desperta curiosidade: boa parte do público pararia",
    "Para a rolagem: a pessoa quer ver a próxima lâmina",
  ],
  clareza: [
    "Não dá para saber o que a pessoa ganha",
    "O ganho aparece, mas vago",
    "O ganho ou a promessa fica claro",
    "Fica claro e concreto o que a pessoa ganha com isso",
  ],
  leitura: [
    "Difícil de ler de relance: longo, confuso ou com jargão",
    "Lê, mas pede esforço",
    "Lê de relance, com uma palavra difícil ou sobrando",
    "Lê num relance no celular: curto e com palavras simples",
  ],
};

export function perguntasDaCapa(total: number): Record<string, PerguntaJev> {
  const q: Record<string, PerguntaJev> = {};
  for (let i = 0; i < total; i += 1) {
    q[`gancho_${i}`] = { type: "score", instructions: `Para o público deste cliente, quanto o título de capa \`capas[${i}]\` faz a pessoa parar de rolar no Instagram e querer ver a próxima lâmina?`, criteria: NIVEIS.gancho };
    q[`clareza_${i}`] = { type: "score", instructions: `Quanto o título de capa \`capas[${i}]\` deixa claro o que a pessoa ganha (o benefício ou a promessa do conteúdo, em \`assunto\`)?`, criteria: NIVEIS.clareza };
    q[`leitura_${i}`] = { type: "score", instructions: `Quanto o título de capa \`capas[${i}]\` se lê de relance na tela do celular?`, criteria: NIVEIS.leitura };
  }
  return q;
}

export type NotaDaCapa = { texto: string; gancho: number | null; clareza: number | null; leitura: number | null; total: number };

export function notasDasCapas(capas: string[], respostas: Record<string, RespostaJev>): NotaDaCapa[] {
  const n = (r: RespostaJev | undefined) => (typeof r?.score === "number" && Number.isFinite(r.score) ? r.score : null);
  return capas.map((texto, i) => {
    const g = n(respostas[`gancho_${i}`]);
    const c = n(respostas[`clareza_${i}`]);
    const l = n(respostas[`leitura_${i}`]);
    const total = (g ?? 0) * PESOS.gancho + (c ?? 0) * PESOS.clareza + (l ?? 0) * PESOS.leitura;
    return { texto, gancho: g, clareza: c, leitura: l, total: Math.round(total * 100) / 100 };
  });
}

/** O índice escolhido: 0 (a do diretor) a menos que outra passe com folga. */
export function indiceEscolhido(notas: NotaDaCapa[]): number {
  if (!notas.length) return 0;
  let melhor = 0;
  notas.forEach((x, i) => { if (x.total > notas[melhor].total) melhor = i; });
  return melhor !== 0 && notas[melhor].total - notas[0].total >= FOLGA_PARA_TROCAR ? melhor : 0;
}

/** A capa com o título novo no lugar do headline; o resto dos blocos fica igual. */
export function capaComTitulo(card: CardDirecao, titulo: string): CardDirecao {
  const base: BlocoTexto[] = card.blocos && card.blocos.length ? card.blocos : [{ papel: "headline", texto: card.texto_exato }];
  const blocos: BlocoTexto[] = base.map((b) => ({ ...b }));
  const i = blocos.findIndex((b) => b.papel === "headline");
  blocos[i >= 0 ? i : 0] = { ...blocos[i >= 0 ? i : 0], texto: titulo };
  return { ...card, blocos, texto_exato: blocos.map((b) => b.texto).join("\n") };
}

/**
 * O passo inteiro: o redator escreve as alternativas, o Jev dá as notas e a melhor fica (a do diretor, sem folga).
 * `redigir` e `julgar` chegam de quem chama (a chamada ao modelo e ao Jev com a cobrança no trabalho).
 */
export async function escolherCapa(
  e: { capa: CardDirecao; assunto: string; conceito: string; outras: string[]; fatos: string[] },
  redigir: (sistema: string, pedido: string) => Promise<{ json: unknown; custoUsd: number }>,
  julgar: (state: unknown, questions: Record<string, PerguntaJev>) => Promise<{ answers: Record<string, RespostaJev>; custoUsd: number }>,
): Promise<{ card: CardDirecao | null; notas: NotaDaCapa[]; escolhida: number; custoUsd: number }> {
  const doDiretor = tituloDaCapa(e.capa);
  if (!doDiretor) return { card: null, notas: [], escolhida: 0, custoUsd: 0 };
  const r = await redigir(SISTEMA_DAS_CAPAS, pedidoDasCapas({ capa: doDiretor, tema: e.assunto, conceito: e.conceito, outras: e.outras, fatos: e.fatos }));
  const alternativas = limparAlternativas(r.json, doDiretor);
  if (!alternativas.length) return { card: null, notas: [], escolhida: 0, custoUsd: r.custoUsd };
  const capas = [doDiretor, ...alternativas];
  const j = await julgar({ assunto: e.assunto, conceito: e.conceito || null, capas }, perguntasDaCapa(capas.length));
  const notas = notasDasCapas(capas, j.answers);
  const escolhida = indiceEscolhido(notas);
  return { card: escolhida > 0 ? capaComTitulo(e.capa, capas[escolhida]) : null, notas, escolhida, custoUsd: r.custoUsd + j.custoUsd };
}
