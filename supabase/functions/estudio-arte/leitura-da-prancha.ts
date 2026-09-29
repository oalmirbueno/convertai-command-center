/**
 * Leitura da prancha sem silêncio (frente FS, 29/09/2026).
 *
 * Antes: `lerPrancha` e a abertura da imagem engoliam QUALQUER erro (até saldo
 * e cota) e a ação "prancha" respondia 200 como se a referência fosse uma arte
 * só. A equipe não sabia, e a arte saía com a imagem inteira em vez do quadro
 * certo (ou sem a referência, quando o arquivo estava quebrado).
 *
 * Agora:
 * - Saldo, cota e chave sobem como erro (a função responde 402/403/503 no
 *   padrão STATUS_MOTOR / MENSAGEM_MOTOR).
 * - Arquivo quebrado (defeitoDaImagem: PNG ou JPEG cortado, vazio, formato que
 *   o leitor não lê) é pulado ANTES de gastar, com o motivo.
 * - Falha do provedor vira aviso claro na resposta, com o motivo, e vai para o log.
 *
 * A prancha manda UMA imagem por chamada (a da referência escolhida): não há
 * lote a dividir, então a leitura em lotes da frente LR não se aplica aqui.
 *
 * Módulo puro (dependências injetadas): o index.ts liga o motor e o Storage, o
 * vitest testa o comportamento.
 */

import { defeitoDaImagem } from "../_shared/defeito-da-imagem.ts";
import { erroQueSobe, motivoDaFalha, registrarFalha } from "../_shared/falha-registrada.ts";

export type FalhaDaPrancha = {
  /** Código curto: arquivo_indisponivel, png_truncado, leitura_falhou... */
  codigo: string;
  /** Motivo legível (vai para a tela). */
  motivo: string;
  /** true: o arquivo da referência está com defeito (a arte também não consegue usar). */
  arquivo: boolean;
};

/** Texto para a pessoa, por defeito do arquivo. */
export const MOTIVOS_DO_ARQUIVO: Record<string, string> = {
  arquivo_vazio: "o arquivo está vazio",
  png_truncado: "o PNG está cortado (o envio não terminou)",
  jpeg_truncado: "o JPEG está cortado (o envio não terminou)",
  webp_truncado: "o WebP está cortado (o envio não terminou)",
  formato_nao_suportado: "o formato não é lido pelo leitor (use PNG, JPEG ou WebP)",
  grande_demais: "o arquivo passa do tamanho que o leitor aceita",
};

/**
 * Abre a imagem da referência para a prancha. Nunca lança, a não ser saldo,
 * cota ou chave: devolve a imagem (ou null) e a falha com motivo. A imagem com
 * defeito NÃO volta (não pode ir ao provedor).
 */
export async function abrirImagemDaPrancha<I extends { bytes: Uint8Array }>(
  abrir: () => Promise<I>,
  log: Record<string, unknown> = {},
): Promise<{ imagem: I | null; falha: FalhaDaPrancha | null }> {
  let imagem: I;
  try {
    imagem = await abrir();
  } catch (e) {
    if (erroQueSobe(e)) throw e;
    const motivo = registrarFalha("estudio-arte: imagem da prancha não abriu", e, log);
    return { imagem: null, falha: { codigo: "arquivo_indisponivel", motivo, arquivo: true } };
  }
  const defeito = defeitoDaImagem(imagem.bytes);
  if (defeito) {
    const motivo = MOTIVOS_DO_ARQUIVO[defeito] ?? defeito;
    console.error("estudio-arte: imagem da prancha com defeito, pulada", { ...log, defeito, bytes: imagem.bytes.byteLength });
    return { imagem: null, falha: { codigo: defeito, motivo, arquivo: true } };
  }
  return { imagem, falha: null };
}

/**
 * Lê a prancha pelo leitor. Saldo, cota e chave sobem; qualquer outra falha
 * (provedor recusou, caiu, JSON inválido, gravação) volta com o motivo e vai
 * para o log.
 */
export async function lerPranchaComMotivo<L>(
  ler: () => Promise<L>,
  log: Record<string, unknown> = {},
): Promise<{ leitura: L | null; falha: FalhaDaPrancha | null }> {
  try {
    return { leitura: await ler(), falha: null };
  } catch (e) {
    if (erroQueSobe(e)) throw e;
    const motivo = registrarFalha("estudio-arte: leitura da prancha falhou", e, log);
    return { leitura: null, falha: { codigo: "leitura_falhou", motivo, arquivo: false } };
  }
}

/** Aviso para a tela: diz o que falhou, por quê e o que a arte faz sem a leitura. */
export function avisoDaPrancha(f: FalhaDaPrancha): string {
  if (f.arquivo) {
    return `A prancha não pôde ser lida: ${f.motivo}. O arquivo foi pulado: troque o arquivo desta referência; enquanto isso ela não entra na arte.`;
  }
  return `A prancha não pôde ser lida: ${f.motivo}. A arte sai sem os quadros da prancha (usa a imagem inteira como referência). Tente ler de novo.`;
}

/** Campos da resposta da ação "prancha" quando algo falhou (vazio quando deu certo). */
export function camposDaFalhaDaPrancha(f: FalhaDaPrancha | null): Record<string, unknown> {
  if (!f) return {};
  return { falhou: true, motivo: f.motivo, prancha_erro: f.codigo, aviso_da_acao: avisoDaPrancha(f) };
}

export { motivoDaFalha };
