import { Children, isValidElement, type ReactNode } from "react";
import Secao from "./Secao";
import { espaco, juntar } from "./estilos";

/** Classes inteiras (o Tailwind só gera o que está escrito). */
const COLUNAS: Record<"md" | "lg" | "xl", Record<2 | 3, string>> = {
  md: { 2: "md:grid-cols-2", 3: "md:grid-cols-2 lg:grid-cols-3" },
  lg: { 2: "lg:grid-cols-2", 3: "lg:grid-cols-2 xl:grid-cols-3" },
  xl: { 2: "xl:grid-cols-2", 3: "xl:grid-cols-3" },
};
const LATERAL: Record<"md" | "lg" | "xl", Record<280 | 320 | 360 | 400, string>> = {
  md: { 280: "md:grid-cols-[minmax(0,1fr)_280px]", 320: "md:grid-cols-[minmax(0,1fr)_320px]", 360: "md:grid-cols-[minmax(0,1fr)_360px]", 400: "md:grid-cols-[minmax(0,1fr)_400px]" },
  lg: { 280: "lg:grid-cols-[minmax(0,1fr)_280px]", 320: "lg:grid-cols-[minmax(0,1fr)_320px]", 360: "lg:grid-cols-[minmax(0,1fr)_360px]", 400: "lg:grid-cols-[minmax(0,1fr)_400px]" },
  xl: { 280: "xl:grid-cols-[minmax(0,1fr)_280px]", 320: "xl:grid-cols-[minmax(0,1fr)_320px]", 360: "xl:grid-cols-[minmax(0,1fr)_360px]", 400: "xl:grid-cols-[minmax(0,1fr)_400px]" },
};

let avisou = false;

/**
 * Seções ABERTAS lado a lado (docs/design/SISTEMA.md 4.1): uma coluna no
 * celular, duas ou três a partir de `apartirDe`, ou conteúdo + uma coluna
 * lateral fixa (`lateral`). Ritmo de `espaco.colunas`: 32 px entre colunas,
 * 28 px entre linhas. Cada filho encolhe (`min-w-0`) e nada vaza.
 *
 * Seção não vira cartão: o filho é uma `Secao` aberta (ou uma coluna com
 * várias). Em desenvolvimento, avisa no console se um filho é `Secao cartao`.
 */
export default function GradeDeSecoes({
  colunas = 2,
  apartirDe = "lg",
  lateral,
  className = "",
  children,
  ...resto
}: {
  colunas?: 2 | 3;
  /** Largura em que deixa de ser uma coluna só. */
  apartirDe?: "md" | "lg" | "xl";
  /** Coluna da direita com largura fixa (px); com ela, `colunas` não conta. */
  lateral?: 280 | 320 | 360 | 400;
  className?: string;
  children?: ReactNode;
} & Record<`data-${string}`, string | undefined>) {
  if (import.meta.env && import.meta.env.DEV && !avisou) {
    Children.forEach(children, (filho) => {
      if (!avisou && isValidElement(filho) && filho.type === Secao && (filho.props as { cartao?: boolean }).cartao) {
        avisou = true;
        console.warn("GradeDeSecoes: seção não vira cartão (docs/design/SISTEMA.md 4.1). Tire o `cartao` da Secao.");
      }
    });
  }
  const grade = lateral ? LATERAL[apartirDe][lateral] : COLUNAS[apartirDe][colunas];
  return (
    <div className={juntar(espaco.colunas, grade, "[&>*]:min-w-0", className)} data-grade-de-secoes="" {...resto}>
      {children}
    </div>
  );
}
