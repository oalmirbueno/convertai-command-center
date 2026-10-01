import { supabase } from "@/integrations/supabase/client";
import type { EstadoDoMotor, SituacaoDoMotor } from "../../../supabase/functions/motores-estado/modulos/estado";

/**
 * Estado dos motores na tela (frente MTR, 30/09/2026): chama a função
 * motores-estado (só leitura, sem custo) e traduz o erro para gente.
 * A tela mostra, por motor, se está ligado, o último sinal, a fila, o último
 * erro e o que falta (Configurações, linha "Estado dos motores").
 */

export type { EstadoDoMotor, SituacaoDoMotor };

export interface QuadroDosMotores {
  motores: EstadoDoMotor[];
  geral: { parados: number; atencao: number; texto: string };
  avisos: string[];
  conferido_em: string;
}

export const CHAVE_DO_ESTADO_DOS_MOTORES = ["config", "motores", "estado"] as const;

export const ROTULO_DA_SITUACAO: Record<SituacaoDoMotor, string> = {
  ok: "Ligado",
  atencao: "Atenção",
  parado: "Parado",
  sem_uso: "Sem uso",
};

/** Rótulo da linha: "Ligado" é de motor que roda; as chaves da IA ficam "Em dia". */
export const rotuloDaSituacao = (m: Pick<EstadoDoMotor, "id" | "situacao">) => (m.situacao === "ok" && m.id === "ia" ? "Em dia" : ROTULO_DA_SITUACAO[m.situacao]);

/** Cor do ponto e do rótulo (tokens do sistema). */
export const COR_DA_SITUACAO: Record<SituacaoDoMotor, { ponto: string; texto: string }> = {
  ok: { ponto: "bg-primary", texto: "text-primary" },
  atencao: { ponto: "bg-warning", texto: "text-warning" },
  parado: { ponto: "bg-destructive", texto: "text-destructive" },
  sem_uso: { ponto: "bg-muted-foreground", texto: "text-muted-foreground" },
};

/** Motores em ordem de urgência: parado, atenção, sem uso, ligado (a ordem da função desempata). */
export function ordenarPorUrgencia(motores: EstadoDoMotor[]): EstadoDoMotor[] {
  const peso: Record<SituacaoDoMotor, number> = { parado: 0, atencao: 1, sem_uso: 2, ok: 3 };
  return motores
    .map((m, i) => ({ m, i }))
    .sort((a, b) => peso[a.m.situacao] - peso[b.m.situacao] || a.i - b.i)
    .map((x) => x.m);
}

async function mensagemDoErro(error: unknown): Promise<string> {
  const ctx = (error as { context?: { status?: number; clone?: () => Response; json?: () => Promise<unknown> } } | null)?.context;
  try {
    const corpo = ctx && typeof ctx.clone === "function" ? await ctx.clone().json() : ctx && typeof ctx.json === "function" ? await ctx.json() : null;
    if (corpo && typeof corpo === "object" && typeof (corpo as { mensagem?: unknown }).mensagem === "string") return String((corpo as { mensagem: string }).mensagem);
  } catch {
    /* sem corpo legível */
  }
  if (ctx && ctx.status === 404) return "O estado dos motores ainda não foi publicado no servidor (função motores-estado).";
  return "Não foi possível ler o estado dos motores agora. Tente de novo.";
}

export async function lerEstadoDosMotores(): Promise<QuadroDosMotores> {
  const { data, error } = await supabase.functions.invoke("motores-estado", { body: {} });
  if (error) throw new Error(await mensagemDoErro(error));
  const d = (data || {}) as Partial<QuadroDosMotores> & { error?: string; mensagem?: string };
  if (typeof d.error === "string") throw new Error(d.mensagem || "Não foi possível ler o estado dos motores agora.");
  return {
    motores: Array.isArray(d.motores) ? d.motores : [],
    geral: d.geral || { parados: 0, atencao: 0, texto: "" },
    avisos: Array.isArray(d.avisos) ? d.avisos : [],
    conferido_em: typeof d.conferido_em === "string" ? d.conferido_em : new Date().toISOString(),
  };
}
