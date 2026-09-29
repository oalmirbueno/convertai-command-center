import GerarLinkDoBriefing from "@/components/briefing/GerarLinkDoBriefing";

/**
 * "Link do briefing" da página Clientes. Frente BRF (30/09/2026): virou a
 * janela nova de gerar link (modelo, validade, marca, Copiar link, WhatsApp e
 * texto do grupo), que gera o link pelo servidor (briefing-agente) com a
 * cópia do modelo e o dado já sabido do cliente. O link sai da origem
 * configurada do app (appPublicUrl), nunca de um endereço fixo.
 */
interface Props {
  open: boolean;
  onClose: () => void;
  clientId?: string | null;
}

export default function BriefingLinkModal({ open, onClose, clientId = null }: Props) {
  return <GerarLinkDoBriefing open={open} onClose={onClose} clientId={clientId} />;
}
