/**
 * O que a equipe ensina na conversa do agente de contexto (modo marca) vira
 * uma ação JÁ FEITA, com Desfazer (frente AG, 26/09: "eu peço, ele já vai
 * fazendo"). Antes o kit e a memória mudavam calados, sem volta; agora a
 * mudança aparece no cartão "Feito na hora" e o Desfazer devolve o valor de
 * antes (executor-do-plano.ts: kit_estilo, kit_regras, kit_paleta,
 * preencher_contexto e gravar_decisao, que já existem e já sabem voltar).
 *
 * Regra 6 do contrato (_shared/acoes-do-agente.ts): sem custo e com reverso,
 * o pedido claro vai direto. Esta área já gravava direto na conversa; o teto
 * de itens é o da conversa (MAX_ITENS_DO_KIT), não o geral.
 *
 * Sem import de Deno: o vitest lê este arquivo.
 */
import { type AcaoDoAgente, type ItemDaAcaoDoAgente, type RegraDaOperacao, resumoPadrao, TIPO_DA_ACAO } from "../_shared/acoes-do-agente.ts";

export const MAX_ITENS_DO_KIT = 20;
const HEX = /^#[0-9A-F]{6}$/;
const CAMPOS = ["negocio", "publico", "oferta", "tom_de_voz"] as const;
const ROTULO_DO_CAMPO: Record<string, string> = { negocio: "Negócio", publico: "Público", oferta: "Oferta", tom_de_voz: "Tom de voz" };

/** As operações desta ação: todas sem custo e com Desfazer no executor do plano. */
export const REGRAS_DO_KIT_NA_CONVERSA: Record<string, Pick<RegraDaOperacao, "direta">> = {
  kit_estilo: { direta: true },
  kit_regras: { direta: true },
  kit_paleta: { direta: true },
  preencher_contexto: { direta: true },
  gravar_decisao: { direta: true },
};

const umaLinha = (v: unknown, max: number) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
const textoLimpo = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export type RespostaDoModeloNaConversa = {
  estilo?: unknown;
  regras?: unknown;
  paleta?: unknown;
  contexto?: unknown;
  memoria?: unknown;
};

/**
 * Monta a ação (ainda não feita) com o que o modelo devolveu e o kit de
 * agora. Campo igual ao atual não entra. Nada para mudar: null.
 */
export function acaoDoKitNaConversa(
  o: RespostaDoModeloNaConversa,
  atual: { estilo?: string | null; regras?: string | null; contexto?: Record<string, unknown> | null },
  clientId: string,
  id?: string,
): { acao: AcaoDoAgente; mudou: string[]; memorias: number } | null {
  const itens: ItemDaAcaoDoAgente[] = [];
  const dados: Record<string, Record<string, unknown>> = {};
  const mudou: string[] = [];
  const add = (item: ItemDaAcaoDoAgente, carga: Record<string, unknown>) => {
    itens.push(item);
    dados[`${item.operacao}:${item.ref}`] = carga;
  };

  const estilo = textoLimpo(o.estilo, 3000);
  if (estilo && estilo !== String(atual.estilo || "").trim()) {
    add({ ref: "e1", alvo_id: "estilo", titulo: "Estilo do kit", detalhe: atual.estilo ? "substitui o atual" : "estava vazio", operacao: "kit_estilo", rotulo: "gravar", para: null, para_rotulo: umaLinha(estilo, 140) }, { estilo });
    mudou.push("estilo");
  }
  const regras = textoLimpo(o.regras, 3000);
  if (regras && regras !== String(atual.regras || "").trim()) {
    add({ ref: "g1", alvo_id: "regras", titulo: "Regras do kit", detalhe: atual.regras ? "substitui as atuais" : "estavam vazias", operacao: "kit_regras", rotulo: "gravar", para: null, para_rotulo: umaLinha(regras, 140) }, { regras });
    mudou.push("regras");
  }
  if (Array.isArray(o.paleta) && o.paleta.length) {
    const paleta = (o.paleta as unknown[])
      .map((p) => {
        const x = (p ?? {}) as Record<string, unknown>;
        return { nome: umaLinha(x.nome, 40), hex: umaLinha(x.hex, 7).toUpperCase(), papel: umaLinha(x.papel, 20) };
      })
      .filter((p) => HEX.test(p.hex))
      .slice(0, 8);
    if (paleta.length) {
      add({ ref: "a1", alvo_id: "paleta", titulo: "Paleta do kit", detalhe: `${paleta.length} ${paleta.length === 1 ? "cor" : "cores"}`, operacao: "kit_paleta", rotulo: "gravar", para: null, para_rotulo: paleta.map((p) => p.hex).join(" ") }, { paleta });
      mudou.push("paleta");
    }
  }
  const ctx = o.contexto && typeof o.contexto === "object" ? (o.contexto as Record<string, unknown>) : null;
  if (ctx) {
    const antes = atual.contexto || {};
    CAMPOS.forEach((campo, i) => {
      const valor = textoLimpo(ctx[campo], 1200);
      if (!valor || valor === String(antes[campo] || "").trim()) return;
      add({ ref: `c${i + 1}`, alvo_id: campo, titulo: ROTULO_DO_CAMPO[campo], detalhe: antes[campo] ? "substitui o atual" : "estava vazio", operacao: "preencher_contexto", rotulo: "preencher", para: null, para_rotulo: umaLinha(valor, 140) }, { campo, valor });
      mudou.push(campo);
    });
  }
  let memorias = 0;
  for (const m of (Array.isArray(o.memoria) ? o.memoria : []).slice(0, 5)) {
    const x = (m ?? {}) as Record<string, unknown>;
    const agente = String(x.agente || "");
    const tipo = String(x.tipo || "");
    const texto = umaLinha(x.texto, 600);
    if (["estrategista", "diretor_arte"].indexOf(agente) < 0 || ["aprendizado", "preferencia", "evitar"].indexOf(tipo) < 0 || !texto) continue;
    memorias++;
    const area = agente === "diretor_arte" ? "arte" : "calendario";
    add({ ref: `d${memorias}`, alvo_id: "cerebro", titulo: umaLinha(texto, 200), detalhe: agente === "diretor_arte" ? "para o diretor de arte" : "para o estrategista", operacao: "gravar_decisao", rotulo: "ensinar", para: null }, { area, categoria: tipo, texto });
  }
  if (!itens.length) return null;
  const acao: AcaoDoAgente = {
    tipo: TIPO_DA_ACAO,
    agente: "contexto",
    id: id || `kit-${Date.now().toString(36)}`,
    resumo: mudou.length ? `Atualizei o kit (${mudou.length} ${mudou.length === 1 ? "campo" : "campos"})${memorias ? ` e ensinei ${memorias} ${memorias === 1 ? "coisa" : "coisas"} aos agentes` : ""}.` : resumoPadrao(itens),
    itens: itens.slice(0, MAX_ITENS_DO_KIT),
    ignorados: [],
    recusados: [],
    contexto: { client_id: clientId, tipo: "kit_na_conversa", dados },
  };
  return { acao, mudou, memorias };
}
