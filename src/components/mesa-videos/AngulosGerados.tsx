import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, Rotate3d } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { MiniaturaDoStorage } from "@/components/mesa/ContextoMiniatura";
import Secao from "@/components/sistema/Secao";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { botao, juntar, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import type { IrPara } from "./MesaDeVideo";
import { chamarMesaVideos, chaveDosArquivos, type ArquivoDeVideo } from "./videosApi";

/**
 * Imagens do gerador nos Resultados (frente V-A): ângulos gerados e quadros
 * (último quadro, antes e depois). Arquivar não apaga e tem Desfazer.
 */
export default function AngulosGerados({ arquivos, irPara }: { arquivos: ArquivoDeVideo[]; irPara: IrPara }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const [filtro, setFiltro] = useState<"angulo" | "quadro">("angulo");
  const imagens = arquivos.filter((a) => (a.tipo === "angulo" || a.tipo === "quadro") && a.estado !== "arquivado");
  if (!imagens.length) return null;
  const visiveis = imagens.filter((a) => a.tipo === filtro);
  const arquivar = async (a: ArquivoDeVideo) => {
    try {
      await chamarMesaVideos({ acao: "arquivo_editar", arquivo_id: a.id, campos: { estado: "arquivado" } });
      void queryClient.invalidateQueries({ queryKey: chaveDosArquivos(clientId) });
      toast.success("Arquivado", {
        action: { label: "Desfazer", onClick: () => void chamarMesaVideos({ acao: "arquivo_editar", arquivo_id: a.id, campos: { estado: "ativo" } }).then(() => queryClient.invalidateQueries({ queryKey: chaveDosArquivos(clientId) })) },
      });
    } catch (e) {
      toast.error("Não foi possível arquivar", { description: textoDoErro(e) });
    }
  };
  return (
    <Secao
      titulo="Imagens"
      descricao={`${imagens.filter((a) => a.tipo === "angulo").length} ângulos · ${imagens.filter((a) => a.tipo === "quadro").length} quadros`}
      acao={
        <>
          <SeletorCompacto rotulo="Tipo de imagem" opcoes={[{ valor: "angulo", rotulo: "Ângulos" }, { valor: "quadro", rotulo: "Quadros" }]} valor={filtro} onEscolher={(v) => setFiltro(v as "angulo" | "quadro")} />
          <button type="button" className={juntar(botao.secundario, "ml-2")} onClick={() => irPara("gerar", { modo: "angulo" })} aria-label="Novo ângulo">
            <Rotate3d className="h-3.5 w-3.5 sm:mr-1.5" />
            <span className="hidden sm:inline">Novo ângulo</span>
          </button>
        </>
      }
      data-imagens-do-gerador=""
    >
      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6" aria-label="Imagens geradas">
        {visiveis.map((a) => (
          <li key={a.id} className="group min-w-0">
            <div className="relative w-full overflow-hidden rounded-md bg-muted" style={{ paddingBottom: "125%" }}>
              <MiniaturaDoStorage bucket={a.storage_bucket || "mesa"} caminho={a.storage_path} alt={a.nome} className="absolute inset-0 h-full w-full" />
            </div>
            <div className="mt-1 flex min-w-0 items-center">
              <p className={juntar(texto.auxiliar, "min-w-0 flex-1 truncate")} title={a.nota || a.nome}>
                {a.nome}
              </p>
              <button type="button" className={botao.icone} onClick={() => void arquivar(a)} aria-label={`Arquivar ${a.nome}`} title="Arquivar (não apaga)">
                <Archive className="h-3.5 w-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Secao>
  );
}
