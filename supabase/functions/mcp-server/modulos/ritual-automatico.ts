/**
 * Texto do ritual por automação (MCP 2.10.0, 14/10/2026).
 *
 * O escritor do ritual (ritual-writer) só atende pessoa logada: ele lê e grava com o login de quem pede e,
 * de quebra, transforma combinados em tarefas urgentes. Automação (n8n, Hermes) precisa do MESMO texto sem
 * usar o login de ninguém e sem efeito colateral. Esta função:
 *
 * - lê o contexto do ritual, o estado real e os julgamentos com o cliente de serviço (o escopo da chave
 *   vale: cliente fora do escopo é recusado antes de qualquer leitura);
 * - escreve com o mesmo escritor da Central (escreverRitual, mesmo modelo, mesmo método);
 * - NÃO grava relatório, NÃO cria nem altera tarefa, NÃO avisa equipe e NÃO envia nada;
 * - devolve o texto marcado como proposta automática, nunca como "confirmado pelo dono".
 *
 * Quem quiser guardar o texto usa aceleriq_create_report_draft e a revisão (aceleriq_central_review_preparar).
 */

import { db, isUuid } from '../../_shared/aceleriq-read-services.ts';
import { assertClientAccess, type AuthContext } from '../../_shared/mcp-auth.ts';
import { exigirClienteExistente } from '../../_shared/mcp-client-id-guard.ts';
import { recortarDossie } from '../../_shared/dossie-recortado.ts';
import { jevPerguntar } from '../../_shared/jev.ts';
import { escolhaDoModelo } from '../../_shared/modelo-da-central.ts';
import { estadoRealComoTexto, evidenciasDoEstado, lerEstadoReal } from '../../_shared/estado-real-do-cliente.ts';
import { registrarMetodoSemUso, superpoderesPara } from '../../_shared/superpoderes.ts';
import { julgarDaCentral, promessasComoTexto, rotuloDoCanal } from '../../ritual-writer/modulos/julgamentos-da-central.ts';
import { conferirRepeticao, escreverRitual, RITUAL_BRIEF } from '../../ritual-writer/escritor.ts';
import { lerContextoDoRitual } from '../../ritual-writer/contexto.ts';
import { extrairMemoriaDoRitual } from '../../ritual-writer/memoria.ts';
import { chaveDaPromessa } from '../../ritual-writer/reforco.ts';

export const RITUAIS_DA_AUTOMACAO = ['rota_semana', 'meio_semana', 'prova_movimento'] as const;
export type RitualDaAutomacao = typeof RITUAIS_DA_AUTOMACAO[number];

export async function ritualRedigirPorAutomacao(
  input: { client_id: string; ritual: RitualDaAutomacao; fatos?: string },
  ctx: AuthContext,
) {
  if (!isUuid(input.client_id)) throw new Error('client_id must be a UUID');
  if (!RITUAL_BRIEF[input.ritual]) throw new Error('ritual inválido: use rota_semana, meio_semana ou prova_movimento.');
  assertClientAccess(ctx, input.client_id);
  await exigirClienteExistente(db(), input.client_id);

  const banco = db();
  const agora = new Date();
  const [{ data: perfil }, { data: dossie }] = await Promise.all([
    banco.from('profiles').select('company_name, full_name').eq('id', input.client_id).maybeSingle(),
    banco.from('client_dossiers').select('content, summary, version').eq('client_id', input.client_id)
      .eq('dossier_type', 'contexto').eq('is_current', true).limit(1).maybeSingle(),
  ]);
  const clientName = String(perfil?.company_name || perfil?.full_name || 'Cliente').slice(0, 120);
  const contactName = String(perfil?.full_name || '').trim().split(/\s+/)[0]?.slice(0, 40) || '';
  // Os fatos são os que o chamador mandou ou, sem isso, o dossiê atual (começo curto e fim, como na Central).
  const fatosBrutos = input.fatos?.trim() || [dossie?.summary, dossie?.content].filter(Boolean).join('\n\n');
  const facts = recortarDossie(fatosBrutos, 12000);
  if (!facts) throw new Error('Sem fatos para escrever: o cliente não tem dossiê de contexto e nenhum fato foi enviado.');

  const metodoP = superpoderesPara(banco, { agente: 'rituais.escritor' });
  const contexto = await lerContextoDoRitual(banco, input.client_id, { ritual: input.ritual, excluirReportId: null, agora }).catch(() => null);
  const estado = await lerEstadoReal(banco, input.client_id, { agora, desde: contexto?.desde ?? null }).catch(() => null);

  const ultimoEnviado = contexto?.anteriores.find((r) => r.situacao === 'enviado') ?? null;
  const memUltimo = ultimoEnviado ? (ultimoEnviado.memoria ?? extrairMemoriaDoRitual(ultimoEnviado.texto, ultimoEnviado.proximo_passo)) : null;
  const promessas = (memUltimo?.promessas ?? []).slice(0, 6).map((texto) => ({
    id: chaveDaPromessa(ultimoEnviado?.id, texto),
    texto,
    feitaEm: new Date(ultimoEnviado!.quando).toISOString(),
  }));
  const confirmadas = new Set((estado?.operacao.tarefasDaCentral ?? []).filter((t) => t.status === 'done').map((t) => t.source));
  const evidencias = [
    ...(contexto?.movimentos ?? []).map((m) => ({ quando: new Date(m.quando).toISOString(), texto: m.titulo + (m.detalhe ? ` (${m.detalhe})` : '') })),
    ...(estado ? evidenciasDoEstado(estado) : []).map((x) => ({ quando: new Date(x.quando).toISOString(), texto: x.texto })),
  ];
  const julgados = estado
    ? await julgarDaCentral({
      cliente: clientName,
      campanhas: estado.campanhasDaMesa,
      anunciosNoAr: estado.pago.campanhasNoAr.map((c) => c.nome),
      promessas,
      evidencias,
      confirmadasPeloDono: confirmadas,
    }, jevPerguntar).catch(() => null)
    : null;
  const estadoTexto = estado
    ? estadoRealComoTexto(estado, { ritual: input.ritual, canais: (julgados?.campanhas ?? []).map((c) => ({ id: c.id, rotulo: rotuloDoCanal(c.canal) })) })
    : '';

  const metodo = await metodoP;
  const escrito = await escreverRitual({
    ritual: input.ritual, clientName, contactName, facts,
    continuidade: contexto?.texto,
    estado: estadoTexto,
    promessas: julgados ? promessasComoTexto(julgados.promessas) : '',
    clientId: input.client_id,
    criadoPor: ctx.dataScope?.principalUserId ?? null,
    escolha: escolhaDoModelo(undefined, undefined),
    metodo,
  });
  if (escrito && !escrito.uso_id) void registrarMetodoSemUso(banco, { metodo, clientId: input.client_id });
  if (!escrito) {
    return { ok: false, origem: 'automacao', motivo: 'O escritor não respondeu agora. Nada foi gravado.', title: null, body: null, next_steps: null };
  }
  const repeticao = contexto
    ? await conferirRepeticao(escrito.body, contexto.anteriores.map((a) => ({ quando: a.quando, titulo: a.titulo, texto: a.texto }))).catch(() => null)
    : null;
  return {
    ok: true,
    origem: 'automacao',
    confirmado_pelo_dono: false,
    ritual: input.ritual,
    dossie_versao: dossie?.version ?? null,
    title: escrito.title,
    body: escrito.body,
    next_steps: escrito.next_steps,
    alertas: [
      ...(escrito.reserva ? [escrito.reserva] : []),
      ...(escrito.robo.length ? [`Expressões de molde no texto: ${escrito.robo.join(', ')}. Vale trocar antes de enviar.`] : []),
      ...escrito.alertas,
    ].slice(0, 6),
    tarefas_sugeridas: escrito.tarefas_sugeridas,
    repeticao,
    memoria: extrairMemoriaDoRitual(escrito.body, escrito.next_steps),
    promessas: julgados?.promessas.map((p) => ({ texto: p.texto, situacao: p.situacao, prova: p.prova?.texto ?? null })) ?? [],
    model: escrito.model,
    custo_usd: escrito.custo_usd,
    aviso: 'Texto proposto por automação. Nada foi gravado, nenhuma tarefa foi criada e nada foi enviado. Para guardar: aceleriq_create_report_draft; para aprovar e enviar: a Revisão do Ciclo.',
  };
}
