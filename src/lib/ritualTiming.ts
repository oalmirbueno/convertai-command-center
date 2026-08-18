/**
 * Quando cada ritual é devido, e o que dizer sobre isso.
 *
 * A Central se chama "o que enviar e quando" e não dizia o que era HOJE: as
 * cinco linhas tinham o mesmo peso, então quem abria na quarta precisava
 * lembrar de cabeça que quarta é o Check do Meio da Semana. Isso é informação
 * que a tela tem e não estava usando.
 *
 * A regra segue a semana de trabalho: o ritual de segunda continua "de hoje"
 * na terça (ainda dá tempo), e vira atrasado depois disso. Rituais sem dia
 * fixo (mensal, trimestral) não entram nessa conta — cobrar dia certo deles
 * seria inventar urgência.
 */

export interface RitualComDia {
  value: string;
  /** 1 = segunda ... 5 = sexta. Ausente em mensal/trimestral. */
  dia?: number;
}

export interface QuandoDoRitual {
  /** Merece a faixa e o botão cheio. */
  destaque: boolean;
  /** Texto curto ao lado do nome, ou vazio. */
  etiqueta: string;
  cls: string;
}

const NEUTRO: QuandoDoRitual = { destaque: false, etiqueta: "", cls: "" };

export function ritualTiming(ritual: RitualComDia, hoje: Date = new Date()): QuandoDoRitual {
  if (!ritual.dia) return NEUTRO;

  // getDay(): 0 = domingo. Convertido para 1 = segunda ... 7 = domingo.
  const diaDaSemana = ((hoje.getDay() + 6) % 7) + 1;

  if (diaDaSemana === ritual.dia) {
    return {
      destaque: true,
      etiqueta: "hoje",
      cls: "bg-primary/15 text-primary",
    };
  }

  // Um dia de tolerância: o de segunda ainda é "de hoje" na terça de manhã,
  // e só vira atraso depois disso.
  if (diaDaSemana === ritual.dia + 1) {
    return {
      destaque: true,
      etiqueta: "era ontem",
      cls: "bg-warning/15 text-warning",
    };
  }

  // Passou da tolerância e ainda estamos na mesma semana de trabalho.
  if (diaDaSemana > ritual.dia + 1 && diaDaSemana <= 5) {
    return {
      destaque: false,
      etiqueta: "passou",
      cls: "bg-muted text-muted-foreground",
    };
  }

  // Ainda vai chegar nesta semana.
  if (diaDaSemana < ritual.dia) {
    return { destaque: false, etiqueta: "em breve", cls: "bg-secondary text-muted-foreground" };
  }

  // Fim de semana: nada é cobrado, a semana seguinte recomeça a conta.
  return NEUTRO;
}
