/**
 * Aprender com o dono (frente AG3, 29/09). Pedido dele, para todos os agentes:
 * "Todos eles têm que aprender com cada ajuste, cada coisa que eu peço para
 * aprender. Tem coisas que não pode mais fazer quando eu peço e não gostei.
 * Tem que ter inteligência de aprendizado. Cada ação tem que devolver."
 *
 * Três partes, sem tabela nova (o cérebro do cliente, agente_memoria):
 *
 * 1. Registrar. O pedido do dono passa por um filtro barato de palavras
 *    ("não gostei", "nunca", "sempre", "pare de", "prefiro"...). Só o que
 *    passa vai ao Jev, numa chamada com as perguntas juntas:
 *    - duracao: preferencia_duradoura | so_desta_vez | incerto;
 *    - tipo: evitar | preferencia;
 *    - trecho: qual frase do próprio pedido é a regra (s1..sN ou nenhum).
 *      O texto da regra é COPIADO do pedido (selecionar, não gerar);
 *    - escopo (só no assistente geral): regra deste cliente ou do jeito do
 *      dono trabalhar com o assistente.
 *    Duradoura com certeza vira `evitar` ou `preferencia` pelo gravarNoCerebro
 *    (texto igual ou mesmo sentido reforça; o que contradiz aposenta o antigo).
 * 2. Obedecer. `blocoDasRegras` põe as regras no sistema com apelidos r1..rN,
 *    EVITAR primeiro e com prioridade; o modelo devolve `regras_seguidas`.
 * 3. Devolver. A resposta leva `aprendi` (a linha "Aprendi: ... Esquecer") e
 *    `segui` (as regras usadas). "Esquecer" desliga a linha (ativa=false).
 *
 * Escopo do dono: agente_memoria.client_id é NOT NULL com chave para
 * profiles; a regra que não é de um cliente fica no perfil do próprio dono
 * (client_id = id do dono, agente "geral"). Só o assistente geral lê esse
 * escopo; os agentes de cada cliente não misturam.
 *
 * Puro (sem Deno): o Jev e a gravação chegam por parâmetro, e o vitest lê.
 */

import type { AreaDoCerebro, AgenteDaMemoria } from "./cerebro-do-cliente.ts";

export type AgenteQueAprende = "central" | "trafego" | "geral" | "workspace";
export type EscopoDaRegra = "cliente" | "dono";
export type CategoriaDaRegra = "evitar" | "preferencia";

/** Onde a regra mora no cérebro: a área e o agente de agente_memoria que já a leem. */
export const LUGAR_DA_REGRA: Record<AgenteQueAprende, { area: AreaDoCerebro; agente: AgenteDaMemoria }> = {
  central: { area: "geral", agente: "geral" },
  geral: { area: "geral", agente: "geral" },
  workspace: { area: "geral", agente: "geral" },
  trafego: { area: "conta", agente: "estrategista_ads" },
};

export const NOME_DO_AGENTE: Record<AgenteQueAprende, string> = {
  central: "agente da Central",
  geral: "assistente geral (Aceleriq)",
  workspace: "agente do Workspace",
  trafego: "agente de tráfego",
};

/** Fonte gravada na linha: diz qual agente aprendeu (e qual obedece). */
export const fonteDaRegra = (agente: AgenteQueAprende) => `aprendeu:${agente}`;

/** Corte de certeza: abaixo disso, não vira regra (o dono repete e aí vira). */
export const CORTE_DURADOURA = 0.6;
export const CORTE_TRECHO = 0.5;
export const MAX_TRECHOS = 10;
export const MAX_REGRAS_NO_PROMPT = 20;

const SEM_ACENTO = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g");
const normal = (s: string) => s.normalize("NFD").replace(SEM_ACENTO, "").toLowerCase();

/**
 * Filtro barato antes do Jev: o pedido tem cara de ajuste, reprovação ou
 * regra? Sem sinal nenhum, nem pergunta (custo e tempo por mensagem).
 */
const SINAIS = [
  /\bnao gostei\b/, /\bnao gosto\b/, /\bodiei\b/, /\bodeio\b/, /\bficou (ruim|feio|errad|pessim|horrivel)/,
  /\bnunca\b/, /\bsempre\b/, /\bjamais\b/, /\bnao (faca|faz|mande|manda|use|usa|coloque|coloca|crie|cria|marque|marca|escreva|escreve|repita|repete|mexa|mexe|quero)\b/,
  /\bpare de\b/, /\bpara de\b/, /\bchega de\b/, /\bevite\b/, /\bevita\b/, /\bprefiro\b/, /\bprefira\b/,
  /\bda proxima vez\b/, /\bdaqui (pra|para) frente\b/, /\ba partir de agora\b/, /\bde agora em diante\b/,
  /\baprenda\b/, /\baprende\b/, /\blembre(-se)? que\b/, /\bguarde que\b/, /\banota que\b/, /\bregra\b/,
  /\bnao pode\b/, /\bnao e (assim|pra|para)\b/, /\bestá errado\b|\besta errado\b/, /\bmenos\b.*\b(longo|texto|formal)\b/,
];

export function temSinalDeAprendizado(texto: unknown): boolean {
  const t = normal(String(texto ?? ""));
  if (t.trim().length < 6) return false;
  return SINAIS.some((r) => r.test(t));
}

/** As frases do pedido (candidatas a texto da regra), sem as curtas demais. */
export function trechosDoPedido(texto: unknown): string[] {
  const bruto = String(texto ?? "").replace(/\r/g, "").slice(0, 3000);
  // Sem lookbehind (piso de navegador antigo, caso a tela importe): a pontuação vira quebra de linha.
  const partes = bruto.replace(/([.!?;])\s+/g, "$1\n").split(/\n+/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const p of partes) {
    const limpo = p.replace(/^[-*•]\s*/, "").trim();
    if (limpo.length < 6) continue;
    const k = normal(limpo);
    if (vistos.has(k)) continue;
    vistos.add(k);
    saida.push(limpo.slice(0, 300));
    if (saida.length >= MAX_TRECHOS) break;
  }
  return saida;
}

/** O trecho escolhido vira a regra: primeira letra maiúscula, sem conectivo solto, com ponto. */
export function regraDoTrecho(trecho: string): string {
  let s = String(trecho || "").replace(/\s+/g, " ").trim();
  s = s.replace(/^(e|mas|e ai|entao|então|ah|olha|ok|tá|ta|pois)[,\s]+/i, "").trim();
  if (!s) return "";
  s = s.charAt(0).toUpperCase() + s.slice(1);
  if (!/[.!?]$/.test(s)) s += ".";
  return s.slice(0, 400);
}

export type RespostaChoiceDoJev = { choice?: string; probabilities?: Record<string, number>; confidence?: number };
export type PerguntarAoJev = (
  state: unknown,
  questions: Record<string, { type: "choice"; instructions: unknown; criteria: Record<string, unknown> }>,
) => Promise<Record<string, RespostaChoiceDoJev>>;

/** Estado e perguntas ao Jev (uma chamada, perguntas independentes). */
export function perguntasDoAprendizado(o: {
  texto: string;
  agente: AgenteQueAprende;
  cliente?: string | null;
  contexto?: string | null;
  comEscopo?: boolean;
}) {
  const trechos = trechosDoPedido(o.texto);
  const criteriosDoTrecho: Record<string, string> = {};
  trechos.forEach((t, i) => (criteriosDoTrecho[`s${i + 1}`] = t));
  criteriosDoTrecho.nenhum = "Nenhuma frase do pedido é uma instrução de como trabalhar daqui em diante.";
  const state = {
    agente: NOME_DO_AGENTE[o.agente],
    cliente: o.cliente || null,
    pedido_do_dono: o.texto.slice(0, 2000),
    frases_do_pedido: trechos.map((t, i) => ({ opcao: `s${i + 1}`, frase: t })),
    contexto_da_conversa: o.contexto ? String(o.contexto).slice(0, 1200) : null,
  };
  const questions: Record<string, { type: "choice"; instructions: unknown; criteria: Record<string, unknown> }> = {
    duracao: {
      type: "choice",
      instructions: "O dono de uma agência de marketing falou com um agente de IA do painel (`agente`). Em `pedido_do_dono`, ele deu uma instrução que deve valer para os próximos trabalhos (uma regra, um gosto, algo que ele não quer mais), ou é só um pedido ou correção desta vez?",
      criteria: {
        preferencia_duradoura: {
          what: "Regra ou gosto que vale daqui em diante: o agente deve lembrar nas próximas vezes.",
          examples: ["Nunca mande resumo longo.", "Não gostei desse tom formal, escreva sempre mais direto.", "Para este cliente, não marque tarefa na segunda."],
        },
        so_desta_vez: {
          what: "Pedido ou ajuste só deste trabalho, sem dizer que vale para sempre.",
          examples: ["Muda o prazo dessa tarefa para sexta.", "Deixa esse texto mais curto.", "Não precisa criar a tarefa agora."],
        },
        incerto: "Não dá para saber se vale para sempre ou só agora.",
      },
    },
    tipo: {
      type: "choice",
      instructions: "Supondo que `pedido_do_dono` traga uma regra para o futuro: ela diz o que o agente NÃO deve fazer (evitar) ou o que ele deve fazer ou preferir (preferência)?",
      criteria: {
        evitar: "Proíbe ou reprova algo: nunca, não faça, pare de, não gostei de, evite.",
        preferencia: "Pede um jeito de fazer: sempre, prefiro, faça assim, use tal coisa.",
      },
    },
    trecho: {
      type: "choice",
      instructions: "Qual frase de `frases_do_pedido` diz a instrução do dono para os próximos trabalhos (a regra em si)? Se nenhuma diz uma instrução, escolha nenhum.",
      criteria: criteriosDoTrecho,
    },
  };
  if (o.comEscopo) {
    questions.escopo = {
      type: "choice",
      instructions: "Supondo que `pedido_do_dono` traga uma regra para o futuro: ela é sobre o trabalho de um cliente específico (`cliente`) ou sobre o jeito como o dono quer que o assistente trabalhe com ele em geral, para qualquer cliente?",
      criteria: {
        cliente: "Sobre este cliente: o negócio, as peças, as tarefas ou o jeito de atender este cliente.",
        dono: "Sobre o jeito do assistente com o dono, para qualquer cliente: tamanho da resposta, tom, o que perguntar, como avisar.",
      },
    };
  }
  return { state, questions, trechos };
}

export type DecisaoDoAprendizado =
  | { vira_regra: true; texto: string; categoria: CategoriaDaRegra; escopo: EscopoDaRegra; probabilidade: number }
  | {
    vira_regra: false;
    motivo: "sem_sinal" | "so_desta_vez" | "incerto" | "sem_trecho" | "jev_falhou";
    probabilidade: number | null;
    /** Incerto com a frase achada: a tela oferece "Guardar como regra" (nada gravado). */
    texto?: string;
    categoria?: CategoriaDaRegra;
    escopo?: EscopoDaRegra;
  };

const prob = (r: RespostaChoiceDoJev | undefined, opcao: string) =>
  r && r.probabilities && typeof r.probabilities[opcao] === "number" ? r.probabilities[opcao] : r && r.choice === opcao && typeof r.confidence === "number" ? r.confidence : 0;

/** Lê as respostas do Jev e decide (política explícita no código). */
export function lerDecisaoDoAprendizado(
  respostas: Record<string, RespostaChoiceDoJev>,
  trechos: string[],
  opcoes: { comEscopo?: boolean } = {},
): DecisaoDoAprendizado {
  const pDuradoura = prob(respostas.duracao, "preferencia_duradoura");
  const escolhido = respostas.trecho?.choice || "";
  const m = /^s(\d+)$/.exec(escolhido);
  const trecho = m ? trechos[Number(m[1]) - 1] : undefined;
  const texto = trecho && prob(respostas.trecho, escolhido) >= CORTE_TRECHO ? regraDoTrecho(trecho) : "";
  const categoria: CategoriaDaRegra = respostas.tipo?.choice === "preferencia" ? "preferencia" : "evitar";
  const escopo: EscopoDaRegra = opcoes.comEscopo && respostas.escopo?.choice === "dono" ? "dono" : "cliente";
  const p = Math.round(pDuradoura * 1000) / 1000;
  if (respostas.duracao?.choice === "so_desta_vez") return { vira_regra: false, motivo: "so_desta_vez", probabilidade: p };
  if (respostas.duracao?.choice !== "preferencia_duradoura" || pDuradoura < CORTE_DURADOURA) {
    // Incerto: nada é gravado; com a frase achada, a tela pergunta se guarda.
    return texto.length >= 6 ? { vira_regra: false, motivo: "incerto", probabilidade: p, texto, categoria, escopo } : { vira_regra: false, motivo: "incerto", probabilidade: p };
  }
  if (texto.length < 6) return { vira_regra: false, motivo: "sem_trecho", probabilidade: p };
  return { vira_regra: true, texto, categoria, escopo, probabilidade: p };
}

/** O que a gravação devolve (mesmo formato de gravarNoCerebro). */
export type GravacaoDaRegra = {
  gravada: boolean;
  situacao: "criado" | "reforcado" | "substituiu" | null;
  id: string | null;
  reforcos: number | null;
  substituidos: string[];
  erro: string | null;
};

export type NovaRegra = {
  client_id: string;
  area: AreaDoCerebro;
  categoria: CategoriaDaRegra;
  texto: string;
  motivo: string;
  evidencia: string;
  fonte: string;
  criado_por: string | null;
  agente: AgenteDaMemoria;
};

/**
 * A linha "Aprendi: ..." que volta na resposta. Mesmo formato do anexo das
 * mesas (frente AG2, _shared/aprendizado-das-mesas.ts), para a tela usar o
 * mesmo AprendizadoDoAgente: com id, "Esquecer"; sem id (incerto),
 * "Guardar como regra".
 */
export const TIPO_DO_ANEXO_APRENDI = "aprendizado_do_agente";
export const TIPO_DO_ANEXO_SEGUI = "regras_seguidas";

export type Aprendi = {
  tipo: typeof TIPO_DO_ANEXO_APRENDI;
  id: string | null;
  texto: string;
  categoria: CategoriaDaRegra;
  decisao: "preferencia_duradoura" | "incerto";
  situacao: "criado" | "reforcado" | "substituiu" | null;
  reforcos: number | null;
  escopo: EscopoDaRegra;
  agente: AgenteQueAprende;
};

/** Grava a regra (duradoura pelo Jev, ou "Guardar" do incerto pela equipe). */
async function gravarARegra(o: {
  texto: string;
  categoria: CategoriaDaRegra;
  escopo: EscopoDaRegra;
  agente: AgenteQueAprende;
  clientId: string | null;
  donoId: string | null;
  evidencia: string;
  gravar: (nova: NovaRegra) => Promise<GravacaoDaRegra>;
}): Promise<{ aprendi: Aprendi | null; erro: string | null }> {
  // Sem cliente, a regra só pode ser do dono (e só se houver dono).
  const dono = o.escopo === "dono" || !o.clientId;
  const alvo = dono ? o.donoId : o.clientId;
  if (!alvo) return { aprendi: null, erro: "sem cliente e sem dono para guardar a regra" };
  const lugar = dono ? LUGAR_DA_REGRA.geral : LUGAR_DA_REGRA[o.agente];
  const g = await o.gravar({
    client_id: alvo,
    area: lugar.area,
    categoria: o.categoria,
    texto: o.texto,
    motivo: `Pedido do dono ao ${NOME_DO_AGENTE[o.agente]}${dono ? " (vale para qualquer cliente)" : ""}.`,
    evidencia: o.evidencia.replace(/\s+/g, " ").trim().slice(0, 380),
    fonte: fonteDaRegra(dono ? "geral" : o.agente),
    criado_por: o.donoId,
    agente: lugar.agente,
  });
  if (!g.gravada || !g.id || !g.situacao) return { aprendi: null, erro: g.erro || "a regra não foi gravada" };
  return {
    aprendi: {
      tipo: TIPO_DO_ANEXO_APRENDI, id: g.id, texto: o.texto, categoria: o.categoria, decisao: "preferencia_duradoura",
      situacao: g.situacao, reforcos: g.reforcos ?? 1, escopo: dono ? "dono" : "cliente", agente: o.agente,
    },
    erro: null,
  };
}

/**
 * Do pedido à regra gravada. Nunca lança: falha do Jev ou da gravação volta
 * como `aprendi: null` com o motivo (e o chamador põe no log). Incerto com a
 * frase achada volta como `aprendi` sem id (nada gravado).
 */
export async function aprenderDoPedido(o: {
  texto: string;
  agente: AgenteQueAprende;
  clientId: string | null;
  /** Id do dono (quem pediu): escopo "dono" no assistente geral. */
  donoId: string | null;
  cliente?: string | null;
  contexto?: string | null;
  perguntar: PerguntarAoJev;
  gravar: (nova: NovaRegra) => Promise<GravacaoDaRegra>;
}): Promise<{ aprendi: Aprendi | null; decisao: DecisaoDoAprendizado; erro: string | null }> {
  if (!temSinalDeAprendizado(o.texto)) return { aprendi: null, decisao: { vira_regra: false, motivo: "sem_sinal", probabilidade: null }, erro: null };
  const comEscopo = o.agente === "geral" && !!o.donoId;
  const { state, questions, trechos } = perguntasDoAprendizado({ texto: o.texto, agente: o.agente, cliente: o.cliente, contexto: o.contexto, comEscopo });
  if (!trechos.length) return { aprendi: null, decisao: { vira_regra: false, motivo: "sem_trecho", probabilidade: null }, erro: null };
  let respostas: Record<string, RespostaChoiceDoJev>;
  try {
    respostas = await o.perguntar(state, questions);
  } catch (e) {
    return { aprendi: null, decisao: { vira_regra: false, motivo: "jev_falhou", probabilidade: null }, erro: e instanceof Error ? e.message : "Jev falhou" };
  }
  const decisao = lerDecisaoDoAprendizado(respostas, trechos, { comEscopo });
  if (!decisao.vira_regra) {
    // Cast explícito: o tsconfig dos testes não estreita a união pelo booleano.
    const nao = decisao as Extract<DecisaoDoAprendizado, { vira_regra: false }>;
    if (nao.motivo === "incerto" && nao.texto && nao.categoria) {
      const escopo: EscopoDaRegra = nao.escopo === "dono" || !o.clientId ? "dono" : "cliente";
      return {
        aprendi: { tipo: TIPO_DO_ANEXO_APRENDI, id: null, texto: nao.texto, categoria: nao.categoria, decisao: "incerto", situacao: null, reforcos: null, escopo, agente: o.agente },
        decisao,
        erro: null,
      };
    }
    return { aprendi: null, decisao, erro: null };
  }
  const g = await gravarARegra({ texto: decisao.texto, categoria: decisao.categoria, escopo: decisao.escopo, agente: o.agente, clientId: o.clientId, donoId: o.donoId, evidencia: o.texto, gravar: o.gravar });
  return { aprendi: g.aprendi, decisao, erro: g.erro };
}

/** "Guardar como regra" do incerto: a equipe decidiu que vale para sempre. */
export async function guardarRegraDoDono(o: {
  texto: string;
  categoria: CategoriaDaRegra;
  escopo: EscopoDaRegra;
  agente: AgenteQueAprende;
  clientId: string | null;
  donoId: string | null;
  gravar: (nova: NovaRegra) => Promise<GravacaoDaRegra>;
}): Promise<{ aprendi: Aprendi | null; erro: string | null }> {
  const texto = regraDoTrecho(String(o.texto || "").slice(0, 400));
  if (texto.length < 6) return { aprendi: null, erro: "regra vazia" };
  return await gravarARegra({ ...o, texto, categoria: o.categoria === "preferencia" ? "preferencia" : "evitar", evidencia: `Guardado pela equipe: ${texto}` });
}

// ------------------------------------------------------------------ obedecer

// deno-lint-ignore no-explicit-any
export type BancoDasRegras = { from: (tabela: string) => any };

export type RegraAtiva = { ref: string; id: string; texto: string; categoria: CategoriaDaRegra; escopo: EscopoDaRegra; reforcos: number };

/**
 * As regras que este agente obedece: evitar e preferência ativas do cliente
 * (as gerais do cérebro e as que este agente ou o assistente geral
 * aprenderam) e, no assistente geral, as do dono. EVITAR primeiro, depois as
 * mais reforçadas. Falha de leitura vira lista vazia (o agente segue).
 */
export async function regrasDoAgente(
  db: BancoDasRegras,
  o: { agente: AgenteQueAprende; clientId: string | null; donoId?: string | null; agora?: Date },
): Promise<RegraAtiva[]> {
  const agora = (o.agora ?? new Date()).toISOString();
  const lugar = LUGAR_DA_REGRA[o.agente];
  const areas = Array.from(new Set(["geral", lugar.area, ...(o.agente === "trafego" ? ["ads"] : [])]));
  const minhas = new Set([fonteDaRegra(o.agente), fonteDaRegra("geral")]);
  const ler = async (clientId: string, escopo: EscopoDaRegra) => {
    try {
      const r = await db.from("agente_memoria").select("id, texto, categoria, tipo, area, fonte, reforcos, valido_ate")
        .eq("client_id", clientId).eq("ativa", true).in("tipo", ["evitar", "preferencia"])
        .order("reforcos", { ascending: false }).limit(60);
      if (r?.error) return [];
      return ((r?.data ?? []) as Array<Record<string, unknown>>)
        .filter((l) => !l.valido_ate || String(l.valido_ate) > agora)
        .filter((l) => areas.indexOf(String(l.area || "geral")) >= 0)
        .filter((l) => {
          const f = String(l.fonte || "");
          if (escopo === "dono") return f === fonteDaRegra("geral");
          return f.indexOf("aprendeu:") !== 0 || minhas.has(f);
        })
        .map((l) => ({
          id: String(l.id),
          texto: String(l.texto || "").replace(/\s+/g, " ").trim().slice(0, 300),
          categoria: (l.tipo === "evitar" ? "evitar" : "preferencia") as CategoriaDaRegra,
          escopo,
          reforcos: Number(l.reforcos) || 1,
        }))
        .filter((l) => l.texto.length >= 3);
    } catch {
      return [];
    }
  };
  const [doCliente, doDono] = await Promise.all([
    o.clientId ? ler(o.clientId, "cliente") : Promise.resolve([]),
    o.agente === "geral" && o.donoId && o.donoId !== o.clientId ? ler(o.donoId, "dono") : Promise.resolve([]),
  ]);
  return [...doCliente, ...doDono]
    .sort((a, b) => (a.categoria === b.categoria ? b.reforcos - a.reforcos : a.categoria === "evitar" ? -1 : 1))
    .slice(0, MAX_REGRAS_NO_PROMPT)
    .map((r, i) => ({ ...r, ref: `r${i + 1}` }));
}

/** O bloco do sistema: regras com apelido, EVITAR com prioridade, e o campo de volta. */
export function blocoDasRegras(regras: RegraAtiva[]): string {
  if (!regras.length) return "";
  const evitar = regras.filter((r) => r.categoria === "evitar");
  const preferir = regras.filter((r) => r.categoria === "preferencia");
  const linha = (r: RegraAtiva) => `- ${r.ref}: ${r.texto}${r.escopo === "dono" ? " (regra do dono, qualquer cliente)" : ""}${r.reforcos > 1 ? ` (pedido ${r.reforcos} vezes)` : ""}`;
  return [
    "",
    "## REGRAS QUE O DONO ENSINOU (obrigatórias)",
    "EVITAR manda sobre tudo, inclusive sobre o pedido de agora e sobre sugestão sua. Se o pedido de agora contraria uma regra, siga o pedido só se ele disser claramente que mudou de ideia; senão, siga a regra e diga em uma frase que seguiu.",
    evitar.length ? `EVITAR:\n${evitar.map(linha).join("\n")}` : "",
    preferir.length ? `PREFERÊNCIAS:\n${preferir.map(linha).join("\n")}` : "",
    'Devolva no JSON o campo "regras_seguidas": lista dos apelidos (r1, r2...) das regras que mudaram esta resposta ou ação. Vazio se nenhuma pesou.',
  ].filter(Boolean).join("\n");
}

/** "regras_seguidas" do modelo -> as regras de verdade (apelido inventado fica de fora). */
export type AnexoDasRegrasSeguidas = { tipo: typeof TIPO_DO_ANEXO_SEGUI; regras: Array<{ id: string; tipo: CategoriaDaRegra; texto: string }> };

export function regrasSeguidas(bruto: unknown, regras: RegraAtiva[]): AnexoDasRegrasSeguidas | null {
  const lista = Array.isArray(bruto) ? bruto.map((x) => String(x).trim().toLowerCase()) : [];
  const saida: AnexoDasRegrasSeguidas["regras"] = [];
  for (const ref of lista) {
    const r = regras.find((x) => x.ref === ref);
    if (r && !saida.some((s) => s.id === r.id)) saida.push({ id: r.id, tipo: r.categoria, texto: r.texto });
    if (saida.length >= 4) break;
  }
  return saida.length ? { tipo: TIPO_DO_ANEXO_SEGUI, regras: saida } : null;
}

/** Os anexos "Aprendi" e "Segui" juntos, prontos para a mensagem ou a resposta. */
export function anexosDoAprendizado(aprendi: Aprendi | null, segui: AnexoDasRegrasSeguidas | null): unknown[] {
  return [aprendi, segui].filter(Boolean) as unknown[];
}

// ------------------------------------------------------------------ esquecer

/**
 * "Esquecer": a regra sai do cérebro (ativa=false; continua no histórico).
 * Só apaga regra aprendida em conversa (fonte aprendeu:*) de um dos donos
 * permitidos (o cliente da conversa ou o próprio dono).
 */
export async function esquecerRegra(db: BancoDasRegras, o: { id: string; donosPermitidos: string[] }): Promise<{ ok: boolean; motivo: string | null }> {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID.test(String(o.id || ""))) return { ok: false, motivo: "Regra inválida." };
  const donos = o.donosPermitidos.filter((d) => UUID.test(String(d || "")));
  if (!donos.length) return { ok: false, motivo: "Sem acesso a esta regra." };
  const lida = await db.from("agente_memoria").select("id, client_id, fonte, ativa").eq("id", o.id).maybeSingle();
  const l = lida?.data as { id: string; client_id: string; fonte: string | null; ativa: boolean } | null;
  if (lida?.error || !l) return { ok: false, motivo: "Esta regra não existe mais." };
  if (donos.indexOf(l.client_id) < 0) return { ok: false, motivo: "Sem acesso a esta regra." };
  if (String(l.fonte || "").indexOf("aprendeu:") !== 0) return { ok: false, motivo: "Esta regra não foi aprendida numa conversa: tire pela tela do que o painel aprendeu." };
  if (!l.ativa) return { ok: true, motivo: null };
  const r = await db.from("agente_memoria").update({ ativa: false }).eq("id", o.id).eq("client_id", l.client_id);
  if (r?.error) return { ok: false, motivo: "Não foi possível esquecer agora." };
  return { ok: true, motivo: null };
}
