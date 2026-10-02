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

/**
 * Recarga de ATUALIZAÇÃO (versão nova publicada): controlada, esperada, e por
 * isso não consome o orçamento da recuperação de erro. Sem esta separação,
 * cada publicação com o painel aberto gastava as tentativas de emergência, e
 * o primeiro soluço seguinte já caía na tela manual.
 */
const UPDATE_KEY = "aceleriq-update-reloads";

export function updateReload(): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    window.addEventListener("online", () => void updateReload(), { once: true });
    return false;
  }
  const now = Date.now();
  let recent: number[] = [];
  try {
    const raw = sessionStorage.getItem(UPDATE_KEY);
    recent = (raw ? (JSON.parse(raw) as number[]) : []).filter((at) => now - at < 5 * 60_000);
  } catch { /* sem armazenamento: segue */ }
  // Se o servidor insistir em devolver a versão antiga, parar de recarregar:
  // melhor rodar a versão anterior do que prender a pessoa num vai-e-volta.
  if (recent.length >= 2) return false;
  try {
    sessionStorage.setItem(UPDATE_KEY, JSON.stringify([...recent, now]));
  } catch { /* idem */ }

  const go = () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("v", String(now));
      window.location.replace(url.toString());
    } catch {
      window.location.reload();
    }
  };
  Promise.race([cleanupStaleCaches(), new Promise((resolve) => setTimeout(resolve, 1_500))])
    .then(go)
    .catch(go);
  return true;
}

/**
 * Memória de quedas fatais de render, por versão e mensagem. Permite a tela
 * de erro se recuperar sozinha uma ou duas vezes (soluço passageiro) e parar
 * de insistir quando o erro é determinístico, sem nunca entrar em loop.
 *
 * A janela é de 10 minutos contados da PRIMEIRA queda com aquela assinatura:
 * dentro dela, no máximo duas recargas automáticas; depois, tela manual.
 * Passados os 10 minutos a contagem recomeça, então um soluço de ontem não
 * condena a sessão de hoje. Ninguém zera esta memória por tempo de uso: era
 * isso (zerar aos 20 s de boot) que deixava o painel em loop de recarga.
 */
const FATAL_KEY = "aceleriq-fatal-crashes";
const FATAL_WINDOW_MS = 10 * 60_000;

interface FatalCrashMemory {
  sig: string;
  /** Primeira queda desta assinatura dentro da janela atual. */
  since: number;
  /** Última queda registrada (diagnóstico). */
  at: number;
  count: number;
}

export function recordFatalCrash(signature: string): number {
  const now = Date.now();
  try {
    const raw = localStorage.getItem(FATAL_KEY);
    const data = raw ? (JSON.parse(raw) as Partial<FatalCrashMemory>) : null;
    const since = typeof data?.since === "number" ? data.since : data?.at;
    const mesmaJanela =
      !!data && data.sig === signature && typeof since === "number" && now - since < FATAL_WINDOW_MS;
    const count = mesmaJanela && typeof data.count === "number" ? data.count + 1 : 1;
    const memory: FatalCrashMemory = {
      sig: signature,
      since: mesmaJanela && typeof since === "number" ? since : now,
      at: now,
      count,
    };
    localStorage.setItem(FATAL_KEY, JSON.stringify(memory));
    return count;
  } catch {
    return 99; // sem armazenamento não dá para limitar: não tenta sozinho
  }
}

/**
 * Apaga a memória de quedas. Uso manual (quem chama decide que a sessão está
 * saudável); o boot NÃO chama mais isto por tempo.
 */
export function clearFatalCrashes() {
  try { localStorage.removeItem(FATAL_KEY); } catch { /* cosmético */ }
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
 * O vigia já sabe que saiu versão nova (e espera a pessoa voltar à aba para
 * recarregar). Mora no módulo para a recuperação de pedaço usar também.
 */
let updatePending = false;

/**
 * Um pedaço da versão anterior não baixou e a recarga para a versão nova já
 * está a caminho. Nesse meio tempo a tela aberta quebra (o import devolve
 * nada), e a barreira de erro da rota usa isto para mostrar "Atualizando o
 * painel" no lugar de "Algo travou nesta tela" com um erro técnico.
 */
let atualizandoVersao = false;

/** Troca de tela com versão nova pendente: a recarga sai aqui, junto com a navegação que a pessoa já pediu. */
export function atualizarNaTrocaDeTela(): boolean {
  if (!updatePending) return false;
  return updateReload();
}

export function atualizandoPorVersao(): boolean {
  return atualizandoVersao;
}

/**
 * Vigia de versão: compara o carimbo do app carregado com o publicado.
 * Atualiza na abertura e sempre que a pessoa volta para o painel (o momento
 * clássico do PWA que ficou dias em segundo plano).
 */
export function startVersionWatch() {
  if (BUILD_ID === "dev") return;

  // 02/10: o dono via a tela "reiniciar" ao voltar para a aba ou logo depois de abrir. Agora só recarrega
  // nos primeiros segundos da abertura (antes de qualquer trabalho); depois disso a versão nova fica
  // pendente e entra na próxima troca de tela (atualizarNaTrocaDeTela), sem interromper o que está aberto.
  const abertoEm = Date.now();
  const check = async (reloadNow: boolean) => {
    const latest = await fetchLatestBuildId();
    if (!latest || latest === BUILD_ID) return;
    updatePending = true;
    if (reloadNow && Date.now() - abertoEm < 8_000) updateReload();
  };

  void check(true);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (!updatePending) void check(false);
  });

  // Pega quem deixa o painel aberto na frente o dia todo.
  window.setInterval(() => void check(false), 4 * 60_000);
}

/**
 * Escuta TODAS as formas que um pedaço antigo tem de falhar, em todo navegador.
 * Devolve a função que desliga as escutas (usada nos testes).
 */
export function installChunkErrorRecovery(): () => void {
  // Depois de uma publicação, a hospedagem apaga os arquivos da anterior e o
  // primeiro clique de quem está com o painel aberto pede um pedaço que sumiu.
  // A recarga é a mesma de antes; o que muda é a tela enquanto ela sai:
  // "Atualizando o painel" em vez de "Algo travou" (ver RouteErrorBoundary).
  // Se o vigia já sabia da versão nova, a recarga é a de ATUALIZAÇÃO, que não
  // gasta as tentativas de emergência.
  const aoFalharPreCarga = (event: Event) => {
    event.preventDefault();
    atualizandoVersao = true;
    const recarregou = (updatePending && updateReload()) || hardRefresh();
    // Sem rede ou sem tentativas: a recarga não sai e a tela de erro manual
    // continua aparecendo como antes.
    if (!recarregou) atualizandoVersao = false;
  };

  const aoErro = (event: ErrorEvent) => {
    if (isStrictChunkError(event?.message)) hardRefresh();
  };

  // Safari/iOS reporta import dinâmico quebrado como promise rejeitada.
  const aoRejeitar = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    if (isStrictChunkError(reason)) {
      event.preventDefault();
      hardRefresh();
    }
  };

  window.addEventListener("vite:preloadError", aoFalharPreCarga);
  window.addEventListener("error", aoErro);
  window.addEventListener("unhandledrejection", aoRejeitar);
  return () => {
    window.removeEventListener("vite:preloadError", aoFalharPreCarga);
    window.removeEventListener("error", aoErro);
    window.removeEventListener("unhandledrejection", aoRejeitar);
  };
}
