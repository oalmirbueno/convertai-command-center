import { useEffect, useRef, useState, type KeyboardEvent as TecladoReact } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Check, ChevronDown, LayoutGrid } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MESAS, enderecoDaMesa, type QualMesa } from "@/components/mesa-foto/TrocaDeMesas";
import { propsDePreCarga } from "@/lib/mesa/preCarga";
import { foco, juntar } from "./estilos";

/**
 * Seletor de mesa: um botão "Mesa ▾" que abre a lista das mesas, com ícone e
 * uma linha do que cada uma faz. Substitui a fileira "Mesa · Mesa Ads · ..."
 * do topo (dono, 26/09: "poderia ser um seletor mais bonito").
 *
 * - A lista vem de MESAS (src/components/mesa-foto/TrocaDeMesas.tsx), a
 *   lista única das mesas com nome, ícone e descrição: mesa nova é uma linha
 *   lá e aparece aqui sozinha (inclusive com o atalho de número).
 * - Troca mantendo o cliente (e a marca) abertos.
 * - Mouse em cima, foco ou toque num item já baixa a mesa (pré-carga).
 * - Teclado: Alt+M abre de qualquer lugar da mesa; na lista, setas andam,
 *   Enter abre e os números 1 a 9 abrem a mesa daquela posição.
 * - A lista é um nav "Trocar de mesa"; a mesa aberta aparece marcada
 *   (aria-current) e sem link.
 */

export const ATALHO_DO_SELETOR_DE_MESA = "Alt+M";

/** A tecla veio de um campo de texto? (o atalho não rouba a digitação) */
function digitando(alvo: EventTarget | null): boolean {
  const el = alvo as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || !!el.isContentEditable;
}

export default function SeletorDeMesa({
  atual,
  clientId,
  marcaId = null,
  className = "",
}: {
  atual: QualMesa;
  clientId: string;
  marcaId?: string | null;
  className?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const lista = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const mesa = MESAS.find((m) => m.valor === atual) || MESAS[0];
  const Icone = mesa.icone || LayoutGrid;

  // Alt+M abre o seletor (e.code: vale no Mac, onde Alt+M escreve "µ").
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.code !== "KeyM" && (e.key || "").toLowerCase() !== "m") return;
      if (digitando(e.target)) return;
      e.preventDefault();
      setAberto((a) => !a);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, []);

  const itens = () => (lista.current ? (Array.prototype.slice.call(lista.current.querySelectorAll("[data-item-de-mesa]")) as HTMLElement[]) : []);

  // Ao abrir, o foco vai para a mesa aberta (a lista começa de onde a pessoa está).
  const focarAtual = (e: Event) => {
    const todos = itens();
    const alvo = todos.find((el) => el.getAttribute("aria-current") === "page") || todos[0];
    if (!alvo) return;
    e.preventDefault();
    alvo.focus();
  };

  const teclas = (e: TecladoReact<HTMLDivElement>) => {
    const todos = itens();
    const i = todos.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      if (todos.length === 0) return;
      let p = i;
      if (e.key === "ArrowDown") p = i < 0 ? 0 : (i + 1) % todos.length;
      else if (e.key === "ArrowUp") p = i < 0 ? todos.length - 1 : (i - 1 + todos.length) % todos.length;
      else if (e.key === "Home") p = 0;
      else p = todos.length - 1;
      todos[p].focus();
      return;
    }
    if (/^[1-9]$/.test(e.key) && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const m = MESAS[Number(e.key) - 1];
      if (!m) return;
      e.preventDefault();
      setAberto(false);
      if (m.valor !== atual) navigate(enderecoDaMesa(m.valor, clientId, marcaId));
    }
  };

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-haspopup="true"
          aria-expanded={aberto}
          aria-label={`Mesa aberta: ${mesa.rotulo}. Trocar de mesa (${ATALHO_DO_SELETOR_DE_MESA})`}
          title={`Trocar de mesa (${ATALHO_DO_SELETOR_DE_MESA})`}
          data-seletor-de-mesa=""
          className={juntar(
            "toque-compacto inline-flex h-9 min-w-0 shrink-0 items-center rounded-md px-2 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted",
            aberto && "bg-muted",
            foco,
            className,
          )}
        >
          <Icone className="mr-1.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="truncate">{mesa.curto || mesa.rotulo}</span>
          <ChevronDown className={juntar("ml-1 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", aberto && "rotate-180")} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} onOpenAutoFocus={focarAtual} className="w-[calc(100vw-24px)] max-w-[340px] p-1.5">
        <nav aria-label="Trocar de mesa">
          <div ref={lista} onKeyDown={teclas} role="list">
            {MESAS.map((m, i) => {
              const IconeDaMesa = m.icone || LayoutGrid;
              const descricao = m.descricao || m.titulo;
              const idDaDescricao = `mesa-descricao-${m.valor}`;
              const conteudo = (
                <>
                  <span className={juntar("mr-3 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md", m.valor === atual ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
                    <IconeDaMesa className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-foreground">{m.rotulo}</span>
                    <span id={idDaDescricao} className="block truncate text-[12px] text-muted-foreground">
                      {descricao}
                    </span>
                  </span>
                  {m.valor === atual ? (
                    <Check className="ml-2 mt-2 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  ) : (
                    i < 9 && (
                      <kbd className="ml-2 mt-1.5 hidden h-5 min-w-[20px] shrink-0 items-center justify-center rounded border border-border bg-muted px-1 font-mono text-[10.5px] text-muted-foreground sm:inline-flex" aria-hidden="true">
                        {i + 1}
                      </kbd>
                    )
                  )}
                </>
              );
              const classe = juntar("flex w-full min-w-0 items-start rounded-md px-2 py-2 text-left transition-colors", foco);
              return (
                <div key={m.valor} role="listitem">
                  {m.valor === atual ? (
                    <span tabIndex={0} aria-current="page" aria-label={m.rotulo} aria-describedby={idDaDescricao} data-item-de-mesa={m.valor} className={juntar(classe, "bg-muted/60")}>
                      {conteudo}
                    </span>
                  ) : (
                    <Link
                      to={enderecoDaMesa(m.valor, clientId, marcaId)}
                      {...propsDePreCarga(enderecoDaMesa(m.valor, clientId, marcaId))}
                      onClick={() => setAberto(false)}
                      aria-label={m.rotulo}
                      aria-describedby={idDaDescricao}
                      data-item-de-mesa={m.valor}
                      className={juntar(classe, "hover:bg-muted")}
                    >
                      {conteudo}
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </nav>
        <p className="mt-1 border-t border-border px-2 pb-0.5 pt-1.5 text-[11px] text-muted-foreground">
          {clientId ? "O cliente aberto vai junto." : "Escolha o cliente na mesa."} Atalho{" "}
          <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10.5px]">Alt</kbd>{" "}
          <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10.5px]">M</kbd>
        </p>
      </PopoverContent>
    </Popover>
  );
}
