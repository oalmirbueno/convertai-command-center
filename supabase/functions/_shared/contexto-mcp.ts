/**
 * O que chegou pelo MCP do painel para um cliente, como contexto dos agentes
 * da Mesa (dono, 26/09: "faltou uma área do cliente de MCP; o mês e tudo que
 * é gerado se baseia também no MCP").
 *
 * Fontes (tudo que o MCP grava, lido com a chave de serviço):
 * - orientacao: aceleriq_client_instruction (project_memory com a etiqueta
 *   orientacao_da_mesa). Vale para o planejamento por padrão.
 * - dossie: dossiê atual gravado por uma credencial do MCP
 *   (aceleriq_upsert_current_dossier; actor oauth:... ou id de chave). Vale por padrão.
 * - memoria: aceleriq_upsert_project_memory (metadata.origin). Desligada por padrão.
 * - arquivo: arquivos enviados pelo MCP (bucket mcp-files, texto extraído em
 *   file_content_chunks). Desligado por padrão.
 * - rascunho: rascunho do Estúdio (aceleriq_studio_draft, studio_docs não
 *   publicado). Desligado por padrão.
 *
 * A equipe liga e desliga cada item na área MCP do Contexto do cliente; a
 * escolha mora em mesa_mcp_itens (SQL M-01). Sem a tabela, valem os padrões e
 * a troca avisa que falta aplicar o SQL.
 *
 * Sem import de Deno nem de npm: os testes (vitest) leem o mesmo arquivo com
 * um banco falso.
 */

export type FonteMcp = "orientacao" | "dossie" | "memoria" | "arquivo" | "rascunho";
export const FONTES_MCP: FonteMcp[] = ["orientacao", "dossie", "memoria", "arquivo", "rascunho"];
export const TABELA_DOS_ITENS_MCP = "mesa_mcp_itens";
/** Etiqueta que aceleriq_client_instruction põe na memória. */
export const ETIQUETA_DA_ORIENTACAO = "orientacao_da_mesa";

export type ItemMcp = {
  fonte: FonteMcp;
  id: string;
  titulo: string;
  resumo: string;
  /** Quem mandou (ChatGPT, Codex, Hermes...). */
  origem: string;
  quando: string | null;
  /** Caracteres do conteúdo (arquivo: tamanho do arquivo em bytes). */
  tamanho: number;
  ativo: boolean;
  /** O ativo veio do padrão da fonte (a equipe ainda não escolheu). */
  padrao: boolean;
  /** Público que a orientação declarou (aceleriq_client_instruction). */
  publico?: string | null;
};

export type PreferenciaMcp = { fonte: string; item_id: string; ativo: boolean };

/** O que vale para o planejamento sem a equipe escolher. */
export function ativoPorPadrao(fonte: FonteMcp): boolean {
  return fonte === "orientacao" || fonte === "dossie";
}

export function chaveDoItem(fonte: string, id: string): string {
  return `${fonte}:${id}`;
}

/** Liga a escolha da equipe (mesa_mcp_itens) aos itens; sem escolha, o padrão da fonte. */
export function aplicarPreferencias<T extends Pick<ItemMcp, "fonte" | "id">>(itens: T[], prefs: PreferenciaMcp[] | null | undefined): Array<T & { ativo: boolean; padrao: boolean }> {
  const mapa = new Map<string, boolean>();
  for (const p of prefs || []) if (p && typeof p.ativo === "boolean") mapa.set(chaveDoItem(String(p.fonte), String(p.item_id)), p.ativo);
  return itens.map((i) => {
    const k = chaveDoItem(i.fonte, i.id);
    return mapa.has(k) ? { ...i, ativo: mapa.get(k) === true, padrao: false } : { ...i, ativo: ativoPorPadrao(i.fonte), padrao: true };
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Dossiê gravado por credencial do MCP (OAuth, chave de API ou "mcp"); o painel e o ciclo gravam com "painel:" e "ciclo". */
export function dossieVeioDoMcp(actor: string | null | undefined): boolean {
  const a = String(actor || "").trim();
  if (!a) return false;
  if (a.indexOf("oauth:") === 0 || a.indexOf("mcp") === 0 || a.indexOf("api:") === 0) return true;
  return UUID.test(a);
}

/** Memória gravada pelo MCP: o servidor do MCP sempre põe metadata.origin. */
export function memoriaVeioDoMcp(metadata: unknown): boolean {
  return !!metadata && typeof metadata === "object" && typeof (metadata as Record<string, unknown>).origin === "string";
}

export function ehOrientacao(linha: { tags?: unknown; metadata?: unknown }): boolean {
  const tags = Array.isArray(linha.tags) ? (linha.tags as unknown[]).map(String) : [];
  const meta = (linha.metadata && typeof linha.metadata === "object" ? linha.metadata : {}) as Record<string, unknown>;
  return tags.indexOf(ETIQUETA_DA_ORIENTACAO) >= 0 || meta.tipo === "orientacao_do_cliente";
}

const umaLinha = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Quem mandou, legível: a fonte que a credencial escreveu, sem o id da chave. */
export function origemLegivel(source: unknown, actor?: unknown): string {
  const s = umaLinha(source, 80);
  if (s && s.indexOf("oauth:") !== 0) return s;
  const a = String(actor || "");
  if (a.indexOf("oauth:") === 0) return "MCP (conta conectada)";
  return s || "MCP";
}

const ROTULO_DA_FONTE: Record<FonteMcp, string> = {
  orientacao: "Orientação",
  dossie: "Dossiê",
  memoria: "Memória",
  arquivo: "Arquivo",
  rascunho: "Rascunho do Estúdio",
};

export const rotuloDaFonte = (f: FonteMcp) => ROTULO_DA_FONTE[f] || f;

/**
 * Bloco do prompt com os itens ativos e o conteúdo de cada um, até `limite`
 * caracteres (orientações primeiro, depois dossiê, arquivo, memória e
 * rascunho; dentro da fonte, o mais novo primeiro). Vazio quando não há.
 */
export function blocoDoMcp(itens: Array<Pick<ItemMcp, "fonte" | "titulo" | "origem" | "quando" | "publico"> & { conteudo: string }>, limite: number): string {
  if (!itens.length || limite <= 0) return "";
  const ordem: FonteMcp[] = ["orientacao", "dossie", "arquivo", "memoria", "rascunho"];
  const lista = itens.slice().sort((a, b) => ordem.indexOf(a.fonte) - ordem.indexOf(b.fonte) || String(b.quando || "").localeCompare(String(a.quando || "")));
  const partes: string[] = [];
  let usado = 0;
  let cortados = 0;
  for (const i of lista) {
    const cabeca = `=== ${rotuloDaFonte(i.fonte)}: ${umaLinha(i.titulo, 160) || "sem título"} (${umaLinha(i.origem, 60) || "MCP"}${i.quando ? `, ${String(i.quando).slice(0, 10)}` : ""}) ===${i.publico ? `\nPúblico declarado: ${umaLinha(i.publico, 400)}` : ""}\n`;
    const sobra = limite - usado - cabeca.length;
    if (sobra <= 200) {
      cortados++;
      continue;
    }
    const corpo = i.conteudo.length > sobra ? `${i.conteudo.slice(0, sobra)}\n[cortado para caber]` : i.conteudo;
    partes.push(cabeca + corpo);
    usado += cabeca.length + corpo.length;
  }
  if (!partes.length) return "";
  return `\nCONTEXTO VINDO DO MCP (itens que a equipe deixou valendo para o planejamento; siga as orientações)${cortados ? ` [${cortados} item(ns) não couberam]` : ""}:\n${partes.join("\n\n")}\n`;
}

// ------------------------------------------------------------------ banco

// deno-lint-ignore no-explicit-any
export type BancoMinimo = { from: (tabela: string) => any };

type LinhaMemoria = { id: string; title: string | null; content: string | null; kind: string | null; source: string | null; tags: string[] | null; metadata: Record<string, unknown> | null; created_at: string | null };
type LinhaDossie = { id: string; dossier_type: string | null; project_id: string | null; version: number | null; summary: string | null; content: string | null; actor: string | null; source: string | null; effective_at: string | null };
type LinhaArquivo = { id: string; file_name: string | null; mime_type: string | null; size_bytes: number | null; created_at: string | null; description: string | null };
type LinhaRascunho = { project_id: string; notes: string | null; updated_at: string | null; published: boolean | null };

export type ItemMcpComConteudo = ItemMcp & { conteudo: string };

const semTabela = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache/i.test(String(e.message || "")));

/** Escolhas da equipe; sem a tabela (SQL M-01 não aplicado), lista vazia. */
export async function lerPreferenciasMcp(db: BancoMinimo, clientId: string): Promise<{ prefs: PreferenciaMcp[]; tabela: boolean }> {
  try {
    const { data, error } = await db.from(TABELA_DOS_ITENS_MCP).select("fonte, item_id, ativo").eq("client_id", clientId).limit(2000);
    if (error) return { prefs: [], tabela: !semTabela(error) };
    return { prefs: (data ?? []) as PreferenciaMcp[], tabela: true };
  } catch {
    return { prefs: [], tabela: false };
  }
}

/**
 * Tudo que chegou pelo MCP para o cliente, com o conteúdo (texto de arquivo só
 * quando `comTextoDosArquivos`, que custa uma leitura a mais por arquivo).
 */
export async function itensMcpDoCliente(
  db: BancoMinimo,
  clientId: string,
  opcoes: { comTextoDosArquivos?: (ids: string[]) => boolean; maxCharsPorArquivo?: number } = {},
): Promise<{ itens: ItemMcpComConteudo[]; tabela: boolean }> {
  const [memorias, dossies, arquivos, projetos, prefs] = await Promise.all([
    db.from("project_memory").select("id, title, content, kind, source, tags, metadata, created_at")
      .eq("client_id", clientId).not("metadata->origin", "is", null).order("created_at", { ascending: false }).limit(200),
    db.from("client_dossiers").select("id, dossier_type, project_id, version, summary, content, actor, source, effective_at")
      .eq("client_id", clientId).eq("is_current", true).order("effective_at", { ascending: false }).limit(60),
    db.from("files").select("id, file_name, mime_type, size_bytes, created_at, description")
      .eq("client_id", clientId).eq("storage_bucket", "mcp-files").eq("status", "ready").order("created_at", { ascending: false }).limit(100),
    db.from("projects").select("id, name").eq("client_id", clientId).is("deleted_at", null).limit(200),
    lerPreferenciasMcp(db, clientId),
  ]);

  const itens: Array<Omit<ItemMcpComConteudo, "ativo" | "padrao">> = [];
  for (const m of (memorias.data ?? []) as LinhaMemoria[]) {
    if (!memoriaVeioDoMcp(m.metadata)) continue;
    const orient = ehOrientacao(m);
    const conteudo = String(m.content || "");
    const meta = (m.metadata || {}) as Record<string, unknown>;
    itens.push({
      fonte: orient ? "orientacao" : "memoria",
      id: String(m.id),
      titulo: umaLinha(m.title, 200) || umaLinha(conteudo, 80) || (orient ? "Orientação" : "Memória"),
      resumo: umaLinha(conteudo, 240),
      origem: origemLegivel(m.source, meta.origin),
      quando: m.created_at,
      tamanho: conteudo.length,
      publico: orient && typeof meta.publico === "string" ? umaLinha(meta.publico, 400) : null,
      conteudo,
    });
  }
  for (const d of (dossies.data ?? []) as LinhaDossie[]) {
    if (!dossieVeioDoMcp(d.actor)) continue;
    const conteudo = String(d.content || "");
    itens.push({
      fonte: "dossie",
      id: String(d.id),
      titulo: `Dossiê ${umaLinha(d.dossier_type, 40) || "geral"}${d.project_id ? " do projeto" : ""} · versão ${d.version ?? 1}`,
      resumo: umaLinha(d.summary || conteudo, 240),
      origem: origemLegivel(d.source, d.actor),
      quando: d.effective_at,
      tamanho: conteudo.length,
      conteudo,
    });
  }
  const listaDeArquivos = (arquivos.data ?? []) as LinhaArquivo[];
  for (const f of listaDeArquivos) {
    itens.push({
      fonte: "arquivo",
      id: String(f.id),
      titulo: umaLinha(f.file_name, 200) || "arquivo",
      resumo: umaLinha(f.description || f.mime_type || "", 240),
      origem: "MCP",
      quando: f.created_at,
      tamanho: Number(f.size_bytes) || 0,
      conteudo: "",
    });
  }
  const nomes = new Map(((projetos.data ?? []) as Array<{ id: string; name: string | null }>).map((p) => [p.id, p.name || "projeto"]));
  if (nomes.size) {
    const { data: rascunhos } = await db.from("studio_docs").select("project_id, notes, updated_at, published").in("project_id", Array.from(nomes.keys()).slice(0, 200));
    for (const r of (rascunhos ?? []) as LinhaRascunho[]) {
      const conteudo = String(r.notes || "");
      if (r.published === true || !conteudo.trim()) continue;
      itens.push({
        fonte: "rascunho",
        id: String(r.project_id),
        titulo: `Rascunho do Estúdio · ${umaLinha(nomes.get(r.project_id), 120)}`,
        resumo: umaLinha(conteudo, 240),
        origem: "MCP",
        quando: r.updated_at,
        tamanho: conteudo.length,
        conteudo,
      });
    }
  }

  const comEscolha = aplicarPreferencias(itens, prefs.prefs);
  // Texto dos arquivos: só dos que vão para o prompt (ativos), em uma leitura.
  const ativosArq = comEscolha.filter((i) => i.fonte === "arquivo" && i.ativo).map((i) => i.id);
  if (ativosArq.length && opcoes.comTextoDosArquivos && opcoes.comTextoDosArquivos(ativosArq)) {
    const max = opcoes.maxCharsPorArquivo ?? 200_000;
    const { data: pedacos } = await db.from("file_content_chunks").select("file_id, chunk_index, text").in("file_id", ativosArq.slice(0, 50)).order("chunk_index", { ascending: true }).limit(4000);
    const porArquivo = new Map<string, string>();
    for (const c of (pedacos ?? []) as Array<{ file_id: string; text: string | null }>) {
      const atual = porArquivo.get(c.file_id) || "";
      if (atual.length >= max) continue;
      porArquivo.set(c.file_id, `${atual}${atual ? "\n" : ""}${String(c.text || "")}`.slice(0, max));
    }
    for (const i of comEscolha) if (i.fonte === "arquivo" && porArquivo.has(i.id)) i.conteudo = porArquivo.get(i.id) || "";
  }
  return { itens: comEscolha, tabela: prefs.tabela };
}

/** Bloco do prompt com os itens ativos do cliente (vazio quando não há ou quando a leitura falha). */
export async function contextoMcpAtivo(db: BancoMinimo, clientId: string, limite: number): Promise<{ texto: string; ativos: number }> {
  try {
    const { itens } = await itensMcpDoCliente(db, clientId, { comTextoDosArquivos: () => true });
    const ativos = itens.filter((i) => i.ativo && (i.conteudo || "").trim());
    return { texto: blocoDoMcp(ativos, limite), ativos: ativos.length };
  } catch {
    return { texto: "", ativos: 0 };
  }
}

/** A lista para a tela (sem o conteúdo inteiro). */
export function paraATela(itens: ItemMcpComConteudo[]): ItemMcp[] {
  return itens.map(({ conteudo: _c, ...resto }) => resto);
}
