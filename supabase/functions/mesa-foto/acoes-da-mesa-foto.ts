/**
 * Ações que o diretor de fotografia propõe sobre as fotos do cliente (dono,
 * 25/09 à noite: "cada um deles tivesse poder, para não precisar fazer
 * manual"). Contrato comum em ../_shared/acoes-do-agente.ts e regras do
 * acervo em ../_shared/acoes-do-acervo.ts: aprovar e arquivar em lote,
 * organizar em pastas e etiquetas e mandar fotos para uma campanha. O
 * agente lista, a equipe confirma, só a confirmação executa
 * (executar_acao_agente em index.ts). O canvas não tem conversa guardada:
 * pedidos de organizar fotos vão para o diretor.
 *
 * Sem import de Deno: os testes (vitest) leem este arquivo.
 */
import { type AcaoDoAgente, blocoDosAlvos, esquemaDasAcoes, normalizarAcaoDoAgente, regraDasAcoes } from "../_shared/acoes-do-agente.ts";
import { alvosDoAcervo, type CampanhaParaFotos, DESCRICOES_DO_ACERVO, type FotoDoAcervo, regrasDoAcervo, rotuloDaCampanha } from "../_shared/acoes-do-acervo.ts";

export const OPERACOES_DA_MESA_FOTO = ["aprovar_foto", "arquivar_foto", "mover_foto", "marcar_foto", "tirar_marca", "mandar_para_campanha"];

export const ESQUEMA_DAS_ACOES_DA_MESA_FOTO = esquemaDasAcoes(OPERACOES_DA_MESA_FOTO);

export type CampanhaDaMesaFoto = { id: string; nome: string; status?: string | null };

/** Campanhas com apelido c1..cN (as encerradas ficam de fora: foto nova não entra nelas). */
export function campanhasComApelido(campanhas: CampanhaDaMesaFoto[]): CampanhaParaFotos[] {
  return campanhas.filter((c) => c.status !== "encerrada").slice(0, 20).map((c, i) => ({ id: c.id, nome: c.nome, ref: `c${i + 1}` }));
}

/** O pedido fala em aprovar, arquivar, organizar ou mandar fotos? Só então as listas entram no prompt. */
export function pedeAcaoNasFotos(mensagem: string): boolean {
  return /(aprov|arquiv|apag|tir[ae]|pasta|organiz|etiquet|marque|tag|mand[ae]|envi[ae]|campanha|lote|todas as fotos)/i.test(String(mensagem || ""));
}

export function normalizarAcoesDaMesaFoto(bruto: unknown, fotos: FotoDoAcervo[], campanhas: CampanhaDaMesaFoto[], clientId: string, id?: string): AcaoDoAgente | null {
  const alvos = alvosDoAcervo(fotos, 80);
  const comApelido = campanhasComApelido(campanhas);
  return normalizarAcaoDoAgente(bruto, alvos, regrasDoAcervo({ aprovar: true, campanhas: comApelido }), {
    agente: "foto",
    id: id || `foto-${Date.now().toString(36)}`,
    contexto: { client_id: clientId },
    rotuloDoPara: rotuloDaCampanha(comApelido),
  });
}

export function blocoDasAcoesDaMesaFoto(fotos: FotoDoAcervo[], campanhas: CampanhaDaMesaFoto[]): string {
  const comApelido = campanhasComApelido(campanhas);
  const linhasDasCampanhas = comApelido.length
    ? `\nCAMPANHAS (apelido | nome):\n${comApelido.map((c) => `${c.ref} | ${c.nome}`).join("\n")}\n`
    : "\nCAMPANHAS: nenhuma aberta.\n";
  const descricoes: Record<string, string> = {
    aprovar_foto: DESCRICOES_DO_ACERVO.aprovar_foto,
    arquivar_foto: DESCRICOES_DO_ACERVO.arquivar_foto,
    mover_foto: DESCRICOES_DO_ACERVO.mover_foto,
    marcar_foto: DESCRICOES_DO_ACERVO.marcar_foto,
    tirar_marca: DESCRICOES_DO_ACERVO.tirar_marca,
  };
  if (comApelido.length) descricoes.mandar_para_campanha = DESCRICOES_DO_ACERVO.mandar_para_campanha;
  return `${blocoDosAlvos("FOTOS DO CLIENTE", alvosDoAcervo(fotos, 80), "nenhuma.")}${linhasDasCampanhas}\n${regraDasAcoes(descricoes)}`;
}
