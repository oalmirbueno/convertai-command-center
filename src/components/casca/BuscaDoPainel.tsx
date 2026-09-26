import { useEffect, type FC } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

/**
 * Busca do painel (frente E4, 26/09): a lupa da barra do topo não fazia
 * nada. Agora abre uma busca por página (Ctrl+K ou Cmd+K em qualquer tela):
 * digita "agenda", "contratos", "crm" e vai. Usa o mesmo menu da casca, já
 * filtrado pelo papel (quem não vê a página no menu não a acha aqui).
 */

export interface PaginaDaBusca {
  title: string;
  url: string;
  icon: FC<{ className?: string }>;
  grupo: string;
}

/** Ctrl+K / Cmd+K (sem Alt e sem Shift). Vale até dentro de campo, como nos apps comuns. */
export function ehAtalhoDaBusca(e: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return false;
  return e.code === "KeyK" || (e.key || "").toLowerCase() === "k";
}

export default function BuscaDoPainel({
  aberto,
  onAbertoChange,
  paginas,
}: {
  aberto: boolean;
  onAbertoChange: (aberto: boolean) => void;
  paginas: PaginaDaBusca[];
}) {
  const navigate = useNavigate();

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (!ehAtalhoDaBusca(e)) return;
      // Num editor de texto rico o Ctrl+K costuma ser "link": lá não abre.
      const alvo = e.target as HTMLElement | null;
      if (alvo && alvo.isContentEditable) return;
      e.preventDefault();
      onAbertoChange(!aberto);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [aberto, onAbertoChange]);

  const grupos: string[] = [];
  paginas.forEach((p) => {
    if (grupos.indexOf(p.grupo) < 0) grupos.push(p.grupo);
  });

  return (
    <CommandDialog open={aberto} onOpenChange={onAbertoChange}>
      <CommandInput placeholder="Ir para uma página..." aria-label="Buscar página" />
      <CommandList>
        <CommandEmpty>Nenhuma página com esse nome.</CommandEmpty>
        {grupos.map((grupo) => (
          <CommandGroup key={grupo} heading={grupo}>
            {paginas
              .filter((p) => p.grupo === grupo)
              .map((p) => (
                <CommandItem
                  key={p.url}
                  value={`${p.title} ${grupo} ${p.url}`}
                  onSelect={() => {
                    onAbertoChange(false);
                    navigate(p.url);
                  }}
                  className="text-[13px]"
                >
                  <p.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                  {p.title}
                </CommandItem>
              ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
