/**
 * Acabamento das mensagens dos rituais, garantido por código depois da IA (23/10/2026).
 *
 * O dono: "todas as mensagens têm que ter o HTTPS antes do link; todas têm que falar bom dia, boa tarde,
 * conforme o ritual, e têm que falar que é fechamento da semana, meio da semana ou início da semana; para
 * conferir o restante, tudo no painel". Nas mensagens reais de 09/10 a 23/10 (80 publicadas), nenhuma tinha
 * https, segunda saiu "Boa tarde" às 09:49, quarta saiu "Boa tarde" às 18:30, sexta de 23/10 não disse que
 * era fechamento da semana e algumas abriram com o nome do negócio como se fosse a pessoa.
 *
 * O prompt pede tudo isso; este módulo GARANTE, sem chamada de IA:
 * - todo link com https:// (domínio solto, www. e http:// viram https://; e-mail não é tocado);
 * - saudação pelo horário em São Paulo (antes das 12h bom dia, até 18h boa tarde, depois boa noite);
 * - o momento da semana pelo ritual (segunda início, quarta meio, sexta fechamento; sem ritual, pelo dia);
 * - a última linha leva ao painel do cliente, com https.
 *
 * Idempotente (passar duas vezes dá o mesmo texto). Puro, sem Deno nem npm: a função, a tela (na hora de
 * copiar e de publicar, para a saudação valer o horário do envio) e os testes leem o mesmo arquivo.
 * Sem lookbehind, \p{} nem grupo nomeado (Safari 11).
 */

/** Onde o cliente confere o restante (a mensagem também é publicada ali). */
export const LINK_DO_PAINEL = "https://aceleriq.online/onde-estamos";
export const LINHA_DO_PAINEL = `Para conferir o restante, está tudo no painel: ${LINK_DO_PAINEL}`;

export type MomentoDaSemana = "inicio" | "meio" | "fechamento";

const TZ = "America/Sao_Paulo";

/** Hora (0 a 23) em São Paulo. */
export function horaEmSaoPaulo(agora: Date): number {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hour12: false }).format(agora));
  return Number.isFinite(h) ? h % 24 : agora.getHours();
}

/** Dia da semana em São Paulo (1 = segunda ... 7 = domingo). */
function diaEmSaoPaulo(agora: Date): number {
  const nome = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(agora);
  return ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<string, number>)[nome] ?? 1;
}

/** "Bom dia" até 11:59, "Boa tarde" até 17:59, "Boa noite" depois (e de madrugada). */
export function saudacaoPelaHora(agora: Date): "Bom dia" | "Boa tarde" | "Boa noite" {
  const h = horaEmSaoPaulo(agora);
  if (h >= 5 && h < 12) return "Bom dia";
  if (h >= 12 && h < 18) return "Boa tarde";
  return "Boa noite";
}

const MOMENTO_DO_RITUAL: Record<string, MomentoDaSemana> = {
  rota_semana: "inicio",
  meio_semana: "meio",
  prova_movimento: "fechamento",
};

/**
 * O momento da semana. O ritual manda (segunda = rota, quarta = meio, sexta = prova de movimento); sem ritual
 * da semana conhecido, vale o dia: segunda e terça início, quarta e quinta meio, sexta em diante fechamento.
 * Balanço do mês e marco de 90 dias não são da semana: null.
 */
export function momentoDaSemana(ritual: string | null | undefined, agora: Date): MomentoDaSemana | null {
  if (ritual && MOMENTO_DO_RITUAL[ritual]) return MOMENTO_DO_RITUAL[ritual];
  if (ritual === "radar_aceleriq" || ritual === "marco_90") return null;
  const d = diaEmSaoPaulo(agora);
  return d <= 2 ? "inicio" : d <= 4 ? "meio" : "fechamento";
}

export const NOME_DO_MOMENTO: Record<MomentoDaSemana, string> = {
  inicio: "início da semana",
  meio: "meio da semana",
  fechamento: "fechamento da semana",
};

const SINAIS_DO_MOMENTO: Record<MomentoDaSemana, RegExp> = {
  inicio: /\b(in[ií]cio|come[çc]o|abertura) d[ae] semana\b|\bcome[çc](a|ando|amos|ar) (a|esta|essa|nossa) semana\b|\bsemana come[çc]a\b|\babrindo a semana\b/i,
  meio: /\b(meio|metade) da semana\b/i,
  fechamento: /\bfechamento da semana\b|\bfecha(ndo|mos|r)? (a|esta|essa|nossa) semana\b|\bsemana (fecha|termina)\b|\bencerra(ndo|mos|r)? (a|esta|essa|nossa) semana\b|\b(fim|final) da semana\b/i,
};

export function dizOMomento(texto: string, momento: MomentoDaSemana): boolean {
  return SINAIS_DO_MOMENTO[momento].test(String(texto ?? ""));
}

const FRASES_DO_MOMENTO: Record<MomentoDaSemana, readonly string[]> = {
  inicio: ["Início de semana por aqui.", "Começando a semana com você.", "Abrindo a semana por aqui."],
  meio: ["Meio da semana por aqui.", "Chegamos ao meio da semana.", "Passando no meio da semana."],
  fechamento: ["Fechamento da semana por aqui.", "Fechando a semana com você.", "Hora do fechamento da semana."],
};

const hash = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

// ------------------------------------------------------------------ links

const TLDS = "com|net|org|online|app|io|site|store|shop|art|dev|me|co|info|biz|tv|link|page|blog|adv|med|eng|arq|ind|gov|edu|br";
const RE_LINK = new RegExp(
  `(https?:\\/\\/[^\\s<>"']+)|((?:www\\.)?(?:[a-z0-9][a-z0-9-]*\\.)+(?:${TLDS})\\b(?:\\/[^\\s<>"']*)?)`,
  "gi",
);

/** Pontuação de fim de frase colada no link fica fora dele. */
function separarPontuacao(link: string): [string, string] {
  const m = link.match(/[.,;:!?)\]]+$/);
  return m ? [link.slice(0, link.length - m[0].length), m[0]] : [link, ""];
}

/** Todo link com https:// (http:// sobe para https://; domínio solto e www. ganham o esquema; e-mail não). */
export function linksComHttps(texto: string): string {
  return String(texto ?? "").replace(RE_LINK, (inteiro: string, comEsquema: string | undefined, semEsquema: string | undefined, onde: number, todo: string) => {
    if (comEsquema) return comEsquema.replace(/^http:\/\//i, "https://");
    const antes = onde > 0 ? todo.charAt(onde - 1) : "";
    // Parte de e-mail, de outra palavra ou de um caminho: fica como está.
    if (antes && /[@a-z0-9._\-/]/i.test(antes)) return inteiro;
    const [link, pontuacao] = separarPontuacao(String(semEsquema));
    if (!/\.[a-z]{2,}/i.test(link)) return inteiro;
    return `https://${link}${pontuacao}`;
  });
}

// ------------------------------------------------------------------ saudação

const RE_SAUDACAO = /^(bom dia|boa tarde|boa noite|boa semana|bom fim de semana|[óo]tima semana|ol[áa]|oi)\b(?:,\s*([^.!?\n,]{1,40}?)\s*([.!?]+))?\s*([.!?]+|,)?\s*/i;

const normal = (s: string) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

const maiuscula = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export interface OpcoesDoAcabamento {
  /** rota_semana, meio_semana, prova_movimento, radar_aceleriq, marco_90 (ou vazio: o momento sai do dia). */
  ritual?: string | null;
  /** Horário de referência (o do envio, quando se sabe). Padrão: agora. */
  agora?: Date;
  /** Primeiro nome de quem recebe. undefined = não mexe no nome (só troca a palavra da saudação). */
  contato?: string;
  /** Nome do negócio: nunca vale como nome de pessoa na saudação. */
  negocio?: string;
}

export interface Acabamento {
  texto: string;
  /** O que o código precisou acertar (aviso interno, nunca vai ao cliente). */
  acertos: string[];
}

/** Separa a saudação do resto da primeira linha. */
function cabecaESaudacao(linha: string): { saudacao: string; nome: string; pontuacao: string; resto: string } | null {
  const m = linha.match(RE_SAUDACAO);
  if (!m) return null;
  return { saudacao: m[1], nome: (m[2] || "").trim(), pontuacao: (m[3] || m[4] || "").trim(), resto: linha.slice(m[0].length) };
}

/** Linha (ou trecho final da linha) que manda para o painel: sai, porque o código põe a dele no fim. */
function semFechoDoPainel(linha: string): string {
  if (!/painel/i.test(linha) || !/aceleriq\.online/i.test(linha)) return linha;
  const i = linha.search(/\b(tudo|toda|todo|o detalhe|os detalhes|para conferir|confira|veja|acompanhe|o restante|detalhes)\b[^\n]*\bpainel\b/i);
  return i > 0 ? linha.slice(0, i).trim() : "";
}

/**
 * Aplica as regras fixas: https, saudação pelo horário, momento da semana e a linha do painel no fim.
 * Não inventa conteúdo: só a saudação, uma frase curta do momento (quando faltou) e o link.
 */
export function acabamentoDoRitual(body: string, op: OpcoesDoAcabamento = {}): Acabamento {
  const agora = op.agora ?? new Date();
  const acertos: string[] = [];
  const original = String(body ?? "").replace(/\r\n?/g, "\n").trim();
  if (!original) return { texto: original, acertos };

  // 1) Tira a linha do painel que a IA escreveu (volta no fim, padronizada).
  let linhas = original.split("\n").map((l) => semFechoDoPainel(l));
  while (linhas.length && !linhas[linhas.length - 1].trim()) linhas.pop();
  linhas = linhas.reduce<string[]>((acc, l) => {
    if (!l.trim() && acc.length && !acc[acc.length - 1].trim()) return acc;
    acc.push(l.replace(/[ \t]+$/g, ""));
    return acc;
  }, []);

  // 2) Saudação pelo horário, com o nome certo.
  const certa = saudacaoPelaHora(agora);
  const primeira = linhas.findIndex((l) => l.trim());
  if (primeira >= 0) {
    const linha = linhas[primeira].trim();
    const cab = cabecaESaudacao(linha);
    const contato = op.contato === undefined ? undefined : String(op.contato || "").trim();
    const ehNegocio = (n: string) => !!op.negocio && !!n && normal(n) === normal(op.negocio);
    let nome = "";
    let pontuacao = ".";
    let resto = linha;
    if (cab) {
      nome = cab.nome;
      pontuacao = cab.pontuacao && cab.pontuacao !== "," ? cab.pontuacao.charAt(0) : ".";
      resto = cab.resto;
      if (normal(cab.saudacao) !== normal(certa)) acertos.push(`Saudação trocada para "${certa}" pelo horário.`);
      // "Boa tarde, Jobson, tudo certo?": o nome que ficou no começo do resto volta para a saudação.
      if (!nome && contato) {
        const m = resto.match(/^([^\s,.!?]{2,40})\s*[,.!]\s*/);
        if (m && normal(m[1]) === normal(contato)) {
          nome = contato;
          resto = resto.slice(m[0].length);
        }
      }
    } else {
      acertos.push(`Saudação "${certa}" acrescentada.`);
      // "Luiz, os anúncios..." vira "Boa tarde, Luiz. Os anúncios...".
      if (contato) {
        const m = linha.match(/^([^\s,]{2,40}),\s*/);
        if (m && normal(m[1]) === normal(contato)) resto = linha.slice(m[0].length);
      }
    }
    if (contato !== undefined) {
      if (ehNegocio(nome)) {
        acertos.push("O nome do negócio saiu da saudação (não é o nome da pessoa).");
        nome = contato;
      }
      if (!nome && contato) nome = contato;
    }
    if (!nome && pontuacao === ".") pontuacao = "!";
    const cabeca = `${certa}${nome ? `, ${nome}` : ""}${pontuacao}`;
    linhas[primeira] = resto.trim() ? `${cabeca} ${maiuscula(resto.trim())}` : cabeca;
  }

  // 3) O momento da semana, quando a mensagem não disse.
  const momento = momentoDaSemana(op.ritual, agora);
  if (momento && primeira >= 0 && !dizOMomento(linhas.join("\n"), momento)) {
    const frases = FRASES_DO_MOMENTO[momento];
    const frase = frases[hash(`${op.negocio || ""}|${agora.toISOString().slice(0, 10)}`) % frases.length];
    const linha = linhas[primeira];
    const cab = cabecaESaudacao(linha);
    const cabeca = cab ? linha.slice(0, linha.length - cab.resto.length).trim() : "";
    linhas[primeira] = cab ? `${cabeca} ${frase}${cab.resto.trim() ? ` ${cab.resto.trim()}` : ""}` : `${frase} ${linha}`;
    acertos.push(`"${NOME_DO_MOMENTO[momento]}" acrescentado.`);
  }

  // 4) https em todo link e a linha do painel no fim.
  let texto = linksComHttps(linhas.join("\n").trim());
  texto = `${texto}\n\n${LINHA_DO_PAINEL}`;
  return { texto, acertos };
}

/**
 * Na hora de copiar para o grupo ou publicar (tela): a saudação passa a valer o horário do envio, sem mexer
 * no nome nem no conteúdo. Idempotente.
 */
export function textoNaHoraDoEnvio(body: string, ritual?: string | null, agora: Date = new Date()): string {
  const t = String(body ?? "").trim();
  if (!t) return t;
  return acabamentoDoRitual(t, { ritual: ritual || null, agora }).texto;
}
