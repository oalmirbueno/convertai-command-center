import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAvisarErro } from "@/components/mesa/Custo";
import type { FormatoDoMotion } from "../../../supabase/functions/_shared/cena-hf";
import type { ModoDoPedidoDaCena } from "../../../supabase/functions/_shared/motion-metodo";
import { chamarMotion, CHAVES, type Filme, uidDoClique, useGuardarFilme } from "./motionApi";

/** Pedir still, amostra ou final de uma cena, cancelar e salvar: o que as etapas de cena usam. */
export function useAcoesDaCena(filme: Filme) {
  const qc = useQueryClient();
  const guardar = useGuardarFilme();
  const avisarErro = useAvisarErro();
  const [ocupado, setOcupado] = useState<string | null>(null);

  const releFila = () => void qc.invalidateQueries({ queryKey: CHAVES.fila(filme.id) });

  const pedir = async (cenaId: string, modo: ModoDoPedidoDaCena, formatos?: FormatoDoMotion[]) => {
    setOcupado(`${cenaId}:${modo}`);
    try {
      await chamarMotion("cena_pedir", { filme_id: filme.id, cena_id: cenaId, modo, formatos, uid: uidDoClique(modo) });
      toast.success(modo === "still" ? "Still na fila da máquina da agência." : modo === "amostra" ? "Amostra de 5 s na fila." : "Cena final na fila (todos os formatos).");
      releFila();
    } catch (e) {
      avisarErro(e, "O pedido não entrou na fila");
    } finally {
      setOcupado(null);
    }
  };

  const cancelar = async (pedidoId: string) => {
    try {
      await chamarMotion("render_cancelar", { filme_id: filme.id, pedido_id: pedidoId });
      releFila();
    } catch (e) {
      avisarErro(e, "Não foi possível cancelar");
    }
  };

  const salvarCena = async (cena: Record<string, unknown>) => {
    try {
      const d = await chamarMotion<{ filme: Filme }>("cena_salvar", { filme_id: filme.id, cena });
      guardar(d.filme);
    } catch (e) {
      avisarErro(e, "A cena não foi salva");
    }
  };

  return { pedir, cancelar, salvarCena, ocupado, releFila };
}
