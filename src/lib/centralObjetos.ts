/**
 * Objetos do OS que a Central abre na lateral nativa (09/10/2026): tarefa,
 * memória, solicitação de aprovação, projeto, arquivo, publicação e execução
 * de agente. Sem iframe e sem a casca do painel: o componente
 * ObjetoDaCentral lê o próprio objeto (RLS do dono) e mostra as ações dele.
 */

export type TipoDeObjeto = "tarefa" | "memoria_agente" | "memoria_projeto" | "aprovacao" | "projeto" | "arquivo" | "publicacao" | "vinculo";

export type ObjetoAberto = { tipo: TipoDeObjeto; id: string; titulo?: string | null; client_id?: string | null };

export const ROTULO_DO_TIPO: Record<TipoDeObjeto, string> = {
  tarefa: "Tarefa",
  memoria_agente: "Memória",
  memoria_projeto: "Memória",
  aprovacao: "Aprovação",
  projeto: "Projeto",
  arquivo: "Arquivo",
  publicacao: "Publicação",
  vinculo: "Execução",
};

type FonteMinima = { tipo: string; titulo: string; ids: { tarefa?: string; vinculo?: string; publicacao?: string; aprovacao?: string } };

/** O objeto por trás de uma fonte do Gestor (o mesmo critério de objetoDaFonte na função). */
export function objetoDaFonte(f: FonteMinima): ObjetoAberto | null {
  const titulo = f.titulo;
  if (f.tipo === "aprovacao" && f.ids.aprovacao) return { tipo: "aprovacao", id: f.ids.aprovacao, titulo };
  if (f.tipo === "publicacao" && f.ids.publicacao) return { tipo: "publicacao", id: f.ids.publicacao, titulo };
  if ((f.tipo === "tarefa" || f.tipo === "entrega") && f.ids.tarefa) return { tipo: "tarefa", id: f.ids.tarefa, titulo };
  if ((f.tipo === "execucao" || f.tipo === "diario") && f.ids.vinculo) return { tipo: "vinculo", id: f.ids.vinculo, titulo };
  if (f.ids.tarefa) return { tipo: "tarefa", id: f.ids.tarefa, titulo };
  return null;
}

const TIPOS = new Set<TipoDeObjeto>(["tarefa", "memoria_agente", "memoria_projeto", "aprovacao", "projeto", "arquivo", "publicacao", "vinculo"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Aceita só objeto bem formado (o que vem gravado na conversa é dado, não confiança). */
export function objetoValido(v: unknown): ObjetoAberto | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.tipo !== "string" || !TIPOS.has(o.tipo as TipoDeObjeto) || typeof o.id !== "string" || !UUID.test(o.id)) return null;
  return { tipo: o.tipo as TipoDeObjeto, id: o.id, titulo: typeof o.titulo === "string" ? o.titulo : null, client_id: typeof o.client_id === "string" ? o.client_id : null };
}
