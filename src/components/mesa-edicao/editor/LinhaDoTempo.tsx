import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, Film, Image as IconeImagem, Minus, Plus, Volume2, VolumeX } from "lucide-react";
import { botao, juntar, texto } from "@/components/sistema/estilos";
import { duracaoDoClipe, ROTULO_DA_TRILHA, type ClipeDoProjeto, type ProjetoDeEdicao, type TipoDeTrilha, type TrilhaDoProjeto } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import { apelidosDoProjeto, rotuloDoClipe } from "@/lib/editor/apelidos";
import { fimDoClipe, trilhasCompativeis, type Operacao } from "@/lib/editor/operacoes";
import { extrairQuadro, tempoDoQuadro } from "@/lib/editor/quadros";
import { noQuadro, tempoCurto, tempoFino } from "@/lib/editor/tempo";
import { useTempo, type Relogio } from "./apoio";

/**
 * Linha do tempo (frente V-B): régua, trilhas, clipes com miniaturas, cursor,
 * zoom (botões e Ctrl + roda), seleção (clique; Ctrl ou Shift soma), arrastar
 * para mover (inclusive para outra trilha compatível), puxar a borda para
 * aparar. Ímã: bordas dos outros clipes e o cursor, a 8 px. Tudo vira
 * operação (mover, aparar), que passa pelo desfazer.
 * Mouse e toque (sem Pointer Events, Safari 11).
 */

export const ALTURA_DA_REGUA = 26;
const ALTURA: Record<TipoDeTrilha, number> = { video: 56, sobreposicao: 44, texto: 36, legenda: 36, audio: 40 };
const LARGURA_DO_CABECALHO = 116;
const IMA_PX = 8;
export const ZOOM_MIN = 4;
export const ZOOM_MAX = 400;

const COR: Record<TipoDeTrilha, string> = {
  video: "bg-primary/25 border-primary/50",
  sobreposicao: "bg-sky-500/20 border-sky-400/50",
  texto: "bg-amber-500/20 border-amber-400/50",
  legenda: "bg-violet-500/20 border-violet-400/50",
  audio: "bg-emerald-500/15 border-emerald-400/40",
};

/** Passo das marcas da régua para caber texto (>= 64 px entre marcas). */
export function passoDaRegua(pxPorSeg: number): number {
  const passos = [0.04, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  return passos.find((p) => p * pxPorSeg >= 64) || 600;
}

interface Arrasto {
  tipo: "mover" | "inicio" | "fim";
  id: string;
  trilha: string;
  x0: number;
  y0: number;
  inicio0: number;
  fim0: number;
  dx: number;
  dy: number;
  moveu: boolean;
  somar: boolean;
}

const Miniatura = memo(function Miniatura({ url, tempo, largura }: { url: string; tempo: number; largura: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);
  useEffect(() => {
    let vivo = true;
    void extrairQuadro(url, tempo, { largura: 120, qualidade: 0.5 }).then((q) => {
      if (!vivo) return;
      if (q) setSrc(q.dataUrl);
      else setFalhou(true);
    });
    return () => {
      vivo = false;
    };
  }, [url, tempo]);
  return (
    <span className="relative block h-full shrink-0 overflow-hidden border-r border-black/30 bg-black/40" style={{ width: largura }}>
      {src ? <img src={src} alt="" className="h-full w-full object-cover" draggable={false} /> : !falhou ? null : <Film className="absolute left-1 top-1 h-3 w-3 text-white/40" aria-hidden="true" />}
    </span>
  );
});

function Cursor({ relogio, px }: { relogio: Relogio; px: number }) {
  const t = useTempo(relogio);
  return <div className="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-red-500" style={{ left: LARGURA_DO_CABECALHO + t * px }} data-cursor-da-linha="" />;
}

function Regua({ px, largura, relogio, marcadores, aoBuscar }: { px: number; largura: number; relogio: Relogio; marcadores: { tempo_s: number; rotulo: string }[]; aoBuscar: (s: number) => void }) {
  const passo = passoDaRegua(px);
  const marcas: number[] = [];
  const total = largura / px;
  for (let s = 0; s <= total + passo; s += passo) marcas.push(Math.round(s * 1000) / 1000);
  const arrastando = useRef(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const buscar = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    aoBuscar(Math.max(0, (clientX - r.left) / px));
  };
  useEffect(() => {
    const mover = (e: MouseEvent) => arrastando.current && buscar(e.clientX);
    const soltar = () => (arrastando.current = false);
    window.addEventListener("mousemove", mover);
    window.addEventListener("mouseup", soltar);
    return () => {
      window.removeEventListener("mousemove", mover);
      window.removeEventListener("mouseup", soltar);
    };
  });
  return (
    <div className="sticky top-0 z-30 flex bg-background" style={{ height: ALTURA_DA_REGUA }}>
      <div className="sticky left-0 z-30 shrink-0 border-b border-r border-border bg-background" style={{ width: LARGURA_DO_CABECALHO }} />
      <div
        ref={ref}
        className="relative cursor-pointer border-b border-border"
        style={{ width: largura }}
        onMouseDown={(e) => {
          arrastando.current = true;
          buscar(e.clientX);
        }}
        onTouchStart={(e) => e.touches.length && buscar(e.touches[0].clientX)}
        role="slider"
        aria-label="Régua da linha do tempo"
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(relogio.get())}
        tabIndex={-1}
      >
        {marcas.map((s) => (
          <span key={s} className="absolute top-0 h-full border-l border-border/70 pl-1 text-[10px] leading-[24px] text-muted-foreground tabular-nums" style={{ left: s * px }}>
            {passo < 1 ? tempoFino(s).replace(/,00$/, "") : tempoCurto(s)}
          </span>
        ))}
        {marcadores.map((m, k) => (
          <span key={`m${k}`} title={m.rotulo} className="absolute bottom-0 h-2 w-2 -translate-x-1/2 rotate-45 bg-amber-400" style={{ left: m.tempo_s * px }} />
        ))}
      </div>
    </div>
  );
}

function CabecalhoDaTrilha({ t, onOps }: { t: TrilhaDoProjeto; onOps: (ops: Operacao[], rotulo: string) => void }) {
  const som = t.tipo === "video" || t.tipo === "audio";
  return (
    <div className="sticky left-0 z-10 flex shrink-0 items-center border-b border-r border-border bg-background px-1.5" style={{ width: LARGURA_DO_CABECALHO, height: ALTURA[t.tipo] }}>
      <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium" title={t.nome}>
        {t.nome || ROTULO_DA_TRILHA[t.tipo]}
      </span>
      {som && (
        <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => onOps([{ op: "trilha", trilha: t.id, campos: { muda: !t.muda } }], t.muda ? "Ligar som" : "Tirar som")} aria-label={t.muda ? `Ligar o som de ${t.nome}` : `Tirar o som de ${t.nome}`} aria-pressed={t.muda}>
          {t.muda ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
        </button>
      )}
      <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => onOps([{ op: "trilha", trilha: t.id, campos: { oculta: !t.oculta } }], t.oculta ? "Mostrar trilha" : "Ocultar trilha")} aria-label={t.oculta ? `Mostrar ${t.nome}` : `Ocultar ${t.nome}`} aria-pressed={t.oculta}>
        {t.oculta ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

export default function LinhaDoTempo({
  projeto,
  relogio,
  px,
  setPx,
  selecao,
  onSelecionar,
  onOps,
  urls,
}: {
  projeto: ProjetoDeEdicao;
  relogio: Relogio;
  px: number;
  setPx: (n: number) => void;
  selecao: string[];
  onSelecionar: (ids: string[]) => void;
  onOps: (ops: Operacao[], rotulo: string) => void;
  urls: Record<string, string>;
}) {
  const rolagem = useRef<HTMLDivElement | null>(null);
  const [arrasto, setArrasto] = useState<Arrasto | null>(null);
  const arrastoRef = useRef<Arrasto | null>(null);
  const apelidos = useMemo(() => apelidosDoProjeto(projeto), [projeto]);
  const largura = Math.max(600, (projeto.duracao_s + 10) * px);
  const fps = projeto.fps;

  // Bordas para o ímã: início e fim de todos os clipes.
  const bordas = useMemo(() => {
    const b: { s: number; id: string }[] = [{ s: 0, id: "" }];
    projeto.trilhas.forEach((t) => t.clipes.forEach((c) => b.push({ s: c.inicio_s, id: c.id }, { s: fimDoClipe(c), id: c.id })));
    return b;
  }, [projeto]);

  const ima = (s: number, id: string) => {
    let melhor = s;
    let dist = IMA_PX / px;
    const cursor = relogio.get();
    if (Math.abs(cursor - s) < dist) {
      melhor = cursor;
      dist = Math.abs(cursor - s);
    }
    bordas.forEach((b) => {
      if (b.id === id) return;
      const d = Math.abs(b.s - s);
      if (d < dist) {
        dist = d;
        melhor = b.s;
      }
    });
    return noQuadro(Math.max(0, melhor), fps);
  };

  const trilhaNaAltura = (clientY: number): TrilhaDoProjeto | null => {
    const el = rolagem.current;
    if (!el) return null;
    const lanes = el.querySelectorAll("[data-faixa]");
    for (let i = 0; i < lanes.length; i++) {
      const r = lanes[i].getBoundingClientRect();
      if (clientY >= r.top && clientY < r.bottom) return projeto.trilhas.find((t) => t.id === (lanes[i] as HTMLElement).dataset.faixa) || null;
    }
    return null;
  };

  const terminar = (a: Arrasto, clientY: number) => {
    if (!a.moveu) {
      if (a.somar) onSelecionar(selecao.indexOf(a.id) >= 0 ? selecao.filter((x) => x !== a.id) : selecao.concat([a.id]));
      else onSelecionar([a.id]);
      return;
    }
    const d = a.dx / px;
    if (a.tipo === "mover") {
      const alvo = trilhaNaAltura(clientY);
      const origem = projeto.trilhas.find((t) => t.id === a.trilha);
      const outra = alvo && origem && alvo.id !== origem.id && trilhasCompativeis(origem.tipo, alvo.tipo) ? alvo.id : undefined;
      onOps([{ op: "mover", clipe: a.id, inicio_s: ima(a.inicio0 + d, a.id), trilha: outra }], `Mover ${apelidos.porId[a.id] || ""}`);
    } else if (a.tipo === "inicio") onOps([{ op: "aparar", clipe: a.id, lado: "inicio", tempo_s: ima(a.inicio0 + d, a.id) }], `Aparar ${apelidos.porId[a.id] || ""}`);
    else onOps([{ op: "aparar", clipe: a.id, lado: "fim", tempo_s: ima(a.fim0 + d, a.id) }], `Aparar ${apelidos.porId[a.id] || ""}`);
  };

  useEffect(() => {
    const mover = (x: number, y: number) => {
      const a = arrastoRef.current;
      if (!a) return;
      const dx = x - a.x0;
      const dy = y - a.y0;
      const n = { ...a, dx, dy, moveu: a.moveu || Math.abs(dx) > 3 || Math.abs(dy) > 6 };
      arrastoRef.current = n;
      setArrasto(n);
    };
    const soltar = (y: number) => {
      const a = arrastoRef.current;
      arrastoRef.current = null;
      setArrasto(null);
      if (a) terminar(a, y);
    };
    const mm = (e: MouseEvent) => mover(e.clientX, e.clientY);
    const mu = (e: MouseEvent) => soltar(e.clientY);
    const tm = (e: TouchEvent) => {
      if (!arrastoRef.current || !e.touches.length) return;
      e.preventDefault();
      mover(e.touches[0].clientX, e.touches[0].clientY);
    };
    const te = (e: TouchEvent) => {
      const a = arrastoRef.current;
      if (!a) return;
      soltar(e.changedTouches.length ? e.changedTouches[0].clientY : a.y0 + a.dy);
    };
    window.addEventListener("mousemove", mm);
    window.addEventListener("mouseup", mu);
    window.addEventListener("touchmove", tm, { passive: false });
    window.addEventListener("touchend", te);
    return () => {
      window.removeEventListener("mousemove", mm);
      window.removeEventListener("mouseup", mu);
      window.removeEventListener("touchmove", tm);
      window.removeEventListener("touchend", te);
    };
  });

  // Ctrl + roda: zoom em volta do ponteiro.
  useEffect(() => {
    const el = rolagem.current;
    if (!el) return;
    const roda = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left - LARGURA_DO_CABECALHO + el.scrollLeft;
      const s = x / px;
      const novo = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, px * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
      setPx(Math.round(novo * 100) / 100);
      window.requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, s * novo - (e.clientX - r.left - LARGURA_DO_CABECALHO));
      });
    };
    el.addEventListener("wheel", roda, { passive: false });
    return () => el.removeEventListener("wheel", roda);
  }, [px, setPx]);

  // Tocando: o cursor que sai da tela puxa a rolagem junto.
  useEffect(
    () =>
      relogio.ouvir((s) => {
        const el = rolagem.current;
        if (!el || arrastoRef.current) return;
        const x = s * px;
        const visivel = el.clientWidth - LARGURA_DO_CABECALHO;
        if (x > el.scrollLeft + visivel - 24 && x < el.scrollLeft + visivel * 2) el.scrollLeft = x - 48;
      }),
    [relogio, px],
  );

  const comecar = (e: { clientX: number; clientY: number; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }, tipo: Arrasto["tipo"], c: ClipeDoProjeto, t: TrilhaDoProjeto) => {
    const a: Arrasto = { tipo, id: c.id, trilha: t.id, x0: e.clientX, y0: e.clientY, inicio0: c.inicio_s, fim0: fimDoClipe(c), dx: 0, dy: 0, moveu: false, somar: !!(e.ctrlKey || e.metaKey || e.shiftKey) };
    arrastoRef.current = a;
    setArrasto(a);
  };

  const zoom = (fator: number) => setPx(Math.round(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, px * fator)) * 100) / 100);
  const encaixar = () => {
    const el = rolagem.current;
    const w = el ? el.clientWidth - LARGURA_DO_CABECALHO - 24 : 800;
    setPx(Math.round(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, w / Math.max(1, projeto.duracao_s))) * 100) / 100);
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col" data-linha-do-tempo="">
      <div className="mb-1.5 flex min-w-0 items-center">
        <p className={juntar(texto.rotulo, "mr-2")}>Linha do tempo</p>
        <span className={juntar(texto.auxiliar, "mr-auto tabular-nums")}>
          {tempoFino(projeto.duracao_s)} · {projeto.fps} fps{projeto.fps_informado ? "" : " (provisório)"}
        </span>
        <button type="button" className={botao.icone} onClick={() => zoom(1 / 1.5)} aria-label="Afastar a linha do tempo">
          <Minus className="h-3.5 w-3.5" />
        </button>
        <input type="range" min={ZOOM_MIN} max={ZOOM_MAX} step={1} value={px} onChange={(e) => setPx(Number(e.target.value))} className="mx-1 w-24" aria-label="Zoom da linha do tempo" />
        <button type="button" className={botao.icone} onClick={() => zoom(1.5)} aria-label="Aproximar a linha do tempo">
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={juntar(botao.discreto, "ml-1 h-8")} onClick={encaixar}>
          Caber
        </button>
      </div>
      <div ref={rolagem} className="relative min-h-0 flex-1 overflow-auto rounded-md border border-border [overscroll-behavior:contain]" data-rolagem-da-linha="">
        <div className="relative" style={{ width: LARGURA_DO_CABECALHO + largura }}>
          <Regua px={px} largura={largura} relogio={relogio} marcadores={projeto.marcadores} aoBuscar={(s) => relogio.set(noQuadro(s, fps))} />
          {projeto.trilhas.map((t) => (
            <div key={t.id} className="flex" data-trilha={t.tipo}>
              <CabecalhoDaTrilha t={t} onOps={onOps} />
              <div
                className={juntar("relative border-b border-border", t.oculta && "opacity-40")}
                style={{ width: largura, height: ALTURA[t.tipo] }}
                data-faixa={t.id}
                onMouseDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  relogio.set(noQuadro((e.clientX - r.left) / px, fps));
                  onSelecionar([]);
                }}
              >
                {t.clipes.map((c) => {
                  const ativo = selecao.indexOf(c.id) >= 0;
                  const a = arrasto && arrasto.id === c.id && arrasto.moveu ? arrasto : null;
                  let esquerda = c.inicio_s * px;
                  let w = Math.max(2, duracaoDoClipe(c) * px);
                  if (a && a.tipo === "mover") esquerda += a.dx;
                  if (a && a.tipo === "inicio") {
                    esquerda += a.dx;
                    w -= a.dx;
                  }
                  if (a && a.tipo === "fim") w += a.dx;
                  const fonte = c.fonte ? projeto.fontes[c.fonte] : null;
                  const url = c.fonte ? urls[c.fonte] : null;
                  const visual = (t.tipo === "video" || t.tipo === "sobreposicao") && url && fonte;
                  const n = visual && px >= 12 ? Math.max(1, Math.min(6, Math.floor(w / 90))) : 0;
                  const rotulo = rotuloDoClipe(projeto, c);
                  return (
                    <div
                      key={c.id}
                      className={juntar("group absolute top-1 bottom-1 overflow-hidden rounded border text-left", COR[t.tipo], ativo && "ring-2 ring-primary", a && "z-20 opacity-90 shadow-lg")}
                      style={{ left: esquerda, width: Math.max(2, w), transform: a && a.tipo === "mover" ? `translateY(${a.dy}px)` : undefined, cursor: "grab" }}
                      title={`${apelidos.porId[c.id]} · ${rotulo} · ${tempoFino(c.inicio_s)} a ${tempoFino(fimDoClipe(c))}`}
                      data-clipe={c.id}
                      data-apelido={apelidos.porId[c.id]}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        comecar(e, "mover", c, t);
                      }}
                      onTouchStart={(e) => {
                        e.stopPropagation();
                        if (e.touches.length) comecar(e.touches[0], "mover", c, t);
                      }}
                    >
                      {n > 0 && fonte && url && (
                        <span className="pointer-events-none absolute inset-0 flex">
                          {Array.from({ length: n }).map((_, k) => {
                            const fonteT = fonte.midia === "imagem" ? 0 : c.entrada_s + ((c.saida_s - c.entrada_s) * (k + 0.5)) / n;
                            return fonte.midia === "imagem" ? (
                              <img key={k} src={url} alt="" className="h-full shrink-0 object-cover" style={{ width: w / n }} draggable={false} />
                            ) : (
                              <Miniatura key={k} url={url} tempo={tempoDoQuadro(fonteT, fps)} largura={w / n} />
                            );
                          })}
                        </span>
                      )}
                      <span className={juntar("pointer-events-none relative block truncate px-1.5 text-[11px] font-medium leading-5", n > 0 ? "bg-black/45 text-white" : "text-foreground")}>
                        {fonte && fonte.midia === "imagem" && <IconeImagem className="mr-1 inline h-3 w-3" />}
                        <span className="mr-1 opacity-70">{apelidos.porId[c.id]}</span>
                        {rotulo}
                        {c.velocidade !== 1 ? ` · ${c.velocidade}x` : ""}
                        {c.comparar ? " · antes e depois" : ""}
                      </span>
                      {c.zoom && <span className="pointer-events-none absolute bottom-0.5 right-1 rounded bg-black/50 px-1 text-[9.5px] text-white">zoom {c.zoom.para}</span>}
                      <span
                        className="absolute bottom-0 left-0 top-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/40"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          comecar(e, "inicio", c, t);
                        }}
                        onTouchStart={(e) => {
                          e.stopPropagation();
                          if (e.touches.length) comecar(e.touches[0], "inicio", c, t);
                        }}
                        aria-hidden="true"
                      />
                      <span
                        className="absolute bottom-0 right-0 top-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/40"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          comecar(e, "fim", c, t);
                        }}
                        onTouchStart={(e) => {
                          e.stopPropagation();
                          if (e.touches.length) comecar(e.touches[0], "fim", c, t);
                        }}
                        aria-hidden="true"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          <Cursor relogio={relogio} px={px} />
        </div>
      </div>
    </div>
  );
}
