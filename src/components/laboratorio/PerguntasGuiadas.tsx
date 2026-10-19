import { useState } from "react";
import { ArrowRight, Loader2, SkipForward, X } from "lucide-react";
import { botao, campo, campoTexto, juntar, superficie, texto } from "@/components/sistema";
import type { PerguntaGuiada } from "@/lib/laboratorio/api";
import { montarRespostas } from "@/lib/laboratorio/respostasDasPerguntas";

/**
 * Perguntas guiadas antes de montar (v3, clickmax-rea.md): até 4, quando o
 * pedido de projeto completo não traz o essencial (produto/oferta, público,
 * preço/ticket, objetivo).
 *
 * Etapa grande (21/10/2026, pedido do dono), no Canvas Studio (no lugar do
 * canvas) e na Início (no lugar da caixa): cada pergunta tem as opções e um
 * campo livre só dela (a opção preenche a resposta DAQUELA pergunta), mais a
 * conversa livre ("posso conversar de outra maneira"), que vai junto.
 * "Seguir" manda tudo em `respostas`; "Pular" monta assim mesmo
 * (`pular_perguntas`).
 */
interface Props {
  perguntas: PerguntaGuiada[];
  onPular: () => void;
  onFechar?: () => void;
  ocupado?: boolean;
  /** Manda as respostas (texto do `respostas` do planejar). */
  onSeguir: (respostas: string) => void;
  /** O pedido que gerou as perguntas (aparece no topo). */
  pedido?: string;
}

export default function PerguntasGuiadas(props: Props) {
  if (!props.perguntas.length) return null;
  return <EtapaDasPerguntas {...props} />;
}

function EtapaDasPerguntas({ perguntas, onPular, onFechar, ocupado = false, onSeguir, pedido }: Props) {
  const [respostas, setRespostas] = useState<Record<string, string>>({});
  const [conversa, setConversa] = useState("");
  const texto0 = montarRespostas(perguntas, respostas, conversa);
  const responder = (id: string, v: string) => setRespostas((r) => ({ ...r, [id]: v }));
  const seguir = () => {
    if (texto0 && !ocupado) onSeguir(texto0);
  };

  return (
    <section
      className={juntar(superficie.painel, "flex min-h-[70vh] min-w-0 flex-col px-4 py-5 sm:px-8 sm:py-7")}
      role="group"
      aria-label="Perguntas antes de montar"
      data-perguntas-guiadas=""
      data-etapa-das-perguntas=""
    >
      <div className="mx-auto flex w-full min-w-0 max-w-[760px] flex-1 flex-col">
        <div className="flex min-w-0 items-start">
          <div className="min-w-0 flex-1">
            <p className={texto.rotulo}>Antes de montar</p>
            <h2 className={juntar(texto.tituloPagina, "mt-1 truncate")}>Conte o essencial e o agente monta o projeto</h2>
            {pedido ? (
              <p className={juntar(texto.auxiliar, "mt-1 truncate")} title={pedido}>
                Pedido: {pedido}
              </p>
            ) : null}
          </div>
          {onFechar ? (
            <button type="button" className={juntar(botao.icone, "ml-2")} onClick={onFechar} disabled={ocupado} aria-label="Fechar as perguntas" title="Fechar as perguntas (volta ao canvas)">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <ol className="mt-6 min-w-0 space-y-6">
          {perguntas.map((p, i) => {
            const valor = respostas[p.id] || "";
            return (
              <li key={p.id} className="min-w-0" data-pergunta={p.id}>
                <p className={juntar(texto.tituloSecao, "min-w-0")} id={`pergunta-${p.id}`}>
                  <span className="mr-1.5 tabular-nums text-muted-foreground">{i + 1}.</span>
                  {p.pergunta}
                </p>
                {p.exemplos.length ? (
                  <div className="mt-2 flex min-w-0 flex-wrap" role="group" aria-label={`Opções para: ${p.pergunta}`}>
                    {p.exemplos.map((ex) => {
                      const escolhida = valor === ex;
                      return (
                        <button
                          key={ex}
                          type="button"
                          className={juntar(
                            botao.secundario,
                            "mb-2 mr-2 h-8 max-w-full truncate px-3 text-[13px]",
                            escolhida && "border-primary bg-primary/10 text-foreground hover:bg-primary/15",
                          )}
                          onClick={() => responder(p.id, escolhida ? "" : ex)}
                          disabled={ocupado}
                          aria-pressed={escolhida}
                          title={escolhida ? "Tirar esta resposta" : "Usar esta resposta nesta pergunta"}
                          data-exemplo={p.id}
                        >
                          {ex}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                <input
                  className={juntar(campo, "mt-1")}
                  value={valor}
                  onChange={(e) => responder(p.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      seguir();
                    }
                  }}
                  disabled={ocupado}
                  placeholder="Ou escreva do seu jeito…"
                  aria-label={`Resposta: ${p.pergunta}`}
                  data-resposta={p.id}
                />
              </li>
            );
          })}
        </ol>

        <div className="mt-6 min-w-0">
          <label className={juntar(texto.rotulo, "mb-1 block")} htmlFor="conversa-livre-das-perguntas">
            Prefere conversar de outro jeito? Escreva aqui
          </label>
          <textarea
            id="conversa-livre-das-perguntas"
            className={juntar(campoTexto, "min-h-[72px] resize-y")}
            value={conversa}
            onChange={(e) => setConversa(e.target.value)}
            disabled={ocupado}
            placeholder="Conte do seu jeito: o que vende, para quem, quanto custa, o que quer alcançar…"
            data-conversa-livre=""
          />
        </div>

        <div className="mt-auto flex min-w-0 flex-wrap items-center justify-end pt-6">
          {ocupado ? (
            <p className={juntar(texto.auxiliar, "mr-auto")} role="status">
              O agente está pesquisando e montando…
            </p>
          ) : null}
          <button
            type="button"
            className={juntar(botao.discreto, "ml-2")}
            onClick={onPular}
            disabled={ocupado}
            aria-label="Pular e montar assim mesmo"
            title="Pular e montar assim mesmo (o que falta fica em branco, sem inventar)"
            data-pular-perguntas=""
          >
            <SkipForward className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Pular
          </button>
          <button
            type="button"
            className={juntar(botao.primario, "ml-2")}
            onClick={seguir}
            disabled={ocupado || !texto0}
            title={texto0 ? "Seguir: o agente monta com as suas respostas" : "Responda ao menos uma pergunta (ou use Pular)"}
            data-seguir-perguntas=""
          >
            {ocupado ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <ArrowRight className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
            Seguir
          </button>
        </div>
      </div>
    </section>
  );
}
