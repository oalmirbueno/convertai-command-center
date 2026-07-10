import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * MobilePageShell — layout app-like para mobile.
 * Fixa o header/abas no topo e deixa apenas o Body rolar,
 * respeitando safe-areas e a MobileBottomNav (56px).
 *
 * Uso:
 *   <MobilePageShell.Root>
 *     <MobilePageShell.Header>...título/ações...</MobilePageShell.Header>
 *     <MobilePageShell.Tabs>...abas/filtros...</MobilePageShell.Tabs>
 *     <MobilePageShell.Body>...conteúdo scrollável...</MobilePageShell.Body>
 *   </MobilePageShell.Root>
 *
 * Só renderiza sua estrutura no mobile; no desktop passa-se `desktop` opcional
 * como fallback ou usa-se o componente apenas dentro de bloco `md:hidden`.
 */

const Root: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, children, ...props }) => (
  <div
    className={cn(
      "flex h-[calc(100dvh-176px-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-col md:block md:h-auto",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

const Header: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, children, ...props }) => (
  <div
    className={cn(
      "shrink-0 md:contents px-1 pb-2",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

const Tabs: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, children, ...props }) => (
  <div
    className={cn(
      "shrink-0 md:contents -mx-4 px-4 overflow-x-auto scrollbar-hidden border-b border-border/60",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

const Body: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, children, ...props }) => (
  <div
    className={cn(
      "flex-1 min-h-0 md:contents overflow-y-auto -mx-4 px-4 pt-3",
      className
    )}
    style={{
      overscrollBehavior: "contain",
      WebkitOverflowScrolling: "touch",
      paddingBottom: "16px",
    }}
    {...props}
  >
    {children}
  </div>
);

export const MobilePageShell = { Root, Header, Tabs, Body };
export default MobilePageShell;
