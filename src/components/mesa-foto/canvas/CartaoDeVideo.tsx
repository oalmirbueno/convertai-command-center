import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Clapperboard, Film, LayoutTemplate, Loader2, Play, RefreshCw, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import { useMesa } from "@/components/mesa/MesaContexto";
import { MiniaturaDoStorage } from "@/components/mesa/ContextoMiniatura";
import { useAvisarErro } from "@/components/mesa/Custo";
import { BotaoDeGerar, SeletorDeCamera, SeletorDeMotor } from "@/components/mesa-videos/PecasDoGerador";
import { custoNaTela, motoresProntos, useMotoresDaMesa } from "@/lib/mesa-videos/api";
import { motorDoNivel, motorPorId, type NivelDoMotor } from "../../../../supabase/functions/mesa-videos/modulos/modelos-de-video";
import {
  EM_ANDAMENTO,
  FORMATOS_DO_VIDEO,
  lerDadosDoVideo,
  MOVIMENTOS_DE_CAMERA,
  rotuloDoEstado,
  ultimoVideo,
  type DadosDoVideo,
  type PedidoDoVideoNoCanvas,
} from "../../../../supabase/functions/mesa-foto/modulos/video-do-canvas";
import { nomeDoResultado, type Canvas, type NoDoCanvas } from "../canvasApi";
import { BOTAO, CAMPO, Escolha, ROTULO, type Fontes } from "./comum";
import { bloqueiosDoVideo, comPedidos, dadosComMotor, duracoesNaTela, entradasDoVideo, gerarVideoDoCartao, pedidoPadraoDoVideo, requisitoDoVideo } from "./videoNoCanvas";

/**
 * Cartão Vídeo do Canvas (frente CNV, 30/09): o corpo do cartão no quadro,
 * os ajustes (motor, duração, formato, câmera, áudio, pedido) com o custo
 * antes e o Gerar pela Mesa Vídeos, a lista dos pedidos com o andamento e o
 * player. O vídeo fica no acervo de vídeo (Mesa Vídeos e Edição).
 */

const aprovadasDe = (f: Fontes) => f.fotos.filter((x) => x.aprovada).map((x) => x.id);

/** Player do vídeo gerado (link assinado de 1 hora). */
export function JanelaDoVideo({ caminho, titulo, onFechar }: { caminho: string | null; titulo: string; onFechar: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (!caminho) return;
    let vivo = true;
    setUrl(null);
    setErro(null);
    void supabase.storage
      .from("mesa")
      .createSignedUrl(caminho, 3600)
      .then((r) => {
        if (!vivo) return;
        if (r.error || !r.data) setErro("Não foi possível abrir o vídeo agora.");
        else setUrl(r.data.signedUrl);
      });
    return () => {
      vivo = false;
    };
  }, [caminho]);
  return (
    <JanelaCentral aberta={!!caminho} onFechar={onFechar} titulo={titulo} icone={<Film className="h-4 w-4" />} largura="lg" data-player-do-video="">
      {erro ? (
        <p className="text-[13px] text-destructive">{erro}</p>
      ) : url ? (
        <video src={url} controls playsInline autoPlay className="mx-auto block max-h-[70vh] w-full rounded-md bg-black" />
      ) : (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}
    </JanelaCentral>
  );
}

/** O que aparece dentro do cartão Vídeo no quadro. */
export function CorpoDoVideo({ canvas, no, fontes, onVer }: { canvas: Canvas; no: NoDoCanvas; fontes: Fontes; onVer: (caminho: string) => void }) {
  const d = no.dados.video || lerDadosDoVideo({});
  const e = entradasDoVideo(canvas, no.id, aprovadasDe(fontes));
  const pronto = ultimoVideo(d);
  const andamento = d.pedidos.filter((p) => EM_ANDAMENTO.indexOf(p.estado) >= 0);
  const ultimoPedido = d.pedidos.length ? d.pedidos[d.pedidos.length - 1] : null;
  const capa = pronto && pronto.quadro_path ? pronto.quadro_path : e.inicio && e.inicio.foto ? e.inicio.foto.storage_path : null;
  const bloqueios = bloqueiosDoVideo(e, d);
  const motor = d.motor ? motorPorId(d.motor) : null;
  return (
    <div className="flex min-h-0 flex-1 flex-col px-2.5 pb-2.5" data-corpo-do-video={no.id}>
      <div className="relative shrink-0 overflow-hidden rounded-lg border border-white/10 bg-zinc-900" style={{ height: 150 }}>
        {capa ? <MiniaturaDoStorage bucket="mesa" caminho={capa} alt="1º quadro do vídeo" largura={320} className="h-full w-full" /> : null}
        {pronto ? (
          <button type="button" className="nodrag absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/40" onClick={() => onVer(pronto.storage_path)} aria-label="Ver o vídeo" data-ver-video={pronto.storage_path}>
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-black">
              <Play className="ml-0.5 h-5 w-5" />
            </span>
          </button>
        ) : andamento.length ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 px-3 text-center">
            <Loader2 className="mb-1.5 h-5 w-5 animate-spin text-orange-300" />
            <p className="text-[12px] font-medium text-white">{rotuloDoEstado(andamento[andamento.length - 1].estado)}</p>
            <p className="text-[11px] text-zinc-300">De 1 a 5 min. O cartão confere sozinho; pode sair, fica salvo.</p>
          </div>
        ) : !capa ? (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center text-zinc-400">
            <Film className="mb-1.5 h-5 w-5 text-orange-300/80" />
            <p className="text-[11px]">Ligue a foto de um Resultado aqui (alça 1º quadro).</p>
          </div>
        ) : null}
        {pronto && <span className="pointer-events-none absolute left-1.5 top-1.5 rounded-full border border-orange-400/40 bg-zinc-950/85 px-1.5 text-[11px] font-semibold text-orange-300">vídeo gerado</span>}
      </div>
      <p className="mt-1.5 truncate text-[11px] text-zinc-400" title={motor ? motor.rotulo : undefined}>
        {motor ? motor.rotulo : "Motor a escolher"} · {d.duracao_s} s · {d.formato}
        {e.final ? " · com último quadro" : e.continuar ? " · continua o anterior" : ""}
      </p>
      <p className={`truncate text-[11px] ${ultimoPedido && ultimoPedido.estado === "erro" ? "text-red-400" : bloqueios.length ? "text-amber-300" : "text-zinc-400"}`} title={(ultimoPedido && ultimoPedido.erro) || bloqueios[0] || undefined}>
        {ultimoPedido && ultimoPedido.estado === "erro" ? `Falhou: ${ultimoPedido.erro || "sem motivo do provedor"}` : bloqueios.length ? bloqueios[0] : `${d.pedidos.reduce((n, p) => n + p.videos.length, 0)} prontos · ${andamento.length} gerando`}
      </p>
    </div>
  );
}

function LinhaDoPedido({ p, onVer, onConferir, conferindo }: { p: PedidoDoVideoNoCanvas; onVer: (caminho: string) => void; onConferir: () => void; conferindo: boolean }) {
  const motor = motorPorId(p.motor);
  const andando = EM_ANDAMENTO.indexOf(p.estado) >= 0;
  return (
    <li className="min-w-0 border-t border-white/10 py-2" data-pedido-do-video={p.pedido_id}>
      <div className="flex min-w-0 items-center">
        <span className={`mr-2 h-2 w-2 shrink-0 rounded-full ${p.estado === "pronto" ? "bg-emerald-400" : p.estado === "erro" ? "bg-red-400" : andando ? "animate-pulse bg-orange-300" : "bg-zinc-500"}`} />
        <span className="min-w-0 flex-1 truncate text-[12px]">
          {rotuloDoEstado(p.estado)} · {motor ? motor.rotulo : p.motor}
        </span>
        {p.custo_usd !== null && <span className="ml-1 shrink-0 text-[11px] tabular-nums text-zinc-400">US$ {p.custo_usd.toFixed(2)}</span>}
        {andando && (
          <button type="button" className={`${BOTAO} ml-1.5 px-1.5`} onClick={onConferir} disabled={conferindo} aria-label="Conferir o andamento">
            {conferindo ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          </button>
        )}
      </div>
      {p.erro && <p className="mt-0.5 text-[11px] text-red-400">{p.erro}</p>}
      {p.videos.length > 0 && (
        <div className="mt-1.5 flex min-w-0 flex-wrap">
          {p.videos.map((v) => (
            <button key={v.storage_path} type="button" className={`${BOTAO} mb-1 mr-1`} onClick={() => onVer(v.storage_path)} data-video-pronto={v.storage_path}>
              <Play className="mr-1 h-3 w-3" /> Vídeo {v.n}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

/** Ajustes do cartão Vídeo (painel à direita no quadro; formulário no modo lista). */
export function AjustesDoVideo({
  canvas,
  no,
  fontes,
  onMudar,
  onMudarCanvas,
  onGerado,
  onConferir,
  onPorNoQuadro,
  onVer,
}: {
  canvas: Canvas;
  no: NoDoCanvas;
  fontes: Fontes;
  onMudar: (d: DadosDoVideo) => void;
  onMudarCanvas: (fn: (c: Canvas) => Canvas) => void;
  /** Pedido feito: agenda as consultas do andamento. */
  onGerado: (videoId: string) => void;
  onConferir: (videoId: string) => Promise<number>;
  /** Pôr o vídeo pronto num Quadro animado. */
  onPorNoQuadro?: (videoId: string) => void;
  /** Player do canvas (desliga as teclas do quadro enquanto aberto); sem ele, o player é local. */
  onVer?: (caminho: string) => void;
}) {
  const { clientId, atualizarCusto } = useMesa();
  const avisarErro = useAvisarErro();
  const motores = useMotoresDaMesa();
  const [nivel, setNivel] = useState<NivelDoMotor>("normal");
  const [vendo, setVendo] = useState<string | null>(null);
  const [conferindo, setConferindo] = useState(false);
  const d = no.dados.video || lerDadosDoVideo({});
  const e = entradasDoVideo(canvas, no.id, aprovadasDe(fontes));
  const requisito = requisitoDoVideo(e, d);
  const prontos = motoresProntos(motores.lista);
  const sugerido = useMemo(() => motorDoNivel(nivel, requisito, motores.motores, prontos.length ? prontos : undefined), [nivel, requisito.modo, requisito.audio, requisito.formato, motores.motores, prontos.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const motor = d.motor ? motorPorId(d.motor, motores.motores) : null;
  // Sem motor escolhido, fica o sugerido do nível entre os PRONTOS (com chave e preço), depois que o servidor disse quais são.
  const podeSugerir = !motores.carregando && !motores.semFuncao && prontos.length > 0;
  useEffect(() => {
    if (!d.motor && podeSugerir && sugerido) onMudar(dadosComMotor(d, sugerido.id, motores.motores));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sugerido && sugerido.id, d.motor, podeSugerir]);
  const duracoes = duracoesNaTela(motor, d.duracao_s);
  const custo = custoNaTela(motor, { duracao_s: d.duracao_s, resolucao: d.resolucao, audio: d.audio, variacoes: d.variacoes });
  const bloqueios = bloqueiosDoVideo(e, d);
  const mudar = (m: Partial<DadosDoVideo>) => onMudar({ ...d, ...m });
  const padrao = pedidoPadraoDoVideo(canvas, e, d);
  const titulo = (no.dados.titulo || "").trim() || (e.inicio ? `Vídeo de ${nomeDoResultado(canvas, e.inicio.no)}` : "Vídeo do Canvas");

  const gerar = async (usd: number) => {
    const pedido = await gerarVideoDoCartao({ clientId, canvas, videoId: no.id, dados: d, titulo, custoConfirmado: usd, aprovadas: aprovadasDe(fontes), motores: motores.motores });
    onMudarCanvas((c) => comPedidos(c, no.id, [pedido]));
    onGerado(no.id);
    atualizarCusto();
    toast.success("Pedido enviado ao motor de vídeo", { description: "Leva de 1 a 5 min (alguns motores, mais). Com o canvas aberto, o cartão confere sozinho; se sair, ao voltar ele confere de novo." });
  };

  const conferir = async () => {
    setConferindo(true);
    try {
      const n = await onConferir(no.id);
      if (!n) toast.info("Ainda sem novidade", { description: "O provedor segue gerando. Confira de novo em 1 minuto." });
      atualizarCusto();
    } catch (err) {
      avisarErro(err, "Não deu para conferir o vídeo");
    } finally {
      setConferindo(false);
    }
  };

  const pronto = ultimoVideo(d);

  return (
    <div className="min-w-0 space-y-3" data-ajustes-do-video={no.id}>
      <div className="min-w-0">
        <p className={ROTULO}>Entradas</p>
        <ul className="min-w-0 space-y-1">
          <li className="flex min-w-0 items-center text-[12px]">
            <span className="mr-2 w-24 shrink-0 text-zinc-400">1º quadro</span>
            <span className={`min-w-0 flex-1 truncate ${e.inicio ? "text-zinc-100" : "text-amber-300"}`}>{e.inicio ? nomeDoResultado(canvas, e.inicio.no) : e.continuar ? "o fim do vídeo ligado" : "ligue um Resultado"}</span>
          </li>
          <li className="flex min-w-0 items-center text-[12px]">
            <span className="mr-2 w-24 shrink-0 text-zinc-400">Último quadro</span>
            <span className="min-w-0 flex-1 truncate text-zinc-100">{e.final ? nomeDoResultado(canvas, e.final.no) : "opcional (emenda)"}</span>
          </li>
          {e.continuar && (
            <li className="flex min-w-0 items-center text-[12px]">
              <span className="mr-2 w-24 shrink-0 text-zinc-400">Continua</span>
              <span className="min-w-0 flex-1 truncate text-zinc-100">{(e.continuar.no.dados.titulo || "").trim() || "o outro Vídeo"}</span>
            </li>
          )}
        </ul>
      </div>
      <div className="min-w-0 rounded-lg bg-white/5 p-2.5">
        <SeletorDeMotor lista={motores.lista} requisito={requisito} valor={d.motor || ""} nivel={nivel} onEscolher={(id) => onMudar(dadosComMotor(d, id || null, motores.motores))} onNivel={setNivel} rotulo="Motor" />
        {motores.semFuncao && <p className="mt-1 text-[11px] text-amber-300">A lista de motores não abriu (função mesa-videos). Tente de novo em instantes.</p>}
        {!motores.carregando && !motores.semFuncao && !prontos.length && <p className="mt-1 text-[11px] text-amber-300">Nenhum motor pronto: falta a chave do provedor (FAL_KEY) nas funções.</p>}
      </div>
      <div className="min-w-0">
        <p className={ROTULO}>Duração</p>
        <Escolha rotulo="Duração do vídeo" opcoes={duracoes.map((s) => ({ valor: String(s), rotulo: `${s} s` }))} valor={String(d.duracao_s)} onEscolher={(v) => mudar({ duracao_s: Number(v) })} />
      </div>
      <div className="min-w-0">
        <p className={ROTULO}>Formato</p>
        <Escolha rotulo="Formato do vídeo" opcoes={FORMATOS_DO_VIDEO.filter((f) => !motor || motor.formatos.indexOf(f) >= 0).map((f) => ({ valor: f, rotulo: f }))} valor={d.formato} onEscolher={(v) => mudar({ formato: v as DadosDoVideo["formato"] })} />
      </div>
      <div className="min-w-0">
        <p className={ROTULO}>Câmera</p>
        <Escolha rotulo="Movimento de câmera" opcoes={MOVIMENTOS_DE_CAMERA.map((m) => ({ valor: m.valor, rotulo: m.rotulo, dica: m.frase }))} valor={d.movimento} onEscolher={(v) => mudar({ movimento: v })} />
        {motor && motor.cap.camera && (
          <div className="mt-1.5">
            <SeletorDeCamera valor={d.camera || ""} onEscolher={(v) => mudar({ camera: v || null })} />
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap items-center">
        {(!motor || motor.cap.audio) && (
          <label className="mb-1 mr-3 inline-flex items-center text-[12px] text-zinc-200">
            <input type="checkbox" className="mr-1.5" checked={d.audio} onChange={(x) => mudar({ audio: x.target.checked })} /> Com áudio (fala da narrativa)
          </label>
        )}
        <label className="mb-1 inline-flex items-center text-[12px] text-zinc-200">
          <input type="checkbox" className="mr-1.5" checked={d.variacoes === 2} onChange={(x) => mudar({ variacoes: x.target.checked ? 2 : 1 })} /> 2 variações
        </label>
      </div>
      <div className="min-w-0">
        <div className="mb-1.5 flex items-center">
          <p className={`${ROTULO} mb-0 flex-1`}>Pedido ao motor</p>
          <button type="button" className="text-[11px] text-zinc-400 hover:text-white" onClick={() => mudar({ prompt: padrao })} title="Escreve pelo que está na cena (ação, lugar, câmera, fala)">
            <Wand2 className="mr-1 inline h-3 w-3" /> Pela cena
          </button>
        </div>
        <textarea className={CAMPO} rows={4} value={d.prompt} onChange={(x) => mudar({ prompt: x.target.value.slice(0, 2000) })} placeholder={padrao} aria-label="Pedido ao motor de vídeo" />
        <input className={`${CAMPO} mt-1.5`} value={d.negativo} onChange={(x) => mudar({ negativo: x.target.value.slice(0, 600) })} placeholder="Evitar (opcional): texto na tela, mãos deformadas" aria-label="O que evitar" />
        {!d.prompt.trim() && <p className="mt-1 text-[11px] text-zinc-500">Vazio: vai o pedido da cena (o que está em cinza).</p>}
      </div>
      <div className="min-w-0 border-t border-white/10 pt-2.5">
        <BotaoDeGerar custo={custo} rotulo={pronto ? "Gerar de novo" : "Gerar vídeo"} motivo={bloqueios[0] || null} onConfirmar={gerar} icone={<Film className="mr-1.5 h-3.5 w-3.5" />} extra={d.variacoes > 1 ? `${d.variacoes} variações, cada uma cobrada quando fica pronta.` : null} />
      </div>
      {d.pedidos.length > 0 && (
        <div className="min-w-0">
          <div className="flex min-w-0 items-center">
            <p className={`${ROTULO} mb-0 flex-1`}>Pedidos ({d.pedidos.length})</p>
            <button type="button" className="text-[11px] text-zinc-400 hover:text-white" onClick={() => void conferir()} disabled={conferindo}>
              {conferindo ? "Conferindo" : "Conferir"}
            </button>
          </div>
          <ul className="min-w-0">
            {d.pedidos
              .slice()
              .reverse()
              .map((p) => (
                <LinhaDoPedido key={p.pedido_id} p={p} onVer={onVer || setVendo} onConferir={() => void conferir()} conferindo={conferindo} />
              ))}
          </ul>
        </div>
      )}
      <div className="flex min-w-0 flex-wrap items-center border-t border-white/10 pt-2.5">
        {pronto && onPorNoQuadro && (
          <button type="button" className={`${BOTAO} mb-1 mr-1.5`} onClick={() => onPorNoQuadro(no.id)} title="Cria um Quadro animado com este vídeo de fundo">
            <LayoutTemplate className="mr-1 h-3.5 w-3.5" /> Pôr num Quadro
          </button>
        )}
        <Link to={`/mesa-videos?client=${clientId}&etapa=resultados`} className={`${BOTAO} mb-1`} title="Aprovar o vídeo e mandar para a Mesa Edição">
          <Clapperboard className="mr-1 h-3.5 w-3.5" /> Aprovar na Mesa Vídeos <ArrowUpRight className="ml-0.5 h-3 w-3" />
        </Link>
      </div>
      {vendo && <JanelaDoVideo caminho={vendo} titulo={titulo} onFechar={() => setVendo(null)} />}
    </div>
  );
}
