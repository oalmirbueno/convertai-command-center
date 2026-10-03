/**
 * Operações de conteúdo na conversa com o diretor (02/10, dono: "o diretor
 * não é inteligente: pedi para mudar TODO o conteúdo e ele só acrescentou um
 * card com o mesmo conteúdo").
 *
 * Causa (duas, em código):
 * 1. "muda todo o conteúdo" não liberava a troca de texto: pedidoMexeNoTexto
 *    conhecia "texto", "título", "frase", mas não "conteúdo", "tema" nem
 *    "assunto". Com o texto travado, o diretor só tinha as ações de lâmina, e
 *    a mais próxima era duplicar_lamina (a cópia com o mesmo texto).
 * 2. Nada conferia que o pedido amplo cobriu todas as lâminas.
 *
 * Agora a intenção é lida em código antes do diretor (reescrever_tudo,
 * reescrever_lamina, adicionar_lamina, tirar_lamina, reordenar) e:
 * - reescrever_tudo: o diretor recebe a ordem de reescrever o texto_exato de
 *   CADA lâmina (uma mudança por lâmina, a mesma quantidade de lâminas, o
 *   layout fica ou é ajustado); duplicar, adicionar e tirar lâmina saem da
 *   proposta; a lâmina que ele esqueceu é reescrita numa chamada só ao
 *   redator (sem laço). As mudanças seguem o contrato de sempre: ordem clara
 *   vai direto com Desfazer; senão, Confirmar.
 * - adicionar_lamina: lâmina NOVA com outro texto (não a cópia).
 *
 * Puro (sem Deno): a função e os testes leem o mesmo arquivo.
 * Sem lookbehind, propriedade Unicode ou grupo nomeado em regex (Safari 11).
 */

export type IntencaoDeConteudo = "reescrever_tudo" | "reescrever_lamina" | "adicionar_lamina" | "tirar_lamina" | "reordenar";

export const ROTULO_DA_INTENCAO: Record<IntencaoDeConteudo, string> = {
  reescrever_tudo: "Reescrever todo o conteúdo",
  reescrever_lamina: "Reescrever a lâmina",
  adicionar_lamina: "Lâmina nova",
  tirar_lamina: "Tirar lâmina",
  reordenar: "Mudar a ordem",
};

const semAcento = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const VERBO_DE_REESCRITA = "(mud|troc|troq|refa|refaz|reescrev|escrev|alter|substitu|renov|recri|cri)[a-z]*";
const ALVO_DO_CONTEUDO = "(conteudo|conteudos|texto|textos|copy|copys|mensagem|tema|assunto|roteiro)";

/**
 * A intenção de conteúdo da mensagem, pelas palavras (sem rede). Null quando
 * não é pedido de conteúdo (cor, cena, foto, opinião): segue o fluxo de sempre.
 */
export function intencaoDeConteudo(mensagem: string): IntencaoDeConteudo | null {
  const m = semAcento(mensagem).replace(/\s+/g, " ").trim();
  if (!m) return null;
  if (/(^|[^a-z])(adicion|acrescent|inclu|cri|faz|faca|coloc|p[oõ]e|ponh)[a-z]* (mais )?(uma |1 |outra |nova )+(lamina|card|slide)/.test(m) || /(lamina|card|slide) (nova|a mais|extra)\b/.test(m)) return "adicionar_lamina";
  const tudo = "(todo|toda|todos|todas|tudo|inteiro|inteira|geral)";
  if (
    new RegExp(`${VERBO_DE_REESCRITA} ${tudo} (o |a |os |as )?${ALVO_DO_CONTEUDO}`).test(m) ||
    new RegExp(`${VERBO_DE_REESCRITA} (o |a |os |as )?${ALVO_DO_CONTEUDO} (de |d[ae]s? )?${tudo}`).test(m) ||
    new RegExp(`${ALVO_DO_CONTEUDO} (de |d[ae]s? )?(tudo|todas as laminas|todos os cards|todos os slides|todo o carrossel|o carrossel inteiro)`).test(m) && new RegExp(VERBO_DE_REESCRITA).test(m) ||
    new RegExp(`(mud|troc|troq|alter)[a-z]* (o |de )?(tema|assunto)\\b`).test(m) ||
    /(outro|novo) (tema|assunto|conteudo)\b/.test(m) ||
    /(refaz|refaca|reescrev)[a-z]* tudo\b/.test(m)
  ) return "reescrever_tudo";
  if (/(tir|remov|apag|exclu|delet)[a-z]* (a |o |essa |esse |esta |este )?(\d+[a-z]* )?(lamina|card|slide)/.test(m)) return "tirar_lamina";
  if (/(reorden|invert)[a-z]*|(muda|troca|mude|troque) a ordem|(move|mova|passa|passe) a (lamina|card|slide)/.test(m)) return "reordenar";
  if (new RegExp(`${VERBO_DE_REESCRITA} (o |a )?${ALVO_DO_CONTEUDO}`).test(m)) return "reescrever_lamina";
  return null;
}

/** As operações que um pedido de reescrita total nunca usa (mudam a quantidade de lâminas). */
export const FORA_DA_REESCRITA_TOTAL = ["duplicar_lamina", "adicionar_lamina", "tirar_lamina"];

/** O bloco do pedido ao diretor quando a equipe quer reescrever tudo. */
export function blocoDaReescritaTotal(total: number, ordens: number[]): string {
  return `PEDIDO DE REESCREVER TODO O CONTEÚDO (código leu: reescrever_tudo)
- Reescreva o texto_exato de TODAS as ${total} lâminas (${ordens.map((o) => `lâmina ${o}`).join(", ")}): UMA mudança por lâmina, alvo "lamina", com o texto completo novo em texto_exato. Nenhuma lâmina fica com o texto de antes.
- A mesma quantidade de lâminas: nunca use duplicar_lamina, adicionar_lamina nem tirar_lamina neste pedido. Mantenha o layout de cada lâmina; mude zona_texto, imagem ou tratamento só quando o texto novo pedir.
- Conteúdo novo de verdade: se a equipe disse o tema novo, siga; senão, um ângulo novo do mesmo assunto da marca, específico do nicho, com exemplo, passo ou situação real (sem fato inventado). A capa ganha um gancho novo; o fechamento, um CTA.`;
}

type MudancaBruta = { alvo?: unknown; ordem?: unknown; campos?: unknown; [k: string]: unknown };

/**
 * As lâminas cuja reescrita veio na resposta (mudança de lâmina com
 * texto_exato diferente do atual) e as que faltam.
 */
export function coberturaDaReescrita(mudancas: unknown, atual: Record<number, string>): { cobertas: number[]; faltam: number[] } {
  const lista = (Array.isArray(mudancas) ? mudancas : []) as MudancaBruta[];
  const ordens = Object.keys(atual).map(Number).sort((a, b) => a - b);
  const cobertas: number[] = [];
  for (const m of lista) {
    if (!m || m.alvo !== "lamina") continue;
    const o = Number(m.ordem);
    const campos = (m.campos && typeof m.campos === "object" ? m.campos : {}) as Record<string, unknown>;
    const novo = String(campos.texto_exato == null ? "" : campos.texto_exato).trim();
    if (ordens.indexOf(o) >= 0 && novo && novo !== String(atual[o] || "").trim() && cobertas.indexOf(o) < 0) cobertas.push(o);
  }
  return { cobertas: cobertas.sort((a, b) => a - b), faltam: ordens.filter((o) => cobertas.indexOf(o) < 0) };
}

/** As ações do modelo sem as que mudam a quantidade de lâminas (reescrita total). Devolve também o que saiu. */
export function acoesSemMudarQuantidade(acoes: unknown): { acoes: unknown; tiradas: string[] } {
  if (!acoes || typeof acoes !== "object") return { acoes, tiradas: [] };
  const o = acoes as { itens?: unknown };
  const itens = Array.isArray(o.itens) ? (o.itens as Array<{ operacao?: string }>) : [];
  const tiradas = itens.filter((i) => i && FORA_DA_REESCRITA_TOTAL.indexOf(String(i.operacao)) >= 0).map((i) => String(i.operacao));
  if (!tiradas.length) return { acoes, tiradas };
  return { acoes: { ...o, itens: itens.filter((i) => !(i && FORA_DA_REESCRITA_TOTAL.indexOf(String(i.operacao)) >= 0)) }, tiradas };
}

// ------------------------------------------------------------------ as que faltaram (uma chamada)

export const ESQUEMA_DA_REESCRITA = {
  nome: "reescrita_das_laminas",
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
          required: ["ordem", "texto"],
          properties: { ordem: { type: "integer" }, texto: { type: "string" } },
        },
      },
    },
  },
};

export const INSTRUCOES_DA_REESCRITA = `REESCRITA DAS LÂMINAS (Estúdio)
Você é o redator sênior da agência. A equipe pediu para mudar todo o conteúdo do carrossel. Algumas lâminas já têm o texto novo (em \`ja_reescritas\`); escreva o texto novo SÓ das lâminas em \`reescrever\`, continuando a mesma história das já reescritas.
- Texto completo da lâmina, pronto para a arte, com quebra de linha entre título e apoio. Capa: gancho curto. Fechamento: CTA.
- Específico do nicho da marca, com exemplo, passo ou situação real. Nunca invente preço, número, prazo, nome ou promessa.
- Nada repetido do texto antigo nem de outra lâmina. Português do Brasil, sem travessão, sem hashtag, @ ou emoji.`;

export function pedidoDaReescrita(e: { mensagem: string; cards: Array<{ ordem: number; funcao?: string | null; texto_exato?: string | null }>; novos: Record<number, string>; faltam: number[]; marca?: string | null; conceito?: string | null }): string {
  return `Escreva o texto novo das lâminas ${e.faltam.join(", ")}. Contexto em JSON:\n${JSON.stringify({
    pedido_da_equipe: e.mensagem,
    marca: e.marca || null,
    conceito: e.conceito || null,
    ja_reescritas: Object.keys(e.novos).map(Number).sort((a, b) => a - b).map((o) => ({ ordem: o, texto: e.novos[o] })),
    reescrever: e.cards.filter((c) => e.faltam.indexOf(c.ordem) >= 0).map((c) => ({ ordem: c.ordem, funcao: c.funcao || null, texto_antigo: c.texto_exato || "" })),
  })}`;
}

/** As mudanças brutas (mesma forma do diretor) para as lâminas que faltaram, a partir do que o redator devolveu. */
export function mudancasDaReescrita(bruto: unknown, faltam: number[], atual: Record<number, string>): MudancaBruta[] {
  const lista = bruto && typeof bruto === "object" && Array.isArray((bruto as { laminas?: unknown }).laminas) ? ((bruto as { laminas: unknown[] }).laminas as Array<Record<string, unknown>>) : [];
  const saida: MudancaBruta[] = [];
  for (const o of faltam) {
    const l = lista.filter((x) => x && Number(x.ordem) === o)[0];
    const texto = l ? String(l.texto == null ? "" : l.texto).replace(/\s*[\u2014\u2013]\s*/g, ", ").replace(/[ \t]+/g, " ").trim().slice(0, 1200) : "";
    if (!texto || texto === String(atual[o] || "").trim()) continue;
    saida.push({ alvo: "lamina", ordem: o, titulo: `Texto novo da lâmina ${o}`, motivo: "Reescrita pedida para todo o conteúdo.", campos: { texto_exato: texto } });
  }
  return saida;
}
