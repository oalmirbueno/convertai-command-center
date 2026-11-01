import { supabase } from "@/integrations/supabase/client";

/**
 * Checklists soltos do cliente.
 *
 * O ciclo semanal cobre a rotina; isto cobre o combinado do momento, aquilo
 * que aparece numa conversa e some se ninguém anotar: "gravar depoimento na
 * loja quinta", "refazer a arte do cardápio", "pedir as fotos antes de sexta".
 *
 * Moram na mesma história do cliente (project_memory, kind "checklist"), então
 * nascem já fazendo parte do contexto: a IA dos rituais lê, o histórico
 * mostra, e o que foi cumprido não precisa ser lembrado de cabeça.
 */

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  done_at?: string | null;
}

export interface Checklist {
  /** Id do registro na memória. */
  id: string;
  title: string;
  items: ChecklistItem[];
  created_at: string;
  /** O pedido original, do jeito que foi escrito. */
  request?: string;
}

const novoId = () =>
  `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Ponto de abreviação ("Dr. Paulo") guardado com um caractere que não quebra; volta a ser ponto no fim.
const PONTO_GUARDADO = "\u2024";

/**
 * Quebra o pedido em itens sem depender de IA.
 *
 * O motor com IA deixa a lista melhor, mas não pode ser condição para
 * existir: se ele estiver fora do ar, o combinado do momento não pode se
 * perder. Aqui o texto vira lista pela pontuação e pelas conjunções que as
 * pessoas usam naturalmente ao enumerar tarefas.
 */
export function splitRequestIntoItems(pedido: string): string[] {
  // Ponto só separa com espaço depois: "aceleriq.com.br" e "ana@loja.com" ficam inteiros.
  // Sem lookbehind (Safari 11): a abreviação é protegida antes do split.
  return pedido
    .replace(/\b(Dra|Dr|Sra|Sr)\.(?=\s)/gi, `$1${PONTO_GUARDADO}`)
    .split(/\n|;|,\s*(?=[a-zà-ú])|\.\s+(?=[a-zà-ú])|\s+e\s+(?=[a-zà-ú]{3,})|\s+depois\s+/i)
    .map((parte) =>
      parte
        .split(PONTO_GUARDADO).join(".")
        .replace(/^[-•*\d.)\s]+/, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((parte) => parte.length > 2)
    .slice(0, 6)
    .map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1, 120));
}

/** O texto que fica no corpo do registro: é o que a IA e o histórico leem. */
function corpoDe(items: ChecklistItem[], request?: string): string {
  const feitos = items.filter((i) => i.done).length;
  return [
    request ? `Pedido: ${request}` : "",
    `Progresso: ${feitos} de ${items.length} concluídos.`,
    ...items.map((i) => `${i.done ? "[x]" : "[ ]"} ${i.text}`),
  ]
    .filter(Boolean)
    .join("\n");
}

/** Cria o checklist na história do cliente. */
export async function createChecklist(input: {
  clientId: string;
  title: string;
  items: string[];
  request?: string;
  tags?: string[];
}): Promise<Checklist | null> {
  const items: ChecklistItem[] = input.items.map((text) => ({
    id: novoId(),
    text: text.slice(0, 200),
    done: false,
  }));

  try {
    const { data: session } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("project_memory")
      .insert({
        client_id: input.clientId,
        kind: "checklist",
        title: input.title.slice(0, 200),
        content: corpoDe(items, input.request),
        source: "ciclo",
        tags: input.tags || [],
        metadata: {
          items,
          request: input.request || null,
          completed: false,
          client_visible: false,
        },
        created_by: session?.user?.id || null,
      } as any)
      .select("id, title, content, metadata, created_at")
      .single();
    if (error || !data) return null;
    return {
      id: (data as any).id,
      title: (data as any).title,
      items,
      created_at: (data as any).created_at,
      request: input.request,
    };
  } catch {
    return null;
  }
}

/** Os checklists abertos e os recém-concluídos daquele cliente. */
export async function listChecklists(clientId: string): Promise<Checklist[]> {
  const { data, error } = await supabase
    .from("project_memory")
    .select("id, title, content, metadata, created_at")
    .eq("client_id", clientId)
    .eq("kind", "checklist")
    .order("created_at", { ascending: false })
    .limit(10);
  if (error || !data) return [];

  return (data as any[])
    .map((row) => ({
      id: row.id,
      title: row.title || "Checklist",
      items: Array.isArray(row.metadata?.items) ? (row.metadata.items as ChecklistItem[]) : [],
      created_at: row.created_at,
      request: row.metadata?.request || undefined,
    }))
    .filter((lista) => lista.items.length > 0);
}

/**
 * Marca ou desmarca um item.
 *
 * O corpo do registro é reescrito junto, porque é ele que a IA lê: sem isso,
 * o histórico continuaria dizendo que nada foi feito.
 *
 * Os toques na mesma lista entram numa fila: cada um parte do estado deixado
 * pelo anterior. Antes, dois cliques seguidos partiam da mesma lista antiga e
 * o segundo update gravava a lista sem o primeiro item (desmarcava o que
 * acabou de ser marcado). Com a fila vazia, vale a lista que a tela mandou.
 */
const filaDoChecklist = new Map<string, Promise<Checklist>>();

export function toggleChecklistItem(
  checklist: Checklist,
  itemId: string,
): Promise<Checklist | null> {
  const vez = filaDoChecklist.get(checklist.id) ?? Promise.resolve(checklist);
  let base = checklist;
  const resultado = vez.then((atual) => {
    base = atual;
    return gravarToque(atual, itemId);
  });
  // O próximo toque parte do que foi gravado; se este falhou, do que havia antes dele.
  const depois = resultado.then((gravado) => gravado ?? base);
  filaDoChecklist.set(checklist.id, depois);
  void depois.then(() => {
    if (filaDoChecklist.get(checklist.id) === depois) filaDoChecklist.delete(checklist.id);
  });
  return resultado;
}

async function gravarToque(
  checklist: Checklist,
  itemId: string,
): Promise<Checklist | null> {
  const items = checklist.items.map((item) =>
    item.id === itemId
      ? { ...item, done: !item.done, done_at: !item.done ? new Date().toISOString() : null }
      : item,
  );
  const concluido = items.every((item) => item.done);

  try {
    const { error } = await supabase
      .from("project_memory")
      .update({
        content: corpoDe(items, checklist.request),
        metadata: {
          items,
          request: checklist.request || null,
          completed: concluido,
          completed_at: concluido ? new Date().toISOString() : null,
          client_visible: false,
        },
      } as any)
      .eq("id", checklist.id);
    if (error) return null;
    return { ...checklist, items };
  } catch {
    return null;
  }
}

/** Remove um checklist inteiro (quando foi criado por engano). */
export async function deleteChecklist(id: string): Promise<boolean> {
  const { error } = await supabase.from("project_memory").delete().eq("id", id);
  return !error;
}

export function checklistProgress(checklist: Checklist): { done: number; total: number } {
  return {
    done: checklist.items.filter((item) => item.done).length,
    total: checklist.items.length,
  };
}
