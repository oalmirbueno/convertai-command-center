import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Atividade } from "@/lib/comercial";
import { temperaturaDoLead, type EventoDoLead, type Temperatura } from "@/components/comercial/temperatura";
import { lerOrigemDoClique } from "../../../supabase/functions/_shared/origem-clique";
import type { LeadComOrigem } from "./leadsDosAnuncios";

/**
 * Os leads do CRM que chegaram com origem de clique (commercial_leads.
 * origem_clique), com a temperatura que o CRM já calcula (temperatura.ts,
 * com as atividades e a história de cada um).
 *
 * Só admin e manager leem o CRM (RLS de commercial_leads): para o resto da
 * equipe a lista volta vazia e a tela não mostra a parte dos leads. Banco
 * sem a coluna ainda (migration 20261020040000 pendente) também volta vazio,
 * nunca erro na tela de anúncios.
 */

/** Teto de leads lidos: o in() das atividades e da história vai no endereço. */
export const TETO_DE_LEADS_COM_ORIGEM = 200;

export interface LeadsDosAnuncios {
  leads: LeadComOrigem[];
  temperaturas: Map<string, Temperatura>;
}

const VAZIO: LeadsDosAnuncios = { leads: [], temperaturas: new Map() };

const qualificacaoEmTexto = (v: unknown): Record<string, string> => {
  const saida: Record<string, string> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return saida;
  for (const [k, t] of Object.entries(v as Record<string, unknown>)) if (typeof t === "string" && t.trim()) saida[k] = t.trim();
  return saida;
};

export async function lerLeadsDosAnuncios(agoraIso: string = new Date().toISOString()): Promise<LeadsDosAnuncios> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- origem_clique e as tabelas de ads fora dos tipos gerados
  const db = supabase as any;
  const { data, error } = await db
    .from("commercial_leads")
    .select("*")
    .not("origem_clique", "is", null)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(TETO_DE_LEADS_COM_ORIGEM);
  // 42703: coluna ainda não existe (migration pendente). Sem acesso: lista vazia pela RLS.
  if (error) {
    if (String(error.code) === "42703" || String(error.code) === "PGRST204") return VAZIO;
    throw error;
  }
  const leads: LeadComOrigem[] = ((data || []) as Array<Record<string, unknown>>)
    .map((linha) => ({
      ...(linha as unknown as LeadComOrigem),
      monthly_value: Number(linha.monthly_value) || 0,
      one_off_value: Number(linha.one_off_value) || 0,
      qualificacao: qualificacaoEmTexto(linha.qualificacao),
      origem_clique: lerOrigemDoClique(linha.origem_clique),
    }))
    .filter((l) => !!l.origem_clique);
  if (leads.length === 0) return VAZIO;
  const ids = leads.map((l) => l.id);
  const [atv, evt] = await Promise.all([
    db.from("commercial_activities").select("id, lead_id, kind, title, due_at, done_at, owner_id, notes").in("lead_id", ids).limit(1000),
    db.from("commercial_lead_events").select("lead_id, kind, from_stage, to_stage, note, created_at").in("lead_id", ids).order("created_at", { ascending: false }).limit(1000),
  ]);
  // Sem atividades ou história, a temperatura sai só da etapa, da origem e do tempo parado.
  const atividades = (atv.error ? [] : atv.data || []) as Atividade[];
  const eventos = (evt.error ? [] : evt.data || []) as EventoDoLead[];
  const temperaturas = new Map<string, Temperatura>();
  for (const lead of leads) temperaturas.set(lead.id, temperaturaDoLead(lead, atividades, eventos, agoraIso));
  return { leads, temperaturas };
}

export function useLeadsDosAnuncios(ligado = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["ads-leads-do-crm", user?.id],
    queryFn: () => lerLeadsDosAnuncios(),
    enabled: !!user && ligado,
    staleTime: 60_000,
  });
}
