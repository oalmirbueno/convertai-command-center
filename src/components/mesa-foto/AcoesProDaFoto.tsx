import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FerramentasDaImagem } from "@/components/ferramentas/FerramentasDaImagem";
import type { ResultadoDaFerramenta } from "@/components/ferramentas/ferramentasApi";
import { useMesa } from "@/components/mesa/MesaContexto";
import { acrescentarFotos, ehSemFundo, invalidarFotos, normalizarFoto, semearUrl, type FotoDoAcervo } from "./fotoApi";

/**
 * Ferramentas profissionais de imagem (frente L, 26/09: Ampliar 2x e 4x
 * fiel, Ampliar criativo e "Tirar fundo (pro)", por API externa) no lugar
 * certo de cada tela da Mesa Foto: o detalhe da foto em Fotos, a variação
 * aprovada do clone (ampliar para enviar ao cliente) e o resultado escolhido
 * no Book. Custo à vista no botão; sem a chave no servidor, o componente
 * mostra o aviso e deixa os botões desligados.
 *
 * O que sai é uma derivada nova no acervo (o original não muda): entra no
 * cache na hora, com a URL já assinada, e a tela pode abrir a nova foto.
 */
export default function AcoesProDaFoto({
  foto,
  mostrarCriativo = true,
  onPronta,
  className = "",
}: {
  foto: Pick<FotoDoAcervo, "id" | "tags" | "referencia_web">;
  mostrarCriativo?: boolean;
  /** A derivada pronta (para abrir ou marcar na tela). */
  onPronta?: (nova: FotoDoAcervo) => void;
  className?: string;
}) {
  const { clientId, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  // Referência da internet é uso interno: não vira foto de entrega.
  if (foto.referencia_web) return null;
  const aoConcluir = (r: ResultadoDaFerramenta) => {
    const nova = normalizarFoto(r.imagem);
    if (nova) {
      semearUrl(queryClient, nova.storage_bucket, nova.storage_path, r.url || r.imagem.url || null);
      acrescentarFotos(queryClient, clientId, [nova]);
      if (onPronta) onPronta(nova);
    }
    invalidarFotos(queryClient, clientId);
    atualizarCusto();
    if (r.avisos.length) toast.message("Confira a versão nova", { description: r.avisos.join(" ") });
  };
  return (
    <div className={`min-w-0 ${className}`} data-ferramentas-pro={foto.id}>
      <FerramentasDaImagem clientId={clientId} imagemId={foto.id} mostrarCriativo={mostrarCriativo} semTirarFundo={ehSemFundo(foto)} aoConcluir={aoConcluir} />
    </div>
  );
}
