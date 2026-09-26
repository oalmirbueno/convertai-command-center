import { Search, X } from "lucide-react";
import { botao, campo, juntar } from "./estilos";

/**
 * Campo de busca padrão (docs/design/SISTEMA.md, seção 15): lupa, o campo do
 * sistema (36 px) e o "limpar" com aria-label, do tamanho de um filtro na
 * fileira de filtros. Nasceu no Comercial (frente E, Pecas.tsx) e foi
 * promovido em 26/09 (frente C).
 */
export default function CampoDeBusca({
  valor,
  onMudar,
  placeholder,
  rotulo,
  className = "",
}: {
  valor: string;
  onMudar: (v: string) => void;
  placeholder: string;
  /** Nome do campo para leitor de tela. */
  rotulo: string;
  className?: string;
}) {
  return (
    <div className={juntar("relative min-w-0", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <input
        type="search"
        value={valor}
        onChange={(e) => onMudar(e.target.value)}
        placeholder={placeholder}
        aria-label={rotulo}
        className={juntar(campo, "pl-9", valor ? "pr-9" : "")}
      />
      {valor && (
        <button
          type="button"
          onClick={() => onMudar("")}
          aria-label="Limpar busca"
          className={juntar(botao.icone, "absolute right-0.5 top-1/2 h-7 w-7 -translate-y-1/2")}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
