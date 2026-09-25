/**
 * Método ACELERA (A.C.E.L.E.R.A): a condução do cliente pela Aceleriq.
 *
 * DE ONDE VEM CADA PEÇA (para o dono validar):
 * - As sete fases, os nomes e o propósito de cada uma JÁ EXISTEM no painel:
 *   src/lib/cycleTasks.ts (MethodPhase, PHASE_LABELS, PHASE_PURPOSE), tirados
 *   do site aceleriq.com em 17/08/2026 (Analisar, Clarear, Estruturar, Lançar,
 *   Executar, Revisar, Acelerar). O painel também tem a "Jornada ACELERA" de
 *   oito etapas (src/components/client/JourneyProgress.tsx), que hoje não é
 *   usada em nenhuma tela; aqui vale a de sete, que é a que o Ciclo mostra.
 * - A regra de em que fase o cliente está é a MESMA de phaseForClient
 *   (cycleTasks.ts): dias de casa, entrada concluída e semanas seguidas de
 *   rotina fechada. Um teste garante que as duas nunca divergem.
 * - INFERIDO (não estava escrito em lugar nenhum; montado a partir do que o
 *   sistema já faz: ciclo situação > pendência > etapa, rituais de segunda,
 *   quarta e sexta, dossiê): o que cada ritual conduz em cada fase, as
 *   tarefas típicas da fase e o sinal de que o cliente pode subir de fase.
 *   Está marcado com `inferido: true` em cada fase.
 *
 * Arquivo puro: sem Deno, sem banco. O Vitest cobre as regras.
 */

export type FaseAcelera =
  | "analisar"
  | "clarear"
  | "estruturar"
  | "lancar"
  | "executar"
  | "revisar"
  | "acelerar";

export const ORDEM_ACELERA: readonly FaseAcelera[] = [
  "analisar", "clarear", "estruturar", "lancar", "executar", "revisar", "acelerar",
];

/** Rituais da Central (mesmas chaves de ritual-writer e da Central). */
export type RitualDaCentral = "rota_semana" | "meio_semana" | "prova_movimento" | "radar_aceleriq" | "marco_90";

export interface FaseDoMetodo {
  fase: FaseAcelera;
  /** A letra da sigla A.C.E.L.E.R.A. */
  letra: string;
  nome: string;
  /** Igual ao PHASE_PURPOSE do Ciclo. */
  proposito: string;
  /** Como a agência conduz o cliente nesta fase (INFERIDO). */
  conducao: string;
  /** O trabalho de cada ritual nesta fase (INFERIDO). */
  ritual: { segunda: string; quarta: string; sexta: string };
  /** Tipos de tarefa que a fase costuma pedir (INFERIDO; espelha o acervo do Ciclo). */
  tarefasTipicas: string[];
  /** O sinal de que o cliente pode subir para a próxima fase (INFERIDO). */
  sinalDeAvanco: string;
  inferido: true;
}

export const METODO_ACELERA: Record<FaseAcelera, FaseDoMetodo> = {
  analisar: {
    fase: "analisar", letra: "A", nome: "Analisar",
    proposito: "Entender o terreno antes de agir: onde estão os gargalos.",
    conducao: "Diagnóstico: ler o negócio, o público, os concorrentes e o que já existe (perfil, anúncios, atendimento). Nada de promessa de resultado antes da leitura.",
    ritual: {
      segunda: "Apresenta o que vamos levantar nesta semana e por que o diagnóstico vem antes da execução.",
      quarta: "Mostra o que o levantamento já revelou e pede o que falta do cliente (acessos, materiais, respostas).",
      sexta: "Entrega a leitura da semana: o que descobrimos e o que isso muda no plano.",
    },
    tarefasTipicas: ["mapear concorrentes do nicho", "levantar perguntas que chegam no direct", "auditar perfil e anúncios existentes", "coletar acessos e materiais de marca"],
    sinalDeAvanco: "Diagnóstico registrado no dossiê e entrada concluída (nome, logo, identidade, acessos).",
    inferido: true,
  },
  clarear: {
    fase: "clarear", letra: "C", nome: "Clarear",
    proposito: "Definir público, oferta e promessa, para tudo falar a mesma língua.",
    conducao: "Alinhar com o dono a oferta que o mês sustenta, a promessa da marca e o público que vale a verba. Toda peça passa a nascer dessa definição.",
    ritual: {
      segunda: "Abre com a decisão que a semana precisa fechar (oferta, promessa ou público) e a proposta da agência.",
      quarta: "Mostra a versão escrita da definição e pede o aval ou o ajuste do cliente.",
      sexta: "Fecha com a definição aprovada e como ela já aparece nas peças.",
    },
    tarefasTipicas: ["escrever a promessa da marca em uma frase", "definir os pilares de conteúdo do mês", "escolher a oferta do mês", "alinhar tom de voz"],
    sinalDeAvanco: "Oferta, promessa e público escritos no dossiê e aprovados pelo cliente.",
    inferido: true,
  },
  estruturar: {
    fase: "estruturar", letra: "E", nome: "Estruturar",
    proposito: "Montar o caminho: atendimento, funil, rotina e follow-up.",
    conducao: "Montar a base que faz o resultado acontecer: calendário, caminho do contato até a venda, rotina de aprovação e resposta.",
    ritual: {
      segunda: "Apresenta a peça da base que entra nesta semana e o que ela destrava.",
      quarta: "Mostra a base em montagem e o que falta do cliente para ela ficar de pé.",
      sexta: "Prova a base montada (calendário, caminho do contato, rotina) e o que ela permite a partir de agora.",
    },
    tarefasTipicas: ["montar calendário do mês", "organizar caminho do contato até o orçamento", "configurar conta de anúncios", "definir rotina de aprovação"],
    sinalDeAvanco: "Calendário ativo, caminho do contato definido e rotina de aprovação funcionando.",
    inferido: true,
  },
  lancar: {
    fase: "lancar", letra: "L", nome: "Lançar",
    proposito: "Colocar de pé o que foi estruturado.",
    conducao: "Colocar na rua: primeiras publicações e campanhas do plano, com acompanhamento próximo dos primeiros sinais.",
    ritual: {
      segunda: "Abre com o que entra no ar nesta semana e o que esperamos ver primeiro.",
      quarta: "Mostra o que já está no ar e os primeiros sinais; o que depende do cliente vira a peça que falta.",
      sexta: "Fecha com o que foi ao ar e a primeira leitura dos números.",
    },
    tarefasTipicas: ["publicar a primeira sequência do calendário", "subir a primeira campanha", "acompanhar os primeiros contatos", "ajustar o que não rodou"],
    sinalDeAvanco: "Publicações e campanhas no ar com a primeira leitura de números registrada.",
    inferido: true,
  },
  executar: {
    fase: "executar", letra: "E", nome: "Executar",
    proposito: "Produzir e otimizar, semana após semana.",
    conducao: "Ritmo de operação: produzir, aprovar, publicar e ajustar toda semana, ligando cada entrega ao objetivo do cliente.",
    ritual: {
      segunda: "Abre com o plano da semana em cada frente contratada e a lógica da ordem.",
      quarta: "Mostra o que já saiu e o que entra até sexta, com o que depende do cliente pelo ganho.",
      sexta: "Prova o trabalho da semana com nome e número, e aponta o que a próxima constrói em cima disso.",
    },
    tarefasTipicas: ["produzir as peças da semana", "agendar publicações", "ajustar campanha pelo número", "responder ao que o público perguntou"],
    sinalDeAvanco: "Quatro semanas seguidas de rotina fechada e números lidos toda semana.",
    inferido: true,
  },
  revisar: {
    fase: "revisar", letra: "R", nome: "Revisar",
    proposito: "Ler os números e transformar em decisão.",
    conducao: "Olhar o que já roda com lupa: cortar o que rende menos, reforçar o que provou funcionar, trazer a decisão para o cliente.",
    ritual: {
      segunda: "Abre com a decisão da semana tirada dos números (o que corta, o que reforça).",
      quarta: "Mostra o efeito das primeiras mudanças e confirma com o cliente o rumo.",
      sexta: "Fecha com o antes e depois da decisão e o que ela ensinou.",
    },
    tarefasTipicas: ["comparar formatos que mais renderam", "pausar o que gasta sem retorno", "revisar oferta com base nos contatos", "registrar aprendizados no cérebro"],
    sinalDeAvanco: "Decisões tomadas pelos números e rotina estável há mais de quatro semanas.",
    inferido: true,
  },
  acelerar: {
    fase: "acelerar", letra: "A", nome: "Acelerar",
    proposito: "Escalar o que já provou que funciona.",
    conducao: "Escala: mais verba no que vende, mais formatos no que engaja, novas frentes apoiadas em resultado comprovado.",
    ritual: {
      segunda: "Abre com o movimento de escala da semana e o resultado que o justifica.",
      quarta: "Mostra como a escala está respondendo e onde colocar mais força.",
      sexta: "Fecha com o ganho da escala em número e a próxima alavanca.",
    },
    tarefasTipicas: ["aumentar verba da campanha que vende", "replicar o formato que mais engaja", "abrir nova frente com base no que funciona", "propor o próximo passo ao cliente"],
    sinalDeAvanco: "Fase de maturidade: o próximo passo é nova frente ou novo objetivo, combinado com o cliente.",
    inferido: true,
  },
};

/** Entrada da leitura de fase: mesmos campos do ClientPhaseInput do Ciclo. */
export interface EntradaDaFase {
  /** Entrada (onboarding) aberta significa cliente entrando na casa. */
  onboardingDone?: boolean;
  /** Dias desde o cadastro. */
  daysAsClient?: number;
  /** Semanas seguidas com a rotina fechada. */
  closedStreak?: number;
}

/**
 * Em que fase do método o cliente está, com o motivo em uma frase.
 * A decisão é IDÊNTICA a phaseForClient (src/lib/cycleTasks.ts).
 */
export function faseDoCliente(e: EntradaDaFase): { fase: FaseAcelera; motivo: string } {
  const dias = e.daysAsClient ?? 0;
  const sequencia = e.closedStreak ?? 0;
  if (e.onboardingDone === false) {
    return dias < 15
      ? { fase: "analisar", motivo: `entrada aberta e ${dias} dia(s) de casa` }
      : { fase: "clarear", motivo: `entrada ainda aberta depois de ${dias} dias` };
  }
  if (dias < 30) return { fase: "estruturar", motivo: `${dias} dias de casa, base em montagem` };
  if (dias < 60) return { fase: "lancar", motivo: `${dias} dias de casa, colocando a base na rua` };
  if (sequencia >= 4 && dias > 120) return { fase: "acelerar", motivo: `${dias} dias de casa e ${sequencia} semanas seguidas de rotina fechada` };
  if (dias > 90) return { fase: "revisar", motivo: `${dias} dias de casa, hora de decidir pelos números` };
  return { fase: "executar", motivo: `${dias} dias de casa, em ritmo de operação` };
}

export function faseSeguinte(fase: FaseAcelera): FaseAcelera | null {
  const i = ORDEM_ACELERA.indexOf(fase);
  return i >= 0 && i < ORDEM_ACELERA.length - 1 ? ORDEM_ACELERA[i + 1] : null;
}

const DIA_DO_RITUAL: Partial<Record<RitualDaCentral, "segunda" | "quarta" | "sexta">> = {
  rota_semana: "segunda",
  meio_semana: "quarta",
  prova_movimento: "sexta",
};

/**
 * O bloco que entra no prompt do ritual e do agente da Central: a fase, o
 * que ela pede, o que o ritual de hoje conduz nela e o sinal para subir.
 */
export function blocoDoMetodoParaPrompt(fase: FaseAcelera, ritual: string, motivo?: string): string {
  const f = METODO_ACELERA[fase] ?? METODO_ACELERA.executar;
  const dia = DIA_DO_RITUAL[ritual as RitualDaCentral];
  const proxima = faseSeguinte(f.fase);
  return [
    `MÉTODO ACELERA (A.C.E.L.E.R.A): o cliente está na fase ${f.letra} · ${f.nome}${motivo ? ` (${motivo})` : ""}.`,
    `Propósito da fase: ${f.proposito}`,
    `Como a gente conduz nesta fase: ${f.conducao}`,
    dia ? `O que o ritual de ${dia} conduz nesta fase: ${f.ritual[dia]}` : "",
    `Tarefas típicas desta fase (use só se houver fato que peça): ${f.tarefasTipicas.join("; ")}.`,
    proxima
      ? `Sinal para subir para ${METODO_ACELERA[proxima].nome}: ${f.sinalDeAvanco}`
      : `Sinal de maturidade: ${f.sinalDeAvanco}`,
    "Nunca cite o nome da fase como jargão para o cliente; mostre a condução pelo que ela significa no negócio dele.",
  ].filter(Boolean).join("\n");
}
