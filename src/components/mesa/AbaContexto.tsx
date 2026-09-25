import { useEffect, useRef, useState, type CSSProperties } from "react";
import AgenteDeContexto from "./AgenteDeContexto";
import ContextoAutomatico from "./ContextoAutomatico";
import ContextoMarca from "./ContextoMarca";
import ContextoKitDaMarca from "./ContextoKitDaMarca";
import { useMarcaDaMesa } from "./MesaContexto";
import ContextoFontes from "./ContextoFontes";
import ContextoImagens from "./ContextoImagens";
import ContextoReferencias from "./ContextoReferencias";
import ContextoRosto from "./ContextoRosto";
import { MemoriaDoAgente, PromptDoCliente } from "./ContextoAgente";
import { Hub, useHubsAbertos } from "./ContextoHub";
import { fimDoCabecalhoFixo } from "./EstudioAltura";

/** O editor em detalhe começa recolhido; os atalhos "Editar" abrem na parte certa. */
const DETALHES_DE_INICIO: Record<string, boolean> = {};

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
  // Marca por projeto: com outra marca aberta no topo (ex.: CME), a parte Marca edita o kit dela.
  const { marca } = useMarcaDaMesa();
  const outraMarca = marca && !marca.principal ? marca : null;
  return (
    <div className="min-w-0 space-y-3">
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
      <p className="text-[11.5px] text-muted-foreground [overflow-wrap:anywhere]">{atual.dica}</p>
      <div className="min-w-0">
        {parte === "marca" && (outraMarca ? <ContextoKitDaMarca marca={outraMarca} /> : <ContextoMarca />)}
        {parte === "fontes" && <ContextoFontes />}
        {parte === "imagens" && <ContextoImagens />}
        {parte === "referencias" && <ContextoReferencias />}
        {parte === "rosto" && <ContextoRosto />}
        {parte === "prompt" && <PromptDoCliente />}
        {parte === "memoria" && <MemoriaDoAgente />}
      </div>
    </div>
  );
}

/** Altura do cabeçalho fixo da Mesa (cabeçalho do painel + barra fina da Mesa). */
const TOPO_PADRAO = 150;

/**
 * Onde a coluna do agente gruda ao rolar: logo abaixo do cabeçalho fixo da
 * Mesa. Mede o cabeçalho pelo nav "Etapas da Mesa" (o mesmo que o Estúdio
 * usa) em vez de chutar, porque a barra quebra em duas linhas em telas
 * menores. Sem ResizeObserver (Safari 11): mede ao montar, ao redimensionar
 * e uma vez depois que as fontes carregam.
 */
function useTopoFixo() {
  const [topo, setTopo] = useState(TOPO_PADRAO);
  useEffect(() => {
    const medir = () => {
      const valor = Math.round(fimDoCabecalhoFixo() + 12);
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
 * conversando (ou falando no microfone). Tudo em hubs recolhíveis; os
 * editores completos ficam no último, "Editar em detalhe".
 */
export default function AbaContexto() {
  const [parte, setParte] = useState<ParteDoContexto>("marca");
  const detalhes = useRef<HTMLDivElement>(null);
  const topo = useTopoFixo();
  const hubs = useHubsAbertos(DETALHES_DE_INICIO);
  const atual = PARTES.find((p) => p.valor === parte) || PARTES[0];
  const { marca } = useMarcaDaMesa();

  const irPara = (p: ParteDoContexto) => {
    setParte(p);
    hubs.definir("ctx-detalhes", true);
    window.setTimeout(() => {
      const el = detalhes.current;
      if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  return (
    <div
      className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start xl:grid-cols-[minmax(0,1fr)_360px]"
      style={{ "--topo-da-mesa": `${topo}px` } as CSSProperties}
    >
      <div className="min-w-0 space-y-3">
        {marca && !marca.principal && (
          <div className="flex min-w-0 flex-wrap items-center rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 text-[12.5px]" data-aviso-da-marca="">
            <p className="mr-3 min-w-0 flex-1 [overflow-wrap:anywhere]">
              Marca <strong>{marca.nome}</strong> aberta: logo, cores, estilo e referências dela ficam em Editar em detalhe, Marca. Documentos, dossiê e o agente ao lado são do cliente.
            </p>
            <button type="button" onClick={() => irPara("marca")} className="mt-1 shrink-0 rounded-lg bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground sm:mt-0">
              Editar o kit da {marca.nome}
            </button>
          </div>
        )}
        <ContextoAutomatico onIrPara={irPara} />
        <div ref={detalhes} className="min-w-0 scroll-mt-28 md:scroll-mt-40">
          <Hub
            id="ctx-detalhes"
            titulo="Editar em detalhe"
            resumo={`Marca, fontes, imagens, referências, rosto, prompt e memória · aberto em ${atual.rotulo}`}
            aberto={hubs.aberto("ctx-detalhes")}
            onAlternar={() => hubs.alternar("ctx-detalhes")}
          >
            <DetalhesDoContexto parte={parte} onParte={setParte} />
          </Hub>
        </div>
      </div>
      <aside
        aria-label="Agente de contexto"
        className="min-w-0 lg:sticky lg:top-[var(--topo-da-mesa)] lg:h-[calc(100vh_-_var(--topo-da-mesa)_-_16px)] lg:min-h-[420px]"
      >
        <AgenteDeContexto preencher />
      </aside>
    </div>
  );
}
