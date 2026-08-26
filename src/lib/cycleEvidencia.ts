import type { CycleArea } from "@/lib/cycleDefs";
import type { SituacaoDoCliente } from "@/lib/cycleSituation";
import { textoDaEtapa, type Pendencia } from "@/lib/cycleSuggest";

/**
 * O painel provando a etapa: o que já está feito lá dentro não pode
 * aparecer como pendente aqui.
 *
 * O relato do dono, inteiro: "se for atualizado tudo lá dentro pelo painel,
 * o ciclo já reconhece e coloca como concluído, sem precisar. Se não, ele
 * fica pendente e eu não quero que fique pendente. Quero que converse em
 * tudo, enxergue geral."
 *
 * A régua é uma só: **só conta como feito o que o painel PROVA**. Nada de
 * inferência simpática — a prova é um fato consultável (arte pronta, post
 * agendado, diário escrito, campanha no ar), e o texto da prova vai junto
 * para a tela poder dizer POR QUE marcou sozinho. Sem prova, a etapa segue
 * pendente e espera a mão de alguém.
 *
 * Nada aqui grava: a prova é lida na hora. Se o fato sumir do painel (o
 * agendamento foi cancelado, a arte foi despublicada), a etapa volta a
 * pedir atenção sozinha — que é o oposto de marcar no banco e mentir para
 * sempre.
 */

/** Fatia da situação que a prova consulta. Facilita o teste falar dela. */
export type FatosDaProva = Pick<
  SituacaoDoCliente,
  | "artesProntas"
  | "agendados"
  | "publicadosNaSemana"
  | "ultimoDiario"
  | "campanhasAtivas"
>;

/** Quantos dias o diário pode ficar parado e a etapa ainda contar como feita. */
const DIAS_DE_DIARIO_VALIDO = 7;

const diasDesde = (iso: string, agoraMs: number) =>
  Math.floor((agoraMs - new Date(iso).getTime()) / 86_400_000);

/**
 * As três etapas fixas de cada frente, provadas pelo painel.
 *
 * A chave é (área, passo) e não o rótulo: o passo é o que fica gravado, e
 * consertar um texto na tela não pode desligar o reconhecimento em silêncio.
 */
function provaDaEtapaFixa(
  area: CycleArea,
  step: number,
  fatos: FatosDaProva,
  agoraMs: number,
): string | null {
  const diario =
    fatos.ultimoDiario && diasDesde(fatos.ultimoDiario, agoraMs) <= DIAS_DE_DIARIO_VALIDO
      ? diasDesde(fatos.ultimoDiario, agoraMs)
      : null;

  if (step === 1) {
    // Conteúdo/criativo da semana: arte pronta é arte aprovada e travada.
    if (fatos.artesProntas > 0) {
      return `${fatos.artesProntas} ${fatos.artesProntas === 1 ? "arte pronta" : "artes prontas"} no painel`;
    }
    return null;
  }

  if (step === 4) {
    // Painel atualizado: o diário é a prova de que alguém passou por lá.
    if (diario === null) return null;
    return diario === 0 ? "diário escrito hoje" : `diário escrito há ${diario} ${diario === 1 ? "dia" : "dias"}`;
  }

  if (step === 6) {
    if (area === "social") {
      if (fatos.agendados > 0) {
        return `${fatos.agendados} ${fatos.agendados === 1 ? "post agendado" : "posts agendados"}`;
      }
      // Semana que já publicou não pode cobrar agendamento: saiu, está no ar.
      if (fatos.publicadosNaSemana > 0) {
        return `${fatos.publicadosNaSemana} ${fatos.publicadosNaSemana === 1 ? "post publicado" : "posts publicados"} nesta semana`;
      }
      return null;
    }
    if (fatos.campanhasAtivas > 0) {
      return `${fatos.campanhasAtivas} ${fatos.campanhasAtivas === 1 ? "campanha no ar" : "campanhas no ar"}`;
    }
    return null;
  }

  return null;
}

/** Todos os textos que uma pendência pode virar, para reconhecer a etapa. */
const CHAVES_DE_PENDENCIA = [
  "perderam-data", "recusadas", "aprovacao-parada", "sem-agenda", "agenda-curta",
  "sem-arte", "diario-parado", "diario-vazio", "pauta-sem-arte",
  "sem-campanha-cadastrada", "nenhuma-ativa", "verba-zerada", "dado-parado",
  "tarefa-atrasada", "tarefa-sem-dono", "conexao-caida", "semana-pior",
  "verba-sem-lead", "criativo-saturado", "sem-metrica", "metrica-parada",
];

const TEXTOS_DE_PENDENCIA = new Set(
  CHAVES_DE_PENDENCIA.map((chave) =>
    textoDaEtapa({ chave, texto: "", gravidade: "atencao", viraEtapa: true }),
  ),
);

/**
 * A prova de uma etapa da semana, ou `null` quando o painel não prova nada.
 *
 * Duas famílias:
 *
 *  1. Etapa FIXA (passos 1, 4 e 6): o fato correspondente no painel.
 *  2. Etapa que veio de PENDÊNCIA: a prova é o problema ter sumido. O
 *     rótulo é deterministico por chave, então basta ver se alguma
 *     pendência ainda produz aquele texto. As pendências recebidas aqui
 *     precisam ser as REAIS (sem o filtro do que virou tarefa): pendência
 *     encaminhada para o Kanban saiu do alerta, mas não foi resolvida — e
 *     dar a etapa por feita nesse caso seria o falso positivo de sempre.
 *
 * Etapa do acervo (trabalho que o painel não registra) nunca é provada: ela
 * espera a marcação de quem fez.
 */
export function provaDaEtapa(input: {
  area: CycleArea;
  step: number;
  rotulo: string;
  fatos?: FatosDaProva | null;
  /** As pendências REAIS do cliente, sem filtro de encaminhamento. */
  pendenciasReais?: Pendencia[] | null;
  agoraMs: number;
}): string | null {
  const { area, step, rotulo, fatos, pendenciasReais, agoraMs } = input;
  // Sem dados não se afirma nada: silêncio é pendente, nunca "feito".
  if (!fatos) return null;

  const fixa = provaDaEtapaFixa(area, step, fatos, agoraMs);
  if (fixa) return fixa;

  const texto = rotulo.trim();
  if (!texto || !TEXTOS_DE_PENDENCIA.has(texto)) return null;
  if (!pendenciasReais) return null;

  const aindaDoi = pendenciasReais.some((p) => textoDaEtapa(p) === texto);
  return aindaDoi ? null : "o painel mostra isso resolvido";
}
