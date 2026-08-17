import { supabase } from "@/integrations/supabase/client";

/**
 * A memória viva de cada cliente.
 *
 * O painel sabia o estado ATUAL de tudo (arquivos, publicações, etapas), mas
 * não guardava a história: por que uma decisão foi tomada, o que a gente
 * prometeu na semana passada, o que mudou de rumo no mês passado. Sem isso,
 * cada ritual recomeçava do zero e o contexto vivia na cabeça de quem estava
 * na conversa.
 *
 * Aqui cada passo relevante vira um registro imutável, com data, autor e
 * origem. A linha do tempo desses registros É o versionamento: nada é
 * sobrescrito, então dá para ler a evolução do cliente de ponta a ponta.
 *
 * A tabela já nasce com as permissões certas: a equipe escreve e lê tudo, e o
 * cliente lê apenas a própria história (por isso o que for marcado como
 * visível para ele precisa ser escrito na língua dele).
 */

export type MemoryKind =
  | "ritual"      // mensagem enviada ao cliente
  | "ciclo"       // semana de operação fechada
  | "entrega"     // material liberado
  | "aprovacao"   // decisão do cliente sobre um material
  | "decisao"     // mudança de rumo combinada
  | "nota"        // anotação da equipe (Studio)
  | "marco";      // conquista ou virada de etapa

export interface MemoryInput {
  clientId: string;
  projectId?: string | null;
  kind: MemoryKind;
  title: string;
  content: string;
  /** Onde isso aconteceu no painel: central, ciclo, studio, arquivos... */
  source: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  /** Verdadeiro quando o texto está pronto para o cliente ler. */
  clientVisible?: boolean;
}

export interface MemoryEntry {
  id: string;
  client_id: string;
  project_id: string | null;
  kind: string;
  title: string | null;
  content: string;
  source: string;
  tags: string[];
  metadata: Record<string, unknown> | null;
  created_at: string;
  created_by: string | null;
}

/**
 * Grava um passo na história do cliente.
 *
 * Nunca lança: registrar memória é efeito colateral de uma ação que já deu
 * certo (o ritual foi publicado, a semana foi fechada). Se a gravação falhar,
 * a ação principal não pode ser desfeita nem o usuário ver um erro que não
 * sabe resolver.
 */
export async function recordMemory(input: MemoryInput): Promise<boolean> {
  try {
    const { data: session } = await supabase.auth.getUser();
    const { error } = await supabase.from("project_memory").insert({
      client_id: input.clientId,
      project_id: input.projectId || null,
      kind: input.kind,
      title: input.title.slice(0, 200),
      content: input.content.slice(0, 8000),
      source: input.source,
      tags: input.tags || [],
      metadata: {
        ...(input.metadata || {}),
        client_visible: input.clientVisible === true,
      },
      created_by: session?.user?.id || null,
    } as any);
    if (error) {
      console.warn("[memória] não foi possível registrar:", error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[memória] falha inesperada:", error);
    return false;
  }
}

/** A história do cliente, do mais recente para o mais antigo. */
export async function readMemory(
  clientId: string,
  options?: { limit?: number; kinds?: MemoryKind[]; onlyClientVisible?: boolean },
): Promise<MemoryEntry[]> {
  let query = supabase
    .from("project_memory")
    .select("id, client_id, project_id, kind, title, content, source, tags, metadata, created_at, created_by")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(options?.limit ?? 20);

  if (options?.kinds?.length) query = query.in("kind", options.kinds);

  const { data, error } = await query;
  if (error) return [];
  const rows = (data || []) as unknown as MemoryEntry[];
  return options?.onlyClientVisible
    ? rows.filter((row) => (row.metadata as any)?.client_visible === true)
    : rows;
}

/**
 * A história recente em texto corrido, pronta para alimentar a IA dos rituais
 * e do coach. É o que dá continuidade: a mensagem de hoje sabe o que a de
 * ontem prometeu.
 */
export function memoryAsContext(entries: MemoryEntry[], max = 8): string {
  if (entries.length === 0) return "";
  return entries
    .slice(0, max)
    .map((entry) => {
      const quando = new Date(entry.created_at).toLocaleDateString("pt-BR");
      return `- ${quando} · ${entry.kind}: ${entry.title || ""} ${entry.content}`.trim().slice(0, 400);
    })
    .join("\n");
}

/** Rótulo humano de cada tipo, para as telas. */
export const MEMORY_LABELS: Record<string, string> = {
  ritual: "Mensagem enviada",
  ciclo: "Semana de operação",
  entrega: "Entrega",
  aprovacao: "Aprovação",
  decisao: "Decisão",
  nota: "Anotação da equipe",
  marco: "Marco",
};
