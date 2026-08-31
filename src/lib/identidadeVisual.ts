/**
 * A identidade visual que dá para extrair — e a que não dá.
 *
 * Do perfil do Instagram o painel recebe LOGO (foto de perfil), nome, bio
 * e site. Desses, cor é derivável: a paleta sai dos pixels da própria
 * logo. Já a TIPOGRAFIA não é extraível — a fonte que a marca usa vive
 * dentro de imagens achatadas, e qualquer valor que a tela mostrasse ali
 * seria chute com cara de dado.
 *
 * Por isso a tipografia é campo que a pessoa preenche. Um "Montserrat"
 * inventado pelo painel seria copiado para um briefing e viraria decisão
 * de marca baseada num palpite meu.
 */

export interface CorDaMarca {
  hex: string;
  /** Quantos pixels caíram neste balde: a força da cor na imagem. */
  peso: number;
  /** Fração do total, de 0 a 1. */
  proporcao: number;
}

const hex2 = (n: number) => n.toString(16).padStart(2, "0");

export function paraHex(r: number, g: number, b: number): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`.toUpperCase();
}

/** Luminância relativa (WCAG), para decidir texto claro ou escuro em cima. */
export function luminancia(hex: string): number {
  const m = hex.replace("#", "");
  const canal = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const r = canal(parseInt(m.slice(0, 2), 16));
  const g = canal(parseInt(m.slice(2, 4), 16));
  const b = canal(parseInt(m.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Preto ou branco por cima desta cor, pelo contraste real. */
export function textoSobre(hex: string): "#000000" | "#FFFFFF" {
  return luminancia(hex) > 0.45 ? "#000000" : "#FFFFFF";
}

/**
 * A paleta de uma imagem, por quantização em baldes.
 *
 * Agrupar em baldes de 32 níveis por canal é o que faz dois pixels quase
 * iguais contarem como a mesma cor — sem isso, uma imagem com gradiente
 * devolveria mil "cores da marca" e nenhuma seria útil.
 *
 * Pixels quase transparentes são descartados: a borda de um PNG
 * arredondado renderia um cinza que não existe na marca.
 */
export function extrairPaleta(
  pixels: Uint8ClampedArray,
  quantasCores = 6,
): CorDaMarca[] {
  const baldes = new Map<string, { r: number; g: number; b: number; n: number }>();
  let considerados = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3];
    if (a < 200) continue;
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];

    const chave = `${r >> 5}-${g >> 5}-${b >> 5}`;
    const atual = baldes.get(chave);
    if (atual) {
      atual.r += r; atual.g += g; atual.b += b; atual.n += 1;
    } else {
      baldes.set(chave, { r, g, b, n: 1 });
    }
    considerados += 1;
  }

  if (considerados === 0) return [];

  return [...baldes.values()]
    .sort((x, y) => y.n - x.n)
    .slice(0, quantasCores)
    .map((c) => ({
      // A média do balde, e não o primeiro pixel: o representante fica no
      // centro do grupo em vez de num canto dele.
      hex: paraHex(Math.round(c.r / c.n), Math.round(c.g / c.n), Math.round(c.b / c.n)),
      peso: c.n,
      proporcao: c.n / considerados,
    }));
}

export interface IdentidadeParaCopiar {
  nome: string;
  username?: string | null;
  site?: string | null;
  bio?: string | null;
  cores: readonly CorDaMarca[];
  tipografia?: string | null;
}

/**
 * O texto que vai para o briefing.
 *
 * A tipografia só aparece quando alguém preencheu. Escrever "não
 * informada" é melhor que omitir: quem cola isso num briefing precisa
 * saber que o campo existe e está vazio, e não concluir que a marca não
 * tem fonte definida.
 */
export function identidadeEmTexto(id: IdentidadeParaCopiar): string {
  const linhas = [
    `Identidade — ${id.nome}`,
    id.username ? `Perfil: @${id.username}` : null,
    id.site ? `Site: ${id.site}` : null,
    "",
    "Cores (extraídas da logo, por frequência):",
    ...id.cores.map((c) => `  ${c.hex}  ·  ${(c.proporcao * 100).toFixed(1)}% da imagem`),
    "",
    `Tipografia: ${id.tipografia?.trim() || "não informada — o Instagram não expõe a fonte da marca"}`,
    id.bio ? `\nBio:\n${id.bio}` : null,
  ];
  return linhas.filter((l) => l !== null).join("\n");
}
