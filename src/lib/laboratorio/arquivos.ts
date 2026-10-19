/**
 * Arquivos do Laboratório: tudo o que o Laboratório gera fica no workspace
 * global, em `Laboratório/<Livres | Nome do cliente>/<projeto>` (bucket
 * `workspace`). Aqui só lemos: a pasta raiz, as filhas e os endereços
 * assinados para ver e baixar.
 */
import { supabase } from "@/integrations/supabase/client";

export const NOME_DA_PASTA_RAIZ = "Laboratório";

export interface ItemDoWorkspace {
  id: string;
  nome: string;
  tipo: "folder" | "file";
  parent_id: string | null;
  mime: string;
  storage_path: string;
  thumb_path: string;
  tamanho: number | null;
  atualizado: string;
}

const CAMPOS = "id,name,kind,parent_id,mime,storage_path,thumb_path,size_bytes,updated_at";

function item(r: any): ItemDoWorkspace {
  return {
    id: String(r.id),
    nome: String(r.name || ""),
    tipo: r.kind === "folder" ? "folder" : "file",
    parent_id: r.parent_id || null,
    mime: String(r.mime || ""),
    storage_path: String(r.storage_path || ""),
    thumb_path: String(r.thumb_path || ""),
    tamanho: typeof r.size_bytes === "number" ? r.size_bytes : null,
    atualizado: String(r.updated_at || ""),
  };
}

/** A pasta "Laboratório" do workspace global (null se ainda não nasceu). */
export async function lerPastaRaiz(): Promise<ItemDoWorkspace | null> {
  const { data, error } = await (supabase as any)
    .from("workspace_nodes")
    .select(CAMPOS)
    .eq("scope", "global")
    .eq("kind", "folder")
    .eq("name", NOME_DA_PASTA_RAIZ)
    .is("parent_id", null)
    .limit(1);
  if (error) throw error;
  const linha = Array.isArray(data) ? data[0] : data;
  return linha ? item(linha) : null;
}

/** Filhas de uma pasta: pastas primeiro, depois os arquivos mais novos. */
export async function lerFilhas(pastaId: string): Promise<ItemDoWorkspace[]> {
  const { data, error } = await (supabase as any)
    .from("workspace_nodes")
    .select(CAMPOS)
    .eq("scope", "global")
    .eq("parent_id", pastaId)
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  const lista = (Array.isArray(data) ? data : []).map(item);
  return lista.filter((x) => x.tipo === "folder").sort((a, b) => a.nome.localeCompare(b.nome)).concat(lista.filter((x) => x.tipo === "file"));
}

export const ehImagemDoWorkspace = (i: ItemDoWorkspace) => i.mime.indexOf("image/") === 0 || /\.(png|jpe?g|webp|gif|svg)$/i.test(i.nome);

/** Endereços assinados (1 h) para vários caminhos de uma vez. */
export async function enderecosAssinados(caminhos: string[]): Promise<Record<string, string>> {
  const unicos = caminhos.filter((c, i) => !!c && caminhos.indexOf(c) === i);
  if (!unicos.length) return {};
  const { data } = await supabase.storage.from("workspace").createSignedUrls(unicos, 3600);
  const saida: Record<string, string> = {};
  (data || []).forEach((d: any) => {
    if (d && d.path && d.signedUrl) saida[d.path] = d.signedUrl;
  });
  return saida;
}

export async function enderecoParaBaixar(caminho: string, nome: string): Promise<string | null> {
  const { data } = await supabase.storage.from("workspace").createSignedUrl(caminho, 3600, { download: nome || true });
  return data && data.signedUrl ? data.signedUrl : null;
}

/** HTML salvo (landing) como texto, para a prévia em iframe sandbox. */
export async function lerHtmlSalvo(caminho: string): Promise<string> {
  const { data, error } = await supabase.storage.from("workspace").download(caminho);
  if (error || !data) throw error || new Error("Arquivo não encontrado.");
  return await data.text();
}
