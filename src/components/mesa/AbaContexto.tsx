import { useState } from "react";
import ContextoMarca from "./ContextoMarca";
import ContextoFontes from "./ContextoFontes";
import ContextoReferencias from "./ContextoReferencias";
import ContextoRosto from "./ContextoRosto";
import { MemoriaDoAgente, PromptDoCliente } from "./ContextoAgente";

const PARTES = [
  { valor: "marca", rotulo: "Marca", dica: "Paleta, logo, estilo e regras." },
  { valor: "fontes", rotulo: "Fontes", dica: "Arquivos da fonte com amostra para o gerador." },
  { valor: "referencias", rotulo: "Referências", dica: "Peças que mostram o nível e a técnica que o cliente quer." },
  { valor: "rosto", rotulo: "Rosto", dica: "Pessoas reais que podem aparecer, com autorização." },
  { valor: "prompt", rotulo: "Prompt", dica: "O que vale só para este cliente, por cima do prompt global." },
  { valor: "memoria", rotulo: "Memória", dica: "O que os agentes aprenderam com este cliente." },
] as const;

type Parte = (typeof PARTES)[number]["valor"];

/** Contexto do cliente: uma parte por vez, na ordem em que o agente usa. */
export default function AbaContexto() {
  const [parte, setParte] = useState<Parte>("marca");
  const atual = PARTES.find((p) => p.valor === parte)!;
  return (
    <div className="space-y-5">
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
    </div>
  );
}
