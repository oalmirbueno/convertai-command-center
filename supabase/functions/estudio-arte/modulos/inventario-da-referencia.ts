/**
 * Inventário da referência e preenchimento completo (22/10/2026).
 *
 * Pedido do dono: "nas referências, quando eu mando a de imagens, tem que ler
 * e complementar espaços, tipo balões que têm conteúdo na referência; ele
 * copia idêntico e não coloca nada, completar deixa vazio, isso é ruim".
 *
 * Causa (lida no código):
 * - O molde (direcao-arte.ts, mapearNoMolde) só mapeia os blocos de texto da
 *   lâmina (headline, apoio, CTA, selo) nos blocos da referência; os que
 *   sobram ficam "vagos" e o prompt manda deixá-los "sem texto nenhum; o
 *   espaço continua vazio". Balão, caixa, lista, seta com rótulo e preço da
 *   referência são vagos quase sempre: saíam vazios, ou, editando a imagem da
 *   referência, com o texto dela (a cópia).
 * - Na arte rápida, a imagem em "Referência" (R1...) não era lida: só o
 *   diretor olhava ("inspire, nunca copie") e o gerador recebia o TEXTO EXATO
 *   da lâmina com "nenhuma outra palavra", então o balão desenhado ficava vazio.
 *
 * Agora (uma leitura e uma redação por lâmina, guardadas; sem laço):
 * 1. Inventário por visão, uma vez por conjunto de imagens: CADA elemento com
 *    texto ou conteúdo (tipo, posição, função, tamanho, itens e o texto
 *    original, que serve só para conferir a cópia).
 * 2. Preenchimento por lâmina: o redator escreve o texto NOVO de cada elemento
 *    a partir do conteúdo da lâmina e da pauta, com a mesma função e o mesmo
 *    tamanho; o código confere (nunca vazio, nunca o texto da referência,
 *    nenhum número fora do conteúdo) e o elemento que não fecha sai inteiro,
 *    sem deixar a forma vazia.
 * 3. O mapa "elemento -> texto" vai ao gerador (bloco próprio e texto exato) e
 *    à conferência, que acusa "elemento vazio" e "texto copiado da referência".
 *
 * Puro (sem Deno nem npm): o index.ts injeta a visão, o redator e o Storage.
 * Sem lookbehind, propriedade Unicode ou grupo nomeado em regex (Safari 11).
 */

// ------------------------------------------------------------------ tipos

export const VERSAO_DO_INVENTARIO = 1;
export const VERSAO_DO_PREENCHIMENTO = 1;
/** Imagens lidas no inventário (uma chamada de visão). */
export const MAX_IMAGENS_DO_INVENTARIO = 6;
export const MAX_ELEMENTOS_POR_IMAGEM = 12;
export const MAX_ELEMENTOS_DO_INVENTARIO = 30;

export const TIPOS_DE_ELEMENTO = [
  "titulo",
  "subtitulo",
  "balao",
  "caixa",
  "selo",
  "lista",
  "tabela",
  "preco",
  "cta",
  "icone_rotulo",
  "seta_rotulo",
  "rodape",
] as const;
export type TipoDeElemento = (typeof TIPOS_DE_ELEMENTO)[number];

/** Estes já recebem o texto da própria lâmina (headline, subtítulo e CTA do texto exato): não são preenchidos aqui. */
export const TIPOS_COM_TEXTO_DA_LAMINA: TipoDeElemento[] = ["titulo", "subtitulo", "cta"];

export const FUNCOES_DO_ELEMENTO = [
  "gancho",
  "pergunta",
  "objecao",
  "resposta",
  "beneficio",
  "passo",
  "prova",
  "dado",
  "alerta",
  "comparacao",
  "chamada",
  "contexto",
  "outro",
] as const;
export type FuncaoDoElemento = (typeof FUNCOES_DO_ELEMENTO)[number];

export const TAMANHOS_DO_ELEMENTO = ["curto", "medio"] as const;
export type TamanhoDoElemento = (typeof TAMANHOS_DO_ELEMENTO)[number];

export const ROTULO_DO_ELEMENTO: Record<TipoDeElemento, string> = {
  titulo: "título",
  subtitulo: "subtítulo",
  balao: "balão de fala",
  caixa: "caixa de texto",
  selo: "selo",
  lista: "lista",
  tabela: "tabela",
  preco: "preço",
  cta: "chamada para ação",
  icone_rotulo: "ícone com rótulo",
  seta_rotulo: "seta com rótulo",
  rodape: "rodapé",
};

const ROTULO_DA_FUNCAO: Record<FuncaoDoElemento, string> = {
  gancho: "gancho",
  pergunta: "pergunta",
  objecao: "objeção",
  resposta: "resposta",
  beneficio: "benefício",
  passo: "passo",
  prova: "prova",
  dado: "dado",
  alerta: "alerta",
  comparacao: "comparação",
  chamada: "chamada",
  contexto: "contexto",
  outro: "apoio",
};

/** Palavras por tamanho (o redator mira o limite; o código corta o que passar de 1,5 vez). */
export const PALAVRAS_DO_TAMANHO: Record<TamanhoDoElemento, number> = { curto: 7, medio: 20 };

export interface ElementoDaReferencia {
  id: string;
  /** Qual imagem da referência (1 = a primeira lida). */
  imagem: number;
  tipo: TipoDeElemento;
  posicao: string;
  funcao: FuncaoDoElemento;
  tamanho: TamanhoDoElemento;
  /** Itens da lista ou linhas da tabela (0 nos outros tipos). */
  itens: number;
  /** O texto como está na referência: só para conferir a cópia, nunca para entrar na arte. */
  texto_original: string;
}

export interface InventarioDaReferencia {
  versao: number;
  imagens: number;
  elementos: ElementoDaReferencia[];
}

export type AcaoDoElemento = "preencher" | "remover";
export type MotivoDaRemocao = "sem_conteudo" | "vazio" | "copia" | "numero_inventado" | "sem_redator";

export interface ElementoPreenchido {
  id: string;
  tipo: TipoDeElemento;
  posicao: string;
  funcao: FuncaoDoElemento;
  tamanho: TamanhoDoElemento;
  itens: number;
  texto_original: string;
  acao: AcaoDoElemento;
  /** O texto novo (vazio quando o elemento sai). */
  texto: string;
  motivo?: MotivoDaRemocao;
  /** O texto novo já está no texto exato da lâmina (não entra duas vezes). */
  na_lamina?: boolean;
}

export interface PreenchimentoDaLamina {
  versao: number;
  ordem: number;
  /** Qual imagem da referência deu os elementos desta lâmina. */
  imagem: number;
  origem: "redator" | "sem_redator";
  elementos: ElementoPreenchido[];
}

// ------------------------------------------------------------------ texto

const limparLinha = (v: unknown, max: number) =>
  String(v == null ? "" : v)
    .replace(/\r\n?/g, "\n")
    .replace(/\s*[\u2014\u2013]\s*/g, ", ")
    .replace(/(^|\s)@[A-Za-z0-9._]{2,30}/g, "$1")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim()
    .slice(0, max);

/** Minúsculas, sem acento e sem pontuação: a régua das comparações. */
export function normalizarTexto(s: string): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const palavras = (s: string) => normalizarTexto(s).split(" ").filter(Boolean);
const contarPalavras = (s: string) => String(s || "").split(/\s+/).filter(Boolean).length;

/** Quanto das palavras de `parte` (3 letras ou mais) aparece em `todo` (0 a 1). */
export function cobertura(parte: string, todo: string): number {
  const p = palavras(parte).filter((w) => w.length >= 3 || /\d/.test(w));
  if (!p.length) return 0;
  const t = " " + palavras(todo).join(" ") + " ";
  return p.filter((w) => t.indexOf(" " + w + " ") >= 0).length / p.length;
}

/** O texto novo é o da referência (igual, contido nele ou com quase as mesmas palavras). */
export function copiaDaReferencia(novo: string, original: string): boolean {
  const a = normalizarTexto(novo);
  const b = normalizarTexto(original);
  if (!a || !b) return false;
  if (a === b) return true;
  if (b.length >= 10 && a.indexOf(b) >= 0) return true;
  if (a.length >= 10 && b.indexOf(a) >= 0) return true;
  const pa = palavras(novo);
  const pb = palavras(original);
  if (pa.length < 3 || pb.length < 3) return false;
  const sb = pb.filter((w, i) => pb.indexOf(w) === i);
  const sa = pa.filter((w, i) => pa.indexOf(w) === i);
  const comum = sa.filter((w) => sb.indexOf(w) >= 0).length;
  return comum / (sa.length + sb.length - comum) >= 0.6;
}

/** Números do texto novo que não estão na fonte (pedido, lâmina, conteúdo): inventados. */
export function numerosInventados(novo: string, fonte: string): string[] {
  // Só número solto (o "2" de "e2" ou de "4G" não conta como dado).
  const achar = (s: string) => (String(s || "").match(/\b\d+(?:[.,]\d+)*/g) || []).map((n) => n.replace(/[.,]/g, ""));
  const naFonte = achar(fonte);
  return achar(novo).filter((n, i, l) => l.indexOf(n) === i && naFonte.indexOf(n) < 0);
}

function cortarNoLimite(s: string, max: number): string {
  const linhas = s.split("\n");
  if (linhas.length > 1) return linhas.map((l) => cortarNoLimite(l, max)).join("\n");
  const ps = s.split(/\s+/).filter(Boolean);
  if (ps.length <= Math.ceil(max * 1.5)) return s;
  return ps.slice(0, max).join(" ").replace(/[,;:]+$/, "");
}

// ------------------------------------------------------------------ leitura (inventário)

export const ESQUEMA_INVENTARIO_DA_REFERENCIA = {
  nome: "inventario_da_referencia",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["elementos"],
    properties: {
      elementos: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["imagem", "tipo", "posicao", "funcao", "tamanho", "itens", "texto_original"],
          properties: {
            imagem: { type: "integer" },
            tipo: { type: "string", enum: [...TIPOS_DE_ELEMENTO] },
            posicao: { type: "string" },
            funcao: { type: "string", enum: [...FUNCOES_DO_ELEMENTO] },
            tamanho: { type: "string", enum: [...TAMANHOS_DO_ELEMENTO] },
            itens: { type: "integer" },
            texto_original: { type: "string" },
          },
        },
      },
    },
  },
};

export const INSTRUCOES_DO_INVENTARIO = `INVENTÁRIO DOS ELEMENTOS DE UMA REFERÊNCIA (Estúdio)
Você recebe imagens de referência de post ou anúncio (na ordem). Um estúdio vai refazer cada uma com OUTRO conteúdo, então precisa saber TODOS os lugares onde há texto ou conteúdo escrito, para escrever um texto novo em cada um e não deixar nenhum vazio.
Liste CADA elemento com texto ou conteúdo escrito, de cima para baixo, em todas as imagens:
- imagem: o número da imagem (1 = a primeira).
- tipo: titulo (a maior frase, lida primeiro), subtitulo, balao (balão de fala ou de pensamento, bolha de chat, comentário), caixa (cartão, bloco ou faixa com texto), selo (etiqueta, carimbo, destaque redondo), lista (itens, tópicos, checklist), tabela (linhas e colunas, comparação lado a lado), preco (valor, de/por, parcelas), cta (botão ou chamada para ação), icone_rotulo (ícone com uma palavra ou frase ao lado), seta_rotulo (seta ou linha apontando com um rótulo), rodape (texto pequeno de base, fonte, observação).
- posicao: onde fica, em palavras curtas (ex.: "no topo, à esquerda", "no meio, à direita, sobre a pessoa", "na base, de lado a lado").
- funcao: o papel do texto na peça: gancho, pergunta, objecao, resposta, beneficio, passo, prova (depoimento, resultado, número de clientes), dado, alerta, comparacao, chamada, contexto ou outro.
- tamanho: curto (até 7 palavras) ou medio (mais que isso).
- itens: quantos itens tem a lista ou quantas linhas tem a tabela; 0 nos outros tipos.
- texto_original: o texto como está, numa linha (lista e tabela: itens separados por " / ").
Cada balão, caixa, selo e rótulo é um elemento separado, mesmo quando se repetem. Elemento que existe mas está ilegível entra com texto_original vazio.
Ignore o @ do perfil, a marca d'água, a logo, o nome do autor, letras impressas em produtos e embalagens e textos da interface do Instagram.
Sem elemento com texto: elementos vazio. Português do Brasil, sem travessão.`;

const umDe = <T extends string>(v: unknown, lista: readonly T[], padrao: T): T => (lista.indexOf(v as T) >= 0 ? v as T : padrao);

/** O que a visão devolveu, limpo e com teto; null quando não há elemento nenhum. */
export function normalizarInventario(bruto: unknown, imagens: number): InventarioDaReferencia | null {
  const o = bruto && typeof bruto === "object" ? bruto as Record<string, unknown> : {};
  const total = Math.max(1, Math.min(MAX_IMAGENS_DO_INVENTARIO, Math.round(Number(imagens)) || 1));
  const lista = (Array.isArray(o.elementos) ? o.elementos : []).filter((x) => x && typeof x === "object") as Record<string, unknown>[];
  const porImagem: Record<number, number> = {};
  const elementos: ElementoDaReferencia[] = [];
  for (const x of lista) {
    if (TIPOS_DE_ELEMENTO.indexOf(x.tipo as TipoDeElemento) < 0) continue;
    const imagem = Math.max(1, Math.min(total, Math.round(Number(x.imagem)) || 1));
    porImagem[imagem] = (porImagem[imagem] || 0) + 1;
    if (porImagem[imagem] > MAX_ELEMENTOS_POR_IMAGEM) continue;
    const tipo = x.tipo as TipoDeElemento;
    const original = limparLinha(x.texto_original, 300).replace(/\n/g, " / ");
    const tamanhoLido = umDe(x.tamanho, TAMANHOS_DO_ELEMENTO, "curto");
    const itens = tipo === "lista" || tipo === "tabela" ? Math.max(2, Math.min(8, Math.round(Number(x.itens)) || original.split(" / ").length || 3)) : 0;
    elementos.push({
      id: "",
      imagem,
      tipo,
      posicao: limparLinha(x.posicao, 80).replace(/\n/g, " ") || "no lugar dele na referência",
      funcao: umDe(x.funcao, FUNCOES_DO_ELEMENTO, "outro"),
      // A contagem manda sobre o que a visão disse (texto longo nunca é "curto").
      tamanho: contarPalavras(original) > PALAVRAS_DO_TAMANHO.curto ? "medio" : tamanhoLido,
      itens,
      texto_original: original,
    });
    if (elementos.length >= MAX_ELEMENTOS_DO_INVENTARIO) break;
  }
  if (!elementos.length) return null;
  elementos.sort((a, b) => a.imagem - b.imagem);
  elementos.forEach((e, i) => (e.id = `e${i + 1}`));
  return { versao: VERSAO_DO_INVENTARIO, imagens: total, elementos };
}

/** O inventário gravado (direção ou cache), em forma fixa, ou null. */
export function inventarioGravado(v: unknown): InventarioDaReferencia | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (Number(o.versao) !== VERSAO_DO_INVENTARIO) return null;
  const inv = normalizarInventario(o, Number(o.imagens) || 1);
  return inv;
}

/** Qual imagem da referência serve à lâmina: uma por lâmina quando dá; senão a 1 na capa e as outras em roda no miolo. */
export function imagemDaLamina(imagens: number, ordem: number, total: number): number {
  const n = Math.max(1, Math.round(imagens) || 1);
  if (n >= total) return Math.max(1, Math.min(n, ordem));
  if (ordem <= 1 || n === 1) return 1;
  return 2 + ((ordem - 2) % (n - 1));
}

/** Os elementos que esta lâmina preenche (título, subtítulo e CTA ficam com o texto da própria lâmina). */
export function elementosDaLamina(inv: InventarioDaReferencia | null | undefined, ordem: number, total: number): { imagem: number; elementos: ElementoDaReferencia[] } {
  if (!inv || !inv.elementos.length) return { imagem: 1, elementos: [] };
  // Imagem sem nada a preencher (só título) não puxa elementos de outra.
  const imagem = imagemDaLamina(inv.imagens, ordem, total);
  return { imagem, elementos: inv.elementos.filter((e) => e.imagem === imagem && TIPOS_COM_TEXTO_DA_LAMINA.indexOf(e.tipo) < 0) };
}

/** O inventário para o diretor (vai em item.pedido_avulso.elementos_da_referencia): sem o texto original. */
export function inventarioParaODiretor(inv: InventarioDaReferencia) {
  return {
    regra: "Cada elemento da referência ganha o texto NOVO desta peça na geração (nunca o texto da referência, nunca vazio). Na cena e no layout, preveja estes elementos no lugar deles; o texto exato da lâmina continua só o título, o apoio e o CTA.",
    imagens: inv.imagens,
    elementos: inv.elementos.map((e) => ({ imagem: e.imagem, tipo: ROTULO_DO_ELEMENTO[e.tipo], posicao: e.posicao, funcao: ROTULO_DA_FUNCAO[e.funcao], tamanho: e.tamanho, ...(e.itens ? { itens: e.itens } : {}) })),
  };
}

// ------------------------------------------------------------------ redação (preenchimento)

export const ESQUEMA_PREENCHIMENTO_DA_REFERENCIA = {
  nome: "preenchimento_da_referencia",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["elementos"],
    properties: {
      elementos: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "acao", "texto"],
          properties: {
            id: { type: "string" },
            acao: { type: "string", enum: ["preencher", "remover"] },
            texto: { type: "string" },
          },
        },
      },
    },
  },
};

export const INSTRUCOES_DO_PREENCHIMENTO = `TEXTO DE CADA ELEMENTO DA REFERÊNCIA (Estúdio)
A lâmina vai ser desenhada no layout de uma referência. A referência tem balões, caixas, selos, listas, setas com rótulo, tabelas e preços com texto; cada um precisa de um texto NOVO, do conteúdo desta lâmina, para nenhum ficar vazio.
Para cada elemento de \`elementos\`, devolva { id, acao, texto }:
- preencher: o texto novo, com a MESMA função (pergunta continua pergunta, objeção continua objeção, passo continua passo) e o MESMO tamanho (curto: até 7 palavras; medio: até 20). Lista e tabela: um item por linha, na quantidade de \`itens\`.
- O texto vem de \`lamina.texto\` e de \`pauta\`, na voz da marca. Quando o conteúdo não diz tudo, escreva algo coerente com a pauta que não seja fato novo. Os elementos da mesma lâmina se completam (o balão de pergunta e o de resposta conversam) e não repetem o título.
- \`texto_da_referencia\` é só para entender a função e o tamanho: NUNCA repita, traduza nem parafraseie de perto o texto da referência.
- Nunca invente número, preço, porcentagem, prazo, data, nome, depoimento, avaliação nem resultado que não esteja em \`lamina.texto\` ou em \`pauta\`.
- remover: só quando o elemento não tem como ser preenchido sem inventar (preço ou prova que o conteúdo não tem). Ele sai inteiro da arte; texto vazio.
- \`ganchos_vencedores\`, quando vierem, são só inspiração de ritmo e estrutura para títulos e balões; nunca copie.
Português do Brasil, sem travessão, sem emoji, sem @, sem aspas em volta.`;

export function pedidoDoPreenchimento(e: {
  elementos: ElementoDaReferencia[];
  ordem: number;
  total: number;
  textoDaLamina: string;
  pauta: string;
  ganchos?: string[];
}): string {
  return JSON.stringify({
    lamina: { ordem: e.ordem, total: e.total, texto: String(e.textoDaLamina || "").slice(0, 1500) },
    pauta: String(e.pauta || "").slice(0, 2500),
    elementos: e.elementos.map((x) => ({
      id: x.id,
      tipo: ROTULO_DO_ELEMENTO[x.tipo],
      posicao: x.posicao,
      funcao: ROTULO_DA_FUNCAO[x.funcao],
      tamanho: x.tamanho,
      ...(x.itens ? { itens: x.itens } : {}),
      texto_da_referencia: x.texto_original,
    })),
    ...(e.ganchos && e.ganchos.length ? { ganchos_vencedores: e.ganchos.slice(0, 8) } : {}),
  });
}

const removido = (x: ElementoDaReferencia, motivo: MotivoDaRemocao): ElementoPreenchido => ({ ...semId(x), id: x.id, acao: "remover", texto: "", motivo });
const semId = (x: ElementoDaReferencia) => ({ tipo: x.tipo, posicao: x.posicao, funcao: x.funcao, tamanho: x.tamanho, itens: x.itens, texto_original: x.texto_original });

/**
 * Confere em código o que o redator devolveu: cada elemento sai preenchido
 * (texto novo, no tamanho) ou removido inteiro, nunca vazio. Remove o que
 * repete a referência e o que traz número que a fonte não tem. Elemento que
 * o redator esqueceu também sai (nunca fica a forma vazia).
 */
export function validarPreenchimento(
  elementos: ElementoDaReferencia[],
  bruto: unknown,
  e: { ordem: number; imagem: number; fonte: string; textoDaLamina: string; origem?: "redator" | "sem_redator" },
): PreenchimentoDaLamina {
  const o = bruto && typeof bruto === "object" ? bruto as Record<string, unknown> : {};
  const respostas = (Array.isArray(o.elementos) ? o.elementos : []).filter((x) => x && typeof x === "object") as Record<string, unknown>[];
  const fonte = `${e.fonte}\n${e.textoDaLamina}`;
  const lamina = normalizarTexto(e.textoDaLamina);
  const saida = elementos.map((x): ElementoPreenchido => {
    const r = respostas.find((y) => String(y.id) === x.id);
    if (!r) return removido(x, e.origem === "sem_redator" ? "sem_redator" : "sem_conteudo");
    if (r.acao === "remover") return removido(x, "sem_conteudo");
    let texto = limparLinha(r.texto, 400).replace(/^["'\u201c\u201d]+|["'\u201c\u201d]+$/g, "").trim();
    if (!(x.tipo === "lista" || x.tipo === "tabela")) texto = texto.replace(/\n+/g, " ");
    texto = cortarNoLimite(texto, PALAVRAS_DO_TAMANHO[x.tamanho]);
    if (!normalizarTexto(texto)) return removido(x, "vazio");
    const naLamina = normalizarTexto(texto).length >= 3 && (" " + lamina + " ").indexOf(" " + normalizarTexto(texto) + " ") >= 0;
    // O texto da própria lâmina pode coincidir com o da referência (conteúdo "Idêntico"): ali vale.
    if (!naLamina && copiaDaReferencia(texto, x.texto_original)) return removido(x, "copia");
    if (numerosInventados(texto, fonte).length) return removido(x, "numero_inventado");
    return { ...semId(x), id: x.id, acao: "preencher", texto, ...(naLamina ? { na_lamina: true } : {}) };
  });
  return { versao: VERSAO_DO_PREENCHIMENTO, ordem: e.ordem, imagem: e.imagem, origem: e.origem || "redator", elementos: saida };
}

/** O preenchimento gravado na versão (para a conferência e o ajuste), ou null. */
export function preenchimentoGravado(v: unknown): PreenchimentoDaLamina | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (Number(o.versao) !== VERSAO_DO_PREENCHIMENTO || !Array.isArray(o.elementos)) return null;
  const elementos = (o.elementos as Record<string, unknown>[])
    .filter((x) => x && typeof x === "object" && TIPOS_DE_ELEMENTO.indexOf(x.tipo as TipoDeElemento) >= 0)
    .map((x): ElementoPreenchido => ({
      id: String(x.id || ""),
      tipo: x.tipo as TipoDeElemento,
      posicao: limparLinha(x.posicao, 80),
      funcao: umDe(x.funcao, FUNCOES_DO_ELEMENTO, "outro"),
      tamanho: umDe(x.tamanho, TAMANHOS_DO_ELEMENTO, "curto"),
      itens: Math.max(0, Math.round(Number(x.itens)) || 0),
      texto_original: limparLinha(x.texto_original, 300),
      acao: x.acao === "preencher" && limparLinha(x.texto, 400) ? "preencher" : "remover",
      texto: x.acao === "preencher" ? limparLinha(x.texto, 400) : "",
      ...(typeof x.motivo === "string" ? { motivo: x.motivo as MotivoDaRemocao } : {}),
      ...(x.na_lamina === true ? { na_lamina: true } : {}),
    }));
  if (!elementos.length) return null;
  return { versao: VERSAO_DO_PREENCHIMENTO, ordem: Number(o.ordem) || 1, imagem: Number(o.imagem) || 1, origem: o.origem === "sem_redator" ? "sem_redator" : "redator", elementos };
}

// ------------------------------------------------------------------ gerador

const comBarra = (s: string) => s.replace(/\n/g, " / ");

/**
 * Bloco do gerador: cada elemento com o texto certo, os removidos saindo
 * inteiros e a regra de nunca vazio e nunca o texto da referência. Vazio
 * quando a lâmina não tem elemento.
 */
export function blocoDoPreenchimento(p: PreenchimentoDaLamina | null | undefined): string {
  if (!p || !p.elementos.length) return "";
  const preenche = p.elementos.filter((x) => x.acao === "preencher");
  const saem = p.elementos.filter((x) => x.acao === "remover");
  const linhas = [
    "ELEMENTOS DA REFERÊNCIA COM TEXTO (o mapa desta lâmina; vale sobre qualquer linha acima que mande deixar um bloco da referência sem texto)",
    ...preenche.map((x) => `- ${ROTULO_DO_ELEMENTO[x.tipo]} ${x.posicao} (${ROTULO_DA_FUNCAO[x.funcao]}${x.itens ? `, ${x.itens} itens, um por linha` : ""}): "${comBarra(x.texto)}".`),
    saem.length
      ? `- Saem por inteiro, forma e texto, sem deixar o espaço vazio (o fundo, o assunto ou o respiro do layout ocupam o lugar): ${saem.map((x) => `${ROTULO_DO_ELEMENTO[x.tipo]} ${x.posicao}`).join("; ")}.`
      : "",
    preenche.some((x) => x.texto.indexOf("\n") >= 0) ? "- A barra ( / ) nos itens marca a quebra de linha: quebre ali e não desenhe a barra." : "",
    "- Nenhum balão, caixa, selo, lista, seta, tabela ou rótulo fica vazio, e nenhum leva o texto da referência: as palavras escritas na referência nunca entram na arte.",
    "- Cada texto cabe inteiro dentro do seu elemento, legível, na fonte e nas cores da marca, com a mesma hierarquia que o elemento tem na referência.",
  ];
  return linhas.filter(Boolean).join("\n");
}

/** Os textos novos que entram no texto exato (sem repetir o que a lâmina já tem). */
export function textosDosElementos(p: PreenchimentoDaLamina | null | undefined): string[] {
  if (!p) return [];
  return p.elementos.filter((x) => x.acao === "preencher" && !x.na_lamina && x.texto).map((x) => x.texto);
}

/** Texto exato da lâmina com os textos dos elementos (regras finais, conferência e autocorreção). */
export function comTextoDosElementos(textoExato: string, p: PreenchimentoDaLamina | null | undefined): string {
  const extra = textosDosElementos(p);
  return extra.length ? [String(textoExato || "").trim(), ...extra].filter(Boolean).join("\n") : textoExato;
}

/** Linha do molde que manda deixar os blocos vagos da referência sem texto (promptDoReplicar). */
export const INICIO_DA_LINHA_DOS_VAGOS = "- Blocos de texto da referência sem texto nesta lâmina (";

/** Tira do prompt do replicar a linha "ficam sem texto nenhum": com o mapa, nenhum bloco da referência fica vazio. */
export function semLinhaDosVagos(prompt: string, p: PreenchimentoDaLamina | null | undefined): string {
  if (!p || !p.elementos.length) return prompt;
  return prompt.split("\n").filter((l) => l.indexOf(INICIO_DA_LINHA_DOS_VAGOS) !== 0).join("\n");
}

// ------------------------------------------------------------------ conferência

export type ElementoVazio = { id: string; tipo: TipoDeElemento; rotulo: string; posicao: string; texto: string };
export type TextoCopiado = { id: string; tipo: TipoDeElemento; rotulo: string; posicao: string; texto_original: string; substituir: string | null };

/**
 * Confere a arte gerada (o texto lido por visão) contra o mapa: o elemento
 * preenchido cujo texto não aparece é "elemento vazio"; o texto da referência
 * que aparece (e não é o esperado) é "texto copiado da referência".
 */
export function conferirElementos(
  p: PreenchimentoDaLamina | null | undefined,
  textoLido: string | null | undefined,
  textoEsperado = "",
): { vazios: ElementoVazio[]; copiados: TextoCopiado[] } {
  const lido = String(textoLido || "");
  if (!p || !p.elementos.length || !normalizarTexto(lido)) return { vazios: [], copiados: [] };
  const esperado = `${textoEsperado}\n${p.elementos.filter((x) => x.acao === "preencher").map((x) => x.texto).join("\n")}`;
  // O que distingue o elemento: as palavras dele que a lâmina não tem (senão o título "cobre" o balão vazio).
  const daLamina = " " + palavras(textoEsperado).join(" ") + " ";
  const proprias = (t: string) => {
    const so = palavras(t).filter((w) => (w.length >= 3 || /\d/.test(w)) && daLamina.indexOf(" " + w + " ") < 0);
    return so.length ? so.join(" ") : t;
  };
  const vazios = p.elementos
    .filter((x) => x.acao === "preencher" && !x.na_lamina && palavras(x.texto).some((w) => w.length >= 3) && cobertura(proprias(x.texto), lido) < 0.6)
    .map((x) => ({ id: x.id, tipo: x.tipo, rotulo: ROTULO_DO_ELEMENTO[x.tipo], posicao: x.posicao, texto: x.texto }));
  const copiados = p.elementos
    .filter((x) => normalizarTexto(x.texto_original).length >= 8 && palavras(x.texto_original).length >= 2)
    .filter((x) => cobertura(x.texto_original, lido) >= 0.8 && cobertura(x.texto_original, esperado) < 0.8)
    .map((x) => ({ id: x.id, tipo: x.tipo, rotulo: ROTULO_DO_ELEMENTO[x.tipo], posicao: x.posicao, texto_original: x.texto_original, substituir: x.acao === "preencher" ? x.texto : null }));
  return { vazios, copiados };
}

// ------------------------------------------------------------------ ganchos vencedores (tolerante)

/** Ganchos da tabela ganchos_vencedores (quando existe), limpos e sem repetição: só inspiração. */
export function ganchosParaInspiracao(linhas: unknown, max = 8): string[] {
  const saida: string[] = [];
  for (const l of Array.isArray(linhas) ? linhas : []) {
    if (!l || typeof l !== "object") continue;
    const o = l as Record<string, unknown>;
    const bruto = [o.gancho, o.texto, o.titulo, o.frase, o.hook].find((v) => typeof v === "string" && v.trim());
    const t = limparLinha(bruto, 140).replace(/\n/g, " ");
    if (t && saida.every((s) => normalizarTexto(s) !== normalizarTexto(t))) saida.push(t);
    if (saida.length >= max) break;
  }
  return saida;
}

// ------------------------------------------------------------------ orquestração (dependências injetadas)

/** Hash curto e estável (FNV-1a, 2 sementes), para o nome do arquivo guardado. */
export function chaveCurta(s: string): string {
  const h = (semente: number) => {
    let x = semente >>> 0;
    for (let i = 0; i < s.length; i++) {
      x ^= s.charCodeAt(i);
      x = Math.imul(x, 16777619) >>> 0;
    }
    return x.toString(16);
  };
  return `${h(2166136261)}${h(84696351)}`;
}

export type DepsDaReferencia = {
  pasta: string;
  lerGuardado: (caminho: string) => Promise<Record<string, unknown> | null>;
  guardar: (caminho: string, valor: unknown) => Promise<void>;
  /** Saldo, cota e chave sobem (o gerador cairia no mesmo erro). */
  sobe?: (e: unknown) => boolean;
};

/**
 * Inventário de um conjunto de imagens (uma chamada de visão), guardado pela
 * `chave` (caminhos das imagens ou id da referência). `abrir`: as imagens só
 * são baixadas quando não há leitura guardada. Falha: null com o motivo.
 */
export async function inventarioDasImagens<I>(
  chave: string,
  imagens: I[],
  deps: DepsDaReferencia & { ler: (sistema: string, pedido: string, imagens: I[]) => Promise<{ json: unknown; custoUsd: number }> },
  abrir?: () => Promise<I[]>,
): Promise<{ inventario: InventarioDaReferencia | null; custoUsd: number; erro?: string }> {
  if (!chave) return { inventario: null, custoUsd: 0 };
  const caminho = `${deps.pasta}/inventario-${chaveCurta(chave)}.json`;
  const guardado = await deps.lerGuardado(caminho).catch(() => null);
  if (guardado && Number(guardado.versao) === VERSAO_DO_INVENTARIO) {
    const inv = inventarioGravado(guardado.inventario);
    // Guardado vazio (a referência não tem elemento): não lê de novo.
    if (inv || guardado.vazio === true) return { inventario: inv, custoUsd: 0 };
  }
  const lista = (abrir ? await abrir() : imagens).slice(0, MAX_IMAGENS_DO_INVENTARIO);
  if (!lista.length) return { inventario: null, custoUsd: 0, ...(abrir ? { erro: "as imagens da referência não abriram" } : {}) };
  try {
    const r = await deps.ler(INSTRUCOES_DO_INVENTARIO, `Liste os elementos com texto ${lista.length === 1 ? "da imagem anexada" : `das ${lista.length} imagens anexadas, na ordem`}.`, lista);
    const inv = normalizarInventario(r.json, lista.length);
    await deps.guardar(caminho, { versao: VERSAO_DO_INVENTARIO, lido_em: new Date().toISOString(), inventario: inv, vazio: !inv }).catch(() => {});
    return { inventario: inv, custoUsd: Number(r.custoUsd) || 0 };
  } catch (e) {
    if (deps.sobe && deps.sobe(e)) throw e;
    return { inventario: null, custoUsd: 0, erro: e instanceof Error ? e.message.slice(0, 200) : "falha na leitura" };
  }
}

/**
 * O mapa "elemento -> texto" desta lâmina: uma chamada ao redator, guardada
 * pelo conteúdo (refazer a lâmina não paga de novo). Sem elemento: null sem
 * chamar nada. Redator fora do ar: todos os elementos saem inteiros (nunca
 * vazios) e vem o aviso.
 */
export async function preencherLamina(
  e: { inventario: InventarioDaReferencia | null | undefined; ordem: number; total: number; textoDaLamina: string; pauta: string; fonte: string; ganchos?: string[] },
  deps: DepsDaReferencia & { escrever: (sistema: string, pedido: string) => Promise<{ json: unknown; custoUsd: number }> },
): Promise<{ preenchimento: PreenchimentoDaLamina | null; custoUsd: number; aviso?: string }> {
  const { imagem, elementos } = elementosDaLamina(e.inventario, e.ordem, e.total);
  if (!elementos.length) return { preenchimento: null, custoUsd: 0 };
  const pedido = pedidoDoPreenchimento({ elementos, ordem: e.ordem, total: e.total, textoDaLamina: e.textoDaLamina, pauta: e.pauta, ganchos: e.ganchos });
  const caminho = `${deps.pasta}/preenchimento-${chaveCurta(pedido)}.json`;
  const base = { ordem: e.ordem, imagem, fonte: `${e.fonte}\n${e.pauta}`, textoDaLamina: e.textoDaLamina };
  const guardado = await deps.lerGuardado(caminho).catch(() => null);
  if (guardado && Number(guardado.versao) === VERSAO_DO_PREENCHIMENTO && guardado.resposta) {
    return { preenchimento: validarPreenchimento(elementos, guardado.resposta, base), custoUsd: 0 };
  }
  try {
    const r = await deps.escrever(INSTRUCOES_DO_PREENCHIMENTO, pedido);
    const p = validarPreenchimento(elementos, r.json, base);
    await deps.guardar(caminho, { versao: VERSAO_DO_PREENCHIMENTO, escrito_em: new Date().toISOString(), resposta: r.json }).catch(() => {});
    const saem = p.elementos.filter((x) => x.acao === "remover" && x.motivo !== "sem_conteudo").length;
    return { preenchimento: p, custoUsd: Number(r.custoUsd) || 0, ...(saem ? { aviso: `${saem} ${saem === 1 ? "elemento da referência saiu" : "elementos da referência saíram"} da lâmina ${e.ordem} (o texto repetia a referência ou trazia número que o conteúdo não tem).` } : {}) };
  } catch (err) {
    if (deps.sobe && deps.sobe(err)) throw err;
    const p = validarPreenchimento(elementos, null, { ...base, origem: "sem_redator" });
    return { preenchimento: p, custoUsd: 0, aviso: `O texto dos balões e caixas da referência não foi escrito agora: na lâmina ${e.ordem} eles saem inteiros em vez de ficarem vazios. Gere de novo para tentar outra vez.` };
  }
}
