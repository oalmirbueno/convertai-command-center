/**
 * agente-cfo (frente CFO, 30/09/2026): o agente financeiro da agência.
 *
 * Mora no Assist (serviço "CFO") e em Financeiro › CFO. Só admin (o
 * financeiro é do dono). Cada pedido:
 * 1. lê o financeiro inteiro com a chave de serviço, DEPOIS de conferir que
 *    quem pede é admin;
 * 2. calcula tudo em código (modulos/cfo-calculos.ts): caixa, fôlego,
 *    projeção, limite do mês, cortes, plano. A mesma conta da tela;
 * 3. entende a pergunta com o Jev (intenção, qual valor, se repete), com a
 *    regra das palavras de reserva;
 * 4. monta a proposta em código (lançar, cortar, metas) e a TRAVA (gasto acima
 *    do limite só com confirmação explícita, conferida de novo no Confirmar);
 * 5. a IA (modelo escolhido ou o da estratégia) só explica e conduz a partir
 *    dos números; se ela trouxer valor que não está na conta, vale a resposta
 *    do motor. Sem IA (sem crédito, fora do ar), a resposta do motor sai sozinha.
 *
 * Nada envia cobrança a cliente (check-renewals segue segurado) e nada mexe
 * em conta de cliente. Ações:
 * - perguntar { pergunta, modelo_id?, sem_ia? }
 * - conversa {}                         as últimas trocas do dono
 * - retrato { meses? }                  os números (sem IA)
 * - avaliar_gasto { valor, recorrente?, categoria? }
 * - executar_acao_agente { mensagem_id, acao_id?, descartar?, parar?, confirmar_acima_do_limite? }
 * - desfazer_acao_agente { mensagem_id, acao_id? }
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { PREFLIGHT_CACHE } from "../_shared/cors.ts";
import { respostaComFolego } from "../_shared/resposta-com-folego.ts";
import { jevPerguntar } from "../_shared/jev.ts";
import { chamarTexto, cobrarJev, IaMotorErro, modeloPadrao } from "../_shared/ia-motor.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import {
  acaoDoAnexo,
  type AcaoDoAgente,
  type AcaoGuardada,
  confirmarAcaoGuardada,
  desfazerAcaoGuardada,
  ErroDaAcao,
  type ItemDaAcaoDoAgente,
  type ResultadoDoItem,
  TIPO_DA_ACAO,
  textoDoResultado,
} from "../_shared/acoes-do-agente.ts";
import {
  avaliarGasto,
  ehCapital,
  fatosParaAIa,
  numero,
  respostaDoCFO,
  retratoDoCFO,
  type Retrato,
} from "./modulos/cfo-calculos.ts";
import { caixinhasDe, COLUNAS, hojeEmSaoPaulo, montarDadosDoCFO } from "./modulos/cfo-dados.ts";
import { descricaoDoGasto, lerRota, perguntasDaRota, type RotaDoCFO } from "./modulos/cfo-rota.ts";
import { AGENTE_CFO, conferirTrava, propostaDaIntencao } from "./modulos/cfo-acoes.ts";
import { numerosForaDaConta } from "./modulos/cfo-conferencia.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  ...PREFLIGHT_CACHE,
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class ErroHttp extends Error {
  status: number;
  codigo: string;
  extra: Record<string, unknown>;
  constructor(status: number, codigo: string, mensagem: string, extra: Record<string, unknown> = {}) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.extra = extra;
  }
}

function respostaDeErro(err: unknown): Response {
  if (err instanceof ErroHttp) return json({ error: err.codigo, mensagem: err.message, ...err.extra }, err.status);
  if (err instanceof ErroDaAcao) return json({ error: err.codigo, mensagem: err.message }, err.status);
  if (err instanceof IaMotorErro) return json(err.paraJson(), err.status);
  registrarFalha("agente-cfo: falha", err);
  return json({ error: "falha_interna", mensagem: "O CFO falhou ao processar o pedido. Tente de novo." }, 500);
}

// ------------------------------------------------------------------ banco e acesso

let servicoCache: SupabaseClient | null = null;
function servico(): SupabaseClient {
  if (!servicoCache) {
    servicoCache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return servicoCache;
}

type Chamador = { userId: string };

/** O financeiro é só do admin: gestor e equipe não entram. */
async function identificar(req: Request): Promise<Chamador> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: user } = await servico().auth.getUser(token);
  const userId = user?.user?.id;
  if (!userId) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const admin = await servico().rpc("has_role", { _user_id: userId, _role: "admin" });
  if (admin.error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir a permissão agora.");
  if (admin.data !== true) throw new ErroHttp(403, "somente_admin", "O CFO e o financeiro são só do admin.");
  return { userId };
}

/** Lê tudo de uma vez (cada leitura falha alto: número pela metade é pior que nenhum). */
async function lerRetrato(ch: Chamador, meses?: number): Promise<{ retrato: Retrato; metaMensal: number | null }> {
  const s = servico();
  const desde = new Date(Date.now() - 62 * 86_400_000).toISOString();
  const [cobrancas, pagamentos, despesas, clientes, config, perfil, metas, travas] = await Promise.all([
    s.from("billing").select(COLUNAS.cobrancas).limit(5000),
    s.from("project_payments").select(COLUNAS.pagamentos).limit(2000),
    s.from("expenses").select(COLUNAS.despesas).limit(5000),
    s.from("profiles").select(COLUNAS.clientes).limit(5000),
    s.from("financial_settings").select(COLUNAS.config).eq("settings_key", "default").maybeSingle(),
    s.from("profiles").select("services_config").eq("id", ch.userId).maybeSingle(),
    s.from("cfo_metas").select(COLUNAS.metas).is("arquivado_em", null).order("criado_em", { ascending: true }).limit(50),
    s.from("cfo_eventos").select(COLUNAS.travas).gte("criado_em", desde).limit(500),
  ]);
  const erro = [cobrancas, pagamentos, despesas, clientes, config, perfil].find((r) => r.error);
  if (erro && erro.error) throw new ErroHttp(503, "financeiro_indisponivel", `Não consegui ler o financeiro agora: ${erro.error.message}`);
  // Metas e travas são do CFO: sem a tabela (migration ainda não aplicada), o retrato sai sem elas.
  if (metas.error) registrarFalha("agente-cfo: metas sem leitura", metas.error);
  if (travas.error) registrarFalha("agente-cfo: travas sem leitura", travas.error);
  const dados = montarDadosDoCFO({
    hoje: hojeEmSaoPaulo(),
    cobrancas: cobrancas.data as Record<string, unknown>[],
    pagamentos: pagamentos.data as Record<string, unknown>[],
    despesas: despesas.data as Record<string, unknown>[],
    clientes: clientes.data as Record<string, unknown>[],
    config: config.data as Record<string, unknown> | null,
    caixinhas: caixinhasDe((perfil.data as { services_config?: unknown } | null)?.services_config),
    metas: (metas.data || []) as Record<string, unknown>[],
    travas: (travas.data || []) as Record<string, unknown>[],
  });
  return { retrato: retratoDoCFO(dados, { meses }), metaMensal: dados.config.metaMensal };
}

/** A carteira de IA que paga o CFO: a da própria agência (cliente interno). Sem ela, o CFO responde sem IA. */
async function carteiraDaAgencia(): Promise<string | null> {
  const { data, error } = await servico().from("profiles").select("id").eq("services_config->>internal_company", "true").limit(5);
  if (error) {
    registrarFalha("agente-cfo: carteira da agência sem leitura", error);
    return null;
  }
  const ids = ((data || []) as { id: string }[]).map((x) => x.id);
  if (!ids.length) return null;
  const { data: carteiras } = await servico().from("ia_carteiras").select("client_id, saldo_usd").in("client_id", ids).order("saldo_usd", { ascending: false }).limit(1);
  const c = ((carteiras || []) as { client_id: string }[])[0];
  return c ? c.client_id : ids[0];
}

// ------------------------------------------------------------------ rota (Jev)

async function rotear(pedido: string, agencia: string | null, userId: string): Promise<RotaDoCFO> {
  const { state, questions } = perguntasDaRota(pedido);
  try {
    // deno-lint-ignore no-explicit-any
    const r = await jevPerguntar({ state, questions: questions as any }, { timeoutMs: 8_000 });
    if (agencia) void cobrarJev(r, { clientId: agencia, tarefa: "conversa", criadoPor: userId });
    return lerRota(pedido, r.answers);
  } catch (e) {
    registrarFalha("agente-cfo: jev fora (vale a regra das palavras)", e);
    return lerRota(pedido, null);
  }
}

// ------------------------------------------------------------------ IA: explica e conduz

const SISTEMA_DO_CFO = `Você é o CFO da Aceleriq, agência de marketing de um dono só (o Almir). Fala com ele em português do Brasil, direto, como um CFO de verdade que conduz: diz o número, o porquê e o próximo passo.
Regras duras:
- Todo número sai da RESPOSTA DO MOTOR ou dos FATOS. Nunca calcule, arredonde de outro jeito nem invente valor, data, cliente ou fornecedor.
- Se o motor disse "não" para um gasto, você diz "não" e explica. Nunca libere um gasto que o motor travou.
- Até 8 linhas curtas. Sem markdown, sem asterisco, sem travessão. Valores no formato R$ 1.234,56.
- Termine com UMA pergunta ou próxima ação concreta (ex.: "Confirmo o corte?", "Quer que eu guarde essas metas?").
- Cobrança a cliente é ele quem faz: o painel não envia nada sozinho.`;

async function explicar(
  agencia: string,
  e: { pedido: string; base: string; fatos: Record<string, unknown>; modeloId: string | null; historico: string; userId: string; temProposta: boolean },
): Promise<{ texto: string; custo: number; modelo: string; usoId: string | null; aviso: string | null }> {
  const modelo = e.modeloId || (await modeloPadrao("estrategista"))?.id || null;
  if (!modelo) return { texto: e.base, custo: 0, modelo: "", usoId: null, aviso: "Nenhum modelo de texto ligado: mostrei a conta do motor." };
  const conteudo = [
    e.historico ? `CONVERSA ATÉ AQUI:\n${e.historico}` : "",
    `PERGUNTA DO DONO: ${e.pedido}`,
    `RESPOSTA DO MOTOR (os números certos; reescreva conduzindo, sem mudar nenhum número):\n${e.base}`,
    e.temProposta ? "Há um cartão com Confirmar logo abaixo da sua resposta: diga o que ele faz em uma frase." : "",
    `FATOS (JSON):\n${JSON.stringify(e.fatos)}`,
  ].filter(Boolean).join("\n\n");
  const saida = await chamarTexto({
    clientId: agencia,
    tarefa: "conversa",
    agente: "estrategista",
    modeloId: modelo,
    sistema: SISTEMA_DO_CFO,
    mensagens: [{ papel: "usuario", conteudo }],
    maxTokensSaida: 700,
    timeoutMs: 60_000,
    criadoPor: e.userId,
  });
  const texto = String(saida.texto || "").replace(/—|–/g, ",").trim();
  const fora = numerosForaDaConta(texto, e.base, e.fatos);
  if (!texto || fora.length) {
    if (fora.length) registrarFalha("agente-cfo: IA trouxe número fora da conta (valeu o motor)", new Error(fora.slice(0, 5).join(", ")));
    return { texto: e.base, custo: saida.custoUsd, modelo: saida.modeloId, usoId: saida.usoId, aviso: fora.length ? "A explicação da IA trouxe número fora da conta: mostrei a conta do motor." : null };
  }
  return { texto, custo: saida.custoUsd, modelo: saida.modeloId, usoId: saida.usoId, aviso: null };
}

// ------------------------------------------------------------------ conversa

async function ultimasTrocas(userId: string, n = 30) {
  const { data, error } = await servico().from("cfo_mensagens").select("id, papel, conteudo, anexos, criado_em").eq("dono_id", userId).order("criado_em", { ascending: false }).limit(n);
  if (error) throw new ErroHttp(503, "conversa_indisponivel", `Não consegui ler a conversa: ${error.message}`);
  return ((data || []) as Array<Record<string, unknown>>).reverse();
}

function historicoEmTexto(trocas: Array<Record<string, unknown>>): string {
  return trocas.slice(-6).filter((t) => t.papel !== "sistema").map((t) => `${t.papel === "usuario" ? "Dono" : "CFO"}: ${String(t.conteudo || "").slice(0, 400)}`).join("\n");
}

async function perguntar(ch: Chamador, corpo: Record<string, unknown>): Promise<Response> {
  const pedido = String(corpo.pergunta ?? "").trim().slice(0, 1500);
  if (!pedido) throw new ErroHttp(400, "pergunta_vazia", "Escreva a pergunta para o CFO.");
  const modeloId = typeof corpo.modelo_id === "string" && corpo.modelo_id.trim() ? corpo.modelo_id.trim().slice(0, 200) : null;
  const [{ retrato, metaMensal }, agencia, trocas] = await Promise.all([
    lerRetrato(ch, Number(corpo.meses) || undefined),
    carteiraDaAgencia(),
    ultimasTrocas(ch.userId, 8).catch((e) => (registrarFalha("agente-cfo: conversa sem leitura", e), [])),
  ]);
  const rota = await rotear(pedido, agencia, ch.userId);
  const descricao = descricaoDoGasto(pedido);
  const { acao, avaliacao } = propostaDaIntencao(retrato, rota.intencao, { valor: rota.valor, recorrente: rota.recorrente, descricao, metaAnterior: metaMensal });
  const intencaoDoTexto = (rota.intencao === "lancar" || rota.intencao === "posso_gastar") && avaliacao ? "posso_gastar" : rota.intencao === "meta" ? "plano" : rota.intencao === "lancar" ? "este_mes" : rota.intencao;
  let base = respostaDoCFO(retrato, intencaoDoTexto, { avaliacao, meses: Number(corpo.meses) || 6 });
  if (rota.intencao === "posso_gastar" && !avaliacao) base = `Qual é o valor? Me diga quanto e se é de uma vez ou todo mês.\n${respostaDoCFO(retrato, "este_mes")}`;
  if (rota.intencao === "meta" && acao) base = `${acao.resumo}\n${base}`;

  let resposta = base;
  let custo = 0;
  let modelo = "";
  let usoId: string | null = null;
  let aviso: string | null = null;
  if (corpo.sem_ia !== true) {
    if (!agencia) aviso = "Sem carteira de IA da agência: mostrei a conta do motor.";
    else {
      try {
        const r = await explicar(agencia, { pedido, base, fatos: fatosParaAIa(retrato), modeloId, historico: historicoEmTexto(trocas), userId: ch.userId, temProposta: !!acao });
        resposta = r.texto;
        custo = r.custo;
        modelo = r.modelo;
        usoId = r.usoId;
        aviso = r.aviso;
      } catch (e) {
        // Sem crédito, sem chave, provedor fora: o CFO não fica mudo, a conta do motor vai sozinha.
        registrarFalha("agente-cfo: IA indisponível (valeu o motor)", e);
        aviso = e instanceof IaMotorErro ? `IA indisponível (${e.codigo}): mostrei a conta do motor.` : "IA indisponível: mostrei a conta do motor.";
      }
    }
  }

  // A troca fica gravada; a proposta mora na mensagem do agente (Confirmar e Desfazer leem de lá).
  const agora = Date.now();
  const { data: gravadas, error } = await servico().from("cfo_mensagens").insert([
    { dono_id: ch.userId, papel: "usuario", conteudo: pedido, anexos: [], criado_em: new Date(agora).toISOString() },
    { dono_id: ch.userId, papel: "agente", conteudo: resposta.slice(0, 6000), anexos: acao ? [acao] : [], uso_id: usoId, criado_em: new Date(agora + 1).toISOString() },
  ]).select("id, papel");
  if (error) registrarFalha("agente-cfo: conversa não gravada", error);
  const mensagemId = (((gravadas || []) as { id: string; papel: string }[]).find((m) => m.papel === "agente") || { id: null }).id;

  return json({
    resposta,
    resposta_do_motor: base,
    intencao: rota.intencao,
    rota,
    avaliacao,
    anexo: mensagemId ? acao : null,
    proposta_sem_registro: !mensagemId && !!acao,
    mensagem_id: mensagemId,
    modelo_id: modelo || null,
    custo_usd: custo,
    aviso: error ? `${aviso ? `${aviso} ` : ""}A conversa não foi gravada: o Confirmar não está disponível.` : aviso,
    retrato: { saude: retrato.saude, limite: retrato.limiteQueVale, caixa: retrato.caixa, folego: retrato.folego },
  });
}

async function conversa(ch: Chamador): Promise<Response> {
  return json({ mensagens: await ultimasTrocas(ch.userId, 40) });
}

async function retrato(ch: Chamador, corpo: Record<string, unknown>): Promise<Response> {
  const { retrato } = await lerRetrato(ch, Number(corpo.meses) || undefined);
  return json({ retrato });
}

async function avaliar(ch: Chamador, corpo: Record<string, unknown>): Promise<Response> {
  const valor = numero(corpo.valor as number);
  if (!(valor > 0)) throw new ErroHttp(400, "valor_invalido", "Informe um valor maior que zero.");
  const { retrato } = await lerRetrato(ch);
  return json({ avaliacao: avaliarGasto(retrato, { valor, recorrente: corpo.recorrente === true, categoria: typeof corpo.categoria === "string" ? corpo.categoria : null }) });
}

// ------------------------------------------------------------------ ações: confirmar e desfazer

async function guardadaDoCfo(mensagemId: unknown, acaoId: unknown): Promise<AcaoGuardada & { dono: string }> {
  const id = String(mensagemId ?? "");
  if (!UUID.test(id)) throw new ErroDaAcao(400, "mensagem_invalida", "mensagem_id precisa ser um UUID.");
  const { data, error } = await servico().from("cfo_mensagens").select("id, dono_id, anexos").eq("id", id).maybeSingle();
  if (error) throw new ErroDaAcao(500, "mensagem_indisponivel", "Não foi possível ler a mensagem do CFO.");
  if (!data) throw new ErroDaAcao(404, "mensagem_inexistente", "Mensagem não encontrada.");
  const m = data as { id: string; dono_id: string; anexos: unknown };
  const anexos = Array.isArray(m.anexos) ? (m.anexos as Record<string, unknown>[]) : [];
  const alvo = acaoId ? String(acaoId) : "";
  const i = anexos.findIndex((a) => a && a.tipo === TIPO_DA_ACAO && a.agente === AGENTE_CFO && (!alvo || a.id === alvo));
  if (i < 0) throw new ErroDaAcao(404, "acao_inexistente", "Esta mensagem não tem proposta do CFO.");
  const acao = acaoDoAnexo(anexos[i]) as AcaoDoAgente;
  const gravar = async (novo: AcaoDoAgente) => {
    const lista = anexos.slice();
    lista[i] = novo as unknown as Record<string, unknown>;
    const { error: e } = await servico().from("cfo_mensagens").update({ anexos: lista }).eq("id", m.id);
    if (e) throw new ErroDaAcao(500, "acao_nao_registrada", "A ação foi feita, mas o registro na conversa falhou. Atualize a tela.");
    anexos[i] = lista[i];
    return novo;
  };
  return { mensagem: { id: m.id, client_id: m.dono_id, conversa_id: null }, acao, gravar, dono: m.dono_id };
}

function somaMeses(data: string, meses: number): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + Math.max(0, Math.round(meses)));
  return d.toISOString().slice(0, 10);
}

async function executarItem(item: ItemDaAcaoDoAgente, acao: AcaoDoAgente, userId: string): Promise<{ desfazer?: Record<string, unknown> | null; aviso?: string }> {
  const s = servico();
  const ctx = (acao.contexto || {}) as Record<string, unknown>;
  if (item.operacao === "lancar_despesa") {
    const valor = numero(ctx.valor as number);
    if (!(valor > 0)) throw new ErroDaAcao(400, "valor_invalido", "Valor inválido.");
    const linha = {
      description: String(ctx.descricao || item.titulo).slice(0, 200),
      category: String(ctx.categoria || "outros"),
      amount: valor,
      due_date: String(ctx.vencimento || hojeEmSaoPaulo()),
      status: "pending",
      recurrence: ctx.recorrente === true ? "monthly" : "none",
      notes: "Lançado pelo CFO (Financeiro › CFO).",
      created_by: userId,
    };
    const { data, error } = await s.from("expenses").insert(linha).select("id").single();
    if (error || !data) throw new Error(error?.message || "A despesa não foi gravada.");
    // O Desfazer leva a linha inteira: se ninguém mexeu, ela sai; a cópia fica na conversa.
    return { desfazer: { despesa_id: (data as { id: string }).id, valor, linha } };
  }
  if (item.operacao === "cortar_custo") {
    const { data, error } = await s.from("expenses").select("id, recurrence, category, description").eq("id", item.alvo_id).maybeSingle();
    if (error) throw new Error(error.message);
    const d = data as { id: string; recurrence: string; category: string | null } | null;
    if (!d) throw new ErroDaAcao(404, "custo_inexistente", "Este custo não existe mais.");
    if (ehCapital(d)) throw new ErroDaAcao(409, "capital", "Investimento do sócio não entra em corte.");
    if (d.recurrence !== "monthly" && d.recurrence !== "yearly") throw new ErroDaAcao(409, "ja_encerrado", "Este custo já não se repete.");
    const { error: e2 } = await s.from("expenses").update({ recurrence: "none" }).eq("id", d.id).eq("recurrence", d.recurrence);
    if (e2) throw new Error(e2.message);
    return { desfazer: { despesa_id: d.id, recorrencia_antes: d.recurrence }, aviso: "Cancele também no fornecedor." };
  }
  if (item.operacao === "criar_meta") {
    const metas = (ctx.metas || {}) as Record<string, Record<string, unknown>>;
    const m = metas[item.alvo_id];
    if (!m) throw new ErroDaAcao(400, "meta_invalida", "Meta sem dados.");
    const prazoMeses = numero(m.prazo_meses as number);
    const { data, error } = await s.from("cfo_metas").insert({
      titulo: String(m.titulo || item.titulo).slice(0, 200),
      tipo: String(m.tipo || "outra"),
      valor_alvo: numero(m.alvo as number),
      valor_base: numero(m.atual as number),
      prazo: prazoMeses > 0 ? somaMeses(hojeEmSaoPaulo(), prazoMeses) : null,
      como: String(m.como || "").slice(0, 1000) || null,
      origem: "cfo",
      criado_por: userId,
    }).select("id").single();
    if (error || !data) throw new Error(error?.message || "A meta não foi gravada.");
    return { desfazer: { meta_id: (data as { id: string }).id } };
  }
  if (item.operacao === "definir_meta_mensal") {
    const valor = numero(item.para as number);
    if (!(valor > 0)) throw new ErroDaAcao(400, "valor_invalido", "Meta inválida.");
    const { data, error } = await s.from("financial_settings").select("monthly_goal").eq("settings_key", "default").maybeSingle();
    if (error || !data) throw new Error(error?.message || "Configuração do financeiro não encontrada.");
    const antes = (data as { monthly_goal: number | null }).monthly_goal;
    const { error: e2 } = await s.from("financial_settings").update({ monthly_goal: valor, updated_by: userId }).eq("settings_key", "default");
    if (e2) throw new Error(e2.message);
    return { desfazer: { meta_antes: antes } };
  }
  throw new ErroDaAcao(400, "operacao_desconhecida", "Operação desconhecida.");
}

async function reverterItem(r: ResultadoDoItem, userId: string): Promise<void> {
  const s = servico();
  const d = (r.desfazer || {}) as Record<string, unknown>;
  if (r.operacao === "lancar_despesa") {
    const id = String(d.despesa_id || "");
    const { data, error } = await s.from("expenses").select("id, status, amount").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return;
    const x = data as { status: string; amount: number };
    if (x.status !== "pending" || Math.abs(numero(x.amount) - numero(d.valor as number)) > 0.009) {
      throw new Error("A despesa já foi paga ou alterada. Desfaça pelo Fluxo de caixa.");
    }
    const { error: e2 } = await s.from("expenses").delete().eq("id", id).eq("status", "pending");
    if (e2) throw new Error(e2.message);
    return;
  }
  if (r.operacao === "cortar_custo") {
    const { error } = await s.from("expenses").update({ recurrence: String(d.recorrencia_antes || "monthly") }).eq("id", String(d.despesa_id || "")).eq("recurrence", "none");
    if (error) throw new Error(error.message);
    return;
  }
  if (r.operacao === "criar_meta") {
    const { error } = await s.from("cfo_metas").update({ arquivado_em: new Date().toISOString(), arquivado_por: userId }).eq("id", String(d.meta_id || "")).is("arquivado_em", null);
    if (error) throw new Error(error.message);
    return;
  }
  if (r.operacao === "definir_meta_mensal") {
    const { error } = await s.from("financial_settings").update({ monthly_goal: d.meta_antes ?? null, updated_by: userId }).eq("settings_key", "default");
    if (error) throw new Error(error.message);
    return;
  }
}

async function registrarTrava(userId: string, acao: AcaoDoAgente, decisao: "lancou" | "desistiu", limite: number) {
  const ctx = (acao.contexto || {}) as Record<string, unknown>;
  const { error } = await servico().from("cfo_eventos").insert({
    tipo: "gasto_acima_do_limite",
    valor: numero(ctx.valor as number),
    limite,
    recorrente: ctx.recorrente === true,
    descricao: String(ctx.descricao || "").slice(0, 300) || null,
    origem: "cfo",
    decisao,
    criado_por: userId,
  });
  if (error) registrarFalha("agente-cfo: trava não registrada", error);
}

async function executarAcao(ch: Chamador, corpo: Record<string, unknown>): Promise<Response> {
  const guardada = await guardadaDoCfo(corpo.mensagem_id, corpo.acao_id);
  const descartar = corpo.descartar === true;
  const parar = corpo.parar === true;
  const ctx = (guardada.acao.contexto || {}) as Record<string, unknown>;
  const travaAntes = (ctx.trava || null) as { nivel?: string; limite?: number } | null;
  if (!descartar && !parar && guardada.acao.itens.some((i) => i.operacao === "lancar_despesa")) {
    const { retrato } = await lerRetrato(ch);
    const t = conferirTrava(guardada.acao, retrato, corpo.confirmar_acima_do_limite === true);
    if (!t.pode) throw new ErroHttp(409, "acima_do_limite", t.motivo, { avaliacao: t.avaliacao });
    if (t.avaliacao && t.avaliacao.nivel === "bloqueado") await registrarTrava(ch.userId, guardada.acao, "lancou", t.avaliacao.limite);
  } else if (descartar && travaAntes && travaAntes.nivel === "bloqueado" && !guardada.acao.executada_em) {
    await registrarTrava(ch.userId, guardada.acao, "desistiu", numero(travaAntes.limite as number));
  }
  const r = await confirmarAcaoGuardada(guardada, (item, acao) => executarItem(item, acao, ch.userId), { descartar, parar, userId: ch.userId, lote: 1 });
  if (descartar && !r.anexo.executada_em) return json({ anexo: r.anexo, custo_usd: 0 });
  const feitos = r.resultados.filter((x) => x.ok).length;
  if (r.terminou && r.anexo.executada_em) {
    const { error } = await servico().from("cfo_mensagens").insert({ dono_id: guardada.dono, papel: "sistema", conteudo: `CFO: ${textoDoResultado(r.anexo.resultados || [])}.` });
    if (error) registrarFalha("agente-cfo: mensagem de sistema não gravada", error);
  }
  return json({ anexo: r.anexo, feitos, falhas: r.resultados.length - feitos, custo_usd: 0 });
}

async function desfazerAcao(ch: Chamador, corpo: Record<string, unknown>): Promise<Response> {
  const guardada = await guardadaDoCfo(corpo.mensagem_id, corpo.acao_id);
  const r = await desfazerAcaoGuardada(guardada, (x) => reverterItem(x, ch.userId), { userId: ch.userId });
  const { error } = await servico().from("cfo_mensagens").insert({ dono_id: guardada.dono, papel: "sistema", conteudo: `CFO: desfeito (${r.voltaram} ${r.voltaram === 1 ? "item voltou" : "itens voltaram"}).` });
  if (error) registrarFalha("agente-cfo: mensagem de sistema não gravada", error);
  return json({ anexo: r.anexo, voltaram: r.voltaram, falharam: r.falharam, custo_usd: 0 });
}

// ------------------------------------------------------------------ servidor

const ACOES: Record<string, (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>> = {
  perguntar,
  conversa: (ch) => conversa(ch),
  retrato,
  avaliar_gasto: avaliar,
  executar_acao_agente: executarAcao,
  desfazer_acao_agente: desfazerAcao,
};

/** A pergunta pode passar de 150 s (IA): a resposta começa na hora. */
const ACOES_LONGAS = new Set(["perguntar"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "metodo_nao_permitido", mensagem: "Use POST." }, 405);
  try {
    const chamador = await identificar(req);
    let corpo: Record<string, unknown> = {};
    try {
      corpo = await req.json();
    } catch { /* corpo vazio */ }
    const acao = String(corpo.acao ?? "");
    const fn = ACOES[acao];
    if (!fn) return json({ error: "acao_desconhecida", mensagem: "Ação desconhecida.", aceitas: Object.keys(ACOES) }, 400);
    const rodar = async () => {
      try {
        return await fn(chamador, corpo);
      } catch (err) {
        return respostaDeErro(err);
      }
    };
    return ACOES_LONGAS.has(acao) ? respostaComFolego(rodar, corsHeaders) : await rodar();
  } catch (err) {
    return respostaDeErro(err);
  }
});
