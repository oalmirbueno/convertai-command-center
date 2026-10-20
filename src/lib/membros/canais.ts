import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TesteCliente } from "./modelo";
const banco = supabase as unknown as SupabaseClient;
export type CanalComunidade = {
  id: string;
  produto_id: string;
  nome: string;
  tipo: "whatsapp" | "telegram" | "outro";
  url: string;
  ativo: boolean;
  ordem: number;
};
export async function carregarCanais(
  produto: string,
  teste?: TesteCliente,
  previa?: string,
): Promise<CanalComunidade[]> {
  const r = await banco.rpc("membros_comunidade_canais", {
    _produto: produto,
    _teste: !!teste,
    _bloqueado: !!teste?.bloqueado,
    _previa: previa || null,
  });
  if (r.error) throw r.error;
  return r.data || [];
}
export async function salvarCanal(canal: CanalComunidade) {
  const r = await banco.rpc("membros_comunidade_canal_salvar", {
    _dados: canal,
  });
  if (r.error) throw r.error;
}
