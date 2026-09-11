/**
 * Regras da esteira. Funcao pura: fatos de um cliente + data de hoje ->
 * itens, insights e rituais. Sem sorteio, sem acervo, sem etapa generica.
 *
 * Reguas do dono que estas regras encarnam:
 *  - so fala do que existe de verdade, com o nome do item;
 *  - o que nao se aplica ao cliente nao aparece (cliente sem post nao ve
 *    "agenda vazia"; cliente estabelecido nao ve "criar Instagram");
 *  - comparacao e insight, nunca tarefa;
 *  - trafego nao herda pendencia de social;
 *  - cada cliente e individual: o onboarding nasce do que falta a ele.
 */

import type {
  EsteiraDoCliente,
  EsteiraItem,
  FatosDoCliente,
  Frente,
  Gravidade,
  Insight,
  PostFato,
  RitualDaSemana,
  RitualKey,
} from "./esteiraTipos";

const DIA = 86_400_000;

/* ── Onboarding: catalogo ordenado, cada passo diz como se detecta ── */

export interface PassoOnboarding {
  key: string;
  rotulo: string;
  passo: string;
  /** Deteccao automatica pelos fatos; null = so a mao ("ja tem"). */
  auto: ((f: FatosDoCliente) => boolean) | null;
  /** Passo que precisa estar fechado antes. */
  depende?: string;
  /** So vale para quem tem essa frente. */
  soSe?: "social" | "trafego";
  rota?: string;
}

function conectado(f: FatosDoCliente, ...providers: string[]): boolean {
  return f.conexoes.some(
    (c) => providers.includes(c.provider) && (c.status ?? "").toLowerCase() === "connected",
  );
}

export const ONBOARDING: PassoOnboarding[] = [
  { key: "briefing", rotulo: "Briefing", passo: "Cliente responder o briefing", auto: (f) => f.briefingRespondido, rota: "/clientes" },
  { key: "nome", rotulo: "Nome", passo: "Definir o nome com o cliente", auto: null },
  { key: "logo", rotulo: "Logo", passo: "Criar o logo", auto: null, depende: "nome" },
  { key: "identidade", rotulo: "Identidade visual", passo: "Fechar a identidade visual", auto: null, depende: "logo" },
  { key: "instagram", rotulo: "Instagram", passo: "Criar o Instagram e conectar no painel", auto: (f) => conectado(f, "instagram", "meta", "facebook"), depende: "identidade", soSe: "social", rota: "/clientes" },
  { key: "portfolio", rotulo: "Portfólio / site", passo: "Montar o portfólio ou site", auto: null, depende: "identidade" },
  { key: "grupo", rotulo: "Grupo no WhatsApp", passo: "Criar o grupo com o cliente", auto: null },
  { key: "anuncios", rotulo: "Conta de anúncios", passo: "Criar e conectar a conta de anúncios", auto: (f) => conectado(f, "meta_ads", "ads", "google_ads"), depende: "instagram", soSe: "trafego", rota: "/clientes" },
];

/** Cliente estabelecido: ja publica ou esta ha mais de 90 dias na casa.
    Para ele, os passos so-a-mao contam como ja feitos, a nao ser que alguem
    marque o contrario. Cliente novo comeca com tudo em aberto. */
export function clienteEstabelecido(f: FatosDoCliente, hoje: Date): boolean {
  const publicou = f.posts.some((p) => p.publicacoes.some((x) => x.status === "published"));
  if (publicou) return true;
  if (!f.criadoEm) return false;
  const dias = (hoje.getTime() - new Date(f.criadoEm).getTime()) / DIA;
  return dias > 90;
}

function passoFeito(p: PassoOnboarding, f: FatosDoCliente, estabelecido: boolean): boolean {
  if (p.key in f.onboardingHas) return Boolean(f.onboardingHas[p.key]);
  if (p.auto) return p.auto(f);
  return estabelecido;
}

function passoSeAplica(p: PassoOnboarding, f: FatosDoCliente): boolean {
  if (p.soSe === "social") return f.servicos.social;
  if (p.soSe === "trafego") return f.servicos.trafego;
  return true;
}

export function itensDeOnboarding(f: FatosDoCliente, hoje: Date): { itens: EsteiraItem[]; completo: boolean } {
  const estabelecido = clienteEstabelecido(f, hoje);
  const aplicaveis = ONBOARDING.filter((p) => passoSeAplica(p, f));
  const feitos = new Set(aplicaveis.filter((p) => passoFeito(p, f, estabelecido)).map((p) => p.key));
  const abertos = aplicaveis.filter((p) => !feitos.has(p.key));
  const frente: Frente = f.servicos.social ? "social" : f.servicos.trafego ? "trafego" : "geral";
  const itens: EsteiraItem[] = abertos.map((p) => {
    const bloqueado = p.depende && !feitos.has(p.depende) ? p.depende : undefined;
    const rotuloBloqueio = bloqueado ? ONBOARDING.find((x) => x.key === bloqueado)?.rotulo : undefined;
    return {
      ordem: ONBOARDING.findIndex((x) => x.key === p.key),
      key: `onb:${p.key}`,
      clientId: f.clientId,
      frente,
      fonte: "onboarding",
      titulo: p.rotulo,
      passo: p.passo,
      gravidade: bloqueado ? "normal" : "atencao",
      fatos: bloqueado ? [`Depende de: ${rotuloBloqueio}`] : ["Ainda não existe"],
      rota: p.rota,
      bloqueadoPor: rotuloBloqueio,
    };
  });
  return { itens, completo: abertos.length === 0 };
}

/* ── Posts: cada post no seu elo ── */

const fmtDia = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
};

function diasDesde(iso: string | null, hoje: Date): number | null {
  if (!iso) return null;
  return Math.floor((hoje.getTime() - new Date(iso).getTime()) / DIA);
}

export function itemDoPost(f: FatosDoCliente, p: PostFato, hoje: Date): EsteiraItem | null {
  const base = { clientId: f.clientId, frente: "social" as Frente, fonte: "post" as const, titulo: p.titulo, rota: "/agenda" };
  const pubs = p.publicacoes;
  if (pubs.some((x) => x.status === "published")) return null;

  const falhou = pubs.find((x) => ["failed", "error", "rejected"].includes(x.status));
  if (falhou) {
    return { ...base, key: `post:${p.id}:repostar`, passo: "Falhou, postar de novo", gravidade: "urgente", fatos: [`Publicação com erro${falhou.scheduledAt ? ` em ${fmtDia(falhou.scheduledAt)}` : ""}`] };
  }
  const perdeu = pubs.find((x) => x.status === "scheduled" && x.scheduledAt && new Date(x.scheduledAt).getTime() < hoje.getTime());
  if (perdeu) {
    return { ...base, key: `post:${p.id}:nao-publicou`, passo: "Não publicou na data, conferir", gravidade: "urgente", fatos: [`Estava marcado para ${fmtDia(perdeu.scheduledAt)}`] };
  }
  if (pubs.some((x) => x.status === "scheduled")) return null; // agendado, em dia

  if (!p.temArte) {
    const idade = diasDesde(p.criadoEm, hoje);
    return { ...base, key: `post:${p.id}:arte`, passo: "Fazer a arte", gravidade: idade !== null && idade >= 7 ? "atencao" : "normal", fatos: [idade !== null ? `Pauta há ${idade} dia${idade === 1 ? "" : "s"} sem arte` : "Pauta sem arte"] };
  }
  if ((p.aprovAgencia ?? "").toLowerCase() !== "approved" && (p.aprovAgencia ?? "") !== "") {
    return { ...base, key: `post:${p.id}:revisar`, passo: "Revisar a arte (agência)", gravidade: "normal", fatos: ["Arte pronta, falta o ok interno"] };
  }
  const cli = (p.aprovCliente ?? "").toLowerCase();
  if (cli === "rejected") {
    return { ...base, key: `post:${p.id}:refazer`, passo: "Cliente recusou, refazer e reenviar", gravidade: "urgente", fatos: ["Pediu alteração"] };
  }
  if (cli === "pending" || cli === "requested" || cli === "awaiting") {
    const parada = diasDesde(p.aprovPedidaEm, hoje);
    return { ...base, key: `post:${p.id}:aprovacao`, passo: "Aguardando aprovação do cliente", gravidade: parada !== null && parada >= 3 ? "urgente" : "atencao", fatos: [parada !== null ? `Enviado há ${parada} dia${parada === 1 ? "" : "s"}` : "Enviado ao cliente"], rota: "/aprovacoes" };
  }
  if (cli !== "approved") {
    return { ...base, key: `post:${p.id}:enviar`, passo: "Enviar para o cliente aprovar", gravidade: "normal", fatos: ["Arte pronta, ainda não foi ao cliente"], rota: "/aprovacoes" };
  }
  if (!p.temLegenda) {
    return { ...base, key: `post:${p.id}:legenda`, passo: "Escrever a legenda", gravidade: "normal", fatos: ["Aprovado, sem legenda"] };
  }
  return { ...base, key: `post:${p.id}:agenda`, passo: "Dar data na agenda", gravidade: "atencao", fatos: ["Aprovado e com legenda, sem data"] };
}

export function itensDaAgenda(f: FatosDoCliente, hoje: Date, onboardingCompleto: boolean): EsteiraItem[] {
  if (!f.servicos.social || !onboardingCompleto) return [];
  const futuros = f.posts.flatMap((p) => p.publicacoes.filter((x) => x.status === "scheduled" && x.scheduledAt && new Date(x.scheduledAt).getTime() >= hoje.getTime()));
  const base = { clientId: f.clientId, frente: "social" as Frente, fonte: "agenda" as const, titulo: "Agenda", rota: "/agenda" };
  if (futuros.length === 0) {
    return [{ ...base, key: "agenda:vazia", passo: "Agenda vazia, colocar posts", gravidade: "urgente", fatos: ["Nenhum post agendado daqui para a frente"] }];
  }
  const em14 = futuros.filter((x) => new Date(x.scheduledAt as string).getTime() < hoje.getTime() + 14 * DIA).length;
  if (em14 < 2) {
    const proximo = futuros.map((x) => x.scheduledAt as string).sort()[0];
    return [{ ...base, key: "agenda:curta", passo: `Próximas duas semanas com só ${em14} post`, gravidade: "atencao", fatos: [`Próximo em ${fmtDia(proximo)}`] }];
  }
  return [];
}

/* ── Anuncios: campanha por campanha, e a semana contra a anterior ── */

function somaJanela(f: FatosDoCliente, hoje: Date, deDias: number, ateDias: number): { spend: number; leads: number } {
  const ini = hoje.getTime() - deDias * DIA;
  const fim = hoje.getTime() - ateDias * DIA;
  let spend = 0;
  let leads = 0;
  for (const c of f.campanhas) {
    for (const d of c.diario) {
      const t = new Date(d.day).getTime();
      if (t >= ini && t < fim) {
        spend += d.spend;
        leads += d.leads;
      }
    }
  }
  return { spend, leads };
}

export function itensDeAnuncios(f: FatosDoCliente, hoje: Date, onboardingCompleto: boolean): EsteiraItem[] {
  if (!f.servicos.trafego || !onboardingCompleto) return [];
  const base = { clientId: f.clientId, frente: "trafego" as Frente, fonte: "anuncio" as const, rota: "/trafego" };
  const itens: EsteiraItem[] = [];
  const ativas = f.campanhas.filter((c) => c.ativa);

  if (f.campanhas.length === 0) {
    itens.push({ ...base, key: "ads:primeira", titulo: "Campanhas", passo: "Cadastrar a primeira campanha", gravidade: "atencao", fatos: ["Nenhuma campanha no painel"] });
    return itens;
  }
  if (ativas.length === 0) {
    itens.push({ ...base, key: "ads:nenhuma-ativa", titulo: "Campanhas", passo: "Nenhuma campanha no ar, conferir", gravidade: "urgente", fatos: [`${f.campanhas.length} cadastrada${f.campanhas.length === 1 ? "" : "s"}, 0 ativa`] });
    return itens;
  }
  if (f.saldoVerba !== null && f.saldoVerba <= 0) {
    itens.push({ ...base, key: "ads:verba-zerada", titulo: "Verba", passo: "Verba zerada com campanha no ar", gravidade: "urgente", fatos: [`${ativas.length} ativa${ativas.length === 1 ? "" : "s"}`] });
  }

  const agora7 = somaJanela(f, hoje, 7, 0);
  const antes7 = somaJanela(f, hoje, 14, 7);

  for (const c of ativas) {
    const ultimoDia = c.diario.map((d) => d.day).sort().at(-1) ?? null;
    const parado = diasDesde(ultimoDia, hoje);
    if (parado === null || parado >= 3) {
      itens.push({ ...base, key: `camp:${c.id}:parado`, titulo: c.nome, passo: "Dados parados, conferir a campanha", gravidade: "atencao", fatos: [parado === null ? "Sem dado nenhum" : `Último dado há ${parado} dias`] });
      continue;
    }
    const freq = Math.max(...c.diario.filter((d) => new Date(d.day).getTime() >= hoje.getTime() - 7 * DIA).map((d) => d.frequency ?? 0), 0);
    if (freq >= 3.5) {
      itens.push({ ...base, key: `camp:${c.id}:saturada`, titulo: c.nome, passo: "Criativo saturado, trocar o criativo", gravidade: "atencao", fatos: [`Frequência ${freq.toFixed(1)}`] });
    }
    const g = c.diario.filter((d) => new Date(d.day).getTime() >= hoje.getTime() - 7 * DIA).reduce((a, d) => ({ spend: a.spend + d.spend, leads: a.leads + d.leads }), { spend: 0, leads: 0 });
    if (g.spend > 0 && g.leads === 0) {
      itens.push({ ...base, key: `camp:${c.id}:sem-lead`, titulo: c.nome, passo: "Gastou sem trazer lead, conferir", gravidade: "atencao", fatos: [`R$ ${g.spend.toFixed(0)} em 7 dias, 0 leads`] });
    }
  }

  if (agora7.spend > 0 && antes7.spend > 0 && agora7.leads < antes7.leads) {
    itens.push({ ...base, key: "ads:semana-pior", titulo: "Semana", passo: "Anúncios piores que a semana passada, revisar", gravidade: "atencao", fatos: [`${agora7.leads} leads agora, ${antes7.leads} antes`] });
  }
  return itens;
}

/* ── Tarefas, checklists e marcos: o trabalho real do dia a dia ── */

const TAREFAS_VISIVEIS = 6;

export function itensDeTarefas(f: FatosDoCliente, hoje: Date): EsteiraItem[] {
  const hojeStr = hoje.toISOString().slice(0, 10);
  const abertas = f.tarefas.filter((t) => !["done", "completed", "concluida", "cancelled"].includes((t.status ?? "").toLowerCase()));
  const itens: EsteiraItem[] = [];
  for (const t of abertas) {
    const base = { clientId: f.clientId, frente: "geral" as Frente, fonte: "tarefa" as const, titulo: t.titulo, rota: "/kanban", vencimento: t.dueDate ?? undefined };
    if (t.dueDate && t.dueDate < hojeStr) {
      const atraso = diasDesde(t.dueDate, hoje) ?? 0;
      itens.push({ ...base, key: `task:${t.id}`, passo: "Tarefa atrasada", gravidade: "urgente", fatos: [`Venceu há ${atraso} dia${atraso === 1 ? "" : "s"}`] });
    } else if (t.dueDate && new Date(t.dueDate).getTime() <= hoje.getTime() + 7 * DIA) {
      itens.push({ ...base, key: `task:${t.id}`, passo: `Entregar até ${fmtDia(t.dueDate)}`, gravidade: "normal", fatos: [] });
    } else if (!t.assignedTo) {
      itens.push({ ...base, key: `task:${t.id}`, passo: "Sem responsável, definir dono", gravidade: "atencao", fatos: [] });
    }
  }
  const ordem: Record<Gravidade, number> = { urgente: 0, atencao: 1, normal: 2 };
  itens.sort((a, b) => ordem[a.gravidade] - ordem[b.gravidade] || (a.vencimento ?? "").localeCompare(b.vencimento ?? ""));
  if (itens.length > TAREFAS_VISIVEIS) {
    const resto = itens.length - TAREFAS_VISIVEIS;
    const visiveis = itens.slice(0, TAREFAS_VISIVEIS);
    visiveis.push({ clientId: f.clientId, frente: "geral", fonte: "tarefa", key: "task:mais", titulo: `Mais ${resto} tarefa${resto === 1 ? "" : "s"}`, passo: "Ver no Kanban", gravidade: "normal", fatos: [], rota: "/kanban" });
    return visiveis;
  }
  return itens;
}

export function itensDeChecklists(f: FatosDoCliente): EsteiraItem[] {
  const itens: EsteiraItem[] = [];
  for (const c of f.checklists) {
    for (const it of c.itens.filter((x) => !x.done)) {
      itens.push({ clientId: f.clientId, frente: "geral", fonte: "checklist", key: `check:${c.memId}:${it.idx}`, titulo: it.texto, passo: "Concluir", gravidade: "normal", fatos: [c.titulo] });
    }
  }
  return itens;
}

export function itensDeMarcos(f: FatosDoCliente, hoje: Date): EsteiraItem[] {
  const hojeStr = hoje.toISOString().slice(0, 10);
  const itens: EsteiraItem[] = [];
  for (const m of f.marcos) {
    if ((m.status ?? "").toLowerCase() === "completed") continue;
    if (!m.targetDate) continue;
    const base = { clientId: f.clientId, frente: "geral" as Frente, fonte: "marco" as const, titulo: m.titulo, rota: "/timeline", vencimento: m.targetDate };
    if (m.targetDate < hojeStr) {
      const atraso = diasDesde(m.targetDate, hoje) ?? 0;
      itens.push({ ...base, key: `marco:${m.id}`, passo: "Marco vencido", gravidade: "urgente", fatos: [`Era para ${fmtDia(m.targetDate)}, há ${atraso} dias`] });
    } else if (new Date(m.targetDate).getTime() <= hoje.getTime() + 7 * DIA) {
      itens.push({ ...base, key: `marco:${m.id}`, passo: `Marco em ${fmtDia(m.targetDate)}`, gravidade: "normal", fatos: [] });
    }
  }
  return itens;
}

/* ── Insights: comparacao pronta, nunca tarefa ── */

function pct(atual: number, anterior: number): number | null {
  if (anterior <= 0) return null;
  return Math.round(((atual - anterior) / anterior) * 100);
}

function tendencia(v: number | null): Insight["tendencia"] {
  if (v === null) return "sem-base";
  if (v > 3) return "sobe";
  if (v < -3) return "cai";
  return "igual";
}

export function insightsDoCliente(f: FatosDoCliente, hoje: Date): Insight[] {
  const out: Insight[] = [];
  if (f.servicos.social) {
    const porConta = new Map<string, typeof f.metricas>();
    for (const m of f.metricas) porConta.set(m.accountId, [...(porConta.get(m.accountId) ?? []), m]);
    for (const [conta, lista] of porConta) {
      const ord = [...lista].sort((a, b) => b.weekStart.localeCompare(a.weekStart));
      const [s0, s1, s2] = ord;
      if (!s0 || s0.reach === null) continue;
      const anteriores = [s1?.reach, s2?.reach].filter((x): x is number => typeof x === "number");
      const v = s1?.reach != null ? pct(s0.reach, s1.reach) : null;
      const sufixo = porConta.size > 1 ? ` (${conta.slice(-4)})` : "";
      out.push({ key: `reach:${conta}`, clientId: f.clientId, frente: "social", titulo: `Alcance${sufixo}`, atual: s0.reach, anteriores, variacao: v, tendencia: tendencia(v), texto: anteriores.length ? `${s0.reach} nesta semana, ${anteriores.join(" e ")} nas anteriores${v !== null ? ` (${v > 0 ? "+" : ""}${v}%)` : ""}` : `${s0.reach} nesta semana, sem base anterior` });
    }
  }
  if (f.servicos.trafego && f.campanhas.length) {
    const a = somaJanela(f, hoje, 7, 0);
    const b = somaJanela(f, hoje, 14, 7);
    if (a.spend > 0 || b.spend > 0) {
      const v = pct(a.leads, b.leads);
      out.push({ key: "ads:leads", clientId: f.clientId, frente: "trafego", titulo: "Leads (7 dias)", atual: a.leads, anteriores: [b.leads], variacao: v, tendencia: tendencia(v), texto: `${a.leads} leads com R$ ${a.spend.toFixed(0)}, antes ${b.leads} com R$ ${b.spend.toFixed(0)}${v !== null ? ` (${v > 0 ? "+" : ""}${v}%)` : ""}` });
    }
  }
  return out;
}

/* ── Rituais da semana ── */

export const RITUAIS: Array<{ key: RitualKey; rotulo: string }> = [
  { key: "segunda", rotulo: "Segunda · rota da semana" },
  { key: "quarta", rotulo: "Quarta · meio de semana" },
  { key: "sexta", rotulo: "Sexta · prova de movimento" },
];

export function rituaisDoCliente(f: FatosDoCliente): RitualDaSemana[] {
  return RITUAIS.map((r) => {
    const marcado = f.rituais.find((x) => x.key === r.key);
    return { key: r.key, rotulo: r.rotulo, feito: Boolean(marcado), fonte: marcado?.source, doneAt: marcado?.doneAt ?? null };
  });
}

/* ── Montagem ── */

const ORDEM_GRAVIDADE: Record<Gravidade, number> = { urgente: 0, atencao: 1, normal: 2 };
const ORDEM_FONTE: Record<EsteiraItem["fonte"], number> = { onboarding: 0, post: 1, agenda: 2, anuncio: 3, marco: 4, tarefa: 5, checklist: 6 };

export function montarEsteira(f: FatosDoCliente, hoje: Date = new Date()): EsteiraDoCliente {
  const onb = itensDeOnboarding(f, hoje);
  const brutos: EsteiraItem[] = [
    ...onb.itens,
    ...f.posts.map((p) => itemDoPost(f, p, hoje)).filter((x): x is EsteiraItem => x !== null),
    ...itensDaAgenda(f, hoje, onb.completo),
    ...itensDeAnuncios(f, hoje, onb.completo),
    ...itensDeMarcos(f, hoje),
    ...itensDeTarefas(f, hoje),
    ...itensDeChecklists(f),
  ];

  const itens: EsteiraItem[] = [];
  const feitos: EsteiraItem[] = [];
  for (const it of brutos) {
    const e = f.estados[it.key];
    if (!e) { itens.push(it); continue; }
    const comEstado = { ...it, estado: { status: e.status, note: e.note, doneAt: e.doneAt } };
    if (e.status === "done") feitos.push(comEstado);
    // snoozed / ignored: some da lista desta semana
  }
  // Onboarding e uma FASE: fica no topo e na ordem do catalogo, nunca
  // embaralhado por gravidade (logo travado atras do nome continua depois do nome).
  itens.sort((a, b) => {
    const aOnb = a.fonte === "onboarding" ? 0 : 1;
    const bOnb = b.fonte === "onboarding" ? 0 : 1;
    if (aOnb !== bOnb) return aOnb - bOnb;
    if (aOnb === 0) return (a.ordem ?? 0) - (b.ordem ?? 0);
    return ORDEM_GRAVIDADE[a.gravidade] - ORDEM_GRAVIDADE[b.gravidade] || ORDEM_FONTE[a.fonte] - ORDEM_FONTE[b.fonte] || a.titulo.localeCompare(b.titulo);
  });

  const resumo = { urgentes: 0, atencao: 0, normais: 0, total: itens.length };
  for (const it of itens) {
    if (it.gravidade === "urgente") resumo.urgentes++;
    else if (it.gravidade === "atencao") resumo.atencao++;
    else resumo.normais++;
  }

  return { clientId: f.clientId, itens, feitos, insights: insightsDoCliente(f, hoje), rituais: rituaisDoCliente(f), onboardingCompleto: onb.completo, resumo };
}

/** Filtra a esteira pela frente da aba: social ve social + geral; trafego ve
    trafego + geral. Trafego nunca herda item de social, e vice-versa. */
export function itensDaFrente(e: EsteiraDoCliente, frente: "social" | "trafego"): EsteiraItem[] {
  return e.itens.filter((it) => it.frente === frente || it.frente === "geral");
}
