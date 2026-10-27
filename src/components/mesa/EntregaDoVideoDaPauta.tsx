import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FolderCheck, Loader2, PenLine, Send, Undo2 } from "lucide-react";
import { useImpersonation } from "@/contexts/ImpersonationContext";
import { useAuth } from "@/contexts/AuthContext";
import { botao, campo, campoTexto, juntar, texto } from "@/components/sistema/estilos";
import { padraoPara, parteDaConferenciaDoJev, TAMANHOS, textoDoErro, type ParteDaEstimativa } from "@/lib/mesa/api";
import { opcoesDaEntrega, type ModoDeEntrega } from "@/lib/mesa/entregaComOpcoes";
import type { ArquivoDeVideo } from "@/components/mesa-videos/videosApi";
import { BotaoComCusto } from "./Custo";
import { useEstadoGuardado } from "./estudioUtil";
import { useMesa } from "./MesaContexto";
import { desfazerPreparo, legendaComHashtags, legendaDoVideo, prepararParaPublicar, textoDoPreparo, type ResultadoDoPreparo, type VideoDaPauta } from "./videoDaPauta";
import type { ItemDoMes } from "./useItensDoMes";

/**
 * Enviar o vídeo escolhido na prancheta (27/10/2026, dono: "enviar para aprovação igual o fluxo normal").
 * O mesmo caminho da peça e do carrossel, num clique: Workspace -> Arquivos -> legenda da casa (com o roteiro)
 * -> post de Reels na Agenda no dia da peça -> revisão da agência e aprovação do cliente. Também "Pronto para
 * agendar" (admin e gestor) e "Só Arquivos". Reaproveita o post da tarefa; Desfazer arquiva o que o envio criou.
 * Nada é publicado sem aprovação.
 */
export default function EntregaDoVideoDaPauta({ item, arquivo }: { item: ItemDoMes; arquivo: ArquivoDeVideo }) {
  const { clientId, userId, catalogo } = useMesa();
  const { profile } = useAuth();
  const { isImpersonating } = useImpersonation();
  const qc = useQueryClient();
  const podeEditar = ["admin", "manager", "design"].indexOf(profile?.role || "") >= 0 && !isImpersonating;
  const podeLiberar = ["admin", "manager"].indexOf(profile?.role || "") >= 0 && !isImpersonating;
  const opcoes = opcoesDaEntrega(podeLiberar);
  const [modoGuardado, setModo] = useEstadoGuardado<ModoDeEntrega>("mesa:estudio:modo-da-entrega", "aprovacao");
  const modo: ModoDeEntrega = opcoes.some((o) => o.modo === modoGuardado) ? modoGuardado : "aprovacao";
  const [preparo, setPreparo] = useState<ResultadoDoPreparo | null>(null);
  const [ocupado, setOcupado] = useState<"arquivos" | "desfazer" | null>(null);
  const diretor = padraoPara(catalogo, "diretor_arte");
  // 27/10 (dono: "o conteúdo é preparado antes do vídeo; gerar a legenda e passar para publicar igual no
  // carrossel"): a legenda do post sai do roteiro e do tema da pauta (sem transcrever o vídeo), aparece aqui
  // e pode ser editada antes de entregar. Entregar usa o texto que está no campo.
  const [legenda, setLegenda] = useState("");
  const video: VideoDaPauta = { bucket: arquivo.storage_bucket || "mesa", caminho: arquivo.storage_path, nome: arquivo.nome || arquivo.nome_original, fonte: "ia", arquivo_id: arquivo.id, ...(arquivo.duracao_s ? { duracao_s: arquivo.duracao_s } : {}) };

  const reler = () => {
    void qc.invalidateQueries({ queryKey: ["mesa", "itens-do-mes", clientId] });
    void qc.invalidateQueries({ queryKey: ["mesa", "item-avulso", clientId] });
    void qc.invalidateQueries({ queryKey: ["editorial-calendar"] });
  };
  const partes = (): ParteDaEstimativa[] => [
    { modeloId: diretor ? diretor.id : "", tipo: "texto", tokensEntrada: TAMANHOS.legenda.entrada, tokensSaida: TAMANHOS.legenda.saida } as ParteDaEstimativa,
    parteDaConferenciaDoJev(),
    parteDaConferenciaDoJev(),
  ];
  const escrever = async () => {
    const l = await legendaDoVideo(clientId, item.id);
    setLegenda(legendaComHashtags(l));
    return { custo_usd: Number(l && l.custo_usd) || 0 };
  };
  const enviar = async () => {
    if (!userId) throw new Error("Entre de novo para enviar.");
    const pronta = legenda.trim();
    const l = pronta ? null : await legendaDoVideo(clientId, item.id);
    const r = await prepararParaPublicar({ clientId, userId, item, video, legenda: pronta || legendaComHashtags(l!), modo });
    return { ...r, custo_usd: l ? Number(l.custo_usd) || 0 : 0 };
  };
  const soArquivos = async () => {
    if (!userId) return;
    setOcupado("arquivos");
    try {
      setPreparo(await prepararParaPublicar({ clientId, userId, item, video, legenda: "", modo: "arquivos" }));
      reler();
      toast.success("Vídeo em Arquivos", { description: "Sem post na Agenda e sem aprovação." });
    } catch (e) {
      toast.error("O vídeo não foi para Arquivos", { description: textoDoErro(e) });
    } finally {
      setOcupado(null);
    }
  };
  const desfazer = async () => {
    if (!preparo) return;
    setOcupado("desfazer");
    try {
      await desfazerPreparo(preparo);
      setPreparo(null);
      reler();
      toast.success("Envio desfeito", { description: "O post saiu da Agenda. O vídeo continua no Workspace e em Arquivos." });
    } catch (e) {
      toast.error("Não deu para desfazer", { description: textoDoErro(e) });
    } finally {
      setOcupado(null);
    }
  };

  if (preparo) {
    return <div className="min-w-0 space-y-2" data-entrega-do-video="feita">
      <p className="text-[13px]" role="status">{textoDoPreparo(preparo)}</p>
      {preparo.legenda && <p className={juntar(texto.auxiliar, "line-clamp-4 whitespace-pre-wrap")}>{preparo.legenda}</p>}
      {preparo.post_id && preparo.criado && <button type="button" className={botao.icone} onClick={() => void desfazer()} disabled={ocupado === "desfazer"} aria-label="Desfazer o envio" title="Desfazer o envio (o post sai da Agenda)">
        {ocupado === "desfazer" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Undo2 className="h-4 w-4" aria-hidden="true" />}
      </button>}
    </div>;
  }
  return <div className="min-w-0 space-y-3" data-entrega-do-video="">
    {modo !== "arquivos" && <div className="min-w-0" data-legenda-do-post-do-video="">
      <div className="mb-1 flex min-w-0 items-center justify-between">
        <label className="text-[12px] text-muted-foreground" htmlFor={`legenda-video-${item.id}`}>Legenda do post</label>
        <BotaoComCusto rotulo={<><PenLine className="mr-1 h-3.5 w-3.5" aria-hidden="true" />{legenda ? "Escrever de novo" : "Escrever pelo roteiro"}</>} titulo="Legenda do post" descricao="Escreve a legenda do Reels pelo roteiro e pelo tema da pauta, sem transcrever o vídeo. Você confere e edita aqui antes de entregar." partes={partes} disabled={!podeEditar || !diretor} executar={escrever} className="h-7 px-2" />
      </div>
      <textarea id={`legenda-video-${item.id}`} aria-label="Legenda do post" value={legenda} onChange={(e) => setLegenda(e.target.value)} placeholder="Escreva pelo roteiro (botão acima) ou digite aqui. Vazio: é escrita ao entregar." className={juntar(campoTexto, "min-h-32 text-[13px]")} disabled={!podeEditar} />
    </div>}
    <label className="block min-w-0 text-[12px] text-muted-foreground">Como entregar
      <select className={juntar(campo, "mt-1")} value={modo} onChange={(e) => setModo(e.target.value as ModoDeEntrega)} disabled={!podeEditar} aria-label="Como entregar o vídeo">
        {opcoes.map((o) => <option key={o.modo} value={o.modo} title={o.dica}>{o.modo === "aprovacao" && !podeLiberar ? "Pedir revisão" : o.curto}</option>)}
      </select>
    </label>
    <p className={texto.auxiliar}>{opcoes.find((o) => o.modo === modo)?.dica}</p>
    {modo === "arquivos" ? (
      <button type="button" className={juntar(botao.primario, "h-8 px-3 text-[12px]")} onClick={() => void soArquivos()} disabled={!podeEditar || ocupado === "arquivos"}>
        {ocupado === "arquivos" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FolderCheck className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}Entregar
      </button>
    ) : (
      <BotaoComCusto
        rotulo={<><Send className="mr-1 h-3.5 w-3.5" aria-hidden="true" />{modo === "pronto" ? "Aprovar e agendar" : "Enviar para aprovação"}</>}
        titulo={modo === "pronto" ? "Pronto para agendar" : "Enviar para aprovação"}
        descricao={modo === "pronto"
          ? "Leva este vídeo para Arquivos, escreve a legenda com o roteiro como base, aprova em nome do cliente e agenda o Reels na data da peça."
          : "Leva este vídeo para Arquivos, escreve a legenda com o roteiro como base e cria o post de Reels na Agenda no dia da peça, aguardando a revisão da agência e a aprovação do cliente. Nada é publicado sem aprovação."}
        partes={() => (legenda.trim() ? [] : partes())}
        disabled={!podeEditar || (!diretor && !legenda.trim())}
        executar={enviar}
        aoConcluir={(data) => { setPreparo(data as ResultadoDoPreparo); reler(); }}
        className="h-8 px-3"
      />
    )}
    {!podeEditar && <p className={texto.auxiliar}>Só a equipe de criação envia.</p>}
  </div>;
}
