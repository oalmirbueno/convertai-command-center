import { useEffect, useRef, useState, type CSSProperties } from "react";
import AgenteDeContexto from "./AgenteDeContexto";
import ContextoAutomatico from "./ContextoAutomatico";
import ContextoMarca from "./ContextoMarca";
import ContextoFontes from "./ContextoFontes";
import ContextoImagens from "./ContextoImagens";
import ContextoReferencias from "./ContextoReferencias";
import ContextoRosto from "./ContextoRosto";
import { MemoriaDoAgente, PromptDoCliente } from "./ContextoAgente";

const PARTES = [
  { valor: "marca", rotulo: "Marca", dica: "Paleta, logo, estilo e regras." },
  { valor: "fontes", rotulo: "Fontes", dica: "Fontes do cliente: enviadas por arquivo ou escolhidas na biblioteca da agência." },
  { valor: "imagens", rotulo: "Imagens", dica: "Fotos reais do cliente, organizadas por categoria e pasta. O Estúdio usa como base das lâminas." },
  { valor: "referencias", rotulo: "Referências", dica: "Peças que mostram o nível e a técnica que o cliente quer." },
  { valor: "rosto", rotulo: "Rosto", dica: "Pessoas reais que podem aparecer, com autorização." },
  { valor: "prompt", rotulo: "Prompt", dica: "O que vale só para este cliente, por cima do prompt global." },
  { valor: "memoria", rotulo: "Memória", dica: "O que os agentes aprenderam com este cliente." },
] as const;

export type ParteDoContexto = (typeof PARTES)[number]["valor"];

/** Os editores de cada parte do contexto: uma parte por vez. */
function DetalhesDoContexto({ parte, onParte }: { parte: ParteDoContexto; onParte: (p: ParteDoContexto) => void }) {
  const atual = PARTES.find((p) => p.valor === parte) || PARTES[0];
  return (
    <section className="min-w-0 space-y-4 rounded-xl border border-border bg-card p-3.5 sm:p-4">
      <div className="min-w-0">
        <h2 className="text-[13px] font-semibold text-foreground">Editar em detalhe</h2>
        <p className="text-[11.5px] text-muted-foreground [overflow-wrap:anywhere]">{atual.dica}</p>
      </div>
      <div role="tablist" aria-label="Partes do contexto" className="-mx-1 flex min-w-0 overflow-x-auto px-1 pb-0.5">
        {PARTES.map((p) => (
          <button
            key={p.valor}
            type="button"
            role="tab"
            onClick={() => onParte(p.valor)}
            aria-selected={parte === p.valor}
            className={`mr-1.5 shrink-0 rounded-full border px-3 py-1.5 text-[12px] transition-colors ${
              parte === p.valor ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {p.rotulo}
          </button>
        ))}
      </div>
      <div className="min-w-0">
        {parte === "marca" && <ContextoMarca />}
        {parte === "fontes" && <ContextoFontes />}
        {parte === "imagens" && <ContextoImagens />}
        {parte === "referencias" && <ContextoReferencias />}
        {parte === "rosto" && <ContextoRosto />}
        {parte === "prompt" && <PromptDoCliente />}
        {parte === "memoria" && <MemoriaDoAgente />}
      </div>
    </section>
  );
}

/** Altura do cabeçalho fixo da Mesa (cabeçalho do painel + barra de custo e etapas). */
const TOPO_PADRAO = 200;

/**
 * Onde a coluna do agente gruda ao rolar: logo abaixo do cabeçalho fixo da
 * Mesa. Mede o cabeçalho (top + altura) em vez de chutar, porque a barra de
 * custo quebra em duas linhas em telas menores. Sem ResizeObserver (Safari 11):
 * mede ao montar, ao redimensionar e uma vez depois que as fontes carregam.
 */
function useTopoFixo() {
  const [topo, setTopo] = useState(TOPO_PADRAO);
  useEffect(() => {
    const medir = () => {
      const cabecalho = document.querySelector("header.sticky") as HTMLElement | null;
      if (!cabecalho) return;
      const top = parseFloat(window.getComputedStyle(cabecalho).top || "0") || 0;
      const valor = Math.round(top + cabecalho.offsetHeight + 16);
      if (valor > 40 && valor < 600) setTopo(valor);
    };
    medir();
    const t = window.setTimeout(medir, 600);
    window.addEventListener("resize", medir);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("resize", medir);
    };
  }, []);
  return topo;
}

/**
 * Contexto do cliente: a Mesa puxa sozinha o que o cliente já tem (documentos,
 * dossiê, artes aprovadas, referências), monta o contexto uma vez e deixa o
 * agente ao lado, fixo e da altura da tela, para completar e corrigir
 * conversando. Os editores completos ficam em "Editar em detalhe".
 */
export default function AbaContexto() {
  const [parte, setParte] = useState<ParteDoContexto>("marca");
  const detalhes = useRef<HTMLDivElement>(null);
  const topo = useTopoFixo();

  const irPara = (p: ParteDoContexto) => {
    setParte(p);
    window.setTimeout(() => {
      const el = detalhes.current;
      if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  return (
    <div className="space-y-6">
      <div
        className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start xl:grid-cols-[minmax(0,1fr)_360px]"
        style={{ "--topo-da-mesa": `${topo}px` } as CSSProperties}
      >
        <div className="min-w-0">
          <ContextoAutomatico onIrPara={irPara} />
        </div>
        <aside
          aria-label="Agente de contexto"
          className="min-w-0 lg:sticky lg:top-[var(--topo-da-mesa)] lg:h-[calc(100vh_-_var(--topo-da-mesa)_-_16px)] lg:min-h-[420px]"
        >
          <AgenteDeContexto preencher />
        </aside>
      </div>
      <div ref={detalhes} className="min-w-0 scroll-mt-36 md:scroll-mt-52">
        <DetalhesDoContexto parte={parte} onParte={setParte} />
      </div>
    </div>
  );
}
