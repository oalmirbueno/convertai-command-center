/**
 * Diretor do book (pedido do dono, 02/10: "Book de fotos: hoje é impossível
 * criar. Quero um diretor do book: eu escrevo o que quero e ele monta o plano
 * inteiro sozinho"). Conta pura e determinística, sem IA e sem custo: lê o
 * pedido em português, escolhe o assunto (produto ou modelo pelo nome citado,
 * senão o primeiro disponível), a quantidade ("12 fotos"; padrão 8, de 4 a
 * 16) e distribui ângulos, cenas e luzes pelas tomadas para o book sair
 * variado (capa, frente, 3/4, perfil, detalhe, ambiente e, se o texto pedir,
 * com modelo). Cada tomada já leva o prompt com lógica de fotografia
 * (enquadramento, câmera, lente, cenário e luz) e o nome do assunto.
 *
 * A tela mostra o plano para editar e só gasta no "Confirmar e gerar", com
 * o custo antes (quantidade vezes o preço de uma foto).
 */

export type TipoDoModeloDoPlano = "persona" | "clone";

export interface ProdutoDoPlano {
  id: string;
  nome: string;
  tipo: string;
  /** O que falta para gerar (ex.: kit sem foto de identidade); vira aviso no plano. */
  aviso?: string | null;
}

export interface ModeloDoPlano {
  id: string;
  nome: string;
  tipo: TipoDoModeloDoPlano;
  aviso?: string | null;
}

export interface ContextoDoPlano {
  produtos: ProdutoDoPlano[];
  modelos: ModeloDoPlano[];
  custoPorFotoUsd: number | null;
  /** Assunto escolhido à mão na tela (troca o que veio do texto). */
  assuntoFixo?: { tipo: "produto" | TipoDoModeloDoPlano; id: string } | null;
  /** Quantidade escolhida à mão na tela (troca a do texto). */
  quantidadeFixa?: number | null;
}

export interface AssuntoDoPlano {
  tipo: "produto" | TipoDoModeloDoPlano;
  id: string;
  nome: string;
  /** true quando o nome apareceu no pedido (false: o primeiro disponível). */
  citado: boolean;
}

export interface TomadaDoPlano {
  id: string;
  titulo: string;
  angulo: string;
  cena: string;
  luz: string;
  enquadramento: string;
  comModelo: boolean;
  prompt: string;
}

export interface PlanoDoBook {
  assunto: AssuntoDoPlano | null;
  /** Modelo citado num book de produto (entra descrito, sem o rosto fiel). */
  modelo: ModeloDoPlano | null;
  quantidade: number;
  tomadas: TomadaDoPlano[];
  custoTotalUsd: number | null;
  avisos: string[];
  /** O que o texto pediu (vazio: o diretor usou o padrão do book). */
  pedidos: { angulos: string[]; cenas: string[]; luzes: string[] };
}

export const QUANTIDADE_PADRAO = 8;
export const QUANTIDADE_MINIMA = 4;
export const QUANTIDADE_MAXIMA = 16;

// ------------------------------------------------------------------ vocabulário

interface Termo {
  id: string;
  rotulo: string;
  /** Regex sobre o texto em minúsculas e sem acento. */
  busca: RegExp;
  /** Trecho do prompt. */
  prompt: string;
}

export const ANGULOS: Termo[] = [
  { id: "frente", rotulo: "Frente", busca: /\b(de frente|frontal|frente)\b/, prompt: "câmera de frente, na altura do assunto, eixo reto" },
  { id: "tres_quartos", rotulo: "3/4", busca: /(3\/4|\btres quartos\b|\b45 graus\b)/, prompt: "ângulo 3/4, câmera girada 45 graus mostrando frente e lateral" },
  { id: "perfil", rotulo: "Perfil", busca: /\b(perfil|lateral|de lado)\b/, prompt: "de perfil, câmera a 90 graus da frente, silhueta limpa" },
  { id: "de_cima", rotulo: "De cima", busca: /(\bde cima\b|flat ?lay|\bvista superior\b|top ?down|\bzenital\b)/, prompt: "de cima (flat lay), câmera a 90 graus sobre a superfície, composição gráfica" },
  { id: "detalhe", rotulo: "Detalhe", busca: /\b(detalhes?|macro|close|textura)\b/, prompt: "detalhe em macro, foco curto na textura, no acabamento e na marca" },
  { id: "contra_plongee", rotulo: "Contra-plongée", busca: /(contra.?plong|\bde baixo\b|\bcamera baixa\b)/, prompt: "contra-plongée, câmera baixa olhando para cima, assunto imponente" },
  { id: "costas", rotulo: "Verso", busca: /\b(verso|costas|de tras)\b/, prompt: "de trás, mostrando o verso real" },
];

export const CENAS: Termo[] = [
  { id: "estudio", rotulo: "Estúdio", busca: /\bestudio\b/, prompt: "estúdio fotográfico, superfície limpa e respiro em volta" },
  { id: "fundo_infinito", rotulo: "Fundo infinito", busca: /(fundo infinito|fundo branco|fundo neutro|fundo liso)/, prompt: "fundo infinito neutro, sem emenda, sombra de contato suave" },
  { id: "bancada", rotulo: "Bancada", busca: /\b(bancada|balcao|mesa de (?:madeira|marmore|pedra)|travertino|marmore)\b/, prompt: "sobre bancada de pedra clara, props com função ao lado" },
  { id: "rua", rotulo: "Rua", busca: /\b(rua|urbano|urbana|calcada|cidade)\b/, prompt: "na rua, cenário urbano real, fundo da cidade desfocado" },
  { id: "praia", rotulo: "Praia", busca: /\b(praia|areia|beira.mar)\b/, prompt: "na praia, areia clara e mar ao fundo desfocado" },
  { id: "loja", rotulo: "Loja", busca: /\b(loja|vitrine|prateleira|ponto de venda)\b/, prompt: "na loja, vitrine organizada, fundo do ponto de venda desfocado" },
  { id: "casa", rotulo: "Casa", busca: /\b(casa|sala|cozinha|quarto|lar)\b/, prompt: "em casa, ambiente real de sala com móveis e plantas" },
  { id: "escritorio", rotulo: "Escritório", busca: /\b(escritorio|home office|mesa de trabalho)\b/, prompt: "no escritório, mesa de trabalho real e organizada" },
  { id: "natureza", rotulo: "Natureza", busca: /\b(natureza|jardim|parque|plantas|campo|ao ar livre)\b/, prompt: "ao ar livre, natureza com verde ao fundo desfocado" },
];

export const LUZES: Termo[] = [
  { id: "fim_de_tarde", rotulo: "Fim de tarde", busca: /(fim de tarde|golden|por do sol|entardecer|hora dourada)/, prompt: "luz de fim de tarde (golden hour), quente, baixa e lateral, sombras longas e macias" },
  { id: "natural", rotulo: "Natural", busca: /(luz natural|\bnatural\b|\bjanela\b)/, prompt: "luz natural de janela, suave e lateral, sombras macias" },
  { id: "estudio_suave", rotulo: "Estúdio suave", busca: /(estudio suave|luz suave|softbox|difusa|luz de estudio)/, prompt: "luz de estúdio suave, softbox grande a 45 graus e rebatedor do outro lado" },
  { id: "dura", rotulo: "Dura", busca: /(luz dura|sombra marcada|sombras marcadas|sol forte|sol a pino|meio dia)/, prompt: "luz dura com sombra marcada e recorte gráfico" },
  { id: "neon", rotulo: "Neon", busca: /\bneon\b/, prompt: "luz neon colorida de apoio, reflexos controlados, assunto bem exposto" },
  { id: "noturna", rotulo: "Noturna", busca: /\b(noite|noturna|noturno)\b/, prompt: "cena noturna com luz prática do ambiente, assunto bem exposto" },
];

const ANGULOS_PADRAO = ["frente", "tres_quartos", "perfil", "detalhe", "de_cima"];
const ANGULOS_PADRAO_DA_PESSOA = ["frente", "tres_quartos", "perfil", "detalhe", "contra_plongee"];
const CENAS_PADRAO = ["fundo_infinito", "bancada", "casa"];
const LUZES_PADRAO = ["estudio_suave", "natural"];
const CENAS_DE_ESTUDIO = ["estudio", "fundo_infinito"];

const PEDE_MODELO = /\b(modelos?|pessoas?|mulher|homem|maos?|segurando|usando|vestindo|em uso|lifestyle)\b/;

const NUMEROS: Record<string, number> = {
  quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13,
  quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, vinte: 20,
};

const semAcento = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const porId = (lista: Termo[], id: string) => lista.filter((t) => t.id === id)[0];

/** Termos do vocabulário que aparecem no texto, na ordem em que aparecem. */
export function termosNoTexto(texto: string, lista: Termo[]): string[] {
  const t = semAcento(texto);
  return lista
    .map((termo) => ({ id: termo.id, pos: t.search(termo.busca) }))
    .filter((x) => x.pos >= 0)
    .sort((a, b) => a.pos - b.pos)
    .map((x) => x.id);
}

/** "12 fotos", "doze fotos", "book com 10 imagens"; null quando o texto não diz. */
export function quantidadeNoTexto(texto: string): number | null {
  const t = semAcento(texto);
  const m = t.match(/\b(\d{1,3})\s*(?:fotos?|imagens?|tomadas?|cliques?|takes?)\b/);
  if (m) return Number(m[1]);
  const p = t.match(/\b(quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|vinte)\s+(?:fotos?|imagens?|tomadas?|cliques?)\b/);
  return p ? NUMEROS[p[1]] : null;
}

export const limitarQuantidadeDoBook = (n: number) => Math.max(QUANTIDADE_MINIMA, Math.min(QUANTIDADE_MAXIMA, Math.round(n)));

/** Pontos de um nome no texto: o nome inteiro vale mais que palavras soltas (4 letras ou mais). */
function pontosDoNome(texto: string, nome: string): number {
  const t = ` ${semAcento(texto).replace(/[^a-z0-9]+/g, " ")} `;
  const n = semAcento(nome).replace(/[^a-z0-9]+/g, " ").trim();
  if (!n) return 0;
  if (t.indexOf(` ${n} `) >= 0) return 100 + n.length;
  return n.split(" ").filter((p) => p.length >= 4 && t.indexOf(` ${p} `) >= 0).length;
}

function maisCitado<T extends { nome: string }>(texto: string, lista: T[]): T | null {
  let melhor: T | null = null;
  let pontos = 0;
  lista.forEach((x) => {
    const p = pontosDoNome(texto, x.nome);
    if (p > pontos) {
      melhor = x;
      pontos = p;
    }
  });
  return melhor;
}

const arred = (v: number) => Math.round(v * 10000) / 10000;

function enquadramentoDa(angulo: string, cena: string, comModelo: boolean, pessoa: boolean): string {
  if (angulo === "detalhe") return pessoa ? "close no rosto e nas mãos" : "fechado (detalhe)";
  if (pessoa) return comModelo && CENAS_DE_ESTUDIO.indexOf(cena) < 0 ? "corpo inteiro no ambiente" : "meio corpo";
  if (comModelo) return "aberto, produto em uso";
  if (angulo === "de_cima") return "médio, de cima";
  return CENAS_DE_ESTUDIO.indexOf(cena) >= 0 ? "médio, produto inteiro" : "aberto, produto no ambiente";
}

function lenteDo(enquadramento: string): string {
  if (/fechado|close/.test(enquadramento)) return "lente macro 100 mm, f/5.6, foco preciso";
  if (/aberto|inteiro/.test(enquadramento)) return "lente 35 mm, f/2.8, fundo levemente desfocado";
  return "lente 50 mm, f/4, nitidez em todo o assunto";
}

// ------------------------------------------------------------------ plano

/**
 * O plano do book a partir do pedido em palavras. Determinístico: o mesmo
 * texto e o mesmo contexto dão o mesmo plano.
 */
export function planoDoBook(pedido: string, ctx: ContextoDoPlano): PlanoDoBook {
  const texto = String(pedido || "").slice(0, 1500);
  const avisos: string[] = [];
  const produtos = (ctx.produtos || []).filter((p) => p && p.id && p.nome);
  const modelos = (ctx.modelos || []).filter((m) => m && m.id && m.nome);

  // Assunto: o escolhido na tela; senão o produto citado; senão o modelo citado; senão o primeiro.
  const produtoCitado = maisCitado(texto, produtos);
  const modeloCitado = maisCitado(texto, modelos);
  let assunto: AssuntoDoPlano | null = null;
  let modelo: ModeloDoPlano | null = null;
  const fixo = ctx.assuntoFixo || null;
  const fixoProduto = fixo && fixo.tipo === "produto" ? produtos.filter((p) => p.id === fixo.id)[0] || null : null;
  const fixoModelo = fixo && fixo.tipo !== "produto" ? modelos.filter((m) => m.id === fixo.id)[0] || null : null;
  let avisoDoAssunto: string | null | undefined = null;
  if (fixoProduto) {
    assunto = { tipo: "produto", id: fixoProduto.id, nome: fixoProduto.nome, citado: true };
    avisoDoAssunto = fixoProduto.aviso;
  } else if (fixoModelo) {
    assunto = { tipo: fixoModelo.tipo, id: fixoModelo.id, nome: fixoModelo.nome, citado: true };
    avisoDoAssunto = fixoModelo.aviso;
  } else if (produtoCitado) {
    assunto = { tipo: "produto", id: produtoCitado.id, nome: produtoCitado.nome, citado: true };
    avisoDoAssunto = produtoCitado.aviso;
  } else if (modeloCitado) {
    assunto = { tipo: modeloCitado.tipo, id: modeloCitado.id, nome: modeloCitado.nome, citado: true };
    avisoDoAssunto = modeloCitado.aviso;
  } else if (produtos.length) {
    assunto = { tipo: "produto", id: produtos[0].id, nome: produtos[0].nome, citado: false };
    avisoDoAssunto = produtos[0].aviso;
    avisos.push(`Nenhum produto citado: usei ${produtos[0].nome}. Troque se precisar.`);
  } else if (modelos.length) {
    assunto = { tipo: modelos[0].tipo, id: modelos[0].id, nome: modelos[0].nome, citado: false };
    avisoDoAssunto = modelos[0].aviso;
    avisos.push(`Nenhum produto ainda: o book sai do modelo ${modelos[0].nome}.`);
  } else {
    avisos.push("Sem produto nem modelo para o book. Identifique um produto em Fotos ou crie um modelo em Modelos.");
  }
  if (avisoDoAssunto) avisos.push(avisoDoAssunto);

  const pessoa = !!assunto && assunto.tipo !== "produto";
  const t = semAcento(texto);
  const pedeModelo = PEDE_MODELO.test(t) || (!!modeloCitado && !pessoa);
  if (assunto && assunto.tipo === "produto" && modeloCitado) {
    modelo = modeloCitado;
    avisos.push(`O book é do produto: ${modeloCitado.nome} entra descrito na cena, sem o rosto fiel. Para o rosto fiel, faça um book do modelo.`);
  }

  // Quantidade.
  const doTexto = quantidadeNoTexto(texto);
  const pedida = typeof ctx.quantidadeFixa === "number" && isFinite(ctx.quantidadeFixa) ? ctx.quantidadeFixa : doTexto;
  const quantidade = pedida === null ? QUANTIDADE_PADRAO : limitarQuantidadeDoBook(pedida);
  if (pedida !== null && pedida !== quantidade) avisos.push(`O book vai de ${QUANTIDADE_MINIMA} a ${QUANTIDADE_MAXIMA} fotos: ficou com ${quantidade}.`);

  // Ângulos, cenas e luzes pedidos (ou o padrão do book).
  const pedidos = { angulos: termosNoTexto(texto, ANGULOS), cenas: termosNoTexto(texto, CENAS), luzes: termosNoTexto(texto, LUZES) };
  const angulos = pedidos.angulos.length ? pedidos.angulos : pessoa ? ANGULOS_PADRAO_DA_PESSOA : ANGULOS_PADRAO;
  const cenas = pedidos.cenas.length ? pedidos.cenas : CENAS_PADRAO;
  const luzes = pedidos.luzes.length ? pedidos.luzes : LUZES_PADRAO;
  // Cena de ambiente para as fotos com modelo (a primeira fora do estúdio; senão casa).
  const ambientes = cenas.filter((c) => CENAS_DE_ESTUDIO.indexOf(c) < 0);
  const ambientesDoModelo = ambientes.length ? ambientes : ["casa"];

  const comModeloQtd = !assunto ? 0 : pessoa ? quantidade : pedeModelo ? Math.max(1, Math.ceil(quantidade / 3)) : 0;
  const semModeloQtd = quantidade - (pessoa ? 0 : comModeloQtd);

  const tomadas: TomadaDoPlano[] = [];
  const nome = assunto ? assunto.nome : "o produto";
  const quem = !assunto ? "o produto" : pessoa ? `a pessoa ${nome}` : `o produto ${nome}`;
  const usados: Record<string, boolean> = {};
  for (let i = 0; i < quantidade; i++) {
    const comModelo = pessoa || i >= semModeloQtd;
    const j = pessoa || !comModelo ? i : i - semModeloQtd;
    const angulo = comModelo && !pessoa ? (j % 2 === 0 ? "frente" : "tres_quartos") : angulos[j % angulos.length];
    let cena = comModelo && !pessoa ? ambientesDoModelo[j % ambientesDoModelo.length] : cenas[(j + Math.floor(j / angulos.length)) % cenas.length];
    let luz = luzes[(j + Math.floor(j / cenas.length)) % luzes.length];
    // Sem repetir a mesma combinação quando dá para variar.
    for (let k = 1; usados[`${comModelo}|${angulo}|${cena}|${luz}`] && k < cenas.length * luzes.length; k++) {
      cena = cenas[(j + k) % cenas.length];
      luz = luzes[(j + k + Math.floor(k / cenas.length)) % luzes.length];
    }
    usados[`${comModelo}|${angulo}|${cena}|${luz}`] = true;
    const a = porId(ANGULOS, angulo);
    const c = porId(CENAS, cena);
    const l = porId(LUZES, luz);
    const enquadramento = enquadramentoDa(angulo, cena, comModelo, pessoa);
    const titulo = i === 0 ? "Capa" : comModelo && !pessoa ? `Em uso, ${c.rotulo.toLowerCase()}` : `${a.rotulo}, ${c.rotulo.toLowerCase()}`;
    const partes = [
      `Foto ${i + 1} de ${quantidade} do book de ${nome}${i === 0 ? " (capa: a imagem que abre o book, assunto inteiro e claro)" : ""}.`,
      `Assunto: ${quem}, fiel às fotos de identidade.`,
      `Enquadramento: ${enquadramento}. Câmera: ${a.prompt}; ${lenteDo(enquadramento)}.`,
      `Cenário: ${c.prompt}.`,
      `Luz: ${l.prompt}.`,
    ];
    if (comModelo && !pessoa) {
      partes.push(
        modelo
          ? `Com modelo: uma pessoa adulta (modelo ${modelo.nome}) usa ${nome} com naturalidade; o produto em destaque, mãos com cinco dedos, rosto parcialmente fora de quadro.`
          : `Com modelo: uma pessoa adulta usa ${nome} com naturalidade; o produto em destaque, mãos com cinco dedos, rosto parcialmente fora de quadro.`,
      );
    }
    partes.push("Composição com respiro, props com função, paleta da marca; fotografia real, sem texto novo, sem escurecer a foto.");
    if (texto.trim()) partes.push(`Pedido do book: ${texto.trim().slice(0, 400)}`);
    tomadas.push({ id: `t${i + 1}`, titulo, angulo: a.rotulo, cena: c.rotulo, luz: l.rotulo, enquadramento, comModelo, prompt: partes.join(" ") });
  }

  const unidade = typeof ctx.custoPorFotoUsd === "number" && isFinite(ctx.custoPorFotoUsd) && ctx.custoPorFotoUsd >= 0 ? ctx.custoPorFotoUsd : null;
  return {
    assunto,
    modelo,
    quantidade,
    tomadas: assunto ? tomadas : [],
    custoTotalUsd: unidade === null || !assunto ? null : arred(quantidade * unidade),
    avisos,
    pedidos,
  };
}

/** Custo do plano já editado (tomadas tiradas não contam). */
export function custoDasTomadas(qtd: number, custoPorFotoUsd: number | null): number | null {
  return typeof custoPorFotoUsd === "number" && isFinite(custoPorFotoUsd) ? arred(Math.max(0, qtd) * custoPorFotoUsd) : null;
}
