/**
 * Separar as fotos em Produto, Modelo ou Arte (02/10, dono: "fotos são só
 * fotos: produto e modelo separados, sem criativo, arte ou carrossel").
 *
 * A tela separa pelos metadados (src/components/mesa-foto/tipoDaFoto.ts). A
 * foto que chega sem nenhum sinal (sem categoria, sem etiqueta, nome de
 * câmera tipo IMG_1234) vem para cá: o Jev (choice) julga pelo nome, a pasta
 * e a leitura que a foto já tenha, e a categoria é gravada (produto, pessoa ou
 * arte). Confiança baixa não grava nada (fica em Produto, como estava).
 *
 * Sem import de Deno: os testes (vitest) leem este arquivo.
 */

export const MAX_FOTOS_POR_SEPARACAO = 20;
export const CONFIANCA_MINIMA_DA_SEPARACAO = 0.6;

export type LadoSeparado = "produto" | "modelo" | "arte";

export interface FotoParaSeparar {
  id: string;
  nome: string | null;
  pasta: string | null;
  descricao: string | null;
  tags: string[] | null;
  origem: string | null;
}

/** Categoria do acervo para cada lado (a mesma lista da Mesa: produto, pessoa, arte). */
export const CATEGORIA_DO_LADO: Record<LadoSeparado, string> = { produto: "produto", modelo: "pessoa", arte: "arte" };

const limpar = (t: unknown, max: number) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Estado e perguntas do Jev: uma pergunta choice por foto (f0..fN), mesmo critério para todas. */
export function perguntasDaSeparacao(fotos: FotoParaSeparar[]): { state: Record<string, unknown>; questions: Record<string, { type: "choice"; instructions: string; criteria: Record<string, string> }> } {
  const lista = fotos.slice(0, MAX_FOTOS_POR_SEPARACAO);
  const state: Record<string, unknown> = {
    fotos: lista.map((f, i) => ({
      ref: `f${i}`,
      nome_do_arquivo: limpar(f.nome, 160),
      pasta: limpar(f.pasta, 160),
      leitura: limpar(f.descricao, 500),
      etiquetas: (f.tags ?? []).slice(0, 12).map((t) => limpar(t, 40)),
      origem: limpar(f.origem, 30),
    })),
  };
  const criteria = {
    produto: "Foto de produto: o produto, a embalagem, um detalhe dele ou o ambiente da loja, sem uma pessoa como assunto principal.",
    modelo: "Foto de pessoa: retrato, modelo usando o produto, equipe, clone ou persona; a pessoa é o assunto principal.",
    arte: "Arte pronta: post, carrossel, story, banner, criativo de anúncio, logo ou layout com texto aplicado. Não é uma foto crua.",
  };
  const questions: Record<string, { type: "choice"; instructions: string; criteria: Record<string, string> }> = {};
  lista.forEach((_, i) => {
    questions[`f${i}`] = {
      type: "choice",
      instructions: `A imagem de ref f${i} em \`fotos\` (pelo nome do arquivo, pela pasta, pela leitura e pelas etiquetas) é foto de produto, foto de pessoa ou uma arte pronta?`,
      criteria,
    };
  });
  return { state, questions };
}

export interface SeparacaoDecidida {
  id: string;
  lado: LadoSeparado | null;
  confianca: number | null;
  /** Categoria a gravar (null: confiança baixa, nada muda). */
  categoria: string | null;
}

/** Lê as respostas: só grava com a escolha válida e confiança suficiente. */
export function lerSeparacao(fotos: FotoParaSeparar[], answers: Record<string, { choice?: string; confidence?: number } | undefined>): SeparacaoDecidida[] {
  return fotos.slice(0, MAX_FOTOS_POR_SEPARACAO).map((f, i) => {
    const r = answers[`f${i}`];
    const escolha = r && typeof r.choice === "string" ? r.choice : null;
    const lado = escolha === "produto" || escolha === "modelo" || escolha === "arte" ? (escolha as LadoSeparado) : null;
    const confianca = r && typeof r.confidence === "number" && isFinite(r.confidence) ? r.confidence : null;
    const grava = !!lado && confianca !== null && confianca >= CONFIANCA_MINIMA_DA_SEPARACAO;
    return { id: f.id, lado, confianca, categoria: grava && lado ? CATEGORIA_DO_LADO[lado] : null };
  });
}

/** Lado escolhido na tela ao subir ou importar (aba aberta): vira a categoria da foto nova. */
export function categoriaDoLadoPedido(v: unknown): string | null {
  return v === "modelo" ? "pessoa" : v === "produto" ? "produto" : null;
}
