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

export type AnguloDeVenda = "dor" | "desejo" | "prova" | "contrario" | "objecao" | "identidade" | "urgencia";
/** Ordem da roda (22/10/2026: contrário e identidade entram; 3 a 5 variações saem em ângulos distintos). */
export const ANGULOS_DE_VENDA_IDS: AnguloDeVenda[] = ["dor", "desejo", "prova", "contrario", "objecao", "identidade", "urgencia"];

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
  contrario: {
    rotulo: "Contrário",
    instrucao: "abre contrariando a crença comum do nicho (o que todo concorrente diz ou o que o público acha que precisa) e mostra, com um fato da oferta, por que o caminho dela é outro; contrário com razão real, nunca polêmica vazia nem ataque a concorrente pelo nome",
  },
  identidade: {
    rotulo: "Identidade",
    instrucao: "abre no jeito de ser ou na escolha de quem compra (\"para quem não abre mão de...\", \"quem cuida do próprio negócio sabe...\"), fazendo o público se reconhecer pelo que escolhe e valoriza; nunca por atributo pessoal (saúde, corpo, dívida, religião, idade, etnia, orientação)",
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
  if (s === "dor" || s === "desejo" || s === "prova" || s === "objecao" || s === "urgencia" || s === "contrario" || s === "identidade") return s;
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
export function blocoDeRespostaDireta(e: { fatos: FatosDaOferta; angulos: AnguloDeVenda[]; nicho?: string | null; venda?: VendaDaCopy | null }): string {
  const fatos = e.fatos.linhas.length ? e.fatos.linhas.map((l) => `- ${l}`).join("\n") : "- (sem oferta cadastrada: use só o briefing e o contexto da marca; nada de fato inventado)";
  const variacoes = e.angulos.map((a, i) => `variação ${i + 1}: ${ANGULOS_DE_VENDA[a].rotulo} (${ANGULOS_DE_VENDA[a].instrucao})`).join("; ");
  const nicho = e.nicho || (e.venda && e.venda.nicho ? e.venda.nicho.nome : null);
  return [
    `COPY DE RESPOSTA DIRETA (obrigatório${nicho ? `; nicho: ${nicho}` : ""})`,
    "- O criativo existe para VENDER A IDEIA: quem lê entende em 2 segundos o que é, por que é melhor para ele e o que fazer agora. Forte, claro e específico; nada morno.",
    "- Estrutura do texto principal: 1) gancho na PRIMEIRA linha (até 125 caracteres, funciona sozinho, situação ou número reconhecível do público); 2) dor ou desejo com detalhe concreto; 3) prova real (só dos fatos); 4) a oferta com o que a pessoa leva; 5) um CTA com verbo e o que ganha.",
    `- Frameworks de resposta direta (um por variação, sem repetir): ${FRAMEWORKS_DE_RESPOSTA_DIRETA.map((f) => `${f.id} = ${f.como}`).join("; ")}.`,
    "- Primeira linha que para o dedo: uma cena que o público reconhece, um número real dos fatos, uma contradição do senso comum do nicho ou uma pergunta que só ele responderia sim. Nunca abra com \"Você sabia\", \"Descubra\", \"Conheça\", \"Olá\" ou o nome da empresa.",
    "- Título (até 40 caracteres): o benefício concreto ou a oferta, nunca o nome da empresa sozinho. CTA: verbo de ação e o que a pessoa ganha (\"Chame no WhatsApp e receba o orçamento hoje\"), coerente com o botão.",
    `- Argumentos do mundo real: como funciona, o que está incluso, quem faz, onde, quanto tempo leva (só o que estiver nos fatos). ${VOZ_HUMANA}`,
    "- Fale DESTE negócio: cada variação cita pelo menos dois fatos abaixo (o produto ou serviço pelo nome, o público, a promessa, um entregável, a condição). Copy que serviria a qualquer concorrente trocando o nome é reprovada.",
    `- Ângulo de venda de cada variação (preencha angulo_de_venda com o id): ${variacoes}.`,
    "- Política da Meta: nunca afirme nem insinue atributo pessoal de quem lê (saúde, peso, dívida, religião, orientação, etnia, idade, deficiência), como \"você está acima do peso?\" ou \"suas dívidas\"; fale da situação ou do produto (\"para quem quer...\"). Sem promessa irreal (resultado garantido, cura, renda, corpo, prazo milagroso), sem antes e depois de corpo, sem urgência falsa.",
    `- Proibido: ${CLICHES_DE_ANUNCIO.map(([, n]) => `"${n}"`).join(", ")}, além dos clichês de IA da casa. Troque por detalhe concreto. ${SEM_TRAVESSAO}`,
    "- Nada inventado: preço, desconto, prazo, garantia, quantidade e resultado só se estiverem nos FATOS, com o mesmo número. Sem o fato, troque por um argumento de como funciona.",
    "FATOS (os únicos que podem aparecer na copy e na arte):",
    fatos,
    e.venda ? blocoDaVenda(e.venda) : "",
  ].filter(Boolean).join("\n");
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

export type MotivoDoGenerico = "cliche" | "gancho_fraco" | "sem_fato" | "sem_cta" | "atributo_pessoal" | "promessa" | "inventado";

export type ConferenciaDoAnuncio = {
  /** Reprovada: vai para a reescrita única. */
  reprovada: boolean;
  motivos: { tipo: MotivoDoGenerico; texto: string }[];
  /** Termos da oferta que a copy cita (prova de especificidade). */
  citados: string[];
};

/** Abertura vazia de anúncio na primeira linha. */
const ABERTURA_FRACA = /^(voce sabia|descubra|conheca|apresentamos|ola|oi\b|venha|confira|chegou|atencao|novidade|e hoje|quer saber)/;

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
export function conferirAnuncio(c: AnuncioParaConferir, fatos: Pick<FatosDaOferta, "termos"> & { linhas?: string[] }): ConferenciaDoAnuncio {
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
  else {
    const extra = PROMESSAS_DE_ANUNCIO.filter(([re]) => re.test(s)).map(([, n]) => n);
    if (extra.length) motivos.push({ tipo: "promessa", texto: `Promessa proibida pela política da Meta: ${extra.join(", ")}.` });
  }
  // 22/10/2026: preço, desconto, prazo e resultado só com fonte (a oferta e os produtos informados).
  if (fatos.linhas) {
    const sem = semFonte(tudo, fatos.linhas);
    if (sem.length) motivos.push({ tipo: "inventado", texto: `Sem fonte na oferta: ${sem.join(", ")}.` });
  }
  return { reprovada: motivos.length > 0, motivos, citados };
}

/** Só a política (atributo pessoal e promessa): o que não pode ir para a Meta nem depois da reescrita. */
export const motivosDePolitica = (c: ConferenciaDoAnuncio) => c.motivos.filter((m) => m.tipo === "atributo_pessoal" || m.tipo === "promessa" || m.tipo === "inventado");

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
    "Regras: gancho concreto na primeira linha; pelo menos dois fatos da lista; um CTA com verbo; nenhum clichê; nenhum atributo pessoal de quem lê; nenhuma promessa irreal; nenhum preço, desconto, prazo ou resultado fora dos fatos.",
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

// ------------------------------------------------------------ copy que vende a ideia (22/10/2026)
//
// Pedido do dono: "os ganchos e copy dos criativos têm que ser muito melhores,
// porque os criativos são pra vender a ideia". O que mora daqui para baixo:
// - FRAMEWORKS_DE_RESPOSTA_DIRETA e VOZ_HUMANA: o que vai no bloco do prompt;
// - ganchosParaACopy e blocoDaVenda: o nicho do cliente (dores, desejos,
//   ganchos e cuidados de política) e os ganchos do banco ganchos_vencedores
//   (formato "anuncio") como EXEMPLO de estrutura, nunca para copiar;
// - semFonte e PROMESSAS_DE_ANUNCIO: nada inventado e política da Meta;
// - humanizarAnuncio: a passada de humanizer em código (sem IA);
// - perguntasDeVenda e avisosDaVenda: o Jev (Score) mede "vende a ideia",
//   especificidade do nicho e prova real; a nota escolhe e vira aviso, sem laço;
// - ousadiaDoPedido: "mais ousada" e "mais segura" em um clique.

/** Os frameworks de resposta direta (ids de FRAMEWORKS_DE_COPY) em uma linha cada, para o prompt. */
export const FRAMEWORKS_DE_RESPOSTA_DIRETA: { id: string; como: string }[] = [
  { id: "pas", como: "PAS: a dor nas palavras do público, o custo real de ficar assim, a solução e o CTA" },
  { id: "aida", como: "AIDA: atenção na 1ª linha, o detalhe que prende, o desejo para si e a ação" },
  { id: "bab", como: "antes, depois e ponte: como é hoje, como fica (sem promessa de corpo, saúde ou renda) e a oferta como ponte" },
  { id: "prova_oferta_urgencia", como: "prova, oferta e urgência: a prova real, o que leva e o motivo REAL para agir agora (só com prazo ou vaga nos fatos)" },
  { id: "objecao_e_quebra", como: "objeção e resposta: a trava dita como o cliente fala e o fato que desmonta" },
  { id: "porque_razao_real", como: "\"porque\" com razão real: o pedido seguido de porque e a razão verificável (como funciona, o que inclui, quem faz)" },
];

/** As regras de voz que tiram o cheiro de texto de IA (vão no prompt; o código limpa o resto). */
export const VOZ_HUMANA =
  "Voz humana: escreva como alguém do nicho fala no WhatsApp com um cliente, frases curtas e completas, palavras concretas do dia a dia dele; sem \"descubra\", \"transforme\", \"jornada\", \"o segredo\", pergunta-ponte (\"O resultado?\"), três adjetivos em fila, exclamação dupla ou mais de 2 emojis.";

/** Promessas que a Meta reprova e que o motor da casa não pega (ganho, aprovação e cura garantidos). */
export const PROMESSAS_DE_ANUNCIO: Array<[RegExp, string]> = [
  [/(lucro|ganho|retorno|renda|aprovacao|credito aprovado|emprego) (garantid|certo\b|assegurad)/, "ganho ou aprovação garantidos"],
  [/(ganhe|fature|lucre) (ate |mais de )?r\$ ?\d/, "ganho de dinheiro com valor"],
  [/\b(curar|curamos|cura definitiva|elimina de vez|acaba de vez com) /, "promessa de cura"],
  [/(resultado|efeito) (imediato|instantaneo|em \d+ (dias|horas))/, "resultado com prazo"],
];

const normalizarNumero = (n: string) => n.replace(/[.,]$/, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(/,0+$/, "");

/**
 * Preço, desconto, prazo, quantidade e resultado da copy que NÃO aparecem nos
 * fatos (a oferta e os produtos informados). Devolve o trecho de cada um.
 */
export function semFonte(texto: string, fontes: string[]): string[] {
  const t = semAcento(String(texto || ""));
  const fonte = semAcento(fontes.join("\n"));
  const numerosDaFonte = (fonte.match(/\d[\d.,]*/g) || []).map(normalizarNumero);
  const achados: string[] = [];
  const padroes = [
    /r\$ ?\d[\d.,]*/g,
    /\d+(?:[.,]\d+)? ?%/g,
    /\b\d+(?:[.,]\d+)? ?(?:h|horas?|min|minutos?|dias?|semanas?|meses|mes|anos?|vagas?|unidades?|clientes?|pessoas?|familias?|empresas?|kg|quilos?|x)\b/g,
  ];
  for (const re of padroes) {
    for (const m of t.match(re) || []) {
      const n = normalizarNumero((m.match(/\d[\d.,]*/) || [""])[0]);
      if (n && numerosDaFonte.indexOf(n) < 0 && achados.indexOf(m.trim()) < 0) achados.push(m.trim());
    }
  }
  const palavras: Array<[RegExp, string]> = [
    [/\bfrete gratis\b/, "frete grátis"],
    [/\b(gratis|gratuit[oa])\b/, "grátis"],
    [/\bdesconto\b|\b\d+ ?off\b/, "desconto"],
    [/\bsem juros\b/, "sem juros"],
    [/\bgarantia\b|\bgarantid[oa]\b/, "garantia"],
    [/\bbrinde\b/, "brinde"],
  ];
  for (const [re, nome] of palavras) {
    if (!re.test(t) || re.test(fonte) || achados.indexOf(nome) >= 0) continue;
    // "frete grátis" já cobre "grátis".
    if (nome === "grátis" && achados.indexOf("frete grátis") >= 0) continue;
    achados.push(nome);
  }
  return achados;
}

/** O nicho como a copy usa (o NICHOS do conhecimento-ads ou o guardado). */
export type NichoDaCopy = { id: string; nome: string; dores?: string[]; desejos?: string[]; ganchos?: string[]; riscos_de_politica?: string[] };

/** Um gancho do banco ganchos_vencedores, já lido e limpo. */
export type GanchoVencedor = { texto: string; gatilho: string | null; nicho: string | null };

/** O que a copy recebe para vender a ideia: o nicho e os ganchos que já venderam. */
export type VendaDaCopy = { nicho: NichoDaCopy | null; ganchos: GanchoVencedor[] };

const textoDaLinha = (l: Record<string, unknown>, chaves: string[]): string => {
  for (const k of chaves) {
    const v = l[k];
    if (typeof v === "string" && v.trim()) return v.replace(/\s+/g, " ").trim();
  }
  return "";
};

const notaDaLinha = (l: Record<string, unknown>): number => {
  for (const k of ["nota", "score", "pontuacao", "desempenho", "forca", "vitorias", "usos"]) {
    const v = Number(l[k]);
    if (l[k] != null && Number.isFinite(v)) return v;
  }
  return 0;
};

const GERAL = ["", "geral", "todos", "qualquer", "generico"];

/**
 * Ganchos do banco (linhas cruas de ganchos_vencedores) para a copy de anúncio:
 * só o formato "anuncio" (quando a linha diz o formato), os do nicho do
 * cliente primeiro, depois os gerais; sem nicho conhecido, todos pelos mais
 * fortes. Lê o texto em gancho, texto, frase ou hook; tolera colunas a menos
 * (tabela nova, de outra frente) e linha estranha.
 */
export function ganchosParaACopy(linhas: unknown, nicho: { id: string; nome: string } | null, max = 8): GanchoVencedor[] {
  if (!Array.isArray(linhas)) return [];
  const alvo = nicho ? [semAcento(nicho.id), semAcento(nicho.nome)] : [];
  const lidos = linhas
    .filter((l): l is Record<string, unknown> => !!l && typeof l === "object")
    .filter((l) => l.ativo !== false)
    .map((l) => {
      const formato = semAcento(textoDaLinha(l, ["formato"]));
      // 23/10: a tabela do motor de copy guarda os nichos em lista (nichos text[]; "geral" vale para todos).
      const n = Array.isArray(l.nichos) ? (l.nichos as unknown[]).filter((x) => typeof x === "string").join(", ") : textoDaLinha(l, ["nicho", "nicho_id", "nicho_nome"]);
      const ns = semAcento(n);
      const doNicho = !!ns && alvo.some((a) => !!a && (a === ns || a.indexOf(ns) >= 0 || ns.indexOf(a) >= 0));
      return {
        g: { texto: textoDaLinha(l, ["exemplo", "gancho", "texto", "frase", "hook", "conteudo"]).slice(0, 220), gatilho: textoDaLinha(l, ["gatilho", "gatilho_mental"]) || null, nicho: n || null },
        formatoOk: !formato || formato === "anuncio" || formato === "ads",
        peso: doNicho ? 2 : GERAL.indexOf(ns) >= 0 ? 1 : 0,
        nota: notaDaLinha(l),
      };
    })
    .filter((x) => x.g.texto && x.formatoOk && (x.peso > 0 || !nicho))
    .sort((a, b) => b.peso - a.peso || b.nota - a.nota);
  const saida: GanchoVencedor[] = [];
  for (const x of lidos) {
    if (saida.some((s) => semAcento(s.texto) === semAcento(x.g.texto))) continue;
    saida.push(x.g);
    if (saida.length >= max) break;
  }
  return saida;
}

/** O bloco do nicho e dos ganchos vencedores no prompt (vazio quando não há nenhum dos dois). */
export function blocoDaVenda(v: VendaDaCopy): string {
  const partes: string[] = [];
  const n = v.nicho;
  if (n) {
    const lista = (xs: string[] | undefined) => (xs || []).slice(0, 6).join("; ");
    partes.push(`NICHO DO CLIENTE: ${n.nome}. Converse com ele: as dores e os desejos que ele reconhece, com as palavras dele.`);
    if (n.dores && n.dores.length) partes.push(`- Dores do nicho: ${lista(n.dores)}.`);
    if (n.desejos && n.desejos.length) partes.push(`- Desejos do nicho: ${lista(n.desejos)}.`);
    if (n.ganchos && n.ganchos.length) partes.push(`- Ganchos que funcionam no nicho (inspiração, não cópia): ${lista(n.ganchos)}.`);
    if (n.riscos_de_politica && n.riscos_de_politica.length) partes.push(`- Cuidados de política deste nicho: ${lista(n.riscos_de_politica)}.`);
  }
  if (v.ganchos.length) {
    partes.push("GANCHOS QUE JÁ VENDERAM (banco da casa, formato anúncio): use a ESTRUTURA e o gatilho como exemplo do nível esperado; nunca copie a frase, troque pelos fatos deste negócio.");
    for (const g of v.ganchos) partes.push(`- "${g.texto}"${g.gatilho ? ` (gatilho: ${g.gatilho})` : ""}`);
  }
  return partes.join("\n");
}

const EMOJI = /[\uD83C-\uDBFF][\uDC00-\uDFFF]|[☀-➿]/g;

/**
 * Passada de humanizer em código, sem IA e sem mudar o sentido: exclamação e
 * interrogação repetidas viram uma, reticências longas viram três, emoji além
 * de 2 sai, espaço antes de pontuação sai. O resto (clichê, pergunta-ponte,
 * tríade) vai como aviso pelo motor da casa e pelo Jev.
 */
export function humanizarAnuncio(texto: string): { texto: string; ajustes: string[] } {
  const ajustes: string[] = [];
  const antes = String(texto || "");
  let t = antes.replace(/!{2,}/g, "!").replace(/\?{2,}/g, "?").replace(/\.{4,}|…{2,}/g, "...");
  if (t !== antes) ajustes.push("pontuação repetida virou uma");
  let vistos = 0;
  const semExcesso = t.replace(EMOJI, (m) => (++vistos > 2 ? "" : m));
  if (semExcesso !== t) ajustes.push("emojis além de 2 tirados");
  t = semExcesso
    .split("\n")
    .map((l) => l.replace(/[ \t]+([,.!?;:])/g, "$1").replace(/[ \t]{2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { texto: t, ajustes };
}

/** Níveis do Jev (0 a 4): quanto a peça vende a ideia. */
export const NIVEIS_VENDE_A_IDEIA = [
  "Não vende nada: quem lê não entende o que é oferecido nem por que deveria se importar.",
  "Informa sem vender: diz o que é, mas sem motivo para querer; parece aviso ou post institucional.",
  "Vende morno: tem um benefício, mas genérico ou fraco; a pessoa concorda e continua rolando.",
  "Vende com clareza: benefício concreto ligado a uma situação do público e um próximo passo claro; dá vontade de saber mais.",
  "Vende a ideia com força: em segundos a pessoa entende o que ganha, por que esta oferta é diferente e tem motivo real para agir agora, sem exagero nem promessa irreal.",
];

/** Níveis do Jev (0 a 4): especificidade do nicho. */
export const NIVEIS_ESPECIFICIDADE_DO_NICHO = [
  "Serve para qualquer negócio de qualquer área trocando o nome.",
  "Cita a categoria (\"clínica\", \"loja\", \"oficina\"), mas nenhuma situação, palavra ou detalhe que só esse público conhece.",
  "Tem um detalhe do nicho, mas o resto do texto é genérico.",
  "Fala a língua do nicho: situação típica, termos e objeção que esse público reconhece na hora.",
  "Só poderia ter sido escrito para este nicho e esta oferta: cena, vocabulário, objeção e argumento específicos e verdadeiros.",
];

/** Níveis do Jev (0 a 4): prova real (só a que está nos fatos vale). */
export const NIVEIS_PROVA_REAL = [
  "Alega número, resultado, depoimento, prazo ou garantia que não está nos fatos (prova inventada).",
  "Só adjetivos e afirmações que não dá para conferir (\"qualidade\", \"os melhores\", \"confiança\").",
  "Usa um detalhe concreto e verificável da oferta (o que está incluso, como funciona, a condição), sem prova de terceiros.",
  "Usa uma prova real que está nos fatos (número, depoimento autorizado, tempo de atuação, garantia).",
  "A prova real dos fatos está no centro do argumento, específica e fácil de conferir, e sustenta a promessa.",
];

/** As três perguntas de venda do Jev para a copy `ref` (Score; o estado traz `nicho` e `fatos`). */
export function perguntasDeVenda(ref: string): Record<"vende" | "nicho" | "prova", { type: "score"; instructions: string; criteria: string[] }> {
  return {
    vende: {
      type: "score",
      instructions: `O anúncio ${ref} existe para vender a ideia da oferta ao público do \`nicho\`. Quanto ele vende a ideia: clareza do que a pessoa ganha, diferença desta oferta e motivo real para agir, dentro da política?`,
      criteria: NIVEIS_VENDE_A_IDEIA,
    },
    nicho: {
      type: "score",
      instructions: `Quanto o anúncio ${ref} fala a língua do \`nicho\` do cliente (situação, vocabulário, objeção e argumento que só esse público reconhece), considerando os \`fatos\` da oferta?`,
      criteria: NIVEIS_ESPECIFICIDADE_DO_NICHO,
    },
    prova: {
      type: "score",
      instructions: `Comparando com os \`fatos\` da oferta (os únicos verdadeiros), que tipo de prova o anúncio ${ref} usa para sustentar o que promete?`,
      criteria: NIVEIS_PROVA_REAL,
    },
  };
}

/** Notas de venda do Jev (0 a 10) que viram aviso, nunca reescrita. */
export type NotasDeVenda = { vende?: number | null; nicho?: number | null; prova_real?: number | null };

const v10 = (n: number) => String(n).replace(".", ",");

/** Avisos da conferência de venda: abaixo de 6 em vender ou no nicho; prova inventada abaixo de 3. */
export function avisosDaVenda(n: NotasDeVenda | null | undefined): string[] {
  if (!n) return [];
  const saida: string[] = [];
  if (typeof n.vende === "number" && n.vende < 6) saida.push(`Vende pouco a ideia pelo Jev (nota ${v10(n.vende)}).`);
  if (typeof n.nicho === "number" && n.nicho < 6) saida.push(`Pouco específica do nicho pelo Jev (nota ${v10(n.nicho)}).`);
  if (typeof n.prova_real === "number" && n.prova_real < 3) saida.push("O Jev viu prova que não está nos fatos: confira número, resultado e depoimento.");
  return saida;
}

export type Ousadia = "ousada" | "segura";

/** "Mais ousada" e "mais segura" em um clique: o tom e o pedido que vão para o refino. */
export function ousadiaDoPedido(v: unknown): { ousadia: Ousadia; tom: "agressivo" | "sobrio"; pedido: string } | null {
  if (v === "ousada") {
    return {
      ousadia: "ousada",
      tom: "agressivo",
      pedido: "MAIS OUSADA: gancho mais forte e mais inesperado, contraste maior, contrário ao senso comum do nicho, frase mais curta e mais direta, CTA mais firme. Continua dentro da política da Meta e só com os fatos.",
    };
  }
  if (v === "segura") {
    return {
      ousadia: "segura",
      tom: "sobrio",
      pedido: "MAIS SEGURA: a mesma ideia de venda sem nada que a Meta possa reprovar (nenhum atributo pessoal, nenhuma promessa de resultado, prazo ou ganho, nenhuma urgência fora dos fatos), prova só dos fatos, tom confiável. Continua vendendo, sem ficar morna.",
    };
  }
  return null;
}
