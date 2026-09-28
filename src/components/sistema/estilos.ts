import { extendTailwindMerge } from "tailwind-merge";

/**
 * Sistema de design do painel: as classes que se repetem, num lugar só
 * (docs/design/SISTEMA.md). Use estas constantes em vez de reescrever as
 * classes em cada tela: mudar aqui muda o painel inteiro.
 *
 * Compatibilidade (Safari 11 / Chrome 64): nada de `gap` em flex (só em
 * grid), nada de aspect-ratio, :has ou min()/max()/clamp() em classe
 * arbitrária. Espaço entre itens em flex é margem (mr-2, space-x-2).
 */

/** Escala tipográfica: cinco papéis, quatro tamanhos. */
export const texto = {
  /** Título da página ou da área (um por tela). */
  tituloPagina: "text-[20px] font-semibold leading-7 tracking-[-0.01em] text-foreground",
  /** Título de seção. */
  tituloSecao: "text-[15px] font-semibold leading-[22px] text-foreground",
  /** Rótulo de campo, de coluna, de grupo. */
  rotulo: "text-[12px] font-medium leading-4 text-muted-foreground",
  /** Texto corrido e valores. */
  corpo: "text-[13px] leading-5 text-foreground",
  /** Linha de apoio, metadado, contagem. Uma linha. */
  auxiliar: "text-[12px] leading-4 text-muted-foreground",
} as const;

/**
 * Conversa com agente (dono, 28/09: "o texto está muito curtinho, não consigo
 * ler bem"). Um tamanho só para toda conversa do painel: 14 px com altura de
 * linha folgada, balão com respiro e a mesma forma em todo agente.
 */
export const conversa = {
  /** Texto de mensagem (o TextoDoAgente já usa). */
  mensagem: "text-[14px] leading-[1.6]",
  /** Balão de mensagem: junte com `doUsuario` ou `doAgente`. */
  balao: "min-w-0 rounded-xl px-3.5 py-2.5 text-[14px] leading-[1.6] text-foreground [overflow-wrap:anywhere]",
  /** Balão de quem pediu: à direita, com a cor da marca. */
  doUsuario: "ml-8 bg-primary/10",
  /** Balão do agente: quase a largura toda (texto longo lê melhor). */
  doAgente: "mr-2 bg-secondary/60",
  /** Linha de apoio dentro da conversa (vazio, lendo, aviso do sistema). */
  apoio: "text-[12.5px] leading-5 text-muted-foreground",
  /** Campo de digitar a mensagem. */
  campo: "text-[14px] leading-[1.55]",
} as const;

/** Anel de foco visível (teclado). */
export const foco = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

/** Altura única de campo (36 px) e o mesmo visual para input, select e textarea. */
export const campo = `block h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-[13px] text-foreground placeholder:text-muted-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${foco}`;
export const campoTexto = `block min-h-[88px] w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-[13px] leading-5 text-foreground placeholder:text-muted-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${foco}`;

/**
 * Marca de toque compacto: no celular (< 768 px) o src/styles/responsive.css
 * dá 44 px de altura mínima a todo botão e link, o que inchava os botões do
 * sistema (32 e 36 px) e fazia a faixa segmentada transbordar. Com esta
 * classe o botão fica no tamanho desenhado e ganha a área de toque de 44 px
 * por um pseudo-elemento invisível (mesmo alvo para o dedo, mesmo visual).
 * Use `toqueCompacto` (ou o atributo data-compacto) em botão pequeno fora
 * das constantes abaixo.
 */
export const toqueCompacto = "toque-compacto";

const botaoBase = `toque-compacto inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-md px-3.5 text-[13px] font-medium transition-colors active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 ${foco}`;

/** Botões: um primário por área; o resto secundário ou discreto. */
export const botao = {
  primario: `${botaoBase} bg-primary text-primary-foreground hover:bg-primary/90`,
  secundario: `${botaoBase} border border-border bg-transparent text-foreground hover:bg-muted`,
  // Sem px-2.5: o CSS gerado sempre deixou valer o px-3.5 da base, e é esse o
  // visual aprovado. Com o juntar resolvendo conflito, manter os dois mudaria o
  // botão só onde ele passa pelo juntar.
  discreto: `${botaoBase} text-muted-foreground hover:bg-muted hover:text-foreground`,
  perigo: `${botaoBase} border border-destructive/40 bg-transparent text-destructive hover:bg-destructive/10`,
  /** Só ícone (32 px): sempre com aria-label. */
  icone: `toque-compacto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${foco}`,
  /** Ícone com texto curto na barra da mesa (32 px de altura). */
  barra: `toque-compacto inline-flex h-8 shrink-0 items-center justify-center rounded-md px-2 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${foco}`,
} as const;

/** Superfícies: o fundo da página e, quando precisa, UM nível elevado. */
export const superficie = {
  /** O único cartão elevado (Painel). Nada de cartão dentro dele. */
  painel: "rounded-lg border border-border bg-card",
  /** Poço dentro de um painel: fundo levemente diferente, sem borda. */
  poco: "rounded-md bg-muted/50",
  /** Divisória fina entre seções. */
  divisoria: "border-t border-border",
} as const;

/** Largura da área de trabalho das mesas: a tela toda até 1760 px. */
export const larguraDaMesa = "mx-auto w-full min-w-0 max-w-[1760px]";

/** Etiqueta pequena de estado (contagem, situação). */
export const etiqueta = "inline-flex h-5 shrink-0 items-center rounded px-1.5 text-[11px] font-medium leading-none tabular-nums";

/**
 * Junta classes ignorando vazios e resolve conflito do Tailwind: a classe que
 * vem depois vence (`juntar(botao.secundario, "h-8")` fica com h-8, não com o
 * h-9 da base). Antes era só um join, e quem vencia era a ordem do CSS gerado
 * (h-9 vem depois de h-8), então o ajuste de tamanho não pegava.
 *
 * Uma diferença do tailwind-merge padrão: trocar o tamanho da letra NÃO apaga
 * o `leading-*` que veio antes (texto.corpo + "text-[12px]" mantém o
 * leading-5). O padrão apagaria, porque text-sm traz altura de linha, mas o
 * painel usa tamanhos arbitrários (text-[13px]), que não trazem.
 */
const mesclar = extendTailwindMerge({ override: { conflictingClassGroups: { "font-size": [] } } });
export const juntar = (...partes: Array<string | false | null | undefined>) => mesclar(partes.filter(Boolean).join(" "));
