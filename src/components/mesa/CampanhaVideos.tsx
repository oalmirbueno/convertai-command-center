import { lazy, Suspense, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Camera, Clapperboard, ExternalLink, Loader2, Pencil, Plus, Sparkles, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { textoDoErro } from "@/lib/mesa/api";
import { botao, juntar, SeletorCompacto, texto } from "@/components/sistema";
import { gravarEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { AvisoDeErro } from "./Custo";
import { useMesa } from "./MesaContexto";
import { chaves, editarItemDaProposta, lerProposta, type Campanha, type ItemProposto } from "./mesaV4Api";
import { aplicarRespostaDaCampanha, normalizarBriefing, pecaDeVideoDaCampanha } from "./campanhasApi";
import { TrazerVideo, VideoPronto, type VideoEscolhido } from "./VideoProntoDaPeca";
import { linhaDaCampanha } from "./CampanhaLinhaDoTempo";
import { porFase } from "./areasDaCampanha";
import { usePedidos } from "@/components/mesa-videos/videosApi";
import { ROTULO_DO_ESTADO_DO_PEDIDO } from "../../../supabase/functions/mesa-videos/modulos/pedidos-de-video";
import { direcaoDoRoteiro, normalizarRoteiroDeVideo, normalizarVideoPronto, type RoteiroDeVideo } from "../../../supabase/functions/agente-calendario/modulos/roteiro-de-video";
import { rotuloDaDuracao } from "../../../supabase/functions/mesa-roteiros/modulos/roteiro-da-peca";
import RoteiroDaPecaDeVideo from "./RoteiroDaPecaDeVideo";
import { useRoteiroDaPeca } from "./roteiroDaPeca";

/**
 * Vídeos e Reels da campanha (22/10/2026, dono: "roteiros de vídeos ali mesmo, tudo de forma intuitiva e
 * fácil, sem sair da tela"). Agente unificado (23/10, dono: "pode juntar os dois em um só"): cada peça de
 * vídeo tem UM roteiro, sempre à vista, com o agente de roteiro ao lado (RoteiroDaPecaDeVideo: criar com
 * ideia, duração, estilo e criatividade, 2 versões e o Jev, conversa que muda o roteiro com Confirmar e
 * Desfazer, versões e o modelo do escopo roteiro). O seletor só escolhe o caminho: Gravar (PDF, Word e a
 * direção de gravação) ou Gerar (as cenas de IA saem do roteiro, narração, trilha e montagem). "Abrir no
 * estúdio de vídeo": na agenda, o Estúdio da pauta; fora dela, a Mesa Vídeos com o roteiro preenchido.
 * Sem depender do agente (23/10, 55a112b8): "Novo vídeo" (enviar, Workspace, só a peça ou o roteiro com o
 * agente, que abre o agente unificado na peça nova), editar nome e data, apagar com confirmação e o vídeo
 * pronto da peça, tudo pela ação campanha_peca_de_video, sem custo.
 */

// 22/10 (dono: "no vídeo, gerar ou gravar"): os dois caminhos da peça, carregados só quando abertos.
const GravarVideoDaCampanha = lazy(() => import("./GravarVideoDaCampanha"));
const GerarVideoDaCampanha = lazy(() => import("./GerarVideoDaCampanha"));
type CaminhoDoVideo = "gravar" | "gerar";
const CAMINHOS_DO_VIDEO = [
  { valor: "gravar", rotulo: "Gravar", icone: <Camera className="h-3.5 w-3.5" aria-hidden="true" /> },
  { valor: "gerar", rotulo: "Gerar", icone: <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> },
];

/** O rascunho do gerador livre da Mesa Vídeos, preenchido pelo roteiro (o mesmo formato do GeradorLivre). */
export function rascunhoDaMesaDeVideos(item: ItemProposto, r: RoteiroDeVideo | null) {
  const dir = r ? direcaoDoRoteiro(r) : { prompt: item.video ? item.video.prompt : item.tema, narracao: item.video ? item.video.narracao : "" };
  return {
    nivel: "normal", motor: "", prompt: `${dir.prompt}
Peça: ${item.tema}`.slice(0, 3000), negativo: "",
    duracao: r && r.duracao > 7 ? 10 : 5, formato: "9:16", resolucao: "", audio: !!dir.narracao, variacoes: 1,
    inicial: null, final: null, referencias: item.video ? item.video.referencias : [], camera: "", narracao: dir.narracao,
  };
}

function PecaDeVideo({ campanha, propostaId, item, onAbrirNoEstudio }: { campanha: Campanha; propostaId: string; item: ItemProposto; onAbrirNoEstudio?: (taskId: string, mes: string) => void }) {
  const { clientId } = useMesa();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const estado = useRoteiroDaPeca({ clientId, campanha, propostaId, item });
  // As cenas de IA do caminho Gerar (saem do roteiro e moram no item).
  const cenas = normalizarRoteiroDeVideo((item as ItemProposto & { roteiro_video?: unknown }).roteiro_video);
  const [caminho, setCaminho] = useState<CaminhoDoVideo>("gravar");
  const pedidos = usePedidos(clientId);
  const doVideo = item.task_id ? ((pedidos.data && pedidos.data.itens) || []).filter((p) => p.parametros && p.parametros.task_id === item.task_id) : [];
  const abrir = () => {
    if (item.task_id && onAbrirNoEstudio) {
      onAbrirNoEstudio(item.task_id, String(item.data || "").slice(0, 7));
      return;
    }
    // O estado da tela é guardado por rota: o rascunho vai para a da Mesa Vídeos.
    gravarEstadoDaTela(`mesa-videos:livre:${clientId}`, rascunhoDaMesaDeVideos(item, cenas), "/mesa-videos");
    navigate(`/mesa-videos?client=${clientId}&etapa=gerar&modo=livre`);
  };
  const r = estado.roteiro;
  // 23/10/2026: editar e apagar a peça e o vídeo pronto, sem sair da campanha (sem custo).
  const pronto = normalizarVideoPronto((item as ItemProposto & { video_pronto?: unknown }).video_pronto);
  const [editandoPeca, setEditandoPeca] = useState(false);
  const [temaNovo, setTemaNovo] = useState(item.tema || "");
  const [dataNova, setDataNova] = useState(String(item.data || ""));
  const [apagando, setApagando] = useState<"pergunta" | "rodando" | null>(null);
  const aplicar = (res: { proposta?: unknown }) => {
    aplicarRespostaDaCampanha(qc, clientId, res);
    if (res && res.proposta) qc.setQueryData(chaves.proposta(propostaId), res.proposta);
  };
  const salvarPeca = async () => {
    try {
      const data = await editarItemDaProposta(propostaId, item.tema_id || "", { tema: temaNovo.trim(), ...(dataNova && dataNova !== item.data ? { data: dataNova } : {}) });
      aplicar(data || {});
      setEditandoPeca(false);
      const avisos = (data && Array.isArray(data.avisos) ? data.avisos : []) as string[];
      toast.success("Peça atualizada", avisos.length ? { description: avisos.join(" ") } : undefined);
    } catch (e) {
      toast.error("Peça não atualizada", { description: textoDoErro(e) });
    }
  };
  const apagar = async () => {
    if (apagando !== "pergunta") {
      setApagando("pergunta");
      return;
    }
    setApagando("rodando");
    try {
      aplicar(await pecaDeVideoDaCampanha({ campanhaId: campanha.id, operacao: "tirar", temaId: item.tema_id || "" }));
      toast.success("Peça apagada da campanha");
    } catch (e) {
      toast.error("Peça não apagada", { description: textoDoErro(e) });
      setApagando(null);
    }
  };
  const anexar = async (v: VideoEscolhido | null) => {
    aplicar(await pecaDeVideoDaCampanha({ campanhaId: campanha.id, operacao: "anexar", temaId: item.tema_id || "", video: v as Record<string, unknown> | null }));
    toast.success(v ? "Vídeo na peça" : "Vídeo tirado da peça");
  };
  return (
    <li className="min-w-0 border-t border-border pt-3 first:border-t-0 first:pt-0" data-video-da-campanha={item.tema_id} data-estado-do-roteiro={r ? "pronto" : "falta"}>
      <div className="flex min-w-0 items-center">
        <Clapperboard className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{item.tema || "Vídeo"}</span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {String(item.data || "").slice(8, 10)}/{String(item.data || "").slice(5, 7)} · {item.task_id ? "na agenda" : "fora da agenda"}
            {pronto ? " · vídeo pronto" : ""}
            {r ? ` · ${rotuloDaDuracao(r.duracao_alvo_s)}` : ""}
            {doVideo.length ? ` · vídeo: ${ROTULO_DO_ESTADO_DO_PEDIDO[doVideo[0].estado] || doVideo[0].estado}` : ""}
          </span>
        </span>
        <button type="button" className={botao.icone} onClick={() => setEditandoPeca(!editandoPeca)} aria-expanded={editandoPeca} aria-label={`Editar a peça ${item.tema || "de vídeo"}`} title="Editar nome e data">
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </button>
        {apagando === "pergunta" ? (
          <button type="button" className={juntar(botao.barra, "text-destructive hover:text-destructive")} onClick={() => void apagar()} onBlur={() => setApagando(null)} aria-label={`Confirmar: apagar a peça ${item.tema || "de vídeo"}`}>
            Apagar?
          </button>
        ) : (
          <button type="button" className={botao.icone} onClick={() => void apagar()} disabled={apagando === "rodando"} aria-label={`Apagar a peça ${item.tema || "de vídeo"}`} title={item.task_id ? "Na agenda: apague pela Agenda" : "Apagar a peça da campanha"}>
            {apagando === "rodando" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
          </button>
        )}
        <button type="button" className={juntar(botao.icone, "text-primary hover:text-primary")} onClick={abrir} aria-label={`Abrir ${item.tema || "o vídeo"} no estúdio de vídeo`} title={item.task_id ? "Abrir no Estúdio da pauta (gera o vídeo e volta)" : "Abrir na Mesa Vídeos com o roteiro preenchido"}>
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {editandoPeca && (
        <div className="mt-2 flex min-w-0 flex-wrap items-end gap-2" data-editar-peca={item.tema_id}>
          <label className="block min-w-0 flex-1 text-[11px] font-medium text-muted-foreground">
            Nome
            <Input value={temaNovo} onChange={(e) => setTemaNovo(e.target.value)} className="mt-1 h-8 text-[13px]" aria-label={`Nome da peça ${item.tema || ""}`.trim()} />
          </label>
          <label className="block text-[11px] font-medium text-muted-foreground">
            Data
            <Input type="date" value={dataNova} onChange={(e) => setDataNova(e.target.value)} className="mt-1 h-8 w-40 text-[13px]" aria-label={`Data da peça ${item.tema || ""}`.trim()} />
          </label>
          <button type="button" className={juntar(botao.secundario, "h-8 px-3 text-[12px]")} onClick={() => void salvarPeca()} disabled={!temaNovo.trim()}>
            Salvar
          </button>
        </div>
      )}
      <div className="mt-2 min-w-0" data-video-pronto-da-peca={item.tema_id}>
        {pronto ? (
          <VideoPronto clientId={clientId} video={pronto} aoTrocar={(v) => anexar(v)} aoTirar={() => anexar(null)} />
        ) : (
          <TrazerVideo clientId={clientId} rotulo={`Vídeo pronto de ${item.tema || "a peça"}`} aoEscolher={(v) => anexar(v)} />
        )}
      </div>
      <RoteiroDaPecaDeVideo campanha={campanha} propostaId={propostaId} item={item} estado={estado} />
      <SeletorCompacto
        opcoes={CAMINHOS_DO_VIDEO}
        valor={caminho}
        onEscolher={(v) => setCaminho(v as CaminhoDoVideo)}
        rotulo={`Caminho do vídeo ${item.tema || ""}`.trim()}
        modo="segmentado"
        className="mt-4"
      />
      <div className="mt-3 min-w-0" data-caminho-do-video={caminho}>
        <Suspense fallback={<p className={texto.auxiliar}><Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" aria-hidden="true" />Abrindo…</p>}>
          {caminho === "gravar"
            ? <GravarVideoDaCampanha clientId={clientId} item={item} linha={estado.linha} roteiro={r} />
            : <GerarVideoDaCampanha clientId={clientId} campanha={campanha} propostaId={propostaId} item={item} roteiroId={estado.linha ? estado.linha.id : null} />}
        </Suspense>
      </div>
    </li>
  );
}

/**
 * Nova peça de vídeo na série: nome, data e o vídeo (enviado ou do Workspace), só a peça, ou o roteiro com o
 * agente. Sem custo. "Roteiro com o agente" cria a peça e abre nela o agente de roteiro unificado (o criar com
 * ideia, duração, estilo e criatividade); não existe outro agente de roteiro.
 */
function NovoVideo({ campanha, propostaId, aoCriar }: { campanha: Campanha; propostaId: string; aoCriar: (temaId: string | null) => void }) {
  const { clientId } = useMesa();
  const qc = useQueryClient();
  const [tema, setTema] = useState("");
  const [data, setData] = useState("");
  const [criando, setCriando] = useState<"video" | "peca" | "agente" | null>(null);
  const criar = async (video: VideoEscolhido | null, jeito: "video" | "peca" | "agente") => {
    setCriando(jeito);
    try {
      const res = await pecaDeVideoDaCampanha({ campanhaId: campanha.id, operacao: "criar", tema: tema.trim(), data, video: video as Record<string, unknown> | null });
      aplicarRespostaDaCampanha(qc, clientId, res);
      if (res && res.proposta) qc.setQueryData(chaves.proposta(propostaId), res.proposta);
      setTema("");
      toast.success("Vídeo na campanha", {
        description: video ? "A peça entrou na série com o vídeo." : jeito === "agente" ? "A peça entrou na série: dê a ideia ao agente de roteiro nela." : "A peça entrou na série; ponha o vídeo ou o roteiro nela.",
      });
      aoCriar(res && res.tema_id ? String(res.tema_id) : null);
    } catch (e) {
      toast.error("Peça não criada", { description: textoDoErro(e) });
    } finally {
      setCriando(null);
    }
  };
  return (
    <section className="min-w-0 space-y-2" aria-label="Novo vídeo na campanha" data-novo-video="">
      <div className="flex min-w-0 flex-wrap items-end gap-2">
        <label className="block min-w-0 flex-1 text-[11px] font-medium text-muted-foreground">
          Nome do vídeo
          <Input value={tema} onChange={(e) => setTema(e.target.value)} placeholder="Ex.: Reels do PC assombrado" className="mt-1 h-8 text-[13px]" aria-label="Nome do vídeo novo" />
        </label>
        <label className="block text-[11px] font-medium text-muted-foreground">
          Data
          <Input type="date" value={data} min={campanha.periodo_inicio || undefined} max={campanha.periodo_fim || undefined} onChange={(e) => setData(e.target.value)} className="mt-1 h-8 w-40 text-[13px]" aria-label="Data do vídeo novo" />
        </label>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <TrazerVideo clientId={clientId} rotulo="Vídeo novo" disabled={criando !== null} aoEscolher={(v) => criar(v, "video")} />
        <button type="button" className={juntar(botao.barra, "border border-border")} onClick={() => void criar(null, "agente")} disabled={criando !== null} title="Cria a peça e abre nela o agente de roteiro (ideia, duração, estilo e criatividade)">
          {criando === "agente" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Wand2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
          Roteiro com o agente
        </button>
        <button type="button" className={botao.barra} onClick={() => void criar(null, "peca")} disabled={criando !== null}>
          {criando === "peca" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
          Só a peça
        </button>
      </div>
    </section>
  );
}

export default function CampanhaVideos({ campanha, onAbrirNoEstudio }: { campanha: Campanha; onAbrirNoEstudio?: (taskId: string, mes: string) => void }) {
  const proposta = useQuery({
    queryKey: chaves.proposta(campanha.proposta_id || ""),
    enabled: !!campanha.proposta_id,
    queryFn: () => lerProposta(campanha.proposta_id as string),
    // Volta do estúdio de vídeo: relê a série (e o estado do vídeo) ao montar.
    refetchOnMount: "always",
  });
  const [novoAberto, setNovoAberto] = useState(false);
  // A peça recém-criada pelo "Roteiro com o agente": a tela leva até ela (o agente unificado está lá).
  const [irPara, setIrPara] = useState<string | null>(null);
  useEffect(() => {
    if (!irPara || typeof document === "undefined") return;
    const alvo = document.querySelector(`[data-video-da-campanha="${irPara}"]`);
    if (alvo && typeof (alvo as HTMLElement).scrollIntoView === "function") (alvo as HTMLElement).scrollIntoView({ block: "start" });
  });
  const linha = linhaDaCampanha(campanha);
  const b = normalizarBriefing(campanha.briefing) as ReturnType<typeof normalizarBriefing> & { trilha?: { titulo?: string } };
  const trilha = b.trilha && b.trilha.titulo ? String(b.trilha.titulo) : "";
  if (!campanha.proposta_id) return <p className={texto.auxiliar}>A campanha ainda não tem a série de conteúdos.</p>;
  if (proposta.isError) return <AvisoDeErro erro={proposta.error} />;
  const videos = ((proposta.data && proposta.data.itens) || []).filter((i) => i.formato === "video");
  if (proposta.isLoading) {
    return (
      <p className={texto.auxiliar}>
        <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        Lendo os vídeos da campanha…
      </p>
    );
  }
  const grupos = linha ? porFase(linha.fases, videos) : [{ fase: null, itens: videos }];
  // 23/10/2026 (dono: "tem que aparecer já ali no Vídeos e Reels ... não precisa ter vídeo, eu consigo adicionar
  // vídeo por ali mesmo"): nova peça com o vídeo enviado ou do Workspace, só a peça, ou o roteiro com o agente.
  const novoVideo = (
    <NovoVideo
      campanha={campanha}
      propostaId={campanha.proposta_id as string}
      aoCriar={(temaId) => {
        setNovoAberto(false);
        setIrPara(temaId);
      }}
    />
  );
  if (!videos.length) {
    return (
      <div className="min-w-0 space-y-3" data-videos-da-campanha="0">
        <p className={texto.auxiliar}>Sem peça de vídeo ainda: envie um vídeo ou crie o roteiro com o agente.</p>
        {novoVideo}
      </div>
    );
  }
  return (
    <div className="min-w-0 space-y-5" data-videos-da-campanha={String(videos.length)}>
      <div className="min-w-0">
        <button type="button" className={juntar(botao.barra, "border border-border")} onClick={() => setNovoAberto(!novoAberto)} aria-expanded={novoAberto}>
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Novo vídeo
        </button>
        {novoAberto && <div className="mt-2 min-w-0">{novoVideo}</div>}
      </div>
      <p className={texto.auxiliar}>{trilha ? `Trilha da campanha: ${trilha}` : "Sem trilha escolhida: a aba Trilha e efeitos sugere uma."}</p>
      {grupos.filter((g) => g.itens.length).map((g, k) => (
        <section key={g.fase ? g.fase.fase : k} className="min-w-0" aria-label={g.fase ? `Vídeos: ${g.fase.nome}` : "Vídeos"} data-fase-dos-videos={g.fase ? g.fase.fase : ""}>
          {g.fase && <h3 className={juntar(texto.rotulo, "mb-2")}>{g.fase.nome}</h3>}
          <ul className="min-w-0 space-y-3">
            {g.itens.map((i) => (
              <PecaDeVideo key={i.tema_id} campanha={campanha} propostaId={campanha.proposta_id as string} item={i} onAbrirNoEstudio={onAbrirNoEstudio} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
