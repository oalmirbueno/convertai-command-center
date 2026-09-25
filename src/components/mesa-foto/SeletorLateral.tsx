import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Seletor lateral compacto das personas (Modelos) e dos clones (pedido do
 * dono, 26/09: "o seletor lateral das imagens nos modelos está muito grande,
 * toma espaço; deixar pequeno, minimalista, com seletor"). Um seletor em
 * cima (sempre à mão, também no celular) e, no computador, a lista curta com
 * miniatura pequena, nome e o estado em ponto de cor. Nada de cartão grande.
 */

export interface ItemDoSeletor {
  id: string;
  nome: string;
  /** Miniatura (32 px) já montada por quem chama (imagem do Storage ou URL). */
  miniatura: ReactNode;
  /** Ponto de cor do estado: classe de fundo (bg-success, bg-primary, bg-muted-foreground/40). */
  estado: { rotulo: string; ponto: string };
  /** Texto curto depois do estado ("da agência", "autorização inválida"). */
  nota?: string | null;
  alerta?: boolean;
}

export default function SeletorLateral({
  titulo,
  itens,
  escolhido,
  onEscolher,
  onNovo,
  novoRotulo,
  novoAberto,
  vazio,
  filtro,
}: {
  titulo: string;
  itens: ItemDoSeletor[];
  escolhido: string | null;
  onEscolher: (id: string) => void;
  onNovo: () => void;
  novoRotulo: string;
  novoAberto: boolean;
  vazio: string;
  /** Pílulas de filtro (opcional), já montadas. */
  filtro?: ReactNode;
}) {
  const atual = itens.find((i) => i.id === escolhido) || null;
  return (
    <section className="min-w-0 rounded-xl border border-border bg-card p-2.5" aria-label={titulo} data-seletor-lateral="">
      <div className="mb-2 flex min-w-0 items-center">
        <p className="mr-auto truncate text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {titulo} · {itens.length}
        </p>
        <Button type="button" size="sm" className="h-7 px-2 text-[11.5px]" onClick={onNovo} disabled={novoAberto}>
          <Plus className="mr-1 h-3.5 w-3.5" /> {novoRotulo}
        </Button>
      </div>
      {itens.length > 0 && (
        <Select value={atual ? atual.id : ""} onValueChange={onEscolher}>
          <SelectTrigger className="h-9 min-w-0 text-[12.5px]" aria-label={`Escolher em ${titulo}`}>
            <SelectValue placeholder={novoAberto ? "Criando novo" : "Escolha"} />
          </SelectTrigger>
          <SelectContent>
            {itens.map((i) => (
              <SelectItem key={i.id} value={i.id}>
                {i.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {filtro && <div className="mt-2">{filtro}</div>}
      {itens.length === 0 ? (
        <p className="mt-1 text-[12px] text-muted-foreground">{vazio}</p>
      ) : (
        <ul className="mt-2 hidden min-w-0 space-y-0.5 lg:block lg:max-h-[46vh] lg:overflow-y-auto" style={{ overscrollBehavior: "contain" }} aria-label={titulo}>
          {itens.map((i) => {
            const ativo = i.id === escolhido;
            return (
              <li key={i.id} className="min-w-0" data-item-do-seletor={i.id}>
                <button
                  type="button"
                  onClick={() => onEscolher(i.id)}
                  aria-pressed={ativo}
                  aria-label={`Abrir ${i.nome}`}
                  className={`flex w-full min-w-0 items-center rounded-lg px-1.5 py-1 text-left transition-colors ${ativo ? "bg-primary/10" : "hover:bg-muted"}`}
                >
                  <span className="relative mr-2 block h-8 w-8 shrink-0 overflow-hidden rounded-md bg-muted">{i.miniatura}</span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[12px] ${ativo ? "font-semibold" : "font-medium"}`}>{i.nome}</span>
                    <span className="flex min-w-0 items-center text-[10.5px] text-muted-foreground">
                      <span className={`mr-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${i.estado.ponto}`} aria-hidden="true" />
                      <span className="truncate">
                        {i.estado.rotulo}
                        {i.nota ? ` · ${i.nota}` : ""}
                      </span>
                    </span>
                  </span>
                  {i.alerta && <span className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-label="Atenção" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
