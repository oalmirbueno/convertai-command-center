import EntregaDoVideoDaPauta from "./EntregaDoVideoDaPauta";
import { useState } from "react";
import { useMesa } from "./MesaContexto";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import GeradorLivre from "@/components/mesa-videos/GeradorLivre";
import GeracoesRecentes from "@/components/mesa-videos/GeracoesRecentes";
import { useArquivosDeVideo, usePedidos, useVersoes } from "@/components/mesa-videos/videosApi";
import { LinhaDoFinal } from "@/components/mesa-edicao/Finais";
import { chaveDoEstudioDaPauta } from "./modoDaPauta";
import type { ItemDoMes } from "./useItensDoMes";

const BASES = [
  { id: "produto", nome: "Produto elegante", texto: "Apresente o produto das fotos com movimento de câmera suave, iluminação de estúdio e acabamento realista. Preserve o produto e seus materiais." },
  { id: "imovel", nome: "Apresentação de imóvel", texto: "Apresente este imóvel a partir das fotos reais. Travelling suave, luz natural e proporções fiéis. Não invente cômodos, móveis ou características." },
  { id: "jardim", nome: "Jardim: antes e depois", texto: "Mostre a transformação do jardim, do quadro inicial antes ao quadro final depois. Câmera estável, mesmo ponto de vista, resultado fiel às fotos." },
  { id: "moveis", nome: "Móveis: antes e depois", texto: "Mostre a transformação dos móveis e do ambiente do quadro inicial ao final, preservando medidas, texturas e acabamento das referências." },
  { id: "materiais", nome: "Mármore e sob medida", texto: "Apresente os detalhes reais de acabamento, veios e materiais das fotos, com câmera lenta, luz lateral e aparência elegante." },
] as const;

export default function EstudioDeVideoDaPauta({ item }: { item: ItemDoMes }) {
  const { clientId } = useMesa();
  const chave = (parte: string) => chaveDoEstudioDaPauta(clientId, item.id, parte);
  const [base, setBase] = useEstadoDaTela(chave("base-video"), "produto");
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
  const tema = BASES.find((b) => b.id === base) || BASES[0];
  return <div className="min-h-0 flex-1 overflow-y-auto space-y-4 p-2" data-video-da-pauta={item.id}>
    <nav className="flex gap-2" aria-label="Produção do vídeo">{[['gerar','Gerar vídeo'],['resultados','Resultados e legendas']].map(([id, nome]) => <button type="button" key={id} aria-pressed={aba === id} className={`rounded-md border px-3 py-2 text-xs ${aba === id ? 'bg-primary text-primary-foreground' : ''}`} onClick={() => setAba(id)}>{nome}</button>)}</nav>
    {aba === 'gerar' && <>
      <div className="flex flex-wrap gap-2" aria-label="Base do vídeo">{BASES.map((b) => <button key={b.id} type="button" aria-pressed={base === b.id} onClick={() => setBase(b.id)} className={`rounded-full border px-3 py-1.5 text-xs ${base === b.id ? 'border-primary text-primary' : ''}`}>{b.nome}</button>)}</div>
      <p className="text-xs text-muted-foreground">Escolha fotos reais, confira o pedido e gere. Para antes e depois, use as duas fotos nos quadros inicial e final.</p>
      <GeradorLivre key={`${item.id}:${base}`} escopo={chave(`video:${base}`)} pauta={item} promptInicial={`${tema.texto}\nPauta: ${item.title}`} aoGerar={(id) => { setIds((antes) => Array.from(new Set([...antes, id]))); setAba('resultados'); }} />
    </>}
    {(arquivosQ.isError || pedidosQ.isError) && <p role="alert">Não foi possível ler os resultados. <button type="button" onClick={() => { void arquivosQ.refetch(); void pedidosQ.refetch(); }}>Recarregar</button></p>}
    <GeracoesRecentes arquivos={arquivos} taskId={item.id} pedidosIds={ids} />
    {aba === 'resultados' && <><p className="text-xs text-muted-foreground">Confira o vídeo, gere a legenda da fala e baixe ou guarde no Workspace.</p><div className="space-y-4">{arquivos.map((a) => <section key={a.id} className="rounded-lg border p-3" aria-label={a.nome}><ul><LinhaDoFinal arquivo={a} variantes={[]} antes={null} /></ul><EntregaDoVideoDaPauta item={item} arquivo={a} /></section>)}</div>{!arquivos.length && <p role="status" className="text-sm text-muted-foreground">Os vídeos prontos desta pauta aparecerão aqui.</p>}</>}
  </div>;
}
