import { useRef, type ReactNode, type Ref } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import AjudaRecolhida from "./AjudaRecolhida";
import { botao, juntar, texto } from "./estilos";

/**
 * Janela central (docs/design/SISTEMA.md, seção 4.4). Pedido do dono (30/09):
 * "biblioteca abrir no padrão central e não na lateral, e qualquer pop-up
 * assim abrir tudo no centro e não na lateral". Todo pop-up do painel abre
 * aqui: no meio da tela a partir de 640 px e ocupando a tela inteira no
 * celular. Nunca gaveta lateral (Sheet, Drawer do vaul, painel `fixed right-0`).
 *
 * - Cabeçalho fixo: ícone, título numa linha, "?" (a explicação), ações e Fechar.
 * - Corpo com UMA rolagem. `corpo="fixo"`: o corpo não rola e quem está dentro
 *   cuida da própria rolagem (conversa de agente, RegiaoRolavel com memória);
 *   nesse caso a janela tem altura definida para a rolagem de dentro funcionar.
 * - Rodapé opcional com as ações, fixo embaixo.
 * - Foco preso dentro, Esc fecha e o foco volta para quem abriu (Radix Dialog).
 * - Os avisos (sonner) continuam clicáveis com a janela aberta: o Desfazer de
 *   um agente dentro da janela funciona e clicar nele não fecha a janela.
 *
 * Compatibilidade (Safari 11, Chrome 64): centraliza por flex (nada de
 * translate, que briga com a animação de entrada), sem `gap` em flex e com
 * `vh` antes de `dvh` (`supports-[height:1dvh]`). No celular a altura vem de
 * `fixed inset-0` (`max-sm:h-full`), sem `vh` nenhum.
 */

export type LarguraDaJanela = "sm" | "md" | "lg" | "xl" | "tela";

/** Largura máxima a partir de 640 px. `tela` é quase a tela toda (biblioteca, editor grande). */
export const LARGURAS_DA_JANELA: Record<LarguraDaJanela, string> = {
  sm: "sm:max-w-[440px]",
  md: "sm:max-w-[560px]",
  lg: "sm:max-w-[720px]",
  xl: "sm:max-w-[960px]",
  tela: "sm:max-w-[1440px]",
};

/** Altura a partir de 640 px: até 88% da janela; `tela` e corpo fixo têm altura definida. */
const ALTURA_LIVRE = "sm:max-h-[88vh] sm:supports-[height:1dvh]:max-h-[88dvh]";
const ALTURA_DEFINIDA = "sm:h-[88vh] sm:supports-[height:1dvh]:h-[88dvh]";
const ALTURA_DA_TELA = "sm:h-[94vh] sm:supports-[height:1dvh]:h-[94dvh]";

export type PropsDaJanelaCentral = {
  aberta: boolean;
  /** Recebe o novo estado (como o `onOpenChange` do Radix). */
  onMudar?: (aberta: boolean) => void;
  /** Chamado quando a janela pede para fechar (Esc, fundo, Fechar). */
  onFechar?: () => void;
  titulo: ReactNode;
  icone?: ReactNode;
  /** Uma linha de estado embaixo do título (não é explicação: essa vai em `ajuda`). */
  descricao?: ReactNode;
  /** Texto só para leitor de tela, quando não há `descricao` à vista. */
  descricaoOculta?: string;
  /** A explicação, no "?" ao lado do título. */
  ajuda?: ReactNode;
  /** Nome do "?" para leitor de tela. */
  rotuloDaAjuda?: string;
  /** Ações pequenas na linha do título, antes do Fechar. */
  acoes?: ReactNode;
  /** Faixa embaixo do título, ainda no cabeçalho fixo (progresso, abas, filtros). */
  abaixoDoTitulo?: ReactNode;
  /** Ações fixas no pé. */
  rodape?: ReactNode;
  largura?: LarguraDaJanela;
  /** "rola" (padrão): o corpo rola. "fixo": quem está dentro cuida da rolagem. */
  corpo?: "rola" | "fixo";
  /** Tira o respiro do corpo (conteúdo que já traz o seu). */
  semEspaco?: boolean;
  classeDoCorpo?: string;
  /** Nome da janela para leitor de tela, quando o título visível não basta. */
  rotulo?: string;
  rotuloDoFechar?: string;
  refDoCorpo?: Ref<HTMLDivElement>;
  /** Onde o foco entra ao abrir (padrão do Radix: o primeiro controle). */
  aoAbrirFoco?: (e: Event) => void;
  /** Fecha ao clicar no fundo escuro (padrão: sim). */
  fecharNoFundo?: boolean;
  className?: string;
  children?: ReactNode;
  [dado: `data-${string}`]: string | number | boolean | undefined;
};

export default function JanelaCentral({
  aberta,
  onMudar,
  onFechar,
  titulo,
  icone,
  descricao,
  descricaoOculta,
  ajuda,
  rotuloDaAjuda = "O que é esta janela?",
  acoes,
  abaixoDoTitulo,
  rodape,
  largura = "md",
  corpo = "rola",
  semEspaco = false,
  classeDoCorpo,
  rotulo,
  rotuloDoFechar = "Fechar",
  refDoCorpo,
  aoAbrirFoco,
  fecharNoFundo = true,
  className,
  children,
  ...dados
}: PropsDaJanelaCentral) {
  // Quem abriu a janela (o botão com o foco antes de abrir). O Radix só devolve
  // o foco ao Dialog.Trigger; aqui a janela abre por estado, então guardamos na
  // hora de abrir (no render, antes de o foco entrar na janela) e devolvemos ao
  // fechar.
  const quemAbriu = useRef<HTMLElement | null>(null);
  if (aberta && !quemAbriu.current && typeof document !== "undefined" && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
    quemAbriu.current = document.activeElement;
  }
  const devolverFoco = (e: Event) => {
    const el = quemAbriu.current;
    quemAbriu.current = null;
    if (el && typeof document !== "undefined" && document.body.contains(el)) {
      e.preventDefault();
      el.focus();
    }
  };
  const mudar = (v: boolean) => {
    if (onMudar) onMudar(v);
    if (!v && onFechar) onFechar();
  };
  const temDescricao = !!descricao || !!descricaoOculta;
  const altura = largura === "tela" ? ALTURA_DA_TELA : corpo === "fixo" ? ALTURA_DEFINIDA : ALTURA_LIVRE;
  const nome: Record<string, string | undefined> = rotulo ? { "aria-label": rotulo, "aria-labelledby": undefined } : {};

  return (
    <DialogPrimitive.Root open={aberta} onOpenChange={mudar}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-fundo-da-janela=""
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 sm:p-4"
        >
          <DialogPrimitive.Content
            {...dados}
            {...nome}
            {...(temDescricao ? {} : { "aria-describedby": undefined })}
            data-janela-central=""
            data-largura={largura}
            onOpenAutoFocus={aoAbrirFoco}
            onCloseAutoFocus={devolverFoco}
            onPointerDownOutside={fecharNoFundo ? undefined : (e) => e.preventDefault()}
            onInteractOutside={(e) => {
              // Clicar no aviso (ex.: Desfazer do agente) não fecha a janela.
              const alvo = e.target as HTMLElement | null;
              if (alvo && typeof alvo.closest === "function" && alvo.closest("[data-sonner-toaster]")) e.preventDefault();
            }}
            className={juntar(
              "relative flex w-full min-w-0 flex-col overflow-hidden bg-card text-foreground outline-none max-sm:h-full",
              "pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] sm:pb-0 sm:pt-0",
              "sm:rounded-lg sm:border sm:border-border",
              "data-[state=open]:animate-in data-[state=open]:fade-in-0 sm:data-[state=open]:zoom-in-95",
              LARGURAS_DA_JANELA[largura],
              altura,
              className,
            )}
          >
            {/* Com a janela aberta o resto da página não recebe clique; os avisos (Desfazer) precisam receber. */}
            <style>{"[data-sonner-toaster]{pointer-events:auto}"}</style>
            <div className="shrink-0 border-b border-border px-4 py-3 sm:px-5" data-cabecalho-da-janela="">
              <div className="flex min-w-0 items-center">
                {icone ? (
                  <span className="mr-2 flex shrink-0 items-center text-muted-foreground" aria-hidden="true">
                    {icone}
                  </span>
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center">
                    <DialogPrimitive.Title className={juntar(texto.tituloSecao, "min-w-0 truncate")}>{titulo}</DialogPrimitive.Title>
                    {ajuda ? (
                      <AjudaRecolhida className="ml-1.5" rotulo={rotuloDaAjuda}>
                        {ajuda}
                      </AjudaRecolhida>
                    ) : null}
                  </div>
                  {descricao ? (
                    <DialogPrimitive.Description className={juntar(texto.auxiliar, "min-w-0 truncate")}>{descricao}</DialogPrimitive.Description>
                  ) : descricaoOculta ? (
                    <DialogPrimitive.Description className="sr-only">{descricaoOculta}</DialogPrimitive.Description>
                  ) : null}
                </div>
                {acoes ? <div className="ml-2 flex shrink-0 items-center [&>*+*]:ml-1">{acoes}</div> : null}
                <DialogPrimitive.Close className={juntar(botao.icone, "-mr-1 ml-1")} aria-label={rotuloDoFechar}>
                  <X className="h-4 w-4" aria-hidden="true" />
                </DialogPrimitive.Close>
              </div>
              {abaixoDoTitulo ? <div className="mt-2 min-w-0">{abaixoDoTitulo}</div> : null}
            </div>
            <div
              ref={refDoCorpo}
              data-corpo-da-janela={corpo}
              className={juntar(
                corpo === "rola" ? "min-h-0 flex-auto overflow-y-auto overscroll-contain" : "flex min-h-0 flex-1 flex-col overflow-hidden",
                semEspaco ? "" : "px-4 py-4 sm:px-5",
                classeDoCorpo,
              )}
            >
              {children}
            </div>
            {rodape ? (
              <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-end border-t border-border px-4 py-3 sm:px-5 [&>*+*]:ml-2" data-rodape-da-janela="">
                {rodape}
              </div>
            ) : null}
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
