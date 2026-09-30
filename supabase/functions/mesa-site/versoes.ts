/**
 * Versões do site no banco (frente SIT2): grava a fotografia antes de cada
 * mudança e lê a lista para comparar e voltar. As regras puras estão em
 * ../_shared/site-versoes.ts. O banco chega por parâmetro (service_role).
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { assinaturaDaVersao, dadosDaVersao } from "../_shared/site-versoes.ts";

const semTabela = (e: { code?: string; message?: string } | null | undefined) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /site_versoes.*(does not exist|schema cache)/i.test(String(e.message || "")));

/**
 * Guarda a versão ATUAL do site (antes da mudança). Igual à última: não grava.
 * Devolve o erro para quem chamou mostrar (nunca engolido).
 */
export async function guardarVersao(db: SupabaseClient, site: Record<string, unknown> & { id: string; client_id: string }, motivo: string, userId: string | null): Promise<{ gravada: boolean; erro: string | null }> {
  const dados = dadosDaVersao(site);
  const assinatura = assinaturaDaVersao(dados);
  const { data: ultima, error: e1 } = await db.from("site_versoes").select("assinatura").eq("site_id", site.id).order("criado_em", { ascending: false }).limit(1);
  if (e1) return { gravada: false, erro: semTabela(e1) ? "O banco ainda não tem as versões do site (migration 20260930160000 pendente)." : "A versão anterior não foi lida." };
  if (((ultima as Array<{ assinatura: string }> | null) ?? [])[0]?.assinatura === assinatura) return { gravada: false, erro: null };
  const { error } = await db.from("site_versoes").insert({ site_id: site.id, client_id: site.client_id, motivo: motivo.slice(0, 120) || "mudança", assinatura, dados, criado_por: userId });
  if (error) return { gravada: false, erro: "A versão anterior não foi guardada." };
  return { gravada: true, erro: null };
}

export async function listarVersoes(db: SupabaseClient, siteId: string, limite = 30) {
  const { data, error } = await db.from("site_versoes").select("id, motivo, assinatura, criado_por, criado_em").eq("site_id", siteId).order("criado_em", { ascending: false }).limit(limite);
  if (error) return { versoes: [] as Array<Record<string, unknown>>, indisponivel: semTabela(error), erro: error };
  return { versoes: (data as Array<Record<string, unknown>>) ?? [], indisponivel: false, erro: null };
}

export async function lerVersao(db: SupabaseClient, siteId: string, versaoId: string): Promise<Record<string, unknown> | null> {
  const { data } = await db.from("site_versoes").select("id, motivo, criado_em, dados").eq("site_id", siteId).eq("id", versaoId).maybeSingle();
  return (data as Record<string, unknown> | null) ?? null;
}
