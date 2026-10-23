/**
 * Ângulo, molde e Dia Prioritário no escritor dos rituais (23/10/2026, dono: "as mensagens estão muito
 * ruins, muito repetitivas e sem o contexto; melhore a inteligência e o motor, mas mantenha rápido").
 *
 * O que estava errado (mensagens de 21/10, 12 clientes): o prompt ditava a estrutura linha a linha e
 * dava as frases prontas, então todo cliente recebia o mesmo esqueleto ("Boa tarde, X. Na segunda
 * combinamos... Nos anúncios, de 15 a 21/10, N contatos contra M... A semana foi pior; a gente vai
 * ajustar... Até sexta, a gente..."), com termos de bastidor ("conferência de validade", "data útil").
 *
 * Agora, sem nenhuma chamada a mais de IA:
 * - o código escolhe o ÂNGULO de abertura de cada versão, girando por cliente, semana e ritual, para
 *   dois clientes no mesmo dia e o mesmo cliente em dias seguidos não receberem o mesmo esqueleto;
 * - as fórmulas de molde e os termos de bastidor são contados e tiram pontos na escolha da versão;
 * - o Dia Prioritário confirmado do cliente entra no contexto (só confirmado: o provisório é interno).
 *
 * Puro (sem Deno nem npm): a função e os testes leem o mesmo arquivo. Sem lookbehind (Safari 11).
 */

export const ANGULOS_DO_RITUAL: readonly string[] = [
  "pelo resultado mais concreto para o negócio desde a última mensagem (uma venda, um pedido de orçamento, uma conversa, uma peça que as pessoas responderam), contado como acontecimento, não como relatório",
  "pela peça ou ação que acabou de ir ao ar, dizendo numa frase o que ela faz pelo negócio dele e para quem ela fala",
  "por algo que a gente percebeu nos dados ou nas respostas das pessoas nesta semana (uma observação que ele não sabia) e o que isso muda no plano",
  "pelo próximo passo mais importante e por que ele importa agora; o que andou vem depois, numa frase",
  "pela decisão que a gente tomou nesta semana e o motivo dela, em linguagem de dono",
  "por uma oportunidade que a gente enxergou para o negócio dele, tirada dos fatos (data, sazonalidade, pergunta frequente do público), ligada ao que já está andando",
];

const hash = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

/** Número da semana desde 05/01/2026 (segunda): o giro muda toda semana. */
export function semanaDoAno(agora: Date): number {
  return Math.floor((agora.getTime() - Date.UTC(2026, 0, 5)) / (7 * 24 * 3600 * 1000));
}

const ORDEM_DO_RITUAL: Record<string, number> = { rota_semana: 0, meio_semana: 1, prova_movimento: 2, radar_aceleriq: 3, marco_90: 4 };

/**
 * Os ângulos das versões A e B (sempre diferentes). Gira por cliente, semana e ritual: no mesmo dia
 * cada cliente começa por um ângulo, e o mesmo cliente não repete o ângulo do ritual anterior.
 */
export function angulosDasVersoes(clientId: string, ritual: string, agora: Date): [string, string] {
  const n = ANGULOS_DO_RITUAL.length;
  const i = (hash(clientId) + semanaDoAno(agora) * 3 + (ORDEM_DO_RITUAL[ritual] ?? 0)) % n;
  return [ANGULOS_DO_RITUAL[i], ANGULOS_DO_RITUAL[(i + 2) % n]];
}

export function instrucaoDoAngulo(angulo: string, versao: "A" | "B"): string {
  return `${versao === "B" ? "VERSÃO B. " : ""}ÂNGULO DESTA MENSAGEM: abra ${angulo}. Depois do cumprimento, a primeira frase já é esse ângulo, com palavras suas (nada de "Na segunda combinamos", "Como combinamos" nem retomada burocrática). Se os fatos não sustentarem esse ângulo, use o fato novo mais forte, mas nunca o esqueleto das mensagens do bloco JÁ DITO.`;
}

/** Fórmulas de molde que deixaram as mensagens iguais (21/10) e termos de bastidor que o dono não entende. */
export const FORMULAS_DE_MOLDE: ReadonlyArray<[RegExp, string]> = [
  [/\bna (segunda|quarta|sexta)(-feira)?,? (a gente )?(combinamos|combinou|prometemos|prometeu)\b/i, "abre retomando \"na segunda combinamos\""],
  [/\bcomo (a gente )?combinamos\b/i, "\"como combinamos\""],
  [/\ba semana foi (pior|melhor|mais fraca|mais forte)\b/i, "\"a semana foi pior/melhor\""],
  [/\bat[ée] (sexta|quinta|quarta|segunda)(-feira)?,? a gente\b/i, "\"até sexta, a gente\""],
  [/\b(de|entre) \d{1,2}(\/\d{1,2})? (a|e) \d{1,2}\/\d{1,2},? (os|nos) an[úu]ncios\b|\bnos an[úu]ncios,? (de|entre) \d{1,2}/i, "número dos anúncios no mesmo formato de sempre"],
  [/\bconfer[êe]ncia d[aeo]s?\b|\bconferir a configura[çc][ãa]o\b/i, "\"conferência\" (bastidor)"],
  [/\b(data|dia)s? [úu]t(il|eis)\b/i, "\"data útil\" (bastidor)"],
  [/\bvalidade\b/i, "\"validade\" (bastidor)"],
  [/\bconsolid(ar|a|amos|ando)\b/i, "\"consolidar\" (jargão)"],
  [/\bestrutura(r|ndo|mos) a forma\b|\bregistrar a an[áa]lise\b/i, "frase de bastidor"],
  [/\bsegue em (prepara[çc][ãa]o|defini[çc][ãa]o)\b|\best[áa] em prepara[çc][ãa]o\b/i, "\"segue em preparação\" (sem conteúdo)"],
];

export function formulasDeMolde(texto: string): string[] {
  const t = String(texto ?? "");
  return FORMULAS_DE_MOLDE.filter(([re]) => re.test(t)).map(([, nome]) => nome);
}

// ------------------------------------------------------------------ Dia Prioritário

const NOMES_DO_DIA = ["", "segunda", "terça", "quarta", "quinta", "sexta"];

/** Dia da semana em São Paulo (1 = segunda ... 7 = domingo). */
export function diaDaSemanaEmSaoPaulo(agora: Date): number {
  const nome = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(agora);
  return ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<string, number>)[nome] ?? 1;
}

/**
 * O bloco do Dia Prioritário para o escritor. Só o dia CONFIRMADO (o provisório e o "não se aplica"
 * são internos e nunca chegam ao cliente). Diz quando é o próximo e como usar sem virar bordão.
 */
export function blocoDoDiaPrioritario(registro: { dia?: unknown; situacao?: unknown } | null | undefined, agora: Date): string {
  const dia = Number(registro && registro.dia);
  if (!registro || registro.situacao !== "confirmado" || !(dia >= 1 && dia <= 5)) return "";
  const hoje = diaDaSemanaEmSaoPaulo(agora);
  const quando = hoje === dia
    ? "é HOJE"
    : hoje < dia
    ? `é nesta ${NOMES_DO_DIA[dia]}`
    : `é na próxima ${NOMES_DO_DIA[dia]}`;
  return `DIA PRIORITÁRIO DO CLIENTE: toda ${NOMES_DO_DIA[dia]} (o próximo ${quando}). É o dia da semana em que a gente dedica atenção estratégica a ele (conversa, revisão de resultados, próximos passos). Cite em no máximo UMA frase e só quando servir: convidar para trazer um assunto concreto desta mensagem para esse dia, ou dizer o que a gente vai olhar com ele nesse dia. Se uma das mensagens do bloco JÁ DITO já falou do Dia Prioritário, não fale de novo. Nunca troque o dia.`;
}
