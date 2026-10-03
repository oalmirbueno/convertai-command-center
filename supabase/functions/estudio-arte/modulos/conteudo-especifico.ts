/**
 * Conteúdo específico no Estúdio (02/10, dono: "o conteúdo do estúdio está
 * muito genérico; as artes ficaram bonitas, mas o CONTEÚDO não").
 *
 * Causa: o motor de copy da casa (_shared/motor-de-copy.ts) só entrava na
 * legenda e no refino; o diretor de arte escrevia o texto das lâminas sem as
 * regras de conteúdo e nada conferia se o texto era genérico (a conferência
 * do pedido olha só fato inventado). Aqui:
 * 1. INSTRUCOES_DO_CONTEUDO: as regras de conteúdo do diretor (específico,
 *    do nicho, responde a pergunta real do cliente, número e exemplo do
 *    contexto, sem clichê), junto do bloco do motor de copy (canal "lamina").
 * 2. laminasGenericas: a conferência em código, sem rede: os clichês do motor
 *    de copy (conferirCopy) mais as frases genéricas de lâmina e a falta de
 *    qualquer detalhe concreto (número, exemplo, nome, passo, situação).
 * 3. revisarConteudo: UMA chamada ao redator para as lâminas genéricas (como o
 *    miolo enxuto); o que volta genérico, sem headline, maior que o limite ou
 *    com número que não estava nas fontes fica como estava. Sem laço.
 *
 * Puro (sem Deno nem npm): a função e os testes leem o mesmo arquivo; quem
 * chama injeta o `escrever`. Sem lookbehind, propriedade Unicode ou grupo
 * nomeado em regex (Safari 11).
 */

import { blocoDoMotor, conferirCopy, type ObjetivoDaCopy } from "../../_shared/motor-de-copy.ts";
import { passaDoLimite } from "./limite-do-miolo.ts";

type Bloco = { papel: string; texto: string };
export type LaminaDoConteudo = { ordem: number; funcao?: string | null; texto_exato?: string | null; blocos?: Bloco[] | null };

const semAcento = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Frases que dizem pouco numa lâmina (além dos clichês de IA do motor de copy). */
export const FRASES_GENERICAS: Array<[RegExp, string]> = [
  [/dicas? (importantes?|valiosas?|essenciais?|incriveis?|imperdiveis?|infaliveis?)/, "dicas importantes"],
  [/(tudo|o) que voce precisa saber/, "tudo o que você precisa saber"],
  [/\bsaiba mais\b|\bconfira\b|\bfique (atento|ligado|por dentro)\b/, "confira / saiba mais"],
  [/\bnao perca\b|\bimperdivel\b/, "não perca"],
  [/(muito|super|extremamente) importante|e fundamental|e essencial/, "é muito importante"],
  [/qualidade de vida|bem[- ]estar (geral|completo)/, "qualidade de vida"],
  [/(o|a) melhor (opcao|escolha|solucao) para voce|feito para voce|pensado para voce/, "o melhor para você"],
  [/(nossa|uma) equipe (qualificada|especializada|de profissionais)|profissionais (qualificados|capacitados)/, "equipe qualificada"],
  [/atendimento (de qualidade|diferenciado|personalizado)|com (muito )?(carinho|dedicacao) e qualidade/, "atendimento de qualidade"],
  [/(cuide|cuidar) (de voce|da sua saude|do seu negocio)( com a gente)?$/, "cuide de você"],
  [/(entenda|descubra|aprenda) (como|por que|o que)\b/, "entenda / descubra como"],
  [/\b(varios|diversos|inumeros) (beneficios|motivos|fatores)\b/, "vários benefícios"],
  [/de forma (simples|pratica|rapida|facil) e (eficiente|eficaz|segura)/, "de forma simples e eficiente"],
  [/(conte|pode contar) com a gente|estamos (aqui|prontos) para (te )?(ajudar|atender)/, "conte com a gente"],
  [/(venha|vem) (nos )?(conhecer|conferir|fazer uma visita)/, "venha nos conhecer"],
  [/(o )?sucesso (do seu negocio|garantido)|resultados? incriveis?/, "resultados incríveis"],
];

/** Sinais de conteúdo concreto: número, valor, unidade, exemplo, passo, nome próprio, menu ou botão citado. */
function temConcreto(texto: string): boolean {
  const t = String(texto || "");
  if (/\d/.test(t)) return true;
  const s = semAcento(t);
  if (/por exemplo|\bex\.:|tipo assim|\bem vez de\b|\bno lugar de\b|\bantes\b[\s\S]*\bdepois\b|\bpasso\b|\betapa\b|toque em|clique em|abra o|va em|\bmenu\b|\bbotao\b|\bconfigurac/.test(s)) return true;
  // Nome próprio no meio da frase (marca, produto, lugar): palavra com maiúscula depois da primeira de cada linha.
  for (const linha of t.split("\n")) {
    const palavras = linha.trim().split(/\s+/).slice(1);
    if (palavras.some((p) => /^[A-ZÀ-Ý][a-zà-ÿ]{2,}/.test(p) && !/^(Você|Voce|Seu|Sua|Para|Com|Que|Não|Nao|Mais|Como)$/.test(p))) return true;
  }
  // Situação reconhecível: frase longa com verbo de ação na primeira pessoa ou cena ("quando você...").
  return /\bquando voce\b|\bse voce\b|\bsabe aquele\b|\bsabe quando\b/.test(s);
}

export interface AnaliseDoConteudo {
  generico: boolean;
  motivos: string[];
  concreto: boolean;
}

/**
 * Uma lâmina genérica: tem clichê de IA (motor de copy) ou frase genérica de
 * lâmina e nenhum detalhe concreto, ou é de conteúdo, tem texto de sobra
 * (8 palavras ou mais) e nada concreto. Capa curta e fechamento curto (CTA)
 * não são cobrados por detalhe: só por clichê.
 */
export function analisarConteudo(texto: string, funcao: string | null | undefined): AnaliseDoConteudo {
  const t = String(texto || "").trim();
  if (!t) return { generico: false, motivos: [], concreto: false };
  const s = semAcento(t);
  const motivos: string[] = [];
  const cliche = conferirCopy(t, "lamina").problemas.filter((p) => p.tipo === "cliche").map((p) => p.texto.replace(/^Clichê de IA:\s*/, "").replace(/\.$/, ""));
  if (cliche.length) motivos.push(`clichê: ${cliche.join(", ")}`);
  const frases = FRASES_GENERICAS.filter(([re]) => re.test(s)).map(([, nome]) => nome);
  if (frases.length) motivos.push(`frase genérica: ${frases.join(", ")}`);
  const concreto = temConcreto(t);
  const palavras = t.split(/\s+/).filter(Boolean).length;
  const curta = funcao === "capa" || funcao === "cta";
  if (!concreto && !curta && palavras >= 8) motivos.push("nenhum detalhe concreto (número, exemplo, passo, nome ou situação real)");
  const generico = cliche.length > 0 || (frases.length > 0 && !concreto) || (!concreto && !curta && palavras >= 8);
  return { generico, motivos, concreto };
}

/** As lâminas genéricas do conjunto, com os motivos (a capa só por clichê). */
export function laminasGenericas(cards: LaminaDoConteudo[]): Array<{ ordem: number; motivos: string[] }> {
  return cards
    .map((c) => ({ c, a: analisarConteudo(String(c.texto_exato || ""), c.funcao) }))
    .filter((x) => x.a.generico)
    .map((x) => ({ ordem: x.c.ordem, motivos: x.a.motivos }));
}

/** As regras de conteúdo do diretor (vão no sistema, depois das regras técnicas) com o motor de copy da casa. */
export function instrucoesDoConteudo(objetivo: ObjetivoDaCopy = "educacao"): string {
  return `CONTEÚDO DAS LÂMINAS (dono, 02/10: "as artes estão bonitas, mas o conteúdo está genérico")
O texto da arte é o que faz a pessoa salvar, mandar e chamar. Escreva como quem atende esse cliente todo dia:
- Específico do nicho e do negócio do cliente: o produto, o serviço, a situação e as palavras do público dele (o contexto da marca, o pedido, a campanha e o conteúdo de referência). Nada que serviria para qualquer empresa do setor.
- Cada lâmina responde uma pergunta real do cliente final (quanto tempo leva, como faço, o que muda, quanto custa quando o contexto diz, qual escolher, o que evitar) com uma resposta concreta: um número do contexto, um exemplo, um passo, uma situação reconhecível, um antes e depois, um erro comum e o que fazer.
- Número, preço, prazo, resultado e nome só quando estão no contexto, no pedido ou na referência. Sem dado: troque por exemplo ou situação concreta, nunca por frase vaga.
- Proibido: "dicas importantes", "tudo o que você precisa saber", "confira", "saiba mais", "é muito importante", "qualidade de vida", "atendimento de qualidade", "equipe qualificada", "venha nos conhecer", "conte com a gente" e os clichês de IA do motor de copy.
- Capa: gancho específico (a situação, o erro, o número ou a pergunta do público), nunca um tema solto ("Dicas de saúde").
${blocoDoMotor({ canal: "lamina", objetivo })}`;
}

// ------------------------------------------------------------------ revisão (uma chamada)

export const ESQUEMA_REVISAO_DO_CONTEUDO = {
  nome: "revisao_do_conteudo",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["laminas"],
    properties: {
      laminas: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["ordem", "blocos"],
          properties: {
            ordem: { type: "integer" },
            blocos: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["papel", "texto"],
                properties: {
                  papel: { type: "string", enum: ["headline", "subtitulo", "apoio", "numero", "cta", "selo"] },
                  texto: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  },
};

export const INSTRUCOES_DA_REVISAO_DO_CONTEUDO = `REVISÃO DO CONTEÚDO DAS LÂMINAS (Estúdio)
Você é o redator sênior da agência. As lâminas listadas em \`revisar\` saíram genéricas (o motivo vem junto). Reescreva SÓ essas, específicas e prontas para a arte.
- Use o contexto: o negócio e o público do cliente, o pedido, a referência e os fatos em \`fatos\`. Cada lâmina responde uma pergunta real do cliente final com um detalhe concreto (exemplo, passo, situação, número que está em \`fatos\`).
- Nunca invente número, preço, prazo, resultado, nome ou promessa: o que não está em \`fatos\` não entra.
- Mesmo papel na sequência (a lâmina continua no mesmo lugar da história) e o mesmo tamanho ou menor: headline curta e, se precisar, um apoio de uma frase. Fechamento mantém o CTA.
- Sem clichê de IA, sem "dicas importantes", "confira", "saiba mais", "é muito importante". Português do Brasil, sem travessão, sem hashtag, @ ou emoji.`;

/** O pedido ao redator: as lâminas genéricas com o motivo, a sequência inteira e os fatos que podem entrar. */
export function pedidoDaRevisao(cards: LaminaDoConteudo[], alvos: Array<{ ordem: number; motivos: string[] }>, e: { conceito?: string | null; fatos: string[]; marca?: string | null }): string {
  return `Revise as lâminas ${alvos.map((a) => a.ordem).join(", ")}. Contexto em JSON:\n${JSON.stringify({
    conceito: e.conceito || null,
    marca: e.marca || null,
    fatos: e.fatos.map((f) => String(f).slice(0, 1500)).slice(0, 8),
    sequencia: cards.map((c) => ({ ordem: c.ordem, funcao: c.funcao || null, texto: c.texto_exato || "" })),
    revisar: alvos.map((a) => {
      const c = cards.filter((x) => x.ordem === a.ordem)[0];
      return { ordem: a.ordem, funcao: c ? c.funcao || null : null, motivo: a.motivos.join("; "), blocos: c && c.blocos && c.blocos.length ? c.blocos : null, texto: c ? c.texto_exato || "" : "" };
    }),
  })}`;
}

const PAPEIS = ["headline", "subtitulo", "apoio", "numero", "cta", "selo"];
const limparBloco = (s: unknown) =>
  String(s == null ? "" : s).replace(/\s*[\u2014\u2013]\s*/g, ", ").replace(/(^|\s)[#@][A-Za-z0-9_À-ÿ.]+/g, "$1").replace(/\s+/g, " ").trim().slice(0, 300);

/** Números do texto (preço, percentual, prazo, quantidade), sem pontuação. */
function numerosDe(t: string): string[] {
  return (String(t || "").match(/\d+(?:[.,]\d+)*/g) || []).map((n) => n.replace(/[.,]/g, ""));
}

/** O texto novo traz número que não está nas fontes (texto atual, pedido, referência, campanha)? */
export function numeroNovo(novo: string, fontes: string[]): string | null {
  const conhecidos = new Set(fontes.flatMap(numerosDe));
  return numerosDe(novo).filter((n) => !conhecidos.has(n))[0] || null;
}

/**
 * Aplica a revisão em código (sem nova chamada): só as lâminas pedidas; precisa
 * de headline (ou número), manter o CTA que existia, caber no limite do miolo,
 * deixar de ser genérica e não trazer número novo. O que não passa fica.
 */
export function aplicarRevisao<C extends LaminaDoConteudo>(cards: C[], bruto: unknown, alvos: number[], fontes: string[]): { cards: C[]; mudou: number[] } {
  const lista = bruto && typeof bruto === "object" && Array.isArray((bruto as { laminas?: unknown }).laminas) ? (bruto as { laminas: unknown[] }).laminas : [];
  const total = cards.length;
  const mudou: number[] = [];
  const saida = cards.map((c) => {
    if (alvos.indexOf(c.ordem) < 0) return c;
    const achada = lista.filter((l) => l && typeof l === "object" && Number((l as { ordem?: unknown }).ordem) === c.ordem)[0] as { blocos?: unknown } | undefined;
    if (!achada || !Array.isArray(achada.blocos)) return c;
    const blocos: Bloco[] = (achada.blocos as unknown[])
      .map((b) => (b && typeof b === "object" ? b as Record<string, unknown> : {}))
      .map((b) => ({ papel: PAPEIS.indexOf(String(b.papel)) >= 0 ? String(b.papel) : "apoio", texto: limparBloco(b.texto) }))
      .filter((b) => b.texto);
    if (!blocos.some((b) => b.papel === "headline" || b.papel === "numero")) return c;
    const tinhaCta = (c.blocos || []).some((b) => b.papel === "cta");
    if (tinhaCta && !blocos.some((b) => b.papel === "cta")) return c;
    const texto = blocos.map((b) => b.texto).join("\n");
    const nova = { ...c, blocos, texto_exato: texto } as C;
    if (c.ordem > 1 && passaDoLimite(nova as never, total)) return c;
    if (analisarConteudo(texto, c.funcao).generico) return c;
    if (numeroNovo(texto, fontes.concat([String(c.texto_exato || "")]))) return c;
    mudou.push(c.ordem);
    return nova;
  });
  return { cards: saida, mudou };
}

/**
 * Uma chamada ao redator para as lâminas genéricas. Nenhuma genérica: nada é
 * chamado. Falha: tudo como estava, com o motivo em `erro`. `pular` tira
 * lâminas da revisão (a capa no Próximo e no Idêntico: o gancho fica).
 */
export async function revisarConteudo<C extends LaminaDoConteudo>(
  cards: C[],
  e: { conceito?: string | null; fatos: string[]; marca?: string | null; pular?: number[]; forcar?: Array<{ ordem: number; motivos: string[] }> },
  escrever: (sistema: string, pedido: string) => Promise<{ json: unknown; custoUsd: number }>,
  sobe: (e: unknown) => boolean = () => false,
): Promise<{ cards: C[]; genericas: Array<{ ordem: number; motivos: string[] }>; mudou: number[]; custoUsd: number; erro?: string }> {
  const pular = e.pular || [];
  // `forcar`: lâminas que entram mesmo sem ser genéricas (a capa que perdeu o gancho no Próximo), com o motivo.
  const forcadas = (e.forcar || []).filter((f) => cards.some((c) => c.ordem === f.ordem));
  const genericas = laminasGenericas(cards)
    .filter((g) => pular.indexOf(g.ordem) < 0 && !forcadas.some((f) => f.ordem === g.ordem))
    .concat(forcadas)
    .sort((a, b) => a.ordem - b.ordem);
  if (!genericas.length) return { cards, genericas, mudou: [], custoUsd: 0 };
  try {
    const r = await escrever(INSTRUCOES_DA_REVISAO_DO_CONTEUDO, pedidoDaRevisao(cards, genericas, e));
    const aplicado = aplicarRevisao(cards, r.json, genericas.map((g) => g.ordem), e.fatos);
    return { cards: aplicado.cards, genericas, mudou: aplicado.mudou, custoUsd: Number(r.custoUsd) || 0 };
  } catch (err) {
    if (sobe(err)) throw err;
    return { cards, genericas, mudou: [], custoUsd: 0, erro: err instanceof Error ? err.message.slice(0, 200) : "falha na revisão" };
  }
}
