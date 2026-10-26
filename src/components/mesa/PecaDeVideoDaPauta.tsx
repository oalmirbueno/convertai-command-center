import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlignLeft, CheckCircle2, CircleDashed, Copy, Film, Loader2, ScrollText, Send, Sparkles, Undo2, Video, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useImpersonation } from "@/contexts/ImpersonationContext";
import { padraoPara, parteDaConferenciaDoJev, TAMANHOS, textoDoErro, type ParteDaEstimativa } from "@/lib/mesa/api";
import { botao, juntar, texto } from "@/components/sistema/estilos";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import type { ArquivoDeVideo } from "@/components/mesa-videos/videosApi";
import { BotaoComCusto } from "./Custo";
import { useMesa } from "./MesaContexto";
import { PreviaDaPauta } from "./BancadaDaPauta";
import { itemDaPauta } from "./GravarDaPauta";
import { TextoDoRoteiro } from "./RoteiroDaPecaDeVideo";
import { DirecaoParaGravar } from "./GravarVideoDaCampanha";
import { TrazerVideo, type VideoEscolhido } from "./VideoProntoDaPeca";
import { useRoteiroDaPeca } from "./roteiroDaPeca";
import { chaveDoEstudioDaPauta } from "./modoDaPauta";
import {
  desfazerPreparo,
  guardarVideoDaPauta,
  legendaComHashtags,
  legendaDoVideo,
  levarAoWorkspace,
  prepararParaPublicar,
  ROTULO_DO_ESTADO,
  situacaoDoVideo,
  textoCorrido,
  textoDoPreparo,
  type ResultadoDoPreparo,
  type VideoDaPauta,
} from "./videoDaPauta";
import type { ArteNaAgenda, ItemDoMes } from "./useItensDoMes";
import type { VideoProntoDaPeca } from "../../../supabase/functions/agente-calendario/modulos/roteiro-de-video";

/**
 * O miolo da peça de vídeo do Mês (24/10/2026). Dono: "quando está com vídeo, ele pode ter Por fazer e Pronto
 * também ... já aparece ali para eu ver todo o vídeo depois que o vídeo estiver pronto. Também o roteiro: eu
 * escolho vídeo, roteiro ou só o texto para eu ver, de forma bem organizadinha ... quando eu gravar o vídeo e
 * estiver pronto, já subir, já deixar tudo prontinho, já gerar legenda e já agendar para publicar."
 *
 * - No topo: o estado (A fazer / Pronto), o nome e o seletor Vídeo, Roteiro e Só o texto (ícones com title).
 * - Vídeo: o player do vídeo pronto (Ver grande abre em tela inteira); sem vídeo, Enviar ou Do Workspace (vai
 *   direto ao Workspace do cliente e a peça fica Pronta) e Gerar com IA.
 * - Roteiro: o completo (blocos com fala, visual, texto na tela e B-roll, mais a direção de gravação).
 * - Só o texto: as falas corridas, como teleprompter, com Copiar.
 * - Com vídeo pronto: Preparar para publicar (legenda da casa + post de Reels na Agenda na data da peça,
 *   aguardando aprovação; Desfazer arquiva o post criado). Nada vai para a rede sem aprovação.
 * Antes o miolo mostrava a direção genérica do estilo ("Produto elegante"), que agora fica só no "?".
 */

type Vista = "video" | "roteiro" | "texto";

const VISTAS: { id: Vista; nome: string; dica: string; Icone: typeof Film }[] = [
  { id: "video", nome: "Vídeo", dica: "Vídeo: o vídeo pronto da peça (ou subir o gravado)", Icone: Film },
  { id: "roteiro", nome: "Roteiro", dica: "Roteiro: cenas, fala, visual, texto na tela e direção de gravação", Icone: ScrollText },
  { id: "texto", nome: "Só o texto", dica: "Só o texto: a fala corrida, para ler ou copiar", Icone: AlignLeft },
];

const ORIGEM: Record<VideoDaPauta["fonte"], string> = {
  peca: "No Workspace do cliente",
  ia: "Gerado pela IA nesta pauta",
  agenda: "Já está no post da Agenda",
};

export function SeloDoEstadoDoVideo({ pronto, className = "" }: { pronto: boolean; className?: string }) {
  const Icone = pronto ? CheckCircle2 : CircleDashed;
  return (
    <span
      className={juntar("inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-[12px] font-medium", pronto ? "bg-success/15 text-success" : "bg-muted text-muted-foreground", className)}
      data-estado-do-video={pronto ? "pronto" : "a_fazer"}
      title={pronto ? "Pronto: a peça tem o vídeo final" : "A fazer: falta o vídeo final da peça"}
    >
      <Icone className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
      {ROTULO_DO_ESTADO[pronto ? "pronto" : "a_fazer"]}
    </span>
  );
}

const doArquivo = (a: ArquivoDeVideo): VideoDaPauta => ({ bucket: a.storage_bucket, caminho: a.storage_path, nome: a.nome || a.nome_original, fonte: "ia", arquivo_id: a.id, ...(a.duracao_s ? { duracao_s: a.duracao_s } : {}) });

export default function PecaDeVideoDaPauta({ item, arte, geracoes, emFoco = null, aoGerar, aoAbrirRoteiro }: {
  item: ItemDoMes;
  arte?: ArteNaAgenda | null;
  /** As gerações e versões da IA ligadas à pauta (mais nova primeiro). */
  geracoes: ArquivoDeVideo[];
  /** Geração escolhida na prancheta: aparece no Vídeo no lugar da padrão. */
  emFoco?: ArquivoDeVideo | null;
  aoGerar: () => void;
  aoAbrirRoteiro: () => void;
}) {
  const { clientId, userId, catalogo } = useMesa();
  const { profile } = useAuth();
  const { isImpersonating } = useImpersonation();
  const qc = useQueryClient();
  const chave = (parte: string) => chaveDoEstudioDaPauta(clientId, item.id, parte);
  const roteiro = useRoteiroDaPeca({ clientId, campanha: null, propostaId: null, item: itemDaPauta(item) }).roteiro;
  // Pauta sem plano do Mês: a escolha fica guardada nesta tela até o post da Agenda.
  const [semPlano, setSemPlano] = useEstadoDaTela<VideoProntoDaPeca | null>(chave("video-pronto"), null, { validar: (v) => v === null || (!!v && typeof v === "object") });
  // Até a lista reler: o que acabou de ser escolhido (null = tirado).
  const [agora, setAgora] = useState<VideoProntoDaPeca | null | undefined>(undefined);
  const guardado = agora !== undefined ? agora : item.video_pronto || semPlano;
  const situacao = situacaoDoVideo({ video_pronto: guardado }, agora === null ? null : arte, agora === null ? [] : geracoes);
  const base = emFoco ? doArquivo(emFoco) : situacao.video;
  // A geração guardada na peça (bucket mesa) leva o id do acervo para ir ao Workspace no preparo.
  const doAcervo = base && base.bucket === "mesa" && !base.arquivo_id ? geracoes.find((g) => g.storage_path === base.caminho) : undefined;
  const video: VideoDaPauta | null = base && doAcervo ? { ...base, arquivo_id: doAcervo.id } : base;
  const pronto = situacao.estado === "pronto";
  const [vista, setVista] = useEstadoDaTela<Vista>(chave("vista"), pronto || !roteiro ? "video" : "roteiro", { validar: (v) => v === "video" || v === "roteiro" || v === "texto" });
  const [preparo, setPreparo] = useState<ResultadoDoPreparo | null>(null);
  const [desfazendo, setDesfazendo] = useState(false);
  const [tirando, setTirando] = useState(false);
  const podeEditar = ["admin", "manager", "design"].indexOf(profile?.role || "") >= 0 && !isImpersonating;
  const diretor = padraoPara(catalogo, "diretor_arte");

  const reler = () => {
    void qc.invalidateQueries({ queryKey: ["mesa", "itens-do-mes", clientId] });
    void qc.invalidateQueries({ queryKey: ["mesa", "item-avulso", clientId] });
  };

  // A geração da IA que termina vira o vídeo pronto da peça (guardado no plano, sem custo), uma vez por vídeo.
  const guardouIa = useRef<string>("");
  useEffect(() => {
    const v = situacao.video;
    if (!v || v.fonte !== "ia" || item.video_pronto || agora !== undefined || guardouIa.current === v.caminho) return;
    guardouIa.current = v.caminho;
    void guardarVideoDaPauta(clientId, item.id, { bucket: v.bucket === "workspace" ? "workspace" : "mesa", caminho: v.caminho, nome: v.nome, ...(v.duracao_s ? { duracao_s: v.duracao_s } : {}), em: "" })
      .then((r) => r.guardado && reler())
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [situacao.video && situacao.video.caminho, item.video_pronto ? item.video_pronto.caminho : ""]);

  const escolher = async (v: VideoEscolhido) => {
    const noWorkspace = await levarAoWorkspace(clientId, v);
    const r = await guardarVideoDaPauta(clientId, item.id, noWorkspace);
    setAgora(noWorkspace);
    setSemPlano(r.guardado ? null : noWorkspace);
    setPreparo(null);
    setVista("video");
    reler();
    toast.success("Vídeo na peça: Pronto", { description: r.guardado ? "Está no Workspace do cliente. Agora é só preparar para publicar." : "Está no Workspace do cliente. A peça não veio do plano do Mês: a ligação vale nesta tela até ir para a Agenda." });
  };

  const tirar = async () => {
    setTirando(true);
    try {
      await guardarVideoDaPauta(clientId, item.id, null);
      setAgora(null);
      setSemPlano(null);
      setPreparo(null);
      reler();
    } catch (e) {
      toast.error("O vídeo não saiu da peça", { description: textoDoErro(e) });
    } finally {
      setTirando(false);
    }
  };

  const partes = (): ParteDaEstimativa[] => [
    { modeloId: diretor ? diretor.id : "", tipo: "texto", tokensEntrada: TAMANHOS.legenda.entrada, tokensSaida: TAMANHOS.legenda.saida } as ParteDaEstimativa,
    // A conferência da legenda e a escolha das hashtags (duas perguntas ao Jev).
    parteDaConferenciaDoJev(),
    parteDaConferenciaDoJev(),
  ];

  const preparar = async () => {
    if (!video || !userId) throw new Error("Escolha o vídeo da peça antes de preparar.");
    const l = await legendaDoVideo(clientId, item.id);
    const r = await prepararParaPublicar({ clientId, userId, item, video, legenda: legendaComHashtags(l) });
    return { ...r, custo_usd: Number(l && l.custo_usd) || 0 };
  };

  const desfazer = async () => {
    if (!preparo) return;
    setDesfazendo(true);
    try {
      await desfazerPreparo(preparo);
      setPreparo(null);
      reler();
      toast.success("Preparo desfeito", { description: "O post saiu da Agenda. O vídeo continua no Workspace e em Arquivos." });
    } catch (e) {
      toast.error("Não deu para desfazer", { description: textoDoErro(e) });
    } finally {
      setDesfazendo(false);
    }
  };

  const fala = textoCorrido(roteiro);
  const naAgenda = !!arte && !!arte.post_id && !preparo;

  return (
    <div className="flex min-w-0 shrink-0 flex-col" data-peca-de-video={item.id} data-vista={vista}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <SeloDoEstadoDoVideo pronto={pronto} />
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold" title={video ? video.nome : item.title}>
          {vista === "video" ? (video ? video.nome : "Sem vídeo ainda") : roteiro ? roteiro.titulo || item.title : item.title}
        </p>
        <div role="group" aria-label="Ver a peça" className="flex shrink-0 rounded-lg bg-muted p-1">
          {VISTAS.map(({ id, nome, dica, Icone }) => (
            <button
              key={id}
              type="button"
              aria-label={nome}
              aria-pressed={vista === id}
              title={dica}
              onClick={() => setVista(id)}
              className={juntar("flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground", vista === id ? "bg-card text-foreground shadow-sm" : "")}
            >
              <Icone className="h-4 w-4" aria-hidden="true" />
            </button>
          ))}
        </div>
          {pronto && video && (
            <div className="flex min-w-0 shrink-0 items-center gap-1" data-preparar-para-publicar={preparo ? "feito" : naAgenda ? "na-agenda" : "pronto"}>
              {preparo ? (
                <>
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                  <span className={juntar(texto.auxiliar, "max-w-[220px] truncate")} role="status" title={textoDoPreparo(preparo)}>
                    {textoDoPreparo(preparo)}
                  </span>
                  {preparo.criado && (
                    <button type="button" className={botao.icone} onClick={() => void desfazer()} disabled={desfazendo} aria-label="Desfazer" title="Desfazer: tira o post da Agenda (o vídeo continua no Workspace)">
                      {desfazendo ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Undo2 className="h-4 w-4" aria-hidden="true" />}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <AjudaRecolhida rotulo="Sobre preparar para publicar">
                    {naAgenda ? "Já tem post na Agenda: preparar de novo atualiza a legenda." : "Legenda, Agenda e aprovação num clique. Nada é publicado sem aprovação."}
                  </AjudaRecolhida>
                  <BotaoComCusto
                    rotulo={
                      <>
                        <Send className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                        Preparar para publicar
                      </>
                    }
                    titulo="Preparar para publicar"
                    descricao="Leva o vídeo para Arquivos, escreve a legenda com o roteiro como base e cria o post de Reels na Agenda no dia da peça, aguardando aprovação. Nada é publicado sem aprovação."
                    partes={partes}
                    disabled={!podeEditar || !diretor || video.fonte === "agenda"}
                    executar={preparar}
                    aoConcluir={(data) => {
                      setPreparo(data as ResultadoDoPreparo);
                      reler();
                    }}
                    className="h-8 px-3"
                  />
                </>
              )}
            </div>
          )}
      </div>

      {vista === "video" && (
        <div className="mt-3 flex min-w-0 shrink-0 flex-col" data-vista-do-video="">
          {video ? (
            <>
              {/* 26/10/2026: altura fixa; esticando (flex-1) o player vazava por cima de Preparar e das gerações. */}
              <PreviaDaPauta key={`${video.bucket}:${video.caminho}`} caminho={video.caminho} bucket={video.bucket} nome={video.nome} video compacta />
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                <span className={juntar(texto.auxiliar, "min-w-0 flex-1 truncate")}>
                  {ORIGEM[video.fonte]}
                  {video.duracao_s ? ` · ${Math.round(video.duracao_s)} s` : ""}
                </span>
                <TrazerVideo clientId={clientId} rotulo="Trocar o vídeo da peça" aoEscolher={escolher} />
                {!emFoco && situacao.video && situacao.video.fonte === "peca" && situacao.video.bucket === "workspace" && (
                  <button type="button" className={botao.icone} onClick={() => void tirar()} disabled={tirando} aria-label="Tirar o vídeo da peça" title="Tirar o vídeo da peça (o arquivo continua no Workspace)">
                    {tirando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <X className="h-4 w-4" aria-hidden="true" />}
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="flex min-h-[320px] flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border p-6 text-center" data-sem-video="">
              <Video className="mb-2 h-7 w-7 text-primary" aria-hidden="true" />
              <p className={juntar(texto.corpo, "font-medium")}>Gravou? Suba o vídeo aqui</p>
              <p className={juntar(texto.auxiliar, "mt-1")}>Vai direto para o Workspace do cliente e a peça fica Pronta.</p>
              <div className="mt-3 flex min-w-0 flex-wrap items-center justify-center gap-1">
                <TrazerVideo clientId={clientId} rotulo="Vídeo gravado da peça" aoEscolher={escolher} />
                <button type="button" className={juntar(botao.barra, "border border-border")} onClick={aoGerar} title="Gerar o vídeo com IA (ferramentas ao lado)">
                  <Sparkles className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  Gerar com IA
                </button>
              </div>
              {!roteiro && (
                <button type="button" className="mt-3 text-[12px] text-primary hover:underline" onClick={aoAbrirRoteiro}>
                  Criar o roteiro para gravar
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {vista === "roteiro" && (
        <div className="mt-3 min-w-0 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain" data-vista-do-roteiro="">
          {roteiro ? (
            <div className="mx-auto w-full min-w-0 max-w-3xl space-y-5">
              <TextoDoRoteiro roteiro={roteiro} />
              <DirecaoParaGravar roteiro={roteiro} />
            </div>
          ) : (
            <SemRoteiro aoAbrirRoteiro={aoAbrirRoteiro} />
          )}
        </div>
      )}

      {vista === "texto" && (
        <div className="mt-3 min-w-0 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain" data-vista-do-texto="">
          {fala ? (
            <div className="mx-auto w-full min-w-0 max-w-2xl">
              <div className="flex justify-end">
                <button
                  type="button"
                  className={botao.icone}
                  aria-label="Copiar o texto"
                  title="Copiar o texto"
                  onClick={() => {
                    try {
                      void navigator.clipboard.writeText(fala).then(() => toast.success("Texto copiado"), () => toast.error("Não deu para copiar"));
                    } catch {
                      toast.error("Não deu para copiar");
                    }
                  }}
                >
                  <Copy className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <div className="whitespace-pre-line text-[15px] leading-7 text-foreground sm:text-[20px] sm:leading-9 [overflow-wrap:anywhere]" data-texto-corrido="">
                {fala}
              </div>
            </div>
          ) : (
            <SemRoteiro aoAbrirRoteiro={aoAbrirRoteiro} />
          )}
        </div>
      )}

    </div>
  );
}

function SemRoteiro({ aoAbrirRoteiro }: { aoAbrirRoteiro: () => void }) {
  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center p-6 text-center" data-sem-roteiro="">
      <ScrollText className="mb-2 h-6 w-6 text-muted-foreground" aria-hidden="true" />
      <p className={juntar(texto.corpo, "font-medium")}>Sem roteiro ainda</p>
      <button type="button" className={juntar(botao.primario, "mt-3 h-8 px-3 text-[12px]")} onClick={aoAbrirRoteiro}>
        Criar com o agente
      </button>
    </div>
  );
}
