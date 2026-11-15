import type { ReactNode } from "react";
import { StatCard, StatusDot, type Tone } from "@/components/ds";
import { juntar } from "@/components/sistema";
import type { NumeroDaFaixa } from "@/components/sistema/FaixaDeNumeros";

const TOM_DO_PONTO: Record<NonNullable<NumeroDaFaixa["ponto"]>, Tone> = { verde: "success", info: "info", alerta: "warning", perigo: "danger", neutro: "neutral" };

/**
 * Números em cartões grandes (rodada ousada, 15/11/2026). Recebe os MESMOS
 * itens da FaixaDeNumeros do sistema, mas desenha um StatCard por número:
 * rótulo pequeno, número grande, apoio embaixo e, quando a tela tem, o
 * minigráfico (`extra`). Um cartão de tinta (`tinta`) e um sólido na cor da
 * marca (`solido`) por fileira, no máximo; passe o índice ou -1 para nenhum.
 *
 * Menos coisa por linha: 2 colunas no celular; 3 ou 4 só quando há largura.
 * Só mostra o que a tela já calculou (nada de número novo aqui).
 */
export default function NumerosOusados({
  itens,
  rotulo,
  colunas,
  tamanho = "grande",
  tinta = 0,
  solido = -1,
  className = "",
  ...resto
}: {
  itens: NumeroDaFaixa[];
  /** Nome do grupo para leitor de tela. */
  rotulo?: string;
  /** Colunas na tela larga (padrão: pela quantidade de números, até 4). */
  colunas?: 2 | 3 | 4;
  /** grande: número de até 40 px. compacto: até 28 px (dentro de cartão ou janela). */
  tamanho?: "grande" | "compacto";
  /** Qual número vira o cartão de tinta (padrão: o primeiro). -1 para nenhum. */
  tinta?: number;
  /** Qual número vira o cartão sólido na cor da marca. -1 para nenhum. */
  solido?: number;
  className?: string;
} & Record<`data-${string}`, string | undefined>) {
  const n = itens.length;
  const c = colunas || (n <= 2 ? 2 : n === 3 || n === 5 || n === 6 || n === 9 ? 3 : 4);
  const grade = c === 2 ? "grid-cols-2" : c === 3 ? "grid-cols-2 lg:grid-cols-3" : "grid-cols-2 xl:grid-cols-4";
  // Ímpar em duas colunas (celular): o último ocupa a linha, sem buraco.
  const sobra = n % 2 === 1 && n > 1 ? (c === 3 ? (n % 3 === 0 ? "max-lg:col-span-2" : "col-span-2 lg:col-span-1") : c === 4 ? "max-xl:col-span-2" : "col-span-2") : "";
  return (
    <div role="group" aria-label={rotulo} className={juntar("grid min-w-0 gap-3 sm:gap-5", grade, className)} {...resto}>
      {itens.map((item, i) => {
        const variante = i === tinta ? "ink" : i === solido ? "accent" : "default";
        // No cartão de destaque a cor do valor é a do cartão (o token troca sozinho).
        const valor: ReactNode = item.corDoValor && variante === "default" && (typeof item.valor === "string" || typeof item.valor === "number")
          ? <span className={item.corDoValor}>{item.valor}</span>
          : item.valor;
        return (
          <StatCard
            key={item.chave || item.rotulo}
            variant={variante}
            size={tamanho === "compacto" ? "md" : "lg"}
            label={item.ponto && variante === "default" ? <><StatusDot tone={TOM_DO_PONTO[item.ponto]} className="mr-1.5" />{item.rotulo}</> : item.rotulo}
            help={!item.para && !item.aoClicar ? item.dica : undefined}
            value={valor}
            hint={item.apoio || undefined}
            corner={item.lado || item.aoLado || undefined}
            chart={item.extra || undefined}
            to={item.para}
            onClick={item.para ? undefined : item.aoClicar}
            className={juntar(i === n - 1 && sobra, tamanho === "compacto" && "p-4 sm:p-5")}
          />
        );
      })}
    </div>
  );
}
