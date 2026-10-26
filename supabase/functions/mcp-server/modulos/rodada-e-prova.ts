/**
 * MCP 2.19 (26/10/2026): rodada sem fato não gira a fila, e "feito" só com prova.
 *
 * Diagnóstico de 26/10: o diário virou "preservado / sem alteração / travado"; o fim_da_rodada
 * (MCP 2.16) devolvia o vínculo para a fila a cada rodada, mesmo sem nada feito; e
 * operator_deliveries tinha 0 linhas em 14 dias: "feito" sem prova.
 *
 *   ehSoLeitura      relato de "só leitura / preservado / recuperação": não move card nem notifica
 *                    (vira documental no banco) e não conta como fato.
 *   classificarProva o que vale como prova de entrega: post publicado com permalink, ação de anúncio
 *                    registrada (ads_acao:<id>), mensagem enviada (envio:<id>), arquivo entregue.
 *   avaliarRodada    a rodada teve fato novo? (prova, entrega, mudança de estado, diário com conteúdo)
 *   vinculoParado    sem entrega em 72 h: o vínculo sai da fila como 'parado', sem aviso.
 */

type Banco = { from: (tabela: string) => any };

const SO_LEITURA = /\b(s[oó] leitura|somente leitura|apenas leitura|read[- ]only|preservad[oa]s?|sem altera[cç](?:[aã]o|[oõ]es)|nada mudou|nenhuma (?:altera[cç][aã]o|mudan[cç]a)|recupera[cç][aã]o|sem novidade)/i;

export function ehSoLeitura(...textos: Array<string | null | undefined>): boolean {
  return textos.some((t) => typeof t === 'string' && SO_LEITURA.test(t));
}

export type TipoDeProva = 'post_publicado' | 'acao_de_anuncio' | 'mensagem_enviada' | 'arquivo_entregue' | 'pagina_publicada';
export interface Prova { tipo: TipoDeProva; ref: string }

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const POST = /^https:\/\/(www\.)?(instagram\.com\/(p|reel|reels|tv|stories)\/|facebook\.com\/.+\/(posts|videos|reel)\/|facebook\.com\/(reel|watch|photo|permalink\.php)|fb\.watch\/|tiktok\.com\/@[^/]+\/(video|photo)\/|vm\.tiktok\.com\/|youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/|linkedin\.com\/(posts|feed\/update)\/|threads\.net\/@[^/]+\/post\/|x\.com\/[^/]+\/status\/|twitter\.com\/[^/]+\/status\/)/i;
// Painéis e gerenciadores não provam nada sozinhos: o link é da ferramenta, não do resultado.
const NAO_PROVA = /^https:\/\/([a-z0-9-]+\.)*(aceleriq\.online|aceleriq\.com(\.br)?|lovable\.(app|dev)|business\.facebook\.com|adsmanager\.facebook\.com|facebook\.com\/adsmanager|ads\.google\.com|business\.google\.com|analytics\.google\.com|localhost)(\/|$)/i;
const ARQUIVO = new RegExp(`^(aceleriq-file:\\/\\/${UUID}|files:\\/\\/\\S+|mcp-files:\\/\\/\\S+|https:\\/\\/[a-z0-9]+\\.supabase\\.co\\/storage\\/v1\\/\\S+)`, 'i');

function umaProva(valor: string): Prova | null {
  const v = valor.trim();
  if (!v) return null;
  const anuncio = new RegExp(`^ads_acao:(${UUID})$`, 'i').exec(v);
  if (anuncio) return { tipo: 'acao_de_anuncio', ref: anuncio[1].toLowerCase() };
  const envio = new RegExp(`^envio:(${UUID})$`, 'i').exec(v);
  if (envio) return { tipo: 'mensagem_enviada', ref: envio[1].toLowerCase() };
  if (ARQUIVO.test(v)) return { tipo: 'arquivo_entregue', ref: v };
  if (POST.test(v)) return { tipo: 'post_publicado', ref: v };
  if (/^https:\/\/\S+\.\S+\/\S+/i.test(v) && !NAO_PROVA.test(v)) return { tipo: 'pagina_publicada', ref: v };
  return null;
}

/** A primeira prova aceita entre a evidência (pode ter vários itens separados por espaço) e os anexos. */
export function classificarProva(evidence?: string | null, anexos?: Array<{ url: string }> | null): Prova | null {
  const candidatos = [
    ...String(evidence ?? '').split(/[\s,;]+/),
    ...(anexos ?? []).map((a) => String(a?.url ?? '')),
  ].map((s) => s.replace(/[)\].]+$/, ''));
  for (const c of candidatos) {
    const p = umaProva(c);
    if (p) return p;
  }
  return null;
}

/** ads_acao:<id> só vale se a ação existe; envio:<id> só se o envio foi registrado. */
export async function provaConfere(banco: Banco, prova: Prova): Promise<boolean> {
  try {
    if (prova.tipo === 'acao_de_anuncio') {
      const { data } = await banco.from('ads_rotina_acoes').select('id').eq('id', prova.ref).eq('estado', 'feita').maybeSingle();
      return !!data;
    }
    if (prova.tipo === 'mensagem_enviada') {
      const { data } = await banco.from('operator_approvals').select('id').eq('id', prova.ref).not('executed_at', 'is', null).maybeSingle();
      return !!data;
    }
    return true;
  } catch {
    return false;
  }
}

export const HORAS_SEM_ENTREGA = 72;

export interface Rodada {
  runId?: string | null;
  linkId?: string | null;
  operatorId?: string | null;
  inicio?: string | null;
  evidence?: string | null;
  anexos?: Array<{ url: string }> | null;
  textos?: Array<string | null | undefined>;
}

/** A rodada teve fato novo? Na dúvida (leitura falhou), conta como fato: não prende tarefa à toa. */
export async function avaliarRodada(banco: Banco, r: Rodada): Promise<{ fato: boolean; por: string }> {
  if (classificarProva(r.evidence, r.anexos)) return { fato: true, por: 'prova' };
  if (r.evidence?.trim() && !ehSoLeitura(r.evidence)) return { fato: true, por: 'evidencia' };
  if (!r.linkId) return { fato: true, por: 'sem_vinculo' };
  const desde = r.inicio ?? new Date(Date.now() - 3600_000).toISOString();
  try {
    const [entregas, diario, trilha] = await Promise.all([
      banco.from('operator_deliveries').select('id').eq('task_link_id', r.linkId).gte('occurred_at', desde).limit(1),
      r.operatorId
        ? banco.from('operator_participations').select('body, attachments').eq('task_link_id', r.linkId).eq('operator_id', r.operatorId).gte('created_at', desde).limit(20)
        : Promise.resolve({ data: [], error: null }),
      banco.from('operator_audit_log').select('old_status, new_status, action').eq('task_link_id', r.linkId).gte('created_at', desde).limit(50),
    ]);
    if (entregas.error || diario.error || trilha.error) return { fato: true, por: 'leitura_falhou' };
    if ((entregas.data ?? []).length) return { fato: true, por: 'entrega' };
    const comConteudo = ((diario.data ?? []) as Array<{ body?: string; attachments?: unknown[] }>).some((d) =>
      (Array.isArray(d.attachments) && d.attachments.length > 0) || (String(d.body ?? '').trim().length >= 40 && !ehSoLeitura(d.body)));
    if (comConteudo) return { fato: true, por: 'diario' };
    const mudou = ((trilha.data ?? []) as Array<{ old_status?: string | null; new_status?: string | null; action?: string | null }>).some((t) =>
      String(t.action ?? '').startsWith('card movido')
      || (t.old_status && t.new_status && t.old_status !== t.new_status
        && !(t.old_status === 'queued' && t.new_status === 'in_progress')
        && !(t.old_status === 'in_progress' && t.new_status === 'queued')));
    if (mudou) return { fato: true, por: 'estado' };
    return { fato: false, por: 'nada' };
  } catch {
    return { fato: true, por: 'leitura_falhou' };
  }
}

/** Sem entrega nas últimas 72 h (e o vínculo existe há mais que isso)? */
export async function vinculoSemEntrega(banco: Banco, linkId: string, criadoEm: string | null, agora = Date.now()): Promise<boolean> {
  const limite = agora - HORAS_SEM_ENTREGA * 3600_000;
  if (!criadoEm || Date.parse(criadoEm) > limite) return false;
  const { data, error } = await banco.from('operator_deliveries').select('id')
    .eq('task_link_id', linkId).gte('occurred_at', new Date(limite).toISOString()).limit(1);
  if (error) return false;
  return !(data ?? []).length;
}
