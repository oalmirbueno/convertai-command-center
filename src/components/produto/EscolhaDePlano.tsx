import { Check, Minus, Plus } from "lucide-react";
import { reais, type PlanoDoProduto } from "@/lib/produto/api";
import { botao, foco, juntar, texto } from "@/components/sistema";

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
      <div className="mb-4 flex min-w-0 flex-wrap items-center rounded-xl border border-border bg-card/60 px-4 py-3" data-usuarios-do-plano="">
        <span className="mr-3 min-w-0 flex-1">
          <span className={juntar(texto.corpo, "block font-medium")}>Quantas pessoas vão usar?</span>
          <span className={juntar(texto.auxiliar, "block")}>O preço é por usuário, por mês. Dá para mudar depois.</span>
        </span>
        <span className="flex shrink-0 items-center rounded-lg bg-muted/60 p-1">
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
            className={juntar("mx-1 h-8 w-14 rounded-md border-0 bg-transparent text-center text-[15px] font-semibold tabular-nums text-foreground", foco)}
          />
          <button type="button" className={botao.icone} onClick={() => mudar(usuarios + 1)} disabled={usuarios >= 500} aria-label="Mais um usuário">
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
        </span>
      </div>

      <div className={juntar("grid min-w-0 grid-cols-1 items-stretch gap-4", planos.length > 1 && "sm:grid-cols-2")} role="radiogroup" aria-label="Plano">
        {planos.map((p) => {
          const marcado = p.id === plano;
          const pessoas = Math.max(usuarios, p.minimo_usuarios || 1);
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={marcado}
              onClick={() => onPlano(p.id)}
              data-plano={p.id}
              className={juntar(
                "relative flex min-w-0 flex-col items-stretch justify-start rounded-xl border bg-card p-5 text-left transition-colors",
                foco,
                marcado ? "border-primary ring-1 ring-primary" : "border-border hover:border-muted-foreground/40",
              )}
            >
              <span className="flex min-w-0 items-center">
                <span className={juntar("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border", marcado ? "border-primary bg-primary text-primary-foreground" : "border-border")} aria-hidden="true">
                  {marcado && <Check className="h-3 w-3" />}
                </span>
                <span className="ml-2.5 min-w-0 flex-1 truncate text-[17px] font-semibold leading-6 text-foreground">{p.nome}</span>
                {atual === p.id && <span className="ml-2 shrink-0 rounded bg-muted px-1.5 text-[11px] font-medium leading-5 text-muted-foreground">Plano atual</span>}
                {p.destaque && atual !== p.id && <span className="ml-2 shrink-0 rounded bg-primary/10 px-1.5 text-[11px] font-medium leading-5 text-primary">Mais completo</span>}
              </span>
              {p.resumo && <span className={juntar(texto.auxiliar, "mt-1.5 block")}>{p.resumo}</span>}
              <span className="mt-4 flex min-w-0 items-baseline">
                <span className="text-[30px] font-semibold leading-9 tracking-[-0.02em] text-foreground tabular-nums">{reais(p.preco_usuario)}</span>
                <span className={juntar(texto.auxiliar, "ml-1.5")}>por usuário, por mês</span>
              </span>
              <span className={juntar(texto.corpo, "mt-1 block tabular-nums", marcado ? "text-primary" : "text-muted-foreground")} data-total-do-plano="">
                {pessoas} {pessoas === 1 ? "usuário" : "usuários"}: {reais(Math.round(p.preco_usuario * pessoas * 100) / 100)} por mês
              </span>
              <span className="mt-4 block space-y-2 border-t border-border pt-4">
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
    </div>
  );
}
