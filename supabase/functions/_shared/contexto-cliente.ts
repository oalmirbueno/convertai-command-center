/**
 * Contexto do cliente: tudo o que o painel já sabe dele, num lugar só.
 *
 * A Mesa não pode pedir de novo o que o cliente já entregou. Este módulo lê,
 * sem custo de IA:
 *   · documentos de marca e estratégia com texto extraído (file_content_chunks),
 *     com prioridade para identidade, logo, manual e documento mestre;
 *   · o dossiê atual;
 *   · as artes já aprovadas (raízes em Arquivos, pasta materiais), que mostram
 *     a identidade real;
 *   · as pastas de referência do workspace;
 *   · candidatos a logo (arquivos e nós do workspace com "logo" no nome).
 *
 * E sincroniza sozinho as referências: imagens das pastas de referência do
 * workspace (papel técnica) e artes aprovadas (papel identidade). Quem usa:
 * agente-contexto, estudio-arte e agente-calendario.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { recortarDossie } from "./dossie-recortado.ts";

const txt = (v: unknown, max = 4000) => (v == null ? "" : String(v)).slice(0, max).trim();

const PRIORIDADE_DOC = /(identidade|logo|marca|manual|brand|mestre|posicionamento|briefing|tom de voz|guia)/i;
const PASTA_DE_REFERENCIA = /(refer|inspira|moodboard|mood board|identidade|marca|logo)/i;
const MIME_IMAGEM = /^image\/(png|jpe?g|webp)$/i;
const NOME_IMAGEM = /\.(png|jpe?g|webp)$/i;

export type DocumentoDeMarca = { file_id: string; nome: string; tipo: string | null; texto: string; prioridade: boolean };

/** Filtro do banco (PostgREST): só o que pode ter texto (sem imagem e sem vídeo; mime vazio passa e o nome decide depois). */
export const FILTRO_SEM_IMAGEM_NEM_VIDEO = "mime_type.is.null,and(mime_type.not.ilike.image/*,mime_type.not.ilike.video/*)";

/**
 * Texto dos documentos do cliente, os de identidade primeiro, até o limite
 * de caracteres (o texto inteiro de cada documento, na ordem das partes).
 */
export async function lerDocumentosDeMarca(db: SupabaseClient, clientId: string, limite = 18_000): Promise<DocumentoDeMarca[]> {
  // AB2: imagem e vídeo saem ANTES do limite. Antes os 400 mais recentes
  // vinham com as fotos junto e um cliente com muita foto ficava sem documento.
  const { data: arquivos } = await db
    .from("files")
    .select("id, file_name, file_type, mime_type, created_at")
    .eq("client_id", clientId)
    .is("archived_at", null)
    .or(FILTRO_SEM_IMAGEM_NEM_VIDEO)
    .order("created_at", { ascending: false })
    .limit(400);
  const candidatos = ((arquivos as { id: string; file_name: string; file_type: string | null; mime_type: string | null }[] | null) ?? [])
    .filter((f) => !MIME_IMAGEM.test(f.mime_type || "") && !NOME_IMAGEM.test(f.file_name || "") && !/^video\//i.test(f.mime_type || ""));
  if (!candidatos.length) return [];

  const { data: pedacos } = await db
    .from("file_content_chunks")
    .select("file_id, chunk_index, text")
    .in("file_id", candidatos.slice(0, 120).map((f) => f.id))
    .order("chunk_index", { ascending: true })
    .limit(2000);
  const porArquivo = new Map<string, string[]>();
  for (const p of (pedacos as { file_id: string; text: string | null }[] | null) ?? []) {
    if (!p.text) continue;
    const lista = porArquivo.get(p.file_id) ?? [];
    lista.push(p.text);
    porArquivo.set(p.file_id, lista);
  }

  const docs = candidatos
    .filter((f) => porArquivo.has(f.id))
    .map((f) => ({
      file_id: f.id,
      nome: f.file_name,
      tipo: f.file_type,
      texto: porArquivo.get(f.id)!.join("\n"),
      prioridade: PRIORIDADE_DOC.test(f.file_name) || /estrat/i.test(f.file_type || ""),
    }))
    .sort((a, b) => Number(b.prioridade) - Number(a.prioridade));

  const saida: DocumentoDeMarca[] = [];
  let usado = 0;
  for (const d of docs) {
    if (usado >= limite) break;
    const corte = d.texto.slice(0, Math.max(0, limite - usado));
    if (corte.length < 200 && saida.length) break;
    saida.push({ ...d, texto: corte });
    usado += corte.length;
  }
  return saida;
}

type LinhaDoDossie = { content: string | null; summary: string | null; dossier_type: string | null; project_id?: string | null };

/**
 * Dossiês atuais juntos até o limite. O geral (contexto, sem projeto) vem
 * primeiro; os de projeto complementam com um pedaço menor. Grande demais:
 * fica o começo curto e o FIM (as seções mais recentes), nunca só o começo.
 */
export function juntarDossies(linhas: LinhaDoDossie[], limite: number): string {
  const ordenadas = linhas.slice().sort((a, b) => {
    const geral = (l: LinhaDoDossie) => ((l.dossier_type ?? "contexto") === "contexto" && !l.project_id ? 0 : 1);
    return geral(a) - geral(b);
  });
  const pecas = ordenadas
    .map((l) => `[${l.dossier_type ?? "dossiê"}]\n${l.summary ? `${l.summary}\n` : ""}${l.content ?? ""}`.trim())
    .filter(Boolean);
  const inteiro = pecas.join("\n\n");
  if (inteiro.length <= limite) return inteiro;
  const [principal, ...outras] = pecas;
  const outrasCurtas = outras.map((p) => recortarDossie(p, Math.floor(limite * 0.15)));
  const resto = limite - outrasCurtas.reduce((s, p) => s + p.length + 2, 0);
  return [recortarDossie(principal, Math.max(resto, 0)), ...outrasCurtas].filter(Boolean).join("\n\n");
}

/** Dossiê atual do cliente (o mais recente marcado como atual). */
export async function lerDossie(db: SupabaseClient, clientId: string, limite = 6000): Promise<string | null> {
  const { data } = await db
    .from("client_dossiers")
    .select("content, summary, dossier_type, project_id, created_at")
    .eq("client_id", clientId)
    .eq("is_current", true)
    .order("created_at", { ascending: false })
    .limit(3);
  const linhas = (data as LinhaDoDossie[] | null) ?? [];
  if (!linhas.length) return null;
  return juntarDossies(linhas, limite) || null;
}

export type ArteAprovada = {
  id: string;
  file_name: string;
  file_type: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  file_url: string | null;
  caption: string | null;
  created_at: string;
};

/**
 * Artes já feitas e aprovadas do cliente (a raiz de cada entrega em
 * materiais), as mais recentes primeiro. Mostram a identidade real da marca.
 */
export async function artesAprovadas(db: SupabaseClient, clientId: string, limite = 12): Promise<ArteAprovada[]> {
  const { data } = await db
    .from("files")
    .select("id, file_name, file_type, mime_type, storage_bucket, storage_path, file_url, caption, created_at, approval_status, visibility")
    .eq("client_id", clientId)
    .eq("folder", "materiais")
    .is("parent_file_id", null)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  const linhas = (data as (ArteAprovada & { mime_type: string | null; approval_status: string | null; visibility: string | null })[] | null) ?? [];
  const imagens = linhas.filter((f) => MIME_IMAGEM.test(f.mime_type || "") || NOME_IMAGEM.test(f.file_name || ""));
  // Aprovada pelo cliente, ou compartilhada com ele sem pedir aprovação: as
  // duas são arte que foi para o ar com a marca dele.
  const aprovadas = imagens.filter((f) => f.approval_status === "approved" || f.visibility === "client_shared");
  const base = aprovadas.length >= 3 ? aprovadas : imagens;
  return base.slice(0, limite).map(({ id, file_name, file_type, storage_bucket, storage_path, file_url, caption, created_at }) => ({
    id, file_name, file_type, storage_bucket, storage_path, file_url, caption, created_at,
  }));
}

export type CandidatoLogo = { origem: "arquivo" | "workspace"; id: string; nome: string };

/** Arquivos e nós do workspace com cara de logo (imagem com "logo" no nome). */
export async function candidatosALogo(db: SupabaseClient, clientId: string): Promise<CandidatoLogo[]> {
  const [arquivos, nos] = await Promise.all([
    db.from("files")
      .select("id, file_name, mime_type")
      .eq("client_id", clientId)
      .is("archived_at", null)
      .ilike("file_name", "%logo%")
      .limit(20),
    db.from("workspace_nodes")
      .select("id, name, mime, kind")
      .eq("client_id", clientId)
      .eq("kind", "file")
      .ilike("name", "%logo%")
      .limit(20),
  ]);
  const saida: CandidatoLogo[] = [];
  for (const f of (arquivos.data as { id: string; file_name: string; mime_type: string | null }[] | null) ?? []) {
    // SVG fica de fora: definir_logo recusa (415) e o gerador não lê vetor.
    if ((MIME_IMAGEM.test(f.mime_type || "") || NOME_IMAGEM.test(f.file_name)) && !/svg/i.test(f.mime_type || "") && !/\.svg$/i.test(f.file_name)) {
      saida.push({ origem: "arquivo", id: f.id, nome: f.file_name });
    }
  }
  for (const n of (nos.data as { id: string; name: string; mime: string | null }[] | null) ?? []) {
    if (MIME_IMAGEM.test(n.mime || "") || NOME_IMAGEM.test(n.name)) saida.push({ origem: "workspace", id: n.id, nome: n.name });
  }
  return saida;
}

export type ResultadoSincronizacao = { workspace_novas: number; arquivos_novas: number; total_ativas: number };

/**
 * Liga como referência, sem duplicar: imagens das pastas de referência do
 * workspace (técnica) e artes aprovadas (identidade). Não lê nem gasta IA:
 * a leitura das referências é feita depois, em lote.
 */
export async function sincronizarReferencias(db: SupabaseClient, clientId: string): Promise<ResultadoSincronizacao> {
  const { data: existentes } = await db
    .from("cliente_referencias")
    .select("workspace_node_id, file_id")
    .eq("client_id", clientId);
  const jaNos = new Set<string>();
  const jaArquivos = new Set<string>();
  for (const r of (existentes as { workspace_node_id: string | null; file_id: string | null }[] | null) ?? []) {
    if (r.workspace_node_id) jaNos.add(r.workspace_node_id);
    if (r.file_id) jaArquivos.add(r.file_id);
  }

  // Workspace: pastas com nome de referência (e subpastas diretas).
  const { data: nos } = await db
    .from("workspace_nodes")
    .select("id, parent_id, kind, name, mime, storage_path")
    .eq("client_id", clientId)
    .limit(2000);
  const todos = (nos as { id: string; parent_id: string | null; kind: string; name: string; mime: string | null; storage_path: string | null }[] | null) ?? [];
  const pastas = new Set(todos.filter((n) => n.kind === "folder" && PASTA_DE_REFERENCIA.test(n.name)).map((n) => n.id));
  for (const n of todos) if (n.kind === "folder" && n.parent_id && pastas.has(n.parent_id)) pastas.add(n.id);
  const novosNos = todos.filter((n) =>
    n.kind === "file" && n.parent_id && pastas.has(n.parent_id) && n.storage_path &&
    (MIME_IMAGEM.test(n.mime || "") || NOME_IMAGEM.test(n.name)) && !jaNos.has(n.id)
  ).slice(0, 60);

  const arts = await artesAprovadas(db, clientId, 12);
  const novasArtes = arts.filter((a) => !jaArquivos.has(a.id) && (a.storage_path || a.file_url));

  const linhas = [
    ...novosNos.map((n) => ({ client_id: clientId, origem: "workspace", workspace_node_id: n.id, papel: "tecnica", tags: ["workspace"] })),
    ...novasArtes.map((a) => ({ client_id: clientId, origem: "arquivo", file_id: a.id, papel: "identidade", tags: ["arte-aprovada"] })),
  ];
  if (linhas.length) {
    const { error } = await db.from("cliente_referencias").insert(linhas);
    if (error) console.error("contexto-cliente: referencias nao sincronizadas", { client_id: clientId, erro: error.message });
  }
  const { count } = await db
    .from("cliente_referencias")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("ativa", true);
  return { workspace_novas: novosNos.length, arquivos_novas: novasArtes.length, total_ativas: count ?? 0 };
}

/** Caminho no Storage de um arquivo do painel (bucket e caminho). */
export function caminhoDoArquivo(f: { storage_bucket: string | null; storage_path: string | null; file_url: string | null }): { bucket: string; caminho: string } | null {
  if (f.storage_bucket && f.storage_path) return { bucket: f.storage_bucket, caminho: f.storage_path };
  if (f.file_url?.startsWith("files://")) return { bucket: "files", caminho: f.file_url.slice("files://".length) };
  return null;
}

/** Contexto consolidado gravado pelo agente de contexto no kit. */
export type ContextoConsolidado = {
  negocio?: string;
  publico?: string;
  oferta?: string;
  tom_de_voz?: string;
  diferenciais?: string[];
  tipografia?: { titulo?: string | null; texto?: string | null; observacao?: string | null };
  logo?: { descricao?: string | null };
  lacunas?: string[];
  fontes_lidas?: string[];
};

export async function lerContextoConsolidado(db: SupabaseClient, clientId: string): Promise<ContextoConsolidado> {
  const { data } = await db.from("cliente_kit_marca").select("contexto").eq("client_id", clientId).maybeSingle();
  const c = (data as { contexto: ContextoConsolidado | null } | null)?.contexto;
  return c && typeof c === "object" ? c : {};
}

/**
 * Marca pronta para o compositor de direção (_shared/direcao-arte.ts): kit,
 * fontes, contexto consolidado e nome. Usada pelo calendário ao gravar.
 */
export async function lerMarcaParaDirecao(db: SupabaseClient, clientId: string): Promise<{
  nomeCliente: string;
  paleta: { nome?: string; hex?: string; papel?: string }[];
  estilo: string | null;
  regras: string | null;
  fontes: { nome: string; papel: string }[];
  tipografiaCitada: ContextoConsolidado["tipografia"] | null;
  tomDeVoz: string | null;
  temLogo: boolean;
}> {
  const [kit, fontes, perfil] = await Promise.all([
    db.from("cliente_kit_marca").select("paleta, logo_file_id, logo_path, estilo, regras, contexto").eq("client_id", clientId).maybeSingle(),
    db.from("cliente_fontes").select("nome, papel").eq("client_id", clientId),
    db.from("profiles").select("company_name, full_name").eq("id", clientId).maybeSingle(),
  ]);
  const k = kit.data as { paleta: unknown; logo_file_id: string | null; logo_path: string | null; estilo: string | null; regras: string | null; contexto: ContextoConsolidado | null } | null;
  const p = perfil.data as { company_name: string | null; full_name: string | null } | null;
  return {
    nomeCliente: txt(p?.company_name || p?.full_name || "cliente", 120),
    paleta: Array.isArray(k?.paleta) ? k!.paleta as { nome?: string; hex?: string; papel?: string }[] : [],
    estilo: k?.estilo ?? null,
    regras: k?.regras ?? null,
    fontes: ((fontes.data as { nome: string; papel: string }[] | null) ?? []),
    tipografiaCitada: k?.contexto?.tipografia ?? null,
    tomDeVoz: k?.contexto?.tom_de_voz ?? null,
    // definir_logo grava logo_path; logo_file_id é o caminho antigo.
    temLogo: !!(k?.logo_path || k?.logo_file_id),
  };
}

// ------------------------------------------------------ acervo de imagens

/** Categoria pelo nome da pasta e do arquivo, sem IA (a leitura refina depois). */
export function categoriaPeloNome(pasta: string | null, nome: string): string | null {
  const s = `${pasta ?? ""} ${nome}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/logo|logotipo|marca d.?agua/.test(s)) return "logo";
  if (/antes|depois|before|after/.test(s)) return "antes_depois";
  if (/equipe|time|colaborador|funcionari|staff/.test(s)) return "equipe";
  if (/fachada|entrada|predio|loja fisica/.test(s)) return "fachada";
  if (/produto|embalagem|catalogo/.test(s)) return "produto";
  if (/cliente|pessoa|retrato|modelo/.test(s)) return "pessoa";
  if (/quarto|sala|cozinha|banheiro|ambiente|espaco|interior|area/.test(s)) return "ambiente";
  if (/detalhe|close|textura/.test(s)) return "detalhe";
  if (/arte|post|carrossel|criativo|feed/.test(s)) return "arte";
  return null;
}

const nomeLimpo = (nome: string) => nome.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "imagem";

export type ResultadoAcervo = { novas: number; total: number };

/**
 * Traz para o acervo (cliente_imagens) as imagens reais do cliente: todas as
 * pastas do workspace (fora as de referência, que são peças de outras marcas)
 * e Arquivos (fora os materiais entregues pela agência). Guarda o nome da
 * pasta e uma categoria provável pelo nome. Sem IA e sem duplicar.
 */
export async function sincronizarAcervo(db: SupabaseClient, clientId: string): Promise<ResultadoAcervo> {
  // AB2: o banco devolve no máximo 1.000 linhas por pedido. Antes o que já
  // estava no acervo vinha pela metade num cliente grande, a função tentava
  // inserir de novo e o lote de 200 inteiro caía no índice único.
  type Existente = { workspace_node_id: string | null; file_id: string | null };
  type No = { id: string; parent_id: string | null; kind: string; name: string; mime: string | null; storage_path: string | null };
  type ArqDoAcervo = { id: string; file_name: string; file_type: string | null; mime_type: string | null; folder: string | null; storage_bucket: string | null; storage_path: string | null; file_url: string | null };
  const [existentes, nos, arquivos] = await Promise.all([
    todasAsPaginas<Existente>((de, ate) =>
      db.from("cliente_imagens").select("workspace_node_id, file_id").eq("client_id", clientId).order("id", { ascending: true }).range(de, ate), 20_000),
    todasAsPaginas<No>((de, ate) =>
      db.from("workspace_nodes").select("id, parent_id, kind, name, mime, storage_path").eq("client_id", clientId).order("id", { ascending: true }).range(de, ate), 5000),
    // Todas as pastas de Arquivos, inclusive materiais (muitos clientes guardam
    // as fotos reais ali, misturadas com artes). Lâmina filha de carrossel fica
    // de fora; arte pronta entra marcada como "arte" e a leitura separa o resto.
    todasAsPaginas<ArqDoAcervo>((de, ate) =>
      db.from("files")
        .select("id, file_name, file_type, mime_type, folder, storage_bucket, storage_path, file_url, parent_file_id")
        .eq("client_id", clientId)
        .is("archived_at", null)
        .is("parent_file_id", null)
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(de, ate), 2000),
  ]);
  const jaNos = new Set<string>();
  const jaArquivos = new Set<string>();
  for (const r of existentes) {
    if (r.workspace_node_id) jaNos.add(r.workspace_node_id);
    if (r.file_id) jaArquivos.add(r.file_id);
  }

  const todos = nos;
  const porId = new Map(todos.map((n) => [n.id, n]));
  // Caminho legível da pasta ("Fotos / Quartos") e se está dentro de uma pasta de referência.
  const caminho = (n: No): { pasta: string | null; referencia: boolean } => {
    const partes: string[] = [];
    let referencia = false;
    let atual = n.parent_id ? porId.get(n.parent_id) : undefined;
    for (let passo = 0; atual && passo < 12; passo++) {
      partes.unshift(atual.name);
      if (/(refer|inspira|moodboard|mood board)/i.test(atual.name)) referencia = true;
      atual = atual.parent_id ? porId.get(atual.parent_id) : undefined;
    }
    return { pasta: partes.length ? partes.join(" / ").slice(0, 200) : null, referencia };
  };

  const linhas: Record<string, unknown>[] = [];
  for (const n of todos) {
    if (n.kind !== "file" || !n.storage_path || jaNos.has(n.id)) continue;
    if (!(MIME_IMAGEM.test(n.mime || "") || NOME_IMAGEM.test(n.name))) continue;
    const c = caminho(n);
    if (c.referencia) continue;
    linhas.push({
      client_id: clientId,
      origem: "workspace",
      workspace_node_id: n.id,
      storage_bucket: "workspace",
      storage_path: n.storage_path,
      nome: nomeLimpo(n.name),
      pasta: c.pasta,
      categoria: categoriaPeloNome(c.pasta, n.name),
    });
  }
  const TIPO_DE_ARTE = /^(carrossel|carousel|creative|criativo|post|design|story|stories|arte)$/i;
  for (const a of arquivos) {
    if (jaArquivos.has(a.id)) continue;
    if (!(MIME_IMAGEM.test(a.mime_type || "") || NOME_IMAGEM.test(a.file_name || ""))) continue;
    const c = caminhoDoArquivo(a);
    if (!c) continue;
    const pasta = a.folder ? `Arquivos / ${a.folder}` : "Arquivos";
    const ehArte = TIPO_DE_ARTE.test(a.file_type || "") || /(1080x1350|1080x1080|feed|stories|carrossel)/i.test(a.file_name || "");
    linhas.push({
      client_id: clientId,
      origem: "arquivo",
      file_id: a.id,
      storage_bucket: c.bucket,
      storage_path: c.caminho,
      nome: nomeLimpo(a.file_name || "imagem"),
      pasta,
      categoria: ehArte ? "arte" : categoriaPeloNome(pasta, a.file_name || ""),
    });
  }
  // Lote que bate no índice único (outra chamada inseriu antes): tira as que já
  // existem e grava o resto, em vez de perder o lote inteiro.
  const r = await inserirSemDuplicar(linhas, {
    inserir: (grupo) => db.from("cliente_imagens").insert(grupo),
    existentes: async (grupo) => {
      const nosDoGrupo = grupo.map((l) => l.workspace_node_id).filter((v): v is string => typeof v === "string");
      const arqsDoGrupo = grupo.map((l) => l.file_id).filter((v): v is string => typeof v === "string");
      const [a, b] = await Promise.all([
        nosDoGrupo.length
          ? db.from("cliente_imagens").select("workspace_node_id").eq("client_id", clientId).in("workspace_node_id", nosDoGrupo)
          : Promise.resolve({ data: [] as unknown[] }),
        arqsDoGrupo.length
          ? db.from("cliente_imagens").select("file_id").eq("client_id", clientId).in("file_id", arqsDoGrupo)
          : Promise.resolve({ data: [] as unknown[] }),
      ]);
      const nosJa = new Set(((a.data as { workspace_node_id: string }[] | null) ?? []).map((x) => x.workspace_node_id));
      const arqsJa = new Set(((b.data as { file_id: string }[] | null) ?? []).map((x) => x.file_id));
      return grupo.filter((l) => nosJa.has(String(l.workspace_node_id)) || arqsJa.has(String(l.file_id)));
    },
  });
  if (r.falhas) console.error("contexto-cliente: acervo nao sincronizado", { client_id: clientId, falhas: r.falhas });
  const { count } = await db.from("cliente_imagens").select("id", { count: "exact", head: true }).eq("client_id", clientId).eq("ativa", true);
  return { novas: r.novas, total: count ?? 0 };
}

/**
 * Lê todas as páginas de uma consulta, até o teto. O banco devolve no máximo
 * 1.000 linhas por pedido: `.limit(5000)` sozinho volta com 1.000 sem avisar.
 */
export async function todasAsPaginas<T>(
  pagina: (de: number, ate: number) => PromiseLike<{ data: unknown; error: unknown }>,
  teto: number,
  tamanho = 1000,
): Promise<T[]> {
  const saida: T[] = [];
  for (let de = 0; de < teto; de += tamanho) {
    const quantas = Math.min(tamanho, teto - de);
    const { data, error } = await pagina(de, de + quantas - 1);
    if (error) break;
    const linhas = (data as T[] | null) ?? [];
    for (const l of linhas) saida.push(l);
    if (linhas.length < quantas) break;
  }
  return saida;
}

type ErroDoBanco = { code?: string; message?: string } | null;
const ehDuplicado = (e: ErroDoBanco) => !!e && (e.code === "23505" || /duplicate key|unique constraint/i.test(e.message || ""));

/**
 * Insere em lotes sem perder o lote inteiro no índice único: no conflito, lê
 * de novo quais linhas do lote já existem, tira essas e grava o resto (uma a
 * uma só se ainda houver conflito). Erro que não é duplicata conta como falha.
 */
export async function inserirSemDuplicar<L>(
  linhas: L[],
  ops: {
    inserir: (grupo: L[]) => PromiseLike<{ error: ErroDoBanco }>;
    existentes: (grupo: L[]) => Promise<L[]>;
  },
  lote = 200,
): Promise<{ novas: number; duplicadas: number; falhas: number }> {
  const r = { novas: 0, duplicadas: 0, falhas: 0 };
  for (let i = 0; i < linhas.length; i += lote) {
    const grupo = linhas.slice(i, i + lote);
    const primeira = await ops.inserir(grupo);
    if (!primeira.error) { r.novas += grupo.length; continue; }
    if (!ehDuplicado(primeira.error)) { r.falhas += grupo.length; continue; }
    const ja = new Set(await ops.existentes(grupo).catch(() => [] as L[]));
    const restantes = grupo.filter((l) => !ja.has(l));
    r.duplicadas += grupo.length - restantes.length;
    if (!restantes.length) continue;
    const segunda = await ops.inserir(restantes);
    if (!segunda.error) { r.novas += restantes.length; continue; }
    if (!ehDuplicado(segunda.error)) { r.falhas += restantes.length; continue; }
    for (const l of restantes) {
      const { error } = await ops.inserir([l]);
      if (!error) r.novas++;
      else if (ehDuplicado(error)) r.duplicadas++;
      else r.falhas++;
    }
  }
  return r;
}