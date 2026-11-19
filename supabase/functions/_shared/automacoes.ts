// deno-lint-ignore-file no-explicit-any
/**
 * Central de Automações (19/11/2026): o que a função automacoes-n8n e o MCP repartem.
 *
 * - validarRetrato / gravarRetrato: o coletor do VPS manda o retrato do n8n (fluxos, execuções, saúde);
 *   gravamos nas tabelas automacao_* com a chave de serviço.
 * - ligarDesligar: chama a API pública do n8n (activate/deactivate) com a chave que mora SÓ no segredo
 *   N8N_API_KEY das funções, registra em automacao_acoes quem pediu e o resultado, e atualiza o estado na hora.
 *
 * Nada aqui devolve segredo: a chave do n8n nunca sai desta função e o erro do n8n volta mascarado.
 */

export const N8N_API_PADRAO = 'https://n8n-recovery.srv1769409.hstgr.cloud/api/v1';
export const POR_FLUXO = 30;

const GRUPOS_COM_CLIENTE = new Set(['Clientes', 'Comercial', 'Instagram', 'Grupos DK']);
const NOME_COM_CLIENTE = /(cliente|grupo|whatsapp|lead|instagram|direct)/i;

/** Mesma regra da função SQL public.automacao_efeito_no_cliente. */
export function efeitoNoCliente(grupo: string | null | undefined, nome: string | null | undefined): boolean {
  return GRUPOS_COM_CLIENTE.has(String(grupo ?? '')) || NOME_COM_CLIENTE.test(String(nome ?? ''));
}

export type Acao = 'ligar' | 'desligar';

export function montarConfirmacao(f: { nome: string; grupo: string; ativo: boolean }, acao: Acao) {
  const efeito = efeitoNoCliente(f.grupo, f.nome);
  let aviso: string;
  if (acao === 'desligar') {
    if (f.grupo === 'Apoio') aviso = 'É um fluxo de apoio: outros fluxos dependem dele e podem parar ou perder o registro de falhas.';
    else if (efeito) aviso = 'Este fluxo fala com cliente ou lead: desligado, nada dele sai até alguém ligar de novo.';
    else aviso = 'Para de rodar até alguém ligar de novo.';
  } else {
    aviso = efeito
      ? 'Ligado, ele começa a rodar sozinho e volta a falar com cliente ou lead no próximo gatilho.'
      : 'Ligado, ele começa a rodar sozinho no próximo gatilho.';
  }
  return { efeito_no_cliente: efeito, aviso, ja_esta: acao === 'ligar' ? f.ativo : !f.ativo };
}

// ---------------------------------------------------------------- retrato do coletor
const SEGREDO = [
  [/bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer ***'],
  [/((?:api[_-]?key|token|secret|senha|password|authorization)["']?\s*[:=]\s*["']?)[^\s"'&,}]+/gi, '$1***'],
  [/[A-Za-z0-9_\-]{32,}/g, '***'],
] as const;

export function mascarar(texto: unknown, teto = 320): string | null {
  if (texto == null || texto === '') return null;
  let t = String(texto);
  for (const [p, troca] of SEGREDO) t = t.replace(p as RegExp, troca as string);
  t = t.replace(/\s+/g, ' ').trim();
  return t.length > teto ? `${t.slice(0, teto)}…` : t;
}

const texto = (v: unknown, teto = 300) => (v == null ? null : String(v).slice(0, teto));
const data = (v: unknown) => {
  if (v == null || v === '') return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const inteiro = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.trunc(Number(v))) : 0);

export interface FluxoDoRetrato {
  id: string; nome: string; grupo: string; ativo: boolean; arquivado: boolean; versao: string | null;
  atualizado_no_n8n: string | null; gatilhos: unknown[]; proxima_execucao: string | null;
  total_24h: number; erros_24h: number; ultima_execucao: unknown; qtd_nos: number; desenho?: unknown;
}

export function validarRetrato(bruto: any) {
  if (!bruto || !Array.isArray(bruto.fluxos)) throw new Error('retrato sem fluxos');
  if (bruto.fluxos.length > 500) throw new Error('fluxos demais');
  const fluxos: FluxoDoRetrato[] = bruto.fluxos.map((f: any) => {
    const id = String(f?.id ?? '').trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error('fluxo sem id válido');
    const item: FluxoDoRetrato = {
      id,
      nome: texto(f.nome, 200) ?? id,
      grupo: texto(f.grupo, 60) ?? 'Outros',
      ativo: f.ativo === true,
      arquivado: f.arquivado === true,
      versao: texto(f.versao, 64),
      atualizado_no_n8n: data(f.atualizado_em),
      gatilhos: Array.isArray(f.gatilhos) ? f.gatilhos.slice(0, 20).map((g: any) => ({ tipo: texto(g?.tipo, 20), descricao: texto(g?.descricao, 120) })) : [],
      proxima_execucao: data(f.proxima_execucao),
      total_24h: inteiro(f.total_24h),
      erros_24h: inteiro(f.erros_24h),
      ultima_execucao: f.ultima_execucao && typeof f.ultima_execucao === 'object' ? {
        id: inteiro(f.ultima_execucao.id), status: texto(f.ultima_execucao.status, 20),
        inicio: data(f.ultima_execucao.inicio), fim: data(f.ultima_execucao.fim), modo: texto(f.ultima_execucao.modo, 20),
      } : null,
      qtd_nos: inteiro(f.qtd_nos),
    };
    if (f.desenho && typeof f.desenho === 'object') {
      const nos = Array.isArray(f.desenho.nos) ? f.desenho.nos.slice(0, 300).map((n: any) => ({
        nome: texto(n?.nome, 120), tipo: texto(n?.tipo, 60), x: Number(n?.x) || 0, y: Number(n?.y) || 0, desligado: n?.desligado === true,
      })) : [];
      const ligacoes = Array.isArray(f.desenho.ligacoes) ? f.desenho.ligacoes.slice(0, 600).map((l: any) => ({
        de: texto(l?.de, 120), para: texto(l?.para, 120), saida: inteiro(l?.saida), tipo: texto(l?.tipo, 30),
      })) : [];
      item.desenho = { nos, ligacoes };
    }
    return item;
  });
  const execucoes = (Array.isArray(bruto.execucoes) ? bruto.execucoes : []).slice(0, 2000).map((e: any) => {
    const id = Number(e?.id);
    if (!Number.isInteger(id) || id <= 0) throw new Error('execução sem id');
    return {
      id,
      fluxo_id: String(e.fluxo_id ?? '').slice(0, 64),
      modo: texto(e.modo, 20),
      status: texto(e.status, 20) ?? 'desconhecido',
      inicio: data(e.inicio),
      fim: data(e.fim),
      caminho: Array.isArray(e.caminho) ? e.caminho.slice(0, 80).map((p: any) => ({ no: texto(p?.no, 120), estado: texto(p?.estado, 20), vezes: inteiro(p?.vezes) || 1 })) : [],
      parou_em: texto(e.parou_em, 120),
      erro: mascarar(e.erro),
      erro_no: texto(e.erro_no, 120),
      grande: e.grande === true,
    };
  });
  const saude = (Array.isArray(bruto.saude) ? bruto.saude : []).slice(0, 40).map((s: any, ordem: number) => {
    if (!['ok', 'atencao', 'falha'].includes(s?.estado)) throw new Error('estado de saúde inválido');
    return { chave: String(s.chave).slice(0, 40), nome: texto(s.nome, 120) ?? s.chave, estado: s.estado, detalhe: texto(s.detalhe, 200), info: s.info && typeof s.info === 'object' ? s.info : {}, ordem };
  });
  return { coletado_em: data(bruto.coletado_em) ?? new Date().toISOString(), fluxos, execucoes, saude, por_fluxo: inteiro(bruto.por_fluxo) || POR_FLUXO };
}

/** O desenho só vai quando o fluxo mudou de versão: o que não veio não pode apagar o gravado. */
export function separarFluxos(fluxos: FluxoDoRetrato[]) {
  const comDesenho = fluxos.filter((f) => f.desenho !== undefined);
  const semDesenho = fluxos.filter((f) => f.desenho === undefined).map((f) => {
    const { desenho: _d, ...resto } = f;
    return resto;
  });
  return { comDesenho, semDesenho };
}

async function sha256(t: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function chaveConfere(chave: string, shaEsperado: string): Promise<boolean> {
  if (!chave || !shaEsperado || !/^[0-9a-f]{64}$/i.test(shaEsperado)) return false;
  const h = await sha256(chave);
  let dif = 0;
  for (let i = 0; i < 64; i++) dif |= h.charCodeAt(i) ^ shaEsperado.toLowerCase().charCodeAt(i);
  return dif === 0;
}

export async function gravarRetrato(banco: any, bruto: any) {
  const r = validarRetrato(bruto);
  const agora = new Date().toISOString();
  const { comDesenho, semDesenho } = separarFluxos(r.fluxos);
  const marca = (f: any) => ({ ...f, visto_em: agora, sumiu_em: null });
  for (const lote of [comDesenho.map(marca), semDesenho.map(marca)]) {
    if (!lote.length) continue;
    const { error } = await banco.from('automacao_fluxos').upsert(lote, { onConflict: 'id' });
    if (error) throw new Error(`fluxos: ${error.message}`);
  }
  if (r.fluxos.length) {
    const ids = r.fluxos.map((f) => f.id);
    const { error } = await banco.from('automacao_fluxos').update({ sumiu_em: agora }).is('sumiu_em', null)
      .not('id', 'in', `(${ids.map((i) => `"${i}"`).join(',')})`);
    if (error) throw new Error(`sumidos: ${error.message}`);
  }
  for (let i = 0; i < r.execucoes.length; i += 500) {
    const { error } = await banco.from('automacao_execucoes').upsert(r.execucoes.slice(i, i + 500), { onConflict: 'id' });
    if (error) throw new Error(`execuções: ${error.message}`);
  }
  if (r.saude.length) {
    const { error } = await banco.from('automacao_saude').upsert(r.saude.map((s: any) => ({ ...s, coletado_em: r.coletado_em })), { onConflict: 'chave' });
    if (error) throw new Error(`saúde: ${error.message}`);
  }
  await banco.from('automacao_coletas').upsert({ id: 1, coletado_em: r.coletado_em, recebido_em: agora, fluxos: r.fluxos.length, execucoes: r.execucoes.length });
  const { data: podadas } = await banco.rpc('automacoes_podar', { _por_fluxo: r.por_fluxo });
  return { fluxos: r.fluxos.length, execucoes: r.execucoes.length, saude: r.saude.length, podadas: podadas ?? 0 };
}

// ---------------------------------------------------------------- ligar e desligar
export class ErroDeAutomacao extends Error {
  constructor(public codigo: string, mensagem: string, public status = 400) {
    super(mensagem);
  }
}

export async function ligarDesligar(banco: any, p: {
  fluxoId: string; acao: Acao; quemId: string | null; quemNome: string; via: 'painel' | 'mcp'; motivo?: string | null;
}) {
  const chaveN8n = Deno.env.get('N8N_API_KEY') ?? '';
  const base = (Deno.env.get('N8N_API_URL') ?? N8N_API_PADRAO).replace(/\/+$/, '');
  if (!['ligar', 'desligar'].includes(p.acao)) throw new ErroDeAutomacao('acao_invalida', 'Use ligar ou desligar.');
  const { data: f, error } = await banco.from('automacao_fluxos').select('id, nome, grupo, ativo').eq('id', p.fluxoId).maybeSingle();
  if (error) throw new ErroDeAutomacao('falha_no_banco', 'Não consegui ler o fluxo agora.', 503);
  if (!f) throw new ErroDeAutomacao('fluxo_nao_encontrado', 'Esse fluxo não está na Central (o coletor ainda não viu ou ele saiu do n8n).', 404);
  const conf = montarConfirmacao(f, p.acao);
  if (!chaveN8n) throw new ErroDeAutomacao('sem_chave_do_n8n', 'A chave da API do n8n ainda não foi guardada no servidor (segredo N8N_API_KEY).', 503);

  const { data: registro } = await banco.from('automacao_acoes').insert({
    fluxo_id: f.id, fluxo_nome: f.nome, acao: p.acao, pedido_por: p.quemId, pedido_por_nome: p.quemNome,
    via: p.via, motivo: p.motivo ? String(p.motivo).slice(0, 300) : null, efeito_no_cliente: conf.efeito_no_cliente,
  }).select('id').single();

  let ok = false;
  let erro: string | null = null;
  let ativoAgora: boolean | null = null;
  try {
    const resp = await fetch(`${base}/workflows/${encodeURIComponent(f.id)}/${p.acao === 'ligar' ? 'activate' : 'deactivate'}`, {
      method: 'POST',
      headers: { 'X-N8N-API-KEY': chaveN8n, accept: 'application/json', 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(20_000),
    });
    const corpo = await resp.json().catch(() => ({}));
    if (resp.ok) {
      ok = true;
      ativoAgora = typeof corpo?.active === 'boolean' ? corpo.active : p.acao === 'ligar';
    } else {
      erro = mascarar(`n8n respondeu ${resp.status}: ${corpo?.message ?? ''}`);
    }
  } catch (e) {
    erro = mascarar(`n8n não respondeu: ${(e as Error)?.message ?? e}`);
  }
  if (registro?.id) {
    await banco.from('automacao_acoes').update({ resultado: ok ? 'feito' : 'falhou', erro, concluido_em: new Date().toISOString() }).eq('id', registro.id);
  }
  if (ok) {
    await banco.from('automacao_fluxos').update({ ativo: ativoAgora, proxima_execucao: ativoAgora ? undefined : null }).eq('id', f.id);
  }
  if (!ok) throw new ErroDeAutomacao('n8n_recusou', erro ?? 'O n8n não aceitou o pedido.', 502);
  return { ok: true, fluxo_id: f.id, fluxo_nome: f.nome, ativo: ativoAgora, efeito_no_cliente: conf.efeito_no_cliente, registrado_por: p.quemNome };
}
