/**
 * Auto-atualização do painel em qualquer dispositivo (PWA ou navegador).
 *
 * O problema real de produção: cada publicação troca os arquivos do app. Quem
 * estava com o painel aberto (principalmente PWA no celular, que fica vivo por
 * dias) continuava na versão antiga; ao abrir Aprovações, o pedaço antigo já
 * não existia e a tela ficava branca. O reload simples não resolvia porque o
 * navegador podia devolver o mesmo index em cache.
 *
 * Três camadas de defesa:
 * 1. Vigia de versão: o build carimba um id e publica /version.json; o app
 *    compara ao abrir, ao voltar para a tela e a cada minutos. Versão nova?
 *    Recarrega sozinho ANTES de qualquer coisa quebrar.
 * 2. Recuperação de chunk: cobre também Safari/iOS ("Load failed") e promises
 *    rejeitadas, que o detector antigo não via.
 * 3. Recarga forçada: URL com parâmetro novo (fura o cache do documento),
 *    limpando service workers e Cache Storage antes. Com trava de tentativas
 *    para nunca entrar em loop.
 */

declare const __APP_BUILD_ID__: string | undefined;

export const BUILD_ID: string =
  typeof __APP_BUILD_ID__ !== "undefined" && __APP_BUILD_ID__ ? __APP_BUILD_ID__ : "dev";

const ATTEMPTS_KEY = "aceleriq-refresh-attempts";

// Mensagens que SÓ acontecem quando um pedaço do app sumiu (uso global, seguro).
const STRICT_CHUNK_RE =
  /Loading chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError/i;

// Versão ampla, usada apenas quando a tela JÁ quebrou (ErrorBoundary): inclui
// o "Load failed" genérico do Safari, que fora desse contexto seria falso alarme.
const BROAD_CHUNK_RE = new RegExp(`${STRICT_CHUNK_RE.source}|Load failed`, "i");

function errorMessage(error: unknown): string {
  const message =
    (error as { message?: string } | null)?.message ?? (typeof error === "string" ? error : "");
  return String(message || "");
}

export function isStrictChunkError(error: unknown): boolean {
  return STRICT_CHUNK_RE.test(errorMessage(error));
}

export function isChunkError(error: unknown): boolean {
  return BROAD_CHUNK_RE.test(errorMessage(error));
}

function recentAttempts(now: number): number[] {
  try {
    const raw = sessionStorage.getItem(ATTEMPTS_KEY);
    const list: number[] = raw ? JSON.parse(raw) : [];
    return list.filter((at) => now - at < 90_000);
  } catch {
    return [];
  }
}

/** Já esgotou as tentativas automáticas? Aí a saída é a tela de recuperação. */
export function refreshExhausted(): boolean {
  return recentAttempts(Date.now()).length >= 2;
}

async function cleanupStaleCaches() {
  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  } catch {
    /* sem permissão ou sem suporte: seguir mesmo assim */
  }
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    /* idem */
  }
}

/**
 * Recarrega buscando a versão nova de verdade: limpa caches e navega com um
 * parâmetro único, o que obriga o navegador a baixar o documento de novo.
 */
export function hardRefresh(force = false): boolean {
  // Sem internet, recarregar só trocaria a tela por uma página de erro do
  // navegador. Espera a conexão voltar e aí sim busca a versão nova.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    window.addEventListener("online", () => void hardRefresh(force), { once: true });
    return false;
  }

  const now = Date.now();
  const attempts = recentAttempts(now);
  if (!force && attempts.length >= 2) return false;
  try {
    sessionStorage.setItem(ATTEMPTS_KEY, JSON.stringify([...attempts, now]));
  } catch {
    /* armazenamento indisponível não impede a recarga */
  }

  const go = () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("v", String(now));
      window.location.replace(url.toString());
    } catch {
      window.location.reload();
    }
  };

  // A limpeza não pode segurar a recarga para sempre.
  Promise.race([cleanupStaleCaches(), new Promise((resolve) => setTimeout(resolve, 1_500))])
    .then(go)
    .catch(go);
  return true;
}

/** Remove o parâmetro técnico da URL depois que a versão nova carregou. */
export function stripRefreshParam() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("v")) return;
    url.searchParams.delete("v");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* cosmético: se falhar, nada quebra */
  }
}

async function fetchLatestBuildId(): Promise<string | null> {
  try {
    const response = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return null;
    const data = (await response.json()) as { buildId?: unknown };
    return typeof data.buildId === "string" && data.buildId ? data.buildId : null;
  } catch {
    return null;
  }
}

/**
 * Vigia de versão: compara o carimbo do app carregado com o publicado.
 * Atualiza na abertura e sempre que a pessoa volta para o painel (o momento
 * clássico do PWA que ficou dias em segundo plano).
 */
export function startVersionWatch() {
  if (BUILD_ID === "dev") return;

  let updatePending = false;

  const check = async (reloadNow: boolean) => {
    const latest = await fetchLatestBuildId();
    if (!latest || latest === BUILD_ID) return;
    updatePending = true;
    if (reloadNow) hardRefresh();
  };

  void check(true);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (updatePending) hardRefresh();
    else void check(true);
  });

  // Pega quem deixa o painel aberto na frente o dia todo.
  window.setInterval(() => void check(false), 4 * 60_000);
}

/** Escuta TODAS as formas que um pedaço antigo tem de falhar, em todo navegador. */
export function installChunkErrorRecovery() {
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    hardRefresh();
  });

  window.addEventListener("error", (event) => {
    if (isStrictChunkError(event?.message)) hardRefresh();
  });

  // Safari/iOS reporta import dinâmico quebrado como promise rejeitada.
  window.addEventListener("unhandledrejection", (event) => {
    const reason = (event as PromiseRejectionEvent).reason;
    if (isStrictChunkError(reason)) {
      event.preventDefault();
      hardRefresh();
    }
  });
}
