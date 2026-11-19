import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { foco, juntar } from "@/components/sistema";

/**
 * O tema do Correio (19/11/2026): claro por padrão (a leitura descansa mais) e escuro no botão, como no painel.
 * A escolha fica guardada à parte da do painel, para o painel escuro não escurecer o e-mail sem a pessoa pedir.
 * Ao sair do Correio, o painel volta ao tema que estava.
 */
export type TemaDoCorreio = "claro" | "escuro";
const CHAVE = "aceleriq:correio:tema";

function temaGuardado(): TemaDoCorreio {
  try {
    return localStorage.getItem(CHAVE) === "escuro" ? "escuro" : "claro";
  } catch {
    return "claro";
  }
}

export function useTemaDoCorreio() {
  const [tema, setTema] = useState<TemaDoCorreio>(temaGuardado);

  useEffect(() => {
    const raiz = document.documentElement;
    const meta = document.querySelector('meta[name="theme-color"]');
    const antes = { escuro: raiz.classList.contains("dark"), cor: meta ? meta.getAttribute("content") : null };
    return () => {
      raiz.classList.toggle("dark", antes.escuro);
      raiz.classList.toggle("light", !antes.escuro);
      if (meta && antes.cor) meta.setAttribute("content", antes.cor);
    };
  }, []);

  useEffect(() => {
    const raiz = document.documentElement;
    raiz.classList.toggle("dark", tema === "escuro");
    raiz.classList.toggle("light", tema === "claro");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", tema === "escuro" ? "#0A1A14" : "#F4F6F8");
    try {
      localStorage.setItem(CHAVE, tema);
    } catch {
      /* sem armazenamento: vale só nesta visita */
    }
  }, [tema]);

  return { tema, alternar: () => setTema((t) => (t === "escuro" ? "claro" : "escuro")) };
}

export function BotaoDoTema({ tema, aoAlternar }: { tema: TemaDoCorreio; aoAlternar: () => void }) {
  const escuro = tema === "escuro";
  return (
    <button type="button" onClick={aoAlternar} className={juntar("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl hover:bg-muted", foco)} aria-label={escuro ? "Usar o tema claro" : "Usar o tema escuro"} title={escuro ? "Tema claro" : "Tema escuro"} data-tema-do-correio={tema}>
      {escuro ? <Sun className="h-[18px] w-[18px]" aria-hidden="true" /> : <Moon className="h-[18px] w-[18px]" aria-hidden="true" />}
    </button>
  );
}
