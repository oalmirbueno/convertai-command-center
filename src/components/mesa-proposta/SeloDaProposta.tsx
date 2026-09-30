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
  enviada: "bg-primary/10 text-primary",
  vista: "bg-primary/10 text-primary",
  aceita: "bg-success/15 text-success",
  recusada: "bg-destructive/10 text-destructive",
  expirada: "bg-warning/15 text-warning",
};

export default function SeloDaProposta({ status }: { status: Proposta["status_efetivo"] }) {
  return <span className={juntar(etiqueta, TOM[status] || TOM.rascunho)}>{ROTULO_DO_STATUS[status] || status}</span>;
}
