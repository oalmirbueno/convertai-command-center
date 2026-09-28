import { useEffect, useRef, useState, type DragEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Copy, Film, Loader2, Music, Play, Star, Subtitles, Upload } from "lucide-react";
import { toast } from "sonner";
import { useMesa, useUrlDaMesa } from "@/components/mesa/MesaContexto";
import { textoDoErro, usd } from "@/lib/mesa/api";
import { supabase } from "@/integrations/supabase/client";
import { custoDoTimestamp, linhasDeLegenda, srtDasLinhas } from "../../../supabase/functions/editor-video/ferramentas";
import { guardarFalaDaEntrada, lerFalaDaEntrada, transcreverMidia } from "@/lib/editor/fala";
import { emPreparacao } from "@/lib/editor/api";
import Secao from "@/components/sistema/Secao";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { Carregando, EstadoDeErro, EstadoVazio } from "@/components/sistema/Estados";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campo, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { AvisoDeAtivacao, SeloDoTipo } from "@/components/mesa-videos/Comuns";
import type { IrPara } from "@/components/mesa-videos/MesaDeVideo";
import {
  chamarMesaVideos,
  chaveDosArquivos,
  duracaoCurta,
  naEntradaDaEdicao,
  subirVideos,
  tamanhoCurto,
  useArquivosDeVideo,
  usePedidos,
  type ArquivoDeVideo,
} from "@/components/mesa-videos/videosApi";
import { useParte } from "./useParte";

/**
 * Entrada da Mesa Edição (frente E2): subir vídeos de fora (arrastar ou
 * escolher; duas de cada vez, duração e quadro lidos no navegador, hash até
 * 256 MB, uma nova tentativa em falha de rede, aviso antes de sair no meio) e
 * os vídeos gerados que a Mesa Vídeos aprovou. Transcrição e legenda rodam
 * aqui (frente Q, 26/09): custo antes, clique do dono, fala guardada por take
 * para o editor. O original nunca muda.
 */

const PARTES = ["videos", "transcricao"] as const;
type ParteDaEntrada = (typeof PARTES)[number];

function PlayerDoArquivo({ arquivo }: { arquivo: ArquivoDeVideo }) {
  const url = useUrlDaMesa(arquivo.storage_path, arquivo.storage_bucket);
  const audio = arquivo.tipo === "audio" || String(arquivo.mime || "").indexOf("audio/") === 0;
  if (url.isLoading) return <div className="h-40 animate-pulse rounded-md bg-muted" aria-busy="true" />;
  if (!url.data) return <p className={texto.auxiliar}>Não foi possível abrir o arquivo agora.</p>;
  return audio ? (
    <audio src={url.data} controls preload="metadata" className="w-full" />
  ) : (
    <video src={url.data} controls preload="metadata" playsInline className="max-h-[60vh] w-full rounded-md bg-black object-contain" />
  );
}

export function LinhaDoArquivo({ arquivo, aberto, onAbrir }: { arquivo: ArquivoDeVideo; aberto: boolean; onAbrir: () => void }) {
  const audio = arquivo.tipo === "audio" || String(arquivo.mime || "").indexOf("audio/") === 0;
  const detalhes = [duracaoCurta(arquivo.duracao_s), arquivo.largura && arquivo.altura ? `${arquivo.largura}x${arquivo.altura}` : "", tamanhoCurto(arquivo.bytes)].filter(Boolean);
  return (
    <li className="min-w-0 py-2" data-arquivo-de-video={arquivo.id}>
      <div className="flex min-w-0 items-center">
        <button type="button" onClick={onAbrir} aria-expanded={aberto} aria-label={`${aberto ? "Fechar" : "Ver"} ${arquivo.nome}`} className={juntar(botao.icone, "mr-2 border border-border")}>
          {audio ? <Music className="h-3.5 w-3.5" /> : aberto ? <Film className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center text-[13px] font-medium">
            {arquivo.melhor && <Star className="mr-1 h-3 w-3 shrink-0 fill-current text-warning" aria-label="Melhor take" />}
            <span className="truncate" title={arquivo.nome_original !== arquivo.nome ? `Original: ${arquivo.nome_original}` : undefined}>
              {arquivo.nome}
            </span>
          </p>
          <p className={juntar(texto.auxiliar, "flex min-w-0 items-center")}>
            <SeloDoTipo tipo={arquivo.tipo} />
            {arquivo.grupo && <span className="mr-1.5 truncate">{arquivo.grupo}</span>}
            {detalhes.length > 0 && <span className="truncate tabular-nums">{detalhes.join(" · ")}</span>}
          </p>
        </div>
        {arquivo.tipo === "gerado" && <span className={juntar(etiqueta, "ml-2 bg-primary/10 text-primary")}>Da Mesa Vídeos</span>}
      </div>
      {aberto && (
        <div className="mt-2">
          <PlayerDoArquivo arquivo={arquivo} />
        </div>
      )}
    </li>
  );
}

function copiarTexto(t: string) {
  try {
    void navigator.clipboard.writeText(t).then(() => toast.success("Copiado"));
  } catch {
    toast.error("Não deu para copiar aqui.");
  }
}

/**
 * Transcrição e legenda de verdade (frente Q, 26/09; antes era "pedido
 * preparado" com executor "em breve"). Por take: custo antes, clique do dono,
 * só o áudio sai do navegador (Timestamp do editor, Whisper palavra por
 * palavra, editor-video/timestamp_parte). A fala fica guardada neste navegador
 * por take: o editor usa sem pagar de novo (legenda, cortes na pausa, Brabo).
 */
function Transcricao({ videos }: { videos: ArquivoDeVideo[] }) {
  const { clientId, atualizarCusto } = useMesa();
  const pedidosQ = usePedidos(clientId);
  const [tipo, setTipo] = useEstadoDaTela<"transcrever" | "legendar">(`mesa-edicao:transcricao:tipo:${clientId}`, "transcrever", { validar: (v) => v === "transcrever" || v === "legendar" });
  const [vocabulario, setVocabulario] = useEstadoDaTela<string>(`mesa-edicao:transcricao:vocabulario:${clientId}`, "");
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [rodando, setRodando] = useState<{ id: string; texto: string } | null>(null);
  const [versao, setVersao] = useState(0);
  const takes = videos.filter((a) => a.tipo !== "gerado" && !a.so_no_storage);
  const antigos = ((pedidosQ.data && pedidosQ.data.itens) || []).filter((p) => (p.tipo === "transcrever" || p.tipo === "legendar") && p.estado !== "cancelado");
  const marcados = takes.filter((t) => !!lerFalaDaEntrada(clientId, t.id)).length;

  const transcrever = async (take: ArquivoDeVideo) => {
    setConfirmando(null);
    setRodando({ id: take.id, texto: "Abrindo o vídeo" });
    try {
      const { data, error } = await supabase.storage.from(take.storage_bucket || "mesa").createSignedUrl(take.storage_path, 3600);
      if (error || !data || !data.signedUrl) throw new Error("Não foi possível abrir o vídeo agora.");
      const r = await transcreverMidia({ clientId, url: data.signedUrl, dica: vocabulario, aoAndar: (t) => setRodando({ id: take.id, texto: t.slice(0, 80) }) });
      if (!guardarFalaDaEntrada(clientId, take.id, r.palavras)) toast.warning("A fala saiu, mas o navegador não guardou.", { description: "Copie o texto agora." });
      setVersao((v) => v + 1);
      toast.success(`${r.palavras.length} palavras marcadas`, { description: `${take.nome} · ${usd(r.custo_usd)}. O editor usa essa fala sem pagar de novo.` });
    } catch (e) {
      toast.error("Não foi possível transcrever", { description: emPreparacao(e) ? "Falta publicar a função editor-video." : textoDoErro(e), duration: 9000 });
    } finally {
      setRodando(null);
      atualizarCusto();
    }
  };

  return (
    <Secao
      titulo="Transcrição e legenda"
      descricao={`${marcados} de ${takes.length} ${takes.length === 1 ? "take marcado" : "takes marcados"}`}
      ajuda="Marca o tempo de cada palavra da fala (Whisper, US$ 0,006 por minuto). Só o áudio sai do navegador. A fala fica guardada neste navegador por take, e o editor usa para legenda e cortes sem pagar de novo. Os nomes, marcas e valores da lista entram como dica."
      acao={
        <SeletorCompacto
          rotulo="Tipo de pedido"
          opcoes={[
            { valor: "transcrever", rotulo: "Transcrever" },
            { valor: "legendar", rotulo: "Legendar" },
          ]}
          valor={tipo}
          onEscolher={(v) => setTipo(v === "legendar" ? "legendar" : "transcrever")}
        />
      }
      data-versao-da-fala={versao}
    >
      <CampoDeFormulario rotulo="Nomes, marcas e valores" apoio="Separe por vírgula." className="mb-3">
        <input className={campo} value={vocabulario} maxLength={600} onChange={(e) => setVocabulario(e.target.value)} placeholder="Ex.: nome da loja, produto, preço" />
      </CampoDeFormulario>
      {!takes.length ? (
        <EstadoVazio compacto titulo="Sem gravação para transcrever." />
      ) : (
        <ul className="divide-y divide-border">
          {takes.map((t) => {
            const fala = lerFalaDaEntrada(clientId, t.id);
            const custo = custoDoTimestamp("transcrever", t.duracao_s || 0);
            const antigo = antigos.find((p) => p.alvo && p.alvo.arquivo_id === t.id);
            const linhas = fala ? linhasDeLegenda(fala) : [];
            return (
              <li key={t.id} className="min-w-0 py-2" data-legenda-do-take={t.id}>
                <div className="flex min-w-0 items-center">
                  <span className="mr-2 min-w-0 flex-1 truncate text-[13px]">{t.nome}</span>
                  {rodando && rodando.id === t.id ? (
                    <span className={juntar(texto.auxiliar, "flex shrink-0 items-center")}>
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      {rodando.texto}
                    </span>
                  ) : fala ? (
                    <>
                      <span className={juntar(etiqueta, "mr-1 bg-primary/10 text-primary")}>{fala.length} palavras</span>
                      <button type="button" className={juntar(botao.discreto, "h-8 px-2 text-[12px]")} onClick={() => copiarTexto(tipo === "legendar" ? srtDasLinhas(linhas) : linhas.map((l) => l.texto).join("\n"))} aria-label={`Copiar ${tipo === "legendar" ? "legenda SRT" : "texto"} de ${t.nome}`}>
                        <Copy className="h-3.5 w-3.5 sm:mr-1.5" />
                        <span className="hidden sm:inline">{tipo === "legendar" ? "SRT" : "Texto"}</span>
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={juntar(botao.secundario, "h-8 px-2.5 text-[12.5px]")}
                      onClick={() => setConfirmando(t.id)}
                      disabled={!!rodando || !t.duracao_s}
                      aria-label={`${tipo === "legendar" ? "Legendar" : "Transcrever"} ${t.nome}`}
                      title={t.duracao_s ? undefined : "Sem duração lida: abra o vídeo uma vez para ler."}
                    >
                      <Subtitles className="h-3.5 w-3.5 sm:mr-1.5" />
                      <span className="hidden sm:inline">{tipo === "legendar" ? "Legendar" : "Transcrever"}</span>
                      <span className="ml-1.5 hidden text-[11px] text-muted-foreground md:inline">{usd(custo)}</span>
                    </button>
                  )}
                </div>
                {antigo && !fala && <p className={juntar(texto.auxiliar, "mt-1")}>Havia um pedido preparado antes. Agora a transcrição roda aqui.</p>}
                {confirmando === t.id && (
                  <div className="mt-2 flex flex-wrap items-center rounded-md bg-muted/50 px-2.5 py-2" data-confirmar-transcricao="">
                    <span className="mb-1 mr-auto text-[12.5px]">
                      {tipo === "legendar" ? "Legendar" : "Transcrever"} {duracaoCurta(t.duracao_s)}: <strong className="tabular-nums">{usd(custo)}</strong>
                    </span>
                    <button type="button" className={juntar(botao.primario, "mb-1 mr-1 h-8")} onClick={() => void transcrever(t)}>
                      Marcar por {usd(custo)}
                    </button>
                    <button type="button" className={juntar(botao.discreto, "mb-1 h-8")} onClick={() => setConfirmando(null)}>
                      Cancelar
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Secao>
  );
}

export default function EtapaEntrada({ irPara }: { irPara: IrPara }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const arquivosQ = useArquivosDeVideo(clientId);
  const [parte, setParte] = useParte<ParteDaEntrada>(`mesa-edicao:entrada:parte:${clientId}`, PARTES, "videos");
  const [aberto, setAberto] = useState<string | null>(null);
  const [subindo, setSubindo] = useState<{ feitos: number; total: number } | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  const arquivos = (arquivosQ.data && arquivosQ.data.arquivos) || [];
  const degradado = !!(arquivosQ.data && arquivosQ.data.degradado);
  const videos = arquivos.filter(naEntradaDaEdicao);
  const daMesaVideos = videos.filter((a) => a.tipo === "gerado").length;

  // Subindo: avisa antes de fechar ou recarregar a aba (o envio pararia no meio).
  useEffect(() => {
    if (!subindo) return;
    const aviso = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [subindo]);

  const enviar = async (lista: FileList | File[] | null) => {
    const novos = lista ? (Array.prototype.slice.call(lista) as File[]) : [];
    if (!novos.length || subindo) return;
    setSubindo({ feitos: 0, total: novos.length });
    try {
      const r = await subirVideos(clientId, novos, (feitos, total) => setSubindo({ feitos, total }));
      void queryClient.invalidateQueries({ queryKey: chaveDosArquivos(clientId) });
      const partes: string[] = [];
      if (r.registrados.length) partes.push(`${r.registrados.length} na Entrada`);
      if (r.duplicados.length) partes.push(`${r.duplicados.length} já estavam (mesmo conteúdo)`);
      if (r.recusados.length) partes.push(`${r.recusados.length} não subiram: ${r.recusados.map((x) => `${x.nome} (${x.motivo})`).join("; ")}`);
      if (r.aviso) toast.warning("Subiu, falta registrar", { description: r.aviso, duration: 9000 });
      else toast.success("Vídeos enviados", { description: partes.join(". ") || "Nada novo." });
      if (r.registrados.length) setParte("videos");
    } catch (e) {
      toast.error("O envio parou", { description: textoDoErro(e), duration: 9000 });
    } finally {
      setSubindo(null);
      if (entrada.current) entrada.current.value = "";
    }
  };

  const soltar = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setArrastando(false);
    void enviar(e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files : null);
  };

  return (
    <div
      className={juntar("relative min-w-0 space-y-6 pb-6", arrastando && "rounded-lg outline-dashed outline-2 outline-primary/60")}
      onDragOver={(e) => {
        e.preventDefault();
        if (!arrastando) setArrastando(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setArrastando(false);
      }}
      onDrop={soltar}
      data-entrada-da-edicao=""
    >
      <div className="flex min-w-0 flex-wrap items-center">
        <SeletorCompacto
          rotulo="Parte da entrada"
          className="mr-3"
          valor={parte}
          onEscolher={(v) => setParte(v as ParteDaEntrada)}
          opcoes={[
            { valor: "videos", rotulo: "Vídeos", contador: arquivosQ.data ? videos.length : null },
            { valor: "transcricao", rotulo: "Transcrição" },
          ]}
        />
        <div className="ml-auto flex items-center">
          <input
            ref={entrada}
            type="file"
            multiple
            accept="video/*,audio/*,.mov,.mp4,.mkv,.mts,.wav,.mp3,.m4a"
            className="hidden"
            aria-label="Escolher vídeos"
            onChange={(e) => void enviar(e.target.files)}
          />
          <button type="button" className={botao.primario} disabled={!!subindo} onClick={() => entrada.current && entrada.current.click()} aria-label={subindo ? `Subindo ${subindo.feitos} de ${subindo.total}` : "Subir vídeos"}>
            {subindo ? <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-1.5" /> : <Upload className="h-3.5 w-3.5 sm:mr-1.5" />}
            <span className="hidden sm:inline">{subindo ? `Subindo ${subindo.feitos} de ${subindo.total}` : "Subir vídeos"}</span>
          </button>
        </div>
      </div>

      {degradado && <AvisoDeAtivacao>O acervo de vídeo ainda não foi ativado no banco (SQL V2-01). O que já subiu aparece pela pasta, sem nome, grupo nem organizador.</AvisoDeAtivacao>}

      {parte === "videos" && (
        <Secao
          titulo="Vídeos"
          descricao={arquivosQ.data ? `${videos.length} na Entrada${daMesaVideos ? ` · ${daMesaVideos} da Mesa Vídeos` : ""}` : undefined}
          ajuda="Arraste os vídeos para cá ou use Subir (até 4 GB cada). A duração e o tamanho do quadro são lidos no seu navegador. Os vídeos aprovados na Mesa Vídeos chegam sozinhos."
          acao={
            videos.length > 0 ? (
              <button type="button" className={botao.secundario} onClick={() => irPara("organizar")}>
                Organizar
              </button>
            ) : undefined
          }
        >
          {arquivosQ.isLoading ? (
            <Carregando linhas={4} rotulo="Lendo os vídeos" />
          ) : arquivosQ.isError ? (
            <EstadoDeErro
              titulo="Não foi possível ler os vídeos."
              acao={
                <button type="button" className={botao.secundario} onClick={() => void arquivosQ.refetch()}>
                  Tentar de novo
                </button>
              }
            />
          ) : videos.length ? (
            <ul className="divide-y divide-border" aria-label="Vídeos da Entrada">
              {videos.map((a) => (
                <LinhaDoArquivo key={a.id} arquivo={a} aberto={aberto === a.id} onAbrir={() => setAberto(aberto === a.id ? null : a.id)} />
              ))}
            </ul>
          ) : (
            <EstadoVazio
              icone={<Upload className="h-5 w-5" />}
              titulo="Arraste os vídeos para cá"
              descricao="Ou use Subir vídeos. Os aprovados da Mesa Vídeos entram sozinhos."
            />
          )}
        </Secao>
      )}
      {parte === "transcricao" && <Transcricao videos={videos} />}
    </div>
  );
}
