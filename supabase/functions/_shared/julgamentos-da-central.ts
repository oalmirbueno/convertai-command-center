/**
 * Julgamentos de linguagem da Central, com o Jev (frente CE, 28/09/2026).
 *
 * Duas perguntas que código puro não responde bem e que o dono pegou errado
 * nas mensagens:
 *
 * 1. A campanha da Mesa é PAGA ou ORGÂNICA? "A gente criou uma campanha, mas
 *    essa campanha pode ser orgânica ou não, dentro da área de campanhas. Ele
 *    está confundindo com os anúncios." A tabela mesa_campanhas não tem canal.
 *    Primeiro a regra (palavras de verba e anúncio, nome igual ao de uma
 *    campanha de anúncio no ar); só o que a regra não resolve vai ao Jev
 *    (Choice: organica, paga, mista, indefinida). Sem Jev ou com baixa
 *    confiança: "indefinida", e a mensagem trata como campanha de conteúdo,
 *    nunca como anúncio.
 *
 * 2. A promessa da última mensagem foi CUMPRIDA ou está EM ANDAMENTO? A
 *    regra de palavras encontra a prova óbvia; o resto vai ao Jev como
 *    Choice sobre as evidências (e1..eN ou "nenhuma"), que devolve QUAL
 *    evidência prova. Sem prova: em andamento. Nunca dizemos ao cliente que
 *    algo foi feito sem a evidência apontada.
 *
 * Tudo numa chamada só ao Jev (perguntas independentes sobre o mesmo estado
 * rodam em paralelo; docs.typesafe.ai/api.md), com tempo curto. Falha do Jev
 * nunca derruba a mensagem: fica a regra.
 */

import { contencao, ngramas, palavras } from "../ritual-writer/memoria.ts";
import type { PerguntaJev, ResultadoJev } from "./jev.ts";

export type CanalDaCampanha = "organica" | "paga" | "mista" | "indefinida";

export interface CampanhaParaClassificar {
  id: string;
  nome: string;
  objetivo?: string | null;
  pedido?: string | null;
  briefing?: unknown;
}

export interface CanalClassificado {
  id: string;
  canal: CanalDaCampanha;
  motivo: string;
  fonte: "regra" | "jev" | "sem_jev";
  confianca: number | null;
}

export interface PromessaParaConferir {
  id: string;
  texto: string;
  /** Data do ritual em que foi feita. */
  feitaEm: string;
}

export interface Evidencia {
  quando: string;
  texto: string;
}

export interface PromessaConferida {
  id: string;
  texto: string;
  feitaEm: string;
  situacao: "cumprida" | "em_andamento";
  prova: Evidencia | null;
  fonte: "regra" | "jev" | "sem_jev" | "dono";
}

export type PerguntarAoJev = (pedido: { state: unknown; questions: Record<string, PerguntaJev> }, opcoes?: { timeoutMs?: number }) => Promise<ResultadoJev>;

const MARCAS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g");
const simples = (s: unknown) => String(s ?? "").normalize("NFD").replace(MARCAS, "").toLowerCase();

const PALAVRAS_DE_PAGO = /\b(anuncio|anuncios|trafego pago|impulsion\w*|patrocinad\w*|meta ads|google ads|tiktok ads|verba|orcamento diario|campanha paga|midia paga|pago por clique|gerenciador de anuncios)\b/;
const PALAVRAS_DE_ORGANICO = /\b(organic[oa]s?|sem anuncio|sem verba|sem investimento|so no feed|conteudo do perfil|posts do perfil)\b/;

/** A regra, sem IA. null = a regra não sabe. */
export function canalPelaRegra(c: CampanhaParaClassificar, anunciosNoAr: readonly string[]): { canal: CanalDaCampanha; motivo: string } | null {
  const texto = simples([c.nome, c.objetivo, c.pedido, c.briefing ? JSON.stringify(c.briefing) : ""].join(" "));
  // "Sem verba" e "sem anúncio" são sinais de orgânico, não de pago.
  const semNegacao = texto.replace(/\bsem (verba|anuncios?|investimento|impulsionamento)\b/g, " ");
  const nomeTri = ngramas(palavras(c.nome), 2);
  const casou = anunciosNoAr.find((a) => {
    const t = ngramas(palavras(a), 2);
    return nomeTri.size > 0 && t.size > 0 && (contencao(nomeTri, t) >= 0.6 || contencao(t, nomeTri) >= 0.6);
  });
  const pago = PALAVRAS_DE_PAGO.test(semNegacao) || Boolean(casou);
  const organico = PALAVRAS_DE_ORGANICO.test(texto);
  if (pago && organico) return { canal: "mista", motivo: "o pedido fala de conteúdo sem verba e de anúncio" };
  if (casou) return { canal: "paga", motivo: `mesmo nome da campanha de anúncio "${casou}"` };
  if (pago) return { canal: "paga", motivo: "o pedido fala de anúncio ou verba" };
  if (organico) return { canal: "organica", motivo: "o pedido diz que é conteúdo sem verba" };
  return null;
}

/** Evidência que prova a promessa pela regra das palavras (ou null). */
export function provaPelaRegra(promessa: string, evidencias: readonly Evidencia[]): Evidencia | null {
  const p = ngramas(palavras(promessa), 2);
  if (p.size < 2) return null;
  let melhor: { e: Evidencia; c: number } | null = null;
  for (const e of evidencias) {
    const c = contencao(p, ngramas(palavras(e.texto), 2));
    if (c >= 0.5 && (!melhor || c > melhor.c)) melhor = { e, c };
  }
  return melhor?.e ?? null;
}

export interface EntradaDosJulgamentos {
  campanhas: CampanhaParaClassificar[];
  anunciosNoAr: string[];
  promessas: PromessaParaConferir[];
  evidencias: Evidencia[];
  /** Promessas que o dono já confirmou (tarefa de reforço concluída). */
  confirmadasPeloDono?: ReadonlySet<string>;
  cliente: string;
}

export interface SaidaDosJulgamentos {
  campanhas: CanalClassificado[];
  promessas: PromessaConferida[];
  jev: { usado: boolean; erro: string | null };
}

const LIMIAR_CANAL = 0.6;
const LIMIAR_PROVA = 0.6;
const MAX_EVIDENCIAS = 60;

export async function julgarDaCentral(
  e: EntradaDosJulgamentos,
  perguntar: PerguntarAoJev | null,
): Promise<SaidaDosJulgamentos> {
  const campanhas: CanalClassificado[] = [];
  const pendentesCanal: CampanhaParaClassificar[] = [];
  for (const c of e.campanhas.slice(0, 12)) {
    const r = canalPelaRegra(c, e.anunciosNoAr);
    if (r) campanhas.push({ id: c.id, canal: r.canal, motivo: r.motivo, fonte: "regra", confianca: null });
    else pendentesCanal.push(c);
  }

  const evidencias = e.evidencias.slice(0, MAX_EVIDENCIAS);
  const promessas: PromessaConferida[] = [];
  const pendentesProva: PromessaParaConferir[] = [];
  for (const p of e.promessas.slice(0, 8)) {
    if (e.confirmadasPeloDono?.has(p.id)) {
      promessas.push({ ...p, situacao: "cumprida", prova: { quando: "", texto: "confirmado pelo dono (tarefa de reforço concluída)" }, fonte: "dono" });
      continue;
    }
    // Só vale evidência depois da promessa.
    const depois = evidencias.filter((x) => x.quando >= p.feitaEm);
    const prova = provaPelaRegra(p.texto, depois);
    if (prova) promessas.push({ ...p, situacao: "cumprida", prova, fonte: "regra" });
    else pendentesProva.push(p);
  }

  const questions: Record<string, PerguntaJev> = {};
  pendentesCanal.forEach((c, i) => {
    questions[`canal_${i}`] = {
      type: "choice",
      instructions: {
        tarefa: "Uma agência de marketing registra 'campanhas' de comunicação na Mesa (um tema ou oferta trabalhado por um período). Decida, pelo texto da campanha em `campanhas_da_mesa[" + i + "]` e pelos anúncios pagos que o cliente tem no ar em `anuncios_no_ar`, se ESTA campanha é divulgada com anúncio pago ou só com conteúdo orgânico do perfil.",
        cuidado: "Campanha da Mesa não é anúncio por padrão. Só é paga quando o texto fala de verba, anúncio, impulsionamento, ou quando é claramente a mesma ação de um anúncio no ar.",
      },
      criteria: {
        organica: "Conteúdo do perfil (posts, stories, reels) sem verba de anúncio.",
        paga: "Divulgada com anúncio pago (Meta Ads, Google Ads, impulsionamento).",
        mista: "Tem conteúdo orgânico e também anúncio pago.",
        indefinida: "O texto não permite saber.",
      },
    };
  });
  pendentesProva.forEach((p, i) => {
    const depois = evidencias.filter((x) => x.quando >= p.feitaEm);
    if (!depois.length) return;
    const criteria: Record<string, string> = { nenhuma: "Nenhuma evidência mostra que isso aconteceu ou ficou pronto." };
    depois.slice(0, 40).forEach((x, k) => { criteria[`e${k + 1}`] = `${x.quando.slice(0, 10)}: ${x.texto.slice(0, 180)}`; });
    questions[`prova_${i}`] = {
      type: "choice",
      instructions: `Na mensagem de ${p.feitaEm.slice(0, 10)} a agência prometeu ao cliente ${e.cliente}: "${p.texto.slice(0, 300)}". Qual evidência do painel (registrada depois disso) prova que essa promessa foi cumprida, isto é, que aquilo aconteceu ou ficou pronto? Evidência parecida mas de outra peça, outra campanha ou só em preparação não prova.`,
      criteria,
    };
  });

  let usado = false;
  let erro: string | null = null;
  let respostas: ResultadoJev["answers"] = {};
  if (Object.keys(questions).length && perguntar) {
    try {
      const r = await perguntar({
        state: {
          cliente: e.cliente,
          campanhas_da_mesa: pendentesCanal.map((c) => ({ nome: c.nome, objetivo: c.objetivo ?? "", pedido: String(c.pedido ?? "").slice(0, 500) })),
          anuncios_no_ar: e.anunciosNoAr.slice(0, 20),
        },
        questions,
      }, { timeoutMs: 9_000 });
      respostas = r.answers ?? {};
      usado = true;
    } catch (x) {
      erro = x instanceof Error ? x.message : "falha";
    }
  } else if (Object.keys(questions).length) {
    erro = "sem Jev";
  }

  pendentesCanal.forEach((c, i) => {
    const a = respostas[`canal_${i}`];
    const escolha = typeof a?.choice === "string" ? a.choice as CanalDaCampanha : null;
    const prob = escolha && a?.probabilities ? Number(a.probabilities[escolha]) : null;
    if (escolha && prob !== null && prob >= LIMIAR_CANAL && ["organica", "paga", "mista", "indefinida"].includes(escolha)) {
      campanhas.push({ id: c.id, canal: escolha, motivo: `leitura do Jev (${Math.round(prob * 100)}%)`, fonte: "jev", confianca: prob });
    } else {
      campanhas.push({ id: c.id, canal: "indefinida", motivo: usado ? "o Jev não teve firmeza" : "sem registro de verba", fonte: usado ? "jev" : "sem_jev", confianca: prob });
    }
  });

  pendentesProva.forEach((p, i) => {
    const a = respostas[`prova_${i}`];
    const depois = evidencias.filter((x) => x.quando >= p.feitaEm);
    const escolha = typeof a?.choice === "string" ? a.choice : null;
    const prob = escolha && a?.probabilities ? Number(a.probabilities[escolha]) : null;
    if (escolha && escolha !== "nenhuma" && prob !== null && prob >= LIMIAR_PROVA) {
      const k = Number(escolha.slice(1)) - 1;
      const prova = depois[k] ?? null;
      if (prova) {
        promessas.push({ ...p, situacao: "cumprida", prova, fonte: "jev" });
        return;
      }
    }
    promessas.push({ ...p, situacao: "em_andamento", prova: null, fonte: usado ? "jev" : "sem_jev" });
  });

  // Mantém a ordem original das promessas.
  const ordem = new Map(e.promessas.map((p, i) => [p.id, i]));
  promessas.sort((a, b) => (ordem.get(a.id) ?? 0) - (ordem.get(b.id) ?? 0));
  return { campanhas, promessas, jev: { usado, erro } };
}

const ROTULO_CANAL: Record<CanalDaCampanha, string> = {
  organica: "orgânica (conteúdo do perfil, sem verba)",
  paga: "paga (divulgada com anúncio)",
  mista: "orgânica e com anúncio",
  indefinida: "sem registro de verba: trate como campanha de conteúdo, nunca como anúncio",
};

export function rotuloDoCanal(c: CanalDaCampanha): string {
  return ROTULO_CANAL[c];
}

/** O bloco das promessas para o escritor. */
export function promessasComoTexto(lista: readonly PromessaConferida[]): string {
  if (!lista.length) return "";
  const dia = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
  return [
    "O QUE FOI PROMETIDO NA ÚLTIMA MENSAGEM ENVIADA E O ESTADO REAL DE CADA ITEM (conferido agora contra o painel):",
    ...lista.map((p) => p.situacao === "cumprida"
      ? `- CUMPRIDA: "${p.texto.slice(0, 200)}"${p.prova?.texto ? ` (prova: ${p.prova.texto.slice(0, 140)}${p.prova.quando ? ` em ${dia(p.prova.quando)}` : ""})` : ""}. Conte como entregue, com o dia.`
      : `- EM ANDAMENTO: "${p.texto.slice(0, 200)}" (prometido em ${dia(p.feitaEm)}; o painel não mostra que ficou pronto). Para o cliente: diga que está em andamento, sem repetir a promessa como se fosse nova e sem inventar prazo.`),
  ].join("\n");
}
