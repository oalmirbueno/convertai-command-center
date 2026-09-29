import { supabase } from "@/integrations/supabase/client";

/**
 * "Esquecer" e "Guardar como regra" das regras que o dono ensina (frente AG3,
 * 29/09). A função do agente decide o escopo e confere o acesso: o painel só
 * manda o id (Esquecer) ou o texto (Guardar).
 *
 * `funcao` é a função do agente (voice-assistant-agent, agente-central,
 * workspace-agent, mesa-ads); o corpo segue o mesmo contrato nas quatro.
 */
export type FuncaoQueAprende = "voice-assistant-agent" | "agente-central" | "workspace-agent" | "mesa-ads";

async function chamar(funcao: FuncaoQueAprende, corpo: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke(funcao, { body: corpo });
  if (error) {
    let mensagem = "";
    try {
      const ctx = (error as { context?: { clone?: () => Response } }).context;
      const j = ctx && typeof ctx.clone === "function" ? await ctx.clone().json() : null;
      mensagem = j && typeof j.mensagem === "string" ? j.mensagem : "";
    } catch {
      mensagem = "";
    }
    throw new Error(mensagem || "Não foi possível agora. Tente de novo.");
  }
  const d = (data || {}) as Record<string, unknown>;
  if (typeof d.error === "string") throw new Error(typeof d.mensagem === "string" ? d.mensagem : "Não foi possível agora. Tente de novo.");
  return d;
}

export function esquecerRegraAprendida(funcao: FuncaoQueAprende, regraId: string, extra: Record<string, unknown> = {}) {
  return chamar(funcao, { acao: "esquecer_regra", action: "esquecer_regra", regra_id: regraId, ...extra });
}

export function guardarRegraAprendida(
  funcao: FuncaoQueAprende,
  regra: { texto: string; categoria: "evitar" | "preferencia"; escopo?: "cliente" | "dono" },
  extra: Record<string, unknown> = {},
) {
  return chamar(funcao, { acao: "guardar_regra", action: "guardar_regra", regra, ...extra });
}
