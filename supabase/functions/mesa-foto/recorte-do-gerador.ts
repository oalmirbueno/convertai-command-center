/**
 * "Usar o recorte do gerador" no "Tirar fundo" (preparar modo
 * fundo_transparente, método antigo), anti-bug AB2 de 26/09.
 *
 * O Estúdio (src/components/mesa/EstudioFotos.tsx e estudioUtil.ts) oferece,
 * quando o recorte falha porque o gerador redesenhou o assunto, usar a volta
 * do gerador mesmo sem a garantia de pixels iguais aos da foto. A função não
 * implementava isso: jogava fora a imagem já paga e um novo pedido cobrava de
 * novo. Agora:
 * - na falha recorte_desalinhado a volta do gerador (já cobrada) fica
 *   guardada no Storage e o erro leva o caminho (imagem_sem_garantia,
 *   recorte_do_gerador) e aceita_recorte_redesenhado: a tela usa direto,
 *   sem nova chamada;
 * - preparar { aceitar_recorte_redesenhado: true } reaproveita a volta
 *   guardada desta foto (a mais nova, nas últimas 24 h) sem chamar o
 *   gerador; sem nenhuma guardada, gera uma vez e aceita o redesenho em vez
 *   de falhar (a tela avisa que custa 1 imagem).
 *
 * Só o que é puro (a função importa, o teste do painel também).
 */

/** Pasta das voltas do gerador sem garantia de pixels, dentro da pasta do cliente no bucket mesa. */
export const PASTA_DO_RECORTE_DO_GERADOR = "foto/derivadas/sem-garantia";

/** Volta guardada há mais que isso não é reaproveitada (gera de novo). */
export const JANELA_DO_RECORTE_GUARDADO_MS = 24 * 3600 * 1000;

export const pastaDoRecorteDoGerador = (clientId: string) => `${clientId}/${PASTA_DO_RECORTE_DO_GERADOR}`;

/** Nome do arquivo: começa pelo id da foto (a busca do Storage acha por ele); o sufixo não repete. */
export const nomeDoRecorteDoGerador = (imagemId: string, sufixo: string) => `${imagemId}-${sufixo}.png`;

/** A equipe aceitou o recorte redesenhado: só no "Tirar fundo" e só com true explícito. */
export function aceitaRecorteRedesenhado(corpo: Record<string, unknown>, modo: string): boolean {
  return modo === "fundo_transparente" && corpo.aceitar_recorte_redesenhado === true;
}

/**
 * A volta do gerador guardada mais nova desta foto, dentro da janela, a
 * partir da lista do Storage (name, created_at). Null quando não há.
 */
export function recorteGuardadoMaisNovo(
  lista: Array<{ name?: string | null; created_at?: string | null }>,
  imagemId: string,
  agoraMs: number,
  janelaMs = JANELA_DO_RECORTE_GUARDADO_MS,
): string | null {
  let melhor: { nome: string; quando: number } | null = null;
  for (const item of lista || []) {
    const nome = String((item && item.name) || "");
    if (nome.indexOf(`${imagemId}-`) !== 0 || !/\.png$/i.test(nome)) continue;
    const quando = Date.parse(String((item && item.created_at) || ""));
    if (!Number.isFinite(quando) || agoraMs - quando > janelaMs || quando - agoraMs > 60_000) continue;
    if (!melhor || quando > melhor.quando) melhor = { nome, quando };
  }
  return melhor ? melhor.nome : null;
}

/**
 * Detalhes do erro recorte_desalinhado para a tela (ofertaDoRecorteDoGerador
 * em estudioUtil.ts): com a volta guardada, o caminho dela; sempre o aceite.
 */
export function detalhesDoRecorteDoGerador(caminho: string | null): Record<string, unknown> {
  return caminho
    ? { imagem_sem_garantia: { storage_path: caminho }, recorte_do_gerador: caminho, aceita_recorte_redesenhado: true }
    : { aceita_recorte_redesenhado: true };
}

/**
 * Mensagem do recorte_desalinhado (o custo já foi cobrado). Com a volta
 * guardada, diz que usá-la não cobra de novo, sem citar botão: a Mesa Foto
 * mostra a mesma mensagem e só o Estúdio oferece "Usar o recorte do gerador".
 */
export function mensagemDoRecorteDesalinhado(guardado: boolean): string {
  const base = "O gerador redesenhou o assunto e a máscara não bate com a foto original.";
  return guardado
    ? `${base} Nada entrou no acervo e o custo da chamada já foi cobrado; a versão do gerador ficou guardada (sem garantia de pixels iguais) e usá-la não cobra de novo. Tente de novo ou use uma foto com o assunto mais destacado do fundo.`
    : `${base} Nada foi gravado; o custo da chamada já foi cobrado. Tente de novo ou use uma foto com o assunto mais destacado do fundo.`;
}

/** Derivada do recorte aceito: pixels do assunto refeitos pelo gerador (sem a garantia do recorte). */
export const DERIVADA_DO_RECORTE_ACEITO = { modo: "luz_cor" as const, gerada: true };

/** Tags a mais da derivada aceita (a tela e as buscas acham o recorte sem garantia). */
export const TAGS_DO_RECORTE_ACEITO = ["recorte_do_gerador", "sem_garantia_de_pixels"];

export const AVISO_DO_RECORTE_ACEITO =
  "Recorte do gerador aceito pela equipe: o assunto foi redesenhado e os pixels podem não ser os da foto original. Confira rosto, rótulo e bordas antes de usar.";

export const PROMESSA_DO_RECORTE_ACEITO =
  "Sem fundo pelo recorte do gerador: o assunto foi redesenhado, sem a garantia de pixels iguais aos da foto original.";
