/**
 * Escritório da Aceleriq (MCP 2.34.0, 18/11/2026): as regras, sem banco.
 *
 * Quem pode falar com quem (grau e lugar), o freio de conversa entre bots, o verificador de segredo
 * e a leitura de função repetida. Tudo aqui é função pura: o módulo escritorio.ts só busca e grava.
 */

import { temSegredo as temSegredoDaCentral } from '../../central-skills/modulos/nucleo.ts';

export const GRAUS = ['orquestrador', 'coordenador', 'executor', 'leitor'] as const;
export type Grau = (typeof GRAUS)[number];

/** A coluna `origem` do cadastro é a plataforma do agente. */
export const PLATAFORMAS = ['hermes', 'grok', 'paperclip', 'n8n', 'claude_code', 'codex', 'chatgpt', 'openbot'] as const;
export type Plataforma = (typeof PLATAFORMAS)[number];

/** Lugar reservado da pessoa. Nenhum operador usa este slug. */
export const DONO = 'dono';
export const SLUG = /^[a-z][a-z0-9-]{1,38}$/;

export const MAXIMO_ENTRE_BOTS = 2;
export const PRESENCA_FRESCA_MIN = 10;

export interface Operador {
  slug: string;
  display_name: string;
  role: string;
  status: string;
  scope?: string | null;
  area?: string | null;
  parent_slug?: string | null;
  origem?: string | null;
  grau?: string | null;
  is_coordinator?: boolean | null;
  last_run_at?: string | null;
}

export interface Mensagem {
  id: string;
  conversa_id: string;
  de_slug: string;
  de_tipo: 'operador' | 'humano';
  para_slug: string | null;
  grupo_id: string | null;
  corpo: string;
  responde_a?: string | null;
  client_id?: string | null;
  task_id?: string | null;
  idempotency_key?: string | null;
  created_at: string;
}

export interface Grupo {
  id: string;
  slug: string;
  nome: string;
  area?: string | null;
  descricao?: string | null;
  ativo: boolean;
  membros: Array<{ operator_slug: string; papel: string }>;
}

export const sem_acento = (t: unknown) =>
  String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export const grauDe = (o: Pick<Operador, 'grau' | 'is_coordinator'>): Grau =>
  (GRAUS as readonly string[]).includes(String(o.grau)) ? (o.grau as Grau) : o.is_coordinator ? 'coordenador' : 'executor';

export const plataformaDe = (o: Pick<Operador, 'origem'>): string => o.origem || 'hermes';
export const ativo = (o: Pick<Operador, 'status'>) => o.status === 'active';
const mesmaArea = (a: Operador, b: Operador) => !!sem_acento(a.area) && sem_acento(a.area) === sem_acento(b.area);
/** A área Coordenação (a ponte do dono, onde está o Fred): todo coordenador alcança o coordenador dela (MCP 2.36.1). */
const AREA_COORDENACAO = sem_acento('Coordenação');
const coordenadorDaCoordenacao = (o: Operador) => grauDe(o) === 'coordenador' && sem_acento(o.area) === AREA_COORDENACAO;

// ─── Segredo ────────────────────────────────────────────────────

/** Além dos padrões da Central (chave privada, mcp_live_, sk-, GitHub, Slack, AWS, JWT). */
const OUTROS_SEGREDOS: RegExp[] = [
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}/,
  /\bwhsec_[A-Za-z0-9]{10,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\bEAA[A-Za-z0-9]{30,}/,
  /\bBearer\s+[A-Za-z0-9._~+\/-]{16,}=*/i,
  /https?:\/\/[^\s?#]+\?[^\s#]*(?:token|key|secret|signature|access_token|password|senha)=[^\s#&]{6,}/i,
  /\b(?:senha|password|passwd|pwd|token|secret|segredo|api[_ -]?key|chave de api|chave secreta|client[_ -]?secret)\s*[:=]\s*(?:"[^"]{4,}"|'[^']{4,}'|[^\s,;]{6,})/i,
];

/** A mensagem parece carregar senha, token ou chave? Mensagem assim é recusada inteira. */
export function pareceTerSegredo(texto: unknown): boolean {
  const s = String(texto ?? '');
  return temSegredoDaCentral(s) || OUTROS_SEGREDOS.some((re) => re.test(s));
}

/** Para texto que vem de máquina (erro de automação): tira o trecho em vez de recusar. */
export function tirarSegredos(texto: unknown): string {
  let s = String(texto ?? '');
  for (const re of OUTROS_SEGREDOS) s = s.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`), '[removido]');
  return temSegredoDaCentral(s) ? '[removido: parecia ter chave]' : s;
}

// ─── Quem fala com quem ─────────────────────────────────────────

export type Decisao = { ok: true } | { ok: false; codigo: string; erro: string; dica: string };

const nao = (codigo: string, erro: string, dica: string): Decisao => ({ ok: false, codigo, erro, dica });

/** O coordenador ativo da área do agente (o dono da área). */
export function donoDaArea(o: Operador, todos: Operador[]): Operador | null {
  const area = sem_acento(o.area);
  if (!area) return null;
  return todos.find((x) => ativo(x) && sem_acento(x.area) === area && grauDe(x) === 'coordenador' && x.slug !== o.slug)
    ?? todos.find((x) => ativo(x) && sem_acento(x.area) === area && grauDe(x) === 'orquestrador' && x.slug !== o.slug)
    ?? null;
}

/**
 * Mensagem direta. `respondendo` = o destino já escreveu para o remetente nesta conversa
 * (responder a quem falou com você é sempre permitido).
 */
export function podeFalarCom(de: Operador, para: Operador | typeof DONO, todos: Operador[], respondendo = false): Decisao {
  if (!ativo(de)) return nao('agente_parado', `"${de.slug}" não está ativo no Escritório.`, 'Só o dono reativa um agente (painel, Escritório, Acessos).');
  const g = grauDe(de);
  if (para === DONO) {
    if (respondendo || g === 'orquestrador' || g === 'coordenador') return { ok: true };
    return nao('fale_com_o_coordenador', 'Executor e leitor não escrevem direto ao dono.',
      'Peça decisão com aceleriq_operator_request_approval ou fale com o coordenador da sua área (aceleriq_escritorio_diretorio mostra quem é).');
  }
  if (para.slug === de.slug) return nao('para_voce_mesmo', 'Mensagem para você mesmo não é registrada.', 'Use o diário da tarefa (aceleriq_operator_diary).');
  if (!ativo(para)) {
    const quem = donoDaArea(para, todos);
    return nao('destino_parado', `"${para.slug}" está fora de operação (${para.status}).`,
      quem ? `Quem responde por essa área agora: "${quem.slug}" (${quem.display_name}).` : 'Veja em aceleriq_escritorio_diretorio quem assumiu a função.');
  }
  if (respondendo || g === 'orquestrador') return { ok: true };
  const chefe = de.parent_slug === para.slug;
  const subordinado = para.parent_slug === de.slug;
  if (g === 'coordenador') {
    // 2.36.1: coordenador também fala direto com o coordenador da área Coordenação (Fred); as outras áreas seguem fechadas.
    if (grauDe(para) === 'orquestrador' || mesmaArea(de, para) || chefe || subordinado || coordenadorDaCoordenacao(para)) return { ok: true };
    return nao('fora_da_sua_area', `"${para.slug}" é de outra área (${para.area ?? 'sem área'}).`,
      'Coordenador fala com a própria área, com os orquestradores e com o coordenador da área Coordenação. Para outra área, escreva na sala coordenacao ou peça a um orquestrador.');
  }
  if (chefe || (grauDe(para) === 'coordenador' && mesmaArea(de, para))) return { ok: true };
  const quem = donoDaArea(de, todos);
  return nao('fale_com_o_coordenador', g === 'leitor' ? 'Leitor só manda alerta ao coordenador da própria área.' : 'Executor fala com o coordenador da própria área e nas salas dele.',
    quem ? `Seu coordenador é "${quem.slug}" (${quem.display_name}).` : 'Veja em aceleriq_escritorio_diretorio quem coordena a sua área.');
}

export function podeEscreverNaSala(de: Operador, grupo: Grupo): Decisao {
  if (!ativo(de)) return nao('agente_parado', `"${de.slug}" não está ativo no Escritório.`, 'Só o dono reativa um agente.');
  if (!grupo.ativo) return nao('sala_fechada', `A sala "${grupo.slug}" está fechada.`, 'aceleriq_escritorio_grupos lista as salas abertas.');
  const m = grupo.membros.find((x) => x.operator_slug === de.slug);
  if (grauDe(de) === 'orquestrador') return { ok: true };
  if (!m) return nao('fora_da_sala', `"${de.slug}" não é membro da sala "${grupo.slug}".`, 'Só o dono põe agente em sala (painel, Escritório, Salas).');
  if (m.papel === 'observador') return nao('so_observa', `"${de.slug}" só observa a sala "${grupo.slug}".`, 'Fale com o coordenador da área por mensagem direta.');
  return { ok: true };
}

// ─── Freio: no máximo 2 mensagens entre bots por tarefa ─────────

/**
 * `daUnidade` = mensagens da mesma tarefa (ou, sem tarefa, da mesma conversa), em ordem de data.
 * Conta as de bot para bot desde a última fala do dono. Falar com o dono não entra na conta.
 */
export function contarEntreBots(daUnidade: Pick<Mensagem, 'de_tipo' | 'para_slug'>[]): number {
  let n = 0;
  for (const m of daUnidade) {
    if (m.de_tipo === 'humano') n = 0;
    else if (m.para_slug !== DONO) n++;
  }
  return n;
}

export function cabeMaisUma(daUnidade: Pick<Mensagem, 'de_tipo' | 'para_slug'>[], paraODono: boolean): Decisao {
  if (paraODono || contarEntreBots(daUnidade) < MAXIMO_ENTRE_BOTS) return { ok: true };
  return nao('limite_entre_bots',
    `Esta tarefa já tem ${MAXIMO_ENTRE_BOTS} mensagens entre agentes. A terceira não é registrada.`,
    'Regra da casa: um dono por tarefa e no máximo 2 mensagens entre bots. Registre o que falta no diário (aceleriq_operator_diary) ou peça decisão ao dono (aceleriq_operator_request_approval). Quando o dono responder na conversa, ela abre de novo.');
}

// ─── Função repetida ────────────────────────────────────────────

export interface FuncaoRepetida { area: string; funcao: string; agentes: Array<{ slug: string; nome: string; plataforma: string }> }

/** Dois ou mais agentes ATIVOS com a mesma área e o mesmo papel. */
export function funcoesRepetidas(todos: Operador[]): FuncaoRepetida[] {
  const mapa = new Map<string, Operador[]>();
  for (const o of todos) {
    if (!ativo(o)) continue;
    const area = sem_acento(o.area), papel = sem_acento(o.role);
    if (!area || !papel) continue;
    const k = `${area}|${papel}`;
    mapa.set(k, [...(mapa.get(k) ?? []), o]);
  }
  return [...mapa.values()].filter((l) => l.length > 1).map((l) => ({
    area: String(l[0].area),
    funcao: l[0].role,
    agentes: l.map((o) => ({ slug: o.slug, nome: o.display_name, plataforma: plataformaDe(o) })),
  }));
}

// ─── Presença ───────────────────────────────────────────────────

export function presencaFresca(batimentoEm: string | null | undefined, agora = Date.now()): boolean {
  const t = batimentoEm ? Date.parse(batimentoEm) : NaN;
  return Number.isFinite(t) && agora - t <= PRESENCA_FRESCA_MIN * 60_000;
}

export function ultimaAtividade(...datas: Array<string | null | undefined>): string | null {
  const validas = datas.map((d) => (d ? Date.parse(d) : NaN)).filter((t) => Number.isFinite(t));
  return validas.length ? new Date(Math.max(...validas)).toISOString() : null;
}

// ─── Textos fixos da porta de entrada ───────────────────────────

export const REGRAS_DA_CASA = [
  'Um dono por tarefa. No máximo 2 mensagens entre agentes por tarefa. Sem aviso só para constar.',
  'Nenhuma mensagem leva senha, token ou chave. Login e código só pelo cofre (aceleriq_acesso_usar e aceleriq_acesso_pedir).',
  'Mensagem a cliente, gasto, publicação e financeiro só com aprovação do dono (aceleriq_operator_request_approval).',
  'Feito só com evidência: relate com aceleriq_operator_report e escreva no diário da tarefa.',
  'Tudo pelo painel: tarefa no Kanban, conteúdo no calendário, anúncio pela Mesa Ads.',
  'Antes de inventar, pergunte ao agente que é dono da área (aceleriq_escritorio_diretorio).',
];

export const ORDEM_DA_MEMORIA = [
  'memory_get_context (o contexto da casa, uma vez por sessão)',
  'memory_search e memory_fetch (o assunto de agora)',
  'aceleriq_base_dos_agentes (o que os agentes do painel já aprenderam)',
  'aceleriq_cerebro_do_cliente (antes de criar qualquer coisa para um cliente)',
  'Para registrar o que aprendeu: memory_propose_update',
];

/** Como a mensagem chega a cada plataforma (para o remetente saber o que esperar). */
export const ENTREGA_POR_PLATAFORMA: Record<string, string> = {
  hermes: 'O Hermes olha a caixa a cada 5 minutos e acorda o perfil quando há mensagem.',
  grok: 'Lê a caixa ao começar a sessão (aceleriq_escritorio_entrar).',
  claude_code: 'Lê a caixa ao começar a sessão (aceleriq_escritorio_entrar).',
  codex: 'Lê a caixa ao começar a sessão (aceleriq_escritorio_entrar).',
  chatgpt: 'Lê a caixa ao começar a sessão (aceleriq_escritorio_entrar).',
  openbot: 'O OpenBot é acordado pela rotina local quando há mensagem.',
  paperclip: 'O Despachante do Paperclip lê a caixa na rodada dele.',
  n8n: 'Automação: não conversa. Fale com o dono dela.',
};
