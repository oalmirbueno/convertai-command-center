/**
 * Motor de copy da casa (frente CPY, 30/09/2026): um motor só para todas as
 * mesas que escrevem texto. Estrutura por objetivo e canal (uma por variação:
 * gerar a mais e escolher, nunca laço), tamanho e CTA por canal, regras da
 * casa, limpeza e conferência em código e as perguntas ao Jev com a política
 * da nota. A conferência é aviso, não reescrita.
 *
 * Puro (sem Deno e sem npm): a tela e o vitest leem o mesmo arquivo; banco e
 * Jev ficam em motor-de-copy-servidor.ts. Safari 11: sem lookbehind, classe
 * Unicode ou grupo nomeado. Sem travessão.
 */

export type CanalDaCopy = "legenda" | "lamina" | "anuncio" | "roteiro" | "site" | "proposta" | "bio" | "whatsapp";
export type ObjetivoDaCopy = "descoberta" | "educacao" | "autoridade" | "relacionamento" | "venda" | "contato";
export type FrameworkDaCopy = "aida" | "pas" | "bab" | "4u" | "gcc";

type RegraDoCanal = { nome: string; max: number; primeiraLinha?: number; palavrasDoTitulo?: number; pedeCta: boolean };

export const CANAIS: Record<CanalDaCopy, RegraDoCanal> = {
  legenda: { nome: "Legenda do Instagram", max: 2200, primeiraLinha: 125, pedeCta: true },
  lamina: { nome: "Texto na arte", max: 320, palavrasDoTitulo: 8, pedeCta: false },
  anuncio: { nome: "Anúncio na Meta", max: 1200, primeiraLinha: 125, pedeCta: true },
  roteiro: { nome: "Roteiro de vídeo", max: 3000, primeiraLinha: 90, pedeCta: true },
  site: { nome: "Seção de site", max: 900, palavrasDoTitulo: 8, pedeCta: true },
  proposta: { nome: "Proposta comercial", max: 1500, palavrasDoTitulo: 14, pedeCta: false },
  bio: { nome: "Bio do Instagram", max: 150, pedeCta: true },
  whatsapp: { nome: "Mensagem de WhatsApp", max: 700, primeiraLinha: 90, pedeCta: true },
};

export const OBJETIVOS: Record<ObjetivoDaCopy, string> = {
  descoberta: "Alcance e descoberta",
  educacao: "Educar e conscientizar",
  autoridade: "Autoridade e confiança",
  relacionamento: "Engajamento e relacionamento",
  venda: "Conversão e vendas",
  contato: "Gerar contato (mensagem, orçamento, agendamento)",
};

type Estrutura = { nome: string; passos: string; serve: ObjetivoDaCopy[]; canais: CanalDaCopy[] };

export const FRAMEWORKS: Record<FrameworkDaCopy, Estrutura> = {
  aida: { nome: "AIDA", passos: "atenção (gancho que para), interesse (detalhe concreto), desejo (benefício e prova real), ação (um CTA)", serve: ["venda", "contato"], canais: ["anuncio", "legenda", "site", "whatsapp", "proposta"] },
  pas: { nome: "PAS", passos: "problema com as palavras do público, agitação proporcional (o custo de deixar como está), solução da marca e CTA", serve: ["venda", "contato", "educacao"], canais: ["anuncio", "legenda", "roteiro", "site", "whatsapp", "proposta"] },
  bab: { nome: "BAB", passos: "antes (como é hoje), depois (como fica, sem prometer corpo, saúde ou renda), ponte (o que a marca faz) e CTA", serve: ["venda", "autoridade", "relacionamento"], canais: ["legenda", "anuncio", "roteiro", "proposta", "site"] },
  "4u": { nome: "4U", passos: "título útil, urgente só se for verdade, único e ultraespecífico (o quê, para quem, quanto ou quando, com dado real)", serve: ["descoberta", "venda", "contato"], canais: ["lamina", "anuncio", "site", "proposta", "bio"] },
  gcc: { nome: "Gancho, corpo e CTA", passos: "gancho que funciona sozinho, corpo com uma ideia e um detalhe concreto do negócio, CTA com verbo e ganho", serve: ["descoberta", "educacao", "relacionamento", "autoridade"], canais: ["legenda", "roteiro", "whatsapp", "bio"] },
};

const ORDEM_DOS_FRAMEWORKS: FrameworkDaCopy[] = ["gcc", "aida", "pas", "bab", "4u"];

const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Objetivo livre (post do Mês, Ads, pedido) no vocabulário do motor. Sem pista: educação. */
export function objetivoDaCopy(v: unknown): ObjetivoDaCopy {
  const s = semAcento(String(v == null ? "" : v));
  if (/descoberta|viraliz|alcance|awareness|topo/.test(s)) return "descoberta";
  if (/lead|contato|mensag|whats|orcament|agend|cadastr|formulario/.test(s)) return "contato";
  if (/venda|convers|compra|oferta|promoc|lancament|sales|purchase/.test(s)) return "venda";
  if (/autoridade|confian|prova|case|bastidor/.test(s)) return "autoridade";
  if (/engaj|relacion|comunidade|comentar|interac/.test(s)) return "relacionamento";
  return "educacao";
}

/** Estruturas para N variações, cada uma diferente: primeiro as que servem ao objetivo e ao canal. */
export function escolherFrameworks(objetivo: ObjetivoDaCopy, canal: CanalDaCopy, n = 3): FrameworkDaCopy[] {
  const nota = (f: FrameworkDaCopy) => (FRAMEWORKS[f].serve.indexOf(objetivo) >= 0 ? 2 : 0) + (FRAMEWORKS[f].canais.indexOf(canal) >= 0 ? 1 : 0);
  const ordem = ORDEM_DOS_FRAMEWORKS.slice().sort((a, b) => nota(b) - nota(a) || ORDEM_DOS_FRAMEWORKS.indexOf(a) - ORDEM_DOS_FRAMEWORKS.indexOf(b));
  const saida: FrameworkDaCopy[] = [];
  for (let i = 0; i < Math.max(1, Math.min(n, 8)); i++) saida.push(ordem[i % ordem.length]);
  return saida;
}

/** Id de estrutura conhecido ou null (o modelo às vezes escreve o nome). */
export function frameworkDaCopy(v: unknown): FrameworkDaCopy | null {
  const s = semAcento(String(v == null ? "" : v)).replace(/[^a-z0-9]/g, "");
  if (s === "aida" || s === "pas" || s === "bab" || s === "4u" || s === "gcc") return s;
  if (s.indexOf("gancho") === 0) return "gcc";
  if (s.indexOf("problema") === 0) return "pas";
  if (s.indexOf("antes") === 0) return "bab";
  return null;
}

// --- regras da casa

export type RegrasDaCasa = { semTravessao: boolean };

/** O contexto do cliente pede para não usar travessão ("sem travessão", "evitar travessão"...). */
export function pedeSemTravessao(texto: unknown): boolean {
  const s = semAcento(String(texto == null ? "" : texto));
  return /(sem|nao|nunca|evit[a-z]*|proib[a-z]*)[^.\n]{0,40}travess/.test(s) || /travess[^.\n]{0,25}(proibid|nao usar|nunca)/.test(s);
}

/** A casa já escreve sem travessão em todo o painel; o cliente pedir só confirma. */
export function regrasDaCasa(contexto?: unknown, casaSemTravessao = true): RegrasDaCasa {
  return { semTravessao: casaSemTravessao || pedeSemTravessao(contexto) };
}

// --- bloco do pedido

export type PedidoDoMotor = {
  canal: CanalDaCopy;
  objetivo: ObjetivoDaCopy;
  variacoes?: number;
  frameworks?: FrameworkDaCopy[];
  /** A equipe escolheu a estrutura (ex.: "Lista", "Mito ou verdade"): todas as variações seguem ela. */
  estruturaPedida?: string | null;
  /** Já existe um texto previsto (ex.: a legenda do item do Mês): a variação 1 parte dele e as outras contam a mesma ideia em outras estruturas. */
  partirDoPrevisto?: boolean;
  regras?: RegrasDaCasa;
};

/** O bloco que a mesa põe no pedido ao modelo (curto: vai junto do conhecimento que ela já tem). */
export function blocoDoMotor(p: PedidoDoMotor): string {
  const c = CANAIS[p.canal];
  const n = Math.max(1, Math.min(p.variacoes ?? 1, 5));
  const fws = p.frameworks && p.frameworks.length ? p.frameworks.slice(0, n) : escolherFrameworks(p.objetivo, p.canal, n);
  const estrutura = p.estruturaPedida
    ? `a pedida pela equipe (${String(p.estruturaPedida).slice(0, 80)}) em todas as variações; elas mudam a ideia e o gancho, não a estrutura.`
    : n > 1
    ? `${fws.map((f, i) => `variação ${i + 1} em ${FRAMEWORKS[f].nome} (${FRAMEWORKS[f].passos})`).join("; ")}. ${p.partirDoPrevisto ? "Há texto previsto: a variação 1 parte dele e melhora sem mudar o sentido; as outras contam a mesma ideia (mesmo tema, oferta e CTA) com outro gancho, nunca paráfrase do previsto" : "Ideias diferentes entre si, nunca paráfrase"}; quando a resposta tiver o campo "framework", use o id (${fws.join(", ")}).`
    : `${FRAMEWORKS[fws[0]].nome}: ${FRAMEWORKS[fws[0]].passos}.`;
  const tamanho = [
    `até ${c.max} caracteres`,
    c.primeiraLinha ? `primeira linha com até ${c.primeiraLinha} caracteres, que funciona sozinha` : "",
    c.palavrasDoTitulo ? `título com até ${c.palavrasDoTitulo} palavras` : "",
  ].filter(Boolean).join("; ");
  return [
    `MOTOR DE COPY DA CASA (canal: ${c.nome}; objetivo: ${OBJETIVOS[p.objetivo]})`,
    "- Voz: a da marca no contexto (tom, tratamento, palavras do público, o que o cliente já ensinou). Nada de voz genérica de agência.",
    `- Estrutura: ${estrutura}`,
    `- Tamanho: ${tamanho}.`,
    c.pedeCta ? "- CTA: um só, verbo e o que a pessoa ganha, ligado ao objetivo e ao canal." : "- CTA: só quando o bloco pede; nunca dois.",
    "- Fatos: só os do contexto e do pedido. Sem preço, número, prazo, depoimento, prêmio ou resultado inventado.",
    "- Sem promessa proibida: resultado garantido, cura ou efeito de saúde, ganho de dinheiro, mudança de corpo, urgência ou escassez falsa, \"o melhor\" ou \"número 1\" sem prova.",
    "- Sem clichê de IA (\"no mundo de hoje\", \"eleve\", \"desbloqueie\", \"jornada\", \"potencialize\", \"não é só X, é Y\", \"transforme sua vida\"): troque por detalhe concreto do negócio.",
    `- Português do Brasil, frases curtas, voz ativa.${p.regras && !p.regras.semTravessao ? "" : " Sem travessão."}`,
  ].join("\n");
}

/** Uma linha para os geradores do Mês e das Campanhas (vários posts por chamada: a regra curta, sem variações). */
export const REGRA_DA_LEGENDA_NO_PLANO =
  "Legenda pelo motor de copy da casa: estrutura pelo objetivo do post (venda e contato em AIDA ou PAS; transformação em BAB; alcance em 4U no gancho; educação, autoridade e relacionamento em gancho, corpo e CTA), primeira linha com até 125 caracteres que funciona sozinha, um CTA, voz da marca, sem fato inventado, sem promessa proibida e sem clichê de IA.";

// --- limpeza e conferência em código

/** cortar: false quando a mesa já tem o próprio teto (o refino, por exemplo, descarta o que passa). */
export type OpcoesDaLimpeza = { regras?: RegrasDaCasa; semHashtags?: boolean; cortar?: boolean };

/** Travessão: o U+2014 sempre; o U+2013 só no começo da linha ou entre espaços (9h-18h colado fica), como em preencher-com-ia.ts. */
const TEM_TRAVESSAO = /\u2014|^[ \t]*\u2013|[ \t]\u2013[ \t]/m;

export function temTravessao(texto: string): boolean {
  return TEM_TRAVESSAO.test(texto);
}

/** Limpa sem reescrever: travessão (regra da casa), aspas em volta, espaços, hashtags no fim (se pedido), teto do canal. */
export function limparCopy(bruto: unknown, canal: CanalDaCopy, o: OpcoesDaLimpeza = {}): { texto: string; ajustes: string[] } {
  const ajustes: string[] = [];
  let t = String(bruto == null ? "" : bruto).replace(/\r\n?/g, "\n");
  if ((o.regras ? o.regras.semTravessao : true) && temTravessao(t)) {
    t = t
      .replace(/^[ \t]*[\u2014\u2013][ \t]*/gm, "")
      .replace(/[ \t]*\u2014[ \t]*/g, ", ")
      .replace(/[ \t]+\u2013[ \t]+/g, ", ")
      .replace(/,[ \t]*,/g, ",")
      .replace(/,[ \t]*([.!?])/g, "$1");
    ajustes.push("travessão trocado por vírgula");
  }
  t = t.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (/^["\u201c][^"\u201c\u201d]+["\u201d]$/.test(t)) {
    t = t.slice(1, -1).trim();
    ajustes.push("aspas em volta tiradas");
  }
  if (o.semHashtags) {
    const sem = t.replace(/(\s*#[A-Za-z0-9_\u00c0-\u017f]+)+\s*$/, "").trim();
    if (sem !== t) ajustes.push("hashtags do fim tiradas (moram em campo próprio)");
    t = sem;
  }
  const max = CANAIS[canal].max;
  if (o.cortar !== false && t.length > max) {
    const corte = t.slice(0, max);
    const fim = Math.max(corte.lastIndexOf(". "), corte.lastIndexOf("\n"), corte.lastIndexOf("! "), corte.lastIndexOf("? "));
    t = (fim > max * 0.6 ? corte.slice(0, fim + 1) : corte.replace(/\s+\S*$/, "")).trim();
    ajustes.push(`cortado no limite do canal (${max} caracteres)`);
  }
  return { texto: t, ajustes };
}

const CLICHES: Array<[RegExp, string]> = [
  [/no mundo (atual|de hoje|moderno|acelerado|digital)|em um mundo (onde|cada vez)/, "no mundo de hoje"],
  [/desbloque(ie|ar|ando)/, "desbloqueie"],
  [/\bele(ve|var) (o|a|os|as|seu|sua|ao) |proximo nivel/, "eleve / próximo nível"],
  [/\bmergulh(e|ar|ando)\b/, "mergulhe"],
  [/descubra (o poder|os segredos|como transformar)|o segredo (para|de)\b/, "descubra o segredo"],
  [/\b(sua|nossa|essa|uma|verdadeira|incrivel) jornada\b/, "jornada"],
  [/potencializ/, "potencialize"],
  [/revolucion(ario|aria|e|ar)\b/, "revolucionário"],
  [/transform(e|ar) (sua|seu) (vida|negocio|rotina|empresa)/, "transforme sua vida"],
  [/(nao e|nao eh) (so|apenas) [^.,\n]{1,40}, e /, "não é só X, é Y"],
  [/\bsinergia|alavanc(ar|ando|ada|ado)\b/, "sinergia / alavancar"],
  [/(solucao|experiencia) (unica|completa|inovadora|incrivel)/, "solução única"],
  [/qualidade e excelencia|excelencia em|compromisso com a excelencia/, "excelência"],
  [/prepare-se para|chegou a hora de|nao perca tempo|venha conferir|tudo isso e muito mais/, "frase feita de chamada"],
  [/fazer a diferenca|faz toda a diferenca/, "faz toda a diferença"],
];

const SAUDE = "doenca|dor|dores|ansiedade|depressao|cancer|diabetes|calvicie|queda de cabelo|insonia|gastrite|enxaqueca|acne|celulite|obesidade|vicio|alergia|rinite|sinusite|artrite|artrose|hernia|hipertensao|pressao alta|psoriase|estresse";

const PROMESSAS: Array<[RegExp, string]> = [
  [/resultados? garantid|garantimos (o |os )?resultado|100% garantid|risco zero/, "resultado garantido"],
  // Cura de saúde (de pernil, queijo ou concreto fica de fora).
  [new RegExp(`\\bcura (da|do|de|das|dos|para|contra) (sua |seu )?(${SAUDE})|\\bcura (definitiva|garantida|milagrosa|natural|total)\\b|\\bcura(r|mos|ra|remos) (a |o |as |os |sua |seu )?(${SAUDE})|\\bmilagr`), "cura ou milagre"],
  [/(emagre(ca|cer)|perca|perder) \d+ ?(kg|quilos)/, "mudança de corpo com número"],
  [/(fique|ficar) rico|dinheiro facil|renda (extra )?garantida|ganhe dinheiro (facil|rapido)/, "ganho de dinheiro"],
  [/sem (nenhum )?esforco|da noite para o dia/, "resultado sem esforço"],
  // "Número 1 em/do/da" sim; endereço ("nº 1, Centro") e ordinal ("no 1º dia") não.
  [/o melhor (do|da) (brasil|cidade|mundo|regiao|bairro)|(numero|n[º°]|no\.) ?(1|um) (em|do|da|no|na)\b/, "superlativo sem prova"],
];

const CTA = /\b(chame|chama|agende|agenda|marque|clique|toque|comente|salve|compartilhe|envie|mande|peca|garanta|reserve|compre|acesse|visite|venha|fale|ligue|responda|baixe|inscreva|cadastre|solicite|conheca|experimente|aproveite|escolha|confira|chamar|agendar|pedir|garantir|reservar|passe|consulte|saiba|assista|leia|arraste|siga|converse)\b|link na bio|whatsapp|direct|\bdm\b/;

export type ProblemaDaCopy = { tipo: "tamanho" | "primeira_linha" | "titulo" | "sem_cta" | "cliche" | "promessa" | "travessao" | "hashtag" | "vazia"; texto: string };

/** Conferência em código (sem rede): nota de 0 a 10 e os problemas, cada um com o aviso pronto. */
export function conferirCopy(texto: string, canal: CanalDaCopy, regras: RegrasDaCasa = { semTravessao: true }): { nota: number; problemas: ProblemaDaCopy[] } {
  const c = CANAIS[canal];
  const t = String(texto || "").trim();
  if (!t) return { nota: 0, problemas: [{ tipo: "vazia", texto: "Copy vazia." }] };
  const s = semAcento(t);
  const problemas: ProblemaDaCopy[] = [];
  let nota = 10;
  if (t.length > c.max) { nota -= 3; problemas.push({ tipo: "tamanho", texto: `Passa do limite do canal (${t.length} de ${c.max} caracteres).` }); }
  const primeira = t.split("\n")[0].trim();
  if (c.primeiraLinha && primeira.length > c.primeiraLinha) { nota -= 1; problemas.push({ tipo: "primeira_linha", texto: `Primeira linha longa (${primeira.length} caracteres): o gancho some antes do "mais".` }); }
  if (c.palavrasDoTitulo && primeira.split(/\s+/).filter(Boolean).length > c.palavrasDoTitulo + 2) { nota -= 1; problemas.push({ tipo: "titulo", texto: `Título com mais de ${c.palavrasDoTitulo} palavras.` }); }
  if (c.pedeCta && !CTA.test(s)) { nota -= 2; problemas.push({ tipo: "sem_cta", texto: "Sem CTA claro (verbo de ação no fim)." }); }
  const cliches = CLICHES.filter(([re]) => re.test(s)).map(([, nome]) => nome);
  if (cliches.length) { nota -= Math.min(3, cliches.length); problemas.push({ tipo: "cliche", texto: `Clichê de IA: ${cliches.join(", ")}.` }); }
  const promessas = PROMESSAS.filter(([re]) => re.test(s)).map(([, nome]) => nome);
  if (promessas.length) { nota -= 3; problemas.push({ tipo: "promessa", texto: `Promessa proibida ou arriscada: ${promessas.join(", ")}. Confira antes de usar.` }); }
  if (regras.semTravessao && temTravessao(t)) { nota -= 1; problemas.push({ tipo: "travessao", texto: "Tem travessão (regra da casa)." }); }
  if ((canal === "lamina" || canal === "anuncio" || canal === "site" || canal === "proposta") && /(^|\s)#[A-Za-z0-9_]{3,}/.test(t)) { nota -= 1; problemas.push({ tipo: "hashtag", texto: "Hashtag dentro do texto." }); }
  return { nota: Math.max(0, nota), problemas };
}

// --- Jev: perguntas, leitura e nota

export type EstadoDaConferencia = { canal: string; objetivo: string; marca: string; oferta: string; copies: Record<string, string> };

export function estadoDaConferencia(textos: string[], p: { canal: CanalDaCopy; objetivo: ObjetivoDaCopy; marca: string; oferta?: string | null }): EstadoDaConferencia {
  const copies: Record<string, string> = {};
  textos.forEach((t, i) => { copies[`c${i}`] = String(t || "").slice(0, 3000); });
  return { canal: CANAIS[p.canal].nome, objetivo: OBJETIVOS[p.objetivo], marca: String(p.marca || "sem contexto cadastrado").slice(0, 4000), oferta: String(p.oferta || "a do contexto da marca").slice(0, TETO_DA_OFERTA), copies };
}

/** Teto da `oferta` no estado do Jev. */
export const TETO_DA_OFERTA = 2400;

/** A `oferta` do Jev (base do "inventou?"): os fatos verificáveis, um por linha e na ordem dada; vazio fica de fora. */
export function ofertaDosFatos(partes: Array<[string, unknown]>, teto = TETO_DA_OFERTA): string {
  const linhas: string[] = [];
  let resta = teto;
  for (const [rotulo, v] of partes) {
    if (v == null || resta <= rotulo.length + 3) continue;
    let t = "";
    try {
      t = (typeof v === "string" ? v : JSON.stringify(v)).replace(/\s+/g, " ").trim();
    } catch {
      t = "";
    }
    if (!t || t === "[]" || t === "{}" || t === "null" || t === "\"\"") continue;
    const linha = `${rotulo}: ${t}`.slice(0, Math.min(resta, 900));
    linhas.push(linha);
    resta -= linha.length + 1;
  }
  return linhas.join("\n");
}

const NIVEIS_VOZ = [
  "Não parece a marca: tom, vocabulário ou público diferentes do que está em `marca`.",
  "Parece pouco: tom genérico que serviria a qualquer negócio do setor.",
  "Parece em parte: o tom está certo, mas o vocabulário ou o tratamento destoam em algum trecho.",
  "Parece a marca: tom, tratamento e vocabulário do contexto, falando com o público certo.",
  "É a marca: soa como a marca descrita e traz detalhe concreto do negócio dela.",
];
const NIVEIS_FORCA = [
  "Fraca: não para a rolagem nem leva à ação; o público não entende o que ganha.",
  "Morna: entende-se, mas o gancho é comum e a ação é vaga.",
  "Boa: gancho claro, benefício entendido e ação possível.",
  "Forte: gancho específico que prende, benefício concreto e uma ação clara ligada ao objetivo.",
  "Muito forte: situação reconhecível do público, prova ou detalhe real e ação irresistível, sem exagero.",
];

/** A pergunta do clichê de IA sobre a copy em `ref` (caminho no estado, ex.: "`copies[0]`"). Outras mesas reusam. */
export function perguntaDoCliche(ref: string): { type: "noul"; instructions: string } {
  return { type: "noul", instructions: `A copy ${ref} soa como texto genérico de inteligência artificial (frases feitas como "no mundo de hoje", "eleve", "desbloqueie", "jornada", "não é só X, é Y", adjetivo vazio, estrutura de manual) em vez de fala concreta da marca?` };
}

/** Perguntas independentes por copy, todas na mesma chamada (voz, força, fato inventado, promessa, clichê). */
export function perguntasDaConferencia(n: number): Record<string, { type: "score"; instructions: string; criteria: string[] } | { type: "noul"; instructions: string }> {
  const q: Record<string, { type: "score"; instructions: string; criteria: string[] } | { type: "noul"; instructions: string }> = {};
  for (let i = 0; i < n; i++) {
    const c = `\`copies.c${i}\``;
    q[`voz_${i}`] = { type: "score", instructions: `Quanto a copy ${c} soa como a marca descrita em \`marca\` (tom, tratamento, vocabulário e público)?`, criteria: NIVEIS_VOZ };
    q[`forca_${i}`] = { type: "score", instructions: `Para o \`objetivo\` no \`canal\`, qual a força da copy ${c} para o público da marca?`, criteria: NIVEIS_FORCA };
    q[`inventa_${i}`] = { type: "noul", instructions: `A copy ${c} afirma algum fato concreto (preço, número, prazo, resultado, serviço, depoimento, prêmio ou garantia) que NÃO está em \`marca\` nem em \`oferta\`?` };
    q[`promessa_${i}`] = { type: "noul", instructions: `A copy ${c} faz promessa proibida ou arriscada: resultado garantido, cura ou efeito de saúde, ganho de dinheiro, mudança de corpo, urgência ou escassez que não está em \`oferta\`, ou superlativo sem prova (o melhor, número 1)?` };
    q[`cliche_${i}`] = perguntaDoCliche(c);
  }
  return q;
}

export type NotaDoJev = { voz: number | null; forca: number | null; inventa: number | null; promessa: number | null; cliche: number | null };

type Resposta = { score?: number; noul?: number } | undefined;
const score = (r: Resposta, niveis: number) => (r && typeof r.score === "number" && isFinite(r.score) ? Math.round((r.score / (niveis - 1)) * 100) / 10 : null);
const prob = (r: Resposta) => (r && typeof r.noul === "number" && isFinite(r.noul) ? Math.round(r.noul * 100) / 100 : null);

export function lerConferencia(answers: Record<string, Resposta>, n: number): NotaDoJev[] {
  const saida: NotaDoJev[] = [];
  for (let i = 0; i < n; i++) {
    saida.push({ voz: score(answers[`voz_${i}`], NIVEIS_VOZ.length), forca: score(answers[`forca_${i}`], NIVEIS_FORCA.length), inventa: prob(answers[`inventa_${i}`]), promessa: prob(answers[`promessa_${i}`]), cliche: prob(answers[`cliche_${i}`]) });
  }
  return saida;
}

/** Limiares dos Noul (sim a partir daqui). A política fica aqui, à vista, para ajustar sem mexer nas perguntas. */
export const LIMIARES = { inventa: 0.6, promessa: 0.5, cliche: 0.6 };

export type ConferenciaDaCopy = { indice: number; nota: number; local: number; jev: NotaDoJev | null; alerta: boolean; avisos: string[]; ajustes: string[] };

/**
 * Nota de 0 a 100. Com o Jev: 40% voz, 35% força, 25% conferência em código,
 * menos 25 por fato inventado, 30 por promessa proibida e 15 por clichê de IA.
 * Sem o Jev: só a conferência em código. `alerta` = algo que a equipe precisa
 * olhar antes de usar (promessa ou fato inventado).
 */
export function notaDaCopy(local: { nota: number; problemas: ProblemaDaCopy[] }, jev: NotaDoJev | null, indice = 0, ajustes: string[] = []): ConferenciaDaCopy {
  const avisos = local.problemas.map((p) => p.texto);
  let nota = local.nota * 10;
  let alerta = local.problemas.some((p) => p.tipo === "promessa");
  if (jev && (jev.voz != null || jev.forca != null)) {
    nota = (jev.voz ?? local.nota) * 4 + (jev.forca ?? local.nota) * 3.5 + local.nota * 2.5;
    if (jev.inventa != null && jev.inventa >= LIMIARES.inventa) { nota -= 25; alerta = true; avisos.push("O Jev viu fato que não está no contexto nem na oferta: confira número, prazo e promessa."); }
    if (jev.promessa != null && jev.promessa >= LIMIARES.promessa) { nota -= 30; alerta = true; avisos.push("O Jev viu promessa proibida ou arriscada."); }
    if (jev.cliche != null && jev.cliche >= LIMIARES.cliche) { nota -= 15; avisos.push("Soa como texto genérico de IA pelo Jev."); }
    if (jev.voz != null && jev.voz < 5) avisos.push(`Pouco da voz da marca (nota ${String(jev.voz).replace(".", ",")} de 10).`);
  }
  return { indice, nota: Math.max(0, Math.min(100, Math.round(nota))), local: local.nota, jev, alerta, avisos: avisos.filter((a, i, l) => l.indexOf(a) === i), ajustes };
}

/** Ordem da melhor para a pior (sem alerta antes; empate fica na ordem escrita). */
export function ranquear(conferencias: ConferenciaDaCopy[]): ConferenciaDaCopy[] {
  return conferencias.slice().sort((a, b) => Number(a.alerta) - Number(b.alerta) || b.nota - a.nota || a.indice - b.indice);
}

/** Uma linha para a tela: por que esta ficou em primeiro. */
export function porqueDaEscolha(c: ConferenciaDaCopy, de: number): string {
  const partes = [`nota ${c.nota} de 100`];
  if (c.jev && c.jev.voz != null) partes.push(`voz da marca ${String(c.jev.voz).replace(".", ",")}`);
  if (c.jev && c.jev.forca != null) partes.push(`força ${String(c.jev.forca).replace(".", ",")}`);
  return `${de > 1 ? `Melhor de ${de}: ` : ""}${partes.join(", ")}${c.jev ? "" : " (sem o Jev, só a conferência em código)"}.`;
}
