import type { ReactNode } from "react";

/**
 * Caixa em 4:5 com altura calculada pela largura (padding de 125%), para o
 * Safari 11, que não conhece aspect-ratio. Só dá o tamanho: o conteúdo
 * ocupa a caixa inteira, sem nada por cima.
 */
export default function Moldura45({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative w-full ${className}`} style={{ paddingBottom: "125%" }}>
      <div className="absolute inset-0">{children}</div>
    </div>
  );
}
