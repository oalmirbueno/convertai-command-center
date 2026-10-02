import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, FolderOpen, Loader2, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { botao, juntar } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { emPreparacao } from "@/lib/editor/api";
import { baixarPeloLink, enderecoDoWorkspace, finalParaOWorkspace, linkParaBaixar, pastaAnotada, podeSalvarNoCelular, salvarNoCelular } from "@/lib/edicao/baixarFinal";

/**
 * Os botões do vídeo pronto (Finais e barra do editor): Baixar (com o nome
 * certo), Salvar no celular (compartilhamento do sistema, só no celular) e
 * Abrir no Workspace (a pasta "Vídeos / <título> / Finais").
 */
export default function BotoesDoFinal({
  clientId,
  arquivoId,
  bucket,
  caminho,
  nome,
  origem,
  semWorkspace,
  className,
}: {
  clientId: string;
  /** video_arquivos.id (sem ele, sem "Abrir no Workspace"). */
  arquivoId: string | null;
  bucket: string | null;
  caminho: string;
  /** Nome do arquivo baixado ("Título (final 9:16).mp4"). */
  nome: string;
  origem?: Record<string, unknown> | null;
  /** Amostra: só baixar. */
  semWorkspace?: boolean;
  className?: string;
}) {
  const navigate = useNavigate();
  const [ocupado, setOcupado] = useState<"baixar" | "celular" | "workspace" | null>(null);
  const [prontoParaSalvar, setProntoParaSalvar] = useState<File | null>(null);
  const celular = podeSalvarNoCelular();

  const baixar = async () => {
    setOcupado("baixar");
    try {
      baixarPeloLink(await linkParaBaixar(bucket || "mesa", caminho, nome), nome);
    } catch (e) {
      toast.error("Não foi possível baixar", { description: textoDoErro(e) });
    } finally {
      setOcupado(null);
    }
  };

  const salvar = async () => {
    setOcupado("celular");
    try {
      const url = await linkParaBaixar(bucket || "mesa", caminho, nome);
      const r = await salvarNoCelular(url, nome, { pronto: prontoParaSalvar });
      if (r.resultado === "precisa_toque") {
        setProntoParaSalvar(r.arquivo || null);
        toast.info("Vídeo pronto no celular", { description: "Toque em Salvar agora para guardar na galeria." });
        return;
      }
      setProntoParaSalvar(null);
      if (r.resultado === "baixado") toast.success("Download começou", { description: nome });
    } catch (e) {
      toast.error("Não foi possível salvar no celular", { description: textoDoErro(e) });
    } finally {
      setOcupado(null);
    }
  };

  const abrir = async () => {
    if (!arquivoId) return;
    const anotada = pastaAnotada(origem);
    if (anotada) {
      navigate(enderecoDoWorkspace(clientId, anotada));
      return;
    }
    setOcupado("workspace");
    try {
      const r = await finalParaOWorkspace(arquivoId);
      if (r.workspace.estado === "em_andamento") {
        toast.info("O vídeo está indo para o Workspace", { description: "Tente de novo em instantes." });
        return;
      }
      if (!r.workspace.pasta_id) {
        toast.error("Este vídeo não vai para o Workspace", { description: r.workspace.motivo === "amostra" ? "Amostra fica só na Mesa." : undefined });
        return;
      }
      navigate(enderecoDoWorkspace(clientId, r.workspace.pasta_id));
    } catch (e) {
      toast.error("Não foi possível abrir no Workspace", { description: emPreparacao(e) ? "Falta publicar a função mesa-videos." : textoDoErro(e), duration: 9000 });
    } finally {
      setOcupado(null);
    }
  };

  const giro = <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  return (
    <span className={juntar("inline-flex shrink-0 items-center", className)} data-botoes-do-final="">
      <button type="button" className={juntar(botao.icone, "h-8 w-8")} onClick={() => void baixar()} disabled={!!ocupado} aria-label={`Baixar ${nome}`} title="Baixar" data-baixar-final="">
        {ocupado === "baixar" ? giro : <Download className="h-3.5 w-3.5" />}
      </button>
      {celular && (
        <button
          type="button"
          className={juntar(botao.icone, "h-8 w-8", prontoParaSalvar ? "text-primary" : "")}
          onClick={() => void salvar()}
          disabled={!!ocupado}
          aria-label={prontoParaSalvar ? "Salvar agora" : "Salvar no celular"}
          title={prontoParaSalvar ? "Salvar agora" : "Salvar no celular"}
          data-salvar-no-celular=""
        >
          {ocupado === "celular" ? giro : <Smartphone className="h-3.5 w-3.5" />}
        </button>
      )}
      {!semWorkspace && arquivoId && (
        <button type="button" className={juntar(botao.icone, "h-8 w-8")} onClick={() => void abrir()} disabled={!!ocupado} aria-label="Abrir no Workspace" title="Abrir no Workspace" data-abrir-no-workspace="">
          {ocupado === "workspace" ? giro : <FolderOpen className="h-3.5 w-3.5" />}
        </button>
      )}
    </span>
  );
}
