/**
 * Rosto escolhido na referência (frente R, acréscimo do dono, 26/09/2026).
 *
 * Quando a referência tem uma pessoa, a equipe pode escolher o ROSTO de quem
 * vai aparecer: o do cliente ou o do dono e da equipe (rostos autorizados do
 * contexto, cliente_rostos, e clones da Mesa Foto, foto_modelos com origem
 * clone_de_foto_real e autorização válida) ou fotos escolhidas na hora. A
 * geração recria a arte na pegada da referência e do design, com o conteúdo
 * da copy, e a pessoa com o rosto escolhido muito fiel; pose, ângulo,
 * expressão e enquadramento seguem a arte, não a foto.
 *
 * ADITIVO: sem rosto escolhido (direcao.rosto ausente) lerRostoDoTrabalho
 * devolve null, nada é lido e o prompt e as imagens de entrada são byte a
 * byte os de hoje. Com rosto: até 2 fotos entram DEPOIS dos anexos da lâmina
 * (antes das do estilo do cliente), cada uma com o papel nomeado, e um bloco
 * curto ROSTO ESCOLHIDO entra logo depois do bloco da copy. Foto nunca é
 * escurecida.
 */

export type FonteDoRosto = "cliente" | "equipe" | "fotos";
export const FONTES_DO_ROSTO: FonteDoRosto[] = ["cliente", "equipe", "fotos"];
export const MAX_FOTOS_DO_ROSTO = 2;

export type RostoEscolhido = {
  fonte: FonteDoRosto;
  /** cliente e equipe: "r:<uuid>" (rosto do contexto) ou "c:<uuid>" (clone da Mesa Foto). */
  id?: string;
  /** fotos: caminhos no bucket mesa, na pasta do cliente (até 2). */
  fotos?: string[];
  /** Rosto em evidência na composição. */
  destacar?: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_DO_ROSTO = /^[rc]:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ehIdDoRosto = (v: unknown): v is string => typeof v === "string" && ID_DO_ROSTO.test(v);
export const ehUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/**
 * Lê o rosto do trabalho (JSON do banco ou do configurar). Inválido ou
 * incompleto vira null (sem rosto). `clientId`: as fotos na hora só valem na
 * pasta deste cliente.
 */
export function normalizarRosto(v: unknown, clientId: string): RostoEscolhido | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const fonte = FONTES_DO_ROSTO.indexOf(o.fonte as FonteDoRosto) >= 0 ? (o.fonte as FonteDoRosto) : null;
  if (!fonte) return null;
  const destacar = o.destacar === true;
  if (fonte === "fotos") {
    const fotos = (Array.isArray(o.fotos) ? o.fotos : [])
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter((c) => !!c && c.indexOf(`${clientId}/`) === 0 && c.indexOf("..") < 0 && c.length <= 300)
      .filter((c, i, l) => l.indexOf(c) === i)
      .slice(0, MAX_FOTOS_DO_ROSTO);
    return fotos.length ? { fonte, fotos, ...(destacar ? { destacar } : {}) } : null;
  }
  return ehIdDoRosto(o.id) ? { fonte, id: String(o.id).toLowerCase(), ...(destacar ? { destacar } : {}) } : null;
}

/** O rosto que vale no trabalho: direcao.rosto normalizado, ou null (o de hoje). */
export function lerRostoDoTrabalho(direcao: unknown, clientId: string): RostoEscolhido | null {
  if (!direcao || typeof direcao !== "object") return null;
  return normalizarRosto((direcao as Record<string, unknown>).rosto, clientId);
}

/**
 * Espelho de autorizacaoValida (mesa-foto/clones-regras.ts): confirmada, sem
 * revogação e dentro da validade. Sem ela o clone não entra na lâmina.
 */
export function autorizacaoDoCloneValida(a: unknown, hoje: string = new Date().toISOString().slice(0, 10)): boolean {
  if (!a || typeof a !== "object") return false;
  const x = a as Record<string, unknown>;
  if (x.confirmada !== true) return false;
  if (x.revogada_em) return false;
  if (typeof x.validade === "string" && x.validade && x.validade < hoje) return false;
  return true;
}

/**
 * Quantas fotos do rosto cabem: até 2, dentro do limite de imagens de entrada
 * do modelo. Ordem de prioridade (dono): os anexos da lâmina (com a
 * referência) já estão na conta; depois o rosto; o estilo do cliente fica com
 * o que sobrar.
 */
export function vagasDoRosto(e: { usadas: number; limiteDoModelo: number; pedidas: number }): number {
  const limite = Math.max(0, Math.floor(e.limiteDoModelo));
  return Math.max(0, Math.min(MAX_FOTOS_DO_ROSTO, e.pedidas, limite - e.usadas));
}

export const ROTULO_DA_FOTO_DO_ROSTO =
  "identidade do rosto escolhido pela equipe: manter os traços desta pessoa; não copiar a pose, o fundo, a roupa nem a luz desta foto";

/**
 * Bloco curto do prompt. `indices`: números das imagens com o rosto;
 * `pessoaNaReferencia`: o molde leu uma pessoa como assunto da referência.
 */
export function blocoDoRosto(e: { indices: number[]; destacar: boolean; pessoaNaReferencia: boolean }): string {
  if (!e.indices.length) return "";
  const imgs = e.indices.length === 1 ? `imagem ${e.indices[0]}` : `imagens ${e.indices.slice(0, -1).join(", ")} e ${e.indices[e.indices.length - 1]}`;
  return [
    "ROSTO ESCOLHIDO PELA EQUIPE (identidade da pessoa desta lâmina)",
    `- A pessoa desta lâmina é a ${e.indices.length === 1 ? "da" : "das"} ${imgs}: o mesmo rosto, feições, olhos, nariz, boca, sobrancelhas, tom de pele, cabelo e idade, muito fiel. É ela, não alguém parecido.`,
    "- Dessas fotos vem só a identidade. A pose, o ângulo, a expressão, o enquadramento, a roupa, o fundo e a luz seguem a arte (a referência e a cena desta lâmina), não as fotos.",
    e.pessoaNaReferencia
      ? "- Ela entra no lugar da pessoa da referência, no mesmo espaço e na mesma escala; a pessoa da referência nunca aparece."
      : "- Ela é a pessoa em cena, no lugar e na escala do assunto da referência.",
    "- Luz da cena no rosto, sem escurecer a foto e sem filtro que mude o rosto; uma pessoa só com este rosto.",
    e.destacar
      ? "- ROSTO EM EVIDÊNCIA: o rosto dela é o ponto focal da lâmina, grande e nítido, sem texto nem elemento por cima dele."
      : "",
  ].filter(Boolean).join("\n");
}
