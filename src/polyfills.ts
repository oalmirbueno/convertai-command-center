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

const g = globalThis as any;

if (typeof g.globalThis === "undefined") {
  (window as any).globalThis = window;
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
