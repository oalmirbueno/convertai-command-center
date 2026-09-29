/**
 * Composição dinâmica no Estúdio (frente R3, 26/09/2026).
 *
 * Complementa _shared/jogada-do-texto.ts (a jogada do texto, a palavra
 * decorativa e a cor por papel no prompt) com o que precisa de rede ou do
 * trabalho, sempre com dependências injetadas (testável sem rede):
 *
 * 1. termoDecorativoDaLamina: a referência tem texto decorativo de fundo
 *    (ex.: "melhor" gigante atrás do conteúdo). Um Choice do Jev escolhe,
 *    entre candidatos tirados da copy da lâmina, o termo que entra no lugar.
 *    Guardado por texto (refazer não paga de novo). Falha: o termo padrão da
 *    copy. Nunca a palavra da referência, a não ser que ela seja o tema.
 * 2. Miolo enxuto (dono: "o card 2 fica muito genérico, um textão; quando
 *    chegar no Estúdio já chega refinado"): na preparação, as lâminas 2 em
 *    diante que passam do limite de palavras (os mesmos limites do agente do
 *    Mês, _shared/menos-texto-nas-laminas.ts) são enxutas numa chamada só ao
 *    redator, com as regras do refino (refinar-texto.ts). A capa nunca muda.
 *    Sem laço: uma chamada; o que volta fora do limite, maior ou sem a
 *    headline fica como estava.
 * 3. blocoDoMioloDesenhado: a lâmina 2 em diante ganha composição desenhada
 *    (um recurso visual que carrega a ideia), não um parágrafo solto.
 */

import type { BlocoTexto, CardDirecao, PapelBloco, ZonaTexto } from "../_shared/direcao-arte.ts";
import { blocoDoMiolo, type EscolhaDoMiolo, ehMioloDesenhado, escolhaSolta } from "./miolo-rico.ts";
import type { PerguntaJev, ResultadoJev } from "../_shared/jev.ts";
// Frente FS (29/09): o que falha aqui continua opcional (a lâmina segue), mas fica no log com o motivo.
import { nuloComLog, registrarFalha } from "../_shared/falha-registrada.ts";
import {
  blocosDecorativos,
  candidatosDoTermo,
  decidirTermo,
  estadoDoTermo,
  perguntaDoTermo,
  termoPadrao,
} from "../_shared/jogada-do-texto.ts";
import type { MoldeDaReferencia } from "../_shared/direcao-arte.ts";
import { contarPalavras, PALAVRAS_DO_TITULO } from "../_shared/menos-texto-nas-laminas.ts";
import { passaDoLimite } from "../_shared/limite-do-miolo.ts";
import { semTravessao } from "./refinar-texto.ts";

// ------------------------------------------------------------------ 1. termo decorativo

export const VERSAO_DO_TERMO = 1;

/** Chave curta e estável do texto (FNV-1a): nome de arquivo do cache, não é segurança. */
function chave(s: string): string {
  let a = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) a = Math.imul(a ^ s.charCodeAt(i), 0x01000193) >>> 0;
  let b = 0x01000193;
  for (let i = s.length - 1; i >= 0; i--) b = Math.imul(b ^ s.charCodeAt(i), 0x811c9dc5) >>> 0;
  return `${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}

export const caminhoDoTermo = (pasta: string, copy: string, palavra: string) =>
  `${pasta}/termo-${chave(`${VERSAO_DO_TERMO}|${copy}|${palavra}`)}.json`;

export type DepsDoTermo = {
  pasta: string;
  lerGuardado: (caminho: string) => Promise<Record<string, unknown> | null>;
  guardar: (caminho: string, valor: unknown) => Promise<void>;
  perguntarJev: (state: unknown, questions: Record<string, PerguntaJev>) => Promise<ResultadoJev>;
  cobrarJev: (r: ResultadoJev) => Promise<unknown>;
};

export type TermoDaLamina = { termo: string; origem: "jev" | "copy" | "guardado"; candidatos: string[]; palavra_da_referencia: string | null };

/**
 * O termo que substitui o texto decorativo da referência nesta lâmina. Sem
 * texto decorativo no molde, sem copy ou em Criativa: null (nada muda). Com um
 * candidato só, sem Jev. Nunca lança.
 */
export async function termoDecorativoDaLamina(
  e: { molde: MoldeDaReferencia | null; card: Pick<CardDirecao, "ordem" | "funcao" | "texto_exato" | "blocos">; total: number; conceito?: string | null; criativa: boolean },
  deps: DepsDoTermo,
): Promise<TermoDaLamina | null> {
  try {
    const decorativo = blocosDecorativos(e.molde).sort((a, b) => b.altura_da_letra - a.altura_da_letra)[0];
    const copy = String(e.card.texto_exato || "").trim();
    if (!decorativo || !copy || e.criativa) return null;
    const blocos: BlocoTexto[] = e.card.blocos && e.card.blocos.length ? e.card.blocos : [{ papel: "headline", texto: copy.split("\n")[0] }];
    const candidatos = candidatosDoTermo(blocos, copy);
    const palavra = decorativo.texto_decorativo || null;
    const padrao = termoPadrao(candidatos, palavra);
    if (!padrao) return null;
    const base = { candidatos, palavra_da_referencia: palavra };
    if (candidatos.length < 2) return { termo: padrao, origem: "copy", ...base };
    const caminho = caminhoDoTermo(deps.pasta, copy, palavra || "");
    const guardado = await deps.lerGuardado(caminho).catch(nuloComLog("estudio-arte: termo decorativo guardado não lido", { caminho }));
    if (guardado && guardado.versao === VERSAO_DO_TERMO && typeof guardado.termo === "string" && candidatos.indexOf(guardado.termo) >= 0) {
      return { termo: guardado.termo, origem: "guardado", ...base };
    }
    let res: ResultadoJev;
    try {
      res = await deps.perguntarJev(
        estadoDoTermo({ blocos, textoExato: copy, funcao: e.card.funcao, ordem: e.card.ordem, total: e.total, conceito: e.conceito, palavraDaReferencia: palavra }),
        perguntaDoTermo(candidatos),
      );
    } catch (err) {
      registrarFalha("estudio-arte: jev do termo decorativo falhou (vale o termo da copy)", err, { ordem: e.card.ordem });
      return { termo: padrao, origem: "copy", ...base };
    }
    await deps.cobrarJev(res).catch(() => null);
    const d = decidirTermo(res.answers, candidatos, padrao);
    if (!d.termo) return null;
    await deps.guardar(caminho, { versao: VERSAO_DO_TERMO, em: new Date().toISOString(), termo: d.termo, origem: d.origem, candidatos }).catch(nuloComLog("estudio-arte: termo decorativo não guardado", { caminho }));
    return { termo: d.termo, origem: d.origem, ...base };
  } catch (err) {
    registrarFalha("estudio-arte: termo decorativo falhou (texto decorativo da referência fica)", err, { ordem: e.card.ordem });
    return null;
  }
}

/**
 * A conferência compara o texto lido com o texto exato; com o termo
 * decorativo na arte, ele entra no esperado (senão vira "palavra sobrando").
 */
export function textoEsperadoNaConferencia(textoExato: string, versao: { termo_decorativo?: unknown } | null | undefined): string {
  const t = versao && typeof versao.termo_decorativo === "string" ? versao.termo_decorativo.trim() : "";
  return t ? `${textoExato}\n${t}` : textoExato;
}

// ------------------------------------------------------------------ 2. miolo enxuto

// O limite (passaDoLimite) mora em _shared/limite-do-miolo.ts: a tela usa a mesma regra para o custo.
export { passaDoLimite };

export const ESQUEMA_MIOLO_ENXUTO = {
  nome: "miolo_enxuto",
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

export const INSTRUCOES_MIOLO_ENXUTO = `MIOLO ENXUTO DO CARROSSEL (Estúdio)
Você é o redator sênior da agência. As lâminas abaixo (da 2 em diante) têm texto demais para a arte. Reescreva SÓ essas lâminas mais curtas, prontas para a arte, sem mudar a capa nem as outras.
Regras:
- Uma ideia por lâmina. Headline curta (até ${PALAVRAS_DO_TITULO} palavras, de preferência 6) e, se precisar, um apoio curto (uma frase, até 18 palavras). Fechamento: a chamada para ação curta.
- A sequência continua clara: cada lâmina segue a anterior e prepara a próxima; nada de repetir o texto de outra lâmina.
- Mantenha o sentido, a oferta e os fatos. Não invente preço, número, prazo, promessa, nome nem dado. Número que estava no texto pode virar o protagonista.
- Corte tudo que não muda o sentido: o detalhe vai para a legenda, não para a arte.
- Mantenha os papéis dos blocos (headline, subtitulo, apoio, numero, cta, selo); a headline continua existindo; dois apoios podem virar um.
- Português do Brasil, sem travessão, sem hashtag, @, emoji nem aspas decorativas.`;

/** Pedido ao redator: as lâminas longas, com o conceito e o texto das outras para a sequência. */
export function pedidoDoMioloEnxuto(cards: Pick<CardDirecao, "ordem" | "funcao" | "texto_exato" | "blocos">[], conceito: string | null | undefined, longas: number[]): string {
  return `Enxugue as lâminas ${longas.join(", ")}. Contexto em JSON:\n${JSON.stringify({
    conceito: conceito || null,
    total_de_laminas: cards.length,
    sequencia: cards.map((c) => ({ ordem: c.ordem, funcao: c.funcao, texto: c.texto_exato })),
    enxugar: cards.filter((c) => longas.indexOf(c.ordem) >= 0).map((c) => ({ ordem: c.ordem, funcao: c.funcao, blocos: c.blocos && c.blocos.length ? c.blocos : null, texto: c.texto_exato })),
  })}`;
}

const PAPEIS: PapelBloco[] = ["headline", "subtitulo", "apoio", "numero", "cta", "selo"];

/**
 * Aplica o que o redator devolveu, em código e sem nova chamada: só as
 * lâminas pedidas; blocos limpos (sem travessão, #, @); precisa ter headline
 * (ou número), ter o CTA se a original tinha, caber no limite e ser menor que
 * a original. O que não passa fica como estava. A capa nunca muda.
 */
export function aplicarMioloEnxuto<C extends Pick<CardDirecao, "ordem" | "funcao" | "texto_exato" | "blocos">>(cards: C[], bruto: unknown, longas: number[]): { cards: C[]; mudou: number[] } {
  const lista = bruto && typeof bruto === "object" && Array.isArray((bruto as { laminas?: unknown }).laminas) ? (bruto as { laminas: unknown[] }).laminas : [];
  const total = cards.length;
  const mudou: number[] = [];
  const saida = cards.map((c) => {
    if (c.ordem <= 1 || longas.indexOf(c.ordem) < 0) return c;
    const achada = lista.filter((l) => l && typeof l === "object" && Number((l as { ordem?: unknown }).ordem) === c.ordem)[0] as { blocos?: unknown } | undefined;
    if (!achada || !Array.isArray(achada.blocos)) return c;
    const blocos: BlocoTexto[] = (achada.blocos as unknown[])
      .map((b) => (b && typeof b === "object" ? b as Record<string, unknown> : {}))
      .map((b) => ({
        papel: PAPEIS.indexOf(b.papel as PapelBloco) >= 0 ? b.papel as PapelBloco : "apoio",
        texto: semTravessao(String(b.texto ?? "")).replace(/(^|\s)[#@][A-Za-z0-9_À-ÿ.]+/g, "$1").replace(/\s+/g, " ").trim().slice(0, 300),
      }))
      .filter((b) => b.texto);
    if (!blocos.some((b) => b.papel === "headline" || b.papel === "numero")) return c;
    const tinhaCta = (c.blocos || []).some((b) => b.papel === "cta");
    if (tinhaCta && !blocos.some((b) => b.papel === "cta")) return c;
    const nova = { ...c, blocos, texto_exato: blocos.map((b) => b.texto).join("\n") };
    if (passaDoLimite(nova, total)) return c;
    if (contarPalavras(nova.texto_exato) >= contarPalavras(c.texto_exato)) return c;
    mudou.push(c.ordem);
    return nova;
  });
  return { cards: saida, mudou };
}

/**
 * Uma chamada ao redator para as lâminas longas (2 em diante). Nenhuma longa:
 * nada é chamado. Falha: tudo como estava. Devolve o custo da chamada.
 */
export async function enxugarMiolo<C extends Pick<CardDirecao, "ordem" | "funcao" | "texto_exato" | "blocos">>(
  cards: C[],
  conceito: string | null | undefined,
  escrever: (sistema: string, pedido: string) => Promise<{ json: unknown; custoUsd: number }>,
): Promise<{ cards: C[]; mudou: number[]; longas: number[]; custoUsd: number; erro?: string }> {
  const longas = cards.filter((c) => passaDoLimite(c, cards.length)).map((c) => c.ordem);
  if (!longas.length) return { cards, mudou: [], longas, custoUsd: 0 };
  try {
    const r = await escrever(INSTRUCOES_MIOLO_ENXUTO, pedidoDoMioloEnxuto(cards, conceito, longas));
    const aplicado = aplicarMioloEnxuto(cards, r.json, longas);
    return { ...aplicado, longas, custoUsd: Number(r.custoUsd) || 0 };
  } catch (e) {
    // Frente FS: o motivo volta (erro) para a direção avisar a equipe que o miolo ficou longo.
    const erro = registrarFalha("estudio-arte: miolo não enxuto", e, { longas });
    return { cards, mudou: [], longas, custoUsd: 0, erro };
  }
}

// ------------------------------------------------------------------ 3. miolo desenhado

/**
 * Bloco da lâmina de conteúdo desenhada (lâmina 2 até a penúltima, fora do
 * replicar e do anúncio). Frente R4 (26/09): o recurso virou um COMPONENTE DE
 * LÂMINA desenhado pelo gerador (cartão, caixas conectadas, linha do tempo,
 * colunas, checklist, número em cartão, balão, citação, chips, mini-gráfico,
 * caixa de dica, ícones de linha), escolhido em código pelo tipo do conteúdo
 * e com rotação na série (miolo-rico.ts). `componente`: a escolha do plano da
 * série (componenteDaLamina); sem ela, o primeiro do tipo. `zona`: a zona do
 * texto da direção (o arranjo acompanha). Capa, post único e fechamento: vazio.
 */
export function blocoDoMioloDesenhado(e: { ordem: number; total: number; blocos: BlocoTexto[]; cenaFixa?: boolean; componente?: EscolhaDoMiolo | null; zona?: ZonaTexto | null }): string {
  if (!ehMioloDesenhado(e.ordem, e.total)) return "";
  const escolha = e.componente && e.componente.ordem === e.ordem ? e.componente : escolhaSolta(e.ordem, e.blocos);
  return blocoDoMiolo({ ordem: e.ordem, total: e.total, escolha, cenaFixa: e.cenaFixa, zona: e.zona });
}
