/**
 * MCP 2.34.0 (18/11/2026): Escritório da Aceleriq.
 *
 * Uma camada só para todos os agentes, de qualquer plataforma (Hermes, Grok, OpenBot, Paperclip,
 * Claude Code, Codex, ChatGPT, n8n). Quem conecta o MCP chama aceleriq_escritorio_entrar e já sabe
 * quem é, a quem responde, as regras da casa, a ordem da memória, as skills, as salas e o que tem
 * para ler. A conversa de agente para agente passa a ter lugar próprio, fora do chat do dono.
 *
 * O que o servidor trava (não depende da boa vontade do agente):
 *   - cada credencial lê e assina só pelos agentes ligados a ela (operator_key_bindings);
 *   - grau e lugar decidem com quem cada um fala (escritorio-regras.ts);
 *   - no máximo 2 mensagens entre bots por tarefa; a terceira não é registrada;
 *   - mensagem com cara de senha, token ou chave é recusada inteira.
 *
 * Nada aqui fala com cliente, gasta, publica ou mexe no financeiro.
 */

import { z } from 'https://esm.sh/zod@3.23.8';
import type { ToolDefinition } from '../../_shared/mcp-tools.ts';
import { assertClientAccess, type AuthContext } from '../../_shared/mcp-auth.ts';
import { db } from '../../_shared/aceleriq-read-services.ts';
import { ErroDaFerramenta } from './robustez.ts';
import { principalDaChamada, vinculosDaChave, type VinculoDaChave } from './autoria.ts';
import { consumirTaxa } from './diario.ts';
import {
  ativo,
  cabeMaisUma,
  contarEntreBots,
  type Decisao,
  DONO,
  donoDaArea,
  ENTREGA_POR_PLATAFORMA,
  funcoesRepetidas,
  grauDe,
  type Grupo,
  MAXIMO_ENTRE_BOTS,
  type Mensagem,
  type Operador,
  ORDEM_DA_MEMORIA,
  pareceTerSegredo,
  PLATAFORMAS,
  plataformaDe,
  podeEscreverNaSala,
  podeFalarCom,
  presencaFresca,
  REGRAS_DA_CASA,
  sem_acento,
  SLUG,
  tirarSegredos,
  ultimaAtividade,
} from './escritorio-regras.ts';

const LEITURA = { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false };
const ESCRITA = { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: false };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const ENVIOS_POR_MINUTO = 20;
const JANELA_DA_CAIXA_DIAS = 30;

const erroDeEntrada = (e: z.ZodError) =>
  new ErroDaFerramenta('entrada_invalida', `Entrada inválida: ${e.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`).join('; ')}`, null, false);
const recusar = (d: Decisao) => {
  if (!d.ok) throw new ErroDaFerramenta(d.codigo, d.erro, d.dica, false);
};

// ─── A porta para o banco (os testes trocam por uma de memória) ─

export interface Presenca { operator_slug: string; batimento_em: string; fazendo: string | null; plataforma: string | null }
export interface Automacao {
  id?: string; plataforma: string; ref: string; nome: string; o_que_faz: string | null; dono_slug: string | null; ativo: boolean;
  ultima_execucao_em: string | null; ultimo_status: string | null; ultimo_erro: string | null; ultimo_erro_em: string | null;
  execucoes: number; erros: number;
}
export interface Conversa { id: string; tipo: 'direta' | 'grupo'; grupo_id: string | null; assunto: string | null; client_id: string | null; task_id: string | null; criada_por: string; ultima_em?: string }
type NovaMensagem = Omit<Mensagem, 'id' | 'created_at'>;

export interface PortaDoEscritorio {
  vinculos(principal: string): Promise<VinculoDaChave[] | null>;
  operadores(): Promise<Operador[]>;
  grupos(): Promise<Grupo[]>;
  conversa(id: string): Promise<Conversa | null>;
  criarConversa(c: Omit<Conversa, 'id'>): Promise<Conversa>;
  mensagemPorChave(de: string, chave: string): Promise<Mensagem | null>;
  mensagensDaUnidade(u: { task_id?: string | null; conversa_id: string }): Promise<Mensagem[]>;
  mensagensDaConversa(id: string, limite: number): Promise<Mensagem[]>;
  mensagensPara(slug: string, grupoIds: string[], desde: string, limite: number): Promise<Mensagem[]>;
  gravarMensagem(m: NovaMensagem): Promise<Mensagem>;
  lidas(slug: string, ids: string[]): Promise<Set<string>>;
  marcarLidas(slug: string, ids: string[]): Promise<number>;
  presencas(): Promise<Presenca[]>;
  baterPresenca(p: { operator_slug: string; fazendo: string | null; plataforma: string | null; client_id: string | null; task_id: string | null }): Promise<void>;
  automacoes(): Promise<Automacao[]>;
  gravarAutomacao(a: Automacao): Promise<void>;
  taxa(chave: string, maximo: number): Promise<{ ok: boolean; esperar_seg: number }>;
}

const COL_OPERADOR = 'slug, display_name, role, status, scope, area, parent_slug, origem, grau, is_coordinator, last_run_at';
const COL_MENSAGEM = 'id, conversa_id, de_slug, de_tipo, para_slug, grupo_id, corpo, responde_a, client_id, task_id, idempotency_key, created_at';
const COL_CONVERSA = 'id, tipo, grupo_id, assunto, client_id, task_id, criada_por, ultima_em';
const COL_AUTOMACAO = 'id, plataforma, ref, nome, o_que_faz, dono_slug, ativo, ultima_execucao_em, ultimo_status, ultimo_erro, ultimo_erro_em, execucoes, erros';

function falhou(onde: string, error: { code?: string; message?: string } | null): never {
  console.error('[mcp escritorio]', onde, { code: error?.code });
  if (error?.code === '42P01' || error?.code === 'PGRST205') {
    throw new ErroDaFerramenta('escritorio_nao_instalado', 'O Escritório ainda não foi instalado neste banco.', 'Falta aplicar a migration 20261118200000_escritorio_dos_agentes.', false);
  }
  throw new ErroDaFerramenta('falha_no_banco', `O Escritório não respondeu agora (${onde}).`, 'Tente de novo em instantes.', true);
}

export function portaDoBanco(): PortaDoEscritorio {
  const b = db();
  return {
    vinculos: (p) => vinculosDaChave(p, b),
    async operadores() {
      const { data, error } = await b.from('internal_operators').select(COL_OPERADOR).limit(500);
      if (error) falhou('operadores', error);
      return (data ?? []) as Operador[];
    },
    async grupos() {
      const { data, error } = await b.from('escritorio_grupos')
        .select('id, slug, nome, area, descricao, ativo, escritorio_grupo_membros(operator_slug, papel)').order('nome').limit(200);
      if (error) falhou('salas', error);
      return ((data ?? []) as Array<Record<string, unknown>>).map((g) => ({
        id: String(g.id), slug: String(g.slug), nome: String(g.nome), area: (g.area as string) ?? null,
        descricao: (g.descricao as string) ?? null, ativo: g.ativo !== false,
        membros: ((g.escritorio_grupo_membros ?? []) as Array<{ operator_slug: string; papel: string }>),
      }));
    },
    async conversa(id) {
      const { data, error } = await b.from('escritorio_conversas').select(COL_CONVERSA).eq('id', id).maybeSingle();
      if (error) falhou('conversa', error);
      return (data as Conversa) ?? null;
    },
    async criarConversa(c) {
      const { data, error } = await b.from('escritorio_conversas').insert(c).select(COL_CONVERSA).single();
      if (error) falhou('abrir conversa', error);
      return data as Conversa;
    },
    async mensagemPorChave(de, chave) {
      const { data, error } = await b.from('escritorio_mensagens').select(COL_MENSAGEM).eq('de_slug', de).eq('idempotency_key', chave).maybeSingle();
      if (error) falhou('repetição', error);
      return (data as Mensagem) ?? null;
    },
    async mensagensDaUnidade(u) {
      let q = b.from('escritorio_mensagens').select(COL_MENSAGEM);
      q = u.task_id ? q.eq('task_id', u.task_id) : q.eq('conversa_id', u.conversa_id);
      const { data, error } = await q.order('created_at', { ascending: false }).limit(40);
      if (error) falhou('freio', error);
      return ((data ?? []) as Mensagem[]).reverse();
    },
    async mensagensDaConversa(id, limite) {
      const { data, error } = await b.from('escritorio_mensagens').select(COL_MENSAGEM).eq('conversa_id', id)
        .order('created_at', { ascending: false }).limit(limite);
      if (error) falhou('conversa', error);
      return ((data ?? []) as Mensagem[]).reverse();
    },
    async mensagensPara(slug, grupoIds, desde, limite) {
      const filtro = grupoIds.length ? `para_slug.eq.${slug},grupo_id.in.(${grupoIds.join(',')})` : `para_slug.eq.${slug}`;
      const { data, error } = await b.from('escritorio_mensagens').select(COL_MENSAGEM).or(filtro).neq('de_slug', slug)
        .gte('created_at', desde).order('created_at', { ascending: false }).limit(limite);
      if (error) falhou('caixa', error);
      return (data ?? []) as Mensagem[];
    },
    async gravarMensagem(m) {
      const { data, error } = await b.from('escritorio_mensagens').insert(m).select(COL_MENSAGEM).single();
      if (error) {
        // Duas chamadas iguais ao mesmo tempo: a segunda acha a primeira pela chave.
        if (error.code === '23505' && m.idempotency_key) {
          const ja = await this.mensagemPorChave(m.de_slug, m.idempotency_key);
          if (ja) return ja;
        }
        falhou('gravar mensagem', error);
      }
      await b.from('escritorio_conversas').update({ ultima_em: new Date().toISOString() }).eq('id', m.conversa_id);
      return data as Mensagem;
    },
    async lidas(slug, ids) {
      if (!ids.length) return new Set();
      const { data, error } = await b.from('escritorio_leituras').select('mensagem_id').eq('leitor_slug', slug).in('mensagem_id', ids);
      if (error) falhou('leituras', error);
      return new Set(((data ?? []) as Array<{ mensagem_id: string }>).map((r) => r.mensagem_id));
    },
    async marcarLidas(slug, ids) {
      if (!ids.length) return 0;
      const { error } = await b.from('escritorio_leituras')
        .upsert(ids.map((id) => ({ mensagem_id: id, leitor_slug: slug })), { onConflict: 'mensagem_id,leitor_slug', ignoreDuplicates: true });
      if (error) falhou('marcar lida', error);
      return ids.length;
    },
    async presencas() {
      const { data, error } = await b.from('escritorio_presenca').select('operator_slug, batimento_em, fazendo, plataforma').limit(500);
      if (error) falhou('presença', error);
      return (data ?? []) as Presenca[];
    },
    async baterPresenca(p) {
      const { error } = await b.from('escritorio_presenca').upsert({ ...p, batimento_em: new Date().toISOString() }, { onConflict: 'operator_slug' });
      if (error) falhou('presença', error);
    },
    async automacoes() {
      const { data, error } = await b.from('escritorio_automacoes').select(COL_AUTOMACAO).order('nome').limit(500);
      if (error) falhou('automações', error);
      return (data ?? []) as Automacao[];
    },
    async gravarAutomacao(a) {
      const { error } = await b.from('escritorio_automacoes')
        .upsert({ ...a, atualizado_em: new Date().toISOString() }, { onConflict: 'plataforma,ref' });
      if (error) falhou('automação', error);
    },
    taxa: (chave, maximo) => consumirTaxa(chave, maximo, b),
  };
}

// ─── Quem está chamando ─────────────────────────────────────────

const slugDe = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
const ehAdmin = (ctx: AuthContext) => ctx.scopes.includes('admin');

/**
 * O agente desta chamada. Com `operator`, a credencial precisa estar ligada a ele (ou ser do dono).
 * Sem `operator`, vale o agente padrão da credencial.
 */
export async function quemChama(ctx: AuthContext, pedido: unknown, porta: PortaDoEscritorio, todos?: Operador[]): Promise<Operador> {
  const vinculos = await porta.vinculos(principalDaChamada(ctx));
  let slug = slugDe(pedido);
  if (slug) {
    if (!SLUG.test(slug) || slug === DONO) throw new ErroDaFerramenta('entrada_invalida', 'operator inválido.', 'Use o seu slug, como aparece em aceleriq_escritorio_diretorio.', false);
    if (vinculos !== null && !ehAdmin(ctx) && !vinculos.some((v) => v.operator_slug === slug)) {
      throw new ErroDaFerramenta('nao_e_voce', `Esta credencial não responde por "${slug}".`,
        vinculos.length ? `Ela responde por: ${vinculos.map((v) => v.operator_slug).join(', ')}.` : 'Peça ao dono para ligar a credencial ao seu agente (painel, Escritório, Acessos).', false);
    }
  } else {
    const padrao = vinculos?.find((v) => v.padrao) ?? (vinculos?.length === 1 ? vinculos[0] : null);
    if (!padrao) {
      throw new ErroDaFerramenta('diga_quem_voce_e', 'Não deu para saber qual agente você é.',
        vinculos?.length ? `Passe operator com um destes: ${vinculos.map((v) => v.operator_slug).join(', ')}.` : 'Passe operator com o seu slug. Se você ainda não tem cadastro, peça ao dono (ou use aceleriq_operator_register).', false);
    }
    slug = padrao.operator_slug;
  }
  const eu = (todos ?? await porta.operadores()).find((o) => o.slug === slug);
  if (!eu) throw new ErroDaFerramenta('nao_cadastrado', `"${slug}" não está no cadastro de agentes.`, 'Cadastre com aceleriq_operator_register ou confira o slug em aceleriq_escritorio_diretorio.', false);
  return eu;
}

// ─── Formatos de saída ──────────────────────────────────────────

const cartao = (o: Operador) => ({ slug: o.slug, nome: o.display_name, plataforma: plataformaDe(o), funcao: o.role, area: o.area ?? null, grau: grauDe(o) });
const corte = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

function mostrar(m: Mensagem, grupos: Grupo[], lida?: boolean, inteira = true) {
  return {
    id: m.id,
    conversa_id: m.conversa_id,
    de: m.de_slug,
    ...(m.grupo_id ? { sala: grupos.find((g) => g.id === m.grupo_id)?.slug ?? null } : { para: m.para_slug }),
    texto: inteira ? m.corpo : corte(m.corpo, 280),
    ...(m.responde_a ? { responde_a: m.responde_a } : {}),
    ...(m.client_id ? { client_id: m.client_id } : {}),
    ...(m.task_id ? { task_id: m.task_id } : {}),
    quando: m.created_at,
    ...(lida === undefined ? {} : { lida }),
  };
}

async function caixaDe(eu: Operador, grupos: Grupo[], porta: PortaDoEscritorio, limite: number, desde?: string) {
  const minhas = grupos.filter((g) => g.ativo && g.membros.some((x) => x.operator_slug === eu.slug));
  const inicio = desde ?? new Date(Date.now() - JANELA_DA_CAIXA_DIAS * 86_400_000).toISOString();
  const recebidas = await porta.mensagensPara(eu.slug, minhas.map((g) => g.id), inicio, limite);
  const lidas = await porta.lidas(eu.slug, recebidas.map((m) => m.id));
  return { minhas, recebidas, lidas };
}

// ─── 1) Entrar ──────────────────────────────────────────────────

const entrarSchema = z.object({ operator: z.string().max(40).optional() }).strict();

export async function escritorioEntrar(input: unknown, ctx: AuthContext, porta: PortaDoEscritorio = portaDoBanco()) {
  const p = entrarSchema.safeParse(input ?? {});
  if (!p.success) throw erroDeEntrada(p.error);
  const todos = await porta.operadores();
  const eu = await quemChama(ctx, p.data.operator, porta, todos);
  const grupos = await porta.grupos();
  const { minhas, recebidas, lidas } = await caixaDe(eu, grupos, porta, 100);
  const naoLidas = recebidas.filter((m) => !lidas.has(m.id));
  const vivos = todos.filter(ativo);
  const chefe = eu.parent_slug ? todos.find((o) => o.slug === eu.parent_slug) ?? null : null;
  const porArea = new Map<string, Operador[]>();
  for (const o of vivos) porArea.set(o.area || 'Sem área', [...(porArea.get(o.area || 'Sem área') ?? []), o]);
  return {
    voce: {
      ...cartao(eu),
      escopo: eu.scope ?? null,
      status: eu.status,
      responde_a: chefe ? { slug: chefe.slug, nome: chefe.display_name } : grauDe(eu) === 'orquestrador' ? { slug: DONO, nome: 'Almir (dono)' } : null,
      equipe: vivos.filter((o) => o.parent_slug === eu.slug).map((o) => ({ slug: o.slug, nome: o.display_name, funcao: o.role })),
    },
    dono: 'Almir. Só ele aprova mensagem a cliente, gasto, publicação e financeiro.',
    organograma: [...porArea.entries()].sort(([a], [b]) => a.localeCompare(b, 'pt-BR')).map(([area, l]) => ({
      area,
      agentes: l.sort((a, b) => a.display_name.localeCompare(b.display_name, 'pt-BR'))
        .map((o) => ({ slug: o.slug, nome: o.display_name, plataforma: plataformaDe(o), grau: grauDe(o), funcao: corte(o.role, 90) })),
    })),
    regras_da_casa: REGRAS_DA_CASA,
    memoria: ORDEM_DA_MEMORIA,
    skills: { catalogo: 'aceleriq_central_skills', instalar_na_maquina: 'aceleriq_central_instalar', uma_skill: 'aceleriq_central_skill' },
    salas: minhas.map((g) => ({ slug: g.slug, nome: g.nome, nao_lidas: naoLidas.filter((m) => m.grupo_id === g.id).length })),
    nao_lidas: { total: naoLidas.length, mensagens: naoLidas.slice(0, 10).map((m) => mostrar(m, grupos, false, false)) },
    proximo_passo: naoLidas.length
      ? 'Leia com aceleriq_escritorio_caixa, responda o que for seu com aceleriq_escritorio_enviar (com conversa_id) e marque com aceleriq_escritorio_marcar_lida.'
      : 'Nada para ler. Siga o seu trabalho e bata presença com aceleriq_escritorio_presenca dizendo o que está fazendo.',
    guia: 'aceleriq_guia traz o mapa do painel e o manual de cada ferramenta.',
  };
}

// ─── 2) Diretório ───────────────────────────────────────────────

const diretorioSchema = z.object({
  plataforma: z.enum(PLATAFORMAS).optional(),
  area: z.string().max(60).optional(),
  grau: z.enum(['orquestrador', 'coordenador', 'executor', 'leitor']).optional(),
  busca: z.string().max(80).optional(),
  incluir_inativos: z.boolean().optional(),
  automacoes: z.boolean().optional(),
}).strict();

export async function escritorioDiretorio(input: unknown, _ctx: AuthContext, porta: PortaDoEscritorio = portaDoBanco()) {
  const p = diretorioSchema.safeParse(input ?? {});
  if (!p.success) throw erroDeEntrada(p.error);
  const f = p.data;
  const [todos, presencas] = await Promise.all([porta.operadores(), porta.presencas()]);
  const batimento = new Map(presencas.map((x) => [x.operator_slug, x]));
  const busca = sem_acento(f.busca);
  const lista = todos.filter((o) =>
    (f.incluir_inativos || ativo(o))
    && (!f.plataforma || plataformaDe(o) === f.plataforma)
    && (!f.area || sem_acento(o.area) === sem_acento(f.area))
    && (!f.grau || grauDe(o) === f.grau)
    && (!busca || sem_acento(`${o.slug} ${o.display_name} ${o.role} ${o.area ?? ''}`).includes(busca)));
  const agentes = lista.sort((a, b) => (a.area ?? '').localeCompare(b.area ?? '', 'pt-BR') || a.display_name.localeCompare(b.display_name, 'pt-BR')).map((o) => {
    const pr = batimento.get(o.slug);
    const agora = presencaFresca(pr?.batimento_em);
    const coord = donoDaArea(o, todos);
    return {
      ...cartao(o),
      status: o.status,
      responde_a: o.parent_slug ?? null,
      dono_da_area: grauDe(o) === 'coordenador' || grauDe(o) === 'orquestrador' ? o.slug : coord?.slug ?? null,
      ultima_atividade: ultimaAtividade(o.last_run_at, pr?.batimento_em),
      agora,
      ...(agora && pr?.fazendo ? { fazendo: pr.fazendo } : {}),
      como_falar: ativo(o) ? `aceleriq_escritorio_enviar para="${o.slug}". ${ENTREGA_POR_PLATAFORMA[plataformaDe(o)] ?? ''}`.trim() : 'Fora de operação: fale com o dono da área.',
    };
  });
  const porPlataforma: Record<string, number> = {};
  for (const a of agentes) porPlataforma[a.plataforma] = (porPlataforma[a.plataforma] ?? 0) + 1;
  return {
    total: agentes.length,
    por_plataforma: porPlataforma,
    agentes,
    funcoes_repetidas: funcoesRepetidas(todos),
    ...(f.automacoes ? {
      automacoes: (await porta.automacoes()).map((a) => ({
        plataforma: a.plataforma, ref: a.ref, nome: a.nome, o_que_faz: a.o_que_faz, dono: a.dono_slug, ligada: a.ativo,
        ultima_execucao: a.ultima_execucao_em, ultimo_status: a.ultimo_status, ...(a.ultimo_erro ? { ultimo_erro: a.ultimo_erro, ultimo_erro_em: a.ultimo_erro_em } : {}),
        execucoes: a.execucoes, erros: a.erros,
      })),
    } : {}),
    como_usar: 'Fale com o dono da área, não com todos. Agente fora de operação não recebe mensagem. Com automacoes:true vêm os workflows (n8n) e os donos.',
  };
}

// ─── 3) Enviar ──────────────────────────────────────────────────

const enviarSchema = z.object({
  operator: z.string().max(40).optional(),
  para: z.string().max(40).optional(),
  grupo: z.string().max(40).optional(),
  texto: z.string().min(1).max(4000),
  conversa_id: z.string().regex(UUID).optional(),
  responde_a: z.string().regex(UUID).optional(),
  assunto: z.string().max(160).optional(),
  client_id: z.string().regex(UUID).optional(),
  task_id: z.string().regex(UUID).optional(),
  idempotency_key: z.string().min(8).max(128),
}).strict();

export async function escritorioEnviar(input: unknown, ctx: AuthContext, porta: PortaDoEscritorio = portaDoBanco()) {
  const p = enviarSchema.safeParse(input ?? {});
  if (!p.success) throw erroDeEntrada(p.error);
  const d = p.data;
  const texto = d.texto.trim();
  if (!texto) throw new ErroDaFerramenta('entrada_invalida', 'texto vazio.', null, false);
  const todos = await porta.operadores();
  const eu = await quemChama(ctx, d.operator, porta, todos);

  const ja = await porta.mensagemPorChave(eu.slug, d.idempotency_key);
  if (ja) return { ok: true, repetida: true, mensagem_id: ja.id, conversa_id: ja.conversa_id, aviso: 'Esta mensagem já tinha sido registrada com a mesma idempotency_key. Nada foi enviado de novo.' };

  if (pareceTerSegredo(texto) || pareceTerSegredo(d.assunto)) {
    throw new ErroDaFerramenta('tem_segredo', 'A mensagem parece ter senha, token ou chave. Nada foi registrado.',
      'Segredo não passa pelo Escritório. Para login use aceleriq_acesso_usar; para pedir acesso ao dono, aceleriq_acesso_pedir.', false);
  }
  if (d.client_id) assertClientAccess(ctx, d.client_id);

  const grupos = await porta.grupos();
  const conversaAtual = d.conversa_id ? await porta.conversa(d.conversa_id) : null;
  if (d.conversa_id && !conversaAtual) throw new ErroDaFerramenta('nao_encontrado', 'conversa_id não existe.', 'Copie o conversa_id de aceleriq_escritorio_caixa.', false);

  let para: string | null = slugDe(d.para) || null;
  let grupo: Grupo | null = null;
  if (conversaAtual?.tipo === 'grupo') {
    grupo = grupos.find((g) => g.id === conversaAtual.grupo_id) ?? null;
    if (!grupo) throw new ErroDaFerramenta('sala_fechada', 'A sala desta conversa não existe mais.', 'aceleriq_escritorio_grupos lista as salas abertas.', false);
    para = null;
  } else if (!conversaAtual && d.grupo) {
    grupo = grupos.find((g) => g.slug === slugDe(d.grupo)) ?? null;
    if (!grupo) throw new ErroDaFerramenta('nao_encontrado', `A sala "${d.grupo}" não existe.`, `Salas: ${grupos.filter((g) => g.ativo).map((g) => g.slug).join(', ')}.`, false);
    if (para) throw new ErroDaFerramenta('entrada_invalida', 'Use para (um agente) ou grupo (uma sala), não os dois.', null, false);
  }

  const historico = conversaAtual ? await porta.mensagensDaUnidade({ task_id: d.task_id ?? conversaAtual.task_id, conversa_id: conversaAtual.id })
    : d.task_id ? await porta.mensagensDaUnidade({ task_id: d.task_id, conversa_id: '' }) : [];

  if (grupo) {
    recusar(podeEscreverNaSala(eu, grupo));
  } else {
    // Resposta numa conversa direta sem dizer para quem: vai para quem falou por último com este agente.
    if (!para && conversaAtual) {
      const ultima = [...historico].reverse().find((m) => m.conversa_id === conversaAtual.id && m.de_slug !== eu.slug);
      para = ultima?.de_slug ?? null;
    }
    if (!para) throw new ErroDaFerramenta('entrada_invalida', 'Diga para quem: para (slug de um agente ou "dono") ou grupo (uma sala).', 'aceleriq_escritorio_diretorio mostra quem é quem.', false);
    const destino = para === DONO ? DONO : todos.find((o) => o.slug === para);
    if (!destino) throw new ErroDaFerramenta('nao_encontrado', `"${para}" não está no cadastro de agentes.`, 'Confira o slug em aceleriq_escritorio_diretorio.', false);
    const respondendo = !!conversaAtual && historico.some((m) => m.conversa_id === conversaAtual.id && m.de_slug === para && (m.para_slug === eu.slug || m.grupo_id !== null));
    if (conversaAtual && !historico.some((m) => m.conversa_id === conversaAtual.id && (m.de_slug === eu.slug || m.para_slug === eu.slug)) && grauDe(eu) !== 'orquestrador') {
      throw new ErroDaFerramenta('conversa_de_outros', 'Você não participa desta conversa.', 'Abra uma conversa nova: mande sem conversa_id.', false);
    }
    recusar(podeFalarCom(eu, destino, todos, respondendo));
  }
  recusar(cabeMaisUma(historico, para === DONO));

  const freio = await porta.taxa(`escritorio:${principalDaChamada(ctx)}`, ENVIOS_POR_MINUTO);
  if (!freio.ok) throw new ErroDaFerramenta('limite_de_envio', `Muitas mensagens em pouco tempo; espere ${freio.esperar_seg} s.`, `Esta credencial envia até ${ENVIOS_POR_MINUTO} mensagens por minuto.`, true);

  const conversa = conversaAtual ?? await porta.criarConversa({
    tipo: grupo ? 'grupo' : 'direta', grupo_id: grupo?.id ?? null, assunto: d.assunto?.trim() || null,
    client_id: d.client_id ?? null, task_id: d.task_id ?? null, criada_por: eu.slug,
  });
  const m = await porta.gravarMensagem({
    conversa_id: conversa.id, de_slug: eu.slug, de_tipo: 'operador', para_slug: grupo ? null : para, grupo_id: grupo?.id ?? null,
    corpo: texto, responde_a: d.responde_a ?? null, client_id: d.client_id ?? conversa.client_id ?? null,
    task_id: d.task_id ?? conversa.task_id ?? null, idempotency_key: d.idempotency_key,
  });
  if (ctx.resultRefHolder) ctx.resultRefHolder.value = `escritorio_mensagens:${m.id}`;
  const destinoOp = para && para !== DONO ? todos.find((o) => o.slug === para) : null;
  const restam = para === DONO ? null : Math.max(0, MAXIMO_ENTRE_BOTS - (contarEntreBots(historico) + 1));
  return {
    ok: true,
    mensagem_id: m.id,
    conversa_id: conversa.id,
    para: grupo ? `sala ${grupo.slug}` : para,
    entrega: grupo ? 'Os membros da sala leem na caixa de cada um.' : para === DONO ? 'O dono lê no painel, em Escritório, Conversas.' : ENTREGA_POR_PLATAFORMA[plataformaDe(destinoOp ?? { origem: null })] ?? 'O agente lê na caixa dele.',
    ...(restam === null ? {} : { mensagens_entre_bots_que_ainda_cabem: restam }),
  };
}

// ─── 4) Caixa ───────────────────────────────────────────────────

const caixaSchema = z.object({
  operator: z.string().max(40).optional(),
  so_nao_lidas: z.boolean().optional(),
  conversa_id: z.string().regex(UUID).optional(),
  desde: z.string().max(40).optional(),
  limite: z.number().int().min(1).max(100).optional(),
}).strict();

export async function escritorioCaixa(input: unknown, ctx: AuthContext, porta: PortaDoEscritorio = portaDoBanco()) {
  const p = caixaSchema.safeParse(input ?? {});
  if (!p.success) throw erroDeEntrada(p.error);
  const d = p.data;
  const todos = await porta.operadores();
  const eu = await quemChama(ctx, d.operator, porta, todos);
  const grupos = await porta.grupos();
  const limite = d.limite ?? 30;

  if (d.conversa_id) {
    const conversa = await porta.conversa(d.conversa_id);
    if (!conversa) throw new ErroDaFerramenta('nao_encontrado', 'conversa_id não existe.', null, false);
    const fio = await porta.mensagensDaConversa(conversa.id, limite);
    const naSala = conversa.grupo_id ? grupos.some((g) => g.id === conversa.grupo_id && g.membros.some((x) => x.operator_slug === eu.slug)) : false;
    const participa = naSala || fio.some((m) => m.de_slug === eu.slug || m.para_slug === eu.slug);
    if (!participa && grauDe(eu) !== 'orquestrador' && !ehAdmin(ctx)) {
      throw new ErroDaFerramenta('conversa_de_outros', 'Você não participa desta conversa.', 'Só quem participa, os orquestradores e o dono leem uma conversa.', false);
    }
    const lidas = await porta.lidas(eu.slug, fio.map((m) => m.id));
    return {
      conversa: { id: conversa.id, tipo: conversa.tipo, assunto: conversa.assunto, sala: grupos.find((g) => g.id === conversa.grupo_id)?.slug ?? null, client_id: conversa.client_id, task_id: conversa.task_id },
      mensagens: fio.map((m) => mostrar(m, grupos, m.de_slug === eu.slug || lidas.has(m.id))),
      como_responder: `aceleriq_escritorio_enviar com conversa_id="${conversa.id}".`,
    };
  }

  let desde: string | undefined;
  if (d.desde) {
    const t = Date.parse(d.desde);
    if (!Number.isFinite(t)) throw new ErroDaFerramenta('entrada_invalida', 'desde inválido: use uma data ISO.', null, false);
    desde = new Date(t).toISOString();
  }
  const { recebidas, lidas } = await caixaDe(eu, grupos, porta, 100, desde);
  const soNaoLidas = d.so_nao_lidas !== false;
  const escolhidas = recebidas.filter((m) => !soNaoLidas || !lidas.has(m.id)).slice(0, limite);
  return {
    de_quem_e_a_caixa: eu.slug,
    nao_lidas: recebidas.filter((m) => !lidas.has(m.id)).length,
    mensagens: escolhidas.map((m) => mostrar(m, grupos, lidas.has(m.id))),
    como_usar: 'Responda só o que é seu, com conversa_id. Depois marque com aceleriq_escritorio_marcar_lida. Para ver um fio inteiro, passe conversa_id aqui.',
  };
}

// ─── 5) Marcar lida ─────────────────────────────────────────────

const marcarSchema = z.object({
  operator: z.string().max(40).optional(),
  mensagem_ids: z.array(z.string().regex(UUID)).min(1).max(100).optional(),
  conversa_id: z.string().regex(UUID).optional(),
}).strict().refine((v) => !!v.mensagem_ids || !!v.conversa_id, { message: 'passe mensagem_ids ou conversa_id' });

export async function escritorioMarcarLida(input: unknown, ctx: AuthContext, porta: PortaDoEscritorio = portaDoBanco()) {
  const p = marcarSchema.safeParse(input ?? {});
  if (!p.success) throw erroDeEntrada(p.error);
  const eu = await quemChama(ctx, p.data.operator, porta);
  const grupos = await porta.grupos();
  // Só marca o que é dele: mensagem recebida direto ou numa sala em que está.
  const { recebidas } = await caixaDe(eu, grupos, porta, 100);
  const pedidas = new Set(p.data.mensagem_ids ?? []);
  const minhas = recebidas.filter((m) => (p.data.conversa_id ? m.conversa_id === p.data.conversa_id : pedidas.has(m.id)));
  const marcadas = await porta.marcarLidas(eu.slug, minhas.map((m) => m.id));
  return { ok: true, marcadas, ...(pedidas.size && marcadas < pedidas.size ? { aviso: 'Parte dos ids não é mensagem recebida por você e foi ignorada.' } : {}) };
}

// ─── 6) Salas ───────────────────────────────────────────────────

const gruposSchema = z.object({
  operator: z.string().max(40).optional(),
  grupo: z.string().max(40).optional(),
  limite: z.number().int().min(1).max(100).optional(),
}).strict();

export async function escritorioGrupos(input: unknown, ctx: AuthContext, porta: PortaDoEscritorio = portaDoBanco()) {
  const p = gruposSchema.safeParse(input ?? {});
  if (!p.success) throw erroDeEntrada(p.error);
  const todos = await porta.operadores();
  const eu = await quemChama(ctx, p.data.operator, porta, todos);
  const grupos = (await porta.grupos()).filter((g) => g.ativo);
  const nome = new Map(todos.map((o) => [o.slug, o]));
  const sala = (g: Grupo) => ({
    slug: g.slug, nome: g.nome, area: g.area ?? null, descricao: g.descricao ?? null,
    voce_participa: g.membros.some((x) => x.operator_slug === eu.slug),
    membros: g.membros.map((x) => ({ slug: x.operator_slug, nome: nome.get(x.operator_slug)?.display_name ?? x.operator_slug, plataforma: plataformaDe(nome.get(x.operator_slug) ?? { origem: null }), papel: x.papel })),
  });
  if (!p.data.grupo) {
    return { salas: grupos.map(sala), como_usar: 'Para ler o histórico, passe grupo. Para escrever: aceleriq_escritorio_enviar com grupo. Só o dono põe ou tira membro.' };
  }
  const g = grupos.find((x) => x.slug === slugDe(p.data.grupo));
  if (!g) throw new ErroDaFerramenta('nao_encontrado', `A sala "${p.data.grupo}" não existe.`, `Salas: ${grupos.map((x) => x.slug).join(', ')}.`, false);
  if (!g.membros.some((x) => x.operator_slug === eu.slug) && grauDe(eu) !== 'orquestrador' && !ehAdmin(ctx)) {
    throw new ErroDaFerramenta('fora_da_sala', `"${eu.slug}" não é membro da sala "${g.slug}".`, 'Só membros, orquestradores e o dono leem o histórico de uma sala.', false);
  }
  const desde = new Date(Date.now() - JANELA_DA_CAIXA_DIAS * 86_400_000).toISOString();
  // "Para ninguém": só as mensagens da sala, inclusive as do próprio agente.
  const historico = (await porta.mensagensPara('-', [g.id], desde, p.data.limite ?? 30)).reverse();
  return { sala: sala(g), mensagens: historico.map((m) => mostrar(m, grupos)) };
}

// ─── 7) Presença ────────────────────────────────────────────────

const presencaSchema = z.object({
  operator: z.string().max(40).optional(),
  fazendo: z.string().max(240).optional(),
  client_id: z.string().regex(UUID).optional(),
  task_id: z.string().regex(UUID).optional(),
}).strict();

export async function escritorioPresenca(input: unknown, ctx: AuthContext, porta: PortaDoEscritorio = portaDoBanco()) {
  const p = presencaSchema.safeParse(input ?? {});
  if (!p.success) throw erroDeEntrada(p.error);
  const eu = await quemChama(ctx, p.data.operator, porta);
  if (!ativo(eu)) throw new ErroDaFerramenta('agente_parado', `"${eu.slug}" não está ativo no Escritório.`, 'Só o dono reativa um agente.', false);
  const fazendo = p.data.fazendo?.trim() || null;
  if (pareceTerSegredo(fazendo)) throw new ErroDaFerramenta('tem_segredo', 'O texto parece ter senha, token ou chave. Nada foi registrado.', 'Diga só o que está fazendo, sem credencial.', false);
  if (p.data.client_id) assertClientAccess(ctx, p.data.client_id);
  await porta.baterPresenca({ operator_slug: eu.slug, fazendo, plataforma: plataformaDe(eu), client_id: p.data.client_id ?? null, task_id: p.data.task_id ?? null });
  const grupos = await porta.grupos();
  const { recebidas, lidas } = await caixaDe(eu, grupos, porta, 100);
  const naoLidas = recebidas.filter((m) => !lidas.has(m.id)).length;
  return { ok: true, quem: eu.slug, nao_lidas: naoLidas, ...(naoLidas ? { proximo_passo: 'Há mensagem para você: aceleriq_escritorio_caixa.' } : {}) };
}

// ─── 8) Automação avisa que rodou ───────────────────────────────

const automacaoSchema = z.object({
  ref: z.string().min(1).max(120),
  evento: z.enum(['cadastro', 'ok', 'erro', 'rodando']),
  plataforma: z.enum(['n8n', 'hermes', 'paperclip', 'outro']).optional(),
  nome: z.string().min(2).max(160).optional(),
  o_que_faz: z.string().max(400).optional(),
  dono: z.string().max(40).optional(),
  ligada: z.boolean().optional(),
  erro: z.string().max(2000).optional(),
}).strict();

export async function escritorioAutomacao(input: unknown, ctx: AuthContext, porta: PortaDoEscritorio = portaDoBanco()) {
  const p = automacaoSchema.safeParse(input ?? {});
  if (!p.success) throw erroDeEntrada(p.error);
  const d = p.data;
  const plataforma = d.plataforma ?? 'n8n';
  const dono = slugDe(d.dono) || null;
  if (dono && !SLUG.test(dono)) throw new ErroDaFerramenta('entrada_invalida', 'dono inválido: use o slug de um agente.', null, false);
  const atual = (await porta.automacoes()).find((a) => a.plataforma === plataforma && a.ref === d.ref) ?? null;
  if (!atual && !d.nome) throw new ErroDaFerramenta('entrada_invalida', 'Primeiro aviso desta automação: mande também nome.', 'Ex.: evento="cadastro", nome="Clientes: aviso de post no ar".', false);
  if (pareceTerSegredo(d.nome) || pareceTerSegredo(d.o_que_faz)) throw new ErroDaFerramenta('tem_segredo', 'O nome ou a descrição parece ter senha, token ou chave.', null, false);
  const agora = new Date().toISOString();
  const rodou = d.evento === 'ok' || d.evento === 'erro';
  const nova: Automacao = {
    plataforma,
    ref: d.ref,
    nome: d.nome ?? atual!.nome,
    o_que_faz: d.o_que_faz ?? atual?.o_que_faz ?? null,
    dono_slug: dono ?? atual?.dono_slug ?? null,
    ativo: d.ligada ?? atual?.ativo ?? true,
    ultima_execucao_em: d.evento === 'cadastro' ? atual?.ultima_execucao_em ?? null : agora,
    ultimo_status: d.evento === 'cadastro' ? atual?.ultimo_status ?? null : d.evento,
    ultimo_erro: d.evento === 'erro' ? corte(tirarSegredos(d.erro ?? 'falhou sem mensagem'), 600) : atual?.ultimo_erro ?? null,
    ultimo_erro_em: d.evento === 'erro' ? agora : atual?.ultimo_erro_em ?? null,
    execucoes: (atual?.execucoes ?? 0) + (rodou ? 1 : 0),
    erros: (atual?.erros ?? 0) + (d.evento === 'erro' ? 1 : 0),
  };
  await porta.gravarAutomacao(nova);
  if (ctx.resultRefHolder) ctx.resultRefHolder.value = `escritorio_automacoes:${plataforma}:${d.ref}`;
  return { ok: true, automacao: { plataforma, ref: d.ref, nome: nova.nome, dono: nova.dono_slug, ultimo_status: nova.ultimo_status, execucoes: nova.execucoes, erros: nova.erros }, ...(nova.dono_slug ? {} : { aviso: 'Esta automação ainda não tem dono. O dono da casa escolhe no painel (Escritório, Automações).' }) };
}

// ─── As ferramentas ─────────────────────────────────────────────

const OPERATOR = { type: 'string', description: 'O seu slug de agente. Sem ele vale o agente padrão desta credencial.' } as const;
const ID = (d: string) => ({ type: 'string', format: 'uuid', description: d }) as const;

export const FERRAMENTAS_DO_ESCRITORIO: readonly ToolDefinition[] = [
  {
    name: 'aceleriq_escritorio_entrar',
    title: 'Escritório: entrar',
    description:
      'Só leitura. A porta de entrada de qualquer agente, de qualquer plataforma: chame ao começar a sessão. Devolve quem você é (slug, plataforma, função, grau, escopo, a quem responde, equipe), o organograma por área, as regras da casa, a ordem de leitura da memória, onde estão as skills, as suas salas e as mensagens não lidas. A credencial só entra como os agentes ligados a ela.',
    scopes: ['aceleriq:read'],
    annotations: LEITURA,
    inputSchema: { type: 'object', additionalProperties: false, properties: { operator: OPERATOR } },
    handler: (input, ctx) => escritorioEntrar(input, ctx),
  },
  {
    name: 'aceleriq_escritorio_diretorio',
    title: 'Escritório: quem é quem',
    description:
      'Só leitura. Todos os agentes de todas as plataformas (Hermes, Grok, OpenBot, Paperclip, Claude Code, Codex, ChatGPT, n8n): função, área, grau, dono da área, status, última atividade, o que está fazendo agora e como falar com cada um. Traz também funcoes_repetidas (dois agentes ativos com a mesma área e o mesmo papel) e, com automacoes:true, os workflows com dono, última execução e último erro.',
    scopes: ['aceleriq:read'],
    annotations: LEITURA,
    cacheSeg: 20,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        plataforma: { type: 'string', enum: [...PLATAFORMAS] },
        area: { type: 'string' },
        grau: { type: 'string', enum: ['orquestrador', 'coordenador', 'executor', 'leitor'] },
        busca: { type: 'string', description: 'Texto no nome, slug, função ou área.' },
        incluir_inativos: { type: 'boolean', description: 'true mostra também pausados e aposentados.' },
        automacoes: { type: 'boolean', description: 'true inclui os workflows.' },
      },
    },
    handler: (input, ctx) => escritorioDiretorio(input, ctx),
  },
  {
    name: 'aceleriq_escritorio_enviar',
    title: 'Escritório: mandar mensagem a um agente ou sala',
    description:
      'Manda mensagem a outro agente (para), a uma sala (grupo) ou responde numa conversa (conversa_id). O servidor trava: cada credencial assina só pelos próprios agentes; grau e área decidem com quem você fala (orquestrador com todos; coordenador com a própria área e os orquestradores; executor e leitor com o coordenador e as salas dele; responder a quem falou com você sempre pode); no máximo 2 mensagens entre agentes por tarefa (a terceira é recusada: use o diário ou peça decisão ao dono); texto com cara de senha, token ou chave é recusado. Não fala com cliente, não gasta e não publica. Repetir com a mesma idempotency_key não duplica.',
    scopes: ['aceleriq:write'],
    annotations: ESCRITA,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['texto', 'idempotency_key'],
      properties: {
        operator: OPERATOR,
        para: { type: 'string', description: 'Slug do agente, ou "dono" (só orquestrador e coordenador, ou em resposta a ele).' },
        grupo: { type: 'string', description: 'Slug da sala (coordenacao, conteudo, trafego, comercial, video, tecnologia).' },
        texto: { type: 'string', minLength: 1, maxLength: 4000, description: 'Curto e com o pedido claro. Sem segredo.' },
        conversa_id: ID('Para responder num fio que já existe.'),
        responde_a: ID('A mensagem que esta responde (opcional).'),
        assunto: { type: 'string', maxLength: 160, description: 'Só ao abrir conversa nova.' },
        client_id: ID('Cliente a que a conversa se refere (opcional).'),
        task_id: ID('Tarefa do Kanban a que a conversa se refere (opcional; o limite de 2 mensagens conta por tarefa).'),
        idempotency_key: { type: 'string', minLength: 8, maxLength: 128, description: 'Chave única desta mensagem, ex.: "<slug>:<assunto>:<data>".' },
      },
    },
    handler: (input, ctx) => escritorioEnviar(input, ctx),
  },
  {
    name: 'aceleriq_escritorio_caixa',
    title: 'Escritório: caixa de entrada',
    description:
      'Só leitura. As mensagens que chegaram para você, diretas e das suas salas (padrão: só as não lidas, mais novas primeiro). Com conversa_id, traz o fio inteiro daquela conversa. Cada credencial lê só a caixa dos agentes ligados a ela.',
    scopes: ['aceleriq:read'],
    annotations: LEITURA,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        operator: OPERATOR,
        so_nao_lidas: { type: 'boolean', description: 'Padrão true.' },
        conversa_id: ID('Lê o fio inteiro desta conversa.'),
        desde: { type: 'string', description: 'Data ISO: só o que chegou depois.' },
        limite: { type: 'integer', minimum: 1, maximum: 100, description: 'Padrão 30.' },
      },
    },
    handler: (input, ctx) => escritorioCaixa(input, ctx),
  },
  {
    name: 'aceleriq_escritorio_marcar_lida',
    title: 'Escritório: marcar como lida',
    description:
      'Marca como lidas mensagens que você recebeu: por mensagem_ids ou todas as de uma conversa (conversa_id). Só vale para o que chegou para você; o resto é ignorado. Repetir não muda nada.',
    scopes: ['aceleriq:write'],
    annotations: ESCRITA,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        operator: OPERATOR,
        mensagem_ids: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'string', format: 'uuid' } },
        conversa_id: ID('Marca todas as que você recebeu nesta conversa.'),
      },
    },
    handler: (input, ctx) => escritorioMarcarLida(input, ctx),
  },
  {
    name: 'aceleriq_escritorio_grupos',
    title: 'Escritório: salas por área',
    description:
      'Só leitura. As salas do Escritório (Coordenação, Conteúdo, Tráfego, Comercial, Vídeo, Tecnologia) com os membros de cada uma. Com grupo, traz o histórico da sala (só membros, orquestradores e o dono). Quem põe ou tira membro é o dono, pelo painel.',
    scopes: ['aceleriq:read'],
    annotations: LEITURA,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        operator: OPERATOR,
        grupo: { type: 'string', description: 'Slug da sala, para ler o histórico.' },
        limite: { type: 'integer', minimum: 1, maximum: 100, description: 'Padrão 30.' },
      },
    },
    handler: (input, ctx) => escritorioGrupos(input, ctx),
  },
  {
    name: 'aceleriq_escritorio_presenca',
    title: 'Escritório: bater presença',
    description:
      'Batimento do agente: registra que você está no ar e, em uma linha, o que está fazendo agora (sem segredo). Devolve quantas mensagens não lidas você tem, então serve também para saber se há algo para ler sem abrir a caixa. Bata ao começar um trabalho e a cada troca de tarefa, não em laço.',
    scopes: ['aceleriq:write'],
    annotations: ESCRITA,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        operator: OPERATOR,
        fazendo: { type: 'string', maxLength: 240, description: 'Uma linha: o que você está fazendo agora.' },
        client_id: ID('Cliente em que está trabalhando (opcional).'),
        task_id: ID('Tarefa do Kanban em que está trabalhando (opcional).'),
      },
    },
    handler: (input, ctx) => escritorioPresenca(input, ctx),
  },
  {
    name: 'aceleriq_escritorio_automacao',
    title: 'Escritório: automação avisa que rodou',
    description:
      'Para workflows (n8n e outros): registra a automação no diretório do Escritório e avisa cada execução. evento "cadastro" só cadastra ou atualiza nome, descrição, dono e se está ligada; "ok" e "erro" contam a execução (o texto do erro tem segredos retirados); "rodando" marca o começo. Não liga nem desliga workflow: isso é do dono.',
    scopes: ['aceleriq:write'],
    annotations: ESCRITA,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['ref', 'evento'],
      properties: {
        ref: { type: 'string', maxLength: 120, description: 'Identificador estável (o id do workflow).' },
        evento: { type: 'string', enum: ['cadastro', 'ok', 'erro', 'rodando'] },
        plataforma: { type: 'string', enum: ['n8n', 'hermes', 'paperclip', 'outro'], description: 'Padrão n8n.' },
        nome: { type: 'string', maxLength: 160, description: 'Obrigatório no primeiro aviso.' },
        o_que_faz: { type: 'string', maxLength: 400 },
        dono: { type: 'string', description: 'Slug do agente dono da automação.' },
        ligada: { type: 'boolean' },
        erro: { type: 'string', maxLength: 2000, description: 'Só com evento "erro".' },
      },
    },
    handler: (input, ctx) => escritorioAutomacao(input, ctx),
  },
];
