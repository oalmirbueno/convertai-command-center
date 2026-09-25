import { useState } from "react";
import { Check, ChevronDown, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { chamarFuncao, textoDoErro, type ParteDaEstimativa } from "@/lib/mesa/api";
import { BotaoComCusto } from "./Custo";
import { FRAMEWORKS } from "./MesConhecimento";
import { corpoDoRefinar, OBJETIVOS_DO_REFINO } from "./estudioUtil";

/**
 * Refinar texto (dono, 26/09: "uma área no texto para refinar a copy,
 * melhorar a copy, com todas as técnicas, para sempre gerar a melhor copy de
 * qualquer tipo de texto, usando o treinamento interno"). Na lâmina (texto
 * exato) e na legenda: a equipe marca o que quer (mais curto, mais forte,
 * mais claro, gancho, CTA, tom da marca), escolhe um framework se quiser
 * (AIDA, PAS, antes e depois...) e um pedido livre; o redator devolve 3
 * opções, cada uma com a técnica e o porquê; "Usar esta" aplica. Uma chamada
 * por clique (custo à vista antes, no botão), nada tenta de novo sozinho, e
 * nada muda na lâmina até a equipe escolher.
 */

export interface OpcaoRefinada {
  texto: string;
  tecnica: string;
  porque: string;
}

export default function EstudioRefinarTexto({
  trabalhoId,
  alvo,
  ordem,
  texto,
  partes,
  bloqueado = false,
  onAplicar,
  onConcluido,
}: {
  trabalhoId: string;
  alvo: "lamina" | "legenda";
  ordem?: number;
  /** Texto atual (o da tela, mesmo ainda não salvo). */
  texto: string;
  partes: () => ParteDaEstimativa[];
  bloqueado?: boolean;
  /** Aplica a opção escolhida (texto exato pelo configurar; legenda no campo). */
  onAplicar: (texto: string) => Promise<void> | void;
  /** Depois de gastar: atualiza o custo da tela. */
  onConcluido?: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [objetivos, setObjetivos] = useState<string[]>(["mais_forte"]);
  const [framework, setFramework] = useState("");
  const [pedido, setPedido] = useState("");
  const [opcoes, setOpcoes] = useState<OpcaoRefinada[]>([]);
  const [aplicando, setAplicando] = useState<number | null>(null);
  const [aplicada, setAplicada] = useState<number | null>(null);

  const alternar = (id: string) =>
    setObjetivos((l) => (l.indexOf(id) >= 0 ? l.filter((x) => x !== id) : l.length >= 4 ? l : l.concat([id])));

  const aplicar = async (i: number) => {
    const o = opcoes[i];
    if (!o) return;
    setAplicando(i);
    try {
      await onAplicar(o.texto);
      setAplicada(i);
    } catch (e) {
      toast.error("Texto não aplicado", { description: textoDoErro(e) });
    } finally {
      setAplicando(null);
    }
  };

  const vazio = !texto.trim();
  return (
    <div className="rounded-lg border border-border bg-background" data-refinar-texto={alvo}>
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        className="flex min-h-9 w-full min-w-0 items-center rounded-lg px-2.5 py-1 text-left hover:bg-secondary"
      >
        <Sparkles className="mr-1.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 text-[12px] font-medium">Refinar texto</span>
        <span className="mr-1 hidden text-[11px] text-muted-foreground sm:inline">3 opções com técnica</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${aberto ? "rotate-180" : ""}`} />
      </button>
      {aberto && (
        <div className="space-y-2.5 border-t border-border px-2.5 pb-2.5 pt-2">
          <div role="group" aria-label="O que melhorar" className="flex flex-wrap">
            {OBJETIVOS_DO_REFINO.map((o) => {
              const marcado = objetivos.indexOf(o.id) >= 0;
              return (
                <button
                  key={o.id}
                  type="button"
                  aria-pressed={marcado}
                  onClick={() => alternar(o.id)}
                  className={`mb-1 mr-1.5 h-7 rounded-full border px-2.5 text-[11.5px] transition-colors ${
                    marcado ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                  }`}
                >
                  {o.rotulo}
                </button>
              );
            })}
          </div>
          <label className="block">
            <span className="mb-1 block text-[11px] text-muted-foreground">Framework (opcional)</span>
            <select
              value={framework}
              onChange={(e) => setFramework(e.target.value)}
              className="h-8 w-full rounded-md border border-border bg-background px-2 text-[12px]"
              aria-label="Framework de copy"
            >
              <option value="">Nenhum: o redator escolhe a técnica</option>
              {FRAMEWORKS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome} ({f.dica})
                </option>
              ))}
            </select>
          </label>
          <Input
            value={pedido}
            onChange={(e) => setPedido(e.target.value)}
            maxLength={600}
            placeholder="Pedido (opcional). Ex.: falar com quem mora no bairro"
            className="h-8 text-[12px]"
            aria-label="Pedido para o redator"
          />
          <div className="flex justify-end">
            <BotaoComCusto
              rotulo={<><Sparkles className="mr-1 h-3.5 w-3.5" /> {opcoes.length ? "Gerar outras 3" : "Gerar 3 opções"}</>}
              titulo="Refinar texto"
              descricao="O redator usa a base de copy da agência, o framework escolhido, o contexto da marca e o que o cliente já ensinou. Nada muda até você escolher."
              variant="outline"
              className="h-8 gap-1 px-2.5 text-[12px]"
              disabled={bloqueado || vazio || !objetivos.length}
              partes={partes}
              executar={() => chamarFuncao<any>("estudio-arte", corpoDoRefinar(trabalhoId, { alvo, ordem, texto, objetivos, framework, pedido }))}
              aoConcluir={(data) => {
                const lista = data && Array.isArray(data.opcoes) ? (data.opcoes as OpcaoRefinada[]).filter((o) => o && typeof o.texto === "string" && o.texto.trim()) : [];
                setOpcoes(lista);
                setAplicada(null);
                if (onConcluido) onConcluido();
              }}
            />
          </div>
          {vazio && <p className="text-[11.5px] text-muted-foreground">Escreva o texto primeiro.</p>}
          {opcoes.length > 0 && (
            <ol className="space-y-2" aria-label="Opções refinadas">
              {opcoes.map((o, i) => (
                <li key={i} className={`rounded-md border px-2.5 py-2 ${aplicada === i ? "border-success" : "border-border"}`}>
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed [overflow-wrap:anywhere]">{o.texto}</p>
                  {(o.tecnica || o.porque) && (
                    <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                      {o.tecnica && <span className="mr-1 font-medium text-foreground">{o.tecnica}.</span>}
                      {o.porque}
                    </p>
                  )}
                  <div className="mt-1.5 flex justify-end">
                    <Button type="button" size="sm" variant={aplicada === i ? "ghost" : "default"} className="h-7 px-2.5 text-[11.5px]" disabled={bloqueado || aplicando !== null} onClick={() => void aplicar(i)}>
                      {aplicando === i ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : aplicada === i ? <Check className="mr-1 h-3.5 w-3.5 text-success" /> : null}
                      {aplicada === i ? "Aplicada" : "Usar esta"}
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
