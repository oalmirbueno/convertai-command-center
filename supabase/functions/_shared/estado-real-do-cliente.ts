/**
 * O estado REAL de um cliente, lido de uma vez no servidor (frente CE, 28/09).
 *
 * Por que existe: a Central montava os fatos no navegador e mandava tudo num
 * texto só, com o dossiê inteiro na frente. Os dossiês têm de 15 mil a 73 mil
 * caracteres e o escritor cortava em 12 mil: em 62 dos rituais gravados com
 * procedência (média de 36 a 51 mil caracteres na origem) o modelo leu o
 * dossiê e quase nada do que aconteceu na semana. Resultado: toda semana a
 * mesma mensagem, e campanha de conteúdo da Mesa contada como anúncio.
 *
 * Aqui cada frente vem separada e com período exato:
 * - CONTEÚDO ORGÂNICO: seguidores, alcance e interações da conta principal
 *   (semana a semana, com as datas), posts publicados e agendados com nome,
 *   pautas em produção;
 * - CAMPANHAS DA MESA (mesa_campanhas): tema ou oferta de comunicação, que
 *   NÃO é anúncio a menos que o julgamento diga que é paga;
 * - ANÚNCIOS PAGOS: campanhas no ar, gasto, contatos, custo por contato e
 *   vendas na semana, na anterior, no mês e no mês anterior; o que o agente de
 *   tráfego fez (ads_rotina_acoes) e a última análise da conta;
 * - OPERAÇÃO: tarefas concluídas (com dia), atrasadas, da semana, marcos;
 * - METAS DE SEGUIDORES (social_metas_seguidores) e a leitura "como está
 *   indo", com a régua do dono (semana melhor que a anterior) e a previsão.
 *
 * Lido com o cliente do Supabase de QUEM PEDIU (JWT da equipe): a RLS decide.
 * Fonte que falha vira aviso e não derruba as outras. Paginado até acabar
 * (páginas de 1.000, que é o teto do servidor), sem teto que corte: a janela
 * de tempo é o que mantém a leitura pequena.
 *
 * Puro no formato (estadoRealComoTexto) e com o banco por parâmetro: o Vitest
 * cobre com um banco de mentira.
 */

import { type MetaDeSeguidores, metasComoTexto, type PontoDeSeguidores, situacaoDasMetas, type SituacaoDasMetas } from "./metas-de-seguidores.ts";

// deno-lint-ignore no-explicit-any
export type BancoDoEstado = { from: (tabela: string) => any; rpc?: (fn: string, args: Record<string, unknown>) => any };

type Linha = Record<string, unknown>;
type Resposta = { data: unknown; error: { message?: string; code?: string } | null };

const DIA = 86_400_000;
const PAGINA = 1000;
/** Guarda contra laço: 50 páginas (50 mil linhas) numa janela de 60 dias é defeito, não cliente. */
const PAGINAS_NO_MAXIMO = 50;

export interface Periodo {
  de: string;
  ate: string;
}

export interface Somas {
  gasto: number;
  contatos: number;
  vendas: number;
  receita: number;
}

export interface EstadoReal {
  lidoEm: string;
  cliente: { nome: string; criadoEm: string | null; servicos: { social: boolean; trafego: boolean }; outros: string[] };
  periodos: { semana: Periodo; semanaAnterior: Periodo; mes: Periodo; mesAnterior: Periodo; desde: string | null };
  organico: {
    conta: string | null;
    semanas: Array<{ de: string; ate: string; seguidores: number | null; alcance: number | null; interacoes: number | null }>;
    publicados: Array<{ titulo: string; quando: string; plataforma: string }>;
    publicadosNaSemana: number;
    publicadosNaSemanaAnterior: number;
    publicadosNoMes: number;
    publicadosNoMesAnterior: number;
    agendados: Array<{ titulo: string; quando: string }>;
    emProducao: Array<{ titulo: string; estado: string }>;
    /** Posts lidos do próprio Instagram (inclui o que o cliente postou sozinho). */
    instagram: {
      naSemana: number;
      naSemanaAnterior: number;
      melhores: Array<{ legenda: string; tipo: string; quando: string; alcance: number; salvos: number; compartilhamentos: number }>;
    };
  };
  campanhasDaMesa: Array<{ id: string; nome: string; status: string; de: string | null; ate: string | null; objetivo: string; pedido: string; briefing: unknown }>;
  pago: {
    campanhasNoAr: Array<{ nome: string; objetivo: string; orcamentoDia: number | null }>;
    campanhasCadastradas: number;
    semana: Somas;
    semanaAnterior: Somas;
    mes: Somas;
    mesAnterior: Somas;
    porCampanha: Array<{ nome: string; gasto: number; contatos: number }>;
    rotina: Array<{ quando: string; tipo: string; estado: string; resumo: string; porque: string }>;
    analise: { quando: string; periodo: string; resumo: string } | null;
    saldo: number | null;
  };
  operacao: {
    tarefasConcluidas: Array<{ id: string; titulo: string; quando: string }>;
    tarefasAtrasadas: Array<{ id: string; titulo: string; prazo: string; status: string; fonte: string }>;
    tarefasDaSemana: Array<{ titulo: string; prazo: string }>;
    marcosVencidos: Array<{ titulo: string; prazo: string }>;
    marcosProximos: Array<{ titulo: string; prazo: string }>;
    projetoAtivo: string | null;
    /** source -> status das tarefas da Central (reforço de promessa). */
    tarefasDaCentral: Array<{ id: string; source: string; status: string; priority: string }>;
  };
  metas: SituacaoDasMetas;
  avisos: string[];
}

const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const linhas = (r: Resposta | null | undefined): Linha[] => (r && Array.isArray(r.data) ? (r.data as Linha[]) : []);

/** Dia (yyyy-mm-dd) no fuso de Brasília. */
export function diaLocal(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function somarDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function periodosDe(agora: Date): EstadoReal["periodos"] {
  const hoje = diaLocal(agora);
  return {
    semana: { de: somarDias(hoje, -6), ate: hoje },
    semanaAnterior: { de: somarDias(hoje, -13), ate: somarDias(hoje, -7) },
    mes: { de: somarDias(hoje, -29), ate: hoje },
    mesAnterior: { de: somarDias(hoje, -59), ate: somarDias(hoje, -30) },
    desde: null,
  };
}

const dentro = (dia: string, p: Periodo) => dia >= p.de && dia <= p.ate;

function contarContatos(actions: unknown): number {
  if (!Array.isArray(actions)) return 0;
  let t = 0;
  for (const a of actions as Linha[]) {
    const tipo = txt(a.action_type).toLowerCase();
    if (tipo.includes("lead") || tipo.includes("messaging_conversation_started")) t += num(a.value);
  }
  return t;
}

const TIPOS_COMPRA = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase", "onsite_conversion.purchase"];
function compras(lista: unknown): number {
  if (!Array.isArray(lista)) return 0;
  const porTipo = new Map<string, number>();
  for (const a of lista as Linha[]) porTipo.set(txt(a.action_type).toLowerCase(), (porTipo.get(txt(a.action_type).toLowerCase()) ?? 0) + num(a.value));
  for (const t of TIPOS_COMPRA) { const v = porTipo.get(t); if (v && v > 0) return v; }
  return 0;
}

const somaVazia = (): Somas => ({ gasto: 0, contatos: 0, vendas: 0, receita: 0 });

/**
 * Lê página a página até acabar. `montar` devolve a consulta sem o range; o
 * banco de mentira do teste pode não ter `.range`, e aí vale a resposta única.
 */
async function todas(montar: () => { range?: (de: number, ate: number) => PromiseLike<Resposta> } & PromiseLike<Resposta>): Promise<Resposta> {
  const primeira = montar();
  if (typeof primeira.range !== "function") return await primeira;
  const saida: Linha[] = [];
  for (let pagina = 0; pagina < PAGINAS_NO_MAXIMO; pagina += 1) {
    const q = pagina === 0 ? primeira : montar();
    const r = await q.range!(pagina * PAGINA, pagina * PAGINA + PAGINA - 1);
    if (r?.error) return { data: saida, error: r.error };
    const lote = linhas(r);
    saida.push(...lote);
    if (lote.length < PAGINA) return { data: saida, error: null };
  }
  return { data: saida, error: { message: "leitura longa demais; verifique a janela" } };
}

const SERVICOS_ROTULO: Record<string, string> = {
  design: "design", copywriting: "texto", edicao_video: "edição de vídeo", videos_ia: "vídeo com IA", site: "site",
  seo: "SEO", automacao: "automação", email_marketing: "e-mail", relatorios: "relatórios",
};

export interface OpcoesDoEstado {
  agora?: Date;
  /** Início do "desde o último ritual" (ISO), quando existe. */
  desde?: string | null;
}

export async function lerEstadoReal(db: BancoDoEstado, clientId: string, opcoes: OpcoesDoEstado = {}): Promise<EstadoReal> {
  const agora = opcoes.agora ?? new Date();
  const periodos = { ...periodosDe(agora), desde: opcoes.desde ?? null };
  const hoje = periodos.semana.ate;
  const avisos: string[] = [];
  const seguro = async (nome: string, consulta: () => PromiseLike<unknown>, tolerarAusencia = false): Promise<Linha[]> => {
    try {
      const r = (await consulta()) as Resposta;
      if (r?.error) {
        const ausente = ["42P01", "PGRST205", "PGRST204", "42703"].includes(String(r.error.code ?? ""));
        if (!(tolerarAusencia && ausente)) avisos.push(`${nome}: ${r.error.message ?? "erro"}`);
        else avisos.push(`${nome}: ainda não instalado no banco`);
        return [];
      }
      return linhas(r);
    } catch (e) {
      avisos.push(`${nome}: ${e instanceof Error ? e.message : "falha"}`);
      return [];
    }
  };

  const desde60 = periodos.mesAnterior.de;
  const desde70 = somarDias(hoje, -70);
  const em14 = new Date(agora.getTime() + 14 * DIA).toISOString();
  const desde90 = new Date(agora.getTime() - 90 * DIA).toISOString();
  const desde14ts = new Date(agora.getTime() - 14 * DIA).toISOString();
  const desde60ts = new Date(`${desde60}T03:00:00Z`).toISOString();

  const [perfil, metricas, publicados, agendados, pautas, campMesa, campAds, diario, vendas, rotina, analises, carteira, projetos, metas, relatorios, postsIg] = await Promise.all([
    seguro("perfil", () => db.from("profiles").select("id, full_name, company_name, created_at, services_config").eq("id", clientId).maybeSingle()
      .then((r: Resposta) => ({ data: r.data ? [r.data] : [], error: r.error }))),
    seguro("métricas do Instagram", () => db.from("social_metrics_weekly").select("external_account_id, week_start, week_end, followers, reach, total_interactions")
      .eq("client_id", clientId).gte("week_start", desde70).order("week_start", { ascending: false })),
    seguro("publicados", () => todas(() => db.from("editorial_publications").select("id, platform, published_at, scheduled_at, status, editorial_posts(title)")
      .eq("client_id", clientId).eq("status", "published").gte("published_at", desde60ts).order("published_at", { ascending: false }))),
    seguro("agendados", () => db.from("editorial_publications").select("id, platform, scheduled_at, status, editorial_posts(title)")
      .eq("client_id", clientId).eq("status", "scheduled").gte("scheduled_at", agora.toISOString()).lte("scheduled_at", em14).order("scheduled_at", { ascending: true })),
    seguro("pautas", () => todas(() => db.from("editorial_posts").select("id, title, production_status, primary_file_id, updated_at, editorial_publications(status)")
      .eq("client_id", clientId).is("archived_at", null).in("production_status", ["production", "ready"]).order("updated_at", { ascending: false }))),
    seguro("campanhas da Mesa", () => db.from("mesa_campanhas").select("id, nome, status, objetivo, pedido, periodo_inicio, periodo_fim, briefing, atualizado_em")
      .eq("client_id", clientId).gte("atualizado_em", desde90).order("atualizado_em", { ascending: false })),
    seguro("campanhas de anúncio", () => db.from("ads_campaigns").select("name, status, effective_status, objective, daily_budget").eq("client_id", clientId)),
    seguro("anúncios por dia", () => todas(() => db.from("ads_campaign_daily").select("campaign_name, day, spend, actions, action_values")
      .eq("client_id", clientId).gte("day", desde60).order("day", { ascending: false }))),
    seguro("vendas", () => db.from("ads_sales").select("sold_at, quantity, value, campaign_name").eq("client_id", clientId).gte("sold_at", desde60)),
    seguro("rotina do tráfego", () => db.from("ads_rotina_acoes").select("criado_em, tipo, estado, resumo, porque, desfeita_em")
      .eq("client_id", clientId).gte("criado_em", desde14ts).order("criado_em", { ascending: false }), true),
    seguro("análise da conta", () => db.from("ads_analises").select("criado_em, periodo_inicio, periodo_fim, analise")
      .eq("client_id", clientId).order("criado_em", { ascending: false }).limit(1), true),
    seguro("carteira de anúncios", () => db.from("ads_wallet").select("balance").eq("client_id", clientId)),
    seguro("projetos", () => db.from("projects").select("id, name, status, updated_at").eq("client_id", clientId).is("deleted_at", null)),
    seguro("metas de seguidores", () => db.from("social_metas_seguidores").select("id, meta, prazo, criado_em, arquivada_em, nota")
      .eq("client_id", clientId).is("arquivada_em", null).order("meta", { ascending: true }), true),
    seguro("metas já comemoradas", () => db.from("reports").select("metrics, created_at").eq("client_id", clientId).eq("status", "published")
      .gte("created_at", new Date(agora.getTime() - 180 * DIA).toISOString())),
    seguro("posts do Instagram", () => db.from("social_post_metrics").select("media_id, media_type, caption, posted_at, reach, saved, shares, total_interactions")
      .eq("client_id", clientId).gte("posted_at", new Date(`${somarDias(hoje, -13)}T03:00:00Z`).toISOString()).order("posted_at", { ascending: false })),
  ]);

  const p = perfil[0] ?? {};
  const sc = (p.services_config && typeof p.services_config === "object" ? p.services_config : {}) as Record<string, unknown>;
  const cliente = {
    nome: txt(p.company_name) || txt(p.full_name) || "Cliente",
    criadoEm: txt(p.created_at) || null,
    servicos: { social: sc.social === true, trafego: sc.trafego === true },
    outros: Object.entries(SERVICOS_ROTULO).filter(([k]) => sc[k] === true).map(([, v]) => v),
  };

  // Conta principal = a de mais seguidores (mesma regra do painel).
  const porConta = new Map<string, Linha[]>();
  for (const m of metricas) porConta.set(txt(m.external_account_id) || "conta", [...(porConta.get(txt(m.external_account_id) || "conta") ?? []), m]);
  let conta: string | null = null;
  let principal: Linha[] = [];
  for (const [k, lista] of porConta) {
    const maior = Math.max(...lista.map((x) => num(x.followers)));
    if (!principal.length || maior > Math.max(...principal.map((x) => num(x.followers)))) { principal = lista; conta = k; }
  }
  principal.sort((a, b) => txt(b.week_start).localeCompare(txt(a.week_start)));
  const semanas = principal.slice(0, 8).map((m) => ({
    de: txt(m.week_start), ate: txt(m.week_end) || somarDias(txt(m.week_start), 6),
    seguidores: m.followers == null ? null : num(m.followers), alcance: m.reach == null ? null : num(m.reach), interacoes: m.total_interactions == null ? null : num(m.total_interactions),
  }));

  const tituloDoPost = (r: Linha) => {
    const post = r.editorial_posts as Linha | Linha[] | null;
    return (Array.isArray(post) ? txt(post[0]?.title) : txt(post?.title)) || "publicação";
  };
  const pubs = publicados.map((r) => ({ titulo: tituloDoPost(r), quando: txt(r.published_at) || txt(r.scheduled_at), plataforma: txt(r.platform) }))
    .filter((r) => r.quando);
  const diaDo = (iso: string) => (iso.length > 10 ? diaLocal(new Date(iso)) : iso);
  const contaPubs = (per: Periodo) => pubs.filter((x) => dentro(diaDo(x.quando), per)).length;

  const emProducao = pautas
    .filter((x) => !((x.editorial_publications as Linha[] | null) ?? []).some((pb) => ["scheduled", "published"].includes(txt(pb.status))))
    .slice(0, 12)
    .map((x) => ({ titulo: txt(x.title) || "pauta", estado: txt(x.production_status) === "ready" ? (x.primary_file_id ? "arte pronta, sem data" : "pronta, sem arte") : "em produção" }));

  // Anúncios: somas por período e por campanha na semana.
  const somas = { semana: somaVazia(), semanaAnterior: somaVazia(), mes: somaVazia(), mesAnterior: somaVazia() };
  const porCampanha = new Map<string, { gasto: number; contatos: number }>();
  for (const d of diario) {
    const dia = txt(d.day).slice(0, 10);
    const g = num(d.spend); const c = contarContatos(d.actions); const v = compras(d.actions); const rv = compras(d.action_values);
    for (const k of ["semana", "semanaAnterior", "mes", "mesAnterior"] as const) {
      if (dentro(dia, periodos[k])) { somas[k].gasto += g; somas[k].contatos += c; somas[k].vendas += v; somas[k].receita += rv; }
    }
    if (dentro(dia, periodos.semana)) {
      const nome = txt(d.campaign_name) || "campanha";
      const x = porCampanha.get(nome) ?? { gasto: 0, contatos: 0 };
      x.gasto += g; x.contatos += c;
      porCampanha.set(nome, x);
    }
  }
  for (const v of vendas) {
    const dia = txt(v.sold_at).slice(0, 10);
    const q = Math.max(1, num(v.quantity)); const val = v.value == null ? 0 : num(v.value);
    for (const k of ["semana", "semanaAnterior", "mes", "mesAnterior"] as const) {
      if (dentro(dia, periodos[k])) { somas[k].vendas += q; somas[k].receita += val; }
    }
  }
  const analise = analises[0];
  const resumoDaAnalise = (a: unknown): string => {
    if (!a || typeof a !== "object") return "";
    const o = a as Linha;
    const campos = ["resumo", "leitura", "diagnostico", "conclusao", "o_que_fazer", "recomendacao"];
    for (const c of campos) if (typeof o[c] === "string" && txt(o[c]).trim()) return txt(o[c]).slice(0, 400);
    return JSON.stringify(o).slice(0, 300);
  };

  // Operação: tarefas pelo projeto (tarefa não tem client_id).
  const idsProjetos = projetos.map((x) => txt(x.id)).filter(Boolean);
  const ativos = projetos.filter((x) => txt(x.status) !== "done").sort((a, b) => txt(b.updated_at).localeCompare(txt(a.updated_at)));
  const [tarefas, marcos] = idsProjetos.length
    ? await Promise.all([
      seguro("tarefas", () => todas(() => db.from("tasks").select("id, title, status, due_date, updated_at, source, priority")
        .in("project_id", idsProjetos).is("deleted_at", null).or(`status.neq.done,updated_at.gte.${somarDias(hoje, -35)}`).order("updated_at", { ascending: false }))),
      seguro("marcos", () => db.from("milestones").select("title, status, target_date").in("project_id", idsProjetos).is("deleted_at", null).neq("status", "completed")),
    ])
    : [[], []];
  const fimDaSemana = somarDias(hoje, 7);
  const operacao: EstadoReal["operacao"] = {
    tarefasConcluidas: tarefas.filter((t) => txt(t.status) === "done" && txt(t.updated_at) >= (periodos.desde ?? new Date(agora.getTime() - 7 * DIA).toISOString()))
      .map((t) => ({ id: txt(t.id), titulo: txt(t.title), quando: txt(t.updated_at) })).slice(0, 20),
    tarefasAtrasadas: tarefas.filter((t) => txt(t.status) !== "done" && txt(t.due_date) && txt(t.due_date) < hoje)
      .map((t) => ({ id: txt(t.id), titulo: txt(t.title), prazo: txt(t.due_date), status: txt(t.status), fonte: txt(t.source) }))
      .sort((a, b) => a.prazo.localeCompare(b.prazo)).slice(0, 12),
    tarefasDaSemana: tarefas.filter((t) => txt(t.status) !== "done" && txt(t.due_date) >= hoje && txt(t.due_date) <= fimDaSemana)
      .map((t) => ({ titulo: txt(t.title), prazo: txt(t.due_date) })).slice(0, 12),
    marcosVencidos: marcos.filter((m) => txt(m.target_date) && txt(m.target_date) < hoje).map((m) => ({ titulo: txt(m.title), prazo: txt(m.target_date) })).slice(0, 6),
    marcosProximos: marcos.filter((m) => txt(m.target_date) >= hoje && txt(m.target_date) <= somarDias(hoje, 21)).map((m) => ({ titulo: txt(m.title), prazo: txt(m.target_date) })).slice(0, 6),
    projetoAtivo: txt(ativos[0]?.id ?? projetos[0]?.id) || null,
    tarefasDaCentral: tarefas.filter((t) => txt(t.source).startsWith("central:")).map((t) => ({ id: txt(t.id), source: txt(t.source), status: txt(t.status), priority: txt(t.priority) })),
  };

  // Metas de seguidores: série da conta principal contra os degraus cadastrados.
  const pontos: PontoDeSeguidores[] = principal.filter((m) => m.followers != null).map((m) => ({ quando: txt(m.week_end) || txt(m.week_start), seguidores: num(m.followers) }));
  const reconhecidas = new Set<string>();
  for (const r of relatorios) {
    const lista = (r.metrics as Linha | null)?.metas_reconhecidas;
    if (Array.isArray(lista)) for (const id of lista) reconhecidas.add(String(id));
  }
  const listaDeMetas: MetaDeSeguidores[] = metas.map((m) => ({ id: txt(m.id), meta: num(m.meta), prazo: txt(m.prazo) || null, criado_em: txt(m.criado_em), arquivada_em: txt(m.arquivada_em) || null, nota: txt(m.nota) || null }));

  return {
    lidoEm: agora.toISOString(),
    cliente,
    periodos,
    organico: {
      conta,
      semanas,
      publicados: pubs.filter((x) => x.quando >= (periodos.desde ?? new Date(agora.getTime() - 7 * DIA).toISOString())).slice(0, 15),
      publicadosNaSemana: contaPubs(periodos.semana),
      publicadosNaSemanaAnterior: contaPubs(periodos.semanaAnterior),
      publicadosNoMes: contaPubs(periodos.mes),
      publicadosNoMesAnterior: contaPubs(periodos.mesAnterior),
      agendados: agendados.map((r) => ({ titulo: tituloDoPost(r), quando: txt(r.scheduled_at) })).slice(0, 12),
      emProducao,
      instagram: (() => {
        // Um registro por post (a coleta pode repetir o mesmo post): fica o mais recente.
        const porMidia = new Map<string, Linha>();
        for (const x of postsIg) { const k = txt(x.media_id) || `${txt(x.posted_at)}:${txt(x.caption).slice(0, 20)}`; if (!porMidia.has(k)) porMidia.set(k, x); }
        const lista = [...porMidia.values()];
        const dia = (x: Linha) => diaLocal(new Date(txt(x.posted_at)));
        return {
          naSemana: lista.filter((x) => dentro(dia(x), periodos.semana)).length,
          naSemanaAnterior: lista.filter((x) => dentro(dia(x), periodos.semanaAnterior)).length,
          melhores: lista.filter((x) => x.reach != null).sort((a, b) => num(b.reach) - num(a.reach)).slice(0, 3).map((x) => ({
            legenda: txt(x.caption).replace(/\s+/g, " ").slice(0, 70) || "post", tipo: txt(x.media_type).toLowerCase(), quando: txt(x.posted_at),
            alcance: num(x.reach), salvos: num(x.saved), compartilhamentos: num(x.shares),
          })),
        };
      })(),
    },
    campanhasDaMesa: campMesa.map((c) => ({
      id: txt(c.id), nome: txt(c.nome), status: txt(c.status), de: txt(c.periodo_inicio) || null, ate: txt(c.periodo_fim) || null,
      objetivo: txt(c.objetivo), pedido: txt(c.pedido), briefing: c.briefing ?? null,
    })).slice(0, 10),
    pago: {
      campanhasNoAr: campAds.filter((c) => txt(c.effective_status || c.status).toUpperCase() === "ACTIVE")
        .map((c) => ({ nome: txt(c.name), objetivo: txt(c.objective), orcamentoDia: c.daily_budget == null ? null : num(c.daily_budget) })),
      campanhasCadastradas: campAds.length,
      ...somas,
      porCampanha: [...porCampanha.entries()].map(([nome, v]) => ({ nome, ...v })).sort((a, b) => b.gasto - a.gasto).slice(0, 8),
      rotina: rotina.filter((r) => !r.desfeita_em).map((r) => ({ quando: txt(r.criado_em), tipo: txt(r.tipo), estado: txt(r.estado), resumo: txt(r.resumo), porque: txt(r.porque) })).slice(0, 10),
      analise: analise ? { quando: txt(analise.criado_em), periodo: `${txt(analise.periodo_inicio)} a ${txt(analise.periodo_fim)}`, resumo: resumoDaAnalise(analise.analise) } : null,
      saldo: carteira.length ? carteira.reduce((s, w) => s + num(w.balance), 0) : null,
    },
    operacao,
    metas: situacaoDasMetas(listaDeMetas, pontos, { agora, reconhecidas: [...reconhecidas] }),
    avisos,
  };
}

// ─── Texto para o escritor ───────────────────────────────────

const dm = (iso: string) => {
  const s = iso.length > 10 ? diaLocal(new Date(iso)) : iso;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : s;
};
const periodoTxt = (p: Periodo) => `${dm(p.de)} a ${dm(p.ate)}`;
const brl = (n: number) => `R$ ${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
const milhar = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");

function variacao(atual: number, anterior: number): string {
  if (anterior <= 0) return atual > 0 ? "sem base de comparação" : "igual";
  const pct = Math.round(((atual - anterior) / anterior) * 100);
  return pct === 0 ? "igual" : `${pct > 0 ? "+" : ""}${pct}%`;
}

export type Tendencia = "melhor" | "pior" | "igual" | "sem-base";

/** Régua do dono: a semana tem que ser melhor que a anterior. */
export function tendenciaDosAnuncios(e: EstadoReal): Tendencia {
  const a = e.pago.semana; const b = e.pago.semanaAnterior;
  if (a.gasto <= 0 || b.gasto <= 0) return "sem-base";
  const cplA = a.contatos > 0 ? a.gasto / a.contatos : Infinity;
  const cplB = b.contatos > 0 ? b.gasto / b.contatos : Infinity;
  if (a.vendas !== b.vendas) return a.vendas > b.vendas ? "melhor" : "pior";
  if (a.contatos === b.contatos && cplA === cplB) return "igual";
  return a.contatos > b.contatos || cplA < cplB * 0.95 ? "melhor" : a.contatos < b.contatos || cplA > cplB * 1.05 ? "pior" : "igual";
}

export function tendenciaDoConteudo(e: EstadoReal): Tendencia {
  const [s0, s1] = e.organico.semanas;
  if (!s0 || !s1 || s0.alcance === null || s1.alcance === null) return "sem-base";
  if (s1.alcance === 0) return s0.alcance > 0 ? "melhor" : "igual";
  const pct = (s0.alcance - s1.alcance) / s1.alcance;
  return pct > 0.05 ? "melhor" : pct < -0.05 ? "pior" : "igual";
}

export interface CanalParaTexto {
  id: string;
  rotulo: string;
}

export function estadoRealComoTexto(e: EstadoReal, opcoes: { ritual?: string; canais?: CanalParaTexto[]; limite?: number } = {}): string {
  const mensal = opcoes.ritual === "radar_aceleriq" || opcoes.ritual === "marco_90";
  const P = e.periodos;
  const partes: string[] = [];
  partes.push([
    `ESTADO REAL DO CLIENTE (lido agora no banco, ${dm(e.lidoEm)}; é a fonte da verdade do que está sendo feito. O que não aparece aqui não foi registrado, e falta de registro não prova falta de trabalho).`,
    `PERÍODOS: semana = ${periodoTxt(P.semana)}; semana anterior = ${periodoTxt(P.semanaAnterior)}; mês = ${periodoTxt(P.mes)}; mês anterior = ${periodoTxt(P.mesAnterior)}.${P.desde ? ` Último ritual enviado: ${dm(P.desde)}.` : ""}`,
    `Frentes contratadas: ${[e.cliente.servicos.social ? "conteúdo (social)" : "", e.cliente.servicos.trafego ? "anúncios (tráfego)" : "", ...e.cliente.outros].filter(Boolean).join(", ") || "não informadas no cadastro"}.`,
  ].join("\n"));

  // Conteúdo orgânico
  const o = e.organico;
  const org: string[] = ["CONTEÚDO ORGÂNICO (Instagram e posts; nunca misture com anúncios):"];
  if (o.semanas.length) {
    const [s0, s1] = o.semanas;
    const s4 = o.semanas[Math.min(4, o.semanas.length - 1)];
    org.push(`- Semana medida ${dm(s0.de)} a ${dm(s0.ate)}: ${s0.seguidores !== null ? `${milhar(s0.seguidores)} seguidores` : "seguidores sem dado"}${s1?.seguidores != null && s0.seguidores != null ? ` (${s0.seguidores - s1.seguidores >= 0 ? "+" : ""}${s0.seguidores - s1.seguidores} na semana)` : ""}; ${s0.alcance !== null ? `${milhar(s0.alcance)} pessoas alcançadas` : "alcance sem dado"}${s1?.alcance != null && s0.alcance != null ? ` (${variacao(s0.alcance, s1.alcance)} contra ${dm(s1.de)} a ${dm(s1.ate)})` : ""}; ${s0.interacoes !== null ? `${milhar(s0.interacoes)} interações` : ""}${s1?.interacoes != null && s0.interacoes != null ? ` (${variacao(s0.interacoes, s1.interacoes)})` : ""}.`);
    if (mensal && s4 && s4 !== s0 && s4.seguidores != null && s0.seguidores != null) {
      org.push(`- Em ${o.semanas.indexOf(s4)} semanas (desde ${dm(s4.de)}): seguidores de ${milhar(s4.seguidores)} para ${milhar(s0.seguidores)} (${s0.seguidores - s4.seguidores >= 0 ? "+" : ""}${s0.seguidores - s4.seguidores}).`);
    }
  } else if (e.cliente.servicos.social) {
    org.push("- Sem medição do Instagram registrada no período.");
  }
  org.push(`- Posts no ar: ${o.publicadosNaSemana} na semana (anterior ${o.publicadosNaSemanaAnterior}); ${o.publicadosNoMes} no mês (mês anterior ${o.publicadosNoMesAnterior}).`);
  if (o.instagram.naSemana || o.instagram.naSemanaAnterior) org.push(`- Posts no perfil (lidos do Instagram, inclui o que o cliente postou): ${o.instagram.naSemana} na semana, ${o.instagram.naSemanaAnterior} na anterior.`);
  if (o.instagram.melhores.length) org.push(`- Os que mais alcançaram em 14 dias: ${o.instagram.melhores.map((x) => `"${x.legenda}" (${x.tipo === "video" || x.tipo === "reels" ? "vídeo" : x.tipo === "carousel_album" ? "carrossel" : "post"}, ${dm(x.quando)}): ${milhar(x.alcance)} pessoas${x.salvos ? `, ${x.salvos} salvaram` : ""}${x.compartilhamentos ? `, ${x.compartilhamentos} compartilharam` : ""}`).join("; ")}.`);
  if (o.publicados.length) org.push(`- Publicados desde o último ritual: ${o.publicados.slice(0, 8).map((x) => `${x.titulo} (${dm(x.quando)})`).join("; ")}.`);
  if (o.agendados.length) org.push(`- Agendados nos próximos 14 dias: ${o.agendados.slice(0, 8).map((x) => `${x.titulo} (${dm(x.quando)})`).join("; ")}.`);
  if (o.emProducao.length) org.push(`- Em produção sem data: ${o.emProducao.slice(0, 6).map((x) => `${x.titulo} (${x.estado})`).join("; ")}.`);
  partes.push(org.join("\n"));

  if (e.campanhasDaMesa.length) {
    const canal = new Map((opcoes.canais ?? []).map((c) => [c.id, c.rotulo]));
    partes.push([
      "CAMPANHAS DA MESA (tema ou oferta de comunicação criados na área de Campanhas; NÃO são anúncios, a menos que o canal abaixo diga paga):",
      ...e.campanhasDaMesa.slice(0, 6).map((c) => `- "${c.nome}" (${c.status || "sem status"}${c.de ? `, ${dm(c.de)}${c.ate ? ` a ${dm(c.ate)}` : ""}` : ""}): canal ${canal.get(c.id) ?? "sem registro de verba: trate como campanha de conteúdo"}.${c.objetivo ? ` Objetivo: ${c.objetivo.slice(0, 180)}` : ""}`),
    ].join("\n"));
  }

  const pg = e.pago;
  if (e.cliente.servicos.trafego || pg.campanhasCadastradas > 0 || pg.mes.gasto > 0) {
    const cpl = (s: Somas) => (s.contatos > 0 ? ` (custo por contato ${brl(s.gasto / s.contatos)})` : "");
    const linha = (rot: string, s: Somas, per: Periodo) => `- ${rot} ${periodoTxt(per)}: ${brl(s.gasto)} investidos, ${s.contatos} contatos${cpl(s)}${s.vendas ? `, ${s.vendas} venda(s)${s.receita ? ` (${brl(s.receita)})` : ""}` : ""}.`;
    const pag: string[] = ["ANÚNCIOS PAGOS (Mesa Ads e conta de anúncios; só isto é tráfego pago):"];
    pag.push(pg.campanhasNoAr.length ? `- No ar agora: ${pg.campanhasNoAr.slice(0, 6).map((c) => `${c.nome}${c.orcamentoDia ? ` (${brl(c.orcamentoDia)} por dia)` : ""}`).join("; ")}.` : `- Nenhuma campanha ativa registrada agora (${pg.campanhasCadastradas} cadastrada(s)); não afirme que parou sem confirmar.`);
    pag.push(linha("Semana", pg.semana, P.semana));
    pag.push(linha("Semana anterior", pg.semanaAnterior, P.semanaAnterior));
    if (mensal) { pag.push(linha("Mês", pg.mes, P.mes)); pag.push(linha("Mês anterior", pg.mesAnterior, P.mesAnterior)); }
    if (pg.porCampanha.length > 1) pag.push(`- Por campanha na semana: ${pg.porCampanha.map((c) => `${c.nome}: ${brl(c.gasto)}, ${c.contatos} contatos`).join("; ")}.`);
    if (pg.rotina.length) pag.push(`- O que o agente de tráfego fez (rotina da Mesa Ads): ${pg.rotina.slice(0, 5).map((r) => `${dm(r.quando)} ${r.resumo || r.tipo}${r.estado ? ` [${r.estado}]` : ""}`).join("; ")}.`);
    if (pg.analise?.resumo) pag.push(`- Última análise da conta (${dm(pg.analise.quando)}, período ${pg.analise.periodo}): ${pg.analise.resumo}`);
    if (pg.saldo !== null) pag.push(`- Saldo registrado na carteira de anúncios: ${brl(pg.saldo)}${pg.saldo <= 0 ? " (zerado: fale como o próximo passo que libera resultado)" : ""}.`);
    partes.push(pag.join("\n"));
  }

  const op = e.operacao;
  const ope: string[] = ["OPERAÇÃO (o que a equipe fez e o que está aberto):"];
  if (op.tarefasConcluidas.length) ope.push(`- Tarefas concluídas${P.desde ? " desde o último ritual" : " na semana"}: ${op.tarefasConcluidas.slice(0, 10).map((t) => `${t.titulo} (${dm(t.quando)})`).join("; ")}.`);
  if (op.tarefasDaSemana.length) ope.push(`- Previstas para os próximos 7 dias: ${op.tarefasDaSemana.slice(0, 8).map((t) => `${t.titulo} (${dm(t.prazo)})`).join("; ")}.`);
  if (op.tarefasAtrasadas.length) ope.push(`- Atrasadas [interno, não citar ao cliente como atraso]: ${op.tarefasAtrasadas.slice(0, 6).map((t) => `${t.titulo} (prazo ${dm(t.prazo)})`).join("; ")}.`);
  if (op.marcosProximos.length) ope.push(`- Marcos próximos: ${op.marcosProximos.map((m) => `${m.titulo} (${dm(m.prazo)})`).join("; ")}.`);
  if (op.marcosVencidos.length) ope.push(`- Marcos que passaram da data [interno]: ${op.marcosVencidos.map((m) => `${m.titulo} (${dm(m.prazo)})`).join("; ")}.`);
  if (ope.length > 1) partes.push(ope.join("\n"));

  const metas = metasComoTexto(e.metas);
  if (metas) partes.push(metas);

  // Como está indo e a previsão (conta do código, não da IA).
  const leitura: string[] = ["COMO ESTÁ INDO (leitura calculada; use para dizer se está bom e o que vamos melhorar):"];
  const tc = tendenciaDoConteudo(e);
  if (tc !== "sem-base") leitura.push(`- Conteúdo: alcance ${tc === "melhor" ? "melhor" : tc === "pior" ? "pior" : "estável"} que a semana anterior.`);
  const ta = tendenciaDosAnuncios(e);
  if (ta !== "sem-base") leitura.push(`- Anúncios: semana ${ta === "melhor" ? "MELHOR" : ta === "pior" ? "PIOR" : "igual"} que a anterior (régua da casa: a semana tem que ser melhor que a anterior${ta === "pior" ? "; diga o ajuste que estamos fazendo" : ""}).`);
  if (pg.semana.gasto > 0 && pg.semana.contatos > 0) {
    leitura.push(`- Previsão: no ritmo desta semana, os próximos 30 dias trazem perto de ${Math.round((pg.semana.contatos / 7) * 30)} contatos com ${brl((pg.semana.gasto / 7) * 30)} investidos.`);
  }
  if (e.metas.proxima?.previsao) leitura.push(`- Seguidores: no ritmo atual, a meta de ${milhar(e.metas.proxima.meta)} chega perto de ${dm(e.metas.proxima.previsao)}.`);
  if (leitura.length > 1) partes.push(leitura.join("\n"));

  const limite = opcoes.limite ?? 9000;
  const saida: string[] = [];
  let total = 0;
  for (const parte of partes) {
    if (total + parte.length + 2 > limite) {
      const sobra = limite - total - 30;
      if (sobra > 200) saida.push(`${parte.slice(0, sobra).trimEnd()}\n[cortado para caber]`);
      break;
    }
    saida.push(parte);
    total += parte.length + 2;
  }
  return saida.join("\n\n");
}

/** Evidências do que aconteceu (para conferir promessas): tudo com data. */
export function evidenciasDoEstado(e: EstadoReal): Array<{ quando: string; texto: string }> {
  return [
    ...e.organico.publicados.map((x) => ({ quando: x.quando, texto: `Publicado: ${x.titulo}` })),
    ...e.operacao.tarefasConcluidas.map((t) => ({ quando: t.quando, texto: `Tarefa concluída: ${t.titulo}` })),
    ...e.pago.rotina.map((r) => ({ quando: r.quando, texto: `Anúncios: ${r.resumo || r.tipo}` })),
    ...e.organico.agendados.map((x) => ({ quando: e.lidoEm, texto: `Agendado para ${dm(x.quando)}: ${x.titulo}` })),
  ];
}
