/**
 * kit_sugerir com o que a identificação do produto já achou (anti-bug AB2,
 * 26/09). A tela (Identificacao.tsx, "Confirmar e montar o produto") manda
 * `produto` (marca, modelo, variante, especificações lidos por
 * produto_identificar) e `referencias_web` (as fotos oficiais baixadas da
 * internet, com a página e a fonte), e a função ignorava os dois: o leitor
 * montava o kit às cegas e podia dar outro nome ao produto já identificado.
 *
 * Aqui só o que é puro (a função importa, o teste do painel também): ler o que
 * a tela mandou, o bloco do pedido ao leitor e o kit do produto com a
 * identificação e as referências. O modelo do leitor não muda.
 */

import { type Identificacao, limpo, normalizarIdentificacao, type KitFoto, type RefDoKit, urlPublicaSegura, UUID } from "./calculos.ts";

/** Referência da internet como a tela manda (fotoApi.sugerirKit). */
export type ReferenciaWebDaTela = { imagem_id: string; url_origem: string | null; pagina: string | null; fonte: string | null };

/** Máximo de referências da internet lidas do corpo (produto_identificar baixa até 6). */
export const MAX_REFERENCIAS_WEB_NA_SUGESTAO = 12;

/**
 * O produto que a tela manda (ProdutoIdentificado de fotoApi.ts): a
 * confiança chega em palavras ("média") e vira a do servidor ("media").
 * Sem marca nem modelo, null (como normalizarIdentificacao).
 */
export function produtoDaTela(bruto: unknown): Identificacao | null {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return null;
  const r = bruto as Record<string, unknown>;
  const confianca = String(r.confianca ?? "").trim().toLowerCase().replace("é", "e");
  return normalizarIdentificacao({ ...r, confianca, paginas: Array.isArray(r.paginas) ? r.paginas : [] });
}

/** As referências da internet do corpo: só imagem_id válido, sem repetir; página e origem só https público. */
export function referenciasWebDaTela(bruto: unknown, max = MAX_REFERENCIAS_WEB_NA_SUGESTAO): ReferenciaWebDaTela[] {
  if (!Array.isArray(bruto)) return [];
  const saida: ReferenciaWebDaTela[] = [];
  for (const item of bruto) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const id = String(r.imagem_id ?? "").trim();
    if (!UUID.test(id) || saida.some((x) => x.imagem_id === id)) continue;
    const pagina = urlPublicaSegura(r.pagina);
    const origem = urlPublicaSegura(r.url_origem);
    saida.push({
      imagem_id: id,
      url_origem: origem ? origem.toString().slice(0, 500) : null,
      pagina: pagina ? pagina.toString().slice(0, 500) : null,
      fonte: limpo(r.fonte, 120) || (pagina ? pagina.hostname.replace(/^www\./i, "") : null),
    });
    if (saida.length >= max) break;
  }
  return saida;
}

/** Nome do produto identificado (marca e modelo). */
export const nomeDaIdentificacao = (p: Pick<Identificacao, "marca" | "modelo">) => [p.marca, p.modelo].filter(Boolean).join(" ");

/** Complemento da legenda de uma foto que é referência da internet: de onde veio. */
export function legendaDaReferenciaWeb(ref: ReferenciaWebDaTela | null | undefined): string {
  if (!ref) return "";
  const partes = [ref.fonte ? `fonte ${ref.fonte}` : "", ref.pagina ? `página ${ref.pagina}` : ""].filter(Boolean);
  return partes.length ? ` (${partes.join(", ")})` : "";
}

/**
 * Bloco do pedido ao leitor: o produto já identificado (nome, variante,
 * especificações) e o papel das referências da internet. Vazio sem nada.
 */
export function blocoDaIdentificacaoNoPedido(produto: Identificacao | null, refs: ReferenciaWebDaTela[]): string {
  const linhas: string[] = [];
  if (produto) {
    const extras = [produto.variante ? `variante ${produto.variante}` : "", produto.categoria ? `categoria ${produto.categoria}` : ""].filter(Boolean);
    linhas.push(`PRODUTO JÁ IDENTIFICADO pela equipe (leitura da embalagem e pesquisa na internet, confiança ${produto.confianca}): ${nomeDaIdentificacao(produto)}${extras.length ? `, ${extras.join(", ")}` : ""}.`);
    if (produto.especificacoes.length) linhas.push(`Especificações achadas: ${produto.especificacoes.slice(0, 12).join("; ")}.`);
    linhas.push("Use este nome e esta variante no kit das fotos deste produto, sem inventar outro. Foto que claramente não é este produto fica fora do kit dele.");
  }
  if (refs.length) {
    linhas.push(`${refs.length === 1 ? "A foto marcada" : `As ${refs.length} fotos marcadas`} REFERÊNCIA DA INTERNET ${refs.length === 1 ? "é" : "são"} do mesmo produto, achada${refs.length === 1 ? "" : "s"} na identificação: entra${refs.length === 1 ? "" : "m"} no kit dele com o papel identidade (uso interno, nunca vai ao cliente).`);
  }
  return linhas.length ? `\n${linhas.join("\n")}` : "";
}

/**
 * O kit do produto identificado entre os sugeridos: o que tem referência da
 * internet que o leitor viu (`web.noLote`); sem nenhum, o único kit que não
 * é de pessoa. Nele entram a identificação (quando o kit ainda não tem), a
 * variante lida, as especificações como inferidas e as referências da
 * internet que a tela cortou do lote (`web.foraDoLote`, papel identidade: o
 * leitor não as viu, então não decidiu sobre elas). Os outros kits não mudam.
 */
export function kitsComIdentificacao<K extends KitFoto & { refs: RefDoKit[] }>(
  kits: K[],
  produto: Identificacao | null,
  web: { noLote: string[]; foraDoLote: string[] },
): K[] {
  if (!produto && !web.foraDoLote.length) return kits;
  let alvo = kits.findIndex((k) => k.tipo !== "pessoa" && k.refs.some((r) => web.noLote.indexOf(r.imagem_id) >= 0));
  if (alvo < 0) {
    const semPessoa = kits.map((k, i) => ({ k, i })).filter((x) => x.k.tipo !== "pessoa");
    if (semPessoa.length === 1) alvo = semPessoa[0].i;
  }
  if (alvo < 0) return kits;
  return kits.map((k, i) => {
    if (i !== alvo) return k;
    const refs = k.refs.slice();
    web.foraDoLote.forEach((id, j) => {
      if (!refs.some((r) => r.imagem_id === id)) refs.push({ imagem_id: id, papel: "identidade", vista: null, prioridade: 50 + j });
    });
    if (!produto) return { ...k, refs };
    const inferido = k.atributos.inferido.slice();
    produto.especificacoes.forEach((s) => {
      const t = `Pela internet: ${s}`;
      if (inferido.indexOf(t) < 0) inferido.push(t);
    });
    return {
      ...k,
      variante: k.variante || produto.variante,
      atributos: { ...k.atributos, inferido: inferido.slice(0, 30), identificacao: k.atributos.identificacao || produto },
      refs,
    };
  });
}
