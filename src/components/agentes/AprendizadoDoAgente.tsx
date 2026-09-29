import { useEffect, useState } from "react";
import { BookmarkPlus, Check, GraduationCap, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { textoDoErro } from "@/lib/mesa/api";

/**
 * "Aprendi: …" e "Segui: …" embaixo da resposta do agente (frente AG2,
 * 29/09/2026). Espelha supabase/functions/_shared/aprendizado-das-mesas.ts:
 * - `aprendizado_do_agente` com id: a regra foi guardada (ou reforçada) no
 *   cérebro do cliente; "Esquecer" tira.
 * - `aprendizado_do_agente` sem id (incerto): o agente não sabe se vale para
 *   sempre; "Guardar como regra" grava.
 * - `regras_seguidas`: as regras ensinadas que mudaram esta resposta.
 * Uma linha cada, sem caixa. Não depende da mesa: quem usa passa as chamadas.
 */

export const TIPO_DO_ANEXO_APRENDI = "aprendizado_do_agente";
export const TIPO_DO_ANEXO_SEGUI = "regras_seguidas";

export interface Aprendido {
  tipo: typeof TIPO_DO_ANEXO_APRENDI;
  id: string | null;
  texto: string;
  categoria: "evitar" | "preferencia";
  decisao: "preferencia_duradoura" | "so_desta_vez" | "incerto";
  situacao: "criado" | "reforcado" | "substituiu" | null;
  reforcos: number | null;
  esquecido_em?: string | null;
}

export interface RegrasSeguidas {
  tipo: typeof TIPO_DO_ANEXO_SEGUI;
  regras: Array<{ id: string; tipo: "evitar" | "preferencia"; texto: string }>;
}

export function aprendidoDosAnexos(anexos: unknown): Aprendido | null {
  if (!Array.isArray(anexos)) return null;
  const a = anexos.find((x) => x && typeof x === "object" && (x as { tipo?: unknown }).tipo === TIPO_DO_ANEXO_APRENDI) as Record<string, unknown> | undefined;
  if (!a || typeof a.texto !== "string" || !a.texto.trim()) return null;
  return {
    tipo: TIPO_DO_ANEXO_APRENDI,
    id: typeof a.id === "string" && a.id ? a.id : null,
    texto: a.texto,
    categoria: a.categoria === "evitar" ? "evitar" : "preferencia",
    decisao: a.decisao === "incerto" ? "incerto" : a.decisao === "so_desta_vez" ? "so_desta_vez" : "preferencia_duradoura",
    situacao: a.situacao === "reforcado" || a.situacao === "substituiu" || a.situacao === "criado" ? a.situacao : null,
    reforcos: typeof a.reforcos === "number" ? a.reforcos : null,
    esquecido_em: typeof a.esquecido_em === "string" ? a.esquecido_em : null,
  };
}

export function regrasSeguidasDosAnexos(anexos: unknown): RegrasSeguidas | null {
  if (!Array.isArray(anexos)) return null;
  const a = anexos.find((x) => x && typeof x === "object" && (x as { tipo?: unknown }).tipo === TIPO_DO_ANEXO_SEGUI) as Record<string, unknown> | undefined;
  const lista = a && Array.isArray(a.regras) ? (a.regras as Array<Record<string, unknown>>) : [];
  const regras = lista
    .filter((r) => r && typeof r.texto === "string" && r.texto)
    .map((r) => ({ id: String(r.id || ""), tipo: r.tipo === "evitar" ? ("evitar" as const) : ("preferencia" as const), texto: String(r.texto) }));
  return regras.length ? { tipo: TIPO_DO_ANEXO_SEGUI, regras } : null;
}

export default function AprendizadoDoAgente({
  anexos,
  onEsquecer,
  onGuardar,
}: {
  anexos: unknown[] | null | undefined;
  /** Tira a regra do cérebro (aprendizado_esquecer da função do agente). */
  onEsquecer?: (id: string) => Promise<unknown>;
  /** Guarda o incerto como regra (aprendizado_guardar); devolve o aprendido gravado. */
  onGuardar?: (texto: string, tipo: "evitar" | "preferencia") => Promise<{ aprendido?: unknown } | unknown>;
}) {
  const inicial = aprendidoDosAnexos(anexos);
  const seguidas = regrasSeguidasDosAnexos(anexos);
  const [aprendido, setAprendido] = useState<Aprendido | null>(inicial);
  const [ocupado, setOcupado] = useState<"esquecer" | "guardar" | null>(null);
  const chave = inicial ? `${inicial.id || ""}|${inicial.texto}|${inicial.esquecido_em || ""}` : "";
  useEffect(() => {
    setAprendido(aprendidoDosAnexos(anexos));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  if (!aprendido && !seguidas) return null;

  const esquecer = async () => {
    if (!aprendido || !aprendido.id || !onEsquecer || ocupado) return;
    setOcupado("esquecer");
    try {
      await onEsquecer(aprendido.id);
      setAprendido({ ...aprendido, esquecido_em: new Date().toISOString() });
      toast.success("Esquecido", { description: "O agente não segue mais esta regra." });
    } catch (e) {
      toast.error("Não foi possível esquecer", { description: textoDoErro(e), duration: 9000 });
    } finally {
      setOcupado(null);
    }
  };

  const guardar = async () => {
    if (!aprendido || aprendido.id || !onGuardar || ocupado) return;
    setOcupado("guardar");
    try {
      const r = (await onGuardar(aprendido.texto, aprendido.categoria)) as { aprendido?: unknown } | null;
      const novo = r && r.aprendido ? aprendidoDosAnexos([r.aprendido]) : null;
      setAprendido(novo || { ...aprendido, decisao: "preferencia_duradoura" });
      toast.success("Guardado como regra", { description: aprendido.texto });
    } catch (e) {
      toast.error("Não foi possível guardar", { description: textoDoErro(e), duration: 9000 });
    } finally {
      setOcupado(null);
    }
  };

  return (
    <div className="mt-1.5 min-w-0 space-y-1 text-[12px] leading-snug" data-aprendizado-do-agente="">
      {seguidas && (
        <p className="flex min-w-0 items-start text-muted-foreground" data-regras-seguidas={seguidas.regras.length}>
          <Check className="mr-1.5 mt-0.5 h-3 w-3 shrink-0 text-success" aria-hidden />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            <span className="font-medium text-foreground">Segui:</span> {seguidas.regras.map((r) => r.texto).join("; ")}
          </span>
        </p>
      )}
      {aprendido && (
        <p className="flex min-w-0 items-start text-muted-foreground" data-aprendi={aprendido.esquecido_em ? "esquecido" : aprendido.id ? "guardado" : "incerto"}>
          <GraduationCap className="mr-1.5 mt-0.5 h-3 w-3 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            <span className="font-medium text-foreground">{aprendido.id ? "Aprendi:" : "Guardar como regra?"}</span>{" "}
            <span className={aprendido.esquecido_em ? "line-through" : undefined}>{aprendido.texto}</span>
            {aprendido.situacao === "reforcado" && !aprendido.esquecido_em && <span> (já sabia; reforcei{aprendido.reforcos ? `, ${aprendido.reforcos} vezes` : ""})</span>}
            {aprendido.esquecido_em && <span> (esquecido)</span>}
          </span>
          {aprendido.id && !aprendido.esquecido_em && onEsquecer && (
            <button type="button" onClick={() => void esquecer()} disabled={!!ocupado} className="ml-2 inline-flex shrink-0 items-center text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" data-esquecer="">
              {ocupado === "esquecer" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <X className="mr-1 h-3 w-3" />}
              Esquecer
            </button>
          )}
          {!aprendido.id && onGuardar && (
            <button type="button" onClick={() => void guardar()} disabled={!!ocupado} className="ml-2 inline-flex shrink-0 items-center text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" data-guardar-regra="">
              {ocupado === "guardar" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <BookmarkPlus className="mr-1 h-3 w-3" />}
              Guardar
            </button>
          )}
        </p>
      )}
    </div>
  );
}
