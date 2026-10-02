import type { PalavraNaLinha } from "../transcricao";

/**
 * Palavras-chave da fala (02/10, auditoria: "não é inteligente, é genérico").
 * Regra FIXA do código, sem modelo: o que a pessoa disse e merece ênfase na
 * edição (punch-in, cartão de palavra, título do gancho):
 * - sigla dita (INSS, CDI, FGTS): peso alto;
 * - número dito (em algarismo ou por extenso);
 * - termo longo e específico (8 letras ou mais, fora da lista de palavras
 *   comuns) e palavra de peso (nunca, segredo, direito, grátis...);
 * - trechos de até 3 palavras de conteúdo seguidas, sem pausa no meio
 *   ("incapacidade temporária", "mesmo salário").
 * Só junta e pesa o que foi DITO: nada é inventado nem resumido.
 */

const PARADAS = new Set(
  (
    "a o as os um uma uns umas de da do das dos em no na nos nas num numa por pelo pela pelos pelas para pra pro com sem sob sobre " +
    "e ou mas que se como quando onde porque pois entao então também tambem já ja não nao sim só so muito muita muitos muitas mais menos " +
    "eu tu ele ela nós nos vós eles elas você voce vocês voces me te lhe nos vos se meu minha teu tua seu sua nosso nossa esse essa este esta " +
    "isso isto aquele aquela aquilo esses essas estes estas aí ai aqui ali lá la cada tudo todo toda todos todas nada algo alguém alguem " +
    "é e foi ser estar está esta estão estao era são sao tem têm tinha ter há ha vai vou pode podem precisa precisam faz fazer fica ficou " +
    "agora hoje bem mal ainda até ate depois antes sempre nunca quem qual quais quanto ao aos à às olha tipo coisa coisas gente demais " +
    "sabia sabe saber pense pensa vamos vai deixa salva salve"
  ).split(" "),
);

const DE_PESO = /^(nunca|jamais|segredo|erro|errad|direito|direitos|garantid|grátis|gratis|proibid|obrigatóri|obrigatori|importante|principal|problema|cuidado|atenção|atencao|urgente|dobr|triplic|metade|zero)/;
const POR_EXTENSO = /^(dois|duas|três|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|quinze|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|duzentos|trezentos|mil|milhão|milhao|milhões|milhoes|bilhão|bilhao)$/;

export const limparPalavra = (t: string) => String(t || "").replace(/^[^0-9A-Za-zÀ-ÿ]+|[^0-9A-Za-zÀ-ÿ%-]+$/g, "");
const normal = (t: string) =>
  limparPalavra(t)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export type MotivoDaChave = "sigla" | "numero" | "peso" | "termo";

export interface TrechoChave {
  texto: string;
  i: number;
  f: number;
  peso: number;
  motivo: MotivoDaChave;
  /** Índice da primeira palavra na fala. */
  k: number;
  palavras: number;
}

/** Peso de uma palavra sozinha (0 = não é chave). */
export function pesoDaPalavra(t: string): { peso: number; motivo: MotivoDaChave | null } {
  const limpa = limparPalavra(t);
  const n = normal(t);
  if (!n) return { peso: 0, motivo: null };
  if (/^[A-ZÀ-Ý]{2,6}$/.test(limpa) && !/^(EU|OK|AI|AÍ|É)$/.test(limpa)) return { peso: 3, motivo: "sigla" };
  if (/\d/.test(n) || POR_EXTENSO.test(n)) return { peso: 2.5, motivo: "numero" };
  if (DE_PESO.test(n)) return { peso: 2, motivo: "peso" };
  if (PARADAS.has(n)) return { peso: 0, motivo: null };
  // Termo: quanto mais longo e específico, mais peso (salário 0,92; diagnóstico 1,4; previdenciários 2).
  if (n.length >= 6) return { peso: Math.min(2, Math.round((0.8 + (n.length - 6) * 0.12 + (n.indexOf("-") > 0 ? 0.5 : 0)) * 100) / 100), motivo: "termo" };
  if (n.length >= 4) return { peso: 0.4, motivo: "termo" };
  return { peso: 0, motivo: null };
}

/**
 * Trechos-chave da fala na linha do tempo, na ordem em que foram ditos.
 * `pausaQuebra`: pausa que separa dois trechos.
 */
export function trechosChave(fala: PalavraNaLinha[], pausaQuebra = 0.25): TrechoChave[] {
  const saida: TrechoChave[] = [];
  let k = 0;
  while (k < fala.length) {
    const p0 = pesoDaPalavra(fala[k].t);
    if (p0.peso <= 0) {
      k++;
      continue;
    }
    let j = k;
    let soma = p0.peso;
    let maior = p0.peso;
    let motivo = p0.motivo as MotivoDaChave;
    while (j + 1 < fala.length && j + 1 - k < 3) {
      const prox = pesoDaPalavra(fala[j + 1].t);
      if (prox.peso <= 0 || fala[j + 1].i - fala[j].f > pausaQuebra) break;
      // Sigla e número ficam sozinhos (o cartão fica forte); o termo junta com o vizinho de conteúdo.
      if (p0.motivo === "sigla" || prox.motivo === "sigla") break;
      j++;
      soma += prox.peso;
      if (prox.peso > maior) {
        maior = prox.peso;
        motivo = prox.motivo as MotivoDaChave;
      }
    }
    const peso = Math.round((maior + 0.3 * (soma - maior)) * 100) / 100;
    // Trecho só de palavra fraca (curta, sem vizinho forte) não é chave.
    if (maior >= 0.9 && peso >= 1) {
      const texto = fala
        .slice(k, j + 1)
        .map((w) => limparPalavra(w.t))
        .join(" ");
      saida.push({ texto, i: fala[k].i, f: fala[j].f, peso, motivo, k, palavras: j - k + 1 });
    }
    k = j + 1;
  }
  return saida;
}

/** Os melhores trechos com espaço mínimo entre eles (das mais fortes para as menos), devolvidos na ordem do tempo. */
export function melhoresTrechos(trechos: TrechoChave[], o: { espaco_s: number; maximo: number; fora?: { de: number; ate: number }[] }): TrechoChave[] {
  const escolhidos: TrechoChave[] = [];
  trechos
    .slice()
    .sort((a, b) => b.peso - a.peso || a.i - b.i)
    .forEach((t) => {
      if (escolhidos.length >= o.maximo) return;
      if ((o.fora || []).some((x) => t.i < x.ate && t.f > x.de)) return;
      if (escolhidos.some((x) => Math.abs(x.i - t.i) < o.espaco_s)) return;
      escolhidos.push(t);
    });
  return escolhidos.sort((a, b) => a.i - b.i);
}

/** Pergunta dita (o gancho clássico): pela pontuação ou pelo jeito de começar. */
export const ehPergunta = (texto: string) => /\?/.test(texto) || /^(voc[eê] sabia|sabia que|j[aá] pensou|voc[eê] j[aá]|por que|porque será|como |o que |quem |quanto|qual |quais |sera que|será que)/i.test(String(texto || "").trim());

/** Chamada para ação dita no fim (salva, comenta, segue, compartilha, manda, clica). */
const VERBOS_DE_CHAMADA: { re: RegExp; botao: string }[] = [
  { re: /^salv[ae]/, botao: "Salvar" },
  { re: /^coment[ae]/, botao: "Comentar" },
  { re: /^sig[ae]|^segue/, botao: "Seguir" },
  { re: /^compartilh[ae]/, botao: "Compartilhar" },
  { re: /^mand[ae]|^envi[ae]/, botao: "Enviar" },
  { re: /^cliq?u?[ae]|^clica/, botao: "Clicar no link" },
  { re: /^cham[ae]/, botao: "Chamar no direct" },
];

export function chamadaDaFrase(texto: string): { botao: string } | null {
  const palavras = String(texto || "")
    .split(/\s+/)
    .map(normal)
    .filter(Boolean)
    .slice(0, 4);
  for (const w of palavras) for (const v of VERBOS_DE_CHAMADA) if (v.re.test(w)) return { botao: v.botao };
  return null;
}
