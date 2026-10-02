import { useMemo } from "react";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useKitDaMesa } from "@/components/mesa/kitDaMesa";
import { letraDaMarcaParaVideo } from "@/lib/editor/estilosDeTexto";
import { useTipografiaDaMarca } from "@/lib/mesa/tipografiaDoCliente";
import type { MarcaDaEdicao } from "@/lib/editor/edicaoCompleta";

/**
 * A marca aberta para o editor (saiu de PainelEditarComIA em 02/10 para o
 * agente usar a MESMA marca do EDIT IA PRO sem import circular): cores do kit,
 * logo e a LETRA da marca (as fontes que valem para ela, pela regra de
 * herança: outra marca nunca herda a letra da principal).
 */

/** Cor de destaque da marca aberta: a primária da paleta (ou a primeira). */
export function corDaPaleta(paleta: { hex: string; papel: string }[] | null | undefined): string | null {
  const l = (paleta || []).filter((c) => /^#[0-9a-fA-F]{6}$/.test(String(c.hex || "")));
  const p = l.find((c) => /prim|principal|destaque/i.test(String(c.papel || ""))) || l[0];
  return p ? p.hex : null;
}

export function useMarcaDoEditor(): MarcaDaEdicao | null {
  const kit = useKitDaMesa();
  const { clientId } = useMesa();
  const tipografia = useTipografiaDaMarca(clientId, kit.marca);
  const daMarca = tipografia.data ? tipografia.data.daMarca : null;
  return useMemo(() => {
    const paleta = kit.data ? kit.data.paleta : null;
    const cor = corDaPaleta(paleta);
    const outras = (paleta || []).filter((c) => /^#[0-9a-fA-F]{6}$/.test(String(c.hex || "")) && c.hex !== cor);
    const nome = kit.marca ? kit.marca.nome : null;
    const letra = letraDaMarcaParaVideo(daMarca);
    if (!cor && !nome && !letra && !(kit.data && kit.data.logo_path)) return null;
    return { nome, cor, cor2: outras[0] ? outras[0].hex : null, fonte: letra ? letra.familia : null, fonte_path: letra ? letra.caminho : null, logo_path: (kit.data && kit.data.logo_path) || null };
  }, [kit.data, kit.marca, daMarca]);
}
