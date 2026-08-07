export function resolveSupportWhatsAppNumber(value?: string): string | null {
  const configured = value?.trim();
  if (!configured) return null;

  const normalized = configured.replace(/[\s()+.-]/g, "");
  if (!/^\d{8,15}$/.test(normalized)) {
    throw new Error(
      "VITE_SUPPORT_WHATSAPP_NUMBER precisa conter um número internacional válido.",
    );
  }
  return normalized;
}

export const SUPPORT_WHATSAPP_NUMBER = resolveSupportWhatsAppNumber(
  import.meta.env.VITE_SUPPORT_WHATSAPP_NUMBER,
);

export function supportWhatsAppUrl(message: string): string | null {
  if (!SUPPORT_WHATSAPP_NUMBER) return null;
  return `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}
