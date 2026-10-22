/**
 * MCP 2.17 (22/10/2026): leituras do painel inteiro, enxutas por padrão.
 *
 * Cada função lê só as colunas que precisa (índice por client_id + data), pede uma linha a mais
 * para saber se há próxima página (sem COUNT caro) e devolve o essencial; `detalhe: "completo"`
 * traz o resto. Nada daqui escreve. Segredo e dado pessoal de terceiro nunca saem: chave e
 * segredo de gateway, e-mail e telefone de comprador, contato e negócio do CRM de cada membro
 * (do CRM licença só vão contagens).
 *
 * Panoramas (cliente e casa): várias leituras em paralelo, cada uma com prazo próprio. A que
 * falhar entra em `faltou` com o motivo, e o resto chega igual: uma tabela lenta não derruba a
 * resposta inteira.
 */

import { db, isUuid } from '../../_shared/aceleriq-read-services.ts';
import { assertClientAccess, type AuthContext } from '../../_shared/mcp-auth.ts';
import { exigirClienteExistente } from '../../_shared/mcp-client-id-guard.ts';
import { comNovaTentativa, comPrazo, ErroDaFerramenta, explicarErro } from './robustez.ts';
import { cortar, detalheDe, escolher, lerCursor, lerLinhas, pagina, tamanhoDaPagina, type Detalhe } from './leitura-enxuta.ts';

type Objeto = Record<string, unknown>;
// deno-lint-ignore no-explicit-any
type Banco = { from: (t: string) => any };

/** O banco usado pelas leituras (troca só em teste). */
let bancoAtual: () => Banco = () => db() as unknown as Banco;
export function usarBancoDeTeste(fn: (() => Banco) | null) {
  bancoAtual = fn ?? (() => db() as unknown as Banco);
}
const banco = () => bancoAtual();

/** Pula a conferência de existência do cliente (só nos testes, com banco falso). */
let conferirExistencia = true;
export function semConferirClienteNoTeste(v: boolean) {
  conferirExistencia = !v;
}

const obj = (v: unknown): Objeto => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Objeto) : {});
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function hojeSP(agora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

function somarDias(data: string, dias: number): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export async function conferirClienteDoPainel(clientId: unknown, ctx: AuthContext): Promise<string> {
  if (!isUuid(clientId)) throw new ErroDaFerramenta('entrada_invalida', 'client_id precisa ser um UUID.', 'Pegue o id com aceleriq_list_clients.');
  assertClientAccess(ctx, clientId);
  if (conferirExistencia) await exigirClienteExistente(db(), clientId);
  return clientId;
}

function exigirCasaInteira(ctx: AuthContext) {
  if (!ctx.dataScope?.unrestricted) {
    throw new ErroDaFerramenta('fora_do_escopo', 'Esta leitura é da casa inteira e só abre para credencial sem restrição de cliente.', 'Use as leituras por cliente (aceleriq_panorama_do_cliente).');
  }
}

/** Conta por um campo (situação, etapa) sem mandar a lista inteira. */
export function contarPor(linhas: Objeto[], campo: string): Record<string, number> {
  const saida: Record<string, number> = {};
  for (const l of linhas) {
    const k = String(l[campo] ?? 'sem_valor');
    saida[k] = (saida[k] ?? 0) + 1;
  }
  return saida;
}

// ─── Panorama em partes com prazo próprio ───────────────────────

export interface Falta { secao: string; codigo: string; motivo: string }

/** Roda cada parte em paralelo, com prazo e nova tentativa leve; quem falha vira `faltou`. */
export async function emPartes(partes: Record<string, () => Promise<unknown>>, prazoMs = 6_000): Promise<{ secoes: Objeto; faltou: Falta[] }> {
  const nomes = Object.keys(partes);
  const ate = Date.now() + prazoMs;
  const feitos = await Promise.allSettled(nomes.map((n) => comPrazo(() => comNovaTentativa(() => partes[n](), { ate }), prazoMs, `A parte ${n}`)));
  const secoes: Objeto = {};
  const faltou: Falta[] = [];
  feitos.forEach((f, i) => {
    if (f.status === 'fulfilled') secoes[nomes[i]] = f.value;
    else {
      const e = explicarErro(f.reason, nomes[i]);
      faltou.push({ secao: nomes[i], codigo: e.codigo, motivo: cortar(e.mensagem, 200) ?? '' });
      secoes[nomes[i]] = null;
    }
  });
  return { secoes, faltou };
}

async function contagem(q: Promise<{ count: number | null; error: { message?: string; code?: string } | null }>, rotulo: string): Promise<number> {
  const r = await q;
  if (r.error) throw Object.assign(new Error(`${rotulo}: ${r.error.message ?? 'falha'}`), { code: r.error.code });
  return r.count ?? 0;
}

const TAREFA_ABERTA = '("done","archived","cancelled")';

// ─── Panorama do cliente ────────────────────────────────────────

export async function panoramaDoCliente(input: { client_id: string; detalhe?: string }, ctx: AuthContext) {
  const inicio = Date.now();
  const clientId = await conferirClienteDoPainel(input.client_id, ctx);
  const detalhe = detalheDe(input.detalhe);
  const completo = detalhe === 'completo';
  const hoje = hojeSP();
  const b = banco();

  const projetosAtivos = async () => {
    const { linhas } = await lerLinhas(b, 'projects', ['id', 'name', 'status', 'progress', 'deadline', 'updated_at'], (q) =>
      q.eq('client_id', clientId).is('deleted_at', null).order('updated_at', { ascending: false }).limit(completo ? 30 : 8));
    return linhas;
  };
  const projetos = projetosAtivos();

  const { secoes, faltou } = await emPartes({
    perfil: async () => {
      const { linhas } = await lerLinhas(b, 'profiles', ['id', 'full_name', 'company_name', 'plan_name', 'plan_status', 'plan_renewal_date', 'client_type', 'brand', 'onboarding_done'], (q) => q.eq('id', clientId).limit(1));
      return linhas[0] ?? null;
    },
    projetos: async () => {
      const ps = await projetos;
      return { total: ps.length, por_situacao: contarPor(ps, 'status'), itens: ps.slice(0, completo ? 30 : 5) };
    },
    tarefas: async () => {
      const ids = (await projetos).map((p) => String(p.id));
      if (!ids.length) return { abertas: 0, atrasadas: 0, proximas: [] };
      const base = () => b.from('tasks').select('id', { count: 'exact', head: true }).in('project_id', ids).is('deleted_at', null).not('status', 'in', TAREFA_ABERTA);
      const [abertas, atrasadas, proximas] = await Promise.all([
        contagem(base(), 'tasks'),
        contagem(base().lt('due_date', hoje), 'tasks'),
        lerLinhas(b, 'tasks', ['id', 'title', 'status', 'priority', 'due_date', 'delivery_type'], (q) =>
          q.in('project_id', ids).is('deleted_at', null).not('status', 'in', TAREFA_ABERTA).gte('due_date', hoje).order('due_date', { ascending: true }).limit(completo ? 15 : 5)),
      ]);
      return { abertas, atrasadas, proximas: proximas.linhas };
    },
    campanhas: async () => {
      const { linhas } = await lerLinhas(b, 'mesa_campanhas', ['id', 'nome', 'status', 'periodo_inicio', 'periodo_fim', 'custo_usd'], (q) =>
        q.eq('client_id', clientId).gte('periodo_fim', somarDias(hoje, -7)).order('periodo_inicio', { ascending: true }).limit(completo ? 20 : 5));
      return linhas;
    },
    estudio: async () => {
      const { linhas } = await lerLinhas(b, 'estudio_trabalhos', ['id', 'tipo', 'status', 'entrega_status', 'atualizado_em'], (q) =>
        q.eq('client_id', clientId).order('atualizado_em', { ascending: false }).limit(60));
      return { recentes: linhas.length, por_entrega: contarPor(linhas, 'entrega_status'), ultimos: completo ? linhas.slice(0, 10) : linhas.slice(0, 3) };
    },
    stories: async () => {
      const { linhas } = await lerLinhas(b, 'cliente_stories_sequencias', ['id', 'data', 'objetivo', 'titulo'], (q) =>
        q.eq('client_id', clientId).is('arquivado_em', null).gte('data', hoje).order('data', { ascending: true }).limit(completo ? 10 : 3));
      return linhas;
    },
    dia_prioritario: async () => {
      const { linhas } = await lerLinhas(b, 'cliente_dia_prioritario', ['dia', 'situacao', 'observacao', 'dias_indisponiveis'], (q) => q.eq('client_id', clientId).limit(1));
      return linhas[0] ?? null;
    },
    dossie: async () => {
      const { linhas } = await lerLinhas(b, 'client_dossiers', ['id', 'dossier_type', 'version', 'summary', 'updated_at'], (q) =>
        q.eq('client_id', clientId).eq('is_current', true).order('updated_at', { ascending: false }).limit(3));
      return linhas.map((d) => ({ ...d, summary: completo ? d.summary : cortar(d.summary, 400) }));
    },
    pedidos: async () => {
      const { linhas } = await lerLinhas(b, 'client_requests', ['id', 'title', 'status', 'priority', 'created_at'], (q) =>
        q.eq('client_id', clientId).order('created_at', { ascending: false }).limit(30));
      return { por_situacao: contarPor(linhas, 'status'), recentes: linhas.slice(0, completo ? 10 : 3) };
    },
    anuncios: async () => {
      const { linhas } = await lerLinhas(b, 'ads_campaigns', ['id', 'name', 'status', 'effective_status', 'objective', 'daily_budget', 'updated_at'], (q) =>
        q.eq('client_id', clientId).order('updated_at', { ascending: false }).limit(40));
      const ativas = linhas.filter((l) => String(l.effective_status ?? l.status ?? '').toUpperCase() === 'ACTIVE');
      return { campanhas: linhas.length, ativas: ativas.length, ativas_itens: ativas.slice(0, completo ? 20 : 5) };
    },
    aprovacoes_da_execucao: async () => {
      const { linhas } = await lerLinhas(b, 'operator_approvals', ['id', 'status', 'o_que', 'created_at'], (q) =>
        q.eq('client_id', clientId).gte('created_at', `${somarDias(hoje, -30)}T00:00:00Z`).order('created_at', { ascending: false }).limit(60));
      return { por_situacao: contarPor(linhas, 'status'), recentes: linhas.slice(0, completo ? 10 : 3).map((l) => ({ ...l, o_que: cortar(l.o_que, 160) })) };
    },
    sites: async () => {
      const { linhas } = await lerLinhas(b, 'sites', ['id', 'nome', 'tipo', 'etapa', 'atualizado_em'], (q) =>
        q.eq('client_id', clientId).is('arquivado_em', null).order('atualizado_em', { ascending: false }).limit(5));
      return linhas;
    },
  });

  return {
    client_id: clientId,
    gerado_em: new Date().toISOString(),
    detalhe,
    ...secoes,
    faltou,
    proximas_ferramentas: [
      'aceleriq_mes_campanhas (campanhas e linha do tempo)',
      'aceleriq_estudio_trabalhos (artes e entregas)',
      'aceleriq_cerebro_do_cliente (o que o cliente ensinou)',
      'aceleriq_get_client_dossier (dossiê inteiro)',
      'aceleriq_mesa_ads_contexto (anúncios)',
    ],
    ms: Date.now() - inicio,
  };
}

// ─── Panorama da casa ───────────────────────────────────────────

export async function panoramaDaCasa(input: { detalhe?: string }, ctx: AuthContext) {
  exigirCasaInteira(ctx);
  const inicio = Date.now();
  const completo = detalheDe(input.detalhe) === 'completo';
  const hoje = hojeSP();
  const b = banco();
  const desde = (dias: number) => `${somarDias(hoje, -dias)}T00:00:00Z`;

  const { secoes, faltou } = await emPartes({
    clientes: async () => ({ total: await contagem(b.from('user_roles').select('user_id', { count: 'exact', head: true }).eq('role', 'client'), 'user_roles') }),
    tarefas: async () => {
      const base = () => b.from('tasks').select('id', { count: 'exact', head: true }).is('deleted_at', null).not('status', 'in', TAREFA_ABERTA);
      const [abertas, atrasadas, vencemHoje] = await Promise.all([
        contagem(base(), 'tasks'),
        contagem(base().lt('due_date', hoje), 'tasks'),
        contagem(base().eq('due_date', hoje), 'tasks'),
      ]);
      return { abertas, atrasadas, vencem_hoje: vencemHoje };
    },
    execucao: async () => {
      const [aprov, runs] = await Promise.all([
        lerLinhas(b, 'operator_approvals', ['status'], (q) => q.gte('created_at', desde(30)).limit(2000)),
        lerLinhas(b, 'operator_runs', ['status'], (q) => q.gte('started_at', desde(1)).limit(2000)),
      ]);
      return { aprovacoes_30d: contarPor(aprov.linhas, 'status'), runs_24h: contarPor(runs.linhas, 'status') };
    },
    comercial: async () => {
      const { linhas } = await lerLinhas(b, 'commercial_leads', ['stage', 'monthly_value', 'one_off_value'], (q) => q.is('archived_at', null).is('closed_at', null).limit(3000));
      const porEtapa = contarPor(linhas, 'stage');
      const mensal = linhas.reduce((a, l) => a + (Number(l.monthly_value) || 0), 0);
      return { abertos: linhas.length, por_etapa: porEtapa, valor_mensal_em_aberto: Math.round(mensal * 100) / 100 };
    },
    campanhas: async () => ({ ativas: await contagem(b.from('mesa_campanhas').select('id', { count: 'exact', head: true }).gte('periodo_fim', hoje).lte('periodo_inicio', hoje), 'mesa_campanhas') }),
    estudio_fila: async () => {
      const { linhas } = await lerLinhas(b, 'estudio_fila', ['status'], (q) => q.gte('criado_em', desde(7)).limit(3000));
      return contarPor(linhas, 'status');
    },
    pedidos_de_clientes: async () => {
      const { linhas } = await lerLinhas(b, 'client_requests', ['status'], (q) => q.gte('created_at', desde(90)).limit(3000));
      return contarPor(linhas, 'status');
    },
    laboratorio: async () => {
      const [carteira, rodando] = await Promise.all([
        lerLinhas(b, 'lab_carteira', ['saldo_usd', 'ativa', 'atualizado_em'], (q) => q.limit(1)),
        contagem(b.from('lab_execucoes').select('id', { count: 'exact', head: true }).in('status', ['na_fila', 'rodando']), 'lab_execucoes'),
      ]);
      return { carteira: carteira.linhas[0] ?? null, execucoes_em_andamento: rodando };
    },
  }, 7_000);

  return {
    gerado_em: new Date().toISOString(),
    detalhe: completo ? 'completo' : 'enxuto',
    ...secoes,
    faltou,
    proximas_ferramentas: ['aceleriq_operator_board (Execução)', 'aceleriq_list_opportunities (CRM)', 'aceleriq_get_finance_dashboard (financeiro)', 'aceleriq_panorama_do_cliente'],
    ms: Date.now() - inicio,
  };
}

// ─── Listas paginadas ───────────────────────────────────────────

interface EntradaDeLista { limite?: number; cursor?: string; detalhe?: string }

function faixa(input: EntradaDeLista, nomeDaLista: string) {
  const posicao = lerCursor(input.cursor, nomeDaLista);
  const tamanho = tamanhoDaPagina(input.limite);
  return { posicao, tamanho, ate: posicao + tamanho };
}

/** Campanhas da Mesa (Mês): lista enxuta ou uma campanha inteira, com o que está pendurado nela. */
export async function campanhasDoMes(input: EntradaDeLista & { client_id: string; campanha_id?: string; so_ativas?: boolean }, ctx: AuthContext) {
  const clientId = await conferirClienteDoPainel(input.client_id, ctx);
  const detalhe: Detalhe = input.campanha_id ? 'completo' : detalheDe(input.detalhe);
  const b = banco();
  if (input.campanha_id) {
    if (!isUuid(input.campanha_id)) throw new ErroDaFerramenta('entrada_invalida', 'campanha_id precisa ser um UUID.');
    const { linhas } = await lerLinhas(b, 'mesa_campanhas', ['id', 'client_id', 'nome', 'pedido', 'objetivo', 'status', 'periodo_inicio', 'periodo_fim', 'conceito', 'identidade', 'briefing', 'imagens', 'plano_imagens', 'proposta_id', 'selo_id', 'custo_usd', 'criado_em', 'atualizado_em'], (q) =>
      q.eq('id', input.campanha_id).eq('client_id', clientId).limit(1));
    const c = linhas[0];
    if (!c) throw new ErroDaFerramenta('nao_encontrado', 'Campanha não encontrada para este cliente.', 'Liste com aceleriq_mes_campanhas sem campanha_id.');
    const id = String(c.id);
    const { secoes, faltou } = await emPartes({
      conteudos: async () => {
        if (!c.proposta_id) return { total: 0, itens: [] };
        const { linhas: ps } = await lerLinhas(b, 'calendario_propostas', ['id', 'status', 'itens', 'periodo_inicio', 'periodo_fim', 'gravada_em'], (q) => q.eq('id', c.proposta_id).limit(1));
        const p = ps[0];
        const itens = lista(p?.itens).map((i) => escolher(i, ['tema_id', 'data', 'formato', 'tema', 'gancho', 'fase', 'status', 'task_id']));
        return { proposta_id: c.proposta_id, status: p?.status ?? null, total: itens.length, itens };
      },
      artes: async () => {
        const { linhas: ts } = await lerLinhas(b, 'estudio_trabalhos', ['id', 'tipo', 'status', 'entrega_status', 'aprovado_em', 'agendado_para', 'atualizado_em'], (q) =>
          q.eq('client_id', clientId).eq('direcao->arte_rapida->>campanha_id', id).order('atualizado_em', { ascending: false }).limit(60));
        return { total: ts.length, por_entrega: contarPor(ts, 'entrega_status'), itens: ts.slice(0, 20) };
      },
      stories: async () => {
        const { linhas: ss } = await lerLinhas(b, 'cliente_stories_sequencias', ['id', 'data', 'objetivo', 'titulo'], (q) =>
          q.eq('client_id', clientId).eq('escolha->campanha->>campanha_id', id).is('arquivado_em', null).order('data', { ascending: true }).limit(30));
        return ss;
      },
      criativos_de_ads: async () => {
        const { linhas: cs } = await lerLinhas(b, 'ads_criativos', ['id', 'nome', 'formato', 'status', 'trabalho_id', 'atualizado_em'], (q) =>
          q.eq('client_id', clientId).eq('copy->>campanha_mesa_id', id).order('atualizado_em', { ascending: false }).limit(40));
        return cs;
      },
      sons_da_trilha: async () => {
        const { linhas: vs } = await lerLinhas(b, 'video_arquivos', ['id', 'tipo', 'titulo', 'melhor', 'criado_em'], (q) =>
          q.eq('client_id', clientId).eq('origem->>campanha_id', id).order('criado_em', { ascending: false }).limit(20));
        return vs;
      },
    });
    const briefing = obj(c.briefing);
    return {
      campanha: c,
      resumo: {
        linha_do_tempo: briefing.linha_do_tempo ?? null,
        tem_mercado: !!briefing.mercado,
        trilha_escolhida: briefing.trilha ?? null,
        produtos: lista(briefing.produtos).length,
      },
      ...secoes,
      faltou,
      acoes: 'Para mudar: aceleriq_mesa_campanha_acao (mudanca_planejar/confirmar, reorganizar, mercado, roteiro_video, trilha, pecas_para_ads) e aceleriq_mesa_campanha_salvar.',
    };
  }
  const { posicao, tamanho, ate } = faixa(input, `campanhas:${clientId}:${input.so_ativas ? 1 : 0}`);
  const hoje = hojeSP();
  const campos = detalhe === 'completo'
    ? ['id', 'nome', 'pedido', 'objetivo', 'status', 'periodo_inicio', 'periodo_fim', 'conceito', 'briefing', 'proposta_id', 'custo_usd', 'atualizado_em']
    : ['id', 'nome', 'objetivo', 'status', 'periodo_inicio', 'periodo_fim', 'proposta_id', 'custo_usd', 'atualizado_em'];
  const { linhas, aviso } = await lerLinhas(b, 'mesa_campanhas', campos, (q) => {
    let x = q.eq('client_id', clientId);
    if (input.so_ativas) x = x.gte('periodo_fim', hoje);
    return x.order('periodo_inicio', { ascending: false }).range(posicao, ate);
  });
  return { client_id: clientId, detalhe, ...pagina(linhas.map((l) => ({ ...l, objetivo: detalhe === 'completo' ? l.objetivo : cortar(l.objetivo, 160) })), posicao, tamanho, `campanhas:${clientId}:${input.so_ativas ? 1 : 0}`), aviso };
}

/** Stories da Mesa: sequências (dia, objetivo) e, no completo, cada story. */
export async function storiesDaMesa(input: EntradaDeLista & { client_id: string; campanha_id?: string; desde?: string; ate?: string }, ctx: AuthContext) {
  const clientId = await conferirClienteDoPainel(input.client_id, ctx);
  const detalhe = detalheDe(input.detalhe);
  const nome = `stories:${clientId}:${input.campanha_id ?? ''}:${input.desde ?? ''}:${input.ate ?? ''}`;
  const { posicao, tamanho, ate } = faixa(input, nome);
  const b = banco();
  const { linhas, aviso } = await lerLinhas(b, 'cliente_stories_sequencias', ['id', 'data', 'objetivo', 'titulo', 'gancho_de_amanha', 'marca_id', 'atualizado_em'], (q) => {
    let x = q.eq('client_id', clientId).is('arquivado_em', null);
    if (input.campanha_id) x = x.eq('escolha->campanha->>campanha_id', input.campanha_id);
    if (input.desde) x = x.gte('data', input.desde);
    if (input.ate) x = x.lte('data', input.ate);
    return x.order('data', { ascending: false }).range(posicao, ate);
  });
  const pag = pagina(linhas, posicao, tamanho, nome);
  const ids = pag.itens.map((s) => String(s.id));
  let porSequencia = new Map<string, Objeto[]>();
  if (ids.length) {
    const campos = detalhe === 'completo'
      ? ['id', 'sequencia_id', 'ordem', 'molde', 'titulo', 'texto_na_tela', 'situacao', 'horario', 'postado_em', 'editorial_post_id']
      : ['sequencia_id', 'situacao'];
    const { linhas: sts } = await lerLinhas(b, 'cliente_stories', campos, (q) => q.eq('client_id', clientId).in('sequencia_id', ids).order('ordem', { ascending: true }).limit(500));
    porSequencia = sts.reduce((m, s) => m.set(String(s.sequencia_id), [...(m.get(String(s.sequencia_id)) ?? []), s]), new Map<string, Objeto[]>());
  }
  return {
    client_id: clientId,
    detalhe,
    itens: pag.itens.map((s) => {
      const sts = porSequencia.get(String(s.id)) ?? [];
      return {
        ...s,
        stories: sts.length,
        por_situacao: contarPor(sts, 'situacao'),
        ...(detalhe === 'completo' ? { lista: sts.map((x) => ({ ...x, texto_na_tela: cortar(x.texto_na_tela, 400) })) } : {}),
      };
    }),
    proximo_cursor: pag.proximo_cursor,
    aviso,
  };
}

/** Hype da semana guardado no Mês (Trending ao vivo é da tela, pelo Google Notícias). */
export async function hypeDoMes(input: { client_id: string; semanas?: number; detalhe?: string }, ctx: AuthContext) {
  const clientId = await conferirClienteDoPainel(input.client_id, ctx);
  const detalhe = detalheDe(input.detalhe);
  const semanas = Math.min(Math.max(Math.floor(Number(input.semanas) || 2), 1), 8);
  const { linhas, aviso } = await lerLinhas(banco(), 'mesa_hypes', ['id', 'semana', 'itens', 'resumo', 'criado_em'], (q) =>
    q.eq('client_id', clientId).order('semana', { ascending: false }).limit(semanas));
  const campos = ['titulo', 'assunto', 'tipo', 'quando', 'data', 'nota', 'por_que', 'ideia', 'fonte'];
  return {
    client_id: clientId,
    detalhe,
    semanas: linhas.map((h) => ({
      semana: h.semana,
      resumo: detalhe === 'completo' ? h.resumo : cortar(h.resumo, 300),
      itens: detalhe === 'completo' ? h.itens : lista(h.itens).slice(0, 8).map((i) => {
        const e = escolher(i, campos);
        for (const k of ['por_que', 'ideia']) if (typeof e[k] === 'string') e[k] = cortar(e[k], 160);
        return e;
      }),
      total: lista(h.itens).length,
    })),
    trending: 'Manchetes em alta (Google Notícias) saem ao vivo na tela do Mês, aba Hype > Trending.',
    aviso,
  };
}

/** Templates de design (X, Instagram, Story) do cliente ou da casa. */
export async function templatesDaMesa(input: EntradaDeLista & { client_id?: string; tipo?: string }, ctx: AuthContext) {
  if (input.client_id) await conferirClienteDoPainel(input.client_id, ctx);
  else exigirCasaInteira(ctx);
  const detalhe = detalheDe(input.detalhe);
  const nome = `templates:${input.client_id ?? 'casa'}:${input.tipo ?? ''}`;
  const { posicao, tamanho, ate } = faixa(input, nome);
  const campos = ['id', 'tipo', 'escopo', 'client_id', 'marca_id', 'nome', 'formato', 'status', 'origem', 'versao_atual', 'atualizado_em', ...(detalhe === 'completo' ? ['versoes', 'gostos', 'testes', 'fontes'] : [])];
  const { linhas, aviso } = await lerLinhas(banco(), 'cliente_templates_design', campos, (q) => {
    let x = input.client_id ? q.eq('client_id', input.client_id) : q;
    if (input.tipo) x = x.eq('tipo', input.tipo);
    return x.order('atualizado_em', { ascending: false }).range(posicao, ate);
  });
  const itens = linhas.map((t) => (detalhe === 'completo' ? { ...t, versoes: lista(t.versoes).slice(-3) } : t));
  return { detalhe, ...pagina(itens, posicao, tamanho, nome), aviso };
}

/** Trabalhos do Estúdio (artes, carrosséis, peças de campanha) com a situação da entrega. */
export async function trabalhosDoEstudio(input: EntradaDeLista & { client_id: string; status?: string; entrega_status?: string; campanha_id?: string }, ctx: AuthContext) {
  const clientId = await conferirClienteDoPainel(input.client_id, ctx);
  const detalhe = detalheDe(input.detalhe);
  const nome = `estudio:${clientId}:${input.status ?? ''}:${input.entrega_status ?? ''}:${input.campanha_id ?? ''}`;
  const { posicao, tamanho, ate } = faixa(input, nome);
  const campos = ['id', 'tipo', 'status', 'entrega_status', 'entrega_aviso', 'legenda', 'cards', 'aprovado_em', 'agendado_para', 'publicar_em', 'origem', 'task_id', 'post_id', 'atualizado_em', ...(detalhe === 'completo' ? ['direcao', 'hashtags', 'ajustes_do_cliente', 'file_ids', 'custo_usd'] : [])];
  const { linhas, aviso } = await lerLinhas(banco(), 'estudio_trabalhos', campos, (q) => {
    let x = q.eq('client_id', clientId);
    if (input.status) x = x.eq('status', input.status);
    if (input.entrega_status) x = x.eq('entrega_status', input.entrega_status);
    if (input.campanha_id) x = x.eq('direcao->arte_rapida->>campanha_id', input.campanha_id);
    return x.order('atualizado_em', { ascending: false }).range(posicao, ate);
  });
  const itens = linhas.map((t) => {
    const cards = lista(t.cards);
    const comArte = cards.filter((c) => typeof obj(c).storage_path === 'string').length;
    if (detalhe === 'completo') return { ...t, laminas_com_arte: comArte };
    const { cards: _c, ...resto } = t;
    return { ...resto, legenda: cortar(t.legenda, 200), laminas: cards.length, laminas_com_arte: comArte };
  });
  return { client_id: clientId, detalhe, ...pagina(itens, posicao, tamanho, nome), aviso };
}

/** Mesa Site: os sites (lista) ou um site com versões, edições e formulário. */
export async function siteDaMesa(input: EntradaDeLista & { client_id?: string; site_id?: string }, ctx: AuthContext) {
  const b = banco();
  if (input.site_id) {
    if (!isUuid(input.site_id)) throw new ErroDaFerramenta('entrada_invalida', 'site_id precisa ser um UUID.');
    const { linhas } = await lerLinhas(b, 'sites', ['id', 'client_id', 'marca_id', 'nome', 'projeto', 'tipo', 'etapa', 'briefing', 'direcao', 'mapa', 'seo', 'integracoes', 'publicacao', 'revisao', 'modelo', 'custo_usd', 'arquivado_em', 'criado_em', 'atualizado_em'], (q) => q.eq('id', input.site_id).limit(1));
    const s = linhas[0];
    if (!s) throw new ErroDaFerramenta('nao_encontrado', 'Site não encontrado.');
    await conferirClienteDoPainel(s.client_id, ctx);
    const completo = detalheDe(input.detalhe) === 'completo';
    const { secoes, faltou } = await emPartes({
      versoes: async () => (await lerLinhas(b, 'site_versoes', ['id', 'motivo', 'criado_em'], (q) => q.eq('site_id', s.id).order('criado_em', { ascending: false }).limit(5))).linhas,
      edicoes: async () => (await lerLinhas(b, 'site_edicoes', ['id', 'tipo', 'modo', 'resumo', 'secao', 'desfeita_em', 'criado_em'], (q) => q.eq('site_id', s.id).order('criado_em', { ascending: false }).limit(10))).linhas
        .map((e) => ({ ...e, resumo: cortar(e.resumo, 200) })),
      formulario_30d: async () => contarPor((await lerLinhas(b, 'site_formulario_envios', ['resultado'], (q) => q.eq('site_id', s.id).gte('criado_em', `${somarDias(hojeSP(), -30)}T00:00:00Z`).limit(2000))).linhas, 'resultado'),
    });
    const site = completo ? s : escolher(s, ['id', 'client_id', 'nome', 'tipo', 'etapa', 'publicacao', 'modelo', 'custo_usd', 'atualizado_em']);
    return { site, ...secoes, faltou };
  }
  if (input.client_id) await conferirClienteDoPainel(input.client_id, ctx);
  else exigirCasaInteira(ctx);
  const nome = `sites:${input.client_id ?? 'casa'}`;
  const { posicao, tamanho, ate } = faixa(input, nome);
  const { linhas, aviso } = await lerLinhas(b, 'sites', ['id', 'client_id', 'nome', 'tipo', 'etapa', 'modelo', 'custo_usd', 'atualizado_em'], (q) => {
    const x = input.client_id ? q.eq('client_id', input.client_id) : q;
    return x.is('arquivado_em', null).order('atualizado_em', { ascending: false }).range(posicao, ate);
  });
  return { ...pagina(linhas, posicao, tamanho, nome), aviso };
}

/** Laboratório: carteira de créditos, projetos (nós do canvas) e execuções; vendas sem dado pessoal. */
export async function laboratorio(input: EntradaDeLista & { projeto_id?: string; client_id?: string }, ctx: AuthContext) {
  const b = banco();
  const completo = detalheDe(input.detalhe) === 'completo';
  if (input.projeto_id) {
    if (!isUuid(input.projeto_id)) throw new ErroDaFerramenta('entrada_invalida', 'projeto_id precisa ser um UUID.');
    const { linhas } = await lerLinhas(b, 'lab_projetos', ['id', 'nome', 'client_id', 'contexto', 'canvas', 'versao', 'status', 'template_de', 'created_at', 'updated_at'], (q) => q.eq('id', input.projeto_id).limit(1));
    const p = linhas[0];
    if (!p) throw new ErroDaFerramenta('nao_encontrado', 'Projeto do Laboratório não encontrado.');
    if (p.client_id) await conferirClienteDoPainel(p.client_id, ctx);
    else exigirCasaInteira(ctx);
    const canvas = obj(p.canvas);
    const nos = lista(canvas.nos).map((n) => {
      const o = obj(n);
      const dados = obj(o.dados);
      return { id: o.id, tipo: o.tipo, titulo: dados.titulo ?? dados.nome ?? null, ...(completo ? { dados } : {}) };
    });
    const { linhas: execs } = await lerLinhas(b, 'lab_execucoes', ['id', 'no_id', 'tipo', 'status', 'custo_usd', 'erro', 'operador_slug', 'created_at', 'finished_at', ...(completo ? ['saida'] : [])], (q) =>
      q.eq('projeto_id', p.id).order('created_at', { ascending: false }).limit(completo ? 50 : 15));
    return {
      projeto: { ...escolher(p, ['id', 'nome', 'client_id', 'versao', 'status', 'template_de', 'updated_at']), contexto: completo ? p.contexto : cortar(p.contexto, 400) },
      nos: { total: nos.length, por_tipo: contarPor(nos as Objeto[], 'tipo'), itens: nos },
      ligacoes: lista(canvas.ligacoes).length,
      execucoes: { por_situacao: contarPor(execs, 'status'), custo_usd: Math.round(execs.reduce((a, e) => a + (Number(e.custo_usd) || 0), 0) * 10000) / 10000, recentes: execs.map((e) => ({ ...e, erro: cortar(e.erro, 200) })) },
    };
  }
  if (input.client_id) await conferirClienteDoPainel(input.client_id, ctx);
  else exigirCasaInteira(ctx);
  const nome = `lab:${input.client_id ?? 'casa'}`;
  const { posicao, tamanho, ate } = faixa(input, nome);
  const { secoes, faltou } = await emPartes({
    carteira: async () => (await lerLinhas(b, 'lab_carteira', ['saldo_usd', 'ativa', 'atualizado_em'], (q) => q.limit(1))).linhas[0] ?? null,
    movimentos: async () => (await lerLinhas(b, 'lab_creditos_movimentos', ['tipo', 'valor_usd', 'saldo_depois', 'debitado', 'projeto_id', 'nota', 'criado_em'], (q) => q.order('criado_em', { ascending: false }).limit(completo ? 30 : 8))).linhas,
    projetos: async () => {
      const { linhas } = await lerLinhas(b, 'lab_projetos', ['id', 'nome', 'client_id', 'status', 'versao', 'canvas', 'updated_at'], (q) => {
        const x = input.client_id ? q.eq('client_id', input.client_id) : q;
        return x.order('updated_at', { ascending: false }).range(posicao, ate);
      });
      const pag = pagina(linhas, posicao, tamanho, nome);
      return { ...pag, itens: pag.itens.map(({ canvas, ...r }) => ({ ...r, nos: lista(obj(canvas).nos).length })) };
    },
    vendas: async () => {
      const [integ, eventos] = await Promise.all([
        lerLinhas(b, 'vendas_integracoes', ['id', 'client_id', 'gateway', 'ativo', 'ultimo_evento_em'], (q) => {
          const x = input.client_id ? q.eq('client_id', input.client_id) : q;
          return x.order('criado_em', { ascending: false }).limit(20);
        }),
        lerLinhas(b, 'vendas_eventos', ['gateway', 'tipo', 'valor', 'moeda', 'produto_externo_id', 'recebido_em'], (q) => {
          const x = input.client_id ? q.eq('client_id', input.client_id) : q;
          return x.order('recebido_em', { ascending: false }).limit(completo ? 50 : 10);
        }),
      ]);
      return { integracoes: integ.linhas, eventos_recentes: eventos.linhas, por_tipo: contarPor(eventos.linhas, 'tipo') };
    },
  });
  return { ...secoes, faltou };
}

/** Base dos agentes: fichas que cada agente aprendeu (busca em português) e as fontes. */
export async function baseDosAgentes(input: EntradaDeLista & { agente?: string; client_id?: string; busca?: string; incluir_inativas?: boolean }, ctx: AuthContext) {
  if (input.client_id) await conferirClienteDoPainel(input.client_id, ctx);
  else exigirCasaInteira(ctx);
  const detalhe = detalheDe(input.detalhe);
  const nome = `base:${input.agente ?? ''}:${input.client_id ?? ''}:${input.busca ?? ''}:${input.incluir_inativas ? 1 : 0}`;
  const { posicao, tamanho, ate } = faixa(input, nome);
  const b = banco();
  const campos = ['id', 'agente', 'client_id', 'titulo', 'quando_usar', 'usos', 'aprovadas', 'reprovadas', 'multiplo', 'ativa', 'atualizado_em', ...(detalhe === 'completo' ? ['tecnica', 'exemplo', 'fonte_url', 'ajustadas', 'posts', 'anuncios', 'eficiencia'] : [])];
  const { linhas, aviso } = await lerLinhas(b, 'agente_base_fichas', campos, (q) => {
    let x = q;
    if (!input.incluir_inativas) x = x.eq('ativa', true);
    if (input.agente) x = x.eq('agente', input.agente);
    if (input.client_id) x = x.eq('client_id', input.client_id);
    if (input.busca) x = x.textSearch('busca', input.busca, { type: 'websearch', config: 'portuguese' });
    return x.order('usos', { ascending: false }).order('atualizado_em', { ascending: false }).range(posicao, ate);
  });
  const itens = linhas.map((f) => (detalhe === 'completo' ? f : { ...f, quando_usar: cortar(f.quando_usar, 180) }));
  let fontes: Objeto[] | undefined;
  if (!input.cursor && !input.busca) {
    fontes = (await lerLinhas(b, 'agente_base_fontes', ['id', 'agente', 'tipo', 'nome', 'status', 'fichas', 'custo_usd', 'criado_em'], (q) => {
      let x = q;
      if (input.agente) x = x.eq('agente', input.agente);
      if (input.client_id) x = x.eq('client_id', input.client_id);
      return x.order('criado_em', { ascending: false }).limit(10);
    })).linhas;
  }
  return { detalhe, ...pagina(itens, posicao, tamanho, nome), ...(fontes ? { fontes_recentes: fontes } : {}), aviso };
}

/** Área de membros: produtos, licenças e o CRM licença em números (nada pessoal sai daqui). */
export async function membros(input: { produto_id?: string; detalhe?: string }, ctx: AuthContext) {
  exigirCasaInteira(ctx);
  if (input.produto_id && !isUuid(input.produto_id)) throw new ErroDaFerramenta('entrada_invalida', 'produto_id precisa ser um UUID.');
  const b = banco();
  const completo = detalheDe(input.detalhe) === 'completo';
  const agora = new Date().toISOString();
  // deno-lint-ignore no-explicit-any
  const filtroProduto = (q: any): any => (input.produto_id ? q.eq('produto_id', input.produto_id) : q);
  const { secoes, faltou } = await emPartes({
    produtos: async () => (await lerLinhas(b, 'membros_produtos', ['id', 'titulo', 'estado', 'categoria', 'formato', 'gratuito', 'em_venda', 'tipo_produto', 'destaque', 'ordem', 'atualizado_em', ...(completo ? ['descricao', 'checkout_url', 'landing_url', 'condicoes'] : [])], (q) => {
      const x = input.produto_id ? q.eq('id', input.produto_id) : q;
      return x.order('ordem', { ascending: true }).limit(100);
    })).linhas.map((p) => (completo ? { ...p, descricao: cortar(p.descricao, 1200) } : p)),
    ferramentas: async () => (await lerLinhas(b, 'membros_ferramentas', ['produto_id', 'motor', 'ativo'], (q) => filtroProduto(q).limit(50))).linhas,
    licencas: async () => {
      const { linhas } = await lerLinhas(b, 'membros_licencas', ['produto_id', 'origem', 'fim', 'revogado_em'], (q) => filtroProduto(q).limit(5000));
      const porProduto: Record<string, { ativas: number; vencidas: number; revogadas: number; por_origem: Record<string, number> }> = {};
      for (const l of linhas) {
        const k = String(l.produto_id);
        const c = porProduto[k] ??= { ativas: 0, vencidas: 0, revogadas: 0, por_origem: {} };
        if (l.revogado_em) c.revogadas++;
        else if (l.fim && String(l.fim) < agora) c.vencidas++;
        else c.ativas++;
        const o = String(l.origem ?? 'sem_origem');
        c.por_origem[o] = (c.por_origem[o] ?? 0) + 1;
      }
      return porProduto;
    },
    compras: async () => {
      const { linhas } = await lerLinhas(b, 'membros_compras', ['produto_id', 'estado'], (q) => filtroProduto(q).limit(5000));
      const saida: Record<string, Record<string, number>> = {};
      for (const l of linhas) {
        const k = String(l.produto_id);
        const e = String(l.estado ?? 'sem_estado');
        (saida[k] ??= {})[e] = ((saida[k] ?? {})[e] ?? 0) + 1;
      }
      return saida;
    },
    crm_licenca: async () => {
      const [contatos, negocios] = await Promise.all([
        contagem(filtroProduto(b.from('membros_crm_contatos').select('id', { count: 'exact', head: true }).eq('arquivado', false)), 'membros_crm_contatos'),
        lerLinhas(b, 'membros_crm_negocios', ['estagio', 'valor'], (q) => filtroProduto(q.eq('arquivado', false)).limit(5000)),
      ]);
      const porEstagio: Record<string, { negocios: number; valor: number }> = {};
      for (const n of negocios.linhas) {
        const e = String(n.estagio ?? 'novo');
        const c = porEstagio[e] ??= { negocios: 0, valor: 0 };
        c.negocios++;
        c.valor = Math.round((c.valor + (Number(n.valor) || 0)) * 100) / 100;
      }
      return { contatos_ativos: contatos, negocios_por_estagio: porEstagio, observacao: 'Só números: contatos e negócios são de cada membro e não saem pelo MCP.' };
    },
  });
  return { ...secoes, faltou };
}
