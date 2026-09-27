import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { MiniaturaDoStorage } from "@/components/mesa/ContextoMiniatura";
import Secao from "@/components/sistema/Secao";
import { EstadoVazio } from "@/components/sistema/Estados";
import { botao, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { ESTADOS_EM_ANDAMENTO, TIPOS_DO_GERADOR } from "@/lib/mesa-videos/api";
import { motorPorId } from "../../../supabase/functions/_shared/modelos-de-video";
import { provedorCancela } from "../../../supabase/functions/_shared/video-executor";
import { gravarMiniaturaDoVideo } from "@/lib/mesa-videos/quadros";
import { chamarMesaVideos, chaveDosArquivos, chaveDosPedidos, usePedidos, type ArquivoDeVideo, type PedidoDeVideo } from "./videosApi";

/**
 * Gerações recentes (frente V-A, Resultados): o andamento de cada pedido do
 * gerador (variações), com custo. SEM LAÇO: ao abrir, UMA consulta dos
 * pedidos em andamento; depois só o botão "Conferir". Vídeo pronto sem
 * miniatura ganha a sua aqui (primeiro quadro, no navegador).
 * Frente V-C (26/09): avatar falando (HeyGen) aparece com o próprio nome; na
 * Runway e na Higgsfield dá para cancelar o que ainda não terminou (uma
 * chamada, nada cobrado do que foi cancelado).
 */

const ROTULO: Record<string, string> = {
  enviado: "Na fila",
  gerando: "Gerando",
  baixando: "Guardando",
  pronto: "Pronto",
  parcial: "Parte pronta",
  erro: "Erro",
  cancelado: "Cancelado",
};

const ROTULO_DO_TIPO: Record<string, string> = { gerar_livre: "Livre", gerar_plano: "Plano do roteiro", angulo: "Ângulo", continuar_video: "Continuação", transicao: "Transição" };

interface Envio {
  n: number;
  estado: string;
  erro: string | null;
  posicao: number | null;
  storage_path: string | null;
  custo_usd: number | null;
}

const enviosDe = (p: PedidoDeVideo): Envio[] => {
  const r = (p as unknown as { resultado?: { envios?: Envio[] } }).resultado;
  return r && Array.isArray(r.envios) ? r.envios : [];
};

const CHAVE_DAS_MINIATURAS = "mesa-videos:miniaturas-feitas";
function miniaturaFeita(id: string): boolean {
  try {
    return (window.localStorage.getItem(CHAVE_DAS_MINIATURAS) || "").indexOf(id) >= 0;
  } catch {
    return false;
  }
}
function marcarMiniatura(id: string) {
  try {
    const atual = (window.localStorage.getItem(CHAVE_DAS_MINIATURAS) || "").split(",").filter(Boolean).slice(-300);
    atual.push(id);
    window.localStorage.setItem(CHAVE_DAS_MINIATURAS, atual.join(","));
  } catch {
    /* sem armazenamento: tenta de novo na próxima visita */
  }
}

export default function GeracoesRecentes({ arquivos }: { arquivos: ArquivoDeVideo[] }) {
  const { clientId, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const pedidosQ = usePedidos(clientId);
  const [conferindo, setConferindo] = useState<string | null>(null);
  const jaConferiu = useRef(false);
  const pedidos = ((pedidosQ.data && pedidosQ.data.itens) || []).filter((p) => TIPOS_DO_GERADOR.indexOf(p.tipo as string) >= 0).slice(0, 30);
  const emAndamento = pedidos.filter((p) => ESTADOS_EM_ANDAMENTO.indexOf(p.estado as string) >= 0);

  const cancelar = async (pedidoId: string) => {
    setConferindo(pedidoId);
    try {
      const r = await chamarMesaVideos<{ cancelados?: number }>({ acao: "gerar_cancelar", pedido_id: pedidoId });
      void queryClient.invalidateQueries({ queryKey: chaveDosPedidos(clientId) });
      if (r && r.cancelados) toast.success("Cancelado", { description: "Nada foi cobrado do que foi cancelado." });
      else toast.warning("Não deu para cancelar", { description: "Já começou a gerar. Quando terminar, aparece aqui." });
    } catch (e) {
      toast.error("Não foi possível cancelar", { description: textoDoErro(e) });
    } finally {
      setConferindo(null);
    }
  };

  const conferir = async (pedidoId: string | null) => {
    setConferindo(pedidoId || "todos");
    try {
      await chamarMesaVideos(pedidoId ? { acao: "gerar_status", pedido_id: pedidoId } : { acao: "gerar_status_cliente", client_id: clientId });
      void queryClient.invalidateQueries({ queryKey: chaveDosPedidos(clientId) });
      void queryClient.invalidateQueries({ queryKey: chaveDosArquivos(clientId) });
      atualizarCusto();
    } catch (e) {
      if (pedidoId) toast.error("Não foi possível conferir", { description: textoDoErro(e) });
    } finally {
      setConferindo(null);
    }
  };

  // Uma consulta ao abrir (só se há algo em andamento). Nunca repete sozinha.
  useEffect(() => {
    if (jaConferiu.current || !emAndamento.length) return;
    jaConferiu.current = true;
    void conferir(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emAndamento.length]);

  // Vídeo gerado sem quadro inicial não tem miniatura (o servidor não decodifica vídeo):
  // grava do primeiro quadro, uma vez por vídeo (lembrado no navegador).
  const semMiniatura = pedidos
    .filter((p) => !(p.parametros as { quadro_inicial_path?: string | null }).quadro_inicial_path && (p.tipo as string) !== "angulo")
    .reduce<string[]>((l, p) => l.concat(enviosDe(p).map((e) => e.storage_path || "").filter(Boolean)), []);
  useEffect(() => {
    arquivos
      .filter((a) => a.tipo === "gerado" && semMiniatura.indexOf(a.storage_path) >= 0 && !miniaturaFeita(a.id))
      .slice(0, 4)
      .forEach((a) => {
        marcarMiniatura(a.id);
        void gravarMiniaturaDoVideo(a.storage_bucket || "mesa", a.storage_path);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arquivos, semMiniatura.join("|")]);

  if (!pedidos.length) return null;
  return (
    <Secao
      titulo="Gerações"
      descricao={`${emAndamento.length} em andamento`}
      ajuda="Cada pedido mostra as variações. A consulta ao provedor só acontece quando você abre esta etapa ou toca em Conferir. Erro não é tentado de novo sozinho e não é cobrado."
      acao={
        <button type="button" className={botao.secundario} disabled={!!conferindo || !emAndamento.length} onClick={() => void conferir(null)} aria-label="Conferir as gerações em andamento">
          {conferindo === "todos" ? <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-1.5" /> : <RefreshCw className="h-3.5 w-3.5 sm:mr-1.5" />}
          <span className="hidden sm:inline">Conferir</span>
        </button>
      }
      data-geracoes=""
    >
      <ul className="divide-y divide-border" aria-label="Gerações">
        {pedidos.map((p) => {
          const envios = enviosDe(p);
          const custo = p.custo_estimado && typeof (p.custo_estimado as { usd?: number }).usd === "number" ? (p.custo_estimado as { usd: number }).usd : null;
          const alvo = p.alvo as { titulo?: string; motor?: string; modo?: string };
          const motorDoPedido = motorPorId(p.executor);
          const podeCancelar = ESTADOS_EM_ANDAMENTO.indexOf(p.estado as string) >= 0 && (p.estado as string) !== "baixando" && !!motorDoPedido && provedorCancela(motorDoPedido.provedor);
          const par = p.parametros as { prompt?: string };
          return (
            <li key={p.id} className="flex min-w-0 items-start py-2.5" data-geracao={p.id}>
              <div className="mr-2 flex shrink-0">
                {envios.slice(0, 4).map((e) => (
                  <span key={e.n} className="relative mr-1 block w-10 overflow-hidden rounded bg-muted" style={{ paddingBottom: "3.25rem" }} title={e.erro || ROTULO[e.estado] || e.estado}>
                    {e.storage_path ? <MiniaturaDoStorage bucket="mesa" caminho={e.storage_path} alt={`Variação ${e.n}`} className="absolute inset-0 h-full w-full" /> : null}
                  </span>
                ))}
              </div>
              <div className="mr-2 min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">
                  {alvo.modo === "avatar" ? "Avatar falando" : ROTULO_DO_TIPO[p.tipo as string] || p.tipo} · {alvo.titulo || alvo.motor || p.executor}
                </p>
                <p className={juntar(texto.auxiliar, "truncate")} title={par.prompt || ""}>
                  {envios.filter((e) => e.estado === "pronto").length} de {envios.length} prontas{custo !== null ? ` · US$ ${custo.toFixed(2).replace(".", ",")}` : ""}
                  {envios.find((e) => e.erro) ? ` · ${(envios.find((e) => e.erro) as Envio).erro}` : ""}
                </p>
              </div>
              <span className={juntar(etiqueta, "mr-1", (p.estado as string) === "erro" ? "bg-destructive/10 text-destructive" : (p.estado as string) === "pronto" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{ROTULO[p.estado as string] || p.estado}</span>
              {ESTADOS_EM_ANDAMENTO.indexOf(p.estado as string) >= 0 && (
                <button type="button" className={botao.icone} disabled={!!conferindo} onClick={() => void conferir(p.id)} aria-label={`Conferir ${alvo.titulo || "pedido"}`} title={(p.estado as string) === "baixando" ? "Baixar de novo" : "Conferir"}>
                  {conferindo === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                </button>
              )}
              {podeCancelar && (
                <button type="button" className={juntar(botao.icone, "ml-1")} disabled={!!conferindo} onClick={() => void cancelar(p.id)} aria-label={`Cancelar ${alvo.titulo || "pedido"}`} title="Cancelar no provedor">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {!pedidos.length && <EstadoVazio compacto titulo="Nada gerado ainda." />}
    </Secao>
  );
}
