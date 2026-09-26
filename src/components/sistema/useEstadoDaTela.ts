import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

/**
 * Estado persistente de tela (docs/design/SISTEMA.md, "Estado que não se perde").
 *
 * Dono, 26/09: "quando eu saio e volto, tudo naquele lugar fica persistente,
 * gravado, sem apagar, sem precisar fazer de novo."
 *
 * Um hook único para o que a pessoa escolheu ou escreveu na tela e que não
 * precisa ir para o servidor: etapa ou aba interna, filtros, seleção,
 * rascunho de campo de texto. Fica no navegador, separado por usuário, rota
 * e a chave que a tela passar (inclua o cliente nela: "mesa:contexto:parte:<id>").
 * Rascunho que já vai para o servidor continua indo; isto é só a camada do
 * navegador.
 *
 * - Armazenamento com try/catch: no Safari privado (ou bloqueado) a tela
 *   funciona igual, só não lembra.
 * - Trocar a chave (outro cliente) lê o valor guardado daquela chave.
 * - Texto é gravado com um respiro de 300 ms (não grava a cada tecla).
 * - Validação opcional: valor velho ou de outra versão cai no inicial.
 * - Vence em 30 dias; valor grande demais (> 100 mil caracteres) não é guardado.
 * - `rota` (opcional): guarda sob uma rota fixa em vez do endereço atual. Para
 *   página que troca de endereço sem desmontar (o Comercial: /comercial,
 *   /comercial/crm, /comercial/agenda...), o filtro escolhido numa aba volta
 *   igual ao abrir direto aquela aba. Mesmo formato de chave.
 */

const PREFIXO = "tela:";
const VALIDADE_MS = 30 * 24 * 60 * 60 * 1000;
const TAMANHO_MAXIMO = 100000;

let usuarioEmCache: string | null = null;

/** Id do usuário logado, lido da sessão guardada no navegador (sem depender do contexto de login). */
export function usuarioDoNavegador(): string {
  if (usuarioEmCache) return usuarioEmCache;
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i) || "";
      if (k.indexOf("sb-") !== 0 || k.slice(-11) !== "-auth-token") continue;
      const v = JSON.parse(window.localStorage.getItem(k) || "null");
      const id = v && v.user && v.user.id ? String(v.user.id) : "";
      if (id) {
        usuarioEmCache = id;
        return id;
      }
    }
  } catch {
    /* sem armazenamento */
  }
  return "anon";
}

/** Esquece o usuário em cache (troca de login). */
export function esquecerUsuarioDoNavegador() {
  usuarioEmCache = null;
}

function rotaAtual(): string {
  try {
    return (window.location.pathname || "/").replace(/\/+$/, "") || "/";
  } catch {
    return "/";
  }
}

/** Chave completa no armazenamento: usuário, rota e a chave da tela. */
export function chaveDoEstado(chave: string, rota: string = rotaAtual()): string {
  return `${PREFIXO}${usuarioDoNavegador()}:${rota}:${chave}`;
}

export function lerEstadoDaTela<T>(chave: string, inicial: T, validar?: (v: unknown) => boolean, rota?: string): T {
  try {
    const bruto = window.localStorage.getItem(chaveDoEstado(chave, rota));
    if (!bruto) return inicial;
    const guardado = JSON.parse(bruto);
    if (!guardado || typeof guardado !== "object" || !("v" in guardado)) return inicial;
    if (typeof guardado.em === "number" && Date.now() - guardado.em > VALIDADE_MS) return inicial;
    if (validar && !validar(guardado.v)) return inicial;
    return guardado.v as T;
  } catch {
    return inicial;
  }
}

export function gravarEstadoDaTela<T>(chave: string, valor: T, rota?: string) {
  try {
    const k = chaveDoEstado(chave, rota);
    if (valor === undefined || valor === null || (valor as unknown) === "") {
      window.localStorage.removeItem(k);
      return;
    }
    const texto = JSON.stringify({ v: valor, em: Date.now() });
    if (texto.length > TAMANHO_MAXIMO) return;
    window.localStorage.setItem(k, texto);
  } catch {
    /* armazenamento cheio ou bloqueado: segue sem lembrar */
  }
}

export function apagarEstadoDaTela(chave: string, rota?: string) {
  try {
    window.localStorage.removeItem(chaveDoEstado(chave, rota));
  } catch {
    /* sem armazenamento */
  }
}

/**
 * useState que lembra. `chave` sem cliente vale para a rota inteira; com
 * cliente, por cliente. Devolve [valor, mudar, esquecer].
 */
export function useEstadoDaTela<T>(
  chave: string,
  inicial: T,
  opcoes: { validar?: (v: unknown) => boolean; esperaMs?: number; rota?: string } = {},
): [T, Dispatch<SetStateAction<T>>, () => void] {
  const { validar, esperaMs } = opcoes;
  // A rota vale a da montagem (ou a fixa, se a tela passou uma).
  const rota = useRef(opcoes.rota || rotaAtual());
  const [estado, setEstado] = useState<{ chave: string; valor: T }>(() => ({ chave, valor: lerEstadoDaTela(chave, inicial, validar, rota.current) }));
  // Chave nova (outro cliente): lê o guardado dela na hora, sem piscar o valor antigo.
  let atual = estado;
  if (estado.chave !== chave) {
    atual = { chave, valor: lerEstadoDaTela(chave, inicial, validar, rota.current) };
    setEstado(atual);
  }

  const espera = esperaMs !== undefined ? esperaMs : typeof inicial === "string" ? 300 : 0;
  const pendente = useRef<number | null>(null);
  const gravar = useCallback(
    (k: string, v: T) => {
      if (pendente.current !== null) window.clearTimeout(pendente.current);
      if (espera <= 0) {
        gravarEstadoDaTela(k, v, rota.current);
        return;
      }
      pendente.current = window.setTimeout(() => {
        pendente.current = null;
        gravarEstadoDaTela(k, v, rota.current);
      }, espera);
    },
    [espera],
  );

  // Sai da tela com gravação pendente: grava na hora.
  const ultimo = useRef<{ chave: string; valor: T }>(atual);
  ultimo.current = atual;
  useEffect(
    () => () => {
      if (pendente.current !== null) {
        window.clearTimeout(pendente.current);
        gravarEstadoDaTela(ultimo.current.chave, ultimo.current.valor, rota.current);
      }
    },
    [],
  );

  const mudar: Dispatch<SetStateAction<T>> = useCallback(
    (v) => {
      setEstado((e) => {
        const novo = typeof v === "function" ? (v as (a: T) => T)(e.valor) : v;
        gravar(e.chave, novo);
        return { chave: e.chave, valor: novo };
      });
    },
    [gravar],
  );

  const esquecer = useCallback(() => {
    // Gravação pendente não pode trazer de volta o que acabou de ser esquecido.
    if (pendente.current !== null) {
      window.clearTimeout(pendente.current);
      pendente.current = null;
    }
    setEstado((e) => {
      apagarEstadoDaTela(e.chave, rota.current);
      return { chave: e.chave, valor: inicial };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return [atual.valor, mudar, esquecer];
}
