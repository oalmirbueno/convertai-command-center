/**
 * Jogada do texto, palavra decorativa e cor por papel (frente R3, 26/09/2026).
 *
 * Pedidos do dono sobre o modo replicar referência e a lâmina do Estúdio:
 * 1. "Nas referências ele não está seguindo a jogada de texto; está muito
 *    padrão, travado. Se o texto da referência está à esquerda e depois
 *    embaixo, ele insiste em ficar naquela posição fixa." Causa medida no
 *    código: o molde mapeava a headline inteira no MAIOR bloco da referência;
 *    quando a referência quebra o título em blocos em lugares diferentes (uma
 *    parte à esquerda, outra embaixo), os outros pedaços ficavam "vagos" (sem
 *    texto) e o título saía num lugar só. Em Inspirada e Criativa o texto ia
 *    sempre "no mesmo eixo", agrupado: um molde fixo. Agora: a headline se
 *    divide nos blocos do título da referência (mesma letra e escala), cada
 *    bloco diz a camada (na frente, atrás do assunto, por cima) e Inspirada e
 *    Criativa ganham uma jogada própria, que muda entre as lâminas da série.
 * 2. "Atrás estava escrito 'melhor' (palavra grande de fundo) e ele copiou."
 *    O molde agora marca o texto DECORATIVO (palavra gigante de fundo, marca
 *    d'água, palavra-tema) e ele é trocado por um termo curto do assunto da
 *    lâmina, tirado da copy (Choice do Jev entre candidatos; sem Jev, a
 *    heurística). Nunca a palavra da referência, a não ser que seja o tema.
 * 3. "Os textos ficam numa cor só (ex.: verde), sem destacar outra cor."
 *    hierarquiaDeCor distribui a paleta por papel: título, apoio (neutro que
 *    lê no fundo), destaque pontual numa palavra e CTA, sempre dentro da
 *    paleta (neutro claro e escuro contam como neutros da trava da marca).
 *
 * Puro, sem rede. Só tipos vêm de direcao-arte.ts (sem ciclo de valores).
 * Sem travessão em texto que vai ao modelo.
 */

import type { BlocoDoMolde, BlocoTexto, MoldeDaReferencia, PapelBloco } from "./direcao-arte.ts";
import type { FidelidadeDaReferencia } from "./fidelidade-da-referencia.ts";
import type { PerguntaJev, RespostaJev } from "./jev.ts";

type Caixa = { x0: number; x1: number; y0: number; y1: number };

// ------------------------------------------------------------------ cor (local)

const HEX = /^#[0-9a-f]{6}$/i;
export const NEUTRO_CLARO_DA_TRAVA = "#F5F3EE";
export const NEUTRO_ESCURO_DA_TRAVA = "#111418";

function hexOk(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return HEX.test(s) ? s : null;
}
function luminancia(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contraste(a: string, b: string): number {
  const la = luminancia(a), lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function saturacao(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}
/** Neutra: pouca saturação ou canais quase iguais (preto azulado e branco quente também são neutros). */
const neutra = (h: string) => {
  const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
  return saturacao(h) < 0.25 || Math.max(r, g, b) - Math.min(r, g, b) < 30;
};
/** Duas cores que o olho não separa (contraste quase 1 e mesma família): contam como a mesma. */
const quaseIgual = (a: string, b: string) => a === b || (contraste(a, b) < 1.25 && neutra(a) === neutra(b));

type CorDaPaleta = { nome?: string; hex?: string; papel?: string };

// ------------------------------------------------------------------ 1. blocos do molde

/** Papéis do molde que não são texto de leitura: a logo, o @perfil e o texto decorativo de fundo. */
export const FORA_DA_LEITURA = ["marca", "perfil", "decorativo"];

/** Blocos de leitura do molde (título, subtítulo, texto, rótulo, CTA, número). */
export function blocosDeLeitura(m: MoldeDaReferencia | null): BlocoDoMolde[] {
  return m ? m.blocos.filter((b) => FORA_DA_LEITURA.indexOf(b.papel) < 0) : [];
}

/** Texto decorativo de fundo da referência (palavra gigante, marca d'água, palavra-tema). */
export function blocosDecorativos(m: MoldeDaReferencia | null): BlocoDoMolde[] {
  return m ? m.blocos.filter((b) => b.papel === "decorativo") : [];
}

/** Ordem de leitura: de cima para baixo; na mesma faixa (3% da altura), da esquerda para a direita. */
export function naOrdemDeLeitura<T extends Caixa>(lista: T[]): T[] {
  return lista.slice().sort((a, b) => (Math.abs(a.y0 - b.y0) < 3 ? a.x0 - b.x0 : a.y0 - b.y0));
}

/**
 * Os outros pedaços do título da referência: blocos livres com o mesmo desenho
 * do bloco principal (família, peso, caixa) e escala parecida (80% ou mais da
 * altura da letra), fora de CTA e rótulo. É a referência quebrando o título em
 * lugares diferentes ("à esquerda e depois embaixo").
 */
export function pedacosDoTitulo(principal: BlocoDoMolde, livres: BlocoDoMolde[]): BlocoDoMolde[] {
  return livres.filter((b) =>
    b !== principal && b.papel !== "cta" && b.papel !== "rotulo" &&
    b.familia === principal.familia && b.peso === principal.peso && b.caixa_alta === principal.caixa_alta &&
    b.altura_da_letra >= principal.altura_da_letra * 0.8 && b.altura_da_letra <= principal.altura_da_letra * 1.25
  );
}

/**
 * Divide o texto em `pesos.length` partes na ordem, pelas palavras, com o
 * tamanho de cada parte proporcional ao peso (a capacidade do bloco). Quando o
 * texto já tem quebras na mesma quantidade, usa as quebras. Cada parte tem ao
 * menos uma palavra; com menos palavras que blocos, sai uma parte por palavra.
 */
export function dividirNasPartes(texto: string, pesos: number[]): string[] {
  const linhas = texto.split("\n").map((l) => l.trim()).filter(Boolean);
  if (linhas.length === pesos.length) return linhas;
  const palavras = texto.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const n = Math.max(1, Math.min(pesos.length, palavras.length));
  if (n === 1) return [palavras.join(" ")];
  const p = pesos.slice(0, n).map((x) => (x > 0 ? x : 1));
  const soma = p.reduce((s, x) => s + x, 0);
  const tamanhos = palavras.map((w) => w.length + 1);
  const total = tamanhos.reduce((s, x) => s + x, 0);
  const partes: string[] = [];
  let i = 0;
  let acumulado = 0;
  let alvo = 0;
  for (let k = 0; k < n; k++) {
    alvo += (p[k] / soma) * total;
    const restantes = n - k - 1;
    const parte: string[] = [];
    while (i < palavras.length - restantes && (parte.length === 0 || k === n - 1 || acumulado + tamanhos[i] / 2 <= alvo)) {
      parte.push(palavras[i]);
      acumulado += tamanhos[i];
      i++;
    }
    partes.push(parte.join(" "));
  }
  return partes;
}

/** Capacidade de um bloco (quantas letras cabem, aproximado): largura por altura da letra, vezes as linhas. */
export const capacidadeDoBloco = (b: BlocoDoMolde) => Math.max(1, ((b.x1 - b.x0) / Math.max(0.5, b.altura_da_letra)) * Math.max(1, b.linhas));

/** Camada do texto em relação ao assunto, dita ao gerador. Na frente (o comum): nada. */
export function textoDaCamada(camada: string | undefined | null): string {
  if (camada === "atras_do_assunto") return "atrás do assunto, como na referência: o assunto passa na frente e cobre parte das letras, que continuam legíveis";
  if (camada === "sobre_o_assunto") return "por cima do assunto, como na referência: as letras passam sobre ele, legíveis";
  return "";
}

// ------------------------------------------------------------------ 2. palavra decorativa

const PALAVRAS_VAZIAS = new Set([
  "para", "como", "mais", "menos", "voce", "você", "vocês", "voces", "seu", "sua", "seus", "suas", "este", "esta", "estes", "estas", "isso", "isto",
  "esse", "essa", "esses", "essas", "aqui", "quando", "porque", "porquê", "sobre", "entre", "cada", "muito", "muita", "muitos", "muitas", "pode",
  "podem", "fazer", "faz", "está", "esta", "estão", "estao", "tem", "têm", "tenha", "são", "sao", "ser", "foi", "vai", "vão", "vao", "uma", "umas",
  "uns", "nos", "nas", "dos", "das", "pelo", "pela", "pelos", "pelas", "também", "tambem", "ainda", "então", "entao", "depois", "sem", "com", "que",
  "qual", "quais", "onde", "tudo", "todo", "toda", "todos", "todas", "nada", "algo", "você?", "nosso", "nossa", "nossos", "nossas", "meu", "minha",
  "quer", "sabe", "saiba", "veja", "vale", "pena", "até", "ate", "desde", "mesmo", "mesma", "outro", "outra", "hoje", "agora", "aquele", "aquela",
  "link", "bio", "clique", "arraste", "salve", "comente", "compartilhe", "chame", "agende",
]);

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const LETRAS = "A-Za-z\\u00C0-\\u00FF";
const palavrasDe = (s: string) => (s.match(new RegExp(`[${LETRAS}0-9%]+`, "g")) || []) as string[];
const cheia = (w: string) => w.length >= 4 && !/^[0-9]/.test(w) && !PALAVRAS_VAZIAS.has(w.toLowerCase()) && !PALAVRAS_VAZIAS.has(semAcento(w));
const numero = (w: string) => /^[0-9]{2,}%?$|^[0-9]+%$/.test(w);

/**
 * Candidatos ao termo decorativo, tirados da copy da lâmina: as palavras
 * cheias da headline (as mais longas primeiro), números fortes, pares de
 * palavras cheias seguidas da headline e as palavras cheias do resto. Até 8,
 * sem repetir, em minúsculas (a caixa vem do desenho da referência).
 */
export function candidatosDoTermo(blocos: BlocoTexto[], textoExato = ""): string[] {
  const titulo = blocos.filter((b) => b.papel === "headline" || b.papel === "numero").map((b) => b.texto).join(" ");
  const resto = blocos.filter((b) => b.papel !== "headline" && b.papel !== "numero" && b.papel !== "cta" && b.papel !== "selo").map((b) => b.texto).join(" ");
  const doTitulo = palavrasDe(titulo || textoExato.split("\n")[0] || "");
  const saida: string[] = [];
  const por = (t: string) => {
    const x = t.toLocaleLowerCase("pt-BR").trim();
    if (x && x !== "nenhum" && saida.map(semAcento).indexOf(semAcento(x)) < 0) saida.push(x);
  };
  doTitulo.filter(numero).forEach(por);
  doTitulo.filter(cheia).sort((a, b) => b.length - a.length).forEach(por);
  for (let i = 0; i + 1 < doTitulo.length; i++) if (cheia(doTitulo[i]) && cheia(doTitulo[i + 1])) por(`${doTitulo[i]} ${doTitulo[i + 1]}`);
  palavrasDe(resto || textoExato).filter(cheia).sort((a, b) => b.length - a.length).forEach(por);
  return saida.slice(0, 8);
}

/** O termo quando o Jev não responde: a palavra da referência se ela for o tema (está na copy), senão o primeiro candidato. */
export function termoPadrao(candidatos: string[], palavraDaReferencia: string | null | undefined): string | null {
  const ref = semAcento(String(palavraDaReferencia || "").trim());
  if (ref && candidatos.some((c) => semAcento(c) === ref)) return candidatos.filter((c) => semAcento(c) === ref)[0];
  return candidatos.length ? candidatos[0] : null;
}

/**
 * Choice do Jev: qual candidato (tirado da copy) resume o assunto ou o gancho
 * desta lâmina para ocupar o lugar da palavra decorativa. As opções SÃO os
 * candidatos (a resposta é cópia literal de um deles); "nenhum" é a saída
 * quando nenhum serve (o código usa o termo padrão).
 */
export function perguntaDoTermo(candidatos: string[]): Record<string, PerguntaJev> {
  const criteria: Record<string, unknown> = {};
  for (const c of candidatos) criteria[c] = "Termo tirado do texto desta lâmina.";
  criteria.nenhum = "Nenhum destes termos resume o assunto da lâmina.";
  return {
    termo: {
      type: "choice",
      instructions:
        "A arte desta lâmina tem uma palavra decorativa gigante no fundo, que funciona como textura e reforça o tema. A da arte de referência (`referencia.palavra_decorativa`) era de outro assunto e sai. Qual termo, tirado do texto desta lâmina (`lamina`), melhor resume o assunto ou o gancho dela para ocupar esse lugar, lido num relance?",
      criteria,
    },
  };
}

/** Estado do Jev para o termo, em campos nomeados. */
export function estadoDoTermo(e: { blocos: BlocoTexto[]; textoExato: string; funcao: string; ordem: number; total: number; conceito?: string | null; palavraDaReferencia?: string | null }): Record<string, unknown> {
  return {
    lamina: {
      headline: e.blocos.filter((b) => b.papel === "headline" || b.papel === "numero").map((b) => b.texto).join(" ") || null,
      texto: e.textoExato,
      funcao: e.funcao || null,
      posicao: e.total > 1 ? `lâmina ${e.ordem} de ${e.total}` : "post de uma imagem",
    },
    post: { conceito: e.conceito || null },
    referencia: { palavra_decorativa: e.palavraDaReferencia || null },
  };
}

/** Lê a escolha: um candidato vale; "nenhum", fora da lista ou sem resposta: o termo padrão. */
export function decidirTermo(answers: Record<string, RespostaJev> | null | undefined, candidatos: string[], padrao: string | null): { termo: string | null; origem: "jev" | "copy" } {
  const r = answers ? answers.termo : undefined;
  const c = r && typeof r.choice === "string" ? r.choice : null;
  if (c && c !== "nenhum" && candidatos.indexOf(c) >= 0) return { termo: c, origem: "jev" };
  return { termo: padrao, origem: "copy" };
}

/** O termo no desenho do bloco decorativo: caixa alta quando ele é todo em maiúsculas. Curto (até 2 palavras, 24 letras). */
export function termoNoDesenho(termo: string, b: Pick<BlocoDoMolde, "caixa_alta">): string {
  const curto = termo.replace(/\s+/g, " ").trim().split(" ").slice(0, 2).join(" ").slice(0, 24);
  return b.caixa_alta ? curto.toLocaleUpperCase("pt-BR") : curto;
}

/**
 * Linha do texto decorativo no prompt do replicar. Idêntica e Próxima: no
 * lugar medido; Inspirada: a mesma ideia de palavra de fundo, em outro lugar.
 * Criativa e sem termo: nada.
 */
export function linhaDoDecorativo(e: {
  fidelidade: FidelidadeDaReferencia;
  bloco: BlocoDoMolde;
  termo: string | null;
  posicao: string;
  cor: string | null;
}): string {
  if (!e.termo || e.fidelidade === "criativa") return "";
  const t = termoNoDesenho(e.termo, e.bloco);
  if (!t) return "";
  const palavra = String(e.bloco.texto_decorativo || "").trim();
  const mesma = !!palavra && semAcento(palavra) === semAcento(t);
  const cor = e.cor ? `, cor ${e.cor}` : "";
  if (e.fidelidade === "inspirada") {
    return `- TEXTO DECORATIVO DE FUNDO: como a referência, uma palavra gigante de fundo, agora "${t}", atrás do conteúdo, como textura (grande, cortada pela borda se precisar, sem competir com o título)${cor}; em outro lugar da composição nova. Nunca a palavra da referência.`;
  }
  const quem = palavra && !mesma ? `a palavra grande de fundo da referência ("${palavra}") sai; ` : "";
  return `- TEXTO DECORATIVO DE FUNDO: ${quem}no lugar dela, ${e.posicao}, escreva "${t}" com o mesmo tamanho, desenho, transparência e camada${cor}; é textura atrás do conteúdo e não entra na hierarquia de leitura.${mesma ? "" : " Nunca repita a palavra da referência."}`;
}

// ------------------------------------------------------------------ 3. cor por papel

export type HierarquiaDeCor = {
  titulo: string | null;
  apoio: string | null;
  /** Destaque pontual numa palavra: na cor, ou (sem cor legível) com um traço grosso da cor atrás ou embaixo da palavra. */
  destaque: { cor: string; modo: "cor" | "traco" } | null;
  cta: string | null;
};

/**
 * Distribui a paleta por papel do texto, dentro da paleta do cliente (neutro
 * claro e escuro contam como neutros, como na trava da marca):
 * - título: o que o chamador já decidiu (a cor aprovada); sem ela, a colorida
 *   da paleta que lê no fundo (3:1), senão o neutro de maior contraste;
 * - apoio: um neutro que lê no fundo (4,5:1) e é OUTRA cor que a do título;
 *   sem outro legível, a mesma do título;
 * - destaque: uma cor da paleta diferente do título, que lê no fundo (3:1),
 *   na palavra-chave; sem nenhuma legível, a colorida vira traço atrás da
 *   palavra (a letra continua na cor do título);
 * - CTA: a do destaque quando ela lê; senão a do título.
 * Sem paleta válida: tudo null (o prompt fica como estava).
 */
export function hierarquiaDeCor(e: { paleta: CorDaPaleta[]; fundo: string | null; titulo?: string | null }): HierarquiaDeCor {
  const cores = e.paleta.map((p) => ({ hex: hexOk(p.hex), papel: String(p.papel || "").toLowerCase() })).filter((p) => !!p.hex) as { hex: string; papel: string }[];
  if (!cores.length) return { titulo: e.titulo ?? null, apoio: e.titulo ?? null, destaque: null, cta: e.titulo ?? null };
  const fundo = hexOk(e.fundo);
  const lê = (c: string, min: number) => !fundo || contraste(c, fundo) >= min;
  const naoFundo = (c: string) => !fundo || !quaseIgual(c, fundo);
  const peso = (p: string) => (p.indexOf("destaque") >= 0 || p.indexOf("acento") >= 0 ? 0 : p.indexOf("texto") >= 0 ? 1 : p.indexOf("fundo") >= 0 ? 3 : 2);
  const coloridas = cores.filter((c) => !neutra(c.hex) && naoFundo(c.hex)).sort((a, b) => peso(a.papel) - peso(b.papel)).map((c) => c.hex);
  const neutrasDaPaleta = cores.filter((c) => neutra(c.hex)).sort((a, b) => peso(a.papel) - peso(b.papel)).map((c) => c.hex);
  const neutros = neutrasDaPaleta.concat([NEUTRO_CLARO_DA_TRAVA, NEUTRO_ESCURO_DA_TRAVA]);
  const melhorNeutro = () => (fundo ? neutros.reduce((m, c) => (contraste(c, fundo) > contraste(m, fundo) ? c : m)) : neutros[0]);

  const titulo = hexOk(e.titulo) || coloridas.filter((c) => lê(c, 3))[0] || melhorNeutro();
  const apoio = neutros.filter((c) => lê(c, 4.5) && !quaseIgual(c, titulo))[0] || titulo;
  const colorida = coloridas.filter((c) => !quaseIgual(c, titulo) && lê(c, 3))[0] || null;
  const destaque = colorida
    ? { cor: colorida, modo: "cor" as const }
    : coloridas.filter((c) => !quaseIgual(c, titulo))[0]
    ? { cor: coloridas.filter((c) => !quaseIgual(c, titulo))[0], modo: "traco" as const }
    : null;
  return { titulo, apoio, destaque, cta: destaque && destaque.modo === "cor" ? destaque.cor : titulo };
}

/** Linha curta da hierarquia de cor para o prompt. Sem cor nenhuma: vazia. */
export function linhaDaHierarquia(h: HierarquiaDeCor, temApoio = true): string {
  if (!h.titulo) return "";
  const destaque = h.destaque
    ? h.destaque.modo === "cor"
      ? `a palavra-chave da headline (uma só) em ${h.destaque.cor}`
      : `a palavra-chave da headline (uma só) com um traço grosso de ${h.destaque.cor} atrás ou embaixo dela, a letra na cor da headline`
    : "a palavra-chave da headline em peso maior";
  return `- Cor com hierarquia, só da paleta: headline em ${h.titulo}; ${destaque}${temApoio ? `; apoio em ${h.apoio || h.titulo}` : ""}. Nunca todo o texto numa cor só da marca.`;
}

/** Só o destaque pontual (Próxima: as cores de cada bloco já vêm do molde). Sem cor diferente do título: vazia. */
export function linhaDoDestaque(h: HierarquiaDeCor): string {
  if (!h.destaque) return "";
  return h.destaque.modo === "cor"
    ? `- Destaque pontual: a palavra-chave da headline (uma só) em ${h.destaque.cor}, dentro da paleta; o resto do texto na cor do bloco.`
    : `- Destaque pontual: a palavra-chave da headline (uma só) com um traço grosso de ${h.destaque.cor} atrás ou embaixo dela; a letra fica na cor do bloco.`;
}

/**
 * Idêntica e Próxima: duas cores DIFERENTES da referência (coloridas) que
 * viraram a MESMA cor da marca separam de novo: a segunda (na ordem de
 * destaque) pega a próxima colorida da paleta que lê no fundo (3:1). Neutras
 * que se juntam ficam (preto e cinza viram o mesmo neutro, como hoje).
 * `itens`: na ordem de destaque (o maior bloco primeiro).
 */
export function separarCoresRepetidas(itens: { corDaReferencia: string | null; corNaMarca: string | null }[], paleta: CorDaPaleta[], fundo: string | null): (string | null)[] {
  const f = hexOk(fundo);
  const coloridas = paleta.map((p) => hexOk(p.hex)).filter((c): c is string => !!c && !neutra(c) && (!f || (!quaseIgual(c, f) && contraste(c, f) >= 3)));
  const saida = itens.map((x) => x.corNaMarca);
  const dono = new Map<string, string>(); // cor da marca -> cor da referência que a usou primeiro
  itens.forEach((x, i) => {
    const ref = hexOk(x.corDaReferencia);
    const marca = x.corNaMarca;
    // Só cores COLORIDAS da referência contam (neutras que se juntam ficam); a da marca pode ter virado neutra por contraste.
    if (!ref || !marca || neutra(ref)) return;
    const primeiro = dono.get(marca);
    if (!primeiro) {
      dono.set(marca, ref);
      return;
    }
    if (quaseIgual(primeiro, ref)) return;
    const livre = coloridas.filter((c) => !dono.has(c) && c !== marca)[0];
    if (!livre) return;
    dono.set(livre, ref);
    saida[i] = livre;
  });
  return saida;
}

// ------------------------------------------------------------------ 4. jogada nas composições livres

export type FamiliaDaJogada = "separados" | "agrupados" | "atras";

type Jogada = { familia: FamiliaDaJogada; assunto?: boolean; titulo: string; comApoio: string };

/** Jogadas de texto (relação entre os blocos), para Inspirada e Criativa. Cada uma cabe em qualquer grade. */
export const JOGADAS: Jogada[] = [
  { familia: "separados", titulo: "o título no alto, à esquerda, em 2 ou 3 linhas curtas", comApoio: "o apoio sozinho no canto de baixo, do lado oposto, pequeno e alinhado à borda dele" },
  { familia: "separados", titulo: "o título grande na base, atravessando a largura", comApoio: "o apoio no alto, curto, como um rótulo alinhado à margem" },
  { familia: "separados", titulo: "o título numa coluna estreita de uma lateral, em linhas curtas empilhadas", comApoio: "o apoio do outro lado, na horizontal, na altura do fim do título" },
  { familia: "agrupados", titulo: "o título em escada, cada linha começando um pouco mais para dentro", comApoio: "o apoio logo abaixo da última linha, alinhado ao começo dela" },
  { familia: "agrupados", titulo: "o título com a palavra-chave bem maior que as outras, em linhas de tamanhos diferentes", comApoio: "o apoio encaixado no vão ao lado da linha mais curta" },
  { familia: "atras", assunto: true, titulo: "o título gigante atravessando o meio, atrás do assunto (o assunto cobre parte das letras e a palavra continua legível)", comApoio: "o apoio na frente, perto da base, pequeno" },
  { familia: "separados", titulo: "o título quebrado em duas partes em lugares diferentes (uma no alto, outra embaixo), lidas em sequência", comApoio: "o apoio junto da segunda parte, menor" },
];

/** A família da jogada da referência: texto atrás do assunto, blocos separados (longe um do outro) ou agrupados. */
export function familiaDaReferencia(m: MoldeDaReferencia | null): FamiliaDaJogada | null {
  if (!m) return null;
  const leitura = blocosDeLeitura(m);
  if (!leitura.length) return null;
  if (leitura.some((b) => b.camada === "atras_do_assunto")) return "atras";
  const maiores = leitura.slice().sort((a, b) => b.altura_da_letra - a.altura_da_letra).slice(0, 3);
  const centro = (b: Caixa) => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });
  const longe = maiores.some((a, i) => maiores.some((b, k) => k > i && Math.abs(centro(a).y - centro(b).y) + Math.abs(centro(a).x - centro(b).x) > 35));
  return longe ? "separados" : "agrupados";
}

/**
 * Linhas da jogada do texto em Inspirada e Criativa, no lugar do antigo "os
 * blocos no mesmo eixo". Inspirada: a mesma família da jogada da referência
 * (separados, agrupados ou atrás do assunto), em outra posição; Criativa: uma
 * jogada própria. As duas mudam de lâmina para lâmina da série (pela ordem).
 * Idêntica e Próxima: vazio (o lugar vem do molde).
 */
export function jogadaSolta(e: { fidelidade: FidelidadeDaReferencia; ordem: number; molde: MoldeDaReferencia | null; papeis: PapelBloco[]; temAssunto: boolean; capa: boolean }): string[] {
  if (e.fidelidade !== "inspirada" && e.fidelidade !== "criativa") return [];
  const familia = e.fidelidade === "inspirada" ? familiaDaReferencia(e.molde) : null;
  const possiveis = JOGADAS.filter((j) => (!j.assunto || e.temAssunto) && (!familia || j.familia === familia || (familia === "atras" && !e.temAssunto)));
  const lista = possiveis.length ? possiveis : JOGADAS.filter((j) => !j.assunto);
  const deslocamento = e.fidelidade === "criativa" ? 2 : 0;
  const j = lista[(Math.max(1, e.ordem) - 1 + deslocamento) % lista.length];
  const temApoio = e.papeis.some((p) => p === "apoio" || p === "subtitulo");
  const temCta = e.papeis.some((p) => p === "cta");
  const pedacos = e.fidelidade === "inspirada" && e.molde ? quebraDoTituloNaReferencia(e.molde) : 0;
  return [
    `- Jogada do texto desta lâmina (própria, muda de lâmina para lâmina da série): ${j.titulo}${temApoio ? `; ${j.comApoio}` : ""}${temCta ? `; a chamada para ação destacada perto da base, longe do ${temApoio ? "apoio" : "título"}` : ""}.`,
    pedacos > 1 ? `- Como a referência, o título pode se quebrar em ${pedacos} blocos em lugares diferentes, lidos em sequência.` : "",
    "- Os blocos não precisam ficar no mesmo eixo: cada um no seu lugar, com hierarquia clara (título, apoio, chamada) e respiro em volta; nada centralizado por padrão.",
    e.capa ? "- Se a VARIEDADE abaixo pedir outro lugar para o título, vale ela; a relação entre os blocos continua." : "",
  ].filter(Boolean);
}

/** Em quantos blocos a referência quebra o título (1 quando não quebra). */
export function quebraDoTituloNaReferencia(m: MoldeDaReferencia): number {
  const leitura = blocosDeLeitura(m).sort((a, b) => b.altura_da_letra - a.altura_da_letra);
  if (!leitura.length) return 0;
  return 1 + pedacosDoTitulo(leitura[0], leitura).length;
}
