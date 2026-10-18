import { ScanSearch } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { botao } from "@/components/sistema/estilos";
import { raioXDoMes, type ItemParaORaioX } from "./contaDoRaioX";

/**
 * Raio-x do mês (17/10/2026): um ícone ao lado da contagem da agenda abre o
 * equilíbrio do mês (formatos, pilares e quantas pautas pegam o momento:
 * hype, em alta no nicho, concorrente). Explicação só ao abrir (padrão visual
 * organizado: nada encaixotado na tela).
 */
export default function RaioXDoMes({ itens }: { itens: ItemParaORaioX[] }) {
  if (!itens.length) return null;
  const r = raioXDoMes(itens);
  const comMomento = r.ganchos.hype + r.ganchos.nicho + r.ganchos.concorrente;
  const linha = (rotulo: string, n: number) => (
    <li key={rotulo} className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate" title={rotulo}>{rotulo}</span>
      <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-primary" style={{ width: `${Math.round((n / r.total) * 100)}%` }} /></span>
      <span className="w-6 shrink-0 text-right tabular-nums">{n}</span>
    </li>
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={botao.icone} aria-label="Raio-x do mês" title="Raio-x do mês: formatos, pilares e o que pega o momento">
          <ScanSearch className="h-4 w-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3 text-[13px]">
        <div>
          <p className="text-[13px] font-semibold">Raio-x do mês</p>
          <p className="text-muted-foreground">{r.total} {r.total === 1 ? "peça" : "peças"} na Mesa</p>
        </div>
        <div>
          <p className="mb-1 text-[11px] font-semibold text-muted-foreground">Pega o momento</p>
          <p>
            <strong className="tabular-nums">{comMomento}</strong> de {r.total}
            {comMomento ? ` (${[r.ganchos.hype ? `${r.ganchos.hype} hype` : "", r.ganchos.nicho ? `${r.ganchos.nicho} em alta no nicho` : "", r.ganchos.concorrente ? `${r.ganchos.concorrente} concorrente` : ""].filter(Boolean).join(", ")})` : ""}
          </p>
          {!comMomento && <p className="mt-0.5 text-muted-foreground">Nenhuma pauta usa hype, nicho ou concorrente. Pautas novas do agente já marcam o gancho.</p>}
        </div>
        <div>
          <p className="mb-1 text-[11px] font-semibold text-muted-foreground">Formatos</p>
          <ul className="space-y-1">{r.formatos.map((f) => linha(f.rotulo, f.n))}</ul>
          {r.formatoDominante && <p className="mt-1 text-warning">{r.formatoDominante.rotulo} ocupa {r.formatoDominante.pct}% do mês: vale alternar formatos.</p>}
        </div>
        {r.pilares.length > 0 && (
          <div>
            <p className="mb-1 text-[11px] font-semibold text-muted-foreground">Pilares</p>
            <ul className="space-y-1">{r.pilares.slice(0, 6).map((p) => linha(p.rotulo, p.n))}</ul>
            {r.pilarDominante && <p className="mt-1 text-warning">{r.pilarDominante.rotulo} ocupa {r.pilarDominante.pct}% do mês: vale variar.</p>}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
