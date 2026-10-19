import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, FolderDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/shared/confirmDialog";
import { useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { ultimasVersoes, type Trabalho } from "@/components/mesa/useItensDoMes";
import { arquivarArteRapida, arteDoTrabalho, gravarArteRapidaNoCache, guardarNoLaboratorio, type RespostaDoGuardar } from "@/components/mesa/arteRapidaApi";
import { repetirEntregaEmPartes } from "@/lib/mesa/entregaEmPartes";
import { textoDoErro } from "@/lib/mesa/api";
import { botao, juntar } from "@/components/sistema/estilos";

/** O que ficou gravado no trabalho depois de guardar (direcao.laboratorio). */
export function guardadoDoTrabalho(t: Trabalho | null | undefined): { caminho: string[]; guardado_em: string | null; node_ids: string[] } | null {
  const d = t && t.direcao ? (t.direcao as unknown as { laboratorio?: unknown }).laboratorio : null;
  if (!d || typeof d !== "object") return null;
  const g = d as { caminho?: unknown; guardado_em?: unknown; node_ids?: unknown };
  const caminho = Array.isArray(g.caminho) ? g.caminho.map((x) => String(x)).filter(Boolean) : [];
  if (!caminho.length) return null;
  return {
    caminho,
    guardado_em: typeof g.guardado_em === "string" ? g.guardado_em : null,
    node_ids: Array.isArray(g.node_ids) ? g.node_ids.map((x) => String(x)) : [],
  };
}

/**
 * 19/10: a ferramenta Entrega da peça no Estúdio livre. No lugar do "Levar para a Agenda", guarda as
 * lâminas no arquivo livre (Workspace global: Laboratório / Livres ou o cliente / Estúdio livre / dia).
 * Nada vai para os Arquivos do cliente, a Agenda ou a aprovação. Sem custo de IA; dá para ajustar e
 * guardar de novo (só a lâmina nova sobe).
 */
export default function GuardarNoLaboratorio({ trabalho }: { trabalho: Trabalho }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const confirmar = useConfirm();
  const avisarErro = useAvisarErro();
  const [guardando, setGuardando] = useState(false);
  const [arquivando, setArquivando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<RespostaDoGuardar["laboratorio"] | null>(null);
  const a = arteDoTrabalho(trabalho);
  const cards = (trabalho.direcao && Array.isArray(trabalho.direcao.cards) ? trabalho.direcao.cards : []).length;
  const feitas = ultimasVersoes(trabalho.cards || []).size;
  const todas = cards > 0 && feitas >= cards;
  const antes = guardadoDoTrabalho(trabalho);
  const caminho = feito ? feito.caminho : antes ? antes.caminho : null;

  const guardar = async () => {
    setErro(null);
    setGuardando(true);
    try {
      const r = await repetirEntregaEmPartes(() => guardarNoLaboratorio(trabalho.id));
      if (r && r.trabalho) gravarArteRapidaNoCache(queryClient, clientId, r.trabalho, "laboratorio");
      setFeito(r ? r.laboratorio : null);
      toast.success("Arte no arquivo livre", { description: r && r.laboratorio ? r.laboratorio.caminho.join(" / ") : undefined });
    } catch (e) {
      setErro(textoDoErro(e, "Não foi possível guardar."));
    } finally {
      setGuardando(false);
      void queryClient.invalidateQueries({ queryKey: ["mesa", "arte-rapida", clientId] });
    }
  };

  const arquivar = async () => {
    const ok = await confirmar({
      title: "Arquivar esta arte?",
      description: "Ela sai do histórico do Estúdio livre. Nada é apagado: as versões e o que foi guardado ficam.",
    });
    if (!ok) return;
    setArquivando(true);
    try {
      const r = await arquivarArteRapida(trabalho.id);
      gravarArteRapidaNoCache(queryClient, clientId, r.trabalho, "laboratorio");
      void queryClient.invalidateQueries({ queryKey: ["mesa", "arte-rapida", clientId] });
      toast.success("Arte arquivada");
    } catch (e) {
      avisarErro(e, "Não foi possível arquivar");
    } finally {
      setArquivando(false);
    }
  };

  return (
    <div className="space-y-4" data-guardar-no-laboratorio={trabalho.id}>
      {a && (
        <div className="rounded-lg bg-muted px-3 py-2.5">
          <p className="text-[11px] font-medium text-muted-foreground">O pedido</p>
          <p className="mt-0.5 text-[13px] leading-snug [overflow-wrap:anywhere]">{a.pedido || a.titulo}</p>
        </div>
      )}
      <div className="space-y-3">
        <p className="text-[13px] font-semibold">Guardar no arquivo livre</p>
        <p className="text-[12px] leading-snug text-muted-foreground" title="Não entram na Mesa do cliente, na Agenda nem na aprovação.">
          Vão para o Laboratório, por cliente e dia. Fora da Mesa e da Agenda.
        </p>
        {caminho && (
          <p className="rounded-md bg-success/10 px-2.5 py-2 text-[12px] leading-snug [overflow-wrap:anywhere]" role="status" data-caminho-do-laboratorio="">
            {feito ? "Guardada em " : "Já guardada em "}
            <span className="font-medium">{caminho.join(" / ")}</span>
          </p>
        )}
        {erro && <p className="text-[12px] leading-snug text-destructive" role="alert">{erro}</p>}
        {!todas && <p className="rounded-md bg-warning/10 px-2.5 py-2 text-[12px] text-warning">Gere {cards > 1 ? "todas as lâminas" : "a arte"} antes de guardar ({feitas} de {cards || 1}).</p>}
        <button
          type="button"
          className={juntar(botao.primario, "h-11 w-full")}
          onClick={() => void guardar()}
          disabled={!todas || guardando}
          aria-label={caminho ? "Guardar de novo no arquivo livre" : "Guardar no arquivo livre"}
          title={caminho ? "Guardar de novo no arquivo livre (só a lâmina nova sobe)" : "Guardar no arquivo livre"}
        >
          {guardando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FolderDown className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      <div className="border-t border-border pt-3">
        <button type="button" className={botao.icone} onClick={() => void arquivar()} disabled={arquivando} aria-label="Arquivar esta arte" title="Arquivar esta arte">
          {arquivando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Archive className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}
