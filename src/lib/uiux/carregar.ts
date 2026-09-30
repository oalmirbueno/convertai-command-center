import { useEffect, useState } from "react";
import type { BaseParaConsulta } from "../../../supabase/functions/_shared/uiux/consultas";

/**
 * A base UI UX Pro Max na TELA, sob demanda (frente UXM, 30/09/2026): o
 * índice leve (estilos, produtos, raciocínio, padrões e regras de UX só com
 * os campos que a tela usa) e os rótulos em português entram por import
 * dinâmico, só quando a pessoa abre "Estilos da base", "Paletas do setor",
 * "Pares da base" ou a Revisão de UX. Nada disso entra no pedaço principal nem
 * na pré-carga ociosa. A base inteira fica no servidor (uiux/base-completa.ts).
 */

type ModuloPt = typeof import("../../../supabase/functions/_shared/uiux/pt");
type ModuloRevisao = typeof import("../../../supabase/functions/_shared/uiux/revisao-ux");

export type BaseDaTela = { base: BaseParaConsulta; pt: ModuloPt };

let promessaDaBase: Promise<BaseDaTela> | null = null;
let promessaDaRevisao: Promise<ModuloRevisao> | null = null;

export function carregarBaseDaTela(): Promise<BaseDaTela> {
  if (!promessaDaBase) {
    promessaDaBase = Promise.all([import("../../../supabase/functions/_shared/uiux/dados/indice-leve"), import("../../../supabase/functions/_shared/uiux/pt")]).then(([i, pt]) => ({
      pt,
      base: { estilos: i.ESTILOS_LEVES, produtos: i.PRODUTOS_LEVES, raciocinio: i.RACIOCINIO_LEVE, padroes: i.PADROES_LEVES, ux: i.REGRAS_DE_UX_LEVES },
    }));
    // Sem rede: a próxima abertura tenta de novo.
    promessaDaBase.catch(() => {
      promessaDaBase = null;
    });
  }
  return promessaDaBase;
}

/** O checklist das regras de UX (itensDoChecklistDeUx), também sob demanda. */
export function carregarRevisaoDeUx(): Promise<ModuloRevisao> {
  if (!promessaDaRevisao) {
    promessaDaRevisao = import("../../../supabase/functions/_shared/uiux/revisao-ux");
    promessaDaRevisao.catch(() => {
      promessaDaRevisao = null;
    });
  }
  return promessaDaRevisao;
}

/** Hook: carrega quando `ativo`; devolve a base ou o erro (a tela mostra "Tentar de novo"). */
export function useBaseDaTela(ativo = true): { base: BaseDaTela | null; erro: string | null; tentarDeNovo: () => void } {
  const [base, setBase] = useState<BaseDaTela | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [vez, setVez] = useState(0);
  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    setErro(null);
    carregarBaseDaTela()
      .then((b) => {
        if (vivo) setBase(b);
      })
      .catch(() => {
        if (vivo) setErro("A base de design não carregou. Confira a conexão e tente de novo.");
      });
    return () => {
      vivo = false;
    };
  }, [ativo, vez]);
  return { base, erro, tentarDeNovo: () => setVez((v) => v + 1) };
}

export function useRevisaoDeUx(ativo = true): ModuloRevisao | null {
  const [m, setM] = useState<ModuloRevisao | null>(null);
  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    carregarRevisaoDeUx()
      .then((x) => {
        if (vivo) setM(x);
      })
      .catch(() => {
        if (vivo) setM(null);
      });
    return () => {
      vivo = false;
    };
  }, [ativo]);
  return m;
}

/** Rodapé do "?" de cada painel da base. */
export const CREDITO_DA_BASE = "Base: UI UX Pro Max 2.15.0 (MIT, Next Level Builder).";
