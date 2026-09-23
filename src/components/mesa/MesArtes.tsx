import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  COLUNAS_DA_ARTE_DO_ESTUDIO,
  montarArteDoEstudio,
  type ArteDoEstudioNaAgenda,
  type EditorialFileRow,
  type TrabalhoDoEstudioNaAgenda,
} from "@/hooks/useEditorialCalendar";

/**
 * Miniaturas da Agenda do mês, do mesmo jeito que a Agenda do painel:
 * - por item: a arte que o Estúdio entregou (capa e lâminas pelo file_ids do
 *   trabalho), igual ao mapa "artes do Estúdio" da Agenda;
 * - por post: o arquivo principal do post agendado ou publicado.
 * Tudo vira objeto simples (JSON puro), pronto para o cache guardado.
 * A miniatura é um extra: se os arquivos não vierem, a agenda segue sem ela.
 */

export interface ArtesDoMes {
  /** Tarefa (item da agenda) para a arte do Estúdio com capa. */
  porItem: Record<string, ArteDoEstudioNaAgenda>;
  /** Post para a arte principal dele. */
  porPost: Record<string, ArteDoEstudioNaAgenda>;
}

export const SEM_ARTES: ArtesDoMes = { porItem: {}, porPost: {} };

export interface PostComArquivo {
  post_id: string;
  arquivo_id: string | null;
}

/** Junta trabalhos, posts e arquivos lidos nas artes do mês (função pura, testada). */
export function montarArtesDoMes(
  clientId: string,
  trabalhos: TrabalhoDoEstudioNaAgenda[],
  posts: PostComArquivo[],
  capas: EditorialFileRow[],
  filhos: EditorialFileRow[],
): ArtesDoMes {
  const porItem: Record<string, ArteDoEstudioNaAgenda> = {};
  const deItens = montarArteDoEstudio(trabalhos, capas, filhos);
  for (const id of Object.keys(deItens)) if (deItens[id].capa) porItem[id] = deItens[id];

  // O post reaproveita a mesma montagem: um "trabalho" com a capa do post.
  const comoTrabalhos: TrabalhoDoEstudioNaAgenda[] = posts
    .filter((p) => !!p.arquivo_id)
    .map((p) => ({ task_id: p.post_id, client_id: clientId, status: null, entrega_status: null, file_ids: [p.arquivo_id as string] }));
  const porPost: Record<string, ArteDoEstudioNaAgenda> = {};
  const dePosts = montarArteDoEstudio(comoTrabalhos, capas, filhos);
  for (const id of Object.keys(dePosts)) if (dePosts[id].capa) porPost[id] = dePosts[id];

  return { porItem, porPost };
}

const unicos = (lista: string[]) => lista.filter((v, i) => !!v && lista.indexOf(v) === i).sort();

export function useArtesDoMes(clientId: string, mes: string, idsItens: string[], posts: PostComArquivo[]) {
  const itens = unicos(idsItens).slice(0, 300);
  const postsComArte = posts.filter((p) => !!p.arquivo_id).slice(0, 300);
  const chavePosts = postsComArte.map((p) => `${p.post_id}:${p.arquivo_id}`).sort();
  return useQuery({
    queryKey: ["mesa", "artes-do-mes", clientId, mes, itens, chavePosts],
    enabled: !!clientId && (itens.length > 0 || postsComArte.length > 0),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<ArtesDoMes> => {
      let trabalhos: TrabalhoDoEstudioNaAgenda[] = [];
      if (itens.length) {
        const { data, error } = await (supabase as any)
          .from("estudio_trabalhos")
          .select("task_id, client_id, status, entrega_status, file_ids, atualizado_em")
          .eq("client_id", clientId)
          .in("task_id", itens);
        if (error) throw error;
        trabalhos = (data || []) as TrabalhoDoEstudioNaAgenda[];
      }
      const capaIds: string[] = [];
      for (const t of trabalhos) {
        const capa = Array.isArray(t.file_ids) ? t.file_ids[0] : null;
        if (capa && capaIds.indexOf(capa) < 0) capaIds.push(capa);
      }
      for (const p of postsComArte) if (p.arquivo_id && capaIds.indexOf(p.arquivo_id) < 0) capaIds.push(p.arquivo_id);
      if (!capaIds.length) return montarArtesDoMes(clientId, trabalhos, [], [], []);
      const [leituraCapas, leituraFilhos] = await Promise.all([
        (supabase as any).from("staff_files_secure").select(COLUNAS_DA_ARTE_DO_ESTUDIO).in("id", capaIds),
        (supabase as any)
          .from("staff_files_secure")
          .select(COLUNAS_DA_ARTE_DO_ESTUDIO)
          .in("parent_file_id", capaIds)
          .is("archived_at", null),
      ]);
      const capas = leituraCapas.error ? [] : ((leituraCapas.data || []) as EditorialFileRow[]);
      const filhos = leituraFilhos.error ? [] : ((leituraFilhos.data || []) as EditorialFileRow[]);
      return montarArtesDoMes(clientId, trabalhos, postsComArte, capas, filhos);
    },
  });
}
