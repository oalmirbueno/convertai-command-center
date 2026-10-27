/**
 * Regras puras da foto gerada no Estúdio da pauta (27/10/2026, pedido do
 * dono: "gerar a foto com base no contexto, escolher o estilo e colocar
 * referências, fotos de antes e depois etc."). Sem banco e sem IA: a ação
 * (foto-da-pauta.ts) lê o acervo, o contexto e o estilo e chama o gerador com
 * o prompt montado aqui. Os testes da tela importam este arquivo.
 *
 * Cada referência chega com um PAPEL marcado pela equipe:
 * - antes / depois: fotos reais de transformação. Com os dois, a foto é uma
 *   comparação fiel (mesma câmera, mesma luz) e nada é melhorado ou inventado;
 * - produto: identidade invariante do produto;
 * - cenario: o lugar real da foto;
 * - estilo: só paleta, luz, enquadramento e clima.
 */

export const PAPEIS_DA_REFERENCIA = ["antes", "depois", "produto", "cenario", "estilo"] as const;
export type PapelDaReferencia = typeof PAPEIS_DA_REFERENCIA[number];

/** Limite de imagens de entrada desta ação (as do estilo da biblioteca contam junto). */
export const MAX_REFERENCIAS_DA_PAUTA = 6;
export const MAX_PEDIDO_DA_PAUTA = 3000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ReferenciaComPapel {
  imagem_id: string;
  papel: PapelDaReferencia;
}

export class ErroDaFotoDaPauta extends Error {
  constructor(public status: number, public codigo: string, mensagem: string) {
    super(mensagem);
  }
}

const limpar = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
/** O gerador não recebe travessão (regra da casa nos prompts). */
const semTravessao = (t: string) => t.replace(/\s*[—–]\s*/g, ", ");

/** Lê a lista da tela: ids válidos, papel conhecido, sem repetir a mesma foto. */
export function lerReferenciasComPapel(v: unknown): ReferenciaComPapel[] {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new ErroDaFotoDaPauta(400, "referencias_invalidas", "As referências precisam vir em lista.");
  const vistas = new Set<string>();
  const saida: ReferenciaComPapel[] = [];
  for (const bruto of v) {
    const r = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
    const id = String(r.imagem_id ?? "").trim();
    const papel = String(r.papel ?? "").trim() as PapelDaReferencia;
    if (!UUID.test(id)) throw new ErroDaFotoDaPauta(400, "referencia_invalida", "Há uma referência sem foto do acervo.");
    if (!PAPEIS_DA_REFERENCIA.includes(papel)) throw new ErroDaFotoDaPauta(400, "papel_invalido", `Papel da referência inválido. Use: ${PAPEIS_DA_REFERENCIA.join(", ")}.`);
    if (vistas.has(id)) continue;
    vistas.add(id);
    saida.push({ imagem_id: id, papel });
  }
  if (saida.length > MAX_REFERENCIAS_DA_PAUTA) {
    throw new ErroDaFotoDaPauta(400, "referencias_demais", `Use no máximo ${MAX_REFERENCIAS_DA_PAUTA} referências por foto.`);
  }
  return saida;
}

/** Ordem em que as imagens vão ao gerador: transformação primeiro (é o assunto), depois produto, lugar e estilo. */
const ORDEM: Record<PapelDaReferencia, number> = { antes: 0, depois: 1, produto: 2, cenario: 3, estilo: 4 };

export function ordenarReferencias<T extends { papel: PapelDaReferencia }>(refs: T[]): T[] {
  return refs.map((r, i) => ({ r, i })).sort((a, b) => ORDEM[a.r.papel] - ORDEM[b.r.papel] || a.i - b.i).map((x) => x.r);
}

/** Pares de antes e depois na ordem em que foram marcados (o 1º antes com o 1º depois). */
export function paresDeTransformacao<T extends { papel: PapelDaReferencia }>(refs: T[]): { antes: number; depois: number }[] {
  const antes = refs.map((r, i) => (r.papel === "antes" ? i : -1)).filter((i) => i >= 0);
  const depois = refs.map((r, i) => (r.papel === "depois" ? i : -1)).filter((i) => i >= 0);
  return antes.slice(0, depois.length).map((a, k) => ({ antes: a, depois: depois[k] }));
}

/**
 * Foto real intacta (27/10/2026, dono: "não é fazer por cima da foto; usar de forma fiel as imagens no gerador e
 * não gerar por cima, isso não pode acontecer"). O gerador redesenha tudo que recebe, então foto real de antes,
 * depois ou do lugar NUNCA vai para ele:
 * - antes + depois: a comparação é montada no código com os pixels das duas fotos (montagem-antes-depois.ts);
 * - antes, depois ou lugar sem par: a foto entra no post como está;
 * - só produto e/ou estilo (ou nenhuma referência): aí sim o gerador cria a cena nova.
 */
export type CaminhoDaFotoDaPauta =
  | { tipo: "montagem"; par: { antes: number; depois: number }; pares: number }
  | { tipo: "real_como_esta"; indices: number[] }
  | { tipo: "gerar" };

export const PAPEIS_DE_FOTO_REAL: readonly PapelDaReferencia[] = ["antes", "depois", "cenario"];

export function caminhoDaFotoDaPauta<T extends { papel: PapelDaReferencia }>(refs: T[], atual = 1): CaminhoDaFotoDaPauta {
  const pares = paresDeTransformacao(refs);
  if (pares.length) return { tipo: "montagem", par: pares[(Math.max(1, Math.floor(atual)) - 1) % pares.length], pares: pares.length };
  const reais = refs.map((r, i) => (PAPEIS_DE_FOTO_REAL.includes(r.papel) ? i : -1)).filter((i) => i >= 0);
  if (reais.length) return { tipo: "real_como_esta", indices: reais };
  return { tipo: "gerar" };
}

/** Caixas da montagem de antes e depois. */
export interface Caixa { x: number; y: number; largura: number; altura: number }

/** Retrato (4:5, 9:16): antes em cima, depois embaixo. Quadrado e paisagem: lado a lado. Fresta clara entre as duas. */
export function layoutDoAntesEDepois(largura: number, altura: number, fresta = 8): { antes: Caixa; depois: Caixa } {
  if (altura > largura) {
    const a = Math.floor((altura - fresta) / 2);
    return { antes: { x: 0, y: 0, largura, altura: a }, depois: { x: 0, y: a + fresta, largura, altura: altura - a - fresta } };
  }
  const l = Math.floor((largura - fresta) / 2);
  return { antes: { x: 0, y: 0, largura: l, altura }, depois: { x: l + fresta, y: 0, largura: largura - l - fresta, altura } };
}

export const MENSAGEM_DA_FOTO_REAL =
  "Foto real não passa pelo gerador: ele redesenha a imagem. Marque antes e depois para montar a comparação com as fotos reais, ou use a foto como está no post.";

export interface ContextoDaFotoDaPauta {
  cliente: string | null;
  nicho: string | null;
  estiloDaMarca: string | null;
  paleta: string[];
  campanha: string | null;
  /** O que o cliente já ensinou (cérebro), curto. */
  ensinado: string | null;
}

/** O pedaço do contexto do cliente que cabe num prompt de imagem (sem LLM, sem custo). */
export function contextoParaFoto(dados: Record<string, unknown> | null | undefined, cliente?: string | null): ContextoDaFotoDaPauta {
  const d = dados && typeof dados === "object" ? dados : {};
  const marca = (d.marca && typeof d.marca === "object" ? d.marca : {}) as Record<string, unknown>;
  const paleta = (Array.isArray(marca.paleta) ? marca.paleta : [])
    .map((p) => (p && typeof p === "object" ? String((p as Record<string, unknown>).hex ?? "") : String(p ?? "")))
    .filter((h) => /^#[0-9a-f]{3,8}$/i.test(h))
    .map((h) => h.toUpperCase())
    .slice(0, 5);
  const campanhaDe = (v: unknown) => (v && typeof v === "object" ? limpar((v as Record<string, unknown>).nome, 120) : "");
  const estilo = typeof marca.estilo === "string" ? marca.estilo : marca.estilo && typeof marca.estilo === "object" ? JSON.stringify(marca.estilo) : "";
  return {
    cliente: limpar(cliente ?? d.cliente, 120) || null,
    nicho: limpar(d.nicho, 160) || null,
    estiloDaMarca: limpar(estilo, 400) || null,
    paleta,
    campanha: campanhaDe(d.campanha_escolhida) || campanhaDe(d.campanha_do_mes) || null,
    ensinado: limpar(d.cerebro_do_cliente, 600) || null,
  };
}

export interface PedidoDaFotoDaPauta {
  /** Direção da pauta mais o que a equipe escreveu. */
  pedido: string;
  titulo?: string | null;
  /** Referências já na ordem do gerador (Imagem 1, 2, ...). */
  referencias: { papel: PapelDaReferencia; nome?: string | null }[];
  /** Texto do estilo escolhido (prompt da biblioteca ou direção livre). */
  estiloTexto?: string | null;
  /** Imagens de estilo da biblioteca, que vão DEPOIS das referências. */
  estilosDaBiblioteca?: number;
  contexto?: ContextoDaFotoDaPauta | null;
  formato?: string | null;
  /** Foto N de M (série da pauta). */
  posicao?: { atual: number; total: number } | null;
}

const faixa = (indices: number[]) => (indices.length === 1 ? `Imagem ${indices[0] + 1}` : `Imagens ${indices.map((i) => i + 1).join(", ")}`);

/**
 * O prompt da foto da pauta. Pura: o mesmo pedido dá o mesmo texto.
 * Antes e depois juntos viram uma comparação fiel; só um dos dois vale como
 * retrato fiel daquele estado. O resto segue as regras do Canvas.
 */
export function promptDaFotoDaPauta(p: PedidoDaFotoDaPauta): string {
  const linhas: string[] = [];
  const refs = p.referencias;
  const indicesDe = (papel: PapelDaReferencia) => refs.map((r, i) => (r.papel === papel ? i : -1)).filter((i) => i >= 0);
  linhas.push(`FOTOGRAFIA PUBLICITÁRIA REALISTA para o post "${limpar(p.titulo, 140) || "pauta do mês"}"${p.formato ? `, formato ${p.formato}` : ""}.`);
  const pedido = limpar(p.pedido, MAX_PEDIDO_DA_PAUTA);
  if (pedido) linhas.push(`O QUE A FOTO MOSTRA: ${pedido}`);

  const pares = paresDeTransformacao(refs);
  const emPar = new Set(pares.flatMap((x) => [x.antes, x.depois]));
  if (pares.length) {
    for (const par of pares) {
      linhas.push(
        `TRANSFORMAÇÃO (antes e depois reais): a Imagem ${par.antes + 1} é o ANTES e a Imagem ${par.depois + 1} é o DEPOIS. Monte UMA foto de comparação dividida em duas metades, o antes à esquerda e o depois à direita (no formato vertical, o antes em cima e o depois embaixo), com o mesmo enquadramento, a mesma distância, a mesma luz e a mesma escala nos dois lados. Cada metade mostra fielmente a sua imagem: não melhore o antes, não exagere nem invente o resultado do depois, não mude o lugar, a pessoa nem o objeto.`,
      );
    }
    linhas.push("Sem texto, setas, rótulos ou números na imagem: os dizeres entram depois, pelo Estúdio de artes, se a equipe pedir.");
  }
  const antesSoltos = indicesDe("antes").filter((i) => !emPar.has(i));
  const depoisSoltos = indicesDe("depois").filter((i) => !emPar.has(i));
  if (antesSoltos.length) linhas.push(`${faixa(antesSoltos)}: ESTADO ANTES (real): mostre exatamente esta situação de partida, fiel ao lugar e aos detalhes; não mostre um resultado que não foi fotografado.`);
  if (depoisSoltos.length) linhas.push(`${faixa(depoisSoltos)}: RESULTADO REAL (depois): mostre este resultado fiel, sem exagerar nem embelezar além do que a foto mostra.`);

  const produtos = indicesDe("produto");
  if (produtos.length) linhas.push(`${faixa(produtos)}: O PRODUTO (identidade invariante): não mude formato, silhueta, proporções, cor, acabamento, logotipo nem texto do rótulo; mesma quantidade de peças; escala real.`);
  const cenarios = indicesDe("cenario");
  if (cenarios.length) linhas.push(`${faixa(cenarios)}: O LUGAR REAL: use este ambiente como o cenário (mesma arquitetura, móveis, cores e luz do lugar), ambientado e realista; não copie pessoas, marcas nem textos da foto.`);
  const estilos = indicesDe("estilo");
  const daBiblioteca = Math.max(0, Math.floor(p.estilosDaBiblioteca || 0));
  const todosOsEstilos = estilos.concat(Array.from({ length: daBiblioteca }, (_, k) => refs.length + k));
  if (todosOsEstilos.length) linhas.push(`${faixa(todosOsEstilos)}: SÓ ESTILO (paleta, luz, enquadramento e clima); não copie objetos, pessoas, marcas nem textos destas imagens.`);
  const estiloTexto = limpar(p.estiloTexto, 1500);
  if (estiloTexto) linhas.push(`ESTILO VISUAL ESCOLHIDO: ${estiloTexto} Este estilo não muda o que as referências fixam.`);

  const c = p.contexto;
  if (c) {
    const partes = [
      c.cliente && `marca ${c.cliente}`,
      c.nicho && `segmento ${c.nicho}`,
      c.estiloDaMarca && `cara da marca: ${c.estiloDaMarca}`,
      c.campanha && `no clima da campanha ${c.campanha}`,
    ].filter(Boolean);
    if (partes.length) linhas.push(`CONTEXTO DO CLIENTE: ${partes.join("; ")}.`);
    if (c.paleta.length) linhas.push(`MARCA: paleta de apoio ${c.paleta.join(", ")} como acento num objeto de cena ou detalhe do cenário, nunca tingindo a foto inteira nem o produto.`);
    if (c.ensinado) linhas.push(`O QUE O CLIENTE JÁ ENSINOU (respeite): ${c.ensinado}`);
  }
  if (p.posicao && p.posicao.total > 1) {
    linhas.push(`SÉRIE: esta é a foto ${p.posicao.atual} de ${p.posicao.total} do mesmo post; mesma paleta e mesma luz das outras, com enquadramento diferente.`);
  }
  linhas.push("LUZ E CENA: luz com direção e fonte reais, sombra de contato e reflexos coerentes; materiais críveis; pele com textura real quando houver pessoa; mãos com cinco dedos.");
  linhas.push("PROIBIDO: texto inventado, marca d'água, logotipo de terceiros, colagem ou imagem colada por cima, produto duplicado ou deformado, ilustração ou 3D.");
  return semTravessao(linhas.join("\n"));
}

/** Etiquetas da foto gerada: a pauta, o papel de cada referência e o estilo. */
export function etiquetasDaFotoDaPauta(p: { taskId: string | null; referencias: ReferenciaComPapel[]; estiloId?: string | null }): string[] {
  const papeis = Array.from(new Set(p.referencias.map((r) => r.papel)));
  const transformacao = papeis.includes("antes") && papeis.includes("depois");
  return Array.from(new Set([
    "mesa_foto", "gerada", "pauta",
    ...(p.taskId ? [`task:${p.taskId}`] : []),
    ...papeis.map((x) => `ref:${x}`),
    ...(transformacao ? ["antes_e_depois"] : []),
    ...(p.estiloId ? [`estilo:${p.estiloId}`] : []),
  ])).slice(0, 20);
}
