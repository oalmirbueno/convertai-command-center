import { useState } from "react";
import { Check, ChevronDown, Shuffle } from "lucide-react";
import { FRAMEWORKS, resumoDaEscolha, TIPOS_DE_CONTEUDO, type EscolhaEditorial, type OpcaoEditorial } from "./MesConhecimento";

/**
 * Tipos de conteúdo e frameworks na geração (pedido do dono em 25/09): fechado
 * mostra só o resumo ("O agente escolhe e mescla"); aberto, duas linhas de
 * chips para marcar. Nada marcado = o agente escolhe e mescla.
 */

function Chips({
  titulo,
  opcoes,
  marcados,
  onAlternar,
  disabled,
}: {
  titulo: string;
  opcoes: OpcaoEditorial[];
  marcados: string[];
  onAlternar: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{titulo}</p>
      <div className="flex flex-wrap" role="group" aria-label={titulo}>
        {opcoes.map((o) => {
          const ativo = marcados.indexOf(o.id) >= 0;
          return (
            <button
              key={o.id}
              type="button"
              title={o.dica}
              aria-pressed={ativo}
              disabled={disabled}
              onClick={() => onAlternar(o.id)}
              className={`mb-1.5 mr-1.5 inline-flex items-center rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
                ativo ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground"
              }`}
            >
              {ativo && <Check className="mr-1 h-3 w-3 text-primary" />}
              {o.nome}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function MesEscolhaEditorial({
  valor,
  onChange,
  disabled,
  abertoInicial = false,
}: {
  valor: EscolhaEditorial;
  onChange: (v: EscolhaEditorial) => void;
  disabled?: boolean;
  abertoInicial?: boolean;
}) {
  const [aberto, setAberto] = useState(abertoInicial);
  const alternar = (campo: "tipos" | "frameworks", id: string) => {
    const lista = valor[campo];
    const nova = lista.indexOf(id) >= 0 ? lista.filter((x) => x !== id) : lista.concat([id]);
    onChange({ ...valor, [campo]: nova });
  };
  const livre = !valor.tipos.length && !valor.frameworks.length;
  return (
    <div className="min-w-0 rounded-lg border border-border bg-background" data-escolha-editorial>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full min-w-0 items-center px-3 py-2 text-left"
      >
        <Shuffle className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="mr-1.5 shrink-0 text-[12px] font-medium">Tipos e frameworks</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">{resumoDaEscolha(valor)}</span>
        <ChevronDown className={`ml-1 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${aberto ? "rotate-180" : ""}`} />
      </button>
      {aberto && (
        <div className="space-y-2 border-t border-border px-3 pb-2 pt-2.5">
          <Chips titulo="Tipos de conteúdo" opcoes={TIPOS_DE_CONTEUDO} marcados={valor.tipos} onAlternar={(id) => alternar("tipos", id)} disabled={disabled} />
          <Chips titulo="Frameworks" opcoes={FRAMEWORKS} marcados={valor.frameworks} onAlternar={(id) => alternar("frameworks", id)} disabled={disabled} />
          <p className="text-[11px] leading-snug text-muted-foreground">
            {livre
              ? "Nada marcado: o agente escolhe e mescla o tipo e o framework de cada conteúdo. Carrossel distribui o framework nas lâminas; estático é uma mensagem com um CTA."
              : "O agente distribui os conteúdos entre o que você marcou."}
            {!livre && (
              <button type="button" onClick={() => onChange({ tipos: [], frameworks: [] })} className="ml-1 font-medium text-primary hover:underline" disabled={disabled}>
                Deixar o agente escolher
              </button>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
