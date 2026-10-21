import type { ReactNode } from "react";
import { juntar, texto } from "@/components/sistema/estilos";

/**
 * Peças pequenas do Template (21/10/2026): a escolha em pílulas (rede, tema,
 * proporção, origem da imagem) e o número opcional (curtidas, respostas...).
 * Mesmo desenho das pílulas do Refinar texto: sem caixa, a escolhida em verde.
 */
export function Segmentado<T extends string>({ rotulo, opcoes, valor, onEscolher, desativado = false, mostrarRotulo = true }: {
  rotulo: string;
  opcoes: Array<{ valor: T; rotulo: string; icone?: ReactNode; dica?: string }>;
  valor: T;
  onEscolher: (v: T) => void;
  desativado?: boolean;
  mostrarRotulo?: boolean;
}) {
  return (
    <div className="min-w-0">
      {mostrarRotulo && <p className={juntar(texto.rotulo, "mb-1.5")}>{rotulo}</p>}
      <div role="group" aria-label={rotulo} className="flex flex-wrap">
        {opcoes.map((o) => (
          <button
            key={o.valor}
            type="button"
            aria-pressed={valor === o.valor}
            disabled={desativado}
            title={o.dica || o.rotulo}
            onClick={() => onEscolher(o.valor)}
            className={juntar(
              "toque-compacto mb-1.5 mr-1.5 inline-flex h-8 items-center rounded-full border px-3 text-[12px] font-medium transition-colors disabled:opacity-50",
              valor === o.valor ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
            )}
          >
            {o.icone && <span className="mr-1.5 inline-flex shrink-0" aria-hidden="true">{o.icone}</span>}
            {o.rotulo}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Número opcional: vazio some do post; só inteiros sem sinal. */
export function NumeroOpcional({ rotulo, valor, onMudar, desativado = false }: { rotulo: string; valor: number | undefined; onMudar: (v: number | undefined) => void; desativado?: boolean }) {
  return (
    <label className={juntar("block min-w-0", texto.rotulo)}>
      {rotulo}
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={9_999_999_999}
        step={1}
        disabled={desativado}
        aria-label={rotulo}
        value={typeof valor === "number" ? valor : ""}
        placeholder="—"
        onChange={(e) => {
          const bruto = e.target.value.trim();
          if (!bruto) return onMudar(undefined);
          const n = Math.floor(Number(bruto));
          onMudar(Number.isFinite(n) && n >= 0 ? Math.min(n, 9_999_999_999) : undefined);
        }}
        className="mt-1 block h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      />
    </label>
  );
}
