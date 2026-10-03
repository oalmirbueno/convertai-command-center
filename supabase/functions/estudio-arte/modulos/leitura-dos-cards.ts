/**
 * Leitura dos cards do post (02/10, dono: "a arte rápida não está lendo o
 * conteúdo dos CARDS do post do Instagram, não está puxando o GANCHO; refaz
 * com outra vibe").
 *
 * Causa: o diretor recebia só a legenda do post e as imagens como
 * "Referência" (inspire, nunca copie), sem o texto escrito em cada lâmina. Ele
 * via as imagens, mas a regra mandava não copiar e o conteúdo dos cards se
 * perdia. Agora, antes do diretor, um leitor de visão barato (o modelo do
 * papel "leitura", o mesmo da leitura da logo e do molde) transcreve cada
 * lâmina: título, texto, o gancho (a headline da primeira), o CTA e a
 * estrutura (lista, passo a passo, antes e depois, comparação). O diretor
 * recebe isso como o CONTEÚDO do post, junto da legenda, e a fidelidade
 * (modulos/fidelidade-do-conteudo.ts) diz o quanto pode mudar.
 *
 * Puro (sem Deno nem npm): a função e os testes (com a visão falsa) leem o
 * mesmo arquivo; quem chama injeta o `ler` (chamarTexto com imagens).
 * Sem lookbehind, propriedade Unicode ou grupo nomeado em regex (Safari 11).
 */

export const ESTRUTURAS_DO_POST = ["lista", "passo_a_passo", "antes_depois", "comparacao", "narrativa", "unica"] as const;
export type EstruturaDoPost = (typeof ESTRUTURAS_DO_POST)[number];
export const ROTULO_DA_ESTRUTURA: Record<EstruturaDoPost, string> = {
  lista: "Lista",
  passo_a_passo: "Passo a passo",
  antes_depois: "Antes e depois",
  comparacao: "Comparação",
  narrativa: "Narrativa",
  unica: "Arte única",
};

/** Lâminas lidas no máximo (o carrossel do Instagram tem até 10 na leitura do embed). */
export const MAX_CARDS_LIDOS = 10;
/** Versão da leitura guardada (mudou o esquema: lê de novo). */
export const VERSAO_DA_LEITURA_DOS_CARDS = 1;

export interface CardLido {
  ordem: number;
  titulo: string;
  texto: string;
  papel: "capa" | "conteudo" | "cta";
}

export interface LeituraDosCards {
  tema: string;
  gancho: string;
  cta: string;
  estrutura: EstruturaDoPost;
  cards: CardLido[];
  /** Quantas imagens foram lidas (as do post e as de "Fazer igual"). */
  imagens: number;
}

export const ESQUEMA_LEITURA_DOS_CARDS = {
  nome: "leitura_dos_cards",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["tema", "gancho", "cta", "estrutura", "cards"],
    properties: {
      tema: { type: "string" },
      gancho: { type: "string" },
      cta: { type: "string" },
      estrutura: { type: "string", enum: [...ESTRUTURAS_DO_POST] },
      cards: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["ordem", "titulo", "texto"],
          properties: {
            ordem: { type: "integer" },
            titulo: { type: "string" },
            texto: { type: "string" },
          },
        },
      },
    },
  },
};

export const INSTRUCOES_DA_LEITURA_DOS_CARDS = `LEITURA DOS CARDS DE UM POST (Estúdio)
Você recebe as imagens de um post do Instagram (as lâminas de um carrossel, na ordem) e, às vezes, a legenda. Transcreva o que está ESCRITO em cada imagem, sem resumir e sem melhorar.
- cards: uma entrada por imagem, na ordem (ordem 1 = a primeira imagem). titulo: a frase dominante da lâmina (a maior letra), exatamente como está. texto: o resto do texto da lâmina, na ordem de leitura, com quebras de linha entre os blocos; listas com um item por linha, mantendo números e marcadores ("1.", "Passo 2"). Nomes de menus, botões, telas e opções exatamente como aparecem.
- Ignore o @ do perfil, a marca d'água, a logo e o nome do autor; ignore letras impressas em produtos e embalagens. Imagem sem texto: titulo e texto vazios.
- gancho: a headline da primeira lâmina, como está (o que faz parar a rolagem).
- cta: a chamada para ação do post (normalmente na última lâmina), ou vazio.
- tema: o assunto do post em uma frase curta.
- estrutura: lista (itens paralelos, dicas, erros), passo_a_passo (etapas em ordem, tutorial, configuração), antes_depois, comparacao (A x B, mito ou verdade), narrativa (história contada em sequência) ou unica (uma imagem só).
- Português do Brasil quando o post estiver em português; outro idioma: transcreva como está.`;

const limpar = (v: unknown, max: number) =>
  String(v == null ? "" : v)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
const umaLinha = (v: unknown, max: number) => limpar(v, max * 2).replace(/\s+/g, " ").trim().slice(0, max);
/** Sem @perfil nem travessão (regra da casa) no que vai para o diretor. */
const semArroba = (s: string) => s.replace(/(^|\s)@[A-Za-z0-9._]{2,30}/g, "$1").replace(/\s*[\u2014\u2013]\s*/g, ", ").replace(/[ \t]{2,}/g, " ").trim();

/** O pedido ao leitor: quantas imagens, na ordem, e a legenda (só para entender o tema). */
export function pedidoDaLeitura(quantas: number, legenda: string | null | undefined): string {
  const l = umaLinha(legenda, 1200);
  return `Leia as ${quantas} ${quantas === 1 ? "imagem anexada" : "imagens anexadas, na ordem"}.${l ? `\nLegenda do post (só para entender o tema; não transcreva): ${l}` : ""}`;
}

/** Estrutura pelas palavras dos cards, quando o leitor não disse (ou disse algo fora da lista). */
export function estruturaPelaRegra(cards: Pick<CardLido, "titulo" | "texto">[]): EstruturaDoPost {
  if (cards.length <= 1) return "unica";
  const t = cards.map((c) => `${c.titulo}\n${c.texto}`).join("\n").toLowerCase();
  if (/passo\s*\d|etapa\s*\d|\bpasso a passo|como (configurar|ativar|fazer|instalar|usar)|toque em|clique em|v[aá] em|abra o/.test(t)) return "passo_a_passo";
  if (/\bantes\b[\s\S]{0,400}\bdepois\b/.test(t)) return "antes_depois";
  if (/\bvs\.?\b|\bversus\b| x |mito|verdade|certo|errado|compara/.test(t)) return "comparacao";
  const numerados = cards.filter((c) => /^\s*(\d{1,2}[.)º°]|#\d)/.test(c.titulo) || /^\s*\d{1,2}[.)]\s/m.test(c.texto)).length;
  if (numerados >= 2) return "lista";
  return "narrativa";
}

/**
 * O que o leitor devolveu, limpo: até MAX_CARDS_LIDOS cards na ordem, sem
 * @perfil, o gancho (o do leitor ou a headline da primeira lâmina), o CTA e a
 * estrutura (a do leitor, ou pela regra). Null quando nada foi lido.
 */
export function normalizarLeituraDosCards(bruto: unknown, imagens: number): LeituraDosCards | null {
  const o = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const lista = (Array.isArray(o.cards) ? o.cards : []).filter((c) => c && typeof c === "object") as Record<string, unknown>[];
  const ordenados = lista
    .map((c, i) => ({ c, ordem: Number.isInteger(Number(c.ordem)) && Number(c.ordem) > 0 ? Number(c.ordem) : i + 1 }))
    .sort((a, b) => a.ordem - b.ordem)
    .slice(0, MAX_CARDS_LIDOS);
  const cards: CardLido[] = ordenados.map((x, i) => ({
    ordem: i + 1,
    titulo: semArroba(umaLinha(x.c.titulo, 200)),
    texto: semArroba(limpar(x.c.texto, 1200)),
    papel: i === 0 ? "capa" : "conteudo",
  }));
  const comTexto = cards.filter((c) => c.titulo || c.texto);
  if (!comTexto.length) return null;
  if (cards.length > 1) cards[cards.length - 1].papel = "cta";
  const primeira = cards[0];
  const gancho = semArroba(umaLinha(o.gancho, 200)) || primeira.titulo || umaLinha(primeira.texto.split("\n")[0], 200);
  const estrutura = (ESTRUTURAS_DO_POST as readonly string[]).indexOf(String(o.estrutura)) >= 0 && !(o.estrutura === "unica" && cards.length > 1)
    ? (o.estrutura as EstruturaDoPost)
    : estruturaPelaRegra(cards);
  return {
    tema: semArroba(umaLinha(o.tema, 200)),
    gancho,
    cta: semArroba(umaLinha(o.cta, 200)),
    estrutura,
    cards,
    imagens: Math.max(0, Math.round(imagens) || 0),
  };
}

/** A leitura gravada (direcao.arte_rapida.leitura_dos_cards), em forma fixa, ou null. */
export function leituraGravada(v: unknown): LeituraDosCards | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const l = normalizarLeituraDosCards({ ...o, cards: o.cards }, Number(o.imagens) || 0);
  if (!l) return null;
  // A estrutura gravada vale (já foi decidida); o gancho gravado também.
  return l;
}

/** O conteúdo dos cards como o diretor lê (vai em item.pedido_avulso.conteudo_dos_cards). */
export function leituraParaODiretor(l: LeituraDosCards) {
  return {
    tema: l.tema || null,
    gancho_original: l.gancho,
    cta_original: l.cta || null,
    estrutura: ROTULO_DA_ESTRUTURA[l.estrutura],
    quantidade_de_laminas: l.cards.length,
    laminas: l.cards.map((c) => ({ ordem: c.ordem, titulo: c.titulo, texto: c.texto })),
  };
}

/** Todo o texto lido (para a conferência: o que veio do post vale como fonte confirmada). */
export function textoDaLeitura(l: LeituraDosCards | null | undefined): string {
  if (!l) return "";
  return [l.tema, l.gancho, l.cta, ...l.cards.map((c) => `${c.titulo}\n${c.texto}`)].filter(Boolean).join("\n").slice(0, 6000);
}

/**
 * Lê os cards com o leitor de visão (uma chamada, sem laço). Sem imagem: nada
 * é chamado. Falha: null com o motivo (a arte segue pela legenda e pelas
 * imagens, como antes) e o custo do que foi gasto.
 */
export async function lerCardsDoPost<I>(
  imagens: I[],
  legenda: string | null | undefined,
  ler: (sistema: string, pedido: string, imagens: I[]) => Promise<{ json: unknown; custoUsd: number }>,
  /** Erro que sobe (saldo, cota, chave): o diretor cairia no mesmo erro. */
  sobe: (e: unknown) => boolean = () => false,
): Promise<{ leitura: LeituraDosCards | null; custoUsd: number; erro?: string }> {
  const lista = imagens.slice(0, MAX_CARDS_LIDOS);
  if (!lista.length) return { leitura: null, custoUsd: 0 };
  try {
    const r = await ler(INSTRUCOES_DA_LEITURA_DOS_CARDS, pedidoDaLeitura(lista.length, legenda), lista);
    const leitura = normalizarLeituraDosCards(r.json, lista.length);
    return leitura ? { leitura, custoUsd: Number(r.custoUsd) || 0 } : { leitura: null, custoUsd: Number(r.custoUsd) || 0, erro: "sem texto nas imagens" };
  } catch (e) {
    if (sobe(e)) throw e;
    return { leitura: null, custoUsd: 0, erro: e instanceof Error ? e.message.slice(0, 200) : "falha na leitura" };
  }
}
