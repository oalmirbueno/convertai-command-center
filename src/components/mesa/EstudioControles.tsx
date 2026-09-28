import { ListChecks, Zap } from "lucide-react";
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
export function ModoDoEstudio({ modo, onModo, className = "" }: { modo: ModoDoEstudioValor; onModo: (m: ModoDoEstudioValor) => void; className?: string }) {
  const opcao = (valor: ModoDoEstudioValor, rotulo: string, curto: string, icone: JSX.Element, dica: string) => {
    const ativa = modo === valor;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={ativa}
        title={dica}
        onClick={() => !ativa && onModo(valor)}
        className={juntar(
          "toque-compacto inline-flex h-7 min-w-0 items-center justify-center whitespace-nowrap rounded px-2.5 text-[12px] font-medium transition-colors",
          ativa ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
          foco,
        )}
      >
        <span className="mr-1 inline-flex shrink-0" aria-hidden="true">{icone}</span>
        <span className="hidden sm:inline">{rotulo}</span>
        <span className="sm:hidden">{curto}</span>
      </button>
    );
  };
  return (
    <div role="radiogroup" aria-label="Modo do Estúdio" className={juntar("inline-flex h-8 shrink-0 items-center rounded-lg border border-border bg-background p-0.5", className)} data-modo-do-estudio={modo}>
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
      className={juntar("h-8 text-[12.5px]", className)}
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
      className="h-8 text-[12.5px]"
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
