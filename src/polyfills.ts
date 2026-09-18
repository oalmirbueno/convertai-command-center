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
