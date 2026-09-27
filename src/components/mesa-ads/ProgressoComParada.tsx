import { Square } from "lucide-react";
import { usd } from "@/lib/mesa/api";
import { botao, juntar } from "@/components/sistema/estilos";

/**
 * Andamento de um lote que a pessoa acompanha e pode parar (frente CR, pedido
 * do dono em 27/09: "acompanhamento meu humano observando as ações de forma
 * clara e poder parar"). Mostra quantos de quantos, o que está saindo agora e
 * o custo até aqui. Parar vale para o próximo item: o que está em andamento
 * termina e fica; o resto não é gerado nem cobrado.
 */
export default function ProgressoComParada({
  rotulo,
  unidade,
  feitas,
  total,
  atual,
  custo,
  parando,
  onParar,
  className = "",
}: {
  rotulo: string;
  /** "ângulos", "lâminas". */
  unidade: string;
  feitas: number;
  total: number;
  atual?: string;
  custo?: number;
  parando: boolean;
  onParar: () => void;
  className?: string;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((feitas / total) * 100)) : 0;
  return (
    <div className={juntar("min-w-0", className)} role="status" aria-label={`${rotulo}: ${feitas} de ${total} ${unidade}`} data-progresso-do-lote="">
      <div className="flex min-w-0 items-center">
        <p className="mr-2 min-w-0 flex-1 truncate text-[12.5px]">
          <span className="font-medium">{rotulo}</span>
          <span className="tabular-nums text-muted-foreground">{` ${feitas} de ${total} ${unidade}`}</span>
          {atual ? <span className="text-muted-foreground">{` · ${atual}`}</span> : null}
          {custo && custo > 0 ? <span className="tabular-nums text-muted-foreground">{` · ${usd(custo)} até agora`}</span> : null}
        </p>
        <button type="button" onClick={onParar} disabled={parando} className={juntar(botao.secundario, "h-8 px-2.5 text-[12px]")} aria-label={parando ? "Parando o lote" : "Parar o lote"}>
          <Square className="mr-1 h-3 w-3" /> {parando ? "Parando" : "Parar"}
        </button>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      {parando && <p className="mt-1 text-[11.5px] text-muted-foreground">O que já está saindo termina e fica; o resto não é gerado nem cobrado.</p>}
    </div>
  );
}
