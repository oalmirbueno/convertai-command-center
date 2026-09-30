import { Ruler } from "lucide-react";
import { juntar } from "@/components/sistema/estilos";

/** O anexo que o diretor de site grava quando segue a base (mesmo tipo de _shared/uiux/citar.ts). */
export const TIPO_DO_ANEXO_BASE = "base_citada";

export function baseCitadaDosAnexos(anexos: unknown): Array<{ id: string; rotulo: string }> {
  if (!Array.isArray(anexos)) return [];
  const a = anexos.find((x) => x && typeof x === "object" && (x as { tipo?: unknown }).tipo === TIPO_DO_ANEXO_BASE) as Record<string, unknown> | undefined;
  const itens = a && Array.isArray(a.itens) ? (a.itens as Array<Record<string, unknown>>) : [];
  return itens.filter((i) => i && typeof i.rotulo === "string" && i.rotulo).map((i) => ({ id: String(i.id || ""), rotulo: String(i.rotulo) }));
}

/**
 * "Base: …" embaixo da resposta do diretor de site (frente UXM), ao lado do
 * "Segui: …": os itens da base UI UX Pro Max que mudaram a resposta. Uma
 * linha, sem caixa.
 */
export default function BaseCitada({ anexos }: { anexos: unknown[] | null | undefined }) {
  const itens = baseCitadaDosAnexos(anexos);
  if (!itens.length) return null;
  return (
    <p className={juntar("mt-1 flex min-w-0 items-start text-[12px] leading-snug text-muted-foreground")} data-base-citada={itens.length}>
      <Ruler className="mr-1.5 mt-0.5 h-3 w-3 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 whitespace-normal">
        <span className="font-medium text-foreground">Base:</span> {itens.map((i) => i.rotulo).join("; ")}
      </span>
    </p>
  );
}
