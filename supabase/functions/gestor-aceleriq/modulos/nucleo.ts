/**
 * Núcleo do Gestor Aceleriq: lê o recorte, monta a ficha, redige e confere.
 *
 * Separado do index.ts (sessão, papel e conversa) para rodar igual fora da
 * borda: o teste de ponta contra o banco real usa o mesmo caminho. Quem chama
 * injeta o cliente do banco (chave de serviço) DEPOIS de conferir o papel.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { jevPerguntar } from "../../_shared/jev.ts";
import { chamarTexto, cobrarJev, IaMotorErro, type ImagemEntrada, modeloPadrao } from "../../_shared/ia-motor.ts";
import { registrarFalha } from "../../_shared/falha-registrada.ts";
import {
  type AprovacaoBruta,
  type ClienteBase,
  clienteDaPergunta,
  conferirContraAFicha,
  contagemDoRecorte,
  type ArquivoDoDono,
  fontesDosAnexos,
  type DiarioBruto,
  type EntregaBruta,
  type Fonte,
  type ItemDaResposta,
  montarFicha,
  type Periodo,
  periodoDaPergunta,
  type PublicacaoBruta,
  respostaDoMotor,
  respostaEmConversa,
  respostaEmTexto,
  SECOES_DA_RESPOSTA,
  type RunBruto,
  type SecaoDaResposta,
  type TarefaBruta,
  type VinculoBruto,
} from "./ficha.ts";
import { aplicarConferencia, aplicarConferenciaDaConversa, perguntasDeConferencia, perguntasDeConversa, type RespostaChoice } from "./conferencia.ts";
import {
  type AcaoDoAgente,
  blocoDosAlvos,
  comApelido,
  esquemaDasAcoes,
  executarDireto,
  normalizarAcaoDoAgente,
  pareceOrdem,
  podeExecutarDireto,
  regraDasAcoes,
} from "../../_shared/acoes-do-agente.ts";
import { ehOrdemClara } from "../../_shared/ordem-clara.ts";
import { type BlocoDeResposta, type BlocoTabela, ESQUEMA_FLUXO, ESQUEMA_TABELA, validarBlocos } from "../../_shared/blocos-de-resposta.ts";
import { blocoDasConsultas, executarConsultas, normalizarConsultas } from "../../_shared/consultas-do-agente.ts";
// Lote C (09/10): o Gestor lê páginas e pesquisa no navegador remoto real do cliente.
import { ESQUEMA_DAS_CONSULTAS_DO_GESTOR, LINHA_DO_NAVEGADOR, lerPeloNavegador, pedidosDoNavegador } from "./navegador-do-gestor.ts";
import { AGENTE_DO_GESTOR, alvoDaTarefa, type AlvoDoGestor, DESCRICOES_DAS_OPERACOES, type EntregaDoGestor, type ObjetoDoGestor, OPERACOES_DE_DECISAO, regrasDoGestor } from "./ferramentas.ts";
import { entregasDaAcao, executarItem } from "./executor.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TOKENS_SAIDA = 4000;

export class ErroHttp extends Error {
  constructor(public status: number, public codigo: string, mensagem: string) { super(mensagem); }
}

let banco: SupabaseClient | null = null;
/** O cliente do banco (chave de serviço). Só depois de conferir quem pede. */
export function usarBanco(c: SupabaseClient) { banco = c; }
function servico(): SupabaseClient {
  if (!banco) throw new Error("gestor-aceleriq: banco não configurado");
  return banco;
}

// ------------------------------------------------------------------ leitura

const lote = <T,>(xs: T[], n = 150) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

function falhaAlta(r: { error: { message: string } | null }, oque: string) {
  if (r.error) throw new ErroHttp(503, "dados_indisponiveis", `Não consegui ler ${oque} agora: ${r.error.message}`);
}

export async function lerClientes(): Promise<ClienteBase[]> {
  const s = servico();
  const [projetos, marcas] = await Promise.all([
    s.from("projects").select("client_id, client:profiles!projects_client_id_fkey(id, company_name, full_name)").not("client_id", "is", null).limit(2000),
    s.from("cliente_marcas").select("client_id, project_id, nome, principal").limit(500),
  ]);
  falhaAlta(projetos, "os clientes");
  const porId = new Map<string, ClienteBase>();
  for (const p of (projetos.data || []) as unknown as Array<{ client: { id: string; company_name: string | null; full_name: string | null } | null }>) {
    const c = p.client;
    if (!c || porId.has(c.id)) continue;
    const nome = (c.company_name || "").trim() || (c.full_name || "").trim();
    if (nome) porId.set(c.id, { id: c.id, nome });
  }
  const lista = [...porId.values()];
  // Marca secundária (CME da Acerbi) vira entrada própria, restrita ao projeto dela.
  for (const m of (marcas.data || []) as Array<{ client_id: string; project_id: string | null; nome: string; principal: boolean }>) {
    const dono = porId.get(m.client_id);
    if (!dono || m.principal || !m.nome?.trim()) continue;
    lista.push({ id: dono.id, nome: m.nome.trim(), projetoId: m.project_id, marca: m.nome.trim() });
  }
  return lista;
}

type Recorte = { cliente: ClienteBase | null; periodo: Periodo; nomes: Map<string, string> };

export async function lerFatos(r: Recorte) {
  const s = servico();
  const { periodo } = r;
  const desdeAmplo = periodo.anterior.desde < periodo.desde ? periodo.anterior.desde : periodo.desde;

  const [operadores, projetosR] = await Promise.all([
    s.from("internal_operators").select("id, display_name, slug").limit(200),
    r.cliente
      ? (r.cliente.projetoId ? s.from("projects").select("id, client_id").eq("id", r.cliente.projetoId) : s.from("projects").select("id, client_id").eq("client_id", r.cliente.id)).limit(200)
      : Promise.resolve({ data: null, error: null }),
  ]);
  falhaAlta(operadores, "os agentes");
  falhaAlta(projetosR as { error: { message: string } | null }, "os projetos");
  const nomeAgente = new Map(((operadores.data || []) as Array<{ id: string; display_name: string }>).map((o) => [o.id, o.display_name]));
  const projetoIds = ((projetosR.data || []) as Array<{ id: string }>).map((p) => p.id);

  // Tarefas: do recorte, mexidas no período ou abertas.
  const colunasTarefa = "id, title, status, updated_at, due_date, description, project:projects!tasks_project_id_fkey(client:profiles!projects_client_id_fkey(company_name, full_name))";
  const tarefasBrutas: Array<Record<string, unknown>> = [];
  if (r.cliente) {
    for (const ids of lote(projetoIds)) {
      const q = await s.from("tasks").select(colunasTarefa).in("project_id", ids).is("deleted_at", null).or(`updated_at.gte.${desdeAmplo},status.in.(doing,review,todo)`).order("updated_at", { ascending: false }).limit(400);
      falhaAlta(q, "as tarefas");
      tarefasBrutas.push(...(q.data || []) as Array<Record<string, unknown>>);
    }
  } else {
    const q = await s.from("tasks").select(colunasTarefa).is("deleted_at", null).gte("updated_at", periodo.desde).lt("updated_at", periodo.ate).order("updated_at", { ascending: false }).limit(300);
    falhaAlta(q, "as tarefas");
    tarefasBrutas.push(...(q.data || []) as Array<Record<string, unknown>>);
  }

  // Vínculos: das tarefas do recorte; na visão geral, também os que mexeram no período.
  const tarefaIds = tarefasBrutas.map((t) => String(t.id));
  const vinculos: VinculoBruto[] = [];
  const colunasVinculo = "id, status, operator_id, kanban_task_id, painel_task_id, last_action, last_evidence, next_step, block_reason, updated_at";
  for (const ids of lote(tarefaIds)) {
    const q = await s.from("operator_task_links").select(colunasVinculo).in("kanban_task_id", ids).limit(500);
    falhaAlta(q, "as execuções");
    vinculos.push(...(q.data || []) as VinculoBruto[]);
  }
  if (!r.cliente) {
    const q = await s.from("operator_task_links").select(colunasVinculo).gte("updated_at", periodo.desde).lt("updated_at", periodo.ate).limit(300);
    falhaAlta(q, "as execuções");
    const ja = new Set(vinculos.map((v) => v.id));
    for (const v of (q.data || []) as VinculoBruto[]) if (!ja.has(v.id)) vinculos.push(v);
    // Tarefas desses vínculos que não estavam na lista (para o estado sair certo).
    const faltam = [...new Set(vinculos.map((v) => v.kanban_task_id).filter((x): x is string => !!x && !tarefaIds.includes(x)))];
    for (const ids of lote(faltam)) {
      const t = await s.from("tasks").select(colunasTarefa).in("id", ids).is("deleted_at", null);
      falhaAlta(t, "as tarefas");
      tarefasBrutas.push(...(t.data || []) as Array<Record<string, unknown>>);
    }
  }
  const vinculoIds = vinculos.map((v) => v.id);

  const runs: RunBruto[] = [];
  const diario: DiarioBruto[] = [];
  const colunasRun = "id, operator_id, run_key, task_link_id, status, started_at, finished_at, heartbeat_at, error, detail";
  for (const ids of lote(vinculoIds)) {
    const [qr, qd] = await Promise.all([
      s.from("operator_runs").select(colunasRun).in("task_link_id", ids).gte("heartbeat_at", periodo.desde).limit(400),
      s.from("operator_participations").select("id, task_link_id, entry_type, title, body, author_kind, operator_id, created_at").in("task_link_id", ids).gte("created_at", periodo.desde).lt("created_at", periodo.ate).order("created_at", { ascending: false }).limit(300),
    ]);
    falhaAlta(qr, "as execuções");
    falhaAlta(qd, "o diário");
    runs.push(...(qr.data || []) as RunBruto[]);
    diario.push(...(qd.data || []) as DiarioBruto[]);
  }
  if (!r.cliente) {
    // Execuções sem tarefa vinculada também contam na visão geral.
    const q = await s.from("operator_runs").select(colunasRun).is("task_link_id", null).gte("heartbeat_at", periodo.desde).limit(200);
    falhaAlta(q, "as execuções");
    runs.push(...(q.data || []) as RunBruto[]);
  }

  // deno-lint-ignore no-explicit-any
  const filtroCliente = (q: any) => (r.cliente ? q.eq("client_id", r.cliente.id) : q);
  let pubs = s.from("editorial_publications").select("id, post_id, status, published_at, scheduled_at, permalink, platform, project_id, client_id, post:editorial_posts!editorial_publications_post_fk(title)").or(`and(published_at.gte.${periodo.desde},published_at.lt.${periodo.ate}),and(scheduled_at.gte.${periodo.desde},scheduled_at.lt.${periodo.ate})`).limit(200);
  pubs = filtroCliente(pubs);
  if (r.cliente?.projetoId) pubs = pubs.eq("project_id", r.cliente.projetoId);
  let entregas = s.from("operator_deliveries").select("id, o_que, como, onde_acessar, onde_documentado, occurred_at, kanban_task_id, operator_id, client_id").gte("occurred_at", periodo.desde).lt("occurred_at", periodo.ate).limit(200);
  entregas = filtroCliente(entregas);
  const aprov = s.from("operator_approvals").select("id, o_que, por_que, status, created_at, task_link_id, kanban_task_id, operator_id, client_id, client:profiles!operator_approvals_client_id_fkey(company_name, full_name)").in("status", ["pendente", "adiado"]).limit(200);
  const [qp, qe, qa] = await Promise.all([pubs, entregas, aprov]);
  // Publicações e entregas não derrubam a resposta: viram aviso (a ficha diz o que faltou ler).
  const avisos: string[] = [];
  if (qp.error) { avisos.push("Não consegui ler as publicações do calendário agora."); registrarFalha("gestor-aceleriq: publicacoes", qp.error); }
  if (qe.error) { avisos.push("Não consegui ler o registro de entregas agora."); registrarFalha("gestor-aceleriq: entregas", qe.error); }
  falhaAlta(qa, "as aprovações");

  const nomeDe = (c: unknown) => { const x = c as { company_name?: string | null; full_name?: string | null } | null; return x ? (x.company_name || x.full_name || null) : null; };
  const tarefas: TarefaBruta[] = tarefasBrutas.map((t) => ({
    id: String(t.id), title: String(t.title || ""), status: String(t.status || ""), updated_at: String(t.updated_at || ""), due_date: (t.due_date as string) || null,
    description: (t.description as string) || null, cliente: nomeDe((t.project as { client?: unknown } | null)?.client),
  }));
  const tarefaIdsFinal = new Set(tarefas.map((t) => t.id));
  const vinculoIdsFinal = new Set(vinculoIds);
  const aprovacoes: AprovacaoBruta[] = ((qa.data || []) as Array<Record<string, unknown>>)
    .filter((a) => !r.cliente || a.client_id === r.cliente.id || (a.kanban_task_id && tarefaIdsFinal.has(String(a.kanban_task_id))) || (a.task_link_id && vinculoIdsFinal.has(String(a.task_link_id))))
    .map((a) => ({ id: String(a.id), o_que: String(a.o_que || ""), por_que: (a.por_que as string) || null, status: String(a.status), created_at: String(a.created_at), task_link_id: (a.task_link_id as string) || null, kanban_task_id: (a.kanban_task_id as string) || null, operator_id: String(a.operator_id), cliente: nomeDe(a.client) }));
  const publicacoes: PublicacaoBruta[] = ((qp.data || []) as Array<Record<string, unknown>>).map((p) => ({
    id: String(p.id), post_id: (p.post_id as string) || null, status: String(p.status), published_at: (p.published_at as string) || null, scheduled_at: (p.scheduled_at as string) || null,
    permalink: (p.permalink as string) || null, platform: (p.platform as string) || null, titulo: ((p.post as { title?: string } | null)?.title) || null, cliente: r.nomes.get(String(p.client_id)) || null,
  }));
  const entregasL: EntregaBruta[] = ((qe.data || []) as Array<Record<string, unknown>>).map((e) => ({
    id: String(e.id), o_que: String(e.o_que || ""), como: (e.como as string) || null, onde_acessar: (e.onde_acessar as string) || null, onde_documentado: (e.onde_documentado as string) || null,
    occurred_at: String(e.occurred_at), kanban_task_id: (e.kanban_task_id as string) || null, operator_id: String(e.operator_id), cliente: r.nomes.get(String(e.client_id)) || null,
  }));

  return { tarefas, vinculos, runs, diario, publicacoes, entregas: entregasL, aprovacoes, nomeAgente, avisos };
}

// ------------------------------------------------------------------ cliente por Jev (só quando o nome não bateu)

async function clientePorJev(pergunta: string, clientes: ClienteBase[], agencia: string | null, userId: string, anterior: ClienteBase | null = null): Promise<ClienteBase | null> {
  const principais = clientes.filter((c) => !c.projetoId);
  if (!principais.length) return anterior;
  if (principais.length > 40) return anterior;
  const criteria: Record<string, string> = { geral: "a pergunta fala da agência toda, de todos os clientes, de um agente ou de outro assunto, sem cliente específico" };
  // Continuidade: "qual depende de mim?" logo depois de falar da Acerbi continua sendo da Acerbi.
  if (anterior) criteria.mesmo = `a pergunta continua falando de "${anterior.nome}", o cliente tratado na conversa até aqui (referência implícita como "essa", "dela", "qual depende de mim", "continua"), sem nomear outro cliente`;
  principais.forEach((c, i) => { criteria[`c${i}`] = `a pergunta é sobre o cliente "${c.nome}" (mesmo escrito com erro, abreviado ou sem acento)`; });
  try {
    const r = await jevPerguntar({
      state: { pergunta: pergunta.slice(0, 600), cliente_da_conversa_ate_aqui: anterior ? anterior.nome : null },
      questions: { cliente: { type: "choice", instructions: "Qual cliente da agência a `pergunta` trata? Considere `cliente_da_conversa_ate_aqui` para perguntas de continuidade.", criteria } },
    }, { timeoutMs: 6_000 });
    if (agencia) void cobrarJev(r, { clientId: agencia, tarefa: "conversa", criadoPor: userId });
    const a = r.answers.cliente as RespostaChoice | undefined;
    const p = a?.choice ? Number(a.probabilities?.[a.choice] ?? a.confidence ?? 0) : 0;
    if (!a?.choice || a.choice === "geral") return null;
    if (a.choice === "mesmo") return p >= 0.5 ? anterior : null;
    if (p < 0.85) return null;
    return principais[Number(a.choice.slice(1))] || null;
  } catch (e) {
    registrarFalha("gestor-aceleriq: jev do cliente fora (segue com o cliente anterior)", e);
    return anterior;
  }
}

export async function carteiraDaAgencia(): Promise<string | null> {
  const { data, error } = await servico().from("profiles").select("id").eq("services_config->>internal_company", "true").limit(5);
  if (error) { registrarFalha("gestor-aceleriq: carteira da agência sem leitura", error); return null; }
  const ids = ((data || []) as { id: string }[]).map((x) => x.id);
  if (!ids.length) return null;
  const { data: carteiras } = await servico().from("ia_carteiras").select("client_id, saldo_usd").in("client_id", ids).order("saldo_usd", { ascending: false }).limit(1);
  const c = ((carteiras || []) as { client_id: string }[])[0];
  return c ? c.client_id : ids[0];
}

// ------------------------------------------------------------------ redação (IA) com as barreiras

/**
 * Conversa contínua (09/10/2026, pedido do dono): sem abertura, fechamento e
 * sugestões fixas; o modelo lê o histórico e responde só ao que foi pedido,
 * do tamanho que a pergunta pede. A liberdade é de redação, não de fato:
 * fato da operação só com fonte (barreira de código + Jev); frase sem fonte só
 * na seção "conversa", e o Jev tira a que afirmar fato.
 */
const SISTEMA = `Você é o Gestor Aceleriq, o braço direito do Almir (dono da agência) dentro do painel. Converse como uma pessoa competente no chat: natural, direta, em português do Brasil. A conversa é contínua: leia o HISTÓRICO e responda à ÚLTIMA MENSAGEM levando em conta tudo o que já foi dito e feito.

COMO RESPONDER
- Responda exatamente ao que foi perguntado ou pedido agora. Se uma frase resolve, uma frase. Vá longe só quando o assunto pedir. Não repita o que já foi dito no histórico.
- Perguntas de continuidade ("qual depende de mim?", "e essa?", "pode aprovar", "abre o que você fez", "continua de onde parou", "isso", "aquela tarefa", "esse cliente") falam do que acabou de ser tratado: use o HISTÓRICO e os OBJETOS DA CONVERSA para saber exatamente qual. Pergunte de volta só se houver ambiguidade real.
- Correção ou mudança de direção do dono vale mais do que o que veio antes. Confirmação ("isso", "pode", "sim") confirma a última proposta.
- Pedido claro: faça (proponha em "acoes"). Não explique o que você pode fazer em vez de fazer.
- Varie a forma. Nada de abertura fixa ("Dei uma olhada..."), fechamento fixo, saudação, markdown, listas ou travessão.
- Cada item de "itens" é UMA mensagem no chat, de 1 a 3 frases. Quase sempre 1 a 3 mensagens; mais só quando ele pedir um panorama.

VERDADE (regras duras)
- Fato da operação só com fonte: o item cita os apelidos F1, F2... que o sustentam, numa seção que combina com o estado da fonte. Pode citar fonte também numa mensagem de seção "conversa" quando a frase só retoma o que a fonte diz.
- Mensagem sem fonte só na seção "conversa", e ela NÃO pode afirmar fato (estado, número, prazo, decisão, resultado de ação). Só perguntar, confirmar o que entendeu, dizer o que está propondo ou o que precisa da confirmação dele.
- O ESTADO de cada fonte foi decidido pelo sistema: em_revisao e execucao_feita_entrega_em_revisao NÃO são concluídos; agendado NÃO é publicado; concluido_sem_prova NÃO é feito com prova; divergente = a execução do agente e o card estão em estados diferentes.
- Seções: conversa, feito (só feito_com_prova), concluido_sem_prova, em_revisao, em_andamento, bloqueado (bloqueado, falhou, aguardando insumo, divergente), decisao (decisao_pendente), lacuna, proximo, anexo.
- Nunca diga que fez, aprovou, criou ou mandou: o sistema executa ou pede Confirmar e mostra o cartão com o estado real logo abaixo. Diga o que está propondo ("Deixei a aprovação pronta para você confirmar.").
- Fontes A1, A2... são o que o dono mandou agora; não provam nada no OS.

CONSULTAR ANTES DE AGIR ("consultas")
- Consultar → compreender → executar → verificar → responder. Antes de perguntar algo ao dono, criar tarefa ou mandar a um agente, veja se uma CONSULTA resolve.
- Pedido de conferir, ler, resumir, verificar ou comparar algo que as consultas alcançam (briefing, contexto da Mesa, arquivos, agenda, métricas, cérebro, dossiê): peça as consultas (até 4) e responda com o que leu. NUNCA crie tarefa "conferir/verificar/ler X" para isso.
- O resultado volta como fontes L1, L2... (estado lido_no_os). Cite-as. O que leu pode ir em "conversa" (com a fonte L), "lacuna" (o que falta) e "proximo".
- Se você já recebeu o resultado das consultas nesta rodada, consultas = [] e responda.
- Consulta precisa de cliente: na conversa geral sem cliente claro, pergunte qual.

AÇÕES ("acoes"; null quando não há pedido)
- Só apelidos das listas: cN cliente, pN projeto, tN tarefa, aN solicitação de aprovação pendente.
- "Pode aprovar" / "aprova essa" = aprovar_solicitacao no aN certo (o que acabou de ser tratado). Registrar decisão na memória NÃO é aprovar e não substitui. Se não existe aN correspondente, diga isso numa mensagem de conversa e não invente.
- Aprovar não envia nem publica. Pedido de enviar ou publicar vai em "bloqueadas".
- "Continua organizando o cliente" = use pendências, bloqueios e próximos passos das fontes e proponha as próximas ações permitidas (criar tarefa, ajustar tarefa, mandar a um agente), várias de uma vez se fizer sentido.
- registrar_memoria só quando ele disser algo que deve valer daqui para frente (preferência, regra, decisão dele). Nunca como substituto de executar.
- SENSÍVEL (publicar, mandar mensagem ou e-mail a cliente, mexer em campanha, anúncio ou verba, gastar, contrato, excluir de vez, mudar acesso): não executa; vai em "bloqueadas" {pedido, motivo, onde}. Sem nada assim, [].

ABRIR ("abrir")
- Se ele pedir para abrir ou ver um objeto ("abre o que você fez", "abre essa tarefa", "mostra a aprovação"), devolva o apelido dele (F, t, p, a ou o). Senão "".

APRESENTAÇÃO ("blocos"; quase sempre [])
- Só quando ajuda a entender. Nunca transforme toda resposta em cartão.
- "fluxo": quando ele pedir um processo, plano, passo a passo ou diagrama. Se ele pedir DIAGRAMA, DESENHO ou FLUXO, inclua SEMPRE um bloco fluxo (além de qualquer tabela). natureza "proposta" (é o seu desenho, não estado do sistema); estado só "planejado".
- "tabela": para comparar itens das FONTES (ex.: tarefas por estado, entregas por cliente). Cada célula sai do que está nas fontes, e o bloco cita em "fontes" os apelidos usados. Sem fonte, sem tabela.
- Métricas e gráficos de contagem o sistema monta sozinho quando mostrar_numeros = true; não escreva números em bloco.

NÚMEROS E SUGESTÕES
- mostrar_numeros = true só quando ele pedir panorama geral ou resumo do período; pergunta específica = false.
- sugestoes: 0 a 3 próximas perguntas curtas, só se forem úteis de verdade e diferentes das que já apareceram. Quase sempre nenhuma.`;

const ESQUEMA = {
  nome: "resposta_do_gestor",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["itens", "acoes", "bloqueadas", "abrir", "mostrar_numeros", "sugestoes", "blocos", "consultas"],
    properties: {
      acoes: esquemaDasAcoes(Object.keys(DESCRICOES_DAS_OPERACOES)),
      bloqueadas: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["pedido", "motivo", "onde"],
          properties: {
            pedido: { type: "string" },
            motivo: { type: "string" },
            onde: { type: "string", enum: ["mesa_ads", "calendario", "kanban", "execucao", "contratos", "clientes", "outro"] },
          },
        },
      },
      itens: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["secao", "texto", "fontes"],
          properties: {
            secao: { type: "string", enum: SECOES_DA_RESPOSTA },
            texto: { type: "string" },
            fontes: { type: "array", items: { type: "string" } },
          },
        },
      },
      abrir: { type: "string" },
      mostrar_numeros: { type: "boolean" },
      sugestoes: { type: "array", items: { type: "string" } },
      blocos: { type: "array", maxItems: 3, items: { anyOf: [ESQUEMA_FLUXO, ESQUEMA_TABELA] } },
      consultas: ESQUEMA_DAS_CONSULTAS_DO_GESTOR,
    },
  },
};

type Redacao = { bruto: Record<string, unknown> | null; itens: ItemDaResposta[]; origem: "ia_conferida" | "motor"; avisos: string[]; custo: number; usoId: string | null; modelo: string | null; recusados: number; contestados: number };

async function redigir(pergunta: string, cabecalho: string, fontes: Fonte[], o: { agencia: string | null; userId: string; semIa: boolean; historico: string; imagens?: ImagemEntrada[]; blocoDeAcoes?: string; blocoDeObjetos?: string; aviso?: string }): Promise<Redacao> {
  const motor = (aviso?: string): Redacao => ({ bruto: null, itens: respostaDoMotor(fontes, 2).filter((i) => !/^e mais \d+ no período$/.test(i.texto)), origem: "motor", avisos: aviso ? [aviso] : [], custo: 0, usoId: null, modelo: null, recusados: 0, contestados: 0 });
  if (o.semIa) return motor();
  if (!o.agencia) return motor("Sem carteira de IA da agência: respondi só com os fatos registrados.");
  const modelo = (await modeloPadrao("estrategista"))?.id || null;
  if (!modelo) return motor("Nenhum modelo de texto ligado: respondi só com os fatos registrados.");

  let saida;
  const agenciaDaChamada = o.agencia;
  const chamar = (aviso: string) => chamarTexto({
      clientId: agenciaDaChamada,
      tarefa: "conversa",
      agente: "estrategista",
      modeloId: modelo,
      sistema: SISTEMA,
      mensagens: [{
        papel: "usuario",
        conteudo: [
          o.historico ? `HISTÓRICO DESTA CONVERSA (mais antigo primeiro; contexto, não é fonte):\n${o.historico}` : "HISTÓRICO: esta é a primeira mensagem da conversa.",
          o.blocoDeObjetos || "",
          `ÚLTIMA MENSAGEM DO DONO (responda a esta): ${pergunta}`,
          o.aviso ? `AVISO DO SISTEMA: ${o.aviso}` : "",
          aviso ? `AVISO DO SISTEMA: ${aviso}` : "",
          `RECORTE DOS DADOS: ${cabecalho}`,
          `FONTES (JSON; só isto pode ser afirmado):\n${JSON.stringify(fontes.map((f) => ({ apelido: f.apelido, tipo: f.tipo, estado: f.estado, titulo: f.titulo, quando: f.quando, cliente: f.cliente, agente: f.agente, texto: f.texto })))}`,
          o.blocoDeAcoes || "",
        ].filter(Boolean).join("\n\n"),
        imagens: o.imagens && o.imagens.length ? o.imagens : undefined,
      }],
      esquemaJson: ESQUEMA,
      maxTokensSaida: MAX_TOKENS_SAIDA,
      timeoutMs: 90_000,
      criadoPor: o.userId,
    });
  try {
    try {
      saida = await chamar("");
    } catch (e) {
      // Resposta grande demais (JSON cortado no teto de saída): uma nova tentativa, mais curta.
      if (!(e instanceof IaMotorErro) || e.codigo !== "json_invalido") throw e;
      saida = await chamar("Sua resposta anterior passou do tamanho e foi cortada. Responda MAIS CURTO: no máximo 5 mensagens, no máximo 2 quadros e sem repetir fontes.");
    }
  } catch (e) {
    registrarFalha("gestor-aceleriq: IA indisponível (valeu a ficha)", e);
    return motor(e instanceof IaMotorErro ? `IA indisponível (${e.codigo}): respondi só com os fatos registrados.` : "IA indisponível: respondi só com os fatos registrados.");
  }

  const brutos = Array.isArray((saida.json as { itens?: unknown } | undefined)?.itens) ? (saida.json as { itens: unknown[] }).itens : [];
  const itens: ItemDaResposta[] = brutos.map((x) => {
    const i = x as { secao?: string; texto?: string; fontes?: unknown };
    return { secao: String(i.secao || "") as SecaoDaResposta, texto: String(i.texto || "").replace(/\s*[—–]\s*/g, ", ").trim().slice(0, 900), fontes: Array.isArray(i.fontes) ? i.fontes.map(String) : [] };
  }).filter((i) => i.texto);

  // Barreira 1 (código): fonte existe e o estado cabe na seção; conversa sem fonte passa para a barreira 3.
  const { aceitos, recusados } = conferirContraAFicha(itens, fontes);
  const avisos: string[] = [];
  if (recusados.length) avisos.push(`${recusados.length} ${recusados.length === 1 ? "frase da IA saiu" : "frases da IA saíram"} por não ter fonte ou por chamar de feito o que não está feito.`);

  const tipoDe = new Map(fontes.map((f) => [f.apelido.toUpperCase(), f.tipo]));
  const soImagem = (i: ItemDaResposta) => i.fontes.length > 0 && i.fontes.every((a) => tipoDe.get(a.toUpperCase()) === "anexo_imagem");
  const semFonte = (i: ItemDaResposta) => i.secao === "conversa" && !i.fontes.length;
  const paraOJev = aceitos.filter((i) => !soImagem(i) && !semFonte(i));
  const conversas = aceitos.filter(semFonte);
  const fica = new Set<ItemDaResposta>(aceitos);
  const trocado = new Map<ItemDaResposta, ItemDaResposta>();
  let contestados = 0;

  // Barreira 2 (Jev): a afirmação bate com a fonte citada? Barreira 3 (Jev): a frase sem fonte não afirma fato?
  try {
    const [r2, r3] = await Promise.all([
      paraOJev.length ? jevPerguntar(perguntasDeConferencia(paraOJev, fontes), { timeoutMs: 15_000 }) : Promise.resolve(null),
      conversas.length ? jevPerguntar(perguntasDeConversa(conversas), { timeoutMs: 12_000 }) : Promise.resolve(null),
    ]);
    if (r2) {
      void cobrarJev(r2, { clientId: o.agencia, tarefa: "verificacao", criadoPor: o.userId });
      const c = aplicarConferencia(paraOJev, r2.answers as Record<string, RespostaChoice>);
      const ficam = new Set(c.ficam.map((i) => i.texto));
      for (const i of paraOJev) if (!ficam.has(i.texto)) fica.delete(i);
      for (const i of c.ficam) { const orig = paraOJev.find((x) => x.texto === i.texto); if (orig) trocado.set(orig, i); }
      contestados += c.sairam.length;
      if (c.sairam.length) avisos.push(`${c.sairam.length} ${c.sairam.length === 1 ? "frase saiu" : "frases saíram"} na conferência com as fontes.`);
      if (c.fracos) avisos.push(`${c.fracos} ${c.fracos === 1 ? "frase ficou" : "frases ficaram"} com conferência fraca: abra a fonte.`);
    }
    if (r3) {
      void cobrarJev(r3, { clientId: o.agencia, tarefa: "verificacao", criadoPor: o.userId });
      const c = aplicarConferenciaDaConversa(conversas, r3.answers as Record<string, RespostaChoice>);
      for (const i of c.sairam) fica.delete(i);
      contestados += c.sairam.length;
      if (c.sairam.length) avisos.push(`${c.sairam.length} ${c.sairam.length === 1 ? "frase saiu porque afirmava" : "frases saíram porque afirmavam"} fato sem fonte.`);
    }
  } catch (e) {
    registrarFalha("gestor-aceleriq: jev da conferência fora", e);
    // Sem Jev, frase sem fonte não tem como ser conferida: só ficam as que citam fonte.
    for (const i of conversas) fica.delete(i);
    avisos.push("A conferência semântica (Jev) não rodou agora: ficaram só as frases com fonte.");
  }
  const finais = aceitos.filter((i) => fica.has(i)).map((i) => trocado.get(i) || i);

  const temAcaoOuBloqueio = !!(saida.json as { acoes?: unknown; bloqueadas?: unknown[] } | undefined) && (!!(saida.json as { acoes?: unknown }).acoes || ((saida.json as { bloqueadas?: unknown[] }).bloqueadas || []).length > 0 || !!(saida.json as { abrir?: string }).abrir);
  if (!finais.length && !temAcaoOuBloqueio) {
    return { ...motor("A redação da IA não passou na conferência: respondi só com os fatos registrados."), bruto: (saida.json as Record<string, unknown>) || null, custo: saida.custoUsd, usoId: saida.usoId, modelo: saida.modeloId, recusados: recusados.length, contestados };
  }
  return { bruto: (saida.json as Record<string, unknown>) || null, itens: finais, origem: "ia_conferida", avisos, custo: saida.custoUsd, usoId: saida.usoId, modelo: saida.modeloId, recusados: recusados.length, contestados };
}

// ------------------------------------------------------------------ referências da conversa ("isso", "aquela tarefa", "o que você fez")

/** Um objeto do OS citado, aberto, proposto ou criado na conversa. Persistido em gestor_mensagens.dados.referencias. */
export type ReferenciaDoGestor = ObjetoDoGestor & { origem: "citado" | "aberto" | "proposto" | "criado" | "decidido"; estado?: string | null };

const ROTULO_DO_OBJETO: Record<ObjetoDoGestor["tipo"], string> = {
  tarefa: "tarefa", memoria_agente: "memória", memoria_projeto: "memória", aprovacao: "solicitação de aprovação", projeto: "projeto", arquivo: "arquivo", publicacao: "publicação", vinculo: "execução de agente",
};

/** O objeto que uma fonte da ficha representa (para abrir na lateral e lembrar na conversa). */
export function objetoDaFonte(f: Fonte): ObjetoDoGestor | null {
  const titulo = f.titulo.slice(0, 140);
  if (f.tipo === "aprovacao" && f.ids.aprovacao) return { tipo: "aprovacao", id: f.ids.aprovacao, titulo };
  if (f.tipo === "publicacao" && f.ids.publicacao) return { tipo: "publicacao", id: f.ids.publicacao, titulo };
  if ((f.tipo === "tarefa" || f.tipo === "entrega") && f.ids.tarefa) return { tipo: "tarefa", id: f.ids.tarefa, titulo };
  if ((f.tipo === "execucao" || f.tipo === "diario") && f.ids.vinculo) return { tipo: "vinculo", id: f.ids.vinculo, titulo };
  if (f.ids.tarefa) return { tipo: "tarefa", id: f.ids.tarefa, titulo };
  return null;
}

// ------------------------------------------------------------------ a resposta inteira

export type ConversaDoGestor = { id: string; client_id: string | null; project_id: string | null };

export type EntradaDoResponder = {
  conversa?: ConversaDoGestor | null; arquivos?: ArquivoDoDono[]; imagens?: ImagemEntrada[]; pergunta: string; clienteId?: string | null; periodo?: string | null;
  userId: string; semIa: boolean; historico: string; tetoAtingido?: boolean; tetoPorDia?: number;
  /** Objetos da conversa (mais recente primeiro), lidos das mensagens anteriores. */
  referencias?: ReferenciaDoGestor[];
  /** Cliente da resposta anterior (conversa geral): perguntas de continuidade ficam nele. */
  clienteAnterior?: string | null;
  /** Só o teste de ponta: mostra a proposta sem executar direto (nada gravado no cliente real). */
  semExecutarDireto?: boolean;
};

export type Respondido =
  | { tipo: "esclarecer"; texto: string; opcoes: Array<{ id: string; nome: string }> }
  | { tipo: "resposta"; texto: string; clienteId: string | null; custo: number; usoId: string | null; dados: Record<string, unknown>; acao: AcaoDoAgente | null };

export async function responder(e: EntradaDoResponder): Promise<Respondido> {
  const periodo = periodoDaPergunta(e.pergunta, new Date(), e.periodo || null);
  const [clientes, agencia] = await Promise.all([lerClientes(), carteiraDaAgencia()]);

  // Cliente: o da conversa (isolamento) > o escolhido na tela > o nome na pergunta > o anexo > continuidade (Jev) > Jev na lista.
  let cliente: ClienteBase | null = null;
  const daConversa = e.conversa?.client_id ? clientes.find((c) => c.id === e.conversa!.client_id && !c.projetoId) || null : null;
  const escolhido = daConversa || (e.clienteId && UUID.test(e.clienteId) ? clientes.find((c) => c.id === e.clienteId && !c.projetoId) : null);
  if (!daConversa && e.clienteId && !escolhido) throw new ErroHttp(400, "cliente_invalido", "Esse cliente não existe no cadastro.");
  if (escolhido) cliente = escolhido;
  else {
    const achado = clienteDaPergunta(e.pergunta, clientes);
    if (achado.tipo === "ambiguo") {
      return { tipo: "esclarecer", texto: `Achei mais de um cliente com esse nome: ${achado.opcoes.map((c) => c.nome).join(", ")}. Qual deles?`, opcoes: achado.opcoes.map((c) => ({ id: c.id, nome: c.nome })) };
    }
    const doAnexo = achado.tipo === "nenhum" && (e.arquivos || []).length
      ? clienteDaPergunta((e.arquivos || []).map((x) => `${x.nome} ${x.texto.slice(0, 3000)}`).join(" "), clientes)
      : null;
    const anterior = e.clienteAnterior ? clientes.find((c) => c.id === e.clienteAnterior && !c.projetoId) || null : null;
    cliente = achado.tipo === "um" ? achado.cliente : doAnexo && doAnexo.tipo === "um" ? doAnexo.cliente : await clientePorJev(e.pergunta, clientes, agencia, e.userId, anterior);
  }

  const nomes = new Map(clientes.filter((c) => !c.projetoId).map((c) => [c.id, c.nome]));
  const fatos = await lerFatos({ cliente, periodo, nomes });
  const ficha = montarFicha({ periodo, ...fatos, nomeDoAgente: (id) => (id ? fatos.nomeAgente.get(id) || null : null) });
  const contagem = contagemDoRecorte(ficha.fontes);
  const nomeRecorte = cliente ? (cliente.marca ? `${cliente.marca} (marca de ${nomes.get(cliente.id) || "cliente"})` : cliente.nome) : "Todos os clientes";
  const cabecalho = `${nomeRecorte} · ${periodo.rotulo}`;

  // Ferramentas e objetos: o modelo só vê apelidos (c, p, t, a, o) e a lista de agentes.
  const referencias = (e.referencias || []).filter((r) => !cliente || !r.client_id || r.client_id === cliente.id);
  const alvos = await alvosDoGestor(cliente, clientes, fatos.tarefas, fatos.aprovacoes, e.conversa?.project_id || null, referencias);
  const blocoDeAcoes = e.semIa ? "" : [
    blocoDosAlvos("CLIENTES", alvos.clientes),
    blocoDosAlvos("PROJETOS DO CLIENTE", alvos.projetos, cliente ? "nenhum projeto ativo." : "nenhum (conversa geral: para criar tarefa, pergunte de qual cliente; não use outro)."),
    blocoDosAlvos("TAREFAS (ajustar ou mandar a um agente)", alvos.tarefas),
    blocoDosAlvos("SOLICITAÇÕES DE APROVAÇÃO PENDENTES (aprovar ou devolver)", alvos.aprovacoes, "nenhuma pendente neste recorte."),
    `\nAGENTES (slug: nome): ${alvos.agentes.map((a) => `${a.slug}: ${a.nome}`).join("; ") || "nenhum ativo"}\n`,
    cliente ? `${blocoDasConsultas()}\n${LINHA_DO_NAVEGADOR}` : "CONSULTAS: precisam de um cliente no recorte.",
    regraDasAcoes(DESCRICOES_DAS_OPERACOES),
  ].join("\n");
  const blocoDeObjetos = alvos.objetosDaConversa.length
    ? `OBJETOS DA CONVERSA (mais recente primeiro; use estes apelidos para "isso", "essa", "o que você fez"):\n${alvos.objetosDaConversa.map((o) => `${o.apelido} | ${ROTULO_DO_OBJETO[o.objeto.tipo]} | ${(o.objeto.titulo || "").slice(0, 120)} | ${o.origem}${o.estado ? ` · ${o.estado}` : ""}`).join("\n")}`
    : "";

  const anexos = fontesDosAnexos(e.arquivos || [], (e.imagens || []).map((i) => ({ nome: i.nome })));
  const todas = [...anexos.fontes, ...ficha.fontes];
  let red = await redigir(e.pergunta, cabecalho, todas, { agencia, userId: e.userId, semIa: e.semIa || !!e.tetoAtingido, historico: e.historico, imagens: e.imagens, blocoDeAcoes, blocoDeObjetos });
  // Consultar antes de agir: o modelo pediu leituras reais do cliente; elas viram fontes L1.. e ele redige de novo com o que leu.
  const consultas = cliente && red.bruto ? normalizarConsultas(red.bruto.consultas) : [];
  const doNavegador = cliente && red.bruto ? pedidosDoNavegador(red.bruto.consultas) : [];
  const leituras: Array<{ apelido: string; ferramenta: string; argumento: string }> = [];
  if ((consultas.length || doNavegador.length) && cliente) {
    const lidas = await executarConsultas(servico(), cliente.id, consultas);
    // Navegador remoto real do cliente: cada leitura vira uma fonte L como as outras (com evidência registrada).
    for (const arg of doNavegador) {
      lidas.push({ apelido: `L${lidas.length + 1}`, ferramenta: "navegador" as never, argumento: arg, texto: await lerPeloNavegador(servico() as never, cliente.id, arg, e.pergunta) });
    }
    for (const l of lidas) {
      todas.push({ apelido: l.apelido, tipo: "leitura", estado: "lido_no_os", titulo: `${l.ferramenta}${l.argumento ? ` (${l.argumento})` : ""}`, quando: new Date().toISOString(), texto: l.texto, cliente: nomeRecorte, agente: null, ids: {} });
      leituras.push({ apelido: l.apelido, ferramenta: l.ferramenta, argumento: l.argumento });
    }
    const custoDaPrimeira = red.custo;
    red = await redigir(e.pergunta, cabecalho, todas, {
      agencia, userId: e.userId, semIa: e.semIa || !!e.tetoAtingido, historico: e.historico, imagens: e.imagens, blocoDeAcoes, blocoDeObjetos,
      aviso: `Você pediu ${lidas.length} ${lidas.length === 1 ? "consulta" : "consultas"} e o resultado já está nas FONTES (${lidas.map((l) => l.apelido).join(", ")}). Agora responda ao dono com o que leu (o que temos, o que falta), cite as fontes L e devolva consultas = [].`,
    });
    red.custo += custoDaPrimeira;
  }
  const avisos = [...fatos.avisos, ...red.avisos];
  if (e.tetoAtingido && !e.semIa) avisos.push(`Teto de ${e.tetoPorDia ?? 60} respostas com IA por dia atingido: respondi só com os fatos registrados.`);
  if (ficha.cortadas && red.origem === "motor") avisos.push(`${ficha.cortadas} fatos a mais no período ficaram fora desta resposta: refine por cliente ou período.`);
  if (!ficha.fontes.length && red.origem === "motor") avisos.push("Nada registrado no OS para este recorte. Isso não prova que nada aconteceu fora do painel.");

  // A ação proposta: apelido vira id real, `para` validado, travas aplicadas. Direto só com ordem clara e sem decisão.
  let acao: AcaoDoAgente | null = null;
  if (red.bruto && !e.semIa) {
    const regras = regrasDoGestor(alvos.agentes.map((a) => a.slug));
    acao = normalizarAcaoDoAgente<AlvoDoGestor>(red.bruto.acoes, [...alvos.clientes, ...alvos.projetos, ...alvos.tarefas, ...alvos.aprovacoes], regras, {
      agente: AGENTE_DO_GESTOR,
      id: `gestor-${Date.now().toString(36)}`,
      contexto: { client_id: cliente?.id || null, conversa_id: e.conversa?.id || null, pergunta: e.pergunta.slice(0, 600) },
      semDesfazer: (itens) => itens.some((i) => i.operacao === "pedir_ao_agente" || OPERACOES_DE_DECISAO.includes(i.operacao)),
    });
    if (acao) {
      let clara = pareceOrdem(e.pergunta);
      try { clara = (await ehOrdemClara(e.pergunta, { agente: "Gestor Aceleriq", resumo: acao.resumo })).clara; } catch { /* vale a regra do verbo */ }
      const decisao = podeExecutarDireto(acao, regras, { pedidoClaro: clara });
      if (decisao.direto && !e.semExecutarDireto) {
        acao = await executarDireto(acao, (it, a) => executarItem(servico(), it, a, e.userId), { userId: e.userId });
        (acao as AcaoDoAgente & { entregas?: EntregaDoGestor[] }).entregas = await entregasDaAcao(servico(), acao);
      }
    }
  }
  const bloqueadas = (Array.isArray(red.bruto?.bloqueadas) ? red.bruto!.bloqueadas as Array<Record<string, unknown>> : []).slice(0, 5).map((b) => ({
    pedido: String(b.pedido || "").slice(0, 300), motivo: String(b.motivo || "").slice(0, 300), onde: String(b.onde || "outro"),
    link: linkDoLugar(String(b.onde || ""), cliente?.id || null),
  })).filter((b) => b.pedido);

  // Só as fontes citadas vão para a tela e para a conversa (o resto fica no total).
  const citadas = new Set(red.itens.flatMap((i) => i.fontes.map((a) => a.toUpperCase())));
  const fontesUsadas = todas.filter((f) => citadas.has(f.apelido.toUpperCase()));
  if (anexos.cortados.length) avisos.push(`Li só o começo de ${anexos.cortados.join(", ")}: o texto passou do limite de uma pergunta.`);

  // Abrir: o apelido pedido vira o objeto real (lateral nativa), nunca um id do modelo.
  const pedidoDeAbrir = String(red.bruto?.abrir || "").trim();
  const abrir = pedidoDeAbrir ? objetoDoApelido(pedidoDeAbrir, todas, alvos) : null;

  // Referências desta resposta: o que foi citado, aberto, proposto ou criado (para a próxima mensagem).
  const novas: ReferenciaDoGestor[] = [];
  const junta = (o: ObjetoDoGestor | null | undefined, origem: ReferenciaDoGestor["origem"], estado?: string | null) => {
    if (o && !novas.some((x) => x.tipo === o.tipo && x.id === o.id)) novas.push({ ...o, client_id: o.client_id ?? cliente?.id ?? null, origem, estado: estado ?? null });
  };
  for (const ent of ((acao as AcaoDoAgente & { entregas?: EntregaDoGestor[] } | null)?.entregas || [])) junta(ent.objeto, ent.tipo === "aprovacao" ? "decidido" : "criado", ent.estado);
  for (const it of acao?.itens || []) {
    const alvo = [...alvos.tarefas, ...alvos.aprovacoes].find((a) => a.id === it.alvo_id);
    if (alvo) junta({ tipo: it.operacao === "aprovar_solicitacao" || it.operacao === "pedir_alteracao" ? "aprovacao" : "tarefa", id: alvo.id, titulo: alvo.titulo }, "proposto", String(alvo.dados?.status || "") || null);
  }
  if (abrir) junta(abrir, "aberto");
  for (const f of fontesUsadas) junta(objetoDaFonte(f), "citado", f.estado);

  const sugestoes = (Array.isArray(red.bruto?.sugestoes) ? (red.bruto!.sugestoes as unknown[]) : []).map((x) => String(x).trim().slice(0, 120)).filter(Boolean).slice(0, 3);
  const blocosRecusados: string[] = [];
  const blocos = await blocosDaResposta(red, todas, contagem, { agencia, userId: e.userId, avisos, recusados: blocosRecusados });
  for (const b of blocos) for (const a of ("fontes" in b && b.fontes) || []) {
    const f = todas.find((x) => x.apelido.toUpperCase() === String(a).toUpperCase());
    if (f && !fontesUsadas.includes(f)) fontesUsadas.push(f);
  }
  const dados = {
    tipo: "resposta", origem: red.origem, cabecalho, periodo, abertura: null, fechamento: null, sugestoes,
    mostrar_numeros: red.origem === "motor" ? true : red.bruto?.mostrar_numeros === true,
    cliente: cliente ? { id: cliente.id, nome: nomeRecorte, projeto_id: cliente.projetoId || null } : null,
    acoes: acao ? [acao] : [], bloqueadas, abrir, referencias: novas.slice(0, 16), blocos, blocos_recusados: blocosRecusados, consultas: leituras,
    itens: red.itens, fontes: fontesUsadas, contagem, total_de_fontes: ficha.fontes.length, avisos, modelo: red.modelo, recusados: red.recusados, contestados: red.contestados,
    relatorio: respostaEmTexto(cabecalho, red.itens),
  };
  return { tipo: "resposta", texto: respostaEmConversa(red.itens) || (acao ? acao.resumo : ""), clienteId: cliente?.id || null, custo: red.custo, usoId: red.usoId, dados, acao };
}

const ROTULO_DO_ESTADO_CURTO: Record<string, string> = {
  feito_com_prova: "Feito com prova", concluido_sem_prova: "Concluído sem prova", execucao_feita_entrega_em_revisao: "Em revisão", em_revisao: "Em revisão", em_andamento: "Em andamento",
  bloqueado: "Bloqueado", aguardando_insumo: "Aguardando insumo", na_fila: "Na fila", pendente: "Pendente", decisao_pendente: "Sua decisão", agendado: "Agendado", falhou: "Falhou", divergente: "Divergente",
};

const ROTULO_DA_CONTAGEM: Array<[SecaoDaResposta, string]> = [
  ["feito", "Feito com prova"], ["em_revisao", "Em revisão"], ["em_andamento", "Em andamento"], ["bloqueado", "Bloqueado"], ["decisao", "Sua decisão"], ["concluido_sem_prova", "Concluído sem prova"],
];

/**
 * Os blocos visuais da resposta (registro compartilhado _shared/blocos-de-resposta.ts):
 * - do modelo, só fluxo (desenho dele, sempre "Proposta") e tabela (cada linha
 *   conferida pelo Jev contra as fontes que o bloco cita; linha que não bate sai);
 * - do código, o gráfico das contagens quando o Gestor marca panorama (números
 *   contados na ficha, nada do modelo).
 */
async function blocosDaResposta(red: Redacao, fontes: Fonte[], contagem: Record<string, number>, o: { agencia: string | null; userId: string; avisos: string[]; recusados?: string[] }): Promise<BlocoDeResposta[]> {
  const saida: BlocoDeResposta[] = [];
  if (red.bruto && Array.isArray(red.bruto.blocos) && red.bruto.blocos.length) {
    // Apelido com sujeira do modelo ("F21»,") vira o apelido limpo; o que não for apelido sai na validação.
    const limpos = (red.bruto.blocos as Array<Record<string, unknown>>).map((x) => (x && Array.isArray(x.fontes) ? { ...x, fontes: (x.fontes as unknown[]).map((f) => { const m = String(f).match(/[FLA]\d+/i); return m ? m[0].toUpperCase() : String(f); }) } : x));
    const { blocos, recusados } = validarBlocos({ blocos: limpos }, { fontesConhecidas: fontes.map((f) => f.apelido) });
    if (recusados.length) {
      o.avisos.push(`${recusados.length} ${recusados.length === 1 ? "quadro saiu" : "quadros saíram"} na conferência (sem fonte ou fora do formato).`);
      o.recusados?.push(...recusados.map((r) => r.motivo));
    }
    for (const b of blocos) {
      if (b.tipo === "fluxo") saida.push({ ...b, natureza: "proposta", passos: b.passos.map((p) => ({ ...p, estado: "planejado" as const })) });
      else if (b.tipo === "tabela") {
        const conferida = await tabelaConferida(b, fontes, o);
        if (conferida) saida.push(conferida);
      }
    }
  }
  if (red.origem === "motor") {
    const linhas = fontes.filter((f) => f.tipo !== "diario" && f.tipo !== "execucao").slice(0, 50).map((f) => [f.titulo.slice(0, 120), ROTULO_DO_ESTADO_CURTO[f.estado] || f.estado, f.cliente || "", f.quando ? f.quando.slice(0, 10) : null]);
    if (linhas.length > 3) saida.push({ tipo: "tabela", titulo: "O que está registrado no recorte", colunas: ["Item", "Situação", "Cliente", "Quando"], linhas, fontes: fontes.slice(0, 50).map((f) => f.apelido) });
  }
  if (red.bruto?.mostrar_numeros === true || red.origem === "motor") {
    const pontos = ROTULO_DA_CONTAGEM.map(([k, rotulo]) => ({ x: rotulo, y: Number(contagem[k] || 0) })).filter((p) => p.y > 0);
    if (pontos.length >= 2) saida.push({ tipo: "grafico", titulo: "Como está o recorte", tipo_grafico: "barras", series: [{ nome: "Registros", pontos }], unidade: "registros" });
  }
  return saida;
}

/** Cada linha da tabela vira uma afirmação conferida pelo Jev contra as fontes do bloco. */
async function tabelaConferida(b: BlocoTabela, fontes: Fonte[], o: { agencia: string | null; userId: string; avisos: string[] }): Promise<BlocoTabela | null> {
  const citadas = (b.fontes || []).map((x) => String(x).toUpperCase());
  const linhas = b.linhas.map((l) => ({ secao: "conversa" as SecaoDaResposta, texto: b.colunas.map((c, i) => `${c}: ${l[i] ?? "s/d"}`).join("; "), fontes: citadas }));
  try {
    const { state, questions } = perguntasDeConferencia(linhas, fontes);
    const r = await jevPerguntar({ state, questions }, { timeoutMs: 15_000 });
    if (o.agencia) void cobrarJev(r, { clientId: o.agencia, tarefa: "verificacao", criadoPor: o.userId });
    const c = aplicarConferencia(linhas, r.answers as Record<string, RespostaChoice>);
    const ficam = new Set(c.ficam.map((i) => i.texto));
    const novas = b.linhas.filter((_l, k) => ficam.has(linhas[k].texto));
    if (novas.length < b.linhas.length) o.avisos.push(`${b.linhas.length - novas.length} ${b.linhas.length - novas.length === 1 ? "linha da tabela saiu" : "linhas da tabela saíram"} na conferência com as fontes.`);
    return novas.length ? { ...b, linhas: novas } : null;
  } catch (e) {
    registrarFalha("gestor-aceleriq: jev da tabela fora (tabela não vai)", e);
    o.avisos.push("A tabela não foi conferida agora e ficou de fora.");
    return null;
  }
}

/** Onde decidir um pedido sensível (com o cliente na rota quando dá). */
export function linkDoLugar(onde: string, clientId: string | null): string | null {
  const c = clientId ? `client=${clientId}` : "";
  switch (onde) {
    case "mesa_ads": return `/mesa-ads${c ? `?${c}` : ""}`;
    case "calendario": return `/calendario${c ? `?${c}` : ""}`;
    case "kanban": return `/kanban${c ? `?${c}` : ""}`;
    case "execucao": return "/execucao?aba=decisoes";
    case "clientes": return clientId ? `/clientes?${c}` : "/clientes";
    case "contratos": return "/contratos";
    default: return null;
  }
}

type AlvosDoGestor = Awaited<ReturnType<typeof alvosDoGestor>>;

/** Apelido (F, t, p, a, o) → objeto real. Apelido desconhecido: null (nada abre). */
export function objetoDoApelido(apelido: string, fontes: Fonte[], alvos: Pick<AlvosDoGestor, "tarefas" | "projetos" | "aprovacoes" | "objetosDaConversa">): ObjetoDoGestor | null {
  const a = apelido.trim().toLowerCase();
  if (/^f\d+$/.test(a)) {
    const f = fontes.find((x) => x.apelido.toLowerCase() === a);
    return f ? objetoDaFonte(f) : null;
  }
  const t = alvos.tarefas.find((x) => x.ref.toLowerCase() === a);
  if (t) return { tipo: "tarefa", id: t.id, titulo: t.titulo };
  const p = alvos.projetos.find((x) => x.ref.toLowerCase() === a);
  if (p) return { tipo: "projeto", id: p.id, titulo: p.titulo };
  const ap = alvos.aprovacoes.find((x) => x.ref.toLowerCase() === a);
  if (ap) return { tipo: "aprovacao", id: ap.id, titulo: ap.titulo };
  const o = alvos.objetosDaConversa.find((x) => x.apelido.toLowerCase() === a);
  return o ? o.objeto : null;
}

/**
 * Alvos das ferramentas: cliente(s), projetos ativos do cliente, tarefas do
 * recorte, solicitações pendentes e agentes ativos. Os objetos da conversa
 * (tarefas e solicitações citadas antes) entram nas listas mesmo fora do
 * período, para "essa tarefa" e "pode aprovar" acharem o alvo certo.
 */
async function alvosDoGestor(cliente: ClienteBase | null, clientes: ClienteBase[], tarefas: TarefaBruta[], aprovacoes: AprovacaoBruta[], projetoDaConversa: string | null, referencias: ReferenciaDoGestor[]) {
  const s = servico();
  const principais = clientes.filter((c) => !c.projetoId);
  const listaClientes: AlvoDoGestor[] = cliente ? [{ id: cliente.id, titulo: principais.find((c) => c.id === cliente.id)?.nome || cliente.nome }] : principais.slice(0, 40).map((c) => ({ id: c.id, titulo: c.nome }));
  let projetos: AlvoDoGestor[] = [];
  if (cliente) {
    let q = s.from("projects").select("id, name, status").eq("client_id", cliente.id).order("updated_at", { ascending: false }).limit(25);
    if (cliente.projetoId) q = s.from("projects").select("id, name, status").eq("id", cliente.projetoId).limit(1);
    const { data } = await q;
    const linhas = ((data || []) as Array<{ id: string; name: string; status: string | null }>).filter((p) => !/arquiv|archiv|cancel/i.test(p.status || ""));
    linhas.sort((a, b) => Number(b.id === projetoDaConversa) - Number(a.id === projetoDaConversa));
    projetos = linhas.map((p) => ({ id: p.id, titulo: p.name, detalhe: [p.status, p.id === projetoDaConversa ? "projeto desta conversa" : ""].filter(Boolean).join(" · ") }));
  }

  // Tarefas: as da conversa primeiro (mesmo fora do período), depois as abertas do recorte.
  const idsDaConversa = referencias.filter((r) => r.tipo === "tarefa").map((r) => r.id).filter((id) => UUID.test(id));
  const faltam = idsDaConversa.filter((id) => !tarefas.some((t) => t.id === id));
  const extras: TarefaBruta[] = [];
  if (faltam.length) {
    const { data } = await s.from("tasks").select("id, title, status, updated_at, due_date, deleted_at, project:projects!tasks_project_id_fkey(client_id, client:profiles!projects_client_id_fkey(company_name, full_name))").in("id", faltam.slice(0, 20));
    for (const t of (data || []) as unknown as Array<{ id: string; title: string; status: string; updated_at: string; due_date: string | null; deleted_at: string | null; project: { client_id: string | null; client: { company_name: string | null; full_name: string | null } | null } | null }>) {
      if (t.deleted_at || (cliente && t.project?.client_id !== cliente.id)) continue;
      extras.push({ id: t.id, title: t.title, status: t.status, updated_at: t.updated_at, due_date: t.due_date, cliente: t.project?.client?.company_name || t.project?.client?.full_name || null });
    }
  }
  const ordemDaConversa = (id: string) => { const i = idsDaConversa.indexOf(id); return i < 0 ? 999 : i; };
  const todasTarefas = [...extras, ...tarefas].sort((a, b) => ordemDaConversa(a.id) - ordemDaConversa(b.id) || Number(a.status === "done") - Number(b.status === "done"));

  // Solicitações pendentes: as da conversa primeiro, depois as do recorte.
  const idsAprov = referencias.filter((r) => r.tipo === "aprovacao").map((r) => r.id).filter((id) => UUID.test(id));
  const aprovs: Array<{ id: string; o_que: string; status: string; cliente: string | null; valid_until?: string | null; payload_version?: number | null; client_id?: string | null }> = aprovacoes.map((a) => ({ id: a.id, o_que: a.o_que, status: a.status, cliente: a.cliente || null }));
  const faltamAprov = idsAprov.filter((id) => !aprovs.some((a) => a.id === id));
  const todosIdsAprov = [...new Set([...aprovs.map((a) => a.id), ...faltamAprov])].slice(0, 80);
  if (todosIdsAprov.length) {
    const { data } = await s.from("operator_approvals").select("id, o_que, status, valid_until, payload_version, client_id, client:profiles!operator_approvals_client_id_fkey(company_name, full_name)").in("id", todosIdsAprov);
    const porId = new Map(((data || []) as unknown as Array<{ id: string; o_que: string; status: string; valid_until: string | null; payload_version: number | null; client_id: string | null; client: { company_name: string | null; full_name: string | null } | null }>).map((a) => [a.id, a]));
    for (let i = aprovs.length - 1; i >= 0; i--) {
      const x = porId.get(aprovs[i].id);
      if (x) Object.assign(aprovs[i], { valid_until: x.valid_until, payload_version: x.payload_version, client_id: x.client_id, status: x.status });
    }
    for (const id of faltamAprov) {
      const x = porId.get(id);
      if (x && (!cliente || x.client_id === cliente.id)) aprovs.push({ id: x.id, o_que: x.o_que, status: x.status, cliente: x.client?.company_name || x.client?.full_name || null, valid_until: x.valid_until, payload_version: x.payload_version, client_id: x.client_id });
    }
  }
  const ordemAprov = (id: string) => { const i = idsAprov.indexOf(id); return i < 0 ? 999 : i; };
  aprovs.sort((a, b) => ordemAprov(a.id) - ordemAprov(b.id));
  const quando = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" }) : "");
  const alvosAprov: AlvoDoGestor[] = aprovs.map((a) => ({
    id: a.id, titulo: a.o_que,
    detalhe: [a.status, a.cliente, a.payload_version ? `versão ${a.payload_version}` : "", a.valid_until ? `vence ${quando(a.valid_until)}` : "", idsAprov.includes(a.id) ? "citada nesta conversa" : ""].filter(Boolean).join(" · "),
    dados: { status: a.status, valid_until: a.valid_until || null },
  }));

  const { data: ops } = await s.from("internal_operators").select("slug, display_name, status").eq("status", "active").limit(60);
  const tarefasComApelido = comApelido(todasTarefas.slice(0, 60).map((t) => alvoDaTarefa(t)), "t");
  const aprovComApelido = comApelido(alvosAprov, "a");

  // Objetos da conversa: tarefas e solicitações usam o apelido da lista (t/a); o resto ganha oN (só para abrir).
  const objetosDaConversa: Array<{ apelido: string; objeto: ObjetoDoGestor; origem: string; estado: string | null }> = [];
  let n = 0;
  for (const r of referencias.slice(0, 16)) {
    const daLista = r.tipo === "tarefa" ? tarefasComApelido.find((t) => t.id === r.id) : r.tipo === "aprovacao" ? aprovComApelido.find((a) => a.id === r.id) : null;
    if ((r.tipo === "tarefa" || r.tipo === "aprovacao") && !daLista) continue; // fora do cliente, apagada ou decidida e fora da lista
    const apelido = daLista ? daLista.ref : `o${++n}`;
    objetosDaConversa.push({ apelido, objeto: { tipo: r.tipo, id: r.id, titulo: r.titulo || null, client_id: r.client_id || null }, origem: r.origem, estado: r.estado || (daLista ? String(daLista.dados?.status || "") : null) });
  }
  return {
    clientes: comApelido(listaClientes, "c"),
    projetos: comApelido(projetos, "p"),
    tarefas: tarefasComApelido,
    aprovacoes: aprovComApelido,
    agentes: ((ops || []) as Array<{ slug: string; display_name: string }>).map((o) => ({ slug: o.slug, nome: o.display_name })),
    objetosDaConversa,
  };
}
