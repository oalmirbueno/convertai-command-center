/**
 * MCP 2.19 (26/10/2026): o diário da execução (aceleriq_operator_diary), com freio e confirmação.
 *
 * Diagnóstico de 26/10: o leitor do Hermes abria o diário ~100 mil vezes por dia e escrevia ~100
 * comentários por vínculo, porque a confirmação de resposta nunca casava. Agora:
 *   - leitura com limite por credencial (30/min por vínculo, 120/min no total), `desde` e cursor,
 *     mais recentes primeiro;
 *   - escrita com reply_to_entry_id (a entrada que esta responde, do mesmo vínculo), guardado em
 *     metadata e devolvido na leitura como `respondida_por` (é o que marca a instrução atendida);
 *   - texto sem fato novo não é registrado: o mesmo autor, no mesmo vínculo, nas últimas 6 h, com
 *     texto quase igual (mesmos números, sem anexo novo) recebe "nada novo; não registrado".
 *
 * Sem body, LISTA; com body, ESCREVE via operator_participar (valida operador vivo, audita e decide
 * se notifica: pedido_insumo e pedido_revisao notificam; comentario não).
 */

import { db, isUuid } from '../../_shared/aceleriq-read-services.ts';
import { exigirVinculoExistente } from '../../_shared/aceleriq-operators-services.ts';
import { progressDetail } from '../../_shared/operator-progress-detail.ts';
import { organizarArquivosDaExecucao } from '../../_shared/arquivos-da-execucao.ts';
import { ErroDaFerramenta } from './robustez.ts';
import { principalDaChamada } from './autoria.ts';

export const LIMITE_POR_VINCULO = 30;
export const LIMITE_POR_CREDENCIAL = 120;
export const JANELA_DE_REPETICAO_H = 6;

const texto = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
};

// ─── Limite de leitura ──────────────────────────────────────────

const naMemoria = new Map<string, { janela: number; usos: number }>();

/** Contador local por janela de 60 s: só quando o banco não responde (o freio não pode sumir). */
export function consumirNaMemoria(chave: string, maximo: number, agora = Date.now()): { ok: boolean; esperar_seg: number } {
  const janela = Math.floor(agora / 60_000);
  const atual = naMemoria.get(chave);
  const usos = atual && atual.janela === janela ? atual.usos + 1 : 1;
  naMemoria.set(chave, { janela, usos });
  if (naMemoria.size > 5000) naMemoria.clear();
  return { ok: usos <= maximo, esperar_seg: Math.max(1, Math.ceil(((janela + 1) * 60_000 - agora) / 1000)) };
}

type Banco = ReturnType<typeof db>;

export async function consumirTaxa(chave: string, maximo: number, banco: Banco = db()): Promise<{ ok: boolean; esperar_seg: number }> {
  try {
    const { data, error } = await banco.rpc('mcp_taxa_consumir', { _chave: chave, _maximo: maximo, _janela_seg: 60 });
    if (error || !data || typeof data !== 'object') return consumirNaMemoria(chave, maximo);
    const r = data as { ok?: boolean; libera_em?: string };
    const libera = r.libera_em ? Date.parse(r.libera_em) : NaN;
    return { ok: r.ok !== false, esperar_seg: Number.isFinite(libera) ? Math.max(1, Math.ceil((libera - Date.now()) / 1000)) : 60 };
  } catch {
    return consumirNaMemoria(chave, maximo);
  }
}

export async function conferirLimiteDeLeitura(principal: string, linkId: string, banco: Banco = db()) {
  const [porVinculo, porCredencial] = await Promise.all([
    consumirTaxa(`diario:${principal}:${linkId}`, LIMITE_POR_VINCULO, banco),
    consumirTaxa(`diario:${principal}`, LIMITE_POR_CREDENCIAL, banco),
  ]);
  if (porVinculo.ok && porCredencial.ok) return;
  const espera = Math.max(porVinculo.ok ? 0 : porVinculo.esperar_seg, porCredencial.ok ? 0 : porCredencial.esperar_seg);
  throw new ErroDaFerramenta(
    'limite_de_leitura',
    `limite de leitura do diário; espere ${espera} s. Esta credencial pode ler ${LIMITE_POR_VINCULO} vezes por minuto o mesmo vínculo e ${LIMITE_POR_CREDENCIAL} no total.`,
    'Para saber se algo mudou sem abrir o diário, use ultima_entrada_humana_em do aceleriq_operator_board; ao ler, passe desde=<quando da última entrada que você já viu>.',
    false,
  );
}

// ─── Texto sem fato novo ────────────────────────────────────────

const normalizar = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const palavras = (t: string) => new Set(normalizar(t).replace(/[^a-z0-9]+/g, ' ').split(' ').filter((p) => p.length >= 3));
const numeros = (t: string) => new Set((normalizar(t).match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(',', '.')));

export interface EntradaParaComparar {
  titulo?: string | null;
  texto: string;
  anexos?: Array<{ url: string }> | null;
  responde_a?: string | null;
}

/** true quando a entrada nova não traz fato novo em relação à antiga. */
export function semFatoNovo(nova: EntradaParaComparar, antiga: EntradaParaComparar): boolean {
  if (nova.responde_a && nova.responde_a !== (antiga.responde_a ?? null)) return false;
  const urlsAntigas = new Set((antiga.anexos ?? []).map((a) => a.url));
  if ((nova.anexos ?? []).some((a) => !urlsAntigas.has(a.url))) return false;
  const a = `${nova.titulo ?? ''} ${nova.texto}`;
  const b = `${antiga.titulo ?? ''} ${antiga.texto}`;
  if (normalizar(a).replace(/\s+/g, ' ').trim() === normalizar(b).replace(/\s+/g, ' ').trim()) return true;
  const na = numeros(a), nb = numeros(b);
  if (na.size !== nb.size || [...na].some((n) => !nb.has(n))) return false;
  const pa = palavras(a), pb = palavras(b);
  if (!pa.size || !pb.size) return false;
  let comum = 0;
  for (const p of pa) if (pb.has(p)) comum++;
  return comum / (pa.size + pb.size - comum) >= 0.85;
}

// ─── Cursor ─────────────────────────────────────────────────────

export function lerCursor(cursor?: string | null): string | null {
  const c = texto(cursor);
  if (!c) return null;
  const quando = Date.parse(c);
  if (!Number.isFinite(quando)) throw new ErroDaFerramenta('entrada_invalida', 'cursor inválido: use o proximo_cursor devolvido pela leitura anterior.', null, false);
  return new Date(quando).toISOString();
}

// ─── O diário ───────────────────────────────────────────────────

export interface EntradaDoDiario {
  link_id: string;
  operator?: string;
  entry_type?: string;
  title?: string;
  body?: string;
  attachments?: { name: string; url: string }[];
  reply_to_entry_id?: string;
  desde?: string;
  cursor?: string;
  limit?: number;
}

const COLUNAS = 'id, entry_type, title, body, attachments, author_kind, author_id, operator_id, created_at';

export async function operatorDiary(
  input: EntradaDoDiario,
  ctx: { keyId: string; origin: string | null } = { keyId: 'interno', origin: null },
  banco: Banco = db(),
) {
  if (!isUuid(input.link_id)) throw new Error('link_id must be a UUID');
  if (input.reply_to_entry_id && !isUuid(input.reply_to_entry_id)) throw new Error('reply_to_entry_id must be a UUID');
  const operador = texto(input.operator)?.toLowerCase() ?? null;

  if (texto(input.body)) {
    // Confere o vinculo antes de escrever: o RPC recusaria com 400 link_not_found.
    await exigirVinculoExistente(input.link_id, operador);
    if (!operador) throw new Error('para escrever no diario informe operator (slug do operador que assina)');
    return await escrever(input, operador, banco);
  }

  await conferirLimiteDeLeitura(principalDaChamada(ctx), input.link_id, banco);
  await exigirVinculoExistente(input.link_id, operador);
  return await ler(input, banco);
}

async function escrever(input: EntradaDoDiario, operador: string, banco: Banco) {
  const anexos = (progressDetail({ attachments: input.attachments }).attachments as Array<{ name: string; url: string }> | undefined) || [];
  const respondeA = texto(input.reply_to_entry_id);

  if (respondeA) {
    const { data: alvo, error } = await banco.from('operator_participations')
      .select('id').eq('id', respondeA).eq('task_link_id', input.link_id).maybeSingle();
    if (error) throw new Error(`operator_participations: ${error.message}`);
    if (!alvo) throw new ErroDaFerramenta('entrada_invalida', 'reply_to_entry_id não é uma entrada deste vínculo: use o id de uma entrada lida neste mesmo diário.', null, false);
  }

  // Texto sem fato novo do mesmo autor no mesmo vínculo nas últimas 6 h: não registra.
  const { data: op } = await banco.from('internal_operators').select('id').eq('slug', operador).maybeSingle();
  const opId = (op as { id?: string } | null)?.id ?? null;
  if (opId) {
    const desde = new Date(Date.now() - JANELA_DE_REPETICAO_H * 3600_000).toISOString();
    let recentes: { data: unknown[] | null; error: { message: string } | null } = await banco.from('operator_participations')
      .select('id, title, body, attachments, metadata, created_at')
      .eq('task_link_id', input.link_id).eq('operator_id', opId).gte('created_at', desde)
      .order('created_at', { ascending: false }).limit(20);
    if (recentes.error && /metadata/i.test(recentes.error.message)) {
      recentes = await banco.from('operator_participations')
        .select('id, title, body, attachments, created_at')
        .eq('task_link_id', input.link_id).eq('operator_id', opId).gte('created_at', desde)
        .order('created_at', { ascending: false }).limit(20);
    }
    const nova = { titulo: texto(input.title), texto: String(input.body), anexos, responde_a: respondeA };
    const igual = ((recentes.data ?? []) as Array<Record<string, unknown>>).find((r) => semFatoNovo(nova, {
      titulo: texto(r.title),
      texto: String(r.body ?? ''),
      anexos: Array.isArray(r.attachments) ? (r.attachments as Array<{ url: string }>) : [],
      responde_a: texto((r.metadata as Record<string, unknown> | null)?.reply_to_entry_id),
    }));
    if (igual) {
      return {
        ok: true,
        registrado: false,
        motivo: 'nada novo; não registrado',
        entrada_parecida: igual.id,
        quando: igual.created_at,
        como_seguir: 'Escreva só quando houver fato novo (resultado, número, anexo, decisão) ou responda a outra instrução com reply_to_entry_id.',
      };
    }
  }

  const { data, error } = await banco.rpc('operator_participar', {
    _operator_slug: operador,
    _link_id: input.link_id,
    _entry_type: texto(input.entry_type) ?? 'comentario',
    _body: String(input.body),
    _title: texto(input.title),
    _attachments: anexos,
  });
  if (error) throw new Error(`operator_participar: ${error.message}`);
  const linha = (data ?? {}) as Record<string, unknown>;
  let resposta: Record<string, unknown> = {};
  if (respondeA && isUuid(String(linha.participation_id ?? ''))) {
    const r = await banco.from('operator_participations')
      .update({ metadata: { reply_to_entry_id: respondeA } })
      .eq('id', String(linha.participation_id));
    resposta = r.error
      ? { responde_a: null, aviso_da_resposta: 'A entrada foi salva, mas a ligação com a instrução não (o banco ainda não tem a coluna metadata).' }
      : { responde_a: respondeA };
  }
  const workspace = await organizarArquivosDaExecucao(banco, input.link_id, input.attachments || [])
    .catch(() => ({ organizados: 0, avisos: ['O diário foi salvo; a organização dos arquivos não foi confirmada no Workspace.'] }));
  return { ...linha, registrado: true, ...resposta, workspace };
}

async function ler(input: EntradaDoDiario, banco: Banco) {
  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 100);
  const desde = lerCursor(input.desde);
  const antesDe = lerCursor(input.cursor);
  const consulta = (colunas: string) => {
    let q = banco.from('operator_participations').select(colunas)
      .eq('task_link_id', input.link_id)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (desde) q = q.gt('created_at', desde);
    if (antesDe) q = q.lt('created_at', antesDe);
    return q;
  };
  let comMetadata = true;
  let r = await consulta(`${COLUNAS}, metadata`);
  if (r.error && /metadata/i.test(r.error.message)) {
    comMetadata = false;
    r = await consulta(COLUNAS);
  }
  if (r.error) throw new Error(`operator_participations: ${r.error.message}`);
  const linhas = (r.data ?? []) as unknown as Array<Record<string, unknown>>;

  // Respostas que apontam para as entradas lidas (podem estar fora desta página).
  const respostas = new Map<string, Array<Record<string, unknown>>>();
  if (comMetadata && linhas.length) {
    const ids = linhas.map((l) => String(l.id));
    const rr = await banco.from('operator_participations')
      .select('id, created_at, author_kind, author_id, operator_id, metadata')
      .eq('task_link_id', input.link_id)
      .in('metadata->>reply_to_entry_id', ids)
      .limit(500);
    for (const x of ((rr.error ? [] : rr.data ?? []) as Array<Record<string, unknown>>)) {
      const alvo = texto((x.metadata as Record<string, unknown> | null)?.reply_to_entry_id);
      if (!alvo) continue;
      respostas.set(alvo, [...(respostas.get(alvo) ?? []), x]);
    }
  }

  // Nome de autor resolvido aqui para o leitor nao receber UUID cru.
  const todas = [...linhas, ...[...respostas.values()].flat()];
  const humanos = [...new Set(todas.map((l) => texto(l.author_id)).filter(Boolean))] as string[];
  const agentes = [...new Set(todas.map((l) => texto(l.operator_id)).filter(Boolean))] as string[];
  const [perfis, ops] = await Promise.all([
    humanos.length ? banco.from('profiles').select('id, full_name').in('id', humanos) : Promise.resolve({ data: [], error: null }),
    agentes.length ? banco.from('internal_operators').select('id, slug, display_name').in('id', agentes) : Promise.resolve({ data: [], error: null }),
  ]);
  const nomeHumano = new Map(((perfis.data ?? []) as Array<Record<string, unknown>>).map((p) => [String(p.id), texto(p.full_name) ?? 'pessoa']));
  const nomeAgente = new Map(((ops.data ?? []) as Array<Record<string, unknown>>).map((o) => [String(o.id), texto(o.display_name) ?? texto(o.slug) ?? 'operador']));
  const autor = (l: Record<string, unknown>) => l.author_kind === 'humano'
    ? (nomeHumano.get(String(l.author_id)) ?? 'pessoa')
    : (nomeAgente.get(String(l.operator_id)) ?? 'operador');

  return {
    link_id: input.link_id,
    total: linhas.length,
    ordem: 'mais_recentes_primeiro',
    entradas: linhas.map((l) => {
      const por = respostas.get(String(l.id)) ?? [];
      return {
        id: l.id,
        quando: l.created_at,
        tipo: l.entry_type,
        autor: autor(l),
        autor_kind: l.author_kind,
        titulo: l.title,
        texto: l.body,
        anexos: l.attachments,
        responde_a: texto((l.metadata as Record<string, unknown> | null)?.reply_to_entry_id),
        respondida_por: por.map((x) => ({ id: x.id, quando: x.created_at, autor: autor(x) })),
      };
    }),
    proximo_cursor: linhas.length === limit ? String(linhas[linhas.length - 1].created_at) : null,
    como_usar: 'Mais recentes primeiro. Entradas do tipo instrucao, decisao e correcao vem do humano e MANDAM: '
      + 'leia antes de continuar a tarefa. Para responder, chame de novo com operator, entry_type, body e '
      + 'reply_to_entry_id = id da entrada que voce atende; ela passa a mostrar respondida_por e nao precisa '
      + 'ser respondida de novo. Para ler so o que chegou, passe desde = quando da ultima entrada vista; '
      + 'para paginas mais antigas, cursor = proximo_cursor. resposta_insumo fecha um pedido_insumo seu.',
  };
}
