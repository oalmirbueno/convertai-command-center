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
  const lista: Pendencia[] = [];
  if (area !== "social") return lista;

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

  const ordem: Record<Gravidade, number> = { urgente: 0, atencao: 1, tranquilo: 2 };
  return lista.sort((a, b) => ordem[a.gravidade] - ordem[b.gravidade]);
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
    default: return p.texto;
  }
}
