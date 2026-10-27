import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import { Moon, Sun } from "lucide-react";

type Aparencia = "claro" | "escuro";
const CHAVE = "aceleriq_membros_aparencia";
const Contexto = createContext<{
  tema: Aparencia;
  mudar: (tema: Aparencia) => void;
}>({ tema: "claro", mudar: () => {} });

function preferencia(): Aparencia {
  try {
    return localStorage.getItem(CHAVE) === "escuro" ? "escuro" : "claro";
  } catch {
    return "claro";
  }
}

/** A preferência dos membros é independente da aparência do painel operacional. */
export function ProviderAparenciaMembros({
  children,
}: {
  children: ReactNode;
}) {
  const [tema, mudar] = useState<Aparencia>(preferencia);
  useLayoutEffect(() => {
    const raiz = document.documentElement;
    const anterior = raiz.getAttribute("data-membros-tema");
    raiz.setAttribute("data-membros-tema", tema);
    try {
      localStorage.setItem(CHAVE, tema);
    } catch {
      /* A aparência funciona também sem armazenamento. */
    }
    return () => {
      if (anterior === null) raiz.removeAttribute("data-membros-tema");
      else raiz.setAttribute("data-membros-tema", anterior);
    };
  }, [tema]);
  return (
    <Contexto.Provider value={{ tema, mudar }}>
      <svg
        width="0"
        height="0"
        aria-hidden="true"
        focusable="false"
        style={{ position: "absolute" }}
      >
        <defs>
          <filter id="membros-marca-clara" colorInterpolationFilters="sRGB">
            <feColorMatrix
              type="matrix"
              values="0.08 0 0 0 0 -0.44 1 -0.44 0 0 0 0 0.09 0 0 0 0 0 1 0"
            />
          </filter>
        </defs>
      </svg>
      {children}
    </Contexto.Provider>
  );
}

export function BotaoAparenciaMembros() {
  const { tema, mudar } = useContext(Contexto);
  return (
    <div
      className="membros-aparencia"
      role="group"
      aria-label="Aparência da área de membros"
    >
      <button
        type="button"
        aria-label="Usar tema claro"
        aria-pressed={tema === "claro"}
        onClick={() => mudar("claro")}
      >
        <Sun size={17} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="Usar tema escuro"
        aria-pressed={tema === "escuro"}
        onClick={() => mudar("escuro")}
      >
        <Moon size={17} aria-hidden="true" />
      </button>
    </div>
  );
}
