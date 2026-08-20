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

  /**
   * Por que a rotina desta semana importa, na voz do cliente.
   *
   * Vem da etapa do ciclo mais forte que foi concluída. Sem isto, contar o
   * que foi feito vira relatório de horas: uma lista de tarefas que não
   * explica nada a quem paga por resultado.
   */
  porqueDaSemana?: string | null;

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
    `${ctx.greeting}, ${ctx.clientName}! Semana nova começando — segue o retrato de onde estamos e para onde vamos.`,
  ];

  // 1. ONDE ESTAMOS. Abre pelo retrato, não pela tarefa: o cliente precisa se
  // situar antes de ouvir o que vem. Vem do dossiê, que é a fonte de verdade.
  if (ctx.contextoRecente) {
    linhas.push("", `*Onde estamos*`, ctx.contextoRecente);
  }

  // 2. O QUE JÁ ESTÁ NA MÃO. O concreto que ele reconhece, com o motivo de
  // isso ser bom para ele — e não só para a agência.
  const prontas = ctx.pautasProntas || [];
  const naMao: string[] = [];
  if (prontas.length > 0) {
    naMao.push(
      prontas.length === 1
        ? `${prontas[0]} está pronto e entra no calendário`
        : `${listInWords(prontas, 3)} estão prontos e entram no calendário`,
    );
  }
  if (ctx.proximasAgendadas.length > 0) {
    naMao.push(
      ctx.proximasAgendadas.length === 1
        ? `a publicação do dia ${ctx.proximasAgendadas[0]} já está agendada`
        : `as publicações dos dias ${listInWords(ctx.proximasAgendadas, 4)} já estão agendadas`,
    );
  }
  if (naMao.length > 0) {
    linhas.push("", `*O que já está garantido*`, `${maiuscula(naMao.join(", "))}.`);
    if (ctx.porqueDaSemana) linhas.push(`Na prática: ${ctx.porqueDaSemana}.`);
  }

  // 3. O QUE ACONTECE ESTA SEMANA. O caminho, não só o ponto.
  const caminho: string[] = [];
  if (ctx.anuncios && ctx.anuncios.campanhasNoAr > 0) {
    caminho.push(
      ctx.anuncios.campanhasNoAr === 1
        ? `a campanha segue no ar trazendo ${ctx.anuncios.nomeDoResultado}`
        : `as ${ctx.anuncios.campanhasNoAr} campanhas seguem no ar trazendo ${ctx.anuncios.nomeDoResultado}`,
    );
  }
  if (naMao.length === 0 && ctx.frentes.length > 0) {
    caminho.push(`seguimos com ${listInWords(ctx.frentes)} em produção`);
  }
  // Sem o "e" colado: com um item só, o bloco abriria com conector solto
  // ("E o foco combinado…"). O conector é do JOIN, não da frase.
  if (ctx.proximoPasso) {
    caminho.push(`o foco combinado segue valendo: ${ctx.proximoPasso}`);
  }
  if (caminho.length > 0) {
    linhas.push("", `*Para onde vamos*`, `${maiuscula(caminho.join(", "))}.`);
  }

  // 4. O QUE DEPENDE DELE. Sempre por último e sempre com o ganho explícito:
  // pedido sem consequência clara é o que faz aprovação ficar parada.
  if (ctx.aguardandoOk.length > 0) {
    linhas.push(
      "",
      `*O que depende de você*`,
      ctx.aguardandoOk.length === 1
        // Sem adjetivo: "a arte ... está pronto" era erro de concordância, e
        // o painel não sabe o gênero do nome que o cliente deu à peça.
        ? `${maiuscula(ctx.aguardandoOk[0])} está esperando seu ok — com o sim, já entra no calendário.`
        : `${maiuscula(listInWords(ctx.aguardandoOk))} estão esperando seu ok — com o sim, já entram no calendário.`,
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
    `${ctx.greeting}, ${ctx.clientName}! Fechando a semana — o que foi feito, o que rendeu e o que já está pronto para a próxima.`,
  ];

  // 1. O QUE FOI FEITO. Entregas com nome, rotina em linguagem dele, e o que
  // aconteceu fora do combinado — que costuma ser o que explica o resultado.
  const feito: string[] = [];
  if (ctx.entregasSemana.length > 0) {
    feito.push(
      ctx.entregasSemana.length === 1
        ? `${ctx.entregasSemana[0]} ficou pronto`
        : `${listInWords(ctx.entregasSemana, 3)} ficaram prontos`,
    );
  }
  if (ctx.cicloFeito.length > 0) {
    feito.push(listInWords(ctx.cicloFeito, 3));
  }
  if (ctx.avulsosFeitos.length > 0) {
    feito.push(`fora da rotina, ainda fizemos ${listInWords(ctx.avulsosFeitos, 2)}`);
  }
  if (feito.length > 0) {
    // Uma linha por bloco. Emendado com vírgulas virava parágrafo corrido com
    // dois "e" na mesma frase — no celular, ninguém lê até o fim.
    linhas.push("", `*O que foi feito*`, ...feito.map((f) => `• ${maiuscula(f)}.`));
    // O motivo vem colado no que foi feito: é o que separa explicação de
    // relatório de horas.
    if (ctx.porqueDaSemana) linhas.push(`Isso importa porque ${ctx.porqueDaSemana}.`);
  }

  // 2. O RESULTADO. Números primeiro, sem enfeite — é o que dá confiança.
  const resultado: string[] = [];
  if (ctx.publicadasSemana > 0) {
    resultado.push(
      ctx.publicadasSemana === 1
        ? "uma publicação foi ao ar na data combinada"
        : `${ctx.publicadasSemana} publicações foram ao ar nas datas combinadas`,
    );
  }
  if (ctx.anuncios && ctx.anuncios.investidoSemana > 0) {
    const { investidoSemana, resultadosSemana, nomeDoResultado } = ctx.anuncios;
    resultado.push(
      resultadosSemana != null && resultadosSemana > 0
        ? `os anúncios somaram ${dinheiro(investidoSemana)} investidos e ${resultadosSemana} ${nomeDoResultado}`
        : `os anúncios rodaram com ${dinheiro(investidoSemana)} investidos`,
    );
  }
  if (resultado.length > 0) {
    linhas.push("", `*O que isso rendeu*`, `${maiuscula(resultado.join(", "))}.`);
  }

  // 3. ONDE ISSO NOS DEIXA. O dossiê fecha o arco: começou na semana passada,
  // passou pelo trabalho, e agora está aqui.
  if (ctx.contextoRecente) {
    linhas.push("", `*Onde isso nos deixa*`, ctx.contextoRecente);
  }

  // 4. O QUE JÁ ESTÁ PREPARADO. Sexta sem próximo passo deixa o cliente com a
  // sensação de que a semana acabou e nada continua.
  const proxima: string[] = [];
  if ((ctx.pautasProntas || []).length > 0) {
    proxima.push(
      ctx.pautasProntas!.length === 1
        ? `${ctx.pautasProntas![0]} já está pronto esperando data`
        : `${listInWords(ctx.pautasProntas!, 3)} já estão prontos esperando data`,
    );
  }
  if (ctx.proximasAgendadas.length > 0) {
    proxima.push(
      ctx.proximasAgendadas.length === 1
        ? `a próxima publicação já está marcada para ${ctx.proximasAgendadas[0]}`
        : `as próximas publicações já estão marcadas: ${listInWords(ctx.proximasAgendadas, 3)}`,
    );
  }
  if (ctx.proximoPasso) proxima.push(`e o foco combinado segue: ${ctx.proximoPasso}`);
  if (proxima.length > 0) {
    linhas.push("", `*Já preparado para a próxima semana*`, `${maiuscula(proxima.join(", "))}.`);
  }

  if (ctx.aguardandoOk.length > 0) {
    linhas.push(
      "",
      ctx.aguardandoOk.length === 1
        ? `Fica só ${ctx.aguardandoOk[0]} esperando seu ok para destravar a semana que vem.`
        : `Ficam ${listInWords(ctx.aguardandoOk)} esperando seu ok para destravar a semana que vem.`,
    );
  }

  // Sem nada registrado, a mensagem não inventa: reconhece e aponta adiante.
  if (feito.length === 0 && resultado.length === 0 && proxima.length === 0) {
    linhas.push(
      "",
      "A semana foi de construção interna: o material está tomando forma e chega na próxima.",
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
