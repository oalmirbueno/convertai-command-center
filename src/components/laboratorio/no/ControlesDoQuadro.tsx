import { useEffect, useRef, useState } from "react";
import { Panel, useReactFlow } from "@xyflow/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fullscreen, Lock, LockOpen, Map as IconeDoMapa, Minimize2, Minus, Plus, Scan, Zap } from "lucide-react";
import { toast } from "sonner";
import { botao, campo, juntar, texto } from "@/components/sistema";
import { textoDoErro } from "@/lib/mesa/api";
import { autoAteUsdValido, lerConfigDoProjeto, salvarConfigDoProjeto } from "@/lib/laboratorio/api";

/**
 * Controles do quadro numa pílula vertical flutuante: aumentar, diminuir,
 * ajustar à tela, tela cheia do canvas ("só o canvas" do editor), travar
 * (não move nem liga), mini-mapa e o teto do automático ("Rodar sozinho até
 * US$ X por nó", config.auto_ate_usd do projeto; 0 = sempre pergunta).
 * Cores do tema: aparece no claro e no escuro.
 */

function TetoDoAutomatico({ projetoId, onFechar }: { projetoId: string; onFechar: () => void }) {
  const qc = useQueryClient();
  const chave = ["laboratorio", "config-do-projeto", projetoId];
  const q = useQuery({ queryKey: chave, queryFn: () => lerConfigDoProjeto(projetoId), enabled: !!projetoId, retry: false, staleTime: 60_000 });
  const [valor, setValor] = useState<string>("");
  useEffect(() => {
    if (q.data && valor === "") setValor(String(q.data.auto_ate_usd));
  }, [q.data, valor]);
  const salvar = useMutation({
    mutationFn: (v: number) => salvarConfigDoProjeto(projetoId, { auto_ate_usd: v }),
    onSuccess: (r) => {
      qc.setQueryData(chave, r);
      toast.success(r.auto_ate_usd > 0 ? `Roda sozinho até US$ ${r.auto_ate_usd.toFixed(2).replace(".", ",")} por nó` : "O automático sempre pergunta o custo");
      onFechar();
    },
    onError: (e) => toast.error("Não deu para salvar o teto", { description: textoDoErro(e) }),
  });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fora = (e: MouseEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) onFechar();
    };
    const id = window.setTimeout(() => document.addEventListener("mousedown", fora), 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", fora);
    };
  }, [onFechar]);
  return (
    <div ref={ref} className="nodrag nopan absolute bottom-0 left-12 w-[232px] rounded-xl border border-border bg-popover p-3 text-popover-foreground" style={{ boxShadow: "0 12px 32px -10px rgba(0,0,0,0.45)" }} data-teto-do-automatico="">
      <label htmlFor={`teto-auto-${projetoId}`} className={juntar(texto.rotulo, "mb-1 block")}>
        Rodar sozinho até (US$ por nó)
      </label>
      <input
        id={`teto-auto-${projetoId}`}
        type="number"
        min={0}
        max={5}
        step={0.25}
        className={campo}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") salvar.mutate(autoAteUsdValido(valor));
        }}
      />
      <p className={juntar(texto.auxiliar, "mt-1")}>0 = sempre pergunta o custo. Máximo 5.</p>
      <button type="button" className={juntar(botao.primario, "mt-2 h-8 w-full")} onClick={() => salvar.mutate(autoAteUsdValido(valor))} disabled={salvar.isPending}>
        Salvar
      </button>
    </div>
  );
}

export default function ControlesDoQuadro({
  travado,
  onTravar,
  mapa,
  onMapa,
  soCanvas = false,
  onSoCanvas,
  projetoId = "",
}: {
  travado: boolean;
  onTravar: (v: boolean) => void;
  mapa: boolean;
  onMapa: (v: boolean) => void;
  soCanvas?: boolean;
  onSoCanvas?: () => void;
  projetoId?: string;
}) {
  const rf = useReactFlow();
  const [teto, setTeto] = useState(false);
  const acao = juntar(botao.icone, "h-8 w-8 rounded-full");
  const tentar = (fn: () => unknown) => {
    try {
      void fn();
    } catch {
      /* quadro ainda sem medida */
    }
  };
  return (
    <Panel position="bottom-left" className="!m-3">
      <div className="relative">
        <div
          role="toolbar"
          aria-label="Controles do quadro"
          aria-orientation="vertical"
          className="nodrag nopan flex flex-col items-center rounded-full border border-border bg-popover p-1 text-popover-foreground"
          style={{ boxShadow: "0 6px 20px -8px rgba(0,0,0,0.35)" }}
          data-controles-do-quadro=""
        >
          <button type="button" className={acao} onClick={() => tentar(() => rf.zoomIn({ duration: 200 }))} aria-label="Aumentar" title="Aumentar">
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" className={acao} onClick={() => tentar(() => rf.zoomOut({ duration: 200 }))} aria-label="Diminuir" title="Diminuir">
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" className={acao} onClick={() => tentar(() => rf.fitView({ padding: 0.15, maxZoom: 1, duration: 300 }))} aria-label="Ajustar à tela" title="Ajustar à tela">
            <Scan className="h-4 w-4" aria-hidden="true" />
          </button>
          {onSoCanvas ? (
            <button
              type="button"
              className={juntar(acao, soCanvas && "bg-muted text-foreground")}
              onClick={onSoCanvas}
              aria-pressed={soCanvas}
              // Nome diferente do botão da barra do editor ("Canvas em tela cheia"): os dois convivem.
              aria-label={soCanvas ? "Sair da tela cheia do canvas" : "Tela cheia do canvas"}
              title={soCanvas ? "Sair da tela cheia do canvas (Esc)" : "Canvas em tela cheia: só o quadro, de ponta a ponta"}
              data-tela-cheia-do-canvas=""
            >
              {soCanvas ? <Minimize2 className="h-4 w-4" aria-hidden="true" /> : <Fullscreen className="h-4 w-4" aria-hidden="true" />}
            </button>
          ) : null}
          <span className="my-0.5 h-px w-4 bg-border" aria-hidden="true" />
          <button
            type="button"
            className={juntar(acao, travado && "bg-muted text-foreground")}
            onClick={() => onTravar(!travado)}
            aria-pressed={travado}
            aria-label={travado ? "Destravar o quadro" : "Travar o quadro"}
            title={travado ? "Destravar o quadro (mover e ligar de novo)" : "Travar o quadro (não move nem liga)"}
          >
            {travado ? <Lock className="h-4 w-4" aria-hidden="true" /> : <LockOpen className="h-4 w-4" aria-hidden="true" />}
          </button>
          <button
            type="button"
            className={juntar(acao, mapa && "bg-muted text-foreground")}
            onClick={() => onMapa(!mapa)}
            aria-pressed={mapa}
            aria-label={mapa ? "Esconder o mini-mapa" : "Mostrar o mini-mapa"}
            title={mapa ? "Esconder o mini-mapa" : "Mostrar o mini-mapa"}
          >
            <IconeDoMapa className="h-4 w-4" aria-hidden="true" />
          </button>
          {projetoId ? (
            <button type="button" className={juntar(acao, teto && "bg-muted text-foreground")} onClick={() => setTeto(!teto)} aria-pressed={teto} aria-label="Rodar sozinho até" title="Automático: rodar sozinho até US$ X por nó" data-abrir-teto-auto="">
              <Zap className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {teto && projetoId ? <TetoDoAutomatico projetoId={projetoId} onFechar={() => setTeto(false)} /> : null}
      </div>
    </Panel>
  );
}
