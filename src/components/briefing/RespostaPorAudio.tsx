import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { botao, juntar, texto } from "@/components/sistema";
import { MAX_SEGUNDOS_DO_AUDIO } from "../../../supabase/functions/_shared/briefing-audio";

/**
 * Responder por áudio no link do briefing (frente BRF2, 30/09/2026): grava no
 * celular, manda para transcrever e o texto entra no campo para a pessoa
 * conferir e corrigir. Até 3 minutos por gravação; o áudio não fica guardado.
 * Onde o navegador não grava (Safari antigo), o botão não aparece. A falha
 * fica à vista e nada do que já estava escrito se perde.
 */

type Gravador = {
  state: string;
  mimeType: string;
  start: (fatia?: number) => void;
  stop: () => void;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
};

type ConstrutorDoGravador = { new (s: MediaStream, o?: { mimeType?: string }): Gravador; isTypeSupported?: (t: string) => boolean };

function construtor(): ConstrutorDoGravador | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { MediaRecorder?: ConstrutorDoGravador };
  const n = typeof navigator !== "undefined" ? (navigator as Navigator & { mediaDevices?: { getUserMedia?: unknown } }) : null;
  if (!w.MediaRecorder || !n || !n.mediaDevices || typeof n.mediaDevices.getUserMedia !== "function") return null;
  return w.MediaRecorder;
}

export const gravacaoDisponivel = () => construtor() !== null;

/** O formato que este navegador grava (webm no Chrome e Android, mp4 no iPhone). */
function formatoDaGravacao(C: ConstrutorDoGravador): string | undefined {
  const opcoes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  if (typeof C.isTypeSupported !== "function") return undefined;
  for (const o of opcoes) if (C.isTypeSupported(o)) return o;
  return undefined;
}

const tempo = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function RespostaPorAudio({
  onTranscrever,
  desativado,
}: {
  /** Manda o áudio e devolve o texto transcrito (quem chama junta ao campo). */
  onTranscrever: (audio: Blob, segundos: number) => Promise<void>;
  desativado?: boolean;
}) {
  const [fase, setFase] = useState<"parado" | "gravando" | "transcrevendo">("parado");
  const [segundos, setSegundos] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const gravador = useRef<Gravador | null>(null);
  const fluxo = useRef<MediaStream | null>(null);
  const pedacos = useRef<Blob[]>([]);
  const inicio = useRef(0);
  const relogio = useRef<number | null>(null);

  const soltar = () => {
    if (relogio.current) window.clearInterval(relogio.current);
    relogio.current = null;
    if (fluxo.current) fluxo.current.getTracks().forEach((t) => t.stop());
    fluxo.current = null;
  };
  useEffect(() => () => soltar(), []);

  const C = construtor();
  if (!C) return null;

  const parar = () => {
    const g = gravador.current;
    if (g && g.state !== "inactive") g.stop();
  };

  const gravar = async () => {
    setErro(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      fluxo.current = s;
      const formato = formatoDaGravacao(C);
      const g = new C(s, formato ? { mimeType: formato } : undefined);
      gravador.current = g;
      pedacos.current = [];
      g.ondataavailable = (e) => {
        if (e.data && e.data.size) pedacos.current.push(e.data);
      };
      g.onstop = () => {
        const duracao = Math.max(1, (Date.now() - inicio.current) / 1000);
        soltar();
        const audio = new Blob(pedacos.current, { type: (g.mimeType || formato || "audio/webm").split(";")[0] });
        if (!audio.size) {
          setFase("parado");
          setErro("Não captamos som. Confira o microfone e tente de novo.");
          return;
        }
        setFase("transcrevendo");
        onTranscrever(audio, duracao).then(
          () => setFase("parado"),
          (e: unknown) => {
            setFase("parado");
            setErro(e instanceof Error && e.message ? e.message : "Não foi possível transcrever. Escreva a resposta ou tente de novo.");
          },
        );
      };
      inicio.current = Date.now();
      setSegundos(0);
      g.start(1000);
      setFase("gravando");
      relogio.current = window.setInterval(() => {
        const s2 = Math.floor((Date.now() - inicio.current) / 1000);
        setSegundos(s2);
        if (s2 >= MAX_SEGUNDOS_DO_AUDIO) parar();
      }, 500);
    } catch (e) {
      soltar();
      setFase("parado");
      console.error("[briefing] microfone:", e);
      setErro("Não deu para usar o microfone. Libere o acesso no navegador ou escreva a resposta.");
    }
  };

  return (
    <div className="mt-1.5 min-w-0">
      {fase === "gravando" ? (
        <button type="button" onClick={parar} className={juntar(botao.secundario, "h-8 px-2.5 text-[12px]")} aria-label="Parar e transcrever">
          <Square className="mr-1.5 h-3.5 w-3.5 text-destructive" aria-hidden="true" />
          <span className="tabular-nums">Parar {tempo(segundos)}</span>
        </button>
      ) : (
        <button type="button" onClick={() => void gravar()} disabled={desativado || fase === "transcrevendo"} className={juntar(botao.discreto, "-ml-2 h-8 px-2 text-[12px]")} aria-label="Responder por áudio">
          {fase === "transcrevendo" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Mic className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
          {fase === "transcrevendo" ? "Transcrevendo..." : "Responder por áudio"}
        </button>
      )}
      {erro && <p className={juntar(texto.auxiliar, "mt-1 text-destructive")} role="alert">{erro}</p>}
    </div>
  );
}
