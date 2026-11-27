import { toast } from "sonner";

/**
 * Pessoa nova no CRM (27/11/2026, dono: "não gerou o link para eu mandar ao cliente"). O link de acesso vem
 * junto da resposta: copia na hora e o aviso fica com o botão "Copiar link" por um tempo, para colar no
 * WhatsApp mesmo quando o e-mail não sai. Depois, o link sai de novo pelo botão da pessoa.
 */
export async function copiarTexto(texto: string, rotulo = "Copie o link de acesso:"): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    window.prompt(rotulo, texto);
    return false;
  }
}

export async function avisarComLink(mensagem: string, link: string | null | undefined): Promise<void> {
  if (!link) {
    toast.success(mensagem);
    return;
  }
  const copiado = await copiarTexto(link);
  toast.success(copiado ? `${mensagem} Link de acesso copiado: cole no WhatsApp.` : mensagem, {
    duration: 30_000,
    action: { label: "Copiar link", onClick: () => void copiarTexto(link).then((ok) => ok && toast.success("Link de acesso copiado.")) },
  });
}
