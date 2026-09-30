/**
 * Contexto completo da marca: a fonte única que todo agente e toda geração
 * com IA do painel lê (frente SYNC, 30/09/2026).
 *
 * Pedido do dono: "tudo puxa o contexto completo das marcas, tudo é
 * sincronizado 100%". Antes cada função lia pedaços soltos (uma o kit, outra
 * o dossiê, outra o cérebro sem olhar a marca) e ninguém lia a estratégia
 * aprovada na Mesa Identidade nem as decisões do conselho.
 *
 * Um pacote só, montado SOBRE o que já existe (sem duplicar regra):
 * - a marca aberta: resolverMarca (marca.ts), pela regra única de herança
 *   (heranca-da-marca.ts): a marca que não é a principal só usa o que é dela;
 * - kit (paleta, logo, fontes, estilo, regras) e contexto consolidado
 *   (negócio, público, oferta, diferenciais, tom): kitComMarca e
 *   contextoComMarca;
 * - estratégia de marca da Mesa Identidade (a aprovada primeiro) e a
 *   tagline escolhida no Naming;
 * - o briefing mais novo da marca (o respondido primeiro);
 * - o dossiê atual da marca (juntarDossies + projetoDaMarcaAberta);
 * - as decisões do conselho (project_memory), sem as desfeitas;
 * - o cérebro do cliente (lerCerebro), filtrado pela marca e pela área;
 * - o Instagram da marca (contasDaMarcaDoCliente) e a última semana;
 * - referências e acervo da marca (filtrarReferenciasDaMarca, fotoDaMarca).
 *
 * Cache curto (90 s) por cliente e marca, com a leitura em curso
 * compartilhada: várias mensagens seguidas não releem o banco. Quem grava
 * algo que muda o contexto chama `esquecerContextoCompleto`.
 *
 * Nunca lança: a parte que falhou vira aviso (e log com o motivo) e o
 * resto segue. As regras puras (bloco com teto, "Usando: ...") moram em
 * contexto-completo-regras.ts, o mesmo arquivo da tela. Sem travessão.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  type AlvoDaMarca,
  contasDaMarcaDoCliente,
  contextoComMarca,
  filtrarReferenciasDaMarca,
  fontesDaMarca,
  kitComMarca,
  lerMarcaCompleta,
  type MarcaDoCliente,
  type MarcaLeve,
  marcasDoCliente,
  resolverMarca,
} from "./marca.ts";
import { type ContextoConsolidado, juntarDossies } from "./contexto-cliente.ts";
import { fotoDaMarcaAberta, projetoDaMarcaAberta } from "./heranca-da-marca.ts";
import { type AreaDoCerebro, AREAS_DO_CEREBRO, type BancoDoCerebro, type FatoDoCerebro, faltaNoBancoDoCerebro, lerCerebro, resumoParaPrompt } from "./cerebro-do-cliente.ts";
import { linhasDoBriefing } from "./pacote-externo.ts";
import { registrarFalha } from "./falha-registrada.ts";
import { normalizarEstrategia } from "./estrategia-de-marca.ts";
import {
  type AreaDoContexto,
  CEREBRO_DA_AREA,
  ehAreaDoContexto,
  ehDecisaoDoConselho,
  type EstrategiaDoPacote,
  estrategiaAprovada,
  estrategiaTemConteudo,
  type ItemUsado,
  itensUsados,
  linhaDoCerebroValeNaMarca,
  linhaDoUsando,
  marcaDaLinhaDoCerebro,
  montarBlocoDoPacote,
  type OpcoesDoBloco,
  type PacoteDaMarca,
  pacoteVazio,
  type ParteDoContexto,
  tetoDoContexto,
} from "./contexto-completo-regras.ts";

export const TTL_DO_CONTEXTO_COMPLETO_MS = 90_000;
export const MAX_MARCAS_NO_CACHE = 40;
const LIMITE_DO_DOSSIE = 6000;

/**
 * Onde está a marca: o id dela, o corpo do pedido (marca_id, project_id,
 * task_id), a marca já resolvida, ou nada (fica a principal, quando o
 * cliente tem marcas).
 */
export type AlvoDoContexto = string | null | undefined | AlvoDaMarca | MarcaDoCliente | MarcaLeve;

type Leitura = { pacote: PacoteDaMarca; fatos: FatoDoCerebro[] };

const guardados = new Map<string, { em: number; leitura: Leitura }>();
const emCurso = new Map<string, Promise<Leitura>>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idValido = (v: unknown): string | null => (typeof v === "string" && UUID.test(v) ? v : null);
// deno-lint-ignore no-explicit-any
type Banco = BancoDoCerebro | SupabaseClient | { from: (t: string) => any };
const comoSupabase = (db: Banco) => db as unknown as SupabaseClient;

/** Esquece o cliente (depois de gravar kit, contexto, briefing, estratégia, decisão ou regra). Sem cliente: tudo. */
export function esquecerContextoCompleto(clientId?: string) {
  if (!clientId) {
    guardados.clear();
    return;
  }
  Array.from(guardados.keys()).forEach((k) => {
    if (k.indexOf(`${clientId}|`) === 0) guardados.delete(k);
  });
}

/** Quantas leituras estão guardadas (para o teste). */
export function tamanhoDoCacheDoContexto(): number {
  return guardados.size;
}

// ------------------------------------------------------------------ a marca do pedido

function ehMarcaResolvida(a: unknown, clientId: string): a is MarcaLeve {
  if (!a || typeof a !== "object") return false;
  const m = a as Record<string, unknown>;
  return typeof m.principal === "boolean" && typeof m.nome === "string" && m.client_id === clientId && !!idValido(m.id);
}

async function marcaDoAlvo(db: Banco, clientId: string, alvo: AlvoDoContexto): Promise<MarcaDoCliente | null> {
  if (ehMarcaResolvida(alvo, clientId)) {
    const m = alvo as MarcaDoCliente;
    // A leve não tem o kit: relê a inteira (a equipe pode ter trocado a logo agora).
    if (Object.prototype.hasOwnProperty.call(m, "paleta")) return m;
    return await lerMarcaCompleta(comoSupabase(db), clientId, m.id);
  }
  if (typeof alvo === "string") return await resolverMarca(comoSupabase(db), clientId, { marca_id: alvo });
  if (alvo && typeof alvo === "object") return await resolverMarca(comoSupabase(db), clientId, alvo as AlvoDaMarca);
  return await resolverMarca(comoSupabase(db), clientId, null);
}

// ------------------------------------------------------------------ leitura

type Resposta = { data: unknown; error: { code?: string; message?: string } | null };

const texto = (v: unknown, max = 600) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);

function corDaPaleta(c: unknown): string {
  if (!c || typeof c !== "object") return "";
  const o = c as Record<string, unknown>;
  const partes = [texto(o.nome, 40), texto(o.hex, 12), o.papel ? `(${texto(o.papel, 20)})` : ""].filter(Boolean);
  return partes.join(" ");
}

async function lerTudo(db: Banco, clientId: string, alvo: AlvoDoContexto): Promise<Leitura> {
  const avisos: string[] = [];
  const s = comoSupabase(db);
  const seguro = async <T>(nome: string, fn: () => Promise<T>, vazio: T): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      const cod = e && typeof e === "object" ? (e as { code?: string }).code : undefined;
      // Tabela ou coluna que ainda não existe neste banco: a parte fica vazia, sem alarme.
      if (!faltaNoBancoDoCerebro({ code: cod, message: e instanceof Error ? e.message : String((e as { message?: string })?.message || "") })) {
        avisos.push(nome);
        registrarFalha(`contexto completo: ${nome} não lido`, e, { client_id: clientId });
      }
      return vazio;
    }
  };
  const verificar = (r: Resposta): unknown => {
    if (r && r.error) throw Object.assign(new Error(r.error.message || "erro do banco"), { code: r.error.code });
    return r ? r.data : null;
  };

  const marca = await seguro<MarcaDoCliente | null>("a marca", () => marcaDoAlvo(db, clientId, alvo), null);
  const marcas = marca ? await seguro<MarcaLeve[]>("as marcas", () => marcasDoCliente(s, clientId), []) : [];
  const idsDasMarcas = marcas.map((m) => m.id);

  const [perfil, kitBruto, fontes, dossie, leituraDoCerebro, referenciasDaMemoria, briefing, estrategia, decisoes, instagram, referencias, acervo] = await Promise.all([
    seguro("o nome do cliente", async () => verificar(await s.from("profiles").select("company_name, full_name").eq("id", clientId).maybeSingle() as unknown as Resposta) as Record<string, unknown> | null, null),
    seguro("o kit", async () => verificar(await s.from("cliente_kit_marca").select("paleta, logo_file_id, logo_path, logo_alt_path, logo_alt_file_id, estilo, regras, contexto").eq("client_id", clientId).maybeSingle() as unknown as Resposta) as Record<string, unknown> | null, null),
    seguro("as fontes", async () => {
      const r = await s.from("cliente_fontes").select(marca ? "nome, papel, marca_id" : "nome, papel").eq("client_id", clientId) as unknown as Resposta;
      return ((verificar(r) as Array<{ nome: string; papel: string; marca_id?: string | null }> | null) ?? []);
    }, [] as Array<{ nome: string; papel: string; marca_id?: string | null }>),
    seguro("o dossiê", async () => {
      const r = await s.from("client_dossiers").select("content, summary, dossier_type, project_id, created_at").eq("client_id", clientId).eq("is_current", true).order("created_at", { ascending: false }).limit(marca ? 12 : 3) as unknown as Resposta;
      const linhas = ((verificar(r) as Array<{ content: string | null; summary: string | null; dossier_type: string | null; project_id: string | null; created_at: string | null }> | null) ?? [])
        .filter((l) => projetoDaMarcaAberta(l.project_id, marca, marcas))
        .slice(0, 3);
      if (!linhas.length) return null;
      const juntado = juntarDossies(linhas, LIMITE_DO_DOSSIE);
      const data = linhas.map((l) => l.created_at || "").sort().pop() || null;
      return juntado ? { texto: juntado, data } : null;
    }, null as { texto: string; data: string | null } | null),
    seguro("o cérebro", async () => await lerCerebro(db as BancoDoCerebro, clientId), { fatos: [] as FatoDoCerebro[], fontes: {}, avisos: [] as string[] }),
    // Só com marcas: as regras dos agentes da Mesa do cliente guardam a marca no referencia_id.
    marca && idsDasMarcas.length
      ? seguro("a marca das regras", async () => {
        const r = await s.from("agente_memoria").select("id, referencia_id").eq("client_id", clientId).eq("ativa", true).in("referencia_id", idsDasMarcas).limit(500) as unknown as Resposta;
        const mapa: Record<string, string> = {};
        for (const l of ((verificar(r) as Array<{ id: string; referencia_id: string | null }> | null) ?? [])) if (l.referencia_id) mapa[String(l.id)] = String(l.referencia_id);
        return mapa;
      }, {} as Record<string, string>)
      : Promise.resolve({} as Record<string, string>),
    seguro("o briefing", () => lerBriefingDaMarca(s, clientId, marca), null),
    seguro("a estratégia", () => lerEstrategiaDaMarca(s, clientId, marca), null),
    seguro("as decisões do conselho", async () => {
      const r = await s.from("project_memory").select("id, title, content, tags, metadata, created_at").eq("client_id", clientId).eq("kind", "decisao").eq("source", "conselho").order("created_at", { ascending: false }).limit(12) as unknown as Resposta;
      return ((verificar(r) as Array<{ id: string; title: string | null; content: string | null; tags: string[] | null; metadata: Record<string, unknown> | null; created_at: string | null }> | null) ?? [])
        .filter((d) => (d.tags || []).indexOf("desfeita") < 0 && !(d.metadata || {}).desfeita_em)
        .filter((d) => linhaDoCerebroValeNaMarca(idValido((d.metadata || {}).marca_id), marca))
        .slice(0, 5)
        .map((d) => ({
          id: String(d.id),
          titulo: texto(String(d.title || "Decisão").replace(/^Conselho:\s*/i, ""), 160),
          resumo: texto((d.metadata || {}).resumo || d.content, 500),
          data: d.created_at,
        }));
    }, [] as PacoteDaMarca["decisoes"]),
    seguro("o Instagram", () => lerInstagramDaMarca(s, clientId, marca), null),
    seguro("as referências", async () => {
      const q = filtrarReferenciasDaMarca(s.from("cliente_referencias").select("id", { count: "exact", head: true }).eq("client_id", clientId).eq("ativa", true), marca);
      const r = await q as unknown as Resposta & { count: number | null };
      verificar(r);
      return r.count ?? 0;
    }, 0),
    seguro("o acervo", async () => {
      const r = await s.from("cliente_imagens").select("categoria, tags").eq("client_id", clientId).eq("ativa", true).limit(1000) as unknown as Resposta;
      const cats: Record<string, number> = {};
      let total = 0;
      for (const l of ((verificar(r) as Array<{ categoria: string | null; tags: string[] | null }> | null) ?? [])) {
        if (!fotoDaMarcaAberta(l.tags, marca)) continue;
        total++;
        const c = l.categoria || "sem_categoria";
        cats[c] = (cats[c] || 0) + 1;
      }
      return { total, cats };
    }, { total: 0, cats: {} as Record<string, number> }),
  ]);

  // Kit e contexto com a marca por cima (regra única de herança).
  const kitDoCliente = (kitBruto || {}) as Record<string, unknown>;
  const kit = kitComMarca({ ...kitDoCliente, contexto: kitDoCliente.contexto ?? {} } as Record<string, unknown>, marca);
  const contexto = marca
    ? (contextoComMarca((kitDoCliente.contexto && typeof kitDoCliente.contexto === "object" ? kitDoCliente.contexto : {}) as ContextoConsolidado, marca) as Record<string, unknown>)
    : ((kitDoCliente.contexto && typeof kitDoCliente.contexto === "object" ? kitDoCliente.contexto : {}) as Record<string, unknown>);
  const fontesDaMarcaAberta = marca ? fontesDaMarca(fontes, marca) : fontes;

  // Cérebro pela marca: a regra de outra marca não entra; a outra marca não herda o do cliente.
  const fatos = (leituraDoCerebro.fatos || []).filter((f) => {
    // A decisão do conselho já vem na parte "decisões" (sem repetir no cérebro).
    if (f.fonte === "memoria" && ehDecisaoDoConselho(f.texto)) return false;
    if (!marca) return true;
    if (f.fonte !== "memoria") return marca.principal;
    return linhaDoCerebroValeNaMarca(marcaDaLinhaDoCerebro(f.evidencia, referenciasDaMemoria[f.id], idsDasMarcas), marca);
  });

  const nomeCliente = texto((perfil && (perfil.company_name || perfil.full_name)) || "cliente", 120);
  const pacote: PacoteDaMarca = {
    ...pacoteVazio(clientId, nomeCliente),
    marca: marca ? { id: marca.id, nome: marca.nome, principal: marca.principal, outras: marcas.filter((m) => m.id !== marca.id).map((m) => m.nome) } : null,
    kit: {
      paleta: (Array.isArray(kit.paleta) ? kit.paleta : []).map(corDaPaleta).filter(Boolean).slice(0, 10),
      estilo: typeof kit.estilo === "string" && kit.estilo.trim() ? kit.estilo : null,
      regras: typeof kit.regras === "string" && kit.regras.trim() ? kit.regras : null,
      fontes: fontesDaMarcaAberta.map((f) => `${f.nome}${f.papel ? ` (${f.papel})` : ""}`).slice(0, 6),
      temLogo: !!(kit.logo_path || kit.logo_file_id),
    },
    contexto,
    estrategia,
    briefing,
    dossie,
    cerebro: null,
    decisoes,
    instagram,
    referencias: { referencias: referencias as number, acervo: acervo.total, categorias: acervo.cats },
    avisos,
    lido_em: new Date().toISOString(),
  };
  return { pacote, fatos };
}

/** Briefing mais novo da marca: o respondido primeiro; a outra marca só o dela, a principal o dela e o sem marca. */
async function lerBriefingDaMarca(s: SupabaseClient, clientId: string, marca: MarcaLeve | null): Promise<PacoteDaMarca["briefing"]> {
  let q = s.from("briefings").select("id, titulo, responses, submitted, created_at, enviado_em, marca_id, arquivado_em").eq("client_id", clientId);
  if (marca && !marca.principal) q = q.eq("marca_id", marca.id);
  else if (marca) q = q.or(`marca_id.is.null,marca_id.eq.${marca.id}`);
  let r = await q.order("created_at", { ascending: false }).limit(8) as unknown as Resposta;
  if (r.error) {
    // Banco sem as colunas novas do briefing: a outra marca fica sem (nunca herda da principal).
    if (marca && !marca.principal) throw Object.assign(new Error(r.error.message || "briefing"), { code: r.error.code });
    r = await s.from("briefings").select("id, responses, submitted, created_at").eq("client_id", clientId).order("created_at", { ascending: false }).limit(8) as unknown as Resposta;
    if (r.error) throw Object.assign(new Error(r.error.message || "briefing"), { code: r.error.code });
  }
  const lista = ((r.data as Array<Record<string, unknown>> | null) ?? [])
    .filter((b) => !b.arquivado_em && b.responses && typeof b.responses === "object" && Object.keys(b.responses as object).length);
  const b = lista.filter((x) => x.submitted === true)[0] || lista[0];
  if (!b) return null;
  const linhas = linhasDoBriefing(b.responses);
  if (!linhas.length) return null;
  return {
    id: idValido(b.id),
    titulo: typeof b.titulo === "string" && b.titulo.trim() ? b.titulo.trim().slice(0, 120) : null,
    data: String(b.enviado_em || b.created_at || "") || null,
    enviado: b.submitted === true,
    linhas,
  };
}

/**
 * Estratégia da marca na Mesa Identidade: a do projeto mais recente com a
 * etapa Estratégia concluída (aprovada); sem aprovada, a em construção. A
 * outra marca só a do projeto dela; a principal, a sem marca e a dela.
 */
async function lerEstrategiaDaMarca(s: SupabaseClient, clientId: string, marca: MarcaLeve | null): Promise<EstrategiaDoPacote | null> {
  let q = s.from("idv_projetos").select("id, titulo, marca_id, concluidas, dados, versao, estado, atualizado_em").eq("client_id", clientId).neq("estado", "arquivado");
  if (marca && !marca.principal) q = q.eq("marca_id", marca.id);
  else if (marca) q = q.or(`marca_id.is.null,marca_id.eq.${marca.id}`);
  const r = await q.order("atualizado_em", { ascending: false }).limit(10) as unknown as Resposta;
  if (r.error) throw Object.assign(new Error(r.error.message || "estratégia"), { code: r.error.code });
  const projetos = ((r.data as Array<Record<string, unknown>> | null) ?? []).filter((p) => {
    const d = p.dados && typeof p.dados === "object" ? (p.dados as Record<string, unknown>) : {};
    return estrategiaTemConteudo(d.estrategia);
  });
  const p = projetos.filter((x) => estrategiaAprovada(x.concluidas))[0] || projetos[0];
  if (!p) return null;
  const d = (p.dados || {}) as Record<string, unknown>;
  const naming = d.naming && typeof d.naming === "object" ? (d.naming as Record<string, unknown>) : {};
  const e = normalizarEstrategia(d.estrategia);
  return {
    projeto_id: String(p.id),
    titulo: texto(p.titulo, 120) || "Identidade",
    versao: typeof p.versao === "number" ? p.versao : 1,
    aprovada: estrategiaAprovada(p.concluidas),
    atualizado_em: e.atualizado_em || (typeof p.atualizado_em === "string" ? p.atualizado_em : null),
    estrategia: e as unknown as Record<string, unknown>,
    tagline: typeof naming.slogan === "string" && naming.slogan.trim() ? naming.slogan.trim().slice(0, 140) : null,
    nome: typeof naming.nome === "string" && naming.nome.trim() ? naming.nome.trim().slice(0, 80) : null,
  };
}

/** Instagram da marca: as contas dela (contasDaMarcaDoCliente) e a última semana medida. */
async function lerInstagramDaMarca(s: SupabaseClient, clientId: string, marca: MarcaLeve | null): Promise<PacoteDaMarca["instagram"]> {
  const ids = await contasDaMarcaDoCliente(s, clientId, marca);
  if (ids && !ids.length) return null;
  let q = s.from("external_accounts").select("id, platform, handle, display_name, status").eq("client_id", clientId);
  if (ids) q = q.in("id", ids);
  const r = await q.limit(20) as unknown as Resposta;
  if (r.error) throw Object.assign(new Error(r.error.message || "contas"), { code: r.error.code });
  const contas = ((r.data as Array<{ id: string; platform: string | null; handle: string | null; display_name: string | null; status: string | null }> | null) ?? [])
    .filter((c) => /instagram/i.test(String(c.platform || "")) && c.status !== "inactive");
  if (!contas.length) return null;
  const m = await s.from("social_metrics_weekly").select("external_account_id, week_start, followers, reach").eq("client_id", clientId).in("external_account_id", contas.map((c) => c.id)).order("week_start", { ascending: false }).limit(1) as unknown as Resposta;
  const semana = !m.error ? ((m.data as Array<{ week_start: string | null; followers: number | null; reach: number | null }> | null) ?? [])[0] : undefined;
  return {
    contas: contas.map((c) => String(c.handle || c.display_name || "").replace(/^@/, "")).filter(Boolean).slice(0, 4),
    seguidores: semana && typeof semana.followers === "number" ? semana.followers : null,
    alcance: semana && typeof semana.reach === "number" ? semana.reach : null,
    semana: semana ? semana.week_start : null,
  };
}

// ------------------------------------------------------------------ API

/** Áreas do cérebro válidas (as fixas do banco), com a geral. */
function areasDoCerebro(lista: string[]): AreaDoCerebro[] {
  const validas = lista.filter((a): a is AreaDoCerebro => (AREAS_DO_CEREBRO as readonly string[]).indexOf(a) >= 0);
  return validas.length ? validas : ["geral"];
}

const REGRAS = ["evitar", "reprovado", "preferencia", "ajuste"];

/**
 * O pacote da marca para uma área. `areasDoCerebro` troca as áreas lidas do
 * cérebro (padrão: as da área); `limiteCerebro` é o teto do resumo dele.
 */
export async function lerContextoCompletoDaMarca(
  db: Banco,
  clientId: string,
  alvo: AlvoDoContexto,
  opcoes: { area?: AreaDoContexto; areasDoCerebro?: string[]; limiteCerebro?: number; agora?: number; semCache?: boolean } = {},
): Promise<PacoteDaMarca> {
  if (!idValido(clientId)) return pacoteVazio(clientId);
  const area: AreaDoContexto = opcoes.area && ehAreaDoContexto(opcoes.area) ? opcoes.area : "geral";
  const marcaDaChave = typeof alvo === "string" ? alvo : alvo && typeof alvo === "object" ? (idValido((alvo as Record<string, unknown>).marca_id) || (ehMarcaResolvida(alvo, clientId) ? (alvo as MarcaLeve).id : null) || idValido((alvo as Record<string, unknown>).project_id) || idValido((alvo as Record<string, unknown>).task_id) || "-") : "-";
  const chave = `${clientId}|${marcaDaChave}`;
  const agora = opcoes.agora ?? Date.now();
  let leitura: Leitura | null = null;
  const g = opcoes.semCache ? undefined : guardados.get(chave);
  if (g && agora - g.em <= TTL_DO_CONTEXTO_COMPLETO_MS) leitura = g.leitura;
  if (!leitura) {
    const pendente = emCurso.get(chave);
    if (pendente) leitura = await pendente;
    else {
      const promessa = lerTudo(db, clientId, alvo).catch((e) => {
        registrarFalha("contexto completo: leitura falhou", e, { client_id: clientId });
        return { pacote: { ...pacoteVazio(clientId), avisos: ["o contexto"], lido_em: new Date().toISOString() }, fatos: [] as FatoDoCerebro[] };
      });
      emCurso.set(chave, promessa);
      try {
        leitura = await promessa;
      } finally {
        emCurso.delete(chave);
      }
      if (guardados.size >= MAX_MARCAS_NO_CACHE) {
        const primeira = guardados.keys().next();
        if (!primeira.done) guardados.delete(primeira.value);
      }
      // Leitura com falha não fica guardada: a próxima mensagem tenta de novo.
      if (!leitura.pacote.avisos.length) guardados.set(chave, { em: Date.now(), leitura });
    }
  }
  const areas = areasDoCerebro(opcoes.areasDoCerebro && opcoes.areasDoCerebro.length ? opcoes.areasDoCerebro : CEREBRO_DA_AREA[area]);
  const limite = Math.min(Math.max(opcoes.limiteCerebro ?? 1500, 300), 6000);
  const resumo = resumoParaPrompt(leitura.fatos, { areas, limite });
  const conjunto = new Set<string>(areas.concat(["geral"]));
  const regras = leitura.fatos.filter((f) => f.fonte === "memoria" && conjunto.has(f.area) && REGRAS.indexOf(f.categoria) >= 0).length;
  return { ...leitura.pacote, cerebro: resumo.texto ? { texto: resumo.texto, regras, fatos: resumo.usados } : null };
}

export type ContextoParaPrompt = { bloco: string; usando: string; itens: ItemUsado[]; pacote: PacoteDaMarca };

/**
 * Atalho de quem monta o prompt: o pacote, o bloco dentro do teto da área e
 * a linha "Usando: ..." (só com as partes que entraram). Nunca lança.
 */
export async function contextoCompletoParaPrompt(
  db: Banco,
  clientId: string,
  alvo: AlvoDoContexto,
  opcoes: OpcoesDoBloco & { areasDoCerebro?: string[]; limiteCerebro?: number; semCache?: boolean } = {},
): Promise<ContextoParaPrompt> {
  const area: AreaDoContexto = opcoes.area && ehAreaDoContexto(opcoes.area) ? opcoes.area : "geral";
  const teto = tetoDoContexto(area, opcoes.teto);
  const pacote = await lerContextoCompletoDaMarca(db, clientId, alvo, {
    area,
    areasDoCerebro: opcoes.areasDoCerebro,
    limiteCerebro: opcoes.limiteCerebro ?? Math.round(teto * 0.3),
    semCache: opcoes.semCache,
  });
  const bloco = montarBlocoDoPacote(pacote, { area, teto, partes: opcoes.partes, semTitulo: opcoes.semTitulo });
  const itens = itensUsados(pacote, opcoes.partes);
  return { bloco, usando: linhaDoUsando(itens, pacote.avisos), itens, pacote };
}

export type { AreaDoContexto, ItemUsado, PacoteDaMarca, ParteDoContexto };
