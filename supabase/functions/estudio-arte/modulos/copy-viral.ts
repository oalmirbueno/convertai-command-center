/**
 * Motor de copy viral da casa (frente COPY-V, 23/10/2026).
 *
 * Pedido do dono: "a escrita está muito genérica, sem contexto, sem os ganchos
 * fortes, confusa, não conversa com o nicho". O motor junta, em toda escrita
 * de texto (temas do Mês, pautas, lâminas, legenda, story):
 * 1. contexto forte obrigatório (nicho, público, dor, oferta, cérebro do
 *    cliente, base dos agentes, Hype e Trending, mundo real);
 * 2. de 8 a 15 ganchos do banco ganchos_vencedores (por nicho, formato e
 *    gatilho) como EXEMPLOS da fórmula, nunca para copiar;
 * 3. o guia da casa (humanizer, clareza e viralização), versionado aqui;
 * 4. de 2 a 3 versões, e o Jev (Score) escolhe a mais forte: gancho que para
 *    o dedo, clareza, nicho, utilidade e vontade de salvar ou compartilhar.
 *    Gerar a mais e escolher, sem laço de correção;
 * 5. humanizer em código na escolhida e corte do que não tem fonte (número,
 *    depoimento e prova sem dado real ficam de fora).
 *
 * Puro (sem Deno, sem banco, sem npm): a tela, o vitest e as funções leem o
 * mesmo arquivo. Banco e Jev em copy-viral-servidor.ts. Safari 11: sem
 * lookbehind, classe Unicode, grupo nomeado, flatMap, replaceAll ou .at().
 * Sem travessão.
 */

export const VERSAO_DA_COPY_VIRAL = "2026-10-23.1";

// ------------------------------------------------------------------ nichos

export type NichoDaCopy =
  | "odontologia" | "advocacia" | "informatica" | "alimentacao" | "cafe" | "moda" | "varejo" | "saude_estetica"
  | "imobiliario" | "educacao" | "servicos_locais" | "marketing" | "automotivo" | "eventos" | "moveis_decoracao"
  | "jardinagem" | "esporte" | "geral";

/** Rótulo e pistas (sem acento, minúsculas) de cada nicho do banco. A ordem decide o empate. */
export const NICHOS_DA_COPY: Array<{ id: NichoDaCopy; rotulo: string; pistas: RegExp }> = [
  { id: "odontologia", rotulo: "Odontologia", pistas: /odonto|dentist|dental|\bdente|ortodont|implante dent|clareamento|consultorio odont/ },
  { id: "advocacia", rotulo: "Advocacia e previdenciário", pistas: /advoca|advogad|juridic|direito (previd|trabalh|de famil|civil|do consum)|previdenci|\binss\b|aposentad|escritorio de direito|\boab\b/ },
  { id: "informatica", rotulo: "Informática e assistência técnica", pistas: /informatic|assistencia tecnica|conserto de (celular|notebook|computador)|notebook|computador|celular|smartphone|eletronic|\bti\b|manutencao de (pc|computador)/ },
  { id: "cafe", rotulo: "Café", pistas: /cafeteria|\bcafe(s)?\b|barista|torrefa|espresso|coffee/ },
  { id: "alimentacao", rotulo: "Alimentação e restaurante", pistas: /restaurante|lanchonete|hamburg|pizzar|gastronom|culinar|cozinha|delivery de comida|padaria|confeitar|doceria|marmit|churrasc|pernil|acougue|bar e restaurante|comida|food/ },
  { id: "moda", rotulo: "Moda", pistas: /\bmoda\b|roupa|vestuario|boutique|confecc|look|calcad|sapataria|lingerie|moda (feminina|masculina|praia)/ },
  { id: "saude_estetica", rotulo: "Saúde e estética", pistas: /estetic|dermat|clinica|saude|fisioter|nutricion|psicolog|harmonizac|salao de beleza|cabeleire|manicure|spa\b|massag|beleza|farmacia|academia|personal trainer/ },
  { id: "imobiliario", rotulo: "Imobiliário", pistas: /imobili|imovel|imoveis|corretor|construtor|incorporad|loteament|aluguel de (casa|apart)|condominio/ },
  { id: "educacao", rotulo: "Educação", pistas: /escola|educac|curso|ensino|faculdade|colegio|professor|aula|treinament|idiomas|vestibular|concurso/ },
  { id: "marketing", rotulo: "Marketing e agência", pistas: /marketing|agencia|publicidade|social media|trafego pago|branding|design grafico|consultoria de vendas/ },
  { id: "automotivo", rotulo: "Automotivo", pistas: /automotiv|oficina|mecanic|auto ?pec|concessionar|carro|veicul|funilar|lava ?jato|estetica automotiva|pneu|moto(s)?\b/ },
  { id: "eventos", rotulo: "Eventos", pistas: /evento|casamento|festa|buffet|cerimonial|formatura|show|balada|aniversario|decoracao de festa|dj\b/ },
  { id: "moveis_decoracao", rotulo: "Móveis e decoração", pistas: /movel|moveis|marcenar|decorac|planejad|estofad|colchao|design de interiores|arquitetura de interiores/ },
  { id: "jardinagem", rotulo: "Jardinagem e paisagismo", pistas: /jardi|paisag|plantas?\b|viveiro|floricult|horta|grama|mudas?\b|garden/ },
  { id: "esporte", rotulo: "Futebol e esporte", pistas: /futebol|esporte|time de|clube|atleta|escolinha|futsal|esportiv|corrida|crossfit|luta|jiu|fut\b/ },
  { id: "varejo", rotulo: "Varejo", pistas: /varejo|loja|comercio|mercado|supermercad|atacad|e-?commerce|papelaria|material de construc|utilidades|armarinho|distribuidora|ecommerce/ },
  { id: "servicos_locais", rotulo: "Serviços locais", pistas: /servico|encanad|eletricist|limpeza|dedetiz|reforma|pintor|chaveir|lavanderia|pet ?shop|veterinar|vidracar|serralher|ar.condicionado|diarista/ },
];

export const ROTULO_DO_NICHO: Record<string, string> = (() => {
  const r: Record<string, string> = { geral: "Geral (vale para todos)" };
  NICHOS_DA_COPY.forEach((n) => { r[n.id] = n.rotulo; });
  return r;
})();

const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Os nichos do banco que o texto do cliente cita (segmento, negócio, produtos),
 * do mais citado ao menos, até 2, sempre com "geral" no fim. Regra fixa: as
 * pistas são palavras do ramo, sem julgamento.
 */
export function nichosDoTexto(...textos: unknown[]): NichoDaCopy[] {
  const s = semAcento(textos.map((t) => (t == null ? "" : typeof t === "string" ? t : JSON.stringify(t))).join(" \n "));
  const achados: Array<{ id: NichoDaCopy; n: number; ordem: number }> = [];
  NICHOS_DA_COPY.forEach((nicho, ordem) => {
    const re = new RegExp(nicho.pistas.source, "g");
    const n = (s.match(re) || []).length;
    if (n > 0) achados.push({ id: nicho.id, n, ordem });
  });
  achados.sort((a, b) => b.n - a.n || a.ordem - b.ordem);
  // O segundo nicho só entra com pista repetida e forte perto do primeiro ("clínica" sozinha não faz de um dentista uma estética).
  const saida: NichoDaCopy[] = achados.filter((a, i) => i === 0 || (i === 1 && a.n >= 2 && a.n * 2 >= achados[0].n)).map((a) => a.id);
  saida.push("geral");
  return saida;
}

// ------------------------------------------------------------------ ganchos

export type FormatoDoGancho = "lamina_capa" | "reels_abertura" | "legenda_primeira_linha" | "story" | "anuncio";
export type GatilhoDoGancho = "curiosidade" | "medo_de_perder" | "contrario" | "numero" | "historia" | "prova" | "polemica_leve" | "identificacao";

export const FORMATOS_DO_GANCHO: FormatoDoGancho[] = ["lamina_capa", "reels_abertura", "legenda_primeira_linha", "story", "anuncio"];
export const GATILHOS_DO_GANCHO: GatilhoDoGancho[] = ["curiosidade", "medo_de_perder", "contrario", "numero", "historia", "prova", "polemica_leve", "identificacao"];

export const ROTULO_DO_FORMATO: Record<FormatoDoGancho, string> = {
  lamina_capa: "capa da lâmina",
  reels_abertura: "abertura de Reels",
  legenda_primeira_linha: "primeira linha da legenda",
  story: "story",
  anuncio: "anúncio",
};

/** O formato de gancho de cada lugar onde o texto nasce. */
export function formatoDoLugar(lugar: string): FormatoDoGancho {
  const s = semAcento(String(lugar || ""));
  if (/stor/.test(s)) return "story";
  if (/reel|video|roteiro/.test(s)) return "reels_abertura";
  if (/anuncio|ads|criativo/.test(s)) return "anuncio";
  if (/legenda|caption/.test(s)) return "legenda_primeira_linha";
  return "lamina_capa";
}

export type Gancho = {
  id: string;
  formula: string;
  exemplo: string;
  por_que_funciona: string;
  gatilho: GatilhoDoGancho | string;
  formato: FormatoDoGancho | string;
  nichos: string[];
  tom?: string | null;
  nivel_de_ousadia?: number | null;
};

export type FiltroDosGanchos = {
  nichos: string[];
  formato: FormatoDoGancho;
  gatilhos?: string[];
  /** Quantos exemplos vão ao prompt (8 a 15). */
  n?: number;
  /** Muda o desempate entre chamadas (ex.: id do trabalho): o mesmo cliente não recebe sempre os mesmos exemplos. */
  semente?: string;
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export const MIN_GANCHOS = 8;
export const MAX_GANCHOS = 15;

/**
 * Escolhe de 8 a 15 ganchos para o prompt: primeiro os do nicho do cliente no
 * formato pedido, depois o mesmo nicho em outro formato, depois os gerais.
 * Diversidade: no máximo 2 por fórmula, para o modelo ver fórmulas diferentes.
 */
export function escolherGanchos(lista: Gancho[], f: FiltroDosGanchos): Gancho[] {
  const n = Math.max(MIN_GANCHOS, Math.min(MAX_GANCHOS, f.n || 12));
  const especificos = f.nichos.filter((x) => x && x !== "geral");
  const gatilhos = f.gatilhos || [];
  const semente = f.semente || "";
  const nota = (g: Gancho) => {
    const nichos = Array.isArray(g.nichos) ? g.nichos : [];
    const doNicho = nichos.some((x) => especificos.indexOf(x) >= 0);
    const geral = nichos.indexOf("geral") >= 0;
    if (!doNicho && !geral) return -1;
    return (doNicho ? 6 : 1) + (g.formato === f.formato ? 3 : 0) + (gatilhos.indexOf(String(g.gatilho)) >= 0 ? 2 : 0);
  };
  const ordenados = lista
    .filter((g) => g && g.exemplo && g.formula)
    .map((g) => ({ g, nota: nota(g), desempate: hash(`${semente}:${g.id}`) }))
    .filter((x) => x.nota >= 0)
    .sort((a, b) => b.nota - a.nota || a.desempate - b.desempate);
  const porFormula: Record<string, number> = {};
  const escolhidos: Gancho[] = [];
  const sobra: Gancho[] = [];
  ordenados.forEach((x) => {
    const k = x.g.formula;
    if (escolhidos.length < n && (porFormula[k] || 0) < 2) {
      porFormula[k] = (porFormula[k] || 0) + 1;
      escolhidos.push(x.g);
    } else sobra.push(x.g);
  });
  // Banco pequeno (só um nicho, poucas fórmulas): completa até o mínimo sem a trava da fórmula.
  for (let i = 0; escolhidos.length < Math.min(MIN_GANCHOS, ordenados.length) && i < sobra.length; i++) escolhidos.push(sobra[i]);
  return escolhidos;
}

/** Os exemplos no prompt: fórmula, exemplo e por que funciona, numa linha cada. */
export function blocoDosGanchos(ganchos: Gancho[]): string {
  if (!ganchos.length) return "";
  const linhas = ganchos.map((g, i) => `${i + 1}. [${g.formula} | ${g.gatilho} | ${ROTULO_DO_FORMATO[g.formato as FormatoDoGancho] || g.formato}] "${g.exemplo}" Por que funciona: ${g.por_que_funciona}`);
  return [
    "GANCHOS VENCEDORES DA CASA (exemplos para inspirar a FÓRMULA; nunca copie a frase, nunca troque só o nome do produto):",
    ...linhas,
    "Chaves {assim} pedem um dado real do contexto do cliente. Sem o dado, escolha outra fórmula; nunca invente o número, a data ou a história.",
  ].join("\n");
}

// ------------------------------------------------------------------ guia da casa

/** O documento-guia versionado (humanizer, clareza e viralização) com as regras da casa (memórias do dono). */
export const GUIA_DA_COPY = {
  versao: VERSAO_DA_COPY_VIRAL,
  gancho: [
    "O gancho dá a resposta ou o choque já na primeira linha: o primeiro exemplo concreto aparece logo no começo, nada de aquecimento.",
    "Gancho com coisa do mundo real: objeto, lugar, hora do dia, erro que a pessoa comete, frase que ela fala. Nada abstrato.",
    "Gancho que dói ao ler: nomeia a perda, o erro ou a situação constrangedora com as palavras do público, sem humilhar ninguém.",
    "Um gancho por peça. Teste mental: alguém do nicho pararia o dedo? Se a frase serve para qualquer empresa, está fraca.",
  ],
  clareza: [
    "Uma ideia por lâmina; leitura em 3 segundos; título com até 8 palavras.",
    "Diga o que a pessoa ganha ou evita em palavras simples; termo técnico só com tradução na mesma frase.",
    "Corpo em escada ou trio (ruim, bom, melhor; passo 1, 2, 3) e cada passo puxa o próximo.",
    "Contexto antes do conselho: quem, quando, onde. O público precisa entender a situação sem ter visto os posts anteriores.",
  ],
  viral: [
    "Útil de verdade: passo, sinal, erro, comparação ou frase pronta que a pessoa usa hoje no dia a dia. Isso faz salvar.",
    "Dê um motivo para mandar a alguém (\"manda para quem...\") ou para comentar (pergunta fechada, mito ou verdade, enquete).",
    "CTA de seguir como último degrau, leve e com graça, ligado ao ganho (\"segue para mais desses\"), nunca pedindo favor.",
    "Prefira a verdade do negócio, o bastidor e a história real a dado de aula; conteúdo de manual soa roteiro.",
  ],
  humanizer: [
    "Fale como gente do ramo fala no balcão: frases curtas, voz ativa, você e a gente.",
    "Sem travessão; sem pergunta-ponte (\"O resultado?\"); sem contraste montado (\"não é X, é Y\"); sem sinceridade encenada (\"vou ser sincero\").",
    "Sem clichê de IA: \"no mundo de hoje\", \"eleve\", \"desbloqueie\", \"jornada\", \"potencialize\", \"transforme sua vida\", \"divisor de águas\", \"faz toda a diferença\".",
    "Sem três adjetivos vazios em fila e sem frase de efeito que não diz nada; no máximo 3 emojis.",
  ],
  verdade: [
    "Número, data, depoimento, prêmio, resultado e prova só com fonte no contexto do cliente ou no pedido. Sem fonte, fica de fora.",
    "Sem promessa proibida: resultado garantido, cura, ganho de dinheiro, mudança de corpo, urgência ou escassez falsa.",
    "História só se for real (do cérebro do cliente, da base ou do pedido); senão use situação do dia a dia do público, sem nome inventado.",
  ],
};

export function blocoDoGuia(): string {
  return [
    `GUIA DA COPY DA CASA (versão ${GUIA_DA_COPY.versao})`,
    "Gancho:", ...GUIA_DA_COPY.gancho.map((l) => `- ${l}`),
    "Clareza:", ...GUIA_DA_COPY.clareza.map((l) => `- ${l}`),
    "Viralização (salvar, compartilhar, comentar, seguir):", ...GUIA_DA_COPY.viral.map((l) => `- ${l}`),
    "Humanizer:", ...GUIA_DA_COPY.humanizer.map((l) => `- ${l}`),
    "Verdade:", ...GUIA_DA_COPY.verdade.map((l) => `- ${l}`),
  ].join("\n");
}

// ------------------------------------------------------------------ contexto forte e o bloco da skill

export type ContextoDaCopy = {
  cliente?: string | null;
  nicho?: string | null;
  publico?: string | null;
  dor?: string | null;
  oferta?: string | null;
  /** O que o cliente já ensinou: cérebro do cliente e base dos agentes. */
  ensinou?: string | null;
  hype?: string | null;
  trending?: string | null;
  /** Fatos, números com fonte e situações do dia a dia. */
  mundo_real?: string | null;
};

const ROTULOS_DO_CONTEXTO: Array<[keyof ContextoDaCopy, string]> = [
  ["cliente", "Cliente"],
  ["nicho", "Nicho"],
  ["publico", "Público"],
  ["dor", "Dor real do público"],
  ["oferta", "Oferta"],
  ["ensinou", "O que o cliente já ensinou (cérebro e base dos agentes)"],
  ["hype", "Hype e datas"],
  ["trending", "Em alta (Trending)"],
  ["mundo_real", "Mundo real (fatos e números com fonte)"],
];

/** Os campos obrigatórios que faltam (nicho, público, dor, oferta): o modelo é avisado para não inventar. */
export function faltasDoContexto(c: ContextoDaCopy): string[] {
  const obrigatorios: Array<keyof ContextoDaCopy> = ["nicho", "publico", "dor", "oferta"];
  return obrigatorios.filter((k) => !String(c[k] == null ? "" : c[k]).trim()).map((k) => {
    const r = ROTULOS_DO_CONTEXTO.filter((x) => x[0] === k)[0];
    return r ? r[1] : String(k);
  });
}

const TETO_POR_CAMPO = 900;

export function blocoDoContexto(c: ContextoDaCopy): string {
  const linhas: string[] = [];
  ROTULOS_DO_CONTEXTO.forEach(([k, rotulo]) => {
    const v = String(c[k] == null ? "" : c[k]).replace(/\s+/g, " ").trim();
    if (v) linhas.push(`- ${rotulo}: ${v.slice(0, TETO_POR_CAMPO)}`);
  });
  const faltas = faltasDoContexto(c);
  if (faltas.length) linhas.push(`- Falta no painel: ${faltas.join(", ")}. Deduza só do que está no contexto completo; não invente.`);
  return linhas.length ? `CONTEXTO FORTE (use em todo texto; o leitor é o público deste nicho):\n${linhas.join("\n")}` : "";
}

export type PedidoDaCopyViral = {
  contexto: ContextoDaCopy;
  ganchos: Gancho[];
  formato: FormatoDoGancho;
  /** Quantas versões a chamada escreve (2 ou 3); 1 nas gerações em lote (vários posts por chamada). */
  versoes?: number;
};

/** A skill "copy viral do nicho" no prompt: contexto forte, exemplos do banco e o guia da casa. */
export function blocoDaCopyViral(p: PedidoDaCopyViral): string {
  const versoes = Math.max(1, Math.min(3, p.versoes || 1));
  const ganchos = blocoDosGanchos(p.ganchos);
  return [
    `SKILL: COPY VIRAL DO NICHO (motor de copy da casa, ${VERSAO_DA_COPY_VIRAL}; formato: ${ROTULO_DO_FORMATO[p.formato]})`,
    "Objetivo: texto que para o dedo, que o público entende de primeira, que serve para o dia a dia dele e que dá vontade de salvar, mandar para alguém, comentar e seguir.",
    blocoDoContexto(p.contexto),
    ganchos,
    blocoDoGuia(),
    versoes > 1
      ? `Escreva ${versoes} versões com GANCHOS DE FÓRMULAS DIFERENTES (ex.: uma de erro, uma de curiosidade, uma de escada); o Jev escolhe a mais forte.`
      : "Antes de escrever, escolha a fórmula de gancho que mais combina com o tema e o público (ex.: erro, curiosidade, escada) e varie a fórmula entre as peças.",
  ].filter(Boolean).join("\n\n");
}

// ------------------------------------------------------------------ humanizer em código

type Troca = [RegExp, string | ((...partes: string[]) => string), string];

const DESBLOQUEIE: Record<string, string> = { ie: "abra", ar: "abrir", ando: "abrindo" };

/**
 * Trocas por regra (sem reescrever o sentido): o que soa a IA some ou vira
 * palavra comum. Comparação sem acento só na detecção; a troca preserva o resto.
 */
const TROCAS: Troca[] = [
  [/\b(no|nos) (mundo|dias) (de hoje|atual|atuais|moderno|acelerado|digital)\s*,?\s*/gi, "", "abertura \"no mundo de hoje\""],
  [/\bem um mundo (cada vez mais|onde) [^,.!?\n]{1,60},\s*/gi, "", "abertura \"em um mundo cada vez mais\""],
  [/\b(no|ao) fim do dia\s*,?\s*/gi, "", "\"no fim do dia\""],
  [/\b(vou ser|sendo) (bem )?(sincer[oa]|honest[oa]|diret[oa])\s*[:,]?\s*/gi, "", "sinceridade encenada"],
  [/\b(papo reto|sem rodeios|verdade seja dita|real talk)\s*[:,]?\s*/gi, "", "sinceridade encenada"],
  [/\b(spoiler|plot twist)\s*:\s*/gi, "", "frase-ponte"],
  [/\baqui est[aá] (o que|como|por que|a verdade)\s*:?\s*/gi, "", "frase-ponte"],
  [/\bprepare-se para\s+/gi, "", "chamada feita"],
  [/\bdesbloque(ie|ar|ando)\b/gi, (_m: string, f: string) => DESBLOQUEIE[f.toLowerCase()] || "abrir", "\"desbloqueie\""],
  [/\bpotencializ(e|ar|ando|a)\b/gi, "aument$1", "\"potencialize\""],
  [/\balavanc(ar|ando|ada|ado|ou)\b/gi, "aument$1", "\"alavancar\""],
  [/\bele(ve|var) (o|a|os|as|seu|sua) ([^ ,.!?\n]+) ao pr[oó]ximo n[ií]vel\b/gi, (_m: string, f: string, a: string, b: string) => `${f.toLowerCase() === "ve" ? "melhore" : "melhorar"} ${a} ${b}`, "\"eleve ao próximo nível\""],
  [/\bao pr[oó]ximo n[ií]vel\b/gi, "", "\"próximo nível\""],
  [/\bjornada(s?)\b/gi, "caminhada$1", "\"jornada\""],
  [/\btransform(e|ar) (sua|seu) (vida|neg[oó]cio|rotina|empresa)\b/gi, "mud$1 $2 $3", "\"transforme sua vida\""],
  [/\bdivisor de [aá]guas\b/gi, "mudança grande", "\"divisor de águas\""],
  [/\bvirada de chave\b/gi, "mudança", "\"virada de chave\""],
  [/\bgame ?changer\b/gi, "mudança grande", "\"game changer\""],
  [/\bfaz toda a diferen[cç]a\b/gi, "muda o resultado", "\"faz toda a diferença\""],
  [/\bfazer a diferen[cç]a\b/gi, "mudar o resultado", "\"fazer a diferença\""],
  [/\brevolucion[aá]ri([oa])\b/gi, "nov$1", "\"revolucionário\""],
  [/\bsinergia\b/gi, "parceria", "\"sinergia\""],
  [/\bmergulh(e|ar|ando) (fundo )?(em|no|na|nos|nas)\b/gi, "entr$1 $3", "\"mergulhe\""],
  [/\btudo isso e muito mais\b/gi, "e mais", "\"tudo isso e muito mais\""],
  [/!{2,}/g, "!", "exclamação repetida"],
  [/\?{2,}/g, "?", "interrogação repetida"],
];

/** "O resultado? X." vira "X." (pergunta-ponte que se responde sozinha). */
const PERGUNTA_PONTE = /(^|[.!?]\s+|\n)(o|a) (resultado|resposta|verdade|segredo|detalhe|pegadinha|virada|li[cç][aã]o|melhor parte)\?\s+/gi;

const TRAVESSAO_INICIO = /^[ \t]*[\u2014\u2013][ \t]*/gm;
const TRAVESSAO_MEIO = /[ \t]*\u2014[ \t]*|[ \t]+\u2013[ \t]+/g;

function maiusculaDepoisDoCorte(t: string): string {
  return t.replace(/(^|[.!?]\s+|\n)([a-z\u00e0-\u00fc])/g, (_m, a: string, b: string) => a + b.toUpperCase());
}

const EMOJI = /[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27bf]\ufe0f?/g;

/** Passada de humanizer: corta clichê, travessão, ponte e emoji demais. Não muda fato nem ordem das ideias. */
export function humanizar(bruto: unknown): { texto: string; mudancas: string[] } {
  let t = String(bruto == null ? "" : bruto).replace(/\r\n?/g, "\n");
  const mudancas: string[] = [];
  const marcar = (m: string) => { if (mudancas.indexOf(m) < 0) mudancas.push(m); };
  if (TRAVESSAO_INICIO.test(t) || /\u2014|[ \t]\u2013[ \t]/.test(t)) {
    t = t.replace(TRAVESSAO_INICIO, "").replace(TRAVESSAO_MEIO, ", ").replace(/,\s*([.!?,])/g, "$1");
    marcar("travessão");
  }
  TRAVESSAO_INICIO.lastIndex = 0;
  if (PERGUNTA_PONTE.test(t)) {
    PERGUNTA_PONTE.lastIndex = 0;
    t = t.replace(PERGUNTA_PONTE, "$1");
    marcar("pergunta-ponte");
  }
  PERGUNTA_PONTE.lastIndex = 0;
  TROCAS.forEach(([re, por, nome]) => {
    re.lastIndex = 0;
    if (re.test(t)) {
      re.lastIndex = 0;
      t = typeof por === "string" ? t.replace(re, por) : t.replace(re, por);
      marcar(nome);
    }
    re.lastIndex = 0;
  });
  // Emojis: no máximo 3 (os primeiros ficam).
  let vistos = 0;
  const antes = t;
  t = t.replace(EMOJI, (e) => (++vistos <= 3 ? e : ""));
  if (t !== antes) marcar("emojis demais");
  t = t.split("\n").map((l) => l.replace(/[ \t]{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  t = maiusculaDepoisDoCorte(t);
  return { texto: t, mudancas };
}

// ------------------------------------------------------------------ nada inventado

/** Frases do texto, com o fim de linha preservado (sem lookbehind). */
function frases(t: string): string[] {
  // Ponto ou vírgula antes de dígito (1.200, 4,5) não fecha a frase.
  return t.match(/(?:[^.!?\n]|[.,](?=\d))+[.!?]*[ \t]*\n*|\n+/g) || [];
}

const NUMERO_DE_PROVA = /(r\$\s*\d|\d[\d.,]*\s*(%|por cento|mil\b|milh|bilh|x\b|vezes|reais|clientes|pacientes|pessoas|alunos|avalia|estrelas|seguidores|vendas|pedidos|anos de|casos))/i;
const DEPOIMENTO = /("[^"\n]{8,}"|\u201c[^\u201d\n]{8,}\u201d)\s*[,.]?\s*(diz|disse|conta|contou|afirma|escreveu|comentou)|\b(segundo|como diz) (um|uma|o|a|nosso|nossa) (cliente|paciente|aluno|aluna)|nossos clientes (dizem|falam|garantem)/i;
const PROVA_SEM_FONTE = /\b(estudos?|pesquisas?|levantamento|dados) (mostra|mostram|comprova|comprovam|revela|revelam|aponta|apontam|indica|indicam)\b|cientificamente comprovad|comprovad[oa] (por|pela|pelo)\b|\bpremiad[oa]\b|\beleit[oa] (o|a) melhor\b/i;
const CHAVE_VAZIA = /\{[^}\n]{1,40}\}/;

function numerosDa(frase: string): string[] {
  return (frase.match(/\d+(?:[.,]\d+)?/g) || []).map((n) => n.replace(/[.,]/g, ""));
}

/** O que está entre aspas (o depoimento); sem aspas, a frase. */
function citacaoDa(frase: string): string {
  const m = frase.match(/"([^"\n]+)"|\u201c([^\u201d\n]+)\u201d/);
  return (m ? m[1] || m[2] || "" : frase).trim();
}

function palavrasProprias(frase: string): string[] {
  return (frase.match(/\b[A-Z\u00c0-\u00dd][a-z\u00e0-\u00ff]{2,}/g) || []).slice(1);
}

/**
 * Tira do texto as frases com número de prova, depoimento ou prova sem fonte
 * que não aparecem nas fontes (contexto do cliente, pedido, item do plano), e
 * as chaves {assim} que o modelo deixou sem dado. Se tudo cairia, devolve o
 * texto como veio e o motivo (a equipe decide).
 */
export function cortarNaoComprovado(bruto: unknown, fontes: unknown): { texto: string; cortes: string[] } {
  const t = String(bruto == null ? "" : bruto);
  const f = semAcento(typeof fontes === "string" ? fontes : fontes == null ? "" : JSON.stringify(fontes));
  const fDigitos = f.replace(/[.,]/g, "");
  const cortes: string[] = [];
  const ficam: string[] = [];
  frases(t).forEach((frase) => {
    const s = frase.trim();
    if (!s) { ficam.push(frase); return; }
    let motivo = "";
    if (CHAVE_VAZIA.test(s)) motivo = "chave sem dado real";
    else if (NUMERO_DE_PROVA.test(s) && numerosDa(s).some((n) => n.length && fDigitos.indexOf(n) < 0)) motivo = "número sem fonte";
    else if (DEPOIMENTO.test(s) && f.indexOf(semAcento(citacaoDa(s)).slice(0, 30)) < 0) motivo = "depoimento sem fonte";
    else if (PROVA_SEM_FONTE.test(s) && !palavrasProprias(s).some((p) => f.indexOf(semAcento(p)) >= 0) && !numerosDa(s).some((n) => fDigitos.indexOf(n) >= 0)) motivo = "prova sem fonte";
    if (motivo) cortes.push(`${motivo}: "${s.slice(0, 90)}"`);
    else ficam.push(frase);
  });
  if (!cortes.length) return { texto: t, cortes };
  const texto = ficam.join("").replace(/\n{3,}/g, "\n\n").trim();
  if (!texto) return { texto: t, cortes: cortes.concat(["nada sobraria: o texto ficou como veio para a equipe conferir"]) };
  return { texto, cortes };
}

/** Humanizer e corte do que não tem fonte, juntos (a passada final na versão escolhida). */
export function passadaFinal(bruto: unknown, fontes: unknown): { texto: string; mudancas: string[]; cortes: string[] } {
  const c = cortarNaoComprovado(bruto, fontes);
  const h = humanizar(c.texto);
  return { texto: h.texto, mudancas: h.mudancas, cortes: c.cortes };
}

// ------------------------------------------------------------------ Jev: as 5 notas virais

const NIVEIS_GANCHO = [
  "Não para ninguém: começa explicando, agradecendo ou com frase que serviria para qualquer empresa.",
  "Fraco: o assunto aparece, mas sem tensão, curiosidade nem situação reconhecível.",
  "Razoável: tem um gancho, mas genérico; quem é do nicho talvez pare.",
  "Forte: a primeira linha nomeia um erro, uma dor, um número útil ou uma cena real do público e cria vontade de ler o resto.",
  "Para o dedo: primeira linha específica do nicho que incomoda, surpreende ou entrega a resposta de cara; quase impossível passar direto.",
];
const NIVEIS_CLAREZA = [
  "Confuso: não dá para saber do que se trata nem para quem é.",
  "Difícil: precisa reler; mistura ideias ou usa termo sem explicar.",
  "Entende-se com esforço: a ideia está lá, mas demora mais de 3 segundos.",
  "Claro: em 3 segundos dá para saber o assunto e o que a pessoa ganha.",
  "Cristalino: uma ideia só, palavras do público, entendido de primeira por quem nunca viu a marca.",
];
const NIVEIS_NICHO = [
  "Genérico: serviria para qualquer negócio de qualquer ramo.",
  "Pouco do nicho: cita o ramo, mas sem situação, palavra ou dor de quem compra dele.",
  "Do nicho: fala do ramo com algum detalhe concreto.",
  "Conversa com o nicho: usa situação, vocabulário e dor reais do público deste ramo.",
  "Só podia ser deste nicho: detalhe que só quem vive o ramo conhece e o público reconhece na hora.",
];
const NIVEIS_UTILIDADE = [
  "Nada útil: só fala da empresa ou faz promoção sem informação.",
  "Pouco útil: conselho vago que a pessoa já sabia.",
  "Útil: uma dica ou informação que ajuda.",
  "Muito útil: passo, sinal, erro ou comparação concreta que a pessoa usa hoje.",
  "Indispensável: algo prático e específico que a pessoa guarda para usar e não acha fácil em outro lugar.",
];
const NIVEIS_COMPARTILHAR = [
  "Ninguém salva, manda ou comenta.",
  "Talvez uma curtida, sem motivo para salvar ou mandar.",
  "Algumas pessoas salvariam ou comentariam.",
  "Dá vontade de salvar para depois ou mandar para alguém que precisa.",
  "Feito para circular: a pessoa salva, marca um amigo, comenta a resposta e segue para ver mais.",
];

export const DIMENSOES_VIRAIS = ["gancho", "clareza", "nicho", "utilidade", "compartilhar"] as const;
export type DimensaoViral = typeof DIMENSOES_VIRAIS[number];

/** Peso de cada dimensão na nota viral (política explícita em código; somam 1). */
export const PESOS_VIRAIS: Record<DimensaoViral, number> = { gancho: 0.3, clareza: 0.2, nicho: 0.2, utilidade: 0.15, compartilhar: 0.15 };

const NIVEIS: Record<DimensaoViral, string[]> = { gancho: NIVEIS_GANCHO, clareza: NIVEIS_CLAREZA, nicho: NIVEIS_NICHO, utilidade: NIVEIS_UTILIDADE, compartilhar: NIVEIS_COMPARTILHAR };

export type PerguntaScoreViral = { type: "score"; instructions: string; criteria: string[] };

/**
 * As 5 perguntas Score por versão, no mesmo estado da conferência do motor
 * (copies.c0, c1...), que ganha `nicho` e `publico`. Uma chamada só ao Jev.
 */
export function perguntasDaViralidade(n: number): Record<string, PerguntaScoreViral> {
  const q: Record<string, PerguntaScoreViral> = {};
  for (let i = 0; i < n; i++) {
    const c = `\`copies.c${i}\``;
    q[`v_gancho_${i}`] = { type: "score", instructions: `Para alguém do \`publico\` rolando o feed no nicho \`nicho\`, quanto a primeira linha de ${c} faz parar e querer ler o resto?`, criteria: NIVEIS_GANCHO };
    q[`v_clareza_${i}`] = { type: "score", instructions: `Quanto ${c} é claro para o \`publico\`: em 3 segundos dá para saber o assunto e o que a pessoa ganha?`, criteria: NIVEIS_CLAREZA };
    q[`v_nicho_${i}`] = { type: "score", instructions: `Quanto ${c} conversa com o nicho \`nicho\` e com o \`publico\` (situação, vocabulário e dor reais), em vez de servir para qualquer negócio?`, criteria: NIVEIS_NICHO };
    q[`v_utilidade_${i}`] = { type: "score", instructions: `Quanto ${c} entrega algo útil e concreto que o \`publico\` usa no dia a dia?`, criteria: NIVEIS_UTILIDADE };
    q[`v_compartilhar_${i}`] = { type: "score", instructions: `Quanto ${c} dá vontade de salvar, mandar para alguém, comentar ou seguir a marca?`, criteria: NIVEIS_COMPARTILHAR };
  }
  return q;
}

export type NotaViral = { gancho: number | null; clareza: number | null; nicho: number | null; utilidade: number | null; compartilhar: number | null; nota: number | null };

type RespostaScore = { score?: number } | undefined;

/** Lê as 5 notas (0 a 10) e a nota viral ponderada (0 a 100). Sem resposta, null. */
export function lerViralidade(answers: Record<string, RespostaScore> | null | undefined, n: number): NotaViral[] {
  const saida: NotaViral[] = [];
  for (let i = 0; i < n; i++) {
    const v: NotaViral = { gancho: null, clareza: null, nicho: null, utilidade: null, compartilhar: null, nota: null };
    let soma = 0;
    let pesos = 0;
    DIMENSOES_VIRAIS.forEach((d) => {
      const r = answers ? answers[`v_${d}_${i}`] : undefined;
      if (r && typeof r.score === "number" && isFinite(r.score)) {
        const nota = Math.round((r.score / (NIVEIS[d].length - 1)) * 100) / 10;
        v[d] = nota;
        soma += nota * PESOS_VIRAIS[d];
        pesos += PESOS_VIRAIS[d];
      }
    });
    v.nota = pesos > 0 ? Math.round((soma / pesos) * 10) : null;
    saida.push(v);
  }
  return saida;
}

/** Peso da nota viral contra a conferência da casa (voz, verdade, clichê) na escolha final. */
export const PESO_DA_NOTA_VIRAL = 0.55;

export type CandidataDaEscolha = { indice: number; nota: number; alerta: boolean };

/**
 * Ordem final: sem alerta (fato inventado ou promessa) antes; depois a nota
 * combinada (conferência da casa e nota viral). Sem nota viral, vale só a
 * conferência; empate fica na ordem escrita.
 */
export function ordemComViralidade(conferencias: CandidataDaEscolha[], virais: NotaViral[]): Array<CandidataDaEscolha & { combinada: number; viral: NotaViral | null }> {
  return conferencias
    .map((c) => {
      const v = virais[c.indice] || null;
      const combinada = v && v.nota != null ? Math.round(c.nota * (1 - PESO_DA_NOTA_VIRAL) + v.nota * PESO_DA_NOTA_VIRAL) : c.nota;
      return { indice: c.indice, nota: c.nota, alerta: c.alerta, combinada, viral: v };
    })
    .sort((a, b) => Number(a.alerta) - Number(b.alerta) || b.combinada - a.combinada || a.indice - b.indice);
}

/** Uma linha para a tela: as notas virais da escolhida. */
export function porqueViral(v: NotaViral | null): string {
  if (!v || v.nota == null) return "";
  const f = (x: number | null) => (x == null ? "?" : String(x).replace(".", ","));
  return `Viral ${v.nota} de 100 (gancho ${f(v.gancho)}, clareza ${f(v.clareza)}, nicho ${f(v.nicho)}, utilidade ${f(v.utilidade)}, compartilhar ${f(v.compartilhar)}).`;
}

// ------------------------------------------------------------------ modelo da copy

/** Papel do catálogo (ia_modelos.padrao_para) do modelo "o melhor para copy". */
export const PAPEL_DA_COPY = "copy";

export type ModeloDoCatalogo = {
  id: string;
  tipo?: string | null;
  ativo?: boolean | null;
  disponivel?: boolean | null;
  padrao_para?: string[] | null;
  rotulo?: string | null;
};

export type EscolhaDoModeloDaCopy<M extends ModeloDoCatalogo> = { modelo: M | null; motivo: "escolhido" | "padrao_copy" | "estrategista" | "nenhum" };

const usavel = (m: ModeloDoCatalogo | null | undefined) => !!m && (m.tipo == null || m.tipo === "texto") && m.ativo !== false && m.disponivel !== false;

/**
 * O modelo da copy: o escolhido (ativo e de texto); senão o marcado "copy" no
 * catálogo (o melhor para copy); senão o do estrategista; senão nenhum.
 */
export function escolherModeloDaCopy<M extends ModeloDoCatalogo>(catalogo: M[], escolhidoId?: string | null): EscolhaDoModeloDaCopy<M> {
  const lista = (catalogo || []).filter(usavel);
  const id = String(escolhidoId || "").trim();
  if (id) {
    const m = lista.filter((x) => x.id === id)[0];
    if (m) return { modelo: m, motivo: "escolhido" };
  }
  const tem = (papel: string) => lista.filter((x) => Array.isArray(x.padrao_para) && x.padrao_para.indexOf(papel) >= 0)[0];
  const copy = tem(PAPEL_DA_COPY);
  if (copy) return { modelo: copy, motivo: "padrao_copy" };
  const estrategista = tem("estrategista");
  if (estrategista) return { modelo: estrategista, motivo: "estrategista" };
  return { modelo: null, motivo: "nenhum" };
}
