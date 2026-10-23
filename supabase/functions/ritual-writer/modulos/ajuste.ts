/**
 * Ajuste da mensagem do ritual pela conversa (23/10/2026).
 *
 * O dono: "eu peço conversa com ele, eu mando ali e, em vez dele complementar, ele refaz toda a mensagem.
 * O que eu ajustar, o que eu mudar, ele já tem que entender e complementar, e não refazer tudo; só se eu
 * pedir para tirar alguma coisa." Em 23/10 a Acerbi teve 4 versões em 15 minutos: o pedido era tirar a
 * palestra de adesivo e a versão nova perdeu o vídeo de 22/10, os números e o porquê; a Terra Flor perdeu
 * os 7 contatos da semana quando o pedido era falar da gravação. Causa: o "Reescrever" com instrução
 * mandava ao escritor a versão anterior com "não repetir a estrutura nem as frases".
 *
 * Agora, com instrução e mensagem atual, é EDIÇÃO sobre o texto atual:
 * - o modelo recebe a mensagem atual como base e devolve a mensagem inteira com só o pedido aplicado;
 * - o código confere, frase a frase, o que sumiu (diff por palavras de conteúdo); o que sumiu sem o pedido
 *   pedir vira aviso (o Jev lê se o pedido pedia tirar ou trocar aquele trecho; sem Jev, vale a regra das
 *   palavras de remoção). A versão anterior volta inteira no "Desfazer" da tela;
 * - sem laço de correção: uma escrita só, a conferência é aviso.
 *
 * Puro nas regras (o modelo e o Jev entram por parâmetro): os testes leem o mesmo arquivo.
 */

import { type ResultadoJev, type PerguntaJev, probabilidadeNoul } from "../../_shared/jev.ts";
import type { EscolhaDoModelo, TextoEscrito } from "../../_shared/modelo-da-central.ts";
import type { MetodoInjetado } from "../../_shared/superpoderes-catalogo.ts";
import { acabamentoDoRitual, LINHA_DO_PAINEL } from "./acabamento.ts";

export const SISTEMA_DO_AJUSTE = `Você edita uma mensagem que uma agência de marketing (Aceleriq) vai mandar no grupo de WhatsApp de um cliente. A MENSAGEM ATUAL já foi revisada pelo dono da agência: ela é a base e está certa, a não ser no que o PEDIDO DO DONO mudar.

COMO EDITAR:
1. Aplique SÓ o pedido. Toda frase que o pedido não toca volta IGUAL, palavra por palavra, na mesma ordem.
2. "Acrescenta", "fala também", "inclui", "coloca": insira o que foi pedido no ponto natural do texto (uma frase ou um trecho de frase), sem apagar nada. A informação vem do próprio pedido (o dono é a fonte) ou dos FATOS; nunca invente número, data ou entrega.
3. "Troca", "muda", "corrige", "em vez de": mude só o trecho citado.
4. Tom ("mais animado", "mais curto", "mais direto"): reescreva o mínimo necessário, mantendo todos os fatos.
5. "Tira", "remove", "não fala de", "sem": remova só o que foi pedido e ajuste a frase vizinha para continuar natural.
6. Não mexa na saudação nem na linha do painel: o sistema cuida das duas.
7. Português do Brasil, tom positivo, "a gente" e "você", sem travessão, sem emoji, sem jargão.

Responda SOMENTE com JSON válido: {"body":"a mensagem inteira já ajustada","title":"título curto (até 60 caracteres)","next_steps":"uma frase com o próximo passo","mudancas":["o que você mudou, em poucas palavras"]}`;

const normal = (s: string) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const PALAVRAS_VAZIAS = new Set(["para", "com", "que", "uma", "dos", "das", "nos", "nas", "pela", "pelo", "mais", "como", "isso", "esse", "essa", "este", "esta", "voce", "gente", "sobre", "entre", "ainda", "quando", "onde", "seus", "suas", "seu", "sua", "tambem", "ja", "foi", "sao", "esta", "estao", "vai", "vamos"]);

/** Palavras que carregam o conteúdo de uma frase (sem acento, 4+ letras ou números). */
export function palavrasDeConteudo(texto: string): string[] {
  return (normal(texto).match(/[a-z0-9$]+/g) ?? []).filter((w) => (w.length >= 4 || /\d/.test(w)) && !PALAVRAS_VAZIAS.has(w));
}

/** As frases do corpo, sem a saudação e sem a linha do painel (essas o sistema refaz). */
export function frasesDoCorpo(texto: string): string[] {
  const linhas = String(texto ?? "").replace(/\r\n?/g, "\n").split("\n")
    .map((l) => l.trim())
    .filter((l) => l && l !== LINHA_DO_PAINEL && !(/painel/i.test(l) && /aceleriq\.online/i.test(l)));
  const frases: string[] = [];
  for (const linha of linhas) {
    // Quebra depois de . ! ? seguido de espaço e maiúscula (não quebra "R$ 2.500", "aceleriq.online" nem "23/10").
    const partes = linha.replace(/([.!?])\s+(?=["“A-ZÁÉÍÓÚÂÊÔÃÕÇ])/g, "$1\n").split("\n");
    for (const p of partes) {
      const f = p.trim();
      if (!f) continue;
      // Só a saudação ("Boa tarde, Nelly.") e frases do momento não contam como conteúdo.
      if (/^(bom dia|boa tarde|boa noite|boa semana|ol[áa]|oi)\b[^.!?]{0,40}[.!?]$/i.test(f)) continue;
      if (palavrasDeConteudo(f).length < 3) continue;
      frases.push(f);
    }
  }
  return frases;
}

/** A frase continua no texto novo quando a maior parte das palavras de conteúdo dela está lá. */
export function fraseSobrevive(frase: string, novo: string, minimo = 0.6): boolean {
  const palavras = palavrasDeConteudo(frase);
  if (!palavras.length) return true;
  const no = new Set(palavrasDeConteudo(novo));
  const ficaram = palavras.filter((w) => no.has(w)).length;
  return ficaram / palavras.length >= minimo;
}

/** Frases da mensagem anterior que não estão mais na nova. */
export function frasesQueSumiram(anterior: string, novo: string): string[] {
  return frasesDoCorpo(anterior).filter((f) => !fraseSobrevive(f, novo));
}

/** O pedido fala em tirar, trocar ou reescrever algo (sem Jev, é o que decide se a frase sumida foi pedida). */
export function pedidoMexeNoTexto(instrucao: string): { tirar: boolean; trocar: boolean } {
  const t = normal(instrucao);
  return {
    tirar: /\b(tir[ae]|tirar|remov|retir|apag|cort[ae]|cortar|exclu|deixa de fora|sem falar|nao (fal|cit|menc|coloc|pon)|nao precisa)/.test(t),
    trocar: /\b(troc|mud[ae]|mudar|corrig|substitu|em vez|ao inves|reescrev|refaz|resum|encurt|mais curt|menor|enxug|tom)/.test(t),
  };
}

export interface PedidoDeAjuste {
  ritual: string;
  anterior: string;
  instrucao: string;
  /** Fatos para o "acrescenta" (estado real, dossiê); o pedido também é fonte. */
  fatos: string;
  clientName: string;
  contactName: string;
  clientId: string;
  criadoPor?: string | null;
  escolha?: EscolhaDoModelo;
  metodo?: MetodoInjetado | null;
  agora?: Date;
}

export interface Ajustado {
  title: string | null;
  body: string;
  next_steps: string;
  mudancas: string[];
  /** Frases da versão anterior que sumiram sem o pedido pedir (aviso; a anterior fica no Desfazer). */
  perdidas: string[];
  /** Frases que sumiram e o pedido pedia (tirar ou trocar). */
  tiradas: string[];
  alertas: string[];
  model: string;
  modelo_rotulo: string;
  custo_usd: number | null;
  uso_id: string | null;
  reserva: string | null;
}

type Escrever = (e: {
  clientId: string; sistema: string; usuario: string; escolha?: EscolhaDoModelo; temperatura?: number;
  criadoPor?: string | null; metodo?: MetodoInjetado | null;
}) => Promise<TextoEscrito | null>;

type PerguntarAoJev = (q: { state: unknown; questions: Record<string, PerguntaJev> }, o?: { timeoutMs?: number }) => Promise<ResultadoJev>;

export function montarPedidoDoAjuste(p: PedidoDeAjuste): string {
  return [
    `NEGÓCIO: ${p.clientName}${p.contactName ? ` (quem recebe: ${p.contactName})` : ""}`,
    `MENSAGEM ATUAL (a base; volta igual no que o pedido não toca):\n${p.anterior}`,
    `PEDIDO DO DONO (aplique só isto):\n${p.instrucao}`,
    p.fatos ? `FATOS (só para o que o pedido mandar acrescentar; nada além disso entra):\n${p.fatos.slice(0, 6000)}` : "",
  ].filter(Boolean).join("\n\n");
}

function lerJson(bruto: string): Record<string, unknown> | null {
  const t = String(bruto ?? "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const i = t.indexOf("{");
  const f = t.lastIndexOf("}");
  if (i < 0 || f <= i) return null;
  try {
    return JSON.parse(t.slice(i, f + 1));
  } catch {
    return null;
  }
}

const semTravessao = (s: string) => String(s ?? "").replace(/\s*[—–]\s*/g, ", ");

/**
 * Pergunta ao Jev, numa chamada só, se o pedido pedia tirar ou trocar cada frase que sumiu.
 * Devolve a probabilidade por frase, ou null sem Jev (vale a regra das palavras).
 */
export async function pedidoPediaTirar(
  instrucao: string,
  sumidas: string[],
  perguntar: PerguntarAoJev,
  cobrar: ((r: ResultadoJev) => Promise<unknown>) | null,
): Promise<Array<number | null> | null> {
  if (!sumidas.length) return [];
  const questions: Record<string, PerguntaJev> = {};
  sumidas.forEach((_, i) => {
    questions[`pedia_${i}`] = {
      type: "noul",
      instructions: `O dono de uma agência pediu um ajuste numa mensagem para o cliente (\`pedido\`). O trecho \`trechos[${i}]\` saiu da mensagem depois do ajuste. O pedido pedia para tirar, trocar, encurtar ou reescrever esse trecho?`,
      criteria: {
        true: "Sim: tirar, trocar, encurtar ou mudar o tom desse trecho faz parte do que o dono pediu.",
        false: "Não: o pedido era sobre outra coisa (acrescentar algo, mudar outro trecho), e esse trecho deveria ter ficado.",
      },
    };
  });
  try {
    const r = await perguntar({ state: { pedido: instrucao.slice(0, 1500), trechos: sumidas.map((s) => s.slice(0, 400)) }, questions }, { timeoutMs: 8_000 });
    if (cobrar) await cobrar(r).catch(() => null);
    return sumidas.map((_, i) => probabilidadeNoul(r.answers[`pedia_${i}`]));
  } catch {
    return null;
  }
}

/**
 * Ajusta a mensagem atual com o pedido do dono. null quando o modelo não respondeu (a tela mantém a
 * versão atual e diz o motivo).
 */
export async function ajustarRitual(
  p: PedidoDeAjuste,
  escrever: Escrever,
  perguntar: PerguntarAoJev,
  cobrar: ((r: ResultadoJev) => Promise<unknown>) | null = null,
): Promise<Ajustado | null> {
  const saida = await escrever({
    clientId: p.clientId,
    sistema: SISTEMA_DO_AJUSTE,
    usuario: montarPedidoDoAjuste(p),
    escolha: p.escolha,
    temperatura: 0.2,
    criadoPor: p.criadoPor ?? null,
    metodo: p.metodo ?? null,
  });
  if (!saida) return null;
  const j = lerJson(saida.texto);
  const corpo = semTravessao(String(j?.body ?? "").trim());
  if (!corpo) return null;
  const { texto } = acabamentoDoRitual(corpo, { ritual: p.ritual, agora: p.agora, contato: p.contactName, negocio: p.clientName });

  const sumidas = frasesQueSumiram(p.anterior, texto);
  const regra = pedidoMexeNoTexto(p.instrucao);
  const pedia = sumidas.length ? await pedidoPediaTirar(p.instrucao, sumidas, perguntar, cobrar) : [];
  const perdidas: string[] = [];
  const tiradas: string[] = [];
  sumidas.forEach((f, i) => {
    const prob = pedia ? pedia[i] : null;
    const pedida = prob !== null && prob !== undefined ? prob >= 0.5 : regra.tirar || regra.trocar;
    (pedida ? tiradas : perdidas).push(f);
  });
  const alertas = perdidas.length
    ? [`Sumiu sem você pedir: ${perdidas.map((f) => `"${f.slice(0, 90)}${f.length > 90 ? "…" : ""}"`).join("; ")}. A versão anterior está no Desfazer.`]
    : [];
  return {
    title: semTravessao(String(j?.title ?? "").trim()).slice(0, 80) || null,
    body: texto,
    next_steps: semTravessao(String(j?.next_steps ?? "").trim()).slice(0, 600),
    mudancas: Array.isArray(j?.mudancas) ? (j!.mudancas as unknown[]).map((m) => String(m).slice(0, 160)).filter(Boolean).slice(0, 5) : [],
    perdidas,
    tiradas,
    alertas,
    model: saida.modelo,
    modelo_rotulo: saida.rotulo,
    custo_usd: saida.custoUsd,
    uso_id: saida.usoId ?? null,
    reserva: saida.reserva,
  };
}
