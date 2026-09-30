/**
 * Fila "Tarefas para o computador do agente" (Frente V2, 25/09/2026), DESLIGADA
 * por padrão. Desenho em docs/motores/COMPUTADOR-DO-AGENTE.md (Cua, trycua/cua).
 *
 * O painel só guarda o pedido e a prova. Quem opera o desktop é um executor
 * fora da Edge Function (Cua Driver numa máquina da agência ou um sandbox do
 * Cua Fleets), e só depois de o dono aprovar a tarefa. Regras duras:
 * - desligada até a variável COMPUTADOR_DO_AGENTE_LIGADO=1 no servidor;
 * - nada com senha, token ou cartão no texto da tarefa (credencial de cliente
 *   nunca passa pelo painel nem pelo modelo);
 * - toda tarefa nasce "aguardando_dono"; só o dono (admin) aprova;
 * - ação irreversível (enviar, publicar, pagar, apagar) exige a marca
 *   `irreversivel` e a aprovação cita isso;
 * - prova por screenshot em cada passo (trajetória), guardada no Storage.
 *
 * Puro: sem Deno, sem banco. A tela, a função mesa-videos e os testes usam o mesmo.
 */

export const ESTADOS_DA_TAREFA = ["aguardando_dono", "aprovada", "executando", "feita", "falhou", "cancelada"] as const;
export type EstadoDaTarefa = (typeof ESTADOS_DA_TAREFA)[number];

export const ROTULO_DA_TAREFA: Record<EstadoDaTarefa, string> = {
  aguardando_dono: "Aguardando o dono",
  aprovada: "Aprovada, na fila",
  executando: "Executando",
  feita: "Feita, com prova",
  falhou: "Não deu certo",
  cancelada: "Cancelada",
};

export const APPS_PREVISTOS = [
  { valor: "premiere", rotulo: "Adobe Premiere (organizar projeto e bins)" },
  { valor: "navegador", rotulo: "Navegador (cadastro sem senha)" },
  { valor: "arquivos", rotulo: "Pastas e arquivos" },
  { valor: "outro", rotulo: "Outro aplicativo" },
] as const;

export interface TarefaDoComputador {
  id: string;
  client_id: string | null;
  titulo: string;
  app: string;
  passos: string[];
  irreversivel: boolean;
  estado: EstadoDaTarefa;
  provas: { passo: number; storage_path: string; em: string }[];
  criado_por: string | null;
  criado_em: string;
  aprovado_por: string | null;
  aprovado_em: string | null;
  motivo: string | null;
}

export const MAX_PASSOS = 30;

/** A fila só funciona com a variável ligada no servidor (qualquer outro valor: desligada). */
export const computadorLigado = (valor: string | null | undefined) => String(valor || "").trim() === "1";

/**
 * Texto que parece credencial ou dado de pagamento: a tarefa é recusada.
 * Palavras e formas comuns; não é detector perfeito, é trava a mais.
 */
export function pareceCredencial(texto: string): boolean {
  const t = String(texto || "").toLowerCase();
  if (/(senha|password|passwd|token|api[\s_-]?key|chave de api|secret|segredo|c[oó]digo de verifica|2fa|otp|cvv|cart[aã]o de cr[eé]dito)\s*[:=]/.test(t)) return true;
  if (/\b(?:\d[ -]?){13,19}\b/.test(t)) return true; // número de cartão
  if (/\bsk-[a-z0-9]{16,}/.test(t) || /\beyj[a-z0-9_-]{20,}\./.test(t)) return true; // chave ou JWT
  return false;
}

const PALAVRAS_IRREVERSIVEIS = /(enviar|envie|publicar|publique|postar|pagar|pague|comprar|apagar|apague|excluir|exclua|deletar|transferir|assinar|aceitar os termos|confirmar pedido)/i;

export function pedeAcaoIrreversivel(passos: string[]): boolean {
  return passos.some((p) => PALAVRAS_IRREVERSIVEIS.test(p));
}

export function normalizarPedidoDeTarefa(bruto: unknown): { titulo: string; app: string; passos: string[]; irreversivel: boolean } {
  const o = bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>) : {};
  const titulo = String(o.titulo ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
  const app = APPS_PREVISTOS.some((a) => a.valor === o.app) ? String(o.app) : "outro";
  const lista = Array.isArray(o.passos) ? o.passos : String(o.passos || "").split("\n");
  const passos = lista
    .map((p) => String(p ?? "").replace(/\s+/g, " ").trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, MAX_PASSOS);
  return { titulo, app, passos, irreversivel: o.irreversivel === true || pedeAcaoIrreversivel(passos) };
}

/** Motivo para recusar a tarefa já no pedido (null = pode ir para a fila do dono). */
export function motivoParaRecusar(p: { titulo: string; passos: string[] }, ligado: boolean): string | null {
  if (!ligado) return "O computador do agente está desligado. O dono liga quando houver um executor aprovado (docs/motores/COMPUTADOR-DO-AGENTE.md).";
  if (!p.titulo) return "Dê um título curto à tarefa.";
  if (!p.passos.length) return "Escreva os passos, um por linha.";
  if ([p.titulo].concat(p.passos).some(pareceCredencial)) return "A tarefa tem senha, token ou dado de cartão. Credencial de cliente nunca passa pelo painel: o dono faz esse passo.";
  return null;
}

/** Quem pode mudar o estado: só o dono (admin) aprova; a equipe cancela o que pediu. */
export function podeMudarEstado(atual: EstadoDaTarefa, novo: EstadoDaTarefa, papel: string, ehQuemPediu: boolean): boolean {
  if (novo === "aprovada") return atual === "aguardando_dono" && papel === "admin";
  if (novo === "cancelada") return (atual === "aguardando_dono" || atual === "aprovada") && (papel === "admin" || ehQuemPediu);
  // executando, feita e falhou são do executor (service_role), nunca da tela.
  return false;
}
