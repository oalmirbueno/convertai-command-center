/**
 * Ações do Aceleriq do lançador (frente AG, 26/09). Pedido do dono: "eu peço,
 * ele já vai fazendo. Ele já conhece todo o painel". Contrato comum em
 * ../_shared/acoes-do-agente.ts: apelidos no lugar de UUID, cartão, execução
 * item a item, Desfazer e auditoria (index.ts).
 *
 * Alvos (sempre do cliente escolhido no topo do agente):
 * - c1: o cliente. registrar_nota (cérebro do cliente, área geral) e
 *   agendar_lembrete (tarefa com prazo para quem pediu, no projeto aberto
 *   mais recente; o aviso sai pelo lembrete de tarefas do painel).
 * - p1..pN: projetos abertos. criar_tarefa e agendar_lembrete.
 * - t1..tN: tarefas abertas. concluir_tarefa e mudar_prazo.
 *
 * Tudo aqui é sem custo e tem Desfazer (criar vai para a lixeira, mudar volta
 * o valor de antes, a nota sai do cérebro): pedido claro vai direto (regra 6
 * do contrato). Abrir uma área não é ação: é o campo ir_para (mapa do painel).
 *
 * Sem import de Deno: o vitest lê este arquivo. Sem travessão.
 */
import {
  type AcaoDoAgente,
  type Alvo,
  type AlvoComApelido,
  blocoDosAlvos,
  comApelido,
  normalizarAcaoDoAgente,
  type RegraDaOperacao,
  regraDasAcoes,
} from "../_shared/acoes-do-agente.ts";

export const AGENTE_DO_LANCADOR = "aceleriq";
/** agente_conversas aceita estes agentes sem migração: o lançador conversa como estrategista, na referência própria. */
export const AGENTE_DA_CONVERSA_DO_LANCADOR = "estrategista";
export const REF_CONVERSA_DO_LANCADOR = "lancador";

export const OPERACOES_DO_LANCADOR = ["criar_tarefa", "agendar_lembrete", "registrar_nota", "concluir_tarefa", "mudar_prazo"] as const;
export type OperacaoDoLancador = (typeof OPERACOES_DO_LANCADOR)[number];

export const DESCRICOES_DO_LANCADOR: Record<OperacaoDoLancador, string> = {
  criar_tarefa: "ref p# (projeto). para: \"título | AAAA-MM-DD | alta, media ou baixa\" (data e prioridade opcionais).",
  agendar_lembrete: "ref c1 (vai no projeto aberto mais recente) ou p#. para: \"AAAA-MM-DD | o que lembrar\". Lembra quem pediu na data.",
  registrar_nota: "ref c1. para: o fato sobre o cliente, numa frase (fica no cérebro do cliente e os agentes passam a saber).",
  concluir_tarefa: "ref t#. Marca a tarefa como feita. para vazio.",
  mudar_prazo: "ref t#. para: a data nova AAAA-MM-DD.",
};

export type ProjetoDoLancador = { id: string; name: string; status?: string | null; deadline?: string | null };
export type TarefaDoLancador = { id: string; title: string; status?: string | null; due_date?: string | null; project_id: string; projeto?: string | null };

export type DadosDoLancador = {
  cliente: { id: string; nome: string };
  projetos: ProjetoDoLancador[];
  tarefas: TarefaDoLancador[];
};

type AlvoDoLancador = Alvo & { dados: Record<string, unknown> };

const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const umaLinha = (v: unknown, max: number) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);

/** Data AAAA-MM-DD válida no calendário (31/02 não passa). */
export function dataValida(v: unknown): string | null {
  const s = umaLinha(v, 10);
  const m = DATA.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? s : null;
}

const PRIORIDADES: Record<string, string> = { alta: "high", high: "high", media: "medium", "média": "medium", medium: "medium", baixa: "low", low: "low" };

/** "título | 2026-10-02 | alta" -> partes. Título vazio: null. */
export function lerTarefaDoPara(bruto: unknown): { titulo: string; prazo: string | null; prioridade: string } | null {
  const partes = String(bruto == null ? "" : bruto).split("|").map((p) => p.trim());
  const titulo = umaLinha(partes[0], 200);
  if (titulo.length < 3) return null;
  let prazo: string | null = null;
  let prioridade = "medium";
  for (const p of partes.slice(1)) {
    const d = dataValida(p);
    if (d) prazo = d;
    else if (PRIORIDADES[p.toLowerCase()]) prioridade = PRIORIDADES[p.toLowerCase()];
  }
  return { titulo, prazo, prioridade };
}

/** "2026-10-02 | ligar para o cliente" -> data e texto. Sem data válida ou sem texto: null. */
export function lerLembreteDoPara(bruto: unknown): { data: string; texto: string } | null {
  const partes = String(bruto == null ? "" : bruto).split("|").map((p) => p.trim());
  const data = dataValida(partes[0]);
  const texto = umaLinha(partes.slice(1).join(" "), 180);
  return data && texto.length >= 3 ? { data, texto } : null;
}

/** Apelidos: c1 (cliente), p1..pN (projetos abertos), t1..tN (tarefas abertas). */
export function alvosDoLancador(d: DadosDoLancador) {
  const cliente = comApelido<AlvoDoLancador>([
    { id: d.cliente.id, titulo: d.cliente.nome || "Cliente", detalhe: d.projetos.length ? `${d.projetos.length} projeto(s) aberto(s)` : "sem projeto aberto", dados: { projeto_padrao: d.projetos[0] ? d.projetos[0].id : null } },
  ], "c");
  const projetos = comApelido<AlvoDoLancador>(d.projetos.slice(0, 12).map((p) => ({
    id: p.id,
    titulo: umaLinha(p.name, 120) || "Projeto",
    detalhe: [p.status || "", p.deadline ? `prazo ${p.deadline}` : ""].filter(Boolean).join(" · "),
    dados: {},
  })), "p");
  const tarefas = comApelido<AlvoDoLancador>(d.tarefas.slice(0, 30).map((t) => ({
    id: t.id,
    titulo: umaLinha(t.title, 140) || "Tarefa",
    detalhe: [t.status || "", t.due_date ? `prazo ${t.due_date}` : "sem prazo", t.projeto || ""].filter(Boolean).join(" · "),
    dados: { status: t.status || null, due_date: t.due_date || null, project_id: t.project_id },
  })), "t");
  return { cliente, projetos, tarefas, todos: ([] as Array<AlvoComApelido<AlvoDoLancador>>).concat(cliente, projetos, tarefas) };
}

export type AlvosDoLancador = ReturnType<typeof alvosDoLancador>;

/** Regras (todas diretas: sem custo e com Desfazer). `hoje` trava lembrete e prazo no passado. */
export function regrasDoLancador(hoje: string): Record<OperacaoDoLancador, RegraDaOperacao<AlvoDoLancador>> {
  return {
    criar_tarefa: {
      rotulo: "criar tarefa",
      alvos: ["p"],
      combina: true,
      direta: true,
      repete: true,
      para: (v) => {
        const t = lerTarefaDoPara(v);
        return t ? [t.titulo, t.prazo || "", t.prioridade].join(" | ") : null;
      },
      trava: (_a, para) => {
        const t = lerTarefaDoPara(para);
        return t && t.prazo && t.prazo < hoje ? "O prazo pedido já passou." : null;
      },
    },
    agendar_lembrete: {
      rotulo: "lembrar",
      alvos: ["c", "p"],
      combina: true,
      direta: true,
      repete: true,
      para: (v) => {
        const l = lerLembreteDoPara(v);
        return l ? `${l.data} | ${l.texto}` : null;
      },
      trava: (a, para) => {
        const l = lerLembreteDoPara(para);
        if (l && l.data < hoje) return "A data do lembrete já passou.";
        if (a.ref.charAt(0) === "c" && !(a.dados && a.dados.projeto_padrao)) return "O cliente não tem projeto aberto para guardar o lembrete. Crie um projeto antes.";
        return null;
      },
    },
    registrar_nota: {
      rotulo: "anotar no cliente",
      alvos: ["c"],
      combina: true,
      direta: true,
      repete: true,
      para: (v) => {
        const s = umaLinha(v, 400);
        return s.length >= 3 ? s : null;
      },
    },
    concluir_tarefa: {
      rotulo: "concluir",
      alvos: ["t"],
      direta: true,
      trava: (a) => (a.dados && a.dados.status === "done" ? "A tarefa já está concluída." : null),
    },
    mudar_prazo: {
      rotulo: "mudar o prazo para",
      alvos: ["t"],
      direta: true,
      para: (v) => dataValida(v),
      trava: (a, para) => (String(para) < hoje ? "A data nova já passou." : a.dados && a.dados.due_date === para ? "A tarefa já tem este prazo." : null),
    },
  };
}

/** Bloco do prompt: listas com apelidos e a regra das ações. */
export function blocoDasAcoesDoLancador(a: AlvosDoLancador): string {
  return [
    blocoDosAlvos("CLIENTE", a.cliente),
    blocoDosAlvos("PROJETOS ABERTOS DO CLIENTE", a.projetos, "nenhum."),
    blocoDosAlvos("TAREFAS ABERTAS DO CLIENTE", a.tarefas, "nenhuma."),
    regraDasAcoes(DESCRICOES_DO_LANCADOR),
  ].join("");
}

/** Proposta a partir do campo `acoes` do modelo. O que o executor precisa viaja no contexto. */
export function normalizarAcoesDoLancador(bruto: unknown, a: AlvosDoLancador, opcoes: { clientId: string; hoje: string; id?: string }): AcaoDoAgente | null {
  const regras = regrasDoLancador(opcoes.hoje);
  const padrao = a.cliente[0] && a.cliente[0].dados ? (a.cliente[0].dados.projeto_padrao as string | null) : null;
  const projetoDaTarefa: Record<string, string> = {};
  for (const t of a.tarefas) projetoDaTarefa[t.id] = String(t.dados.project_id || "");
  return normalizarAcaoDoAgente(bruto, a.todos, regras, {
    agente: AGENTE_DO_LANCADOR,
    id: opcoes.id,
    contexto: { client_id: opcoes.clientId, projeto_padrao: padrao, projeto_da_tarefa: projetoDaTarefa },
  });
}

// ------------------------------------------------------------------ execução (banco por parâmetro)

// deno-lint-ignore no-explicit-any
export type BancoDoLancador = { from: (tabela: string) => any };

export type DependenciasDoLancador = {
  userId: string;
  /** Grava a nota no cérebro do cliente (gravarNoCerebro); nunca lança. */
  gravarNota: (texto: string) => Promise<{ id: string | null; situacao: string | null; reforcos: number | null; substituidos: string[]; erro: string | null }>;
  agora?: () => string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function projetoDoCliente(db: BancoDoLancador, clientId: string, id: unknown): Promise<string> {
  const s = String(id || "");
  if (!UUID.test(s)) throw new Error("Projeto inválido.");
  const { data, error } = await db.from("projects").select("id, client_id, deleted_at").eq("id", s).maybeSingle();
  if (error) throw new Error("Não foi possível ler o projeto.");
  const p = data as { id: string; client_id: string; deleted_at: string | null } | null;
  if (!p || p.client_id !== clientId || p.deleted_at) throw new Error("Este projeto não está mais com o cliente.");
  return p.id;
}

async function tarefaDoCliente(db: BancoDoLancador, clientId: string, id: string) {
  const { data, error } = await db.from("tasks").select("id, project_id, status, due_date, deleted_at").eq("id", id).maybeSingle();
  if (error) throw new Error("Não foi possível ler a tarefa.");
  const t = data as { id: string; project_id: string; status: string; due_date: string | null; deleted_at: string | null } | null;
  if (!t || t.deleted_at) throw new Error("Esta tarefa não existe mais.");
  await projetoDoCliente(db, clientId, t.project_id);
  return t;
}

async function novaTarefa(db: BancoDoLancador, linha: Record<string, unknown>): Promise<string> {
  const { data, error } = await db.from("tasks").insert(linha).select("id").single();
  if (error || !data) throw new Error("Não foi possível criar a tarefa.");
  return (data as { id: string }).id;
}

/** Executa um item já confirmado (ou pedido claro, direto). Sempre devolve o Desfazer. */
export async function executarItemDoLancador(
  db: BancoDoLancador,
  clientId: string,
  item: { operacao: string; alvo_id: string; para: string | number | null; titulo: string },
  acao: Pick<AcaoDoAgente, "contexto">,
  deps: DependenciasDoLancador,
): Promise<{ desfazer: Record<string, unknown>; aviso?: string }> {
  const ctx = (acao.contexto || {}) as Record<string, unknown>;
  switch (item.operacao) {
    case "criar_tarefa": {
      const t = lerTarefaDoPara(item.para);
      if (!t) throw new Error("Tarefa sem título.");
      const projetoId = await projetoDoCliente(db, clientId, item.alvo_id);
      const id = await novaTarefa(db, { project_id: projetoId, title: t.titulo, status: "todo", priority: t.prioridade, due_date: t.prazo, source: "agente:aceleriq" });
      return { desfazer: { tarefa_id: id, projeto_id: projetoId } };
    }
    case "agendar_lembrete": {
      const l = lerLembreteDoPara(item.para);
      if (!l) throw new Error("Lembrete sem data ou sem texto.");
      const projetoId = await projetoDoCliente(db, clientId, UUID.test(item.alvo_id) && item.alvo_id !== clientId ? item.alvo_id : ctx.projeto_padrao);
      const id = await novaTarefa(db, { project_id: projetoId, title: `Lembrete: ${l.texto}`.slice(0, 200), status: "todo", priority: "medium", due_date: l.data, assigned_to: deps.userId, source: "agente:aceleriq" });
      return { desfazer: { tarefa_id: id, projeto_id: projetoId } };
    }
    case "registrar_nota": {
      const texto = umaLinha(item.para, 400);
      if (texto.length < 3) throw new Error("Nota vazia.");
      const r = await deps.gravarNota(texto);
      if (r.erro || !r.id) throw new Error("Não foi possível guardar a nota no cérebro do cliente.");
      if (r.situacao === "reforcado") return { desfazer: { memoria_id: r.id, reforcos: Math.max(1, (r.reforcos || 2) - 1) }, aviso: "já existia: contado como reforço" };
      return { desfazer: { memoria_id: r.id, substituidos: r.substituidos || [] } };
    }
    case "concluir_tarefa": {
      const t = await tarefaDoCliente(db, clientId, item.alvo_id);
      if (t.status === "done") throw new Error("A tarefa já está concluída.");
      // O valor de antes é lido antes de gravar (é o que o Desfazer devolve).
      const antes = { status: t.status };
      const { error } = await db.from("tasks").update({ status: "done" }).eq("id", t.id);
      if (error) throw new Error("Não foi possível concluir a tarefa.");
      return { desfazer: { tarefa_id: t.id, projeto_id: t.project_id, antes } };
    }
    case "mudar_prazo": {
      const data = dataValida(item.para);
      if (!data) throw new Error("Data inválida.");
      const t = await tarefaDoCliente(db, clientId, item.alvo_id);
      const antes = { due_date: t.due_date };
      const { error } = await db.from("tasks").update({ due_date: data }).eq("id", t.id);
      if (error) throw new Error("Não foi possível mudar o prazo.");
      return { desfazer: { tarefa_id: t.id, projeto_id: t.project_id, antes } };
    }
    default:
      throw new Error("Operação desconhecida.");
  }
}

/** Desfaz um item (criada vai para a lixeira; mudada volta; nota sai do cérebro). */
export async function reverterItemDoLancador(
  db: BancoDoLancador,
  clientId: string,
  r: { operacao: string; desfazer?: Record<string, unknown> | null },
  deps: Pick<DependenciasDoLancador, "agora">,
): Promise<void> {
  const d = (r.desfazer || {}) as Record<string, unknown>;
  const agora = deps.agora ? deps.agora() : new Date().toISOString();
  if (r.operacao === "registrar_nota") {
    const id = String(d.memoria_id || "");
    if (typeof d.reforcos === "number") {
      const { error } = await db.from("agente_memoria").update({ reforcos: d.reforcos }).eq("id", id).eq("client_id", clientId);
      if (error) throw new Error("Não foi possível voltar a nota.");
      return;
    }
    const { error } = await db.from("agente_memoria").update({ ativa: false }).eq("id", id).eq("client_id", clientId);
    if (error) throw new Error("Não foi possível tirar a nota do cérebro.");
    const antigas = Array.isArray(d.substituidos) ? (d.substituidos as unknown[]).map(String).filter((x) => UUID.test(x)) : [];
    if (antigas.length) await Promise.resolve(db.from("agente_memoria").update({ ativa: true, substituida_por: null }).in("id", antigas).eq("client_id", clientId)).then(() => undefined, () => undefined);
    return;
  }
  const tarefaId = String(d.tarefa_id || "");
  const projetoId = String(d.projeto_id || "");
  await projetoDoCliente(db, clientId, projetoId);
  const patch = r.operacao === "criar_tarefa" || r.operacao === "agendar_lembrete" ? { deleted_at: agora } : ((d.antes || {}) as Record<string, unknown>);
  if (!Object.keys(patch).length) throw new Error("Sem o que desfazer.");
  const { error } = await db.from("tasks").update(patch).eq("id", tarefaId).eq("project_id", projetoId);
  if (error) throw new Error("Não foi possível voltar a tarefa.");
}

/** Pedido claro sem o Jev: a regra comum do contrato (verbo de ordem no começo). */
export { pareceOrdem } from "../_shared/acoes-do-agente.ts";
