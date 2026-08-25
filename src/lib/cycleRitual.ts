import { CYCLES, type CycleArea } from "@/lib/cycleDefs";
import type { MethodPhase } from "@/lib/cycleTasks";

/**
 * A mensagem que a equipe copia do Ciclo e manda para o cliente.
 *
 * A versão anterior listava as etapas concluídas e parava aí. Funcionava como
 * comprovante e falhava como comunicação: o cliente lia "posts agendados,
 * painel atualizado" e não sabia por que aquilo era bom para ele, nem o que
 * viria depois. Duas semanas assim e a mensagem vira ruído que ninguém abre.
 *
 * Agora a mensagem responde três perguntas, nessa ordem:
 *   o que saiu · por que isso importa agora · o que vem
 *
 * As regras de tom são as mesmas do resto do painel, e não são estilo:
 *   · nada de ausência — o que ainda não saiu é dito como "em produção",
 *     nunca como pendência, atraso ou cobrança;
 *   · nada de nome interno — "etapa 3" e parênteses técnicos ficam de fora;
 *   · nada inventado — sem etapa concluída, a mensagem fala da construção da
 *     semana em vez de fabricar resultado.
 */

export interface RitualInput {
  clientName: string;
  area: CycleArea;
  /** Segunda-feira da semana, em AAAA-MM-DD. */
  weekStart: string;
  doneSteps: number[];
  totalSteps: number;
  /** As etapas daquele cliente naquela semana (três giram). */
  stepNames?: string[];
  /** Trabalhos fora da rotina, já marcados como feitos. */
  avulsosFeitos?: string[];
  /** Semanas seguidas fechando o ciclo, para falar de continuidade. */
  sequencia?: number;
  /** Onde o cliente está no método, para explicar o porquê. */
  phase?: MethodPhase;
  /**
   * Fatos lidos do painel na hora de montar a mensagem (posts no ar,
   * agenda armada, contatos da semana). São eles que tiram a mensagem do
   * genérico: a frase da fase é a mesma por semanas; o fato é desta.
   */
  fatos?: string[];
}

/**
 * O que o painel sabe da semana, dito na língua do cliente.
 *
 * Regra dura: daqui só sai fato POSITIVO ou convite claro. Pendência,
 * atraso e leitura interna ficam no Ciclo — o cliente nunca recebe a
 * mecânica de dentro de casa.
 */
export function fatosDoPainel(input: {
  area: CycleArea;
  publicadosNaSemana: number;
  agendados: number;
  proximoAgendado: string | null;
  aguardandoAprovacao: number;
  leads7d: number;
  compras?: number;
}): string[] {
  const fatos: string[] = [];
  if (input.area === "social") {
    if (input.publicadosNaSemana > 0) {
      fatos.push(
        input.publicadosNaSemana === 1
          ? "1 publicação foi ao ar nos últimos dias"
          : `${input.publicadosNaSemana} publicações foram ao ar nos últimos dias`,
      );
    }
    if (input.agendados > 0 && input.proximoAgendado) {
      const d = new Date(input.proximoAgendado);
      const quando = d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
      fatos.push(
        input.agendados === 1
          ? `o próximo post já está agendado e sai ${quando}`
          : `os próximos ${input.agendados} posts já estão agendados — o primeiro sai ${quando}`,
      );
    }
    // Convite, não cobrança: aprovar é participação do cliente no fluxo.
    if (input.aguardandoAprovacao > 0) {
      fatos.push(
        input.aguardandoAprovacao === 1
          ? "tem 1 peça nova esperando o seu ok no painel"
          : `tem ${input.aguardandoAprovacao} peças novas esperando o seu ok no painel`,
      );
    }
  } else {
    if (input.leads7d > 0) {
      fatos.push(
        input.leads7d === 1
          ? "as campanhas trouxeram 1 contato novo nesta semana"
          : `as campanhas trouxeram ${input.leads7d} contatos novos nesta semana`,
      );
      if ((input.compras ?? 0) > 0) {
        fatos.push(
          input.compras === 1
            ? "e 1 já virou venda"
            : `e ${input.compras} já viraram venda`,
        );
      }
    }
  }
  return fatos;
}

/** O porquê da semana, pela fase em que o cliente está. */
const PORQUE: Record<MethodPhase, string> = {
  analisar:
    "Estamos na leitura do seu negócio: cada peça desta semana serve para descobrir o que o seu público responde melhor.",
  clarear:
    "Estamos afinando a mensagem: o que sai agora existe para deixar claro, para quem vê, o que a sua marca faz e para quem.",
  estruturar:
    "Estamos montando a base: presença constante é o que faz o público começar a reconhecer a marca sem esforço.",
  lancar:
    "Estamos colocando a estrutura na rua: é a fase em que o movimento começa a aparecer para fora.",
  executar:
    "Estamos em ritmo de operação: a constância é o que sustenta o resultado e faz a marca ocupar espaço toda semana.",
  revisar:
    "Estamos revisando o que já roda: o trabalho agora é cortar o que rende menos e reforçar o que provou funcionar.",
  acelerar:
    "Estamos em fase de escala: com a rotina firme, o esforço vai para ampliar o que já dá retorno.",
};

const MES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** "11 a 17 de agosto" — a semana do jeito que se fala. */
export function periodoDaSemana(weekStart: string): string {
  const [ano, mes, dia] = weekStart.split("-").map(Number);
  if (!ano || !mes || !dia) return "";
  const inicio = new Date(ano, mes - 1, dia);
  const fim = new Date(ano, mes - 1, dia + 6);
  const mesFim = MES[fim.getMonth()];
  if (inicio.getMonth() === fim.getMonth()) {
    return `${inicio.getDate()} a ${fim.getDate()} de ${mesFim}`;
  }
  return `${inicio.getDate()} de ${MES[inicio.getMonth()]} a ${fim.getDate()} de ${mesFim}`;
}

/** Tira o parêntese técnico e deixa a etapa legível numa frase. */
function legivel(nome: string): string {
  return nome.replace(/\s*\(.*?\)\s*/g, "").trim().toLowerCase();
}

export function weekRitualMessage(input: RitualInput): string {
  const nomes = input.stepNames?.length ? input.stepNames : CYCLES[input.area].steps;
  const feitas = input.doneSteps
    .filter((step) => step >= 1 && step <= nomes.length)
    .sort((a, b) => a - b)
    .map((step) => legivel(nomes[step - 1]));
  const avulsos = (input.avulsosFeitos || []).map((texto) => texto.trim()).filter(Boolean);
  const entregues = [...feitas, ...avulsos];

  const cabecalho = `${input.clientName} · ${CYCLES[input.area].label}`;
  const periodo = periodoDaSemana(input.weekStart);
  const linhas: string[] = [periodo ? `${cabecalho} — semana de ${periodo}` : cabecalho, ""];

  if (entregues.length === 0) {
    // Semana recém-começada não é semana vazia. Falar de produção é verdade e
    // não deixa o cliente com a sensação de que ninguém tocou no projeto.
    linhas.push("A semana está em produção por aqui. Assim que as primeiras entregas saírem, você recebe por aqui mesmo.");
    if (input.phase) linhas.push("", PORQUE[input.phase]);
    return linhas.join("\n");
  }

  linhas.push("O que saiu esta semana:");
  for (const item of entregues) linhas.push(`· ${item}`);

  // Os fatos do painel vêm ANTES do porquê da fase: o fato é desta
  // semana e deste cliente; a frase da fase repete por semanas. A ordem
  // é o que impede a mensagem de abrir com o texto que ele já leu.
  const fatos = (input.fatos || []).filter(Boolean);
  if (fatos.length > 0) {
    linhas.push("", "Pelo painel:");
    for (const fato of fatos) linhas.push(`· ${fato}`);
  }

  if (input.phase) {
    linhas.push("", PORQUE[input.phase]);
  }

  const restantes = input.totalSteps - feitas.length;
  if (restantes > 0) {
    linhas.push(
      "",
      restantes === 1
        ? "A última frente da semana segue em produção e chega até você."
        : "O restante da semana segue em produção e chega até você.",
    );
  } else {
    linhas.push("", "Semana completa: tudo o que estava previsto saiu.");
  }

  // Continuidade só entra quando existe de fato. Anunciar "1ª semana seguida"
  // não diz nada; a partir de duas, vira prova de constância.
  if ((input.sequencia ?? 0) >= 2) {
    linhas.push("", `É a ${input.sequencia}ª semana seguida com o ciclo fechado.`);
  }

  return linhas.join("\n");
}
