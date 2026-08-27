import { useEffect } from "react";

/**
 * Menu de botão direito ancorado no cursor, controlado por estado.
 *
 * Existe para as telas onde envolver cada item com o ContextMenu do Radix
 * seria cirurgia frágil (listas grandes com JSX profundo): a tela guarda
 * `{x, y, alvo}` num estado, renderiza este menu UMA vez e monta os itens
 * do alvo na hora. Kanban e Clientes usam assim; o Workspace já usava o
 * mesmo desenho no menu do fundo da área.
 *
 * Cada tela decide os próprios itens — o combinado do painel é que o
 * botão direito oferece as funções DAQUELE lugar, não um menu genérico.
 */

export interface ItemDeMenu {
  rotulo?: string;
  acao?: () => void;
  destrutivo?: boolean;
  separador?: boolean;
  atalho?: string;
}

export function MenuDeContexto({
  x,
  y,
  itens,
  aoFechar,
}: {
  x: number;
  y: number;
  itens: ItemDeMenu[];
  aoFechar: () => void;
}) {
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") aoFechar();
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  // Perto da borda, o menu recua para dentro em vez de vazar da tela.
  const altura = itens.length * 34 + 12;
  const esquerda = Math.min(x, window.innerWidth - 240);
  const topo = Math.min(y, window.innerHeight - altura);

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={aoFechar}
        onContextMenu={(e) => {
          e.preventDefault();
          aoFechar();
        }}
      />
      <div
        role="menu"
        className="fixed z-50 w-56 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
        style={{ left: esquerda, top: topo }}
      >
        {itens.map((item, i) =>
          item.separador ? (
            <div key={`sep-${i}`} className="my-1 h-px bg-border" />
          ) : (
            <button
              key={`${item.rotulo}-${i}`}
              type="button"
              role="menuitem"
              className={`flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent ${
                item.destrutivo ? "text-destructive hover:bg-destructive/10" : ""
              }`}
              onClick={() => {
                aoFechar();
                item.acao?.();
              }}
            >
              {item.rotulo}
              {item.atalho && (
                <span className="ml-auto text-[10px] text-muted-foreground">{item.atalho}</span>
              )}
            </button>
          ),
        )}
      </div>
    </>
  );
}
