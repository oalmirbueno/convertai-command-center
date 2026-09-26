import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, Check, Film, Loader2, Scissors, Undo2, Upload } from "lucide-react";
import { toast } from "sonner";
import { useMesa, useUrlDaMesa } from "@/components/mesa/MesaContexto";
import { textoDoErro } from "@/lib/mesa/api";
import Secao from "@/components/sistema/Secao";
import { Carregando, EstadoDeErro, EstadoVazio } from "@/components/sistema/Estados";
import { botao, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { ehPedidoDeVideo } from "../../../supabase/functions/_shared/pedidos-de-video";
import { AvisoDeAtivacao } from "./Comuns";
import type { IrPara } from "./MesaDeVideo";
import { chamarMesaVideos, chaveDosArquivos, duracaoCurta, subirVideos, tamanhoCurto, useArquivosDeVideo, usePedidos, type ArquivoDeVideo } from "./videosApi";
import GeracoesRecentes from "./GeracoesRecentes";
import AngulosGerados from "./AngulosGerados";

/**
 * Resultados (Mesa Vídeos, frente E2): os vídeos gerados (pelo motor, quando
 * houver, ou gerados fora e subidos aqui como "gerado"). Aprovar manda o vídeo
 * para a Entrada da Mesa Edição (Desfazer na hora); arquivar não apaga. O
 * agente ao lado também propõe mandar todos de uma vez, com confirmação.
 */

function Previa({ arquivo }: { arquivo: ArquivoDeVideo }) {
  const url = useUrlDaMesa(arquivo.storage_path, arquivo.storage_bucket);
  return (
    <div className="relative w-full overflow-hidden rounded-md bg-muted" style={{ paddingBottom: "125%" }}>
      {url.data ? (
        <video src={url.data} controls preload="metadata" playsInline className="absolute inset-0 h-full w-full bg-black object-contain" />
      ) : url.isLoading ? null : (
        <p className={juntar(texto.auxiliar, "absolute inset-x-2 top-2")}>Não abriu agora.</p>
      )}
    </div>
  );
}

function Resultado({ arquivo }: { arquivo: ArquivoDeVideo }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const [ocupado, setOcupado] = useState(false);
  const recarregar = () => void queryClient.invalidateQueries({ queryKey: chaveDosArquivos(clientId) });
  const naEdicao = !!arquivo.edicao_desde;

  const editar = async (campos: Record<string, unknown>, titulo: string, desfazer: Record<string, unknown>) => {
    setOcupado(true);
    try {
      await chamarMesaVideos({ acao: "arquivo_editar", arquivo_id: arquivo.id, campos });
      recarregar();
      toast.success(titulo, {
        action: {
          label: "Desfazer",
          onClick: () => {
            void chamarMesaVideos({ acao: "arquivo_editar", arquivo_id: arquivo.id, campos: desfazer }).then(recarregar, (e) => toast.error("Não foi possível desfazer", { description: textoDoErro(e) }));
          },
        },
      });
    } catch (e) {
      toast.error("Não foi possível mudar", { description: textoDoErro(e), duration: 9000 });
    } finally {
      setOcupado(false);
    }
  };

  const detalhes = [duracaoCurta(arquivo.duracao_s), arquivo.largura && arquivo.altura ? `${arquivo.largura}x${arquivo.altura}` : "", tamanhoCurto(arquivo.bytes)].filter(Boolean);
  return (
    <li className="min-w-0" data-resultado={arquivo.id}>
      <Previa arquivo={arquivo} />
      <p className="mt-1.5 truncate text-[12.5px] font-medium" title={arquivo.nome_original}>
        {arquivo.nome}
      </p>
      <p className={juntar(texto.auxiliar, "truncate")}>{detalhes.join(" · ") || "Gerado"}</p>
      <div className="mt-1.5 flex min-w-0 items-center">
        {naEdicao ? (
          <>
            <span className={juntar(etiqueta, "mr-1 bg-primary/10 text-primary")} data-na-edicao="">
              Na Edição
            </span>
            <button type="button" className={juntar(botao.icone, "ml-auto")} disabled={ocupado} onClick={() => void editar({ na_edicao: false }, "Saiu da Edição", { na_edicao: true })} aria-label={`Tirar ${arquivo.nome} da Edição`} title="Tirar da Edição">
              <Undo2 className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={juntar(botao.secundario, "h-8 px-2.5 text-[12.5px]")}
              disabled={ocupado || !!arquivo.so_no_storage}
              onClick={() => void editar({ na_edicao: true }, "Aprovado e na Edição", { na_edicao: false })}
              aria-label={`Aprovar ${arquivo.nome} e mandar para a Edição`}
            >
              {ocupado ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
              Aprovar
            </button>
            <button
              type="button"
              className={juntar(botao.icone, "ml-auto")}
              disabled={ocupado || !!arquivo.so_no_storage}
              onClick={() => void editar({ estado: "arquivado" }, "Arquivado", { estado: "ativo" })}
              aria-label={`Arquivar ${arquivo.nome}`}
              title="Arquivar (não apaga)"
            >
              <Archive className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </li>
  );
}

export default function EtapaResultados({ irPara }: { irPara: IrPara }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const arquivosQ = useArquivosDeVideo(clientId);
  const pedidosQ = usePedidos(clientId);
  const [subindo, setSubindo] = useState<{ feitos: number; total: number } | null>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const arquivos = (arquivosQ.data && arquivosQ.data.arquivos) || [];
  const gerados = arquivos.filter((a) => a.tipo === "gerado" && a.estado !== "arquivado");
  const naEdicao = gerados.filter((a) => a.edicao_desde).length;
  const naFila = ((pedidosQ.data && pedidosQ.data.itens) || []).filter((p) => ehPedidoDeVideo(p.tipo) && p.estado !== "cancelado").length;

  const enviar = async (lista: FileList | null) => {
    const novos = lista ? (Array.prototype.slice.call(lista) as File[]) : [];
    if (!novos.length) return;
    setSubindo({ feitos: 0, total: novos.length });
    try {
      const r = await subirVideos(clientId, novos, (feitos, total) => setSubindo({ feitos, total }), { tipo: "gerado" });
      void queryClient.invalidateQueries({ queryKey: chaveDosArquivos(clientId) });
      if (r.aviso) toast.warning("Subiu, falta registrar", { description: r.aviso, duration: 9000 });
      else toast.success("Resultados enviados", { description: `${r.registrados.length} novos${r.duplicados.length ? `, ${r.duplicados.length} já estavam` : ""}${r.recusados.length ? `, ${r.recusados.length} não subiram` : ""}.` });
    } finally {
      setSubindo(null);
      if (entrada.current) entrada.current.value = "";
    }
  };

  return (
    <div className="min-w-0 space-y-5 pb-6">
      <Secao
        titulo="Resultados"
        descricao={`${gerados.length} ${gerados.length === 1 ? "vídeo" : "vídeos"} · ${naEdicao} na Edição · ${naFila} na fila`}
        ajuda="Vídeos gerados por IA. Aprovar manda para a Entrada da Mesa Edição. Vídeo gerado fora (no site do modelo) pode subir aqui: ele entra marcado como gerado."
        acao={
          <>
            <input ref={entrada} type="file" multiple accept="video/*,.mov,.mp4,.webm" className="hidden" aria-label="Escolher vídeos gerados" onChange={(e) => void enviar(e.target.files)} />
            <button type="button" className={botao.secundario} disabled={!!subindo} onClick={() => entrada.current && entrada.current.click()} aria-label="Subir vídeo gerado">
              {subindo ? <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-1.5" /> : <Upload className="h-3.5 w-3.5 sm:mr-1.5" />}
              <span className="hidden sm:inline">{subindo ? `${subindo.feitos} de ${subindo.total}` : "Subir"}</span>
            </button>
            {naEdicao > 0 && (
              <Link to={`/mesa-edicao?client=${clientId}&etapa=entrada`} className={botao.primario} aria-label="Abrir na Mesa Edição">
                <Scissors className="h-3.5 w-3.5 sm:mr-1.5" />
                <span className="hidden sm:inline">Editar</span>
              </Link>
            )}
          </>
        }
      >
        {arquivosQ.data && arquivosQ.data.degradado && <AvisoDeAtivacao>O acervo de vídeo ainda não foi ativado no banco (SQL V2-01): aprovar espera a ativação.</AvisoDeAtivacao>}
        {arquivosQ.isLoading ? (
          <Carregando forma="grade" linhas={4} rotulo="Lendo os resultados" />
        ) : arquivosQ.isError ? (
          <EstadoDeErro
            titulo="Não foi possível ler os resultados."
            acao={
              <button type="button" className={botao.secundario} onClick={() => void arquivosQ.refetch()}>
                Tentar de novo
              </button>
            }
          />
        ) : gerados.length ? (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 desk:grid-cols-6" aria-label="Vídeos gerados">
            {gerados.map((a) => (
              <Resultado key={a.id} arquivo={a} />
            ))}
          </ul>
        ) : (
          <EstadoVazio
            icone={<Film className="h-5 w-5" />}
            titulo="Nenhum vídeo gerado ainda"
            descricao={naFila ? `${naFila} ${naFila === 1 ? "pedido está" : "pedidos estão"} na fila, esperando o motor de vídeo.` : "Prepare um pedido em Gerar ou suba um vídeo gerado fora."}
            acao={
              <button type="button" className={botao.secundario} onClick={() => irPara("gerar")}>
                Gerar
              </button>
            }
          />
        )}
      </Secao>
      {/* Frente V-A: andamento das gerações (sem laço) e as imagens de ângulo e quadros. */}
      <GeracoesRecentes arquivos={arquivos} />
      <AngulosGerados arquivos={arquivos} irPara={irPara} />
    </div>
  );
}
