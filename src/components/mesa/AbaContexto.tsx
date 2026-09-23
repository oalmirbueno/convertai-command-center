import { useRef, useState } from "react";
import AgenteDeContexto from "./AgenteDeContexto";
import ContextoAutomatico from "./ContextoAutomatico";
import ContextoMarca from "./ContextoMarca";
import ContextoFontes from "./ContextoFontes";
import ContextoImagens from "./ContextoImagens";
import ContextoReferencias from "./ContextoReferencias";
import ContextoRosto from "./ContextoRosto";
import { MemoriaDoAgente, PromptDoCliente } from "./ContextoAgente";
import { TituloDeSecao } from "./Seletores";

const PARTES = [
  { valor: "marca", rotulo: "Marca", dica: "Paleta, logo, estilo e regras." },
  { valor: "fontes", rotulo: "Fontes", dica: "Arquivos da fonte com amostra para o gerador." },
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
    <section className="min-w-0 space-y-4">
      <TituloDeSecao>Detalhes</TituloDeSecao>
      <div className="flex flex-wrap">
        {PARTES.map((p) => (
          <button
            key={p.valor}
            type="button"
            onClick={() => onParte(p.valor)}
            aria-pressed={parte === p.valor}
            className={`mb-1.5 mr-1.5 rounded-full border px-3 py-1.5 text-[12px] transition-colors ${
              parte === p.valor ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {p.rotulo}
          </button>
        ))}
      </div>
      <p className="text-[12px] text-muted-foreground">{atual.dica}</p>
      {parte === "marca" && <ContextoMarca />}
      {parte === "fontes" && <ContextoFontes />}
      {parte === "imagens" && <ContextoImagens />}
      {parte === "referencias" && <ContextoReferencias />}
      {parte === "rosto" && <ContextoRosto />}
      {parte === "prompt" && <PromptDoCliente />}
      {parte === "memoria" && <MemoriaDoAgente />}
    </section>
  );
}

/**
 * Contexto do cliente: a Mesa puxa sozinha o que o cliente já tem (documentos,
 * dossiê, artes aprovadas, referências), monta o contexto uma vez e deixa um
 * agente ao lado para completar e corrigir conversando. A lista do que falta
 * leva direto ao editor certo em Detalhes.
 */
export default function AbaContexto() {
  const [parte, setParte] = useState<ParteDoContexto>("marca");
  const detalhes = useRef<HTMLDivElement>(null);

  const irPara = (p: ParteDoContexto) => {
    setParte(p);
    window.setTimeout(() => {
      const el = detalhes.current;
      if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <div className="min-w-0">
          <ContextoAutomatico onIrPara={irPara} />
        </div>
        <div className="min-w-0 lg:sticky lg:top-4 lg:self-start">
          <AgenteDeContexto />
        </div>
      </div>
      <div ref={detalhes} className="min-w-0 scroll-mt-40">
        <DetalhesDoContexto parte={parte} onParte={setParte} />
      </div>
    </div>
  );
}
