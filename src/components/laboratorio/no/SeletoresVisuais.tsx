import { useState, type KeyboardEvent as EventoDeTecla } from "react";
import { Minus, Plus, X } from "lucide-react";
import { botao, campo, juntar, texto } from "@/components/sistema";

/**
 * Seletores visuais dos nós (no lugar de texto cru): segmentos para escolha
 * curta, stepper para número, proporção como formas, chips para lista e
 * cores como bolinhas. Tudo com os tokens do tema (claro e escuro).
 */

type Opcao = { valor: string; rotulo: string };

/** Escolha curta (até 4 opções) em segmentos. O rótulo do campo nomeia o grupo. */
export function Segmentos({ id, rotuloId, opcoes, valor, onMudar }: { id: string; rotuloId: string; opcoes: ReadonlyArray<Opcao>; valor: string; onMudar: (v: string) => void }) {
  return (
    <div id={id} role="radiogroup" aria-labelledby={rotuloId} className="flex min-w-0 rounded-md bg-muted p-0.5" data-segmentos="">
      {opcoes.map((o) => {
        const marcado = o.valor === valor;
        return (
          <button
            key={o.valor || "vazio"}
            type="button"
            role="radio"
            aria-checked={marcado}
            className={juntar("min-w-0 flex-1 truncate rounded px-1.5 py-1 text-[12px] font-medium transition-colors", marcado ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            onClick={() => onMudar(o.valor)}
            title={o.rotulo}
          >
            {o.rotulo}
          </button>
        );
      })}
    </div>
  );
}

/** Número com menos e mais. Vazio (opcional) mostra o texto de vazio. */
export function Stepper({ id, valor, min, max, onMudar, vazio }: { id: string; valor: number | null; min: number; max: number; onMudar: (v: number | undefined) => void; vazio?: string }) {
  const atual = valor === null ? null : Math.max(min, Math.min(max, valor));
  // Vazio: o primeiro toque começa no mínimo.
  const passo = (d: number) => onMudar(atual === null ? min : Math.max(min, Math.min(max, atual + d)));
  return (
    <div className="flex min-w-0 items-center" data-stepper="">
      <button type="button" className={juntar(botao.icone, "h-8 w-8 rounded-md bg-muted")} onClick={() => passo(-1)} disabled={atual !== null && atual <= min} aria-label="Menos" title="Menos">
        <Minus className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <input
        id={id}
        type="number"
        className={juntar(campo, "mx-1 h-8 w-16 flex-none px-1 text-center tabular-nums")}
        min={min}
        max={max}
        placeholder={vazio}
        value={atual === null ? "" : atual}
        onChange={(e) => onMudar(e.target.value === "" && vazio ? undefined : Math.max(min, Math.min(max, Number(e.target.value) || min)))}
      />
      <button type="button" className={juntar(botao.icone, "h-8 w-8 rounded-md bg-muted")} onClick={() => passo(1)} disabled={atual !== null && atual >= max} aria-label="Mais" title="Mais">
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {vazio && atual !== null ? (
        <button type="button" className={juntar(texto.auxiliar, "ml-2 hover:text-foreground hover:underline")} onClick={() => onMudar(undefined)}>
          {vazio}
        </button>
      ) : null}
    </div>
  );
}

/** Forma da proporção (retângulo desenhado na proporção certa). */
function Forma({ proporcao }: { proporcao: string }) {
  const [a, b] = proporcao.split(":").map(Number);
  const maior = Math.max(a || 1, b || 1);
  const l = Math.round(((a || 1) / maior) * 18);
  const h = Math.round(((b || 1) / maior) * 18);
  return <span className="block rounded-[3px] border-2 border-current" style={{ width: l, height: h }} aria-hidden="true" />;
}

/** Proporção como formas. Com `vazio`, a primeira opção é "da configuração". */
export function SeletorDeProporcao({ id, rotuloId, opcoes, valor, onMudar, vazio }: { id: string; rotuloId: string; opcoes: ReadonlyArray<Opcao>; valor: string; onMudar: (v: string | undefined) => void; vazio?: string }) {
  return (
    <div id={id} role="radiogroup" aria-labelledby={rotuloId} className="grid min-w-0 grid-cols-4 gap-1" data-proporcao="">
      {vazio ? (
        <button type="button" role="radio" aria-checked={!valor} className={juntar("flex h-12 flex-col items-center justify-center rounded-md text-[11px] transition-colors", !valor ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground hover:text-foreground")} onClick={() => onMudar(undefined)} title={vazio}>
          Auto
        </button>
      ) : null}
      {opcoes.map((o) => {
        const marcado = o.valor === valor;
        return (
          <button
            key={o.valor}
            type="button"
            role="radio"
            aria-checked={marcado}
            aria-label={o.rotulo}
            title={o.rotulo}
            className={juntar("flex h-12 flex-col items-center justify-center rounded-md transition-colors", marcado ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground hover:text-foreground")}
            onClick={() => onMudar(o.valor)}
          >
            <span className="flex h-[20px] items-center justify-center">
              <Forma proporcao={o.valor} />
            </span>
            <span className="mt-0.5 text-[11px] tabular-nums leading-none">{o.valor}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Lista em chips, guardada como texto (separador `sep`). Enter ou vírgula adiciona. */
export function Chips({
  id,
  valor,
  onMudar,
  sep = ", ",
  placeholder,
  cor = false,
}: {
  id: string;
  valor: string;
  onMudar: (v: string) => void;
  sep?: string;
  placeholder?: string;
  /** Itens são cores: mostra a bolinha. */
  cor?: boolean;
}) {
  const quebra = sep.indexOf("\n") >= 0 ? /\n+/ : /\s*[,;]\s*/;
  const itens = (valor || "").split(quebra).map((x) => x.trim()).filter(Boolean);
  const [novo, setNovo] = useState("");
  const por = (t: string) => {
    const limpos = t.split(quebra).map((x) => x.trim()).filter(Boolean).filter((x) => itens.indexOf(x) < 0);
    if (limpos.length) onMudar(itens.concat(limpos).join(sep));
    setNovo("");
  };
  const tecla = (e: EventoDeTecla<HTMLInputElement>) => {
    if (e.key === "Enter" || (e.key === "," && sep.indexOf("\n") < 0)) {
      e.preventDefault();
      por(novo);
    } else if (e.key === "Backspace" && !novo && itens.length) onMudar(itens.slice(0, -1).join(sep));
  };
  return (
    <div className="flex min-w-0 flex-wrap items-center rounded-md border border-input bg-background px-1.5 py-1" data-chips="">
      {itens.map((x, i) => (
        <span key={`${x}-${i}`} className="mb-0.5 mr-1 inline-flex max-w-full items-center rounded-full bg-muted py-0.5 pl-1.5 pr-0.5 text-[12px] text-foreground" data-chip="">
          {cor ? <span className="mr-1 inline-block h-3 w-3 shrink-0 rounded-full border border-border" style={{ background: x }} aria-hidden="true" /> : null}
          <span className="min-w-0 truncate">{x}</span>
          <button type="button" className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground" onClick={() => onMudar(itens.filter((_, j) => j !== i).join(sep))} aria-label={`Tirar ${x}`} title={`Tirar ${x}`}>
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </span>
      ))}
      <input
        id={id}
        className="mb-0.5 h-6 min-w-[72px] flex-1 bg-transparent px-1 text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
        value={novo}
        placeholder={itens.length ? "" : placeholder}
        onChange={(e) => setNovo(e.target.value)}
        onKeyDown={tecla}
        onBlur={() => novo.trim() && por(novo)}
      />
    </div>
  );
}
