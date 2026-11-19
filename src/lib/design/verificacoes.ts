/**
 * As verificações de contraste dos tokens (WCAG 2.2 AA), numa lista só para o
 * script `npm run design:contraste` e para src/test/contraste-tokens.test.ts.
 * Imports relativos com ".ts" para o Node 24 rodar direto.
 */
import { MINIMO, lerTokensDoCss, razaoDeContraste, type MapaDeTokens } from "./contraste.ts";
import { CORES_DA_EMPRESA, SUPERFICIES_DA_TINTA, tonsDaCor } from "../produto/aparencia.ts";

export type Tema = "escuro" | "claro";

export interface Verificacao {
  grupo: "texto" | "grafico" | "empresa";
  tema: Tema;
  /** "frente / fundo", ex. "foreground / card" ou "azul: texto no botão". */
  par: string;
  razao: number;
  minimo: number;
  passa: boolean;
  /** Reprova o mínimo, mas é exceção decidida pelo dono (EXCECOES_DO_DONO). `passa` fica true. */
  excecao?: boolean;
}

/**
 * Exceções decididas pelo Almir no chat (19/11/2026, 15h14): manter o verde atual do tema claro
 * (`145 80% 38%`) em vez do `145 80% 34%` do PR #160. O botão e o anel verdes do claro ficam em
 * 2,59:1 no fundo e 2,91:1 no cartão (mínimo 3:1). Só estes pares, e nunca abaixo do piso.
 * O texto em cima do botão NÃO é exceção: passa 4,5:1 (6,73:1).
 */
export const EXCECOES_DO_DONO: ReadonlySet<string> = new Set([
  "claro|primary / background",
  "claro|primary / card",
  "claro|ring / background",
  "claro|ring / card",
  "claro|verde: botão / background",
  "claro|verde: botão / card",
]);
export const PISO_DA_EXCECAO = 2.5;

/** Pares de texto do painel (frente, fundo): 4,5:1. */
export const PARES_DE_TEXTO: Array<[string, string]> = [
  ["foreground", "background"],
  ["foreground", "card"],
  ["muted-foreground", "background"],
  ["muted-foreground", "card"],
  ["muted-foreground", "muted"],
  ["primary-text", "background"],
  ["primary-text", "card"],
  ["primary-text", "accent-soft"],
  ["primary-foreground", "primary"],
  ["accent-foreground", "accent"],
  ["on-accent", "accent-solid"],
  ["on-accent-muted", "accent-solid"],
  ["on-accent", "accent-solid-deep"],
  ["on-accent-muted", "accent-solid-deep"],
  ["success", "card"],
  ["success", "success-soft"],
  ["warning", "card"],
  ["warning", "warning-soft"],
  ["info", "card"],
  ["info", "info-soft"],
  ["destructive", "card"],
  ["destructive", "danger-soft"],
  ["destructive-foreground", "destructive"],
  ["secondary-foreground", "secondary"],
  ["card-ink-foreground", "card-ink"],
  ["card-ink-muted", "card-ink"],
  ["card-ink-accent", "card-ink"],
  ["card-ink-accent", "card-ink-well"],
  ["sidebar-foreground", "sidebar-background"],
];

/** Elementos gráficos (botão, anel, ícone) contra o que fica em volta: 3:1. */
export const PARES_GRAFICOS: Array<[string, string]> = [
  ["primary", "background"],
  ["primary", "card"],
  ["ring", "background"],
  ["ring", "card"],
];

function linha(grupo: Verificacao["grupo"], tema: Tema, par: string, razao: number, minimo: number): Verificacao {
  if (razao < minimo && razao >= PISO_DA_EXCECAO && EXCECOES_DO_DONO.has(`${tema}|${par}`)) {
    return { grupo, tema, par, razao, minimo, passa: true, excecao: true };
  }
  return { grupo, tema, par, razao, minimo, passa: razao >= minimo };
}

function tokensDoPainel(tema: Tema, tokens: MapaDeTokens): Verificacao[] {
  const valor = (n: string) => {
    const v = tokens[`--${n}`];
    if (!v) throw new Error(`Token --${n} não existe no tema ${tema}`);
    return v;
  };
  return [
    ...PARES_DE_TEXTO.map(([a, b]) => linha("texto", tema, `${a} / ${b}`, razaoDeContraste(valor(a), valor(b)), MINIMO.texto)),
    ...PARES_GRAFICOS.map(([a, b]) => linha("grafico", tema, `${a} / ${b}`, razaoDeContraste(valor(a), valor(b)), MINIMO.grafico)),
  ];
}

function coresDaEmpresa(tema: Tema, tokens: MapaDeTokens): Verificacao[] {
  const fundo = tokens["--background"];
  const cartao = tokens["--card"];
  const saida: Verificacao[] = [];
  for (const c of CORES_DA_EMPRESA) {
    const t = tonsDaCor(c.id, tema === "claro" ? "light" : "dark");
    const tinta = SUPERFICIES_DA_TINTA[tema === "claro" ? "light" : "dark"];
    const n = c.id;
    saida.push(
      linha("empresa", tema, `${n}: texto no botão`, razaoDeContraste(t.textoNoBotao, t.tom), MINIMO.texto),
      linha("empresa", tema, `${n}: botão / background`, razaoDeContraste(t.tom, fundo), MINIMO.grafico),
      linha("empresa", tema, `${n}: botão / card`, razaoDeContraste(t.tom, cartao), MINIMO.grafico),
      linha("empresa", tema, `${n}: texto / background`, razaoDeContraste(t.tomDoTexto, fundo), MINIMO.texto),
      linha("empresa", tema, `${n}: texto / card`, razaoDeContraste(t.tomDoTexto, cartao), MINIMO.texto),
    );
    // Verde não troca variável nenhuma (fica o tema do painel, conferido acima); as outras trocam também estes.
    if (n === "verde") continue;
    saida.push(
      linha("empresa", tema, `${n}: texto / accent-soft`, razaoDeContraste(t.tomDoTexto, t.suave), MINIMO.texto),
      linha("empresa", tema, `${n}: on-accent / accent-solid-deep`, razaoDeContraste(t.textoNoBotao, t.fundo), MINIMO.texto),
      linha("empresa", tema, `${n}: on-accent-muted / accent-solid`, razaoDeContraste(t.apagado, t.tom), MINIMO.texto),
      linha("empresa", tema, `${n}: on-accent-muted / accent-solid-deep`, razaoDeContraste(t.apagado, t.fundo), MINIMO.texto),
      linha("empresa", tema, `${n}: card-ink-accent / card-ink`, razaoDeContraste(t.tomDaTinta, tinta.cartao), MINIMO.texto),
      linha("empresa", tema, `${n}: card-ink-accent / card-ink-well`, razaoDeContraste(t.tomDaTinta, tinta.poco), MINIMO.texto),
      linha("empresa", tema, `${n}: texto no destaque / card-ink-accent`, razaoDeContraste(tinta.textoNoBotao, t.tomDaTinta), MINIMO.texto),
    );
  }
  return saida;
}

/** Todas as verificações a partir do texto do src/index.css. */
export function verificarTokens(css: string): Verificacao[] {
  const { escuro, claro } = lerTokensDoCss(css);
  return [...tokensDoPainel("escuro", escuro), ...tokensDoPainel("claro", claro), ...coresDaEmpresa("escuro", escuro), ...coresDaEmpresa("claro", claro)];
}
