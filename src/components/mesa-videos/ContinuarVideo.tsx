import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { CampoDeFormulario, GrupoDeCampos } from "@/components/sistema/Formulario";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { campo, campoTexto, juntar, texto } from "@/components/sistema/estilos";
import { custoNaTela, novoUid, useMotoresDaMesa } from "@/lib/mesa-videos/api";
import { quadroDoVideoNoStorage } from "@/lib/mesa-videos/quadros";
import { duracaoNoMotor, duracoesDoMotor, motorDoNivel, motorPorId, type NivelDoMotor } from "../../../supabase/functions/mesa-videos/modulos/modelos-de-video";
import { BotaoDeGerar, SeletorDeMotor } from "./PecasDoGerador";
import { chamarMesaVideos, chaveDosPedidos, useArquivosDeVideo, type ArquivoDeVideo } from "./videosApi";

/**
 * Continuar vídeo e transição (frente V-A).
 * - Continuar: extensão nativa quando o motor tem (Veo, Seedance 2.5, H3 Max,
 *   LTX, FLUX 3, Grok, Kling O3); senão o último quadro do vídeo (tirado AQUI,
 *   no navegador, sempre no mesmo ponto: duração menos meio quadro) vira o
 *   primeiro quadro do novo clipe.
 * - Transição A para B: primeiro quadro = último de A, último quadro =
 *   primeiro de B; o motor precisa aceitar último quadro.
 */

interface Rascunho {
  modo: "continuar" | "transicao";
  nivel: NivelDoMotor;
  motor: string;
  video: string;
  videoB: string;
  prompt: string;
  duracao: number;
  formato: string;
  nativo: boolean;
}

const INICIAL: Rascunho = { modo: "continuar", nivel: "top", motor: "", video: "", videoB: "", prompt: "", duracao: 5, formato: "9:16", nativo: true };

const ehVideo = (a: ArquivoDeVideo) => a.estado !== "arquivado" && (a.tipo === "gerado" || a.tipo === "bruto" || a.tipo === "take" || a.tipo === "entrega") && !a.so_no_storage;

export default function ContinuarVideo() {
  const { clientId, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const motores = useMotoresDaMesa();
  const arquivosQ = useArquivosDeVideo(clientId);
  const [r, setR] = useEstadoDaTela<Rascunho>(`mesa-videos:continuar:${clientId}`, INICIAL, { validar: (v) => !!v && typeof v === "object", esperaMs: 300 });
  const [etapa, setEtapa] = useState<string | null>(null);
  const mudar = (m: Partial<Rascunho>) => setR((x) => ({ ...x, ...m }));
  const videos = ((arquivosQ.data && arquivosQ.data.arquivos) || []).filter(ehVideo);
  const a = videos.find((x) => x.id === r.video) || null;
  const b = videos.find((x) => x.id === r.videoB) || null;
  const requisito = r.modo === "transicao" ? ({ modo: "primeiro_ultimo", formato: r.formato } as const) : ({ modo: r.nativo ? "estender" : "primeiro_quadro", formato: r.formato } as const);
  const motor = motorPorId(r.motor, motores.motores) || motorDoNivel(r.nivel, requisito, motores.motores) || (r.modo === "continuar" ? motorDoNivel(r.nivel, { modo: "primeiro_quadro", formato: r.formato }, motores.motores) : null);
  const nativo = r.modo === "continuar" && r.nativo && !!motor && motor.cap.estender;
  const duracao = motor ? duracaoNoMotor(motor, r.duracao) : r.duracao;
  const custo = custoNaTela(motor, { duracao_s: duracao });
  const estado = motor ? motores.lista.find((x) => x.motor.id === motor.id) : null;
  const motivo = !a ? "Escolha o vídeo." : r.modo === "transicao" && !b ? "Escolha o vídeo B." : !motor ? "Nenhum motor faz isso." : estado && estado.estado !== "pronto" ? `${motor.rotulo}: ${estado.estado_rotulo.toLowerCase()}.` : r.modo === "continuar" && !r.prompt.trim() ? "Diga o que acontece depois." : null;

  const gerar = async (usd: number) => {
    if (!motor || !a) return;
    const registrar = (caminho: string, posicao: string, origem: string) => chamarMesaVideos({ acao: "quadro_registrar", client_id: clientId, storage_path: caminho, posicao, origem_arquivo_id: origem }).catch(() => null);
    if (r.modo === "continuar") {
      let quadro: string | null = null;
      if (!nativo) {
        setEtapa("Tirando o último quadro");
        quadro = await quadroDoVideoNoStorage(clientId, a.storage_bucket, a.storage_path, "ultimo");
        void registrar(quadro, "ultimo", a.id);
      }
      setEtapa("Enviando");
      const resp = await chamarMesaVideos<{ pedido_id: string; via: string }>({ acao: "continuar_video", client_id: clientId, arquivo_id: a.id, quadro_path: quadro, usar_extensao: nativo, prompt: r.prompt, motor: motor.id, duracao_s: duracao, formato: r.formato, variacoes: 1, uid: novoUid(), custo_confirmado_usd: usd, titulo: `${a.nome} continuação` });
      toast.success("Continuação enviada", { description: resp.via === "extensao_nativa" ? "Pela extensão nativa do motor." : "A partir do último quadro." });
    } else if (b) {
      setEtapa("Tirando os quadros de A e B");
      const [qa, qb] = await Promise.all([quadroDoVideoNoStorage(clientId, a.storage_bucket, a.storage_path, "ultimo"), quadroDoVideoNoStorage(clientId, b.storage_bucket, b.storage_path, "primeiro")]);
      void registrar(qa, "ultimo", a.id);
      void registrar(qb, "primeiro", b.id);
      setEtapa("Enviando");
      await chamarMesaVideos({ acao: "transicao_gerar", client_id: clientId, quadro_a_path: qa, quadro_b_path: qb, prompt: r.prompt, motor: motor.id, duracao_s: duracao, formato: r.formato, variacoes: 1, uid: novoUid(), custo_confirmado_usd: usd, titulo: `Transição ${a.nome} para ${b.nome}` });
      toast.success("Transição enviada", { description: "Primeiro quadro = fim de A; último quadro = começo de B." });
    }
    setEtapa(null);
    void queryClient.invalidateQueries({ queryKey: chaveDosPedidos(clientId) });
    atualizarCusto();
  };

  const confirmar = async (usd: number) => {
    try {
      await gerar(usd);
    } finally {
      setEtapa(null);
    }
  };

  const opcoesDeVideo = (valor: string, rotulo: string, onMudar: (v: string) => void) => (
    <CampoDeFormulario rotulo={rotulo}>
      <select className={campo} value={valor} onChange={(e) => onMudar(e.target.value)}>
        <option value="">Escolha o vídeo</option>
        {videos.map((v) => (
          <option key={v.id} value={v.id}>
            {v.nome}
          </option>
        ))}
      </select>
    </CampoDeFormulario>
  );

  return (
    <div className="min-w-0 space-y-5" data-continuar-video="">
      <SeletorCompacto rotulo="Continuar ou transição" opcoes={[{ valor: "continuar", rotulo: "Continuar" }, { valor: "transicao", rotulo: "Transição A para B" }]} valor={r.modo} onEscolher={(v) => mudar({ modo: v as Rascunho["modo"], motor: "" })} />
      <GrupoDeCampos>
        {opcoesDeVideo(r.video, r.modo === "transicao" ? "Vídeo A" : "Vídeo", (v) => mudar({ video: v }))}
        {r.modo === "transicao" && opcoesDeVideo(r.videoB, "Vídeo B", (v) => mudar({ videoB: v }))}
      </GrupoDeCampos>
      <SeletorDeMotor lista={motores.lista} requisito={requisito} valor={motor ? motor.id : ""} nivel={r.nivel} onNivel={(n) => mudar({ nivel: n, motor: "" })} onEscolher={(id) => mudar({ motor: id })} />
      {r.modo === "continuar" && motor && motor.cap.estender && (
        <label className="flex min-w-0 items-center text-[13px]">
          <input type="checkbox" className="mr-2 h-4 w-4 accent-primary" checked={r.nativo} onChange={(e) => mudar({ nativo: e.target.checked })} />
          Usar a extensão nativa do {motor.rotulo}
        </label>
      )}
      <CampoDeFormulario rotulo={r.modo === "continuar" ? "O que acontece depois" : "Como é a passagem"} largo apoio="Mesmo personagem e mesmo lugar: repita a aparência e a roupa como no vídeo.">
        <textarea className={juntar(campoTexto, "min-h-[80px]")} value={r.prompt} maxLength={2400} onChange={(e) => mudar({ prompt: e.target.value })} placeholder={r.modo === "continuar" ? "Ex.: ele entra na padaria e acende a luz, câmera acompanha" : "Opcional"} />
      </CampoDeFormulario>
      <GrupoDeCampos>
        <CampoDeFormulario rotulo="Duração">
          <select className={campo} value={duracao} onChange={(e) => mudar({ duracao: Number(e.target.value) })}>
            {(motor ? duracoesDoMotor(motor) : [5]).map((d) => (
              <option key={d} value={d}>
                {d} s
              </option>
            ))}
          </select>
        </CampoDeFormulario>
        <div className="min-w-0">
          <p className={juntar(texto.rotulo, "mb-1.5")}>Formato</p>
          <SeletorCompacto rotulo="Formato" larguraTotal opcoes={(motor ? motor.formatos : ["9:16", "16:9"]).map((f) => ({ valor: f, rotulo: f }))} valor={r.formato} onEscolher={(v) => mudar({ formato: v })} />
        </div>
      </GrupoDeCampos>
      <BotaoDeGerar custo={custo} rotulo={r.modo === "continuar" ? "Continuar" : "Gerar transição"} motivo={etapa || motivo} onConfirmar={confirmar} />
    </div>
  );
}
