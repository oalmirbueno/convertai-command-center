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
import { botao, campo, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { ehPedidoDeVideo, MOVIMENTOS_DE_CAMERA, ROTULO_DO_ESTADO_DO_PEDIDO } from "../../../supabase/functions/mesa-videos/modulos/pedidos-de-video";
import { duracaoNoMotor, duracoesDoMotor, motorDoNivel, motorPorId, resolucaoNoMotor, type NivelDoMotor, type RequisitoDoPedido } from "../../../supabase/functions/mesa-videos/modulos/modelos-de-video";
import { custoNaTela, ESTADOS_EM_ANDAMENTO, motoresProntos, novoUid, TIPOS_DO_GERADOR, useMotoresDaMesa } from "@/lib/mesa-videos/api";
import { AvisoDeAtivacao } from "./Comuns";
import { MODOS_DO_GERAR, modoDoGerarValido, type ModoDoGerar } from "./modosDoGerar";
import { BotaoDeGerar, SeletorDeCamera, SeletorDeMotor } from "./PecasDoGerador";
import { movimentoDaMesaNaHiggsfield } from "../../../supabase/functions/mesa-videos/modulos/video-provedor-higgsfield";

// Frente V-A: os outros jeitos de gerar (baixam só quando abertos).
const GeradorLivre = lazy(() => import("./GeradorLivre"));
const FerramentaDeAngulo = lazy(() => import("./FerramentaDeAngulo"));
const ContinuarVideo = lazy(() => import("./ContinuarVideo"));
const AntesEDepois = lazy(() => import("./AntesEDepois"));
// Frente V-C: HeyGen (avatar falando).
const AvatarFalando = lazy(() => import("./AvatarFalando"));
import type { IrPara } from "./MesaDeVideo";
import { chamarMesaVideos, chaveDosPedidos, fotoDaCenaNoAcervo, useHistorias, usePedidos, useRoteirosAprovados, useVinculos, type PedidoDeVideo } from "./videosApi";

/**
 * Gerar (Mesa Vídeos). "Cena do roteiro": escolher a cena (da História ou de
 * um roteiro aprovado), o MOTOR do catálogo de vídeo (Normal, Top ou Rápido,
 * pelo fal), a duração e a resolução que ele aceita, a câmera, o formato e o
 * áudio, com o custo à vista; "Gerar por US$ X" confirma e gera de verdade
 * (cena_gerar). A foto da cena é o primeiro quadro; sem foto, gera pelo texto.
 *
 * Frente Q (26/09): antes esta parte só "preparava pedido" (executor "em
 * breve"), porque procurava motor de vídeo no catálogo de texto/imagem
 * (ia_modelos), que nunca teve. Agora usa o mesmo catálogo de motores do
 * gerador livre (MOTORES_DE_VIDEO + video_motores + estado da chave no
 * servidor). Pedidos antigos preparados continuam na fila para cancelar.
 *
 * Frente V-C (26/09): Runway e Higgsfield aparecem na lista de motores
 * (escolha manual); com a Higgsfield, a Câmera vira a lista de movimentos
 * prontos dela. Modo novo "Avatar falando" (HeyGen).
 */

interface Rascunho {
  origem: string;
  nivel: NivelDoMotor;
  motor: string;
  duracao: number;
  resolucao: string;
  movimento: string;
  formato: string;
  audio: boolean;
  variacoes: number;
  fala: string;
  trilha: string;
  efeitos: string;
  /** Movimento pronto da Higgsfield (frente V-C); vazio = o equivalente do movimento da mesa. */
  camera?: string;
}

const RASCUNHO_VAZIO: Rascunho = { origem: "", nivel: "normal", motor: "", duracao: 5, resolucao: "", movimento: "parada", formato: "9:16", audio: false, variacoes: 1, fala: "", trilha: "", efeitos: "", camera: "" };

interface Origem {
  valor: string;
  rotulo: string;
  grupo: "historia" | "roteiro";
  foto: { storage_bucket: string; storage_path: string } | null;
  fala: string;
  descricao: string;
  /** Referência curta da cena (plano_ref do pedido, até 8 letras). */
  ref: string | null;
}

const ROTULO_DO_ANDAMENTO: Record<string, string> = { enviado: "Na fila", gerando: "Gerando", baixando: "Guardando", parcial: "Parte pronta" };

/** A foto da cena serve de primeiro quadro? (só caminho do cliente no bucket mesa, regra do servidor). */
export function fotoUsavel(foto: Origem["foto"], clientId: string): string | null {
  if (!foto || (foto.storage_bucket || "mesa") !== "mesa") return null;
  return foto.storage_path.indexOf(`${clientId}/`) === 0 ? foto.storage_path : null;
}

/** Texto do que acontece na cena (vai no prompt do motor). `semCamera`: o motor recebe a câmera pronta à parte (Higgsfield). */
export function promptDaCena(o: Pick<Origem, "rotulo" | "descricao">, r: Pick<Rascunho, "movimento" | "fala" | "trilha" | "efeitos">, semCamera = false): string {
  const mov = MOVIMENTOS_DE_CAMERA.find((m) => m.valor === r.movimento);
  const partes = [
    o.descricao ? o.descricao : o.rotulo,
    semCamera ? "" : mov && mov.valor !== "parada" ? `Câmera: ${mov.rotulo.toLowerCase()}.` : "Câmera parada.",
    r.fala.trim() ? `Fala: "${r.fala.trim()}".` : "",
    r.trilha.trim() ? `Trilha: ${r.trilha.trim()}.` : "",
    r.efeitos.trim() ? `Efeitos: ${r.efeitos.trim()}.` : "",
  ];
  return partes.filter(Boolean).join(" ").slice(0, 2400);
}

function PedidoNaFila({ pedido }: { pedido: PedidoDeVideo }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const [cancelando, setCancelando] = useState(false);
  const p = pedido.parametros || {};
  const a = pedido.alvo || {};
  const antigo = ehPedidoDeVideo(pedido.tipo);
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
  const tituloNovo = String((pedido as unknown as { titulo?: unknown }).titulo || a.titulo || "Vídeo");
  const nome = antigo ? `${a.numero ? `${String(a.numero)}. ` : ""}${String(a.titulo || (pedido.tipo === "gerar_cena" ? "Cena do roteiro" : "Cena"))}` : tituloNovo;
  const rotulo = antigo ? (pedido.estado === "em_breve" ? "Preparado antes do gerador" : ROTULO_DO_ESTADO_DO_PEDIDO[pedido.estado] || pedido.estado) : ROTULO_DO_ANDAMENTO[pedido.estado as string] || String(pedido.estado);
  return (
    <li className="flex min-w-0 items-center py-2" data-pedido={pedido.id}>
      <div className="mr-2 min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{nome}</p>
        <p className={juntar(texto.auxiliar, "truncate")}>
          {antigo ? `${String(p.duracao_s || "")} s · ${(MOVIMENTOS_DE_CAMERA.find((m) => m.valor === p.movimento) || { rotulo: "câmera parada" }).rotulo}${p.modelo ? ` · ${String(p.modelo)}` : ""}` : String(pedido.executor || "")}
        </p>
      </div>
      <span className={juntar(etiqueta, "mr-1 bg-muted text-muted-foreground")}>{rotulo}</span>
      {antigo && (
        <button type="button" className={botao.icone} onClick={() => void cancelar()} disabled={cancelando} aria-label={`Cancelar pedido de ${nome}`}>
          {cancelando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
        </button>
      )}
    </li>
  );
}

export default function EtapaGerar({ irPara }: { irPara: IrPara }) {
  const { clientId, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const historiasQ = useHistorias(clientId);
  const roteirosQ = useRoteirosAprovados(clientId);
  const vinculosQ = useVinculos(clientId);
  const fotosQ = useFotos(clientId);
  const pedidosQ = usePedidos(clientId);
  const motores = useMotoresDaMesa();
  const [r, setR] = useEstadoDaTela<Rascunho>(`mesa-videos:gerar:${clientId}`, RASCUNHO_VAZIO, { validar: (v) => !!v && typeof v === "object", esperaMs: 300 });
  const rc: Rascunho = { ...RASCUNHO_VAZIO, ...r };
  const mudar = (m: Partial<Rascunho>) => setR((x) => ({ ...RASCUNHO_VAZIO, ...x, ...m }));
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
        saida.push({ valor: `cena:${c.canvas_id}:${c.no_id}`, rotulo: `${h.nome} · ${c.numero}. ${c.titulo || "Cena"}`, grupo: "historia", foto, fala: c.narrativa || "", descricao: c.acao || "", ref: `c${c.numero}`.slice(0, 8) });
      }),
    );
    const vinculos = (vinculosQ.data && vinculosQ.data.itens) || [];
    ((roteirosQ.data && roteirosQ.data.roteiros) || []).forEach((rot) =>
      rot.cenas.forEach((c) => {
        // Cena do roteiro ligada a uma cena da História com foto: a foto é o primeiro quadro; senão, gera pelo texto.
        const v = vinculos.find((x) => x.roteiro_id === rot.id && x.cena_ref === c.ref);
        const ligada = v ? saida.find((o) => o.valor === `cena:${v.canvas_id}:${v.no_id}`) : null;
        saida.push({ valor: `roteiro:${rot.id}:${c.ref}`, rotulo: `${rot.titulo} · ${c.ordem}. ${c.titulo || "Cena"}`, grupo: "roteiro", foto: ligada ? ligada.foto : null, fala: c.fala || "", descricao: c.visual || "", ref: String(c.ref || "").slice(0, 8) || null });
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

  const origem = origens.find((o) => o.valor === rc.origem) || null;
  const quadro = origem ? fotoUsavel(origem.foto, clientId) : null;
  const requisito: RequisitoDoPedido = { modo: quadro ? "primeiro_quadro" : "texto", formato: rc.formato };
  const prontos = motores.semFuncao || motores.carregando ? undefined : motoresProntos(motores.lista);
  const motor = motorPorId(rc.motor, motores.motores) || motorDoNivel(rc.nivel, requisito, motores.motores, prontos) || motorDoNivel(rc.nivel, requisito, motores.motores);
  const duracoes = motor ? duracoesDoMotor(motor) : [5];
  const duracao = motor ? duracaoNoMotor(motor, rc.duracao) : rc.duracao;
  const resolucao = motor ? resolucaoNoMotor(motor, rc.resolucao) : "";
  const audio = !!(motor && motor.cap.audio && rc.audio);
  const custo = custoNaTela(motor, { duracao_s: duracao, resolucao, audio, variacoes: rc.variacoes });
  const estado = motor ? motores.lista.find((x) => x.motor.id === motor.id) || null : null;
  // Motor com câmera pronta (Higgsfield): o movimento escolhido ou o equivalente do movimento da mesa.
  const cameraPronta = motor && motor.cap.camera ? rc.camera || movimentoDaMesaNaHiggsfield(rc.movimento) || "" : "";
  const motivo = !origem
    ? "Escolha a cena."
    : !motor
      ? "Nenhum motor faz isso neste nível."
      : estado && estado.estado !== "pronto" && estado.estado !== "a_conferir"
        ? `${motor.rotulo}: ${estado.estado_rotulo.toLowerCase()}${estado.chave ? ` (${estado.chave})` : ""}.`
        : null;
  const fila = ((pedidosQ.data && pedidosQ.data.itens) || []).filter(
    (p) => (ehPedidoDeVideo(p.tipo) && p.estado !== "cancelado") || (TIPOS_DO_GERADOR.indexOf(p.tipo as string) >= 0 && ESTADOS_EM_ANDAMENTO.indexOf(p.estado as string) >= 0),
  );
  const carregando = historiasQ.isLoading || roteirosQ.isLoading;

  const gerar = async (usd: number) => {
    if (!origem || !motor) return;
    const resp = await chamarMesaVideos<{ pedido_id: string }>({
      acao: "cena_gerar",
      tipo: "gerar_plano",
      client_id: clientId,
      motor: motor.id,
      modo: quadro ? "primeiro_quadro" : "texto",
      prompt: promptDaCena(origem, rc, !!cameraPronta),
      duracao_s: duracao,
      formato: rc.formato,
      resolucao,
      audio,
      variacoes: rc.variacoes,
      quadro_inicial_path: quadro,
      camera: cameraPronta || null,
      plano_ref: origem.ref,
      titulo: origem.rotulo.slice(0, 120),
      uid: novoUid(),
      custo_confirmado_usd: usd,
    });
    void queryClient.invalidateQueries({ queryKey: chaveDosPedidos(clientId) });
    atualizarCusto();
    toast.success("Cena enviada para gerar", { description: `Pedido ${String(resp.pedido_id || "").slice(0, 8)}. Acompanhe nos Resultados.` });
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
            {modo === "avatar" && <AvatarFalando />}
          </Suspense>
        </Secao>
      ) : (
        <Secao
          acao={seletorDoModo}
          titulo="Gerar vídeo"
          descricao={motor ? `${motor.rotulo}${estado ? ` · ${estado.estado_rotulo}` : ""}` : undefined}
          ajuda="Escolha a cena, o motor e a câmera. A foto da cena é o primeiro quadro; sem foto, o motor gera pelo texto da cena. O custo aparece antes e só é cobrado o que ficar pronto."
          data-gerar=""
        >
          {pedidosQ.data && !pedidosQ.data.disponivel && <AvisoDeAtivacao>Pedidos de vídeo ainda não foram ativados no banco (SQL V2-01).</AvisoDeAtivacao>}
          {motores.semFuncao && <AvisoDeAtivacao>Não deu para conferir as chaves dos motores agora. O servidor confere de novo ao gerar.</AvisoDeAtivacao>}
          {carregando ? (
            <Carregando linhas={4} rotulo="Lendo as cenas" />
          ) : !origens.length ? (
            <EstadoVazio
              icone={<Clapperboard className="h-5 w-5" />}
              titulo="Nenhuma cena para gerar"
              descricao="Monte a História no Canvas, aprove um roteiro ou use o modo Livre."
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
                  <CampoDeFormulario rotulo="Cena" apoio={origem ? (quadro ? "A foto da cena é o primeiro quadro." : origem.foto ? "A foto está fora da pasta do cliente: gera pelo texto." : "Sem foto: gera pelo texto da cena.") : undefined}>
                    <select
                      className={campo}
                      value={origem ? origem.valor : ""}
                      onChange={(e) => {
                        const o = origens.find((x) => x.valor === e.target.value);
                        mudar({ origem: e.target.value, fala: o ? o.fala : "", motor: "" });
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

              <SeletorDeMotor lista={motores.lista} requisito={requisito} valor={motor ? motor.id : ""} nivel={rc.nivel} onNivel={(n) => mudar({ nivel: n, motor: "" })} onEscolher={(id) => mudar({ motor: id })} />

              <GrupoDeCampos>
                <CampoDeFormulario rotulo="Duração">
                  <select className={campo} value={duracao} onChange={(e) => mudar({ duracao: Number(e.target.value) })} aria-label="Duração da cena">
                    {duracoes.map((d) => (
                      <option key={d} value={d}>
                        {d} s
                      </option>
                    ))}
                  </select>
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Resolução">
                  <select className={campo} value={resolucao} onChange={(e) => mudar({ resolucao: e.target.value })} aria-label="Resolução">
                    {(motor ? motor.resolucoes : []).map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </select>
                </CampoDeFormulario>
                {motor && motor.cap.camera ? (
                  <SeletorDeCamera rotulo="Câmera" valor={cameraPronta} onEscolher={(v) => mudar({ camera: v })} />
                ) : (
                  <CampoDeFormulario rotulo="Câmera">
                    <select className={campo} value={rc.movimento} onChange={(e) => mudar({ movimento: e.target.value })} aria-label="Movimento de câmera">
                      {MOVIMENTOS_DE_CAMERA.map((m) => (
                        <option key={m.valor} value={m.valor}>
                          {m.rotulo}
                        </option>
                      ))}
                    </select>
                  </CampoDeFormulario>
                )}
                <div className="min-w-0">
                  <p className={juntar(texto.rotulo, "mb-1.5")}>Formato</p>
                  <SeletorCompacto rotulo="Formato" larguraTotal opcoes={(motor ? motor.formatos : ["9:16", "16:9", "1:1"]).map((f) => ({ valor: f, rotulo: f }))} valor={rc.formato} onEscolher={(v) => mudar({ formato: v, motor: "" })} />
                </div>
                <div className="min-w-0">
                  <p className={juntar(texto.rotulo, "mb-1.5")}>Variações</p>
                  <SeletorCompacto rotulo="Variações" larguraTotal opcoes={[1, 2, 3, 4].map((n) => ({ valor: String(n), rotulo: String(n) }))} valor={String(rc.variacoes)} onEscolher={(v) => mudar({ variacoes: Number(v) })} />
                </div>
                {motor && motor.cap.audio && (
                  <label className="flex min-w-0 items-center self-end pb-2 text-[13px]">
                    <input type="checkbox" className="mr-2 h-4 w-4 accent-primary" checked={rc.audio} onChange={(e) => mudar({ audio: e.target.checked })} />
                    Áudio do motor
                  </label>
                )}
                <CampoDeFormulario rotulo="Fala da cena" largo>
                  <input className={campo} value={rc.fala} maxLength={400} onChange={(e) => mudar({ fala: e.target.value })} placeholder="Opcional" />
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Trilha">
                  <input className={campo} value={rc.trilha} maxLength={200} onChange={(e) => mudar({ trilha: e.target.value })} placeholder="Opcional" />
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Efeitos">
                  <input className={campo} value={rc.efeitos} maxLength={200} onChange={(e) => mudar({ efeitos: e.target.value })} placeholder="Opcional" />
                </CampoDeFormulario>
              </GrupoDeCampos>

              <BotaoDeGerar custo={custo} motivo={motivo} onConfirmar={gerar} icone={<Clapperboard className="mr-1.5 h-3.5 w-3.5" />} extra={`${motor ? motor.rotulo : ""}, ${duracao} s, ${rc.variacoes} ${rc.variacoes === 1 ? "variação" : "variações"}`} />
            </div>
          )}
        </Secao>
      )}

      <Secao
        titulo="Na fila"
        descricao={pedidosQ.isLoading ? undefined : `${fila.length} ${fila.length === 1 ? "pedido" : "pedidos"}`}
        recolher={`mesa-videos:fila:${clientId}`}
        resumo={pedidosQ.isLoading ? undefined : `${fila.length} ${fila.length === 1 ? "pedido" : "pedidos"}`}
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
          <EstadoVazio compacto titulo="Nada gerando agora." descricao="O que ficar pronto aparece nos Resultados." />
        )}
      </Secao>
    </div>
  );
}
