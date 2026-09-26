import { forwardRef, type ReactNode } from "react";
import { PanelRightClose, X } from "lucide-react";
import RegiaoRolavel from "./RegiaoRolavel";
import { useAreaDeTrabalho } from "./AreaDeTrabalho";
import { botao, juntar } from "./estilos";

/**
 * Painel do agente (docs/design/SISTEMA.md, "Agentes"): a casca fixa de toda
 * conversa com agente no painel.
 *
 *   ┌ cabeçalho (fixo): ícone, nome, uma linha, ações, recolher/fechar
 *   ├ topo (fixo, opcional): modos, mês em conversa, contexto
 *   ├ mensagens (ROLA POR DENTRO, sempre)
 *   ├ avisos (fixo, opcional): o que mudou, erro
 *   └ compositor (fixo embaixo): atalhos, campo, microfone, enviar
 *
 * O painel ocupa a altura de quem o hospeda (coluna da AreaDeTrabalho,
 * janela do agente, coluna do Estúdio). Dentro da AreaDeTrabalho ganha o
 * botão de recolher (computador) ou de fechar (gaveta do celular).
 *
 * Para agentes grandes que já montam as próprias partes, use as peças:
 * CabecalhoDoAgente, MensagensDoAgente e CompositorDoAgente.
 */

export function CabecalhoDoAgente({
  titulo,
  descricao,
  icone,
  acoes,
  children,
  className = "",
}: {
  titulo: ReactNode;
  descricao?: ReactNode;
  icone?: ReactNode;
  acoes?: ReactNode;
  /** Linha extra no cabeçalho (modos do agente). */
  children?: ReactNode;
  className?: string;
}) {
  const area = useAreaDeTrabalho();
  return (
    <div className={juntar("shrink-0 border-b border-border px-3 pb-2.5 pt-3", className)} data-cabecalho-do-agente="">
      <div className="flex min-w-0 items-center">
        {icone && (
          <span className="mr-2.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary" aria-hidden="true">
            {icone}
          </span>
        )}
        <div className="mr-2 min-w-0 flex-1">
          <h2 className="truncate text-[14px] font-semibold leading-5 text-foreground">{titulo}</h2>
          {descricao && <p className="truncate text-[12px] leading-4 text-muted-foreground">{descricao}</p>}
        </div>
        {acoes && <div className="flex shrink-0 items-center [&>*+*]:ml-1">{acoes}</div>}
        {area && area.largo && (
          <button type="button" onClick={area.alternarRecolhido} aria-label="Recolher o painel" title="Recolher o painel" className={juntar(botao.icone, "ml-1")}>
            <PanelRightClose className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
        {area && area.fecharGaveta && (
          <button type="button" onClick={area.fecharGaveta} aria-label="Fechar" title="Fechar" className={juntar(botao.icone, "ml-1 h-10 w-10")}>
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>
      {children && <div className="mt-2 min-w-0">{children}</div>}
    </div>
  );
}

/** A conversa: rola por dentro em qualquer largura (o painel tem altura fixa). */
export const MensagensDoAgente = forwardRef<HTMLDivElement, { children?: ReactNode; rotulo?: string; className?: string }>(function MensagensDoAgente(
  { children, rotulo = "Conversa com o agente", className = "" },
  ref,
) {
  return (
    <RegiaoRolavel ref={ref} modo="sempre" sobre="cartao" rotulo={rotulo} aria-live="polite" data-mensagens-do-agente="" className={juntar("space-y-3 px-3 py-3", className)}>
      {children}
    </RegiaoRolavel>
  );
});

/** Pé fixo: atalhos, campo de texto e enviar. Nunca sai da tela. */
export function CompositorDoAgente({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={juntar("shrink-0 space-y-2 border-t border-border px-3 pb-3 pt-2.5", className)} data-compositor-do-agente="">
      {children}
    </div>
  );
}

export default function PainelDoAgente({
  titulo,
  descricao,
  icone,
  acoes,
  topo,
  avisos,
  compositor,
  refDasMensagens,
  rotuloDasMensagens,
  semMoldura = false,
  className = "",
  children,
}: {
  /** Sem título: sem cabeçalho (quem hospeda já tem o dele, ex.: ferramenta do Estúdio). */
  titulo?: ReactNode;
  descricao?: ReactNode;
  icone?: ReactNode;
  acoes?: ReactNode;
  /** Linha fixa abaixo do cabeçalho (modos, mês em conversa). */
  topo?: ReactNode;
  /** Fixo entre a conversa e o campo (o que mudou, erro). */
  avisos?: ReactNode;
  /** O campo de mensagem e os botões. */
  compositor?: ReactNode;
  /** Ref do elemento que rola (para descer até a última mensagem). */
  refDasMensagens?: React.Ref<HTMLDivElement>;
  rotuloDasMensagens?: string;
  /** Sem borda e fundo de cartão (quando já está dentro de uma janela ou coluna). */
  semMoldura?: boolean;
  className?: string;
  /** As mensagens. */
  children?: ReactNode;
}) {
  return (
    <section
      aria-label={typeof titulo === "string" ? titulo : rotuloDasMensagens}
      className={juntar("flex h-full min-h-0 min-w-0 flex-col overflow-hidden", semMoldura ? "" : "rounded-lg border border-border bg-card", className)}
      data-painel-do-agente=""
    >
      {titulo && (
        <CabecalhoDoAgente titulo={titulo} descricao={descricao} icone={icone} acoes={acoes}>
          {topo}
        </CabecalhoDoAgente>
      )}
      {!titulo && topo && <div className="shrink-0 border-b border-border px-3 py-2">{topo}</div>}
      <MensagensDoAgente ref={refDasMensagens} rotulo={rotuloDasMensagens}>
        {children}
      </MensagensDoAgente>
      {avisos && <div className="shrink-0 space-y-2 px-3 pb-1">{avisos}</div>}
      {compositor && <CompositorDoAgente>{compositor}</CompositorDoAgente>}
    </section>
  );
}
