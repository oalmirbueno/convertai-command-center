import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, Clock3, History, Loader2, RefreshCw, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { ErroDaMesa, textoDoErro, usd } from "@/lib/mesa/api";
import { botao, juntar, texto } from "@/components/sistema/estilos";
import { MiniaturaDoStorage } from "./ContextoMiniatura";
import { useMesa } from "./MesaContexto";
import { chamarMesaVideos, chaveDosArquivos, chaveDosPedidos, type PedidoDeVideo } from "@/components/mesa-videos/videosApi";
import { motorPorId } from "../../../supabase/functions/mesa-videos/modulos/modelos-de-video";
import { provedorCancela } from "../../../supabase/functions/mesa-videos/modulos/video-executor";
import { podeRecuperar, proximaConferencia, type EnvioRecuperavel } from "../../../supabase/functions/mesa-videos/modulos/coleta-de-video";
import { corpoDeTentarDeNovo, enviosDoPedido, ordenarPedidos, podeTentarDeNovo, situacaoDoPedido, type LeituraDoPedido } from "./estadoDaGeracao";

/**
 * As gerações de vídeo da pauta (27/10/2026), no lugar do "Gerando" sem tempo nem saída:
 * - cada pedido diz o estado em palavras (na fila, gerando com o tempo que falta, guardando, pronto, falhou com o
 *   motivo, parte pronta) e a barra pelo tempo típico do motor;
 * - com a aba à vista, o painel pergunta ao provedor sozinho (20 s, dobrando até 2 min) só pelos pedidos desta
 *   pauta; com a aba escondida, a coleta do servidor (1 min) guarda o que ficar pronto. O pronto entra sozinho na
 *   prancheta e no player (a lista de arquivos é relida);
 * - falhou: "Tentar de novo" com o custo antes (a tentativa que falhou não foi cobrada; a chave tentar-<pedido>
 *   impede gerar duas vezes no duplo clique); parado no provedor: "Recuperar" (não gera de novo); Runway e
 *   Higgsfield: cancelar.
 * compacta: só o que anda ou falhou (embaixo da peça); a aba Gerações mostra todos.
 */

const ICONE: Record<LeituraDoPedido["situacao"], typeof Clock3> = {
  na_fila: Clock3,
  gerando: Loader2,
  guardando: Loader2,
  pronto: CheckCircle2,
  parcial: CircleAlert,
  falhou: CircleAlert,
  cancelado: X,
};

const ANDANDO = ["enviado", "gerando", "baixando"];

function useAgora(ativo: boolean) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (!ativo) return;
    const t = window.setInterval(() => setAgora(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, [ativo]);
  return agora;
}

/** conferirSozinho: só uma lista da tela pergunta ao provedor (a outra só mostra), para não consultar em dobro. */
export default function GeracoesDaPauta({ pedidos, compacta = false, titulo = "Gerações", conferirSozinho = true }: { pedidos: PedidoDeVideo[]; compacta?: boolean; titulo?: string; conferirSozinho?: boolean }) {
  const { clientId, atualizarCusto } = useMesa();
  const qc = useQueryClient();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [tentar, setTentar] = useState<{ pedidoId: string; corpo: Record<string, unknown>; custo: number } | null>(null);
  const andando = pedidos.filter((p) => ANDANDO.indexOf(String(p.estado)) >= 0);
  const agora = useAgora(andando.length > 0);
  const lista = ordenarPedidos(compacta ? pedidos.filter((p) => ANDANDO.indexOf(String(p.estado)) >= 0 || ["erro", "parcial"].indexOf(String(p.estado)) >= 0).slice(0, 4) : pedidos.slice(0, 30));

  const reler = () => {
    void qc.invalidateQueries({ queryKey: chaveDosPedidos(clientId) });
    void qc.invalidateQueries({ queryKey: chaveDosArquivos(clientId) });
  };

  // Conferência automática só dos pedidos desta pauta (não custa: consultar o provedor é de graça).
  const tentativa = useRef(0);
  const assinatura = andando.map((p) => `${p.id}:${String(p.estado)}`).join("|");
  const [rodada, setRodada] = useState(0);
  useEffect(() => {
    tentativa.current = 0;
  }, [assinatura]);
  useEffect(() => {
    const espera = conferirSozinho ? proximaConferencia(tentativa.current, andando.length) : null;
    if (espera === null) return;
    let vivo = true;
    const t = window.setTimeout(async () => {
      tentativa.current += 1;
      const visivel = typeof document === "undefined" || document.visibilityState !== "hidden";
      if (visivel) await Promise.allSettled(andando.slice(0, 6).map((p) => chamarMesaVideos({ acao: "gerar_status", pedido_id: p.id })));
      if (!vivo) return;
      reler();
      atualizarCusto();
      setRodada((n) => n + 1);
    }, espera);
    return () => {
      vivo = false;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura, rodada, clientId]);

  const conferir = async (id: string) => {
    setOcupado(id);
    try {
      await chamarMesaVideos({ acao: "gerar_status", pedido_id: id });
      reler();
      atualizarCusto();
    } catch (e) {
      toast.error("Não foi possível conferir", { description: textoDoErro(e) });
    } finally {
      setOcupado(null);
    }
  };

  const recuperar = async (id: string) => {
    setOcupado(id);
    try {
      const r = await chamarMesaVideos<{ pedidos?: PedidoDeVideo[] }>({ acao: "gerar_reconferir", pedido_id: id });
      reler();
      atualizarCusto();
      const p = r && r.pedidos && r.pedidos[0];
      if (p && String(p.estado) === "pronto") toast.success("Recuperado", { description: "O provedor tinha terminado: o vídeo entrou na prancheta." });
      else toast.message("Perguntei de novo ao provedor", { description: "Quando terminar, aparece aqui." });
    } catch (e) {
      toast.error("Não foi possível recuperar", { description: textoDoErro(e) });
    } finally {
      setOcupado(null);
    }
  };

  const cancelar = async (id: string) => {
    setOcupado(id);
    try {
      const r = await chamarMesaVideos<{ cancelados?: number }>({ acao: "gerar_cancelar", pedido_id: id });
      reler();
      if (r && r.cancelados) toast.success("Cancelado", { description: "Nada foi cobrado do que foi cancelado." });
      else toast.warning("Não deu para cancelar", { description: "Já começou a gerar. Quando terminar, aparece aqui." });
    } catch (e) {
      toast.error("Não foi possível cancelar", { description: textoDoErro(e) });
    } finally {
      setOcupado(null);
    }
  };

  // Tentar de novo: primeiro o servidor diz o custo (409 confirmar_custo); a pessoa confirma.
  const pedirCustoDeTentar = async (p: PedidoDeVideo) => {
    const corpo = corpoDeTentarDeNovo(p);
    if (!corpo) return;
    setOcupado(p.id);
    try {
      const r = await chamarMesaVideos<{ pedido_id?: string; ja_existia?: boolean }>(corpo);
      // Sem custo a confirmar (a chave já existia): o pedido novo já está na lista.
      reler();
      if (r && r.ja_existia) toast.message("Esta tentativa já tinha sido pedida", { description: "Ela aparece na lista." });
    } catch (e) {
      if (e instanceof ErroDaMesa && e.codigo === "confirmar_custo") {
        const c = (e.detalhes || {}).custo_estimado as { usd?: unknown } | undefined;
        setTentar({ pedidoId: p.id, corpo, custo: Number(c && c.usd) || 0 });
      } else toast.error("Não deu para tentar de novo", { description: textoDoErro(e) });
    } finally {
      setOcupado(null);
    }
  };

  const confirmarTentar = async () => {
    if (!tentar) return;
    setOcupado(tentar.pedidoId);
    try {
      await chamarMesaVideos({ ...tentar.corpo, custo_confirmado_usd: tentar.custo });
      setTentar(null);
      reler();
      atualizarCusto();
      toast.success("Enviado de novo", { description: "Acompanhe aqui: o pronto entra sozinho na prancheta." });
    } catch (e) {
      toast.error("Não deu para tentar de novo", { description: textoDoErro(e) });
    } finally {
      setOcupado(null);
    }
  };

  if (!lista.length) {
    if (compacta) return null;
    return <p className={texto.auxiliar} data-geracoes-da-pauta="vazia">Nada gerado ainda. O resultado entra sozinho aqui e na prancheta.</p>;
  }

  return (
    <section className="min-w-0" aria-label={titulo} data-geracoes-da-pauta={compacta ? "compacta" : "todas"}>
      <div className="mb-1 flex min-w-0 items-center">
        <p className={juntar(texto.rotulo, "min-w-0 flex-1 truncate")}>
          {titulo}
          {andando.length ? <span className="ml-1 font-normal text-muted-foreground">· {andando.length} em andamento</span> : null}
        </p>
      </div>
      <ul className="min-w-0 divide-y divide-border">
        {lista.map((p) => {
          const motor = motorPorId(String((p.alvo as { motor?: string }).motor || p.executor));
          const l = situacaoDoPedido(p, agora, motor);
          const Icone = ICONE[l.situacao];
          const envios = enviosDoPedido(p) as unknown as EnvioRecuperavel[];
          const recuperavel = String(p.estado) !== "baixando" && envios.some((e) => podeRecuperar(e, agora));
          const podeCancelar = ["enviado", "gerando"].indexOf(String(p.estado)) >= 0 && !!motor && provedorCancela(motor.provedor);
          const alvo = p.alvo as { titulo?: string };
          const primeiro = (p.parametros as { quadro_inicial_path?: string | null }).quadro_inicial_path;
          const cor = l.situacao === "falhou" || l.situacao === "parcial" ? "text-destructive" : l.situacao === "pronto" ? "text-success" : l.atrasado ? "text-warning" : "text-muted-foreground";
          return (
            <li key={p.id} className="flex min-w-0 items-start py-2" data-geracao-da-pauta={p.id} data-situacao={l.situacao}>
              <span className="relative mr-2 block h-12 w-9 shrink-0 overflow-hidden rounded bg-muted">
                {primeiro ? <MiniaturaDoStorage bucket="mesa" caminho={primeiro} alt="" largura={96} className="absolute inset-0 h-full w-full" /> : null}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium" title={alvo.titulo || ""}>{alvo.titulo || (motor ? motor.rotulo : "Vídeo")}</p>
                <p className={juntar("flex min-w-0 items-center text-[12px]", cor)} role={l.situacao === "falhou" ? "alert" : "status"}>
                  <Icone className={juntar("mr-1 h-3.5 w-3.5 shrink-0", (l.situacao === "gerando" || l.situacao === "guardando") && "animate-spin")} aria-hidden="true" />
                  <span className="shrink-0 font-medium">{l.rotulo}</span>
                </p>
                <p className={juntar(texto.auxiliar, "[overflow-wrap:anywhere]")} title={enviosDoPedido(p).map((e) => e.erro).filter(Boolean).join(" ") || undefined}>{l.detalhe}{motor ? ` · ${motor.rotulo}` : ""}</p>
                {l.progresso !== null && (
                  <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <span className={juntar("block h-full rounded-full", l.atrasado ? "bg-warning" : "bg-primary")} style={{ width: `${Math.round(l.progresso * 100)}%` }} />
                  </span>
                )}
                {tentar && tentar.pedidoId === p.id && (
                  <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1" role="group" aria-label="Confirmar o custo de tentar de novo">
                    <span className={juntar(texto.auxiliar, "min-w-0 flex-1")}>Tentar de novo custa {usd(tentar.custo)}. A tentativa que falhou não foi cobrada.</span>
                    <button type="button" className={juntar(botao.discreto, "h-7 px-2 text-[12px]")} onClick={() => setTentar(null)} disabled={ocupado === p.id}>Cancelar</button>
                    <button type="button" className={juntar(botao.primario, "h-7 px-2 text-[12px]")} onClick={() => void confirmarTentar()} disabled={ocupado === p.id}>
                      {ocupado === p.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
                      Confirmar {usd(tentar.custo)}
                    </button>
                  </div>
                )}
              </div>
              <div className="ml-1 flex shrink-0 items-center">
                {ANDANDO.indexOf(String(p.estado)) >= 0 && (
                  <button type="button" className={botao.icone} disabled={!!ocupado} onClick={() => void conferir(p.id)} aria-label="Conferir agora" title="Conferir agora no provedor (não gera de novo)">
                    {ocupado === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
                  </button>
                )}
                {recuperavel && (
                  <button type="button" className={botao.icone} disabled={!!ocupado} onClick={() => void recuperar(p.id)} aria-label="Recuperar" title="Recuperar: perguntar de novo ao provedor (não gera outra vez)">
                    <History className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
                {podeTentarDeNovo(p) && !recuperavel && (
                  <button type="button" className={botao.icone} disabled={!!ocupado || !!tentar} onClick={() => void pedirCustoDeTentar(p)} aria-label="Tentar de novo" title="Tentar de novo (mostra o custo antes; a que falhou não foi cobrada)" data-tentar-de-novo={p.id}>
                    {ocupado === p.id && !tentar ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
                  </button>
                )}
                {podeCancelar && (
                  <button type="button" className={botao.icone} disabled={!!ocupado} onClick={() => void cancelar(p.id)} aria-label="Cancelar" title="Cancelar no provedor">
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
