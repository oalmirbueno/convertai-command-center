import type { CycleArea } from "@/lib/cycleDefs";
import type { SituacaoDoCliente } from "@/lib/cycleSituation";

/**
 * O que a semana daquele cliente está pedindo, lido do painel.
 *
 * Antes, três das seis etapas saíam de um sorteio determinístico sobre um
 * acervo. O sorteio girava por semana, mas era CEGO: podia mandar
 * "planejar os stories" para quem tinha sete artes paradas em aprovação há
 * cinco dias, e não dizer nada sobre a aprovação. E o comentário do módulo
 * prometia "não repetir o que já viu nas últimas semanas" — promessa que o
 * código nunca cumpriu, porque o sorteio não conhecia o histórico.
 *
 * Aqui a ordem se inverte: primeiro a REALIDADE, depois o acervo.
 *
 *  1. Pendências reais viram etapa, na ordem do que dói mais. Elas não
 *     repetem porque só existem enquanto o problema existe: no instante em
 *     que a aprovação sai, a etapa de cobrar aprovação some sozinha.
 *  2. Se sobrar espaço (cliente em dia), o acervo preenche — aí sim
 *     excluindo o que apareceu nas últimas semanas.
 *
 * As pendências também alimentam a leitura da carteira: é o que responde
 * "está tudo certo?" sem ninguém precisar abrir cliente por cliente.
 */

export type Gravidade = "urgente" | "atencao" | "tranquilo";

export interface Pendencia {
  /** Chave estável: serve para não repetir e para o teste falar dela. */
  chave: string;
  texto: string;
  gravidade: Gravidade;
  /** Vira etapa do checklist, ou é só aviso de leitura. */
  viraEtapa: boolean;
}

/** Quantos dias uma aprovação pode ficar parada antes de virar urgência. */
const DIAS_APROVACAO_PARADA = 3;

/**
 * As pendências daquele cliente, da mais grave para a menos.
 *
 * Cada linha responde "o que acontece de ruim se ninguém olhar isso hoje".
 * O que não tem resposta para isso não entra — lista cheia de item sem
 * consequência é como o checklist virou burocracia da primeira vez.
 */
export function pendenciasDoCliente(
  situacao: SituacaoDoCliente,
  area: CycleArea,
): Pendencia[] {
  const lista: Pendencia[] = [
    ...(area === "social" ? pendenciasSociais(situacao) : pendenciasDeTrafego(situacao)),
    // O Kanban vale nas duas frentes: prazo vencido e tarefa sem dono
    // acontecem igual em conteúdo e em anúncio.
    ...pendenciasDoKanban(situacao),
  ];
  const ordem: Record<Gravidade, number> = { urgente: 0, atencao: 1, tranquilo: 2 };
  return lista.sort((a, b) => ordem[a.gravidade] - ordem[b.gravidade]);
}

/**
 * Tráfego pago tem os próprios buracos, e nenhum se parece com os de
 * conteúdo. Antes esta frente não tinha leitura nenhuma — o que era melhor
 * do que herdar as de social, mas ainda deixava o operador no escuro.
 */
function pendenciasDeTrafego(s: SituacaoDoCliente): Pendencia[] {
  const lista: Pendencia[] = [];

  if (s.campanhasTotal === 0) {
    lista.push({
      chave: "sem-campanha-cadastrada",
      texto: "Nenhuma campanha aparece no painel: a conta pode não estar conectada",
      gravidade: "urgente",
      viraEtapa: true,
    });
    return lista;
  }

  if (s.campanhasAtivas === 0) {
    lista.push({
      chave: "nenhuma-ativa",
      texto: `Nenhuma das ${s.campanhasTotal} campanhas está no ar`,
      gravidade: "urgente",
      viraEtapa: true,
    });
  }

  // Verba zerada para a campanha sozinha, sem aviso nenhum.
  if (s.saldoVerba != null && s.saldoVerba <= 0 && s.campanhasAtivas > 0) {
    lista.push({
      chave: "verba-zerada",
      texto: "Campanha no ar com a carteira de anúncios zerada",
      gravidade: "urgente",
      viraEtapa: true,
    });
  }

  // Dado parado quer dizer coleta quebrada: os números da tela envelhecem
  // sem ninguém perceber, e a decisão da semana sai de dado velho.
  if (s.diasSemDadoDeCampanha != null && s.diasSemDadoDeCampanha >= 3) {
    lista.push({
      chave: "dado-parado",
      texto: `Os dados de campanha não se movem há ${s.diasSemDadoDeCampanha} dias`,
      gravidade: "atencao",
      viraEtapa: true,
    });
  }

  if (s.ultimoDiario) {
    const dias = Math.floor((Date.now() - new Date(s.ultimoDiario).getTime()) / 86_400_000);
    if (dias >= 7) {
      lista.push({
        chave: "diario-parado",
        texto: `O cliente não vê leitura de resultado há ${dias} dias`,
        gravidade: "atencao",
        viraEtapa: true,
      });
    }
  }

  return lista;
}

/** O que o Kanban denuncia, em qualquer frente. */
function pendenciasDoKanban(s: SituacaoDoCliente): Pendencia[] {
  const lista: Pendencia[] = [];
  if (s.tarefasAtrasadas > 0) {
    lista.push({
      chave: "tarefa-atrasada",
      texto: s.tarefasAtrasadas === 1
        ? "1 tarefa passou do prazo no Kanban"
        : `${s.tarefasAtrasadas} tarefas passaram do prazo no Kanban`,
      gravidade: "urgente",
      viraEtapa: true,
    });
  }
  // Tarefa sem dono é a que ninguém faz: não some, não atrasa, só fica.
  if (s.tarefasSemDono > 0) {
    lista.push({
      chave: "tarefa-sem-dono",
      texto: s.tarefasSemDono === 1
        ? "1 tarefa aberta sem responsável"
        : `${s.tarefasSemDono} tarefas abertas sem responsável`,
      gravidade: "atencao",
      viraEtapa: s.tarefasSemDono >= 3,
    });
  }
  return lista;
}

function pendenciasSociais(situacao: SituacaoDoCliente): Pendencia[] {
  const lista: Pendencia[] = [];

  // Conexão caída vem antes de tudo: com ela quebrada, o agendamento
  // falha na hora de publicar e nada mais nesta lista adianta.
  if (situacao.conexaoSocialCaida) {
    lista.push({
      chave: "conexao-caida",
      texto: "A conexão da conta social caiu: o agendamento não vai publicar",
      gravidade: "urgente",
      viraEtapa: true,
    });
  }

  // Métrica parada é coleta quebrada, e sem número não há leitura de
  // resultado para dar ao cliente.
  if (situacao.semanasDeMetrica === 0 && situacao.contaSocialConectada) {
    lista.push({
      chave: "sem-metrica",
      texto: "Conta conectada mas nenhuma métrica coletada ainda",
      gravidade: "atencao",
      viraEtapa: true,
    });
  } else if (situacao.diasSemMetrica != null && situacao.diasSemMetrica >= 10) {
    lista.push({
      chave: "metrica-parada",
      texto: `Sem métrica nova há ${situacao.diasSemMetrica} dias`,
      gravidade: "atencao",
      viraEtapa: true,
    });
  }

  if (situacao.perderamAData > 0) {
    lista.push({
      chave: "perderam-data",
      texto: situacao.perderamAData === 1
        ? "1 post passou da hora marcada e não foi ao ar"
        : `${situacao.perderamAData} posts passaram da hora marcada e não foram ao ar`,
      gravidade: "urgente",
      viraEtapa: true,
    });
  }

  if (situacao.artesRecusadas > 0) {
    lista.push({
      chave: "recusadas",
      texto: situacao.artesRecusadas === 1
        ? "1 arte com alteração pedida pelo cliente, ainda não refeita"
        : `${situacao.artesRecusadas} artes com alteração pedida, ainda não refeitas`,
      gravidade: "urgente",
      viraEtapa: true,
    });
  }

  const parada = situacao.aprovacaoParadaDias;
  if (situacao.aguardandoAprovacao > 0) {
    const demais = parada != null && parada >= DIAS_APROVACAO_PARADA;
    lista.push({
      chave: "aprovacao-parada",
      texto: demais
        ? `${situacao.aguardandoAprovacao} ${situacao.aguardandoAprovacao === 1 ? "arte parada" : "artes paradas"} em aprovação há ${parada} dias`
        : `${situacao.aguardandoAprovacao} ${situacao.aguardandoAprovacao === 1 ? "arte aguardando" : "artes aguardando"} o cliente aprovar`,
      gravidade: demais ? "urgente" : "atencao",
      viraEtapa: demais,
    });
  }

  // Nada agendado é o buraco mais silencioso da operação: não dá erro em
  // lugar nenhum, a semana só passa em branco.
  if (situacao.agendados === 0) {
    lista.push({
      chave: "sem-agenda",
      texto: situacao.artesProntas > 0
        ? `Nenhum post agendado, e ${situacao.artesProntas} ${situacao.artesProntas === 1 ? "arte pronta esperando" : "artes prontas esperando"}`
        : "Nenhum post agendado para os próximos dias",
      gravidade: "urgente",
      viraEtapa: true,
    });
  } else if (situacao.agendados < 2) {
    lista.push({
      chave: "agenda-curta",
      texto: "Só 1 post agendado daqui para a frente",
      gravidade: "atencao",
      viraEtapa: true,
    });
  }

  if (situacao.artesProntas === 0 && situacao.aguardandoAprovacao === 0) {
    lista.push({
      chave: "sem-arte",
      texto: "Nenhuma arte pronta nem em aprovação",
      gravidade: "urgente",
      viraEtapa: true,
    });
  }

  if (situacao.ultimoDiario) {
    const dias = Math.floor(
      (Date.now() - new Date(situacao.ultimoDiario).getTime()) / 86_400_000,
    );
    if (dias >= 7) {
      lista.push({
        chave: "diario-parado",
        texto: `O cliente não vê novidade no painel há ${dias} dias`,
        gravidade: "atencao",
        viraEtapa: true,
      });
    }
  } else {
    lista.push({
      chave: "diario-vazio",
      texto: "Nada escrito no diário deste cliente ainda",
      gravidade: "atencao",
      viraEtapa: true,
    });
  }

  // O buraco entre "planejei" e "existe": o calendário parece cheio e não
  // há nada para publicar. Some sozinho no instante em que a arte sobe.
  if (situacao.pautasSemArte > 0) {
    lista.push({
      chave: "pauta-sem-arte",
      texto: situacao.pautasSemArte === 1
        ? "1 pauta no calendário ainda sem arte anexada"
        : `${situacao.pautasSemArte} pautas no calendário ainda sem arte anexada`,
      gravidade: situacao.pautasSemArte >= 3 ? "urgente" : "atencao",
      viraEtapa: true,
    });
  }

  return lista;
}

/**
 * A ordem da fila: quem pede ação sobe, quem está resolvido desce.
 *
 * O pedido do dono: "conforme eu vou completando, ele vai movendo, e os
 * que ainda não estão concluídos vão subindo — para não dar confusão".
 * Urgência manda mais que contagem de etapa: um cliente com 5 de 6 e a
 * conexão caída importa mais hoje do que um com 1 de 6 e tudo em ordem.
 */
export function ordenarPelaUrgencia<T>(
  itens: T[],
  ler: (item: T) => { pendencias: Pendencia[]; feitas: number; nome: string },
): T[] {
  const peso = (item: T) => {
    const { pendencias } = ler(item);
    const urgentes = pendencias.filter((p) => p.gravidade === "urgente").length;
    const atencao = pendencias.filter((p) => p.gravidade === "atencao").length;
    return urgentes * 100 + atencao * 10;
  };
  return [...itens].sort((a, b) => {
    const pesoB = peso(b), pesoA = peso(a);
    if (pesoA !== pesoB) return pesoB - pesoA;            // mais urgente primeiro
    const la = ler(a), lb = ler(b);
    if (la.feitas !== lb.feitas) return la.feitas - lb.feitas;  // menos feito primeiro
    return la.nome.localeCompare(lb.nome, "pt-BR");
  });
}

/** O texto que a carteira mostra: "tudo certo" ou o que falta. */
export function leituraDaCarteira(
  porCliente: Array<{ nome: string; pendencias: Pendencia[] }>,
): { urgentes: number; emAtencao: number; emDia: number; frase: string } {
  const urgentes = porCliente.filter((c) =>
    c.pendencias.some((p) => p.gravidade === "urgente")).length;
  const emAtencao = porCliente.filter((c) =>
    !c.pendencias.some((p) => p.gravidade === "urgente")
    && c.pendencias.some((p) => p.gravidade === "atencao")).length;
  const emDia = porCliente.length - urgentes - emAtencao;

  if (porCliente.length === 0) {
    return { urgentes, emAtencao, emDia, frase: "Nenhum cliente nesta frente." };
  }
  if (urgentes === 0 && emAtencao === 0) {
    return { urgentes, emAtencao, emDia, frase: "Está tudo certo: nenhuma pendência na carteira." };
  }
  const partes: string[] = [];
  if (urgentes > 0) {
    partes.push(`${urgentes} ${urgentes === 1 ? "cliente pede ação hoje" : "clientes pedem ação hoje"}`);
  }
  if (emAtencao > 0) partes.push(`${emAtencao} para acompanhar`);
  if (emDia > 0) partes.push(`${emDia} em dia`);
  return { urgentes, emAtencao, emDia, frase: partes.join(" · ") };
}

/**
 * Os rótulos das etapas que giram, para aquele cliente naquela semana.
 *
 * A realidade vem primeiro; o acervo só preenche o que sobrar. `usadasAntes`
 * carrega os rótulos das últimas semanas — é o que faz a promessa de não
 * repetir virar verdade, e ela vale só para o acervo: pendência real repete
 * de propósito enquanto o problema estiver de pé.
 */
export function etapasQueGiram(input: {
  pendencias: Pendencia[];
  acervo: string[];
  usadasAntes: string[];
  quantidade: number;
}): string[] {
  const escolhidas: string[] = [];

  for (const p of input.pendencias) {
    if (escolhidas.length >= input.quantidade) break;
    if (!p.viraEtapa) continue;
    escolhidas.push(textoDaEtapa(p));
  }

  const recentes = new Set(input.usadasAntes);
  const frescas = input.acervo.filter((t) => !recentes.has(t));
  const fila = frescas.length > 0 ? frescas : input.acervo;
  for (const tarefa of fila) {
    if (escolhidas.length >= input.quantidade) break;
    if (!escolhidas.includes(tarefa)) escolhidas.push(tarefa);
  }

  return escolhidas.slice(0, input.quantidade);
}

/** A pendência dita como tarefa: o que fazer, não o que está errado. */
export function textoDaEtapa(p: Pendencia): string {
  switch (p.chave) {
    case "perderam-data": return "Reagendar os posts que perderam a data";
    case "recusadas": return "Refazer a arte que o cliente pediu para mudar";
    case "aprovacao-parada": return "Cobrar no grupo a aprovação que está parada";
    case "sem-agenda": return "Agendar os posts da semana";
    case "agenda-curta": return "Completar a agenda da semana";
    case "sem-arte": return "Criar as artes da semana";
    case "diario-parado":
    case "diario-vazio": return "Escrever no diário o que foi feito";
    case "pauta-sem-arte": return "Anexar a arte das pautas que estão sem";
    case "sem-campanha-cadastrada": return "Conectar a conta de anúncios ao painel";
    case "nenhuma-ativa": return "Colocar a campanha da semana no ar";
    case "verba-zerada": return "Recarregar a verba antes que a campanha pare";
    case "dado-parado": return "Conferir a coleta de dados das campanhas";
    case "tarefa-atrasada": return "Repactuar ou concluir as tarefas vencidas";
    case "tarefa-sem-dono": return "Definir responsável para as tarefas soltas";
    case "conexao-caida": return "Reconectar a conta social no painel";
    case "sem-metrica":
    case "metrica-parada": return "Conferir a coleta de métricas";
    default: return p.texto;
  }
}
