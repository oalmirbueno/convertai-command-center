/**
 * Marcas por projeto dentro do mesmo cliente (frente G, fase 2, pedido do
 * dono em 25/09: "na Acerbi tem o projeto da Acerbi e o da CME, com logo
 * diferente; se misturar tudo vira bagunça").
 *
 * Tabela public.cliente_marcas (docs/marcas/01_cliente_marcas.sql). Regras:
 * - cliente sem marca cadastrada: nada muda (toda função aqui devolve o que
 *   recebeu, e a leitura das marcas falha em silêncio se a tabela não existe);
 * - a marca vem, nesta ordem, do projeto do item (tarefa ou proposta), do
 *   marca_id que a tela manda (casca das mesas) e, sem pista, da principal;
 * - marca de outro cliente nunca vale: a lista é sempre a do cliente do pedido;
 * - marca principal: o kit do cliente, com o que ela tiver preenchido por cima;
 * - outra marca: logo e paleta só dela (nunca do cliente); estilo, regras e
 *   tom do cliente quando ela deixa vazio; contexto extra soma ao do cliente;
 *   referências só as dela; fontes as dela e, sem nenhuma, as do cliente.
 *
 * Quem usa: estudio-arte (kit, logo, fontes, referências, contexto),
 * agente-calendario (contexto, projeto do mês, direção ao gravar), mesa-ads e
 * mesa-foto (contexto do cliente).
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { type ContextoConsolidado, lerContextoConsolidado, lerMarcaParaDirecao } from "./contexto-cliente.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O que a lista de marcas do cliente traz (leve, guardada por pouco tempo). */
export type MarcaLeve = {
  id: string;
  client_id: string;
  project_id: string | null;
  nome: string;
  principal: boolean;
  ordem?: number | null;
};

/** A marca inteira, com o kit próprio (mesmo formato de cliente_kit_marca). */
export type MarcaDoCliente = MarcaLeve & {
  paleta: unknown;
  logo_file_id: string | null;
  logo_alt_file_id: string | null;
  logo_path: string | null;
  logo_alt_path: string | null;
  estilo: string | null;
  regras: string | null;
  tom: string | null;
  contexto: Record<string, unknown> | null;
  contexto_extra: string | null;
};

/** Pistas para achar a marca de um pedido. Aceita o corpo do pedido ou um trabalho do Estúdio. */
export type AlvoDaMarca = {
  marca_id?: unknown;
  project_id?: unknown;
  task_id?: unknown;
  direcao?: unknown;
} | null | undefined;

const COLUNAS_LEVES = "id, client_id, project_id, nome, principal, ordem";
const COLUNAS_COMPLETAS =
  "id, client_id, project_id, nome, principal, ordem, paleta, logo_file_id, logo_alt_file_id, logo_path, logo_alt_path, estilo, regras, tom, contexto, contexto_extra";

const idValido = (v: unknown): string | null => (typeof v === "string" && UUID.test(v) ? v : null);
const temTexto = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

// ------------------------------------------------------------ regras puras

/** marca_id do pedido, ou o gravado na direção do trabalho (direcao.marca_id, Estúdio Ads). */
export function marcaIdDoAlvo(alvo: AlvoDaMarca): string | null {
  if (!alvo) return null;
  const direto = idValido(alvo.marca_id);
  if (direto) return direto;
  const d = alvo.direcao;
  if (d && typeof d === "object" && !Array.isArray(d)) return idValido((d as Record<string, unknown>).marca_id);
  return null;
}

/**
 * A marca do pedido dentro da lista do cliente. Projeto manda (o item é
 * daquele projeto); depois o marca_id da tela; sem pista, a principal.
 * Projeto que não é de nenhuma marca fica com a principal. Lista vazia: null.
 */
export function escolherMarca<M extends MarcaLeve>(marcas: M[], pista: { project_id?: string | null; marca_id?: string | null }): M | null {
  if (!marcas.length) return null;
  const principal = marcas.find((m) => m.principal) ?? null;
  if (pista.project_id) {
    return marcas.find((m) => m.project_id === pista.project_id) ?? principal;
  }
  if (pista.marca_id) {
    return marcas.find((m) => m.id === pista.marca_id) ?? principal;
  }
  return principal;
}

/**
 * Projetos que são da marca: a marca que não é principal fica só com o
 * projeto dela; a principal fica com todos os outros (os que não são de
 * nenhuma outra marca). Sem marca: todos.
 */
export function projetosDaMarca(marca: MarcaLeve | null, marcas: MarcaLeve[], projetos: string[]): string[] {
  if (!marca) return projetos;
  if (!marca.principal) return marca.project_id ? projetos.filter((p) => p === marca.project_id) : [];
  const deOutras = new Set(marcas.filter((m) => m.id !== marca.id && m.project_id).map((m) => m.project_id as string));
  return projetos.filter((p) => !deOutras.has(p));
}

type KitBase = {
  paleta?: unknown;
  logo_file_id?: string | null;
  logo_alt_file_id?: string | null;
  logo_path?: string | null;
  logo_alt_path?: string | null;
  estilo?: string | null;
  regras?: string | null;
  contexto?: unknown;
} & Record<string, unknown>;

/**
 * Kit do cliente com a marca por cima. Sem marca devolve o mesmo objeto.
 * Principal: cada campo preenchido na marca vale; o resto é do cliente.
 * Outra marca: logo e paleta só dela; estilo e regras dela ou do cliente.
 */
export function kitComMarca<K extends KitBase | null>(kit: K, marca: MarcaDoCliente | null): K {
  if (!marca) return kit;
  const base: KitBase = kit ? { ...kit } : {};
  const paletaDaMarca = Array.isArray(marca.paleta) && marca.paleta.length ? marca.paleta : null;
  if (marca.principal) {
    if (paletaDaMarca) base.paleta = paletaDaMarca;
    if (marca.logo_path || marca.logo_file_id) {
      base.logo_path = marca.logo_path;
      base.logo_file_id = marca.logo_file_id;
    }
    if (marca.logo_alt_path || marca.logo_alt_file_id) {
      base.logo_alt_path = marca.logo_alt_path;
      base.logo_alt_file_id = marca.logo_alt_file_id;
    }
  } else {
    base.paleta = paletaDaMarca ?? [];
    base.logo_path = marca.logo_path;
    base.logo_file_id = marca.logo_file_id;
    base.logo_alt_path = marca.logo_alt_path;
    base.logo_alt_file_id = marca.logo_alt_file_id;
  }
  if (temTexto(marca.estilo)) base.estilo = marca.estilo;
  if (temTexto(marca.regras)) base.regras = marca.regras;
  if ("contexto" in base || marca.contexto) {
    const c = base.contexto && typeof base.contexto === "object" ? (base.contexto as ContextoConsolidado) : {};
    base.contexto = contextoComMarca(c, marca);
  }
  return base as K;
}

/**
 * Contexto consolidado do cliente com a marca por cima: campos preenchidos no
 * contexto da marca valem, o tom da marca vale sobre o tom do cliente, e o
 * contexto extra entra em campo próprio (marca). A descrição da logo do
 * cliente não vale para outra marca.
 */
export function contextoComMarca(base: ContextoConsolidado, marca: MarcaDoCliente | null): ContextoConsolidado & { marca?: Record<string, unknown> } {
  if (!marca) return base;
  const saida: Record<string, unknown> = { ...(base || {}) };
  const daMarca = marca.contexto && typeof marca.contexto === "object" ? marca.contexto : {};
  for (const k of Object.keys(daMarca)) {
    const v = (daMarca as Record<string, unknown>)[k];
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
    saida[k] = v;
  }
  if (temTexto(marca.tom)) saida.tom_de_voz = marca.tom;
  if (!marca.principal && !(daMarca as Record<string, unknown>).logo) delete saida.logo;
  saida.marca = {
    nome: marca.nome,
    principal: marca.principal,
    contexto_extra: temTexto(marca.contexto_extra) ? marca.contexto_extra.slice(0, 4000) : null,
  };
  return saida as ContextoConsolidado & { marca?: Record<string, unknown> };
}

/**
 * Fontes da marca: principal fica com as do cliente (sem marca) e as dela;
 * outra marca fica com as dela e, sem nenhuma, com as do cliente.
 */
export function fontesDaMarca<F extends { marca_id?: string | null }>(fontes: F[], marca: MarcaLeve | null): F[] {
  if (!marca) return fontes;
  const doCliente = fontes.filter((f) => !f.marca_id);
  if (marca.principal) return fontes.filter((f) => !f.marca_id || f.marca_id === marca.id);
  const dela = fontes.filter((f) => f.marca_id === marca.id);
  return dela.length ? dela : doCliente;
}

/** Colunas da consulta com marca_id só quando há marca (sem a tabela, a coluna não existe). */
export function colunasComMarca(colunas: string, marca: MarcaLeve | null): string {
  return marca ? `${colunas}, marca_id` : colunas;
}

/**
 * Filtro de referências da marca numa consulta do PostgREST: principal vê as
 * do cliente (sem marca) e as dela; outra marca só as dela. Sem marca, a
 * consulta volta intacta.
 */
export function filtrarReferenciasDaMarca<Q>(consulta: Q, marca: MarcaLeve | null): Q {
  if (!marca) return consulta;
  // Tipo solto de propósito: o construtor do PostgREST estoura a inferência do TypeScript.
  const c = consulta as unknown as { eq: (coluna: string, valor: unknown) => unknown; or: (filtro: string) => unknown };
  if (marca.principal) return c.or(`marca_id.is.null,marca_id.eq.${marca.id}`) as Q;
  return c.eq("marca_id", marca.id) as Q;
}

/** marca_id para gravar numa linha nova (referência ou fonte): só de outra marca. */
export function marcaParaGravar(marca: MarcaLeve | null): { marca_id: string } | Record<string, never> {
  return marca && !marca.principal ? { marca_id: marca.id } : {};
}

/**
 * Bloco curto para os prompts: qual marca é esta e que não se mistura com a
 * outra do mesmo cliente. Vazio sem marca.
 */
export function blocoDaMarca(marca: MarcaDoCliente | null, outras: MarcaLeve[] = []): string {
  if (!marca) return "";
  const nomesOutras = outras.filter((m) => m.id !== marca.id).map((m) => m.nome);
  const linhas = [
    `MARCA DESTE TRABALHO: ${marca.nome}${marca.principal ? " (marca principal do cliente)" : " (marca própria dentro do cliente, com projeto, logo e identidade separados)"}.`,
    "Use só a logo, as cores, as referências e o tom desta marca.",
  ];
  if (nomesOutras.length) linhas.push(`Não misture com ${nomesOutras.length === 1 ? "a outra marca do cliente" : "as outras marcas do cliente"}: ${nomesOutras.join(", ")}.`);
  if (temTexto(marca.contexto_extra)) linhas.push(`Sobre a marca ${marca.nome}: ${marca.contexto_extra.slice(0, 4000)}`);
  return linhas.join("\n");
}

// ------------------------------------------------------------ leitura

const VALIDADE_DA_LISTA_MS = 30_000;
const listas = new Map<string, { em: number; marcas: MarcaLeve[] }>();

/** Esquece a lista guardada (depois de editar uma marca, ou nos testes). */
export function esquecerMarcas(clientId?: string) {
  if (clientId) listas.delete(clientId);
  else listas.clear();
}

/**
 * Marcas do cliente, guardadas por 30 s por cliente. Tabela ausente, erro ou
 * cliente sem marca: lista vazia (e nada muda para ele).
 */
export async function marcasDoCliente(db: SupabaseClient, clientId: string): Promise<MarcaLeve[]> {
  if (!idValido(clientId)) return [];
  const guardada = listas.get(clientId);
  if (guardada && Date.now() - guardada.em < VALIDADE_DA_LISTA_MS) return guardada.marcas;
  let marcas: MarcaLeve[] = [];
  try {
    const { data, error } = await db.from("cliente_marcas").select(COLUNAS_LEVES).eq("client_id", clientId).order("ordem", { ascending: true });
    marcas = error ? [] : ((data as MarcaLeve[] | null) ?? []).filter((m) => m.client_id === clientId);
  } catch {
    marcas = [];
  }
  listas.set(clientId, { em: Date.now(), marcas });
  return marcas;
}

/** A marca inteira (kit incluído), sempre relida: a equipe pode ter trocado a logo agora. */
export async function lerMarcaCompleta(db: SupabaseClient, clientId: string, marcaId: string): Promise<MarcaDoCliente | null> {
  try {
    const { data, error } = await db.from("cliente_marcas").select(COLUNAS_COMPLETAS).eq("id", marcaId).eq("client_id", clientId).maybeSingle();
    if (error || !data) return null;
    return data as MarcaDoCliente;
  } catch {
    return null;
  }
}

async function projetoDaTarefa(db: SupabaseClient, taskId: string): Promise<string | null> {
  try {
    const { data } = await db.from("tasks").select("project_id").eq("id", taskId).maybeSingle();
    return idValido((data as { project_id?: string } | null)?.project_id ?? null);
  } catch {
    return null;
  }
}

/**
 * A marca de um pedido: projeto (ou tarefa) primeiro, depois o marca_id da
 * tela ou da direção, e a principal sem pista. Cliente sem marca: null, sem
 * ler a tarefa.
 */
export async function resolverMarca(db: SupabaseClient, clientId: string, alvo: AlvoDaMarca): Promise<MarcaDoCliente | null> {
  const marcas = await marcasDoCliente(db, clientId);
  if (!marcas.length) return null;
  let projectId = idValido(alvo?.project_id);
  if (!projectId) {
    const taskId = idValido(alvo?.task_id);
    if (taskId) projectId = await projetoDaTarefa(db, taskId);
  }
  const escolhida = escolherMarca(marcas, { project_id: projectId, marca_id: marcaIdDoAlvo(alvo) });
  return escolhida ? await lerMarcaCompleta(db, clientId, escolhida.id) : null;
}

/** Marca pelo que a tela mandou no corpo (marca_id, project_id ou task_id). */
export function marcaDoPedido(db: SupabaseClient, clientId: string, corpo: Record<string, unknown> | null | undefined) {
  return resolverMarca(db, clientId, corpo ? { marca_id: corpo.marca_id, project_id: corpo.project_id, task_id: corpo.task_id } : null);
}

/** Projetos do cliente que são da marca (sem marca, os mesmos). */
export async function projetosDoClienteNaMarca(db: SupabaseClient, clientId: string, marca: MarcaLeve | null, projetos: string[]): Promise<string[]> {
  if (!marca) return projetos;
  return projetosDaMarca(marca, await marcasDoCliente(db, clientId), projetos);
}

/** Contexto consolidado do cliente com a marca por cima. */
export async function lerContextoDaMarca(db: SupabaseClient, clientId: string, marca: MarcaDoCliente | null) {
  const base = await lerContextoConsolidado(db, clientId);
  return contextoComMarca(base, marca);
}

/**
 * Marca pronta para o compositor de direção (mesma forma de
 * lerMarcaParaDirecao), com a marca por cima. Sem marca, a do cliente.
 */
export async function lerMarcaParaDirecaoDaMarca(db: SupabaseClient, clientId: string, marca: MarcaDoCliente | null) {
  const base = await lerMarcaParaDirecao(db, clientId);
  if (!marca) return base;
  let fontes = base.fontes;
  try {
    const { data, error } = await db.from("cliente_fontes").select("nome, papel, marca_id").eq("client_id", clientId);
    if (!error && data) fontes = fontesDaMarca(data as { nome: string; papel: string; marca_id: string | null }[], marca).map((f) => ({ nome: f.nome, papel: f.papel }));
  } catch {
    // fica com as fontes do cliente
  }
  const kit = kitComMarca(
    { paleta: base.paleta, estilo: base.estilo, regras: base.regras, logo_path: base.temLogo ? "cliente" : null, logo_file_id: null },
    marca,
  );
  const contexto = contextoComMarca({ tom_de_voz: base.tomDeVoz ?? undefined, tipografia: base.tipografiaCitada ?? undefined }, marca);
  return {
    ...base,
    nomeCliente: marca.principal ? base.nomeCliente : marca.nome.slice(0, 120),
    paleta: Array.isArray(kit.paleta) ? kit.paleta as { nome?: string; hex?: string; papel?: string }[] : [],
    estilo: (kit.estilo as string | null) ?? null,
    regras: (kit.regras as string | null) ?? null,
    fontes,
    tipografiaCitada: contexto.tipografia ?? null,
    tomDeVoz: contexto.tom_de_voz ?? null,
    temLogo: !!(kit.logo_path || kit.logo_file_id),
  };
}
