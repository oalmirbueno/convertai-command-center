/**
 * Núcleo do Gestor Aceleriq: lê o recorte, monta a ficha, redige e confere.
 *
 * Separado do index.ts (sessão, papel e conversa) para rodar igual fora da
 * borda: o teste de ponta contra o banco real usa o mesmo caminho. Quem chama
 * injeta o cliente do banco (chave de serviço) DEPOIS de conferir o papel.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { jevPerguntar } from "../../_shared/jev.ts";
import { chamarTexto, cobrarJev, IaMotorErro, modeloPadrao } from "../../_shared/ia-motor.ts";
import { registrarFalha } from "../../_shared/falha-registrada.ts";
import {
  type AprovacaoBruta,
  type ClienteBase,
  clienteDaPergunta,
  conferirContraAFicha,
  contagemDoRecorte,
  conversaDoRecorte,
  type DiarioBruto,
  type EntregaBruta,
  type Fonte,
  type ItemDaResposta,
  montarFicha,
  ORDEM_DAS_SECOES,
  type Periodo,
  periodoDaPergunta,
  type PublicacaoBruta,
  respostaDoMotor,
  respostaEmTexto,
  type RunBruto,
  type SecaoDaResposta,
  type TarefaBruta,
  type VinculoBruto,
} from "./ficha.ts";
import { aplicarConferencia, perguntasDeConferencia, type RespostaChoice } from "./conferencia.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TOKENS_SAIDA = 1400;

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

async function clientePorJev(pergunta: string, clientes: ClienteBase[], agencia: string | null, userId: string): Promise<ClienteBase | null> {
  const principais = clientes.filter((c) => !c.projetoId);
  if (!principais.length || principais.length > 40) return null;
  const criteria: Record<string, string> = { geral: "a pergunta não cita um cliente específico desta lista (fala da agência, de todos, de um agente ou de outro assunto)" };
  principais.forEach((c, i) => { criteria[`c${i}`] = `a pergunta é sobre o cliente "${c.nome}" (mesmo escrito com erro, abreviado ou sem acento)`; });
  try {
    const r = await jevPerguntar({
      state: { pergunta: pergunta.slice(0, 600) },
      questions: { cliente: { type: "choice", instructions: "Qual cliente da agência a `pergunta` cita?", criteria } },
    }, { timeoutMs: 6_000 });
    if (agencia) void cobrarJev(r, { clientId: agencia, tarefa: "conversa", criadoPor: userId });
    const a = r.answers.cliente as RespostaChoice | undefined;
    const p = a?.choice ? Number(a.probabilities?.[a.choice] ?? a.confidence ?? 0) : 0;
    if (!a?.choice || a.choice === "geral" || p < 0.85) return null;
    return principais[Number(a.choice.slice(1))] || null;
  } catch (e) {
    registrarFalha("gestor-aceleriq: jev do cliente fora (segue sem cliente)", e);
    return null;
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

// ------------------------------------------------------------------ redação (IA) com as duas barreiras

const SISTEMA = `Você é o Gestor Aceleriq: responde ao dono da agência (o Almir) sobre a operação real, em português do Brasil, direto.
Regras duras:
- Você só pode afirmar o que está nas FONTES. Cada item cita os apelidos das fontes (F1, F2...) que o sustentam. Item sem fonte é descartado.
- O ESTADO de cada fonte já foi decidido pelo sistema. Respeite: "em_revisao" e "execucao_feita_entrega_em_revisao" NÃO são concluídos; "agendado" NÃO é publicado; "concluido_sem_prova" NÃO é "feito com prova"; "divergente" quer dizer que a execução do agente e o card da tarefa estão em estados diferentes, diga isso.
- Seções: feito (só fontes feito_com_prova), concluido_sem_prova, em_revisao, em_andamento, bloqueado (bloqueado, falhou, aguardando insumo, divergente), decisao (decisao_pendente), lacuna (o que falta ou não tem prova), proximo (próximas ações a partir de "Próximo passo" ou do que está pendente).
- Se uma fonte diz que algo NÃO aconteceu (ex.: vídeo ainda em edição, sem publicação), diga isso como lacuna; nunca transforme em feito.
- Escreva como uma pessoa conversando no chat com o dono, não como relatório. Cada item vira UMA mensagem curta na tela: 1 ou 2 frases, no máximo 220 caracteres, linguagem simples e direta ("Vi que...", "Ainda falta...", "O Atlas fechou...").
- Comece pelo que mais importa para a pergunta. Junte fontes parecidas numa mensagem só. No máximo 8 itens; o resto fica nas contagens da tela.
- Sem markdown, sem listas, sem travessão, sem repetir o apelido no texto, sem saudação nem despedida (a abertura e o fechamento são do sistema).`;

const ESQUEMA = {
  nome: "resposta_do_gestor",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["itens"],
    properties: {
      itens: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["secao", "texto", "fontes"],
          properties: {
            secao: { type: "string", enum: ORDEM_DAS_SECOES },
            texto: { type: "string" },
            fontes: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  },
};

type Redacao = { itens: ItemDaResposta[]; origem: "ia_conferida" | "motor"; avisos: string[]; custo: number; usoId: string | null; modelo: string | null; recusados: number; contestados: number };

async function redigir(pergunta: string, cabecalho: string, fontes: Fonte[], o: { agencia: string | null; userId: string; semIa: boolean; historico: string }): Promise<Redacao> {
  const motor = (aviso?: string): Redacao => ({ itens: respostaDoMotor(fontes), origem: "motor", avisos: aviso ? [aviso] : [], custo: 0, usoId: null, modelo: null, recusados: 0, contestados: 0 });
  if (!fontes.length) return motor();
  if (o.semIa) return motor();
  if (!o.agencia) return motor("Sem carteira de IA da agência: respondi só com os fatos registrados.");
  const modelo = (await modeloPadrao("estrategista"))?.id || null;
  if (!modelo) return motor("Nenhum modelo de texto ligado: respondi só com os fatos registrados.");

  let saida;
  try {
    saida = await chamarTexto({
      clientId: o.agencia,
      tarefa: "conversa",
      agente: "estrategista",
      modeloId: modelo,
      sistema: SISTEMA,
      mensagens: [{
        papel: "usuario",
        conteudo: [
          o.historico ? `CONVERSA ATÉ AQUI (só contexto, não é fonte):\n${o.historico}` : "",
          `PERGUNTA DO DONO: ${pergunta}`,
          `RECORTE: ${cabecalho}`,
          `FONTES (JSON; só isto pode ser afirmado):\n${JSON.stringify(fontes.map((f) => ({ apelido: f.apelido, tipo: f.tipo, estado: f.estado, titulo: f.titulo, quando: f.quando, cliente: f.cliente, agente: f.agente, texto: f.texto })))}`,
        ].filter(Boolean).join("\n\n"),
      }],
      esquemaJson: ESQUEMA,
      maxTokensSaida: MAX_TOKENS_SAIDA,
      timeoutMs: 90_000,
      criadoPor: o.userId,
    });
  } catch (e) {
    registrarFalha("gestor-aceleriq: IA indisponível (valeu a ficha)", e);
    return motor(e instanceof IaMotorErro ? `IA indisponível (${e.codigo}): respondi só com os fatos registrados.` : "IA indisponível: respondi só com os fatos registrados.");
  }

  const brutos = Array.isArray((saida.json as { itens?: unknown } | undefined)?.itens) ? (saida.json as { itens: unknown[] }).itens : [];
  const itens: ItemDaResposta[] = brutos.map((x) => {
    const i = x as { secao?: string; texto?: string; fontes?: unknown };
    return { secao: String(i.secao || "") as SecaoDaResposta, texto: String(i.texto || "").replace(/—|–/g, ",").trim().slice(0, 600), fontes: Array.isArray(i.fontes) ? i.fontes.map(String) : [] };
  }).filter((i) => i.texto);

  // Barreira 1 (código): fonte existe e o estado cabe na seção.
  const { aceitos, recusados } = conferirContraAFicha(itens, fontes);
  const avisos: string[] = [];
  if (recusados.length) avisos.push(`${recusados.length} ${recusados.length === 1 ? "frase da IA saiu" : "frases da IA saíram"} por não ter fonte ou por chamar de feito o que não está feito.`);

  // Barreira 2 (Jev): a afirmação bate com a fonte citada?
  let finais = aceitos;
  let contestados = 0;
  if (aceitos.length) {
    try {
      const { state, questions } = perguntasDeConferencia(aceitos, fontes);
      const r = await jevPerguntar({ state, questions }, { timeoutMs: 15_000 });
      void cobrarJev(r, { clientId: o.agencia, tarefa: "verificacao", criadoPor: o.userId });
      const c = aplicarConferencia(aceitos, r.answers as Record<string, RespostaChoice>);
      finais = c.ficam;
      contestados = c.sairam.length;
      if (c.sairam.length) avisos.push(`${c.sairam.length} ${c.sairam.length === 1 ? "frase saiu" : "frases saíram"} na conferência com as fontes.`);
      if (c.fracos) avisos.push(`${c.fracos} ${c.fracos === 1 ? "frase ficou" : "frases ficaram"} com conferência fraca: abra a fonte.`);
    } catch (e) {
      registrarFalha("gestor-aceleriq: jev da conferência fora", e);
      avisos.push("A conferência semântica (Jev) não rodou agora: os itens passaram só pela conferência de fontes.");
    }
  }

  if (!finais.length) {
    return { ...motor("A redação da IA não passou na conferência: respondi só com os fatos registrados."), custo: saida.custoUsd, usoId: saida.usoId, modelo: saida.modeloId, recusados: recusados.length, contestados };
  }
  return { itens: finais, origem: "ia_conferida", avisos, custo: saida.custoUsd, usoId: saida.usoId, modelo: saida.modeloId, recusados: recusados.length, contestados };
}

// ------------------------------------------------------------------ a resposta inteira

export type EntradaDoResponder = { pergunta: string; clienteId?: string | null; periodo?: string | null; userId: string; semIa: boolean; historico: string; tetoAtingido?: boolean; tetoPorDia?: number };

export type Respondido =
  | { tipo: "esclarecer"; texto: string; opcoes: Array<{ id: string; nome: string }> }
  | { tipo: "resposta"; texto: string; clienteId: string | null; custo: number; usoId: string | null; dados: Record<string, unknown> };

export async function responder(e: EntradaDoResponder): Promise<Respondido> {
  const periodo = periodoDaPergunta(e.pergunta, new Date(), e.periodo || null);
  const [clientes, agencia] = await Promise.all([lerClientes(), carteiraDaAgencia()]);

  // Cliente: o escolhido na tela vale; senão o nome na pergunta; senão o Jev na lista real.
  let cliente: ClienteBase | null = null;
  const escolhido = e.clienteId && UUID.test(e.clienteId) ? clientes.find((c) => c.id === e.clienteId && !c.projetoId) : null;
  if (e.clienteId && !escolhido) throw new ErroHttp(400, "cliente_invalido", "Esse cliente não existe no cadastro.");
  if (escolhido) cliente = escolhido;
  else {
    const achado = clienteDaPergunta(e.pergunta, clientes);
    if (achado.tipo === "ambiguo") {
      return { tipo: "esclarecer", texto: `Achei mais de um cliente com esse nome: ${achado.opcoes.map((c) => c.nome).join(", ")}. Qual deles?`, opcoes: achado.opcoes.map((c) => ({ id: c.id, nome: c.nome })) };
    }
    cliente = achado.tipo === "um" ? achado.cliente : await clientePorJev(e.pergunta, clientes, agencia, e.userId);
  }

  const nomes = new Map(clientes.filter((c) => !c.projetoId).map((c) => [c.id, c.nome]));
  const fatos = await lerFatos({ cliente, periodo, nomes });
  const ficha = montarFicha({ periodo, ...fatos, nomeDoAgente: (id) => (id ? fatos.nomeAgente.get(id) || null : null) });
  const contagem = contagemDoRecorte(ficha.fontes);
  const nomeRecorte = cliente ? (cliente.marca ? `${cliente.marca} (marca de ${nomes.get(cliente.id) || "cliente"})` : cliente.nome) : "Todos os clientes";
  const cabecalho = `${nomeRecorte} · ${periodo.rotulo}`;

  const red = await redigir(e.pergunta, cabecalho, ficha.fontes, { agencia, userId: e.userId, semIa: e.semIa || !!e.tetoAtingido, historico: e.historico });
  const avisos = [...fatos.avisos, ...red.avisos];
  if (e.tetoAtingido && !e.semIa) avisos.push(`Teto de ${e.tetoPorDia ?? 60} respostas com IA por dia atingido: respondi só com os fatos registrados.`);
  if (ficha.cortadas) avisos.push(`${ficha.cortadas} fatos a mais no período ficaram fora desta resposta: refine por cliente ou período.`);
  if (!ficha.fontes.length) avisos.push("Nada registrado no OS para este recorte. Isso não prova que nada aconteceu fora do painel.");

  // Só as fontes citadas vão para a tela e para a conversa (o resto fica no total).
  const citadas = new Set(red.itens.flatMap((i) => i.fontes));
  const fontesUsadas = ficha.fontes.filter((f) => citadas.has(f.apelido));
  const conversa = conversaDoRecorte({ nome: nomeRecorte, periodo: periodo.rotulo, contagem, totalDeFontes: ficha.fontes.length, temCliente: !!cliente });
  const dados = {
    tipo: "resposta", origem: red.origem, cabecalho, periodo, abertura: conversa.abertura, fechamento: conversa.fechamento, sugestoes: conversa.sugestoes, cliente: cliente ? { id: cliente.id, nome: nomeRecorte, projeto_id: cliente.projetoId || null } : null,
    itens: red.itens, fontes: fontesUsadas, contagem, total_de_fontes: ficha.fontes.length, avisos, modelo: red.modelo, recusados: red.recusados, contestados: red.contestados,
  };
  return { tipo: "resposta", texto: respostaEmTexto(cabecalho, red.itens), clienteId: cliente?.id || null, custo: red.custo, usoId: red.usoId, dados };
}
