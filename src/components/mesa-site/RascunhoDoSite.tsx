import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FilePenLine, Loader2, Save, Trash2 } from "lucide-react";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { botao, juntar, texto } from "@/components/sistema/estilos";
import type { TrabalhoDoMotor } from "../../../supabase/functions/_shared/motor-codigo";
import { estadoDoRascunho, podeMexerNoRascunho } from "../../../supabase/functions/mesa-site/modulos/obra-do-site";
import { CHAVES, chamarMotor, type LinhaDoSite } from "./siteApi";

/**
 * Rascunho x versão salva (Gravyx, 19/10/2026): o motor escreve num rascunho
 * e a prévia mostra o rascunho. Esta linha diz que há trocas ainda não
 * salvas e oferece Salvar versão (vira a versão salva, com origem, modelo e
 * de qual veio) e Descartar rascunho (a prévia volta à versão salva). Os dois
 * são máquina, sem custo; esperam o motor parar de mexer no rascunho.
 */
export default function RascunhoDoSite({ site, trabalhos }: { site: LinhaDoSite; trabalhos: TrabalhoDoMotor[] }) {
  const { clientId } = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const [ocupado, setOcupado] = useState<"salvar" | "descartar" | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const r = estadoDoRascunho(trabalhos);
  if (!r.aberto) return null;
  const pode = podeMexerNoRascunho(r);
  const n = r.trabalhos.length;

  const pedir = async (tipo: "salvar" | "descartar") => {
    setOcupado(tipo);
    try {
      await chamarMotor("pedir", { client_id: clientId, site_id: site.id, tipo });
      void qc.invalidateQueries({ queryKey: CHAVES.trabalhos(site.id) });
    } catch (e) {
      avisarErro(e, tipo === "salvar" ? "A versão não foi salva" : "O rascunho não foi descartado");
    } finally {
      setOcupado(null);
    }
  };

  const titulo = r.emAndamento ? "O motor está escrevendo no rascunho" : `Rascunho com ${n} ${n === 1 ? "troca" : "trocas"} do motor, ainda não salvo`;
  return (
    <div className="flex min-w-0 items-center" role="status" data-rascunho-do-site={r.emAndamento ? "em_andamento" : "aberto"}>
      <FilePenLine className="mr-2 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")} title={`${titulo}. A prévia mostra o rascunho; publicar sobe só a versão salva. Salvar e descartar não custam nada.`}>
        {titulo}
      </span>
      <button
        type="button"
        className={juntar(botao.icone, "ml-1")}
        aria-label="Descartar rascunho"
        title={pode.ok ? "Descartar rascunho (a prévia volta à versão salva, sem custo)" : pode.motivo || "Descartar rascunho"}
        disabled={!pode.ok || !!ocupado}
        onClick={() => setConfirmando(true)}
        data-descartar-rascunho=""
      >
        {ocupado === "descartar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
      </button>
      <button
        type="button"
        className={juntar(botao.primario, "ml-1 h-8 px-3")}
        title={pode.ok ? "Salvar a versão (sem custo): o rascunho vira a versão salva" : pode.motivo || "Salvar versão"}
        disabled={!pode.ok || !!ocupado}
        onClick={() => void pedir("salvar")}
        data-salvar-versao=""
      >
        {ocupado === "salvar" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Save className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
        Salvar versão
      </button>
      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar o rascunho?</AlertDialogTitle>
            <AlertDialogDescription>
              {`${n === 1 ? "A mudança do motor que ainda não virou versão sai" : `As ${n} mudanças do motor que ainda não viraram versão saem`} do código e a prévia volta para a versão salva. Sem custo. O gasto de IA dessas mudanças já aconteceu.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void pedir("descartar")} data-confirmar-descartar="">
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
