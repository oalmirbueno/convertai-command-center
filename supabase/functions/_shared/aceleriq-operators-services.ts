/**
 * Operadores internos (Hermes) — a ponte entre execução e painel.
 *
 * Vértice, Registro e Prisma executam; Augusto coordena. Este módulo dá a
 * eles exatamente DUAS capacidades:
 *
 *   reportar   um evento de execução (started/progress/done/failed/
 *              blocked/review/awaiting_input/heartbeat) que o RPC
 *              transacional do banco transforma em vínculo + run +
 *              auditoria imutável + notificação de exceção.
 *   ler        o próprio quadro (vínculos, runs, incidentes), para o
 *              coordenador consolidar sem inventar estado.
 *
 * O que NÃO existe aqui, de propósito e para sempre: atribuir tarefa a
 * humano (assigned_to é intocável por esta camada), publicar, agendar,
 * enviar mensagem, gastar, contratar ou alterar financeiro. Operador
 * interno RELATA trabalho; quem age no mundo continua sendo gente.
 *
 * Idempotência: (operator, run_key) — repetir o mesmo evento não duplica
 * nada. Duas execuções simultâneas da mesma tarefa colidem num índice
 * único parcial e a segunda recebe erro claro, não corrida.
 */

import { db, isUuid, READ_LIMITS } from './aceleriq-read-services.ts';

const texto = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
};

async function comPrazo<T>(p: PromiseLike<T>, ms = READ_LIMITS.queryTimeoutMs): Promise<T> {
  return await Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Query timeout after ${ms}ms`)), ms),
    ),
  ]);
}

export const OPERATOR_EVENTS = [
  'started', 'progress', 'done', 'failed', 'blocked', 'review', 'awaiting_input', 'heartbeat',
] as const;

export interface OperatorReportInput {
  operator: string;
  event: (typeof OPERATOR_EVENTS)[number];
  run_key: string;
  kanban_task_id?: string;
  painel_task_id?: string;
  action?: string;
  evidence?: string;
  next_step?: string;
  block_reason?: string;
  error?: string;
  approval_required?: boolean;
  from_cron?: boolean;
  attempt?: number;
  timeout_seconds?: number;
}

export async function operatorReport(input: OperatorReportInput, actor: string) {
  if (input.kanban_task_id && !isUuid(input.kanban_task_id)) {
    throw new Error('kanban_task_id must be a UUID');
  }
  if (input.painel_task_id && !isUuid(input.painel_task_id)) {
    throw new Error('painel_task_id must be a UUID');
  }

  const { data, error } = await comPrazo(db().rpc('operator_report_event', {
    _operator_slug: input.operator,
    _event: input.event,
    _run_key: input.run_key,
    _actor: actor,
    _kanban_task_id: input.kanban_task_id ?? null,
    _painel_task_id: input.painel_task_id ?? null,
    _action: texto(input.action),
    _evidence: texto(input.evidence),
    _next_step: texto(input.next_step),
    _block_reason: texto(input.block_reason),
    _error: texto(input.error),
    _approval_required: input.approval_required === true,
    _from_cron: input.from_cron === true,
    _attempt: Math.max(1, Math.floor(Number(input.attempt) || 1)),
    _timeout_seconds: Math.min(Math.max(Math.floor(Number(input.timeout_seconds) || 900), 30), 21600),
    _detail: {},
  }));
  if (error) {
    // A colisão da trava de execução simultânea sai como violação do
    // índice único: traduzida, ela ensina em vez de assustar.
    if (/operator_runs_uma_viva|operator_task_links_uma_ativa/.test(error.message)) {
      throw new Error(
        'Esta tarefa ja tem uma execucao EM ANDAMENTO. Espere o termino, o timeout do heartbeat, '
        + 'ou reporte failed/blocked na run atual antes de abrir outra.',
      );
    }
    throw new Error(`operator_report_event: ${error.message}`);
  }
  return data;
}

/**
 * O quadro dos operadores: vínculos com contexto humano, runs recentes e
 * incidentes. Antes de listar, expira runs sem heartbeat — a leitura é o
 * momento natural de detectar execução pendurada, sem cron novo.
 */
export async function operatorBoard(opts: { operator?: string; status?: string; limit?: number }) {
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), READ_LIMITS.maxPageSize);

  // Detecção de pendurados na leitura: barata e sempre atual.
  await comPrazo(db().rpc('operator_expire_stale_runs'));

  const [ops, links, runs] = await Promise.all([
    comPrazo(db().from('internal_operators')
      .select('id, slug, display_name, role, status, scope, is_coordinator, last_run_at')
      .order('is_coordinator', { ascending: true })),
    comPrazo(db().from('operator_task_links')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(limit)),
    comPrazo(db().from('operator_runs')
      .select('id, operator_id, run_key, task_link_id, status, attempt, started_at, heartbeat_at, finished_at, error')
      .order('started_at', { ascending: false })
      .limit(limit)),
  ]);
  if (ops.error) throw new Error(`internal_operators: ${ops.error.message}`);
  if (links.error) throw new Error(`operator_task_links: ${links.error.message}`);

  const operadores = (ops.data ?? []) as Array<Record<string, unknown>>;
  const porId = new Map(operadores.map((o) => [String(o.id), o]));

  let vinculos = (links.data ?? []) as Array<Record<string, unknown>>;
  if (opts.operator) {
    const alvo = operadores.find((o) => o.slug === opts.operator);
    vinculos = alvo ? vinculos.filter((l) => String(l.operator_id) === String(alvo.id)) : [];
  }
  if (opts.status) vinculos = vinculos.filter((l) => l.status === opts.status);

  // Contexto humano: tarefa, projeto, cliente e o responsável de gente.
  const taskIds = [...new Set(vinculos.map((l) => texto(l.kanban_task_id)).filter(Boolean))] as string[];
  const tarefas = new Map<string, Record<string, unknown>>();
  if (taskIds.length > 0) {
    const { data: rows } = await comPrazo(db().from('tasks')
      .select('id, title, status, due_date, assigned_to, project:projects(name, client_id, client:profiles(full_name, company_name))')
      .in('id', taskIds));
    for (const t of (rows ?? []) as Array<Record<string, unknown>>) tarefas.set(String(t.id), t);
  }
  const humanIds = [...new Set(
    [...tarefas.values()].map((t) => texto(t.assigned_to)).filter(Boolean),
  )] as string[];
  const humanos = new Map<string, string>();
  if (humanIds.length > 0) {
    const { data: perfis } = await comPrazo(
      db().from('profiles').select('id, full_name').in('id', humanIds),
    );
    for (const p of (perfis ?? []) as Array<Record<string, unknown>>) {
      humanos.set(String(p.id), texto(p.full_name) ?? '(sem nome)');
    }
  }

  const execucoes = (runs.data ?? []) as Array<Record<string, unknown>>;
  const incidentes = execucoes.filter((r) => ['failed', 'timeout', 'blocked'].includes(String(r.status)));

  /**
   * As tarefas do Kanban que ainda não têm operador, com o id pronto.
   *
   * Sem isto o agente lê o quadro, vê que está vazio e não tem como
   * escolher trabalho real — ou pior, inventa um id. Com isto ele
   * escolhe uma tarefa que existe, do cliente certo, com prazo à vista.
   */
  const jaVinculadas = new Set(
    ((links.data ?? []) as Array<Record<string, unknown>>)
      .map((l) => texto(l.kanban_task_id)).filter(Boolean) as string[],
  );
  const { data: abertas } = await comPrazo(
    db().from('tasks')
      .select('id, title, status, due_date, assigned_to, project:projects(name, client:profiles(full_name, company_name))')
      .in('status', ['backlog', 'todo', 'doing', 'review'])
      .is('deleted_at', null)
      .order('due_date', { ascending: true })
      .limit(100),
  );
  const disponiveis = ((abertas ?? []) as Array<Record<string, unknown>>)
    .filter((t) => !jaVinculadas.has(String(t.id)))
    .slice(0, 25)
    .map((t) => {
      const projeto = (t.project ?? null) as Record<string, unknown> | null;
      const cliente = (projeto?.client ?? null) as Record<string, unknown> | null;
      return {
        kanban_task_id: t.id,
        tarefa: t.title,
        projeto: projeto?.name ?? null,
        cliente: cliente ? (texto(cliente.company_name) ?? texto(cliente.full_name)) : null,
        prazo: t.due_date ?? null,
        coluna: t.status,
        tem_responsavel_humano: Boolean(t.assigned_to),
      };
    });

  return {
    /**
     * O manual, no próprio retorno. Um agente que lê o quadro precisa
     * saber o que pode fazer com ele sem depender de alguém ter colado
     * as regras num prompt que talvez não esteja mais na janela.
     */
    como_usar: {
      reportar: 'Use aceleriq_operator_report com { operator, event, run_key, kanban_task_id }. '
        + 'Eventos: started, progress, done, failed, blocked, review, awaiting_input, heartbeat.',
      run_key: 'Escolha uma chave estavel por execucao (ex.: "vertice-<tarefa>-2026-08-27"). '
        + 'Repetir a mesma chave ATUALIZA a mesma run, nao cria outra.',
      evidencia: 'done SEM evidence e rebaixado para review automaticamente. Evidencia e link ou '
        + 'descricao verificavel; nada de token ou URL assinada.',
      travas: 'Uma execucao em andamento por tarefa. Se colidir, termine ou reporte failed/blocked antes.',
      limites: 'Voce RELATA execucao. Atribuir tarefa a humano, publicar, agendar, enviar mensagem, '
        + 'gastar, contratar e alterar financeiro NAO estao neste catalogo, por construcao.',
      escolher_tarefa: 'Pegue um kanban_task_id de `tarefas_disponiveis`. Nunca invente id.',
    },
    resumo: {
      em_andamento: vinculos.filter((l) => l.status === 'in_progress').length,
      feitas_com_evidencia: vinculos.filter((l) => l.status === 'done' && texto(l.last_evidence)).length,
      em_revisao: vinculos.filter((l) => l.status === 'review').length,
      aguardando_insumo: vinculos.filter((l) => l.status === 'awaiting_input').length,
      bloqueadas: vinculos.filter((l) => l.status === 'blocked').length,
      aprovacoes_pendentes: vinculos.filter((l) => l.approval_required === true && l.status !== 'done').length,
      kanban_abertas: (abertas ?? []).length,
      sem_operador: disponiveis.length,
      incidentes: incidentes.length,
    },
    tarefas_disponiveis: disponiveis,
    operadores: operadores.map((o) => ({
      slug: o.slug, nome: o.display_name, funcao: o.role, situacao: o.status,
      escopo: o.scope, coordenador: o.is_coordinator === true, ultima_execucao: o.last_run_at,
    })),
    vinculos: vinculos.map((l) => {
      const t = l.kanban_task_id ? tarefas.get(String(l.kanban_task_id)) : undefined;
      const projeto = (t?.project ?? null) as Record<string, unknown> | null;
      const cliente = (projeto?.client ?? null) as Record<string, unknown> | null;
      const op = porId.get(String(l.operator_id));
      return {
        id: l.id,
        operador: op?.slug ?? null,
        tarefa: t?.title ?? null,
        kanban_task_id: l.kanban_task_id,
        projeto: projeto?.name ?? null,
        cliente: cliente ? (texto(cliente.company_name) ?? texto(cliente.full_name)) : null,
        // O responsável HUMANO, sempre visível e nunca alterado por aqui.
        responsavel_humano: t?.assigned_to ? humanos.get(String(t.assigned_to)) ?? null : null,
        status: l.status,
        prazo: t?.due_date ?? null,
        ultima_acao: l.last_action,
        evidencia: l.last_evidence,
        proximo_passo: l.next_step,
        bloqueio: l.block_reason,
        aprovacao_necessaria: l.approval_required === true,
        atualizado_em: l.updated_at,
      };
    }),
    runs_recentes: execucoes.slice(0, 20).map((r) => ({
      id: r.id, operador: porId.get(String(r.operator_id))?.slug ?? null,
      run_key: r.run_key, status: r.status, tentativa: r.attempt,
      inicio: r.started_at, heartbeat: r.heartbeat_at, fim: r.finished_at, erro: r.error,
    })),
    incidentes: incidentes.slice(0, 10).map((r) => ({
      operador: porId.get(String(r.operator_id))?.slug ?? null,
      run_key: r.run_key, status: r.status, erro: r.error, quando: r.finished_at ?? r.heartbeat_at,
    })),
    ultima_falha: incidentes[0]
      ? { operador: porId.get(String(incidentes[0].operator_id))?.slug ?? null, erro: incidentes[0].error, quando: incidentes[0].finished_at }
      : null,
  };
}
