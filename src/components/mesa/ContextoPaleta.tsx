import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { temTexto, type CorDoKit } from "./contextoDoCliente";

/**
 * Paleta da marca em amostras grandes (pedido do dono em 23/09: "colocar
 * cor, ficar bem bonito, tudo encaixadinho"): a cor de verdade ocupa o
 * quadro, com o hex por cima em branco ou preto conforme o contraste, e o
 * nome e o papel embaixo. Clicar copia o hex.
 */

const HEX6 = /^#?([0-9a-fA-F]{6})$/;
const HEX3 = /^#?([0-9a-fA-F]{3})$/;

/** #RRGGBB em maiúsculas, ou null quando o texto não é uma cor. */
export function normalizarHex(hex: unknown): string | null {
  const t = typeof hex === "string" ? hex.trim() : "";
  const seis = HEX6.exec(t);
  if (seis) return `#${seis[1].toUpperCase()}`;
  const tres = HEX3.exec(t);
  if (tres) {
    const d = tres[1].toUpperCase();
    return `#${d[0]}${d[0]}${d[1]}${d[1]}${d[2]}${d[2]}`;
  }
  return null;
}

/** Luminância relativa (WCAG) de uma cor #RRGGBB. */
function luminancia(hex: string): number {
  const canal = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
}

/** Texto legível por cima da cor: preto em cor clara, branco em cor escura. */
export function textoSobre(hex: string): "#111111" | "#FFFFFF" {
  const h = normalizarHex(hex);
  if (!h) return "#111111";
  const l = luminancia(h);
  // Contraste com branco (1.05 / (l + 0.05)) contra preto ((l + 0.05) / 0.05).
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? "#FFFFFF" : "#111111";
}

const ROTULO_DO_PAPEL: Record<string, string> = {
  principal: "Principal",
  secundaria: "Secundária",
  destaque: "Destaque",
  fundo: "Fundo",
  texto: "Texto",
};

export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    /* cai no jeito antigo */
  }
  try {
    const area = document.createElement("textarea");
    area.value = texto;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export function PaletaDaMarca({ paleta, carregando = false }: { paleta: CorDoKit[]; carregando?: boolean }) {
  const [copiado, setCopiado] = useState<number | null>(null);

  if (carregando) {
    return (
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[104px] animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    );
  }

  const copiar = async (i: number, hex: string) => {
    const ok = await copiarTexto(hex);
    if (ok) {
      setCopiado(i);
      window.setTimeout(() => setCopiado((c) => (c === i ? null : c)), 1400);
      toast.success(`${hex} copiado`);
    } else {
      toast.error("Não foi possível copiar", { description: hex });
    }
  };

  return (
    <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4" aria-label="Paleta da marca">
      {paleta.map((c, i) => {
        const hex = normalizarHex(c.hex);
        const valida = !!hex;
        const cor = hex || "#FFFFFF";
        const tinta = textoSobre(cor);
        const papel = ROTULO_DO_PAPEL[c.papel] || (temTexto(c.papel) ? c.papel : "");
        return (
          <li key={`${c.hex}-${i}`} className="min-w-0">
            <button
              type="button"
              onClick={() => valida && void copiar(i, hex!)}
              disabled={!valida}
              title={valida ? `Copiar ${hex}` : "Cor inválida"}
              aria-label={valida ? `Copiar ${hex}${temTexto(c.nome) ? `, ${c.nome}` : ""}` : `Cor inválida: ${c.hex}`}
              className="group flex w-full min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card text-left transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="relative flex h-16 w-full items-end px-2.5 pb-2 sm:h-[72px]" style={{ backgroundColor: cor }}>
                <span className="font-mono text-[12px] font-semibold tracking-wide" style={{ color: tinta }}>
                  {valida ? hex : String(c.hex || "?")}
                </span>
                <span
                  className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                  style={{ color: tinta, backgroundColor: tinta === "#FFFFFF" ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.55)" }}
                  aria-hidden="true"
                >
                  {copiado === i ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </span>
              </span>
              <span className="block min-w-0 px-2.5 py-2">
                <span className="block truncate text-[12.5px] font-medium text-foreground">{temTexto(c.nome) ? c.nome : "Sem nome"}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{copiado === i ? "Copiado" : papel || "Cor da marca"}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
