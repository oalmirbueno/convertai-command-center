import { Link } from "react-router-dom";
import { Users } from "lucide-react";
import { rotuloDoEstagio } from "@/lib/comercial";
import Termometro from "@/components/comercial/Termometro";
import type { Temperatura } from "@/components/comercial/temperatura";
import { foco, juntar, texto } from "@/components/sistema";
import { haQuanto } from "@/lib/adsResumo";
import type { LeadComOrigem } from "./leadsDosAnuncios";

/** Quantos leads a lista curta mostra antes do "ver no CRM". */
export const LEADS_NA_LISTA_CURTA = 5;

/** "3 leads no CRM" em ícone e número, para a linha da campanha e o cartão da peça. */
export function ContagemDeLeads({ total, className = "" }: { total: number; className?: string }) {
  if (total <= 0) return null;
  const frase = `${total} ${total === 1 ? "lead" : "leads"} no CRM`;
  return (
    <span role="img" aria-label={frase} title={frase} data-leads-no-crm={total} className={juntar("inline-flex shrink-0 items-center text-[12px] font-medium tabular-nums text-primary", className)}>
      <Users className="mr-0.5 h-3.5 w-3.5" aria-hidden="true" />
      {total}
    </span>
  );
}

/**
 * Lista curta dos leads que um anúncio ou campanha trouxe: temperatura (a do
 * CRM, com o porquê no title), nome, etapa e quando chegou. Sem caixa; o
 * resto fica a um toque, no CRM.
 */
export default function LeadsDoAnuncio({
  leads,
  temperaturas,
  max = LEADS_NA_LISTA_CURTA,
  className = "",
}: {
  leads: LeadComOrigem[];
  temperaturas: Map<string, Temperatura>;
  max?: number;
  className?: string;
}) {
  if (leads.length === 0) return null;
  const mostrados = leads.slice(0, max);
  return (
    <div className={juntar("min-w-0", className)} data-leads-do-anuncio="">
      <p className={juntar(texto.rotulo, "flex min-w-0 items-center")}>
        <Users className="mr-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate">{`${leads.length} ${leads.length === 1 ? "lead" : "leads"} no CRM`}</span>
      </p>
      <ul className="mt-1 min-w-0" aria-label="Leads no CRM">
        {mostrados.map((lead) => {
          const t = temperaturas.get(lead.id);
          return (
            <li key={lead.id} className="flex min-w-0 items-center py-1 text-[12px] leading-4">
              {t ? <Termometro temperatura={t} className="mr-1.5" /> : null}
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">{lead.name}</span>
              <span className={juntar(texto.auxiliar, "ml-2 shrink-0 truncate")}>{rotuloDoEstagio(lead.stage)}</span>
              <span className={juntar(texto.auxiliar, "ml-2 hidden shrink-0 tabular-nums sm:inline")}>{haQuanto(lead.created_at)}</span>
            </li>
          );
        })}
      </ul>
      {leads.length > mostrados.length && (
        <Link to="/comercial/crm" className={juntar("mt-0.5 inline-flex rounded text-[12px] text-primary hover:underline", foco)}>
          {`Ver os outros ${leads.length - mostrados.length} no CRM`}
        </Link>
      )}
    </div>
  );
}
