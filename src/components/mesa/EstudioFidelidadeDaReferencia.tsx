import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { textoDoErro } from "@/lib/mesa/api";
import { corpoDaFidelidade, FIDELIDADES, ROTULO_DA_FIDELIDADE, fidelidadeValida, type Fidelidade } from "./fidelidadeDaReferencia";

/**
 * Fidelidade à referência (frente E, 25/09 à noite; dono: "ter os controles
 * que eu consiga aumentar e diminuir, dentro do Estúdio"). Controle de 4
 * passos, da cópia mais fiel à mais livre: Idêntica (o padrão, o modo replicar
 * de sempre), Próxima, Inspirada e Criativa. Na lâmina, sem escolha própria,
 * vale o padrão do trabalho (mostrado no título). Grava pelo configurar, sem
 * custo; vale na próxima geração.
 */
export default function EstudioFidelidadeDaReferencia({
  alvo,
  ordem,
  escolha,
  doTrabalho,
  bloqueado = false,
  onSalvar,
  compacto = false,
}: {
  alvo: "lamina" | "conjunto";
  ordem?: number;
  /** Na lâmina: card.fidelidade_referencia (null = segue o trabalho). No conjunto: direcao.fidelidade_referencia. */
  escolha: string | null | undefined;
  /** O padrão do trabalho, para a lâmina mostrar o que herda. */
  doTrabalho?: string | null;
  bloqueado?: boolean;
  onSalvar: (corpo: Record<string, unknown>) => Promise<void>;
  compacto?: boolean;
}) {
  const [salvando, setSalvando] = useState(false);
  const propria = fidelidadeValida(escolha);
  const herdada = fidelidadeValida(doTrabalho) || "identica";
  const atual: Fidelidade = propria || (alvo === "lamina" ? herdada : "identica");

  const escolher = async (v: Fidelidade | null) => {
    if (bloqueado || salvando) return;
    if (v !== null && v === propria) return;
    if (v === null && !propria) return;
    setSalvando(true);
    try {
      // No conjunto, voltar para Idêntica tira o campo (o padrão de sempre).
      await onSalvar(corpoDaFidelidade(alvo, alvo === "conjunto" && v === "identica" ? null : v, ordem));
      toast.success(
        alvo === "lamina"
          ? `Lâmina ${ordem}: ${v ? ROTULO_DA_FIDELIDADE[v] : `a do trabalho (${ROTULO_DA_FIDELIDADE[herdada]})`}`
          : `Fidelidade do trabalho: ${ROTULO_DA_FIDELIDADE[v || "identica"]}`,
        { description: "Vale na próxima geração com referência." },
      );
    } catch (e) {
      toast.error("Fidelidade não salva", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="min-w-0" data-controle="fidelidade-referencia">
      <div
        role="radiogroup"
        aria-label={alvo === "lamina" ? `Fidelidade à referência da lâmina ${ordem}` : "Fidelidade à referência do trabalho"}
        className={`grid grid-cols-4 gap-0.5 rounded-md border border-border bg-background p-0.5 ${compacto ? "max-w-[300px]" : ""}`}
      >
        {FIDELIDADES.map((f) => {
          const marcada = f.valor === atual;
          return (
            <button
              key={f.valor}
              type="button"
              role="radio"
              aria-checked={marcada}
              title={f.dica}
              disabled={bloqueado || salvando}
              onClick={() => void escolher(f.valor)}
              className={`h-6 min-w-0 truncate rounded px-1 text-[11px] transition-colors disabled:opacity-50 ${
                marcada ? (propria || alvo === "conjunto" ? "bg-primary font-medium text-primary-foreground" : "bg-primary/15 font-medium text-foreground") : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.rotulo}
            </button>
          );
        })}
      </div>
      <p className="mt-0.5 flex min-w-0 items-center text-[10.5px] leading-snug text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">
          {alvo === "lamina" && !propria ? `Segue o trabalho (${ROTULO_DA_FIDELIDADE[herdada]}). ` : ""}
          {(FIDELIDADES.find((f) => f.valor === atual) || FIDELIDADES[0]).dica}
        </span>
        {alvo === "lamina" && propria && (
          <button type="button" className="ml-1 shrink-0 text-primary underline-offset-2 hover:underline disabled:opacity-50" disabled={bloqueado || salvando} onClick={() => void escolher(null)}>
            usar a do trabalho
          </button>
        )}
        {salvando && <Loader2 className="ml-1 h-3 w-3 shrink-0 animate-spin" aria-label="Salvando a fidelidade" />}
      </p>
    </div>
  );
}
