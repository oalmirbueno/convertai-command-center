/**
 * Decisão do dono num vínculo da Execução (26/10/2026).
 *
 * Antes, "Pode seguir" e "Aprovado: pode seguir" gravavam uma INSTRUÇÃO no
 * diário e devolviam o vínculo para a fila (`queued`). Cada toque virava uma
 * rodada nova: ~100 comentários e um pedido de revisão novo para o Revisor.
 * Aprovar gerava conversa, não trabalho.
 *
 * Agora a decisão é gravada UMA vez, como `decisao`, respondendo ao pedido a
 * que se refere (`metadata.reply_to_entry_id`, coluna `metadata` da migration
 * 20261026120000 da frente SERVIDOR), e libera a execução do único dono do
 * vínculo (o operador dele) devolvendo-o UMA vez para a fila (`queued`), que é
 * de onde os agentes pegam trabalho. O laço de comentários acabou na origem
 * (consumidor do Hermes e fim_da_rodada do MCP 2.19), então a volta à fila não
 * gera mais conversa. Se o vínculo já está com quem executa, só registra.
 *
 * Sem lookbehind e sem \p{} (Safari 11).
 */

export interface EntradaDoDiarioMinima {
  id: string;
  entry_type: string;
  author_kind: "humano" | "operador" | string;
  created_at: string;
  title?: string | null;
  body?: string | null;
  attachments?: unknown;
  /** metadata.reply_to_entry_id (migration 20261026120000 da frente SERVIDOR); ausente antes dela. */
  metadata?: { reply_to_entry_id?: string | null } | null;
  reply_to_entry_id?: string | null;
  /** Como o MCP devolve a leitura (responde_a / respondida_por). */
  responde_a?: string | null;
}

/** A entrada a que esta responde (metadata.reply_to_entry_id; aceita a forma solta também). */
export function respondeA(e: EntradaDoDiarioMinima): string | null {
  const m = e.metadata && typeof e.metadata === "object" ? e.metadata.reply_to_entry_id : null;
  return m || e.reply_to_entry_id || e.responde_a || null;
}

/** Tipos de entrada do agente que pedem algo do dono. */
export const PEDIDOS_DO_AGENTE = ["pedido_insumo", "pedido_revisao"] as const;

/** Situações em que o vínculo está parado esperando o dono: a decisão libera. */
const ESPERANDO_O_DONO = ["blocked", "awaiting_input", "review", "parado"];

/**
 * O que a decisão faz com a situação do vínculo.
 * - parado esperando o dono (travado, esperando resposta, em revisão): devolve à fila do dono (`queued`), uma vez;
 * - na fila ou já executando: só registra (nada de reenfileirar);
 * - concluído: só registra.
 */
export function planoDaDecisao(status: string | null | undefined): { liberar: boolean; novoStatus: "queued" | null } {
  const s = String(status || "");
  if (ESPERANDO_O_DONO.indexOf(s) >= 0) return { liberar: true, novoStatus: "queued" };
  return { liberar: false, novoStatus: null };
}

/**
 * A entrada a que a decisão responde: o pedido mais novo do agente
 * (pedido_insumo/pedido_revisao); sem pedido, a última fala do agente.
 * As entradas vêm da mais nova para a mais velha.
 */
export function pedidoQueADecisaoResponde<T extends EntradaDoDiarioMinima>(entradas: readonly T[]): T | null {
  for (const e of entradas) {
    if (e.author_kind === "operador" && (PEDIDOS_DO_AGENTE as readonly string[]).indexOf(e.entry_type) >= 0) return e;
  }
  for (const e of entradas) {
    if (e.author_kind === "operador" && !eRuidoDoDiario(e)) return e;
  }
  return null;
}

/** O pedido do agente que ainda espera o dono (nenhuma decisão ou resposta humana depois dele). */
export function pedidoEmAberto<T extends EntradaDoDiarioMinima>(entradas: readonly T[]): T | null {
  for (const e of entradas) {
    if (e.author_kind === "humano" && ["decisao", "aprovacao", "rejeicao", "resposta_insumo", "pedido_revisao"].indexOf(e.entry_type) >= 0) return null;
    if (e.author_kind === "operador" && (PEDIDOS_DO_AGENTE as readonly string[]).indexOf(e.entry_type) >= 0) return e;
  }
  return null;
}

/** Já existe uma decisão do dono respondendo a esta mesma entrada (toque repetido). */
export function decisaoJaRegistrada(entradas: readonly EntradaDoDiarioMinima[], alvo: string | null, titulo?: string): boolean {
  if (alvo && entradas.some((e) => e.author_kind === "humano" && e.entry_type === "decisao" && respondeA(e) === alvo)) return true;
  // Banco sem a coluna nova: a mesma decisão, depois do mesmo pedido (ou nos últimos 10 min sem pedido), é repetição.
  if (!titulo) return false;
  const pedido = alvo ? entradas.find((e) => e.id === alvo) : null;
  const desde = pedido ? Date.parse(pedido.created_at) : Date.now() - 10 * 60_000;
  return entradas.some((e) => e.author_kind === "humano" && e.entry_type === "decisao" && (e.title || "") === titulo && Date.parse(e.created_at) >= desde);
}

/**
 * Ruído do diário: batida de vida, "preservado", "sem alteração". Fica
 * escondido por padrão (o diário tem "Mostrar tudo").
 */
const RUIDO = /(heartbeat|batida de vida|sem altera[cç][aã]o|sem mudan[cç]a|nada mudou|preservad[oa]s?\b|mantid[oa] como est|estado preservado|sem novidade|no changes?|unchanged|keep-?alive|still (running|working))/i;
export function eRuidoDoDiario(e: Pick<EntradaDoDiarioMinima, "author_kind" | "title" | "body" | "attachments">): boolean {
  if (e.author_kind !== "operador") return false;
  const anexos = Array.isArray(e.attachments) ? e.attachments.length : 0;
  if (anexos > 0) return false;
  const texto = `${e.title || ""} ${e.body || ""}`;
  return RUIDO.test(texto) && texto.length < 900;
}

type Resposta<T = unknown> = { data: T | null; error: { message: string } | null };
/** O pedaço do cliente do Supabase que a decisão usa (o teste passa um falso). */
export interface ClienteDaDecisao {
  from: (tabela: string) => any;
  rpc: (nome: string, args: Record<string, unknown>) => PromiseLike<Resposta>;
}

export interface DecisaoDoDono {
  linkId: string;
  status: string | null | undefined;
  autorId: string;
  quem: string;
  titulo: string;
  corpo: string;
}

export interface ResultadoDaDecisao {
  /** A execução foi liberada (o vínculo saiu de travado/revisão para execução). */
  liberou: boolean;
  /** O toque repetiu uma decisão já registrada: nada foi gravado de novo. */
  repetida: boolean;
  /** A entrada a que a decisão respondeu. */
  respondeA: string | null;
  /** A coluna metadata ainda não existe neste banco: gravou sem o vínculo da resposta. */
  semRespostaNoBanco: boolean;
}

/**
 * Grava a decisão uma vez e libera o dono. Lança Error com a mensagem do banco
 * quando a liberação falha (o diário só é escrito depois que a situação mudou).
 */
export async function registrarDecisaoDoDono(cliente: ClienteDaDecisao, d: DecisaoDoDono): Promise<ResultadoDaDecisao> {
  const lidas = (await cliente
    .from("operator_participations")
    .select("*")
    .eq("task_link_id", d.linkId)
    .order("created_at", { ascending: false })
    .limit(30)) as Resposta<EntradaDoDiarioMinima[]>;
  const entradas = lidas.error ? [] : lidas.data || [];
  const pedido = pedidoQueADecisaoResponde(entradas);
  const alvo = pedido ? pedido.id : null;
  if (decisaoJaRegistrada(entradas, alvo, d.titulo)) return { liberou: false, repetida: true, respondeA: alvo, semRespostaNoBanco: false };

  const plano = planoDaDecisao(d.status);
  if (plano.liberar) {
    const { error } = await cliente.rpc("operator_human_action", {
      _link_id: d.linkId,
      _new_status: plano.novoStatus,
      _note: `${d.titulo} (${d.quem}). Execução liberada para o dono desta tarefa.`.slice(0, 900),
      _resolve_approval: true,
    });
    if (error) throw new Error(error.message || "Não foi possível liberar a execução.");
  }

  const linha: Record<string, unknown> = {
    task_link_id: d.linkId,
    author_kind: "humano",
    author_id: d.autorId,
    entry_type: "decisao",
    title: d.titulo,
    body: d.corpo,
    attachments: [],
    metadata: alvo ? { reply_to_entry_id: alvo, origem: "painel_decisao" } : { origem: "painel_decisao" },
  };
  let semRespostaNoBanco = false;
  let r = (await cliente.from("operator_participations").insert(linha)) as Resposta;
  if (r.error && /metadata/.test(r.error.message || "")) {
    // Banco ainda sem a coluna metadata (frente SERVIDOR): a decisão vale assim mesmo.
    semRespostaNoBanco = true;
    const semColuna = { ...linha };
    delete semColuna.metadata;
    r = (await cliente.from("operator_participations").insert(semColuna)) as Resposta;
  }
  if (r.error) throw new Error(`A execução ${plano.liberar ? "foi liberada" : "segue"}, mas a decisão não ficou no diário: ${r.error.message}`);
  return { liberou: plano.liberar, repetida: false, respondeA: alvo, semRespostaNoBanco };
}
