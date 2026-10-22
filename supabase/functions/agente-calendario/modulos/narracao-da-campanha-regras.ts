/**
 * Narração da peça de vídeo da campanha (22/10/2026, dono: "no gerar vídeo coloque a opção de narração e
 * trilhas com ElevenLabs para juntar no vídeo"). Regras puras que a ação campanha_narracao, a tela
 * (GerarVideoDaCampanha) e os testes usam: as falas do roteiro na ordem, o texto que vai para a voz, o
 * custo de tabela antes e se a narração gravada ainda bate com as falas. Os preços e o tratamento do texto
 * são os da Mesa Motion (mesa-motion/modulos/narracao.ts). Sem travessão.
 */

import { MODELO_DE_VOZ_PADRAO, modeloDeVoz, type ModeloDeVoz, semTags, textoParaOModelo } from "../../mesa-motion/modulos/narracao.ts";
import type { CenaDoRoteiro, RoteiroDeVideo } from "./roteiro-de-video.ts";

const arred = (n: number) => Math.round(n * 1e6) / 1e6;

/** As falas das cenas que têm fala, na ordem do roteiro. */
export function falasDaNarracao(r: RoteiroDeVideo | null | undefined): Array<{ ordem: number; texto: string }> {
  if (!r) return [];
  return r.cenas.filter((c) => !!semTags(c.fala)).map((c) => ({ ordem: c.ordem, texto: c.fala }));
}

/** O texto lido (as falas juntas, separadas por linha em branco): o que fica gravado para conferir depois. */
export const textoDaNarracao = (r: RoteiroDeVideo | null | undefined) => falasDaNarracao(r).map((f) => f.texto).join("\n\n");

export interface PedidoDaNarracao {
  modelo: ModeloDeVoz;
  /** O texto que vai para a ElevenLabs (sem tag quando o modelo não entende tag). */
  enviado: string;
  caracteres: number;
  custo_usd: number;
}

/** O pedido da voz e o custo de tabela (caracteres enviados vezes o preço do modelo, como a Mesa Motion cobra). */
export function pedidoDaNarracao(r: RoteiroDeVideo | null | undefined, modeloId?: unknown): PedidoDaNarracao {
  const modelo = modeloDeVoz(modeloId || MODELO_DE_VOZ_PADRAO);
  const enviado = falasDaNarracao(r)
    .map((f) => textoParaOModelo(f.texto, modelo))
    .filter(Boolean)
    .join("\n\n");
  return { modelo, enviado, caracteres: enviado.length, custo_usd: arred((enviado.length / 1000) * modelo.preco_1k_usd) };
}

export type SituacaoDaNarracao = "sem_falas" | "falta" | "desatualizada" | "em_dia";

/** Sem fala não precisa de voz; com fala, a narração gravada precisa ter lido exatamente estas falas. */
export function situacaoDaNarracao(r: RoteiroDeVideo | null | undefined): SituacaoDaNarracao {
  const texto = textoDaNarracao(r);
  if (!texto) return "sem_falas";
  if (!r || !r.narracao) return "falta";
  return r.narracao.texto === texto ? "em_dia" : "desatualizada";
}

const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
};

/** Assinatura curta do que a cena em vídeo mostra (a descrição e os segundos). */
export const assinaturaDaCena = (c: Pick<CenaDoRoteiro, "descricao" | "segundos">) => fnv(`${String(c.descricao || "").trim()}|${Math.round(Number(c.segundos) || 0)}`);

/** Respiro antes e depois da fala dentro da cena, como na Mesa Motion. */
export const RESPIRO_ANTES_S = 0.35;
export const RESPIRO_DEPOIS_S = 0.5;
export const CENA_MINIMA_S = 2;

/**
 * Quanto cada cena dura no vídeo: com a narração em dia, o respiro antes + a fala + o respiro depois (nunca
 * menos de 2 s, nunca cortando a fala); sem fala ou sem narração, os segundos do roteiro.
 */
export function duracoesDasCenas(r: RoteiroDeVideo): Array<{ ordem: number; duracao_s: number; fala: { de_s: number; ate_s: number } | null }> {
  const n = situacaoDaNarracao(r) === "em_dia" && r.narracao ? r.narracao : null;
  return r.cenas.map((c) => {
    const t = n ? n.cenas.find((x) => x.ordem === c.ordem) : null;
    if (!t) return { ordem: c.ordem, duracao_s: c.segundos, fala: null };
    const precisa = RESPIRO_ANTES_S + (t.ate_s - t.de_s) + RESPIRO_DEPOIS_S;
    return { ordem: c.ordem, duracao_s: Math.round(Math.max(CENA_MINIMA_S, precisa) * 100) / 100, fala: { de_s: t.de_s, ate_s: t.ate_s } };
  });
}
