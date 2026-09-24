import { Camera, Layers, Wallet } from "lucide-react";
import { useMesa } from "@/components/mesa/MesaContexto";
import { estimarLocal, padraoPara, usd } from "@/lib/mesa/api";
import { useMesaFoto } from "./Comuns";
import { partesDaGeracao, resumoDoEnsaio, rotuloDoEstadoDoEnsaio, rotuloDoTipo, tomadasParaGerar, useEnsaios, useKits, useReceitas } from "./fotoApi";

/**
 * Segunda linha da barra da Mesa Foto: o kit e o ensaio abertos, o estado e
 * o custo (gasto no ensaio e estimativa do que falta gerar). O cliente fica
 * na linha de cima, sempre à vista. Tocar no kit ou no ensaio leva à etapa.
 */
export default function BarraDoEnsaio() {
  const { clientId, catalogo } = useMesa();
  const { kitId, ensaioId, irPara } = useMesaFoto();
  const kits = useKits(clientId);
  const ensaios = useEnsaios(clientId);
  const receitas = useReceitas();
  const kit = kitId ? (kits.data || []).find((k) => k.id === kitId) || null : null;
  const ensaio = ensaioId ? (ensaios.data || []).find((e) => e.id === ensaioId) || null : null;
  const receita = ensaio && receitas.data ? receitas.data.receitas.find((r) => r.id === ensaio.receita_id) || null : null;
  const resumo = resumoDoEnsaio(ensaio);
  const imagem = padraoPara(catalogo, "imagem");
  const faltam = tomadasParaGerar(ensaio).filter((t) => !t.versoes.length).length;
  const estimativa = ensaio && faltam && imagem ? estimarLocal(partesDaGeracao(imagem.id, "alta", faltam), catalogo) : null;

  return (
    <div className="mt-2 flex min-w-0 flex-wrap items-center text-[11.5px] text-muted-foreground" aria-label="Kit, ensaio e custo" data-barra-do-ensaio="">
      <button type="button" onClick={() => irPara("kits")} className="mr-3 inline-flex min-w-0 max-w-full items-center rounded-md py-0.5 hover:text-foreground">
        <Layers className="mr-1 h-3.5 w-3.5 shrink-0" />
        <span className="mr-1">Kit:</span>
        <span className={`min-w-0 truncate ${kit ? "font-medium text-foreground" : ""}`}>{kit ? `${kit.nome} · ${rotuloDoTipo(kit.tipo)}` : "nenhum"}</span>
      </button>
      <button type="button" onClick={() => irPara(ensaio ? "revisar" : "ensaio")} className="mr-3 inline-flex min-w-0 max-w-full items-center rounded-md py-0.5 hover:text-foreground">
        <Camera className="mr-1 h-3.5 w-3.5 shrink-0" />
        <span className="mr-1">Ensaio:</span>
        <span className={`min-w-0 truncate ${ensaio ? "font-medium text-foreground" : ""}`}>
          {ensaio ? `${receita ? receita.nome : ensaio.receita_id || "ensaio"} · ${rotuloDoEstadoDoEnsaio(ensaio.status)}` : "nenhum"}
        </span>
      </button>
      {ensaio && (
        <span className="mr-3 whitespace-nowrap tabular-nums">
          {resumo.aprovadas}/{resumo.total} aprovadas{resumo.paraRevisar ? ` · ${resumo.paraRevisar} para revisar` : ""}
        </span>
      )}
      {ensaio && (
        <span className="inline-flex items-center whitespace-nowrap tabular-nums">
          <Wallet className="mr-1 h-3.5 w-3.5" />
          gasto <span className="mx-1 font-medium text-foreground">{usd(resumo.custo)}</span>
          {estimativa !== null && (
            <>
              · falta gerar <span className="ml-1 font-medium text-foreground">~{usd(estimativa)}</span>
            </>
          )}
        </span>
      )}
    </div>
  );
}
