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
 *    Recarrega sozinho só na abertura (ou na volta depois de muito tempo
 *    longe); no meio do uso, acende o ícone de versão nova no topo e a pessoa
 *    recarrega quando quiser (16/10: trocar de tela NUNCA recarrega).
 * 2. Recuperação de chunk: cobre também Safari/iOS ("Load failed") e promises
 *    rejeitadas, que o detector antigo não via.
 * 3. Recarga forçada: URL com parâmetro novo (fura o cache do documento),
 *    limpando service workers e Cache Storage antes. Com trava de tentativas
 *    para nunca entrar em loop.
 */

import { quandoOcioso, redeEconomica } from "@/lib/lazyComPreCarga";

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

/**
 * 15/10/2026: numa publicação pela metade, a hospedagem devolveu o index.html no lugar de .js com
 * hash, com cache de 1 ano (immutable). A recarga com ?v= não fura esse cache: o pedaço continuava
 * HTML e a Execução travava em "reading 'default'" (a borda agora dá 404, config/painel-worker.js,
 * mas quem já guardou continua). Cada .js já pedido pela página que o cache devolve como HTML é
 * baixado de novo direto do servidor (cache: "reload"), o que troca a cópia guardada.
 */
export async function purgarPedacosEnvenenados(): Promise<number> {
  if (typeof performance === "undefined" || typeof fetch !== "function") return 0;
  const nomes = [...new Set(performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /\/assets\/[^?#]+\.m?js(?:$|[?#])/.test(n)))];
  let trocados = 0;
  await Promise.all(nomes.map(async (n) => {
    try {
      const r = await fetch(n);
      if (/text\/html/i.test(r.headers.get("content-type") || "")) {
        await fetch(n, { cache: "reload" });
        trocados++;
      }
    } catch {
      /* sem rede: segue a recarga */
    }
  }));
  return trocados;
}

async function cleanupStaleCaches() {
  await purgarPedacosEnvenenados();
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
  Promise.race([cleanupStaleCaches(), new Promise((resolve) => setTimeout(resolve, 4_000))])
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
  Promise.race([cleanupStaleCaches(), new Promise((resolve) => setTimeout(resolve, 4_000))])
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
 * O vigia já sabe que saiu versão nova. Mora no módulo para a recuperação de
 * pedaço e o ícone do topo (AppLayout) usarem também.
 */
let updatePending = false;
const ouvintesDaVersao = new Set<() => void>();

function marcarVersaoNova() {
  if (updatePending) return;
  updatePending = true;
  ouvintesDaVersao.forEach((avisar) => {
    try {
      avisar();
    } catch {
      /* um ouvinte quebrado não impede os outros */
    }
  });
}

/** Há versão nova publicada esperando a pessoa clicar no ícone do topo? */
export function versaoNovaPendente(): boolean {
  return updatePending;
}

/** Avisa quando a versão nova for descoberta (useSyncExternalStore no AppLayout). */
export function assinarVersaoNova(avisar: () => void): () => void {
  ouvintesDaVersao.add(avisar);
  return () => {
    ouvintesDaVersao.delete(avisar);
  };
}

/** Clique no ícone de versão nova: a pessoa pediu, então recarrega mesmo que a trava automática já tenha esgotado. */
export function atualizarAgora(): boolean {
  return updateReload() || hardRefresh(true);
}

/**
 * Um pedaço da versão anterior não baixou e a recarga para a versão nova já
 * está a caminho. Nesse meio tempo a tela aberta quebra (o import devolve
 * nada), e a barreira de erro da rota usa isto para mostrar "Atualizando o
 * painel" no lugar de "Algo travou nesta tela" com um erro técnico.
 */
let atualizandoVersao = false;

export function atualizandoPorVersao(): boolean {
  return atualizandoVersao;
}

/** Confere o version.json e, se mudou, marca a versão nova (sem recarregar). */
async function conferirVersaoPublicada(): Promise<boolean> {
  if (BUILD_ID === "dev") return false;
  const latest = await fetchLatestBuildId();
  if (!latest || latest === BUILD_ID) return false;
  marcarVersaoNova();
  return true;
}

/** Aba escondida por mais que isto e versão nova: recarrega na volta (a pessoa não estava usando). */
const LONGE_DEMAIS_MS = 30 * 60_000;

/**
 * Vigia de versão: compara o carimbo do app carregado com o publicado.
 *
 * 16/10: o dono clicava num cliente, em Mesas ou no estúdio e o painel
 * reiniciava (a versão pendente recarregava na troca de tela). Agora recarrega
 * sozinho só nos primeiros segundos da abertura (antes de qualquer trabalho) ou
 * quando a aba volta depois de mais de 30 minutos escondida. No resto do
 * tempo a versão nova só acende o ícone do topo (AppLayout), e a recarga sai
 * quando a pessoa clica nele. Devolve a função que desliga o vigia (testes).
 */
export function startVersionWatch(): () => void {
  if (BUILD_ID === "dev") return () => undefined;

  const abertoEm = Date.now();
  const check = async (recarregarSe: () => boolean) => {
    if (!(await conferirVersaoPublicada())) return;
    if (recarregarSe()) updateReload();
  };
  const nunca = () => false;

  void check(() => Date.now() - abertoEm < 8_000);

  let escondidaDesde: number | null = document.visibilityState === "hidden" ? Date.now() : null;
  const aoTrocarDeAba = () => {
    if (document.visibilityState !== "visible") {
      if (escondidaDesde === null) escondidaDesde = Date.now();
      return;
    }
    const voltouEm = Date.now();
    const longeDemais = escondidaDesde !== null && voltouEm - escondidaDesde > LONGE_DEMAIS_MS;
    escondidaDesde = null;
    if (longeDemais) {
      // Só se a resposta chegar logo: depois disso a pessoa já voltou a usar.
      if (updatePending) updateReload();
      else void check(() => Date.now() - voltouEm < 8_000 && document.visibilityState === "visible");
      return;
    }
    if (!updatePending) void check(nunca);
  };
  document.addEventListener("visibilitychange", aoTrocarDeAba);

  // Pega quem deixa o painel aberto na frente o dia todo (só acende o ícone).
  const vigia = window.setInterval(() => {
    if (!updatePending) void check(nunca);
  }, 4 * 60_000);

  return () => {
    document.removeEventListener("visibilitychange", aoTrocarDeAba);
    window.clearInterval(vigia);
  };
}

/**
 * Pré-carga em segundo plano rodando agora. Pedaço que falha AQUI não
 * recarrega o painel (a pessoa não pediu aquela tela): a falha é ignorada e só
 * serve de pista de versão nova (ícone do topo).
 */
let preCargasEmFundo = 0;

type Carregar = () => Promise<unknown>;

/**
 * Baixa em segundo plano os módulos das telas, poucos por vez. Depois disso,
 * navegar não depende mais de a hospedagem ainda ter os pedaços desta versão
 * (que somem a cada publicação). Erros são ignorados. Devolve quantos falharam.
 */
export async function preCarregarEmSegundoPlano(
  carregadores: ReadonlyArray<Carregar>,
  simultaneos = 3,
): Promise<number> {
  preCargasEmFundo += 1;
  let proximo = 0;
  let falhas = 0;
  const trabalhar = async (): Promise<void> => {
    while (proximo < carregadores.length) {
      const carregar = carregadores[proximo++];
      try {
        await carregar();
      } catch {
        falhas += 1;
      }
    }
  };
  const fila: Array<Promise<void>> = [];
  for (let i = 0; i < Math.min(simultaneos, carregadores.length); i++) fila.push(trabalhar());
  try {
    await Promise.all(fila);
  } finally {
    preCargasEmFundo -= 1;
  }
  return falhas;
}

/**
 * Agenda a pré-carga para depois que o painel abrir e o navegador ficar
 * ocioso (requestIdleCallback, ou setTimeout onde não há). Em rede econômica
 * não baixa nada, nem no servidor de desenvolvimento (lá os pedaços não somem
 * e baixar tudo só compilaria o painel inteiro). Devolve o cancelamento.
 */
export function agendarPreCargaEmSegundoPlano(
  carregadores: () => ReadonlyArray<Carregar>,
  esperaMs = 4_000,
): () => void {
  if (BUILD_ID === "dev" || redeEconomica()) return () => undefined;
  let cancelado = false;
  let cancelarOcioso: () => void = () => undefined;
  const espera = window.setTimeout(() => {
    cancelarOcioso = quandoOcioso(() => {
      if (cancelado) return;
      let lista: ReadonlyArray<Carregar> = [];
      try {
        lista = carregadores();
      } catch {
        return;
      }
      void preCarregarEmSegundoPlano(lista).catch(() => undefined);
    }, 8_000);
  }, esperaMs);
  return () => {
    cancelado = true;
    window.clearTimeout(espera);
    cancelarOcioso();
  };
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
    // Falha na pré-carga em segundo plano: ninguém pediu a tela, então nada
    // de recarregar no meio do uso. Sem preventDefault o import rejeita e a
    // pré-carga ignora; se a pessoa abriu uma tela nesse mesmo instante, o
    // erro de pedaço dela sobe para o AppErrorBoundary, que recarrega com o
    // aviso "Atualizando o painel".
    if (preCargasEmFundo > 0) {
      void conferirVersaoPublicada();
      return;
    }
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
