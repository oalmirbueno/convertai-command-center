import { useState } from "react";
import { Check, Loader2, Lock, Pencil, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { botao, campo, campoTexto, juntar, texto } from "@/components/sistema";
import { textoDoErro } from "@/lib/mesa/api";
import type { BlocoSemFonte } from "@/lib/laboratorio/nos";

/**
 * Regra contra invenção (v3, clickmax-rea.md): os blocos de prova ou número
 * que um nó escreveu sem fonte. No Pôr no ar, a lista é a trava (com o
 * motivo); em cada nó, os dele. O dono marca "fonte confirmada" (dizendo de
 * onde vem) ou edita o trecho. Só ícone nas ações; o nome fica no title.
 */

export type ResolverBloco = (noId: string, blocoId: string, modo: "fonte" | "editar", valor: string) => Promise<void>;

const ROTULO_DO_TIPO: Record<string, string> = { depoimento: "Depoimento", resultado: "Resultado", estatistica: "Estatística", garantia: "Garantia", outro: "Prova" };

function LinhaDoBloco({ bloco, noId, rotuloDoNo, onResolver }: { bloco: BlocoSemFonte; noId: string; rotuloDoNo?: string; onResolver: ResolverBloco }) {
  const [modo, setModo] = useState<"fonte" | "editar" | null>(null);
  const [valor, setValor] = useState("");
  const [salvando, setSalvando] = useState(false);
  const abrir = (m: "fonte" | "editar") => {
    setModo(m);
    setValor(m === "editar" ? bloco.texto : "");
  };
  const salvar = async () => {
    if (!modo) return;
    setSalvando(true);
    try {
      await onResolver(noId, bloco.id, modo, valor);
      setModo(null);
    } catch (e) {
      toast.error("Não deu para resolver o bloco", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };
  const id = `bloco-${noId}-${bloco.id}`;
  return (
    <li className="min-w-0 py-1" data-bloco-sem-fonte={bloco.id} data-no-do-bloco={noId}>
      <div className="flex min-w-0 items-start">
        <span className={juntar(texto.auxiliar, "min-w-0 flex-1")} title={bloco.onde || undefined}>
          <span className="font-medium text-foreground">{ROTULO_DO_TIPO[bloco.tipo] || "Prova"}</span>
          {rotuloDoNo ? <span className="text-muted-foreground"> · {rotuloDoNo}</span> : null}
          <span className="block line-clamp-2">{bloco.texto}</span>
        </span>
        <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={() => abrir("fonte")} disabled={salvando} aria-label="Marcar fonte confirmada" title="Fonte confirmada (diga de onde vem)" data-marcar-fonte="">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={() => abrir("editar")} disabled={salvando} aria-label="Editar o trecho" title="Editar o trecho (tira a prova sem fonte)" data-editar-bloco="">
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      {modo ? (
        <div className="mt-1 flex min-w-0 items-start">
          <label htmlFor={id} className="sr-only">
            {modo === "fonte" ? "De onde vem a prova" : "Texto novo do trecho"}
          </label>
          {modo === "fonte" ? (
            <input id={id} className={juntar(campo, "h-8 min-w-0 flex-1")} placeholder="Link, print ou cliente que autorizou" value={valor} onChange={(e) => setValor(e.target.value)} />
          ) : (
            <textarea id={id} className={juntar(campoTexto, "min-h-[56px] min-w-0 flex-1")} value={valor} onChange={(e) => setValor(e.target.value)} />
          )}
          <button type="button" className={juntar(botao.icone, "ml-1 h-8 w-8 text-primary")} onClick={() => void salvar()} disabled={salvando || (modo === "fonte" && valor.trim().length < 3)} aria-label={modo === "fonte" ? "Confirmar a fonte" : "Salvar o trecho"} title={modo === "fonte" ? "Confirmar a fonte" : "Salvar o trecho"}>
            {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
          </button>
          <button type="button" className={juntar(botao.icone, "h-8 w-8")} onClick={() => setModo(null)} disabled={salvando} aria-label="Cancelar" title="Cancelar">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </li>
  );
}

/** Os blocos de um nó (rascunho sem fonte); `trava` = lista do Pôr no ar, com o motivo e o nó de cada bloco. */
export default function BlocosSemFonte({
  blocos,
  motivo,
  onResolver,
}: {
  blocos: Array<BlocoSemFonte & { no_id: string; no_rotulo?: string }>;
  /** Pôr no ar: o motivo da trava (a função manda o mesmo). Sem motivo: os blocos do próprio nó. */
  motivo?: string;
  onResolver: ResolverBloco;
}) {
  const pendentes = blocos.filter((b) => !b.confirmado);
  if (!pendentes.length) return null;
  return (
    <div className="min-w-0" data-blocos-sem-fonte="" {...(motivo ? { "data-trava-no-ar": "", role: "alert" } : {})}>
      <p className={juntar(texto.auxiliar, "flex items-start text-warning")}>
        <Lock className="mr-1 mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0">{motivo || `${pendentes.length} bloco(s) de prova ou número sem fonte. Confirme a fonte ou edite.`}</span>
      </p>
      <ul className="min-w-0 divide-y divide-border">
        {pendentes.map((b) => (
          <LinhaDoBloco key={`${b.no_id}-${b.id}`} bloco={b} noId={b.no_id} rotuloDoNo={motivo ? b.no_rotulo : undefined} onResolver={onResolver} />
        ))}
      </ul>
    </div>
  );
}
