import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useMesa } from "@/components/mesa/MesaContexto";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { campo } from "@/components/sistema/estilos";
import { partesDaLeitura, type KitDeFoto } from "./fotoApi";
import { atualizarPublicoProduto, PUBLICOS_DO_PRODUTO, ROTULOS_PUBLICO } from "./produtoPublicoApi";

export default function PublicoDoProduto({ kit }: { kit: KitDeFoto }) {
  const { clientId, catalogo } = useMesa();
  const cache = useQueryClient();
  const erro = useAvisarErro();
  const [salvando, setSalvando] = useState(false);
  const publico = kit.atributos.organizacao?.publico;
  const alterar = async (valor: string) => {
    setSalvando(true);
    try { await atualizarPublicoProduto(cache, clientId, kit, valor); }
    catch (e) { erro(e, "Público não salvo"); }
    finally { setSalvando(false); }
  };
  return <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2" title={publico?.evidencia}>
    <select aria-label="Público do produto" className={`${campo} h-8 w-auto flex-1 text-[12px]`} value={publico?.valor || "nao_identificado"} disabled={salvando} onChange={(e) => void alterar(e.target.value)}>
      {PUBLICOS_DO_PRODUTO.map((p) => <option key={p} value={p}>{ROTULOS_PUBLICO[p]}</option>)}
    </select>
    <BotaoComCusto variant="outline" rotulo={publico ? "Reavaliar público" : "Identificar público"} titulo="Público identificado" descricao="Classifica o produto em masculino, feminino ou unissex. Quando não houver evidência, deixa a identificar." disabled={salvando} partes={() => partesDaLeitura(catalogo)} executar={() => atualizarPublicoProduto(cache, clientId, kit, "automatico", !!publico)} />
  </div>;
}
