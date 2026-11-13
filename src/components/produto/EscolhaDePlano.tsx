import { Check, Minus, Plus } from "lucide-react";
import { reais, type PlanoDoProduto } from "@/lib/produto/api";
import { botao, foco, juntar, superficie, texto } from "@/components/sistema";

/**
 * Os planos lado a lado e o número de usuários. Usado ao abrir a empresa, na
 * Conta e na página de venda: o preço é sempre por usuário, por mês.
 */
export default function EscolhaDePlano({
  planos,
  plano,
  usuarios,
  minimoDeUsuarios = 1,
  onPlano,
  onUsuarios,
  atual,
}: {
  planos: PlanoDoProduto[];
  plano: string;
  usuarios: number;
  /** Lugares já ocupados na equipe: não dá para contratar menos que isso. */
  minimoDeUsuarios?: number;
  onPlano: (id: string) => void;
  onUsuarios: (n: number) => void;
  /** O plano que a empresa tem hoje, para marcar na lista. */
  atual?: string | null;
}) {
  const escolhido = planos.filter((p) => p.id === plano)[0] || null;
  const piso = Math.max(minimoDeUsuarios, escolhido ? escolhido.minimo_usuarios : 1);
  const mudar = (n: number) => onUsuarios(Math.max(piso, Math.min(500, n)));
  return (
    <div className="min-w-0" data-escolha-de-plano="">
      <div className={juntar("grid min-w-0 grid-cols-1 gap-3", planos.length > 1 && "sm:grid-cols-2")} role="radiogroup" aria-label="Plano">
        {planos.map((p) => {
          const marcado = p.id === plano;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={marcado}
              onClick={() => onPlano(p.id)}
              data-plano={p.id}
              className={juntar(superficie.painel, "flex min-w-0 flex-col items-stretch justify-start p-4 text-left transition-colors", foco, marcado ? "border-primary" : "hover:border-muted-foreground/40")}
            >
              <span className="flex min-w-0 items-center">
                <span className={juntar(texto.tituloSecao, "min-w-0 flex-1 truncate")}>{p.nome}</span>
                {atual === p.id && <span className="ml-2 shrink-0 rounded bg-muted px-1.5 text-[11px] font-medium leading-5 text-muted-foreground">Plano atual</span>}
                {p.destaque && atual !== p.id && <span className="ml-2 shrink-0 rounded bg-primary/10 px-1.5 text-[11px] font-medium leading-5 text-primary">Mais completo</span>}
              </span>
              <span className="mt-1 block">
                <span className={texto.numero}>{reais(p.preco_usuario)}</span>
                <span className={juntar(texto.auxiliar, "ml-1")}>por usuário, por mês</span>
              </span>
              {p.resumo && <span className={juntar(texto.auxiliar, "mt-1 block")}>{p.resumo}</span>}
              <span className="mt-3 block space-y-1.5">
                {p.recursos.map((r) => (
                  <span key={r} className="flex min-w-0 items-start">
                    <Check className="mr-2 mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                    <span className={juntar(texto.corpo, "min-w-0")}>{r}</span>
                  </span>
                ))}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex min-w-0 items-center" data-usuarios-do-plano="">
        <span className={juntar(texto.corpo, "mr-3 min-w-0 flex-1")}>Usuários</span>
        <button type="button" className={botao.icone} onClick={() => mudar(usuarios - 1)} disabled={usuarios <= piso} aria-label="Menos um usuário">
          <Minus className="h-4 w-4" aria-hidden="true" />
        </button>
        <input
          type="number"
          inputMode="numeric"
          min={piso}
          max={500}
          value={usuarios}
          onChange={(e) => mudar(Math.floor(Number(e.target.value) || piso))}
          aria-label="Número de usuários"
          className={juntar("mx-1 h-9 w-16 rounded-md border border-input bg-background text-center text-[13px] tabular-nums text-foreground", foco)}
        />
        <button type="button" className={botao.icone} onClick={() => mudar(usuarios + 1)} disabled={usuarios >= 500} aria-label="Mais um usuário">
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
