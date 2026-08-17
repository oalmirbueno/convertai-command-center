import type { CycleArea } from "@/lib/cycleDefs";

/**
 * As etapas da semana, organizadas pelo método A.C.E.L.E.R.A.
 *
 * O ciclo tinha seis etapas fixas, iguais para todo cliente e toda semana.
 * Depois de um mês, marcar virava burocracia: o checklist não dizia nada
 * sobre o que aquela semana tinha de diferente, nem sobre onde aquele cliente
 * estava na jornada.
 *
 * Agora três etapas continuam fixas, porque são o esqueleto que acontece toda
 * semana sem exceção (criar o conteúdo, atualizar o painel, agendar). As
 * outras três saem de um acervo grande, filtrado por:
 *
 *  • a FASE do método em que aquele cliente está (quem acabou de entrar
 *    precisa de Analisar e Clarear; quem já roda há meses precisa de Revisar
 *    e Acelerar);
 *  • os SERVIÇOS que ele contratou (não adianta tarefa de CRM para quem só
 *    tem conteúdo);
 *  • o que ele já viu nas últimas semanas, para não repetir.
 *
 * Cada tarefa existe por um de dois motivos, nunca por preenchimento: gerar
 * resultado para o negócio dele, ou tornar visível um trabalho que ele paga e
 * não enxerga.
 *
 * A escolha é DETERMINÍSTICA: mesmo cliente, mesma semana, mesmas etapas,
 * sempre. Isso é obrigatório, porque a marcação guarda só o número da etapa;
 * se o sorteio mudasse, a etapa 5 marcada hoje significaria outra coisa
 * amanhã e o histórico viraria mentira.
 */

/** As sete fases do método, na ordem em que o cliente as percorre. */
export type MethodPhase =
  | "analisar"
  | "clarear"
  | "estruturar"
  | "lancar"
  | "executar"
  | "revisar"
  | "acelerar";

export const PHASE_LABELS: Record<MethodPhase, string> = {
  analisar: "Analisar",
  clarear: "Clarear",
  estruturar: "Estruturar",
  lancar: "Lançar",
  executar: "Executar",
  revisar: "Revisar",
  acelerar: "Acelerar",
};

export const PHASE_PURPOSE: Record<MethodPhase, string> = {
  analisar: "Entender o terreno antes de agir: onde estão os gargalos.",
  clarear: "Definir público, oferta e promessa, para tudo falar a mesma língua.",
  estruturar: "Montar o caminho: atendimento, funil, rotina e follow-up.",
  lancar: "Colocar de pé o que foi estruturado.",
  executar: "Produzir e otimizar, semana após semana.",
  revisar: "Ler os números e transformar em decisão.",
  acelerar: "Escalar o que já provou que funciona.",
};

export interface CycleTask {
  label: string;
  phase: MethodPhase;
  /** Serviço do cadastro exigido para a tarefa fazer sentido. */
  requires?: string;
  /** resultado = move o ponteiro do negócio; vitrine = mostra o trabalho. */
  intent: "resultado" | "vitrine";
}

export interface CycleStepSlot {
  step: number;
  label: string;
  fixed: boolean;
  phase?: MethodPhase;
  intent?: CycleTask["intent"];
}

/** O esqueleto: acontece toda semana, para todo cliente. */
const CORE: Record<CycleArea, Record<number, string>> = {
  social: {
    1: "Conteúdo da semana criado (artes e legendas)",
    4: "Painel atualizado (arquivos, agenda e diário)",
    6: "Posts agendados (publicação automática armada)",
  },
  trafego: {
    1: "Criativos da semana prontos",
    4: "Painel atualizado (registro e leitura para o cliente)",
    6: "Anúncios no ar ou programados",
  },
};

/**
 * O acervo. Cada linha é trabalho que a agência faz de verdade, amarrado à
 * fase do método e ao serviço que o cliente paga.
 */
const CATALOG: Record<CycleArea, CycleTask[]> = {
  social: [
    // Analisar
    { label: "Mapear os 3 concorrentes que mais aparecem no nicho", phase: "analisar", intent: "resultado" },
    { label: "Levantar as perguntas que mais chegam no direct", phase: "analisar", intent: "resultado" },
    { label: "Revisar o perfil inteiro com olhos de cliente novo", phase: "analisar", intent: "vitrine" },
    { label: "Listar os assuntos que já deram resultado antes", phase: "analisar", intent: "resultado" },
    { label: "Conferir de onde vem quem chega no perfil", phase: "analisar", intent: "resultado" },
    // Clarear
    { label: "Escrever a promessa da marca em uma frase", phase: "clarear", intent: "resultado" },
    { label: "Definir os 3 pilares de conteúdo do mês", phase: "clarear", intent: "resultado" },
    { label: "Alinhar tom de voz com o dono do negócio", phase: "clarear", intent: "vitrine" },
    { label: "Escolher a oferta que o mês inteiro vai sustentar", phase: "clarear", intent: "resultado" },
    { label: "Revisar bio e destaques com a promessa nova", phase: "clarear", intent: "vitrine" },
    // Estruturar
    { label: "Montar o calendário do próximo mês", phase: "estruturar", intent: "resultado" },
    { label: "Criar modelo de resposta para as dúvidas repetidas", phase: "estruturar", intent: "resultado" },
    { label: "Organizar o banco de fotos e vídeos do cliente", phase: "estruturar", intent: "vitrine" },
    { label: "Definir a rotina de captação de material com o cliente", phase: "estruturar", intent: "resultado" },
    { label: "Preparar 3 pautas de reserva para semana corrida", phase: "estruturar", intent: "resultado" },
    // Lançar
    { label: "Publicar o conteúdo âncora do mês", phase: "lancar", intent: "resultado" },
    { label: "Ativar a sequência de stories da oferta", phase: "lancar", intent: "resultado" },
    { label: "Estrear o formato novo combinado com o cliente", phase: "lancar", intent: "vitrine" },
    { label: "Colocar o link de contato no ar e testar", phase: "lancar", intent: "resultado" },
    // Executar
    { label: "Gravar ou editar um vídeo curto (reel)", phase: "executar", intent: "resultado" },
    { label: "Responder comentários e mensagens do período", phase: "executar", intent: "resultado" },
    { label: "Planejar os stories da semana", phase: "executar", intent: "resultado" },
    { label: "Revisar legendas com chamada para ação clara", phase: "executar", intent: "resultado" },
    { label: "Enviar aprovação ao cliente e cobrar até quarta", phase: "executar", intent: "vitrine" },
    { label: "Conferir as contas conectadas no painel", phase: "executar", intent: "vitrine" },
    { label: "Alimentar o banco de ideias com 3 pautas", phase: "executar", intent: "resultado" },
    { label: "Repostar o melhor conteúdo do mês passado", phase: "executar", intent: "resultado" },
    // Revisar
    { label: "Ler as métricas da semana e anotar a leitura", phase: "revisar", intent: "vitrine" },
    { label: "Comparar o alcance com as duas semanas anteriores", phase: "revisar", intent: "resultado" },
    { label: "Identificar o post que mais gerou conversa", phase: "revisar", intent: "resultado" },
    { label: "Checar se o conteúdo virou contato de verdade", phase: "revisar", intent: "resultado" },
    { label: "Mandar ao cliente um print do que funcionou", phase: "revisar", intent: "vitrine" },
    // Acelerar
    { label: "Impulsionar o conteúdo que já provou resultado", phase: "acelerar", intent: "resultado", requires: "trafego" },
    { label: "Transformar o melhor post em série de conteúdo", phase: "acelerar", intent: "resultado" },
    { label: "Levar o formato campeão para outro canal", phase: "acelerar", intent: "resultado" },
    { label: "Propor ao cliente o próximo passo de crescimento", phase: "acelerar", intent: "vitrine" },
    { label: "Documentar o que funcionou para virar padrão", phase: "acelerar", intent: "vitrine" },
  ],
  trafego: [
    // Analisar
    { label: "Mapear os anúncios que a concorrência está rodando", phase: "analisar", intent: "resultado" },
    { label: "Levantar o custo por contato dos últimos 30 dias", phase: "analisar", intent: "resultado" },
    { label: "Conferir se o rastreamento está medindo certo", phase: "analisar", intent: "resultado" },
    { label: "Revisar quais campanhas nunca deram retorno", phase: "analisar", intent: "resultado" },
    // Clarear
    { label: "Definir a oferta que a campanha vai carregar", phase: "clarear", intent: "resultado" },
    { label: "Escrever a promessa do anúncio em uma linha", phase: "clarear", intent: "resultado" },
    { label: "Definir o público que vale a verba deste mês", phase: "clarear", intent: "resultado" },
    { label: "Alinhar com o cliente o que é um bom contato", phase: "clarear", intent: "vitrine" },
    // Estruturar
    { label: "Revisar a estrutura de campanhas e conjuntos", phase: "estruturar", intent: "resultado" },
    { label: "Conferir a página de destino ponta a ponta", phase: "estruturar", intent: "resultado", requires: "site" },
    { label: "Verificar pixel e eventos de conversão", phase: "estruturar", intent: "resultado" },
    { label: "Montar o público de remarketing", phase: "estruturar", intent: "resultado" },
    { label: "Organizar a rotina de repasse de leads ao cliente", phase: "estruturar", intent: "vitrine" },
    { label: "Configurar a resposta automática do primeiro contato", phase: "estruturar", intent: "resultado", requires: "automacao" },
    // Lançar
    { label: "Subir a campanha nova e acompanhar as primeiras horas", phase: "lancar", intent: "resultado" },
    { label: "Testar o criativo novo contra o atual", phase: "lancar", intent: "resultado" },
    { label: "Ativar o remarketing da oferta", phase: "lancar", intent: "resultado" },
    // Executar
    { label: "Revisar as campanhas ativas uma a uma", phase: "executar", intent: "resultado" },
    { label: "Conferir verba e ritmo de gasto", phase: "executar", intent: "vitrine" },
    { label: "Pausar o anúncio de pior desempenho", phase: "executar", intent: "resultado" },
    { label: "Renovar o criativo que já saturou", phase: "executar", intent: "resultado" },
    { label: "Testar um público novo", phase: "executar", intent: "resultado" },
    { label: "Conferir os leads recebidos com o cliente", phase: "executar", intent: "vitrine" },
    { label: "Ajustar lances e distribuição de orçamento", phase: "executar", intent: "resultado" },
    // Revisar
    { label: "Ler os números da semana e anotar a decisão", phase: "revisar", intent: "vitrine" },
    { label: "Calcular o custo por contato da semana", phase: "revisar", intent: "resultado" },
    { label: "Comparar o resultado com o mês anterior", phase: "revisar", intent: "resultado" },
    { label: "Perguntar ao cliente quantos viraram venda", phase: "revisar", intent: "resultado" },
    { label: "Atualizar o relatório de resultados no painel", phase: "revisar", intent: "vitrine" },
    // Acelerar
    { label: "Aumentar a verba da campanha que está performando", phase: "acelerar", intent: "resultado" },
    { label: "Escalar o criativo campeão para novos públicos", phase: "acelerar", intent: "resultado" },
    { label: "Abrir um canal novo com o que já funciona", phase: "acelerar", intent: "resultado" },
    { label: "Propor ao cliente o próximo salto de investimento", phase: "acelerar", intent: "vitrine" },
    { label: "Documentar a campanha vencedora como padrão", phase: "acelerar", intent: "vitrine" },
  ],
};

/** Posições que giram, na ordem em que aparecem no ciclo. */
const ROTATING_SLOTS = [2, 3, 5];

export interface ClientPhaseInput {
  /** Onboarding aberto significa cliente entrando na casa. */
  onboardingDone?: boolean;
  /** Dias desde o cadastro. */
  daysAsClient?: number;
  /** Semanas seguidas com o ciclo fechado: prova de rotina madura. */
  closedStreak?: number;
}

/**
 * Em que fase do método aquele cliente está.
 *
 * A leitura é da evolução real: quem entrou agora precisa de diagnóstico;
 * quem já tem meses de casa e rotina fechando precisa de escala. Fases
 * adjacentes também entram na escolha, porque a vida não é uma escada
 * perfeita: um cliente maduro ainda revisa, um cliente novo já executa.
 */
export function phaseForClient(input: ClientPhaseInput): MethodPhase {
  const dias = input.daysAsClient ?? 0;
  const sequencia = input.closedStreak ?? 0;

  if (input.onboardingDone === false) return dias < 15 ? "analisar" : "clarear";
  if (dias < 30) return "estruturar";
  if (dias < 60) return "lancar";
  if (sequencia >= 4 && dias > 120) return "acelerar";
  if (dias > 90) return "revisar";
  return "executar";
}

/** As fases que alimentam a semana: a atual, a anterior e a seguinte. */
function phasePool(phase: MethodPhase): MethodPhase[] {
  const ordem: MethodPhase[] = [
    "analisar", "clarear", "estruturar", "lancar", "executar", "revisar", "acelerar",
  ];
  const indice = ordem.indexOf(phase);
  return [
    phase,
    ordem[Math.max(0, indice - 1)],
    ordem[Math.min(ordem.length - 1, indice + 1)],
    // Executar sempre entra: é o trabalho que sustenta qualquer fase.
    "executar",
  ].filter((valor, posicao, lista) => lista.indexOf(valor) === posicao);
}

function seedFrom(text: string): number {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export interface StepsOptions {
  /** Serviços marcados no cadastro do cliente. */
  services?: Record<string, unknown> | null;
  phase?: MethodPhase;
  phaseInput?: ClientPhaseInput;
}

/**
 * As seis etapas daquele cliente naquela semana, na ordem do ciclo.
 */
export function stepsForWeek(
  area: CycleArea,
  clientId: string,
  weekKey: string,
  options?: StepsOptions,
): CycleStepSlot[] {
  const fase = options?.phase
    ?? (options?.phaseInput ? phaseForClient(options.phaseInput) : "executar");
  const pool = phasePool(fase);
  const servicos = options?.services || {};

  // Só tarefas da fase (e vizinhas) cujo serviço o cliente realmente paga.
  const elegiveis = CATALOG[area].filter((tarefa) => {
    if (tarefa.requires && servicos[tarefa.requires] !== true) return false;
    return pool.includes(tarefa.phase);
  });
  const catalogo = elegiveis.length >= 3 ? elegiveis : CATALOG[area];

  const semente = seedFrom(`${clientId}:${area}:${weekKey}`);
  const escolhidas: CycleTask[] = [];
  const usados = new Set<number>();
  for (let i = 0; i < ROTATING_SLOTS.length; i += 1) {
    let indice = (semente + i * 7) % catalogo.length;
    let tentativas = 0;
    while (usados.has(indice) && tentativas < catalogo.length) {
      indice = (indice + 1) % catalogo.length;
      tentativas += 1;
    }
    usados.add(indice);
    escolhidas.push(catalogo[indice]);
  }

  return [1, 2, 3, 4, 5, 6].map((step) => {
    const fixa = CORE[area][step];
    if (fixa) return { step, label: fixa, fixed: true };
    const tarefa = escolhidas[ROTATING_SLOTS.indexOf(step)];
    return {
      step,
      label: tarefa.label,
      fixed: false,
      phase: tarefa.phase,
      intent: tarefa.intent,
    };
  });
}

export function stepLabelsForWeek(
  area: CycleArea,
  clientId: string,
  weekKey: string,
  options?: StepsOptions,
): string[] {
  return stepsForWeek(area, clientId, weekKey, options).map((slot) => slot.label);
}

export function stepLabelForWeek(
  area: CycleArea,
  clientId: string,
  weekKey: string,
  step: number,
  options?: StepsOptions,
): string {
  const slots = stepsForWeek(area, clientId, weekKey, options);
  return slots.find((slot) => slot.step === step)?.label || `Etapa ${step}`;
}

/** Quantas tarefas o acervo tem, por frente. Usado em testes e no tour. */
export function catalogSize(area: CycleArea): number {
  return CATALOG[area].length;
}
