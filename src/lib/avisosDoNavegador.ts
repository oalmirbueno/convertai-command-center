/**
 * Aviso do navegador para a equipe: o sino so avisa quem esta olhando para
 * ele. Com a permissao dada uma vez, um aviso novo aparece no canto da tela
 * mesmo com o painel em outra aba. Tudo aqui e tolerante: sem suporte, sem
 * permissao ou em iframe, simplesmente nao acontece nada.
 */
export type EstadoDoAviso = "indisponivel" | "pedir" | "ligado" | "bloqueado";

/**
 * No Android o Chrome só mostra aviso por service worker (o `new
 * Notification()` dá erro), e o painel não usa service worker de propósito
 * (ver src/lib/appRefresh.ts). Lá o aviso do navegador não existe: melhor
 * não oferecer um botão que liga e nunca avisa.
 */
function semAvisoNestaPlataforma(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent || "");
}

export function estadoDosAvisos(): EstadoDoAviso {
  if (typeof window === "undefined" || typeof Notification === "undefined") return "indisponivel";
  if (semAvisoNestaPlataforma()) return "indisponivel";
  if (Notification.permission === "granted") return "ligado";
  if (Notification.permission === "denied") return "bloqueado";
  return "pedir";
}

export async function pedirPermissaoDeAvisos(): Promise<EstadoDoAviso> {
  if (estadoDosAvisos() !== "pedir") return estadoDosAvisos();
  try {
    // Safari até a versão 15 só responde pelo callback e devolve undefined:
    // esperar a promessa deixava o botão parado mesmo depois do "Permitir".
    const resposta = await new Promise<NotificationPermission | undefined>((resolver) => {
      let respondeu = false;
      const fim = (valor?: NotificationPermission) => {
        if (respondeu) return;
        respondeu = true;
        resolver(valor);
      };
      const retorno = Notification.requestPermission((valor) => fim(valor)) as unknown;
      if (retorno && typeof (retorno as Promise<NotificationPermission>).then === "function") {
        (retorno as Promise<NotificationPermission>).then(fim, () => fim(undefined));
      }
    });
    const final = resposta || Notification.permission;
    return final === "granted" ? "ligado" : final === "denied" ? "bloqueado" : "pedir";
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

export function mostrarAvisoNoNavegador(
  aviso: { titulo: string; corpo: string; link: string | null; marca?: string },
  abrir: (link: string) => void,
): boolean {
  if (estadoDosAvisos() !== "ligado") return false;
  try {
    // Uma etiqueta por aviso: com a etiqueta fixa, o Chrome trocava o aviso
    // anterior em silêncio e o segundo aviso não aparecia na tela.
    const tag = `aceleriq-${aviso.marca || Date.now()}`;
    const n = new Notification(aviso.titulo, { body: aviso.corpo, tag, icon: "/favicon.ico" });
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
