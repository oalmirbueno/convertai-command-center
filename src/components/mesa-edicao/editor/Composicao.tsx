import { useMemo, type CSSProperties, type ReactNode } from "react";
import { AbsoluteFill, getRemotionEnvironment, Html5Audio, Html5Video, Img, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion";
import { duracaoDoClipe, mixagemPadrao, type ClipeDoProjeto, type ProjetoDeEdicao, type TrilhaDoProjeto } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import { dbParaGanho, ganhoDaTrilhaDb, MIXAGEM_PADRAO, subidaDaTrilhaDb, trechosDeFala } from "../../../../supabase/functions/mesa-motion/modulos/som-do-editor";
import { falaNaLinhaDoTempo } from "../../../lib/editor/transcricao";
import { definicaoDaPeca, parametrosDaPeca, type IdDaPeca, type ParametrosDaPeca } from "../../../lib/editor/motion/catalogo";
import { CarregarFontes, PecaDeMotion } from "./motion/Pecas";

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

const VERDE = "#00FF66";
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
function movimento(c: ClipeDoProjeto, frame: number, dur: number, fps: number): CSSProperties {
  let opacidade = 1;
  let x = 0;
  let escala = c.zoom ? interpolate(frame, [0, Math.max(1, dur - 1)], [c.zoom.de, c.zoom.para], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  const ent = c.transicao_entrada;
  if (ent && ent.tipo !== "corte") {
    const d = Math.max(1, q(ent.duracao_s, fps));
    const t = interpolate(frame, [0, d], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    if (ent.tipo === "fade" || ent.tipo === "dissolver") opacidade *= t;
    if (ent.tipo === "deslizar") x += (1 - t) * 100;
    if (ent.tipo === "zoom") escala *= 1 + (1 - t) * 0.2;
  }
  const sai = c.transicao_saida;
  if (sai && sai.tipo !== "corte") {
    const d = Math.max(1, q(sai.duracao_s, fps));
    const t = interpolate(frame, [dur - d, dur], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    if (sai.tipo === "fade" || sai.tipo === "dissolver") opacidade *= t;
    if (sai.tipo === "deslizar") x -= (1 - t) * 100;
    if (sai.tipo === "zoom") escala *= 1 + (1 - t) * 0.2;
  }
  return { opacity: opacidade, transform: `translateX(${x}%) scale(${escala})`, transformOrigin: "50% 50%" };
}

const cheio: CSSProperties = { position: "absolute", left: 0, top: 0, width: "100%", height: "100%", objectFit: "cover" };

function Midia({ projeto, urls, fonte, entrada_s, velocidade, volume, muda, estilo }: { projeto: ProjetoDeEdicao; urls: Record<string, string>; fonte: string | null; entrada_s: number; velocidade: number; volume: number; muda: boolean; estilo?: CSSProperties }) {
  const f = fonte ? projeto.fontes[fonte] : null;
  const url = fonte ? resolverUrl(urls[fonte]) : null;
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

function ClipeVisual({ projeto, urls, trilha, c }: { projeto: ProjetoDeEdicao; urls: Record<string, string>; trilha: TrilhaDoProjeto; c: ClipeDoProjeto }) {
  const frame = useCurrentFrame();
  const fps = projeto.fps;
  const dur = Math.max(1, q(duracaoDoClipe(c), fps));
  const mov = movimento(c, frame, dur, fps);
  const sobre = trilha.tipo === "sobreposicao";
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
    <div style={{ ...caixa, ...mov }}>
      <Midia projeto={projeto} urls={urls} fonte={c.fonte} entrada_s={c.entrada_s} velocidade={c.velocidade} volume={c.volume} muda={trilha.muda} />
    </div>
  );
}

function ClipeDeTexto({ projeto, trilha, c }: { projeto: ProjetoDeEdicao; trilha: TrilhaDoProjeto; c: ClipeDoProjeto }) {
  const frame = useCurrentFrame();
  const fps = projeto.fps;
  const dur = Math.max(1, q(duracaoDoClipe(c), fps));
  const L = projeto.largura;
  const legenda = trilha.tipo === "legenda";
  const preset = estiloTxt(c, "preset", legenda ? "destaque" : "simples");
  const posicao = estiloTxt(c, "posicao", legenda ? "base" : "meio");
  const topo = posicao === "topo" ? "12%" : posicao === "base" ? "72%" : "45%";
  const tamanho = estiloNum(c, "tamanho", legenda ? 0.058 : 0.07) * L;
  const agora = frame / fps;
  const palavras = legenda && c.estilo && Array.isArray((c.estilo as Record<string, unknown>).palavras) ? ((c.estilo as Record<string, unknown>).palavras as { t: string; i: number; f: number }[]) : null;
  const mov = movimento(c, frame, dur, fps);
  const entrada = legenda ? interpolate(frame, [0, 3], [0.92, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  const caixa = preset === "caixa";
  return (
    <div style={{ position: "absolute", left: "7%", right: "7%", top: topo, display: "flex", justifyContent: "center", ...mov }}>
      <div
        style={{
          fontFamily: "Outfit, Inter, sans-serif",
          fontWeight: 800,
          fontSize: tamanho,
          lineHeight: 1.15,
          textAlign: "center",
          color: caixa ? "#111" : "#fff",
          background: caixa ? "#fff" : "transparent",
          padding: caixa ? `${tamanho * 0.15}px ${tamanho * 0.35}px` : 0,
          borderRadius: caixa ? tamanho * 0.2 : 0,
          textShadow: caixa ? "none" : "0 2px 10px rgba(0,0,0,0.65)",
          transform: `scale(${entrada})`,
        }}
      >
        {palavras && preset !== "simples"
          ? palavras.map((w, k) => {
              const falando = agora >= w.i && agora < Math.max(w.f, w.i + 0.08);
              return (
                <span key={k} style={{ color: falando ? (caixa ? "#0a7a2f" : VERDE) : undefined }}>
                  {w.t}
                  {k < palavras.length - 1 ? " " : ""}
                </span>
              );
            })
          : c.texto}
      </div>
    </div>
  );
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

const ORDEM: Record<string, number> = { video: 0, sobreposicao: 1, texto: 2, legenda: 3, audio: 4 };

export function ComposicaoDoProjeto({ projeto, urls, publico, mix, cor_da_marca }: PropsDaComposicao) {
  const fps = projeto.fps;
  const origem = publico === "estatico" ? "estatico" : "painel";
  // A fala da linha do tempo (para a trilha abaixar na voz): uma conta por projeto, não por quadro.
  const fala = useMemo(() => trechosDeFala(falaNaLinhaDoTempo(projeto)), [projeto]);
  const ganhos = (mix && mix.ganhos_db) || {};
  const trilhas = projeto.trilhas
    .map((t, i) => ({ t, i }))
    .filter((x) => !x.t.oculta)
    // Vídeo principal (a primeira trilha de vídeo) embaixo; as outras por cima, na ordem do projeto.
    .sort((a, b) => ORDEM[a.t.tipo] - ORDEM[b.t.tipo] || a.i - b.i);
  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      <CarregarFontes url={(c) => urlPublica(c, origem)} />
      {trilhas.map(({ t }) =>
        t.clipes.map((c) => {
          const de = q(c.inicio_s, fps);
          const d = Math.max(1, q(duracaoDoClipe(c), fps));
          return (
            <Sequence key={`${t.id}:${c.id}`} from={de} durationInFrames={d} layout="none" name={`${t.nome} ${c.id}`}>
              {c.estilo && typeof (c.estilo as Record<string, unknown>).peca === "string" && t.tipo !== "audio" && t.tipo !== "video" ? (
                <ClipeDePeca projeto={projeto} urls={urls} c={c} corDaMarca={cor_da_marca || null} />
              ) : t.tipo === "video" || t.tipo === "sobreposicao" ? (
                <ClipeVisual projeto={projeto} urls={urls} trilha={t} c={c} />
              ) : t.tipo === "audio" ? (
                <ClipeDeAudio projeto={projeto} urls={urls} trilha={t} c={c} fala={fala} ganhoMedidoDb={typeof ganhos[c.id] === "number" ? ganhos[c.id] : null} />
              ) : (
                <ClipeDeTexto projeto={projeto} trilha={t} c={c} />
              )}
            </Sequence>
          );
        }),
      )}
    </AbsoluteFill>
  );
}

export const quadrosDoProjeto = (p: ProjetoDeEdicao) => Math.max(1, Math.round(p.duracao_s * p.fps));
