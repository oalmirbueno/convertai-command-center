import type { ReactNode } from "react";
import { Search, X } from "lucide-react";
import { botao, campo, juntar, superficie } from "@/components/sistema/estilos";

/** Campo de busca em pílula. */
export function SearchField({
  value,
  onChange,
  placeholder = "Buscar",
  label,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Nome do campo para leitor de tela. */
  label: string;
  className?: string;
}) {
  return (
    <div className={juntar("relative min-w-0", className)}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} className={juntar(campo, "rounded-full pl-9", value ? "pr-9" : "")} />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="Limpar busca" className={juntar(botao.icone, "absolute right-0.5 top-1/2 h-7 w-7 -translate-y-1/2")}>
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/**
 * Barra de ferramentas da página ou do cartão: busca à esquerda, filtros no
 * meio, visões e ações à direita. Tudo na mesma altura (36 px). Quando falta
 * largura, os grupos descem para a linha de baixo inteiros (nada espremido e
 * nada saindo da tela).
 */
export default function Toolbar({
  search,
  filters,
  views,
  actions,
  surface = false,
  label = "Ferramentas",
  className = "",
}: {
  /** A busca (use SearchField). */
  search?: ReactNode;
  /** Filtros: pílulas, seletores. */
  filters?: ReactNode;
  /** Alternar a visão (lista, quadro, calendário). */
  views?: ReactNode;
  /** Ações da barra, à direita. */
  actions?: ReactNode;
  /** A barra dentro de uma faixa branca arredondada (linha de filtros das referências). */
  surface?: boolean;
  label?: string;
  className?: string;
}) {
  if (surface) {
    return (
      <div data-toolbar-surface="" className={juntar(superficie.painel, "min-w-0 p-2 sm:p-2.5", className)}>
        <Toolbar search={search} filters={filters} views={views} actions={actions} label={label} />
      </div>
    );
  }
  return (
    <div role="group" aria-label={label} data-toolbar="" className={juntar("-m-1 flex min-w-0 flex-wrap items-center", className)}>
      {search && <div className="m-1 min-w-[180px] max-w-full flex-1 sm:max-w-[320px]">{search}</div>}
      {filters && <div className="m-1 flex min-w-0 max-w-full flex-wrap items-center [&>*]:mb-0 [&>*+*]:ml-2">{filters}</div>}
      {(views || actions) && (
        <div className="m-1 ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end [&>*+*]:ml-2">
          {views}
          {actions}
        </div>
      )}
    </div>
  );
}
