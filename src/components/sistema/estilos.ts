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

/**
 * Escala de fonte FECHADA (28/09): 11, 12, 13, 14, 15, 20 e 24 px. Nada fora
 * dela (nada de 10,5, 11,5, 12,5, 13,5, 16, 18 px nem text-xs/text-sm/text-lg).
 * 14 px é só a conversa com agente (`conversa`); 24 px é só número de destaque
 * (`texto.numero`). A tabela de troca está em docs/design/SISTEMA.md, seção 2,
 * e o teste src/test/padrao-visual-catraca.test.ts não deixa o total subir.
 */
export const ESCALA_DE_FONTE = [11, 12, 13, 14, 15, 20, 24] as const;

/** Escala tipográfica: sete papéis, seis tamanhos (mais os 14 px da conversa). */
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
  /** Etiqueta, contador, legenda miúda (11 px). O menor tamanho do painel. */
  etiqueta: "text-[11px] font-medium leading-4",
  /** Número de destaque (KPI, total): 24 px, algarismos da mesma largura. */
  numero: "text-[24px] font-semibold leading-8 tracking-[-0.01em] tabular-nums text-foreground",
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

/**
 * Superfícies: o fundo da página e, quando precisa, UM nível elevado.
 * Seção NÃO vira cartão (28/09, dono: "ficou tudo encaixotado"). Cartão só
 * para o que é uma COISA: mídia, item de grade, janela, flutuante, ou o bloco
 * que a seção 4 do SISTEMA.md já permitia no Painel.
 */
export const superficie = {
  /** O único cartão elevado (Painel). Nada de cartão dentro dele. Nunca para embrulhar uma seção. */
  painel: "rounded-lg border border-border bg-card",
  /** Poço dentro de um painel: fundo levemente diferente, sem borda. */
  poco: "rounded-md bg-muted/50",
  /** Divisória fina entre seções. */
  divisoria: "border-t border-border",
} as const;

/**
 * Ritmo de espaço (28/09, dono: "era só organizar melhor"). Seção é ABERTA:
 * título, conteúdo e espaço; divisória fina só quando precisa. O espaço é o
 * que separa, não caixa. Escala de 4/8 (SISTEMA.md seção 3).
 */
export const espaco = {
  /** Entre os blocos grandes da página (cabeçalho, barra, seções): 24 px. */
  pagina: "min-w-0 space-y-6",
  /** Seções abertas lado a lado: 32 px entre colunas, 28 px entre linhas. */
  colunas: "grid min-w-0 items-start gap-x-8 gap-y-7",
  /** Itens de uma grade (mídia, item que é uma coisa): 16 px. */
  grade: "grid min-w-0 gap-4",
  /** Grupos de funções (GrupoDeFuncoes): 24 px entre colunas, 20 px entre linhas. */
  grupos: "grid min-w-0 gap-x-6 gap-y-5",
  /** Respiro interno de um Painel ou item (16 px no celular, 20 px de 640 para cima). */
  interno: "p-4 sm:p-5",
} as const;

/**
 * Linha de lista moderna (estilo Linear/Vercel): sem caixa por linha e sem
 * traço duro. A lista encosta nas margens com `-mx-2` para o texto alinhar
 * com o título, e a linha ganha fundo suave arredondado ao passar o mouse.
 * A linha em destaque ("de hoje") usa fundo verde bem leve, sem faixa lateral.
 * Quando a lista precisa de separação, `divisoria` (traço a 50%).
 */
export const lista = {
  /** A lista (ul): alinha o texto das linhas com o título da seção. */
  aberta: "-mx-2 min-w-0",
  /** A lista com traço leve entre as linhas (junte com `aberta`). */
  divisoria: "divide-y divide-border/50",
  /** Uma linha: canto, respiro e fundo suave no hover. */
  linha: "flex min-w-0 items-center rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/40",
  /** Linha em destaque (junte com `linha`): fundo verde leve no lugar do hover. */
  destaque: "bg-primary/[0.07] hover:bg-primary/10",
} as const;

/**
 * Rolagem (regra 2.7 do plano de padronização, SISTEMA.md seção 8): uma por
 * região, nada de rolagem dentro de rolagem, nada de caixa com rolagem própria
 * prendendo o dedo no celular. Lista longa dentro da página só rola por dentro
 * de 1024 px para cima (`lg:`); abaixo disso a página rola normal. Classes
 * inteiras aqui para o Tailwind gerar. `janela` é só para o que já está numa
 * janela, popover ou gaveta (altura fixa em toda largura).
 * A regra em código: `rolagemPresaNoCelular` (src/components/sistema/regras.ts).
 */
export const rolagem = {
  /** Lista curta (até ~6 linhas) dentro da página. */
  curta: "lg:max-h-[300px] lg:overflow-y-auto lg:overscroll-contain",
  /** Lista média dentro da página. */
  lista: "lg:max-h-[420px] lg:overflow-y-auto lg:overscroll-contain",
  /** Lista longa dentro da página. */
  longa: "lg:max-h-[560px] lg:overflow-y-auto lg:overscroll-contain",
  /** Corpo de janela, popover ou gaveta. */
  janela: "max-h-[60vh] overflow-y-auto overscroll-contain",
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
