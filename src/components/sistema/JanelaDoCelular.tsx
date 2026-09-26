import { useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { botao, juntar, texto } from "./estilos";

/**
 * Janela de celular e tablet (docs/design/SISTEMA.md, seção 15): sobe de
 * baixo no celular e fica no meio de 640 px para cima, com título, "Fechar",
 * corpo que rola por dentro e rodapé fixo (ações).
 *
 * Nasce no body (portal): abaixo de 768 px o conteúdo do painel é uma camada
 * fixa própria, e uma janela montada lá dentro ficava por baixo da barra de
 * baixo. Esc fecha. Promovida em 26/09 (frente C) das cópias de Pedidos
 * (equipe e portal).
 */
export default function JanelaDoCelular({
  aberta,
  titulo,
  onFechar,
  rodape,
  larga = false,
  rotuloDoFundo,
  classeDoCorpo = "px-4 py-4 sm:px-5",
  children,
}: {
  aberta: boolean;
  titulo: ReactNode;
  onFechar: () => void;
  /** Faixa de baixo, fixa (ações). */
  rodape?: ReactNode;
  /** 520 px em vez de 440 px a partir de 640 px. */
  larga?: boolean;
  /** Nome do fundo escurecido para leitor de tela (vira um botão de fechar). Sem ele, o fundo só fecha no toque. */
  rotuloDoFundo?: string;
  classeDoCorpo?: string;
  children: ReactNode;
}) {
  const id = useId();
  const idDoTitulo = `janela-${id.replace(/:/g, "")}`;

  useEffect(() => {
    if (!aberta) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Esc") onFechar();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [aberta, onFechar]);

  if (!aberta || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-labelledby={idDoTitulo}>
      {rotuloDoFundo ? (
        <button type="button" aria-label={rotuloDoFundo} className="absolute inset-0 bg-black/60" onClick={onFechar} />
      ) : (
        <div aria-hidden="true" className="absolute inset-0 bg-black/60" onClick={onFechar} />
      )}
      <div
        className={juntar(
          "relative flex max-h-[95vh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-card sm:mx-4 sm:rounded-lg",
          larga ? "max-w-[520px]" : "max-w-[440px]",
        )}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3 sm:px-5">
          <h2 id={idDoTitulo} className={juntar(texto.tituloSecao, "min-w-0 truncate")}>
            {titulo}
          </h2>
          <button type="button" onClick={onFechar} aria-label="Fechar" className={juntar(botao.icone, "ml-2")}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className={juntar("min-h-0 flex-1 overflow-y-auto overscroll-contain", classeDoCorpo)}>{children}</div>
        {rodape ? <div className="shrink-0 pb-[env(safe-area-inset-bottom)]">{rodape}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
