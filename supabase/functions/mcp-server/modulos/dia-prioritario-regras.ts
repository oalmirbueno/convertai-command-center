/**
 * Dia Prioritário do Cliente (12/10/2026, aprovado pelo CEO).
 *
 * Um dia útil fixo por semana (1 segunda ... 5 sexta) de atenção estratégica ao negócio do cliente:
 * conversa, resultados, pendências, próximos passos e, quando combinado, captações. NÃO é o único dia
 * de atendimento, NÃO obriga reunião e NÃO muda rituais (segunda, quarta, sexta), postagens nem urgências.
 *
 * Fonte oficial: tabela public.cliente_dia_prioritario (escrita só pela RPC dia_prioritario_definir).
 * Este arquivo é puro (sem banco): datas em America/Sao_Paulo, quem é recorrente, a sugestão automática
 * de dia e a leitura de captações. A tela, o cadastro e os testes usam as mesmas regras.
 */

export type DiaUtil = 1 | 2 | 3 | 4 | 5;
export type SituacaoDoDia = "confirmado" | "provisorio" | "sugerido" | "nao_aplicavel";
export type OrigemDoDia = "manual" | "sugerida";
export type TipoDeRegistro = "ligacao" | "reuniao" | "alinhamento" | "mensagem" | "sem_contato";

export interface DiaPrioritarioDoCliente {
  client_id: string;
  dia: number | null;
  situacao: SituacaoDoDia | string;
  origem: OrigemDoDia | string;
  observacao: string | null;
  dias_indisponiveis: number[];
  definido_por: string | null;
  atualizado_em: string;
}

export const DIAS_UTEIS: Array<{ dia: DiaUtil; nome: string; curto: string }> = [
  { dia: 1, nome: "segunda-feira", curto: "Seg" },
  { dia: 2, nome: "terça-feira", curto: "Ter" },
  { dia: 3, nome: "quarta-feira", curto: "Qua" },
  { dia: 4, nome: "quinta-feira", curto: "Qui" },
  { dia: 5, nome: "sexta-feira", curto: "Sex" },
];

export const ROTULO_DA_SITUACAO: Record<SituacaoDoDia, string> = {
  confirmado: "Confirmado",
  provisorio: "Provisório",
  sugerido: "Sugerido",
  nao_aplicavel: "Não se aplica",
};

export const ROTULO_DO_REGISTRO: Record<TipoDeRegistro, string> = {
  ligacao: "Ligação",
  reuniao: "Reunião",
  alinhamento: "Alinhamento interno",
  mensagem: "Conversa por mensagem",
  sem_contato: "Sem necessidade de contato",
};

export const ehDiaUtil = (v: unknown): v is DiaUtil => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5;
export const nomeDoDia = (dia: number | null | undefined) => (ehDiaUtil(dia) ? DIAS_UTEIS[dia - 1].nome : "");

const FUSO = "America/Sao_Paulo";
const ISO_DO_DIA: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Dia da semana ISO (1 segunda ... 7 domingo) no fuso de São Paulo. */
export function diaDaSemanaEmSP(agora: Date = new Date()): number {
  const curto = new Intl.DateTimeFormat("en-US", { timeZone: FUSO, weekday: "short" }).format(agora);
  return ISO_DO_DIA[curto] ?? 0;
}

/** Data YYYY-MM-DD no fuso de São Paulo. */
export function dataEmSP(agora: Date = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
  return p;
}

/** Dia da semana ISO de uma data YYYY-MM-DD (calendário, sem fuso: a data já é a do Brasil). */
export function diaDaSemanaDaData(data: string): number {
  const [a, m, d] = data.slice(0, 10).split("-").map(Number);
  if (!a || !m || !d) return 0;
  const js = new Date(Date.UTC(a, m - 1, d)).getUTCDay(); // 0 domingo
  return js === 0 ? 7 : js;
}

/** Hoje (em São Paulo) é o Dia Prioritário deste dia? */
export const ehHoje = (dia: number | null | undefined, agora: Date = new Date()) => ehDiaUtil(dia) && diaDaSemanaEmSP(agora) === dia;

/** A próxima data (YYYY-MM-DD, São Paulo) do dia; hoje conta quando hoje é o dia. */
export function proximaData(dia: number, agora: Date = new Date()): string {
  const hoje = dataEmSP(agora);
  const atual = diaDaSemanaDaData(hoje);
  const falta = (dia - atual + 7) % 7;
  const [a, m, d] = hoje.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1, d + falta));
  return alvo.toISOString().slice(0, 10);
}

/** "terça-feira, 14/10" para uma data YYYY-MM-DD. */
export function dataPorExtenso(data: string): string {
  const dia = diaDaSemanaDaData(data);
  const [, m, d] = data.split("-");
  return `${dia >= 1 && dia <= 5 ? DIAS_UTEIS[dia - 1].nome : dia === 6 ? "sábado" : "domingo"}, ${d}/${m}`;
}

/** O que o cliente vê: só o dia confirmado. Provisório, sugerido e "não se aplica" ficam internos. */
export const diaVisivelAoCliente = (d: Pick<DiaPrioritarioDoCliente, "dia" | "situacao"> | null | undefined): DiaUtil | null =>
  d && d.situacao === "confirmado" && ehDiaUtil(d.dia) ? d.dia : null;

/** O dia vale na operação (Central, Hermes): confirmado ou provisório. */
export const diaNaOperacao = (d: Pick<DiaPrioritarioDoCliente, "dia" | "situacao"> | null | undefined): DiaUtil | null =>
  d && (d.situacao === "confirmado" || d.situacao === "provisorio") && ehDiaUtil(d.dia) ? d.dia : null;

// ------------------------------------------------------------------ quem tem direito

export interface ClienteParaODia {
  id: string;
  plan_status?: string | null;
  client_type?: string | null;
  deleted_at?: string | null;
  services_config?: Record<string, unknown> | null;
}

/**
 * Recorrente com contrato mensal vigente: ativo (ou em andamento), não avulso e não empresa interna.
 * Avulso, encerrado, em standby (sem renovação) ou interno não recebe o benefício automaticamente.
 */
export function ehRecorrenteParaODia(c: ClienteParaODia): boolean {
  if (c.deleted_at) return false;
  if (c.plan_status !== "active" && c.plan_status !== "onboarding") return false;
  if (c.client_type === "one_off") return false;
  return !(c.services_config && c.services_config.internal_company);
}

// ------------------------------------------------------------------ sugestão automática

/** Serviços que pesam na complexidade (os do cadastro; flags administrativas não contam). */
const SERVICOS_QUE_PESAM = ["social", "trafego", "design", "edicao_video", "videos_ia", "site", "seo", "copywriting", "automacao", "email_marketing", "relatorios"];

/** Quantos serviços o cliente tem contratados (0 se nenhum marcado). */
export function complexidadeDoCliente(c: ClienteParaODia): number {
  const s = c.services_config || {};
  return SERVICOS_QUE_PESAM.filter((k) => s[k] === true).length;
}

export interface CargaDoDia {
  dia: DiaUtil;
  /** Clientes com o dia confirmado ou provisório. */
  clientes: number;
  /** Soma dos serviços desses clientes. */
  servicos: number;
  /** Tarefas abertas desses clientes. */
  entregas: number;
  /** Captações e gravações já marcadas neste dia da semana nas próximas semanas. */
  compromissos: number;
}

export interface Sugestao {
  dia: DiaUtil;
  motivos: string[];
  ranking: Array<{ dia: DiaUtil; carga: number }>;
}

/** Pesos da carga do dia (explicados nos motivos; a equipe pode trocar o dia sugerido). */
export const PESOS_DA_CARGA = { cliente: 1, servico: 0.25, entrega: 0.05, compromisso: 0.75 };

export const cargaDoDia = (c: CargaDoDia) =>
  Math.round((c.clientes * PESOS_DA_CARGA.cliente + c.servicos * PESOS_DA_CARGA.servico + c.entregas * PESOS_DA_CARGA.entrega + c.compromissos * PESOS_DA_CARGA.compromisso) * 100) / 100;

/**
 * Sugere o dia com menor carga, pulando os dias em que o cliente não pode. Empate: menos clientes no dia,
 * depois o dia mais cedo. Devolve null quando todos os dias estão indisponíveis (a equipe decide).
 * Nunca inventa disponibilidade do cliente: só respeita o que a equipe marcou.
 */
export function sugerirDia(cargas: CargaDoDia[], indisponiveis: number[] = []): Sugestao | null {
  const livres = cargas.filter((c) => ehDiaUtil(c.dia) && indisponiveis.indexOf(c.dia) < 0);
  if (!livres.length) return null;
  const ordenadas = livres
    .map((c) => ({ c, carga: cargaDoDia(c) }))
    .sort((a, b) => a.carga - b.carga || a.c.clientes - b.c.clientes || a.c.dia - b.c.dia);
  const melhor = ordenadas[0];
  const motivos = [
    `${melhor.c.clientes === 0 ? "Nenhum cliente" : melhor.c.clientes === 1 ? "1 cliente" : `${melhor.c.clientes} clientes`} na ${DIAS_UTEIS[melhor.c.dia - 1].nome} hoje.`,
  ];
  if (melhor.c.compromissos) motivos.push(`${melhor.c.compromissos} ${melhor.c.compromissos === 1 ? "captação marcada" : "captações marcadas"} nesse dia.`);
  else motivos.push("Sem captação marcada nesse dia.");
  if (ordenadas.length > 1) {
    const segunda = ordenadas[1];
    motivos.push(`Carga ${String(melhor.carga).replace(".", ",")} contra ${String(segunda.carga).replace(".", ",")} da ${DIAS_UTEIS[segunda.c.dia - 1].nome}, a segunda opção.`);
  }
  if (indisponiveis.length) motivos.push(`Pulei ${indisponiveis.filter(ehDiaUtil).map((d) => DIAS_UTEIS[d - 1].nome).join(", ")} (marcado como indisponível).`);
  return { dia: melhor.c.dia, motivos, ranking: ordenadas.map((o) => ({ dia: o.c.dia, carga: o.carga })) };
}

/**
 * Monta a carga de cada dia a partir dos dias já definidos, dos clientes, das tarefas abertas por cliente
 * e das captações (data YYYY-MM-DD). O cliente que está sendo sugerido não conta na própria carga.
 */
export function cargasDaSemana(entrada: {
  dias: Array<Pick<DiaPrioritarioDoCliente, "client_id" | "dia" | "situacao">>;
  clientes: ClienteParaODia[];
  tarefasAbertasPorCliente: Record<string, number>;
  captacoes: string[];
  ignorar?: string;
}): CargaDoDia[] {
  const porId = new Map(entrada.clientes.map((c) => [c.id, c]));
  return DIAS_UTEIS.map(({ dia }) => {
    const doDia = entrada.dias.filter((d) => d.client_id !== entrada.ignorar && diaNaOperacao(d) === dia);
    return {
      dia,
      clientes: doDia.length,
      servicos: doDia.reduce((s, d) => s + (porId.has(d.client_id) ? complexidadeDoCliente(porId.get(d.client_id) as ClienteParaODia) : 0), 0),
      entregas: doDia.reduce((s, d) => s + (entrada.tarefasAbertasPorCliente[d.client_id] || 0), 0),
      compromissos: entrada.captacoes.filter((data) => diaDaSemanaDaData(data) === dia).length,
    };
  });
}

// ------------------------------------------------------------------ captações e gravações

const PALAVRAS_DE_CAPTACAO = /\b(grava[cç][aã]o|gravar|capta[cç][aã]o|captar|filmagem|filmar|ensaio|sess[aã]o de fotos?|fotos? (no|na|do|da) (local|loja|empresa|cliente)|making of|b-?roll)\b/i;

/** A tarefa é uma gravação ou captação de foto e vídeo? (pelo título; tipo de entrega vídeo ajuda) */
export function ehCaptacao(t: { title?: string | null; delivery_type?: string | null; workstream?: string | null }): boolean {
  const titulo = String(t.title || "");
  return PALAVRAS_DE_CAPTACAO.test(titulo);
}

/** Uma captação nesta data coincide com o Dia Prioritário do cliente? (preferência, nunca trava) */
export function coincideComODia(data: string | null | undefined, dia: number | null | undefined): boolean | null {
  if (!data || !ehDiaUtil(dia)) return null;
  return diaDaSemanaDaData(data) === dia;
}

/** Texto curto para a equipe sobre a data de uma captação diante do Dia Prioritário. */
export function textoDaCaptacao(data: string | null | undefined, dia: number | null | undefined): string {
  const c = coincideComODia(data, dia);
  if (c === null) return "";
  return c ? "No Dia Prioritário" : `Fora do Dia Prioritário (${nomeDoDia(dia)})`;
}

// ------------------------------------------------------------------ para o Hermes

/** Como o Hermes usa o Dia Prioritário (vai na resposta de aceleriq_dia_prioritario). */
export const COMO_USAR_O_DIA_PRIORITARIO = [
  'O Dia Prioritário é o dia útil fixo de atenção estratégica de cada cliente recorrente. Não é o único dia de atendimento: monitoramento, rituais de segunda (Rota da Semana), quarta (Check do Meio da Semana) e sexta (Prova de Movimento), campanhas, entregas e urgências seguem a semana toda.',
  'ANTES do dia: leia o histórico e o dossiê do cliente, as entregas e pendências (tarefas abertas), resultados e campanhas quando houver dado e permissão; aponte oportunidades e riscos; adiante só tarefas internas já autorizadas; entregue ao CEO um resumo curto (o que mudou, o que está travado, o que perguntar ao cliente).',
  'DURANTE: destaque os clientes do dia, apoie a conversa com o histórico e as decisões, e registre o que aconteceu com aceleriq_dia_prioritario_registrar (ligação, reunião, mensagem, alinhamento ou sem necessidade de contato). Conversa não é obrigatória.',
  'DEPOIS: registre os combinados, transforme próximos passos em tarefas pelas ferramentas que já existem (aceleriq_create_task), delegue só o que é interno e autorizado e acompanhe até a verificação. Aprovação humana continua valendo onde já vale.',
  'Captações (gravação, fotos, vídeo): o Dia Prioritário é a preferência para marcar, nunca uma trava. Dependem de serviço contratado, necessidade real, planejamento, disponibilidade e confirmação prévia. Não reserve nem marque nada com o cliente sem confirmação.',
  'Nunca envie mensagem, ligue, publique, cobre ou mexa em campanha por conta do Dia Prioritário. Provisório é interno (o cliente não vê); "não se aplica" é sem recorrência ativa.',
].join(' ');
