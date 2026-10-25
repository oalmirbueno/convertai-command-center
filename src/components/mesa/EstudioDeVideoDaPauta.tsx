import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { PenLine, Type, Send, Music, History, Video } from "lucide-react";
import GravarDaPauta from "./GravarDaPauta";
import TrilhaDoVideoDaPauta from "./TrilhaDoVideoDaPauta";
import { resultadosDeVideoDaPauta, videoEnviadoDaPeca } from "./resultadosDeVideoDaPauta";
import { ESTILOS_DE_VIDEO_DA_PAUTA } from "../../../supabase/functions/_shared/video-da-pauta";
import EntregaDoVideoDaPauta from "./EntregaDoVideoDaPauta";
import MidiaDaPauta from "./MidiaDaPauta";
import PecaDeVideoDaPauta from "./PecaDeVideoDaPauta";
import { useEffect, useState } from "react";
import { useMesa } from "./MesaContexto";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import GeradorLivre from "@/components/mesa-videos/GeradorLivre";
import GeracoesRecentes from "@/components/mesa-videos/GeracoesRecentes";
import { useArquivosDeVideo, usePedidos, useVersoes } from "@/components/mesa-videos/videosApi";
import { LinhaDoFinal } from "@/components/mesa-edicao/Finais";
import { chaveDoEstudioDaPauta } from "./modoDaPauta";
import BancadaDaPauta, { PainelDaBancada } from "./BancadaDaPauta";
import type { ItemDoMes, ArteNaAgenda } from "./useItensDoMes";

const BASES = ESTILOS_DE_VIDEO_DA_PAUTA;

export default function EstudioDeVideoDaPauta({ item, arte }: { item: ItemDoMes; arte?: ArteNaAgenda | null }) {
  const { clientId } = useMesa();
  const chave = (parte: string) => chaveDoEstudioDaPauta(clientId, item.id, parte);
  const [base, setBase] = useEstadoDaTela<string>(chave("base-video"), item.video?.estilo || "produto");
  const [ids, setIds] = useEstadoDaTela<string[]>(chave("pedidos-video"), [], { validar: Array.isArray });
  // 24/10: a peça que nasceu no caminho "gravar" (preparação do Mês) abre no roteiro para gravar; a de IA, no Gerar.
  const gravar = item.caminho_video === "gravar";
  const [aba, setAba] = useState(gravar ? "gravar" : "gerar");
  const arquivosQ = useArquivosDeVideo(clientId);
  const pedidosQ = usePedidos(clientId);
  const versoesQ = useVersoes(clientId);
  const pedidos = (pedidosQ.data?.itens || []).filter((p) => p.parametros.task_id === item.id || ids.includes(p.id));
  const gerados = resultadosDeVideoDaPauta(clientId, item.id, arquivosQ.data?.arquivos || [], pedidosQ.data?.itens || [], versoesQ.data?.itens || [], ids);
  // 25/10: o vídeo enviado para a peça (Pronto) também libera legendar, trilha e entrega, como as gerações da IA.
  const enviado = videoEnviadoDaPeca(clientId, item.video_pronto, arquivosQ.data?.arquivos || []);
  const arquivos = enviado && !gerados.some((a) => a.id === enviado.id) ? [enviado, ...gerados] : gerados;
  useEffect(() => {
    void arquivosQ.refetch(); void pedidosQ.refetch(); void versoesQ.refetch();
  }, [clientId, item.id]);
  useEffect(() => {
    if (!pedidos.length) return;
    const pendentes = pedidos.some((p) => !["pronto", "erro", "cancelado"].includes(p.estado));
    if (!pendentes) { void arquivosQ.refetch(); return; }
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") { void arquivosQ.refetch(); void pedidosQ.refetch(); void versoesQ.refetch(); } }, 20000);
    return () => window.clearInterval(timer);
  }, [pedidos.map((p) => `${p.id}:${p.estado}`).join(",")]);
  const [vendo, setVendo] = useState<string | null>(null);
  const atual = arquivos.find((a) => a.id === vendo) || arquivos[0];
  const tema = BASES.find((b) => b.id === base) || BASES[0];
  return <div className="flex min-h-0 flex-1 flex-col" data-video-da-pauta={item.id}>
    <BancadaDaPauta tipo="video" titulo={item.title}
      ativa={aba} onAba={setAba} abas={[
        ...(gravar ? [{ id: "gravar", nome: "Gravar com roteiro", icone: Video }] : []),
        { id: "gerar", nome: "Gerar vídeo", icone: PenLine },
        ...(gravar ? [] : [{ id: "gravar", nome: "Gravar com roteiro", icone: Video }]),
        { id: "som", nome: "Trilha sonora", icone: Music },
        { id: "legenda", nome: "Legendar o vídeo", icone: Type },
        { id: "entrega", nome: "Legenda do post e aprovação", icone: Send },
        { id: "resultados", nome: "Gerações e versões", icone: History },
      ]}
      acoes={<AjudaRecolhida rotulo="Direção do vídeo">{tema.texto}</AjudaRecolhida>}
      prancheta={<div className="space-y-2"><button type="button" aria-pressed={aba === 'gerar'} className="w-full rounded-lg border border-dashed px-2 py-5 text-[12px]" onClick={() => setAba('gerar')}>+ Gerar vídeo</button>{arquivos.map((a, i) => <button type="button" key={a.id} aria-pressed={atual?.id === a.id} onClick={() => { setVendo(a.id); setAba('entrega'); }} className={`w-full rounded-lg border px-2 py-4 text-left text-[12px] ${atual?.id === a.id ? 'border-primary bg-primary/10' : ''}`}>Vídeo {i + 1}<span className="mt-2 block truncate">{a.nome}</span></button>)}{arte?.capa?.tipo_midia === "video" && <p className="rounded-lg border p-3 text-[12px] text-primary">Vídeo na Agenda</p>}</div>}
      // 24/10 (dono): o miolo é a peça (A fazer / Pronto, Vídeo, Roteiro e Só o texto, subir e preparar para publicar);
      // a direção genérica do estilo ("Produto elegante") ficou só no "?" da barra. A linha da mídia mora dentro da peça, não solta acima.
      previa={<><MidiaDaPauta item={{ ...item, modo_estudio: "video" }} /><PecaDeVideoDaPauta item={item} arte={arte} geracoes={arquivos} emFoco={vendo ? atual || null : null} aoGerar={() => setAba("gerar")} aoAbrirRoteiro={() => setAba("gravar")} />
        <div className="mt-3 sm:max-h-52 sm:overflow-y-auto"><GeracoesRecentes arquivos={arquivos} taskId={item.id} pedidosIds={ids} /></div>
      </>}
      ferramentas={<div className="space-y-4">
      <PainelDaBancada id="gravar"><GravarDaPauta item={item} /></PainelDaBancada>
      <PainelDaBancada id="gerar"><label className="block text-[13px] font-medium">Estilo do vídeo<select aria-label="Estilo do vídeo" className="mt-2 w-full rounded-md border bg-background p-2 text-[13px]" value={base} onChange={(e) => setBase(e.target.value)}>{BASES.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}</select></label><div className="my-2"><AjudaRecolhida rotulo="Sobre este estilo">{tema.texto}</AjudaRecolhida></div><GeradorLivre key={`${item.id}:${base}:${item.midia?.gerada_em || ""}`} escopo={chave(`video:${base}${item.midia?.gerada_em ? `:${item.midia.gerada_em}` : ""}`)} pauta={item} direcaoInicial={item.video} promptInicial={`${base === item.video?.estilo ? item.video.prompt : tema.texto}\nPauta: ${item.title}\nProduza apenas cenas coerentes com esta pauta e com as referências reais do cliente.`} aoGerar={(id) => { setIds((antes) => Array.from(new Set([...antes, id]))); setAba('resultados'); }} /></PainelDaBancada>
      <PainelDaBancada id="som">{atual ? <TrilhaDoVideoDaPauta key={atual.id} arquivo={atual} taskId={item.id} /> : <p className="text-[13px]">Gere ou escolha um vídeo na prancheta para adicionar a trilha.</p>}</PainelDaBancada>
      <PainelDaBancada id="legenda">{atual ? <ul><LinhaDoFinal arquivo={atual} variantes={[]} antes={null} /></ul> : <p className="text-[13px]">A legenda fica disponível quando o vídeo estiver pronto.</p>}</PainelDaBancada>
      <PainelDaBancada id="entrega">{atual ? <EntregaDoVideoDaPauta key={atual.id} item={item} arquivo={atual} /> : <p role="status" className="text-[13px]">{arte ? 'Este vídeo já está na Agenda.' : 'Escolha um resultado na prancheta para preparar a legenda e enviar para aprovação.'}</p>}</PainelDaBancada>
      <PainelDaBancada id="resultados"><p className="text-[13px]">{arquivos.length ? `${arquivos.length} versões prontas na prancheta. Clique em uma para conferir e preparar a entrega.` : 'A geração aparece abaixo da prévia. O resultado entra automaticamente na prancheta.'}</p><button type="button" className="mt-3 rounded-md border p-2 text-[12px]" onClick={() => { void arquivosQ.refetch(); void pedidosQ.refetch(); void versoesQ.refetch(); }}>Conferir resultados</button></PainelDaBancada>
      {(arquivosQ.isError || pedidosQ.isError) && <p role="alert">Não foi possível ler os resultados. <button type="button" onClick={() => { void arquivosQ.refetch(); void pedidosQ.refetch(); }}>Recarregar</button></p>}
      </div>} />
  </div>;
}
