import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { botao, juntar, lista, texto } from "@/components/sistema/estilos";

const corDaNota = (n: number) => (n >= 7 ? "bg-primary text-primary-foreground" : n >= 4 ? "bg-secondary text-foreground" : "bg-muted text-muted-foreground");

/**
 * Uma linha do Hype ou do Trending (21/10/2026): a caixinha "juntar" (para a campanha), o título numa
 * linha, a linha de apoio, a nota (Jev) e as ações só com ícone. Os detalhes abrem na própria linha.
 * Linha de lista do sistema (sem caixa por item).
 */
export default function LinhaDoHypeETrending({
  titulo,
  apoio,
  nota,
  rotuloDaNota = "Quanto serve a este cliente, de 0 a 10 (Jev)",
  marcado,
  podeMarcar,
  onMarcar,
  detalhes,
  acoes,
  destaque = false,
}: {
  titulo: string;
  apoio?: ReactNode;
  nota?: number | null;
  rotuloDaNota?: string;
  marcado: boolean;
  podeMarcar: boolean;
  onMarcar: () => void;
  detalhes?: ReactNode;
  acoes?: ReactNode;
  destaque?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const n = typeof nota === "number" && isFinite(nota) ? Math.round(nota * 10) / 10 : null;
  return (
    <li className={juntar(lista.linha, "items-start", destaque || marcado ? lista.destaque : "")} data-juntado={marcado ? "" : undefined}>
      <label className="mr-2.5 mt-0.5 flex shrink-0 cursor-pointer items-center" title={podeMarcar || marcado ? "Juntar para criar uma campanha" : "Já tem 6 desta área na seleção"}>
        <Checkbox className="toque-compacto" checked={marcado} disabled={!podeMarcar && !marcado} onCheckedChange={onMarcar} aria-label={`Juntar ${titulo}`} />
      </label>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-start">
          <p className={juntar(texto.corpo, "min-w-0 flex-1 truncate font-medium")} title={titulo}>{titulo}</p>
          {n !== null && (
            <span className={juntar(texto.etiqueta, "ml-2 shrink-0 rounded-full px-2 tabular-nums", corDaNota(n))} title={rotuloDaNota}>
              {n.toLocaleString("pt-BR")}
            </span>
          )}
        </div>
        {apoio && <div className={juntar(texto.auxiliar, "mt-0.5 min-w-0 [overflow-wrap:anywhere]")}>{apoio}</div>}
        {aberto && detalhes && <div className="mt-2 min-w-0 space-y-1.5 text-[12px] leading-5 [overflow-wrap:anywhere]">{detalhes}</div>}
      </div>
      <div className="-my-0.5 ml-2 flex shrink-0 flex-wrap items-center justify-end">
        {acoes}
        {detalhes && (
          <button type="button" className={botao.icone} onClick={() => setAberto((v) => !v)} aria-expanded={aberto} aria-label={aberto ? "Menos" : "Como usar"} title={aberto ? "Menos" : "Como usar"}>
            <ChevronDown className={juntar("h-4 w-4 transition-transform", aberto ? "rotate-180" : "")} aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  );
}

/** Um par rótulo/texto dentro dos detalhes. */
export function Detalhe({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-medium text-muted-foreground">{rotulo}</p>
      <div className="text-foreground">{children}</div>
    </div>
  );
}
