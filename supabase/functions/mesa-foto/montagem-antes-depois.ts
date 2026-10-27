/**
 * Antes e depois com as fotos REAIS (27/10/2026, dono: "não é fazer por cima da foto; usar de forma fiel as
 * imagens e não gerar por cima, isso não pode acontecer"). A regra da casa é foto real intacta: o gerador de
 * imagem sempre redesenha o que recebe. Aqui a comparação é montada no código, com os pixels das duas fotos,
 * cada uma recortada pelo foco e sem retoque. Sem IA e sem custo.
 *
 * Carregado sob demanda (FN-01); o layout é puro, em foto-da-pauta-regras.ts.
 */
import { Image } from "../_shared/imagescript.ts";
import { cobrirComFoco, decodificar } from "../_shared/imagem-local.ts";
import { layoutDoAntesEDepois } from "./foto-da-pauta-regras.ts";

/** As duas fotos reais lado a lado (ou uma sobre a outra), no tamanho do formato. JPEG. */
export async function montarAntesEDepois(antes: Uint8Array, depois: Uint8Array, largura: number, altura: number): Promise<Uint8Array> {
  const [a, d] = await Promise.all([decodificar(antes), decodificar(depois)]);
  const caixas = layoutDoAntesEDepois(largura, altura);
  const tela = new Image(largura, altura);
  tela.fill(0xffffffff);
  tela.composite(cobrirComFoco(a, caixas.antes.largura, caixas.antes.altura), caixas.antes.x, caixas.antes.y);
  tela.composite(cobrirComFoco(d, caixas.depois.largura, caixas.depois.altura), caixas.depois.x, caixas.depois.y);
  return await tela.encodeJPEG(92);
}
