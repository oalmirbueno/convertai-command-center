/**
 * Navegador antigo abre o painel inteiro, e nao so a tela de login.
 *
 * O build ja converte a SINTAXE moderna para navegadores de 2018+ (vite.config).
 * O que ele nao faz e inventar metodos que o navegador nao tem: Array.at,
 * crypto.randomUUID, Promise.allSettled, String.matchAll... Num iPhone com
 * iOS 14/15.3 ou num Chrome de 2020, a tela de Aprovacoes morria num TypeError
 * ao ordenar um carrossel, e o cliente via o painel "carregando" para sempre
 * ou uma tela branca. Este arquivo preenche cada lacuna so quando ela existe.
 *
 * Tem de ser o PRIMEIRO import do main.tsx.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// `globalThis` so existe em Chrome 71+ e Safari 12.1+. Ler o identificador
// direto em Chrome 64-70 ou Safari 11-12.0 lanca ReferenceError antes de
// qualquer polyfill rodar (auditoria 2026-09-21). Por isso a raiz e
// descoberta pelo caminho antigo e so entao o nome novo e definido.
const g: any = typeof globalThis !== "undefined"
  ? globalThis
  : typeof self !== "undefined"
    ? self
    : typeof window !== "undefined"
      ? window
      : Function("return this")();

if (typeof g.globalThis === "undefined") {
  g.globalThis = g;
}

function define(target: any, name: string, value: unknown) {
  if (!target || typeof target[name] === "function") return;
  Object.defineProperty(target, name, { value, writable: true, configurable: true });
}

// Array.prototype.at / String.prototype.at  (Safari 15.4+, Chrome 92+)
const at = function (this: ArrayLike<unknown>, index: number) {
  let n = Math.trunc(Number(index)) || 0;
  if (n < 0) n += this.length;
  if (n < 0 || n >= this.length) return undefined;
  return this[n];
};
define(Array.prototype, "at", at);
define(String.prototype, "at", at);

// String.prototype.replaceAll  (Safari 13.1+, Chrome 85+)
define(String.prototype, "replaceAll", function (this: string, search: any, replacement: any) {
  if (search instanceof RegExp) {
    if (!search.flags.includes("g")) throw new TypeError("replaceAll must be called with a global RegExp");
    return this.replace(search, replacement);
  }
  return this.split(String(search)).join(
    typeof replacement === "function" ? replacement(String(search)) : String(replacement),
  );
});

// String.prototype.matchAll  (Safari 13+, Chrome 73+)
define(String.prototype, "matchAll", function (this: string, regexp: RegExp) {
  if (!(regexp instanceof RegExp) || !regexp.flags.includes("g")) {
    throw new TypeError("matchAll must be called with a global RegExp");
  }
  const source = String(this);
  const re = new RegExp(regexp.source, regexp.flags);
  return {
    [Symbol.iterator]() {
      return this;
    },
    next() {
      const match = re.exec(source);
      if (!match) return { done: true, value: undefined };
      if (match[0] === "") re.lastIndex += 1;
      return { done: false, value: match };
    },
  };
});

// Promise.allSettled  (Safari 13+, Chrome 76+)
define(Promise, "allSettled", function (promises: Iterable<unknown>) {
  return Promise.all(
    Array.from(promises, (p) =>
      Promise.resolve(p).then(
        (value) => ({ status: "fulfilled", value }),
        (reason) => ({ status: "rejected", reason }),
      ),
    ),
  );
});

// Object.hasOwn  (Safari 15.4+, Chrome 93+)
define(Object, "hasOwn", function (obj: object, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(obj, key);
});

// crypto.randomUUID  (Safari 15.4+, Chrome 92+; e nunca em http sem TLS)
if (g.crypto && typeof g.crypto.randomUUID !== "function") {
  const randomUUID = () => {
    const bytes = new Uint8Array(16);
    if (typeof g.crypto.getRandomValues === "function") {
      g.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
  try {
    define(g.crypto, "randomUUID", randomUUID);
  } catch {
    /* objeto crypto congelado: segue sem */
  }
}

export {};

// Promise.any  (Safari 14+, Chrome 85+)
define(Promise, "any", function (promises: Iterable<unknown>) {
  const lista = Array.from(promises);
  if (lista.length === 0) return Promise.reject(new Error("All promises were rejected"));
  return new Promise((resolve, reject) => {
    const erros: unknown[] = [];
    let pendentes = lista.length;
    lista.forEach((p, i) => {
      Promise.resolve(p).then(resolve, (erro) => {
        erros[i] = erro;
        pendentes -= 1;
        if (pendentes === 0) reject(Object.assign(new Error("All promises were rejected"), { errors: erros }));
      });
    });
  });
});

// navigator.clipboard  (Safari 13.1+). Sem ele, cada "Copiar" do painel
// quebrava com TypeError num iPhone antigo. O fallback usa o comando de
// copiar do proprio navegador a partir de um campo invisivel.
if (typeof navigator !== "undefined" && !(navigator as any).clipboard) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText(texto: string) {
        return new Promise<void>((resolve, reject) => {
          try {
            const area = document.createElement("textarea");
            area.value = String(texto);
            area.setAttribute("readonly", "");
            area.style.position = "fixed";
            area.style.top = "0";
            area.style.left = "0";
            area.style.opacity = "0";
            document.body.appendChild(area);
            area.focus();
            area.select();
            area.setSelectionRange(0, area.value.length);
            const ok = document.execCommand("copy");
            document.body.removeChild(area);
            if (ok) resolve(); else reject(new Error("copy failed"));
          } catch (erro) {
            reject(erro);
          }
        });
      },
      readText() {
        return Promise.reject(new Error("clipboard read unavailable"));
      },
    },
  });
}

// ResizeObserver  (Safari 13.4+). Graficos e cabecalhos medem o proprio
// tamanho com ele; sem esta versao minima o arquivo da tela nem carregava.
// Aqui a medida e refeita a cada mudanca de tamanho da janela.
if (typeof g.ResizeObserver === "undefined") {
  class ResizeObserverMinimo {
    private alvos = new Set<Element>();
    private readonly ouvir = () => this.medir();
    constructor(private readonly callback: (entries: Array<{ target: Element; contentRect: DOMRectReadOnly }>, observer: ResizeObserverMinimo) => void) {}
    private medir() {
      if (this.alvos.size === 0) return;
      const entries = Array.from(this.alvos).map((target) => ({ target, contentRect: target.getBoundingClientRect() }));
      this.callback(entries, this);
    }
    observe(el: Element) {
      if (this.alvos.size === 0) window.addEventListener("resize", this.ouvir);
      this.alvos.add(el);
      window.setTimeout(() => this.medir(), 0);
    }
    unobserve(el: Element) {
      this.alvos.delete(el);
      if (this.alvos.size === 0) window.removeEventListener("resize", this.ouvir);
    }
    disconnect() {
      this.alvos.clear();
      window.removeEventListener("resize", this.ouvir);
    }
  }
  g.ResizeObserver = ResizeObserverMinimo;
}

// ---------------------------------------------------------------------------
// 2026-09-18: iPhone X/11 no Chrome (mesmo motor do Safari), iPhone 6/7/8 e
// Android com Chrome de 2018. O piso do build passou a Safari 11 / Chrome 64;
// o que esses navegadores nao tem de API vem daqui.
// ---------------------------------------------------------------------------

// Object.fromEntries  (Safari 12.1+, Chrome 73+)
define(Object, "fromEntries", function (entries: Iterable<[PropertyKey, unknown]>) {
  const out: Record<PropertyKey, unknown> = {};
  for (const [k, v] of Array.from(entries)) out[k as string] = v;
  return out;
});

// Array.prototype.flat / flatMap  (Safari 12+, Chrome 69+)
define(Array.prototype, "flat", function (this: unknown[], depth = 1) {
  const d = Number(depth) || 0;
  const out: unknown[] = [];
  for (const item of this) {
    if (Array.isArray(item) && d > 0) out.push(...(item as any).flat(d - 1));
    else out.push(item);
  }
  return out;
});
define(Array.prototype, "flatMap", function (this: unknown[], fn: (v: unknown, i: number, a: unknown[]) => unknown, thisArg?: unknown) {
  return (this.map(fn, thisArg) as any).flat(1);
});

// String.prototype.trimStart / trimEnd  (Safari 12+, Chrome 66+)
define(String.prototype, "trimStart", function (this: string) { return this.replace(/^\s+/, ""); });
define(String.prototype, "trimEnd", function (this: string) { return this.replace(/\s+$/, ""); });

// Promise.prototype.finally  (Safari 11.1+, Chrome 63+)
define(Promise.prototype, "finally", function (this: Promise<unknown>, onFinally?: () => unknown) {
  const run = () => Promise.resolve(typeof onFinally === "function" ? onFinally() : undefined);
  return this.then(
    (value) => run().then(() => value),
    (reason) => run().then(() => { throw reason; }),
  );
});

// queueMicrotask  (Safari 12.2+, Chrome 71+)
if (typeof g.queueMicrotask !== "function") {
  g.queueMicrotask = (fn: () => void) => { Promise.resolve().then(fn); };
}

// Symbol.asyncIterator  (Safari 12+, Chrome 63+): o build converte "for await"
// em codigo que procura este simbolo.
if (typeof Symbol !== "undefined" && !(Symbol as any).asyncIterator) {
  (Symbol as any).asyncIterator = Symbol("Symbol.asyncIterator");
}

// Array.prototype.findLast / findLastIndex  (Safari 15.4+, Chrome 97+)
define(Array.prototype, "findLast", function (this: unknown[], fn: (v: unknown, i: number, a: unknown[]) => boolean, thisArg?: unknown) {
  for (let i = this.length - 1; i >= 0; i -= 1) if (fn.call(thisArg, this[i], i, this)) return this[i];
  return undefined;
});
define(Array.prototype, "findLastIndex", function (this: unknown[], fn: (v: unknown, i: number, a: unknown[]) => boolean, thisArg?: unknown) {
  for (let i = this.length - 1; i >= 0; i -= 1) if (fn.call(thisArg, this[i], i, this)) return i;
  return -1;
});

// structuredClone  (Safari 15.4+, Chrome 98+): copia por JSON serve para os
// objetos simples que o painel copia (datas viram texto, como no JSON).
if (typeof g.structuredClone !== "function") {
  g.structuredClone = (value: unknown) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
}

// AbortController  (Safari 11.1+, Chrome 66+). Bibliotecas de dados criam um
// por consulta; sem ele o painel nem chegava a pedir o login.
if (typeof g.AbortController === "undefined") {
  class AbortSignalMinimo {
    aborted = false;
    reason: unknown = undefined;
    onabort: ((ev: unknown) => void) | null = null;
    private ouvintes: Array<() => void> = [];
    addEventListener(tipo: string, fn: () => void) { if (tipo === "abort") this.ouvintes.push(fn); }
    removeEventListener(tipo: string, fn: () => void) { if (tipo === "abort") this.ouvintes = this.ouvintes.filter((f) => f !== fn); }
    dispatchEvent() { return true; }
    throwIfAborted() { if (this.aborted) throw this.reason; }
    _abortar(reason: unknown) {
      if (this.aborted) return;
      this.aborted = true;
      this.reason = reason;
      if (typeof this.onabort === "function") this.onabort({ type: "abort", target: this });
      for (const fn of this.ouvintes) { try { fn(); } catch { /* ouvinte quebrado nao para os outros */ } }
    }
  }
  class AbortControllerMinimo {
    readonly signal = new AbortSignalMinimo();
    abort(reason?: unknown) {
      const erro = reason ?? Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
      this.signal._abortar(erro);
    }
  }
  g.AbortSignal = AbortSignalMinimo;
  g.AbortController = AbortControllerMinimo;
}

// IntersectionObserver  (Safari 12.2+, Chrome 51+). Animacoes de "aparece ao
// rolar" perguntam por ele; sem, tudo e considerado visivel de imediato, e o
// conteudo aparece em vez de ficar escondido para sempre.
if (typeof g.IntersectionObserver === "undefined") {
  class IntersectionObserverMinimo {
    readonly root = null;
    readonly rootMargin = "0px";
    readonly thresholds: number[] = [0];
    constructor(private readonly callback: (entries: unknown[], observer: IntersectionObserverMinimo) => void) {}
    observe(target: Element) {
      const rect = target.getBoundingClientRect();
      window.setTimeout(() => this.callback([{
        target, isIntersecting: true, intersectionRatio: 1, time: Date.now(),
        boundingClientRect: rect, intersectionRect: rect, rootBounds: null,
      }], this), 0);
    }
    unobserve() { /* nada a desligar */ }
    disconnect() { /* nada a desligar */ }
    takeRecords() { return []; }
  }
  g.IntersectionObserver = IntersectionObserverMinimo;
}
