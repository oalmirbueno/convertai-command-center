import { juntar, texto } from "@/components/sistema";
import { ETAPAS_DA_ESTEIRA } from "@/lib/esteiraLinha/esteiraLinha";
import { ESTILO_DA_ETAPA } from "./estilosDaEtapa";

/**
 * Legenda das etapas, na ordem do caminho da peça, e as marcas do dia
 * prioritário. Desde a limpeza de 14/11/2026 (21h53) ela mora no "?" ao lado
 * do título da Esteira, não num rodapé comprido.
 */
export default function LegendaDasEtapas() {
  return (
    <ul aria-label="Legenda das etapas" className="mt-2 space-y-1.5" data-legenda-das-etapas="">
      {ETAPAS_DA_ESTEIRA.map((e) => (
        <li key={e.etapa} className={juntar(texto.auxiliar, "flex items-start")}>
          <span className={juntar("mr-2 mt-1.5 h-2 w-2 shrink-0 rounded-full", ESTILO_DA_ETAPA[e.etapa].ponto)} aria-hidden="true" />
          <span>
            <span className="font-medium text-foreground">{e.rotulo}</span>
            <span className="ml-1">{e.descricao}</span>
          </span>
        </li>
      ))}
      <li className={juntar(texto.auxiliar, "flex items-center")}>
        <span className="mr-2 h-3 w-3 shrink-0 rounded-sm border border-primary/30 bg-accent-soft" aria-hidden="true" />
        <span className="font-medium text-foreground">Dia prioritário</span>
      </li>
      <li className={juntar(texto.auxiliar, "flex items-center")}>
        <span className="mr-2 h-3 w-3 shrink-0 rounded-sm border border-warning/40 bg-warning-soft" aria-hidden="true" />
        <span className="font-medium text-foreground">Dia prioritário sem peça</span>
      </li>
    </ul>
  );
}
