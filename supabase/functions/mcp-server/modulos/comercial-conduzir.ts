/**
 * O Mercúrio conduz até o contrato (MCP 2.23, 28/10/2026): pede a proposta e
 * o acesso ao Aceleriq de Bolso, sempre com aprovação humana.
 *
 * - Pedir proposta: monta o rascunho do lead (proposta-do-lead.ts) com o
 *   preço do catálogo. Lead que já é cliente vira proposta em rascunho na Mesa
 *   Proposta na hora; lead sem ficha fica em commercial_pedidos_proposta e a
 *   Mesa usa o rascunho quando o Almir cria o cliente. Nada é enviado: o link
 *   público só nasce quando o Almir envia (pedir de novo devolve o link).
 * - Bolso: o pedido registra o anual (política aprovada e valor) e o checkout
 *   pronto para quando o pagamento for ligado (BOLSO_CHECKOUT_ANUAL_URL). A
 *   liberação só concede depois de o pagamento ser confirmado por uma pessoa
 *   da administração ou pelo vendas-webhook (comercial_bolso_liberar_por_agente).
 *   Comprovante em imagem nunca libera: nenhuma entrada daqui aceita um.
 *
 * Tudo avisa a Caixa do comercial (o sino da equipe). Banco:
 * supabase/migrations/20261028090000_mercurio_proposta_e_bolso.sql.
 */

import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { db, isUuid, READ_LIMITS } from '../../_shared/aceleriq-read-services.ts';
import { lerDadosDaAgencia } from '../../_shared/dados-da-agencia.ts';
import { blocosDaAgencia } from '../../mesa-proposta/agencia.ts';
import { resolvePublicAppUrl } from '../../_shared/public-url.ts';
import {
  hojeEmSaoPaulo,
  type ItemDaProposta,
  MODELO_PADRAO_ACELERIQ,
  type MoedaDaProposta,
  normalizarModelo,
  numeroDaProposta,
  somarDias,
  totaisDosItens,
} from '../../_shared/proposta-modelo.ts';
import {
  itemDoServico,
  itemManual,
  itensDoPlano,
  juntarItens,
  montarRascunhoDoLead,
  type ItemManual,
  type PedidoDoAgente,
} from '../../_shared/proposta-do-lead.ts';

const SLUG = /^[a-z0-9_-]{2,40}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/;
/** Acesso anual aprovado pelo dono (docs/membros/BOLSO-PROPOSTA-COMERCIAL.md); a política pode trazer preco_anual_centavos. */
export const BOLSO_ANUAL_CENTAVOS = 9700;

const slug = (v: unknown) => {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (!s) return 'mercurio';
  if (!SLUG.test(s)) throw new Error('operador: use o slug do agente (ex.: mercurio).');
  return s;
};

async function comPrazo<T>(p: PromiseLike<T>, ms = READ_LIMITS.queryTimeoutMs): Promise<T> {
  return await Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Query timeout after ${ms}ms`)), ms)),
  ]);
}

function soDaCasa(ctx: AuthContext) {
  if (!ctx.dataScope.unrestricted) throw new Error('O comercial e area interna da casa: esta credencial e restrita a cliente e nao alcanca o CRM.');
}

function base(): string {
  try {
    return resolvePublicAppUrl().replace(/\/+$/, '');
  } catch {
    return 'https://aceleriq.online';
  }
}

async function exigirLead(id: string) {
  if (!isUuid(id)) throw new Error('lead_id must be a UUID');
  const { data, error } = await comPrazo(db().from('commercial_leads').select('id, name, company, email, whatsapp, stage, won_client_id, archived_at').eq('id', id).maybeSingle());
  if (error) throw new Error(`commercial_leads: ${error.message}`);
  if (!data) throw new Error('Lead nao encontrado. Confira o id na aceleriq_comercial_fila.');
  return data as Record<string, unknown>;
}

/** Aviso na Caixa (o banco toca o sino). Aviso "avancou" aberto nas últimas 6 h do mesmo lead é reaproveitado. */
async function avisarCaixa(leadId: string, resumo: string, proximo: string, dados: Record<string, unknown>, operador: string, telefone: string | null, reaproveitar: boolean) {
  if (reaproveitar) {
    const desde = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
    const { data: aberto } = await comPrazo(db().from('commercial_handoffs').select('id, dados').eq('lead_id', leadId).eq('tipo', 'avancou').eq('situacao', 'nova').gte('created_at', desde).limit(1));
    if (aberto && aberto.length) {
      const atual = aberto[0] as { id: string; dados?: Record<string, unknown> };
      await db().from('commercial_handoffs').update({ dados: { ...(atual.dados || {}), ...dados } }).eq('id', atual.id);
      return atual.id;
    }
  }
  const { data, error } = await comPrazo(db().from('commercial_handoffs').insert({
    lead_id: leadId, tipo: 'avancou', resumo: resumo.slice(0, 2000), proximo_passo: proximo.slice(0, 300), telefone, dados, operador_slug: operador,
  }).select('id').single());
  if (error) throw new Error(`commercial_handoffs: ${error.message}`);
  return String((data as { id: string }).id);
}

async function notaNoLead(leadId: string, nota: string) {
  await db().from('commercial_lead_events').insert({ lead_id: leadId, kind: 'nota', note: nota.slice(0, 400) });
}

// ─────────────────────────────────────────────────────────── proposta

export type PedirPropostaInput = PedidoDoAgente & {
  lead_id: string;
  plano_id?: string;
  servico_ids?: string[];
  itens_manuais?: ItemManual[];
  operador?: string;
};

async function itensDoCatalogo(input: PedirPropostaInput, moeda: MoedaDaProposta): Promise<ItemDaProposta[]> {
  const ids = (input.servico_ids || []).filter(Boolean);
  if (moeda !== 'BRL' && (input.plano_id || ids.length)) {
    throw new Error(`O catalogo do painel e em reais. Proposta em ${moeda}: mande os itens em itens_manuais com o valor da tabela do exterior (orientacoes).`);
  }
  let plano: ItemDaProposta[] = [];
  if (input.plano_id) {
    if (!isUuid(input.plano_id)) throw new Error('plano_id must be a UUID');
    const [{ data: p, error: e1 }, { data: v, error: e2 }] = await Promise.all([
      comPrazo(db().from('financial_plans').select('id, name, description, is_active, archived_at').eq('id', input.plano_id).maybeSingle()),
      comPrazo(db().from('financial_plan_versions').select('final_amount, billing_period, setup_fee, valid_from').eq('plan_id', input.plano_id).eq('is_active', true).order('valid_from', { ascending: false }).limit(1)),
    ]);
    if (e1 || e2) throw new Error(`financial_plans: ${(e1 || e2)!.message}`);
    if (!p || (p as { archived_at?: string | null }).archived_at) throw new Error('Plano nao encontrado ou arquivado. Veja os planos com aceleriq_list_finance_plans.');
    const versao = Array.isArray(v) ? v[0] : null;
    if (!versao) throw new Error('O plano nao tem versao vigente com preco. Peca na Caixa.');
    plano = itensDoPlano(p as { id: string; name: string; description?: string }, versao as { final_amount: number });
  }
  let servicos: ItemDaProposta[] = [];
  if (ids.length) {
    if (ids.some((id) => !isUuid(id))) throw new Error('servico_ids: use os ids da biblioteca de servicos.');
    const { data, error } = await comPrazo(db().from('proposta_servicos').select('id, nome, descricao, preco, recorrencia, horas').in('id', ids).is('arquivado_em', null));
    if (error) throw new Error(`proposta_servicos: ${error.message}`);
    const achados = (data || []) as Array<{ id: string; nome: string; descricao: string | null; preco: number; recorrencia: string; horas: number | null }>;
    const faltam = ids.filter((id) => !achados.some((s) => s.id === id));
    if (faltam.length) throw new Error(`Servico nao encontrado ou arquivado: ${faltam.join(', ')}.`);
    servicos = ids.map((id) => achados.find((s) => s.id === id)!).reduce((t, s) => t.concat(itemDoServico(s)), [] as ItemDaProposta[]);
  }
  const manuais = (input.itens_manuais || []).reduce((t, m) => t.concat(itemManual(m)), [] as ItemDaProposta[]);
  return juntarItens(plano, servicos, manuais);
}

async function modeloPadrao() {
  const { data } = await db().from('proposta_modelos').select('id, nome, descricao, padrao, blocos, validade_dias, condicoes').is('arquivado_em', null).eq('padrao', true).maybeSingle();
  return data ? { id: String((data as { id: string }).id), modelo: normalizarModelo(data) } : { id: null, modelo: MODELO_PADRAO_ACELERIQ };
}

async function agencia() {
  try {
    return blocosDaAgencia(await lerDadosDaAgencia(db()));
  } catch {
    return null;
  }
}

/** Insere com o próximo número do ano (a mesma regra da Mesa: até 4 tentativas se o número já foi usado). */
async function inserirProposta(linha: Record<string, unknown>) {
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const ano = Number(hojeEmSaoPaulo().slice(0, 4));
    const { count } = await db().from('propostas').select('id', { count: 'exact', head: true }).like('numero', `${ano}-%`);
    const numero = numeroDaProposta(ano, (count || 0) + 1);
    const { data, error } = await db().from('propostas').insert({ ...linha, numero: tentativa ? `${numero}-${tentativa + 1}` : numero }).select('id, numero, status, client_id').single();
    if (!error) return data as { id: string; numero: string; status: string; client_id: string };
    if ((error as { code?: string }).code !== '23505') throw new Error(`propostas: ${error.message}`);
  }
  throw new Error('propostas: numero em uso; tente de novo.');
}

/** Estado de uma proposta para o agente: o link público só existe depois de o Almir enviar. */
async function situacaoDaProposta(id: string | null) {
  if (!id) return null;
  const { data } = await db().from('propostas').select('id, numero, status, token, client_id, validade_ate, arquivada_em').eq('id', id).maybeSingle();
  if (!data) return null;
  const p = data as { id: string; numero: string; status: string; token: string | null; client_id: string; validade_ate: string | null; arquivada_em: string | null };
  const enviada = p.status !== 'rascunho' && !!p.token;
  return {
    id: p.id, numero: p.numero, status: p.status, validade_ate: p.validade_ate, arquivada: !!p.arquivada_em,
    link_mesa: `/mesa-proposta?client=${p.client_id}&proposta=${p.id}`,
    link_publico: enviada ? `${base()}/proposta/${p.token}` : null,
  };
}

function respostaDoPedido(pedido: Record<string, unknown>, proposta: Awaited<ReturnType<typeof situacaoDaProposta>>, extra: Record<string, unknown> = {}) {
  const leadId = String(pedido.lead_id);
  const enviada = !!(proposta && proposta.link_publico);
  return {
    pedido_id: pedido.id,
    situacao: pedido.situacao,
    proposta,
    link_publico: enviada ? proposta!.link_publico : null,
    link_mesa: proposta ? proposta.link_mesa : `/mesa-proposta?lead=${leadId}`,
    observacao: enviada
      ? 'A proposta foi enviada pelo Almir: mande o link_publico ao lead.'
      : proposta
        ? 'Rascunho na Mesa Proposta esperando o Almir aprovar e enviar. Nao prometa preco nem prazo alem do que esta nos itens; o link publico nasce no envio (chame esta ferramenta de novo para pegar).'
        : 'O lead ainda nao e cliente: o rascunho esta guardado e entra na Mesa Proposta quando o Almir criar o cliente. Nada foi enviado.',
    ...extra,
  };
}

export async function comercialPedirProposta(input: PedirPropostaInput, ctx: AuthContext) {
  soDaCasa(ctx);
  const operador = slug(input.operador);
  const lead = await exigirLead(input.lead_id);
  if (lead.archived_at) throw new Error('Lead arquivado: nao pede proposta.');

  // Um pedido por vez: o aberto (ou o rascunho ainda nao enviado) volta, com o estado e o link quando houver.
  const { data: anteriores, error: e0 } = await comPrazo(db().from('commercial_pedidos_proposta').select('*').eq('lead_id', lead.id).neq('situacao', 'descartado').order('criado_em', { ascending: false }).limit(1));
  if (e0) throw new Error(`commercial_pedidos_proposta: ${e0.message}`);
  const anterior = (anteriores || [])[0] as Record<string, unknown> | undefined;
  if (anterior) {
    const proposta = await situacaoDaProposta((anterior.proposta_id as string | null) || null);
    const viva = anterior.situacao === 'aguardando_cliente' || (proposta && !proposta.arquivada && ['rascunho', 'enviada', 'vista'].indexOf(proposta.status) >= 0);
    if (viva) return respostaDoPedido(anterior, proposta, { ja_existia: true });
  }

  const moeda: MoedaDaProposta = input.moeda === 'USD' || input.moeda === 'EUR' ? input.moeda : 'BRL';
  const itens = await itensDoCatalogo(input, moeda);
  const [{ id: modeloId, modelo }, daAgencia] = await Promise.all([modeloPadrao(), agencia()]);
  const hoje = hojeEmSaoPaulo();
  const pedidoDoAgente: PedidoDoAgente = {
    negocio: input.negocio, dor: input.dor, plano_sugerido: input.plano_sugerido, avulsos: input.avulsos,
    verba: input.verba, moeda, palavras_do_cliente: input.palavras_do_cliente, observacoes: input.observacoes,
  };
  const r = montarRascunhoDoLead({ modelo, lead, pedido: pedidoDoAgente, itens, operador, hoje, agencia: daAgencia });
  const totais = totaisDosItens(r.itens);
  const clientId = (lead.won_client_id as string | null) || null;

  let proposta: { id: string; numero: string } | null = null;
  if (clientId) {
    proposta = await inserirProposta({
      client_id: clientId, lead_id: lead.id, modelo_id: modeloId, titulo: r.titulo, conteudo: r.conteudo, itens: r.itens,
      total_unico: totais.unico, total_mensal: totais.mensal, validade_ate: somarDias(hoje, modelo.validade_dias),
      contexto: { notas: r.notas }, criado_por: null,
    });
    await db().from('proposta_eventos').insert({ proposta_id: proposta.id, client_id: clientId, tipo: 'criada', dados: { modelo_id: modeloId, lead_id: lead.id, tipo: 'nova', origem: 'agente', operador } });
  }

  const { data: pedido, error } = await comPrazo(db().from('commercial_pedidos_proposta').insert({
    lead_id: lead.id, operador_slug: operador, situacao: proposta ? 'rascunho_criado' : 'aguardando_cliente', moeda,
    pedido: { ...pedidoDoAgente, plano_id: input.plano_id || null, servico_ids: input.servico_ids || [], itens_manuais: input.itens_manuais || [] },
    conteudo: r.conteudo, itens: r.itens, notas: r.notas, proposta_id: proposta ? proposta.id : null,
  }).select('*').single());
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new Error('Ja existe um pedido de proposta aberto para este lead. Chame de novo para ver o estado.');
    throw new Error(`commercial_pedidos_proposta: ${error.message}`);
  }
  const p = pedido as Record<string, unknown>;

  const handoff = await avisarCaixa(
    String(lead.id),
    `Pediu proposta. ${r.titulo}: ${String(input.negocio).slice(0, 300)}${r.itens.length ? ` | ${r.total}` : ''}`,
    proposta ? 'Revisar, gerar o texto e aprovar o rascunho na Mesa Proposta; depois enviar.' : 'Criar o cliente na Mesa Proposta (o rascunho do Mercurio entra sozinho), revisar e aprovar.',
    { pedido_proposta_id: p.id, proposta_id: proposta ? proposta.id : null, moeda, total: r.total, link: proposta ? `/mesa-proposta?client=${clientId}&proposta=${proposta.id}` : `/mesa-proposta?lead=${lead.id}` },
    operador, (lead.whatsapp as string | null) || null, true,
  );
  await db().from('commercial_pedidos_proposta').update({ handoff_id: handoff }).eq('id', p.id);
  await notaNoLead(String(lead.id), `${operador} pediu proposta${proposta ? ` (rascunho ${proposta.numero} na Mesa Proposta)` : ' (esperando o cliente ser criado)'}: ${r.total}.`);

  return respostaDoPedido(p, await situacaoDaProposta(proposta ? proposta.id : null), {
    criado: true, itens: r.itens.length, total: r.total, pendencias: r.pendencias, caixa: { avisada: true, item: handoff },
  });
}

// ─────────────────────────────────────────────────────────── Aceleriq de Bolso

/** Link de checkout pronto (BOLSO_CHECKOUT_ANUAL_URL, só https), com o e-mail preenchido. Sem a variável: desligado. */
const lerAmbiente = (nome: string): string => {
  const runtime = globalThis as { Deno?: { env?: { get?: (k: string) => string | undefined } } };
  return runtime.Deno?.env?.get?.(nome) || '';
};

export function checkoutDoBolso(email: string, configurado = lerAmbiente('BOLSO_CHECKOUT_ANUAL_URL')): string | null {
  const url = configurado.trim();
  if (!/^https:\/\/[^\s/@]+(\/|\?|$)/.test(url)) return null;
  return `${url}${url.indexOf('?') >= 0 ? '&' : '?'}email=${encodeURIComponent(email)}`;
}

export const COMO_PAGAR_SEM_CHECKOUT = 'O checkout ainda nao esta ligado: nao mande link de pagamento. A equipe combina o pagamento com o lead e o Almir confirma no painel.';
export const COMPROVANTE_NAO_LIBERA = 'Comprovante (print, foto, PDF) nunca libera o acesso: so libera depois que a equipe confere o dinheiro ou o gateway confirma a compra.';

function centavosDaPolitica(dados: unknown): number {
  const v = dados && typeof dados === 'object' ? Number((dados as Record<string, unknown>).preco_anual_centavos) : NaN;
  return Number.isInteger(v) && v > 0 ? v : BOLSO_ANUAL_CENTAVOS;
}

const reais = (centavos: number) => `R$ ${Math.floor(centavos / 100)},${String(centavos % 100).padStart(2, '0')}`;

function respostaDoBolso(p: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const url = (p.checkout_url as string | null) || null;
  return {
    pedido_id: p.id,
    situacao: p.situacao,
    email: p.email,
    valor: reais(Number(p.valor_centavos)),
    produto: 'Aceleriq de Bolso, acesso anual (12 meses) com os creditos iniciais da politica aprovada',
    checkout: url ? { ligado: true, url } : { ligado: false, url: null, aviso: COMO_PAGAR_SEM_CHECKOUT },
    regra: COMPROVANTE_NAO_LIBERA,
    ...extra,
  };
}

export async function comercialBolsoPedir(input: { lead_id: string; email?: string; observacao?: string; operador?: string }, ctx: AuthContext) {
  soDaCasa(ctx);
  const operador = slug(input.operador);
  const lead = await exigirLead(input.lead_id);
  const email = String(input.email || lead.email || '').trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 120) throw new Error('email: o e-mail da conta da area de membros (pergunte ao lead; o acesso vai para a conta com esse e-mail).');

  const { data: abertos, error: e0 } = await comPrazo(db().from('commercial_bolso_pedidos').select('*').eq('lead_id', lead.id).in('situacao', ['aguardando_pagamento', 'pagamento_confirmado']).limit(1));
  if (e0) throw new Error(`commercial_bolso_pedidos: ${e0.message}`);
  if (abertos && abertos.length) return respostaDoBolso(abertos[0] as Record<string, unknown>, { ja_existia: true });

  const { data: politicas, error: e1 } = await comPrazo(db().from('bolso_politicas').select('id, versao, dados').eq('estado', 'aprovado').eq('teste', false).order('versao', { ascending: false }).limit(1));
  if (e1) throw new Error(`bolso_politicas: ${e1.message}`);
  const politica = (politicas || [])[0] as { id: string; versao: number; dados: unknown } | undefined;
  if (!politica) throw new Error('Nao ha politica comercial aprovada do Aceleriq de Bolso. Nao venda agora; avise a Caixa.');
  const valor = centavosDaPolitica(politica.dados);
  const checkoutUrl = checkoutDoBolso(email);

  const { data: pedido, error } = await comPrazo(db().from('commercial_bolso_pedidos').insert({
    lead_id: lead.id, operador_slug: operador, email, produto: 'anual', politica_id: politica.id, valor_centavos: valor, moeda: 'BRL', situacao: 'aguardando_pagamento',
    checkout_url: checkoutUrl, observacao: String(input.observacao || '').trim().slice(0, 1000),
  }).select('*').single());
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new Error('Ja existe um pedido do Bolso aberto para este lead. Chame aceleriq_comercial_bolso_liberar para ver o estado.');
    throw new Error(`commercial_bolso_pedidos: ${error.message}`);
  }
  const p = pedido as Record<string, unknown>;
  const handoff = await avisarCaixa(
    String(lead.id),
    `Quer o Aceleriq de Bolso (anual, ${reais(valor)}) na conta ${email}.${checkoutUrl ? ' Link de checkout enviado.' : ' Checkout desligado: combinar o pagamento.'}`,
    'Conferir o pagamento no banco ou no gateway e tocar em Confirmar pagamento do Bolso (comprovante em imagem nao vale).',
    { bolso_pedido_id: p.id, email, valor: reais(valor), checkout: checkoutUrl ? 'ligado' : 'desligado' },
    operador, (lead.whatsapp as string | null) || null, false,
  );
  await db().from('commercial_bolso_pedidos').update({ handoff_id: handoff }).eq('id', p.id);
  await notaNoLead(String(lead.id), `${operador} registrou o pedido do Aceleriq de Bolso (anual, ${reais(valor)}) para ${email}.`);
  return respostaDoBolso(p, {
    criado: true,
    caixa: { avisada: true, item: handoff },
    proximo_passo: 'Quando o lead disser que pagou, chame aceleriq_comercial_bolso_liberar. Ate liberar, nao diga que o acesso esta ativo.',
  });
}

export async function comercialBolsoLiberar(input: { pedido_id?: string; lead_id?: string; operador?: string }, ctx: AuthContext) {
  soDaCasa(ctx);
  const operador = slug(input.operador);
  let qb = db().from('commercial_bolso_pedidos').select('*');
  if (input.pedido_id) {
    if (!isUuid(input.pedido_id)) throw new Error('pedido_id must be a UUID');
    qb = qb.eq('id', input.pedido_id);
  } else if (input.lead_id) {
    if (!isUuid(input.lead_id)) throw new Error('lead_id must be a UUID');
    qb = qb.eq('lead_id', input.lead_id).neq('situacao', 'cancelado').order('criado_em', { ascending: false });
  } else throw new Error('Informe pedido_id ou lead_id.');
  const { data: achados, error: e0 } = await comPrazo(qb.limit(1));
  if (e0) throw new Error(`commercial_bolso_pedidos: ${e0.message}`);
  const p = (achados || [])[0] as Record<string, unknown> | undefined;
  if (!p) throw new Error('Pedido do Bolso nao encontrado. Registre antes com aceleriq_comercial_bolso_pedir.');

  const { data, error } = await db().rpc('comercial_bolso_liberar_por_agente', { _pedido: p.id, _operador: operador });
  if (error) throw new Error(`comercial_bolso_liberar_por_agente: ${error.message}`);
  const r = (data || {}) as { liberado?: boolean; ja_liberado?: boolean; motivo?: string; direito_id?: string };
  const { data: depois } = await db().from('commercial_bolso_pedidos').select('*').eq('id', p.id).maybeSingle();
  const atual = (depois || p) as Record<string, unknown>;
  if (r.liberado) {
    return respostaDoBolso(atual, {
      liberado: true, ja_liberado: !!r.ja_liberado, direito_id: r.direito_id,
      acesso: `${base()}/membros`,
      mensagem_sugerida: `Pronto: o Aceleriq de Bolso esta liberado na conta ${atual.email}. Entre em ${base()}/membros.`,
    });
  }
  if (r.motivo === 'conta_ausente') {
    return respostaDoBolso(atual, {
      liberado: false, motivo: 'conta_ausente',
      orientacao: `Pagamento confirmado, mas nao ha conta confirmada com ${atual.email}. Peca ao lead para criar a conta em ${base()}/login com esse e-mail e confirmar o e-mail; depois chame de novo.`,
    });
  }
  return respostaDoBolso(atual, {
    liberado: false, motivo: 'pagamento_nao_confirmado', nao_insistir: true,
    orientacao: 'Pagamento ainda nao confirmado pela equipe nem pelo gateway. Nao diga que liberou e nao aceite comprovante como prova. Chame de novo depois (no maximo a cada 30 min) ou quando a equipe avisar.',
  });
}
