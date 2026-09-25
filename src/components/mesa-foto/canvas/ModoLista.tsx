import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Cartao, Pilulas } from "../Comuns";
import { entradasDoGerar, mudarDados, removerNo, resumoDoResultado, TIPOS_DE_NO, type Canvas, type ResultadoDoCanvas, type TipoDeNo } from "../canvasApi";
import { ChatDoAgente } from "./Agente";
import { descrever, ICONES, type Fontes } from "./comum";
import { AjustesDoResultado, CustoDoResultado, EditorDoCartao } from "./Editores";

/** Modo lista (celular, abaixo de 768 px): o mesmo grafo em formulário. */

const TIPOS_DE_ENTRADA: Exclude<TipoDeNo, "gerar">[] = ["produto", "modelo", "ambiente", "estilo", "texto", "agente"];

export function ModoLista({
  canvas,
  fontes,
  onMudarCanvas,
  garantirSalvo,
  onGerar,
  onVariacoes,
  onPor,
  onEscolher,
  onAgenteDoAmbiente,
}: {
  canvas: Canvas;
  fontes: Fontes;
  onMudarCanvas: (fn: (c: Canvas) => Canvas) => void;
  garantirSalvo: () => Promise<Canvas | null>;
  onGerar: (gerarId: string) => Promise<Record<string, never>>;
  onVariacoes: (gerarId: string, r: ResultadoDoCanvas) => Promise<unknown>;
  onPor: (t: TipoDeNo, gerarId: string | null) => void;
  onEscolher: (t: TipoDeNo, trocarId: string | null, gerarId: string | null) => void;
  onAgenteDoAmbiente: (noId: string, gerarId: string | null) => Promise<unknown>;
}) {
  const resultados = canvas.nos.filter((n) => n.tipo === "gerar");
  const [resultadoId, setResultadoId] = useState<string | null>(resultados.length ? resultados[0].id : null);
  const resultado = resultados.find((s) => s.id === resultadoId) || resultados[0] || null;
  const entradas = resultado ? entradasDoGerar(canvas, resultado.id) : [];
  const soltos = canvas.nos.filter((n) => n.tipo !== "gerar" && !canvas.ligacoes.some((l) => l.de === n.id));

  if (!resultado) {
    return (
      <Cartao titulo="Modo lista">
        <p className="mb-2 text-[12px] text-muted-foreground">O canvas não tem Resultado. Ele junta os cartões e gera a foto.</p>
        <Button type="button" size="sm" className="h-8 text-[12px]" onClick={() => onPor("gerar", null)}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Pôr um Resultado
        </Button>
      </Cartao>
    );
  }

  return (
    <div className="min-w-0 space-y-3" data-modo-lista="">
      {resultados.length > 1 && <Pilulas rotulo="Resultado aberto" opcoes={resultados.map((s, i) => ({ valor: s.id, rotulo: `Resultado ${i + 1}` }))} valor={resultado.id} onEscolher={setResultadoId} />}
      <Cartao titulo="O que vai na foto" dica="Na ordem em que vai ao gerador: produto, pessoa, ambiente, estilo, pedido e agente." className="!border-white/10 !bg-zinc-950 text-zinc-100">
        {entradas.length === 0 && <p className="mb-2 text-[12px] text-zinc-400">Nada ainda. Toque num botão abaixo.</p>}
        <ol className="min-w-0 space-y-3">
          {entradas.map((e) => (
            <li key={e.ligacao.id} className="min-w-0 rounded-xl border border-white/10 p-2.5" data-entrada-da-lista={e.no.id}>
              <div className="mb-2 flex min-w-0 items-center">
                <span className="mr-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10.5px] font-semibold">{e.numero}</span>
                <span className={`min-w-0 flex-1 truncate text-[12.5px] font-semibold ${TIPOS_DE_NO[e.no.tipo].texto}`}>{TIPOS_DE_NO[e.no.tipo].rotulo}</span>
                <button type="button" aria-label="Tirar o cartão" onClick={() => onMudarCanvas((c) => removerNo(c, e.no.id))} className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-white/10">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              {e.no.tipo === "agente" ? (
                <ChatDoAgente canvas={canvas} no={e.no} fontes={fontes} onMudarCanvas={onMudarCanvas} garantirSalvo={garantirSalvo} onGerar={onGerar} />
              ) : (
                <EditorDoCartao
                  no={e.no}
                  fontes={fontes}
                  onMudar={(dados) => onMudarCanvas((c) => mudarDados(c, e.no.id, dados))}
                  onEscolher={() => onEscolher(e.no.tipo, e.no.id, resultado.id)}
                  onAgente={e.no.tipo === "ambiente" ? () => onAgenteDoAmbiente(e.no.id, resultado.id) : undefined}
                />
              )}
            </li>
          ))}
        </ol>
        {soltos.length > 0 && <p className="mt-2 text-[11px] text-zinc-400">{soltos.length} {soltos.length === 1 ? "cartão solto" : "cartões soltos"} no quadro, sem ligação.</p>}
        <div className="mt-3 flex min-w-0 flex-wrap items-center" aria-label="Pôr na foto">
          {TIPOS_DE_ENTRADA.map((t) => {
            const Icone = ICONES[t];
            return (
              <Button key={t} type="button" size="sm" variant="outline" className="mb-1.5 mr-1.5 h-9 text-[12px]" onClick={() => (t === "texto" || t === "agente" ? onPor(t, resultado.id) : onEscolher(t, null, resultado.id))}>
                <Icone className={`mr-1 h-3.5 w-3.5 ${TIPOS_DE_NO[t].texto}`} /> {TIPOS_DE_NO[t].rotulo}
              </Button>
            );
          })}
        </div>
      </Cartao>
      <Cartao
        titulo="Resultado"
        className="!border-white/10 !bg-zinc-950 text-zinc-100"
        acao={
          <span className="text-[11.5px] font-semibold">
            <CustoDoResultado canvas={canvas} no={resultado} />
          </span>
        }
      >
        <p className="mb-3 text-[12px] leading-snug [overflow-wrap:anywhere]" data-junta="">
          {resumoDoResultado(entradas, (x) => descrever(x, fontes).titulo) || "Junta o que você puser acima. Comece por um produto ou uma pessoa."}
        </p>
        <AjustesDoResultado canvas={canvas} no={resultado} fontes={fontes} onMudar={(dados) => onMudarCanvas((c) => mudarDados(c, resultado.id, dados))} garantirSalvo={garantirSalvo} comGerar onGerar={onGerar} onVariacoes={onVariacoes} />
      </Cartao>
    </div>
  );
}
