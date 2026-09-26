import { AlertTriangle, Database, Info } from "lucide-react";
import { ROTULO_DO_STATUS, type AvisoDoJev, type StatusDoRoteiro } from "../../../supabase/functions/_shared/roteiro-modelo";

/** Peças pequenas repetidas nas etapas da Mesa Roteiros. */

export const CAMPO =
  "w-full min-w-0 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12.5px] text-foreground outline-none focus:border-primary/60 disabled:opacity-60";

export const OBJETIVOS = [
  { valor: "ensinar", rotulo: "Ensinar" },
  { valor: "engajar", rotulo: "Engajar" },
  { valor: "apresentar", rotulo: "Apresentar" },
  { valor: "captar", rotulo: "Captar contatos" },
  { valor: "vender", rotulo: "Vender" },
];

const TOM_DO_STATUS: Record<StatusDoRoteiro, string> = {
  rascunho: "border-border bg-muted text-muted-foreground",
  aprovado: "border-primary/40 bg-primary/10 text-primary",
  gravado: "border-foreground/20 bg-foreground/5 text-foreground",
};

export function SeloDoStatus({ status }: { status: StatusDoRoteiro }) {
  return (
    <span className={`inline-flex h-6 shrink-0 items-center rounded-full border px-2 text-[11px] font-medium ${TOM_DO_STATUS[status] || TOM_DO_STATUS.rascunho}`} data-status-do-roteiro={status}>
      {ROTULO_DO_STATUS[status] || status}
    </span>
  );
}

export function AvisoDoBanco() {
  return (
    <div className="flex items-start rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[12.5px]" role="status" data-aviso-banco="">
      <Database className="mr-2 mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <p className="min-w-0 [overflow-wrap:anywhere]">
        O banco ainda não guarda roteiros (falta aplicar o SQL da Mesa Roteiros). Dá para gerar e baixar o PDF, mas o roteiro não fica salvo.
      </p>
    </div>
  );
}

/** O aviso do Jev: retenção, clareza e promessa contra oferta. Só aviso, nunca bloqueio. */
export function AvisoDoJevCartao({ aviso }: { aviso: AvisoDoJev | null | undefined }) {
  if (!aviso) return null;
  const nota = (n: number | null) => (n == null ? "sem nota" : `${n.toFixed(1).replace(".", ",")} de 5`);
  const prob = aviso.promessa_cumprida;
  return (
    <div className={`rounded-xl border p-3 ${aviso.frases.length ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-muted/40"}`} data-aviso-jev="">
      <p className="flex items-center text-[12px] font-medium">
        {aviso.frases.length ? <AlertTriangle className="mr-1.5 h-3.5 w-3.5 text-amber-600" /> : <Info className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />}
        Conferência editorial (aviso, não bloqueia)
      </p>
      <p className="mt-1 text-[11.5px] text-muted-foreground">
        Retenção {nota(aviso.retencao)} · Clareza {nota(aviso.clareza)} · Promessa cumprida {prob == null ? "sem leitura" : prob >= 0.5 ? "sim" : "duvidosa"}
      </p>
      {aviso.frases.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[12px]">
          {aviso.frases.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
