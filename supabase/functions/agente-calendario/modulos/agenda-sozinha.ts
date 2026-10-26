/**
 * Aprovou, agenda sozinho (27/10/2026). Diagnóstico de 26/10: 11 peças aprovadas sem data, 15 planejadas que
 * passaram da data e "publicar ao aprovar" usado em 2 de 132 trabalhos. Dono: o cliente aprovou e a peça não
 * tem data? O painel escolhe o próximo espaço do calendário e agenda pelo caminho de sempre.
 *
 * Tudo aqui é código, sem IA e sem rede: os fatos chegam de public.agenda_sozinha_fatos() (uma linha por
 * peça aprovada sem data, com a configuração e os dias ocupados do cliente) e sai, para cada peça, "agendar
 * em tal dia e hora" ou "pular, por quê". Quem grava é public.agenda_sozinha_aplicar(trabalho, quando), que
 * confere tudo de novo no banco (aprovação, dia livre, horário) antes da transição oficial 'schedule'.
 *
 * Regras do espaço:
 * - a meta da semana é a mesma da vigia (metaDoCliente: posts_por_mes do cliente ou 3 por semana);
 *   semana de segunda a domingo; semana cheia passa para a próxima;
 * - nunca dois posts no mesmo dia (conta tudo que já está no calendário: planejado com data, agendado e
 *   publicado, e o que esta rodada acabou de escolher);
 * - sábado e domingo só para o cliente com postar_fim_de_semana;
 * - o horário é o do cliente (melhor horário do tipo ou hora_publicacao), sempre entre 9h e 20h;
 * - hoje só se o horário ainda está a mais de 30 min; procura até 35 dias à frente.
 *
 * Sem import de Deno nem de npm além da vigia: a função e o Vitest leem este arquivo. Sem travessão.
 */

import { metaDoCliente } from "./vigia-do-calendario.ts";

export const HORA_MINIMA = "09:00";
export const HORA_MAXIMA = "20:00";
/** Folga entre agora e o horário de hoje para ainda valer hoje. */
export const FOLGA_DE_HOJE_MIN = 30;
/** Até onde procura um dia livre. */
export const DIAS_DE_BUSCA = 35;
/** Peça aprovada há mais que isso não entra sozinha (o assunto pode ter passado): só com incluirAntigas. */
export const DIAS_PARA_PECA_ANTIGA = 30;
export const FUSO_PADRAO = "America/Sao_Paulo";

export type PecaSemData = {
  trabalho_id: string;
  client_id: string;
  cliente?: string | null;
  titulo?: string | null;
  aprovado_em?: string | null;
  entrega_status?: string | null;
  entrega_aviso?: string | null;
  /** mesa_cliente_config.agendar_ao_aprovar (sem linha = ligado). */
  ligado: boolean;
  /** O dono tirou a data de propósito (publicar_em_desfeito_em): fica com a equipe. */
  desfeito?: boolean | null;
  /** O dono marcou "não vai postar" (publicacao_dispensada_em). */
  dispensada?: boolean | null;
  cliente_ativo?: boolean | null;
  tarefa_ok?: boolean | null;
  post_id?: string | null;
  publicacao_id?: string | null;
  publicacao_status?: string | null;
  publicacao_tem_data?: boolean | null;
  conta?: boolean | null;
  liberada?: boolean | null;
  /** "HH:MM" já decidido no banco (melhor horário do tipo ou o fixo do cliente). */
  hora?: string | null;
  fuso?: string | null;
  fim_de_semana?: boolean | null;
  posts_por_mes?: number | null;
  /** Dias (AAAA-MM-DD, no fuso do cliente) com post no calendário e quantos. */
  ocupados?: Array<{ dia: string; n: number }> | null;
};

export type DecisaoDaPeca =
  | { trabalho_id: string; client_id: string; cliente: string | null; titulo: string | null; acao: "agendar"; quando: string; dia: string; hora: string; motivo: string }
  | { trabalho_id: string; client_id: string; cliente: string | null; titulo: string | null; acao: "pular"; motivo: string };

// ------------------------------------------------------------------ datas e horas

const DIA_MS = 86_400_000;
const meio = (d: string) => Date.parse(`${String(d).slice(0, 10)}T12:00:00Z`);
export const somarDias = (d: string, n: number) => new Date(meio(d) + n * DIA_MS).toISOString().slice(0, 10);
export const diasEntre = (de: string, ate: string) => Math.round((meio(ate) - meio(de)) / DIA_MS);
/** 0 = domingo ... 6 = sábado. */
export const diaDaSemana = (d: string) => new Date(meio(d)).getUTCDay();
/** A segunda-feira da semana do dia (semana de segunda a domingo, como date_trunc('week')). */
export const segundaDaSemana = (d: string) => somarDias(d, -((diaDaSemana(d) + 6) % 7));
export const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

const HHMM = /^(\d{1,2}):(\d{2})/;
const minutos = (h: string) => {
  const m = HHMM.exec(String(h ?? ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** O horário do cliente dentro da janela 9h às 20h (sem horário, 9h). */
export function horaNaJanela(hora: string | null | undefined): string {
  const m = minutos(hora ?? "");
  if (!Number.isFinite(m)) return HORA_MINIMA;
  return hhmm(Math.min(minutos(HORA_MAXIMA), Math.max(minutos(HORA_MINIMA), m)));
}

/** Diferença (em minutos) entre o relógio do fuso e o UTC naquele instante. */
function deslocamentoMin(instante: Date, fuso: string): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(instante);
  const v = (t: string) => Number(partes.find((p) => p.type === t)?.value);
  const local = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour") % 24, v("minute"));
  return Math.round((local - Math.floor(instante.getTime() / 60_000) * 60_000) / 60_000);
}

/** Dia e hora locais (no fuso) de um instante. */
export function noFuso(instante: Date, fuso = FUSO_PADRAO): { dia: string; hora: string } {
  const local = new Date(instante.getTime() + deslocamentoMin(instante, fuso) * 60_000);
  return { dia: local.toISOString().slice(0, 10), hora: local.toISOString().slice(11, 16) };
}

/** O instante (ISO, UTC) de um dia e hora locais no fuso. */
export function localParaIso(dia: string, hora: string, fuso = FUSO_PADRAO): string {
  const ingenuo = Date.parse(`${dia}T${hora}:00Z`);
  const desloc = deslocamentoMin(new Date(ingenuo), fuso);
  return new Date(ingenuo - desloc * 60_000).toISOString();
}

// ------------------------------------------------------------------ o que impede

/** Por que esta peça não entra sozinha (null = pode). */
export function impedimento(p: PecaSemData, agora: Date, opcoes: { incluirAntigas?: boolean } = {}): string | null {
  if (!p.ligado) return "publicar ao aprovar está desligado para este cliente (Mesa, Entrega)";
  if (p.dispensada) return "o dono marcou que esta peça não vai ser postada";
  if (p.desfeito) return "o dono tirou a data desta peça: fica com a equipe";
  if (p.cliente_ativo === false) return "cliente fora da carteira ativa";
  if (p.tarefa_ok === false) return "o item da agenda foi apagado: a arte aprovada está em Arquivos";
  if (!p.post_id) return "a peça não está na Agenda (sem post): leve para a Agenda pela Entrega";
  if (!p.publicacao_id) return "o post não tem publicação do Instagram: ligue a conta do projeto na Agenda";
  if (p.publicacao_status && p.publicacao_status !== "planned") return `a publicação já está ${p.publicacao_status}`;
  if (p.publicacao_tem_data) return "a publicação já tem data";
  if (!p.conta) return "falta conectar a conta do Instagram";
  if (!p.liberada) return "a arte não está liberada (falta a aprovação)";
  if (!opcoes.incluirAntigas && p.aprovado_em) {
    const dias = Math.floor((agora.getTime() - Date.parse(p.aprovado_em)) / DIA_MS);
    if (dias > DIAS_PARA_PECA_ANTIGA) return `aprovada há ${dias} dias: confira se o assunto ainda vale e agende pela Entrega`;
  }
  return null;
}

// ------------------------------------------------------------------ o espaço

export type Calendario = {
  /** Posts por dia já no calendário (e os escolhidos nesta rodada). */
  porDia: Map<string, number>;
  meta_semana: number;
};

export function calendarioDoCliente(p: Pick<PecaSemData, "ocupados" | "posts_por_mes">): Calendario {
  const porDia = new Map<string, number>();
  for (const o of p.ocupados ?? []) {
    if (!o || !o.dia || !(Number(o.n) > 0)) continue;
    const d = String(o.dia).slice(0, 10);
    porDia.set(d, (porDia.get(d) ?? 0) + Number(o.n));
  }
  return { porDia, meta_semana: metaDoCliente(p.posts_por_mes).meta };
}

export function postsNaSemana(cal: Calendario, dia: string): number {
  const seg = segundaDaSemana(dia);
  let n = 0;
  for (let i = 0; i < 7; i++) n += cal.porDia.get(somarDias(seg, i)) ?? 0;
  return n;
}

/**
 * O próximo dia livre para a peça: dia sem post, semana abaixo da meta, fim de semana só se o cliente
 * posta, hoje só com o horário a mais de 30 min. Devolve dia e hora locais, ou null.
 */
export function proximoEspaco(
  cal: Calendario,
  a: { hoje: string; agoraHora: string; hora: string; fimDeSemana: boolean },
): { dia: string; hora: string } | null {
  const hora = horaNaJanela(a.hora);
  for (let i = 0; i < DIAS_DE_BUSCA; i++) {
    const dia = somarDias(a.hoje, i);
    const sd = diaDaSemana(dia);
    if (!a.fimDeSemana && (sd === 0 || sd === 6)) continue;
    if (i === 0 && minutos(hora) - minutos(a.agoraHora) < FOLGA_DE_HOJE_MIN) continue;
    if ((cal.porDia.get(dia) ?? 0) > 0) continue;
    if (postsNaSemana(cal, dia) >= cal.meta_semana) continue;
    return { dia, hora };
  }
  return null;
}

// ------------------------------------------------------------------ a rodada

/**
 * As decisões da rodada, na ordem de aprovação (a mais antiga primeiro). O calendário de cada cliente é
 * montado uma vez e cada escolha ocupa o dia, então duas peças do mesmo cliente nunca caem no mesmo dia.
 */
export function escolherEspacos(pecas: PecaSemData[], agora: Date, opcoes: { incluirAntigas?: boolean } = {}): DecisaoDaPeca[] {
  const calendarios = new Map<string, Calendario>();
  const ordenadas = [...(pecas ?? [])].filter((p) => p && p.trabalho_id && p.client_id)
    .sort((a, b) => String(a.aprovado_em ?? "").localeCompare(String(b.aprovado_em ?? "")) || a.trabalho_id.localeCompare(b.trabalho_id));
  const saida: DecisaoDaPeca[] = [];
  for (const p of ordenadas) {
    const base = { trabalho_id: p.trabalho_id, client_id: p.client_id, cliente: p.cliente ?? null, titulo: p.titulo ?? null };
    const motivo = impedimento(p, agora, opcoes);
    if (motivo) { saida.push({ ...base, acao: "pular", motivo }); continue; }
    let cal = calendarios.get(p.client_id);
    if (!cal) { cal = calendarioDoCliente(p); calendarios.set(p.client_id, cal); }
    const fuso = p.fuso || FUSO_PADRAO;
    const agoraLocal = noFuso(agora, fuso);
    const espaco = proximoEspaco(cal, { hoje: agoraLocal.dia, agoraHora: agoraLocal.hora, hora: p.hora ?? HORA_MINIMA, fimDeSemana: p.fim_de_semana === true });
    if (!espaco) {
      saida.push({ ...base, acao: "pular", motivo: `sem dia livre nas próximas ${DIAS_DE_BUSCA / 7} semanas dentro da meta de ${cal.meta_semana} por semana` });
      continue;
    }
    cal.porDia.set(espaco.dia, (cal.porDia.get(espaco.dia) ?? 0) + 1);
    saida.push({
      ...base,
      acao: "agendar",
      dia: espaco.dia,
      hora: espaco.hora,
      quando: localParaIso(espaco.dia, espaco.hora, fuso),
      motivo: `próximo dia livre dentro da meta de ${cal.meta_semana} por semana: ${ddmm(espaco.dia)} às ${espaco.hora}`,
    });
  }
  return saida;
}
