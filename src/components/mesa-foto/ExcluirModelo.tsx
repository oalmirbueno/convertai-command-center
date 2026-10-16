import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2, ArchiveRestore } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import { arquivarPersona, guardarPersona, chaveDasPersonas, type Persona } from "./modelosApi";
import { botao, juntar } from "@/components/sistema";

export default function ExcluirModelo({ persona }: { persona: Persona }) {
  const { clientId, isAdmin } = useMesa();
  const cache = useQueryClient();
  const erro = useAvisarErro();
  const [confirmar, setConfirmar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const excluido = persona.status === "arquivada";
  if (!persona.client_id && !isAdmin) return null;
  const executar = async () => {
    setOcupado(true);
    try {
      const salvo = await arquivarPersona(persona.id, !excluido);
      if (!salvo || salvo.id !== persona.id || (!excluido && salvo.status !== "arquivada")) throw new Error("A alteração do modelo não foi confirmada.");
      await cache.cancelQueries({ queryKey: chaveDasPersonas(clientId).slice(0, 2) });
      guardarPersona(cache, clientId, salvo);
      // Modelos da agência podem estar nos seletores de mais de um cliente.
      cache.setQueriesData<Persona[]>({ queryKey: chaveDasPersonas(clientId).slice(0, 2) }, (lista) => lista?.map((p) => p.id === salvo.id ? salvo : p));
      setConfirmar(false);
      toast.success(excluido ? "Modelo restaurado" : "Modelo excluído da seleção", { description: excluido ? undefined : "Fotos preservadas. Para desfazer, abra Arquivadas e restaure." });
    } catch (e) { erro(e, excluido ? "Modelo não restaurado" : "Modelo não excluído"); }
    finally { setOcupado(false); }
  };
  return <>
    <button className={juntar(botao.icone, "shrink-0 disabled:opacity-50")} type="button" aria-label={`${excluido ? "Restaurar" : "Excluir"} modelo ${persona.nome}`} disabled={ocupado} onClick={() => excluido ? void executar() : setConfirmar(true)} title={excluido ? "Restaurar" : "Excluir"}>
      {excluido ? <ArchiveRestore className="h-4 w-4" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
    </button>
    <AlertDialog open={confirmar} onOpenChange={(v) => !ocupado && setConfirmar(v)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Excluir {persona.nome} da seleção?</AlertDialogTitle><AlertDialogDescription>O modelo sai dos seletores e fica em Arquivadas, onde pode ser restaurado. As fotos e gerações feitas com ele são preservadas.{!persona.client_id ? " Este modelo pertence à agência: a mudança vale para todos os clientes." : ""}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={ocupado}>Cancelar</AlertDialogCancel><Button disabled={ocupado} onClick={() => void executar()}>{ocupado ? "Excluindo…" : "Excluir modelo"}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}
