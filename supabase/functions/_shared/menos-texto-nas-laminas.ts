/**
 * Menos texto nas lâminas (dono, 26/09): "sempre MENOS TEXTO nas lâminas,
 * nunca textão; a copy já sai otimizada para o Estúdio". Vale para tudo o que
 * o agente do Mês gera (planejar, pedido livre, refazer, conteúdo rápido,
 * campanhas): todos passam por normalizarItem, que chama conferirLaminas.
 *
 * - Capa: gancho curto.
 * - Cada lâmina seguinte: UMA ideia, título curto (até ~8 palavras) na 1ª linha
 *   e apoio curto (até ~20 a 25 palavras) na 2ª, em sequência que explica o
 *   assunto passo a passo até o fechamento (CTA).
 * - Comunicação clara para o cliente final, sem jargão. Texto longo vai para a
 *   legenda (copy), nunca para a arte.
 *
 * Sem laço de correção (regra do dono): o modelo recebe a regra e confere cada
 * lâmina NA MESMA chamada, antes de responder. O código só confere depois: a
 * lâmina que ainda passa do limite é cortada no limite de frase e volta com um
 * aviso. Nada chama o modelo de novo.
 *
 * Sem import de Deno nem de npm: a tela e os testes (vitest) leem o mesmo arquivo.
 */

/** Limites que o prompt pede (o que o modelo deve cumprir). */
export const PALAVRAS_DA_CAPA = 10;
export const PALAVRAS_DO_TITULO = 8;
export const PALAVRAS_DO_APOIO = 25;
export const PALAVRAS_DO_CTA = 20;

/**
 * Limites da conferência em código: o pedido com uma folga pequena (o modelo
 * conta palavra de um jeito, o código de outro). Passou disso, corta.
 */
export const LIMITE_DA_CAPA = 14;
export const LIMITE_DA_LAMINA = PALAVRAS_DO_TITULO + PALAVRAS_DO_APOIO + 4; // 37
export const LIMITE_DO_CTA = 28;
/** Estático: título + uma linha de apoio + CTA, tudo numa lâmina só. */
export const LIMITE_DO_ESTATICO = 40;

/** Regra que vai no prompt de todos os geradores do agente do Mês. */
export const REGRA_DE_MENOS_TEXTO = `MENOS TEXTO NAS LÂMINAS (regra do dono, vale para todo conteúdo): nunca "textão" na arte; a copy já sai pronta para o Estúdio.
- Capa: só o gancho, curto (até ${PALAVRAS_DA_CAPA} palavras).
- Cada lâmina seguinte: UMA ideia. Título curto (até ${PALAVRAS_DO_TITULO} palavras) na 1ª linha e apoio curto (até ${PALAVRAS_DO_APOIO} palavras) na 2ª linha. As lâminas seguem em SEQUÊNCIA, explicando o assunto passo a passo até o fechamento.
- Última lâmina: o fechamento com UM CTA curto (até ${PALAVRAS_DO_CTA} palavras).
- Estático: título de até ${PALAVRAS_DO_TITULO} palavras, no máximo uma linha de apoio e o CTA.
- Linguagem clara para o cliente final, qualquer que seja o nicho: sem jargão, sem sigla sem explicar, frases diretas.
- O texto longo (explicação, detalhes, lista) vai na legenda (copy), nunca na arte.
- Antes de responder, confira cada lâmina contando as palavras; a que passar do limite, reescreva mais curta agora, na mesma resposta.`;

/** Descrição do campo texto do card no esquema JSON (o modelo lê junto com o campo). */
export const DESCRICAO_DO_TEXTO_DA_LAMINA =
  `Texto exato da lâmina. Capa: só o gancho (até ${PALAVRAS_DA_CAPA} palavras). Lâmina interna: título curto (até ${PALAVRAS_DO_TITULO} palavras) na 1ª linha e apoio curto (até ${PALAVRAS_DO_APOIO} palavras) na 2ª. CTA curto. Texto longo vai na copy (legenda), nunca aqui.`;

export type PapelDaLamina = "capa" | "interna" | "cta" | "estatico";

export type LaminaParaConferir = { ordem: number; funcao?: string | null; texto: string };

export type AvisoDeLamina = { ordem: number; papel: PapelDaLamina; palavras: number; limite: number };

/** Palavras de um texto (sequências separadas por espaço ou quebra de linha). */
export function contarPalavras(t: string): number {
  const s = String(t || "").trim();
  if (!s) return 0;
  return s.split(/\s+/).filter(Boolean).length;
}

const semAcento = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Papel da lâmina pela posição e pela função que o modelo declarou. */
export function papelDaLamina(indice: number, total: number, funcao?: string | null): PapelDaLamina {
  if (total <= 1) return "estatico";
  const f = semAcento(funcao || "");
  if (indice === 0) return "capa";
  if (indice === total - 1 || f.indexOf("cta") >= 0) return "cta";
  return "interna";
}

export function limiteDoPapel(p: PapelDaLamina): number {
  return p === "capa" ? LIMITE_DA_CAPA : p === "cta" ? LIMITE_DO_CTA : p === "estatico" ? LIMITE_DO_ESTATICO : LIMITE_DA_LAMINA;
}

/**
 * Frases do texto, na ordem, cada uma com o que vem depois dela (pontuação e a
 * quebra de linha), para o corte manter o título na 1ª linha.
 */
function frasesDe(t: string): string[] {
  const partes = String(t || "").match(/[^.!?\n]+(?:[.!?]+|\n+|$)|\n+/g);
  return partes ? partes.filter((p) => p.length > 0) : [];
}

/**
 * Corta o texto no limite de frase: fica com as frases inteiras que cabem em
 * `max` palavras. Se nem a primeira cabe, corta na palavra e fecha com "…".
 */
export function cortarNoLimiteDeFrase(t: string, max: number): string {
  const texto = String(t || "").trim();
  if (contarPalavras(texto) <= max) return texto;
  let saida = "";
  let palavras = 0;
  for (const f of frasesDe(texto)) {
    const n = contarPalavras(f);
    if (n === 0) {
      saida += f;
      continue;
    }
    if (palavras + n > max) break;
    saida += f;
    palavras += n;
  }
  saida = saida.replace(/\s+$/, "");
  if (palavras > 0) return saida;
  return `${texto.split(/\s+/).filter(Boolean).slice(0, max).join(" ").replace(/[,;:\-]+$/, "")}…`;
}

/**
 * Confere as lâminas de um conteúdo. Lâmina acima do limite do seu papel sai
 * cortada no limite de frase, com aviso. As outras voltam como vieram.
 */
export function conferirLaminas<C extends LaminaParaConferir>(cards: C[]): { cards: C[]; avisos: AvisoDeLamina[] } {
  const avisos: AvisoDeLamina[] = [];
  const total = cards.length;
  const saida = cards.map((c, i) => {
    const papel = papelDaLamina(i, total, c.funcao);
    const limite = limiteDoPapel(papel);
    const palavras = contarPalavras(c.texto);
    if (palavras <= limite) return c;
    avisos.push({ ordem: c.ordem, papel, palavras, limite });
    return { ...c, texto: cortarNoLimiteDeFrase(c.texto, limite) };
  });
  return { cards: saida, avisos };
}

const NOME_DO_PAPEL: Record<PapelDaLamina, string> = { capa: "capa", interna: "lâmina", cta: "fechamento", estatico: "estático" };

/** Frase curta do aviso, para a proposta e a tela. */
export function textoDoAviso(a: AvisoDeLamina): string {
  return `${NOME_DO_PAPEL[a.papel]} ${a.ordem} tinha ${a.palavras} palavras (limite ${a.limite}) e foi encurtada no fim de frase. Confira antes de gravar.`;
}
