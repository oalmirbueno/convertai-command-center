/**
 * laboratorio: saídas no Workspace global (bucket "workspace" + workspace_nodes escopo 'global',
 * client_id nulo) em Laboratório / <Livres | Nome do cliente> / <projeto>. As pastas que faltam
 * são criadas (achadas pelo nome sem acento e sem caixa: rodar de novo não duplica).
 */
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { ErroHttp, servico } from "./comum.ts";
import { nomeNormal } from "./modulos/regras.ts";

export const BUCKET = "workspace";
const VALIDADE_DO_LINK_S = 60 * 60 * 24 * 7;

/** Acha ou cria a cadeia de pastas globais e devolve o id da última. */
export async function garantirPastas(pastas: string[], criadoPor: string | null): Promise<string> {
  const db = servico();
  let pai: string | null = null;
  for (const nome of pastas) {
    let consulta = db.from("workspace_nodes").select("id, name").eq("scope", "global").is("client_id", null).eq("kind", "folder");
    consulta = pai ? consulta.eq("parent_id", pai) : consulta.is("parent_id", null);
    const { data, error } = await consulta.limit(500);
    if (error) throw new ErroHttp(503, "workspace_indisponivel", "Não consegui ler as pastas do Workspace agora.");
    const achada = ((data || []) as Array<{ id: string; name: string }>).find((p) => nomeNormal(p.name) === nomeNormal(nome));
    if (achada) {
      pai = achada.id;
      continue;
    }
    const linha: Record<string, unknown> = { scope: "global", client_id: null, kind: "folder", name: nome, parent_id: pai, created_by: criadoPor };
    const { data: nova, error: eNova } = await db.from("workspace_nodes").insert(linha).select("id").single();
    if (eNova || !nova) throw new ErroHttp(503, "workspace_indisponivel", "Não consegui criar a pasta no Workspace.");
    pai = (nova as { id: string }).id;
  }
  if (!pai) throw new ErroHttp(500, "workspace_sem_pasta", "Pasta do Laboratório não criada.");
  return pai;
}

export type ArquivoSalvo = { path: string; url: string | null; no_id: string | null; nome: string; mime: string };

/** Sobe o arquivo no bucket e cria o nó no Workspace global (o arquivo vale mesmo se o nó falhar: fica no log). */
export async function salvarArquivo(o: {
  conteudo: Uint8Array | string;
  mime: string;
  caminho: string;
  nome: string;
  pastaId: string;
  criadoPor: string | null;
}): Promise<ArquivoSalvo> {
  const db = servico();
  const corpo = typeof o.conteudo === "string" ? new TextEncoder().encode(o.conteudo) : o.conteudo;
  const { error } = await db.storage.from(BUCKET).upload(o.caminho, corpo, { contentType: o.mime, upsert: true });
  if (error) throw new ErroHttp(503, "arquivo_nao_salvo", "Não consegui salvar o arquivo no Workspace.");
  let noId: string | null = null;
  const { data: no, error: eNo } = await db
    .from("workspace_nodes")
    .insert({ scope: "global", client_id: null, kind: "file", name: o.nome, parent_id: o.pastaId, mime: o.mime, size_bytes: corpo.byteLength, storage_path: o.caminho, created_by: o.criadoPor })
    .select("id")
    .single();
  if (eNo) registrarFalha("laboratorio: nó do arquivo não entrou no Workspace", eNo, { caminho: o.caminho });
  else noId = (no as { id: string }).id;
  return { path: o.caminho, url: await linkAssinado(o.caminho), no_id: noId, nome: o.nome, mime: o.mime };
}

export async function linkAssinado(caminho: string, bucket = BUCKET): Promise<string | null> {
  const { data } = await servico().storage.from(bucket).createSignedUrl(caminho, VALIDADE_DO_LINK_S);
  return data?.signedUrl ?? null;
}

/** Bytes de uma imagem do Storage (mídia ou referência). Só buckets conhecidos; falha vira null com log. */
const BUCKETS_LIDOS = new Set(["workspace", "mesa", "files"]);
export async function lerImagem(caminho: string, bucket = BUCKET): Promise<{ bytes: Uint8Array; mime: string } | null> {
  if (!BUCKETS_LIDOS.has(bucket) || !caminho) return null;
  try {
    const { data, error } = await servico().storage.from(bucket).download(caminho);
    if (error || !data) return null;
    const mime = data.type || "image/png";
    if (!mime.startsWith("image/")) return null;
    return { bytes: new Uint8Array(await data.arrayBuffer()), mime };
  } catch (e) {
    registrarFalha("laboratorio: imagem de entrada não lida", e, { caminho });
    return null;
  }
}
