/**
 * Vitrine de logos (02/10, dono: "apresentar os parceiros", "as logos das
 * empresas"): quando a arte rápida apresenta várias marcas, as logos que a
 * equipe mandou entram numa grade organizada, coladas pelo CÓDIGO depois da
 * geração (como o selo da campanha): o gerador de imagem nunca redesenha logo
 * de terceiro. Ele só desenha o fundo, o título e um painel liso na área da
 * grade; aqui ficam as contas puras (quantas logos em cada lâmina, onde fica
 * a área e a célula de cada logo).
 *
 * Sem import de Deno nem de npm: a tela, a função e os testes leem o mesmo arquivo.
 */

/** Logos por lâmina do carrossel (grade de 3 x 3). */
export const MAX_LOGOS_NA_VITRINE_POR_LAMINA = 9;
/** Teto de logos numa lâmina só (grade de 4 x 3), na arte única ou quando faltam lâminas. */
export const MAX_LOGOS_NUMA_LAMINA = 12;
/** A partir de quantas logos o pedido pode virar vitrine. */
export const MIN_LOGOS_PARA_VITRINE = 3;

export interface LogoDaVitrine {
  caminho: string;
  nome: string;
}

export interface Area {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Sem o Jev: o pedido fala de parceiros, patrocinadores, apoiadores ou logos de empresas. */
export function pedeVitrinePelaRegra(pedido: string): boolean {
  const p = String(pedido || "").toLowerCase();
  return /parceir|patrocin|apoiador|expositor|logos d|logomarcas|marcas parceiras|empresas que|clientes que|quem confia|nossos clientes|realiza[cç][aã]o e apoio/.test(p);
}

/** Lâminas de logos que um carrossel pede (fora a capa). */
export const laminasDeLogos = (n: number) => (n > 0 ? Math.ceil(n / MAX_LOGOS_NA_VITRINE_POR_LAMINA) : 0);

/** Quantas lâminas o carrossel da vitrine pede: a capa e as de logos (de 2 a 10). */
export const laminasDoCarrosselDaVitrine = (n: number) => Math.max(2, Math.min(10, 1 + laminasDeLogos(n)));

/**
 * As logos (índices 0..n-1) em cada lâmina. Arte única ou uma lâmina só: todas
 * na lâmina, até 12. Carrossel: a capa apresenta o tema e as lâminas seguintes
 * levam as logos em grades equilibradas (até 9 cada; até 12 quando faltam
 * lâminas). `fora` é quantas não couberam.
 */
export function distribuirLogosNasLaminas(n: number, ordens: number[]): { porLamina: Record<number, number[]>; fora: number } {
  const porLamina: Record<number, number[]> = {};
  const lista = ordens.slice().sort((a, b) => a - b);
  if (n <= 0 || !lista.length) return { porLamina, fora: Math.max(0, n) };
  if (lista.length === 1) {
    const cabem = Math.min(n, MAX_LOGOS_NUMA_LAMINA);
    porLamina[lista[0]] = Array.from({ length: cabem }, (_, i) => i);
    return { porLamina, fora: n - cabem };
  }
  const disponiveis = lista.slice(1);
  const k = Math.min(disponiveis.length, laminasDeLogos(n));
  const porLaminaMax = k * MAX_LOGOS_NA_VITRINE_POR_LAMINA >= n ? MAX_LOGOS_NA_VITRINE_POR_LAMINA : MAX_LOGOS_NUMA_LAMINA;
  const cabem = Math.min(n, k * porLaminaMax);
  const base = Math.floor(cabem / k);
  const resto = cabem % k;
  let i = 0;
  for (let j = 0; j < k; j++) {
    const qtd = base + (j < resto ? 1 : 0);
    porLamina[disponiveis[j]] = Array.from({ length: qtd }, (_, x) => i + x);
    i += qtd;
  }
  return { porLamina, fora: n - cabem };
}

/** Área da grade (fração do quadro final): abaixo do título, acima da faixa da logo do cliente. */
export function areaDaVitrine(sozinha: boolean): Area {
  return sozinha ? { x0: 0.08, y0: 0.36, x1: 0.92, y1: 0.84 } : { x0: 0.08, y0: 0.3, x1: 0.92, y1: 0.86 };
}

/** Colunas da grade pela quantidade de logos. */
export function colunasDaGrade(n: number): number {
  if (n <= 1) return 1;
  if (n === 2 || n === 4) return 2;
  if (n <= 9) return 3;
  return 4;
}

/**
 * A célula de cada logo dentro da área (fração do quadro), com respiro entre
 * elas; a última linha incompleta fica centralizada.
 */
export function celulasDaGrade(n: number, area: Area, respiro = 0.025): Area[] {
  if (n <= 0) return [];
  const cols = colunasDaGrade(n);
  const linhas = Math.ceil(n / cols);
  const L = area.x1 - area.x0;
  const A = area.y1 - area.y0;
  const w = (L - respiro * (cols - 1)) / cols;
  const h = (A - respiro * (linhas - 1)) / linhas;
  const r = (x: number) => Math.round(x * 10000) / 10000;
  const saida: Area[] = [];
  for (let i = 0; i < n; i++) {
    const linha = Math.floor(i / cols);
    const naLinha = linha === linhas - 1 ? n - linha * cols : cols;
    const coluna = i % cols;
    const desloca = ((cols - naLinha) * (w + respiro)) / 2;
    const x0 = area.x0 + desloca + coluna * (w + respiro);
    const y0 = area.y0 + linha * (h + respiro);
    saida.push({ x0: r(x0), y0: r(y0), x1: r(x0 + w), y1: r(y0 + h) });
  }
  return saida;
}

/** Frase para o prompt da lâmina: a área que fica livre para a grade de logos entrar pelo código. */
export function areaLivreParaAVitrine(area: Area, quantas: number): string {
  const pct = (n: number) => Math.round(n * 100);
  return `VITRINE DE LOGOS: ${quantas} ${quantas === 1 ? "logo de parceiro entra" : "logos de parceiros entram"} depois, coladas pelo código, numa grade organizada dentro da área de ${pct(area.x0)}% a ${pct(area.x1)}% da largura e de ${pct(area.y0)}% a ${pct(area.y1)}% da altura. Deixe essa área como um painel liso e claro, na cor clara da marca ou branco, sem texto, sem logo, sem foto, sem ícone e sem moldura. O título e o texto ficam acima dela. Não desenhe nenhuma logo de parceiro nem nome de empresa.`;
}

/** Nota para o leitor da conferência: o texto das logos coladas não é texto da lâmina. */
export function notaDaVitrineParaOLeitor(area: Area): string {
  return ` A grade de logos de parceiros entre ${Math.round(area.y0 * 100)}% e ${Math.round(area.y1 * 100)}% da altura foi colada pelo código: não transcreva o texto dessas logos.`;
}
