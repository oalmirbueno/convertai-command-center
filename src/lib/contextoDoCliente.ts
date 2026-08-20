/**
 * Como a Central lê o contexto que foi escrito sobre um cliente.
 *
 * O dossiê é gravado em `project_memory` pela rotina do GPT com milhares de
 * caracteres de substância, e a Central mostrava o TÍTULO dele — que é um
 * rótulo com data, "Dossiê de contexto - 18/08/2026", praticamente igual em
 * toda versão. O efeito para quem usa: atualizava o dossiê, puxava na tela e
 * parecia que nada tinha mudado. O dado estava certo no banco o tempo todo;
 * quem estava errado era a leitura.
 */

export interface EntradaDeContexto {
  kind?: string | null;
  title?: string | null;
  content?: string | null;
  source?: string | null;
  created_at?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Os tipos de registro que contam história do cliente. */
export const CONTEXTO_KINDS = new Set([
  "decisao", "nota", "marco", "note", "summary", "decision", "fact", "second_brain", "external",
]);

/** Um título que é só rótulo com data, sem informação dentro. */
function ehRotulo(titulo: string): boolean {
  return /^(dossi[êe]|contexto|resumo|atualiza[çc][ãa]o)\b/i.test(titulo.trim());
}

/**
 * Primeira linha só com um cabeçalho de seção ("ONDE ESTAMOS") não informa
 * nada sozinha: entra junto do parágrafo que vem depois.
 */
function ehCabecalho(linha: string): boolean {
  const limpa = linha.trim();
  return limpa.length > 0 && limpa.length <= 40 && limpa === limpa.toUpperCase();
}

/* ──────────────────── O que, no dossiê, vale a pena contar ───────────────── */

/**
 * Cabeçalhos que anunciam a SITUAÇÃO do cliente.
 *
 * Todo dossiê que a rotina do GPT escreve tem uma seção assim, e é a única
 * parte que interessa a quem vai receber a mensagem. O que vem antes é
 * aparato: título, data, fontes consultadas, regras de leitura.
 */
const SECAO_DE_SITUACAO =
  /^#*\s*(onde estamos|status atual|situa[çc][ãa]o atual|situa[çc][ãa]o|status|resumo|panorama)\s*:?\s*$/i;

/**
 * Linhas que são ficha técnica, não informação.
 *
 * `Client ID:` e `Project ID:` são o caso grave: identificadores internos que
 * chegariam ao cliente numa mensagem de WhatsApp se o texto fosse cortado
 * cru pelos primeiros caracteres.
 */
const LINHA_DE_FICHA =
  /^(#*\s*)?(dossi[êe] de contexto|fontes? consultadas?|data( da atualiza[çc][ãa]o)?|cliente|marca|unidade|natureza|projeto|client id|project id|fonte principal|complemento|regra de leitura|atualiza[çc][ãa]o de)\b.*$/i;

/** Qualquer coisa com cara de identificador não sai do painel. */
const TEM_IDENTIFICADOR =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Corta no fim de uma frase, nunca no meio de uma palavra. */
function ateOFimDaFrase(texto: string, limite: number): string {
  if (texto.length <= limite) return texto;
  const pedaco = texto.slice(0, limite + 1);
  const fim = Math.max(
    pedaco.lastIndexOf(". "),
    pedaco.lastIndexOf("; "),
    pedaco.lastIndexOf("! "),
    pedaco.lastIndexOf("? "),
  );
  // Sem frase inteira que caiba, recua até o último espaço: melhor curto e
  // legível do que uma palavra partida ao meio.
  if (fim > limite * 0.4) return pedaco.slice(0, fim + 1).trim();
  const espaco = pedaco.lastIndexOf(" ");
  return `${pedaco.slice(0, espaco > 0 ? espaco : limite).trim()}…`;
}

/* ───────────────── Vida real: o que o negócio sente, não o painel ────────── */

/**
 * Pedaços de frase que são contabilidade interna, não vida do negócio.
 *
 * O dossiê é escrito para o DONO da operação, então mistura as duas coisas na
 * mesma frase: "o projeto está ativo, com 70% de progresso registrado e fase
 * de lançamento no método do painel". O cliente não mede a vida dele em
 * porcentagem de painel — remove-se a oração interna e a frase continua de
 * pé com o que é real: "o projeto está ativo".
 */
const ORACOES_INTERNAS: RegExp[] = [
  /,?\s*(e\s+)?com \d+\s*%[^,.;]*/gi,
  /,?\s*(e\s+)?\d+\s*% de progresso[^,.;]*/gi,
  /,?\s*(e\s+)?(em\s+)?fase de [^,.;]* (no\s+)?m[ée]todo[^,.;]*/gi,
  /,?\s*(e\s+)?o ciclo [^,.;]*\d\s*(\/|de)\s*\d[^,.;]*/gi,
  /,?\s*(e\s+)?registrad[oa] no painel[^,.;]*/gi,
  /\s+no painel\b/gi,
  /\s+do painel\b/gi,
];

/**
 * Frases que, mesmo depois da limpeza, seguem sendo bastidor puro.
 *
 * "A semana de Tráfego Pago de 17/08 está fechada em 6 de 6 etapas" não tem
 * metade aproveitável: o assunto inteiro é o checklist. Sai a frase toda.
 */
// As fronteiras (\b) importam: sem elas, "6/6" também casa com o meio de
// uma DATA ("20/08" tem dígito-barra-dígito), e frases legítimas com data
// sumiam da mensagem.
const FRASE_INTERNA =
  /\b\d\s*(\/|de)\s*\d\b\s*(etapas?)?(?!\d)|\bm[ée]todo\b|\bkanban\b|\bbacklog\b|\b\d+\s+tarefas?\b|\bchecklist\b|\bprogresso\b/i;

/** Divide em frases sem perder as datas ("23/07/2026" tem pontos? não — barras). */
function emFrases(texto: string): string[] {
  return texto
    .split(/(?<=[.;!?])\s+/)
    .map((f) => f.trim())
    .filter(Boolean);
}

/**
 * Reduz um trecho de dossiê ao que é vida real do negócio.
 *
 * Duas passadas: primeiro remove a ORAÇÃO interna de dentro da frase (a
 * porcentagem, a fase do método), depois descarta a FRASE que continua sendo
 * bastidor por inteiro. O que sobra é o que o cliente sente: site no ar,
 * mídia ainda não ativada, decisão aprovada, material criado.
 */
export function soVidaReal(texto: string): string {
  const frases = emFrases(texto)
    .map((frase) => {
      let limpa = frase;
      for (const padrao of ORACOES_INTERNAS) limpa = limpa.replace(padrao, "");
      return limpa.replace(/\s{2,}/g, " ").replace(/\s+([,.;])/g, "$1").trim();
    })
    .filter((frase) => frase.length > 8 && !FRASE_INTERNA.test(frase));
  return frases.join(" ").trim();
}

/** Cabeçalhos que anunciam o que vem pela frente. */
const SECAO_DE_FUTURO =
  /^#*\s*(pr[óo]ximos? passos?|o que vem( agora| por a[íi])?|pr[óo]xima semana|planos?|foco da semana)\s*:?\s*$/i;

/**
 * O que o dossiê promete para a frente, em vida real.
 *
 * É a metade que faltava: a situação diz onde o negócio está; esta diz o que
 * o cliente pode ESPERAR — e expectativa dita é o que segura confiança entre
 * uma mensagem e outra.
 */
export function oQueEsperarDoDossie(conteudo: string, limite = 240): string {
  const linhas = String(conteudo || "").split("\n").map((l) => l.trim());
  const inicio = linhas.findIndex((l) => SECAO_DE_FUTURO.test(l));
  if (inicio < 0) return "";

  const prosa: string[] = [];
  for (const linha of linhas.slice(inicio + 1)) {
    if (linha.length === 0) continue;
    if (/^#+\s/.test(linha) || (linha === linha.toUpperCase() && linha.length <= 40)) break;
    if (LINHA_DE_FICHA.test(linha) || TEM_IDENTIFICADOR.test(linha)) continue;
    // Lista vira prosa: "- Ativar a mídia" -> "Ativar a mídia".
    prosa.push(linha.replace(/^[-•*]\s*/, ""));
  }
  const texto = soVidaReal(prosa.join(" ").replace(/\s+/g, " ").trim());
  return texto ? ateOFimDaFrase(texto, limite) : "";
}

/**
 * O que o dossiê diz sobre a situação do cliente, em prosa que se lê.
 *
 * Pegar os primeiros caracteres dava, nos textos reais, o cabeçalho: "FONTES
 * CONSULTADAS Painel Aceleriq: cadastro, projetos, dossiê completo…" — o
 * cliente recebendo a lista de fontes que a IA consultou, cortada no meio de
 * uma palavra. Aqui a leitura procura a seção de situação, pula a ficha
 * técnica e corta no fim de uma frase.
 */
export function resumoDoDossie(conteudo: string, limite = 320): string {
  const linhas = String(conteudo || "")
    .split("\n")
    .map((l) => l.trim());

  const inicio = linhas.findIndex((l) => SECAO_DE_SITUACAO.test(l));
  const corpo = inicio >= 0 ? linhas.slice(inicio + 1) : linhas;

  const prosa: string[] = [];
  for (const linha of corpo) {
    if (linha.length === 0) continue;
    // Cabeçalho da PRÓXIMA seção encerra o trecho: misturar seções produz
    // exatamente o texto confuso que se quer evitar.
    if (prosa.length > 0 && (/^#+\s/.test(linha) || (linha === linha.toUpperCase() && linha.length <= 40))) break;
    if (LINHA_DE_FICHA.test(linha)) continue;
    if (TEM_IDENTIFICADOR.test(linha)) continue;
    if (/^#+\s/.test(linha)) continue;
    if (linha === linha.toUpperCase() && linha.length <= 40) continue;
    prosa.push(linha);
  }

  // O dossiê fala com o dono; o cliente recebe só a vida real do negócio.
  const texto = soVidaReal(prosa.join(" ").replace(/\s+/g, " ").trim());
  return texto ? ateOFimDaFrase(texto, limite) : "";
}


/**
 * O trecho que representa a entrada na tela.
 *
 * Prefere o CORPO quando ele tem mais substância que o título. Para uma nota
 * curta o título é a informação; para um dossiê o título é etiqueta e o corpo
 * é tudo. A regra decide por tamanho em vez de por tipo, então serve para os
 * dois sem lista de exceção para manter.
 */
export function trechoDoContexto(entrada: EntradaDeContexto, limite = 160): string {
  const titulo = String(entrada.title || "").trim();
  const corpo = String(entrada.content || "").trim();

  const usarCorpo = corpo.length > titulo.length || (titulo.length > 0 && ehRotulo(titulo));
  const bruto = usarCorpo && corpo.length > 0 ? corpo : titulo;
  if (!bruto) return "";

  // Texto com secoes -- o formato que a rotina do GPT escreve -- tem leitura
  // propria: ela acha a situacao e pula a ficha tecnica.
  const resumo = usarCorpo ? resumoDoDossie(bruto, limite) : "";
  if (resumo) return resumo;

  const linhas = bruto.split("\n").map((l) => l.trim()).filter(Boolean);
  // O cabeçalho sozinho não vira o trecho inteiro; ele acompanha o texto.
  const comeco = linhas.length > 1 && ehCabecalho(linhas[0]) ? linhas.slice(1) : linhas;
  const texto = comeco.join(" ").replace(/\s+/g, " ").trim();
  return ateOFimDaFrase(texto, limite);
}

/**
 * O dossiê mais recente do cliente.
 *
 * Sem janela de dias: um dossiê de três semanas atrás continua sendo o que se
 * sabe sobre o cliente. Esconder por idade deixaria a tela vazia justamente
 * quando o contexto é mais necessário — a tela diz a idade e quem lê decide.
 */
export function dossieMaisRecente<T extends EntradaDeContexto>(entradas: T[]): T | null {
  const candidatos = (entradas || []).filter(
    (e) => CONTEXTO_KINDS.has(String(e.kind || "")) && String(e.content || "").trim().length > 0,
  );
  if (candidatos.length === 0) return null;
  return candidatos.reduce((melhor, atual) =>
    new Date(atual.created_at || 0).getTime() > new Date(melhor.created_at || 0).getTime()
      ? atual
      : melhor,
  );
}

/** "hoje", "ontem", "há 3 dias" — a idade dita como quem fala. */
export function idadeEmPalavras(iso?: string | null, agora: Date = new Date()): string {
  if (!iso) return "";
  const quando = new Date(iso);
  if (Number.isNaN(quando.getTime())) return "";
  const dias = Math.floor((agora.getTime() - quando.getTime()) / 86400000);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  if (dias < 30) return `há ${dias} dias`;
  const meses = Math.floor(dias / 30);
  return meses === 1 ? "há 1 mês" : `há ${meses} meses`;
}
