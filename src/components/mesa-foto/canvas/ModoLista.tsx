import { useState, type ReactNode } from "react";
import { Film, LayoutTemplate, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Cartao, Pilulas } from "../Comuns";
import { desligar, entradasDoGerar, mudarDados, mudarLigacao, nomeDoResultado, removerNo, resumoDoResultado, rotuloDoPapel, TIPOS_DE_NO, type Canvas, type NoDoCanvas, type PersonagemCriada, type ResultadoDoCanvas, type TipoDeNo } from "../canvasApi";
import { EditorDaLigacaoDeResultado } from "./Cena";
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
  onPersonagemCriada,
  onAnimar,
  renderVideo,
  onEditarQuadro,
  onPorQuadro,
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
  onPersonagemCriada?: (p: PersonagemCriada, r: ResultadoDoCanvas) => void;
  /** Frente CNV: animar a foto (cartão Vídeo), os ajustes do Vídeo e o editor do Quadro. */
  onAnimar?: (gerarId: string) => void;
  renderVideo?: (no: NoDoCanvas) => ReactNode;
  onEditarQuadro?: (quadroId: string) => void;
  onPorQuadro?: () => void;
}) {
  const resultados = canvas.nos.filter((n) => n.tipo === "gerar");
  const videos = canvas.nos.filter((n) => n.tipo === "video");
  const quadros = canvas.nos.filter((n) => n.tipo === "quadro");
  const [resultadoId, setResultadoId] = useState<string | null>(resultados.length ? resultados[0].id : null);
  const resultado = resultados.find((s) => s.id === resultadoId) || resultados[0] || null;
  const entradas = resultado ? entradasDoGerar(canvas, resultado.id) : [];
  const soltos = canvas.nos.filter((n) => n.tipo !== "gerar" && n.tipo !== "video" && n.tipo !== "quadro" && !canvas.ligacoes.some((l) => l.de === n.id));

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
      {resultados.length > 1 && <Pilulas rotulo="Resultado aberto" opcoes={resultados.map((s) => ({ valor: s.id, rotulo: nomeDoResultado(canvas, s) }))} valor={resultado.id} onEscolher={setResultadoId} />}
      <Cartao titulo="O que vai na foto" dica="Na ordem em que vai ao gerador: produto, pessoa, ambiente, estilo, pedido e agente." className="!border-white/10 !bg-zinc-950 text-zinc-100">
        {entradas.length === 0 && <p className="mb-2 text-[12px] text-zinc-400">Nada ainda. Toque num botão abaixo.</p>}
        <ol className="min-w-0 space-y-3">
          {entradas.map((e) => (
            <li key={e.ligacao.id} className="min-w-0 rounded-xl border border-white/10 p-2.5" data-entrada-da-lista={e.no.id}>
              <div className="mb-2 flex min-w-0 items-center">
                <span className="mr-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-semibold">{e.numero}</span>
                <span className={`min-w-0 flex-1 truncate text-[12.5px] font-semibold ${e.no.tipo === "gerar" ? "text-emerald-300" : TIPOS_DE_NO[e.no.tipo].texto}`}>{e.no.tipo === "gerar" ? `${rotuloDoPapel(e.ligacao.papel)} de outra cena` : TIPOS_DE_NO[e.no.tipo].rotulo}</span>
                {/* Outra cena: tirar só desliga (o Resultado de origem continua no quadro). */}
                <button type="button" aria-label={e.no.tipo === "gerar" ? "Desligar a outra cena" : "Tirar o cartão"} onClick={() => onMudarCanvas((c) => (e.no.tipo === "gerar" ? desligar(c, e.ligacao.id) : removerNo(c, e.no.id)))} className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-white/10">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              {e.no.tipo === "gerar" ? (
                <EditorDaLigacaoDeResultado
                  canvas={canvas}
                  ligacao={e.ligacao}
                  fontes={fontes}
                  onPapel={(p) => onMudarCanvas((c) => mudarLigacao(c, e.ligacao.id, { papel: p }))}
                  onFoto={(id) => onMudarCanvas((c) => mudarLigacao(c, e.ligacao.id, { imagem_id: id }))}
                />
              ) : e.no.tipo === "agente" ? (
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
          {resumoDoResultado(entradas, (x) => (x.tipo === "gerar" ? nomeDoResultado(canvas, x) : descrever(x, fontes).titulo)) || "Junta o que você puser acima. Comece por um produto ou uma pessoa."}
        </p>
        <AjustesDoResultado canvas={canvas} no={resultado} fontes={fontes} onMudar={(dados) => onMudarCanvas((c) => mudarDados(c, resultado.id, dados))} garantirSalvo={garantirSalvo} comGerar onGerar={onGerar} onVariacoes={onVariacoes} onPersonagemCriada={onPersonagemCriada} onAnimar={onAnimar ? () => onAnimar(resultado.id) : undefined} />
      </Cartao>
      {renderVideo && videos.length > 0 && (
        <Cartao titulo={`Vídeos (${videos.length})`} className="!border-white/10 !bg-zinc-950 text-zinc-100">
          <ol className="min-w-0 space-y-4">
            {videos.map((v) => (
              <li key={v.id} className="min-w-0" data-video-da-lista={v.id}>
                <p className="mb-2 flex items-center text-[13px] font-semibold text-orange-300">
                  <Film className="mr-1.5 h-3.5 w-3.5" /> {(v.dados.titulo || "").trim() || "Vídeo"}
                </p>
                {renderVideo(v)}
              </li>
            ))}
          </ol>
        </Cartao>
      )}
      {(quadros.length > 0 || onPorQuadro) && onEditarQuadro && (
        <Cartao titulo={`Quadros animados (${quadros.length})`} className="!border-white/10 !bg-zinc-950 text-zinc-100">
          <ul className="min-w-0">
            {quadros.map((q) => (
              <li key={q.id} className="flex min-w-0 items-center py-1.5" data-quadro-da-lista={q.id}>
                <LayoutTemplate className="mr-2 h-3.5 w-3.5 shrink-0 text-teal-300" />
                <span className="min-w-0 flex-1 truncate text-[13px]">{(q.dados.titulo || "").trim() || "Quadro animado"}</span>
                <Button type="button" size="sm" variant="outline" className="h-8 text-[12px]" onClick={() => onEditarQuadro(q.id)}>
                  <Pencil className="mr-1 h-3.5 w-3.5" /> Editar
                </Button>
              </li>
            ))}
          </ul>
          {onPorQuadro && (
            <Button type="button" size="sm" variant="outline" className="mt-2 h-9 text-[12px]" onClick={onPorQuadro}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Novo quadro animado
            </Button>
          )}
        </Cartao>
      )}
    </div>
  );
}
