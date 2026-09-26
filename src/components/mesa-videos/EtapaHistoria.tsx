import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Clapperboard, ExternalLink, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useMesa } from "@/components/mesa/MesaContexto";
import { MiniaturaDoStorage } from "@/components/mesa/ContextoMiniatura";
import { textoDoErro } from "@/lib/mesa/api";
import { Cartao, Vazio } from "@/components/mesa-foto/Comuns";
import { useFotos } from "@/components/mesa-foto/fotoApi";
import {
  DURACAO_MAX_S,
  DURACAO_MIN_S,
  DURACAO_PADRAO_S,
  estimarPedido,
  executorDoPedido,
  MOVIMENTOS_DE_CAMERA,
  normalizarParametros,
  ROTULO_DO_ESTADO_DO_PEDIDO,
  textoDaEstimativa,
  type ParametrosDoAnimar,
} from "../../../supabase/functions/_shared/pedidos-de-video";
import { AvisoDeAtivacao } from "./Comuns";
import {
  chamarMesaVideos,
  chaveDosPedidos,
  fotoDaCenaNoAcervo,
  useHistorias,
  usePedidos,
  type CenaDaHistoriaNoBanco,
  type PedidoDeVideo,
} from "./videosApi";

/**
 * História do Canvas na Mesa Vídeos (docs/mesa-videos/CONTRATO.md): as cenas
 * na ordem da view foto_cenas_da_historia, com a foto de cada uma (o 1º
 * quadro do vídeo). "Animar cena" prepara o pedido com duração, câmera e
 * áudio e mostra o custo estimado; o executor fica "em breve" enquanto não
 * houver motor de vídeo no catálogo. Preparar não gasta.
 */

const DURACOES = (() => {
  const s: number[] = [];
  for (let i = DURACAO_MIN_S; i <= DURACAO_MAX_S; i++) s.push(i);
  return s;
})();

const campo = "h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-[12px]";

function FormularioDoAnimar({ cena, onFechar }: { cena: CenaDaHistoriaNoBanco; onFechar: () => void }) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const [duracao, setDuracao] = useState(DURACAO_PADRAO_S);
  const [movimento, setMovimento] = useState("parada");
  const [fala, setFala] = useState(cena.narrativa || "");
  const [trilha, setTrilha] = useState("");
  const [efeitos, setEfeitos] = useState("");
  const [enviando, setEnviando] = useState(false);

  const params = normalizarParametros("animar_cena", { duracao_s: duracao, movimento, audio: { fala, trilha, efeitos } }) as ParametrosDoAnimar;
  const executor = executorDoPedido("animar_cena", catalogo.map((m) => ({ id: m.id, tipo: m.tipo, ativo: m.ativo, rotulo: m.rotulo })));
  const estimativa = estimarPedido("animar_cena", { ...params, motor_video: executor.executor === "em_breve" ? null : executor.executor });

  const preparar = async () => {
    setEnviando(true);
    try {
      const r = await chamarMesaVideos<{ pedido: PedidoDeVideo; ja_existia: boolean }>({
        acao: "pedido_preparar",
        client_id: clientId,
        tipo: "animar_cena",
        alvo: { canvas_id: cena.canvas_id, no_id: cena.no_id },
        parametros: params,
      });
      void queryClient.invalidateQueries({ queryKey: chaveDosPedidos(clientId) });
      toast.success(r.ja_existia ? "Este pedido já estava preparado" : "Pedido preparado", {
        description: executor.executor === "em_breve" ? "Nada foi gerado nem cobrado. O motor de vídeo chega em breve." : "Nada foi gerado ainda. Falta confirmar com o custo à vista.",
      });
      onFechar();
    } catch (e) {
      toast.error("Não foi possível preparar", { description: textoDoErro(e), duration: 9000 });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="mt-2 rounded-lg border border-border bg-background p-3" data-animar-cena={cena.no_id}>
      <div className="grid min-w-0 gap-2 sm:grid-cols-2">
        <label className="min-w-0 text-[11px] text-muted-foreground">
          Duração
          <select className={campo} value={duracao} onChange={(e) => setDuracao(Number(e.target.value))} aria-label="Duração da cena">
            {DURACOES.map((d) => (
              <option key={d} value={d}>
                {d} s
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-[11px] text-muted-foreground">
          Câmera
          <select className={campo} value={movimento} onChange={(e) => setMovimento(e.target.value)} aria-label="Movimento de câmera">
            {MOVIMENTOS_DE_CAMERA.map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.rotulo}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-[11px] text-muted-foreground sm:col-span-2">
          Fala da cena
          <input className={campo} value={fala} maxLength={400} onChange={(e) => setFala(e.target.value)} placeholder="Opcional" />
        </label>
        <label className="min-w-0 text-[11px] text-muted-foreground">
          Trilha
          <input className={campo} value={trilha} maxLength={200} onChange={(e) => setTrilha(e.target.value)} placeholder="Opcional" />
        </label>
        <label className="min-w-0 text-[11px] text-muted-foreground">
          Efeitos
          <input className={campo} value={efeitos} maxLength={200} onChange={(e) => setEfeitos(e.target.value)} placeholder="Opcional" />
        </label>
      </div>
      <ul className="mt-2 space-y-0.5 text-[11.5px]" aria-label="Custo estimado">
        {estimativa.partes.map((p) => (
          <li key={p.rotulo} className="flex min-w-0 items-baseline">
            <span className="mr-2 min-w-0 flex-1 truncate" title={p.detalhe}>
              {p.rotulo}
            </span>
            <span className={p.usd === null ? "text-muted-foreground" : "font-medium"}>{p.usd === null ? "Sem cotação" : `~US$ ${p.usd.toFixed(4).replace(".", ",")}`}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground" title={estimativa.referencia}>
        Executor: {executor.rotulo}. Estimativa pela tabela de referência do kit audiovisual (25/09); mídia e render ficam fora.
      </p>
      <div className="mt-2 flex flex-wrap items-center">
        <Button type="button" size="sm" className="mb-1 mr-1.5 h-8" onClick={() => void preparar()} disabled={enviando}>
          {enviando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Clapperboard className="mr-1.5 h-3.5 w-3.5" />}
          Preparar pedido
          <span className="ml-1.5 rounded-full bg-black/10 px-1.5 py-px text-[10.5px] font-normal opacity-80 dark:bg-white/10">{textoDaEstimativa(estimativa)}</span>
        </Button>
        <Button type="button" size="sm" variant="ghost" className="mb-1 h-8 text-muted-foreground" onClick={onFechar} disabled={enviando}>
          Fechar
        </Button>
        <span className="mb-1 ml-auto text-[11px] text-muted-foreground">Preparar não gera nem cobra.</span>
      </div>
    </div>
  );
}

function PedidoDaCena({ pedido }: { pedido: PedidoDeVideo }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const [cancelando, setCancelando] = useState(false);
  const p = pedido.parametros || {};
  const cancelar = async () => {
    setCancelando(true);
    try {
      await chamarMesaVideos({ acao: "pedido_cancelar", pedido_id: pedido.id });
      void queryClient.invalidateQueries({ queryKey: chaveDosPedidos(clientId) });
    } catch (e) {
      toast.error("Não foi possível cancelar", { description: textoDoErro(e) });
    } finally {
      setCancelando(false);
    }
  };
  return (
    <li className="flex min-w-0 items-center text-[11.5px]" data-pedido={pedido.id}>
      <span className="mr-1.5 shrink-0 rounded bg-muted px-1.5 py-px text-[10.5px]">{ROTULO_DO_ESTADO_DO_PEDIDO[pedido.estado] || pedido.estado}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {String(p.duracao_s || "")} s · {(MOVIMENTOS_DE_CAMERA.find((m) => m.valor === p.movimento) || { rotulo: "câmera parada" }).rotulo}
      </span>
      {pedido.estado !== "cancelado" && (
        <button type="button" className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground" onClick={() => void cancelar()} disabled={cancelando} aria-label="Cancelar pedido">
          {cancelando ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
        </button>
      )}
    </li>
  );
}

export default function EtapaHistoria() {
  const { clientId } = useMesa();
  const historiasQ = useHistorias(clientId);
  const fotosQ = useFotos(clientId);
  const pedidosQ = usePedidos(clientId);
  const [aberta, setAberta] = useState<string | null>(null);
  const historias = (historiasQ.data && historiasQ.data.historias) || [];
  const pedidos = (pedidosQ.data && pedidosQ.data.itens) || [];
  const pedidosDaCena = useMemo(() => {
    const m: Record<string, PedidoDeVideo[]> = {};
    pedidos
      .filter((p) => p.tipo === "animar_cena" && p.estado !== "cancelado")
      .forEach((p) => {
        const k = `${String(p.alvo.canvas_id)}:${String(p.alvo.no_id)}`;
        (m[k] = m[k] || []).push(p);
      });
    return m;
  }, [pedidos]);

  if (historiasQ.isLoading) return <div className="h-40 animate-pulse rounded-xl bg-muted" aria-busy="true" />;
  if (historiasQ.data && !historiasQ.data.disponivel) {
    return <AvisoDeAtivacao>A História do Canvas ainda não está no banco (SQL V-01 da Mesa Foto). As cenas aparecem aqui quando ele for aplicado.</AvisoDeAtivacao>;
  }
  if (!historias.length) {
    return (
      <Vazio
        titulo="Nenhuma história ainda"
        acao={
          <Link to={`/mesa-foto?client=${clientId}&etapa=canvas`} className="inline-flex items-center text-[12.5px] font-medium text-primary hover:underline">
            Montar no Canvas da Mesa Foto <ExternalLink className="ml-1 h-3 w-3" />
          </Link>
        }
      >
        No Canvas, marque os Resultados como cenas e ordene a história. Ela aparece aqui do mesmo jeito.
      </Vazio>
    );
  }

  return (
    <div className="space-y-4">
      {pedidosQ.data && !pedidosQ.data.disponivel && <AvisoDeAtivacao>Pedidos de vídeo ainda não foram ativados no banco (SQL V2-01). Dá para ver as cenas; preparar pedido espera a ativação.</AvisoDeAtivacao>}
      {historias.map((h) => (
        <Cartao
          key={h.canvas_id}
          titulo={h.nome}
          dica={h.sinopse || "O mesmo Canvas da Mesa Foto: a foto de cada cena é o primeiro quadro do vídeo."}
          acao={
            <Link to={`/mesa-foto?client=${clientId}&etapa=canvas`} className="inline-flex h-8 items-center rounded-md px-2 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground">
              Abrir no Canvas <ExternalLink className="ml-1 h-3 w-3" />
            </Link>
          }
        >
          <ol className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={`Cenas de ${h.nome}`}>
            {h.cenas.map((c) => {
              const foto = fotoDaCenaNoAcervo(c, fotosQ.data || []);
              const chave = `${c.canvas_id}:${c.no_id}`;
              const lista = pedidosDaCena[chave] || [];
              return (
                <li key={chave} className="min-w-0 rounded-lg border border-border p-2" data-cena-da-historia={c.no_id}>
                  <div className="flex min-w-0">
                    <div className="mr-2 h-20 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
                      {foto ? <MiniaturaDoStorage bucket={foto.storage_bucket} caminho={foto.storage_path} alt={`Cena ${c.numero}`} className="h-full w-full" /> : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium">
                        {c.numero}. {c.titulo || "Cena"}
                      </p>
                      {c.acao && <p className="line-clamp-2 text-[11.5px] text-muted-foreground">{c.acao}</p>}
                      {c.narrativa && <p className="line-clamp-2 text-[11px] italic text-muted-foreground">{c.narrativa}</p>}
                    </div>
                  </div>
                  {lista.length > 0 && <ul className="mt-1.5 space-y-0.5">{lista.map((p) => <PedidoDaCena key={p.id} pedido={p} />)}</ul>}
                  {aberta === chave ? (
                    <FormularioDoAnimar cena={c} onFechar={() => setAberta(null)} />
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-2 h-8 w-full"
                      disabled={!foto}
                      title={foto ? "Preparar o pedido de vídeo desta cena" : "A cena ainda não tem foto"}
                      onClick={() => setAberta(chave)}
                    >
                      <Clapperboard className="mr-1.5 h-3.5 w-3.5" />
                      {foto ? "Animar cena" : "Sem foto ainda"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ol>
        </Cartao>
      ))}
    </div>
  );
}
