import { useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Captions, Download, Film, Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import Secao from "@/components/sistema/Secao";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import ComparadorAntesDepois from "@/components/comparar/ComparadorAntesDepois";
import { Carregando, EstadoVazio } from "@/components/sistema/Estados";
import { botao, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { useMesa, useUrlDaMesa } from "@/components/mesa/MesaContexto";
import { textoDoErro, usd } from "@/lib/mesa/api";
import { chamarEditorVideo, emPreparacao } from "@/lib/editor/api";
import { transcreverMidia } from "@/lib/editor/fala";
import { pedirRender, uidDoClique } from "@/lib/editor/render";
import { chaveDasVersoes, chaveDosArquivos, duracaoCurta, naEntradaDaEdicao, useArquivosDeVideo, type ArquivoDeVideo } from "@/components/mesa-videos/videosApi";
import { gerarLegendaDoFinal, gravarLegendaNoVideo, type LegendaGerada } from "@/lib/edicao/acoesDaEdicao";
import { baixarPeloLink, linkParaBaixar, nomeParaBaixar } from "@/lib/edicao/baixarFinal";
import BotoesDoFinal from "./BotoesDoFinal";
import { agruparVariantes, antesDoTratado, categoriaDoArquivo, rotuloDaVariante } from "../../../supabase/functions/mesa-videos/modulos/organizador-da-entrada";

/**
 * Finais (Mesa Edição, 02/10): os vídeos prontos (render do editor e
 * entregas) e o antes e depois dos tratados.
 * - "Gerar legenda": o SRT e o VTT do corte final (a trilha de legenda do
 *   projeto ou a fala marcada levada pelo corte; sem fala, transcreve o vídeo
 *   pronto com o custo antes). Os arquivos ficam ao lado do vídeo.
 * - "Gravar no vídeo": registra a próxima versão com a legenda gravada e pede
 *   o render (worker da agência, sem custo de IA).
 * - Tratados: comparar o antes e o depois.
 * - Baixar (com o nome do final), Salvar no celular (compartilhamento do
 *   sistema) e Abrir no Workspace (Vídeos / título / Finais); SRT e VTT
 *   também baixam com o nome do vídeo.
 */

const ESTILOS = [
  { valor: "simples", rotulo: "Simples" },
  { valor: "caixa", rotulo: "Caixa" },
];

/** Baixa a legenda pelo caminho no bucket (com o nome do vídeo); sem caminho, pelo link que a função devolveu. */
async function baixarLegenda(arquivo: ArquivoDeVideo, ext: "srt" | "vtt", caminho: string | null, url: string | null) {
  const nome = nomeParaBaixar(arquivo.nome, ext);
  try {
    if (caminho) baixarPeloLink(await linkParaBaixar(arquivo.storage_bucket || "mesa", caminho, nome), nome);
    else if (url) baixarPeloLink(url, nome);
  } catch (e) {
    toast.error("Não foi possível baixar a legenda", { description: textoDoErro(e) });
  }
}

function Comparar({ antes, depois }: { antes: ArquivoDeVideo; depois: ArquivoDeVideo }) {
  const a = useUrlDaMesa(antes.storage_path, antes.storage_bucket);
  const d = useUrlDaMesa(depois.storage_path, depois.storage_bucket);
  if (!a.data || !d.data) return <div className="h-40 animate-pulse rounded-md bg-muted" aria-busy="true" />;
  const proporcao = depois.largura && depois.altura ? depois.altura / depois.largura : 16 / 9;
  return <ComparadorAntesDepois tipo="video" antes={{ src: a.data, rotulo: "Antes" }} depois={{ src: d.data, rotulo: "Depois" }} proporcao={proporcao} />;
}

function Player({ arquivo }: { arquivo: ArquivoDeVideo }) {
  const url = useUrlDaMesa(arquivo.storage_path, arquivo.storage_bucket);
  if (!url.data) return <div className="h-40 animate-pulse rounded-md bg-muted" aria-busy="true" />;
  return <video src={url.data} controls preload="metadata" playsInline className="max-h-[60vh] w-full rounded-md bg-black object-contain" />;
}

function LinhaDoFinal({ arquivo, variantes, antes }: { arquivo: ArquivoDeVideo; variantes: ArquivoDeVideo[]; antes: ArquivoDeVideo | null }) {
  const { clientId, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const [aberto, setAberto] = useState<"ver" | "comparar" | null>(null);
  const [legenda, setLegenda] = useState<LegendaGerada | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [estilo, setEstilo] = useState<"simples" | "caixa">("simples");
  const doEditor = !!(arquivo.origem && arquivo.origem.render_pedido_id);
  const amostra = arquivo.tipo === "amostra";
  const jaTem = arquivo.origem && arquivo.origem.legenda && typeof arquivo.origem.legenda === "object" ? (arquivo.origem.legenda as { linhas?: number; srt_path?: string; vtt_path?: string }) : null;
  const caminhoDaLegenda = (ext: "srt" | "vtt") => (legenda && legenda.caminhos ? legenda.caminhos[ext] : jaTem ? (ext === "srt" ? jaTem.srt_path : jaTem.vtt_path) || null : null);
  const urlDaLegenda = (ext: "srt" | "vtt") => (legenda && legenda.urls ? legenda.urls[ext] : null);

  const gerar = async (palavras?: { t: string; i: number; f: number }[]) => {
    setOcupado("gerar");
    try {
      const r = await gerarLegendaDoFinal(arquivo.id, palavras);
      setLegenda(r);
      if (!r.precisa_transcrever) {
        void queryClient.invalidateQueries({ queryKey: chaveDosArquivos(clientId) });
        toast.success(`Legenda com ${r.linhas.length} ${r.linhas.length === 1 ? "linha" : "linhas"}`, { description: r.origem === "trilha" ? "Da trilha de legenda da edição." : r.origem === "fala" ? "Da fala marcada, levada pelo corte." : "Da fala do vídeo pronto." });
      }
    } catch (e) {
      toast.error("A legenda não saiu", { description: emPreparacao(e) ? "Falta publicar a função mesa-videos." : textoDoErro(e), duration: 9000 });
    } finally {
      setOcupado(null);
    }
  };

  const transcrever = async () => {
    setOcupado("transcrever");
    try {
      const { data, error } = await supabase.storage.from(arquivo.storage_bucket || "mesa").createSignedUrl(arquivo.storage_path, 3600);
      if (error || !data || !data.signedUrl) throw new Error("Não foi possível abrir o vídeo agora.");
      const r = await transcreverMidia({ clientId, url: data.signedUrl });
      atualizarCusto();
      await gerar(r.palavras);
    } catch (e) {
      toast.error("Não foi possível transcrever", { description: textoDoErro(e), duration: 9000 });
      setOcupado(null);
    }
  };

  const gravar = async () => {
    if (!legenda || !legenda.linhas.length) return;
    setOcupado("gravar");
    try {
      const r = await gravarLegendaNoVideo(arquivo.id, legenda.linhas, estilo);
      const revisao = r.versao.projeto && typeof r.versao.projeto.revisao === "number" ? r.versao.projeto.revisao : null;
      await pedirRender(chamarEditorVideo, { clientId, versaoId: r.versao.id, tipo: "render_final", uid: uidDoClique(), revisao });
      void queryClient.invalidateQueries({ queryKey: chaveDasVersoes(clientId) });
      toast.success(`Versão ${r.versao.numero} com legenda na fila do render`, { description: "O vídeo novo aparece aqui quando a máquina terminar." });
    } catch (e) {
      toast.error("Não foi possível gravar a legenda no vídeo", { description: textoDoErro(e), duration: 9000 });
    } finally {
      setOcupado(null);
    }
  };

  const detalhes = [duracaoCurta(arquivo.duracao_s), arquivo.largura && arquivo.altura ? `${arquivo.largura}x${arquivo.altura}` : ""].filter(Boolean).join(" · ");
  let acoes: ReactNode = null;
  if (antes) {
    acoes = (
      <button type="button" className={juntar(botao.secundario, "h-8 px-2.5 text-[12px]")} onClick={() => setAberto(aberto === "comparar" ? null : "comparar")} aria-expanded={aberto === "comparar"}>
        Antes e depois
      </button>
    );
  } else if (!legenda || legenda.precisa_transcrever) {
    acoes = legenda && legenda.precisa_transcrever ? (
      <button type="button" className={juntar(botao.secundario, "h-8 px-2.5 text-[12px]")} disabled={!!ocupado} onClick={() => void transcrever()} title="Sem fala marcada na edição: transcreve o vídeo pronto (Whisper).">
        {ocupado === "transcrever" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Captions className="mr-1.5 h-3.5 w-3.5" />}
        Transcrever por {usd(legenda.custo_transcricao_usd || 0)}
      </button>
    ) : (
      <button type="button" className={juntar(botao.secundario, "h-8 px-2.5 text-[12px]")} disabled={!!ocupado} onClick={() => void gerar()} aria-label={`Gerar legenda de ${arquivo.nome}`}>
        {ocupado === "gerar" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Captions className="mr-1.5 h-3.5 w-3.5" />}
        {jaTem ? "Gerar de novo" : "Gerar legenda"}
      </button>
    );
  }

  return (
    <li className="min-w-0 py-2" data-final={arquivo.id}>
      <div className="flex min-w-0 items-center">
        <button type="button" className={juntar(botao.icone, "mr-2 border border-border")} onClick={() => setAberto(aberto === "ver" ? null : "ver")} aria-label={`${aberto === "ver" ? "Fechar" : "Ver"} ${arquivo.nome}`}>
          {aberto === "ver" ? <Film className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center text-[13px] font-medium">
            <span className="truncate">{arquivo.nome}</span>
            {variantes.length > 0 && <span className={juntar(etiqueta, "ml-2 bg-muted text-muted-foreground")} title={variantes.map(rotuloDaVariante).join(", ")}>+{variantes.length}</span>}
            {jaTem && <span className={juntar(etiqueta, "ml-2 bg-primary/10 text-primary")}>Com SRT</span>}
          </p>
          <p className={juntar(texto.auxiliar, "truncate")}>{antes ? `Antes: ${antes.nome}` : detalhes}</p>
        </div>
        <BotoesDoFinal className="ml-1" clientId={clientId} arquivoId={arquivo.id} bucket={arquivo.storage_bucket} caminho={arquivo.storage_path} nome={nomeParaBaixar(arquivo.nome)} origem={arquivo.origem} semWorkspace={amostra} />
        <div className="ml-1 flex shrink-0 items-center">{acoes}</div>
      </div>
      {aberto === "ver" && (
        <div className="mt-2">
          <Player arquivo={arquivo} />
        </div>
      )}
      {aberto === "comparar" && antes && (
        <div className="mt-2">
          <Comparar antes={antes} depois={arquivo} />
        </div>
      )}
      {!legenda && jaTem && (jaTem.srt_path || jaTem.vtt_path) && (
        <div className="mt-1 flex min-w-0 flex-wrap items-center" data-legenda-guardada="">
          {jaTem.srt_path && (
            <button type="button" className={juntar(botao.discreto, "mr-1 h-8 px-2 text-[12px]")} onClick={() => void baixarLegenda(arquivo, "srt", jaTem.srt_path || null, null)} aria-label="Baixar SRT">
              <Download className="mr-1.5 h-3.5 w-3.5" />
              SRT
            </button>
          )}
          {jaTem.vtt_path && (
            <button type="button" className={juntar(botao.discreto, "h-8 px-2 text-[12px]")} onClick={() => void baixarLegenda(arquivo, "vtt", jaTem.vtt_path || null, null)} aria-label="Baixar VTT">
              <Download className="mr-1.5 h-3.5 w-3.5" />
              VTT
            </button>
          )}
        </div>
      )}
      {legenda && !legenda.precisa_transcrever && legenda.linhas.length > 0 && (
        <div className="mt-2 space-y-2" data-legenda-gerada={legenda.linhas.length}>
          <ol className="max-h-40 overflow-y-auto rounded-md bg-muted/40 px-2.5 py-1.5 text-[12px]">
            {legenda.linhas.slice(0, 200).map((l, k) => (
              <li key={k} className="flex min-w-0">
                <span className="mr-2 shrink-0 tabular-nums text-muted-foreground">{duracaoCurta(l.i) || "0:00"}</span>
                <span className="min-w-0 [overflow-wrap:anywhere]">{l.texto}</span>
              </li>
            ))}
          </ol>
          <div className="flex min-w-0 flex-wrap items-center">
            <button type="button" className={juntar(botao.discreto, "mb-1 mr-1 h-8 px-2 text-[12px]")} onClick={() => void baixarLegenda(arquivo, "srt", caminhoDaLegenda("srt"), urlDaLegenda("srt"))} disabled={!caminhoDaLegenda("srt") && !urlDaLegenda("srt")} aria-label="Baixar SRT">
              <Download className="mr-1.5 h-3.5 w-3.5" />
              SRT
            </button>
            <button type="button" className={juntar(botao.discreto, "mb-1 mr-3 h-8 px-2 text-[12px]")} onClick={() => void baixarLegenda(arquivo, "vtt", caminhoDaLegenda("vtt"), urlDaLegenda("vtt"))} disabled={!caminhoDaLegenda("vtt") && !urlDaLegenda("vtt")} aria-label="Baixar VTT">
              <Download className="mr-1.5 h-3.5 w-3.5" />
              VTT
            </button>
            {doEditor && !amostra && (
              <>
                <SeletorCompacto rotulo="Estilo da legenda gravada" className="mb-1 mr-1" valor={estilo} onEscolher={(v) => setEstilo(v === "caixa" ? "caixa" : "simples")} opcoes={ESTILOS} />
                <button type="button" className={juntar(botao.primario, "mb-1 h-8")} disabled={!!ocupado} onClick={() => void gravar()} title="Nova versão com a legenda gravada, renderizada pela máquina da agência (sem custo de IA).">
                  {ocupado === "gravar" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Gravar no vídeo
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/** `troca`: o seletor das partes do Editar, na linha do título. */
export default function Finais({ troca }: { troca?: ReactNode } = {}) {
  const { clientId } = useMesa();
  const arquivosQ = useArquivosDeVideo(clientId);
  const dados = arquivosQ.data;
  const todos = useMemo(() => ((dados && dados.arquivos) || []).filter((a) => a.estado !== "arquivado" && !a.so_no_storage), [dados]);
  const finais = useMemo(() => agruparVariantes(todos.filter((a) => naEntradaDaEdicao(a) && (categoriaDoArquivo(a) === "exportado" || categoriaDoArquivo(a) === "tratado"))), [todos]);
  return (
    <Secao
      titulo="Finais"
      descricao={dados ? `${finais.length} ${finais.length === 1 ? "vídeo pronto" : "vídeos prontos"}` : undefined}
      ajuda="Os vídeos prontos (render do editor e entregas) e o antes e depois dos tratados. Baixar salva o vídeo no computador; no celular, Salvar no celular guarda na galeria. Abrir no Workspace leva à pasta Vídeos / título / Finais, onde o vídeo pronto entra sozinho. Gerar legenda faz o SRT e o VTT do corte final, com os tempos certos depois dos cortes, e guarda ao lado do vídeo e no Workspace. Gravar no vídeo faz uma nova versão com a legenda gravada, renderizada pela máquina da agência."
      divisoria
      acao={troca}
    >
      {arquivosQ.isLoading ? (
        <Carregando linhas={3} rotulo="Lendo os vídeos prontos" />
      ) : !finais.length ? (
        <EstadoVazio compacto titulo="Nenhum vídeo pronto ainda." descricao="Renderize no editor ou trate um vídeo na Entrada." />
      ) : (
        <ul className="divide-y divide-border" aria-label="Vídeos prontos">
          {finais.map((g) => (
            <LinhaDoFinal key={g.chave} arquivo={g.principal} variantes={g.variantes.slice(1)} antes={categoriaDoArquivo(g.principal) === "tratado" ? antesDoTratado(g.principal, todos) : null} />
          ))}
        </ul>
      )}
    </Secao>
  );
}
