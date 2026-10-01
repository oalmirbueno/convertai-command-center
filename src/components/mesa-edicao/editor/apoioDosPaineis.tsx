import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { juntar, texto } from "@/components/sistema/estilos";
import type { ProjetoDeEdicao } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import type { Operacao } from "@/lib/editor/operacoes";
import type { EstadoDoSalvamento } from "@/lib/editor/autosave";
import { Montador } from "@/lib/editor/skills/tipos";
import type { ControleDePropostas } from "./PainelDeSkills";

/**
 * Peças comuns dos painéis do editor completo (frente EDT, rodada 2): o que a
 * tela do editor passa a cada painel, o deslizante que grava ao soltar (um
 * passo do desfazer por mudança) e o título com "?".
 */

export interface ContextoDoPainel {
  projeto: ProjetoDeEdicao;
  urls: Record<string, string>;
  cursor: () => number;
  selecao: string[];
  onOps: (ops: Operacao[], rotulo: string) => void;
  controle: ControleDePropostas;
  versaoId: string;
  irPara: (aba: string) => void;
  irParaTempo: (s: number) => void;
  desfazer: () => void;
  salvarAgora: () => Promise<void>;
  revisao: () => number | null;
  estadoDoSalvamento: () => EstadoDoSalvamento;
}

/** Monta operações numa cópia (Montador); erro vira aviso na tela e nada muda. */
export function aplicarMontando(ctx: Pick<ContextoDoPainel, "projeto" | "onOps">, rotulo: string, f: (m: Montador) => string | void): boolean {
  const m = new Montador(ctx.projeto);
  try {
    const feito = f(m);
    if (!m.operacoes.length) {
      toast.info(typeof feito === "string" && feito ? feito : "Nada a mudar.");
      return false;
    }
    ctx.onOps(m.operacoes, rotulo);
    if (typeof feito === "string" && feito) toast.success(feito, { description: "Ctrl+Z desfaz." });
    m.avisos.forEach((a) => toast.info(a));
    return true;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Não deu.");
    return false;
  }
}

export function TituloDoPainel({ titulo, ajuda, acao }: { titulo: string; ajuda?: ReactNode; acao?: ReactNode }) {
  return (
    <div className="mb-2 flex min-w-0 items-center">
      <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">{titulo}</p>
      {acao}
      {ajuda && <AjudaRecolhida titulo={titulo}>{ajuda}</AjudaRecolhida>}
    </div>
  );
}

export function Subtitulo({ children, ajuda }: { children: ReactNode; ajuda?: ReactNode }) {
  return (
    <div className="mb-1 mt-3 flex min-w-0 items-center border-t border-border pt-3">
      <p className={juntar(texto.rotulo, "min-w-0 flex-1 truncate")}>{children}</p>
      {ajuda && <AjudaRecolhida>{ajuda}</AjudaRecolhida>}
    </div>
  );
}

/** Deslizante que grava ao soltar (mouse, toque ou teclado): um passo do desfazer por mudança. */
export function Deslizante({ rotulo, valor, min, max, passo, formatar, onMudar }: { rotulo: string; valor: number; min: number; max: number; passo: number; formatar?: (v: number) => string; onMudar: (v: number) => void }) {
  const [v, setV] = useState(valor);
  useEffect(() => setV(valor), [valor]);
  const gravar = () => {
    if (Math.abs(v - valor) > 1e-9) onMudar(v);
  };
  return (
    <label className="block min-w-0">
      <span className="flex min-w-0 items-center">
        <span className={juntar(texto.rotulo, "min-w-0 flex-1 truncate")}>{rotulo}</span>
        <span className="text-[12px] tabular-nums text-muted-foreground">{formatar ? formatar(v) : String(Math.round(v * 100) / 100).replace(".", ",")}</span>
      </span>
      <input type="range" className="mt-1 w-full accent-primary" min={min} max={max} step={passo} value={v} onChange={(e) => setV(Number(e.target.value))} onMouseUp={gravar} onTouchEnd={gravar} onKeyUp={gravar} aria-label={rotulo} />
    </label>
  );
}

export const porCento = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}`;
