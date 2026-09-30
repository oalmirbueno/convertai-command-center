import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Rotate3d } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { CampoDeFormulario, GrupoDeCampos } from "@/components/sistema/Formulario";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { campo, juntar, texto } from "@/components/sistema/estilos";
import { custoNaTela, novoUid, useMotoresDaMesa } from "@/lib/mesa-videos/api";
import { duracaoNoMotor, duracoesDoMotor, type MotorDeVideo, motorDoNivel, motorPorId } from "../../../supabase/functions/mesa-videos/modulos/modelos-de-video";
import { MOVIMENTOS_DA_HIGGSFIELD } from "../../../supabase/functions/mesa-videos/modulos/video-provedor-higgsfield";
import {
  ANGULOS_PRONTOS,
  azimuteDoPonto,
  DISTANCIAS,
  ELEVACAO_MAX,
  ELEVACAO_MIN,
  type AnguloDeCamera,
  type DistanciaDoAngulo,
  type ManterNoAngulo,
  pontoDoAzimute,
  textoDoAngulo,
} from "../../../supabase/functions/mesa-videos/modulos/video-angulo";
import { BotaoDeGerar, EscolherImagem, SeletorDeCamera, SeletorDeMotor } from "./PecasDoGerador";
import { chamarMesaVideos, chaveDosPedidos } from "./videosApi";

/**
 * Troca de ângulo de câmera (frente V-A): escolhe a imagem (quadro, foto do
 * acervo, folha do personagem), arrasta a câmera em volta da pessoa (vista de
 * cima), a altura e a distância, e gera 1 a 4 variações do mesmo personagem
 * e cenário visto de outro ponto. Custo antes; resultado nos Resultados.
 * Safari 11: arrastar com mouse e toque (sem pointer events).
 *
 * Frente V-C (26/09): escolhendo a Higgsfield no motor, a ferramenta vira
 * "câmera em vídeo": a imagem é o ponto de partida e um dos 33 movimentos
 * prontos (dolly, grua, órbita de drone, bullet time) move a câmera num
 * vídeo curto. O resultado vai para os Resultados como vídeo gerado.
 */

const TAM = 148;
/** Motor com câmera pronta em vídeo (Higgsfield) também serve à ferramenta. */
const temCameraPronta = (m: MotorDeVideo) => !!m.cap.camera;

export function ControleDeOrbita({ valor, onMudar }: { valor: AnguloDeCamera; onMudar: (a: AnguloDeCamera) => void }) {
  const caixa = useRef<SVGSVGElement>(null);
  const arrastando = useRef(false);
  const mover = (clientX: number, clientY: number) => {
    const el = caixa.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = clientX - (r.left + r.width / 2);
    const dy = clientY - (r.top + r.height / 2);
    onMudar({ ...valor, azimute: azimuteDoPonto(dx, dy) });
  };
  const p = pontoDoAzimute(valor.azimute);
  const raio = TAM / 2 - 14;
  const cx = TAM / 2 + p.x * raio;
  const cy = TAM / 2 + p.y * raio;
  // O arraste usa sempre a última versão de mover (o valor muda a cada movimento).
  const moverAtual = useRef(mover);
  moverAtual.current = mover;
  const comecarArraste = () => {
    arrastando.current = true;
    const aoMover = (e: MouseEvent) => {
      if (arrastando.current) moverAtual.current(e.clientX, e.clientY);
    };
    const fim = () => {
      arrastando.current = false;
      window.removeEventListener("mousemove", aoMover);
      window.removeEventListener("mouseup", fim);
    };
    window.addEventListener("mousemove", aoMover);
    window.addEventListener("mouseup", fim);
  };
  return (
    <div className="flex min-w-0 items-start" data-controle-de-orbita="">
      <svg
        ref={caixa}
        width={TAM}
        height={TAM}
        viewBox={`0 0 ${TAM} ${TAM}`}
        className="mr-3 shrink-0 cursor-pointer touch-none select-none"
        role="slider"
        aria-label="Posição da câmera em volta da pessoa"
        aria-valuemin={-180}
        aria-valuemax={180}
        aria-valuenow={valor.azimute}
        aria-valuetext={textoDoAngulo(valor)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") onMudar({ ...valor, azimute: Math.max(-180, valor.azimute - 15) });
          if (e.key === "ArrowRight") onMudar({ ...valor, azimute: Math.min(180, valor.azimute + 15) });
        }}
        onMouseDown={(e) => {
          mover(e.clientX, e.clientY);
          comecarArraste();
        }}
        onTouchStart={(e) => e.touches[0] && mover(e.touches[0].clientX, e.touches[0].clientY)}
        onTouchMove={(e) => e.touches[0] && mover(e.touches[0].clientX, e.touches[0].clientY)}
      >
        <circle cx={TAM / 2} cy={TAM / 2} r={raio} fill="none" stroke="hsl(var(--border))" strokeWidth="2" />
        <text x={TAM / 2} y={TAM - 2} textAnchor="middle" fontSize="9" fill="hsl(var(--muted-foreground))">
          frente
        </text>
        <text x={TAM / 2} y={9} textAnchor="middle" fontSize="9" fill="hsl(var(--muted-foreground))">
          costas
        </text>
        {/* a pessoa, de cima, olhando para a frente */}
        <circle cx={TAM / 2} cy={TAM / 2} r="9" fill="hsl(var(--muted))" stroke="hsl(var(--foreground))" strokeWidth="1.5" />
        <path d={`M ${TAM / 2 - 5} ${TAM / 2 + 6} L ${TAM / 2} ${TAM / 2 + 13} L ${TAM / 2 + 5} ${TAM / 2 + 6}`} fill="hsl(var(--foreground))" />
        <line x1={TAM / 2} y1={TAM / 2} x2={cx} y2={cy} stroke="hsl(var(--primary))" strokeWidth="1.5" strokeDasharray="3 3" />
        <circle cx={cx} cy={cy} r="8" fill="hsl(var(--primary))" />
      </svg>
      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <p className={juntar(texto.rotulo, "mb-1")}>Altura da câmera ({valor.elevacao > 0 ? "de cima" : valor.elevacao < 0 ? "de baixo" : "na altura dos olhos"})</p>
          <input
            type="range"
            min={ELEVACAO_MIN}
            max={ELEVACAO_MAX}
            step={5}
            value={valor.elevacao}
            onChange={(e) => onMudar({ ...valor, elevacao: Number(e.target.value) })}
            className="w-full accent-primary"
            aria-label="Altura da câmera"
          />
        </div>
        <div>
          <p className={juntar(texto.rotulo, "mb-1")}>Distância</p>
          <SeletorCompacto rotulo="Distância" opcoes={DISTANCIAS.map((d) => ({ valor: d.valor, rotulo: d.rotulo }))} valor={valor.distancia} onEscolher={(v) => onMudar({ ...valor, distancia: v as DistanciaDoAngulo })} />
        </div>
        <p className={juntar(texto.auxiliar, "truncate")}>{textoDoAngulo(valor)}</p>
      </div>
    </div>
  );
}

interface Rascunho {
  imagem: string | null;
  angulo: AnguloDeCamera;
  pronto: string;
  manter: ManterNoAngulo;
  variacoes: number;
  motor: string;
  extra: string;
  /** Câmera em vídeo (Higgsfield). */
  camera?: string;
  duracao?: number;
  formato?: string;
}

const INICIAL: Rascunho = { imagem: null, angulo: { azimute: 90, elevacao: 0, distancia: "medio" }, pronto: "perfil_dir", manter: "ambos", variacoes: 2, motor: "", extra: "", camera: "dolly-in", duracao: 5, formato: "9:16" };

const MANTER_EM_INGLES: Record<ManterNoAngulo, string> = { personagem: "Keep the same person identical (face, hair, clothes).", cenario: "Keep the same place identical (walls, objects, light).", ambos: "Keep the same person and the same place identical." };

/** Texto da câmera em vídeo (a Higgsfield pede prompt): o pedido da equipe ou um texto neutro de câmera. */
export function promptDaCameraEmVideo(camera: string, manter: ManterNoAngulo, extra: string): string {
  const m = MOVIMENTOS_DA_HIGGSFIELD.find((x) => x.valor === camera);
  const base = extra.trim() || "The scene from the image comes alive with subtle natural motion.";
  return `${base} Camera move: ${m ? m.valor.replace(/-/g, " ") : "slow dolly in"}. ${MANTER_EM_INGLES[manter] || MANTER_EM_INGLES.ambos} Photorealistic, no text.`.slice(0, 2400);
}

export default function FerramentaDeAngulo({ imagemInicial }: { imagemInicial?: string | null }) {
  const { clientId, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const motores = useMotoresDaMesa();
  const [r, setR] = useEstadoDaTela<Rascunho>(`mesa-videos:angulo:${clientId}`, { ...INICIAL, imagem: imagemInicial || null }, { validar: (v) => !!v && typeof v === "object" && !!(v as Rascunho).angulo });
  const mudar = (m: Partial<Rascunho>) => setR((x) => ({ ...x, ...m }));
  const sugerido = motorDoNivel("top", { modo: "angulo" }, motores.motores);
  const motor = motorPorId(r.motor, motores.motores) || sugerido;
  const emVideo = !!motor && temCameraPronta(motor);
  const camera = r.camera || "dolly-in";
  const formato = r.formato || "9:16";
  const duracao = motor && emVideo ? duracaoNoMotor(motor, r.duracao || 5) : 0;
  const custo = emVideo ? custoNaTela(motor, { duracao_s: duracao, variacoes: r.variacoes }) : custoNaTela(motor, { variacoes: r.variacoes });
  const estado = motores.lista.find((x) => x.motor.id === (motor ? motor.id : ""));
  const motivo = !r.imagem ? "Escolha a imagem." : !motor ? "Nenhum motor de ângulo." : estado && estado.estado !== "pronto" ? `${motor.rotulo}: ${estado.estado_rotulo.toLowerCase()}${estado.chave ? ` (${estado.chave})` : ""}.` : null;
  const rotuloDaCamera = (MOVIMENTOS_DA_HIGGSFIELD.find((x) => x.valor === camera) || { rotulo: camera }).rotulo;

  const gerarEmVideo = async (usd: number) => {
    if (!motor || !r.imagem) return;
    const resp = await chamarMesaVideos<{ pedido_id: string }>({
      acao: "gerar_video",
      tipo: "gerar_livre",
      client_id: clientId,
      motor: motor.id,
      modo: "primeiro_quadro",
      prompt: promptDaCameraEmVideo(camera, r.manter, r.extra),
      duracao_s: duracao,
      formato,
      variacoes: r.variacoes,
      quadro_inicial_path: r.imagem,
      camera,
      titulo: `Câmera: ${rotuloDaCamera}`.slice(0, 120),
      uid: novoUid(),
      custo_confirmado_usd: usd,
    });
    void queryClient.invalidateQueries({ queryKey: chaveDosPedidos(clientId) });
    atualizarCusto();
    toast.success("Câmera em vídeo enviada", { description: `Pedido ${String(resp.pedido_id || "").slice(0, 8)}. O vídeo aparece nos Resultados.` });
  };

  const gerar = async (usd: number) => {
    if (emVideo) return gerarEmVideo(usd);
    if (!motor || !r.imagem) return;
    const resp = await chamarMesaVideos<{ pedido_id: string }>({
      acao: "angulo_gerar",
      client_id: clientId,
      imagem_path: r.imagem,
      angulo: r.angulo,
      variacoes: r.variacoes,
      modelo: motor.id,
      manter: r.manter,
      prompt: r.extra,
      uid: novoUid(),
      custo_confirmado_usd: usd,
    });
    void queryClient.invalidateQueries({ queryKey: chaveDosPedidos(clientId) });
    atualizarCusto();
    toast.success("Ângulo enviado", { description: `Pedido ${String(resp.pedido_id || "").slice(0, 8)}. O resultado aparece nos Resultados.` });
  };

  return (
    <div className="min-w-0 space-y-5" data-ferramenta-de-angulo="">
      <GrupoDeCampos>
        <EscolherImagem rotulo="Imagem de partida" valor={r.imagem} onEscolher={(c) => mudar({ imagem: c })} />
        <SeletorDeMotor lista={motores.lista} requisito={{ modo: "angulo" }} aceitar={temCameraPronta} valor={motor ? motor.id : ""} nivel="top" onNivel={() => undefined} onEscolher={(id) => mudar({ motor: id })} rotulo="Motor de ângulo" />
      </GrupoDeCampos>
      {emVideo && motor ? (
        <GrupoDeCampos>
          <SeletorDeCamera rotulo="Movimento da câmera" opcional={false} valor={camera} onEscolher={(v) => mudar({ camera: v })} />
          <CampoDeFormulario rotulo="Duração">
            <select className={campo} value={duracao} onChange={(e) => mudar({ duracao: Number(e.target.value) })}>
              {duracoesDoMotor(motor).map((d) => (
                <option key={d} value={d}>
                  {d} s
                </option>
              ))}
            </select>
          </CampoDeFormulario>
          <div className="min-w-0">
            <p className={juntar(texto.rotulo, "mb-1.5")}>Formato</p>
            <SeletorCompacto rotulo="Formato" larguraTotal opcoes={motor.formatos.map((f) => ({ valor: f, rotulo: f }))} valor={formato} onEscolher={(v) => mudar({ formato: v })} />
          </div>
          <CampoDeFormulario rotulo="O que acontece" apoio="Opcional. A câmera se move; a pessoa e o lugar ficam.">
            <input className={campo} value={r.extra} maxLength={600} onChange={(e) => mudar({ extra: e.target.value })} placeholder="Ex.: ela sorri e olha para a janela" />
          </CampoDeFormulario>
        </GrupoDeCampos>
      ) : (
        <div className="min-w-0">
          <div className="mb-2 flex min-w-0 items-center">
            <p className={juntar(texto.rotulo, "mr-2 flex-1")}>Ângulo</p>
            <SeletorCompacto
              rotulo="Ângulo pronto"
              icone={<Rotate3d className="h-3.5 w-3.5" />}
              opcoes={ANGULOS_PRONTOS.map((a) => ({ valor: a.valor, rotulo: a.rotulo }))}
              valor={r.pronto}
              onEscolher={(v) => {
                const a = ANGULOS_PRONTOS.find((x) => x.valor === v);
                if (a) mudar({ pronto: v, angulo: { ...r.angulo, azimute: a.azimute, elevacao: a.elevacao } });
              }}
            />
          </div>
          <ControleDeOrbita valor={r.angulo} onMudar={(a) => mudar({ angulo: a, pronto: "" })} />
        </div>
      )}
      <GrupoDeCampos>
        <div className="min-w-0">
          <p className={juntar(texto.rotulo, "mb-1.5")}>Manter igual</p>
          <SeletorCompacto rotulo="Manter igual" larguraTotal opcoes={[{ valor: "personagem", rotulo: "Pessoa" }, { valor: "cenario", rotulo: "Cenário" }, { valor: "ambos", rotulo: "Os dois" }]} valor={r.manter} onEscolher={(v) => mudar({ manter: v as ManterNoAngulo })} />
        </div>
        <div className="min-w-0">
          <p className={juntar(texto.rotulo, "mb-1.5")}>Variações</p>
          <SeletorCompacto rotulo="Variações" larguraTotal opcoes={[1, 2, 3, 4].map((n) => ({ valor: String(n), rotulo: String(n) }))} valor={String(r.variacoes)} onEscolher={(v) => mudar({ variacoes: Number(v) })} />
        </div>
      </GrupoDeCampos>
      <BotaoDeGerar
        custo={custo}
        rotulo={emVideo ? "Gerar vídeo" : "Gerar ângulo"}
        motivo={motivo}
        onConfirmar={gerar}
        extra={emVideo ? `${r.variacoes} ${r.variacoes === 1 ? "variação" : "variações"}, ${rotuloDaCamera.toLowerCase()}, ${duracao} s` : `${r.variacoes} ${r.variacoes === 1 ? "variação" : "variações"}, ${textoDoAngulo(r.angulo)}`}
      />
    </div>
  );
}
