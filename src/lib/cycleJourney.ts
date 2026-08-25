import type { SituacaoDoCliente } from "@/lib/cycleSituation";

/**
 * A entrada do cliente na casa, na ordem em que ela acontece de verdade.
 *
 * O trilho de onboarding era quatro frases fixas com caixinha para marcar:
 * "acessos e briefing completos", "contas conectadas no painel". Marcar
 * dependia de alguém lembrar de marcar — e o painel já SABE se o briefing
 * voltou, se a conta está conectada, se existe calendário, se subiu arte.
 * Caixinha que repete o que o banco já sabe é trabalho dobrado, e mente na
 * primeira vez que alguém esquece de marcar.
 *
 * Aqui cada etapa é CONCLUÍDA POR EVIDÊNCIA. Ninguém marca nada: a etapa
 * fecha quando o fato aconteceu. E a sequência não é a mesma para todo
 * mundo — ela sai do que o cliente contratou, então quem não tem tráfego
 * nunca vê a etapa de campanha.
 */

export interface EtapaDaJornada {
  chave: string;
  titulo: string;
  /** O que prova que está feito. Aparece quando a etapa ainda está aberta. */
  comoFecha: string;
  feita: boolean;
  /** A primeira aberta: é onde a atenção deve estar hoje. */
  atual?: boolean;
}

export interface EvidenciasDaEntrada {
  /** Briefing enviado pelo cliente. */
  briefingRespondido: boolean;
  /** Alguma conta social conectada e viva. */
  contaSocialConectada: boolean;
  /** Conta de anúncios conectada. */
  contaAdsConectada: boolean;
  /** Já existe estratégia/dossiê escrito. */
  estrategiaEscrita: boolean;
  /** Já existe pauta no calendário editorial. */
  calendarioMontado: boolean;
  /** Já subiu alguma arte. */
  primeirasArtes: boolean;
  /** Já tem post agendado ou publicado. */
  primeiroAgendamento: boolean;
  /** Já tem campanha no ar. */
  campanhaNoAr: boolean;
}

export interface ServicosContratados {
  social: boolean;
  trafego: boolean;
}

/**
 * A jornada daquele cliente, com o que já está provado.
 *
 * A ordem importa: é a sequência real de dependência. Não adianta montar
 * calendário sem estratégia, nem agendar sem arte.
 */
export function jornadaDaEntrada(
  ev: EvidenciasDaEntrada,
  servicos: ServicosContratados,
): EtapaDaJornada[] {
  const etapas: EtapaDaJornada[] = [
    {
      chave: "briefing",
      titulo: "Briefing respondido pelo cliente",
      comoFecha: "Fecha sozinha quando ele enviar o formulário",
      feita: ev.briefingRespondido,
    },
    {
      chave: "estrategia",
      titulo: "Estratégia escrita no dossiê",
      comoFecha: "Fecha quando houver dossiê de contexto gravado",
      feita: ev.estrategiaEscrita,
    },
  ];

  if (servicos.social) {
    etapas.push({
      chave: "conexao-social",
      titulo: "Conta social conectada",
      comoFecha: "Fecha quando a conexão aparecer ativa no painel",
      feita: ev.contaSocialConectada,
    });
  }
  if (servicos.trafego) {
    etapas.push({
      chave: "conexao-ads",
      titulo: "Conta de anúncios conectada",
      comoFecha: "Fecha quando a conta de anúncios estiver ligada",
      feita: ev.contaAdsConectada,
    });
  }

  if (servicos.social) {
    etapas.push(
      {
        chave: "calendario",
        titulo: "Calendário editorial montado",
        comoFecha: "Fecha na primeira pauta criada no calendário",
        feita: ev.calendarioMontado,
      },
      {
        chave: "primeiras-artes",
        titulo: "Primeiras artes no painel",
        comoFecha: "Fecha quando a primeira arte subir",
        feita: ev.primeirasArtes,
      },
      {
        chave: "primeiro-agendamento",
        titulo: "Primeiro post agendado",
        comoFecha: "Fecha no primeiro agendamento feito",
        feita: ev.primeiroAgendamento,
      },
    );
  }

  if (servicos.trafego) {
    etapas.push({
      chave: "campanha",
      titulo: "Primeira campanha no ar",
      comoFecha: "Fecha quando uma campanha ficar ativa",
      feita: ev.campanhaNoAr,
    });
  }

  // A primeira aberta é a de hoje. As seguintes ficam visíveis, mas sem
  // disputar atenção: mostrar sete coisas ao mesmo tempo é o que deixa
  // qualquer um perdido.
  const primeiraAberta = etapas.findIndex((e) => !e.feita);
  if (primeiraAberta >= 0) etapas[primeiraAberta].atual = true;
  return etapas;
}

/** A entrada terminou quando toda etapa dela fechou. */
export function entradaConcluida(etapas: EtapaDaJornada[]): boolean {
  return etapas.length > 0 && etapas.every((e) => e.feita);
}

/** A frase do card: onde o cliente novo está agora. */
export function ondeEstaNaEntrada(etapas: EtapaDaJornada[]): string {
  const atual = etapas.find((e) => e.atual);
  const feitas = etapas.filter((e) => e.feita).length;
  if (!atual) return `Entrada completa · ${feitas} de ${etapas.length}`;
  return `${feitas} de ${etapas.length} · agora: ${atual.titulo.toLowerCase()}`;
}

/**
 * Traduz a situação lida do painel em evidências da entrada.
 *
 * Fica aqui, e não espalhado pela tela, para a regra de "o que conta como
 * feito" existir num lugar só — senão o card e a folha do cliente contam
 * histórias diferentes sobre a mesma etapa.
 */
export function evidenciasDe(input: {
  situacao: SituacaoDoCliente;
  briefingRespondido: boolean;
  contaSocialConectada: boolean;
  contaAdsConectada: boolean;
  temDossie: boolean;
}): EvidenciasDaEntrada {
  const s = input.situacao;
  return {
    briefingRespondido: input.briefingRespondido,
    estrategiaEscrita: input.temDossie,
    contaSocialConectada: input.contaSocialConectada,
    contaAdsConectada: input.contaAdsConectada,
    // Pauta sem arte também conta como calendário montado: o calendário
    // existe, o que falta é a arte — e isso é a etapa seguinte.
    calendarioMontado: s.pautasSemArte > 0 || s.agendados > 0 || s.publicadosNaSemana > 0
      || s.artesProntas > 0,
    primeirasArtes: s.artesProntas > 0 || s.aguardandoAprovacao > 0,
    primeiroAgendamento: s.agendados > 0 || s.publicadosNaSemana > 0,
    campanhaNoAr: s.campanhasAtivas > 0,
  };
}
