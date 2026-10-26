import { nomeDaTarefa, nomeDoCliente } from "@/lib/nomeDaTarefa";

/**
 * Resumo do dia (26/10/2026, decisão do dono: "1 resumo por dia numa tela
 * Hoje + 1 aviso no sino"). A frente SERVIDOR cria a RPC `resumo_do_dia()`;
 * este é o formato que a tela espera. Tudo é lido de forma tolerante: campo
 * ausente vira lista vazia, nunca erro na tela.
 *
 * Formato esperado (jsonb):
 * {
 *   gerado_em: timestamptz,
 *   anuncios: {
 *     mudancas: [{ client_id, cliente, acao, alvo, antes, depois, quem, quando, prova_url }],
 *     alertas:  [{ client_id, cliente, nivel: 'critico'|'atencao'|'info', texto }]
 *   },
 *   calendario: {
 *     clientes_em_risco: [{ client_id, nome, situacao, dias_sem_post, falta, sugestao, em_risco_ha_dias, pct_mes, task_id, link }],
 *     campanhas: [{ client_id, nome, tema, por_que }]   // cliente em dia com hype forte na semana
 *   },
 *   precisa_de_voce: [{ id, tipo: 'aprovacao'|'vinculo'|'mensagem'|'anuncio'|'acesso'|'outro',
 *                       titulo, client_id, cliente, area, motivo, link, link_id, aprovacao_id }],
 *   feito_ontem: [{ id, titulo, client_id, cliente, area, agente, quando, prova_url, link_id }]
 * }
 */

export type NivelDoDia = "critico" | "atencao" | "info";

export interface MudancaDoDia {
  chave: string;
  clientId: string | null;
  cliente: string;
  acao: string;
  alvo: string | null;
  antes: string | null;
  depois: string | null;
  quem: string | null;
  quando: string | null;
  provaUrl: string | null;
}

export interface AlertaDoDia {
  chave: string;
  clientId: string | null;
  cliente: string | null;
  nivel: NivelDoDia;
  texto: string;
}

export interface ClienteEmRisco {
  clientId: string;
  nome: string;
  situacao: string;
  diasSemPost: number | null;
  falta: string | null;
  sugestao: string | null;
  /** Quanto do mês já está pronto no calendário (0 a 100), quando o servidor manda. */
  pctMes: number | null;
  /** Há quantos dias o cliente está em risco. */
  emRiscoHaDias: number | null;
  /** Caminho do painel que o servidor sugere (ex.: a pauta certa). */
  link: string | null;
}

/** Cliente em dia com um hype forte nesta semana: "dá para fazer campanha". */
export interface CampanhaDoDia {
  clientId: string;
  nome: string;
  tema: string;
  porQue: string | null;
}

export type TipoDoPedido = "aprovacao" | "vinculo" | "mensagem" | "anuncio" | "acesso" | "outro";

export interface PedidoDoDia {
  chave: string;
  tipo: TipoDoPedido;
  /** "Cliente · Área · assunto" */
  nome: string;
  motivo: string | null;
  link: string | null;
  linkId: string | null;
  aprovacaoId: string | null;
  clientId: string | null;
}

export interface FeitoDoDia {
  chave: string;
  nome: string;
  agente: string | null;
  quando: string | null;
  provaUrl: string | null;
  linkId: string | null;
}

export interface ResumoDoDia {
  geradoEm: string | null;
  mudancas: MudancaDoDia[];
  alertas: AlertaDoDia[];
  clientesEmRisco: ClienteEmRisco[];
  campanhas: CampanhaDoDia[];
  precisaDeVoce: PedidoDoDia[];
  feitoOntem: FeitoDoDia[];
}

type Cru = Record<string, unknown>;
const obj = (v: unknown): Cru => (v && typeof v === "object" && !Array.isArray(v) ? (v as Cru) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const txt = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
};
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const nivel = (v: unknown): NivelDoDia => {
  const s = String(v || "").toLowerCase();
  if (/crit|urgen|alto/.test(s)) return "critico";
  if (/aten|warn|medio|médio/.test(s)) return "atencao";
  return "info";
};
const TIPOS: TipoDoPedido[] = ["aprovacao", "vinculo", "mensagem", "anuncio", "acesso", "outro"];

export function resumoVazioDoDia(): ResumoDoDia {
  return { geradoEm: null, mudancas: [], alertas: [], clientesEmRisco: [], campanhas: [], precisaDeVoce: [], feitoOntem: [] };
}

/** A RPC pode devolver o objeto, uma linha com o objeto ou um texto JSON. */
export function normalizarResumo(cru: unknown): ResumoDoDia {
  let base: unknown = cru;
  if (typeof base === "string") {
    try { base = JSON.parse(base); } catch { base = null; }
  }
  if (Array.isArray(base)) base = base[0];
  const r = obj(base);
  const interno = r.resumo_do_dia !== undefined ? obj(r.resumo_do_dia) : r;
  const anuncios = obj(interno.anuncios);
  const calendario = obj(interno.calendario);

  const mudancas: MudancaDoDia[] = arr(anuncios.mudancas).map((x, i) => {
    const m = obj(x);
    return {
      chave: txt(m.id) || `m${i}`,
      clientId: txt(m.client_id),
      cliente: nomeDoCliente(txt(m.cliente)),
      acao: txt(m.acao) || txt(m.resumo) || "Mudança",
      alvo: txt(m.alvo) || txt(obj(m.alvo).nome),
      antes: txt(m.antes),
      depois: txt(m.depois),
      quem: txt(m.quem) || txt(m.operator),
      quando: txt(m.quando) || txt(m.criado_em),
      provaUrl: txt(m.prova_url),
    };
  });

  const alertas: AlertaDoDia[] = arr(anuncios.alertas).map((x, i) => {
    const a = obj(x);
    return { chave: `a${i}`, clientId: txt(a.client_id), cliente: txt(a.cliente), nivel: nivel(a.nivel), texto: txt(a.texto) || "" };
  }).filter((a) => a.texto);
  const pesoDoNivel: Record<NivelDoDia, number> = { critico: 0, atencao: 1, info: 2 };
  alertas.sort((a, b) => pesoDoNivel[a.nivel] - pesoDoNivel[b.nivel]);

  const clientesEmRisco: ClienteEmRisco[] = arr(calendario.clientes_em_risco).map((x) => {
    const c = obj(x);
    return {
      clientId: txt(c.client_id) || "",
      nome: nomeDoCliente(txt(c.nome) || txt(c.cliente)),
      situacao: txt(c.situacao) || "em risco",
      diasSemPost: num(c.dias_sem_post),
      falta: txt(c.falta),
      sugestao: txt(c.sugestao),
      pctMes: num(c.pct_mes),
      emRiscoHaDias: num(c.em_risco_ha_dias),
      link: txt(c.link),
    };
  }).filter((c) => c.clientId);

  const campanhas: CampanhaDoDia[] = arr(calendario.campanhas).map((x) => {
    const c = obj(x);
    return { clientId: txt(c.client_id) || "", nome: nomeDoCliente(txt(c.nome) || txt(c.cliente)), tema: txt(c.tema) || "hype da semana", porQue: txt(c.por_que) };
  }).filter((c) => c.clientId);
  // Quem está há mais tempo sem post vem primeiro.
  clientesEmRisco.sort((a, b) => (b.diasSemPost ?? -1) - (a.diasSemPost ?? -1));

  const precisaDeVoce: PedidoDoDia[] = arr(interno.precisa_de_voce).map((x, i) => {
    const p = obj(x);
    const tipo = String(p.tipo || "");
    return {
      chave: txt(p.id) || `p${i}`,
      tipo: (TIPOS.indexOf(tipo as TipoDoPedido) >= 0 ? tipo : "outro") as TipoDoPedido,
      // Sem área no pedido, o tipo diz (anúncio é Tráfego; mensagem do ritual é Atendimento).
      nome: nomeDaTarefa({ titulo: txt(p.titulo) || txt(p.assunto), cliente: txt(p.cliente), areaDoAgente: txt(p.area) || (tipo === "anuncio" ? "Tráfego" : tipo === "mensagem" ? "Atendimento" : null) }).texto,
      motivo: txt(p.motivo),
      link: txt(p.link),
      linkId: txt(p.link_id),
      aprovacaoId: txt(p.aprovacao_id),
      clientId: txt(p.client_id),
    };
  });

  const feitoOntem: FeitoDoDia[] = arr(interno.feito_ontem).map((x, i) => {
    const f = obj(x);
    return {
      chave: txt(f.id) || `f${i}`,
      nome: nomeDaTarefa({ titulo: txt(f.titulo), cliente: txt(f.cliente), areaDoAgente: txt(f.area), agente: txt(f.agente) }).texto,
      agente: txt(f.agente),
      quando: txt(f.quando),
      provaUrl: txt(f.prova_url),
      linkId: txt(f.link_id),
    };
  });

  return { geradoEm: txt(interno.gerado_em), mudancas, alertas, clientesEmRisco, campanhas, precisaDeVoce, feitoOntem };
}

export function resumoEstaVazio(r: ResumoDoDia): boolean {
  return !r.mudancas.length && !r.alertas.length && !r.clientesEmRisco.length && !r.campanhas.length && !r.precisaDeVoce.length && !r.feitoOntem.length;
}

/** A RPC ainda não existe neste banco (a frente SERVIDOR cria): estado claro, sem erro. */
export function rpcAusente(erro: { message?: string; code?: string } | null | undefined): boolean {
  if (!erro) return false;
  return erro.code === "PGRST202" || erro.code === "42883" || /could not find the function|does not exist|schema cache/i.test(erro.message || "");
}

/** Só caminho interno do painel vira link (o resto é ignorado). */
const interno = (link: string | null) => (link && link.charAt(0) === "/" && link.charAt(1) !== "/" ? link : null);

/** A ação direta de cada pedido: para onde vai e com que nome (o ícone fica com a tela). */
export function destinoDoPedido(p: PedidoDoDia): { rota: string; rotulo: string } {
  const link = interno(p.link);
  if (p.tipo === "aprovacao") return { rota: link || (p.aprovacaoId ? `/execucao?aprovacao=${encodeURIComponent(p.aprovacaoId)}` : "/execucao"), rotulo: "Aprovar" };
  if (p.tipo === "mensagem") return { rota: link || "/central/mensagens", rotulo: "Aprovar a mensagem" };
  if (p.tipo === "anuncio") return { rota: link || (p.clientId ? `/mesa-ads?client=${encodeURIComponent(p.clientId)}` : "/anuncios/hoje"), rotulo: "Decidir no anúncio" };
  if (p.tipo === "acesso") return { rota: link || "/execucao", rotulo: "Liberar o acesso" };
  if (p.tipo === "vinculo" && p.linkId) return { rota: link || `/execucao?vinculo=${encodeURIComponent(p.linkId)}&aba=diario`, rotulo: "Responder ao agente" };
  return { rota: link || "/execucao", rotulo: "Abrir" };
}

/** Cliente em risco: abre a pauta dele na Mesa. */
export function destinoDoRisco(c: ClienteEmRisco): string {
  return interno(c.link) || `/mesa?client=${encodeURIComponent(c.clientId)}`;
}

/** Dá para fazer campanha: abre a aba Campanhas da Mesa do cliente. */
export function destinoDaCampanha(c: CampanhaDoDia): string {
  return `/mesa?client=${encodeURIComponent(c.clientId)}&aba=campanhas`;
}

/** Feito ontem: a prova (fora do painel) ou o diário da tarefa. */
export function destinoDoFeito(f: FeitoDoDia): { externo: string | null; rota: string | null } {
  if (f.provaUrl && /^https?:\/\//i.test(f.provaUrl)) return { externo: f.provaUrl, rota: null };
  if (f.provaUrl && interno(f.provaUrl)) return { externo: null, rota: f.provaUrl };
  if (f.linkId) return { externo: null, rota: `/execucao?vinculo=${encodeURIComponent(f.linkId)}&aba=diario` };
  return { externo: null, rota: null };
}
