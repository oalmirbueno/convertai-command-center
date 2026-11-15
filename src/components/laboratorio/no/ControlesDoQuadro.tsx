import { useEffect, useRef, useState } from "react";
import { Panel, useReactFlow } from "@xyflow/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fullscreen, Lock, LockOpen, Map as IconeDoMapa, Minimize2, Minus, Plus, Scan, SlidersHorizontal, Zap } from "lucide-react";
import { toast } from "sonner";
import { botao, campo, juntar, texto } from "@/components/sistema";
import { textoDoErro } from "@/lib/mesa/api";
import { autoAteUsdValido, lerConfigDoProjeto, salvarConfigDoProjeto } from "@/lib/laboratorio/api";
import { LEITURA_PADRAO, type LeituraDoQuadro } from "./visualDoQuadro";

export function OpcoesDeLeitura({ leitura, onLeitura, temSelecao }: { leitura: LeituraDoQuadro; onLeitura: (valor: LeituraDoQuadro) => void; temSelecao: boolean }) {
  return (
    <div className="nodrag nopan nowheel absolute bottom-full left-1/2 mb-2 w-[232px] max-w-[calc(100vw-88px)] -translate-x-1/2 space-y-3 rounded-[20px] border border-border bg-popover p-3 text-[14px] text-popover-foreground shadow-pop" role="group" aria-label="Leitura das conexões">
      <label className="block space-y-1">
        <span className="font-medium">Conexões</span>
        <select className={juntar(campo, "h-9 text-[14px]")} value={leitura.foco} onChange={(e) => onLeitura({ ...leitura, foco: e.target.value as LeituraDoQuadro["foco"] })}>
          <option value="todas">Todas</option>
          <option value="selecionado">Só do nó selecionado</option>
          <option value="ocultas">Ocultar</option>
        </select>
      </label>
      <label className="block space-y-1">
        <span className="font-medium">Intensidade das linhas</span>
        <select className={juntar(campo, "h-9 text-[14px]")} value={leitura.intensidade} onChange={(e) => onLeitura({ ...leitura, intensidade: e.target.value as LeituraDoQuadro["intensidade"] })}>
          <option value="suave">Quase transparentes</option>
          <option value="discreta">Discretas</option>
          <option value="normal">Mais visíveis</option>
        </select>
      </label>
      {leitura.foco === "selecionado" && !temSelecao ? <p className="text-[12px] leading-relaxed text-muted-foreground">Selecione um nó para ver suas conexões.</p> : null}
    </div>
  );
}

/**
 * v4 (15/11/2026): a pílula deitou e foi para o centro do rodapé do quadro,
 * como a barra flutuante das referências: zoom (menos, 100%, mais), ajustar e
 * tela cheia, um traço, e os modos (conexões, travar, mini-mapa, automático);
 * o que está ligado fica num círculo de tinta. As janelinhas abrem para cima.
 *
 * Controles do quadro numa pílula flutuante: aumentar, diminuir,
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
    <div ref={ref} className="nodrag nopan absolute bottom-full left-1/2 mb-2 w-[232px] -translate-x-1/2 rounded-[20px] border border-border bg-popover p-3 text-popover-foreground" style={{ boxShadow: "0 12px 32px -10px rgba(0,0,0,0.45)" }} data-teto-do-automatico="">
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
  leitura = LEITURA_PADRAO,
  onLeitura,
  temSelecao = false,
}: {
  travado: boolean;
  onTravar: (v: boolean) => void;
  mapa: boolean;
  onMapa: (v: boolean) => void;
  soCanvas?: boolean;
  onSoCanvas?: () => void;
  projetoId?: string;
  leitura?: LeituraDoQuadro;
  onLeitura?: (valor: LeituraDoQuadro) => void;
  temSelecao?: boolean;
}) {
  const rf = useReactFlow();
  const [teto, setTeto] = useState(false);
  const [ler, setLer] = useState(false);
  const painel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ler) return;
    const fechar = (e: MouseEvent) => { if (e.target instanceof Node && !painel.current?.contains(e.target)) setLer(false); };
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") setLer(false); };
    document.addEventListener("mousedown", fechar);
    document.addEventListener("keydown", tecla);
    return () => { document.removeEventListener("mousedown", fechar); document.removeEventListener("keydown", tecla); };
  }, [ler]);
  const acao = juntar(botao.icone, "h-9 w-9 rounded-full");
  const ligado = "bg-foreground text-background hover:bg-foreground/85 hover:text-background";
  const tentar = (fn: () => unknown) => {
    try {
      void fn();
    } catch {
      /* quadro ainda sem medida */
    }
  };
  const traco = <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden="true" />;
  return (
    <Panel position="bottom-center" className="!m-3 max-w-[calc(100%-24px)]">
      <div className="relative" ref={painel}>
        <div
          role="toolbar"
          aria-label="Controles do quadro"
          aria-orientation="horizontal"
          className="nodrag nopan scrollbar-hidden flex max-w-full items-center overflow-x-auto rounded-full border border-border bg-popover p-1 text-popover-foreground"
          style={{ boxShadow: "0 8px 24px -8px rgba(0,0,0,0.18)" }}
          data-controles-do-quadro=""
        >
          <button type="button" className={acao} onClick={() => tentar(() => rf.zoomOut({ duration: 200 }))} aria-label="Diminuir" title="Diminuir">
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" className={juntar(acao, "w-11")} onClick={() => tentar(() => rf.zoomTo(1, { duration: 250 }))} aria-label="Ler em tamanho real" title="Ler em tamanho real (100%)"><span className="text-[11px] font-semibold tabular-nums">100%</span></button>
          <button type="button" className={acao} onClick={() => tentar(() => rf.zoomIn({ duration: 200 }))} aria-label="Aumentar" title="Aumentar">
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
          {traco}
          <button type="button" className={acao} onClick={() => tentar(() => rf.fitView({ padding: 0.15, maxZoom: 1, duration: 300 }))} aria-label="Ajustar à tela" title="Ajustar à tela">
            <Scan className="h-4 w-4" aria-hidden="true" />
          </button>
          {onSoCanvas ? (
            <button
              type="button"
              className={juntar(acao, soCanvas && ligado)}
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
          {traco}
          {onLeitura ? <button type="button" className={juntar(acao, ler && ligado)} aria-label="Aparência das conexões" aria-expanded={ler} title="Aparência das conexões" onClick={() => { setLer(!ler); setTeto(false); }}><SlidersHorizontal className="h-4 w-4" aria-hidden="true" /></button> : null}
          <button
            type="button"
            className={juntar(acao, travado && ligado)}
            onClick={() => onTravar(!travado)}
            aria-pressed={travado}
            aria-label={travado ? "Destravar o quadro" : "Travar o quadro"}
            title={travado ? "Destravar o quadro (mover e ligar de novo)" : "Travar o quadro (não move nem liga)"}
          >
            {travado ? <Lock className="h-4 w-4" aria-hidden="true" /> : <LockOpen className="h-4 w-4" aria-hidden="true" />}
          </button>
          <button
            type="button"
            className={juntar(acao, mapa && ligado)}
            onClick={() => onMapa(!mapa)}
            aria-pressed={mapa}
            aria-label={mapa ? "Esconder o mini-mapa" : "Mostrar o mini-mapa"}
            title={mapa ? "Esconder o mini-mapa" : "Mostrar o mini-mapa"}
          >
            <IconeDoMapa className="h-4 w-4" aria-hidden="true" />
          </button>
          {projetoId ? (
            <button type="button" className={juntar(acao, teto && ligado)} onClick={() => { setTeto(!teto); setLer(false); }} aria-pressed={teto} aria-label="Rodar sozinho até" title="Automático: rodar sozinho até US$ X por nó" data-abrir-teto-auto="">
              <Zap className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {teto && projetoId ? <TetoDoAutomatico projetoId={projetoId} onFechar={() => setTeto(false)} /> : null}
        {ler && onLeitura ? <OpcoesDeLeitura leitura={leitura} onLeitura={onLeitura} temSelecao={temSelecao} /> : null}
      </div>
    </Panel>
  );
}
