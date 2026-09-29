import { lazy, Suspense, useState, type ComponentType } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Loader2, Scissors, SplitSquareHorizontal } from "lucide-react";
import { toast } from "sonner";
import { useMesa, useUrlDaMesa } from "@/components/mesa/MesaContexto";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import Secao from "@/components/sistema/Secao";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { CampoDeFormulario, GrupoDeCampos } from "@/components/sistema/Formulario";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campo, campoTexto, juntar, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { custoNaTela, novoUid, useMotoresDaMesa } from "@/lib/mesa-videos/api";
import { duracaoNoMotor, motorDoNivel, motorPorId, type NivelDoMotor } from "../../../supabase/functions/_shared/modelos-de-video";
import { BotaoDeGerar, EscolherImagem, SeletorDeMotor } from "./PecasDoGerador";
import { chamarMesaVideos, chaveDosArquivos, chaveDosPedidos, useArquivosDeVideo } from "./videosApi";

/**
 * Antes e depois de UMA foto só (frente V-A, kit Antes e depois):
 * 1. a partir da foto, gerar a outra versão (o antes ou o depois) com o modelo
 *    de imagem do painel (o mesmo das outras telas, sem trocar);
 * 2. um vídeo curto de cada imagem (o mesmo motor, prompt e movimento);
 * 3. montar no editor lado a lado, em cortina ou em sequência (a Mesa Edição
 *    desenha; aqui vai o projeto de edição com o layout em cada clipe).
 * O comparador com alavanca é da frente V-B (src/components/comparar); até ele
 * existir, vale o comparador simples daqui.
 */

type PropsDoComparador = { antes: string; depois: string; tipo: "imagem" | "video"; rotulo?: string };

// O comparador da V-B entra sozinho quando o arquivo existir (sem quebrar a compilação antes).
const daVB = import.meta.glob<{ default: ComponentType<PropsDoComparador> }>("/src/components/comparar/ComparadorAntesDepois.tsx");
const carregarDaVB = Object.keys(daVB)[0] ? daVB[Object.keys(daVB)[0]] : null;
const ComparadorDaVB = carregarDaVB ? lazy(carregarDaVB) : null;

/** Comparador simples: alavanca de arrastar (imagem) ou lado a lado (vídeo). */
export function ComparadorSimples({ antes, depois, tipo, rotulo = "Antes e depois" }: PropsDoComparador) {
  const [pos, setPos] = useState(50);
  if (tipo === "video") {
    return (
      <div className="grid grid-cols-2 gap-2" aria-label={rotulo}>
        {[antes, depois].map((u, i) => (
          <div key={u} className="relative w-full overflow-hidden rounded-md bg-black" style={{ paddingBottom: "177%" }}>
            <video src={u} controls playsInline preload="metadata" className="absolute inset-0 h-full w-full object-contain" />
            <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 text-[11px] text-white">{i ? "Depois" : "Antes"}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="min-w-0" aria-label={rotulo}>
      <div className="relative w-full overflow-hidden rounded-md bg-muted" style={{ paddingBottom: "125%" }}>
        <img src={depois} alt="Depois" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${pos}%` }}>
          <img src={antes} alt="Antes" className="absolute inset-y-0 left-0 h-full max-w-none object-cover" style={{ width: `${10000 / Math.max(1, pos)}%` }} />
        </div>
        <div className="absolute inset-y-0 w-0.5 bg-white" style={{ left: `${pos}%` }} aria-hidden="true" />
      </div>
      <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} className="mt-2 w-full accent-primary" aria-label="Alavanca do antes e depois" />
    </div>
  );
}

export function Comparador(p: PropsDoComparador) {
  if (ComparadorDaVB) {
    return (
      <Suspense fallback={<ComparadorSimples {...p} />}>
        <ComparadorDaVB {...p} />
      </Suspense>
    );
  }
  return <ComparadorSimples {...p} />;
}

function ParDeImagens({ antes, depois }: { antes: string; depois: string }) {
  const a = useUrlDaMesa(antes);
  const d = useUrlDaMesa(depois);
  if (!a.data || !d.data) return <div className="w-full animate-pulse rounded-md bg-muted" style={{ paddingBottom: "125%" }} />;
  return <Comparador antes={a.data} depois={d.data} tipo="imagem" />;
}

interface Rascunho {
  foto: string | null;
  direcao: "antes" | "depois";
  descricao: string;
  gerada: string | null;
  nivel: NivelDoMotor;
  motor: string;
  movimento: string;
  duracao: number;
  formato: string;
  videoAntes: string;
  videoDepois: string;
  layout: "lado_a_lado" | "cortina" | "sequencia";
}

const INICIAL: Rascunho = { foto: null, direcao: "depois", descricao: "", gerada: null, nivel: "normal", motor: "", movimento: "Very slow push-in, static tripod, same light.", duracao: 4, formato: "9:16", videoAntes: "", videoDepois: "", layout: "lado_a_lado" };

export default function AntesEDepois() {
  const { clientId, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const motores = useMotoresDaMesa();
  const arquivosQ = useArquivosDeVideo(clientId);
  const [r, setR] = useEstadoDaTela<Rascunho>(`mesa-videos:antes-depois:${clientId}`, INICIAL, { validar: (v) => !!v && typeof v === "object", esperaMs: 300 });
  const [gerandoImagem, setGerandoImagem] = useState(false);
  const [montando, setMontando] = useState(false);
  const mudar = (m: Partial<Rascunho>) => setR((x) => ({ ...x, ...m }));
  const antes = r.direcao === "depois" ? r.foto : r.gerada;
  const depois = r.direcao === "depois" ? r.gerada : r.foto;
  const motor = motorPorId(r.motor, motores.motores) || motorDoNivel(r.nivel, { modo: "primeiro_quadro", formato: r.formato }, motores.motores);
  const duracao = motor ? duracaoNoMotor(motor, r.duracao) : r.duracao;
  const custo = custoNaTela(motor, { duracao_s: duracao, variacoes: 2 });
  const estado = motor ? motores.lista.find((x) => x.motor.id === motor.id) : null;
  const gerados = ((arquivosQ.data && arquivosQ.data.arquivos) || []).filter((a) => a.tipo === "gerado" && a.estado !== "arquivado");

  const gerarImagem = async () => {
    if (!r.foto || !r.descricao.trim()) return;
    setGerandoImagem(true);
    try {
      const resp = await chamarMesaVideos<{ storage_path: string; custo_usd: number }>({ acao: "antes_depois_imagem", client_id: clientId, imagem_path: r.foto, direcao: r.direcao, descricao: r.descricao, formato: r.formato, uid: novoUid() });
      mudar({ gerada: resp.storage_path });
      atualizarCusto();
      void queryClient.invalidateQueries({ queryKey: chaveDosArquivos(clientId) });
      toast.success(`O ${r.direcao} ficou pronto`, { description: `US$ ${Number(resp.custo_usd || 0).toFixed(3).replace(".", ",")} na carteira.` });
    } catch (e) {
      toast.error("A imagem não saiu", { description: textoDoErro(e), duration: 9000 });
    } finally {
      setGerandoImagem(false);
    }
  };

  const gerarVideos = async (usd: number) => {
    if (!motor || !antes || !depois) return;
    // Mesmo motor, mesmo movimento, mesma duração: os dois vídeos casam na montagem.
    const metade = Math.round((usd / 2) * 10000) / 10000 + 0.0001;
    for (const [lado, quadro] of [["antes", antes], ["depois", depois]] as const) {
      await chamarMesaVideos({ acao: "gerar_video", tipo: "gerar_livre", client_id: clientId, motor: motor.id, modo: "primeiro_quadro", prompt: r.movimento, duracao_s: duracao, formato: r.formato, quadro_inicial_path: quadro, variacoes: 1, uid: novoUid(), custo_confirmado_usd: metade, titulo: `${lado === "antes" ? "Antes" : "Depois"} ${r.descricao}`.slice(0, 100) });
    }
    void queryClient.invalidateQueries({ queryKey: chaveDosPedidos(clientId) });
    atualizarCusto();
    toast.success("Os dois vídeos foram enviados", { description: "Quando ficarem prontos, escolha cada um abaixo e monte no editor." });
  };

  const montar = async () => {
    setMontando(true);
    try {
      await chamarMesaVideos({ acao: "antes_depois_para_editor", client_id: clientId, antes_arquivo_id: r.videoAntes, depois_arquivo_id: r.videoDepois, layout: r.layout, formato: r.formato, titulo: `Antes e depois ${r.descricao}`.slice(0, 120) });
      toast.success("Montado no editor", { description: "Abra a Mesa Edição para ajustar." });
    } catch (e) {
      toast.error("Não foi possível montar", { description: textoDoErro(e), duration: 9000 });
    } finally {
      setMontando(false);
    }
  };

  return (
    <div className="min-w-0 space-y-5" data-antes-e-depois="">
      <GrupoDeCampos>
        <EscolherImagem rotulo="Foto de partida" valor={r.foto} onEscolher={(c) => mudar({ foto: c, gerada: null })} />
        <div className="min-w-0">
          <p className={juntar(texto.rotulo, "mb-1.5")}>A foto é o</p>
          <SeletorCompacto rotulo="A foto é o" larguraTotal opcoes={[{ valor: "depois", rotulo: "Antes (gerar o depois)" }, { valor: "antes", rotulo: "Depois (gerar o antes)" }]} valor={r.direcao} onEscolher={(v) => mudar({ direcao: v as Rascunho["direcao"], gerada: null })} />
        </div>
      </GrupoDeCampos>
      <CampoDeFormulario rotulo={`Como é o ${r.direcao}`} largo apoio="Só o que muda. Câmera, luz e enquadramento ficam iguais.">
        <textarea className={juntar(campoTexto, "min-h-[72px]")} value={r.descricao} maxLength={600} onChange={(e) => mudar({ descricao: e.target.value })} placeholder={r.direcao === "depois" ? "Ex.: cozinha com armários brancos foscos e bancada de quartzo" : "Ex.: parede com mofo e piso quebrado"} />
      </CampoDeFormulario>
      <div className="flex min-w-0 flex-wrap items-center justify-end">
        <AjudaRecolhida rotulo="Custo da imagem" className="mr-2">
          Modelo de imagem do painel, cobrado na carteira do cliente.
        </AjudaRecolhida>
        <button type="button" className={botao.secundario} disabled={!r.foto || !r.descricao.trim() || gerandoImagem} onClick={() => void gerarImagem()}>
          {gerandoImagem ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <SplitSquareHorizontal className="mr-1.5 h-3.5 w-3.5" />}
          Gerar o {r.direcao}
        </button>
      </div>
      {antes && depois && <ParDeImagens antes={antes} depois={depois} />}
      {antes && depois && (
        <>
          <SeletorDeMotor lista={motores.lista} requisito={{ modo: "primeiro_quadro", formato: r.formato }} valor={motor ? motor.id : ""} nivel={r.nivel} onNivel={(n) => mudar({ nivel: n, motor: "" })} onEscolher={(id) => mudar({ motor: id })} rotulo="Motor dos dois vídeos" />
          <GrupoDeCampos>
            <CampoDeFormulario rotulo="Movimento (igual nos dois)">
              <input className={campo} value={r.movimento} maxLength={300} onChange={(e) => mudar({ movimento: e.target.value })} />
            </CampoDeFormulario>
            <div className="min-w-0">
              <p className={juntar(texto.rotulo, "mb-1.5")}>Formato</p>
              <SeletorCompacto rotulo="Formato" larguraTotal opcoes={(motor ? motor.formatos : ["9:16"]).map((f) => ({ valor: f, rotulo: f }))} valor={r.formato} onEscolher={(v) => mudar({ formato: v })} />
            </div>
          </GrupoDeCampos>
          <BotaoDeGerar custo={custo} rotulo="Gerar os dois vídeos" motivo={!motor ? "Escolha o motor." : estado && estado.estado !== "pronto" ? `${motor.rotulo}: ${estado.estado_rotulo.toLowerCase()}.` : null} onConfirmar={gerarVideos} extra="Dois vídeos com o mesmo movimento e a mesma duração." />
        </>
      )}
      {/* 28/09: o cabeçalho feito à mão virou Secao (recolhe) e os botões subiram para a linha do título. */}
      <Secao
        divisoria
        nivel={3}
        titulo="Montar no editor"
        acao={
          <>
            <Link to={`/mesa-edicao?client=${clientId}&etapa=editar`} className={botao.discreto}>
              <Scissors className="mr-1.5 h-3.5 w-3.5" />
              Mesa Edição
            </Link>
            <button type="button" className={botao.secundario} disabled={!r.videoAntes || !r.videoDepois || r.videoAntes === r.videoDepois || montando} onClick={() => void montar()}>
              {montando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Montar
            </button>
          </>
        }
      >
        <GrupoDeCampos colunas={3}>
          {(["videoAntes", "videoDepois"] as const).map((k) => (
            <CampoDeFormulario key={k} rotulo={k === "videoAntes" ? "Vídeo do antes" : "Vídeo do depois"}>
              <select className={campo} value={r[k]} onChange={(e) => mudar({ [k]: e.target.value } as Partial<Rascunho>)}>
                <option value="">Escolha</option>
                {gerados.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.nome}
                  </option>
                ))}
              </select>
            </CampoDeFormulario>
          ))}
          <div className="min-w-0">
            <p className={juntar(texto.rotulo, "mb-1.5")}>Layout</p>
            <SeletorCompacto rotulo="Layout" larguraTotal opcoes={[{ valor: "lado_a_lado", rotulo: "Lado a lado" }, { valor: "cortina", rotulo: "Cortina" }, { valor: "sequencia", rotulo: "Sequência" }]} valor={r.layout} onEscolher={(v) => mudar({ layout: v as Rascunho["layout"] })} />
          </div>
        </GrupoDeCampos>
      </Secao>
    </div>
  );
}
