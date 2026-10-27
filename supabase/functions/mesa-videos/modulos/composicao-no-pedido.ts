/**
 * Composição do vídeo da pauta no pedido (27/10/2026). Dono: "puxar o contexto, as imagens, criar a composição do
 * vídeo e criar; e a opção de referências, antes e depois etc.". Cada cena da composição vira um pedido de
 * gerar_video; o pedido guarda de qual composição e cena veio (a tela junta as cenas e acompanha cada uma) e o
 * papel de cada referência que entrou (antes, depois, estilo de movimento, produto). Puro: a função e os testes
 * (vitest) leem este arquivo. Sem travessão.
 */

export const PAPEIS_DA_REFERENCIA = ["antes", "depois", "movimento", "produto"] as const;
export type PapelDaReferencia = (typeof PAPEIS_DA_REFERENCIA)[number];

export const ROTULO_DO_PAPEL: Record<PapelDaReferencia, string> = {
  antes: "Antes",
  depois: "Depois",
  movimento: "Estilo de movimento",
  produto: "Produto",
};

export interface ComposicaoNoPedido {
  /** Id curto da composição (a tela cria). */
  id: string;
  /** Id da cena dentro da composição (não muda ao reordenar). */
  cena_id: string;
  /** Posição da cena (1..total) na hora do pedido. */
  ordem: number;
  total: number;
}

export interface ReferenciaNoPedido {
  papel: PapelDaReferencia;
  nome: string;
  /** Caminho no Storage do cliente (bucket mesa ou workspace). */
  caminho: string;
  tipo: "imagem" | "video";
}

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const linha = (v: unknown, max: number) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);

/** A composição que veio no corpo, validada (ou null quando não veio ou não vale). */
export function composicaoDoCorpo(v: unknown): ComposicaoNoPedido | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const id = String(o.id || "");
  const cena = String(o.cena_id || "");
  const total = Math.floor(Number(o.total));
  const ordem = Math.floor(Number(o.ordem));
  if (!ID.test(id) || !ID.test(cena) || !(total >= 1 && total <= 12) || !(ordem >= 1 && ordem <= total)) return null;
  return { id, cena_id: cena, ordem, total };
}

/**
 * As referências com papel que vieram no corpo: só papel conhecido, só caminho da pasta do cliente (o mesmo
 * cliente do pedido), sem "..", até 8. O que não vale fica de fora (nunca derruba o pedido).
 */
export function referenciasDoCorpo(v: unknown, clientId: string): ReferenciaNoPedido[] {
  if (!Array.isArray(v) || !clientId) return [];
  const saida: ReferenciaNoPedido[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const papel = String(o.papel || "") as PapelDaReferencia;
    const caminho = String(o.caminho || "").trim();
    if ((PAPEIS_DA_REFERENCIA as readonly string[]).indexOf(papel) < 0) continue;
    if (!caminho || caminho.indexOf(`${clientId}/`) !== 0 || caminho.indexOf("..") >= 0 || caminho.length > 500) continue;
    saida.push({ papel, nome: linha(o.nome, 120) || caminho.split("/").pop() || "referência", caminho, tipo: o.tipo === "video" ? "video" : "imagem" });
    if (saida.length >= 8) break;
  }
  return saida;
}

/** O que entra nos parâmetros do pedido (vazio quando o corpo não trouxe composição nem referências). */
export function extrasDaComposicao(corpo: Record<string, unknown>, clientId: string): Record<string, unknown> {
  const composicao = composicaoDoCorpo(corpo.composicao);
  const referencias = referenciasDoCorpo(corpo.referencias_papeis, clientId);
  return { ...(composicao ? { composicao } : {}), ...(referencias.length ? { referencias_papeis: referencias } : {}) };
}

// ------------------------------------------------------------------ movimento de câmera da cena

/** Os movimentos que a tela oferece (um clique) e que o prompt de cada cena leva. */
export const MOVIMENTOS_DA_CENA = [
  "Aproximação lenta",
  "Afastamento lento",
  "Deslocamento lateral suave",
  "Órbita lenta",
  "Revelação do ambiente",
  "Plano de cima",
  "Câmera na mão",
  "Câmera fixa",
] as const;
export type MovimentoDaCena = (typeof MOVIMENTOS_DA_CENA)[number];

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** O movimento citado no texto da cena ("zoom", "travelling", "gira em volta"); sem nenhum, o padrão. */
export function movimentoDoTexto(texto: unknown, padrao: MovimentoDaCena = "Aproximação lenta"): MovimentoDaCena {
  const s = semAcento(String(texto == null ? "" : texto));
  if (/afast|zoom ?out|pull ?back|recua/.test(s)) return "Afastamento lento";
  if (/aproxim|zoom|push ?in|close|chega perto/.test(s)) return "Aproximação lenta";
  if (/orbita|gira|360|em volta|around|orbit/.test(s)) return "Órbita lenta";
  if (/lateral|travelling|trilho|desliza|pan\b|tracking|dolly/.test(s)) return "Deslocamento lateral suave";
  if (/revela|abre o plano|plano geral|reveal/.test(s)) return "Revelação do ambiente";
  if (/de cima|top ?down|aereo|drone|overhead/.test(s)) return "Plano de cima";
  if (/na mao|handheld|tremid|pov/.test(s)) return "Câmera na mão";
  if (/fixa|parada|estatica|static|tripe/.test(s)) return "Câmera fixa";
  return padrao;
}
