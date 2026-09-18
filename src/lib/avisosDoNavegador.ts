/**
 * Aviso do navegador para a equipe: o sino so avisa quem esta olhando para
 * ele. Com a permissao dada uma vez, um aviso novo aparece no canto da tela
 * mesmo com o painel em outra aba. Tudo aqui e tolerante: sem suporte, sem
 * permissao ou em iframe, simplesmente nao acontece nada.
 */
export type EstadoDoAviso = "indisponivel" | "pedir" | "ligado" | "bloqueado";

export function estadoDosAvisos(): EstadoDoAviso {
  if (typeof window === "undefined" || typeof Notification === "undefined") return "indisponivel";
  if (Notification.permission === "granted") return "ligado";
  if (Notification.permission === "denied") return "bloqueado";
  return "pedir";
}

export async function pedirPermissaoDeAvisos(): Promise<EstadoDoAviso> {
  if (estadoDosAvisos() !== "pedir") return estadoDosAvisos();
  try {
    const resposta = await Notification.requestPermission();
    return resposta === "granted" ? "ligado" : resposta === "denied" ? "bloqueado" : "pedir";
  } catch {
    return "indisponivel";
  }
}

interface AvisoBasico { id: string; message: string; link?: string | null; created_at: string; read?: boolean }

/**
 * Decide o que mostrar dado o lote que acabou de chegar. Devolve o texto do
 * aviso (um, ou o resumo de varios) e a marca d'agua nova. Puro, para o teste.
 */
export function avisoParaMostrar(
  novos: readonly AvisoBasico[],
  marcaDagua: string | null,
): { titulo: string; corpo: string; link: string | null; marca: string } | null {
  const inéditos = novos
    .filter((n) => !n.read && (!marcaDagua || n.created_at > marcaDagua))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (inéditos.length === 0) return null;
  const marca = inéditos[0].created_at;
  if (inéditos.length === 1) {
    return { titulo: "Aceleriq OS", corpo: inéditos[0].message, link: inéditos[0].link ?? null, marca };
  }
  return {
    titulo: `Aceleriq OS · ${inéditos.length} avisos novos`,
    corpo: inéditos.slice(0, 3).map((n) => `• ${n.message}`).join("\n"),
    link: null,
    marca,
  };
}

export function mostrarAvisoNoNavegador(aviso: { titulo: string; corpo: string; link: string | null }, abrir: (link: string) => void): boolean {
  if (estadoDosAvisos() !== "ligado") return false;
  try {
    const n = new Notification(aviso.titulo, { body: aviso.corpo, tag: "aceleriq-avisos", icon: "/favicon.ico" });
    n.onclick = () => {
      try { window.focus(); } catch { /* sem janela */ }
      if (aviso.link) abrir(aviso.link);
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}
