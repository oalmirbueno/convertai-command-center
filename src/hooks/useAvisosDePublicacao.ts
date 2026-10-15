import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AvisoDePublicacao } from "@/lib/avisoDePublicacao";

/*
 * Avisos de post no ar (tabela aviso_publicacao, só administrador lê) com o
 * arquivo do post para a mesa de decisão mostrar a imagem. A mesma leitura
 * serve a seção de avisos e a mesa da Revisão (mesma chave de cache).
 */
type Reply<T> = { data: T | null; error: { message: string } | null };
const banco = supabase as unknown as {
  from: (t: "aviso_publicacao") => { select: (c: string) => { order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => PromiseLike<Reply<AvisoDePublicacao[]>> } } };
  rpc: (nome: string, args: Record<string, unknown>) => PromiseLike<Reply<unknown>>;
};

export function useAvisosDePublicacao(ativo: boolean) {
  return useQuery({
    queryKey: ["avisos-de-publicacao"], enabled: ativo, refetchInterval: 20_000,
    queryFn: async () => {
      const { data, error } = await banco.from("aviso_publicacao")
        .select("*, client:profiles!aviso_publicacao_client_id_fkey(company_name,full_name), publicacao:editorial_publications!aviso_publicacao_publication_id_fkey(arquivo:files!editorial_publications_file_id_fkey(file_url,storage_bucket,storage_path,mime_type))")
        .order("created_at", { ascending: false }).limit(100);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export async function chamarAviso(nome: string, args: Record<string, unknown>) {
  const { data, error } = await banco.rpc(nome, args);
  if (error) throw new Error(error.message);
  if (!data) throw new Error("O servidor não confirmou a operação. Atualize antes de tentar de novo.");
  return data;
}
