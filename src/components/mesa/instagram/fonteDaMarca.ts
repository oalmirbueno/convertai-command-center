import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMarcaDaMesa } from "../MesaContexto";
import { carregarFonteDaMarca } from "./capaDoDestaque";

/**
 * A fonte de título da marca aberta, para as capas tipográficas (trava da
 * marca: nunca outra fonte). Principal: as do cliente e as dela; outra marca:
 * as dela e, sem nenhuma, as do cliente. Sem fonte guardada, o estilo
 * tipográfico fica desligado com o motivo.
 */

type Fonte = { id: string; nome: string; papel: string | null; storage_path: string | null; marca_id?: string | null };

export function escolherFonteDaMarca(fontes: Fonte[], marca: { id: string; principal: boolean } | null): Fonte | null {
  const comArquivo = fontes.filter((f) => !!f.storage_path);
  let validas = comArquivo;
  if (marca) {
    const dela = comArquivo.filter((f) => f.marca_id === marca.id);
    validas = marca.principal ? comArquivo.filter((f) => !f.marca_id || f.marca_id === marca.id) : dela.length ? dela : comArquivo.filter((f) => !f.marca_id);
  }
  return validas.find((f) => /titul|destaque|display/i.test(String(f.papel || ""))) || validas[0] || null;
}

export function useFonteDaMarca(clientId: string) {
  const { marca } = useMarcaDaMesa();
  const fontes = useQuery({
    queryKey: ["mesa", "instagram-fontes", clientId],
    enabled: !!clientId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Fonte[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      let r = await db.from("cliente_fontes").select("id, nome, papel, storage_path, marca_id").eq("client_id", clientId);
      if (r.error) r = await db.from("cliente_fontes").select("id, nome, papel, storage_path").eq("client_id", clientId);
      if (r.error) throw r.error;
      return (r.data || []) as Fonte[];
    },
  });
  const fonte = fontes.data ? escolherFonteDaMarca(fontes.data, marca ? { id: marca.id, principal: marca.principal } : null) : null;
  const familia = useQuery({
    queryKey: ["mesa", "instagram-fonte-carregada", fonte ? fonte.storage_path : null],
    enabled: !!fonte && !!fonte.storage_path,
    staleTime: Infinity,
    retry: false,
    queryFn: () => carregarFonteDaMarca(String(fonte && fonte.storage_path)),
  });
  return {
    nome: fonte ? fonte.nome : null,
    familia: familia.data || null,
    carregando: fontes.isLoading || familia.isLoading,
    motivo: fontes.data && !fonte ? "A marca não tem fonte guardada no Contexto: a capa tipográfica fica desligada (nunca outra fonte)." : familia.isError ? "Não deu para carregar a fonte da marca neste navegador." : null,
  };
}
