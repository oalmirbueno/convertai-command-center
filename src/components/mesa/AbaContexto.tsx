import { useState } from "react";
import AgenteDeContexto from "./AgenteDeContexto";
import ContextoAutomatico from "./ContextoAutomatico";
import ContextoMarca from "./ContextoMarca";
import ContextoFontes from "./ContextoFontes";
import ContextoReferencias from "./ContextoReferencias";
import ContextoRosto from "./ContextoRosto";
import { MemoriaDoAgente, PromptDoCliente } from "./ContextoAgente";
import { TituloDeSecao } from "./Seletores";

const PARTES = [
  { valor: "marca", rotulo: "Marca", dica: "Paleta, logo, estilo e regras." },
  { valor: "fontes", rotulo: "Fontes", dica: "Arquivos da fonte com amostra para o gerador." },
  { valor: "referencias", rotulo: "Referências", dica: "Peças que mostram o nível e a técnica que o cliente quer." },
  { valor: "rosto", rotulo: "Rosto", dica: "Pessoas reais que podem aparecer, com autorização." },
  { valor: "prompt", rotulo: "Prompt", dica: "O que vale só para este cliente, por cima do prompt global." },
  { valor: "memoria", rotulo: "Memória", dica: "O que os agentes aprenderam com este cliente." },
] as const;

type Parte = (typeof PARTES)[number]["valor"];

/** Os editores de cada parte do contexto, como já eram: uma parte por vez. */
function DetalhesDoContexto() {
  const [parte, setParte] = useState<Parte>("marca");
  const atual = PARTES.find((p) => p.valor === parte)!;
  return (
    <section className="min-w-0 space-y-4">
      <TituloDeSecao>Detalhes</TituloDeSecao>
      <div className="-mx-1 flex flex-wrap gap-1.5 px-1">
        {PARTES.map((p) => (
          <button
            key={p.valor}
            type="button"
            onClick={() => setParte(p.valor)}
            className={`rounded-full border px-3 py-1.5 text-[12px] transition-colors ${
              parte === p.valor ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {p.rotulo}
          </button>
        ))}
      </div>
      <p className="text-[12px] text-muted-foreground">{atual.dica}</p>
      {parte === "marca" && <ContextoMarca />}
      {parte === "fontes" && <ContextoFontes />}
      {parte === "referencias" && <ContextoReferencias />}
      {parte === "rosto" && <ContextoRosto />}
      {parte === "prompt" && <PromptDoCliente />}
      {parte === "memoria" && <MemoriaDoAgente />}
    </section>
  );
}

/**
 * Contexto do cliente: a Mesa puxa sozinha o que o cliente já tem (documentos,
 * dossiê, artes aprovadas, referências), monta o contexto e deixa um agente ao
 * lado para completar e corrigir conversando. Os editores ficam em Detalhes.
 */
export default function AbaContexto() {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <div className="min-w-0">
          <ContextoAutomatico />
        </div>
        <div className="min-w-0 lg:sticky lg:top-4 lg:self-start">
          <AgenteDeContexto />
        </div>
      </div>
      <DetalhesDoContexto />
    </div>
  );
}
