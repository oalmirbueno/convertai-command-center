/**
 * Fiel ao pedido (frente AG, 28/09): o pedido da equipe é a fonte da verdade.
 *
 * Queixa do dono (28/09): "o estúdio de arte está meio alucinado, não faz o
 * que eu peço". Evidência (arte rápida 168142a5 da Stop Informática): o pedido
 * mandava "90% off, oferta por tempo limitado, algo bem agressivo, com selo" e
 * a direção escreveu o contrário ("não usar 90% OFF nem alegar urgência"); o
 * ajuste leu a imagem e pôs no texto combinado as letras da logo ("STOP
 * INFORMÁTICA") e a gravação do mouse ("CNT"), que a conferência passou a
 * cobrar e a autocorreção a escrever; e o ditado por voz virou texto na arte
 * ("pelo Lazada", um marketplace da Ásia, com selo inventado).
 *
 * Módulo puro (sem banco, sem IA, sem import de Deno): roda igual na função e
 * nos testes. Sem lookbehind, grupo nomeado nem \p{} (Safari 11 lê o mesmo tipo
 * de arquivo).
 * - fatosDoTexto / conferirTextoContraOPedido: conferência em código do texto
 *   da arte contra o pedido: fato (preço, percentual, data, hora, telefone,
 *   site, @, loja, promessa) que não está nas fontes confirmadas vira aviso de
 *   "inventado"; fato que o pedido pede e a arte não traz vira aviso de
 *   "faltou". Só aviso: nada é gerado de novo sozinho (sem laço).
 * - perguntaDaFidelidade / avisoDaFidelidade: a mesma conferência pelo Jev
 *   (Score), como nota de aviso para a equipe.
 * - textoDoAjusteFiel: o texto combinado depois de um ajuste não ganha letras
 *   da logo, nome da marca, letras lidas do produto nem fato inventado.
 * - blocosSemNomeDaMarca: bloco que é só o nome da marca sai (a marca aparece
 *   pela logo).
 * - perguntaDoAjusteClaro / duvidaDoAjuste: antes de pagar a imagem, o Jev
 *   (Choice) diz se o pedido de ajuste é claro; ruído de ditado, nome fora do
 *   contexto ou pedido vago viram UMA pergunta curta, sem gerar.
 * - ehConfirmacao: "sim", "isso", "pode seguir" respondem a pergunta pendente.
 */

// ------------------------------------------------------------------ utilidades

/** Minúsculas e sem acento (comparação). */
export function normalizar(s: unknown): string {
  return String(s == null ? "" : s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Palavras (letras e números) do texto, normalizadas. */
export function palavrasDe(s: unknown): string[] {
  return normalizar(s).match(/[a-z0-9]+/g) || [];
}

const PALAVRAS_VAZIAS: Record<string, true> = {
  a: true, o: true, e: true, as: true, os: true, um: true, uma: true, de: true, da: true, do: true, das: true, dos: true,
  na: true, no: true, nas: true, nos: true, em: true, por: true, para: true, pra: true, com: true, sem: true, ou: true,
  que: true, se: true, ao: true, aos: true, the: true, and: true, of: true,
};

/** Palavra que conta na comparação: número (qualquer tamanho) ou palavra de 3+ letras fora das vazias. */
function significativa(p: string): boolean {
  if (/^[0-9]+$/.test(p)) return true;
  return p.length >= 3 && !PALAVRAS_VAZIAS[p];
}

/** A palavra aparece nas conhecidas (igual, ou com o mesmo radical: "compre" e "compra", "oferta" e "ofertas"). */
function conhecida(p: string, conhecidas: Record<string, true>, lista: string[]): boolean {
  if (conhecidas[p]) return true;
  if (/^[0-9]+$/.test(p) || p.length < 4) return false;
  for (const c of lista) {
    if (c.length < 4 || /^[0-9]+$/.test(c)) continue;
    const menor = Math.min(c.length, p.length);
    let comum = 0;
    while (comum < menor && c.charAt(comum) === p.charAt(comum)) comum++;
    if (comum >= 4 && comum >= menor - 2) return true;
  }
  return false;
}

function conjunto(textos: unknown[]): { mapa: Record<string, true>; lista: string[] } {
  const mapa: Record<string, true> = {};
  for (const t of textos) for (const p of palavrasDe(t)) mapa[p] = true;
  return { mapa, lista: Object.keys(mapa) };
}

// ------------------------------------------------------------------ fatos

export type TipoDoFato = "preco" | "percentual" | "data" | "hora" | "telefone" | "site" | "perfil" | "loja" | "promessa";

export interface Fato {
  tipo: TipoDoFato;
  /** Chave de comparação (ex.: "preco:9,90", "percentual:90", "promessa:limitado"). */
  chave: string;
  /** Como apareceu no texto (para o aviso). */
  texto: string;
}

/** Lojas e marketplaces conhecidos: citar um que a marca não usa é o erro mais caro (o "Lazada" de 28/09). */
const LOJAS: { chave: string; re: RegExp }[] = [
  { chave: "lazada", re: /lazada/ },
  { chave: "shopee", re: /shopee/ },
  { chave: "amazon", re: /amazon/ },
  { chave: "mercado livre", re: /mercado ?livre/ },
  { chave: "magalu", re: /magalu|magazine luiza/ },
  { chave: "americanas", re: /americanas/ },
  { chave: "aliexpress", re: /aliexpress/ },
  { chave: "shein", re: /shein/ },
  { chave: "temu", re: /(^|[^a-z])temu([^a-z]|$)/ },
  { chave: "ifood", re: /ifood/ },
  { chave: "olx", re: /(^|[^a-z])olx([^a-z]|$)/ },
  { chave: "casas bahia", re: /casas bahia/ },
  { chave: "kabum", re: /kabum/ },
];

/** Promessas comerciais: só entram na arte se o pedido ou o contexto confirmado disserem. */
const PROMESSAS: { chave: string; rotulo: string; re: RegExp }[] = [
  { chave: "limitado", rotulo: "tempo ou estoque limitado", re: /tempo limitado|oferta limitada|por tempo limitado|limitad[oa]s?|so hoje|somente hoje|apenas hoje|ultimas unidades|ultimos dias|ultima chance|acaba hoje|enquanto durar|estoque/ },
  { chave: "gratis", rotulo: "grátis", re: /gratis|de graca|gratuit[oa]s?/ },
  { chave: "frete", rotulo: "frete", re: /frete/ },
  { chave: "desconto", rotulo: "desconto", re: /desconto|(^|[^a-z])off([^a-z]|$)|abaixo do preco|preco de custo|queima/ },
  { chave: "parcelamento", rotulo: "parcelamento", re: /parcel|sem juros|[0-9]+ ?x ?(de|sem)/ },
  { chave: "garantia", rotulo: "garantia", re: /garantia/ },
  { chave: "brinde", rotulo: "brinde", re: /brinde|ganhe|leve [0-9]+|compre [0-9]+/ },
  { chave: "entrega", rotulo: "entrega", re: /entrega (gratis|rapida|no mesmo dia|hoje|em [0-9])|delivery/ },
];

function rotuloDaPromessa(chave: string): string {
  const p = PROMESSAS.filter((x) => `promessa:${x.chave}` === chave)[0];
  return p ? p.rotulo : chave.replace(/^promessa:/, "");
}

/** Negação logo antes ("sem", "não", "nada de", "tira"): o pedido quer o contrário. */
function negado(texto: string, indice: number): boolean {
  let antes = texto.slice(Math.max(0, indice - 30), indice);
  // Só a mesma oração: "tira o preço e põe 90% off" nega o preço, não o 90%.
  const corte = Math.max(antes.lastIndexOf(","), antes.lastIndexOf("."), antes.lastIndexOf(";"), antes.lastIndexOf("\n"), antes.lastIndexOf(" e "), antes.lastIndexOf(" mas "));
  if (corte >= 0) antes = antes.slice(corte + 1);
  return /(^|[^a-z])(sem|nao|nada de|nunca|tira|tirar|tire|remova|remover|apaga|apague|evite|evitar)([^a-z]|$)/.test(antes);
}

function digitos(s: string): string {
  return s.replace(/[^0-9,]/g, "").replace(/,$/, "");
}

/**
 * Fatos do texto (preço, percentual, data, hora, telefone, site, @, loja,
 * promessa). `respeitarNegacao`: no pedido, "sem preço" ou "tira o frete" não
 * contam como fato pedido.
 */
export function fatosDoTexto(texto: unknown, respeitarNegacao = false): Fato[] {
  const bruto = String(texto == null ? "" : texto);
  const t = normalizar(bruto);
  const saida: Fato[] = [];
  const vistos: Record<string, true> = {};
  const por = (tipo: TipoDoFato, chave: string, trecho: string, indice: number) => {
    if (respeitarNegacao && negado(t, indice)) return;
    const k = `${tipo}:${chave}`;
    if (vistos[k]) return;
    vistos[k] = true;
    saida.push({ tipo, chave: k, texto: trecho.trim() });
  };
  const varrer = (re: RegExp, f: (m: RegExpExecArray) => void) => {
    const g = new RegExp(re.source, re.flags.indexOf("g") >= 0 ? re.flags : `${re.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = g.exec(t)) !== null) {
      f(m);
      if (m.index === g.lastIndex) g.lastIndex++;
    }
  };
  // Preço: "R$ 9,90", "R$9", "9,90 reais", "por 19,90".
  varrer(/r\$ ?[0-9]{1,3}([. ][0-9]{3})*(,[0-9]{1,2})?|[0-9]+,[0-9]{2} ?reais|[0-9]+ reais/, (m) => {
    const d = digitos(m[0].replace(/([0-9])[. ]([0-9]{3})/g, "$1$2"));
    if (d) por("preco", d.indexOf(",") < 0 ? `${d},00` : d.split(",")[1].length === 1 ? `${d}0` : d, m[0], m.index);
  });
  varrer(/[0-9]{1,3} ?(%|por ?cento)/, (m) => por("percentual", digitos(m[0]), m[0], m.index));
  varrer(/(^|[^0-9])([0-3]?[0-9])\/([01]?[0-9])(\/[0-9]{2,4})?([^0-9]|$)/, (m) => {
    const dia = String(Number(m[2]));
    const mes = String(Number(m[3]));
    if (Number(dia) >= 1 && Number(dia) <= 31 && Number(mes) >= 1 && Number(mes) <= 12) por("data", `${dia}/${mes}`, `${m[2]}/${m[3]}`, m.index);
  });
  varrer(/(^|[^0-9])([0-2]?[0-9]) ?(h|:)([0-5][0-9])?([^a-z0-9]|$)/, (m) => {
    const h = Number(m[2]);
    if (h <= 23 && (m[3] === ":" ? !!m[4] : true)) por("hora", `${h}:${m[4] || "00"}`, `${m[2]}${m[3]}${m[4] || ""}`, m.index);
  });
  varrer(/\(?[0-9]{2}\)? ?9?[0-9]{4}[- ]?[0-9]{4}/, (m) => {
    const d = m[0].replace(/[^0-9]/g, "");
    if (d.length >= 10) por("telefone", d.slice(-8), m[0], m.index);
  });
  varrer(/(www\.)?[a-z0-9-]+\.(com\.br|com|net|org|online|app|site|store|br)([^a-z]|$)/, (m) => por("site", m[0].replace(/^www\./, "").replace(/[^a-z0-9.-]+$/, ""), m[0], m.index));
  varrer(/@[a-z0-9_.]{3,}/, (m) => por("perfil", m[0].replace(/\.+$/, ""), m[0], m.index));
  for (const l of LOJAS) varrer(l.re, (m) => por("loja", l.chave, m[0], m.index));
  for (const p of PROMESSAS) varrer(p.re, (m) => por("promessa", p.chave, m[0], m.index));
  return saida;
}

export interface FontesDoPedido {
  /** O pedido da equipe (texto do dono, do ditado ou digitado). */
  pedido: string;
  /** Contexto confirmado: textos dos arquivos do pedido, briefing da campanha, marca (nome, contato). */
  confirmados?: string[];
}

export interface TextoDaLaminaParaConferir {
  ordem: number;
  texto: string;
}

export interface ConferenciaDoPedido {
  /** Fato na arte que não está no pedido nem no contexto confirmado. */
  inventados: { ordem: number; fato: Fato }[];
  /** Fato que o pedido pede e a arte não traz. */
  faltando: Fato[];
  /** Os avisos em português, prontos para a tela. */
  avisos: string[];
}

const ROTULO_DO_TIPO: Record<TipoDoFato, string> = {
  preco: "preço",
  percentual: "percentual",
  data: "data",
  hora: "horário",
  telefone: "telefone",
  site: "site",
  perfil: "perfil",
  loja: "loja",
  promessa: "promessa",
};

/** Tipos que o pedido pede e a arte tem de trazer (telefone, site e @ podem ficar na legenda). */
const TIPOS_QUE_A_ARTE_TRAZ: TipoDoFato[] = ["preco", "percentual", "data", "hora", "promessa"];

/**
 * Conferência do texto da arte contra o pedido, em código. Só aviso: a equipe
 * decide (sem laço de correção). Um fato do pedido já está na arte se a mesma
 * chave aparece em qualquer lâmina.
 */
export function conferirTextoContraOPedido(textos: TextoDaLaminaParaConferir[], fontes: FontesDoPedido): ConferenciaDoPedido {
  const doPedido = fatosDoTexto(fontes.pedido, true);
  const confirmadas: Record<string, true> = {};
  for (const f of fatosDoTexto(fontes.pedido)) confirmadas[f.chave] = true;
  for (const c of fontes.confirmados || []) for (const f of fatosDoTexto(c)) confirmadas[f.chave] = true;
  const naArte: Record<string, true> = {};
  const inventados: { ordem: number; fato: Fato }[] = [];
  for (const l of textos) {
    for (const f of fatosDoTexto(l.texto)) {
      naArte[f.chave] = true;
      if (!confirmadas[f.chave]) inventados.push({ ordem: l.ordem, fato: f });
    }
  }
  let faltando = doPedido.filter((f) => TIPOS_QUE_A_ARTE_TRAZ.indexOf(f.tipo) >= 0 && !naArte[f.chave]);
  // "90% off": o percentual que falta já diz o desconto (um aviso só).
  if (faltando.some((f) => f.tipo === "percentual")) faltando = faltando.filter((f) => f.chave !== "promessa:desconto");
  const avisos: string[] = [];
  const varias = textos.length > 1;
  const comoFica = (f: Fato) => (f.tipo === "promessa" ? rotuloDaPromessa(f.chave) : f.texto.replace(/[\s,.;:!?]+$/, "").replace(/^r\$/i, "R$"));
  for (const i of inventados) {
    avisos.push(`A arte${varias ? ` (lâmina ${i.ordem})` : ""} traz "${comoFica(i.fato)}" (${ROTULO_DO_TIPO[i.fato.tipo]}), que não está no pedido nem no contexto confirmado. Confira antes de gerar.`);
  }
  for (const f of faltando) {
    avisos.push(`O pedido pede ${f.tipo === "promessa" ? comoFica(f) : `"${comoFica(f)}"`} e o texto da arte não traz. Confira antes de gerar.`);
  }
  return { inventados, faltando, avisos: avisos.slice(0, 8) };
}

// ------------------------------------------------------------------ texto do ajuste

/** Palavras significativas do nome da marca ("Stop Informática" -> stop, informatica). */
export function palavrasDaMarca(nomes: (string | null | undefined)[]): string[] {
  const saida: string[] = [];
  for (const n of nomes) for (const p of palavrasDe(n)) if (significativa(p) && saida.indexOf(p) < 0) saida.push(p);
  return saida;
}

/** A linha (ou bloco) é só o nome da marca: todas as palavras significativas são da marca. */
export function ehSoNomeDaMarca(linha: string, marca: string[]): boolean {
  if (!marca.length) return false;
  const ps = palavrasDe(linha).filter(significativa);
  return ps.length > 0 && ps.every((p) => marca.indexOf(p) >= 0);
}

/**
 * O texto combinado depois de um ajuste, sem o que o modelo de leitura trouxe
 * da imagem e o pedido não mandou escrever:
 * - linha que é só o nome da marca (as letras da logo);
 * - linha curta (até 2 palavras) toda de palavras que não estão no texto
 *   atual nem no pedido (letras lidas do produto, como "CNT");
 * - linha com fato (preço, loja, promessa...) que não está no texto atual, no
 *   pedido nem no contexto confirmado.
 * Reescrita criativa pedida ("chamada mais forte") passa. Sem nada que sobre,
 * fica o texto atual.
 */
export function textoDoAjusteFiel(
  atual: string,
  proposto: string,
  pedido: string,
  marca: string[],
  confirmados: string[] = [],
): { texto: string; removidas: string[] } {
  const base = conjunto([atual, pedido]);
  const fontes: Record<string, true> = {};
  for (const t of [atual, pedido].concat(confirmados)) for (const f of fatosDoTexto(t)) fontes[f.chave] = true;
  const removidas: string[] = [];
  const linhas = String(proposto || "").replace(/\r\n/g, "\n").split("\n");
  const ficam: string[] = [];
  for (const linha of linhas) {
    const limpa = linha.trim();
    if (!limpa) {
      ficam.push("");
      continue;
    }
    const ps = palavrasDe(limpa).filter(significativa);
    const soMarca = ehSoNomeDaMarca(limpa, marca);
    const estranhas = ps.filter((p) => !conhecida(p, base.mapa, base.lista) && marca.indexOf(p) < 0);
    const letrasDoProduto = ps.length > 0 && ps.length <= 2 && estranhas.length === ps.length;
    const fatoNovo = fatosDoTexto(limpa).some((f) => !fontes[f.chave]);
    if (soMarca || letrasDoProduto || fatoNovo) {
      removidas.push(limpa);
      continue;
    }
    ficam.push(linha.replace(/\s+$/, ""));
  }
  const texto = ficam.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!texto) return { texto: String(atual || "").trim(), removidas };
  return { texto, removidas };
}

/**
 * Blocos da lâmina sem os que são só o nome da marca (a marca aparece pela
 * logo). A headline nunca sai por esta regra, e a lâmina nunca fica sem bloco.
 */
export function blocosSemNomeDaMarca<B extends { papel?: string; texto: string }>(blocos: B[], marca: string[]): { blocos: B[]; removidos: string[] } {
  if (!marca.length || blocos.length < 2) return { blocos, removidos: [] };
  const removidos: string[] = [];
  const ficam = blocos.filter((b) => {
    if (b.papel === "headline" || !ehSoNomeDaMarca(b.texto, marca)) return true;
    removidos.push(b.texto);
    return false;
  });
  return ficam.length ? { blocos: ficam, removidos } : { blocos, removidos: [] };
}

// ------------------------------------------------------------------ Jev

/** Pergunta do Jev (mesma forma de _shared/jev.ts, sem importar Deno). */
export interface PerguntaDoJev {
  type: "choice" | "score" | "noul";
  instructions: unknown;
  criteria?: unknown;
}

export const NIVEIS_DA_FIDELIDADE = [
  "Contraria o pedido: o texto deixa de fora ou troca o que o pedido mandou pôr (desconto, percentual, preço, prazo, produto, selo) ou diz o oposto do pedido.",
  "Inventa: o texto acrescenta preço, desconto, prazo, produto, loja, data ou promessa que não está no pedido nem no contexto confirmado.",
  "Atende em parte: o principal do pedido está no texto, mas falta um pedido secundário ou sobra uma frase que o pedido não pediu (sem fato novo).",
  "Fiel: o texto traz tudo o que o pedido mandou pôr, sem acrescentar fato, com liberdade só de redação.",
];

/**
 * Score do Jev: o texto da arte é fiel ao pedido? `state`: { pedido,
 * contexto_confirmado, texto_da_arte: [{ lamina, texto }] }.
 */
export function perguntaDaFidelidade(): PerguntaDoJev {
  return {
    type: "score",
    instructions:
      "A equipe de uma agência pediu uma arte para as redes sociais de um cliente (o pedido está em `pedido`, às vezes ditado por voz). O diretor de arte escreveu o texto que vai escrito na arte (`texto_da_arte`). O que está em `contexto_confirmado` (campanha escolhida, arquivos do pedido, marca) também vale como fonte. Quão fiel ao pedido é o texto da arte?",
    criteria: NIVEIS_DA_FIDELIDADE.slice(),
  };
}

export function estadoDaFidelidade(pedido: string, confirmados: string[], textos: TextoDaLaminaParaConferir[]): Record<string, unknown> {
  return {
    pedido: String(pedido || "").slice(0, 3000),
    contexto_confirmado: confirmados.map((c) => String(c || "").slice(0, 800)).filter(Boolean).slice(0, 6),
    texto_da_arte: textos.map((t) => ({ lamina: t.ordem, texto: t.texto })),
  };
}

/** Nota abaixo disto (escala 0 a 3) vira aviso para a equipe. */
export const NOTA_MINIMA_DA_FIDELIDADE = 2;

/** O aviso da nota do Jev (ou null quando está fiel). Nunca dispara nova geração. */
export function avisoDaFidelidade(r: { score?: number; confidence?: number } | null | undefined): string | null {
  if (!r || typeof r.score !== "number" || !isFinite(r.score)) return null;
  if (r.score >= NOTA_MINIMA_DA_FIDELIDADE) return null;
  const nivel = Math.max(0, Math.min(NIVEIS_DA_FIDELIDADE.length - 1, Math.round(r.score)));
  const motivo = nivel === 0 ? "parece contrariar ou deixar de fora o que o pedido mandou" : nivel === 1 ? "parece acrescentar fato que o pedido não deu" : "atende o pedido só em parte";
  return `Conferência do Jev (nota ${Math.round(r.score * 10) / 10} de 3): o texto da arte ${motivo}. Confira o texto antes de gerar.`;
}

export type LeituraDoAjuste = "claro" | "ruido_de_ditado" | "nome_fora_do_contexto" | "vago";

/**
 * Choice do Jev: o pedido de ajuste é claro? `state`: { pedido, texto_atual,
 * marca, campanha }. O pedido costuma vir do ditado por voz.
 */
export function perguntaDoAjusteClaro(): PerguntaDoJev {
  return {
    type: "choice",
    instructions:
      "A pessoa da equipe pediu um ajuste numa arte já pronta (o pedido está em `pedido`, muitas vezes ditado por voz). O texto que está hoje na arte está em `texto_atual`; a marca e a campanha estão em `marca` e `campanha`. Dá para fazer o ajuste exatamente, sem adivinhar?",
    criteria: {
      claro: {
        what: "Claro: dá para saber exatamente o que muda (posição, cor, tamanho, texto, foto) e todo nome citado está na arte, na marca ou na campanha.",
        examples: ["tira o preço", "troca a cor do título para o verde da marca", "coloque a logo embaixo centralizada", "deixa o selo menor", "sobe um pouco o texto", "deixa mais minimalista, com menos elementos", "mais elegante e com mais respiro"],
      },
      ruido_de_ditado: {
        what: "Tem palavra que não faz sentido nesta arte e parece erro do ditado por voz, e o que ela muda não dá para adivinhar com segurança.",
        examples: ["você também não usou o select", "o label desktop não ficou no centro", "corri isso daí"],
      },
      nome_fora_do_contexto: {
        what: "Manda escrever ou pôr na arte um nome de loja, site, marketplace, marca, produto ou pessoa que não aparece em `texto_atual`, `marca` nem `campanha`.",
        examples: ["alinhe 'ou compre agora pelo Lazada'", "coloca o selo da Shopee", "põe o site lojaxyz.com"],
      },
      vago: {
        what: "Não diz o que mudar nem em que direção: só pede para melhorar ou reclama, sem apontar estilo, posição, cor, tamanho ou texto. Pedido de estilo (mais minimalista, mais elegante, mais limpo, mais ousado) NÃO é vago.",
        examples: ["melhore", "não gostei, faz de novo", "ficou ruim"],
      },
    },
  };
}

/** Confiança mínima para o Jev segurar o ajuste com uma pergunta (abaixo disso, o ajuste segue). */
export const CONFIANCA_DA_DUVIDA = 0.6;

/**
 * A pergunta curta do ajuste, ou null para seguir. A pergunta do modelo de
 * leitura vale primeiro; sem ela, o Jev com confiança segura com uma pergunta
 * montada do que foi entendido.
 */
export function duvidaDoAjuste(
  jev: { choice?: string; confidence?: number } | null | undefined,
  leitura: { pergunta?: string | null; entendi?: string | null },
): { pergunta: string; motivo: LeituraDoAjuste | "leitura" } | null {
  const pergunta = String((leitura && leitura.pergunta) || "").trim();
  if (pergunta) return { pergunta: pergunta.slice(0, 400), motivo: "leitura" };
  if (!jev || !jev.choice || jev.choice === "claro") return null;
  const c = typeof jev.confidence === "number" && isFinite(jev.confidence) ? jev.confidence : 0;
  if (c < CONFIANCA_DA_DUVIDA) return null;
  const entendi = String((leitura && leitura.entendi) || "").trim().replace(/[.\s]+$/, "");
  const comoEntendi = entendi ? ` Entendi assim: ${entendi}.` : "";
  if (jev.choice === "ruido_de_ditado") return { pergunta: `Algumas palavras parecem ter saído trocadas no ditado.${comoEntendi} É isso?`, motivo: "ruido_de_ditado" };
  if (jev.choice === "nome_fora_do_contexto") return { pergunta: `O pedido cita um nome que não aparece na arte, na marca nem na campanha.${comoEntendi} Confirma que é isso mesmo?`, motivo: "nome_fora_do_contexto" };
  if (jev.choice === "vago") return { pergunta: `O que exatamente você quer que mude nesta lâmina?${comoEntendi}`, motivo: "vago" };
  return null;
}

/** Resposta curta que confirma a pergunta pendente do ajuste ("sim", "isso", "pode seguir"). */
export function ehConfirmacao(pedido: string): boolean {
  const p = normalizar(pedido).replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!p || p.split(" ").length > 6) return false;
  return /^(sim|isso|isso mesmo|exato|exatamente|confirmo|confirmado|pode|pode seguir|pode fazer|pode ir|segue|siga|ok|okay|beleza|certo|esta certo|ta certo|e isso|isso ai|correto|manda ver)( (sim|mesmo|pode|isso|seguir|fazer|ai|obrigado))*$/.test(p);
}

/** Pergunta pendente do ajuste, guardada na direção até a resposta (30 minutos). */
export interface DuvidaGuardada {
  ordem: number;
  pedido: string;
  pergunta: string;
  em: string;
}

export const VALIDADE_DA_DUVIDA_MS = 30 * 60 * 1000;

/**
 * O pedido que vale neste ajuste: a resposta "sim" a uma pergunta pendente da
 * mesma lâmina retoma o pedido de antes, já confirmado; o mesmo pedido mandado
 * de novo também conta como confirmação (a equipe insistiu).
 */
export function pedidoConfirmado(
  pedido: string,
  ordem: number,
  guardada: DuvidaGuardada | null | undefined,
  agora = Date.now(),
): { pedido: string; confirmado: boolean } {
  if (!guardada || guardada.ordem !== ordem) return { pedido, confirmado: false };
  const quando = Date.parse(guardada.em);
  if (!isFinite(quando) || agora - quando > VALIDADE_DA_DUVIDA_MS) return { pedido, confirmado: false };
  if (ehConfirmacao(pedido)) return { pedido: guardada.pedido, confirmado: true };
  if (normalizar(pedido).replace(/\s+/g, " ").trim() === normalizar(guardada.pedido).replace(/\s+/g, " ").trim()) return { pedido, confirmado: true };
  return { pedido, confirmado: false };
}
