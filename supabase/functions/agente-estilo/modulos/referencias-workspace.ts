export type NoDeReferencia = { id: string; parent_id: string | null; kind: string; name: string; mime: string | null; storage_path: string | null };
const normalizar = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Só imagens abaixo de pastas explicitamente nomeadas como referências. */
export function imagensDasReferencias(nos: NoDeReferencia[]) {
  const pastas = new Set(nos.filter(n => n.kind === "folder" && /refer/.test(normalizar(n.name))).map(n => n.id));
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const n of nos) if (n.kind === "folder" && n.parent_id && pastas.has(n.parent_id) && !pastas.has(n.id)) { pastas.add(n.id); mudou = true; }
  }
  return nos.filter(n => n.kind === "file" && n.parent_id && pastas.has(n.parent_id) && n.storage_path && (n.mime?.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(n.name)));
}

export async function sincronizarReferenciasDoWorkspace(db: any, clientId: string, marca: { principal?: boolean } | null) {
  // Workspace é do cliente; marcas secundárias mantêm sua seleção explícita.
  if (marca && !marca.principal) return;
  const { data, error } = await db.from("workspace_nodes").select("id,parent_id,kind,name,mime,storage_path").eq("client_id", clientId).limit(5000);
  if (error) throw new Error("Não foi possível consultar as referências do Workspace.");
  const imagens = imagensDasReferencias(data || []);
  if (!imagens.length) return;
  const r = await db.from("cliente_referencias").upsert(imagens.map(n => ({ client_id: clientId, origem: "workspace", workspace_node_id: n.id, ativa: true })), { onConflict: "client_id,workspace_node_id", ignoreDuplicates: true });
  if (r.error) throw new Error("Não foi possível vincular as referências do Workspace.");
}
