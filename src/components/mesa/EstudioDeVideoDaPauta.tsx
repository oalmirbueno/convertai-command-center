import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { AlertCircle, History, Loader2, Music, PenLine, Plus, Repeat2, Scissors, Send, SlidersHorizontal, Type, Video, X } from "lucide-react";
import ContinuarVideo from "@/components/mesa-videos/ContinuarVideo";
import CapaDoVideo from "@/components/sistema/CapaDoVideo";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import CortarVideoDaPauta from "./CortarVideoDaPauta";
import { textoDoErro } from "@/lib/mesa/api";
import GravarDaPauta from "./GravarDaPauta";
import TrilhaDoVideoDaPauta from "./TrilhaDoVideoDaPauta";
import { resultadosDeVideoDaPauta, videoEnviadoDaPeca } from "./resultadosDeVideoDaPauta";
import { ESTILOS_DE_VIDEO_DA_PAUTA } from "../../../supabase/functions/_shared/video-da-pauta";
import EntregaDoVideoDaPauta from "./EntregaDoVideoDaPauta";
import MidiaDaPauta from "./MidiaDaPauta";
import PecaDeVideoDaPauta from "./PecaDeVideoDaPauta";
import { useEffect, useRef, useState } from "react";
import { garantirVideoNoAcervo, guardarVideoDaPauta } from "./videoDaPauta";
import type { VideoProntoDaPeca } from "../../../supabase/functions/agente-calendario/modulos/roteiro-de-video";
import { useMesa } from "./MesaContexto";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { juntar, texto } from "@/components/sistema/estilos";
import GeradorLivre from "@/components/mesa-videos/GeradorLivre";
import { chamarMesaVideos, chaveDosArquivos, useArquivosDeVideo, usePedidos, useVersoes, type ArquivoDeVideo, type PedidoDeVideo } from "@/components/mesa-videos/videosApi";
import { TIPOS_DO_GERADOR } from "@/lib/mesa-videos/api";
import { LinhaDoFinal } from "@/components/mesa-edicao/Finais";
import { chaveDoEstudioDaPauta } from "./modoDaPauta";
import BancadaDaPauta, { PainelDaBancada } from "./BancadaDaPauta";
import { direcaoComFotoReal, precisaDeFotoReal, useFotoRealDaPeca } from "./useFotoRealDaPeca";
import ComposicaoDoVideoDaPauta from "./ComposicaoDoVideoDaPauta";
import GeracoesDaPauta from "./GeracoesDaPauta";
import { arquivosDeCena } from "./composicaoDoVideo";
import { situacaoDoPedido } from "./estadoDaGeracao";
import type { ItemDoMes, ArteNaAgenda } from "./useItensDoMes";

const BASES = ESTILOS_DE_VIDEO_DA_PAUTA;

/** Os pedidos do gerador desta pauta (os três vínculos: parâmetro, alvo e os pedidos desta tela). */
export function pedidosDaPauta(clientId: string, taskId: string, pedidos: PedidoDeVideo[], locais: string[] = []): PedidoDeVideo[] {
  return pedidos.filter((p) => p.client_id === clientId && TIPOS_DO_GERADOR.indexOf(String(p.tipo)) >= 0 && (p.parametros?.task_id === taskId || (p.alvo as { task_id?: string } | null)?.task_id === taskId || locais.includes(p.id)));
}

/**
 * 27/10: a miniatura do vídeo na prancheta é o primeiro quadro do próprio vídeo (o <img> com o caminho do MP4
 * aparecia quebrado: a miniatura .mini.jpg só existe depois que alguém abre o vídeo no navegador).
 */
function QuadroDoVideo({ bucket, caminho }: { bucket: string; caminho: string }) {
  // 29/10/2026: a capa leve (<vídeo>.mini.jpg) quando existe; senão o quadro do vídeo, carregado ao aparecer.
  return <CapaDoVideo bucket={bucket} caminho={caminho} />;
}

/** O nome do resultado na prancheta: o vídeo final montado, a cena da composição ou a geração solta. */
function nomeNaPrancheta(a: ArquivoDeVideo, pedidos: PedidoDeVideo[], k: number): string {
  if (a.origem && typeof a.origem.versao_id === "string") return "Vídeo final";
  const p = pedidos.find((x) => x.id === a.pedido_id || x.id === (a.origem && a.origem.pedido));
  const comp = p && (p.parametros as { composicao?: { ordem?: number } }).composicao;
  if (comp && comp.ordem) return `Cena ${comp.ordem}`;
  return `Vídeo ${k + 1}`;
}

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
  const todosOsArquivos = arquivosQ.data?.arquivos || [];
  const pedidos = pedidosDaPauta(clientId, item.id, pedidosQ.data?.itens || [], ids);
  const gerados = resultadosDeVideoDaPauta(clientId, item.id, todosOsArquivos, pedidosQ.data?.itens || [], versoesQ.data?.itens || [], ids);
  // 25/10: o vídeo enviado para a peça (Pronto) também libera legendar, trilha e entrega, como as gerações da IA.
  // 27/10: o mesmo vídeo que a peça mostra: o que acabou de subir (antes da lista reler), o do plano ou o guardado
  // nesta tela (pauta sem plano do Mês).
  const [videoDaPeca, setVideoDaPeca] = useState<VideoProntoDaPeca | null | undefined>(undefined);
  const [semPlano] = useEstadoDaTela<VideoProntoDaPeca | null>(chave("video-pronto"), null, { validar: (v) => v === null || (!!v && typeof v === "object") });
  const pronto = videoDaPeca !== undefined ? videoDaPeca : item.video_pronto || semPlano;
  const enviado = videoEnviadoDaPeca(clientId, pronto, todosOsArquivos);
  const arquivos = enviado && !gerados.some((a) => a.id === enviado.id) ? [enviado, ...gerados] : gerados;
  // 27/10: a cena de uma composição fica na prancheta, mas só o vídeo final montado vira o vídeo da peça.
  const deCena = arquivosDeCena(pedidos, todosOsArquivos);
  const paraAPeca = arquivos.filter((a) => !deCena.has(a.id));
  useEffect(() => {
    void arquivosQ.refetch(); void pedidosQ.refetch(); void versoesQ.refetch();
  }, [clientId, item.id]);
  // 27/10 (bug do "gerando" parado): o pedido que fica pronto relê a lista de arquivos uma vez, para o resultado
  // entrar sozinho na prancheta e no player. A conferência no provedor fica no GeracoesDaPauta (uma só, com recuo).
  const prontosAgora = pedidos.filter((p) => ["pronto", "parcial"].includes(String(p.estado))).map((p) => p.id).join(",");
  useEffect(() => {
    if (prontosAgora) { void arquivosQ.refetch(); void versoesQ.refetch(); }
  }, [prontosAgora]);
  const [vendo, setVendo] = useState<string | null>(null);
  const cache = useQueryClient();
  // 27/10 (dono: "vídeo Pronto e a aba Legendar diz que fica disponível quando o vídeo estiver pronto"): o vídeo
  // Pronto da peça sempre entra na prancheta. Sem registro no acervo na lista, relê uma vez (o envio acabou de
  // criar); ainda sem, registra no acervo da Mesa Vídeos e guarda o id na peça.
  const chaveDoPronto = pronto ? `${pronto.bucket}:${pronto.caminho}:${pronto.arquivo_id || ""}` : "";
  const conferido = useRef("");
  const [noAcervo, setNoAcervo] = useState<{ estado: "registrando" | "erro"; mensagem?: string } | null>(null);
  const temLista = !!arquivosQ.data;
  useEffect(() => {
    if (!pronto || enviado || !temLista || arquivosQ.isFetching || conferido.current === chaveDoPronto) return;
    conferido.current = chaveDoPronto;
    const alvo = pronto;
    void (async () => {
      const relida = await arquivosQ.refetch();
      if (videoEnviadoDaPeca(clientId, alvo, (relida.data && relida.data.arquivos) || []) || alvo.bucket !== "workspace") return;
      setNoAcervo({ estado: "registrando" });
      const id = await garantirVideoNoAcervo(clientId, alvo);
      const comId: VideoProntoDaPeca = { ...alvo, arquivo_id: id };
      await guardarVideoDaPauta(clientId, item.id, comId).catch(() => undefined);
      setVideoDaPeca(comId);
      await cache.invalidateQueries({ queryKey: chaveDosArquivos(clientId) });
      setNoAcervo(null);
    })().catch((e) => setNoAcervo({ estado: "erro", mensagem: textoDoErro(e) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveDoPronto, !!enviado, temLista, arquivosQ.isFetching]);
  const semVideo = (padrao: string) => noAcervo && noAcervo.estado === "registrando"
    ? <p role="status" className="text-[13px]"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" aria-hidden="true" />Preparando o vídeo da peça no acervo…</p>
    : noAcervo && noAcervo.estado === "erro"
      ? <p role="alert" className="text-[13px] text-destructive">O vídeo da peça não entrou no acervo: {noAcervo.mensagem} <button type="button" className="underline" onClick={() => { conferido.current = ""; setNoAcervo(null); void arquivosQ.refetch(); }}>Tentar de novo</button></p>
      : <p className="text-[13px]">{padrao}</p>;
  // 27/10 (dono: "poder remover ali o que eu não quero mais"): tira da prancheta arquivando o resultado, com
  // Desfazer. O vídeo que está na peça (Pronto) sai pela própria peça; versão aprovada fica (o servidor recusa).
  const [tirando, setTirando] = useState<string | null>(null);
  const tirarDaPrancheta = async (a: ArquivoDeVideo) => {
    setTirando(a.id);
    try {
      const r = await chamarMesaVideos<{ desfazer: Record<string, unknown> }>({ acao: "arquivo_editar", arquivo_id: a.id, campos: { estado: "arquivado" } });
      if (vendo === a.id) setVendo(null);
      void cache.invalidateQueries({ queryKey: chaveDosArquivos(clientId) });
      toast.success("Saiu da prancheta", { description: "Fica arquivado no acervo da Mesa Vídeos.", action: { label: "Desfazer", onClick: () => void chamarMesaVideos({ acao: "arquivo_editar", arquivo_id: a.id, campos: r.desfazer }).then(() => cache.invalidateQueries({ queryKey: chaveDosArquivos(clientId) })).catch((e) => toast.error("Não deu para desfazer", { description: textoDoErro(e) })) } });
    } catch (e) {
      toast.error("Não saiu da prancheta", { description: textoDoErro(e) });
    } finally {
      setTirando(null);
    }
  };
  const atual = arquivos.find((a) => a.id === vendo) || paraAPeca[0] || arquivos[0];
  const tema = BASES.find((b) => b.id === base) || BASES[0];
  // 26/10: foto real primeiro. Sem imagem de partida escolhida, a melhor foto real do acervo (Jev) abre pré-selecionada.
  const perguntar = !gravar && precisaDeFotoReal(item);
  const fotoRealQ = useFotoRealDaPeca(clientId, item.id, "video", perguntar);
  const fotoReal = perguntar ? fotoRealQ.data : null;
  const direcao = direcaoComFotoReal(item.video, fotoReal);
  const chaveDaFoto = fotoReal && fotoReal.modo === "real" ? fotoReal.fotos[0]?.id || "" : "";
  const idsDaFotoReal = fotoReal && fotoReal.modo === "real" ? fotoReal.fotos.map((f) => f.id) : [];
  const andando = pedidos.filter((p) => ["enviado", "gerando", "baixando", "erro", "parcial"].includes(String(p.estado))).slice(0, 4);
  const agora = Date.now();
  return <div className="flex min-h-0 flex-1 flex-col" data-video-da-pauta={item.id}>
    <BancadaDaPauta tipo="video" titulo={item.title}
      ativa={aba} onAba={setAba} abas={[
        ...(gravar ? [{ id: "gravar", nome: "Gravar com roteiro", icone: Video }] : []),
        { id: "gerar", nome: "Gerar vídeo com IA", icone: PenLine },
        ...(gravar ? [] : [{ id: "gravar", nome: "Gravar com roteiro", icone: Video }]),
        // 29/10/2026 (dono: "gerar mais vídeos a partir daquele, como referência, usar ou editar"): o vídeo da peça vira ponto de partida.
        { id: "apartir", nome: "A partir deste vídeo", icone: Repeat2 },
        { id: "som", nome: "Trilha sonora", icone: Music },
        { id: "legenda", nome: "Falas na tela (legenda no vídeo)", icone: Type },
        { id: "cortar", nome: "Cortar o vídeo", icone: Scissors },
        { id: "entrega", nome: "Enviar para aprovação", icone: Send },
        { id: "resultados", nome: "Gerações e versões", icone: History },
        { id: "livre", nome: "Gerador livre (avançado)", icone: SlidersHorizontal },
      ]}
      acoes={<AjudaRecolhida rotulo="Direção do vídeo">{tema.texto}</AjudaRecolhida>}
      prancheta={<div className="flex min-w-0 items-start gap-2 overflow-x-auto lg:block lg:space-y-2 lg:overflow-visible" data-prancheta-do-video="">
        <button type="button" aria-pressed={aba === "gerar"} aria-label="Gerar vídeo com IA" title="Gerar vídeo com IA" className="flex h-12 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground lg:h-auto lg:w-full lg:py-2" onClick={() => setAba("gerar")}><Plus className="h-4 w-4" aria-hidden="true" /></button>
        {andando.map((p) => {
          const l = situacaoDoPedido(p, agora);
          const falhou = l.situacao === "falhou" || l.situacao === "parcial";
          return <button type="button" key={p.id} onClick={() => setAba("resultados")} className="flex w-36 min-w-0 shrink-0 items-center rounded-lg px-1 py-1 text-left hover:bg-muted lg:w-full" title={`${l.rotulo}: ${l.detalhe}`} data-pedido-na-prancheta={l.situacao}>
            <span className={juntar("mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded bg-muted", falhou ? "text-destructive" : "text-muted-foreground")}>{falhou ? <AlertCircle className="h-4 w-4" aria-hidden="true" /> : <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}</span>
            <span className="min-w-0 flex-1"><span className={juntar("block truncate text-[12px] font-medium", falhou && "text-destructive")}>{l.rotulo}</span><span className={juntar(texto.auxiliar, "block truncate")}>{falhou ? "Ver o motivo" : l.detalhe}</span></span>
          </button>;
        })}
        <ol className="flex shrink-0 gap-2 lg:flex-col">{arquivos.map((a, i) => <li key={a.id} className="relative w-12 shrink-0 lg:w-full">{a.id !== enviado?.id && <button type="button" disabled={tirando === a.id} onClick={() => void tirarDaPrancheta(a)} aria-label={`Tirar ${nomeNaPrancheta(a, pedidos, i)} da prancheta`} title="Tirar da prancheta" className="absolute right-1 top-1 z-10 rounded-full bg-card/90 p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50">{tirando === a.id ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <X className="h-3 w-3" aria-hidden="true" />}</button>}<button type="button" aria-pressed={atual?.id === a.id} onClick={() => { setVendo(a.id); setAba("entrega"); }} className={`block w-full overflow-hidden rounded-lg border-2 text-left ${atual?.id === a.id ? "border-primary" : "border-transparent"}`} title={a.nome}>
          <span className="relative block aspect-[9/16] w-full bg-muted"><QuadroDoVideo bucket={a.storage_bucket || "mesa"} caminho={a.storage_path} /></span>
        </button><p className={juntar(texto.auxiliar, "mt-1 truncate")}>{nomeNaPrancheta(a, pedidos, i)}</p></li>)}</ol>
        {arte?.capa?.tipo_midia === "video" && <p className="text-[12px] text-primary">Vídeo na Agenda</p>}
      </div>}
      // 24/10 (dono): o miolo é a peça (A fazer / Pronto, Vídeo, Roteiro e Só o texto, subir e preparar para publicar);
      // a direção genérica do estilo ("Produto elegante") ficou só no "?" da barra. A linha da mídia mora dentro da peça, não solta acima.
      previa={<><MidiaDaPauta item={{ ...item, modo_estudio: "video" }} /><PecaDeVideoDaPauta item={item} arte={arte} geracoes={paraAPeca} emFoco={vendo ? atual || null : null} aoGerar={() => setAba("gerar")} aoAPartir={() => setAba("apartir")} aoAbrirRoteiro={() => setAba("gravar")} aoEntregar={() => setAba("entrega")} aoMudarVideo={(v) => { conferido.current = ""; setNoAcervo(null); setVideoDaPeca(v); }} />
        <div className="mt-3"><GeracoesDaPauta pedidos={pedidos} compacta titulo="Gerando agora" /></div>
      </>}
      ferramentas={<div className="space-y-4">
      <PainelDaBancada id="gravar"><GravarDaPauta item={item} /></PainelDaBancada>
      <PainelDaBancada id="gerar">{fotoReal && <p className="mb-2 text-[12px] text-muted-foreground" role="status" data-foto-real={fotoReal.modo}>{fotoReal.linha}</p>}<ComposicaoDoVideoDaPauta item={item} pedidos={pedidos} arquivos={todosOsArquivos} fotoReal={idsDaFotoReal} /></PainelDaBancada>
      <PainelDaBancada id="livre"><label className="block text-[13px] font-medium">Estilo do vídeo<select aria-label="Estilo do vídeo" className="mt-2 w-full rounded-md border bg-background p-2 text-[13px]" value={base} onChange={(e) => setBase(e.target.value)}>{BASES.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}</select></label><div className="my-2"><AjudaRecolhida rotulo="Sobre este estilo">{tema.texto}</AjudaRecolhida></div>{aba === "livre" && <GeradorLivre key={`${item.id}:${base}:${item.midia?.gerada_em || ""}:${chaveDaFoto}`} escopo={chave(`video:${base}${item.midia?.gerada_em ? `:${item.midia.gerada_em}` : ""}`)} pauta={item} direcaoInicial={direcao} promptInicial={`${base === item.video?.estilo ? item.video.prompt : tema.texto}\nPauta: ${item.title}\nProduza apenas cenas coerentes com esta pauta e com as referências reais do cliente.`} aoGerar={(id) => { setIds((antes) => Array.from(new Set([...antes, id]))); setAba("resultados"); }} />}</PainelDaBancada>
      <PainelDaBancada id="apartir">{atual ? <div className="space-y-4" data-a-partir-do-video={atual.id}>
        <p className="text-[13px]">Use <strong>{atual.nome}</strong> como ponto de partida: continue a história, faça uma nova versão da mesma abertura ou emende com outro vídeo. O resultado entra na prancheta desta pauta.</p>
        <div className="flex flex-wrap gap-2" aria-label="Editar este vídeo">
          <button type="button" className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-[12px] hover:bg-muted" onClick={() => setAba("cortar")}><Scissors className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Cortar</button>
          <button type="button" className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-[12px] hover:bg-muted" onClick={() => setAba("som")}><Music className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Trilha</button>
          <button type="button" className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-[12px] hover:bg-muted" onClick={() => setAba("legenda")}><Type className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Legenda</button>
          <button type="button" className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-[12px] hover:bg-muted" onClick={() => setAba("entrega")}><Send className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Enviar para aprovação</button>
        </div>
        <ContinuarVideo key={atual.id} videoInicial={atual.id} taskId={item.id} escopo={chave(`a-partir:${atual.id}`)} aoGerar={(id) => { setIds((antes) => Array.from(new Set([...antes, id]))); setAba("resultados"); }} />
      </div> : semVideo("Suba, escolha no Workspace ou gere um vídeo para usar como ponto de partida.")}</PainelDaBancada>
      <PainelDaBancada id="som">{atual ? <TrilhaDoVideoDaPauta key={atual.id} arquivo={atual} taskId={item.id} /> : semVideo("Gere ou escolha um vídeo na prancheta para adicionar a trilha.")}</PainelDaBancada>
      <PainelDaBancada id="legenda">{atual ? <ul><LinhaDoFinal arquivo={atual} variantes={[]} antes={null} /></ul> : semVideo("A legenda fica disponível quando o vídeo estiver pronto.")}</PainelDaBancada>
      <PainelDaBancada id="cortar">{atual ? <CortarVideoDaPauta key={atual.id} arquivo={atual} /> : semVideo("Gere ou escolha um vídeo na prancheta para cortar.")}</PainelDaBancada>
      <PainelDaBancada id="entrega">{atual ? <EntregaDoVideoDaPauta key={atual.id} item={item} arquivo={atual} /> : <p role="status" className="text-[13px]">{arte ? "Este vídeo já está na Agenda." : "Escolha um resultado na prancheta para preparar a legenda e enviar para aprovação."}</p>}</PainelDaBancada>
      <PainelDaBancada id="resultados"><GeracoesDaPauta pedidos={pedidos} titulo="Gerações desta pauta" conferirSozinho={false} />{arquivos.length > 0 && <p className={juntar(texto.auxiliar, "mt-3")}>{arquivos.length} {arquivos.length === 1 ? "vídeo pronto" : "vídeos prontos"} na prancheta. Clique em um para conferir e preparar a entrega.</p>}</PainelDaBancada>
      {(arquivosQ.isError || pedidosQ.isError) && <p role="alert" className="text-[12px] text-destructive">Não foi possível ler os resultados. <button type="button" className="underline" onClick={() => { void arquivosQ.refetch(); void pedidosQ.refetch(); }}>Recarregar</button></p>}
      </div>} />
  </div>;
}
