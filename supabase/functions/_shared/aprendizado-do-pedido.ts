/**
 * Aprender com cada pedido do dono (29/09): "todos eles têm que aprender com
 * cada ajuste, cada coisa que eu peço para aprender. Tem coisas que ele não
 * pode mais fazer quando eu peço e não gostei. Cada ação tem que devolver."
 *
 * O ciclo, igual em todos os agentes da Mesa:
 *
 * 1. REGISTRAR. O modelo do agente escreve, no campo `regra` da resposta, a
 *    regra curta e acionável que o pedido traz ("Nunca usar fundo preto nas
 *    artes"), ou null. Quem decide se aquilo vale para sempre ou só desta vez
 *    é o Jev (Choice preferencia_duradoura | so_desta_vez | incerto), com a
 *    categoria (evitar | preferencia) e a área do cérebro no mesmo pedido.
 *    Sem o Jev, a regra de reserva só grava ordem explícita ("nunca",
 *    "sempre", "daqui pra frente", "não gostei"). Grava pelo cérebro do
 *    cliente (cerebro-do-cliente.ts): a mesma regra dita de novo vira
 *    reforço, a que contradiz aposenta a antiga.
 * 2. OBEDECER. Antes de responder, o agente lê as regras ativas do cliente
 *    (com apelido g1..gN, nunca o id) e as `evitar` vêm primeiro. O pedido
 *    explícito de agora vence uma regra antiga, e o agente avisa.
 * 3. DEVOLVER. A mensagem do agente leva o anexo `aprendizado` ("Aprendi: ...",
 *    com Esquecer na tela) e o anexo `regras_seguidas` ("Segui: ...") com as
 *    regras que o modelo disse ter usado (só apelidos da lista).
 *
 * Escopo da marca: agente_memoria não tem coluna de marca. A regra aprendida
 * numa marca (Acerbi ou CME) guarda o id da marca em `referencia_id`; na
 * leitura, vale a regra sem marca e a da marca aberta. referencia_id que não
 * é marca do cliente (tarefa, peça) conta como "sem marca".
 *
 * Puro: sem Deno, sem Supabase, sem Jev. O banco e o julgamento chegam por
 * parâmetro (aprendizado-nos-agentes.ts faz a ponte). Tela e Vitest leem o
 * mesmo arquivo.
 */

/**
 * Mesmo contrato de anexo das outras frentes (AG2 aprendizado-das-mesas.ts, AG3
 * aprender-com-o-dono.ts, tela AprendizadoDoAgente.tsx): "aprendizado_do_agente"
 * e "regras_seguidas". Qualquer tela de agente mostra o "Aprendi" de qualquer outro.
 */
export const TIPO_DO_APRENDIZADO = "aprendizado_do_agente";
export const TIPO_DAS_REGRAS_SEGUIDAS = "regras_seguidas";

/** Áreas do cérebro (espelho de AREAS_DO_CEREBRO em cerebro-do-cliente.ts). */
export const AREAS_DA_REGRA = ["geral", "calendario", "campanha", "copy", "arte", "foto", "ads", "conta"] as const;
export type AreaDaRegra = (typeof AREAS_DA_REGRA)[number];

export const DESCRICAO_DA_AREA: Record<AreaDaRegra, string> = {
  geral: "vale para tudo do cliente (marca, tom, o que nunca fazer em nenhuma peça)",
  calendario: "pautas, temas e planejamento do calendário de conteúdo",
  campanha: "campanhas (nome, oferta, período, conceito)",
  copy: "textos: legenda, título, CTA, linguagem e tom das palavras",
  arte: "visual das artes: cores, fontes, layout, logo, estilo das imagens e capas",
  foto: "fotos reais, ensaios e tratamento de foto",
  ads: "anúncios pagos e verba",
  conta: "perfil das redes: bio, nome, destaques, grade e métricas",
};

/** Qual agente guarda a regra de cada área (espelho de AGENTE_DA_AREA). */
export const AGENTE_DA_AREA_DA_REGRA: Record<AreaDaRegra, "geral" | "estrategista" | "diretor_arte" | "estrategista_ads"> = {
  geral: "geral",
  calendario: "estrategista",
  campanha: "estrategista",
  copy: "estrategista",
  arte: "diretor_arte",
  foto: "diretor_arte",
  ads: "estrategista_ads",
  conta: "estrategista_ads",
};

/** Probabilidade mínima de "preferencia_duradoura" para gravar. Abaixo, nada é gravado (pedido de uma vez só não vira regra). */
export const LIMIAR_DA_REGRA = 0.6;
/** Regras que entram no prompt (as `evitar` primeiro). */
export const MAX_REGRAS_NO_PROMPT = 40;
export const MAX_TEXTO_DA_REGRA = 280;

const umaLinha = (v: unknown, max: number) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
const MARCAS_DE_ACENTO = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g");
const semAcento = (t: string) => t.normalize("NFD").replace(MARCAS_DE_ACENTO, "").toLowerCase();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ------------------------------------------------------------------ o que o modelo devolve

export type RegraProposta = { texto: string; categoria: "evitar" | "preferencia" | null };

/** Propriedades do JSON Schema da resposta (juntar às do agente; os dois entram em `required`). */
export const PROPRIEDADES_DO_APRENDIZADO = {
  regra: {
    type: ["object", "null"],
    additionalProperties: false,
    required: ["texto", "categoria"],
    properties: {
      texto: { type: "string" },
      categoria: { type: "string", enum: ["evitar", "preferencia"] },
    },
  },
  seguiu: { type: "array", items: { type: "string" } },
} as const;

export const CAMPOS_DO_APRENDIZADO = ["regra", "seguiu"] as const;

/** Soma os campos do aprendizado a um JSON Schema de objeto (sem mexer no original). */
export function esquemaComAprendizado<E extends { properties: Record<string, unknown>; required?: string[] }>(schema: E): E {
  const required = Array.from(new Set([...(schema.required || []), ...CAMPOS_DO_APRENDIZADO]));
  return { ...schema, properties: { ...schema.properties, ...PROPRIEDADES_DO_APRENDIZADO }, required };
}

/** O texto da regra para o prompt (o que escrever em `regra` e em `seguiu`). */
export const REGRA_DO_APRENDIZADO_NO_PROMPT = `- regra: quando a equipe ensina algo que deve valer nas próximas vezes (reprova, diz "não gostei", "nunca", "sempre", "pare de", "daqui pra frente", corrige um jeito de fazer), escreva UMA regra curta e acionável, na voz de ordem ("Nunca usar fundo preto nas artes", "Sempre falar com o dono da empresa, não com agências"), com categoria evitar (o que não fazer) ou preferencia (o jeito certo). Pedido que é só desta vez ("mude esta data", "apague este") não é regra: null. Sem nada a aprender, null. Não invente regra que a equipe não disse.
- seguiu: apelidos (g1, g2...) das REGRAS APRENDIDAS que você usou nesta resposta ou nesta ação. Nenhuma: lista vazia. Só apelidos da lista.`;

/** Lê o campo `regra` do modelo. Null quando vazio, curto demais ou longo demais. */
export function regraDoModelo(bruto: unknown): RegraProposta | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const texto = umaLinha(o.texto, 600);
  if (texto.length < 6) return null;
  const curto = texto.length > MAX_TEXTO_DA_REGRA ? `${texto.slice(0, MAX_TEXTO_DA_REGRA - 1).trimEnd()}…` : texto;
  return { texto: curto, categoria: categoriaValida(o.categoria) };
}

const categoriaValida = (v: unknown): "evitar" | "preferencia" | null => (v === "evitar" || v === "preferencia" ? v : null);

// ------------------------------------------------------------------ sinais sem o Jev

/** Ordem explícita de regra ("nunca", "sempre", "daqui pra frente", "não gostei"...). A reserva quando o Jev não responde. */
export function sinalDeRegra(mensagem: unknown): { forte: boolean; negativo: boolean } {
  const t = semAcento(String(mensagem ?? ""));
  const forte = /\b(nunca|jamais|sempre|daqui (pra|para) frente|de agora em diante|a partir de agora|toda vez|todas as vezes|nao (gostei|gosto|quero mais|use mais|faca mais|coloque mais)|pare de|para de|chega de|odeio|detesto|nao pode mais|evite|evitar sempre|lembre(-se)? (disso|sempre)|aprenda|guarde isso|anote isso)\b/.test(t);
  const negativo = /\b(nunca|jamais|nao (gostei|gosto|quero|use|faca|coloque|pode)|pare de|para de|chega de|odeio|detesto|evite|sem )\b/.test(t);
  return { forte, negativo };
}

/** Sem Jev: grava só quando a mensagem traz ordem explícita de regra. */
export function decisaoSemJev(mensagem: unknown, regra: RegraProposta | null, areaPadrao: AreaDaRegra): DecisaoDoAprendizado {
  if (!regra) return { grava: false, motivo: "sem regra na resposta", categoria: "preferencia", area: areaPadrao, probabilidade: null, fonte: "regra" };
  const s = sinalDeRegra(mensagem);
  const categoria = regra.categoria || (s.negativo ? "evitar" : "preferencia");
  return s.forte
    ? { grava: true, motivo: "ordem explícita de regra", categoria, area: areaPadrao, probabilidade: null, fonte: "regra" }
    : { grava: false, motivo: "sem Jev e sem ordem explícita: não vira regra", categoria, area: areaPadrao, probabilidade: null, fonte: "regra" };
}

// ------------------------------------------------------------------ o julgamento (Jev)

export type PerguntaChoiceDoAprendizado = { type: "choice"; instructions: unknown; criteria: Record<string, unknown> };

/**
 * As três perguntas ao Jev sobre o mesmo estado, num pedido só (rodam em
 * paralelo): duração (a que decide), e, com a premissa de que é duradoura,
 * a categoria e a área. Quem chama só usa categoria e área quando grava.
 */
export function perguntasDoAprendizado(entrada: { mensagem: string; regra: RegraProposta; agente: string; areas: AreaDaRegra[]; historico?: string[] }) {
  const areas = entrada.areas.length ? entrada.areas : (["geral"] as AreaDaRegra[]);
  const state = {
    agente: entrada.agente,
    pedido_do_dono: umaLinha(entrada.mensagem, 1500),
    regra_que_o_agente_leu: entrada.regra.texto,
    conversa_recente: (entrada.historico || []).slice(-4).map((m) => umaLinha(m, 300)),
  };
  const criteriosDaArea: Record<string, unknown> = {};
  for (const a of areas) criteriosDaArea[a] = DESCRICAO_DA_AREA[a];
  const questions: Record<string, PerguntaChoiceDoAprendizado> = {
    duracao: {
      type: "choice",
      instructions: "O dono de uma agência de marketing pediu algo a um agente de IA sobre um cliente (`pedido_do_dono`). O agente leu nele a regra `regra_que_o_agente_leu`. O dono quer que essa regra valha nas PRÓXIMAS vezes com este cliente (gosto, proibição, jeito certo de fazer que se repete), ou o pedido é só para esta peça ou este momento?",
      criteria: {
        preferencia_duradoura: {
          what: "vale daqui para frente: gosto, proibição ou jeito de fazer que deve se repetir com este cliente",
          examples: ["não gostei desse fundo preto, nunca mais", "sempre fale com o dono da empresa, não com agências", "esse tom está muito formal para esse cliente"],
        },
        so_desta_vez: {
          what: "ajuste pontual desta peça, data, item ou momento; não diz nada sobre as próximas vezes",
          examples: ["mude a data desse post para sexta", "apague os de outubro", "troque esse título por outro"],
        },
        incerto: "não dá para saber se vale para as próximas vezes, ou a regra lida não bate com o que o dono disse",
      },
    },
    categoria: {
      type: "choice",
      instructions: "Supondo que `regra_que_o_agente_leu` valha daqui para frente: ela diz o que NÃO fazer mais, ou o jeito certo de fazer?",
      criteria: {
        evitar: "proíbe ou reprova algo: o que o agente não pode mais fazer",
        preferencia: "diz o jeito certo, o gosto ou o que fazer sempre",
      },
    },
  };
  if (areas.length > 1) {
    questions.area = {
      type: "choice",
      instructions: "Supondo que `regra_que_o_agente_leu` valha daqui para frente: em que parte do trabalho com o cliente ela vale?",
      criteria: criteriosDaArea,
    };
  }
  return { state, questions };
}

export type RespostaDoJulgamento = { choice?: string; probabilities?: Record<string, number>; confidence?: number };

export type DecisaoDoAprendizado = {
  grava: boolean;
  motivo: string;
  categoria: "evitar" | "preferencia";
  area: AreaDaRegra;
  /** Probabilidade de "preferencia_duradoura" (null sem Jev). */
  probabilidade: number | null;
  fonte: "jev" | "regra";
};

const probDe = (r: RespostaDoJulgamento | undefined, op: string): number | null => {
  if (!r) return null;
  const p = r.probabilities && typeof r.probabilities[op] === "number" ? r.probabilities[op] : r.choice === op && typeof r.confidence === "number" ? r.confidence : null;
  return typeof p === "number" && Number.isFinite(p) ? p : null;
};

/** Lê as respostas do Jev e decide. Grava só com "preferencia_duradoura" escolhida e acima do limiar. */
export function decidirAprendizado(
  respostas: Record<string, RespostaDoJulgamento> | null | undefined,
  entrada: { regra: RegraProposta; areas: AreaDaRegra[]; areaPadrao: AreaDaRegra; limiar?: number },
): DecisaoDoAprendizado {
  const r = respostas || {};
  const duracao = r.duracao;
  const p = probDe(duracao, "preferencia_duradoura");
  const escolha = duracao && typeof duracao.choice === "string" ? duracao.choice : null;
  const categoriaJev = r.categoria && (r.categoria.choice === "evitar" || r.categoria.choice === "preferencia") ? (r.categoria.choice as "evitar" | "preferencia") : null;
  const categoria = categoriaJev || entrada.regra.categoria || "preferencia";
  const areaEscolhida = r.area && typeof r.area.choice === "string" && (entrada.areas as string[]).indexOf(r.area.choice) >= 0 ? (r.area.choice as AreaDaRegra) : null;
  const area = areaEscolhida || (entrada.areas.length === 1 ? entrada.areas[0] : entrada.areaPadrao);
  const limiar = entrada.limiar ?? LIMIAR_DA_REGRA;
  if (escolha === "preferencia_duradoura" && p !== null && p >= limiar) {
    return { grava: true, motivo: "o Jev leu preferência duradoura", categoria, area, probabilidade: p, fonte: "jev" };
  }
  return {
    grava: false,
    motivo: escolha === "so_desta_vez" ? "pedido só desta vez" : escolha === "incerto" ? "incerto: não vira regra" : "abaixo do limiar",
    categoria,
    area,
    probabilidade: p,
    fonte: "jev",
  };
}

// ------------------------------------------------------------------ o que vai para a conversa

export type AnexoDoAprendizado = {
  tipo: typeof TIPO_DO_APRENDIZADO;
  /** agente_memoria.id: o Esquecer da tela desliga esta linha. */
  id: string;
  texto: string;
  categoria: "evitar" | "preferencia";
  area: AreaDaRegra;
  situacao: "criado" | "reforcado" | "substituiu";
  reforcos: number;
  /** Espelho do contrato comum (só o que o Jev leu como duradoura vira anexo com id). */
  decisao: "preferencia_duradoura";
  marca_id?: string | null;
};

/** `tipo` é o nome do contrato comum; `categoria` fica por compatibilidade. */
export type RegraSeguida = { id: string; texto: string; categoria: string; tipo?: "evitar" | "preferencia" };
export type AnexoDasRegrasSeguidas = { tipo: typeof TIPO_DAS_REGRAS_SEGUIDAS; regras: RegraSeguida[] };

export function anexoDoAprendizado(g: { id: string | null; situacao: "criado" | "reforcado" | "substituiu" | null; reforcos: number | null }, regra: RegraProposta, decisao: DecisaoDoAprendizado, marcaId?: string | null): AnexoDoAprendizado | null {
  if (!g.id || !g.situacao) return null;
  const a: AnexoDoAprendizado = {
    tipo: TIPO_DO_APRENDIZADO,
    id: g.id,
    texto: regra.texto,
    categoria: decisao.categoria,
    area: decisao.area,
    situacao: g.situacao,
    reforcos: Math.max(1, Number(g.reforcos) || 1),
    decisao: "preferencia_duradoura",
  };
  if (marcaId) a.marca_id = marcaId;
  return a;
}

/** Frase curta para a conversa: "Aprendi: ..." ou "Reforcei: ... (3x)". */
export function fraseDoAprendizado(a: Pick<AnexoDoAprendizado, "texto" | "situacao" | "reforcos">): string {
  if (a.situacao === "reforcado") return `Reforcei o que já sabia: ${a.texto}${a.reforcos > 1 ? ` (${a.reforcos}x)` : ""}`;
  if (a.situacao === "substituiu") return `Aprendi (e troquei a regra antiga): ${a.texto}`;
  return `Aprendi: ${a.texto}`;
}

export function aprendizadoDosAnexos(anexos: unknown): AnexoDoAprendizado | null {
  if (!Array.isArray(anexos)) return null;
  for (const a of anexos) {
    const o = a && typeof a === "object" ? (a as Record<string, unknown>) : null;
    // Só o que foi guardado (com id): o "incerto" das outras frentes, sem id, não tem Esquecer.
    if (o && o.tipo === TIPO_DO_APRENDIZADO && typeof o.id === "string" && o.id && typeof o.texto === "string") {
      return { ...(o as unknown as AnexoDoAprendizado), categoria: o.categoria === "evitar" ? "evitar" : "preferencia", situacao: o.situacao === "reforcado" || o.situacao === "substituiu" ? o.situacao : "criado", reforcos: Math.max(1, Number(o.reforcos) || 1) };
    }
  }
  return null;
}

export function regrasSeguidasDosAnexos(anexos: unknown): RegraSeguida[] {
  if (!Array.isArray(anexos)) return [];
  for (const a of anexos) {
    const o = a && typeof a === "object" ? (a as Record<string, unknown>) : null;
    if (o && o.tipo === TIPO_DAS_REGRAS_SEGUIDAS && Array.isArray(o.regras)) {
      return (o.regras as unknown[])
        .filter((r): r is RegraSeguida => !!r && typeof r === "object" && typeof (r as RegraSeguida).texto === "string")
        .map((r) => ({ ...r, categoria: String(r.categoria || r.tipo || "preferencia") }))
        .slice(0, 8);
    }
  }
  return [];
}

// ------------------------------------------------------------------ obedecer: as regras no prompt

export type LinhaDaRegra = {
  id: string;
  texto: string;
  tipo?: string | null;
  categoria?: string | null;
  area?: string | null;
  agente?: string | null;
  reforcos?: number | null;
  criado_em?: string | null;
  reforcado_em?: string | null;
  referencia_id?: string | null;
  /** As mesas de mídia (AG2) guardam a marca aqui: "marca:<id>". */
  evidencia?: string | null;
  ativa?: boolean | null;
  valido_ate?: string | null;
};

/** A marca da regra: referencia_id (esta frente) ou "marca:<id>" na evidência (mesas de mídia). */
export function marcaDaLinha(l: Pick<LinhaDaRegra, "referencia_id" | "evidencia">): string {
  const m = /marca:([0-9a-f-]{36})/i.exec(String(l.evidencia || ""));
  if (m) return m[1].toLowerCase();
  return l.referencia_id ? String(l.referencia_id).toLowerCase() : "";
}

export type RegraComApelido = { ref: string; id: string; texto: string; categoria: "evitar" | "preferencia"; area: string; reforcos: number };

const categoriaDaLinha = (l: LinhaDaRegra): "evitar" | "preferencia" | null => {
  const c = String(l.categoria || "");
  if (c === "evitar" || c === "reprovado") return "evitar";
  if (c === "preferencia" || c === "ajuste") return "preferencia";
  if (!c) return l.tipo === "evitar" ? "evitar" : l.tipo === "preferencia" ? "preferencia" : null;
  return null;
};

const areaDaLinha = (l: LinhaDaRegra): string => {
  if (l.area) return String(l.area);
  if (l.agente === "diretor_arte") return "arte";
  if (l.agente === "estrategista_ads") return "ads";
  if (l.agente === "geral") return "geral";
  return "calendario";
};

/** Plano do mês guardado na memória tem tela própria: não é regra do dono. */
const ehPlanoDoMes = (t: string) => /^Plano do m[eê]s \d{4}-\d{2}:/.test(t);

/**
 * As regras que valem para este agente agora: ativas, não vencidas, das áreas
 * dele mais a geral, sem regra de outra marca. `evitar` primeiro, depois as
 * mais reforçadas e as mais recentes. Apelidos g1..gN (o modelo nunca vê o id).
 */
export function regrasParaOAgente(
  linhas: LinhaDaRegra[] | null | undefined,
  opcoes: { areas: string[]; marcaId?: string | null; marcasDoCliente?: string[]; agora?: Date; max?: number },
): RegraComApelido[] {
  const agora = (opcoes.agora || new Date()).getTime();
  const areas = new Set(["geral"].concat(opcoes.areas || []));
  const marcas = new Set((opcoes.marcasDoCliente || []).map((m) => m.toLowerCase()));
  const marca = opcoes.marcaId ? opcoes.marcaId.toLowerCase() : null;
  const vistos = new Set<string>();
  const lista = (linhas || [])
    .filter((l) => l && l.ativa !== false && typeof l.texto === "string" && l.texto.trim() && !ehPlanoDoMes(l.texto.trim()))
    .filter((l) => {
      if (!l.valido_ate) return true;
      const t = new Date(l.valido_ate).getTime();
      return Number.isNaN(t) || t > agora;
    })
    .map((l) => ({ l, categoria: categoriaDaLinha(l), area: areaDaLinha(l) }))
    .filter((x) => !!x.categoria && areas.has(x.area))
    .filter((x) => {
      const ref = marcaDaLinha(x.l);
      // Regra de outra marca do mesmo cliente não vale aqui.
      if (ref && marcas.has(ref)) return !!marca && ref === marca;
      return true;
    })
    .filter((x) => {
      const chave = semAcento(x.l.texto).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    })
    .sort((a, b) => {
      if (a.categoria !== b.categoria) return a.categoria === "evitar" ? -1 : 1;
      const ra = Math.max(1, Number(a.l.reforcos) || 1);
      const rb = Math.max(1, Number(b.l.reforcos) || 1);
      if (ra !== rb) return rb - ra;
      return String(b.l.reforcado_em || b.l.criado_em || "").localeCompare(String(a.l.reforcado_em || a.l.criado_em || ""));
    })
    .slice(0, opcoes.max ?? MAX_REGRAS_NO_PROMPT);
  return lista.map((x, i) => ({
    ref: `g${i + 1}`,
    id: String(x.l.id),
    texto: umaLinha(x.l.texto, 300),
    categoria: x.categoria as "evitar" | "preferencia",
    area: x.area,
    reforcos: Math.max(1, Number(x.l.reforcos) || 1),
  }));
}

/** Bloco do prompt com as regras (vazio quando não há nenhuma). */
export function blocoDasRegras(regras: RegraComApelido[]): string {
  if (!regras.length) return "REGRAS APRENDIDAS COM O DONO: nenhuma ainda. seguiu: lista vazia.";
  const evitar = regras.filter((r) => r.categoria === "evitar");
  const preferir = regras.filter((r) => r.categoria === "preferencia");
  const linha = (r: RegraComApelido) => `${r.ref} | ${r.texto}${r.reforcos > 1 ? ` (pedido ${r.reforcos} vezes)` : ""}`;
  return [
    "REGRAS APRENDIDAS COM O DONO (valem sempre com este cliente; obedeça antes de qualquer ideia sua). EVITAR tem prioridade: nunca repita o que foi reprovado. Se o pedido de AGORA mandar o contrário de uma regra, faça o pedido de agora e diga em uma frase que ele muda a regra antiga.",
    evitar.length ? `EVITAR:\n${evitar.map(linha).join("\n")}` : "",
    preferir.length ? `PREFERÊNCIAS:\n${preferir.map(linha).join("\n")}` : "",
  ].filter(Boolean).join("\n");
}

/** As regras que o modelo disse ter seguido (só apelidos da lista; o resto some). */
export function regrasSeguidasDoModelo(bruto: unknown, regras: RegraComApelido[]): RegraSeguida[] {
  const porRef = new Map(regras.map((r) => [r.ref.toLowerCase(), r]));
  const saida: RegraSeguida[] = [];
  const vistos = new Set<string>();
  for (const b of Array.isArray(bruto) ? bruto : []) {
    const r = porRef.get(String(b ?? "").trim().toLowerCase());
    if (!r || vistos.has(r.id)) continue;
    vistos.add(r.id);
    saida.push({ id: r.id, texto: r.texto, categoria: r.categoria, tipo: r.categoria });
    if (saida.length >= 8) break;
  }
  return saida;
}

export function anexoDasRegrasSeguidas(seguidas: RegraSeguida[]): AnexoDasRegrasSeguidas | null {
  return seguidas.length ? { tipo: TIPO_DAS_REGRAS_SEGUIDAS, regras: seguidas } : null;
}

/** A regra aprendida grava a marca em referencia_id (só id válido). */
export function referenciaDaMarca(marcaId: unknown): string | null {
  const m = typeof marcaId === "string" ? marcaId.trim() : "";
  return UUID.test(m) ? m : null;
}
