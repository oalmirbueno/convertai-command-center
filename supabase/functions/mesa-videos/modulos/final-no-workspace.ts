/**
 * Vídeo pronto no Workspace (Mesa Edição, 02/10/2026).
 *
 * O dono: "depois do render, tem que BAIXAR e salvar no computador ou no
 * celular, e ir para o WORKSPACE e criar a pasta". Quando um render_final fica
 * pronto (e quando a legenda .srt/.vtt do final é gerada), o arquivo entra no
 * Workspace do cliente em "Vídeos / <título> / Finais":
 * - pastas criadas uma vez (acha a que já existe pelo nome, sem acento e sem
 *   caixa; "Vídeos" é a mesma raiz do espelho da Mesa Edição);
 * - o MP4 vai do bucket "mesa" para o bucket "workspace" pelo servidor
 *   (cópia do Storage entre buckets; se a cópia não existir, transferência
 *   por link assinado em fluxo até TETO_DA_TRANSFERENCIA_BYTES; nunca pelo
 *   navegador);
 * - caminho fixo por arquivo (client/<cliente>/mesa-edicao/<arquivo>.mp4) e o
 *   nó anotado em video_arquivos.origem.workspace: rodar de novo não duplica.
 *
 * Usado pelo worker de render (ao concluir, com o editor fechado) e pela
 * mesa-videos (ação final_para_workspace e a legenda). Sem Deno e sem import
 * do supabase-js: o banco entra pela PortaDoWorkspace (os testes simulam).
 * O Workspace não é por marca (workspace_nodes não tem marca_id): a pasta é do cliente.
 */

export const BUCKET_DA_MESA = "mesa";
export const BUCKET_DO_WORKSPACE = "workspace";
export const RAIZ_DOS_VIDEOS = "Vídeos";
export const PASTA_DOS_FINAIS = "Finais";
/** Acima disto, sem a cópia do Storage, não transfere pela função (memória e tempo da Edge Function). */
export const TETO_DA_TRANSFERENCIA_BYTES = 200 * 1024 * 1024;
/** Tentativas automáticas (worker); o clique em "Abrir no Workspace" sempre tenta. */
export const MAX_TENTATIVAS_AUTOMATICAS = 3;
/** Uma reserva "copiando" mais velha que isto é de quem caiu: pode ser retomada. */
export const RESERVA_VENCE_MS = 10 * 60_000;

const semAcento = (t: string) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
export const nomeNormal = (t: string) =>
  semAcento(t)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Nome que pode ir para pasta ou arquivo: sem barra, sem controle, curto. */
export function nomeLimpo(t: string, reserva = "Vídeo"): string {
  const s = String(t || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
    .trim();
  return s || reserva;
}

/** O título do vídeo sem o "(render 9:16)" e sem o " v3" do fim: o nome da pasta. */
export function tituloDoVideo(nomeDoArquivo: string, tituloDaVersao?: string | null): string {
  if (tituloDaVersao && tituloDaVersao.trim()) return nomeLimpo(tituloDaVersao);
  const base = String(nomeDoArquivo || "")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/\s*\((render|amostra|final|entrega)[^)]*\)\s*$/i, "")
    .replace(/\s+v\d+$/i, "");
  return nomeLimpo(base);
}

/** "<Título> (final 9:16).mp4"; com a versão (v2 em diante) para os renders não se confundirem na pasta. */
export function nomeDoFinal(titulo: string, o: { formato?: string | null; versao?: number | null; extensao?: string } = {}): string {
  const ext = String(o.extensao || "mp4").replace(/^\./, "").toLowerCase();
  const formato = o.formato && /^\d{1,2}:\d{1,2}$/.test(o.formato) ? ` ${o.formato}` : "";
  const versao = o.versao && o.versao > 1 ? ` v${Math.floor(o.versao)}` : "";
  return `${nomeLimpo(titulo).slice(0, 90)}${versao} (final${formato}).${ext}`;
}

/** As pastas do final: Vídeos / <título> / Finais. */
export const pastasDoFinal = (titulo: string): string[] => [RAIZ_DOS_VIDEOS, nomeLimpo(titulo), PASTA_DOS_FINAIS];

/** Caminho fixo no bucket workspace (idempotente por arquivo). */
export function caminhoNoWorkspace(clientId: string, arquivoId: string, extensao = "mp4"): string {
  return `client/${clientId}/mesa-edicao/${arquivoId}.${String(extensao).replace(/^\./, "").toLowerCase()}`;
}

/** Duas pastas são a mesma: mesmo nome sem acento e sem caixa; a raiz aceita "Vídeos", "Videos" e "Vídeo". */
export function mesmaPasta(nome: string, procurado: string, raiz: boolean): boolean {
  const a = nomeNormal(nome);
  if (raiz && nomeNormal(procurado) === nomeNormal(RAIZ_DOS_VIDEOS)) return /^videos?$/.test(a);
  return a === nomeNormal(procurado);
}

export type DecisaoDaCopia = "copiar" | "transferir" | "grande_demais";

/**
 * Cópia do Storage primeiro (o objeto não passa pela função). Se ela falhar,
 * transferir em fluxo só até o teto; acima, para e registra a falha.
 */
export function decidirCopia(copiaFalhou: boolean, bytes: number | null | undefined): DecisaoDaCopia {
  if (!copiaFalhou) return "copiar";
  const b = Number(bytes) || 0;
  return b > 0 && b <= TETO_DA_TRANSFERENCIA_BYTES ? "transferir" : "grande_demais";
}

export interface NoDoWorkspace {
  id: string;
  parent_id: string | null;
  name: string;
  kind: string;
}

export interface ArquivoDoFinal {
  id: string;
  client_id: string;
  nome: string;
  tipo: string;
  storage_bucket: string | null;
  storage_path: string;
  mime: string | null;
  bytes: number | null;
  duracao_s: number | null;
  origem: Record<string, unknown> | null;
}

export interface NoCriado {
  name: string;
  kind: "file";
  scope: "client";
  client_id: string;
  parent_id: string;
  mime: string;
  size_bytes: number | null;
  storage_path: string;
  duration_sec: number | null;
  created_by: string | null;
}

/** O que o módulo precisa do banco e do Storage (Supabase de verdade em portaDoSupabase; simulada nos testes). */
export interface PortaDoWorkspace {
  lerArquivo(arquivoId: string): Promise<ArquivoDoFinal | null>;
  tituloDaVersao(versaoId: string): Promise<{ titulo: string; numero: number | null } | null>;
  pastasFilhas(clientId: string, parentId: string | null): Promise<NoDoWorkspace[]>;
  criarPasta(clientId: string, parentId: string | null, nome: string, criadoPor: string | null): Promise<string>;
  noPeloCaminho(clientId: string, storagePath: string): Promise<{ id: string; parent_id: string | null } | null>;
  criarNo(linha: NoCriado): Promise<string>;
  atualizarNo(id: string, campos: { size_bytes?: number | null; name?: string }): Promise<void>;
  objetoExiste(bucket: string, caminho: string): Promise<boolean>;
  copiar(deBucket: string, de: string, paraBucket: string, para: string): Promise<{ erro: string | null }>;
  transferir(deBucket: string, de: string, paraBucket: string, para: string, mime: string): Promise<void>;
  subirTexto(bucket: string, caminho: string, texto: string, mime: string): Promise<void>;
  /** Grava origem.workspace; com `soSeLivre`, só se ainda não houver reserva (devolve false se outro pegou). */
  anotar(arquivoId: string, origem: Record<string, unknown>, soSeLivre?: boolean): Promise<boolean>;
}

export interface FinalNoWorkspace {
  estado: "pronto" | "ja_estava" | "em_andamento" | "pulado" | "erro";
  pasta_id: string | null;
  node_id: string | null;
  storage_path: string | null;
  nome: string | null;
  caminho: string[];
  via?: DecisaoDaCopia | "ja_existia";
  motivo?: string;
}

/** Só o vídeo pronto do cliente, no bucket mesa e na pasta dele; amostra não vai. */
export function podeIrParaOWorkspace(a: ArquivoDoFinal): string | null {
  if ((a.storage_bucket || BUCKET_DA_MESA) !== BUCKET_DA_MESA) return "fora_do_bucket";
  if (!a.storage_path || a.storage_path.indexOf(`${a.client_id}/`) !== 0) return "fora_da_pasta_do_cliente";
  if (a.tipo === "amostra" || (a.origem && a.origem.amostra)) return "amostra";
  const mime = String(a.mime || "");
  if (mime && mime.indexOf("video/") !== 0) return "nao_e_video";
  if (a.tipo === "audio" || a.tipo === "still") return "nao_e_video";
  return null;
}

const doWorkspace = (a: ArquivoDoFinal): Record<string, unknown> => {
  const w = a.origem && typeof a.origem.workspace === "object" && a.origem.workspace ? (a.origem.workspace as Record<string, unknown>) : null;
  return w || {};
};

/** Acha cada pasta do caminho pelo nome ou cria a que falta. Devolve o id da última. */
export async function garantirPastas(porta: PortaDoWorkspace, clientId: string, caminho: string[], criadoPor: string | null): Promise<string> {
  let pai: string | null = null;
  for (let k = 0; k < caminho.length; k++) {
    const nome = caminho[k];
    const filhas: NoDoWorkspace[] = (await porta.pastasFilhas(clientId, pai)).filter((n: NoDoWorkspace) => n.kind === "folder" && mesmaPasta(n.name, nome, k === 0));
    // Homônimas (versão antiga recriava pasta): a de menor id, sempre a mesma.
    const achada: NoDoWorkspace | undefined = filhas.sort((a: NoDoWorkspace, b: NoDoWorkspace) => (a.id < b.id ? -1 : 1))[0];
    pai = achada ? achada.id : await porta.criarPasta(clientId, pai, nome, criadoPor);
  }
  return pai as string;
}

/**
 * Põe o vídeo pronto no Workspace. Nunca lança: devolve o estado e o motivo
 * (quem chama registra a falha). `automatico`: respeita o teto de tentativas
 * e não refaz o que alguém tirou do Workspace.
 */
export async function finalParaOWorkspace(porta: PortaDoWorkspace, e: { arquivoId: string; criadoPor?: string | null; automatico?: boolean; agoraMs?: number }): Promise<FinalNoWorkspace> {
  const agora = e.agoraMs ?? Date.now();
  const vazio = (estado: FinalNoWorkspace["estado"], motivo?: string): FinalNoWorkspace => ({ estado, pasta_id: null, node_id: null, storage_path: null, nome: null, caminho: [], motivo });
  let a: ArquivoDoFinal | null = null;
  try {
    a = await porta.lerArquivo(e.arquivoId);
  } catch (err) {
    return vazio("erro", err instanceof Error ? err.message : "arquivo não lido");
  }
  if (!a) return vazio("pulado", "arquivo_inexistente");
  const recusa = podeIrParaOWorkspace(a);
  if (recusa) return vazio("pulado", recusa);
  const w = doWorkspace(a);
  const destino = caminhoNoWorkspace(a.client_id, a.id, "mp4");

  // Já feito: o nó ainda está lá.
  if (typeof w.node_id === "string" && w.node_id) {
    const no = await porta.noPeloCaminho(a.client_id, destino).catch(() => null);
    if (no) return { estado: "ja_estava", pasta_id: (w.pasta_id as string) || no.parent_id, node_id: no.id, storage_path: destino, nome: (w.nome as string) || null, caminho: Array.isArray(w.caminho) ? (w.caminho as string[]) : [], via: "ja_existia" };
    if (e.automatico) return vazio("pulado", "tirado_do_workspace");
  }
  const tentativas = Number(w.tentativas) || 0;
  if (e.automatico && w.estado === "erro" && tentativas >= MAX_TENTATIVAS_AUTOMATICAS) return vazio("pulado", "tentativas_esgotadas");
  const emAndamento = w.estado === "copiando" && typeof w.em === "string" && agora - Date.parse(w.em) < RESERVA_VENCE_MS;
  if (emAndamento) return vazio("em_andamento");

  // Reserva: só um de cada vez (worker, tela e clique) faz a cópia.
  const origemBase = { ...(a.origem || {}) };
  const reservou = await porta
    .anotar(a.id, { ...origemBase, workspace: { estado: "copiando", em: new Date(agora).toISOString(), tentativas } }, !w.estado && !w.node_id)
    .catch(() => false);
  if (!reservou) return vazio("em_andamento");

  const versaoId = typeof origemBase.versao_id === "string" ? origemBase.versao_id : null;
  const formato = typeof origemBase.formato === "string" ? origemBase.formato : null;
  let caminho: string[] = [];
  let nome = "";
  try {
    const versao = versaoId ? await porta.tituloDaVersao(versaoId).catch(() => null) : null;
    const titulo = tituloDoVideo(a.nome, versao ? versao.titulo : null);
    nome = nomeDoFinal(titulo, { formato, versao: versao ? versao.numero : null });
    caminho = pastasDoFinal(titulo);
    const pastaId = await garantirPastas(porta, a.client_id, caminho, e.criadoPor || null);
    let via: FinalNoWorkspace["via"] = "ja_existia";
    if (!(await porta.objetoExiste(BUCKET_DO_WORKSPACE, destino))) {
      const copia = await porta.copiar(BUCKET_DA_MESA, a.storage_path, BUCKET_DO_WORKSPACE, destino);
      via = decidirCopia(!!copia.erro, a.bytes);
      if (via === "grande_demais") throw new Error(`a cópia do Storage falhou (${copia.erro}) e o vídeo passa de ${Math.round(TETO_DA_TRANSFERENCIA_BYTES / 1048576)} MB para transferir pela função`);
      if (via === "transferir") await porta.transferir(BUCKET_DA_MESA, a.storage_path, BUCKET_DO_WORKSPACE, destino, a.mime || "video/mp4");
    }
    const existente = await porta.noPeloCaminho(a.client_id, destino);
    const nodeId = existente
      ? existente.id
      : await porta.criarNo({ name: nome, kind: "file", scope: "client", client_id: a.client_id, parent_id: pastaId, mime: a.mime || "video/mp4", size_bytes: a.bytes, storage_path: destino, duration_sec: a.duracao_s, created_by: e.criadoPor || null });
    const workspace = {
      estado: "pronto",
      node_id: nodeId,
      pasta_id: existente ? existente.parent_id || pastaId : pastaId,
      storage_path: destino,
      nome,
      caminho,
      render_pedido_id: origemBase.render_pedido_id || null,
      versao_id: versaoId,
      revisao: origemBase.revisao ?? null,
      via,
      em: new Date(agora).toISOString(),
    };
    // Relê a origem: a legenda pode ter sido anotada enquanto copiava.
    const atual = await porta.lerArquivo(a.id).catch(() => null);
    await porta.anotar(a.id, { ...((atual && atual.origem) || origemBase), workspace });
    return { estado: "pronto", pasta_id: workspace.pasta_id, node_id: nodeId, storage_path: destino, nome, caminho, via };
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    await porta.anotar(a.id, { ...origemBase, workspace: { estado: "erro", erro: motivo.slice(0, 300), tentativas: tentativas + 1, em: new Date(agora).toISOString() } }).catch(() => false);
    return { ...vazio("erro", motivo), caminho, nome: nome || null };
  }
}

/**
 * A legenda do final (.srt e .vtt) na mesma pasta Finais, com o nome do vídeo.
 * O MP4 vai junto se ainda não foi (mesma reserva). Nunca lança.
 */
export async function legendaParaOWorkspace(porta: PortaDoWorkspace, e: { arquivoId: string; srt: string; vtt: string; criadoPor?: string | null; agoraMs?: number }): Promise<{ estado: "pronto" | "pulado" | "erro"; pasta_id: string | null; nos: { srt: string | null; vtt: string | null }; motivo?: string }> {
  const nada = { srt: null, vtt: null };
  try {
    const a = await porta.lerArquivo(e.arquivoId);
    if (!a) return { estado: "pulado", pasta_id: null, nos: nada, motivo: "arquivo_inexistente" };
    const recusa = podeIrParaOWorkspace(a);
    if (recusa) return { estado: "pulado", pasta_id: null, nos: nada, motivo: recusa };
    const final = await finalParaOWorkspace(porta, { arquivoId: a.id, criadoPor: e.criadoPor, automatico: false, agoraMs: e.agoraMs });
    const origem = a.origem || {};
    const versaoId = typeof origem.versao_id === "string" ? origem.versao_id : null;
    const versao = versaoId ? await porta.tituloDaVersao(versaoId).catch(() => null) : null;
    const titulo = tituloDoVideo(a.nome, versao ? versao.titulo : null);
    const pastaId = final.pasta_id || (await garantirPastas(porta, a.client_id, pastasDoFinal(titulo), e.criadoPor || null));
    const formato = typeof origem.formato === "string" ? origem.formato : null;
    const nos: { srt: string | null; vtt: string | null } = { srt: null, vtt: null };
    for (const [ext, texto, mime] of [["srt", e.srt, "application/x-subrip"], ["vtt", e.vtt, "text/vtt"]] as const) {
      const caminho = caminhoNoWorkspace(a.client_id, a.id, ext);
      await porta.subirTexto(BUCKET_DO_WORKSPACE, caminho, texto, mime);
      const bytes = new TextEncoder().encode(texto).length;
      const existente = await porta.noPeloCaminho(a.client_id, caminho);
      if (existente) {
        await porta.atualizarNo(existente.id, { size_bytes: bytes });
        nos[ext] = existente.id;
      } else {
        nos[ext] = await porta.criarNo({ name: nomeDoFinal(titulo, { formato, versao: versao ? versao.numero : null, extensao: ext }), kind: "file", scope: "client", client_id: a.client_id, parent_id: pastaId, mime, size_bytes: bytes, storage_path: caminho, duration_sec: null, created_by: e.criadoPor || null });
      }
    }
    return { estado: "pronto", pasta_id: pastaId, nos };
  } catch (err) {
    return { estado: "erro", pasta_id: null, nos: nada, motivo: err instanceof Error ? err.message : String(err) };
  }
}

// ------------------------------------------------------------------ Supabase de verdade

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Cliente do supabase-js (Deno ou Node) com a chave de serviço. Tipo estrutural: serve aos dois. */
export type ClienteDoSupabase = { from: (tabela: string) => any; storage: { from: (bucket: string) => any } };

/**
 * A porta com o Supabase (chave de serviço: quem chama já conferiu o acesso ao
 * cliente). `buscar` é o fetch (os testes trocam).
 */
export function portaDoSupabase(db: ClienteDoSupabase, buscar: typeof fetch = fetch): PortaDoWorkspace {
  const falha = (onde: string, error: { message?: string } | null) => new Error(`${onde}: ${(error && error.message) || "falhou"}`);
  return {
    async lerArquivo(id) {
      const { data, error } = await db.from("video_arquivos").select("id, client_id, nome, tipo, storage_bucket, storage_path, mime, bytes, duracao_s, origem").eq("id", id).maybeSingle();
      if (error) throw falha("video_arquivos", error);
      return (data as ArquivoDoFinal | null) || null;
    },
    async tituloDaVersao(id) {
      const { data } = await db.from("video_versoes").select("titulo, numero").eq("id", id).maybeSingle();
      return data ? { titulo: String((data as { titulo: string }).titulo || ""), numero: Number((data as { numero: number }).numero) || null } : null;
    },
    async pastasFilhas(clientId, parentId) {
      let q = db.from("workspace_nodes").select("id, parent_id, name, kind").eq("scope", "client").eq("client_id", clientId).eq("kind", "folder");
      q = parentId ? q.eq("parent_id", parentId) : q.is("parent_id", null);
      const { data, error } = await q.limit(1000);
      if (error) throw falha("workspace_nodes", error);
      return (data || []) as NoDoWorkspace[];
    },
    async criarPasta(clientId, parentId, nome, criadoPor) {
      const { data, error } = await db.from("workspace_nodes").insert({ name: nome, kind: "folder", scope: "client", client_id: clientId, parent_id: parentId, created_by: criadoPor }).select("id").single();
      if (error || !data) throw falha("pasta do workspace", error);
      return String((data as { id: string }).id);
    },
    async noPeloCaminho(clientId, caminho) {
      const { data, error } = await db.from("workspace_nodes").select("id, parent_id").eq("client_id", clientId).eq("storage_path", caminho).limit(1);
      if (error) throw falha("workspace_nodes", error);
      const l = (data || []) as { id: string; parent_id: string | null }[];
      return l[0] || null;
    },
    async criarNo(linha) {
      const { data, error } = await db.from("workspace_nodes").insert(linha).select("id").single();
      if (error || !data) throw falha("arquivo do workspace", error);
      return String((data as { id: string }).id);
    },
    async atualizarNo(id, campos) {
      const { error } = await db.from("workspace_nodes").update({ ...campos, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw falha("arquivo do workspace", error);
    },
    async objetoExiste(bucket, caminho) {
      const barra = caminho.lastIndexOf("/");
      const pasta = barra >= 0 ? caminho.slice(0, barra) : "";
      const nome = caminho.slice(barra + 1);
      const { data, error } = await db.storage.from(bucket).list(pasta, { search: nome, limit: 10 });
      if (error) return false;
      return ((data || []) as { name: string }[]).some((o) => o.name === nome);
    },
    async copiar(deBucket, de, paraBucket, para) {
      try {
        const { error } = await db.storage.from(deBucket).copy(de, para, { destinationBucket: paraBucket });
        return { erro: error ? String(error.message || error) : null };
      } catch (err) {
        return { erro: err instanceof Error ? err.message : String(err) };
      }
    },
    async transferir(deBucket, de, paraBucket, para, mime) {
      // Em fluxo: o corpo do download vai direto para o upload (nada inteiro na memória).
      const leitura = await db.storage.from(deBucket).createSignedUrl(de, 900);
      if (leitura.error || !leitura.data) throw falha("link de leitura", leitura.error);
      const envio = await db.storage.from(paraBucket).createSignedUploadUrl(para, { upsert: true });
      if (envio.error || !envio.data) throw falha("link de envio", envio.error);
      const baixado = await buscar(leitura.data.signedUrl);
      if (!baixado.ok || !baixado.body) throw new Error(`download do vídeo: HTTP ${baixado.status}`);
      const tamanho = baixado.headers.get("content-length");
      const subido = await buscar(envio.data.signedUrl, {
        method: "PUT",
        headers: { "content-type": mime, "x-upsert": "true", ...(tamanho ? { "content-length": tamanho } : {}) },
        body: baixado.body,
        duplex: "half",
      } as RequestInit);
      if (!subido.ok) throw new Error(`envio para o workspace: HTTP ${subido.status}`);
    },
    async subirTexto(bucket, caminho, texto, mime) {
      const { error } = await db.storage.from(bucket).upload(caminho, new Blob([texto], { type: mime }), { contentType: mime, upsert: true });
      if (error) throw falha("legenda no workspace", error);
    },
    async anotar(id, origem, soSeLivre) {
      let q = db.from("video_arquivos").update({ origem, atualizado_em: new Date().toISOString() }).eq("id", id);
      if (soSeLivre) q = q.is("origem->workspace", null);
      const { data, error } = await q.select("id");
      if (error) throw falha("video_arquivos", error);
      return ((data || []) as unknown[]).length > 0;
    },
  };
}
