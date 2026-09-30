/**
 * Texto da lâmina na geração (frente R5, 26/09/2026).
 *
 * Pedido do dono: "quando gerar a arte, ele já refinar e encurtar o conteúdo,
 * senão fica textão; ou divide em partes e não deixa só em um lugar; ajuda na
 * continuação e dinâmica do carrossel, pra não ficar sempre fixo de um lado,
 * na mesma coisa."
 *
 * 1. Enxugar na geração: a preparação já enxuga as lâminas 2+ (R3,
 *    composicao-dinamica.ts). Aqui, na hora de gerar CADA lâmina (inclusive
 *    refazer e a lâmina avulsa), o texto que passa do limite do papel (capa,
 *    miolo, fechamento, estático; os números de menos-texto-nas-laminas.ts)
 *    vai numa chamada curta ao redator, que encurta mantendo o sentido e o
 *    texto exato do que não pode mudar (número, nome, preço, CTA). Guardado
 *    por hash do texto (refazer não paga de novo). Sem laço: a resposta que
 *    não cabe é cortada no fim de frase, com aviso; a que perde um número, um
 *    nome ou a headline cai no corte do original, com aviso. A capa que já
 *    tem versão não muda; o anúncio (Mesa Ads) fica como está.
 * 2. Dividir em partes dentro da lâmina: o texto que ainda é mais longo que um
 *    bloco (lista, passos, comparação, dois argumentos) vira 2 a 4 partes
 *    curtas, em lugares diferentes da lâmina, com o componente do miolo (R4).
 *    Em código, sem IA: cada parte é um trecho contínuo do texto exato (a
 *    divisão não reescreve nada, a conferência continua batendo).
 * 3. Sugerir dividir em 2 lâminas: a lâmina que passa do limite e tem mais de
 *    uma ideia recebe a sugestão; a equipe confirma (texto_da_lamina, em
 *    index.ts) e a lâmina seguinte nasce com a segunda parte. Desfazer junta
 *    de novo enquanto a lâmina nova não tem arte.
 *
 * Puro, sem Deno nem npm: a tela (custo no botão, sugestão), a função e os
 * testes leem o mesmo arquivo. A posição que varia na série mora em
 * posicao-na-serie.ts (só no servidor).
 */

import {
  contarPalavras,
  cortarNoLimiteDeFrase,
  LIMITE_DA_CAPA,
  LIMITE_DA_LAMINA,
  LIMITE_DO_CTA,
  LIMITE_DO_ESTATICO,
  PALAVRAS_DA_CAPA,
  PALAVRAS_DO_APOIO,
  PALAVRAS_DO_CTA,
  PALAVRAS_DO_TITULO,
} from "../_shared/menos-texto-nas-laminas.ts";
import { passaDoLimite } from "./modulos/limite-do-miolo.ts";
import { semTravessao } from "./refinar-texto.ts";
// Frente FS (29/09): a falha do redator continua virando corte com aviso, agora com o motivo e no log.
import { nuloComLog, registrarFalha } from "../_shared/falha-registrada.ts";

export type PapelDoBloco = "headline" | "subtitulo" | "apoio" | "numero" | "cta" | "selo";
export type BlocoDaLamina = { papel: PapelDoBloco; texto: string };

/** O mínimo da lâmina que o texto lê (o CardDirecao completo mora em _shared/direcao-arte.ts). */
export type LaminaDoTexto = {
  ordem: number;
  funcao?: string | null;
  texto_exato?: string | null;
  blocos?: BlocoDaLamina[] | null;
  texto_na_geracao?: unknown;
};

const PAPEIS: PapelDoBloco[] = ["headline", "subtitulo", "apoio", "numero", "cta", "selo"];
const ehNumero = (t: string) => /^\d{1,3}(%|x)?$/.test(t.replace(/\s/g, ""));

/** Blocos da lâmina; sem blocos (roteiro cru), a 1ª linha é a headline, a última do fechamento é o CTA e o resto é o apoio. */
export function blocosDaLamina(c: Pick<LaminaDoTexto, "funcao" | "texto_exato" | "blocos">): BlocoDaLamina[] {
  if (c.blocos && c.blocos.length) return c.blocos.filter((b) => b && PAPEIS.indexOf(b.papel) >= 0 && String(b.texto || "").trim());
  const linhas = String(c.texto_exato || "").split("\n").map((l) => l.trim()).filter(Boolean);
  return linhas.map((texto, i) => ({
    papel: i === 0 ? (ehNumero(texto) ? "numero" : "headline") : c.funcao === "cta" && i === linhas.length - 1 && linhas.length > 1 ? "cta" : "apoio",
    texto,
  }));
}

const textoDe = (c: Pick<LaminaDoTexto, "funcao" | "texto_exato" | "blocos">) =>
  String(c.texto_exato || "").trim() || blocosDaLamina(c).map((b) => b.texto).join("\n");

// ------------------------------------------------------------------ limites na geração

export type PapelNaGeracao = "capa" | "miolo" | "fechamento" | "estatico";

/** Papel pela posição: post único é estático; a 1ª é a capa; a última (ou a de função cta) é o fechamento. */
export function papelNaGeracao(ordem: number, total: number, funcao?: string | null): PapelNaGeracao {
  if (total <= 1) return "estatico";
  if (ordem <= 1 || funcao === "capa") return "capa";
  if (funcao === "cta" || ordem === total) return "fechamento";
  return "miolo";
}

/** Limite da conferência em código (com a folga de menos-texto-nas-laminas.ts). */
export const LIMITE_NA_GERACAO: Record<PapelNaGeracao, number> = {
  capa: LIMITE_DA_CAPA,
  miolo: LIMITE_DA_LAMINA,
  fechamento: LIMITE_DO_CTA,
  estatico: LIMITE_DO_ESTATICO,
};

/** O que o redator deve cumprir (o pedido, sem a folga), para a resposta caber depois de contar. */
export const PEDIDO_NA_GERACAO: Record<PapelNaGeracao, { total: number; titulo: number; apoio: number }> = {
  capa: { total: PALAVRAS_DA_CAPA, titulo: PALAVRAS_DA_CAPA, apoio: 0 },
  miolo: { total: LIMITE_DA_LAMINA - 6, titulo: PALAVRAS_DO_TITULO, apoio: 18 },
  fechamento: { total: PALAVRAS_DO_CTA, titulo: PALAVRAS_DO_TITULO, apoio: 12 },
  estatico: { total: LIMITE_DO_ESTATICO - 6, titulo: PALAVRAS_DO_TITULO, apoio: 18 },
};

/**
 * A lâmina passa do limite do papel? Capa e estático: total de palavras.
 * Miolo e fechamento: a regra da R3 (total, headline e cada apoio).
 */
export function passaNaGeracao(c: LaminaDoTexto, total: number): boolean {
  const papel = papelNaGeracao(c.ordem, total, c.funcao);
  const texto = textoDe(c);
  if (!texto) return false;
  if (papel === "capa" || papel === "estatico") return contarPalavras(texto) > LIMITE_NA_GERACAO[papel];
  return passaDoLimite({ ordem: c.ordem, funcao: papel === "fechamento" ? "cta" : c.funcao, texto_exato: texto, blocos: c.blocos || null }, total);
}

/** Registro que a direção guarda na lâmina enxuta na geração (texto_na_geracao). */
export type RegistroDoTexto = {
  versao: number;
  original: string;
  blocos_original: BlocoDaLamina[] | null;
  texto: string;
  origem: "redator" | "corte";
  aviso: string | null;
  papel: PapelNaGeracao;
  limite: number;
  palavras_antes: number;
  palavras_depois: number;
  em: string;
  /** A equipe voltou ao original: a próxima geração não enxuga este texto de novo. */
  manter?: boolean;
};

export function registroDoTexto(v: unknown): RegistroDoTexto | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (typeof r.original !== "string" || typeof r.texto !== "string") return null;
  return r as unknown as RegistroDoTexto;
}

/** A equipe pediu para manter o texto original (Voltar ao original) e ele não mudou desde então. */
export function mantemOriginal(c: LaminaDoTexto): boolean {
  const r = registroDoTexto(c.texto_na_geracao);
  return !!r && r.manter === true && r.original.trim() === String(c.texto_exato || "").trim();
}

/**
 * Vai enxugar ao gerar? Fora do anúncio, com texto, acima do limite do papel;
 * a capa que já tem versão não muda; o texto que a equipe mandou manter fica.
 * A tela usa a mesma regra para pôr a chamada curta no preço do botão.
 */
export function precisaEnxugarNaGeracao(e: { card: LaminaDoTexto; total: number; capaComVersao?: boolean; ads?: boolean }): boolean {
  if (e.ads) return false;
  if (!textoDe(e.card)) return false;
  const papel = papelNaGeracao(e.card.ordem, e.total, e.card.funcao);
  if (papel === "capa" && e.capaComVersao) return false;
  if (mantemOriginal(e.card)) return false;
  return passaNaGeracao(e.card, e.total);
}

/** Tamanho da chamada curta ao redator (estimativa da tela). */
export const TAMANHO_DO_ENXUGAR = { entrada: 3500, saida: 700 };

// ------------------------------------------------------------------ o que não pode mudar

const semAcento = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const umaLinha = (s: string) => String(s || "").replace(/\s+/g, " ").trim();
const LETRA = "A-Za-zÀ-ÖØ-öø-ÿ";

/**
 * Trechos que voltam exatamente como estão: números (com R$, % ou x), nomes
 * próprios (palavras com maiúscula fora do começo da frase), siglas, @ e
 * endereços. O CTA volta inteiro por fora (fica o bloco original).
 */
export function intocaveis(blocos: BlocoDaLamina[]): string[] {
  const saida: string[] = [];
  const pus = (t: string) => {
    const x = umaLinha(t).replace(/[.,;:!?]+$/, "");
    if (x && saida.indexOf(x) < 0) saida.push(x);
  };
  for (const b of blocos) {
    if (b.papel === "cta") continue;
    const t = String(b.texto || "");
    // Número solto (não o pedaço de uma palavra como "top10"), com R$, %, x, º ou ª.
    const numero = new RegExp(`(^|[^${LETRA}0-9])((?:R\\$\\s?)?\\d+(?:[.,]\\d+)*(?:\\s?%|x(?![${LETRA}])|º|ª)?)`, "g");
    let m: RegExpExecArray | null;
    while ((m = numero.exec(t))) pus(m[2]);
    (t.match(/(?:@|www\.)[\w.\-/]+|[\w-]+\.(?:com|com\.br|br|net|org)\b[\w./-]*/g) || ([] as string[])).forEach(pus);
    const letras = t.replace(new RegExp(`[^${LETRA}]`, "g"), "");
    const maiusculas = letras.replace(/[^A-ZÀ-ÖØ-Þ]/g, "").length;
    // Bloco inteiro em caixa alta (título gritado): nem sigla nem nome se tira dele.
    if (letras.length && maiusculas / letras.length > 0.6) continue;
    (t.match(new RegExp(`(^|[^${LETRA}])([A-Z]{2,6})(?=[^${LETRA}]|$)`, "g")) || ([] as string[])).forEach((m) => pus(m.replace(new RegExp(`^[^${LETRA}]`), "")));
    // Nome próprio: palavra com maiúscula que não abre a frase (nem a linha). Título Com Todas Maiúsculas: nenhum.
    const palavras = t.split(/\s+/);
    const capitalizadas = palavras.filter((w) => /^[("“']*[A-ZÀ-ÖØ-Þ]/.test(w)).length;
    if (palavras.length >= 3 && capitalizadas / palavras.length > 0.5) continue;
    let grupo: string[] = [];
    for (let i = 0; i < palavras.length; i++) {
      const w = palavras[i].replace(/^[("“']+|[)"”',.;:!?]+$/g, "");
      const anterior = i > 0 ? palavras[i - 1] : "";
      const abreFrase = i === 0 || /[.!?:]$/.test(anterior);
      if (/^[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ]+$/.test(w) && !abreFrase) {
        grupo.push(w);
        continue;
      }
      if (grupo.length) pus(grupo.join(" "));
      grupo = [];
    }
    if (grupo.length) pus(grupo.join(" "));
  }
  return saida.slice(0, 12);
}

/** Os intocáveis que faltam no texto novo (sem diferenciar caixa nem espaço). */
export function faltaIntocavel(novo: string, lista: string[]): string[] {
  const n = semAcento(umaLinha(novo)).replace(/\s+/g, "");
  return lista.filter((x) => n.indexOf(semAcento(x).replace(/\s+/g, "")) < 0);
}

// ------------------------------------------------------------------ pedido ao redator

export const ESQUEMA_TEXTO_NA_GERACAO = {
  nome: "texto_na_geracao",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["blocos"],
    properties: {
      blocos: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["papel", "texto"],
          properties: {
            papel: { type: "string", enum: PAPEIS },
            texto: { type: "string" },
          },
        },
      },
    },
  },
};

export const INSTRUCOES_TEXTO_NA_GERACAO = `TEXTO DA LÂMINA NA HORA DE GERAR (Estúdio)
Você é o redator sênior da agência. O texto abaixo vai ser escrito DENTRO da arte e passa do limite desta lâmina. Encurte e refine agora, numa resposta só, pronto para a arte.
Regras:
- Respeite os limites que vêm no pedido (total de palavras, headline e apoio). Menos é melhor: o detalhe vai para a legenda, não para a arte.
- Mantenha o sentido, a ideia principal e o lugar desta lâmina na sequência (a anterior e a próxima vêm no pedido: não repita o texto delas).
- Os itens de "intocaveis" (número, preço, nome, sigla, endereço) aparecem EXATAMENTE como estão. Não invente preço, número, prazo, promessa, nome nem dado.
- O CTA não é reescrito: ele fica como está, fora da sua resposta.
- Headline curta primeiro; depois, se precisar, um apoio curto (uma ou duas frases). Lista ou passos: itens curtos (2 a 4), separados por vírgula ou em blocos de apoio, nunca um parágrafo corrido.
- Mantenha os papéis (headline, subtitulo, apoio, numero, selo); a headline continua existindo.
- Português do Brasil, sem travessão, sem hashtag, @, emoji nem aspas decorativas.`;

/** Pedido curto ao redator: a lâmina, os limites do papel, os intocáveis e as vizinhas (para a sequência). */
export function pedidoDoTextoNaGeracao(e: {
  card: LaminaDoTexto;
  total: number;
  conceito?: string | null;
  anterior?: string | null;
  proxima?: string | null;
}): string {
  const papel = papelNaGeracao(e.card.ordem, e.total, e.card.funcao);
  const blocos = blocosDaLamina(e.card);
  const pedido = PEDIDO_NA_GERACAO[papel];
  return `Encurte o texto desta lâmina. Contexto em JSON:\n${JSON.stringify({
    lamina: { ordem: e.card.ordem, de: e.total, papel },
    limites: { total_de_palavras: pedido.total, headline_ate: pedido.titulo, apoio_ate: pedido.apoio || null },
    blocos: blocos.filter((b) => b.papel !== "cta").map((b) => ({ papel: b.papel, texto: b.texto })),
    cta_fica_como_esta: blocos.filter((b) => b.papel === "cta").map((b) => b.texto)[0] || null,
    intocaveis: intocaveis(blocos),
    conceito: e.conceito || null,
    lamina_anterior: e.anterior || null,
    proxima_lamina: e.proxima || null,
  })}`;
}

// ------------------------------------------------------------------ aplicar (em código, sem nova chamada)

export type TextoEnxuto = { texto: string; blocos: BlocoDaLamina[]; origem: "redator" | "corte"; aviso: string | null };

const limparBloco = (t: string) =>
  semTravessao(String(t ?? "")).replace(/(^|\s)[#@][A-Za-z0-9_À-ÿ.]+/g, "$1").replace(/\s+/g, " ").trim().slice(0, 300);

/**
 * Corte no fim de frase dentro do limite do papel, sem IA: o CTA, o selo e o
 * número ficam inteiros; a headline cabe no teto do título; cada apoio entra
 * inteiro ou cortado no fim de frase (apoio sem nenhuma frase inteira sai).
 */
export function cortarNaGeracao(c: LaminaDoTexto, total: number): BlocoDaLamina[] {
  const papel = papelNaGeracao(c.ordem, total, c.funcao);
  const limite = LIMITE_NA_GERACAO[papel];
  const blocos = blocosDaLamina(c);
  const fixo = (b: BlocoDaLamina) => b.papel === "cta" || b.papel === "selo" || b.papel === "numero";
  let resta = limite - blocos.filter(fixo).reduce((s, b) => s + contarPalavras(b.texto), 0);
  const saida: BlocoDaLamina[] = [];
  let temTitulo = blocos.some((b) => b.papel === "numero");
  for (const b of blocos) {
    if (fixo(b)) {
      saida.push(b);
      continue;
    }
    const titulo = b.papel === "headline";
    const teto = Math.min(resta, titulo ? (papel === "capa" || papel === "estatico" ? resta : PALAVRAS_DO_TITULO + 2) : PALAVRAS_DO_APOIO);
    if (teto <= 0 && !(titulo && !temTitulo)) continue;
    const n = contarPalavras(b.texto);
    if (n <= teto) {
      saida.push(b);
      resta -= n;
      if (titulo) temTitulo = true;
      continue;
    }
    const cortado = cortarNoLimiteDeFrase(b.texto, Math.max(teto, titulo && !temTitulo ? 3 : 1));
    // Apoio sem nenhuma frase inteira no teto sai (reticências no apoio não servem); a headline fica.
    if (!titulo && /…$/.test(cortado)) continue;
    saida.push({ ...b, texto: cortado });
    resta -= contarPalavras(cortado);
    if (titulo) temTitulo = true;
  }
  return saida;
}

const juntar = (blocos: BlocoDaLamina[]) => blocos.map((b) => b.texto).join("\n");

/**
 * Aplica o que o redator devolveu: blocos limpos; o CTA e o selo originais
 * voltam como eram; precisa de headline (ou número), de todos os intocáveis e
 * de menos palavras que o original. Não cumpre: corte do original, com aviso.
 * Cumpre mas ainda passa do limite: corte da resposta, com aviso.
 */
export function aplicarTextoNaGeracao(c: LaminaDoTexto, total: number, bruto: unknown): TextoEnxuto {
  const originais = blocosDaLamina(c);
  const lista = bruto && typeof bruto === "object" && Array.isArray((bruto as { blocos?: unknown }).blocos) ? (bruto as { blocos: unknown[] }).blocos : [];
  const doRedator: BlocoDaLamina[] = lista
    .map((b) => (b && typeof b === "object" ? b as Record<string, unknown> : {}))
    .map((b) => ({ papel: (PAPEIS.indexOf(b.papel as PapelDoBloco) >= 0 ? b.papel : "apoio") as PapelDoBloco, texto: limparBloco(String(b.texto ?? "")) }))
    .filter((b) => b.texto && b.papel !== "cta" && b.papel !== "selo");
  // CTA e selo: sempre os originais, no fim (a ordem de leitura de sempre).
  const blocos = doRedator.concat(originais.filter((b) => b.papel === "cta" || b.papel === "selo"));
  const corteDoOriginal = (motivo: string): TextoEnxuto => {
    const cortados = cortarNaGeracao(c, total);
    return { texto: juntar(cortados), blocos: cortados, origem: "corte", aviso: `${motivo} O texto foi cortado no fim de frase: confira.` };
  };
  if (!doRedator.length) return corteDoOriginal("O redator não devolveu texto.");
  if (!blocos.some((b) => b.papel === "headline" || b.papel === "numero")) return corteDoOriginal("A resposta veio sem headline.");
  const faltam = faltaIntocavel(juntar(blocos), intocaveis(originais));
  if (faltam.length) return corteDoOriginal(`A resposta perdia ${faltam.slice(0, 3).map((x) => `"${x}"`).join(", ")}.`);
  const novo: LaminaDoTexto = { ordem: c.ordem, funcao: c.funcao, texto_exato: juntar(blocos), blocos };
  if (contarPalavras(novo.texto_exato || "") >= contarPalavras(textoDe(c))) return corteDoOriginal("A resposta não ficou menor.");
  if (!passaNaGeracao(novo, total)) return { texto: novo.texto_exato || "", blocos, origem: "redator", aviso: null };
  const cortados = cortarNaGeracao(novo, total);
  return { texto: juntar(cortados), blocos: cortados, origem: "redator", aviso: "Mesmo enxuto passou do limite: cortado no fim de frase. Confira." };
}

// ------------------------------------------------------------------ enxugar na geração (uma chamada, guardada)

export const VERSAO_DO_TEXTO = 1;

/** Chave curta e estável do texto (FNV-1a): nome de arquivo do cache, não é segurança. */
function chave(s: string): string {
  let a = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) a = Math.imul(a ^ s.charCodeAt(i), 0x01000193) >>> 0;
  let b = 0x01000193;
  for (let i = s.length - 1; i >= 0; i--) b = Math.imul(b ^ s.charCodeAt(i), 0x811c9dc5) >>> 0;
  return `${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}

/** Guardado por papel, limite e texto: a mesma lâmina com o mesmo texto não paga de novo. */
export const caminhoDoTexto = (pasta: string, papel: PapelNaGeracao, limite: number, texto: string) =>
  `${pasta}/texto-${chave(`${VERSAO_DO_TEXTO}|${papel}|${limite}|${texto}`)}.json`;

export type DepsDoTexto = {
  pasta: string;
  lerGuardado: (caminho: string) => Promise<Record<string, unknown> | null>;
  guardar: (caminho: string, valor: unknown) => Promise<void>;
  /** Uma chamada ao redator (modelo do diretor de arte), com o custo. */
  escrever: (sistema: string, pedido: string) => Promise<{ json: unknown; custoUsd: number }>;
  agora?: () => string;
};

export type TextoNaGeracao = TextoEnxuto & { registro: RegistroDoTexto; custoUsd: number; guardado: boolean };

/**
 * Enxuga o texto da lâmina, se passar do limite do papel: primeiro o
 * guardado (sem custo); senão UMA chamada ao redator. Falha da chamada: corte
 * no fim de frase, com aviso (não guardado: a próxima pode tentar o redator).
 * Dentro do limite: null (nada é chamado). Nunca lança.
 */
export async function enxugarNaGeracao(
  e: { card: LaminaDoTexto; total: number; conceito?: string | null; anterior?: string | null; proxima?: string | null },
  deps: DepsDoTexto,
): Promise<TextoNaGeracao | null> {
  try {
    if (!passaNaGeracao(e.card, e.total)) return null;
    const original = textoDe(e.card);
    const papel = papelNaGeracao(e.card.ordem, e.total, e.card.funcao);
    const limite = LIMITE_NA_GERACAO[papel];
    const agora = deps.agora ? deps.agora() : new Date().toISOString();
    const registro = (r: TextoEnxuto): RegistroDoTexto => ({
      versao: VERSAO_DO_TEXTO,
      original,
      blocos_original: e.card.blocos && e.card.blocos.length ? e.card.blocos : null,
      texto: r.texto,
      origem: r.origem,
      aviso: r.aviso,
      papel,
      limite,
      palavras_antes: contarPalavras(original),
      palavras_depois: contarPalavras(r.texto),
      em: agora,
    });
    const caminho = caminhoDoTexto(deps.pasta, papel, limite, original);
    const guardado = await deps.lerGuardado(caminho).catch(nuloComLog("estudio-arte: texto enxuto guardado não lido", { caminho }));
    if (guardado && guardado.versao === VERSAO_DO_TEXTO && typeof guardado.texto === "string" && Array.isArray(guardado.blocos) && guardado.texto.trim()) {
      const r: TextoEnxuto = {
        texto: guardado.texto,
        blocos: guardado.blocos as BlocoDaLamina[],
        origem: guardado.origem === "corte" ? "corte" : "redator",
        aviso: typeof guardado.aviso === "string" ? guardado.aviso : null,
      };
      return { ...r, registro: registro(r), custoUsd: 0, guardado: true };
    }
    let resposta: { json: unknown; custoUsd: number };
    try {
      resposta = await deps.escrever(INSTRUCOES_TEXTO_NA_GERACAO, pedidoDoTextoNaGeracao(e));
    } catch (err) {
      const motivo = registrarFalha("estudio-arte: redator do texto na geração falhou (corte no fim de frase)", err, { ordem: e.card.ordem });
      const cortados = cortarNaGeracao(e.card, e.total);
      const r: TextoEnxuto = { texto: juntar(cortados), blocos: cortados, origem: "corte", aviso: `O redator não respondeu (${motivo}): o texto foi cortado no fim de frase. Confira.` };
      return { ...r, registro: registro(r), custoUsd: 0, guardado: false };
    }
    const r = aplicarTextoNaGeracao(e.card, e.total, resposta.json);
    await deps.guardar(caminho, { versao: VERSAO_DO_TEXTO, em: agora, texto: r.texto, blocos: r.blocos, origem: r.origem, aviso: r.aviso }).catch(nuloComLog("estudio-arte: texto enxuto não guardado", { caminho }));
    return { ...r, registro: registro(r), custoUsd: Number(resposta.custoUsd) || 0, guardado: false };
  } catch (err) {
    registrarFalha("estudio-arte: texto na geração falhou (vai o texto combinado)", err, { ordem: e.card.ordem });
    return null;
  }
}

/** Frase curta da tela para a lâmina enxuta na geração. Sem registro válido ou texto já trocado: null. */
export function textoDoEnxuto(c: LaminaDoTexto): string | null {
  const r = registroDoTexto(c.texto_na_geracao);
  if (!r || r.manter || r.texto.trim() !== String(c.texto_exato || "").trim() || r.original.trim() === r.texto.trim()) return null;
  return `Enxugado ao gerar: de ${r.palavras_antes} para ${r.palavras_depois} palavras.${r.aviso ? ` ${r.aviso}` : ""}`;
}

// ------------------------------------------------------------------ dividir em partes dentro da lâmina

export type FormaDasPartes = "lista" | "passos" | "comparacao" | "argumentos";

export type TextoEmPartes = {
  forma: FormaDasPartes;
  titulo: string | null;
  /** Trecho antes das partes ("Três sinais:"). */
  abertura: string | null;
  partes: string[];
  /** Trecho depois das partes, pequeno, fechando o grupo. */
  apoio: string | null;
};

export const MAX_PARTES = 4;
const MARCADOR = /^\s*[•·*✓✔\-–]\s*/;
const NUMERADA = /^\s*\d{1,2}\s*[.)º°]\s+/;

/** Frases na ordem, cada uma com a sua pontuação; a quebra de linha também separa. */
export function frasesDoTexto(t: string): string[] {
  const s = String(t || "").replace(/[ \t]*\n+[ \t]*/g, "\n").trim();
  const saida: string[] = [];
  let atual = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\n") {
      if (atual.trim()) saida.push(atual.trim());
      atual = "";
      continue;
    }
    atual += ch;
    if (/[.!?…]/.test(ch) && (i + 1 >= s.length || /\s/.test(s[i + 1]))) {
      if (atual.trim()) saida.push(atual.trim());
      atual = "";
    }
  }
  if (atual.trim()) saida.push(atual.trim());
  return saida;
}

const semPontaFinal = (t: string) => t.replace(/[,;]\s*$/, "").trim();

/** Até MAX_PARTES: o que passa entra na última parte (nada sai do texto). */
function noMaximo(partes: string[]): string[] {
  const limpas = partes.map((p) => p.trim()).filter(Boolean);
  if (limpas.length <= MAX_PARTES) return limpas;
  return limpas.slice(0, MAX_PARTES - 1).concat([limpas.slice(MAX_PARTES - 1).join(" ")]);
}

/** "A, B e C" (com abertura "Três sinais:" opcional): 3 itens ou mais, cada um de até 7 palavras. */
export function enumeracao(frase: string): { abertura: string | null; itens: string[] } | null {
  let corpo = frase.trim();
  let abertura: string | null = null;
  const dp = corpo.indexOf(":");
  if (dp > 0 && dp < corpo.length - 1) {
    abertura = corpo.slice(0, dp + 1).trim();
    corpo = corpo.slice(dp + 1).trim();
  }
  const pedacos = corpo.split(/,\s+/);
  if (pedacos.length < 2) return null;
  const ultimo = pedacos[pedacos.length - 1];
  const m = ultimo.match(/^(.*?\S)\s+(e|ou)\s+(\S.*)$/);
  const itens = m ? pedacos.slice(0, -1).concat([m[1], `${m[2]} ${m[3]}`]) : pedacos;
  if (itens.length < 3) return null;
  if (itens.some((i) => contarPalavras(i) < 1 || contarPalavras(i) > 7)) return null;
  return { abertura, itens: itens.map(semPontaFinal) };
}

/** Mesma string sem acento e em minúsculas, com o mesmo tamanho (os índices valem no original). */
function mapaSemAcento(s: string): string {
  let saida = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    saida += (base.length === 1 ? base : ch).toLowerCase();
  }
  return saida;
}

const PARES_DE_COMPARACAO: [RegExp, RegExp][] = [
  [/\bantes\b/, /\bdepois\b/],
  [/\berrad[oa]s?\b/, /\bcert[oa]s?\b/],
  [/\berros?\b/, /\bacertos?\b/],
  [/\bmitos?\b/, /\bverdades?\b/],
];

/** Duas metades de uma comparação (antes e depois, errado e certo, mito e verdade, vs). */
function comparacaoEmDuas(corpo: string): [string, string] | null {
  const n = mapaSemAcento(corpo);
  const corte = (i: number): [string, string] | null => {
    const a = corpo.slice(0, i).trim();
    const b = corpo.slice(i).trim();
    return contarPalavras(a) >= 2 && contarPalavras(b) >= 2 ? [semPontaFinal(a), b] : null;
  };
  for (const [a, b] of PARES_DE_COMPARACAO) {
    const ia = n.search(a);
    if (ia < 0) continue;
    const resto = n.slice(ia + 1);
    const ib = resto.search(b);
    if (ib < 0) continue;
    const i = ia + 1 + ib;
    // Começa a segunda metade no começo da oração de b (depois de ". ", "; " ou ", " logo antes).
    const antes = n.slice(0, i);
    const fim = Math.max(antes.lastIndexOf(". "), antes.lastIndexOf("; "), antes.lastIndexOf(", "), antes.lastIndexOf("! "), antes.lastIndexOf("? "));
    const inicio = fim > ia && i - fim <= 12 ? fim + 2 : i;
    const r = corte(inicio);
    if (r) return r;
  }
  const vs = n.search(/\s(vs\.?|versus)\s/);
  return vs > 0 ? corte(vs + 1) : null;
}

const PASSO = /(^|[.;,:!?]\s+)(primeiro|segundo|terceiro|depois|em seguida|por fim|por ultimo|finalmente)\b/g;

/** Passos marcados no texto (primeiro, depois, em seguida, por fim): 2 ou mais. */
function passosDoTexto(corpo: string): { abertura: string | null; partes: string[] } | null {
  const n = mapaSemAcento(corpo);
  const inicios: number[] = [];
  PASSO.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PASSO.exec(n))) inicios.push(m.index + m[1].length);
  if (inicios.length < 2) return null;
  const abertura = inicios[0] > 0 ? corpo.slice(0, inicios[0]).trim() : "";
  const partes = inicios.map((ini, k) => corpo.slice(ini, k + 1 < inicios.length ? inicios[k + 1] : corpo.length).trim());
  return { abertura: abertura || null, partes: partes.map(semPontaFinal) };
}

/** Uma frase longa com dois argumentos: corta na conjunção mais perto do meio (a conjunção abre a 2ª parte). */
function doisArgumentos(frase: string): [string, string] | null {
  const palavras = frase.trim().split(/\s+/);
  if (palavras.length < 12) return null;
  const conj = /^(e|mas|porque|pois|então|entao|ou|enquanto)$/i;
  let melhor = -1;
  let dist = Infinity;
  for (let i = 4; i <= palavras.length - 4; i++) {
    const w = palavras[i];
    const antes = palavras[i - 1];
    const ok = conj.test(w) || (/[,;]$/.test(antes) && i >= 5);
    if (!ok) continue;
    const d = Math.abs(i - palavras.length / 2) + (conj.test(w) ? 0 : 0.5);
    if (d < dist) {
      dist = d;
      melhor = i;
    }
  }
  if (melhor < 0) return null;
  return [semPontaFinal(palavras.slice(0, melhor).join(" ")), palavras.slice(melhor).join(" ")];
}

/**
 * O texto da lâmina em partes curtas, em código: título; abertura; 2 a 4
 * partes; apoio. Cada parte é um trecho contínuo do texto (só marcadores de
 * lista, vírgula ou ponto e vírgula nas pontas saem). Texto que cabe num
 * bloco só (curto e sem estrutura): null.
 */
export function dividirEmPartes(blocos: BlocoDaLamina[]): TextoEmPartes | null {
  const titulo = blocos.filter((b) => b.papel === "headline" || b.papel === "numero").map((b) => b.texto.trim())[0] || null;
  const tituloUsado = blocos.filter((b) => b.papel === "headline" || b.papel === "numero")[0];
  const corpoBlocos = blocos.filter((b) => b !== tituloUsado && b.papel !== "cta" && b.papel !== "selo");
  const linhas = corpoBlocos.reduce((l: string[], b) => l.concat(b.texto.split("\n")), []).map((l) => l.trim()).filter(Boolean);
  if (!linhas.length) return null;
  const corpo = linhas.join(" ");
  const palavras = contarPalavras(corpo);
  const base = { titulo, abertura: null as string | null, apoio: null as string | null };
  const pronto = (forma: FormaDasPartes, partes: string[], extra?: { abertura?: string | null; apoio?: string | null }): TextoEmPartes | null => {
    const p = noMaximo(partes);
    return p.length >= 2 ? { ...base, ...extra, forma, partes: p } : null;
  };

  // 1. Linhas com marcador (•, -, 1.) ou várias linhas curtas: uma parte por linha.
  const marcadas = linhas.filter((l) => MARCADOR.test(l) || NUMERADA.test(l));
  if (marcadas.length >= 2) {
    const primeira = linhas.indexOf(marcadas[0]);
    const ultima = linhas.indexOf(marcadas[marcadas.length - 1]);
    const partes = linhas.slice(primeira, ultima + 1).map((l) => semPontaFinal(l.replace(MARCADOR, "")));
    return pronto(marcadas.some((l) => NUMERADA.test(l)) ? "passos" : "lista", partes, {
      abertura: primeira > 0 ? linhas.slice(0, primeira).join(" ") : null,
      apoio: ultima < linhas.length - 1 ? linhas.slice(ultima + 1).join(" ") : null,
    });
  }
  if (linhas.length >= 2 && linhas.length <= 6 && linhas.every((l) => contarPalavras(l) <= 12) && palavras >= 10) {
    return pronto(linhas.length === 2 ? "argumentos" : "lista", linhas.map(semPontaFinal));
  }
  if (palavras < 6) return null;

  // 2. Comparação (antes e depois, errado e certo, mito e verdade, vs).
  const comp = comparacaoEmDuas(corpo);
  if (comp) return pronto("comparacao", comp);

  // 3. Passos marcados no texto.
  const passos = passosDoTexto(corpo);
  if (passos) return pronto("passos", passos.partes, { abertura: passos.abertura });

  // 4. Várias frases: a enumeração da primeira vira as partes; senão, uma frase por parte.
  const frases = frasesDoTexto(corpo);
  if (frases.length >= 2) {
    const en = enumeracao(frases[0]);
    if (en) return pronto("lista", en.itens, { abertura: en.abertura, apoio: frases.slice(1).join(" ") });
    if (palavras < 10) return null;
    return pronto(frases.length === 2 ? "argumentos" : "lista", frases);
  }

  // 5. Uma frase só: ponto e vírgula, enumeração ou dois argumentos.
  const frase = frases[0] || corpo;
  const porPontoEVirgula = frase.split(/;\s+/).map(semPontaFinal).filter(Boolean);
  if (porPontoEVirgula.length >= 2) return pronto("lista", porPontoEVirgula);
  const en = enumeracao(frase);
  if (en) return pronto("lista", en.itens, { abertura: en.abertura });
  const dois = doisArgumentos(frase);
  return dois ? pronto("argumentos", dois) : null;
}

/** Unidade de cada parte pelo componente do miolo (R4). */
const UNIDADE_DO_COMPONENTE: Record<string, string> = {
  checklist: "item do checklist",
  cartoes_empilhados: "cartão",
  chips: "etiqueta",
  icones_de_linha: "linha com ícone",
  colunas_comparacao: "coluna",
  cartoes_lado_a_lado: "cartão",
  linha_do_tempo: "passo da linha do tempo",
  caixas_conectadas: "caixa",
};

/** Como as partes se distribuem, pela forma do texto e pela zona do texto. */
export function distribuicaoDasPartes(e: { forma: FormaDasPartes; n: number; zona?: string | null; dividido?: boolean; cenaFixa?: boolean }): string {
  if (e.cenaFixa) return "cada parte na sua linha, com um marcador ou ícone de linha, dentro da área do texto; sem caixa nem painel atrás";
  if (e.dividido) return e.n === 2 ? "as duas lado a lado na faixa de baixo" : "lado a lado (ou em grade 2 x 2) na faixa de baixo";
  if (e.forma === "comparacao") return "uma de cada lado, lado a lado, com a divisão entre elas bem visível";
  if (e.forma === "passos") return "na ordem de leitura, ligadas por um fio ou uma seta fina";
  const z = String(e.zona || "");
  if (z.indexOf("coluna") === 0) return "empilhadas na coluna, uma embaixo da outra, com o mesmo respiro";
  if (z.indexOf("topo") === 0) return "numa fileira (ou grade 2 x 2) logo abaixo do título, na largura útil";
  if (z.indexOf("base") === 0) return "numa fileira (ou grade 2 x 2) na metade de baixo, com o título logo acima";
  return "em grade de 2 colunas, com o título acima";
}

/**
 * Bloco do prompt: o texto dividido em partes curtas, em lugares diferentes
 * da lâmina (nunca um parágrafo único num canto). Só no miolo (lâmina 2 à
 * penúltima) do modo normal; sem partes: vazio.
 */
export function blocoDoTextoEmPartes(e: {
  ordem: number;
  total: number;
  blocos: BlocoDaLamina[];
  componente?: string | null;
  zona?: string | null;
  dividido?: boolean;
  cenaFixa?: boolean;
}): string {
  if (!(e.total >= 3 && e.ordem >= 2 && e.ordem < e.total)) return "";
  const p = dividirEmPartes(e.blocos);
  if (!p) return "";
  const unidade = (e.componente && UNIDADE_DO_COMPONENTE[e.componente]) || "bloco curto (cartão, caixa ou linha com ícone, no sistema do componente acima)";
  const aspas = (t: string) => `"${t.replace(/\n/g, " / ")}"`;
  return [
    `TEXTO EM PARTES (lâmina ${e.ordem} de ${e.total}): o texto desta lâmina não vai num parágrafo único num canto; ele se divide em ${p.partes.length} partes curtas, cada uma no seu lugar da lâmina.`,
    p.titulo ? `- Título: ${aspas(p.titulo)}, no lugar do título da área do texto.` : "",
    p.abertura ? `- Logo abaixo do título, pequena: ${aspas(p.abertura)}.` : "",
    `- Partes, cada uma no seu ${e.cenaFixa ? "lugar" : unidade}, ${distribuicaoDasPartes({ forma: p.forma, n: p.partes.length, zona: e.zona, dividido: e.dividido, cenaFixa: e.cenaFixa })}: ${p.partes.map((x, i) => `${i + 1}) ${aspas(x)}`).join(" ")}.`,
    p.apoio ? `- Fechando o grupo, pequeno: ${aspas(p.apoio)}.` : "",
    "- Cada parte é exatamente o trecho indicado: a divisão não reescreve, não junta partes e não acrescenta rótulo nem número; o texto exato continua o mesmo.",
    "- Isto vale sobre \"todos os blocos no mesmo eixo\": o título segue o eixo da área do texto e as partes se distribuem como descrito, com o mesmo respiro entre elas.",
  ].filter(Boolean).join("\n");
}

/** O que a versão guarda da divisão (só com partes). */
export function registroDasPartes(blocos: BlocoDaLamina[]): { forma: FormaDasPartes; partes: number } | null {
  const p = dividirEmPartes(blocos);
  return p ? { forma: p.forma, partes: p.partes.length } : null;
}

// ------------------------------------------------------------------ dividir em 2 lâminas (com confirmação)

export const MAX_LAMINAS = 20;

export type SugestaoDeDivisao = { ordem: number; primeira: string; segunda: string };

/**
 * A lâmina não cabe e tem mais de uma ideia: sugere dividir em 2 (a 1ª fica
 * com o título e a primeira metade; a nova, com o resto). Capa, estático,
 * texto dentro do limite ou de uma ideia só: null. No fechamento, o CTA vai
 * para a lâmina nova (que passa a ser a última).
 */
export function sugestaoDeDividirEmDuas(c: LaminaDoTexto, total: number): SugestaoDeDivisao | null {
  const papel = papelNaGeracao(c.ordem, total, c.funcao);
  if (papel === "capa" || papel === "estatico" || total >= MAX_LAMINAS) return null;
  if (!passaNaGeracao(c, total)) return null;
  const blocos = blocosDaLamina(c);
  const tituloBloco = blocos.filter((b) => b.papel === "headline" || b.papel === "numero")[0];
  const corpo = blocos.filter((b) => b !== tituloBloco && (b.papel === "apoio" || b.papel === "subtitulo")).map((b) => b.texto).join("\n");
  const cta = blocos.filter((b) => b.papel === "cta").map((b) => b.texto);
  const selo = blocos.filter((b) => b.papel === "selo").map((b) => b.texto);
  let unidades = frasesDoTexto(corpo);
  if (unidades.length < 2) {
    const p = dividirEmPartes(blocos.filter((b) => b.papel !== "cta" && b.papel !== "selo"));
    unidades = p ? [p.abertura || "", ...p.partes, p.apoio || ""].filter(Boolean) : [];
  }
  if (unidades.length < 2) return null;
  const pesos = unidades.map((u) => contarPalavras(u));
  const soma = pesos.reduce((s, n) => s + n, 0);
  let k = 1;
  let melhor = Infinity;
  let acumulado = 0;
  for (let i = 1; i < unidades.length; i++) {
    acumulado += pesos[i - 1];
    const d = Math.abs(acumulado - (soma - acumulado));
    if (d < melhor) {
      melhor = d;
      k = i;
    }
  }
  const primeiraParte = unidades.slice(0, k).join(" ");
  const segundaParte = unidades.slice(k);
  const fechamento = papel === "fechamento";
  const primeira = [tituloBloco ? tituloBloco.texto : "", primeiraParte, ...selo, ...(fechamento ? [] : cta)].filter(Boolean).join("\n");
  const segunda = [segundaParte[0], segundaParte.slice(1).join(" "), ...(fechamento ? cta : [])].filter(Boolean).join("\n");
  if (!primeira.trim() || !segunda.trim()) return null;
  return { ordem: c.ordem, primeira, segunda };
}

/** Frase do aviso depois de preparar: as lâminas que ainda passam e dá para dividir. */
export function textoDaSugestaoDeDividir(ordens: unknown): string | null {
  const lista = Array.isArray(ordens) ? (ordens.filter((n) => typeof n === "number") as number[]) : [];
  if (!lista.length) return null;
  const nomes = lista.length === 1 ? `Lâmina ${lista[0]}` : `Lâminas ${lista.slice(0, -1).join(", ")} e ${lista[lista.length - 1]}`;
  return `${nomes}: dá para dividir em 2 (ferramenta Lâmina).`;
}

type CardComOrdem = LaminaDoTexto & { layout?: unknown; ilustracao?: string; composicao?: string; prompt_imagem?: string; [k: string]: unknown };
type VersaoComOrdem = { ordem: number; versao: number; [k: string]: unknown };
export type TrabalhoParaDividir = {
  direcao: { cards: CardComOrdem[]; carrossel_infinito?: boolean; versoes_arquivadas?: VersaoComOrdem[]; [k: string]: unknown };
  cards: VersaoComOrdem[];
};

/** O que a lâmina dividida guarda para o Desfazer (juntar de novo). */
export type MarcaDaDivisao = { em: number; original: string; blocos_original: BlocoDaLamina[] | null; funcao_original: string | null; texto_a: string; texto_b: string };

export type DepsDaDivisao = {
  blocosDe: (texto: string, funcao: string) => BlocoDaLamina[];
  /** Layout da lâmina nova pela função e posição (layoutPadrao), já com o tratamento da lâmina de origem. */
  layoutDe: (funcao: string, ordem: number, total: number, origem: CardComOrdem) => { layout: unknown; composicao: string; ilustracao: string };
};

const ordemMais = <T extends { ordem: number }>(x: T, depoisDe: number, delta: number): T => (x.ordem > depoisDe ? { ...x, ordem: x.ordem + delta } : x);

/**
 * Divide a lâmina `ordem` em duas (puro: devolve o patch). As lâminas depois
 * dela andam uma posição, com as versões e as arquivadas. Lança com o motivo
 * quando não dá (contínuo, 20 lâminas, sem sugestão).
 */
export function dividirLaminaEmDuas(t: TrabalhoParaDividir, ordem: number, deps: DepsDaDivisao): { patch: { direcao: TrabalhoParaDividir["direcao"]; cards: VersaoComOrdem[] }; nova: number } {
  const cards = t.direcao.cards.slice().sort((a, b) => a.ordem - b.ordem);
  const total = cards.length;
  if (t.direcao.carrossel_infinito && total > 1) throw new Error("No carrossel contínuo a cena atravessa as lâminas: não dá para dividir.");
  if (total >= MAX_LAMINAS) throw new Error(`O carrossel já tem ${MAX_LAMINAS} lâminas, o máximo.`);
  const card = cards.find((c) => c.ordem === ordem);
  if (!card) throw new Error(`A lâmina ${ordem} não existe mais.`);
  const s = sugestaoDeDividirEmDuas(card, total);
  if (!s) throw new Error("Esta lâmina não tem como dividir: o texto cabe ou é uma ideia só.");
  const novoTotal = total + 1;
  const eraFechamento = papelNaGeracao(ordem, total, card.funcao) === "fechamento";
  const funcaoA = eraFechamento ? "conteudo" : String(card.funcao || "conteudo");
  const funcaoB = eraFechamento ? "cta" : "conteudo";
  const marca: MarcaDaDivisao = {
    em: ordem + 1,
    original: String(card.texto_exato || ""),
    blocos_original: card.blocos && card.blocos.length ? card.blocos : null,
    funcao_original: card.funcao ? String(card.funcao) : null,
    texto_a: s.primeira,
    texto_b: s.segunda,
  };
  const a: CardComOrdem = { ...card, funcao: funcaoA, texto_exato: s.primeira, blocos: deps.blocosDe(s.primeira, funcaoA), dividida: marca };
  delete a.texto_na_geracao;
  const l = deps.layoutDe(funcaoB, ordem + 1, novoTotal, card);
  const b: CardComOrdem = {
    ordem: ordem + 1,
    funcao: funcaoB,
    texto_exato: s.segunda,
    blocos: deps.blocosDe(s.segunda, funcaoB),
    layout: l.layout,
    composicao: l.composicao,
    ilustracao: l.ilustracao,
    prompt_imagem: "",
    dividida_de: ordem,
  };
  const novos = cards.map((c) => (c.ordem === ordem ? a : ordemMais(c, ordem, 1)));
  novos.push(b);
  novos.sort((x, y) => x.ordem - y.ordem);
  const arquivadas = Array.isArray(t.direcao.versoes_arquivadas) ? t.direcao.versoes_arquivadas.map((v) => ordemMais(v, ordem, 1)) : undefined;
  return {
    patch: {
      direcao: { ...t.direcao, cards: novos, ...(arquivadas ? { versoes_arquivadas: arquivadas } : {}) },
      cards: t.cards.map((v) => ordemMais(v, ordem, 1)),
    },
    nova: ordem + 1,
  };
}

/**
 * Desfazer da divisão: junta de novo a lâmina `ordem` e a seguinte (a nova),
 * enquanto a nova não tem arte e os dois textos são os da divisão.
 */
export function juntarLaminas(t: TrabalhoParaDividir, ordem: number, deps: Pick<DepsDaDivisao, "blocosDe">): { patch: { direcao: TrabalhoParaDividir["direcao"]; cards: VersaoComOrdem[] } } {
  const cards = t.direcao.cards.slice().sort((x, y) => x.ordem - y.ordem);
  const a = cards.find((c) => c.ordem === ordem);
  const b = cards.find((c) => c.ordem === ordem + 1);
  const marca = a && a.dividida && typeof a.dividida === "object" ? a.dividida as MarcaDaDivisao : null;
  if (!a || !b || !marca || marca.em !== ordem + 1 || b.dividida_de !== ordem) throw new Error("As lâminas mudaram depois da divisão. Ajuste pela tela.");
  if (t.cards.some((v) => v.ordem === ordem + 1)) throw new Error(`A lâmina ${ordem + 1} já tem arte: apague ou mantenha pela tela.`);
  if (String(a.texto_exato || "").trim() !== marca.texto_a.trim() || String(b.texto_exato || "").trim() !== marca.texto_b.trim()) {
    throw new Error("O texto das lâminas mudou depois da divisão. Ajuste pela tela.");
  }
  const funcao = marca.funcao_original || String(a.funcao || "conteudo");
  const volta: CardComOrdem = { ...a, funcao, texto_exato: marca.original, blocos: marca.blocos_original || deps.blocosDe(marca.original, funcao) };
  delete volta.dividida;
  const novos = cards.filter((c) => c !== b).map((c) => (c.ordem === ordem ? volta : ordemMais(c, ordem + 1, -1)));
  const arquivadas = Array.isArray(t.direcao.versoes_arquivadas) ? t.direcao.versoes_arquivadas.map((v) => ordemMais(v, ordem + 1, -1)) : undefined;
  return {
    patch: {
      direcao: { ...t.direcao, cards: novos, ...(arquivadas ? { versoes_arquivadas: arquivadas } : {}) },
      cards: t.cards.map((v) => ordemMais(v, ordem + 1, -1)),
    },
  };
}
