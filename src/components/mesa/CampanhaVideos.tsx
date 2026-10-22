import { lazy, Suspense, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Camera, Check, Clapperboard, ExternalLink, FileText, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { textoDoErro } from "@/lib/mesa/api";
import { AjudaRecolhida, botao, juntar, SeletorCompacto, texto } from "@/components/sistema";
import { gravarEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { AvisoDeErro, BotaoComCusto } from "./Custo";
import { useMesa } from "./MesaContexto";
import { chaves, editarItemDaProposta, lerProposta, type Campanha, type ItemProposto } from "./mesaV4Api";
import { aplicarRespostaDaCampanha, normalizarBriefing } from "./campanhasApi";
import { linhaDaCampanha } from "./CampanhaLinhaDoTempo";
import { porFase } from "./areasDaCampanha";
import { gerarRoteiroDeVideo, partesDoRoteiroDeVideo } from "./passosDaCampanha";
import { usePedidos } from "@/components/mesa-videos/videosApi";
import { ROTULO_DO_ESTADO_DO_PEDIDO } from "../../../supabase/functions/mesa-videos/modulos/pedidos-de-video";
import { direcaoDoRoteiro, faltasDoRoteiro, normalizarRoteiroDeVideo, type CenaDoRoteiro, type RoteiroDeVideo } from "../../../supabase/functions/agente-calendario/modulos/roteiro-de-video";

/**
 * Vídeos e Reels da campanha (22/10/2026, dono: "roteiros de vídeos ali mesmo, tudo de forma intuitiva e
 * fácil, sem sair da tela"): os roteiros das peças de vídeo por fase, editáveis ali (gancho, cenas, falas,
 * texto na tela, duração e a trilha da campanha), "Gerar o roteiro" quando falta (custo antes) e "Abrir no
 * estúdio de vídeo" (na agenda: o Estúdio da pauta; fora dela: a Mesa Vídeos com o roteiro preenchido). Ao
 * voltar, o estado do vídeo é relido.
 */

const cenaVazia = (ordem: number): CenaDoRoteiro => ({ ordem, descricao: "", fala: "", texto_na_tela: "", segundos: 4 });

// 22/10 (dono: "no vídeo, gerar ou gravar"): os dois caminhos da peça, carregados só quando abertos.
// Gravar: o roteiro completo pelo motor de roteiros, com PDF e Word para baixar.
// Gerar: cenas pela Mesa Vídeos, narração e trilha ElevenLabs, montagem e render.
const GravarVideoDaCampanha = lazy(() => import("./GravarVideoDaCampanha"));
const GerarVideoDaCampanha = lazy(() => import("./GerarVideoDaCampanha"));
type CaminhoDoVideo = "roteiro" | "gravar" | "gerar";
const CAMINHOS_DO_VIDEO = [
  { valor: "roteiro", rotulo: "Roteiro", icone: <FileText className="h-3.5 w-3.5" aria-hidden="true" /> },
  { valor: "gravar", rotulo: "Gravar", icone: <Camera className="h-3.5 w-3.5" aria-hidden="true" /> },
  { valor: "gerar", rotulo: "Gerar", icone: <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> },
];

/** O rascunho do gerador livre da Mesa Vídeos, preenchido pelo roteiro (o mesmo formato do GeradorLivre). */
export function rascunhoDaMesaDeVideos(item: ItemProposto, r: RoteiroDeVideo | null) {
  const dir = r ? direcaoDoRoteiro(r) : { prompt: item.video ? item.video.prompt : item.tema, narracao: item.video ? item.video.narracao : "" };
  return {
    nivel: "normal", motor: "", prompt: `${dir.prompt}\nPeça: ${item.tema}`.slice(0, 3000), negativo: "",
    duracao: r && r.duracao > 7 ? 10 : 5, formato: "9:16", resolucao: "", audio: !!dir.narracao, variacoes: 1,
    inicial: null, final: null, referencias: item.video ? item.video.referencias : [], camera: "", narracao: dir.narracao,
  };
}

function RoteiroDaPeca({ campanha, propostaId, item, trilhaDaCampanha, onAbrirNoEstudio }: { campanha: Campanha; propostaId: string; item: ItemProposto; trilhaDaCampanha: string; onAbrirNoEstudio?: (taskId: string, mes: string) => void }) {
  const { clientId, catalogo } = useMesa();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const salvo = normalizarRoteiroDeVideo((item as ItemProposto & { roteiro_video?: unknown }).roteiro_video);
  const [r, setR] = useState<RoteiroDeVideo | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [caminho, setCaminho] = useState<CaminhoDoVideo>("roteiro");
  const pedidos = usePedidos(clientId);
  const doVideo = item.task_id ? ((pedidos.data && pedidos.data.itens) || []).filter((p) => p.parametros && p.parametros.task_id === item.task_id) : [];
  const editando = r !== null;
  const roteiro = r || salvo;
  const mudar = (m: Partial<RoteiroDeVideo>) => setR((x) => ({ ...((x || salvo || { gancho: "", cenas: [cenaVazia(1)], duracao: 4, trilha: trilhaDaCampanha, cta: item.cta || "" }) as RoteiroDeVideo), ...m }));
  const mudarCena = (k: number, m: Partial<CenaDoRoteiro>) => mudar({ cenas: (roteiro ? roteiro.cenas : []).map((c, i) => (i === k ? { ...c, ...m } : c)) });
  const salvar = async () => {
    if (!r) return;
    setSalvando(true);
    try {
      const data = await editarItemDaProposta(propostaId, item.tema_id || "", { roteiro_video: r });
      if (data && data.proposta) qc.setQueryData(chaves.proposta(propostaId), data.proposta);
      else void qc.invalidateQueries({ queryKey: chaves.proposta(propostaId) });
      setR(null);
      toast.success("Roteiro salvo", { description: "A direção do vídeo acompanhou o roteiro." });
    } catch (e) {
      toast.error("Roteiro não salvo", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };
  const abrir = () => {
    if (item.task_id && onAbrirNoEstudio) {
      onAbrirNoEstudio(item.task_id, String(item.data || "").slice(0, 7));
      return;
    }
    // O estado da tela é guardado por rota: o rascunho vai para a da Mesa Vídeos.
    gravarEstadoDaTela(`mesa-videos:livre:${clientId}`, rascunhoDaMesaDeVideos(item, roteiro), "/mesa-videos");
    navigate(`/mesa-videos?client=${clientId}&etapa=gerar&modo=livre`);
  };
  const faltas = faltasDoRoteiro(roteiro);
  const total = roteiro ? roteiro.cenas.reduce((s, c) => s + (Number(c.segundos) || 0), 0) : 0;
  return (
    <li className="min-w-0 border-t border-border pt-3 first:border-t-0 first:pt-0" data-video-da-campanha={item.tema_id} data-estado-do-roteiro={salvo ? "pronto" : "falta"}>
      <div className="flex min-w-0 items-center">
        <Clapperboard className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{item.tema || "Vídeo"}</span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {String(item.data || "").slice(8, 10)}/{String(item.data || "").slice(5, 7)} · {item.task_id ? "na agenda" : "fora da agenda"}
            {roteiro ? ` · ${total}s` : ""}
            {doVideo.length ? ` · vídeo: ${ROTULO_DO_ESTADO_DO_PEDIDO[doVideo[0].estado] || doVideo[0].estado}` : ""}
          </span>
        </span>
        {!salvo && !editando && (
          <BotaoComCusto
            rotulo="Gerar o roteiro"
            titulo="Roteiro do vídeo"
            descricao="Escreve o roteiro deste Reels (gancho, cenas, falas, texto na tela e CTA) pela fase da campanha"
            partes={() => partesDoRoteiroDeVideo(catalogo)}
            executar={async () => {
              const res = await gerarRoteiroDeVideo(campanha.id, item.tema_id || "");
              aplicarRespostaDaCampanha(qc, clientId, res);
              if (res && res.proposta) qc.setQueryData(chaves.proposta(propostaId), res.proposta);
              return res;
            }}
            variant="ghost"
            className="h-8 px-2"
          />
        )}
        <button type="button" className={juntar(botao.icone, "text-primary hover:text-primary")} onClick={abrir} aria-label={`Abrir ${item.tema || "o vídeo"} no estúdio de vídeo`} title={item.task_id ? "Abrir no Estúdio da pauta (gera o vídeo e volta)" : "Abrir na Mesa Vídeos com o roteiro preenchido"}>
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {roteiro && (
        <div className="mt-2 min-w-0 space-y-2">
          <label className="block text-[11px] font-medium text-muted-foreground">
            Gancho
            <Input value={roteiro.gancho} onChange={(e) => mudar({ gancho: e.target.value })} className="mt-1 h-8 text-[13px]" aria-label={`Gancho de ${item.tema}`} />
          </label>
          <ol className="space-y-2" aria-label={`Cenas de ${item.tema}`}>
            {roteiro.cenas.map((c, k) => (
              <li key={k} className="min-w-0 rounded-md bg-muted/50 p-2" data-cena={k + 1}>
                <div className="flex min-w-0 items-center">
                  <span className="mr-2 text-[11px] font-medium text-muted-foreground">Cena {k + 1}</span>
                  <Input type="number" min={1} max={20} value={c.segundos} onChange={(e) => mudarCena(k, { segundos: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })} className="h-7 w-16 text-[12px]" aria-label={`Segundos da cena ${k + 1}`} />
                  <span className="ml-1 text-[11px] text-muted-foreground">s</span>
                  <button type="button" className={juntar(botao.icone, "ml-auto h-7 w-7")} onClick={() => mudar({ cenas: roteiro.cenas.filter((_x, i) => i !== k) })} disabled={roteiro.cenas.length <= 1} aria-label={`Tirar a cena ${k + 1}`} title={`Tirar a cena ${k + 1}`}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
                <Textarea value={c.descricao} onChange={(e) => mudarCena(k, { descricao: e.target.value })} rows={2} placeholder="O que aparece" className="mt-1 text-[12px]" aria-label={`O que aparece na cena ${k + 1}`} />
                <div className="mt-1 grid min-w-0 grid-cols-1 gap-1 sm:grid-cols-2">
                  <Input value={c.fala} onChange={(e) => mudarCena(k, { fala: e.target.value })} placeholder="Fala" className="h-8 text-[12px]" aria-label={`Fala da cena ${k + 1}`} />
                  <Input value={c.texto_na_tela} onChange={(e) => mudarCena(k, { texto_na_tela: e.target.value })} placeholder="Texto na tela" className="h-8 text-[12px]" aria-label={`Texto na tela da cena ${k + 1}`} />
                </div>
              </li>
            ))}
          </ol>
          <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="block text-[11px] font-medium text-muted-foreground">
              CTA
              <Input value={roteiro.cta} onChange={(e) => mudar({ cta: e.target.value })} className="mt-1 h-8 text-[13px]" aria-label={`CTA de ${item.tema}`} />
            </label>
            <label className="block text-[11px] font-medium text-muted-foreground">
              Trilha
              <Input value={roteiro.trilha || trilhaDaCampanha} onChange={(e) => mudar({ trilha: e.target.value })} placeholder="Escolha em Trilha e efeitos" className="mt-1 h-8 text-[13px]" aria-label={`Trilha de ${item.tema}`} />
            </label>
          </div>
          <div className="flex min-w-0 items-center">
            <button type="button" className={juntar(botao.icone, "mr-auto")} onClick={() => mudar({ cenas: roteiro.cenas.concat([cenaVazia(roteiro.cenas.length + 1)]).slice(0, 8) })} disabled={roteiro.cenas.length >= 8} aria-label="Acrescentar cena" title="Acrescentar cena">
              <Plus className="h-4 w-4" aria-hidden="true" />
            </button>
            {faltas.length > 0 && <span className="mr-2 text-[11px] text-warning">Falta: {faltas.join(", ")}</span>}
            {editando && (
              <>
                <button type="button" className="mr-2 text-[12px] text-muted-foreground hover:underline" onClick={() => setR(null)} disabled={salvando}>Desfazer</button>
                <button type="button" className={juntar(botao.icone, "text-primary hover:text-primary")} onClick={() => void salvar()} disabled={salvando} aria-label="Salvar o roteiro" title="Salvar o roteiro (sem custo)">
                  {salvando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {/* 22/10: só o estado na tela; o como fazer vai para o "?" (docs/design/SISTEMA.md, seção 5). */}
      {!roteiro && caminho === "roteiro" && (
        <p className={juntar(texto.auxiliar, "mt-1 flex items-center")}>
          Sem roteiro ainda.
          <AjudaRecolhida className="ml-1" rotulo="Como ter o roteiro">Gere pelo agente da campanha ou pelo botão, ou escolha Gravar ou Gerar.</AjudaRecolhida>
        </p>
      )}
      <SeletorCompacto
        opcoes={CAMINHOS_DO_VIDEO}
        valor={caminho}
        onEscolher={(v) => setCaminho(v as CaminhoDoVideo)}
        rotulo={`Caminho do vídeo ${item.tema || ""}`.trim()}
        modo="segmentado"
        className="mt-3"
      />
      {caminho !== "roteiro" && (
        <div className="mt-3 min-w-0" data-caminho-do-video={caminho}>
          <Suspense fallback={<p className={texto.auxiliar}><Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" aria-hidden="true" />Abrindo…</p>}>
            {caminho === "gravar"
              ? <GravarVideoDaCampanha clientId={clientId} campanha={campanha} propostaId={propostaId} item={item} />
              : <GerarVideoDaCampanha clientId={clientId} campanha={campanha} propostaId={propostaId} item={item} />}
          </Suspense>
        </div>
      )}
    </li>
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
  if (!videos.length) return <p className={texto.auxiliar} data-videos-da-campanha="0" title='Peça ao agente: "acrescente um Reels na fase de lançamento".'>Sem peça de vídeo: peça um Reels ao agente.</p>;
  const grupos = linha ? porFase(linha.fases, videos) : [{ fase: null, itens: videos }];
  return (
    <div className="min-w-0 space-y-5" data-videos-da-campanha={String(videos.length)}>
      <p className={texto.auxiliar}>{trilha ? `Trilha da campanha: ${trilha}` : "Sem trilha escolhida: a aba Trilha e efeitos sugere uma."}</p>
      {grupos.filter((g) => g.itens.length).map((g, k) => (
        <section key={g.fase ? g.fase.fase : k} className="min-w-0" aria-label={g.fase ? `Vídeos: ${g.fase.nome}` : "Vídeos"} data-fase-dos-videos={g.fase ? g.fase.fase : ""}>
          {g.fase && <h3 className={juntar(texto.rotulo, "mb-2")}>{g.fase.nome}</h3>}
          <ul className="min-w-0 space-y-3">
            {g.itens.map((i) => (
              <RoteiroDaPeca key={i.tema_id} campanha={campanha} propostaId={campanha.proposta_id as string} item={i} trilhaDaCampanha={trilha} onAbrirNoEstudio={onAbrirNoEstudio} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
