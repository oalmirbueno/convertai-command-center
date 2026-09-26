import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, History, Loader2, MessageSquare, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useMesa } from "@/components/mesa/MesaContexto";
import { textoDoErro, usd } from "@/lib/mesa/api";
import { Cartao, Vazio } from "@/components/mesa-foto/Comuns";
import { motivoParaNaoMudar, resumoPorVideo, ROTULO_DO_ESTADO, tempoDoVideo, type ResumoDoVideo, type VersaoDeVideo } from "../../../supabase/functions/_shared/memoria-de-video";
import { AvisoDeAtivacao } from "./Comuns";
import { chamarMesaVideos, chaveDasVersoes, useArquivosDeVideo, useVersoes } from "./videosApi";

/**
 * Versões (memória por vídeo, kit audiovisual MEMORIA-E-TEMPLATES.md): cada
 * vídeo guarda as versões, os comentários com o tempo do vídeo, o custo e a
 * aprovação. Aprovada é imutável: corrigir é registrar a próxima versão.
 * Aprovação estética não é resultado de campanha.
 */

const campo = "h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-[12px]";

/** "1:05" ou "65" viram segundos; vazio é null. */
export function segundosDoTexto(t: string): number | null {
  const s = String(t || "").trim();
  if (!s) return null;
  const m = /^(\d{1,3}):([0-5]?\d)$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(s.replace(",", "."));
  return isFinite(n) && n >= 0 ? n : null;
}

const COR_DO_ESTADO: Record<string, string> = {
  aprovada: "bg-success/15 text-foreground",
  rejeitada: "bg-destructive/10 text-destructive",
  em_revisao: "bg-primary/10 text-primary",
  rascunho: "bg-muted text-muted-foreground",
};

function Versao({ v, ehAtual }: { v: VersaoDeVideo; ehAtual: boolean }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const [texto, setTexto] = useState("");
  const [tempo, setTempo] = useState("");
  const [motivo, setMotivo] = useState("");
  const [rejeitando, setRejeitando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const recarregar = () => void queryClient.invalidateQueries({ queryKey: chaveDasVersoes(clientId) });
  const travaDoComentario = motivoParaNaoMudar(v, "feedback");
  const travaDaDecisao = motivoParaNaoMudar(v, "decidir");

  const comentar = async () => {
    setOcupado("feedback");
    try {
      await chamarMesaVideos({ acao: "versao_feedback", versao_id: v.id, texto, tempo_s: segundosDoTexto(tempo) });
      setTexto("");
      setTempo("");
      recarregar();
    } catch (e) {
      toast.error("Não foi possível comentar", { description: textoDoErro(e) });
    } finally {
      setOcupado(null);
    }
  };

  const decidir = async (decisao: "aprovar" | "rejeitar") => {
    setOcupado(decisao);
    try {
      await chamarMesaVideos({ acao: "versao_decidir", versao_id: v.id, decisao, motivo: decisao === "rejeitar" ? motivo : null });
      setRejeitando(false);
      setMotivo("");
      recarregar();
      toast.success(decisao === "aprovar" ? `Versão ${v.numero} aprovada` : `Versão ${v.numero} rejeitada`, {
        description: decisao === "aprovar" ? "Fica imutável. Correção vira a próxima versão." : "O motivo fica na memória do vídeo.",
      });
    } catch (e) {
      toast.error("Não foi possível decidir", { description: textoDoErro(e) });
    } finally {
      setOcupado(null);
    }
  };

  return (
    <li className="py-2" data-versao={v.id}>
      <p className="flex min-w-0 flex-wrap items-center text-[12.5px]">
        <span className="mr-2 font-medium">Versão {v.numero}</span>
        <span className={`mr-2 rounded-full px-2 py-px text-[10.5px] font-medium ${COR_DO_ESTADO[v.estado] || ""}`}>{ROTULO_DO_ESTADO[v.estado]}</span>
        {v.custo_usd !== null && <span className="mr-2 text-[11px] text-muted-foreground">{usd(v.custo_usd)}</span>}
        <span className="text-[11px] text-muted-foreground">{v.criado_em ? new Date(v.criado_em).toLocaleDateString("pt-BR") : ""}</span>
      </p>
      {v.nota && <p className="mt-0.5 text-[11.5px] text-muted-foreground">{v.nota}</p>}
      {v.motivo && <p className="mt-0.5 text-[11.5px] text-muted-foreground">Motivo: {v.motivo}</p>}
      {v.feedback.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {v.feedback.map((f, i) => (
            <li key={`${f.em}-${i}`} className="flex min-w-0 text-[11.5px]">
              <MessageSquare className="mr-1.5 mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {f.tempo_s !== null && <span className="mr-1 font-medium">{tempoDoVideo(f.tempo_s)}</span>}
                {f.texto}
              </span>
            </li>
          ))}
        </ul>
      )}
      {ehAtual && !travaDoComentario && (
        <form
          className="mt-1.5 flex min-w-0 items-center"
          onSubmit={(e) => {
            e.preventDefault();
            if (texto.trim()) void comentar();
          }}
        >
          <input className={`${campo} mr-1 w-16 shrink-0`} value={tempo} onChange={(e) => setTempo(e.target.value)} placeholder="0:12" aria-label="Tempo do vídeo" />
          <input className={campo} value={texto} maxLength={1200} onChange={(e) => setTexto(e.target.value)} placeholder="Comentário desta versão" aria-label="Comentário" />
          <Button type="submit" size="sm" variant="outline" className="ml-1 h-8 shrink-0" disabled={!texto.trim() || !!ocupado}>
            {ocupado === "feedback" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Comentar"}
          </Button>
        </form>
      )}
      {ehAtual && !travaDaDecisao && (
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center">
          {rejeitando ? (
            <>
              <input className={`${campo} mb-1 mr-1 flex-1`} value={motivo} maxLength={400} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo da rejeição" aria-label="Motivo da rejeição" />
              <Button type="button" size="sm" variant="outline" className="mb-1 mr-1 h-8" disabled={!motivo.trim() || !!ocupado} onClick={() => void decidir("rejeitar")}>
                {ocupado === "rejeitar" && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                Rejeitar
              </Button>
              <Button type="button" size="sm" variant="ghost" className="mb-1 h-8" onClick={() => setRejeitando(false)}>
                Voltar
              </Button>
            </>
          ) : (
            <>
              <Button type="button" size="sm" className="mb-1 mr-1 h-8" disabled={!!ocupado} onClick={() => void decidir("aprovar")}>
                {ocupado === "aprovar" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
                Aprovar
              </Button>
              <Button type="button" size="sm" variant="outline" className="mb-1 h-8" disabled={!!ocupado} onClick={() => setRejeitando(true)}>
                <X className="mr-1 h-3.5 w-3.5" />
                Rejeitar
              </Button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

function NovaVersao({ videos, onFechar }: { videos: ResumoDoVideo[]; onFechar: () => void }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const arquivosQ = useArquivosDeVideo(clientId);
  const arquivos = ((arquivosQ.data && arquivosQ.data.arquivos) || []).filter((a) => !a.so_no_storage && a.estado !== "arquivado");
  const [videoId, setVideoId] = useState("");
  const [titulo, setTitulo] = useState("");
  const [arquivoId, setArquivoId] = useState("");
  const [custo, setCusto] = useState("");
  const [nota, setNota] = useState("");
  const [salvando, setSalvando] = useState(false);
  const video = videos.find((x) => x.video_id === videoId) || null;

  const salvar = async () => {
    setSalvando(true);
    try {
      const c = Number(String(custo).replace(",", "."));
      await chamarMesaVideos({
        acao: "versao_registrar",
        client_id: clientId,
        video_id: videoId || null,
        titulo: video ? video.titulo : titulo,
        arquivo_id: arquivoId || null,
        custo_usd: custo.trim() && isFinite(c) && c >= 0 ? c : null,
        nota: nota || null,
      });
      void queryClient.invalidateQueries({ queryKey: chaveDasVersoes(clientId) });
      toast.success(video ? `Versão ${video.versoes.length + 1} registrada` : "Vídeo registrado");
      onFechar();
    } catch (e) {
      toast.error("Não foi possível registrar", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="mb-3 rounded-lg border border-border bg-background p-3" data-nova-versao="">
      <div className="grid min-w-0 gap-2 sm:grid-cols-2">
        <label className="min-w-0 text-[11px] text-muted-foreground">
          Vídeo
          <select className={campo} value={videoId} onChange={(e) => setVideoId(e.target.value)}>
            <option value="">Vídeo novo</option>
            {videos.map((v) => (
              <option key={v.video_id} value={v.video_id}>
                {v.titulo} (próxima: versão {v.versoes.length + 1})
              </option>
            ))}
          </select>
        </label>
        {!video && (
          <label className="min-w-0 text-[11px] text-muted-foreground">
            Nome do vídeo
            <input className={campo} value={titulo} maxLength={120} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Reel do lançamento" />
          </label>
        )}
        <label className="min-w-0 text-[11px] text-muted-foreground">
          Arquivo desta versão
          <select className={campo} value={arquivoId} onChange={(e) => setArquivoId(e.target.value)}>
            <option value="">Sem arquivo</option>
            {arquivos.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-[11px] text-muted-foreground">
          Custo de IA desta versão (US$)
          <input className={campo} value={custo} inputMode="decimal" onChange={(e) => setCusto(e.target.value)} placeholder="Vazio se não houve" />
        </label>
        <label className="min-w-0 text-[11px] text-muted-foreground sm:col-span-2">
          O que mudou
          <input className={campo} value={nota} maxLength={600} onChange={(e) => setNota(e.target.value)} placeholder="Opcional" />
        </label>
      </div>
      <div className="mt-2 flex items-center">
        <Button type="button" size="sm" className="mr-1.5 h-8" disabled={salvando || (!video && !titulo.trim())} onClick={() => void salvar()}>
          {salvando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Registrar
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-8" onClick={onFechar}>
          Fechar
        </Button>
      </div>
    </div>
  );
}

export default function EtapaMemoria() {
  const { clientId } = useMesa();
  const versoesQ = useVersoes(clientId);
  const [nova, setNova] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const videos = useMemo(() => resumoPorVideo((versoesQ.data && versoesQ.data.itens) || []), [versoesQ.data]);
  const disponivel = !versoesQ.data || versoesQ.data.disponivel;

  return (
    <Cartao
      titulo="Versões de cada vídeo"
      dica="Versões, comentários com o tempo do vídeo, custo e aprovação. Aprovada fica imutável; corrigir é registrar a próxima versão."
      acao={
        <Button type="button" size="sm" className="h-8" onClick={() => setNova(true)} disabled={!disponivel || nova}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Registrar versão
        </Button>
      }
    >
      {!disponivel && <AvisoDeAtivacao>A memória de vídeos ainda não foi ativada no banco (SQL V2-01).</AvisoDeAtivacao>}
      {nova && <NovaVersao videos={videos} onFechar={() => setNova(false)} />}
      {versoesQ.isLoading ? (
        <div className="h-24 animate-pulse rounded-lg bg-muted" aria-busy="true" />
      ) : !videos.length ? (
        disponivel && <Vazio titulo="Nenhuma versão registrada">Registre a primeira versão de um vídeo para guardar comentários, custo e aprovação.</Vazio>
      ) : (
        <ul className="divide-y divide-border" aria-label="Vídeos do cliente">
          {videos.map((v) => {
            const expandido = aberto === v.video_id;
            return (
              <li key={v.video_id} className="py-2" data-video={v.video_id}>
                <button type="button" className="flex w-full min-w-0 items-center text-left" onClick={() => setAberto(expandido ? null : v.video_id)} aria-expanded={expandido}>
                  <History className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{v.titulo}</span>
                  <span className={`ml-2 shrink-0 rounded-full px-2 py-px text-[10.5px] font-medium ${COR_DO_ESTADO[v.atual.estado] || ""}`}>
                    v{v.atual.numero} · {ROTULO_DO_ESTADO[v.atual.estado]}
                  </span>
                  <span className="ml-2 hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
                    {v.custo_total_usd !== null ? usd(v.custo_total_usd) : "sem custo registrado"} · {v.comentarios} {v.comentarios === 1 ? "comentário" : "comentários"}
                  </span>
                </button>
                {expandido && (
                  <ol className="mt-1 divide-y divide-border pl-5">
                    {v.versoes
                      .slice()
                      .reverse()
                      .map((x) => (
                        <Versao key={x.id} v={x} ehAtual={x.id === v.atual.id} />
                      ))}
                  </ol>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Cartao>
  );
}
