import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useMesa, useUrlDaMesa } from "./MesaContexto";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { chamarMesaVideos, chaveDasVersoes, chaveDosArquivos, subirVideos, useArquivosDeVideo, type ArquivoDeVideo } from "@/components/mesa-videos/videosApi";
import { chamarEditorVideo } from "@/lib/editor/api";
import { pedirRender, uidDoClique, useFilaDeRender, rotuloDoPedido } from "@/lib/editor/render";
import { videoComTrilha } from "./videoComTrilha";

export default function TrilhaDoVideoDaPauta({ arquivo, taskId }: { arquivo: ArquivoDeVideo; taskId: string }) {
  const { clientId } = useMesa(); const cache = useQueryClient(); const acervo = useArquivosDeVideo(clientId);
  const [musicaId, setMusicaId] = useEstadoDaTela<string>(`mesa:trilha:${clientId}:${taskId}:${arquivo.id}`, "");
  const [versaoId, setVersaoId] = useEstadoDaTela<string | null>(`mesa:trilha-render:${clientId}:${taskId}:${arquivo.id}`, null);
  const [abaixo, setAbaixo] = useState(22); const [ocupado, setOcupado] = useState(false);
  const [medidas, setMedidas] = useState<{ duracao_s: number; largura: number; altura: number } | null>(null);
  const videoUrl = useUrlDaMesa(arquivo.storage_path, arquivo.storage_bucket);
  const musicas = (acervo.data?.arquivos || []).filter((a) => a.client_id === clientId && a.estado !== "arquivado" && (a.tipo === "audio" || a.mime?.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(a.storage_path)));
  const musica = musicas.find((a) => a.id === musicaId);
  const url = useUrlDaMesa(musica?.storage_path, musica?.storage_bucket || "mesa");
  const fila = useFilaDeRender(clientId, versaoId, chamarEditorVideo);
  const pedido = fila.pedidos[0];
  useEffect(() => { if (pedido?.estado === "pronto") { void cache.invalidateQueries({ queryKey: chaveDosArquivos(clientId) }); void cache.invalidateQueries({ queryKey: chaveDasVersoes(clientId) }); } }, [pedido?.estado, clientId, cache]);
  return <div className="space-y-4"><p className="text-[12px] text-muted-foreground">Escolha a música e aplique. O som original é preservado e a trilha abaixa durante a voz.</p>
    <label className="block text-[12px]">Trilha do acervo<select className="mt-2 w-full rounded-md border bg-background p-2" value={musicaId} onChange={(e) => setMusicaId(e.target.value)}><option value="">Escolher música</option>{musicas.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</select></label>
    <label className="block text-[12px]">Adicionar trilha sonora<input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac" disabled={ocupado} className="mt-2 block w-full text-[12px]" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; setOcupado(true); try { const r = await subirVideos(clientId, [f], () => undefined); if (!r.registrados.length) throw new Error(r.recusados[0]?.motivo || "O áudio não foi registrado."); await cache.invalidateQueries({ queryKey: chaveDosArquivos(clientId) }); setMusicaId(r.registrados[0].id); } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível enviar a trilha."); } finally { setOcupado(false); } }} /></label>
    {url.data && <audio controls src={url.data} className="w-full" aria-label="Ouvir trilha" />}
    {videoUrl.data && <video className="hidden" src={videoUrl.data} preload="metadata" onLoadedMetadata={(e) => setMedidas({ duracao_s: e.currentTarget.duration, largura: e.currentTarget.videoWidth, altura: e.currentTarget.videoHeight })} />}
    <label className="block text-[12px]">Música abaixo da voz · {abaixo} dB<input aria-label="Volume da trilha" className="mt-2 w-full accent-primary" type="range" min={18} max={30} value={abaixo} onChange={(e) => setAbaixo(Number(e.target.value))} /></label>
    <button type="button" className="rounded-md bg-primary px-3 py-2 text-[12px] text-primary-foreground" disabled={ocupado || !musica || (!arquivo.duracao_s && !medidas) || pedido?.estado === "fila" || pedido?.estado === "rodando"} onClick={async () => { if (!musica) return; setOcupado(true); try {
      const projeto = videoComTrilha({ ...arquivo, ...(medidas || {}) }, musica, abaixo);
      const r = await chamarMesaVideos<{ versao: { id: string; projeto?: { revisao?: number } } }>({ acao: "versao_registrar", client_id: clientId, titulo: projeto.titulo, estado: "rascunho", projeto, nota: `Trilha sonora da pauta ${taskId}` });
      if (!r.versao?.id) throw new Error("Não foi possível confirmar a versão."); setVersaoId(r.versao.id);
      await pedirRender(chamarEditorVideo, { clientId, versaoId: r.versao.id, tipo: "render_final", uid: uidDoClique(), revisao: r.versao.projeto?.revisao ?? null });
      void cache.invalidateQueries({ queryKey: chaveDasVersoes(clientId) }); toast.success("Vídeo com trilha na fila. A nova versão aparecerá na prancheta.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível aplicar a trilha."); } finally { setOcupado(false); } }}>{ocupado ? "Preparando…" : "Aplicar trilha e gerar versão"}</button>
    {pedido && <p role="status" className="text-[12px]">{rotuloDoPedido(pedido, Date.now(), fila.worker)}</p>}{fila.erro && <p role="alert" className="text-[12px]">{fila.erro}</p>}
  </div>;
}
