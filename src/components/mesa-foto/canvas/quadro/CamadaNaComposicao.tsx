import { getRemotionEnvironment, Html5Video, Img, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { lerCamada, estadoNoTempo } from "../../../../../supabase/functions/mesa-foto/modulos/quadro-animado";
import { alinhamentoDoTexto, caixaDaCamada, estiloDaForma, estiloDaMidia, estiloDoTexto } from "./estiloDaCamada";

/**
 * Uma camada do Quadro animado dentro da composição do render (frente CNV,
 * 30/09). O cartão Quadro do Canvas vira um projeto da Mesa Edição com uma
 * trilha "Quadro do Canvas": cada camada é um clipe dessa trilha, com a
 * camada inteira em `estilo.camada`. A composição (EDT) só chama isto; o
 * desenho é o mesmo do palco do editor (estiloDaCamada.ts).
 *
 * Sem import de "@/": o worker empacota este arquivo com o Remotion.
 */

const resolver = (u: string | null | undefined): string | null => (!u ? null : u.indexOf("estatico:") === 0 ? staticFile(u.slice(9)) : u);

export function CamadaNaComposicao({ estilo, url, entrada_s, duracao_s }: { estilo: Record<string, unknown>; url: string | null | undefined; entrada_s: number; duracao_s: number }) {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const fim = Number(estilo.quadro_duracao_s) || duracao_s + 60;
  const camada = lerCamada(estilo.camada, fim);
  if (!camada) return null;
  const desde = Number(estilo._desde_s) || 0;
  const t = camada.inicio_s + desde + frame / fps;
  const e = estadoNoTempo(camada, t);
  if (!e.visivel) return null;
  const caixa = caixaDaCamada(camada, e);
  const src = resolver(url);
  let corpo = null;
  if (camada.tipo === "texto") {
    corpo = (
      <div style={alinhamentoDoTexto(camada)}>
        <span style={estiloDoTexto(camada, width)}>{camada.texto}</span>
      </div>
    );
  } else if (camada.tipo === "forma") {
    corpo = <div style={estiloDaForma(camada, width)} />;
  } else if (src && camada.tipo === "video") {
    const inicio = Math.max(0, Math.round(entrada_s * fps));
    corpo = getRemotionEnvironment().isRendering ? (
      <OffthreadVideo src={src} trimBefore={inicio} muted style={estiloDaMidia(camada, width)} />
    ) : (
      <Html5Video src={src} trimBefore={inicio} muted style={estiloDaMidia(camada, width)} pauseWhenBuffering />
    );
  } else if (src) {
    corpo = <Img src={src} style={estiloDaMidia(camada, width)} />;
  }
  if (!corpo) return null;
  return <div style={{ ...caixa, overflow: camada.tipo === "texto" ? "visible" : "hidden" }}>{corpo}</div>;
}
