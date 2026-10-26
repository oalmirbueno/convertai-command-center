/**
 * Vigia do calendário (26/10/2026). Dono: "não pode o cliente ficar sem postar mais de 3 dias"; "já tem que
 * preparar algo e me avisar para eu fazer o conteúdo (quem gera com IA nas Mesas sou eu)"; "enxuto".
 *
 * Tudo aqui é código, sem IA e sem rede: os fatos chegam de public.vigia_calendario_fatos() (um objeto por
 * cliente ativo com social) e saem a medida, o estado (um por cliente), a pauta pronta escolhida entre o que
 * a busca da semana já trouxe (mesa_hypes: hype e em alta no nicho, com tema, gancho, lâminas e legenda), a
 * mistura de formatos e o texto da UMA tarefa "Cliente · Conteúdo · preparar N posts até dd/mm".
 *
 * Estados (o mais grave manda; os outros viram motivos):
 *   sem_post_agendado   nenhum post nos próximos 14 dias
 *   vai_ficar_sem_post  o calendário passa de 3 dias sem post nos próximos 7 dias
 *   atrasado            agendado que passou da hora e não saiu
 *   abaixo_do_plano     menos posts nos próximos 14 dias do que o plano pede (meta por semana x 2)
 *   em_dia
 *
 * Sem import de Deno nem de npm: a função e o Vitest leem este arquivo. Sem travessão.
 */

import { NOTA_MINIMA_DO_HYPE, validadeEmDias } from "./hype-no-conteudo.ts";

export const DIAS_MAXIMOS_SEM_POST = 3;
export const META_PADRAO_POR_SEMANA = 3;
/** Quantos dias à frente a vigia olha para dizer se o cliente vai ficar sem post. */
export const JANELA_DO_BURACO = 7;
/** Quantas pautas prontas, no máximo, vão para a tarefa. */
export const MAX_PAUTAS = 6;
/** Reprepara o mesmo cliente só depois disso (ou quando a falta cresce). */
export const DIAS_ENTRE_PREPAROS = 5;
/** Agendado que passou da hora: dentro disso o promotor de todo minuto cuida; depois, só a vigia (uma vez). */
export const HORAS_DO_PROMOTOR = 6;
export const DIAS_MAXIMOS_PARA_PUBLICAR_ATRASADO = 7;

export type EstadoDoCalendario = "em_dia" | "sem_post_agendado" | "vai_ficar_sem_post" | "atrasado" | "abaixo_do_plano";

export type AtrasadoDosFatos = {
  id: string;
  post_id?: string | null;
  titulo: string;
  quando: string;
  status: "scheduled" | "planned" | string;
  tipo?: string | null;
  plataforma?: string | null;
  conta: boolean;
  liberada: boolean;
  segurada: boolean;
  job?: string | null;
  job_erro?: string | null;
  tentativa?: string | null;
};

export type HypeDosFatos = {
  semana: string;
  tipo: "hype" | "nicho" | string;
  titulo: string;
  janela?: string | null;
  formato?: string | null;
  nota?: number | null;
  por_que_agora?: string | null;
  pauta?: { tema?: unknown; gancho?: unknown; laminas?: unknown; legenda?: unknown } | null;
};

export type FatosDoCliente = {
  client_id: string;
  nome: string;
  plano?: string | null;
  posts_por_mes?: number | null;
  fim_de_semana?: boolean | null;
  ultimo_post?: string | null;
  futuros: Array<{ dia: string; n: number; aprovados?: number }>;
  atrasados: AtrasadoDosFatos[];
  publicados_mes?: number | null;
  agendados_mes?: number | null;
  temas_na_agenda?: string[] | null;
  hype_desta_semana?: boolean | null;
  hypes?: HypeDosFatos[] | null;
  ruins?: Array<{ titulo: string; alcance?: number | null; mediana?: number | null; dia?: string | null }> | null;
  projeto_id?: string | null;
  tarefa?: { id: string; project_id: string; titulo: string; status: string; descricao?: string | null; due_date?: string | null } | null;
  saldo_usd?: number | null;
  autor?: string | null;
  estado_anterior?: {
    estado?: string | null;
    preparo?: string | null;
    preparado_em?: string | null;
    faltam?: number | null;
    em_risco_desde?: string | null;
    pautas?: Pauta[] | null;
    custo_usd?: number | null;
  } | null;
};

export type Medida = {
  meta_semana: number;
  meta_fonte: "plano" | "padrao";
  meta_mes: number;
  dias_sem_post: number | null;
  prox7: number;
  prox14: number;
  /** Primeiro dia (nos próximos 14) em que o cliente passa de 3 dias sem post; null se não passa. */
  buraco_em: string | null;
  pct_mes: number | null;
};

export type Classificacao = {
  estado: EstadoDoCalendario;
  /** A frase do estado, como o dono pediu ("vai ficar 3 dias sem post em 29/10"). */
  situacao: string;
  motivos: string[];
  faltam: number;
  preparar_ate: string | null;
};

export type Pauta = {
  tema: string;
  gancho: string;
  formato: "carrossel" | "estatico" | "foto" | "video";
  legenda: string;
  laminas: string[];
  origem: "hype" | "nicho";
  /** O assunto em alta de onde veio (titulo do item da busca). */
  assunto: string;
  nota: number | null;
};

// ------------------------------------------------------------------ datas (AAAA-MM-DD, sem fuso)

const DIA_MS = 86_400_000;
const meio = (d: string) => Date.parse(`${String(d).slice(0, 10)}T12:00:00Z`);
export const somarDias = (d: string, n: number) => new Date(meio(d) + n * DIA_MS).toISOString().slice(0, 10);
export const diasEntre = (de: string, ate: string) => Math.round((meio(ate) - meio(de)) / DIA_MS);
export const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const diasNoMes = (d: string) => new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).getUTCDate();
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

// ------------------------------------------------------------------ medida

/** A meta por semana: "posts por mês" do cliente (Entrega) quando há; senão 3, o padrão da casa. */
export function metaDoCliente(postsPorMes: number | null | undefined): { meta: number; fonte: "plano" | "padrao" } {
  const n = Number(postsPorMes);
  if (Number.isFinite(n) && n > 0) return { meta: Math.max(1, Math.min(7, Math.round((n * 7) / 30))), fonte: "plano" };
  return { meta: META_PADRAO_POR_SEMANA, fonte: "padrao" };
}

/**
 * Primeiro dia em que o cliente passa de DIAS_MAXIMOS_SEM_POST dias sem post, olhando `janela` dias a partir
 * de hoje: cada dia com post agendado zera a conta; sem post nenhum, hoje já é buraco (se não houver post hoje).
 */
export function primeiroBuraco(hoje: string, ultimoPost: string | null | undefined, diasComPost: Set<string>, janela = 14): string | null {
  let ultimo = ultimoPost ? String(ultimoPost).slice(0, 10) : null;
  for (let i = 0; i < janela; i++) {
    const d = somarDias(hoje, i);
    if (diasComPost.has(d)) { ultimo = d; continue; }
    if (ultimo === null) return d;
    if (diasEntre(ultimo, d) > DIAS_MAXIMOS_SEM_POST) return d;
  }
  return null;
}

export function medir(f: FatosDoCliente, hoje: string): Medida {
  const { meta, fonte } = metaDoCliente(f.posts_por_mes);
  const futuros = (f.futuros ?? []).filter((x) => x && x.dia && Number(x.n) > 0);
  const contar = (dias: number) => futuros.filter((x) => x.dia >= hoje && diasEntre(hoje, x.dia) < dias).reduce((a, x) => a + Number(x.n), 0);
  const ultimo = f.ultimo_post ? String(f.ultimo_post).slice(0, 10) : null;
  const metaMes = Number(f.posts_por_mes) > 0 ? Number(f.posts_por_mes) : Math.round((meta * diasNoMes(hoje)) / 7);
  const noMes = Number(f.publicados_mes ?? 0) + Number(f.agendados_mes ?? 0);
  return {
    meta_semana: meta,
    meta_fonte: fonte,
    meta_mes: metaMes,
    dias_sem_post: ultimo ? Math.max(0, diasEntre(ultimo, hoje)) : null,
    prox7: contar(7),
    prox14: contar(14),
    buraco_em: primeiroBuraco(hoje, ultimo, new Set(futuros.map((x) => x.dia)), 14),
    pct_mes: metaMes > 0 ? Math.round((noMes / metaMes) * 100) / 100 : null,
  };
}

// ------------------------------------------------------------------ classificação

/** O agendado que passou da hora e ainda não saiu (a vigia vê a partir de 90 min). */
export function atrasadosDeVerdade(atrasados: AtrasadoDosFatos[] | null | undefined): AtrasadoDosFatos[] {
  return (atrasados ?? []).filter((a) => a && a.id && a.tentativa !== "agendado");
}

export function classificar(m: Medida, f: Pick<FatosDoCliente, "atrasados">, hoje: string): Classificacao {
  const atrasados = atrasadosDeVerdade(f.atrasados);
  const alvo14 = m.meta_semana * 2;
  const buracoPerto = m.buraco_em !== null && diasEntre(hoje, m.buraco_em) < JANELA_DO_BURACO;
  const motivos: string[] = [];
  if (m.dias_sem_post !== null && m.dias_sem_post > DIAS_MAXIMOS_SEM_POST) motivos.push(`${m.dias_sem_post} dias sem post`);
  if (m.dias_sem_post === null) motivos.push("nenhum post publicado ainda");
  if (atrasados.length) {
    const desde = atrasados.map((a) => String(a.quando).slice(0, 10)).sort()[0];
    motivos.push(`${atrasados.length === 1 ? "1 agendado não publicado" : `${atrasados.length} agendados não publicados`} (desde ${ddmm(desde)})`);
  }
  if (m.prox14 === 0) motivos.push("nenhum post agendado nos próximos 14 dias");
  else if (buracoPerto) motivos.push(`vai ficar ${DIAS_MAXIMOS_SEM_POST} dias sem post em ${ddmm(m.buraco_em!)}`);
  if (m.prox14 > 0 && m.prox14 < alvo14) motivos.push(`${m.prox14} de ${alvo14} posts nos próximos 14 dias (plano: ${m.meta_semana} por semana)`);

  let estado: EstadoDoCalendario = "em_dia";
  let situacao = "em dia";
  if (m.prox14 === 0) { estado = "sem_post_agendado"; situacao = "sem post agendado"; }
  else if (buracoPerto) { estado = "vai_ficar_sem_post"; situacao = `vai ficar ${DIAS_MAXIMOS_SEM_POST} dias sem post em ${ddmm(m.buraco_em!)}`; }
  else if (atrasados.length) { estado = "atrasado"; situacao = "atrasado: agendado não publicado"; }
  else if (m.prox14 < alvo14) { estado = "abaixo_do_plano"; situacao = "calendário abaixo do plano"; }
  // Atrasado também quando há buraco: ele aparece no motivo, o buraco manda (é o que faz o cliente sumir).

  let faltam = Math.max(0, alvo14 - m.prox14);
  if (faltam === 0 && buracoPerto) faltam = 1;

  let prepararAte: string | null = null;
  if (faltam > 0) {
    if (m.buraco_em !== null && diasEntre(hoje, m.buraco_em) < 14) {
      // O post precisa estar pronto na véspera do buraco (hoje, se o buraco é hoje ou amanhã).
      const vespera = somarDias(m.buraco_em, -1);
      prepararAte = vespera < hoje ? hoje : vespera;
    } else {
      prepararAte = somarDias(hoje, JANELA_DO_BURACO - 1);
    }
  }
  return { estado, situacao, motivos, faltam, preparar_ate: prepararAte };
}

// ------------------------------------------------------------------ publicar o atrasado

export type DecisaoDoAtrasado = { id: string; acao: "publicar" | "avisar"; motivo: string };

/**
 * O que fazer com cada agendado atrasado. A vigia só PUBLICA o que a regra da casa publicaria: planejado,
 * Instagram, com conta, arte liberada (aprovação), não segurado pela Mesa, ainda não tentado, entre 6 h e
 * 7 dias de atraso. O resto vira aviso com o porquê (nunca publica sem aprovação).
 */
export function decidirAtrasados(atrasados: AtrasadoDosFatos[] | null | undefined, agora: Date): DecisaoDoAtrasado[] {
  return atrasadosDeVerdade(atrasados).map((a) => {
    const horas = (agora.getTime() - Date.parse(a.quando)) / 3_600_000;
    if (a.tentativa === "falhou") return { id: a.id, acao: "avisar", motivo: "a vigia tentou pôr no ar e falhou: confira a conta e publique pelo painel" };
    if (!a.liberada) return { id: a.id, acao: "avisar", motivo: "falta a aprovação da arte" };
    if (!a.conta) return { id: a.id, acao: "avisar", motivo: "falta conectar a conta do Instagram" };
    if (a.segurada) return { id: a.id, acao: "avisar", motivo: "aprovada depois do horário: confirme o novo horário em Publicar em" };
    if (a.status === "scheduled") {
      return { id: a.id, acao: "avisar", motivo: a.job_erro ? `a publicação automática parou: ${a.job_erro}` : "aprovado e agendado, mas não saiu: confira a conexão da conta" };
    }
    if (a.status === "planned" && (a.plataforma ?? "instagram") === "instagram" && horas >= HORAS_DO_PROMOTOR && horas <= DIAS_MAXIMOS_PARA_PUBLICAR_ATRASADO * 24 && !a.tentativa) {
      return { id: a.id, acao: "publicar", motivo: `aprovado, com conta, ${Math.floor(horas)} h atrasado: a vigia põe no ar uma vez` };
    }
    return { id: a.id, acao: "avisar", motivo: "passou da hora sem publicar: confirme se ainda faz sentido e publique pelo painel" };
  });
}

// ------------------------------------------------------------------ pauta pronta

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Comparável: sem acento, caixa e pontuação. */
export const normalizarTema = (s: unknown) => semAcento(String(s ?? "")).replace(/[^a-z0-9]+/g, " ").trim();

/** Mesmo assunto: igual, um contém o outro, ou 3 palavras de 4+ letras em comum. */
export function temaParecido(a: unknown, b: unknown): boolean {
  const x = normalizarTema(a), y = normalizarTema(b);
  if (!x || !y) return false;
  if (x === y || (x.length >= 12 && y.includes(x)) || (y.length >= 12 && x.includes(y))) return true;
  const px = new Set(x.split(" ").filter((p) => p.length >= 4));
  const comuns = y.split(" ").filter((p) => p.length >= 4 && px.has(p));
  return new Set(comuns).size >= 3;
}

const FORMATOS_DA_PAUTA = ["carrossel", "estatico", "foto", "video"] as const;
type FormatoDaPauta = (typeof FORMATOS_DA_PAUTA)[number];
const formatoDoHype = (f: unknown): FormatoDaPauta => {
  const t = normalizarTema(f);
  if (/video|reel/.test(t)) return "video";
  if (/foto/.test(t)) return "foto";
  if (/estatic/.test(t)) return "estatico";
  return "carrossel";
};

/** A sequência de formatos para N posts pela mistura da semana (quantos de cada), repetida se N passar dela. */
export function sequenciaDeFormatos(mix: Partial<Record<FormatoDaPauta, number>> | null | undefined, n: number): FormatoDaPauta[] {
  const base: FormatoDaPauta[] = [];
  const restos: Record<string, number> = {};
  for (const f of FORMATOS_DA_PAUTA) restos[f] = Math.max(0, Math.round(Number(mix?.[f] ?? 0)));
  // Intercala (video, foto, carrossel, estático...) para a semana não sair com dois iguais seguidos.
  for (let guarda = 0; guarda < 20 && Object.values(restos).some((x) => x > 0); guarda++) {
    for (const f of ["video", "foto", "carrossel", "estatico"] as FormatoDaPauta[]) if (restos[f] > 0) { base.push(f); restos[f]--; }
  }
  if (!base.length) return Array.from({ length: Math.max(0, n) }, () => "carrossel");
  return Array.from({ length: Math.max(0, n) }, (_, i) => base[i % base.length]);
}

/** O item da busca ainda vale hoje (validade de hype-no-conteudo) e tem nota boa (sem nota, vale). */
export function hypeValeHoje(h: HypeDosFatos, hoje: string): boolean {
  if (!h || !h.titulo || !h.semana) return false;
  if (typeof h.nota === "number" && h.nota < NOTA_MINIMA_DO_HYPE) return false;
  return diasEntre(String(h.semana).slice(0, 10), hoje) < validadeEmDias({ tipo: h.tipo, janela: h.janela });
}

/**
 * As pautas prontas para preparar `quantas` posts: o que a busca da semana já trouxe para o cliente (sem custo
 * novo), da maior nota para a menor, sem repetir assunto da agenda nem tema que foi mal, nos formatos da
 * mistura do nicho (a pauta de carrossel que cai numa vaga de vídeo vira roteiro de vídeo do mesmo tema).
 */
export function escolherPautas(
  hypes: HypeDosFatos[] | null | undefined,
  opcoes: { hoje: string; quantas: number; temasNaAgenda?: string[] | null; evitar?: string[] | null; formatos?: FormatoDaPauta[] | null },
): Pauta[] {
  const quantas = Math.max(0, Math.min(MAX_PAUTAS, Math.round(opcoes.quantas)));
  if (!quantas) return [];
  const ocupados = [...(opcoes.temasNaAgenda ?? []), ...(opcoes.evitar ?? [])].filter(Boolean);
  const candidatos = (hypes ?? [])
    .filter((h) => hypeValeHoje(h, opcoes.hoje))
    .map((h) => {
      const p = (h.pauta ?? {}) as Record<string, unknown>;
      const tema = String(p.tema ?? h.titulo ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
      return {
        h,
        tema,
        gancho: String(p.gancho ?? "").replace(/\s+/g, " ").trim().slice(0, 140),
        legenda: String(p.legenda ?? "").replace(/\s+/g, " ").trim().slice(0, 400),
        laminas: Array.isArray(p.laminas) ? (p.laminas as unknown[]).map((l) => String(l ?? "").trim()).filter(Boolean).slice(0, 6) : [],
      };
    })
    .filter((c) => c.tema && !ocupados.some((o) => temaParecido(o, c.tema) || temaParecido(o, c.h.titulo)))
    .sort((a, b) => (Number(b.h.nota ?? 0) - Number(a.h.nota ?? 0)) || String(b.h.semana).localeCompare(String(a.h.semana)));

  const escolhidos: typeof candidatos = [];
  for (const c of candidatos) {
    if (escolhidos.length >= quantas) break;
    if (escolhidos.some((e) => temaParecido(e.tema, c.tema) || temaParecido(e.h.titulo, c.h.titulo))) continue;
    escolhidos.push(c);
  }

  // Formatos: cada vaga da mistura pega a pauta cujo formato bate; sobra preenche na ordem.
  const vagas = (opcoes.formatos && opcoes.formatos.length ? opcoes.formatos : escolhidos.map((c) => formatoDoHype(c.h.formato))).slice(0, escolhidos.length);
  const livres = escolhidos.slice();
  const saida: Pauta[] = [];
  for (const vaga of vagas) {
    let i = livres.findIndex((c) => formatoDoHype(c.h.formato) === vaga);
    if (i < 0) i = 0;
    const c = livres.splice(i, 1)[0];
    if (!c) break;
    saida.push({
      tema: c.tema,
      gancho: c.gancho,
      formato: vaga,
      legenda: c.legenda,
      laminas: vaga === "carrossel" ? c.laminas : c.laminas.slice(0, 1),
      origem: c.h.tipo === "nicho" ? "nicho" : "hype",
      assunto: String(c.h.titulo).slice(0, 160),
      nota: typeof c.h.nota === "number" ? c.h.nota : null,
    });
  }
  return saida;
}

// ------------------------------------------------------------------ preparar (quando e quanto)

/**
 * Prepara (com custo de IA, se precisar buscar o que está em alta) só quando há risco real, há falta de post
 * e o último preparo é velho ou ficou pequeno. Atraso sozinho é execução, não pauta.
 */
export function precisaPreparar(c: Classificacao, anterior: FatosDoCliente["estado_anterior"], agora: Date): boolean {
  if (c.estado === "em_dia" || c.faltam <= 0) return false;
  if (!anterior || !anterior.preparado_em) return true;
  if (anterior.preparo === "falhou" || anterior.preparo === "pendente") return true;
  const idade = (agora.getTime() - Date.parse(anterior.preparado_em)) / DIA_MS;
  if (idade >= DIAS_ENTRE_PREPAROS) return true;
  return c.faltam > (anterior.pautas?.length ?? 0) && anterior.preparo !== "sem_saldo" && idade >= 1;
}

/** Severidade para escolher quem prepara primeiro (menor = mais urgente). */
export function urgencia(c: Classificacao, m: Medida): number {
  const peso: Record<EstadoDoCalendario, number> = { sem_post_agendado: 0, vai_ficar_sem_post: 1, atrasado: 2, abaixo_do_plano: 3, em_dia: 9 };
  return peso[c.estado] * 1000 - Math.min(999, m.dias_sem_post ?? 999);
}

// ------------------------------------------------------------------ a tarefa (uma por cliente)

export const ORIGEM_DA_TAREFA = "vigia:calendario";
const ROTULO_DO_FORMATO: Record<FormatoDaPauta, string> = { carrossel: "Carrossel", estatico: "Estático", foto: "Foto", video: "Vídeo (gravar)" };

/** "Cliente · Conteúdo · preparar N posts até dd/mm" (ou o atraso, quando é só isso). */
export function tituloDaTarefa(cliente: string, c: Classificacao, atrasados: number): string {
  const nome = String(cliente || "Cliente").replace(/\s+/g, " ").trim().slice(0, 60);
  if (c.faltam > 0 && c.preparar_ate) return `${nome} · Conteúdo · preparar ${plural(c.faltam, "post", "posts")} até ${ddmm(c.preparar_ate)}`;
  if (atrasados > 0) return `${nome} · Conteúdo · resolver ${plural(atrasados, "agendado que não saiu", "agendados que não saíram")}`;
  return `${nome} · Conteúdo · calendário em dia`;
}

/** O texto da tarefa: enxuto, o que fazer primeiro. */
export function descricaoDaTarefa(args: {
  clientId: string;
  classificacao: Classificacao;
  medida: Medida;
  ultimoPost: string | null | undefined;
  pautas: Pauta[];
  ruins?: Array<{ titulo: string }> | null;
  atrasados?: Array<{ titulo: string; quando: string; motivo: string }> | null;
  preparo?: string | null;
}): string {
  const { classificacao: c, medida: m } = args;
  const linhas: string[] = [];
  linhas.push(`Situação: ${c.situacao}${c.motivos.length ? ` (${c.motivos.join("; ")})` : ""}.`);
  linhas.push(`Último post: ${args.ultimoPost ? ddmm(String(args.ultimoPost)) : "nenhum"} · próximos 14 dias: ${m.prox14} de ${m.meta_semana * 2} · meta ${m.meta_semana} por semana${m.meta_fonte === "padrao" ? " (padrão; ajuste em Posts por mês na Entrega)" : ""}.`);
  if (args.pautas.length) {
    linhas.push("");
    linhas.push("Pauta pronta (em alta agora; gere e aprove nas Mesas):");
    args.pautas.forEach((p, i) => {
      linhas.push(`${i + 1}. [${ROTULO_DO_FORMATO[p.formato]}] ${p.tema}${p.gancho ? ` · gancho: "${p.gancho}"` : ""}`);
      if (p.legenda) linhas.push(`   legenda: ${p.legenda}`);
    });
    if (args.pautas.length < c.faltam) linhas.push(`Faltam ${c.faltam - args.pautas.length}: use Propor temas no Mês.`);
  } else if (c.faltam > 0) {
    linhas.push("");
    linhas.push(args.preparo === "sem_saldo"
      ? "Sem pauta pronta: a carteira de IA do cliente está sem saldo para buscar o que está em alta. Use Propor temas no Mês depois de recarregar."
      : "Sem pauta pronta ainda: use Propor temas no Mês.");
  }
  const ruins = (args.ruins ?? []).filter((r) => r && r.titulo).slice(0, 3);
  if (ruins.length) linhas.push(`Evitar (foram mal, alcance abaixo da metade do normal): ${ruins.map((r) => `"${String(r.titulo).slice(0, 60)}"`).join(", ")}.`);
  const atrasados = (args.atrasados ?? []).slice(0, 3);
  for (const a of atrasados) linhas.push(`Atrasado: "${a.titulo.slice(0, 80)}" de ${ddmm(String(a.quando).slice(0, 10))}: ${a.motivo}.`);
  linhas.push("");
  linhas.push(`Abrir: /mesa?client=${args.clientId}`);
  return linhas.join("\n").slice(0, 3800);
}

/** A sugestão de uma linha para o resumo do dia. */
export function sugestaoDoResumo(pautas: Pauta[], decisoes: DecisaoDoAtrasado[]): string | null {
  const publicar = decisoes.find((d) => d.acao === "publicar");
  if (publicar) return "a vigia pôs no ar o agendado aprovado que tinha atrasado";
  if (pautas.length) return `pauta pronta: ${pautas.slice(0, 2).map((p) => `${ROTULO_DO_FORMATO[p.formato]} "${p.tema}"`).join(" e ")}${pautas.length > 2 ? ` (+${pautas.length - 2})` : ""}`;
  const aviso = decisoes.find((d) => d.acao === "avisar");
  return aviso ? aviso.motivo : null;
}
