import { supabase } from "@/integrations/supabase/client";
import { ErroDeLeitura } from "@/lib/comercial";
import type { EventoDoLead } from "./temperatura";

/**
 * A história recente de todos os leads (commercial_lead_events), numa leitura
 * só, para o funil saber há quanto tempo cada lead está na etapa e quais
 * sinais esquentam ou esfriam a temperatura.
 *
 * Os mais novos primeiro, com teto: o evento que interessa é o último de
 * cada lead. Lead cujo último evento passou do teto cai na data de criação
 * (o resumo diz "cerca de"), nunca num número inventado.
 */
export const TETO_DE_EVENTOS = 1000;

export async function listarEventosDoFunil(): Promise<EventoDoLead[]> {
  const { data, error } = await supabase
    .from("commercial_lead_events")
    .select("lead_id, kind, from_stage, to_stage, note, created_at")
    .order("created_at", { ascending: false })
    .limit(TETO_DE_EVENTOS);
  if (error) throw new ErroDeLeitura("a história dos negócios", error);
  return (data || []) as unknown as EventoDoLead[];
}
