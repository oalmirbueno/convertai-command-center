import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Mic, Upload } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { CampoDeFormulario, GrupoDeCampos } from "@/components/sistema/Formulario";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campo, juntar, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { custoNaTela, novoUid, useMotoresDaMesa } from "@/lib/mesa-videos/api";
import { motorDoNivel, motorPorId, resolucaoNoMotor } from "../../../supabase/functions/mesa-videos/modulos/modelos-de-video";
import { BotaoDeGerar, EscolherImagem, SeletorDeMotor } from "./PecasDoGerador";
import { chamarMesaVideos, chaveDosArquivos, chaveDosPedidos, duracaoCurta, subirVideos, useArquivosDeVideo } from "./videosApi";

/**
 * Foto que fala (frente VGN, 30/09/2026): uma foto e um áudio viram a pessoa
 * falando AQUELE áudio, com a boca no ritmo da fala. O áudio sai do acervo de
 * vídeo do cliente: a voz da ElevenLabs feita na Mesa Motion, uma locução
 * gravada ou um trecho de entrevista. Motores pelo fal (a mesma FAL_KEY):
 * H3 Max Lip Sync (o mais barato), HeyGen Avatar IV e sync-3.
 * O vídeo dura o que o áudio dura (até 60 s); o custo aparece antes e só é
 * cobrado o que ficar pronto. Pessoa real só com a confirmação de que ela
 * autorizou o uso da imagem e da voz em vídeo.
 */

interface Rascunho {
  motor: string;
  foto: string | null;
  audio: string;
  formato: string;
  resolucao: string;
  estilo: "estavel" | "expressivo";
  confirma: boolean;
}

const INICIAL: Rascunho = { motor: "", foto: null, audio: "", formato: "9:16", resolucao: "", estilo: "estavel", confirma: false };

export default function FotoQueFala() {
  const { clientId, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const motores = useMotoresDaMesa();
  const arquivosQ = useArquivosDeVideo(clientId);
  const [subindo, setSubindo] = useState(false);
  const [bruto, setR] = useEstadoDaTela<Rascunho>(`mesa-videos:labial:${clientId}`, INICIAL, { validar: (v) => !!v && typeof v === "object", esperaMs: 300 });
  const r: Rascunho = { ...INICIAL, ...bruto };
  const mudar = (m: Partial<Rascunho>) => setR((x) => ({ ...INICIAL, ...x, ...m }));

  const requisito = { modo: "labial" as const, formato: r.formato };
  const motor = motorPorId(r.motor, motores.motores) || motorDoNivel("top", requisito, motores.motores);
  const audios = ((arquivosQ.data && arquivosQ.data.arquivos) || []).filter((a) => a.tipo === "audio" && a.estado !== "arquivado");
  const audio = audios.find((a) => a.id === r.audio) || null;
  const duracao = audio && audio.duracao_s ? audio.duracao_s : 0;
  const resolucao = motor ? resolucaoNoMotor(motor, r.resolucao) : "";
  const custo = custoNaTela(motor, { duracao_s: Math.max(1, duracao), resolucao });
  const estado = motor ? motores.lista.find((x) => x.motor.id === motor.id) || null : null;

  const motivo = useMemo(() => {
    if (!motor) return "Nenhum motor faz foto falando.";
    if (estado && estado.estado !== "pronto" && estado.estado !== "a_conferir") return `${motor.rotulo}: ${estado.estado_rotulo.toLowerCase()}${estado.chave ? ` (${estado.chave})` : ""}.`;
    if (!r.foto) return "Escolha a foto de quem fala.";
    if (!audio) return audios.length ? "Escolha o áudio." : "Suba o áudio (MP3, WAV ou M4A).";
    if (!(duracao > 0)) return "Este áudio está sem duração: suba de novo.";
    if (duracao > 60) return `Áudio de ${Math.round(duracao)} s: até 60 s por vídeo. Divida a fala.`;
    if (!r.confirma) return "Confirme o direito de uso da imagem e da voz.";
    return null;
  }, [motor, estado, r.foto, audio, audios.length, duracao, r.confirma]);

  const subir = async (arquivo: File | undefined) => {
    if (!arquivo) return;
    setSubindo(true);
    try {
      const res = await subirVideos(clientId, [arquivo], () => undefined);
      void queryClient.invalidateQueries({ queryKey: chaveDosArquivos(clientId) });
      const novo = res.registrados.find((a) => a.tipo === "audio");
      if (novo) {
        mudar({ audio: novo.id });
        toast.success("Áudio no acervo", { description: novo.nome });
      } else if (res.duplicados.length) {
        toast.message("Esse áudio já estava no acervo", { description: "Escolha na lista." });
      } else {
        toast.error("O áudio não subiu", { description: (res.recusados[0] && res.recusados[0].motivo) || res.aviso || "Tente de novo." });
      }
    } catch (e) {
      toast.error("O áudio não subiu", { description: textoDoErro(e) });
    } finally {
      setSubindo(false);
    }
  };

  const gerar = async (usd: number) => {
    if (!motor || !audio || !r.foto) return;
    const resp = await chamarMesaVideos<{ pedido_id: string }>({
      acao: "labial_gerar",
      client_id: clientId,
      motor: motor.id,
      imagem_path: r.foto,
      audio_arquivo_id: audio.id,
      formato: r.formato,
      resolucao,
      estilo: r.estilo,
      confirma_direito_de_imagem: r.confirma,
      titulo: `Fala: ${audio.nome}`.slice(0, 120),
      uid: novoUid(),
      custo_confirmado_usd: usd,
    });
    void queryClient.invalidateQueries({ queryKey: chaveDosPedidos(clientId) });
    atualizarCusto();
    toast.success("Foto que fala enviada", { description: `Pedido ${String(resp.pedido_id || "").slice(0, 8)}. Acompanhe nos Resultados.` });
  };

  return (
    <div className="min-w-0 space-y-5" data-foto-que-fala="">
      <SeletorDeMotor lista={motores.lista} requisito={requisito} valor={motor ? motor.id : ""} nivel="normal" onNivel={() => undefined} onEscolher={(id) => mudar({ motor: id })} />
      <GrupoDeCampos colunas={2}>
        <EscolherImagem rotulo="Foto de quem fala" valor={r.foto} onEscolher={(c) => mudar({ foto: c })} />
        <div className="min-w-0">
          <p className={juntar(texto.rotulo, "mb-1.5")}>Áudio da fala</p>
          <div className="flex min-w-0 items-center">
            <select className={juntar(campo, "min-w-0 flex-1")} value={audio ? audio.id : ""} onChange={(e) => mudar({ audio: e.target.value })} aria-label="Áudio da fala">
              <option value="">{audios.length ? "Escolha o áudio" : "Nenhum áudio no acervo"}</option>
              {audios.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nome}
                  {a.duracao_s ? ` · ${duracaoCurta(a.duracao_s)}` : ""}
                </option>
              ))}
            </select>
            <label className={juntar(botao.secundario, "ml-2 cursor-pointer")} aria-label="Subir áudio">
              {subindo ? <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-1.5" /> : <Upload className="h-3.5 w-3.5 sm:mr-1.5" />}
              <span className="hidden sm:inline">Subir</span>
              <input type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/aac,.mp3,.wav,.m4a,.aac" className="hidden" disabled={subindo} onChange={(e) => void subir(e.target.files ? e.target.files[0] : undefined)} />
            </label>
          </div>
          <p className={juntar(texto.auxiliar, "mt-1")}>{audio ? `O vídeo vai durar ${duracaoCurta(duracao) || "o que o áudio dura"}.` : "Voz da ElevenLabs (Mesa Motion), locução gravada ou trecho de entrevista."}</p>
        </div>
      </GrupoDeCampos>
      <GrupoDeCampos>
        <div className="min-w-0">
          <p className={juntar(texto.rotulo, "mb-1.5")}>Formato</p>
          <SeletorCompacto rotulo="Formato" larguraTotal opcoes={(motor ? motor.formatos : ["9:16", "16:9", "1:1"]).map((f) => ({ valor: f, rotulo: f }))} valor={r.formato} onEscolher={(v) => mudar({ formato: v })} />
        </div>
        {motor && motor.resolucoes.length > 1 && (
          <CampoDeFormulario rotulo="Resolução">
            <select className={campo} value={resolucao} onChange={(e) => mudar({ resolucao: e.target.value })}>
              {motor.resolucoes.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </CampoDeFormulario>
        )}
        {motor && motor.dialeto === "heygen_fal_labial" && (
          <div className="min-w-0">
            <p className={juntar(texto.rotulo, "mb-1.5")}>Jeito de falar</p>
            <SeletorCompacto rotulo="Jeito de falar" larguraTotal opcoes={[{ valor: "estavel", rotulo: "Estável" }, { valor: "expressivo", rotulo: "Expressivo" }]} valor={r.estilo} onEscolher={(v) => mudar({ estilo: v === "expressivo" ? "expressivo" : "estavel" })} />
          </div>
        )}
      </GrupoDeCampos>
      <label className="flex min-w-0 items-start text-[13px]">
        <input type="checkbox" className="mr-2 mt-0.5 h-4 w-4 shrink-0 accent-primary" checked={r.confirma} onChange={(e) => mudar({ confirma: e.target.checked })} />
        <span className="min-w-0">A pessoa da foto autorizou o uso da imagem e da voz em vídeo (ou a imagem não é de uma pessoa real).</span>
      </label>
      <BotaoDeGerar custo={custo} rotulo="Gerar a fala" motivo={motivo} onConfirmar={gerar} icone={<Mic className="mr-1.5 h-3.5 w-3.5" />} extra={motor && duracao ? `${motor.rotulo}, ${Math.ceil(duracao)} s de fala` : null} />
    </div>
  );
}
