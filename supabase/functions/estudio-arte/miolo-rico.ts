/**
 * Miolo rico e variado, feito pelo gerador (frente R4, 26/09/2026).
 *
 * Pedido do dono: "Os outros cards são muito simples; não pode ficar simples.
 * Legal ter uma caixa dentro às vezes, ou algo ligado a algo, mais bonitinho.
 * Melhorar, mas NÃO com camada: sempre no gerador de imagem, com inteligência,
 * para não repetir a mesma coisa e não ficar genérico."
 *
 * Nada é colado por código: o prompt descreve um COMPONENTE DE LÂMINA para o
 * gerador desenhar junto com a arte (cartão com borda e sombra suave, caixas
 * ligadas por conectores, passos numa linha do tempo, colunas de comparação,
 * checklist, número em cartão, balão de pergunta, citação, chips, mini-gráfico,
 * caixa de dica, ícones de linha).
 *
 * A escolha é determinística, em código, sem custo: pelo TIPO do conteúdo da
 * lâmina (lista, comparação, passos, número, pergunta, citação, dica ou
 * afirmação) e com rotação na série: o plano é feito sobre todas as lâminas da
 * direção, na ordem, e nenhuma lâmina repete o componente da anterior; na
 * série, um componente só volta quando os que servem ao tipo acabaram. Refazer
 * a lâmina troca o componente (a versão guarda miolo_desenhado), sem cair no
 * das vizinhas. Cena fixa (foto real ou fundo contínuo): a versão leve, só
 * gráfica, sem caixa atrás do texto. Sempre dentro da identidade (paleta com
 * função, tipografia, margens, trava da marca) e com pouco texto: só o texto
 * exato. Capa, fechamento e post único: nada. Sem travessão.
 */

import type { BlocoTexto, ZonaTexto } from "../_shared/direcao-arte.ts";
import { blocosDoTexto } from "../_shared/direcao-arte.ts";

export type TipoDeConteudo = "lista" | "comparacao" | "passos" | "numero" | "pergunta" | "citacao" | "dica" | "afirmacao";

export type ComponenteDoMiolo =
  | "checklist"
  | "cartoes_empilhados"
  | "chips"
  | "icones_de_linha"
  | "colunas_comparacao"
  | "cartoes_lado_a_lado"
  | "linha_do_tempo"
  | "caixas_conectadas"
  | "numero_em_cartao"
  | "mini_grafico"
  | "balao_pergunta"
  | "citacao_destaque"
  | "caixa_de_dica"
  | "cartao_destaque";

type DefDoComponente = { nome: string; desenho: string; leve: string };

/** O que o gerador desenha (desenho) e a versão só gráfica para a cena fixa (leve). */
export const COMPONENTES: Record<ComponenteDoMiolo, DefDoComponente> = {
  checklist: {
    nome: "checklist",
    desenho: "checklist: lista curta de 2 ou 3 itens, um por linha, cada item com um ícone de check de linha num círculo da cor de destaque, dentro de um cartão com borda fina e sombra suave",
    leve: "lista curta de 2 ou 3 itens, um por linha, cada um com um check de linha na cor de destaque",
  },
  cartoes_empilhados: {
    nome: "cartões empilhados",
    desenho: "cartões empilhados: um cartão por item (2 ou 3), com borda fina, os cantos da série e sombra suave, e um ícone de linha à esquerda de cada um, ligado ao sentido do item",
    leve: "um fio curto e um ícone de linha antes de cada item (2 ou 3), um por linha",
  },
  chips: {
    nome: "chips",
    desenho: "chips: as palavras-chave do texto em etiquetas arredondadas lado a lado, com contorno fino (a mais importante preenchida com a cor de destaque), e o apoio curto embaixo delas",
    leve: "as palavras-chave do texto separadas por marcadores redondos pequenos na cor de destaque",
  },
  icones_de_linha: {
    nome: "ícones de linha",
    desenho: "ícones de linha: cada ideia do texto com um ícone de linha simples ao lado (desenhado no traço da série, ligado ao sentido da ideia, nunca de banco de imagens), alinhados numa grade limpa",
    leve: "cada ideia do texto com um ícone de linha simples ao lado, no traço da série",
  },
  colunas_comparacao: {
    nome: "colunas de comparação",
    desenho: "duas colunas de comparação lado a lado (antes e depois, errado e certo), separadas por um divisor no traço da série, com um ícone de xis numa e um de check na outra; a coluna certa ganha a cor de destaque",
    leve: "duas metades separadas por um fio vertical, com um ícone de xis de linha numa e um de check na outra",
  },
  cartoes_lado_a_lado: {
    nome: "cartões lado a lado",
    desenho: "dois cartões lado a lado, um apagado (neutro, com um ícone de xis) e um em destaque (borda na cor de destaque, com um ícone de check), ligados por uma seta fina",
    leve: "duas partes do texto ligadas por uma seta fina de linha, com um ícone de xis e um de check",
  },
  linha_do_tempo: {
    nome: "linha do tempo",
    desenho: "passos numerados numa linha do tempo: círculos com o número do passo ligados por uma linha contínua, e o texto curto de cada passo ao lado do seu círculo",
    leve: "passos numerados ligados por um fio contínuo, números em círculos de linha",
  },
  caixas_conectadas: {
    nome: "caixas conectadas",
    desenho: "2 ou 3 caixas ligadas por conectores ou setas finas, uma parte do texto em cada, mostrando como uma ideia leva à outra; a caixa final ganha a cor de destaque",
    leve: "2 ou 3 partes do texto ligadas por setas finas de linha",
  },
  numero_em_cartao: {
    nome: "número em cartão",
    desenho: "o número como protagonista, grande, na cor de destaque, dentro de um cartão com borda fina e sombra suave, com o apoio curto logo embaixo dele",
    leve: "o número como protagonista, grande, com um fio curto e o apoio colado nele",
  },
  mini_grafico: {
    nome: "mini-gráfico",
    desenho: "mini-gráfico simples (uma barra ou uma rosca) que mostra só o número do texto, sem eixos, escala, legenda nem outro número, com o número grande ao lado e o apoio curto embaixo",
    leve: "um arco ou uma barra fina de linha mostrando o número do texto, sem eixos nem legenda",
  },
  balao_pergunta: {
    nome: "balão de pergunta",
    desenho: "a pergunta grande dentro de um balão de fala com borda fina e sombra suave, e a resposta curta fora dele, em destaque",
    leve: "a pergunta grande com um traço de balão de linha em volta, e a resposta curta embaixo",
  },
  citacao_destaque: {
    nome: "citação em destaque",
    desenho: "citação em destaque: aspas gráficas grandes na cor de destaque, o texto em peso médio e um fio vertical ao lado",
    leve: "aspas gráficas grandes na cor de destaque e um fio vertical ao lado do texto",
  },
  caixa_de_dica: {
    nome: "caixa de dica",
    desenho: "caixa de destaque da dica: um cartão com borda na cor de destaque, um ícone de linha (lâmpada ou alerta) no canto e o texto dentro",
    leve: "um ícone de linha (lâmpada ou alerta) e um fio na cor de destaque ao lado do texto",
  },
  cartao_destaque: {
    nome: "cartão em destaque",
    desenho: "a ideia dentro de um cartão com borda fina e sombra suave, a palavra-chave em destaque e um ícone de linha ligado ao tema num canto do cartão",
    leve: "a palavra-chave sublinhada por um fio na cor de destaque e um ícone de linha ligado ao tema",
  },
};

/** Componentes que servem a cada tipo de conteúdo, do mais certo para o menos. */
export const PREFERENCIAS: Record<TipoDeConteudo, ComponenteDoMiolo[]> = {
  lista: ["checklist", "cartoes_empilhados", "chips", "icones_de_linha"],
  comparacao: ["colunas_comparacao", "cartoes_lado_a_lado"],
  passos: ["linha_do_tempo", "caixas_conectadas"],
  numero: ["numero_em_cartao", "mini_grafico"],
  pergunta: ["balao_pergunta", "cartao_destaque"],
  citacao: ["citacao_destaque", "cartao_destaque"],
  dica: ["caixa_de_dica", "cartao_destaque"],
  afirmacao: ["cartao_destaque", "caixas_conectadas", "icones_de_linha", "chips"],
};

/** Quando os do tipo acabaram na série: componentes que servem a qualquer texto curto. */
export const GERAIS: ComponenteDoMiolo[] = ["cartao_destaque", "caixas_conectadas", "icones_de_linha", "caixa_de_dica", "chips"];

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Tipo do conteúdo pelo texto da lâmina, em código: comparação, passos, lista,
 * número, pergunta, citação, dica; senão afirmação.
 */
export function tipoDoConteudo(blocos: BlocoTexto[]): TipoDeConteudo {
  const texto = blocos.map((b) => b.texto).join("\n");
  const t = semAcento(texto);
  const tem = (re: RegExp) => re.test(t);
  if (tem(/\bvs\.?(\s|$)|\bversus\b/) || (tem(/\bantes\b/) && tem(/\bdepois\b/)) || (tem(/\berrad[oa]s?\b/) && tem(/\bcert[oa]s?\b/)) || (tem(/\bmitos?\b/) && tem(/\bverdades?\b/))) return "comparacao";
  if (tem(/\b(passo|passos|etapa|etapas|primeiro|em seguida|por fim|depois disso)\b/) || /(^|\n)\s*\d{1,2}\s*[.)º°]\s/.test(texto)) return "passos";
  const linhas = texto.split("\n").map((l) => l.trim()).filter(Boolean);
  if ((texto.match(/[,;]/g) || []).length >= 2 || texto.indexOf(";") >= 0 || linhas.length > 2 || /(^|\n)\s*[•*-]\s/.test(texto)) return "lista";
  if (blocos.some((b) => b.papel === "numero") || /\d/.test(texto)) return "numero";
  if (texto.indexOf("?") >= 0) return "pergunta";
  if (/["“”]/.test(texto) || tem(/\b(disse|depoimento)\b/)) return "citacao";
  if (tem(/\b(dica|atencao|cuidado|importante|lembre|evite|nunca|sempre|segredo|alerta)\b/)) return "dica";
  return "afirmacao";
}

export type EscolhaDoMiolo = { ordem: number; tipo: TipoDeConteudo; componente: ComponenteDoMiolo };

const unicos = <T>(l: T[]): T[] => l.filter((x, i) => l.indexOf(x) === i);
const opcoesDoTipo = (tipo: TipoDeConteudo) => unicos(PREFERENCIAS[tipo].concat(GERAIS));

type LaminaDoPlano = { ordem: number; funcao?: string | null; texto_exato?: string | null; blocos?: BlocoTexto[] | null };

/** A lâmina é de conteúdo desenhado: da 2 à penúltima, em carrossel de 3 ou mais. */
export const ehMioloDesenhado = (ordem: number, total: number) => total >= 3 && ordem >= 2 && ordem < total;

/**
 * Plano do miolo da série inteira, na ordem das lâminas: para cada lâmina de
 * conteúdo, o primeiro componente do tipo dela que não é o da lâmina anterior
 * e ainda não apareceu na série; acabando os do tipo, os gerais; acabando
 * tudo, qualquer um diferente do anterior. Determinístico (sem IA, sem custo).
 */
export function planoDoMiolo(cards: LaminaDoPlano[] | null | undefined): EscolhaDoMiolo[] {
  const lista = (cards || []).filter((c) => c && Number.isFinite(Number(c.ordem))).slice().sort((a, b) => Number(a.ordem) - Number(b.ordem));
  const total = lista.length;
  const saida: EscolhaDoMiolo[] = [];
  const usados: ComponenteDoMiolo[] = [];
  let anterior: ComponenteDoMiolo | null = null;
  for (const c of lista) {
    const ordem = Number(c.ordem);
    if (!ehMioloDesenhado(ordem, total)) continue;
    const blocos = c.blocos && c.blocos.length ? c.blocos : blocosDoTexto(String(c.texto_exato || ""), String(c.funcao || "conteudo"));
    const tipo = tipoDoConteudo(blocos);
    const opcoes = opcoesDoTipo(tipo);
    const componente = opcoes.filter((x) => x !== anterior && usados.indexOf(x) < 0)[0] || opcoes.filter((x) => x !== anterior)[0] || opcoes[0];
    usados.push(componente);
    anterior = componente;
    saida.push({ ordem, tipo, componente });
  }
  return saida;
}

const NOMES = Object.keys(COMPONENTES) as ComponenteDoMiolo[];

/** Componente gravado numa versão (miolo_desenhado.componente), lido com cuidado. */
export function componenteGravado(v: unknown): ComponenteDoMiolo | null {
  const m = v && typeof v === "object" ? (v as Record<string, unknown>).miolo_desenhado : null;
  const c = m && typeof m === "object" ? (m as Record<string, unknown>).componente : null;
  return NOMES.indexOf(c as ComponenteDoMiolo) >= 0 ? c as ComponenteDoMiolo : null;
}

/**
 * O componente desta lâmina: o do plano; refazendo (versões anteriores com
 * componente gravado), o próximo do tipo que ainda não foi usado nesta lâmina
 * e não é o das vizinhas. Fora do miolo: null.
 */
export function componenteDaLamina(e: { cards: LaminaDoPlano[] | null | undefined; ordem: number; anterioresDestaLamina?: (ComponenteDoMiolo | null)[] }): EscolhaDoMiolo | null {
  const plano = planoDoMiolo(e.cards);
  const aqui = plano.filter((p) => p.ordem === e.ordem)[0];
  if (!aqui) return null;
  const antes = (e.anterioresDestaLamina || []).filter(Boolean) as ComponenteDoMiolo[];
  if (!antes.length) return aqui;
  const vizinhos = plano.filter((p) => p.ordem === e.ordem - 1 || p.ordem === e.ordem + 1).map((p) => p.componente);
  const opcoes = opcoesDoTipo(aqui.tipo);
  const nova = opcoes.filter((x) => antes.indexOf(x) < 0 && vizinhos.indexOf(x) < 0)[0] || opcoes.filter((x) => antes.indexOf(x) < 0)[0] || aqui.componente;
  return { ...aqui, componente: nova };
}

/** Onde o título e o componente ficam, pela zona do texto da direção (sem brigar com a composição). */
export function arranjoDaZona(zona: ZonaTexto | null | undefined): string {
  switch (zona) {
    case "topo-esquerda":
    case "topo-centro":
      return "título no topo e o componente logo abaixo dele, na faixa do meio";
    case "coluna-esquerda":
    case "centro-esquerda":
      return "título no alto da coluna da esquerda e o componente embaixo dele, na mesma coluna; a imagem do lado oposto";
    case "coluna-direita":
    case "base-direita":
      return "título no alto da coluna da direita e o componente embaixo dele, na mesma coluna; a imagem do lado oposto";
    case "base-esquerda":
    case "base-centro":
      return "componente na metade de baixo, com o título logo acima dele; a imagem no alto";
    case "centro":
      return "componente grande no centro, com o título curto logo acima dele";
    default:
      return "título curto acima do componente, os dois na área do texto";
  }
}

/** Escolha sem plano (sem a direção inteira): o primeiro componente do tipo. */
export function escolhaSolta(ordem: number, blocos: BlocoTexto[]): EscolhaDoMiolo {
  const tipo = tipoDoConteudo(blocos);
  return { ordem, tipo, componente: PREFERENCIAS[tipo][0] };
}

/**
 * O bloco da lâmina de conteúdo desenhada: o componente (ou a versão leve na
 * cena fixa), o arranjo pela zona do texto, a identidade da série e a regra de
 * pouco texto. Capa, fechamento e post único: vazio.
 */
export function blocoDoMiolo(e: { ordem: number; total: number; escolha: EscolhaDoMiolo; cenaFixa?: boolean; zona?: ZonaTexto | null }): string {
  if (!ehMioloDesenhado(e.ordem, e.total)) return "";
  const def = COMPONENTES[e.escolha.componente] || COMPONENTES.cartao_destaque;
  return [
    `LÂMINA DE CONTEÚDO DESENHADA (lâmina ${e.ordem} de ${e.total}): não é um parágrafo solto; o conteúdo vira um componente desenhado pela própria arte, dentro da identidade da série.`,
    e.cenaFixa
      ? `- A cena já está decidida: o recurso é só gráfico e leve, por cima da área calma, no traço da capa, sem caixa nem painel atrás do texto: ${def.leve}.`
      : `- Componente desta lâmina: ${def.desenho}.`,
    e.cenaFixa ? "" : `- Arranjo: ${arranjoDaZona(e.zona)}; o componente ocupa a área do texto indicada acima e pode crescer para o espaço calmo vizinho, sem cobrir o assunto da imagem. Os cartões, conectores e ícones dele fazem parte do layout desta lâmina.`,
    "- Identidade: só as cores da paleta, cada uma na sua função (a superfície dos cartões num tom da paleta que contrasta com o fundo; bordas, conectores e ícones no traço fino da série; a cor de destaque só no número, no ícone principal ou na palavra-chave), a mesma tipografia e as mesmas margens; sombra curta e suave, sem 3D, brilho nem gradiente.",
    "- Pouco texto: só o texto exato, dividido entre as partes do componente; nenhuma palavra, rótulo, número ou legenda a mais (onde faltar rótulo, use ícone de linha). Uma ideia só; nada de bloco corrido.",
  ].filter(Boolean).join("\n");
}
