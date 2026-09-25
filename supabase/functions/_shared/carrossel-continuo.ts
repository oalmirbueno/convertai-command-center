/**
 * Regras do carrossel contínuo (panorama) sem rede, sem banco e sem imagem:
 * o estudio-arte, a conversa do diretor e os testes usam o mesmo código. A
 * tela tem o espelho em src/components/mesa/estudioUtil.ts.
 *
 * Auditoria de 25/09 (dono: "o carrossel contínuo não está funcionando, é
 * muito bugado"):
 * - o contínuo exigia provedor === "openai" e o padrão foi para o GPT Image
 *   pelo OpenRouter em 24/09: tudo caía no modo normal sem aviso. Agora vale a
 *   capacidade (modeloFazPanorama);
 * - o fundo ganha uma geração: apagar (ligar, desligar, refazer, mudar a cena)
 *   sobe a geração, e um trecho que termina depois disso é descartado em vez
 *   de ressuscitar o fundo velho;
 * - um trecho por vez: a trava "em andamento" vale ESPERA_DO_FUNDO_MS e impede
 *   pagar o mesmo trecho duas vezes.
 */

/** Largura e altura de uma lâmina no panorama (igual a imagem-local.ts). */
export const LARGURA_NO_PANORAMA = 1088;
export const ALTURA_NO_PANORAMA = 1360;

/** Validade da trava de um trecho em andamento (a geração leva até ~5 min). */
export const ESPERA_DO_FUNDO_MS = 6 * 60 * 1000;

/** Diferença de proporção aceita entre o trecho pedido e o que voltou (2%). */
export const TOLERANCIA_DA_PROPORCAO = 0.02;

export type TravaDoTrecho = { token: string; desde: string };

/** Fundo panorâmico gravado na direção (ordem da lâmina -> caminho no bucket mesa). */
export type PanoramaGravado = {
  fundos: Record<string, string>;
  /** Sobe a cada vez que o fundo é apagado; 0 quando nunca foi. */
  geracao?: number;
  /** Trechos sendo gerados agora, pela lâmina de início do trecho. */
  em_andamento?: Record<string, TravaDoTrecho> | null;
};

export const geracaoDoPanorama = (p: { geracao?: number } | null | undefined): number => {
  const g = Number(p && p.geracao);
  return Number.isInteger(g) && g > 0 ? g : 0;
};

/** Fundo apagado: sem fatias, sem trava e com a geração seguinte. */
export function panoramaApagado(p: { geracao?: number } | null | undefined): PanoramaGravado {
  return { fundos: {}, geracao: geracaoDoPanorama(p) + 1, em_andamento: null };
}

/**
 * Modelo que faz o panorama: GPT Image, direto na OpenAI ou pela API de
 * imagens do OpenRouter. O trecho é UMA imagem larga (até 3264 x 1360) pedida
 * em pixels; os outros geradores só aceitam proporções fixas e cortariam a
 * cena. Pelo OpenRouter não há máscara: a continuação entre trechos é
 * alinhada no código.
 */
export function modeloFazPanorama(m: { provedor?: string | null; modelo_api?: string | null } | null | undefined): boolean {
  if (!m) return false;
  const api = String(m.modelo_api || "");
  if (m.provedor === "openai") return /^gpt-image/.test(api);
  if (m.provedor === "openrouter") return /^openai\/gpt-image/.test(api);
  return false;
}

/** O trecho que voltou tem a proporção de k lâminas lado a lado (senão o corte daria zoom). */
export function proporcaoDoTrechoConfere(largura: number, altura: number, k: number, tolerancia = TOLERANCIA_DA_PROPORCAO): boolean {
  if (!(largura > 0) || !(altura > 0) || !(k >= 1)) return false;
  const pedida = (LARGURA_NO_PANORAMA * k) / ALTURA_NO_PANORAMA;
  return Math.abs(largura / altura / pedida - 1) <= tolerancia;
}

/** Trava ainda válida do trecho que começa em `inicio` (null quando livre ou vencida). */
export function travaDoTrecho(p: PanoramaGravado | null | undefined, inicio: number, agora = Date.now()): TravaDoTrecho | null {
  const t = p && p.em_andamento ? p.em_andamento[String(inicio)] : null;
  if (!t || !t.desde) return null;
  const desde = Date.parse(t.desde);
  if (!Number.isFinite(desde) || agora - desde >= ESPERA_DO_FUNDO_MS) return null;
  return t;
}

/** Travas sem a do trecho (só quando o token é o mesmo: quem travou é quem solta). */
export function semATrava(
  andamento: Record<string, TravaDoTrecho> | null | undefined,
  inicio: number,
  token: string,
): Record<string, TravaDoTrecho> | null {
  const n: Record<string, TravaDoTrecho> = { ...(andamento || {}) };
  if (n[String(inicio)] && n[String(inicio)].token === token) delete n[String(inicio)];
  return Object.keys(n).length ? n : null;
}

/**
 * A versão foi feita sobre um fundo panorâmico que não é mais o da lâmina
 * (fundo refeito ou apagado depois): ela não emenda com as vizinhas novas.
 */
export function versaoForaDoFundo(
  versao: { ordem: number; modo?: unknown; fundo?: unknown } | null | undefined,
  panorama: { fundos?: Record<string, string> | null } | null | undefined,
): boolean {
  if (!versao || versao.modo !== "panorama" || typeof versao.fundo !== "string" || !versao.fundo) return false;
  const atual = panorama && panorama.fundos ? panorama.fundos[String(versao.ordem)] : undefined;
  return atual !== versao.fundo;
}
