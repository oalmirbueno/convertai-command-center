import type { CycleArea } from "@/lib/cycleDefs";

/**
 * As etapas da semana, que deixam de ser sempre as mesmas.
 *
 * O ciclo tinha seis etapas fixas, iguais para todo cliente e toda semana.
 * Depois de um mês, marcar virava burocracia: o checklist não dizia mais nada
 * sobre o que aquela semana tinha de diferente.
 *
 * Agora três etapas continuam fixas, porque são o esqueleto do trabalho e
 * acontecem toda semana sem exceção: criar o conteúdo, atualizar o painel e
 * agendar as publicações. As outras três giram, sorteadas de um catálogo de
 * trabalho real da frente.
 *
 * A rotação é DETERMINÍSTICA: as mesmas etapas para o mesmo cliente na mesma
 * semana, sempre. Isso é essencial, porque a marcação guarda só o número da
 * etapa; se o sorteio mudasse a cada abertura da tela, a etapa 5 marcada hoje
 * significaria outra coisa amanhã, e o histórico viraria mentira.
 */

export interface CycleStepSlot {
  /** Posição da etapa no ciclo (1 a 6). */
  step: number;
  label: string;
  /** Fixa acontece toda semana; girada muda conforme cliente e semana. */
  fixed: boolean;
}

/** O esqueleto: o que acontece toda semana, para todo cliente. */
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
 * O trabalho que existe de verdade em cada frente e não precisa acontecer
 * toda semana. Sai daqui a variedade: cada semana pede três destes.
 */
const ROTATING: Record<CycleArea, string[]> = {
  social: [
    "Aprovação enviada ao cliente e cobrada até quarta",
    "Contas conectadas e conferidas no painel",
    "Métricas da semana lidas e anotadas no painel",
    "Comentários e mensagens diretas respondidos",
    "Stories da semana planejados",
    "Um vídeo curto (reel) produzido",
    "Legendas revisadas com chamada para ação clara",
    "Concorrência olhada: um aprendizado anotado",
    "Banco de ideias alimentado com 3 pautas novas",
    "Calendário do próximo mês esboçado",
    "Perfil revisado (bio, destaques, link)",
    "Conversa com o cliente sobre o que ele quer mostrar",
  ],
  trafego: [
    "Campanhas ativas revisadas uma a uma",
    "Verba e orçamento conferidos",
    "Métricas lidas e leitura anotada para o cliente",
    "Anúncio de pior desempenho pausado",
    "Novo público testado",
    "Teste de criativo (A/B) iniciado",
    "Página de destino conferida ponta a ponta",
    "Pixel e eventos de conversão verificados",
    "Remarketing revisado",
    "Leads recebidos conferidos com o cliente",
    "Orçamento redistribuído entre campanhas",
    "Relatório de resultados atualizado",
  ],
};

/** Posições que giram, na ordem em que aparecem no ciclo. */
const ROTATING_SLOTS = [2, 3, 5];

/**
 * Semente estável a partir do cliente, da frente e da semana. Números
 * pequenos e sem dependência de data atual: reabrir a mesma semana daqui a um
 * ano devolve exatamente as mesmas etapas.
 */
function seedFrom(text: string): number {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash;
}

/**
 * As seis etapas daquele cliente naquela semana, na ordem do ciclo.
 */
export function stepsForWeek(
  area: CycleArea,
  clientId: string,
  weekKey: string,
): CycleStepSlot[] {
  const catalogo = ROTATING[area];
  const semente = seedFrom(`${clientId}:${area}:${weekKey}`);

  // Três etapas distintas do catálogo, sem repetir na mesma semana.
  const escolhidas: string[] = [];
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
    const posicao = ROTATING_SLOTS.indexOf(step);
    return { step, label: escolhidas[posicao], fixed: false };
  });
}

/** Só os textos, quando a tela não precisa saber o que é fixo. */
export function stepLabelsForWeek(
  area: CycleArea,
  clientId: string,
  weekKey: string,
): string[] {
  return stepsForWeek(area, clientId, weekKey).map((slot) => slot.label);
}

/** O nome de uma etapa específica daquele cliente naquela semana. */
export function stepLabelForWeek(
  area: CycleArea,
  clientId: string,
  weekKey: string,
  step: number,
): string {
  const slots = stepsForWeek(area, clientId, weekKey);
  return slots.find((slot) => slot.step === step)?.label || `Etapa ${step}`;
}
