import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { chamarFuncao } from "@/lib/mesa/api";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { campo, campoTexto, juntar } from "@/components/sistema/estilos";
import { MiniaturaDaFoto } from "./Comuns";
import { chaveDaBiblioteca, useFotos } from "./fotoApi";
import { gravarNaSessao, lerDaSessao } from "./sessao";
import { SESSAO_DO_ARSENAL } from "./escolhasDaLinha";

/**
 * Foto que veio de um resultado (Book, Aprovar) para o Arsenal (02/10, dono:
 * "selecionar uma foto do resultado e mandar para o Arsenal"): a foto e o
 * prompt que a gerou viram um prompt do cliente com o exemplo já pronto.
 */
export default function EntradaDoArsenal() {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const fotos = useFotos(clientId);
  const [entrada, setEntrada] = useState(() => lerDaSessao<{ imagemIds: string[]; prompt: string }>(clientId, SESSAO_DO_ARSENAL));
  const [titulo, setTitulo] = useState("");
  const [prompt, setPrompt] = useState(() => (entrada && entrada.prompt) || "");
  const [salvando, setSalvando] = useState(false);
  if (!entrada || !Array.isArray(entrada.imagemIds) || !entrada.imagemIds.length) return null;
  const vindas = (fotos.data || []).filter((f) => entrada.imagemIds.indexOf(f.id) >= 0);
  const fechar = () => {
    gravarNaSessao(clientId, SESSAO_DO_ARSENAL, null);
    setEntrada(null);
  };
  const salvar = async () => {
    if (salvando || !prompt.trim() || !vindas.length) return;
    setSalvando(true);
    try {
      await chamarFuncao<any>("mesa-foto", {
        acao: "biblioteca_salvar",
        client_id: clientId,
        item: {
          tipo: "prompt",
          categoria: "composicao",
          titulo: (titulo.trim() || vindas[0].nome).slice(0, 160),
          prompt_pt: prompt.trim().slice(0, 3000),
          storage_path: vindas[0].storage_path,
          tags: ["do_resultado", "area:produto"],
        },
      });
      void queryClient.invalidateQueries({ queryKey: chaveDaBiblioteca(clientId) });
      toast.success("Prompt guardado no Arsenal", { description: "Com a foto como exemplo." });
      fechar();
    } catch (e) {
      avisarErro(e, "Prompt não guardado");
    } finally {
      setSalvando(false);
    }
  };
  return (
    <section className="min-w-0 rounded-lg border border-primary/40 p-3" aria-label="Foto para o Arsenal" data-entrada-do-arsenal="">
      <div className="mb-2 flex min-w-0 items-center">
        <BookmarkPlus className="mr-1.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">Guardar no Arsenal</p>
        <AjudaRecolhida rotulo="Sobre guardar no Arsenal">O prompt fica no Arsenal deste cliente com a foto como exemplo. Copie e use em Fotos do produto, Foto com modelo ou no Book.</AjudaRecolhida>
        <button type="button" onClick={fechar} aria-label="Dispensar" className="ml-1 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex min-w-0 items-start">
        <div className="mr-3 flex shrink-0">
          {vindas.slice(0, 3).map((f) => (
            <span key={f.id} className="mr-1 w-16">
              <MiniaturaDaFoto foto={f} />
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Nome do prompt" aria-label="Nome do prompt" className={juntar(campo, "h-8 text-[12.5px]")} />
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} placeholder="O prompt que gerou a foto" aria-label="Prompt para o Arsenal" className={campoTexto} />
          <Button type="button" size="sm" className="h-8 text-[12px]" disabled={!prompt.trim() || salvando || !vindas.length} onClick={() => void salvar()}>
            {salvando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <BookmarkPlus className="mr-1.5 h-3.5 w-3.5" />} Guardar
          </Button>
        </div>
      </div>
    </section>
  );
}
