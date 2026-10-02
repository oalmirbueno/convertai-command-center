/**
 * Opções a mais do Resultado do Canvas (02/10/2026). O dono pediu "mais
 * opções" no Canvas: ângulo da câmera, luz, fundo ou cenário e quantas
 * variações sair de cada vez. Cada opção é uma frase fixa que vai no pedido
 * ao gerador (qualquer motor entende), escolhida por chave: a tela mostra o
 * rótulo, a função grava a chave no Resultado e monta a frase.
 *
 * Puro (sem Deno, sem banco, sem React): a função mesa-foto usa para validar
 * o canvas ao salvar e montar o pedido; a tela usa para as pílulas. Sem
 * travessão.
 */

export type OpcaoDoResultado = { valor: string; rotulo: string; frase: string };

/** Ângulo da câmera (preset). "livre": sai do pedido. */
export const CAMERAS_DO_RESULTADO: OpcaoDoResultado[] = [
  { valor: "livre", rotulo: "Livre", frase: "" },
  { valor: "frontal", rotulo: "Frontal", frase: "câmera frontal, na altura do assunto, plano médio, o produto de frente e inteiro" },
  { valor: "tres_quartos", rotulo: "3/4", frase: "câmera em três quartos (uns 45 graus), mostrando a frente e a lateral do assunto" },
  { valor: "lateral", rotulo: "Lateral", frase: "câmera de perfil (90 graus), silhueta do produto bem definida" },
  { valor: "detalhe", rotulo: "Detalhe", frase: "close de detalhe: textura, material e acabamento do produto, profundidade de campo curta" },
  { valor: "no_rosto", rotulo: "No rosto", frase: "o produto usado ou aplicado no rosto da pessoa, close de rosto e ombros, pele com textura real" },
  { valor: "no_modelo", rotulo: "No modelo", frase: "o produto vestido ou usado pela pessoa, plano americano mostrando como fica no corpo" },
  { valor: "de_cima", rotulo: "De cima", frase: "vista de cima (flat lay), câmera a 90 graus sobre a superfície, composição organizada" },
];

/** Luz (preset). */
export const LUZES_DO_RESULTADO: OpcaoDoResultado[] = [
  { valor: "livre", rotulo: "Livre", frase: "" },
  { valor: "natural", rotulo: "Natural", frase: "luz natural de janela, suave e lateral, sombras leves" },
  { valor: "estudio", rotulo: "Estúdio", frase: "luz de estúdio suave e difusa (softbox), sombras controladas, cores fiéis" },
  { valor: "dourada", rotulo: "Fim de tarde", frase: "luz dourada de fim de tarde, quente, baixa e lateral" },
  { valor: "contraluz", rotulo: "Contraluz", frase: "contraluz com recorte de luz no contorno do assunto, sem estourar o produto" },
  { valor: "dura", rotulo: "Dura", frase: "luz dura e direcional, sombras marcadas e contraste alto, pegada editorial" },
  { valor: "noturna", rotulo: "Noite", frase: "noite com as luzes do próprio lugar, tons frios no fundo e pontos de luz quente" },
];

/** Fundo ou cenário (preset). Com cartão Ambiente ligado, o fundo só complementa o lugar. */
export const FUNDOS_DO_RESULTADO: OpcaoDoResultado[] = [
  { valor: "livre", rotulo: "Livre", frase: "" },
  { valor: "branco", rotulo: "Branco", frase: "fundo infinito branco de estúdio, sombra de contato suave no chão" },
  { valor: "cor_da_marca", rotulo: "Cor da marca", frase: "fundo liso na cor principal da marca, sem textura, sombra de contato suave" },
  { valor: "madeira", rotulo: "Madeira", frase: "sobre uma mesa de madeira natural, fundo desfocado" },
  { valor: "marmore", rotulo: "Mármore", frase: "sobre uma bancada de mármore claro, fundo limpo e desfocado" },
  { valor: "casa", rotulo: "Casa", frase: "dentro de uma casa real e aconchegante, objetos do dia a dia fora de foco" },
  { valor: "rua", rotulo: "Rua", frase: "ao ar livre, numa rua da cidade, fundo desfocado" },
  { valor: "natureza", rotulo: "Natureza", frase: "ao ar livre na natureza, folhagem e luz do dia" },
  { valor: "loja", rotulo: "Loja", frase: "dentro de uma loja bem arrumada, prateleiras fora de foco" },
];

/** Quantas variações saem de cada vez (Variações desta e Variar). */
export const MIN_VARIACOES = 1;
export const MAX_VARIACOES_DO_RESULTADO = 5;
export const VARIACOES_PADRAO = 3;

/** A chave se ela está na lista; senão "livre". */
export function lerOpcao(lista: OpcaoDoResultado[], v: unknown): string {
  const t = typeof v === "string" ? v.trim() : "";
  return lista.some((o) => o.valor === t) ? t : "livre";
}

/** Variações por vez, de 1 a 5 (padrão 3). */
export function lerVariacoes(v: unknown): number {
  if (v === null || v === undefined || v === "") return VARIACOES_PADRAO;
  const n = Math.floor(Number(v));
  if (!isFinite(n)) return VARIACOES_PADRAO;
  return Math.max(MIN_VARIACOES, Math.min(MAX_VARIACOES_DO_RESULTADO, n));
}

const fraseDe = (lista: OpcaoDoResultado[], v: unknown) => {
  const o = lista.find((x) => x.valor === lerOpcao(lista, v));
  return o ? o.frase : "";
};

export const rotuloDaOpcao = (lista: OpcaoDoResultado[], v: unknown) => {
  const o = lista.find((x) => x.valor === lerOpcao(lista, v));
  return o ? o.rotulo : "Livre";
};

/**
 * As linhas que as opções acrescentam ao pedido. Numa série (variação ou
 * carrossel) o ângulo é obrigatório e diferente em cada foto: a câmera
 * escolhida não entra, para não brigar com ele.
 */
export function linhasDasOpcoes(o: { camera?: unknown; luz?: unknown; fundo?: unknown }, emSerie = false): string[] {
  const linhas: string[] = [];
  const camera = emSerie ? "" : fraseDe(CAMERAS_DO_RESULTADO, o.camera);
  const luz = fraseDe(LUZES_DO_RESULTADO, o.luz);
  const fundo = fraseDe(FUNDOS_DO_RESULTADO, o.fundo);
  if (camera) linhas.push(`CÂMERA: ${camera}.`);
  if (luz) linhas.push(`LUZ: ${luz}.`);
  if (fundo) linhas.push(`FUNDO E CENÁRIO: ${fundo}.`);
  return linhas;
}

/** Próxima câmera da lista (Variar numa caixa nova muda o ângulo). */
export function proximaCamera(atual: unknown): string {
  const validas = CAMERAS_DO_RESULTADO.filter((o) => o.valor !== "livre" && o.valor !== "no_rosto" && o.valor !== "no_modelo");
  const i = validas.findIndex((o) => o.valor === lerOpcao(CAMERAS_DO_RESULTADO, atual));
  return validas[(i + 1) % validas.length].valor;
}

/**
 * Ângulo escrito em palavras (vem do planejamento do mês) para a chave do
 * preset: "3/4", "três quartos", "lateral", "detalhe", "no rosto"... Sem
 * casar, "livre".
 */
export function cameraPeloTexto(texto: unknown): string {
  const t = String(texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  if (!t.trim()) return "livre";
  if (/3\s*\/\s*4|tres quartos|45/.test(t)) return "tres_quartos";
  if (/lateral|perfil|lado/.test(t)) return "lateral";
  if (/detalhe|close|macro|textura/.test(t)) return "detalhe";
  if (/rosto|face/.test(t)) return "no_rosto";
  if (/modelo|corpo|vestid|no look|usando/.test(t)) return "no_modelo";
  if (/cima|flat|plongee|top/.test(t)) return "de_cima";
  if (/frontal|frente|front/.test(t)) return "frontal";
  return "livre";
}

/** Luz escrita em palavras para a chave do preset (sem casar, "livre"). */
export function luzPeloTexto(texto: unknown): string {
  const t = String(texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  if (!t.trim()) return "livre";
  if (/contraluz|contra luz|backlight/.test(t)) return "contraluz";
  if (/dourad|golden|fim de tarde|por do sol|entardecer/.test(t)) return "dourada";
  if (/noite|noturn|neon/.test(t)) return "noturna";
  if (/estudio|softbox|difusa/.test(t)) return "estudio";
  if (/dura|contraste|sombra marcada/.test(t)) return "dura";
  if (/natural|janela|dia/.test(t)) return "natural";
  return "livre";
}
