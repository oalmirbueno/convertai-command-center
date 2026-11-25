import { ChevronDown, ListChecks, SlidersHorizontal, Zap } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { foco, juntar } from "@/components/sistema/estilos";
import type { Qualidade } from "@/lib/mesa/api";
import { FORMATOS_DO_POST, type FormatoDoPost } from "./estudioUtil";

/**
 * Controles compactos do Estúdio (frente AE-2, 28/09). Dono: "tirar poluição,
 * deixar mais clean, sem tirar nenhuma funcionalidade"; "escolher o
 * formato deveria ser um seletor compacto, não uma fileira de botões".
 *
 * - ModoDoEstudio: Pautas | Arte rápida, dentro de uma barra que já existe
 *   (a da faixa de pautas e a do histórico da arte rápida), sem linha nova.
 * - SeletorDeFormatoCompacto e SeletorDeQualidadeCompacto: um botão com a
 *   escolha que abre a lista (SeletorCompacto do sistema), com o preço.
 */

export type ModoDoEstudioValor = "pautas" | "rapida";

/** Pautas do mês | Arte rápida: segmentado pequeno com o estado ativo bem visível. */
export function ModoDoEstudio({ modo, onModo, className = "", curto: sempreCurto = false }: { modo: ModoDoEstudioValor; onModo: (m: ModoDoEstudioValor) => void; className?: string; /** Coluna estreita (Arte rápida): rótulo curto em qualquer largura. */ curto?: boolean }) {
  const opcao = (valor: ModoDoEstudioValor, rotulo: string, curto: string, icone: JSX.Element, dica: string) => {
    const ativa = modo === valor;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={ativa}
        title={dica}
        aria-label={sempreCurto ? rotulo : undefined}
        onClick={() => !ativa && onModo(valor)}
        className={juntar(
          "toque-compacto inline-flex h-8 min-w-0 items-center justify-center whitespace-nowrap rounded-full px-4 text-[13px] font-medium transition-colors duration-200",
          ativa ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
          foco,
        )}
      >
        <span className="mr-1 inline-flex shrink-0" aria-hidden="true">{icone}</span>
        {sempreCurto ? <span>{curto}</span> : <><span className="hidden sm:inline">{rotulo}</span><span className="sm:hidden">{curto}</span></>}
      </button>
    );
  };
  return (
    <div role="radiogroup" aria-label="Modo do Estúdio" className={juntar("inline-flex h-10 shrink-0 items-center rounded-full border border-border bg-card p-[3px]", className)} data-modo-do-estudio={modo}>
      {opcao("pautas", "Pautas do mês", "Pautas", <ListChecks className="h-3.5 w-3.5" />, "As artes do plano do mês, pela faixa das pautas")}
      {opcao("rapida", "Arte rápida", "Rápida", <Zap className="h-3.5 w-3.5" />, "Arte avulsa, fora do plano do mês: pedido, fotos e arquivos")}
    </div>
  );
}

/** Miniatura do quadro na proporção (altura fixa de 12 px). */
function Quadro({ proporcao }: { proporcao: number }) {
  return <span className="inline-block rounded-[2px] border border-current" style={{ width: Math.round(12 * proporcao), height: 12 }} aria-hidden="true" />;
}

/** Formato do post (4:5, 3:4, 1:1 ou 9:16) num seletor compacto. */
export function SeletorDeFormatoCompacto({
  valor,
  onMudar,
  disabled = false,
  className = "",
}: {
  valor: FormatoDoPost;
  onMudar: (f: FormatoDoPost) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <SeletorCompacto
      modo="lista"
      rotulo="Formato do post"
      className={juntar("h-8 text-[13px]", className)}
      opcoes={FORMATOS_DO_POST.map((f) => ({
        valor: f.valor,
        rotulo: f.rotulo,
        descricao: `${f.tamanho}. ${f.dica}`,
        icone: <Quadro proporcao={f.proporcao} />,
        desativada: disabled,
      }))}
      valor={valor}
      onEscolher={(v) => !disabled && onMudar(v as FormatoDoPost)}
    />
  );
}

export const ROTULO_DA_QUALIDADE: Record<Qualidade, { rotulo: string; dica: string }> = {
  baixa: { rotulo: "Rascunho", dica: "para testar ideia e layout" },
  media: { rotulo: "Padrão", dica: "texto nítido, o normal para postar" },
  alta: { rotulo: "Final", dica: "máximo detalhe, mais caro e mais lento" },
};

/** Qualidade da lâmina com o preço de cada uma, num seletor compacto. */
export function SeletorDeQualidadeCompacto({
  valor,
  onMudar,
  precos,
  nota,
  disabled = false,
}: {
  valor: Qualidade;
  onMudar: (q: Qualidade) => void;
  precos: Record<Qualidade, string>;
  /** Nota do preço (ex.: "inclui o fundo contínuo"). */
  nota?: string;
  disabled?: boolean;
}) {
  const ordem: Qualidade[] = ["baixa", "media", "alta"];
  return (
    <SeletorCompacto
      modo="lista"
      rotulo="Qualidade da lâmina"
      className="h-8 text-[13px]"
      opcoes={ordem.map((q) => ({
        valor: q,
        rotulo: `${ROTULO_DA_QUALIDADE[q].rotulo}${precos[q] ? ` ${precos[q]}` : ""}`,
        descricao: `${ROTULO_DA_QUALIDADE[q].dica}${precos[q] ? `, cerca de ${precos[q].slice(1)} por lâmina${nota ? ` (${nota})` : ""}` : ""}`,
        desativada: disabled,
      }))}
      valor={valor}
      onEscolher={(v) => !disabled && onMudar(v as Qualidade)}
    />
  );
}

/**
 * v4 E2 (dono, 15/11: "muito poluído, uma ação principal"): os ajustes da geração (formato, qualidade,
 * gerador, diretor, correção e estilo) num botão só com o resumo (4:5 · Padrão). O painel fica montado e
 * só se esconde (classe), para os seletores de dentro manterem o estado e o leitor de tela/testes acharem
 * cada controle pelo nome de sempre. Fecha com Esc ou clique fora (os menus dos seletores, que abrem em
 * portal, contam como dentro).
 */
export function PainelDeAjustes({ resumo, rotulo, children }: { resumo: ReactNode; rotulo: string; children: ReactNode }) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      const alvo = e.target as Element | null;
      if (!alvo || (caixa.current && caixa.current.contains(alvo))) return;
      if (alvo.closest && alvo.closest("[data-radix-popper-content-wrapper],[role=listbox],[role=option]")) return;
      setAberto(false);
    };
    const tecla = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", tecla);
    };
  }, [aberto]);
  return (
    <div ref={caixa} className="relative shrink-0" data-ajustes-da-geracao="">
      <button
        type="button"
        aria-expanded={aberto}
        aria-label={rotulo}
        title="Formato, qualidade, gerador, diretor, correção automática e estilo do cliente"
        onClick={() => setAberto((v) => !v)}
        className={juntar(
          "toque-compacto inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-card px-3.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted",
          aberto && "bg-muted",
          foco,
        )}
      >
        <SlidersHorizontal className="h-4 w-4 shrink-0" aria-hidden="true" />
        {resumo}
        <ChevronDown className={juntar("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150", aberto && "rotate-180")} aria-hidden="true" />
      </button>
      <div
        role="group"
        aria-label="Ajustes da geração"
        className={juntar(
          "absolute right-0 top-full z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] space-y-3 rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-[0_8px_24px_-8px_rgba(0,0,0,0.18)]",
          aberto ? "" : "hidden",
        )}
      >
        <p className="text-[13px] font-semibold">Ajustes da geração</p>
        {children}
      </div>
    </div>
  );
}

/** Linha do painel de ajustes: rótulo cinza à esquerda, controle à direita. */
export function LinhaDoAjuste({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <span className="shrink-0 text-[12px] text-muted-foreground">{rotulo}</span>
      <div className="flex min-w-0 justify-end">{children}</div>
    </div>
  );
}
