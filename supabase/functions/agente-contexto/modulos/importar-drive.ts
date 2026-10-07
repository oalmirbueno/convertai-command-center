import type { BancoDeMateriais } from "./materiais-do-plano.ts";
import { baixarDrive, itensDaPastaPublica, linksDoDrive, urlDeDownload, type LinkDrive } from "./links-do-drive.ts";

export function nomeDoDownload(link: LinkDrive, headers: Headers): string {
  const cd = headers.get("content-disposition") || "";
  let nome = link.nome || "";
  const encoded = cd.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  try { nome = encoded ? decodeURIComponent(encoded) : cd.match(/filename="([^"]+)"/i)?.[1] || nome; } catch { /* usa o nome da pasta */ }
  const ext = link.tipo === "document" ? "txt" : link.tipo === "spreadsheets" ? "xlsx" : link.tipo === "presentation" ? "pptx" : "";
  // Nomes remotos não podem conter separadores nem caracteres de controle.
  // eslint-disable-next-line no-control-regex
  nome = (nome || `Arquivo ${link.id}`).replace(/[\\/\x00-\x1f]/g, " ").trim().slice(0, 180);
  return ext && !nome.toLowerCase().endsWith(`.${ext}`) ? `${nome}.${ext}` : nome;
}
export function categoriaDoDrive(mime: string): string {
  return mime.startsWith("image/") ? "Imagens" : mime.startsWith("video/") ? "Vídeos" : mime.startsWith("audio/") ? "Áudios" : "Documentos";
}
export type ArquivoImportado = { nome: string; mime: string; caminho: string; fonte: string; id: string };

/** Importação por cliente, somente leitura no Drive. Não interpreta HTML de login como arquivo. */
export async function importarDrive(db: BancoDeMateriais, clientId: string, userId: string, mensagem: string) {
  const fila = linksDoDrive(mensagem);
  const arquivos: ArquivoImportado[] = [];
  const avisos: string[] = [];
  const vistos = new Set<string>();
  let total = 0;
  const inicio = Date.now();
  const pastas = new Map<string, string>();
  const pasta = async (name: string, parent: string | null): Promise<string> => {
    const chave = `${parent}:${name}`;
    if (pastas.has(chave)) return pastas.get(chave)!;
    let q = db.from("workspace_nodes").select("id").eq("client_id", clientId).eq("scope", "client").eq("kind", "folder").eq("name", name);
    q = parent ? q.eq("parent_id", parent) : q.is("parent_id", null);
    const r = await q.limit(1);
    if (r.error) throw new Error("Não foi possível consultar as pastas do cliente.");
    let id = r.data?.[0]?.id;
    if (!id) {
      const novo = await db.from("workspace_nodes").insert({ client_id: clientId, scope: "client", kind: "folder", name, parent_id: parent, created_by: userId }).select("id").single();
      if (novo.error || !novo.data) throw new Error("Não foi possível criar a pasta no Workspace.");
      id = novo.data.id;
    }
    pastas.set(chave, id);
    return id;
  };
  while (fila.length) {
    if (arquivos.length >= 20 || vistos.size >= 40 || total >= 100 * 1024 * 1024 || Date.now() - inicio > 80_000) {
      avisos.push(`Importação parcial: ${fila.length} link(s) ainda não processados. Envie os links de arquivos ou subpastas restantes em outro pedido.`);
      break;
    }
    const link = fila.shift()!;
    if (vistos.has(link.id)) continue;
    vistos.add(link.id);
    try {
      const download = await baixarDrive(urlDeDownload(link), link.tipo === "pasta" ? 2_000_000 : Math.min(50 * 1024 * 1024, 100 * 1024 * 1024 - total));
      total += download.bytes.length;
      if (link.tipo === "pasta") {
        if ((link.pasta?.length || 0) >= 4) throw new Error("Subpastas muito profundas: envie o link desta subpasta separadamente.");
        const itens = itensDaPastaPublica(new TextDecoder().decode(download.bytes));
        if (!itens.length) throw new Error("Pasta vazia ou sem acesso público. Arquivos privados precisam de uma conexão Google autorizada, ainda indisponível no painel.");
        fila.push(...itens.map(i => ({ ...i, pasta: [...(link.pasta || []), link.nome || `Pasta ${link.id}`] })));
        continue;
      }
      const mime = (download.headers.get("content-type") || "application/octet-stream").split(";")[0].trim();
      const prefixo = new TextDecoder().decode(download.bytes.slice(0, 200)).trim();
      if (mime.includes("text/html") || /^<!doctype html|^<html/i.test(prefixo)) throw new Error("O Google retornou uma tela de acesso, não o arquivo. Libere o link para leitura ou anexe o arquivo no Contexto.");
      if (!download.bytes.length) throw new Error("Arquivo vazio.");
      const nome = nomeDoDownload(link, download.headers);
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", download.bytes))).map(n => n.toString(16).padStart(2, "0")).join("");
      const caminho = `client/${clientId}/contexto/drive/${link.id}/${hash}`;
      const existe = await db.from("workspace_nodes").select("id").eq("client_id", clientId).eq("scope", "client").eq("storage_path", caminho).limit(1);
      if (existe.error) throw new Error("Não foi possível conferir arquivos importados.");
      let id = existe.data?.[0]?.id;
      if (!id) {
        let parent = await pasta("Contexto do cliente", null);
        parent = await pasta("Drive", parent);
        for (const p of link.pasta || []) parent = await pasta(p.slice(0, 180), parent);
        parent = await pasta(categoriaDoDrive(mime), parent);
        const up = await db.storage.from("workspace").upload(caminho, download.bytes, { contentType: mime, upsert: true });
        if (up.error) throw new Error("Falha ao guardar o arquivo no Workspace.");
        const n = await db.from("workspace_nodes").insert({ client_id: clientId, scope: "client", kind: "file", parent_id: parent, name: nome, mime, storage_path: caminho, size_bytes: download.bytes.length, created_by: userId }).select("id").single();
        if (n.error || !n.data) throw new Error("Falha ao registrar o arquivo no Workspace.");
        id = n.data.id;
      }
      arquivos.push({ nome, mime, caminho, fonte: link.url, id });
    } catch (e) { avisos.push(`${link.nome || link.url}: ${e instanceof Error ? e.message : "Não foi possível importar."}`); }
  }
  return { arquivos, avisos };
}
