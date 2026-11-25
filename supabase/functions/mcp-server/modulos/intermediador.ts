/**
 * MCP 2.39.0 (25/11/2026): Intermediador dos grupos de cliente.
 *
 * Qualquer agente, de qualquer plataforma, pede com aceleriq_intermediador_pedir: cliente, tema, pergunta,
 * quem marcar, o que conta como resposta. O processo do VPS (/opt/aceleriq-intermediador) chama
 * aceleriq_intermediador_rodada a cada minuto: o servidor escuta só a pessoa marcada (ou quem citou a
 * pergunta) nas mensagens que o leitor dos grupos já grava, julga com o Jev, decide pelo código e devolve
 * os textos a enviar; o VPS envia pela ponte do 3429 (ou, em prévia, ao dono) e confirma com
 * aceleriq_intermediador_envio_feito. Ao fechar, a resposta estruturada volta ao agente pelo Escritório.
 *
 * Travas que não dependem do agente: um assunto aberto por grupo; no máximo 3 mensagens ao cliente por
 * assunto; pergunta e lembrete só em dia útil, 8h às 19h; texto escrito na hora no contexto do cliente e conferido
 * pelo Jev antes de sair (2.39.1, intermediador-escrita.ts); pergunta com
 * termo interno, cobrança, link ou segredo é recusada; o número de quem é marcado nunca sai do servidor.
 */

import { z } from 'https://esm.sh/zod@3.23.8';
import type { ToolDefinition } from '../../_shared/mcp-tools.ts';
import { assertClientAccess, type AuthContext } from '../../_shared/mcp-auth.ts';
import { db } from '../../_shared/aceleriq-read-services.ts';
import { jevPerguntar, type PerguntaJev, probabilidadeNoul, type ResultadoJev } from '../../_shared/jev.ts';
import { ErroDaFerramenta } from './robustez.ts';
import { portaDoBanco as portaDoEscritorio, quemChama as quemChamaNoEscritorio } from './escritorio.ts';
import { DONO, pareceTerSegredo, grauDe } from './escritorio-regras.ts';
import {
  ASSUNTOS_POR_CLIENTE_POR_DIA,
  combinarNotas,
  conteudoDe,
  CORTE,
  decidir,
  emHorario,
  escolherPessoa,
  ESTADOS_ABERTOS,
  INTERVALO_ENTRE_ASSUNTOS_MIN,
  lerNotas,
  MAXIMO_AO_CLIENTE,
  type Notas,
  ouvida,
  perguntaProibida,
  perguntasAoJev,
  precisaDeMediana,
} from './intermediador-regras.ts';
import { comPessoa, limparTexto, MARCA, pedidoAoEscritor, perguntasDoTexto, problemaDoTexto, type TipoDeTexto } from './intermediador-escrita.ts';
import { escolhaDoModelo, escreverComModeloDaCentral } from '../../_shared/modelo-da-central.ts';
import { lerDossie } from '../../_shared/contexto-cliente.ts';

export const SLUG_DO_INTERMEDIADOR = 'intermediador';
const QUEM_RODA = new Set([SLUG_DO_INTERMEDIADOR, 'default']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEITURA = { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false };
const ESCRITA = { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: false };
const ENVIA = { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: true };

// ─── Tipos ──────────────────────────────────────────────────────

export interface Ouvida { id: string; quem: string; como: 'marcada' | 'citou'; tipo: string; texto: string; em: string }
export interface Assunto {
  id: string; client_id: string; group_id: string; grupo_nome: string; tema: string; pergunta: string;
  marcar_numero: string; marcar_nome: string | null; o_que_conta: string[]; pode_perguntar_de_volta: boolean;
  prazo_horas: number; pedido_por: string; responder_para: string; idempotency_key: string; estado: string;
  pergunta_msg_id: string | null; perguntado_em: string | null; vence_em: string | null; lido_ate: string | null;
  envios_ao_cliente: number; perguntou_de_volta: boolean; itens: Record<string, unknown>; ouvidas: Ouvida[];
  resposta: Record<string, unknown> | null; motivo: string | null; devolvido_em: string | null; fechado_em: string | null;
  criado_em: string;
}
export interface Envio {
  id: string; assunto_id: string; tipo: string; destino: 'grupo' | 'dono'; texto: string; texto_previa: string;
  mencoes: string[]; estado: string; message_id: string | null; criado_em: string; feito_em: string | null;
}
export interface Pessoa { numero: string; nome: string | null; mensagens: number }
export interface MsgGrupo {
  id: string; remetente: string | null; remetente_nome: string | null; papel: string | null; tipo: string | null;
  texto: string | null; transcricao: string | null; transcricao_status: string | null; descricao_midia: string | null;
  resposta_a: string | null; occurred_at: string; received_at: string;
}
type NovoAssunto = Pick<Assunto, 'client_id' | 'group_id' | 'grupo_nome' | 'tema' | 'pergunta' | 'marcar_numero' | 'marcar_nome' | 'o_que_conta' | 'pode_perguntar_de_volta' | 'prazo_horas' | 'pedido_por' | 'responder_para' | 'idempotency_key'>;

export interface PortaDoIntermediador {
  agora(): number;
  quemChama(ctx: AuthContext, operator?: string): Promise<{ slug: string; grau: string }>;
  operadorExiste(slug: string): Promise<boolean>;
  grupoDoCliente(clientId: string): Promise<{ group_id: string; rotulo: string } | null>;
  pessoasDoGrupo(clientId: string): Promise<Pessoa[]>;
  mensagens(groupId: string, desde: string): Promise<MsgGrupo[]>;
  assunto(id: string): Promise<Assunto | null>;
  assuntoPorChave(chave: string): Promise<Assunto | null>;
  assuntos(f: { estados?: readonly string[]; client_id?: string; de?: string; limite?: number }): Promise<Assunto[]>;
  criarAssunto(a: NovoAssunto): Promise<Assunto>;
  /** Muda só se o estado atual estiver em `seEstado` (evita duas rodadas pisarem uma na outra). */
  atualizarAssunto(id: string, patch: Partial<Assunto>, seEstado?: readonly string[]): Promise<Assunto | null>;
  envios(f: { assunto_id?: string; estado?: string }): Promise<Envio[]>;
  envio(id: string): Promise<Envio | null>;
  criarEnvio(e: Pick<Envio, 'assunto_id' | 'tipo' | 'destino' | 'texto' | 'texto_previa' | 'mencoes'>): Promise<Envio | null>;
  atualizarEnvio(id: string, patch: Partial<Envio>, seEstado?: string): Promise<Envio | null>;
  ultimoEnvioNoGrupo(groupId: string): Promise<string | null>;
  evento(assuntoId: string | null, tipo: string, dados?: Record<string, unknown>): Promise<void>;
  devolver(a: Assunto, texto: string): Promise<string | null>;
  jev(state: unknown, questions: Record<string, PerguntaJev>): Promise<ResultadoJev>;
  /** Nome e dossiê do cliente para o escritor. */
  contextoDoCliente(clientId: string): Promise<{ nome: string; dossie: string | null }>;
  /** O motor de escrita do painel. null = nenhum modelo respondeu. */
  escrever(p: { clientId: string; sistema: string; usuario: string; assuntoId: string }): Promise<string | null>;
  ultimoEvento(assuntoId: string, tipo: string): Promise<string | null>;
}

// ─── A porta para o banco ───────────────────────────────────────

const COL_ASSUNTO = 'id, client_id, group_id, grupo_nome, tema, pergunta, marcar_numero, marcar_nome, o_que_conta, pode_perguntar_de_volta, prazo_horas, pedido_por, responder_para, idempotency_key, estado, pergunta_msg_id, perguntado_em, vence_em, lido_ate, envios_ao_cliente, perguntou_de_volta, itens, ouvidas, resposta, motivo, devolvido_em, fechado_em, criado_em';
const COL_ENVIO = 'id, assunto_id, tipo, destino, texto, texto_previa, mencoes, estado, message_id, criado_em, feito_em';

function falhou(onde: string, error: { code?: string; message?: string } | null): never {
  console.error('[mcp intermediador]', onde, { code: error?.code });
  if (error?.code === '42P01' || error?.code === 'PGRST205' || error?.code === 'PGRST202') {
    throw new ErroDaFerramenta('intermediador_nao_instalado', 'O Intermediador ainda não foi instalado neste banco.', 'Falta aplicar a migration 20261125120000_intermediador_dos_grupos.', false);
  }
  throw new ErroDaFerramenta('falha_no_banco', `O Intermediador não respondeu agora (${onde}).`, 'Tente de novo em instantes.', true);
}

export function portaDoBanco(): PortaDoIntermediador {
  const b = db();
  const esc = portaDoEscritorio();
  return {
    agora: () => Date.now(),
    async quemChama(ctx, operator) {
      const eu = await quemChamaNoEscritorio(ctx, operator, esc);
      return { slug: eu.slug, grau: grauDe(eu) };
    },
    async operadorExiste(slug) {
      if (slug === DONO) return true;
      return (await esc.operadores()).some((o) => o.slug === slug && o.status !== 'archived' && o.status !== 'retired');
    },
    async grupoDoCliente(clientId) {
      const { data, error } = await b.rpc('intermediador_grupo_do_cliente', { p_client_id: clientId });
      if (error) falhou('grupo do cliente', error);
      const g = (data ?? [])[0] as { group_id: string; rotulo: string } | undefined;
      return g ?? null;
    },
    async pessoasDoGrupo(clientId) {
      const { data, error } = await b.rpc('intermediador_pessoas_do_grupo', { p_client_id: clientId });
      if (error) falhou('pessoas do grupo', error);
      return ((data ?? []) as { numero: string; nome: string | null; mensagens: number }[]).map((p) => ({ numero: p.numero, nome: p.nome, mensagens: Number(p.mensagens) }));
    },
    async mensagens(groupId, desde) {
      const { data, error } = await b.rpc('intermediador_mensagens', { p_group_id: groupId, p_desde: desde });
      if (error) falhou('mensagens do grupo', error);
      return (data ?? []) as MsgGrupo[];
    },
    async assunto(id) {
      const { data, error } = await b.from('intermediador_assuntos').select(COL_ASSUNTO).eq('id', id).maybeSingle();
      if (error) falhou('assunto', error);
      return (data as Assunto) ?? null;
    },
    async assuntoPorChave(chave) {
      const { data, error } = await b.from('intermediador_assuntos').select(COL_ASSUNTO).eq('idempotency_key', chave).maybeSingle();
      if (error) falhou('assunto', error);
      return (data as Assunto) ?? null;
    },
    async assuntos(f) {
      let q = b.from('intermediador_assuntos').select(COL_ASSUNTO).order('criado_em', { ascending: true }).limit(f.limite ?? 100);
      if (f.estados) q = q.in('estado', [...f.estados]);
      if (f.client_id) q = q.eq('client_id', f.client_id);
      if (f.de) q = q.or(`pedido_por.eq.${f.de},responder_para.eq.${f.de}`);
      const { data, error } = await q;
      if (error) falhou('assuntos', error);
      return (data ?? []) as Assunto[];
    },
    async criarAssunto(a) {
      const { data, error } = await b.from('intermediador_assuntos').insert(a).select(COL_ASSUNTO).single();
      if (error) falhou('criar assunto', error);
      return data as Assunto;
    },
    async atualizarAssunto(id, patch, seEstado) {
      let q = b.from('intermediador_assuntos').update({ ...patch, atualizado_em: new Date().toISOString() }).eq('id', id);
      if (seEstado) q = q.in('estado', [...seEstado]);
      const { data, error } = await q.select(COL_ASSUNTO).maybeSingle();
      if (error?.code === '23505') return null; // outro assunto já abriu no grupo
      if (error) falhou('atualizar assunto', error);
      return (data as Assunto) ?? null;
    },
    async envios(f) {
      let q = b.from('intermediador_envios').select(COL_ENVIO).order('criado_em', { ascending: true }).limit(50);
      if (f.assunto_id) q = q.eq('assunto_id', f.assunto_id);
      if (f.estado) q = q.eq('estado', f.estado);
      const { data, error } = await q;
      if (error) falhou('envios', error);
      return (data ?? []) as Envio[];
    },
    async envio(id) {
      const { data, error } = await b.from('intermediador_envios').select(COL_ENVIO).eq('id', id).maybeSingle();
      if (error) falhou('envio', error);
      return (data as Envio) ?? null;
    },
    async criarEnvio(e) {
      const { data, error } = await b.from('intermediador_envios').insert(e).select(COL_ENVIO).single();
      if (error?.code === '23505') return null; // esse tipo já saiu neste assunto
      if (error) falhou('criar envio', error);
      return data as Envio;
    },
    async atualizarEnvio(id, patch, seEstado) {
      let q = b.from('intermediador_envios').update(patch).eq('id', id);
      if (seEstado) q = q.eq('estado', seEstado);
      const { data, error } = await q.select(COL_ENVIO).maybeSingle();
      if (error) falhou('atualizar envio', error);
      return (data as Envio) ?? null;
    },
    async ultimoEnvioNoGrupo(groupId) {
      const { data: ids, error: e1 } = await b.from('intermediador_assuntos').select('id').eq('group_id', groupId).order('criado_em', { ascending: false }).limit(20);
      if (e1) falhou('último envio', e1);
      const lista = (ids ?? []).map((x: { id: string }) => x.id);
      if (!lista.length) return null;
      const { data, error } = await b.from('intermediador_envios').select('criado_em').in('assunto_id', lista).eq('destino', 'grupo')
        .neq('estado', 'cancelado').order('criado_em', { ascending: false }).limit(1);
      if (error) falhou('último envio', error);
      return (data?.[0] as { criado_em: string } | undefined)?.criado_em ?? null;
    },
    async evento(assuntoId, tipo, dados = {}) {
      const { error } = await b.from('intermediador_eventos').insert({ assunto_id: assuntoId, tipo, dados });
      if (error) console.error('[mcp intermediador] evento', { code: error.code });
    },
    async devolver(a, texto) {
      const chave = `intermediador:${a.id}:${a.estado}`;
      const ja = await esc.mensagemPorChave(SLUG_DO_INTERMEDIADOR, chave);
      if (ja) return ja.id;
      const conversa = await esc.criarConversa({
        tipo: 'direta', grupo_id: null, assunto: `Cliente: ${a.tema}`.slice(0, 160), client_id: a.client_id, task_id: null, criada_por: SLUG_DO_INTERMEDIADOR,
      });
      const m = await esc.gravarMensagem({
        conversa_id: conversa.id, de_slug: SLUG_DO_INTERMEDIADOR, de_tipo: 'operador', para_slug: a.responder_para, grupo_id: null,
        corpo: texto, responde_a: null, client_id: a.client_id, task_id: null, idempotency_key: chave,
      });
      return m.id;
    },
    jev: (state, questions) => jevPerguntar({ state, questions }),
    async contextoDoCliente(clientId) {
      const [{ data }, dossie] = await Promise.all([
        b.from('profiles').select('company_name, full_name').eq('id', clientId).maybeSingle(),
        lerDossie(b as unknown as Parameters<typeof lerDossie>[0], clientId, 2500).catch(() => null),
      ]);
      const p = data as { company_name: string | null; full_name: string | null } | null;
      return { nome: p?.company_name || p?.full_name || 'cliente', dossie };
    },
    async escrever(p) {
      const r = await escreverComModeloDaCentral({
        clientId: p.clientId, sistema: p.sistema, usuario: p.usuario, escolha: escolhaDoModelo(undefined, undefined),
        temperatura: 0.6, maxTokensSaida: 600, criadoPor: null, referencia: { tipo: 'intermediador_assunto', id: p.assuntoId },
      }).catch((e) => {
        console.error('[mcp intermediador] escrever', { erro: e instanceof Error ? e.message.slice(0, 80) : 'erro' });
        return null;
      });
      return r?.texto?.trim() || null;
    },
    async ultimoEvento(assuntoId, tipo) {
      const { data, error } = await b.from('intermediador_eventos').select('em').eq('assunto_id', assuntoId).eq('tipo', tipo).order('em', { ascending: false }).limit(1);
      if (error) return null;
      return (data?.[0] as { em: string } | undefined)?.em ?? null;
    },
  };
}

// ─── Auxiliares ─────────────────────────────────────────────────

const erroDeEntrada = (e: z.ZodError) =>
  new ErroDaFerramenta('entrada_invalida', `Entrada inválida: ${e.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`).join('; ')}`, null, false);
const iso = (ms: number) => new Date(ms).toISOString();
const ehAdmin = (ctx: AuthContext) => ctx.scopes.includes('admin');
const primeiroNome = (n: string | null) => (n ?? '').trim().split(/\s+/)[0] || 'a pessoa marcada';
const virgula = (x: number) => x.toFixed(2).replace('.', ',');

/** O que o agente vê do assunto: nunca o número de quem foi marcado. */
export function mostrarAssunto(a: Assunto) {
  return {
    assunto_id: a.id, estado: a.estado, client_id: a.client_id, grupo: a.grupo_nome, tema: a.tema, pergunta: a.pergunta,
    marcado: primeiroNome(a.marcar_nome), o_que_conta: a.o_que_conta, pedido_por: a.pedido_por, responder_para: a.responder_para,
    perguntado_em: a.perguntado_em, vence_em: a.vence_em, mensagens_ao_cliente: a.envios_ao_cliente,
    ouvidas: a.ouvidas.map((o) => ({ como: o.como, tipo: o.tipo, texto: o.texto, em: o.em })),
    ...(a.resposta ? { resposta: a.resposta } : {}), ...(a.motivo ? { motivo: a.motivo } : {}), fechado_em: a.fechado_em,
  };
}

function respostaEstruturada(a: Assunto, n: Notas | null, estado: string) {
  return {
    estado,
    tema: a.tema,
    pergunta: a.pergunta,
    quem_respondeu: a.ouvidas.length ? `${primeiroNome(a.ouvidas[a.ouvidas.length - 1].quem)} (cliente)` : null,
    o_que_o_cliente_disse: a.ouvidas.map((o) => ({ mensagem_id: o.id, como: o.como, tipo: o.tipo, texto: o.texto, em: o.em })),
    itens: a.o_que_conta.map((item, i) => ({ item, coberto: n ? n.itens[i] >= CORTE : false, nota: n ? Number(n.itens[i].toFixed(2)) : null })),
    ...(n ? { nota_relacao: n.relacao, nota_precisa_de_humano: Number(n.humano.toFixed(2)) } : {}),
  };
}

function textoDaDevolucao(a: Assunto, r: ReturnType<typeof respostaEstruturada>) {
  const titulo: Record<string, string> = {
    respondido: 'respondeu', respondido_em_parte: 'respondeu em parte', vencido: 'não respondeu no prazo',
    precisa_do_almir: 'pediu algo que é do Almir',
  };
  const linhas = [r.estado === 'previa'
    ? `${a.grupo_nome}: em prévia, a pergunta sobre "${a.tema}" foi só ao WhatsApp do Almir; nada saiu no grupo.`
    : `${a.grupo_nome}: o cliente ${titulo[r.estado] ?? r.estado} sobre "${a.tema}".`];
  if (r.o_que_o_cliente_disse.length) linhas.push('', 'O que disse:', ...r.o_que_o_cliente_disse.map((o) => `- ${o.texto}`));
  if (r.o_que_o_cliente_disse.length) linhas.push('', 'Itens:', ...r.itens.map((i) => `- ${i.item}: ${i.coberto ? 'respondido' : 'faltou'}${i.nota === null ? '' : ` (${virgula(i.nota)})`}`));
  if (a.motivo) linhas.push('', `Motivo: ${a.motivo}`);
  linhas.push('', `Detalhe: aceleriq_intermediador_estado assunto_id="${a.id}".`);
  return linhas.join('\n').slice(0, 3900);
}

// ─── 1) Pedir ───────────────────────────────────────────────────

const pedirSchema = z.object({
  operator: z.string().max(40).optional(),
  client_id: z.string().regex(UUID),
  tema: z.string().trim().min(3).max(120),
  pergunta: z.string().trim().min(8).max(400),
  marcar: z.string().max(80).optional(),
  o_que_conta: z.array(z.string().trim().min(2).max(120)).min(1).max(4),
  pode_perguntar_de_volta: z.boolean().optional(),
  prazo_horas: z.number().int().min(2).max(72).optional(),
  responder_para: z.string().max(40).optional(),
  idempotency_key: z.string().min(8).max(128),
}).strict();

export async function intermediadorPedir(input: unknown, ctx: AuthContext, porta: PortaDoIntermediador = portaDoBanco()) {
  const p = pedirSchema.safeParse(input ?? {});
  if (!p.success) throw erroDeEntrada(p.error);
  const d = p.data;
  const eu = await porta.quemChama(ctx, d.operator);
  assertClientAccess(ctx, d.client_id);

  const ja = await porta.assuntoPorChave(d.idempotency_key);
  if (ja) return { ok: true, repetido: true, ...mostrarAssunto(ja), aviso: 'Este pedido já existia com a mesma idempotency_key. Nada novo foi aberto.' };

  for (const t of [d.tema, d.pergunta, ...d.o_que_conta]) {
    if (pareceTerSegredo(t)) throw new ErroDaFerramenta('tem_segredo', 'O pedido parece ter senha, token ou chave. Nada foi aberto.', null, false);
    const motivo = perguntaProibida(t);
    if (motivo) {
      const dica: Record<string, string> = {
        termo_interno: 'Escreva como para o cliente: sem nome de agente, ferramenta ou termo interno.',
        assunto_do_almir: 'Cobrança, contrato, desconto e orçamento são com o Almir: use aceleriq_marcar_precisa_de_voce.',
        travessao: 'Troque o travessão por vírgula ou ponto.',
        link: 'Sem link na pergunta; descreva a peça pelo nome.',
      };
      throw new ErroDaFerramenta(`pergunta_recusada_${motivo}`, `A pergunta não pode sair assim (${motivo}).`, dica[motivo] ?? null, false);
    }
  }

  const responder = (d.responder_para ?? eu.slug).trim().toLowerCase();
  if (!(await porta.operadorExiste(responder))) throw new ErroDaFerramenta('nao_encontrado', `"${responder}" não está no cadastro de agentes.`, 'Confira em aceleriq_escritorio_diretorio.', false);

  const grupo = await porta.grupoDoCliente(d.client_id);
  if (!grupo) throw new ErroDaFerramenta('sem_grupo', 'Este cliente não tem grupo de WhatsApp lido pela Aceleriq.', 'O intermediador só pergunta em grupo que o leitor dos grupos já lê. Peça ao Almir para liberar o grupo.', false);
  const pessoas = await porta.pessoasDoGrupo(d.client_id);
  const pessoa = escolherPessoa(pessoas, d.marcar);
  if (!pessoa) {
    const nomes = pessoas.map((x) => primeiroNome(x.nome)).filter((n, i, l) => l.indexOf(n) === i).slice(0, 8);
    throw new ErroDaFerramenta('sem_pessoa', d.marcar ? `Ninguém do cliente chamado "${d.marcar}" falou no grupo nos últimos 60 dias.` : 'Ninguém do cliente falou no grupo nos últimos 60 dias.',
      nomes.length ? `Quem fala no grupo: ${nomes.join(', ')}. Use marcar com um desses nomes, ou "dono".` : 'Sem pessoa conhecida não dá para marcar ninguém.', false);
  }

  const a = await porta.criarAssunto({
    client_id: d.client_id, group_id: grupo.group_id, grupo_nome: grupo.rotulo, tema: d.tema, pergunta: d.pergunta,
    marcar_numero: pessoa.numero, marcar_nome: pessoa.nome, o_que_conta: d.o_que_conta,
    pode_perguntar_de_volta: d.pode_perguntar_de_volta ?? true, prazo_horas: d.prazo_horas ?? 24,
    pedido_por: eu.slug, responder_para: responder, idempotency_key: d.idempotency_key,
  });
  await porta.evento(a.id, 'pedido', { por: eu.slug });
  if (ctx.resultRefHolder) ctx.resultRefHolder.value = `intermediador_assuntos:${a.id}`;
  const fila = (await porta.assuntos({ estados: ['na_fila', ...ESTADOS_ABERTOS] })).filter((x) => x.group_id === a.group_id && x.id !== a.id);
  return {
    ok: true,
    ...mostrarAssunto(a),
    na_frente: fila.length,
    como_acompanhar: 'A resposta chega na sua caixa do Escritório (aceleriq_escritorio_caixa). O estado a qualquer hora: aceleriq_intermediador_estado.',
    quando: 'Pergunta nova sai em dia útil, das 8h às 19h, quando o grupo estiver livre.',
  };
}

// ─── 2) Estado ──────────────────────────────────────────────────

const estadoSchema = z.object({
  operator: z.string().max(40).optional(),
  assunto_id: z.string().regex(UUID).optional(),
  client_id: z.string().regex(UUID).optional(),
  abertos: z.boolean().optional(),
  limite: z.number().int().min(1).max(50).optional(),
}).strict();

export async function intermediadorEstado(input: unknown, ctx: AuthContext, porta: PortaDoIntermediador = portaDoBanco()) {
  const p = estadoSchema.safeParse(input ?? {});
  if (!p.success) throw erroDeEntrada(p.error);
  const d = p.data;
  const eu = await porta.quemChama(ctx, d.operator);
  const veTudo = ehAdmin(ctx) || eu.grau === 'orquestrador' || QUEM_RODA.has(eu.slug);
  const pode = (a: Assunto) => veTudo || a.pedido_por === eu.slug || a.responder_para === eu.slug;
  if (d.assunto_id) {
    const a = await porta.assunto(d.assunto_id);
    if (!a || !pode(a)) throw new ErroDaFerramenta('nao_encontrado', 'Assunto não encontrado para você.', 'Só quem pediu, quem recebe a resposta e os orquestradores veem o assunto.', false);
    assertClientAccess(ctx, a.client_id);
    return mostrarAssunto(a);
  }
  if (d.client_id) assertClientAccess(ctx, d.client_id);
  const lista = (await porta.assuntos({ estados: d.abertos ? ['na_fila', ...ESTADOS_ABERTOS] : undefined, client_id: d.client_id, de: veTudo ? undefined : eu.slug, limite: 200 }))
    .filter(pode).reverse().slice(0, d.limite ?? 20);
  return { assuntos: lista.map(mostrarAssunto) };
}

// ─── 3) Cancelar ────────────────────────────────────────────────

const cancelarSchema = z.object({ operator: z.string().max(40).optional(), assunto_id: z.string().regex(UUID), motivo: z.string().trim().min(3).max(200) }).strict();

export async function intermediadorCancelar(input: unknown, ctx: AuthContext, porta: PortaDoIntermediador = portaDoBanco()) {
  const p = cancelarSchema.safeParse(input ?? {});
  if (!p.success) throw erroDeEntrada(p.error);
  const eu = await porta.quemChama(ctx, p.data.operator);
  const a = await porta.assunto(p.data.assunto_id);
  if (!a) throw new ErroDaFerramenta('nao_encontrado', 'Assunto não encontrado.', null, false);
  if (a.pedido_por !== eu.slug && !ehAdmin(ctx) && eu.grau !== 'orquestrador') throw new ErroDaFerramenta('nao_e_seu', 'Só quem pediu (ou um orquestrador) cancela.', null, false);
  const abertos = ['na_fila', ...ESTADOS_ABERTOS];
  const feito = await porta.atualizarAssunto(a.id, { estado: 'cancelado', motivo: p.data.motivo, fechado_em: iso(porta.agora()) }, abertos);
  if (!feito) return { ok: true, ja_fechado: true, estado: a.estado };
  for (const e of await porta.envios({ assunto_id: a.id, estado: 'pendente' })) await porta.atualizarEnvio(e.id, { estado: 'cancelado' }, 'pendente');
  await porta.evento(a.id, 'cancelado', { por: eu.slug });
  return { ok: true, estado: 'cancelado', aviso: a.estado === 'na_fila' ? 'Nada tinha saído no grupo.' : 'A pergunta já tinha saído no grupo; o que o cliente responder agora não será ouvido.' };
}

// ─── 4) Rodada (só o processo do VPS) ───────────────────────────

const rodadaSchema = z.object({ operator: z.string().max(40).optional(), modo: z.enum(['previa', 'grupos']) }).strict();

async function exigirQuemRoda(ctx: AuthContext, operator: string | undefined, porta: PortaDoIntermediador) {
  const eu = await porta.quemChama(ctx, operator);
  if (!QUEM_RODA.has(eu.slug) && !ehAdmin(ctx)) throw new ErroDaFerramenta('so_o_processo', 'Só o processo do intermediador (VPS) roda esta ferramenta.', 'Para pedir algo ao cliente use aceleriq_intermediador_pedir.', false);
  return eu;
}

async function julgar(porta: PortaDoIntermediador, a: Assunto, ouvidas: Ouvida[], quantasNovas: number): Promise<Notas> {
  const state = {
    tema: a.tema,
    pergunta_feita: a.pergunta,
    pontos_pedidos: a.o_que_conta,
    mensagens_do_cliente: ouvidas.map((o, i) => ({ n: i + 1, nova: i >= ouvidas.length - quantasNovas, como: o.como === 'citou' ? 'citou a pergunta' : 'pessoa marcada', tipo: o.tipo, texto: o.texto })),
  };
  const q = perguntasAoJev(a.o_que_conta);
  const primeira = lerNotas(await porta.jev(state, q), a.o_que_conta.length);
  if (!precisaDeMediana(primeira)) return primeira;
  const mais = await Promise.all([porta.jev(state, q), porta.jev(state, q)]);
  return combinarNotas([primeira, ...mais.map((r) => lerNotas(r, a.o_que_conta.length))]);
}

const quemFalou = (m: MsgGrupo, a: Assunto) =>
  m.papel === 'bot' ? 'Aceleriq (aviso automático)'
    : String(m.papel ?? '').startsWith('agencia') ? 'Almir (agência)'
    : `${primeiroNome(m.remetente_nome)}${m.remetente === a.marcar_numero ? ' (pessoa marcada)' : ''} (cliente)`;

/** Escreve o texto no contexto (escritor do painel), limpa e confere com o Jev; até 2 tentativas. */
export async function escreverTexto(porta: PortaDoIntermediador, a: Assunto, tipo: TipoDeTexto, falta?: string | null): Promise<{ texto: string } | { motivo: string }> {
  const agora = porta.agora();
  const [ctx, recentes] = await Promise.all([
    porta.contextoDoCliente(a.client_id),
    porta.mensagens(a.group_id, iso(agora - 3 * 86_400_000)),
  ]);
  const conversa = recentes.slice(-14).map((m) => `${quemFalou(m, a)}: ${conteudoDe(m).slice(0, 280)}`);
  const nome = a.marcar_nome ? primeiroNome(a.marcar_nome) : null;
  let corrigir: string | null = null;
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const pedido = pedidoAoEscritor({
      tipo, cliente: ctx.nome, primeiro_nome: nome, tema: a.tema, pergunta: a.pergunta, o_que_conta: a.o_que_conta,
      falta: falta ?? null, ja_disse: a.ouvidas.map((o) => o.texto), conversa_recente: conversa, contexto: ctx.dossie, corrigir,
    });
    const bruto = await porta.escrever({ clientId: a.client_id, sistema: pedido.sistema, usuario: pedido.usuario, assuntoId: a.id });
    if (!bruto) return { motivo: 'o escritor do painel não respondeu' };
    const limpo = limparTexto(bruto, tipo);
    if (limpo.problema) {
      corrigir = limpo.problema;
      await porta.evento(a.id, 'texto_conferido', { tipo, tentativa, problema: limpo.problema });
      continue;
    }
    let notas: Record<string, number>;
    try {
      const q = perguntasDoTexto(tipo, a.o_que_conta, falta);
      const mensagem = limpo.texto.split(MARCA).join(`@${nome ?? 'pessoa'}`);
      const r = await porta.jev({ mensagem, contexto: ctx.dossie ?? '', conversa_recente: conversa, pedido: { tema: a.tema, pergunta: a.pergunta, pontos: a.o_que_conta } }, q);
      notas = Object.fromEntries(Object.keys(q).map((k) => [k, probabilidadeNoul(r.answers[k]) ?? (k === 'promete' ? 1 : 0)]));
    } catch {
      return { motivo: 'o Jev não conferiu o texto agora' };
    }
    const problema = problemaDoTexto(notas);
    await porta.evento(a.id, 'texto_conferido', { tipo, tentativa, notas, problema });
    if (!problema) return { texto: limpo.texto };
    corrigir = problema;
  }
  return { motivo: `texto recusado duas vezes (${corrigir})` };
}

async function enviarAoGrupo(porta: PortaDoIntermediador, a: Assunto, tipo: TipoDeTexto, falta?: string | null): Promise<{ a: Assunto; ok: boolean }> {
  if (a.envios_ao_cliente >= MAXIMO_AO_CLIENTE) {
    await porta.evento(a.id, 'limite_de_mensagens', { tipo });
    return { a, ok: false };
  }
  const escrito = await escreverTexto(porta, a, tipo, falta);
  if ('motivo' in escrito) {
    await porta.evento(a.id, 'texto_segurado', { tipo, motivo: escrito.motivo });
    return { a, ok: false };
  }
  const t = comPessoa(escrito.texto, a.marcar_numero, a.marcar_nome);
  const e = await porta.criarEnvio({ assunto_id: a.id, tipo, destino: 'grupo', texto: t.texto, texto_previa: t.texto_previa, mencoes: t.mencoes });
  if (!e) return { a, ok: false };
  return { a: (await porta.atualizarAssunto(a.id, { envios_ao_cliente: a.envios_ao_cliente + 1 })) ?? a, ok: true };
}

async function avisarDono(porta: PortaDoIntermediador, a: Assunto, motivo: string) {
  const texto = `Intermediador · ${a.grupo_nome}\n${motivo}\n\nTema: ${a.tema}\nPergunta: ${a.pergunta}\nQuem pediu: ${a.pedido_por}`.slice(0, 1500);
  await porta.criarEnvio({ assunto_id: a.id, tipo: 'aviso_dono', destino: 'dono', texto, texto_previa: texto, mencoes: [] });
}

async function finalizar(porta: PortaDoIntermediador, a: Assunto, estado: string, n: Notas | null, motivo: string | null) {
  const agora = iso(porta.agora());
  const base = { ...a, estado, motivo };
  const resposta = respostaEstruturada(base, n, estado);
  const fechado = await porta.atualizarAssunto(a.id, { estado, motivo, resposta, fechado_em: agora }, ['na_fila', ...ESTADOS_ABERTOS]);
  if (!fechado) return null;
  const msg = await porta.devolver(fechado, textoDaDevolucao(fechado, resposta));
  await porta.atualizarAssunto(a.id, { devolvido_em: agora });
  await porta.evento(a.id, 'fechado', { estado, devolvido: msg });
  return fechado;
}

/** Um assunto que está esperando resposta: escuta, julga, decide. Devolve o que fez (para o resumo). */
export async function cuidarDoAssunto(porta: PortaDoIntermediador, a0: Assunto): Promise<string> {
  let a = a0;
  const agora = porta.agora();
  if (a.vence_em && agora >= Date.parse(a.vence_em)) {
    await avisarDono(porta, a, `O cliente não respondeu em ${a.prazo_horas} h.`);
    await finalizar(porta, a, 'vencido', null, 'sem resposta no prazo');
    return 'vencido';
  }
  const nossos = new Set((await porta.envios({ assunto_id: a.id })).filter((e) => e.destino === 'grupo' && e.message_id).map((e) => e.message_id as string));
  if (a.pergunta_msg_id) nossos.add(a.pergunta_msg_id);
  const desde = a.lido_ate ?? a.perguntado_em ?? a.criado_em;
  const msgs = await porta.mensagens(a.group_id, desde);
  const perguntadoMs = a.perguntado_em ? Date.parse(a.perguntado_em) : 0;
  const novas: Ouvida[] = [];
  let ignoradas = 0;
  for (const m of msgs) {
    if (Date.parse(m.occurred_at) < perguntadoMs - 5_000) continue;
    if (nossos.has(m.id)) continue;
    const como = ouvida(m, a, nossos);
    if (!como) { ignoradas++; continue; }
    novas.push({ id: m.id, quem: m.remetente_nome ?? a.marcar_nome ?? 'cliente', como, tipo: m.tipo ?? 'texto', texto: conteudoDe(m), em: m.occurred_at });
  }
  const lidoAte = msgs.length ? msgs[msgs.length - 1].received_at : a.lido_ate;
  if (ignoradas) await porta.evento(a.id, 'ignoradas', { quantas: ignoradas });

  if (!novas.length) {
    const metade = perguntadoMs + (a.prazo_horas * 3_600_000) / 2;
    if (lidoAte !== a.lido_ate) a = (await porta.atualizarAssunto(a.id, { lido_ate: lidoAte })) ?? a;
    if (a.estado === 'esperando' && !a.perguntou_de_volta && agora >= metade && emHorario('lembrete', agora) && a.envios_ao_cliente + 2 <= MAXIMO_AO_CLIENTE) {
      const r = await enviarAoGrupo(porta, a, 'lembrete');
      if (!r.ok) return 'lembrete_segurado';
      await porta.atualizarAssunto(a.id, { estado: 'lembrado' }, ['esperando']);
      return 'lembrete';
    }
    return 'nada_novo';
  }

  const ouvidas = [...a.ouvidas, ...novas];
  let n: Notas;
  try {
    n = await julgar(porta, a, ouvidas, novas.length);
  } catch (err) {
    // Sem nota não decide nada e não avança a leitura: a próxima rodada tenta de novo.
    await porta.evento(a.id, 'jev_falhou', { erro: err instanceof Error ? err.message.slice(0, 120) : 'erro' });
    return 'jev_falhou';
  }
  const d = decidir(a, n);
  // Fora do horário de responder: não grava nada; a mesma mensagem é julgada de novo dentro do horário.
  if (!emHorario('fechamento', agora) && d.acao !== 'esperar') return 'fora_do_horario';
  a = (await porta.atualizarAssunto(a.id, { ouvidas, lido_ate: lidoAte, itens: Object.fromEntries(a.o_que_conta.map((it, i) => [it, Number(n.itens[i].toFixed(2))])) })) ?? { ...a, ouvidas };
  await porta.evento(a.id, 'julgado', { notas: n, acao: d.acao, novas: novas.length });
  switch (d.acao) {
    case 'fechar':
    case 'fechar_parcial':
      a = (await enviarAoGrupo(porta, a, 'fechamento')).a;
      await finalizar(porta, a, d.acao === 'fechar' ? 'respondido' : 'respondido_em_parte', n, d.acao === 'fechar' ? null : `faltou: ${d.faltam.join('; ')}`);
      return d.acao;
    case 'de_volta':
      {
        const r = await enviarAoGrupo(porta, a, 'de_volta', d.item as string);
        if (!r.ok) {
          // Sem texto bom para a de volta: fecha com o que veio, em vez de deixar o cliente sem retorno.
          a = (await enviarAoGrupo(porta, r.a, 'fechamento')).a;
          await finalizar(porta, a, 'respondido_em_parte', n, `faltou: ${d.faltam.join('; ')}`);
          return 'fechar_parcial';
        }
        await porta.atualizarAssunto(a.id, { perguntou_de_volta: true });
      }
      return 'de_volta';
    case 'humano':
      a = (await enviarAoGrupo(porta, a, 'humano')).a;
      await avisarDono(porta, a, `O cliente pediu algo que é seu:\n"${novas.map((o) => o.texto).join(' ').slice(0, 600)}"`);
      await finalizar(porta, a, 'precisa_do_almir', n, 'o cliente pediu decisão, preço, prazo ou reclamou');
      return 'humano';
    case 'quem_e':
      if (a.envios_ao_cliente + 2 <= MAXIMO_AO_CLIENTE) await enviarAoGrupo(porta, a, 'quem_e');
      return 'quem_e';
    default:
      return 'esperar';
  }
}

export async function intermediadorRodada(input: unknown, ctx: AuthContext, porta: PortaDoIntermediador = portaDoBanco()) {
  const p = rodadaSchema.safeParse(input ?? {});
  if (!p.success) throw erroDeEntrada(p.error);
  await exigirQuemRoda(ctx, p.data.operator, porta);
  const agora = porta.agora();
  const feito: Record<string, number> = {};
  const conta = (k: string) => { feito[k] = (feito[k] ?? 0) + 1; };

  // 1) Quem está esperando resposta.
  for (const a of await porta.assuntos({ estados: ['esperando', 'lembrado'] })) conta(await cuidarDoAssunto(porta, a));

  // 2) Fila: abre o próximo de cada grupo livre.
  const abertos = await porta.assuntos({ estados: ESTADOS_ABERTOS });
  const ocupados = new Set(abertos.map((a) => a.group_id));
  const fila = await porta.assuntos({ estados: ['na_fila'] });
  const hojeSP = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(agora));
  const doDia = (await porta.assuntos({ estados: ['perguntando', 'esperando', 'lembrado', 'respondido', 'respondido_em_parte', 'vencido', 'precisa_do_almir', 'previa'], limite: 500 }))
    .filter((a) => a.perguntado_em && new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(a.perguntado_em)) === hojeSP);
  for (const a of fila) {
    // Pedido que nunca saiu da fila também vence (fila parada não pode virar promessa eterna).
    if (agora - Date.parse(a.criado_em) > (a.prazo_horas + 48) * 3_600_000) {
      await finalizar(porta, a, 'vencido', null, 'ficou na fila sem horário livre no grupo');
      conta('vencido_na_fila');
      continue;
    }
    if (ocupados.has(a.group_id) || !emHorario('pergunta', agora)) continue;
    if (doDia.filter((x) => x.client_id === a.client_id).length >= ASSUNTOS_POR_CLIENTE_POR_DIA) continue;
    const ultimo = await porta.ultimoEnvioNoGrupo(a.group_id);
    if (ultimo && agora - Date.parse(ultimo) < INTERVALO_ENTRE_ASSUNTOS_MIN * 60_000) continue;
    // Escrita que falhou há pouco espera 15 min (IA sem crédito não pode virar uma chamada por minuto).
    const segurado = await porta.ultimoEvento(a.id, 'texto_segurado');
    if (segurado && agora - Date.parse(segurado) < 15 * 60_000) continue;
    const aberto = await porta.atualizarAssunto(a.id, { estado: 'perguntando' }, ['na_fila']);
    if (!aberto) continue;
    const r = await enviarAoGrupo(porta, aberto, 'pergunta');
    if (!r.ok) {
      await porta.atualizarAssunto(a.id, { estado: 'na_fila' }, ['perguntando']);
      conta('pergunta_segurada');
      continue;
    }
    ocupados.add(a.group_id);
    await porta.evento(a.id, 'perguntando', {});
    conta('pergunta');
  }

  // 3) O que o VPS precisa mandar agora.
  const pendentes = await porta.envios({ estado: 'pendente' });
  const porId = new Map<string, Assunto>();
  const envios = [];
  for (const e of pendentes) {
    const a = porId.get(e.assunto_id) ?? await porta.assunto(e.assunto_id);
    if (!a) continue;
    porId.set(a.id, a);
    envios.push({
      envio_id: e.id, tipo: e.tipo, destino: e.destino, client_id: a.client_id, chat_id: e.destino === 'grupo' ? a.group_id : null,
      grupo_nome: a.grupo_nome, texto: e.texto, texto_previa: e.texto_previa, mencoes: e.mencoes, criado_em: e.criado_em,
    });
  }
  return { modo: p.data.modo, feito, envios };
}

// ─── 5) Envio feito (só o processo do VPS) ──────────────────────

const envioFeitoSchema = z.object({
  operator: z.string().max(40).optional(),
  envio_id: z.string().regex(UUID),
  resultado: z.enum(['enviado', 'previa', 'incerto']),
  message_id: z.string().min(4).max(128).optional(),
}).strict();

export async function intermediadorEnvioFeito(input: unknown, ctx: AuthContext, porta: PortaDoIntermediador = portaDoBanco()) {
  const p = envioFeitoSchema.safeParse(input ?? {});
  if (!p.success) throw erroDeEntrada(p.error);
  await exigirQuemRoda(ctx, p.data.operator, porta);
  const d = p.data;
  if (d.resultado === 'enviado' && !d.message_id) throw new ErroDaFerramenta('entrada_invalida', 'Envio feito precisa do message_id da ponte.', null, false);
  const agora = porta.agora();
  const e = await porta.atualizarEnvio(d.envio_id, { estado: d.resultado, message_id: d.message_id ?? null, feito_em: iso(agora) }, 'pendente');
  if (!e) return { ok: true, repetido: true, aviso: 'Este envio já tinha sido marcado (ou foi cancelado).' };
  const a = await porta.assunto(e.assunto_id);
  if (!a) return { ok: true };
  await porta.evento(a.id, `envio_${d.resultado}`, { tipo: e.tipo, message_id: d.message_id ?? null });
  if (e.tipo !== 'pergunta' || e.destino !== 'grupo') return { ok: true, estado: a.estado };

  if (d.resultado === 'enviado') {
    const vence = agora + a.prazo_horas * 3_600_000;
    const b = await porta.atualizarAssunto(a.id, { estado: 'esperando', pergunta_msg_id: d.message_id, perguntado_em: iso(agora), vence_em: iso(vence), lido_ate: iso(agora - 90_000) }, ['perguntando']);
    return { ok: true, estado: b?.estado ?? a.estado };
  }
  if (d.resultado === 'previa') {
    await finalizar(porta, a, 'previa', null, 'modo prévia: a pergunta foi só ao WhatsApp do Almir');
    return { ok: true, estado: 'previa' };
  }
  await avisarDono(porta, a, 'A ponte não confirmou se a pergunta saiu no grupo. Não repeti para não duplicar: confira no WhatsApp.');
  await finalizar(porta, a, 'precisa_do_almir', null, 'envio da pergunta incerto');
  return { ok: true, estado: 'precisa_do_almir' };
}

// ─── As ferramentas ─────────────────────────────────────────────

const OPERATOR = { type: 'string', description: 'O seu slug de agente. Sem ele vale o agente padrão desta credencial.' } as const;

export const FERRAMENTAS_DO_INTERMEDIADOR: readonly ToolDefinition[] = [
  {
    name: 'aceleriq_intermediador_pedir',
    title: 'Intermediador: perguntar ao cliente no grupo',
    description:
      'Pede ao Intermediador dos grupos que pergunte algo ao cliente no grupo de WhatsApp dele, marcando a pessoa. A mensagem é escrita na hora, no contexto do cliente e da conversa do grupo, e conferida pelo Jev antes de sair. Ele escuta só a resposta daquele tema (texto, áudio transcrito ou imagem descrita), faz no máximo uma pergunta de volta, agradece e devolve a resposta estruturada na sua caixa do Escritório. Um assunto por grupo de cada vez (os outros esperam na fila); pergunta nova só em dia útil, 8h às 19h; prazo padrão 24 h, com um lembrete. A pergunta é o que o time precisa saber (o assistente reescreve com naturalidade): sem termo interno, sem cobrança, desconto ou contrato (isso é com o Almir), sem link nem travessão. o_que_conta lista os pontos que, respondidos, encerram o assunto. Não promete preço, prazo nem desconto. Repetir com a mesma idempotency_key não abre outro.',
    scopes: ['aceleriq:write'],
    annotations: ESCRITA,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['client_id', 'tema', 'pergunta', 'o_que_conta', 'idempotency_key'],
      properties: {
        operator: OPERATOR,
        client_id: { type: 'string', format: 'uuid', description: 'O cliente (precisa ter grupo lido pela Aceleriq).' },
        tema: { type: 'string', minLength: 3, maxLength: 120, description: 'Curto, como o cliente entende: "horário de fim de ano da loja".' },
        pergunta: { type: 'string', minLength: 8, maxLength: 400, description: 'O que perguntar, do jeito que vai ao cliente.' },
        marcar: { type: 'string', maxLength: 80, description: 'Quem marcar: o primeiro nome de quem fala no grupo, ou "dono" (padrão: quem do cliente mais fala).' },
        o_que_conta: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', minLength: 2, maxLength: 120 }, description: 'Os pontos que precisam vir na resposta, ex.: ["abre ou não dia 24", "horário"].' },
        pode_perguntar_de_volta: { type: 'boolean', description: 'Padrão true: se faltar um ponto, pergunta só ele, uma vez.' },
        prazo_horas: { type: 'integer', minimum: 2, maximum: 72, description: 'Padrão 24. Lembrete na metade; vencido avisa o Almir.' },
        responder_para: { type: 'string', maxLength: 40, description: 'Slug de quem recebe a resposta (padrão: você).' },
        idempotency_key: { type: 'string', minLength: 8, maxLength: 128, description: 'Ex.: "<slug>:<cliente>:<tema>:<data>".' },
      },
    },
    handler: (input, ctx) => intermediadorPedir(input, ctx),
  },
  {
    name: 'aceleriq_intermediador_estado',
    title: 'Intermediador: estado dos pedidos',
    description:
      'Só leitura. Os pedidos ao Intermediador dos grupos: estado (na_fila, perguntando, esperando, lembrado, respondido, respondido_em_parte, vencido, precisa_do_almir, cancelado, previa), o que o cliente disse (com áudio transcrito), os pontos respondidos com a nota do Jev e a resposta estruturada. Com assunto_id traz um; sem ele, os seus mais recentes (abertos:true só os abertos). Nunca mostra o número de ninguém.',
    scopes: ['aceleriq:read'],
    annotations: LEITURA,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        operator: OPERATOR,
        assunto_id: { type: 'string', format: 'uuid' },
        client_id: { type: 'string', format: 'uuid' },
        abertos: { type: 'boolean' },
        limite: { type: 'integer', minimum: 1, maximum: 50 },
      },
    },
    handler: (input, ctx) => intermediadorEstado(input, ctx),
  },
  {
    name: 'aceleriq_intermediador_cancelar',
    title: 'Intermediador: cancelar um pedido',
    description: 'Cancela um pedido seu ao Intermediador que ainda não fechou. Se a pergunta já saiu no grupo, o que o cliente responder depois deixa de ser ouvido. Só quem pediu ou um orquestrador cancela.',
    scopes: ['aceleriq:write'],
    annotations: ESCRITA,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['assunto_id', 'motivo'],
      properties: { operator: OPERATOR, assunto_id: { type: 'string', format: 'uuid' }, motivo: { type: 'string', minLength: 3, maxLength: 200 } },
    },
    handler: (input, ctx) => intermediadorCancelar(input, ctx),
  },
  {
    name: 'aceleriq_intermediador_rodada',
    title: 'Intermediador: rodada (só o processo do VPS)',
    description: 'Uso exclusivo do processo do Intermediador no servidor: escuta as respostas, julga com o Jev, abre o próximo assunto da fila e devolve os textos a enviar. Outros agentes recebem so_o_processo.',
    scopes: ['aceleriq:write'],
    annotations: ENVIA,
    inputSchema: { type: 'object', additionalProperties: false, required: ['modo'], properties: { operator: OPERATOR, modo: { type: 'string', enum: ['previa', 'grupos'] } } },
    handler: (input, ctx) => intermediadorRodada(input, ctx),
  },
  {
    name: 'aceleriq_intermediador_envio_feito',
    title: 'Intermediador: confirmar envio (só o processo do VPS)',
    description: 'Uso exclusivo do processo do Intermediador: marca um envio como enviado (com o message_id da ponte), prévia ou incerto. Envio incerto nunca é repetido.',
    scopes: ['aceleriq:write'],
    annotations: ESCRITA,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['envio_id', 'resultado'],
      properties: { operator: OPERATOR, envio_id: { type: 'string', format: 'uuid' }, resultado: { type: 'string', enum: ['enviado', 'previa', 'incerto'] }, message_id: { type: 'string', minLength: 4, maxLength: 128 } },
    },
    handler: (input, ctx) => intermediadorEnvioFeito(input, ctx),
  },
];
