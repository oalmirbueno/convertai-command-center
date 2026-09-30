import { useEffect, useRef } from "react";
import { QueryClient, useQueryClient, type Query } from "@tanstack/react-query";
import type { PersistedClient, PersistQueryClientOptions, Persister } from "@tanstack/react-query-persist-client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Cache das consultas guardado no navegador (pedido do dono em 23/09: "quando
 * eu entro na mesa, já tem que aparecer").
 *
 * Só a Mesa, a primeira tela da Mesa Foto e a lista de clientes vão para o
 * navegador, e só dado JSON puro:
 * URL assinada vence em 1 hora e estimativa é conta de tela, então ficam de
 * fora. O que volta do navegador aparece na hora e é relido em seguida quando
 * já passou do prazo (staleTime), então nada fica velho por muito tempo.
 *
 * Três travas:
 * - versão: build novo descarta o que foi guardado (o formato pode ter mudado);
 * - dono: o que foi guardado para uma pessoa nunca abre para outra;
 * - navegador sem armazenamento (aba anônima antiga, bloqueio): segue sem
 *   guardar, sem erro.
 *
 * Onde e como grava (EX-01, 30/09). Antes ia tudo para o localStorage (teto
 * de ~5 MB) num JSON.stringify do cache inteiro a cada segundo: com 2 ou 3
 * clientes abertos no dia (itens do mês de 1 a 3 MB cada) a cota estourava, e
 * o laço "tira a mais antiga e tenta de novo" refazia o stringify inteiro a
 * cada volta, travando a tela por meio segundo a cada releitura do sino.
 * Agora:
 * - grava no IndexedDB (sem o teto de 5 MB, desde o Safari 10.1), com o
 *   localStorage como reserva quando ele não existe ou falha;
 * - só grava quando alguma consulta guardável mudou de verdade (o sino e as
 *   outras consultas que não vão para o navegador não disparam nada);
 * - cada consulta é serializada uma vez por versão do dado (o que não mudou
 *   não é serializado de novo);
 * - no máximo uma gravação a cada 3 s, e a pendente sai na hora quando a aba
 *   é escondida ou fechada;
 * - na reserva, a cota cheia corta as consultas mais antigas de uma vez (as
 *   mesmas que o laço antigo tiraria), sem refazer o stringify.
 */

declare const __APP_BUILD_ID__: string | undefined;

export const CHAVE_DO_CACHE = "aceleriq-cache-v1";
export const IDADE_MAXIMA_MS = 24 * 60 * 60_000;
/** Prazo padrão da Mesa: dentro dele, voltar à tela não relê o banco. */
export const PRAZO_DA_MESA_MS = 2 * 60_000;
/** No máximo uma gravação a cada 3 s (antes: 1 s). */
export const ESPERA_ENTRE_GRAVACOES_MS = 3000;
/** Sem mudança nenhuma, regrava assim mesmo depois disso (o carimbo de hora do guardado não envelhece). */
export const REGRAVAR_SEM_MUDANCA_MS = 10 * 60_000;
/** Leitura do IndexedDB que não responde (Safari 14 às vezes trava a abertura): segue sem cache. */
export const PRAZO_DA_LEITURA_MS = 1500;

const BANCO = "aceleriq-cache";
const LOJA = "cache";

const VERSAO = typeof __APP_BUILD_ID__ !== "undefined" && __APP_BUILD_ID__ ? __APP_BUILD_ID__ : "dev";

/** Raízes de chave que vão para o navegador. */
const RAIZES = ["mesa", "clients", "mesa-foto"];
/**
 * Da Mesa Foto, só o que a primeira tela mostra (25/09: a Mesa Foto abria
 * sempre carregando): fotos, kits e ensaios. Só caminhos no storage, nada de
 * URL assinada. Acervo grande (mais de 600 fotos) fica só na memória, para não
 * encher o armazenamento do navegador.
 */
const DA_MESA_FOTO = ["acervo", "kits", "ensaios"];
const MAXIMO_DE_LINHAS_DA_MESA_FOTO = 600;
/**
 * Dentro da Mesa, nunca: URL assinada (vence), em uma ("url") ou em lote
 * ("urls", useUrlsAssinadas), e estimativa (conta de tela).
 */
const NUNCA_NA_MESA = ["url", "urls", "estimativa"];
const NIVEIS = 3;

/**
 * Dado que atravessa JSON sem mudar: nada de Map, Set, Date, função ou
 * objeto de classe. Confere até 3 níveis (o formato das consultas da Mesa);
 * mais fundo, confia no formato.
 */
export function dadoSimples(valor: unknown, nivel = 0): boolean {
  if (valor === null || valor === undefined) return true;
  const tipo = typeof valor;
  if (tipo === "string" || tipo === "boolean") return true;
  if (tipo === "number") return isFinite(valor as number);
  if (tipo !== "object") return false;
  if (valor instanceof Date || valor instanceof Map || valor instanceof Set) return false;
  if (nivel >= NIVEIS) return true;
  if (Array.isArray(valor)) {
    for (let i = 0; i < valor.length; i++) if (!dadoSimples(valor[i], nivel + 1)) return false;
    return true;
  }
  const proto = Object.getPrototypeOf(valor);
  if (proto !== Object.prototype && proto !== null) return false;
  const obj = valor as Record<string, unknown>;
  for (const k in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, k) && !dadoSimples(obj[k], nivel + 1)) return false;
  }
  return true;
}

/**
 * O dado de uma consulta não muda sem trocar de objeto (o React Query troca a
 * referência quando algo muda e mantém quando a releitura volta igual): a
 * conferência e o JSON de cada versão do dado são feitos uma vez só.
 */
const simplesPorDado = new WeakMap<object, boolean>();
const jsonPorDado = new WeakMap<object, string>();

function dadoSimplesGuardado(dado: unknown): boolean {
  if (!dado || typeof dado !== "object") return dadoSimples(dado);
  const obj = dado as object;
  const guardado = simplesPorDado.get(obj);
  if (guardado !== undefined) return guardado;
  const resultado = dadoSimples(dado);
  simplesPorDado.set(obj, resultado);
  return resultado;
}

function jsonDoDado(dado: unknown): string | undefined {
  if (!dado || typeof dado !== "object") return JSON.stringify(dado);
  const obj = dado as object;
  let json = jsonPorDado.get(obj);
  if (json === undefined) {
    json = JSON.stringify(dado);
    jsonPorDado.set(obj, json);
  }
  return json;
}

/** A chave desta consulta pode ir para o navegador? */
export function chavePersistivel(chave: readonly unknown[]): boolean {
  if (!Array.isArray(chave) || RAIZES.indexOf(String(chave[0])) < 0) return false;
  if (chave[0] === "mesa" && NUNCA_NA_MESA.indexOf(String(chave[1])) >= 0) return false;
  if (chave[0] === "mesa-foto" && DA_MESA_FOTO.indexOf(String(chave[1])) < 0) return false;
  return true;
}

export function devePersistir(query: Query): boolean {
  if (query.state.status !== "success") return false;
  if (!chavePersistivel(query.queryKey)) return false;
  const dado = query.state.data;
  if (query.queryKey[0] === "mesa-foto" && Array.isArray(dado) && dado.length > MAXIMO_DE_LINHAS_DA_MESA_FOTO) return false;
  return dadoSimplesGuardado(dado);
}

/**
 * localStorage que funciona de verdade; senão, nada (segue sem guardar).
 * Conferido uma vez (como antes): com o guardado enchendo a cota, a própria
 * conferência falharia depois.
 */
let localDoApp: { ls: Storage | undefined } | null = null;
function armazenamento(): Storage | undefined {
  if (localDoApp) return localDoApp.ls;
  let ls: Storage | undefined;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const teste = "__aceleriq_cache_teste__";
      window.localStorage.setItem(teste, "1");
      window.localStorage.removeItem(teste);
      ls = window.localStorage;
    }
  } catch {
    ls = undefined;
  }
  localDoApp = { ls };
  return ls;
}

/**
 * Quem está logado neste navegador, lido da sessão que o Supabase guarda
 * (sb-<projeto>-auth-token). Sem sessão ou sem leitura: vazio.
 */
function donoDaSessao(): string {
  try {
    const ls = window.localStorage;
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i) || "";
      if (k.indexOf("sb-") !== 0 || k.slice(-11) !== "-auth-token") continue;
      const v = JSON.parse(ls.getItem(k) || "null");
      const id = v && v.user && v.user.id;
      if (typeof id === "string" && id) return id;
    }
  } catch {
    /* sem leitura: trata como sem dono */
  }
  return "";
}

/** Carimbo do que foi guardado: versão do build e dono da sessão. */
const carimbo = () => `${VERSAO}:${donoDaSessao()}`;

// ------------------------------------------------------------------ JSON por partes

type ConsultaGuardada = PersistedClient["clientState"]["queries"][number];

/** Uma consulta em JSON, com o dado vindo da memória (serializado uma vez por versão). */
export function jsonDaConsulta(consulta: ConsultaGuardada): string {
  const { state, ...resto } = consulta as ConsultaGuardada & { state: Record<string, unknown> };
  const { data, ...estadoSemDado } = (state || {}) as Record<string, unknown>;
  const dado = data === undefined ? undefined : jsonDoDado(data);
  const estado = JSON.stringify(estadoSemDado);
  const estadoCompleto = dado === undefined ? estado : estado === "{}" ? `{"data":${dado}}` : `{"data":${dado},${estado.slice(1)}`;
  const inicio = JSON.stringify(resto);
  return inicio === "{}" ? `{"state":${estadoCompleto}}` : `${inicio.slice(0, -1)},"state":${estadoCompleto}}`;
}

/**
 * O guardado inteiro montado com as partes. Mesmo conteúdo de antes
 * (JSON.stringify({ ...cliente, buster })), com o carimbo lido na hora de
 * gravar: se a pessoa trocou na mesma aba, o que ela gravar fica no nome dela.
 */
function montar(cliente: PersistedClient, partes: string[], buster: string): string {
  const cabeca = JSON.stringify({ buster, timestamp: cliente.timestamp });
  const mutacoes = JSON.stringify(cliente.clientState.mutations || []);
  return `${cabeca.slice(0, -1)},"clientState":{"mutations":${mutacoes},"queries":[${partes.join(",")}]}}`;
}

/** Só para teste: o texto que seria gravado para este cliente. */
export function serializarCache(cliente: PersistedClient): string {
  return montar(cliente, cliente.clientState.queries.map(jsonDaConsulta), carimbo());
}

// ------------------------------------------------------------------ IndexedDB

export type Idb = {
  ler: () => Promise<string | undefined>;
  gravar: (texto: string) => Promise<void>;
  apagar: () => Promise<void>;
};

function comPrazo<T>(promessa: Promise<T>, ms: number, noPrazo: T): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(noPrazo), ms);
    promessa.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export function criarIdb(): Idb | null {
  let fabrica: IDBFactory | undefined;
  try {
    fabrica = typeof indexedDB !== "undefined" ? indexedDB : undefined;
  } catch {
    fabrica = undefined;
  }
  if (!fabrica) return null;
  const f = fabrica;
  let banco: Promise<IDBDatabase> | null = null;
  const abrir = (): Promise<IDBDatabase> => {
    if (banco) return banco;
    banco = new Promise<IDBDatabase>((resolve, reject) => {
      let pedido: IDBOpenDBRequest;
      try {
        pedido = f.open(BANCO, 1);
      } catch (e) {
        reject(e);
        return;
      }
      pedido.onupgradeneeded = () => {
        const db = pedido.result;
        if (!db.objectStoreNames.contains(LOJA)) db.createObjectStore(LOJA);
      };
      pedido.onsuccess = () => {
        const db = pedido.result;
        db.onversionchange = () => {
          db.close();
          banco = null;
        };
        resolve(db);
      };
      pedido.onerror = () => reject(pedido.error || new Error("IndexedDB indisponível"));
      pedido.onblocked = () => reject(new Error("IndexedDB bloqueado"));
    });
    // Falhou: a próxima tentativa abre de novo.
    banco.then(undefined, () => {
      banco = null;
    });
    return banco;
  };
  const naLoja = <T>(modo: IDBTransactionMode, acao: (loja: IDBObjectStore) => IDBRequest | void): Promise<T> =>
    abrir().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          let tx: IDBTransaction;
          try {
            tx = db.transaction(LOJA, modo);
          } catch (e) {
            reject(e);
            return;
          }
          const pedido = acao(tx.objectStore(LOJA));
          tx.oncomplete = () => resolve((pedido ? pedido.result : undefined) as T);
          tx.onerror = () => reject(tx.error || (pedido && pedido.error) || new Error("IndexedDB falhou"));
          tx.onabort = () => reject(tx.error || new Error("IndexedDB abortou"));
        }),
    );
  return {
    ler: () => naLoja<unknown>("readonly", (loja) => loja.get(CHAVE_DO_CACHE)).then((v) => (typeof v === "string" ? v : undefined)),
    gravar: (texto) => naLoja<unknown>("readwrite", (loja) => loja.put(texto, CHAVE_DO_CACHE)).then(() => undefined),
    apagar: () => naLoja<unknown>("readwrite", (loja) => loja.delete(CHAVE_DO_CACHE)).then(() => undefined),
  };
}

// ------------------------------------------------------------------ reserva: localStorage

/** O que a sessão aprendeu da cota do localStorage (em caracteres do guardado). */
const cota = { menorQueFalhou: Infinity, maiorQueCoube: 0 };

/**
 * Grava no localStorage. Cheio: tira as consultas mais antigas (dataUpdatedAt,
 * empate pela ordem) até caber, as mesmas que o laço antigo tiraria uma a uma,
 * mas medindo pelo tamanho das partes (sem refazer o stringify) e usando o
 * que a sessão já sabe da cota: normalmente 1 gravação, no pior caso poucas.
 */
function gravarNoLocal(ls: Storage, cliente: PersistedClient, partes: string[], buster: string): void {
  const consultas = cliente.clientState.queries;
  const n = partes.length;
  const ordem = partes.map((_, i) => i).sort((a, b) => {
    const da = (consultas[a].state && consultas[a].state.dataUpdatedAt) || 0;
    const db = (consultas[b].state && consultas[b].state.dataUpdatedAt) || 0;
    return da - db || a - b;
  });
  const fixo = montar(cliente, [], buster).length;
  // tamanhos[k]: o guardado sem as k consultas mais antigas.
  const tamanhos: number[] = [];
  let soma = 0;
  for (let i = 0; i < n; i++) soma += partes[i].length;
  const saiu: boolean[] = [];
  let restantes = n;
  tamanhos.push(fixo + soma + Math.max(0, restantes - 1));
  for (let k = 0; k < n; k++) {
    saiu[ordem[k]] = true;
    soma -= partes[ordem[k]].length;
    restantes -= 1;
    tamanhos.push(fixo + soma + Math.max(0, restantes - 1));
  }
  const texto = (k: number) => {
    const fora: boolean[] = [];
    for (let j = 0; j < k; j++) fora[ordem[j]] = true;
    const ficam: string[] = [];
    for (let i = 0; i < n; i++) if (!fora[i]) ficam.push(partes[i]);
    return montar(cliente, ficam, buster);
  };
  let gravadoEm = -1;
  const tentar = (k: number): boolean => {
    try {
      ls.setItem(CHAVE_DO_CACHE, texto(k));
      gravadoEm = k;
      if (tamanhos[k] > cota.maiorQueCoube) cota.maiorQueCoube = tamanhos[k];
      return true;
    } catch {
      if (tamanhos[k] < cota.menorQueFalhou) cota.menorQueFalhou = tamanhos[k];
      return false;
    }
  };
  // Menor corte que ainda não se sabe que falha, e o menor que se sabe que cabe.
  let lo = 0;
  while (lo <= n && tamanhos[lo] >= cota.menorQueFalhou) lo++;
  if (lo > n) return;
  let hi = n + 1;
  for (let k = lo; k <= n; k++) {
    if (tamanhos[k] <= cota.maiorQueCoube) {
      hi = k;
      break;
    }
  }
  if (hi === lo) {
    if (tentar(lo)) return;
    lo += 1;
    hi = n + 1;
  } else if (tentar(lo)) {
    return;
  } else {
    lo += 1;
  }
  // Busca pelo menor corte que cabe; cada tentativa só junta as partes.
  // Primeiro em passos que dobram (o corte costuma ser de 1 ou 2 consultas),
  // depois pela metade entre o último que falhou e o primeiro que coube.
  let voltas = 0;
  let passo = 1;
  while (lo < hi && voltas < 24) {
    voltas += 1;
    const k = Math.min(hi - 1, lo + passo - 1);
    if (tentar(k)) {
      hi = k;
      break;
    }
    lo = k + 1;
    passo *= 2;
  }
  while (lo < hi && voltas < 24) {
    voltas += 1;
    const meio = Math.floor((lo + hi) / 2);
    if (tentar(meio)) hi = meio;
    else lo = meio + 1;
  }
  if (hi <= n && gravadoEm !== hi) tentar(hi);
}

/** Só para teste: esquece o que a sessão aprendeu da cota. */
export function __zerarCotaParaTeste() {
  cota.menorQueFalhou = Infinity;
  cota.maiorQueCoube = 0;
}

// ------------------------------------------------------------------ o persister

let idbDoApp: Idb | null | undefined;
function idbCompartilhado(): Idb | null {
  if (idbDoApp === undefined) idbDoApp = criarIdb();
  return idbDoApp;
}

export function apagarCachePersistido() {
  try {
    window.localStorage.removeItem(CHAVE_DO_CACHE);
  } catch {
    /* sem armazenamento: nada guardado */
  }
  const idb = idbCompartilhado();
  if (idb) {
    idb.apagar().then(undefined, () => undefined);
  }
}

type Assinatura = { hash: string; dado: unknown }[];

function mesmaAssinatura(a: Assinatura | null, b: Assinatura): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < b.length; i++) if (a[i].hash !== b[i].hash || a[i].dado !== b[i].dado) return false;
  return true;
}

export function criarPersister(opcoes: { idb?: Idb | null } = {}): Persister {
  let idb: Idb | null = opcoes.idb !== undefined ? opcoes.idb : idbCompartilhado();
  let limpouAntigo = false;
  let ultima: Assinatura | null = null;
  let ultimaGravacao = 0;
  let pendente: PersistedClient | null = null;
  let espera: ReturnType<typeof setTimeout> | null = null;

  const usarReserva = () => {
    idb = null;
  };

  const gravarAgora = () => {
    if (espera) clearTimeout(espera);
    espera = null;
    const cliente = pendente;
    pendente = null;
    if (!cliente) return;
    ultimaGravacao = Date.now();
    try {
      const partes = cliente.clientState.queries.map(jsonDaConsulta);
      const buster = carimbo();
      if (idb) {
        const texto = montar(cliente, partes, buster);
        const destino = idb;
        destino.gravar(texto).then(
          () => {
            // Primeira gravação no IndexedDB: libera os 4 a 5 MB do guardado antigo.
            if (limpouAntigo) return;
            limpouAntigo = true;
            try {
              window.localStorage.removeItem(CHAVE_DO_CACHE);
            } catch {
              /* nada */
            }
          },
          () => {
            // IndexedDB que não grava (aba anônima de Safari antigo, cota):
            // a sessão segue no localStorage, e o guardado velho do IndexedDB
            // sai para a próxima abertura ler o do localStorage.
            usarReserva();
            destino.apagar().then(undefined, () => undefined);
            const ls = armazenamento();
            if (ls) gravarNoLocal(ls, cliente, partes, buster);
          },
        );
        return;
      }
      const ls = armazenamento();
      if (ls) gravarNoLocal(ls, cliente, partes, buster);
    } catch {
      /* sem armazenamento: segue sem guardar */
    }
  };

  // Aba escondida ou fechando: a gravação pendente sai agora.
  try {
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      const descarregar = () => {
        if (pendente) gravarAgora();
      };
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") descarregar();
      });
      window.addEventListener("pagehide", descarregar);
    }
  } catch {
    /* sem janela: nada */
  }

  return {
    persistClient: (cliente) => {
      const consultas = cliente.clientState.queries;
      const assinatura: Assinatura = consultas.map((q) => ({ hash: q.queryHash, dado: q.state ? q.state.data : undefined }));
      const igual = mesmaAssinatura(ultima, assinatura);
      // Nada guardável mudou (o sino, a fila relida igual...): não grava.
      if (igual && (pendente || Date.now() - ultimaGravacao < REGRAVAR_SEM_MUDANCA_MS)) return;
      ultima = assinatura;
      pendente = cliente;
      if (!espera) espera = setTimeout(gravarAgora, ESPERA_ENTRE_GRAVACOES_MS);
    },
    restoreClient: async () => {
      let texto: string | undefined;
      if (idb) {
        try {
          const lido = await comPrazo<string | undefined | null>(idb.ler(), PRAZO_DA_LEITURA_MS, null);
          // null: não respondeu no prazo. A tela abre sem esperar e a sessão segue no localStorage.
          if (lido === null) usarReserva();
          else texto = lido;
        } catch {
          usarReserva();
        }
      }
      // Nada no IndexedDB (ou sem ele): pode estar no localStorage (build
      // anterior, ou sessão que gravou na reserva).
      if (texto === undefined) {
        try {
          const ls = armazenamento();
          texto = ls ? ls.getItem(CHAVE_DO_CACHE) || undefined : undefined;
        } catch {
          texto = undefined;
        }
      }
      return texto === undefined ? undefined : lerTexto(texto);
    },
    removeClient: () => {
      try {
        window.localStorage.removeItem(CHAVE_DO_CACHE);
      } catch {
        /* nada */
      }
      if (idb) return idb.apagar().then(undefined, () => undefined);
      return undefined;
    },
  };
}

function lerTexto(texto: string): PersistedClient | undefined {
  try {
    return JSON.parse(texto) as PersistedClient;
  } catch {
    return undefined;
  }
}

export function criarQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
  // O que vai para o navegador precisa viver o mesmo tanto na memória:
  // consulta recolhida antes some do que foi guardado.
  client.setQueryDefaults(["mesa"], { gcTime: IDADE_MAXIMA_MS, staleTime: PRAZO_DA_MESA_MS });
  client.setQueryDefaults(["clients"], { gcTime: IDADE_MAXIMA_MS });
  for (const parte of DA_MESA_FOTO) client.setQueryDefaults(["mesa-foto", parte], { gcTime: IDADE_MAXIMA_MS });
  return client;
}

export function opcoesDePersistencia(): Omit<PersistQueryClientOptions, "queryClient"> {
  return {
    persister: criarPersister(),
    maxAge: IDADE_MAXIMA_MS,
    // Guardado com outra versão ou por outra pessoa: descartado ao abrir.
    buster: carimbo(),
    dehydrateOptions: {
      shouldDehydrateQuery: devePersistir,
      shouldDehydrateMutation: () => false,
    },
  };
}

/**
 * Saiu, ou outra pessoa entrou na mesma aba: nada da anterior fica na
 * memória nem no navegador.
 */
export function LimpezaDoCacheAoTrocarDeUsuario() {
  const { user, loading } = useAuth();
  const queryClient = useQueryClient();
  const anterior = useRef<string | null>(null);
  const atual = user ? user.id : "";
  useEffect(() => {
    if (loading) return;
    const antes = anterior.current;
    anterior.current = atual;
    if (antes && antes !== atual) {
      queryClient.clear();
      apagarCachePersistido();
    }
  }, [loading, atual, queryClient]);
  return null;
}
