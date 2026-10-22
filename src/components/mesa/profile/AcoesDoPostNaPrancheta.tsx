import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { botao, juntar } from "@/components/sistema/estilos";
import { chamarFuncao, textoDoErro } from "@/lib/mesa/api";
import { gravarTrabalhoNoCache, type TrabalhoGravado } from "../estudioUtil";

/**
 * Template · X na prancheta (rodada 2, 21/10): cada card é um post do fio, com
 * adicionar depois, duplicar e tirar logo embaixo, como as ações do carrossel.
 * Sem IA e sem custo (estudio-arte/template_lamina). Tirar pede o segundo clique.
 */
export default function AcoesDoPostNaPrancheta({ trabalhoId, clientId, ordem, total, bloqueado, onMudou, onEscolher }: {
  trabalhoId: string; clientId: string; ordem: number; total: number; bloqueado: boolean;
  onMudou: () => void;
  onEscolher: (ordem: number) => void;
}) {
  const cache = useQueryClient();
  const [rodando, setRodando] = useState<string | null>(null);
  const [armado, setArmado] = useState(false);
  const vivo = useRef(true);
  useEffect(() => () => { vivo.current = false; }, []);
  useEffect(() => {
    if (!armado) return;
    const t = window.setTimeout(() => setArmado(false), 5000);
    return () => window.clearTimeout(t);
  }, [armado]);

  const operar = async (operacao: "adicionar" | "duplicar" | "tirar") => {
    if (rodando || bloqueado) return;
    if (operacao === "tirar" && !armado) { setArmado(true); return; }
    setArmado(false); setRodando(operacao);
    try {
      const r = await chamarFuncao<{ trabalho: TrabalhoGravado; ordem: number }>("estudio-arte", { acao: "template_lamina", trabalho_id: trabalhoId, ordem, operacao });
      gravarTrabalhoNoCache(cache, clientId, r.trabalho);
      onMudou();
      onEscolher(r.ordem);
      toast.success(operacao === "tirar" ? `Post ${ordem} tirado do fio` : operacao === "duplicar" ? `Post ${ordem} duplicado` : `Post novo depois do ${ordem}`);
    } catch (e) {
      toast.error("Os posts não mudaram", { description: textoDoErro(e) });
    } finally {
      if (vivo.current) setRodando(null);
    }
  };

  const icone = (nome: string) => (rodando === nome ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null);
  return (
    <div className="flex w-full items-center justify-center" role="group" aria-label={`Post ${ordem} do fio`}>
      <button type="button" className={juntar(botao.icone, "h-7 w-7")} aria-label={`Adicionar post depois do ${ordem}`} title="Adicionar post depois deste" disabled={bloqueado || !!rodando || total >= 10} onClick={() => void operar("adicionar")}>
        {icone("adicionar") || <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
      </button>
      <button type="button" className={juntar(botao.icone, "h-7 w-7")} aria-label={`Duplicar post ${ordem}`} title="Duplicar este post" disabled={bloqueado || !!rodando || total >= 10} onClick={() => void operar("duplicar")}>
        {icone("duplicar") || <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      </button>
      <button type="button" className={juntar(botao.icone, "h-7 w-7", armado && "text-destructive")} aria-label={armado ? `Confirmar: tirar post ${ordem}` : `Tirar post ${ordem}`} title={armado ? "Clique de novo para tirar" : "Tirar este post do fio"} disabled={bloqueado || !!rodando || total < 2} onClick={() => void operar("tirar")}>
        {icone("tirar") || <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
      </button>
    </div>
  );
}
