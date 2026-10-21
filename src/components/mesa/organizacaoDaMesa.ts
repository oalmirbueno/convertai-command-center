import { supabase } from "@/integrations/supabase/client";
import { itemDaMarca, type projetosDaMarca } from "@/lib/mesa/marcas";
import { storageRefFromFile } from "@/lib/fileUrls";

export interface NoDaOrganizacao {
  id: string;
  client_id: string;
  scope: string;
  parent_id: string | null;
  kind: "file" | "folder";
  name: string;
  mime: string | null;
  storage_path: string | null;
  created_at: string;
  inbox_scan_status: string | null;
}

export interface ArquivoDaOrganizacao {
  id: string;
  client_id: string;
  project_id: string | null;
  parent_file_id: string | null;
  file_name: string;
  file_url: string | null;
  file_type: string | null;
  mime_type: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  folder: string | null;
  created_at: string;
}

export interface AcervoDaOrganizacao {
  nos: NoDaOrganizacao[];
  arquivos: ArquivoDaOrganizacao[];
}

export interface ItemDaOrganizacao {
  id: string;
  origem: "workspace" | "arquivos";
  nome: string;
  pasta: string | null;
  mime: string;
  fileUrl: string | null;
  bucket: string | null;
  caminho: string | null;
  criadoEm: string;
}

export type FiltroDaMarcaNaOrganizacao = ReturnType<typeof projetosDaMarca>;
const TAMANHO_DA_PAGINA = 1000;
const MAX_PAGINAS = 30;
const COLUNAS_DOS_NOS = "id, client_id, scope, parent_id, kind, name, mime, storage_path, created_at, inbox_scan_status";
const COLUNAS_DOS_ARQUIVOS = "id, client_id, project_id, parent_file_id, file_name, file_url, file_type, mime_type, storage_bucket, storage_path, folder, created_at";
type PaginaDaOrganizacao<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

/** Mesmas tabelas do Workspace, sem cópias nem nova organização paralela. */
export async function lerOrganizacao(clientId: string): Promise<AcervoDaOrganizacao> {
  if (!clientId) throw new Error("Escolha o cliente antes de abrir a organização.");
  // Cada fábrica conserva a relação e as colunas literais. Unir builders de
  // tabela e view aqui expande desnecessariamente os tipos do PostgREST.
  const paginar = async <T,>(buscarPagina: (inicio: number, fim: number) => PaginaDaOrganizacao<T>): Promise<T[]> => {
    const todos: T[] = [];
    for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
      const { data, error } = await buscarPagina(pagina * TAMANHO_DA_PAGINA, (pagina + 1) * TAMANHO_DA_PAGINA - 1);
      if (error) throw error;
      todos.push(...(data || []));
      if (!data || data.length < TAMANHO_DA_PAGINA) return todos;
    }
    throw new Error("Acervo muito grande para esta visão. Abra o Workspace para continuar.");
  };
  const [nos, arquivos] = await Promise.all([
    paginar<NoDaOrganizacao>((inicio, fim) => supabase.from("workspace_nodes")
      .select(COLUNAS_DOS_NOS).eq("client_id", clientId).eq("scope", "client").order("id").range(inicio, fim)),
    paginar<ArquivoDaOrganizacao>((inicio, fim) => supabase.from("staff_files_secure")
      .select(COLUNAS_DOS_ARQUIVOS).eq("client_id", clientId).is("archived_at", null).order("id").range(inicio, fim)),
  ]);
  return {
    nos: nos.filter((n) => n.client_id === clientId && n.scope === "client" && (!n.inbox_scan_status || n.inbox_scan_status === "clean")),
    arquivos: arquivos.filter((a) => a.client_id === clientId),
  };
}

/** Workspace é compartilhado pelo cliente; Arquivos conserva o recorte por projeto/marca. */
export function itensDaOrganizacao(acervo: AcervoDaOrganizacao, filtro: FiltroDaMarcaNaOrganizacao): ItemDaOrganizacao[] {
  const caminhosDoWorkspace = new Set(acervo.nos.filter((n) => n.kind === "file").map((n) => n.storage_path).filter(Boolean));
  const doWorkspace: ItemDaOrganizacao[] = acervo.nos.filter((n) => n.kind === "file").map((n) => ({
    id: n.id, origem: "workspace", nome: n.name || "Arquivo", pasta: n.parent_id, mime: n.mime || "",
    fileUrl: null, bucket: "workspace", caminho: n.storage_path, criadoEm: n.created_at,
  }));
  const dosArquivos: ItemDaOrganizacao[] = acervo.arquivos
    .filter((a) => !a.parent_file_id && itemDaMarca(a.project_id, filtro))
    .filter((a) => {
      const ref = storageRefFromFile({ fileUrl: a.file_url, storageBucket: a.storage_bucket, storagePath: a.storage_path });
      return !(ref?.bucket === "workspace" && caminhosDoWorkspace.has(ref.path));
    })
    .map((a) => ({
      id: a.id, origem: "arquivos", nome: a.file_name || "Arquivo", pasta: a.folder || null, mime: a.mime_type || a.file_type || "",
      fileUrl: a.file_url, bucket: a.storage_bucket, caminho: a.storage_path, criadoEm: a.created_at,
    }));
  return [...doWorkspace, ...dosArquivos].sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || "") || a.nome.localeCompare(b.nome, "pt-BR"));
}

export function pastasDaOrganizacao(nos: NoDaOrganizacao[]) {
  const pastas = nos.filter((n) => n.kind === "folder");
  const porId = new Map(pastas.map((p) => [p.id, p]));
  const caminho = (p: NoDaOrganizacao) => {
    const nomes = [p.name];
    const vistos = new Set([p.id]);
    let pai = p.parent_id && porId.get(p.parent_id);
    while (pai && !vistos.has(pai.id)) {
      vistos.add(pai.id);
      nomes.unshift(pai.name);
      pai = pai.parent_id && porId.get(pai.parent_id);
    }
    return nomes.join(" / ");
  };
  return pastas.map((p) => ({ id: p.id, nome: caminho(p) })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

function estaDentroDaPasta(parentId: string | null, pastaId: string, porId: Map<string, NoDaOrganizacao>): boolean {
  const vistos = new Set<string>();
  let atual = parentId;
  while (atual && !vistos.has(atual)) {
    if (atual === pastaId) return true;
    vistos.add(atual);
    atual = porId.get(atual)?.parent_id || null;
  }
  return false;
}

export function dentroDaPasta(parentId: string | null, pastaId: string, nos: NoDaOrganizacao[]): boolean {
  return estaDentroDaPasta(parentId, pastaId, new Map(nos.map((n) => [n.id, n])));
}

/** Conta cada arquivo uma vez por pasta ancestral, sem percorrer o acervo inteiro para cada pasta. */
export function contagensDasPastas(itens: ItemDaOrganizacao[], nos: NoDaOrganizacao[]): Map<string, number> {
  const porId = new Map(nos.map((n) => [n.id, n]));
  const contagens = new Map<string, number>();
  for (const item of itens) {
    if (item.origem !== "workspace") continue;
    const vistos = new Set<string>();
    let pai = item.pasta;
    while (pai && !vistos.has(pai)) {
      vistos.add(pai);
      contagens.set(pai, (contagens.get(pai) || 0) + 1);
      pai = porId.get(pai)?.parent_id || null;
    }
  }
  return contagens;
}

export function filtrarOrganizacao(itens: ItemDaOrganizacao[], nos: NoDaOrganizacao[], selecao: string, busca: string): ItemDaOrganizacao[] {
  const termo = busca.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const porId = new Map(nos.map((n) => [n.id, n]));
  return itens.filter((i) => {
    if (selecao === "workspace" && i.origem !== "workspace") return false;
    if (selecao === "arquivos" && i.origem !== "arquivos") return false;
    if (selecao.startsWith("workspace:") && (i.origem !== "workspace" || !estaDentroDaPasta(i.pasta, selecao.slice(10), porId))) return false;
    if (selecao.startsWith("arquivos:") && (i.origem !== "arquivos" || (i.pasta || "") !== selecao.slice(9))) return false;
    return !termo || i.nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(termo);
  });
}

/** Só IDs da árvore lida deste cliente podem ser origem ou destino. O filtro antigo protege contra movimento concorrente. */
export async function moverNaOrganizacao(clientId: string, noId: string, destino: string | null, nos: NoDaOrganizacao[]) {
  const no = nos.find((n) => n.id === noId && n.client_id === clientId && n.scope === "client");
  const pasta = destino ? nos.find((n) => n.id === destino && n.client_id === clientId && n.scope === "client" && n.kind === "folder") : null;
  if (!no || (destino && !pasta)) throw new Error("Arquivo ou pasta fora deste cliente. Atualize a organização.");
  if (destino === noId || (destino && dentroDaPasta(destino, noId, nos))) throw new Error("Escolha uma pasta fora deste item.");
  if (no.parent_id === destino) return;
  let consulta = supabase.from("workspace_nodes").update({ parent_id: destino }).eq("id", noId).eq("client_id", clientId).eq("scope", "client");
  consulta = no.parent_id ? consulta.eq("parent_id", no.parent_id) : consulta.is("parent_id", null);
  const { data, error } = await consulta.select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("O item mudou em outra tela. Atualize antes de organizar de novo.");
}

export async function criarPastaNaOrganizacao(clientId: string, userId: string, nome: string, parentId: string | null, nos: NoDaOrganizacao[]) {
  const limpo = nome.trim();
  if (!clientId || !userId || !limpo || limpo.length > 120) throw new Error("Dê um nome de até 120 caracteres para a pasta.");
  if (parentId && !nos.some((n) => n.id === parentId && n.client_id === clientId && n.scope === "client" && n.kind === "folder")) throw new Error("Pasta fora deste cliente.");
  if (nos.some((n) => n.client_id === clientId && n.kind === "folder" && n.parent_id === parentId && n.name.toLocaleLowerCase("pt-BR") === limpo.toLocaleLowerCase("pt-BR"))) throw new Error("Já existe uma pasta com esse nome aqui.");
  const { error } = await supabase.from("workspace_nodes").insert({ scope: "client", client_id: clientId, parent_id: parentId, kind: "folder", name: limpo, created_by: userId });
  if (error) throw error;
}

export function linkDoWorkspaceDaOrganizacao(clientId: string, pastaId?: string | null, organizar = false): string {
  const p = new URLSearchParams({ client: clientId });
  if (pastaId) p.set("pasta", pastaId);
  if (organizar) p.set("organizar", "1");
  return `/workspace?${p.toString()}`;
}
