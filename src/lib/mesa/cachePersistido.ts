import { useEffect, useRef } from "react";
import { QueryClient, useQueryClient, type Query } from "@tanstack/react-query";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { removeOldestQuery, type PersistQueryClientOptions, type Persister } from "@tanstack/react-query-persist-client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Cache das consultas guardado no navegador (pedido do dono em 23/09: "quando
 * eu entro na mesa, já tem que aparecer").
 *
 * Só a Mesa e a lista de clientes vão para o navegador, e só dado JSON puro:
 * URL assinada vence em 1 hora e estimativa é conta de tela, então ficam de
 * fora. O que volta do navegador aparece na hora e é relido em seguida quando
 * já passou do prazo (staleTime), então nada fica velho por muito tempo.
 *
 * Três travas:
 * - versão: build novo descarta o que foi guardado (o formato pode ter mudado);
 * - dono: o que foi guardado para uma pessoa nunca abre para outra;
 * - navegador sem armazenamento (aba anônima antiga, bloqueio): segue sem
 *   guardar, sem erro.
 */

declare const __APP_BUILD_ID__: string | undefined;

export const CHAVE_DO_CACHE = "aceleriq-cache-v1";
export const IDADE_MAXIMA_MS = 24 * 60 * 60_000;
/** Prazo padrão da Mesa: dentro dele, voltar à tela não relê o banco. */
export const PRAZO_DA_MESA_MS = 2 * 60_000;

const VERSAO = typeof __APP_BUILD_ID__ !== "undefined" && __APP_BUILD_ID__ ? __APP_BUILD_ID__ : "dev";

/** Raízes de chave que vão para o navegador. */
const RAIZES = ["mesa", "clients"];
/** Dentro da Mesa, nunca: URL assinada (vence) e estimativa (conta de tela). */
const NUNCA_NA_MESA = ["url", "estimativa"];
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

/** A chave desta consulta pode ir para o navegador? */
export function chavePersistivel(chave: readonly unknown[]): boolean {
  if (!Array.isArray(chave) || RAIZES.indexOf(String(chave[0])) < 0) return false;
  if (chave[0] === "mesa" && NUNCA_NA_MESA.indexOf(String(chave[1])) >= 0) return false;
  return true;
}

export function devePersistir(query: Query): boolean {
  if (query.state.status !== "success") return false;
  if (!chavePersistivel(query.queryKey)) return false;
  return dadoSimples(query.state.data);
}

/** localStorage que funciona de verdade; senão, nada (segue sem guardar). */
function armazenamento(): Storage | undefined {
  try {
    if (typeof window === "undefined" || !window.localStorage) return undefined;
    const teste = "__aceleriq_cache_teste__";
    window.localStorage.setItem(teste, "1");
    window.localStorage.removeItem(teste);
    return window.localStorage;
  } catch {
    return undefined;
  }
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

export function apagarCachePersistido() {
  try {
    window.localStorage.removeItem(CHAVE_DO_CACHE);
  } catch {
    /* sem armazenamento: nada guardado */
  }
}

function criarPersister(): Persister {
  const base = createSyncStoragePersister({
    storage: armazenamento(),
    key: CHAVE_DO_CACHE,
    throttleTime: 1000,
    // Cheio: tira a consulta mais antiga e tenta de novo.
    retry: removeOldestQuery,
    // O carimbo é lido na hora de gravar (no máximo uma vez por segundo): se
    // a pessoa trocou na mesma aba, o que ela gravar fica no nome dela.
    serialize: (cliente) => JSON.stringify({ ...cliente, buster: carimbo() }),
  });
  return {
    persistClient: (cliente) => base.persistClient(cliente),
    restoreClient: () => {
      try {
        return base.restoreClient();
      } catch {
        return undefined;
      }
    },
    removeClient: () => {
      try {
        return base.removeClient();
      } catch {
        return undefined;
      }
    },
  };
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
