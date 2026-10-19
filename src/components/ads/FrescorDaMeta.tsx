import { AlertTriangle, Clock } from "lucide-react";
import { juntar } from "@/components/sistema";
import { frescorDaMeta } from "./leadsDosAnuncios";

/**
 * Indicador discreto de quando os dados da Meta foram lidos (19/10/2026):
 * relógio e "há 2 h", sem caixa. Passou de 24 h, vira aviso âmbar com o
 * texto sempre à vista. A frase inteira mora no title e no leitor de tela.
 * No celular, sem aviso, fica só o relógio.
 */
export default function FrescorDaMeta({ ultima, agora, className = "" }: { ultima: string | null | undefined; agora?: Date; className?: string }) {
  const f = frescorDaMeta(ultima, agora);
  if (!f.curto) return null;
  const Icone = f.velho ? AlertTriangle : Clock;
  return (
    <span
      role="status"
      aria-label={f.frase}
      title={f.frase}
      data-frescor={f.velho ? "velho" : "ok"}
      className={juntar(
        "inline-flex min-w-0 shrink-0 items-center text-[12px] tabular-nums leading-4",
        f.velho ? "font-medium text-warning" : "text-muted-foreground",
        className,
      )}
    >
      <Icone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className={juntar("ml-1 truncate", f.velho ? "" : "hidden sm:inline")}>{f.curto}</span>
    </span>
  );
}
