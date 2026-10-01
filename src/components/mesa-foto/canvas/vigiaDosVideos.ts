import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { textoDoErro } from "@/lib/mesa/api";
import type { Canvas } from "../canvasApi";
import { EM_ANDAMENTO, type DadosDoVideo } from "../../../../supabase/functions/mesa-foto/modulos/video-do-canvas";
import { comPedidos, conferirPedidosDoVideo, esperaDoVigia, vigiarAinda } from "./videoNoCanvas";

/**
 * Vigia dos pedidos de vídeo do Canvas. Enquanto o canvas está aberto e há
 * pedido em andamento, confere com intervalo crescente (45 s, 90 s, depois a
 * cada 3 min) até o estado final ou o prazo do motor: assim o vídeo que o
 * provedor terminou chega ao cartão sem a pessoa precisar voltar na hora
 * certa. Uma consulta por vez por cartão; a falha vai para o console e para
 * a tela, e a próxima consulta segue agendada.
 */
export function useVigiaDosVideos(canvas: Canvas, mudar: (fn: (c: Canvas) => Canvas) => void) {
  const atual = useRef(canvas);
  atual.current = canvas;
  const relogios = useRef<Record<string, number>>({});
  const desmontado = useRef(false);
  const avisouFalha = useRef<Record<string, boolean>>({});

  const conferir = async (videoId: string | null): Promise<number> => {
    let mudaram = 0;
    const nos = atual.current.nos.filter((n) => n.tipo === "video" && (!videoId || n.id === videoId) && n.dados.video);
    for (const n of nos) {
      const novos = await conferirPedidosDoVideo(n.dados.video as DadosDoVideo);
      if (novos.length) {
        mudaram += novos.length;
        mudar((c) => comPedidos(c, n.id, novos));
      }
    }
    return mudaram;
  };

  const falhou = (videoId: string, err: unknown, espera: number) => {
    // eslint-disable-next-line no-console
    console.warn("[canvas] conferir o vídeo falhou", videoId, err);
    if (avisouFalha.current[videoId]) return;
    avisouFalha.current[videoId] = true;
    toast.warning("Não deu para conferir o vídeo agora", { description: `${textoDoErro(err)} Tento de novo em ${Math.round(espera / 1000)} s; o botão Conferir também serve.`, duration: 8000 });
  };

  const seguir = (videoId: string, passo: number, logoDepoisDoGerar = false) => {
    if (desmontado.current) return;
    const antigo = relogios.current[videoId];
    if (antigo) window.clearTimeout(antigo);
    delete relogios.current[videoId];
    const no = atual.current.nos.find((n) => n.id === videoId);
    // Logo depois do Gerar o pedido novo pode ainda não estar no estado: a 1ª consulta vai de qualquer jeito.
    if (!logoDepoisDoGerar && (!no || !no.dados.video || !vigiarAinda(no.dados.video, Date.now()))) return;
    const espera = esperaDoVigia(passo);
    relogios.current[videoId] = window.setTimeout(() => {
      delete relogios.current[videoId];
      conferir(videoId)
        .then(() => {
          avisouFalha.current[videoId] = false;
        })
        .catch((err) => falhou(videoId, err, esperaDoVigia(passo + 1)))
        .then(() => seguir(videoId, passo + 1));
    }, espera);
  };

  const jaAbriu = useRef(false);
  useEffect(() => {
    if (jaAbriu.current) return;
    jaAbriu.current = true;
    const emAndamento = canvas.nos.filter((n) => n.tipo === "video" && n.dados.video && n.dados.video.pedidos.some((p) => EM_ANDAMENTO.indexOf(p.estado) >= 0)).map((n) => n.id);
    if (!emAndamento.length) return;
    conferir(null)
      .catch((err) => falhou("abrir", err, esperaDoVigia(0)))
      .then(() => emAndamento.forEach((id) => seguir(id, 0)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(
    () => () => {
      desmontado.current = true;
      Object.keys(relogios.current).forEach((k) => window.clearTimeout(relogios.current[k]));
    },
    [],
  );
  /** Depois de um Gerar: começa a vigiar este cartão. */
  const agendar = (videoId: string) => {
    seguir(videoId, 0, true);
  };
  return { conferir, agendar };
}
