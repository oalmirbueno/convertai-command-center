import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAvisarErro } from "@/components/mesa/Custo";
import type { FormatoDoMotion } from "../../../supabase/functions/mesa-motion/modulos/cena-hf";
import type { ModoDoPedidoDaCena } from "../../../supabase/functions/mesa-motion/modulos/motion-metodo";
import { chamarMotion, CHAVES, type Filme, uidDoClique, useGuardarFilme } from "./motionApi";

/** Um pedido do lote: a cena, o modo e (na final) só os formatos que faltam. */
export interface PedidoDoLote {
  cenaId: string;
  modo: ModoDoPedidoDaCena;
  formatos?: FormatoDoMotion[];
  /** Nome da cena no aviso de erro ("Cena 3"). */
  rotulo?: string;
}

const NOME_DO_MODO: Record<ModoDoPedidoDaCena, [string, string]> = { still: ["still", "stills"], amostra: ["amostra", "amostras"], final: ["cena final", "cenas finais"] };

/** Pedir still, amostra ou final de uma cena (ou de várias, em lote), cancelar e salvar: o que as etapas de cena usam. */
export function useAcoesDaCena(filme: Filme) {
  const qc = useQueryClient();
  const guardar = useGuardarFilme();
  const avisarErro = useAvisarErro();
  const [ocupado, setOcupado] = useState<string | null>(null);
  // O lote tem estado próprio: o "ocupado" volta a null entre uma cena e outra.
  const [lote, setLote] = useState<string | null>(null);

  const releFila = () => void qc.invalidateQueries({ queryKey: CHAVES.fila(filme.id) });

  /** Devolve se entrou na fila. Silencioso (lote): sem o aviso de sucesso por cena; o erro de cada cena continua avisando. */
  const pedir = async (cenaId: string, modo: ModoDoPedidoDaCena, formatos?: FormatoDoMotion[], opcoes: { silencioso?: boolean; rotulo?: string } = {}): Promise<boolean> => {
    if (!opcoes.silencioso) setOcupado(`${cenaId}:${modo}`);
    try {
      await chamarMotion("cena_pedir", { filme_id: filme.id, cena_id: cenaId, modo, formatos, uid: uidDoClique(modo) });
      if (!opcoes.silencioso) {
        toast.success(modo === "still" ? "Still na fila da máquina da agência." : modo === "amostra" ? "Amostra de 5 s na fila." : "Cena final na fila (todos os formatos).");
        releFila();
      }
      return true;
    } catch (e) {
      avisarErro(e, opcoes.rotulo ? `${opcoes.rotulo}: o pedido não entrou na fila` : "O pedido não entrou na fila");
      return false;
    } finally {
      if (!opcoes.silencioso) setOcupado(null);
    }
  };

  /** Vários pedidos, um depois do outro, com um aviso só no fim ("5 stills na fila, 1 não entrou"). */
  const pedirEmLote = async (chave: string, itens: PedidoDoLote[]): Promise<number> => {
    if (lote || !itens.length) return 0;
    setLote(chave);
    let entraram = 0;
    try {
      for (const it of itens) if (await pedir(it.cenaId, it.modo, it.formatos, { silencioso: true, rotulo: it.rotulo })) entraram++;
    } finally {
      setLote(null);
      releFila();
    }
    const falharam = itens.length - entraram;
    const nome = NOME_DO_MODO[itens[0].modo];
    if (entraram) toast.success(`${entraram} ${entraram === 1 ? nome[0] : nome[1]} na fila${falharam ? `, ${falharam} não ${falharam === 1 ? "entrou" : "entraram"}` : ""}.`);
    return entraram;
  };

  const cancelar = async (pedidoId: string) => {
    try {
      await chamarMotion("render_cancelar", { filme_id: filme.id, pedido_id: pedidoId });
      releFila();
    } catch (e) {
      avisarErro(e, "Não foi possível cancelar");
    }
  };

  /** Devolve a cena gravada (ou null quando não salvou; o erro já avisou). */
  const salvarCena = async (cena: Record<string, unknown>, titulo = "A cena não foi salva"): Promise<Filme | null> => {
    try {
      const d = await chamarMotion<{ filme: Filme }>("cena_salvar", { filme_id: filme.id, cena });
      guardar(d.filme);
      return d.filme;
    } catch (e) {
      avisarErro(e, titulo);
      return null;
    }
  };

  return { pedir, pedirEmLote, lote, cancelar, salvarCena, ocupado, releFila };
}
