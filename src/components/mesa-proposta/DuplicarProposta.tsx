import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useClients } from "@/hooks/useSupabaseData";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { botao, campo } from "@/components/sistema/estilos";
import { aplicarNaLista, CHAVES, chamarProposta, type Proposta } from "./propostaApi";

/**
 * Duplicar a proposta (frente PRO2): no mesmo cliente leva tudo (vira uma
 * versão nova para negociar); para outro cliente leva só o que é da agência
 * (estrutura, processo, condições, itens, pacotes, pagamento, provas e
 * links), nunca o texto do cliente. Nasce em rascunho, com número novo.
 */
export default function DuplicarProposta({ proposta, aberta, onAberta, onAbrir }: { proposta: Proposta; aberta: boolean; onAberta: (v: boolean) => void; onAbrir?: (id: string) => void }) {
  const mesa = useMesa();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const avisarErro = useAvisarErro();
  const clientes = useClients();
  const [destino, setDestino] = useState(mesa.clientId);
  const [titulo, setTitulo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const opcoes = useMemo(
    () =>
      ((clientes.data || []) as any[])
        .map((c) => ({ id: String(c.id), nome: String(c.company_name || c.full_name || "Cliente") }))
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [clientes.data],
  );
  const outro = destino !== mesa.clientId;

  const duplicar = async () => {
    setOcupado(true);
    try {
      const d = await chamarProposta<any>("duplicar", { proposta_id: proposta.id, client_id: outro ? destino : undefined, titulo: titulo.trim() || undefined });
      const nova = d && d.proposta;
      onAberta(false);
      if (!outro) {
        const p = aplicarNaLista(qc, mesa.clientId, nova);
        toast.success(`Cópia criada: ${p ? p.numero : "proposta nova"}.`);
        if (p && onAbrir) onAbrir(p.id);
      } else {
        void qc.invalidateQueries({ queryKey: CHAVES.propostas(destino) });
        const id = nova && typeof nova.id === "string" ? nova.id : "";
        toast.success("Cópia criada no outro cliente.", {
          action: id ? { label: "Abrir", onClick: () => navigate(`/mesa-proposta?client=${destino}&etapa=contexto&proposta=${id}`) } : undefined,
        });
      }
    } catch (e) {
      avisarErro(e, "A proposta não foi duplicada");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Dialog open={aberta} onOpenChange={onAberta}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Duplicar a proposta {proposta.numero}</DialogTitle>
          <DialogDescription>{outro ? "Para outro cliente vai só o que é da agência." : "No mesmo cliente vai tudo, em rascunho."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <CampoDeFormulario rotulo="Cliente">
            <select value={destino} onChange={(e) => setDestino(e.target.value)} className={campo}>
              {opcoes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                  {c.id === mesa.clientId ? " (este)" : ""}
                </option>
              ))}
            </select>
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Título da cópia">
            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={120} className={campo} placeholder={outro ? "Proposta para o cliente" : `${proposta.titulo} (cópia)`} />
          </CampoDeFormulario>
        </div>
        <DialogFooter>
          <button type="button" className={botao.discreto} onClick={() => onAberta(false)}>
            Cancelar
          </button>
          <button type="button" className={botao.primario} onClick={() => void duplicar()} disabled={ocupado}>
            {ocupado ? "Duplicando..." : "Duplicar"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
