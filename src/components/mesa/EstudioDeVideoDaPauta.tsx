import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { PenLine, Type, Send, Music, History } from "lucide-react";
import TrilhaDoVideoDaPauta from "./TrilhaDoVideoDaPauta";
import { resultadosDeVideoDaPauta } from "./resultadosDeVideoDaPauta";
import { ESTILOS_DE_VIDEO_DA_PAUTA } from "../../../supabase/functions/_shared/video-da-pauta";
import EntregaDoVideoDaPauta from "./EntregaDoVideoDaPauta";
import { useEffect, useState } from "react";
import { useMesa } from "./MesaContexto";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import GeradorLivre from "@/components/mesa-videos/GeradorLivre";
import GeracoesRecentes from "@/components/mesa-videos/GeracoesRecentes";
import { useArquivosDeVideo, usePedidos, useVersoes } from "@/components/mesa-videos/videosApi";
import { LinhaDoFinal } from "@/components/mesa-edicao/Finais";
import { chaveDoEstudioDaPauta } from "./modoDaPauta";
import BancadaDaPauta, { PreviaDaPauta, PainelDaBancada } from "./BancadaDaPauta";
import { fonteDoArquivo } from "./useItensDoMes";
import type { ItemDoMes, ArteNaAgenda } from "./useItensDoMes";

const BASES = ESTILOS_DE_VIDEO_DA_PAUTA;

export default function EstudioDeVideoDaPauta({ item, arte }: { item: ItemDoMes; arte?: ArteNaAgenda | null }) {
  const { clientId } = useMesa();
  const chave = (parte: string) => chaveDoEstudioDaPauta(clientId, item.id, parte);
  const [base, setBase] = useEstadoDaTela<string>(chave("base-video"), item.video?.estilo || "produto");
  const [ids, setIds] = useEstadoDaTela<string[]>(chave("pedidos-video"), [], { validar: Array.isArray });
  const [aba, setAba] = useState("gerar");
  const arquivosQ = useArquivosDeVideo(clientId);
  const pedidosQ = usePedidos(clientId);
  const versoesQ = useVersoes(clientId);
  const pedidos = (pedidosQ.data?.itens || []).filter((p) => p.parametros.task_id === item.id || ids.includes(p.id));
  const arquivos = resultadosDeVideoDaPauta(clientId, item.id, arquivosQ.data?.arquivos || [], pedidosQ.data?.itens || [], versoesQ.data?.itens || [], ids);
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
  const agenda = fonteDoArquivo(arte?.capa);
  const tema = BASES.find((b) => b.id === base) || BASES[0];
  return <div className="flex min-h-0 flex-1 flex-col" data-video-da-pauta={item.id}>
    <BancadaDaPauta tipo="video" titulo={item.title}
      ativa={aba} onAba={setAba} abas={[
        { id: "gerar", nome: "Gerar vídeo", icone: PenLine },
        { id: "som", nome: "Trilha sonora", icone: Music },
        { id: "legenda", nome: "Legendar o vídeo", icone: Type },
        { id: "entrega", nome: "Legenda do post e aprovação", icone: Send },
        { id: "resultados", nome: "Gerações e versões", icone: History },
      ]}
      acoes={<AjudaRecolhida rotulo="Direção do vídeo">{tema.texto}</AjudaRecolhida>}
      prancheta={<div className="space-y-2"><button type="button" aria-pressed={aba === 'gerar'} className="w-full rounded-lg border border-dashed px-2 py-5 text-[12px]" onClick={() => setAba('gerar')}>+ Gerar vídeo</button>{arquivos.map((a, i) => <button type="button" key={a.id} aria-pressed={atual?.id === a.id} onClick={() => { setVendo(a.id); setAba('entrega'); }} className={`w-full rounded-lg border px-2 py-4 text-left text-[12px] ${atual?.id === a.id ? 'border-primary bg-primary/10' : ''}`}>Vídeo {i + 1}<span className="mt-2 block truncate">{a.nome}</span></button>)}{arte?.capa?.tipo_midia === "video" && <p className="rounded-lg border p-3 text-[12px] text-primary">Vídeo na Agenda</p>}</div>}
      previa={<><p className="mb-3 text-[13px] font-semibold">{atual?.nome || tema.nome}</p>{atual ? <PreviaDaPauta key={atual.id} caminho={atual.storage_path} bucket={atual.storage_bucket} nome={atual.nome} video /> : agenda.caminho && arte?.capa?.tipo_midia === 'video' ? <PreviaDaPauta caminho={agenda.caminho} bucket={agenda.bucket} nome={item.title} video /> : <div className="flex min-h-[400px] flex-1 flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center"><p className="text-[13px] font-medium">{tema.nome}</p><p className="mt-3 max-w-md text-[13px] text-muted-foreground">{tema.texto}</p><p className="mt-3 text-[12px] text-primary">A direção já está preparada. Confira as fotos e gere nas ferramentas ao lado.</p></div>}
        <div className="mt-3 max-h-52 overflow-y-auto"><GeracoesRecentes arquivos={arquivos} taskId={item.id} pedidosIds={ids} /></div>
      </>}
      ferramentas={<div className="space-y-4">
      <PainelDaBancada id="gerar"><label className="block text-[13px] font-medium">Estilo do vídeo<select aria-label="Estilo do vídeo" className="mt-2 w-full rounded-md border bg-background p-2 text-[13px]" value={base} onChange={(e) => setBase(e.target.value)}>{BASES.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}</select></label><div className="my-2"><AjudaRecolhida rotulo="Sobre este estilo">{tema.texto}</AjudaRecolhida></div><GeradorLivre key={`${item.id}:${base}`} escopo={chave(`video:${base}`)} pauta={item} direcaoInicial={item.video} promptInicial={`${base === item.video?.estilo ? item.video.prompt : tema.texto}\nPauta: ${item.title}\nProduza apenas cenas coerentes com esta pauta e com as referências reais do cliente.`} aoGerar={(id) => { setIds((antes) => Array.from(new Set([...antes, id]))); setAba('resultados'); }} /></PainelDaBancada>
      <PainelDaBancada id="som">{atual ? <TrilhaDoVideoDaPauta key={atual.id} arquivo={atual} taskId={item.id} /> : <p className="text-[13px]">Gere ou escolha um vídeo na prancheta para adicionar a trilha.</p>}</PainelDaBancada>
      <PainelDaBancada id="legenda">{atual ? <ul><LinhaDoFinal arquivo={atual} variantes={[]} antes={null} /></ul> : <p className="text-[13px]">A legenda fica disponível quando o vídeo estiver pronto.</p>}</PainelDaBancada>
      <PainelDaBancada id="entrega">{atual ? <EntregaDoVideoDaPauta key={atual.id} item={item} arquivo={atual} /> : <p role="status" className="text-[13px]">{arte ? 'Este vídeo já está na Agenda.' : 'Escolha um resultado na prancheta para preparar a legenda e enviar para aprovação.'}</p>}</PainelDaBancada>
      <PainelDaBancada id="resultados"><p className="text-[13px]">{arquivos.length ? `${arquivos.length} versões prontas na prancheta. Clique em uma para conferir e preparar a entrega.` : 'A geração aparece abaixo da prévia. O resultado entra automaticamente na prancheta.'}</p><button type="button" className="mt-3 rounded-md border p-2 text-[12px]" onClick={() => { void arquivosQ.refetch(); void pedidosQ.refetch(); void versoesQ.refetch(); }}>Conferir resultados</button></PainelDaBancada>
      {(arquivosQ.isError || pedidosQ.isError) && <p role="alert">Não foi possível ler os resultados. <button type="button" onClick={() => { void arquivosQ.refetch(); void pedidosQ.refetch(); }}>Recarregar</button></p>}
      </div>} />
  </div>;
}
