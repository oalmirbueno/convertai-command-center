import { Megaphone, X } from "lucide-react";
import { useReservaFlutuante } from "@/components/sistema/useReservaFlutuante";
import { botao, campo, juntar } from "@/components/sistema/estilos";

/**
 * Barra fixa de "juntar para a campanha" (21/10/2026): aparece com 1 ou mais itens marcados no Hype ou no
 * Trending. Fica acima do botão do Agente do mês (celular e computador) e reserva espaço no fim da página.
 */
export default function BarraDeJuntar({
  quantos,
  pedido,
  onPedido,
  onCriar,
  onLimpar,
}: {
  quantos: number;
  pedido: string;
  onPedido: (v: string) => void;
  onCriar: () => void;
  onLimpar: () => void;
}) {
  useReservaFlutuante(quantos > 0, 150);
  if (quantos <= 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+140px)] z-40 flex justify-center px-3 md:bottom-[84px]" data-barra-de-juntar="">
      <form
        className="pointer-events-auto flex w-full min-w-0 max-w-2xl items-center rounded-md border border-border bg-card px-2 py-1.5 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          onCriar();
        }}
        aria-label="Juntar para criar campanha"
      >
        <span role="status" className="mr-2 shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[12px] font-semibold tabular-nums text-primary">
          {quantos} {quantos === 1 ? "selecionado" : "selecionados"}
        </span>
        <input
          className={juntar(campo, "mr-2 h-8 flex-1")}
          value={pedido}
          maxLength={1000}
          onChange={(e) => onPedido(e.target.value)}
          placeholder="Pedido (opcional): Black Friday com 30% no plano anual"
          aria-label="Pedido da campanha (opcional)"
        />
        <button type="submit" className={juntar(botao.primario, "h-8 px-3")} title="Criar campanha com os itens juntados">
          <Megaphone className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
          <span className="max-sm:sr-only">Criar campanha</span>
        </button>
        <button type="button" className={juntar(botao.icone, "ml-1")} onClick={onLimpar} aria-label="Desmarcar todos" title="Desmarcar todos">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}
