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
  Leitura,
  Numero,
  PlataformaAds,
  PlataformaResumo,
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
  { key: "anuncios", rotulo: "Conta de anúncios", passo: "Criar e conectar a conta de anúncios", auto: (f) => conectado(f, "meta_ads", "ads", "google_ads") || (f.contasAds ?? []).some((c) => c.ativa), depende: "instagram", soSe: "trafego", rota: "/clientes" },
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

// Data sem hora (yyyy-mm-dd) e formatada pelas partes: passar por new Date()
// joga para UTC e, no fuso do Brasil, 12/09 vira 11/09 as 21h.
const SO_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

const fmtDia = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const m = SO_DATA.exec(iso);
  if (m) return `${m[3]}/${m[2]}`;
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
};

function diasDesde(iso: string | null, hoje: Date): number | null {
  if (!iso) return null;
  // Data sem hora conta a partir do meio-dia UTC, para o arredondamento
  // nao trocar o dia na virada do fuso.
  const t = SO_DATA.test(iso) ? new Date(`${iso}T12:00:00Z`).getTime() : new Date(iso).getTime();
  return Math.floor((hoje.getTime() - t) / DIA);
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

function somaJanela(f: FatosDoCliente, hoje: Date, deDias: number, ateDias: number, plataforma?: PlataformaAds): { spend: number; leads: number; compras: number; valorCompras: number } {
  const ini = hoje.getTime() - deDias * DIA;
  const fim = hoje.getTime() - ateDias * DIA;
  const out = { spend: 0, leads: 0, compras: 0, valorCompras: 0 };
  for (const c of f.campanhas) {
    if (plataforma && c.plataforma !== plataforma) continue;
    for (const d of c.diario) {
      const t = new Date(d.day).getTime();
      if (t >= ini && t < fim) {
        out.spend += d.spend;
        out.leads += d.leads;
        out.compras += d.compras;
        out.valorCompras += d.valorCompras;
      }
    }
  }
  return out;
}

/* ── Vendas: registradas a mao + rastreadas pela plataforma, numa janela ── */

export interface ResumoDeVendas {
  /** Vendas registradas a mao (quantidade). */
  registradas: number;
  /** Compras rastreadas pela plataforma (pixel). */
  rastreadas: number;
  /** Total: registradas + rastreadas. */
  total: number;
  /** Receita conhecida (soma dos valores informados + valor rastreado). */
  receita: number;
  /** Quantas vendas registradas vieram sem valor. */
  semValor: number;
  porCampanha: Array<{ nome: string; vendas: number; receita: number }>;
  porCanal: Array<{ canal: string; vendas: number }>;
}

export function resumoDeVendas(f: FatosDoCliente, hoje: Date, deDias: number, ateDias: number, plataforma?: PlataformaAds): ResumoDeVendas {
  const ini = hoje.getTime() - deDias * DIA;
  const fim = hoje.getTime() - ateDias * DIA;
  const out: ResumoDeVendas = { registradas: 0, rastreadas: 0, total: 0, receita: 0, semValor: 0, porCampanha: [], porCanal: [] };
  const porCampanha = new Map<string, { nome: string; vendas: number; receita: number }>();
  const porCanal = new Map<string, number>();
  for (const v of f.vendas) {
    if (plataforma && v.plataforma !== plataforma) continue;
    const t = new Date(`${v.data}T12:00:00Z`).getTime();
    if (t < ini || t >= fim) continue;
    out.registradas += v.quantidade;
    if (v.valor === null) out.semValor += 1; else out.receita += v.valor;
    const nome = v.campanhaNome ?? "Sem campanha";
    const c = porCampanha.get(nome) ?? { nome, vendas: 0, receita: 0 };
    c.vendas += v.quantidade;
    c.receita += v.valor ?? 0;
    porCampanha.set(nome, c);
    porCanal.set(v.canal, (porCanal.get(v.canal) ?? 0) + v.quantidade);
  }
  for (const c of f.campanhas) {
    if (plataforma && c.plataforma !== plataforma) continue;
    let vendas = 0; let receita = 0;
    for (const d of c.diario) {
      const t = new Date(d.day).getTime();
      if (t >= ini && t < fim) { vendas += d.compras; receita += d.valorCompras; }
    }
    if (vendas > 0) {
      out.rastreadas += vendas;
      out.receita += receita;
      const x = porCampanha.get(c.nome) ?? { nome: c.nome, vendas: 0, receita: 0 };
      x.vendas += vendas; x.receita += receita;
      porCampanha.set(c.nome, x);
    }
  }
  out.total = out.registradas + out.rastreadas;
  out.porCampanha = [...porCampanha.values()].sort((a, b) => b.vendas - a.vendas || b.receita - a.receita);
  out.porCanal = [...porCanal.entries()].map(([canal, vendas]) => ({ canal, vendas })).sort((a, b) => b.vendas - a.vendas);
  return out;
}

/* ── Plataformas de anuncio: o que esta ligado, o que falta configurar ── */

const PLATAFORMAS_CONHECIDAS: Array<{ key: PlataformaAds; rotulo: string }> = [
  { key: "meta_ads", rotulo: "Meta Ads" },
  { key: "google_ads", rotulo: "Google Ads" },
  { key: "tiktok_ads", rotulo: "TikTok Ads" },
];

export function plataformasDoCliente(f: FatosDoCliente, hoje: Date = new Date()): PlataformaResumo[] {
  return PLATAFORMAS_CONHECIDAS.map((p) => {
    const contas = f.contasAds.filter((c) => c.plataforma === p.key);
    const campanhas = f.campanhas.filter((c) => c.plataforma === p.key);
    const ativas = campanhas.filter((c) => c.ativa).length;
    const vendas7d = resumoDeVendas(f, hoje, 7, 0, p.key).total;
    const estado: PlataformaResumo["estado"] = contas.length === 0
      ? "nao-configurada"
      : contas.some((c) => c.ativa) ? (campanhas.length > 0 ? "ativa" : "ligada") : "pausada";
    return { key: p.key, rotulo: p.rotulo, estado, contas: contas.length, campanhas: campanhas.length, ativas, vendas7d };
  });
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
      itens.push({ ...base, key: `camp:${c.id}:parado`, titulo: c.nome, passo: "Dados parados, conferir a campanha", gravidade: "atencao", fatos: [parado === null ? "Sem dado nenhum" : `Último dado há ${parado} dias`], plataforma: c.plataforma });
      continue;
    }
    const freq = Math.max(...c.diario.filter((d) => new Date(d.day).getTime() >= hoje.getTime() - 7 * DIA).map((d) => d.frequency ?? 0), 0);
    if (freq >= 3.5) {
      itens.push({ ...base, key: `camp:${c.id}:saturada`, titulo: c.nome, passo: "Criativo saturado, trocar o criativo", gravidade: "atencao", fatos: [`Frequência ${freq.toFixed(1)}`], plataforma: c.plataforma });
    }
    const g = c.diario.filter((d) => new Date(d.day).getTime() >= hoje.getTime() - 7 * DIA).reduce((a, d) => ({ spend: a.spend + d.spend, leads: a.leads + d.leads }), { spend: 0, leads: 0 });
    if (g.spend > 0 && g.leads === 0) {
      itens.push({ ...base, key: `camp:${c.id}:sem-lead`, titulo: c.nome, passo: "Gastou sem trazer lead, conferir", gravidade: "atencao", fatos: [`R$ ${g.spend.toFixed(0)} em 7 dias, 0 leads`], plataforma: c.plataforma });
    }
  }

  if (agora7.spend > 0 && antes7.spend > 0 && agora7.leads < antes7.leads) {
    itens.push({ ...base, key: "ads:semana-pior", titulo: "Semana", passo: "Anúncios piores que a semana passada, revisar", gravidade: "atencao", fatos: [`${agora7.leads} leads agora, ${antes7.leads} antes`] });
  }
  return itens;
}

/* ── Tarefas, checklists e marcos: o trabalho real do dia a dia ── */

const TAREFAS_VISIVEIS = 10;
const CONCLUIDA = new Set(["done", "completed", "concluida", "concluída"]);

export function tarefaConcluida(status: string | null): boolean {
  return CONCLUIDA.has((status ?? "").toLowerCase());
}

/** Segunda-feira (ISO) da semana que contem a data. */
export function segundaDe(d: Date): string {
  const x = new Date(d);
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x.toISOString().slice(0, 10);
}

function somaDias(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * A semana de tarefas: atrasadas (urgente), as que vencem nesta semana
 * (normal), as da proxima semana (para ja enxergar), e as sem dono. O que
 * nao tem prazo e tem dono fica no Kanban; aqui e o que pede a semana.
 */
export function itensDeTarefas(f: FatosDoCliente, hoje: Date, weekStart: string): EsteiraItem[] {
  const hojeStr = hoje.toISOString().slice(0, 10);
  const fimSemana = somaDias(weekStart, 6);
  const fimProxima = somaDias(weekStart, 13);
  const abertas = f.tarefas.filter((t) => !tarefaConcluida(t.status) && (t.status ?? "").toLowerCase() !== "cancelled");
  const itens: EsteiraItem[] = [];
  for (const t of abertas) {
    const base = { clientId: f.clientId, frente: "geral" as Frente, fonte: "tarefa" as const, titulo: t.titulo, rota: "/kanban", vencimento: t.dueDate ?? undefined, key: `task:${t.id}` };
    if (t.dueDate && t.dueDate < hojeStr) {
      const atraso = diasDesde(t.dueDate, hoje) ?? 0;
      itens.push({ ...base, passo: "Tarefa atrasada", gravidade: "urgente", fatos: [`Venceu há ${atraso} dia${atraso === 1 ? "" : "s"}`] });
    } else if (t.dueDate && t.dueDate <= fimSemana) {
      itens.push({ ...base, passo: `Entregar até ${fmtDia(t.dueDate)}`, gravidade: "normal", fatos: ["Nesta semana"] });
    } else if (t.dueDate && t.dueDate <= fimProxima) {
      itens.push({ ...base, passo: `Próxima semana, ${fmtDia(t.dueDate)}`, gravidade: "normal", fatos: ["Já dá para adiantar"] });
    } else if (!t.assignedTo) {
      itens.push({ ...base, passo: "Sem responsável, definir dono", gravidade: "atencao", fatos: [] });
    }
  }
  const ordem: Record<Gravidade, number> = { urgente: 0, atencao: 1, normal: 2 };
  itens.sort((a, b) => ordem[a.gravidade] - ordem[b.gravidade] || (a.vencimento ?? "9999").localeCompare(b.vencimento ?? "9999"));
  if (itens.length > TAREFAS_VISIVEIS) {
    const resto = itens.length - TAREFAS_VISIVEIS;
    const visiveis = itens.slice(0, TAREFAS_VISIVEIS);
    visiveis.push({ clientId: f.clientId, frente: "geral", fonte: "tarefa", key: "task:mais", titulo: `Mais ${resto} tarefa${resto === 1 ? "" : "s"}`, passo: "Ver no Kanban", gravidade: "normal", fatos: [], rota: "/kanban" });
    return visiveis;
  }
  return itens;
}

/**
 * O que o painel prova sozinho nesta semana: post que foi ao ar e tarefa
 * concluida. Entram em "feitos" com auto=true, sem ninguem marcar, e nao se
 * desfazem com o dedo.
 */
export function feitosAutomaticos(f: FatosDoCliente, weekStart: string): EsteiraItem[] {
  const ini = new Date(`${weekStart}T00:00:00Z`).getTime();
  const fim = ini + 7 * DIA;
  const dentro = (iso: string | null) => { if (!iso) return false; const t = new Date(iso).getTime(); return t >= ini && t < fim; };
  const out: EsteiraItem[] = [];
  for (const p of f.posts) {
    const pub = p.publicacoes.find((x) => x.status === "published" && dentro(x.publishedAt));
    if (pub) out.push({ key: `post:${p.id}:publicado`, clientId: f.clientId, frente: "social", fonte: "post", titulo: p.titulo, passo: "Publicado", gravidade: "normal", fatos: [`No ar em ${fmtDia(pub.publishedAt)}`], estado: { status: "done", doneAt: pub.publishedAt, auto: true } });
  }
  for (const t of f.tarefas) {
    if (tarefaConcluida(t.status) && dentro(t.updatedAt)) {
      out.push({ key: `task:${t.id}`, clientId: f.clientId, frente: "geral", fonte: "tarefa", titulo: t.titulo, passo: "Concluída", gravidade: "normal", fatos: [`Em ${fmtDia(t.updatedAt)}`], estado: { status: "done", doneAt: t.updatedAt, auto: true } });
    }
  }
  return out;
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

/* ── Leitura de numeros por frente: seguidores de verdade, o que subiu,
      o que parou, o que caiu, e o que fazer por causa disso ── */

function numero(rotulo: string, atual: number | null, anterior: number | null, formato: Numero["formato"] = "int"): Numero {
  const v = atual !== null && anterior !== null ? pct(atual, anterior) : null;
  return { rotulo, atual, anterior, variacao: v, tendencia: atual !== null && anterior !== null && anterior === 0 && atual > 0 ? "sobe" : tendencia(v), formato };
}

function fmtNum(n: number | null, formato: Numero["formato"]): string {
  if (n === null) return "–";
  if (formato === "brl") return `R$ ${n.toFixed(0)}`;
  if (formato === "dec") return n.toFixed(1);
  return String(Math.round(n));
}

function classificar(nums: Numero[], out: Leitura): void {
  for (const n of nums) {
    const linha = `${n.rotulo}: ${fmtNum(n.atual, n.formato)}${n.anterior !== null ? ` (antes ${fmtNum(n.anterior, n.formato)}${n.variacao !== null ? `, ${n.variacao > 0 ? "+" : ""}${n.variacao}%` : ""})` : ""}`;
    if (n.tendencia === "sobe") out.subiu.push(linha);
    else if (n.tendencia === "cai") out.caiu.push(linha);
    else if (n.tendencia === "igual") out.parado.push(linha);
  }
}

export function leiturasDoCliente(f: FatosDoCliente, hoje: Date, itens: EsteiraItem[]): Leitura[] {
  const out: Leitura[] = [];

  if (f.servicos.social && f.metricas.length) {
    // Uma conta so (a principal): a de mais seguidores. Contas extras
    // continuam no insight de alcance do card, sem poluir a leitura.
    const porConta = new Map<string, typeof f.metricas>();
    for (const m of f.metricas) porConta.set(m.accountId, [...(porConta.get(m.accountId) ?? []), m]);
    const principal = [...porConta.values()].sort((a, b) => (Math.max(...b.map((x) => x.followers ?? 0)) - Math.max(...a.map((x) => x.followers ?? 0))))[0];
    const ord = [...principal].sort((a, b) => b.weekStart.localeCompare(a.weekStart));
    const [s0, s1] = ord;
    if (s0) {
      const nums = [
        numero("Seguidores", s0.followers, s1?.followers ?? null),
        numero("Alcance", s0.reach, s1?.reach ?? null),
        numero("Interações", s0.interactions, s1?.interactions ?? null),
      ];
      const l: Leitura = { frente: "social", numeros: nums, subiu: [], parado: [], caiu: [], fazer: [], periodo: s1 ? `semana de ${fmtDia(s0.weekStart)} contra ${fmtDia(s1.weekStart)}` : `semana de ${fmtDia(s0.weekStart)}` };
      classificar(nums, l);
      // O que fazer nasce do numero + do que a esteira ja sabe.
      const agendados = f.posts.flatMap((p) => p.publicacoes.filter((x) => x.status === "scheduled" && x.scheduledAt && new Date(x.scheduledAt).getTime() >= hoje.getTime())).length;
      const alc = nums[1]; const seg = nums[0]; const inter = nums[2];
      if (alc.tendencia === "cai") l.fazer.push(agendados < 2 ? "Alcance caiu e a agenda está curta: dar data para pelo menos 2 posts e priorizar Reels." : "Alcance caiu com posts agendados: trocar o formato dos próximos 2 (Reels ou carrossel com gancho no primeiro slide).");
      if (seg.tendencia === "igual" || seg.tendencia === "cai") l.fazer.push("Seguidores parados: 1 conteúdo de conversão por semana (colab, sorteio simples ou CTA de seguir no fim do Reel).");
      if (inter.tendencia === "cai") l.fazer.push("Interações caíram: responder todos os comentários em até 24h e puxar pergunta na legenda.");
      if (itens.some((i) => i.key === "agenda:vazia")) l.fazer.push("Agenda vazia: colocar posts antes de qualquer outra coisa.");
      const recusados = itens.filter((i) => i.key.endsWith(":refazer"));
      if (recusados.length) l.fazer.push(`Refazer ${recusados.length === 1 ? "a arte recusada" : `${recusados.length} artes recusadas`} e reenviar (${recusados.map((i) => i.titulo).slice(0, 2).join(", ")}).`);
      if (l.fazer.length === 0 && (alc.tendencia === "sobe" || inter.tendencia === "sobe")) l.fazer.push("Subiu: repetir o formato do post que mais alcançou nesta semana.");
      out.push(l);
    }
  }

  if (f.servicos.trafego && f.campanhas.length) {
    // Uma leitura por plataforma com campanha: Meta nao se mistura com Google.
    const plataformas = [...new Set(f.campanhas.map((c) => c.plataforma))];
    for (const p of plataformas) {
      const a = somaJanela(f, hoje, 7, 0, p);
      const b = somaJanela(f, hoje, 14, 7, p);
      if (a.spend === 0 && b.spend === 0) continue;
      const va = resumoDeVendas(f, hoje, 7, 0, p);
      const vb = resumoDeVendas(f, hoje, 14, 7, p);
      const cplA = a.leads > 0 ? a.spend / a.leads : null;
      const cplB = b.leads > 0 ? b.spend / b.leads : null;
      const cpvA = va.total > 0 ? a.spend / va.total : null;
      const cpvB = vb.total > 0 ? b.spend / vb.total : null;
      const ativas = f.campanhas.filter((c) => c.plataforma === p && c.ativa).length;
      const nums: Numero[] = [
        numero("Leads (7d)", a.leads, b.leads),
        numero("Vendas (7d)", va.total, vb.total),
        numero("Gasto (7d)", a.spend, b.spend, "brl"),
        numero("Custo por lead", cplA, cplB, "brl"),
        numero("Custo por venda", cpvA, cpvB, "brl"),
        { rotulo: "Campanhas ativas", atual: ativas, anterior: null, variacao: null, tendencia: "sem-base" as const, formato: "int" as const },
      ];
      if (va.receita > 0 || vb.receita > 0) nums.splice(2, 0, numero("Receita (7d)", va.receita, vb.receita, "brl"));
      const l: Leitura = { frente: "trafego", plataforma: p, numeros: nums, subiu: [], parado: [], caiu: [], fazer: [], periodo: "últimos 7 dias contra os 7 anteriores" };
      classificar(nums, l);
      const leads = nums[0]; const vendas = nums[1];
      const gasto = nums.find((n) => n.rotulo === "Gasto (7d)") as Numero;
      const cpl = nums.find((n) => n.rotulo === "Custo por lead") as Numero;
      const cpv = nums.find((n) => n.rotulo === "Custo por venda") as Numero;
      const meus = itens.filter((i) => i.fonte === "anuncio" && (!i.plataforma || i.plataforma === p));
      // Vendas primeiro: e o numero que paga o anuncio.
      if (a.leads > 0 && va.total === 0) l.fazer.push(`${a.leads} lead${a.leads === 1 ? "" : "s"} e nenhuma venda em 7 dias: conferir o atendimento (tempo de resposta e proposta) e registrar aqui cada venda que fechar.`);
      if (vendas.tendencia === "sobe" && va.porCampanha[0]) l.fazer.push(`Vendas subiram: escalar 20% a verba de ${va.porCampanha[0].nome} (${va.porCampanha[0].vendas} venda${va.porCampanha[0].vendas === 1 ? "" : "s"} em 7 dias).`);
      if (vendas.tendencia === "cai" && leads.tendencia !== "cai") l.fazer.push("Leads chegam mas vendas caíram: o problema está depois do clique; revisar oferta e atendimento antes de mexer na campanha.");
      if (vendas.tendencia === "cai" && leads.tendencia === "cai") l.fazer.push("Leads e vendas caíram juntos: trocar o criativo e conferir o público da campanha principal.");
      if (cpv.tendencia === "sobe" && va.total > 0) l.fazer.push("Custo por venda subiu: pausar a campanha que gastou sem vender e concentrar verba na que vendeu.");
      if (va.total > 0 && va.porCampanha.length > 1 && ativas > 1) {
        const [c1, c2] = va.porCampanha;
        if (c1.vendas >= 2 * Math.max(1, c2.vendas)) l.fazer.push(`${c1.nome} vende mais que o resto (${c1.vendas} contra ${c2.vendas}): concentrar verba nela.`);
      }
      if (va.semValor > 0) l.fazer.push(`${va.semValor} venda${va.semValor === 1 ? "" : "s"} sem valor: colocar o valor quando souber, para o custo por venda fechar.`);
      if (leads.tendencia === "cai" && gasto.tendencia !== "cai") l.fazer.push("Gastou igual ou mais e trouxe menos lead: pausar a campanha mais fraca e subir um criativo novo.");
      if (cpl.tendencia === "sobe") l.fazer.push("Custo por lead subiu: revisar público e trocar o criativo com frequência mais alta.");
      const saturadas = meus.filter((i) => i.key.endsWith(":saturada"));
      if (saturadas.length) l.fazer.push(`Trocar criativo em ${saturadas.map((i) => i.titulo).slice(0, 2).join(", ")} (saturado).`);
      const semLead = meus.filter((i) => i.key.endsWith(":sem-lead"));
      if (semLead.length) l.fazer.push(`Conferir ${semLead.map((i) => i.titulo).slice(0, 2).join(", ")}: gastou sem lead.`);
      if (itens.some((i) => i.key === "ads:verba-zerada")) l.fazer.push("Verba zerada com campanha no ar: recarregar hoje.");
      if (ativas === 0) l.fazer.push("Nenhuma campanha no ar: ativar ou cadastrar.");
      if (l.fazer.length === 0 && leads.tendencia === "sobe") l.fazer.push("Leads subiram: escalar 20% a verba da campanha que mais converteu.");
      out.push(l);
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

export function montarEsteira(f: FatosDoCliente, hoje: Date = new Date(), weekStart: string = segundaDe(hoje)): EsteiraDoCliente {
  const onb = itensDeOnboarding(f, hoje);
  const brutos: EsteiraItem[] = [
    ...onb.itens,
    ...f.posts.map((p) => itemDoPost(f, p, hoje)).filter((x): x is EsteiraItem => x !== null),
    ...itensDaAgenda(f, hoje, onb.completo),
    ...itensDeAnuncios(f, hoje, onb.completo),
    ...itensDeMarcos(f, hoje),
    ...itensDeTarefas(f, hoje, weekStart),
    ...itensDeChecklists(f),
  ];

  const itens: EsteiraItem[] = [];
  const feitos: EsteiraItem[] = feitosAutomaticos(f, weekStart);
  const jaFeito = new Set(feitos.map((x) => x.key));
  for (const it of brutos) {
    if (jaFeito.has(it.key)) continue;
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

  return { clientId: f.clientId, itens, feitos, insights: insightsDoCliente(f, hoje), leituras: leiturasDoCliente(f, hoje, itens), rituais: rituaisDoCliente(f), onboardingCompleto: onb.completo, resumo };
}

/** Filtra a esteira pela frente da aba: social ve social + geral; trafego ve
    trafego + geral. Trafego nunca herda item de social, e vice-versa. */
export function itensDaFrente(e: EsteiraDoCliente, frente: "social" | "trafego"): EsteiraItem[] {
  return e.itens.filter((it) => it.frente === frente || it.frente === "geral");
}
