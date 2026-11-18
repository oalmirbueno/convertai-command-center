/**
 * MCP 2.35.0 (18/11/2026): o dono no Escritório, fora do painel.
 *
 * O app do Hermes mostra o mesmo Escritório do painel. Para o dono ler e escrever dali, existe uma
 * ferramenta só, com escopo próprio (escritorio:write), que nenhum outro escopo concede: nem
 * aceleriq:write, nem o OAuth da equipe. A credencial com esse escopo fica só no servidor do Hermes
 * e é usada por quem está logado no chat. Tudo o que ela grava sai como "dono" (de_tipo humano),
 * assinado pelo dono da credencial.
 *
 * Não fala com cliente, não gasta e não publica: só as tabelas escritorio_*.
 */

import { z } from 'https://esm.sh/zod@3.23.8';
import type { ToolDefinition } from '../../_shared/mcp-tools.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { db } from '../../_shared/aceleriq-read-services.ts';
import { ErroDaFerramenta } from './robustez.ts';
import { DONO, pareceTerSegredo, SLUG } from './escritorio-regras.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COL_MENSAGEM = 'id, conversa_id, de_slug, de_tipo, para_slug, grupo_id, corpo, created_at';

const schema = z.object({
  acao: z.enum(['conversas', 'fio', 'enviar', 'marcar_lidas']),
  conversa_id: z.string().regex(UUID).optional(),
  para: z.string().max(40).optional(),
  grupo: z.string().max(40).optional(),
  texto: z.string().max(4000).optional(),
  assunto: z.string().max(160).optional(),
  idempotency_key: z.string().min(8).max(128).optional(),
  limite: z.number().int().min(1).max(200).optional(),
}).strict();

type Linha = Record<string, unknown>;

function falhou(onde: string, error: { code?: string } | null): never {
  console.error('[mcp escritorio dono]', onde, { code: error?.code });
  throw new ErroDaFerramenta('falha_no_banco', `O Escritório não respondeu agora (${onde}).`, 'Tente de novo em instantes.', true);
}

/** Quem é o outro lado de uma conversa direta, visto pelo dono ou por quem observa. */
export function comQuem(mensagens: Array<{ de_slug: string; para_slug: string | null }>): string[] {
  const nomes = new Set<string>();
  for (const m of mensagens) {
    if (m.de_slug !== DONO) nomes.add(m.de_slug);
    if (m.para_slug && m.para_slug !== DONO) nomes.add(m.para_slug);
  }
  return [...nomes];
}

/** Não lidas do dono: o que não foi ele que escreveu e ainda não tem leitura dele. */
export function naoLidasDoDono(mensagens: Array<{ id: string; de_slug: string }>, lidas: Set<string>): number {
  return mensagens.filter((m) => m.de_slug !== DONO && !lidas.has(m.id)).length;
}

async function salas(): Promise<Map<string, { slug: string; nome: string }>> {
  const { data, error } = await db().from('escritorio_grupos').select('id, slug, nome').limit(200);
  if (error) falhou('salas', error);
  return new Map(((data ?? []) as Linha[]).map((g) => [String(g.id), { slug: String(g.slug), nome: String(g.nome) }]));
}

async function listarConversas(limite: number) {
  const b = db();
  const { data: conversas, error } = await b.from('escritorio_conversas')
    .select('id, tipo, grupo_id, assunto, client_id, task_id, criada_por, ultima_em').order('ultima_em', { ascending: false }).limit(limite);
  if (error) falhou('conversas', error);
  const lista = (conversas ?? []) as Linha[];
  if (!lista.length) return { conversas: [], nao_lidas: 0 };
  const ids = lista.map((c) => String(c.id));
  const [{ data: msgs, error: e2 }, mapa] = await Promise.all([
    b.from('escritorio_mensagens').select(COL_MENSAGEM).in('conversa_id', ids).order('created_at', { ascending: false }).limit(1000),
    salas(),
  ]);
  if (e2) falhou('mensagens', e2);
  const mensagens = (msgs ?? []) as Array<{ id: string; conversa_id: string; de_slug: string; para_slug: string | null; corpo: string; created_at: string }>;
  const { data: lidasRaw, error: e3 } = await b.from('escritorio_leituras').select('mensagem_id').eq('leitor_slug', DONO)
    .in('mensagem_id', mensagens.map((m) => m.id).slice(0, 1000));
  if (e3) falhou('leituras', e3);
  const lidas = new Set(((lidasRaw ?? []) as Array<{ mensagem_id: string }>).map((r) => r.mensagem_id));
  let total = 0;
  const saida = lista.map((c) => {
    const dela = mensagens.filter((m) => m.conversa_id === c.id);
    const paraODono = dela.some((m) => m.para_slug === DONO || m.de_slug === DONO);
    // Só conta como "para você" o que é do dono: conversa em que ele fala ou que foi mandada a ele.
    const naoLidas = paraODono ? naoLidasDoDono(dela, lidas) : 0;
    total += naoLidas;
    const ultima = dela[0];
    return {
      id: c.id,
      tipo: c.tipo,
      sala: c.grupo_id ? mapa.get(String(c.grupo_id))?.slug ?? null : null,
      assunto: c.assunto ?? null,
      com: c.grupo_id ? [] : comQuem(dela),
      do_dono: paraODono,
      ultima: ultima ? { de: ultima.de_slug, texto: ultima.corpo.slice(0, 200), quando: ultima.created_at } : null,
      nao_lidas: naoLidas,
      ultima_em: c.ultima_em,
    };
  });
  return { conversas: saida, nao_lidas: total };
}

async function lerFio(conversaId: string, limite: number) {
  const b = db();
  const { data: c, error } = await b.from('escritorio_conversas').select('id, tipo, grupo_id, assunto').eq('id', conversaId).maybeSingle();
  if (error) falhou('conversa', error);
  if (!c) throw new ErroDaFerramenta('nao_encontrado', 'conversa_id não existe.', null, false);
  const { data, error: e2 } = await b.from('escritorio_mensagens').select(COL_MENSAGEM).eq('conversa_id', conversaId)
    .order('created_at', { ascending: false }).limit(limite);
  if (e2) falhou('fio', e2);
  const mapa = (c as Linha).grupo_id ? await salas() : new Map();
  return {
    conversa: { id: (c as Linha).id, tipo: (c as Linha).tipo, assunto: (c as Linha).assunto ?? null, sala: (c as Linha).grupo_id ? mapa.get(String((c as Linha).grupo_id))?.slug ?? null : null },
    mensagens: ((data ?? []) as Linha[]).reverse().map((m) => ({ id: m.id, de: m.de_slug, para: m.para_slug ?? null, texto: m.corpo, quando: m.created_at })),
  };
}

async function marcarLidas(conversaId: string) {
  const b = db();
  const { data, error } = await b.from('escritorio_mensagens').select('id').eq('conversa_id', conversaId).neq('de_slug', DONO).limit(1000);
  if (error) falhou('marcar lidas', error);
  const linhas = ((data ?? []) as Array<{ id: string }>).map((m) => ({ mensagem_id: m.id, leitor_slug: DONO }));
  if (linhas.length) {
    const { error: e2 } = await b.from('escritorio_leituras').upsert(linhas, { onConflict: 'mensagem_id,leitor_slug', ignoreDuplicates: true });
    if (e2) falhou('marcar lidas', e2);
  }
  return { ok: true, marcadas: linhas.length };
}

async function enviar(d: z.infer<typeof schema>, ctx: AuthContext) {
  const texto = (d.texto ?? '').trim();
  if (!texto) throw new ErroDaFerramenta('entrada_invalida', 'texto vazio.', null, false);
  if (!d.idempotency_key) throw new ErroDaFerramenta('entrada_invalida', 'idempotency_key é obrigatória para enviar.', null, false);
  if (pareceTerSegredo(texto) || pareceTerSegredo(d.assunto)) {
    throw new ErroDaFerramenta('tem_segredo', 'A mensagem parece ter senha, token ou chave. Nada foi registrado.', 'Segredo não passa pelo Escritório.', false);
  }
  const b = db();
  const { data: ja, error: e0 } = await b.from('escritorio_mensagens').select('id, conversa_id').eq('de_slug', DONO).eq('idempotency_key', d.idempotency_key).maybeSingle();
  if (e0) falhou('repetição', e0);
  if (ja) return { ok: true, repetida: true, mensagem_id: (ja as Linha).id, conversa_id: (ja as Linha).conversa_id };

  let conversaId = d.conversa_id ?? null;
  let para: string | null = (d.para ?? '').trim().toLowerCase() || null;
  let grupoId: string | null = null;

  if (conversaId) {
    const { data: c, error } = await b.from('escritorio_conversas').select('id, tipo, grupo_id').eq('id', conversaId).maybeSingle();
    if (error) falhou('conversa', error);
    if (!c) throw new ErroDaFerramenta('nao_encontrado', 'conversa_id não existe.', null, false);
    if ((c as Linha).tipo === 'grupo') {
      grupoId = String((c as Linha).grupo_id ?? '') || null;
      if (!grupoId) throw new ErroDaFerramenta('sala_fechada', 'A sala desta conversa não existe mais.', null, false);
      para = null;
    } else if (!para) {
      const { data: ult, error: e1 } = await b.from('escritorio_mensagens').select('de_slug, para_slug').eq('conversa_id', conversaId)
        .order('created_at', { ascending: false }).limit(20);
      if (e1) falhou('fio', e1);
      para = comQuem((ult ?? []) as Array<{ de_slug: string; para_slug: string | null }>)[0] ?? null;
    }
  } else if (d.grupo) {
    const { data: g, error } = await b.from('escritorio_grupos').select('id').eq('slug', d.grupo.trim().toLowerCase()).eq('ativo', true).maybeSingle();
    if (error) falhou('sala', error);
    if (!g) throw new ErroDaFerramenta('nao_encontrado', `A sala "${d.grupo}" não existe.`, null, false);
    grupoId = String((g as Linha).id);
    para = null;
  }

  if (!grupoId) {
    if (!para || !SLUG.test(para) || para === DONO) throw new ErroDaFerramenta('entrada_invalida', 'Diga para quem: para (slug de um agente), grupo (uma sala) ou conversa_id.', null, false);
    const { data: o, error } = await b.from('internal_operators').select('slug, status').eq('slug', para).maybeSingle();
    if (error) falhou('agente', error);
    if (!o) throw new ErroDaFerramenta('nao_encontrado', `"${para}" não está no cadastro de agentes.`, null, false);
  }

  if (!conversaId) {
    const { data: nova, error } = await b.from('escritorio_conversas')
      .insert({ tipo: grupoId ? 'grupo' : 'direta', grupo_id: grupoId, assunto: d.assunto?.trim() || null, criada_por: DONO }).select('id').single();
    if (error) falhou('abrir conversa', error);
    conversaId = String((nova as Linha).id);
  }
  const autor = (ctx.dataScope as { principalUserId?: string | null }).principalUserId ?? null;
  const { data: m, error } = await b.from('escritorio_mensagens').insert({
    conversa_id: conversaId, de_slug: DONO, de_tipo: 'humano', autor_id: autor && UUID.test(autor) ? autor : null,
    para_slug: grupoId ? null : para, grupo_id: grupoId, corpo: texto, idempotency_key: d.idempotency_key,
  }).select('id').single();
  if (error) falhou('gravar mensagem', error);
  await b.from('escritorio_conversas').update({ ultima_em: new Date().toISOString() }).eq('id', conversaId);
  if (ctx.resultRefHolder) ctx.resultRefHolder.value = `escritorio_mensagens:${(m as Linha).id}`;
  return { ok: true, mensagem_id: (m as Linha).id, conversa_id: conversaId, para: grupoId ? 'sala' : para };
}

export const FERRAMENTA_DO_DONO_NO_ESCRITORIO: readonly ToolDefinition[] = [{
  name: 'aceleriq_escritorio_dono',
  title: 'Escritório: o dono lê e escreve fora do painel',
  description:
    'Só para a credencial do app do Hermes (escopo escritorio:write, que nenhum outro escopo concede). O dono lê as conversas do Escritório (acao "conversas"), abre um fio ("fio"), escreve a um agente, a uma sala ou responde num fio ("enviar", com idempotency_key) e marca como lidas ("marcar_lidas"). Tudo sai assinado como dono. Recusa texto com cara de senha, token ou chave. Não fala com cliente, não gasta e não publica.',
  scopes: ['escritorio:write'],
  annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['acao'],
    properties: {
      acao: { type: 'string', enum: ['conversas', 'fio', 'enviar', 'marcar_lidas'] },
      conversa_id: { type: 'string', format: 'uuid' },
      para: { type: 'string', description: 'Slug do agente (ao abrir conversa direta).' },
      grupo: { type: 'string', description: 'Slug da sala (ao abrir conversa numa sala).' },
      texto: { type: 'string', maxLength: 4000 },
      assunto: { type: 'string', maxLength: 160 },
      idempotency_key: { type: 'string', minLength: 8, maxLength: 128, description: 'Obrigatória em "enviar".' },
      limite: { type: 'integer', minimum: 1, maximum: 200 },
    },
  },
  handler: async (input, ctx) => {
    const p = schema.safeParse(input ?? {});
    if (!p.success) throw new ErroDaFerramenta('entrada_invalida', `Entrada inválida: ${p.error.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`).join('; ')}`, null, false);
    const d = p.data;
    if (d.acao === 'conversas') return await listarConversas(d.limite ?? 60);
    if (d.acao === 'enviar') return await enviar(d, ctx);
    if (!d.conversa_id) throw new ErroDaFerramenta('entrada_invalida', 'conversa_id é obrigatório nesta ação.', null, false);
    if (d.acao === 'fio') return await lerFio(d.conversa_id, d.limite ?? 100);
    return await marcarLidas(d.conversa_id);
  },
}];
