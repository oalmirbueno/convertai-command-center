/**
 * Promessa da semana passada sem prova vira reforço urgente para a equipe
 * (frente CE, 28/09/2026).
 *
 * O dono: "quando uma tarefa falada na semana passada ainda não foi feita nem
 * confirmada por mim, não manda de novo para o cliente; para o cliente fala
 * que está em andamento; para mim gera ou reforça a tarefa como urgente, com
 * aviso".
 *
 * - A promessa é o que a última mensagem ENVIADA combinou (blocos "O que vem
 *   agora" e "Precisamos de você", e o próximo passo).
 * - "Confirmada pelo dono" = a tarefa de reforço dela foi concluída. A partir
 *   daí a promessa conta como cumprida.
 * - Idempotente: a tarefa carrega a chave da promessa em `source`
 *   (central:promessa:<relatório>:<hash>). Gerar a mensagem de novo não cria
 *   outra tarefa nem outro aviso; só escala para urgente uma vez.
 * - Só promessa de mensagem enviada ANTES desta semana (segunda, no fuso de
 *   Brasília) vira reforço: o combinado de ontem ainda está no prazo.
 * - Grava com o JWT de quem gerou (RLS de tasks); o aviso sai pela função do
 *   banco avisar_equipe_do_cliente (só backend), um aviso por geração.
 */

// deno-lint-ignore no-explicit-any
type Banco = { from: (t: string) => any; rpc?: (fn: string, a: Record<string, unknown>) => any };

export const PREFIXO_DO_REFORCO = "central:promessa:";

/** Hash curto e estável do texto (djb2 em base 36). */
export function hashCurto(texto: string): string {
  let h = 5381;
  const t = String(texto ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  for (let i = 0; i < t.length; i += 1) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function chaveDaPromessa(reportId: string | null | undefined, texto: string): string {
  return `${PREFIXO_DO_REFORCO}${String(reportId || "sem-relatorio").slice(0, 8)}:${hashCurto(texto)}`;
}

/** Promessa que depende do cliente (aprovar, mandar, liberar), não da agência. */
export function dependeDoCliente(texto: string): boolean {
  return /^(aprovando|aprovar|mandando|mandar|enviando|enviar|liberando|liberar|confirmando|confirmar|respondendo|assim que voc|com a sua|com o seu|precisamos|voc[eê] )/i.test(String(texto ?? "").trim());
}

/** Segunda-feira desta semana (yyyy-mm-dd) no fuso de Brasília. */
export function segundaDaSemana(agora: Date): string {
  const hoje = agora.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const d = new Date(`${hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export interface PromessaEmAndamento {
  id: string;
  texto: string;
  feitaEm: string;
}

export interface TarefaDaCentral {
  id: string;
  source: string;
  status: string;
  priority: string;
}

export interface ResultadoDoReforco {
  criadas: string[];
  reforcadas: string[];
  avisados: number;
  erros: string[];
}

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export async function reforcarPromessas(
  db: Banco,
  servico: Banco | null,
  e: {
    clientId: string;
    clienteNome: string;
    projetoId: string | null;
    usuarioId: string;
    promessas: PromessaEmAndamento[];
    existentes: TarefaDaCentral[];
    agora?: Date;
  },
): Promise<ResultadoDoReforco> {
  const agora = e.agora ?? new Date();
  const segunda = segundaDaSemana(agora);
  const hoje = agora.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const saida: ResultadoDoReforco = { criadas: [], reforcadas: [], avisados: 0, erros: [] };
  const daSemanaPassada = e.promessas.filter((p) => p.feitaEm && p.feitaEm.slice(0, 10) < segunda).slice(0, 6);
  if (!daSemanaPassada.length) return saida;

  for (const p of daSemanaPassada) {
    const existente = e.existentes.find((t) => t.source === p.id);
    if (existente) {
      if (existente.status === "done" || existente.priority === "urgent") continue;
      const { error } = await db.from("tasks").update({ priority: "urgent", due_date: hoje }).eq("id", existente.id);
      if (error) saida.erros.push(`reforço: ${error.message ?? "erro"}`);
      else saida.reforcadas.push(p.texto);
      continue;
    }
    if (!e.projetoId) { saida.erros.push("sem projeto ativo para criar a tarefa de reforço"); break; }
    const doCliente = dependeDoCliente(p.texto);
    const { error } = await db.from("tasks").insert({
      project_id: e.projetoId,
      title: `${doCliente ? "Confirmar com o cliente" : "Reforço"}: ${p.texto}`.slice(0, 200),
      description: `Combinado na mensagem de ${dm(p.feitaEm)} e ainda sem prova no painel. ${doCliente ? "Depende do cliente: confirme com ele." : "Faça ou, se já foi feito, conclua esta tarefa para confirmar."} A mensagem desta semana diz ao cliente que está em andamento.`,
      status: "todo",
      priority: "urgent",
      due_date: hoje,
      source: p.id,
      assigned_to: e.usuarioId,
      workstream: "general",
    });
    if (error) saida.erros.push(`tarefa: ${error.message ?? "erro"}`);
    else saida.criadas.push(p.texto);
  }

  const novidades = [...saida.criadas, ...saida.reforcadas];
  if (novidades.length && servico?.rpc) {
    const mensagem = `${e.clienteNome}: ${novidades.length} combinado(s) da última mensagem sem prova no painel viraram tarefa urgente: ${novidades.map((t) => t.slice(0, 80)).join("; ")}`;
    try {
      const { data, error } = await servico.rpc("avisar_equipe_do_cliente", { _client_id: e.clientId, _message: mensagem.slice(0, 500), _type: "update", _link: "/ciclo" });
      if (error) saida.erros.push(`aviso: ${error.message ?? "erro"}`);
      else saida.avisados = Number(data) || 0;
    } catch (x) {
      saida.erros.push(`aviso: ${x instanceof Error ? x.message : "falha"}`);
    }
  }
  return saida;
}
