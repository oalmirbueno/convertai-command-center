import { useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Secao, botao, juntar } from "@/components/sistema";
import { chamarAgenteDoBriefing, textoDoErroDoBriefing } from "@/lib/briefing/api";
import EditorDeCampos from "./EditorDeCampos";
import type { CampoDoBriefing } from "../../../supabase/functions/_shared/briefing-modelos";
import { PREFIXO_EXTRA, MAX_EXTRAS } from "../../../supabase/functions/briefing-agente/modulos/briefing-editor";

/**
 * Perguntas extras de um projeto (frente BRF2, 30/09/2026): o que só este
 * cliente ou este projeto precisa responder, num bloco próprio no fim do
 * link ("Perguntas deste projeto"). Na hora de gerar o link, vão junto; com o
 * link já aberto, salvar grava na cópia do link (o cliente vê na próxima vez
 * que abrir). Depois de enviado, não muda mais.
 */

export default function PerguntasExtras({
  extras,
  onMudar,
  briefingId,
  chavesDoModelo = [],
  aoSalvar,
}: {
  extras: CampoDoBriefing[];
  onMudar: (extras: CampoDoBriefing[]) => void;
  /** Com o link já gerado: mostra Salvar e grava na cópia do link. */
  briefingId?: string;
  chavesDoModelo?: string[];
  aoSalvar?: () => void;
}) {
  const [salvando, setSalvando] = useState(false);
  const salvar = async () => {
    if (!briefingId) return;
    setSalvando(true);
    try {
      const r = await chamarAgenteDoBriefing<{ extras: CampoDoBriefing[] }>("perguntas_extras", { briefing_id: briefingId, extras });
      onMudar(r.extras);
      toast.success("Perguntas deste projeto salvas no link.");
      aoSalvar?.();
    } catch (e) {
      toast.error(textoDoErroDoBriefing(e, "Não foi possível salvar as perguntas."));
    } finally {
      setSalvando(false);
    }
  };
  const semTexto = extras.some((c) => !c.pergunta.trim());
  return (
    <Secao
      titulo="Perguntas deste projeto"
      descricao={extras.length ? `${extras.length} de ${MAX_EXTRAS}` : "nenhuma"}
      ajuda="Perguntas só deste cliente ou projeto. Entram num bloco próprio no fim do link, depois das perguntas do modelo. O modelo continua igual para os outros clientes."
      recolher={briefingId ? `briefing:extras:${briefingId}` : "briefing:extras:novo"}
      recolhidaDeInicio={!extras.length}
      acao={
        briefingId ? (
          <button type="button" onClick={() => void salvar()} disabled={salvando || semTexto} className={juntar(botao.barra)} title={semTexto ? "Toda pergunta precisa de texto." : undefined}>
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
            <span className="ml-1.5">Salvar no link</span>
          </button>
        ) : undefined
      }
    >
      <EditorDeCampos
        rotulo="Perguntas deste projeto"
        campos={extras}
        onMudar={(l) => onMudar(l.slice(0, MAX_EXTRAS))}
        todasAsChaves={chavesDoModelo.concat(extras.map((c) => c.key))}
        prefixo={PREFIXO_EXTRA}
      />
    </Secao>
  );
}
