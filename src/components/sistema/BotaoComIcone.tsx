import type { ReactNode } from "react";
import { botao, juntar } from "./estilos";

/**
 * Botão com ícone e texto que, no celular, mostra só o ícone (o texto volta de
 * 640 px para cima; o aria-label leva o nome inteiro). Regra do sistema:
 * "no celular, ícone ou '...', na mesma linha do título".
 *
 * `RotuloLargo` é só o texto que some no celular, para botões e links que já
 * existem (<Link className={botao.discreto}><Icone /><RotuloLargo>Abrir</RotuloLargo></Link>).
 * Promovidos em 26/09 (frente C) das cópias da Mesa Publicidade, da Mesa
 * Roteiros e das Métricas.
 */
export function RotuloLargo({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={juntar("ml-1.5 hidden sm:inline", className)}>{children}</span>;
}

export default function BotaoComIcone({
  icone,
  rotulo,
  variante = "secundario",
  className = "",
  onClick,
  disabled,
  type = "button",
  "aria-label": ariaLabel,
  title,
  ...resto
}: {
  icone: ReactNode;
  /** O texto (some no celular). */
  rotulo: string;
  variante?: keyof typeof botao;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  /** Nome para leitor de tela (padrão: o rótulo). */
  "aria-label"?: string;
  title?: string;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={juntar(botao[variante], className)} aria-label={ariaLabel || rotulo} title={title} {...resto}>
      <span className="inline-flex shrink-0" aria-hidden="true">
        {icone}
      </span>
      <RotuloLargo>{rotulo}</RotuloLargo>
    </button>
  );
}
