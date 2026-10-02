/**
 * Orçamento das amostras da biblioteca da Mesa Foto (funções puras, sem rede
 * e sem disco). Usado por scripts/gerar-amostras-da-biblioteca.mjs e pelos
 * testes (src/test/mesa-foto-amostras-orcamento.test.ts).
 *
 * Regra do dono: teto rígido em US$ (padrão 3,00). O plano para ANTES de
 * passar do teto: o próximo item só entra se o total com ele ainda couber.
 */

export const TETO_PADRAO_USD = 3.0;
export const QUALIDADE_PADRAO = "media";

/** Número finito, senão null (aceita texto numérico, como o PostgREST manda numeric). */
export function numeroOuNulo(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Custo válido para planejar: número finito e maior que zero. Zero ou sem preço não dá para garantir o teto. */
export const custoValido = (v) => {
  const n = numeroOuNulo(v);
  return n !== null && n > 0 ? n : null;
};

/** Teto em US$: número >= 0; inválido ou ausente vira o padrão (3,00). */
export function lerTeto(v) {
  const n = numeroOuNulo(v);
  return n !== null && n >= 0 ? n : TETO_PADRAO_USD;
}

/** Centavos de milésimo (micro-dólar) para somar sem erro de vírgula flutuante. */
const micro = (usd) => Math.round(usd * 1e6);
const deMicro = (m) => Math.round(m) / 1e6;

/**
 * Preço por imagem do modelo no catálogo (ia_modelos.preco_imagem), na
 * qualidade pedida, mais a entrada do prompt (tokens * preço por 1M). Mesma
 * fórmula do motor (estimarComModelo). Null quando o catálogo não tem preço.
 */
export function custoPorImagemDoModelo(modelo, { qualidade = QUALIDADE_PADRAO, tokensEntrada = 720 } = {}) {
  if (!modelo || typeof modelo !== "object") return null;
  const tabela = modelo.preco_imagem && typeof modelo.preco_imagem === "object" ? modelo.preco_imagem : {};
  const porImagem = custoValido(tabela[qualidade]) ?? custoValido(tabela.media) ?? custoValido(tabela.baixa) ?? custoValido(tabela.alta);
  if (porImagem === null) return null;
  const entrada = numeroOuNulo(tabela.entrada_imagem_1m) ?? numeroOuNulo(modelo.preco_entrada_1m) ?? 0;
  return deMicro(micro(porImagem + (Math.max(0, tokensEntrada) * Math.max(0, entrada)) / 1e6));
}

/** Gera imagem a partir de texto: tipo imagem, ativo, disponível e (quando o catálogo diz) com saída de imagem. */
export function modeloDeImagemServe(m) {
  if (!m || typeof m !== "object" || !m.id) return false;
  if (m.tipo !== "imagem") return false;
  if (m.ativo === false || m.disponivel === false) return false;
  const saida = m.modalidades && Array.isArray(m.modalidades.saida) ? m.modalidades.saida.map((x) => String(x).toLowerCase()) : null;
  if (saida && saida.length && saida.indexOf("imagem") < 0 && saida.indexOf("image") < 0) return false;
  const entrada = m.modalidades && Array.isArray(m.modalidades.entrada) ? m.modalidades.entrada.map((x) => String(x).toLowerCase()) : null;
  if (entrada && entrada.length && entrada.indexOf("texto") < 0 && entrada.indexOf("text") < 0) return false;
  return true;
}

/**
 * O modelo de imagem mais barato do catálogo que serve (ativo, disponível,
 * texto para imagem, com preço). Empate: o id em ordem alfabética, para o
 * plano ser sempre o mesmo. Null quando nenhum serve.
 */
export function escolherModeloMaisBarato(catalogo, opcoes = {}) {
  const qualidade = opcoes.qualidade || QUALIDADE_PADRAO;
  let melhor = null;
  for (const m of Array.isArray(catalogo) ? catalogo : []) {
    if (!modeloDeImagemServe(m)) continue;
    const custo = custoPorImagemDoModelo(m, { qualidade, tokensEntrada: opcoes.tokensEntrada });
    if (custo === null) continue;
    if (!melhor || custo < melhor.custoPorImagem || (custo === melhor.custoPorImagem && String(m.id) < String(melhor.modelo.id))) {
      melhor = { modelo: m, custoPorImagem: custo };
    }
  }
  return melhor;
}

/** Item que ainda não tem imagem nenhuma (exemplo gerado, importado ou de banco público) e tem prompt. */
export function pendentesSemImagem(itens) {
  return (Array.isArray(itens) ? itens : []).filter(
    (i) => i && i.id && (i.tipo === undefined || i.tipo === "prompt") && !!(i.prompt_pt || i.prompt_en) && !(i.storage_path || i.imagem_url || i.miniatura_url),
  );
}

/**
 * Plano das amostras: na ordem dada, até o limite, cada item entra só se o
 * total com ele não passar do teto. Para no primeiro que não cabe (nada de
 * pular para um mais barato: a ordem é a da biblioteca, destaques primeiro).
 *
 * `custoPorImagem`: número (o mesmo para todos) ou função (item) => número.
 * Custo zero, negativo ou inválido não planeja nada (motivo "custo_invalido"):
 * sem preço não há como garantir o teto.
 */
export function planejarAmostras({ pendentes, custoPorImagem, tetoUsd, limite } = {}) {
  const lista = Array.isArray(pendentes) ? pendentes : [];
  const teto = lerTeto(tetoUsd);
  const max = numeroOuNulo(limite);
  const quantos = max !== null && max >= 0 ? Math.min(lista.length, Math.floor(max)) : lista.length;
  const custoDe = typeof custoPorImagem === "function" ? custoPorImagem : () => custoPorImagem;
  const itens = [];
  let totalMicro = 0;
  let motivo = null;
  for (let k = 0; k < quantos; k++) {
    const custo = custoValido(custoDe(lista[k]));
    if (custo === null) {
      motivo = "custo_invalido";
      break;
    }
    if (totalMicro + micro(custo) > micro(teto)) {
      motivo = "teto";
      break;
    }
    totalMicro += micro(custo);
    itens.push({ item: lista[k], custoUsd: custo, acumuladoUsd: deMicro(totalMicro) });
  }
  if (!motivo && quantos < lista.length) motivo = "limite";
  return { itens, totalUsd: deMicro(totalMicro), cortados: lista.length - itens.length, tetoUsd: teto, motivo };
}

/** Na execução real: o próximo só vai se o gasto real até aqui mais a estimativa dele couber no teto. */
export function podeGerarMais({ gastoUsd, proximoUsd, tetoUsd }) {
  const proximo = custoValido(proximoUsd);
  if (proximo === null) return false;
  const gasto = Math.max(0, numeroOuNulo(gastoUsd) ?? 0);
  return micro(gasto) + micro(proximo) <= micro(lerTeto(tetoUsd));
}

/** US$ com 4 casas (os preços de imagem ficam em centavos e frações). */
export const usd = (v) => `US$ ${(numeroOuNulo(v) ?? 0).toFixed(4)}`;
