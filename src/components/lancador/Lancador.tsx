import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, BookOpen, HelpCircle, Keyboard, Route, Sparkles } from "lucide-react";
import { botao, foco, juntar, texto } from "@/components/sistema/estilos";
import {
  ATALHOS_DO_PAINEL,
  ATALHO_DO_AGENTE,
  ehAtalhoDaAjuda,
  ehAtalhoDoAgente,
  digitandoEm,
  opcoesDoLancador,
  type ChaveDaOpcao,
  type PapelDoLancador,
} from "@/lib/lancador";

/**
 * O lançador único do painel (docs/design/SISTEMA.md, "Lançador"): um botão
 * NA BARRA, nunca flutuando sobre o conteúdo (regra do dono: nada flutuante
 * cobre conteúdo). Substitui as duas bolinhas soltas (ajuda e agente).
 *
 * - `variante="topo"` (768 px para cima): ícone na barra do topo, ao lado da
 *   busca e do sino; o menu abre para baixo.
 * - `variante="barra"` (celular): item da barra de baixo; o menu abre para
 *   cima, logo acima da barra.
 * - Equipe: Aceleriq (voz e IA), ajuda da tela, tour e atalhos.
 * - Cliente: só o "?" (ajuda da tela e tour).
 *
 * As duas variantes ficam montadas (uma escondida pelo CSS da faixa). Só a
 * que está visível responde ao teclado (Alt+A abre o agente, "?" a ajuda).
 */

export interface PassoDaTela {
  title: string;
  description: string;
}

export type VarianteDoLancador = "topo" | "barra";

type Vista = "menu" | "ajuda" | "atalhos";

const ICONE: Record<ChaveDaOpcao, typeof Sparkles> = {
  agente: Sparkles,
  ajuda: Route,
  tour: BookOpen,
  atalhos: Keyboard,
};

/** Onde o menu abre em cada variante (o teste confere: nada fixo no canto da tela). */
export const MENU_DO_LANCADOR: Record<VarianteDoLancador, string> = {
  topo: "absolute right-0 top-full z-50 mt-2",
  // Relativo à barra de baixo (fixa): logo acima dela, colado à direita.
  barra: "absolute bottom-full right-2 z-50 mb-2",
};

/**
 * Qual variante está valendo na largura atual: "topo" de 768 px para cima,
 * "barra" abaixo (a mesma faixa do `md:` da casca).
 */
export function varianteAtiva(v: VarianteDoLancador): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return v === "topo";
  const largo = window.matchMedia("(min-width: 768px)").matches;
  return v === "topo" ? largo : !largo;
}

export default function Lancador({
  variante,
  papel,
  podeUsarAgente,
  onAbrirAgente,
  passosDaTela,
  rotuloDaTela,
  onTourDaTela,
  onTourCompleto,
  className = "",
}: {
  variante: VarianteDoLancador;
  papel: PapelDoLancador;
  podeUsarAgente: boolean;
  onAbrirAgente: () => void;
  /** Passo a passo da tela atual (tour da página), quando existe. */
  passosDaTela: PassoDaTela[] | null;
  rotuloDaTela?: string;
  onTourDaTela: (() => void) | null;
  onTourCompleto: () => void;
  className?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [vista, setVista] = useState<Vista>(papel === "cliente" ? "ajuda" : "menu");
  const caixa = useRef<HTMLDivElement>(null);
  const opcoes = opcoesDoLancador(papel, { podeUsarAgente });

  const abrirEm = useCallback((v: Vista) => {
    setVista(v);
    setAberto(true);
  }, []);

  const fechar = useCallback(() => {
    setAberto(false);
    setVista(papel === "cliente" ? "ajuda" : "menu");
  }, [papel]);

  // Teclado: só a variante visível responde. Alt+A abre o agente; "?" a ajuda; Esc fecha o menu.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (!varianteAtiva(variante)) return;
      if (podeUsarAgente && ehAtalhoDoAgente(e) && !digitandoEm(e.target)) {
        e.preventDefault();
        fechar();
        onAbrirAgente();
        return;
      }
      if (ehAtalhoDaAjuda(e)) {
        e.preventDefault();
        abrirEm("ajuda");
        return;
      }
      if (e.key === "Escape" && aberto) fechar();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [variante, podeUsarAgente, onAbrirAgente, aberto, fechar, abrirEm]);

  // Clique fora fecha o menu.
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent | TouchEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) fechar();
    };
    document.addEventListener("mousedown", fora);
    document.addEventListener("touchstart", fora);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("touchstart", fora);
    };
  }, [aberto, fechar]);

  const escolher = (chave: ChaveDaOpcao) => {
    if (chave === "agente") {
      fechar();
      onAbrirAgente();
    } else if (chave === "tour") {
      fechar();
      onTourCompleto();
    } else if (chave === "ajuda") {
      setVista("ajuda");
    } else {
      setVista("atalhos");
    }
  };

  const comAgente = papel === "equipe" && podeUsarAgente;
  const rotuloDoBotao = papel === "cliente" ? "Ajuda: como fazer" : "Aceleriq e ajuda";
  const Icone = comAgente ? Sparkles : HelpCircle;
  const alternar = () => (aberto ? fechar() : abrirEm(papel === "cliente" ? "ajuda" : "menu"));

  return (
    <div
      ref={caixa}
      className={juntar(variante === "topo" ? "relative" : "flex h-full flex-1", className)}
      data-lancador={papel}
      data-variante={variante}
    >
      {variante === "topo" ? (
        <button
          type="button"
          onClick={alternar}
          aria-label={rotuloDoBotao}
          aria-expanded={aberto}
          title={comAgente ? `Aceleriq e ajuda (${ATALHO_DO_AGENTE} abre o agente)` : "Ajuda"}
          data-botao-do-lancador=""
          className={juntar(
            "flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:text-foreground",
            aberto ? "text-foreground" : comAgente ? "text-primary" : "text-muted-foreground",
            foco,
          )}
        >
          <Icone className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          onClick={alternar}
          aria-label={rotuloDoBotao}
          aria-expanded={aberto}
          data-botao-do-lancador=""
          className={juntar(
            "flex h-full flex-1 flex-col items-center justify-center text-[11px] font-medium transition-colors",
            aberto ? "text-primary" : "text-muted-foreground",
            foco,
          )}
        >
          <Icone className={juntar("mb-0.5 h-5 w-5", comAgente && !aberto ? "text-primary" : "")} aria-hidden="true" />
          <span>{comAgente ? "Aceleriq" : "Ajuda"}</span>
        </button>
      )}

      {aberto && (
        <div
          role="dialog"
          aria-label={papel === "cliente" ? "Ajuda" : "Aceleriq e ajuda"}
          className={juntar(
            MENU_DO_LANCADOR[variante],
            "w-72 max-w-[calc(100vw-16px)] rounded-lg border border-border bg-popover p-1.5 text-left text-popover-foreground shadow-lg",
          )}
          data-menu-do-lancador=""
        >
          {vista === "menu" && (
            <ul className="space-y-0.5" role="menu">
              {opcoes.map((o) => {
                const IconeDaOpcao = ICONE[o.chave];
                return (
                  <li key={o.chave}>
                    <button
                      type="button"
                      role="menuitem"
                      data-opcao={o.chave}
                      onClick={() => escolher(o.chave)}
                      className={juntar("flex w-full min-w-0 items-center rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted", foco)}
                    >
                      <IconeDaOpcao className={juntar("mr-2.5 h-4 w-4 shrink-0", o.chave === "agente" ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium leading-5 text-foreground">{o.rotulo}</span>
                        <span className="block truncate text-[12px] leading-4 text-muted-foreground">{o.detalhe}</span>
                      </span>
                      {o.atalho && (
                        <kbd className="ml-2 hidden shrink-0 rounded border border-border px-1 font-mono text-[11px] leading-4 text-muted-foreground md:inline">{o.atalho}</kbd>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {vista === "ajuda" && (
            <div className="p-1.5" data-ajuda-da-tela="">
              <div className="mb-2 flex min-w-0 items-center">
                {papel === "equipe" && (
                  <button type="button" onClick={() => setVista("menu")} aria-label="Voltar" className={juntar(botao.icone, "-ml-1 mr-1 h-7 w-7")}>
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
                <p className={juntar(texto.tituloSecao, "min-w-0 truncate text-[14px]")}>
                  Como fazer {rotuloDaTela ? `em ${rotuloDaTela}` : "nesta tela"}
                </p>
              </div>
              {passosDaTela && passosDaTela.length > 0 ? (
                <ol className="max-h-64 space-y-2 overflow-y-auto pr-1">
                  {passosDaTela.slice(0, 6).map((p, i) => (
                    <li key={`${i}-${p.title}`} className="flex min-w-0 items-start">
                      <span className="mr-2 mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">{i + 1}</span>
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium leading-5 text-foreground">{p.title}</span>
                        <span className="line-clamp-3 block text-[12px] leading-4 text-muted-foreground">{p.description}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className={texto.auxiliar}>Esta tela ainda não tem passo a passo. O tour mostra o painel inteiro.</p>
              )}
              <div className="mt-3 flex flex-wrap items-center">
                {onTourDaTela && passosDaTela && passosDaTela.length > 0 && (
                  <button type="button" onClick={() => { fechar(); onTourDaTela(); }} className={juntar(botao.primario, "mb-1 mr-1.5 h-8 text-[12px]")}>
                    Mostrar na tela
                  </button>
                )}
                <button type="button" onClick={() => { fechar(); onTourCompleto(); }} className={juntar(botao.secundario, "mb-1 h-8 text-[12px]")}>
                  Tour completo
                </button>
              </div>
            </div>
          )}

          {vista === "atalhos" && (
            <div className="p-1.5" data-atalhos="">
              <div className="mb-2 flex items-center">
                <button type="button" onClick={() => setVista("menu")} aria-label="Voltar" className={juntar(botao.icone, "-ml-1 mr-1 h-7 w-7")}>
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <p className={juntar(texto.tituloSecao, "text-[14px]")}>Atalhos de teclado</p>
              </div>
              <ul className="space-y-1.5">
                {ATALHOS_DO_PAINEL.filter((a) => podeUsarAgente || a.teclas !== ATALHO_DO_AGENTE).map((a) => (
                  <li key={a.teclas} className="flex min-w-0 items-center justify-between text-[12px]">
                    <span className="mr-2 min-w-0 truncate text-foreground">{a.o_que}</span>
                    <kbd className="shrink-0 rounded border border-border px-1.5 font-mono text-[11px] leading-5 text-muted-foreground">{a.teclas}</kbd>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
