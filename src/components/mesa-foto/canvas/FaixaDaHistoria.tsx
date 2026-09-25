import { useState, type DragEvent } from "react";
import { ChevronLeft, ChevronRight, Clapperboard, Copy, CopyPlus, Film, Layers, Sparkles, UserRoundCheck, X } from "lucide-react";
import { MiniaturaDoStorage } from "@/components/mesa/ContextoMiniatura";
import { BotaoComCusto } from "@/components/mesa/Custo";
import {
  entradasDoGerar,
  NOS_DE_VIDEO_EM_BREVE,
  partesDaSerie,
  partesDoResultado,
  VARIACOES_POR_VEZ,
  type Canvas,
  type ResultadoDoCanvas,
} from "../canvasApi";
import { BOTAO, CAMPO, FLUTUANTE, PAINEL, useRodaPresa, type Fontes } from "./comum";
import { cenasDaHistoria, fotoDaCena, moverCena, mudarCena, pacoteDaHistoria } from "./historia";

/**
 * Área "História" do Canvas (storyboard): as cenas em ordem, com a foto, a
 * narrativa de cada uma, arrastar (ou as setas) para ordenar, duplicar para
 * mudar o contexto, a próxima cena com a mesma personagem, variações e gerar,
 * sempre com o custo à vista antes. No quadro é uma faixa no pé; no modo
 * lista (celular) é um bloco da página. A Mesa Vídeos lê esta mesma lista.
 */

const TIPO_ARRASTADO = "application/mesa-foto-cena";

export interface AcoesDaHistoria {
  onAbrir: (gerarId: string) => void;
  onGerar: (gerarId: string) => Promise<Record<string, never>>;
  onVariacoes: (gerarId: string, r: ResultadoDoCanvas) => Promise<unknown>;
  onDuplicar: (gerarId: string) => void;
  onProxima: (gerarId: string) => void;
  /** Marca o Resultado aberto (ou o primeiro) como cena. */
  onNovaCena: () => void;
}

export function HistoriaDoCanvas({
  canvas,
  fontes,
  onMudarCanvas,
  acoes,
  lugar,
  onFechar,
}: {
  canvas: Canvas;
  fontes: Fontes;
  onMudarCanvas: (fn: (c: Canvas) => Canvas) => void;
  acoes: AcoesDaHistoria;
  lugar: "quadro" | "pagina";
  onFechar?: () => void;
}) {
  const roda = useRodaPresa<HTMLElement>();
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const aprovadas = fontes.fotos.filter((f) => f.aprovada).map((f) => f.id);
  const cenas = cenasDaHistoria(canvas);
  const pacote = pacoteDaHistoria(canvas, aprovadas);
  const sinopse = canvas.historia ? canvas.historia.sinopse : "";

  const soltar = (e: DragEvent<HTMLElement>, destinoId: string, posicao: number) => {
    e.preventDefault();
    let id = arrastando;
    try {
      id = e.dataTransfer.getData(TIPO_ARRASTADO) || arrastando;
    } catch {
      /* navegador sem dataTransfer: usa o que a tela guardou */
    }
    setArrastando(null);
    setSobre(null);
    if (!id || id === destinoId) return;
    onMudarCanvas((c) => moverCena(c, id as string, posicao));
  };

  const caixa =
    lugar === "quadro"
      ? `${PAINEL} ${FLUTUANTE} absolute inset-x-2 bottom-2 z-20 flex max-h-[62%] min-w-0 flex-col rounded-2xl sm:left-[72px] sm:right-3`
      : "min-w-0 rounded-2xl border border-white/10 bg-zinc-950 text-zinc-100";

  return (
    <section ref={roda} aria-label="História do canvas" className={caixa} data-historia={lugar}>
      <div className="flex min-w-0 shrink-0 flex-wrap items-center border-b border-white/10 px-3 py-2">
        <h3 className="mr-2 flex shrink-0 items-center text-[13px] font-semibold">
          <Clapperboard className="mr-1.5 h-3.5 w-3.5 text-emerald-300" /> História
        </h3>
        <span className="mr-2 text-[11px] text-zinc-400">
          {cenas.length} {cenas.length === 1 ? "cena" : "cenas"}
          {pacote.sem_foto ? ` · ${pacote.sem_foto} sem foto` : ""}
        </span>
        <input
          value={sinopse}
          onChange={(e) => {
            const v = e.target.value;
            onMudarCanvas((c) => ({ ...c, historia: { sinopse: v, formato: c.historia ? c.historia.formato : null } }));
          }}
          placeholder="Sinopse: do que trata a história (vai como contexto em cada cena)"
          aria-label="Sinopse da história"
          className={`${CAMPO} my-1 h-8 min-w-0 flex-1 py-0 sm:mr-2`}
        />
        <button type="button" className={`${BOTAO} my-1 mr-1`} onClick={acoes.onNovaCena} title="Marca o Resultado aberto como cena">
          <Clapperboard className="mr-1 h-3.5 w-3.5" /> Nova cena
        </button>
        {onFechar && (
          <button type="button" onClick={onFechar} aria-label="Fechar a história" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-auto overscroll-contain p-3" data-rolagem-propria="">
        {cenas.length === 0 ? (
          <p className="text-[12px] leading-snug text-zinc-400">
            Nenhuma cena ainda. Abra um Resultado e toque em "Esta é uma cena", ou em Nova cena. Depois ligue a foto de uma cena na próxima (a linha sai da bolinha à direita do Resultado) para a mesma pessoa seguir na história.
          </p>
        ) : (
          <ol className="flex min-w-0 items-start" aria-label="Cenas da história, em ordem">
            {cenas.map((h, i) => {
              const foto = fotoDaCena(h.no, aprovadas);
              const entradas = entradasDoGerar(canvas, h.no.id);
              const personagem = entradas.some((e) => e.entrada === "pessoa");
              return (
                <li
                  key={h.no.id}
                  draggable
                  onDragStart={(e) => {
                    setArrastando(h.no.id);
                    try {
                      e.dataTransfer.setData(TIPO_ARRASTADO, h.no.id);
                      e.dataTransfer.effectAllowed = "move";
                    } catch {
                      /* sem arrastar: as setas ordenam */
                    }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (sobre !== h.no.id) setSobre(h.no.id);
                  }}
                  onDragLeave={() => setSobre((s) => (s === h.no.id ? null : s))}
                  onDrop={(e) => soltar(e, h.no.id, h.numero)}
                  onDragEnd={() => {
                    setArrastando(null);
                    setSobre(null);
                  }}
                  className={`mr-2.5 flex w-[196px] shrink-0 flex-col rounded-xl border bg-zinc-900/70 p-2 ${sobre === h.no.id && arrastando !== h.no.id ? "border-emerald-400" : "border-white/10"} ${arrastando === h.no.id ? "opacity-50" : ""}`}
                  data-cena-da-historia={h.no.id}
                  data-numero={h.numero}
                >
                  <div className="mb-1.5 flex min-w-0 items-center">
                    <span className="mr-1.5 flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-emerald-400 px-1 text-[10.5px] font-bold text-black">{h.numero}</span>
                    <button type="button" className="min-w-0 flex-1 truncate text-left text-[12px] font-semibold hover:underline" onClick={() => acoes.onAbrir(h.no.id)} title="Abrir os ajustes da cena">
                      {h.cena.titulo.trim() || `Cena ${h.numero}`}
                    </button>
                    {personagem && <UserRoundCheck className="ml-1 h-3.5 w-3.5 shrink-0 text-sky-300" aria-label="Com personagem" />}
                  </div>
                  <button type="button" className="relative block w-full overflow-hidden rounded-lg border border-white/10 bg-zinc-900" style={{ height: 112 }} onClick={() => acoes.onAbrir(h.no.id)} aria-label={`Abrir a cena ${h.numero}`}>
                    {foto ? (
                      <MiniaturaDoStorage bucket={foto.storage_bucket} caminho={foto.storage_path || foto.url} alt={`Foto da cena ${h.numero}`} largura={320} className="h-full w-full" />
                    ) : (
                      <span className="flex h-full items-center justify-center text-[11px] text-zinc-500">Sem foto ainda</span>
                    )}
                  </button>
                  <textarea
                    value={h.cena.narrativa}
                    onChange={(e) => {
                      const v = e.target.value;
                      onMudarCanvas((c) => mudarCena(c, h.no.id, { narrativa: v }));
                    }}
                    rows={3}
                    placeholder="Narrativa desta cena"
                    aria-label={`Narrativa da cena ${h.numero}`}
                    className={`${CAMPO} mt-1.5 text-[11.5px]`}
                  />
                  <div className="mt-1.5 flex min-w-0 flex-wrap items-center">
                    <button type="button" className={`${BOTAO} mb-1 mr-1 px-1.5`} disabled={i === 0} onClick={() => onMudarCanvas((c) => moverCena(c, h.no.id, h.numero - 1))} aria-label={`Trazer a cena ${h.numero} para antes`}>
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" className={`${BOTAO} mb-1 mr-1 px-1.5`} disabled={i === cenas.length - 1} onClick={() => onMudarCanvas((c) => moverCena(c, h.no.id, h.numero + 1))} aria-label={`Levar a cena ${h.numero} para depois`}>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" className={`${BOTAO} mb-1 mr-1 px-1.5`} onClick={() => acoes.onDuplicar(h.no.id)} title="Duplicar a cena para mudar o contexto (mesmas entradas, sem as fotos)" aria-label={`Duplicar a cena ${h.numero}`}>
                      <CopyPlus className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" className={`${BOTAO} mb-1 mr-1 px-1.5`} disabled={!foto} onClick={() => acoes.onProxima(h.no.id)} title="Próxima cena com a pessoa desta foto" aria-label={`Próxima cena depois da ${h.numero}`}>
                      <UserRoundCheck className="mr-0.5 h-3.5 w-3.5" /> Próxima
                    </button>
                  </div>
                  <div className="flex min-w-0 items-center">
                    <BotaoComCusto
                      rotulo={
                        <>
                          {h.no.dados.carrossel ? <Layers className="mr-1 h-3.5 w-3.5" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />} {foto ? "Gerar de novo" : "Gerar"}
                        </>
                      }
                      titulo={`Cena ${h.numero}`}
                      descricao="Gera a foto desta cena com as entradas dela. Entra no acervo, marcada como gerada."
                      className="mr-1 h-8 flex-1 bg-emerald-400 px-2 text-[11.5px] font-semibold text-black hover:bg-emerald-300"
                      fecharAoConfirmar
                      disabled={!(h.no.dados.motores || []).length}
                      partes={() => partesDoResultado(h.no, entradas.length)}
                      executar={() => acoes.onGerar(h.no.id)}
                    />
                    {foto && (
                      <BotaoComCusto
                        rotulo={<Copy className="h-3.5 w-3.5" />}
                        titulo="Variações da cena"
                        descricao={`${VARIACOES_POR_VEZ} fotos da mesma cena, com a mesma pessoa e o mesmo produto, em ângulos diferentes.`}
                        variant="outline"
                        className="h-8 border-white/10 bg-white/5 px-2 text-zinc-100 hover:bg-white/10"
                        fecharAoConfirmar
                        partes={() => partesDaSerie(foto.motor_id, h.no.dados.qualidade || "alta", entradas.length, VARIACOES_POR_VEZ, true)}
                        executar={() => acoes.onVariacoes(h.no.id, foto)}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <div className="flex min-w-0 shrink-0 flex-wrap items-center border-t border-white/10 px-3 py-1.5 text-[10.5px] text-zinc-500">
        <Film className="mr-1 h-3 w-3" /> Mesa Vídeos (em breve): {NOS_DE_VIDEO_EM_BREVE.map((v) => v.rotulo.toLowerCase()).join(", ")} por cena, a partir desta história.
      </div>
    </section>
  );
}
