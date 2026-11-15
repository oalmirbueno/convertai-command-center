import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useGeracoesEmAndamento } from "@/lib/mesa/filaDeGeracao";

/**
 * "Gerando em N clientes" (frente G, 26/09): discreto no cabeçalho, só
 * aparece com geração na fila do servidor. O clique abre a lista com o link
 * de cada cliente. O mesmo gancho é a vigia que retoma a fila de quem está
 * logado se a corrente do servidor parar (src/lib/mesa/filaDeGeracao.ts).
 */
export default function IndicadorDeGeracoes({ userId }: { userId: string | null | undefined }) {
  const { clientes } = useGeracoesEmAndamento(true, userId);
  if (!clientes.length) return null;
  const n = clientes.length;
  const rotulo = n === 1 ? "Gerando em 1 cliente" : `Gerando em ${n} clientes`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-accent-soft px-3.5 text-[12px] font-medium text-primary transition-colors hover:text-foreground"
          title={rotulo}
          aria-label={rotulo}
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span className="hidden sm:inline">{rotulo}</span>
          <span className="sm:hidden">{n}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <p className="px-2 pb-1 pt-1.5 text-[12px] text-muted-foreground">A geração segue no servidor, mesmo com a tela fechada.</p>
        <ul>
          {clientes.map((c) => (
            <li key={c.client_id}>
              <Link to={c.link} className="flex min-w-0 items-center justify-between gap-2 rounded-md px-3 py-2.5 text-[13px] font-medium transition-colors hover:bg-muted">
                <span className="min-w-0 truncate">{c.nome}</span>
                <span className="shrink-0 text-[12px] text-muted-foreground">
                  {c.laminas} {c.laminas === 1 ? "lâmina" : "lâminas"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
