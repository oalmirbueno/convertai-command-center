/**
 * Pacote de contexto do cliente para o prompt de qualquer agente (frente AG,
 * 26/09), no padrão do diretor de fotografia (mesa-foto/diretor.ts,
 * contextoComCache): cache curto no servidor e leitura em curso
 * compartilhada. Cada mensagem do agente não relê o banco; trocar de
 * cliente lê de novo.
 *
 * Frente SYNC (30/09): a leitura agora é a do contexto completo da marca
 * (_shared/contexto-completo-da-marca.ts), pela regra da herança. Antes
 * este leitor via só o cérebro inteiro e o dossiê geral do cliente, sem
 * olhar a marca (a CME recebia o dossiê e as regras da Acerbi). Agora:
 * - `marca` (id, corpo do pedido ou a marca resolvida) escolhe a marca; sem
 *   ela, a principal do cliente (cliente de uma marca só: como sempre);
 * - por padrão entram as partes que completam quem já lê o kit e o contexto
 *   (marca, estratégia aprovada, briefing mais novo, dossiê, decisões do
 *   conselho, cérebro filtrado e Instagram); `partes` troca a lista;
 * - tudo cabe no teto (cérebro + dossiê + a folga das partes novas).
 *
 * Nunca lança: sem leitura, o texto volta vazio e o agente segue (o cliente
 * sem dossiê ainda tem conversa). Sem travessão.
 */
import type { AreaDoCerebro, BancoDoCerebro } from "./cerebro-do-cliente.ts";
import { type AlvoDoContexto, contextoCompletoParaPrompt, esquecerContextoCompleto } from "./contexto-completo-da-marca.ts";
import { type AreaDoContexto, PARTES_COMPLEMENTARES, PARTES_DO_CONTEXTO, type ParteDoContexto } from "./contexto-completo-regras.ts";

export { PARTES_COMPLEMENTARES };
/** O complemento mais o contexto de negócio (negócio, público, oferta, diferenciais e tom): para quem ainda não o lê. */
export const PARTES_COM_O_CONTEXTO: ParteDoContexto[] = PARTES_COMPLEMENTARES.concat(["contexto"]);
/** Tudo (kit, contexto e referências também): para quem não lê nada da marca por conta própria. */
export const TODAS_AS_PARTES: ParteDoContexto[] = PARTES_DO_CONTEXTO.slice();

export const TTL_DO_CONTEXTO_MS = 120_000;
export const MAX_CLIENTES_NO_CACHE = 40;
/** Folga do teto para as partes que vieram com a frente SYNC (estratégia, briefing, decisões, marca, Instagram). */
export const FOLGA_DO_CONTEXTO_COMPLETO = 3500;

type Guardado = { em: number; texto: string; usando: string };

/** A área do bloco pela primeira área do cérebro pedida (a ordem das partes segue a área). */
export function areaDoBloco(areas: AreaDoCerebro[]): AreaDoContexto {
  const a = areas[0] || "geral";
  if (a === "foto") return "foto";
  if (a === "arte") return "arte";
  if (a === "copy") return "copy";
  if (a === "calendario") return "calendario";
  if (a === "campanha") return "campanha";
  if (a === "ads" || a === "conta") return "ads";
  return "geral";
}

function chaveDaMarca(m: AlvoDoContexto): string {
  if (!m) return "-";
  if (typeof m === "string") return m;
  const o = m as Record<string, unknown>;
  return String(o.id || o.marca_id || o.project_id || o.task_id || "-");
}

/**
 * Cria o leitor com cache (um por função: o cache vive enquanto a instância
 * da Edge Function estiver quente). `ler` devolve o bloco pronto para o
 * sistema, com teto; `usando` devolve a linha "Usando: ..." da última leitura.
 */
export function criarContextoDoAgente(opcoes: { ttlMs?: number; max?: number } = {}) {
  const ttl = opcoes.ttlMs ?? TTL_DO_CONTEXTO_MS;
  const max = opcoes.max ?? MAX_CLIENTES_NO_CACHE;
  const guardados = new Map<string, Guardado>();
  const emCurso = new Map<string, Promise<Guardado>>();

  async function lerComUsando(
    db: BancoDoCerebro,
    clientId: string,
    areas: AreaDoCerebro[],
    limites: { cerebro?: number; dossie?: number; agora?: number; marca?: AlvoDoContexto; partes?: ParteDoContexto[]; area?: AreaDoContexto; teto?: number } = {},
  ): Promise<Guardado> {
    const partes = limites.partes && limites.partes.length ? limites.partes : PARTES_COMPLEMENTARES;
    const chave = `${clientId}|${chaveDaMarca(limites.marca)}|${areas.join(",")}|${limites.cerebro ?? ""}|${limites.dossie ?? ""}|${partes.join(",")}|${limites.area ?? ""}|${limites.teto ?? ""}`;
    const agora = limites.agora ?? Date.now();
    const g = guardados.get(chave);
    if (g && agora - g.em <= ttl) return g;
    if (g) guardados.delete(chave);
    const pendente = emCurso.get(chave);
    if (pendente) return await pendente;
    const cerebro = limites.cerebro ?? 1200;
    const dossie = limites.dossie ?? 2500;
    const promessa = contextoCompletoParaPrompt(db, clientId, limites.marca ?? null, {
      area: limites.area ?? areaDoBloco(areas),
      teto: limites.teto ?? cerebro + dossie + FOLGA_DO_CONTEXTO_COMPLETO,
      partes,
      areasDoCerebro: areas,
      limiteCerebro: cerebro,
      semTitulo: true,
    })
      .then((c) => ({ em: Date.now(), texto: String(c.bloco || "").trim(), usando: c.usando }), () => ({ em: Date.now(), texto: "", usando: "" }))
      .then((novo) => {
        if (guardados.size >= max) {
          const primeira = guardados.keys().next();
          if (!primeira.done) guardados.delete(primeira.value);
        }
        guardados.set(chave, novo);
        return novo;
      });
    emCurso.set(chave, promessa);
    try {
      return await promessa;
    } finally {
      emCurso.delete(chave);
    }
  }

  async function ler(
    db: BancoDoCerebro,
    clientId: string,
    areas: AreaDoCerebro[],
    limites: { cerebro?: number; dossie?: number; agora?: number; marca?: AlvoDoContexto; partes?: ParteDoContexto[]; area?: AreaDoContexto; teto?: number } = {},
  ): Promise<string> {
    return (await lerComUsando(db, clientId, areas, limites)).texto;
  }

  /** Esquece o cliente (depois de gravar algo que muda o dossiê, o cérebro, o kit ou a estratégia). */
  function esquecer(clientId: string) {
    Array.from(guardados.keys()).forEach((k) => {
      if (k.indexOf(`${clientId}|`) === 0) guardados.delete(k);
    });
    esquecerContextoCompleto(clientId);
  }

  return { ler, lerComUsando, esquecer, tamanho: () => guardados.size };
}

/** Bloco com título para o sistema do agente (vazio quando não há nada). */
export function blocoDoContextoDoCliente(texto: string, nome?: string | null): string {
  const t = String(texto || "").trim();
  if (!t) return "";
  return `CONTEXTO DO CLIENTE${nome ? ` (${nome})` : ""}: contexto completo da marca aberta (estratégia, briefing, dossiê, decisões do conselho e cérebro do painel). Use para decidir; não repita inteiro; vale sobre suposição sua.\n${t}`;
}
