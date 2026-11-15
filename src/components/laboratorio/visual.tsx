import type { CSSProperties, ReactNode } from "react";
import { juntar } from "@/components/sistema";

/**
 * Peças visuais do Laboratório (redesenho v4, 15/11/2026): o que as
 * referências têm e se repete nas abas e no canvas. Só aparência; nenhuma
 * regra mora aqui.
 *
 * - `tom`: a cor do tipo de nó (hex) em transparência, para pastel de fundo.
 * - `CirculoDoIcone`: ícone dentro de círculo (pastel na cor do tipo, neutro ou de tinta).
 * - `HACHURA`: listras diagonais leves para zona vazia ou reservada.
 * - `PASTEIS`: a família de pastéis das referências, na ordem em que os cartões alternam.
 */

/** "#22c55e" + 0.14 → "rgba(34,197,94,0.14)". Cor fora do padrão volta como veio. */
export function tom(cor: string, alfa: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((cor || "").trim());
  if (!m) return cor;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alfa})`;
}

/** Listras diagonais (2 px a cada 8 px) na cor do texto apagado: zona vazia, reservada ou "ainda não". */
export const HACHURA: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(135deg, hsl(var(--muted-foreground) / 0.12) 0 2px, transparent 2px 8px)",
};

/** Pastéis de categoria (lilás, azul, pêssego, amarelo, rosa, verde): o cartão alterna por posição ou por nome. */
export const PASTEIS = ["#8b5cf6", "#0ea5e9", "#f97316", "#eab308", "#ec4899", "#22c55e"] as const;

/** Um pastel estável para um texto (mesmo nome, mesma cor). */
export function pastelDe(chave: string): string {
  let h = 0;
  for (let i = 0; i < chave.length; i += 1) h = (h * 31 + chave.charCodeAt(i)) % 9973;
  return PASTEIS[h % PASTEIS.length];
}

const TAMANHO = { sm: "h-8 w-8", md: "h-10 w-10", lg: "h-11 w-11" } as const;

/**
 * Ícone em círculo. Com `cor` (hex do tipo de nó), o fundo é o pastel dela e
 * o ícone sai na própria cor; `tinta` é o círculo preto (claro no escuro);
 * sem nada, o círculo neutro.
 */
export function CirculoDoIcone({
  cor,
  tinta = false,
  tamanho = "md",
  className = "",
  children,
}: {
  cor?: string;
  tinta?: boolean;
  tamanho?: keyof typeof TAMANHO;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      aria-hidden="true"
      className={juntar("inline-flex shrink-0 items-center justify-center rounded-full", TAMANHO[tamanho], tinta ? "bg-foreground text-background" : cor ? "" : "bg-muted text-foreground", className)}
      style={cor && !tinta ? { backgroundColor: tom(cor, 0.16), color: cor } : undefined}
    >
      {children}
    </span>
  );
}

/** Botão de tinta (preto no claro, claro no escuro): a ação forte do cartão, como o "Continue" das referências. */
export const botaoDeTinta =
  "toque-compacto inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-foreground px-4 text-[13px] font-medium text-background transition-colors hover:bg-foreground/85 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

/** Botão-ícone em círculo com fundo próprio (40 px): barra do editor, cabeçalho. */
export const botaoEmCirculo =
  "toque-compacto inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted/70 text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

/** Zona vazia das referências: cartão hachurado, ícone em círculo, uma frase e uma ação. */
export function ZonaVazia({ icone, titulo, descricao, acao, className = "", ...rest }: { icone: ReactNode; titulo: string; descricao?: string; acao?: ReactNode; className?: string } & Record<`data-${string}`, string | undefined>) {
  return (
    <div className={juntar("flex min-w-0 flex-col items-center justify-center rounded-[24px] border border-dashed border-border px-6 py-10 text-center", className)} style={HACHURA} {...rest}>
      <span aria-hidden="true" className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-full bg-card text-foreground shadow-card">
        {icone}
      </span>
      <p className="text-[15px] font-semibold leading-5 text-foreground">{titulo}</p>
      {descricao ? <p className="mt-1 max-w-[42ch] text-[13px] leading-5 text-muted-foreground">{descricao}</p> : null}
      {acao ? <div className="mt-4">{acao}</div> : null}
    </div>
  );
}
