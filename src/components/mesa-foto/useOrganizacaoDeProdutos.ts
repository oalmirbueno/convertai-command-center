import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao } from "@/lib/mesa/api";
import { useKits, type FotoDoAcervo } from "./fotoApi";
import { organizarFotosPorProduto, type PessoaDaPasta, type VinculoDaGeracao } from "./pastasDosProdutos";

export const moverProdutoParaPasta = (clientId: string, kitId: string, pasta: string) => chamarFuncao("mesa-foto", { acao: "produto_organizar", client_id: clientId, kit_id: kitId, pasta });

export function useOrganizacaoDeProdutos(clientId: string, fotos: FotoDoAcervo[]) {
  const kits = useKits(clientId);
  const modelos = useQuery({
    queryKey: ["mesa-foto", "pessoas-organizacao", clientId], enabled: !!clientId, staleTime: 30_000,
    queryFn: async (): Promise<PessoaDaPasta[]> => {
      const { data, error } = await (supabase as any).from("foto_modelos").select("id,client_id,nome,origem,identidade_real")
        .or(`client_id.is.null,client_id.eq.${clientId}`).order("id").limit(1000);
      if (error) throw new Error("Não foi possível ler os nomes dos modelos e clones.");
      return (data || []).map((p: any) => ({ id: p.id, client_id: p.client_id, nome: p.nome,
        tipo: p.origem === "clone_de_foto_real" ? "clone" : "modelo", identidade_real: Array.isArray(p.identidade_real) ? p.identidade_real : [] }));
    },
  });
  const ids = fotos.filter((f) => f.client_id === clientId && f.modo === "canvas").map((f) => f.id).sort();
  const vinculos = useQuery({
    queryKey: ["mesa-foto", "vinculos-produtos", clientId, ids], enabled: !!clientId && ids.length > 0, staleTime: 60_000,
    queryFn: async (): Promise<VinculoDaGeracao[]> => {
      const saida: VinculoDaGeracao[] = [];
      for (let i = 0; i < ids.length; i += 100) {
        // Só IDs/referências; nunca baixa o prompt ou consulta Canvas de outro cliente.
        const { data, error } = await (supabase as any).from("foto_canvas_geracoes")
          .select("imagem_id,referencias:montado->referencias").eq("client_id", clientId).in("imagem_id", ids.slice(i, i + 100));
        if (error) throw new Error("Não foi possível ler os vínculos das gerações.");
        for (const r of data || []) saida.push({ imagem_id: r.imagem_id, referencias: Array.isArray(r.referencias) ? r.referencias : [] });
      }
      return saida;
    },
  });
  const pessoas = modelos.data || [];
  const organizadas = useMemo(() => organizarFotosPorProduto(clientId, fotos, kits.data || [], pessoas, vinculos.data || []), [clientId, fotos, kits.data, pessoas, vinculos.data]);
  return { kits, organizadas, pessoas, carregando: kits.isLoading || modelos.isLoading || (ids.length > 0 && vinculos.isLoading),
    erro: kits.error || modelos.error || vinculos.error,
    recarregar: () => Promise.all([kits.refetch(), modelos.refetch(), ...(ids.length ? [vinculos.refetch()] : [])]) };
}
