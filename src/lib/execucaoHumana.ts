import { TASK_DELIVERY_TYPE_LABELS, type TaskDeliveryType } from "@/lib/taskDeliveryTypes";
import { limparTecnico } from "@/lib/cadernoExecucao";

/**
 * O trabalho dos agentes dito como uma pessoa diria (16/10/2026, dono: "o que foi feito de fato?
 * de forma clara, quando é arte, quando são lâminas"; "estou fazendo arte no carrossel para o
 * cliente; quer conversar comigo?"; "sem código, sem termos técnicos").
 *
 * Tudo aqui sai dos dados da tarefa (título, tipo de entrega, cliente, situação): nada é inventado
 * nem resumido por IA. Quando o tipo da entrega não está marcado, o título diz (carrossel, arte,
 * vídeo, lâminas...).
 */

const PELO_TITULO: Array<[RegExp, string]> = [
  [/carross/i, "carrossel"],
  [/l[âa]mina/i, "lâminas"],
  [/\breels?\b/i, "reels"],
  [/v[íi]deo|aftermovie|filmagem|edi[çc][ãa]o/i, "vídeo"],
  [/\bstor(y|ies)\b/i, "stories"],
  [/\barte|criativo|pe[çc]a/i, "arte"],
  [/\bpost\b/i, "post"],
  [/landing|p[áa]gina de/i, "página"],
  [/\bsite\b/i, "site"],
  [/roteiro/i, "roteiro"],
  [/relat[óo]rio/i, "relatório"],
  [/an[úu]ncio|campanha|meta ads|tr[áa]fego/i, "anúncios"],
  [/briefing|planejamento|plano/i, "planejamento"],
];

/** O que é a entrega, em uma palavra de gente ("carrossel", "vídeo", "arte"...). */
export function tipoDaEntrega(tipo?: string | null, titulo?: string | null): string | null {
  const marcado = tipo && tipo !== "unspecified" && tipo !== "other" ? TASK_DELIVERY_TYPE_LABELS[tipo as TaskDeliveryType] : null;
  if (marcado) return marcado.toLowerCase();
  const t = String(titulo || "");
  return PELO_TITULO.find(([re]) => re.test(t))?.[1] ?? null;
}

/** O artigo de cada tipo ("o carrossel", "a arte", "as lâminas"). */
const FEMININO = /^(arte|página|landing page|automação)$/;
const PLURAL_F = /^(lâminas)$/;
const PLURAL_M = /^(stories|anúncios)$/;
const comArtigo = (tipo: string) => `${PLURAL_F.test(tipo) ? "as" : PLURAL_M.test(tipo) ? "os" : FEMININO.test(tipo) ? "a" : "o"} ${tipo}`;

const curto = (t: string, n = 70) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

/** A frase do agente em primeira pessoa, pela situação do trabalho. */
export function fraseDoAgente(o: { status: string; titulo?: string | null; cliente?: string | null; tipo?: string | null; motivo?: string | null }): string {
  const titulo = curto(limparTecnico(String(o.titulo || "uma tarefa")).replace(/^\[[^\]]+\]\s*/, ""));
  const para = o.cliente ? ` para ${o.cliente}` : "";
  const oque = o.tipo ? `${comArtigo(o.tipo)} "${titulo}"` : `"${titulo}"`;
  switch (o.status) {
    case "in_progress": return `Estou fazendo ${oque}${para}.`;
    case "queued": return `Vou começar ${oque}${para}.`;
    case "review": return `Terminei ${oque}${para} e estou esperando você aprovar.`;
    case "awaiting_input": return `Preciso de algo seu para seguir com ${oque}${para}.`;
    case "blocked": return `Parei em ${oque}${para}${o.motivo ? `: ${curto(o.motivo, 90)}` : "."}`;
    case "done": return `Entreguei ${oque}${para}.`;
    default: return `Estou com ${oque}${para}.`;
  }
}

/** "O que foi feito", claro: o tipo da entrega e o estado da prova, em vez de "arquivo interno". */
export function oQueFoiFeito(o: { status: string; tipo?: string | null; temImagem?: boolean; temProva?: boolean }): string {
  const coisa = o.tipo || "entrega";
  if (o.status === "review") return `Pronto para você aprovar: ${coisa}${o.temImagem ? " (veja a imagem)" : o.temProva ? " (prova anexada)" : ""}.`;
  if (o.status === "done") return `Entregue: ${coisa}${o.temProva ? ", com prova" : ""}.`;
  return `Em produção: ${coisa}${o.temProva ? " (já tem prova registrada)" : " (ainda sem prova anexada)"}.`;
}
