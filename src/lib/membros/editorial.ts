import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
const banco = supabase as unknown as SupabaseClient;
export type VersaoConteudo = {
  id: string;
  estado: "rascunho" | "revisao" | "aprovado" | "publicado";
  autor_nome: string;
  criado_em: string;
  dados: {
    titulo: string;
    texto: string;
    estado: string;
    arquivo?: string | null;
    tipo?: string;
  };
};
export async function lerVersoes(material: string): Promise<VersaoConteudo[]> {
  const r = await banco.rpc("membros_conteudo_versoes_ler", {
    _material: material,
  });
  if (r.error) throw r.error;
  return r.data || [];
}
export async function versionarConteudo(
  material: string,
  acao: string,
  dados?: object,
  versao?: string,
): Promise<string> {
  const r = await banco.rpc("membros_conteudo_versionar", {
    _material: material,
    _acao: acao,
    _dados: dados || null,
    _versao: versao || null,
  });
  if (r.error) throw r.error;
  return r.data;
}
export async function arquivoDaVersao(
  material: string,
  versao: string,
): Promise<string> {
  const r = await banco.functions.invoke("area-membros", {
    body: { acao: "arquivo_versao", material_id: material, versao_id: versao },
  });
  if (r.error) throw r.error;
  if (!r.data?.url) throw Error("Arquivo indisponível.");
  return r.data.url;
}
