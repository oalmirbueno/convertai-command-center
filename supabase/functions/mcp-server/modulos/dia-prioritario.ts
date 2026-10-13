/**
 * Dia Prioritário para o Hermes (MCP 2.9.0, 12/10/2026). A fonte oficial é public.cliente_dia_prioritario
 * (nunca um texto de prompt). Duas ferramentas:
 *
 * - diaPrioritarioLer: a distribuição da semana e, para a data pedida (padrão hoje em São Paulo), os
 *   clientes do dia com a preparação feita de dados reais: tarefas abertas e atrasadas do Kanban,
 *   captações que vêm aí (e se caem no dia), últimos registros do Dia Prioritário, a última mensagem
 *   de ritual e o resumo do dossiê atual. Só leitura.
 * - diaPrioritarioRegistrar: grava o que aconteceu (ligação, reunião, mensagem, alinhamento interno ou
 *   "sem necessidade de contato") pelo mesmo caminho da tela (RPC dia_prioritario_registrar), que vai
 *   ao histórico do cliente e coloca o dossiê na fila. Não envia nada ao cliente.
 *
 * O escopo de dados da chave vale em tudo: cliente fora do escopo some da leitura e barra a escrita.
 */

import { db, isUuid } from '../../_shared/aceleriq-read-services.ts';
import { assertClientAccess, canAccessClient, type AuthContext } from '../../_shared/mcp-auth.ts';
import { exigirClienteExistente } from '../../_shared/mcp-client-id-guard.ts';
import { findIdempotentResult } from '../../_shared/mcp-write-services.ts';
import {
  COMO_USAR_O_DIA_PRIORITARIO,
  dataEmSP,
  diaDaSemanaDaData,
  diaNaOperacao,
  DIAS_UTEIS,
  ehCaptacao,
  nomeDoDia,
  proximaData,
  textoDaCaptacao,
  type TipoDeRegistro,
} from './dia-prioritario-regras.ts';

type Linha = Record<string, unknown>;

export { COMO_USAR_O_DIA_PRIORITARIO };

async function nomesDosClientes(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { data } = await db().from('profiles').select('id, company_name, full_name').in('id', ids);
  return new Map(((data ?? []) as Linha[]).map((p) => [String(p.id), String(p.company_name || p.full_name || 'Cliente')]));
}

export async function diaPrioritarioLer(input: { data?: string; client_id?: string }, ctx: AuthContext) {
  const hoje = dataEmSP();
  const data = input.data && /^\d{4}-\d{2}-\d{2}$/.test(input.data) ? input.data : hoje;
  if (input.client_id) {
    if (!isUuid(input.client_id)) throw new Error('client_id must be a UUID');
    assertClientAccess(ctx, input.client_id);
    await exigirClienteExistente(db(), input.client_id);
  }
  const { data: linhas, error } = await db()
    .from('cliente_dia_prioritario')
    .select('client_id, dia, situacao, origem, observacao, dias_indisponiveis, atualizado_em');
  if (error) throw new Error('O Dia Prioritário não pôde ser lido agora.');
  const visiveis = ((linhas ?? []) as Linha[]).filter((l) => canAccessClient(ctx, String(l.client_id)));
  const nomes = await nomesDosClientes(visiveis.map((l) => String(l.client_id)));

  const distribuicao = DIAS_UTEIS.map((d) => ({
    dia: d.dia,
    nome: d.nome,
    clientes: visiveis
      .filter((l) => diaNaOperacao({ dia: l.dia as number, situacao: String(l.situacao) }) === d.dia)
      .map((l) => ({ client_id: String(l.client_id), nome: nomes.get(String(l.client_id)) || 'Cliente', situacao: String(l.situacao), observacao: (l.observacao as string) || null }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
  }));
  const naoAplicaveis = visiveis
    .filter((l) => l.situacao === 'nao_aplicavel')
    .map((l) => ({ client_id: String(l.client_id), nome: nomes.get(String(l.client_id)) || 'Cliente', observacao: (l.observacao as string) || null }));

  const diaDaData = diaDaSemanaDaData(data);
  const alvos = input.client_id
    ? visiveis.filter((l) => l.client_id === input.client_id)
    : visiveis.filter((l) => diaNaOperacao({ dia: l.dia as number, situacao: String(l.situacao) }) === diaDaData);

  const preparacao = await Promise.all(alvos.map((l) => prepararCliente(String(l.client_id), nomes.get(String(l.client_id)) || 'Cliente', l, hoje)));

  return {
    hoje,
    data,
    dia_da_semana: diaDaData >= 1 && diaDaData <= 5 ? nomeDoDia(diaDaData) : diaDaData === 6 ? 'sábado' : 'domingo',
    clientes_do_dia: input.client_id ? [] : preparacao.map((p) => p.client_id),
    preparacao,
    distribuicao,
    sem_dia_por_nao_se_aplicar: naoAplicaveis,
    como_usar: COMO_USAR_O_DIA_PRIORITARIO,
    caminho: '/central',
  };
}

async function prepararCliente(clientId: string, nome: string, l: Linha, hoje: string) {
  const dia = diaNaOperacao({ dia: l.dia as number, situacao: String(l.situacao) });
  const [tarefasR, registrosR, ritualR, dossieR] = await Promise.all([
    db().from('tasks').select('id, title, status, due_date, priority, projects!inner(client_id, deleted_at)')
      .eq('projects.client_id', clientId).is('projects.deleted_at', null).is('deleted_at', null)
      .not('status', 'in', '(done,archived,cancelled)').limit(300),
    db().from('project_memory').select('title, content, metadata, created_at')
      .eq('client_id', clientId).eq('kind', 'acao').eq('metadata->>origem', 'dia_prioritario')
      .order('created_at', { ascending: false }).limit(3),
    db().from('project_memory').select('title, created_at').eq('client_id', clientId).eq('kind', 'ritual')
      .order('created_at', { ascending: false }).limit(1),
    db().from('client_dossiers').select('summary').eq('client_id', clientId).eq('is_current', true)
      .eq('dossier_type', 'contexto').limit(1),
  ]);
  const tarefas = ((tarefasR.data ?? []) as Linha[]).map((t) => ({ id: String(t.id), title: String(t.title || ''), status: (t.status as string) || null, due_date: (t.due_date as string) || null, priority: (t.priority as string) || null }));
  const fimDaSemana = proximaData(5, new Date());
  const atrasadas = tarefas.filter((t) => t.due_date && t.due_date < hoje).sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  const daSemana = tarefas.filter((t) => t.due_date && t.due_date >= hoje && t.due_date <= fimDaSemana);
  const captacoes = tarefas.filter((t) => t.due_date && t.due_date >= hoje && ehCaptacao(t)).sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  return {
    client_id: clientId,
    nome,
    dia: dia ? nomeDoDia(dia) : null,
    situacao: String(l.situacao),
    observacao: (l.observacao as string) || null,
    proxima_data_do_dia: dia ? proximaData(dia, new Date()) : null,
    tarefas_abertas: tarefas.length,
    atrasadas: atrasadas.slice(0, 8).map((t) => ({ titulo: t.title, prazo: t.due_date, status: t.status })),
    desta_semana: daSemana.slice(0, 8).map((t) => ({ titulo: t.title, prazo: t.due_date, status: t.status })),
    captacoes: captacoes.slice(0, 5).map((t) => ({ titulo: t.title, data: t.due_date, no_dia: t.due_date && dia ? diaDaSemanaDaData(t.due_date) === dia : null, leitura: textoDaCaptacao(t.due_date, dia) })),
    captacao_preferencial: dia ? `Se precisar captar, a primeira data a considerar é ${proximaData(dia, new Date())} (Dia Prioritário), com confirmação prévia.` : null,
    ultimos_registros: ((registrosR.data ?? []) as Linha[]).map((r) => {
      const m = (r.metadata as { dia_prioritario?: Linha } | null)?.dia_prioritario || {};
      return { quando: r.created_at, tipo: (m.tipo as TipoDeRegistro) || null, titulo: r.title, combinados: m.combinados ?? null, proximos_passos: m.proximos_passos ?? null };
    }),
    ultimo_ritual: ((ritualR.data ?? []) as Linha[])[0] ? { titulo: ((ritualR.data as Linha[])[0].title as string) || null, quando: (ritualR.data as Linha[])[0].created_at } : null,
    dossie_resumo: ((dossieR.data ?? []) as Linha[])[0] ? String(((dossieR.data as Linha[])[0].summary as string) || '').slice(0, 900) || null : null,
  };
}

export async function diaPrioritarioRegistrar(
  input: { client_id: string; tipo: TipoDeRegistro; resumo?: string; combinados?: string; proximos_passos?: string; data?: string; idempotency_key: string },
  ctx: AuthContext,
) {
  if (!isUuid(input.client_id)) throw new Error('client_id must be a UUID');
  assertClientAccess(ctx, input.client_id);
  await exigirClienteExistente(db(), input.client_id);
  const anterior = await findIdempotentResult('aceleriq_dia_prioritario_registrar', ctx.keyId, input.idempotency_key).catch(() => null);
  if (anterior) {
    return { ok: true, replay: true, idempotency_replay_of: anterior.correlationId, ref: anterior.resultRef, aviso: 'Esta idempotency_key já foi usada: nada foi gravado de novo.' };
  }
  const { data, error } = await db().rpc('dia_prioritario_registrar', {
    _client_id: input.client_id,
    _tipo: input.tipo,
    _resumo: input.resumo ?? null,
    _combinados: input.combinados ?? null,
    _proximos_passos: input.proximos_passos ?? null,
    _data: input.data ?? null,
    _autor: ctx.dataScope?.principalUserId ?? null,
    _origem: 'hermes',
  });
  if (error) {
    const m = String(error.message || '');
    if (m.includes('DIA_PRIORITARIO_DATA_FUTURA')) throw new Error('A data não pode ser futura: registre o que já aconteceu.');
    if (m.includes('DIA_PRIORITARIO_TIPO_INVALIDO')) throw new Error('tipo inválido.');
    throw new Error('O registro não pôde ser gravado agora.');
  }
  if (ctx.resultRefHolder && data) ctx.resultRefHolder.value = `project_memory:${data}`;
  return {
    ok: true,
    id: data,
    aviso: 'Registrado no histórico do cliente (o dossiê se atualiza pela fila). Nada foi enviado ao cliente. Próximos passos viram tarefas só pelas ferramentas de tarefa, quando autorizados.',
  };
}
