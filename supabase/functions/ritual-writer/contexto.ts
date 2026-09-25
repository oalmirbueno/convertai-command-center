/**
 * Leitura do contexto de continuidade do ritual, NO SERVIDOR.
 *
 * Antes, tudo o que o escritor sabia vinha montado pelo navegador (fatos do
 * painel + a última mensagem). Faltava memória de verdade: as últimas
 * semanas de rituais, o que foi prometido, o que mudou desde então, as
 * pendências de hoje, o cérebro do cliente e a fase do método Acelera.
 *
 * Tudo aqui é lido com o cliente do Supabase de QUEM PEDIU (JWT da equipe),
 * então a RLS decide o que ele pode ver. Uma fonte que falha vira aviso e
 * não derruba as outras: ritual com quatro fontes é melhor que nenhum.
 *
 * O banco chega por parâmetro (tipo estrutural): o Vitest cobre a montagem
 * com um banco de mentira, sem Deno e sem rede.
 */

import { lerCerebro, resumoParaPrompt } from "../_shared/cerebro-do-cliente.ts";
import { blocoDoMetodoParaPrompt, faseDoCliente, type FaseAcelera } from "../_shared/metodo-acelera.ts";
import {
  extrairMemoriaDoRitual,
  type MemoriaDoRitual,
  montarContextoDeContinuidade,
  type MovimentoResumido,
  type PendenciasAbertas,
  type RitualAnterior,
} from "./memoria.ts";

// deno-lint-ignore no-explicit-any
export type BancoDoRitual = { from: (tabela: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any };

type Linha = Record<string, unknown>;
type Resposta = { data: unknown; error: { message?: string; code?: string } | null };

const DIA = 86_400_000;
const RITUAIS_DA_CENTRAL = new Set(["rota_semana", "meio_semana", "prova_movimento", "radar_aceleriq", "marco_90"]);
const STATUS_FECHADO = /^(done|closed|resolved|cancel|conclu|resolvid|cancelad|finaliz|atendid)/i;

export interface ContextoDoRitual {
  texto: string;
  anteriores: RitualAnterior[];
  fase: FaseAcelera;
  motivoDaFase: string;
  desde: string | null;
  contagem: { rituais: number; movimentos: number; aprovacoes: number; tarefasAtrasadas: number; pedidos: number; agenda: number; cerebro: number };
  avisos: string[];
}

export interface OpcoesDoContexto {
  ritual: string;
  agora?: Date;
  /** Quantas semanas de rituais anteriores (padrão 5: pelo menos as 4 últimas). */
  semanas?: number;
  /** Relatório sendo aprimorado: não entra como "anterior" dele mesmo. */
  excluirReportId?: string | null;
  limite?: number;
}

const linhas = (r: Resposta | null | undefined): Linha[] => (r && Array.isArray(r.data) ? (r.data as Linha[]) : []);
const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const diasDesde = (iso: unknown, agora: Date): number | null => {
  const t = new Date(txt(iso)).getTime();
  return Number.isFinite(t) ? Math.max(0, Math.floor((agora.getTime() - t) / DIA)) : null;
};

function memoriaGravada(meta: unknown): MemoriaDoRitual | null {
  const m = meta && typeof meta === "object" ? (meta as Linha).ritual_memoria : null;
  if (!m || typeof m !== "object") return null;
  const r = m as Linha;
  const lista = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : []);
  return { abertura: txt(r.abertura), estrutura: lista(r.estrutura), assuntos: lista(r.assuntos), promessas: lista(r.promessas) };
}

/**
 * Rituais anteriores: os relatórios da Central (enviados e rascunhos) e o
 * que entrou no diário como ritual por outro caminho (Hermes, Ciclo). Sem
 * duplicar: o diário que aponta para um relatório já lido fica de fora.
 */
export function juntarRituais(reports: Linha[], diario: Linha[], excluirReportId?: string | null): RitualAnterior[] {
  const saida: RitualAnterior[] = [];
  const idsLidos = new Set<string>();
  // Rascunho só vale se for mais novo que o último enviado do mesmo tipo:
  // rascunho antigo, que nunca saiu, não é "o que foi dito".
  const ultimoEnvioPorTipo = new Map<string, string>();
  for (const r of reports) {
    const tipo = txt((r.metrics as Linha | null)?.ritual_type);
    if (r.status === "published" && tipo) {
      const quando = txt((r.metrics as Linha | null)?.sent_at) || txt(r.created_at);
      if (quando > (ultimoEnvioPorTipo.get(tipo) ?? "")) ultimoEnvioPorTipo.set(tipo, quando);
    }
  }
  const rascunhoPorTipo = new Set<string>();
  for (const r of reports) {
    const metrics = (r.metrics as Linha | null) ?? {};
    const tipo = txt(metrics.ritual_type);
    if (!RITUAIS_DA_CENTRAL.has(tipo)) continue;
    const id = txt(r.id);
    if (excluirReportId && id === excluirReportId) continue;
    const texto = txt(r.summary).trim();
    if (texto.length < 40) continue;
    const enviado = r.status === "published";
    const quando = enviado ? (txt(metrics.sent_at) || txt(r.created_at)) : txt(r.created_at);
    if (!enviado) {
      if (rascunhoPorTipo.has(tipo)) continue;
      if (quando <= (ultimoEnvioPorTipo.get(tipo) ?? "")) continue;
      rascunhoPorTipo.add(tipo);
    }
    idsLidos.add(id);
    saida.push({
      quando, tipo, titulo: txt(r.title) || null, texto, proximo_passo: txt(r.next_steps) || null,
      situacao: enviado ? "enviado" : "rascunho", memoria: memoriaGravada(metrics),
    });
  }
  for (const d of diario) {
    const meta = (d.metadata as Linha | null) ?? {};
    const reportId = txt(meta.report_id);
    if (reportId && (idsLidos.has(reportId) || reportId === excluirReportId)) continue;
    const texto = txt(d.content).trim();
    // "Marcado no Ciclo." e "Gerado na Central." são marcas, não mensagem.
    if (texto.length < 80) continue;
    saida.push({
      quando: txt(d.created_at), tipo: txt(meta.ritual_type) || null, titulo: txt(d.title) || null, texto,
      proximo_passo: null, situacao: "enviado", memoria: memoriaGravada(meta),
    });
  }
  return saida.sort((a, b) => b.quando.localeCompare(a.quando));
}

/** Semanas seguidas (da passada para trás) com ao menos um ritual marcado no Ciclo. */
export function semanasSeguidasComRitual(semanas: string[], agora: Date): number {
  const marcadas = new Set(semanas);
  const segunda = new Date(agora);
  segunda.setUTCHours(12, 0, 0, 0);
  segunda.setUTCDate(segunda.getUTCDate() - ((segunda.getUTCDay() + 6) % 7));
  let n = 0;
  for (let i = 1; i <= 12; i += 1) {
    const k = new Date(segunda.getTime() - i * 7 * DIA).toISOString().slice(0, 10);
    if (!marcadas.has(k)) break;
    n += 1;
  }
  return n;
}

function numerosCompactos(ig: Linha[], ads: Linha[], vendas: Linha[], agora: Date): string {
  const partes: string[] = [];
  // Conta principal = a de mais seguidores (mesma regra do painel).
  const porConta = new Map<string, Linha[]>();
  for (const m of ig) porConta.set(txt(m.external_account_id) || "conta", [...(porConta.get(txt(m.external_account_id) || "conta") ?? []), m]);
  let principal: Linha[] = [];
  for (const lista of porConta.values()) {
    if (!principal.length || Number(lista[0]?.followers ?? 0) > Number(principal[0]?.followers ?? 0)) principal = lista;
  }
  if (principal.length) {
    const [a, b] = principal;
    const delta = (campo: string) => {
      const x = Number(a?.[campo]); const y = Number(b?.[campo]);
      if (!Number.isFinite(x)) return "";
      if (!b || !Number.isFinite(y) || y === 0) return `${x}`;
      const pct = Math.round(((x - y) / y) * 100);
      return `${x} (${pct >= 0 ? "+" : ""}${pct}% contra a semana anterior)`;
    };
    partes.push(`Instagram, semana de ${txt(a.week_start)}: seguidores ${delta("followers")}; pessoas alcançadas ${delta("reach")}; interações ${delta("total_interactions")}.`);
  }
  const corte = agora.getTime() - 7 * DIA;
  let gastoAgora = 0; let gastoAntes = 0; let leadsAgora = 0; let leadsAntes = 0;
  for (const d of ads) {
    const t = new Date(`${txt(d.day)}T12:00:00Z`).getTime();
    const leads = Array.isArray(d.actions)
      ? (d.actions as Linha[]).reduce((s, x) => {
        const tipo = txt(x.action_type).toLowerCase();
        return s + (tipo.includes("lead") || tipo.includes("messaging_conversation_started") ? Number(x.value) || 0 : 0);
      }, 0)
      : 0;
    if (t >= corte) { gastoAgora += Number(d.spend) || 0; leadsAgora += leads; } else { gastoAntes += Number(d.spend) || 0; leadsAntes += leads; }
  }
  if (gastoAgora > 0 || gastoAntes > 0) {
    partes.push(`Anúncios: R$ ${gastoAgora.toFixed(0)} e ${leadsAgora} contatos nos últimos 7 dias, contra R$ ${gastoAntes.toFixed(0)} e ${leadsAntes} nos 7 anteriores.`);
  }
  const vendas7 = vendas.filter((v) => new Date(`${txt(v.sold_at).slice(0, 10)}T12:00:00Z`).getTime() >= corte);
  if (vendas7.length) {
    const qtd = vendas7.reduce((s, v) => s + Math.max(1, Number(v.quantity) || 1), 0);
    const valor = vendas7.reduce((s, v) => s + (Number(v.value) || 0), 0);
    partes.push(`Vendas registradas nos últimos 7 dias: ${qtd}${valor > 0 ? ` (R$ ${valor.toFixed(0)})` : ""}.`);
  }
  return partes.length ? `NÚMEROS DESDE O ÚLTIMO RITUAL (compare com o que o ritual anterior disse; número novo vale mais que o repetido):\n${partes.map((p) => `- ${p}`).join("\n")}` : "";
}

/** Lê tudo e devolve o bloco pronto, as contagens e os rituais anteriores (para a conferência). */
export async function lerContextoDoRitual(db: BancoDoRitual, clientId: string, opcoes: OpcoesDoContexto): Promise<ContextoDoRitual> {
  const agora = opcoes.agora ?? new Date();
  const semanas = Math.max(4, Math.min(8, opcoes.semanas ?? 5));
  const desdeRituais = new Date(agora.getTime() - semanas * 7 * DIA).toISOString();
  const avisos: string[] = [];
  const seguro = async (nome: string, consulta: () => PromiseLike<unknown>): Promise<Linha[]> => {
    try {
      const r = (await consulta()) as Resposta;
      if (r?.error) { avisos.push(`${nome}: ${r.error.message ?? "erro"}`); return []; }
      return linhas(r);
    } catch (e) {
      avisos.push(`${nome}: ${e instanceof Error ? e.message : "falha"}`);
      return [];
    }
  };

  const hoje = agora.toISOString().slice(0, 10);
  const desde14 = new Date(agora.getTime() - 14 * DIA).toISOString().slice(0, 10);
  const desde28 = new Date(agora.getTime() - 28 * DIA).toISOString().slice(0, 10);
  const em7 = new Date(agora.getTime() + 7 * DIA).toISOString();

  const [perfil, reports, diario, projetos, aprovacoes, pedidos, agenda, cicloRituais, ig, ads, vendas] = await Promise.all([
    seguro("perfil", () => db.from("profiles").select("id, created_at, onboarding_done, services_config").eq("id", clientId).maybeSingle()
      .then((r: Resposta) => ({ data: r.data ? [r.data] : [], error: r.error }))),
    seguro("rituais", () => db.from("reports").select("id, title, summary, next_steps, status, created_at, metrics")
      .eq("client_id", clientId).gte("created_at", desdeRituais).order("created_at", { ascending: false }).limit(30)),
    seguro("diario", () => db.from("project_memory").select("id, title, content, created_at, metadata")
      .eq("client_id", clientId).eq("kind", "ritual").gte("created_at", desdeRituais).order("created_at", { ascending: false }).limit(20)),
    seguro("projetos", () => db.from("projects").select("id").eq("client_id", clientId).is("deleted_at", null)),
    seguro("aprovacoes", () => db.from("files").select("id, file_name, created_at").eq("client_id", clientId)
      .eq("visibility", "approval").eq("requires_approval", true).eq("approval_status", "pending").eq("status", "ready")
      .is("archived_at", null).is("parent_file_id", null).order("created_at", { ascending: true }).limit(10)),
    seguro("pedidos", () => db.from("client_requests").select("id, title, status, created_at").eq("client_id", clientId)
      .order("created_at", { ascending: false }).limit(20)),
    seguro("agenda", () => db.from("editorial_publications").select("id, caption, scheduled_at, status, editorial_posts(title)")
      .eq("client_id", clientId).eq("status", "scheduled").gte("scheduled_at", agora.toISOString()).lte("scheduled_at", em7)
      .order("scheduled_at", { ascending: true }).limit(8)),
    seguro("ciclo", () => db.from("cycle_rituals").select("week_start").eq("client_id", clientId).gte("week_start", new Date(agora.getTime() - 13 * 7 * DIA).toISOString().slice(0, 10))),
    seguro("instagram", () => db.from("social_metrics_weekly").select("external_account_id, week_start, followers, reach, total_interactions")
      .eq("client_id", clientId).gte("week_start", desde28).order("week_start", { ascending: false })),
    seguro("anuncios", () => db.from("ads_campaign_daily").select("day, spend, actions").eq("client_id", clientId).gte("day", desde14)),
    seguro("vendas", () => db.from("ads_sales").select("sold_at, quantity, value").eq("client_id", clientId).gte("sold_at", desde14)),
  ]);

  const anteriores = juntarRituais(reports, diario, opcoes.excluirReportId);
  const ultimoEnviado = anteriores.find((r) => r.situacao === "enviado");
  // Janela do "o que mudou": desde o último ritual enviado, entre 3 e 21 dias.
  const limiteMin = agora.getTime() - 21 * DIA;
  const limiteMax = agora.getTime() - 3 * DIA;
  const tUltimo = ultimoEnviado ? new Date(ultimoEnviado.quando).getTime() : NaN;
  const desdeMs = Number.isFinite(tUltimo) ? Math.min(Math.max(tUltimo, limiteMin), limiteMax) : agora.getTime() - 7 * DIA;
  const desde = new Date(desdeMs).toISOString();

  const movimentosBrutos = await seguro("movimentos", () => db.rpc("movimentos_do_cliente", {
    _client_id: clientId, _desde: desde, _ate: agora.toISOString(), _somente_visiveis: false,
  }));
  const movimentos: MovimentoResumido[] = movimentosBrutos
    .map((m) => ({ quando: txt(m.quando), titulo: txt(m.titulo), detalhe: txt(m.detalhe) || null, visivel_ao_cliente: m.visivel_ao_cliente !== false }))
    .filter((m) => m.quando && m.titulo)
    .sort((a, b) => b.quando.localeCompare(a.quando));

  const idsProjetos = projetos.map((p) => txt(p.id)).filter(Boolean);
  const tarefas = idsProjetos.length
    ? await seguro("tarefas", () => db.from("tasks").select("title, due_date, status").in("project_id", idsProjetos)
      .is("deleted_at", null).neq("status", "done").lt("due_date", hoje).order("due_date", { ascending: true }).limit(8))
    : [];

  const pendencias: PendenciasAbertas = {
    aprovacoes: aprovacoes.map((f) => ({ nome: txt(f.file_name), dias: diasDesde(f.created_at, agora) })),
    tarefasAtrasadas: tarefas.map((t) => ({ titulo: txt(t.title), prazo: txt(t.due_date) || null })),
    pedidosAbertos: pedidos.filter((r) => !STATUS_FECHADO.test(txt(r.status))).map((r) => ({ titulo: txt(r.title), dias: diasDesde(r.created_at, agora) })),
    agendaProxima: agenda.map((p) => {
      const post = p.editorial_posts as Linha | Linha[] | null;
      const titulo = (Array.isArray(post) ? txt(post[0]?.title) : txt(post?.title)) || txt(p.caption).slice(0, 80) || "publicação";
      return { titulo, quando: txt(p.scheduled_at) };
    }),
  };

  // Cérebro: tudo o que o cliente já ensinou (todas as áreas), compacto.
  let cerebroTexto = "";
  let cerebroUsados = 0;
  try {
    const leitura = await lerCerebro(db, clientId, { agora });
    const r = resumoParaPrompt(leitura.fatos, {
      limite: 1600,
      titulo: "CÉREBRO DO CLIENTE (o que ele já ensinou: preferências, o que evitar, o que performou; respeite na mensagem e nas tarefas)",
    });
    cerebroTexto = r.texto;
    cerebroUsados = r.usados;
    avisos.push(...leitura.avisos);
  } catch (e) {
    avisos.push(`cérebro: ${e instanceof Error ? e.message : "falha"}`);
  }

  const p = perfil[0] ?? {};
  const semanasCiclo = semanasSeguidasComRitual(cicloRituais.map((c) => txt(c.week_start)), agora);
  const { fase, motivo } = faseDoCliente({
    onboardingDone: p.onboarding_done === false ? false : true,
    daysAsClient: diasDesde(p.created_at, agora) ?? 0,
    closedStreak: semanasCiclo,
  });

  const texto = montarContextoDeContinuidade({
    agora,
    ritualPedido: opcoes.ritual,
    rituais: anteriores,
    movimentos,
    desde: ultimoEnviado ? desde : null,
    pendencias,
    numeros: numerosCompactos(ig, ads, vendas, agora),
    cerebro: cerebroTexto,
    metodo: blocoDoMetodoParaPrompt(fase, opcoes.ritual, motivo),
    limite: opcoes.limite,
  });

  return {
    texto,
    anteriores,
    fase,
    motivoDaFase: motivo,
    desde: ultimoEnviado ? desde : null,
    contagem: {
      rituais: anteriores.length,
      movimentos: movimentos.length,
      aprovacoes: pendencias.aprovacoes.length,
      tarefasAtrasadas: pendencias.tarefasAtrasadas.length,
      pedidos: pendencias.pedidosAbertos.length,
      agenda: pendencias.agendaProxima.length,
      cerebro: cerebroUsados,
    },
    avisos: avisos.slice(0, 12),
  };
}

export { extrairMemoriaDoRitual };
