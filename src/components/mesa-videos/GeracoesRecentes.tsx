import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { History, Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { MiniaturaDoStorage } from "@/components/mesa/ContextoMiniatura";
import Secao from "@/components/sistema/Secao";
import { EstadoVazio } from "@/components/sistema/Estados";
import { botao, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { ESTADOS_EM_ANDAMENTO, TIPOS_DO_GERADOR } from "@/lib/mesa-videos/api";
import { motorPorId } from "../../../supabase/functions/mesa-videos/modulos/modelos-de-video";
import { provedorCancela } from "../../../supabase/functions/mesa-videos/modulos/video-executor";
import { podeRecuperar, proximaConferencia, type EnvioRecuperavel } from "../../../supabase/functions/mesa-videos/modulos/coleta-de-video";
import { gravarMiniaturaDoVideo } from "@/lib/mesa-videos/quadros";
import { chamarMesaVideos, chaveDosArquivos, chaveDosPedidos, usePedidos, type ArquivoDeVideo, type PedidoDeVideo } from "./videosApi";

/**
 * Gerações recentes (frente V-A, Resultados): o andamento de cada pedido do
 * gerador (variações), com custo. Vídeo pronto sem miniatura ganha a sua aqui
 * (primeiro quadro, no navegador).
 * Frente VGN (30/09): com a tela aberta e visível, confere sozinha enquanto há
 * pedido em andamento (20 s, dobrando até 2 min; consultar o provedor não
 * custa); com a tela fechada, a coleta do servidor (cron de 1 min) guarda o
 * que ficar pronto. O que venceu o prazo aqui pode ser recuperado (pergunta de
 * novo ao provedor, sem gerar outra vez).
 * Frente V-C (26/09): avatar falando (HeyGen) aparece com o próprio nome; na
 * Runway e na Higgsfield dá para cancelar o que ainda não terminou (uma
 * chamada, nada cobrado do que foi cancelado).
 * Frente MTR (30/09): a variação que passou do prazo segue conferida até 24 h
 * (com aviso); a que venceu e ainda tem o pedido no provedor ganha
 * "Conferir de novo" (uma consulta; pronto lá, baixa e cobra). É o mesmo botão
 * Recuperar da frente VGN: uma regra (podeRecuperar) e uma ação no servidor.
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

interface Envio extends EnvioRecuperavel {
  n: number;
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

export default function GeracoesRecentes({ arquivos, taskId, criativoId, pedidosIds = [] }: { arquivos: ArquivoDeVideo[]; taskId?: string; criativoId?: string; pedidosIds?: string[] }) {
  const { clientId, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const pedidosQ = usePedidos(clientId);
  const [conferindo, setConferindo] = useState<string | null>(null);
  // Sobe a cada conferência automática que falha: reagenda mesmo sem a lista mudar.
  const [falhasDaConferencia, setFalhasDaConferencia] = useState(0);
  const jaConferiu = useRef(false);
  const pedidos = ((pedidosQ.data && pedidosQ.data.itens) || []).filter((p) => TIPOS_DO_GERADOR.indexOf(p.tipo as string) >= 0 && (!criativoId || p.parametros.ads_criativo_id === criativoId) && (!taskId || p.parametros.task_id === taskId || pedidosIds.includes(p.id))).slice(0, 30);
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

  // "Recuperar" (frente VGN) e "Conferir de novo" (frente MTR) são a mesma ação no servidor:
  // gerar_reconferir = gerar_recuperar. Pergunta de novo ao provedor, sem gerar outra vez.
  const recuperar = async (pedidoId: string) => {
    setConferindo(pedidoId);
    try {
      const r = await chamarMesaVideos<{ pedidos?: PedidoDeVideo[] }>({ acao: "gerar_reconferir", pedido_id: pedidoId });
      void queryClient.invalidateQueries({ queryKey: chaveDosPedidos(clientId) });
      void queryClient.invalidateQueries({ queryKey: chaveDosArquivos(clientId) });
      atualizarCusto();
      const p = r && r.pedidos && r.pedidos[0];
      if (p && (p.estado as string) === "pronto") toast.success("Recuperado", { description: "O provedor tinha terminado: o vídeo foi guardado no acervo." });
      else if (p && (p.estado as string) === "erro") toast.warning("Não deu para recuperar", { description: enviosDe(p).map((e) => e.erro).filter(Boolean)[0] || "O provedor não tem mais este resultado." });
      else toast.message("Perguntando ao provedor", { description: "Ainda está gerando. Quando terminar, aparece aqui." });
    } catch (e) {
      toast.error("Não foi possível recuperar", { description: textoDoErro(e) });
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
      else {
        // Conferência automática que falhou (rede, 5xx): avisa uma vez e agenda a próxima com o mesmo recuo.
        toast.warning("A conferência automática falhou", { id: "mesa-videos-conferir-auto", description: `${textoDoErro(e)} Tento de novo sozinho; o servidor também confere a cada minuto.` });
        setFalhasDaConferencia((n) => n + 1);
      }
    } finally {
      setConferindo(null);
    }
  };

  // Uma consulta ao abrir (só se há algo em andamento).
  useEffect(() => {
    if (jaConferiu.current || !emAndamento.length) return;
    jaConferiu.current = true;
    void conferir(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emAndamento.length]);

  // Frente VGN: enquanto houver pedido em andamento e a aba estiver visível, confere de novo
  // (20 s, 40 s, 80 s, até 2 min). Aba escondida não consulta: a coleta do servidor cobre.
  const tentativa = useRef(0);
  // "parcial" é pronto + erro: nada mais a perguntar ao provedor.
  const gerandoAgora = emAndamento.filter((p) => (p.estado as string) !== "parcial");
  const assinaturaDoAndamento = gerandoAgora.map((p) => `${p.id}:${String(p.estado)}`).join("|");
  useEffect(() => {
    tentativa.current = 0;
  }, [assinaturaDoAndamento]);
  useEffect(() => {
    const espera = proximaConferencia(tentativa.current, gerandoAgora.length);
    if (espera === null) return;
    const t = window.setTimeout(() => {
      tentativa.current += 1;
      let visivel = true;
      try {
        visivel = document.visibilityState !== "hidden";
      } catch {
        /* sem a API: considera visível */
      }
      if (visivel && !conferindo) void conferir(null);
      else void queryClient.invalidateQueries({ queryKey: chaveDosPedidos(clientId) });
    }, espera);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinaturaDoAndamento, pedidosQ.dataUpdatedAt, falhasDaConferencia]);

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
      divisoria
      titulo="Gerações"
      descricao={`${emAndamento.length} em andamento`}
      recolher={`mesa-videos:geracoes:${clientId}`}
      resumo={`${pedidos.length} ${pedidos.length === 1 ? "pedido" : "pedidos"} · ${emAndamento.length} em andamento`}
      ajuda="Cada pedido mostra as variações. Com esta etapa aberta, o painel confere sozinho enquanto algo está gerando; com ela fechada, o servidor confere a cada minuto e guarda o vídeo pronto no acervo. Passou do prazo, segue sendo conferido por até 24 h. Erro do provedor não é tentado de novo e não é cobrado. O que parou aqui e ainda está no provedor tem Recuperar (Conferir de novo): o painel pergunta de novo ao provedor, sem gerar outra vez."
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
          // Uma regra só para "Recuperar" e "Conferir de novo" (podeRecuperar = podeReconferir).
          // Pedido em erro, parcial ou com uma variação parada enquanto outra ainda gera (nunca no meio do download).
          const recuperavel = (p.estado as string) !== "baixando" && envios.some((e) => podeRecuperar(e, Date.now()));
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
                  {alvo.modo === "avatar" ? "Avatar falando" : alvo.modo === "labial" ? "Foto que fala" : ROTULO_DO_TIPO[p.tipo as string] || p.tipo} · {alvo.titulo || alvo.motor || p.executor}
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
              {recuperavel && (
                <button type="button" className={juntar(botao.discreto, "h-7 px-1.5 text-[12px]")} disabled={!!conferindo} onClick={() => void recuperar(p.id)} aria-label={`Conferir de novo e recuperar ${alvo.titulo || "pedido"}`} title="Conferir de novo no provedor e recuperar (não gera outra vez)">
                  {conferindo === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-1" /> : <History className="h-3.5 w-3.5 sm:mr-1" />}
                  <span className="hidden sm:inline">Recuperar</span>
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
