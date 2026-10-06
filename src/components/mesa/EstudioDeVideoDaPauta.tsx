import { ESTILOS_DE_VIDEO_DA_PAUTA } from "../../../supabase/functions/_shared/video-da-pauta";
import EntregaDoVideoDaPauta from "./EntregaDoVideoDaPauta";
import { useState } from "react";
import { useMesa } from "./MesaContexto";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import GeradorLivre from "@/components/mesa-videos/GeradorLivre";
import GeracoesRecentes from "@/components/mesa-videos/GeracoesRecentes";
import { useArquivosDeVideo, usePedidos, useVersoes } from "@/components/mesa-videos/videosApi";
import { LinhaDoFinal } from "@/components/mesa-edicao/Finais";
import { chaveDoEstudioDaPauta } from "./modoDaPauta";
import BancadaDaPauta, { PreviaDaPauta } from "./BancadaDaPauta";
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
  const pedidosIds = new Set(pedidos.map((p) => p.id).concat(ids));
  const originais = (arquivosQ.data?.arquivos || []).filter((a) => typeof a.origem?.pedido === 'string' && pedidosIds.has(a.origem.pedido));
  const fontes = new Set(originais.map((a) => a.id));
  const versoes = new Set((versoesQ.data?.itens || []).filter((v) => v.projeto && Object.values(v.projeto.fontes).some((f) => !!f.arquivo_id && fontes.has(f.arquivo_id))).map((v) => v.id));
  const arquivos = (arquivosQ.data?.arquivos || []).filter((a) => a.estado !== 'arquivado' && (fontes.has(a.id) || (typeof a.origem?.versao_id === 'string' && versoes.has(a.origem.versao_id))));
  const [vendo, setVendo] = useState<string | null>(null);
  const atual = arquivos.find((a) => a.id === vendo) || arquivos[0];
  const agenda = fonteDoArquivo(arte?.capa);
  const tema = BASES.find((b) => b.id === base) || BASES[0];
  return <div className="flex min-h-0 flex-1 flex-col" data-video-da-pauta={item.id}>
    <BancadaDaPauta tipo="video" titulo={item.title}
      acoes={<span className="text-[12px] text-muted-foreground">{tema.nome}</span>}
      prancheta={<div className="space-y-2"><button type="button" aria-pressed={aba === 'gerar'} className="w-full rounded-lg border border-dashed px-2 py-5 text-[12px]" onClick={() => setAba('gerar')}>+ Gerar vídeo</button>{arquivos.map((a, i) => <button type="button" key={a.id} aria-pressed={atual?.id === a.id} onClick={() => { setVendo(a.id); setAba('resultados'); }} className={`w-full rounded-lg border px-2 py-4 text-left text-[12px] ${atual?.id === a.id ? 'border-primary bg-primary/10' : ''}`}>Vídeo {i + 1}<span className="mt-2 block truncate">{a.nome}</span></button>)}{arte?.capa?.tipo_midia === "video" && <p className="rounded-lg border p-3 text-[12px] text-primary">Vídeo na Agenda</p>}</div>}
      previa={<><p className="mb-3 text-[13px] font-semibold">{atual?.nome || tema.nome}</p>{atual ? <PreviaDaPauta key={atual.id} caminho={atual.storage_path} bucket={atual.storage_bucket} nome={atual.nome} video /> : agenda.caminho && arte?.capa?.tipo_midia === 'video' ? <PreviaDaPauta caminho={agenda.caminho} bucket={agenda.bucket} nome={item.title} video /> : <div className="flex min-h-[400px] flex-1 flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center"><p className="text-[13px] font-medium">{tema.nome}</p><p className="mt-3 max-w-md text-[13px] text-muted-foreground">{tema.texto}</p><p className="mt-3 text-[12px] text-primary">A direção já está preparada. Confira as fotos e gere nas ferramentas ao lado.</p></div>}
        <div className="mt-3 max-h-52 overflow-y-auto"><GeracoesRecentes arquivos={arquivos} taskId={item.id} pedidosIds={ids} /></div>
      </>}
      ferramentas={<div className="space-y-4"><nav className="flex gap-2" aria-label="Produção do vídeo">{[['gerar','Gerar vídeo'],['resultados','Legenda e entrega']].map(([id, nome]) => <button type="button" key={id} aria-pressed={aba === id} className={`rounded-md border px-3 py-2 text-[12px] ${aba === id ? 'bg-primary text-primary-foreground' : ''}`} onClick={() => setAba(id)}>{nome}</button>)}</nav>
      {aba === 'gerar' ? <><label className="block text-[13px] font-medium">Estilo do vídeo<select aria-label="Estilo do vídeo" className="mt-2 w-full rounded-md border bg-background p-2 text-[13px]" value={base} onChange={(e) => setBase(e.target.value)}>{BASES.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}</select></label><GeradorLivre key={`${item.id}:${base}`} escopo={chave(`video:${base}`)} pauta={item} direcaoInicial={item.video} promptInicial={`${base === item.video?.estilo ? item.video.prompt : tema.texto}\nPauta: ${item.title}`} aoGerar={(id) => { setIds((antes) => Array.from(new Set([...antes, id]))); setAba('resultados'); }} /></> : atual ? <><ul><LinhaDoFinal arquivo={atual} variantes={[]} antes={null} /></ul><EntregaDoVideoDaPauta item={item} arquivo={atual} /></> : <p role="status" className="text-[13px] text-muted-foreground">{arte ? 'Este vídeo já está na Agenda. Confira a legenda e a publicação na Agenda.' : 'O resultado aparece aqui assim que a geração terminar.'}</p>}
      {(arquivosQ.isError || pedidosQ.isError) && <p role="alert">Não foi possível ler os resultados. <button type="button" onClick={() => { void arquivosQ.refetch(); void pedidosQ.refetch(); }}>Recarregar</button></p>}
      </div>} />
  </div>;
}
