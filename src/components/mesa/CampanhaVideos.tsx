import { lazy, Suspense, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Camera, Check, Clapperboard, ExternalLink, FileDown, FileText, Loader2, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { textoDoErro } from "@/lib/mesa/api";
import { botao, juntar, SeletorCompacto, texto } from "@/components/sistema";
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
import { direcaoDoRoteiro, faltasDoRoteiro, MAX_CENAS, MAX_SEGUNDOS_DA_CENA, normalizarRoteiroDeVideo, type CenaDoRoteiro, type RoteiroDeVideo } from "../../../supabase/functions/agente-calendario/modulos/roteiro-de-video";
import { rotuloDaDuracao } from "../../../supabase/functions/agente-calendario/modulos/agente-de-roteiro";
import AgenteDeRoteiro from "./AgenteDeRoteiro";
import { pecaDeVideoDaCampanha } from "./agenteDeRoteiroApi";
import { TrazerVideo, VideoPronto, type VideoEscolhido } from "./VideoProntoDaPeca";
import { normalizarVideoPronto } from "../../../supabase/functions/agente-calendario/modulos/roteiro-de-video";
import { nomeDoArquivoDoRoteiro, roteiroDoDocumento } from "./documentoDoRoteiroDeVideo";

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
  const { clientId, catalogo, clientName } = useMesa();
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
  const gravar = async (novo: RoteiroDeVideo) => {
    const data = await editarItemDaProposta(propostaId, item.tema_id || "", { roteiro_video: novo });
    if (data && data.proposta) qc.setQueryData(chaves.proposta(propostaId), data.proposta);
    else void qc.invalidateQueries({ queryKey: chaves.proposta(propostaId) });
    setR(null);
  };
  const salvar = async () => {
    if (!r) return;
    setSalvando(true);
    try {
      await gravar(r);
      toast.success("Roteiro salvo", { description: "A direção do vídeo acompanhou o roteiro." });
    } catch (e) {
      toast.error("Roteiro não salvo", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };
  // 23/10/2026: o roteiro em PDF ou Word, no mesmo documento da Mesa Roteiros.
  const [baixando, setBaixando] = useState<"pdf" | "docx" | null>(null);
  const baixar = async (tipo: "pdf" | "docx") => {
    if (!roteiro) return;
    setBaixando(tipo);
    try {
      const doc = roteiroDoDocumento(roteiro, item.tema || "");
      if (tipo === "pdf") {
        const { baixarBytes, itemSolto, montarPdf } = await import("@/components/mesa-roteiros/pdfNoNavegador");
        const { bytes, nome } = montarPdf(clientName || "Cliente", [itemSolto(doc)]);
        baixarBytes(bytes, nome);
      } else {
        const [{ baixarDocumentoDoLab, docxDoProjeto }, { textoDoRoteiro }] = await Promise.all([import("@/lib/laboratorio/exportar"), import("./GravarVideoDaCampanha")]);
        const nome = nomeDoArquivoDoRoteiro(doc.titulo);
        const blob = await docxDoProjeto({ nome, titulo: doc.titulo, markdown: textoDoRoteiro(doc), json: "", totalNos: 0, totalExecucoes: 0, pendencias: [] });
        baixarDocumentoDoLab(blob, `${nome}.docx`);
      }
    } catch (e) {
      toast.error(tipo === "pdf" ? "PDF não gerado" : "Word não gerado", { description: textoDoErro(e) });
    } finally {
      setBaixando(null);
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
    <li className="min-w-0 border-t border-border pt-3 first:border-t-0 first:pt-0" data-video-da-campanha={item.tema_id} data-estado-do-roteiro={salvo ? "pronto" : "falta"}>
      <div className="flex min-w-0 items-center">
        <Clapperboard className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{item.tema || "Vídeo"}</span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {String(item.data || "").slice(8, 10)}/{String(item.data || "").slice(5, 7)} · {item.task_id ? "na agenda" : "fora da agenda"}
            {pronto ? " · vídeo pronto" : ""}
            {roteiro ? ` · ${rotuloDaDuracao(total)}` : ""}
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
      {roteiro && (
        <div className="mt-2 min-w-0 space-y-2">
          {(roteiro.titulo || roteiro.conceito) && (
            <p className="min-w-0 text-[12px] leading-4" data-conceito-do-roteiro="">
              {roteiro.titulo && <span className="font-medium">{roteiro.titulo}</span>}
              {roteiro.titulo && roteiro.conceito ? ": " : ""}
              {roteiro.conceito && <span className="text-muted-foreground">{roteiro.conceito}</span>}
            </p>
          )}
          <label className="block text-[11px] font-medium text-muted-foreground">
            Gancho
            <Input value={roteiro.gancho} onChange={(e) => mudar({ gancho: e.target.value })} className="mt-1 h-8 text-[13px]" aria-label={`Gancho de ${item.tema}`} />
          </label>
          <ol className="space-y-2" aria-label={`Cenas de ${item.tema}`}>
            {roteiro.cenas.map((c, k) => (
              <li key={k} className="min-w-0 rounded-md bg-muted/50 p-2" data-cena={k + 1}>
                <div className="flex min-w-0 items-center">
                  <span className="mr-2 text-[11px] font-medium text-muted-foreground">Cena {k + 1}</span>
                  <Input type="number" min={1} max={MAX_SEGUNDOS_DA_CENA} value={c.segundos} onChange={(e) => mudarCena(k, { segundos: Math.max(1, Math.min(MAX_SEGUNDOS_DA_CENA, Number(e.target.value) || 1)) })} className="h-7 w-16 text-[12px]" aria-label={`Segundos da cena ${k + 1}`} />
                  <span className="ml-1 text-[11px] text-muted-foreground">s</span>
                  <button type="button" className={juntar(botao.icone, "ml-auto h-7 w-7")} onClick={() => mudar({ cenas: roteiro.cenas.filter((_x, i) => i !== k) })} disabled={roteiro.cenas.length <= 1} aria-label={`Tirar a cena ${k + 1}`} title={`Tirar a cena ${k + 1}`}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
                <Textarea value={c.descricao} onChange={(e) => mudarCena(k, { descricao: e.target.value })} rows={2} placeholder="O que aparece" className="mt-1 text-[12px]" aria-label={`O que aparece na cena ${k + 1}`} />
                <div className="mt-1 grid min-w-0 grid-cols-1 gap-1 sm:grid-cols-2">
                  <Input value={c.fala} onChange={(e) => mudarCena(k, { fala: e.target.value })} placeholder="Fala" className="h-8 text-[12px]" aria-label={`Fala da cena ${k + 1}`} />
                  <Input value={c.texto_na_tela} onChange={(e) => mudarCena(k, { texto_na_tela: e.target.value })} placeholder="Texto na tela" className="h-8 text-[12px]" aria-label={`Texto na tela da cena ${k + 1}`} />
                  <Input value={c.plano || ""} onChange={(e) => mudarCena(k, { plano: e.target.value })} placeholder="Câmera (plano e movimento)" className="h-8 text-[12px]" aria-label={`Câmera da cena ${k + 1}`} />
                  <Input value={c.som || ""} onChange={(e) => mudarCena(k, { som: e.target.value })} placeholder="Som (efeito, trilha, silêncio)" className="h-8 text-[12px]" aria-label={`Som da cena ${k + 1}`} />
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
            <button type="button" className={botao.icone} onClick={() => mudar({ cenas: roteiro.cenas.concat([cenaVazia(roteiro.cenas.length + 1)]).slice(0, MAX_CENAS) })} disabled={roteiro.cenas.length >= MAX_CENAS} aria-label="Acrescentar cena" title="Acrescentar cena">
              <Plus className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" className={juntar(botao.barra, "mr-auto")} onClick={() => void baixar("pdf")} disabled={baixando !== null} aria-label={`Baixar o roteiro de ${item.tema || "o vídeo"} em PDF`} title="Baixar o roteiro (PDF)">
              {baixando === "pdf" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FileDown className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
              PDF
            </button>
            <button type="button" className={juntar(botao.barra, "mr-2")} onClick={() => void baixar("docx")} disabled={baixando !== null} aria-label={`Baixar o roteiro de ${item.tema || "o vídeo"} em Word`} title="Baixar o roteiro (Word)">
              Word
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
      {/* 23/10/2026: o agente de roteiro mora na própria peça (ideia, duração, versões e conversa). */}
      {caminho === "roteiro" && (
        <div className="mt-3 min-w-0">
          <AgenteDeRoteiro
            campanha={campanha}
            propostaId={propostaId}
            item={item}
            roteiro={roteiro}
            aoEscolher={async (v) => {
              await gravar(v);
              toast.success("Roteiro escolhido", { description: "Ficou salvo na peça; ajuste à vontade." });
            }}
            aoAjustar={(v) => setR(v)}
          />
        </div>
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

/** Nova peça de vídeo na série: nome, data e o vídeo (enviado ou do Workspace), ou só a peça. Sem custo. */
function NovoVideo({ campanha, propostaId, aoCriar }: { campanha: Campanha; propostaId: string; aoCriar: () => void }) {
  const { clientId } = useMesa();
  const qc = useQueryClient();
  const [tema, setTema] = useState("");
  const [data, setData] = useState("");
  const [criando, setCriando] = useState(false);
  const criar = async (video: VideoEscolhido | null) => {
    setCriando(true);
    try {
      const res = await pecaDeVideoDaCampanha({ campanhaId: campanha.id, operacao: "criar", tema: tema.trim(), data, video: video as Record<string, unknown> | null });
      aplicarRespostaDaCampanha(qc, clientId, res);
      if (res && res.proposta) qc.setQueryData(chaves.proposta(propostaId), res.proposta);
      setTema("");
      toast.success("Vídeo na campanha", { description: video ? "A peça entrou na série com o vídeo." : "A peça entrou na série; ponha o vídeo ou o roteiro nela." });
      aoCriar();
    } catch (e) {
      toast.error("Peça não criada", { description: textoDoErro(e) });
    } finally {
      setCriando(false);
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
        <TrazerVideo clientId={clientId} rotulo="Vídeo novo" disabled={criando} aoEscolher={(v) => criar(v)} />
        <button type="button" className={botao.barra} onClick={() => void criar(null)} disabled={criando}>
          {criando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
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
  // vídeo por ali mesmo"): nova peça com o vídeo enviado ou do Workspace, só a peça, ou pelo agente de roteiro.
  const novoVideo = (
    <NovoVideo campanha={campanha} propostaId={campanha.proposta_id as string} aoCriar={() => setNovoAberto(false)} />
  );
  const agenteNovo = (
    <AgenteDeRoteiro
      campanha={campanha}
      propostaId={campanha.proposta_id as string}
      item={{ tema_id: "novo", formato: "video", tema: "Novo vídeo", cards: [] } as unknown as ItemProposto}
      roteiro={null}
      aoEscolher={async () => undefined}
      aoAjustar={() => undefined}
      aoCriar={() => {
        setNovoAberto(false);
        toast.success("Peça de vídeo criada", { description: "As versões estão na peça: escolha uma em Usar esta." });
      }}
    />
  );
  const painelNovo = (
    <div className="min-w-0 space-y-3">
      {novoVideo}
      {agenteNovo}
    </div>
  );
  if (!videos.length) {
    return (
      <div className="min-w-0 space-y-3" data-videos-da-campanha="0">
        <p className={texto.auxiliar}>Sem peça de vídeo ainda: envie um vídeo ou peça ao agente de roteiro.</p>
        {painelNovo}
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
        {novoAberto && <div className="mt-2 min-w-0">{painelNovo}</div>}
      </div>
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
