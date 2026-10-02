/**
 * Conteúdo do Estúdio Ads (pedido do dono em 02/10/2026): a reescrita única
 * das copies que o conferente da casa reprova e o comando "muda todo o
 * conteúdo" / "refaz tudo", que reescreve TODAS as variações e os cards no
 * lugar (nunca acrescenta um card a mais com o mesmo conteúdo), com Confirmar
 * e Desfazer. Puro: sem Deno e sem banco; o modelo entra por quem chama.
 * Sem travessão.
 */

import {
  anguloDeVenda,
  type AnguloDeVenda,
  type AnuncioParaConferir,
  type ConferenciaDoAnuncio,
  conferirAnuncio,
  type FatosDaOferta,
  pedidoDeReescrita,
} from "./copy-de-resposta.ts";

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ------------------------------------------------------------ "refaz tudo"

const VERBO_DE_REFAZER = "(muda|mude|mudar|muda ai|troca|troque|trocar|refaz|refaca|refazer|reescreve|reescreva|reescrever|recria|recrie|recriar|altera|altere|alterar|renova|renove|refazendo|mudando|trocando)";
const TUDO = "(todo o conteudo|todo conteudo|o conteudo todo|o conteudo inteiro|todo o texto|todos os textos|todas as copies|todas as copys|todas as variacoes|todos os cards|todas as laminas|todos os criativos|tudo)";
const PEDE_TUDO = [
  new RegExp(`\\b${VERBO_DE_REFAZER}\\s+(\\w+\\s+)?${TUDO}`),
  new RegExp(`\\b${TUDO}\\s+(de novo|novo|do zero|diferente)\\b`),
  /\b(conteudo|texto|copy)\s+(todo|inteiro|completo)\s+(novo|diferente|de novo)\b/,
  /\bdo zero\b/,
];

/**
 * A equipe pediu para trocar TODO o conteúdo ("muda todo o conteúdo", "refaz
 * tudo", "reescreve todas as variações", "do zero"). Pedido de ajuste pontual
 * ("muda o título", "troca o CTA") não conta.
 */
export function pedeRefazerTudo(texto: unknown): boolean {
  const s = semAcento(String(texto == null ? "" : texto)).replace(/\s+/g, " ").trim();
  if (!s) return false;
  return PEDE_TUDO.some((re) => re.test(s));
}

// ------------------------------------------------------------ reescrita única

export type VariacaoBruta = Record<string, unknown>;

/** Os campos de uma variação que o conferente lê. */
export function paraConferir(v: VariacaoBruta): AnuncioParaConferir {
  const t = (k: string) => (typeof v[k] === "string" ? String(v[k]) : null);
  const carrossel = Array.isArray(v.carrossel) ? (v.carrossel as Record<string, unknown>[]).map((c) => String((c && c.texto_exato) || "")).filter(Boolean).join("\n") : "";
  return {
    texto_principal: t("texto_principal"),
    texto_principal_longo: t("texto_principal_longo"),
    titulo: t("titulo"),
    descricao: t("descricao"),
    headline_arte: t("headline_arte"),
    apoio_arte: [t("apoio_arte"), carrossel].filter(Boolean).join("\n") || null,
    cta_arte: t("cta_arte"),
    cta_meta: t("cta_meta"),
  };
}

export type ResultadoDaReescrita = {
  variacoes: VariacaoBruta[];
  conferencias: ConferenciaDoAnuncio[];
  /** Índices que foram reescritos (e ficaram com a versão nova). */
  reescritas: number[];
  /** A reescrita foi pedida e falhou (fica o original, com aviso). */
  erro: string | null;
};

/**
 * Confere todas em código; as reprovadas vão para UMA reescrita (uma chamada
 * só, nunca laço). A versão nova entra quando não fica pior (menos ou igual
 * número de motivos); o que ainda reprovar sai com aviso.
 */
export async function reescreverReprovadas(
  escrever: (pedido: string) => Promise<VariacaoBruta[]>,
  variacoes: VariacaoBruta[],
  fatos: FatosDaOferta,
  angulos: (AnguloDeVenda | null)[] = [],
): Promise<ResultadoDaReescrita> {
  const saida = variacoes.slice();
  const conferencias = saida.map((v) => conferirAnuncio(paraConferir(v), fatos));
  const reprovadas = conferencias.map((c, i) => (c.reprovada ? i : -1)).filter((i) => i >= 0);
  if (!reprovadas.length) return { variacoes: saida, conferencias, reescritas: [], erro: null };
  let novas: VariacaoBruta[];
  try {
    novas = await escrever(pedidoDeReescrita(
      reprovadas.map((i) => ({ indice: i, copy: semCamposPesados(saida[i]), motivos: conferencias[i].motivos.map((m) => m.texto), angulo: anguloDeVenda(saida[i].angulo_de_venda) ?? angulos[i] ?? null })),
      fatos,
    ));
  } catch (e) {
    return { variacoes: saida, conferencias, reescritas: [], erro: e instanceof Error ? e.message.slice(0, 200) : "reescrita_falhou" };
  }
  const reescritas: number[] = [];
  reprovadas.forEach((i, k) => {
    const nova = novas[k];
    if (!nova || typeof nova !== "object") return;
    const conf = conferirAnuncio(paraConferir(nova), fatos);
    if (conf.motivos.length > conferencias[i].motivos.length) return;
    // O ângulo de venda e o número da variação são os da original (a reescrita não troca o plano).
    saida[i] = { ...nova, variacao: saida[i].variacao ?? i + 1, angulo_de_venda: saida[i].angulo_de_venda ?? nova.angulo_de_venda ?? angulos[i] ?? null };
    conferencias[i] = conf;
    reescritas.push(i);
  });
  return { variacoes: saida, conferencias, reescritas, erro: null };
}

/** A variação sem o que pesa no pedido (carrossel fica, ilustração sai). */
function semCamposPesados(v: VariacaoBruta): VariacaoBruta {
  const copia: VariacaoBruta = {};
  for (const k of Object.keys(v)) if (k !== "gancho_visual" && k !== "estilo_visual") copia[k] = v[k];
  return copia;
}

// ------------------------------------------------------------ cards com o texto novo

/**
 * Troca o texto dos cards da direção NO LUGAR (mesma quantidade, mesma ordem,
 * layout e composição intactos) e refaz os blocos como a produção faz
 * (headline, subtítulo, apoio e o CTA escrito na peça). Card sem texto novo
 * fica como estava; texto a mais do que cards é ignorado (nunca cria card).
 */
export function cardsComTextoNovo(cards: Record<string, unknown>[], textos: string[], ctaArte: string): Record<string, unknown>[] {
  return cards.map((c, i) => {
    const texto = String(textos[i] || "").trim();
    if (!texto) return c;
    const linhas = texto.split("\n").map((l) => l.trim()).filter(Boolean);
    const funcao = String(c.funcao || "");
    const temCta = linhas.length > 1 && (funcao === "cta" || linhas[linhas.length - 1] === ctaArte);
    const blocos = linhas.map((l, k) => ({ papel: k === 0 ? "headline" : temCta && k === linhas.length - 1 ? "cta" : k === 1 ? "subtitulo" : "apoio", texto: l }));
    return { ...c, texto_exato: linhas.join("\n"), blocos };
  });
}

// ------------------------------------------------------------ propor, confirmar, desfazer

/** Os campos de conteúdo da copy que a reescrita troca (o resto, como o pacote e as alternativas, fica). */
export const CAMPOS_DO_CONTEUDO = [
  "texto_principal", "texto_principal_longo", "titulo", "descricao", "cta_meta",
  "headline_arte", "apoio_arte", "cta_arte", "framework", "angulo_de_venda", "jev", "escolha", "avisos_tom",
  "conferencia_casa", "referencia_replicada", "mundo_real", "carrossel",
];

const soConteudo = (copy: Record<string, unknown>) => {
  const o: Record<string, unknown> = {};
  for (const k of CAMPOS_DO_CONTEUDO) if (k in copy) o[k] = copy[k];
  return o;
};

export type ReescritaPendente = { lote: string; pedido: string; depois: Record<string, unknown>; textos_dos_cards: string[]; criado_em: string };
export type ReescritaFeita = { lote: string; copy_antes: Record<string, unknown>; cards_antes: Record<string, unknown>[] | null; legenda_antes: string | null; feito_em: string };

/** A copy com a proposta guardada (nada muda no conteúdo até o Confirmar). */
export function copyComProposta(copy: Record<string, unknown>, p: ReescritaPendente): Record<string, unknown> {
  return { ...copy, reescrita_pendente: p };
}

/** A proposta guardada na copy, se for deste lote. */
export function propostaDoLote(copy: Record<string, unknown> | null | undefined, lote: string): ReescritaPendente | null {
  const p = copy ? copy.reescrita_pendente as ReescritaPendente | undefined : undefined;
  return p && typeof p === "object" && p.lote === lote && p.depois && typeof p.depois === "object" ? p : null;
}

/** Aplica a proposta: troca só os campos de conteúdo, guarda o antes para o Desfazer e apaga a pendência. */
export function copyConfirmada(copy: Record<string, unknown>, p: ReescritaPendente, antes: { cards: Record<string, unknown>[] | null; legenda: string | null }, agora = new Date().toISOString()): Record<string, unknown> {
  const base: Record<string, unknown> = { ...copy };
  delete base.reescrita_pendente;
  for (const k of CAMPOS_DO_CONTEUDO) delete base[k];
  const feita: ReescritaFeita = { lote: p.lote, copy_antes: soConteudo(copy), cards_antes: antes.cards, legenda_antes: antes.legenda, feito_em: agora };
  return { ...base, ...p.depois, reescrita_feita: feita };
}

/** Desfaz a reescrita confirmada deste lote: o conteúdo de antes volta; null quando não há o que desfazer. */
export function copyDesfeita(copy: Record<string, unknown>, lote: string): { copy: Record<string, unknown>; cards: Record<string, unknown>[] | null; legenda: string | null } | null {
  const f = copy.reescrita_feita as ReescritaFeita | undefined;
  if (!f || typeof f !== "object" || f.lote !== lote || !f.copy_antes) return null;
  const base: Record<string, unknown> = { ...copy };
  delete base.reescrita_feita;
  for (const k of CAMPOS_DO_CONTEUDO) delete base[k];
  return { copy: { ...base, ...f.copy_antes }, cards: Array.isArray(f.cards_antes) ? f.cards_antes : null, legenda: typeof f.legenda_antes === "string" ? f.legenda_antes : null };
}

/** Antes e depois para a tela (só o que muda à vista). */
export function resumoDaProposta(antes: Record<string, unknown>, depois: Record<string, unknown>) {
  const campo = (o: Record<string, unknown>, k: string) => (typeof o[k] === "string" ? String(o[k]) : "");
  const pegar = (o: Record<string, unknown>) => ({
    texto_principal: campo(o, "texto_principal"),
    titulo: campo(o, "titulo"),
    headline_arte: campo(o, "headline_arte"),
    cta_meta: campo(o, "cta_meta"),
    angulo_de_venda: campo(o, "angulo_de_venda") || null,
  });
  return { antes: pegar(antes), depois: pegar(depois) };
}
