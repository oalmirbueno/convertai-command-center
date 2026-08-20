import { listInWords } from "@/lib/clientText";

/**
 * A mensagem do grupo do WhatsApp, montada da leitura do painel inteiro.
 *
 * O problema que ela resolve: as três mensagens da semana saíam com o MESMO
 * corpo e só a saudação trocada — "Começando a semana", "Passando para contar",
 * "Fechando a semana", seguidas do texto idêntico. O cliente percebe em duas
 * semanas, e mensagem percebida como automática deixa de ser lida.
 *
 * A correção não é variar frases: é dar a cada momento um TRABALHO diferente,
 * porque segunda, quarta e sexta respondem perguntas diferentes:
 *
 *   abertura   → o plano: o que esta semana vai ter, e por quê
 *   meio       → o movimento: o que já andou desde segunda, o que fecha até sexta
 *   fechamento → o balanço: o que saiu, o que rendeu, qual o próximo passo
 *
 * Com trabalhos diferentes lendo fatos diferentes, os textos saem diferentes
 * por consequência — e mudam sozinhos quando o painel muda, porque tudo aqui
 * vem das consultas ao vivo (entregas, ciclo, avulsos, campanhas, memória).
 *
 * As regras de tom são as mesmas do resto do painel: nada de ausência, nada de
 * cobrança, nada de número solto sem nome, nada de jargão.
 */

export interface GroupMessageContext {
  clientName: string;
  /** "Bom dia" | "Boa tarde" | "Boa noite" — decidido por quem chama. */
  greeting: string;

  /** Nomes legíveis dos materiais liberados nesta semana. */
  entregasSemana: string[];
  /** Só o que saiu depois de segunda — é o que o meio da semana conta. */
  entregasDesdeSegunda: string[];
  /** Nomes legíveis do que espera o ok do cliente. */
  aguardandoOk: string[];

  /** Quantas publicações foram ao ar nesta semana. */
  publicadasSemana: number;
  /** Datas (dd/mm) das próximas publicações agendadas, em ordem. */
  proximasAgendadas: string[];

  /** Etapas do ciclo concluídas nesta semana, em linguagem de cliente. */
  cicloFeito: string[];
  /** Avulsos da semana já concluídos. */
  avulsosFeitos: string[];

  /** Frentes ativas, já sem o prefixo do cliente. */
  frentes: string[];

  /**
   * A última movimentação registrada na memória (decisão, nota do studio,
   * dossiê atualizado pelo agente): é ela que substitui o genérico "seguimos
   * trabalhando em X". Só entra quando é recente.
   */
  contextoRecente?: string | null;

  /**
   * Conteúdo do calendário editorial pronto para sair, PELO NOME.
   *
   * Esta é a fonte que faltava. As entregas vinham só de arquivo liberado nos
   * últimos 7 dias — material aprovado há dez dias sumia da mensagem e o texto
   * caía no genérico "semana de construção", mesmo com carrossel pronto
   * esperando data. Medindo a carteira real: nenhum cliente tinha entrega na
   * janela de 7 dias, mas vários tinham pauta pronta com nome.
   */
  pautasProntas?: string[];

  /** Próximo passo combinado no último relatório publicado, se recente. */
  proximoPasso?: string | null;

  /** Campanhas: leitura da semana em linguagem simples, se houver tráfego. */
  anuncios?: {
    campanhasNoAr: number;
    investidoSemana: number;
    resultadosSemana: number | null;
    nomeDoResultado: string;
  } | null;
}

export type GroupMoment = "abertura" | "meio" | "fechamento";

const dinheiro = (valor: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: valor < 100 ? 2 : 0,
  }).format(valor);

/** Junta as linhas sem nunca deixar duas em branco seguidas. */
const montar = (linhas: string[]) =>
  linhas
    .filter((linha, indice, lista) => !(linha === "" && lista[indice - 1] === ""))
    .join("\n")
    .trim();

const maiuscula = (frase: string) => frase.charAt(0).toUpperCase() + frase.slice(1);

/* ───────────────────────────── abertura · o plano ────────────────────────── */

function abertura(ctx: GroupMessageContext): string {
  const linhas: string[] = [
    `${ctx.greeting}, ${ctx.clientName}! Abrindo a semana com o plano na mão.`,
    "",
  ];

  if (ctx.proximasAgendadas.length > 0) {
    linhas.push(
      ctx.proximasAgendadas.length === 1
        ? `Esta semana tem publicação garantida no dia ${ctx.proximasAgendadas[0]}.`
        : `Esta semana o calendário já está garantido: publicações nos dias ${listInWords(ctx.proximasAgendadas, 4)}.`,
    );
  }

  if (ctx.anuncios && ctx.anuncios.campanhasNoAr > 0) {
    linhas.push(
      ctx.anuncios.campanhasNoAr === 1
        ? `A campanha segue no ar trazendo ${ctx.anuncios.nomeDoResultado} ao longo da semana.`
        : `As ${ctx.anuncios.campanhasNoAr} campanhas seguem no ar trazendo ${ctx.anuncios.nomeDoResultado} ao longo da semana.`,
    );
  }

  // O que está pronto para sair, pelo nome. Vem antes do contexto porque é o
  // mais concreto que existe: o cliente reconhece a peça de que se falou.
  const prontas = ctx.pautasProntas || [];
  if (prontas.length > 0) {
    linhas.push(
      prontas.length === 1
        ? `Já está pronto para entrar no ar: ${prontas[0]}.`
        : `Já estão prontos para entrar no ar: ${listInWords(prontas, 3)}.`,
    );
  }

  // O contexto vivo entra no lugar do antigo "seguimos trabalhando em X":
  // a última decisão ou registro real conta mais que o nome do projeto.
  if (ctx.contextoRecente) {
    linhas.push(`Por dentro: ${ctx.contextoRecente}`);
  } else if (prontas.length === 0 && ctx.frentes.length > 0) {
    linhas.push(`Em produção nesta semana: ${listInWords(ctx.frentes)}.`);
  }

  if (ctx.proximoPasso) {
    linhas.push("", `O foco combinado segue valendo: ${ctx.proximoPasso}`);
  }

  if (ctx.aguardandoOk.length > 0) {
    linhas.push(
      "",
      ctx.aguardandoOk.length === 1
        ? `Para a semana render desde já: ${ctx.aguardandoOk[0]} está pronto esperando seu ok — com o sim, entra no calendário.`
        : `Para a semana render desde já: ${listInWords(ctx.aguardandoOk)} estão prontos esperando seu ok.`,
    );
  }

  linhas.push("", "Qualquer coisa é só chamar. Tudo detalhado no painel: aceleriq.online");
  return montar(linhas);
}

/* ─────────────────────────── meio · o movimento ──────────────────────────── */

function meio(ctx: GroupMessageContext): string {
  const linhas: string[] = [
    `${ctx.greeting}, ${ctx.clientName}! Check de quarta: o que já andou desde segunda.`,
    "",
  ];

  const movimento: string[] = [];
  if (ctx.entregasDesdeSegunda.length > 0) {
    movimento.push(
      ctx.entregasDesdeSegunda.length === 1
        ? `${ctx.entregasDesdeSegunda[0]} ficou pronto e já está no painel`
        : `${listInWords(ctx.entregasDesdeSegunda)} ficaram prontos e já estão no painel`,
    );
  }
  if (ctx.cicloFeito.length > 0) {
    // Molde com dois-pontos porque as etapas chegam como ORAÇÕES ("o conteúdo
    // ficou pronto"), não como substantivos. Com "já saíram X" a frase saía
    // "já saíram o conteúdo da semana ficou pronto" — e a oração informa mais
    // do que o substantivo, então quem cede é o molde.
    movimento.push(`da rotina da semana: ${listInWords(ctx.cicloFeito, 3)}`);
  }
  if (ctx.avulsosFeitos.length > 0) {
    movimento.push(`fora da rotina, também fizemos ${listInWords(ctx.avulsosFeitos, 2)}`);
  }
  if (ctx.publicadasSemana > 0) {
    movimento.push(
      ctx.publicadasSemana === 1
        ? "uma publicação já foi ao ar na data combinada"
        : `${ctx.publicadasSemana} publicações já foram ao ar`,
    );
  }

  if (movimento.length > 0) {
    linhas.push(movimento.map((frase) => `${maiuscula(frase)}.`).join("\n"));
  } else if ((ctx.pautasProntas || []).length > 0) {
    // Sem movimento novo desde segunda, mas com peça pronta: o cliente
    // reconhece o nome e sabe exatamente o que está esperando data.
    linhas.push(
      `Da produção da semana, ${listInWords(ctx.pautasProntas!, 3)} ${
        ctx.pautasProntas!.length === 1 ? "já está pronto" : "já estão prontos"
      } e aguardando a data no calendário.`,
    );
  } else {
    linhas.push(
      "O começo da semana foi de produção interna: o material está tomando forma e chega até sexta.",
    );
  }

  if (ctx.anuncios && ctx.anuncios.investidoSemana > 0) {
    const { investidoSemana, resultadosSemana, nomeDoResultado } = ctx.anuncios;
    linhas.push(
      "",
      resultadosSemana != null && resultadosSemana > 0
        ? `Nos anúncios, a semana já soma ${dinheiro(investidoSemana)} investidos e ${resultadosSemana} ${nomeDoResultado}.`
        : `Nos anúncios, a campanha segue rodando com ${dinheiro(investidoSemana)} investidos na semana.`,
    );
  }

  if (ctx.proximasAgendadas.length > 0) {
    linhas.push(
      "",
      ctx.proximasAgendadas.length === 1
        ? `Até o fim da semana ainda entra publicação no dia ${ctx.proximasAgendadas[0]}.`
        : `Até o fim da semana ainda entram publicações: ${listInWords(ctx.proximasAgendadas, 3)}.`,
    );
  }

  if (ctx.aguardandoOk.length > 0) {
    linhas.push(
      "",
      `Seu ok em ${listInWords(ctx.aguardandoOk)} destrava o resto da semana.`,
    );
  }

  linhas.push("", "Qualquer coisa é só chamar. Tudo detalhado no painel: aceleriq.online");
  return montar(linhas);
}

/* ────────────────────────── fechamento · o balanço ───────────────────────── */

function fechamento(ctx: GroupMessageContext): string {
  const linhas: string[] = [
    `${ctx.greeting}, ${ctx.clientName}! Fechando a semana com o balanço do que ela rendeu.`,
    "",
  ];

  const saiu: string[] = [];
  if (ctx.entregasSemana.length > 0) {
    saiu.push(
      ctx.entregasSemana.length === 1
        ? `ficou pronto ${ctx.entregasSemana[0]}`
        : `ficaram prontos ${listInWords(ctx.entregasSemana, 3)}`,
    );
  }
  if (ctx.publicadasSemana > 0) {
    saiu.push(
      ctx.publicadasSemana === 1
        ? "uma publicação foi ao ar"
        : `${ctx.publicadasSemana} publicações foram ao ar`,
    );
  }
  if (ctx.avulsosFeitos.length > 0) {
    saiu.push(`e ainda saiu ${listInWords(ctx.avulsosFeitos, 2)}`);
  }

  if ((ctx.pautasProntas || []).length > 0) {
    saiu.push(
      `${listInWords(ctx.pautasProntas!, 3)} ${
        ctx.pautasProntas!.length === 1 ? "ficou pronto" : "ficaram prontos"
      } para entrar no calendário`,
    );
  }

  if (saiu.length > 0) {
    linhas.push(`Nesta semana ${saiu.join(", ")}.`);
  } else {
    linhas.push(
      ctx.frentes.length > 0
        ? `A semana foi de construção em ${listInWords(ctx.frentes)}: o material desta produção aparece nas próximas publicações.`
        : "A semana foi de construção: o material produzido aparece nas próximas publicações.",
    );
  }

  if (ctx.anuncios && ctx.anuncios.investidoSemana > 0) {
    const { investidoSemana, resultadosSemana, nomeDoResultado } = ctx.anuncios;
    linhas.push(
      resultadosSemana != null && resultadosSemana > 0
        ? `Os anúncios fecharam a semana com ${dinheiro(investidoSemana)} investidos e ${resultadosSemana} ${nomeDoResultado}.`
        : `Os anúncios seguiram no ar a semana toda, com ${dinheiro(investidoSemana)} investidos.`,
    );
  }

  // O fechamento sempre aponta para frente: próximo passo combinado ou a
  // próxima publicação — a semana termina, o trabalho não.
  if (ctx.proximoPasso) {
    linhas.push("", `Próximo passo: ${ctx.proximoPasso}`);
  } else if (ctx.proximasAgendadas.length > 0) {
    linhas.push("", `A próxima publicação já está agendada: dia ${ctx.proximasAgendadas[0]}.`);
  }

  if (ctx.aguardandoOk.length > 0) {
    linhas.push(
      "",
      `Fica só um lembrete bom: ${listInWords(ctx.aguardandoOk)} ${
        ctx.aguardandoOk.length === 1 ? "está pronto" : "estão prontos"
      } esperando seu ok para entrar no calendário.`,
    );
  }

  linhas.push("", "Bom fim de semana! O detalhe de tudo está no painel: aceleriq.online");
  return montar(linhas);
}

export function buildGroupMessageText(ctx: GroupMessageContext, moment: GroupMoment): string {
  if (moment === "abertura") return abertura(ctx);
  if (moment === "meio") return meio(ctx);
  return fechamento(ctx);
}
