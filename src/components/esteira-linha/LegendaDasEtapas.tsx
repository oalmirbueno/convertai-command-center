import { juntar, texto } from "@/components/sistema";
import { ETAPAS_DA_ESTEIRA } from "@/lib/esteiraLinha/esteiraLinha";
import { ESTILO_DA_ETAPA } from "./estilosDaEtapa";

/** Legenda do rodapé: as etapas na ordem do caminho da peça e as marcas do dia prioritário. */
export default function LegendaDasEtapas() {
  return (
    <footer aria-label="Legenda das etapas" className="border-t border-border pt-3">
      <ul className="flex flex-wrap gap-x-5 gap-y-2">
        {ETAPAS_DA_ESTEIRA.map((e) => (
          <li key={e.etapa} className={juntar(texto.auxiliar, "flex items-center")}>
            <span className={juntar("mr-1.5 h-2 w-2 rounded-full", ESTILO_DA_ETAPA[e.etapa].ponto)} aria-hidden="true" />
            <span className="font-medium text-foreground">{e.rotulo}</span>
            <span className="ml-1">{e.descricao}</span>
          </li>
        ))}
        <li className={juntar(texto.auxiliar, "flex items-center")}>
          <span className="mr-1.5 h-3 w-3 rounded-sm border border-border bg-accent" aria-hidden="true" />
          <span className="font-medium text-foreground">Dia prioritário</span>
        </li>
        <li className={juntar(texto.auxiliar, "flex items-center")}>
          <span className="mr-1.5 h-3 w-3 rounded-sm border border-amber-500/50 bg-amber-500/15" aria-hidden="true" />
          <span className="font-medium text-foreground">Dia prioritário sem peça</span>
        </li>
      </ul>
    </footer>
  );
}
