import { useState } from "react";
import { Clapperboard, Download } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { AjudaRecolhida, botao, juntar } from "@/components/sistema";
import { downloadFile } from "@/lib/fileActions";
import { chamarFuncao, type ParteDaEstimativa } from "@/lib/mesa/api";
import { CUSTO_ESTIMADO_DO_GIF_USD, type GifDaLamina as Gif } from "../../../supabase/functions/estudio-arte/gif-da-arte";
import { BotaoComCusto } from "./Custo";
import { ImagemDaMesa, useUrlDaMesa } from "./MesaContexto";

/** Peça a mais da lâmina (05/11/2026): um GIF novo com o texto e a direção dela, sem mudar a arte. Custo à vista no botão. */
export const partesDoGif = (): ParteDaEstimativa[] => [{ modeloId: null, tipo: "texto", fixoUsd: CUSTO_ESTIMADO_DO_GIF_USD }];

export const textoDosQuadros = (quadros: number) => (quadros > 1 ? `Animado, ${quadros} quadros` : "Veio com 1 quadro, sem movimento");

export default function GifDaLamina({ trabalhoId, ordem, gifs, ocupado, onPronto }: { trabalhoId: string; ordem: number; gifs: Gif[]; ocupado: boolean; onPronto: () => void }) {
  const [movimento, setMovimento] = useState("");
  const ultimo = gifs.filter((g) => g.ordem === ordem).slice(-1)[0] || null;
  const { data: url } = useUrlDaMesa(ultimo?.storage_path);
  return (
    <section className="min-w-0 border-t pt-3" aria-label="GIF desta arte" data-gif-da-lamina={ordem}>
      {/* Só o título; o aviso de que sai parecido, não igual, fica no "?" (SISTEMA.md, seção 5). */}
      <div className="mb-2 flex min-w-0 items-center">
        <p className="min-w-0 truncate text-[12px] font-medium">GIF desta arte</p>
        <AjudaRecolhida className="ml-1" rotulo="Sobre o GIF desta arte">
          Sai parecido com a arte, não igual: usa o texto e a direção dela. Confira o texto antes de usar.
        </AjudaRecolhida>
      </div>
      <div className="flex min-w-0 items-center">
        <Input value={movimento} onChange={(e) => setMovimento(e.target.value)} maxLength={300} placeholder="Movimento (opcional). Ex.: o produto gira devagar" className="mr-2 h-8 min-w-0 flex-1 text-[13px]" aria-label="Movimento do GIF" />
        <BotaoComCusto
          rotulo={<><Clapperboard className="mr-1 h-4 w-4" aria-hidden="true" />Fazer GIF</>}
          titulo={`GIF da lâmina ${ordem}`}
          descricao="Cria um GIF novo com o texto e a direção desta lâmina, no GPT Image 2.6. Fica parecido com a arte, não igual: o gerador não anima uma imagem pronta. A arte não muda."
          className="h-8 shrink-0 px-2.5"
          disabled={ocupado}
          partes={partesDoGif}
          executar={() => chamarFuncao<any>("estudio-arte", { acao: "gif_card", trabalho_id: trabalhoId, ordem, movimento: movimento.trim() || undefined })}
          aoConcluir={(r) => {
            if (r?.gif && r.gif.quadros < 2) toast.message("O GIF veio sem movimento", { description: "O gerador devolveu 1 quadro. Tente de novo ou use Animar na Mesa Foto." });
            onPronto();
          }}
        />
      </div>
      {ultimo && (
        <div className="mt-2 flex min-w-0 items-center">
          <ImagemDaMesa caminho={ultimo.storage_path} alt={`GIF da lâmina ${ordem}`} className="mr-2 h-16 w-16 shrink-0 rounded-md" />
          <p className="min-w-0 flex-1 text-[12px] text-muted-foreground" data-gif-quadros={ultimo.quadros}>{textoDosQuadros(ultimo.quadros)}</p>
          <button type="button" className={juntar(botao.icone, "ml-2 shrink-0")} aria-label="Baixar o GIF" title="Baixar o GIF" disabled={!url} onClick={() => url && void downloadFile(url, `lamina-${ordem}.gif`)}>
            <Download className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </section>
  );
}
