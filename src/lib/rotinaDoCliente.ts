import { CYCLES, type CycleArea } from "@/lib/cycleDefs";

/**
 * As etapas do ciclo ditas para o cliente, com o motivo delas.
 *
 * O checklist é escrito para QUEM EXECUTA: "subir no painel", "conectar e
 * conferir a conta". São ordens de serviço no imperativo. Passadas cruas para
 * a mensagem, o cliente lia "já saíram conteúdo da semana criado e subir no
 * painel" — bastidor da agência entregue como se fosse notícia dele.
 *
 * Cada etapa tem duas coisas: o que ela É para o cliente, e por que ela
 * IMPORTA. O motivo não é enfeite — é o que transforma uma lista de tarefas
 * em explicação. Sem ele, contar o que foi feito vira relatório de horas.
 *
 * Etapa sem tradução não entra na mensagem: melhor a semana parecer menor do
 * que foi do que mandar jargão interno para quem paga por resultado.
 */

interface EtapaContada {
  /** O que aconteceu, na voz de quem recebe. */
  frase: string;
  /** Por que isso importa para ele. Vazio quando é óbvio demais para dizer. */
  porque: string;
}

const CONTADA: Record<string, EtapaContada | null> = {
  // ── Social Media ──
  "Conteúdo da semana criado (artes e legendas)": {
    frase: "o conteúdo da semana ficou pronto",
    // Sem tempo verbal preso: a mesma frase serve para a segunda (o que vem)
    // e para a sexta (o que rendeu).
    porque: "material pronto antes da hora tira a correria do meio do caminho",
  },
  "Subir no painel (Arquivos, pasta certa)": {
    frase: "o material já está no painel para você ver",
    porque: "",
  },
  // Bastidor puro: não é notícia para quem contratou.
  "Conectar e conferir a conta no painel": null,
  "Painel atualizado (agenda, métricas, diário)": {
    frase: "o painel foi atualizado com agenda e números",
    porque: "você consegue conferir tudo sozinho, na hora que quiser",
  },
  "Aprovação no grupo + ritual enviado": null,
  "Posts agendados (publicação automática armada)": {
    frase: "os posts já estão agendados",
    porque: "eles publicam sozinhos na hora certa, mesmo em feriado",
  },

  // ── Tráfego Pago ──
  "Campanhas ativas revisadas": {
    frase: "as campanhas foram revisadas uma a uma",
    porque: "a verba continua indo para o que está trazendo retorno",
  },
  "Criativos da semana prontos": {
    frase: "os criativos da semana ficaram prontos",
    porque: "anúncio novo cansa menos o público e segura o custo",
  },
  "Anúncios subidos ou atualizados": {
    frase: "os anúncios entraram no ar atualizados",
    porque: "",
  },
  "Verba e orçamento conferidos": {
    frase: "a verba foi conferida",
    porque: "nada gasta além do combinado sem você saber",
  },
  "Métricas lidas e leitura anotada": {
    frase: "os números foram lidos e interpretados",
    porque: "a decisão da próxima semana nasce do que aconteceu nesta",
  },
  "Registro no painel para o cliente ver": null,
};

/** O que contar sobre a rotina desta semana, sem repetir. */
export function rotinaEmLinguagemDeCliente(
  feitas: ReadonlyArray<{ area: CycleArea; step: number }>,
): string[] {
  return contarRotina(feitas).map((e) => e.frase);
}

/** As etapas contadas com o motivo, para quem quiser montar a explicação. */
export function contarRotina(
  feitas: ReadonlyArray<{ area: CycleArea; step: number }>,
): EtapaContada[] {
  const ditas = new Map<string, EtapaContada>();
  for (const { area, step } of feitas) {
    const rotulo = (CYCLES[area]?.steps || [])[step - 1];
    if (!rotulo) continue;
    const contada = CONTADA[rotulo];
    if (!contada) continue;
    if (!ditas.has(contada.frase)) ditas.set(contada.frase, contada);
  }
  return [...ditas.values()];
}

/**
 * O motivo mais forte entre as etapas da semana.
 *
 * Um motivo bem escolhido explica a semana; três viram parágrafo de manual.
 * A ordem do checklist já é a ordem de importância, então o primeiro que tem
 * motivo é o que fica.
 */
export function porqueDaSemana(
  feitas: ReadonlyArray<{ area: CycleArea; step: number }>,
): string {
  return contarRotina(feitas).find((e) => e.porque)?.porque || "";
}

/** Existe decisão de tradução para esta etapa? Usado pelos testes. */
export function temTraducao(rotulo: string): boolean {
  return Object.prototype.hasOwnProperty.call(CONTADA, rotulo);
}
