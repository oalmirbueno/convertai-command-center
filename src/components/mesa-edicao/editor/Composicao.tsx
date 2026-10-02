import { useMemo, type CSSProperties, type ReactNode } from "react";
import { AbsoluteFill, getRemotionEnvironment, Html5Audio, Html5Video, Img, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion";
import { chaveDaFonteDaMarca, corPadrao, duracaoDoClipe, enquadramentoPadrao, mixagemPadrao, type ClipeDoProjeto, type CorDoProjeto, type ProjetoDeEdicao, type TrilhaDoProjeto } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import { dbParaGanho, ganhoDaTrilhaDb, MIXAGEM_PADRAO, subidaDaTrilhaDb, trechosDeFala } from "../../../../supabase/functions/mesa-motion/modulos/som-do-editor";
import { falaNaLinhaDoTempo } from "../../../lib/editor/transcricao";
import { definicaoDaPeca, parametrosDaPeca, type IdDaPeca, type ParametrosDaPeca } from "../../../lib/editor/motion/catalogo";
import { CarregarFonteDaMarca, CarregarFontes, PecaDeMotion } from "./motion/Pecas";
import { filtroDaCor, type FiltroDaCor } from "../../../lib/editor/cor";
import { cameraNoTempo } from "../../../lib/editor/efeitos";
import { recortePara, rostoNoTempo } from "../../../lib/editor/reenquadre";
import TextoNaTela from "./TextoNaTela";
// Frente CNV: camada do Quadro animado do Canvas (clipe com estilo.camada).
import { CamadaNaComposicao } from "../../mesa-foto/canvas/quadro/CamadaNaComposicao";

/**
 * Composição Remotion gerada do projeto de edição (frente V-B). A MESMA
 * composição serve a prévia (Player no navegador) e o render final (máquina
 * da agência ou Lambda, docs/video/EDITOR.md): tudo sai do quadro atual
 * (useCurrentFrame), sem relógio, sem sorteio. Ordem das camadas: vídeo
 * principal embaixo, depois as outras trilhas de vídeo, sobreposição, texto e
 * legenda por cima; áudio fora da imagem.
 */

export interface PropsDaComposicao {
  projeto: ProjetoDeEdicao;
  /** URL de cada fonte (chave da fonte -> URL assinada). No worker: "estatico:<arquivo baixado>". */
  urls: Record<string, string>;
  /**
   * Frente EDT: de onde vêm as fontes de letra do motion. "painel" (padrão):
   * /editor/... do próprio painel; "estatico": a pasta pública do render (staticFile).
   */
  publico?: "painel" | "estatico";
  /** Frente EDT: medidas do worker (ganho de cada trilha em dB, pela voz medida em LUFS). */
  mix?: { ganhos_db?: Record<string, number> } | null;
  /** Cor da marca do cliente (peças de motion sem cor própria). */
  cor_da_marca?: string | null;
  [chave: string]: unknown;
}

/** URL que a composição usa: "estatico:x" vira o arquivo da pasta pública do render. */
export function resolverUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  return u.indexOf("estatico:") === 0 ? staticFile(u.slice(9)) : u;
}

export const urlPublica = (caminho: string, publico: "painel" | "estatico") => (publico === "estatico" ? staticFile(caminho) : `/${caminho}`);

const q = (s: number, fps: number) => Math.round(s * fps);

function estiloNum(c: ClipeDoProjeto, k: string, padrao: number): number {
  const v = c.estilo ? Number((c.estilo as Record<string, unknown>)[k]) : NaN;
  return isFinite(v) ? v : padrao;
}
const estiloTxt = (c: ClipeDoProjeto, k: string, padrao: string) => {
  const v = c.estilo ? (c.estilo as Record<string, unknown>)[k] : undefined;
  return typeof v === "string" && v ? v : padrao;
};

/** Opacidade, deslocamento e escala de entrada/saída + zoom do clipe, no quadro local. */
function movimento(c: ClipeDoProjeto, frame: number, dur: number, fps: number): CSSProperties & { flash?: number } {
  let opacidade = 1;
  let x = 0;
  let desfoque = 0;
  let flash = 0;
  let escala = c.zoom ? interpolate(frame, [0, Math.max(1, dur - 1)], [c.zoom.de, c.zoom.para], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  const ent = c.transicao_entrada;
  if (ent && ent.tipo !== "corte") {
    const d = Math.max(1, q(ent.duracao_s, fps));
    const t = interpolate(frame, [0, d], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    if (ent.tipo === "fade" || ent.tipo === "dissolver") opacidade *= t;
    if (ent.tipo === "deslizar") x += (1 - t) * 100;
    if (ent.tipo === "zoom") escala *= 1 + (1 - t) * 0.2;
    // Rodada 2: flash (clarão que some), whip (chicote com borrão) e desfoque.
    if (ent.tipo === "flash") flash = Math.max(flash, 1 - t);
    if (ent.tipo === "whip") {
      x += (1 - t) * 60;
      desfoque = Math.max(desfoque, (1 - t) * 24);
    }
    if (ent.tipo === "desfoque") desfoque = Math.max(desfoque, (1 - t) * 30);
  }
  const sai = c.transicao_saida;
  if (sai && sai.tipo !== "corte") {
    const d = Math.max(1, q(sai.duracao_s, fps));
    const t = interpolate(frame, [dur - d, dur], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    if (sai.tipo === "fade" || sai.tipo === "dissolver") opacidade *= t;
    if (sai.tipo === "deslizar") x -= (1 - t) * 100;
    if (sai.tipo === "zoom") escala *= 1 + (1 - t) * 0.2;
    if (sai.tipo === "flash") flash = Math.max(flash, 1 - t);
    if (sai.tipo === "whip") {
      x -= (1 - t) * 60;
      desfoque = Math.max(desfoque, (1 - t) * 24);
    }
    if (sai.tipo === "desfoque") desfoque = Math.max(desfoque, (1 - t) * 30);
  }
  return { opacity: opacidade, transform: `translateX(${x}%) scale(${escala})`, transformOrigin: "50% 50%", filter: desfoque > 0.3 ? `blur(${Math.round(desfoque)}px)` : undefined, flash };
}

const cheio: CSSProperties = { position: "absolute", left: 0, top: 0, width: "100%", height: "100%", objectFit: "cover" };

/**
 * Recorte do vídeo no quadro de saída (rodada 2): foco manual do clipe
 * (estilo.foco_x/foco_y) ou o rosto rastreado da fonte no tempo DA FONTE.
 * Sem nenhum dos dois, o centro (como antes).
 */
export function recorteDoClipe(projeto: ProjetoDeEdicao, c: ClipeDoProjeto, tFonte: number): { posicao: string | undefined; focoX: number; focoY: number; meiaAltura: number } {
  const f = c.fonte ? projeto.fontes[c.fonte] : null;
  if (!f) return { posicao: undefined, focoX: 0.5, focoY: 0.5, meiaAltura: 0 };
  const e = (c.estilo || {}) as Record<string, unknown>;
  const fx = Number(e.foco_x);
  const fy = Number(e.foco_y);
  let alvo: { x: number; y: number; w: number } | null = isFinite(fx) && isFinite(fy) && e.foco_x !== null && e.foco_y !== null && e.foco_x !== undefined ? { x: fx, y: fy, w: 0 } : null;
  const enq = projeto.enquadramento || enquadramentoPadrao();
  if (!alvo && enq.seguir_rosto && projeto.rostos && projeto.rostos[f.chave]) {
    const r = rostoNoTempo(projeto.rostos[f.chave], tFonte, enq.suavidade);
    if (r) alvo = { x: r.x, y: r.y, w: r.w };
  }
  if (!alvo) return { posicao: undefined, focoX: 0.5, focoY: 0.5, meiaAltura: 0 };
  const rc = recortePara(f.largura, f.altura, projeto.largura, projeto.altura, alvo.x, alvo.y);
  // Meia altura do rosto na saída (rosto ~1,3x mais alto que largo), para a zona protegida do texto.
  const escala = f.largura && f.altura ? Math.max(projeto.largura / f.largura, projeto.altura / f.altura) : 0;
  const meiaAltura = escala && alvo.w ? Math.min(0.5, (alvo.w * (f.largura as number) * escala * 1.3) / 2 / projeto.altura) : 0;
  return { posicao: `${Math.round(rc.x * 100) / 100}% ${Math.round(rc.y * 100) / 100}%`, focoX: rc.focoX, focoY: rc.focoY, meiaAltura };
}

function Midia({ projeto, urls, fonte, entrada_s, velocidade, volume, muda, estilo, posicao }: { projeto: ProjetoDeEdicao; urls: Record<string, string>; fonte: string | null; entrada_s: number; velocidade: number; volume: number; muda: boolean; estilo?: CSSProperties; posicao?: string }) {
  const f = fonte ? projeto.fontes[fonte] : null;
  const url = fonte ? resolverUrl(urls[fonte]) : null;
  if (posicao) estilo = { ...estilo, objectPosition: posicao };
  if (!f || !url) {
    return (
      <AbsoluteFill style={{ background: "#111", color: "#777", alignItems: "center", justifyContent: "center", fontSize: projeto.largura * 0.03, fontFamily: "Outfit, sans-serif" }}>
        {f ? f.nome : "Sem mídia"}
      </AbsoluteFill>
    );
  }
  if (f.midia === "imagem") return <Img src={url} style={{ ...cheio, ...estilo }} />;
  // No render (worker), o vídeo sai quadro a quadro exato pelo OffthreadVideo; na prévia, o Html5Video.
  if (getRemotionEnvironment().isRendering) {
    // Frente MOT: a cena da Mesa Motion vem em WebM com alfa; o quadro sai em PNG para a transparência passar.
    const alfa = /\.webm$/i.test(f.storage_path || "");
    return <OffthreadVideo src={url} transparent={alfa} trimBefore={Math.max(0, Math.round(entrada_s * projeto.fps))} playbackRate={velocidade} volume={muda ? 0 : volume} muted={muda} style={{ ...cheio, ...estilo }} />;
  }
  return (
    <Html5Video
      src={url}
      trimBefore={Math.max(0, Math.round(entrada_s * projeto.fps))}
      playbackRate={velocidade}
      volume={muda ? 0 : volume}
      muted={muda}
      style={{ ...cheio, ...estilo }}
      pauseWhenBuffering
    />
  );
}

function Rotulo({ lado, children, largura }: { lado: "esq" | "dir"; children: ReactNode; largura: number }) {
  return (
    <div
      style={{
        position: "absolute",
        top: largura * 0.04,
        [lado === "esq" ? "left" : "right"]: largura * 0.04,
        padding: `${largura * 0.008}px ${largura * 0.02}px`,
        borderRadius: largura * 0.02,
        background: "rgba(0,0,0,0.55)",
        color: "#fff",
        fontFamily: "Outfit, sans-serif",
        fontSize: largura * 0.03,
        fontWeight: 600,
        letterSpacing: "0.02em",
      }}
    >
      {children}
    </div>
  );
}

function ClipeVisual({ projeto, urls, trilha, c, filtroCss }: { projeto: ProjetoDeEdicao; urls: Record<string, string>; trilha: TrilhaDoProjeto; c: ClipeDoProjeto; filtroCss?: string }) {
  const frame = useCurrentFrame();
  const fps = projeto.fps;
  const dur = Math.max(1, q(duracaoDoClipe(c), fps));
  const { flash, ...mov } = movimento(c, frame, dur, fps);
  if (filtroCss) mov.filter = mov.filter ? `${filtroCss} ${mov.filter}` : filtroCss;
  // 02/10: cena do zero (clipe sem mídia com estilo.fundo): fundo liso ou degradê, na prévia e no render.
  const fundo = !c.fonte ? estiloTxt(c, "fundo", "") : "";
  if (/^#[0-9a-fA-F]{6}$/.test(fundo)) {
    const fundo2 = estiloTxt(c, "fundo2", "");
    return <AbsoluteFill style={{ background: /^#[0-9a-fA-F]{6}$/.test(fundo2) ? `linear-gradient(160deg, ${fundo} 0%, ${fundo2} 100%)` : fundo, ...mov }} data-cena-de-fundo="" />;
  }
  const sobre = trilha.tipo === "sobreposicao";
  const rec = recorteDoClipe(projeto, c, c.entrada_s + (frame / fps) * c.velocidade);
  const clarao = flash && flash > 0.001 ? <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", background: "#ffffff", opacity: Math.min(1, flash * 1.1) }} /> : null;
  const caixa: CSSProperties = sobre
    ? (() => {
        const esc = estiloNum(c, "escala", 0.4);
        const cx = estiloNum(c, "x", 0.75);
        const cy = estiloNum(c, "y", 0.2);
        return { position: "absolute", width: `${esc * 100}%`, height: `${esc * 100}%`, left: `${(cx - esc / 2) * 100}%`, top: `${(cy - esc / 2) * 100}%`, overflow: "hidden", borderRadius: esc >= 0.999 ? 0 : projeto.largura * 0.02 };
      })()
    : { position: "absolute", left: 0, top: 0, width: "100%", height: "100%", overflow: "hidden" };
  // Antes e depois gravado pela V-A (antes_depois_para_editor): cada clipe numa trilha, com
  // estilo { layout: lado_a_lado | cortina | sequencia, par: antes | depois, lado }.
  const layout = estiloTxt(c, "layout", "");
  const par = estiloTxt(c, "par", "");
  if (layout === "lado_a_lado" && !sobre) {
    const direita = estiloTxt(c, "lado", par === "depois" ? "direita" : "esquerda") === "direita";
    return (
      <div style={{ position: "absolute", top: 0, height: "100%", width: "50%", left: direita ? "50%" : 0, overflow: "hidden", ...mov }}>
        <Midia projeto={projeto} urls={urls} fonte={c.fonte} entrada_s={c.entrada_s} velocidade={c.velocidade} volume={c.volume} muda={trilha.muda} />
        {direita && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2, background: "#fff" }} />}
        <Rotulo lado={direita ? "dir" : "esq"} largura={projeto.largura}>
          {par === "depois" ? "Depois" : "Antes"}
        </Rotulo>
      </div>
    );
  }
  if (layout === "cortina" && par === "depois" && !sobre) {
    const fixa = Number((c.estilo as Record<string, unknown>).cortina_posicao);
    const pos = isFinite(fixa) && fixa >= 0 && fixa <= 1 ? fixa * 100 : interpolate(frame, [dur * 0.15, dur * 0.85], [100, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    const recorte = `inset(0 0 0 ${pos}%)`;
    return (
      <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", ...mov }}>
        <div style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, clipPath: recorte, WebkitClipPath: recorte }}>
          <Midia projeto={projeto} urls={urls} fonte={c.fonte} entrada_s={c.entrada_s} velocidade={c.velocidade} volume={0} muda />
        </div>
        <div style={{ position: "absolute", top: 0, bottom: 0, left: `${pos}%`, width: Math.max(2, projeto.largura * 0.004), marginLeft: -Math.max(1, projeto.largura * 0.002), background: "#fff" }} />
        <Rotulo lado="dir" largura={projeto.largura}>
          Depois
        </Rotulo>
      </div>
    );
  }
  const k = c.comparar;
  if (k && projeto.fontes[k.fonte_b]) {
    const L = projeto.largura;
    const A = <Midia projeto={projeto} urls={urls} fonte={c.fonte} entrada_s={c.entrada_s} velocidade={c.velocidade} volume={c.volume} muda={trilha.muda} />;
    const B = <Midia projeto={projeto} urls={urls} fonte={k.fonte_b} entrada_s={k.entrada_b_s} velocidade={c.velocidade} volume={0} muda />;
    let corpo: ReactNode;
    if (k.modo === "lado_a_lado_h" || k.modo === "lado_a_lado_v") {
      const h = k.modo === "lado_a_lado_h";
      const metade: CSSProperties = h ? { position: "absolute", top: 0, height: "100%", width: "50%", overflow: "hidden" } : { position: "absolute", left: 0, width: "100%", height: "50%", overflow: "hidden" };
      corpo = (
        <>
          <div style={{ ...metade, ...(h ? { left: 0 } : { top: 0 }) }}>{A}</div>
          <div style={{ ...metade, ...(h ? { left: "50%" } : { top: "50%" }) }}>{B}</div>
          <div style={h ? { position: "absolute", left: "50%", top: 0, bottom: 0, width: 2, marginLeft: -1, background: "#fff" } : { position: "absolute", top: "50%", left: 0, right: 0, height: 2, marginTop: -1, background: "#fff" }} />
        </>
      );
    } else if (k.modo === "alternar") {
      corpo = frame < dur / 2 ? A : B;
    } else {
      // Cortina atravessa a tela no meio do clipe; divisão fica parada em 50%.
      const pos = k.modo === "cortina" ? interpolate(frame, [dur * 0.15, dur * 0.85], [100, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 50;
      const recorte = `inset(0 0 0 ${pos}%)`;
      corpo = (
        <>
          {A}
          <div style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, clipPath: recorte, WebkitClipPath: recorte }}>{B}</div>
          <div style={{ position: "absolute", top: 0, bottom: 0, left: `${pos}%`, width: Math.max(2, L * 0.004), marginLeft: -Math.max(1, L * 0.002), background: "#fff", boxShadow: "0 0 12px rgba(0,0,0,0.4)" }} />
        </>
      );
    }
    const mostrarA = k.modo !== "alternar" || frame < dur / 2;
    const mostrarB = k.modo !== "alternar" || frame >= dur / 2;
    return (
      <div style={{ ...caixa, ...mov }}>
        {corpo}
        {k.rotulos && mostrarA && <Rotulo lado="esq" largura={L}>{k.rotulo_a}</Rotulo>}
        {k.rotulos && mostrarB && <Rotulo lado="dir" largura={L}>{k.rotulo_b}</Rotulo>}
      </div>
    );
  }
  return (
    <>
      <div style={{ ...caixa, ...mov }}>
        <Midia projeto={projeto} urls={urls} fonte={c.fonte} entrada_s={c.entrada_s} velocidade={c.velocidade} volume={c.volume} muda={trilha.muda} posicao={rec.posicao} />
      </div>
      {clarao}
    </>
  );
}

function ClipeDeTexto({ projeto, trilha, c, rosto }: { projeto: ProjetoDeEdicao; trilha: TrilhaDoProjeto; c: ClipeDoProjeto; rosto: { y: number; meia: number } | null }) {
  const frame = useCurrentFrame();
  return <TextoNaTela projeto={projeto} legenda={trilha.tipo === "legenda"} c={c} frame={frame} rosto={rosto} />;
}

/**
 * Áudio (frente EDT, F3): clipe com estilo.papel "trilha" fica 22 dB abaixo da
 * voz (medida pelo worker; na prévia, a voz e a trilha presumidas) e sobe nas
 * pausas longas (duck pela fala da linha do tempo). "efeito" e o resto: volume do clipe.
 */
function ClipeDeAudio({ projeto, urls, trilha, c, fala, ganhoMedidoDb }: { projeto: ProjetoDeEdicao; urls: Record<string, string>; trilha: TrilhaDoProjeto; c: ClipeDoProjeto; fala: { de_s: number; ate_s: number }[]; ganhoMedidoDb: number | null }) {
  const url = c.fonte ? resolverUrl(urls[c.fonte]) : null;
  if (!url || trilha.muda) return null;
  const papel = estiloTxt(c, "papel", "");
  if (papel === "trilha") {
    const mix = projeto.mixagem || mixagemPadrao();
    const doClipe = estiloNumOuNulo(c, "ganho_db");
    const base = ganhoMedidoDb !== null ? ganhoMedidoDb : doClipe !== null ? doClipe : ganhoDaTrilhaDb(MIXAGEM_PADRAO.voz_presumida_lufs, MIXAGEM_PADRAO.trilha_presumida_lufs, mix.trilha_abaixo_da_voz_db);
    const fps = projeto.fps;
    const fim = projeto.duracao_s;
    const volume = (f: number) => {
      const t = c.inicio_s + f / fps;
      const sobe = mix.duck ? subidaDaTrilhaDb(t, fala, { subida_db: mix.subida_nas_pausas_db, fim_s: fim }) : 0;
      return Math.min(2, c.volume * dbParaGanho(base + sobe));
    };
    return <Html5Audio src={url} trimBefore={Math.max(0, Math.round(c.entrada_s * projeto.fps))} playbackRate={c.velocidade} volume={volume} pauseWhenBuffering />;
  }
  return <Html5Audio src={url} trimBefore={Math.max(0, Math.round(c.entrada_s * projeto.fps))} playbackRate={c.velocidade} volume={c.volume} pauseWhenBuffering />;
}

function estiloNumOuNulo(c: ClipeDoProjeto, k: string): number | null {
  const v = c.estilo ? Number((c.estilo as Record<string, unknown>)[k]) : NaN;
  return c.estilo && (c.estilo as Record<string, unknown>)[k] !== undefined && isFinite(v) ? v : null;
}

/** Peça de motion (estilo.peca): parâmetros conferidos pelo catálogo; peça quebrada não derruba o vídeo. */
function ClipeDePeca({ projeto, urls, c, corDaMarca }: { projeto: ProjetoDeEdicao; urls: Record<string, string>; c: ClipeDoProjeto; corDaMarca: string | null }) {
  const e = (c.estilo || {}) as Record<string, unknown>;
  const id = String(e.peca || "") as IdDaPeca;
  const chave = JSON.stringify(e.params || null);
  const params = useMemo<ParametrosDaPeca | null>(() => {
    if (!definicaoDaPeca(id)) return null;
    try {
      return parametrosDaPeca(id, (e.params as Record<string, unknown>) || {});
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, chave]);
  if (!params) return null;
  const tempos = Array.isArray(e.tempos) ? (e.tempos as unknown[]).map(Number).filter((n) => isFinite(n)) : undefined;
  const dur = Math.max(1, q(duracaoDoClipe(c), projeto.fps));
  return <PecaDeMotion peca={id} params={params} tempos={tempos} desdeS={Number(e._desde_s) || 0} duracaoQuadros={dur} imagem={c.fonte ? resolverUrl(urls[c.fonte]) : null} corDaMarca={corDaMarca} />;
}

const ORDEM: Record<string, number> = { video: 0, sobreposicao: 1, texto: 2, legenda: 3, audio: 4, ajuste: 5 };

/** Filtro SVG de uma cor (rodada 2): LUT aproximada (matriz e curvas, na força escolhida), tom e matriz de cor. */
function FiltroSvg({ id, f }: { id: string; f: FiltroDaCor }) {
  return (
    <filter id={id} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
      {f.lut && <feColorMatrix type="matrix" in="SourceGraphic" values={f.lut.matriz} result="lutm" />}
      {f.lut && (
        <feComponentTransfer in="lutm" result="lutc">
          <feFuncR type="table" tableValues={f.lut.r} />
          <feFuncG type="table" tableValues={f.lut.g} />
          <feFuncB type="table" tableValues={f.lut.b} />
        </feComponentTransfer>
      )}
      {f.lut && <feComposite in="lutc" in2="SourceGraphic" operator="arithmetic" k1={0} k2={f.lut.forca} k3={1 - f.lut.forca} k4={0} result="lut" />}
      {f.tom && (
        <feComponentTransfer result="tom">
          <feFuncR type="table" tableValues={f.tom} />
          <feFuncG type="table" tableValues={f.tom} />
          <feFuncB type="table" tableValues={f.tom} />
        </feComponentTransfer>
      )}
      {f.matriz && <feColorMatrix type="matrix" values={f.matriz} />}
    </filter>
  );
}

const idDoFiltro = (chave: string) => `cor-${chave.replace(/[^a-z0-9_-]/gi, "")}`;

/** Onde o rosto está na saída (0 a 1) no tempo t da linha: a legenda "automática" desvia dele. */
export function rostoNaSaida(projeto: ProjetoDeEdicao, t: number): { x: number; y: number; meia: number } | null {
  const v = projeto.trilhas.find((x) => x.tipo === "video" && !x.oculta);
  if (!v || !projeto.rostos) return null;
  const c = v.clipes.find((x) => t >= x.inicio_s && t < x.inicio_s + duracaoDoClipe(x));
  if (!c || !c.fonte || !projeto.rostos[c.fonte]) return null;
  const r = recorteDoClipe(projeto, c, c.entrada_s + (t - c.inicio_s) * c.velocidade);
  return r.posicao ? { x: r.focoX, y: r.focoY, meia: r.meiaAltura } : null;
}

/**
 * Câmera da camada de ajuste (rodada 2): as trilhas de vídeo andam juntas
 * (zoom, tremor, desfoque) com a origem no rosto, e ganham a cor do projeto
 * (ou a do trecho). Legenda e texto ficam fora, por cima.
 */
function GrupoDeVideo({ projeto, children, corBase, filtroBase }: { projeto: ProjetoDeEdicao; children: ReactNode; corBase: CorDoProjeto; filtroBase: string | null }) {
  const frame = useCurrentFrame();
  const t = frame / projeto.fps;
  const cam = cameraNoTempo(projeto, t, corBase);
  const rosto = cam.escala !== 1 ? rostoNaSaida(projeto, t) : null;
  const filtros: string[] = [];
  const f = cam.cor ? filtroDaCor(cam.cor.cor) : null;
  if (cam.cor && f && !f.neutro) filtros.push(`url(#${idDoFiltro(cam.cor.id)})`);
  else if (!cam.cor && filtroBase) filtros.push(filtroBase);
  if (cam.desfoque > 0) filtros.push(`blur(${Math.round(cam.desfoque * projeto.largura)}px)`);
  const vinheta = cam.cor && f ? f.vinheta : 0;
  return (
    <>
      <AbsoluteFill
        style={{
          transform: `translate(${Math.round(cam.dx * 10000) / 100}%, ${Math.round(cam.dy * 10000) / 100}%) scale(${Math.round(cam.escala * 10000) / 10000})`,
          transformOrigin: rosto ? `${Math.round(rosto.x * 1000) / 10}% ${Math.round(rosto.y * 1000) / 10}%` : "50% 50%",
          filter: filtros.length ? filtros.join(" ") : undefined,
        }}
      >
        {children}
      </AbsoluteFill>
      {vinheta > 0 && <Vinheta forca={vinheta} />}
      {cam.flash && <AbsoluteFill style={{ background: cam.flash.cor, opacity: cam.flash.opacidade }} />}
    </>
  );
}

function Vinheta({ forca }: { forca: number }) {
  return <AbsoluteFill style={{ background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,${Math.round(Math.min(1, forca) * 85) / 100}) 100%)` }} />;
}

export function ComposicaoDoProjeto({ projeto, urls, publico, mix, cor_da_marca }: PropsDaComposicao) {
  const fps = projeto.fps;
  const origem = publico === "estatico" ? "estatico" : "painel";
  // A fala da linha do tempo (para a trilha abaixar na voz): uma conta por projeto, não por quadro.
  // Frente MOV: a narração (trilha de áudio com papel "voz", fala por palavra da ElevenLabs) também abaixa a música.
  const fala = useMemo(() => {
    const vozes = projeto.trilhas.filter((t) => t.tipo === "audio" && t.clipes.some((c) => estiloTxt(c, "papel", "") === "voz"));
    return trechosDeFala(vozes.reduce((l, t) => l.concat(falaNaLinhaDoTempo(projeto, t.id)), falaNaLinhaDoTempo(projeto)));
  }, [projeto]);
  const ganhos = (mix && mix.ganhos_db) || {};
  const corBase = projeto.cor || corPadrao();
  const corDaMarca = (projeto.identidade && projeto.identidade.cor) || cor_da_marca || null;
  const idDaMarca = projeto.identidade;
  const letraDaMarca = idDaMarca && idDaMarca.fonte && idDaMarca.fonte_path ? { familia: idDaMarca.fonte, url: resolverUrl(urls[chaveDaFonteDaMarca(idDaMarca.fonte_path)]) } : null;
  // Filtros de cor: o do projeto e um por clipe "cor" da camada de ajuste (desenhados uma vez).
  const filtros = useMemo(() => {
    const lista: { id: string; f: FiltroDaCor }[] = [];
    const base = filtroDaCor(corBase);
    if (!base.neutro && (base.lut || base.tom || base.matriz)) lista.push({ id: idDoFiltro("base"), f: base });
    projeto.trilhas.forEach((t) => {
      if (t.tipo !== "ajuste") return;
      t.clipes.forEach((c) => {
        const e = (c.estilo || {}) as Record<string, unknown>;
        if (e.efeito !== "cor") return;
        const cam = cameraNoTempo({ ...projeto, trilhas: [{ ...t, oculta: false, clipes: [c] }] }, c.inicio_s + 1e-3, corBase);
        if (!cam.cor) return;
        const f = filtroDaCor(cam.cor.cor);
        if (!f.neutro && (f.lut || f.tom || f.matriz)) lista.push({ id: idDoFiltro(c.id), f });
      });
    });
    return { lista, base: base.neutro ? null : base };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projeto.cor, projeto.trilhas]);
  const filtroBase = filtros.lista.some((x) => x.id === idDoFiltro("base")) ? `url(#${idDoFiltro("base")})` : null;
  const trilhas = projeto.trilhas
    .map((t, i) => ({ t, i }))
    .filter((x) => !x.t.oculta && x.t.tipo !== "ajuste")
    // Vídeo principal (a primeira trilha de vídeo) embaixo; as outras por cima, na ordem do projeto.
    .sort((a, b) => ORDEM[a.t.tipo] - ORDEM[b.t.tipo] || a.i - b.i);
  const camada = (tipos: string[]) =>
    trilhas
      .filter(({ t }) => tipos.indexOf(t.tipo) >= 0)
      .map(({ t }) =>
        t.clipes.map((c) => {
          const de = q(c.inicio_s, fps);
          const d = Math.max(1, q(duracaoDoClipe(c), fps));
          const peca = c.estilo && typeof (c.estilo as Record<string, unknown>).peca === "string";
          return (
            <Sequence key={`${t.id}:${c.id}`} from={de} durationInFrames={d} layout="none" name={`${t.nome} ${c.id}`}>
              {c.estilo && typeof (c.estilo as Record<string, unknown>).camada === "object" && t.tipo === "sobreposicao" ? (
                <CamadaNaComposicao estilo={c.estilo as Record<string, unknown>} url={c.fonte ? urls[c.fonte] : null} entrada_s={c.entrada_s} duracao_s={duracaoDoClipe(c)} />
              ) : peca && t.tipo !== "audio" && t.tipo !== "video" ? (
                <ClipeDePeca projeto={projeto} urls={urls} c={c} corDaMarca={corDaMarca} />
              ) : t.tipo === "video" || t.tipo === "sobreposicao" ? (
                <ClipeVisual projeto={projeto} urls={urls} trilha={t} c={c} filtroCss={t.tipo === "sobreposicao" && c.fonte && projeto.fontes[c.fonte] && projeto.fontes[c.fonte].midia !== "imagem" ? filtroBase || undefined : undefined} />
              ) : t.tipo === "audio" ? (
                <ClipeDeAudio projeto={projeto} urls={urls} trilha={t} c={c} fala={fala} ganhoMedidoDb={typeof ganhos[c.id] === "number" ? ganhos[c.id] : null} />
              ) : (
                <ClipeDeTexto projeto={projeto} trilha={t} c={c} rosto={rostoNaSaida(projeto, c.inicio_s + duracaoDoClipe(c) / 2)} />
              )}
            </Sequence>
          );
        }),
      );
  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      <CarregarFontes url={(c) => urlPublica(c, origem)} />
      {letraDaMarca && <CarregarFonteDaMarca familia={letraDaMarca.familia} url={letraDaMarca.url} />}
      {filtros.lista.length > 0 && (
        <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
          <defs>
            {filtros.lista.map((x) => (
              <FiltroSvg key={x.id} id={x.id} f={x.f} />
            ))}
          </defs>
        </svg>
      )}
      <GrupoDeVideo projeto={projeto} corBase={corBase} filtroBase={filtroBase}>
        {camada(["video"])}
      </GrupoDeVideo>
      {camada(["sobreposicao"])}
      {filtros.base && filtros.base.vinheta > 0 && <Vinheta forca={filtros.base.vinheta} />}
      {camada(["texto", "legenda"])}
      {camada(["audio"])}
    </AbsoluteFill>
  );
}

export const quadrosDoProjeto = (p: ProjetoDeEdicao) => Math.max(1, Math.round(p.duracao_s * p.fps));
