/**
 * O robô de WhatsApp do CRM da empresa (14/11/2026): a parte que fala com o banco e com a Cloud API.
 * As decisões (o que perguntar, quando passar ao vendedor, quando parar) moram na função pura
 * proximoPasso de _shared/whatsapp-do-crm.ts; aqui só se lê o estado, aplica o passo e envia.
 *
 * Regras de envio:
 * - Todo envio passa pela fila crm_whats_envios, com chave única (mandar duas vezes não envia duas vezes).
 * - Com modo "teste", ou sem número ou token do WhatsApp, o envio é gravado como "simulado" e NADA sai.
 * - Fora da janela de 24 h só sai template.
 * - Toda mensagem recebida é registrada uma vez só (crm_whats_recebidas).
 * - O que foi dito (enviado, simulado ou recebido) entra em crm_lead_messages, na conversa do negócio.
 * - O token nunca vai para registro, erro ou resposta.
 *
 * O banco é usado só por RPC (migration 20261114110000_crm_whats_rotina.sql), tudo com a chave de serviço.
 */
import type { Contexto, Integracao, LeadCriado } from "./tipos.ts";
import { lerRegras, type Faixa, type RegrasDePontuacao } from "../../_shared/pontuacao-do-crm.ts";
import {
  casarTextoLivre,
  confirmacaoAoVendedor,
  corpoDeTexto,
  corpoParaAMeta,
  enderecoDasMensagens,
  estadoInicial,
  lerBotaoDoVendedor,
  lerEntradas,
  lerRespostaDoWhatsapp,
  montarPergunta,
  pediuParaParar,
  proximoPasso,
  semToken,
  telefoneParaEnvio,
  VERSAO_DA_GRAPH_DO_WHATSAPP,
  type ConfigDoRobo,
  type CorpoDaMeta,
  type DadosDoVendedor,
  type EstadoDaConversa,
  type Etapa,
  type Evento,
  type MensagemRecebida,
  type Passo,
  type Pergunta,
} from "../../_shared/whatsapp-do-crm.ts";

/** Do cliente do Supabase o robô só usa as RPCs (o que deixa o ensaio trocar o banco por um falso). */
export interface Banco {
  rpc(nome: string, argumentos?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

const PRAZO_DA_CHAMADA_MS = 10_000;

async function chamar<T>(db: Banco, nome: string, argumentos: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(nome, argumentos);
  if (error) {
    const codigo = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code || "") : "";
    throw new Error(`banco: ${nome}${codigo ? ` (${codigo})` : ""}`);
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// O que o banco devolve
// ---------------------------------------------------------------------------
interface ContextoDoLead {
  lead: {
    id: string; conta_id: string; nome: string; telefone: string | null; nota: number | null; faixa: Faixa | null; etapa: string;
    owner_id: string | null; na_fila: boolean; nutricao: boolean; valor_mensal: number | null; valor_avulso: number | null;
    campanha: string | null; formulario: string | null; arquivado: boolean;
  };
  vendedor: (DadosDoVendedor & { user_id: string }) | null;
  conversa: Record<string, unknown> | null;
  parou: boolean;
}

export interface EnvioDaFila {
  id: string;
  conta_id: string;
  lead_id: string | null;
  para: string;
  destino: "lead" | "vendedor";
  corpo: CorpoDaMeta;
  chave: string;
  tentativas: number;
  /** Quem recebe escreveu nas últimas 24 h. */
  na_janela: boolean;
}

const lerContexto = async (db: Banco, leadId: string): Promise<ContextoDoLead | null> => {
  const c = await chamar<ContextoDoLead | null>(db, "crm_whats_contexto", { _lead: leadId });
  return c && c.lead && c.lead.id ? c : null;
};

const ETAPAS: Etapa[] = ["inicio", "perguntando", "qualificado", "passado", "nutricao", "encerrado"];
const isoOuNulo = (v: unknown): string | null => {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

function estadoDaConversa(c: Record<string, unknown> | null, agora: string): EstadoDaConversa {
  if (!c) return estadoInicial({}, agora);
  return {
    etapa: ETAPAS.indexOf(c.etapa as Etapa) >= 0 ? (c.etapa as Etapa) : "inicio",
    pergunta: typeof c.pergunta === "string" && c.pergunta ? c.pergunta : null,
    respostas: c.respostas && typeof c.respostas === "object" ? (c.respostas as Record<string, unknown>) : {},
    janela_ate: isoOuNulo(c.janela_ate),
    ultima_do_lead_em: isoOuNulo(c.ultima_do_lead_em),
    followups: typeof c.followups === "number" ? c.followups : 0,
    proximo_followup_em: isoOuNulo(c.proximo_followup_em),
    vendedor_avisado_em: isoOuNulo(c.vendedor_avisado_em),
  };
}

const regrasDa = (i: Integracao): RegrasDePontuacao => lerRegras(i.pontuacao, i.nicho);

function configDoRobo(i: Integracao, c: ContextoDoLead, agora: Date): ConfigDoRobo {
  const t = i.templates || {};
  return {
    agora: agora.toISOString(),
    empresa: i.empresa || "nossa equipe",
    idioma: i.idioma || "pt_BR",
    templates: { lead: t.lead, vendedor: t.vendedor, followup: t.followup, nutricao: t.nutricao },
    followup_horas: Array.isArray(i.followup_horas) && i.followup_horas.length ? i.followup_horas : [24, 72],
    lead: {
      id: c.lead.id, nome: c.lead.nome, telefone: c.lead.telefone, nota: c.lead.nota, faixa: c.lead.faixa,
      campanha: c.lead.campanha, formulario: c.lead.formulario, valor_mensal: c.lead.valor_mensal, valor_avulso: c.lead.valor_avulso,
    },
    vendedor: c.vendedor ? { nome: c.vendedor.nome, whatsapp: c.vendedor.whatsapp, na_janela: c.vendedor.na_janela === true } : null,
  };
}

// ---------------------------------------------------------------------------
// Aplicar um passo da máquina de estados
// ---------------------------------------------------------------------------
/**
 * Põe os envios na fila, requalifica quando o passo pede (e roda o passo seguinte com o resultado) e,
 * no fim, grava o estado. Se algo falhar no meio, o estado antigo fica e a mesma mensagem pode ser
 * tratada de novo sem mandar nada em dobro (as chaves dos envios não repetem).
 */
async function aplicar(ctx: Contexto, db: Banco, contexto: ContextoDoLead, passo: Passo, regras: RegrasDePontuacao): Promise<void> {
  const conta = ctx.integracao.conta_id;
  const telefone = telefoneParaEnvio(contexto.lead.telefone);
  let atual = passo;
  let c = contexto;
  for (let volta = 0; volta < 2; volta += 1) {
    if (atual.parar && telefone) {
      const adeus = atual.envios.filter((e) => e.destino === "lead")[0];
      await chamar(db, "crm_whats_parar", { _conta: conta, _lead: c.lead.id, _telefone: telefone, _confirmacao: adeus ? { ...adeus.corpo, _texto: adeus.texto } : null });
    } else {
      for (const e of atual.envios) {
        await chamar(db, "crm_whats_enfileirar", { _conta: conta, _lead: c.lead.id, _para: e.para, _destino: e.destino, _corpo: { ...e.corpo, _texto: e.texto }, _chave: e.chave });
      }
    }
    if (!atual.requalificar) break;
    const q = atual.requalificar;
    const r = await chamar<{ faixa?: Faixa } | null>(db, "crm_lead_requalificar", { _lead: c.lead.id, _nota: q.nota, _faixa: q.faixa, _motivos: q.motivos, _campos: q.campos });
    // Lê de novo: a nota mudou e o rodízio pode ter dado (ou tirado) o vendedor.
    c = (await lerContexto(db, c.lead.id)) || c;
    const evento: Evento = { tipo: "requalificado", faixa: (r && r.faixa) || q.faixa, nota: q.nota, vendedor: c.vendedor };
    atual = proximoPasso(atual.estado, evento, regras, configDoRobo(ctx.integracao, c, ctx.agora));
  }
  if (telefone) await chamar(db, "crm_whats_conversa_salvar", { _lead: c.lead.id, _telefone: telefone, _estado: atual.estado });
}

// ---------------------------------------------------------------------------
// Envio (a única porta para a Cloud API)
// ---------------------------------------------------------------------------
export interface ResultadoDeUmEnvio {
  situacao: "enviado" | "simulado" | "de_novo" | "erro";
  id?: string | null;
  erro?: string;
}

/**
 * Envia um item da fila. Em modo teste, ou sem número ou token, devolve "simulado" SEM chamar a rede.
 * Nunca lança: rede caída e prazo estourado viram "tentar de novo".
 */
export async function enviarUm(envio: EnvioDaFila, integracao: Integracao | null, buscar: typeof fetch = fetch, versao = VERSAO_DA_GRAPH_DO_WHATSAPP): Promise<ResultadoDeUmEnvio> {
  if (!integracao || !integracao.ativo) return { situacao: "erro", erro: "A integração da empresa está desligada." };
  if (integracao.liberada === false) return { situacao: "erro", erro: "O CRM da empresa não está liberado." };
  const corpo = corpoParaAMeta(envio.corpo, envio.na_janela === true);
  if (!corpo) return { situacao: "erro", erro: "Fora da janela de 24 h do WhatsApp só sai template, e esta mensagem não tem um." };
  const token = String(integracao.wa_token || "").trim();
  const numero = String(integracao.wa_phone_id || "").trim();
  if (integracao.modo !== "real" || !numero || !token) return { situacao: "simulado" };

  const controle = new AbortController();
  const prazo = setTimeout(() => controle.abort(), PRAZO_DA_CHAMADA_MS);
  try {
    const resposta = await buscar(enderecoDasMensagens(numero, versao), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(corpo),
      signal: controle.signal,
    });
    let lido: unknown = null;
    try {
      lido = await resposta.json();
    } catch {
      /* resposta sem JSON: o status decide */
    }
    const r = lerRespostaDoWhatsapp(resposta.status, lido, token);
    if (r.ok) return { situacao: "enviado", id: r.id };
    return { situacao: r.definitivo ? "erro" : "de_novo", erro: r.erro };
  } catch (e) {
    const abortou = e instanceof Error && e.name === "AbortError";
    return { situacao: "de_novo", erro: abortou ? "O WhatsApp demorou para responder." : semToken("Não foi possível falar com o WhatsApp agora.", token) };
  } finally {
    clearTimeout(prazo);
  }
}

export interface ResumoDoDespacho {
  pegos: number;
  enviados: number;
  simulados: number;
  de_novo: number;
  erros: number;
  sem_tempo: number;
}

export interface OpcoesDoDespacho {
  /** Só os envios desta empresa (o webhook despacha na hora o que acabou de enfileirar). */
  conta?: string;
  limite?: number;
  buscar?: typeof fetch;
  versao?: string;
  /** Para a rodada antes do prazo do cron: o que sobrar fica reservado e volta sozinho. */
  ateMs?: number;
}

/** Pega os envios da vez (reservados no banco) e manda um por um, anotando o resultado de cada. */
export async function despachar(db: Banco, integracaoDa: (conta: string) => Promise<Integracao | null>, opcoes: OpcoesDoDespacho = {}): Promise<ResumoDoDespacho> {
  const fila = (await chamar<EnvioDaFila[] | null>(db, "crm_whats_envios_pegar", { _limite: opcoes.limite || 40, _conta: opcoes.conta || null })) || [];
  const resumo: ResumoDoDespacho = { pegos: fila.length, enviados: 0, simulados: 0, de_novo: 0, erros: 0, sem_tempo: 0 };
  const conexoes = new Map<string, Integracao | null>();
  for (const envio of fila) {
    if (opcoes.ateMs && Date.now() > opcoes.ateMs) {
      resumo.sem_tempo += 1;
      continue;
    }
    try {
      if (!conexoes.has(envio.conta_id)) conexoes.set(envio.conta_id, await integracaoDa(envio.conta_id));
      const integracao = conexoes.get(envio.conta_id) || null;
      const r = await enviarUm(envio, integracao, opcoes.buscar || fetch, opcoes.versao);
      await chamar(db, "crm_whats_envio_resultado", { _id: envio.id, _situacao: r.situacao, _wa_message_id: r.id || null, _erro: r.erro ? semToken(r.erro, integracao?.wa_token || "") : null });
      if (r.situacao === "enviado") resumo.enviados += 1;
      else if (r.situacao === "simulado") resumo.simulados += 1;
      else if (r.situacao === "de_novo") resumo.de_novo += 1;
      else resumo.erros += 1;
    } catch (e) {
      // Falha nossa (banco): o envio continua reservado e volta sozinho em 10 minutos.
      console.error("[whatsapp-do-crm] envio", envio.id, e instanceof Error ? e.message.slice(0, 80) : "");
      resumo.sem_tempo += 1;
    }
  }
  return resumo;
}

const despacharDaConta = async (ctx: Contexto, db: Banco): Promise<void> => {
  try {
    await despachar(db, () => Promise.resolve(ctx.integracao), { conta: ctx.integracao.conta_id, limite: 20 });
  } catch (e) {
    // Não deu para despachar agora: a rotina (produto-meta-rotina) pega em até 2 minutos.
    console.error("[whatsapp-do-crm] despacho", e instanceof Error ? e.message.slice(0, 80) : "");
  }
};

// ---------------------------------------------------------------------------
// PONTO DE EXTENSÃO: classificação por IA do texto livre (ainda não implementada)
// ---------------------------------------------------------------------------
/**
 * Quando o lead responde em texto livre e as palavras-chave não casam (casarTextoLivre devolveu nulo),
 * esta função pode devolver o id da opção certa (`r:<campo>:<valor>`, como em `pergunta.opcoes[n].id`).
 * Hoje devolve sempre nulo: o robô repete a pergunta uma vez e, na segunda falha, segue.
 * Para ligar a IA, troque só o corpo desta função (um classificador de escolha entre `pergunta.opcoes`).
 */
// deno-lint-ignore require-await
export async function classificarComIA(_texto: string, _pergunta: Pergunta, _ctx: Contexto): Promise<string | null> {
  return null;
}

// ---------------------------------------------------------------------------
// Entradas do index (produto-meta) e da rotina (produto-meta-rotina)
// ---------------------------------------------------------------------------
/** Lead novo do formulário: boas-vindas (quente ou morno) ou nutrição (frio). */
export async function aoCriarLead(ctx: Contexto, lead: LeadCriado): Promise<void> {
  const db = ctx.servico as unknown as Banco;
  // A mesma pessoa de novo não reabre a conversa; sem WhatsApp válido não há com quem falar.
  if (!lead || lead.repetido || !telefoneParaEnvio(lead.whatsapp)) return;
  const contexto = await lerContexto(db, lead.lead_id);
  if (!contexto || contexto.lead.conta_id !== ctx.integracao.conta_id || contexto.conversa || contexto.parou || contexto.lead.arquivado) return;
  const c: ContextoDoLead = {
    ...contexto,
    lead: {
      ...contexto.lead, telefone: telefoneParaEnvio(lead.whatsapp), nome: lead.nome || contexto.lead.nome,
      campanha: (lead.origem && lead.origem.campanha) || contexto.lead.campanha, formulario: (lead.origem && lead.origem.formulario) || contexto.lead.formulario,
    },
  };
  const regras = regrasDa(ctx.integracao);
  const inicial = estadoInicial(lead.respostas || {}, ctx.agora.toISOString());
  const passo = proximoPasso(inicial, { tipo: "lead_criado", faixa: lead.faixa, nutricao: lead.nutricao }, regras, configDoRobo(ctx.integracao, c, ctx.agora));
  await aplicar(ctx, db, c, passo, regras);
  await despacharDaConta(ctx, db);
}

async function botaoDoVendedor(ctx: Contexto, db: Banco, m: MensagemRecebida, botao: { lead_id: string; acao: "atendi" | "simulacao" | "vendeu" | "sem_resposta" }): Promise<void> {
  const para = telefoneParaEnvio(m.de);
  if (!para) return;
  const contexto = await lerContexto(db, botao.lead_id);
  // Negócio de outra empresa (ou que não existe): responde como inexistente, sem tocar em nada.
  const daqui = !!contexto && contexto.lead.conta_id === ctx.integracao.conta_id;
  const resultado = daqui ? await chamar<unknown>(db, "crm_lead_avancar", { _lead: botao.lead_id, _acao: botao.acao, _telefone: m.de }) : { ok: false, motivo: "inexistente" };
  const texto = confirmacaoAoVendedor(resultado, daqui && contexto ? contexto.lead.nome : "", botao.acao);
  // O vendedor acabou de escrever: está na janela, a confirmação sai como texto.
  await chamar(db, "crm_whats_enfileirar", {
    _conta: ctx.integracao.conta_id, _lead: daqui ? botao.lead_id : null, _para: para, _destino: "vendedor",
    _corpo: { ...corpoDeTexto(para, texto), _texto: texto }, _chave: `vend:${botao.lead_id}:${botao.acao}:${m.id}`.slice(0, 200),
  });
}

async function mensagemDoLead(ctx: Contexto, db: Banco, m: MensagemRecebida, leadId: string): Promise<void> {
  const lido = await lerContexto(db, leadId);
  if (!lido || lido.lead.conta_id !== ctx.integracao.conta_id || lido.lead.arquivado || lido.parou) return;
  // Responde para o número de onde a mensagem veio (o WhatsApp às vezes entrega sem o nono dígito).
  const contexto: ContextoDoLead = { ...lido, lead: { ...lido.lead, telefone: telefoneParaEnvio(m.de) || lido.lead.telefone } };
  const regras = regrasDa(ctx.integracao);
  const estado = estadoDaConversa(contexto.conversa, ctx.agora.toISOString());
  let opcao = m.opcao;
  if (!opcao && m.texto && estado.etapa === "perguntando" && estado.pergunta && !pediuParaParar(m.texto)) {
    const pergunta = montarPergunta(estado.pergunta, regras);
    if (pergunta && !casarTextoLivre(m.texto, pergunta)) opcao = await classificarComIA(m.texto, pergunta, ctx);
  }
  const passo = proximoPasso(estado, { tipo: "mensagem", texto: m.texto, opcao }, regras, configDoRobo(ctx.integracao, contexto, ctx.agora));
  await aplicar(ctx, db, contexto, passo, regras);
}

/**
 * O que chegou pelo webhook do WhatsApp da empresa: respostas do lead, toques do vendedor nos botões
 * e avisos de entrega. Aceita o corpo do webhook, as `entry`, as `changes` ou os `value`.
 */
export async function tratarWhatsapp(ctx: Contexto, entradas: unknown[]): Promise<void> {
  const db = ctx.servico as unknown as Banco;
  const conta = ctx.integracao.conta_id;
  const { mensagens, status } = lerEntradas(entradas);
  const meuNumero = String(ctx.integracao.wa_phone_id || "");
  let falhas = 0;

  for (const s of status) {
    if (s.status !== "failed") continue;
    try {
      await chamar(db, "crm_whats_status_falhou", { _conta: conta, _wa_message_id: s.id, _erro: s.erro });
    } catch {
      falhas += 1;
    }
  }

  for (const m of mensagens) {
    // Mensagem de outro número da mesma conta do WhatsApp não é deste robô.
    if (meuNumero && m.phone_id && m.phone_id !== meuNumero) continue;
    const texto = m.texto || (m.tipo === "outro" ? "[Mandou áudio, imagem ou outro tipo de mensagem]" : "");
    const entrada = await chamar<{ nova?: boolean; vendedor?: { user_id: string; nome: string } | null; lead_id?: string | null; parou?: boolean } | null>(
      db, "crm_whats_entrada", { _conta: conta, _telefone: m.de, _wa_message_id: m.id, _texto: texto, _quando: m.quando || ctx.agora.toISOString() });
    if (!entrada || entrada.nova !== true) continue;
    try {
      const botao = lerBotaoDoVendedor(m.opcao);
      if (botao) await botaoDoVendedor(ctx, db, m, botao);
      else if (entrada.lead_id && !entrada.parou) await mensagemDoLead(ctx, db, m, entrada.lead_id);
      // Número que não é lead em conversa nem toque de vendedor: o robô não responde.
    } catch (e) {
      falhas += 1;
      console.error("[whatsapp-do-crm] mensagem", m.id.slice(0, 40), e instanceof Error ? e.message.slice(0, 80) : "");
      // Solta a mensagem para ela poder ser tratada de novo se a Meta repetir a entrega.
      await chamar(db, "crm_whats_entrada_desfazer", { _conta: conta, _wa_message_id: m.id }).catch(() => undefined);
    }
  }

  await despacharDaConta(ctx, db);
  if (falhas) throw new Error(`whatsapp: ${falhas} item(ns) não tratado(s)`);
}

/** A fila deu um vendedor ao lead (crm_fila_distribuir): se as perguntas já acabaram, o vendedor é avisado. */
export async function aoDistribuir(ctx: Contexto, leadId: string): Promise<void> {
  const db = ctx.servico as unknown as Banco;
  const contexto = await lerContexto(db, leadId);
  if (!contexto || contexto.lead.conta_id !== ctx.integracao.conta_id || !contexto.conversa || contexto.lead.arquivado) return;
  const regras = regrasDa(ctx.integracao);
  const estado = estadoDaConversa(contexto.conversa, ctx.agora.toISOString());
  if (estado.etapa !== "qualificado") return;
  const passo = proximoPasso(estado, { tipo: "distribuido", vendedor: contexto.vendedor }, regras, configDoRobo(ctx.integracao, contexto, ctx.agora));
  await aplicar(ctx, db, contexto, passo, regras);
}

/** O prazo do follow-up venceu (crm_whats_followups_pegar): insiste por template ou encerra. */
export async function aoVencerPrazo(ctx: Contexto, leadId: string, venciaEm: string | null): Promise<void> {
  const db = ctx.servico as unknown as Banco;
  const contexto = await lerContexto(db, leadId);
  if (!contexto || contexto.lead.conta_id !== ctx.integracao.conta_id || !contexto.conversa) return;
  const regras = regrasDa(ctx.integracao);
  const estado = estadoDaConversa(contexto.conversa, ctx.agora.toISOString());
  // A reserva empurrou o prazo 10 minutos para a frente: a máquina confere pelo prazo de verdade.
  estado.proximo_followup_em = isoOuNulo(venciaEm) || ctx.agora.toISOString();
  if (contexto.parou || contexto.lead.arquivado || contexto.lead.etapa === "ganho" || contexto.lead.etapa === "perdido") {
    const telefone = telefoneParaEnvio(contexto.lead.telefone);
    if (telefone) await chamar(db, "crm_whats_conversa_salvar", { _lead: leadId, _telefone: telefone, _estado: { ...estado, etapa: "encerrado", pergunta: null, proximo_followup_em: null } });
    return;
  }
  const passo = proximoPasso(estado, { tipo: "tempo" }, regras, configDoRobo(ctx.integracao, contexto, ctx.agora));
  await aplicar(ctx, db, contexto, passo, regras);
}
