/**
 * Achados (20/10/2026): cartões "achado → ação" no topo da Carteira da
 * Central e do Ciclo, inspirados nos detectores de dinheiro escondido do
 * ClickMax (Aceleriq-Laboratorio/clickmax-rea.md). Cada achado tem UM número
 * grande, uma frase curta do problema e UMA ação pronta (abrir a tela certa
 * ou copiar a mensagem pronta para o grupo, nunca enviar sozinho).
 *
 * Tudo aqui é função pura sobre dados que o painel JÁ tem (CRM, propostas,
 * agenda, aprovações, anúncios, carteira de IA, cobranças e rituais). Nada é
 * inventado: sem dado, o detector não mostra nada. Quem lê o banco é o hook
 * useAchados; os testes chamam estas funções com dados de exemplo.
 *
 * Compatibilidade (iPhone antigo): sem expressão regular moderna aqui.
 */

export type TomDoAchado = "urgente" | "atencao" | "info";

export interface AcaoDoAchado {
  rotulo: string;
  /** Tela onde se resolve (link). */
  rota?: string;
  /** Mensagem pronta: a ação copia para colar no grupo (não envia). */
  copiar?: string;
}

export interface Achado {
  id: string;
  numero: number;
  frase: string;
  acao: AcaoDoAchado;
  tom: TomDoAchado;
  /** Dinheiro em jogo (R$), quando existe: desempata a ordem. */
  valor: number;
  /** Clientes envolvidos (ids), para o filtro do cliente em foco. */
  clientes: string[];
  /** Explicação da regra (vai no "?"). */
  ajuda: string;
  /** Dado extra para a ação local da tela (ex.: qual ritual gerar). */
  extra?: Record<string, string>;
}

/* ───────────────────────────── entradas ───────────────────────────── */

export interface ClienteDoAchado {
  id: string;
  nome: string;
  /** Carteira recorrente (ativo/onboarding, não avulso, não empresa do grupo). */
  recorrente: boolean;
  /** Social contratado e ativo no Ciclo (services_config.social, sem ocultar). */
  social: boolean;
}

export interface LeadDoAchado {
  id: string;
  nome: string;
  estagio: string;
  /** Última mexida no lead (updated_at). */
  atualizadoEm: string | null;
  /** Último evento do histórico (nota, etapa, atividade). */
  ultimoEventoEm: string | null;
  /** Próximo passo agendado (next_action_at). Agendado no futuro = não está parado. */
  proximoPassoEm: string | null;
  valorMensal: number;
  valorUnico: number;
  /** Cliente da casa ligado ao lead (upsell), quando existe. */
  clienteId: string | null;
}

export interface PropostaDoAchado {
  id: string;
  clienteId: string;
  titulo: string;
  totalUnico: number;
  totalMensal: number;
  /** Follow-up calculado pela Mesa Proposta (followupDaProposta); null = nada a lembrar. */
  followup: { situacao: "nao_abriu" | "viu_sem_resposta" | "vence_logo"; dias: number } | null;
  /** Endereço da proposta na Mesa (etapa Acompanhar, onde mora a mensagem pronta). */
  endereco: string;
}

export interface PublicacaoDoAchado {
  clienteId: string;
  status: string;
  agendadaEm: string | null;
  publicadaEm: string | null;
}

export interface AprovacaoDoAchado {
  id: string;
  clienteId: string;
  nomeDoArquivo: string;
  criadoEm: string;
}

export interface VerbaDoAchado {
  clienteId: string;
  saldo: number;
}

export interface AnuncioDiaDoAchado {
  clienteId: string;
  campanhaId: string;
  dia: string;
  gasto: number;
  leads: number;
}

export interface CarteiraIaDoAchado {
  clienteId: string;
  saldoUsd: number;
  atualizadoEm: string | null;
}

export interface CobrancaDoAchado {
  clienteId: string;
  status: string;
  tipo: string | null;
  vencimento: string;
  valor: number;
}

export interface RitualFeitoDoAchado {
  clienteId: string;
  ritual: string;
}

export interface DadosDosAchados {
  /** Agora, em milissegundos. */
  agora: number;
  /** Hoje no fuso local, yyyy-mm-dd. */
  hoje: string;
  /** Segunda-feira desta semana, yyyy-mm-dd. */
  segunda: string;
  clientes: ClienteDoAchado[];
  /** null = sem acesso ou sem leitura (o detector some). */
  leads?: LeadDoAchado[] | null;
  propostas?: PropostaDoAchado[] | null;
  publicacoes?: PublicacaoDoAchado[] | null;
  aprovacoes?: AprovacaoDoAchado[] | null;
  verbas?: VerbaDoAchado[] | null;
  anuncios?: AnuncioDiaDoAchado[] | null;
  carteirasIa?: CarteiraIaDoAchado[] | null;
  cobrancas?: CobrancaDoAchado[] | null;
  rituaisFeitos?: RitualFeitoDoAchado[] | null;
  /** Cliente em foco na tela: tudo passa a falar só dele. */
  clienteEmFoco?: string | null;
}

/* ───────────────────────────── utilidades ───────────────────────────── */

const DIA = 86_400_000;

const reais = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v || 0);

const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

/** Dias inteiros desde uma data ou momento (null quando não dá para ler). */
export function diasDesde(valor: string | null | undefined, agora: number): number | null {
  if (!valor) return null;
  const t = Date.parse(valor.length === 10 ? `${valor}T12:00:00` : valor);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((agora - t) / DIA));
}

/** dd/mm de uma data yyyy-mm-dd (ou momento ISO). */
function diaMes(valor: string): string {
  const d = valor.slice(0, 10);
  return `${d.slice(8, 10)}/${d.slice(5, 7)}`;
}

function somaDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + dias);
  const m = String(d.getMonth() + 1);
  const dd = String(d.getDate());
  return `${d.getFullYear()}-${m.length < 2 ? `0${m}` : m}-${dd.length < 2 ? `0${dd}` : dd}`;
}

function primeiroNome(nome: string): string {
  const limpo = String(nome || "").trim();
  return limpo ? limpo.split(" ")[0] : "";
}

function nomeLegivelDoArquivo(nome: string): string {
  let s = String(nome || "");
  const ponto = s.lastIndexOf(".");
  if (ponto > 0 && s.length - ponto <= 6) s = s.slice(0, ponto);
  return s.split("_").join(" ").trim() || "o material";
}

const nomeDe = (dados: DadosDosAchados, id: string) => dados.clientes.find((c) => c.id === id)?.nome || "Cliente";

/* ───────────────────────────── detectores ───────────────────────────── */

/**
 * Lead parado: aberto no CRM e sem nenhuma mexida (lead ou histórico) há mais
 * dias do que a etapa aguenta. Lead com próximo passo agendado para hoje ou
 * depois não conta: alguém já cuidou dele.
 */
export const LIMITE_DO_LEAD_PARADO: Record<string, number> = {
  novo: 2,
  contato: 4,
  diagnostico: 7,
  proposta: 4,
  negociacao: 4,
};

export function detectarLeadsParados(dados: DadosDosAchados): Achado | null {
  if (!dados.leads) return null;
  const parados: Array<{ lead: LeadDoAchado; dias: number }> = [];
  for (const lead of dados.leads) {
    const limite = LIMITE_DO_LEAD_PARADO[lead.estagio];
    if (limite === undefined) continue;
    if (lead.proximoPassoEm && lead.proximoPassoEm.slice(0, 10) >= dados.hoje) continue;
    const ultimo = [lead.atualizadoEm, lead.ultimoEventoEm].filter(Boolean).sort().pop() || null;
    const dias = diasDesde(ultimo, dados.agora);
    if (dias === null || dias < limite) continue;
    parados.push({ lead, dias });
  }
  if (parados.length === 0) return null;
  const menor = Math.min(...parados.map((p) => p.dias));
  const valor = parados.reduce((t, p) => t + (Number(p.lead.valorMensal) || 0) + (Number(p.lead.valorUnico) || 0), 0);
  const n = parados.length;
  return {
    id: "leads-parados",
    numero: n,
    frase: `${plural(n, "lead parado", "leads parados")} no CRM há ${menor}+ dias`,
    acao: { rotulo: "Abrir o CRM", rota: "/comercial/crm" },
    tom: parados.some((p) => p.lead.estagio === "proposta" || p.lead.estagio === "negociacao") ? "urgente" : "atencao",
    valor,
    clientes: parados.map((p) => p.lead.clienteId).filter((x): x is string => !!x),
    ajuda: "Lead aberto sem nenhuma mexida (nem no histórico) há mais dias do que a etapa aguenta: Novo 2, Em contato 4, Diagnóstico 7, Proposta 4, Negociação 4. Lead com próximo passo agendado não entra.",
  };
}

/** Proposta enviada ou vista sem resposta: a mesma régua de follow-up da Mesa Proposta. */
export function detectarPropostasSemRetorno(dados: DadosDosAchados): Achado | null {
  if (!dados.propostas) return null;
  const pendentes = dados.propostas.filter((p) => !!p.followup);
  if (pendentes.length === 0) return null;
  const n = pendentes.length;
  const vencendo = pendentes.filter((p) => p.followup!.situacao === "vence_logo").length;
  const semResposta = pendentes.filter((p) => p.followup!.situacao !== "vence_logo");
  const menor = semResposta.length ? Math.min(...semResposta.map((p) => p.followup!.dias)) : null;
  const valor = pendentes.reduce((t, p) => t + (Number(p.totalUnico) || 0) + (Number(p.totalMensal) || 0), 0);
  const frase = menor !== null
    ? `${plural(n, "proposta sem retorno", "propostas sem retorno")} há ${menor}+ dias`
    : `${plural(n, "proposta vence", "propostas vencem")} em até 2 dias`;
  return {
    id: "propostas-sem-retorno",
    numero: n,
    frase,
    acao: n === 1
      ? { rotulo: "Preparar follow-up", rota: pendentes[0].endereco }
      : { rotulo: "Ver follow-ups", rota: "/clientes?propostas=1" },
    tom: vencendo > 0 ? "urgente" : "atencao",
    valor,
    clientes: pendentes.map((p) => p.clienteId),
    ajuda: "Proposta enviada e não aberta há 2 dias, vista e sem resposta há 2 dias, ou vencendo em até 2 dias (a régua da Mesa Proposta). A mensagem de follow-up pronta fica na etapa Acompanhar da proposta.",
  };
}

/** Cliente com Social sem nenhum post agendado ou publicado nesta semana. */
export function detectarSemPostNaSemana(dados: DadosDosAchados): Achado | null {
  if (!dados.publicacoes) return null;
  const fim = somaDias(dados.segunda, 7);
  const comPost = new Set<string>();
  for (const p of dados.publicacoes) {
    if (p.status !== "scheduled" && p.status !== "published") continue;
    const quando = (p.status === "published" ? p.publicadaEm || p.agendadaEm : p.agendadaEm || p.publicadaEm) || "";
    const dia = quando ? localDoMomento(quando) : "";
    if (dia >= dados.segunda && dia < fim) comPost.add(p.clienteId);
  }
  const sem = dados.clientes.filter((c) => c.social && !comPost.has(c.id));
  if (sem.length === 0) return null;
  const n = sem.length;
  return {
    id: "sem-post-na-semana",
    numero: n,
    frase: `${plural(n, "cliente sem post agendado", "clientes sem post agendado")} nesta semana`,
    acao: { rotulo: "Abrir a Agenda", rota: n === 1 ? `/calendario?client=${encodeURIComponent(sem[0].id)}` : "/calendario" },
    tom: "atencao",
    valor: 0,
    clientes: sem.map((c) => c.id),
    ajuda: "Clientes com Social no Ciclo sem nenhuma publicação agendada ou publicada de segunda a domingo desta semana.",
  };
}

/** Dia local (yyyy-mm-dd) de um momento ISO; data pura passa direto. */
function localDoMomento(valor: string): string {
  if (valor.length === 10) return valor;
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return valor.slice(0, 10);
  const m = String(d.getMonth() + 1);
  const dd = String(d.getDate());
  return `${d.getFullYear()}-${m.length < 2 ? `0${m}` : m}-${dd.length < 2 ? `0${dd}` : dd}`;
}

/** Mesmo limite da Saúde da carteira: material parado na aprovação há mais de 4 dias. */
export const DIAS_DA_APROVACAO_PARADA = 4;

/** Lembrete para o grupo, no tom do "O que depende de você" da mensagem do grupo. */
export function lembreteDeAprovacao(nomeDoCliente: string, arquivos: string[], desde: string): string {
  const nomes = arquivos.map(nomeLegivelDoArquivo);
  const primeiro = primeiroNome(nomeDoCliente);
  const oi = primeiro ? `Oi, ${primeiro}! Tudo bem?` : "Oi! Tudo bem?";
  const lista = nomes.length <= 2 ? nomes.join(" e ") : `${nomes.slice(0, 2).join(", ")} e mais ${nomes.length - 2}`;
  const corpo = arquivos.length === 1
    ? `${lista} está esperando seu ok no painel desde ${diaMes(desde)} — com o sim, já entra no calendário.`
    : `${lista} estão esperando seu ok no painel desde ${diaMes(desde)} — com o sim, já entram no calendário.`;
  return `${oi} ${corpo.charAt(0).toUpperCase()}${corpo.slice(1)} É só abrir aceleriq.online e aprovar.`;
}

export function detectarAprovacaoParada(dados: DadosDosAchados): Achado | null {
  if (!dados.aprovacoes) return null;
  const paradas = dados.aprovacoes
    .map((a) => ({ a, dias: diasDesde(a.criadoEm, dados.agora) }))
    .filter((x): x is { a: AprovacaoDoAchado; dias: number } => x.dias !== null && x.dias > DIAS_DA_APROVACAO_PARADA);
  if (paradas.length === 0) return null;
  const clientes = Array.from(new Set(paradas.map((x) => x.a.clienteId)));
  const n = paradas.length;
  const maisAntiga = paradas.reduce((m, x) => (x.a.criadoEm < m ? x.a.criadoEm : m), paradas[0].a.criadoEm);
  const acao: AcaoDoAchado = clientes.length === 1
    ? { rotulo: "Copiar lembrete", copiar: lembreteDeAprovacao(nomeDe(dados, clientes[0]), paradas.map((x) => x.a.nomeDoArquivo), maisAntiga) }
    : { rotulo: "Abrir aprovações", rota: "/aprovacoes" };
  return {
    id: "aprovacao-parada",
    numero: n,
    frase: `${plural(n, "material parado", "materiais parados")} na aprovação do cliente há ${DIAS_DA_APROVACAO_PARADA + 1}+ dias`,
    acao,
    tom: paradas.some((x) => x.dias > 7) ? "urgente" : "atencao",
    valor: 0,
    clientes,
    ajuda: "Material enviado para aprovação do cliente e sem resposta há mais de 4 dias (o mesmo alerta da Saúde da carteira). Com um cliente só, a ação copia o lembrete pronto para o grupo.",
  };
}

/** Mesma regra do Ciclo (contarLeads em esteiraFatos): lead + conversa iniciada. */
export function contarLeadsDasAcoes(actions: unknown): number {
  if (!Array.isArray(actions)) return 0;
  let total = 0;
  for (const a of actions as Array<{ action_type?: string; value?: unknown }>) {
    const tipo = String((a && a.action_type) || "").toLowerCase();
    if (tipo.indexOf("lead") >= 0 || tipo.indexOf("messaging_conversation_started") >= 0) total += Number(a.value) || 0;
  }
  return total;
}

/** Verba de anúncio zerada com campanha gastando nos últimos 3 dias (no ar). */
export function detectarVerbaZerada(dados: DadosDosAchados): Achado | null {
  if (!dados.verbas || !dados.anuncios) return null;
  const saldo = new Map<string, number>();
  for (const v of dados.verbas) saldo.set(v.clienteId, (saldo.get(v.clienteId) || 0) + (Number(v.saldo) || 0));
  const corte = somaDias(dados.hoje, -3);
  const noAr = new Set(dados.anuncios.filter((d) => d.gasto > 0 && d.dia >= corte).map((d) => d.clienteId));
  const zerados = Array.from(saldo.entries()).filter(([id, s]) => s <= 0 && noAr.has(id)).map(([id]) => id);
  if (zerados.length === 0) return null;
  const n = zerados.length;
  return {
    id: "verba-zerada",
    numero: n,
    frase: `${plural(n, "cliente com verba de anúncio zerada", "clientes com verba de anúncio zerada")} e campanha no ar`,
    acao: n === 1
      ? { rotulo: "Copiar aviso", copiar: `Oi, ${primeiroNome(nomeDe(dados, zerados[0])) || "tudo bem"}! A verba dos anúncios chegou a zero e as campanhas param de rodar sem saldo. Quer que a gente siga com a recarga para não perder o ritmo?` }
      : { rotulo: "Abrir financeiro", rota: "/financeiro" },
    tom: "urgente",
    valor: 0,
    clientes: zerados,
    ajuda: "Carteira de anúncios com saldo zero ou negativo e campanha que gastou nos últimos 3 dias. Com um cliente só, a ação copia o aviso de recarga para o grupo.",
  };
}

/** Campanha que gastou nos últimos 7 dias sem trazer nenhum lead (mesma régua do Ciclo). */
export function detectarAnuncioSemLead(dados: DadosDosAchados): Achado | null {
  if (!dados.anuncios) return null;
  const corte = somaDias(dados.hoje, -7);
  const porCampanha = new Map<string, { clienteId: string; gasto: number; leads: number }>();
  for (const d of dados.anuncios) {
    if (d.dia < corte) continue;
    const chave = `${d.clienteId}:${d.campanhaId}`;
    const atual = porCampanha.get(chave) || { clienteId: d.clienteId, gasto: 0, leads: 0 };
    atual.gasto += Number(d.gasto) || 0;
    atual.leads += Number(d.leads) || 0;
    porCampanha.set(chave, atual);
  }
  const semLead = Array.from(porCampanha.values()).filter((c) => c.gasto > 0 && c.leads === 0);
  if (semLead.length === 0) return null;
  const gasto = semLead.reduce((t, c) => t + c.gasto, 0);
  const n = semLead.length;
  return {
    id: "anuncio-sem-lead",
    numero: n,
    frase: `${plural(n, "campanha gastou", "campanhas gastaram")} ${reais(gasto)} em 7 dias sem lead`,
    acao: { rotulo: "Abrir anúncios", rota: "/anuncios" },
    tom: "atencao",
    valor: gasto,
    clientes: Array.from(new Set(semLead.map((c) => c.clienteId))),
    ajuda: "Campanha que teve gasto nos últimos 7 dias e nenhum lead nem conversa iniciada (a mesma régua do Ciclo).",
  };
}

/** Carteira de IA zerada ou negativa de quem usou a IA nos últimos 30 dias. */
export function detectarCarteiraIaSemSaldo(dados: DadosDosAchados): Achado | null {
  if (!dados.carteirasIa) return null;
  const recorrentes = new Set(dados.clientes.filter((c) => c.recorrente).map((c) => c.id));
  const sem = dados.carteirasIa.filter((c) => {
    if (!recorrentes.has(c.clienteId) || Number(c.saldoUsd) > 0) return false;
    const dias = diasDesde(c.atualizadoEm, dados.agora);
    return dias !== null && dias <= 30;
  });
  if (sem.length === 0) return null;
  const n = sem.length;
  return {
    id: "carteira-ia-sem-saldo",
    numero: n,
    frase: `${plural(n, "cliente com a carteira de IA", "clientes com a carteira de IA")} sem saldo`,
    acao: { rotulo: "Recarregar na Mesa", rota: n === 1 ? `/mesa?client=${encodeURIComponent(sem[0].clienteId)}` : "/mesa" },
    tom: "atencao",
    valor: 0,
    clientes: sem.map((c) => c.clienteId),
    ajuda: "Carteira de IA do cliente com saldo zero ou negativo e movimento nos últimos 30 dias: a próxima geração da Mesa para.",
  };
}

/** Mensagem de cobrança pronta (para copiar; o painel não envia). */
export function mensagemDeCobranca(nomeDoCliente: string, total: number, vencimento: string): string {
  const primeiro = primeiroNome(nomeDoCliente);
  const oi = primeiro ? `Oi, ${primeiro}! Tudo bem?` : "Oi! Tudo bem?";
  return `${oi} Passando para lembrar que ficou em aberto ${reais(total)}, com vencimento em ${diaMes(vencimento)}. Se já pagou, me avisa por aqui que eu dou baixa. Qualquer dúvida é só chamar.`;
}

/** Cobrança pendente com vencimento antes de hoje (recarga de anúncio fica fora, como na Saúde da carteira). */
export function detectarCobrancaAtrasada(dados: DadosDosAchados): Achado | null {
  if (!dados.cobrancas) return null;
  const vencidas = dados.cobrancas.filter((b) => b.status === "pending" && b.tipo !== "ads_recharge" && !!b.vencimento && b.vencimento.slice(0, 10) < dados.hoje);
  if (vencidas.length === 0) return null;
  const porCliente = new Map<string, { total: number; maisAntiga: string }>();
  for (const b of vencidas) {
    const atual = porCliente.get(b.clienteId) || { total: 0, maisAntiga: b.vencimento };
    atual.total += Number(b.valor) || 0;
    if (b.vencimento < atual.maisAntiga) atual.maisAntiga = b.vencimento;
    porCliente.set(b.clienteId, atual);
  }
  const total = vencidas.reduce((t, b) => t + (Number(b.valor) || 0), 0);
  const n = porCliente.size;
  const [unico] = Array.from(porCliente.entries());
  return {
    id: "cobranca-atrasada",
    numero: n,
    frase: `${plural(n, "cliente com", "clientes com")} ${reais(total)} em cobrança vencida`,
    acao: n === 1
      ? { rotulo: "Copiar cobrança", copiar: mensagemDeCobranca(nomeDe(dados, unico[0]), unico[1].total, unico[1].maisAntiga) }
      : { rotulo: "Abrir financeiro", rota: "/financeiro" },
    tom: "urgente",
    valor: total,
    clientes: Array.from(porCliente.keys()),
    ajuda: "Cobrança pendente com vencimento antes de hoje (recarga de anúncio fica de fora, como na Saúde da carteira). Com um cliente só, a ação copia a mensagem de cobrança pronta.",
  };
}

/** O ritual que já devia ter saído hoje: segunda abre, quarta checa, sexta fecha. */
export function ritualDevidoHoje(hoje: string): { chave: "segunda" | "quarta" | "sexta"; nome: string; daCentral: string; diasDeAtraso: number } {
  const dia = new Date(`${hoje}T12:00:00`).getDay();
  if (dia === 1 || dia === 2) return { chave: "segunda", nome: "Rota da Semana", daCentral: "rota_semana", diasDeAtraso: dia - 1 };
  if (dia === 3 || dia === 4) return { chave: "quarta", nome: "Check do Meio da Semana", daCentral: "meio_semana", diasDeAtraso: dia - 3 };
  return { chave: "sexta", nome: "Prova de Movimento", daCentral: "prova_movimento", diasDeAtraso: dia === 0 ? 2 : dia - 5 };
}

export function detectarRitualPendente(dados: DadosDosAchados): Achado | null {
  if (!dados.rituaisFeitos) return null;
  const devido = ritualDevidoHoje(dados.hoje);
  const feitos = new Set(dados.rituaisFeitos.filter((r) => r.ritual === devido.chave).map((r) => r.clienteId));
  const faltam = dados.clientes.filter((c) => c.recorrente && !feitos.has(c.id));
  if (faltam.length === 0) return null;
  const n = faltam.length;
  return {
    id: "ritual-pendente",
    numero: n,
    frase: `${plural(n, "cliente sem", "clientes sem")} a ${devido.nome} enviada`,
    acao: { rotulo: "Gerar", rota: "/central" },
    tom: devido.diasDeAtraso > 0 ? "urgente" : "atencao",
    valor: 0,
    clientes: faltam.map((c) => c.id),
    ajuda: "Ritual do dia (segunda Rota da Semana, quarta Check do Meio, sexta Prova de Movimento) ainda não marcado no Ciclo para o cliente recorrente desta semana.",
    extra: { ritual: devido.daCentral },
  };
}

/* ───────────────────────────── juntar ───────────────────────────── */

export const DETECTORES: Array<(dados: DadosDosAchados) => Achado | null> = [
  detectarCobrancaAtrasada,
  detectarVerbaZerada,
  detectarPropostasSemRetorno,
  detectarLeadsParados,
  detectarAprovacaoParada,
  detectarAnuncioSemLead,
  detectarSemPostNaSemana,
  detectarRitualPendente,
  detectarCarteiraIaSemSaldo,
];

const PESO_DO_TOM: Record<TomDoAchado, number> = { urgente: 3, atencao: 2, info: 1 };

/** Ordem: urgência primeiro, depois dinheiro em jogo, depois o tamanho do número. */
export function ordenarAchados(lista: Achado[]): Achado[] {
  return lista.slice().sort((a, b) => PESO_DO_TOM[b.tom] - PESO_DO_TOM[a.tom] || b.valor - a.valor || b.numero - a.numero || a.id.localeCompare(b.id));
}

/** Recorta os dados para um cliente só (o cliente em foco). */
export function soDoCliente(dados: DadosDosAchados, clienteId: string): DadosDosAchados {
  const doCliente = <T extends { clienteId: string | null }>(lista: T[] | null | undefined) => (lista ? lista.filter((x) => x.clienteId === clienteId) : lista);
  return {
    ...dados,
    clientes: dados.clientes.filter((c) => c.id === clienteId),
    leads: doCliente(dados.leads),
    propostas: doCliente(dados.propostas),
    publicacoes: doCliente(dados.publicacoes),
    aprovacoes: doCliente(dados.aprovacoes),
    verbas: doCliente(dados.verbas),
    anuncios: doCliente(dados.anuncios),
    carteirasIa: doCliente(dados.carteirasIa),
    cobrancas: doCliente(dados.cobrancas),
    rituaisFeitos: doCliente(dados.rituaisFeitos),
    clienteEmFoco: clienteId,
  };
}

/** Todos os achados com número maior que zero, já ordenados (e do cliente em foco, quando houver). */
export function detectarAchados(dados: DadosDosAchados): Achado[] {
  const base = dados.clienteEmFoco ? soDoCliente(dados, dados.clienteEmFoco) : dados;
  const achados: Achado[] = [];
  for (const detectar of DETECTORES) {
    const a = detectar(base);
    if (a && a.numero > 0) achados.push(a);
  }
  return ordenarAchados(achados);
}
