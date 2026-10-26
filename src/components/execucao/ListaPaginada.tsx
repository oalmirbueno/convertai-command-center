import { useState, type ReactNode } from "react";
import { botao, juntar } from "@/components/sistema";

/**
 * 26/10/2026 (dono: "quando eu clico em Trabalho, nossa, ela pesa, trava"): a Execução desenhava
 * de uma vez os 300 vínculos (e as 200 execuções), cada um com o detalhe montado. A lista mostra
 * um lote e o resto entra por "Mostrar mais"; o item em destaque (link de notificação) entra
 * sempre, mesmo que esteja depois do lote.
 *
 * É um componente de tipo estável (fora da tela): o lote aberto e o "ver mais" de cada cartão não
 * se perdem quando a tela atualiza os dados a cada poucos segundos.
 */
export default function ListaPaginada<T>({
  itens, chave, desenhar, passo = 40, rotulo, className, classeDoItem, garantir,
}: {
  itens: readonly T[];
  chave: (item: T) => string;
  desenhar: (item: T) => ReactNode;
  passo?: number;
  rotulo: string;
  className?: string;
  classeDoItem?: string;
  /** O item que precisa aparecer mesmo depois do lote (ex.: o vínculo da notificação). */
  garantir?: (item: T) => boolean;
}) {
  const [limite, setLimite] = useState(passo);
  const posicaoGarantida = garantir ? itens.findIndex(garantir) : -1;
  const ate = Math.max(limite, posicaoGarantida + 1);
  const visiveis = itens.length > ate ? itens.slice(0, ate) : itens;
  const faltam = itens.length - visiveis.length;
  return (
    <>
      <ul className={className} aria-label={rotulo} data-lista-paginada="">
        {visiveis.map((item) => (
          <li key={chave(item)} className={classeDoItem}>
            {desenhar(item)}
          </li>
        ))}
      </ul>
      {faltam > 0 && (
        <button
          type="button"
          onClick={() => setLimite(ate + passo)}
          className={juntar(botao.secundario, "mt-2.5 h-9 w-full px-3 text-[12px]")}
        >
          Mostrar mais {Math.min(passo, faltam)} de {faltam}
        </button>
      )}
    </>
  );
}
