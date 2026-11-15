import { etiqueta, juntar } from "@/components/sistema/estilos";
import { ROTULO_DO_STATUS } from "../../../supabase/functions/_shared/proposta-modelo";
import type { Proposta } from "./propostaApi";

/**
 * Selo do status da proposta (rascunho, enviada, vista, aceita, recusada,
 * expirada). Mora sozinho (frente UXS, 30/09): o Envio usa sem baixar o
 * Contexto inteiro junto.
 */

const TOM: Record<string, string> = {
  rascunho: "bg-muted text-muted-foreground",
  enviada: "bg-accent-soft text-primary",
  vista: "bg-accent-soft text-primary",
  aceita: "bg-success-soft text-success",
  recusada: "bg-danger-soft text-destructive",
  expirada: "bg-warning/15 text-warning",
};

export default function SeloDaProposta({ status }: { status: Proposta["status_efetivo"] }) {
  return <span className={juntar(etiqueta, TOM[status] || TOM.rascunho)}>{ROTULO_DO_STATUS[status] || status}</span>;
}
