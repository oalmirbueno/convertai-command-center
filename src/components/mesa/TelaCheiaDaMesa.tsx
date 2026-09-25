import { useCallback, useEffect, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";

/**
 * Tela cheia padrão das mesas (dono, 25/09: "todas as mesas têm a opção de
 * deixar em tela cheia, um padrão para todas e todas que forem produzidas,
 * para focar naquele momento").
 *
 * Uma peça só para Mesa, Mesa Ads, Mesa Foto e as próximas (Mesa Vídeos):
 * - useTelaCheiaDaMesa() no topo da página e BotaoDeTelaCheia no cabeçalho;
 * - a raiz da página recebe CLASSE_DA_TELA_CHEIA quando `cheia` (sobreposição
 *   fixa que cobre o painel, com rolagem própria);
 * - o body ganha data-tela-cheia-da-mesa, e o CSS (src/index.css, bloco
 *   "Tela cheia da Mesa") esconde a barra do painel, a barra de baixo do
 *   celular e os botões flutuantes, em qualquer largura;
 * - onde o navegador tem a Fullscreen API, o documento inteiro vai para a
 *   tela cheia de verdade (some também a barra do navegador); onde não tem
 *   (Safari 11, iPhone), fica só a sobreposição, que já foca a mesa;
 * - Esc sai (se houver uma janela aberta, o Esc é dela; se o Estúdio ou o
 *   Canvas estiverem na tela cheia deles, o Esc sai primeiro deles).
 *
 * Mesmo padrão da tela cheia do Estúdio e do Canvas (src/lib/modoFoco.ts):
 * atributo no body e CSS da casca, sem contexto. O estado vale para as três
 * mesas: trocar de mesa pela barra mantém a tela cheia.
 */

export const CLASSE_DA_TELA_CHEIA = "mesa-tela-cheia";
const ATRIBUTO_NO_BODY = "data-tela-cheia-da-mesa";

type Ouvinte = (cheia: boolean) => void;
const ouvintes = new Set<Ouvinte>();
let cheiaAgora = false;
/** Entramos na tela cheia do navegador por aqui (para saber sair dela). */
let pedimosAoNavegador = false;
let mesasMontadas = 0;

function avisar() {
  ouvintes.forEach((o) => o(cheiaAgora));
}

function marcarBody(ligado: boolean) {
  try {
    if (ligado) document.body.setAttribute(ATRIBUTO_NO_BODY, "");
    else document.body.removeAttribute(ATRIBUTO_NO_BODY);
  } catch {
    /* sem documento (teste sem DOM) */
  }
}

/** Elemento em tela cheia do navegador agora (com o prefixo do Safari antigo). */
export function elementoEmTelaCheia(): Element | null {
  const d = document as any;
  return (d.fullscreenElement || d.webkitFullscreenElement || null) as Element | null;
}

/** O navegador tem tela cheia de verdade para a página? (iPhone e Safari 11: não.) */
export function temTelaCheiaDoNavegador(): boolean {
  const el = document.documentElement as any;
  const d = document as any;
  const habilitada = d.fullscreenEnabled !== undefined ? !!d.fullscreenEnabled : d.webkitFullscreenEnabled !== undefined ? !!d.webkitFullscreenEnabled : true;
  return habilitada && (typeof el.requestFullscreen === "function" || typeof el.webkitRequestFullscreen === "function");
}

function pedirAoNavegador() {
  if (!temTelaCheiaDoNavegador() || elementoEmTelaCheia()) return;
  const el = document.documentElement as any;
  try {
    const r = typeof el.requestFullscreen === "function" ? el.requestFullscreen() : el.webkitRequestFullscreen();
    pedimosAoNavegador = true;
    if (r && typeof r.catch === "function") {
      r.catch(() => {
        // Recusado (sem gesto do usuário, política do navegador): fica a sobreposição.
        pedimosAoNavegador = false;
      });
    }
  } catch {
    pedimosAoNavegador = false;
  }
}

function devolverAoNavegador() {
  if (!pedimosAoNavegador) return;
  pedimosAoNavegador = false;
  if (!elementoEmTelaCheia()) return;
  const d = document as any;
  try {
    const r = typeof d.exitFullscreen === "function" ? d.exitFullscreen() : typeof d.webkitExitFullscreen === "function" ? d.webkitExitFullscreen() : null;
    if (r && typeof r.catch === "function") r.catch(() => undefined);
  } catch {
    /* já saiu */
  }
}

export function definirTelaCheia(ligar: boolean) {
  if (ligar === cheiaAgora) return;
  cheiaAgora = ligar;
  marcarBody(ligar);
  if (ligar) pedirAoNavegador();
  else devolverAoNavegador();
  avisar();
}

/** Há uma janela (diálogo) aberta por cima: o Esc é dela. */
export function temJanelaAberta(): boolean {
  try {
    return !!document.querySelector('[role="dialog"], [role="alertdialog"]');
  } catch {
    return false;
  }
}

/** Tela cheia própria do Estúdio ou do Canvas aberta: o Esc sai dela primeiro. */
function telaCheiaInternaAberta(): boolean {
  try {
    return !!document.querySelector('[data-estudio-foco], [data-tela-cheia="sim"]');
  } catch {
    return false;
  }
}

export interface TelaCheiaDaMesa {
  cheia: boolean;
  alternar: () => void;
  sair: () => void;
}

export function useTelaCheiaDaMesa(): TelaCheiaDaMesa {
  const [cheia, setCheia] = useState(cheiaAgora);

  useEffect(() => {
    ouvintes.add(setCheia);
    mesasMontadas += 1;
    setCheia(cheiaAgora);
    return () => {
      ouvintes.delete(setCheia);
      mesasMontadas -= 1;
      // Trocar de mesa desmonta uma e monta a outra no mesmo instante: só sai
      // da tela cheia se nenhuma mesa ficou na tela.
      window.setTimeout(() => {
        if (mesasMontadas <= 0) definirTelaCheia(false);
      }, 0);
    };
  }, []);

  // Esc sai; e sair da tela cheia do navegador (Esc do próprio navegador) também sai daqui.
  useEffect(() => {
    if (!cheia) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== "Escape" && e.key !== "Esc") return;
      if (e.defaultPrevented || temJanelaAberta() || telaCheiaInternaAberta()) return;
      definirTelaCheia(false);
    };
    const mudou = () => {
      if (!elementoEmTelaCheia() && pedimosAoNavegador) {
        pedimosAoNavegador = false;
        definirTelaCheia(false);
      }
    };
    window.addEventListener("keydown", tecla);
    document.addEventListener("fullscreenchange", mudou);
    document.addEventListener("webkitfullscreenchange", mudou);
    return () => {
      window.removeEventListener("keydown", tecla);
      document.removeEventListener("fullscreenchange", mudou);
      document.removeEventListener("webkitfullscreenchange", mudou);
    };
  }, [cheia]);

  const alternar = useCallback(() => definirTelaCheia(!cheiaAgora), []);
  const sair = useCallback(() => definirTelaCheia(false), []);
  return { cheia, alternar, sair };
}

/** Classes da raiz da página: some a margem negativa e vira sobreposição fixa. */
export const classeDaRaiz = (cheia: boolean) => (cheia ? CLASSE_DA_TELA_CHEIA : "");

/** Botão do cabeçalho da mesa. */
export function BotaoDeTelaCheia({ tela, className = "" }: { tela: TelaCheiaDaMesa; className?: string }) {
  const rotulo = tela.cheia ? "Sair da tela cheia (Esc)" : "Tela cheia";
  return (
    <button
      type="button"
      onClick={tela.alternar}
      aria-pressed={tela.cheia}
      aria-label={rotulo}
      title={tela.cheia ? "Sair da tela cheia (Esc)" : "Tela cheia: só a mesa na tela, sem o menu do painel"}
      data-botao-tela-cheia=""
      className={`inline-flex h-8 shrink-0 items-center justify-center rounded-lg px-2 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        tela.cheia ? "bg-muted text-foreground" : ""
      } ${className}`}
    >
      {tela.cheia ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
      <span className="ml-1 hidden 2xl:inline">{tela.cheia ? "Sair" : "Tela cheia"}</span>
    </button>
  );
}
