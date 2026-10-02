/**
 * Copy de resposta direta do Estúdio Ads (pedido do dono em 02/10/2026: "o
 * conteúdo está genérico; a arte está boa, o conteúdo não"). Puro: sem Deno,
 * sem banco e sem rede; o vitest lê o mesmo arquivo. Sem travessão.
 *
 * O que mora aqui:
 * - ANGULOS_DE_VENDA: dor, desejo, prova, objeção e urgência, cada um com o
 *   rótulo da tela e a instrução para o modelo. As variações de um ângulo do
 *   plano saem cada uma num ângulo de venda diferente (prova só com prova real
 *   no briefing ou na oferta; urgência só com urgência real na oferta).
 * - fatosDaOferta: os fatos concretos da oferta (ads_ofertas) e do briefing,
 *   e os termos que provam que a copy fala DESTE negócio (especificidade).
 * - blocoDeRespostaDireta: a estrutura gancho na primeira linha, dor ou
 *   desejo, prova, oferta e CTA, com os fatos e a política da Meta.
 * - conferirAnuncio: o conferente em código contra o genérico (clichês da
 *   casa e de anúncio, gancho fraco, nada concreto da oferta, sem CTA) e
 *   contra a política (atributo pessoal, promessa irreal). Quem reprova vai
 *   para UMA reescrita só (pedidoDeReescrita), nunca um laço.
 */

import { conferirCopy } from "../../_shared/motor-de-copy.ts";

export type AnguloDeVenda = "dor" | "desejo" | "prova" | "objecao" | "urgencia";
export const ANGULOS_DE_VENDA_IDS: AnguloDeVenda[] = ["dor", "desejo", "prova", "objecao", "urgencia"];

export const ANGULOS_DE_VENDA: Record<AnguloDeVenda, { rotulo: string; instrucao: string }> = {
  dor: {
    rotulo: "Dor",
    instrucao: "abre na situação incômoda que o público vive hoje, com as palavras dele e um detalhe concreto (onde, quando, quanto custa ficar assim); a oferta resolve essa dor",
  },
  desejo: {
    rotulo: "Desejo",
    instrucao: "abre no resultado que o público quer, descrito como cena concreta do depois (sem prometer corpo, saúde ou renda); a oferta é o caminho até essa cena",
  },
  prova: {
    rotulo: "Prova",
    instrucao: "abre na prova real que está nos fatos (número, depoimento autorizado, tempo de casa, quantidade atendida, demonstração); nunca invente prova",
  },
  objecao: {
    rotulo: "Objeção",
    instrucao: "abre na objeção mais comum do público (preço, tempo, confiança, \"será que serve para mim\") e quebra com um fato da oferta (garantia, entregável, condição)",
  },
  urgencia: {
    rotulo: "Urgência",
    instrucao: "abre no prazo, na vaga ou na condição que acaba, e só se estiver nos fatos como urgência real; diga até quando e por quê",
  },
};

/** Ângulo de venda conhecido ou null (o modelo às vezes escreve o rótulo). */
export function anguloDeVenda(v: unknown): AnguloDeVenda | null {
  const s = semAcento(String(v == null ? "" : v)).replace(/[^a-z]/g, "");
  if (s === "dor" || s === "desejo" || s === "prova" || s === "objecao" || s === "urgencia") return s;
  return null;
}

/**
 * Ângulos de venda para N variações, cada uma diferente. Prova só com prova
 * real; urgência só com urgência real. Sobrando variações, repete a roda.
 */
export function angulosParaVariacoes(n: number, fatos: { temProva: boolean; temUrgencia: boolean }): AnguloDeVenda[] {
  const roda = ANGULOS_DE_VENDA_IDS.filter((a) => (a === "prova" ? fatos.temProva : a === "urgencia" ? fatos.temUrgencia : true));
  const saida: AnguloDeVenda[] = [];
  for (let i = 0; i < Math.max(1, Math.min(n, 8)); i++) saida.push(roda[i % roda.length]);
  return saida;
}

// ------------------------------------------------------------ fatos da oferta

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** A oferta como ads_ofertas guarda (campo oferta) ou como ofertaDaLinha devolve. */
export type OfertaParaCopy = {
  nome?: string | null;
  para_quem?: string | null;
  promessa?: string | null;
  mecanismo?: string | null;
  entregaveis?: string[] | null;
  bonus?: string[] | null;
  garantia?: string | null;
  urgencia_real?: string | null;
  ancoragem?: string | null;
  cta?: string | null;
};

/** O pedaço do briefing de performance que a copy usa. */
export type BriefingParaCopy = {
  oferta?: Record<string, unknown> | null;
  publico?: Record<string, unknown> | null;
  objecoes?: unknown;
  provas?: unknown;
  destino?: Record<string, unknown> | null;
} | null;

export type FatosDaOferta = {
  /** Uma linha por fato, para o prompt. */
  linhas: string[];
  /** Termos concretos (palavras de 4+ letras dos fatos) que provam que a copy fala deste negócio. */
  termos: string[];
  temProva: boolean;
  temUrgencia: boolean;
};

const PALAVRAS_VAZIAS = new Set([
  "para", "pela", "pelo", "como", "mais", "menos", "muito", "muita", "todo", "toda", "todos", "todas", "voce", "voces", "seu", "sua", "seus", "suas",
  "nosso", "nossa", "nossos", "nossas", "isso", "esse", "essa", "este", "esta", "aqui", "agora", "sempre", "nunca", "cada", "entre", "sobre", "quem",
  "qual", "quais", "onde", "quando", "porque", "pois", "tambem", "ainda", "apenas", "mesmo", "mesma", "outro", "outra", "fazer", "feito", "feita",
  "ter", "tem", "tenha", "ser", "sao", "seja", "esta", "estao", "pode", "podem", "deve", "precisa", "qualquer", "algum", "alguma", "melhor", "melhores",
  "qualidade", "servico", "servicos", "produto", "produtos", "cliente", "clientes", "empresa", "negocio", "pessoas", "pessoa", "publico", "oferta",
  "resultado", "resultados", "solucao", "atendimento", "experiencia", "vida", "dia", "dias", "hoje", "garantia", "bonus", "nao", "sim", "com", "sem",
]);

function textoDe(v: unknown, max = 400): string {
  if (v == null) return "";
  if (typeof v === "string") return v.replace(/\s+/g, " ").trim().slice(0, max);
  if (Array.isArray(v)) return v.map((x) => textoDe(x, 200)).filter(Boolean).join("; ").slice(0, max);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  // Itens do briefing ({ texto, fonte }): só o texto; prova sem autorização não conta.
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return o.autorizado === false ? "" : textoDe(o.texto, max);
  }
  return "";
}

/** Palavras de 4+ letras, sem as vazias, sem repetir (forma sem acento, minúscula). */
export function termosConcretos(textos: string[], max = 40): string[] {
  const vistos: string[] = [];
  for (const t of textos) {
    for (const p of semAcento(t).split(/[^a-z0-9]+/)) {
      if (p.length < 4 || PALAVRAS_VAZIAS.has(p) || /^\d+$/.test(p)) continue;
      if (vistos.indexOf(p) < 0) vistos.push(p);
      if (vistos.length >= max) return vistos;
    }
  }
  return vistos;
}

/** Fatos verificáveis da oferta e do briefing, na ordem em que a copy deve usar. Vazio fica de fora. */
export function fatosDaOferta(oferta: OfertaParaCopy | null | undefined, briefing: BriefingParaCopy = null): FatosDaOferta {
  const o = oferta ?? {};
  const bo = (briefing && briefing.oferta) || {};
  const bp = (briefing && briefing.publico) || {};
  const provas = briefing ? briefing.provas : null;
  const pares: Array<[string, string]> = [
    ["Oferta", textoDe(o.nome) || textoDe(bo.produto)],
    ["Para quem", textoDe(o.para_quem) || textoDe(bp.quem)],
    ["Promessa", textoDe(o.promessa) || textoDe(bo.promessa)],
    ["Como funciona", textoDe(o.mecanismo)],
    ["O que leva", textoDe(o.entregaveis)],
    ["Bônus", textoDe(o.bonus)],
    ["Preço ou condição", textoDe(bo.preco_confirmado) || textoDe(bo.condicao) || textoDe(o.ancoragem)],
    ["Garantia", textoDe(o.garantia) || textoDe(bo.garantia)],
    ["Urgência real", textoDe(o.urgencia_real)],
    ["Situações do público", textoDe(bp.situacoes)],
    ["Motivações do público", textoDe(bp.motivacoes)],
    ["Objeções do público", textoDe(briefing ? briefing.objecoes : null)],
    ["Provas reais", textoDe(provas)],
    ["Ação final", textoDe(o.cta)],
  ];
  const linhas = pares.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
  const termos = termosConcretos([textoDe(o.nome), textoDe(bo.produto), textoDe(o.para_quem), textoDe(bp.quem), textoDe(o.promessa), textoDe(bo.promessa), textoDe(o.mecanismo), textoDe(o.entregaveis), textoDe(o.bonus)]);
  const temProva = !!textoDe(provas) && !/^(nenhuma|nao|sem)\b/.test(semAcento(textoDe(provas)));
  return { linhas, termos, temProva, temUrgencia: !!textoDe(o.urgencia_real) };
}

// ------------------------------------------------------------ bloco do prompt

/** Clichês de anúncio que não estão no motor de copy da casa (os de IA já estão lá). */
export const CLICHES_DE_ANUNCIO: Array<[RegExp, string]> = [
  [/nao perca (essa|esta|a) (oportunidade|chance)/, "não perca essa oportunidade"],
  [/oferta imperdivel|imperdivel/, "imperdível"],
  [/(qualidade|atendimento|o cuidado) que voce merece|voce merece (o melhor|mais)/, "você merece"],
  [/a solucao (que voce|ideal|perfeita|completa)/, "a solução ideal"],
  [/(de forma|de um jeito|de maneira) (simples|facil|pratica) e (rapida|eficiente|segura)/, "simples e rápido"],
  [/tudo (o )?que voce precisa (em um so lugar|esta aqui)?/, "tudo que você precisa"],
  [/(clique|toque) (aqui )?e saiba mais|saiba mais (agora|ja)/, "clique e saiba mais"],
  [/aproveite (ja|agora|essa)/, "aproveite já"],
  [/(preco|precos) justo|melhor custo.?beneficio/, "preço justo"],
  [/(sua|a) melhor escolha|a escolha certa/, "a melhor escolha"],
  [/(atendimento|servico) de qualidade|alta qualidade|qualidade garantida/, "qualidade sem prova"],
  [/somos (especialistas|referencia|lideres)|referencia no mercado/, "somos referência"],
  [/(venha|vem) (nos )?(conhecer|fazer uma visita)/, "venha conhecer"],
];

const SEM_TRAVESSAO = "Sem travessão.";

/**
 * O bloco que vai no pedido da copy de anúncio: a estrutura de resposta
 * direta, os fatos da oferta (os únicos que podem aparecer), o ângulo de
 * venda de cada variação e a política da Meta.
 */
export function blocoDeRespostaDireta(e: { fatos: FatosDaOferta; angulos: AnguloDeVenda[]; nicho?: string | null }): string {
  const fatos = e.fatos.linhas.length ? e.fatos.linhas.map((l) => `- ${l}`).join("\n") : "- (sem oferta cadastrada: use só o briefing e o contexto da marca; nada de fato inventado)";
  const variacoes = e.angulos.map((a, i) => `variação ${i + 1}: ${ANGULOS_DE_VENDA[a].rotulo} (${ANGULOS_DE_VENDA[a].instrucao})`).join("; ");
  return [
    `COPY DE RESPOSTA DIRETA (obrigatório${e.nicho ? `; nicho: ${e.nicho}` : ""})`,
    "- Estrutura do texto principal: 1) gancho na PRIMEIRA linha (até 125 caracteres, funciona sozinho, situação ou número reconhecível do público); 2) dor ou desejo com detalhe concreto; 3) prova real (só dos fatos); 4) a oferta com o que a pessoa leva; 5) um CTA com verbo e o que ganha.",
    "- Fale DESTE negócio: cada variação cita pelo menos dois fatos abaixo (o produto ou serviço pelo nome, o público, a promessa, um entregável, a condição). Copy que serviria a qualquer concorrente trocando o nome é reprovada.",
    `- Ângulo de venda de cada variação (preencha angulo_de_venda com o id): ${variacoes}.`,
    "- Política da Meta: nunca afirme nem insinue atributo pessoal de quem lê (saúde, peso, dívida, religião, orientação, etnia, idade, deficiência), como \"você está acima do peso?\" ou \"suas dívidas\"; fale da situação ou do produto (\"para quem quer...\"). Sem promessa irreal (resultado garantido, cura, renda, corpo, prazo milagroso), sem antes e depois de corpo, sem urgência falsa.",
    `- Proibido: ${CLICHES_DE_ANUNCIO.map(([, n]) => `"${n}"`).join(", ")}, além dos clichês de IA da casa. Troque por detalhe concreto. ${SEM_TRAVESSAO}`,
    "FATOS (os únicos que podem aparecer na copy e na arte):",
    fatos,
  ].join("\n");
}

// ------------------------------------------------------------ conferente em código

/** A copy de um anúncio como a conferência lê (texto na arte junto). */
export type AnuncioParaConferir = {
  texto_principal?: string | null;
  texto_principal_longo?: string | null;
  titulo?: string | null;
  descricao?: string | null;
  headline_arte?: string | null;
  apoio_arte?: string | null;
  cta_arte?: string | null;
  cta_meta?: string | null;
};

export type MotivoDoGenerico = "cliche" | "gancho_fraco" | "sem_fato" | "sem_cta" | "atributo_pessoal" | "promessa";

export type ConferenciaDoAnuncio = {
  /** Reprovada: vai para a reescrita única. */
  reprovada: boolean;
  motivos: { tipo: MotivoDoGenerico; texto: string }[];
  /** Termos da oferta que a copy cita (prova de especificidade). */
  citados: string[];
};

/** Abertura vazia de anúncio na primeira linha. */
const ABERTURA_FRACA = /^(voce sabia|descubra|conheca|apresentamos|ola|oi\b|venha|confira|chegou|atencao|novidade|e hoje|imagine|ja pensou|sabe aquele|quer saber)/;

/**
 * Atributo pessoal afirmado ou insinuado na segunda pessoa (política da Meta).
 * "Para quem quer emagrecer" passa; "você está acima do peso?" não.
 */
const ATRIBUTO_PESSOAL = new RegExp(
  "\\b(voce|vc)\\s+(e|esta|tem|sofre|anda|vive|se sente|ficou|continua)\\b[^.!?\\n]{0,40}\\b(" +
    "gord|obes|acima do peso|sobrepeso|diabet|depress|ansios|endividad|negativad|nome sujo|falid|desempregad|divorciad|solteir|gay|lesbic|bissexual|transexual|" +
    "evangelic|catolic|muculman|judeu|ateu|negr|idos|velh|calv|careca|gravid|doente|cancer|hiv|deficien|autist|alcoolatra|viciad|pobre|quebrad" +
    ")|\\b(sua|seu|suas|seus)\\s+(divida|dividas|depressao|ansiedade|diabetes|obesidade|calvicie|doenca|infertilidade|deficiencia|religiao|orientacao sexual)\\b",
);

const CTA_ESCRITO = /\b(chame|chama|agende|marque|clique|toque|envie|mande|peca|garanta|reserve|compre|acesse|visite|fale|ligue|responda|baixe|inscreva|cadastre|solicite|experimente|escolha|confira|consulte|saiba|assista|arraste|converse|pegue|resgate|venha|passe|retire|encomende|teste)\b|whatsapp|direct|link/;

/**
 * Conferência em código, sem rede. Reprova (e manda para a reescrita única)
 * quando: tem clichê de anúncio ou de IA; o gancho da primeira linha é fraco
 * (abertura vazia ou passa de 125 caracteres); não cita nenhum fato concreto
 * da oferta (quando há termos para conferir); não tem CTA escrito; afirma
 * atributo pessoal; ou faz promessa proibida.
 */
export function conferirAnuncio(c: AnuncioParaConferir, fatos: Pick<FatosDaOferta, "termos">): ConferenciaDoAnuncio {
  const principal = String(c.texto_principal || "").trim();
  const longo = String(c.texto_principal_longo || "").trim() || principal;
  const tudo = [principal, longo, c.titulo, c.descricao, c.headline_arte, c.apoio_arte, c.cta_arte].filter(Boolean).join("\n");
  const s = semAcento(tudo);
  const motivos: ConferenciaDoAnuncio["motivos"] = [];
  const cliches = CLICHES_DE_ANUNCIO.filter(([re]) => re.test(s)).map(([, n]) => n);
  const daCasa = conferirCopy(tudo, "anuncio").problemas;
  for (const p of daCasa) if (p.tipo === "cliche") cliches.push(p.texto.replace(/^Clichê de IA: /, "").replace(/\.$/, ""));
  if (cliches.length) motivos.push({ tipo: "cliche", texto: `Clichê: ${cliches.join(", ")}.` });
  const primeira = semAcento(principal.split("\n")[0] || "").trim();
  if (!primeira) motivos.push({ tipo: "gancho_fraco", texto: "Sem primeira linha." });
  else if (ABERTURA_FRACA.test(primeira)) motivos.push({ tipo: "gancho_fraco", texto: "Gancho fraco: a primeira linha abre com frase feita." });
  else if (primeira.length > 125) motivos.push({ tipo: "gancho_fraco", texto: `Gancho com ${primeira.length} caracteres: some antes do "mais".` });
  const citados = fatos.termos.filter((t) => s.indexOf(t) >= 0);
  if (fatos.termos.length >= 3 && !citados.length) motivos.push({ tipo: "sem_fato", texto: "Não cita nada concreto da oferta (produto, público, promessa ou entregável)." });
  if (!CTA_ESCRITO.test(semAcento(longo + "\n" + String(c.cta_arte || "")))) motivos.push({ tipo: "sem_cta", texto: "Sem CTA escrito no texto." });
  if (ATRIBUTO_PESSOAL.test(s)) motivos.push({ tipo: "atributo_pessoal", texto: "Afirma atributo pessoal de quem lê (política da Meta)." });
  const promessas = daCasa.filter((p) => p.tipo === "promessa");
  if (promessas.length) motivos.push({ tipo: "promessa", texto: promessas[0].texto });
  return { reprovada: motivos.length > 0, motivos, citados };
}

/** Só a política (atributo pessoal e promessa): o que não pode ir para a Meta nem depois da reescrita. */
export const motivosDePolitica = (c: ConferenciaDoAnuncio) => c.motivos.filter((m) => m.tipo === "atributo_pessoal" || m.tipo === "promessa");

/**
 * O pedido da reescrita ÚNICA das reprovadas (uma chamada para todas). A
 * resposta volta no mesmo esquema da produção, na mesma ordem, e não passa
 * por outra reescrita: o que ainda reprovar sai com aviso.
 */
export function pedidoDeReescrita(itens: { indice: number; copy: Record<string, unknown>; motivos: string[]; angulo?: AnguloDeVenda | null }[], fatos: FatosDaOferta): string {
  const lista = itens.map((x, k) => ({
    reescrever: k + 1,
    angulo_de_venda: x.angulo ?? null,
    o_que_reprovou: x.motivos,
    copy_atual: x.copy,
  }));
  return [
    "REESCRITA (uma vez só): estas variações foram reprovadas pela conferência da casa. Reescreva cada uma corrigindo o que reprovou, mantendo o ângulo de venda, o formato e o mecanismo.",
    "Devolva as variações reescritas NA MESMA ORDEM, com todos os campos do esquema (variacao = número da lista abaixo).",
    "Regras: gancho concreto na primeira linha; pelo menos dois fatos da lista; um CTA com verbo; nenhum clichê; nenhum atributo pessoal de quem lê; nenhuma promessa irreal.",
    "FATOS:",
    fatos.linhas.length ? fatos.linhas.map((l) => `- ${l}`).join("\n") : "- (sem oferta cadastrada)",
    `REPROVADAS: ${JSON.stringify(lista)}`,
  ].join("\n");
}

/** Uma linha para a tela: o ângulo de venda e o que a conferência viu. */
export function resumoDaConferencia(angulo: AnguloDeVenda | null, conf: ConferenciaDoAnuncio, reescrita: boolean): string {
  const rotulo = angulo ? `Ângulo ${ANGULOS_DE_VENDA[angulo].rotulo.toLowerCase()}` : "Copy";
  if (!conf.reprovada) return `${rotulo}${reescrita ? ", reescrita uma vez e aprovada" : ""}${conf.citados.length ? `; cita ${conf.citados.slice(0, 3).join(", ")}` : ""}.`;
  return `${rotulo}: ${conf.motivos.map((m) => m.texto.replace(/\.$/, "")).join("; ")}.`;
}
