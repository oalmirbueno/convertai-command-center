import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeftToLine, ArrowRightToLine, Loader2, Repeat, Scissors } from "lucide-react";
import { useMesa, useUrlDaMesa } from "./MesaContexto";
import { botao, juntar, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { chamarEditorVideo } from "@/lib/editor/api";
import { pedirRender, uidDoClique } from "@/lib/editor/render";
import { chamarMesaVideos, chaveDasVersoes, chaveDosArquivos, type ArquivoDeVideo } from "@/components/mesa-videos/videosApi";
import { CORTE_MINIMO_S } from "../../../supabase/functions/mesa-videos/modulos/corte-do-final";

const seg = (n: number) => `${n.toFixed(1).replace(".", ",")} s`;
const cent = (n: number) => Math.round(n * 100) / 100;

/** O trecho marcado, preso ao vídeo e com o mínimo do corte. Pura (os testes usam). */
export function trechoValido(entrada: number, saida: number, duracao: number): { entrada: number; saida: number; ok: boolean } {
  const d = Math.max(0, duracao || 0);
  const e = cent(Math.min(Math.max(0, entrada), d));
  const s = cent(Math.min(Math.max(0, saida), d));
  const inteiro = e <= 0.05 && s >= d - 0.05;
  return { entrada: e, saida: s, ok: d > 0 && s - e >= CORTE_MINIMO_S && !inteiro };
}

/**
 * Cortar antes de ir para o ar (27/10/2026, dono: "editar e cortar antes de ir pro ar qualquer vídeo com o
 * editor, mas de forma clean; eu mesmo corto manualmente"). Marca o início e o fim no próprio player (ou nas
 * duas barras), confere o trecho em loop e corta: vira a próxima versão do vídeo, no render de sempre, e o
 * vídeo cortado entra na prancheta quando a máquina terminar. O original não muda. Sem custo de IA.
 */
export default function CortarVideoDaPauta({ arquivo }: { arquivo: ArquivoDeVideo }) {
  const { clientId } = useMesa();
  const cache = useQueryClient();
  const url = useUrlDaMesa(arquivo.storage_path, arquivo.storage_bucket || "mesa");
  const player = useRef<HTMLVideoElement>(null);
  const [duracao, setDuracao] = useState(arquivo.duracao_s || 0);
  const [entrada, setEntrada] = useState(0);
  const [saida, setSaida] = useState(arquivo.duracao_s || 0);
  const [loop, setLoop] = useState(true);
  const [cortando, setCortando] = useState(false);
  const trecho = trechoValido(entrada, saida, duracao);

  // No loop, o player toca só o trecho marcado.
  useEffect(() => {
    const v = player.current;
    if (!v) return;
    const aoTocar = () => {
      if (!loop) return;
      if (v.currentTime < trecho.entrada - 0.05 || v.currentTime >= trecho.saida) v.currentTime = trecho.entrada;
    };
    v.addEventListener("timeupdate", aoTocar);
    return () => v.removeEventListener("timeupdate", aoTocar);
  }, [loop, trecho.entrada, trecho.saida]);

  const agora = () => cent(player.current ? player.current.currentTime : 0);
  const cortar = async () => {
    if (!trecho.ok || cortando) return;
    setCortando(true);
    try {
      const r = await chamarMesaVideos<{ versao: { id: string; numero: number; projeto?: { revisao?: number } | null } }>({ acao: "final_corte_versao", arquivo_id: arquivo.id, entrada_s: trecho.entrada, saida_s: trecho.saida });
      const revisao = r.versao.projeto && typeof r.versao.projeto.revisao === "number" ? r.versao.projeto.revisao : null;
      await pedirRender(chamarEditorVideo, { clientId, versaoId: r.versao.id, tipo: "render_final", uid: uidDoClique(), revisao });
      void cache.invalidateQueries({ queryKey: chaveDasVersoes(clientId) });
      void cache.invalidateQueries({ queryKey: chaveDosArquivos(clientId) });
      toast.success("Corte na fila do render", { description: `${seg(trecho.saida - trecho.entrada)}. O vídeo cortado entra na prancheta quando a máquina terminar; o original continua lá.`, duration: 9000 });
    } catch (e) {
      toast.error("O corte não foi feito", { description: textoDoErro(e), duration: 9000 });
    } finally {
      setCortando(false);
    }
  };

  return <div className="min-w-0 space-y-3" data-cortar-video={arquivo.id}>
    {url.isError ? <p role="alert" className="text-[13px]">Não foi possível abrir este vídeo.</p> : !url.data ? <p role="status" className="text-[13px]">Carregando o vídeo…</p> :
      <video ref={player} src={url.data} controls playsInline preload="metadata" aria-label={`Vídeo para cortar: ${arquivo.nome}`} className="max-h-[46vh] w-full rounded-lg bg-black object-contain"
        onLoadedMetadata={(e) => { const d = cent(e.currentTarget.duration || 0); if (d > 0) { setDuracao(d); setSaida((s) => (s > 0 && s <= d ? s : d)); } }} />}
    <div className="flex min-w-0 items-center">
      <button type="button" className={botao.icone} onClick={() => setEntrada(Math.min(agora(), saida))} aria-label="Início aqui" title="Marcar o início no ponto do player"><ArrowLeftToLine className="h-4 w-4" aria-hidden="true" /></button>
      <span className={juntar(texto.auxiliar, "min-w-0 flex-1 truncate text-center")} role="status">{seg(trecho.entrada)} até {seg(trecho.saida)} · fica {seg(Math.max(0, trecho.saida - trecho.entrada))}</span>
      <button type="button" className={botao.icone} onClick={() => setSaida(Math.max(agora(), entrada))} aria-label="Fim aqui" title="Marcar o fim no ponto do player"><ArrowRightToLine className="h-4 w-4" aria-hidden="true" /></button>
    </div>
    <label className="block min-w-0 text-[12px] text-muted-foreground">Início
      <input type="range" min={0} max={duracao || 0} step={0.1} value={trecho.entrada} disabled={!duracao} onChange={(e) => { const v = Number(e.target.value); setEntrada(Math.min(v, saida)); if (player.current) player.current.currentTime = v; }} className="mt-1 block w-full accent-primary" aria-label="Início do corte" />
    </label>
    <label className="block min-w-0 text-[12px] text-muted-foreground">Fim
      <input type="range" min={0} max={duracao || 0} step={0.1} value={trecho.saida} disabled={!duracao} onChange={(e) => { const v = Number(e.target.value); setSaida(Math.max(v, entrada)); if (player.current) player.current.currentTime = Math.max(0, v - 1); }} className="mt-1 block w-full accent-primary" aria-label="Fim do corte" />
    </label>
    <div className="flex min-w-0 items-center">
      <button type="button" className={juntar(botao.icone, loop && "text-primary")} aria-pressed={loop} onClick={() => setLoop((l) => !l)} aria-label="Tocar só o trecho" title="Tocar só o trecho marcado, em loop"><Repeat className="h-4 w-4" aria-hidden="true" /></button>
      <span className="flex-1" />
      <button type="button" className={juntar(botao.primario, "h-8 px-3 text-[12px]")} disabled={!trecho.ok || cortando} onClick={() => void cortar()} data-cortar="">
        {cortando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Scissors className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}Cortar
      </button>
    </div>
    <p className={texto.auxiliar}>{duracao && !trecho.ok ? `Marque um trecho de pelo menos ${CORTE_MINIMO_S} s, menor que o vídeo inteiro.` : "Vira uma versão nova; o original fica na prancheta. Sem custo de IA."}</p>
  </div>;
}
