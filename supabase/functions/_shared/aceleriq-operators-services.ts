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

/**
 * O endereço exato do registro no painel.
 *
 * Um relatório que diz "concluído" e não diz ONDE obriga quem lê a
 * procurar. O link leva ao vínculo e carrega a run, para a tela abrir já
 * no registro certo em vez de numa lista.
 *
 * Origem configurável porque preview e produção não moram no mesmo
 * endereço, e link com domínio errado é pior que link nenhum: parece que
 * funciona até alguém clicar.
 */
export function deepLinkDoVinculo(linkId?: string | null, runId?: string | null) {
  if (!linkId) return null;
  const base = (Deno.env.get('PAINEL_ORIGIN') ?? 'https://aceleriq.online').replace(/\/+$/, '');
  return `${base}/execucao?vinculo=${linkId}${runId ? `&run=${runId}` : ''}`;
}

export const OPERATOR_EVENTS = [
  'started', 'progress', 'done', 'failed', 'blocked', 'review', 'awaiting_input', 'heartbeat',
] as const;

/** Teto de operadores. Não é burocracia: é o freio de um laço em fuga. */
const MAXIMO_DE_OPERADORES = 40;

const SLUG_VALIDO = /^[a-z][a-z0-9-]{1,38}$/;

/**
 * Cadastra um operador interno novo.
 *
 * O elenco NÃO está mais cravado no código: era limitação minha ter
 * escrito Vértice/Registro/Prisma/Augusto num enum, o que fazia cada
 * operador novo exigir deploy. Agora é dado — o Hermes registra quantos
 * precisar, e o painel mostra na hora.
 *
 * A linha que NÃO se cruza: criar operador é um ato EXPLÍCITO. Reportar
 * execução com um slug desconhecido continua sendo ERRO, nunca criação
 * silenciosa. Se qualquer slug criasse operador, "vertise" viraria um
 * quinto operador fantasma em vez de um erro — exatamente a armadilha do
 * uuid transposto que já custou horas aqui.
 */
export async function operatorRegister(input: {
  slug: string;
  display_name: string;
  role: string;
  scope: string;
  hermes_profile_ref?: string;
  is_coordinator?: boolean;
  permissions?: Record<string, unknown>;
}, actor: string) {
  const slug = String(input.slug || '').trim().toLowerCase();
  if (!SLUG_VALIDO.test(slug)) {
    throw new Error(
      'slug invalido: use minusculas, numeros e hifen, comecando por letra (ex.: "sonar", "atlas-qa").',
    );
  }

  const { count } = await comPrazo(
    db().from('internal_operators').select('id', { count: 'exact', head: true }),
  );
  if ((count ?? 0) >= MAXIMO_DE_OPERADORES) {
    throw new Error(
      `limite de ${MAXIMO_DE_OPERADORES} operadores atingido. Desative os que nao usa antes de criar outro.`,
    );
  }

  const { data: existente } = await comPrazo(
    db().from('internal_operators').select('id, slug, display_name, status').eq('slug', slug).maybeSingle(),
  );
  if (existente) {
    // Já existe: devolve o que há, em vez de duplicar ou estourar. Chamar
    // duas vezes é o caso comum de retry, não erro do chamador.
    return { criado: false, ja_existia: true, operador: existente };
  }

  const { data, error } = await comPrazo(
    db().from('internal_operators').insert({
      slug,
      display_name: String(input.display_name || slug).trim().slice(0, 80),
      role: String(input.role || 'Operacao').trim().slice(0, 80),
      scope: String(input.scope || 'Escopo a definir').trim().slice(0, 300),
      permissions: input.permissions ?? {},
      hermes_profile_ref: String(input.hermes_profile_ref || `hermes:${slug}`).trim().slice(0, 120),
      is_coordinator: input.is_coordinator === true,
      status: 'active',
    }).select('id, slug, display_name, role, scope, status, is_coordinator').single(),
  );
  if (error) throw new Error(`internal_operators: ${error.message}`);

  // O nascimento entra na trilha: "de onde veio este operador?" precisa
  // ter resposta, e a auditoria e imutavel.
  await comPrazo(db().from('operator_audit_log').insert({
    actor,
    operator_id: (data as Record<string, unknown>).id,
    action: `operador registrado: ${slug}`,
    new_status: 'active',
  }));

  return { criado: true, ja_existia: false, operador: data };
}

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
      // A HIERARQUIA vai junto: sem area e parent_slug, quem le o quadro
      // nao tem como conferir o organograma que acabou de configurar.
      .select('id, slug, display_name, role, status, scope, is_coordinator, last_run_at, area, parent_slug, display_order')
      .order('display_order', { ascending: true })),
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

  // Aprovacoes e propostas pendentes viajam NO quadro: o agente que nao
  // as ve escolhe trabalho novo enquanto ha decisao humana esperando — e
  // o dono do painel abre a tela sem saber que tem pergunta para ele.
  const [aprovacoes, propostas] = await Promise.all([
    comPrazo(db().from('operator_approvals')
      .select('id, operator_id, task_link_id, kanban_task_id, action_kind, o_que, por_que, '
        + 'impacto, risco, custo_previsto, prazo, reversivel, payload_version, status, '
        + 'valid_until, created_at')
      .in('status', ['pendente', 'adiado'])
      .order('created_at', { ascending: false })
      .limit(50)),
    comPrazo(db().from('assignment_proposals')
      .select('id, kanban_task_id, suggested_assignee, operator_id, justificativa, '
        + 'confianca, status, created_at')
      .eq('status', 'pendente')
      .order('created_at', { ascending: false })
      .limit(50)),
  ]);

  const operadores = (ops.data ?? []) as Array<Record<string, unknown>>;
  const porId = new Map(operadores.map((o) => [String(o.id), o]));

  let vinculos = (links.data ?? []) as Array<Record<string, unknown>>;
  if (opts.operator) {
    const alvo = operadores.find((o) => o.slug === opts.operator);
    vinculos = alvo ? vinculos.filter((l) => String(l.operator_id) === String(alvo.id)) : [];
  }
  if (opts.status) vinculos = vinculos.filter((l) => l.status === opts.status);

  // Contexto humano: tarefa, projeto, cliente e o responsável de gente.
  //
  // O id da tarefa pode ter chegado por kanban_task_id OU painel_task_id:
  // ignorar o segundo devolvia tarefa nula num vinculo que TEM tarefa.
  const taskIds = [...new Set(
    vinculos.flatMap((l) => [texto(l.kanban_task_id), texto(l.painel_task_id)]).filter(Boolean),
  )] as string[];
  const tarefas = new Map<string, Record<string, unknown>>();
  let falhaAoEnriquecer: string | null = null;
  if (taskIds.length > 0) {
    const { data: rows, error } = await comPrazo(db().from('tasks')
      // A FK vai NOMEADA: projects aponta para profiles duas vezes
      // (client_id e created_by). Sem escolher o caminho, o PostgREST
      // recusa a consulta inteira e o vinculo volta sem contexto.
      .select('id, title, status, due_date, assigned_to, project:projects!tasks_project_id_fkey(name, client_id, client:profiles!projects_client_id_fkey(full_name, company_name))')
      .in('id', taskIds));
    // Erro AQUI nao pode virar silencio: sem esta linha, uma consulta que
    // falha devolve tarefa, projeto e cliente nulos, e quem le conclui
    // "nao tem dado" quando a verdade e "nao consegui buscar". Foi
    // exatamente esse null que apareceu no aceite.
    if (error) falhaAoEnriquecer = error.message;
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
      .flatMap((l) => [texto(l.kanban_task_id), texto(l.painel_task_id)])
      .filter(Boolean) as string[],
  );
  const { data: abertas, error: erroAbertas } = await comPrazo(
    db().from('tasks')
      .select('id, title, status, due_date, assigned_to, project:projects!tasks_project_id_fkey(name, client:profiles!projects_client_id_fkey(full_name, company_name))')
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
    /*
     * O AVISO EXISTE PORQUE VAZIO E AMBIGUO.
     *
     * Uma lista vazia pode significar duas coisas opostas: nao ha o que
     * mostrar, ou nao consegui olhar. Quem le precisa saber qual das duas,
     * e a diferenca entre "sem trabalho pendente" e "consulta quebrada"
     * muda a decisao de quem esta do outro lado.
     */
    ...(falhaAoEnriquecer || erroAbertas
      ? {
        aviso: [
          falhaAoEnriquecer
            && 'Nao consegui ler as tarefas para preencher titulo, projeto, cliente e '
              + `responsavel humano dos vinculos: ${falhaAoEnriquecer}. Esses campos vem `
              + 'nulos por FALHA DE LEITURA, e nao por ausencia de dado.',
          erroAbertas
            && `Nao consegui listar as tarefas abertas do Kanban: ${erroAbertas.message}. `
              + 'A lista tarefas_disponiveis esta vazia por FALHA DE LEITURA, e nao '
              + 'porque nao existam tarefas.',
        ].filter(Boolean).join(' '),
      }
      : {}),
    // Falha de leitura vira aviso, nunca lista vazia calada — mesma regra
    // do enriquecimento de tarefas, pelos mesmos motivos.
    aprovacoes_pendentes: aprovacoes.error
      ? { falha: aprovacoes.error.message }
      : ((aprovacoes.data ?? []) as unknown as Array<Record<string, unknown>>).map((a) => ({
        approval_id: a.id,
        operador: porId.get(String(a.operator_id))?.slug ?? null,
        acao: a.action_kind,
        o_que: a.o_que,
        por_que: a.por_que,
        impacto: a.impacto,
        risco: a.risco,
        custo_previsto: a.custo_previsto,
        prazo: a.prazo,
        reversivel: a.reversivel,
        payload_version: a.payload_version,
        status: a.status,
        valida_ate: a.valid_until,
        link_id: a.task_link_id,
        deep_link: deepLinkDoVinculo(texto(a.task_link_id), null),
        regra: 'nao execute a acao ate esta aprovacao estar aprovado; o payload aprovado e o unico executavel',
      })),
    propostas_de_responsavel_pendentes: propostas.error
      ? { falha: propostas.error.message }
      : ((propostas.data ?? []) as unknown as Array<Record<string, unknown>>).map((p) => ({
        proposal_id: p.id,
        operador: porId.get(String(p.operator_id))?.slug ?? null,
        kanban_task_id: p.kanban_task_id,
        sugerido: p.suggested_assignee,
        justificativa: p.justificativa,
        confianca: p.confianca,
        status: p.status,
      })),
    operadores: operadores.map((o) => ({
      slug: o.slug, nome: o.display_name, funcao: o.role, situacao: o.status,
      escopo: o.scope, coordenador: o.is_coordinator === true, ultima_execucao: o.last_run_at,
      // A hierarquia, para conferir o organograma sem outra chamada.
      area: o.area ?? null,
      responde_a: o.parent_slug ?? null,
      ordem: o.display_order ?? null,
    })),
    vinculos: vinculos.map((l) => {
      const idDaTarefa = texto(l.kanban_task_id) ?? texto(l.painel_task_id);
      const t = idDaTarefa ? tarefas.get(idDaTarefa) : undefined;
      const projeto = (t?.project ?? null) as Record<string, unknown> | null;
      const cliente = (projeto?.client ?? null) as Record<string, unknown> | null;
      const op = porId.get(String(l.operator_id));
      const runDoVinculo = execucoes.find((r) => String(r.task_link_id) === String(l.id));
      return {
        id: l.id,
        operador: op?.slug ?? null,
        tarefa: t?.title ?? null,
        kanban_task_id: l.kanban_task_id,
        // Para onde clicar. Sem isto o relatorio diz "concluido" e obriga
        // quem le a procurar o registro na mao.
        deep_link: deepLinkDoVinculo(texto(l.id), texto(runDoVinculo?.id)),
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

/* ─────────────────────────── O cofre, só de olhar ────────────────────── */

/**
 * O que existe no cofre do cliente — SEM as senhas.
 *
 * O dono pediu "acesso ao cofre quando precisar, mas não editar nem
 * apagar, só ver". Entreguei o ver e parei antes da senha, e não por
 * excesso de zelo: uma senha que entra no contexto de um agente sai dele
 * pelo grupo, pelo relatório, pelo segundo cérebro e por qualquer log
 * pelo caminho. Nenhum desses lugares foi feito para guardar credencial,
 * e o estrago não tem como ser desfeito depois.
 *
 * O que o agente ganha é o que ele realmente precisa para trabalhar:
 * QUAIS sistemas o cliente usa, com que usuário e em que endereço. Se
 * for preciso de fato entrar em algum lugar, isso é gesto de gente, com
 * o cofre aberto na tela.
 *
 * Ler, e só. Não existe escrita nem exclusão por esta via.
 */
export async function vaultOverview(opts: { client_id: string }) {
  if (!isUuid(opts.client_id)) throw new Error('client_id must be a UUID');

  const { data, error } = await comPrazo(
    db().from('client_vault')
      // A coluna `password` NAO entra no select. Nao e filtro depois: e
      // ausencia na origem, para nao existir caminho em que ela escape.
      .select('id, title, category, url, username, notes, icon_url, item_order, updated_at')
      .eq('client_id', opts.client_id)
      .order('item_order', { ascending: true }),
  );
  if (error) throw new Error(`client_vault: ${error.message}`);

  const itens = (data ?? []) as Array<Record<string, unknown>>;
  return {
    client_id: opts.client_id,
    total: itens.length,
    itens: itens.map((i) => ({
      id: i.id,
      titulo: i.title,
      categoria: i.category,
      endereco: i.url,
      usuario: i.username,
      observacoes: i.notes,
      atualizado_em: i.updated_at,
      // A senha existe, e voce sabe disso — so nao passa por aqui.
      tem_senha_guardada: true,
    })),
    senhas: 'NAO retornadas por construcao. Se precisar entrar em algum sistema, peca ao responsavel humano: '
      + 'credencial que entra em contexto de agente sai por grupo, relatorio e log, e o estrago nao se desfaz.',
    escrita: 'Somente leitura. Editar e apagar item de cofre nao existe neste catalogo.',
  };
}

/**
 * O Hermes organiza o proprio time no organograma.
 *
 * Apresentacao e hierarquia: nome, funcao, area, chefe, ordem, escopo,
 * status. O  NAO muda — e a identidade que a trilha de auditoria
 * referencia, e renomea-lo reescreveria o passado. Nada de humano se
 * toca por aqui.
 */
export async function operatorOrganize(input: {
  slug: string;
  display_name?: string;
  role?: string;
  area?: string;
  parent_slug?: string;
  display_order?: number;
  scope?: string;
  status?: string;
  is_coordinator?: boolean;
}, actor: string) {
  const { data, error } = await comPrazo(db().rpc('operator_update', {
    _slug: String(input.slug || '').trim().toLowerCase(),
    _actor: actor,
    _display_name: texto(input.display_name),
    _role: texto(input.role),
    _area: texto(input.area),
    _parent_slug: input.parent_slug === undefined ? null : String(input.parent_slug),
    _display_order: input.display_order === undefined ? null : Math.trunc(Number(input.display_order)),
    _scope: texto(input.scope),
    _status: texto(input.status),
    _is_coordinator: input.is_coordinator === undefined ? null : input.is_coordinator === true,
  }));
  if (error) throw new Error(`operator_update: ${error.message}`);
  return data;
}

/* ──────────────────── Estudio: rascunho sim, publicar nao ─────────────── */

/** O documento do Estudio de um projeto, como esta agora. */
export async function studioRead(opts: { project_id: string }) {
  if (!isUuid(opts.project_id)) throw new Error('project_id must be a UUID');

  const { data, error } = await comPrazo(
    db().from('studio_docs')
      .select('project_id, doc_blocks, notes, published, updated_at')
      .eq('project_id', opts.project_id)
      .maybeSingle(),
  );
  if (error) throw new Error(`studio_docs: ${error.message}`);
  if (!data) {
    return { project_id: opts.project_id, existe: false, publicado: false, notas: null, blocos: 0 };
  }

  const d = data as Record<string, unknown>;
  const blocos = Array.isArray(d.doc_blocks) ? (d.doc_blocks as unknown[]).length : 0;
  return {
    project_id: opts.project_id,
    existe: true,
    publicado: d.published === true,
    notas: d.notes ?? null,
    blocos,
    doc_blocks: d.doc_blocks ?? [],
    atualizado_em: d.updated_at,
    aviso: d.published === true
      ? 'Este documento esta PUBLICADO: o cliente le em tempo real. Escrever nele e publicar, e isso continua sendo gesto humano.'
      : 'Rascunho: o cliente nao ve. Pode escrever.',
  };
}

/**
 * Escreve no RASCUNHO do Estudio.
 *
 * A regra que vale a pena entender antes de mexer: `published = true` faz
 * o painel do cliente ler `notes` EM TEMPO REAL (canal realtime em
 * TabDocument). Entao editar um documento publicado nao e "editar": e
 * publicar, ao vivo, na tela de quem paga. O dono ja escreveu que
 * publicacao fica fora da autonomia dos operadores, e esta funcao respeita
 * isso do jeito mais simples que existe: se o documento esta publicado,
 * recusa e explica.
 *
 * `published` nunca e escrito aqui, nem para true nem para false. Despublicar
 * tambem seria efeito externo — sumir com o documento da tela do cliente.
 */
export async function studioDraft(input: {
  project_id: string;
  notes?: string;
  doc_blocks?: unknown[];
}, actor: string) {
  if (!isUuid(input.project_id)) throw new Error('project_id must be a UUID');
  if (input.notes === undefined && input.doc_blocks === undefined) {
    throw new Error('nada a escrever: informe notes e/ou doc_blocks.');
  }

  const { data: atual, error: erroLeitura } = await comPrazo(
    db().from('studio_docs').select('project_id, published').eq('project_id', input.project_id).maybeSingle(),
  );
  if (erroLeitura) throw new Error(`studio_docs: ${erroLeitura.message}`);

  if (atual && (atual as Record<string, unknown>).published === true) {
    throw new Error(
      'documento_publicado: este documento esta no ar e o cliente le em tempo real. '
      + 'Alterar agora seria publicar. Deixe a nova versao como proposta para a equipe, '
      + 'ou peca a um responsavel humano para despublicar antes.',
    );
  }

  const campos: Record<string, unknown> = { project_id: input.project_id, updated_at: new Date().toISOString() };
  if (input.notes !== undefined) campos.notes = String(input.notes);
  if (input.doc_blocks !== undefined) campos.doc_blocks = input.doc_blocks;
  // `published` fica DE FORA do payload de proposito: o upsert nao pode
  // criar um documento ja publicado nem mexer no estado de publicacao.

  const { data, error } = await comPrazo(
    db().from('studio_docs').upsert(campos, { onConflict: 'project_id' })
      .select('project_id, notes, published, updated_at').single(),
  );
  if (error) throw new Error(`studio_docs: ${error.message}`);

  await comPrazo(db().from('operator_audit_log').insert({
    actor,
    action: `rascunho do estudio atualizado: projeto ${input.project_id}`,
  }));

  return {
    ok: true,
    ...(data as Record<string, unknown>),
    publicar: 'Publicar continua sendo gesto humano, pelo Estudio no painel.',
  };
}

/* ─────────────── O que a equipe fez, pronto para o cerebro ────────────── */

/**
 * Consolidado do trabalho dos operadores num periodo, ja organizado.
 *
 * Existe para o Hermes ter o que salvar no segundo cerebro sem precisar
 * remontar a historia a cada vez, e sem inventar o que nao aconteceu. Sai
 * agrupado por area e por agente, com o que virou entrega, o que travou e
 * o que esta esperando gente.
 *
 * Nao gera texto bonito: gera FATO organizado. A redacao e do Hermes, que
 * escreve melhor do que um template meu conseguiria — e um resumo montado
 * por regra fixa vira aquele relatorio que ninguem le.
 */
export async function operatorDigest(opts: { dias?: number }) {
  const dias = Math.min(Math.max(Math.floor(Number(opts.dias) || 7), 1), 90);
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString();

  const [{ data: ops }, { data: trilha }] = await Promise.all([
    comPrazo(db().from('internal_operators')
      .select('id, slug, display_name, area, status, is_coordinator')),
    comPrazo(db().from('operator_audit_log')
      .select('operator_id, actor, action, new_status, evidence, kanban_task_id, occurred_at, approval_required')
      .gte('occurred_at', desde)
      .order('occurred_at', { ascending: false })
      .limit(READ_LIMITS.maxPageSize)),
  ]);

  const operadores = (ops ?? []) as Array<Record<string, unknown>>;
  const eventos = (trilha ?? []) as Array<Record<string, unknown>>;
  const porId = new Map(operadores.map((o) => [o.id as string, o]));

  const porAgente = new Map<string, {
    agente: string; area: string; entregas: number; travados: number;
    esperando: number; aprovacoes: number; evidencias: string[];
    // As chaves de execucao ja contadas como entrega, por agente.
    chavesEntregues: Set<string>;
  }>();

  for (const e of eventos) {
    const op = porId.get(e.operator_id as string);
    if (!op) continue;
    const chave = op.slug as string;
    let linha = porAgente.get(chave);
    if (!linha) {
      linha = {
        agente: (op.display_name as string) ?? chave,
        area: (op.area as string) ?? 'Sem area definida',
        entregas: 0, travados: 0, esperando: 0, aprovacoes: 0, evidencias: [],
        chavesEntregues: new Set<string>(),
      };
      porAgente.set(chave, linha);
    }
    const st = e.new_status as string | null;
    if (st === 'done') {
      /*
       * UMA ENTREGA POR EXECUCAO, e nao por evento.
       *
       * A trilha e append-only de proposito: reportar `done` duas vezes
       * grava duas linhas, e isso esta certo — o segundo relato aconteceu
       * e some-lo seria apagar historico. O erro era CONTAR essas linhas
       * como duas entregas: o trabalho foi um so.
       *
       * A prova esta no banco: project_memory tem UMA linha para aquele
       * run_key, porque a gravacao da entrega ja e idempotente. Era o
       * relatorio que discordava do proprio registro.
       *
       * Sem run_key (evento antigo, antes da chave), cai no id do evento:
       * pior contar uma vez a mais do que perder a entrega.
       */
      const chaveDaExecucao = (e.run_key as string | null) ?? `evento:${String(e.occurred_at)}`;
      if (!linha.chavesEntregues.has(chaveDaExecucao)) {
        linha.chavesEntregues.add(chaveDaExecucao);
        linha.entregas += 1;
      }
      const ev = typeof e.evidence === 'string' ? e.evidence.trim() : '';
      // So evidencia de verdade entra, e sem repetir: a lista serve para
      // provar, nao para encher.
      if (ev && linha.evidencias.length < 12 && !linha.evidencias.includes(ev)) {
        linha.evidencias.push(ev);
      }
    } else if (st === 'blocked') linha.travados += 1;
    else if (st === 'awaiting_input') linha.esperando += 1;
    if (e.approval_required === true) linha.aprovacoes += 1;
  }

  const porArea = new Map<string, unknown[]>();
  for (const linha of porAgente.values()) {
    // O Set nao vai para a resposta: e ferramenta de contagem, e sairia
    // como objeto vazio no JSON, confundindo quem le.
    const { chavesEntregues, ...visivel } = linha;
    const atual = porArea.get(linha.area);
    if (atual) atual.push(visivel);
    else porArea.set(linha.area, [visivel]);
  }

  const entregas = [...porAgente.values()].reduce((s, l) => s + l.entregas, 0);
  return {
    periodo_dias: dias,
    desde,
    total_de_eventos: eventos.length,
    entregas_concluidas: entregas,
    como_contamos: 'entregas_concluidas conta EXECUCOES (run_key) que terminaram, e nao linhas '
      + 'da trilha. Reportar o mesmo done duas vezes grava dois eventos, porque a trilha e '
      + 'append-only, mas continua sendo UMA entrega.',
    // A trilha e cortada no teto de leitura. Dizer isso e o que separa um
    // consolidado de uma mentira educada.
    trilha_completa: eventos.length < READ_LIMITS.maxPageSize,
    por_area: [...porArea.entries()].map(([area, agentes]) => ({ area, agentes })),
    agentes_sem_movimento: operadores
      .filter((o) => o.status === 'active' && !porAgente.has(o.slug as string))
      .map((o) => ({ agente: o.display_name, area: o.area })),
  };
}

/* ─────────────────── O despachante: da tarefa ao agente ───────────────── */

/** Oferece uma tarefa do Kanban a um operador. Nao toca em assigned_to. */
export async function operatorAssign(input: {
  operator: string;
  kanban_task_id: string;
  note?: string;
}, actor: string) {
  if (!isUuid(input.kanban_task_id)) throw new Error('kanban_task_id must be a UUID');

  const { data, error } = await comPrazo(db().rpc('operator_assign_task', {
    _operator_slug: String(input.operator || '').trim().toLowerCase(),
    _kanban_task_id: input.kanban_task_id,
    _actor: actor,
    _note: texto(input.note),
  }));
  if (error) throw new Error(`operator_assign_task: ${error.message}`);
  return data;
}

/**
 * A fila de um operador: o que foi oferecido a ele e ainda nao terminou.
 *
 * Esta e a ponta que faltava para o ciclo girar sozinho. Antes, para o
 * agente reportar uma tarefa ele precisava ja saber o UUID dela, o que na
 * pratica significava um humano colando identificador no grupo. Agora ele
 * pergunta "o que e meu?" e recebe tudo o que precisa para comecar,
 * inclusive uma sugestao de `run_key` — porque chave inventada na hora e
 * como duas execucoes da mesma tarefa colidem sem ninguem entender por que.
 */
export async function operatorQueue(opts: { operator?: string; limit?: number }) {
  const limit = Math.min(Math.max(Number(opts.limit) || 25, 1), READ_LIMITS.maxPageSize);

  let q = db().from('operator_task_links')
    .select('id, operator_id, kanban_task_id, status, next_step, block_reason, approval_required, created_at, agent_run_id')
    .in('status', ['queued', 'in_progress', 'awaiting_input', 'review'])
    .order('created_at', { ascending: true })
    .limit(limit);

  let opFiltrado: Record<string, unknown> | null = null;
  if (opts.operator) {
    const { data: op } = await comPrazo(
      db().from('internal_operators')
        .select('id, slug, display_name, scope')
        .eq('slug', String(opts.operator).trim().toLowerCase())
        .maybeSingle(),
    );
    if (!op) {
      throw new Error(
        `operator_not_found: "${opts.operator}" nao existe. Use aceleriq_operator_board para ver os slugs validos.`,
      );
    }
    opFiltrado = op as Record<string, unknown>;
    q = q.eq('operator_id', opFiltrado.id as string);
  }

  const { data: links, error } = await comPrazo(q);
  if (error) throw new Error(`operator_task_links: ${error.message}`);

  const linhas = (links ?? []) as Array<Record<string, unknown>>;
  if (linhas.length === 0) {
    return {
      operador: opFiltrado?.slug ?? null,
      total: 0,
      itens: [],
      nada_na_fila: 'Nenhuma tarefa oferecida no momento. Fila vazia nao e erro: e fila vazia.',
    };
  }

  const idsDeTarefa = [...new Set(linhas.map((l) => l.kanban_task_id).filter(Boolean))] as string[];
  const idsDeOperador = [...new Set(linhas.map((l) => l.operator_id))] as string[];

  const [{ data: tarefas }, { data: ops }] = await Promise.all([
    idsDeTarefa.length
      ? comPrazo(db().from('tasks')
          .select('id, title, description, status, due_date, priority, project_id, assigned_to')
          .in('id', idsDeTarefa))
      : Promise.resolve({ data: [] as unknown[] }),
    comPrazo(db().from('internal_operators').select('id, slug, display_name').in('id', idsDeOperador)),
  ]);

  const porTarefa = new Map(
    ((tarefas ?? []) as Array<Record<string, unknown>>).map((t) => [t.id as string, t]),
  );
  const porOperador = new Map(
    ((ops ?? []) as Array<Record<string, unknown>>).map((o) => [o.id as string, o]),
  );

  // O projeto leva ao cliente: tasks nao tem client_id.
  const idsDeProjeto = [...new Set(
    [...porTarefa.values()].map((t) => t.project_id).filter(Boolean),
  )] as string[];
  const { data: projetos } = idsDeProjeto.length
    ? await comPrazo(db().from('projects').select('id, name, client_id').in('id', idsDeProjeto))
    : { data: [] as unknown[] };
  const porProjeto = new Map(
    ((projetos ?? []) as Array<Record<string, unknown>>).map((p) => [p.id as string, p]),
  );

  return {
    operador: opFiltrado?.slug ?? null,
    total: linhas.length,
    itens: linhas.map((l) => {
      const t = porTarefa.get(l.kanban_task_id as string);
      const p = t ? porProjeto.get(t.project_id as string) : null;
      const o = porOperador.get(l.operator_id as string);
      return {
        link_id: l.id,
        deep_link: deepLinkDoVinculo(String(l.id), null),
        operador: o?.slug ?? null,
        kanban_task_id: l.kanban_task_id,
        titulo: t?.title ?? '(tarefa nao encontrada)',
        descricao: t?.description ?? null,
        prazo: t?.due_date ?? null,
        prioridade: t?.priority ?? null,
        projeto: p?.name ?? null,
        client_id: p?.client_id ?? null,
        status: l.status,
        proximo_passo: l.next_step,
        motivo_do_bloqueio: l.block_reason,
        precisa_aprovacao: l.approval_required === true,
        // Reaproveitar a chave que ja existe e o que torna o relato
        // idempotente: repetir o mesmo evento nao duplica nada.
        run_key: l.agent_run_id ?? `link:${l.id}`,
        // O humano que responde pela tarefa continua sendo este. O agente
        // executa; a conta e dele.
        responsavel_humano: t?.assigned_to ?? null,
      };
    }),
    como_usar: 'Para cada item, chame aceleriq_operator_report com o run_key indicado: '
      + 'started ao pegar, progress durante, e done COM evidencia ao terminar. '
      + 'done sem evidencia e rebaixado para revisao, de proposito.',
  };
}

/**
 * O diario da execucao: onde o agente le as instrucoes do Almir e escreve
 * as proprias entradas.
 *
 * Sem body, LISTA — e listar e o que fecha o ciclo de participacao: uma
 * instrucao humana que o agente nunca le e um bilhete na gaveta. Com
 * body, ESCREVE via RPC, que valida operador vivo, audita e decide se
 * notifica (pedido_insumo e pedido_revisao notificam; comentario nao —
 * diario nao e spam).
 */
export async function operatorDiary(input: {
  link_id: string;
  operator?: string;
  entry_type?: string;
  title?: string;
  body?: string;
  attachments?: unknown[];
  limit?: number;
}) {
  if (!isUuid(input.link_id)) throw new Error('link_id must be a UUID');

  if (texto(input.body)) {
    if (!texto(input.operator)) {
      throw new Error('para escrever no diario informe operator (slug do operador que assina)');
    }
    const { data, error } = await comPrazo(db().rpc('operator_participar', {
      _operator_slug: String(input.operator).trim().toLowerCase(),
      _link_id: input.link_id,
      _entry_type: texto(input.entry_type) ?? 'comentario',
      _body: String(input.body),
      _title: texto(input.title),
      _attachments: Array.isArray(input.attachments) ? input.attachments : [],
    }));
    if (error) throw new Error(`operator_participar: ${error.message}`);
    return data;
  }

  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), READ_LIMITS.maxPageSize);
  const { data, error } = await comPrazo(db().from('operator_participations')
    .select('id, entry_type, title, body, attachments, author_kind, author_id, operator_id, created_at')
    .eq('task_link_id', input.link_id)
    .order('created_at', { ascending: true })
    .limit(limit));
  if (error) throw new Error(`operator_participations: ${error.message}`);

  const linhas = (data ?? []) as Array<Record<string, unknown>>;

  // Nome de autor resolvido aqui para o leitor nao receber UUID cru.
  const humanos = [...new Set(linhas.map((l) => texto(l.author_id)).filter(Boolean))] as string[];
  const agentes = [...new Set(linhas.map((l) => texto(l.operator_id)).filter(Boolean))] as string[];
  const [perfis, ops] = await Promise.all([
    humanos.length
      ? comPrazo(db().from('profiles').select('id, full_name').in('id', humanos))
      : Promise.resolve({ data: [], error: null }),
    agentes.length
      ? comPrazo(db().from('internal_operators').select('id, slug, display_name').in('id', agentes))
      : Promise.resolve({ data: [], error: null }),
  ]);
  const nomeHumano = new Map(((perfis.data ?? []) as Array<Record<string, unknown>>)
    .map((p) => [String(p.id), texto(p.full_name) ?? 'pessoa']));
  const nomeAgente = new Map(((ops.data ?? []) as Array<Record<string, unknown>>)
    .map((o) => [String(o.id), texto(o.display_name) ?? texto(o.slug) ?? 'operador']));

  return {
    link_id: input.link_id,
    total: linhas.length,
    entradas: linhas.map((l) => ({
      id: l.id,
      quando: l.created_at,
      tipo: l.entry_type,
      autor: l.author_kind === 'humano'
        ? (nomeHumano.get(String(l.author_id)) ?? 'pessoa')
        : (nomeAgente.get(String(l.operator_id)) ?? 'operador'),
      autor_kind: l.author_kind,
      titulo: l.title,
      texto: l.body,
      anexos: l.attachments,
    })),
    como_usar: 'Entradas do tipo instrucao, decisao e correcao vem do humano e MANDAM: '
      + 'leia antes de continuar a tarefa. Para responder, chame de novo com operator, '
      + 'entry_type e body. resposta_insumo fecha um pedido_insumo seu.',
  };
}

/**
 * O agente pede aprovacao COM a explicacao completa — ou nao pede.
 *
 * O RPC recusa pedido sem "o que" e "por que", congela o payload por
 * versao e notifica os admins com deep-link. A resposta repete a regra
 * de ouro para o proprio agente: nada executa ate um humano aprovar, e o
 * executado tem que ser exatamente o payload aprovado.
 */
export async function operatorRequestApproval(input: {
  operator: string;
  link_id: string;
  action_kind: string;
  o_que: string;
  por_que: string;
  payload?: Record<string, unknown>;
  dados_usados?: string;
  destino?: string;
  impacto?: string;
  risco?: string;
  custo_previsto?: number;
  prazo?: string;
  reversivel?: boolean;
  evidencia?: string;
  valid_until?: string;
}) {
  if (!isUuid(input.link_id)) throw new Error('link_id must be a UUID');
  const { data, error } = await comPrazo(db().rpc('operator_request_approval', {
    _operator_slug: String(input.operator || '').trim().toLowerCase(),
    _link_id: input.link_id,
    _action_kind: String(input.action_kind || '').trim(),
    _o_que: String(input.o_que || ''),
    _por_que: String(input.por_que || ''),
    _payload: input.payload ?? {},
    _dados_usados: texto(input.dados_usados),
    _destino: texto(input.destino),
    _impacto: texto(input.impacto),
    _risco: texto(input.risco),
    _custo_previsto: typeof input.custo_previsto === 'number' ? input.custo_previsto : null,
    _prazo: texto(input.prazo),
    _reversivel: input.reversivel !== false,
    _evidencia: texto(input.evidencia),
    _valid_until: texto(input.valid_until),
  }));
  if (error) throw new Error(`operator_request_approval: ${error.message}`);
  return data;
}

/**
 * O agente propoe um responsavel humano; assigned_to nao se move daqui.
 *
 * A escrita em tasks.assigned_to mora exclusivamente no RPC de decisao,
 * atras de um admin. Aqui aceita-se o id do perfil ou o nome exato —
 * nome ambiguo e recusado listando os candidatos, porque chutar pessoa
 * em proposta de responsabilidade e pior que falhar.
 */
export async function operatorProposeAssignee(input: {
  operator: string;
  kanban_task_id: string;
  suggested_profile_id?: string;
  suggested_name?: string;
  justificativa: string;
  evidencias?: unknown[];
  confianca?: number;
  prazo?: string;
  impacto?: string;
}) {
  if (!isUuid(input.kanban_task_id)) throw new Error('kanban_task_id must be a UUID');

  let alvo = texto(input.suggested_profile_id);
  if (alvo && !isUuid(alvo)) throw new Error('suggested_profile_id must be a UUID');
  if (!alvo) {
    const nome = texto(input.suggested_name);
    if (!nome) throw new Error('informe suggested_profile_id ou suggested_name');
    const { data, error } = await comPrazo(db().from('profiles')
      .select('id, full_name')
      .ilike('full_name', nome)
      .limit(5));
    if (error) throw new Error(`profiles: ${error.message}`);
    const achados = (data ?? []) as Array<Record<string, unknown>>;
    if (achados.length === 0) throw new Error(`nenhum perfil com o nome "${nome}"`);
    if (achados.length > 1) {
      throw new Error('nome ambiguo; use suggested_profile_id. Candidatos: '
        + achados.map((p) => `${p.full_name} (${p.id})`).join('; '));
    }
    alvo = String(achados[0].id);
  }

  const { data, error } = await comPrazo(db().rpc('operator_propor_responsavel', {
    _operator_slug: String(input.operator || '').trim().toLowerCase(),
    _kanban_task_id: input.kanban_task_id,
    _suggested_assignee: alvo,
    _justificativa: String(input.justificativa || ''),
    _evidencias: Array.isArray(input.evidencias) ? input.evidencias : [],
    _confianca: typeof input.confianca === 'number' ? input.confianca : null,
    _prazo: texto(input.prazo),
    _impacto: texto(input.impacto),
  }));
  if (error) throw new Error(`operator_propor_responsavel: ${error.message}`);
  return data;
}
