import type { CSSProperties, ReactNode } from "react";
import { interpolate } from "remotion";
import { duracaoDoClipe, type ClipeDoProjeto, type ProjetoDeEdicao } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import { alturaDaPosicao, alturaDoBloco, corSobre, VERDE_DA_CASA, type RostoNoQuadro } from "../../../lib/editor/estilosDeTexto";

/**
 * Legenda e texto na tela (frente EDT, rodada 2): os estilos do catálogo
 * (src/lib/editor/estilosDeTexto.ts) desenhados no quadro. A MESMA peça serve
 * a prévia e o render. Cores da marca guardada no projeto; posição "auto"
 * desvia do rosto rastreado. Tudo sai do quadro (sem relógio).
 */

const SANS = "Montserrat, Outfit, Inter, sans-serif";
const FORTE = "Anton, Montserrat, sans-serif";
const MAO = "Caveat, Montserrat, sans-serif";

const txt = (c: ClipeDoProjeto, k: string, padrao: string) => {
  const v = c.estilo ? (c.estilo as Record<string, unknown>)[k] : undefined;
  return typeof v === "string" && v ? v : padrao;
};
const nume = (c: ClipeDoProjeto, k: string, padrao: number) => {
  const v = c.estilo ? Number((c.estilo as Record<string, unknown>)[k]) : NaN;
  return isFinite(v) ? v : padrao;
};
const hex = (v: string | null | undefined, padrao: string) => (v && /^#[0-9a-fA-F]{6}$/.test(v) ? v : padrao);

export interface PropsDoTexto {
  projeto: ProjetoDeEdicao;
  legenda: boolean;
  c: ClipeDoProjeto;
  frame: number;
  /** Onde o rosto está na saída (centro e meia altura, 0 a 1), para o "auto" desviar. */
  rosto: RostoNoQuadro | null;
}

type Palavra = { t: string; i: number; f: number };

export default function TextoNaTela({ projeto, legenda, c, frame, rosto }: PropsDoTexto) {
  const fps = projeto.fps;
  const L = projeto.largura;
  const dur = Math.max(1, Math.round(duracaoDoClipe(c) * fps));
  const agora = frame / fps;
  const id = projeto.identidade;
  const corMarca = hex(txt(c, "cor", "") || (id && id.cor) || null, VERDE_DA_CASA);
  const preset = txt(c, "preset", legenda ? "destaque" : "simples");
  const posicao = txt(c, "posicao", legenda || preset === "manchete" || preset === "tarja" || preset === "titulo" ? "auto" : preset === "nome" ? "base" : "meio");
  // Letra escolhida no clipe ou a da marca, entre aspas (nome com espaço ou número) e com a reserva do painel.
  const letra = txt(c, "fonte", (id && id.fonte) || "");
  const fonteEscolhida = letra ? `"${letra.replace(/["\\]/g, "")}", ${SANS}` : "";
  const palavras: Palavra[] | null = legenda && c.estilo && Array.isArray((c.estilo as Record<string, unknown>).palavras) ? ((c.estilo as Record<string, unknown>).palavras as Palavra[]) : null;
  const tamanhoDoBloco = nume(c, "tamanho", legenda ? 0.058 : preset === "titulo" ? 0.085 : 0.065) * L;
  const topo = `${Math.round(alturaDaPosicao(posicao, legenda, rosto, alturaDoBloco((c.texto || "").length, tamanhoDoBloco, L, projeto.altura)) * 1000) / 10}%`;
  // Entrada e saída curtas (um terço de segundo), iguais para todos.
  const ent = interpolate(frame, [0, Math.max(1, Math.round(fps * 0.18))], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const sai = legenda ? 1 : interpolate(frame, [dur - Math.max(1, Math.round(fps * 0.2)), dur], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const falando = (w: Palavra) => agora >= w.i && agora < Math.max(w.f, w.i + 0.08);
  const conteudo = c.texto || "";

  // ---------------------------------------------------------------- legendas
  if (legenda) {
    let tam = nume(c, "tamanho", 0.058) * L;
    let familia = fonteEscolhida || SANS;
    let peso = 800;
    let caixaAlta = false;
    let fundo: string | undefined;
    let cor = "#ffffff";
    let sombra = "0 2px 10px rgba(0,0,0,0.65)";
    let contorno: string | undefined;
    let rot = 0;
    let padding = "0";
    let raio = 0;
    let escalaEntrada = interpolate(frame, [0, 3], [0.92, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    if (preset === "caixa") {
      fundo = "#ffffff";
      cor = "#111111";
      sombra = "none";
      padding = `${tam * 0.15}px ${tam * 0.35}px`;
      raio = tam * 0.2;
    } else if (preset === "impacto") {
      familia = fonteEscolhida || FORTE;
      peso = 400;
      caixaAlta = true;
      tam *= 1.25;
      // O contorno fica ATRÁS do preenchimento (paint-order): letra fina da marca não some no preto.
      contorno = `${Math.max(3, tam * 0.09)}px #000000`;
      sombra = "0 4px 0 rgba(0,0,0,0.85)";
    } else if (preset === "gigante") {
      familia = fonteEscolhida || FORTE;
      peso = 400;
      caixaAlta = true;
      tam *= 2.1;
      sombra = "0 6px 18px rgba(0,0,0,0.6)";
    } else if (preset === "fita") {
      fundo = corMarca;
      cor = corSobre(corMarca);
      sombra = "none";
      padding = `${tam * 0.12}px ${tam * 0.4}px`;
      rot = -2;
    } else if (preset === "papelaria") {
      familia = fonteEscolhida || MAO;
      peso = 700;
      tam *= 1.2;
      fundo = "#fbf6e9";
      cor = "#1d1d1d";
      sombra = "0 6px 14px rgba(0,0,0,0.35)";
      padding = `${tam * 0.08}px ${tam * 0.35}px`;
      raio = tam * 0.08;
      rot = -3;
    } else if (preset === "discreta") {
      tam *= 0.66;
      peso = 600;
      fundo = "rgba(0,0,0,0.55)";
      sombra = "none";
      padding = `${tam * 0.2}px ${tam * 0.45}px`;
      raio = tam * 0.3;
      escalaEntrada = 1;
    } else if (preset === "simples") {
      escalaEntrada = 1;
    }
    const base: CSSProperties = {
      fontFamily: familia,
      fontWeight: peso,
      fontSize: tam,
      lineHeight: 1.12,
      textAlign: "center",
      color: cor,
      background: fundo,
      padding,
      borderRadius: raio,
      textShadow: sombra,
      WebkitTextStroke: contorno,
      paintOrder: contorno ? "stroke fill" : undefined,
      letterSpacing: caixaAlta ? "0.01em" : undefined,
      transform: `rotate(${rot}deg) scale(${escalaEntrada})`,
    };
    const alto = preset === "discreta" ? "84%" : preset === "gigante" ? "42%" : topo;
    // Caixa alta pelo texto (e não por CSS): o mesmo resultado na prévia e no render, sem depender da letra.
    const caixa = (x: string) => (caixaAlta ? x.toLocaleUpperCase("pt-BR") : x);
    let corpo: ReactNode = caixa(conteudo);
    if (palavras && preset === "gigante") {
      const w = palavras.find(falando) || palavras.filter((x) => x.i <= agora).pop() || palavras[0];
      corpo = caixa(w ? w.t : conteudo);
    } else if (palavras && preset !== "simples" && preset !== "discreta") {
      corpo = palavras.map((w, k) => {
        const ativa = falando(w);
        const estilo: CSSProperties = {};
        if (preset === "caixa_palavra") {
          if (ativa) {
            estilo.background = corMarca;
            estilo.color = corSobre(corMarca);
            estilo.borderRadius = tam * 0.14;
            estilo.padding = `0 ${tam * 0.12}px`;
            estilo.textShadow = "none";
          }
        } else if (preset === "pulso") {
          if (ativa) {
            estilo.display = "inline-block";
            estilo.transform = "scale(1.18)";
            estilo.color = corMarca;
          }
        } else if (preset === "caixa") {
          if (ativa) estilo.color = "#0a7a2f";
        } else if (preset !== "fita" && preset !== "papelaria" && ativa) estilo.color = corMarca;
        return (
          <span key={k} style={estilo}>
            {caixa(w.t)}
            {k < palavras.length - 1 ? " " : ""}
          </span>
        );
      });
    }
    return (
      <div style={{ position: "absolute", left: "6%", right: "6%", top: alto, display: "flex", justifyContent: "center" }}>
        <div style={base}>{corpo}</div>
      </div>
    );
  }

  // ---------------------------------------------------------------- textos, títulos e chamadas
  const tam = nume(c, "tamanho", preset === "titulo" ? 0.085 : preset === "nome" ? 0.042 : preset === "chamada" ? 0.05 : 0.065) * L;
  const opac = ent * sai;
  const sobe = (1 - ent) * tam * 0.6;
  const envolve = (conteudoInterno: ReactNode, estilo: CSSProperties, alinhar: "center" | "flex-start" = "center", lados = "7%") => (
    <div style={{ position: "absolute", left: lados, right: lados, top: topo, display: "flex", justifyContent: alinhar, opacity: opac, transform: `translateY(${sobe}px)` }}>
      <div style={estilo}>{conteudoInterno}</div>
    </div>
  );
  if (preset === "titulo") {
    return envolve(conteudo.toLocaleUpperCase("pt-BR"), { fontFamily: fonteEscolhida || FORTE, fontWeight: 400, fontSize: tam, lineHeight: 1.05, textAlign: "center", color: "#ffffff", textShadow: "0 6px 20px rgba(0,0,0,0.55)" });
  }
  if (preset === "manchete") {
    return envolve(conteudo, { fontFamily: fonteEscolhida || SANS, fontWeight: 900, fontSize: tam, lineHeight: 1.1, textAlign: "center", color: corSobre(corMarca), background: corMarca, padding: `${tam * 0.25}px ${tam * 0.45}px`, borderRadius: tam * 0.18, boxShadow: "0 10px 30px rgba(0,0,0,0.35)" });
  }
  if (preset === "tarja") {
    const linhas = conteudo.split(/\s*\|\s*/).slice(0, 3);
    return envolve(
      linhas.map((l, k) => (
        <div key={k} style={{ display: "inline-block", background: k % 2 ? corMarca : "#000000", color: k % 2 ? corSobre(corMarca) : "#ffffff", padding: `${tam * 0.08}px ${tam * 0.3}px`, margin: `${tam * 0.06}px 0` }}>
          {l}
        </div>
      )),
      { fontFamily: fonteEscolhida || SANS, fontWeight: 800, fontSize: tam, lineHeight: 1.15, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" },
    );
  }
  if (preset === "marca_texto") {
    const larguraGrifo = interpolate(frame, [Math.round(fps * 0.15), Math.round(fps * 0.6)], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return envolve(
      <span style={{ backgroundImage: `linear-gradient(${corMarca}, ${corMarca})`, backgroundRepeat: "no-repeat", backgroundSize: `${larguraGrifo}% 42%`, backgroundPosition: "0 85%", padding: `0 ${tam * 0.1}px` }}>{conteudo}</span>,
      { fontFamily: fonteEscolhida || SANS, fontWeight: 800, fontSize: tam, lineHeight: 1.2, textAlign: "center", color: "#ffffff", textShadow: "0 2px 8px rgba(0,0,0,0.6)" },
    );
  }
  if (preset === "balao") {
    return envolve(
      <>
        {conteudo}
        <span style={{ position: "absolute", left: "18%", bottom: -tam * 0.35, width: 0, height: 0, borderLeft: `${tam * 0.3}px solid transparent`, borderRight: `${tam * 0.3}px solid transparent`, borderTop: `${tam * 0.4}px solid #ffffff` }} />
      </>,
      { position: "relative", fontFamily: fonteEscolhida || SANS, fontWeight: 700, fontSize: tam, lineHeight: 1.2, textAlign: "center", color: "#111111", background: "#ffffff", padding: `${tam * 0.35}px ${tam * 0.55}px`, borderRadius: tam * 0.6, boxShadow: "0 8px 24px rgba(0,0,0,0.3)" },
    );
  }
  if (preset === "vidro") {
    return envolve(conteudo, { fontFamily: fonteEscolhida || SANS, fontWeight: 700, fontSize: tam, lineHeight: 1.25, textAlign: "center", color: "#ffffff", background: "rgba(10,10,12,0.62)", border: "1px solid rgba(255,255,255,0.18)", padding: `${tam * 0.4}px ${tam * 0.6}px`, borderRadius: tam * 0.35 });
  }
  if (preset === "chamada") {
    const pulso = 1 + 0.04 * Math.sin((frame / fps) * Math.PI * 2 * 1.2);
    return envolve(conteudo, { fontFamily: fonteEscolhida || SANS, fontWeight: 900, fontSize: tam, lineHeight: 1.1, textAlign: "center", color: corSobre(corMarca), background: corMarca, padding: `${tam * 0.45}px ${tam * 0.9}px`, borderRadius: tam * 2, transform: `scale(${pulso})`, boxShadow: "0 10px 26px rgba(0,0,0,0.35)" });
  }
  if (preset === "nome") {
    const [nome, cargo] = conteudo.split(/\s*\|\s*/);
    const larg = interpolate(frame, [0, Math.round(fps * 0.35)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return (
      <div style={{ position: "absolute", left: "6%", right: "30%", top: posicao === "topo" ? "10%" : "76%", opacity: sai }}>
        <div style={{ display: "flex", alignItems: "stretch" }}>
          <div style={{ width: Math.max(4, tam * 0.16), background: corMarca, transform: `scaleY(${larg})`, transformOrigin: "top" }} />
          <div style={{ marginLeft: tam * 0.35, overflow: "hidden", opacity: ent }}>
            <div style={{ fontFamily: fonteEscolhida || SANS, fontWeight: 800, fontSize: tam, color: "#ffffff", lineHeight: 1.15, textShadow: "0 2px 8px rgba(0,0,0,0.6)" }}>{nome || conteudo}</div>
            {cargo && <div style={{ fontFamily: SANS, fontWeight: 500, fontSize: tam * 0.7, color: "rgba(255,255,255,0.85)", lineHeight: 1.2, textShadow: "0 2px 8px rgba(0,0,0,0.6)" }}>{cargo}</div>}
          </div>
        </div>
      </div>
    );
  }
  // simples (o de antes)
  return envolve(conteudo, { fontFamily: fonteEscolhida || "Outfit, Inter, sans-serif", fontWeight: 800, fontSize: tam, lineHeight: 1.15, textAlign: "center", color: "#ffffff", textShadow: "0 2px 10px rgba(0,0,0,0.65)" });
}
