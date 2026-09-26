import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Clapperboard, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { MiniaturaDoStorage } from "@/components/mesa/ContextoMiniatura";
import { textoDoErro } from "@/lib/mesa/api";
import { useFotos } from "@/components/mesa-foto/fotoApi";
import Secao from "@/components/sistema/Secao";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { CampoDeFormulario, GrupoDeCampos } from "@/components/sistema/Formulario";
import { Carregando, EstadoVazio } from "@/components/sistema/Estados";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campo, etiqueta, juntar, superficie, texto } from "@/components/sistema/estilos";
import {
  DURACAO_MAX_S,
  DURACAO_MIN_S,
  DURACAO_PADRAO_S,
  ehPedidoDeVideo,
  estimarPedido,
  executorDoPedido,
  MOVIMENTOS_DE_CAMERA,
  normalizarParametros,
  ROTULO_DO_ESTADO_DO_PEDIDO,
  textoDaEstimativa,
  type ParametrosDoAnimar,
} from "../../../supabase/functions/_shared/pedidos-de-video";
import { duracaoNoModelo, duracoesDoModelo, FORMATOS_DE_VIDEO, modelosDeVideo, textoDasDuracoes } from "../../../supabase/functions/_shared/modelos-de-video";
import { AvisoDeAtivacao } from "./Comuns";
import { MODOS_DO_GERAR, modoDoGerarValido, type ModoDoGerar } from "./modosDoGerar";

// Frente V-A: os outros jeitos de gerar (baixam só quando abertos).
const GeradorLivre = lazy(() => import("./GeradorLivre"));
const FerramentaDeAngulo = lazy(() => import("./FerramentaDeAngulo"));
const ContinuarVideo = lazy(() => import("./ContinuarVideo"));
const AntesEDepois = lazy(() => import("./AntesEDepois"));
import type { IrPara } from "./MesaDeVideo";
import { chamarMesaVideos, chaveDosPedidos, fotoDaCenaNoAcervo, useHistorias, usePedidos, useRoteirosAprovados, useVinculos, type PedidoDeVideo } from "./videosApi";

/**
 * Gerar (Mesa Vídeos, frente E2): escolher a cena (da História ou de um
 * roteiro aprovado), o modelo de vídeo, a duração que ele aceita, a câmera, o
 * formato e o áudio, com o custo à vista. "Preparar pedido" grava o pedido
 * sem gerar nem cobrar: nenhum motor de vídeo está ligado no catálogo
 * ia_modelos ainda; quando estiver, o pedido fica "falta confirmar". O rascunho
 * fica guardado por cliente (sair e voltar mantém).
 */

interface Rascunho {
  origem: string;
  modelo: string;
  duracao: number;
  movimento: string;
  formato: string;
  fala: string;
  trilha: string;
  efeitos: string;
}

const RASCUNHO_VAZIO: Rascunho = { origem: "", modelo: "veo-3.1", duracao: DURACAO_PADRAO_S, movimento: "parada", formato: "9:16", fala: "", trilha: "", efeitos: "" };

interface Origem {
  valor: string;
  rotulo: string;
  grupo: "historia" | "roteiro";
  foto: { storage_bucket: string; storage_path: string } | null;
  fala: string;
  descricao: string;
  /** O que vai no pedido. */
  tipo: "animar_cena" | "gerar_cena";
  alvo: Record<string, unknown>;
}

function PedidoNaFila({ pedido }: { pedido: PedidoDeVideo }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const [cancelando, setCancelando] = useState(false);
  const p = pedido.parametros || {};
  const a = pedido.alvo || {};
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
  const nome = `${a.numero ? `${String(a.numero)}. ` : ""}${String(a.titulo || (pedido.tipo === "gerar_cena" ? "Cena do roteiro" : "Cena"))}`;
  return (
    <li className="flex min-w-0 items-center py-2" data-pedido={pedido.id}>
      <div className="mr-2 min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{nome}</p>
        <p className={juntar(texto.auxiliar, "truncate")}>
          {String(p.duracao_s || "")} s · {(MOVIMENTOS_DE_CAMERA.find((m) => m.valor === p.movimento) || { rotulo: "câmera parada" }).rotulo}
          {p.modelo ? ` · ${String(p.modelo)}` : ""}
        </p>
      </div>
      <span className={juntar(etiqueta, "mr-1 bg-muted text-muted-foreground")}>{ROTULO_DO_ESTADO_DO_PEDIDO[pedido.estado] || pedido.estado}</span>
      <button type="button" className={botao.icone} onClick={() => void cancelar()} disabled={cancelando} aria-label={`Cancelar pedido de ${nome}`}>
        {cancelando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
      </button>
    </li>
  );
}

export default function EtapaGerar({ irPara }: { irPara: IrPara }) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const historiasQ = useHistorias(clientId);
  const roteirosQ = useRoteirosAprovados(clientId);
  const vinculosQ = useVinculos(clientId);
  const fotosQ = useFotos(clientId);
  const pedidosQ = usePedidos(clientId);
  const [r, setR] = useEstadoDaTela<Rascunho>(`mesa-videos:gerar:${clientId}`, RASCUNHO_VAZIO, { validar: (v) => !!v && typeof v === "object", esperaMs: 300 });
  const mudar = (m: Partial<Rascunho>) => setR((x) => ({ ...x, ...m }));
  const [enviando, setEnviando] = useState(false);
  // Frente V-A: jeito de gerar (cena do roteiro, livre, ângulo, continuar, antes e depois).
  const [modoGuardado, setModo] = useEstadoDaTela<ModoDoGerar>(`mesa-videos:gerar:modo:${clientId}`, "cena", { validar: (v) => typeof v === "string" });
  const modoNaUrl = params.get("modo");
  useEffect(() => {
    if (!modoNaUrl) return;
    setModo(modoDoGerarValido(modoNaUrl));
    const next = new URLSearchParams(params);
    next.delete("modo");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modoNaUrl]);
  const modo = modoDoGerarValido(modoGuardado);

  const origens = useMemo<Origem[]>(() => {
    const saida: Origem[] = [];
    const historias = (historiasQ.data && historiasQ.data.historias) || [];
    const fotos = fotosQ.data || [];
    historias.forEach((h) =>
      h.cenas.forEach((c) => {
        const foto = fotoDaCenaNoAcervo(c, fotos);
        if (!foto) return;
        saida.push({
          valor: `cena:${c.canvas_id}:${c.no_id}`,
          rotulo: `${h.nome} · ${c.numero}. ${c.titulo || "Cena"}`,
          grupo: "historia",
          foto,
          fala: c.narrativa || "",
          descricao: c.acao || "",
          tipo: "animar_cena",
          alvo: { canvas_id: c.canvas_id, no_id: c.no_id },
        });
      }),
    );
    const vinculos = (vinculosQ.data && vinculosQ.data.itens) || [];
    ((roteirosQ.data && roteirosQ.data.roteiros) || []).forEach((rot) =>
      rot.cenas.forEach((c) => {
        // Cena do roteiro ligada a uma cena da História com foto: anima a foto; senão, gera pelo texto.
        const v = vinculos.find((x) => x.roteiro_id === rot.id && x.cena_ref === c.ref);
        const ligada = v ? saida.find((o) => o.valor === `cena:${v.canvas_id}:${v.no_id}`) : null;
        saida.push({
          valor: `roteiro:${rot.id}:${c.ref}`,
          rotulo: `${rot.titulo} · ${c.ordem}. ${c.titulo || "Cena"}`,
          grupo: "roteiro",
          foto: ligada ? ligada.foto : null,
          fala: c.fala || "",
          descricao: c.visual || "",
          tipo: ligada ? "animar_cena" : "gerar_cena",
          alvo: ligada ? { ...ligada.alvo, roteiro_id: rot.id, cena_ref: c.ref } : { roteiro_id: rot.id, cena_ref: c.ref },
        });
      }),
    );
    return saida;
  }, [historiasQ.data, roteirosQ.data, vinculosQ.data, fotosQ.data]);

  // Vindo da Base ("Gerar" numa cena): a cena entra no rascunho e o endereço limpa.
  const pedidaNaUrl = params.get("origem");
  useEffect(() => {
    if (!pedidaNaUrl) return;
    const o = origens.find((x) => x.valor === pedidaNaUrl);
    if (!o && (historiasQ.isLoading || roteirosQ.isLoading || fotosQ.isLoading)) return;
    if (o) mudar({ origem: o.valor, fala: o.fala });
    const next = new URLSearchParams(params);
    next.delete("origem");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidaNaUrl, origens]);

  const origem = origens.find((o) => o.valor === r.origem) || null;
  const modelos = useMemo(() => modelosDeVideo(catalogo.map((m) => ({ id: m.id, tipo: m.tipo, ativo: m.ativo, rotulo: m.rotulo }))), [catalogo]);
  const modelo = modelos.find((m) => m.id === r.modelo) || modelos[0];
  const duracoes = duracoesDoModelo(modelo, { min: DURACAO_MIN_S, max: DURACAO_MAX_S });
  const duracao = duracaoNoModelo(modelo, r.duracao, { min: DURACAO_MIN_S, max: DURACAO_MAX_S });
  const tipo = origem ? origem.tipo : "animar_cena";
  const parametros = normalizarParametros(tipo, {
    duracao_s: duracao,
    movimento: r.movimento,
    formato: r.formato,
    modelo: modelo.id,
    descricao: origem ? origem.descricao : null,
    audio: { fala: r.fala, trilha: r.trilha, efeitos: r.efeitos },
  }) as ParametrosDoAnimar;
  const executor = modelo.ligado ? executorDoPedido(tipo, catalogo.map((m) => ({ id: m.id, tipo: m.tipo, ativo: m.ativo, rotulo: m.rotulo })), modelo.motor_id) : executorDoPedido(tipo, [], null);
  const estimativa = estimarPedido(tipo, { ...parametros, motor_video: executor.executor === "em_breve" ? null : executor.executor });
  const fila = ((pedidosQ.data && pedidosQ.data.itens) || []).filter((p) => ehPedidoDeVideo(p.tipo) && p.estado !== "cancelado");
  const carregando = historiasQ.isLoading || roteirosQ.isLoading;

  const preparar = async () => {
    if (!origem) return;
    setEnviando(true);
    try {
      const resp = await chamarMesaVideos<{ pedido: PedidoDeVideo; ja_existia: boolean }>({
        acao: "pedido_preparar",
        client_id: clientId,
        tipo,
        alvo: origem.alvo,
        parametros,
      });
      void queryClient.invalidateQueries({ queryKey: chaveDosPedidos(clientId) });
      toast.success(resp.ja_existia ? "Este pedido já estava preparado" : "Pedido preparado", {
        description: executor.executor === "em_breve" ? `Nada foi gerado nem cobrado. O ${modelo.rotulo} ainda não está ligado.` : "Nada foi gerado ainda. Falta confirmar com o custo à vista.",
      });
    } catch (e) {
      toast.error("Não foi possível preparar", { description: textoDoErro(e), duration: 9000 });
    } finally {
      setEnviando(false);
    }
  };

  const seletorDoModo = (
    <SeletorCompacto rotulo="Jeito de gerar" icone={<Clapperboard className="h-3.5 w-3.5" />} opcoes={MODOS_DO_GERAR.map((m) => ({ valor: m.valor, rotulo: m.rotulo, descricao: m.descricao }))} valor={modo} onEscolher={(v) => setModo(modoDoGerarValido(v))} />
  );
  const outroModo = MODOS_DO_GERAR.find((m) => m.valor === modo && m.valor !== "cena") || null;

  return (
    <div className="grid min-w-0 gap-6 pb-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
      {outroModo ? (
        <Secao titulo={outroModo.titulo} ajuda={outroModo.ajuda} acao={seletorDoModo} data-gerar-modo={modo}>
          <Suspense fallback={<Carregando linhas={4} rotulo="Abrindo" />}>
            {modo === "livre" && <GeradorLivre />}
            {modo === "angulo" && <FerramentaDeAngulo />}
            {modo === "continuar" && <ContinuarVideo />}
            {modo === "antes_depois" && <AntesEDepois />}
          </Suspense>
        </Secao>
      ) : (
      <Secao
        acao={seletorDoModo}
        titulo="Gerar vídeo"
        descricao={executor.rotulo}
        ajuda="Escolha a cena, o modelo e a câmera. Preparar grava o pedido com o custo estimado e não gera nem cobra nada. Os modelos vêm da pesquisa da casa; nenhum motor de vídeo está ligado no catálogo ainda."
        data-gerar=""
      >
        {pedidosQ.data && !pedidosQ.data.disponivel && <AvisoDeAtivacao>Pedidos de vídeo ainda não foram ativados no banco (SQL V2-01).</AvisoDeAtivacao>}
        {carregando ? (
          <Carregando linhas={4} rotulo="Lendo as cenas" />
        ) : !origens.length ? (
          <EstadoVazio
            icone={<Clapperboard className="h-5 w-5" />}
            titulo="Nenhuma cena para gerar"
            descricao="Monte a História no Canvas ou aprove um roteiro."
            acao={
              <button type="button" className={botao.secundario} onClick={() => irPara("base")}>
                Abrir a Base
              </button>
            }
          />
        ) : (
          <div className="space-y-5">
            <div className="flex min-w-0 items-start">
              <div className="mr-3 w-20 shrink-0">
                <div className="relative w-full overflow-hidden rounded-md bg-muted" style={{ paddingBottom: "125%" }}>
                  {origem && origem.foto && <MiniaturaDoStorage bucket={origem.foto.storage_bucket} caminho={origem.foto.storage_path} alt="Primeiro quadro" className="absolute inset-0 h-full w-full" />}
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <CampoDeFormulario rotulo="Cena" apoio={origem ? (origem.foto ? "A foto da cena é o primeiro quadro." : "Sem foto: o texto da cena é a base.") : undefined}>
                  <select
                    className={campo}
                    value={origem ? origem.valor : ""}
                    onChange={(e) => {
                      const o = origens.find((x) => x.valor === e.target.value);
                      mudar({ origem: e.target.value, fala: o ? o.fala : "" });
                    }}
                  >
                    <option value="">Escolha a cena</option>
                    <optgroup label="História do Canvas">
                      {origens
                        .filter((o) => o.grupo === "historia")
                        .map((o) => (
                          <option key={o.valor} value={o.valor}>
                            {o.rotulo}
                          </option>
                        ))}
                    </optgroup>
                    <optgroup label="Roteiros aprovados">
                      {origens
                        .filter((o) => o.grupo === "roteiro")
                        .map((o) => (
                          <option key={o.valor} value={o.valor}>
                            {o.rotulo}
                          </option>
                        ))}
                    </optgroup>
                  </select>
                </CampoDeFormulario>
              </div>
            </div>

            <GrupoDeCampos>
              <CampoDeFormulario rotulo="Modelo de vídeo" apoio={`${modelo.ligado ? "Ligado" : "A ligar"} · ${textoDasDuracoes(modelo)}`} ajuda={`${modelo.provedor}. ${modelo.nota}`}>
                <select className={campo} value={modelo.id} onChange={(e) => mudar({ modelo: e.target.value })}>
                  {modelos.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.rotulo}
                      {m.ligado ? "" : " (a ligar)"}
                    </option>
                  ))}
                </select>
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Duração">
                <select className={campo} value={duracao} onChange={(e) => mudar({ duracao: Number(e.target.value) })} aria-label="Duração da cena">
                  {duracoes.map((d) => (
                    <option key={d} value={d}>
                      {d} s
                    </option>
                  ))}
                </select>
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Câmera">
                <select className={campo} value={r.movimento} onChange={(e) => mudar({ movimento: e.target.value })} aria-label="Movimento de câmera">
                  {MOVIMENTOS_DE_CAMERA.map((m) => (
                    <option key={m.valor} value={m.valor}>
                      {m.rotulo}
                    </option>
                  ))}
                </select>
              </CampoDeFormulario>
              <div className="min-w-0">
                <p className={juntar(texto.rotulo, "mb-1.5")}>Formato</p>
                <SeletorCompacto rotulo="Formato" larguraTotal opcoes={FORMATOS_DE_VIDEO.map((f) => ({ valor: f, rotulo: f }))} valor={r.formato} onEscolher={(v) => mudar({ formato: v })} />
              </div>
              <CampoDeFormulario rotulo="Fala da cena" largo>
                <input className={campo} value={r.fala} maxLength={400} onChange={(e) => mudar({ fala: e.target.value })} placeholder="Opcional" />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Trilha">
                <input className={campo} value={r.trilha} maxLength={200} onChange={(e) => mudar({ trilha: e.target.value })} placeholder="Opcional" />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Efeitos">
                <input className={campo} value={r.efeitos} maxLength={200} onChange={(e) => mudar({ efeitos: e.target.value })} placeholder="Opcional" />
              </CampoDeFormulario>
            </GrupoDeCampos>

            <div className={juntar(superficie.poco, "px-3 py-2.5")} data-custo-do-pedido="">
              <ul className="space-y-1 text-[12.5px]" aria-label="Custo estimado">
                {estimativa.partes.map((p) => (
                  <li key={p.rotulo} className="flex min-w-0 items-baseline">
                    <span className="mr-2 min-w-0 flex-1 truncate" title={p.detalhe}>
                      {p.rotulo}
                    </span>
                    <span className={juntar("tabular-nums", p.usd === null ? "text-muted-foreground" : "font-medium")}>{p.usd === null ? "Sem cotação" : `~US$ ${p.usd.toFixed(4).replace(".", ",")}`}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex min-w-0 flex-wrap items-center justify-end">
              <span className={juntar(texto.auxiliar, "mr-3 min-w-0 flex-1")}>Preparar não gera nem cobra.</span>
              <button type="button" className={botao.primario} onClick={() => void preparar()} disabled={enviando || !origem}>
                {enviando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Clapperboard className="mr-1.5 h-3.5 w-3.5" />}
                Preparar pedido
                <span className="ml-1.5 text-[11.5px] font-normal opacity-80">{textoDaEstimativa(estimativa)}</span>
              </button>
            </div>
          </div>
        )}
      </Secao>
      )}

      <Secao
        titulo="Na fila"
        descricao={pedidosQ.isLoading ? undefined : `${fila.length} ${fila.length === 1 ? "pedido" : "pedidos"}`}
        acao={
          <button type="button" className={botao.discreto} onClick={() => irPara("resultados")}>
            Resultados
          </button>
        }
      >
        {pedidosQ.isLoading ? (
          <Carregando linhas={3} rotulo="Lendo a fila" />
        ) : fila.length ? (
          <ul className="divide-y divide-border" aria-label="Pedidos de vídeo">
            {fila.map((p) => (
              <PedidoNaFila key={p.id} pedido={p} />
            ))}
          </ul>
        ) : (
          <EstadoVazio compacto titulo="Nenhum pedido." descricao="Prepare o primeiro ao lado." />
        )}
      </Secao>
    </div>
  );
}
