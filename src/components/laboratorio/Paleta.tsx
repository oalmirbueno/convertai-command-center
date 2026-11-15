import { useState } from "react";
import { ChevronDown, ChevronsLeft, ChevronsRight, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { botao, juntar, useEstadoDaTela } from "@/components/sistema";
import { TIPOS_DE_NO, gruposDaPaleta, type TipoDeNo } from "@/lib/laboratorio/nos";
import { IconeDoNo } from "./icones";
import { TIPO_ARRASTADO } from "./QuadroDoLab";
import { tom } from "./visual";

/**
 * Paleta de nós: um botão por tipo, em grupos (Entradas, Criação, Funil,
 * Mensagens, Agentes, Publicação; tipo novo sem grupo cai em Outros). Tocar
 * põe o nó no quadro; arrastar solta onde quiser. Rola por conta própria
 * (nowheel: a roda não mexe no quadro).
 *
 * v4 (15/11/2026, como o canvas das referências): na vertical é uma coluna
 * flutuante de círculos pastel na cor do tipo e tem três estados: recolhida
 * (só o botão de abrir), ícones (o padrão) e com nomes (cada grupo vira um
 * bloco que abre e fecha, e cada nó mostra o círculo, o nome e o que faz). O
 * estado "com nomes" fica lembrado. São sempre os mesmos botões; só muda o
 * que aparece ao lado do ícone.
 */
export default function Paleta({ onPor, vertical = true }: { onPor: (t: TipoDeNo) => void; vertical?: boolean }) {
  const [recolhida, setRecolhida] = useState(false);
  const [comNomes, setComNomes] = useEstadoDaTela<boolean>("laboratorio:paleta:nomes", false, { validar: (v) => typeof v === "boolean" });
  const [fechados, setFechados] = useState<Record<string, boolean>>({});
  const grupos = gruposDaPaleta();
  const larga = vertical && comNomes;

  if (vertical && recolhida)
    return (
      <div className="flex h-full min-h-0 flex-col items-center" data-paleta-do-lab="" data-recolhida="">
        <button type="button" className="toque-compacto inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-card text-foreground shadow-card transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setRecolhida(false)} aria-label="Abrir a paleta" title="Abrir a paleta de nós" aria-expanded={false}>
          <ChevronsRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    );

  const botaoDoTipo = (t: TipoDeNo) => {
    const d = TIPOS_DE_NO[t];
    return (
      <button
        key={t}
        type="button"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(TIPO_ARRASTADO, t);
          e.dataTransfer.effectAllowed = "move";
        }}
        onClick={() => onPor(t)}
        className={juntar(
          "toque-compacto group/tipo inline-flex shrink-0 items-center text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          larga ? "w-full min-w-0 rounded-2xl px-1.5 py-1.5 hover:bg-muted" : juntar("h-9 w-9 justify-center rounded-full", vertical ? "my-[3px]" : "m-[3px]"),
        )}
        style={larga ? undefined : { backgroundColor: tom(d.cor, 0.14) }}
        aria-label={d.rotulo}
        title={`${d.rotulo}: ${d.dica}`}
        data-por-no={t}
      >
        <span style={larga ? { color: d.cor, backgroundColor: tom(d.cor, 0.14) } : { color: d.cor }} className={juntar("inline-flex shrink-0 items-center justify-center", larga && "mr-2.5 h-9 w-9 rounded-full")}>
          <IconeDoNo tipo={t} />
        </span>
        {larga ? (
          <span className="min-w-0 flex-1" aria-hidden="true">
            <span className="block truncate text-[13px] font-semibold leading-4 text-foreground">{d.rotulo}</span>
            <span className="block truncate text-[11px] leading-4 text-muted-foreground">{d.dica}</span>
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <div
      className={juntar("min-w-0", vertical && "flex h-full min-h-0 flex-col rounded-[26px] bg-card p-1.5 shadow-card", vertical && (larga ? "w-[248px] items-stretch" : "w-12 items-center"))}
      data-paleta-do-lab=""
      data-com-nomes={larga ? "" : undefined}
    >
      {vertical ? (
        <div className={juntar("mb-1 flex shrink-0 items-center", larga ? "justify-between px-1" : "flex-col")}>
          {larga ? <span className="text-[13px] font-semibold leading-5 text-foreground">Nós</span> : null}
          <span className={juntar("inline-flex items-center", !larga && "flex-col")}>
            <button type="button" className={botao.icone} onClick={() => setComNomes(!comNomes)} aria-label={larga ? "Mostrar só os ícones" : "Mostrar os nomes dos nós"} title={larga ? "Mostrar só os ícones" : "Mostrar os nomes dos nós"} aria-pressed={larga} data-nomes-da-paleta="">
              {larga ? <PanelLeftClose className="h-4 w-4" aria-hidden="true" /> : <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />}
            </button>
            <button type="button" className={botao.icone} onClick={() => setRecolhida(true)} aria-label="Recolher a paleta" title="Recolher a paleta" aria-expanded>
              <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
            </button>
          </span>
        </div>
      ) : null}
      <div
        role="toolbar"
        aria-label="Nós do projeto"
        aria-orientation={vertical ? "vertical" : "horizontal"}
        className={juntar(
          "nowheel scrollbar-hidden min-w-0",
          vertical ? juntar("flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-contain pb-1", larga ? "items-stretch" : "items-center") : "flex items-center overflow-x-auto overscroll-contain rounded-full bg-card p-1 shadow-card",
        )}
        data-rolagem-da-paleta=""
      >
        {grupos.map((g, i) => {
          const fechado = larga && !!fechados[g.id];
          return (
            <div key={g.id} role="group" aria-label={g.rotulo} title={larga ? undefined : g.rotulo} className={juntar("flex shrink-0", vertical ? juntar("flex-col", larga ? "items-stretch" : "items-center") : "items-center")} data-grupo-da-paleta={g.id}>
              {larga ? (
                // Com nomes: o grupo é um bloco que abre e fecha (o span não é botão de nó: fica fora da contagem da barra).
                <span
                  role="button"
                  tabIndex={0}
                  aria-expanded={!fechado}
                  onClick={() => setFechados((f) => ({ ...f, [g.id]: !f[g.id] }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setFechados((f) => ({ ...f, [g.id]: !f[g.id] }));
                    }
                  }}
                  className={juntar("flex cursor-pointer items-center rounded-full px-2 py-1.5 text-[11px] font-semibold uppercase leading-4 tracking-[0.08em] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", i > 0 && "mt-1")}
                  data-abrir-grupo-da-paleta={g.id}
                >
                  <ChevronDown className={juntar("mr-1.5 h-3.5 w-3.5 shrink-0 transition-transform duration-150 motion-reduce:transition-none", fechado && "-rotate-90")} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{g.rotulo}</span>
                  <span className="ml-2 tabular-nums">{g.tipos.length}</span>
                </span>
              ) : i > 0 ? (
                <span role="separator" aria-orientation={vertical ? "horizontal" : "vertical"} className={vertical ? "my-1.5 block h-px w-5 bg-border" : "mx-1 block h-5 w-px bg-border"} />
              ) : null}
              {fechado ? null : g.tipos.map(botaoDoTipo)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
