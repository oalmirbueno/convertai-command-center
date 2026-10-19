import { Thermometer } from "lucide-react";
import { juntar } from "@/components/sistema";
import { explicarTemperatura, type FaixaDeTemperatura, type Temperatura } from "./temperatura";

/** Frio azul, morno âmbar, quente vermelho (tokens do painel). */
export const COR_DA_FAIXA: Record<FaixaDeTemperatura, string> = {
  frio: "text-info",
  morno: "text-warning",
  quente: "text-destructive",
};

/**
 * O termômetro do lead: ícone colorido e o número, sem caixa. O "porquê"
 * (cada sinal com o peso) mora no title e no leitor de tela.
 */
export default function Termometro({ temperatura, className = "" }: { temperatura: Temperatura; className?: string }) {
  const porque = explicarTemperatura(temperatura);
  return (
    <span
      className={juntar("inline-flex shrink-0 items-center text-[11px] font-medium tabular-nums leading-4", COR_DA_FAIXA[temperatura.faixa], className)}
      title={porque}
      aria-label={`Temperatura: ${porque}`}
      role="img"
    >
      <Thermometer className="mr-0.5 h-3.5 w-3.5" aria-hidden="true" />
      {temperatura.valor}
    </span>
  );
}
