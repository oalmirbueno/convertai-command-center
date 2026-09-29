/**
 * Aprendizado dos agentes das mesas de mídia (frente AG2, 29/09/2026).
 *
 * Pedido do dono: "Todos eles têm que aprender com cada ajuste, cada coisa que
 * eu peço para aprender. Tem coisas que não pode mais fazer quando eu peço e
 * não gostei. Tem que ter inteligência de aprendizado. Cada ação tem que
 * devolver."
 *
 * Sem tabela nova: grava e lê no cérebro do cliente (agente_memoria, pelas
 * regras de cerebro-do-cliente.ts e cerebro-nas-mesas.ts: texto igual ou com o
 * mesmo sentido vira reforço, o que contradiz aposenta o antigo).
 *
 * 1. REGISTRAR (`aprenderDoPedido`): ajuste, reprovação, "não gostei", "nunca
 *    faça X", "sempre faça Y" ou correção. O Jev (Choice) decide se é
 *    preferência duradoura ou pedido de uma vez só, e se é "evitar" ou
 *    "preferência". Só a duradoura vira regra. Incerto não grava: a tela
 *    oferece "Guardar como regra".
 * 2. OBEDECER (`regrasDaMesa`): as regras da mesa entram no sistema do modelo
 *    com apelidos (g1, g2...), EVITAR primeiro e com prioridade. O modelo diz
 *    quais seguiu (`regras_seguidas`) e o código traduz o apelido.
 * 3. DEVOLVER: a resposta leva o anexo `aprendizado_do_agente` ("Aprendi: …",
 *    com Esquecer) e `regras_seguidas` ("Segui: …").
 *
 * Mesa → área do cérebro (as áreas do banco são fixas; a mesa fica na fonte):
 * foto → foto; vídeo, edição e estilo → arte; publicidade → campanha;
 * roteiro → copy. A marca, quando há, fica na evidência ("marca:<id>"): regra
 * de uma marca não vale para a outra marca do mesmo cliente.
 *
 * O banco e o Jev chegam por parâmetro: roda no vitest.
 */
import { jevPerguntar, type RespostaJev } from "./jev.ts";
import { registrarFalha } from "./falha-registrada.ts";
import { AGENTE_DA_AREA, type AreaDoCerebro, type BancoDoCerebro, type JulgarAprendizado } from "./cerebro-do-cliente.ts";
import { gravarNoCerebro } from "./cerebro-nas-mesas.ts";

// Frente RO (29/09): o Estúdio (diretor de arte e o Ajustar da lâmina) aprende pelo mesmo caminho.
// Frentes CON, IDV, PRO e SIT (30/09): contratos, diretor de marca (identidade e naming), estrategista comercial e diretor de site.
export const MESAS_QUE_APRENDEM = ["foto", "video", "edicao", "publicidade", "roteiro", "estilo", "estudio", "contrato", "identidade", "naming", "proposta", "site"] as const;
export type MesaQueAprende = (typeof MESAS_QUE_APRENDEM)[number];

export const AREA_DA_MESA: Record<MesaQueAprende, AreaDoCerebro> = {
  foto: "foto",
  video: "arte",
  edicao: "arte",
  publicidade: "campanha",
  roteiro: "copy",
  estilo: "arte",
  estudio: "arte",
  contrato: "geral",
  identidade: "arte",
  naming: "copy",
  proposta: "copy",
  site: "arte",
};

export const FONTE_DA_MESA: Record<MesaQueAprende, string> = {
  foto: "mesa_foto",
  video: "mesa_videos",
  edicao: "mesa_edicao",
  publicidade: "mesa_publicidade",
  roteiro: "mesa_roteiros",
  estilo: "estilo",
  estudio: "estudio_aprendizado",
  contrato: "mesa_contratos",
  identidade: "mesa_identidade",
  naming: "mesa_naming",
  proposta: "mesa_proposta",
  site: "mesa_site",
};

const NOME_DA_MESA: Record<MesaQueAprende, string> = {
  foto: "Mesa Foto (diretor de fotografia)",
  video: "Mesa Vídeos (diretor de vídeo)",
  edicao: "Mesa Edição (editor de vídeo)",
  publicidade: "Mesa Publicidade (diretor de campanha)",
  roteiro: "Mesa Roteiros (roteirista)",
  estilo: "Estilo do cliente (diretor de arte)",
  estudio: "Estúdio (diretor de arte das lâminas e o Ajustar)",
  contrato: "Contratos (agente de contratos)",
  identidade: "Mesa Identidade (diretor de marca)",
  naming: "Mesa Identidade (criador de nomes)",
  proposta: "Mesa Proposta (estrategista comercial)",
  site: "Mesa Site (diretor de site)",
};

const FONTES_DAS_MESAS = new Set(Object.values(FONTE_DA_MESA));

export const TIPO_DO_ANEXO_APRENDI = "aprendizado_do_agente";
export const TIPO_DO_ANEXO_SEGUI = "regras_seguidas";

// ------------------------------------------------------------------ registrar

/**
 * Regra barata antes do Jev: o pedido ensina algo? (ajuste, gosto, proibição,
 * correção). Pedido comum ("gere 3 fotos") não gasta chamada.
 */
const ENSINA = /\b(n[aã]o gostei|n[aã]o curti|n[aã]o ficou bom|ficou (ruim|feio|estranho|errado)|detestei|odiei|odeio|nunca|jamais|sempre|toda vez|todas as vezes|da pr[oó]xima( vez)?|de agora em diante|a partir de agora|daqui pra frente|n[aã]o fa[cç]a|n[aã]o faz|n[aã]o use|n[aã]o usa|n[aã]o coloque|n[aã]o p[oõ]e|n[aã]o quero( mais)?|pare de|para de|chega de|evite|evita|prefiro|preferimos|gosto (mais )?de|gostamos|aprenda|aprende|lembre|lembra (disso|que)|guarde|anota|anote|isso n[aã]o|errou|est[aá] errad[oa]|corrig|reprov|n[aã]o era isso|muito (escuro|claro|saturado|artificial|falso|pl[aá]stico|gen[eé]rico)|menos |mais natural|tira (o|a|os|as) )/i;

export function pareceEnsino(texto: unknown): boolean {
  return ENSINA.test(String(texto == null ? "" : texto));
}

export type DecisaoDoEnsino = "preferencia_duradoura" | "so_desta_vez" | "incerto";
export type TipoDaRegra = "evitar" | "preferencia";

export type JulgamentoDoEnsino = {
  decisao: DecisaoDoEnsino;
  tipo: TipoDaRegra;
  probabilidade: number | null;
  fonte: "jev" | "regra";
};

export const LIMIAR_DO_DURADOURO = 0.6;

/** Regra de reserva sem Jev: palavra de "para sempre" decide; "não gostei" sozinho fica incerto. */
export function julgamentoPorPalavras(texto: string): JulgamentoDoEnsino {
  const t = String(texto || "").toLowerCase();
  const sempre = /\b(nunca|jamais|sempre|toda vez|todas as vezes|da pr[oó]xima|de agora em diante|a partir de agora|daqui pra frente|n[aã]o quero mais|pare de|para de|chega de|aprenda|aprende|lembre|guarde|anote)\b/.test(t);
  const nega = /\b(n[aã]o|nunca|jamais|evite|evita|pare|para de|chega|detestei|odiei|odeio|errou|errad|reprov|menos)\b/.test(t);
  return { decisao: sempre ? "preferencia_duradoura" : "incerto", tipo: nega ? "evitar" : "preferencia", probabilidade: null, fonte: "regra" };
}

function probDe(r: RespostaJev | undefined, op: string): number | null {
  if (!r) return null;
  if (r.probabilities && typeof r.probabilities[op] === "number") return r.probabilities[op];
  return r.choice === op && typeof r.confidence === "number" ? r.confidence : null;
}

/** Lê as duas escolhas do Jev (exportada para o teste). */
export function lerJulgamento(respostas: Record<string, RespostaJev>): JulgamentoDoEnsino | null {
  const d = respostas.duracao;
  const t = respostas.tipo;
  if (!d || typeof d.choice !== "string") return null;
  const escolha = d.choice as DecisaoDoEnsino;
  if (escolha !== "preferencia_duradoura" && escolha !== "so_desta_vez" && escolha !== "incerto") return null;
  const p = probDe(d, escolha);
  // Duradoura com pouca certeza vira incerta: a tela pergunta em vez de gravar.
  const decisao: DecisaoDoEnsino = escolha === "preferencia_duradoura" && p !== null && p < LIMIAR_DO_DURADOURO ? "incerto" : escolha;
  const tipo: TipoDaRegra = t && t.choice === "evitar" ? "evitar" : "preferencia";
  return { decisao, tipo, probabilidade: p, fonte: "jev" };
}

/** Pergunta ao Jev: duradoura ou de uma vez só, e evitar ou preferência (uma chamada, duas perguntas em paralelo). */
export async function julgarEnsino(
  p: { pedido: string; regra: string; mesa: MesaQueAprende; ultimaResposta?: string | null; motivo?: string | null },
  opcoes: { chave?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<JulgamentoDoEnsino> {
  try {
    const r = await jevPerguntar(
      {
        state: {
          mesa: NOME_DA_MESA[p.mesa],
          pedido_da_equipe: String(p.pedido || "").slice(0, 1500),
          motivo_informado: p.motivo ? String(p.motivo).slice(0, 600) : null,
          regra_que_seria_guardada: String(p.regra || "").slice(0, 300),
          ultima_resposta_do_agente: p.ultimaResposta ? String(p.ultimaResposta).slice(0, 1000) : null,
        },
        questions: {
          duracao: {
            type: "choice",
            instructions:
              "A equipe de uma agência pediu um ajuste ou reclamou de um resultado. Isso deve virar uma regra que o agente segue SEMPRE com este cliente (gosto, proibição, padrão da marca), ou vale só para este trabalho de agora?",
            criteria: {
              preferencia_duradoura: "vale daqui para frente com este cliente: gosto ou proibição estável (\"nunca\", \"sempre\", \"não gosto de\", \"da próxima vez\", correção de algo que a marca não aceita)",
              so_desta_vez: "é um ajuste deste trabalho específico (esta foto, este roteiro, esta versão), sem dizer que vale para os próximos",
              incerto: "não dá para saber se vale para os próximos trabalhos",
            },
          },
          tipo: {
            type: "choice",
            instructions: "Se isso virar regra, ela diz o que NÃO fazer ou o que fazer/preferir?",
            criteria: {
              evitar: "proíbe ou pede para parar algo (não usar, não fazer, menos de algo, algo que não gostaram)",
              preferencia: "pede um jeito de fazer, um gosto ou um padrão a seguir",
            },
          },
        },
      },
      { chave: opcoes.chave, fetchImpl: opcoes.fetchImpl, timeoutMs: opcoes.timeoutMs ?? 6_000 },
    );
    const j = lerJulgamento(r.answers);
    if (j) return j;
  } catch (e) {
    registrarFalha(`aprendizado ${p.mesa}: Jev fora (vale a regra das palavras)`, e);
  }
  return julgamentoPorPalavras(`${p.pedido} ${p.motivo || ""}`);
}

export type Aprendido = {
  tipo: typeof TIPO_DO_ANEXO_APRENDI;
  /** Id da linha em agente_memoria (null quando incerto: nada gravado). */
  id: string | null;
  texto: string;
  categoria: TipoDaRegra;
  decisao: DecisaoDoEnsino;
  situacao: "criado" | "reforcado" | "substituiu" | null;
  reforcos: number | null;
  mesa: MesaQueAprende;
  esquecido_em?: string | null;
};

/** Texto curto e acionável da regra: o que o modelo sugeriu, senão o próprio pedido. */
export function textoDaRegra(regraSugerida: unknown, pedido: string, tipo: TipoDaRegra): string {
  const limpa = (s: unknown) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  let t = limpa(regraSugerida);
  if (t.length < 6) {
    t = limpa(pedido);
    if (t.length > 180) t = `${t.slice(0, 177).trimEnd()}…`;
    // "não gostei dessa cor" não é regra acionável; "não usar X" e "nunca X" já são.
    if (t && tipo === "evitar" && !/^(evitar|nunca|jamais|n[aã]o (use|usar|fa[cç]a|fazer|coloque|colocar|ponha|p[oô]r|mostre|mostrar|inclua|incluir))/i.test(t)) t = `Evitar: ${t}`;
  }
  return t.slice(0, 300);
}

export function evidenciaDaMarca(marcaId: string | null | undefined, extra?: string | null): string | null {
  const partes = [marcaId ? `marca:${marcaId}` : null, extra ? String(extra).slice(0, 300) : null].filter(Boolean);
  return partes.length ? partes.join("; ") : null;
}

function marcaDaEvidencia(evidencia: unknown): string | null {
  const m = /marca:([0-9a-f-]{36})/i.exec(String(evidencia || ""));
  return m ? m[1].toLowerCase() : null;
}

/**
 * Registra o que o pedido ensinou, quando ensina. Nunca lança.
 * - Sem sinal de ensino (e sem `forcar`): null, sem chamada.
 * - so_desta_vez: null (nada gravado, nada na tela).
 * - incerto: devolve o anexo sem id (a tela oferece "Guardar como regra").
 * - duradoura: grava pelo cérebro (reforça se já existe) e devolve o anexo.
 */
export async function aprenderDoPedido(
  db: BancoDoCerebro,
  p: {
    clientId: string;
    mesa: MesaQueAprende;
    pedido: string;
    /** Texto curto e acionável que o modelo propôs (campo `regra_aprendida`), quando há. */
    regraSugerida?: unknown;
    /** Motivo de reprovação/ajuste vindo da tela (sempre ensina algo). */
    motivo?: string | null;
    marcaId?: string | null;
    userId?: string | null;
    ultimaResposta?: string | null;
    /** Reprovação com motivo: vale perguntar ao Jev mesmo sem as palavras de ensino. */
    forcar?: boolean;
  },
  opcoes: { julgarEnsino?: typeof julgarEnsino; julgarDuplicidade?: JulgarAprendizado | null } = {},
): Promise<Aprendido | null> {
  try {
    const base = `${p.pedido || ""} ${p.motivo || ""}`.trim();
    if (!base) return null;
    if (!p.forcar && !pareceEnsino(base) && !String(p.regraSugerida || "").trim()) return null;
    const julgar = opcoes.julgarEnsino ?? julgarEnsino;
    const regraProvisoria = textoDaRegra(p.regraSugerida, p.motivo || p.pedido, "preferencia");
    const j = await julgar({ pedido: p.pedido || p.motivo || "", regra: regraProvisoria, mesa: p.mesa, ultimaResposta: p.ultimaResposta, motivo: p.motivo });
    if (j.decisao === "so_desta_vez") return null;
    const texto = textoDaRegra(p.regraSugerida, p.motivo || p.pedido, j.tipo);
    if (texto.length < 3) return null;
    if (j.decisao === "incerto") {
      return { tipo: TIPO_DO_ANEXO_APRENDI, id: null, texto, categoria: j.tipo, decisao: "incerto", situacao: null, reforcos: null, mesa: p.mesa };
    }
    return await guardarRegra(db, { clientId: p.clientId, mesa: p.mesa, texto, tipo: j.tipo, marcaId: p.marcaId, userId: p.userId, pedido: p.pedido || p.motivo || "" }, opcoes);
  } catch (e) {
    registrarFalha(`aprendizado ${p.mesa}: não registrado`, e, { client_id: p.clientId });
    return null;
  }
}

/** Grava (ou reforça) uma regra dita pela equipe. Também serve o botão "Guardar como regra". Nunca lança. */
export async function guardarRegra(
  db: BancoDoCerebro,
  p: { clientId: string; mesa: MesaQueAprende; texto: string; tipo: TipoDaRegra; marcaId?: string | null; userId?: string | null; pedido?: string | null },
  opcoes: { julgarDuplicidade?: JulgarAprendizado | null } = {},
): Promise<Aprendido | null> {
  const texto = String(p.texto || "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (texto.length < 3) return null;
  const area = AREA_DA_MESA[p.mesa];
  const g = await gravarNoCerebro(db, {
    client_id: p.clientId,
    area,
    categoria: p.tipo,
    texto,
    motivo: null,
    evidencia: evidenciaDaMarca(p.marcaId, p.pedido ? `pedido: "${String(p.pedido).slice(0, 240)}"` : null),
    fonte: FONTE_DA_MESA[p.mesa],
    criado_por: p.userId ?? null,
    agente: AGENTE_DA_AREA[area],
  }, { julgar: opcoes.julgarDuplicidade === undefined ? undefined : opcoes.julgarDuplicidade });
  if (!g.gravada || !g.id) {
    registrarFalha(`aprendizado ${p.mesa}: regra não gravada`, g.erro || "sem id", { client_id: p.clientId });
    return null;
  }
  return { tipo: TIPO_DO_ANEXO_APRENDI, id: g.id, texto, categoria: p.tipo, decisao: "preferencia_duradoura", situacao: g.situacao, reforcos: g.reforcos, mesa: p.mesa };
}

/** "Esquecer": a regra sai (ativa=false; o histórico fica). Só do cliente dado. Nunca lança. */
export async function esquecerRegra(db: BancoDoCerebro, p: { clientId: string; id: string }): Promise<{ ok: boolean; erro: string | null }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(p.id || ""))) return { ok: false, erro: "id inválido" };
  try {
    const { data, error } = await db.from("agente_memoria").update({ ativa: false }).eq("id", p.id).eq("client_id", p.clientId).select("id");
    if (error) return { ok: false, erro: registrarFalha("aprendizado: esquecer falhou", error) };
    if (!Array.isArray(data) || !data.length) return { ok: false, erro: "Regra não encontrada neste cliente." };
    return { ok: true, erro: null };
  } catch (e) {
    return { ok: false, erro: registrarFalha("aprendizado: esquecer falhou", e) };
  }
}

// ------------------------------------------------------------------ obedecer

export type RegraDaMesa = { ref: string; id: string; tipo: TipoDaRegra; texto: string; reforcos: number };

export const MAX_REGRAS_NO_PROMPT = 20;

/**
 * As regras que valem para a mesa (EVITAR primeiro, depois as mais pedidas),
 * com apelido g1..gN. Área da mesa + geral; regra de OUTRA mesa AG2 da mesma
 * área não entra (a regra do vídeo não manda no estilo); regra de outra marca
 * do cliente não entra. Nunca lança.
 */
export async function regrasDaMesa(
  db: BancoDoCerebro,
  p: { clientId: string; mesa: MesaQueAprende; marcaId?: string | null },
): Promise<{ regras: RegraDaMesa[]; bloco: string }> {
  try {
    const area = AREA_DA_MESA[p.mesa];
    const agente = AGENTE_DA_AREA[area];
    const minha = FONTE_DA_MESA[p.mesa];
    const { data, error } = await db.from("agente_memoria")
      .select("id, agente, area, tipo, categoria, texto, fonte, evidencia, reforcos, valido_ate, criado_em")
      .eq("client_id", p.clientId).eq("ativa", true).in("agente", [agente, "geral"]).in("tipo", ["evitar", "preferencia"])
      .order("criado_em", { ascending: false }).limit(120);
    if (error) {
      registrarFalha(`aprendizado ${p.mesa}: regras não lidas`, error);
      return { regras: [], bloco: "" };
    }
    const agora = Date.now();
    const marca = p.marcaId ? String(p.marcaId).toLowerCase() : null;
    const linhas = ((data as Array<Record<string, unknown>> | null) ?? []).filter((l) => {
      const a = typeof l.area === "string" ? l.area : null;
      if (a && a !== area && a !== "geral") return false;
      const fonte = typeof l.fonte === "string" ? l.fonte : "";
      if (FONTES_DAS_MESAS.has(fonte) && fonte !== minha) return false;
      // Memória da entrega e categorias que não são regra não entram.
      if (l.categoria && ["evitar", "reprovado", "preferencia", "ajuste"].indexOf(String(l.categoria)) < 0) return false;
      // Regra de uma marca não vale na outra marca do mesmo cliente (sem marca na tela, vale).
      const m = marcaDaEvidencia(l.evidencia);
      if (m && marca && m !== marca) return false;
      const vale = typeof l.valido_ate === "string" ? new Date(l.valido_ate).getTime() : NaN;
      return Number.isNaN(vale) || vale > agora;
    });
    const vistos = new Set<string>();
    const ordenadas = linhas
      .map((l) => ({ id: String(l.id), tipo: (l.tipo === "evitar" ? "evitar" : "preferencia") as TipoDaRegra, texto: String(l.texto || "").replace(/\s+/g, " ").trim().slice(0, 300), reforcos: Math.max(1, Number(l.reforcos) || 1), minha: l.fonte === minha }))
      .filter((r) => r.texto && !vistos.has(r.texto.toLowerCase()) && vistos.add(r.texto.toLowerCase()))
      .sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === "evitar" ? -1 : 1) || Number(b.minha) - Number(a.minha) || b.reforcos - a.reforcos)
      .slice(0, MAX_REGRAS_NO_PROMPT);
    const regras = ordenadas.map((r, i) => ({ ref: `g${i + 1}`, id: r.id, tipo: r.tipo, texto: r.texto, reforcos: r.reforcos }));
    return { regras, bloco: blocoDasRegras(regras) };
  } catch (e) {
    registrarFalha(`aprendizado ${p.mesa}: regras não lidas`, e);
    return { regras: [], bloco: "" };
  }
}

/** O bloco do sistema do modelo (vazio sem regras). */
export function blocoDasRegras(regras: RegraDaMesa[]): string {
  if (!regras.length) return "";
  const evitar = regras.filter((r) => r.tipo === "evitar");
  const pref = regras.filter((r) => r.tipo === "preferencia");
  const linha = (r: RegraDaMesa) => `- ${r.ref}: ${r.texto}${r.reforcos > 1 ? ` (pedido ${r.reforcos} vezes)` : ""}`;
  return [
    "REGRAS QUE A EQUIPE ENSINOU (obedeça sempre; EVITAR vale acima de qualquer estilo, referência ou sugestão sua; se o pedido de agora contradiz uma regra, faça o pedido e diga qual regra ficou de lado):",
    evitar.length ? `EVITAR:\n${evitar.map(linha).join("\n")}` : "",
    pref.length ? `PREFERÊNCIAS:\n${pref.map(linha).join("\n")}` : "",
    "Quando uma regra mudar o que você propõe ou responde, ponha o apelido dela em `regras_seguidas`.",
  ].filter(Boolean).join("\n");
}

/** Campos para o esquema JSON do modelo (juntar em `properties`). */
export const CAMPOS_DO_APRENDIZADO = {
  regra_aprendida: {
    type: ["string", "null"],
    description: "Quando o pedido ensina algo que deve valer para os próximos trabalhos (\"não gostei de X\", \"nunca Y\", \"sempre Z\", correção), a regra em UMA frase curta e acionável no imperativo (ex.: \"Não usar fundo escuro nas fotos de produto\"). Null quando não ensina nada.",
  },
  regras_seguidas: {
    type: "array",
    items: { type: "string" },
    description: "Apelidos (g1, g2...) das regras ensinadas que mudaram esta resposta ou ação. Vazio quando nenhuma.",
  },
} as const;

/** Anexo "Segui: …" a partir dos apelidos que o modelo citou (apelido inventado sai). */
export function anexoDasRegrasSeguidas(apelidos: unknown, regras: RegraDaMesa[]): { tipo: typeof TIPO_DO_ANEXO_SEGUI; regras: Array<{ id: string; tipo: TipoDaRegra; texto: string }> } | null {
  const lista = Array.isArray(apelidos) ? apelidos.map((x) => String(x || "").trim()) : [];
  const usadas = regras.filter((r) => lista.indexOf(r.ref) >= 0).slice(0, 6);
  if (!usadas.length) return null;
  return { tipo: TIPO_DO_ANEXO_SEGUI, regras: usadas.map((r) => ({ id: r.id, tipo: r.tipo, texto: r.texto })) };
}

/**
 * Marca o "Aprendi" como esquecido dentro da mensagem guardada (reabrir a
 * conversa mostra "Esquecido"). Nunca lança; sem mensagem, não faz nada.
 */
export async function marcarEsquecidoNaMensagem(db: BancoDoCerebro, p: { clientId: string; mensagemId?: unknown; regraId: string }): Promise<void> {
  const id = String(p.mensagemId || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return;
  try {
    const { data } = await db.from("agente_mensagens").select("id, anexos").eq("id", id).eq("client_id", p.clientId).maybeSingle();
    const anexos = data && Array.isArray((data as { anexos?: unknown }).anexos) ? ((data as { anexos: Array<Record<string, unknown>> }).anexos) : null;
    if (!anexos) return;
    let mudou = false;
    const novos = anexos.map((a) => {
      if (a && a.tipo === TIPO_DO_ANEXO_APRENDI && a.id === p.regraId && !a.esquecido_em) {
        mudou = true;
        return { ...a, esquecido_em: new Date().toISOString() };
      }
      return a;
    });
    if (mudou) await db.from("agente_mensagens").update({ anexos: novos }).eq("id", id).eq("client_id", p.clientId);
  } catch (e) {
    registrarFalha("aprendizado: marca de esquecido não gravada na mensagem", e);
  }
}

/**
 * As duas rotas que toda mesa AG2 espalha em ACOES:
 * - aprendizado_esquecer { client_id, id, mensagem_id? } → { ok }
 * - aprendizado_guardar { client_id, texto, tipo, marca_id?, mensagem_id? } → { aprendido } ("Guardar como regra" do incerto)
 * `garantirAcesso` é o da função (lança 403/404 no padrão dela).
 */
export function rotasDoAprendizado(d: {
  mesa: MesaQueAprende;
  servico: () => BancoDoCerebro;
  garantirAcesso: (ch: { userId: string }, clientId: string) => Promise<unknown>;
  json: (corpo: unknown, status?: number) => Response;
}) {
  const uuid = (v: unknown) => (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || "")) ? String(v) : null);
  return {
    aprendizado_esquecer: async (ch: { userId: string }, corpo: Record<string, unknown>) => {
      const clientId = uuid(corpo.client_id);
      const id = uuid(corpo.id);
      if (!clientId || !id) return d.json({ erro: "client_id e id são obrigatórios." }, 400);
      await d.garantirAcesso(ch, clientId);
      const r = await esquecerRegra(d.servico(), { clientId, id });
      if (!r.ok) return d.json({ erro: r.erro || "Não foi possível esquecer." }, r.erro === "Regra não encontrada neste cliente." ? 404 : 500);
      await marcarEsquecidoNaMensagem(d.servico(), { clientId, mensagemId: corpo.mensagem_id, regraId: id });
      return d.json({ ok: true, custo_usd: 0 });
    },
    aprendizado_guardar: async (ch: { userId: string }, corpo: Record<string, unknown>) => {
      const clientId = uuid(corpo.client_id);
      if (!clientId) return d.json({ erro: "client_id é obrigatório." }, 400);
      await d.garantirAcesso(ch, clientId);
      const tipo: TipoDaRegra = corpo.tipo === "evitar" ? "evitar" : "preferencia";
      const a = await guardarRegra(d.servico(), { clientId, mesa: d.mesa, texto: String(corpo.texto || ""), tipo, marcaId: uuid(corpo.marca_id), userId: ch.userId, pedido: null });
      if (!a) return d.json({ erro: "A regra não foi guardada." }, 500);
      // A mensagem que tinha o "incerto" passa a mostrar a regra guardada.
      const mensagemId = uuid(corpo.mensagem_id);
      if (mensagemId) {
        try {
          const db = d.servico();
          const { data } = await db.from("agente_mensagens").select("id, anexos").eq("id", mensagemId).eq("client_id", clientId).maybeSingle();
          const anexos = data && Array.isArray((data as { anexos?: unknown }).anexos) ? ((data as { anexos: Array<Record<string, unknown>> }).anexos) : null;
          if (anexos) {
            const novos = anexos.map((x) => (x && x.tipo === TIPO_DO_ANEXO_APRENDI && !x.id ? { ...a } : x));
            await db.from("agente_mensagens").update({ anexos: novos }).eq("id", mensagemId).eq("client_id", clientId);
          }
        } catch (e) {
          registrarFalha("aprendizado: regra guardada fora da mensagem", e);
        }
      }
      return d.json({ aprendido: a, custo_usd: 0 });
    },
  };
}
