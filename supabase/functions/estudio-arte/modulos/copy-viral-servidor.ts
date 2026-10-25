/**
 * Motor de copy viral no servidor (frente COPY-V, 23/10/2026): banco de
 * ganchos, perfil do nicho do cliente, o bloco da skill "copy viral do nicho",
 * a escolha da melhor versão com o Jev (conferência da casa mais as 5 notas
 * virais, numa chamada só) e o modelo da copy lembrado por cliente.
 *
 * Mora em estudio-arte/modulos (o _shared está no teto da publicação); o Mês
 * (agente-calendario) e os Stories (mesa-stories) importam daqui. Nunca lança
 * por leitura: sem banco ou sem Jev, o texto sai como antes, com o motivo no log.
 */

import { conferirCopies, type PedidoDaConferencia, type ResultadoDaConferencia } from "../../_shared/motor-de-copy-servidor.ts";
import { jevPerguntar } from "../../_shared/jev.ts";
import { carregarModelo, modeloPadrao, type ModeloIa } from "../../_shared/ia-motor.ts";
import { registrarFalha } from "../../_shared/falha-registrada.ts";
import {
  blocoDaCopyViral,
  type ContextoDaCopy,
  escolherGanchos,
  type FiltroDosGanchos,
  type FormatoDoGancho,
  type Gancho,
  lerViralidade,
  nichosDoTexto,
  type NotaViral,
  ordemComViralidade,
  PAPEL_DA_COPY,
  passadaFinal,
  perguntasDaViralidade,
  porqueViral,
  ROTULO_DO_NICHO,
} from "./copy-viral.ts";

// deno-lint-ignore no-explicit-any
type Banco = { from: (tabela: string) => any };

// ------------------------------------------------------------------ banco de ganchos

const TTL_DOS_GANCHOS_MS = 10 * 60_000;
const cacheDosGanchos = new Map<string, { em: number; lista: Gancho[] }>();

/** Para teste: esvazia o cache entre casos. */
export function limparCacheDosGanchos() {
  cacheDosGanchos.clear();
}

/**
 * De 8 a 15 ganchos do banco para o prompt, pelo nicho (sempre com "geral"),
 * formato e gatilho. Leitura com cache de 10 min por conjunto de nichos.
 * Falha da leitura: lista vazia (o prompt segue só com o guia).
 */
export async function lerGanchos(db: Banco, f: FiltroDosGanchos): Promise<Gancho[]> {
  const nichos = f.nichos.indexOf("geral") >= 0 ? f.nichos.slice() : f.nichos.concat(["geral"]);
  const chave = nichos.slice().sort().join(",");
  const agora = Date.now();
  let lista: Gancho[] | null = null;
  const guardado = cacheDosGanchos.get(chave);
  if (guardado && agora - guardado.em < TTL_DOS_GANCHOS_MS) lista = guardado.lista;
  if (!lista) {
    try {
      const { data, error } = await db
        .from("ganchos_vencedores")
        .select("id, formula, exemplo, por_que_funciona, gatilho, formato, nichos, tom, nivel_de_ousadia")
        .eq("ativo", true)
        .overlaps("nichos", nichos)
        .limit(400);
      if (error) throw error;
      lista = (data ?? []) as Gancho[];
      cacheDosGanchos.set(chave, { em: agora, lista });
    } catch (e) {
      registrarFalha("copy-viral: banco de ganchos não lido (o prompt segue com o guia)", e, { nichos: chave });
      return [];
    }
  }
  return escolherGanchos(lista, { ...f, nichos });
}

// ------------------------------------------------------------------ perfil do nicho

export type PerfilDoNicho = {
  cliente: string;
  segmento: string | null;
  nichos: string[];
  publico: string | null;
  dor: string | null;
  oferta: string | null;
  negocio: string | null;
};

const curto = (v: unknown, n = 600): string | null => {
  if (v == null) return null;
  const s = (typeof v === "string" ? v : JSON.stringify(v)).replace(/\s+/g, " ").trim();
  return s && s !== "{}" && s !== "[]" && s !== "null" ? s.slice(0, n) : null;
};

/** Nome, segmento, público, dor e oferta do cliente (cadastro, kit de marca e CRM). Nunca lança. */
export async function perfilDoNicho(db: Banco, clientId: string): Promise<PerfilDoNicho> {
  try {
    const [perfil, kit, org] = await Promise.all([
      db.from("profiles").select("full_name, company_name").eq("id", clientId).maybeSingle(),
      db.from("cliente_kit_marca").select("contexto").eq("client_id", clientId).maybeSingle(),
      db.from("commercial_organizations").select("segment").eq("client_id", clientId).not("segment", "is", null).limit(1),
    ]);
    const p = (perfil && perfil.data) as { full_name: string | null; company_name: string | null } | null;
    const ctx = (((kit && kit.data) as { contexto?: Record<string, unknown> | null } | null)?.contexto ?? {}) as Record<string, unknown>;
    const segmento = ((((org && org.data) ?? []) as Array<{ segment: string | null }>)[0]?.segment) ?? null;
    const negocio = curto(ctx.negocio ?? ctx.descricao ?? ctx.sobre);
    const produtos = curto(ctx.produtos ?? ctx.servicos);
    const cliente = (p && (p.company_name || p.full_name) || "").trim() || "Cliente";
    return {
      cliente,
      segmento,
      nichos: nichosDoTexto(segmento, negocio, produtos, cliente),
      publico: curto(ctx.publico ?? ctx.publico_alvo ?? ctx.persona),
      dor: curto(ctx.dores ?? ctx.dor ?? ctx.problemas ?? ctx.objecoes),
      oferta: curto(ctx.oferta ?? ctx.produtos ?? ctx.servicos),
      negocio,
    };
  } catch (e) {
    registrarFalha("copy-viral: perfil do nicho não lido", e, { client_id: clientId });
    return { cliente: "Cliente", segmento: null, nichos: ["geral"], publico: null, dor: null, oferta: null, negocio: null };
  }
}

/** Os nichos em palavras (para o prompt e para o Jev). */
export function nichosEmTexto(nichos: string[]): string {
  const especificos = nichos.filter((n) => n !== "geral");
  return especificos.length ? especificos.map((n) => ROTULO_DO_NICHO[n] || n).join(" e ") : "negócio local (sem nicho cadastrado)";
}

// ------------------------------------------------------------------ o bloco da skill

export type PreparoDaCopyViral = {
  bloco: string;
  ganchos: Gancho[];
  nichos: string[];
  contexto: ContextoDaCopy;
  perfil: PerfilDoNicho;
};

export type PedidoDoPreparo = {
  clientId: string;
  formato: FormatoDoGancho;
  versoes?: number;
  /** Quantos exemplos (8 a 15). */
  n?: number;
  semente?: string;
  gatilhos?: string[];
  /** O que a mesa já leu (cérebro, base, hype, trending, mundo real, pedido): vale sobre o perfil quando vem. */
  contexto?: Partial<ContextoDaCopy>;
  /** Para teste: o perfil já lido. */
  perfil?: PerfilDoNicho;
};

/**
 * O bloco "SKILL: COPY VIRAL DO NICHO" para o pedido ao modelo: contexto forte,
 * ganchos do banco (exemplos) e o guia da casa. Nunca lança.
 */
export async function prepararCopyViral(db: Banco, p: PedidoDoPreparo): Promise<PreparoDaCopyViral> {
  const perfil = p.perfil ?? (await perfilDoNicho(db, p.clientId));
  const extra = p.contexto ?? {};
  const pega = (k: keyof ContextoDaCopy, padrao: string | null) => {
    const v = extra[k];
    return v != null && String(v).trim() ? String(v) : padrao;
  };
  const contexto: ContextoDaCopy = {
    cliente: pega("cliente", perfil.cliente),
    nicho: pega("nicho", [nichosEmTexto(perfil.nichos), perfil.segmento, perfil.negocio].filter(Boolean).join(" | ")),
    publico: pega("publico", perfil.publico),
    dor: pega("dor", perfil.dor),
    oferta: pega("oferta", perfil.oferta),
    ensinou: pega("ensinou", null),
    hype: pega("hype", null),
    trending: pega("trending", null),
    mundo_real: pega("mundo_real", null),
  };
  const ganchos = await lerGanchos(db, { nichos: perfil.nichos, formato: p.formato, n: p.n, semente: p.semente, gatilhos: p.gatilhos });
  return { bloco: blocoDaCopyViral({ contexto, ganchos, formato: p.formato, versoes: p.versoes }), ganchos, nichos: perfil.nichos, contexto, perfil };
}

// ------------------------------------------------------------------ escolha com o Jev

export type PedidoDaEscolhaViral = PedidoDaConferencia & {
  /** O nicho e o público em palavras (vão ao estado do Jev). */
  nicho: string;
  publico?: string | null;
  /** Contexto, pedido e item do plano: base do corte do que não tem fonte. */
  fontes: unknown;
  /** Sem as 5 notas virais (a legenda, que precisa ser rápida): só a conferência da casa, humanizer e corte. */
  semViral?: boolean;
};

export type ResultadoDaEscolhaViral = ResultadoDaConferencia & {
  /** As 5 notas virais de cada versão, na ordem escrita. */
  virais: NotaViral[];
  /** Nota combinada (conferência da casa e viral), na ordem escrita. */
  combinadas: number[];
  /** Cada versão depois do humanizer e do corte do que não tem fonte, na ordem escrita. */
  finais: string[];
  mudancas: string[][];
  cortes: string[][];
  /** A linha da escolhida para a tela. */
  porque_viral: string;
};

/**
 * Gerar a mais e escolher: a conferência da casa (voz, fato inventado,
 * promessa, clichê) e as 5 notas virais vão na MESMA chamada ao Jev. A ordem
 * final põe o alerta por último e a nota combinada na frente; cada versão sai
 * com o humanizer e sem o que não tem fonte. Sem laço: nada volta ao modelo.
 */
export async function escolherComViralidade(p: PedidoDaEscolhaViral): Promise<ResultadoDaEscolhaViral> {
  const base = p.jev ?? jevPerguntar;
  let respostas: Record<string, { score?: number }> | null = null;
  const comViral: typeof jevPerguntar = async (args, opcoes) => {
    const estado = (args.state && typeof args.state === "object" ? args.state : {}) as Record<string, unknown>;
    const n = Object.keys((estado.copies as Record<string, unknown>) || {}).length;
    const r = await base({
      state: { ...estado, nicho: p.nicho || "negócio local", publico: (p.publico || "o público da marca").slice(0, 900) },
      questions: { ...args.questions, ...perguntasDaViralidade(n) },
    }, opcoes);
    respostas = r.answers as Record<string, { score?: number }>;
    return r;
  };
  const conf = await conferirCopies(p.semViral ? p : { ...p, jev: comViral });
  const virais = lerViralidade(respostas, conf.textos.length);
  const ordem = ordemComViralidade(conf.conferencias.map((c) => ({ indice: c.indice, nota: c.nota, alerta: c.alerta })), virais);
  const passadas = conf.textos.map((t) => passadaFinal(t, p.fontes));
  const combinadas = conf.textos.map((_, i) => {
    const o = ordem.filter((x) => x.indice === i)[0];
    return o ? o.combinada : 0;
  });
  return {
    ...conf,
    ordem: ordem.map((o) => o.indice),
    virais,
    combinadas,
    finais: passadas.map((x, i) => x.texto || conf.textos[i]),
    mudancas: passadas.map((x) => x.mudancas),
    cortes: passadas.map((x) => x.cortes),
    porque_viral: ordem.length ? porqueViral(ordem[0].viral) : "",
  };
}

// ------------------------------------------------------------------ modelo da copy

/**
 * 23/10 (dono): três seletores, cada um no seu escopo e lembrado por cliente em coluna própria:
 * a copy do conteúdo (lâminas, peça, detalhar e conteúdos do Mês), o refinar copy e o estrategista.
 */
export type EscopoDoModelo = "copy" | "refino" | "estrategista" | "roteiro" | "site";

export const COLUNA_DO_ESCOPO: Record<EscopoDoModelo, string> = {
  copy: "modelo_copy_id",
  refino: "modelo_refino_id",
  estrategista: "modelo_estrategista_id",
  // 23/10 (frente B): o motor e o agente de roteiro (migration 20261023180000).
  roteiro: "modelo_roteiro_id",
  // 25/10 (Mesa Site): a copy da página (migration 20261025120000).
  site: "modelo_copy_site_id",
};

/** O id guardado para o cliente no escopo (mesa_cliente_config); sem coluna ou sem linha, null. */
export async function modeloGuardadoDoCliente(db: Banco, clientId: string, escopo: EscopoDoModelo): Promise<string | null> {
  const coluna = COLUNA_DO_ESCOPO[escopo];
  try {
    const { data, error } = await db.from("mesa_cliente_config").select(coluna).eq("client_id", clientId).maybeSingle();
    if (error || !data) return null;
    const v = (data as Record<string, unknown>)[coluna];
    const id = typeof v === "string" ? v.trim() : "";
    return id || null;
  } catch {
    return null;
  }
}

/** O id guardado da copy do conteúdo (compatível com a rodada anterior). */
export async function modeloDaCopyGuardado(db: Banco, clientId: string): Promise<string | null> {
  return await modeloGuardadoDoCliente(db, clientId, "copy");
}

/**
 * O modelo do escopo: o pedido na chamada; senão o lembrado do cliente; senão
 * o padrão (copy e refino: o marcado "copy" no catálogo, o melhor para copy;
 * estrategista: null, e a mesa segue com o padrão de hoje). null: a mesa segue
 * com o modelo de antes (nada quebra sem a migration).
 */
export async function modeloDoEscopo(db: Banco, clientId: string, escopo: EscopoDoModelo, pedido?: unknown, opcoes: { semPadrao?: boolean } = {}): Promise<ModeloIa | null> {
  const ids = [typeof pedido === "string" ? pedido.trim() : "", await modeloGuardadoDoCliente(db, clientId, escopo)].filter((x): x is string => !!x);
  for (const id of ids) {
    try {
      return await carregarModelo(id, "texto");
    } catch (e) {
      registrarFalha("copy-viral: modelo escolhido não carregou (segue o padrão)", e, { client_id: clientId, modelo_id: id, escopo });
    }
  }
  if (escopo === "estrategista" || escopo === "roteiro" || opcoes.semPadrao) return null;
  return await modeloPadrao(PAPEL_DA_COPY).catch(() => null);
}

/**
 * Só a escolha explícita da copy do conteúdo (a da tela ou a lembrada do cliente), sem o padrão.
 * 23/10 (dono): na direção do Estúdio, sem escolha continua o diretor de arte de hoje (a parte
 * visual aprovada não muda sozinha).
 */
export async function modeloDaCopyEscolhido(db: Banco, clientId: string, pedido?: unknown): Promise<ModeloIa | null> {
  return await modeloDoEscopo(db, clientId, "copy", pedido, { semPadrao: true });
}

/** O modelo do refinar copy (o pedido, o lembrado do cliente ou o melhor para copy). */
export async function modeloDoRefino(db: Banco, clientId: string, pedido?: unknown): Promise<ModeloIa | null> {
  return await modeloDoEscopo(db, clientId, "refino", pedido);
}

/**
 * O modelo que escreve a copy: o pedido na chamada; senão o lembrado para o
 * cliente; senão o padrão "copy" do catálogo (o melhor para copy). null: a
 * mesa segue com o modelo de antes (nada quebra sem a migration).
 */
export async function modeloDaCopy(db: Banco, clientId: string, pedido?: unknown): Promise<ModeloIa | null> {
  return await modeloDoEscopo(db, clientId, "copy", pedido);
}
