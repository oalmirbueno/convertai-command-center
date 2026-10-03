/**
 * Fidelidade ao conteúdo de referência (02/10, dono: "ter um ajuste:
 * IDÊNTICO, PRÓXIMO ou CRIATIVO"). Vale para o post do Instagram colado e para
 * a arte em "Fazer igual" da arte rápida, e também como comando na conversa
 * com o diretor ("deixa idêntico ao post", "mais criativo").
 *
 * - Idêntico: mesma estrutura, mesma quantidade de lâminas, mesmo gancho e o
 *   mesmo conteúdo (só a marca do cliente aplicada e correções de português e
 *   clareza), mesma família de layout.
 * - Próximo: mesma estrutura e o mesmo gancho; o texto reescrito na voz do
 *   cliente; layout parecido.
 * - Criativo: o mesmo tema; ângulo, gancho e layout novos.
 *
 * A conferência é em código (quantidade de lâminas e o gancho pelas palavras)
 * e, só na zona cinzenta, a pergunta ao Jev (Noul "a capa mantém o gancho?").
 * No Idêntico o gancho é devolvido em código à capa (sem chamada nova).
 *
 * Puro (sem Deno nem npm): a tela, a função e os testes leem o mesmo arquivo.
 * Sem lookbehind, propriedade Unicode ou grupo nomeado em regex (Safari 11).
 */

import type { LeituraDosCards } from "./leitura-dos-cards.ts";

export const FIDELIDADES = ["identico", "proximo", "criativo"] as const;
export type Fidelidade = (typeof FIDELIDADES)[number];

export const ROTULO_DA_FIDELIDADE: Record<Fidelidade, string> = { identico: "Idêntico", proximo: "Próximo", criativo: "Criativo" };
export const DICA_DA_FIDELIDADE: Record<Fidelidade, string> = {
  identico: "Mesma estrutura, mesmas lâminas, mesmo gancho e o mesmo conteúdo. Só entra a marca do cliente e a correção do português.",
  proximo: "Mesma estrutura e o mesmo gancho, com o texto reescrito na voz do cliente e o layout parecido.",
  criativo: "Mesmo tema, com outro ângulo, outro gancho e outro layout.",
};

export const fidelidadeValida = (v: unknown): Fidelidade | null => ((FIDELIDADES as readonly string[]).indexOf(String(v)) >= 0 ? (v as Fidelidade) : null);

const semAcento = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Sem escolha da equipe: "Fazer igual" ou "faça igual" no pedido = Idêntico; "outra ideia" = Criativo; o resto, Próximo. */
export function fidelidadePadrao(e: { temFazerIgual: boolean; pedido: string }): Fidelidade {
  const p = semAcento(e.pedido);
  if (e.temFazerIgual || /(fa[cz]a|faz|deixa|deixe|quero)\s+(exatamente\s+)?(igual|identic)|do mesmo jeito|exatamente como|copia (o|esse|este) (post|conteudo)/.test(p)) return "identico";
  if (/(outra|nova) (ideia|abordagem|pegada|vibe)|outro angulo|mais criativ|so (a ideia|o tema)|so se inspir/.test(p)) return "criativo";
  return "proximo";
}

/** Comando de fidelidade na conversa com o diretor, ou null. */
export function fidelidadeNaMensagem(mensagem: string): Fidelidade | null {
  const m = semAcento(mensagem);
  if (!m.trim()) return null;
  if (/(identic|igualzinho|fiel ao (post|original|conteudo)|igual ao (post|original|conteudo|que (o cliente )?mandou)|exatamente como (o post|o original|estava))/.test(m)) return "identico";
  if (/(mais criativ|modo criativ|seja criativ|outro angulo|outra (abordagem|pegada|vibe)|novo gancho|gancho novo|ideia nova)/.test(m)) return "criativo";
  if (/(mais proximo|proximo do (post|original|conteudo)|perto do (post|original)|volta (pro|para o) (conteudo|post|original)|mantem o gancho|mesmo gancho)/.test(m)) return "proximo";
  return null;
}

/** Bloco do pedido ao diretor com a regra da fidelidade (com a leitura dos cards, quando houver). */
export function instrucoesDaFidelidade(f: Fidelidade, leitura: LeituraDosCards | null): string {
  const n = leitura ? leitura.cards.length : 0;
  const gancho = leitura && leitura.gancho ? `"${leitura.gancho}"` : "o gancho da capa da referência";
  const cabeca = `FIDELIDADE AO CONTEÚDO DE REFERÊNCIA: ${ROTULO_DA_FIDELIDADE[f].toUpperCase()} (escolhida pela equipe; vale sobre "Referência: inspire, nunca copie" para o TEXTO).`;
  const conteudo = leitura
    ? "O conteúdo escrito em cada lâmina da referência está em `item.pedido_avulso.conteudo_dos_cards` (lido das imagens). Ele é a base do texto, junto da legenda."
    : "Leia o texto escrito nas imagens da referência: ele é a base do conteúdo, junto da legenda.";
  if (f === "identico") {
    return [
      cabeca,
      conteudo,
      `- Mesma estrutura e ${n > 1 ? `exatamente ${n} lâminas, uma para cada lâmina da referência, na mesma ordem` : "a mesma quantidade de lâminas da referência, na mesma ordem"}.`,
      `- Capa com o MESMO gancho: ${gancho}, palavra por palavra (só corrija português e tire nome, @ ou marca do autor original).`,
      "- O texto de cada lâmina é o da lâmina correspondente da referência: mesmas informações, mesma ordem, mesmos itens, números, nomes de menus e botões. Só corrija ortografia e clareza e troque marca, @ ou contato do autor pelos do cliente (ou tire).",
      "- Mesma família de layout (onde fica o texto, hierarquia, tipo de imagem), com as cores, as fontes e a logo do cliente.",
      "- Nada de dica nova, lâmina nova ou outro ângulo.",
    ].join("\n");
  }
  if (f === "proximo") {
    return [
      cabeca,
      conteudo,
      `- Mesma estrutura${n > 1 ? ` e ${n} lâminas (a mesma sequência de ideias)` : ""}; mesmos pontos, na mesma ordem.`,
      `- Capa com o MESMO gancho (${gancho}): a mesma promessa e a mesma tensão, adaptadas só para a voz e o público do cliente.`,
      "- Reescreva o texto de cada lâmina na voz da marca do cliente, com exemplos do negócio dele; mantenha os fatos, passos, nomes de menus e números da referência quando forem do assunto (não do autor).",
      "- Layout parecido com o da referência (mesma hierarquia e distribuição), com a identidade do cliente.",
    ].join("\n");
  }
  return [
    cabeca,
    conteudo,
    "- Mesmo tema e mesma ideia central, com um ângulo NOVO: gancho novo, sequência e layout próprios, pensados para o público do cliente.",
    "- Pode mudar a quantidade de lâminas e a estrutura. Fatos e passos que vierem da referência continuam corretos.",
  ].join("\n");
}

/** A quantidade de lâminas que a fidelidade pede (Idêntico e Próximo: as da referência), ou null. */
export function laminasPelaFidelidade(f: Fidelidade, leitura: LeituraDosCards | null, pedidaPelaEquipe: number | null): number | null {
  if (pedidaPelaEquipe) return pedidaPelaEquipe;
  if (f === "criativo" || !leitura || leitura.cards.length < 2) return null;
  return Math.min(10, leitura.cards.length);
}

// ------------------------------------------------------------------ conferência

const PALAVRAS_VAZIAS = new Set(
  "a o as os um uma uns umas de do da dos das e ou em no na nos nas por para pra pro com sem que se seu sua seus suas voce voces eu me te nao sim mais menos muito ja so ao aos isso esse essa este esta isto aqui la como qual quais quando onde porque por que ser ter tem fazer faz vai vou e é".split(" "),
);

/** Palavras que carregam sentido (sem acento, sem as vazias, raiz de 5 letras para plural e gênero). */
export function palavrasDoSentido(texto: string): string[] {
  return semAcento(texto)
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((p) => p.length >= 3 && !PALAVRAS_VAZIAS.has(p))
    .map((p) => (p.length > 5 ? p.slice(0, 5) : p));
}

/** Quanto do gancho original continua no texto novo (0 a 1): as palavras de sentido do original que voltam. */
export function semelhancaDoGancho(original: string, novo: string): number {
  const a = Array.from(new Set(palavrasDoSentido(original)));
  if (!a.length) return 1;
  const b = new Set(palavrasDoSentido(novo));
  const voltam = a.filter((p) => b.has(p)).length;
  return Math.round((voltam / a.length) * 100) / 100;
}

/** Os limites da conferência do gancho por fidelidade: acima de `ok` passa, abaixo de `ruim` falha, entre os dois pergunta ao Jev. */
export const LIMITES_DO_GANCHO: Record<Fidelidade, { ok: number; ruim: number }> = {
  identico: { ok: 0.75, ruim: 0.4 },
  proximo: { ok: 0.5, ruim: 0.15 },
  criativo: { ok: 0, ruim: 0 },
};

type LaminaConferida = { ordem: number; texto_exato?: string | null; blocos?: Array<{ papel?: string; texto: string }> | null };

/** A headline da capa (bloco headline ou a primeira linha do texto exato). */
export function headlineDaCapa(cards: LaminaConferida[]): string {
  const capa = cards.slice().sort((a, b) => a.ordem - b.ordem)[0];
  if (!capa) return "";
  const h = (capa.blocos || []).filter((b) => b && (b.papel === "headline" || b.papel === "numero")).map((b) => b.texto).filter(Boolean)[0];
  return String(h || String(capa.texto_exato || "").split("\n").map((l) => l.trim()).filter(Boolean)[0] || "").trim();
}

export interface ConferenciaDaFidelidade {
  fidelidade: Fidelidade;
  laminas_esperadas: number | null;
  laminas_feitas: number;
  quantidade_ok: boolean;
  semelhanca_do_gancho: number | null;
  /** true: manteve; false: perdeu; null: zona cinzenta (o Jev decide) ou sem gancho para conferir. */
  gancho_mantido: boolean | null;
  pergunta_ao_jev: boolean;
  avisos: string[];
}

/**
 * A direção contra a referência, em código. Criativo: nada a conferir. A
 * quantidade de lâminas só vale com a referência lida em mais de uma lâmina
 * (e a equipe não ter pedido outra quantidade).
 */
export function conferirFidelidade(cards: LaminaConferida[], leitura: LeituraDosCards | null, f: Fidelidade, laminasDaEquipe: number | null = null): ConferenciaDaFidelidade {
  const feitas = cards.length;
  const saida: ConferenciaDaFidelidade = { fidelidade: f, laminas_esperadas: null, laminas_feitas: feitas, quantidade_ok: true, semelhanca_do_gancho: null, gancho_mantido: null, pergunta_ao_jev: false, avisos: [] };
  if (f === "criativo" || !leitura) return saida;
  const esperadas = laminasDaEquipe || (leitura.cards.length > 1 ? Math.min(10, leitura.cards.length) : null);
  saida.laminas_esperadas = esperadas;
  if (esperadas && feitas !== esperadas && !laminasDaEquipe) {
    saida.quantidade_ok = false;
    saida.avisos.push(`A referência tem ${esperadas} lâminas e a direção saiu com ${feitas}. Em ${ROTULO_DA_FIDELIDADE[f]}, confira antes de gerar.`);
  }
  if (leitura.gancho) {
    const s = semelhancaDoGancho(leitura.gancho, headlineDaCapa(cards));
    saida.semelhanca_do_gancho = s;
    const lim = LIMITES_DO_GANCHO[f];
    if (s >= lim.ok) saida.gancho_mantido = true;
    else if (s < lim.ruim) saida.gancho_mantido = false;
    else saida.pergunta_ao_jev = true;
  }
  return saida;
}

/** A pergunta ao Jev (Noul) na zona cinzenta: a capa nova mantém o gancho e a ideia do original? */
export function perguntaDoGancho(): { type: "noul"; instructions: string; criteria: { true: string; false: string } } {
  return {
    type: "noul",
    instructions: "A capa nova em `capa_nova` mantém o MESMO gancho do post original em `gancho_original`: a mesma promessa, a mesma pergunta ou tensão e o mesmo assunto, ainda que com outras palavras?",
    criteria: {
      true: "Mesma ideia e mesmo gancho, só adaptados (outra palavra, outro tratamento, sem nome do autor).",
      false: "Outro gancho: outra promessa, outro ângulo, outro assunto, ou um título genérico que perdeu a tensão do original.",
    },
  };
}

export function estadoDoGancho(leitura: Pick<LeituraDosCards, "gancho" | "tema">, cards: LaminaConferida[]) {
  return { gancho_original: leitura.gancho, tema_do_post: leitura.tema || null, capa_nova: headlineDaCapa(cards) };
}

/** Probabilidade do Noul para "manteve?" (null sem resposta). Abaixo de 0,5: perdeu. */
export function ganchoPeloJev(prob: number | null | undefined): boolean | null {
  return typeof prob === "number" && isFinite(prob) ? prob >= 0.5 : null;
}

const semTravessaoNemArroba = (s: string) => String(s || "").replace(/(^|\s)@[A-Za-z0-9._]{2,30}/g, "$1").replace(/\s*[\u2014\u2013]\s*/g, ", ").replace(/\s+/g, " ").trim();

/**
 * Idêntico (em código, sem chamada): a headline da capa volta a ser o gancho
 * original; o resto da capa fica. Devolve as lâminas e se mudou.
 */
export function devolverGanchoNaCapa<C extends LaminaConferida & { funcao?: string }>(cards: C[], gancho: string): { cards: C[]; mudou: boolean } {
  const g = semTravessaoNemArroba(gancho).slice(0, 200);
  if (!g || !cards.length) return { cards, mudou: false };
  const ordemDaCapa = cards.slice().sort((a, b) => a.ordem - b.ordem)[0].ordem;
  let mudou = false;
  const saida = cards.map((c) => {
    if (c.ordem !== ordemDaCapa) return c;
    const blocos = (c.blocos || []).slice();
    const i = blocos.findIndex((b) => b && b.papel === "headline");
    const antes = headlineDaCapa([c]);
    if (semAcento(antes) === semAcento(g)) return c;
    let novosBlocos: Array<{ papel?: string; texto: string }>;
    if (i >= 0) novosBlocos = blocos.map((b, k) => (k === i ? { ...b, texto: g } : b));
    else novosBlocos = ([{ papel: "headline", texto: g }] as Array<{ papel?: string; texto: string }>).concat(blocos.filter((b) => b && b.texto && b.texto !== antes));
    const textoExato = novosBlocos.map((b) => b.texto).filter(Boolean).join("\n");
    mudou = true;
    return { ...c, blocos: novosBlocos, texto_exato: textoExato } as C;
  });
  return { cards: saida, mudou };
}
