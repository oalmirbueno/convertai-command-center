import { CHANCE_POR_ESTAGIO, type Atividade, type Lead } from "@/lib/comercial";

/**
 * Temperatura do lead: frio, morno ou quente, com um número de 0 a 100.
 *
 * Regra FIXA e transparente, sem IA: cada sinal tem um peso escrito aqui, e o
 * "porquê" que a tela mostra é a lista dos sinais que somaram. Quem discordar
 * do número enxerga de onde ele veio e sabe o que fazer para mudá-lo (marcar
 * a reunião, registrar a conversa, tirar o lead do parado).
 *
 * De onde vem cada sinal (nada novo no banco):
 * - toque recente: atividade concluída (commercial_activities.done_at),
 *   conversa anotada ou mudança de etapa (commercial_lead_events);
 * - resposta: conversa registrada na história nos últimos 14 dias (a nota
 *   escrita por gente; as notas automáticas da proposta não contam);
 * - reunião marcada: atividade aberta do tipo "reuniao" com data futura;
 * - proposta aberta/aceita/recusada: as notas que a Mesa Proposta grava na
 *   história do lead ("Proposta N aberta pelo cliente.", "aceita por",
 *   "recusada");
 * - parado: dias desde o último movimento (toque, entrada na etapa ou criação);
 * - origem: commercial_leads.origin (indicação esquenta mais que lista fria).
 *
 * Sem expressão regular nenhuma: só indexOf (piso Safari 11).
 */

/** Um evento da história do lead (commercial_lead_events). */
export interface EventoDoLead {
  lead_id: string;
  kind: string;
  from_stage: string | null;
  to_stage: string | null;
  note: string | null;
  created_at: string;
}

export type FaixaDeTemperatura = "frio" | "morno" | "quente";

export interface MotivoDaTemperatura {
  rotulo: string;
  pontos: number;
}

export interface Temperatura {
  valor: number;
  faixa: FaixaDeTemperatura;
  motivos: MotivoDaTemperatura[];
}

/** Os pesos, num lugar só. Mudar a régua é mudar este objeto. */
export const PESOS_DA_TEMPERATURA = {
  base: 10,
  /** Etapa: chance da etapa (0 a 1) vezes este peso. */
  etapa: 20,
  toqueAte3Dias: 20,
  toqueAte7Dias: 12,
  toqueAte14Dias: 5,
  resposta: 15,
  reuniaoMarcada: 20,
  reuniaoFeita: 10,
  proximoPassoMarcado: 5,
  propostaAberta: 15,
  propostaAceita: 25,
  propostaRecusada: -20,
  compromissoAtrasado: -10,
  parado15Dias: -15,
  parado31Dias: -25,
} as const;

export const PESO_DA_ORIGEM: Record<string, number> = {
  indicacao: 10,
  quiz: 8,
  evento: 6,
  site: 5,
  instagram: 4,
  prospeccao: 0,
  manual: 0,
};

const ROTULO_DA_ORIGEM: Record<string, string> = {
  indicacao: "veio por indicação",
  quiz: "veio do diagnóstico",
  evento: "veio de evento",
  site: "veio pelo site",
  instagram: "veio pelo Instagram",
};

/** Abaixo de 35 é frio; de 65 para cima, quente. */
export const LIMITES_DA_TEMPERATURA = { morno: 35, quente: 65 } as const;

export const faixaDaTemperatura = (valor: number): FaixaDeTemperatura =>
  valor >= LIMITES_DA_TEMPERATURA.quente ? "quente" : valor >= LIMITES_DA_TEMPERATURA.morno ? "morno" : "frio";

export const ROTULO_DA_FAIXA: Record<FaixaDeTemperatura, string> = {
  frio: "Frio",
  morno: "Morno",
  quente: "Quente",
};

const DIA_MS = 24 * 60 * 60 * 1000;

const diasEntre = (antesIso: string, agoraIso: string) => {
  const antes = new Date(antesIso).getTime();
  const agora = new Date(agoraIso).getTime();
  if (!Number.isFinite(antes) || !Number.isFinite(agora)) return Infinity;
  return Math.max(0, Math.floor((agora - antes) / DIA_MS));
};

const nota = (evento: EventoDoLead) => (evento.note || "").trim();
const minusculo = (texto: string) => texto.toLowerCase();

/** Notas que a Mesa Proposta grava sozinha: viram sinal de proposta, não de conversa. */
export const ehNotaDaProposta = (evento: EventoDoLead) => {
  const texto = nota(evento);
  return texto.indexOf("Proposta ") === 0 || texto.indexOf("Follow-up da proposta") === 0;
};

/** Nota gerada pelo sistema (criação pelo MCP), que não é conversa de ninguém. */
// 20/10/2026: a nota que o formulário do site grava ao criar o lead também é automática (não é conversa de gente).
// Laboratório v4: as do quiz refeito e da venda pelo checkout (vendas-webhook) também.
const NOTAS_AUTOMATICAS = ["Criado pelo MCP", "Chegou pelo formulário do site", "Refez o quiz do site", "Venda pelo checkout"];
const ehNotaAutomatica = (evento: EventoDoLead) =>
  ehNotaDaProposta(evento) || NOTAS_AUTOMATICAS.some((inicio) => nota(evento).indexOf(inicio) === 0);

export const propostaAbertaPeloCliente = (evento: EventoDoLead) =>
  ehNotaDaProposta(evento) && minusculo(nota(evento)).indexOf("aberta pelo cliente") >= 0;
export const propostaAceita = (evento: EventoDoLead) =>
  ehNotaDaProposta(evento) && minusculo(nota(evento)).indexOf(" aceita por ") >= 0;
export const propostaRecusada = (evento: EventoDoLead) =>
  ehNotaDaProposta(evento) && minusculo(nota(evento)).indexOf(" recusada") >= 0;

/**
 * Quando o lead entrou na etapa em que está.
 *
 * Não há coluna própria: sai do último evento de etapa que levou o lead para
 * a etapa atual. Sem esse evento (lead novo, ou movido por fora), vale a data
 * de criação, e `estimado` diz que é a melhor leitura possível, não um fato.
 */
export function entradaNaEtapa(lead: Lead, eventos: EventoDoLead[]): { em: string; estimado: boolean } {
  let melhor: string | null = null;
  for (const evento of eventos) {
    if (evento.lead_id !== lead.id || evento.kind !== "stage" || evento.to_stage !== lead.stage) continue;
    if (!melhor || evento.created_at > melhor) melhor = evento.created_at;
  }
  if (melhor) return { em: melhor, estimado: false };
  return { em: lead.created_at, estimado: lead.stage !== "novo" };
}

/** O toque mais recente de gente no lead: atividade feita, conversa anotada ou mudança de etapa. */
export function ultimoToque(lead: Lead, atividades: Atividade[], eventos: EventoDoLead[]): string | null {
  let ultimo: string | null = null;
  const considerar = (quando: string | null | undefined) => {
    if (quando && (!ultimo || quando > ultimo)) ultimo = quando;
  };
  for (const atividade of atividades) {
    if (atividade.lead_id === lead.id && atividade.done_at) considerar(atividade.done_at);
  }
  for (const evento of eventos) {
    if (evento.lead_id !== lead.id) continue;
    if (evento.kind === "stage" || evento.kind === "atividade") considerar(evento.created_at);
    else if (evento.kind === "nota" && !ehNotaAutomatica(evento)) considerar(evento.created_at);
  }
  return ultimo;
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const haDias = (dias: number) => (dias === 0 ? "hoje" : dias === 1 ? "ontem" : `há ${dias} dias`);

/**
 * A temperatura de um lead, com os motivos.
 *
 * `agoraIso` entra de fora para o cálculo ser repetível (teste e tela dão o
 * mesmo número para o mesmo instante).
 */
export function temperaturaDoLead(
  lead: Lead,
  atividades: Atividade[],
  eventos: EventoDoLead[],
  agoraIso: string,
): Temperatura {
  const P = PESOS_DA_TEMPERATURA;
  const motivos: MotivoDaTemperatura[] = [];
  const somar = (pontos: number, rotulo: string) => {
    if (pontos !== 0) motivos.push({ rotulo, pontos });
  };

  const doLead = eventos.filter((e) => e.lead_id === lead.id);
  const abertas = atividades.filter((a) => a.lead_id === lead.id && !a.done_at);
  const feitas = atividades.filter((a) => a.lead_id === lead.id && a.done_at);

  // Etapa: quanto mais perto do fechamento, mais quente de saída.
  const chance = CHANCE_POR_ESTAGIO[lead.stage] ?? 0;
  somar(Math.round(chance * P.etapa), `etapa (${Math.round(chance * 100)}% de chance)`);

  // Toque recente de gente.
  const toque = ultimoToque(lead, atividades, eventos);
  const diasDoToque = toque ? diasEntre(toque, agoraIso) : Infinity;
  if (diasDoToque <= 3) somar(P.toqueAte3Dias, `último contato ${haDias(diasDoToque)}`);
  else if (diasDoToque <= 7) somar(P.toqueAte7Dias, `último contato ${haDias(diasDoToque)}`);
  else if (diasDoToque <= 14) somar(P.toqueAte14Dias, `último contato ${haDias(diasDoToque)}`);

  // Resposta: conversa registrada por gente nos últimos 14 dias.
  const conversas = doLead.filter(
    (e) => e.kind === "nota" && !ehNotaAutomatica(e) && diasEntre(e.created_at, agoraIso) <= 14,
  ).length;
  if (conversas > 0) somar(P.resposta, `${plural(conversas, "conversa registrada", "conversas registradas")} em 14 dias`);

  // Reunião: marcada à frente esquenta mais que a já feita.
  const reuniaoMarcada = abertas.some((a) => a.kind === "reuniao" && a.due_at >= agoraIso);
  if (reuniaoMarcada) somar(P.reuniaoMarcada, "reunião marcada");
  else if (feitas.some((a) => a.kind === "reuniao" && diasEntre(a.done_at as string, agoraIso) <= 14)) {
    somar(P.reuniaoFeita, "reunião feita em 14 dias");
  }
  if (!reuniaoMarcada && abertas.some((a) => a.due_at >= agoraIso)) somar(P.proximoPassoMarcado, "próximo passo marcado");

  // Proposta: o cliente abriu, aceitou ou recusou.
  if (doLead.some((e) => propostaAceita(e))) somar(P.propostaAceita, "proposta aceita");
  else if (doLead.some((e) => propostaAbertaPeloCliente(e) && diasEntre(e.created_at, agoraIso) <= 30)) {
    somar(P.propostaAberta, "cliente abriu a proposta");
  }
  if (doLead.some((e) => propostaRecusada(e))) somar(P.propostaRecusada, "proposta recusada");

  // Compromisso vencido: alguém prometeu e não fez.
  const atrasadas = abertas.filter((a) => a.due_at < agoraIso).length;
  if (atrasadas > 0) somar(P.compromissoAtrasado, plural(atrasadas, "compromisso atrasado", "compromissos atrasados"));

  // Parado: dias sem movimento nenhum (toque, entrada na etapa ou criação).
  const entrada = entradaNaEtapa(lead, eventos).em;
  let movimento = lead.created_at;
  if (entrada > movimento) movimento = entrada;
  if (toque && toque > movimento) movimento = toque;
  const parado = diasEntre(movimento, agoraIso);
  if (parado > 30) somar(P.parado31Dias, `parado há ${parado} dias`);
  else if (parado > 14) somar(P.parado15Dias, `parado há ${parado} dias`);

  // Origem.
  const origem = PESO_DA_ORIGEM[lead.origin] ?? 0;
  if (origem) somar(origem, ROTULO_DA_ORIGEM[lead.origin] || `origem ${lead.origin}`);

  const bruto = P.base + motivos.reduce((soma, m) => soma + m.pontos, 0);
  const valor = Math.max(0, Math.min(100, Math.round(bruto)));
  return { valor, faixa: faixaDaTemperatura(valor), motivos };
}

/** O "porquê" em texto, para o title e o "?": "Quente 78: +20 reunião marcada; ...". */
export function explicarTemperatura(temperatura: Temperatura): string {
  const linhas = temperatura.motivos.map((m) => `${m.pontos > 0 ? "+" : ""}${m.pontos} ${m.rotulo}`);
  return `${ROTULO_DA_FAIXA[temperatura.faixa]} ${temperatura.valor} de 100 (base ${PESOS_DA_TEMPERATURA.base}${
    linhas.length ? `; ${linhas.join("; ")}` : ""
  })`;
}

/** Filtro do funil por faixa ("todas" deixa passar tudo). */
export const FAIXAS_DO_FILTRO = ["todas", "quente", "morno", "frio"] as const;
export type FiltroDeTemperatura = (typeof FAIXAS_DO_FILTRO)[number];

export const passaNoFiltroDeTemperatura = (temperatura: Temperatura, filtro: string) =>
  filtro === "todas" || temperatura.faixa === filtro;
