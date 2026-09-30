/**
 * O ciclo do contrato na função contratos (frente CON2, 30/09/2026).
 *
 * - painel { client_id? } -> { painel: { aVencer, pendentes, assinadosNoMes, recorrenteMensal, ativos }, nomes }
 * - gerar_do_cliente { client_id, titulo? } -> payload + { origem, avisos, pergunta }
 *   (serviços ativos da ficha do cliente + plano do Financeiro + ficha fiscal)
 * - propostas_aceitas { client_id } -> { propostas }
 * - aditivo_criar { contract_id, descricao?, servicos? } -> payload do aditivo (rascunho)
 * - renovar { contract_id } -> payload da renovação (rascunho) + { ja_existia }
 * - lembrete { contract_id } -> { lembretes: [{ nome, papel, link, mensagens }] } (nada é enviado)
 * - lembrete_registrar { contract_id, canal } -> { ok } (a pessoa usou a mensagem)
 * - signatarios_salvar { contract_id, signatarios[] } -> payload (só rascunho)
 * - concluir_assinaturas { contract_id } -> { resultado } (todas as assinaturas já entraram)
 * - rotina_vencimentos (só o cron, com x-cron-secret)
 *
 * Valor, prazo e data nunca vêm do modelo de linguagem: saem do Financeiro,
 * da ficha, do contrato assinado ou da pessoa. Sem travessão.
 */
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { hojeEmSaoPaulo, lerMoeda, ROTULO_DO_SERVICO, type ServicoDoContrato, servicosEmOrdem, SERVICOS_RECORRENTES, type Valores } from "../_shared/contrato-modelo.ts";
import { efeitosDosAditivos, type LinhaDoPainel, mensagemDeLembrete, numeroDoAditivo, painelDosContratos, servicosDaFicha, validarSignatarios, valoresDaRenovacao, vigenciaDoContrato } from "../_shared/contrato-ciclo.ts";
import { valoresDaFicha } from "../_shared/contrato-ficha.ts";
import { fecharComSignatarios, lerSignatariosDoContrato } from "../_shared/contrato-assinaturas.ts";
import {
  bancoTemCon2,
  type Chamador,
  ErroHttp,
  evento,
  garantirAcesso,
  garantirGestao,
  idDe,
  json,
  lerLinha,
  type Linha,
  linkDeAssinatura,
  limpo,
  normalizarLinha,
  type Nucleo,
  selecionarContratos,
  semTabela,
  servico,
} from "./base.ts";
import { lerFichaDoCliente } from "./ficha.ts";
import { lerPreferencias } from "./modelos.ts";

const CAMPOS_DO_PAINEL = "id, client_id, title, numero, versao, status, origem, tipo_documento, contrato_mae_id, renovacao_de, servicos, variaveis, vigencia_fim, sent_at, congelado_em, client_signed_at, arquivado_em, substituido_por, lembrete_em, created_by";

const FORMA_DE_PAGAMENTO: Record<string, string> = { pix: "PIX", boleto: "boleto bancário", cartao: "cartão de crédito", transferencia: "transferência bancária" };

// ------------------------------------------------------------------ signatários

async function gravarSignatarios(ch: Chamador, l: Linha, lista: ReturnType<typeof validarSignatarios>["lista"]) {
  const { error: apagar } = await servico().from("contrato_signatarios").delete().eq("contract_id", l.id);
  if (apagar) throw semTabela(apagar) ? new ErroHttp(503, "banco_sem_signatarios", "O banco ainda não tem a lista de signatários (migration 20260930195100 pendente).") : new ErroHttp(409, "signatarios_nao_gravados", apagar.message);
  if (!lista.length) return;
  const linhas = lista.map((s) => ({
    contract_id: l.id,
    client_id: l.client_id,
    papel: s.papel,
    principal: !!s.principal,
    ordem: s.ordem,
    nome: s.nome,
    email: s.email,
    documento: s.documento || null,
    obrigatorio: s.obrigatorio,
    criado_por: ch.userId || null,
    // O principal usa o link de sempre do contrato.
    ...(s.principal ? { token: l.sign_token } : {}),
  }));
  const { error } = await servico().from("contrato_signatarios").insert(linhas);
  if (error) throw new ErroHttp(409, "signatarios_nao_gravados", "A lista de quem assina não foi gravada.", { detalhe: error.message });
}

/** Versão nova e renovação levam a mesma lista (links novos; ninguém assinou ainda). */
export async function copiarSignatarios(ch: Chamador, deId: string, para: Linha) {
  const { lista, erro } = await lerSignatariosDoContrato(servico(), deId);
  if (erro) registrarFalha("contratos: signatários não copiados", new Error(erro), { de: deId, para: para.id });
  if (!lista.length) return;
  const v = validarSignatarios(lista.map((s) => ({ papel: s.papel, nome: s.nome, email: s.email, documento: s.documento || "", obrigatorio: s.obrigatorio })));
  try {
    await gravarSignatarios(ch, para, v.lista);
  } catch (e) {
    registrarFalha("contratos: signatários não copiados", e, { de: deId, para: para.id });
  }
}

// ------------------------------------------------------------------ aditivo e renovação

async function aditivosDe(maeIds: string[]): Promise<LinhaDoPainel[]> {
  if (!maeIds.length) return [];
  const { data, error } = await servico().from("contracts").select(CAMPOS_DO_PAINEL).in("contrato_mae_id", maeIds).eq("tipo_documento", "aditivo").limit(500);
  if (error) {
    registrarFalha("contratos: aditivos não lidos", error);
    return [];
  }
  return ((data as unknown[] | null) ?? []).map((d) => normalizarLinha(d) as unknown as LinhaDoPainel);
}

export async function criarAditivo(ch: Chamador, n: Nucleo, maeId: string, p: { descricao?: string; servicos?: unknown }) {
  const mae = await lerLinha(ch, maeId, true);
  if (mae.origem !== "modelo") throw new ErroHttp(409, "contrato_de_arquivo", "Aditivo pelo modelo só sai de contrato montado por modelo.");
  if (mae.tipo_documento === "aditivo") throw new ErroHttp(409, "aditivo_de_aditivo", "O aditivo é sempre do contrato original: abra o contrato e crie o aditivo nele.");
  if (mae.status !== "completed" || !mae.documento_hash) throw new ErroHttp(409, "contrato_nao_assinado", "Aditivo só de contrato assinado pelas duas partes. Antes disso, crie uma versão nova.");
  const { data: irmaos, error } = await servico().from("contracts").select("id, status").eq("contrato_mae_id", mae.id).eq("tipo_documento", "aditivo").is("versao_de", null);
  if (error) throw semTabela(error) ? new ErroHttp(503, "banco_sem_ciclo", "O banco ainda não tem os aditivos (migration 20260930195100 pendente).") : new ErroHttp(503, "aditivos_indisponiveis", "Não foi possível ler os aditivos deste contrato.");
  const ordem = ((irmaos as Array<{ status: string }> | null) ?? []).filter((x) => x.status !== "cancelled").length + 1;
  const numero = numeroDoAditivo(mae.numero, ordem);
  const incluidos = servicosEmOrdem(Array.isArray(p.servicos) ? p.servicos : []).filter((s) => mae.servicos.indexOf(s) < 0);
  const extra: Valores = {};
  ["cliente_nome", "cliente_documento", "cliente_endereco", "cliente_representante", "cliente_email", "cliente_tipo_pessoa"].forEach((k) => {
    if (mae.variaveis[k]) extra[k] = mae.variaveis[k];
  });
  const descricao = limpo(p.descricao, 2000);
  if (descricao) extra.aditivo_descricao = descricao;
  extra.contrato_mae_numero = String(mae.numero || "");
  extra.contrato_mae_versao = String(mae.versao);
  extra.contrato_mae_assinado_em = String(mae.client_signed_at || "");
  extra.contrato_mae_hash = String(mae.documento_hash || "");
  const linha = await n.criarRascunho(ch, {
    clientId: mae.client_id,
    servicos: incluidos,
    titulo: `Aditivo ${ordem} ao contrato ${mae.numero || ""}`.trim(),
    extra,
    projectId: mae.project_id,
    tipoDocumento: "aditivo",
    contratoMaeId: mae.id,
    numero,
    origemDoEvento: "aditivo_criado",
    resumoDoEvento: `Rascunho do aditivo ${numero} ao contrato ${mae.numero || ""}.`,
  });
  await evento(mae, "aditivo_criado", `Aditivo ${numero} criado em rascunho.`, { aditivo_id: linha.id }, ch.userId || null);
  return linha;
}

export async function renovarContrato(ch: Chamador, n: Nucleo, id: string): Promise<{ linha: Linha; jaExistia: boolean }> {
  const l = await lerLinha(ch, id, true);
  if (l.origem !== "modelo") throw new ErroHttp(409, "contrato_de_arquivo", "Renovação pelo modelo só sai de contrato montado por modelo.");
  if (l.tipo_documento === "aditivo") throw new ErroHttp(409, "renovar_aditivo", "Renove o contrato original, não o aditivo.");
  if (l.status !== "completed") throw new ErroHttp(409, "contrato_nao_assinado", "Só contrato assinado é renovado.");
  const { data: ja, error } = await servico().from("contracts").select("id").eq("renovacao_de", l.id).is("versao_de", null).neq("status", "cancelled").limit(1);
  if (error) throw semTabela(error) ? new ErroHttp(503, "banco_sem_ciclo", "O banco ainda não tem a renovação (migration 20260930195100 pendente).") : new ErroHttp(503, "renovacao_indisponivel", "Não foi possível conferir a renovação.");
  const existente = ((ja as Array<{ id: string }> | null) ?? [])[0];
  if (existente) return { linha: await lerLinha(ch, existente.id), jaExistia: true };
  const hoje = hojeEmSaoPaulo();
  const ef = efeitosDosAditivos(l as unknown as LinhaDoPainel, await aditivosDe([l.id]), hoje);
  const fim = ef.fim || vigenciaDoContrato(l.variaveis, l.servicos).fim;
  if (!fim) throw new ErroHttp(409, "sem_vigencia", "Este contrato não tem fim de vigência (só projeto). Para um trabalho novo, crie um contrato novo.");
  const ficha = await lerFichaDoCliente(l.client_id).catch(() => null);
  const valores = valoresDaRenovacao({ valores: { ...l.variaveis, ...(ficha && ficha.existe ? valoresDaFicha(ficha.ficha) : {}) }, numero: l.numero, fim, valorMensal: ef.mensal || null });
  delete valores.proposta_numero;
  const titulo = `Renovação: ${l.title.replace(/^Renovação:\s*/i, "")}`.slice(0, 200);
  const linha = await n.criarRascunho(ch, {
    clientId: l.client_id,
    servicos: servicosEmOrdem(l.servicos),
    titulo,
    extra: valores,
    projectId: l.project_id,
    tipoDocumento: "renovacao",
    renovacaoDe: l.id,
    origemDoEvento: "renovacao_criada",
    resumoDoEvento: `Rascunho de renovação do contrato ${l.numero || ""}, que termina em ${fim.split("-").reverse().join("/")}.`,
    clausulasAlteradas: l.clausulas_alteradas,
  });
  await copiarSignatarios(ch, l.id, linha);
  await evento(l, "renovacao_criada", `Renovação preparada em rascunho (${linha.numero || ""}).`, { renovacao_id: linha.id, fim }, ch.userId || null);
  return { linha, jaExistia: false };
}

// ------------------------------------------------------------------ gerar do cliente

async function planoDoFinanceiro(clientId: string) {
  const hoje = hojeEmSaoPaulo();
  const { data, error } = await servico()
    .from("financial_client_terms")
    .select("id, status, final_amount, due_day, payment_method, starts_on, ends_on, contract_started_on, billing_period, plan_version_id, financial_plan_versions(plan_id, setup_fee, financial_plans(name, description, operational_scope))")
    .eq("client_id", clientId)
    .in("status", ["active", "draft", "paused"])
    .order("starts_on", { ascending: false })
    .limit(5);
  if (error) {
    registrarFalha("contratos: plano do Financeiro não lido", error, { client_id: clientId });
    return null;
  }
  const termos = (data as Array<Record<string, unknown>> | null) ?? [];
  const vale = termos.find((t) => t.status === "active" && (!t.ends_on || String(t.ends_on) >= hoje)) || termos[0];
  if (!vale) return null;
  const versao = (vale.financial_plan_versions || {}) as Record<string, unknown>;
  const plano = (versao.financial_plans || {}) as Record<string, unknown>;
  return {
    valorMensal: lerMoeda(vale.final_amount),
    vencimento: Number(vale.due_day) || null,
    forma: String(vale.payment_method || "").trim(),
    inicio: String(vale.starts_on || ""),
    periodo: String(vale.billing_period || "monthly"),
    nome: String(plano.name || ""),
    texto: [plano.name, plano.description, plano.operational_scope ? JSON.stringify(plano.operational_scope).slice(0, 1200) : ""].map((x) => String(x || "")).filter(Boolean).join(". "),
  };
}

async function gerarDoCliente(ch: Chamador, n: Nucleo, corpo: Record<string, unknown>) {
  const clientId = idDe(corpo.client_id, "client_id");
  await garantirGestao(ch, clientId);
  const [perfil, plano, ficha] = await Promise.all([
    servico().from("profiles").select("services_config, plan_name, plan_value").eq("id", clientId).maybeSingle(),
    planoDoFinanceiro(clientId),
    lerFichaDoCliente(clientId),
  ]);
  const p = (perfil.data || {}) as Record<string, unknown>;
  const daFicha = servicosDaFicha(p.services_config);
  const origem: string[] = [];
  const avisos: string[] = [];
  let incertos: ServicoDoContrato[] = [];
  let servicos = daFicha.servicos;
  if (servicos.length) origem.push(`Serviços ativos da ficha: ${servicos.map((s) => ROTULO_DO_SERVICO[s]).join(", ")}.`);
  if (daFicha.semBloco.length) avisos.push(`Sem anexo próprio no modelo: ${daFicha.semBloco.join(", ")}. Se entram no contrato, descreva no escopo do serviço mais próximo.`);
  // O texto do plano pode citar blocos que a ficha não marcou: o Jev lê (sim ou não por bloco).
  if (plano && plano.texto) {
    const j = await n.julgar(plano.texto, clientId, ch.userId, clientId);
    const novos = j.escolhidos.filter((s) => servicos.indexOf(s) < 0);
    if (novos.length) {
      servicos = servicosEmOrdem(servicos.concat(novos));
      origem.push(`Plano ${plano.nome || "do Financeiro"} cita: ${novos.map((s) => ROTULO_DO_SERVICO[s]).join(", ")}.`);
    }
    incertos = j.incertos.filter((s) => servicos.indexOf(s) < 0);
  }
  if (!servicos.length) throw new ErroHttp(422, "cliente_sem_servicos", "O cliente não tem serviço ativo com anexo no modelo. Marque os serviços na ficha do cliente ou crie escolhendo os serviços.");
  const extra: Valores = {};
  const recorrente = servicos.some((s) => SERVICOS_RECORRENTES.indexOf(s) >= 0);
  if (plano) {
    if (recorrente && plano.valorMensal !== null && plano.valorMensal > 0 && plano.periodo === "monthly") extra.valor_mensal = String(plano.valorMensal);
    else if (plano.valorMensal) avisos.push(`O plano cobra por período "${plano.periodo}": confira o valor no contrato.`);
    if (plano.vencimento) extra.vencimento_dia = String(plano.vencimento);
    if (plano.forma) extra.forma_pagamento = FORMA_DE_PAGAMENTO[plano.forma.toLowerCase()] || plano.forma;
    const hoje = hojeEmSaoPaulo();
    if (plano.inicio && plano.inicio >= hoje) extra.inicio = plano.inicio.slice(0, 10);
    else if (plano.inicio) avisos.push(`O plano começou em ${plano.inicio.split("-").reverse().join("/")}: escolha a data de início do contrato.`);
    origem.push(`Plano do Financeiro${plano.nome ? ` (${plano.nome})` : ""}${extra.valor_mensal ? `: R$ ${extra.valor_mensal} por mês` : ""}${extra.vencimento_dia ? `, vencimento dia ${extra.vencimento_dia}` : ""}.`);
  } else avisos.push("O cliente não tem plano ativo no Financeiro: preencha valor e vencimento.");
  if (ficha.existe) origem.push("Ficha fiscal do cliente.");
  else avisos.push("O cliente ainda não tem ficha fiscal: preencha pelo CNPJ em Dados.");
  const linha = await n.criarRascunho(ch, {
    clientId,
    servicos,
    titulo: limpo(corpo.titulo, 200) || undefined,
    extra,
    origemDoEvento: "gerado_do_cliente",
    resumoDoEvento: `Rascunho gerado do cliente: ${origem.join(" ")}`.slice(0, 480),
  });
  const pergunta = incertos.length ? `Inclui também ${incertos.map((s) => ROTULO_DO_SERVICO[s]).join(" e ")}?` : null;
  return json({ ...(await n.payloadDoContrato(ch, linha)), origem, avisos, pergunta });
}

// ------------------------------------------------------------------ lembrete (mensagem pronta; a pessoa envia)

async function lembretes(ch: Chamador, n: Nucleo, l: Linha) {
  const [{ lista }, cliente, agencia] = await Promise.all([lerSignatariosDoContrato(servico(), l.id), n.nomeDoCliente(l.client_id), n.lerAgencia()]);
  const hoje = hojeEmSaoPaulo();
  const desde = String(l.sent_at || l.congelado_em || "").slice(0, 10) || hoje;
  const dias = Math.max(0, Math.round((Date.parse(hoje) - Date.parse(desde)) / 86400000));
  const pendentes = lista.length
    ? lista.filter((s) => !s.assinado_em).map((s) => ({ id: s.id, nome: s.nome, papel: s.papel, email: s.email, link: linkDeAssinatura(s.token) }))
    : [{ id: null, nome: l.variaveis.cliente_representante ? String(l.variaveis.cliente_representante).split(",")[0] : cliente, papel: "contratante" as const, email: l.variaveis.cliente_email || "", link: linkDeAssinatura(l.sign_token) }];
  return {
    dias,
    ultimo_lembrete: (l.lembrete_em as string | null) || null,
    lembretes: pendentes.map((x) => ({ ...x, mensagens: mensagemDeLembrete({ nome: x.nome, titulo: l.title, link: x.link, dias, agencia: agencia.nome || "Aceleriq" }) })),
  };
}

// ------------------------------------------------------------------ ações

export function acoesDoCiclo(n: Nucleo) {
  return {
    painel: async (ch: Chamador, corpo: Record<string, unknown>) => {
      const clientId = corpo.client_id ? idDe(corpo.client_id, "client_id") : null;
      if (clientId) await garantirAcesso(ch, clientId);
      // Pela sessão de quem pede: a RLS de contracts limita aos clientes que a pessoa acessa.
      let q = ch.doChamador.from("contracts").select(CAMPOS_DO_PAINEL).order("created_at", { ascending: false }).limit(1000);
      if (clientId) q = q.eq("client_id", clientId);
      const [r, prefs] = await Promise.all([q, lerPreferencias()]);
      if (r.error) throw semTabela(r.error) ? new ErroHttp(503, "banco_sem_ciclo", "O banco ainda não tem o ciclo dos contratos (migration 20260930195100 pendente).") : new ErroHttp(503, "painel_indisponivel", "Não foi possível montar o painel agora.");
      const linhas = ((r.data as unknown[] | null) ?? []).map((d) => normalizarLinha(d) as unknown as LinhaDoPainel);
      const painel = painelDosContratos(linhas, hojeEmSaoPaulo(), prefs.avisos.aviso_vencimento_dias);
      return json({ painel, janela_dias: prefs.avisos.aviso_vencimento_dias, lembrete_dias: prefs.avisos.lembrete_assinatura_dias, custo_usd: 0 });
    },
    gerar_do_cliente: (ch: Chamador, corpo: Record<string, unknown>) => gerarDoCliente(ch, n, corpo),
    propostas_aceitas: async (ch: Chamador, corpo: Record<string, unknown>) => {
      const clientId = idDe(corpo.client_id, "client_id");
      await garantirAcesso(ch, clientId);
      const { data, error } = await servico().from("propostas").select("id, numero, titulo, status, total_unico, total_mensal, aceita_em").eq("client_id", clientId).eq("status", "aceita").is("arquivada_em", null).order("aceita_em", { ascending: false }).limit(20);
      if (error) {
        if (semTabela(error) || /propostas/.test(String(error.message || ""))) return json({ propostas: [], custo_usd: 0 });
        throw new ErroHttp(503, "propostas_indisponiveis", "Não foi possível ler as propostas aceitas.");
      }
      const ids = ((data as Array<{ id: string }> | null) ?? []).map((p) => p.id);
      const { data: cs } = ids.length ? await servico().from("contracts").select("id, proposta_id").in("proposta_id", ids).neq("status", "cancelled") : { data: [] };
      const comContrato: Record<string, string> = {};
      ((cs as Array<{ id: string; proposta_id: string }> | null) ?? []).forEach((c) => (comContrato[c.proposta_id] = c.id));
      return json({ propostas: ((data as Array<Record<string, unknown>> | null) ?? []).map((p) => ({ ...p, contrato_id: comContrato[String(p.id)] || null })), custo_usd: 0 });
    },
    aditivo_criar: async (ch: Chamador, corpo: Record<string, unknown>) => {
      const linha = await criarAditivo(ch, n, idDe(corpo.contract_id, "contract_id"), { descricao: String(corpo.descricao || ""), servicos: corpo.servicos });
      return json(await n.payloadDoContrato(ch, linha));
    },
    renovar: async (ch: Chamador, corpo: Record<string, unknown>) => {
      const r = await renovarContrato(ch, n, idDe(corpo.contract_id, "contract_id"));
      return json({ ...(await n.payloadDoContrato(ch, r.linha)), ja_existia: r.jaExistia });
    },
    lembrete: async (ch: Chamador, corpo: Record<string, unknown>) => {
      const l = await lerLinha(ch, corpo.contract_id);
      if (l.status !== "sent" || l.client_signed_at) throw new ErroHttp(409, "nada_pendente", "Este contrato não está esperando assinatura.");
      return json({ ...(await lembretes(ch, n, l)), custo_usd: 0 });
    },
    lembrete_registrar: async (ch: Chamador, corpo: Record<string, unknown>) => {
      const l = await lerLinha(ch, corpo.contract_id, true);
      if (l.status !== "sent") throw new ErroHttp(409, "nada_pendente", "Este contrato não está esperando assinatura.");
      const canal = limpo(corpo.canal, 20) || "whatsapp";
      if (bancoTemCon2()) {
        const { error } = await servico().from("contracts").update({ lembrete_em: new Date().toISOString() }).eq("id", l.id).eq("status", "sent");
        if (error) registrarFalha("contratos: lembrete não marcado", error, { contract_id: l.id });
      }
      await evento(l, "lembrete_copiado", `Lembrete de assinatura usado (${canal}), enviado pela equipe.`, { canal, signatario_id: corpo.signatario_id || null }, ch.userId);
      return json({ ok: true, custo_usd: 0 });
    },
    signatarios_salvar: async (ch: Chamador, corpo: Record<string, unknown>) => {
      const l = await lerLinha(ch, corpo.contract_id, true);
      if (l.origem !== "modelo" || l.status !== "draft" || l.congelado_em) throw new ErroHttp(409, "contrato_congelado", "A lista de quem assina muda só no rascunho. Para mudar, crie uma versão nova.");
      const v = validarSignatarios(corpo.signatarios);
      if (v.erros.length) throw new ErroHttp(400, "signatarios_invalidos", v.erros[0], { erros: v.erros });
      await gravarSignatarios(ch, l, v.lista);
      // Encosta no rascunho para quem está com a tela aberta perceber a mudança (o texto muda: a lista entra nas assinaturas).
      const nova = await n.atualizarRascunho(l, { variaveis: l.variaveis });
      await evento(nova, "signatarios_salvos", v.lista.length ? `Quem assina: ${v.lista.map((s) => `${s.nome}${s.papel === "testemunha" ? " (testemunha)" : ""}`).join(", ")}.` : "Lista de quem assina esvaziada: assina só o contratante pelo link de sempre.", { quantos: v.lista.length }, ch.userId);
      return json(await n.payloadDoContrato(ch, nova));
    },
    concluir_assinaturas: async (ch: Chamador, corpo: Record<string, unknown>) => {
      const l = await lerLinha(ch, corpo.contract_id, true);
      const agencia = await n.lerAgencia();
      const r = await fecharComSignatarios(servico(), l.id, { verificacao: linkDeAssinatura(l.sign_token), cliente: await n.nomeDoCliente(l.client_id), agencia: agencia.nome || "", representanteDaAgencia: agencia.representante });
      if (!r.ok) throw new ErroHttp(409, "nao_concluido", r.motivo === "faltam assinaturas" ? `Faltam ${r.faltam} assinaturas.` : `O contrato não fechou: ${r.motivo}.`);
      return json({ resultado: r, custo_usd: 0 });
    },
  };
}

// ------------------------------------------------------------------ rotina diária (cron)

async function admins(): Promise<string[]> {
  const { data } = await servico().from("user_roles").select("user_id").eq("role", "admin");
  const ids = Array.from(new Set(((data as Array<{ user_id: string }> | null) ?? []).map((r) => r.user_id)));
  if (!ids.length) return [];
  const { data: perfis } = await servico().from("profiles").select("id, email, deleted_at").in("id", ids);
  return ((perfis as Array<{ id: string; email: string | null; deleted_at: string | null }> | null) ?? []).filter((p) => !p.deleted_at && !/^n8n@/i.test(p.email || "")).map((p) => p.id);
}

async function avisar(ids: string[], mensagem: string, link: string, desdeDias: number) {
  if (!ids.length) return;
  const desde = new Date(Date.now() - desdeDias * 86400000).toISOString();
  const { data } = await servico().from("notifications").select("user_id").eq("link", link).eq("notification_type", "contrato").gte("created_at", desde);
  const ja = new Set(((data as Array<{ user_id: string }> | null) ?? []).map((x) => x.user_id));
  const novos = ids.filter((id) => !ja.has(id)).map((user_id) => ({ user_id, message: mensagem.slice(0, 400), notification_type: "contrato", link }));
  if (!novos.length) return;
  const { error } = await servico().from("notifications").insert(novos);
  if (error) registrarFalha("contratos: aviso da rotina não gravado", error, { link });
}

export async function rotinaVencimentos(n: Nucleo) {
  const prefs = await lerPreferencias();
  const hoje = hojeEmSaoPaulo();
  const quem = await admins();
  const resumo = { renovacoes: 0, avisos_vencimento: 0, avisos_assinatura: 0, fechados: 0, falhas: 0 };
  const { data, error } = await selecionarContratos((campos) => servico().from("contracts").select(campos).eq("origem", "modelo").in("status", ["completed", "sent"]).is("arquivado_em", null).limit(1000));
  if (error) throw new ErroHttp(503, "rotina_sem_banco", "A rotina não leu os contratos.");
  const linhas = ((data as unknown[] | null) ?? []).map((d) => normalizarLinha(d)!).filter(Boolean);
  const nomes: Record<string, string> = {};
  const nome = async (id: string) => (nomes[id] = nomes[id] || (await n.nomeDoCliente(id)));
  const aditivos = await aditivosDe(linhas.filter((l) => l.status === "completed").map((l) => l.id));
  for (const l of linhas) {
    try {
      const sistema: Chamador = { userId: String(l.created_by || ""), email: "", nome: "rotina", ip: "rotina", doChamador: servico(), sistema: true };
      if (l.status === "completed" && l.tipo_documento !== "aditivo" && !l.substituido_por && !l.aviso_vencimento_em) {
        const ef = efeitosDosAditivos(l as unknown as LinhaDoPainel, aditivos, hoje);
        const fim = ef.fim;
        if (!fim) continue;
        const dias = Math.round((Date.parse(fim) - Date.parse(hoje)) / 86400000);
        if (dias > prefs.avisos.aviso_vencimento_dias || dias < -30) continue;
        const r = await renovarContrato(sistema, n, l.id);
        if (!r.jaExistia) resumo.renovacoes++;
        const { error: marca } = await servico().from("contracts").update({ aviso_vencimento_em: new Date().toISOString() }).eq("id", l.id);
        if (marca) registrarFalha("contratos: aviso de vencimento não marcado", marca, { contract_id: l.id });
        await evento(l, "aviso_vencimento", dias >= 0 ? `Vence em ${dias} dias. A renovação está pronta para revisar.` : `Venceu há ${-dias} dias. A renovação está pronta para revisar.`, { fim, renovacao_id: r.linha.id }, null);
        await avisar(quem, `Contrato ${l.numero || ""} de ${await nome(l.client_id)} ${dias >= 0 ? `vence em ${dias} dias` : `venceu há ${-dias} dias`}. A renovação está pronta para revisar.`, `/contratos?client=${l.client_id}&contrato=${r.linha.id}`, 30);
        resumo.avisos_vencimento++;
      }
      if (l.status === "sent" && !l.client_signed_at) {
        const { lista } = await lerSignatariosDoContrato(servico(), l.id);
        // Todas as assinaturas entraram e o fechamento não aconteceu: tenta de novo.
        if (lista.length && !lista.some((s) => s.obrigatorio && !s.assinado_em)) {
          const agencia = await n.lerAgencia();
          const f = await fecharComSignatarios(servico(), l.id, { verificacao: linkDeAssinatura(l.sign_token), cliente: await nome(l.client_id), agencia: agencia.nome || "", representanteDaAgencia: agencia.representante });
          if (f.ok) resumo.fechados++;
          else registrarFalha("contratos: fechamento com signatários falhou na rotina", new Error(f.motivo), { contract_id: l.id });
          continue;
        }
        const desde = String(l.sent_at || l.congelado_em || "").slice(0, 10);
        const dias = desde ? Math.round((Date.parse(hoje) - Date.parse(desde)) / 86400000) : 0;
        if (dias >= prefs.avisos.lembrete_assinatura_dias) {
          await avisar(quem, `Contrato ${l.numero || ""} de ${await nome(l.client_id)} espera assinatura há ${dias} dias. Abra para copiar o lembrete pronto.`, `/contratos?client=${l.client_id}&contrato=${l.id}`, prefs.avisos.lembrete_assinatura_dias);
          resumo.avisos_assinatura++;
        }
      }
    } catch (e) {
      resumo.falhas++;
      registrarFalha("contratos: rotina de vencimentos falhou num contrato", e, { contract_id: l.id });
    }
  }
  return resumo;
}
