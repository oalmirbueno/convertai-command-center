import { Suspense, lazy, useState } from "react";
import { ClipboardList } from "lucide-react";
import { botao, juntar } from "@/components/sistema/estilos";
import { modeloDaMesa } from "../../../supabase/functions/_shared/briefing-da-mesa";
import type { SlugDoModelo } from "../../../supabase/functions/_shared/briefing-modelos";

const GerarLinkDoBriefing = lazy(() => import("./GerarLinkDoBriefing"));

/**
 * Botão "Briefing" (frente BRF): gera o link do briefing do cliente aberto,
 * já no modelo da mesa (vídeo na Mesa Vídeos, landing na Mesa Ads, redes e
 * peças no Estúdio...). A janela só carrega quando abre. Sem cliente ou em
 * mesa sem modelo, não aparece.
 */
export default function BotaoDoBriefing({
  clientId,
  marcaId = null,
  mesa,
  modelo,
  className = "",
  comTexto = true,
}: {
  clientId: string | null | undefined;
  marcaId?: string | null;
  /** Qual mesa (escolhe o modelo). */
  mesa?: string;
  /** Modelo direto (vence a mesa). */
  modelo?: SlugDoModelo;
  className?: string;
  comTexto?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const slug = modelo || (mesa ? modeloDaMesa(mesa) : null);
  if (!clientId || !slug) return null;
  return (
    <>
      <button type="button" onClick={() => setAberto(true)} className={juntar(botao.barra, className)} aria-label="Link do briefing" title="Link do briefing do cliente">
        <ClipboardList className="h-4 w-4" aria-hidden="true" />
        {comTexto && <span className="ml-1.5 hidden md:inline">Briefing</span>}
      </button>
      {aberto && (
        <Suspense fallback={null}>
          <GerarLinkDoBriefing open={aberto} onClose={() => setAberto(false)} clientId={clientId} marcaId={marcaId} modelo={slug} />
        </Suspense>
      )}
    </>
  );
}
