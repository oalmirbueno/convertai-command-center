import { dataEHora } from "@/lib/mesa/api";
import { ultimasVersoes, type ArteNaAgenda, type ItemDoMes, type Trabalho } from "./useItensDoMes";

/**
 * Em que ponto da esteira cada item está. Regras puras (sem tela), usadas
 * pela lista, pelos filtros e pelo inspetor, e fixadas nos testes.
 *
 * Um item está "resolvido" quando o estúdio entregou a arte, ou quando a
 * Agenda já tem arte para ele e ninguém começou um trabalho novo no estúdio.
 * Resolvido não conta em "A fazer": o dono não pode fazer a mesma arte duas
 * vezes por engano.
 */

export type FiltroDoEstudio = "a_fazer" | "com_arte" | "na_agenda";
export type TomDoSelo = "neutro" | "primario" | "ok" | "alerta" | "erro";

export const FILTROS_DO_ESTUDIO: { valor: FiltroDoEstudio; rotulo: string; dica: string }[] = [
  { valor: "a_fazer", rotulo: "A fazer", dica: "Tudo o que ainda não foi entregue nem tem arte na Agenda" },
  { valor: "com_arte", rotulo: "Com arte", dica: "Já tem lâmina gerada, falta terminar ou entregar" },
  { valor: "na_agenda", rotulo: "Na agenda", dica: "Entregue em Arquivos ou com arte já na Agenda" },
];

/** Filtro guardado em versão antiga ("entregues") vira o novo "na_agenda". */
export function filtroValido(f: unknown): FiltroDoEstudio {
  if (f === "com_arte" || f === "a_fazer") return f;
  if (f === "na_agenda" || f === "entregues") return "na_agenda";
  return "a_fazer";
}

/** O trabalho do estúdio chegou ao fim da esteira (entregue em Arquivos ou já agendado). */
export const trabalhoEntregue = (t: Trabalho | null | undefined): boolean =>
  !!t && (t.status === "entregue" || t.entrega_status === "agendado");

/** O item tem direção de arte (lâminas) montada no estúdio. */
export const temDirecao = (t: Trabalho | null | undefined): boolean => !!t && (t.direcao?.cards || []).length > 0;

/** Entregue em Arquivos e ainda não enviado (ou reentregue depois de um ajuste). Igual à regra da aba Entrega. */
export function faltaEnviar(t: Trabalho | null | undefined): boolean {
  return !!t && t.status === "entregue" && (t.file_ids || []).length > 0 && (!t.entrega_status || t.entrega_status === "reprovado");
}

export function itemResolvido(t: Trabalho | null | undefined, arte: ArteNaAgenda | null | undefined): boolean {
  if (trabalhoEntregue(t)) return true;
  // Arte na Agenda conta como feita enquanto não existir trabalho novo em andamento.
  return !!arte && !temDirecao(t);
}

export function comArte(t: Trabalho | null | undefined): boolean {
  return !!t && ultimasVersoes(t.cards || []).size > 0;
}

export function passaNoFiltro(f: FiltroDoEstudio, t: Trabalho | null | undefined, arte: ArteNaAgenda | null | undefined): boolean {
  const resolvido = itemResolvido(t, arte);
  if (f === "na_agenda") return resolvido;
  if (resolvido) return false;
  if (f === "com_arte") return comArte(t);
  return true;
}

export function contarFiltros(
  itens: ItemDoMes[],
  trabalhoDe: (i: ItemDoMes) => Trabalho | null,
  arteDe: (i: ItemDoMes) => ArteNaAgenda | null,
): Record<FiltroDoEstudio, number> {
  const c: Record<FiltroDoEstudio, number> = { a_fazer: 0, com_arte: 0, na_agenda: 0 };
  for (const i of itens) {
    const t = trabalhoDe(i);
    const a = arteDe(i);
    if (passaNoFiltro("a_fazer", t, a)) c.a_fazer++;
    if (passaNoFiltro("com_arte", t, a)) c.com_arte++;
    if (passaNoFiltro("na_agenda", t, a)) c.na_agenda++;
  }
  return c;
}

/** Selo curto do item na lista e na barra do item. */
export function situacaoDoItem(
  t: Trabalho | null | undefined,
  arte: ArteNaAgenda | null | undefined,
  temRoteiro: boolean,
): { rotulo: string; tom: TomDoSelo } {
  if (!temDirecao(t)) {
    if (trabalhoEntregue(t) || arte) return { rotulo: "na agenda", tom: "ok" };
    if (t && t.status === "erro") return { rotulo: "com erro", tom: "erro" };
    return temRoteiro ? { rotulo: "roteiro pronto", tom: "primario" } : { rotulo: "sem direção", tom: "neutro" };
  }
  const tr = t as Trabalho;
  if (tr.entrega_status === "agendado") return { rotulo: "na agenda", tom: "ok" };
  if (tr.status === "entregue") {
    switch (tr.entrega_status) {
      case "aguardando_agencia":
        return { rotulo: "revisão da agência", tom: "primario" };
      case "aguardando_cliente":
        return { rotulo: "com o cliente", tom: "primario" };
      case "aprovado":
        return { rotulo: "aprovado", tom: "ok" };
      case "precisa_de_atencao":
        return { rotulo: "precisa de atenção", tom: "erro" };
      default:
        return { rotulo: "falta enviar", tom: "alerta" };
    }
  }
  if (tr.entrega_status === "reprovado") return { rotulo: "ajuste pedido", tom: "erro" };
  if (tr.status === "erro") return { rotulo: "com erro", tom: "erro" };
  const feitas = ultimasVersoes(tr.cards || []).size;
  const total = (tr.direcao?.cards || []).length;
  if (!feitas) return { rotulo: "direção pronta", tom: "primario" };
  if (feitas < total) return { rotulo: `${feitas} de ${total} com arte`, tom: "alerta" };
  return { rotulo: "arte pronta", tom: "ok" };
}

/** Uma frase sobre onde a arte entregue está no caminho até a Agenda. */
export function textoDaEntrega(t: Trabalho): string {
  switch (t.entrega_status) {
    case "aguardando_agencia":
      return "Aguardando a revisão da agência.";
    case "aguardando_cliente":
      return "Aguardando a aprovação do cliente.";
    case "aprovado":
      return "Aprovado pelo cliente. Entra na Agenda em até um minuto.";
    case "agendado":
      return t.agendado_para ? `Na Agenda para ${dataEHora(t.agendado_para)}.` : "Na Agenda.";
    case "precisa_de_atencao":
      return t.entrega_aviso || "Aprovado, mas não entrou sozinho na Agenda.";
    case "reprovado":
      return "Nova versão entregue. Falta enviar para aprovação.";
    default:
      return "Entregue em Arquivos. Falta enviar para aprovação.";
  }
}

/** Link da Agenda para o post (com o dia, quando há publicação marcada). */
export function linkDaAgenda(clientId: string, postId: string, quando?: string | null): string {
  const d = quando ? new Date(quando) : null;
  const dois = (n: number) => (n < 10 ? `0${n}` : String(n));
  const dia = d && !Number.isNaN(d.getTime()) ? `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}` : null;
  return `/calendario?client=${clientId}&content=${postId}${dia ? `&date=${dia}` : ""}`;
}

/** Etapas da esteira, na ordem, e qual está em curso para o item. */
export const ETAPAS_DA_ESTEIRA: { chave: string; rotulo: string; dica: string }[] = [
  { chave: "direcao", rotulo: "Direção", dica: "Roteiro do estrategista ou diretor de arte decide cada lâmina" },
  { chave: "laminas", rotulo: "Lâminas", dica: "O gerador faz cada lâmina inteira, com o texto dentro, e a leitura confere" },
  { chave: "legenda", rotulo: "Legenda", dica: "Legenda e 4 ou 5 hashtags, para copiar ou ir junto" },
  { chave: "arquivos", rotulo: "Arquivos", dica: "Entrega cria o post em Arquivos, ligado ao item da agenda" },
  { chave: "aprovacao", rotulo: "Aprovação", dica: "O cliente aprova e o post entra sozinho na Agenda" },
];

/** Índice da etapa em curso (0 a 4); 5 quando tudo terminou. */
export function etapaDoItem(t: Trabalho | null | undefined, arte: ArteNaAgenda | null | undefined): number {
  if (!temDirecao(t)) return trabalhoEntregue(t) || arte ? 5 : 0;
  const tr = t as Trabalho;
  if (tr.entrega_status === "agendado" || tr.entrega_status === "aprovado") return 5;
  if (tr.status === "entregue") return 4;
  const total = (tr.direcao?.cards || []).length;
  if (ultimasVersoes(tr.cards || []).size < total) return 1;
  if (!(tr.legenda || "").trim()) return 2;
  return 3;
}
