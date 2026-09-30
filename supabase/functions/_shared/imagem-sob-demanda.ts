/**
 * As funções de imagem-local.ts, carregadas só quando alguém abre uma imagem.
 *
 * FN-01 (30/09/2026): importar imagem-local.ts de forma estática fazia a
 * função carregar o imagescript antes de responder qualquer coisa, inclusive
 * o OPTIONS do navegador. Estúdio, Mesa Foto, contexto, calendário, Ads,
 * vídeos e documentos pagavam cerca de 2 s em toda chamada, mesmo quando só
 * liam o cabeçalho. Aqui os nomes e as assinaturas são os mesmos de
 * imagem-local.ts; a diferença é que o módulo só é carregado na primeira
 * chamada que precisa de pixel (uma vez por instância da função).
 *
 * - Contas sem pixel (cabeçalho, tipo, áreas): vêm de imagem-cabecalho.ts e
 *   saem daqui também, sem carregar nada.
 * - Funções assíncronas: carregam imagem-local.ts e chamam a original.
 * - `cobrir` e `estimarAlinhamento` recebem uma Image, que só existe depois de
 *   um `decodificar` daqui; então o módulo já está carregado e elas seguem
 *   síncronas, como no original.
 * - `imagescript()` entrega a classe Image para quem precisa criar uma.
 */
import type * as ImagemLocal from "./imagem-local.ts";
import type * as Imagescript from "./imagescript.ts";
import { registrarFalha } from "./falha-registrada.ts";

export {
  ALTURA_LAMINA,
  ampliar,
  caixaNoQuadroCentral,
  dimensoesDoCabecalho,
  IDENTIDADE,
  LARGURA_LAMINA,
  mimeDaImagem,
  normalizarAreas,
  tamanhoDoTrecho,
  uniaoDasAreas,
} from "./imagem-cabecalho.ts";
export type { Alinhamento, Area } from "./imagem-cabecalho.ts";

type Local = typeof ImagemLocal;

let cargaDoLocal: Promise<Local> | null = null;
let localCarregado: Local | null = null;
let cargaDoImagescript: Promise<typeof Imagescript> | null = null;

/** imagem-local.ts (com o imagescript), carregado uma vez por instância. Falha vai para o log e a próxima chamada tenta de novo. */
export function imagemLocal(): Promise<Local> {
  if (!cargaDoLocal) {
    cargaDoLocal = import("./imagem-local.ts").then(
      (m) => (localCarregado = m),
      (e) => {
        cargaDoLocal = null;
        registrarFalha("imagem-sob-demanda: imagem-local não carregou", e);
        throw e;
      },
    );
  }
  return cargaDoLocal;
}

/**
 * O imagescript (classe Image), carregado uma vez por instância. Carrega
 * junto o imagem-local.ts (que já importa o imagescript), para `cobrir` e
 * `estimarAlinhamento` daqui valerem também numa Image criada assim.
 */
export function imagescript(): Promise<typeof Imagescript> {
  if (!cargaDoImagescript) {
    cargaDoImagescript = imagemLocal()
      .then(() => import("./imagescript.ts"))
      .catch((e) => {
        cargaDoImagescript = null;
        throw e;
      });
  }
  return cargaDoImagescript;
}

/** Para as funções síncronas que recebem uma Image (só existe depois de abrir uma imagem por aqui). */
function jaCarregado(): Local {
  if (!localCarregado) throw new Error("imagem_local_nao_carregado: abra a imagem com decodificar antes");
  return localCarregado;
}

// ------------------------------------------------ síncronas (recebem uma Image já aberta)

export const cobrir = (...a: Parameters<Local["cobrir"]>) => jaCarregado().cobrir(...a);
export const estimarAlinhamento = (...a: Parameters<Local["estimarAlinhamento"]>) => jaCarregado().estimarAlinhamento(...a);

// ------------------------------------------------ assíncronas (carregam na primeira chamada)

export const acabamentoDaLamina = async (...a: Parameters<Local["acabamentoDaLamina"]>) => (await imagemLocal()).acabamentoDaLamina(...a);
export const analisarLogo = async (...a: Parameters<Local["analisarLogo"]>) => (await imagemLocal()).analisarLogo(...a);
export const aplicarSelo = async (...a: Parameters<Local["aplicarSelo"]>) => (await imagemLocal()).aplicarSelo(...a);
export const colarFotoNaArea = async (...a: Parameters<Local["colarFotoNaArea"]>) => (await imagemLocal()).colarFotoNaArea(...a);
export const colarMudancasNaBase = async (...a: Parameters<Local["colarMudancasNaBase"]>) => (await imagemLocal()).colarMudancasNaBase(...a);
export const corrigirEmenda = async (...a: Parameters<Local["corrigirEmenda"]>) => (await imagemLocal()).corrigirEmenda(...a);
export const decodificar = async (...a: Parameters<Local["decodificar"]>) => (await imagemLocal()).decodificar(...a);
export const devolverOriginalAlinhado = async (...a: Parameters<Local["devolverOriginalAlinhado"]>) => (await imagemLocal()).devolverOriginalAlinhado(...a);
export const devolverOriginalForaDasAreas = async (...a: Parameters<Local["devolverOriginalForaDasAreas"]>) => (await imagemLocal()).devolverOriginalForaDasAreas(...a);
export const fatiarTrecho = async (...a: Parameters<Local["fatiarTrecho"]>) => (await imagemLocal()).fatiarTrecho(...a);
export const jpegSobreBranco = async (...a: Parameters<Local["jpegSobreBranco"]>) => (await imagemLocal()).jpegSobreBranco(...a);
export const fotoNaLamina = async (...a: Parameters<Local["fotoNaLamina"]>) => (await imagemLocal()).fotoNaLamina(...a);
export const logoLimpa = async (...a: Parameters<Local["logoLimpa"]>) => (await imagemLocal()).logoLimpa(...a);
export const logoSobreContraste = async (...a: Parameters<Local["logoSobreContraste"]>) => (await imagemLocal()).logoSobreContraste(...a);
export const mascara = async (...a: Parameters<Local["mascara"]>) => (await imagemLocal()).mascara(...a);
export const recortarNaProporcao = async (...a: Parameters<Local["recortarNaProporcao"]>) => (await imagemLocal()).recortarNaProporcao(...a);
export const recorteNaCaixa = async (...a: Parameters<Local["recorteNaCaixa"]>) => (await imagemLocal()).recorteNaCaixa(...a);
export const reduzirParaCaber = async (...a: Parameters<Local["reduzirParaCaber"]>) => (await imagemLocal()).reduzirParaCaber(...a);
export const telaDoRecorte = async (...a: Parameters<Local["telaDoRecorte"]>) => (await imagemLocal()).telaDoRecorte(...a);
export const telaDoTrecho = async (...a: Parameters<Local["telaDoTrecho"]>) => (await imagemLocal()).telaDoTrecho(...a);
export const valorMedioNaArea = async (...a: Parameters<Local["valorMedioNaArea"]>) => (await imagemLocal()).valorMedioNaArea(...a);
