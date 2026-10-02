/**
 * Diversidade visual nas mesas (02/10/2026). Pedido do dono: "o perfil da
 * cliente está todo roxo: a pessoa roxa, o cenário roxo, o texto roxo e a logo
 * roxa. Siga a identidade, mas não TUDO: mescle. Varie cores e formatos, não
 * repita a mesma pessoa, o mesmo conteúdo, os mesmos estilos. Está com muita
 * cara de IA; tem que ser mais real."
 *
 * Um conjunto só de regras para todos os diretores (Estúdio de arte, Mesa
 * Foto, Mesa Vídeos, Motion, Publicidade e o agente do Mês):
 * - blocoDaDiversidadeVisual: o bloco fixo do sistema de cada diretor (cor da
 *   marca como acento, anti-repetição, realismo), com a linha da mesa.
 * - BLOCO_DE_COR_E_REALISMO_NA_IMAGEM: a versão curta que vai no prompt do
 *   gerador de imagem (o gerador não lê o sistema do diretor).
 * - oQueVariarAgora: lê as últimas peças do cliente (metadados que cada mesa
 *   já grava) e diz, em código e sem IA, o que mudar agora. Sem histórico,
 *   regras gerais.
 * - pedidoExplicitoDeCor: o pedido que manda roupa, uniforme ou fundo na cor
 *   da marca vence a regra (busca exata no texto, sem IA).
 *
 * Puro: sem Deno, sem banco, sem IA. Sem lookbehind, sem \p{} (o painel pode
 * importar). Sem travessão nos textos.
 */

import { normalizarHex } from "./cores-da-marca.ts";
import { hexParaHsl } from "./escala-da-cor.ts";

export type MesaDaDiversidade = "arte" | "foto" | "video" | "motion" | "campanha" | "mes";

export const TITULO_DA_DIVERSIDADE = "DIVERSIDADE VISUAL E REALISMO";
export const TITULO_DO_VARIAR_AGORA = "O QUE VARIAR AGORA";

const IDENTIDADE =
  "- Identidade visual é a base reconhecível (logo, tipografia, cor de acento, tom de voz, sistema gráfico, referências e contexto do cliente), não uma cor única aplicada em tudo. Siga a identidade e misture: a marca aparece, a peça não vira uma mancha de uma cor só.";

const COR = [
  "- Cor da marca é ACENTO, não filtro: a cor principal ocupa no máximo cerca de 20 a 30% da imagem (texto em destaque, um elemento gráfico, a logo, um objeto ou detalhe de cena). O resto vem de neutros e das cores naturais da cena (pele, madeira, pedra, tecido cru, plantas, céu, concreto, papel).",
  "- Nunca tudo na mesma cor: pessoa, roupa, cenário, fundo, texto e logo nunca ficam todos na cor da marca. Fundo na cor da marca pede pessoa e cenário com cores naturais e texto em neutro claro ou escuro; cena real pede a marca só nos acentos.",
  "- Roupa natural e variada (neutros, terrosos, jeans, branco, preto, estampa discreta), escolhida pela pessoa e pela ocasião; roupa ou uniforme na cor da marca só quando o pedido disser.",
  "- Sem filtro, luz colorida ou névoa tingindo a foto inteira na cor da marca.",
];

const VARIAR = [
  "- Não repita a receita: entre peças do mesmo cliente, varie a família de layout, o cenário, o enquadramento, a temperatura da cor e da luz, a pessoa (quando houver mais de uma), a roupa e o formato. Dentro de um carrossel, ensaio ou filme a série continua; entre posts e entregas diferentes, muda.",
  "- Base inteligente, nunca cansativa: a marca fica reconhecível pela logo, pela tipografia e pelo acento, e o resto muda. Quando vier O QUE VARIAR AGORA, siga: é o histórico real deste cliente.",
];

const REALISMO = [
  "- Real, nunca cara de IA: luz natural com direção e sombra de verdade, texturas reais (poros, tecido, madeira, papel), pequenas imperfeições (fio de cabelo solto, ruga no tecido, objeto fora do lugar), pele com textura, mãos e proporções corretas, lugares e objetos que existem no Brasil de hoje.",
  "- Olhar de fotógrafo, não de banco de imagem: assimetria, ponto de vista humano, profundidade de campo realista, recorte com intenção.",
  "- Evite: pele de plástico ou cera, brilho de render, saturação alta, degradê roxo e azul, fundo genérico com brilho ou bokeh luminoso, neon roxo ou azul (salvo se for a marca), simetria perfeita de banco de imagem, todo mundo sorrindo para a câmera, 3D plástico, cena perfeita demais.",
];

const DA_MESA: Record<MesaDaDiversidade, string> = {
  arte: "- Na arte: a cor da marca vive no texto de destaque, nos painéis gráficos e na logo; a foto da cena mantém as cores reais. Alterne peça tipográfica (fundo na cor da marca permitido, com foto neutra ou sem foto) e peça fotográfica (cena natural, marca no acento). Escreva em layout.imagem a roupa e o cenário com cores concretas e naturais; cor_fundo da marca só quando o fundo é painel ou cor lisa.",
  foto: "- No ensaio: a paleta da marca entra como acento de cena (um objeto, um tecido, um papel de fundo), nunca no produto e nunca tingindo a foto inteira; o figurino da pessoa é natural e diferente do das últimas campanhas.",
  video: "- No vídeo: a bíblia fixa personagem e roupa dentro do filme; entre filmes do mesmo cliente, mude cenário, hora do dia, roupa e, havendo mais de uma pessoa, a pessoa. A cor da marca entra na edição (texto, logo, um detalhe de cena), não no figurino nem na luz.",
  motion: "- No motion: os fundos alternam entre neutro, foto real e cor da marca; a cor da marca não domina todas as cenas; cada cena muda a estrutura (tipografia grande, número, foto, divisão de tela) e o conceito não repete o dos filmes anteriores.",
  campanha: "- Na campanha: cada território e cada peça mudam cenário, casting, figurino e luz; a campanha tem tema visual próprio que conversa com a marca sem repetir a paleta inteira dela em tudo.",
  mes: "- No plano do mês: alterne o formato (carrossel, estático, fotos reais), o tipo de peça (tipográfica, foto real, cena ilustrada, bastidor, antes e depois, lista, depoimento), o cenário e o estilo entre os itens; nunca duas peças seguidas com a mesma receita visual. Na ilustração e no estilo de cada card, cenas e estilos diferentes dos itens vizinhos, com a cor da marca como acento e roupa natural.",
};

/**
 * Bloco fixo do sistema do diretor (cabe no cache do provedor: não muda por
 * pedido). O pedido explícito da equipe e a logo continuam acima dele.
 */
export function blocoDaDiversidadeVisual(mesa: MesaDaDiversidade): string {
  const realismo = mesa === "mes" ? [REALISMO[0]] : REALISMO;
  return [
    `${TITULO_DA_DIVERSIDADE} (vale sobre regras anteriores de cor e de repetição entre peças diferentes; abaixo do pedido explícito da equipe, do texto exato e da logo)`,
    IDENTIDADE,
    ...COR,
    ...VARIAR,
    DA_MESA[mesa],
    ...realismo,
  ].join("\n");
}

/** Versão curta para o prompt do gerador de imagem (lê por último, frases diretas). */
export const BLOCO_DE_COR_E_REALISMO_NA_IMAGEM = [
  "COR E REALISMO (a marca é acento, não filtro)",
  "- Cores da paleta nos elementos gráficos, no texto e na logo; foto, pessoa e cenário com as cores naturais da cena, sem filtro ou luz colorida da marca tingindo tudo. A cor principal da marca ocupa no máximo cerca de 30% da arte.",
  "- Pessoa, roupa, cenário, fundo, texto e logo nunca todos na mesma cor. Roupa: a que a cena descreve; sem descrição, tons naturais e variados, não a cor da marca.",
  "- Cara de foto real: luz natural com direção, pele com textura, tecidos e materiais reais, pequenas imperfeições; nada de pele de plástico, brilho de render, saturação alta, simetria de banco de imagem ou fundo genérico com brilho.",
].join("\n");

/** Negativo curto em inglês para os motores que pedem negativo (vídeo e imagem). */
export const NEGATIVO_DE_CARA_DE_IA =
  "plastic or waxy skin, airbrushed face, over-saturated colors, glossy CGI look, purple and blue neon glow, generic glowing background, perfect stock-photo symmetry, monochrome color cast, everything in one brand color";

// ------------------------------------------------------------------ pedido explícito

const sem = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const CORES_DITAS = "(roxa|roxo|lilas|violeta|azul|verde|vermelha|vermelho|rosa|pink|amarela|amarelo|laranja|preta|preto|branca|branco|bege|marrom|dourada|dourado|vinho|bordo|cinza|nude|terracota)";
const PECAS_DE_ROUPA = "(uniforme|farda|camiseta|camisa|camisetas|roupa|roupas|figurino|vestido|blusa|jaleco|avental|moletom|bone|polo|look)";
const ROUPA_DA_MARCA = new RegExp(`${PECAS_DE_ROUPA}[^.;\\n]{0,40}(da marca|das cores da marca|na cor da marca|nas cores da marca|cor da marca|da empresa|da loja|com a logo|com logo|personalizad)`);
const ROUPA_COM_COR = new RegExp(`${PECAS_DE_ROUPA}\\s+(de\\s+cor\\s+|na\\s+cor\\s+|em\\s+)?${CORES_DITAS}\\b`);
const UNIFORME = /\b(uniformizad[oa]s?|de uniforme|com uniforme|com a farda)\b/;
const FUNDO_DA_MARCA = /\b(fundo|cenario|background|parede)[^.;\n]{0,30}(da cor da marca|na cor da marca|nas cores da marca|cor(es)? da marca)/;
const FUNDO_COM_COR = new RegExp(`\\b(fundo|background|parede)\\s+(de\\s+cor\\s+|na\\s+cor\\s+|em\\s+)?${CORES_DITAS}\\b`);
const MONOCROMATICO = /\b(monocrom\w*|tudo (na|da) cor da marca|toda (na|da) cor da marca|so com a cor da marca|so na cor da marca)\b/;

export type PedidoDeCor = { roupa: boolean; fundo: boolean; monocromatico: boolean };

/** O pedido manda a cor da roupa ou do fundo? Busca exata no texto (sem IA): o pedido vence a regra. */
export function pedidoExplicitoDeCor(texto: string | null | undefined): PedidoDeCor {
  const t = sem(texto || "");
  if (!t.trim()) return { roupa: false, fundo: false, monocromatico: false };
  return {
    roupa: ROUPA_DA_MARCA.test(t) || ROUPA_COM_COR.test(t) || UNIFORME.test(t),
    fundo: FUNDO_DA_MARCA.test(t) || FUNDO_COM_COR.test(t),
    monocromatico: MONOCROMATICO.test(t),
  };
}

// ------------------------------------------------------------------ família da cor

export type FamiliaDaCor = { nome: string; neutra: boolean };

/** Família da cor em palavras (roxo, azul, neutro claro...). Hex inválido: null. */
export function familiaDaCor(hexBruto: unknown): FamiliaDaCor | null {
  const hex = normalizarHex(hexBruto);
  if (!hex) return null;
  const { h, s, l } = hexParaHsl(hex);
  if (l >= 92) return { nome: "branco", neutra: true };
  if (l <= 10) return { nome: "preto", neutra: true };
  if (s < 12) return { nome: l > 60 ? "neutro claro" : l < 30 ? "neutro escuro" : "cinza", neutra: true };
  if (h >= 20 && h < 50 && s < 40 && l > 60) return { nome: "bege", neutra: true };
  if (h < 15 || h >= 345) return { nome: "vermelho", neutra: false };
  if (h < 40) return { nome: l < 35 ? "marrom" : "laranja", neutra: false };
  if (h < 65) return { nome: "amarelo", neutra: false };
  if (h < 160) return { nome: "verde", neutra: false };
  if (h < 195) return { nome: "turquesa", neutra: false };
  if (h < 250) return { nome: "azul", neutra: false };
  if (h < 295) return { nome: "roxo", neutra: false };
  return { nome: "rosa", neutra: false };
}

/** Palavras que, no texto da roupa ou da cena, querem dizer a família. */
const PALAVRAS_DA_FAMILIA: Record<string, string[]> = {
  roxo: ["roxo", "roxa", "lilas", "violeta", "purpura", "lavanda", "purple", "lilac", "violet"],
  azul: ["azul", "marinho", "blue", "navy"],
  verde: ["verde", "green", "salvia", "oliva"],
  vermelho: ["vermelho", "vermelha", "red", "vinho", "bordo"],
  rosa: ["rosa", "pink", "magenta", "fucsia"],
  laranja: ["laranja", "orange", "terracota"],
  amarelo: ["amarelo", "amarela", "yellow", "mostarda"],
  turquesa: ["turquesa", "teal", "ciano", "aqua"],
  marrom: ["marrom", "brown", "chocolate", "cafe"],
};

// ------------------------------------------------------------------ o que variar agora

/** O que uma peça recente usou, lido dos metadados que a mesa já grava. Tudo opcional. */
export type PecaRecente = {
  /** Cores dominantes (hex), a primeira é a do fundo ou da maior massa. */
  cores?: Array<string | null | undefined>;
  /** Família de layout ou estrutura (zona do texto, tipo de cena, peça do kit). */
  layout?: string | null;
  /** Cenário e cena em texto livre. */
  cenario?: string | null;
  /** Quem aparece (nome, perfil ou id da pessoa). */
  pessoa?: string | null;
  /** Roupa em texto livre. */
  roupa?: string | null;
  /** Formato (carrossel, estático, 9:16...). */
  formato?: string | null;
  /** Luz em texto livre. */
  luz?: string | null;
};

export type OpcoesDoVariar = {
  /** Paleta da marca (hex ou { hex }): diz se a cor repetida é a da marca. */
  paleta?: Array<string | { hex?: unknown } | null | undefined>;
  /** O pedido da equipe: roupa ou fundo pedidos na cor vencem a regra. */
  pedido?: string | null;
  /** Quantas pessoas diferentes o cliente tem disponíveis (fotos, clones, elenco). */
  pessoasDisponiveis?: number;
  /** Famílias de layout da mesa, para sugerir as que não apareceram. */
  familias?: string[];
  /** Quantas peças ler (padrão 16). */
  max?: number;
  /** Teto do texto (padrão 1200 caracteres). */
  teto?: number;
};

const GENERICO = [
  "- Sem histórico lido: escolha uma direção que não seja a mais óbvia para a marca (layout, cenário, luz e enquadramento com intenção), com a cor da marca só como acento.",
  "- Roupa natural e cenário real; nada de pessoa, roupa, fundo e texto na mesma cor.",
];

const PARADAS = new Set(
  ("com sem para pela pelo pelas pelos como mais menos muito muita sobre entre ante desde ate cada todo toda todos todas este esta esse essa isso isto aquele aquela onde quando " +
    "uma umas uns dos das nos nas num numa que qual quais seu sua seus suas ele ela eles elas voce mesma mesmo mesmas mesmos tambem bem ainda apenas outro outra outros outras " +
    "lado frente fundo luz cena foto imagem plano quadro lamina capa marca cliente pessoa produto tons tom cores cor natural suave leve")
    .split(" "),
);

function palavras(texto: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const w of sem(texto || "").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)) {
    if (w.length >= 4 && !PARADAS.has(w) && !/^\d+$/.test(w)) out.add(w);
  }
  return out;
}

const chave = (v: string | null | undefined, max = 48) => sem(v || "").replace(/\s+/g, " ").trim().slice(0, max);

function maisFrequente(valores: string[]): { valor: string; vezes: number } | null {
  const conta = new Map<string, number>();
  let melhor: { valor: string; vezes: number } | null = null;
  for (const v of valores) {
    if (!v) continue;
    const n = (conta.get(v) || 0) + 1;
    conta.set(v, n);
    if (!melhor || n > melhor.vezes) melhor = { valor: v, vezes: n };
  }
  return melhor;
}

/** Palavras que aparecem em pelo menos metade dos textos (e em 2 ou mais), as mais frequentes primeiro. */
function palavrasRepetidas(textos: Array<string | null | undefined>, max = 4): string[] {
  const validos = textos.filter((t) => !!t && String(t).trim());
  if (validos.length < 2) return [];
  const conta = new Map<string, number>();
  for (const t of validos) for (const w of palavras(t)) conta.set(w, (conta.get(w) || 0) + 1);
  const minimo = Math.max(2, Math.ceil(validos.length / 2));
  return Array.from(conta.entries())
    .filter(([, n]) => n >= minimo)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([w]) => w);
}

const temAlgo = (p: PecaRecente) =>
  !!p && ((p.cores || []).some((c) => !!normalizarHex(c)) || !!(p.layout || p.cenario || p.pessoa || p.roupa || p.formato || p.luz));

function hexDaPaleta(p: OpcoesDoVariar["paleta"]): string[] {
  return (p || []).map((x) => normalizarHex(typeof x === "string" ? x : x && typeof x === "object" ? x.hex : null)).filter((x): x is string => !!x);
}

/**
 * O que mudar agora, pelas últimas peças do cliente (a mais recente primeiro).
 * Determinístico: a mesma lista dá o mesmo texto. Sem metadado, regras gerais.
 */
export function oQueVariarAgora(pecas: PecaRecente[] | null | undefined, opcoes: OpcoesDoVariar = {}): string {
  const lista = (pecas || []).filter(temAlgo).slice(0, opcoes.max ?? 16);
  const pedido = pedidoExplicitoDeCor(opcoes.pedido);
  const familiasDaMarca = new Set(hexDaPaleta(opcoes.paleta).map((h) => familiaDaCor(h)).filter((f): f is FamiliaDaCor => !!f && !f.neutra).map((f) => f.nome));
  const linhas: string[] = [];

  if (!lista.length) {
    linhas.push(...GENERICO);
  } else {
    const n = lista.length;
    // Cor: a família da cor dominante de cada peça.
    const dominantes = lista
      .map((p) => (p.cores || []).map((c) => normalizarHex(c)).find((c) => !!c) || null)
      .filter((c): c is string => !!c);
    let corRepetida: string | null = null;
    if (dominantes.length >= 2) {
      const fams = dominantes.map((h) => familiaDaCor(h)).filter((f): f is FamiliaDaCor => !!f);
      const top = maisFrequente(fams.filter((f) => !f.neutra).map((f) => f.nome));
      if (top && top.vezes >= 2 && top.vezes / dominantes.length >= 0.5) {
        corRepetida = top.valor;
        if (!pedido.fundo && !pedido.monocromatico) {
          const daMarca = familiasDaMarca.has(top.valor) ? " (a cor da marca)" : "";
          linhas.push(`- Cor: ${top.valor}${daMarca} dominou ${top.vezes} das últimas ${dominantes.length} peças. Agora, base neutra ou natural (off-white, areia, madeira, pedra, céu, ambiente real) ou outra cor de apoio do kit; ${top.valor} só como acento (texto em destaque, um elemento, a logo).`);
        }
      }
    }
    // Layout.
    const layouts = lista.map((p) => chave(p.layout)).filter(Boolean);
    const topLayout = maisFrequente(layouts);
    if (topLayout && topLayout.vezes >= 2 && topLayout.vezes / layouts.length >= 0.4) {
      const usados = new Set(layouts);
      const livres = (opcoes.familias || []).filter((f) => !usados.has(chave(f))).slice(0, 3);
      linhas.push(`- Layout: "${topLayout.valor}" se repetiu em ${topLayout.vezes} das últimas ${layouts.length} peças. Use outra estrutura agora${livres.length ? ` (por exemplo: ${livres.join("; ")})` : ""}.`);
    }
    // Cenário: palavras que voltam em metade das cenas.
    const cenarios = lista.map((p) => p.cenario || null);
    const repetidasNaCena = palavrasRepetidas(cenarios);
    if (repetidasNaCena.length) {
      linhas.push(`- Cenário: ${repetidasNaCena.join(", ")} voltaram em boa parte das últimas cenas. Escolha outro lugar, outra hora do dia e outra luz.`);
    } else {
      const ultima = cenarios.find((c) => !!c);
      if (ultima) linhas.push(`- Cenário: a última peça usou "${chave(ultima, 90)}". Não repita esse cenário agora.`);
    }
    // Pessoa.
    const pessoas = lista.map((p) => chave(p.pessoa, 60)).filter(Boolean);
    const topPessoa = maisFrequente(pessoas);
    if (topPessoa && topPessoa.vezes >= 2 && topPessoa.vezes / pessoas.length >= 0.5) {
      linhas.push(
        (opcoes.pessoasDisponiveis ?? 0) > 1
          ? `- Pessoa: "${topPessoa.valor}" apareceu em ${topPessoa.vezes} das últimas ${pessoas.length}. Use outra pessoa disponível agora, ou uma peça sem pessoa (produto ou ambiente como herói).`
          : `- Pessoa: "${topPessoa.valor}" apareceu em ${topPessoa.vezes} das últimas ${pessoas.length}. Se for a mesma pessoa, mude roupa, pose, cenário e enquadramento, ou faça uma peça sem pessoa.`,
      );
    }
    // Roupa: na cor da marca ou sempre a mesma.
    if (!pedido.roupa) {
      const roupas = lista.map((p) => p.roupa || null).filter((r): r is string => !!r);
      const corNaRoupa = Array.from(new Set([...familiasDaMarca, ...(corRepetida ? [corRepetida] : [])])).find((fam) => {
        const ditas = PALAVRAS_DA_FAMILIA[fam] || [fam];
        return roupas.filter((r) => ditas.some((w) => palavras(r).has(w) || sem(r).indexOf(w) >= 0)).length >= Math.max(1, Math.ceil(roupas.length / 3));
      });
      const repetidasNaRoupa = palavrasRepetidas(roupas, 3);
      if (corNaRoupa) linhas.push(`- Roupa: as últimas peças vestiram a pessoa de ${corNaRoupa}${familiasDaMarca.has(corNaRoupa) ? ", a cor da marca" : ", a cor que mais se repetiu"}. Agora roupa em tons naturais e diferente das anteriores.`);
      else if (repetidasNaRoupa.length) linhas.push(`- Roupa: ${repetidasNaRoupa.join(", ")} se repetiu. Troque o figurino agora.`);
    }
    // Formato.
    const formatos = lista.map((p) => chave(p.formato, 30)).filter(Boolean);
    const topFormato = maisFrequente(formatos);
    if (topFormato && formatos.length >= 3 && topFormato.vezes / formatos.length >= 0.7) {
      linhas.push(`- Formato: ${topFormato.vezes} das últimas ${formatos.length} foram ${topFormato.valor}. Se o pedido permitir, varie o formato ou a estrutura da peça.`);
    }
    // Luz.
    const luzes = lista.map((p) => chave(p.luz, 40)).filter(Boolean);
    const topLuz = maisFrequente(luzes);
    if (topLuz && topLuz.vezes >= 2 && topLuz.vezes / luzes.length >= 0.5) {
      linhas.push(`- Luz: "${topLuz.valor}" se repetiu. Mude a hora, a direção ou a temperatura da luz.`);
    }
    if (!linhas.length) linhas.push("- O histórico recente já está variado: continue variando (layout, cenário, luz e enquadramento diferentes da última peça).");
    linhas.unshift(`${TITULO_DO_VARIAR_AGORA} (lido das últimas ${n} peças deste cliente; a marca continua reconhecível pela logo, pela tipografia e pelo acento)`);
  }
  if (!lista.length) linhas.unshift(`${TITULO_DO_VARIAR_AGORA} (sem histórico lido deste cliente)`);
  if (pedido.roupa) linhas.push("- O pedido define a roupa ou o uniforme: siga o pedido nisso e equilibre o resto (fundo e cenário neutros ou naturais).");
  if (pedido.fundo || pedido.monocromatico) linhas.push("- O pedido define o fundo ou a peça na cor da marca: siga o pedido; pele, roupa e objetos ficam com cores naturais para não virar uma mancha só.");

  const teto = opcoes.teto ?? 1200;
  let texto = linhas.join("\n");
  while (texto.length > teto && linhas.length > 2) {
    linhas.splice(linhas.length - 2, 1);
    texto = linhas.join("\n");
  }
  return texto.slice(0, teto);
}
