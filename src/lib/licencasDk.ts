/**
 * Licenças da plataforma DK Sorteios (19/11/2026, interno, só admin): leitura dos lançamentos gravados pela
 * Edge Function licencas-dk-sync e o pedido de sincronizar agora. As contas moram no módulo puro compartilhado.
 */
import { supabase } from "@/integrations/supabase/client";
import type { LinhaGravada } from "../../supabase/functions/_shared/licencas-dk";

export { totaisPorMes, rotuloDaForma, type LinhaGravada, type Mes } from "../../supabase/functions/_shared/licencas-dk";

export interface PagamentoDeLicenca extends LinhaGravada {
  pago_em: string | null;
  referencia: string;
  descricao: string;
}

export interface EstadoDaSincronizacao {
  ultima_sincronizacao: string | null;
  ultimo_erro: string | null;
}

// A tabela é nova e ainda não está nos tipos gerados do Lovable.
const db = supabase as unknown as { from: (t: string) => any };

export async function lerLicencas(): Promise<PagamentoDeLicenca[]> {
  const { data, error } = await db
    .from("licencas_dk_pagamentos")
    .select("asaas_pagamento_id, forma, situacao, bruto, liquido, taxa, recebido_em, pago_em, referencia, descricao")
    .order("recebido_em", { ascending: false })
    .limit(2000);
  if (error) throw error;
  return ((data || []) as PagamentoDeLicenca[]).map((l) => ({ ...l, bruto: Number(l.bruto), liquido: Number(l.liquido), taxa: Number(l.taxa ?? Number(l.bruto) - Number(l.liquido)) }));
}

export async function lerEstado(): Promise<EstadoDaSincronizacao | null> {
  const { data, error } = await db.from("licencas_dk_ajuste").select("ultima_sincronizacao, ultimo_erro").eq("id", true).maybeSingle();
  if (error) throw error;
  return (data as EstadoDaSincronizacao | null) || null;
}

export async function sincronizarAgora(completo = false): Promise<{ gravados: number; licencas: number }> {
  const { data, error } = await supabase.functions.invoke("licencas-dk-sync", { body: { acao: "sincronizar", completo } });
  if (error) throw error;
  const d = (data || {}) as { gravados?: number; licencas?: number; error?: string; mensagem?: string };
  if (d.error) throw new Error(d.mensagem || d.error);
  return { gravados: Number(d.gravados || 0), licencas: Number(d.licencas || 0) };
}
